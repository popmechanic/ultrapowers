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
    for _idx, r, b in _iter_blocks_indexed(records):
        yield r, b


def _iter_blocks_indexed(records):
    """Like `_iter_blocks` but also yields each record's position in
    `records` — needed wherever "later in the transcript" matters (the slice
    envelope's launch anchor and tail cut, Task 3)."""
    for idx, r in enumerate(records):
        content = (r.get("message") or {}).get("content")
        if isinstance(content, str):
            # #137: short CLI prompts arrive as plain string content — the
            # API-equivalent of a single text block. Without this, the
            # operator's one-word acks are structurally invisible to every
            # consumer (the slicer dropped a salvage "yes", manufacturing a
            # false proceeded-without-ack observation).
            yield idx, r, {"type": "text", "text": content}
        elif isinstance(content, list):
            for b in content:
                yield idx, r, b


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


def _is_workflow_tool_result(txt):
    """A tool_result "is" a Workflow tool_result (spec §5's second qualifying
    artifact shape) when it carries the printed launch shape `is_real_run` /
    `_transcript_dirs` also key off of — the only machine-printed marker of a
    Workflow tool call's own output, as opposed to a receipt/approve/teardown
    artifact that must instead carry a registered stamp."""
    return "Transcript dir:" in txt or "integrationBranch" in txt


