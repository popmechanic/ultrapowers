# Ultrapowers — Report Format

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
      "properties": { "task": {"type":"string"}, "status": {"type":"string"}, "branch": {"type":"string"}, "headSha": {"type":"string"},
        "commit": {"type":"string"}, "reviewVerdict": {"type":"string"}, "notes": {"type":"string"},
        "tier": {"type":"string"}, "review": {"type":"string"}, "fixIterations": {"type":"integer"} } } },
    "tests": { "type": "object", "properties": { "command": {"type":"string"}, "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "baseline": { "type": "object", "properties": { "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "waveMerges": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "status": {"type":"string"}, "headSha": {"type":"string"},
        "command": {"type":"string"}, "detail": {"type":"string"}, "branches": {"type":"array","items":{"type":"string"}} } } },
    "blockedWaves": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "detail": {"type":"string"} } } },
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
| `tasks` | yes | One entry per task; `status` is `done` or `failed`; dependency-blocked and budget-deferred tasks are reported as strings in `unfinished`, not as `tasks[]` entries |
| `tasks[].branch` | no | Worktree branch used for the task |
| `tasks[].headSha` | no | The implementer's final worktree HEAD (what the merge agent merges); distinct from `commit` below |
| `tasks[].commit` | no | The implementer's final commit on the task's worktree branch (self-reported); the integration merge SHA lives in `waveMerges[].headSha` |
| `tasks[].reviewVerdict` | no | Review outcome. Merged tasks: `clean` (passed first review) or `fixed` (passed after the fix round). Failed tasks: `not-reviewed` (implementer BLOCKED/NEEDS_CONTEXT), `fix-loop-exhausted` (blocking issues after the capped fix round), `blocked-after-fix` (implementer blocked during the fix round), `agent-error` (the agent call itself failed), `lost-coordinates` (reported done without branch/headSha — downgraded to failed; see the matching judgmentCalls entry) |
| `tasks[].notes` | no | Free-form notes from the implementing or reviewing subagent (minor review findings and implementer concerns) |
| `tasks[].tier` | no | Resolved model alias the implementer ran at (`haiku`/`sonnet`/`opus`) |
| `tasks[].review` | no | Review depth applied: `lean` (one pass) or `adversarial` (two) |
| `tasks[].fixIterations` | no | Fix rounds consumed (0 = clean on first review) |
| `tests` | yes | Result of the suite run on the integration branch |
| `baseline` | no | Result of the test run setup performed on the integration branch before wave 1; `passed: false` means tasks inherited a red suite |
| `waveMerges` | no | One entry per wave's integration merge: `wave`, `status` (`MERGED`/`CONFLICT`/`TEST_FAILED`/`SKIPPED` (`SKIPPED` = no mergeable branches, integration branch untouched; cascades only when `args.edges` was omitted — an explicitly supplied empty array counts as supplied — and tasks actually ran)), `headSha`, `command`, `detail`, and `branches` (the task IDs submitted to the merge — listed even on a failed merge). Surfaces *how* integration went, not just whether it failed |
| `blockedWaves` | no | Waves whose merge did not land (`wave`, `detail`); later waves were cascade-blocked into `unfinished` |
| `judgmentCalls` | no | Any non-obvious decisions made autonomously during the run — including implementer `DONE_WITH_CONCERNS` concerns, a red baseline, reviewer verdict/severity mismatches, agent errors, budget deferrals (one judgment call at launch-time exhaustion and one for the first mid-run deferral; every deferred task is itemized in `unfinished`), merges reported without a headSha, tasks reported done without mergeable coordinates, an unknown or typo'd per-task review depth or tier (fell back to defaults), an unknown baseline (setup omitted baselinePassed or reported null), and edges that cannot bind for dependency blocking (an endpoint missing from this run's waves — expected on resume re-runs, otherwise a typo — or a dependent not scheduled after its prerequisite), and a failed integration review |
| `unfinished` | yes | Tasks or follow-ups that were deferred or blocked (empty array if none) |
| `completenessFindings` | no | Gaps found by the completeness critic — unmet plan requirements, unverified claims, untested code paths |

## Presentation

When the workflow completes, the main agent renders the report as a concise human-readable summary in this order:

1. **Integration branch** — name of the branch ready for review.
2. **Wave plan** — one line per wave listing which tasks ran in parallel and the wave sequence.
3. **Baseline** — whether the suite was green before any task ran; a red baseline reframes every later test result.
4. **Per-task status** — a compact table or bullet list: task name, status, review verdict, and any notes; include tier, review depth, and fix iterations so the human can judge cost vs. benefit per task.
5. **Wave merges** — one line per wave: merge `status`, the task IDs merged, and the integration `headSha` (or the conflict/failure detail). Lets the human see the integration sequence, not just the final state.
6. **Blocked waves** — any wave whose merge failed after reconciliation, or that cascaded conservatively (zero mergeable branches with `args.edges` omitted), with the failure detail; everything cascade-blocked behind it appears under unfinished. Omit the section only when the array is empty.
7. **Test result** — pass or fail, the command run, and any relevant output excerpt.
8. **Judgment calls** — bullet each non-obvious autonomous decision so the human can spot disagreements early.
9. **Unfinished / completeness findings** — anything deferred, plus the critic's unmet-requirement/unverified-claim/untested-path findings; empty means nothing was left behind.
10. **Post-merge runbook** — the `release`/`manual` tasks excluded at compile time,
   rendered verbatim in document order. Sourced from the Step-2 dispositions (the
   main agent carries it), **not** from the workflow return — the schema above is
   unchanged. Empty runbook means the whole plan was waveable.

This pre-merge review is the **third and final gate** (after plan approval and the Step-3 wave-plan
approval). After the summary the agent names the integration branch and asks the human to choose:

- **Approve** — first gate on the report's `tests.passed`: if false, do NOT hand off; present the failure and offer Redirect instead. If true: `git checkout <integrationBranch>` (finishing-a-development-branch verifies tests on the CURRENT checkout, and the sweep classifies 'merged' against HEAD), then run `bash ${CLAUDE_SKILL_DIR}/scripts/sweep_worktrees.sh` (the deterministic sweep — do not assume the merge agents' prompted cleanup ran; never sweep while another ultrapowers run is active in this repo), then proceed to `superpowers:finishing-a-development-branch`; the orchestrator carries the post-merge runbook and presents it again when that handoff completes.
- **Redirect** — provide corrective instructions; re-run the affected tasks before returning to this gate.
