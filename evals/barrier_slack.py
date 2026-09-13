#!/usr/bin/env python3
"""evals/barrier_slack.py — the barrier-slack reading (#810 Phase A, pre-registered for Phase C).

The engine runs its tasks in waves, and a wave closes as a unit: a task that
finishes early sits done while its slowest neighbour is still working. This
reading says how much of the engine's wall that waiting costs, from the record
and nothing else.

Per task, on one run's `events.jsonl`:

    slack = ts(the `driver:wave-adopted` whose `tasks[]` names the task)
          − ts(the LAST `worker:end` whose label names the task)

A worker label carries its task as the second colon-segment — `impl:1`,
`exam:1`, `fix:1:0` and `review:1:1:2` all name task 1, while `integration`
(the critic) and `reconcile:wave1:1` name no task the record knows, so their
second segment never matches an adopted id. A task no adoption ever names is
ignored; so is an adopted task that never ran a worker. When two waves each
adopt their own tasks, each task is paired with the adoption that took it —
the earliest one naming it — not with the run's last adoption.

The engine's wall for a run is `ts(last driver:wave-adopted) − ts(first
worker:start)`, and the share the reading exists to report is the sum of the
slacks over that wall. ≥ 20 % is what funds #813's pool sim.

    python3 evals/barrier_slack.py <events.jsonl>…
    python3 evals/barrier_slack.py --tags 70-112 [--repo .]

`--tags` reads `git show ultra/evidence/run-<N>:.ultrapowers/runs/<N>/events.jsonl`
for each N in the range and skips an N whose tag is absent or whose tree has no
such path, naming the skipped ones on one `skipped:` line. It reads the local
clone only — no network call of any kind is made from here, so the tags have to
be in the clone already (the reading's `Run:` line pulls them down on its own
line, before the script).

`ts` is epoch milliseconds. Python 3.12, no third-party imports.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ADOPTED = "driver:wave-adopted"
EVENTS_IN_TAG = ".ultrapowers/runs/{n}/events.jsonl"
TAG = "ultra/evidence/run-{n}"


def task_of(label) -> str | None:
    """The task a worker label names: its second colon-segment, or None."""
    parts = str(label or "").split(":")
    return parts[1] if len(parts) > 1 and parts[1] else None


def events_of(text: str) -> list[dict]:
    """The JSON lines that carry a numeric `ts`; everything else is the record's."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and isinstance(event.get("ts"), (int, float)):
            out.append(event)
    return out


def measure(run_id: str, text: str) -> dict:
    """One run's reading: its slacks, the engine's wall, and whether a wave closed."""
    events = events_of(text)

    starts = [e["ts"] for e in events if e.get("kind") == "worker:start"]
    adoptions = [e for e in events if e.get("kind") == ADOPTED]

    # The last end per task — a task's slack starts when its LAST worker stops,
    # not its first, since a review or a fix round keeps the task busy.
    last_end: dict[str, float] = {}
    for event in events:
        if event.get("kind") != "worker:end":
            continue
        task = task_of(event.get("label"))
        if task is None:
            continue
        if event["ts"] > last_end.get(task, float("-inf")):
            last_end[task] = event["ts"]

    # The adoption that took each task: the earliest one naming it.
    adopted_at: dict[str, float] = {}
    for event in sorted(adoptions, key=lambda e: e["ts"]):
        tasks = event.get("tasks")
        if not isinstance(tasks, list):
            continue
        for task in tasks:
            adopted_at.setdefault(str(task), event["ts"])

    slacks = sorted(adopted_at[t] - last_end[t] for t in adopted_at if t in last_end)
    wall = (max(e["ts"] for e in adoptions) - min(starts)) if adoptions and starts else 0

    return {"run": run_id, "adopted": bool(adoptions), "slacks": slacks, "wall": wall}


def median(xs: list[float]) -> float:
    if not xs:
        return 0
    ys = sorted(xs)
    mid = len(ys) // 2
    return ys[mid] if len(ys) % 2 else (ys[mid - 1] + ys[mid]) / 2


def p90(xs: list[float]) -> float:
    """The value at index ceil(0.9·n) − 1, in integer arithmetic."""
    if not xs:
        return 0
    ys = sorted(xs)
    n = len(ys)
    return ys[min(n - 1, max(0, (9 * n + 9) // 10 - 1))]


def num(x) -> str:
    """Milliseconds, whole where they are whole."""
    return str(int(x)) if float(x).is_integer() else str(x)


def share(total_slack: float, wall: float) -> str:
    return f"{total_slack / wall:.3f}" if wall > 0 else "0.000"


def run_id_of(path: str) -> str:
    """The run a file speaks for: `…/runs/112/events.jsonl` is run 112."""
    p = Path(path)
    if p.stem == "events" and p.parent.name:
        return p.parent.name
    return p.stem


def from_tag(repo: str, n: int) -> str | None:
    """One run's events as the evidence tag carries them, or None to skip it."""
    ref = TAG.format(n=n) + ":" + EVENTS_IN_TAG.format(n=n)
    done = subprocess.run(["git", "-C", repo, "show", ref], capture_output=True, text=True)
    return done.stdout if done.returncode == 0 else None


def parse_tags(spec: str) -> list[int]:
    """`70-112`, or a comma-separated list of ranges and single runs."""
    ns: list[int] = []
    try:
        for chunk in str(spec).split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if "-" in chunk:
                low, high = chunk.split("-", 1)
                ns.extend(range(int(low), int(high) + 1))
            else:
                ns.append(int(chunk))
    except ValueError:
        raise SystemExit(f"--tags wants a run range like 70-112, not {spec!r}")
    return ns


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="the barrier-slack reading over one or more runs")
    ap.add_argument("files", nargs="*", help="events.jsonl paths to read")
    ap.add_argument("--tags", help="a run range, e.g. 70-112, read from the evidence tags")
    ap.add_argument("--repo", default=".", help="the clone the evidence tags live in")
    args = ap.parse_args(argv)

    readings: list[dict] = []
    skipped: list[int] = []

    if args.tags:
        for n in parse_tags(args.tags):
            text = from_tag(args.repo, n)
            if text is None:
                skipped.append(n)
                continue
            readings.append(measure(str(n), text))
    elif args.files:
        for path in args.files:
            try:
                text = Path(path).read_text()
            except OSError as exc:
                raise SystemExit(f"cannot read {path}: {exc}")
            readings.append(measure(run_id_of(path), text))
    else:
        ap.error("name at least one events.jsonl, or a run range with --tags")

    for reading in readings:
        slacks = reading["slacks"]
        print(
            f"run={reading['run']} tasks={len(slacks)} "
            f"engine_wall_ms={num(reading['wall'])} slack_sum_ms={num(sum(slacks))} "
            f"share={share(sum(slacks), reading['wall'])} "
            f"median_ms={num(median(slacks))} p90_ms={num(p90(slacks))}"
        )

    if args.tags:
        print("skipped:" + "".join(f" {n}" for n in skipped))

    # A run that never closed a wave has no reading to pool: it is excluded here.
    pooled = [r for r in readings if r["adopted"]]
    every_slack = [s for r in pooled for s in r["slacks"]]
    print(
        f"all: files={len(pooled)} "
        f"share={share(sum(every_slack), sum(r['wall'] for r in pooled))} "
        f"median_ms={num(median(every_slack))} p90_ms={num(p90(every_slack))}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
