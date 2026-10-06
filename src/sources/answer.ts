/**
 * 답변 본문(assistant text) → 레코드. 두 채널을 건진다.
 *  - mutter: 모델이 `꿍시렁:`으로 시작해 남긴 한 줄(#11). 전역 CLAUDE.md·AGENTS.md 규칙으로 모델이 "꼬였거나
 *    어이없을 때만" 응답 **맨 끝**에 남기는 반말 혼잣말이다. 모델이 스스로 꿍시렁이라고 표시한 말이라 가장 좋은 재료다.
 *  - confession: 스스로를 정정하는 문장(#10, confession.ts).
 *
 * 꿍시렁은 계약대로만 받는다: 마크다운을 걷어낸 뒤 **마지막 비어 있지 않은 줄**이 `꿍시렁:`으로 시작할 때 그 한 줄만.
 * 본문 중간의 언급, 예시 목록, 남의 글을 옮긴 줄은 그래서 걸리지 않는다. 중계 메시지(`[external_agent…`)는 통째로 버린다.
 * 꿍시렁 줄은 자백 추출 전에 본문에서 떼어내 두 채널에 겹쳐 들어가지 않게 한다.
 */
import type { GrumbleRecord } from "../types.ts";
import { recordId } from "../util.ts";
import { confessionsIn, RELAY_RE, stripMarkdown } from "./confession.ts";

/** 한 줄 전체가 `꿍시렁:` + 본문(공백만은 안 됨). 전각 콜론도. 굵게 표시는 stripMarkdown이 먼저 걷어낸다. */
export const MUTTER_RE = /^[ \t]*꿍시렁[ \t]*[:：][ \t]*(\S.*?)[ \t]*$/;
/** 지시문은 60자 안쪽. 이보다 길면 꿍시렁이 아니라 본문을 옮긴 것으로 보고 버린다. */
export const MUTTER_MAX_CHARS = 100;

/** 마지막 줄의 꿍시렁 본문(없으면 null)과, 그 줄을 뺀 나머지 본문(마크다운 제거됨). */
export function mutterLine(text: string): { line: string | null; rest: string } {
  const clean = stripMarkdown(text.replace(/\r\n?/g, "\n"));
  if (RELAY_RE.test(clean)) return { line: null, rest: clean };
  const lines = clean.split("\n");
  let i = lines.length - 1;
  while (i >= 0 && !lines[i]!.trim()) i--;
  const m = i >= 0 ? lines[i]!.match(MUTTER_RE) : null;
  if (!m) return { line: null, rest: clean };
  const line = m[1]!.replace(/\s+/g, " ");
  return { line: [...line].length <= MUTTER_MAX_CHARS ? line : null, rest: lines.slice(0, i).join("\n") };
}

export function answerRecords(
  source: GrumbleRecord["source"],
  ts: string,
  text: string,
  meta: Pick<GrumbleRecord, "cwd" | "session" | "model">,
): GrumbleRecord[] {
  if (!text) return [];
  const { line, rest } = mutterLine(text);
  const out: GrumbleRecord[] = [];
  if (line) out.push({ id: recordId(source, ts, line), source, ts, text: line, ...meta, kind: "mutter" });
  for (const t of confessionsIn(rest)) out.push({ id: recordId(source, ts, t), source, ts, text: t, ...meta, kind: "confession" });
  return out;
}
