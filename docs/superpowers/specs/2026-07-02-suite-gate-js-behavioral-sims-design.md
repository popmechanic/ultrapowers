# Suite-gate: run the harness `.mjs` sims when harness JS changes

**Date:** 2026-07-02
**Status:** design (approved for planning)
**Issue:** #79 — docket drain `--suite-gate` (pytest) cannot execute `waves.js`
behavior; JS-behavioral suite plans get a shallow green.

## Problem

The docket drain's correctness gate for `suite`-disposition plans is
`run_acceptance.sh --suite-gate` → `python3 -m pytest`. `pytest.ini` scopes the
suite to `tests/`, and the engine's **behavioral** tests for the JS workflow
harness are the `tests/*.mjs` sims — kept out of CI/pytest by convention (run
manually with `node`). So for any `suite`-disposition plan whose behavior lives
in `skills/ultrapowers/harnesses/*.js`, a green suite-gate proves only the
prose-drift pins and the Python-side tests. It does not execute the JS logic.

The drain's keystone is exam-gated auto-approve: green gate ⇒ auto-merge. For a
`waves.js`-behavioral plan that guarantee is weaker than it looks — the merge key
turns on a gate that cannot run the changed behavior. The 2026-07-01 live
shakedown hit this on #70 (ancestry assertion, JS-only) and #67; both had to be
hand-held to operator-review PRs instead of trusting the advisory green.

## Goal

Close the hole with the smallest change that makes JS behavior exit-code-gated
like Python — so a `harnesses/*.js`-behavioral suite plan that a sim would catch
red cannot reach a green gate, and therefore cannot auto-merge.

Non-goals: the viewer/visualization specs (`swarm_*`, `audit_*`), any browser
path, the sealed-exam path, and CI (the sims stay out of `pytest`/CI; only the
gate runs them, on demand).

## Design

Teach the existing `run_acceptance.sh --suite-gate` mode to also run the harness
`.mjs` sims **when the branch changed harness JS**, folding their result into the
same single-object JSON contract (`{sealId, status, passed, exitCode, output,
redKind?}`). The sealed path and the pytest-only behavior for non-JS plans are
untouched.

### Detection — gate self-detects via an optional `--base`

`--suite-gate` gains an optional `--base <ref>`. The logic lives in the gate, not
the caller, so it cannot be bypassed by a forgetful caller and it keys on the
**actual git diff**, not declared writes.

Inside the detached worktree of `<branch>`:

1. Run pytest exactly as today.
   - **Red (nonzero, not 5)** → emit red and stop. The gate has already failed;
     the sims add nothing.
   - **Exit 5** (no tests collected) → `ERROR`, as today (false-green guard).
   - **Green** → continue to step 2.
2. If `--base` was passed **and**
   `git diff --name-only <base>...HEAD` lists a path matching
   `skills/ultrapowers/harnesses/*.js`:
   - Run the harness sims (below). Fold their result into the emitted JSON.
   - Otherwise → emit the pytest-only green, exactly as today.
3. No `--base`, or harnesses untouched → **today's behavior, byte-for-byte.**
   Existing suite-gate tests (which pass no `--base`) keep passing unchanged.

Three-dot `<base>...HEAD` diffs against the merge-base, so it is correct even if
the base line advanced after the plan branched.

The drain (`ultradocket/SKILL.md` step 3) passes
`--base <docket-integration-line-HEAD>` — the ref it branched the plan from,
which it already owns. A manual `--suite-gate` with no `--base` is pytest-only.

### Sim selection — auto-discover harness sims

The gate runs the `tests/*.mjs` whose source references `harnesses/` (today: only
`sim_workflow.mjs`; the four viewer specs reference `viewer/` and are excluded).
Discovery, not an allowlist: harness-behavioral by construction, no viewer spec
pulled in, and a future harness sim is picked up with nothing to maintain.

Each selected sim runs with `node <sim>` from the worktree cwd, so it resolves
`../skills/ultrapowers/harnesses/waves.js` against the branch's checked-out copy.

### False-green guard — require a pass sentinel

`node` exits 0 for a script that asserts nothing (or throws before its first
assertion inside a swallowed try). Exit code alone would re-open the hole. So a
sim earns a pass only if it **both** exits 0 **and** prints a pass sentinel
matching the extended regex `ALL (SCENARIOS|TESTS) PASSED` — the tokens the
current sims already emit. This mirrors the pytest "ran no tests" guard
(exit 5 → `ERROR`).

