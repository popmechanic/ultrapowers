"""report-format.md must present the post-merge runbook at the pre-merge gate
and route it into the finishing handoff on approval."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_report_presents_the_runbook():
    text = REPORT.read_text()
    assert "Post-merge runbook" in text
    assert "Step-2" in text   # sourced from compile-time dispositions, not the workflow return
    assert "finishing-a-development-branch" in text


def test_report_contract_includes_blocked_waves():
    text = REPORT.read_text()
    assert "blockedWaves" in text          # schema + field table
    assert "Blocked waves" in text         # presentation item
    assert "clean up worktrees" not in text  # finishing-a-development-branch never will


def test_report_approve_path_matches_skill_step5():
    text = REPORT.read_text()
    assert "tests.passed" in text          # the gate
    assert "git checkout <integrationBranch>" in text  # the checkout before sweep/handoff
    assert "SKIPPED" in text               # waveMerges vocabulary documents the skip status


def test_skill_wires_run_lock_and_scoped_sweep():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "run_lock.sh acquire" in skill and "run_lock.sh snapshot" in skill
    assert "run_lock.sh restore" in skill
    assert "sweep_worktrees.sh --run" in skill


def test_skill_has_skew_preflight_probe_roundtrip_and_schema_degrade():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "check_engine_skew.sh" in skill
    assert "round-trip" in skill or "roundtrip" in skill or "echoWaves" in skill
    # The merge-sha guard moved from SKILL.md prose into the gate script — Task 2
    # emits that literal from gate_check.py, whose exit code is the authority.
    assert "merge-sha guard unavailable" in (ROOT / "skills/ultrapowers/scripts/gate_check.py").read_text()
    fmt = (ROOT / "skills/ultrapowers/references/report-format.md").read_text()
    assert "waveMerges" in fmt and ("may be empty" in fmt or "missing" in fmt)


def test_report_format_documents_every_review_verdict():
    wf = (ROOT / "skills/ultrapowers/harnesses/waves.js").read_text()
    doc = REPORT.read_text()
    verdicts = set()
    for frag in re.findall(r"reviewVerdict\s*[:=]([^\n]+)", wf):
        verdicts.update(re.findall(r"'([a-z][a-z-]*)'", frag))
    assert verdicts, "no reviewVerdict literals found in workflow.js"
    for v in sorted(verdicts):
        assert "`" + v + "`" in doc, (
            "report-format.md does not document reviewVerdict '" + v + "' — "
            "workflow.js emits it; update the field-reference table")
