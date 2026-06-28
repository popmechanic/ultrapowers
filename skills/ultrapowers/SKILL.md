---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", "run the plan as a workflow", or wants to autonomously implement an approved Superpowers plan in parallel waves across git worktrees.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---

# Ultrapowers

Autonomously implement an approved Superpowers plan via a **committed, parallel,
worktree-isolated Dynamic Workflow**. This skill does not author a workflow at runtime: it
validates the plan, computes the parallel wave plan, renders that wave plan for transparency,
then immediately launches the frozen `waves.js` that ships with the skill. Choosing
ultrapowers at the planning session's execution handoff (or invoking `/ultrapowers` on an
approved plan) **is** the authorization to execute — there is no separate wave-plan approval
pause. Each task runs in its own
git worktree and passes an independent review (spec-compliance + code-quality in one pass by default;
two passes under the `adversarial` profile) before its branch merges into a single integration branch. A human-readable report and a merge gate conclude the run.

The discipline (implementer/reviewer/completeness prompts and schemas) is **baked into
`waves.js` at build time**, not loaded from Superpowers at runtime — so execution does not
depend on live `superpowers:*` skill resolution. Superpowers and ultrapowers hand off only
through the plan file on disk.

---

## Invocation Context

Run this skill from **inside the target project's git repository**: `/ultrapowers <plan-path>`.
Runtime worktree isolation binds every task agent's worktree to this session repo, so the
workflow carries no external target path. Do not run from a detached HEAD or from outside the
project tree.

---

## Step 1 — Confirm an Approved Plan Exists

**Preflight — confirm the Workflow tool exists on this surface.** The Workflow tool is an
undocumented/experimental surface and is absent in some environments (e.g. Claude Code on the
web). Check for it now (e.g. ToolSearch `select:Workflow`). If it is unavailable, go directly to
Step 6 and run the fallback — do **not** perform dependency analysis or render a wave plan that
cannot launch.

**Self-host skew preflight (when `/ultrapowers` runs inside the ultrapowers repo itself).** When the working directory is the ultrapowers repository, the installed plugin cache may lag `main` — launching the stale cache means the self-test exercises the wrong engine ([ae56a1205e971b82]). Detect skew before launch:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/check_engine_skew.sh \
  "${CLAUDE_PLUGIN_ROOT}" "$(git rev-parse --show-toplevel)"
```

- On `IN_SYNC` — the cached engine matches repo `main`; proceed.
- On `SKEW` — install the repo engine into `.claude/workflows/` before launch so the run exercises the current repo code, not the stale cached copy: copy `$(git rev-parse --show-toplevel)/skills/ultrapowers/harnesses/waves.js` to `.claude/workflows/waves.js`. This overwrite is safe — Step 4a already treats the installed file as ephemeral and overwrites it each run. After installing, continue to the plan check below.

This preflight only applies when self-hosting (the repo root matches the plugin root's parent tree). In ordinary project use the cache is the correct engine; skip it.

**Superpowers compatibility preflight.** Before computing waves, verify the
*active* superpowers still exposes the contract tokens ultrapowers depends on.
Tested with superpowers 6.0.3 — the contract manifest lives in
`skills/ultrapowers/scripts/superpowers_contract.py` (`TESTED_AGAINST`).
The active install is the one Claude Code actually serves skills from — resolved
from `enabledPlugins` + `installed_plugins.json`, **not** by listing a cache
directory (an earlier check listed one hard-coded path and so read a *disabled*
install's version). Run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/check_superpowers_compat.py
```

Act on the result:

- **Exit 0** — proceed. If it printed an `advisory:` line (your superpowers
  version differs from the tested-against version but every contract token is
  present), relay that line once and continue.
- **Exit 0 with a skip notice** (superpowers not installed/resolvable) — proceed;
  the workflow path does not depend on live superpowers.
- **Non-zero** — a contract token ultrapowers depends on is missing. STOP and
  surface a human gate: quote the missing tokens the script printed (file + token
  + why) and ask the operator to confirm continuing despite the contract break,
  or abort. Suspect upstream drift first;
  `python3 -m pytest tests/test_superpowers_compat.py` localizes it in the
  ultrapowers repo.

**v6 plan signals:** v6 adds two optional plan blocks — `## Global Constraints` in
the header and a per-task `**Interfaces:**` block (`- Consumes:` / `- Produces:`).
The parser stays additive-tolerant: a v5 plan without them still compiles.

Resolve `<plan-path>` (the argument to `/ultrapowers`). Verify it is a `superpowers:writing-plans`
plan document. The current `writing-plans` template heads the file `# <Feature> Implementation Plan`
and titles each task `### Task N: <name>`, so accept a plan whose top-level heading matches
"Implementation Plan" **or** "Plan:", **or** any markdown file that contains `### Task N:` headings
with `**Files:**` blocks and `- [ ]` checkbox steps. The task-shape check is the reliable signal;
the heading match is a convenience, not a gate.

If no approved plan is found, stop. Inform the user: "No approved plan found. Run
`superpowers:brainstorming` to explore the problem, then `superpowers:writing-plans` to produce a
structured plan document. Return here once the plan is approved." Do not proceed with a plan that
exists only as freeform prose — it must have numbered tasks with explicit file lists.

---

