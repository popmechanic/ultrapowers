#!/usr/bin/env python3
"""Overwrite report headSha fields from the run's heads/ sidecars (#114).

The merge agent writes each SHA mechanically (git rev-parse output shell-
redirected into <runDir>/heads/ slots); this helper copies those file-derived
values into report.json so nothing the gate trusts ever rides model tokens.
Fails loudly naming the slot; never falls back to the token-reported values;
rewrites the report atomically and only on full success.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HEX40 = re.compile(r"^[0-9a-f]{40}$")


def read_slot(heads_dir, slot):
    path = os.path.join(heads_dir, slot)
    if not os.path.isfile(path):
        return None, "missing sidecar " + slot
    raw = open(path).read().strip()
    if not HEX40.match(raw):
        return None, "malformed sidecar %s: %r" % (slot, raw[:60])
    return raw, None


def resolves(repo, sha):
    return subprocess.run(
        ["git", "-C", repo, "rev-parse", "--verify", "--quiet", sha + "^{commit}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", required=True)
    ap.add_argument("--heads", required=True)
    ap.add_argument("--repo", required=True)
    a = ap.parse_args()

    with open(a.report) as f:
        report = json.load(f)

    errors = []
    updated = 0
    tasks_by_id = {str(t.get("task")): t for t in (report.get("tasks") or [])}

    for wm in report.get("waveMerges") or []:
        if wm.get("status") != "MERGED":
            continue
        for slot, apply in [("wave-%s" % wm.get("wave"), lambda s, wm=wm: wm.__setitem__("headSha", s))] + [
            ("task-%s" % tid, lambda s, tid=tid: tasks_by_id.get(str(tid), {}).__setitem__("headSha", s))
            for tid in (wm.get("branches") or [])
        ]:
            sha, err = read_slot(a.heads, slot)
            if err:
                errors.append(err)
            elif not resolves(a.repo, sha):
                errors.append("non-resolving sidecar %s: %s" % (slot, sha))
            else:
                apply(sha)
                updated += 1

    if errors:
        for e in errors:
            print("finalize_report: " + e, file=sys.stderr)
        sys.exit(1)

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(a.report)))
    with os.fdopen(fd, "w") as f:
        json.dump(report, f, indent=2)
    os.replace(tmp, a.report)
    print("finalize_report: %d headSha field(s) derived from %s" % (updated, a.heads))


if __name__ == "__main__":
    main()
