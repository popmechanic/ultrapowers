# §5-relaxation shakedown — first real run under the fold default — 2026-08-14

**Verdict: shakedown accepted (evidence, not a gate). Release proceeds.**
Run `20260814-101750`, plan `docs/superpowers/plans/2026-08-14-residuals-shakedown.md`
(the #123/#95 residuals docket), engine `6ff7921`, merged to main `31c43ad`
(940 tests green on the integrated tree, re-verified post-merge).

**Grading provenance:** operator-delegated session (same standing delegation
as the T15 grading — recorded in `2026-08-14-t15-ab.md`); the gate's three
deferred acks were consumed under that delegation with the
`standing-approval.json` sidecar written first.

## What the shakedown was for, and what it read

The plan was authored under the relaxed rule: tasks 2 and 3 independently
`Modify` `tests/sim_workflow.mjs` with no ordering marker — the exact shape
the pre-§5 authoring doctrine would have contorted away. The run was driven
headless with **no `overlap=` token**, so the flagless compiler default (the
flipped `fold`) is what executed, via a fresh session config carrying the
repo-checkout engine (the installed plugin still lags the flip; saved
workflows register at session start).

**Canary first reading:**

- **Default flip works end-to-end on a real plan.** Flagless invocation
  compiled in fold mode; preflight, launch, waves, reviews, merges, gate,
  and the suite-gate acceptance all green. Zero fix iterations across all
  five tasks; zero fallbacks; zero redirect rounds.
- **The eligibility guard fired, correctly and legibly.** The plan's only
  contended pair sits on a 2,910-line file — over `RESOLVER_LINE_CAP`
  (400) — so the pre-filter kept the 2→3 write-after-write edge and the run
  executed as `[[1,2,4,5],[3]]`. The reason is recorded exactly where the
  design says it should be: a `kind: "inference"` `marker_conflicts` entry,
  "over RESOLVER_LINE_CAP (2910 > 400 lines) — pairs kept serialized". This
  is the priced behavior, not a defect: the relaxation is not a blank check,
  and oversized files still serialize with a named reason.
- **Honest caveat: no frontier records were produced by this run**, because
  the guard (correctly) prevented the contended wave. The fold path's live
  evidence remains T15's counted cell (full engine protocol, 0.640× wall,
  5/5 resolutions clean, fold-CLI wall time 0.805s). Real-repo fold readings
  transfer to the standing fold-canary watch-item
  (`skills/ultralearn/references/reading-lenses.md`) rather than this
  shakedown — the next real plan whose contended pair sits under the line
  cap produces them.

## What the shakedown caught

- **Stale default-wording in four engine docs** (SKILL.md Step 1,
  `dependency-analysis.md` ×2, `report-format.md`, `wave-merge.md`): all
  still described `serialize` as the shipped default post-flip. Fixed in the
  release-adjacent docs commit. This is exactly the class of drift a
  shakedown exists to catch — the flip commit updated code and pins but not
  every prose mirror.
- **An observation for the line-cap conversation:** the first real contended
  pair the relaxed rule met was a test harness file (2.9k lines) — large
  shared *test* files may be the common real-world contention surface, and
  they will keep serializing under the current cap. Noted for ultralearn
  sensing; no design action from n=1.

## #95 live-run verification obligations (from the issue's checklist)

- [x] End-to-end review exhaust landed in `<runDir>/review/` during a real
  Workflow run (packets observed by reviewers; deleted at the gate per
  Step 5, with the deletion itself observed live).
- [x] SKILL.md Step-5 gate-step exhaust deletion with real exhaust present.
- [ ] A live salvage/redirect relaunch carrying the mandatory keys — no
  salvage occurred in this run; survives by name.

## Run accounting

Five tasks, five clean reviews, two waves, one fix-free pass; gate
NEEDS_ACK (three deferred acks — two `runtime`, one `manual`, all recorded
in the run's `standing-approval.json`); acceptance disposition `suite`,
exit 0. Worktrees swept (5 removed), lock released, integration branch
fast-forward-merged to main and deleted.
