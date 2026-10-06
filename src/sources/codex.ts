/**
 * Codex CLI 세션(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) → reasoning summary + 답변 본문의 정정·자백.
 * 레코드 형태:
 *   {"timestamp":"...","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"..."}]}}
 *   {"timestamp":"...","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
 * cwd/session id는 파일 앞부분 session_meta.payload 에, 모델은 turn_context.payload.model 에 있다.
 * event_msg의 agent_message는 response_item과 같은 내용의 복사본이라 보지 않는다.
 */
import type { GrumbleRecord } from "../types.ts";
import { recordId } from "../util.ts";
import { confessionSentences } from "./confession.ts";

export const CODEX_MARKER = '"summary_text"';
export const CODEX_TEXT_MARKER = '"output_text"';

export interface CodexCtx { cwd: string; session: string; model: string }

export function codexLine(line: string, ctx: CodexCtx): GrumbleRecord[] {
  const hasContext = /"type"\s*:\s*"(?:session_meta|turn_context)"/.test(line);
  if (!hasContext && (!line.includes('"response_item"') || (!line.includes(CODEX_MARKER) && !line.includes(CODEX_TEXT_MARKER)))) return [];
  let o: any;
  try { o = JSON.parse(line); } catch { return []; }
  const p = o?.payload;
  if (o?.type === "session_meta") {
    if (typeof p?.cwd === "string") ctx.cwd = p.cwd;
    if (typeof p?.id === "string") ctx.session = p.id;
    return [];
  }
  if (o?.type === "turn_context") {
    if (typeof p?.model === "string") ctx.model = p.model;
    // 매 턴 cwd가 실려 오므로 session_meta를 못 본 증분 읽기(구버전 커서)에서도 복구된다.
    if (typeof p?.cwd === "string" && p.cwd) ctx.cwd = p.cwd;
    return [];
  }
  if (o?.type !== "response_item") return [];
  const ts = typeof o.timestamp === "string" ? o.timestamp : "";
  const out: GrumbleRecord[] = [];
  if (p?.type === "message" && p.role === "assistant" && Array.isArray(p.content)) {
    for (const c of p.content) {
      if (c?.type !== "output_text" || typeof c.text !== "string") continue;
      for (const text of confessionSentences(c.text)) {
        out.push({ id: recordId("codex", ts, text), source: "codex", ts, text, cwd: ctx.cwd, session: ctx.session, model: ctx.model, kind: "confession" });
      }
    }
    return out;
  }
  if (p?.type !== "reasoning" || !Array.isArray(p.summary)) return [];
  for (const s of p.summary) {
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    if (!text) continue;
    // "**Planning tests**" 처럼 굵은 제목 한 줄뿐인 요약은 속마음이 아니라 진행 상태 표시다. 버린다.
    if (/^\*\*[^*\n]{1,200}\*\*\s*$/.test(text)) continue;
    out.push({ id: recordId("codex", ts, text), source: "codex", ts, text, cwd: ctx.cwd, session: ctx.session, model: ctx.model });
  }
  return out;
}
