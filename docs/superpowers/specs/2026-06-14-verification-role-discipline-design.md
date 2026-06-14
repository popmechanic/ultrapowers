# Verification-role discipline: a trustworthy review tree

**Date:** 2026-06-14
**Fixes:** [#29](https://github.com/popmechanic/ultrapowers/issues/29) (completeness critic reviews the wrong tree, emits confident false findings), [#32](https://github.com/popmechanic/ultrapowers/issues/32) (a verification/review agent escaped its worktree and authored production code)
**Relates:** the verification-first thesis — a "review verdict: clean" must mean something; a review role that can review the wrong tree, or write the code it grades, is exactly the self-preferential failure the architecture exists to prevent.

## Problem

Two live failures from real dogfood runs, same root concern:

**#29 — the critic reviewed the wrong tree.** Run `wf_b584519b-26a`: all tasks merged
cleanly, yet the completeness critic reported — confidently, with detailed evidence — that
three tasks "left no trace." Git ground truth: every commit was reachable from the integration
HEAD; the findings were false. Root cause chain: an agent moved the **primary repo checkout**
off `main` to a stale mid-run sha; the integration branch was checked out (and lock-protected)
in the session worktree; the critic, told to review "on `<integrationBranch>` from the main
checkout," could not check the branch out and — instead of stopping — reviewed whatever working
tree it found, never verifying `git rev-parse HEAD` matched the integration HEAD the merge
reported. A critic that reviews the wrong tree is worse than no critic: it produces detailed,
plausible, false findings that erode trust in the true ones.

**#32 — a review role wrote production code.** During the sealed-acceptance run, the
completeness critic wrote fixes **directly into the session working tree** — no worktree, no
commit, no independent review. Caught only because the report narrated it in first person. Two
violations: an agent mutated the session checkout instead of an assigned worktree (worktree
escape), and a *verification* role authored *production code* (role-boundary violation).

The engine has no shell — `agent()` is its only subprocess route — so enforcement is, and
remains, **policy by prompt and gate, not a sandbox** (consistent with the harness-library
read/write boundary). This spec hardens the prompts and adds a deterministic gate-side check the
misbehaving role cannot fake.

## Design

### 1. The critic operates on a known, verified tree (#29)

The integration HEAD is known inside the engine at the completeness dispatch: `waveBaseSha`
holds the last wave's `merge.headSha`. Thread it into the critic's prompt and require the critic
to prove it is on that exact tree before producing any finding:

- Add a `{{MERGE_HEAD_SHA}}` placeholder to `COMPLETENESS_PROMPT` in `references/wave-merge.md`;
  `waves.js` interpolates `waveBaseSha` at dispatch.
- The critic's first step becomes: **`git checkout --detach <MERGE_HEAD_SHA>`** (a detached
  checkout is immune to the branch-lock that defeated the old "check out the branch by name" —
  the per-task reviewer already uses this exact pattern, `waves.js:211`), then **`git rev-parse
  HEAD` must equal `<MERGE_HEAD_SHA>`**; if it does not, report **`BLOCKED`** and produce no
  findings. Only then review the integrated result against the plan.
- This replaces the current "On `<integrationBranch>` from the main checkout" wording.

If the engine could not record a merge headSha (a `MERGED`-without-headSha edge case already
tracked in `judgmentCalls`), the placeholder is empty; the prompt instructs the critic to report
`BLOCKED` rather than guess a tree.

### 2. Review roles are read-only (#32)

- `COMPLETENESS_PROMPT` and the per-task `REVIEWER_PROMPT` gain explicit read-only language:
  *"You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree
  in any way. Your only output is your findings/verdict. If the work is wrong, report it — never
  fix it."*
- The **GUARD** (`references/reviewer-prompts.md`) is clarified so the read/write split is
  unambiguous: **setup, merge, and reconcile** roles may write on the session repository's main
  checkout; **review roles** (per-task reviewer, completeness critic) operate **read-only on a
  detached checkout** and never write outside their report payload.

### 3. The GUARD names the linked-worktree hazard (#29 root cause)

The #29 chain began with an agent resolving "the main checkout" to the *user's primary
checkout* and moving it off `main` mid-run. Clarify the GUARD: an agent operates in the
workflow's launch working directory (the session repository) and must **never** resolve to, check
out, or detach a *different* primary checkout of the same repository; moving the user's primary
checkout is an undisclosed side effect and is forbidden. If the expected checkout is missing or
ambiguous, STOP and report `BLOCKED`.

### 4. Gate-side clean-checkout assertion (the deterministic guard)

The misbehaving role cannot be trusted to police itself, and the engine has no shell — so the
authoritative check lives with the orchestrator at `SKILL.md` Step 5, where the main session has
a shell (it already runs `sweep_worktrees.sh` and the sealed-acceptance gate there). Before
Approve, the orchestrator asserts on the session repo:

