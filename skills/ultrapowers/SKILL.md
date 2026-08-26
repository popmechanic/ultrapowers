---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", "run the plan as a workflow", or wants to autonomously implement an approved Superpowers plan in parallel waves across git worktrees.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---

# Ultrapowers

Autonomously implement an approved Superpowers plan via a committed, parallel,
worktree-isolated Dynamic Workflow. It validates the plan, compiles the wave
plan, renders it, then launches the frozen `waves.js` — never authoring a workflow
at runtime. Selecting ultrapowers at the planning handoff (or invoking
`/ultrapowers` on an approved plan) **is** the authorization to execute — no
separate approval pause. Each task runs in its own git worktree, passes an
independent review (discipline baked into `waves.js`), and merges into one
integration branch; a report and a pre-merge gate conclude the run. Run from
**inside the target project's git repository** — worktree isolation binds each
agent to this session repo; not a detached HEAD.
*Rationale: `references/design-rationale.md` § Step 4.*

## Step 1 — Preflight, compile & lock (deterministic)

**Workflow-tool preflight.** The Workflow tool is absent on some surfaces (e.g.
the web). Check for it (ToolSearch `select:Workflow`). If unavailable, go to
Step 6 — do not analyze dependencies.

**Run the pre-launch driver:**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_run.py <plan> --stamp <stamp> [--overlap serialize|fold]
```

`--overlap` forwards to the compiler's own `--overlap` knob (default
`fold` — eligible overlapping-file tasks share a wave and fold at merge
time; `serialize` reproduces the pre-0.2.0 behavior — see
`references/dependency-analysis.md`). Omit it for the compiler's default.

One call runs every deterministic stage fail-closed — git-repo check,
worktree-capability probe, self-host engine skew, superpowers compatibility,
compile (`--emit-launch`/`--emit-args`), committed-workflow install, run lock,
dirty-baseline stage, and `baseBranch` derivation — and writes the receipt to
`.claude/ultrapowers/run-<stamp>/receipt.json`. **Exit 0** → read the receipt and
continue. **Non-zero** → the last stage names the failure:

- `superpowers-compat` → a contract token is missing: **STOP** and surface the
  human gate, quoting the missing tokens; confirm continuing or abort.
  (Tested with superpowers 6.0.3. A version advisory at exit 0 rides in the stage
  detail — relay it once.)
- `lock` → another run holds this repo, serialize runs.
- `worktree-probe` / `git-repo` → fix the environment (a repo that cannot cut
  worktrees cannot run waves).
- `compile` → fix the plan.

If the fresh-worktree baseline is red for reasons unrelated to the plan,
repair base first and re-baseline rather than launching red.

The stamp is the lock id for the whole run; `wf_<runId>` is only for sweeps.
*Rationale: § Step 1.*

## Step 2 — Judge and fill (LLM-owned)

**Classify first** per `references/plan-markers.md`: trust header-block
`**Type:**` / `**Depends-on:**` markers (out-of-block → conflicts), else the
contract heuristics. Only `implementation` tasks enter the DAG; gates
inform run config; `release`/`manual` tasks ride the post-merge runbook. Adopt
the compiler's JSON verbatim (`receipt.compile`) — waves, edges, dispositions —
judgment only on `"heuristic": true` entries. If it reports `no implementation
tasks` (`waves: []`), do not launch; present the runbook.

**Derive only your knobs**, which land in named slots — per-task `tier` fills the
wave entries of the receipt's `argsFile` (slots pre-emitted as `null`; the engine
reads knobs only from these inline entries); `testCmd` / `bootstrapCmd` ride the
same args file. The receipt's `llmDerives` list is the checklist:

- **`tier`** per task (`cheap`/`standard`/`most-capable`) by scope/judgment-likelihood.
  Review agents stay pinned to `most-capable` **by design**, independent of
  plan-authored review *depth* (which sets prompt rigor only); re-tiering
  reviews needs eval evidence, not argument.
- **`testCmd`** — run-wide resolution moved into the driver (pass `--test-cmd`
  to `ultra_run.py`, else its deterministic detection ladder stamps it;
  `receipt.testCmd`/`receipt.testCmdSource` record the outcome). An
  explicitly-passed empty or whitespace-only `--test-cmd` fails the
  test-command stage loudly rather than falling through to detection —
  pass the knob only with a real command. Derive only
  **per-task** `testCmd` on wave entries, for polyglot plans.
- **`bootstrapCmd`** — pass `--bootstrap-cmd` to `ultra_run.py` (per-worktree
  install for fresh worktrees); it is validated, stamped into the receipt, and
  the pre-merge gate provisions its acceptance worktree from it.
- **`baseBranch`** — derived in `receipt.baseBranch` from the launched
  checkout (the branch the session is on at preflight; repo default only on
  detached HEAD, noted in the `base-branch` stage detail); pass through.

Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly in a throwaway worktree (never the session
checkout), each wave entry's `tier`/`review` value is one the engine
accepts, and smoke-runs the stamped `testCmd` there. Exit 3 = the baseline
is red on the base ref before any work (`baseline` in the JSON carries the
failing output). Present the decision: **fix drift first** (repair the
base, re-run preflight — Step 1's red-baseline guidance above) or **launch
anyway** (the red is inherited; an explicit plan note can pre-authorize any
repair the run will need). No `bootstrapCmd` plus a red baseline usually
means the probe worktree lacks deps — supply `--bootstrap-cmd` instead. This
ack is context-only; the in-run baseline is the durable record.

Review depth is **plan-authored**: ultraplan's `**Review:**` marker pre-fills each
wave entry's `review` slot (`lean` when unmarked; rendered); never set
`task.review` yourself — the run-wide `reviewProfile: adversarial` hatch
only raises depth. *Rationale: § Step 4.*

## Step 3 — Render the wave plan (transparency, no pause)

Render the interpretation — it reappears with the final report, so a wrong
classification is auditable at the gate:

1. **Waves** — task IDs per wave, in order.
2. **Dependency `edges`** — those that shaped the ordering.
3. **Mode** — `parallel`/`sequential`; `sequential` renders only for
   single-task plans now (the fully-overlapping degrade is gone — same-file
   contention is a fold-time concern, not a compile-time mode switch).
4. **Derived knobs** — `testCmd`, plan-authored review depth, tier overrides.
5. **Expected contention** — from same-wave `writes` intersections × each
   task's `commutes`: render `declared-commutative` when every intersecting
   writer declared the shared path (expected to auto-union at fold time), or
   `composition-unpinned` when at least one writer left it undeclared. When
   tasks carry no `writes` field, say so once instead of classifying.
6. **Dispositions** — release/manual → runbook, gates → run config. Render the two
   `marker_conflicts` buckets **separately by `kind`:** `kind: "conflict"` as
   *needs attention*, `kind: "inference"` as *informational*. When it reports
   `allHeuristic: true`, show **`0 markers — all dispositions inferred`**.
7. **Acceptance disposition** — `sealed <seal-id>` or the verbatim waiver. When
   `sealed`, present the exam's coverage summary and this vouching rubric
   (**no code-reading**):
   > 1. **Everything covered?** Each spec requirement maps to a row; an unmatched
   >    one is a gap.
   > 2. **Invented anything?** Scan for checks the spec never asked for.
   > 3. **Your examples present?** The spec's examples should appear verbatim.

   If the operator cannot vouch, re-seal (ultraplan) or waive explicitly.

Then proceed **directly to Step 4 — do not ask for approval and do not pause.**
The render audits the interpretation, not approves it; if it is wrong, stop and
revise the plan. Only a dependency cycle or an inability to extract tasks stops
the run here. *Rationale: § Step 3.*

## Step 4 — Launch

**4a½ — Engine preflight.** The driver installed the committed workflows, but the
engine registers saved workflows only at **session start**, so a first-run
snapshot can predate the install (the **SessionStart hook** is the load-bearing
install; the driver's mid-session copy is the safety net). Launch the probe from
the receipt — `receipt.probe.name` with `receipt.probe.args` — and assert the
round-trip `receipt.probe.assert` (`echoWaves === 1`, `echoFirstId === 'probe-1'`;
it spawns no agents). Branch on how it fails:

- **Not found** (`Workflow "ultrapowers-probe" not found`) — the registry snapshot
  predates the install. **Not** engine drift: the only cure is a **new session**
  (the SessionStart hook installs before the next snapshot) — do **not** route to
  the sequential fallback. If the file is genuinely absent, the install failed; go
  Step 6.
- **Launches but `ok` is not true / errors mid-run** — engine drift; go to Step 6.
- **`echoWaves`/`echoFirstId` mismatch** — a payload round-trip failure; go to
  Step 6. *Rationale: § Step 4a½.*

**4c — Launch the saved workflow by `meta.name`** (`receipt.workflowName` =
`ultrapowers-run`) via the Workflow tool (never author or edit it). Pass the
`receipt.argsFile` skeleton with your derived knobs merged in:

```
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp,
         baseBranch, reviewProfile? }
