# Snapshot/restore family retirement (issue #104)

_The deletion-led cycle's second half. An architectural subtraction through
the frozen periphery via the subtraction-eval route (operator decision,
2026-08-09: eval route, n=1)._

## Problem

The snapshot/restore family exists to protect the session checkout from the
engine. Since #84 (integration in a dedicated worktree, 0.1.14) the engine
never touches the session checkout, and the field record is now conclusive:
five clean waves runs plus resume relaunches (2026-08-07 drain) with the
restore a no-op every time, and one uncontrolled machine crash recovered with
zero loss from git-durable state alone — the family did no work even in the
disaster case it was designed for. Worse than useless: the family's one
recorded *action* was destructive — the 0.0.35 snapshot-restore incident
wiped an operator's uncommitted edit (the only data destruction in the
ledger's history caused by the engine itself). The fail-safe is the only
member of this family that ever destroyed anything (trim review F3).

What remains is a standing tax with a hard coupling: `ultra_run.py` (unfrozen)
records the snapshot at preflight; frozen `run_lock.sh restore` **errors when
no snapshot exists**; frozen `ultra_gate.py:172` runs the restore first and
turns any failure into BLOCKED. The unfrozen half is therefore not deletable
alone — this subtraction goes through the frozen periphery or not at all.

## Design

**Delete the family end to end:**

1. `run_lock.sh`: remove the `snapshot` and `restore` subcommands (and the
   `CHECKOUT_SNAPSHOT` file concept). Usage line updated. The #68
   restore-landing guard is deleted with it — it guarded restore's landing;
   with nothing restoring, the guarded event no longer exists (noted, not
   hidden: the docket's #68 entry stays `verified`, its defect class retired
   by subtraction rather than by guard).
2. `ultra_gate.py`: remove the restore call (lines ~170–174). The gate's
   first act becomes what follows it today.
3. **The dirty-baseline survives with a new writer (trim review F1, branch
   a).** `gate_check.py`'s clean-tree check reads its new-vs-preexisting
   baseline from `.claude/ultrapowers/DIRTY_SNAPSHOT`, whose only writer
   today is the deleted `snapshot` subcommand. `ultra_run.py`'s preflight
   writes `DIRTY_SNAPSHOT` directly (one `git status --porcelain`
   redirect, replacing the deleted stage's call) so the
   pre-existing-operator-dirt workflow keeps passing with a note — the
   0.0.35 incident population launches over dirt; converting that to
   false-BLOCKED is not acceptable collateral. `gate_check.py` stays
   genuinely byte-identical AND behavior-identical (F2 resolved). The
   `DIRTY_SNAPSHOT` concept is *relocated*, not added; `CHECKOUT_SNAPSHOT`
   (the checkout-position half) dies with the family.
4. `ultra_run.py`: the `snapshot` stage becomes the direct `DIRTY_SNAPSHOT`
   write (stage renamed accordingly in the receipt — no branch/HEAD
   recording remains). `run_lock.sh acquire/check/release` (the lock proper)
   is untouched — the lock is not the family.
5. Tests: `tests/test_run_lock_snapshot.py` deleted; snapshot/restore
   entries in `tests/test_run_lock.py` removed; the pre-existing-dirt pass
   tests in `tests/test_gate_check.py` (and the `tests/test_ultra_gate.py`
   setup) re-plumbed from `run_lock.sh snapshot` to the new writer — those
   tests SURVIVE, they pin the workflow F1 protects. New pins: the gate
   proceeding without a restore step; the driver-written `DIRTY_SNAPSHOT`
   feeding gate_check's partition.
6. Docs, full inventory (F7): SKILL.md's restore paragraph (~195–200) and
   the preflight stage list entry ("checkout snapshot"); and
   `references/design-rationale.md` §Step 5's why-skipping-restore-is-
   dangerous rationale is **rewritten** to the post-#84 rationale (ref-based
   gate + worktree suite-gate), not scrubbed — left as-is it argues against
   the shipped design.

**Nothing is added.** No flag, no compat shim, no conditional path. The one
relocation (`DIRTY_SNAPSHOT` writer) replaces a deleted call site.

**Residual case owned (F3):** the gate's verdict is checkout-position-
independent post-#84 — head-match resolves branch refs, and the suite-gate
runs in a fresh detached worktree — so an operator who moves the session
checkout mid-run cannot corrupt the verdict, and after this deletion the
engine no longer teleports them back. That is a feature, not a regression:
the 0.0.35 incident is exactly the restore acting on a checkout the operator
had deliberately moved.

## The eval gate (what unfreezes the periphery)

Per subtraction-eval doctrine (0.1.0 precedent): mechanics are the hard gate,
quality/cost advisory, n=1.

