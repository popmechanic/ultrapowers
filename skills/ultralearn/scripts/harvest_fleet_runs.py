#!/usr/bin/env python3
"""ultralearn fleet harvester — turn a One Driver fleet run's evidence
directory into the same bundle the reading lenses already consume.

The only harvester left. Its Workflow-era predecessor detected runs by a
`Workflow` tool call and scanned ~/.claude/projects; the Workflow tool was
deleted in PR #434 and fleet runs execute in sandboxes, so it could never see
them, and it is gone. Its live readers survive it in `_readers` (records,
block_text, iter_blocks_indexed, engine_epoch_at), and this module writes the
SAME bundle shape into the SAME cache, because the bundle is the interface:
merge_ledger.bundle_lookups and the five lenses then work untouched.

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
import re
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
import _readers                # noqa: E402

SUITE_OUTPUT_TAIL = 2000       # chars of `tests.output` kept; the head is boilerplate
AUDIT_UNIT_NOTE = ("outputTokens = the worker:end meter's output field, summed "
                   "over workers (the engine's own accounting, not a transcript sum)")

# The six files `fleet/CONTRACT.md` puts under `.ultrapowers/runs/<N>/` on the
# evidence branch. `fleet/janitor.mjs` reads the same paths through the same
# API; this is that read, in Python.
EVIDENCE_FILES = ("status.json", "receipt.json", "gate-receipt.json",
                  "report.json", "events.jsonl", "engine.log")
GH_TIMEOUT = 120               # seconds; one contents read is a few KB

# The marker the #702 reducer writes ahead of a tool_result's text, e.g.
# `[tool_result: 727 chars, is_error] `. It is the slicer's bookkeeping, not
# the denial's reason, so it comes off before the line is kept.
_RESULT_PREFIX = re.compile(r"^\[tool_result: \d+ chars(?:, is_error)?\]\s*")
# What a denied tool call reads as in a transcript slice — the CLI's own
# wording, the only marker a reduced record carries.
DENIAL_MARKER = "Permission to use"


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


def evidence_tag(run):
    """The tag a run's record is kept under once it is published (#624). The
    evidence branch is deleted at publish, so a swept run answers here and
    nowhere else; a run the sweep has not reached yet answers on the branch."""
    return f"ultra/evidence/run-{_run_number(run)}"


def _evidence_api_path(target, run, name, ref=None):
    """The contents read for one evidence file at one ref. GitHub resolves
    `?ref=` to a branch or a tag alike, so branch and tag differ only here."""
    return (f"repos/{target}/contents/.ultrapowers/runs/{_run_number(run)}/{name}"
            f"?ref={ref or evidence_branch(run)}")


def _commit_api_path(target, ref):
    """The commits read that turns a ref into the sha it points at. The
    endpoint answers a commit object for a branch name, a tag name or a sha
    alike, so one path serves both refs."""
    return f"repos/{target}/commits/{ref}"


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


def _gh_api_listing(api_path):
    """The JSON array a contents read of a DIRECTORY answers, or None.

    `_gh_api` cannot read this: it calls `.get("content")` on the parsed body,
    and a directory answers a LIST of `{name, path, type, …}` entries with no
    `content` at all. The absence rule is the file reader's — gh answering
    non-zero is an *answer* (that directory is not on the ref, which is what a
    run whose engine wrote no transcripts looks like), not a failure.
    """
    proc = subprocess.run(["gh", "api", api_path], capture_output=True,
                          text=True, timeout=GH_TIMEOUT)
    if proc.returncode != 0:
        return None
    try:
        listing = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        swallow("gh api answered a non-JSON body for a directory; treating the "
                "directory as absent", exc)
        return None
    if not isinstance(listing, list):
        # A path that exists but is a FILE answers an envelope, not an array.
        # Same standing as a 404: there is no directory here to walk.
        return None
    return listing


def _gh_api_object(api_path):
    """The JSON OBJECT a non-contents read answers, or None.

    Neither existing reader can serve this: `_gh_api` decodes a `content` field
    the commits endpoint does not carry, and `_gh_api_listing` refuses a body
    that is not a list. The absence rule is theirs — gh answering non-zero is an
    *answer* (that ref is not there), not a failure.
    """
    proc = subprocess.run(["gh", "api", api_path], capture_output=True,
                          text=True, timeout=GH_TIMEOUT)
    if proc.returncode != 0:
        return None
    try:
        body = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        swallow("gh api answered a non-JSON body for an object read; "
                "treating the answer as absent", exc)
        return None
    return body if isinstance(body, dict) else None


def fetch_evidence(target: str, run: str, dest: Path) -> Path:
    """Pull one run's committed record off `ultra/evidence-run-<N>`, or off
    `ultra/evidence/run-<N>` once that branch is gone, into `dest`, and return
    `dest` — a directory holding an `events.jsonl`, which is exactly what
    `discover_run_dirs` already accepts.

    The branch is probed first and the tag second, exactly once: the tag is
    tried only for the first file that answers absent *before anything at all
    has landed*, and if that read lands, every later file is read at the tag.
    A run still on the branch therefore costs the same six reads it did at
    BASE, and a swept run costs one extra 404 — never one per missing file,
    which would turn a run with two absences on the branch into eight reads.
    Either way the result set is the same: the branch while the sweep to tags
    is pending, the tag after it.

    Per file, absence is advisory: `gh` exiting non-zero means that file is not
    on the ref, which is marked and skipped so the run still bundles.
    `events.jsonl` is the exception — without a timeline there is no bundle —
    and so is a target that could not be read at all. Both raise `FailedLookup`
    naming the target, the run and the ref; a run on neither ref names both.
    """
    branch, tag = evidence_branch(run), evidence_tag(run)
    number = _run_number(run)
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    def read(name, ref):
        try:
            return _gh_api(_evidence_api_path(target, run, name, ref))
        except (OSError, subprocess.SubprocessError) as exc:
            raise FailedLookup(
                f"{target} run {number}: cannot read {ref} "
                f"with gh ({exc})") from exc

    ref = branch
    tag_tried = False
    landed = []
    for name in EVIDENCE_FILES:
        body = read(name, ref)
        if body is None and not landed and not tag_tried:
            tag_tried = True
            body = read(name, tag)
            if body is not None:
                ref = tag
        if body is None:
            _warn(f"{target} run {number}: no {name} on {ref}; "
                  f"skipping that file")
            continue
        (dest / name).write_bytes(body)
        landed.append(name)
    if not landed:
        raise FailedLookup(
            f"{target} run {number}: nothing readable on {branch} or {tag} "
            f"— gh answered non-zero for all {len(EVIDENCE_FILES)} files")
    if "events.jsonl" not in landed:
        raise FailedLookup(
            f"{target} run {number}: no events.jsonl on {ref} "
            f"— a run with no timeline cannot bundle")

    # The sha the record was read at, resolved once at the ref the six files
    # above landed on — after both raises, so a run with nothing readable or no
    # timeline never spends the call. It is what the incremental skip compares:
    # a cached bundle whose `evidenceSha` differs from this one was built from a
    # record that has since moved, and is rebuilt rather than skipped.
    sha = _fetch_commit_sha(target, run, ref, number)
    (dest / "evidence-ref.json").write_text(
        json.dumps({"target": target, "ref": ref, "sha": sha}))

    # The worker slices under `transcripts/` (#702), read LAST and at the ref
    # the six files above resolved: a run that raised — nothing readable, or no
    # timeline — never spends the call, and a swept run's listing goes to the
    # tag with the rest of its record. One listing, then one contents read per
    # entry the listing calls a file: the API answers a directory with an
    # array, not with its files' bodies.
    entries = _fetch_listing(target, run, ref, number)
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        name = entry.get("name")
        # A listing is remote data: a name with a separator in it would write
        # outside `dest/transcripts/`.
        if not isinstance(name, str) or not name or "/" in name or name in (".", ".."):
            continue
        body = read(f"transcripts/{name}", ref)
        if body is None:
            _warn(f"{target} run {number}: no transcripts/{name} on {ref}; "
                  f"skipping that transcript")
            continue
        (dest / "transcripts").mkdir(parents=True, exist_ok=True)
        (dest / "transcripts" / name).write_bytes(body)
    return dest


def _fetch_commit_sha(target, run, ref, number):
    """The 40-hex commit sha `ref` points at, or None when it cannot be read.

    A ref that answers nothing is advisory, exactly as an absent evidence file
    is: one line on stderr naming the run and the ref, a `null` sha in the
    bundle, and the run still bundles. Only a read that could not be made at
    all — no `gh`, a timeout — is a `FailedLookup`, the same standing the six
    file reads give it.
    """
    try:
        commit = _gh_api_object(_commit_api_path(target, ref))
    except (OSError, subprocess.SubprocessError) as exc:
        raise FailedLookup(
            f"{target} run {number}: cannot read {ref} with gh ({exc})") from exc
    sha = commit.get("sha") if commit else None
    if not isinstance(sha, str) or not sha:
        _warn(f"{target} run {number}: no commit sha for {ref}; "
              f"the bundle records evidenceSha null")
        return None
    return sha


def _fetch_listing(target, run, ref, number):
    """The `transcripts/` listing at `ref`, or `[]` when there is none.

    An absent directory is the ordinary shape of a run whose engine wrote no
    transcripts, so it is one line on stderr and no `transcripts/` directory —
    never a `FailedLookup`, which would cost the whole run its bundle over
    evidence the lenses treat as optional.
    """
    try:
        entries = _gh_api_listing(_evidence_api_path(target, run, "transcripts", ref))
    except (OSError, subprocess.SubprocessError) as exc:
        raise FailedLookup(
            f"{target} run {number}: cannot read {ref} with gh ({exc})") from exc
    if entries is None:
        _warn(f"{target} run {number}: no transcripts/ on {ref}; "
              f"the run bundles without worker slices")
        return []
    return entries


def discover_run_dirs(path, workdir):
    """Resolve a user-supplied path to fleet run directories.

    Accepts a bare run dir, any tree containing them, or a sandbox-logs
    tarball (unpacked under `workdir`). A run dir is exactly a directory
    holding an `events.jsonl` — pre-#421 runs (10-23) have none and are
    correctly invisible here; they are read the commissioned way.

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