```

Your `tier` fills ride inside `argsFile.waves` — merge only run-wide knobs.

`args.edges` drives dependency blocking (the workflow ignores task `depends_on`) —
always pass it, or blocking is silently disabled. The headless workflow creates
the branch in a dedicated integration worktree — no engine agent ever mutates
the session checkout — runs/merges/reconciles each wave (16-agent cap), then
reviews completeness (`references/wave-merge.md`). Contended-wave fold state
and replay contract: `kernel/FOLD_LOG.md`.

**Record the Run ID first.** The Workflow tool's immediate result prints
`Run ID: <wf_runId>` (the run continues in the background). Before anything
else, record it — `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>`
— so approve/teardown sweep it even if this launch never reaches a gate. Exit 1
(an unreadable existing `wf-runs.json`) is surfaced, never skipped.

**Viewer offer (interactive runs only).** One-line opt-in *"Want to watch
live?"* — on yes:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir> --watch . <integrationBranch>
```

Hand back the printed URL; tear it down at the gate with
`serve_viewer.py --stop <dir>`. Skip if headless.

## Step 5 — Pre-merge gate (human gate)

Save the Workflow tool's raw result JSON verbatim to a file (the driver unwraps
the envelope itself; gate fields live under `result.*`). Before running the gate
driver, finalize the saved result JSON:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/finalize_report.py \
  --report <saved-result.json> --repo . --branch <integrationBranch>
