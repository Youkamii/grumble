/**
 * 숫자 말풍선(#12). 지난 7일(오늘 이전 7일, 로컬 날짜) 동안 소스별로 센 숫자를 캐릭터의 자조 한 줄로 만든다.
 * 전부 사실이고 LLM을 쓰지 않는다. 창이 하루 단위로 움직이므로 SVG는 하루 한 번만 바뀐다.
 * select 결과 뒤에 소스당 한 개씩 붙는다(publish.renderAll). 노출 기록·판정과는 무관하다.
 */
import type { GrumbleRecord } from "./types.ts";
import type { Selected } from "./select.ts";

export const STATS_DAYS = 7;
/** 계획 문장: "~하겠습니다/겠다/할게요", "I'll/I will/Let me". */
export const PLAN_RE = /겠습니다|겠다|할게요|\bI'?ll\b|\bI will\b|\bLet me\b/;
/** 새벽: 로컬 0시 이상 LATE_UNTIL 미만. */
export const LATE_UNTIL = 6;

export interface SourceStats {
  source: GrumbleRecord["source"];
  records: number;
  plans: number;
  confessions: number;
  mutters: number;
  lateNight: number;
}

/** [오늘 0시 − STATS_DAYS, 오늘 0시) — 로컬 날짜 기준. */
export function windowOf(now: Date): { start: Date; end: Date } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - STATS_DAYS);
  return { start, end };
}

export function countStats(records: GrumbleRecord[], now: Date): SourceStats[] {
  const { start, end } = windowOf(now);
  const by: Record<string, SourceStats> = {};
  for (const src of ["claude", "codex"] as const) by[src] = { source: src, records: 0, plans: 0, confessions: 0, mutters: 0, lateNight: 0 };
  for (const r of records) {
    const t = new Date(r.ts);
    if (!(t >= start && t < end)) continue;
    const s = by[r.source]!;
    s.records++;
    if (r.kind === "confession") s.confessions++;
    else if (r.kind === "mutter") s.mutters++;
    else if (PLAN_RE.test(r.text)) s.plans++;
    if (t.getHours() < LATE_UNTIL) s.lateNight++;
  }
  return Object.values(by);
}

/** 캐릭터의 자조 한 줄. 0인 항목은 뺀다. 셀 게 없으면 null(말풍선 없음). */
export function statsText(s: SourceStats): string | null {
  const parts: string[] = [];
  if (s.plans) parts.push(`"하겠습니다" ${s.plans}번`);
  if (s.confessions) parts.push(`"제 잘못" ${s.confessions}번`);
  if (s.mutters) parts.push(`꿍시렁 ${s.mutters}번`);
  if (s.lateNight) parts.push(`새벽 작업 ${s.lateNight}건`);
  if (parts.length === 0) return null;
  return `지난 7일 성적표: ${parts.join(", ")}.`;
}

/** 로컬 날짜 키 YYYY-MM-DD. */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 소스당 통계 말풍선 하나. ts는 창의 끝(오늘 0시, 로컬)이라 라벨 날짜가 오늘이다. */
export function weeklyStats(records: GrumbleRecord[], now: Date = new Date()): Selected[] {
  const { end } = windowOf(now);
  const day = dayKey(end);
  const out: Selected[] = [];
  for (const s of countStats(records, now)) {
    const text = statsText(s);
    if (!text) continue;
    out.push({ id: `stats:${s.source}:${day}`, source: s.source, ts: `${day}T00:00:00`, text, score: 0, target: "self", fun: 0, kind: "stats" });
  }
  return out;
}
