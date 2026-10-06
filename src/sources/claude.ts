/**
 * Claude Code 세션(~/.claude/projects/<proj>/<session>.jsonl) → thinking 요약 + 답변 본문(answer.ts: 꿍시렁 줄·자백).
 * 대부분의 thinking 블록은 본문 없이 signature만 남는다. 본문이 있는 것(Fable 계열)만 수집.
 */
import type { GrumbleRecord } from "../types.ts";
import { recordId } from "../util.ts";
import { answerRecords } from "./answer.ts";

export const CLAUDE_MARKER = '"thinking":"';
export const CLAUDE_TEXT_MARKER = '"type":"text"';

export function claudeLine(line: string): GrumbleRecord[] {
  // user 줄(tool_result)에도 "assistant" 문자열은 흔하다. 최상위 type으로 거르면 JSON.parse 비용이 줄어든다.
  if (!line.includes('"type":"assistant"') || (!line.includes(CLAUDE_MARKER) && !line.includes(CLAUDE_TEXT_MARKER))) return [];
  let o: any;
  try { o = JSON.parse(line); } catch { return []; }
  if (o?.type !== "assistant") return [];
  const m = o.message;
  if (!Array.isArray(m?.content)) return [];
  const ts = typeof o.timestamp === "string" ? o.timestamp : "";
  const cwd = typeof o.cwd === "string" ? o.cwd : "";
  const session = typeof o.sessionId === "string" ? o.sessionId : "";
  const model = typeof m.model === "string" ? m.model : "";
  const out: GrumbleRecord[] = [];
  for (const b of m.content) {
    if (b?.type === "text") {
      out.push(...answerRecords("claude", ts, typeof b.text === "string" ? b.text : "", { cwd, session, model }));
      continue;
    }
    if (b?.type !== "thinking") continue;
    const text = typeof b.thinking === "string" ? b.thinking.trim() : "";
    if (!text) continue;
    out.push({ id: recordId("claude", ts, text), source: "claude", ts, text, cwd, session, model });
  }
  return out;
}