```

It rewrites the envelope's `result.*` headSha fields in place, derived from
integration-branch ancestry (merged task branch tips + the integration tip for
the final MERGED wave). A non-zero exit is a pre-gate failure: surface it and
do **NOT** run `ultra_gate.py`; never fall back to token-reported values. Then
run the gate driver with the finalized file:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py \
  --stamp <stamp> --result <saved-result.json>
```

It runs `gate_check.py` (clean-tree blocks only on dirt **new** since the snapshot;
pre-existing operator files pass with a note), and administers acceptance per the
compiled disposition — sealed exam, suite gate, or verbatim waiver. The report's
`tests.passed` is triage context; the **exit code is the authority**:

- **0 (PASS)** → render the report and offer **Approve**.
- **2 (NEEDS_ACK)** → present the acks for explicit operator acknowledgement
  first. Acting on **standing pre-authorization** instead is sanctioned only
  when ALL hold: the operator gave an explicit forward-looking approval
  earlier in the session (or the launch directive), quotable verbatim,
  addressing this ack disposition or the gate-outcome class ("approve if
  clean apart from the usual runtime acks" qualifies; "merge when done" does
  not — it says nothing about acks); every ack consumed is a
  `deferredVerification` item with reason `runtime` or `external` — a
  `coverage.complete: false` ack, or any ack naming an operator-environment
  mutation or a data-integrity surface, is outside every standing grant and
  needs a fresh turn; the ack list plus the verbatim instruction and
  where/when it was granted is rendered per report-format.md's Approve
  clause; and `run-<stamp>/standing-approval.json` is written FIRST:
  `{"grantedAt": "<turn or timestamp>", "instruction": "<verbatim>",
  "ackList": [...]}`. A grant is consumed per gate presentation — each gate
  using it writes a fresh sidecar, counting as the explicit disposition for
  the items it lists, those only. Any ambiguity resolves to a fresh ack.
- **1 (BLOCKED)** → present the failing checks; do **NOT** Approve.

**Receipts, not narration.** Whatever the verdict, the operator-facing summary quotes machine-written bytes: copy `verdict`, every failing check's `name` and `detail`, and the acceptance `exit` plus its pass/fail line verbatim from `run-<stamp>/gate-receipt.json`, and name that file's path in the summary. Never paraphrase a receipt value the operator could read directly.

Whatever the verdict, delete the run's review exhaust now —
`rm -rf .claude/ultrapowers/run-<stamp>/review` — the packets are regenerable
from the BASE/HEAD shas recorded in the report; the run's records
(transcripts, receipts, launch/args) stay for the viewer and later harvests.

