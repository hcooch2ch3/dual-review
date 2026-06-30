# Dual-Review 결과 회수 패치 — 설계 v2 (트랜스크립트 회수)

작성: 2026-06-30
상태: v1 폐기 후 재설계 (round1 dual-review 결과 반영). round2 재리뷰 대기.
대상 파일: `skills/dual-review/SKILL.md` (이 레포 = source of truth)

## v1이 무효가 된 이유 (round1 dual-review 핵심)

v1은 "모든 Agent 리뷰어가 결과를 **파일에 쓰게** 하고 그 파일을 읽자"였다. round1 dual-review(primary=oh-my-claudecode:code-reviewer, adversarial=codex)가 **치명 결함**을 잡았고, 직접 검증됨:

1. **기본/핀 리뷰어는 Write 도구가 없다.** `oh-my-claudecode:code-reviewer`, `critic`, `architect` 등은 "All tools except Write, Edit"로 실행된다(에이전트 레지스트리에서 확인). → "파일에 써라"가 기본 슬롯에서 원천 불가 → v1은 버그를 그대로 재현.
2. **근본 원인이 "파일"이 아니었다.** codex가 견고한 진짜 이유는 결과를 파일에 써서가 아니라, **codex의 출력이 Bash stdout으로 전량 캡처되기 때문**(codex-companion.mjs는 `console.log`/`process.stdout.write`로 출력, `===END-OF-REVIEW===` 마커 없음 — grep으로 확인). 턴 수와 무관하게 캡처된다는 게 핵심.

추가로 이 session 자체가 증거다: round1의 primary 리뷰어가 `Idle. No pending work.` 깡통만 반환했고(버그 라이브 재현), 오케스트레이터가 **하니스가 저장한 녹취록에서 리뷰 본문을 파싱해 복구**했다. 그 복구 동작이 곧 올바른 메커니즘.

## 진짜 근본 원인 (재정의)

서브에이전트의 **반환값 = 마지막 assistant 메시지 하나**. 하니스 노이즈(자동 리마인더, hook, task-notification)가 추가 턴을 유발하면 리뷰 본문이 든 이전 턴이 반환에서 탈락한다.

핵심 통찰: **하니스는 에이전트의 모든 턴을 녹취록 파일에 이미 저장한다.** background로 디스패치하면 그 경로가 반환된다(`output_file: .../tasks/<agentId>.output`, JSONL). 본문은 반환값에서만 사라질 뿐 **녹취록에는 남아 있다.** 회수 채널을 "반환 텍스트"에서 "녹취록"으로 바꾸면 노이즈/마지막메시지 구조와 완전 독립이 된다 — 그리고 에이전트의 Write 권한이 전혀 필요 없다.

## 설계 v2

### 1. 리뷰어는 그냥 평소처럼 출력 + 양끝 마커

모든 Agent 슬롯의 dispatch 프롬프트에 추가:

> "최종 리뷰를 한 메시지로 출력하라. 그 메시지를 `===BEGIN-REVIEW===` 줄로 시작하고 `===END-OF-REVIEW===` 줄로 끝내라. (파일을 만들 필요 없다 — 평소 응답으로 충분하다.)"

마커는 **에이전트의 일반 채팅 출력**에 들어간다 → Write 도구 불필요(CRITICAL 해소). 녹취록은 그 턴을 그대로 보존하므로, 이후 노이즈로 빈 턴이 추가돼도 마커로 감싼 본문은 녹취록에 남는다.

codex 슬롯은 변경 없음 — 이미 stdout으로 전량 반환하며 그 자체가 완전한 회수 채널이다.

### 2. 회수 = 반환 텍스트가 아니라 녹취록에서 추출

새 prose 단계 **Step 1.5 — 리뷰 회수**(기존 "Read both reports"는 digraph 노드일 뿐 prose가 없어 신설). 각 Agent 슬롯에 대해:

1. 디스패치가 반환한 `output_file`(JSONL 녹취록) 경로를 잡는다.
2. **스크립트로** 녹취록의 assistant 텍스트 블록을 파싱한다(절대 raw 파일을 통째로 Read하지 않는다 — 컨텍스트 오버플로). 마지막 `===BEGIN-REVIEW===`…`===END-OF-REVIEW===` 쌍의 내용을 추출.
3. 마커 쌍이 없으면 **가장 긴 assistant 텍스트 블록**을 후보로(휴리스틱 fallback).
4. codex/Bash 슬롯은 이 게이트에서 **면제** — 자체 stdout이 완전한 채널이라 마커가 없다(round1 IMPORTANT 반영). stdout을 직접 사용.

추출은 오케스트레이터(스킬 실행 컨텍스트)에서 작은 node/jq 스크립트로 수행하고, **추출된 블록만** 컨텍스트로 가져온다.