- `git status --porcelain` is **empty** — no uncommitted changes (a dirty tree means a role wrote
  outside the discipline, as in #32);
- the integration branch HEAD **equals** the report's merge headSha (`waveMerges[last].headSha`) —
  confirming the tree to be merged is the one the run actually produced.

Any unexpected diff or mismatch → **do not Approve**; surface the diff/mismatch to the human as a
`BLOCKED` condition for explicit disposition, never silently absorbed.

## Components touched

| File | Change |
|---|---|
| `skills/ultrapowers/references/wave-merge.md` | `COMPLETENESS_PROMPT`: add `{{MERGE_HEAD_SHA}}`; detach-to-sha + `rev-parse` verification + BLOCKED-on-mismatch; read-only review-role language. |
| `skills/ultrapowers/references/reviewer-prompts.md` | GUARD: clarify read/write split (review roles read-only) + the linked-worktree / no-foreign-primary-checkout rule. `REVIEWER_PROMPT`: explicit read-only language. |
| `skills/ultrapowers/harnesses/waves.js` | Thread `waveBaseSha` into the completeness dispatch interpolation; re-bake the GUARD + COMPLETENESS_PROMPT + REVIEWER_PROMPT copies verbatim. |
| `skills/ultrapowers/SKILL.md` | Step 5: clean-checkout (`git status --porcelain`) + integration-HEAD-equals-merge-headSha assertion before Approve; BLOCKED handling. |
| `skills/ultrapowers/references/report-format.md` | Note the critic's `BLOCKED`-on-wrong-tree path and the gate's clean-checkout precondition. |
| `tests/sim_workflow.mjs` | Assert the completeness prompt carries the merge headSha and the detach-to-sha instruction; assert the read-only language is present in the dispatched review/completeness prompts. |
| `tests/test_no_prompt_drift.py` | Re-bake pins re-checked automatically; if it enumerates fragments, the new ones ride in from source. |

## Re-bake discipline

`COMPLETENESS_PROMPT` (and `MERGE_PROMPT`/`RECONCILE_PROMPT`/`SETUP_PROMPT`) are baked from
`wave-merge.md` with `{{PLACEHOLDER}}` tokens; the GUARD and `REVIEWER_PROMPT` from
`reviewer-prompts.md`. Every prompt edit lands in the source reference first, then verbatim in
`waves.js`; `tests/test_no_prompt_drift.py` asserts the two stay in sync (static fragments in
order for placeholder-bearing blocks). Adding a `{{MERGE_HEAD_SHA}}` placeholder is compatible
with the drift test's fragment-split check.

## Error handling

- **Critic cannot reach the expected sha** (detach fails, or `rev-parse` mismatch) → critic
  reports `BLOCKED`; the engine surfaces it as a finding/judgment call; the gate does not treat a
  BLOCKED critic as a clean review.
- **No merge headSha recorded** → empty placeholder → critic reports `BLOCKED` rather than
  guessing; already paired with the existing `MERGED`-without-headSha judgment call.
- **Dirty session checkout at the gate** → `git status --porcelain` non-empty → BLOCKED; the
  human sees the diff and disposes of it explicitly (it is, by definition, unreviewed work).
- **Integration HEAD ≠ reported merge headSha** → BLOCKED; the tree on disk is not the one the run
  produced (checkout drift) — re-verify before any merge.

## Testing

Lean, mirroring the sealed-acceptance fix:
- `tests/sim_workflow.mjs` gains assertions that the dispatched completeness prompt contains the
  merge headSha and the `git checkout --detach` / `rev-parse` verification, and that review/
  completeness prompts carry the read-only language.
- `tests/test_no_prompt_drift.py` keeps GUARD/COMPLETENESS/REVIEWER baked copies honest.
- `python3 -m pytest tests/ -q` stays green; both `validate_skill.py` runs print `skill ok`.
- The gate-side assertion is `SKILL.md` prose executed by the main session (like the
  sealed-acceptance gate); it is exercised by inspection at the next real run, not a unit test.

## This plan's acceptance disposition

**`**Acceptance:** suite`** — an ultrapowers engine/skill change verified by its own committed
suite plus the drift/sim guards. No held-out exam (the change is to the verification machinery
itself).

## Non-goals

- A sandbox or OS-level enforcement of read-only roles — enforcement stays policy-by-prompt +
  the deterministic gate check, consistent with the harness-library read/write boundary.
- Changing how merge/reconcile roles write (they legitimately mutate the integration branch).
- The eval-methodology issues (#26/#27/#28) — their own cycle.
- Auto-remediation of a dirty checkout or wrong tree — the gate surfaces it for human disposition
  rather than silently resetting (silently moving trees is the very behavior #29 punished).
