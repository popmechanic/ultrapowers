# Spec: receipt stage details state the stage's own verdict (#97)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 3).
Surface: `skills/ultrapowers/scripts/ultra_run.py` + `tests/test_ultra_run.py`.
The deterministic driver — not the frozen verification periphery.

## Problem

The pre-launch receipt is the operator-facing (and ultralearn-harvested)
health artifact of a fail-closed driver, and its most frequent defect class
(14 of 118 ledger runs, every version 0.0.35→0.1.11) is a green stage
annotated with its own failure sentence. Root cause: `stage(name, ok, detail)`
takes ONE detail, and call sites pass failure-shaped expressions that leak
into the success path:

- `git-repo`: `r.stderr or "not inside a git repository"` — success stderr is
  empty, so the failure string becomes the success detail. In every receipt
  this repo produces.
- `worktree-probe`: `r.stderr` — `git worktree add` prints porcelain
  (`Preparing worktree (detached HEAD …)`) to stderr on SUCCESS.
- `compile`: `r.stderr or r.stdout` — success stdout is the full compile JSON,
  so the detail is a front-truncated raw dump duplicating the structured
  `receipt["compile"]` object.
- `install` (latent): the single detail `"installed: " + ", ".join(installed)`
  reads `"installed: "` on the empty-failure branch.

A green stage annotated with failure text trains readers to ignore details —
21/21 sense-pass readers independently flagged it.

## Design

### The emission-point change (make the defect inexpressible)

`stage()` takes separate success and failure details and picks by the verdict:

```python
def stage(name, ok, success="", failure=""):
    stages.append({"stage": name, "ok": bool(ok),
                   "detail": str(success if ok else failure).strip()[-2000:]})
    return bool(ok)
```

A success detail can no longer be a failure message because they are
different parameters. Every future stage (e.g. the `test-command` stage the
gate-derives-inputs plan adds) inherits the split by construction.

### Call-site conclusions

Each call site passes its own conclusion as `success` and its probe evidence
as `failure`:

| stage | success detail | failure detail |
|---|---|---|
| `git-repo` | the resolved repo root path | `r.stderr` or `"not inside a git repository"` |
| `worktree-probe` | `"worktree capability verified (probe cut and removed)"` | probe `r.stderr` |
| `engine-skew` | existing conclusion strings, re-expressed (`SKEW — …` / `out or "IN_SYNC"` / `"skipped — not self-hosting"`) | `out` |
| `superpowers-compat` | `"contract verified against the enabled superpowers"` | `r.stdout + r.stderr` |
| `scratch-hygiene` | the computed prune conclusion (unchanged) | — (always ok) |
| `compile` | computed summary: task count, wave count, acceptance mode (e.g. `"6 task(s) in 3 wave(s); acceptance: suite"`), derived from the parsed compile JSON | `r.stderr or r.stdout` |
| `install` | `"installed: " + ", ".join(installed)` (unchanged) | `"no harness manifests found under <HARNESSES dir>"` |
| `lock` | `"lock acquired: " + stamp` | `r.stderr or r.stdout` |
| `snapshot` | `"checkout snapshot recorded"` | `r.stderr` |
| `base-branch` | the branch name | `"no branch resolvable"` |

The compile summary is computed from the JSON already parsed into
`receipt["compile"]` (parse once, before the stage call, on returncode 0) —
counts come from `waves` (task ids per wave) and `acceptance.mode`.

Failure details keep full probe evidence — raw stdout/stderr belongs on the
failure path, where a human is diagnosing.

### The pin

A test asserts, generically over `receipt["stages"]` of a happy-path run, that
no `ok: true` stage detail contains a known failure phrasing:

```python
FAILURE_PHRASINGS = ("not inside a git repository", "Preparing worktree",
                     "no branch resolvable")
```

Written over ALL stages (not an enumerated list), so stages added by later
plans are covered automatically. Plus two shape pins: the compile detail does
not start with `{` and names the task/wave counts; the worktree-probe success
detail carries no porcelain.

## Error handling

Unchanged: `bail()` semantics, stage ordering, the 2000-char detail cap, and
`--validate-knobs`' separate `knob-validate` JSON (already states
conclusions).

## Testing (`tests/test_ultra_run.py`)

- The generic no-failure-phrasing-on-green pin (above) on a happy-path run.
- Compile detail is a summary: no leading `{`, contains `"task(s)"` and
  `"wave(s)"` and the acceptance mode.
- `git-repo` success detail equals the repo root path.
- Existing failure-path tests keep passing (failure details unchanged or
  strictly more explicit).

## Non-goals

- No receipt schema change (`stage`/`ok`/`detail` keys unchanged).
- No changes outside `ultra_run.py` + its tests.
- No re-emission or migration of old receipts.

## Sequencing note

The gate-derives-inputs plan (#96) also edits `ultra_run.py`. Docket-drain
plans serialize on the integration line, so whichever lands second adapts as
a clean diff; the generic pin covers the other plan's new stage either way.

## Evidence index

Distill 2026-07-27 (ledger 1088 rows / 118 runs): 14-run cluster, P2,
`complexityEffect: structural`, `netConceptDelta: flat`; flagged by 21/21
readers in the sense pass.
