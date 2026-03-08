# AI Debate - 터미널 AI Agent 끝장 토론 플러그인

터미널에 설치된 AI Agent CLI들(Claude, Codex, Gemini 등)이 4단계 구조화된 토론을 진행하여 합의를 도출하는 Claude Code 플러그인입니다.

API 직접 호출 대신 이미 설치된 터미널 CLI를 활용하여 비용을 절감합니다.

## 설치

```bash
# 마켓플레이스 등록
# Claude Code 안에서 실행
/plugin marketplace add tumblecat44/ai-debate-local

# 플러그인 설치
/plugin install ai-debate@ai-debate-local
```

npm 의존성 없이 바로 사용 가능합니다.

## 사전 요구사항

최소 2개 이상의 AI CLI가 설치되어 있어야 합니다:

| CLI | 설치 확인 | 비대화형 호출 |
|-----|-----------|---------------|
| Claude | `which claude` | `claude -p "prompt"` |
| Codex | `which codex` | `codex exec "prompt"` |
| Gemini | `which gemini` | `gemini -p "prompt"` |
| Kimi | `which kimi` | `kimi --prompt "prompt"` |
| OpenCode | `which opencode` | `opencode -p "prompt"` |
| Qwen | `which qwen` | `qwen -p "prompt"` |
| Aider | `which aider` | `aider --message "prompt"` |

## 사용법

```bash
# 1. 에이전트 감지 및 설정
/ai-debate:debate-setup

# 2. 토론 시작
/ai-debate:debate "원격근무가 사무실근무보다 효율적인가?"

# 3. 이력 조회
/ai-debate:debate-history
```

## 토론 구조

Claude Code가 모더레이터로서 4단계를 자동 진행합니다:

```
Stage 1: 입장 제시 (1회)     각자 페르소나에 맞게 주장
    ↓
Stage 2: 교차 질문 (4회)     서로의 주장에 반박 및 방어
    ↓
Stage 3: 공통점 추출 (2회)   합의 가능한 영역 탐색
    ↓
Stage 4: 합의안 도출 (최대 15회)  [CONSENSUS] 태그로 합의 표시
```

## 페르소나

에이전트에 자동 배정되는 7개 토론 페르소나:

| 페르소나 | 역할 |
|----------|------|
| 🧠 실용주의자 | 현실적 구현 가능성 중시 |
| 💡 이상주의자 | 최선의 결과 추구 |
| 😈 악마의 변호인 | 모든 주장에 반박 |
| 🔬 경험주의자 | 데이터/증거 요구 |
| 🔗 종합주의자 | 관점 통합 시도 |
| 🔄 역발상가 | 비주류 관점 제시 |
| 📊 분석가 | 논리 구조 해체 |

`debate.config.json`에서 커스터마이징 가능합니다.

## 아키텍처

[agent-council](https://github.com/team-attention/plugins-for-claude-natives) 플러그인의 job-based parallel execution 패턴을 기반으로, 멀티라운드 토론으로 확장했습니다.

```
Claude Code (모더레이터)
    │
    ├── debate-job.js (오케스트레이터)
    │   ├── 프롬프트 템플릿 렌더링
    │   ├── 히스토리 빌드 (이전 라운드 → 다음 프롬프트)
    │   └── 합의 체크 ([CONSENSUS] 태그 감지)
    │
    └── debate-job-worker.js (병렬 워커)
        ├── codex exec --skip-git-repo-check "prompt"
        ├── gemini -p "prompt"
        └── ... (detached process, 타임아웃 120초)
```

## 파일 구조

```
ai-debate/
├── .claude-plugin/plugin.json   # 플러그인 메타데이터
├── debate.config.json           # 에이전트/페르소나 설정
├── scripts/
│   ├── debate.sh                # 쉘 엔트리포인트
│   ├── debate-job.js            # 메인 오케스트레이터
│   ├── debate-job-worker.js     # CLI 워커
│   └── detect-agents.sh         # CLI 자동 감지
├── skills/
│   ├── debate/SKILL.md          # 메인 토론 스킬
│   ├── debate-setup/SKILL.md    # 셋업 스킬
│   └── debate-history/SKILL.md  # 이력 조회
├── templates/prompts/           # 스테이지별 프롬프트 템플릿
└── .debates/                    # 런타임 토론 데이터 (gitignore)
```

## License

MIT
