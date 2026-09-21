# Ultrapowers — Report Format

**This file described the wave engine's structured report object — the JSON
schema `finalize_report.py` wrote and `ultra_gate.py --result`/`gate_check.py`
read, and the two-move `Approve` rule built on it — in detail until cut two
(2026-09-21). That engine, its report object, and the gate scripts that read
it left with it: `factory/engine.mjs` runs no equivalent single-object report
stage, writes no `workflow-result.json`, and calls neither `ultra_gate.py` nor
`gate_check.py`.**

What a run's progress and outcome look like today is `fleet/RUNBOOK.md`'s
**Watch.** list: `status.json`, `events.jsonl` and `engine.log`, committed by
`factory/boot.sh` to the run's evidence branch and tag. `status.json`'s
transitions (`booting` → `running` → `publishing` → `done`, or `parked` /
`failed`) are the run's own record of what happened; there is no separate
report object to render or approve on top of it. The PR itself is the gate:
the engine's own exit code decides ready vs. draft, and there is no
`--approve` step for an operator to run by hand.