## Step 2 — Analyze Dependencies and Compute Waves

Follow `references/dependency-analysis.md` in full to turn the plan into a `waves: Task[][]`
structure. Each task object is `{ id, title, body, tier, acceptance, files, review?, testCmd? }`,
where `body` is the full verbatim task text and `review` (`'adversarial'` | `'lean'`, optional) is the
per-task depth you derive below.

**Do not hand-assemble the task objects — the compiler emits them.** `compile_plan.py` already parses
the plan fence-aware; re-parsing it yourself is the exact duplicate-parser drift `references/dependency-analysis.md`
warns against. Run it with `--emit-launch` (Step 4b) and pass its `launch_waves` (id/title/files/depends_on)
through, augmenting only the knobs that are genuinely yours to derive (`tier`, `review`, and any per-task
`testCmd`).

**Body delivery — do not put 88KB of bodies inline.** For anything but a tiny plan, deliver bodies via a
file, not inline in the Workflow call: an LLM cannot reliably emit tens of KB of escaped JSON as one
value. `compile_plan.py --emit-launch <path>` writes the verbatim, fence-aware bodies to `<path>`; you
pass the LIGHT `launch_waves` inline as `args.waves` plus `args.wavesPath: <path>`, and each task agent
reads its own body from the file by id (Step 4b). Inline `body` is still supported for small/back-compat
plans, but **never** hand-author a body that is a pointer to a plan section — that silently breaks when
`baseBranch` lacks the plan; the `--emit-launch` file is read off disk regardless of branch contents.

- **Classify first** per `references/plan-markers.md`: trust header-block `**Type:**`
  markers when present (markers outside the contiguous block after the heading are
  ignored and surfaced as conflicts), else the contract heuristics there. Only `implementation` tasks enter the
  DAG. Gates compile into run config (their suite commands inform `testCmd`);
  `release`/`manual` tasks go verbatim into the post-merge runbook. Extract task
  bodies fence-aware — headings inside code fences are content, not boundaries.
  Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>` on every plan. Marked plans: adopt its JSON as the transparency block's waves/edges/dispositions verbatim, applying judgment only to `"heuristic": true` entries and the derived knobs. Unmarked plans: the compiler applies the contract heuristics and flags every call — verify the flagged entries against `references/plan-markers.md` instead of hand-deriving.
  If the compiler reports `no implementation tasks` (gates/release/manual only — `waves: []`), do NOT launch the workflow (it refuses empty waves): compile the gates into run config as usual, then go straight to a Step-5-style presentation of the post-merge runbook for the human to execute or schedule.
- **Parse** each task's `writes` set (`Create:` ∪ `Modify:`), its `reads` set (`Test:` paths), any `**Depends-on:**`
  markers (additive to inference), and any explicit `depends on` text.
- **Build the DAG** with the edge rules in `references/dependency-analysis.md` (marker, write-after-create, write-after-write, text, read-after-write, prose-reference); **run cycle detection** before computing waves.
  If a cycle is found, stop and surface it in plain language — never guess an ordering.
- **Apply conservative defaults** and the **small-plan degrade** (exactly 1 implementation task, or fully overlapping writes → sequential mode: one single-task wave per task, in dependency order). Two or more tasks with disjoint writes stay parallel; dependency edges still serialize them by topology within parallel mode.
- **Assign a model tier** per task (`cheap` / `standard` / `most-capable`) by estimated scope **and judgment-likelihood** (the risk classes in `references/reviewer-prompts.md` bump small-diff tasks to `standard`).
- **Derive the run knobs yourself — do not ask the human to hand-tune them.** You read the plan and
  run inside the repo, so you are the right party to set these; they are shown in the Step-3
  transparency render and audited at the pre-merge gate.
  - **`testCmd`** — detect how *this* repo runs tests (inspect `package.json` scripts / `Makefile` /
    monorepo layout, or lift it from the plan's **Tech Stack** line). Set it only when the workflow's
    built-in detection ladder would guess wrong (monorepos, custom runners); otherwise omit.
  - **Polyglot / monorepo repos (e.g. pytest at root + `bun test` in `app/`).** Two facts about the
    engine drive the knobs: (1) the merge and completeness roles test the *integrated tree on the
    session main checkout* (which has all deps), so set the run-wide `testCmd` to a single command that
    exercises **both** stacks — `python3 -m pytest -q && (cd app && bun test)`; (2) task agents run in
    **fresh worktrees with no `.venv` / `node_modules`**, so set **`bootstrapCmd`** to install every
    stack the tasks touch — `python3 -m venv .venv && .venv/bin/pip install -e . && (cd app && bun install)`
    — it is threaded only into the worktree-isolated roles (implementer/reviewer/fix). Where a task is
    single-stack, give it a per-task `testCmd` (e.g. `.venv/bin/pytest -q tests/test_x.py`) so its
    implementer runs only the relevant suite; it overrides the run-wide `testCmd` for that task. A plan
    that naturally writes `.venv/bin/pytest …` test steps is then correct because `bootstrapCmd` created
    the `.venv` first.
  - **`baseBranch`** — the repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||'` — strip the remote prefix; `origin/main` as a checkout target lands detached,
    falling back to the current branch). Always set it; it anchors the integration branch and the
    review diff base.
  - **Per-task review depth (`task.review`)** — mark a task `adversarial` (two
    independent review passes) only when it is on a **genuine risk surface**
    (sealed acceptance, or it touches auth / payments / migrations / public-API /
    data-integrity — read from its `Type` / `Files` / body) **OR** it is a
    **foundation / data-layer** task (owns the persistence/data layer and/or has
    downstream dependents — the class that has caught real wiring bugs). Tier alone
    never triggers it: routine `cheap`/`standard` tasks with no risk signal stay
    `lean` (one pass). This is derived from the plan, not asked.
  - **`tierOverrides`** — leave empty unless the human stated a budget *posture* in plain language
    ("keep this cheap", "be thorough"); translate that, never invent it. Per-task tiers already come
    from the plan.
