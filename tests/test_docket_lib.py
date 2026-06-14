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
