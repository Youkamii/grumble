/**
 * publish: scan → render → public/ 이 바뀌었을 때만 commit·push.
 * register: Windows 예약 작업(6시간마다 = 하루 4회)을 창 없이 실행되게 등록.
 *   - wscript //B 로 VBS를 띄우고, VBS가 bun을 창 스타일 0(숨김)으로 실행한다. 콘솔 창이 한 번도 뜨지 않는다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scan, loadState, saveState } from "./scan.ts";
import { select } from "./select.ts";
import { renderSvg } from "./render.ts";
import { FontKit } from "./font.ts";
import { stateDir } from "./util.ts";

export const TASK_NAME = "grumble-publish";

export function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`;
  console.error(line);
  try {
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(join(stateDir(), "publish.log"), line + "\n");
  } catch { /* 로그 실패는 무시 */ }
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface RenderResult { items: number; files: Record<string, number> }

export function renderAll(repo: string, perSource = 3): RenderResult {
  const state = loadState();
  const items = select(state.records, { perSource });
  const pub = join(repo, "public");
  mkdirSync(pub, { recursive: true });
  const files: Record<string, number> = {};
  for (const theme of ["dark", "light"] as const) {
    const svg = renderSvg(items, theme, new FontKit());
    const file = join(pub, `grumble-${theme}.svg`);
    writeFileSync(file, svg);
    files[`public/grumble-${theme}.svg`] = svg.length;
  }
  // 공개 메타: 마스킹된 문장과 시각만. 원문·경로·세션 id는 넣지 않는다.
  writeFileSync(join(pub, "grumble.json"), JSON.stringify({
    renderedAt: new Date().toISOString(),
    items: items.map((s) => ({ source: s.source, ts: s.ts, text: s.text, target: s.target })),
  }, null, 2));
  return { items: items.length, files };
}

export async function publish(repo: string, opts: { push?: boolean } = {}): Promise<{ changed: boolean; pushed: boolean; items: number }> {
  const state = loadState();
  const s = await scan(state);
  saveState(state);
  log(`scan: read ${s.filesRead}/${s.filesSeen} files, +${s.added} records, total ${state.records.length}`);

  const r = renderAll(repo);
  log(`render: ${r.items} items, ${Object.entries(r.files).map(([f, b]) => `${f}=${b}B`).join(" ")}`);

  // SVG는 렌더 시각이 들어가지 않으므로 내용이 같으면 diff가 없다. grumble.json의 renderedAt만 바뀌는 경우는 발행하지 않는다.
  const status = git(["status", "--porcelain", "--", "public/grumble-dark.svg", "public/grumble-light.svg"], repo);
  if (!status) {
    git(["checkout", "--", "public/grumble.json"], repo);
    log("no change in svg; skip commit");
    return { changed: false, pushed: false, items: r.items };
  }
  git(["add", "public"], repo);
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  git(["commit", "-q", "-m", `grumble: update ${date} (${r.items} items)`], repo);
  log("committed");
  if (opts.push === false) return { changed: true, pushed: false, items: r.items };
  const out = spawnSync("git", ["push", "-q"], { cwd: repo, encoding: "utf8" });
  if (out.status !== 0) {
    log(`push failed: ${(out.stderr ?? "").trim()}`);
    return { changed: true, pushed: false, items: r.items };
  }
  log("pushed");
  return { changed: true, pushed: true, items: r.items };
}

/** 예약 작업 등록(Windows). 6시간 간격, 로그인 상태에서만, 창 없이. */
export function register(repo: string, bunPath: string): { vbs: string; output: string } {
  if (process.platform !== "win32") throw new Error("register는 Windows 예약 작업 전용이다. 다른 OS는 cron에 'bun run publish'를 등록하라.");
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const vbs = join(dir, "publish-hidden.vbs");
  const repoWin = resolve(repo);
  const script = [
    `' grumble 자동 발행. wscript //B 로 실행되며 bun을 숨김 창(0)으로 띄운다.`,
    `Set sh = CreateObject("WScript.Shell")`,
    `sh.CurrentDirectory = "${repoWin}"`,
    `sh.Run """${bunPath}"" run src/index.ts publish", 0, True`,
    ``,
  ].join("\r\n");
  writeFileSync(vbs, script);
  const tr = `wscript.exe //B //Nologo "${vbs}"`;
  const out = spawnSync("schtasks", ["/Create", "/F", "/TN", TASK_NAME, "/TR", tr, "/SC", "HOURLY", "/MO", "6", "/ST", "06:00"], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`schtasks failed: ${out.stderr || out.stdout}`);
  return { vbs, output: (out.stdout || "").trim() };
}
