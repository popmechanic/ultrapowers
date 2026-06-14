"""Portfolio compiler: collision graph + execution order + parallelism
projection over queued docket entries, with an injectable writes_resolver so
tests need no real plans on disk."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOD = ROOT / "skills/ultradocket/scripts/compile_docket.py"


def load():
    spec = importlib.util.spec_from_file_location("compile_docket", MOD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


WRITES = {
    "pa.md": {"lib/billing.py", "lib/webhooks.py"},
    "pb.md": {"lib/billing.py"},          # collides with A on lib/billing.py
    "pc.md": {"lib/dashboard.py"},        # disjoint
}
DOCKET = """# Docket

### #1: A
**State:** queued
**Score:** 9.0 — x
**Est-files:** lib/billing.py
**Plan:** pa.md
**Seal:** aaa111aaa111

### #2: B
**State:** queued
**Score:** 5.0 — x
**Est-files:** lib/billing.py
**Plan:** pb.md
**Seal:** bbb222bbb222

### #3: C
**State:** queued
**Score:** 7.0 — x
**Est-files:** lib/dashboard.py
**Plan:** pc.md
**Seal:** ccc333ccc333
"""


def test_collisions_detected():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    pairs = {tuple(sorted(c["plans"])) for c in r["collisions"]}
    assert ("pa.md", "pb.md") in pairs
    assert ("pa.md", "pc.md") not in pairs


def test_order_sequences_collisions_by_score():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    ia, ib = r["order"].index("pa.md"), r["order"].index("pb.md")
    assert ia < ib


def test_parallelism_projection_groups_disjoint_plans():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    proj = r["could_have_parallelized"]
    assert proj["max_concurrent"] >= 2
    assert proj["critical_path_len"] == 2  # A->B chain is the longest


def test_only_queued_entries_considered():
    m = load()
    docket = DOCKET.replace("**State:** queued\n**Score:** 7.0", "**State:** accepted\n**Score:** 7.0")
    r = m.compile_docket(docket, writes_resolver=lambda p: WRITES[p])
    assert "pc.md" not in r["order"]
