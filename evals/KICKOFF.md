# Eval kickoff prompt

Paste the block below into a fresh Claude Code session opened at the root of this
repo, on branch `claude/dag-pattern-ultrapowers-46kmwo`. It briefs the agent for the
first calibration cells of the eval matrix under a Max subscription.

---

You are kicking off the ultrapowers evaluation matrix. Read `evals/README.md` end to
end before doing anything — it is the protocol, and it wins over anything I say
casually in this session.

Context: `evals/` contains a frozen harness comparing three plan-execution conditions
(A: superpowers serial executor, B: `/ultrapowers` as shipped, C: `/ultrapowers` with
all-frontier tier overrides) across four fixture repos, scored by held-out acceptance
tests. The fixtures, plans, and acceptance suites are FROZEN — never edit them. If one
looks broken, stop and tell me instead of fixing it.

I am on a Claude Max subscription, so we use subscriber accounting: weekly-limit
percentage deltas from `/usage` (only I can run that command) plus API-equivalent USD
computed with `evals/scripts/api_equiv.py` from transcript token counts.

Today's objective — calibration only, two runs: `degrade-B-1`, then `wide-B-1`.
These are the two cheapest cells; their weekly-% deltas decide the pacing of the rest
of the matrix (see "Capacity-safe schedule" in the README).

Division of labor:

- YOU run the scripts: `evals/scripts/selftest.sh` first (all fixtures must pass 100%
  before anything else), then `prepare_run.sh` per run, `score_run.py` once I bring
  numbers back, and `report.py` at the end. You commit scored results to this branch.
- I do the things only a human in this seat can do: snapshot `/usage` before and after
  each run, open a fresh Claude Code session inside each run directory, paste the run
  command there, and report the numbers back to you.

Procedure — walk me through it one run at a time, waiting for my numbers between steps:

1. You: `evals/scripts/prepare_run.sh <fixture> /tmp/eval-runs/<run_id>` and confirm
   the baseline suite is green.
2. Me: record the `/usage` weekly % and tell you. Then, in a NEW session opened in the
   run directory, I paste exactly: `/ultrapowers docs/plans/plan.md` — I approve the
   wave plan as proposed (condition B: no knob changes), and I stop at the pre-merge
   gate WITHOUT approving the merge. If there is a long gap between your prep and my
   launch, I will time the run myself so we can pass `--wall-clock-s`.
3. Me: after the gate, record `/usage` weekly % again; note fix rounds, blocked tasks,
   and judgment calls from the end-of-run report; optionally pull per-model token
   totals from the transcript for `api_equiv.py`.
4. You: compute API-equivalent USD if I gave you token counts (otherwise use
   `--cost-usd 0.0` and note "tokens not extracted"), run `score_run.py` with my
   numbers, show me the updated `report.py` output.

Constraints:

- If my `/usage` weekly figure crosses 50%, stop scheduling runs for this week.
- If a harness SCRIPT errors, fix the script and commit the fix; never touch
  fixtures, plans, or acceptance tests.
- When both runs are scored, commit and push `evals/results/` to this branch.

Start now: run `selftest.sh`, then prepare `degrade-B-1`.
