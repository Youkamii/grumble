/**
 * Noto Sans KR 가변 폰트를 path로. README <img> 안에서는 웹폰트가 안 먹으니 글자를 전부 path로 굽는다.
 * 같은 글자·크기는 <defs>에 한 번만 두고 <use>로 참조해 용량을 줄인다.
 */
import opentype from "opentype.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FONT_PATH = join(HERE, "..", "assets", "fonts", "NotoSansKR-VF.ttf");

export interface Glyph { id: string; d: string; adv: number }

/**
 * opentype.js 2.0의 toPathData는 "1.9 0"을 "1.90"으로 붙여 써 글리프가 깨진다(예: 'l').
 * 명령 배열에서 직접 만든다. 소수 1자리, 불필요한 0 제거, 숫자 사이는 공백.
 */
export function pathData(commands: Array<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }>): string {
  const f = (v: number | undefined) => Number((v ?? 0).toFixed(1)).toString();
  const parts: string[] = [];
  for (const c of commands) {
    switch (c.type) {
      case "M": case "L": parts.push(`${c.type}${f(c.x)} ${f(c.y)}`); break;
      case "Q": parts.push(`Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`); break;
      case "C": parts.push(`C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`); break;
      case "Z": parts.push("Z"); break;
      default: break;
    }
  }
  return parts.join("");
}

export class FontKit {
  private font: any;
  private cache = new Map<string, Glyph>();
  private order: Glyph[] = [];

  constructor(path = FONT_PATH, weight = 500) {
    const buf = readFileSync(path);
    this.font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    try { this.font.variation?.set({ wght: weight }); } catch { /* 정적 폰트면 무시 */ }
  }

  advance(ch: string, size: number): number {
    return this.font.getAdvanceWidth(ch, size);
  }

  /** 글자 하나의 글리프. 캐시에 없으면 path를 굽고 defs 순서에 등록한다. */
  glyph(ch: string, size: number): Glyph {
    const key = `${size}:${ch}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cp = ch.codePointAt(0)!.toString(16);
    const id = `g${size}-${cp}`;
    const d = pathData(this.font.getPath(ch, 0, 0, size).commands);
    const g = { id, d, adv: this.advance(ch, size) };
    this.cache.set(key, g);
    this.order.push(g);
    return g;
  }

  /** 지금까지 쓴 글리프 전부를 <defs> 내용으로. */
  defs(): string {
    return this.order.filter((g) => g.d).map((g) => `<path id="${g.id}" d="${g.d}"/>`).join("");
  }
}

export interface LaidChar { ch: string; x: number; adv: number; glyph: Glyph }
export interface Line { chars: LaidChar[]; width: number }

/** 단어 단위(공백) 줄바꿈, 공백 없는 긴 조각(한국어)은 글자 단위. 넘치면 마지막 줄을 말줄임. */
export function layout(kit: FontKit, text: string, size: number, maxWidth: number, maxLines: number): Line[] {
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const lines: Line[] = [];
  let cur: LaidChar[] = [];
  let x = 0;

  const flush = () => {
    while (cur.length && cur[cur.length - 1]!.ch === " ") cur.pop();
    lines.push({ chars: cur, width: cur.length ? cur[cur.length - 1]!.x + cur[cur.length - 1]!.adv : 0 });
    cur = [];
    x = 0;
  };
  const pushChar = (ch: string) => {
    const glyph = kit.glyph(ch, size);
    cur.push({ ch, x, adv: glyph.adv, glyph });
    x += glyph.adv;
  };
  const measure = (s: string) => [...s].reduce((w, c) => w + kit.advance(c, size), 0);

  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (cur.length && x + kit.advance(" ", size) <= maxWidth) pushChar(" ");
      continue;
    }
    const w = measure(tok);
    if (x + w <= maxWidth) { for (const c of [...tok]) pushChar(c); continue; }
    if (cur.length && w <= maxWidth) { flush(); for (const c of [...tok]) pushChar(c); continue; }
    // 한 줄보다 긴 토큰: 글자 단위로 흘린다.
    for (const c of [...tok]) {
      if (x + kit.advance(c, size) > maxWidth && cur.length) flush();
      pushChar(c);
    }
  }
  if (cur.length) flush();

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1]!;
    const ell = kit.glyph("…", size);
    while (last.chars.length && last.chars[last.chars.length - 1]!.x + last.chars[last.chars.length - 1]!.adv + ell.adv > maxWidth) last.chars.pop();
    while (last.chars.length && /[\s,;:]/.test(last.chars[last.chars.length - 1]!.ch)) last.chars.pop();
    const tail = last.chars[last.chars.length - 1];
    const ex = tail ? tail.x + tail.adv : 0;
    last.chars.push({ ch: "…", x: ex, adv: ell.adv, glyph: ell });
    last.width = ex + ell.adv;
    return kept;
  }
  return lines;
}
