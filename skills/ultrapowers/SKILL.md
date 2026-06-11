---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", "run the plan as a workflow", or wants to autonomously implement an approved Superpowers plan in parallel waves across git worktrees.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---

# Ultrapowers

Autonomously implement an approved Superpowers plan via a **committed, parallel,
worktree-isolated Dynamic Workflow**. This skill does not author a workflow at runtime: it
validates the plan, computes the parallel wave plan, gets human approval of that wave plan,
then launches the frozen `workflow.js` that ships with the skill. Each task runs in its own
git worktree and passes an independent review (spec-compliance + code-quality in one pass by default;
two passes under the `adversarial` profile) before its branch merges into a single integration branch. A human-readable report and a merge gate conclude the run.

The discipline (implementer/reviewer/completeness prompts and schemas) is **baked into
`workflow.js` at build time**, not loaded from Superpowers at runtime — so execution does not
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
Step 6 and run the fallback — do **not** perform dependency analysis or ask the human to approve
a wave plan that cannot launch.

**Tested with superpowers 5.1.0.** Check the installed version (the directory name
under `~/.claude/plugins/cache/claude-plugins-official/superpowers/`). A newer
version is not a blocker — warn and continue: "ultrapowers was validated against
superpowers 5.1.0; you have <X>. If plan parsing or a handoff misbehaves, suspect
upstream drift first (run `python3 -m pytest tests/test_superpowers_compat.py` in
the ultrapowers repo to localize it)."

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
structure. Each task object must be **self-contained**: `{ id, title, body, tier, acceptance, files, review? }`,
where `body` is the full verbatim task text (the workflow cannot resolve file references) and `review`
(`'adversarial'` | `'lean'`, optional) is the per-task depth you derive below.

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
- **Build the DAG** with the edge rules in `references/dependency-analysis.md` (marker, write-after-create, write-after-write, text, read-after-write); **run cycle detection** before computing waves.
  If a cycle is found, stop and surface it in plain language — never guess an ordering.
- **Apply conservative defaults** and the **small-plan degrade** (exactly 1 implementation task, or fully overlapping writes → sequential mode: one single-task wave per task, in dependency order). Two or more tasks with disjoint writes stay parallel; dependency edges still serialize them by topology within parallel mode.
- **Assign a model tier** per task (`cheap` / `standard` / `most-capable`) by estimated scope, per
  `references/reviewer-prompts.md`.
