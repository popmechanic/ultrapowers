#!/usr/bin/env python3
"""Cell assembly + harvest for the local A/B rig (#402 item 6).

A *cell* is one throwaway git repo the One Driver engine runs against: a
fixture's `project/` tree, its `plan.md`, and the repo-relative engine parts
the driver reaches for at runtime. Cells are built one at a time, by hand, on
the operator's laptop; the fixtures under `evals/fixtures/` are read-only
baseline test data (#402), so assembly copies out of them and never writes
back.

Harvest turns a finished run dir (`events.jsonl` + `args.json`) into one row
for `evals/results/runs.jsonl`, which is append-only: one JSON object per
line, never rewritten. `outputTokens` mirrors `tokens['output']` so the new
rows stay readable next to the 0.1.0 rows already in that file.

Pure filesystem + stdlib: this module spawns git and nothing else. It never
invokes `claude` or `node`.
"""
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

# Repo-relative paths every cell repo must carry: the engine resolves these
# inside the repo it is pointed at, so a cell without them cannot run.
ENGINE_REPO_PARTS = ("skills/ultrapowers/scripts", "fleet/confine-hook.mjs")

# Build noise that must not travel into a cell (and would land in its one commit).
_COPY_IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".git")

_CELL_AUTHOR = ("ab-rig", "ab@localhost")

# The five-way meter sum; `models` is a list, not a quantity, and is dropped.
_METER_KEYS = ("input", "output", "cacheRead", "cacheCreation", "costUsd")


def build_cell(fixture, repo_root, workspace, fixtures_root=None):
    """Assemble one cell repo and return its path.

    Copies the fixture's `project/` tree to `<workspace>/<fixture>/`, its
    `plan.md` beside it, and each of ENGINE_REPO_PARTS from `repo_root`; then
    `git init -b main` plus a single commit authored by 'ab-rig
    <ab@localhost>' (configured locally — the operator's global git identity
    is left alone). `fixtures_root` defaults to `repo_root/evals/fixtures`.
    Reads the fixture only; nothing is ever written under `fixtures_root`.
    """
    repo_root = Path(repo_root)
    fixtures_root = Path(fixtures_root) if fixtures_root is not None \
        else repo_root / "evals" / "fixtures"
    src = fixtures_root / fixture
    project, plan = src / "project", src / "plan.md"
    if not project.is_dir():
        raise FileNotFoundError("fixture project tree missing: %s" % project)
    if not plan.is_file():
        raise FileNotFoundError("fixture plan missing: %s" % plan)

    cell = Path(workspace) / fixture
    shutil.copytree(project, cell, ignore=_COPY_IGNORE)
    shutil.copy2(plan, cell / "plan.md")
    for part in ENGINE_REPO_PARTS:
        source, dest = repo_root / part, cell / part
        dest.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, dest, ignore=_COPY_IGNORE,
                            dirs_exist_ok=True)
        else:
            shutil.copy2(source, dest)

    _git(cell, "init", "-b", "main")
    _git(cell, "config", "user.name", _CELL_AUTHOR[0])
    _git(cell, "config", "user.email", _CELL_AUTHOR[1])
    _git(cell, "add", "-A")
    # gpgsign off / --no-verify: the operator's global config and hooks must
    # not be able to stall or reject a cell's one commit.
    _git(cell, "-c", "commit.gpgsign=false", "commit", "--no-verify",
         "-m", "ab-rig cell: %s" % fixture)
    return cell


