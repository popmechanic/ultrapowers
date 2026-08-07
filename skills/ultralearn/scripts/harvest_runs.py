#!/usr/bin/env python3
"""ultralearn harvester — detect real ultrapowers runs across projects and
build per-run bundles into a local cache. Read-only and advisory: malformed or
missing input is skipped with a diagnostic, never raised."""
from __future__ import annotations

import functools
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
import audit_run  # noqa: E402  (provides audit())

SLICE_KEYWORDS = ("wave", "integrationbranch", "/ultrapowers", "gate",
                  "transcript dir", "recommended", "depends-on")
SLICE_TURN_MAX = 4000  # chars; a pasted-file user turn beyond this is elided

ENGINE_ROLES = {"setup", "merge", "review", "reconcile", "integration"}


def _block_text(block):
    """Flatten a content block's text (handles nested tool_result content)."""
    if not isinstance(block, dict):
        return ""
    t = block.get("text")
    if isinstance(t, str):
        return t
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(_block_text(b) for b in c)
    return ""


def _iter_blocks(records):
    for r in records:
        content = (r.get("message") or {}).get("content")
        if isinstance(content, list):
            for b in content:
                yield r, b


def is_real_run(records):
    saw_workflow, saw_dir, saw_report = False, False, False
    for _r, b in _iter_blocks(records):
        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Workflow":
            saw_workflow = True
        if isinstance(b, dict) and b.get("type") == "tool_result":
            txt = _block_text(b)
            if "Transcript dir:" in txt:
                saw_dir = True
            if "integrationBranch" in txt:
                saw_report = True
    return saw_workflow and (saw_dir or saw_report)


SYNTHETIC_SLUG_PREFIXES = ("-tmp-", "-private-tmp-",
                           "-var-folders-", "-private-var-folders-")


def classify_origin(project_slug, home_slug):
    if project_slug.startswith(SYNTHETIC_SLUG_PREFIXES):
        return "synthetic"
    if project_slug == home_slug or project_slug.startswith(home_slug + "--"):
        return "home"
    return "foreign"


def slice_transcript(records):
    lines = []
    for r, b in _iter_blocks(records):
        rtype = r.get("type")
        txt = _block_text(b).strip()
        if not txt:
            continue
        if rtype == "user" and b.get("type") == "text":
            if len(txt) > SLICE_TURN_MAX:
                txt = txt[:SLICE_TURN_MAX] + f"\n…[truncated {len(txt) - SLICE_TURN_MAX} chars]"
            lines.append(f"**user:** {txt}")
        elif any(k in txt.lower() for k in SLICE_KEYWORDS):
            lines.append(f"**{rtype}:** {txt}")
    return "\n\n".join(lines)


def _plan_path(records):
    # Authoritative: the Workflow tool_use input carries the launch args, which
    # hold planPath. In the transcript `input.args` is a JSON STRING (sometimes a
    # dict); parse either form.
    for _r, b in _iter_blocks(records):
        if isinstance(b, dict) and b.get("type") == "tool_use" \
                and b.get("name") == "Workflow":
            args = (b.get("input") or {}).get("args")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = None
            if isinstance(args, dict):
                pp = args.get("planPath")
                if isinstance(pp, str) and pp.strip():
                    return pp.strip()
    # Fallback: a real `/ultrapowers <path>` invocation — skip the literal
    # `<plan-path>` placeholder that appears in skill prose (doc-dense sessions).
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        if "/ultrapowers " in txt:
            tail = txt.split("/ultrapowers ", 1)[1].split()[0].strip().strip("`")
            if tail and not tail.startswith("<"):
                return tail
    return None


