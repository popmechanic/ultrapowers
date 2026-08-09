# Snapshot Family Retirement Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The snapshot/restore family is deleted end to end — `run_lock.sh` subcommands, `ultra_gate.py`'s restore-first act, the driver's branch/HEAD recording — with the dirty-baseline relocated to a direct driver write, per spec `docs/superpowers/specs/2026-08-09-snapshot-family-retirement-design.md` (issue #104; the deletion-led cycle's second half; frozen-periphery edits unfrozen ONLY by the Task 3 eval ceremony's mechanics hard-gate).

**Architecture:** Two disjoint implementation tasks (scripts+tests; docs) and one manual task (the subtraction-eval A/B ceremony that is this plan's merge condition). The trim-review-adjudicated spec is authoritative — especially §3 (the `DIRTY_SNAPSHOT` relocation) and the eval's dirt-seeding requirement.

**Tech Stack:** bash, Python 3 (stdlib), pytest, `evals/ab_runner.py`.

**Acceptance:** suite — plus the Task 3 eval pair's mechanics hard-gate recorded in `evals/`, which is the frozen-periphery unfreeze instrument; a mechanics parity failure voids the merge regardless of suite green.

## Global Constraints

- Files changed: `skills/ultrapowers/scripts/run_lock.sh`, `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/ultra_run.py`, `tests/`, `skills/ultrapowers/SKILL.md`, `skills/ultrapowers/references/design-rationale.md`, `evals/` (results doc only). `gate_check.py` and `run_acceptance.sh` **byte-identical** (`git diff` empty for both).
- Deletions are deletions: no flag, no compat shim, no conditional path. The one relocation: `ultra_run.py` writes `.claude/ultrapowers/DIRTY_SNAPSHOT` directly (spec §3) — the pre-existing-operator-dirt workflow MUST keep passing with a note (`tests/test_gate_check.py`'s dirt tests survive, re-plumbed, never deleted).
- The lock proper (`acquire/check/release`) is untouched.
- No new dependencies. Suite gate: `python3 -m pytest` green after every task.
- Merge condition: Task 3's four mechanics criteria all hold on engine B (spec §The eval gate). This is exit-condition authority, not narrative.

---

### Task 1: The deletion + the relocation (scripts + tests)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/run_lock.sh`
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `tests/test_run_lock.py`
- Modify: `tests/test_gate_check.py`
- Modify: `tests/test_ultra_gate.py`
- Modify: `tests/test_ultra_run.py`
- Modify: `tests/test_run_lock_snapshot.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `run_lock.sh` without `snapshot`/`restore` (usage line updated; `CHECKOUT_SNAPSHOT` and the #68 landing guard gone); `ultra_gate.py` gate mode starting at result-unwrap (restore call ~170–174 deleted); `ultra_run.py`'s snapshot stage replaced by a `dirty-baseline` stage that shell-writes `git status --porcelain` output to `.claude/ultrapowers/DIRTY_SNAPSHOT`.

TDD, spec §Design items 1–5 verbatim. `tests/test_run_lock_snapshot.py` is deleted in-task (the Files grammar has no Delete label; listing it as Modify claims the write-scope). Required pins (failing first): pre-existing dirt at launch still passes gate_check with a note (the surviving re-plumbed tests, now seeded via the driver's writer, not `run_lock.sh snapshot`); gate mode proceeds with no restore step and no snapshot file present (new pin — the old missing-snapshot BLOCKED path is gone); `run_lock.sh restore`/`snapshot` invocations now fail with the usage error (subcommands gone); `dirty-baseline` stage appears in the receipt and its file feeds gate_check's new-vs-preexisting partition; lock acquire/check/release untouched (existing tests green unmodified). Frozen-boundary check in-task: `git diff --stat main -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/run_acceptance.sh` prints nothing.

Commit: `feat(#104): retire the snapshot/restore family; dirty-baseline relocated to a direct driver write`

---

### Task 2: Docs — the full inventory, rationale rewritten not scrubbed

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/design-rationale.md`

**Interfaces:**
- Consumes: nothing from other tasks (spec §6 is the contract; file-disjoint from Task 1).
- Produces: nothing consumed by other tasks.

Spec §6 verbatim: SKILL.md's Step-5 restore paragraph (~195–200) deleted and its surrounding text reflowed to the post-deletion gate sequence; the Step-1 stage-list entry ("checkout snapshot") becomes the dirty-baseline stage; `references/design-rationale.md` §Step 5's why-skipping-restore-is-dangerous rationale **rewritten** to the post-#84 rationale (ref-resolved head-match + detached-worktree suite-gate make the verdict checkout-position-independent; the engine never moves the operator's checkout, and no longer moves it *back* either — cite the 0.0.35 incident as why that is the safe direction). Suite green (SKILL-adjacent pins included).

Commit: `docs(#104): retirement inventory — SKILL restore paragraph, stage list, design-rationale rewrite`

---

### Task 3: The subtraction-eval ceremony (merge condition)

**Type:** manual
**Depends-on:** 1
**Review:** lean

**Files:**
- Create: `evals/2026-08-09-snapshot-retirement-ab.md` (results doc)

**Interfaces:**
- Consumes: Task 1's branch as engine B; `main` as engine A; `evals/ab_runner.py` + an `evals/fixtures/` plan.
- Produces: the recorded mechanics hard-gate verdict that authorizes (or voids) the merge.

Administered by the orchestrator (not a subagent — it spawns headless `claude` runs). Per spec §The eval gate, exactly: seed pre-existing dirt into each cloned workdir before launch (one untracked file + one tracked-file edit); run the A cell then the B cell; keep both workdirs until the results doc is written; record in the results doc, per cell: launch/exit status, gate verdict, `gateCheck.checks[]` set (A vs B set-identical required), the clean-tree check's note on the seeded dirt (must pass-with-note on BOTH), `git rev-parse` branch+HEAD before launch and after gate (equal required, per workdir), a receipt-stage scan for any missing-snapshot error on B (none required), and advisory token/wall-clock totals. All four mechanics criteria hold ⇒ record UNFROZEN-BY-EVAL and merge proceeds; any failure ⇒ record the failure, the merge is void, the branch is kept for triage.
