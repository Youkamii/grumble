import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function recordId(source: string, ts: string, text: string): string {
  return createHash("sha1").update(`${source}\n${ts}\n${text}`).digest("hex").slice(0, 16);
}

export function codexSessionsDir(): string { return join(homedir(), ".codex", "sessions"); }
export function claudeProjectsDir(): string { return join(homedir(), ".claude", "projects"); }
export function stateDir(): string { return process.env.GRUMBLE_HOME ?? join(homedir(), ".grumble"); }
export function statePath(): string { return join(stateDir(), "state.json"); }
