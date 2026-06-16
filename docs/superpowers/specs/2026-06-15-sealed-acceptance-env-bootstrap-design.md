# Sealed acceptance — exam-worktree env bootstrap + env-vs-red classification

**Date:** 2026-06-15
**Fixes:** Finding E from the polyglot end-to-end run (sealed exam silently neutralized: a path-dependent suite fails at collection and is reported as a red).
**Follows:** the 2026-06-12 sealed-acceptance design (part 1) and the 2026-06-14 gate-fix design (#36/#37, deterministic gate administration). Builds on PR #47's `bootstrapCmd` *concept* (finding D), which plumbed per-worktree setup into the task/review worktrees only — never the acceptance-exam worktree this spec addresses.

## Problem

The sealed acceptance gate administers a held-out exam against the integration branch by way of
`run_acceptance.sh`: it verifies the suite hash, creates a detached worktree of the branch, copies
the sealed suite to `.ultra-acceptance/`, and runs the manifest's `runCmd` (`eval "$RUN_CMD"`) in
that worktree. The worktree is a **bare checkout** — no `.venv`, no `node_modules`, no editable
install.

On a polyglot repo (Python root needing an editable install so `kb_lib` imports, plus a Bun
subdir), the sealed suite failed at **collection** with `ModuleNotFoundError: kb_lib`, because the
exam worktree never bootstrapped the project's environment. `run_acceptance.sh` treats *any*
non-zero exit as an "honest red" (its comment at the classification block reads: "a collection error
from a missing module (feature absent) is an honest red"). So an **environment** failure was
reported as `passed:false` — a **false red** that silently neutralizes the gate. The covered
contracts were independently green in the integration pytest run; an operator had to manually
recognize false-red versus real-red.

Two failure modes look identical at the surface and must be told apart:

- **Missing *feature* module** — the feature under test is genuinely absent. Honest red. Correct.
- **Missing *repo-library* module** — the repo's own package isn't importable because the worktree
  was never bootstrapped (no editable install / no `sys.path`). False red. Wrong.

A marker-based "did any test run" heuristic cannot separate these — neither case executes a test.
The only thing that disambiguates is bootstrapping the environment first: once the repo's own
libraries import, an env-caused collection error can no longer occur, and any remaining collection
red is genuine feature-absence.

Compounding this, the seal-author proves RED in an **ad-hoc** context
(`seal-author-prompt.md` step 3: "create a throwaway worktree of the base branch, copy the suite,
run it" via a bare `python3 -m pytest`). That context differs from the gate-time runner context, so
a suite that imports fine under the author's hands but cannot import under `run_acceptance.sh` passes
seal-time and only fails — falsely — at the gate.

## Design

Four parts, all **outside the frozen `waves.js` harness**: no re-bake, no drift/canary re-pin.

### 1. The seal records its own run context (`bootstrapCmd` in the manifest)

The independent seal-author authors an optional per-worktree setup command and records it in
`manifest.json` next to `runCmd`:

```json
{
  "sealId": "...", "planPath": null, "specPath": "...", "suiteSha256": "...",
  "runCmd": ".venv/bin/python -m pytest .ultra-acceptance -q",
  "bootstrapCmd": "python3 -m venv .venv && .venv/bin/pip install -e .[dev]",
  "createdAt": "...", "baselineSha": "...", "redEvidence": "...", "coverage": [...]
}
```

`bootstrapCmd` + `runCmd` together *are* the resolved run context. Because both live in the seal,
seal-time and gate-time match by construction, and the gate's CLI signature is **unchanged**
(`run_acceptance.sh <sealId> <branch> <sha256>` reads everything from the manifest). `bootstrapCmd`
is optional: a manifest without it behaves exactly as today, so repos that need no setup — and every
existing seal — are unaffected.

Trust note: `bootstrapCmd`, like the existing `runCmd`, is unhashed operator-authored manifest
config that `run_acceptance.sh` executes. The seal hash protects the **suite contents** (tests
cannot be weakened without breaking the hash); the manifest is operator-trusted config. `bootstrapCmd`
is the same trust level as `runCmd` and grants no new capability (`runCmd` is already `eval`'d).

### 2. `run_acceptance.sh` bootstraps, then classifies into three buckets

After copying the suite and writing the `.__ran__` sentinel conftest, and **before** `runCmd`:

- If `bootstrapCmd` is present, run it in the exam worktree. A non-zero exit emits the new status
  **`EXAM_BOOTSTRAP_ERROR`** (`passed:false`, non-zero exit) and stops: the environment could not be
  prepared — this is neither a red nor a pass, and must not be read as feature-absence.

Then `runCmd` runs under the sentinel conftest (which writes `.__ran__` when any test's call phase
executes), and the result is classified:

| runCmd exit | `.__ran__` | Result |
|-------------|-----------|--------|
| 0 | present | `OK`, `passed:true` |
| 0 | absent | `ERROR` (no sealed test ran — existing false-green defense, unchanged) |
| non-zero | present | `OK`, `passed:false`, `redKind:"assertion"` (a test ran and failed) |
| non-zero | absent | `OK`, `passed:false`, `redKind:"collection"` (nothing executed) |

Both reds keep `status:"OK"` so the existing honest-red contract and its test remain valid; they
gain a new `redKind` field. `EXAM_BOOTSTRAP_ERROR` is the only new status. The emitted JSON gains
an optional `redKind` (`"assertion"` | `"collection"`, omitted/`null` when not a red).

Why three buckets suffice: bootstrapping (part 1) makes the repo's own libraries importable, so an
env-caused collection error can no longer reach `runCmd` — it is either prevented (bootstrap
succeeds) or surfaced distinctly (`EXAM_BOOTSTRAP_ERROR`). Any `redKind:"collection"` that survives a
successful bootstrap is therefore genuine feature-absence. `redKind` carries the
collection-vs-assertion distinction into the runner output so Step 5 can read it instead of an
operator eyeballing pytest text.

### 3. The seal-author proves RED through the *exact* runner path

The worktree-add + bootstrap + copy + run + classify logic is refactored into one shared core inside
`run_acceptance.sh`, used by both the sealed gate path and a new baseline mode:

```
run_acceptance.sh --baseline --suite <dir> --branch <base> [--bootstrap <cmd>] --run <cmd> [--repo DIR]
```

Baseline mode skips the vault lookup and hash verification and runs the **identical** core against
the base branch, with an **inverted exit contract** suited to proving absence:

- result is a genuine red (`passed:false`, either `redKind`) → `PROVEN_RED`, **exit 0**.
- result is green (`passed:true`) → `GREEN_AT_BASELINE`, exit non-zero (feature already present or
  tests too weak — do not weaken to force red).
- `EXAM_BOOTSTRAP_ERROR` → exit non-zero (the authored `bootstrapCmd` does not prepare the env).

It emits the same JSON shape. `seal-author-prompt.md` step 3 is rewritten to call baseline mode
instead of a bare `python3 -m pytest`, so the author proves RED against byte-identical logic. The
author must additionally confirm from the (now identical) output that a `redKind:"collection"` red is
**feature**-absence — i.e. the failing import names the feature, not a repo library — and adjust
`bootstrapCmd` until the only failure is the feature. A suite that cannot import under the runner is
thus caught at seal time, not gate time.

### 4. Docs in lockstep

- **`seal-author-prompt.md`** — author `bootstrapCmd` when the repo needs setup; prove RED via
  `--baseline`; confirm the red is feature-absence; record `bootstrapCmd` in the manifest.
- **`ultraplan/SKILL.md`** — the seal step notes the bootstrap authoring and the runner-path RED
  proof, and that the manifest records `bootstrapCmd`.
- **`ultrapowers/SKILL.md` Step 5** — operator handling: `EXAM_BOOTSTRAP_ERROR` (env could not be
  prepared → fix env / re-seal, distinct from a feature red — never an Approve); `redKind` on red
  results (assertion vs collection) read alongside the existing exit-code-is-authority rule.

## Data flow

**Seal time (ultraplan).** Seal-author writes the suite, authors `runCmd` + `bootstrapCmd`, proves
RED via `run_acceptance.sh --baseline …` (the shared core), confirms the red is feature-absence,
hashes the suite, writes `manifest.json` including `bootstrapCmd`, returns sealId / sha256 /
redEvidence / coverage.

**Gate time (ultrapowers Step 5).** `run_acceptance.sh <sealId> <branch> <sha256>` verifies the
hash, adds a detached worktree, copies the suite, runs `bootstrapCmd`, runs `runCmd` under the
sentinel, classifies, emits JSON. Exit 0 iff `passed:true`. Step 5 reads `status` / `redKind` to
advise the operator.

## Error handling

- Bootstrap command fails → `EXAM_BOOTSTRAP_ERROR`, non-zero exit, no Approve.
- Hash mismatch → `SEAL_BROKEN`; missing vault entry → `SEAL_MISSING`; missing/invalid `runCmd` →
  `ERROR` (all unchanged).
- Missing `bootstrapCmd` → no bootstrap step; behavior identical to today.
- Baseline mode: `GREEN_AT_BASELINE` and `EXAM_BOOTSTRAP_ERROR` both exit non-zero so the author
  cannot seal a non-red baseline.

## Testing

`tests/test_run_acceptance.py` (bash-shelled e2e against a throwaway repo + tmp vault), extending the
existing harness:

- bootstrap runs before the suite (a `bootstrapCmd` that provisions the needed module lets a
  previously collection-failing suite reach its assertion and pass when the feature is built);
- bootstrap failure → `EXAM_BOOTSTRAP_ERROR`, `passed:false`, non-zero, distinct from `OK`;
- assertion red is labeled `redKind:"assertion"` (feature built but wrong → marker present);
- collection red is labeled `redKind:"collection"` (feature absent → marker absent; existing
  honest-red test keeps `status:"OK"`, now also asserts `redKind`);
- **finding scenario**: a suite importing a repo library that is absent without an editable install
  is a false red today; with `bootstrapCmd` installing it, the suite reaches the feature and reds
  honestly (assertion) when the feature is wrong / greens when built;
- baseline mode: proves-red (exit 0) against a feature-absent repo; rejects-green (`GREEN_AT_BASELINE`,
  non-zero) against a feature-built repo; surfaces a bootstrap error.

All existing `test_run_acceptance.py` tests stay green (no manifest has `bootstrapCmd`, so the
bootstrap step is skipped; the honest-red test gains a `redKind` assertion with `status` still `OK`).
`python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` stays "skill ok", and the
full pytest suite runs before finishing.

## Out of scope / non-goals

- No change to `waves.js` (the frozen harness) — finding D already gave the **task/review** worktrees
  their own `bootstrapCmd`; this spec is solely the **acceptance-exam** worktree. No re-bake.
- No auto-detection of the repo environment (rejected: fragile and framework-specific on exactly the
  polyglot repos that triggered this finding). The run context is declared, not sniffed.
- No new gate CLI arguments — the seal is self-describing.
