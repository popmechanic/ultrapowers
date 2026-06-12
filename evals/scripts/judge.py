#!/usr/bin/env python3
"""Blinded pairwise quality judging for eval runs.

Modes:
  --fixture wide --cond-a A --cond-b B    judge all rep-matched pairs via the API
  --check-stability                       re-judge every pair with presentation
                                          order swapped; report verdict flips

The judge is a fresh-context model that sees the frozen plan and two anonymized
diffs in randomized order. It never learns which engine produced which diff.

Reliability: there is no human calibration pass (the operator does not
code-review). Judge validity rests on the self-pair smoke test (identical
diffs must tie) and the stability check (a verdict that flips when the two
diffs swap presentation order is position-bias noise; treat flipped verdicts
as ties when reading win rates).
"""
import argparse
import json
import pathlib
import random
import sys

EVALS = pathlib.Path(__file__).resolve().parents[1]
RESULTS = EVALS / "results"
DIFFS = RESULTS / "diffs"
JUDGE_MODEL = "claude-opus-4-8"

RUBRIC = """You are judging two independent implementations of the same approved plan.
You see the plan and two diffs, labeled DIFF 1 and DIFF 2, in random order.
Judge ONLY what is in front of you. Score each diff 1-5 on:

- correctness: does the code do what the plan specifies, including stated edge cases?
- plan_fidelity: does it implement every task, no more, no less?
- scope_discipline: absence of unrequested refactors, helpers, abstractions, or files.
- code_quality: clarity, idiomatic style, test quality.

Then pick a winner: "1", "2", or "tie". Prefer a verdict over a tie unless the
diffs are genuinely indistinguishable in quality."""

SCHEMA = {
    "type": "object",
    "properties": {
        "scores_diff1": {"type": "object", "properties": {
            k: {"type": "integer"} for k in
            ("correctness", "plan_fidelity", "scope_discipline", "code_quality")},
            "required": ["correctness", "plan_fidelity", "scope_discipline", "code_quality"],
            "additionalProperties": False},
        "scores_diff2": {"type": "object", "properties": {
            k: {"type": "integer"} for k in
            ("correctness", "plan_fidelity", "scope_discipline", "code_quality")},
            "required": ["correctness", "plan_fidelity", "scope_discipline", "code_quality"],
            "additionalProperties": False},
        "winner": {"type": "string", "enum": ["1", "2", "tie"]},
        "rationale": {"type": "string"},
    },
    "required": ["scores_diff1", "scores_diff2", "winner", "rationale"],
    "additionalProperties": False,
}


def load_runs():
    path = RESULTS / "runs.jsonl"
    if not path.exists():
        raise SystemExit("no runs scored yet (evals/results/runs.jsonl missing)")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def rep_matched_pairs(fixture, cond_a, cond_b):
    runs = {(r["condition"], r["rep"]): r for r in load_runs() if r["fixture"] == fixture}
    pairs = []
    for (cond, rep), r in sorted(runs.items()):
        if cond == cond_a and (cond_b, rep) in runs:
            pairs.append((r, runs[(cond_b, rep)]))
    if not pairs:
        raise SystemExit(f"no rep-matched {cond_a}/{cond_b} pairs for fixture {fixture}")
    return pairs


def pair_materials(run_a, run_b, rng):
    fixture = run_a["fixture"]
    plan = (EVALS / "fixtures" / fixture / "plan.md").read_text()
    diff_a = (DIFFS / f"{run_a['run_id']}.diff").read_text()
    diff_b = (DIFFS / f"{run_b['run_id']}.diff").read_text()
    # Randomize presentation order; remember the mapping.
    if rng.random() < 0.5:
        return plan, diff_a, diff_b, {"1": run_a["run_id"], "2": run_b["run_id"]}
    return plan, diff_b, diff_a, {"1": run_b["run_id"], "2": run_a["run_id"]}


