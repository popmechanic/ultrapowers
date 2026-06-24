#!/usr/bin/env python3
"""Micro-test loop: one API call per sample, programmatic scoring, always a
no-guidance control.

Purpose (spec §2.4): tune prompt PHRASING cheaply before spending on a full eval
run. A no-guidance CONTROL variant is injected automatically, so every phrasing
is measured against "say nothing at all". The model call is injected
(`call_model`), so the scorer and aggregation are pure and unit-tested offline.

Usage:
    evals/scripts/run-micro.py --variants variants.json --scorer json_object \\
        --samples samples.json --n 5
"""
import argparse
import json
import os
import re
import statistics
import sys
from pathlib import Path

CONTROL_NAME = "control-no-guidance"


def _score_json_object(output, sample):
    """1.0 iff the WHOLE output parses as a JSON object; 0.0 otherwise."""
    try:
        parsed = json.loads(output)
    except (ValueError, TypeError):
        return 0.0
    return 1.0 if isinstance(parsed, dict) else 0.0


def _score_nonempty(output, sample):
    return 1.0 if isinstance(output, str) and output.strip() else 0.0


def _parse_markers(text):
    """Parse 'Task <id>: deps=<ids|none>' lines into {id: [dep_ids]}.
    Tolerant: lines that don't match are ignored; ids are strings."""
    dag = {}
    for line in text.splitlines():
        m = re.match(r"\s*Task\s+([A-Za-z0-9]+)\s*:\s*deps\s*=\s*(.+)", line, re.I)
        if not m:
            continue
        tid = m.group(1)
        rest = m.group(2).strip()
        if rest.lower() in ("none", "-", ""):
            deps = []
        else:
            deps = [d.strip() for d in rest.split(",") if d.strip()]
        dag[tid] = deps
    return dag


def _max_wave_width(dag):
    """Layered (Kahn) max wave width of a dependency DAG. A dep id that is not
    itself a task in the dag is treated as already-satisfied. A cycle stops
    layering (width reflects what could be layered)."""
    remaining = dict(dag)
    done = set()
    width = 0
    while remaining:
        ready = [t for t, deps in remaining.items()
                 if all(d in done or d not in dag for d in deps)]
        if not ready:
            break
        width = max(width, len(ready))
        for t in ready:
            done.add(t)
            del remaining[t]
    return width


def _score_wave_width(output, sample):
    """Max wave width of the produced decomposition (efficacy; higher = wider)."""
    return float(_max_wave_width(_parse_markers(output)))


def _score_wave_overshoot(output, sample):
    """Width above the spec's honest ground truth (manufacturing; 0 = honest).
    Requires sample['_ground_truth_width']."""
    width = _max_wave_width(_parse_markers(output))
    return float(max(0, width - sample["_ground_truth_width"]))


SCORERS = {
    "json_object": _score_json_object,
    "nonempty": _score_nonempty,
    "wave_width": _score_wave_width,
    "wave_overshoot": _score_wave_overshoot,
}


def aggregate(scores):
    """Mean + population variance over a list of per-sample scores. Empty-safe."""
    scores = list(scores)
    n = len(scores)
    if n == 0:
        return {"n": 0, "mean": 0.0, "variance": 0.0}
    mean = statistics.fmean(scores)
    variance = statistics.pvariance(scores) if n > 1 else 0.0
    return {"n": n, "mean": mean, "variance": variance}


def compose_prompt(instruction, sample):
    # Keys starting with "_" are scorer-only metadata (e.g. ground-truth answers)
    # and must never reach the model.
    visible = {k: v for k, v in sample.items() if not str(k).startswith("_")}
    body = json.dumps(visible, sort_keys=True)
    return (instruction + "\n\n" + body) if instruction.strip() else body


def run_variant(name, instruction, samples, scorer, call_model):
    score_fn = SCORERS[scorer]
    scores = []
    for sample in samples:
        prompt = compose_prompt(instruction, sample)
        output = call_model(prompt)
        scores.append(score_fn(output, sample))
    agg = aggregate(scores)
    return {"name": name, **agg}


def run_suite(variants, samples, scorer, call_model):
    if scorer not in SCORERS:
        raise SystemExit(
            "unknown scorer %r; known: %s" % (scorer, ", ".join(sorted(SCORERS)))
        )
    authored = list(variants)
    if not any(v.get("name") == CONTROL_NAME for v in authored):
        authored = [{"name": CONTROL_NAME, "instruction": ""}] + authored
    results = []
    for v in authored:
        results.append(
            run_variant(
                name=v["name"],
                instruction=v.get("instruction", ""),
                samples=samples,
                scorer=scorer,
                call_model=call_model,
            )
        )
    return {"scorer": scorer, "variants": results}


def default_call_model(model="claude-opus-4-8", max_tokens=1024):
    from anthropic import Anthropic  # lazy: import cost + key only on live use

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set (required for live runs)")
    client = Anthropic()

    def call_model(prompt):
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        )

    return call_model


def _load_json(path):
    return json.loads(Path(path).read_text())


def main(argv=None):
    p = argparse.ArgumentParser(description="Micro-test loop for prompt phrasing.")
    p.add_argument("--variants", required=True, help="JSON list of {name, instruction}")
    p.add_argument("--samples", required=True, help="JSON list of sample dicts")
    p.add_argument("--scorer", required=True, choices=sorted(SCORERS))
    p.add_argument("--n", type=int, default=None, help="cap samples to the first N")
    p.add_argument("--model", default="claude-opus-4-8")
    args = p.parse_args(argv)

    variants = _load_json(args.variants)
    samples = _load_json(args.samples)
    if args.n is not None:
        samples = samples[: args.n]

    report = run_suite(
        variants=variants,
        samples=samples,
        scorer=args.scorer,
        call_model=default_call_model(model=args.model),
    )
    rows = sorted(
        report["variants"],
        key=lambda r: (r["name"] != CONTROL_NAME, -r["mean"]),
    )
    print("scorer: %s   (n=%d samples/variant)" % (report["scorer"], len(samples)))
    print("%-28s %6s %9s %9s" % ("variant", "n", "mean", "var"))
    for r in rows:
        print("%-28s %6d %9.3f %9.4f" % (r["name"], r["n"], r["mean"], r["variance"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
