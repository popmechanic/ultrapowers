#!/usr/bin/env python3
"""ultralearn fleet harvester — turn a One Driver fleet run's evidence
directory into the same bundle the reading lenses already consume.

SIBLING of harvest_runs.py, not an extension. That module detects runs by a
`Workflow` tool_result and scans ~/.claude/projects; the Workflow tool was
deleted in PR #434 and fleet runs execute in sandboxes, so it can never see
them. It stays frozen — it still correctly harvests runs 21-23 and sequential
drains. This module shares its readers (_records, slice_transcript,
engine_epoch_at) and writes the SAME bundle shape into the SAME cache, because
the bundle is the interface: merge_ledger.bundle_lookups and the five lenses
then work untouched.

Read-only and advisory: malformed or missing input is skipped with a
diagnostic, never raised.
"""
from __future__ import annotations

import argparse
import json
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fleet_events            # noqa: E402
import fleet_fetch             # noqa: E402
import fleet_slice             # noqa: E402
import harvest_runs            # noqa: E402

SUITE_OUTPUT_TAIL = 2000       # chars of `tests.output` kept; the head is boilerplate
AUDIT_UNIT_NOTE = ("outputTokens = the worker:end meter's output field, summed "
                   "over workers (the engine's own accounting, not a transcript sum)")


def _warn(msg):
    print(f"harvest_fleet_runs: {msg}", file=sys.stderr)


def _read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        _warn(f"unreadable {path}: {exc}")
        return None


def _read_jsonl(path):
    out = []
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        # A line that parses to a bare string/list is malformed for our readers,
        # which all do `.get()`. Skip with a diagnostic rather than hand a
        # non-dict downstream (advisory contract).
        if not isinstance(rec, dict):
            _warn(f"{path}: skipping a non-object record")
            continue
        out.append(rec)
    return out


def discover_run_dirs(path, workdir):
    """Resolve a user-supplied path to fleet run directories.

    Accepts a bare run dir, any tree containing them, or a sandbox-logs
    tarball (unpacked under `workdir`). A run dir is exactly a directory
    holding an `events.jsonl` — pre-#421 runs (10-23) have none and are
    correctly invisible here; harvest_runs.py still owns 21-23.
    """
    path = Path(path)
    if not path.exists():
        _warn(f"no such path: {path}")
        return []
    if path.is_file():
        if not tarfile.is_tarfile(path):
            _warn(f"not a directory or tarball: {path}")
            return []
        # NOT `path.stem`: fetch_bundles names every bundle's tarball
        # `sandbox-logs.tgz`, so a stem-keyed destination is the SAME directory
        # for all of them — each unpack then re-reports every run extracted so
        # far (8 tarballs -> 36 run dirs), and same-named run dirs overwrite
        # each other. Key on the bundle directory too.
        dest = Path(workdir) / f"{path.parent.name}-{path.stem}"
        dest.mkdir(parents=True, exist_ok=True)
        try:
            with tarfile.open(path) as tf:
                # Refuse absolute paths and parent escapes before extracting.
                members = [m for m in tf.getmembers()
                           if not m.name.startswith("/") and ".." not in Path(m.name).parts]
                tf.extractall(dest, members=members)
        except (OSError, tarfile.TarError) as exc:
            _warn(f"cannot unpack {path}: {exc}")
            return []
        return discover_run_dirs(dest, workdir)
    if (path / "events.jsonl").is_file():
        return [path]
    return sorted(p.parent for p in path.rglob("events.jsonl") if p.is_file())


def _fold_audit(workers):
    """The audit, folded from the event log's per-worker meters. The engine's
    own accounting — no transcript re-summing, so it cannot drift from what
    the run was actually billed."""
    agents, totals = [], {"agents": 0, "inputTokens": 0, "outputTokens": 0,
                          "cacheReadTokens": 0, "cacheCreationTokens": 0, "costUsd": 0.0}
    for w in workers:
        m = w.get("meter") or {}
        agents.append({
            "label": w.get("label"), "role": w.get("role"),
            "sessionId": w.get("sessionId"), "model": w.get("model"),
            "class": w.get("class"), "exitCode": w.get("exitCode"),
            "timedOut": w.get("timedOut"), "refused": w.get("refused"),
            "wallSec": w.get("wallSec"),
            "inputTokens": m.get("input"), "outputTokens": m.get("output"),
            "cacheReadTokens": m.get("cacheRead"),
            "cacheCreationTokens": m.get("cacheCreation"),
            "costUsd": m.get("costUsd"), "models": m.get("models"),
        })
        totals["agents"] += 1
        for tk, mk in (("inputTokens", "input"), ("outputTokens", "output"),
                       ("cacheReadTokens", "cacheRead"),
                       ("cacheCreationTokens", "cacheCreation"),
                       ("costUsd", "costUsd")):
            v = m.get(mk)
            if isinstance(v, (int, float)):
                totals[tk] += v
    totals["costUsd"] = round(totals["costUsd"], 6)
    return {"agents": agents, "totals": totals, "unitNote": AUDIT_UNIT_NOTE}


