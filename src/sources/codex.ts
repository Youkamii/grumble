/**
 * Codex CLI 세션(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) → reasoning summary.
 * 레코드 형태:
 *   {"timestamp":"...","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"..."}]}}
 * cwd/session id는 파일 앞부분 session_meta.payload 에, 모델은 turn_context.payload.model 에 있다.
 */
import type { GrumbleRecord } from "../types.ts";
import { recordId } from "../util.ts";

export const CODEX_MARKER = '"summary_text"';

export interface CodexCtx { cwd: string; session: string; model: string }

export function codexLine(line: string, ctx: CodexCtx): GrumbleRecord[] {
  if (line.includes('"session_meta"')) {
    try {
      const o = JSON.parse(line);
      const p = o?.payload;
      if (o?.type === "session_meta" && p) {
        if (typeof p.cwd === "string") ctx.cwd = p.cwd;
        if (typeof p.id === "string") ctx.session = p.id;
      }
    } catch { /* skip */ }
    return [];
  }
  if (line.includes('"turn_context"')) {
    try {
      const o = JSON.parse(line);
      if (o?.type === "turn_context" && typeof o?.payload?.model === "string") ctx.model = o.payload.model;
    } catch { /* skip */ }
    return [];
  }
  if (!line.includes(CODEX_MARKER) || !line.includes('"response_item"')) return [];
  let o: any;
  try { o = JSON.parse(line); } catch { return []; }
  const p = o?.payload;
  if (o?.type !== "response_item" || p?.type !== "reasoning" || !Array.isArray(p.summary)) return [];
  const ts = typeof o.timestamp === "string" ? o.timestamp : "";
  const out: GrumbleRecord[] = [];
  for (const s of p.summary) {
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    if (!text) continue;
    out.push({ id: recordId("codex", ts, text), source: "codex", ts, text, cwd: ctx.cwd, session: ctx.session, model: ctx.model });
  }
  return out;
}
