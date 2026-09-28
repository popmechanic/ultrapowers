#!/usr/bin/env python3
"""Run a plan's `Run:` probes against the working tree, the way the sandbox would.

Usage: python3 run_probes.py <plan.md> [<task id> ...]

Reads the plan through `plan_parse` (the sandbox's parser, so the tags are
stripped exactly as the driver strips them) and runs each task's `Run:` lines
in the current directory, one `bash -c` per line with stdin closed, printing
one line per probe:

    task 1 run 1 [M1] exit 0
    task 1 run 2 [guard] exit 1

and a last `probes: <n> run, <k> red` line. Exits 0 when every probe exited
0, 1 when any did not, 2 when the plan cannot be read. `$ULTRA_BASE` is left
as the caller's environment has it.

It exists because a hand loop over a plan's probes misreports: on 2026-09-28
`echo "$(basename …) exit $?"` read `$?` after the command substitution had
reset it, and printed exit 0 for a probe that failed (the stall-stop plan's
first probe, after #1348). Use this instead of a loop.
"""

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
    except (OSError, Refusal) as e:
        print(f"run_probes: cannot read {argv[0]}: {e}", file=sys.stderr)
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