def _worker_index(workers):
    """`sessionId` -> that worker attempt, for the label/role join."""
    return {w.get("sessionId"): w for w in workers
            if isinstance(w, dict) and w.get("sessionId")}


def _envelope_denials(run_dir, by_session):
    """One line per `permission_denials` entry in every `workers/*/envelope.json`.

    The worker's own record, and the complete one: the confine hook is attached
    to the write-capable roles only, so a reviewer's denial exists here and
    nowhere else. Shaped exactly as `fleet/run-worker.mjs`'s
    `recordEnvelopeDenials` shapes the lines it appends to
    `confine-denials.jsonl`, so a run that has both sources reads uniformly.
    """
    lines = []
    for path in sorted(Path(run_dir).glob("workers/*/envelope.json")):
        envelope = _read_json(path)
        if not isinstance(envelope, dict):
            continue
        denials = envelope.get("permission_denials")
        if not isinstance(denials, list):
            continue
        # Session id is the join (a retried label owns two worker dirs); the
        # directory name is the fallback the driver's own naming affords.
        worker = by_session.get(envelope.get("session_id")) or {}
        label = worker.get("label") or path.parent.name.replace("_", ":")
        role = worker.get("role")
        for d in denials:
            if not isinstance(d, dict):
                continue
            tool_input = d.get("tool_input")
            lines.append({
                "source": "envelope", "label": label, "role": role,
                "tool": d.get("tool_name") or d.get("tool") or None,
                "reason": d.get("reason") or d.get("message") or None,
                "toolInput": (json.dumps(tool_input, default=str)
                              if tool_input is not None else None),
            })
    return lines


