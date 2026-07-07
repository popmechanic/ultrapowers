# Seal at spec-approval (async, content-addressed)

**Date:** 2026-07-07 · **Disposition:** suite · **Status:** spec approved — plan to follow · **Issue:** #93

## Problem

Sealing runs at plan approval and blocks the operator for the acceptance
author's full wall time — 10–30 minutes per the ledger, the single largest
synchronous wait in the interactive planning conversation. PR #92 made that
cost deliberate (effort pinned in `agents/seal-author.md`); this feature moves
it off the human critical path. Every input the author needs — spec text, test
conventions, base branch, vault path — exists at spec approval, before the
plan is written. Rigor is untouched: #93 changes *when* the cost is paid,
never how much rigor is bought.

## Design

### Dispatch — at ultraplan invocation

Spec approval and ultraplan invocation are the same wall-clock moment:
brainstorming's terminal state is invoking writing-plans, and the routing rule
loads ultraplan alongside it. So ultraplan owns the dispatch — no hook change,
no new trigger surface.

When ultraplan is invoked, **before drawing tasks**:

1. Decide the Acceptance disposition first, by the existing rule of thumb
   (building software *with* ultrapowers → `sealed`; building ultrapowers
   itself → `suite`). Only a clear `sealed` front-runs; `suite`, `waived`, and
   ambiguous cases skip dispatch — the collect-time fallback covers them.
2. Compute `specSha256` — the sha256 of the approved spec file's content.
3. Dedup against the vault (`~/.ultrapowers/acceptance/`): an existing sealed
   dir whose `manifest.specSha256` matches, a `pending-<specSha12>/outcome.json`
   failure record, or an in-flight pending dir with a live background task
   means this spec is already handled — skip.
4. Otherwise create the per-dispatch pending dir `<vault>/pending-<specSha12>/`
   and write the dispatch receipt `<pendingDir>/dispatch.json` —
   `{specPath, specSha256, dispatchedAt}` — so every pending dir carries its
   origin from birth (crashed-dispatch detection and superseded-spec cleanup
   read the receipt, never guess). Then dispatch `ultrapowers:seal-author`
   **in the background** with the standard brief plus the two dispatch
   inputs: `specSha256` and `<pendingDir>`. Plan authoring proceeds in the
   foreground while the author works.

Keying the pending dir by spec hash makes the two-seals race inexpressible:
different specs get different dirs, and an identical spec is caught by the
dedup check before a second dispatch exists.

### Author brief changes

`skills/ultraplan/references/seal-author-prompt.md` stays the single source;
`agents/seal-author.md` stays a thin pointer with its pinned frontmatter
(`effort: high`, no `model:` key) untouched. Changes to the brief:

- The hard-coded `<vault>/pending/` becomes the passed `<pendingDir>`; the
  success path still renames it to `<vault>/<first-12-hex-of-suite-hash>`.
- `manifest.json` gains `specSha256` (additive — `run_acceptance.sh` reads
  named fields only).
- On GREEN_AT_BASELINE, or an EXAM_BOOTSTRAP_ERROR the author cannot fix, it
  writes `<pendingDir>/outcome.json` — `{status, specSha256, evidence (≤2000
  chars), createdAt}` — and leaves the pending dir in place as the durable
  failure record. Failures must never exist only in a returned message.
- The returned report is unchanged: sealId, suiteSha256, redEvidence,
  coverage summary (or the failure report).

The input-list wording in the brief header and `agents/seal-author.md` grows
from four inputs to six (adding spec hash and pending dir). Plan-blindness
becomes structural: at dispatch time the plan does not exist.

### Collect — at plan approval

The ultraplan sealing step becomes a collect step. Hash the spec file as
approved; first match wins:

1. **Sealed dir with matching `specSha256`** → append the
   `**Acceptance:** sealed <seal-id> (sha256:<hash>)` line plus the coverage
   appendix, and present the vouching rubric. Zero wait.
2. **`outcome.json` present** → surface the failure **now**, at plan approval,
   never silently after: GREEN_AT_BASELINE counts as attempt #1 toward the
   existing two-consecutive-greens stop rule ("the spec may describe behavior
   that already exists"); EXAM_BOOTSTRAP_ERROR surfaces with its evidence
   before any re-dispatch.
3. **Background author still running** → tell the operator and wait. The
   residual wait is bounded above by today's synchronous cost, minus the time
   already elapsed.
4. **No record for this hash** → dispatch synchronously — exactly today's
   flow, never worse than the status quo. A spec edited after dispatch lands
   here *by construction* (the stale hash can never match); before
   re-dispatching, remove superseded `pending-*` dirs whose `dispatch.json`
   names this spec path, so discarded work does not accumulate.

A pending dir with no `outcome.json` and no live background task (its
`dispatch.json` is from a prior session) is a crashed dispatch: treat as
never-dispatched — remove the dir, fall through to case 4.

### ultradocket — zero edits

The sweep invokes writing-plans + ultraplan per entry (step 3), so it inherits
front-running automatically at each entry's spec-approval boundary. Its
sealing-failure semantics — entry stays `planned`, retried next sweep — are
unchanged; the sweep simply pays less wall time per sealed iteration.

### What does not change

- Rigor knobs: effort pin, most-capable tier at dispatch, the brief's RED-proof
  discipline through the exact gate runner.
- The pre-merge gate: `run_acceptance.sh <seal-id> <branch> <sha256>` exit-code
  authority, untouched.
- Base branch advancing between dispatch and collect adds no new risk: the
  synchronous flow already seals long before execution finishes, `baselineSha`
  is recorded in the manifest, and the gate re-administers the exam at merge.
- The operator's waiver path (`**Acceptance:** waived — <reason>`) and the
  vouching rubric.

## Acceptance

Committed suite. One new drift-pin test file — this cycle's single additive
guard — pins the contract:

- The brief carries the per-dispatch `<pendingDir>` input and no hard-coded
  `<vault>/pending/suite` path.
- The brief's manifest field list includes `specSha256`.
- The brief carries the `outcome.json` durable-failure instruction.
- ultraplan's SKILL.md carries the dispatch-at-invocation, dispatch-receipt
  (`dispatch.json`), collect-at-plan-approval, failure-surfaced-at-plan-
  approval, and synchronous-fallback contract tokens.

`tests/test_seal_author_agent.py` stays green: both dispatch texts keep the
`ultrapowers:seal-author` agent-type token, and no new prose states an effort
value (the existing regex pin enforces this).

## Non-goals

- No change to how much the seal costs (that was #92) or to seal rigor.
- No cross-entry pipelining in the ultradocket sweep (sealing entry N while
  planning entry N+1) — machinery earned only if per-entry front-running
  proves insufficient.
- No new scripts: dispatch, dedup, and collect are skill-prose driven, using
  `shasum -a 256` and the existing `seal_hash.py` / `run_acceptance.sh`.
