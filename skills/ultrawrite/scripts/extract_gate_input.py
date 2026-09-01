#!/usr/bin/env python3
"""Build the proof gate's diet for one claims-v1 task — mechanically capped.

The gate's judgment is not mechanizable; what it READS is (spec 2026-08-31 §4,
"deterministic input, non-deterministic judgment"). This script is that cap: it
parses the plan with the compiler's own slot parser and prints exactly the
task's Claim and Proof, plus the hash the gate's verdict is keyed on. Context,
Authorized-by, Interfaces, Stale-if and every sibling task stay out — not by the
reader's restraint but because they never reach the reader.

    extract_gate_input.py <plan.md> --task <id>

prints `{"task", "claim", "proof", "hash"}` where hash is
`sha256(claim + "\\x00" + proof)` — the same value `compile_plan.py` recomputes
when it checks `<plan-stem>.gate-verdicts.json` (§4.5). `verdicts_path` is
re-exported here so gate tooling has one import for both halves of the contract.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# scripts -> ultrawrite -> skills; the compiler owns the grammar and this script
# never re-implements it (identical idiom to ultralearn/scripts/harvest_runs.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))

from compile_plan import (  # noqa: E402
    CLAIMS_GRAMMAR,
    gate_input_hash,
    parse_claims_body,
    plan_grammar,
    split_tasks,
    verdicts_path,
)

__all__ = ["gate_input", "gate_input_hash", "verdicts_path", "main"]


def gate_input(plan_path, task_id):
    """The (Claim, Proof) diet for one task of a claims-v1 plan, plus its hash."""
    text = Path(plan_path).read_text()
    if plan_grammar(text) != CLAIMS_GRAMMAR:
        raise SystemExit(
            "extract_gate_input: %s declares no `**Grammar:** %s` header — the "
            "proof gate reads claims-v1 plans only." % (plan_path, CLAIMS_GRAMMAR))
    tasks = split_tasks(text)
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        raise SystemExit(
            "extract_gate_input: no task %s in %s (found: %s)"
            % (task_id, plan_path, ", ".join(t["id"] for t in tasks) or "none"))
    claims = parse_claims_body(task["body"], task["id"])
    claim, proof = claims["claim"], claims["proof"]
    return {"task": task["id"], "claim": claim, "proof": proof,
            "hash": gate_input_hash(claim, proof)}


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Print the proof gate's capped input for one claims-v1 task.")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--task", required=True, metavar="ID",
                    help="the task id as it appears in `### Task <id>:`")
    args = ap.parse_args(argv)
    print(json.dumps(gate_input(args.plan, args.task), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