def _trim_report(report):
    """report.json verbatim, minus the suite's multi-kilobyte output — whose
    head is pytest boilerplate and whose tail is the verdict a lens needs."""
    if not isinstance(report, dict):
        return None
    out = dict(report)
    tests = out.get("tests")
    if isinstance(tests, dict):
        tests = dict(tests)
        text = tests.pop("output", None)
        if isinstance(text, str):
            tests["outputTail"] = text[-SUITE_OUTPUT_TAIL:]
        out["tests"] = tests
    return out


def build_fleet_bundle(run_dir, cache_dir, *, origin="home", engine_version=None,
                       budget=fleet_slice.WORKER_BUDGET):
    """Write <cache_dir>/runs/<runId>/{bundle.json,slice.md}. Returns the
    directory, or None when the run dir carries no usable event log."""
    run_dir = Path(run_dir)
    events = fleet_events.read_events(run_dir)
    summary = fleet_events.summarize_events(events)
    run_id = summary.get("runId")
    if not run_id:
        _warn(f"{run_dir}: no run:open event — not a fleet run directory")
        return None

    gate_report = _read_json(run_dir / "gate-receipt.json") \
        if (run_dir / "gate-receipt.json").exists() else None
    terminus = "unknown"
    if isinstance(gate_report, dict):
        verdict = (gate_report.get("gateCheck") or {}).get("verdict") \
            or gate_report.get("verdict")
        if isinstance(verdict, str) and verdict:
            terminus = verdict

    fleet_run = _read_json(run_dir / "fleet-run.json") \
        if (run_dir / "fleet-run.json").exists() else None
    plan_path = (fleet_run or {}).get("planPath")

    opened = summary.get("openedAt")
    as_of = (datetime.fromtimestamp(opened / 1000, timezone.utc)
             .strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(opened, (int, float)) else None)
    if engine_version:
        engine = {"epoch": engine_version, "asOf": as_of, "basis": "explicit"}
    else:
        engine = harvest_runs.engine_epoch_at(as_of, origin)

    projects_root = run_dir / "claude" / "projects"
    bundle = {
        "runId": run_id,
        "sessionId": None,
        "projectSlug": run_dir.name,
        "origin": origin,
        "sessionKind": "engine",
        "engineVersion": engine,
        "planPath": plan_path,
        "transcriptDir": str(projects_root),
        "gateReport": gate_report,
        "terminus": terminus,
        "truncated": terminus in ("NEEDS_ACK", "BLOCKED", "unknown"),
        "audit": _fold_audit(summary.get("workers") or []),
        "report": _trim_report(_read_json(run_dir / "report.json")
                               if (run_dir / "report.json").exists() else None),
        "events": summary,
        "planningFound": False,
        "confineDenials": _read_jsonl(run_dir / "confine-denials.jsonl"),
    }

    out = Path(cache_dir).expanduser() / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    # #415: the worker's verdict is its envelope, not a transcript turn — pass
    # the run dir's `workers/` so each slice section carries it.
    (out / "slice.md").write_text(fleet_slice.build_slice(
        fleet_events.render_timeline(events), summary.get("workers") or [],
        projects_root, budget, workers_root=run_dir / "workers"))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*",
                    help="fleet run dir, a tree containing them, or a sandbox-logs tarball")
    ap.add_argument("--cache", default="~/.claude/ultralearn")
    ap.add_argument("--remote", metavar="HOST",
                    help="pull evidence bundles from an orchestrator over ssh")
    ap.add_argument("--remote-root", default=fleet_fetch.DEFAULT_REMOTE_ROOT)
    ap.add_argument("--run", action="append", dest="run_ids", metavar="run-30",
                    help="restrict --remote to these run ids (repeatable)")
    ap.add_argument("--origin", default="home", choices=("home", "foreign"))
    ap.add_argument("--engine-version", default=None)
    ap.add_argument("--slice-budget", type=int, default=fleet_slice.WORKER_BUDGET)
    ap.add_argument("--force", action="store_true",
                    help="rebuild bundles that are already cached")
    args = ap.parse_args(argv)

    cache = Path(args.cache).expanduser()
    with tempfile.TemporaryDirectory(prefix="ultralearn-fleet-") as tmp:
        paths = [Path(p) for p in args.paths]
        if args.remote:
            paths += fleet_fetch.fetch_bundles(
                args.remote, Path(tmp) / "remote",
                remote_root=args.remote_root, run_ids=args.run_ids)
        run_dirs = []
        for p in paths:
            run_dirs += discover_run_dirs(p, Path(tmp) / "unpack")

        built, skipped = 0, 0
        for d in run_dirs:
            run_id = fleet_events.summarize_events(
                fleet_events.read_events(d)).get("runId")
            if run_id and not args.force and (cache / "runs" / run_id / "bundle.json").exists():
                skipped += 1
                continue
            if build_fleet_bundle(d, cache, origin=args.origin,
                                  engine_version=args.engine_version,
                                  budget=args.slice_budget):
                built += 1

    print(f"{built} bundle(s) written to {cache}/runs "
          f"({skipped} already cached, {len(run_dirs)} run dir(s) seen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
