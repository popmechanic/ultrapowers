# Spec: derive baseBranch from the launched checkout (#100)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 4).
Surface: `skills/ultrapowers/scripts/ultra_run.py` (base-branch stage) +
`tests/test_ultra_run.py` + one `skills/ultrapowers/SKILL.md` wording touch.
The deterministic driver — not the frozen verification periphery.

## Problem

The driver derives `baseBranch` from the repo default branch and treats the
launched checkout as the fallback:

```python
r = sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd=root)
if r.returncode == 0 and r.stdout.strip():
    base = r.stdout.strip().split("/", 1)[-1]
else:  # no remote HEAD (fresh/local repo): the current branch is the base
    base = sh(["git", "branch", "--show-current"], cwd=root).stdout.strip()
```

That priority is backwards. Observed in 4 runs (one sev 3 @0.1.11): the
operator's session sat on a feature branch 2 commits ahead — including the
commit containing the plan itself and an edit to a file two tasks would
touch — while the driver derived `baseBranch=main`. All 8 structural gate
checks passed and the suite was green, yet the integration line was built on
a stale base: the plan document was not reachable from integration HEAD, and
merge-back to the session branch conflicted (proven read-only via
`git merge-tree --write-tree`; recovered at the cost of a manual conflict
round).

The base the run must build on is the branch the operator launched from —
by construction it contains the plan and the session's context.

## Design

### Derive-don't-assume: invert the priority

The base-branch stage becomes:

1. `git branch --show-current` at preflight. Non-empty → that branch is
   `baseBranch`. Done.
2. Empty output (detached HEAD) → fall back to the repo default
   (`git symbolic-ref --short refs/remotes/origin/HEAD`), and the stage
   detail carries a **loud note**:
   `detached HEAD → fell back to repo default '<name>'`. The receipt is the
   contract, so the note rides in the `base-branch` stage detail; the
   orchestrator already relays stage details.
3. Detached HEAD **and** no remote HEAD → the stage fails
   (`no branch resolvable`), the same fail-closed shape as today.

This deletes the stale-base class rather than guarding it: a run launched
from a feature branch integrates onto that branch, so the plan is always
reachable from integration HEAD and merge-back lands on the branch the
operator is actually on.

### SKILL.md wording

Step 2's knob list currently says only "**`baseBranch`** — derived in
`receipt.baseBranch`; pass through." Extend the sentence so operators are not
surprised on feature-branch launches: derived **from the launched checkout**
(the branch the session is on at preflight; repo default only on detached
HEAD, with a receipt note).

### Compatibility

Self-hosted runs on this repo launch from `main`, where both derivations
agree — behavior is unchanged. The change only matters when a session
launches from a feature branch, which is exactly the failing case. The
fresh/local-repo case (no `origin/HEAD`) also keeps working: the current
branch now wins directly instead of via the fallback arm.

## Testing

Three new cases in `tests/test_ultra_run.py`, alongside the existing
happy-path receipt assertions (which keep passing — `make_repo` launches
from the initial branch with no diverging remote):

1. **Feature-branch launch wins over the repo default.** Give the fixture
   repo a synthetic `refs/remotes/origin/HEAD` pointing at `main`, commit the
   plan on a checked-out feature branch, run the driver → receipt
   `baseBranch` is the feature branch, `base-branch` stage green.
2. **Detached HEAD falls back loudly.** Same synthetic remote HEAD, detach
   the checkout → receipt `baseBranch` is the default branch and the
   `base-branch` stage detail contains the `detached HEAD` note.
3. **Detached HEAD with no remote HEAD fails closed.** Detach in a
   remote-less repo → driver exits non-zero, `base-branch` stage red with
   `no branch resolvable`.

## Rejected alternatives

- **Additive guard** (warn when session HEAD is ahead of the derived base /
  plan unreachable from it): kept only as the issue's fallback if the
  derivation change proves too sharp for some workflow. Making the defect
  inexpressible beats detecting it.
- **Verify plan reachable from base**: YAGNI once the base *is* the launched
  branch — reachability holds by construction.

## Collision note

The queued #97 plan (receipt stage verdicts) reshapes `stage()` into a
dual-detail signature at the same call sites. The docket drain serializes
plans on the integration branch, so whichever lands second rebases its
`stage("base-branch", …)` call onto the other's shape; the semantics here
(success detail = the resolved base, optionally with the fallback note;
failure detail = `no branch resolvable`) map cleanly onto #97's
success/failure split.
