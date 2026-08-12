"""Shadow fold: re-merge a finished ultrapowers run from its finalized report.

A thin front-end to `run_eval`'s existing replay machinery (`group_chain` /
`replay_group` / `is_ancestor`, promoted to public aliases there) — see
`docs/superpowers/specs/2026-08-11-frontier-production-test-design.md`
Components §2 for the authoritative rules this implements. Shadow adds only
what run_eval's archived-run recovery does not already have: a CLI that reads
one run's finalized `report.json`, bounds the integration chain from it (tip
= the last MERGED wave head, floor = the first two-parent merge's merge-base
within the report-bounded walk, or a named fallback), authenticates every
sha it is handed, harvests per-task durations from committer timestamps, and
re-runs the makespan model with those measured durations when the run's plan
is available. Every unshadowable shape parks or aborts by name — never a
silent fragment.
"""
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import run_eval  # noqa: E402
import schedule_model as sm  # noqa: E402

COMPILER = ROOT / "skills" / "ultrapowers" / "scripts" / "compile_plan.py"
NUL = "\x00"
FMT_SHA_PARENTS = "%H%x00%P"

NO_REPORT_REASON = "no finalized report (unshadowable)"
NO_PER_TASK_MERGES_REASON = "no per-task merges (nothing to replay)"


class ShadowAbort(Exception):
    """A sha-resolution or ancestry violation on the selected report."""


# --------------------------------------------------------------------------
# git plumbing (shadow's own — the reused machinery starts one layer up, at
# group_chain/replay_group, which already own the fold/compare discipline)
# --------------------------------------------------------------------------

def _rev(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _resolve(repo, sha):
    """`git rev-parse --verify <sha>^{commit}` or abort loud, never guess."""
    probe = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", "-q", "%s^{commit}" % sha],
        capture_output=True, text=True)
    if probe.returncode != 0:
        raise ShadowAbort("%s does not resolve" % sha)
    return probe.stdout.strip()


def _first_parent(repo, sha):
    probe = subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "-q",
                            "%s^" % sha], capture_output=True, text=True)
    return probe.stdout.strip() if probe.returncode == 0 else None


def _commit_parents(repo, sha):
    """`(sha, [parents])` for one commit, all parents (not just first)."""
    out = _rev(repo, "rev-list", "--parents", "-n", "1", sha)
    parts = out.split()
    return parts[0], parts[1:]


def _committer_time(repo, sha):
    return int(_rev(repo, "show", "-s", "--format=%ct", sha))


def _walk_to_bound(repo, tip, bound):
    """Rows `(sha, parents)` from `tip` back to `bound` inclusive, tip first."""
    rows = []
    cur = tip
    while True:
        sha, parents = _commit_parents(repo, cur)
        rows.append((sha, parents))
        if sha == bound or not parents:
            break
        cur = parents[0]
    return rows


def _find_floor(repo, tip, bound):
    """The EARLIEST two-parent merge's merge-base within `(bound, tip]`.

    The walk is bounded by the earliest MERGED wave head's parent and scanned
    deepest-first, so the floor comes from the *first* merge of the run, not
    the last: a tip-first scan would floor the chain at the final wave's
    merge-base — i.e. the previous wave's head — dropping every earlier merge
    wave below the floor. Flooring at the first merge's merge-base also keeps
    the pre-first-merge chain commits (the engine fast-forwards the first
    branch of every wave) in `_group_chain`'s hands.

    The bound row itself — the earliest MERGED wave head's *parent*, one
    commit BELOW the run — is excluded from the candidate scan: it is the
    walk terminator only. When the earliest wave head is a single-parent
    fast-forward and the bound commit's own first-parent line carries
    2-parent merges (e.g. a base branch's unrelated drain merges), a scan
    that included the bound row would prefer that pre-run merge and float
    the floor dozens of commits below the run, silently inflating every
    earliest-wave task's measured duration.

    Falls back to `bound` itself (the earliest MERGED wave head's parent) when
    no two-parent commit appears in the span — the merge-free case.
    """
    for sha, parents in reversed(_walk_to_bound(repo, tip, bound)):
        if sha == bound:
            continue
        if len(parents) == 2:
            return _rev(repo, "merge-base", parents[0], parents[1]), "merge-base"
    return bound, "wave-head-parent"


def _chain_after(repo, floor, tip):
    """`[(sha, parents)]`, first-parent, oldest first, strictly after `floor`."""
    out = _rev(repo, "log", "--first-parent", "--format=" + FMT_SHA_PARENTS,
              "%s..%s" % (floor, tip))
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        sha, parents = line.split(NUL)
        rows.append((sha, parents.split()))
    rows.reverse()
    return rows


# --------------------------------------------------------------------------
# report parsing + authentication
# --------------------------------------------------------------------------

