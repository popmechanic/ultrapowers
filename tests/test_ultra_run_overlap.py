"""ultra_run.py: --overlap forwarding.

The compile-argv seam is a pure helper (no I/O, no subprocess) so it can be
tested without a real repo or a real compile_plan.py invocation. The other
two tests prove the validate_skill.py link-check regex extension is live and
that SKILL.md documents the new kernel link target."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
from ultra_run import compile_argv  # noqa: E402
import validate_skill  # noqa: E402


def test_ultra_run_builds_compile_argv_with_overlap(tmp_path):
    plan = tmp_path / "plan.md"
    run_dir = tmp_path / "run-t1"

    # No overlap passed -> the flag is absent entirely; the compiler's own
    # OVERLAP_DEFAULT governs, never re-stated here.
    argv_default = compile_argv(plan, run_dir, None)
    assert "--overlap" not in argv_default

    # An explicit mode is forwarded verbatim, on both arms.
    for mode in ("fold", "serialize"):
        argv = compile_argv(plan, run_dir, mode)
        assert "--overlap" in argv, mode
        assert argv[argv.index("--overlap") + 1] == mode, mode


def test_compile_argv_stamps_no_repo_root(tmp_path):
    # The filesystem eligibility pre-filter retired with the ordering-guess
    # tiers, and `--repo-root` with it: the compiler reads the plan and only
    # the plan. Stamping a flag the compiler no longer accepts would make
    # every launch fail at argument parsing.
    for overlap in (None, "fold", "serialize"):
        argv = compile_argv(tmp_path / "plan.md", tmp_path / "run-t1", overlap)
        assert "--repo-root" not in argv, overlap


def test_validate_skill_checks_kernel_links(tmp_path):
    def make_skill(has_target):
        d = tmp_path / ("present" if has_target else "absent")
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: t\ndescription: a description over twenty characters "
            "long\n---\n\nSee kernel/FOLD_LOG.md for the fold-log schema.\n"
        )
        if has_target:
            (d / "kernel").mkdir()
            (d / "kernel" / "FOLD_LOG.md").write_text("# schema\n")
        return d

    present = make_skill(True)
    absent = make_skill(False)

    errs_present = validate_skill.validate(present)
    assert not any("kernel/FOLD_LOG.md" in e for e in errs_present)

    errs_absent = validate_skill.validate(absent)
    assert any("kernel/FOLD_LOG.md" in e for e in errs_absent)


def test_skill_md_references_fold_log():
    text = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "kernel/FOLD_LOG.md" in text
