#!/usr/bin/env python3

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan_parse import Refusal, parse_plan_full  # noqa: E402


def main(argv):
    if not argv:
        print("usage: run_probes.py <plan.md> [<task id> ...]", file=sys.stderr)
        return 2
    try:
        result, _ = parse_plan_full(Path(argv[0]).read_text())
    except OSError as e:
        print(f"run_probes: cannot read {argv[0]}: {e}", file=sys.stderr)
        return 2
    except Refusal as e:
        print(e, file=sys.stderr)
        return 2
    only = set(argv[1:])
    ran = red = 0
    for task in result["tasks"]:
        if only and str(task["id"]) not in only:
            continue
        clauses = task.get("proofRunClauses") or []
        for i, cmd in enumerate(task.get("proofRuns") or [], 1):
            tag = ", ".join(clauses[i - 1]) if i <= len(clauses) and clauses[i - 1] else "guard"
            rc = subprocess.run(["bash", "-c", cmd], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
            ran += 1
            red += rc != 0
            print(f"task {task['id']} run {i} [{tag}] exit {rc}", flush=True)
    print(f"probes: {ran} run, {red} red")
    return 1 if red else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
