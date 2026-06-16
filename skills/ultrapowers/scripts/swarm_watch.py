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
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_run  # sibling: classify, first_user_text


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
        entry["commits"] = branch_commits(repo, integration, name)
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


RING_MAX = 40
EVENT_TEXT_CAP = 200


def _oneline(s, n=EVENT_TEXT_CAP):
    return " ".join((s or "").split())[:n]


def branch_commits(repo, integration, name):
    """Real commits on the branch beyond integration, oldest->newest, with +/- and
    file counts. One `git log --numstat` per branch (the loop already runs git here)."""
    if not integration:
        return []
    out = git(repo, "log", f"{integration}..{name}", "--numstat",
              "--pretty=format:%x1e%h%x1f%s")
    commits = []
    for rec in out.split("\x1e"):
        rec = rec.lstrip("\n")
        if not rec:
            continue
        head, _, body = rec.partition("\n")
        sha, _, subject = head.partition("\x1f")
        add = dele = files = 0
        for ln in body.splitlines():
            cols = ln.split("\t")
            if len(cols) == 3:
                files += 1
                if cols[0].isdigit():
                    add += int(cols[0])
                if cols[1].isdigit():
                    dele += int(cols[1])
        commits.append({"sha": sha, "subject": subject,
                        "additions": add, "deletions": dele, "files": files})
    commits.reverse()  # git log is newest-first; the graph reads oldest-first
    return commits


def _event_from_block(b):
    """(kind, text) for a renderable content block, else None."""
    t = b.get("type")
    if t == "text":
        return ("text", _oneline(b.get("text")))
    if t == "tool_use":
        return ("tool_use", _oneline(b.get("name") or "?"))
    if t == "tool_result":
        c = b.get("content")
        if isinstance(c, list):
            c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
        return ("tool_result", _oneline(c if isinstance(c, str) else str(c)))
    return None


def agents_index(transcript_dir, state):
    """Light per-agent index + bounded recentEvents ring. Incremental: `state`
    persists byte offsets, per-agent counters, and the ring across intervals, so the
    watcher tails only newly appended transcript bytes — never re-reads whole files."""
    ring = state.setdefault("ring", [])
    offsets = state.setdefault("offsets", {})
    counters = state.setdefault("counters", {})
    agents = []
    for f in sorted(transcript_dir.glob("agent-*.jsonl")):
        aid = f.stem[len("agent-"):]
        c = counters.setdefault(aid, {"turns": 0, "tools": 0, "model": "?",
                                      "firstLine": "", "role": None, "task": None})
        if c["role"] is None:
            role, _, task = audit_run.classify(audit_run.first_user_text(f)).partition(":")
            c["role"] = role
            c["task"] = task if task and task != "?" else None
        try:
            st = f.stat()
        except OSError:
            continue
        size, mtime = st.st_size, st.st_mtime
        off = offsets.get(f.name, 0)
        if off > size:      # truncated/rotated: re-read from the top
            off = 0
        grew = size > off
        if grew:
            with open(f, "rb") as fh:
                fh.seek(off)
                chunk = fh.read()
            offsets[f.name] = size
            for line in chunk.decode("utf-8", "replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                typ = d.get("type")
                if typ == "assistant":
                    c["turns"] += 1
                    msg = d.get("message") or {}
                    c["model"] = msg.get("model", c["model"])
                    for b in (msg.get("content") or []):
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_use":
                            c["tools"] += 1
                        if not c["firstLine"] and b.get("type") == "text":
                            c["firstLine"] = _oneline(b.get("text"))
                        ev = _event_from_block(b)
                        if ev:
                            ring.append({"ts": mtime, "task": c["task"], "role": c["role"],
                                         "kind": ev[0], "text": ev[1]})
                elif typ == "user":
                    for b in (d.get("message") or {}).get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_result":
                            ev = _event_from_block(b)
                            if ev:
                                ring.append({"ts": mtime, "task": c["task"], "role": c["role"],
                                             "kind": ev[0], "text": ev[1]})
        agents.append({"id": aid, "file": f.name, "role": c["role"], "task": c["task"],
                       "model": c["model"], "turns": c["turns"], "tools": c["tools"],
                       "state": "active" if grew else "idle",
                       "lastActivity": mtime, "firstLine": c["firstLine"]})
    # iter: 0-based ordinal among agents sharing one (task, role), by discovery order
    seen = {}
    for a in sorted(agents, key=lambda x: (x["lastActivity"], x["file"])):
        key = (a["task"], a["role"])
        a["iter"] = seen.get(key, 0)
        seen[key] = a["iter"] + 1
    ring.sort(key=lambda e: e["ts"])
    if len(ring) > RING_MAX:
        del ring[:-RING_MAX]
    return {"runId": transcript_dir.name, "ts": time.time(),
            "agents": agents, "recentEvents": list(ring)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default=".")
    p.add_argument("--out", default=".", help="directory containing swarm.html")
    p.add_argument("--interval", type=float, default=2.0)
    p.add_argument("--integration", help="integration branch (default: newest ultra/integration-*)")
    p.add_argument("--once", action="store_true")
    p.add_argument("--transcripts", help="run transcript dir — also emit agents.json")
    args = p.parse_args()

    repo = pathlib.Path(args.repo).resolve()
    git(repo, "rev-parse", "--git-dir", check=True)
    out = pathlib.Path(args.out) / "status.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tdir = pathlib.Path(args.transcripts) if args.transcripts else None
    agents_out = pathlib.Path(args.out) / "agents.json"
    astate = {}

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
        if tdir and tdir.is_dir():
            idx = agents_index(tdir, astate)
            atmp = agents_out.with_suffix(".tmp")
            atmp.write_text(json.dumps(idx))
            os.replace(atmp, agents_out)
        if args.once:
            print(json.dumps(snap, indent=2))
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
