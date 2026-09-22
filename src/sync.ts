/**
 * 다른 기계의 에이전트 로그를 이 PC로 가져온다.
 *
 * 원격에서 하는 일은 읽기뿐이다: `whoami`, `find … -print0`, `tar czf -`.
 * 원격 파일을 지우거나 고치는 명령은 절대 보내지 않는다.
 * 받은 tar는 `~/.grumble/remote/<host>/{claude,codex}/` 에 단순 덮어쓰기로 푼다.
 * 원격에서 파일이 사라져도 로컬 사본은 남는다(과거 기록을 잃지 않기 위해 의도한 동작).
 *
 * 증분: `~/.grumble/sync.json` 에 host별 마지막 동기 시각을 두고, 두 번째 회차부터는
 * `find -newermt <그 시각>` 으로 바뀐 .jsonl만 tar에 담는다. 첫 회는 전체.
 * `-newermt` 를 못 알아듣는 find(구형·BSD 일부)면 그 회차는 전체 전송으로 떨어진다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configPath, remoteDir, stateDir, syncStatePath } from "./util.ts";

export interface RemoteConfig {
  /** ssh 별칭 또는 user@host. ssh 설정에 무비밀번호로 잡혀 있어야 한다. */
  host: string;
  /** 원격 Claude Code 프로젝트 폴더. 기본 ~/.claude/projects. null/""이면 건너뛴다. */
  claude?: string;
  /** 원격 Codex 세션 폴더. 기본 ~/.codex/sessions. null/""이면 건너뛴다. */
  codex?: string;
}

export interface GrumbleConfig { remotes: RemoteConfig[] }

export interface SyncState {
  version: 1;
  hosts: Record<string, { at?: string; user?: string }>;
}

export type SourceKind = "claude" | "codex";

export const DEFAULT_REMOTE_PATHS: Record<SourceKind, string> = {
  claude: "~/.claude/projects",
  codex: "~/.codex/sessions",
};

/** ssh 1회 타임아웃(ms). 51MB짜리 전체 전송도 이 안에 끝나야 한다. */
export const SSH_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER = 1 << 29; // 512MB

export function loadConfig(path = configPath()): GrumbleConfig {
  if (!existsSync(path)) return { remotes: [] };
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    const remotes = Array.isArray(o?.remotes) ? o.remotes : [];
    return {
      remotes: remotes
        .filter((r: any) => typeof r?.host === "string" && r.host.trim())
        .map((r: any) => ({
          host: String(r.host).trim(),
          ...(r.claude === undefined ? {} : { claude: r.claude }),
          ...(r.codex === undefined ? {} : { codex: r.codex }),
        })),
    };
  } catch { return { remotes: [] }; }
}

export function loadSyncState(path = syncStatePath()): SyncState {
  if (!existsSync(path)) return { version: 1, hosts: {} };
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    if (o?.version === 1 && o.hosts && typeof o.hosts === "object") return o as SyncState;
  } catch { /* 깨졌으면 처음부터 */ }
  return { version: 1, hosts: {} };
}

export function saveSyncState(s: SyncState, path = syncStatePath()): void {
  mkdirSync(stateDir(), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** 원격 경로를 `cd` 대상(부모)과 tar에 넣을 상대 디렉터리로 나눈다. `~`는 `$HOME`으로. */
export function splitRemotePath(p: string): { parent: string; dir: string } {
  const clean = p.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  const dir = i < 0 ? clean : clean.slice(i + 1);
  let parent = i < 0 ? "." : clean.slice(0, i) || "/";
  if (parent === "~") parent = "$HOME";
  else if (parent.startsWith("~/")) parent = "$HOME/" + parent.slice(2);
  return { parent, dir };
}

/** POSIX 셸 작은따옴표 인용. 원격 명령 문자열을 조립할 때 쓴다. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 원격에서 실행할 tar 명령. since가 있으면 그 시각 이후 .jsonl만.
 * parent는 `$HOME` 확장을 살려야 하므로 통째로 인용하지 않고 `"` 로 감싼다.
 */
export function remoteTarCommand(remotePath: string, since?: string): string {
  const { parent, dir } = splitRemotePath(remotePath);
  const cd = `cd "${parent}" || exit 3`;
  if (!since) return `${cd}; tar czf - ${shq(dir)}`;
  return `${cd}; find ${shq(dir)} -name '*.jsonl' -newermt ${shq(since)} -print0 | tar czf - --null -T -`;
}

export interface SshRunner {
  (host: string, command: string): { ok: boolean; stdout: Buffer; stderr: string; status: number | null };
}

export const sshRun: SshRunner = (host, command) => {
  const r = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command],
    { timeout: SSH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
  );
  const stdout: Buffer = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0);
  const stderr = r.stderr ? r.stderr.toString("utf8").trim() : (r.error?.message ?? "");
  return { ok: r.status === 0 && !r.error, stdout, stderr, status: r.status };
};

