/**
 * 선별된 문장 → README용 SMIL 애니메이션 SVG.
 * - JS·CSS·외부 리소스 금지(GitHub <img> 제약). 글자는 전부 path(<use>), 애니메이션은 SMIL만.
 * - 타이핑/삭제: 줄마다 clipPath 사각형의 width를 discrete keyTimes로 계단식 이동.
 * - 전체 루프 길이 L초 안에서 모든 애니메이션이 dur=L, repeatCount=indefinite 로 동기화된다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FontKit, layout, type Line } from "./font.ts";
import type { Selected } from "./select.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Theme {
  bg: string; bubble: string; stroke: string; ink: string; muted: string; charBg: string; claude: string; openai: string; cursor: string;
}
export const THEMES: Record<"dark" | "light", Theme> = {
  dark: { bg: "#0d1117", bubble: "#161b22", stroke: "#30363d", ink: "#e6edf3", muted: "#8b949e", charBg: "#21262d", claude: "#d97757", openai: "#ffffff", cursor: "#58a6ff" },
  light: { bg: "#ffffff", bubble: "#f6f8fa", stroke: "#d0d7de", ink: "#1f2328", muted: "#656d76", charBg: "#eaeef2", claude: "#d97757", openai: "#000000", cursor: "#0969da" },
};

export const W = 640;
export const H = 200;
const CHAR_CX = 56, CHAR_CY = 104, CHAR_R = 36;
const BUBBLE = { x: 112, y: 44, w: 512, h: 128, rx: 16 };
const TEXT_X = BUBBLE.x + 20;
const TEXT_W = BUBBLE.w - 40;
const TEXT_SIZE = 14;
const LINE_H = 23;
const MAX_LINES = 3;
const LABEL_SIZE = 11;
const LABEL_Y = 34;
const TYPE_MS = 42;
const DEL_MS = 13;
const HOLD_MS = 2800;
const GAP_MS = 450;
const MIN_TYPE_MS = 900;

const NAMES: Record<Selected["source"], string> = { claude: "Claude Code", codex: "Codex" };

function iconPath(name: "claudecode" | "openai"): string {
  const svg = readFileSync(join(HERE, "..", "assets", "icons", `${name}.svg`), "utf8");
  const m = svg.match(/<path d="([^"]+)"/);
  if (!m) throw new Error(`icon path missing: ${name}`);
  return m[1]!;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function n(v: number): string {
  return Number(v.toFixed(2)).toString();
}

/** (시각ms, 값) 목록 → discrete animate 속성. 같은 시각은 뒤 값이 이긴다. */
function discrete(attr: string, pairs: Array<[number, number | string]>, loopMs: number): string {
  const map = new Map<number, number | string>();
  for (const [t, v] of pairs) map.set(Math.max(0, Math.min(t, loopMs)), v);
  const sorted = [...map.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0 || sorted[0]![0] !== 0) sorted.unshift([0, sorted[0]?.[1] ?? 0]);
  const keyTimes = sorted.map(([t]) => (t / loopMs).toFixed(5).replace(/\.?0+$/, "") || "0").join(";");
  const values = sorted.map(([, v]) => (typeof v === "number" ? n(v) : v)).join(";");
  return `<animate attributeName="${attr}" calcMode="discrete" values="${values}" keyTimes="${keyTimes}" dur="${(loopMs / 1000).toFixed(3)}s" repeatCount="indefinite"/>`;
}

interface Timed { item: Selected; lines: Line[]; start: number; typeEnd: number; delStart: number; end: number; nChars: number }

export function buildTimeline(kit: FontKit, items: Selected[]): { timed: Timed[]; loopMs: number } {
  let t = 0;
  const timed: Timed[] = [];
  for (const item of items) {
    const lines = layout(kit, item.text, TEXT_SIZE, TEXT_W, MAX_LINES);
    const nChars = lines.reduce((a, l) => a + l.chars.length, 0);
    const typeDur = Math.max(MIN_TYPE_MS, nChars * TYPE_MS);
    const delDur = nChars * DEL_MS;
    const start = t;
    const typeEnd = start + typeDur;
    const delStart = typeEnd + HOLD_MS;
    const end = delStart + delDur;
    timed.push({ item, lines, start, typeEnd, delStart, end, nChars });
    t = end + GAP_MS;
  }
  return { timed, loopMs: Math.max(t, 1000) };
}

