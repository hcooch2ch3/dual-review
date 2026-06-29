# Dual-Review 파일 기반 결과 회수 패치 — 설계

작성: 2026-06-30
상태: 설계 승인됨 (구현 대기)
대상 파일: `skills/dual-review/SKILL.md` (이 레포 = source of truth)

## 문제

`dual-review` 스킬로 두 리뷰어를 병렬 실행할 때, **Agent로 띄운 리뷰어의 상세 findings가 회수되지 않고 "Verdict: SHIP" 같은 깡통 문구만 반환되는** 버그가 있다.

### 근본 원인

서브에이전트의 반환값 = 에이전트의 **"마지막 메시지" 단 하나**.

1. 에이전트가 리뷰 본문을 작성 (진짜 deliverable, 중간 턴)
2. 하니스가 자동 메시지를 계속 주입 — `task tools haven't been used...` (Claude Code 내장 리마인더), omc 플러그인 hook, 백그라운드 `<task-notification>`
3. 에이전트가 그 노이즈에 반응해 추가 턴 생성
4. 하니스는 **마지막 턴만** 반환 → 리뷰 본문(1단계) 유실

`codex:adversarial-review`가 멀쩡했던 이유: **결과를 출력 파일에 쓰고 호출자가 그 파일을 읽기** 때문. "마지막 메시지" 구조에 안 걸린다. (대조군으로 원인 입증됨)

## 설계

핵심은 **codex가 이미 하는 파일 기반 회수를 모든 Agent 슬롯으로 일반화**하는 것. 버그가 구조적이라 superpowers 한 곳만 특수처리하면 다른 Agent 리뷰어(primary/universal-floor/meta)는 그대로 노출된다.

### 1. 파일이 유일한 deliverable

primary / adversarial / universal-floor / meta-reviewer 등 **Agent()로 띄우는 모든 슬롯**의 dispatch 프롬프트에 다음을 추가한다:

> "전체 리뷰를 `<output_path>`에 써라. 모든 finding을 severity와 file:line과 함께. **너의 마지막 채팅 메시지는 무시된다 — 파일만 회수된다.** 파일 끝을 반드시 `===END-OF-REVIEW===` 한 줄로 마감해라."

마지막 메시지를 명시적으로 무효화 → 에이전트가 본문을 채팅이 아니라 파일에 쏟게 강제한다. codex(Bash + 파일)는 이미 이 계약을 따르므로 변경 없음.

### 2. 출력 경로 규칙

환경 독립적인 OS 임시 디렉터리 하위에, 루프/재시도 충돌을 막는 좌표를 모두 담는다:

```
${TMPDIR:-/tmp}/dual-review/<run-id>/round<N>-<slot>-try<M>.md
```

- `run-id` = 스킬 시작 시 `date +%s`로 **한 번** 스탬프 (전체 실행 동안 고정)
- `round<N>` = 재리뷰 라운드 (Process Step 4). round1, round2 ... → 이전 라운드의 오래된 파일 오독 방지
- `slot` = `primary` | `adversarial` | `meta`
- `try<M>` = 안전판 재디스패치 카운터 (try1 원본, try2 재시도) → 원본 파일과 충돌 방지

세션 종료 시 OS가 `${TMPDIR}`를 정리하므로 잔여물 청소 부담 없음. 레포를 오염시키지 않음.

### 3. 회수 = 완결성 체크 (단순 존재 아님)

가장 위험한 실패는 "빈 파일"이 아니라 **부분/오래된 파일** — 원래 버그가 자리만 옮겨 재현되는 경로다. 그래서 "Read both reports" 단계는 각 파일에 대해 세 조건을 모두 본다:

- 파일 존재 **AND**
- `===END-OF-REVIEW===` 마커 포함 **AND**
- 최소 길이 통과 (자명한 빈/스텁 파일 거름)

셋 다 만족 → 정상 회수. 하나라도 실패 → **부분 실패로 간주**한다. 마커 체크가 "부분 파일"을 보이지 않던 상태에서 탐지 가능한 상태로 바꾼다.

### 4. 안전판: 1회 재디스패치 → degraded

부분 실패 시:

1. 같은 슬롯을 **1회** 재디스패치 (`try2` 경로로)
2. 그래도 완결성 체크 실패 시 → 반환 텍스트라도 fallback으로 쓰되, synthesis 헤더에 명시:
   ```
   Reviewer X: <name> (degraded — no complete file, fell back to return text)
   ```

무한 루프 없음. 한쪽 리뷰어가 끝내 실패해도 나머지 한쪽 + degraded 표기로 진행 (한쪽만 죽어 전체가 멈추지 않음). 투명하게 보고.

### 5. 부수 효과 — 구조 단순화

패치 후 codex(이미 파일 기반)와 Agent 슬롯이 **전부 "파일에서 Read"** 로 통일된다. "Read both reports" 단계가 codex만 특수처리하던 분기를 없앤다. 버그픽스이자 단순화.

## 수정 대상 (SKILL.md 내부)

- **Dispatch Templates** (현재 line ~188–231): 모든 Agent 템플릿에 output_path 인자 + "파일이 유일한 deliverable" + END 마커 지시 추가. codex 템플릿은 경로 규칙만 정렬.
- **Process Step 1 (Parallel dispatch)**: run-id 스탬프 + 경로 규칙 명시.
- **Process "Read both reports" 단계**: 반환 텍스트가 아니라 파일에서 Read + 완결성 체크 + 안전판 절차로 교체.
- **Synthesis Template 헤더**: `degraded` 표기 라인 추가.
- **Meta-review dispatch**: meta-reviewer도 동일하게 파일 출력 + 회수.

## 범위

- **포함:** `skills/dual-review/SKILL.md` 만 수정 (프롬프트/절차 텍스트).
- **제외:** 글로벌 `~/.claude/CLAUDE.md` 2층 방어 (별도 작업).
- **배포:** 레포 = source of truth. 수정 후 활성본 `~/.claude/skills/dual-review/`로 sync해야 로컬에 적용됨.

## 검증 (경험적 — 필수)

SKILL.md를 읽는 것만으로는 증명 안 됨 (그냥 프롬프트 텍스트). Acceptance test:

1. 패치된 SKILL.md를 활성본 `~/.claude/skills/dual-review/`로 sync
2. 실제 dual-review 1회 재실행 (Agent 슬롯에 superpowers/oh-my-claudecode 리뷰어 포함되도록)
3. superpowers findings가 **파일에서** 정상 회수되고, synthesis에 상세 finding이 (깡통 문구 아니라) 실제로 들어오면 성공
4. (선택) 의도적으로 부분 파일을 만들어 안전판 재디스패치가 도는지 확인

## 잔여 리스크

- 에이전트가 END 마커 지시 자체를 무시할 수 있음 → 안전판 재디스패치로 1차 커버, 그래도 실패 시 degraded로 가시화.
- `${TMPDIR}` 미설정 환경 → `/tmp` fallback으로 커버.