- **Acceptance:** the compiler output's `acceptance` field rides into the launch args in one of three forms: `{ mode:'sealed', sealId, sha256, scriptPath }`, `{ mode:'suite', reason }`, `{ mode:'waived', reason }`. For `sealed` mode the orchestrator resolves `scriptPath` to `<plugin-root>/skills/ultrapowers/scripts/run_acceptance.sh`. A compile failure for a missing Acceptance line is surfaced to the human with the ultraplan sealing step named as the remedy.
- **Record** the DAG edges, wave list, mode, any degrade reason, the dispositions
  (gates compiled into config, runbook entries, marker conflicts, inlined preamble
  notes), and the derived knobs (the transparency block).

---

## Step 3 — Render the Wave Plan (transparency, no pause)

Render the transparency block from Step 2 for the human:

1. **Waves** — one line per wave: which task IDs run in parallel, in wave order.
2. **Dependency edges** — the edges that shaped the ordering.
3. **Mode** — `parallel` or `sequential` (with the degrade reason if sequential).
4. **Derived knobs** — the test command you'll use, which tasks get `adversarial` vs `lean` review,
   and any tier overrides. Show them so the human can see what you derived — they did not author
   these.
5. **Dispositions** — which tasks were excluded as `release`/`manual` (the post-merge
   runbook), which gates were compiled into run config, any superseded ordering prose
   or marker conflicts. This is the rendered **interpretation** of the plan, not
   just the grouping — it reappears with the final report so a wrong classification
   is auditable at the pre-merge gate. **Separate the two `marker_conflicts` buckets by their
   `kind` field:** render `kind: "conflict"` entries (unparseable types, ghost dependencies,
   near-miss spellings, dropped non-path Files tokens) as *needs attention*, and `kind: "inference"`
   entries (a write/prose edge that correctly overrode a `Depends-on: none`, an inferred
   prose-reference edge) as *informational inferences* — the latter are the compiler showing its work,
   not problems to fix, so do not surface them as if they were. When the compiler reports
   `allHeuristic: true` (the plan carries zero `Type:`/`Depends-on:` markers), the render
   shows **`0 markers — all dispositions inferred`** so the operator knows every disposition
   was heuristic, not authored.
6. **Acceptance disposition** — render the acceptance disposition: `sealed <seal-id>` or the verbatim waiver reason. The human approves it with the rest of the interpretation.

   When the disposition is `sealed`, present the exam's plain-English **coverage summary** (appended to the plan by the ultraplan sealing step) and give the operator this rubric for vouching — it needs **no code-reading**:

   > You are not judging whether the test code is correct — you can't see it and don't need to. You are checking that the coverage summary is a faithful, complete restatement of **your** spec:
   > 1. **Everything covered?** Walk the spec one requirement at a time; each should map to a row in the summary. A requirement with no matching row is a gap.
   > 2. **Invented anything?** Scan for checks the spec never asked for — an honest implementation could fail the exam for the wrong reason. Small implied edge cases are fine.
   > 3. **Your examples present?** The spec's concrete examples should appear in the exam verbatim — the sharpest checks.

   If the operator cannot vouch, the remedy is to re-seal (ultraplan sealing step) or waive explicitly — never rubber-stamp.

Then proceed **directly to Step 4 — do not ask for approval and do not pause.** The human already
authorized execution: they approved the plan itself, then selected ultrapowers as the execution
engine at the planning session's handoff (or invoked `/ultrapowers` on the approved plan). The
render exists so they can audit the interpretation, not so they can approve it. There is no
window to amend the wave plan before launch: if the human sees it is wrong, the recourse is to
stop the run, revise the plan document, and re-invoke `/ultrapowers`. A bad parallelization or
classification guess is otherwise caught at the pre-merge review (Step 5), which remains the
run's human gate. The only Step-2/3 findings that stop the run
are a dependency cycle or an inability to extract tasks — surface those and stop; everything else
launches.

---

## Step 4 — Launch the Committed Workflow

**4a — Install the committed scripts as project saved workflows (idempotent).** Saved workflows
(`.claude/workflows/*.js`) are the documented deterministic launch surface: they run **by name**
with `args`, instead of relying on ad-hoc script delivery. Plugins cannot ship saved workflows, so
the copies must be installed into the project.

