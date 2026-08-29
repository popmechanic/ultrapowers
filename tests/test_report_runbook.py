"""report-format.md and SKILL.md must not drift from what the real harness and
scripts emit at runtime — these tests cross-check against the shipped
scripts/JS, not just documentation prose."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_gate_owns_merge_sha_guard_and_report_format_documents_wavemerges():
    # The merge-sha guard lives in the gate script — gate_check.py emits the
    # literal and its exit code is the authority (never SKILL.md prose).
    assert "merge-sha guard unavailable" in (ROOT / "skills/ultrapowers/scripts/gate_check.py").read_text()
    fmt = REPORT.read_text()
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

# 0.3.0: the emitter is fleet/run-engine.mjs (foldWave's `entry` builder).
FRONTIER_ENTRY = re.compile(
    r"const entry = \(\) => \(\{(.*?)\}\)", re.S)


def frontier_emitted_fields():
    wf = (ROOT / "fleet/run-engine.mjs").read_text()
    m = FRONTIER_ENTRY.search(wf)
    assert m, ("no `const entry = () => ({ ... })` builder found in "
               "run-engine.mjs — the frontier report section must be assembled "
               "in one object literal so this pin can read its field names")
    fields = re.findall(r"^\s+(\w+)[,:]", m.group(1), re.M)
    assert fields, "frontier entry builder emitted no fields"
    return fields


def test_report_format_documents_every_frontier_field():
    fields = frontier_emitted_fields()
    missing_floor = set(FRONTIER_FIELDS) - set(fields)
    assert not missing_floor, (
        "run-engine.mjs stopped emitting frontier field(s) " + repr(sorted(missing_floor)) +
        " — the frontier section is the A/B and canary evidence surface")
    doc = REPORT.read_text()
    for f in sorted(set(fields)):
        assert "`" + f + "`" in doc, (
            "report-format.md does not document frontier field '" + f + "' — "
            "run-engine.mjs emits it; update the field-reference table")


def test_report_format_documents_every_review_verdict():
    wf = (ROOT / "fleet/run-engine.mjs").read_text()
    doc = REPORT.read_text()
    verdicts = set()
    for frag in re.findall(r"reviewVerdict\s*[:=]([^\n]+)", wf):
        verdicts.update(re.findall(r"'([a-z][a-z-]*)'", frag))
    assert verdicts, "no reviewVerdict literals found in run-engine.mjs"
    for v in sorted(verdicts):
        assert "`" + v + "`" in doc, (
            "report-format.md does not document reviewVerdict '" + v + "' — "
            "run-engine.mjs emits it; update the field-reference table")
