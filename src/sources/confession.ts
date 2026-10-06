/**
 * 정정·자백 채널. 답변 본문(Claude assistant text, Codex assistant output_text)에서
 * "제가 잘못 봤네요", "I misread" 같은 **스스로를 정정하는 문장**만 건진다.
 * thinking 요약은 다듬어진 진행 보고라 밋밋한데, 자백은 사람 냄새가 진하다(#10).
 *
 * 레코드 text는 걸린 문장 + 바로 다음 문장 한 개. 자백 한 줄만으로는 무엇을 잘못했는지 안 보이고,
 * 너무 길면 말풍선에 안 들어간다. select의 bestSentence가 둘 중 더 꿍시렁다운 쪽을 고른다.
 */
import { splitSentences } from "../score.ts";

/** 문장 단위로 본다. 표현을 넓게 잡으면 "사용자가 틀렸다" 같은 남 탓까지 들어오므로 1인칭 자백에 가깝게 조인다. */
export const CONFESSION_RE = new RegExp([
  // 한국어: 제가/제 + 잘못·착각·오판·실수·놓침, 틀렸-, 정정, 죄송, 오해했 ('다시 보니'는 자백이 아닌 관찰까지 잡아 뺐다)
  "제가 (잘못|틀렸|놓쳤|착각|오해|오판|빠뜨)",
  "제 (실수|착각|오판|잘못|불찰)",
  "틀렸(습니다|네요|었|군요)",
  "정정(합니다|하겠|할게|해야)",
  "죄송",
  "(착각|오해)했",
  "잘못 (봤|읽었|판단|짚었|알았|적었|이해)",
  "놓쳤(네요|습니다)",
  // 영어
  "\\b(I was wrong|my mistake|I misread|I misjudged|I misunderstood|I stand corrected|I apologi[sz]e|I overlooked|I got (that|this|it) wrong)\\b",
  "^correction:",
].join("|"), "i");

/** Codex가 외부 에이전트(Claude Code 등)를 중계할 때 남기는 메시지. 모델의 말이 아니다. */
const RELAY_RE = /^\s*\[external_agent/;

/** 답변 본문은 마크다운이다. 굵게 표시·글머리표·제목 기호는 말풍선에서 찌꺼기라 걷어낸다(내용은 그대로). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/^[ \t]*(?:[-*•]|\d+[.)]|#{1,6})[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "");
}

/**
 * 본문에서 자백 문장(+다음 문장)을 뽑는다. 같은 본문에서 여러 건이 나오면 전부 돌려준다.
 * 중계 메시지·빈 본문은 빈 배열.
 */
export function confessionSentences(text: string): string[] {
  if (!text || RELAY_RE.test(text)) return [];
  const sentences = splitSentences(stripMarkdown(text));
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    if (!CONFESSION_RE.test(s)) continue;
    const next = sentences[i + 1];
    out.push(next ? `${s} ${next}` : s);
    // 다음 문장도 자백이면 두 번 들어가지 않게 건너뛴다.
    if (next && CONFESSION_RE.test(next)) i++;
  }
  return out;
}