/**
 * 로컬 tar 로 .tgz를 dest에 푼다. Windows 내장 tar(bsdtar)도 gz를 읽는다.
 * 인자에 절대경로를 주지 않는 이유: Git Bash의 GNU tar는 `C:\…` 를 원격 호스트 스펙으로 읽어
 * "Cannot connect to C" 로 죽는다. 아카이브를 dest 안에 두고 cwd 기준 상대 이름으로 부른다.
 */
function localTar(args: string[], cwd: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("tar", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true });
  if (r.status === 0 && !r.error) return { ok: true, out: r.stdout ?? "", err: "" };
  return { ok: false, out: r.stdout ?? "", err: (r.stderr ?? "").trim() || r.error?.message || `tar exit ${r.status}` };
}

export interface SyncSourceResult {
  host: string;
  kind: SourceKind;
  /** 전체 전송이면 "full", 증분이면 "incremental" */
  mode: "full" | "incremental";
  ok: boolean;
  bytes: number;
  files: number;
  ms: number;
  error?: string;
}

export interface SyncResult {
  results: SyncSourceResult[];
  hosts: number;
  bytes: number;
  files: number;
  ms: number;
}

export interface SyncOptions {
  log?: (msg: string) => void;
  run?: SshRunner;
  syncPath?: string;
  configPath?: string;
  /** 증분을 무시하고 전체를 다시 받는다. */
  full?: boolean;
  now?: () => Date;
}

/** tar 목록에서 파일 수를 센다(로그용). 실패하면 -1. */
function countEntries(dir: string, name: string): number {
  const r = localTar(["tzf", name], dir);
  if (!r.ok) return -1;
  return r.out.split("\n").filter((l) => l.trim() && !l.trim().endsWith("/")).length;
}

