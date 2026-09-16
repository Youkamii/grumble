import { describe, expect, test } from "bun:test";
import { mask, projectNamesFromCwds } from "./mask.ts";
import { splitTitle, splitSentences, scoreSentence, bestSentence, classifyTarget } from "./score.ts";
import { select, truncate } from "./select.ts";
import { codexLine } from "./sources/codex.ts";
import { claudeLine } from "./sources/claude.ts";
import type { GrumbleRecord } from "./types.ts";

describe("mask", () => {
  test("windows/unix paths, urls, emails, ips, hashes", () => {
    const s = 'Found it in C:\\Users\\me\\Git\\proj\\src\\index.ts and /home/me/.codex/sessions/x.jsonl, see https://example.com/a?b=1 mail me@x.io host 192.168.0.7:8080 commit 8d829fd1a2';
    const m = mask(s);
    expect(m).not.toMatch(/Users\\me|home\/me|example\.com|me@x\.io|192\.168|8d829fd/);
    expect(m).toContain("[path]");
    expect(m).toContain("[url]");
    expect(m).toContain("[email]");
    expect(m).toContain("[ip]");
    expect(m).toContain("[hash]");
  });
  test("code spans, file names, env vars, secrets", () => {
    const m = mask("The `claude.cmd` wrapper reads SEOUL_OPENAPI_KEY from config.toml; token ghp_abcdefghijklmnop123");
    expect(m).toBe("The [code] wrapper reads [env] from [file]; token [secret]");
  });
  test("project names from cwd basenames, word boundary, case-insensitive", () => {
    const names = projectNamesFromCwds(["C:\\Users\\me\\Git\\hanbom-minhwa", "file:///C:/Users/me/Git/tail_broomstick", "C:\\Users\\me\\AppData\\Local\\Temp\\claude\\C--Users-me\\abc\\scratchpad"]);
    expect(names.has("hanbom-minhwa")).toBe(true);
    expect(names.has("tail_broomstick")).toBe(true);
    expect(names.has("scratchpad")).toBe(false);
    const m = mask("Hanbom-Minhwa hero broke again, the Broomstick tail too", { projectNames: names });
    expect(m).toBe("[project] hero broke again, the [project] tail too");
  });
  test("long quotes are hidden, short ones stay", () => {
    expect(mask('The user said "알아서 해" so I proceed')).toContain('"알아서 해"');
    expect(mask('The user said "please rewrite the whole thing from scratch" again')).toContain('"[quote]"');
    // 따옴표 사이(인용 바깥)를 인용으로 오인하지 않는다.
    expect(mask('try "과제명 A" with the data API, but we ran into "unexpected errors." Both fail.')).toBe('try "과제명 A" with the data API, but we ran into "unexpected errors." Both fail.');
  });
  test("korean text with path survives", () => {
    const m = mask("설정이 C:\\Users\\gkfkd\\.openclaw\\config.json 을 참조하고 있네요.");
    expect(m).toBe("설정이 [path] 을 참조하고 있네요.");
  });
});

describe("score", () => {
  test("title split", () => {
    expect(splitTitle("**Planning tests**\n\nI'm not sure this works.")).toEqual({ title: "Planning tests", body: "I'm not sure this works." });
    expect(splitTitle("**Only title**")).toEqual({ title: "Only title", body: "" });
  });
  test("sentence split keeps decimals and merges lowercase fragments", () => {
    const s = splitSentences("Version 1.2 fails again. Hmm, the user wants v2? Fine!");
    expect(s).toEqual(["Version 1.2 fails again.", "Hmm, the user wants v2?", "Fine!"]);
  });
  test("grumble beats plan", () => {
    const plan = scoreSentence("Next, I'll run the tests and report the results.");
    const grumble = scoreSentence("The output is garbled again, apparently the encoding is still wrong.");
    expect(grumble).toBeGreaterThan(plan);
    expect(plan).toBeLessThan(2);
  });
  test("korean grumble scores", () => {
    expect(scoreSentence("전역 CLI가 어젯밤 마이그레이션된 새 설정 파일을 거부하고 있네요.")).toBeGreaterThanOrEqual(2);
    expect(scoreSentence("이제 게이트웨이를 재시작하겠습니다.")).toBeLessThan(2);
  });
  test("best sentence and target", () => {
    const b = bestSentence("**Investigating encoding**\n\nNoticed garbled output again. I'll inspect the file with a hex viewer.");
    expect(b?.text).toBe("Noticed garbled output again.");
    expect(classifyTarget("the PowerShell command timed out again")).toBe("tool");
    expect(classifyTarget("The user insists on the old API")).toBe("user");
  });
});

describe("select", () => {
  const rec = (i: number, source: "codex" | "claude", text: string, cwd = "C:\\Users\\me\\Git\\myproj"): GrumbleRecord => ({
    id: `id${i}`, source, ts: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`, text, cwd, session: "s", model: "m",
  });
  test("recent first, per-source cap, dedupe, masking", () => {
    const recs = [
      rec(1, "codex", "**T**\n\nThe myproj build is broken again, ugh."),
      rec(2, "codex", "**T**\n\nThe myproj build is broken again, ugh."),
      rec(3, "codex", "Next I'll run the tests."),
      rec(4, "claude", "설정이 또 꼬여 있네요. 다시 확인하겠습니다."),
      rec(5, "codex", "Weirdly the command hangs in C:\\Users\\me\\Git\\myproj\\x.ps1."),
    ];
    const out = select(recs, { perSource: 5 });
    const codex = out.filter((o) => o.source === "codex");
    expect(codex.map((o) => o.id)).toEqual(["id5", "id2"]);
    expect(codex[0]!.text).toBe("Weirdly the command hangs in [path].");
    expect(codex[1]!.text).toBe("The [project] build is broken again, ugh.");
    expect(out.find((o) => o.source === "claude")?.text).toBe("설정이 또 꼬여 있네요.");
  });
  test("truncate", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdefg", 6)).toBe("abcde…");
  });
});

describe("sources", () => {
  test("codex reasoning summary with session_meta context", () => {
    const ctx = { cwd: "", session: "", model: "" };
    codexLine(JSON.stringify({ type: "session_meta", payload: { id: "sess1", cwd: "C:\\p" } }), ctx);
    codexLine(JSON.stringify({ type: "turn_context", payload: { model: "gpt-x" } }), ctx);
    const out = codexLine(JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", type: "response_item", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "**A**\n\nhmm" }, { type: "summary_text", text: "" }] } }), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "codex", cwd: "C:\\p", session: "sess1", model: "gpt-x", text: "**A**\n\nhmm" });
    expect(codexLine(JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { summary_text: [] } } }), ctx)).toEqual([]);
    // 제목뿐인 요약은 버린다.
    expect(codexLine(JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "**Planning tests**" }] } }), ctx)).toEqual([]);
  });
  test("claude thinking: empty ignored, body kept", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: "t", cwd: "C:\\q", sessionId: "s", message: { model: "claude-fable-5-1", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "thinking", thinking: "흠, 또 실패네요." }] } });
    const out = claudeLine(line);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "claude", text: "흠, 또 실패네요.", model: "claude-fable-5-1" });
  });
});
