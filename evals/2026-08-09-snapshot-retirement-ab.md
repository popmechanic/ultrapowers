# Snapshot-family retirement A/B — results (2026-08-09)

**Verdict: ALL PASS → UNFROZEN-BY-EVAL.** The #104 deletion branch
(`ultra/integration-d104-20260809` @ `b0208ca`) meets all four mechanics
hard-gate criteria of the spec
(`docs/superpowers/specs/2026-08-09-snapshot-family-retirement-design.md`
§The eval gate) against main @ `e223254`. Per the subtraction-eval doctrine
this unfreezes the verification periphery for exactly this deletion; the
merge condition is satisfied.

## Cells

One A/B pair on the `chained` fixture (5 tasks / 5 waves, sealed acceptance,
sealId `4b5e2d78b16f`), driven headlessly by
`.claude/ultrapowers/run-d104-20260809/run_ab_cell.py` over
`evals/ab_runner.py` functions, operator-administered from a plain terminal
(engine pinned per cell in a throwaway `CLAUDE_CONFIG_DIR`, #107 isolation).
Pre-existing operator dirt seeded before launch in both cells
(untracked `OPERATOR-WIP.txt` + tracked edit to `docs/plans/plan.md`).

| | A (control) | B (deletion) |
|---|---|---|
| engine | main @ `e223254` | `ultra/integration-d104-20260809` @ `b0208ca` |
| mode | headless | headless |
| engine run | `wf_9b550b07-5a9` (stamp 20260809-215013) | `wf_ab38597d-0d0` (stamp 20260809-221432) |
| workdir | `…/T/ab-run-chained-A-kvgu55rc/repo` | `…/T/ab-run-chained-B-o6a059n_/repo` |
| fixture baseline | `61bb68e3b498…` | `7522dff684ec…` |
| gate verdict | NEEDS_ACK (exit 2) | PASS (exit 0) |

## Mechanics hard-gate (per spec, all four must hold)

**1. B completes with a non-crash gate verdict — PASS.** B ran headless to the
pre-merge gate; `gate_check` returned verdict `PASS`, `gateCheckExit 0`;
sealed acceptance administered deterministically (`sealId 4b5e2d78b16f`,
`status OK`, 8 passed, exit 0). All ultra_run preflight stages ok.

**2. `gateCheck.checks[]` set-identical A vs B; dirt passes-with-note on
both — PASS.** Both cells produced exactly the same 8 checks, all `ok: true`:
`report-parse, lock, clean-tree, wave-merges, head-match, git-verified,
ancestry, deliverables`. The clean-tree check passed **with the identical
note** on both engines: "pre-existing dirt carried through from before
launch, not gate-relevant: docs/plans/plan.md, .headless-result.json,
OPERATOR-WIP.txt". The seeded dirt survived untouched through both runs
(`dirtSeededBefore` = seeded set; `dirtAfter` = seeded set + the driver's
own `.headless-result.json`).

**3. Pre/post branch + HEAD equal per workdir — PASS.**
A: `main` / `61bb68e3b498698a2161aa6623fe7fa7fa90d774` before launch and
after the gate. B: `main` / `7522dff684ec2f259623932696f067bf6cf1f64c`
before and after. The property the snapshot/restore family claimed to
protect holds on the engine that no longer has the family.

**4. No stage in B's receipts errors on a missing snapshot — PASS.** B's
`receipt.json` + `gate-receipt.json` contain zero occurrences of
`snapshot` / `restore` / `error` in any stage or check.

### The one A/B difference, explained (not deletion-caused)

A's overall verdict was NEEDS_ACK where B's was PASS. The acks are two
`deferred:runtime` items A's engine run declared in its workflow report
(plan pins Python 3.11, sandbox had 3.9.6; `ledger/cli.py` never invoked as
a real process). `gate_check.py` — byte-identical on both engines —
faithfully converts report-declared deferrals into acks; B's run declared
none. The divergence is reviewer-judgment variance in report *content*
(the report producer `waves.js` is untouched by the branch), not gate
machinery. n=1 variance, consistent with the 0.1.0 doctrine.

## Advisory (not gated)

Driver-session measurements only (workflow subagent tokens not included):

| | A | B |
|---|---|---|
| wall clock | 19m06s | 18m36s |
| output tokens | 33,325 | 21,992 |
| cache read / create | 2.53M / 171k | 2.40M / 149k |

## Eval-kit findings (the ceremony's own defects, fixed to get here)

Three rounds were needed; the first two failed in the *kit*, not the engines
— both engines failed identically each time, so no cell ever produced a
biased comparison.

1. **#107 follow-up — auth does not ride into a virgin `CLAUDE_CONFIG_DIR`**
   ("Not logged in"), and the first remedy — copying
   `~/.claude/.credentials.json` into the throwaway — fails once the
   operator's live session rotates the refresh token: both cells died with
   "OAuth session expired and could not be refreshed" (file was ~21h stale).
   **Fix:** export the live credentials from the macOS Keychain
   (`security find-generic-password -s "Claude Code-credentials" -w`) at
   cell-run time, file copy as fallback. A durable eval-config-isolation
   answer must source auth from the Keychain at launch, never from a stored
   copy. (For issue #107's closed thread / #122.)
2. **Headless print mode races the SessionStart hook:** the Workflow
   engine's saved-workflow registry snapshots before the hook's harness copy
   lands, so the probe got `Workflow "ultrapowers-probe" not found` even
   though `probe.js` was on disk by end of startup. Interactively the hook
   wins this race (why live `/ultrapowers` sessions work); headlessly it
   loses. **Fix:** the cell driver pre-seeds the pinned engine's harnesses
   into `repo/.claude/workflows/` before any claude process starts, and
   mirrors the production gitignore (`.claude/` in `.git/info/exclude`) so
   the dirt measurement stays scoped to the deliberately seeded dirt.

## Disposition

Merge condition satisfied: `gate_check.py` and `run_acceptance.sh` verified
byte-identical to main on the branch (`git diff main...` empty on both);
branch merges `--no-ff` to main; docket #104 queued → executed.
canaryMetric (spec §Acceptance): post-release sense passes must show zero
checkout-drift incidents at engineVersion ≥ the adopting release.