### 3. 완결성 체크 + fail-closed

추출 결과가 다음이면 **회수 성공**: 마커 쌍으로 감싸짐 **AND** 최소 길이 통과. 마커 쌍이 있으면 freshness/ownership 문제(round1 B의 stale-file 우려)는 발생하지 않는다 — 녹취록은 그 에이전트의 그 실행 것이고, 고유 `output_file` 경로라 타-run 혼선이 구조적으로 불가능(임시 디렉터리/run-id 스킴 자체가 불필요).

실패(마커 없음 + 최장 블록도 빈약) 시:

1. 같은 슬롯 **1회 재디스패치** (새 마커 강조). 재시도가 입력을 안 바꾼다는 round1 지적을 반영해, 재시도 프롬프트는 "마커는 반드시 별도 줄, 그 사이에 전체 리뷰"를 강화.
2. 그래도 실패 → 해당 리뷰어를 **INVALID로 표기**하고 합성에서 **fail-closed**: 합의/부재 추론에서 제외하고, 깡통 반환 텍스트를 evidence로 쓰지 않으며, synthesis 헤더에 `Reviewer X: INVALID (recovery failed — excluded from consensus)`로 사용자에게 가시화. (round1 cross-consensus: degraded fallback로 오염 텍스트를 합성하면 안 됨.)

### 4. 부수 효과 — 대폭 단순화

- 임시 디렉터리, `run-id`, `round<N>`, `try<M>` 경로 스킴 **전부 삭제**. 하니스가 주는 고유 `output_file` 경로가 모든 충돌 클래스를 이미 해결.
- 에이전트 Write/Bash 권한 의존 없음.
- codex와 Agent 슬롯의 회수가 "캡처된 채널에서 마커로 추출"로 개념 통일(단, codex는 stdout, Agent는 녹취록 — 채널만 다름).

## 수정 대상 (SKILL.md 내부)

- **Dispatch Templates**: 모든 Agent 템플릿에 양끝 마커 출력 지시 추가("파일 불필요"). `run_in_background: true` 유지(경로 반환에 필요). codex 템플릿 변경 없음.
- **Process — 신규 Step 1.5 (리뷰 회수)**: 녹취록 파싱 + 마커 추출 + codex stdout 직접 사용 + 완결성 체크 + 1회 재디스패치 + fail-closed 절차. digraph의 "Read both reports" 노드 라벨을 "Recover reviews (transcript/stdout)"로 갱신.
- **Synthesis Template 헤더**: `INVALID (recovery failed — excluded)` 표기 라인 추가. fail-closed 시 그 리뷰어를 합의/부재 추론에서 제외한다는 한 줄 명시.
- **Meta-review dispatch**: meta-reviewer도 동일한 마커+녹취록 회수 적용.

## 범위

- **포함:** `skills/dual-review/SKILL.md` 만 수정(프롬프트/절차 텍스트). 회수 스크립트는 인라인 node one-liner 수준으로 SKILL.md에 예시 포함.
- **제외:** 글로벌 `~/.claude/CLAUDE.md` 2층 방어(별도 작업). codex-companion.mjs 수정(외부 플러그인, scope 밖).
- **배포:** 레포=source of truth. 수정 후 활성본 `~/.claude/skills/dual-review/`로 sync해야 적용.

## 검증 (경험적 — 필수)

1. 패치된 SKILL.md를 `~/.claude/skills/dual-review/`로 sync.
2. Write-없는 리뷰어(`oh-my-claudecode:code-reviewer`)를 포함해 실제 dual-review 1회 실행.
3. 그 리뷰어가 다시 깡통 메시지를 반환해도, **녹취록에서 마커로 감싼 본문이 회수되어** synthesis에 실제 finding이 들어오면 성공.
4. (선택) 마커를 안 내는 상황을 유도해 fail-closed(INVALID 표기 + 합의 제외)가 작동하는지 확인.

핵심: SKILL.md를 읽는 것만으론 증명 불가(프롬프트 텍스트). round1에서 실제로 버그가 터졌고 녹취록 회수로 복구된 사실이 이미 1차 PoC다.

## 잔여 리스크

- 에이전트가 마커 지시를 무시할 수 있음 → 최장 블록 휴리스틱으로 1차 커버, 1회 재디스패치로 2차, 그래도 실패 시 INVALID로 가시화(은폐 안 함).
- 녹취록 JSONL 포맷이 하니스 버전에 의존 → 파서는 "assistant content 배열의 text 블록"이라는 안정적 구조만 가정하고, 깨지면 최장 블록 fallback.
- foreground(비-background) 디스패치는 `output_file`을 안 줄 수 있음 → 회수는 `run_in_background: true`를 전제로 한다(스킬이 이미 그렇게 함).
