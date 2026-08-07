# Gate integrity pair — canonical worktree paths (false-red) + whitespace-proof command guards (false-green)

_Design for issues #117 + #105, one build. **This spec touches the frozen
verification periphery** (`run_acceptance.sh`); the unfreeze evidence is
mechanical and recorded below._

## Problem

Two gate-manufactured wrong verdicts, both proven by execution:

- **False-red (#117, sev 3):** both worktree provisioning sites
  (`run_acceptance.sh:124` exam, `:266` suite-gate) use `mktemp -d`, which on
  macOS returns paths under the `/var → /private/var` symlink.
  Path-identity-sensitive toolchains (a native tsc variant in the field run)
  resolve one module through two prefixes as two modules — 4 type errors in a
  file the branch never touched, three identical BLOCKEDs, operator override
  required; the identical commit was green in a canonical-path worktree.
- **False-green (#105):** the empty-command guards are truthiness/`-z`-based.
  `run_acceptance.sh --suite-gate --run "   "` returns
  `{"passed": true, "exitCode": 0}` (`eval "   "` exits 0) — proven live by
  the #96 drain's critic. On the unfrozen side, `ultra_run.py --test-cmd "   "`
  is stamped verbatim into the receipt (`testCmdSource: "knob"`), and
  `--test-cmd ""` silently falls through to detection — a silent knob-drop.

A false-green at the gate outranks everything the gate exists for; a
deterministic false-red manufactures operator overrides that erode the gate's
authority.

## Design

### 1. Canonicalize the worktree path at creation (#117)

At both mktemp sites, resolve symlinks before `git worktree add` — as a
guarded **two-step** assignment, because the composed one-liner has a real
failure mode (an inner `cd` failure would compose `EXAM_WT="/exam"`, putting
`dirname → /` into the cleanup trap's `rm -rf`):

    TMP="$(mktemp -d)"
    TMP="$(cd "$TMP" && pwd -P)"
    [ -n "$TMP" ] || { <existing ERROR emission>; exit 1; }
    EXAM_WT="$TMP/exam"          # :124 (and "$TMP/suite-gate" at :266)

No behavior difference on hosts whose temp dirs are already canonical.

### 2. Whitespace-proof the command guards (#105, both sides of the boundary)

- **Frozen side** (`run_acceptance.sh`): the suite-gate's `--run` guard
  strips the full **`[[:space:]]` class** — not the file's space-only
  `${VAR// /}` idiom, which would let a tab- or newline-only command keep
  false-greening past both the guard and its pin. Empty-after-strip refuses
  loudly via the existing usage-error path instead of `eval`ing to a false
  green.
- **Unfrozen side** (`ultra_run.py`): `--test-cmd` is `.strip()`ed at the
  parse (Python's strip already covers the whitespace class);
  empty-after-strip is a **loud test-command stage failure** naming the empty
  knob — never stamped verbatim, never a silent fall-through to detection.

One-guard framing, claimed explicitly: these two strips are a single guard
class (whitespace-empty command refusal) applied at both sides of one
boundary — not two guards against the cycle's budget (#116 holds the budgeted
slot; this pair is dominated by its two deletions of wrong-verdict classes).

### 3. The unfreeze evidence (mechanical, and honestly labeled)

The freeze's letter names `evals/ab_runner.py` numbers; this spec substitutes
**committed pytest differentials** and says so out loud. The substitution
holds because both defects are gate wrong-verdicts — the exact quantity the
eval exists to measure — proven by execution (an in-field A/B for #117; the
#96 drain critic's executed repro for #105), and both fixes make the gate
stricter or truer, never looser. #105 rides this unfreeze under its own
issue's instruction ("bundle with the next eval-gated periphery change");
#105 alone would not clear the bar. Three conditions keep the precedent
clean:

1. **GREEN-at-HEAD pins + recorded RED-at-BASE:** the committed artifacts
   are the green pins; the RED-at-BASE runs are performed once during the
   build and recorded in the review evidence **with the exact BASE sha** —
   re-derivable by anyone via checkout + run.
2. **No-collateral check:** the existing suite-gate/exam tests must pass
   untouched (the differentials prove the targeted defects died, not that
   nothing else moved).
3. The repro fixtures are **tmp_path-built throwaway repos inside the
   tests** — `evals/fixtures/` does not grow (that family is coupled to the
   seal machinery and offers no reuse here).

Repro shapes:

- **#117, portable:** the test sets `TMPDIR` through a test-created symlink
  (so `mktemp -d` returns a symlinked path on any host), and the fixture's
  run command is a one-test pytest run whose test asserts
  `os.getcwd() == os.path.realpath(os.getcwd())` — pytest-emitting on
  purpose, so the pin survives any future suite-gate tests-ran defense
  rather than depending on its absence. BASE: gate reports the fixture red
  (the manufactured false-red). HEAD: green.
- **#105:** `--suite-gate --run "   "` AND `--run "$(printf '\t')"` (the
  tab case pins the character-class strip) exit non-zero with the refusal;
  `ultra_run.py --test-cmd` with whitespace-only and empty values fails the
  stage — one parametrized test, both inputs.

## Surfaces

- `skills/ultrapowers/scripts/run_acceptance.sh` — the two mktemp lines + the
  `SG_RUN` guard (**frozen periphery; the smallest change that removes each
  wrong-verdict class**).
- `skills/ultrapowers/scripts/ultra_run.py` — `--test-cmd` strip + loud
  empty-knob failure.
- `tests/test_run_acceptance.py`, `tests/test_ultra_run.py` — the
  differential repro tests (permanent pins).

Not built: no TMPDIR management machinery, no path-normalization helper (two
inline guarded assignments), no new exit codes or verdict vocabulary, no
exam-mode `--run` analog (the sealed manifest already refuses an empty
runCmd via its incoherence paths). **Deliberate exclusion, recorded:**
`ultra_gate.py`'s `run_receipt.get("testCmd") or ""` whitespace pass-through
(issue #105's third edge) is left as-is — it is itself frozen, and the
upstream parse-time refusal makes a knob-origin whitespace testCmd
unreachable; a hand-tampered receipt is out of scope.

## Error handling

- Canonicalization failure (never observed) → the guarded two-step
  assignment exits through the existing ERROR emission before any worktree
  or trap state exists; the `dirname → /` cleanup hazard of the composed
  form is unreachable by construction.
- Whitespace-only `--run`/`--test-cmd` (space, tab, newline) → loud refusal
  on both sides, exit codes unchanged in meaning (usage error / stage
  failure).

## Testing

- The two differential repros above (GREEN-at-HEAD pins committed;
  RED-at-BASE runs recorded once with the exact BASE sha).
- Parametrized empty-knob test: whitespace-only and empty `--test-cmd` →
  stage failure naming the knob (the silent fall-through dies).
- Tab-only `--run` case (pins the `[[:space:]]` class, not just spaces).
- Existing suite-gate/exam tests unchanged and green — the no-collateral
  condition of the unfreeze.

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: two composed `pwd -P`
canonicalizations, a `${VAR// /}` whitespace-strip on each side, four-ish pin
tests. Removes: two wrong-verdict classes from the gate the whole engine
trusts.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issues
#117 + #105, the doctrine, and the frozen `run_acceptance.sh`; bar set at
"is the unfreeze evidence genuinely mechanical, and are these the smallest
changes"): 3 trims + 4 gaps + a conditional **unfreeze verdict: sufficient,
narrowly** — with three conditions and the instruction to say out loud that
pytest differentials bend the letter of the `evals/ab_runner.py` rule;
grade: **flat**.

**Adopt-or-answer — all eight adopted:**

1. Two unfrozen-side cases → **adopted** (merge): one parametrized test.
2. Fixture location → **adopted** (narrow): tmp_path-built throwaway repos;
   `evals/fixtures/` does not grow.
3. Overstated "committed differential" wording → **adopted** (narrow):
   GREEN-at-HEAD pins committed; RED-at-BASE recorded once with the exact
   BASE sha.
4. **Gap (dangerous):** the composed canonicalization's failure mode puts
   `dirname → /` into the cleanup trap's `rm -rf` → **adopted**: guarded
   two-step assignment with a non-empty check before any trap state exists.
5. **Gap (dangerous):** `${VAR// /}` strips spaces only — a tab-only command
   still false-greens past the guard AND its pin → **adopted**: full
   `[[:space:]]`-class strip + a tab-only pin case.
6. **Gap:** issue #105's third edge (`ultra_gate.py` pass-through) silently
   omitted → **adopted**: explicit recorded exclusion with its reasoning.
7. **Gap:** the #117 pin depended on the absence of a suite-gate tests-ran
   defense → **adopted**: the fixture's run command is a real one-test
   pytest run, so the pin survives a future ran-defense.
8. **Unfreeze conditions** → **adopted**, all three: BASE shas recorded,
   no-collateral check named, #105 rides under its own issue's bundling
   instruction (alone it would not clear the bar).

**Reviewer grade: flat** — two wrong-verdict deletions against one guard
class applied at both sides of one boundary.
