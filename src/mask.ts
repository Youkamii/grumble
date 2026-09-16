/**
 * 공개 안전 마스킹. 속마음엔 경로·파일명·프로젝트명·식별자·인용이 그대로 섞이므로
 * 공개물(SVG)에 나가는 문장은 반드시 이 함수를 통과한다. 원문은 로컬 state에만 남는다.
 *
 * 순서가 중요하다:
 *   URL → 경로(Windows/UNC/Unix) → 이메일 → IP → 비밀토큰 → 해시 → 코드스팬 →
 *   스킴 없는 호스트명 → 파일명 → 이슈번호 → 환경변수 → 긴 랜덤토큰 → 이름 → 인용
 * 특히 호스트명 규칙은 파일명 규칙보다 **먼저** 와야 `corp.io/panel` 이 `[file]` 로 새지 않는다.
 */
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";

export interface MaskOptions {
  /** cwd basename 등에서 뽑은 프로젝트명. 대소문자 무시, 단어 경계 기준. → [project] */
  projectNames?: Iterable<string>;
  /** 계정명·호스트 별칭 등 사람/기계 이름. → [name] */
  names?: Iterable<string>;
}

/** 마스킹 결과에 등장할 수 있는 모든 토큰. select 등 외부에서 "정보가 남았는지" 판정할 때 쓴다. */
export const MASK_TOKEN_RE = /\[(?:path|file|url|code|hash|project|name|email|ip|env|quote|secret|n)\]/g;

// --- 경로 조각 ---
// Windows: 백슬래시로 끝나는 세그먼트는 공백을 포함할 수 있다("OneDrive - 주식회사에이콘").
// 슬래시로 끝나는 세그먼트와 마지막 세그먼트는 공백 불가(문장이 통째로 먹히는 것을 막는다).
// 단, 공백은 세그먼트당 3개까지만 — 그 이상이면 경로가 아니라 문장이 뒤의 `\n` 같은 이스케이프까지 삼킨 것이다.
const WIN_WORD = String.raw`[^\s\\/"'\`<>|:*?\n]+`;
const WIN_SEG = String.raw`(?:(?:${WIN_WORD}(?: ${WIN_WORD}){0,3})?\\|[^\s\\/"'\`<>|:*?\n]*\/)`;
// 마지막 세그먼트 끝의 문장 부호(. , ; : ! ))는 경로가 아니라 문장의 것이다.
const WIN_LAST = String.raw`(?:[^\s\\/"'\`<>|:*?\n]*[^\s\\/"'\`<>|:*?.,;:!)\n])?`;
// Unix: 세그먼트는 ASCII에 한정하지 않는다(/home/사용자/문서).
const NIX_SEG = String.raw`[^\s/"'\`<>]`;

const HOST_TLD = "com|net|org|io|dev|ai|app|kr|co\\.kr|me|xyz|cloud|sh|gg|tv|info|biz|site|link|page";

const SENSITIVE_FILES =
  "id_rsa|id_ed25519|id_ecdsa|id_dsa|known_hosts|authorized_keys|credentials|Dockerfile|Makefile|\\.npmrc|\\.netrc|\\.env";

/** Unix 경로 후보를 받아 실제 경로일 때만 [path]로. 끝의 문장 부호는 돌려준다. */
function unixPath(m: string): string {
  const trimmed = m.replace(/[.,;:!?)\]]+$/, "");
  // "/" 나 "./" 처럼 내용이 없는 조각은 경로가 아니다(수식의 나눗셈 등).
  if (!trimmed.replace(/^[~.]*\/+/, "").replace(/[/\s]/g, "")) return m;
  return "[path]" + m.slice(trimmed.length);
}

