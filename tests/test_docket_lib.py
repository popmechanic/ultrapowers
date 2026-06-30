"""docket.md is parsed, serialized, and lifecycle-transitioned by exactly one
module. Round-trip must be lossless; illegal transitions must raise; a
malformed entry must fail loud (never silently drop work)."""
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIB = ROOT / "skills/ultradocket/scripts/docket_lib.py"


def load():
    spec = importlib.util.spec_from_file_location("docket_lib", LIB)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SAMPLE = """# Docket

### #214: Stripe webhooks dropped on retry
**State:** accepted
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py

### #230: Slow dashboard query
**State:** queued
**Score:** 6.0 — performance objective
**Est-files:** lib/dashboard.py
**Plan:** docs/superpowers/plans/2026-06-14-dashboard.md
**Seal:** abc123def456
"""


def test_parse_reads_all_fields():
    m = load()
    entries = m.parse_docket(SAMPLE)
    assert [e.issue for e in entries] == ["214", "230"]
    e = entries[0]
    assert e.title.startswith("Stripe webhooks")
    assert e.state == "accepted"
    assert e.est_files == ["services/billing/*", "lib/webhooks.py"]
    assert e.plan is None and e.seal is None
    assert entries[1].plan.endswith("dashboard.md") and entries[1].seal == "abc123def456"


def test_round_trip_is_lossless():
    m = load()
    entries = m.parse_docket(SAMPLE)
    again = m.parse_docket(m.serialize_docket(entries))
    assert [vars(e) for e in again] == [vars(e) for e in entries]


def test_legal_transition():
    m = load()
    e = m.parse_docket(SAMPLE)[0]  # accepted
    e2 = m.transition(e, "planned")
    assert e2.state == "planned"


def test_illegal_transition_raises():
    m = load()
    e = m.parse_docket(SAMPLE)[0]  # accepted
    with pytest.raises(m.DocketError):
        m.transition(e, "verified")  # cannot skip planned/queued/executed


def test_park_allowed_from_any_active_state():
    m = load()
    e = m.parse_docket(SAMPLE)[1]  # queued
    assert m.transition(e, "parked").state == "parked"


def test_malformed_entry_fails_loud():
    m = load()
    bad = "### #99: no state line\n**Score:** 1.0 — x\n"
    with pytest.raises(m.DocketError):
        m.parse_docket(bad)


def test_duplicate_issue_numbers_fail_loud():
    m = load()
    dup = ("# Docket\n\n"
           "### #5: a\n**State:** triaged\n**Score:** 1 — x\n\n"
           "### #5: b\n**State:** triaged\n**Score:** 1 — x\n")
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket(dup)


def test_cannot_park_from_terminal_state():
    m = load()
    e = m.parse_docket("# D\n\n### #1: x\n**State:** verified\n**Score:** 1 — x\n")[0]
    import pytest
    with pytest.raises(m.DocketError):
        m.transition(e, "parked")


def test_transition_from_unknown_state_raises():
    m = load()
    import dataclasses, pytest
    e = m.parse_docket("# D\n\n### #1: x\n**State:** accepted\n**Score:** 1 — x\n")[0]
    bogus = dataclasses.replace(e, state="nonsense")
    with pytest.raises(m.DocketError):
        m.transition(bogus, "planned")


def test_header_without_space_after_colon_fails_loud():
    m = load()
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket("# D\n\n### #7:title\n**State:** triaged\n**Score:** 1 — x\n")


def test_stray_non_issue_heading_fails_loud():
    m = load()
    import pytest
    bad = ("# D\n\n### #1: ok\n**State:** triaged\n**Score:** 1 — x\n"
           "### bad header\n**State:** queued\n**Score:** 9 — y\n")
    with pytest.raises(m.DocketError):
        m.parse_docket(bad)


def test_empty_title_fails_loud():
    m = load()
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket("# D\n\n### #7: \n**State:** triaged\n**Score:** 1 — x\n")


def test_non_numeric_score_fails_loud():
    m = load()
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket("# D\n\n### #7: ok\n**State:** triaged\n**Score:** soon — x\n")


def test_out_of_lifecycle_state_fails_loud():
    m = load()
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket("# D\n\n### #1: x\n**State:** frobnicated\n**Score:** 1 — x\n")


def test_every_real_state_parses():
    m = load()
    for s in ["triaged", "accepted", "planned", "queued", "executed", "verified", "parked"]:
        body = f"# D\n\n### #1: x\n**State:** {s}\n**Score:** 1 — x\n"
        assert m.parse_docket(body)[0].state == s


def test_parse_and_round_trip_engine():
    m = load()
    text = ("# Docket\n\n### #214: x\n**State:** queued\n**Score:** 8.5 — y\n"
            "**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc123\n"
            "**Engine:** ultrapowers\n")
    e = m.parse_docket(text)[0]
    assert e.engine == "ultrapowers"
    again = m.parse_docket(m.serialize_docket([e]))[0]
    assert again.engine == "ultrapowers"


def test_engine_optional_defaults_none():
    m = load()
    e = m.parse_docket("# D\n\n### #1: x\n**State:** accepted\n**Score:** 1 — x\n")[0]
    assert e.engine is None


def test_unknown_engine_fails_loud():
    m = load()
    bad = ("# D\n\n### #1: x\n**State:** queued\n**Score:** 1 — x\n"
           "**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc\n**Engine:** turbo\n")
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket(bad)


def test_all_valid_engines_parse():
    m = load()
    for eng in ("ultrapowers", "subagent-driven", "inline"):
        text = (f"# D\n\n### #1: x\n**State:** queued\n**Score:** 1 — x\n"
                f"**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc\n**Engine:** {eng}\n")
        assert m.parse_docket(text)[0].engine == eng
