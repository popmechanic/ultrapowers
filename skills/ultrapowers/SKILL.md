---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved Superpowers plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---

# Ultrapowers

**Read one variable first.** `ULTRAPOWERS_FLEET_RUN` set → you are the engine
session inside a fleet sandbox: run §Engine. Unset → you are the client on the
operator's machine: run §Client. There is no third mode: nothing in this skill
runs a plan locally, and `ultra_run.py` refuses to (its `fleet-run` stage).

## Client (`ULTRAPOWERS_FLEET_RUN` unset)

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

3. **Watch** the drive log (`ssh fleet-orchestrator.exe.xyz 'tail -f /tmp/drive-run-<N>.out'`)
   or the orchestrator store.
4. **Read the receipt in the PR the orchestrator opens.** Gate-green → a ready
   PR. Parked → a draft PR carrying the gate receipt: acknowledge by marking it
   ready, or re-drive a narrower plan. The laptop never fetches a run branch.

Nothing runs here and there is no local fallback: without the fleet, say so
and stop.

## Engine (`ULTRAPOWERS_FLEET_RUN` set)

You are headless — no operator until the run ends. Never end a turn on a
question or to wait; poll the workflow in-turn until it completes. The sandbox
is disposable: nothing you leave behind matters.

**1. Preflight and compile (deterministic).**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_run.py <plan> --stamp <stamp> [--test-cmd …] [--bootstrap-cmd …] [--overlap serialize|fold]
```

One call runs every stage fail-closed, in order: `fleet-run`, `git-repo`,
`worktree-probe`, `superpowers-compat`, `compile`, `test-command`, `install`,
`dirty-baseline`, `base-branch`. It writes
`.claude/ultrapowers/run-<stamp>/receipt.json`. Exit 0 → read the receipt and
continue. Non-zero → the last stage names the failure and the run ends here
(no gate receipt reads red, never green).

**2. Judge and fill (LLM-owned).** Adopt the compiler's JSON verbatim
(`receipt.compile`: waves, edges, dispositions); judge only `"heuristic": true`
entries. `waves: []` → nothing to launch; end. Fill the `null` slots in
`receipt.argsFile`: per-task `tier` (`standard`/`most-capable`, by scope and
judgment-likelihood — review agents stay `most-capable` by design) and, for
polyglot plans only, per-task `testCmd`. Run-wide `testCmd`, `bootstrapCmd` and
`baseBranch` come from the receipt. Review depth is plan-authored
(`**Review:**`); never set `task.review`. Then run
`ultra_run.py --validate-knobs <argsFile>`: exit 3 means the baseline is red on
the base ref — launch only if a plan note pre-authorizes the repair, else end.

**3. Render** the interpretation (it reappears with the report): waves, the
edges that shaped them, mode, derived knobs, expected contention
(`declared-commutative` / `composition-unpinned`), dispositions
(`marker_conflicts` grouped by `kind`; `allHeuristic: true` → say
`0 markers — all dispositions inferred`), and the acceptance disposition. No
pause.

**4. Launch** the saved workflow by `meta.name` (`receipt.workflowName` =
`ultrapowers-run`) via the Workflow tool — never author or edit a workflow:

```
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp, baseBranch, reviewProfile? }
```

Always pass `args.edges` — without it dependency blocking is silently off. A
`Workflow "ultrapowers-run" not found` launch means the SessionStart hook did
not install it: fail the run (no receipt → red) rather than improvise. The
headless workflow creates the integration branch in its own worktree, runs,
merges and reconciles each wave, then reviews completeness
(`references/wave-merge.md`; contended-wave fold state: `kernel/FOLD_LOG.md`).

**5. Gate.** Save the Workflow tool's raw result JSON verbatim, then:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/finalize_report.py --report <saved-result.json> --repo . --branch <integrationBranch>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py --stamp <stamp> --result <saved-result.json>
```

A non-zero `finalize_report.py` is a pre-gate failure: do not run the gate.
`ultra_gate.py` runs `gate_check.py` and administers acceptance (`suite`, or the
verbatim waiver; a `sealed` disposition is `BLOCKED`). Its **exit code is the
authority**; `run-<stamp>/gate-receipt.json` is the record.

**The two-move rule** on the verdict:

- **PASS (exit 0)** → approve.
- **NEEDS_ACK (exit 2)** → approve **iff every** ack is a `deferredVerification`
  item with reason `runtime` or `external`. Write
  `run-<stamp>/standing-approval.json` **first**:
  `{"grantedAt": "launch directive", "instruction": "<the launch directive, verbatim>", "ackList": [...]}`.
  A `manual` task is runbook material, never an ack to consume.
- **Anything else** (BLOCKED, any other ack) → leave the gate receipt as the
  terminal artifact and end the session.

Approve = `ultra_gate.py --approve --stamp <stamp>` (it checks out the
integration branch and re-verifies tests) **and save its JSON output verbatim
to `run-<stamp>/approve-receipt.json`** — the fleet shim greens the run only on
that receipt with a matching stamp. Then end. Say nothing the receipts do not:
quote `verdict`, each failing check's `name`/`detail`, and the acceptance exit
verbatim (`references/report-format.md`). The orchestrator publishes the
branch, the receipts and the PR — you never push.

## Resources

- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/reviewer-prompts.md`, `references/wave-merge.md` — the prompts baked into `waves.js`.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
