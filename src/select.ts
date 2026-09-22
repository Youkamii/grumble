/**
 * state.records → 공개할 문장 목록. 재미순, 소스별 N개, 마스킹 적용, 중복 제거.
 * "밋밋한 최근 문장"보다 "웃긴 문장"이 낫다는 피드백에 따라 정렬 키는 시간이 아니라
 * fun(LLM 판정 0~10, 없으면 휴리스틱 점수를 0~HEURISTIC_FUN_CAP으로 클램프) + 최근성 보너스다.
 * 휴리스틱 점수는 표지어 합산이라 상한이 없다(16점도 나온다). 그대로 0~10에 클램프하면
 * LLM이 9점을 준 문장을 표지어만 많은 문장이 덮어버리므로, 판정 없는 레코드의 fun은 5로 상한을 건다.
 * 그 결과 LLM 6점 이상은 판정 없는 문장을 항상 이긴다.
 */
import type { GrumbleRecord } from "./types.ts";
import { mask, MASK_TOKEN_RE, projectNamesFromCwds, defaultNames } from "./mask.ts";
import { bestSentence, type Target } from "./score.ts";
import { configNames } from "./sync.ts";

export const DEFAULT_PER_SOURCE = 3;

/** CLI 인자 → 소스별 개수. 숫자가 아니면(`bun run preview abc`) 기본값으로 떨어진다. */
export function parsePerSource(arg: string | undefined, fallback = DEFAULT_PER_SOURCE): number {
  if (arg === undefined) return fallback;
  const n = Number(arg);
  return Number.isFinite(n) ? n : fallback;
}

/** LLM이 매긴 재미 판정. judge.ts가 만들고 select가 소비한다. */
export interface Judgment {
  /** 0~10. 클수록 웃기거나 투덜거림이 살아 있다. */
  fun: number;
  /** 한 단어 분위기(annoyed, confused, smug, resigned, deadpan, neutral 등). */
  mood?: string;
}

export interface Selected {
  id: string;
  source: "codex" | "claude";
  ts: string;
  /** 마스킹된 최종 문장. 공개 가능. */
  text: string;
  score: number;
  target: Target;
  /** 정렬에 쓴 재미 점수 0~10. LLM 판정이 있으면 그 값, 없으면 휴리스틱을 0~5로 클램프한 값. */
  fun: number;
  /** LLM 판정이 있을 때만. */
  mood?: string;
}

export interface SelectOptions {
  perSource?: number;
  /** 이 점수 미만은 후보에서 제외(휴리스틱 경로). */
  minScore?: number;
  /** 말풍선에 들어갈 최대 글자 수. 넘으면 말줄임. */
  maxChars?: number;
  /** 마스킹에 쓸 추가 계정명·호스트 별칭 등. */
  extraNames?: Iterable<string>;
  /** recordId → LLM 재미 판정. */
  judgments?: Map<string, Judgment>;
  /** 최근성 보너스의 기준 시각. 테스트 결정성을 위해 주입한다. */
  now?: Date;
}

/** LLM 판정이 있는 문장의 문턱. */
export const FUN_THRESHOLD = 3;
/** LLM 판정이 없는 문장의 fun 상한. 휴리스틱 합산 점수가 LLM 점수를 덮지 못하게 한다. */
export const HEURISTIC_FUN_CAP = 5;
const RECENCY_FULL_DAYS = 7;
const RECENCY_ZERO_DAYS = 90;
const RECENCY_MAX = 3;

export function truncate(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join("").replace(/[\s,;:]+$/, "") + "…";
}

export function clampFun(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, score));
}

/** 오늘 기준 7일 이내 +3, 90일에서 0으로 선형 감소, 그 이전 0. */
export function recencyBonus(ts: string, now: Date): number {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return 0;
  const days = (now.getTime() - t) / 86_400_000;
  if (days <= RECENCY_FULL_DAYS) return RECENCY_MAX;
  if (days >= RECENCY_ZERO_DAYS) return 0;
  return RECENCY_MAX * (RECENCY_ZERO_DAYS - days) / (RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS);
}

export function select(records: GrumbleRecord[], opts: SelectOptions = {}): Selected[] {
  const perSource = opts.perSource ?? DEFAULT_PER_SOURCE;
  const minScore = opts.minScore ?? 3;
  const maxChars = opts.maxChars ?? 140;
  const judgments = opts.judgments;
  const now = opts.now ?? new Date();
  const projectNames = projectNamesFromCwds(records.map((r) => r.cwd));
  // 원격 기계의 계정명·host 별칭도 [name]으로 가린다(원격 로그에는 그쪽 계정명이 섞여 있다).
  const names = new Set([...defaultNames(), ...configNames(), ...(opts.extraNames ?? [])]);

  // 후보를 한 번만 만들어 두고 정렬 키를 붙인다.
  interface Cand { r: GrumbleRecord; best: NonNullable<ReturnType<typeof bestSentence>>; j?: Judgment; fun: number; key: number }
  const cands: Cand[] = [];
  for (const r of records) {
    const best = bestSentence(r.text);
    if (!best) continue;
    const j = judgments?.get(r.id);
    const fun = j ? clampFun(j.fun) : Math.min(HEURISTIC_FUN_CAP, clampFun(best.score));
    cands.push({ r, best, j, fun, key: fun + recencyBonus(r.ts, now) });
  }
  // 재미 내림차순, 동점이면 LLM 판정이 있는 쪽 우선, 그다음 최근 우선.
  cands.sort((a, b) =>
    (b.key - a.key)
    || (Number(Boolean(b.j)) - Number(Boolean(a.j)))
    || b.r.ts.localeCompare(a.r.ts));

  const bySource: Record<string, Selected[]> = { codex: [], claude: [] };
  const seenText = new Set<string>();
  const seenDate: Record<string, Set<string>> = { codex: new Set(), claude: new Set() };

  // 1차: 문턱 이상만 + 날짜당 한 건. 2차: 모자라면 문턱을 한 단계 낮추고 날짜 제한도 푼다
  // (활동일이 며칠뿐이면 날짜 제한 때문에 슬롯이 빈 채로 남는데, 빈 말풍선이 더 나쁘다).
  for (const relax of [0, 1]) {
    const oneADay = relax === 0;
    for (const c of cands) {
      const bucket = bySource[c.r.source];
      if (!bucket || bucket.length >= perSource) continue;
      // LLM 판정이 있으면 그 값이 휴리스틱을 이긴다.
      if (c.j) {
        if (c.fun < FUN_THRESHOLD - relax) continue;
      } else if (c.best.score < minScore - relax) continue;
      // 같은 날짜는 소스당 한 건만(다양성).
      const day = c.r.ts.slice(0, 10);
      if (oneADay && seenDate[c.r.source]!.has(day)) continue;
      const masked = truncate(mask(c.best.text, { projectNames, names }), maxChars);
      // 마스킹 후 토큰만 남는 문장은 정보가 없다.
      const bare = masked.replace(MASK_TOKEN_RE, "").replace(/[\s.,!?…"'“”]/g, "");
      if ([...bare].length < 8) continue;
      const key = masked.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      seenDate[c.r.source]!.add(day);
      bucket.push({
        id: c.r.id, source: c.r.source, ts: c.r.ts, text: masked,
        score: c.best.score, target: c.best.target, fun: c.fun,
        ...(c.j?.mood ? { mood: c.j.mood } : {}),
      });
    }
    if (bySource.codex!.length >= perSource && bySource.claude!.length >= perSource) break;
  }
  return [...bySource.claude!, ...bySource.codex!];
}