Per-sim classification, aggregated (first failure wins the emitted verdict):

| Sim result | Gate verdict |
|---|---|
| exit 0 **and** sentinel present | pass — continue to next sim |
| exit ≠ 0 | red: `status OK, passed false, redKind assertion, exitCode <n>` |
| exit 0 **but** no sentinel | `ERROR`, `passed false` — false-green refused |
| `node` not found on PATH | `ERROR`, `passed false` — environment, not feature-absence |
| harness JS changed but **no** harness sim references `harnesses/` | `ERROR`, `passed false` — refusing to green un-exercised JS |

All harness sims pass → emit green with the combined pytest+sim output. Any row
above short-circuits to that row's verdict with the offending sim named in
`output`. `emit` already truncates `output` to the last 8000 chars.

The empty-run-set row is the strongest anti-shallow-green stance: if harness JS
changed and nothing exercises it, the honest verdict is "cannot verify" → park,
not green. In practice `sim_workflow.mjs` imports `waves.js`, so the run-set is
non-empty for any real `waves.js` change; this row only fires if that coverage is
deleted.

### JSON contract

Unchanged shape. `sealId` stays `(suite)`. New failure/error paths reuse the
existing fields: sim assertion red → `redKind: "assertion"`; sim false-green,
missing node, and empty run-set → `status: "ERROR"` with `passed: false` (no
`redKind`, matching the pytest-exit-5 error). The drain's park path already keys
on this exact JSON, so no drain-side contract change is needed beyond passing
`--base`.

## Components touched

- **`skills/ultrapowers/scripts/run_acceptance.sh`** — parse `--base` in the
  suite-gate arg loop; after a green pytest, a `run_js_sims` helper does the diff,
  discovery, per-sim run, and classification, returning globals the suite-gate
  block folds into a single `emit`. No change to the sealed or baseline paths.
- **`skills/ultradocket/SKILL.md`** — step-3 `suite` line documents the
  `--base <integration-line-HEAD>` argument (prose; not a baked/pinned copy).
- **`CLAUDE.md`** — one line noting the suite-gate runs the harness sims when
  `harnesses/*.js` changes, and that harness sims must print the pass sentinel.
- **`tests/test_run_acceptance.py`** — new coverage (below). Existing suite-gate
  tests are unchanged and must stay green (backward-compat proof).

## Testing (TDD)

New `test_run_acceptance.py` cases, each building a repo with a fake harness file
and a fake harness sim (a `tests/*.mjs` that references `harnesses/` and prints /
withholds the sentinel), then invoking `--suite-gate --branch B --base main`:

1. **Red sim → gate red.** Branch modifies `harnesses/x.js`; its harness sim exits
   1. Gate: `code != 0`, `passed false`, `redKind "assertion"`.
2. **Green sims → gate green.** Same harness diff; sim exits 0 and prints the
   sentinel. Gate: `code 0`, `status OK`, `passed true`, combined output present.
3. **No harness diff → sims skipped (no regression).** Branch touches only a
   non-harness file; the harness sim would fail if run. Gate: green, pytest-only —
   proving the sim was not run.
4. **False-green guard.** Harness diff; sim exits 0 but prints no sentinel. Gate:
   `status ERROR`, `passed false`.
5. **Backward compat.** The three existing suite-gate tests (no `--base`) stay
   green untouched.

Plus the manual gate: full `python3 -m pytest` green, and `node
tests/sim_workflow.mjs` (and every other `tests/*.mjs`) run by hand still exit 0.

## Risks / rejected alternatives

- **Caller-side detection (drain reads declared writes).** Rejected: relies on
  declared writes (can under-declare) and on caller discipline; the gate can be
  bypassed. Gate-side git-diff is ground truth and unbypassable.
- **Explicit sim allowlist.** Rejected: a new harness sim silently goes ungated
  until someone edits the list. Discovery has no such drift.
- **Trust node exit code alone.** Rejected: that is the exact false-green this
  issue is about.
- **Run all `.mjs` (including viewer specs).** Rejected: couples a harness gate to
  viewer specs and risks a future browser-only spec hanging the gate. Discovery by
  `harnesses/` reference excludes them cleanly.

## Out of scope

Version bump (none — small focused engine change), the full docket drain (a single
feature branch + PR to `main`), and re-baking `waves.js` (not edited).
