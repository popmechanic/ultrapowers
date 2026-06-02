import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_canary_plan_has_three_tasks_with_known_files():
    p = (ROOT / "tests/fixtures/canary-plan.md").read_text()
    assert p.count("### Task") == 3
    # A creates a.txt, B creates b.txt, C modifies a.txt (=> edge A -> C)
    assert "Create: `a.txt`" in p
    assert "Create: `b.txt`" in p
    assert "Modify: `a.txt`" in p


def test_canary_workflow_shape():
    wf = (ROOT / "tests/fixtures/canary-workflow.js").read_text()
    assert wf.count("title: 'Wave") == 2            # two dependency waves
    assert "parallel(" in wf                          # per-wave barrier
    assert "isolation: 'worktree'" in wf              # task agents are worktree-isolated
    assert "args.waves" in wf and "integrationBranch" in wf
    assert "mergeWave(" in wf                          # wave-merge step present