def _balanced_json(txt, start):
    """Parse the JSON object beginning at txt[start] using brace matching, so
    trailing text or a later unrelated object does not corrupt the slice."""
    depth, in_str, esc = 0, False, False
    for i in range(start, len(txt)):
        c = txt[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(txt[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


_RUN_DIR_STAMP = re.compile(r"/run-([^/\s]+)$")


def session_registry(records):
    """Every stamp this session actually launched (#113/#118): the structural
    source of truth for receipt attribution, so a foreign run's evidence can
    no longer be attached to a session that never launched it.

    Sources: every Workflow tool_use whose parsed input.args carries a
    runDir matching '…/run-<stamp>' (planPath from those same args keys
    planPathsByStamp), and every printed ultra_run/ultra_gate/approve/
    teardown receipt's "stamp" field. First-appearance transcript order,
    deduped.
    """
    stamps, seen, plan_paths_by_stamp = [], set(), {}

    def _add(stamp):
        if isinstance(stamp, str) and stamp and stamp not in seen:
            seen.add(stamp)
            stamps.append(stamp)

    for _r, b in _iter_blocks(records):
        if not isinstance(b, dict):
            continue
        if b.get("type") == "tool_use" and b.get("name") == "Workflow":
            args = (b.get("input") or {}).get("args")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = None
            if isinstance(args, dict):
                run_dir = args.get("runDir")
                if isinstance(run_dir, str):
                    m = _RUN_DIR_STAMP.search(run_dir)
                    if m:
                        stamp = m.group(1)
                        _add(stamp)
                        pp = args.get("planPath")
                        if isinstance(pp, str) and pp.strip() and stamp not in plan_paths_by_stamp:
                            plan_paths_by_stamp[stamp] = pp.strip()
        txt = _block_text(b)
        i = txt.find('"mode"')
        while i != -1:
            start = txt.rfind("{", 0, i + 1)
            if start != -1:
                obj = _balanced_json(txt, start)
                if isinstance(obj, dict) and obj.get("mode") in ("gate", "approve", "teardown"):
                    _add(obj.get("stamp"))
            i = txt.find('"mode"', i + 1)
    return {"stamps": stamps, "planPathsByStamp": plan_paths_by_stamp}


def stitch_planning(plan_path, session_records):
    """True when this session itself authored the plan (a Write/Edit to plan_path)."""
    if not plan_path:
        return False
    for _r, b in _iter_blocks(session_records):
        if isinstance(b, dict) and b.get("type") == "tool_use" \
                and b.get("name") in ("Write", "Edit") \
                and (b.get("input") or {}).get("file_path", "").endswith(plan_path.lstrip(".")):
            return True
    return False


def _records(session_path):
    out = []
    for line in Path(session_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _gate_evidence(records):
    """All printed gate receipts in transcript order, plus the run terminus.

    Returns (reports, terminus): reports is a list of
    {"receipt", "stamp", "ordinal", "source"} (ordinal = position among
    receipts sharing that stamp, transcript order); terminus is "approved"
    when an approve marker follows the last receipt (or stands alone),
    else the last receipt's verdict, else "unknown".
    """
    # Pass 1 (0.0.31+ driver era): ultra_gate.py prints its gate receipt on
    # every administered gate — a JSON object with mode=="gate" and a
    # "verdict" — and --approve/--teardown print a marker with "lockReleased".
    receipts, approve_after = [], False
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        # Anchor on '"mode"' — ultra_gate.py serializes it as the receipt's
        # FIRST key, so rfind('{', ...) from the anchor reaches the receipt's
        # OUTER opening brace. (Anchoring on '"gateCheckExit"' landed instead on
        # the nested "gateCheck" dict serialized right before it.)
        i = txt.find('"mode"')
        while i != -1:
            start = txt.rfind("{", 0, i + 1)
            if start != -1:
                obj = _balanced_json(txt, start)
                if isinstance(obj, dict) and obj.get("mode") == "gate" and "verdict" in obj:
                    receipts.append(obj)
                    approve_after = False
                elif isinstance(obj, dict) and obj.get("mode") in ("approve", "teardown") \
                        and "lockReleased" in obj:
                    if obj["mode"] == "approve":
                        approve_after = True
            i = txt.find('"mode"', i + 1)
    if receipts:
        per_stamp = {}
        reports = []
        for r in receipts:
            stamp = r.get("stamp")
            ordinal = per_stamp.get(stamp, 0)
            per_stamp[stamp] = ordinal + 1
            reports.append({"receipt": r, "stamp": stamp,
                            "ordinal": ordinal, "source": "transcript"})
        terminus = "approved" if approve_after else receipts[-1].get("verdict", "unknown")
        return reports, terminus
    if approve_after:
        return [], "approved"
    legacy = _legacy_gate_report(records)
    if legacy is not None:
        return [{"receipt": legacy, "stamp": None,
                 "ordinal": 0, "source": "transcript"}], "unknown"
    return [], "unknown"


def _legacy_gate_report(records):
    # Pass 2 (legacy, pre-driver sessions): scan every "integrationBranch"
    # mention, parse the enclosing JSON object, and accept only one with a real
    # top-level integrationBranch *value* — this rejects report-format schema
    # prose (where "integrationBranch" sits inside a "required" array) and any
    # other decoy.
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        idx = 0
        while True:
            k = txt.find('"integrationBranch"', idx)
            if k == -1:
                break
            start = txt.rfind("{", 0, k + 1)
            if start != -1:
                obj = _balanced_json(txt, start)
                if isinstance(obj, dict) and isinstance(obj.get("integrationBranch"), str) \
                        and obj["integrationBranch"]:
                    return obj
            idx = k + 1
    return None


def _gate_report(records):
    reports, _ = _gate_evidence(records)
    return reports[-1]["receipt"] if reports else None


def _disk_receipts_for(plan_path, stamps):
    """Per-stamp disk fallback (#118): read gate-receipt.json ONLY for the
    given registry stamps — never a repo-wide glob, so a foreign run's
    receipt can never be attached. Locates the repo root from plan_path the
    same way the old repo-wide fallback did. Fails soft to [] when the repo
    can't be resolved, and skips any stamp whose file is missing/unreadable
    (soft-fail per stamp)."""
    if not plan_path or not stamps:
        return []
    root = Path(plan_path).parent
    while root != root.parent:
        if (root / ".git").exists():
            break
        root = root.parent
    else:
        return []
    if not (root / ".git").exists():
        return []
    entries = []
    per_stamp = {}
    for stamp in stamps:
        f = root / ".claude/ultrapowers" / f"run-{stamp}" / "gate-receipt.json"
        try:
            obj = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(obj, dict) and "verdict" in obj:
            ordinal = per_stamp.get(stamp, 0)
            per_stamp[stamp] = ordinal + 1
            entries.append({"receipt": obj, "stamp": obj.get("stamp") or stamp,
                            "ordinal": ordinal, "source": "disk"})
    return entries


def _transcript_dirs(records):
    """Every candidate "Transcript dir:" mention (#113) whose dir actually
    holds agent transcripts, in transcript order — a session may launch
    several workflows (multiple /ultrapowers launches, or a zero-agent probe
    before the real run) and each agent-bearing dir is its own run's evidence.
    Fallback: [candidates[-1]] when NONE qualify, preserving the old
    single-dir last-resort behavior (e.g. a dir that no longer exists on
    disk when the harvester runs later)."""
    candidates = []
    for _r, b in _iter_blocks(records):
        if not (isinstance(b, dict) and b.get("type") == "tool_result"):
            continue
        txt = _block_text(b)
        if "Transcript dir:" in txt:
            tail = txt.split("Transcript dir:", 1)[1].strip().splitlines()[0]
            tail = tail.strip().rstrip("\\").strip()
            if tail.startswith("/"):
                candidates.append(tail)
    if not candidates:
        return []
    qualifying = [c for c in candidates if Path(c).is_dir() and any(Path(c).glob("agent-*.jsonl"))]
    return qualifying if qualifying else [candidates[-1]]


def _stamp_terminus(records, stamp, stamp_reports):
    """Per-run terminus (#113 Task 2) — the existing rules (approve marker /
    last receipt verdict) applied to ONE stamp's own events, ignoring other
    stamps' interleaved gate/approve markers. `stamp_reports` is that stamp's
    own gate_reports entries (transcript ordinal-tagged, or disk fallback) —
    used for the last-verdict fallback when no approve marker was seen.
    Task 3 refines this rule; unchanged here from the existing single-stamp
    semantics in `_gate_evidence`."""
    approved = False
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        i = txt.find('"mode"')
        while i != -1:
            start = txt.rfind("{", 0, i + 1)
            if start != -1:
                obj = _balanced_json(txt, start)
                if isinstance(obj, dict) and obj.get("stamp") == stamp:
                    if obj.get("mode") == "gate" and "verdict" in obj:
                        approved = False
                    elif obj.get("mode") in ("approve", "teardown") and "lockReleased" in obj:
                        if obj.get("mode") == "approve":
                            approved = True
            i = txt.find('"mode"', i + 1)
    if approved:
        return "approved"
    if stamp_reports:
        return stamp_reports[-1]["receipt"].get("verdict", "unknown")
    return "unknown"


def _runs_for_bundle(records, registry, gate_reports):
    """Group merged gate_reports by launched stamp into the `runs` bundle
    field (#113 Task 2): [{stamp, planPath, gateReports, terminus}], one
    entry per registry stamp in transcript (launch) order."""
    by_stamp = {}
    for g in gate_reports:
        by_stamp.setdefault(g["stamp"], []).append(g)
    runs = []
    for stamp in registry["stamps"]:
        stamp_reports = by_stamp.get(stamp, [])
        runs.append({
            "stamp": stamp,
            "planPath": registry["planPathsByStamp"].get(stamp),
            "gateReports": stamp_reports,
            "terminus": _stamp_terminus(records, stamp, stamp_reports),
        })
    return runs


def _aggregate_terminus(runs, fallback):
    """Aggregate terminus rule (spec §3): all runs approved -> approved; else
    the last non-approved run's terminus in transcript order. No registry
    runs at all (legacy pre-#113 sessions) -> keep the existing single-report
    terminus unchanged."""
    if not runs:
        return fallback
    non_approved = [r for r in runs if r["terminus"] != "approved"]
    return "approved" if not non_approved else non_approved[-1]["terminus"]


def _transcript_dir(records):
    # Thin wrapper (#113): keeps the pre-multi-run singular meaning — the
    # last preferred candidate — for the bundle's "transcriptDir" field and
    # any other single-dir caller.
    dirs = _transcript_dirs(records)
    return dirs[-1] if dirs else None


def _merge_audits(audits):
    """Union an ultrapowers-run audit across every transcript dir a session
    launched (#113): concatenate agents, sum numeric totals key-wise, join
    non-empty notes. Empty input preserves today's no-transcript-dir shape."""
    audits = [a for a in audits if isinstance(a, dict)]
    if not audits:
        return {"agents": [], "note": "no transcript dir"}
    agents, totals, notes = [], {}, []
    for a in audits:
        agents.extend(a.get("agents") or [])
        for k, v in (a.get("totals") or {}).items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                totals[k] = totals.get(k, 0) + v
        note = a.get("note")
        if note:
            notes.append(note)
    merged = {"agents": agents}
    if totals:
        merged["totals"] = totals
    if notes:
        merged["note"] = "; ".join(notes)
    return merged


def _repo_root():
    return Path(__file__).resolve().parents[3]


def _to_dt(s):
    """Parse an ISO8601 string (with 'Z' or numeric offset) to a tz-aware
    datetime; None on failure. Needed because run timestamps are UTC 'Z' while
    git %cI carries a numeric offset — string compare across them is wrong."""
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


@functools.lru_cache(maxsize=1)
def _release_timeline():
    """(iso_datetime, version) pairs, oldest-first, from the repo's
    .claude-plugin/plugin.json history — the authoritative version-over-time map
    (handles the 0.x → 0.0.x reset because it is date-ordered, not semver).
    Advisory: returns () on any error (no git / not a repo)."""
    root = _repo_root()
    try:
        log = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%H%x09%cI",
             "--", ".claude-plugin/plugin.json"],
            capture_output=True, text=True, timeout=30)
        if log.returncode != 0:
            return ()
        rows = []
        for line in log.stdout.splitlines():
            h, _, dt = line.partition("\t")
            if not h:
                continue
            show = subprocess.run(
                ["git", "-C", str(root), "show", f"{h}:.claude-plugin/plugin.json"],
                capture_output=True, text=True, timeout=30)
            if show.returncode != 0:
                continue
            try:
                ver = json.loads(show.stdout).get("version")
            except json.JSONDecodeError:
                ver = None
            if ver:
                rows.append((dt, ver))
        rows.sort()  # oldest-first by ISO date
        seen, timeline = set(), []
        for dt, ver in rows:
            if ver not in seen:           # keep each version's first appearance
                seen.add(ver)
                timeline.append((dt, ver))
        return tuple(timeline)
    except (OSError, subprocess.SubprocessError):
        return ()


def _run_timestamp(records):
    """Earliest record timestamp (≈ when the run launched), or None."""
    for r in records:
        ts = r.get("timestamp") if isinstance(r, dict) else None
        if isinstance(ts, str) and ts:
            return ts
    return None


def _engine_epoch(records, origin, timeline=None):
    """Resolve which ultrapowers version was current when the run launched.

    home   → the repo epoch at that date (a self-dev run may be AT or slightly
             AHEAD of it, since dev runs often install the repo-HEAD engine).
    foreign→ an UPPER BOUND: the latest release by that date; the project's
             installed plugin cache may lag behind it ("installed plugin lags
             the repo"). Returns {epoch, asOf, basis}; epoch None if unknown."""
    if timeline is None:
        timeline = _release_timeline()
    ts = _run_timestamp(records)
    basis = "home-repo-date" if origin == "home" else "foreign-date-upper-bound"
    run_dt = _to_dt(ts)
    if run_dt is None or not timeline:
        return {"epoch": None, "asOf": ts, "basis": basis if run_dt else "unknown"}
    epoch = None
    for dt, ver in timeline:              # oldest-first
        rel_dt = _to_dt(dt)
        if rel_dt is None:
            continue
        if rel_dt <= run_dt:
            epoch = ver
        else:
            break
    return {"epoch": epoch, "asOf": ts, "basis": basis}


def classify_session_kind(records, audit, gate_report, planning_found, has_registered_launch=False):
    """Distinguish a real /ultrapowers engine run from a non-engine Workflow
    session (research fan-out, issue drafting) that merely used the Workflow
    tool. Engine signals: a recognized engine role among the audited agents,
    OR a real integration branch in the gate report, OR a captured plan, OR
    (#113 Task 2) a structurally-verified launch in `session_registry` — a
    Workflow tool_use whose parsed args carried a real `run-<stamp>` dir is
    unambiguous engine evidence on its own, independent of whether that run's
    printed gate receipt happens to carry an `integrationBranch` key (the
    driver-era mode=="gate" receipt shape doesn't always). A session with none
    of these is 'meta' (e.g. [c9b028bf4da18d99]: ~200 role:unknown agents,
    planningFound=false, no integration branch, no registered launch)."""
    roles = {a.get("role", "").split(":", 1)[0] for a in (audit or {}).get("agents", [])}
    if roles & ENGINE_ROLES:
        return "engine"
    if gate_report and isinstance(gate_report.get("integrationBranch"), str):
        return "engine"
    if planning_found:
        return "engine"
    if has_registered_launch:
        return "engine"
    return "meta"


def build_bundle(session_path, project_slug, cache_dir, home_slug):
    try:
        records = _records(session_path)
    except OSError:
        return None
    if not is_real_run(records):
        return None
    session_id = Path(session_path).stem
    run_id = hashlib.sha256(f"{project_slug}/{session_id}".encode()).hexdigest()[:16]
    tdirs = _transcript_dirs(records)
    tdir = tdirs[-1] if tdirs else None
    origin = classify_origin(project_slug, home_slug)
    plan_path = _plan_path(records)
    registry = session_registry(records)
    transcript_reports, terminus = _gate_evidence(records)
    covered = {r["stamp"] for r in transcript_reports}
    disk = _disk_receipts_for(plan_path, [s for s in registry["stamps"] if s not in covered])
    gate_reports = transcript_reports + disk
    if not transcript_reports and disk:
        terminus = disk[-1]["receipt"].get("verdict", "unknown")
    # "final receipt" (singular) keeps its pre-#118 single-run meaning: the
    # transcript is authoritative when it has any receipt at all; disk entries
    # (now per-stamp scoped, never repo-wide) only stand in when the
    # transcript printed none for THIS session's launched stamps.
    last = transcript_reports[-1] if transcript_reports else (disk[-1] if disk else None)
    gate_report = last["receipt"] if last else None
    # runs[] (#113 Task 2): group the merged gate_reports by launched stamp;
    # the top-level `terminus` becomes the aggregate across runs when the
    # session actually registered any stamped launches, else it keeps its
    # pre-#113 single-report meaning computed above.
    runs = _runs_for_bundle(records, registry, gate_reports)
    terminus = _aggregate_terminus(runs, terminus)
    audit = _merge_audits([audit_run.audit(d) for d in tdirs])
    planning_found = stitch_planning(plan_path, records)
    session_kind = classify_session_kind(records, audit, gate_report, planning_found,
                                          has_registered_launch=bool(registry["stamps"]))
    if session_kind != "engine":
        return None
    bundle = {
        "runId": run_id,
        "sessionId": session_id,
        "projectSlug": project_slug,
        "origin": origin,
        "sessionKind": session_kind,
        "engineVersion": _engine_epoch(records, origin),
        "planPath": plan_path,
        "transcriptDir": tdir,
        "gateReport": gate_report,
        "gateReports": gate_reports,
        "runs": runs,
        "terminus": terminus,
        "truncated": terminus in ("NEEDS_ACK", "BLOCKED", "unknown"),
        "audit": audit,
        "planningFound": planning_found,
    }
    out = Path(cache_dir) / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    (out / "slice.md").write_text(slice_transcript(records))
    return out


def _load_watermark(cache_dir):
    wm = Path(cache_dir) / "watermark.json"
    if wm.exists():
        try:
            return set(json.loads(wm.read_text()))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def _save_watermark(cache_dir, seen):
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    (Path(cache_dir) / "watermark.json").write_text(json.dumps(sorted(seen)))


def harvest(projects_root, cache_dir, home_slug, *, project=None, session=None):
    projects_root, cache_dir = Path(projects_root), Path(cache_dir)
    seen = _load_watermark(cache_dir)
    new_bundles = []
    seen_tdirs: set = set()
    if not projects_root.is_dir():
        print(f"ultralearn: no projects root at {projects_root}", file=sys.stderr)
        return []
    for proj in sorted(projects_root.iterdir()):
        if not proj.is_dir():
            continue
        if project and proj.name != project:
            continue
        for sess in sorted(proj.glob("*.jsonl")):
            if session and sess.stem != session:
                continue
            key = f"{proj.name}/{sess.stem}"
            if key in seen:
                continue
            try:
                bundle = build_bundle(sess, proj.name, cache_dir, home_slug)
            except Exception as exc:  # advisory: never crash a sweep
                print(f"ultralearn: skipped {key}: {exc}", file=sys.stderr)
                bundle = None
            seen.add(key)
            if bundle is not None:
                bdata = json.loads((bundle / "bundle.json").read_text())
                tdir_val = bdata.get("transcriptDir")
                if tdir_val and tdir_val in seen_tdirs:
                    continue  # same run, already emitted
                if tdir_val:
                    seen_tdirs.add(tdir_val)
                new_bundles.append(bundle)
    _save_watermark(cache_dir, seen)
    return new_bundles


def _default_home_slug():
    return str(Path(__file__).resolve().parents[3]).replace("/", "-")


def main(argv=None):
    argv = argv or sys.argv[1:]
    projects = None
    project_filter = None
    session_filter = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--project" and i + 1 < len(argv):
            project_filter = argv[i + 1]; i += 2
        elif a == "--session" and i + 1 < len(argv):
            session_filter = argv[i + 1]; i += 2
        elif not a.startswith("--"):
            projects = Path(a); i += 1
        else:
            i += 1
    if projects is None:
        projects = Path.home() / ".claude/projects"
    cache = Path.home() / ".claude/ultralearn"
    bundles = harvest(projects, cache, _default_home_slug(),
                      project=project_filter, session=session_filter)
    print(f"ultralearn: {len(bundles)} new run bundle(s) under {cache}/runs")
    for b in bundles:
        print(f"  - {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