def harvest_row(run_dir, meta):
    """Build one `runs.jsonl` row from a finished run dir.

    `meta` supplies fixture, armOverlap, runId, engineRef, exitCode, cellDir.
    wallClockSec spans the first and last event timestamps — each `ts` being
    epoch milliseconds, as the engine writes them, or an ISO-8601 'Z' string;
    tokens is the five-way sum over every `worker:end` meter; verdict is
    'approved' on a zero exit, else the last `driver:fail` verdict (or
    'failed'); waveShape is the task ids per wave from args.json; invalid is
    'no-events' when events.jsonl is missing or empty, else None.
    """
    run_dir = Path(run_dir)
    events = _read_events(run_dir / "events.jsonl")
    stamps = [t for t in (_parse_ts(e.get("ts")) for e in events) if t]
    tokens = _sum_meters(events)
    # Order on the datetime alone: the second element is a rendering, and the
    # two accepted stamp forms would not compare against each other.
    first = min(stamps, key=lambda s: s[0]) if stamps else None
    last = max(stamps, key=lambda s: s[0]) if stamps else None
    started = first[1] if first else None
    wall = round((last[0] - first[0]).total_seconds(), 1) if first else None
    return {
        "startedAt": started,
        "fixture": meta.get("fixture"),
        "armOverlap": meta.get("armOverlap"),
        "engine": "one-driver",
        "engineRef": meta.get("engineRef"),
        "runId": meta.get("runId"),
        "mode": "local",
        "wallClockSec": wall,
        "tokens": tokens,
        "outputTokens": tokens["output"],
        "verdict": _verdict(events, meta.get("exitCode")),
        "waveShape": _wave_shape(run_dir / "args.json"),
        "cellDir": meta.get("cellDir"),
        "invalid": None if events else "no-events",
    }


def _git(cwd, *args):
    return subprocess.run(("git",) + args, cwd=str(cwd), check=True,
                          capture_output=True, text=True)


def _read_events(path):
    """Parsed events.jsonl records, in file order. A truncated tail line (the
    engine was killed mid-write) is skipped, not fatal."""
    if not path.is_file():
        return []
    events = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            events.append(record)
    return events


def _iso_z(moment):
    """`2026-08-30T10:00:00.000Z` — the engine's own rendering of a stamp
    (`new Date(ts).toISOString()`, fleet/watch.mjs)."""
    return moment.astimezone(timezone.utc) \
        .isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_ts(raw):
    """(datetime, ISO-8601 'Z' string) for one event stamp, or None.

    A real run stamps `ts` as epoch **milliseconds** — the int from
    `Date.now()` in `makeEventLog` (fleet/run-waves.mjs), read back as a
    number by fleet/watch.mjs. Hand-written run dirs and unit fixtures use the
    ISO-8601 'Z' string. Both are accepted, because rejecting the numeric form
    would silently null out `startedAt`/`wallClockSec` on every real run —
    and wallClockSec is the headline fold-vs-serialize metric for #402, which
    the 0.1.0 rows in runs.jsonl already carry. `startedAt` is always the ISO
    string, so new rows stay comparable with those baseline rows.
    """
    if isinstance(raw, bool):          # bool is an int in Python; not a clock
        return None
    if isinstance(raw, (int, float)):
        try:
            moment = datetime.fromtimestamp(raw / 1000.0, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
        return (moment, _iso_z(moment))
    if not isinstance(raw, str) or not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        # A naive stamp would not subtract against an aware one; read it as
        # UTC, which is the only zone anything in this pipeline writes.
        moment = moment.replace(tzinfo=timezone.utc)
    return (moment, raw)


def _sum_meters(events):
    totals = {k: 0 for k in _METER_KEYS}
    totals["costUsd"] = 0.0
    for event in events:
        if event.get("kind") != "worker:end":
            continue
        meter = event.get("meter")
        if not isinstance(meter, dict):
            continue
        for key in _METER_KEYS:
            value = meter.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            totals[key] += value
    # Float addition of dollar amounts drifts (0.1 + 0.02); the row is
    # evidence a human reads, so round the money back to cents-and-then-some.
    totals["costUsd"] = round(totals["costUsd"], 6)
    return totals


def _verdict(events, exit_code):
    if exit_code == 0:
        return "approved"
    fails = [e.get("verdict") for e in events
             if e.get("kind") == "driver:fail" and e.get("verdict")]
    return fails[-1] if fails else "failed"


def _wave_shape(args_path):
    """Task ids per wave, e.g. [["1", "2"], ["3"]]."""
    if not args_path.is_file():
        return []
    try:
        args = json.loads(args_path.read_text())
    except json.JSONDecodeError:
        return []
    waves = args.get("waves") if isinstance(args, dict) else None
    if not isinstance(waves, list):
        return []
    shape = []
    for wave in waves:
        if not isinstance(wave, list):
            continue
        shape.append([str(t.get("id")) if isinstance(t, dict) else str(t)
                      for t in wave])
    return shape
