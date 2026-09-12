#!/usr/bin/env python3
"""evals/kata_lag_run112.py — the hub-vs-evidence lag reading for run-112 (#937, map #810).

#913's second question — does the operator see the run turn on the hub before the
evidence branch shows it — was answered qualitatively on run-111. This is the one
quantitative reading, taken from the record and nothing else:

  for every `driver:*` event on run-112's evidence tag, the engine's own `ts`
  (milliseconds, written when the event was appended) is paired with

    (a) the hub's `created_at` for the comment that carried that same line —
        the engine posts every `driver:*` event to the task's (or run's) kata
        issue as a comment whose body IS the event line, so the pairing is the
        event `id` inside the comment body, read out of `kata.jsonl`; and

    (b) the committer date of the FIRST evidence commit whose diff added the
        event's `id` — `git log --reverse --format=%cI -S<id> <tag>` — which is
        when the evidence branch first carried it.

Both lags are (record time − engine ts), in seconds; the script prints the
sample size, median and p90 of each, and the unmatched counts. A one-off: the
tag is read at whatever sha it points to today, and the script runs from a
checkout of the repository the tag lives in (`git fetch origin tag
ultra/evidence/run-112` first — refused fetches are tolerated when the tag is
already local).

    python3 evals/kata_lag_run112.py [--run 112] [--repo .]
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
from datetime import datetime, timezone


def git(repo: str, *args: str, check: bool = True) -> str:
    res = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and res.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed ({res.returncode}): {res.stderr.strip()}")
    return res.stdout


def parse_iso(s: str) -> float:
    """An RFC 3339 stamp → epoch seconds. Nanosecond fractions are cut to micro."""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if "." in s:
        head, tail = s.split(".", 1)
        frac = ""
        i = 0
        while i < len(tail) and tail[i].isdigit():
            frac += tail[i]
            i += 1
        s = head + "." + frac[:6].ljust(6, "0") + tail[i:]
    return datetime.fromisoformat(s).astimezone(timezone.utc).timestamp()


def p90(xs: list[float]) -> float:
    if not xs:
        return float("nan")
    ys = sorted(xs)
    k = max(0, min(len(ys) - 1, int(round(0.9 * (len(ys) - 1)))))
    return ys[k]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=int, default=112)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--remote", default="origin")
    args = ap.parse_args()

    tag = f"ultra/evidence/run-{args.run}"
    run_dir = f".ultrapowers/runs/{args.run}"

    # The tag, fetched when it can be; a checkout that already holds it reads on.
    subprocess.run(["git", "-C", args.repo, "fetch", args.remote, "tag", tag],
                   capture_output=True, text=True)
    if git(args.repo, "rev-parse", "--verify", "--quiet", tag + "^{commit}", check=False).strip() == "":
        raise SystemExit(f"{tag} is not in {args.repo} and could not be fetched from {args.remote}")

    events_raw = git(args.repo, "show", f"{tag}:{run_dir}/events.jsonl")
    kata_raw = git(args.repo, "show", f"{tag}:{run_dir}/kata.jsonl")

    driver = []
    for line in events_raw.splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if str(e.get("kind", "")).startswith("driver:") and isinstance(e.get("ts"), (int, float)) and e.get("id"):
            driver.append(e)

    # (a) the hub: comment body → the event id it carries → the hub's created_at.
    hub_at: dict[str, float] = {}
    comments = 0
    for line in kata_raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("kind") != "event" or row.get("type") != "issue.commented":
            continue
        comments += 1
        payload = row.get("payload") or {}
        body = payload.get("body")
        try:
            inner = json.loads(body) if isinstance(body, str) else None
        except json.JSONDecodeError:
            inner = None
        eid = inner.get("id") if isinstance(inner, dict) else None
        stamp = row.get("created_at") or payload.get("created_at")
        if eid and stamp and eid not in hub_at:
            hub_at[eid] = parse_iso(stamp)

    # (b) the evidence branch: the first commit whose diff added the id.
    commit_at: dict[str, float] = {}
    for e in driver:
        out = git(args.repo, "log", "--reverse", "--format=%cI", f"-S{e['id']}", tag, check=False)
        first = next((l for l in out.splitlines() if l.strip()), None)
        if first:
            commit_at[e["id"]] = parse_iso(first)

    hub_lags, commit_lags = [], []
    rows = []
    for e in driver:
        ts = e["ts"] / 1000.0
        h = hub_at.get(e["id"])
        c = commit_at.get(e["id"])
        hl = (h - ts) if h is not None else None
        cl = (c - ts) if c is not None else None
        if hl is not None:
            hub_lags.append(hl)
        if cl is not None:
            commit_lags.append(cl)
        rows.append((e["kind"], e.get("task"), hl, cl))

    def fmt(x):
        return "—" if x is None else f"{x:8.1f}"

    print(f"run-{args.run} — {tag} at {git(args.repo, 'rev-parse', tag + '^{commit}').strip()[:12]}")
    print(f"driver:* events on the tag: {len(driver)}; hub comments in kata.jsonl: {comments}")
    print()
    print("| kind | task | hub lag (s) | evidence-commit lag (s) |")
    print("|---|---|---:|---:|")
    for kind, task, hl, cl in rows:
        print(f"| `{kind}` | {task if task is not None else '—'} | {fmt(hl)} | {fmt(cl)} |")
    print()
    print("| lag | n | median (s) | p90 (s) |")
    print("|---|---:|---:|---:|")
    for name, xs in (("engine ts → hub comment created_at", hub_lags),
                     ("engine ts → first evidence commit", commit_lags)):
        if xs:
            print(f"| {name} | {len(xs)} | {statistics.median(xs):.1f} | {p90(xs):.1f} |")
        else:
            print(f"| {name} | 0 | — | — |")
    print()
    print(f"unmatched on the hub: {len(driver) - len(hub_lags)} of {len(driver)}; "
          f"never carried by an evidence commit: {len(driver) - len(commit_lags)} of {len(driver)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
