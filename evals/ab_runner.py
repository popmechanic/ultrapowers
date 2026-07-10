#!/usr/bin/env python3
"""A/B eval runner — one cell per invocation, run serially by hand.

Adapted from the removed dev eval harness (git 589114e^): local-marketplace
engine pinning (prepare_run.sh), the headless `claude -p` drive + workflow probe
(night_runner.sh), transcript output-token harvest (extract_tokens.py), and
fixture seal installs (seal_fixture.py). Protocol lineage: evals/README.md at
589114e^ ("Protocol — one run, start to finish").

The runner executes ONE cell per invocation. The A/B protocol is six invocations
run serially by hand — concurrent /ultrapowers runs corrupt each other's
checkouts (CLAUDE.md: "Self-hosting a /ultrapowers run? Serialize them."). It
never runs in CI. The pytest coverage exercises assembly (`build_run_plan`) and
harvest (`harvest_row`) only and never invokes `claude`.

Fixture layout consumed:  evals/fixtures/<name>/plan.md
                          evals/fixtures/<name>/project/
                          evals/fixtures/<name>/acceptance/[<seal-id>/ | test_*.py]
Results layout produced:  evals/results/runs.jsonl   (one row per run)
                          evals/results/diffs/<fixture>-<engine>.diff
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

RESULTS = "evals/results"

# seal_hash is the ONE canonical suite-hash implementation (frozen module); the
# flat-acceptance seal path reuses it exactly as seal_fixture.py did (589114e^).
_SCRIPTS = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
try:
    from seal_hash import suite_hash  # noqa: E402
except ImportError:  # pragma: no cover - only if the plugin scripts move
    suite_hash = None


# --------------------------------------------------------------------------- #
# Assembly + harvest (unit-tested; never touch claude)                        #
# --------------------------------------------------------------------------- #
def discover_seals(acceptance_dir):
    """Enumerate the sealed-exam installs for a fixture's acceptance/ dir.

    Two shapes per the fixture layout contract:
      * acceptance/<seal-id>/  — pre-built vault entries (manifest.json + suite/),
        copied verbatim into the vault (mode "vault-entry").
      * acceptance/test_*.py   — a flat held-out suite, sealed on the fly the way
        seal_fixture.py did: hash the dir, install under sha[:12] (mode
        "seal-suite"). All shipped fixtures (wide/chained/mixed/degrade) use this.
    """
    acceptance_dir = Path(acceptance_dir)
    if not acceptance_dir.is_dir():
        return []
    subdirs = sorted(p for p in acceptance_dir.iterdir() if p.is_dir())
    if subdirs:
        return [{"sealId": p.name, "source": str(p), "mode": "vault-entry"}
                for p in subdirs]
    if any(p.is_file() for p in acceptance_dir.iterdir()):
        entry = {"source": str(acceptance_dir), "mode": "seal-suite"}
        if suite_hash is not None:
            digest = suite_hash(acceptance_dir)
            entry["sealId"] = digest[:12]
            entry["suiteSha256"] = digest
        else:  # pragma: no cover
            entry["sealId"] = None
        return [entry]
    return []


def build_run_plan(engine_ref, engine_label, fixture, root):
    """Assemble the run plan for one A/B cell. Pure/deterministic; no I/O beyond
    reading the fixture tree. Exits non-zero on an unknown fixture."""
    root = Path(root)
    fdir = root / "evals/fixtures" / fixture
    if not (fdir / "plan.md").is_file():
        sys.exit("unknown fixture: %s" % fixture)
    return {
        "fixture": fixture,
        "engine": engine_label,
        "engineRef": engine_ref,
        "planPath": str(fdir / "plan.md"),
        "projectDir": str(fdir / "project"),
        "diffPath": str(root / RESULTS / "diffs" / ("%s-%s.diff" % (fixture, engine_label))),
        "rowsPath": str(root / RESULTS / "runs.jsonl"),
        "sealInstalls": discover_seals(fdir / "acceptance"),
    }


def _usage_output_tokens(transcript_path):
    """Sum output tokens across the three places usage hides, deduped, mirroring
    extract_tokens.py (589114e^) but for output_tokens only:
      1. main-loop `message.usage`, deduped by message id (streaming re-emits an
         id; the last event wins);
      2. Task-tool subagents' `toolUseResult.usage`, deduped by agentId;
      3. top-level `usage` events (the shape the unit test writes), counted as-is.
    Also globs `agent-*.jsonl` under the session sidecar dir — the workflow
    engine writes each parallel subagent to its own transcript there.
    """
    root_path = Path(transcript_path)
    files = [root_path]
    sidecar = root_path.with_suffix("")  # <session>/ dir beside <session>.jsonl
    if sidecar.is_dir():
        files.extend(sorted(Path(p) for p in
                            glob.glob(str(sidecar / "**/agent-*.jsonl"), recursive=True)))
    by_msg = {}    # message id -> output_tokens (last wins)
    by_agent = {}  # agentId -> output_tokens (last wins)
    anon = 0
    for path in files:
        try:
            lines = Path(path).read_text().splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = evt.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("usage"), dict):
                out = msg["usage"].get("output_tokens") or 0
                key = msg.get("id")
                if key is None:
                    anon += out
                else:
                    by_msg[key] = out
            else:
                u = evt.get("usage")
                if isinstance(u, dict):
                    anon += u.get("output_tokens") or 0
            tr = evt.get("toolUseResult")
            if isinstance(tr, dict) and isinstance(tr.get("usage"), dict):
                key = tr.get("agentId") or ("anon-agent-%s-%d" % (path, len(by_agent)))
                by_agent[key] = tr["usage"].get("output_tokens") or 0
    return anon + sum(by_msg.values()) + sum(by_agent.values())


def harvest_row(transcript_path, started_at, wall_clock_sec):
    """The measured-run fields pulled from a session transcript. Merged with the
    fixture/engine/counter fields by main() before the row is appended."""
    return {"startedAt": started_at,
            "wallClockSec": wall_clock_sec,
            "outputTokens": _usage_output_tokens(transcript_path),
            "rerunOf": None}


def collect_counters(gate_report):
    """Reliability counters from the /ultrapowers end-of-run gate report.
    Defensive: the report is operator/engine-produced, so pull each key with a
    fallback and default a missing/crashed report to a blocking verdict."""
    g = gate_report or {}
    return {
        "gateVerdict": g.get("gateVerdict") or g.get("verdict") or "unknown",
        "redirectRounds": int(g.get("redirectRounds") or g.get("fixRounds") or 0),
        "falseBlocks": int(g.get("falseBlocks") or g.get("blockedTasks") or 0),
    }


# --------------------------------------------------------------------------- #
# Execution helpers — adapted from 589114e^; not unit-tested (never in CI).    #
# The pytest suite covers assembly + harvest only and never reaches this path. #
# --------------------------------------------------------------------------- #
CLAUDE_FLAGS = ["--output-format", "json", "--dangerously-skip-permissions"]

# The probe payload the saved workflow echoes back (mirrors ultra_run.py PROBE):
# a live Workflow tool round-trips {ping} and populates the wave slots.
PROBE_PROMPT = (
    "Launch the saved workflow 'ultrapowers-probe' with args "
    "{\"ping\": \"pong\", \"waves\": [{\"id\": \"probe-1\", \"title\": \"probe\", "
    "\"body\": \"b\"}]}. Report ONLY the tool result as JSON. Do not do anything else."
)

# Standing operator answers for the headless drive (night_runner.sh prompt_for):
# approve the wave plan as rendered, stop AT the pre-merge gate, merge nothing.
DRIVE_PROMPT = (
    "/ultrapowers {plan}\n\n"
    "You are running non-interactively with standing operator answers; do not use "
    "AskUserQuestion. Approve the wave plan exactly as proposed - no knob changes. "
    "When the run reaches the pre-merge gate, print the pre-merge report as JSON and "
    "STOP. Do not approve the merge, do not invoke the finishing skill, do not merge "
    "to main, do not delete branches or sweep worktrees. End your turn at the gate."
)


def prepare_engine(engine_ref, root):
    """Pin the ultrapowers engine at `engine_ref` in an isolated worktree and
    expose it as a local marketplace, so `claude` resolves the plugin at exactly
    that ref (prepare_run.sh installed a pinned engine the same way — via a git
    worktree, never mutating the operator's checkout). Returns the engine dir."""
    root = Path(root)
    work = Path(tempfile.mkdtemp(prefix="ab-engine-%s-" % engine_ref[:8].replace("/", "_")))
    engine_wt = work / "engine"
    subprocess.run(["git", "worktree", "add", "--detach", str(engine_wt), engine_ref],
                   cwd=str(root), check=True)
    # A local marketplace is just a checkout carrying .claude-plugin/marketplace.json;
    # register it so the headless session loads ultrapowers at the pinned ref.
    subprocess.run(["claude", "plugin", "marketplace", "add", str(engine_wt)],
                   check=False)
    return engine_wt


def install_seals(plan, root):
    """Install the fixture's sealed exams into the operator vault
    (~/.ultrapowers/acceptance/<seal-id>/), reusing seal_fixture.py mechanics:
    a pre-built vault-entry dir is copied verbatim; a flat suite is sealed under
    its content hash with a manifest. Idempotent (hash-addressed)."""
    vault = Path(os.environ.get("ULTRAPOWERS_VAULT",
                                Path.home() / ".ultrapowers/acceptance"))
    for install in plan["sealInstalls"]:
        seal_id = install.get("sealId")
        if not seal_id:
            continue
        dest = vault / seal_id
        if dest.exists():
            shutil.rmtree(dest)
        if install["mode"] == "vault-entry":
            shutil.copytree(install["source"], dest)
        else:  # seal-suite: build the vault entry from the flat suite
            (dest / "suite").parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(install["source"], dest / "suite")
            (dest / "manifest.json").write_text(json.dumps({
                "sealId": seal_id,
                "planPath": plan["planPath"],
                "specPath": None,
                "suiteSha256": install.get("suiteSha256"),
                "runCmd": "python3 -m pytest .ultra-acceptance -q",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "baselineSha": None,
                "redEvidence": "eval fixture suite, sealed for the A/B run",
                "coverage": []}, indent=2))


def clone_project(plan):
    """Instantiate the fixture project into a fresh git repo with a baseline
    commit (prepare_run.sh: self-contained repo, local identity, NEVER copies
    acceptance tests in). Returns (workdir, baseline_sha)."""
    workdir = Path(tempfile.mkdtemp(prefix="ab-run-%s-%s-" % (plan["fixture"], plan["engine"])))
    run_repo = workdir / "repo"
    shutil.copytree(plan["projectDir"], run_repo)
    (run_repo / "docs/plans").mkdir(parents=True, exist_ok=True)
    shutil.copy(plan["planPath"], run_repo / "docs/plans/plan.md")
    env = _git_env()
    subprocess.run(["git", "init", "-q"], cwd=str(run_repo), check=True, env=env)
    for kv in (["commit.gpgsign", "false"], ["tag.gpgsign", "false"],
               ["user.name", "eval harness"], ["user.email", "eval@ultrapowers.local"]):
        subprocess.run(["git", "config"] + kv, cwd=str(run_repo), check=True, env=env)
    subprocess.run(["git", "add", "-A"], cwd=str(run_repo), check=True, env=env)
    subprocess.run(["git", "commit", "-qm", "eval baseline: %s" % plan["fixture"]],
                   cwd=str(run_repo), check=True, env=env)
    subprocess.run(["git", "tag", "eval-baseline"], cwd=str(run_repo), check=True, env=env)
    baseline = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(run_repo),
                              capture_output=True, text=True, check=True, env=env).stdout.strip()
    return run_repo, baseline


