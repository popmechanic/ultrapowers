<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. Commands here name the
     plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

## Authoring a queue

A sitting's queue of well-defined issues drains by cutting it into bundles an author
can hold, one author per bundle. Plans may share files. Same-file edits from two runs
meet on main's stored weave (`flock.main.mode = peer`): a live run takes a moved main
in like a builder's work, and a run that finished before main moved catches up to it
and merges (flock-baseline runs 16–21, n=6 runs, 2026-11-13: five ready, one draft;
an experiment on one fixture, whose rollback is cutting the queue by files again).
Two plans that each create a file at one path may launch apart too: the run that meets
the other's file opens a conflict and a builder makes one file of the two
(`flock.main.created = conflict`; flock-baseline run-24, n=1 run, 2026-11-13, merged
ready; an experiment, whose rollback is putting two such plans in one bundle again, as
the 2026-09-17 drain did by hand for #1095 and #1096). A run that had already settled
when the other file reached main ends a draft. One thing still shapes the cut:

- **Two issues that contradict on the same lines go in one bundle**, so one plan decides.
  A run whose builder must delete a line another plan put on main ends a draft for the
  operator, never a ready pull request (run 17; operator's pick, 2026-11-12).

Dispatch one author subagent per bundle — each loads this
skill, pins its own launch base, dispatches its own fresh gate readers per task,
writing each diet to `<issue>-gate-<t>.json` so the filename carries the plan's
own issue prefix and two authors' readers never collide on the scratchpad (six
authors once collided on bare `gate-<t>.json` names, and author-1096's round-2
readers read a sibling's diet for tasks 2–4, discarding three verdicts), and
compiles to `PLAN OK`. The issue's desired-state sentence is the plan's Claim,
quoted rather than drafted, exactly as the elicitation path in SKILL.md has it.
Grill an issue only when its ticket carries the `wayfinder:grilling` label; an undecided
choice found mid-authoring comes back as a question, not as a guess.

Hold the operator to one Claim confirmation and one execute choice per plan — an explain
round is part of the same touch, not a third — each asked with AskUserQuestion. Launches stay serial: N plans are N launches back to back, because
concurrent launches race on the run number (#667). The clock census (n=3 runs, runs
10–12, 2026-09-05) found authoring throughput, not the sandbox, was the first bound on
how many runs could be live at once — a queue authored in parallel is what lifts it.
