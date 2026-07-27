# Spec: the run never mutates the operator's checkout — integration in a dedicated worktree (#84)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 9).
Scope decision (operator, this sweep): **engine-side only** — the frozen gate
scripts stay byte-identical; their snapshot/restore rituals become inert, and
their eventual deletion is a separate, eval-gated subtraction on field
evidence.
Surfaces: `skills/ultrapowers/harnesses/waves.js` +
`skills/ultrapowers/references/wave-merge.md` (baked prompt source, canary
pin) + `tests/sim_workflow.mjs` + `skills/ultrapowers/SKILL.md`.
**Byte-identical (FROZEN):** `gate_check.py`, `ultra_gate.py`, `run_lock.sh`,
`run_acceptance.sh`.

## Problem

A family of recurring friction exists only because the engine integrates
waves in the operator's working copy (2026-07-03 distill):

- the snapshot/restore ritual and its failure modes (checkout left detached
  or on the integration branch — the historical #29/#32 class),
- `gate_check`'s clean-tree interaction with pre-existing operator dirt
  (4 runs; one run's failure text falsely accused an agent of a worktree
  violation),
- home-repo collisions with deliberately-uncommitted files (the ultralearn
  ledger).

Today's choreography (all engine-side, in `wave-merge.md`-baked prompts):
the setup agent runs `git checkout -b <integrationBranch>` **on the session
main checkout**; merge and reconcile agents operate there; the completeness
critic runs `git checkout --detach <merge HEAD>` there. #90 (scratch) and
#100 (baseBranch) removed the other members of the session-checkout-coupling
class; this removes the last and largest.

## Design

### The integration worktree

The setup agent cuts a dedicated worktree instead of branching the main
checkout:

- Fresh run: `git worktree add <repo>/.claude/worktrees/wf_<stamp>-integration -b <integrationBranch> <baseBranch>`.
- Resume (Salvage/Redirect): the existing branch, never recreated — if the
  worktree path already exists (a relaunch under the same stamp), check the
  branch out inside it; otherwise
  `git worktree add <repo>/.claude/worktrees/wf_<stamp>-integration <integrationBranch>`.
- The name is **stamp**-based (`wf_<stamp>-integration`): the workflow
  script knows `args.stamp` but not the runtime-assigned `wf_<runId>` used
  for task worktrees. It still matches `sweep_worktrees.sh`'s repo-wide
  `wf_*` glob, which is the sweep the Approve path runs; `--run <runId>`
  scoping does not cover it, an accepted asymmetry.
- When `bootstrapCmd` is provided, setup runs it **once** in the integration
  worktree: merge agents execute the test suite there, and a fresh worktree
  has no installed dependencies (today they borrow the main checkout's).

### Role routing

- **Merge and reconcile agents** operate inside the integration worktree
  (its path threaded into their prompts), never on the session checkout.
- **Completeness critic** performs its detached-HEAD inspection
  (`git checkout --detach <merge HEAD>`, sha-verified) **inside the
  integration worktree** — today this detaches the operator's checkout, an
  engine-caused mutation of the same class.
- **Reviewers are untouched**: they remain non-isolated readers (pre-baked
  packets, object-store diff fallback, "never check out a branch") — the A2
  speed win is preserved by construction. This answers the issue's first
  feasibility check.
- **Implementer task worktrees**: unchanged.

### The run-end detach (the frozen-Approve interaction)

`ultra_gate.py --approve` (frozen) runs `git checkout <integrationBranch>`
on the session checkout — which git refuses while another worktree holds
that branch. The release comes for free: the completeness critic already
performs a sha-verified `git checkout --detach <merge HEAD>` — relocated
into the integration worktree, that detach **is** the branch release, and it
happens on every approvable path (a critic that never reached its detach
reports BLOCKED, and a BLOCKED gate is never Approved, so the conflict
cannot arise). The worktree directory itself is swept at Approve by the
existing `sweep_worktrees.sh` pass. This keeps Approve as **the single
sanctioned mutation** of the session checkout — the issue's second
feasibility check, answered without touching the frozen script.

### What the frozen periphery does now

- `run_lock.sh snapshot` still records the pre-run branch/sha/dirty set;
  since the engine no longer moves the checkout, `restore` lands on the
  branch it is already on — inert, harmless.
- `gate_check.py` still runs with `--repo` at the session repo; its checks
  are ref-based, and the clean-tree check compares against the snapshot's
  dirty set — since the engine writes nothing to the session tree, only
  operator-caused dirt can appear, and pre-existing dirt already passes
  with a note (0.1.x behavior).
- `run_acceptance.sh` already cuts its own detached worktree — unaffected.
- **None of these files change by even one byte.** Deleting the now-inert
  snapshot/restore choreography is explicitly out of scope: it is frozen,
  and the subtraction is earned later by eval-measured field evidence.

### SKILL.md wording

Step 4/5 prose updates only where it *describes the engine*: the workflow
creates the integration branch **in a dedicated worktree** and the session
checkout is never touched by any engine agent; the Step-5 gate ritual
(restore, gate_check, acceptance, Approve) is unchanged. The Step-5
sentence explaining why restore matters gains the note that with a
dedicated integration worktree the restore is normally a no-op.

## Testing

Sims (in `tests/sim_workflow.mjs`, sentinel discipline; the suite gate runs
them since `harnesses/*.js` changes):

1. **Worktree routing:** the setup prompt instructs `git worktree add` with
   the `wf_<runId>-integration` path and never `git checkout -b` on the
   main checkout; merge/reconcile/critic prompts name the integration
   worktree path; no non-reviewer prompt instructs operating "on the
   session repo main checkout".
2. **Run-end detach:** the engine's final choreography (report path)
   includes the integration-worktree detach instruction, so the branch is
   free at gate time.
3. **Bootstrap-once:** with `bootstrapCmd` set, the setup prompt carries it
   for the integration worktree; merge agents do not re-run it (existing
   scenario extended).
4. **Reviewer invariance:** the reviewer prompt is byte-unchanged on the
   main-checkout/read-only discipline (existing assertions keep passing).

Pins: `test_canary.py` (wave-merge.md ↔ waves.js ladder) and
`test_no_prompt_drift.py` stay green — prompt edits happen at source and are
re-baked. Suite gate: `python3 -m pytest` green; frozen files verified
untouched by `git diff --stat` at review.

## Rejected alternatives

- **Full structural subtraction now** (delete snapshot/restore from
  `run_lock.sh`/`ultra_gate.py` via the eval route): rejected this cycle by
  operator scope decision — option A delivers the entire behavioral value
  while the frozen scripts' rituals degrade to no-ops; the deletion can be
  licensed later by field evidence at near-zero marginal risk.
- **Hardening snapshot/restore further**: guards each instance of the
  shared-mutable-state condition instead of removing it; the distill's
  complexity framing (structural, netConceptDelta down) argues for removal.
- **Isolating reviewers into the integration worktree**: regresses A2
  (0.0.24) for no correctness gain — reviewers read packets and the object
  store, which need no checkout at all.

## Collision note

`waves.js`, `sim_workflow.mjs`, and `SKILL.md` are touched by earlier-queued
plans (#96, #97, #99, #100, #95, #91, #101). This plan ranks last on the
docket and lands last in the drain's serialized order; its edits rebase onto
whatever landed before it — in particular the #101 tierOverrides deletion in
the same `waves.js` regions.