def _transcript_denials(run_dir, by_session):
    """One line per denied tool call visible in the #702 worker slices.

    A harvested run carries no envelopes at all — `receipt.json`, `status.json`
    and `worker:end` all omit `permission_denials` — so the slice under
    `transcripts/` is the only denial source the evidence tag has. It is a
    FLOOR, not a census: the slice's head/tail cut can drop a denial.
    """
    lines = []
    for path in sorted(Path(run_dir).glob("transcripts/*.jsonl")):
        try:
            records = _readers.records(path)
        except (OSError, ValueError) as exc:
            swallow("an unreadable transcript slice contributes no denials; "
                    "the other slices still do", exc)
            _warn(f"unreadable {path}: {exc}")
            continue
        session_id = next((r["sessionId"] for r in records
                           if isinstance(r, dict) and isinstance(r.get("sessionId"), str)),
                          path.stem)
        worker = by_session.get(session_id) or {}
        tools = {}
        for _idx, _record, block in _readers.iter_blocks_indexed(
                [r for r in records if isinstance(r, dict)]):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                # Seen earlier in the file than the result that names its id —
                # the assistant's call is what gives the denial a tool name.
                tools[block.get("id")] = block.get("name")
                continue
            if block.get("type") != "tool_result" or not block.get("is_error"):
                continue
            text = _readers.block_text(block)
            if DENIAL_MARKER not in text:
                continue
            lines.append({
                "source": "transcript", "label": worker.get("label"),
                "role": worker.get("role"), "sessionId": session_id,
                "tool": tools.get(block.get("tool_use_id")),
                "reason": _RESULT_PREFIX.sub("", text),
            })
    return lines


