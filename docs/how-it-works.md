# 동작 설명

README에서 뺀 자세한 동작. 명령, 수집 규칙, 선별, 재미 판정, 원격 동기화, 마스킹, 렌더링.

## 명령

| 명령 | 하는 일 |
|---|---|
| `sync` | 등록된 원격 기계의 로그를 `~/.grumble/remote/<host>/`로 가져온다. `--full`이면 처음부터 다시 |
| `scan` | `~/.codex/sessions`, `~/.claude/projects`, 받아둔 원격 사본을 읽어 `~/.grumble/state.json`에 쌓는다. 원문은 로컬에만 있다 |
| `judge [n]` | 아직 점수 없는 문장을 20건씩 Haiku에 보낸다. 한 번에 200건, 6분까지. 세 번 실패한 문장은 다시 보내지 않는다 |
| `preview [n] [--no-judge] [--no-exposure]` | 선별 결과. 판정 캐시나 노출 기록을 빼고 보고 싶을 때 플래그를 붙인다 |
| `render` | SVG 두 파일과 `public/grumble.json`(마스킹된 문장과 시각만) 생성 |
| `publish [--no-push] [--no-judge] [--no-sync]` | sync → scan → judge → render. SVG가 바뀌었으면 commit, 안 올라간 커밋이 있으면 push. `main`에서만 돌고 다른 브랜치면 건너뛴다. `--no-judge`는 새 판정 호출만 생략하고 캐시는 쓴다, `--no-sync`는 받아둔 사본만 스캔한다 |
| `register` / `unregister` | Windows 예약 작업 등록과 해제. 창은 뜨지 않는다 |

README에는 이렇게 넣는다.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/<you>/grumble/main/public/grumble-dark.svg">
  <img src="https://raw.githubusercontent.com/<you>/grumble/main/public/grumble-light.svg" width="640">
