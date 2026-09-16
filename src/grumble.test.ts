import { describe, expect, spyOn, test } from "bun:test";
import * as masking from "./mask.ts";
import { mask, projectNamesFromCwds } from "./mask.ts";
import { splitTitle, splitSentences, scoreSentence, bestSentence, classifyTarget } from "./score.ts";
import { select, truncate, DEFAULT_PER_SOURCE, type Selected } from "./select.ts";
import { FontKit } from "./font.ts";
import { buildTimeline, renderSvg, THEMES } from "./render.ts";
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
    // basename 전체만 후보로 삼아 Broomstick·Hanbom 같은 부분 이름의 오탐을 막는다.
    const m = mask("Hanbom-Minhwa and tail_broomstick broke again, Broomstick and Hanbom too", { projectNames: names });
    expect(m).toBe("[project] and [project] broke again, Broomstick and Hanbom too");
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
  // 기대 출력은 bun -e로 현재 mask()를 직접 실행해 확인했다.
  test.each([
    ["F1: Windows path with company name", "C:\\Users\\gkfkd\\OneDrive - 주식회사에이콘\\고객명부", "[path]"],
    ["F2: Windows path keeps final punctuation", "C:\\Users\\gkfkd\\Git\\한봄 민화\\notes.", "[path]."],
    ["F3: Korean single quote", "사용자가 'prod DB의 고객 테이블을 전부 지워달라' 고 했다", "사용자가 '[quote]' 고 했다"],
    ["F4: inch mark before a long quote", 'He said 5" x and then "delete every customer record from the acme prod db" ok', 'He said 5" x and then "[quote]" ok'],
    ["F5: long hash", "서명 " + "0123456789abcdef".repeat(8) + " 불일치", "서명 [hash] 불일치"],
    ["F6: Unicode Unix path", "/home/사용자/문서/비밀메모", "[path]"],
    ["F6: home-relative path", "~/.grumble", "[path]"],
    ["F6: non-path slashes", "and/or 1/2", "and/or 1/2"],
    ["F7: bare hostname", "admin.acme-internal.example.com", "[url]"],
    ["F7: hostname with path", "corp.io/panel", "[url]"],
    ["F7: filename", "README.md", "[file]"],
    ["F8: issue number", "#36", "#[n]"],
    ["F8: longer issue number", "#115", "#[n]"],
    ["F8: shell variable", "$api_key", "[env]"],
    ["F8: braced shell variable", "${OPENAI_API_KEY}", "[env]"],
    ["F8: extensionless sensitive file", "id_rsa", "[file]"],
    ["F8: dotenv variant", ".env.local", "[file]"],
    ["F9: JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123", "[secret]"],
    ["F9: token count and date", "10000000 20260916", "10000000 20260916"],
    ["F11: apostrophe", "I can't do it", "I can't do it"],
    ["32-character random token", "z9Yx8Wv7Ut6Sr5Qp4On3Ml2Kj1Ih0GfE", "[secret]"],
    ["prefixed token", "ghp_abcdefghijklmnop123", "[secret]"],
    // 2차 검수에서 추가된 미탐·오탐 (고정값은 유출 여부 기준으로 사람이 정했다)
    ["R1: Korean filename", "고객명부.xlsx 파일이 깨졌다", "[file] 파일이 깨졌다"],
    ["R1: Korean filename with underscore", "계약서_최종.docx 를 다시 저장", "[file] 를 다시 저장"],
    ["R1: product names are not files", "Next.js 프로젝트와 Node.js 버전", "Next.js 프로젝트와 Node.js 버전"],
    ["R4: Korean slash is not a path", "프론트/백엔드 구조가 이상하다", "프론트/백엔드 구조가 이상하다"],
    ["R4: Korean slash 2", "읽기/쓰기 권한이 꼬였다", "읽기/쓰기 권한이 꼬였다"],
    ["R4: real unix path after Korean word", "설정은 /etc/ssh/sshd_config 에 있다", "설정은 [path] 에 있다"],
    ["R5: ssh remote", "git@github.com:Someone/secret-repo.git 를 클론했다", "[url] 를 클론했다"],
    ["R5: owner/repo.git", "Someone/secret-repo.git 리포", "[url] 리포"],
    ["R5: github.com slug", "github.com/Someone/secret-repo 에 푸시", "[url] 에 푸시"],
    ["R6: path does not swallow later backslash escape", "C:\\Users\\me\\Git\\proj 에서 bun test 를 돌렸고 \\n 이 또 나왔다", "[path] 에서 bun test 를 돌렸고 \\n 이 또 나왔다"],
    ["R6: spaced segment still masked", "C:\\Users\\me\\OneDrive - 회사명\\고객\\a.txt 열기", "[path] 열기"],
  ])("%s", (_label, input, expected) => {
    expect(mask(input)).toBe(expected);
  });
  test("F10: account and host aliases", () => {
    expect(mask("계정 gkfkd 로 로그인하면 lia-s1 과 s1 이 또 실패", { names: ["gkfkd", "lia-s1", "s1"] }))
      .toBe("계정 [name] 로 로그인하면 [name] 과 [name] 이 또 실패");
  });
  test("F11: a compound project name does not mask Python", () => {
    const projectNames = projectNamesFromCwds(["C:\\Git\\PYTHON-template"]);
    expect(mask("use a Python script", { projectNames })).toBe("use a Python script");
  });
  test.each([['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"]])(
    "quotes %s%s mask at 24 characters",
    (open, close) => {
      const short = `said ${open}${"가".repeat(23)}${close} again`;
      expect(mask(short)).toBe(short);
      expect(mask(`said ${open}${"가".repeat(24)}${close} again`)).toBe(`said ${open}[quote]${close} again`);
    },
  );
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
  test("weirdly and 또다시 do not get duplicate points", () => {
    expect(scoreSentence("The result is weirdly formatted today.")).toBe(3);
    expect(scoreSentence("The result is weirdly formatted today.")).toBe(scoreSentence("The result is weird today."));
    expect(scoreSentence("오늘 출력 결과를 또다시 하나씩 살펴보고 있는 상태다."))
      .toBe(scoreSentence("오늘 출력 결과를 다시 하나씩 살펴보고 있는 상태다."));
  });
  test("F11: 허용 and 또는 get no incidental cue points", () => {
    expect(scoreSentence("이 설정은 모든 작업을 허용하도록 구성되어 있다."))
      .toBe(scoreSentence("이 설정은 모든 작업을 승인하도록 구성되어 있다."));
    expect(scoreSentence("입력값은 문자열 또는 숫자 중에서 고를 수 있다."))
      .toBe(scoreSentence("입력값은 문자열 그리고 숫자 중에서 고를 수 있다."));
  });
  test.each(["또 ", "또, ", "또. ", "오늘 또 "])("standalone 또 in %s gets points", (prefix) => {
    // 비교 문장도 25자 이상으로 맞춰 길이 감점의 영향을 제외한다.
    const body = "출력 결과를 처음부터 끝까지 하나씩 살펴보고 있는 상태다.";
    expect(scoreSentence(prefix + body)).toBe(scoreSentence(body) + 2);
  });
  test.each([
    ["I overlooked the configuration value.", "self"],
    ["내가 그 설정을 실수로 다르게 이해한 상태였다는 사실을 알았다.", "self"],
    ["They asked for the previous configuration.", "user"],
    ["사용자가 입력한 설정값을 그대로 화면에 표시했다.", "user"],
  ] as const)("shared self/user cues: %s", (sentence, target) => {
    // 공유 규칙은 영어·한국어 모두 2점으로 적용한다.
    expect(scoreSentence(sentence)).toBe(2);
    expect(classifyTarget(sentence)).toBe(target);
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
  test("defaults to three items per source and accepts an override", () => {
    const recs = (["codex", "claude"] as const).flatMap((source, sourceIndex) =>
      Array.from({ length: 4 }, (_, i) => rec(sourceIndex * 4 + i + 1, source, `Hmm, ${source} output ${i} is broken again.`)),
    );
    expect(DEFAULT_PER_SOURCE).toBe(3);
    const out = select(recs);
    expect(out.map((item) => item.id)).toEqual(["id8", "id7", "id6", "id4", "id3", "id2"]);
    expect(select(recs, { perSource: 1 }).map((item) => item.id)).toEqual(["id8", "id4"]);
  });
  test("merges default and extra names without changing cached defaults", () => {
    const defaults = new Set(["default-account"]);
    const getNames = spyOn(masking, "defaultNames").mockReturnValue(defaults);
    try {
      const text = "Hmm, default-account and extra-alias still broke the myproj build.";
      const out = select([rec(1, "codex", text)], { extraNames: ["extra-alias"] });
      expect(out[0]?.text).toBe("Hmm, [name] and [name] still broke the [project] build.");
      expect([...defaults]).toEqual(["default-account"]);
      expect(select([rec(1, "codex", text)])[0]?.text).toContain("extra-alias");
    } finally {
      getNames.mockRestore();
    }
  });
  test("new mask tokens alone do not count as information", () => {
    const records = [rec(1, "codex", "account-name #36 #115")];
    expect(select(records, { extraNames: ["account-name"], minScore: -10 })).toEqual([]);
  });
  test("masked text dedupes across sources and the fallback pass", () => {
    const records = [
      rec(1, "codex", "Hmm, host-one output is broken again."),
      rec(2, "claude", "Hmm, host-two output is broken again."),
      rec(3, "codex", "The command failed during execution."),
    ];
    const out = select(records, { extraNames: ["host-one", "host-two"] });
    expect(out.map((item) => item.id)).toEqual(["id2", "id3"]);
    expect(new Set(out.map((item) => item.text)).size).toBe(out.length);
  });
  test("truncate", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdefg", 6)).toBe("abcde…");
  });
});

describe("render", () => {
  const item: Selected = { id: "render", source: "codex", ts: "2026-09-16T00:00:00Z", text: "가".repeat(80), score: 3, target: "misc" };

  test("cursor keyframes keep zero, remove repeats and return to the previous line during deletion", () => {
    const kit = new FontKit();
    const { timed, loopMs } = buildTimeline(kit, [item]);
    const tm = timed[0]!;
    expect(tm.lines).toHaveLength(3);
    const svg = renderSvg([item], "dark", kit);
    const frames = (attr: string) => {
      const match = svg.match(new RegExp(`<animate attributeName="${attr}" calcMode="discrete" values="([^"]+)" keyTimes="([^"]+)"`));
      expect(match).not.toBeNull();
      return { values: match![1]!.split(";").map(Number), times: match![2]!.split(";").map(Number) };
    };
    const x = frames("x");
    const y = frames("y");
    expect(x.times[0]).toBe(0);
    expect(y.times[0]).toBe(0);
    expect(x.times).toHaveLength(x.values.length);
    expect(y.times).toHaveLength(y.values.length);
    expect(x.values.every((v, i) => i === 0 || v !== x.values[i - 1])).toBe(true);
    expect(y.values).toEqual([67, 90, 113, 90, 67]);

    const valueAt = (track: typeof x, time: number) => {
      const keyTime = Number((time / loopMs).toFixed(5));
      const index = track.times.filter((t) => t <= keyTime).length - 1;
      return track.values[index];
    };
    let charsThroughLine = 0;
    for (const [lineIndex, line] of tm.lines.slice(0, -1).entries()) {
      charsThroughLine += line.chars.length;
      // 다음 줄의 첫 글자를 지운 13ms 뒤에는 이전 줄 마지막 글자의 삭제 위치에 있어야 한다.
      const deletionTime = tm.delStart + (tm.nChars - charsThroughLine + 1) * 13;
      expect(valueAt(x, deletionTime)).toBe(Number((132 + line.chars.at(-1)!.x).toFixed(2)));
      expect(valueAt(y, deletionTime)).toBe(67 + lineIndex * 23);
    }
  });
  test("renders both themes with a shared kit, including the empty state", () => {
    const kit = new FontKit();
    for (const theme of ["dark", "light"] as const) {
      const svg = renderSvg([item], theme, kit);
      expect(svg).toContain(`fill="${THEMES[theme].bg}"`);
      expect(svg).toContain('<use href="#g14-ac00" xlink:href="#g14-ac00"');
      const empty = renderSvg([], theme, kit);
      expect(empty).toContain('<use href="#g14-28" xlink:href="#g14-28" x="132" y="80"/>');
      expect(empty).not.toContain("<animate");
    }
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
