/**
 * 공개 안전 마스킹. 속마음엔 경로·파일명·프로젝트명·식별자·인용이 그대로 섞이므로
 * 공개물(SVG)에 나가는 문장은 반드시 이 함수를 통과한다. 원문은 로컬 state에만 남는다.
 *
 * 순서가 중요하다: URL → 경로 → 이메일 → IP → 해시 → 코드스팬 → 파일명 → 환경변수 → 프로젝트명 → 긴 인용.
 */

export interface MaskOptions {
  /** cwd basename 등에서 뽑은 프로젝트명. 대소문자 무시, 단어 경계 기준. */
  projectNames?: Iterable<string>;
}

const RULES: Array<[RegExp, string | ((m: string) => string)]> = [
  [/\bhttps?:\/\/[^\s)"'`<>]+/gi, "[url]"],
  [/\bfile:\/\/\/[^\s)"'`<>]+/gi, "[path]"],
  // 마지막 조각 끝의 문장 부호(. , ; :)는 경로가 아니라 문장의 것이다.
  [/\b[A-Za-z]:[\\/](?:[^\\/\s"'`<>|:*?]+[\\/])*(?:[^\\/\s"'`<>|:*?]*[^\\/\s"'`<>|:*?.,;:!)])?/g, "[path]"],
  [/(?:^|[\s(`'"])(~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+\/?/g, (m: string) => m[0] === "/" || m[0] === "~" || m[0] === "." ? "[path]" : m[0] + "[path]"],
  [/\\\\[\w.-]+\\[^\s"'`]+/g, "[path]"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[ip]"],
  [/\b[0-9a-f]{7,64}\b/gi, "[hash]"],
  [/\b(?:sk|pk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{8,}\b/g, "[secret]"],
  [/`[^`\n]{1,200}`/g, "[code]"],
  [/\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|swift|cs|cpp|c|h|json|jsonl|md|toml|ya?ml|ini|env|lock|exe|dll|cmd|bat|ps1|sh|zsh|txt|csv|svg|png|jpe?g|gif|webp|html?|css|scss|sql|db|sqlite|log|zip|tar|gz|pdf|xlsx?|docx?|ttf|otf|woff2?)\b/gi, "[file]"],
  // LOCAL_MODEL_* 처럼 와일드카드나 밑줄로 끝나는 꼴도 포함.
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9*]*)+/g, "[env]"],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mask(text: string, opts: MaskOptions = {}): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as any);

  const names = [...new Set([...(opts.projectNames ?? [])].map((n) => n.trim()).filter((n) => n.length >= 3))]
    .sort((a, b) => b.length - a.length);
  for (const n of names) {
    out = out.replace(new RegExp(`(?<![\\w-])${escapeRe(n)}(?![\\w-])`, "gi"), "[project]");
  }

  // 24자 넘는 인용은 사용자 프롬프트나 파일 내용일 가능성이 높다. 따옴표는 앞에서부터 짝을 지어 안쪽만 본다.
  out = maskQuotes(out, '"', '"');
  out = maskQuotes(out, "“", "”");
  // 같은 마스크 토큰의 연속 중복 정리.
  out = out.replace(/(\[(?:path|file|url|code|hash|project)\])(?:[\s/\\]*\1)+/g, "$1");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

const QUOTE_MIN = 24;

/** 여는/닫는 따옴표를 순서대로 짝지어, 안쪽이 QUOTE_MIN 이상이면 [quote]로. 짝이 안 맞는 마지막 따옴표는 그대로 둔다. */
export function maskQuotes(s: string, open: string, close: string): string {
  const parts = s.split(open === close ? open : new RegExp(`[${open}${close}]`));
  if (parts.length < 3) return s;
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (i % 2 === 1 && i < parts.length - 1) {
      // 짝이 있는 인용 내부
      out += open + ([...seg].length >= QUOTE_MIN ? "[quote]" : seg) + close;
    } else if (i % 2 === 1) {
      out += open + seg; // 닫히지 않은 마지막 따옴표
    } else {
      out += seg;
    }
  }
  return out;
}

/** cwd 목록에서 마스킹용 프로젝트명 후보를 뽑는다. 홈·Git·Temp 같은 일반 폴더명은 제외. */
export function projectNamesFromCwds(cwds: Iterable<string>): Set<string> {
  const generic = new Set(["git", "users", "home", "temp", "tmp", "appdata", "local", "roaming", "documents", "desktop", "downloads", "scratchpad", "onedrive", "src", "app", "test", "tests", "dist", "build"]);
  const out = new Set<string>();
  for (const raw of cwds) {
    const parts = raw.replace(/^file:\/\/\//i, "").split(/[\\/]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) continue;
    const name = last.toLowerCase();
    if (generic.has(name) || name.length < 3 || /^[a-z]:$/.test(name)) continue;
    // 세션 해시 폴더(c--users-...)나 UUID는 이름이 아니다.
    if (/^[0-9a-f-]{20,}$/i.test(name) || name.startsWith("c--")) continue;
    out.add(last);
    // 하이픈/언더스코어 분리 이름의 각 토큰도 5자 이상이면 후보(예: hanbom-minhwa → hanbom, minhwa).
    // 4자 이하(tail, next, blog…)는 일반 영단어와 겹쳐 오탐이 많아 제외.
    for (const tok of last.split(/[-_]/)) if (tok.length >= 5 && !generic.has(tok.toLowerCase())) out.add(tok);
  }
  return out;
}
