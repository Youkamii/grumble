import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * JSON을 tmp에 쓰고 rename 하는 원자적 저장. 같은 파일에 동시에 쓰는 프로세스가 있어도 tmp가 겹치지 않도록
 * pid+시각을 붙인다. mode 0o600은 Unix에서만 유효하다(README 참조).
 */
export function saveJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, path);
}

/** 재미 판정에 쓰는 모델(judge.ts). 이 모델의 세션은 grumble 자신이 띄운 것이라 수집하지 않는다(sources/claude.ts). */
export const JUDGE_MODEL = "claude-haiku-4-5-20251001";

export function recordId(source: string, ts: string, text: string): string {
  return createHash("sha1").update(`${source}\n${ts}\n${text}`).digest("hex").slice(0, 16);
}

export function codexSessionsDir(): string { return join(homedir(), ".codex", "sessions"); }
export function claudeProjectsDir(): string { return join(homedir(), ".claude", "projects"); }
export function stateDir(): string { return process.env.GRUMBLE_HOME ?? join(homedir(), ".grumble"); }
export function statePath(): string { return join(stateDir(), "state.json"); }
export function configPath(): string { return join(stateDir(), "config.json"); }
export function syncStatePath(): string { return join(stateDir(), "sync.json"); }
export function remoteDir(): string { return join(stateDir(), "remote"); }
