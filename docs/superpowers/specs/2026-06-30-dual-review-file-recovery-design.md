# Dual-Review 결과 회수 패치 — 설계 v3 (트랜스크립트 회수)

작성: 2026-06-30
상태: v2 메커니즘이 round2 dual-review에서 **경험적으로 검증됨**. round2 findings 6건 반영해 v3 정제. 다음 단계 = SKILL.md 구현 → 구현 diff에 dual-review.
대상 파일: `skills/dual-review/SKILL.md` (이 레포 = source of truth)

## v3 변경 요약 (round2 dual-review 반영)

round2(primary=oh-my-claudecode:code-reviewer, adversarial=codex)가 메커니즘은 검증하되 구현 전 막아야 할 6건을 확정. 모두 반영:

1. **nonce 마커** — `===BEGIN-REVIEW-<nonce>===`/`===END-REVIEW-<nonce>===`. artifact가 마커 토큰을 인용해도(이 도메인에선 흔함) front-truncate/인젝션 불가. (C1)
2. **최장-블록 fallback을 성공 경로에서 제거** — 마커 쌍 없으면 회수 실패. 최장 블록은 INVALID 하의 진단 표시용으로만. (T1-a)
3. **완료 notification 게이트** — background 디스패치는 launch 즉시 경로를 주므로, 반드시 완료 `<task-notification>` 후에만 녹취록을 파싱. partial transcript 읽기 금지. (T1-b)
4. **DEGRADED_BLOCKING + hard-stop** — 회수 실패 리뷰어는 기계판독 필드로 격하 표시, 양쪽 실패는 hard-stop(빈 synthesis 금지), N=1은 사용자 고지 + 다른 에이전트로 재시도 에스컬레이션. (T1-c)
5. **추출기 출력 상한** — raw-read 금지 지시와 화해: 추출 스크립트 stdout에 ≤N KB 상한. (I4)
6. **재시도 시 새 output_file 사용** — 재디스패치는 새 agentId/경로 → stale 녹취록 재파싱 금지. (M1)

## v1이 무효가 된 이유 (round1 dual-review 핵심)

v1은 "모든 Agent 리뷰어가 결과를 **파일에 쓰게** 하고 그 파일을 읽자"였다. round1 dual-review(primary=oh-my-claudecode:code-reviewer, adversarial=codex)가 **치명 결함**을 잡았고, 직접 검증됨:

1. **기본/핀 리뷰어는 Write 도구가 없다.** `oh-my-claudecode:code-reviewer`, `critic`, `architect` 등은 "All tools except Write, Edit"로 실행된다(에이전트 레지스트리에서 확인). → "파일에 써라"가 기본 슬롯에서 원천 불가 → v1은 버그를 그대로 재현.
2. **근본 원인이 "파일"이 아니었다.** codex가 견고한 진짜 이유는 결과를 파일에 써서가 아니라, **codex의 출력이 Bash stdout으로 전량 캡처되기 때문**(codex-companion.mjs는 `console.log`/`process.stdout.write`로 출력, `===END-OF-REVIEW===` 마커 없음 — grep으로 확인). 턴 수와 무관하게 캡처된다는 게 핵심.

추가로 이 session 자체가 증거다: round1의 primary 리뷰어가 `Idle. No pending work.` 깡통만 반환했고(버그 라이브 재현), 오케스트레이터가 **하니스가 저장한 녹취록에서 리뷰 본문을 파싱해 복구**했다. 그 복구 동작이 곧 올바른 메커니즘.

## 진짜 근본 원인 (재정의)

서브에이전트의 **반환값 = 마지막 assistant 메시지 하나**. 하니스 노이즈(자동 리마인더, hook, task-notification)가 추가 턴을 유발하면 리뷰 본문이 든 이전 턴이 반환에서 탈락한다.

핵심 통찰: **하니스는 에이전트의 모든 턴을 녹취록 파일에 이미 저장한다.** background로 디스패치하면 그 경로가 반환된다(`output_file: .../tasks/<agentId>.output`, JSONL). 본문은 반환값에서만 사라질 뿐 **녹취록에는 남아 있다.** 회수 채널을 "반환 텍스트"에서 "녹취록"으로 바꾸면 노이즈/마지막메시지 구조와 완전 독립이 된다 — 그리고 에이전트의 Write 권한이 전혀 필요 없다.

## 설계 v2

### 1. 리뷰어는 그냥 평소처럼 출력 + nonce 양끝 마커

디스패치 시 오케스트레이터가 슬롯·시도마다 **고유 nonce**(짧은 random hex)를 만들어 프롬프트에 주입한다:

> "최종 리뷰를 한 메시지로 출력하라. 그 메시지를 `===BEGIN-REVIEW-<nonce>===` 줄로 시작하고 `===END-REVIEW-<nonce>===` 줄로 끝내라. nonce는 `<주입된 값>`. (파일을 만들 필요 없다 — 평소 응답으로 충분하다.)"

마커는 **에이전트의 일반 채팅 출력**에 들어간다 → Write 도구 불필요(v1 CRITICAL 해소). 녹취록은 그 턴을 그대로 보존하므로, 이후 노이즈로 빈 턴이 추가돼도 마커로 감싼 본문은 녹취록에 남는다.

**nonce가 핵심**: 리뷰 대상 artifact가 마커 문자열을 인용해도(스펙/플랜 리뷰에선 흔함 — 이 문서 자체가 그렇다) nonce가 달라 충돌하지 않는다. "마지막 마커 쌍" 추출이 artifact 인용 마커에 걸려 본문을 front-truncate하던 문제(round2 C1)와 프롬프트 인젝션을 동시에 차단한다.

