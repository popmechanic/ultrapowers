#!/usr/bin/env python3
"""#104 subtraction-eval cell driver (plan Task 3, operator-administered).

Runs ONE A/B cell stepwise via evals/ab_runner.py's own functions so the
spec-mandated dirt seeding and pre/post measurements happen between clone and
drive. Prints a JSON summary; leaves the workdir in place (required until the
results doc is written).

Run it in place from the main checkout: ROOT and the ab_runner import are
__file__-relative, so a copied driver fails at import, and invoking the copy
inside a worktree would measure THAT worktree's fixtures, not main's."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_runner as ab

ROOT = Path(__file__).resolve().parents[1]


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)


def rev(workdir):
    b = sh(["git", "branch", "--show-current"], workdir).stdout.strip()
    h = sh(["git", "rev-parse", "HEAD"], workdir).stdout.strip()
    return {"branch": b, "head": h}


def main():
    engine_ref, label = sys.argv[1], sys.argv[2]
    plan = ab.build_run_plan(engine_ref, label, "chained", ROOT)
    engine = ab.prepare_engine(engine_ref, ROOT)
    ab.install_seals(plan, ROOT)
    workdir, baseline = ab.clone_project(plan)

    # Registry-race fix + .claude/ exclude live in the kit (ab.seed_workflows).
    ab.seed_workflows(engine, workdir)

    # Spec §The eval gate: seed pre-existing operator dirt BEFORE launch.
    (workdir / "OPERATOR-WIP.txt").write_text("uncommitted operator scratch\n")
    tracked = sh(["git", "ls-files"], workdir).stdout.splitlines()[0]
    with open(workdir / tracked, "a") as f:
        f.write("\n# operator uncommitted edit (eval dirt seed)\n")
    dirt_before = sh(["git", "status", "--porcelain"], workdir).stdout

    pre = rev(workdir)
    # Keychain-first auth seeding (#107 round 2) lives in the kit — done
    # inside ab.prepare_session_config via ab.seed_credentials.
    env = ab.prepare_session_config(engine, workdir.parent)
    try:
        transcript, gate_report, mode = ab.drive_run(workdir, plan, env)
    finally:  # the seeded token never outlives the drive (kit contract)
        ab.scrub_credentials(env)
    post = rev(workdir)
    dirt_after = sh(["git", "status", "--porcelain"], workdir).stdout

    receipts = {}
    for rd in sorted((workdir / ".claude/ultrapowers").glob("run-*")):
        entry = {}
        for name in ("receipt.json", "gate-receipt.json"):
            p = rd / name
            if p.is_file():
                try:
                    entry[name] = json.loads(p.read_text())
                except Exception as e:
                    entry[name] = {"unreadable": str(e)}
        receipts[rd.name] = entry

    print(json.dumps({
        "label": label, "engineRef": engine_ref, "mode": mode,
        "workdir": str(workdir), "baseline": baseline,
        "pre": pre, "post": post,
        "dirtSeededBefore": dirt_before, "dirtAfter": dirt_after,
        "gateReportFromResult": gate_report,
        "diskReceipts": receipts,
        "transcript": str(transcript),
    }, indent=2))


if __name__ == "__main__":
    main()