def ask_judge(client, plan, d1, d2):
    """One blinded judgment. Returns the parsed verdict, or None on refusal."""
    response = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=16000,
        system=RUBRIC,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content":
                   f"<plan>\n{plan}\n</plan>\n\n"
                   f"<diff_1>\n{d1}\n</diff_1>\n\n"
                   f"<diff_2>\n{d2}\n</diff_2>"}],
    )
    if response.stop_reason == "refusal":
        return None
    return json.loads(next(b.text for b in response.content if b.type == "text"))


def make_client():
    try:
        import anthropic
    except ImportError:
        raise SystemExit("pip install anthropic — the judge calls the Claude API")
    return anthropic.Anthropic()


def judge_pairs(fixture, cond_a, cond_b, seed):
    client = make_client()
    rng = random.Random(seed)
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = open(RESULTS / "judgments.jsonl", "a")

    for run_a, run_b in rep_matched_pairs(fixture, cond_a, cond_b):
        plan, d1, d2, mapping = pair_materials(run_a, run_b, rng)
        verdict = ask_judge(client, plan, d1, d2)
        if verdict is None:
            print(f"judge refused pair {run_a['run_id']}/{run_b['run_id']}; skipping",
                  file=sys.stderr)
            continue
        record = {
            "fixture": fixture,
            "pair": [run_a["run_id"], run_b["run_id"]],
            "presented_as": mapping,
            "winner_run_id": mapping.get(verdict["winner"], "tie"),
            "verdict": verdict,
            "judge_model": JUDGE_MODEL,
        }
        out.write(json.dumps(record) + "\n")
        print(f"{run_a['run_id']} vs {run_b['run_id']}: "
              f"winner = {record['winner_run_id']}")
    out.close()


def check_stability():
    """Re-judge every recorded pair with presentation order swapped.

    The dominant known failure mode of pairwise LLM judges is position bias.
    A verdict that survives the swap is signal; one that flips is noise and
    should be read as a tie. Appends to evals/results/stability.jsonl
    (never to judgments.jsonl — rechecks must not inflate win rates).
    """
    jpath = RESULTS / "judgments.jsonl"
    if not jpath.exists():
        raise SystemExit("no judgments to check — run the judge first")
    judgments = [json.loads(l) for l in jpath.read_text().splitlines() if l.strip()]
    client = make_client()
    out = open(RESULTS / "stability.jsonl", "a")
    stable = 0
    for j in judgments:
        plan = (EVALS / "fixtures" / j["fixture"] / "plan.md").read_text()
        # Present in the OPPOSITE order from the recorded judgment.
        first, second = j["presented_as"]["2"], j["presented_as"]["1"]
        verdict = ask_judge(client,
                            plan,
                            (DIFFS / f"{first}.diff").read_text(),
                            (DIFFS / f"{second}.diff").read_text())
        if verdict is None:
            print(f"judge refused recheck of {j['pair']}; skipping", file=sys.stderr)
            continue
        recheck_winner = {"1": first, "2": second}.get(verdict["winner"], "tie")
        agree = recheck_winner == j["winner_run_id"]
        stable += agree
        out.write(json.dumps({
            "pair": j["pair"],
            "original_winner": j["winner_run_id"],
            "swapped_order_winner": recheck_winner,
            "stable": agree,
            "verdict": verdict,
            "judge_model": JUDGE_MODEL,
        }) + "\n")
        print(f"{j['pair'][0]} vs {j['pair'][1]}: original={j['winner_run_id']}  "
              f"swapped={recheck_winner}  {'STABLE' if agree else 'FLIPPED'}")
    out.close()
    print(f"\nstability: {stable}/{len(judgments)} verdicts unchanged under order swap")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--fixture")
    p.add_argument("--cond-a", choices=["A", "B", "C"])
    p.add_argument("--cond-b", choices=["A", "B", "C"])
    p.add_argument("--check-stability", action="store_true")
    p.add_argument("--seed", type=int, default=20260612)
    args = p.parse_args()

    if args.check_stability:
        check_stability()
    elif args.fixture and args.cond_a and args.cond_b:
        judge_pairs(args.fixture, args.cond_a, args.cond_b, args.seed)
    else:
        p.print_help()
        raise SystemExit(1)


if __name__ == "__main__":
    main()
