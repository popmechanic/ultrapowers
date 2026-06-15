import pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "skills/ultrapowers/harnesses/waves.js"


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


def test_workflow_model_tiers_use_valid_aliases():
    # Verified live (2026-06-03): agent({model}) accepts haiku/sonnet/opus;
    # small/medium/large are rejected as invalid models. Lock the mapping so it
    # can't silently regress to the broken values.
    wf = WORKFLOW.read_text()
    assert "cheap: 'haiku'" in wf
    assert "standard: 'sonnet'" in wf
    assert "mostCapable: 'opus'" in wf


def test_workflow_has_baked_discipline_markers():
    wf = WORKFLOW.read_text()
    for const in ("GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT",
                  "IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"):
        assert ("const " + const + " =") in wf, "missing baked constant: " + const


def test_workflow_consumes_structured_edges():
    wf = WORKFLOW.read_text()
    assert "ARGS.edges" in wf
    assert "blockedByDep" in wf


def test_workflow_requires_headsha_and_commit_discipline():
    wf = WORKFLOW.read_text()
    assert "required: ['status', 'summary', 'branch', 'headSha']" in wf
    assert "Commit your work" in wf
    assert "fix-loop cap" in wf          # exhaustion is logged, not silent
    # The stale comment wrapped "v5.0.6" and "direction" across two source
    # lines, so a "v5.0.6 direction" substring check never bit. Guard the fix
    # both ways: the stale attribution is gone AND the honest one is present.
    assert "v5.0.6" not in wf            # stale upstream attribution removed
    assert "two-ordered-pass" in wf      # deliberate-divergence comment present


def test_workflow_supports_file_backed_bodies_and_polyglot_knobs():
    """Large-plan body delivery (args.wavesPath) and polyglot/fresh-worktree
    knobs (bootstrapCmd, per-task testCmd) must stay wired — they are the
    first-class fixes for inline-88KB delivery and per-worktree bootstrap."""
    wf = WORKFLOW.read_text()
    # file-backed bodies: a task may omit its inline body when wavesPath supplies it
    assert "ARGS.wavesPath" in wf
    assert "read your verbatim task text from the JSON file at" in wf
    # per-worktree bootstrap for the fresh, isolated roles
    assert "ARGS.bootstrapCmd" in wf
    assert "WORKTREE SETUP:" in wf
    # per-task test command override
    assert "task.testCmd" in wf


def test_default_test_detection_ladder_matches_wave_merge_doc():
    ladder = "pnpm check, npm test, pytest, cargo test, or go test ./..."
    wf = WORKFLOW.read_text()
    doc = (ROOT / "skills/ultrapowers/references/wave-merge.md").read_text()
    assert ladder in wf, "workflow.js reworded the detection ladder — update wave-merge.md and this pin"
    assert ladder in doc, "wave-merge.md reworded the detection ladder — update workflow.js and this pin"