def _merged_waves(report):
    waves = [w for w in (report.get("waveMerges") or [])
             if w.get("status") == "MERGED" and w.get("headSha")]
    waves.sort(key=lambda w: w.get("wave", 0))
    return waves


def _authenticate(repo, report, merged):
    """Resolve every task/wave sha; check every task is an ancestor of its
    wave's head. Raises ShadowAbort on the first violation."""
    task_heads = {}
    for t in report.get("tasks") or []:
        tid, sha = t.get("task"), t.get("headSha")
        if tid is None or not sha:
            continue
        task_heads[tid] = _resolve(repo, sha)

    for w in merged:
        w["headSha"] = _resolve(repo, w["headSha"])

    for w in merged:
        for branch in w.get("branches") or []:
            head = task_heads.get(branch)
            if head is None:
                continue
            if not run_eval.is_ancestor(repo, head, w["headSha"]):
                raise ShadowAbort(
                    "%s is not an ancestor of wave %s head %s"
                    % (head, w.get("wave"), w["headSha"]))
    return task_heads


# --------------------------------------------------------------------------
# fold + disposition
# --------------------------------------------------------------------------

def _build_waves(repo, merged, groups, trailing, floor):
    absorbing = {floor} | {g["base_sha"] for g in groups}
    group_by_after = {g["after_sha"]: g for g in groups}
    trailing_refs = {e["ref"] for e in trailing}

    waves_out = []
    for w in merged:
        head, branches = w["headSha"], w.get("branches") or []
        if head in group_by_after:
            group = group_by_after[head]
            replay = run_eval.replay_group(repo, group, seed=42)
            if replay["silent_divergence"]:
                disposition = "divergent"
            elif replay["conflicted_paths"]:
                disposition = "conflicted"
            else:
                disposition = "clean"
            waves_out.append({
                "wave": w.get("wave"), "disposition": disposition,
                "endpoints": len(group["tasks"]),
                "narrations": [c.narration for c in replay["conflicts"]],
                "k1Identical": replay["k1_identical"],
                "k2Idempotent": replay["k2_idempotent"],
                "silentDivergence": sorted(replay["silent_divergence"]),
                "conflictedPaths": sorted(replay["conflicted_paths"]),
            })
        elif head in trailing_refs:
            waves_out.append({"wave": w.get("wave"), "disposition": "trailing-cut",
                              "endpoints": len(branches), "narrations": []})
        elif head in absorbing or run_eval.is_ancestor(repo, head, floor):
            waves_out.append({"wave": w.get("wave"), "disposition": "absorbed",
                              "endpoints": len(branches), "narrations": []})
        else:
            waves_out.append({
                "wave": w.get("wave"), "disposition": "excluded",
                "endpoints": len(branches), "narrations": [],
                "reason": "wave head not reachable in the bounded chain",
            })
    return waves_out


# --------------------------------------------------------------------------
# durations + measured-duration makespan remodel
# --------------------------------------------------------------------------

def _harvest_durations(repo, merged, task_heads, floor):
    floor_time = _committer_time(repo, floor)
    rows = []
    prior_time = floor_time
    for w in merged:
        for branch in w.get("branches") or []:
            head = task_heads.get(branch)
            if head is None:
                continue
            if run_eval.is_ancestor(repo, head, floor):
                rows.append({"task": branch, "reason": "at/below walk floor"})
                continue
            rows.append({"task": branch,
                        "seconds": _committer_time(repo, head) - prior_time})
        prior_time = _committer_time(repo, w["headSha"])
    return rows


def _find_plan_path(run_dir):
    args_path = run_dir / "args.json"
    if not args_path.exists():
        return None
    try:
        doc = json.loads(args_path.read_text())
    except ValueError:
        return None
    plan_path = doc.get("planPath")
    if not plan_path or not Path(plan_path).exists():
        return None
    return Path(plan_path)