- **Derive the run knobs yourself — do not ask the human to hand-tune them.** You read the plan and
  run inside the repo, so you are the right party to set these; the human only approves them at the
  Step-3 gate.
  - **`testCmd`** — detect how *this* repo runs tests (inspect `package.json` scripts / `Makefile` /
    monorepo layout, or lift it from the plan's **Tech Stack** line). Set it only when the workflow's
    built-in detection ladder would guess wrong (monorepos, custom runners); otherwise omit.
  - **`baseBranch`** — the repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`,
    falling back to the current branch). Always set it; it anchors the integration branch and the
    review diff base.
  - **Per-task review depth (`task.review`)** — mark each task `adversarial` (two independent review
    passes) or `lean` (one) from its risk and tier: high-stakes or `most-capable` tasks warrant
    `adversarial`; routine `cheap` tasks stay `lean`. This is derived from the plan, not asked.
  - **`tierOverrides`** — leave empty unless the human stated a budget *posture* in plain language
    ("keep this cheap", "be thorough"); translate that, never invent it. Per-task tiers already come
    from the plan.
- **Record** the DAG edges, wave list, mode, any degrade reason, the dispositions
  (gates compiled into config, runbook entries, marker conflicts, inlined preamble
  notes), and the derived knobs (the transparency block).

---

## Step 3 — Present the Wave Plan and Get Approval (human gate)

Render the transparency block from Step 2 for the human:

1. **Waves** — one line per wave: which task IDs run in parallel, in wave order.
2. **Dependency edges** — the edges that shaped the ordering.
3. **Mode** — `parallel` or `sequential` (with the degrade reason if sequential).
4. **Derived knobs** — the test command you'll use, which tasks get `adversarial` vs `lean` review,
   and any tier overrides. Show them so the human can veto a wrong guess — they approve these, they
   do not author them.
5. **Dispositions** — which tasks were excluded as `release`/`manual` (the post-merge
   runbook), which gates were compiled into run config, any superseded ordering prose
   or marker conflicts. The human approves this **interpretation** of the plan, not
   just the grouping — a wrong classification gets caught here, before any tokens are
   spent.

Then ask the human to **approve the wave plan or revise the plan and re-run**. Do **not** launch
the workflow without approval. This is the only mid-process gate between plan approval and the
pre-merge review, and it is where a bad parallelization guess gets caught before any tokens are spent.

---

## Step 4 — Launch the Committed Workflow

**4a — Install the committed script as a project saved workflow (idempotent).** Saved workflows
(`.claude/workflows/*.js`) are the documented deterministic launch surface: they run **by name**
with `args`, instead of relying on ad-hoc script delivery. Plugins cannot ship saved workflows, so
install the copy now:

```
mkdir -p .claude/workflows
cp "${CLAUDE_SKILL_DIR}/workflow.js" .claude/workflows/ultrapowers-run.js
cp "${CLAUDE_SKILL_DIR}/probe.js" .claude/workflows/ultrapowers-probe.js
```

Run the copy unconditionally — it is byte-for-byte the committed script, so overwriting keeps any
stale copy in sync with the installed plugin version. Never edit the copy. (The user may commit it
or gitignore it; Step 4a keeps it current either way.)

> **Determinism guard:** never trigger the run with the `ultracode` keyword or by asking for "a
> workflow" in prose — that opt-in makes Claude **author a new script at runtime**, which is
> exactly the nondeterminism this skill exists to remove. The only sanctioned launch is the saved
> workflow installed above; if it cannot be launched, go to Step 6.

**4a½ — Engine preflight.** Launch the saved workflow `ultrapowers-probe` with
`args = { ping: 'pong' }`. It spawns no agents and returns `{ ok: true, ... }` in
seconds. If the launch errors or `ok` is not true, the engine has drifted — go
directly to Step 6; do not launch the real workflow.

**4b — Launch the saved workflow by name `ultrapowers`** (the committed script — do **not** author
or edit it) via the **Workflow** tool. The registry resolves saved workflows by the script's
`meta.name` (`ultrapowers`), **not** the installed filename (`ultrapowers-run.js`) — launching as
`ultrapowers-run` fails with "not found". Pass:

```
args = { waves, integrationBranch: 'ultra/integration-<stamp>', stamp, dependencyEdges,
         edges, baseBranch, planPath, testCmd?, reviewProfile?, tierOverrides? }
```

Pass the approved `waves`, a timestamp `stamp` (the script cannot call `Date.now()`), and the
recorded `dependencyEdges`, plus the knobs you **derived in Step 2** (all optional; omitting them
preserves standard behavior):

- `testCmd` — the exact test command for *this* repo (monorepos / non-standard runners), so the
  merge and completeness agents don't have to guess.
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

The workflow validates `args.waves` and **throws loudly** if it is missing or malformed rather than
risk mutating the wrong repository. Do not pause mid-run —
workflows are headless and cannot receive input after launch. The workflow creates the integration
branch, runs each wave (`parallel()` barrier, chunked to the 16-agent engine cap), merges each wave,
reconciles failures, and runs a final integration/completeness review. See
`references/wave-merge.md` for the mechanics that are baked into the script.

---

## Step 5 — Present the Pre-Merge Report (human gate)

**First, restore the session checkout.** The workflow's setup agent checks the integration branch
out in the session repository and nothing switches it back — run `git checkout <baseBranch>` now.
Skipping this makes every `git log`/`git merge` at this gate silently target the integration
branch, so the work *looks* prematurely merged when it is not.

Then render the workflow's structured report per `references/report-format.md`:
integration branch, wave plan, per-task status + review verdict, test result, judgment calls, and
anything unfinished or flagged by the completeness critic. Then render the **post-merge runbook** — the `release`/`manual` tasks excluded at
compile time, verbatim and in document order — so nothing classified out of the run
is forgotten. Then name the integration branch and
present two choices:

- **Approve** — first gate on the report's `tests.passed`: if false, do NOT hand
  off; present the failure and offer Redirect instead (finishing-a-development-branch's
  own precondition is a passing suite). If true: `git checkout <integrationBranch>`
  (its Step 1 verifies tests on the CURRENT checkout — it must see the integration
  tree, not the base branch you restored for the report), then run
  `bash ${CLAUDE_SKILL_DIR}/scripts/sweep_worktrees.sh` — the deterministic sweep
  of engine worktrees and merged branches (unmerged failed-task branches are kept
  for inspection; never rely on the merge agents having cleaned up; do not sweep
  while another ultrapowers run is active in this repo). Then proceed
  to `superpowers:finishing-a-development-branch` to merge / open a PR / clean up,
  the orchestrator carries the post-merge runbook and presents it again when finishing-a-development-branch completes (the upstream skill takes no checklist input).
- **Redirect** — provide corrective instructions. Build a new `waves` array containing **only the
  affected tasks** (preserving their relative order and any edges between them, with the
  corrective instructions appended to each task `body`), and relaunch the saved workflow
  (Step 4, by `meta.name` `ultrapowers`) with `resume: true` and the **same** `integrationBranch`. The setup agent checks
  out the existing branch instead of creating one; redirected work merges onto it. Never
  improvise an ad-hoc re-run — this is the deterministic redirect path. Return to this gate when
  it completes.

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

Operate with catastrophe-only escalation between the wave-plan gate and the pre-merge gate. Mid-run
questions are not possible — the workflow is headless. Handle ambiguity by making a conservative,
logged judgment call surfaced in the final report under `judgmentCalls`. Blocked tasks are never
silently dropped: they appear in the report as failed tasks, blocked waves, or unfinished entries. The only events that
warrant aborting before the pre-merge review are a dependency cycle (Step 2, requires human plan
revision) or an inability to create the integration branch.

---

## Resources

- `references/dependency-analysis.md` — plan → DAG → waves, cycle detection, small-plan degrade, the transparency block rendered at the Step 3 gate.
- `references/plan-markers.md` — the parallel-execution marker contract (`Type:`, `Depends-on:`), the worktree-pure task contract, classification heuristics for unmarked plans, and the compile-time obligations (post-merge runbook, preamble inlining, fence-aware extraction).
- `references/reviewer-prompts.md` — **source of truth** for the implementer/reviewer prompts, the GUARD, and the JSON schemas baked into `workflow.js`.
- `references/wave-merge.md` — integration branch setup, per-wave merge, reconciliation caps, cascade-blocking, completeness-critic — all baked into `workflow.js`.
- `references/report-format.md` — structured report schema and the human-facing presentation order.
- `references/workflow-template.md` — maintainer doc for `workflow.js`: structure, the `args` contract, concurrency math, model-tier mapping, the args-population probe, and the **re-bake procedure**.
- `scripts/validate_skill.py` — run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` from the repo root (CI also runs it for `skills/ultraplan`) to verify frontmatter and reference integrity; expected output: `skill ok`.
- `scripts/compile_plan.py` — deterministic compiler for plans (marked: adopted verbatim; unmarked: heuristic-flagged draft): transparency-block JSON from a plan path.
- `scripts/sweep_worktrees.sh` — deterministic post-run sweep: removes engine worktrees, deletes merged `worktree-wf_*` branches, keeps unmerged ones (`--force` to delete after triage). Run at the Step-5 Approve path.
- `probe.js` — the zero-agent engine preflight installed at Step 4a, launched at Step 4a½.
