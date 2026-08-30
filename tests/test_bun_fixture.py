"""Pin: the Bun A/B fixture is additive, compiles, and — the webapp lesson —
is GREEN AT BASE so knob validation can pass. Existing fixtures are untouched
baselines; this one joins them as a new cell (#425, #402)."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FX = ROOT / "evals/fixtures/bun-greenfield"
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
TEST_CMD = "bunx tsc --noEmit && bun test"


def test_fixture_has_the_standard_layout():
    assert (FX / "plan.md").is_file()
    assert (FX / "project" / "package.json").is_file()


def test_project_is_green_at_base_by_construction():
    """A greenfield tree with no tests cannot pass knob validation (webapp).
    This fixture seeds a passing test and a typecheckable module."""
    tests = list((FX / "project" / "tests").glob("*.test.ts"))
    assert tests, "the seeded skeleton must ship at least one passing test"
    srcs = list((FX / "project" / "src").glob("*.ts"))
    assert srcs, "the seeded skeleton must ship at least one module to typecheck"


def test_tsconfig_uses_the_working_types_package():
    cfg = (FX / "project" / "tsconfig.json").read_text()
    assert '"bun"' in cfg          # `bun-types` fails TS2688
    pkg = json.loads((FX / "project" / "package.json").read_text())
    assert "@types/bun" in pkg.get("devDependencies", {})


def test_plan_compiles_and_states_the_canonical_gate():
    result = subprocess.run([sys.executable, str(COMPILER), "--check",
                             str(FX / "plan.md")], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert TEST_CMD in (FX / "plan.md").read_text()


def test_plan_has_contention_for_the_ab_arms():
    """The A/B dimension needs same-file concurrent writers; without them both
    arms compile to the same shape and the cell measures only latency."""
    text = (FX / "plan.md").read_text()
    assert text.count("src/registry.ts") >= 2


def test_existing_fixtures_are_untouched():
    for name in ("wide", "chained", "contend", "contend-big", "contend-prod", "mixed"):
        assert (ROOT / "evals/fixtures" / name / "plan.md").is_file()


# --- The two run-29 review findings, pinned so neither can regress ---------

sys.path.insert(0, str(ROOT / "evals"))
BOOTSTRAP_CMD = "bun install"


def test_project_ships_a_gitignore_for_the_bootstrap_artifacts():
    """`bun install` writes `node_modules/` and `bun.lock` at the cell root.
    validate_knobs rehearses the bootstrap in a probe worktree and then asserts
    `git status --porcelain` is empty (treeClean); untracked install output
    sets bootstrap_red -> ok:false -> exit 1 -> failed preflight. The sibling
    JS fixture ships exactly this guard (evals/fixtures/jsdeps/project/
    .gitignore)."""
    ignore = FX / "project" / ".gitignore"
    assert ignore.is_file(), "no .gitignore: `bun install` can never be treeClean"
    lines = {l.strip() for l in ignore.read_text().splitlines()}
    assert "node_modules/" in lines
    assert "bun.lock" in lines


def test_an_assembled_cell_stays_clean_after_a_simulated_bun_install(tmp_path):
    """The treeClean check itself, reproduced without Bun present: assemble the
    real fixture into a cell, create what `bun install` creates, and confirm
    `git status --porcelain` is still empty — which is what validate_knobs
    asserts before it will let the run proceed."""
    from ab_lib import build_cell

    cell = build_cell("bun-greenfield", ROOT, tmp_path)
    (cell / "node_modules" / "typescript").mkdir(parents=True)
    (cell / "node_modules" / "typescript" / "index.js").write_text("//\n")
    (cell / "bun.lock").write_text("{}\n")
    dirt = subprocess.run(["git", "status", "--porcelain"], cwd=cell,
                          capture_output=True, text=True).stdout
    assert dirt == "", "bootstrap output would set bootstrap_red:\n" + dirt


def _stub_run(record):
    """Every subprocess in one stub: the Keychain probe answers with a token,
    the engine spawn fabricates the run dir harvest_row reads."""
    class R:
        def __init__(self, code, out=""):
            self.returncode, self.stdout, self.stderr = code, out, ""

    def run(cmd, **kw):
        record.append(cmd)
        if cmd[0] == "security":
            return R(0, json.dumps({"claudeAiOauth": {"accessToken": "tok-x"}}))
        if cmd[0] == "node":
            cell = pathlib.Path(cmd[cmd.index("--repo") + 1])
            rd = cell / ".claude" / "ultrapowers" / ("run-" + cmd[3])
            rd.mkdir(parents=True)
            (rd / "events.jsonl").write_text(json.dumps(
                {"ts": "2026-08-30T10:00:00.000Z", "kind": "driver:stage",
                 "stage": "preflight"}) + "\n")
            (rd / "args.json").write_text(json.dumps({"waves": [[{"id": "1"}]]}))
            return R(0)
        return R(0)   # build_cell's git plumbing runs for real
    return run


def test_the_produces_command_line_runs_and_threads_both_knobs(tmp_path):
    """The task's Produces contract, verbatim. `--bootstrap-cmd` was missing
    from ab_runner's parser, so _Parser.error turned it into a _Refusal and the
    documented invocation exited 2 without spawning anything. Dropping the flag
    instead is not a workaround: with no bootstrap the probe has no
    node_modules, `@types/bun` is absent, `"types": ["bun"]` fails TS2688 and
    the baseline goes red (exit 3). Both knobs must reach run-main.mjs, which
    has accepted --bootstrap-cmd all along."""
    from ab_runner import main as ab_main

    record = []
    rc = ab_main(["bun-greenfield", "--overlap", "fold", "--run-id", "ab-bun1",
                  "--test-cmd", TEST_CMD, "--bootstrap-cmd", BOOTSTRAP_CMD,
                  "--results-dir", str(tmp_path / "results"),
                  "--workspace", str(tmp_path / "ws")],
                 run=_stub_run(record))
    assert rc == 0, "the documented invocation must not refuse"
    node_cmd = next(c for c in record if c[0] == "node")
    assert node_cmd[node_cmd.index("--test-cmd") + 1] == TEST_CMD
    assert node_cmd[node_cmd.index("--bootstrap-cmd") + 1] == BOOTSTRAP_CMD


def test_bootstrap_cmd_is_omitted_when_not_asked_for(tmp_path):
    """Additive only: fixtures that need no install keep the old command."""
    from ab_runner import main as ab_main

    record = []
    assert ab_main(["bun-greenfield", "--overlap", "serialize",
                    "--run-id", "ab-bun2", "--test-cmd", TEST_CMD,
                    "--results-dir", str(tmp_path / "results"),
                    "--workspace", str(tmp_path / "ws")],
                   run=_stub_run(record)) == 0
    node_cmd = next(c for c in record if c[0] == "node")
    assert "--bootstrap-cmd" not in node_cmd
