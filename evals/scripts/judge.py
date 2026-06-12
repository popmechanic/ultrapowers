#!/usr/bin/env python3
"""Blinded pairwise quality judging for eval runs.

Modes:
  --fixture wide --cond-a A --cond-b B    judge all rep-matched pairs via the API
  --export-human N                        export N blinded pairs for human judging
  --score-human                           reconcile human verdicts against the key

The judge is a fresh-context model that sees the frozen plan and two anonymized
diffs in randomized order. It never learns which engine produced which diff.
"""
import argparse
import json
import pathlib
import random
import sys

EVALS = pathlib.Path(__file__).resolve().parents[1]
RESULTS = EVALS / "results"
DIFFS = RESULTS / "diffs"
HUMAN = RESULTS / "human"
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


def judge_pairs(fixture, cond_a, cond_b, seed):
    try:
        import anthropic
    except ImportError:
        raise SystemExit("pip install anthropic — the judge calls the Claude API")
    client = anthropic.Anthropic()
    rng = random.Random(seed)
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = open(RESULTS / "judgments.jsonl", "a")

    for run_a, run_b in rep_matched_pairs(fixture, cond_a, cond_b):
        plan, d1, d2, mapping = pair_materials(run_a, run_b, rng)
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
            print(f"judge refused pair {run_a['run_id']}/{run_b['run_id']}; skipping",
                  file=sys.stderr)
            continue
        verdict = json.loads(next(b.text for b in response.content if b.type == "text"))
        winner_label = verdict["winner"]
        record = {
            "fixture": fixture,
            "pair": [run_a["run_id"], run_b["run_id"]],
            "presented_as": mapping,
            "winner_run_id": mapping.get(winner_label, "tie"),
            "verdict": verdict,
            "judge_model": JUDGE_MODEL,
        }
        out.write(json.dumps(record) + "\n")
        print(f"{run_a['run_id']} vs {run_b['run_id']}: "
              f"winner = {record['winner_run_id']}")
    out.close()


def export_human(n, seed):
    """Sample judged pairs (or build fresh ones) into blinded folders for Marcus."""
    rng = random.Random(seed)
    jpath = RESULTS / "judgments.jsonl"
    if not jpath.exists():
        raise SystemExit("run the LLM judge first — the human pass calibrates against it")
    judgments = [json.loads(l) for l in jpath.read_text().splitlines() if l.strip()]
    sample = rng.sample(judgments, min(n, len(judgments)))
    HUMAN.mkdir(parents=True, exist_ok=True)
    key = {}
    for i, j in enumerate(sample, 1):
        pdir = HUMAN / f"pair_{i:02d}"
        pdir.mkdir(exist_ok=True)
        fixture = j["fixture"]
        plan = (EVALS / "fixtures" / fixture / "plan.md").read_text()
        (pdir / "plan.md").write_text(plan)
        # Re-randomize order independently of the LLM judge's presentation.
        ids = list(j["pair"])
        rng.shuffle(ids)
        for label, rid in zip(("1", "2"), ids):
            (pdir / f"diff_{label}.diff").write_text(
                (DIFFS / f"{rid}.diff").read_text())
        (pdir / "VERDICT.txt").write_text(
            "# Replace this line with exactly one of: 1, 2, tie\n")
        key[f"pair_{i:02d}"] = {"1": ids[0], "2": ids[1],
                                "llm_winner_run_id": j["winner_run_id"]}
    (HUMAN / "KEY.json").write_text(json.dumps(key, indent=2))
    print(f"exported {len(sample)} blinded pairs to {HUMAN}/")
    print("Fill in each VERDICT.txt. Do NOT open KEY.json until you're done.")


def score_human():
    key = json.loads((HUMAN / "KEY.json").read_text())
    agree = disagree = ties = pending = 0
    for pair, info in sorted(key.items()):
        vfile = HUMAN / pair / "VERDICT.txt"
        verdict = vfile.read_text().strip().splitlines()[-1].strip() if vfile.exists() else ""
        if verdict not in ("1", "2", "tie"):
            pending += 1
            continue
        human_winner = info.get(verdict, "tie")
        llm_winner = info["llm_winner_run_id"]
        if human_winner == llm_winner:
            agree += 1
        elif "tie" in (human_winner, llm_winner):
            ties += 1
        else:
            disagree += 1
        print(f"{pair}: human={human_winner}  llm={llm_winner}")
    print(f"\nagreement: {agree}  one-sided ties: {ties}  "
          f"disagreement: {disagree}  pending: {pending}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--fixture")
    p.add_argument("--cond-a", choices=["A", "B", "C"])
    p.add_argument("--cond-b", choices=["A", "B", "C"])
    p.add_argument("--export-human", type=int, metavar="N")
    p.add_argument("--score-human", action="store_true")
    p.add_argument("--seed", type=int, default=20260612)
    args = p.parse_args()

    if args.score_human:
        score_human()
    elif args.export_human:
        export_human(args.export_human, args.seed)
    elif args.fixture and args.cond_a and args.cond_b:
        judge_pairs(args.fixture, args.cond_a, args.cond_b, args.seed)
    else:
        p.print_help()
        raise SystemExit(1)


if __name__ == "__main__":
    main()