def _remodel(run_dir, durations_out):
    durations = {row["task"]: float(row["seconds"])
                for row in durations_out if "seconds" in row}
    if not durations:
        return None, "no measured durations available"
    plan_path = _find_plan_path(run_dir)
    if plan_path is None:
        return None, "no plan available in run dir"
    try:
        out = subprocess.run([sys.executable, str(COMPILER), str(plan_path)],
                             capture_output=True, text=True, check=True)
        compiled = json.loads(out.stdout)
    except (subprocess.CalledProcessError, ValueError) as exc:
        return None, "plan could not be compiled: %s" % exc
    ids = sorted(durations)
    waves = [[t for t in wave if t in durations] for wave in compiled.get("waves", [])]
    edges = compiled.get("dag_edges", [])
    kept = sm.drop_same_file_edges(edges)
    try:
        return {
            "waves": sm.waves_makespan(waves, durations),
            "frontier": sm.frontier_makespan(ids, edges, durations),
            "frontier_no_same_file": sm.frontier_makespan(ids, kept, durations),
            "same_file_edges": len(edges) - len(kept),
            "durations_modeled": False,
        }, None
    except (KeyError, ValueError) as exc:
        return None, "remodel failed: %s" % exc


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def _shadow(repo, report, run_dir):
    merged = _merged_waves(report)
    task_heads = _authenticate(repo, report, merged)

    if not merged:
        return {"runDir": str(run_dir), "floor": None, "floorSource": None,
                "excluded": "no MERGED waves (unshadowable)", "waves": [],
                "durations": [], "remodel": None,
                "remodelReason": "no MERGED waves"}

    tip = merged[-1]["headSha"]
    earliest = merged[0]["headSha"]
    bound = _first_parent(repo, earliest)
    if bound is None:
        floor, floor_source = earliest, "wave-head-parent"
    else:
        floor, floor_source = _find_floor(repo, tip, bound)

    excluded, waves_out = None, []
    if floor_source == "merge-base":
        chain = _chain_after(repo, floor, tip)
        groups, trailing = run_eval.group_chain(repo, chain)
        waves_out = _build_waves(repo, merged, groups, trailing, floor)
    else:
        excluded = NO_PER_TASK_MERGES_REASON

    durations_out = _harvest_durations(repo, merged, task_heads, floor)
    remodel, remodel_reason = _remodel(run_dir, durations_out)

    return {
        "runDir": str(run_dir),
        "floor": floor,
        "floorSource": floor_source,
        "excluded": excluded,
        "waves": waves_out,
        "durations": durations_out,
        "remodel": remodel,
        "remodelReason": remodel_reason,
    }


def _stem(run_dir):
    return "%s-shadow-%s" % (datetime.date.today().isoformat(), run_dir.name)


def _render_md(run_dir, payload):
    lines = ["# Shadow fold — %s" % run_dir.name, ""]
    if payload.get("excluded"):
        lines += ["Excluded: %s" % payload["excluded"], ""]
    lines += ["Floor: `%s` (%s)" % (payload.get("floor"), payload.get("floorSource")), ""]
    lines += ["## Waves", "", "| wave | disposition | endpoints |", "| --- | --- | --- |"]
    for w in payload["waves"]:
        lines.append("| %s | %s | %s |" % (w["wave"], w["disposition"], w["endpoints"]))
    lines.append("")
    lines += ["## Narrations", ""]
    any_narration = False
    for w in payload["waves"]:
        for n in w.get("narrations") or []:
            any_narration = True
            lines += ["**wave %s**" % w["wave"], "", "```", n, "```", ""]
    if not any_narration:
        lines += ["none", ""]
    lines += ["## Durations", "", "| task | seconds | reason |", "| --- | --- | --- |"]
    for row in payload["durations"]:
        lines.append("| %s | %s | %s |"
                     % (row["task"], row.get("seconds", ""), row.get("reason", "")))
    lines.append("")
    lines += ["## Remodel", ""]
    if payload.get("remodel"):
        r = payload["remodel"]
        lines.append("waves=%.1f frontier=%.1f frontier_no_same_file=%.1f same_file_edges=%d"
                     % (r["waves"], r["frontier"], r["frontier_no_same_file"],
                        r["same_file_edges"]))
    else:
        lines.append("not modeled: %s" % payload.get("remodelReason"))
    lines.append("")
    return "\n".join(lines)


def _write_park(out_dir, run_dir, reason):
    payload = {"parked": reason}
    stem = _stem(run_dir)
    (out_dir / (stem + ".json")).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    (out_dir / (stem + ".md")).write_text(
        "# Shadow fold — %s\n\nParked: %s\n" % (run_dir.name, reason))


def _write_report(out_dir, run_dir, payload):
    stem = _stem(run_dir)
    (out_dir / (stem + ".json")).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    (out_dir / (stem + ".md")).write_text(_render_md(run_dir, payload))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("run_dir", help="a .claude/ultrapowers/run-<stamp>/ directory")
    parser.add_argument("--repo", default=".", help="repository the run was merged into")
    parser.add_argument("--report", default=None,
                        help="override the report path (default: <run-dir>/report.json)")
    parser.add_argument("--out", default=str(HERE / "results"),
                        help="directory receiving the shadow .md/.json")
    args = parser.parse_args(argv)

    run_dir = Path(args.run_dir)
    repo = Path(args.repo)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    report_path = Path(args.report) if args.report else (run_dir / "report.json")
    if not report_path.exists():
        _write_park(out_dir, run_dir, NO_REPORT_REASON)
        return 0

    try:
        report = json.loads(report_path.read_text())
    except (OSError, ValueError) as exc:
        _write_park(out_dir, run_dir, "report.json unreadable: %s" % exc)
        return 0

    try:
        payload = _shadow(repo, report, run_dir)
    except ShadowAbort as exc:
        print(str(exc), file=sys.stderr)
        return 1

    _write_report(out_dir, run_dir, payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
