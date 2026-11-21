#!/usr/bin/env python3
import argparse, datetime, json, os, re, shutil, statistics, subprocess, sys, tempfile

DESCRIPTION = ("The boot clock: per run, the seconds from launch to its first builder's claim, "
               "read from the evidence repository.")
LOGS = ("fleet-setup.log", "fleet-boot.log")
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0",
           "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=15"}
REACH_S = 30
GIT_S = 120
STAMP = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?)\s+(.*)$")


class Unreadable(Exception):
    pass


def git(repo, *a, check=True):
    try:
        r = subprocess.run(["git", "-C", repo, *a], capture_output=True, env=GIT_ENV, timeout=GIT_S)
    except subprocess.TimeoutExpired:
        raise Unreadable(f"git {' '.join(a)}: no answer within {GIT_S} s")
    if check and r.returncode:
        raise Unreadable(f"git {' '.join(a)}: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8", "replace") if not r.returncode else None


def when(s):
    s = s.strip().replace("Z", "+00:00")
    m = re.match(r"^(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$", s)
    if m and m.group(2):
        s = m.group(1) + (m.group(2) + "000000")[:7] + m.group(3)
    t = datetime.datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)


def read_run(repo, remote, slug, n):
    tag = f"{slug}/run-{n}"
    git(repo, "fetch", "-q", "--filter=blob:none", remote, f"refs/tags/{tag}:refs/tags/{tag}")
    root = git(repo, "rev-list", "--max-parents=0", tag).split()
    plans = [c for c in root if git(repo, "log", "-1", "--format=%s", c).startswith("ultrapowers plan")]
    plan = (plans or root)[0]
    launch = datetime.datetime.fromtimestamp(int(git(repo, "log", "-1", "--format=%ct", plan)),
                                             datetime.timezone.utc)
    folder = f"runs/{slug}/{n}"
    claim = None
    for line in git(repo, "show", f"{tag}:{folder}/events.jsonl").splitlines():
        if line.strip().startswith("{"):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("kind") == "session:start":
                try:
                    claim = when(e["ts"])
                except (KeyError, TypeError, AttributeError, ValueError):
                    raise Unreadable(f"first session:start row in {folder}/events.jsonl has no readable ts: "
                                     f"{e.get('ts')!r}")
                break
    if claim is None:
        raise Unreadable(f"no session:start row in {folder}/events.jsonl")
    out = [f"run-{n} launch_to_first_claim_s={(claim - launch).total_seconds():.1f}"]
    for log in LOGS:
        text = git(repo, "show", f"{tag}:{folder}/{log}", check=False)
        for line in (text or "").splitlines():
            m = STAMP.match(line)
            if m:
                out.append(f"  {log} {m.group(2).strip()} s={(when(m.group(1)) - launch).total_seconds():.1f}")
    return (claim - launch).total_seconds(), out


def main():
    ap = argparse.ArgumentParser(description=DESCRIPTION)
    ap.add_argument("--remote", required=True, help="evidence repository: any git URL or path")
    ap.add_argument("--slug", required=True, help="the run's <owner-repo>")
    ap.add_argument("runs", nargs="+", type=int)
    a = ap.parse_args()
    runs = sorted(set(a.runs))
    repo = tempfile.mkdtemp(prefix="boot_clock-")
    try:
        try:
            git(repo, "init", "-q")
            git(repo, "remote", "add", "origin", a.remote)
            git(repo, "config", "remote.origin.promisor", "true")
            git(repo, "config", "remote.origin.partialclonefilter", "blob:none")
        except Unreadable as e:
            sys.exit(str(e))
        try:
            r = subprocess.run(["git", "-C", repo, "ls-remote", "-q", "--exit-code", "origin", "HEAD"],
                               capture_output=True, env=GIT_ENV, timeout=REACH_S)
        except subprocess.TimeoutExpired:
            sys.exit(f"cannot reach the record at {a.remote}: no answer within {REACH_S} s")
        if r.returncode not in (0, 2):
            err = " ".join(r.stderr.decode("utf-8", "replace").split())
            sys.exit(f"cannot reach the record at {a.remote}: {err}")
        read = []
        for n in runs:
            try:
                s, lines = read_run(repo, "origin", a.slug, n)
            except Unreadable as e:
                print(f"run-{n} skipped: {' '.join(str(e).split())}", flush=True)
                continue
            read.append((n, s))
            print("\n".join(lines), flush=True)
    finally:
        shutil.rmtree(repo, ignore_errors=True)
    window = f"run-{read[0][0]}..run-{read[-1][0]}" if read else "none"
    median = f"{statistics.median(s for _, s in read):.1f}" if read else "none"
    print(f"n={len(read)} of={len(runs)} window={window} median_s={median}")


if __name__ == "__main__":
    main()
