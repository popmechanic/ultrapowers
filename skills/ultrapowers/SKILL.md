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

## Step 1 — Preflight & plan check

**Workflow-tool preflight.** The Workflow tool is absent on some surfaces (e.g.
the web). Check for it (ToolSearch `select:Workflow`). If unavailable, go to
Step 6 — do not analyze dependencies.

**Self-host skew** (only when `/ultrapowers` runs inside the ultrapowers repo):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/check_engine_skew.sh \
  "${CLAUDE_PLUGIN_ROOT}" "$(git rev-parse --show-toplevel)"
```

`IN_SYNC` → proceed. `SKEW` → copy the repo's
`skills/ultrapowers/harnesses/waves.js` into `.claude/workflows/waves.js`, then
continue; otherwise skip. *Rationale: § Step 1.*

**Superpowers compatibility.** Verify the *active* superpowers still exposes the
contract tokens ultrapowers needs. Tested with superpowers 6.0.3 — manifest
`scripts/superpowers_contract.py` (`TESTED_AGAINST`). Run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/check_superpowers_compat.py
```

- **Exit 0** — proceed; relay any `advisory:` line once, or a skip notice if
  superpowers is not resolvable (the workflow path does not need it).
- **Non-zero** — a contract token is missing: STOP and surface a human gate,
  quoting the missing tokens; confirm continuing or abort.

