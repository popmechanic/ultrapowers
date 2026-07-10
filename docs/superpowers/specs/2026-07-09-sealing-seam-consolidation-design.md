# Sealing seam consolidation (prove the manifest, derive the line)

**Date:** 2026-07-09 · **Disposition:** suite · **Status:** spec approved — plan to follow

## Problem

The 2026-07-09 sense pass (13 foreign runs, engines 0.0.32–0.0.35) found one
defect class expressed three ways on the sealing seam: a value hand-carried
between artifacts where it should be derived from one, or proven against one.

1. **Collect transcription.** The seal manifest records two hashes
   (`specSha256`, the content-address key; `suiteSha256`, the integrity
   value). The collect step's prose says append `**Acceptance:** sealed
   <seal-id> (sha256:<hash>)` without naming which. Two runs at 0.0.35
   stamped `specSha256`, and the gate correctly refused with `SEAL_BROKEN`
   on an intact seal — a false block that costs a gate round every time.
2. **Manifest never proven.** The seal author proves RED via
   `run_acceptance.sh --baseline --run "<cmd>" [--bootstrap "<cmd>"]` flags,
   then separately hand-writes `manifest.json`. The gate later reads
   `runCmd`, `bootstrapCmd`, `framework`, and `ranPattern` from that
   manifest — but the brief's field list never mentions `framework` or
   `ranPattern`, so non-pytest suites default to pytest ran-marker
   detection and false-red on a fully green exam. Two runs hit this; each
   also burned an orchestrator round decoding the generic "exited 0 but ran
   no sealed tests" message.
3. **Layout guessing.** Exams sealed at spec approval encoded implementation
   guesses the spec never fixed — module export names and signatures in one
   run, source-text layout scans in another — and behaviorally correct,
   plan-conformant code was reworked to satisfy the exam's guess.

Fix shape, per the distill doctrine: make the defect inexpressible, not
detected. One artifact — the manifest — is proven at seal time and derived
from at collect time; nothing is hand-transcribed.

## Design

### `collect_seal.py` — deterministic collect

New script at `skills/ultrapowers/scripts/collect_seal.py` (the established
home for seal machinery, next to `seal_hash.py` and `run_acceptance.sh`).

Usage: `collect_seal.py <spec-file> [--vault DIR]`. It computes the spec
file's sha256, scans the vault, and prints one JSON object reporting which
of the collect step's four existing cases holds:

- `{"case": "sealed", "sealId": …, "suiteSha256": …, "acceptanceLine":
  "**Acceptance:** sealed <seal-id> (sha256:<suiteSha256>)", "coverage": …}`
  — a sealed dir's `manifest.specSha256` matches. The orchestrator appends
  `acceptanceLine` **verbatim**; it never chooses between hashes.
- `{"case": "failure", …}` — a `pending-<specSha12>/outcome.json` exists;
  its contents are included.
- `{"case": "pending", …}` — a pending dir with `dispatch.json` but no
  outcome; the receipt's contents are included. Liveness stays the
  orchestrator's judgment.
- `{"case": "none"}` — nothing matches this spec hash.

The script detects and reports; the *responses* to each case (wait,
surface the failure, synchronous fallback) stay in ultraplan's SKILL prose,
unchanged. The ultraplan collect step's hand-executed vault scan is replaced
by one script invocation — that prose is the surface this cycle deletes.

### `run_acceptance.sh --baseline --manifest <draft.json>`

Baseline mode gains a manifest input, mutually exclusive with
`--run`/`--bootstrap` (the flags remain for the test harness and ad-hoc
use; the brief names only `--manifest`). The runner reads `runCmd`
(required), `bootstrapCmd`, `framework`, and `ranPattern` from the draft —
so the RED proof exercises exactly the fields the gate will later consume.

Before running anything it fails closed on an incoherent draft, with the
new status `MANIFEST_INCOHERENT` (non-zero exit, message naming the field):

- `framework` absent or `pytest` while `runCmd` does not contain `pytest`;
- `framework` present and not `pytest` while `ranPattern` is empty.

This converts the remembered conditional ("when the suite is not pytest,
also write framework and ranPattern") into an enforced one: a seal whose
manifest would false-red at the gate cannot be proven RED at all.

### Seal-author brief

`references/seal-author-prompt.md` reorders to manifest-draft-first:

1. (unchanged) derive criteria, write the suite;
2. **new:** write the `manifest.json` draft in `<pendingDir>` — the
   identity and execution fields (`planPath: null`, `specPath`,
   `specSha256`, `runCmd`, `bootstrapCmd`, `framework`, `ranPattern`,
   `createdAt`, `baselineSha`) — with `framework` and `ranPattern` named
   in the field list and required whenever the suite is not pytest;
3. prove RED via `--baseline --manifest <pendingDir>/manifest.json …`
   (replacing the `--run`/`--bootstrap` invocation);
4. (unchanged) hash, rename, finalize the manifest by adding `sealId`,
   `suiteSha256`, `redEvidence`, `coverage`.

Plus the authoring rider on what an exam may pin: **pin observable behavior
and values — never module layout, export names, file locations, or textual
source structure — unless the spec itself fixes them.** Prefer hand-computed
golden values over the spec's internal symbol names (value-pinning survives
spec typos and implementation freedom; symbol-pinning turns the exam into a
hidden interface contract the plan author cannot see).

### Gate diagnosis for legacy seals

In the sealed gate path, when `framework` resolves to the pytest default but
`runCmd` visibly is not pytest, the no-tests-ran refusal names the real
cause — "manifest omits framework/ranPattern for a non-pytest runCmd;
re-seal or add the fields" — instead of the generic message. Behavior is
unchanged (still refuses); only the diagnosis improves.

## What deliberately does not change

- **Gate authority.** The gate still compares the suite hash against the
  plan-recorded value — the git-committed, operator-approved anchor the
  vault cannot touch. Deriving the expectation from the manifest at gate
  time (suggested by one field reader) was rejected: manifest and suite are
  both vault-local, so that check would be self-referential.
- `seal_hash.py` scope, the dispatch/pending-dir protocol, red-to-park
  semantics, and the four collect cases' responses.
- Existing vault seals and the `evals/fixtures` seals stay valid: no new
  required manifest field, no hash-scope change, old `--baseline` flags
  still work.

## Rejected as unearned machinery (do not re-add in the plan)

- **`redProof` stamping** (runner records "this manifest was proven"):
  guards a divergence with zero field occurrences once the brief's
  invocation is `--manifest`.
- **Collect-time hash re-verification** (a `corrupt` case): vault
  corruption has never been observed; the gate already catches it.
- **`ranPattern`-vs-baseline-output advisory**: warns on legitimate
  success-only patterns — noise in a channel we are trying to quiet.

## Acceptance: suite

Engine/skill/script work — the committed suite is the verification.

- `tests/test_run_acceptance.py`: `--manifest` baseline path proves RED
  reading draft fields; both `MANIFEST_INCOHERENT` rejections; mutual
  exclusion with `--run`/`--bootstrap`; flags path unchanged; end-to-end: a
  non-pytest seal authored manifest-first certifies at the gate (the case
  that false-redded in the field); legacy-seal diagnosis message.
- `tests/test_collect_seal.py` (new): all four cases against a tmp vault;
  `acceptanceLine` exact format uses `suiteSha256`, never `specSha256`.
- `tests/test_async_sealing.py`: collect-step pins updated to name
  `collect_seal.py`; existing dispatch pins (`specSha256`,
  `shasum -a 256`) stay green.
- Brief pins (`tests/test_seal_author_agent.py` or sibling): field list
  includes `framework`/`ranPattern`; rider tokens present;
  `--manifest` invocation named.
- No harness JS is touched; the `.mjs` sim gate does not arm.

## Complexity accounting

Added: one small script, one flag, one error status. Deleted: the collect
step's hand-executed vault-scan prose and the hand-carried hash; one
remembered conditional becomes enforced. Ratchet surfaces: `gateChecks`
unchanged (the new status is baseline-mode); ultraplan SKILL.md collect
prose shrinks or holds level.