</picture>
```

## 무엇을 모으나

세 종류다.

**추론 요약.** Codex는 `~/.codex/sessions`의 rollout 파일에 reasoning summary를, Claude Code는 `~/.claude/projects`의 세션 파일에 thinking 블록을 남긴다. 본문 없이 서명만 남은 블록은 건너뛴다. Codex 쪽은 `~/.codex/config.toml`에 `model_reasoning_summary = "detailed"`가 있어야 요약이 기록되고, 그 요약은 사용자 언어와 상관없이 영어로 나온다.

**정정과 자백.** 답변 본문에서 "제가 잘못 봤네요", "I misread", "Correction:" 같은 문장을 같은 문단의 다음 문장 하나와 함께 가져온다. 사용자를 주어로 한 문장과 거절문은 빼고, 코드블록은 `[code]`로 바꾸고, 인용문은 버린다. 답변은 남의 말과 진짜 값을 옮기는 자리라서 그렇다. 말풍선에는 두 문장이 통째로 올라가고 라벨은 `correcting…`이다.

**꿍시렁.** 모델에게 직접 투덜거릴 자리를 준다. 전역 `~/.claude/CLAUDE.md`와 `~/.codex/AGENTS.md`에 이렇게 적어 둔다.

> 작업 중 뭔가 꼬였거나, 어이없거나, 같은 실수를 또 했거나, 도구나 환경이 속을 썩였을 때만 응답 맨 끝에 `꿍시렁:`으로 시작하는 한 줄을 남긴다. 반말 혼잣말로, 솔직하고 짧게(60자 안쪽). 경로, 파일명, 계정명, 프로젝트명은 넣지 않는다. 평범하게 끝난 턴에는 남기지 않는다.

답변의 마지막 줄이 `꿍시렁:`으로 시작할 때 그 한 줄만 가져온다. 본문 중간의 언급이나 예시 목록은 걸리지 않고, 100자를 넘으면 본문을 옮긴 것으로 보고 버린다. 라벨은 `muttering…`. 이게 제일 좋은 재료다. 로그에 남는 추론 요약은 다듬어진 보고라서 그것만 두면 밋밋하다.

그리고 숫자 하나. 지난 7일 동안 "하겠습니다" 같은 계획 표현이 든 추론 요약이 몇 건이었는지, 자백은 몇 번, 꿍시렁은 몇 번, 새벽 0~5시에 돌린 작업은 몇 건인지 소스별로 세서 말풍선 하나를 더 붙인다. 0인 항목은 빼고 셀 게 없는 소스는 말풍선도 없다. 전부 사실이고 LLM은 쓰지 않는다. 라벨은 `this week…`.

제목 한 줄뿐인 요약, 12자 미만 문장, 가리고 나면 토큰만 남는 문장은 판정 후보에서 뺀다. Codex의 제목 한 줄짜리 요약은 수집 때부터 버린다. Codex가 다른 에이전트의 출력을 중계한 메시지(`[external_agent…`)와 재미 판정에 쓴 Haiku 세션도 소스가 아니다.

## 어떻게 고르나

점수순이다. 점수는 `claude -p`로 Haiku에게 물어본 0~10점이고, 아직 안 물어본 문장은 표지어 기반 휴리스틱을 0~5로 눌러 쓴다. 기본 점수만 놓고 보면 판정받은 6점이 판정 없는 어떤 문장보다 높고, 최근성과 pick 보너스는 그 위에 얹힌다. 문턱은 판정이 있으면 3점, 없으면 휴리스틱 3점. 여기에 최근 7일이면 +3(90일에 걸쳐 0으로), Haiku가 배치 안에서 "가장 속마음이 드러난 3건"으로 꼽은 문장이면 +2. 꿍시렁 줄은 표지어가 없어도 휴리스틱 상한인 5점으로 친다.

판정 프롬프트는 '웃긴가'가 아니라 '속마음이 새어 나왔는가'를 묻는다. 비꼼, 체념, 남 탓, 자책, "또야?" 같은 피로가 높은 점수고, 정중한 말투라도 멋쩍은 자기 지적이나 빗나간 예상이 비치면 중간, 진행 보고는 0~2로 누른다. 문장은 마스킹한 뒤 140자로 잘라 JSON 데이터로 넘기고, 그 안의 지시는 무시하라고 못 박는다. 한 배치가 전부 9점 이상이거나 전부 같은 점수면 판정으로 보지 않고 버린다. 결과는 `~/.grumble/judge.json`에 남고, 채점 기준이 바뀌어 `PROMPT_VERSION`이 올라가면 옛 점수는 다시 매긴다. `claude`가 없거나 실패하면 휴리스틱만으로 간다.

점수만 보면 옛 고득점 문장이 영원히 자리를 지킨다. 그래서 commit된 문장은 `~/.grumble/exposure.json`에 기록해 두고, 처음 실린 뒤 24시간은 자리를 지키게 하고(sticky), 그다음 14일은 쉬게 한다(cooling). 후보는 먼저 최근 14일 안에서 찾고, 모자라면 창을 풀고, 그래도 모자라면 문턱을 한 단계 낮추면서 하루 한 건, 같은 분위기 연속 금지 같은 다양성 규칙을 풀고, 마지막에는 쿨다운까지 무시한다. 빈 말풍선이 제일 나쁘다.

`bun run preview`가 지금 올라갈 문장과 점수, sticky/cooling 상태를 보여준다.

## 원격 기계

다른 기계에서도 에이전트를 돌린다면 그쪽 로그를 가져와 같은 소스로 합칠 수 있다. `~/.grumble/config.json`에 ssh 별칭을 적는다. 예시는 `config.example.json`에 있다.

```json
{
  "remotes": [
    { "host": "lia-s1", "claude": "~/.claude/projects", "codex": "~/.codex/sessions" },
    { "host": "lia-c2" },
    { "host": "lia-c3", "codex": "" }
  ]
}
```

`host`는 암호 없이 붙는 ssh 별칭이나 `user@host`다(`BatchMode=yes`로 부른다). `claude`와 `codex`는 생략하면 기본 경로이고, `""`이나 `null`이면 그 소스는 건너뛴다.

원격에서 하는 일은 `whoami`, `find`, `tar czf -`뿐이다. 지우거나 고치는 명령은 보내지 않는다. 첫 회와 `--full`은 폴더를 통째로, 그 뒤로는 `~/.grumble/sync.json`에 적힌 마지막 동기 시각 이후 바뀐 `*.jsonl`만 gzip tar로 받아 `~/.grumble/remote/<host>/`에 풀고, 원격에서 파일이 사라져도 로컬 사본은 남긴다. 한 기계가 안 되면 로그만 남기고 다음으로 넘어가고, 실패한 기계의 동기 시각은 전진시키지 않는다. 원격 계정명과 host 별칭은 `[name]`으로 가리고, 레코드에 남는 `host`는 공개물에 나가지 않는다.

## 가리는 것

공개물로 나가는 문장은 전부 `mask()`를 거친다.

| 대상 | 토큰 |
|---|---|
| URL, 스킴 없는 호스트명 | `[url]` |
| Windows/Unix/UNC 경로 | `[path]` |
| 이메일, IP, 해시 | `[email]`, `[ip]`, `[hash]` |
| 32자 이상 랜덤 토큰, JWT, `sk-`·`ghp_` 같은 접두 토큰 | `[secret]` |
| 백틱 코드 | `[code]` |
| 파일명, `id_rsa` 같은 민감 파일명, `.env.*` | `[file]` |
| `$var`, `${OPENAI_API_KEY}` 같은 변수 | `[env]` |
| 작업 폴더 이름 | `[project]` |
| 계정명, 홈 폴더명, SSH 설정의 `Host` 별칭 | `[name]` |
| 이슈·PR 번호 | `#[n]` |
| 따옴표 안의 24자 이상 인용 | `[quote]` |

원문과 세션 id, cwd는 `~/.grumble/state.json`에만 있고 저장소에는 올라가지 않는다. 상태 파일은 `0o600`으로 쓰지만 Windows에서는 의미가 없으니, 같은 PC를 여러 계정이 쓴다면 `~/.grumble`에 직접 ACL을 걸어야 한다. 마스킹이 완벽하지는 않다. 발행 전에 `bun run preview`로 한 번 보는 게 좋다.

## 렌더링

- 글자는 Noto Sans KR을 path로 구워 `<defs>`에 한 번씩 두고 `<use>`로 찍는다. 뷰어 폰트와 무관하다.
- 타이핑과 삭제는 줄마다 `clipPath`의 `width`를 `calcMode="discrete"`로 계단식으로 움직여 만든다. 모든 애니메이션이 한 루프 길이에 맞춰 돌아 항목이 차례로 타이핑되고, 잠시 머물다, 지워진다.
- 말풍선 높이는 줄 수(1~3)에 따라 바뀌고 항상 캐릭터 원 중심에 맞춘다. 전체 크기는 640×200으로 고정이라 README 레이아웃이 흔들리지 않는다.
- 캐릭터는 항목의 소스에 따라 Claude Code와 OpenAI 로고가 바뀐다. 다크와 라이트 두 파일을 만들고 `<picture>`로 고른다.

## 갱신 주기

GitHub는 README 이미지를 camo 프록시로 캐시한다. raw.githubusercontent.com의 max-age가 5분이라 푸시 뒤 몇 분 안에 새 SVG가 보인다. 바로 새로 받게 하려면 URL 뒤에 `?v=<아무 값>`을 붙인다.
