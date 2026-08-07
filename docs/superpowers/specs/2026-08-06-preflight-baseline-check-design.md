# Preflight baseline check — red-on-main becomes a pre-launch operator decision

_Design for issue #116 (distill 2026-08-06). **This is the cycle's single
budgeted additive guard** — declared as such at triage and here._

## Problem

Runs launch onto repos whose baseline is already red, and the cost lands
mid-run where it is most expensive and least legible (9 findings / 9 runs):
a gate manually exonerating a pre-existing flake before it could attribute
blame; a reconcile agent committing into a plan-protected path mid-run because
the gate could not otherwise execute — on a run promised as removal-only; an
auto-detected testCmd that segfaulted at the repo root, caught only by
coordinator vigilance after the run was locked and stamped, costing a full
teardown/relaunch. The decision a red baseline forces — fix drift first,
accept a named off-plan repair, or launch anyway — belongs to the operator,
before any wave runs.

## Design

### The baseline rides the existing validate-knobs rehearsal

No new preflight stage, no new worktree machinery, **no new flag**:
`validate_knobs` already cuts a throwaway worktree and rehearses
`bootstrapCmd` inside it (#99), and the main driver already stamps the
run-wide `testCmd` into the args file (ultra_run.py:337). The stage reads
`knobs.get("testCmd")` exactly as it reads `knobs.get("bootstrapCmd")` — no
hand-carried duplicate, no value-drift seam.

Invocation is unchanged:

    python3 skills/ultrapowers/scripts/ultra_run.py --validate-knobs <args.json>

Behavior:

- **Precedence:** invalid knobs → exit 1 (unchanged, baseline never
  attempted). Bootstrap rehearsal failure → the existing exit-1 path,
  baseline **not** attempted (tests against uninstalled deps are
  guaranteed-red noise). Exit 3 is reachable only when knobs and bootstrap
  are green.
- **Ordering:** the `git status --porcelain` dirt check is captured
  immediately after the bootstrap rehearsal — `treeClean` stays a
  bootstrap-only verdict — and the baseline runs after it; test-induced dirt
  (caches, coverage files) is out of scope for `treeClean`.
- The baseline runs `knobs["testCmd"]` once in the same throwaway worktree,
  with a **timeout** (default 1800s); timeout counts as red with a timeout
  note in the output.
- The knob-validate JSON gains `baseline: {"ok": bool, "exit": int,
  "output": "<truncated [-2000:]>"}` — the stage's existing field vocabulary
  (`ok`/`exit`/`output`, same truncation rule), no new synonyms; the only new
  term is the `baseline` key.
- **Exit 3** (new, distinct): knobs valid, bootstrap green, baseline red —
  shell-level gating stays exit-code-authoritative. Exit 0 keeps meaning
  everything green (or baseline skipped); exit 1 keeps meaning invalid
  knobs/failed bootstrap.
- No `testCmd` key in the args file → baseline skipped with a note.
- **Named behavior change:** today the no-`bootstrapCmd` path returns early
  ("nothing to validate") without cutting a worktree. With a `testCmd`
  present, the worktree is now cut and the baseline runs; the old early
  return survives only when there is neither a `bootstrapCmd` nor a
  `testCmd`.

A crashing auto-detected command (the segfault case) is just a red baseline —
caught in the throwaway before the run is locked into launch, instead of by
vigilance after.

### The operator decision (SKILL.md Step 2)

One instruction: on exit 3, present the decision before launching — **fix
drift first** (repair main, re-run preflight), or **launch anyway** (the red
is inherited; optionally add an explicit plan note authorizing any repair the
run will need, so the reconcile agent never improvises one — the
protected-path incident's answer). The recording is **context-only**: the
operator's Step-2 acknowledgment is the record, and the in-run setup baseline
remains the sole durable record the gate reads — no receipt or args field is
written (owned explicitly; the issue's "receipt gains a baseline verdict
field" is not built).

## Surfaces

- `skills/ultrapowers/scripts/ultra_run.py` — `validate_knobs` extension only
  (no main-driver change, no new flag).
- `tests/test_ultra_run.py` — the new behaviors.
- `skills/ultrapowers/SKILL.md` — Step 2: the exit-3 decision text. Within
  the ratchet budget.

Not built: no receipt schema change (the knob-validate JSON is the pre-launch
record; the run's own baseline already lives in the report), no new preflight
stage, no gate changes, no new worktree machinery.

## Error handling

- testCmd itself unrunnable in the throwaway (spawn failure) → baseline red
  with the spawn error as `output` — indistinguishable from red on purpose;
  the operator decision is the same.
- Probe worktree can't be cut → existing validate-knobs failure path,
  unchanged.
- Baseline runtime: the suite runs once pre-launch; the setup agent runs it
  again in-run — the duplication is the price of moving the decision, and it
  was already paid on every run that hit the mid-run version of this problem.

## Testing

`tests/test_ultra_run.py` additions (existing fixture patterns): green
testCmd in args → exit 0, `baseline.ok` true; red testCmd → exit 3,
`baseline.ok` false, `output` carries the tail; no testCmd key → exit 0,
baseline-skipped note; bootstrap rehearsal ordering (porcelain captured
before the baseline runs — `treeClean` unpolluted by test dirt); bootstrap
failure → exit 1, baseline not attempted; invalid knobs → exit 1 regardless;
no-bootstrapCmd + testCmd → worktree cut and baseline runs (the named
behavior change); timeout → exit 3 with timeout note.

## Complexity budget declaration

complexityEffect: **additive-guard** — the one budgeted guard this cycle
(distill 2026-08-06). consolidationAttempted: the variation is environmental
(the repo is red before any work), not representational; the structural
alternative (gate diffs acceptance against a recorded baseline-failure set)
touches the frozen gate and waits for eval-measured evidence.
netConceptDelta: up by one exit code and one JSON block, mitigated by reusing
the validate-knobs worktree, vocabulary, and invocation.

## Trim review

**Author disclosure (Adds/Removes).** Adds: one testCmd run + one JSON block +
one exit code inside an existing stage; one SKILL.md decision instruction.
Removes (as recurring costs, not code): the mid-run reconcile judgment call on
red baselines; the gate-time flake exoneration; the post-lock teardown on
crashing detected commands.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issue
#116, the doctrine, and `ultra_run.py`; bar set at "minimum viable form of the
cycle's one budgeted guard"): 3 trims + 5 build-time gaps; endorsed the
core consolidation (riding validate-knobs beats the issue's own one-new-stage
framing) and exit 3 as the honest minimum; grade: **up** (exit 3 + the
`baseline` key are irreducibly new).

**Adopt-or-answer — all eight adopted:**

1. `--test-cmd` flag → **adopted** (delete): the args file already carries
   the stamped testCmd (ultra_run.py:337, verified); the stage reads it like
   `bootstrapCmd` — the flag was a hand-carried duplicate with a drift seam.
2. `{passed, exitCode, tail}` field names → **adopted** (merge): the stage's
   existing `ok`/`exit`/`output` vocabulary + truncation rule; only
   `baseline` is new.
3. Three operator dispositions → **adopted** (merge): two dispositions, with
   the plan-note authorization as a rider on launch-anyway.
4. **Gap** no timeout → **adopted**: 1800s default, timeout = red.
5. **Gap** dirt-check ordering → **adopted**: porcelain captured
   post-bootstrap, pre-baseline; `treeClean` stays bootstrap-only.
6. **Gap** homeless "recorded as inherited" → **adopted**: context-only
   recording owned explicitly; the in-run setup baseline stays the sole
   durable record.
7. **Gap** bootstrap-red precedence → **adopted**: short-circuit, exit 1,
   baseline not attempted; exit 3 requires green knobs + green bootstrap.
8. **Gap** no-bootstrapCmd early-return change → **adopted**: named as a
   behavior change with its own test cases.

**Reviewer grade stands: up** — the declared, budgeted cost of the cycle's
one additive guard.
