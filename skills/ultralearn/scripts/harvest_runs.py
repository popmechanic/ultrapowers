#!/usr/bin/env python3
"""ultralearn harvester — detect real ultrapowers runs across projects and
build per-run bundles into a local cache. Read-only and advisory: malformed or
missing input is skipped with a diagnostic, never raised."""
from __future__ import annotations

import functools
import hashlib
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
import audit_run  # noqa: E402  (provides audit())

SLICE_KEYWORDS = ("wave", "integrationbranch", "/ultrapowers", "gate",
                  "transcript dir", "recommended", "depends-on")


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


def classify_origin(project_slug, home_slug):
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


def stitch_planning(plan_path, projects_root, session_records):
    if not plan_path:
        return {"planningFound": False, "planningSlice": "", "planningSource": None}
    for _r, b in _iter_blocks(session_records):
        if isinstance(b, dict) and b.get("type") == "tool_use" \
                and b.get("name") in ("Write", "Edit") \
                and (b.get("input") or {}).get("file_path", "").endswith(plan_path.lstrip(".")):
            return {"planningFound": True,
                    "planningSlice": slice_transcript(session_records),
                    "planningSource": "same-session"}
    return {"planningFound": False, "planningSlice": "", "planningSource": None}


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


def _gate_report(records):
    # Scan every "integrationBranch" mention, parse the enclosing JSON object,
    # and accept only one with a real top-level integrationBranch *value* — this
    # rejects report-format schema prose (where "integrationBranch" sits inside a
    # "required" array) and any other decoy.
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


def _transcript_dir(records):
    # Collect every absolute-path "Transcript dir:" from tool_result blocks
    # (prose mentions are not absolute paths), then prefer a dir that actually
    # holds agent transcripts — a session may launch several workflows (e.g. the
    # zero-agent probe before the real run); the probe's dir would zero the audit.
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
        return None
    for c in candidates:
        p = Path(c)
        if p.is_dir() and any(p.glob("agent-*.jsonl")):
            return c
    return candidates[-1]


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


def build_bundle(session_path, project_slug, cache_dir, home_slug):
    try:
        records = _records(session_path)
    except OSError:
        return None
    if not is_real_run(records):
        return None
    session_id = Path(session_path).stem
    run_id = hashlib.sha256(f"{project_slug}/{session_id}".encode()).hexdigest()[:16]
    tdir = _transcript_dir(records)
    origin = classify_origin(project_slug, home_slug)
    bundle = {
        "runId": run_id,
        "sessionId": session_id,
        "projectSlug": project_slug,
        "origin": origin,
        "engineVersion": _engine_epoch(records, origin),
        "planPath": _plan_path(records),
        "transcriptDir": tdir,
        "gateReport": _gate_report(records),
        "audit": audit_run.audit(tdir) if tdir else {"agents": [], "note": "no transcript dir"},
        "planningFound": stitch_planning(_plan_path(records),
                                         Path(session_path).parent.parent, records)["planningFound"],
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


def harvest(projects_root, cache_dir, home_slug):
    projects_root, cache_dir = Path(projects_root), Path(cache_dir)
    seen = _load_watermark(cache_dir)
    new_bundles = []
    if not projects_root.is_dir():
        print(f"ultralearn: no projects root at {projects_root}", file=sys.stderr)
        return []
    for proj in sorted(projects_root.iterdir()):
        if not proj.is_dir():
            continue
        for session in sorted(proj.glob("*.jsonl")):
            key = f"{proj.name}/{session.stem}"
            if key in seen:
                continue
            try:
                bundle = build_bundle(session, proj.name, cache_dir, home_slug)
            except Exception as exc:  # advisory: never crash a sweep
                print(f"ultralearn: skipped {key}: {exc}", file=sys.stderr)
                bundle = None
            seen.add(key)
            if bundle is not None:
                new_bundles.append(bundle)
    _save_watermark(cache_dir, seen)
    return new_bundles


def _default_home_slug():
    return str(Path(__file__).resolve().parents[3]).replace("/", "-")


def main(argv=None):
    argv = argv or sys.argv[1:]
    projects = Path(argv[0]) if argv else Path.home() / ".claude/projects"
    cache = Path.home() / ".claude/ultralearn"
    bundles = harvest(projects, cache, _default_home_slug())
    print(f"ultralearn: {len(bundles)} new run bundle(s) under {cache}/runs")
    for b in bundles:
        print(f"  - {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