codex 슬롯은 변경 없음 — 이미 stdout으로 전량 반환하며 그 자체가 완전한 회수 채널이다(마커 불요).

### 2. 회수 = 반환 텍스트가 아니라 녹취록에서 추출

새 prose 단계 **Step 1.5 — 리뷰 회수**(기존 "Read both reports"는 digraph 노드일 뿐 prose가 없어 신설). 각 Agent 슬롯에 대해:

1. **완료 게이트**: 그 에이전트의 완료 `<task-notification>`(`status=completed`)을 받은 **뒤에만** 진행한다. background 디스패치는 launch 즉시 `output_file` 경로를 반환하지만 그 시점 녹취록은 미완성이다 — 완료 전 파싱 금지(round2 T1-b: partial transcript 읽으면 마커 없음→false-INVALID).
2. 디스패치가 반환한 `output_file`(JSONL 녹취록) 경로를 잡는다.
3. **bounded 스크립트로** 녹취록을 파싱한다(절대 raw 파일을 통째로 Read하지 않는다 — 하니스가 명시 금지, 컨텍스트 오버플로). `message.role=="assistant"`의 `content[].type=="text"` 블록만 대상. **이 슬롯의 nonce**로 감싼 `===BEGIN-REVIEW-<nonce>===`…`===END-REVIEW-<nonce>===` **최외곽** 내용을 추출. 추출기 stdout은 **≤N KB 상한**으로 자른다(I4: raw-read 금지와의 화해 근거).
4. nonce 마커 쌍이 없으면 → **회수 실패**(아래 3절). 최장 블록은 성공 경로로 쓰지 않고 INVALID 진단 표시용으로만 노출한다(round2 T1-a: 마커 없는 자발적 텍스트를 evidence로 합성 금지).
5. codex/Bash 슬롯은 이 게이트에서 **면제** — 자체 stdout이 완전한 회수 채널이다(채널이 아니라 **포맷**만 다름: Agent=JSONL, codex=plain stdout). codex stdout은 background면 동일하게 `tasks/<id>.output`에 있고 그대로 사용.

추출은 오케스트레이터(스킬 실행 컨텍스트)에서 작은 node 스크립트로 수행하고, **추출된 블록만**(상한 적용) 컨텍스트로 가져온다.

### 3. 완결성 체크 + fail-closed

추출 결과가 다음이면 **회수 성공**: 해당 슬롯 nonce 마커 쌍으로 감싸짐 **AND** 최소 길이 통과(구체 byte floor 명시). nonce 마커 쌍이면 freshness/ownership 문제가 발생하지 않는다 — 녹취록은 그 에이전트의 그 실행 것이고, 고유 `output_file` 경로 + 고유 nonce라 타-run/artifact-인용 혼선이 구조적으로 불가능(임시 디렉터리/run-id 스킴 자체가 불필요).

실패(nonce 마커 없음) 시:

1. 같은 슬롯 **1회 재디스패치**. 재시도는 **새 agentId/새 output_file/새 nonce**를 받으므로 stale 녹취록 재파싱이 아니다(M1). 재시도가 입력을 안 바꾼다는 지적을 반영해 프롬프트는 "마커는 반드시 별도 줄, 그 사이에 전체 리뷰"를 강화. N=1로 떨어진 경우 가능하면 discovery 체인의 **다른 에이전트로 에스컬레이션**.
2. 그래도 실패 → 해당 리뷰어를 **INVALID로 표기**하고 fail-closed:
   - 합의/부재 추론에서 제외(absence-inference 금지), 깡통 반환 텍스트를 evidence로 합성 금지.
   - synthesis 헤더에 **기계판독 필드** `Review integrity: DEGRADED_BLOCKING` + `Reviewer X: INVALID (recovery failed — excluded)` 기록. 다운스트림 자동화 caller가 정상 승인으로 오인하지 않도록 정상 Accept 의미를 차단한다(round2 T1-c: 헤더 한 줄로는 부족).
   - **양쪽 INVALID = hard-stop**: 빈/허위 synthesis를 내지 않고 "총 회수 실패"를 사용자에게 보고하고 중단.
   - **N=1(한쪽만 valid)**: cross-consensus(Tier 1)가 구조적으로 불가하고 모든 finding이 Tier 2로 붕괴함을 헤더에 명시 — "dual review가 single review로 격하됨"을 사용자에게 고지.

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

- 에이전트가 nonce 마커 지시를 무시할 수 있음 → 1회 재디스패치(다른 에이전트로 에스컬레이션 가능)로 2차, 그래도 실패 시 INVALID로 가시화(은폐 안 함, 깡통 텍스트 합성 안 함).
- **하니스 내부 결합(최상위 리스크)**: `output_file`/`canReadOutputFile`/`tasks/<agentId>.output` 스킴과 JSONL 포맷은 미문서화 하니스 내부(검증 버전 v2.1.177). 미래 하니스가 경로/포맷을 바꾸면 회수가 깨질 수 있다 — 다만 fail-closed 설계상 **깨지면 마커 부재→INVALID로 안전하게 degrade**(오염 합성이 아니라). 파서는 "assistant content 배열의 text 블록"이라는 안정적 구조만 가정.
- foreground(비-background) 디스패치는 `output_file`을 안 줄 수 있음 → 회수는 `run_in_background: true`를 전제로 한다(스킬이 이미 그렇게 함).
- `/private/tmp` 등 임시 경로 수명: 긴 세션에서 회수가 지연되면 파일이 GC될 수 있음 → 완료 notification 직후 회수한다.
