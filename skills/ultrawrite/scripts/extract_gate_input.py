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

    extract_gate_input.py <plan.md> --plan

is the plan-level diet (#552): the header's ONE operator sentence and every
task's Machine restatement, so the gate can ask whether the machine halves add
up to what the operator signed. No task's Claim, Proof or Context rides here,
and the header sentence never rides in a task's diet — the two hashes are over
disjoint text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# scripts -> ultrawrite -> skills; the compiler owns the grammar and this script
# never re-implements it (the idiom ultralearn/scripts/_readers.py uses for _outcome).
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))

from compile_plan import (  # noqa: E402
    CLAIMS_GRAMMAR,
    gate_input_hash,
    machine_restatement,
    parse_claims_body,
    parse_plan_claim,
    plan_grammar,
    split_tasks,
    verdicts_path,
)

__all__ = ["gate_input", "gate_input_hash", "plan_input", "verdicts_path",
           "main"]


def _claims_text(plan_path):
    """The plan's text, or a refusal when it is not written in claims-v1."""
    text = Path(plan_path).read_text()
    if plan_grammar(text) != CLAIMS_GRAMMAR:
        raise SystemExit(
            "extract_gate_input: %s declares no `**Grammar:** %s` header — the "
            "proof gate reads claims-v1 plans only." % (plan_path, CLAIMS_GRAMMAR))
    return text


def gate_input(plan_path, task_id):
    """The (Claim, Proof) diet for one task of a claims-v1 plan, plus its hash."""
    text = _claims_text(plan_path)
    tasks = split_tasks(text)
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        raise SystemExit(
            "extract_gate_input: no task %s in %s (found: %s)"
            % (task_id, plan_path, ", ".join(t["id"] for t in tasks) or "none"))
    claims = parse_claims_body(task["body"], task["id"], parse_plan_claim(text))
    claim, proof = claims["claim"], claims["proof"]
    return {"task": task["id"], "claim": claim, "proof": proof,
            "hash": gate_input_hash(claim, proof)}


def plan_input(plan_path):
    """The plan-level diet: the header's operator sentence and every task's
    Machine restatement, keyed by a hash over exactly those two (#552)."""
    text = _claims_text(plan_path)
    claim = parse_plan_claim(text)
    if not claim:
        raise SystemExit(
            "extract_gate_input: %s carries no plan-level Claim — the one "
            "elicited operator sentence sits above the first task." % plan_path)
    entries = [
        {"id": t["id"],
         "machine": machine_restatement(
             parse_claims_body(t["body"], t["id"], claim)["claim"])}
        for t in split_tasks(text)]
    machines = "\n".join(e["machine"] for e in entries)
    return {"claim": claim, "tasks": entries,
            "hash": hashlib.sha256(
                (claim + "\x00" + machines).encode("utf-8")).hexdigest()}


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Print the proof gate's capped input for one claims-v1 "
                    "task, or for the plan.")
    ap.add_argument("plan", type=Path)
    # Exactly one diet per invocation: a task's (Claim, Proof) or the plan's
    # (Claim, Machines). Mixing them would put the header sentence in front of
    # a task gate, which is the one thing the cap exists to prevent.
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--task", metavar="ID",
                      help="the task id as it appears in `### Task <id>:`")
    mode.add_argument("--plan", action="store_true", dest="plan_mode",
                      help="the plan-level diet: header Claim + every Machine")
    args = ap.parse_args(argv)
    payload = (plan_input(args.plan) if args.plan_mode
               else gate_input(args.plan, args.task))
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
