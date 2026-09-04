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

Read-only, and loud about its inputs (#489). Evidence that cannot be read at
all is a FAILED-LOOKUP naming the run — the harvest keeps going, so N runs with
M unreadable inputs yield N-M bundles and M `FAILED-LOOKUP:` lines, and only a
harvest where nothing at all landed exits 2. Evidence that reads fine but
carries nothing to learn from is a LOOKED-EMPTY and still bundles. The two are
different facts; spelled as one silent skip they read identically downstream.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import (FailedLookup, report_failed_lookup,  # noqa: E402
                      report_looked_empty, swallow)
import fleet_events            # noqa: E402
import fleet_slice             # noqa: E402
import harvest_runs            # noqa: E402

SUITE_OUTPUT_TAIL = 2000       # chars of `tests.output` kept; the head is boilerplate
AUDIT_UNIT_NOTE = ("outputTokens = the worker:end meter's output field, summed "
                   "over workers (the engine's own accounting, not a transcript sum)")

# The six files `fleet/CONTRACT.md` puts under `.ultrapowers/runs/<N>/` on the
# evidence branch. `fleet/janitor.mjs` reads the same paths through the same
# API; this is that read, in Python.
EVIDENCE_FILES = ("status.json", "receipt.json", "gate-receipt.json",
                  "report.json", "events.jsonl", "engine.log")
GH_TIMEOUT = 120               # seconds; one contents read is a few KB


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


def _run_number(run):
    """`7`, `run-7` and ` run-7 ` all name run 7. The evidence branch and the
    contents path both spell the run as a bare number, so normalise once here
    rather than at each of the two spellings."""
    text = str(run).strip()
    return text[len("run-"):] if text.startswith("run-") else text


def evidence_branch(run):
    """The branch `fleet/janitor.mjs` publishes a run's record on."""
    return f"ultra/evidence-run-{_run_number(run)}"


def _evidence_api_path(target, run, name):
    return (f"repos/{target}/contents/.ultrapowers/runs/{_run_number(run)}/{name}"
            f"?ref={evidence_branch(run)}")


def _gh_api(api_path):
    """`gh api <path>` decoded to the file's bytes, or None when gh answered
    non-zero — an `HTTP 404` is an *answer*: that path is not on the branch,
    which the janitor also treats as an absence rather than a failure.

    Raises `OSError` (no `gh` on PATH) or `subprocess.SubprocessError` (a
    timeout) when the read could not be made at all — that is not an absence,
    and the caller turns it into a `FailedLookup`.
    """
    proc = subprocess.run(["gh", "api", api_path], capture_output=True,
                          text=True, timeout=GH_TIMEOUT)
    if proc.returncode != 0:
        return None
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        # A contents read that answered 0 with a non-envelope body is not a
        # file we can decode. Same standing as a 404: absent, not fatal.
        swallow("gh api answered a non-JSON body; treating the file as absent",
                exc)
        return None
    content = envelope.get("content")
    if not isinstance(content, str):
        return None
    # `content` is base64 with the API's newline wrapping; b64decode drops
    # characters outside the alphabet, so the wrapping needs no stripping.
    return base64.b64decode(content)


def fetch_evidence(target: str, run: str, dest: Path) -> Path:
    """Pull one run's committed record off `ultra/evidence-run-<N>` into
    `dest`, and return `dest` — a directory holding an `events.jsonl`, which is
    exactly what `discover_run_dirs` already accepts.

    Per file, absence is advisory: `gh` exiting non-zero means that file is not
    on the branch, which is marked and skipped so the run still bundles.
    `events.jsonl` is the exception — without a timeline there is no bundle —
    and so is a target that could not be read at all. Both raise `FailedLookup`
    naming the target, the run and the branch.
    """
    branch = evidence_branch(run)
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    landed = []
    for name in EVIDENCE_FILES:
        try:
            body = _gh_api(_evidence_api_path(target, run, name))
        except (OSError, subprocess.SubprocessError) as exc:
            raise FailedLookup(
                f"{target} run {_run_number(run)}: cannot read {branch} "
                f"with gh ({exc})") from exc
        if body is None:
            _warn(f"{target} run {_run_number(run)}: no {name} on {branch}; "
                  f"skipping that file")
            continue
        (dest / name).write_bytes(body)
        landed.append(name)
    if not landed:
        raise FailedLookup(
            f"{target} run {_run_number(run)}: nothing readable on {branch} "
            f"— gh answered non-zero for all {len(EVIDENCE_FILES)} files")
    if "events.jsonl" not in landed:
        raise FailedLookup(
            f"{target} run {_run_number(run)}: no events.jsonl on {branch} "
            f"— a run with no timeline cannot bundle")
    return dest


def discover_run_dirs(path, workdir):
    """Resolve a user-supplied path to fleet run directories.

    Accepts a bare run dir, any tree containing them, or a sandbox-logs
    tarball (unpacked under `workdir`). A run dir is exactly a directory
    holding an `events.jsonl` — pre-#421 runs (10-23) have none and are
    correctly invisible here; harvest_runs.py still owns 21-23.

    Raises `FailedLookup` when the path could not be read at all; returns an
    empty list when it read fine and simply holds no fleet runs. The caller
    decides what a failure costs — this only refuses to confuse the two.
    """
    path = Path(path)
    if not path.exists():
        raise FailedLookup(f"no such evidence path: {path}")
    if path.is_file():
        if not tarfile.is_tarfile(path):
            raise FailedLookup(f"not a fleet run directory or tarball: {path}")
        # NOT `path.stem`: a sandbox-logs pull names every bundle's tarball
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
        # EOFError, not just TarError: a tarball truncated mid-transfer opens
        # cleanly (`is_tarfile` only reads the first header) and dies in the
        # gzip stream during extraction. Uncaught, one bad bundle killed the
        # whole harvest.
        except (OSError, EOFError, tarfile.TarError) as exc:
            raise FailedLookup(f"cannot unpack {path}: {exc}") from exc
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


def _carries_a_finding(bundle):
    """Whether the bundle holds anything a lens could learn from.

    The four evidence payloads a run contributes beyond its own timeline:
    worker meters, the suite report, the gate receipt, confine denials. A
    bundle with none of them is real and readable — it just found nothing —
    so it is written and reported LOOKED-EMPTY, never refused."""
    return bool(bundle["audit"]["agents"]) or bundle["report"] is not None \
        or bundle["gateReport"] is not None or bool(bundle["confineDenials"])


def build_fleet_bundle(run_dir, cache_dir, *, origin="home", engine_version=None,
                       budget=fleet_slice.WORKER_BUDGET):
    """Write <cache_dir>/runs/<runId>/{bundle.json,slice.md}. Returns the
    directory, or None when the run dir carries no usable event log — in which
    case nothing is written and the refusal is a `FAILED-LOOKUP:` naming the
    run."""
    run_dir = Path(run_dir)
    events = fleet_events.read_events(run_dir)
    # Zero events after parse is the #471 shape: a bundle that could not have
    # carried a finding in the first place. Refuse it before the cache sees it
    # — a structurally empty bundle passes shape-only smoke forever.
    if not events:
        report_failed_lookup(f"{run_dir}: bundle would carry zero events — refused")
        return None
    summary = fleet_events.summarize_events(events)
    run_id = summary.get("runId")
    if not run_id:
        report_failed_lookup(
            f"{run_dir}: no run:open event — not a fleet run directory")
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

    if not _carries_a_finding(bundle):
        report_looked_empty(f"{run_id}: bundle carries no worker, report, "
                            f"gate receipt, or confine-denial evidence")

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
    ap.add_argument("--evidence", metavar="OWNER/REPO",
                    help="pull each --run's committed record from this target's "
                         "ultra/evidence-run-<N> branch")
    ap.add_argument("--run", action="append", dest="run_ids", metavar="N",
                    help="run number to fetch with --evidence (repeatable); "
                         "`run-N` is accepted and normalised")
    ap.add_argument("--origin", default="home", choices=("home", "foreign"))
    ap.add_argument("--engine-version", default=None)
    ap.add_argument("--slice-budget", type=int, default=fleet_slice.WORKER_BUDGET)
    ap.add_argument("--force", action="store_true",
                    help="rebuild bundles that are already cached")
    args = ap.parse_args(argv)
    # A target with no run is not a harvest of everything: the contents API is
    # read per path, so there is no branch to enumerate. Refuse it here, in the
    # parser that knows --evidence, rather than looking at an empty corpus.
    if args.evidence and not args.run_ids:
        ap.error("--evidence needs at least one --run N")

    cache = Path(args.cache).expanduser()
    built = skipped = failed = 0
    with tempfile.TemporaryDirectory(prefix="ultralearn-fleet-") as tmp:
        paths = [Path(p) for p in args.paths]
        for run in (args.run_ids or []) if args.evidence else []:
            # One unfetchable run costs exactly itself, the same as one
            # unreadable local input below.
            try:
                paths.append(fetch_evidence(
                    args.evidence, run,
                    Path(tmp) / "evidence" / _run_number(run)))
            except FailedLookup as exc:
                report_failed_lookup(str(exc))
                failed += 1

        run_dirs = []
        for p in paths:
            # One unreadable input costs exactly itself: name it and keep
            # going, so N inputs with M failures still harvest N-M.
            try:
                found = discover_run_dirs(p, Path(tmp) / "unpack")
            except FailedLookup as exc:
                report_failed_lookup(str(exc))
                failed += 1
                continue
            if not found:
                report_looked_empty(f"{p}: no fleet run directories")
            run_dirs += found

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
            else:
                failed += 1

    print(f"{built} bundle(s) written to {cache}/runs "
          f"({skipped} already cached, {len(run_dirs)} run dir(s) seen, "
          f"{failed} failed)")
    # Exit 2 only when every input failed. A bundle that landed — or one that
    # was already cached — means the harvest did its job for that run, and a
    # partial failure must not look like a dead harvest to a caller.
    return 2 if failed and not built and not skipped else 0


if __name__ == "__main__":
    raise SystemExit(main())