**Plan check.** Resolve `<plan-path>`. Accept a `superpowers:writing-plans`
document — any markdown with `### Task N:` headings carrying `**Files:**` blocks
and `- [ ]` steps (the task shape is the reliable signal; an "Implementation
Plan"/"Plan:" heading is a convenience). If none, stop and tell the user to run
`superpowers:brainstorming` then `superpowers:writing-plans`. v6 adds optional
`## Global Constraints` and per-task `**Interfaces:**` blocks; the parser stays
additive-tolerant.

## Step 2 — Compile

Do **not** hand-assemble waves, edges, or task objects — the compiler emits them.
Run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan> \
  --emit-launch <abs> --emit-args <abs2>
```

`--emit-launch <abs>` writes the verbatim, fence-aware task bodies to `<abs>`
(absolute; each agent reads its own). `--emit-args <abs2>` writes the complete
launch-args skeleton (`waves`,
`wavesPath`, `edges`, `dependencyEdges`, `acceptance`, `waveLabels`, `planPath`,
`globalConstraints`) — that skeleton **is** the launch payload; merge derived
knobs in, do not rebuild it.

**Classify first** per `references/plan-markers.md`: trust header-block
`**Type:**` / `**Depends-on:**` markers when present (out-of-block markers →
conflicts), else the contract heuristics there. Only `implementation` tasks enter
the DAG; gates inform run config; `release`/`manual` tasks ride into the
post-merge runbook. Adopt the compiler's JSON verbatim — waves, edges,
dispositions — judgment only on `"heuristic": true` entries. If it reports `no
implementation tasks` (`waves: []`), do not launch; present the runbook instead.

**Derive only your knobs** and merge them in:

- **`tier`** per task (`cheap`/`standard`/`most-capable`) by scope and
  judgment-likelihood.
- **`testCmd`** — run-wide and/or per-task, only when detection would guess wrong
  (monorepos, custom runners); polyglot → exercise **both** stacks.
- **`bootstrapCmd`** — a per-worktree dependency install for fresh worktrees (no
  `.venv`/`node_modules`).
- **`baseBranch`** — the repo default
  (`git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||'`);
  always set it.

Review depth stays **engine-derived**: the `adversarial` second pass is granted on
a genuine **risk surface** (files/title naming auth, payments, migrations,
secrets, or the persistence **data-layer**) **OR** a foundation/contract root
(Produces an interface while Consuming nothing); else `lean`. Leave `task.review`
unset; set it only as a deliberate override. *Rationale: § Step 4.*

## Step 3 — Render the wave plan (transparency, no pause)

Render the interpretation — it reappears with the final report, so a wrong
classification is auditable at the gate:

1. **Waves** — task IDs per wave, in order.
2. **Dependency `edges`** — those that shaped the ordering.
3. **Mode** — `parallel`/`sequential` (with the degrade reason).
4. **Derived knobs** — `testCmd`, engine-assigned review depth, tier overrides.
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

**4a — Install the committed workflows (idempotent).** The **SessionStart hook**
(`hooks/session_start.sh`) installs them before the engine snapshots its registry
at session start — the load-bearing install; the manual copy below is a safety
net:

```bash
mkdir -p .claude/workflows
for m in "${CLAUDE_PLUGIN_ROOT}"/skills/ultrapowers/harnesses/*.harness.json; do
  f=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['file'])" "$m")
  cp "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/harnesses/$f" ".claude/workflows/$f"
done
```

Copy unconditionally; never edit the copy. *Never launch via the `ultracode`
keyword or a prose "make me a workflow"; rationale: § Step 4 / § Step 4a.*

**4a½ — Engine preflight.** Launch `ultrapowers-probe` to check arg delivery. Pass
`args = { ping: 'pong', waves: [{ id: 'probe-1', title: 'probe', body: 'b' }] }`;
it spawns no agents. **Assert the round-trip:** `result.echoWaves === 1` and
`result.echoFirstId === 'probe-1'`. Branch on how it fails:

- **Not found** (`Workflow "ultrapowers-probe" not found`) — the engine registers
  saved workflows only at session start, so the snapshot predates the install.
  **Not** engine drift: the only cure is a **new session** (the SessionStart hook
  installs before the next snapshot) — do **not** route to the sequential
  fallback. If the file is genuinely absent, the Step-4a install failed; go Step 6.
- **Launches but `ok` is not true / errors mid-run** — engine drift; go to Step 6.
- **`echoWaves`/`echoFirstId` mismatch** — a payload round-trip failure; go to
  Step 6. *Rationale: § Step 4a½.*

**4b — Acquire the run lock and snapshot the checkout** (no shell or runId in the
engine):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh acquire <runId>
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh snapshot
```

Use the transcript stem `wf_<runId>` (a provisional id is fine at `acquire`). If
`acquire` exits non-zero, another run holds this repo — **STOP** and serialize
runs.

**4c — Launch the saved workflow by `meta.name` `ultrapowers-run`** via the
Workflow tool (never author or edit it). Pass the `--emit-args` skeleton with
derived knobs merged in:

```
args = { ...emittedArgs, integrationBranch: 'ultra/integration-<stamp>', stamp,
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

**1. Restore the session checkout.** The setup agent left it on the integration
branch; **restore the session checkout** this run started from (the pre-launch
snapshot is the authority) — never a bare `git checkout <baseBranch>` (it strands
the gate on the integration branch):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh restore
```

**2. Save the report** JSON verbatim to `.claude/ultrapowers/report-<stamp>.json`.

**3. Run the deterministic gate checks:**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/gate_check.py \
  --run-id <runId> --branch <integrationBranch> --report <path>
```

It checks the lock, tree cleanliness, the merge-sha guard, HEAD-vs-report
(#29/#32), `gitVerified`, ancestry, and deliverables — fail-closed, so a
hand-edited report can only BLOCK. **Exit 1 (BLOCKED)** → present
the failing checks, do NOT Approve. **Exit 2 (NEEDS_ACK)** → present the acks for
explicit operator acknowledgement before Approve. **Exit 0** → continue.
*Rationale: § Step 5.*

**4. Administer acceptance deterministically, per disposition.** Exit code is the
authority; the report's `tests.passed` is triage context.

- **`sealed`** → `bash …/run_acceptance.sh <sealId> <integrationBranch> <sha256>`
  (its own detached worktree). Exit 0 ⇒ passed, non-zero ⇒ do NOT Approve; render
  the emitted JSON verbatim. *Why here, not the workflow: § Step 5 (#36).*
- **`suite` AND unmarked (`null`)** →
  `bash …/run_acceptance.sh --suite-gate --branch <integrationBranch> --run <derived testCmd> --base <baseBranch>`.
- **`waived`** → record the waiver verbatim.

**5. Render the report** per `references/report-format.md` plus the **post-merge
runbook** (`release`/`manual` tasks, verbatim), then present:

- **Approve** — only on gate_check exit 0 (or an acknowledged exit 2) **AND**
  acceptance exit 0. Then `git checkout <integrationBranch>` (re-verifies tests on
  the integration tree), sweep, and release:
  ```bash
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh --run <runId>
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh release <runId>
  ```
  When work spanned **multiple phases or runs**, run one **holistic cross-phase**
  review of the fully-integrated tree against the *combined* plan and gate on it
  **before the final PR** (single-run pipelines already got it at Step 4), then
  apply the two `references/finishing-notes.md` checks and proceed to
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
  abandoned `BLOCKED`), **release the run lock** so it does not wedge the next run
  (`RUN_LOCK` has no timeout):
  ```bash
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh release <runId>
  ```
  Do **not** auto-sweep — the worktrees and unmerged branches are triage evidence;
  tell the operator how to remove them: `sweep_worktrees.sh --run <runId>`.
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
- `scripts/gate_check.py`, `scripts/run_acceptance.sh` — Step-5 gate and runner.
- `scripts/compile_plan.py` — the plan compiler (`--emit-launch`/`--emit-args`).
- `scripts/sweep_worktrees.sh`, `scripts/run_lock.sh` — sweep and run lock.
