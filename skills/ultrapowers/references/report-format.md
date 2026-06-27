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
    "acceptance": { "oneOf": [{"type":"null"}, {"type":"object", "properties":
      { "mode": {"type":"string","enum":["waived","sealed","suite"]}, "reason": {"type":"string"},
        "passed": {"type":["boolean","null"]}, "sealId": {"type":"string"},
        "status": {"type":"string"}, "exitCode": {"type":"integer"}, "output": {"type":"string"} }}] },
    "baseline": { "type": "object", "properties": { "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "waveMerges": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "status": {"type":"string"}, "headSha": {"type":"string"},
        "command": {"type":"string"}, "detail": {"type":"string"}, "branches": {"type":"array","items":{"type":"string"}} } } },
    "blockedWaves": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "detail": {"type":"string"} } } },
    "coverage": { "type": "object", "properties": {
      "tasks_merged": {"type":"integer"}, "tasks_planned": {"type":"integer"}, "complete": {"type":"boolean"} } },
    "missingDeliverables": { "type": "array", "items": { "type": "object",
      "properties": { "task": {"type":"string"}, "files": {"type":"array","items":{"type":"string"}} } } },
    "gitVerified": { "type": "boolean" },
    "deferredVerification": { "type": "array", "items": { "type": "object",
      "required": ["deliverable", "reason"],
      "properties": {
        "deliverable": { "type": "string" },
        "reason": { "type": "string", "enum": ["browser", "runtime", "external", "manual"] },
        "why":  { "type": "string" } } } },
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
| `cannotVerify` (per reviewer) | no | Requirements a per-task reviewer could not judge from its own diff — cross-task or unchanged-code claims. Each item is `{ requirement, why }`. The worktree-isolated reviewer LISTS them instead of crawling the repo; the engine COLLECTS them across the task's reviewers and threads them into the completeness critic's prompt as an explicit checklist. When no merge HEAD was recorded (no completeness critic runs), the items surface as judgment calls at the gate rather than being dropped (#2.2). |
| `tasks[].notes` | no | Free-form notes from the implementing or reviewing subagent (minor review findings and implementer concerns) |
| `tasks[].tier` | no | Resolved model alias the implementer ran at (`haiku`/`sonnet`/`opus`) |
| `tasks[].review` | no | Review depth applied: `lean` (one pass) or `adversarial` (two) |
| `tasks[].fixIterations` | no | Fix rounds consumed (0 = clean on first review) |
| `tests` | yes | Result of the suite run on the integration branch |
| `acceptance` | no | Sealed acceptance exam result, placed directly after the test result in presentation order. `null` when no exam was requested. `{ mode: 'waived', reason, passed: null }` when the orchestrator waived the exam. `{ mode: 'sealed', sealId, sha256, status: 'PENDING_GATE', passed: null, note }` — the workflow does NOT administer the sealed exam (it has no shell; relaying the runner's JSON corrupts it, #36). The exam is administered deterministically at the Step 5 gate, where `run_acceptance.sh`'s exit code decides Approve and its JSON is rendered as receipts. `{ mode: 'suite', passed, reason }` when the committed test suite is the acceptance authority — `passed` mirrors `tests.passed` (the integration test result); no held-out exam is dispatched. A `passed: false` result pushes a judgment call requiring the gate to NOT Approve. |
| `baseline` | no | Result of the test run setup performed on the integration branch before wave 1; `passed: false` means tasks inherited a red suite |
| `waveMerges` | no | One entry per wave's integration merge: `wave`, `status` (`MERGED`/`CONFLICT`/`TEST_FAILED`/`SKIPPED`/`DEFERRED`), `headSha`, `command`, `detail`, and `branches` (the task IDs submitted to the merge — listed even on a failed merge). Surfaces *how* integration went, not just whether it failed. Status values: `MERGED` = integrated successfully; `CONFLICT`/`TEST_FAILED` = merge attempt failed (wave is blocked, later waves cascade-blocked); `SKIPPED` = no mergeable branches, integration branch untouched (cascades only when `args.edges` was omitted — an explicitly supplied empty array counts as supplied — and tasks actually ran); `DEFERRED` = budget exhausted before or during this wave's merge (see below). **`waveMerges` may be empty or absent** when the budget was exhausted before wave 1's merge, when all waves were SKIPPED, or when the workflow was interrupted before any merge completed. Consumers (Step-5 gate, display code) MUST degrade gracefully: check that `waveMerges` is present and non-empty and that `waveMerges[last].headSha` exists before indexing it — a missing or empty `waveMerges` is `BLOCKED` at the Step-5 gate ("merge-sha guard unavailable"), not a crash. |
| `blockedWaves` | no | Waves whose merge did not land (`wave`, `detail`); later waves were cascade-blocked into `unfinished`. Note: `DEFERRED` waves are NOT recorded here — a budget outcome is not a merge failure |
| `coverage` | no | Structural completeness signal: `{ tasks_merged, tasks_planned, complete }`. `tasks_planned` = total tasks across all waves; `tasks_merged` = count of distinct task branches that landed via a `MERGED` wave; `complete` = `tasks_merged >= tasks_planned`. A `complete: false` with a green `tests.passed` is the false-green the gate must catch — only existing tests can fail, so a dropped/never-merged task leaves the suite green. The engine reports the *count* it can observe; confirming each merged task's files are actually present is the completeness critic's git tree-diff |
| `missingDeliverables` | no | One entry per `failed` (or cascade-blocked) task whose plan-declared `files` did not reach the integration branch: `{ task, files }`. Tasks with no declared file scope are omitted. The completeness critic reads this list to target its git presence check; the gate renders it under unfinished |
| `gitVerified` | no | Boolean: did the completeness critic confirm — via its own `git rev-parse HEAD` — that it reviewed the recorded merge HEAD (`waveBaseSha` = `waveMerges[last].headSha`)? True only when the critic returned `onIntegrationHead: true`; false when it returned `onIntegrationHead: false` (it could not confirm — possible checkout drift, #29) or when the critic died/degraded (no flag). A false value also pushes a checkout-drift judgment call. **Step-5 gating:** `gitVerified` MUST be true to Approve — a false value makes the completeness review unverified and is treated as `BLOCKED` pending a manual integration-tree check. This is the report-driven hardening of the gate's `git rev-parse <integrationBranch>` == `waveMerges[last].headSha` check |
| `deferredVerification` | no | Deliverables the completeness critic found present and structurally complete but whose behavior the sandbox could not execute, each tagged with a `reason` — `browser` (live UI), `runtime` (target runtime the sandbox can't run: boot, device, deploy target), `external` (unreachable service/credential/network), `manual` (human judgment: aesthetic, product-fit). Gating rule: a non-empty `runtime` or `external` group is a structural false-green and routes into the **same** acknowledgement disposition as `coverage.complete: false`; `browser`/`manual` remain a verify-then-approve checklist. Empty when the critic flagged none |
| `judgmentCalls` | no | Non-obvious autonomous decisions, each one of four kinds (the kind is carried in the entry's string prefix): **autonomy** — a defensible call, FYI, asks nothing (tier-escalation recovery, fell-back-to-default review depth/tier, convergent output); **degradation** — verify the affected slice (budget-deferred, integration-review-deferred, agent-error); **disagreement** — look before approving (reviewer verdict/severity mismatch, reviewer returned no verdict, lost-coordinates, merge reported MERGED without headSha, suite-acceptance failed); **binding** — likely a plan typo (endpoint not in run, dependent before prerequisite, endpoints share a wave). New cases slot into an existing kind rather than lengthening this reference. |
| `unfinished` | yes | Tasks or follow-ups that were deferred or blocked (empty array if none). Budget-deferred tasks appear here as `"<id>: deferred (budget exhausted ...)"` strings; dep-blocked tasks appear as `"<id>: blocked — ..."` strings; cascade-blocked tasks (behind a failed merge) appear as `"<id>: cascade-blocked by wave N"` strings |
| `completenessFindings` | no | Gaps found by the completeness critic — unmet plan requirements, unverified claims, untested code paths. Before producing any finding the critic detaches to the run's merge HEAD (`waveBaseSha` = `waveMerges[last].headSha`) and confirms `git rev-parse HEAD` matches it; if it cannot (detach fails, `rev-parse` mismatch, or no merge headSha was recorded) it reports **BLOCKED** and produces no findings. A BLOCKED critic is **not** a clean review — the gate must not treat empty findings from a BLOCKED critic as a pass (#29). The critic is a read-only review role: it never writes files or commits (#32). The critic's prompt also carries the CANNOT-VERIFY checklist the per-task reviewers escalated; its findings include each item it confirmed or refuted against the integrated tree (#2.2). |

### `waveMerges[].status` values

- `MERGED` — wave integrated successfully; `headSha` carries the new integration-branch HEAD.
- `CONFLICT` / `TEST_FAILED` — merge attempt failed after reconciliation; the wave is recorded in `blockedWaves` and later waves are cascade-blocked.
- `SKIPPED` — no mergeable branches in this wave; integration branch untouched. Cascades conservatively when `args.edges` was omitted and tasks actually ran; otherwise the next wave proceeds normally.
- `DEFERRED` — budget exhausted before or during this wave's merge; the wave's task
  branches exist unmerged, and later waves were deferred to `unfinished` (not
  cascade-blocked). Rerun or redirect after raising the budget — this is a budget
  outcome, never a merge failure.

## Presentation

When the workflow completes, the main agent renders the report as a concise human-readable summary in this order:

1. **Integration branch** — name of the branch ready for review.
2. **Wave plan** — one line per wave listing which tasks ran in parallel and the wave sequence.
3. **Baseline** — whether the suite was green before any task ran; a red baseline reframes every later test result.
4. **Per-task status** — a compact table or bullet list: task name, status, review verdict, and any notes; include tier, review depth, and fix iterations so the human can judge cost vs. benefit per task.
5. **Wave merges** — one line per wave: merge `status`, the task IDs merged, and the integration `headSha` (or the conflict/failure detail). Lets the human see the integration sequence, not just the final state.
6. **Blocked waves** — any wave whose merge failed after reconciliation, or that cascaded conservatively (zero mergeable branches with `args.edges` omitted), with the failure detail; everything cascade-blocked behind it appears under unfinished. Omit the section only when the array is empty.
7. **Test result** — pass or fail, the command run, and any relevant output excerpt. When `coverage.complete` is false, show a ⚠ "green suite but `tasks_merged`/`tasks_planned` tasks merged" beside the result: a passing suite over an incomplete merge is a false-green (only existing tests can fail), and the unmerged tasks' deliverables are itemized in `missingDeliverables` under unfinished.
8. **Judgment calls** — render entries grouped by kind, leading with `disagreement` and `binding`, then `degradation`, folding `autonomy` last, so the human can prioritize high-signal items (likely issues) before low-signal FYIs.
9. **Unfinished / completeness findings** — anything deferred, plus the critic's unmet-requirement/unverified-claim/untested-path findings; empty means nothing was left behind. Surface `gitVerified` here: a false value means the completeness review is unverified (the critic could not confirm it was on the integration tree, #29) and the gate must treat it as `BLOCKED`.
9a. **Deferred verification — confirm before trusting green** — render `deferredVerification` grouped by `reason`: `runtime` (target runtime the sandbox can't run), `external` (unreachable service/credential/network), `browser` (live UI), `manual` (human judgment). A non-empty `runtime` or `external` group is a structural false-green — route it into the same explicit operator acknowledgement disposition as `coverage.complete: false` before Approve. `browser` and `manual` groups remain a verify-then-approve checklist. Omit the section when `deferredVerification` is empty.
10. **Post-merge runbook** — the `release`/`manual` tasks excluded at compile time,
   rendered verbatim in document order. Sourced from the Step-2 dispositions (the
   main agent carries it), **not** from the workflow return — the schema above is
   unchanged. Empty runbook means the whole plan was waveable. Before handing off
   to `finishing-a-development-branch`, apply the checks in
   `references/finishing-notes.md`: detect allowed merge methods (recommend squash
   when accumulated merge commits would block rebase) and warn when the integration
   base is far ahead of the deploy target.
11. **Effort audit (optional):** the per-agent markdown table from `scripts/audit_run.py` — role, model, turns, output tokens, and any tier-misrank candidates (implementers above 1.5x the median turns of same-model peers). Advisory only: it informs the next run's tier assignments and never gates this one.
12. **Live viewer (optional):** if the launch-time live viewer is still serving, point the human at its `http://localhost:<port>/swarm.html` — live station state, the cross-agent feed, and click-to-zoom into any agent's transcript. Otherwise offer to open one: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>`. One line, opt-in, read-only; skip in headless runs.

This pre-merge review is the **second and final gate** (after plan approval; the Step-3 wave plan
is rendered for transparency but does not pause for approval). After the summary the agent names
the integration branch and asks the human to choose:

- **Approve** — before any gate decision, assert the session checkout is clean (`git status --porcelain` empty) and the integration branch HEAD equals `waveMerges[last].headSha`; a dirty tree or a mismatch is a `BLOCKED` condition surfaced to the human for explicit disposition, never silently merged or reset (#29/#32; the executable form is `SKILL.md` Step 5). Then first gate on the report's `tests.passed`: if false, do NOT hand off; present the failure and offer Redirect instead. A non-empty `runtime` or `external` group in `deferredVerification` is a structural false-green: require the same explicit operator acknowledgement as `coverage.complete: false` before Approve (the green suite does not cover it). If true and acknowledged: `git checkout <integrationBranch>` (finishing-a-development-branch verifies tests on the CURRENT checkout, and the sweep classifies 'merged' against HEAD), then run `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh` (the deterministic sweep — do not assume the merge agents' prompted cleanup ran; locked worktrees are kept by default (pass `--force` to remove them); concurrent runs in one repo remain unsupported), then proceed to `superpowers:finishing-a-development-branch`; the orchestrator carries the post-merge runbook and presents it again when that handoff completes.
- **Salvage** — when `failed` tasks or dep-blocked `unfinished` entries exist: the orchestrator pre-builds the Redirect waves from the report (failed + blocked tasks, with each failed task's kept branch, review findings, and critic findings appended to its body as a `PRIOR ATTEMPT` note) and presents them for approval; mechanics identical to Redirect (`resume: true`, same integration branch).
- **Redirect** — provide corrective instructions; re-run the affected tasks before returning to this gate.
