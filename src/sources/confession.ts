/**
 * 정정·자백 채널. 답변 본문(Claude assistant text, Codex assistant output_text)에서
 * "제가 잘못 봤네요", "I misread" 같은 **스스로를 정정하는 문장**만 건진다.
 * thinking 요약은 다듬어진 진행 보고라 밋밋한데, 자백은 사람 냄새가 진하다(#10).
 *
 * 레코드 text는 걸린 문장 + 같은 문단의 다음 문장 한 개. 자백 한 줄만으로는 무엇을 잘못했는지 안 보이고,
 * 너무 길면 말풍선에 안 들어간다. 말풍선에는 두 문장을 통째로 보인다(score.ts displaySentence) —
 * 문장을 고르면 자백이 아닌 뒤 문장이 correcting… 라벨을 달고 나갈 수 있어서다.
 *
 * 답변 본문은 thinking과 달리 남의 말과 값을 그대로 옮기는 자리다. 그래서 수집 전에
 *  - fenced 코드블록은 [code]로 바꾸고(정정된 "진짜 값"이 블록 안에 있는 경우가 많다),
 *  - 인용(>) 줄은 통째로 버리며(사용자 말이 모델 말로 둔갑하지 않게),
 *  - 문단(개행) 경계를 넘어 다음 문장을 붙이지 않는다.
 */
import { splitSentences } from "../score.ts";

/** 문장 단위로 본다. 표현을 넓게 잡으면 "사용자가 틀렸다" 같은 남 탓까지 들어오므로 1인칭 자백에 가깝게 조인다. */
export const CONFESSION_RE = new RegExp([
  // 한국어: 제가/제 + 잘못·착각·오판·실수·놓침, 틀렸-, 정정, 죄송(거절문 "죄송하지만"은 제외), 오해했
  // ('다시 보니'는 자백이 아닌 관찰까지 잡아 뺐다)
  "제가 (잘못|틀렸|놓쳤|착각|오해|오판|빠뜨)",
  "제 (실수|착각|오판|잘못|불찰)",
  "틀렸(습니다|네요|었|군요)",
  "정정(합니다|하겠|할게|해야)",
  "죄송(?!하지만)",
  "(착각|오해)했",
  "잘못 (봤|읽었|판단|짚었|알았|적었|이해)",
  "놓쳤(네요|습니다)",
  // 영어
  "\\b(I was wrong|my mistake|I misread|I misjudged|I misunderstood|I stand corrected|I apologi[sz]e|I overlooked|I got (that|this|it) wrong)\\b",
  "^correction:",
].join("|"), "i");

/** 1인칭 표지. 이게 있으면 아래 제외 규칙을 적용하지 않는다("사용자 지시를 제가 잘못 읽었습니다"는 자백이다). */
const FIRST_PERSON_RE = /제가|제 |저는|저의|\bI\b|\bmy\b/i;
/** 남(사용자)을 주어로 삼은 문장. "사용자가 오해했을 수 있습니다"는 자백이 아니다. */
const OTHERS_RE = /(사용자|유저)( 말|가|는|께서|의)|\bthe user\b/i;
/** 거절문. "죄송하지만 그 요청은 도와드릴 수 없습니다" 뒤에는 보통 사용자 요청이 재진술된다. */
const REFUSAL_RE = /(드릴|할) 수 없/;

/** 자백 문장인가. 1인칭 표지가 없는데 남 얘기거나 거절문이면 아니다. */
export function isConfession(s: string): boolean {
  if (!CONFESSION_RE.test(s)) return false;
  if (FIRST_PERSON_RE.test(s)) return true;
  return !(OTHERS_RE.test(s) || REFUSAL_RE.test(s));
}

/** Codex가 외부 에이전트(Claude Code 등)를 중계할 때 남기는 메시지. 모델의 말이 아니다. */
const RELAY_RE = /^\s*\[external_agent/;

/**
 * 답변 본문은 마크다운이다. 코드블록은 [code]로, 인용 줄은 삭제, 굵게·글머리표·제목 기호는 걷어낸다(낱말은 그대로).
 * `__`는 `__init__.py` 같은 식별자를 깨뜨려서 건드리지 않는다(굵게에 밑줄을 쓰는 답변은 드물다).
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, "[code]")
    .replace(/^[ \t]*>.*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*(?:[-*•]|\d+[.)]|#{1,6})[ \t]+/gm, "");
}

/**
 * 본문에서 자백 문장(+같은 문단의 다음 문장)을 뽑는다. 같은 본문에서 여러 건이 나오면 전부 돌려준다.
 * 중계 메시지(본문 첫머리 또는 문단 첫머리가 [external_agent…)·빈 본문은 건너뛴다.
 */
export function confessionSentences(text: string): string[] {
  if (!text) return [];
  const clean = stripMarkdown(text);
  if (RELAY_RE.test(clean)) return [];
  const out: string[] = [];
  for (const para of clean.split(/\n+/)) {
    if (RELAY_RE.test(para)) continue;
    const sentences = splitSentences(para);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!;
      if (!isConfession(s)) continue;
      const next = sentences[i + 1];
      out.push(next ? `${s} ${next}` : s);
      // 다음 문장도 자백이면 두 번 들어가지 않게 건너뛴다.
      if (next && isConfession(next)) i++;
    }
  }
  return out;
}
