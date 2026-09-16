/**
 * 요약 원문 → 문장 분리 → "꿍시렁 점수".
 * 계획 문장("~하겠습니다", "Next I'll")은 감점, 불평·의외·모순·재시도 표지어는 가점.
 * 정규식 표지어 점수제이므로 정밀도보다 재현율을 택했다. 상위만 뽑아 쓰므로 오탐은 select에서 걸러진다.
 */

export type Target = "tool" | "user" | "self" | "env" | "misc";

export interface Sentence {
  text: string;
  score: number;
  target: Target;
}

/** 굵은 제목 줄을 떼어낸다. 본문이 없으면 제목만 반환(제목 전용은 select에서 감점). */
export function splitTitle(raw: string): { title: string; body: string } {
  const m = raw.match(/^\s*\*\*([^*\n]{1,200})\*\*\s*\n?([\s\S]*)$/);
  if (m) return { title: m[1]!.trim(), body: m[2]!.trim() };
  return { title: "", body: raw.trim() };
}

/** 영어·한국어 혼합 문장 분리. 약어·소수점·경로의 점은 문장 끝으로 보지 않는다. */
export function splitSentences(body: string): string[] {
  const norm = body.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!norm) return [];
  const out: string[] = [];
  // 문장 끝은 "구두점 + 공백/끝"일 때만. 소수점(1.2)·경로(x.ps1)·약어 내부의 점은 문장 안에 남는다.
  const re = /(?:[^.!?。]|[.!?。](?!\s|$))+[.!?。]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const s = m[0].trim();
    if (s) out.push(s);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const CUES: Array<[RegExp, number]> = [
  // 영어: 감정·의외·모순
  [/\b(hmm+|ugh|sigh|oops|argh|meh|welp)\b/i, 3],
  [/\b(annoying|frustrating|painful|tedious|messy|hacky|ugly|awkward|clunky|brittle|flaky|fragile)\b/i, 3],
  [/\b(weird(ly)?|odd(ly)?|strange(ly)?|bizarre|surprising(ly)?|unexpected(ly)?|puzzling|confusing)\b/i, 3],
  [/\b(ambiguous|vague|unclear|contradict\w*|inconsistent|mismatch\w*)\b/i, 3],
  [/\b(again|still|yet another|once more|keeps?|repeatedly|for the (second|third|nth) time)\b/i, 2],
  [/\b(unfortunately|sadly|alas|apparently|supposedly|somehow|weirdly)\b/i, 2],
  [/\b(garbled|mojibake|broken|stuck|hangs?|hung|timed? ?out|timeout|crash\w*|fails?|failed|failing|refus\w+|reject\w+)\b/i, 2],
  [/\b(can'?t|cannot|won'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|not (sure|clear|obvious|ideal|great))\b/i, 1],
  [/\b(wait|hold on|actually|turns out|it seems|seems like|looks like|I (assumed|misread|missed|forgot|overlooked)|my (mistake|bad))\b/i, 2],
  [/\b(the user (wants|insists|asked|said|mentioned|didn'?t|keeps|seems))\b/i, 2],
  [/\b(why|how come)\b/i, 1],
  [/\?/, 1],
  [/!/, 1],
  [/\b(honestly|frankly|to be fair|admittedly|ironically)\b/i, 2],
  // 한국어: 감탄·의외·불평
  [/(흠+|음+…|어라|이런|아이고|헉|엥|허)/, 3],
  [/(네요|군요|구나|는군|잖아|더라)/, 2],
  [/(이상하|희한|어이없|황당|난감|골치|귀찮|성가시|번거로|짜증|당황)/, 3],
  [/(애매|모호|헷갈|불분명|모순|엇갈|안 맞|맞지 않)/, 3],
  [/(또|다시|여전히|계속|자꾸|또다시|반복)/, 2],
  [/(안 되|안 돼|못 |실패|타임아웃|막혀|막힌|꼬여|꼬인|깨져|깨진|죽|튕기|거부)/, 2],
  [/(그런데|근데|하지만|그러나|는데|지만|의외|예상과|뜻밖)/, 1],
  [/(착각|오판|잘못 (봤|읽|판단)|놓쳤|빠뜨|실수)/, 3],
  [/(사용자가|유저가|요구|요청이|지시가)/, 1],
  [/(인 듯|나 보|것 같|인 것 같|모양이|같은데)/, 1],
  [/(함정|낚|헛수고|삽질|우회|땜질)/, 3],
  [/(아쉽|불편|어렵|까다로|복잡)/, 2],
];

const PLAN_PENALTY: Array<[RegExp, number]> = [
  [/^(next,?|now,?|then,?|first,?|finally,?)?\s*(i(?:'ll| will| should| need to| plan to| am going to| can)|let'?s|we(?:'ll| will| should| need to)|plan to)\b/i, -3],
  [/(하겠습니다|하겠다|할게요|해보겠습니다|확인하겠|진행하겠|살펴보겠|정리하겠|수정하겠|검증하겠|해볼게요|하자|해야 한다|해야겠다)\s*[.!]?$/, -3],
  [/^(checking|inspecting|verifying|planning|preparing|reviewing|investigating|analyzing|considering|evaluating|implementing|adding|updating|creating|running|testing|examining|exploring|confirming|clarifying|reporting|refactoring|identifying|explaining|compiling|combining)\b/i, -2],
];

const TARGETS: Array<[Target, RegExp]> = [
  ["user", /\b(the user|user'?s|they (want|asked|said|insist)|사용자|유저|요구|요청|지시)/i],
  ["self", /\b(I (misread|missed|forgot|assumed|overlooked|misjudged)|my (mistake|bad|assumption))\b|착각|오판|내가 잘못|놓쳤|빠뜨|실수/i],
  ["tool", /\b(command|shell|powershell|bash|npm|bun|pip|git|gh|docker|api|sdk|cli|tool|hook|sandbox|permission|timeout|timed out|monitor|browser|chrome|terminal|process|script|build|test runner|compiler|linter|lsp)\b|명령|셸|스크립트|도구|훅|샌드박스|타임아웃|권한|빌드|테스트|브라우저|터미널|프로세스/i],
  ["env", /\b(windows|linux|macos|wsl|encoding|utf-?8|cp949|locale|path|env|environment|network|proxy|port|firewall|disk|memory|font)\b|인코딩|환경|경로|네트워크|포트|디스크|메모리|폰트|한글 깨/i],
];

export function classifyTarget(s: string): Target {
  for (const [t, re] of TARGETS) if (re.test(s)) return t;
  return "misc";
}

export function scoreSentence(s: string): number {
  let score = 0;
  for (const [re, w] of CUES) if (re.test(s)) score += w;
  for (const [re, w] of PLAN_PENALTY) if (re.test(s)) score += w;
  const len = [...s].length;
  if (len < 12) score -= 3;
  else if (len < 25) score -= 1;
  if (len > 220) score -= 2;
  return score;
}

/** 요약 원문에서 가장 꿍시렁다운 문장 하나. 제목만 있으면 제목을 감점해서 반환. */
export function bestSentence(raw: string): Sentence | null {
  const { title, body } = splitTitle(raw);
  const sentences = splitSentences(body);
  if (sentences.length === 0) {
    if (!title) return null;
    return { text: title, score: scoreSentence(title) - 3, target: classifyTarget(title) };
  }
  let best: Sentence | null = null;
  for (const s of sentences) {
    const sc = scoreSentence(s);
    if (!best || sc > best.score) best = { text: s, score: sc, target: classifyTarget(s) };
  }
  return best;
}