The plugin's **SessionStart hook** (`hooks/session_start.sh`) does this install at the start of
*every* session — that is the load-bearing install, because the engine snapshots its saved-workflow
registry **once, at session start**. A copy that lands on disk before that snapshot is registered
this session; a copy written *during* the session (the manual install below) is only registered
**next** session. This is exactly why a fresh checkout's first `/ultrapowers` could fail with
`Workflow "ultrapowers-probe" not found` even though Step 4a had just copied the file: the project
`.claude/workflows/` is gitignored and starts empty, so at the registry snapshot only the plugin-
shipped workflows existed. The hook closes that window for normal use.

Still run the manual install below as an idempotent safety net (in case the hook did not run — hooks
disabled, a non-hook surface, or a hand-installed skill). Install by reading each `*.harness.json`
manifest from the harnesses library:

```bash
mkdir -p .claude/workflows
for m in "${CLAUDE_PLUGIN_ROOT}"/skills/ultrapowers/harnesses/*.harness.json; do
  f=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['file'])" "$m")
  cp "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/harnesses/$f" ".claude/workflows/$f"
done
```

(`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's installed root — the directory containing `skills/`.)
Harnesses are copied from `skills/ultrapowers/harnesses/` by manifest; the installed filename is
immaterial because the engine resolves saved workflows by the script's `meta.name`, not the filename.

Run the copy unconditionally — it is byte-for-byte the committed script, so overwriting keeps any
stale copy in sync with the installed plugin version. Never edit the copy. (The user may commit it
or gitignore it; Step 4a keeps it current either way.)

> **Determinism guard:** never trigger the run with the `ultracode` keyword or by asking for "a
> workflow" in prose — that opt-in makes Claude **author a new script at runtime**, which is
> exactly the nondeterminism this skill exists to remove. The only sanctioned launch is the saved
> workflow installed above. If it cannot be launched, diagnose with the Step 4a½ preflight before
> falling back — a freshly installed-this-session copy that the engine cannot yet see is a stale
> registry (cured by a new session), **not** the engine drift that Step 6 exists for.

## The read/write boundary

ultrapowers runs two kinds of phase, and they have different rules:

- **Write-side phases** — anything that creates branches, edits files, merges,
  or otherwise mutates a repository — MUST be executed by a registry harness
  (a `skills/ultrapowers/harnesses/<name>.harness.json` whose `writeSide` is
  true), launched by its `meta.name`. Never author or improvise a write-side
  harness at runtime.
- **Read-only phases** — discovery, triage, research, scoring — MAY be
  improvised at runtime as dynamic workflows, and an improvised workflow MUST
  stay read-only.

This is policy enforced by prompts and review, not a sandbox; the hard
guarantee is that nothing improvised ever holds the merge keys. The
determinism guard restated: never launch write-side work via the `ultracode`
keyword or a prose "make me a workflow" request — that authors a new script at
runtime, which is exactly the nondeterminism the registry exists to remove.

**4a½ — Engine preflight.** Launch the saved workflow `ultrapowers-probe` with a representative
payload to verify that the by-name launch delivers args faithfully — a tiny `ping`-only probe can
pass while a real-sized payload is silently dropped ([fb8635c59d4fea1c]). Pass:

```
args = { ping: 'pong', waves: [{ id: 'probe-1', title: 'probe', body: 'b' }] }
```

The probe spawns no agents and returns `{ ok: true, ping: 'pong', echoWaves: 1, echoFirstId: 'probe-1', ... }`
in seconds. **Assert the round-trip**: verify `result.echoWaves === 1` and `result.echoFirstId === 'probe-1'`
(the probe echoes back the waves count and first task id so a by-name launch's arg delivery is
confirmed, not just `ping`). Branch on *how* it fails — the failure modes have different cures:

- **Not found** (`Workflow "ultrapowers-probe" not found. Available: ...`) — the engine's
  saved-workflow registry, snapshotted at session start, predates the install. This is **not**
  engine drift. Confirm the file is on disk (`.claude/workflows/probe.js`, with
  `meta.name: 'ultrapowers-probe'`); if it is, the only cure is a **new session** (the
  SessionStart hook will have installed it before the next snapshot). Tell the human:
  "The ultrapowers workflows were just installed but the engine registers saved workflows only at
  session start. Start a fresh session and re-run `/ultrapowers <plan-path>`." Do **not** route to
  the sequential fallback for this case — a restart restores the parallel path. If the file is
  genuinely absent after Step 4a (the install failed — e.g. no `python3`, unreadable
  `${CLAUDE_PLUGIN_ROOT}`), report that install failure, then go to Step 6.
- **Launches but `ok` is not true, or errors mid-run** — the engine accepted the workflow but the
  args/return dialect changed under us. The engine has drifted — go directly to Step 6; do not
  launch the real workflow.
- **`echoWaves` or `echoFirstId` mismatch** — the by-name launch is dropping or truncating the
  `waves` arg ([fb8635c5]). This is a payload round-trip failure: go to Step 6 (sequential
  fallback). Do **not** launch the real workflow with an arg-delivery failure confirmed.

**4b — Acquire the run lock and snapshot the session checkout** (the deterministic actor — the engine cannot do this; it has no shell or runId). Before launching the workflow, acquire a run lock so a second concurrent `/ultrapowers` run in this repo is refused loudly, and snapshot the current session checkout so it can be restored exactly at the gate regardless of what the setup agent checks out:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh acquire <runId>
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh snapshot
```

Use the run's transcript-dir stem (`wf_<runId>`) as `<runId>` — it is printed in the Workflow launch result; for the acquire step, a provisional id (e.g. the `stamp` value) is acceptable and can be updated once the runId is known. If `run_lock.sh acquire` exits non-zero, another `/ultrapowers` run holds this repo — **STOP** and tell the operator to serialize runs (see CLAUDE.md); do not launch.

**4c — Launch the saved workflow by name `ultrapowers-run`** (the committed script — do **not** author
or edit it) via the **Workflow** tool. The registry resolves saved workflows by the script's
`meta.name` (`ultrapowers-run`), **not** the installed filename (`waves.js`) — launching as
`waves` fails with "not found". (The workflow is named `ultrapowers-run`, not `ultrapowers`, so the
engine's auto-registered `/<meta.name>` command cannot shadow this `/ultrapowers` skill — see
`docs/bugs/2026-06-15-ultrapowers-command-collision.md`.) Pass:

```
args = { waves, wavesPath?, integrationBranch: 'ultra/integration-<stamp>', stamp, dependencyEdges,
         edges, baseBranch, planPath, testCmd?, bootstrapCmd?, reviewProfile?, tierOverrides?,
         acceptance?: { mode: 'sealed', sealId, sha256, scriptPath } | { mode: 'suite', reason } | { mode: 'waived', reason } }
```

**Assemble `waves` and `wavesPath` from the compiler, not by hand.** Run
`compile_plan.py <plan-path> --emit-launch <abs-path>` where `<abs-path>` is a writable, absolute
path the task agents can read — e.g. `"$(pwd)/.claude/ultrapowers/waves-<stamp>.json"` (`mkdir -p`
its parent; it is read off disk, so it need not be committed and `.claude/` being gitignored is fine).
Then build `args.waves` from the compiler's `launch_waves` (its light id/title/files/depends_on
objects), adding the per-task `tier`/`review`/`testCmd` you derived — **do not include `body`** — and set
`args.wavesPath` to `<abs-path>`. The bodies live in that file; each task agent reads its own by id, so
nothing multi-KB rides inline. (For a tiny plan you may instead inline full `body` strings and omit
`wavesPath` — both forms work, and they may mix.)

