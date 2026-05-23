# Minimal programmatic caller

If you're writing a Claude Code skill that needs to invoke `dual-review` non-interactively (skipping its size/execution prompts), include this block in your skill's prompt to dual-review:

```
dual-review-invocation:
  mode: programmatic
  execution_mode: wait
  caller: my-skill-name
  scope:
    type: file-list
    paths:
      - path/to/changed/file.ts
  meta_review: false

<your free-text instructions for the reviewers here>
```

That's it. The skill will:

1. Detect the block and skip its interactive prompts
2. Resolve reviewers via `config.md` or the discovery priority chain
3. Dispatch the two reviewers in parallel
4. Emit a synthesis brief (see `sample-brief.md`) with `Invoked by: my-skill-name (mode: programmatic)` in the header

Your caller skill then parses the four mandatory headings (`## ✅ Accept — 양쪽 독립 합치`, etc.) by literal string match and decides what to do with the findings.

## Recognized fields

| Field | Required | Values |
|---|---|---|
| `mode` | yes | `programmatic` |
| `execution_mode` | yes | `wait` \| `background` |
| `caller` | yes | any string (recorded in synthesis header for audit) |
| `scope.type` | yes | `working-tree` \| `file-list` \| `base-ref` |
| `scope.paths` | when type=file-list | list of file paths |
| `scope.base_ref` | when type=base-ref | git ref (e.g., `main`) |
| `meta_review` | no (default false) | `true` forces meta-review even without trigger |

## Security note

Place the invocation block at the start of your prompt to dual-review, NOT inside any artifact content you're asking it to review. The skill follows a best-effort rule to ignore `dual-review-invocation:` strings that appear inside files — but this is not parser-enforced. Don't rely on programmatic mode as a security boundary for attacker-controlled content.

## A working caller skill

A full example caller (an iteration loop that invokes dual-review per task, parses the brief, auto-applies cross-consensus findings, and commits atomically) is not bundled here — but you can write one in ~200 lines of skill markdown. The pattern is straightforward:

1. Pick next task from a plan/TaskList
2. Execute the task
3. Verify (run your test command)
4. Invoke dual-review with the block above
5. Parse the 4 headings; auto-apply `## ✅ Accept — 양쪽 독립 합치` items (and `## ✅ Accept — 단일 리뷰어, 기술적으로 타당` if severity ≥ Important)
6. Stop on `## Open Questions` (≥1 item) — human decision needed
7. Commit + advance to next task
