# grumble

> what the model muttered

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Youkamii/grumble/main/public/grumble-dark.svg">
  <img alt="grumble" src="https://raw.githubusercontent.com/Youkamii/grumble/main/public/grumble-light.svg" width="640">
</picture>

AI 코딩 에이전트가 일하다 혼자 중얼거린 말을 README에 띄운다.
Claude Code와 Codex의 로컬 세션 로그에서 문장을 골라 경로와 이름을 가린 뒤 타이핑되는 SVG로 만든다.

## 쓰기

```bash
bun install
bun run scan        # 로그 읽기
bun run preview     # 뭐가 올라갈지 보기
bun run publish     # SVG 만들고 commit, push
bun run register    # 6시간마다 자동 publish (Windows)
```

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/<you>/grumble/main/public/grumble-dark.svg">
  <img src="https://raw.githubusercontent.com/<you>/grumble/main/public/grumble-light.svg" width="640">
</picture>
```

## 모으는 것

- 답하기 전에 남긴 추론 요약
- "제가 잘못 봤네요" 같은 정정
- 답변 끝의 `꿍시렁:` 한 줄

마지막 것은 모델에게 자리를 줘야 나온다. 아래 문장을 `~/.claude/CLAUDE.md`와 `~/.codex/AGENTS.md`에 넣는다.

> 작업 중 뭔가 꼬였거나 어이없을 때만, 응답 맨 끝에 `꿍시렁:`으로 시작하는 반말 한 줄을 남긴다. 경로와 이름은 넣지 않는다.

Codex는 `~/.codex/config.toml`에 `model_reasoning_summary = "detailed"`가 있어야 요약을 남긴다.

## 가리는 것

경로, URL, 이메일, 비밀 키, 파일명, 계정명, 프로젝트명, 긴 인용은 전부 `[path]` `[url]` 같은 표시로 바뀐다. 원문은 `~/.grumble/`에만 있고 저장소에 올라가지 않는다. 그래도 발행 전에 `preview`로 한 번 보는 게 좋다.

문장을 고르는 방식, 재미 판정, 원격 기계 동기화, 렌더링은 [docs/how-it-works.md](docs/how-it-works.md)에 있다.

## 라이선스

MIT. Noto Sans KR은 SIL Open Font License 1.1.
