# Plan Markers — the Parallel-Execution Contract

Additive per-task annotations on a `superpowers:writing-plans` document that make
wave compilation deterministic. Sequential executors (subagent-driven-development,
executing-plans) ignore them; ultrapowers trusts them. A plan without markers still
runs — `dependency-analysis.md` falls back to the classification heuristics below.

## The worktree-pure task contract

An ultrapowers task is **a pure diff against the integration branch**. Concretely it:

- pushes nothing to any remote and never checks out or merges a long-lived branch;
- needs no human interaction between launch and final commit;
- mutates nothing outside its own worktree — no deploys, no ssh, no launchd/systemd
  installs, no writes to shared services;
- is verified by tests that can run concurrently with other tasks' tests (unique
  ports, temp paths, no shared on-disk fixtures).

A task that satisfies the contract is waved. A task that violates it is classified
out of the DAG (see Type semantics). Classification is evidence checked against this
invariant, not pattern-matching a list of known-bad idioms — new idioms classify
correctly as long as the contract is what gets tested.

## Marker syntax

<!-- BAKE:MARKER_SYNTAX -->
Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.
<!-- /BAKE -->

Example (format as a fenced ```markdown block in the doc):

### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Modify: `app/server/server.ts`

`Depends-on` is **additive**: file-overlap edges are still inferred, and the union of
marker edges and inferred edges orders the waves. `**Depends-on:** none` asserts the
author expects no incoming edges; if inference still finds one, the file edge wins
and the disagreement is surfaced in the transparency block under `marker_conflicts` —
never silently dropped.

## Type semantics (dispositions)

<!-- BAKE:TYPE_SEMANTICS -->
- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed at the wave-plan approval gate. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.
<!-- /BAKE -->

## Classification heuristics (unmarked plans)

For tasks without a `**Type:**` marker, classify by evidence, in this precedence:

1. **release** — any step contains `git push`, checks out or merges a long-lived
   branch (`git checkout main`), deploys (`ssh`, `scp`, `systemctl`, provider CLIs),
   or the body says to run "after the branch merges".
2. **manual** — steps are addressed to the owner / a human ("the owner runs…",
   "cannot be done from this machine") or need credentials/hardware the repo does
   not contain.
3. **gate** — the `**Files:**` block is `none`, empty, or missing AND every step
   only runs tests, linters, `git status`, or `git log`.
4. otherwise **implementation**.

Precedence matters: a task that pushes AND verifies is `release`, not `gate`. The
empty-Files conservative default in `dependency-analysis.md` applies only to tasks
that classify as `implementation`.

## Compile-time obligations

Whatever the classification source (marker or heuristic), the compiler MUST:

- record every non-`implementation` disposition in the Step-3 transparency block —
  the human approves the **interpretation** of the plan, not just the wave grouping;
- collect `release` and `manual` tasks, verbatim and in document order, into the
  **post-merge runbook**, rendered with the final report and handed to
  `superpowers:finishing-a-development-branch` on approval;
- inline preamble coordination notes into the bodies of the tasks they affect —
  task agents see only their own `body`;
- convert global ordering prose ("execute phases in order") into edges only where it
  names concrete task pairs; blanket ordering is superseded by the computed DAG and
  the supersession is recorded as a judgment line;
- extract task bodies **fence-aware** — a heading inside a ``` code fence is content,
  not a section boundary (plans embed whole markdown documents in their steps).

## Authoring rules that complement the markers

For the plan author (loaded at writing time by the `ultraplan` skill):

- Make every task body self-contained; coordination knowledge lives in the affected
  task's body, never only in a preamble.
- Encode ordering as `**Depends-on:**` on the downstream task; never write global
  ordering prose.
- Never instruct branch creation — the executor owns branching.
- Give every test a unique port / temp path so same-wave suites can run concurrently.
- Mark gates, releases, and manual steps explicitly so nothing rides on heuristics.

(End of plan-markers.md.)