def _last_launch_tool_use_index(records, stamp):
    """Index of the LAST Workflow tool_use record whose parsed `runDir`
    resolves to `stamp` (replays `session_registry`'s own structural
    extraction) — the slice envelope's launch anchor, and its no-artifact
    fallback value (spec §5)."""
    idx_found = None
    for idx, _r, b in _iter_blocks_indexed(records):
        if not (isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Workflow"):
            continue
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
                if m and m.group(1) == stamp:
                    idx_found = idx
    return idx_found


def _last_artifact_record_index(records, registry):
    """Index (into `records`) of the slice envelope's tail bound, registry-
    keyed (spec §5, F6-adjudicated): an artifact qualifies only if it is a
    `tool_result` carrying a REGISTERED stamp (string containment of a
    registry stamp is fine — stamps are launch-verified, so a fixture/prose
    stamp that was never actually launched can't poison this; the
    `tool_result`-type gate alone is not enough, F6's poisoning vector) or a
    Workflow tool_result itself. The cut lands at the last qualifying
    artifact at-or-after the LAST registered launch's own `tool_use` record
    (earlier launches' artifacts never extend the tail); when no launch is
    registered at all (pre-registry-era sessions), the whole transcript is
    the search window. No qualifying artifact anywhere -> None (keeps the
    full head, e.g. planning-only sessions)."""
    stamps = registry["stamps"]
    window_start = _last_launch_tool_use_index(records, stamps[-1]) if stamps else None
    stamp_set = set(stamps)
    cutoff = None
    for idx, _r, b in _iter_blocks_indexed(records):
        if window_start is not None and idx < window_start:
            continue
        if not isinstance(b, dict) or b.get("type") != "tool_result":
            continue
        txt = _block_text(b)
        if not txt:
            continue
        if _is_workflow_tool_result(txt) or any(s in txt for s in stamp_set):
            cutoff = idx
    # No-artifact fallback (spec §5): the last registered launch's own
    # tool_use index — nothing after the last launch is ever cut blindly.
    return cutoff if cutoff is not None else window_start


def slice_transcript(records, terminus=None):
    # Slice envelope (Task 3, registry-keyed — spec §5): the run ends at the
    # last qualifying artifact of the LAST registered launch; anything after
    # is a post-run tangent, never wave-relevant. No qualifying artifact at
    # all (e.g. planning-only, or a pre-registry session with no Workflow
    # tool_result) keeps the full head, unchanged from pre-Task-3 behavior.
    # #150 mode (b): when the caller's derived terminus is "approved", the
    # approval exchange — plain operator text AFTER the final artifact — is
    # exactly what the NEEDS_ACK lens needs, so the slice extends past the
    # artifact cut to the transcript end. The tail rides the same per-record
    # filter below (user text kept, keyword-less noise dropped), and since
    # approval is terminal it is naturally a handful of records: no cap, no
    # sentinel. Any other terminus (or the default None) keeps the cut.
    registry = session_registry(records)
    cutoff = _last_artifact_record_index(records, registry)
    if terminus == "approved":
        cutoff = None
    lines = []
    for idx, r, b in _iter_blocks_indexed(records):
        if cutoff is not None and idx > cutoff:
            continue
        rtype = r.get("type")
        txt = _block_text(b).strip()
        if not txt:
            continue
        if rtype == "user" and b.get("type") == "text":
            if len(txt) > SLICE_TURN_MAX:
                txt = txt[:SLICE_TURN_MAX] + f"\n…[truncated {len(txt) - SLICE_TURN_MAX} chars]"
            lines.append(f"**user:** {txt}")
        elif any(k in txt.lower() for k in SLICE_KEYWORDS):
            # #137: tool_result blocks ride user-TYPE records — label them by
            # block type so machine output is never attributed to the human.
            label = "tool_result" if b.get("type") == "tool_result" else rtype
            lines.append(f"**{label}:** {txt}")
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


_RUN_DIR_STAMP = re.compile(r"/run-([^/\s]+)$")


def session_registry(records):
    """Every stamp this session actually launched (#113/#118, receipt scan
    deleted #126): the structural source of truth for receipt attribution, so
    neither a foreign run's evidence NOR a pasted receipt-shaped JSON literal
    (test fixtures, plan prose) can ever be attached to a session that never
    launched it.

    Sources: every Workflow tool_use whose parsed input.args carries a
    runDir matching '…/run-<stamp>' — structurally verified, inexpressible
    from pasted text. planPath from those same args keys planPathsByStamp;
    runDir itself (the absolute launch dir) keys runDirsByStamp, the only
    location `_disk_receipts_for` is allowed to read from. First-appearance
    transcript order, deduped. No transcript text is scanned for receipts.
    """
    stamps, seen, plan_paths_by_stamp, run_dirs_by_stamp = [], set(), {}, {}

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
                        if stamp not in run_dirs_by_stamp:
                            run_dirs_by_stamp[stamp] = run_dir
                        pp = args.get("planPath")
                        if isinstance(pp, str) and pp.strip() and stamp not in plan_paths_by_stamp:
                            plan_paths_by_stamp[stamp] = pp.strip()
    return {"stamps": stamps, "planPathsByStamp": plan_paths_by_stamp,
            "runDirsByStamp": run_dirs_by_stamp}


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


def _disk_receipts_for(run_dirs_by_stamp, stamps):
    """Per-stamp disk read (#126): read `<runDir>/gate-receipt.json` for each
    given registry stamp, located directly from the structurally-verified
    runDir `session_registry` recorded — never a repo-wide glob and never a
    planPath-relative walk (a relative planPath resolved against the
    harvester's CWD could attribute a foreign run's receipts to the wrong
    repo — trim review F4). Entries are labeled by the LOCATING stamp (the
    one used to find the file), never the receipt's own recorded "stamp"
    field. Soft-fails per stamp: no runDir mapping, a missing file, or
    unreadable/malformed JSON is skipped, never raised. This is the only
    place `gateReports`/`gateReport` are sourced from — no transcript entry
    ever enters either."""
    if not run_dirs_by_stamp or not stamps:
        return []
    entries = []
    for stamp in stamps:
        run_dir = run_dirs_by_stamp.get(stamp)
        if not run_dir:
            continue
        f = Path(run_dir) / "gate-receipt.json"
        try:
            obj = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(obj, dict) and "verdict" in obj:
            entries.append({"receipt": obj, "stamp": stamp, "source": "disk"})
    return entries


def _transcript_dirs(records):
    """Every candidate "Transcript dir:" mention (#113) whose dir actually
    holds agent transcripts, in transcript order — a session may launch
    several workflows (multiple /ultrapowers launches, or a zero-agent probe
    before the real run) and each agent-bearing dir is its own run's evidence.
    Candidates are deduped on their RESOLVED REAL paths (#150 mode a): a
    crash-resume session prints the same dir twice (sometimes via a symlink
    alias), and pre-dedupe each mention was audited separately — the verbatim
    agent-block duplication that overstated audit totals by a full salvage
    run's weight. First occurrence wins; transcript order is preserved.
    Fallback: the LAST unique candidate when NONE qualify, preserving the old
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
    seen_real, unique = set(), []
    for c in candidates:
        try:
            key = str(Path(c).resolve())
        except OSError:
            key = c  # unresolvable path: dedupe on the literal string, soft
        if key in seen_real:
            continue
        seen_real.add(key)
        unique.append(c)
    qualifying = [c for c in unique if Path(c).is_dir() and any(Path(c).glob("agent-*.jsonl"))]
    return qualifying if qualifying else [unique[-1]]


_GIT_TIMEOUT = 5  # seconds; an ancestry check must never hang a harvest sweep


def _nearest_git_root(path):
    """Nearest `.git`-bearing ancestor of `path` (inclusive of `path` itself),
    or None when no ancestor up to the filesystem root qualifies (spec §4:
    "repo root = nearest .git-bearing ancestor of runDir")."""
    try:
        p = Path(path).resolve()
    except OSError:
        return None
    for candidate in (p, *p.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _stamp_head_sha(run_dir, receipt):
    """head lookup (spec §4, F3): `<runDir>/report.json` ->
    waveMerges[-1].headSha (file-derived, post-#114), falling back to
    gate-receipt.json's own `branch` field — `receipt` is the same parsed
    disk read `_disk_receipts_for` already made, so this never re-reads that
    file."""
    try:
        obj = json.loads((Path(run_dir) / "report.json").read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        obj = None
    if isinstance(obj, dict):
        wave_merges = obj.get("waveMerges")
        if isinstance(wave_merges, list) and wave_merges:
            last = wave_merges[-1]
            if isinstance(last, dict):
                sha = last.get("headSha")
                if isinstance(sha, str) and sha.strip():
                    return sha.strip()
    branch = receipt.get("branch") if isinstance(receipt, dict) else None
    return branch.strip() if isinstance(branch, str) and branch.strip() else None


def _stamp_base_branch(run_dir, repo_root):
    """base lookup (spec §4, F3): `<runDir>/receipt.json`'s `baseBranch`,
    else the repo's default branch (`git symbolic-ref
    refs/remotes/origin/HEAD`), else `main`."""
    try:
        obj = json.loads((Path(run_dir) / "receipt.json").read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        obj = None
    if isinstance(obj, dict):
        base = obj.get("baseBranch")
        if isinstance(base, str) and base.strip():
            return base.strip()
    try:
        res = subprocess.run(
            ["git", "-C", str(repo_root), "symbolic-ref", "refs/remotes/origin/HEAD"],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().rsplit("/", 1)[-1]
    except (OSError, subprocess.SubprocessError):
        pass
    return "main"


def _git_ancestry_approved(run_dir, receipt):
    """Terminus upgrade (spec §4, Task 2, F1-F3 adjudicated): true when the
    stamp's head landed on its base branch — merged IS approved, regardless
    of how the operator got there (`git merge-base --is-ancestor <head>
    <base>`). Fails soft to False (never raises) on any unresolvable repo,
    sha, or git invocation — 'not resolvable' keeps the receipt's own
    verdict, it never crashes the sweep. Known blind spot, accepted (F2): a
    squash/rebase merge severs the head commit from base's history, so a
    squash-merged run's head is never an ancestor — the receipt verdict
    stands instead of `approved`."""
    repo_root = _nearest_git_root(run_dir)
    if repo_root is None:
        return False
    head = _stamp_head_sha(run_dir, receipt)
    if not head:
        return False
    base = _stamp_base_branch(run_dir, repo_root)
    try:
        res = subprocess.run(
            ["git", "-C", str(repo_root), "merge-base", "--is-ancestor", head, base],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT)
        return res.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


_RUN_DIR_SUFFIX = re.compile(r"/\.claude/ultrapowers/run-[^/]+$")


def _repo_root_from_run_dir(run_dir):
    """Repo root derived from the registry-recorded runDir PATH STRING (#150
    mode c): strip the `.claude/ultrapowers/run-<stamp>` suffix. Pure string
    work — a drain-gated run's runDir is typically torn down by the time the
    harvester runs, so the runDir is never touched on disk. None when the
    string does not carry the engine suffix."""
    if not isinstance(run_dir, str):
        return None
    m = _RUN_DIR_SUFFIX.search(run_dir)
    return run_dir[:m.start()] if m else None


def _drain_stamp_receipts(run_dir, stamp):
    """Mode (c) mirror lookup (#150): the `<stamp>-*.json` glob under
    `<repo-root>/.claude/ultrapowers/receipts/`, repo root from
    `_repo_root_from_run_dir` — one record per drain-gated docket entry,
    written by the drain's record helper's `stamp` subcommand (the schema
    authority). Entries are labeled by the LOCATING stamp, filename-sorted
    for determinism. Soft-fails: no derivable root, a missing receipts dir,
    or unreadable/malformed JSON is skipped, never raised; only dicts
    carrying a `verdict` qualify."""
    root = _repo_root_from_run_dir(run_dir)
    if root is None:
        return []
    entries = []
    try:
        files = sorted((Path(root) / ".claude/ultrapowers/receipts").glob(stamp + "-*.json"))
    except OSError:
        return []
    for f in files:
        try:
            obj = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(obj, dict) and "verdict" in obj:
            entries.append({"receipt": obj, "stamp": stamp, "source": "stamp"})
    return entries


def _drain_ancestry_approved(run_dir, receipt):
    """Approved-upgrade for a drain-stamp record (#150 mode c): merged IS
    approved, same rule as the receipt path. head = the record's own
    `branch`, base = its `base` — both carried in the record, so no runDir
    file read is ever needed; repo root comes from the runDir PATH STRING.
    Fails soft to False on any unresolvable repo, ref, or git invocation."""
    repo_root = _repo_root_from_run_dir(run_dir)
    if not repo_root:
        return False
    head = receipt.get("branch")
    base = receipt.get("base")
    if not (isinstance(head, str) and head.strip()
            and isinstance(base, str) and base.strip()):
        return False
    try:
        res = subprocess.run(
            ["git", "-C", repo_root, "merge-base", "--is-ancestor",
             head.strip(), base.strip()],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT)
        return res.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _drain_stamp_terminus(run_dir, drain_receipts):
    """Terminus from mode-(c) drain-stamp records (#150): each entry's
    verdict upgrades to `approved` when its recorded branch landed on its
    recorded base. All entries approved -> approved; else the last
    (filename-sorted) non-approved entry's verdict — the aggregate-terminus
    rule applied at the entry level."""
    resolved = []
    for e in drain_receipts:
        receipt = e["receipt"]
        verdict = receipt.get("verdict", "unknown")
        if _drain_ancestry_approved(run_dir, receipt):
            verdict = "approved"
        resolved.append(verdict)
    non_approved = [v for v in resolved if v != "approved"]
    return "approved" if not non_approved else non_approved[-1]


def _stamp_terminus(run_dir, stamp_reports, drain_receipts=()):
    """Per-stamp terminus (#126 Task 2, generalized receipt-or-stamp by #150
    mode c): the disk receipt's own verdict, upgraded to `approved` when git
    ancestry proves the run's head landed on its base branch. Structured
    only, no transcript scanning: the merge-evidence prose matcher
    (`_merge_evidence_after`) and the approve-marker/stamp-interleave
    tracking it replaced are deleted outright — the git check subsumes both.
    `stamp_reports` is this stamp's own disk-sourced gate_reports entries and
    always takes precedence; `drain_receipts` (the #150 stamp mirror) is
    consulted only when no disk receipt exists — the drain skips Step-5 and
    tears the runDir down, so for those runs the mirror is the only gate
    evidence left. Neither present -> `unknown`."""
    if stamp_reports:
        receipt = stamp_reports[-1]["receipt"]
        verdict = receipt.get("verdict", "unknown")
        if run_dir and _git_ancestry_approved(run_dir, receipt):
            return "approved"
        return verdict
    if drain_receipts:
        return _drain_stamp_terminus(run_dir, drain_receipts)
    return "unknown"


def _runs_for_bundle(registry, gate_reports):
    """Group merged gate_reports by launched stamp into the `runs` bundle
    field (#113 Task 2): [{stamp, planPath, gateReports, terminus}], one
    entry per registry stamp in transcript (launch) order."""
    by_stamp = {}
    for g in gate_reports:
        by_stamp.setdefault(g["stamp"], []).append(g)
    runs = []
    for stamp in registry["stamps"]:
        stamp_reports = by_stamp.get(stamp, [])
        run_dir = registry["runDirsByStamp"].get(stamp)
        # #150 mode (c): the stamp mirror is consulted only when no disk
        # gate receipt exists for this stamp — it never enters gateReports
        # (which stay disk-sourced only), it only informs terminus.
        drain_receipts = [] if stamp_reports else _drain_stamp_receipts(run_dir, stamp)
        runs.append({
            "stamp": stamp,
            "planPath": registry["planPathsByStamp"].get(stamp),
            "gateReports": stamp_reports,
            "terminus": _stamp_terminus(run_dir, stamp_reports, drain_receipts),
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
    # Thin wrapper (#113): `_transcript_dirs` returns every candidate in
    # transcript order, agent-qualifying ones preferred over the raw last
    # resort (see its docstring); this picks the LAST entry of that already-
    # ordered list — never the first — keeping the pre-multi-run singular
    # meaning for the bundle's "transcriptDir" field and any other
    # single-dir caller.
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
    # gateReports / gateReport (#126): disk-sourced only, located by the
    # structurally-verified runDir — no transcript entry ever enters either.
    # "final receipt" (singular) = the last DISK receipt of the last
    # REGISTERED stamp — never an earlier stamp's stale receipt standing in
    # when the last stamp itself has no receipt on disk (honest-gateReport
    # hygiene carried from Task 1's review). Per-stamp `runs[]` entries still
    # carry their own receipts regardless of this singular choice.
    gate_reports = _disk_receipts_for(registry["runDirsByStamp"], registry["stamps"])
    last_stamp = registry["stamps"][-1] if registry["stamps"] else None
    gate_report = None
    if gate_reports and gate_reports[-1]["stamp"] == last_stamp:
        gate_report = gate_reports[-1]["receipt"]
    # runs[] (#113 Task 2): group gate_reports by launched stamp; the
    # top-level `terminus` becomes the aggregate across runs when the session
    # actually registered any stamped launches, else "unknown" (no registry
    # stamps means no disk source to read a verdict from at all).
    runs = _runs_for_bundle(registry, gate_reports)
    terminus = _aggregate_terminus(runs, "unknown")
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
    (out / "slice.md").write_text(slice_transcript(records, terminus))
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
