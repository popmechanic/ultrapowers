# Worktree creation fails closed on an existing path (#120, narrowed) — design

**Date:** 2026-08-10
**Status:** trim-reviewed, awaiting operator review
**Acceptance:** suite
**Origin:** docket sweep (issue #120, accepted score 7 — the cycle's ONE
budgeted additive guard). Field evidence: 2026-08-07 foreign run adopted a stale
worktree carrying unmerged prior-run commits, polluting the integration branch
and masking a dropped task; second occurrence class (wrong-worktree dispatch
blocked a foreign run) recorded at distill 2026-08-09.

## Background

The dedicated integration worktree is created by the **setup agent** (the
workflow controller has no filesystem access). The non-resume baked prompt says:

> From the session repo root run: `git worktree add {{INTEGRATION_WT}} -b
> {{INTEGRATION_BRANCH}}{{BASE_BRANCH_ARG}}`.

`git worktree add` itself refuses a non-empty existing path — but nothing tells
the agent that refusal is **terminal**. An agent that hits it improvises:
adopting the leftover directory, clearing it, or checking the branch out inside
it. The 2026-08-07 incident is exactly that improvisation: a stale worktree
(same stamp, prior launch) was adopted silently, carrying unmerged commits into
the integration line. The worktree is named by **stamp**
(`wf_<stamp>-integration`), so a same-stamp relaunch is a standing collision
vector.

Adjacent machinery *surfaces* leftovers (preflight `worktree-audit`,
`sweep_worktrees.sh --audit`) or *removes* them (approve-time sweep) — none of
it *refuses reuse* at the moment of creation.

## Operator-narrowed scope (binding)

ONLY the single fail-closed check at worktree creation for **non-resume**
launches. Explicitly out of scope (operator decision at distill 2026-08-09):
HEAD-equals-base assertion after creation (the ancestry check owns that
symptom, proven in field), audit surfaces, new error taxonomy.

## Design

One prompt clause, added to the non-resume setup prompt at its **source**
(`references/wave-merge.md`, `BAKE:SETUP_PROMPT_CREATE`) and re-baked into
`waves.js` per `references/workflow-template.md`:

> Before that, if {{INTEGRATION_WT}} already exists — as a directory of any
> kind, even empty — refuse: create nothing, never adopt, clear, or reuse an
> existing directory, and never work around a `git worktree add` refusal. To
> refuse, report `headSha` as the empty string and put
> `BLOCKED: <path> exists — remove it with sweep_worktrees.sh --run wf_<stamp>`
> in `branch`; never report a real branch name or sha for a worktree you did
> not create.

**Why the refusal shape is pinned** (trim review finding 2): the setup report
schema (`SETUP_SCHEMA`) has `required: ['branch','headSha']` and no status
field, and the controller's abort fires only on
`!setup || setup.branch !== integrationBranch || !setup.headSha`
(waves.js Setup phase). An agent that "reports BLOCKED" in prose while the
schema-forced fields carry the correct branch name plus the **stale worktree's
HEAD** would sail through — the 2026-08-07 incident laundered through the
schema. Pinning the refusal to an empty `headSha` (and a non-matching `branch`)
makes the refusal trip the **existing** abort checks mechanically; no schema
change, no status field, no controller logic change.

The **resume** prompt is untouched: reusing the existing worktree is its
designed behavior, and it already fails closed on dirt (`git status
--porcelain` gate, "never absorb pre-existing dirt").

Task worktrees (`worktree-wf_<runId>-<n>`) are created by the Workflow
runtime's `isolation: 'worktree'`, not by any prompt or script this repo owns —
out of reach and out of scope (runtime IDs are fresh per launch, so the
collision vector is the stamp-named integration worktree this spec covers).

## Obligations that arm

- Harness JS changes (the baked copy) ⇒ `.mjs` sim coverage with the
  `ALL SCENARIOS PASSED` sentinel, shaped per trim review finding 3 (the
  abort-on-generic-failure scenario already exists as F1, so no duplicate):
  1. one **new** scenario whose mock setup agent returns the pinned
     schema-compliant refusal shape (`branch` carrying the BLOCKED string,
     `headSha: ""`) and asserts the run aborts before any task dispatch — the
     behavioral proof that the pinned shape trips the existing checks;
  2. one added **assert** in the existing prompt-assertion scenario: the
     dispatched (interpolated) setup prompt contains the fail-closed clause.
- Anti-drift: edit the source `.md`, re-bake, `tests/test_no_prompt_drift.py`
  stays green (it pins the baked span against the source block).

## Tests

1. The `.mjs` sim scenario + assert above (exit code + sentinel; the suite-gate
   runs the sims whenever `harnesses/*.js` changes on a branch).
2. Drift pin: existing `test_no_prompt_drift.py` re-matches the edited
   `SETUP_PROMPT_CREATE` block — no new pin machinery.

## Acceptance

`suite` — committed pytest suite plus the armed `.mjs` sim; the sim carries the
behavioral proof the Python suite cannot express (issue #79 rule).

## Complexity accounting

`complexityEffect: additive-guard` — this consumes the cycle's one-additive-guard
budget (decided at triage against #129, which stays `triaged` with a
promote-on-recurrence trigger). The guard is one prompt clause riding an
existing abort path: no new script, no new knob, no new error taxonomy.

## Trim review

**Author disclosure (Adds/Removes):** Adds — one refusal clause in
`BAKE:SETUP_PROMPT_CREATE` (source + re-bake), one sim scenario + one sim
assert. Removes — the agent's freedom to improvise past a `git worktree add`
refusal (the incident's mechanism).

**Reviewer verdicts** (fresh-context dispatch; grounded in waves.js
SETUP_PROMPT/SETUP_SCHEMA/abort path, wave-merge.md BAKE blocks,
test_no_prompt_drift.py, sim_workflow.mjs):

1. Core design (one clause, existing abort, resume untouched, task worktrees
   excluded) — OK, "close to the true minimum".
2. "Controller already treats BLOCKED as terminal" — **UNDERSPECIFIED**, the
   load-bearing claim: `SETUP_SCHEMA` has no status field; a schema-forced
   cheap-tier agent could prose-BLOCK while emitting the correct branch + the
   stale worktree's HEAD, and the run would proceed. → **Adopted**: the refusal
   shape is pinned (empty `headSha`, BLOCKED string in `branch`) so the
   existing `!setup.headSha` / wrong-branch checks fire mechanically; the sim
   mocks exactly that worst-case schema-compliant shape.
3. Abort half of the proposed sim duplicates existing scenario F1 — **TRIM**,
   conditional on 2. → **Adopted as reshaped**: the new scenario asserts abort
   on the *pinned refusal shape* (no longer a duplicate — it is the behavioral
   proof finding 2 demands); the prompt-text check becomes one assert in the
   existing prompt-assertion scenario.
4. "Directory of any kind, even empty" — OK (uniform refusal, zero concepts).
5. Scope vs issue + operator narrowing — OK, no expansions, budget honestly
   declared.
6. Sim prompt-assert vs drift pin — OK, not redundant (interpolated dispatch
   text vs static file text).

**Reviewer grade:** `netConceptDelta: flat` — conditional on resolving finding
2 within existing concepts (the empty-`headSha` route), not via a new status
field. The adopted resolution takes exactly that route.
