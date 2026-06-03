import pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "skills/ultrapowers/workflow.js"


def test_canary_plan_has_three_tasks_with_known_files():
    p = (ROOT / "tests/fixtures/canary-plan.md").read_text()
    assert p.count("### Task") == 3
    # A creates a.txt, B creates b.txt, C modifies a.txt (=> edge A -> C)
    assert "Create: `a.txt`" in p
    assert "Create: `b.txt`" in p
    assert "Modify: `a.txt`" in p


def test_workflow_parses_as_js():
    """The committed workflow.js must be syntactically valid.

    The workflow engine wraps the script body, so the file legitimately mixes
    `export`, top-level `await`, and a top-level `return` — a dialect that plain
    `node --check` cannot validate (it false-passes). We reproduce the engine's
    wrapping (strip the `export`, wrap in an async function) and check THAT.
    """
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    src = WORKFLOW.read_text()
    wrapped = "async function __wf(){\n" + src.replace("export const meta", "const meta", 1) + "\n}\n"
    p = subprocess.run([node, "--check", "--input-type=commonjs"],
                       input=wrapped, text=True, capture_output=True)
    assert p.returncode == 0, p.stderr


def test_workflow_uses_api_correctly():
    wf = WORKFLOW.read_text()
    assert "export const meta" in wf
    assert "args.waves" in wf
    assert "JSON.parse(" in wf                  # defensive parse: args may arrive as a string
    assert "throw new Error(" in wf            # fail-loud args validation
    assert "phase(" in wf
    assert "parallel(" in wf                    # per-wave barrier
    assert "isolation: 'worktree'" in wf        # task agents are worktree-isolated
    assert "mergeWave(" in wf                    # wave-merge step
    assert "integrationBranch" in wf
    assert "return {" in wf                      # structured report return


def test_workflow_has_baked_discipline_markers():
    wf = WORKFLOW.read_text()
    for const in ("GUARD", "IMPLEMENTER_PROMPT", "SPEC_REVIEWER_PROMPT",
                  "QUALITY_REVIEWER_PROMPT", "IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"):
        assert ("const " + const + " =") in wf, "missing baked constant: " + const
