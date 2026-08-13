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


# The `frontier` section is per-contended-wave evidence (fold log, conflicts
# index, self-checks, fold-CLI wall time, resolver transcripts). It gets its own
# named pin because the two literal-token checks above carry no general
# section cross-check to inherit — same shape as the reviewVerdict pin below:
# derive the field names from what waves.js actually emits, then require each to
# be documented. KNOWN is the floor, so deleting an emitted field from the
# builder cannot silently un-document it.
FRONTIER_FIELDS = ("foldLogPath", "conflictsIndex", "selfChecks",
                   "foldCliWallTimeSec", "resolverTranscripts")

FRONTIER_ENTRY = re.compile(
    r"const frontierEntry = \([^)]*\) => \(\{(.*?)^\}\)", re.S | re.M)


def frontier_emitted_fields():
    wf = (ROOT / "skills/ultrapowers/harnesses/waves.js").read_text()
    m = FRONTIER_ENTRY.search(wf)
    assert m, ("no `const frontierEntry = (...) => ({ ... })` builder found in "
               "waves.js — the frontier report section must be assembled in one "
               "object literal so this pin can read its field names")
    fields = re.findall(r"^  (\w+):", m.group(1), re.M)
    assert fields, "frontierEntry builder emitted no fields"
    return fields


def test_report_format_documents_every_frontier_field():
    fields = frontier_emitted_fields()
    missing_floor = set(FRONTIER_FIELDS) - set(fields)
    assert not missing_floor, (
        "waves.js stopped emitting frontier field(s) " + repr(sorted(missing_floor)) +
        " — the frontier section is the A/B and canary evidence surface")
    doc = REPORT.read_text()
    for f in sorted(set(fields)):
        assert "`" + f + "`" in doc, (
            "report-format.md does not document frontier field '" + f + "' — "
            "waves.js emits it; update the field-reference table")


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
