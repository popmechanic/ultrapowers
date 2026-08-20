#!/usr/bin/env python3
"""Record drain-launched workflow evidence under .claude/ultrapowers/ (#122, #150).

Two modes:

run-id (legacy, unchanged): `record_wf_run.py <stamp> <wf_runId>`.
The Step-5 gate driver records wf run IDs into run-<stamp>/wf-runs.json; the
drain bypasses that driver by design, so teardown/approve reported an empty
sweep set. This mode writes the same file, importing the FROZEN reader for
shape fidelity (a bare sorted JSON array of run-id strings — drift impossible
by construction).

stamp (#150 mode c): `record_wf_run.py stamp <stamp> <entry> --verdict <v>
--exit-code <n> --branch <b> --base <ref>` mirrors a drain-administered gate
outcome to `<repo-root>/.claude/ultrapowers/receipts/<stamp>-<entry>.json` —
a teardown-surviving, gitignored record the ultralearn harvester reads when
the runDir itself is gone. Mirror-only (no runDir copy — the motivating mode
is precisely a deleted runDir). Verdict authority remains the gate's exit
code; the stamp is evidence for the sensor, never authority. Re-recording
the same <stamp>/<entry> overwrites: last write wins, the final verdict is
the record. THIS SCRIPT IS THE SCHEMA AUTHORITY for the stamp record — the
harvester's tests generate fixtures by invoking this writer, so writer and
reader cannot drift apart silently. Derive-don't-record: `headSha` is
resolved from git at record time, present only when `--branch` resolves to
a commit, so the ancestry join survives the branch being swept. Receipt
filenames `<stamp>-<entry>.json` are NOT hyphen-splittable (both parts may
themselves contain hyphens); readers must key on the record's own
`stamp`/`entry` fields.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # frozen module: imported, never edited

USAGE = ("usage: record_wf_run.py <stamp> <wf_runId>\n"
         "       record_wf_run.py stamp <stamp> <entry> --verdict <v> "
         "--exit-code <n> --branch <b> --base <ref>")


def _repo_root():
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if top.returncode != 0:
        return None
    return Path(top.stdout.strip())


def _run_id_mode(argv):
    if len(argv) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    stamp, run_id = argv
    root = _repo_root()
    if root is None:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    run_dir = root / ".claude/ultrapowers" / ("run-" + stamp)
    ids, unreadable = load_wf_runs(run_dir)
    if unreadable:
        print("record_wf_run: existing wf-runs.json is unreadable — refusing to "
              "clobber it; inspect %s" % (run_dir / "wf-runs.json"), file=sys.stderr)
        return 1
    merged = sorted(set(ids) | {run_id})
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "wf-runs.json").write_text(json.dumps(merged, indent=2))
    print("record_wf_run: %s now records %d run id(s)" % (run_dir / "wf-runs.json", len(merged)))
    return 0


def _stamp_mode(argv):
    parser = argparse.ArgumentParser(
        prog="record_wf_run.py stamp",
        description="Mirror a drain-administered gate outcome to a "
                    "teardown-surviving stamp record (#150 mode c).")
    parser.add_argument("stamp")
    parser.add_argument("entry")
    parser.add_argument("--verdict", required=True)
    parser.add_argument("--exit-code", required=True, type=int, dest="exit_code")
    parser.add_argument("--branch", required=True)
    parser.add_argument("--base", required=True)
    args = parser.parse_args(argv)  # argparse exits 2 on a usage error
    if "/" in args.stamp or "/" in args.entry:
        print("record_wf_run: <stamp> and <entry> must not contain '/'",
              file=sys.stderr)
        return 2
    root = _repo_root()
    if root is None:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    head = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--verify", args.branch + "^{commit}"],
        capture_output=True, text=True)
    head_sha = head.stdout.strip() if head.returncode == 0 else None
    if head_sha is None:
        print("record_wf_run: branch %r did not resolve — recording without "
              "headSha (ancestry join will depend on the branch surviving)"
              % args.branch, file=sys.stderr)
    receipts = root / ".claude/ultrapowers/receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    record = {
        "mode": "drain-stamp",
        "stamp": args.stamp,
        "entry": args.entry,
        "verdict": args.verdict,
        "gateExit": args.exit_code,
        "branch": args.branch,
        "base": args.base,
        **({"headSha": head_sha} if head_sha else {}),
        "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path = receipts / ("%s-%s.json" % (args.stamp, args.entry))
    path.write_text(json.dumps(record, indent=2))  # last write wins by design
    print("record_wf_run: stamp record written to %s" % path)
    return 0


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == "stamp":
        return _stamp_mode(argv[1:])
    return _run_id_mode(argv)


if __name__ == "__main__":
    sys.exit(main())
