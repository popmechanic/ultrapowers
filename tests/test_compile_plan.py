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


def test_backward_write_after_create_compiles_without_cycle(tmp_path):
    plan = tmp_path / "wac-back.md"
    plan.write_text(
        "# Plan: WAC backward\n\n"
        "### Task A: modifier first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `f.py`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: creator second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `f.py`\n\n- [ ] **Step 1:** create f\n"
    )
    out = compile_plan(plan)   # must NOT exit 1 with a spurious cycle
    assert {"from": "B", "to": "A", "why": "write-after-create"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_backward_read_after_write_with_shared_write_compiles(tmp_path):
    plan = tmp_path / "raw-back.md"
    plan.write_text(
        "# Plan: RAW backward\n\n"
        "### Task A: reader first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `reader.py`\n- Modify: `shared.txt`\n- Test: `data.json`\n\n"
        "- [ ] **Step 1:** consume data\n\n"
        "### Task B: writer second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `data.json`\n- Modify: `shared.txt`\n\n"
        "- [ ] **Step 1:** produce data\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "read-after-write"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_marker_edge_beats_doc_order_write_after_write(tmp_path):
    plan = tmp_path / "marker-vs-waw.md"
    plan.write_text(
        "# Plan: Marker beats WAW\n\n"
        "### Task A: declared dependent\n\n"
        "**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: declared prerequisite\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f first\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "marker"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_text_edge_beats_ambiguous_files_position(tmp_path):
    plan = tmp_path / "text-vs-ambig.md"
    plan.write_text(
        "# Plan: Text beats ambiguous\n\n"
        "### Task A: ambiguous early\n\n**Type:** implementation\n\n"
        "- [ ] **Step 1:** refactor, runs after Task B finishes\n\n"
        "### Task B: concrete later\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `g.py`\n\n- [ ] **Step 1:** create g\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "text"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_genuine_cycle_still_errors(tmp_path):
    plan = tmp_path / "genuine.md"
    plan.write_text(
        "# Plan: Genuine cycle\n\n"
        "### Task A: needs B's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.out`\n- Test: `b.out`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: needs A's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.out`\n- Test: `a.out`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "cycle" in p.stderr.lower()


def test_tilde_fenced_heading_is_content_not_a_task(tmp_path):
    plan = tmp_path / "tilde.md"
    plan.write_text(
        "# Plan: Tilde\n\n"
        "### Task A: embeds an example\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** document the format:\n\n"
        "~~~markdown\n### Task 42: fenced by tildes, not a task\n~~~\n\n"
        "### Task B: second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A", "B"]


def test_fenced_release_evidence_does_not_reclassify(tmp_path):
    plan = tmp_path / "fenced-release.md"
    plan.write_text(
        "# Plan: Fenced evidence\n\n"
        "### Task A: implementation with a fenced example\n\n"
        "**Files:**\n- Create: `deploy_docs.md`\n\n"
        "- [ ] **Step 1:** document the release command:\n\n"
        "```bash\ngit push origin main\n```\n"
    )
    out = compile_plan(plan)
    assert out["tasks"][0]["disposition"] == "implementation"


def test_fenced_text_dependency_creates_no_edge(tmp_path):
    plan = tmp_path / "fenced-text.md"
    plan.write_text(
        "# Plan: Fenced text dep\n\n"
        "### Task A: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: embeds prose example\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** include this sample text:\n\n"
        "```text\nthis step runs after Task A in the example\n```\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    # No edge of any kind: the two disjoint-write tasks are independent. The
    # documented small-plan degrade (<=2 impl tasks -> sequential, one task per
    # wave in topological order; SKILL.md / dependency-analysis.md) still applies,
    # so waves are [["A"], ["B"]] rather than a single concurrent wave.
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["A"], ["B"]]
    assert out["mode"] == "sequential"


def test_unbackticked_path_drops_trailing_prose(tmp_path):
    plan = tmp_path / "plainpath.md"
    plan.write_text(
        "# Plan: Plain path\n\n"
        "### Task A: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: src/app.py — the new module\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-create"} in out["dag_edges"]


def test_brace_glob_flags_ambiguous(tmp_path):
    plan = tmp_path / "brace.md"
    plan.write_text(
        "# Plan: Brace glob\n\n"
        "### Task A: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** one\n\n"
        "### Task B: brace glob\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/{a,b}.py`\n\n- [ ] **Step 1:** sweep\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "ambiguous-files"} in out["dag_edges"]


def test_zero_implementation_plan_warns_loudly(tmp_path):
    plan = tmp_path / "zeroimpl.md"
    plan.write_text(
        "# Plan: Gates only\n\n"
        "### Task A: suite gate\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 0
    assert "no implementation tasks" in p.stderr
    import json as _json
    assert _json.loads(p.stdout)["waves"] == []


def test_fully_overlapping_writes_degrade_and_reason(tmp_path):
    plan = tmp_path / "overlap.md"
    body = "".join(
        "### Task {i}: writer {i}\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `same.txt`\n\n- [ ] **Step 1:** edit\n\n".replace("{i}", i)
        for i in ("A", "B", "C"))
    plan.write_text("# Plan: Overlap\n\n" + body)
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert out["degrade_reason"] == "Sequential mode: 3 implementation tasks, fully overlapping writes"
    assert out["waves"] == [["A"], ["B"], ["C"]]
