#!/usr/bin/env python3
"""The boot clock (fast-boot spec §1): per run, the seconds from launch to its first builder's
claim. Not a test: nothing runs it automatically; run it to re-read the answer over newer runs.

    python3 evals/readings/boot_clock.py --remote <evidence repository URL> --slug <owner-repo> <run>...

Launch is the committer time of the run's parentless plan commit (the launcher pushes it one
second before its lobby `new`); the first claim is the `ts` of the first `session:start` row of
`runs/<slug>/<N>/events.jsonl` at the tag `<slug>/run-<N>`. Per run it prints
`run-<N> launch_to_first_claim_s=<s>`, then, when the run's folder carries `fleet-setup.log` or
`fleet-boot.log`, one line per stamped log line: its step and its seconds since the plan commit.
The last line is `n=<runs read> window=run-<first>..run-<last> median_s=<s>`. The tags are
fetched blobless into a temporary repository of the tool's own, deleted after."""
import argparse, datetime, json, re, shutil, statistics, subprocess, sys, tempfile

LOGS = ("fleet-setup.log", "fleet-boot.log")
STAMP = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?)\s+(.*)$")


def git(repo, *a, check=True):
    r = subprocess.run(["git", "-C", repo, *a], capture_output=True)
    if check and r.returncode:
        sys.exit(f"git {' '.join(a)}: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8", "replace") if not r.returncode else None


def when(s):
    """An ISO time, second- or sub-second-resolution, `Z` or offset (naive reads as UTC)."""
    s = s.strip().replace("Z", "+00:00")
    m = re.match(r"^(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$", s)
    if m and m.group(2):                  # fromisoformat before 3.11 takes 3 or 6 digits only
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
            e = json.loads(line)
            if e.get("kind") == "session:start":
                claim = when(e["ts"])
                break
    if claim is None:
        sys.exit(f"{tag}: no session:start row in {folder}/events.jsonl")
    out = [f"run-{n} launch_to_first_claim_s={(claim - launch).total_seconds():.1f}"]
    for log in LOGS:
        text = git(repo, "show", f"{tag}:{folder}/{log}", check=False)
        for line in (text or "").splitlines():
            m = STAMP.match(line)
            if m:
                out.append(f"  {log} {m.group(2).strip()} s={(when(m.group(1)) - launch).total_seconds():.1f}")
    return (claim - launch).total_seconds(), out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--remote", required=True, help="evidence repository: any git URL or path")
    ap.add_argument("--slug", required=True, help="the run's <owner-repo>")
    ap.add_argument("runs", nargs="+", type=int)
    a = ap.parse_args()
    runs = sorted(set(a.runs))
    repo = tempfile.mkdtemp(prefix="boot_clock-")
    try:
        git(repo, "init", "-q")
        # The fetch URL as a promisor remote, so blobs the blobless fetch skipped load on demand.
        git(repo, "remote", "add", "origin", a.remote)
        git(repo, "config", "remote.origin.promisor", "true")
        git(repo, "config", "remote.origin.partialclonefilter", "blob:none")
        secs = []
        for n in runs:
            s, lines = read_run(repo, "origin", a.slug, n)
            secs.append(s)
            print("\n".join(lines), flush=True)
    finally:
        shutil.rmtree(repo, ignore_errors=True)
    print(f"n={len(secs)} window=run-{runs[0]}..run-{runs[-1]} median_s={statistics.median(secs):.1f}")


if __name__ == "__main__":
    main()