**Resume gates derive the union.** At any gate reached via relaunch, derive and
render the manifest (`residual_manifest.py --run-dir <runDir>` — every round's
`report-<n>.json` plus the live `report.json`) — render only; `--check` runs
solely at run close.

Render the report per `references/report-format.md` plus the **post-merge runbook**
(`release`/`manual` tasks, verbatim), then present:

- **Approve** — only on PASS (or a NEEDS_ACK acknowledged fresh or via a
  recorded standing grant). Run
  `ultra_gate.py --approve --stamp <stamp>` — it does
  `git checkout <integrationBranch>` (re-verifies tests on the integration tree),
  sweeps **every wf run ID recorded for this stamp — at launch and by the gate —**
  (`run-<stamp>/wf-runs.json` — Salvage/Redirect relaunches each mint a fresh
  runtime ID, and all of them are swept) plus `wf_<stamp>` (the dedicated
  integration worktree), reports any `wf_*` leftovers it did not remove, and
  releases the lock. `--wf-run <wf_runId>` is accepted as an extra belt ID;
  no separate sweep call is needed. A non-zero approve exit means the lock
  release failed, a sweep failed (`sweepFailures` names the run IDs), or the
  recorded ID file was unreadable (`wfRunsUnreadable`) — inspect before
  treating it closed. A **manual-merge wrap-up that bypasses
  `ultra_gate.py` still owes the full sweep set** — once no other run is live,
  `sweep_worktrees.sh --all` — `bootstrapCmd` installs per worktree, so every
  leaked worktree is a multi-GB leak.
  When work spanned **multiple
  phases or runs**, run one **holistic cross-phase** review of the fully-integrated
  tree against the *combined* plan and gate on it **before the final PR**
  (single-run pipelines already got it at Step 4). Then (every run) derive
  `<runDir>/residual-manifest.md` (`residual_manifest.py --run-dir <runDir>`) and disposition
  every row (`residual_manifest.py --check` green), apply the
  `references/finishing-notes.md` checks, run the close-of-run hygiene check
  (`hygiene_check.sh` — quote its JSON receipt verbatim; a red receipt is a
  NEEDS_ACK-style block on the finishing handoff, never silently skipped;
  `--fix` deletes only merged engine branches), and proceed to
  `superpowers:finishing-a-development-branch`, carrying the runbook and
  manifest.
- **Salvage** — offer whenever the report has `failed` tasks or dep-blocked
  `unfinished` entries. Run `python3 <pluginRoot>/skills/ultrapowers/scripts/salvage_args.py
  --receipt <runDir>/receipt.json --report <saved-result.json>`. It derives the
  salvage waves mechanically — every `failed` task plus every dep-/cascade-blocked
  `unfinished` task, in Step-2 order with their edges (budget-deferred entries are
  listed on stderr, not salvaged) — appends a **PRIOR ATTEMPT** block to each
  selected task's body from `tasks[]` (kept branch + HEAD sha, review verdict,
  blocking notes, completeness findings naming it, and the instruction to pull
  correct prior work in with `git checkout <sha> -- <path>` rather than
  reimplement), and composes the relaunch args by spreading the receipt's
  argsFile (`resume: true`, same `integrationBranch`). A hand-composed salvage is
  unsanctioned. Present the salvage waves, relaunch `ultrapowers-run` with the
  emitted args file, and record the new launch's printed Run ID
  (`record_wf_run.py <stamp> <wf_runId>`, as in Step 4). Return here.
