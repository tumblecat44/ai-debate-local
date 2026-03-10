---
name: debate
description: AI 끝장 토론 - 터미널 AI Agent들이 4단계로 토론하여 합의를 도출합니다
---

# AI 끝장 토론

터미널에 설치된 AI Agent CLI들이 4단계 구조화된 토론을 진행합니다.
Claude Code가 모더레이터로서 토론을 진행하고 결과를 정리합니다.

## Arguments

`$ARGUMENTS` = 토론 주제 (없으면 사용자에게 질문)

## Instructions

### Step 0: Pre-flight

debate.config.json을 읽고 설정을 확인합니다.

```bash
cat "{{SKILL_DIR}}/../../debate.config.json"
```

설정이 없거나 에이전트가 부족하면 `/ai-debate:debate-setup` 실행을 안내합니다.

### Step 1: 토론 시작

주제가 `$ARGUMENTS`에 있으면 사용하고, 없으면 AskUserQuestion으로 질문합니다.

토론을 시작합니다:
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" start --topic "$TOPIC" --agents "$AGENTS"
```

결과에서 `debateDir`을 저장합니다.

시작 배너를 출력합니다:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 AI 끝장 토론 시작
주제: [주제]
참여자: [에이전트 목록 with 페르소나]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 2: Stage 1 - 입장 제시 (1 round)

```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" round --debate-dir "$DEBATE_DIR" --stage position --round 1
```

결과를 포맷하여 출력합니다:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📢 Stage 1/4: 입장 제시 | Round 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 Codex (실용주의자):
> [응답...]

💎 Gemini (악마의 변호인):
> [응답...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 3: Stage 2 - 교차 질문 (4 rounds)

4회 반복합니다 (round 1~4):
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" round --debate-dir "$DEBATE_DIR" --stage cross-exam --round $N
```

각 라운드 결과를 동일한 포맷으로 출력합니다.

### Step 4: Stage 3 - 공통점 추출 (2 rounds)

2회 반복합니다 (round 1~2):
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" round --debate-dir "$DEBATE_DIR" --stage common-ground --round $N
```

### Step 5: Stage 4 - 합의안 도출 (만장일치까지 끝장)

전원 합의할 때까지 무한 반복합니다:
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" round --debate-dir "$DEBATE_DIR" --stage consensus --round $N
```

각 라운드 후 합의 체크:
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" check-consensus --debate-dir "$DEBATE_DIR" --round $N
```

`consensus: true`이면 반복을 중단합니다.

### Step 6: 마무리

결과를 마크다운으로 컴파일합니다:
```bash
node "{{SKILL_DIR}}/../../scripts/debate-job.js" finalize --debate-dir "$DEBATE_DIR"
```

output.md를 읽어서 최종 결과를 사용자에게 표시합니다.

마무리 배너:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 토론 완료!
합의: ✅ N라운드에서 달성 / ❌ 미달성
파일: .debates/debate-XXXXX/output.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Error Handling

| 상황 | 처리 |
|------|------|
| CLI 미설치 | 해당 에이전트 스킵, 남은 에이전트로 계속 (최소 2개) |
| 타임아웃 | 해당 라운드 "기권" 처리, 다음 라운드 진행 |
| 에이전트 에러 | "[에이전트] 응답 실패" 표시 후 계속 |
| 1개만 남음 | 토론 조기 종료, 부분 결과 저장 |
