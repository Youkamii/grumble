/**
 * state.records → 공개할 문장 목록. 최근순, 소스별 N개, 마스킹 적용, 중복 제거.
 * "최근에 꿍시렁거린 것"이 목적이므로 점수는 문턱으로만 쓰고 정렬은 시간순이다.
 */
import type { GrumbleRecord } from "./types.ts";
import { mask, MASK_TOKEN_RE, projectNamesFromCwds, defaultNames } from "./mask.ts";
import { bestSentence, type Target } from "./score.ts";

export const DEFAULT_PER_SOURCE = 3;

export interface Selected {
  id: string;
  source: "codex" | "claude";
  ts: string;
  /** 마스킹된 최종 문장. 공개 가능. */
  text: string;
  score: number;
  target: Target;
}

export interface SelectOptions {
  perSource?: number;
  /** 이 점수 미만은 후보에서 제외. */
  minScore?: number;
  /** 말풍선에 들어갈 최대 글자 수. 넘으면 말줄임. */
  maxChars?: number;
  /** 마스킹에 쓸 추가 계정명·호스트 별칭 등. */
  extraNames?: Iterable<string>;
}

export function truncate(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join("").replace(/[\s,;:]+$/, "") + "…";
}

export function select(records: GrumbleRecord[], opts: SelectOptions = {}): Selected[] {
  const perSource = opts.perSource ?? DEFAULT_PER_SOURCE;
  const minScore = opts.minScore ?? 3;
  const maxChars = opts.maxChars ?? 140;
  const projectNames = projectNamesFromCwds(records.map((r) => r.cwd));
  const names = new Set([...defaultNames(), ...(opts.extraNames ?? [])]);

  const sorted = [...records].sort((a, b) => b.ts.localeCompare(a.ts));
  const bySource: Record<string, Selected[]> = { codex: [], claude: [] };
  const seenText = new Set<string>();

  // 1차: 문턱 이상만. 2차: 모자라면 문턱을 한 단계 낮춰 채운다(신선함보다 빈 말풍선이 더 나쁘다).
  for (const threshold of [minScore, minScore - 1]) {
    for (const r of sorted) {
      const bucket = bySource[r.source]!;
      if (bucket.length >= perSource) continue;
      const best = bestSentence(r.text);
      if (!best || best.score < threshold) continue;
      const masked = truncate(mask(best.text, { projectNames, names }), maxChars);
      // 마스킹 후 토큰만 남는 문장은 정보가 없다.
      const bare = masked.replace(MASK_TOKEN_RE, "").replace(/[\s.,!?…"'“”]/g, "");
      if ([...bare].length < 8) continue;
      const key = masked.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      bucket.push({ id: r.id, source: r.source, ts: r.ts, text: masked, score: best.score, target: best.target });
    }
    if (bySource.codex!.length >= perSource && bySource.claude!.length >= perSource) break;
  }
  const byTs = (a: Selected, b: Selected) => b.ts.localeCompare(a.ts);
  return [...bySource.claude!.sort(byTs), ...bySource.codex!.sort(byTs)];
}
