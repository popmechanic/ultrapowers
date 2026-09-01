---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine.
argument-hint: <plan-path>
allowed-tools: Skill Read Grep Glob Bash
---

# Ultrapowers

This skill is the CLIENT only. Since 0.3.0 there is no LLM engine session:
on the sandbox, the shim spawns the deterministic driver
(`node fleet/run-main.mjs` → `fleet/run-engine.mjs`), which runs preflight,
compiles the plan, dispatches judgment agents, folds each wave with the
kernel, gates, and approves — code, not prose. Nothing in this skill runs a
plan locally, and `ultra_run.py` refuses to (its `fleet-run` stage).

## Client

Selecting ultrapowers at the planning handoff, or invoking `/ultrapowers` on an
approved plan, **is** the authorization to execute — no further approval pause.

1. **Commit the plan and push it.** Bring the orchestrator's clone to that ref
   (`fleet/RUNBOOK.md` §Live W1 run): `drive-one` pushes the run's base from
   that checkout, and the fitness preflight reads the plan at that ref — never
   from your working tree.
2. **Launch** on the orchestrator with a fresh `run-<N>` (run IDs are never
   reused):

   ```bash
   ssh -n fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && nohup node fleet/drive-one.mjs <plan-path> run-<N> </dev/null >/tmp/drive-run-<N>.out 2>&1 &'
   ```

3. **Watch** live as a sync peer (`fleet/watch.mjs` — RUNBOOK §Watch), or tail
   the drive log (`ssh fleet-orchestrator.exe.xyz 'tail -f /tmp/drive-run-<N>.out'`).
4. **Read the receipt in the PR the orchestrator opens.** Gate-green → a ready
   PR. Parked → a draft PR carrying the gate receipt: acknowledge by marking it
   ready, or re-drive a narrower plan. The laptop never fetches a run branch.

Nothing runs here and there is no local fallback: without the fleet, say so
and stop.

## Resources

- `fleet/run-engine.mjs` — the engine (waves, judgments, fold, gate) as code;
  `fleet/roles/*.md` — the judgment prompts, one file per role.
- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `kernel/FOLD_LOG.md` — the fold-log schema (contended-wave state a parked run's evidence carries).
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
