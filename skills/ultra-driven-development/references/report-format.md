# Ultra-Driven Development — Report Format

The workflow produces a single structured report object that the main agent presents at the pre-merge human gate.

## Schema

```json
{ "type": "object",
  "required": ["integrationBranch", "waves", "tasks", "tests", "unfinished"],
  "properties": {
    "integrationBranch": { "type": "string" },
    "waves": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } },
    "dependencyEdges": { "type": "array", "items": { "type": "string" } },
    "tasks": { "type": "array", "items": { "type": "object",
      "required": ["task", "status"],
      "properties": { "task": {"type":"string"}, "status": {"type":"string"}, "branch": {"type":"string"},
        "commit": {"type":"string"}, "reviewVerdict": {"type":"string"}, "notes": {"type":"string"} } } },
    "tests": { "type": "object", "properties": { "command": {"type":"string"}, "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "judgmentCalls": { "type": "array", "items": { "type": "string" } },
    "unfinished": { "type": "array", "items": { "type": "string" } },
    "completenessFindings": { "type": "array", "items": { "type": "string" } } } }
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `integrationBranch` | yes | Branch where all task branches were merged |
| `waves` | yes | Ordered list of waves; each wave is a list of task IDs that ran in parallel |
| `dependencyEdges` | no | Human-readable edges that shaped wave order, e.g. `"task-2 → task-4"` |
| `tasks` | yes | One entry per task; `status` is one of `done`, `failed`, `skipped` |
| `tasks[].branch` | no | Worktree branch used for the task |
| `tasks[].commit` | no | Merge commit SHA on the integration branch |
| `tasks[].reviewVerdict` | no | Verdict from the code-review subagent, e.g. `"clean"`, `"fixed"`, `"warnings"` |
| `tasks[].notes` | no | Free-form notes from the implementing or reviewing subagent |
| `tests` | yes | Result of the suite run on the integration branch |
| `judgmentCalls` | no | Any non-obvious decisions made autonomously during the run |
| `unfinished` | yes | Tasks or follow-ups that were deferred or blocked (empty array if none) |
| `completenessFindings` | no | Gaps spotted during review that exceed the original spec |

## Presentation

When the workflow completes, the main agent renders the report as a concise human-readable summary in this order:

1. **Integration branch** — name of the branch ready for review.
2. **Wave plan** — one line per wave listing which tasks ran in parallel and the wave sequence.
3. **Per-task status** — a compact table or bullet list: task name, status, review verdict, and any notes.
4. **Test result** — pass or fail, the command run, and any relevant output excerpt.
5. **Judgment calls** — bullet each non-obvious autonomous decision so the human can spot disagreements early.
6. **Unfinished / completeness findings** — anything deferred or out-of-scope discovered during the run; empty means nothing was left behind.

After the summary the agent names the integration branch and asks the human to choose:

- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge, clean up worktrees, and close the plan.
- **Redirect** — provide corrective instructions; the workflow re-enters the execution loop for the affected tasks before returning to this gate.
