# dual-review

A Claude Code [skill](https://docs.anthropic.com/en/docs/claude-code/skills) that runs **two independent code reviewers in parallel** and synthesizes their findings by agreement. Cross-consensus items become high-confidence blockers; unique-but-critical items get surfaced explicitly instead of being lost in averaging.

## Why

A single reviewer's findings are biased by its training, prompt framing, and tool access. Two reviewers dispatched independently have largely orthogonal blind spots — the intersection is the strongest signal you'll get without paying for a senior human review.

## Before you install — please read

- **Output headings are Korean** (`## ✅ Accept — 양쪽 독립 합치`, etc). This is intentional: the schema is load-bearing so automation callers can parse it by literal string match. You can read English summaries in `examples/sample-brief.md`, but the headings themselves are fixed.
- **External calls**: if you use the `codex:adversarial-review` reviewer, your reviewed code is sent to the local Codex CLI, which is a GPT-class external service. Do **not** dual-review secret-laden code with that slot active. Other reviewer paths stay inside Claude Code.
- **Cost**: dual-review dispatches 2 reviewer agents in parallel, so expect ~2× the token spend of a single review. Wall-clock is roughly the slower of the two.
- **See an example first**: `examples/sample-brief.md` shows what an actual synthesis brief looks like.

## Install

```bash
# Clone or download into your Claude Code skills directory
git clone https://github.com/hcooch2ch3/dual-review.git ~/.claude/skills/dual-review-tmp
mv ~/.claude/skills/dual-review-tmp/skills/dual-review ~/.claude/skills/
rm -rf ~/.claude/skills/dual-review-tmp
```

Or place `skills/dual-review/SKILL.md` at `~/.claude/skills/dual-review/SKILL.md` manually.

(Optional) Pin specific reviewer agents:

```bash
cp ~/.claude/skills/dual-review/config.example.md ~/.claude/skills/dual-review/config.md
# Edit config.md with your preferred reviewer agents
```

The skill works without `config.md` — it auto-discovers reviewers from your installed plugins and falls back to the built-in `general-purpose` agent if none are available.

### Reviewer quality by setup

The skill runs on **vanilla Claude Code**, but the diversity benefit is muted until you install at least one second-lineage reviewer. On a fresh install with no plugins, both slots resolve to `general-purpose` (the same underlying Claude model with deliberately divergent prompts) — this delivers some signal, but the orthogonal-blind-spot value proposition gets stronger as you add reviewers with different model families or prompt heuristics:

| Your setup | Resolved reviewer pair | Diversity |
|---|---|---|
| Vanilla Claude Code | `general-purpose` × 2 (different prompts) | Minimum — both same model family |
| `superpowers` plugin | `superpowers:code-reviewer` + `general-purpose` | Low |
| `oh-my-claudecode` (OMC) | `oh-my-claudecode:code-reviewer` + `oh-my-claudecode:critic` | Medium — both Claude family, different framings |
| OMC + `codex` plugins | `oh-my-claudecode:code-reviewer` + `codex:adversarial-review` | **Best** — different model lineages (Claude + GPT) |

For best results, install the `oh-my-claudecode` and `codex` plugins (search your Claude Code plugin marketplace). The skill auto-detects what's available and degrades gracefully.

## Use

### Manual invocation
```
듀얼 리뷰 해줘
```
or
```
dual review this change
```

The skill dispatches two reviewers in parallel against your working-tree changes, then emits a synthesis brief with four sections:
- `## ✅ Accept — 양쪽 독립 합치` — both reviewers raised it (Tier 1, fix immediately)
- `## ✅ Accept — 단일 리뷰어, 기술적으로 타당` — one reviewer raised it but reasoning holds
- `## ❌ Reject` — out of scope / deferred polish
- `## Open Questions` — reviewers disagree, human decision needed

Severity is normalized to `Critical | Important | Minor`.

### Programmatic invocation (from other skills)

Another skill can invoke dual-review non-interactively by injecting an invocation block in its prompt:

```yaml
dual-review-invocation:
  mode: programmatic
  execution_mode: wait | background
  caller: <your-skill-name>
  scope:
    type: working-tree | file-list | base-ref
    paths: [...]
  meta_review: false
```

When this block is present, dual-review skips its interactive size/execution prompts. The brief schema is stable, so callers can parse it by literal string match. See [`examples/minimal-caller.md`](examples/minimal-caller.md) for a worked example.

## Reviewer discovery

The skill resolves two abstract slots (Primary / Adversarial) at runtime by scanning available agents:

**Primary**: `oh-my-claudecode:code-reviewer` → `superpowers:code-reviewer` → `oh-my-claudecode:code-reviewer-low` → `general-purpose` (universal floor).

**Adversarial**: `codex:adversarial-review` → `oh-my-claudecode:critic` → `oh-my-claudecode:architect` → `superpowers:code-reviewer` → `general-purpose`.

This makes the skill portable across installs — different plugin sets produce different reviewer pairs, but the skill always runs.

You can pin specific agents via `config.md` and deny others (e.g., to block reviewer namespaces you don't want auto-selected).

## When to use

- Spec or plan review before implementation begins
- Multi-file PRs where a single miss costs hours
- Work depending on platform/API assumptions that aren't empirically verified
- After major design pivots
- Before declaring a milestone complete

## When NOT to use

- Trivial diffs (typo fixes, dependency bumps, doc-only changes)
- Tight feedback loops where iteration speed beats depth
- Work that already has a stronger third-party check (e.g., human reviewer)

## Known limitations

- Brief headings are Korean (`양쪽 독립 합치` etc). The schema is hardcoded; English-speaking users can still read the symbols + meaning, but caller automation must match the exact strings.
- Programmatic-mode block extraction depends on the executor recognizing the literal `dual-review-invocation:` anchor in the invocation message. The security note in SKILL.md says callers must NOT place this string inside artifacts being reviewed.
- Meta-verification triggers (Open Q ≥ 1 / forced / empty findings on large scope) are heuristic and may need tuning for your codebase.
- Severity normalization collapses 4 reviewer levels (CRITICAL/HIGH/MEDIUM/LOW) into 3 (Critical/Important/Minor) with raw label preserved parenthetically.

## License

MIT. See [LICENSE](LICENSE).