def _confine_denials(run_dir, workers):
    """`bundle.confineDenials`: envelope + transcript + file lines, or None.

    None is not zero. `confine-denials.jsonl` is the hook's own ledger and a
    harvested run has none — before this, every fetched run reported `[]`, and
    `[]` reads as "counted, and none happened" when the truth was "the record
    carries nothing to count". So the empty list is reserved for a run that has
    at least one source and no denials in it, and a run with no source at all
    answers `null`.
    """
    run_dir = Path(run_dir)
    by_session = _worker_index(workers)
    envelopes = _envelope_denials(run_dir, by_session)
    transcripts = _transcript_denials(run_dir, by_session)
    file_lines = _read_jsonl(run_dir / "confine-denials.jsonl")
    has_source = (any(run_dir.glob("workers/*/envelope.json"))
                  or any(run_dir.glob("transcripts/*.jsonl"))
                  or (run_dir / "confine-denials.jsonl").exists())
    if not has_source:
        return None
    return envelopes + transcripts + file_lines


def _carries_a_finding(bundle):
    """Whether the bundle holds anything a lens could learn from.

    The four evidence payloads a run contributes beyond its own timeline:
    worker meters, the suite report, the gate receipt, confine denials. A
    bundle with none of them is real and readable — it just found nothing —
    so it is written and reported LOOKED-EMPTY, never refused."""
    return bool(bundle["audit"]["agents"]) or bundle["report"] is not None \
        or bundle["gateReport"] is not None or bool(bundle["confineDenials"])


def cache_key(run_id, opened_at):
    """The cache directory one run's bundle is written under: `run-30-2026-08-30`
    — the fleet `runId` and the UTC day its event log opened.

    The bare `runId` was ambiguous: fleet numbering restarts, so `run-30` names
    more than one run over time and the second one's harvest read as already
    cached. The opening day disambiguates them. A run whose log carries no
    timestamp at all has no day to name and keeps the bare id.
    """
    if isinstance(opened_at, (int, float)) and not isinstance(opened_at, bool):
        date = (datetime.fromtimestamp(opened_at / 1000, timezone.utc)
                .strftime("%Y-%m-%d"))
        return f"{run_id}-{date}"
    return str(run_id)


