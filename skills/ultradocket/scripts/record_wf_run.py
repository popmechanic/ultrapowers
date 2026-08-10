#!/usr/bin/env python3
"""Record a drain-launched workflow run ID where the frozen gate already looks (#122).

The Step-5 gate driver records wf run IDs into run-<stamp>/wf-runs.json; the
drain bypasses that driver by design, so teardown/approve reported an empty
sweep set. This helper writes the same file, importing the FROZEN reader for
shape fidelity (a bare sorted JSON array of run-id strings — drift impossible
by construction). Usage: record_wf_run.py <stamp> <wf_runId>
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # frozen module: imported, never edited


def main():
    if len(sys.argv) != 3:
        print("usage: record_wf_run.py <stamp> <wf_runId>", file=sys.stderr)
        return 2
    stamp, run_id = sys.argv[1], sys.argv[2]
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if top.returncode != 0:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    run_dir = Path(top.stdout.strip()) / ".claude/ultrapowers" / ("run-" + stamp)
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


if __name__ == "__main__":
    sys.exit(main())
