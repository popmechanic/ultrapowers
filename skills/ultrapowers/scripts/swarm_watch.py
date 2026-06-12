#!/usr/bin/env python3
"""Observe an ultrapowers run through git and write status.json for the viewer.

Reads ONLY observable engine footprints — never touches the engine itself:
  - worktrees under .claude/worktrees/wf_*           (task in flight)
  - branches matching worktree-wf_*                  (implementer committed)
  - the integration branch (ultra/integration-*)     (wave merged: branch tip
    becomes an ancestor of integration HEAD, or vanishes after the merge
    agent's cleanup while integration advanced)

Usage:
  swarm_watch.py --repo <target-repo> --out <dir-with-swarm.html> \
      [--interval 2] [--integration BRANCH] [--once]
"""
import argparse
import json
import os
import pathlib
import subprocess
import time


def git(repo, *args, check=False):
    proc = subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise SystemExit(f"git {' '.join(args)}: {proc.stderr.strip()}")
    return proc.stdout.strip() if proc.returncode == 0 else ""


def find_integration(repo, explicit):
    if explicit:
        return explicit
    out = git(repo, "for-each-ref", "--sort=-committerdate",
              "--format=%(refname:short)", "refs/heads/ultra/integration-*")
    return out.splitlines()[0] if out else None


def worktrees(repo):
    out = git(repo, "worktree", "list", "--porcelain")
    items, cur = [], {}
    for line in out.splitlines() + [""]:
        if not line:
            if cur.get("path") and "/.claude/worktrees/wf_" in cur["path"]:
                items.append(cur)
            cur = {}
        elif line.startswith("worktree "):
            cur["path"] = line[9:]
        elif line.startswith("branch "):
            cur["branch"] = line[7:].replace("refs/heads/", "")
        elif line == "locked":
            cur["locked"] = True
    return items


def snapshot(repo, integration):
    wts = worktrees(repo)
    wt_by_branch = {w.get("branch"): w for w in wts if w.get("branch")}

    branches = []
    out = git(repo, "for-each-ref", "--format=%(refname:short) %(objectname)",
              "refs/heads/worktree-wf_*")
    for line in out.splitlines():
        name, sha = line.split()
        entry = {"name": name, "sha": sha, "ahead": 0, "merged": False,
                 "worktree": (wt_by_branch.get(name) or {}).get("path", "")}
        if integration:
            ahead = git(repo, "rev-list", "--count", f"{integration}..{name}")
            entry["ahead"] = int(ahead) if ahead.isdigit() else 0
            entry["merged"] = subprocess.run(
                ["git", "-C", str(repo), "merge-base", "--is-ancestor",
                 name, integration], capture_output=True).returncode == 0
        branches.append(entry)

    integ = None
    if integration:
        sha = git(repo, "rev-parse", integration)
        subject = git(repo, "log", "-1", "--format=%s", integration)
        integ = {"branch": integration, "sha": sha, "last_subject": subject}
    return {"branches": branches,
            "worktrees": [{"path": w["path"], "branch": w.get("branch", ""),
                           "locked": w.get("locked", False)} for w in wts],
            "integration": integ}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default=".")
    p.add_argument("--out", default=".", help="directory containing swarm.html")
    p.add_argument("--interval", type=float, default=2.0)
    p.add_argument("--integration", help="integration branch (default: newest ultra/integration-*)")
    p.add_argument("--once", action="store_true")
    args = p.parse_args()

    repo = pathlib.Path(args.repo).resolve()
    git(repo, "rev-parse", "--git-dir", check=True)
    out = pathlib.Path(args.out) / "status.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    last_integration_sha = None
    while True:
        integration = find_integration(repo, args.integration)
        snap = snapshot(repo, integration)
        snap["ts"] = time.time()
        if snap["integration"]:
            snap["integration"]["advanced"] = (
                last_integration_sha is not None
                and snap["integration"]["sha"] != last_integration_sha)
            last_integration_sha = snap["integration"]["sha"]
        tmp = out.with_suffix(".tmp")
        tmp.write_text(json.dumps(snap))
        os.replace(tmp, out)
        if args.once:
            print(json.dumps(snap, indent=2))
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
