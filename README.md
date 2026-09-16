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

| 명령 | 동작 |
|---|---|
| `bun run scan` | `~/.codex/sessions`, `~/.claude/projects` 증분 스캔 → `~/.grumble/state.json` (원문은 로컬에만) |
| `bun run preview` | 선별·마스킹 결과를 터미널에서 확인 |
| `bun run render` | `public/grumble-{dark,light}.svg` 생성 (소스별 최근 3문장) |
| `bun run publish` | scan → render → SVG가 바뀌면 commit, 미푸시 커밋이 있으면 push |
| `bun run publish --no-push` | scan → render → SVG가 바뀌면 로컬 commit까지 수행하고 push는 생략 |
| `bun run register` | Windows 예약 작업 등록: 6시간마다(하루 4회) 창 없이 publish 실행 |
| `bun run unregister` | Windows 자동 발행 예약 작업 해제 |

```bash
bun install
bun run scan          # 첫 실행은 전체 스캔(수 GB면 수 분), 이후는 변경분만
bun run preview
bun run render
bun run publish --no-push       # 로컬 커밋까지, 푸시 생략
bun run register               # 하루 4회 자동 발행
bun run unregister             # 자동 발행 해제
```

## 데이터 소스

| 소스 | 위치 | 무엇이 남는가 |
|---|---|---|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | `response_item.payload.reasoning.summary[].text` — Codex Desktop이 남긴 1인칭 요약. CLI/exec 경로는 비어 있음 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `assistant.message.content[].thinking` — 본문이 있는 블록만(대부분은 서명만 남음) |

제목 한 줄뿐인 요약(`**Planning tests**`)은 속마음이 아니라 진행 표시라 수집 단계에서 버린다.

## 공개 안전

공개물에 나가는 문장은 반드시 `mask()`를 통과한다.

| 대상 | 마스킹 토큰 |
|---|---|
| URL, 스킴 없는 호스트명(`admin.acme-internal.example.com`, `corp.io/panel`) | `[url]` |
| Windows/Unix/UNC 경로 | `[path]` |
| 이메일, IP, 해시 | `[email]`, `[ip]`, `[hash]` |
| 32자 이상 랜덤 토큰, JWT, 접두 토큰(`sk-`, `ghp_` 등) | `[secret]` |
| 백틱 코드 | `[code]` |
| 파일명, 확장자 없는 민감 파일명(`id_rsa` 등), `.env.*` | `[file]` |
| 환경변수와 셸 변수(`$var`, `${OPENAI_API_KEY}` 등) | `[env]` |
| 작업 폴더의 basename 전체(하이픈·밑줄로 나누지 않음) | `[project]` |
| 계정명·홈 폴더명·SSH 설정의 `Host` 별칭 | `[name]` |
| 이슈·PR 번호(`#36` 등) | `#[n]` |
| `""`, `''`, `“”`, `‘’`, `「」`, `『』` 안의 24자 이상 인용 | 따옴표를 유지한 `[quote]` |

원문과 세션 id, cwd는 `~/.grumble/state.json`에만 있고 저장소에는 올라가지 않는다.
마스킹은 완벽하지 않으므로 발행 전 `bun run preview`로 내용을 확인해야 한다.

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