Pass the computed `waves`, a timestamp `stamp` (the script cannot call `Date.now()`), and the
recorded `dependencyEdges`, plus the knobs you **derived in Step 2** (all optional; omitting them
preserves standard behavior):

- `testCmd` — the exact test command for *this* repo (monorepos / non-standard runners), so the
  merge and completeness agents don't have to guess. For polyglot repos make it run BOTH stacks (it
  tests the integrated tree on the main checkout); a per-task `task.testCmd` narrows the command for an
  individual implementer/reviewer.
- `bootstrapCmd` — a per-worktree dependency-install command for fresh worktrees (which have no
  `.venv` / `node_modules`), threaded only into the worktree-isolated roles. Required whenever the plan's
  test steps assume installed deps (`.venv/bin/pytest …`, `bun test`) — see the polyglot guidance in Step 2.
- `planPath` — the resolved plan path from Step 1, so the completeness critic reviews against the
  actual plan, not just the task list.
- **Per-task review depth** rides on each task object as `task.review` (`'adversarial'` | `'lean'`).
  `reviewProfile` sets the *run-wide default* for tasks that don't specify one; a task's own `review`
  overrides it. So high-stakes tasks get two independent review passes while routine ones stay lean —
  without paying for the extra pass everywhere.
- `tierOverrides` — e.g. `{ cheap: 'sonnet' }` to remap *implementer* tiers (reviewers and the completeness critic stay at the strongest model regardless; setup/merge run at the overridden `cheap`, and reconcile/fix-rounds at the overridden `mostCapable`).
- `edges` — the structured dependency pairs `[[fromTaskId, toTaskId], ...]` from
  Step 2 (the same edges rendered as prose in `dependencyEdges`). The workflow uses
  them to block transitive dependents of a failed task instead of dispatching them.
  Convert the compiler's `dag_edges` objects to bare pairs (`[e.from, e.to]`) — the workflow throws on malformed entries rather than silently disabling dependency blocking.
  **`launch_waves` task objects carry `depends_on` for transparency, but the workflow ignores it — dependency blocking is driven ONLY by `args.edges`.** Always pass `edges`; do not assume the `depends_on` on the passed-through task objects substitutes for it, or blocking is silently disabled. (`wavesPath` likewise delivers only bodies; `edges`/`acceptance` in that file are inert — pass them as args.)

The workflow validates `args.waves` and **throws loudly** if it is missing or malformed rather than
risk mutating the wrong repository. Do not pause mid-run —
workflows are headless and cannot receive input after launch. The workflow creates the integration
branch, runs each wave (`parallel()` barrier, chunked to the 16-agent engine cap), merges each wave,
reconciles failures, and runs a final integration/completeness review. See
`references/wave-merge.md` for the mechanics that are baked into the script.

