/**
 * 증분 스캔. 파일별 커서(size/offset/mtime)를 state에 두고 변경된 파일의 새 바이트만 읽는다.
 * Codex 세션 폴더가 수십 GB이므로 전체 재스캔은 금지. 첫 실행만 전체.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { GrumbleRecord, State } from "./types.ts";
import { codexLine, CODEX_MARKER, type CodexCtx } from "./sources/codex.ts";
import { claudeLine, CLAUDE_MARKER } from "./sources/claude.ts";
import { codexSessionsDir, claudeProjectsDir, stateDir, statePath } from "./util.ts";

export const MAX_RECORDS = 5000;

export function emptyState(): State {
  return { version: 1, scannedAt: null, files: {}, records: [] };
}

export function loadState(path = statePath()): State {
  if (!existsSync(path)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    if (s?.version === 1 && Array.isArray(s.records) && s.files) return s as State;
  } catch { /* corrupted → fresh */ }
  return emptyState();
}

export function saveState(state: State, path = statePath()): void {
  mkdirSync(stateDir(), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

export function listJsonl(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith(".jsonl"))
    .map((p) => join(root, p));
}

/**
 * 파일의 offset 이후를 줄 단위로 읽는다. 마지막 줄이 개행 없이 끝나면(쓰는 중) 그 줄은 소비하지 않고
 * 다음 회차로 넘긴다. 반환값은 소비한 바이트 오프셋.
 */
export async function readNewLines(
  file: string,
  offset: number,
  size: number,
  onLine: (line: string) => void,
): Promise<number> {
  if (size <= offset) return offset;
  const stream = createReadStream(file, { start: offset, end: size - 1, highWaterMark: 1 << 20 });
  let consumed = offset;
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let nl: number;
    while ((nl = pending.indexOf(10)) >= 0) {
      const lineBuf = pending.subarray(0, nl);
      pending = pending.subarray(nl + 1);
      consumed += nl + 1;
      onLine(lineBuf.toString("utf8"));
    }
  }
  return consumed;
}

export interface ScanOptions {
  codexRoot?: string;
  claudeRoot?: string;
  log?: (msg: string) => void;
}

export interface ScanSummary { filesSeen: number; filesRead: number; added: number; duplicates: number }

export async function scan(state: State, opts: ScanOptions = {}): Promise<ScanSummary> {
  const log = opts.log ?? (() => {});
  const seen = new Set(state.records.map((r) => r.id));
  const summary: ScanSummary = { filesSeen: 0, filesRead: 0, added: 0, duplicates: 0 };
  const fresh: GrumbleRecord[] = [];

  const push = (recs: GrumbleRecord[]) => {
    for (const r of recs) {
      if (seen.has(r.id)) { summary.duplicates++; continue; }
      seen.add(r.id);
      fresh.push(r);
      summary.added++;
    }
  };

  const targets: Array<{ file: string; kind: "codex" | "claude" }> = [
    ...listJsonl(opts.codexRoot ?? codexSessionsDir()).map((file) => ({ file, kind: "codex" as const })),
    ...listJsonl(opts.claudeRoot ?? claudeProjectsDir()).map((file) => ({ file, kind: "claude" as const })),
  ];

  for (const { file, kind } of targets) {
    summary.filesSeen++;
    let st;
    try { st = statSync(file); } catch { continue; }
    const cur = state.files[file];
    if (cur && cur.size === st.size && cur.mtimeMs === st.mtimeMs) continue;
    // 크기가 줄었으면 재작성된 파일 → 처음부터.
    const offset = cur && cur.size <= st.size ? cur.offset : 0;
    summary.filesRead++;
    const ctx: CodexCtx = { cwd: "", session: "", model: "" };
    // Codex는 cwd/model이 파일 앞줄에만 있어 증분 읽기 시 컨텍스트가 없다 → 헤더만 다시 읽는다.
    if (kind === "codex" && offset > 0) await readHeader(file, ctx);
    const consumed = await readNewLines(file, offset, st.size, (line) => {
      if (kind === "codex") { push(codexLine(line, ctx)); return; }
      if (line.includes(CLAUDE_MARKER)) push(claudeLine(line));
    });
    state.files[file] = { size: st.size, offset: consumed, mtimeMs: st.mtimeMs };
    if (summary.filesRead % 100 === 0) log(`read ${summary.filesRead} files, +${summary.added}`);
  }

  // 사라진 파일의 커서는 정리.
  const alive = new Set(targets.map((t) => t.file));
  for (const k of Object.keys(state.files)) if (!alive.has(k)) delete state.files[k];

  state.records = [...state.records, ...fresh]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-MAX_RECORDS);
  state.scannedAt = new Date().toISOString();
  return summary;
}

async function readHeader(file: string, ctx: CodexCtx): Promise<void> {
  const input = createReadStream(file, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const rl = createInterface({ input });
  let n = 0;
  for await (const line of rl) {
    codexLine(line, ctx);
    if (++n >= 5 || (ctx.cwd && ctx.model)) break;
  }
  rl.close();
  input.destroy();
}

export { CODEX_MARKER };
