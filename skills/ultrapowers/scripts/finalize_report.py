#!/usr/bin/env python3
"""Derive report headSha fields from integration-branch ancestry (#259).

Git is the append-only ledger: task branches survive their merge, and the
integration branch tip IS the tree the run produced, whatever round produced
it. This helper folds those facts into report.json once, deterministically —
merge/reconcile agents no longer write <runDir>/heads/ sidecars (#259 deleted
that convention; #114's invariant — nothing the gate trusts rides model
tokens — now holds with zero agent compliance). Per merged task the branch
tip is resolved and asserted an ancestor of the integration tip; the final
MERGED waveMerges entry gets the tip itself (reconcile agents legitimately
append fixup commits after the last branch merge). Intermediate wave heads
stay model-recorded context — no mechanical consumer reads them. Fails
loudly naming the fact; never falls back to token-reported values; rewrites
the report atomically and only on full success.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args),
                          capture_output=True, text=True)


def rev_parse(repo, ref):
    r = _git(repo, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
    return r.stdout.strip() if r.returncode == 0 else None


def is_ancestor(repo, sha, tip):
    return _git(repo, "merge-base", "--is-ancestor", sha, tip).returncode == 0


def select_target(report):
    """Return the dict carrying "waveMerges"/"tasks", or (None, err) if neither
    the top level nor a "result" object has that shape."""
    if isinstance(report.get("waveMerges"), list):
        return report, None
    result = report.get("result")
    if isinstance(result, dict) and isinstance(result.get("waveMerges"), list):
        return result, None
    return None, (
        "wrong shape: report has neither a top-level \"waveMerges\" list "
        "nor a \"result\".\"waveMerges\" list"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--branch", required=True,
                    help="the run's integration branch name")
    a = ap.parse_args()

    try:
        with open(a.report) as f:
            report = json.load(f)
    except OSError as e:
        print("finalize_report: cannot read --report %s: %s" % (a.report, e),
              file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print("finalize_report: --report %s is not valid JSON: %s"
              % (a.report, e), file=sys.stderr)
        sys.exit(1)

    target, shape_err = select_target(report)
    if shape_err:
        print("finalize_report: " + shape_err, file=sys.stderr)
        sys.exit(1)

    tip = rev_parse(a.repo, a.branch)
    if not tip:
        print("finalize_report: integration branch %s does not resolve in %s"
              % (a.branch, a.repo), file=sys.stderr)
        sys.exit(1)

    errors, warnings = [], []
    # #275: the run base (agent-reported at setup — context, not authority)
    # lets us refuse a merged claim whose branch carries no commits beyond it.
    base = rev_parse(a.repo, str(target.get("baseSha") or ""))
    if not base:
        warnings.append("report carries no resolvable baseSha — "
                        "vacuous-merge guard skipped")
    updated = 0
    tasks_by_id = {str(t.get("task")): t for t in (target.get("tasks") or [])}
    merges = target.get("waveMerges") or []

    for wm in merges:
        if wm.get("status") != "MERGED":
            continue
        for tid in wm.get("branches") or []:
            entry = tasks_by_id.get(str(tid))
            if entry is None:
                errors.append("no tasks[] entry for merged task %s" % tid)
                continue
            branch = entry.get("branch")
            if not branch:
                errors.append("tasks[] entry for merged task %s has no "
                              "branch" % tid)
                continue
            tip_b = rev_parse(a.repo, branch)
            if not tip_b:
                errors.append("branch %s (task %s) does not resolve"
                              % (branch, tid))
                continue
            if base and is_ancestor(a.repo, tip_b, base):
                errors.append(
                    "branch %s (task %s) tip %s is already an ancestor of the "
                    "run base %s — merged claim carries no commits beyond the "
                    "run base" % (branch, tid, tip_b, base))
                continue
            if not is_ancestor(a.repo, tip_b, tip):
                errors.append(
                    "branch %s (task %s) tip %s is not an ancestor of %s "
                    "tip %s — task reported merged but never landed"
                    % (branch, tid, tip_b, a.branch, tip))
                continue
            recorded = entry.get("headSha")
            if recorded and recorded != tip_b:
                warnings.append("task %s: recorded headSha %s != derived %s"
                                % (tid, recorded, tip_b))
            entry["headSha"] = tip_b
            updated += 1

    if merges and merges[-1].get("status") == "MERGED":
        recorded = merges[-1].get("headSha")
        if recorded and recorded != tip:
            warnings.append("final wave: recorded headSha %s != derived tip %s"
                            % (recorded, tip))
        merges[-1]["headSha"] = tip
        updated += 1

    for w in warnings:  # context for the operator, never blocking
        print("finalize_report: warning: " + w + " (context, not blocking)",
              file=sys.stderr)
    if errors:
        for e in errors:
            print("finalize_report: " + e, file=sys.stderr)
        sys.exit(1)

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(a.report)))
    with os.fdopen(fd, "w") as f:
        json.dump(report, f, indent=2)
    os.replace(tmp, a.report)
    print("finalize_report: %d headSha field(s) derived from %s ancestry"
          % (updated, a.branch))


if __name__ == "__main__":
    main()