**After launch, offer the live, readable view (interactive runs only).** The run is headless, but this conversation is not — surface a one-line opt-in: *"Want to watch live? I'll open the swarm viewer — live progress and every agent's transcript, streaming."* On yes, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir> --watch . <integrationBranch>` and hand back the printed `http://localhost:<port>/swarm.html`. One viewer now does both jobs: `swarm_watch` writes `status.json` (station state) **and** `agents.json` (the live cross-agent feed + per-agent index) from the run's git + transcript footprints, and the viewer streams each agent's transcript on demand. The transcript dir is printed in the Workflow launch result ("Transcript dir:"). Tear it down at the gate (`serve_viewer.py --stop <dir>`). Skip the offer in a headless/non-interactive run.

---

## Step 5 — Present the Pre-Merge Report (human gate)

**First, restore the session checkout.** Restore the exact session checkout this run started from (not an assumed base — the snapshot recorded before launch is the authority). The workflow's setup agent checks out the integration branch in the session repository and nothing switches it back:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh restore
```

Skipping this (or using a bare `git checkout <baseBranch>`) makes every `git log`/`git merge` at this gate silently target the integration branch, so the work *looks* prematurely merged when it is not.

Then confirm this run still owns the lock before any merge decision (a concurrent run cannot have snuck in):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh check <runId>
```

If `check` fails, another run has replaced the lock — surface as `BLOCKED` and do not Approve.

**Then assert the session checkout is clean and on the right tree — the deterministic guard for #29/#32.** A misbehaving review role cannot police itself and the engine has no shell, so this check lives here, where the main session does have one. On the session repo, before any gate decision:

