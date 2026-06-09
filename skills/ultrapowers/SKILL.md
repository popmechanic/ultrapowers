---
name: ultrapowers
description: This skill should be used when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", "run the plan as a workflow", or wants to autonomously implement an approved Superpowers plan in parallel. The drop-in alternative to superpowers:subagent-driven-development.
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

- **Parse** each task's `writes` set (`Create:` ∪ `Modify:`) and any explicit `depends on` text.
- **Build the DAG** with the three edge rules; **run cycle detection** before computing waves.
  If a cycle is found, stop and surface it in plain language — never guess an ordering.
- **Apply conservative defaults** and the **small-plan degrade** (≤2 tasks or fully overlapping
  writes → a single sequential wave).
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
- **Record** the DAG edges, wave list, mode, any degrade reason, and the derived knobs (the transparency block).

---

## Step 3 — Present the Wave Plan and Get Approval (human gate)

Render the transparency block from Step 2 for the human:

1. **Waves** — one line per wave: which task IDs run in parallel, in wave order.
2. **Dependency edges** — the edges that shaped the ordering.
3. **Mode** — `parallel` or `sequential` (with the degrade reason if sequential).
4. **Derived knobs** — the test command you'll use, which tasks get `adversarial` vs `lean` review,
   and any tier overrides. Show them so the human can veto a wrong guess — they approve these, they
   do not author them.

Then ask the human to **approve the wave plan or revise the plan and re-run**. Do **not** launch
the workflow without approval. This is the only mid-process gate between plan approval and the
pre-merge review, and it is where a bad parallelization guess gets caught before any tokens are spent.

---

## Step 4 — Launch the Committed Workflow

Invoke the **Workflow** tool on `skills/ultrapowers/workflow.js` (the committed script — do **not**
author or edit it) with:

```
args = { waves, integrationBranch: 'ultra/integration-<stamp>', stamp, dependencyEdges,
         baseBranch, planPath, testCmd?, reviewProfile?, tierOverrides? }
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
- `tierOverrides` — e.g. `{ cheap: 'sonnet' }` to remap *implementer* tiers (reviewers stay at the
  strongest model regardless).

The workflow validates `args.waves` and **throws loudly** if it is missing or malformed rather than
risk mutating the wrong repository. Do not pause mid-run —
workflows are headless and cannot receive input after launch. The workflow creates the integration
branch, runs each wave (`parallel()` barrier, chunked to the 16-agent engine cap), merges each wave,
reconciles failures, and runs a final integration/completeness review. See
`references/wave-merge.md` for the mechanics that are baked into the script.

---

## Step 5 — Present the Pre-Merge Report (human gate)

When the workflow returns, render its structured report per `references/report-format.md`:
integration branch, wave plan, per-task status + review verdict, test result, judgment calls, and
anything unfinished or flagged by the completeness critic. Then name the integration branch and
present two choices:

- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge / open a PR / clean up.
- **Redirect** — provide corrective instructions; re-run the affected tasks before returning here.

---

## Step 6 — Fallback Path

If the committed workflow **cannot run** — the Workflow feature is unavailable or changed under us,
`args.waves` will not populate (see the args-population note in `references/workflow-template.md`),
or the plan is too unusual to wave — fall back to **`superpowers:subagent-driven-development`** via
the Skill tool and hand it the same plan. This preserves determinism: the proven sequential executor
runs instead, and we simply lose parallelism for that run. **Never improvise an ad-hoc workflow
script** — that would reintroduce the runtime nondeterminism this skill exists to remove.

---

## Autonomy Posture

Operate with catastrophe-only escalation between the wave-plan gate and the pre-merge gate. Mid-run
questions are not possible — the workflow is headless. Handle ambiguity by making a conservative,
logged judgment call surfaced in the final report under `judgmentCalls`. Blocked tasks are never
silently dropped: they appear under blocked waves / unfinished in the report. The only events that
warrant aborting before the pre-merge review are a dependency cycle (Step 2, requires human plan
revision) or an inability to create the integration branch.

---

## Resources

- `references/dependency-analysis.md` — plan → DAG → waves, cycle detection, small-plan degrade, the transparency block rendered at the Step 3 gate.
- `references/reviewer-prompts.md` — **source of truth** for the implementer/reviewer prompts, the GUARD, and the JSON schemas baked into `workflow.js`.
- `references/wave-merge.md` — integration branch setup, per-wave merge, reconciliation caps, cascade-blocking, completeness-critic — all baked into `workflow.js`.
- `references/report-format.md` — structured report schema and the human-facing presentation order.
- `references/workflow-template.md` — maintainer doc for `workflow.js`: structure, the `args` contract, concurrency math, model-tier mapping, the args-population probe, and the **re-bake procedure**.
- `scripts/validate_skill.py` — run `python3 scripts/validate_skill.py skills/ultrapowers` to verify frontmatter and reference integrity; expected output: `skill ok`.
