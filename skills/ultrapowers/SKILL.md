---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine. Also use when the user runs "/ultrapowers setup", asks whether they have a fleet yet, or asks to build one.
argument-hint: <plan-path> | setup
allowed-tools: Skill Read Grep Glob Bash
---

# Ultrapowers

This skill is the CLIENT only. Since 0.3.0 there is no LLM engine session:
on the sandbox, a boot unit spawns the deterministic driver
(`node fleet/run-main.mjs` → `fleet/run-engine.mjs`), which compiles the plan,
dispatches judgment agents, folds each wave with the kernel, gates, and
approves — code, not prose. Nothing in this skill runs a plan locally, and
`ultra_run.py` refuses to (its `fleet-run` stage).

The argument decides the mode. A plan path is the client below; the bare word
`setup` is the guided first run: find out which pieces of the fleet exist and
walk the missing ones.

## Setup

The fleet is three pieces, and the doctor is the only thing that knows whether
you have them.

Run the doctor from the plugin cache:

```bash
node <plugin-root>/fleet/doctor.mjs --json
```

`<plugin-root>` is two directories above this skill's base directory. The
harness prints `Base directory for this skill:` when it loads this file; the
cache path itself differs by version and by host, so derive it rather than
naming it.

The doctor answers with one row per piece — `exe-dev`, `integrations`,
`golden`, in that order — each carrying a `status` of `ok` or `missing`, a
human `detail`, and a `fix`. Read the rows back to the user as a short list
before touching anything. Every row is a read: running the doctor twice is the
same as running it once, and nothing in setup creates a VM.

For each row whose status is not `ok`, in order, open `references/first-run.md`
at the `## ` section named for that row's `id` and follow it. Every command a
human has to run interactively is theirs to run, offered as `! <command>`.
Re-run the doctor after each row and show the user the row that just turned
`ok`. A `ready` verdict ends setup.

Configuration lives in `~/.ultrapowers/fleet.json`; the doctor takes
`--config <path>` to read it from somewhere else, and `--target <owner>/<repo>`
to add that repository's two integration objects to the `integrations` row.

## Client

Selecting ultrapowers at the planning handoff, or invoking `/ultrapowers` on an
approved plan, **is** the authorization to execute — no further approval pause.

1. **Derive the target from this checkout.** The target is the repository this
   skill is run in: `repo` is
   `gh repo view --json nameWithOwner -q .nameWithOwner`, and `baseSha` is the
   checkout's current commit. There is nothing per-project to configure — the
   pair travels in the launch, and each sandbox clones `repo` and branches from
   `baseSha`. That sha has to be one GitHub already has, so compare it against
   the upstream tip: when they differ, say the base is not on GitHub yet, ask
   the operator to push, and stop.

   Then run the doctor once with `--target <repo>`. A verdict other than
   `ready` means there is no fleet to launch on for this target — offer
   `/ultrapowers setup` and stop.

2. **Launch.** One line, run on the laptop:

   ```bash
   node <plugin-root>/fleet/launch.mjs <plan-path> --target <repo> --base <baseSha>
   ```

   It prints the run number and the status URL. Read both back to the user: the
   run is `run-<N>`, and `https://fleet-run-<N>.exe.xyz/` is its status page.
   Nothing else needs staging — the launcher publishes the plan and its
   `.gate-verdicts.json` where the sandbox can read them, copies the golden,
   grants the run its integrations, and writes the assignment that starts it.

3. **Walk away.** The `notify` integration reports the run: gate-green and
   awaiting the write grant, parked, failed, or the deadman. There is nothing
   to tail and no session to keep alive; the run outlives this one.

4. **Approve.** When the phone says a run is `awaiting-grant`, the approval act
   is one command:

   ```bash
   node <plugin-root>/fleet/grant.mjs <N>
   ```

   That is the pre-merge gate. It checks the run's status page reports the
   engine finished, then swaps the run's read-only grant on the target for a
   time-boxed writable one, and the sandbox pushes its branch and opens its own
   PR. Gate-green → a ready PR. Parked → a draft PR carrying the gate receipt:
   acknowledge by marking it ready, or re-drive a narrower plan. The laptop
   never fetches a run branch.

5. **Reap.** `node <plugin-root>/fleet/janitor.mjs` removes the VMs of runs
   that are done and marks the ones that have aged out. It is a cron job on
   whichever machine holds the fleet-tagged key; run it by hand when that
   machine has been asleep.

## Resources

- `fleet/run-engine.mjs` — the engine (waves, judgments, fold, gate) as code;
  `fleet/roles/*.md` — the judgment prompts, one file per role.
- `references/first-run.md` — one section per doctor row: what it means and the
  command that builds it.
- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `kernel/FOLD_LOG.md` — the fold-log schema (contended-wave state a parked run's evidence carries).
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
