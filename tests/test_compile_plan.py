"""compile_plan.py turns a marked plan into the Step-3 transparency block,
deterministically. The marked fixture's documented expectations (waves
[[1,2],[3]], 4 -> gate config, 5 -> runbook) finally execute."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"


def compile_plan(path):
    p = subprocess.run([sys.executable, str(COMPILER), str(path)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_marked_fixture_compiles_to_documented_waves():
    out = compile_plan(ROOT / "tests/fixtures/marked-plan.md")
    assert out["waves"] == [["1", "2"], ["3"]]
    assert out["post_merge_runbook"] == ["5"]
    assert out["gates"] == ["4"]
    assert {"from": "1", "to": "3", "why": "marker"} in out["dag_edges"]
    assert out["marker_conflicts"] == []
    assert out["mode"] == "parallel"
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["2"]["disposition"] == "implementation"
    assert by_id["2"]["heuristic"] is True      # no Type: marker -> default, flagged
    assert by_id["1"]["heuristic"] is False     # explicit marker -> trusted


def test_unmarked_fixture_heuristics_and_conflict():
    out = compile_plan(ROOT / "tests/fixtures/unmarked-plan.md")
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["3"]["disposition"] == "release"   # git push step, no marker
    assert by_id["3"]["heuristic"] is True
    assert by_id["4"]["disposition"] == "gate"      # Files: none + pytest only
    # Task 5 says Depends-on: none but modifies a.txt created by Task 1:
    # the file edge wins and the disagreement is surfaced.
    assert {"from": "1", "to": "5", "why": "write-after-create"} in out["dag_edges"]
    assert any(c["task"] == "5" for c in out["marker_conflicts"])
    # The fenced "### Task 99:" inside Task 1's body is content, not a task.
    assert len(out["tasks"]) == 5
    # write-after-write: 2 and 5 both modify a.txt -> document order serializes
    assert {"from": "2", "to": "5", "why": "write-after-write"} in out["dag_edges"]


def test_cycle_is_a_loud_error(tmp_path):
    plan = tmp_path / "cyclic.md"
    plan.write_text(
        "# Plan: Cycle\n\n"
        "### Task A: first\n\n**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** write a\n\n"
        "### Task B: second\n\n**Type:** implementation\n**Depends-on:** A\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** write b\n"
    )
    p = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                       capture_output=True, text=True)
    assert p.returncode == 1
    assert "cycle" in p.stderr.lower()
    assert "A" in p.stderr and "B" in p.stderr


def test_small_plan_degrades_to_sequential(tmp_path):
    plan = tmp_path / "tiny.md"
    plan.write_text(
        "# Plan: Tiny\n\n"
        "### Task 1: only\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** write a\n"
    )
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert out["waves"] == [["1"]]
    assert out["degrade_reason"]


def compile_plan_raw(path):
    return subprocess.run([sys.executable, str(COMPILER), str(path)],
                          capture_output=True, text=True)


def test_degrade_honors_marker_edges(tmp_path):
    plan = tmp_path / "dep.md"
    plan.write_text(
        "# Plan: Degrade order\n\n"
        "### Task 1: dependent\n\n**Type:** implementation\n**Depends-on:** 2\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: prerequisite\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `two.txt`\n\n- [ ] **Step 1:** write two\n"
    )
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert {"from": "2", "to": "1", "why": "marker"} in out["dag_edges"]
    assert out["waves"] == [["2"], ["1"]]   # topological, not document, order


def test_test_paths_generate_read_after_write_edge(tmp_path):
    plan = tmp_path / "reads.md"
    plan.write_text(
        "# Plan: Reads\n\n"
        "### Task 1: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `data.json`\n\n- [ ] **Step 1:** write data\n\n"
        "### Task 2: reader\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `reader.py`\n- Test: `data.json`\n\n- [ ] **Step 1:** consume data\n\n"
        "### Task 3: bystander\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `other.txt`\n\n- [ ] **Step 1:** write other\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "read-after-write"} in out["dag_edges"]
    assert out["waves"] == [["1", "3"], ["2"]]


def test_missing_files_block_is_conservatively_serialized(tmp_path):
    plan = tmp_path / "ambig.md"
    plan.write_text(
        "# Plan: Ambiguous\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: mystery\n\n**Type:** implementation\n\n"
        "- [ ] **Step 1:** refactor something unspecified\n\n"
        "### Task 3: third\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `three.txt`\n\n- [ ] **Step 1:** write three\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "ambiguous-files"} in out["dag_edges"]
    assert {"from": "2", "to": "3", "why": "ambiguous-files"} in out["dag_edges"]
    assert out["waves"] == [["1"], ["2"], ["3"]]


def test_glob_paths_are_ambiguous(tmp_path):
    plan = tmp_path / "glob.md"
    plan.write_text(
        "# Plan: Glob\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: globby\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/*.ts`\n\n- [ ] **Step 1:** sweep the sources\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "ambiguous-files"} in out["dag_edges"]


def test_duplicate_task_ids_are_a_loud_error(tmp_path):
    plan = tmp_path / "dup.md"
    plan.write_text(
        "# Plan: Dup\n\n"
        "### Task 1: first\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 1: second\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "duplicate task id" in p.stderr
    assert "cycle" not in p.stderr.lower()


def test_unparseable_type_marker_surfaces_conflict(tmp_path):
    plan = tmp_path / "typo.md"
    plan.write_text(
        "# Plan: Typo\n\n"
        "### Task 1: misspelled\n\n**Type:** implmentation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: plain\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["disposition"] == "implementation"
    assert by_id["1"]["heuristic"] is True
    assert any(c["task"] == "1" and "not a recognized type" in c["note"]
               for c in out["marker_conflicts"])


def test_depends_on_outside_impl_set_surfaces_conflict(tmp_path):
    plan = tmp_path / "ghost.md"
    plan.write_text(
        "# Plan: Ghost\n\n"
        "### Task 1: real\n\n**Type:** implementation\n**Depends-on:** 9\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: also real\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["from"] == "9" for e in out["dag_edges"])
    assert any(c["task"] == "1" and "edge dropped" in c["note"] and "9" in c["note"]
               for c in out["marker_conflicts"])


def test_text_dependency_creates_edge(tmp_path):
    plan = tmp_path / "text.md"
    plan.write_text(
        "# Plan: Text\n\n"
        "### Task 1: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** Run after Task 1 lands.\n\n"
        "### Task 3: bystander\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `c.txt`\n\n- [ ] **Step 1:** c\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "text"} in out["dag_edges"]
    assert out["waves"] == [["1", "3"], ["2"]]
