#!/usr/bin/env bun
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
  console.log("usage: grumble <scan|render|publish>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
