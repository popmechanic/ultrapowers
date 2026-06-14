# evals/scripts/migrate_runs.py
#!/usr/bin/env python3
"""Idempotent migration of evals/results/runs.jsonl.

1. Relabel every legacy `mixed` row -> `flawed`: those runs executed the buggy
   plan that is now the dedicated flawed fixture (issue #27).
2. Backfill `engine` (from each row's scored_epoch) and tasks_planned /
   tasks_merged (per-fixture implementation-task count minus blocked_tasks).

Re-running is a no-op: already-flawed rows are not re-prefixed and present
fields are left untouched.
"""
import argparse
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from engine_version import engine_at_epoch  # noqa: E402

RESULTS = SCRIPTS.parent / "results"

# implementation-task count per fixture plan (coverage denominator)
FIXTURE_TASKS = {"wide": 6, "chained": 5, "mixed": 6, "flawed": 6, "degrade": 2}


def migrate_row(row, engine_resolver):
    # 1. relabel legacy mixed -> flawed (idempotent)
    if row.get("fixture") == "mixed":
        row["fixture"] = "flawed"
        rid = row.get("run_id", "")
        if rid.startswith("mixed-"):
            row["run_id"] = "flawed-" + rid[len("mixed-"):]
    # 2. backfill engine version
    if not row.get("engine"):
        row["engine"] = engine_resolver(row["scored_epoch"])
    # 3. backfill plan coverage
    if row.get("tasks_planned") is None:
        planned = FIXTURE_TASKS.get(row.get("fixture"))
        if planned is not None:
            row["tasks_planned"] = planned
            row["tasks_merged"] = max(0, planned - row.get("blocked_tasks", 0))
    return row


def migrate(path=None, engine_resolver=engine_at_epoch):
    path = pathlib.Path(path) if path else RESULTS / "runs.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    rows = [migrate_row(r, engine_resolver) for r in rows]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--path", help="runs.jsonl (default evals/results/runs.jsonl)")
    args = p.parse_args()
    rows = migrate(args.path)
    flawed = sum(1 for r in rows if r["fixture"] == "flawed")
    have_engine = all("engine" in r for r in rows)
    print(f"migrated {len(rows)} rows; {flawed} flawed; "
          f"all carry engine={have_engine}")


if __name__ == "__main__":
    main()
