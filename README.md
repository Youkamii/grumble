# grumble

> what the model muttered — AI 코딩 에이전트가 답을 내기 전에 혼자 중얼거린 말을 모아 README 말풍선으로.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Youkamii/grumble/main/public/grumble-dark.svg">
  <img alt="grumble — 최근 AI가 속으로 한 말" src="https://raw.githubusercontent.com/Youkamii/grumble/main/public/grumble-light.svg" width="640">
</picture>

Claude Code와 Codex는 답변 전에 추론(thinking / reasoning)을 하고, 그 요약이 로컬 세션 로그에 남는다.
grumble은 그 로그를 훑어 가장 "꿍시렁"다운 문장을 뽑고, 경로·파일명·프로젝트명·인용을 마스킹한 뒤,
타이핑되고 지워지는 SMIL 애니메이션 SVG로 굽는다. JS·CSS·웹폰트 없이 GitHub README `<img>` 안에서 그대로 움직인다.

## 동작

```
scan     ~/.codex/sessions, ~/.claude/projects 를 증분 스캔 → ~/.grumble/state.json (원문은 로컬에만)
preview  선별·마스킹 결과를 터미널에서 확인
render   public/grumble-{dark,light}.svg 생성 (소스별 최근 3문장)
publish  scan → render → SVG가 바뀌었을 때만 commit·push
register Windows 예약 작업 등록: 6시간마다(하루 4회) 창 없이 publish 실행
```

```bash
bun install
bun run scan          # 첫 실행은 전체 스캔(수 GB면 수 분), 이후는 변경분만
bun run src/index.ts preview
bun run render
bun run src/index.ts register   # 하루 4회 자동 발행
```

## 데이터 소스

| 소스 | 위치 | 무엇이 남는가 |
|---|---|---|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | `response_item.payload.reasoning.summary[].text` — Codex Desktop이 남긴 1인칭 요약. CLI/exec 경로는 비어 있음 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `assistant.message.content[].thinking` — 본문이 있는 블록만(대부분은 서명만 남음) |

제목 한 줄뿐인 요약(`**Planning tests**`)은 속마음이 아니라 진행 표시라 수집 단계에서 버린다.

## 공개 안전

공개물에 나가는 문장은 반드시 `mask()`를 통과한다.
URL · Windows/Unix/UNC 경로 · 이메일 · IP · 해시 · 토큰 접두(sk-, ghp_ …) · 백틱 코드 · 파일명 · 환경변수 ·
작업 폴더 이름에서 뽑은 프로젝트명 · 24자 이상 인용을 각각 `[url] [path] [email] [ip] [hash] [secret] [code] [file] [env] [project] [quote]` 로 바꾼다.
원문과 세션 id, cwd는 `~/.grumble/state.json`에만 있고 저장소에는 올라가지 않는다.

## 렌더링

- 글자는 Noto Sans KR(OFL)을 path로 구워 `<defs>`에 글자별 한 번씩 두고 `<use>`로 찍는다. 뷰어 폰트에 의존하지 않는다.
- 타이핑/삭제는 줄마다 `clipPath` 사각형의 `width`를 `calcMode="discrete"` keyTimes로 계단식 이동시킨다.
  모든 애니메이션이 루프 길이 L초로 동기화되어 항목이 순서대로 타이핑 → 잠시 유지 → 지워짐 → 다음 항목으로 넘어간다.
- 캐릭터는 항목의 소스에 따라 Claude Code / OpenAI 로고가 바뀐다.
- 다크·라이트 두 파일을 만들고 README에서 `<picture>`로 고른다.

## 갱신 주기

GitHub는 README 이미지를 camo 프록시로 캐시한다. raw.githubusercontent.com의 max-age(5분)를 따르므로
푸시 후 수 분 안에 새 SVG가 보인다. 강제로 새로 받게 하려면 URL 뒤에 `?v=<아무 값>`을 붙인다.

## 라이선스

MIT. Noto Sans KR은 SIL Open Font License 1.1. 로고는 각 상표권자의 것이다.
