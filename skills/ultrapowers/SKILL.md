---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine. Also use when the user runs "/ultrapowers setup", asks whether they have a fleet yet, or asks to build one.
argument-hint: <plan-path> | setup
allowed-tools: Skill Read Grep Glob Bash
---

# Ultrapowers

This skill is the CLIENT only. Since 0.3.0 there is no LLM engine session:
on the sandbox, the shim spawns the deterministic driver
(`node fleet/run-main.mjs` → `fleet/run-engine.mjs`), which runs preflight,
compiles the plan, dispatches judgment agents, folds each wave with the
kernel, gates, and approves — code, not prose. Nothing in this skill runs a
plan locally, and `ultra_run.py` refuses to (its `fleet-run` stage).

The argument decides the mode. A plan path is the client below; the bare word
`setup` is the guided first run: find out which pieces of the fleet exist and
walk the missing ones.

## Setup

The fleet is five pieces, and the doctor is the only thing that knows whether
you have them.

Run the doctor from the plugin cache: `node <plugin-root>/fleet/doctor.mjs --json`, where `<plugin-root>` is two directories above this skill's base directory.
The harness prints `Base directory for this skill:` when it loads this file;
the cache path itself differs by version and by host, so derive it rather than
naming it. The doctor answers with one row per piece —
`exe-dev`, `orchestrator`, `golden`, `token`, `preflight`, in that order — each
carrying a `status` of `ok`, `missing` or `skipped`, a human `detail`, and a
`fix` naming the `fleet/RUNBOOK.md` section that builds it. Read the rows back
to the user as a short list before touching anything.

For each row whose status is not `ok`, in order, open `references/first-run.md` at the section named for that row's `id` and follow it; every command a human has to run interactively is theirs to run, offered as `! <command>`, and nothing in this mode builds the golden for them.
The order matters: each piece is built on the one above it, so a `missing`
`orchestrator` makes everything below it unreadable rather than absent.
Re-run the doctor after each row and show the user the row that just turned
`ok`.

When the four read-only rows are `ok`, run the doctor once more with `--probe`; a `ready` verdict ends setup.
The probe is the one check that costs a VM: it clones the golden into a
throwaway named `fleet-doctor-probe`, runs `fleet/preflight.mjs` against it,
and removes it. Anything short of `ready` leaves a row still red — go back to
its section.

Configuration lives in `~/.ultrapowers/fleet.json`; the doctor takes
`--config <path>` to read it from somewhere else.

## Client

Selecting ultrapowers at the planning handoff, or invoking `/ultrapowers` on an
approved plan, **is** the authorization to execute — no further approval pause.

Before the rsync, run the doctor without `--probe`; a verdict other than `ready` means there is no fleet to launch on — offer `/ultrapowers setup` and stop.

1. **Put the plan on the orchestrator.** `docs/superpowers/` is untracked (#544), so
   the plan is never in git: `rsync` it (and its `.gate-verdicts.json`) into
   `<repoDir>/docs/superpowers/plans/`, bring that checkout to the base you
   want, and pass `--plan-from-assignment` — the drive ships the working-tree plan in
   the run assignment and the sandbox compiles that copy (`fleet/RUNBOOK.md` §Live W1 run).
2. **Launch** on the orchestrator with a fresh `run-<N>` (run IDs are never
   reused):

   ```bash
   rsync -a <plan-path> <plan-stem>.gate-verdicts.json <orchestrator>.exe.xyz:<repoDir>/docs/superpowers/plans/
   ssh -n <orchestrator>.exe.xyz 'cd <repoDir> && setsid -f node fleet/drive-one.mjs <plan-path> run-<N> --plan-from-assignment </dev/null >/tmp/drive-run-<N>.out 2>&1'
   ```

   The orchestrator hostname and its checkout path come from `~/.ultrapowers/fleet.json` (`orchestrator`, `repoDir`); their defaults are `fleet-orchestrator` and `/home/exedev/repo`.
   The doctor's `--json` envelope carries the resolved pair in its `config`
   object, so the run that just checked the fleet also has the values to
   substitute.
3. **Watch** live as a sync peer (`fleet/watch.mjs` — RUNBOOK §Watch), or tail
   the drive log (`ssh <orchestrator>.exe.xyz 'tail -f /tmp/drive-run-<N>.out'`).
4. **Read the receipt in the PR the orchestrator opens.** Gate-green → a ready
   PR. Parked → a draft PR carrying the gate receipt: acknowledge by marking it
   ready, or re-drive a narrower plan. The laptop never fetches a run branch.

## Resources

- `fleet/run-engine.mjs` — the engine (waves, judgments, fold, gate) as code;
  `fleet/roles/*.md` — the judgment prompts, one file per role.
- `references/first-run.md` — one section per doctor row: what it means and
  which RUNBOOK section builds it.
- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `kernel/FOLD_LOG.md` — the fold-log schema (contended-wave state a parked run's evidence carries).
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
