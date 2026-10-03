<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. Commands here name the
     plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

## Authoring a queue

A sitting's queue of well-defined issues drains by partitioning it by files into
disjoint bundles, and it must partition by `Create:` paths as well as by files: two
plans that would touch one file go in one bundle, since same-file edits merge inside
one run and never across two PRs, and two plans that would create one path go in
one bundle, or the second declares `Consumes:` on the first and launches after it
(the 2026-09-17 drain serialized #1095 and #1096 by hand after both listed `Create:
fleet/jev-client.mjs`). Dispatch one author subagent per bundle — each loads this
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
