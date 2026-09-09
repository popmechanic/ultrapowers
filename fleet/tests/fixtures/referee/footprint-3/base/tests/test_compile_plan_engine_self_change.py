from skills.ultrapowers.scripts.compile_plan import compile_plan


def test_one_task():
    assert len(compile_plan("### Task 1: a\n")["tasks"]) == 1
