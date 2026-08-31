# Ultrapowers — Report Format

The workflow produces a single structured report object that the main agent presents at the pre-merge human gate.

**Where the report lives:** the Workflow tool wraps this object in its own envelope — top-level keys like `summary`, `agentCount`, `logs`, and `result`. **Everything documented below lives under `result`.** The envelope's top level never carries gate fields; a reader probing `gitVerified` or `waveMerges` there sees only nulls. Always parse `result.*`.

## Schema

```json
{ "type": "object",
  "required": ["integrationBranch", "waves", "tasks", "tests", "unfinished"],
  "properties": {
    "integrationBranch": { "type": "string" },
    "baseSha": { "type": "string" },
    "waves": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } },
    "dependencyEdges": { "type": "array", "items": { "type": "string" } },
    "tasks": { "type": "array", "items": { "type": "object",
      "required": ["task", "status"],
      "properties": { "task": {"type":"string"}, "status": {"type":"string"}, "branch": {"type":"string"}, "headSha": {"type":"string"},
        "commit": {"type":"string"}, "reviewVerdict": {"type":"string"}, "notes": {"type":"string"},
        "tier": {"type":"string"}, "review": {"type":"string"}, "fixIterations": {"type":"integer"},
        "baseCorrected": { "oneOf": [{"type":"null"}, {"type":"object", "required":["from","to"], "properties": {"from":{"type":"string"}, "to":{"type":"string"}}}] } } } },
    "tests": { "type": "object", "properties": { "command": {"type":"string"}, "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "shallowSuite": { "oneOf": [{"type":"null"}, {"type":"object", "properties":
      { "depth": {"type":"integer"}, "command": {"type":"string"}, "passed": {"type":"boolean"}, "output": {"type":"string"} }}] },
    "acceptance": { "oneOf": [{"type":"null"}, {"type":"object", "properties":
      { "mode": {"type":"string","enum":["waived","sealed","suite"]}, "reason": {"type":"string"},
        "passed": {"type":["boolean","null"]}, "sealId": {"type":"string"},
        "status": {"type":"string"}, "exitCode": {"type":"integer"}, "output": {"type":"string"} }}] },
    "baseline": { "type": "object", "properties": { "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "waveMerges": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "status": {"type":"string"}, "headSha": {"type":"string"},
        "command": {"type":"string"}, "detail": {"type":"string"}, "branches": {"type":"array","items":{"type":"string"}} } } },
    "frontier": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "foldLogPath": {"type":"string"},
        "conflictsIndex": {"type":"string"}, "selfChecks": {"type":"string"},
        "foldCliCalls": {"type":"integer"},
        "foldCliWallTimeSec": {"type":["number","null"]},
        "resolverTranscripts": { "type": "array", "items": { "type": "object" } } } } },
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
| `baseSha` | no | The run base — the setup reply's head sha (agent-reported context, not authority). `finalize_report.py` reads it to refuse a merged claim whose branch carries no commits beyond the run base (#275); the git-derived ancestry checks remain the authority. Absent or unresolvable → that guard is skipped with a named warning |
| `waves` | yes | Ordered list of waves; each wave is a list of task IDs that ran in parallel |
| `dependencyEdges` | no | Human-readable edges that shaped wave order, e.g. `"task-2 → task-4"` |
| `tasks` | yes | One entry per task; `status` is `done` or `failed`; dependency-blocked and budget-deferred tasks are reported as strings in `unfinished`, not as `tasks[]` entries |
| `tasks[].branch` | no | Worktree branch used for the task |
| `tasks[].headSha` | no | The implementer's final worktree HEAD (what the merge agent merges); distinct from `commit` below |
| `tasks[].commit` | no | The implementer's final commit on the task's worktree branch (self-reported); the integration merge SHA lives in `waveMerges[].headSha` |
| `headSha` provenance | — | headSha values are derived at finalization from git ancestry by `finalize_report.py --report <file> --repo <path> --branch <integrationBranch>` (#259; `docs/superpowers/specs/2026-08-26-fold-over-git-heads.md` §3): each merged task's `headSha` is its branch tip (`git rev-parse <branch>`), asserted to be an ancestor of the integration branch tip; the final MERGED `waveMerges` entry's `headSha` is the integration branch tip itself. finalize_report.py rewrites the saved result envelope's `result.*` headSha fields in place before ultra_gate.py runs. Intermediate (non-final) `waveMerges[].headSha` values are left as model-recorded — context, not authority; no mechanical consumer reads them. The `<runDir>/heads/` sidecars no longer exist. |
| `tasks[].reviewVerdict` | no | Review outcome. Merged tasks: `clean` (passed first review) or `fixed` (passed after the fix round). Failed tasks: `not-reviewed` (implementer BLOCKED/NEEDS_CONTEXT), `fix-loop-exhausted` (blocking issues after the capped fix round), `blocked-after-fix` (implementer blocked during the fix round), `agent-error` (the agent call itself failed), `lost-coordinates` (reported done without driver-captured coordinates — downgraded to failed; see the matching judgmentCalls entry), `reanchor-failed` (0.3.0 engine: a later wave's clone could not be re-anchored onto the adopted head — failed closed before dispatch, since a mis-anchored patch would silently revert the prior wave) |
| `cannotVerify` (per reviewer) | no | Requirements a per-task reviewer could not judge from its own diff — cross-task or unchanged-code claims. Each item is `{ requirement, why }`. The worktree-isolated reviewer LISTS them instead of crawling the repo; the engine COLLECTS them across the task's reviewers and threads them into the completeness critic's prompt as an explicit checklist. When no merge HEAD was recorded (no completeness critic runs), the items surface as judgment calls at the gate rather than being dropped (#2.2). |
| `tasks[].notes` | no | Free-form notes from the implementing or reviewing subagent (minor review findings and implementer concerns) |
| `tasks[].tier` | no | Resolved model alias the implementer ran at (`haiku`/`sonnet`/`opus`) |
| `tasks[].review` | no | Review depth applied: `lean` (one pass) or `adversarial` (two) |
| `tasks[].fixIterations` | no | Fix rounds consumed (0 = clean on first review) |
| `tasks[].baseCorrected` | no | The #314 provisioning-drift record. `null` when the implementer's reported `startHead` (its pre-work `git rev-parse HEAD`, a required implementer-schema field) equalled the dispatched `BASE`; `{ from, to }` when it differed and the implementer reset to `BASE` (`from` = the sha the worktree was provisioned at, `to` = `BASE`); absent when no implementer reply was received (`agent-error`, infra-park). Engine-derived, never model-typed; the predicate is exact equality, not ancestry. Every correction also pushes an `autonomy` judgment call naming both shas; a reply with no `startHead` (engine-bypass class — the schema requires it) pushes a `degradation` call `BASE anchoring unverified` instead. Fix-round replies are not compared: their `BASE` is the prior implementation HEAD by design. |
| `tests` | yes | Result of the suite run on the integration branch |
| `shallowSuite` | no | #465 — the same suite re-run on a **depth-1 clone** of the integration branch, the shape `actions/checkout` gives the merge target. `null` when the leg did not run (no adopted tree, a red `tests`, or `args.shallowLeg: false`). A red leg does **not** fail `tests` (the full-clone run really passed); it appends a `deferredVerification` item with reason `manual`, because whether a shallow degradation is a coupled test or correct consumer behaviour is a human call |
| `acceptance` | no | Sealed acceptance exam result, placed directly after the test result in presentation order. `null` when no exam was requested. `{ mode: 'waived', reason, passed: null }` when the orchestrator waived the exam. `{ mode: 'sealed', … , status: 'PENDING_GATE', passed: null }` is still emitted for a `sealed` line (frozen compiler vocabulary) but the gate reports it `BLOCKED` — sealed acceptance is not administered (One Driver Phase 0, row 7). `{ mode: 'suite', passed, reason }` when the committed test suite is the acceptance authority — `passed` mirrors `tests.passed` (the integration test result); no held-out exam is dispatched. A `passed: false` result pushes a judgment call requiring the gate to NOT Approve. |
| `baseline` | no | Result of the test run setup performed on the integration branch before wave 1; `passed: false` means tasks inherited a red suite |
| `waveMerges` | no | One entry per wave's integration merge: `wave`, `status`, `headSha`, `command`, `detail`, and `branches` — the task IDs submitted to the merge, listed even when it failed. Surfaces *how* integration went, not just whether it failed; status semantics are enumerated once under **`waveMerges[].status` values** below. **`waveMerges` may be empty or absent** when the budget was exhausted before wave 1's merge, when all waves were SKIPPED, or when the workflow was interrupted before any merge completed. Consumers — the Step-5 gate and display code — MUST degrade gracefully: check that `waveMerges` is present and non-empty and that `waveMerges[last].headSha` exists before indexing it; a missing or empty `waveMerges` is `BLOCKED` at the Step-5 gate as "merge-sha guard unavailable", never a crash. |
| `frontier` | no | One entry per wave that took the **contended** merge path (frontier mode) — recorded whether the wave adopted its folded candidate or fell back: whenever the fold CLI ran, the on-disk `frontier/wave-<n>/` directory is the durable record the production canary harvests. Absent or empty on every run without a contended wave, including every `--overlap serialize` compile, where no wave can contain intersecting `files`. Fields, all sourced from the contended dispatches' reply scalars — no payload is relayed through an agent (#36): `wave` (1-based wave number); `foldLogPath` (the wave's `fold_log.jsonl`, the self-sufficient event record documented in `kernel/FOLD_LOG.md`); `conflictsIndex` (the `conflicts.json` beside it — the single record of every conflict and every park, with its `dispatchable()` verdict and reason); `selfChecks` (the fold CLI's two live self-checks, **sourced from the completing CLI reply** — the CLI runs them inside whichever call completes the wave, so a stop reply carries none; `ok`, or a named failure that routed the wave to fallback, or the empty string when no reply ever attested; the engine never claims a fold succeeded without them); `foldCliCalls` (how many fold-CLI invocations this wave drove — 1 fold + N resolves + 1 materialize on a clean run, fewer when it fell back. The incremental protocol makes N unbounded by the conflict total, because a drained stop folds on inside the same `resolve` call, so this is the wave's real CLI cost rather than a number derivable from the conflict count); `foldCliWallTimeSec` (the **sum** of the wall clocks the STEP replies reported across every leg — fold, each resolve, and materialize — reported on its own line so the first real-repo reading is not buried inside a passing test result; `null` when no reply timed its invocation); `autoResolved` (how many conflicts the kernel resolved **in process** against the wave's `Commutes:` contract — every writer declared the path and every hunk segment was an addition, so the fold never stopped on it and no resolver was dispatched. **Summed** across the fold and resolve legs, since the kernel folds on past a contract-resolved conflict inside any call; `0` when the wave declared no `Commutes:`, when no declared path conflicted, or when no reply carried the count. Read it beside `resolverTranscripts`: it is the resolver dispatches the contract *bought*); `resolverTranscripts` (one entry per resolver dispatch — `conflict` (the conflicts-index `i`), `attempt`, `path`, `epoch`, `hunksFile`, `replyDir`, `status`, `notes` — recorded verbatim as the A/B grading surface). `foldLogPath` and `conflictsIndex` are empty strings when the fold dispatch threw, returned no reply at all, or returned a reply that carried no paths — in the first two cases the directory the paths would name may never have been written, since the CLI itself may never have run. Fallback **reasons** are **not** recorded here: each one is a `judgmentCalls` entry naming its reason plus the wave's `waveMerges` result — one fact, one record |
| `blockedWaves` | no | Waves whose merge did not land (`wave`, `detail`); later waves were cascade-blocked into `unfinished`. Note: `DEFERRED` waves are NOT recorded here — a budget outcome is not a merge failure |
| `coverage` | no | Structural completeness signal: `{ tasks_merged, tasks_planned, complete }`. `tasks_planned` = total tasks across all waves; `tasks_merged` = count of distinct task branches that landed via a `MERGED` wave; `complete` = `tasks_merged >= tasks_planned`. A `complete: false` with a green `tests.passed` is the false-green the gate must catch — only existing tests can fail, so a dropped/never-merged task leaves the suite green. The engine reports the *count* it can observe; confirming each merged task's files are actually present is the completeness critic's git tree-diff |
| `missingDeliverables` | no | One entry per `failed` (or cascade-blocked) task whose plan-declared `files` did not reach the integration branch: `{ task, files }`. Tasks with no declared file scope are omitted. The completeness critic reads this list to target its git presence check; the gate renders it under unfinished |
| `gitVerified` | no | Boolean: did the completeness critic confirm it reviewed the tree at the integration branch tip it derives itself — `git rev-parse HEAD` inside the integration worktree (already required to be on the integration branch), then `git checkout --detach` and a re-confirm — rather than a recorded slot (#259; `docs/superpowers/specs/2026-08-26-fold-over-git-heads.md` §2)? The model-recorded merge sha (`waveMerges[last].headSha`), when non-empty, is cross-checked context, not authority — a mismatch against the critic's derived tip also fails the check. True only when the critic returned `onIntegrationHead: true`; false when it returned `onIntegrationHead: false` (it could not confirm — possible checkout drift or a failing detach, #29) or when the critic died/degraded (no flag). A false value also pushes a checkout-drift judgment call. **Step-5 gating:** `gitVerified` MUST be true to Approve — a false value makes the completeness review unverified and is treated as `BLOCKED` pending a manual integration-tree check. This is the report-driven hardening of the gate's `git rev-parse <integrationBranch>` == `waveMerges[last].headSha` check. **Patch-input engine note (Amendment 10, `fleet/run-engine.mjs`):** on the driver path the critic performs no detach and records no `onIntegrationHead` — `gitVerified` is DRIVER-derived instead: true iff at least one wave merged, the integration branch tip equals the last adopt receipt's sha, every task reported merged has a fold event in its wave's fold log (the receipt-based #70 check, surfaced as `ancestryMisses`), AND the completeness critic actually returned a result (a dead critic withholds it, preserving the fail-closed gate invariant). Same Step-5 gating either way |
| `deferredVerification` | no | Deliverables the completeness critic found present and structurally complete but whose behavior the sandbox could not execute, each tagged with a `reason` — `browser` (live UI), `runtime` (target runtime the sandbox can't run: boot, device, deploy target), `external` (unreachable service/credential/network), `manual` (human judgment: aesthetic, product-fit). Gating rule: a non-empty `runtime` or `external` group is a structural false-green and routes into the **same** acknowledgement disposition as `coverage.complete: false`; `browser`/`manual` remain a verify-then-approve checklist. Empty when the critic flagged none |
| `judgmentCalls` | no | Non-obvious autonomous decisions, each one of four kinds (the kind is carried in the entry's string prefix): **autonomy** — a defensible call, FYI, asks nothing (tier-escalation recovery, fell-back-to-default review depth/tier, convergent output, worktree provisioned off BASE and reset before work (#314)); **degradation** — verify the affected slice (budget-deferred, integration-review-deferred, agent-error, startHead not reported so BASE anchoring unverified (#314)); **disagreement** — look before approving (reviewer verdict/severity mismatch, reviewer returned no verdict, lost-coordinates, merge reported MERGED without headSha, suite-acceptance failed, disclosed plan-defect divergence (a plan-defect:-prefixed concern)); **binding** — likely a plan typo (endpoint not in run, dependent before prerequisite, endpoints share a wave). New cases slot into an existing kind rather than lengthening this reference. |
| `unfinished` | yes | Tasks or follow-ups that were deferred or blocked (empty array if none). Budget-deferred tasks appear here as `"<id>: deferred (budget exhausted ...)"` strings; dep-blocked tasks appear as `"<id>: blocked — ..."` strings; cascade-blocked tasks (behind a failed merge) appear as `"<id>: cascade-blocked by wave N"` strings |
| `completenessFindings` | no | Gaps found by the completeness critic — unmet plan requirements, unverified claims, untested code paths. Before producing any finding the critic derives its own detach target — `git rev-parse HEAD` inside the integration worktree — then runs `git checkout --detach` and re-confirms `git rev-parse HEAD` still matches; the model-recorded merge sha (`waveMerges[last].headSha`), when non-empty, is cross-checked context, not authority, and a mismatch against the derived tip also blocks. If it cannot (an unresolvable branch/HEAD, or the detach itself fails — e.g. a dirty/conflicted integration worktree) it reports **BLOCKED** and produces no findings. A BLOCKED critic is **not** a clean review — the gate must not treat empty findings from a BLOCKED critic as a pass (#29). The critic is a read-only review role: it never writes files or commits (#32). The critic's prompt also carries the CANNOT-VERIFY checklist the per-task reviewers escalated; its findings include each item it confirmed or refuted against the integrated tree (#2.2). For a multi-phase or multi-run pipeline, the **holistic cross-phase review** run at the finishing handoff (one completeness critic over the fully-integrated tree against the *combined* plan, gated before the final PR) records its findings here too — cross-phase integration gaps land in `completenessFindings` alongside the single-run critic's, so the gate surfaces them under unfinished before the PR is opened (#69). |

### `waveMerges[].status` values

- `MERGED` — wave integrated successfully; `headSha` carries the new integration-branch HEAD.
- `CONFLICT` / `TEST_FAILED` — merge attempt failed after reconciliation; the wave is recorded in `blockedWaves` and later waves are cascade-blocked.
- `SKIPPED` — no mergeable branches in this wave; integration branch untouched. Cascades conservatively only when `args.edges` was omitted — an explicitly supplied empty array counts as supplied — and tasks actually ran; otherwise the next wave proceeds normally.
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
8. **Judgment calls** — render entries grouped by kind, leading with `disagreement` and `binding`, then `degradation`, folding `autonomy` last, so the human can prioritize high-signal items (likely issues) before low-signal FYIs; within disagreement, cluster plan-defect: entries together so all plan divergences read as one group.
9. **Unfinished / completeness findings** — anything deferred, plus the critic's unmet-requirement/unverified-claim/untested-path findings; empty means nothing was left behind. Surface `gitVerified` here: a false value means the completeness review is unverified (the critic could not confirm it was on the integration tree, #29) and the gate must treat it as `BLOCKED`.
9a. **Deferred verification — confirm before trusting green** — render `deferredVerification` grouped by `reason`, applying the taxonomy and gating rule from the field reference above: `runtime`/`external` groups require the explicit operator acknowledgement; `browser`/`manual` remain a verify-then-approve checklist. Omit the section when the array is empty.
10. **Post-merge runbook** — the `release`/`manual` tasks excluded at compile time,
   rendered verbatim in document order. Sourced from the Step-2 dispositions (the
   main agent carries it), **not** from the workflow return — the schema above is
   unchanged. Empty runbook means the whole plan was waveable. Before handing off
   to `finishing-a-development-branch`, apply the checks in
   `references/finishing-notes.md`: detect allowed merge methods (recommend squash
   when accumulated merge commits would block rebase) and warn when the integration
   base is far ahead of the deploy target.
11. **Effort audit (optional):** the per-agent markdown table from `scripts/audit_run.py` — role, model, turns, output tokens, plus escalated-task and thrash signals. Advisory only: it informs the next run's tier assignments and never gates this one.

This pre-merge review is the **second and final gate** (after plan approval; the wave plan
is rendered for transparency but does not pause for approval). After the summary the session
applies the two-move rule:

- **Approve** — the two-move rule (`SKILL.md` §Engine step 5 is the executable form; the fleet's launch directive is the standing instruction). `PASS` → approve. `NEEDS_ACK` → approve iff every ack is a `deferredVerification` item with reason `runtime` or `external`, and only after writing `run-<stamp>/standing-approval.json` (`{grantedAt, instruction, ackList}`, the launch directive verbatim as `instruction`) FIRST — the rendered gate presentation lists the same ack list and instruction, so the transcript and the disk agree. Anything else (`BLOCKED`, any other ack type, a `coverage.complete: false`) → do not approve; the gate receipt is the terminal artifact. Approve runs `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py --approve --stamp <stamp>` (checkout of the integration branch + re-verified tests) and saves its JSON output verbatim to `run-<stamp>/approve-receipt.json`; the fleet shim's `readGateGreen` greens the run only on that receipt with a matching stamp. The orchestrator publishes the branch and opens the PR — the session never pushes and never hands off to `superpowers:finishing-a-development-branch` (superpowers does not run in a sandbox); the post-merge runbook rides in the PR body.