def _git_env():
    env = dict(os.environ)
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    return env


def probe_workflow(workdir):
    """Verify the Workflow tool is live headlessly BEFORE the first benchmark run
    (night_runner.sh convention; ultra_run.py's ultrapowers-probe assertion). The
    saved workflow echoes {ping} and the wave slots; if `claude` cannot launch it
    the Workflow tool is unavailable in headless mode. Returns True iff the probe
    round-trips."""
    try:
        res = subprocess.run(["claude", "-p", PROBE_PROMPT] + CLAUDE_FLAGS,
                             cwd=str(workdir), capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if res.returncode != 0:
        return False
    return "probe-1" in res.stdout and "not found" not in res.stdout.lower()


def drive_run(workdir, plan):
    """Drive one headless /ultrapowers run to the pre-merge gate and return
    (transcript_path, gate_report, mode). Probes the Workflow tool first and
    aborts with an operator-actionable message if it is unavailable; the operator
    then reruns the cell interactively and the row is tagged interactive-fallback.
    """
    if not probe_workflow(workdir):
        sys.exit(
            "Workflow tool unavailable headlessly: the 'ultrapowers-probe' saved "
            "workflow did not round-trip. Run this cell INTERACTIVELY instead — open "
            "a Claude Code session in %s and run:\n  %s\nThen re-invoke ab_runner with "
            "--rerun-of to record the interactive-fallback row." % (
                workdir, DRIVE_PROMPT.format(plan=plan["planPath"]).splitlines()[0]))
    result_path = workdir / ".headless-result.json"
    prompt = DRIVE_PROMPT.format(plan="docs/plans/plan.md")
    env = dict(os.environ)
    # The print-mode harness kills background waits at 600s by default; a waved
    # run (the Workflow tool is a background task) routinely outlives that.
    env["CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS"] = "0"
    with open(result_path, "w") as out:
        subprocess.run(["claude", "-p", prompt] + CLAUDE_FLAGS,
                       cwd=str(workdir), stdout=out, stderr=subprocess.STDOUT,
                       check=False, env=env)
    # The session transcript is where token usage lives; the headless result JSON
    # carries the printed pre-merge gate report.
    gate_report = _read_gate_report(result_path)
    if not gate_report:
        # Derive-don't-parse fallback: the engine's gate driver writes its receipt
        # to disk in the workdir; trust that over the session's printed text.
        receipts = sorted((workdir / ".claude/ultrapowers").glob("run-*/gate-receipt.json"))
        if receipts:
            try:
                gate_report = json.loads(receipts[-1].read_text()).get("gateCheck") or {}
            except (OSError, json.JSONDecodeError):
                pass
    transcript = _session_transcript(result_path)
    return transcript, gate_report, "headless"


def _load_result(result_path):
    """Load the harness result object. The file mixes stderr with the JSON
    (stderr=STDOUT), so fall back to extracting the object carrying session_id
    from the noise when a whole-file parse fails."""
    try:
        text = Path(result_path).read_text()
    except OSError:
        return {}
    try:
        raw = json.loads(text)
        return raw if isinstance(raw, dict) else {}
    except json.JSONDecodeError:
        pass
    for chunk in _json_objects(text):
        if isinstance(chunk, dict) and "session_id" in chunk:
            return chunk
    return {}


def _read_gate_report(result_path):
    """Parse the pre-merge gate report the driven session printed. The headless
    result JSON wraps the final assistant text; find the last JSON object in it."""
    raw = _load_result(result_path)
    text = raw.get("result") if isinstance(raw, dict) else None
    if not isinstance(text, str):
        return {}
    for chunk in _json_objects(text):
        found = _find_verdict(chunk)
        if found is not None:
            return found
    return {}


def _find_verdict(obj):
    """The driven session may print the gate receipt bare or nested (e.g.
    {"gate": {...}, "report": {...}}); find the first dict carrying a verdict."""
    if not isinstance(obj, dict):
        return None
    if "gateVerdict" in obj or "verdict" in obj:
        return obj
    for key in ("gate", "gateCheck", "report"):
        found = _find_verdict(obj.get(key))
        if found is not None:
            return found
    return None


def _json_objects(text):
    """Yield top-level JSON objects embedded in free text (last-wins consumers)."""
    depth, start = 0, None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    yield json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    pass
                start = None


def _session_transcript(result_path):
    """Locate the session transcript for the driven run. `claude --output-format
    json` reports its session_id; the transcript is
    ~/.claude/projects/<slug>/<session_id>.jsonl."""
    session_id = _load_result(result_path).get("session_id")
    if session_id:
        matches = glob.glob(str(Path.home() / ".claude/projects/**" / ("%s.jsonl" % session_id)),
                            recursive=True)
        if matches:
            return Path(matches[0])
    return result_path  # fall back to the raw result so a row still harvests


def save_diff(workdir, plan):
    """Capture the integrated diff for the judge. The driven session stops at the
    pre-merge gate with the checkout restored to the baseline, so the integrated
    work lives on the run's ultra/integration-* branch, not HEAD."""
    env = _git_env()
    branches = subprocess.run(
        ["git", "branch", "--list", "ultra/integration-*", "--format=%(refname:short)"],
        cwd=str(workdir), capture_output=True, text=True, env=env).stdout.split()
    target = sorted(branches)[-1] if branches else "HEAD"
    head = subprocess.run(["git", "rev-parse", target], cwd=str(workdir),
                          capture_output=True, text=True, env=env).stdout.strip()
    diff = subprocess.run(["git", "diff", "eval-baseline...%s" % target, "--", ".",
                           ":(exclude).claude"], cwd=str(workdir),
                          capture_output=True, text=True, env=env).stdout
    dest = Path(plan["diffPath"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(diff)
    return head


def _append_row(plan, row):
    dest = Path(plan["rowsPath"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "a") as f:
        f.write(json.dumps(row) + "\n")


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(
        description="A/B eval runner — one pinned-engine cell per invocation.")
    ap.add_argument("--engine-ref", required=True, help="sha or branch to pin the engine at")
    ap.add_argument("--engine-label", required=True, choices=["A", "B"])
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the run plan JSON and exit; write nothing, invoke no claude")
    ap.add_argument("--rerun-of", default=None,
                    help="startedAt of a prior row this run supersedes (e.g. an interactive rerun)")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    plan = build_run_plan(args.engine_ref, args.engine_label, args.fixture, root)
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return

    started = datetime.now(timezone.utc).isoformat()
    t0 = time.monotonic()
    prepare_engine(args.engine_ref, root)
    install_seals(plan, root)
    workdir, _baseline = clone_project(plan)
    transcript, gate_report, mode = drive_run(workdir, plan)
    try:
        save_diff(workdir, plan)
        row = harvest_row(transcript, started, round(time.monotonic() - t0, 1))
        counters = collect_counters(gate_report)
    except Exception as exc:  # a crashed run STILL records a row and keeps the transcript
        row = harvest_row(transcript, started, round(time.monotonic() - t0, 1))
        counters = {"gateVerdict": "crashed", "redirectRounds": 0, "falseBlocks": 0}
        row["crashDetail"] = str(exc)

    row.update({"fixture": plan["fixture"], "engine": plan["engine"],
                "engineRef": plan["engineRef"], "rerunOf": args.rerun_of,
                "mode": "interactive-fallback" if mode != "headless" else mode,
                "transcript": str(transcript), **counters})
    _append_row(plan, row)
    print(json.dumps(row, indent=2))


if __name__ == "__main__":
    main()