- **Cells:** one A/B pair on an `evals/fixtures/` plan — engine A = current
  main, engine B = the deletion branch — driven headlessly by
  `evals/ab_runner.py` (pinned-engine worktrees; #107's throwaway
  `CLAUDE_CONFIG_DIR` isolation). **Before each launch the cell runner
  seeds pre-existing dirt into the cloned workdir** (an untracked file +
  a tracked-file edit) so the F1 seam — launch over operator dirt — is
  actually exercised, not just survived on a clean fixture (F4).
- **Mechanics hard-gate (all must hold on B), each measured post-hoc by the
  cell runner from preserved workdir artifacts and recorded in the results
  doc (F4/F5)** — the workdir is kept until the results doc is written:
  1. the run completes and the gate reaches a non-crash verdict;
  2. `gateCheck.checks[]` in B's gate receipt is set-**identical** to A's
     (the restore is upstream of gate_check, not a check — the sets must
     match exactly), and the clean-tree check's verdict-relevant behavior
     matches (pre-existing dirt passes with a note on BOTH engines);
  3. the session workdir's branch name and HEAD sha are **equal** before
     launch and after the gate (recorded by `git rev-parse` at both ends —
     the property the family claimed to protect, measured);
  4. no stage in B's receipts errors on a missing snapshot.
- **Advisory:** token totals and wall clock recorded, not gated.
- A/B parity failure on the mechanics ⇒ the deletion does not land and this
  spec is void — the freeze held for a reason.

## Surfaces

`skills/ultrapowers/scripts/run_lock.sh`, `skills/ultrapowers/scripts/ultra_gate.py`,
`skills/ultrapowers/scripts/ultra_run.py`, `tests/`, `skills/ultrapowers/SKILL.md`
(+ touched references). `gate_check.py` and `run_acceptance.sh` byte-identical.

## Acceptance

Suite — plus the eval pair's mechanics hard-gate recorded in the results doc
(`evals/`), which is the unfreeze instrument, not an optional extra.
canaryMetric: post-release sense passes must show zero checkout-drift
incidents at `engineVersion ≥` the adopting release (the family's absence
must stay invisible).

## Complexity accounting

`complexityEffect: simplification`. Deletes: two script subcommands, the
`CHECKOUT_SNAPSHOT` concept, one frozen restore call, the snapshot preflight
stage's branch/HEAD recording, one test file plus scattered entries, the #68
restore guard, and the SKILL/reference prose describing all of it. Adds:
nothing shipped (eval cells are run artifacts); one concept relocated
(`DIRTY_SNAPSHOT` writer moves into the driver).

## Trim review

_Author disclosure: Adds = nothing shipped (eval cells are run artifacts);
Removes = the snapshot/restore family end to end._

Reviewer (fresh-context, code-grounded) returned 9 findings. Adjudication:

- **F1 (critical: DIRTY_SNAPSHOT's only writer deleted; strict-fallback
  false-BLOCKED on operator dirt; eval blind to it) — ADOPTED, branch (a).**
  §3 added: the driver writes the dirty baseline directly; the
  pre-existing-dirt workflow keeps passing with a note. The eval seeds dirt
  so the seam is exercised.
- **F2 (byte-identical pledge incompatible) — RESOLVED by F1(a).**
  `gate_check.py` stays byte- and behavior-identical with a named writer.
- **F3 (mid-run operator-drift residual unowned; 0.0.35 incident omitted) —
  ADOPTED.** Residual-case paragraph added; the incident now leads the
  Problem section.
- **F4 (eval measurements not implementable as written) — ADOPTED.** Each
  criterion now names its measurer (cell runner, post-hoc, from preserved
  artifacts) and its recording place; workdir retention required; "equal"
  replaces "byte-identical".
- **F5 (restore miscategorized as a gateCheck check) — ADOPTED.** Check
  sets must be identical; clean-tree parity is verdict-relevant behavior.
- **F6 (restore deletion inventory complete) — OK.**
- **F7 (doc surface understated; design-rationale needs rewrite not scrub) —
  ADOPTED.** §6 carries the full inventory.
- **F8 (delete gate_check's baseline partition too, strict any-dirt-blocks) —
  DECLINED.** The launch-over-dirt workflow is real (the 0.0.35 population);
  keeping new-since-launch semantics preserves it at the cost of one
  relocated concept, and F8 would additionally break the byte-identical
  pledge on a second frozen file. Rejection visible per the adopt-or-answer
  rule.
- **F9 (scope reconciled; DIRTY_SNAPSHOT was the one shortfall) — ADOPTED**
  via F1(a).

**Reviewer's `netConceptDelta` grade: down** (≈six concepts retired, zero
added, one relocated), conditional on F1 being resolved explicitly — which
§3 now does. The reviewer's sharpest observation stands as the record: as
originally written, the eval would have passed B while shipping a field
regression — "the one way a down grade here could be bought dishonestly."
