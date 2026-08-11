# tests/test_ab_runner.py
"""ab_runner: run-plan assembly and harvest logic. Never invokes claude."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import ab_runner


def test_build_run_plan_shape():
    plan = ab_runner.build_run_plan("8a030f4", "A", "wide", ROOT)
    assert plan["fixture"] == "wide"
    assert plan["engine"] == "A"
    assert plan["engineRef"] == "8a030f4"
    assert plan["planPath"].endswith("plan.md")
    assert plan["diffPath"].endswith("evals/results/diffs/wide-A.diff")
    # The wide fixture ships sealed exams — the plan must include vault installs.
    assert plan["sealInstalls"], "wide fixture acceptance/ dirs must be installed"


def test_build_run_plan_unknown_fixture():
    try:
        ab_runner.build_run_plan("8a030f4", "A", "nope", ROOT)
        assert False, "should raise"
    except SystemExit:
        pass


def test_harvest_row(tmp_path):
    t = tmp_path / "transcript.jsonl"
    t.write_text(
        json.dumps({"type": "assistant", "usage": {"output_tokens": 120}}) + "\n" +
        json.dumps({"type": "assistant", "usage": {"output_tokens": 30}}) + "\n")
    row = ab_runner.harvest_row(t, "2026-07-10T00:00:00Z", 61.5)
    assert row["outputTokens"] == 150
    assert row["wallClockSec"] == 61.5
    assert row["rerunOf"] is None


def test_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv",
        ["ab_runner.py", "--engine-ref", "8a030f4", "--engine-label", "A",
         "--fixture", "wide", "--dry-run"])
    ab_runner.main()
    out = capsys.readouterr().out
    plan = json.loads(out)          # dry-run prints the run plan JSON and exits
    assert plan["fixture"] == "wide" and plan["engineRef"] == "8a030f4"
    assert "startedAt" not in plan  # a plan, not an executed-run row


# --------------------------------------------------------------------------- #
# #96 — deterministic (no-claude) suite-bootstrap cell                        #
# --------------------------------------------------------------------------- #
def _stub_engine(tmp_path, script_body):
    """A fake pinned-engine dir whose run_acceptance.sh is `script_body`."""
    eng = tmp_path / "engine"
    scripts = eng / "skills/ultrapowers/scripts"
    scripts.mkdir(parents=True)
    ra = scripts / "run_acceptance.sh"
    ra.write_text(script_body)
    ra.chmod(0o755)
    return eng


GREEN_JSON = ('#!/bin/bash\n'
              'echo \'{"sealId": "(suite)", "status": "OK", "passed": true, '
              '"exitCode": 0, "output": "ok"}\'\n')
REJECT_BOOTSTRAP = ('#!/bin/bash\n'
                    'for a in "$@"; do if [ "$a" = "--bootstrap" ]; then '
                    'echo "unknown argument: --bootstrap" >&2; exit 2; fi; done\n'
                    'echo \'{"sealId": "(suite)", "status": "OK", "passed": false, '
                    '"exitCode": 1, "output": "module not found", "redKind": "assertion"}\'\n')


def _cell_root(tmp_path):
    """A miniature repo root: just enough fixture + results tree for the cell."""
    root = tmp_path / "root"
    proj = root / "evals/fixtures/jsdeps/project"
    proj.mkdir(parents=True)
    (proj / "package.json").write_text('{"name": "x", "scripts": {"test": "node --test"}}')
    (root / "evals/results").mkdir(parents=True)
    return root


def test_bootstrap_cell_green_engine_counts_zero(tmp_path, monkeypatch):
    root = _cell_root(tmp_path)
    eng = _stub_engine(tmp_path, GREEN_JSON)
    monkeypatch.setattr(ab_runner, "prepare_engine", lambda ref, r: eng)
    row = ab_runner.run_bootstrap_cell("stub-ref", root)
    assert row["cell"] == "suite-bootstrap"
    assert row["falseBlock"] == 0
    rows = [json.loads(line) for line in
            (root / "evals/results/runs.jsonl").read_text().splitlines()]
    assert rows[-1]["engineRef"] == "stub-ref"


def test_bootstrap_cell_probes_then_falls_back_without_bootstrap(tmp_path, monkeypatch):
    # REJECT_BOOTSTRAP: the first invocation exits 2 with "unknown argument:
    # --bootstrap" on stderr; the cell must retry WITHOUT the flag (that is how
    # the baseline engine's own gate would run), parse the red JSON, and count
    # the block.
    root = _cell_root(tmp_path)
    eng = _stub_engine(tmp_path, REJECT_BOOTSTRAP)
    monkeypatch.setattr(ab_runner, "prepare_engine", lambda ref, r: eng)
    row = ab_runner.run_bootstrap_cell("old-ref", root)
    assert row["falseBlock"] == 1
    assert row["status"] == "OK"


def test_seed_workflows_refuses_problem_manifests_before_copying(tmp_path):
    # Fail-closed (spec 2026-08-10): today a bad manifest is silently
    # skipped and the cell proceeds on a partial seed — after this change
    # one bad manifest refuses the whole cell, and nothing is copied.
    engine = tmp_path / "engine"
    h = engine / "skills/ultrapowers/harnesses"
    h.mkdir(parents=True)
    (h / "good.harness.json").write_text(json.dumps({"file": "good.js"}))
    (h / "good.js").write_text("// harness\n")
    (h / "bad.harness.json").write_text("{not json")
    workdir = tmp_path / "run"
    workdir.mkdir()
    try:
        ab_runner.seed_workflows(engine, workdir)
        assert False, "should refuse a problems-bearing manifest set"
    except SystemExit as e:
        assert "bad.harness.json" in str(e)
    assert not (workdir / ".claude/workflows/good.js").exists()  # fail BEFORE copy
