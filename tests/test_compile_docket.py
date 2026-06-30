"""Portfolio compiler: collision graph + execution order + parallelism
projection over queued docket entries, with an injectable facts_resolver so
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
    r = m.compile_docket(DOCKET, facts_resolver=lambda p: (WRITES[p], "sealed"))
    pairs = {tuple(sorted(c["plans"])) for c in r["collisions"]}
    assert ("pa.md", "pb.md") in pairs
    assert ("pa.md", "pc.md") not in pairs


def test_order_sequences_collisions_by_score():
    m = load()
    r = m.compile_docket(DOCKET, facts_resolver=lambda p: (WRITES[p], "sealed"))
    ia, ib = r["order"].index("pa.md"), r["order"].index("pb.md")
    assert ia < ib


def test_parallelism_projection_groups_disjoint_plans():
    m = load()
    r = m.compile_docket(DOCKET, facts_resolver=lambda p: (WRITES[p], "sealed"))
    proj = r["could_have_parallelized"]
    assert proj["max_concurrent"] >= 2
    assert proj["critical_path_len"] == 2  # A->B chain is the longest


def test_only_queued_entries_considered():
    m = load()
    docket = DOCKET.replace("**State:** queued\n**Score:** 7.0", "**State:** accepted\n**Score:** 7.0")
    r = m.compile_docket(docket, facts_resolver=lambda p: (WRITES[p], "sealed"))
    assert "pc.md" not in r["order"]


def test_queued_entry_without_plan_fails_loud():
    m = load()
    docket = ("# Docket\n\n### #1: no plan\n**State:** queued\n"
              "**Score:** 9.0 — x\n**Est-files:** a.py\n")
    import pytest
    with pytest.raises(Exception):
        m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "sealed"))


def test_duplicate_plan_paths_fail_loud():
    m = load()
    docket = ("# Docket\n\n"
              "### #1: a\n**State:** queued\n**Score:** 9 — x\n**Est-files:** a.py\n"
              "**Plan:** p.md\n**Seal:** aaa\n\n"
              "### #2: b\n**State:** queued\n**Score:** 5 — x\n**Est-files:** b.py\n"
              "**Plan:** p.md\n**Seal:** bbb\n")
    import pytest
    with pytest.raises(Exception):
        m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "sealed"))


def test_budget_passes_through():
    m = load()
    docket = ("# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** p.md\n**Seal:** aaa\n")
    r = m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "sealed"), budget_usd=42.0)
    assert r["budget_usd"] == 42.0


def test_sealed_entry_without_seal_fails_loud():
    """A sealed-disposition queued entry with no Seal still fails loud."""
    m = load()
    docket = ("# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** p.md\n")  # Plan present, Seal absent
    import pytest
    with pytest.raises(Exception):
        m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "sealed"))


def test_suite_entry_without_seal_compiles():
    """A suite-disposition queued entry needs no Seal — it compiles."""
    m = load()
    docket = ("# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** p.md\n")  # no Seal — legal for suite
    r = m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "suite"))
    assert r["order"] == ["p.md"]


def test_mixed_sealed_and_suite_queue_compiles():
    """A queue mixing a sealed (sealed entry) and a suite (seal-less) plan
    compiles; order is score-descending."""
    m = load()
    docket = ("# Docket\n\n"
              "### #1: sealed\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** pa.md\n**Seal:** aaa111aaa111\n\n"
              "### #2: suite\n**State:** queued\n**Score:** 5 — x\n"
              "**Est-files:** b.py\n**Plan:** pb.md\n")  # suite, no Seal
    modes = {"pa.md": "sealed", "pb.md": "suite"}
    writes = {"pa.md": {"a.py"}, "pb.md": {"b.py"}}
    r = m.compile_docket(docket, facts_resolver=lambda p: (writes[p], modes[p]))
    assert r["order"] == ["pa.md", "pb.md"]
    assert r["collisions"] == []


def test_real_plan_writes_unions_task_writes(tmp_path):
    """Exercise the real plan_writes() path: compile an actual marked plan via
    compile_plan.py and confirm its write-set is the union of task writes."""
    m = load()
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Tiny Plan\n\n"
        "**Acceptance:** suite — fixture\n\n"
        "### Task 1: one\n**Type:** implementation\n**Depends-on:** none\n"
        "**Files:**\n- Create: `x/a.py`\n- [ ] **Step 1: do**\n\n"
        "### Task 2: two\n**Type:** implementation\n**Depends-on:** none\n"
        "**Files:**\n- Create: `x/b.py`\n- [ ] **Step 1: do**\n")
    writes = m.plan_writes(plan)
    assert {"x/a.py", "x/b.py"} <= set(writes)


def test_uncompilable_plan_raises_friendly_error(tmp_path):
    """A queued entry whose Plan is missing/uncompilable must raise a friendly
    error naming the plan, not a raw CalledProcessError stack trace (#34)."""
    m = load()
    import subprocess, pytest
    missing = tmp_path / "does-not-exist.md"
    with pytest.raises(ValueError) as ei:
        m.plan_writes(missing)
    assert str(missing) in str(ei.value)
    assert not isinstance(ei.value, subprocess.CalledProcessError)


def _fixture_plan(p, *creates):
    body = "# P\n\n**Acceptance:** suite — fixture\n\n"
    for i, c in enumerate(creates, 1):
        body += (f"### Task {i}: t{i}\n**Type:** implementation\n**Depends-on:** none\n"
                 f"**Files:**\n- Create: `{c}`\n- [ ] **Step 1: do**\n\n")
    p.write_text(body)


def test_compile_docket_real_resolver_over_real_plans(tmp_path):
    """Drive compile_docket() with the DEFAULT resolver (no injection) over real
    fixture plans on disk — the real plan_writes path inside compile_docket (#34)."""
    m = load()
    pa, pb = tmp_path / "pa.md", tmp_path / "pb.md"
    _fixture_plan(pa, "x/a.py")
    _fixture_plan(pb, "x/b.py")
    docket = (f"# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              f"**Est-files:** x/a.py\n**Plan:** {pa}\n**Seal:** aaa\n\n"
              f"### #2: b\n**State:** queued\n**Score:** 5 — x\n"
              f"**Est-files:** x/b.py\n**Plan:** {pb}\n**Seal:** bbb\n")
    r = m.compile_docket(docket)  # default resolver → real plan_writes()
    assert r["order"] == [str(pa), str(pb)]
    assert r["collisions"] == []  # disjoint writes


def test_cli_main_prints_json(tmp_path, capsys):
    """compile_docket.main(): argparse + file read + JSON print + --budget-usd (#34)."""
    m = load()
    pa = tmp_path / "pa.md"
    _fixture_plan(pa, "x/a.py")
    docket = tmp_path / "docket.md"
    docket.write_text(f"# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
                      f"**Est-files:** x/a.py\n**Plan:** {pa}\n**Seal:** aaa\n")
    import sys, json
    saved = sys.argv
    sys.argv = ["compile_docket.py", str(docket), "--budget-usd", "12.5"]
    try:
        m.main()
    finally:
        sys.argv = saved
    out = json.loads(capsys.readouterr().out)
    assert out["budget_usd"] == 12.5
    assert out["order"] == [str(pa)]
