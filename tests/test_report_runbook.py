"""report-format.md and SKILL.md must not drift from what the real harness and
scripts emit at runtime — these tests cross-check against the shipped
scripts/JS, not just documentation prose."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_skill_has_skew_preflight_probe_roundtrip_and_schema_degrade():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    # The self-host skew check moved into the pre-launch driver's `engine skew`
    # stage; Step 1 still names it so the operator knows it ran.
    assert "engine skew" in skill.lower()
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
