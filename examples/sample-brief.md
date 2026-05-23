# Sample synthesis brief

An actual output produced by `dual-review` on a small change (single new file added to a project). Edited lightly for clarity. This is what the skill emits — your callers (or your own reading) get this exact shape.

---

```
# Dual Review Synthesis

Invoked by: user (mode: interactive)
Reviewer A: oh-my-claudecode:code-reviewer (pinned)
Reviewer B: codex:adversarial-review (pinned)
meta-verifier: not-fired

## ✅ Accept — 양쪽 독립 합치
- (none)

## ✅ Accept — 단일 리뷰어, 기술적으로 타당
- (none)

## ❌ Reject
- (none)

## Open Questions
- (none)
```

Both reviewers approved a 1-line file. Sections are mandatory and always present (even when empty) so automation callers can parse a stable schema.

---

A more realistic example, reviewing a 4-file refactor:

```
# Dual Review Synthesis

Invoked by: ralph-with-dual-review (mode: programmatic)
Reviewer A: oh-my-claudecode:code-reviewer (pinned)
Reviewer B: codex:adversarial-review (pinned)
meta-verifier: not-fired

## ✅ Accept — 양쪽 독립 합치
- [src/auth/session.ts:42] Missing nil check on refresh-token expiry path — Severity: Critical (raw: CRITICAL, both reviewers)
  - Suggested fix direction: gate the refresh on `expiresAt && Date.now() < expiresAt`; return null otherwise

## ✅ Accept — 단일 리뷰어, 기술적으로 타당
- [src/auth/session.test.ts:12] No test covers the simultaneous-refresh race — Severity: Important — raised by: code-reviewer
  - Suggested fix direction: add a test that triggers two refreshes within the same tick and asserts only one network call

## ❌ Reject
- Naming preference: `Session` vs `UserSession` — out of scope for this PR

## Open Questions
- Should refresh failures bubble as exceptions or be swallowed silently? A says exceptions (callers must know); B says silent + log (UI shouldn't crash). Decision needed before next iteration.
```

When `## Open Questions` is non-empty, automation callers (e.g., `ralph-with-dual-review`) stop the loop and escalate to the user.
