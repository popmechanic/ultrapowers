# Spec: --validate-knobs probes bootstrapCmd in a throwaway worktree (#99)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 5).
Surface: `skills/ultrapowers/scripts/ultra_run.py` (`validate_knobs`) +
`tests/test_ultra_run.py` + one `skills/ultrapowers/SKILL.md` sentence.
The deterministic driver — not the frozen verification periphery.

## Problem

`--validate-knobs`' bootstrapCmd check verifies "no-ops cleanly on the session
checkout" by **executing the candidate command against the live session
environment**:

```python
before = sh(["git", "status", "--porcelain"], cwd=root).stdout
proc = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True)
after = sh(["git", "status", "--porcelain"], cwd=root).stdout
```

Observed (1 run @0.1.1, sev 2): an orchestrator's first bootstrapCmd draft
omitted the dev-dependency extra; the probe ran it live and stripped the test
runner from the operator's venv. The agent noticed and restored the
environment unprompted — the design should not rely on that. "Verify this
command is a no-op" performed by running it is destructive precisely when
validation is most needed: a wrong draft is the case the check exists for.

This is the second member of the engine-mutates-operator-environment family
(with the 0.0.35 snapshot-restore data destruction), so the
machinery-earned-by-recurrence bar is met at family level.

## Design

### Relocate the probe into a disposable worktree

The bootstrapCmd branch of `validate_knobs(args_path, root)` becomes:

1. **Cut a throwaway worktree** at `.claude/ultrapowers/wt-knob-<pid>` via
   `git worktree add --detach <path> HEAD` — the same pattern the preflight
   capability probe already uses (`wt-probe-<stamp>`), which also means the
   driver has already proven the repo can cut worktrees by the time knobs are
   validated. Creation failure → fail-closed:
   `{"ok": false, "stage": "knob-validate", "detail": "cannot cut probe worktree: …"}`,
   exit 1.
2. **Run the candidate command inside the worktree** (`cwd=<probe worktree>`,
   still `shell=True`, same output capture).
3. **Judge no-op-ness by the worktree's resulting tree state**: verdict green
   iff the command exits 0 **and** `git status --porcelain` in the probe
   worktree is empty. A fresh detached worktree starts clean, so any dirt is
   the command's own mutation — no before/after diff needed. The result JSON
   keeps exactly its existing keys (`ok`, `stage`, `exit`, `treeClean`,
   `output`); `treeClean` now means "probe worktree still clean".
4. **Always remove the worktree** (`git worktree remove --force` in a
   `finally`). A failed removal is appended to `output` as a note; it never
   changes the verdict.

A wrong draft becomes structurally unable to touch the session checkout or
its environment. No new knob, no new concept — the check's contract
(exit 0 = safe) is unchanged.

Fidelity bonus: the probe now rehearses exactly what the engine does to real
tasks — run bootstrap in a fresh worktree cut from a commit — instead of
running against the operator's dirty checkout. A bootstrapCmd that depends on
uncommitted files now correctly fails validation, because it would also fail
in every task worktree.

### What the worktree boundary does and does not contain

Named explicitly (spec, `validate_knobs` docstring, and the SKILL.md
sentence) rather than implied:

- **Contained:** file mutations anywhere within the repo tree — creates,
  edits, deletes, including the venv-stripping incident class when the
  environment lives inside the repo.
- **NOT contained:** side effects outside the tree — shared global package
  caches (pip/npm/uv), installs into an outside-the-repo venv already on
  PATH, global tool state, network effects. A hostile or pathological
  command can still mutate those; the probe narrows the blast radius, it is
  not a sandbox.

### SKILL.md wording

The Step 2 line "verifies any `bootstrapCmd` no-ops cleanly on the session
checkout" becomes "verifies any `bootstrapCmd` no-ops cleanly in a throwaway
worktree (never the session checkout; global package caches are outside the
boundary)".

## Testing

In `tests/test_ultra_run.py`, alongside the existing `--validate-knobs`
cases (which keep passing — a clean no-op is green in either location):

1. **Destructive candidate cannot touch the session checkout** — the
   headline regression. `bootstrapCmd: "rm plan.md"` → exit non-zero,
   `treeClean` false, **and the session repo's `plan.md` still exists** (the
   assertion the old design fails).
2. **Clean no-op passes and leaves nothing behind** — `bootstrapCmd: "true"`
   → exit 0, and no `wt-knob-*` path remains under `.claude/ultrapowers`.
3. **Worktree-creation failure fails closed** — run against a freshly
   `git init`-ed repo with no commits (unborn HEAD makes
   `git worktree add … HEAD` fail deterministically) → exit non-zero,
   `ok: false`, detail names the probe worktree.

## Rejected alternatives

- **Static/dry-run analysis of the command** — cannot know package-manager
  semantics; executing in isolation is the only honest probe.
- **Warn-and-confirm before running on the checkout** — keeps destructive
  execution, merely gated; the operator cannot judge a command's no-op-ness
  better than a rehearsal can.
- **Full sandboxing (containers, cache isolation)** — machinery beyond the
  recurrence evidence; the worktree contains the observed defect class, and
  the uncontained remainder is named instead of engineered away.

## Collision note

Queued plans #97 (stage verdicts), #100 (baseBranch), and #96 all touch
`ultra_run.py`/`tests/test_ultra_run.py`. The docket drain serializes plans
on the integration branch; this change is confined to the `validate_knobs`
function and its tests, disjoint from the stage()-emission and base-branch
regions those plans edit.