const RULES: Array<[RegExp, string | ((m: string) => string)]> = [
  [/\bhttps?:\/\/[^\s)"'`<>]+/gi, "[url]"],
  [/\bfile:\/\/\/[^\s)"'`<>]+/gi, "[path]"],
  [new RegExp(String.raw`\b[A-Za-z]:[\\/]${WIN_SEG}*${WIN_LAST}`, "g"), "[path]"],
  [new RegExp(String.raw`\\\\[^\s\\/"'\`<>|:*?]+\\${WIN_SEG}*${WIN_LAST}`, "g"), "[path]"],
  // 앞이 영문·숫자·한글이면 경로 시작이 아니다(and/or, 1/2, 프론트/백엔드).
  [new RegExp(String.raw`(?<![\w.ㄱ-ㆎ가-힣])(?:~|\.{1,2})?\/(?:${NIX_SEG}*\/)*${NIX_SEG}*`, "g"), unixPath],
  // git 리모트·저장소 슬러그: git@host:owner/repo(.git), ssh://…, owner/repo.git, github.com/owner/repo.
  [/\bgit@[\w.-]+:[\w.-]+\/[\w.-]+/g, "[url]"],
  [/\bssh:\/\/[^\s)"'`<>]+/gi, "[url]"],
  [/\b(?:github|gitlab|bitbucket)\.com[/:][\w.-]+\/[\w.-]+/gi, "[url]"],
  [/(?<![\w/])[A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*\.git\b/g, "[url]"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[ip]"],
  // 비밀: JWT → 접두 토큰 → Bearer. 해시보다 먼저 봐야 sk_live_deadbeef… 가 [hash]로 새지 않는다.
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[secret]"],
  [/\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|hf|xox[abeprs]|AKIA|ASIA|AIza)[-_A-Za-z0-9]{8,}\b/g, "[secret]"],
  [/\bBearer\s+[-._~+/A-Za-z0-9]{8,}=*/g, "[secret]"],
  // 해시: 길이 상한 없음(65자 이상도 가려야 한다). 순수 숫자(토큰 수·날짜)는 제외하려고 a-f를 하나 이상 요구.
  [/(?<![\w-])(?=[0-9a-f]*[a-f])[0-9a-f]{7,}(?![\w-])/gi, "[hash]"],
  [/`[^`\n]{1,200}`/g, "[code]"],
  // 스킴 없는 호스트명(admin.acme-internal.example.com, corp.io/panel). 파일명 규칙보다 먼저.
  [new RegExp(String.raw`\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${HOST_TLD})\b(?:\/[^\s"'\`<>]*)?`, "gi"), "[url]"],
  // 파일명: 한글 등 비ASCII 이름도 잡는다(고객명부.xlsx). Next.js/Node.js 같은 제품명은 예외.
  [/(?<![\wㄱ-ㆎ가-힣./\\-])[^\s"'`<>\\/]+?\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|swift|cs|cpp|c|h|json|jsonl|md|toml|ya?ml|ini|env|lock|exe|dll|cmd|bat|ps1|sh|zsh|txt|csv|svg|png|jpe?g|gif|webp|html?|css|scss|sql|db|sqlite|log|zip|tar|gz|pdf|xlsx?|docx?|pptx?|hwpx?|psd|ttf|otf|woff2?)\b/gi,
    (m: string) => (/^(?:next|node|nuxt|vue|three|express|nest|react|alpine|d3|p5|ember|backbone)\.js$/i.test(m) ? m : "[file]")],
  // 확장자가 없거나 점으로 시작하는 민감 파일명(id_rsa, .env.local, known_hosts …).
  [new RegExp(String.raw`(?<![\w.\-/\\])(?:${SENSITIVE_FILES})(?:\.[\w-]+)*(?![\w])`, "g"), "[file]"],
  // GitHub 이슈/PR 번호.
  [/#\d{1,7}\b/g, "#[n]"],
  // 셸 변수($api_key, ${OPENAI_API_KEY}). 대문자 규칙보다 먼저 봐야 "$[env]" 가 안 생긴다.
  [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, "[env]"],
  // LOCAL_MODEL_* 처럼 와일드카드나 밑줄로 끝나는 꼴도 포함.
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9*]*)+/g, "[env]"],
  // 32자 이상 이어지는 영숫자 토큰은 사실상 키·토큰이다. 파일명·환경변수를 먼저 처리한 뒤에 본다.
  [/(?<![\w-])[A-Za-z0-9_-]{32,}(?![\w-])/g, "[secret]"],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 이름 목록 → 단어 경계 기준 치환. 긴 이름부터 적용해 부분 치환을 막는다. */
function maskNames(text: string, raw: Iterable<string> | undefined, token: string): string {
  const names = [...new Set([...(raw ?? [])].map((n) => n.trim()).filter((n) => n.length >= 2))]
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const n of names) {
    out = out.replace(new RegExp(`(?<![\\w-])${escapeRe(n)}(?![\\w-])`, "gi"), token);
  }
  return out;
}

export function mask(text: string, opts: MaskOptions = {}): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as any);

  out = maskNames(out, opts.names, "[name]");
  out = maskNames(out, opts.projectNames, "[project]");

  // 24자 넘는 인용은 사용자 프롬프트나 파일 내용일 가능성이 높다.
  out = maskQuotes(out);
  // 같은 마스크 토큰의 연속 중복 정리.
  out = out.replace(/(\[(?:path|file|url|code|hash|project|name)\])(?:[\s/\\]*\1)+/g, "$1");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

const QUOTE_MIN = 24;
/** 큰따옴표·작은따옴표·둥근따옴표·낫표. 짝이 맞고 안쪽이 QUOTE_MIN 이상일 때만 가린다. */
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
];

/**
 * 여닫이 "위치"로 짝을 짓는다. split 기반 짝짓기는 `5" monitor` 처럼 홀수 따옴표가 하나만 끼어도
 * 뒤의 모든 짝이 어긋나 긴 인용이 그대로 노출됐다.
 * 여는 따옴표 앞은 단어문자가 아니어야 하고(영어 아포스트로피 can't / user's 제외),
 * 닫는 따옴표 뒤도 단어문자가 아니어야 한다.
 */
export function maskQuotes(s: string): string {
  let out = s;
  for (const [open, close] of QUOTE_PAIRS) {
    const o = escapeRe(open);
    const c = escapeRe(close);
    const inner = open === close ? `[^${o}\\n]` : `[^${o}${c}\\n]`;
    const re = new RegExp(`(?<![\\w${o}])${o}(${inner}{${QUOTE_MIN},}?)${c}(?![\\w])`, "g");
    out = out.replace(re, `${open}[quote]${close}`);
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
    // basename 전체만 쓴다. 예전엔 [-_] 로 쪼갠 토큰도 넣었는데
    // "PYTHON-template" 같은 폴더명이 일반 영단어(Python, template)를 [project]로 훼손했다.
    out.add(last);
  }
  return out;
}

let cachedDefaultNames: Set<string> | null = null;

/**
 * 이 기계에서 자동으로 알 수 있는 이름들: 로그인 계정명, 홈 폴더명, ~/.ssh/config 의 Host 별칭.
 * "s1은 도커 빌드 캐시가 86G" 처럼 별칭의 짧은 꼬리만 쓰는 문장이 실제로 발행된 적이 있어
 * lia-s1 → s1 같은 꼬리도 후보에 넣는다. 와일드카드(Host *)는 이름이 아니라 패턴이라 제외.
 */
export function defaultNames(): Set<string> {
  if (cachedDefaultNames) return cachedDefaultNames;
  const out = new Set<string>();
  const add = (v: string | undefined | null) => {
    const t = (v ?? "").trim();
    if (t.length >= 2 && !/^[\d.]+$/.test(t)) out.add(t);
  };
  try { add(userInfo().username); } catch { /* 계정 정보를 못 읽어도 마스킹은 계속된다 */ }
  try { add(basename(homedir())); } catch { /* 위와 같음 */ }
  // GitHub 로그인명(owner/repo 슬러그의 owner)과 git 사용자명.
  try {
    const hosts = readFileSync(join(homedir(), ".config", "gh", "hosts.yml"), "utf8");
    for (const m of hosts.matchAll(/^\s*(?:user|users?):\s*([\w-]+)\s*$/gm)) add(m[1]);
    for (const m of hosts.matchAll(/^\s{4}([\w-]+):\s*$/gm)) add(m[1]);
  } catch { /* gh 미설치 */ }
  try {
    const gc = readFileSync(join(homedir(), ".gitconfig"), "utf8");
    const m = gc.match(/^\s*name\s*=\s*(.+)$/m);
    if (m) add(m[1]);
  } catch { /* gitconfig 없음 */ }
  try {
    const cfg = readFileSync(join(homedir(), ".ssh", "config"), "utf8");
    for (const line of cfg.split(/\r?\n/)) {
      const m = line.match(/^\s*Host\s+(.+)$/i);
      if (!m) continue;
      for (const alias of m[1]!.trim().split(/\s+/)) {
        if (!alias || alias.includes("*") || alias.includes("?")) continue;
        add(alias);
        const tail = alias.match(/-([a-z]{1,3}\d{1,2})$/i);
        if (tail) add(tail[1]!);
      }
    }
  } catch { /* ssh 설정이 없으면 별칭도 없다 */ }
  cachedDefaultNames = out;
  return out;
}