- **Redirect (micro-redirect)** — author `findings.json` from the gate report
  (one amend entry per affected task: `{"task", "instruction", "files"?, "tier"?}`
  — `files` is derived as the task's FILES ∪ paths the instruction names ∪ the finding's `files`, never narrowed; right-size `tier` down when the fix is mechanical),
  then run `python3 <pluginRoot>/skills/ultrapowers/scripts/redirect_args.py
  --receipt <runDir>/receipt.json --findings <findings.json>` and relaunch
  `ultrapowers-run` with the emitted args file. `redirect_args.py` composes the
  relaunch args by spreading the receipt's argsFile — carries the
  now-mandatory `pluginRoot`/`runDir` keys — never hand-authored from the
  report; a relaunch reconstructing args from the report is refused by
  the harness. The emitted args carry only the amended tasks' waves — a
  one-task fix relaunches one task on the same
  integration branch (merged prior work is already there); the fix still flows
  through its implementer, reviewer, wave merge, and a fresh gate. Inline commits on the
  integration branch are unsanctioned — route every post-gate edit through this
  lane. Record the relaunch's printed Run ID (`record_wf_run.py <stamp>
  <wf_runId>`, as in Step 4). Return here.
- **After PASS: file, batch, price** — once the gate returns PASS (exit 0),
  every advisory residual (minor review findings, non-blocking completeness
  findings, judgment calls) defaults to `filed:<ref>` in the residual manifest
  (`references/finishing-notes.md` §Residual manifest). Findings you do intend
  to fix go into ONE redirect round — never a round per finding. An elective
  polish relaunch is the operator's explicit choice, priced before asking:
  state the round's fixed cost (tasks relaunched × this run's per-round cost —
  quote `audit_run.py` turns/tokens for the prior round when present). This
  changes nothing for NEEDS_ACK or BLOCKED: the ack rules above stay
  authoritative, and batching never means an ack is swallowed.
- **Round artifacts** — both composers rotate the prior round's artifacts as
  their last step, after a successful emit: `report.json` is snapshotted to
  `report-<n>.json`, so every round's gate report survives. No run writes
  `heads/` any more — headShas are derived from git ancestry at finalize time
  (`docs/superpowers/specs/2026-08-26-fold-over-git-heads.md` §3-§4); a legacy
  `heads/` dir left by a pre-#259 run is still renamed to `heads-<n>/` if
  found on disk. Nothing is deleted; never clear `report.json` by hand.
- **Terminal teardown** — on **every** non-relaunch exit (declined Approve, Abort,
  abandoned `BLOCKED`), release the run lock so it does not wedge the next run
  (`RUN_LOCK` has no timeout): `ultra_gate.py --teardown --stamp <stamp>`. It keeps
  the worktrees as triage evidence — tell the operator how to remove them:
  `sweep_worktrees.sh --run <wf_runId>`, plus `sweep_worktrees.sh --run
  wf_<stamp>` for the dedicated integration worktree, which that glob misses.
  The teardown receipt's `wfRuns` lists the recorded IDs verbatim;
  `sweep_worktrees.sh --audit` re-lists kept leftovers later (age-guarded),
  and the next run's preflight surfaces them automatically.
  (Redirect and Salvage are not terminal.)

## Step 6 — Fallback

The Step-1 preflight routes here when the Workflow tool is absent. If the
committed workflow **cannot run** (feature changed, or the plan too unusual to
wave), fall back to **`superpowers:subagent-driven-development`** — the sequential
executor runs the same plan; we lose only parallelism. **Never improvise
an ad-hoc workflow script.** Hand it the `implementation` + `gate` tasks only (no
human pause); carry the `release`/`manual` tasks as the post-merge runbook. Give
it a clean checkout for using-git-worktrees isolation.

## Autonomy posture

Escalate only on catastrophe until the gate; mid-run questions are impossible
(headless). Handle ambiguity with a conservative, logged judgment call under
`judgmentCalls`; never silently drop a blocked task — it surfaces as a failed
task, blocked wave, or unfinished entry. Pre-gate aborts are only a dependency
cycle or an inability to create the integration branch.

## Resources

- `references/design-rationale.md` — maintainer WHY for every guard; load it when
  changing the engine, the gate, or the scripts.
- `references/dependency-analysis.md` — plan → DAG → waves, cycle detection.
- `references/plan-markers.md` — the `Type:`/`Depends-on:` marker contract.
- `references/reviewer-prompts.md` — the prompts and schemas baked into `waves.js`.
- `references/wave-merge.md` — per-wave merge, reconciliation, completeness critic.
- `references/report-format.md` — report schema and presentation order.
- `references/finishing-notes.md` — merge-method and deploy-scope checks.
- `references/workflow-template.md` — maintainer doc + re-bake procedure.
- `scripts/ultra_run.py`, `scripts/ultra_gate.py` — Step-1 pre-launch driver
  and Step-5 gate driver (one receipt each).
- `scripts/gate_check.py`, `scripts/run_acceptance.sh` — gate checks and
  acceptance runner the gate driver administers.
- `scripts/compile_plan.py` — the plan compiler (`--emit-launch`/`--emit-args`).
- `scripts/sweep_worktrees.sh`, `scripts/run_lock.sh` — sweep (`--run` /
  `--all` / report-only `--audit`; also reaps processes from removed or
  already-deleted engine worktrees) and run lock.
