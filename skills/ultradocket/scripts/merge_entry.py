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

The docket write is committed on the integration line before returning: a
docket left dirty would refuse the drain's NEXT entry, which turns one
protection into a halt. And `parked` is terminal in `docket_lib`, so a park is
unrecoverable in-band — the dirt test therefore reads TRACKED modifications
only (`--untracked-files=no`). An untracked scratch file never blocks a merge
git itself would complete, because that park could not be undone.

Exit codes: 0 merged + transitioned; 1 parked (the docket records why);
2 refused or errored WITHOUT touching git or the docket.
"""
import argparse
import dataclasses
import pathlib
import json
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import docket_lib  # noqa: E402

_DIAGNOSTIC = ("CONFLICT", "error:", "fatal:")


class MergeEntryError(Exception):
    """Refused before any git state changed."""


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def _dirty_paths(repo):
    """Tracked modifications only. An untracked artifact left by an executor or
    a gate does not stop a merge git would complete, and a park is terminal."""
    out = _git(repo, "status", "--porcelain", "--untracked-files=no").stdout
    return [ln[3:].strip() for ln in out.splitlines() if ln.strip()]


def _diagnostic(*streams):
    """The line that NAMES the failure — git puts `CONFLICT (content): <path>`
    above a generic trailer, and the trailer is what a naive last-line pick
    returns. Prefer the named lines, in the order git printed them."""
    lines = [ln.strip() for s in streams for ln in (s or "").splitlines() if ln.strip()]
    named = [ln for ln in lines if any(k in ln for k in _DIAGNOSTIC)]
    return "; ".join(named) if named else (lines[-1] if lines else "")


def _abort(repo):
    """Undo a half-applied merge. If the abort itself fails the tree is left
    mid-merge while the docket records a clean park, so it is named in the
    reason rather than swallowed."""
    r = _git(repo, "merge", "--abort")
    return "" if r.returncode == 0 else f" (merge --abort FAILED: {_diagnostic(r.stderr, r.stdout)})"


def merge_and_transition(repo, branch, docket_path, issue, to_state="executed",
                         merge_args=("--no-ff",), commit_docket=True):
    repo = pathlib.Path(repo)
    docket_path = pathlib.Path(docket_path)
    issue = str(issue)
    if to_state == "parked":
        raise MergeEntryError("--to parked is not a merge; parking is what a failed merge does")
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

    rel = None
    try:
        rel = str(docket_path.resolve().relative_to(repo.resolve()))
    except ValueError:
        pass

    def write(state, reason, merged):
        entries[idx] = docket_lib.transition(entries[idx], state)
        if reason:
            note = entries[idx].notes
            entries[idx] = dataclasses.replace(
                entries[idx], notes=f"{note} — {reason}" if note else reason)
        docket_path.write_text(docket_lib.serialize_docket(entries) + "\n")
        if commit_docket and rel:
            _git(repo, "add", "--", rel)
            _git(repo, "commit", "-q", "-m", f"docket: #{issue} {state}", "--", rel)
        return {"issue": issue, "branch": branch, "merged": merged,
                "state": state, "reason": reason,
                "headSha": _git(repo, "rev-parse", "HEAD").stdout.strip()}

    dirty = _dirty_paths(repo)
    if rel and rel in dirty:
        raise MergeEntryError(
            f"{rel} has uncommitted changes; refusing to write a park on top of an in-flight edit")
    if dirty:
        return write("parked", f"dirty checkout, merge refused: {', '.join(dirty)}", False)

    merged = _git(repo, "merge", *merge_args, "-m",
                  f"docket: merge #{issue} ({branch})", branch)
    if merged.returncode != 0:
        note = _abort(repo)
        return write("parked",
                     f"merge failed: {_diagnostic(merged.stdout, merged.stderr)}{note}", False)

    verified = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
    if verified.returncode != 0:
        note = _abort(repo)
        return write("parked",
                     f"merge exited 0 but {branch} is not an ancestor of HEAD — unverified{note}",
                     False)

    return write(to_state, None, True)


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
    except Exception as e:  # exit 1 means PARKED and recorded; nothing else may claim it
        print(f"merge_entry: refused — {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    print(json.dumps(res, indent=2))
    return 0 if res["merged"] else 1


if __name__ == "__main__":
    sys.exit(main())