export function renderSvg(items: Selected[], themeName: "dark" | "light", kit = new FontKit()): string {
  const th = THEMES[themeName];
  const { timed, loopMs } = buildTimeline(kit, items);
  const clips: string[] = [];
  const groups: string[] = [];

  timed.forEach((tm, i) => {
    const { item, lines, start, typeEnd, delStart, end } = tm;
    const perChar = tm.nChars ? (typeEnd - start) / tm.nChars : 0;
    // 글자별 등장/삭제 시각(전역 인덱스 j).
    let j = 0;
    const cursorX: Array<[number, number]> = [];
    const cursorY: Array<[number, number]> = [];
    const lineSvgs: string[] = [];
    const total = tm.nChars;
    lines.forEach((line, k) => {
      const y = BUBBLE.y + 22 + k * LINE_H + TEXT_SIZE;
      const widths: Array<[number, number]> = [[0, 0]];
      line.chars.forEach((c, idx) => {
        const tOn = start + (j + 1) * perChar;
        const tOff = delStart + (total - j) * DEL_MS;
        const after = c.x + c.adv;
        widths.push([tOn, after], [tOff, c.x]);
        cursorX.push([tOn, TEXT_X + after], [tOff, TEXT_X + c.x]);
        cursorY.push([tOn, y - TEXT_SIZE + 1], [tOff, y - TEXT_SIZE + 1]);
        if (idx === 0) { cursorX.push([tOff + DEL_MS, TEXT_X + c.x]); }
        j++;
      });
      widths.push([end, 0]);
      const clipId = `c${i}-${k}`;
      clips.push(`<clipPath id="${clipId}"><rect x="${n(TEXT_X - 1)}" y="${n(y - TEXT_SIZE - 4)}" height="${n(LINE_H + 2)}" width="0">${discrete("width", widths.map(([t, w]) => [t, w + 1]), loopMs)}</rect></clipPath>`);
      const uses = line.chars.filter((c) => c.glyph.d).map((c) => `<use href="#${c.glyph.id}" xlink:href="#${c.glyph.id}" x="${n(TEXT_X + c.x)}" y="${n(y)}"/>`).join("");
      lineSvgs.push(`<g clip-path="url(#${clipId})">${uses}</g>`);
    });
    // 첫 글자 전엔 커서를 첫 줄 시작에 둔다.
    const y0 = BUBBLE.y + 22 + TEXT_SIZE;
    cursorX.unshift([start, TEXT_X]); cursorY.unshift([start, y0 - TEXT_SIZE + 1]);

    const date = item.ts.slice(0, 10);
    const label = `${NAMES[item.source]}  ·  thinking…  ·  ${date}`;
    const labelLines = layout(kit, label, LABEL_SIZE, TEXT_W, 1);
    const labelUses = labelLines[0]!.chars.filter((c) => c.glyph.d).map((c) => `<use href="#${c.glyph.id}" xlink:href="#${c.glyph.id}" x="${n(TEXT_X + c.x)}" y="${LABEL_Y}"/>`).join("");

    const vis = discrete("opacity", [[0, 0], [start, 1], [end + Math.min(GAP_MS / 2, 200), 0]], loopMs);
    const cursor = `<rect width="1.6" height="${TEXT_SIZE + 3}" fill="${th.cursor}">${discrete("x", cursorX, loopMs)}${discrete("y", cursorY, loopMs)}<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" calcMode="discrete" dur="1.06s" repeatCount="indefinite"/></rect>`;
    groups.push(`<g opacity="0">${vis}<g fill="${th.muted}">${labelUses}</g><g fill="${th.ink}">${lineSvgs.join("")}</g>${cursor}</g>`);
  });

  // 캐릭터: 현재 항목의 소스 로고만 보인다.
  const logoVis = (src: Selected["source"]) => {
    const pairs: Array<[number, number]> = [[0, timed[0]?.item.source === src ? 1 : 0]];
    for (const tm of timed) pairs.push([tm.start, tm.item.source === src ? 1 : 0]);
    return discrete("opacity", pairs, loopMs);
  };
  const scale = (CHAR_R * 1.15) / 24;
  const logo = (src: Selected["source"], d: string, color: string) =>
    `<g opacity="0">${timed.length ? logoVis(src) : ""}<path transform="translate(${n(CHAR_CX - 12 * scale)} ${n(CHAR_CY - 12 * scale)}) scale(${n(scale)})" fill="${color}" d="${d}"/></g>`;

  // 생각 말풍선: 본체 + 캐릭터 쪽으로 작아지는 방울 둘.
  const bubble = `<rect x="${BUBBLE.x}" y="${BUBBLE.y}" width="${BUBBLE.w}" height="${BUBBLE.h}" rx="${BUBBLE.rx}" fill="${th.bubble}" stroke="${th.stroke}"/>` +
    `<circle cx="${CHAR_CX + CHAR_R + 10}" cy="${CHAR_CY - 6}" r="6" fill="${th.bubble}" stroke="${th.stroke}"/>` +
    `<circle cx="${CHAR_CX + CHAR_R + 2}" cy="${CHAR_CY + 10}" r="3.5" fill="${th.bubble}" stroke="${th.stroke}"/>`;

  const footer = layout(kit, "grumble — what the model muttered", 9, 300, 1)[0]!;
  const footerUses = footer.chars.filter((c) => c.glyph.d).map((c) => `<use href="#${c.glyph.id}" xlink:href="#${c.glyph.id}" x="${n(BUBBLE.x + BUBBLE.w - footer.width + c.x)}" y="${H - 9}"/>`).join("");

  const empty = timed.length === 0
    ? (() => { const l = layout(kit, "(no grumbles yet)", TEXT_SIZE, TEXT_W, 1)[0]!; return `<g fill="${th.muted}">${l.chars.map((c) => `<use href="#${c.glyph.id}" xlink:href="#${c.glyph.id}" x="${n(TEXT_X + c.x)}" y="${BUBBLE.y + 22 + TEXT_SIZE}"/>`).join("")}</g>`; })()
    : "";

  const aria = items.map((s) => `${NAMES[s.source]}: ${s.text}`).join(" / ");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">` +
    `<title>grumble</title>` +
    `<defs>${kit.defs()}${clips.join("")}</defs>` +
    `<rect width="${W}" height="${H}" rx="12" fill="${th.bg}"/>` +
    `<circle cx="${CHAR_CX}" cy="${CHAR_CY}" r="${CHAR_R}" fill="${th.charBg}" stroke="${th.stroke}"/>` +
    logo("claude", iconPath("claudecode"), th.claude) + logo("codex", iconPath("openai"), th.openai) +
    bubble + empty + groups.join("") +
    `<g fill="${th.muted}" opacity="0.7">${footerUses}</g>` +
    `</svg>`;
}