def read_evidence_ref(run_dir):
    """The `{target, ref, sha}` record `fetch_evidence` leaves beside the six
    files, or `{}` for a local run directory that never had one."""
    path = Path(run_dir) / "evidence-ref.json"
    record = _read_json(path) if path.exists() else None
    return record if isinstance(record, dict) else {}


def build_fleet_bundle(run_dir, cache_dir, *, origin="home", engine_version=None,
                       budget=fleet_slice.WORKER_BUDGET):
    """Write <cache_dir>/runs/<runId>-<date>/{bundle.json,slice.md}. Returns the
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
        engine = _readers.engine_epoch_at(as_of, origin)

    # The record this run was read at — absent for a local run directory, which
    # was never read off a ref at all, and `None` in all three keys there.
    evidence_ref = read_evidence_ref(run_dir)

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
        # #759: the fold rows as parsed, never re-shaped and never cut — a fold
        # decision is read off `pathsJoined`/`pathsConflicted`/
        # `resolversDispatched`/`suite`/`disposition`, and `events` only counts
        # them. `events` is already id-sorted, so this list is too.
        "publishFold": [e for e in events
                        if e.get("kind") == "driver:publish-fold"],
        "planningFound": False,
        "confineDenials": _confine_denials(run_dir, summary.get("workers") or []),
        "evidenceSha": evidence_ref.get("sha"),
        "evidenceRef": evidence_ref.get("ref"),
        "target": evidence_ref.get("target"),
    }

    if not _carries_a_finding(bundle):
        report_looked_empty(f"{run_id}: bundle carries no worker, report, "
                            f"gate receipt, or confine-denial evidence")

    out = Path(cache_dir).expanduser() / "runs" / cache_key(run_id, opened)
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    # #415: the worker's verdict is its envelope, not a transcript turn — pass
    # the run dir's `workers/` so each slice section carries it. #702: and the
    # run dir itself, because a HARVESTED run has its transcripts under
    # `<run dir>/transcripts/` and no `claude/projects/` — without it every
    # fetched run's slice read `_no transcript found_`.
    (out / "slice.md").write_text(fleet_slice.build_slice(
        fleet_events.render_timeline(events), summary.get("workers") or [],
        projects_root, budget, workers_root=run_dir / "workers",
        run_dir=run_dir))
    return out


def _is_already_cached(cache, key, run_dir):
    """Whether the bundle at `key` was built from the very record this run dir
    was just read at.

    A bundle at the key is not enough: a run's record moves — a re-publish, a
    re-tag, a swept run's tag pointing at a new commit — and a harvest that
    skipped on the key alone kept serving the stale bundle forever. So the
    fetched sha must equal the cached bundle's `evidenceSha`; a mismatch is a
    rebuild. A local run directory has no record and no sha, and `None ==
    None` keeps its second harvest a skip rather than a rebuild.
    """
    cached = Path(cache) / "runs" / key / "bundle.json"
    if not cached.exists():
        return False
    bundle = _read_json(cached)
    if not isinstance(bundle, dict):
        return False
    return bundle.get("evidenceSha") == read_evidence_ref(run_dir).get("sha")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*",
                    help="fleet run dir, a tree containing them, or a sandbox-logs tarball")
    ap.add_argument("--cache", default="~/.claude/ultralearn")
    ap.add_argument("--evidence", metavar="OWNER/REPO",
                    help="pull each --run's committed record from this target's "
                         "ultra/evidence-run-<N> branch, or its "
                         "ultra/evidence/run-<N> tag once that branch is gone")
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
            summary = fleet_events.summarize_events(fleet_events.read_events(d))
            run_id = summary.get("runId")
            if run_id and not args.force and _is_already_cached(
                    cache, cache_key(run_id, summary.get("openedAt")), d):
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
