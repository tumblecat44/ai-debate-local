# AI Debate - 터미널 AI Agent 끝장 토론 플러그인

터미널에 설치된 AI Agent CLI들(Claude, Codex, Gemini 등)이 4단계 구조화된 토론을 진행하여 합의를 도출하는 Claude Code 플러그인입니다.

## 설치

```bash
# 마켓플레이스 등록 (로컬)
claude /plugin marketplace add /path/to/ai-debate

# 플러그인 설치
claude /plugin install ai-debate@ai-debate
```

## 사용법

```bash
# 에이전트 감지 및 설정
/ai-debate:debate-setup

# 토론 시작
/ai-debate:debate "원격근무가 사무실근무보다 효율적인가?"

# 이력 조회
/ai-debate:debate-history
```

## 토론 구조

| Stage | 이름 | 라운드 | 설명 |
|-------|------|--------|------|
| 1 | 입장 제시 | 1회 | 각 에이전트가 페르소나에 맞는 입장 발표 |
| 2 | 교차 질문 | 4회 | 서로의 주장에 반박 및 방어 |
| 3 | 공통점 추출 | 2회 | 합의 가능한 영역 탐색 |
| 4 | 합의안 도출 | 최대 15회 | [CONSENSUS] 태그로 합의 표시 |

## 지원 CLI

| CLI | 명령 |
|-----|------|
| Claude | `claude -p "prompt"` |
| Codex | `codex exec "prompt"` |
| Gemini | `gemini -p "prompt"` |
| Kimi | `kimi --prompt "prompt"` |
| OpenCode | `opencode -p "prompt"` |
| Qwen | `qwen -p "prompt"` |
| Aider | `aider --message "prompt" --yes --no-git` |

## 페르소나

- 🧠 실용주의자 — 현실적 구현 가능성 중시
- 💡 이상주의자 — 최선의 결과 추구
- 😈 악마의 변호인 — 모든 주장에 반박
- 🔬 경험주의자 — 데이터/증거 요구
- 🔗 종합주의자 — 관점 통합 시도
- 🔄 역발상가 — 비주류 관점 제시
- 📊 분석가 — 논리 구조 해체

## 파일 구조

```
ai-debate/
├── .claude-plugin/plugin.json   # 플러그인 메타데이터
├── debate.config.json           # 에이전트/페르소나 설정
├── scripts/                     # 핵심 엔진
│   ├── debate.sh                # 쉘 엔트리포인트
│   ├── debate-job.js            # 메인 오케스트레이터
│   ├── debate-job-worker.js     # CLI 워커
│   └── detect-agents.sh         # CLI 자동 감지
├── skills/                      # Claude Code 스킬
│   ├── debate/SKILL.md          # 메인 토론 스킬
│   ├── debate-setup/SKILL.md    # 셋업 스킬
│   └── debate-history/SKILL.md  # 이력 조회
├── templates/prompts/           # 프롬프트 템플릿
└── .debates/                    # 런타임 토론 데이터
```
