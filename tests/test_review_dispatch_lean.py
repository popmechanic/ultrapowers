import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_only_writing_roles_get_a_worktree():
    src = WAVES.read_text()
    # The implementer and the fix re-dispatch are writing roles that commit on
    # their own branch and need isolation; the read-only reviewer does NOT — it
    # reads the pre-baked packet from the shared common git dir (A2). So exactly
    # two isolation:'worktree' dispatches remain.
    assert src.count("isolation: 'worktree'") == 2


def test_reviewer_prompt_has_no_bootstrap_or_testcmd():
    src = WAVES.read_text()
    start = src.index("const reviewPrompt =")
    end = src.index("const reviewOpts", start)
    review_assembly = src[start:end]
    # The reviewer never builds or tests, so it must not be handed the dependency
    # bootstrap line or a test command (A1).
    assert "bootstrapLine" not in review_assembly
    assert "testCmdLine" not in review_assembly