- `git status --porcelain` MUST be **empty**. A non-empty result means a role wrote outside the worktree discipline (as in #32) — that work is unreviewed by construction. Do **not** Approve: surface the diff to the human as a `BLOCKED` condition for explicit disposition; never silently absorb or `git reset` it away (silently moving trees is the very behavior #29 punished).
- **Result-schema degrade guard:** before indexing `waveMerges[last].headSha`, check that `waveMerges` is present, non-empty, and that its last entry has a `headSha`. A budget-exhausted run (no waves merged before the budget hit) or a SKIPPED-only run may produce an empty or absent `waveMerges`. Do **not** attempt to read `waveMerges[last].headSha` in those cases — surface **"merge-sha guard unavailable — result lacks waveMerges[last].headSha"** as `BLOCKED`. This turns a crash (`cbf0d886651f723c`) into a deterministic gate refusal. Do not Approve; ask the operator to inspect the budget/SKIPPED outcome and redirect or re-run with an increased budget.
- The integration branch HEAD MUST **equal** the report's last merge headSha: `git rev-parse <integrationBranch>` must match `waveMerges[<last>].headSha` from the report (read the branch without checking it out — you restored `<baseBranch>` above). A mismatch means the tree on disk is not the one the run produced (checkout drift, #29) — do **not** Approve; surface the mismatch as `BLOCKED` and re-verify before any merge.
- The report's `gitVerified` MUST be **true** — the completeness critic confirmed, via its own `git rev-parse HEAD`, that it reviewed the recorded merge HEAD. A false `gitVerified` (the critic could not confirm it was on the integration tree — possible checkout drift, #29; or the critic died/degraded) means the completeness review is **unverified**: treat it as `BLOCKED` pending a manual integration-tree check; do **not** Approve. This is the report-driven counterpart that hardens the `git rev-parse <integrationBranch>` check above into a gate.
- `missingDeliverables` MUST be **empty** after the completeness critic's tree-diff. The critic reads the plan and, for every failed or blocked task, checks whether its declared `Create:` paths actually exist in the integration tree; if it confirmed any are genuinely absent, treat as `BLOCKED` — a failed/blocked task left its deliverables unproduced (do not let a green suite paper over it).

Only when the checkout is clean, the integration HEAD matches the reported merge headSha, `gitVerified` is true, AND the critic-confirmed `missingDeliverables` is empty do you proceed to the `tests.passed` / acceptance gating below.

**Optionally, audit the run's effort** (recommended after any sizable run): run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/audit_run.py <transcript-dir>` — the transcript directory is printed in the Workflow launch result ("Transcript dir:"). Include its effort table when presenting the report; flagged tier-misrank candidates feed the NEXT plan's tier assignments. The script is advisory by contract (read-only, exits 0 even when the engine's transcript layout has drifted) — never treat its absence of output as a gate failure.

To *read* the transcripts at the gate: if the live viewer from Step 4 is still running, it already shows every agent's transcript — point the human at the open `http://localhost:<port>/swarm.html` (click a station to zoom into its commits and agents; click a commit to read that agent's reasoning + tool I/O). If no viewer is running (headless launch, or it was torn down), offer to open one: *"Want to read any agent's transcript? I'll open the swarm viewer."* On yes, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>` and hand back the URL; add `--embed` for a self-contained offline file. Read-only; see `skills/ultrapowers/viewer/README.md`.

Then render the workflow's structured report per `references/report-format.md`:
integration branch, wave plan, per-task status + review verdict, test result, judgment calls, and
anything unfinished or flagged by the completeness critic. When `coverage.complete` is false, show the ⚠ "green suite but `tasks_merged`/`tasks_planned` tasks merged" beside the test result — a passing suite over an incomplete merge is a false-green (only existing tests can fail). Present the report's `deferredVerification` as a **"Deferred verification — confirm before trusting green"** section, rendered grouped by `reason`: `browser` (live UI) and `manual` (human judgment) entries form the verify-then-approve checklist — each item is verified-by-construction (present and structurally complete) but its behavior is only confirmable outside the sandbox. A non-empty `runtime` (target runtime the sandbox cannot run: process boot, device, deploy target) or `external` (unreachable service/credential/network) group is a **structural false-green** — the sandbox confirmed the deliverable exists but could not execute it against the target; route these into the same explicit operator acknowledgement required for `coverage.complete: false` before Approve. Then render the **post-merge runbook** — the `release`/`manual` tasks excluded at
compile time, verbatim and in document order — so nothing classified out of the run
is forgotten. Then name the integration branch and
present these choices:

- **Approve** — gate on `tests.passed` AND the acceptance disposition. If `tests.passed` is false, do NOT hand off; present the failure and offer Redirect. If `coverage.complete` is false (green suite but `tasks_merged` < `tasks_planned`), do NOT Approve without explicit operator acknowledgement of the false-green — the unmerged tasks' deliverables are itemized in `missingDeliverables` under unfinished. Likewise, if `deferredVerification` contains any `runtime` or `external` entries, do NOT Approve without explicit operator acknowledgement — these are structural false-greens (the sandbox confirmed the deliverable exists but could not execute it against the target runtime or service); treat this acknowledgement exactly as you treat `coverage.complete: false`. For acceptance: `null` (unmarked) and `waived` always pass the acceptance gate (a waiver is recorded verbatim). `suite` passes iff `acceptance.passed` (it mirrors `tests.passed`). For `sealed` the report shows `status: PENDING_GATE` — **administer the exam now, deterministically, in this session** (the workflow could not: it has no shell, and relaying the runner's JSON through a model corrupts it — #36):

  Run `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_acceptance.sh <sealId> <integrationBranch> <sha256>` (the `sealId`/`sha256` are the values the orchestrator carried from compile and echoed in the report's `PENDING_GATE` disposition; the script creates its own detached worktree of the branch, so it is agnostic to the current checkout). **The script's exit code is the authority:** exit 0 ⇒ acceptance passed; any non-zero exit ⇒ do NOT Approve. Render the emitted JSON object verbatim with the report — receipts, not narrative.

  A non-zero exit carries a descriptive `status`: a red exam (`status: OK, passed: false`) offers Redirect/Salvage — its `redKind` says which kind of red: `assertion` (a sealed test executed and failed — the feature is built but wrong) or `collection` (no test executed — an import/collection failure, i.e. the feature or a module it needs is absent); `EXAM_BOOTSTRAP_ERROR` (the seal's `bootstrapCmd` failed on this branch, so the exam environment could not be prepared) is **not** a feature red — do NOT Approve and do NOT record it as a waiver-of-red: fix the environment or re-seal with a corrected `bootstrapCmd`, then re-administer; `SEAL_BROKEN` (vault tampered) or `SEAL_MISSING` (vault gone) offers re-seal via the ultraplan sealing step (the spec still exists) or an explicit waiver; a runner `ERROR` surfaces its reason. An operator override of a red/broken/missing exam is recorded as a waiver-with-reason in the runbook and the final report. Only when `tests.passed` AND the acceptance gate both pass: `git checkout <integrationBranch>` (its Step 1 verifies tests on the CURRENT checkout — it must see the integration tree, not the base branch you restored for the report), then sweep only this run's worktrees and release the lock:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh --run <runId>
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh release <runId>
```

The `--run <runId>` scope removes only this run's worktrees and merged branches, sparing any sibling run's worktrees (unmerged failed-task branches are kept for inspection; never rely on the merge agents having cleaned up; pass `--force` to also remove locked worktrees). Before finishing, apply the two checks in `references/finishing-notes.md`: detect the allowed merge methods (recommend squash when the integration branch has accumulated merge commits that would block rebase) and warn when the integration base is far ahead of the deploy target. Then proceed to `superpowers:finishing-a-development-branch` to merge / open a PR / clean up, the orchestrator carries the post-merge runbook and presents it again when finishing-a-development-branch completes (the upstream skill takes no checklist input).
- **Salvage** — offer this whenever the report carries `failed` tasks or dep-blocked `unfinished` entries; it is Redirect with the corrective instructions derived from the report instead of typed by the human. Build the new `waves` array mechanically: every `failed` task plus every dep-blocked or cascade-blocked task from `unfinished`, preserving their original relative wave order and the Step-2 edges among them. To each failed task's `body`, append a `PRIOR ATTEMPT` note carrying: its kept branch and HEAD sha from `tasks[]`, the blocking issues from its `notes`, and any completeness-critic finding that names the task — plus the instruction that when the prior branch already contains correct work, the implementer should pull that content in (`git diff <sha>` / `git checkout <sha> -- <path>` against the named commit; BASE stays the integration HEAD) instead of reimplementing from scratch. Blocked tasks ride verbatim. Present the constructed salvage waves to the human for approval, then relaunch per the Redirect mechanics below (`resume: true`, same `integrationBranch`) and return to this gate when it completes.
- **Redirect** — provide corrective instructions. Build a new `waves` array containing **only the
  affected tasks** (preserving their relative order and any edges between them, with the
  corrective instructions appended to each task `body`), and relaunch the saved workflow
  (Step 4, by `meta.name` `ultrapowers-run`) with `resume: true` and the **same** `integrationBranch`. The setup agent checks
  out the existing branch instead of creating one; redirected work merges onto it. Never
  improvise an ad-hoc re-run — this is the deterministic redirect path. Return to this gate when
  it completes.
- **Terminal teardown — release the lock on every exit that is not a relaunch.** Approve
  already releases the lock and sweeps inline (above). On **any other terminal exit** —
  the operator declines to Approve, you Abort (a Step-2 dependency cycle is pre-lock, but
  an inability to create the integration branch can abort *after* Step 4b acquired the
  lock), or the operator chooses to abandon a `BLOCKED` condition rather than Redirect —
  **release the run lock** so it does not wedge the next run in this repo. `RUN_LOCK` has
  no timeout; a held lock makes the next `/ultrapowers` `acquire` refuse loudly. `release`
  is id-scoped and no-ops if a concurrent run replaced the lock, so it is always safe:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh release <runId>
```

  Do **not** auto-sweep the worktrees on these paths — on a `BLOCKED`/failed exit the
  engine worktrees and unmerged task branches are the operator's **triage evidence**.
  Instead tell the operator they are kept and how to remove them when done inspecting:
  `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh --run <runId>`.
  (Redirect and Salvage are **not** terminal — they relaunch on the same
  `integrationBranch` and deliberately keep both the lock and the worktrees.)

---

## Step 6 — Fallback Path

The Step-1 preflight routes here *before* any analysis when the Workflow tool is absent.

If the committed workflow **cannot run** — the Workflow feature is unavailable or changed under us,
`args.waves` will not populate (see the args-population note in `references/workflow-template.md`),
or the plan is too unusual to wave — fall back to **`superpowers:subagent-driven-development`** via
the Skill tool and hand it the same plan. This preserves determinism: the proven sequential executor
runs instead, and we simply lose parallelism for that run. **Never improvise an ad-hoc workflow
script** — that would reintroduce the runtime nondeterminism this skill exists to remove.

If the plan carries `release` or `manual` tasks (marked, or classified by the heuristics), do **not** hand those to the sequential executor — subagent-driven-development executes every task continuously, without pausing for human eyes. Hand it the `implementation` and `gate` tasks only, and carry the `release`/`manual` tasks as the post-merge runbook, presented to the human when the sequential run completes — the same contract the parallel path honors.

When falling back, hand subagent-driven-development a clean checkout and let its
own using-git-worktrees setup create isolation — do not hand it a dirty tree or
silently leave it implementing on main; it requires explicit consent for that.

---

## Autonomy Posture

Operate with catastrophe-only escalation from the Step-3 render until the pre-merge gate. Mid-run
questions are not possible — the workflow is headless. Handle ambiguity by making a conservative,
logged judgment call surfaced in the final report under `judgmentCalls`. Blocked tasks are never
silently dropped: they appear in the report as failed tasks, blocked waves, or unfinished entries. The only events that
warrant aborting before the pre-merge review are a dependency cycle (Step 2, requires human plan
revision) or an inability to create the integration branch.

---

## Resources

- `references/dependency-analysis.md` — plan → DAG → waves, cycle detection, small-plan degrade, the transparency block rendered at Step 3.
- `references/plan-markers.md` — the parallel-execution marker contract (`Type:`, `Depends-on:`), the worktree-pure task contract, classification heuristics for unmarked plans, and the compile-time obligations (post-merge runbook, preamble inlining, fence-aware extraction).
- `references/reviewer-prompts.md` — **source of truth** for the implementer/reviewer prompts, the GUARD, and the JSON schemas baked into `harnesses/waves.js`.
- `references/wave-merge.md` — integration branch setup, per-wave merge, reconciliation caps, cascade-blocking, completeness-critic — all baked into `harnesses/waves.js`.
- `references/report-format.md` — structured report schema and the human-facing presentation order.
- `references/workflow-template.md` — maintainer doc for `harnesses/waves.js`: structure, the `args` contract, concurrency math, model-tier mapping, the args-population probe, and the **re-bake procedure**.
- `scripts/validate_skill.py` — run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` from the repo root (CI also runs it for `skills/ultraplan`) to verify frontmatter and reference integrity; expected output: `skill ok`.
- `scripts/compile_plan.py` — deterministic compiler for plans (marked: adopted verbatim; unmarked: heuristic-flagged draft): transparency-block JSON from a plan path.
- `scripts/sweep_worktrees.sh` — deterministic post-run sweep: removes engine worktrees, deletes merged `worktree-wf_*` branches, keeps unmerged ones (`--force` to delete after triage). Run at the Step-5 Approve path.
- `harnesses/probe.js` — the zero-agent engine preflight installed by the SessionStart hook (and Step 4a as a safety net), launched at Step 4a½.
- `harnesses/waves.harness.json`, `harnesses/probe.harness.json` — per-harness manifests (name, file, purpose, fixtures, driftTest) read by both the SessionStart hook and Step 4a to install copies by glob.
- `hooks/session_start.sh` — SessionStart hook: injects the plan-routing rule and installs the saved-workflow copies into `.claude/workflows/` *before* the engine snapshots its registry, so `/ultrapowers` can launch them by `meta.name` the same session.
