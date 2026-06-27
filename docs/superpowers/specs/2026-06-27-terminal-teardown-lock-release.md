# Spec: terminal teardown — release the run lock on every gate exit, not only Approve

**Date:** 2026-06-27 · **Status:** proposed · **Acceptance:** suite
**Backlog item:** P5 (from `2026-06-27-backlog-handoff.md`) · **Surface:**
`skills/ultrapowers/SKILL.md` (Step 5/6) + `scripts/run_lock.sh` + `scripts/sweep_worktrees.sh`

## 1. Problem (grounded against 0.0.24)

The handoff framed P5 as *"sweep runs only on the Approve path; abort/redirect/fail
leaves [worktree] debris."* Grounding the actual gate flow refines the finding — and
moves the real bug from the worktrees to **the run lock**:

- **The lock is the wedge.** `run_lock.sh acquire <runId>` runs at Step 4b
  (`SKILL.md:311`); `run_lock.sh release <runId>` runs at **exactly one** place —
  the Approve path (`SKILL.md:422`). `run_lock.sh` itself has **no staleness or
  timeout** (it is a single `.claude/ultrapowers/RUN_LOCK` file holding the runId).
  So any terminal gate exit that is **not Approve** leaves the lock held forever, and
  the next `/ultrapowers` in that repo hits `acquire` → *"RUN_LOCK held by … another
  run is live"* → refused. The operator must manually delete the file to recover.
- **Which exits are affected.** Tracing every Step-5/6 terminal disposition:
  - *Approve* — releases the lock + sweeps. ✔ (the only clean teardown today)
  - *Redirect / Salvage* — **not terminal**: they relaunch with `resume: true` on the
    same `integrationBranch` and return to the gate. Correctly hold the lock.
  - *BLOCKED* (clean-tree fail, sha mismatch, `gitVerified` false, non-empty
    `missingDeliverables`, merge-sha guard unavailable; `SKILL.md:391,395–399`) — the
    checkout is restored, but the lock is **never** released. If the operator triages
    and then declines to Approve, the lock stays held.
  - *Abort* (`SKILL.md:462–463`) — only a Step-2 dependency cycle (pre-worktree,
    pre-lock) or an integration-branch-creation failure. Minimal debris; but if the
    lock was acquired with a provisional id (Step 4b allows this) it can still leak.
  - *Operator walks away* from a finished-but-not-approved run — lock held.

- **Worktrees are NOT the same problem.** On BLOCKED/failed exits the worktrees and
  unmerged branches are **deliberately kept for triage** (`SKILL.md:425` keeps
  unmerged branches even on Approve; `--force` to remove). The naive "sweep on all
  terminal paths" would *destroy the evidence the operator needs to triage*. So the
  fix must **not** auto-sweep worktrees on the non-Approve paths.

## 2. The asymmetry, named

| Resource | What it is | Correct lifetime |
|---|---|---|
| `RUN_LOCK` | concurrency control — prevents a second run corrupting this run's checkout | released on **every** terminal exit; it must never outlive the run |
| worktrees / unmerged branches | the run's work product + triage evidence | kept until the operator is done inspecting; swept on Approve, or manually after triage |

The bug is that today both are tied to the single Approve exit. They have different
correct lifetimes. The lock is teardown; the worktrees are evidence.

## 3. Design — one teardown concept, reached on every terminal exit

Make lock-release a **terminal-teardown step the orchestrator reaches on every gate
exit that is not a relaunch**, rather than a side effect bolted onto Approve. This is
the G1 consolidation lens applied: one teardown rule, not N scattered sweep guards.

1. **Always release the lock on a terminal exit.** Approve already does. Add the same
   `run_lock.sh release <runId>` to the decline / abort / abandoned-BLOCKED paths. The
   lock is idempotent and id-scoped (`release` no-ops on a mismatch), so this is safe
   even if a concurrent run replaced the lock.
2. **Do NOT auto-sweep worktrees on non-Approve exits.** Instead, at those exits point
   the operator at the deterministic cleanup so debris is *discoverable*, not silent:
   *"the run's worktrees are kept for inspection; when you are done, run
   `sweep_worktrees.sh --run <runId>` to remove them."* This preserves triage evidence
   while closing the "silent debris" gap.
3. **No script change required.** `run_lock.sh release` and `sweep_worktrees.sh --run`
   already exist and are id-scoped. P5 is an operator-contract (SKILL.md prose) change,
   not new mechanism.

### Complexity accounting (G1)

| | Naive "sweep everywhere" | This design |
|---|---|---|
| New mechanism | possibly a session-end hook / new script | **0** (reuse `release` + `--run`) |
| Triage evidence on BLOCKED | **destroyed** | preserved |
| Standing concepts | N sweep call-sites | **1** teardown rule (release lock; point at sweep) |
| Risk surface | aggressive auto-deletion on the error paths | additive, idempotent, id-scoped |

Complexity-neutral and strictly safer than the handoff's naive framing.

## 4. Surfaces touched

- `skills/ultrapowers/SKILL.md` — Step 5 dispositions (Approve unchanged; add a
  **Terminal teardown** note covering decline / abort / abandoned-BLOCKED: release the
  lock, and point at `sweep_worktrees.sh --run <runId>` for the kept worktrees) and the
  Step-6 fallback exit. Keep the "worktrees kept for triage" rationale explicit so a
  future reader does not "helpfully" add an auto-sweep.
- *(Optional)* a pin test (e.g. extend an existing SKILL.md-content test) asserting the
  non-Approve exits name `run_lock.sh release` — only if it can be expressed without
  brittle prose-matching; otherwise omit (the suite gate covers the rest).

No change to `run_lock.sh`, `sweep_worktrees.sh`, or `waves.js`.

## 5. Acceptance

`**Acceptance:** suite` — the committed `pytest` gate. This is a doc/operator-contract
change with no new runtime mechanism; the existing suite (incl. any SKILL.md-content
pin added in §4) is the verification. No held-out / sealed exam.

## 6. Out of scope

- Lock staleness/timeout (a TTL on `RUN_LOCK`). Considered and **deferred**: the
  id-scoped `acquire` refusal already tells the operator exactly which run holds the
  lock, and a TTL risks a still-live long run being stolen. Revisit only if abandoned
  locks recur after this fix. (Tracks alongside the `.git/ultra` scratch fragility,
  issue #67.)
- Any automatic worktree deletion on the error paths (rejected in §3.2 — destroys
  triage evidence).
