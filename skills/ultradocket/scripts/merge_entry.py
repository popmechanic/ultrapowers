#!/usr/bin/env python3
"""Merge a plan branch and transition its docket entry as ONE operation (#252).

The drain's step 4 used to be two steps — `git merge`, then a docket
transition — and on 2026-08-25 (`docket-20260825-010226`) the second ran after
the first had FAILED on a dirty checkout: the docket claimed #222 `executed`
while the integration line did not contain it. The fix is not prose telling the
drain to check; it is having no two-step path to take.

An entry advances only on a merge THIS module verified: `git merge` exit 0 AND
`git merge-base --is-ancestor <branch> HEAD`. Exit code alone is not authority
(`--no-commit` exits 0 and merges nothing). Every other outcome parks the entry
with the reason named, and a merge refused for a dirty checkout parks with the
dirt named rather than continuing.

Exit codes: 0 merged + transitioned; 1 parked (the docket records why);
2 refused before touching git (unknown issue, illegal transition, dirty docket).
"""
import argparse
import dataclasses
import pathlib
import json
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import docket_lib  # noqa: E402


class MergeEntryError(Exception):
    """Refused before any git state changed."""


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def _dirty_paths(repo):
    out = _git(repo, "status", "--porcelain").stdout
    return [ln[3:].strip() for ln in out.splitlines() if ln.strip()]


def _last_line(*streams):
    for s in streams:
        lines = [ln.strip() for ln in (s or "").splitlines() if ln.strip()]
        if lines:
            return lines[-1]
    return ""


def merge_and_transition(repo, branch, docket_path, issue, to_state="executed",
                         merge_args=("--no-ff",)):
    repo = pathlib.Path(repo)
    docket_path = pathlib.Path(docket_path)
    issue = str(issue)
    entries = docket_lib.parse_docket(docket_path.read_text())

    idx = next((i for i, e in enumerate(entries) if e.issue == issue), None)
    if idx is None:
        raise MergeEntryError(f"issue #{issue} is not in {docket_path}")
    # Legality is decided BEFORE the merge: never merge for an entry that
    # cannot advance, or the tree moves and the docket cannot follow it.
    try:
        docket_lib.transition(entries[idx], to_state)
        docket_lib.transition(entries[idx], "parked")
    except docket_lib.DocketError as e:
        raise MergeEntryError(f"#{issue}: {e}") from e

    def write(state, reason):
        entries[idx] = docket_lib.transition(entries[idx], state)
        if reason:
            note = entries[idx].notes
            entries[idx] = dataclasses.replace(
                entries[idx], notes=f"{note} — {reason}" if note else reason)
        docket_path.write_text(docket_lib.serialize_docket(entries) + "\n")
        return {"issue": issue, "branch": branch, "merged": state == to_state,
                "state": state, "reason": reason,
                "headSha": _git(repo, "rev-parse", "HEAD").stdout.strip()}

    dirty = _dirty_paths(repo)
    rel = None
    try:
        rel = str(docket_path.resolve().relative_to(repo.resolve()))
    except ValueError:
        pass
    if rel and rel in dirty:
        raise MergeEntryError(
            f"{rel} has uncommitted changes; refusing to write a park on top of an in-flight edit")
    if dirty:
        return write("parked", f"dirty checkout, merge refused: {', '.join(dirty)}")

    merged = _git(repo, "merge", *merge_args, "-m",
                  f"docket: merge #{issue} ({branch})", branch)
    if merged.returncode != 0:
        _git(repo, "merge", "--abort")
        return write("parked", f"merge failed: {_last_line(merged.stderr, merged.stdout)}")

    verified = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
    if verified.returncode != 0:
        _git(repo, "merge", "--abort")
        return write("parked",
                     f"merge exited 0 but {branch} is not an ancestor of HEAD — unverified")

    return write(to_state, None)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True, help="repo checked out on the docket integration line")
    ap.add_argument("--branch", required=True, help="the plan branch to merge")
    ap.add_argument("--docket", required=True, help="path to docket.md")
    ap.add_argument("--issue", required=True, help="the entry's issue number")
    ap.add_argument("--to", default="executed", help="target state (default: executed)")
    args = ap.parse_args()
    try:
        res = merge_and_transition(args.repo, args.branch, args.docket, args.issue, args.to)
    except (MergeEntryError, docket_lib.DocketError) as e:
        print(f"merge_entry: refused — {e}", file=sys.stderr)
        return 2
    print(json.dumps(res, indent=2))
    return 0 if res["merged"] else 1


if __name__ == "__main__":
    sys.exit(main())
