import pathlib

FIX = pathlib.Path(__file__).resolve().parents[2] / "fixtures"


def _task4_depends_on(plan_path):
    block = plan_path.read_text().split("### Task 4:")[1].split("### Task 5:")[0]
    for line in block.splitlines():
        if line.startswith("**Depends-on:**"):
            return line.split("**Depends-on:**")[1].strip()
    raise AssertionError("no Depends-on marker in Task 4")


def test_mixed_task4_now_depends_on_task1():
    assert _task4_depends_on(FIX / "mixed" / "plan.md") == "1"


def test_flawed_preserves_the_buggy_task4():
    assert _task4_depends_on(FIX / "flawed" / "plan.md") == "none"


def test_flawed_reuses_the_mixed_acceptance_suite_verbatim():
    flawed = (FIX / "flawed" / "acceptance" / "test_acceptance_mixed.py").read_text()
    mixed = (FIX / "mixed" / "acceptance" / "test_acceptance_mixed.py").read_text()
    assert flawed == mixed


def test_flawed_carries_project_and_reference():
    assert (FIX / "flawed" / "project" / "apistub").is_dir()
    assert (FIX / "flawed" / "reference" / "apistub").is_dir()


def test_both_fixtures_are_versioned():
    assert (FIX / "mixed" / "version.txt").exists()
    assert (FIX / "flawed" / "version.txt").exists()