export function sync(opts: SyncOptions = {}): SyncResult {
  const log = opts.log ?? (() => {});
  const run = opts.run ?? sshRun;
  const now = opts.now ?? (() => new Date());
  const cfg = loadConfig(opts.configPath ?? configPath());
  const st = loadSyncState(opts.syncPath ?? syncStatePath());
  const t0 = Date.now();
  const results: SyncSourceResult[] = [];

  if (!cfg.remotes.length) {
    log("sync: no remotes configured (~/.grumble/config.json)");
    return { results, hosts: 0, bytes: 0, files: 0, ms: 0 };
  }

  for (const remote of cfg.remotes) {
    const host = remote.host;
    const entry = st.hosts[host] ?? {};
    // 계정명은 마스킹 후보로 쓴다(원격 경로 /home/<user>/… 가 문장에 섞여 나온다).
    const who = run(host, "whoami");
    if (who.ok) {
      const user = who.stdout.toString("utf8").trim();
      if (user && /^[\w.-]{1,64}$/.test(user)) entry.user = user;
    } else {
      log(`sync: ${host} unreachable (${who.stderr || `exit ${who.status}`}); skipping`);
      st.hosts[host] = entry;
      continue;
    }

    const startedAt = now().toISOString();
    let hostOk = true;
    for (const kind of ["claude", "codex"] as const) {
      const raw = remote[kind] === undefined ? DEFAULT_REMOTE_PATHS[kind] : remote[kind];
      if (!raw) continue;
      const since = opts.full ? undefined : entry.at;
      const r0 = Date.now();
      let mode: "full" | "incremental" = since ? "incremental" : "full";
      let out = run(host, remoteTarCommand(raw, since));
      if (!out.ok && since) {
        // 구형/BSD find가 -newermt 를 모르면 전체로 떨어진다.
        log(`sync: ${host}/${kind} incremental failed (${out.stderr || `exit ${out.status}`}); retrying full`);
        mode = "full";
        out = run(host, remoteTarCommand(raw, undefined));
      }
      if (!out.ok) {
        // 원격에 그 폴더가 아예 없는 경우(exit 3)는 정상적인 '없음'이다.
        const msg = out.stderr || `exit ${out.status}`;
        hostOk = false;
        results.push({ host, kind, mode, ok: false, bytes: 0, files: 0, ms: Date.now() - r0, error: msg });
        log(`sync: ${host}/${kind} failed: ${msg}`);
        continue;
      }
      const bytes = out.stdout.length;
      if (bytes === 0) {
        results.push({ host, kind, mode, ok: true, bytes: 0, files: 0, ms: Date.now() - r0 });
        continue;
      }
      const dest = join(remoteDir(), host.replace(/[^\w.-]/g, "_"), kind);
      mkdirSync(dest, { recursive: true });
      const name = ".grumble-incoming.tgz";
      const tgz = join(dest, name);
      writeFileSync(tgz, out.stdout, { mode: 0o600 });
      const files = countEntries(dest, name);
      const ex = localTar(["xzf", name], dest);
      try { rmSync(tgz, { force: true }); } catch { /* 임시파일 정리 실패는 무시 */ }
      if (!ex.ok) {
        hostOk = false;
        results.push({ host, kind, mode, ok: false, bytes, files: 0, ms: Date.now() - r0, error: ex.err });
        log(`sync: ${host}/${kind} extract failed: ${ex.err}`);
        continue;
      }
      results.push({ host, kind, mode, ok: true, bytes, files: Math.max(files, 0), ms: Date.now() - r0 });
      log(`sync: ${host}/${kind} ${mode} ${files < 0 ? "?" : files} files, ${bytes}B, ${Date.now() - r0}ms`);
    }
    // 한 소스라도 실패했으면 커서를 전진시키지 않는다(놓친 변경분을 다음 회차에 다시 받게).
    if (hostOk) entry.at = startedAt;
    st.hosts[host] = entry;
  }

  saveSyncState(st, opts.syncPath ?? syncStatePath());
  const bytes = results.reduce((a, r) => a + r.bytes, 0);
  const files = results.reduce((a, r) => a + r.files, 0);
  return { results, hosts: cfg.remotes.length, bytes, files, ms: Date.now() - t0 };
}

/** scan에 넘길 추가 루트. 로컬에 실제로 받아둔 폴더만 돌려준다. */
export function remoteRoots(cfg = loadConfig()): Array<{ root: string; kind: SourceKind; host: string }> {
  const out: Array<{ root: string; kind: SourceKind; host: string }> = [];
  for (const remote of cfg.remotes) {
    const safe = remote.host.replace(/[^\w.-]/g, "_");
    for (const kind of ["claude", "codex"] as const) {
      if (remote[kind] === null || remote[kind] === "") continue;
      const root = join(remoteDir(), safe, kind);
      if (existsSync(root)) out.push({ root, kind, host: remote.host });
    }
  }
  return out;
}

/**
 * 마스킹에 합칠 원격 이름들: config의 host 별칭, sync 때 받아둔 원격 계정명,
 * 그리고 defaultNames()와 같은 규칙의 짧은 꼬리(lia-s1 → s1).
 */
export function configNames(cfg = loadConfig(), st = loadSyncState()): Set<string> {
  const out = new Set<string>();
  const add = (v: string | undefined) => {
    const t = (v ?? "").trim();
    if (t.length >= 2 && !/^[\d.]+$/.test(t)) out.add(t);
  };
  const addHost = (h: string) => {
    // user@host 형태면 양쪽 다 이름이다.
    for (const part of h.split("@")) {
      add(part);
      const tail = part.match(/-([a-z]{1,3}\d{1,2})$/i);
      if (tail) add(tail[1]!);
    }
  };
  for (const r of cfg.remotes) addHost(r.host);
  for (const [host, info] of Object.entries(st.hosts ?? {})) {
    addHost(host);
    add(info?.user);
  }
  return out;
}
