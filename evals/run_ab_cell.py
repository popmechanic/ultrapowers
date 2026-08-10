#!/usr/bin/env python3
"""#104 subtraction-eval cell driver (plan Task 3, operator-administered).

Runs ONE A/B cell stepwise via evals/ab_runner.py's own functions so the
spec-mandated dirt seeding and pre/post measurements happen between clone and
drive. Prints a JSON summary; leaves the workdir in place (required until the
results doc is written)."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/Users/marcusestes/Websites/ultrapowers/evals")
import ab_runner as ab

ROOT = Path("/Users/marcusestes/Websites/ultrapowers")


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

    # Headless print mode races the SessionStart hook: the Workflow registry
    # snapshots before the hook's harness copy lands, so 'ultrapowers-probe'
    # comes up "not found" even though probe.js is on disk by end of startup
    # (both cells, 21:42; registry answered "Available: deep-research,
    # code-review"). Pre-seed the pinned engine's harnesses BEFORE any claude
    # process starts — files already on disk always make the snapshot.
    wf = workdir / ".claude/workflows"
    wf.mkdir(parents=True, exist_ok=True)
    harnesses = engine / "skills/ultrapowers/harnesses"
    for m in sorted(harnesses.glob("*.harness.json")):
        f = json.loads(m.read_text()).get("file")
        if f and (harnesses / f).is_file():
            shutil.copy2(harnesses / f, wf / f)
    # Real operator repos gitignore .claude/workflows (the hook contract
    # depends on it); mirror that in the clone so the dirt measurement stays
    # scoped to the deliberately seeded dirt below.
    with open(workdir / ".git/info/exclude", "a") as x:
        x.write(".claude/\n")

    # Spec §The eval gate: seed pre-existing operator dirt BEFORE launch.
    (workdir / "OPERATOR-WIP.txt").write_text("uncommitted operator scratch\n")
    tracked = sh(["git", "ls-files"], workdir).stdout.splitlines()[0]
    with open(workdir / tracked, "a") as f:
        f.write("\n# operator uncommitted edit (eval dirt seed)\n")
    dirt_before = sh(["git", "status", "--porcelain"], workdir).stdout

    pre = rev(workdir)
    env = ab.prepare_session_config(engine, workdir.parent)
    # #107 resolved 2026-08-09, round 2: a copy of ~/.claude/.credentials.json
    # goes stale once the live session rotates the refresh token ("OAuth session
    # expired and could not be refreshed", both cells 21:21). Export the LIVE
    # credentials from the macOS Keychain at cell-run time; file copy fallback.
    kc = sh(["security", "find-generic-password",
             "-s", "Claude Code-credentials", "-w"], ROOT)
    cred_text = kc.stdout.strip() if kc.returncode == 0 else ""
    if not cred_text:
        cred = Path.home() / ".claude/.credentials.json"
        cred_text = cred.read_text() if cred.is_file() else ""
    if cred_text:
        dest = Path(env["CLAUDE_CONFIG_DIR"]) / ".credentials.json"
        dest.write_text(cred_text + "\n")
        dest.chmod(0o600)
    transcript, gate_report, mode = ab.drive_run(workdir, plan, env)
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
