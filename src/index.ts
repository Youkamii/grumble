#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { scan, loadState, saveState } from "./scan.ts";
import { statePath } from "./util.ts";

const cmd = process.argv[2] ?? "help";

async function main(): Promise<void> {
  if (cmd === "scan") {
    const state = loadState();
    const t0 = Date.now();
    const s = await scan(state, { log: (m) => console.error(m) });
    saveState(state);
    console.log(JSON.stringify({ ...s, total: state.records.length, ms: Date.now() - t0, state: statePath() }));
    return;
  }
  if (cmd === "preview") {
    // 실데이터로 선별 결과를 눈으로 확인하는 용도. 공개물과 같은 마스킹을 거친다.
    const { select, DEFAULT_PER_SOURCE } = await import("./select.ts");
    const state = loadState();
    const n = Number(process.argv[3] ?? DEFAULT_PER_SOURCE);
    for (const s of select(state.records, { perSource: n })) {
      console.log(`[${s.source}] ${s.ts.slice(0, 16)} (${s.score}/${s.target}) ${s.text}`);
    }
    return;
  }
  const repo = fileURLToPath(new URL("..", import.meta.url));

  if (cmd === "render") {
    const { renderAll } = await import("./publish.ts");
    const { DEFAULT_PER_SOURCE } = await import("./select.ts");
    console.log(JSON.stringify(renderAll(repo, Number(process.argv[3] ?? DEFAULT_PER_SOURCE))));
    return;
  }
  if (cmd === "publish") {
    const { publish } = await import("./publish.ts");
    const r = await publish(repo, { push: !process.argv.includes("--no-push") });
    console.log(JSON.stringify(r));
    return;
  }
  if (cmd === "register") {
    const { register } = await import("./publish.ts");
    const r = register(repo, process.execPath);
    console.log(JSON.stringify(r));
    return;
  }
  if (cmd === "unregister") {
    console.log((await import("./publish.ts")).unregister());
    return;
  }
  console.log("usage: grumble <scan|preview|render|publish [--no-push]|register|unregister>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
