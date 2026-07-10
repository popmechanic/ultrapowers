#!/usr/bin/env python3
"""Blind A/B judge — one claude -p invocation per benchmark plan.

Assigns the two integrated diffs to arbitrary labels X/Y (randomized per
plan, per the fixture's own seed) so the judge never sees which engine
produced which diff. The X/Y <-> A/B key is written to disk only after
judging, alongside the judge's response, so the blinding cannot leak back
into the judgment itself.

Headless invocation mechanics (the `claude -p ... --output-format json
--dangerously-skip-permissions` shape) are recovered from the removed dev
eval harness (git 589114e^:evals/scripts/night_runner.sh) — the same
reference the A/B runner task (evals/ab_runner.py) recovers from; not
duplicated here, just reused.

Never runs in CI; tests cover assembly/blinding only (never invokes claude).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from random import Random

ROOT = Path(__file__).resolve().parents[1]
PROMPT_PATH = Path(__file__).resolve().parent / "judge-prompt.md"


def assemble_blind_input(fixture, root, seed):
    """Read the fixture plan + both integrated diffs and blind them into a
    single judge prompt. Returns {prompt: str, key: {X: 'A'|'B', Y: 'A'|'B'}}.
    """
    root = Path(root)
    plan_path = root / "evals/fixtures" / fixture / "plan.md"
    if not plan_path.is_file():
        sys.exit(f"unknown fixture: {fixture}")
    diff_a_path = root / "evals/results/diffs" / f"{fixture}-A.diff"
    diff_b_path = root / "evals/results/diffs" / f"{fixture}-B.diff"
    if not diff_a_path.is_file() or not diff_b_path.is_file():
        sys.exit(f"missing integrated diffs for fixture: {fixture}")

    plan = plan_path.read_text()
    diff_a = diff_a_path.read_text()
    diff_b = diff_b_path.read_text()

    # Randomize which engine's diff is labeled X vs Y; the key records the
    # assignment but is never shown to the judge.
    if Random(seed).random() < 0.5:
        diff_x, diff_y = diff_a, diff_b
        key = {"X": "A", "Y": "B"}
    else:
        diff_x, diff_y = diff_b, diff_a
        key = {"X": "B", "Y": "A"}

    template = PROMPT_PATH.read_text()
    prompt = (template
              .replace("{plan}", plan)
              .replace("{diff_x}", diff_x)
              .replace("{diff_y}", diff_y))
    return {"prompt": prompt, "key": key}


def run_judge(prompt):
    """Invoke claude -p once, headlessly, with the blind prompt. Returns the
    parsed JSON response the judge printed as its final answer.
    """
    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "json",
         "--dangerously-skip-permissions"],
        capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    # `--output-format json` wraps the assistant's final text in `result`.
    text = payload.get("result", payload.get("response", result.stdout))
    return json.loads(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    out = assemble_blind_input(args.fixture, ROOT, seed=hash(args.fixture) & 0xFFFF)

    if args.dry_run:
        print(json.dumps({"prompt": out["prompt"], "key": out["key"]}, indent=2))
        return

    response = run_judge(out["prompt"])
    judgment_path = ROOT / "evals/results" / f"judgment-{args.fixture}.json"
    judgment_path.parent.mkdir(parents=True, exist_ok=True)
    judgment_path.write_text(json.dumps({"key": out["key"], "response": response}, indent=2))
    print(json.dumps({"key": out["key"], "response": response}, indent=2))


if __name__ == "__main__":
    main()
