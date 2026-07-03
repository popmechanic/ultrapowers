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
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_run.py <plan> --stamp <stamp>
```

One call runs every deterministic stage fail-closed — git-repo check,
worktree-capability probe, self-host engine skew, superpowers compatibility,
compile (`--emit-launch`/`--emit-args`), committed-workflow install, run lock +
checkout snapshot, and `baseBranch` derivation — and writes the receipt to
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

The stamp is the lock id for the whole run; `wf_<runId>` is only for sweeps.
*Rationale: § Step 1.*

## Step 2 — Judge and fill (LLM-owned)

**Classify first** per `references/plan-markers.md`: trust header-block
`**Type:**` / `**Depends-on:**` markers when present (out-of-block markers →
conflicts), else the contract heuristics there. Only `implementation` tasks enter
the DAG; gates inform run config; `release`/`manual` tasks ride into the
post-merge runbook. Adopt the compiler's JSON verbatim (`receipt.compile`) —
waves, edges, dispositions — judgment only on `"heuristic": true` entries. If it
reports `no implementation tasks` (`waves: []`), do not launch; present the
runbook instead.

**Derive only your knobs**, which land in named slots — per-task `tier` fills the
receipt's `launchFile` (slots pre-emitted as `null`); `testCmd` / `bootstrapCmd`
and any review override ride the launch args. The receipt's `llmDerives` list is
the checklist:

- **`tier`** per task (`cheap`/`standard`/`most-capable`) by scope and
  judgment-likelihood.
- **`testCmd`** — run-wide and/or per-task, only when detection would guess wrong
  (monorepos, custom runners); polyglot → exercise **both** stacks.
- **`bootstrapCmd`** — a per-worktree dependency install for fresh worktrees (no
  `.venv`/`node_modules`).
- **`baseBranch`** — already derived in `receipt.baseBranch`; pass it through.

Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly on the session checkout.

Review depth is **plan-authored**: ultraplan's `**Review:**` marker fills each
task's `review` slot (`lean` when unmarked), shown in the render; never set
`task.review` yourself — the run-wide `reviewProfile: adversarial` hatch only
raises depth. *Rationale: § Step 4.*

## Step 3 — Render the wave plan (transparency, no pause)

Render the interpretation — it reappears with the final report, so a wrong
classification is auditable at the gate:

1. **Waves** — task IDs per wave, in order.
2. **Dependency `edges`** — those that shaped the ordering.
3. **Mode** — `parallel`/`sequential` (with the degrade reason).
4. **Derived knobs** — `testCmd`, plan-authored review depth, tier overrides.
5. **Dispositions** — release/manual → runbook, gates → run config. Render the two
   `marker_conflicts` buckets **separately by `kind`:** `kind: "conflict"` as
   *needs attention*, `kind: "inference"` as *informational*. When it reports
   `allHeuristic: true`, show **`0 markers — all dispositions inferred`**.
6. **Acceptance disposition** — `sealed <seal-id>` or the verbatim waiver. When
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
         baseBranch, testCmd?, bootstrapCmd?, reviewProfile?, tierOverrides? }
```

`args.edges` drives dependency blocking (the workflow ignores task `depends_on`) —
always pass it, or blocking is silently disabled. The headless workflow creates
the branch, runs/merges/reconciles each wave (16-agent cap), then reviews
completeness (`references/wave-merge.md`).

**Viewer offer (interactive runs only).** One-line opt-in *"Want to watch
live?"* — on yes:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir> --watch . <integrationBranch>
```

Hand back the printed URL; tear it down at the gate with
`serve_viewer.py --stop <dir>`. Skip if headless.

## Step 5 — Pre-merge gate (human gate)

Save the Workflow tool's raw result JSON verbatim to a file (the driver unwraps
the envelope itself; gate fields live under `result.*`), then **run the gate
driver:**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py \
  --stamp <stamp> --result <saved-result.json>
```

Its first act is to restore the session checkout the run started from — the
pre-launch snapshot, not a bare `git checkout <baseBranch>` (which would strand
the gate on the integration branch). It then saves the report, runs
`gate_check.py` (clean-tree blocks only on dirt **new** since the snapshot;
pre-existing operator files pass with a note), and administers acceptance per the
compiled disposition — sealed exam, suite gate, or verbatim waiver. The report's
`tests.passed` is triage context; the **exit code is the authority**:

- **0 (PASS)** → render the report and offer **Approve**.
- **2 (NEEDS_ACK)** → present the acks for explicit operator acknowledgement first.
- **1 (BLOCKED)** → present the failing checks; do **NOT** Approve.

Render the report per `references/report-format.md` plus the **post-merge runbook**
(`release`/`manual` tasks, verbatim), then present:

- **Approve** — only on PASS (or an acknowledged NEEDS_ACK). Run
  `ultra_gate.py --approve --stamp <stamp> --wf-run <wf_runId>` — it does
  `git checkout <integrationBranch>` (re-verifies tests on the integration tree),
  sweeps the run's worktrees, and releases the lock. When work spanned **multiple
  phases or runs**, run one **holistic cross-phase** review of the fully-integrated
  tree against the *combined* plan and gate on it **before the final PR**
  (single-run pipelines already got it at Step 4), then apply the two
  `references/finishing-notes.md` checks and proceed to
  `superpowers:finishing-a-development-branch`, carrying the runbook.
- **Salvage** — offer whenever the report has `failed` tasks or dep-blocked
  `unfinished` entries. Build the new `waves` mechanically: every `failed` task
  plus every dep-/cascade-blocked `unfinished` task, in Step-2 order with their
  edges. Append a **PRIOR ATTEMPT** note to each failed task's `body` — its
  **kept branch** + HEAD sha from `tasks[]`, its blocking `notes`, any
  completeness finding naming it, and the instruction to pull correct prior work in
  (`git checkout <sha> -- <path>`) rather than reimplement. Present the salvage
  waves, relaunch (`resume: true`, same `integrationBranch`), return here.
- **Redirect** — append corrective instructions to **only the affected** task
  bodies and relaunch `ultrapowers-run` with `resume: true` and the **same**
  `integrationBranch`. Return here.
- **Terminal teardown** — on **every** non-relaunch exit (declined Approve, Abort,
  abandoned `BLOCKED`), release the run lock so it does not wedge the next run
  (`RUN_LOCK` has no timeout): `ultra_gate.py --teardown --stamp <stamp>`. It keeps
  the worktrees as triage evidence — tell the operator how to remove them:
  `sweep_worktrees.sh --run <wf_runId>`. (Redirect and Salvage are not terminal.)

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
task, blocked wave, or unfinished entry. The only pre-gate aborts are a dependency
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
- `scripts/ultra_run.py`, `scripts/ultra_gate.py` — the deterministic Step-1
  pre-launch driver and the Step-5 gate driver (one receipt each).
- `scripts/gate_check.py`, `scripts/run_acceptance.sh` — the gate checks and
  acceptance runner the gate driver administers.
- `scripts/compile_plan.py` — the plan compiler (`--emit-launch`/`--emit-args`).
- `scripts/sweep_worktrees.sh`, `scripts/run_lock.sh` — sweep and run lock.
