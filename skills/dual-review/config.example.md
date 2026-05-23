---
# Dual Review — reviewer pin configuration (example)
#
# Copy this file to `config.md` in the same directory and UNCOMMENT only
# the keys you want to pin. All keys below are commented by default so a
# fresh copy is inert — the skill will fall back to the priority tables
# in SKILL.md until you opt in.
#
# If a pinned agent is not available on the current machine, the skill
# falls back to discovery for that slot only and announces the
# substitution in the synthesis header.

# Primary slot — domain code/spec quality reviewer.
# Examples:
#   oh-my-claudecode:code-reviewer
#   superpowers:code-reviewer
#   general-purpose
# primary: oh-my-claudecode:code-reviewer

# Adversarial slot — approach challenger. Should differ from `primary`
# in prompt framing or model lineage.
# Examples:
#   codex:adversarial-review
#   oh-my-claudecode:critic
#   oh-my-claudecode:architect
#   superpowers:code-reviewer
#   general-purpose
# adversarial: codex:adversarial-review

# Optional — only needed when `adversarial` is `codex:adversarial-review`
# and the codex-companion entry point isn't on PATH or the default
# location. Absolute path recommended.
# adversarial_command: 'node "/absolute/path/to/codex-companion.mjs" adversarial-review'

# Optional — agents that must NEVER be selected for either slot, even
# if they appear in the discovery priority chain or are pinned.
# Use this to exclude agents that share a namespace with a valid
# reviewer but serve a different purpose (rescue, setup, etc.).
# Uncomment if you have those plugins installed and want the safety.
# deny:
#   - codex:rescue          # diagnosis/fix subagent, NOT a reviewer
#   - codex:setup           # interactive CLI setup, NOT a reviewer
#   - codex:codex-rescue    # alias of codex:rescue in some plugin builds
---

# Notes

- This file is a YAML-frontmatter-only config; the body is documentation.
- Do NOT commit your personal `config.md` to a shared repo — keep only
  `config.example.md` under version control and add `config.md` to
  `.gitignore` when you publish this skill.
