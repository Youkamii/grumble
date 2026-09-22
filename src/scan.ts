/**
 * 증분 스캔. 파일별 커서(size/offset/mtime)를 state에 두고 변경된 파일의 새 바이트만 읽는다.
 * Codex 세션 폴더가 수십 GB이므로 전체 재스캔은 금지. 첫 실행만 전체.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { GrumbleRecord, State } from "./types.ts";
import { codexLine, type CodexCtx } from "./sources/codex.ts";
import { claudeLine } from "./sources/claude.ts";
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
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
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
  /** 기본 루트 외에 더 읽을 폴더(원격 기계에서 받아온 사본 등). */
  extraRoots?: Array<{ root: string; kind: "codex" | "claude"; host?: string }>;
  log?: (msg: string) => void;
}

export interface ScanSummary { filesSeen: number; filesRead: number; added: number; duplicates: number }

export async function scan(state: State, opts: ScanOptions = {}): Promise<ScanSummary> {
  const log = opts.log ?? (() => {});
  const seen = new Set(state.records.map((r) => r.id));
  const summary: ScanSummary = { filesSeen: 0, filesRead: 0, added: 0, duplicates: 0 };
  const fresh: GrumbleRecord[] = [];

  const push = (recs: GrumbleRecord[], host?: string) => {
    for (const r of recs) {
      if (seen.has(r.id)) { summary.duplicates++; continue; }
      seen.add(r.id);
      fresh.push(host ? { ...r, host } : r);
      summary.added++;
    }
  };

  const sources = [
    { root: opts.codexRoot ?? codexSessionsDir(), kind: "codex" as const, host: undefined as string | undefined },
    { root: opts.claudeRoot ?? claudeProjectsDir(), kind: "claude" as const, host: undefined as string | undefined },
    ...(opts.extraRoots ?? []),
  ].filter(({ root }) => existsSync(root));
  const targets = sources.flatMap(({ root, kind, host }) => listJsonl(root).map((file) => ({ file, kind, host })));

  for (const { file, kind, host } of targets) {
    summary.filesSeen++;
    let st;
    try { st = statSync(file); } catch { continue; }
    const cur = state.files[file];
    if (cur && cur.size === st.size && cur.mtimeMs === st.mtimeMs) continue;
    // 크기가 줄었으면 재작성된 파일 → 처음부터.
    const offset = cur && cur.size <= st.size ? cur.offset : 0;
    summary.filesRead++;
    const ctx: CodexCtx = offset > 0 && cur?.ctx ? { ...cur.ctx } : { cwd: "", session: "", model: "" };
    const consumed = await readNewLines(file, offset, st.size, (line) => {
      push(kind === "codex" ? codexLine(line, ctx) : claudeLine(line), host);
    });
    state.files[file] = { size: st.size, offset: consumed, mtimeMs: st.mtimeMs, ctx: kind === "codex" ? ctx : undefined };
    if (summary.filesRead % 100 === 0) log(`read ${summary.filesRead} files, +${summary.added}`);
  }

  // 존재하는 소스 루트 안에서 사라진 파일의 커서만 정리.
  const alive = new Set(targets.map((t) => t.file));
  for (const file of Object.keys(state.files)) {
    if (alive.has(file)) continue;
    const inScannedRoot = sources.some(({ root }) => {
      const rel = relative(root, file);
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    });
    if (inScannedRoot) delete state.files[file];
  }

  // 소스별 상한. 한 소스의 대량 기록이 다른 소스를 밀어내지 않도록 따로 자른다.
  const all = [...state.records, ...fresh].sort((a, b) => a.ts.localeCompare(b.ts));
  const kept: GrumbleRecord[] = [];
  for (const src of ["codex", "claude"] as const) kept.push(...all.filter((r) => r.source === src).slice(-MAX_RECORDS));
  state.records = kept.sort((a, b) => a.ts.localeCompare(b.ts));
  state.scannedAt = new Date().toISOString();
  return summary;
}
