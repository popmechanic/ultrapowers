"""compile_plan.py turns a marked plan into the Step-3 transparency block,
deterministically. The marked fixture's documented expectations (waves
[[1,2],[3]], 4 -> gate config, 5 -> runbook) finally execute."""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))

_WAIVER = "**Acceptance:** waived — inline test plan"


def _with_waiver(path):
    """Return a path to a copy of `path` that has an Acceptance waiver injected
    immediately after the first line (plan title) if no **Acceptance:** line is
    already present. Pre-existing fixtures that carry their own waiver or seal
    are passed through unchanged. Returns the original path or a NamedTemporaryFile
    path; caller is responsible for cleanup."""
    text = pathlib.Path(path).read_text()
    if "**Acceptance:**" in text:
        return path, None  # already has one; no temp file needed
    # Inject after the very first line so it sits at plan-header level
    lines = text.splitlines(keepends=True)
    insert_at = 1  # after line 0 (title)
    injected = "".join(lines[:insert_at]) + _WAIVER + "\n\n" + "".join(lines[insert_at:])
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False)
    tmp.write(injected)
    tmp.close()
    return tmp.name, tmp.name


def compile_plan(path):
    effective, tmp = _with_waiver(path)
    try:
        p = subprocess.run([sys.executable, str(COMPILER), str(effective)],
                           capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        return json.loads(p.stdout)
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)


def compile_plan_raw(path):
    effective, tmp = _with_waiver(path)
    try:
        return subprocess.run([sys.executable, str(COMPILER), str(effective)],
                              capture_output=True, text=True)
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)


def compile_plan_raw_with(path, extra):
    effective, tmp = _with_waiver(path)
    try:
        return subprocess.run(
            [sys.executable, str(COMPILER), str(effective)] + list(extra),
            capture_output=True, text=True)
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)


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


def test_manual_step_classifies_by_heuristic(tmp_path):
    # Behavioral guard for the manual branch in classify() (MANUAL_EV): an
    # unmarked task whose prose says a human must run it off-machine must
    # compile to disposition "manual", flagged heuristic. Without this, a
    # regression in the MANUAL_EV regex would pass CI (only the source pattern
    # was pinned, never the behavior).
    plan = tmp_path / "manual.md"
    plan.write_text(
        "# Plan: Manual step\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: build the thing\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** write a\n\n"
        "### Task 2: provision the cluster\n\n**Depends-on:** 1\n\n"
        "- [ ] **Step 1:** the owner runs the provisioning by hand; this "
        "cannot be done from this machine\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["2"]["disposition"] == "manual"
    assert by_id["2"]["heuristic"] is True


def test_cycle_is_a_loud_error(tmp_path):
    plan = tmp_path / "cyclic.md"
    plan.write_text(
        "# Plan: Cycle\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
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


def test_marker_edge_orders_two_tasks_topologically(tmp_path):
    # Two impl tasks no longer degrade to sequential (the trigger is == 1, not
    # <= 2): a marker edge 2 -> 1 still serializes them by topology, in parallel
    # mode, so the waves stay [[2],[1]] without a spurious degrade_reason.
    plan = tmp_path / "dep.md"
    plan.write_text(
        "# Plan: Marker order\n\n"
        "### Task 1: dependent\n\n**Type:** implementation\n**Depends-on:** 2\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: prerequisite\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `two.txt`\n\n- [ ] **Step 1:** write two\n"
    )
    out = compile_plan(plan)
    assert out["mode"] == "parallel"
    assert out["degrade_reason"] is None
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
    # #85: a `*` glob in a Files path is now a LOUD compile error (enumerate the
    # concrete paths), not a silent ambiguous-files serialization. Same scenario
    # as the old tolerant pin, flipped to the strict grammar.
    plan = tmp_path / "glob.md"
    plan.write_text(
        "# Plan: Glob\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: globby\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/*.ts`\n\n- [ ] **Step 1:** sweep the sources\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "src/*.ts" in p.stderr and "enumerate" in p.stderr.lower()


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
    # No edge of any kind: the two disjoint-write tasks are independent. With the
    # small-plan degrade trigger narrowed to == 1 (single task; SKILL.md /
    # dependency-analysis.md), two independent tasks now run concurrently in one
    # parallel wave rather than being needlessly serialized.
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["A", "B"]]
    assert out["mode"] == "parallel"


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


def test_doc_order_edge_yields_to_transitive_marker_path(tmp_path):
    plan = tmp_path / "transitive.md"
    plan.write_text(
        "# Plan: Transitive yield\n\n"
        "### Task A: last by markers, first in doc\n\n"
        "**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: middle\n\n"
        "**Type:** implementation\n**Depends-on:** C\n\n"
        "**Files:**\n- Create: `other.txt`\n\n- [ ] **Step 1:** other\n\n"
        "### Task C: first by markers, last in doc\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f first\n"
    )
    out = compile_plan(plan)   # must NOT be a spurious cycle
    assert not any(e["from"] == "A" and e["to"] == "C" for e in out["dag_edges"])
    assert out["waves"] == [["C"], ["B"], ["A"]]


def test_nested_fence_with_info_string_stays_content(tmp_path):
    plan = tmp_path / "nested.md"
    plan.write_text(
        "# Plan: Nested fence\n\n"
        "### Task A: base\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: embeds a nested example\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** document this snippet:\n\n"
        "```\n"
        "```bash\n"
        "git push origin main\n"
        "```\n"
        "this line runs after Task A in the example\n"
        "```\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["B"]["disposition"] == "implementation"   # fenced git push inert
    assert not any(e["why"] == "text" for e in out["dag_edges"])  # fenced text-dep inert


def test_checkbox_step_shaped_like_files_line_adds_no_writes(tmp_path):
    plan = tmp_path / "stepbleed.md"
    plan.write_text(
        "# Plan: Step bleed\n\n"
        "### Task A: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** write a\n"
        "- Modify: nothing in `b.txt` should change yet\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert "b.txt" not in by_id["A"]["writes"]
    # Task A's prose mentions `b.txt` (even as a negation); the prose-reference
    # rule infers B -> A because B creates b.txt and A's prose backticks it.
    assert {"from": "B", "to": "A", "why": "prose-reference"} in out["dag_edges"]


def test_shared_test_path_serializes(tmp_path):
    plan = tmp_path / "sharedtest.md"
    plan.write_text(
        "# Plan: Shared test file\n\n"
        "### Task A: first feature\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `feat_a.py`\n- Test: `tests/test_shared.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task B: second feature\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `feat_b.py`\n- Test: `tests/test_shared.py`\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-write"} in out["dag_edges"]
    assert out["waves"] == [["A"], ["B"]]


def test_text_dependency_outside_impl_set_surfaces_conflict(tmp_path):
    plan = tmp_path / "textghost.md"
    plan.write_text(
        "# Plan: Text ghost\n\n"
        "### Task A: gate-ish\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** Run after Task A passes.\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert any(c["task"] == "B" and "edge dropped" in c["note"] for c in out["marker_conflicts"])


def test_tilde_wrapper_with_backtick_inner_keeps_following_task(tmp_path):
    # Regression: a tilde fence (~~~) wrapping a backtick example (```bash ... ```)
    # must close cleanly so a following task is still parsed. A nesting tracker that
    # compares closers against the OUTERMOST frame instead of the innermost leaves
    # the outer ~~~ open forever and silently drops Task B.
    plan = tmp_path / "tildewrap.md"
    plan.write_text(
        "# Plan: Tilde wrapper\n\n"
        "### Task A: documents a shell example inside a tilde wrapper\n\n"
        "**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** show the deploy command:\n\n"
        "~~~\n"
        "```bash\n"
        "git push origin main\n"
        "```\n"
        "~~~\n\n"
        "### Task B: still here\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A", "B"]
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"   # fenced git push inert


def test_duplicate_conflict_entries_are_deduped(tmp_path):
    plan = tmp_path / "dupconf.md"
    plan.write_text(
        "# Plan: Dup conflicts\n\n"
        "### Task A: gate-ish\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** Run after Task A passes.\n"
        "- [ ] **Step 2:** Verify again after Task A is green.\n"
    )
    out = compile_plan(plan)
    drops = [c for c in out["marker_conflicts"] if c["task"] == "B"]
    assert len(drops) == 1


def test_zero_impl_plan_is_not_sequential_mode(tmp_path):
    plan = tmp_path / "zeromode.md"
    plan.write_text(
        "# Plan: Gates only\n\n"
        "### Task A: suite gate\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    out = compile_plan(plan)
    assert out["waves"] == []
    assert out["mode"] == "parallel"
    assert out["degrade_reason"] is None


def test_task_title_does_not_create_text_edge(tmp_path):
    plan = tmp_path / "titledep.md"
    plan.write_text(
        "# Plan: Title dep\n\n"
        "### Task 1: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: cleanup after Task 1 lands\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert out["waves"] == [["1", "2"]]


def test_line_ranged_paths_strip_to_overlap(tmp_path):
    plan = tmp_path / "ranged.md"
    plan.write_text(
        "# Plan: Ranged\n\n"
        "### Task A: edit top\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/existing.py:123-145`\n\n- [ ] **Step 1:** top\n\n"
        "### Task B: edit bottom\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/existing.py:200-260`\n\n- [ ] **Step 1:** bottom\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-write"} in out["dag_edges"]
    assert out["waves"] == [["A"], ["B"]]


def test_multiple_depends_on_lines_accumulate(tmp_path):
    plan = tmp_path / "multidep.md"
    plan.write_text(
        "# Plan: Multi dep\n\n"
        "### Task A: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n\n"
        "### Task C: needs both\n\n**Type:** implementation\n"
        "**Depends-on:** A\n**Depends-on:** B\n\n"
        "**Files:**\n- Create: `c.txt`\n\n- [ ] **Step 1:** c\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "C", "why": "marker"} in out["dag_edges"]
    assert {"from": "B", "to": "C", "why": "marker"} in out["dag_edges"]
    assert out["waves"] == [["A", "B"], ["C"]]


def test_depends_none_plus_ids_ids_win(tmp_path):
    # ids win over a contradictory `none` (across multiple **Depends-on:** lines);
    # the none assertion is void and the marker edge still forms.
    plan = tmp_path / "mixeddep.md"
    plan.write_text(
        "# Plan: Mixed dep\n\n"
        "### Task A: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: contradictory markers\n\n**Type:** implementation\n"
        "**Depends-on:** none\n**Depends-on:** A\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "marker"} in out["dag_edges"]
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["B"]["depends_on"] == ["A"]
    assert out["waves"] == [["A"], ["B"]]


def test_marker_outside_header_block_is_ignored_and_surfaced(tmp_path):
    plan = tmp_path / "latemarker.md"
    plan.write_text(
        "# Plan: Late marker\n\n"
        "### Task A: discusses the syntax\n\n"
        "**Files:**\n- Create: `doc.md`\n\n"
        "- [ ] **Step 1:** document that each task carries a line like:\n\n"
        "**Type:** release\n"
        "**Depends-on:** B\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # The late unfenced markers must not reclassify A as a trusted release
    # nor fabricate a trusted marker edge B -> A.
    assert by_id["A"]["disposition"] == "implementation"
    assert by_id["A"]["heuristic"] is True
    assert not any(e["why"] == "marker" for e in out["dag_edges"])
    assert any(c["task"] == "A" and "header" in c["note"] for c in out["marker_conflicts"])


def test_self_referential_depends_on_surfaces_conflict(tmp_path):
    plan = tmp_path / "selfdep.md"
    plan.write_text(
        "# Plan: Self dep\n\n"
        "### Task A: depends on itself\n\n**Type:** implementation\n"
        "**Depends-on:** A\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: bystander\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert out["dag_edges"] == []
    assert any(c["task"] == "A" and "self" in c["note"].lower() for c in out["marker_conflicts"])


def test_prose_only_task_does_not_trust_late_markers(tmp_path):
    plan = tmp_path / "proseonly.md"
    plan.write_text(
        "# Plan: Prose only\n\n"
        "### Task A: reference notes\n\n"
        "This task collects the marker reference material.\n\n"
        "Plans may carry a line like:\n\n"
        "**Type:** release\n\n"
        "somewhere in the marker reference table.\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"
    assert by_id["A"]["heuristic"] is True
    assert any(c["task"] == "A" and "header" in c["note"] for c in out["marker_conflicts"])


def test_marker_after_description_paragraph_is_demoted(tmp_path):
    # The contract says markers go IMMEDIATELY after the heading; a marker that
    # follows a description paragraph is ignored and surfaced, not trusted.
    plan = tmp_path / "descfirst.md"
    plan.write_text(
        "# Plan: Description first\n\n"
        "### Task A: misplaced marker\n\n"
        "A short description paragraph comes first here.\n\n"
        "**Type:** gate\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"   # heuristic, not trusted gate
    assert any(c["task"] == "A" and "header" in c["note"] for c in out["marker_conflicts"])


def test_conflicting_type_markers_first_wins(tmp_path):
    # A second, different valid **Type:** marker is ignored — the first wins and
    # the task stays a trusted gate.
    plan = tmp_path / "duptype.md"
    plan.write_text(
        "# Plan: Dup type\n\n"
        "### Task A: contradictory types\n\n"
        "**Type:** gate\n**Type:** implementation\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "gate"             # first wins
    assert by_id["A"]["heuristic"] is False


def test_near_miss_marker_spelling_degrades_to_heuristics(tmp_path):
    # A typo'd marker (`**type:**`, `**Depends-On:**`) is not trusted: the task
    # falls to the heuristic classifier and no marker edge is fabricated.
    plan = tmp_path / "nearmiss.md"
    plan.write_text(
        "# Plan: Near miss\n\n"
        "### Task A: typo'd markers\n\n"
        "**type:** gate\n**Depends-On:** B\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"   # heuristics, not the typo'd gate
    assert not any(e["why"] == "marker" for e in out["dag_edges"])


def test_fenced_block_after_heading_ends_the_header(tmp_path):
    plan = tmp_path / "fencehead.md"
    plan.write_text(
        "# Plan: Fence head\n\n"
        "### Task A: example first\n\n"
        "```bash\necho example\n```\n\n"
        "**Type:** release\n**Depends-on:** B\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"   # not a trusted release
    assert not any(e["why"] == "marker" for e in out["dag_edges"])
    assert any(c["task"] == "A" and "header" in c["note"] for c in out["marker_conflicts"])


def test_colon_outside_bold_marker_is_not_trusted(tmp_path):
    # `**Type**: gate` (colon outside the bold) is a near-miss: not trusted, so
    # no marker edge forms and the task is not a trusted gate.
    plan = tmp_path / "colonout.md"
    plan.write_text(
        "# Plan: Colon outside\n\n"
        "### Task A: colon-outside markers\n\n"
        "**Type**: gate\n**Depends-on**: B\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "marker" for e in out["dag_edges"])


def test_late_near_miss_marker_also_surfaces(tmp_path):
    plan = tmp_path / "latenear.md"
    plan.write_text(
        "# Plan: Late near miss\n\n"
        "### Task A: typo after steps\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "**Depends-On:** B\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "marker" for e in out["dag_edges"])
    assert any(c["task"] == "A" and "header" in c["note"] for c in out["marker_conflicts"])


def test_empty_and_second_unrecognized_type_values_ignored(tmp_path):
    # An empty `**Type:**` and a second, unrecognized value are both ignored:
    # Task A falls to the heuristic classifier, Task B keeps its first valid type.
    plan = tmp_path / "emptytype.md"
    plan.write_text(
        "# Plan: Empty type\n\n"
        "### Task A: empty value\n\n"
        "**Type:**\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: valid then garbage\n\n"
        "**Type:** gate\n**Type:** banana\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["B"]["disposition"] == "gate"             # first valid wins
    assert by_id["A"]["heuristic"] is True                 # empty Type ignored


def test_blank_line_closes_the_files_block(tmp_path):
    plan = tmp_path / "blankfiles.md"
    plan.write_text(
        "# Plan: Blank closes files\n\n"
        "### Task A: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- Test: run the suite manually against `x.txt`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `x.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    # The dash bullet after the blank line is prose, not a Files entry: no
    # phantom 'run' or 'x.txt' read for task A. However, task A's prose does
    # backtick-reference `x.txt` which task B creates — the prose-reference
    # rule correctly infers B -> A (A needs x.txt to test against).
    assert {"from": "B", "to": "A", "why": "prose-reference"} in out["dag_edges"]
    assert not any(e["why"] == "read-after-write" for e in out["dag_edges"])


def test_override_conflict_edge_field_carries_why_label(tmp_path):
    import re as _re
    plan = tmp_path / "whylabel.md"
    plan.write_text(
        "# Plan: Why label\n\n"
        "### Task A: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `f.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier claiming independence\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    override = [c for c in out["marker_conflicts"] if "overridden" in c["note"]]
    assert override and _re.fullmatch(
        r"[A-Za-z0-9]+ -> [A-Za-z0-9]+ \((write-after-create|write-after-write|read-after-write|text|ambiguous-files)\)",
        override[0]["edge"])


def test_blank_after_files_header_does_not_discard_entries(tmp_path):
    plan = tmp_path / "blankhead.md"
    plan.write_text(
        "# Plan: Blank after Files\n\n"
        "### Task A: spaced formatting\n\n**Type:** implementation\n\n"
        "**Files:**\n\n- Create: `parser.py`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `parser.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["writes"] == ["parser.py"]
    assert {"from": "A", "to": "B", "why": "write-after-create"} in out["dag_edges"]


def test_near_miss_task_heading_is_a_loud_error(tmp_path):
    plan = tmp_path / "headmiss.md"
    plan.write_text(
        "# Plan: Heading miss\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 1.5: dotted id folds away silently today\n\n"
        "**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n\n"
        "### Task 2: third\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `c.txt`\n\n- [ ] **Step 1:** c\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "heading" in p.stderr.lower()
    assert "1.5" in p.stderr


def test_trusted_type_wins_alongside_typod_dep_marker(tmp_path):
    # A valid **Type:** is trusted even when an adjacent near-miss dep marker
    # (`**Depends-On:**`) degrades to prose; the task stays a trusted gate.
    plan = tmp_path / "notetail.md"
    plan.write_text(
        "# Plan: Note tail\n\n"
        "### Task A: trusted type, typo'd dep\n\n"
        "**Type:** gate\n**Depends-On:** B\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "gate" and by_id["A"]["heuristic"] is False
    assert not any(e["why"] == "marker" for e in out["dag_edges"])


def test_indented_valid_heading_is_a_real_task(tmp_path):
    plan = tmp_path / "indenthead.md"
    plan.write_text(
        "# Plan: Indented heading\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        " ### Task 2: one leading space, still a CommonMark heading\n\n"
        "**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["1", "2"]
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["a.txt"]      # task 2's files did NOT fold in
    assert by_id["2"]["writes"] == ["b.txt"]


def test_four_hash_and_caps_headings_error_loudly(tmp_path):
    for bad in ("#### Task 2: four hashes", "### TASK 2: all caps"):
        plan = tmp_path / "badhead.md"
        plan.write_text(
            "# Plan: Bad heading\n\n"
            "### Task 1: first\n\n**Type:** implementation\n\n"
            "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
            + bad + "\n\n**Type:** implementation\n\n"
            "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
        )
        p = compile_plan_raw(plan)
        assert p.returncode == 1, bad
        assert "heading" in p.stderr.lower(), bad


def test_lowercase_files_label_is_a_loud_violation(tmp_path):
    # #85: a wrong-case label (`- modify:`) is an unknown label under the strict
    # grammar — a loud compile error with a did-you-mean, not a silent near-miss.
    plan = tmp_path / "lowerlabel.md"
    plan.write_text(
        "# Plan: Lowercase label\n\n"
        "### Task 1: lowercase label\n\n**Type:** implementation\n\n"
        "**Files:**\n- modify: `shared.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "modify" in p.stderr and "Create/Modify/Test" in p.stderr


def test_wrong_level_task_headings_error_loudly(tmp_path):
    for bad in ("## Task 2: two hashes", "##### Task 2: five hashes"):
        plan = tmp_path / "levelhead.md"
        plan.write_text(
            "# Plan: Wrong level\n\n"
            "### Task 1: first\n\n**Type:** implementation\n\n"
            "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
            + bad + "\n\n**Type:** implementation\n\n"
            "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
        )
        p = compile_plan_raw(plan)
        assert p.returncode == 1, bad
        assert "heading" in p.stderr.lower(), bad


def test_section_titles_with_task_word_stay_legal(tmp_path):
    plan = tmp_path / "sections.md"
    plan.write_text(
        "# Plan: Sections\n\n"
        "## Tasks\n\n## Task Structure\n\n"
        "### Task 1: only\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["1"]


def test_asterisk_bullet_files_entry_keeps_block_open(tmp_path):
    # A `* Modify:` bullet (wrong bullet char) is not a canonical entry, but the
    # Files block stays open so a valid `- Modify:` entry after it still parses.
    plan = tmp_path / "starbullet.md"
    plan.write_text(
        "# Plan: Star bullet\n\n"
        "### Task 1: mixed bullets\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n* Modify: `b.py`\n- Modify: `c.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert "c.py" in by_id["1"]["writes"]          # valid entry after the star survives


def test_unbackticked_comma_paths_lose_no_overlap(tmp_path):
    # An unbackticked comma list keeps the first path in the write set, so the
    # write-after-create overlap edge is not lost.
    plan = tmp_path / "commapaths.md"
    plan.write_text(
        "# Plan: Comma paths\n\n"
        "### Task 1: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: src/app.py, src/other.py\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "write-after-create"} in out["dag_edges"]


def test_unparsed_bullets_in_files_block_surface_and_keep_block_open(tmp_path):
    # #85: an unknown Files label (`- Delete:`) is now a LOUD compile error with a
    # did-you-mean, not a silent near-miss drop. (A colon-less natural-English
    # bullet stays a soft near-miss, but the Delete violation bails first.) Same
    # scenario as the old tolerant pin, flipped to the strict grammar.
    plan = tmp_path / "bullets.md"
    plan.write_text(
        "# Plan: Unparsed bullets\n\n"
        "### Task 1: unknown label\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify `src/app.py` to wire it in\n- Delete: `old.py`\n- Modify: `keep.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "Delete" in p.stderr and "old.py" in p.stderr
    assert "Modify" in p.stderr      # the did-you-mean suggestion


def test_depends_space_variant_text_rule_tolerates_punctuation(tmp_path):
    plan = tmp_path / "depspace.md"
    plan.write_text(
        "# Plan: Depends space\n\n"
        "### Task 1: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: upstream idiom\n\n**Type:** implementation\n"
        "**Depends on:** Task 1 GREEN passing.\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    # The space-spelled marker degrades to prose, but the text rule tolerates the
    # `:**` punctuation, so the ordering edge is recovered.
    assert {"from": "1", "to": "2", "why": "text"} in out["dag_edges"]
    assert out["waves"] == [["1"], ["2"]]


def test_plural_text_dependency_parses_each_listed_id(tmp_path):
    plan = tmp_path / "plural-parse.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `b.py`\n\n"
        "- [ ] **Step 1:** This depends on Tasks 1 and 3 being merged first.\n\n"
        "### Task 3: c\n\n**Files:**\n- Modify: `c.py`\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "text"} in out["dag_edges"]
    assert {"from": "3", "to": "2", "why": "text"} in out["dag_edges"]
    # Parsed lists no longer surface the plural conflict:
    assert not any("plural" in c["note"].lower() for c in out["marker_conflicts"])


def test_plural_text_dependency_comma_list(tmp_path):
    plan = tmp_path / "plural-comma.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `b.py`\n\n"
        "### Task 3: c\n\n**Files:**\n- Modify: `c.py`\n\n"
        "Runs after Tasks 1, 2 and a final review.\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "3", "why": "text"} in out["dag_edges"]
    assert {"from": "2", "to": "3", "why": "text"} in out["dag_edges"]


def test_prosey_unbackticked_value_is_not_a_phantom_path(tmp_path):
    plan = tmp_path / "phantom.md"
    plan.write_text(
        "# Plan: Phantom\n\n"
        "### Task 1: prose test line\n\n**Type:** implementation\n\n"
        "**Files:**\n- Test: run pytest manually and confirm green\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: other\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    # 'run' must not become a phantom read path: with no real paths task 1 stays
    # AMBIGUOUS (conservative ambiguous-files serialization).
    assert any(e["why"] == "ambiguous-files" for e in out["dag_edges"])
    assert not any(e["why"] == "read-after-write" for e in out["dag_edges"])


def test_glob_ambiguity_is_explained_in_conflicts(tmp_path):
    # #85: a bracket route (`app/[slug]/page.tsx`) reads as a glob and is now a
    # LOUD compile error naming the path and telling the author to enumerate,
    # not a soft ambiguous-files conflict. Same scenario, flipped to strict.
    plan = tmp_path / "globwhy.md"
    plan.write_text(
        "# Plan: Glob why\n\n"
        "### Task 1: bracket route\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `app/[slug]/page.tsx`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: other\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "app/[slug]/page.tsx" in p.stderr and "enumerate" in p.stderr.lower()


def test_all_wrong_level_plan_gets_the_heading_diagnostic(tmp_path):
    plan = tmp_path / "h2only.md"
    plan.write_text(
        "# Plan: Legacy levels\n\n"
        "## Task 1: first\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "## Task 2: second\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "## Task 1:" in p.stderr           # the diagnostic NAMES the heading (not the generic bail)


def test_cycle_error_names_one_concrete_edge_path(tmp_path):
    plan = tmp_path / "cycle.md"
    plan.write_text(
        "### Task 1: a\n\n**Depends-on:** 2\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Depends-on:** 1\n\n**Files:**\n- Modify: `b.py`\n"
    )
    p = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                       capture_output=True, text=True)
    assert p.returncode == 1
    assert "cycle detected among tasks 1, 2" in p.stderr
    # One concrete path, each hop labeled with the edge's why:
    assert "One cycle:" in p.stderr
    assert "-> 2 (marker)" in p.stderr
    assert "-> 1 (marker)" in p.stderr


def test_inline_files_header_backticked_paths_parse(tmp_path):
    plan = tmp_path / "inline-files.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:** `x.py` and `y.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `z.py`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["x.py", "y.py"]
    # Disjoint concrete paths -> no ambiguous-files serialization, one wave:
    assert not any(e["why"] == "ambiguous-files" for e in out["dag_edges"])
    assert out["waves"] == [["1", "2"]]


def test_inline_files_header_prose_value_has_no_writes(tmp_path):
    plan = tmp_path / "inline-prose.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:** see the bullets in the spec\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `z.py`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == []          # falls to ambiguous-files as before


PROSE_REF_PLAN = """# Demo Implementation Plan

### Task 1: User schema

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

- [ ] **Step 1:** Define the `User` dataclass.

### Task 4: In-memory store

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

- [ ] **Step 1:** `add(name, email)` creates and returns a `schema.User` with an auto-incrementing id.
"""


def test_prose_reference_edge_orders_creator_before_referencer(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN)
    out = compile_plan(plan)
    assert {"from": "1", "to": "4", "why": "prose-reference"} in out["dag_edges"]
    assert out["waves"] == [["1"], ["4"]]
    notes = " ".join(c["note"] for c in out["marker_conflicts"])
    # the inference itself is surfaced, and the authored `none` override too
    assert "prose-reference" in notes
    assert "Depends-on: none overridden" in notes


def test_prose_reference_matches_basename_and_full_path(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN.replace(
        "returns a `schema.User`", "import `apistub/schema.py` and `schema.py`"))
    out = compile_plan(plan)
    assert {"from": "1", "to": "4", "why": "prose-reference"} in out["dag_edges"]


def test_prose_reference_dedupes_against_declared_marker(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN.replace(
        "**Depends-on:** none\n\n**Files:**\n- Create: `apistub/store.py`",
        "**Depends-on:** 1\n\n**Files:**\n- Create: `apistub/store.py`"))
    out = compile_plan(plan)
    whys = [e["why"] for e in out["dag_edges"]]
    assert "marker" in whys
    assert "prose-reference" not in whys          # deduped by the seen-pair guard
    assert out["marker_conflicts"] == []          # nothing newly inferred -> no note


def test_prose_reference_ignores_fenced_examples(tmp_path):
    plan = tmp_path / "plan.md"
    fenced = PROSE_REF_PLAN.replace(
        "- [ ] **Step 1:** `add(name, email)` creates and returns a `schema.User` with an auto-incrementing id.",
        "- [ ] **Step 1:** Implement the store. Example output:\n\n```\nuser = schema.User(id=1)\n```")
    plan.write_text(fenced)
    out = compile_plan(plan)
    assert all(e["why"] != "prose-reference" for e in out["dag_edges"])


def test_prose_reference_short_stem_requires_exact_or_basename(tmp_path):
    # stem 'a' (from a.txt) is below the minimum stem length: `a.something`
    # must NOT match, but the exact backticked filename `a.txt` must.
    plan = tmp_path / "plan.md"
    plan.write_text("""# Demo Implementation Plan

### Task 1: Alpha

**Type:** implementation

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to the file.

### Task 2: Beta

**Type:** implementation

**Files:**
- Create: `b.txt`

- [ ] **Step 1:** Write `a.member` style prose and copy the header from `a.txt`.
""")
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "prose-reference"} in out["dag_edges"]


# ---------------------------------------------------------------------------
# Helpers for acceptance-marker tests
# ---------------------------------------------------------------------------

def compile_text(plan_markdown, tmp_path=None):
    """Write plan_markdown to a temp file and compile it.

    Returns (returncode, parsed_json_or_None, stderr_string).
    """
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        f.write(plan_markdown)
        tmp = pathlib.Path(f.name)
    p = subprocess.run([sys.executable, str(COMPILER), str(tmp)],
                       capture_output=True, text=True)
    tmp.unlink(missing_ok=True)
    out = None
    if p.returncode == 0:
        try:
            out = json.loads(p.stdout)
        except json.JSONDecodeError:
            pass
    return p.returncode, out, p.stderr


SEAL_LINE = "**Acceptance:** sealed a1b2c3d4e5f6 (sha256:" + "ab" * 32 + ")"
WAIVE_LINE = "**Acceptance:** waived — fixture plan, exam not applicable"


def _minimal_marked_plan(acceptance_line=None):
    head = ["# Tiny Implementation Plan", ""]
    if acceptance_line:
        head += [acceptance_line, ""]
    return "\n".join(head + [
        "### Task 1: Thing",
        "**Type:** implementation",
        "**Depends-on:** none",
        "**Files:**",
        "- Create: `a.py`",
        "- [ ] **Step 1: do it**",
    ]) + "\n"


def test_acceptance_sealed_parsed():
    code, out, _ = compile_text(_minimal_marked_plan(SEAL_LINE))
    assert code == 0
    assert out["acceptance"] == {"mode": "sealed", "sealId": "a1b2c3d4e5f6",
                                 "sha256": "ab" * 32}


def test_acceptance_waived_parsed():
    code, out, _ = compile_text(_minimal_marked_plan(WAIVE_LINE))
    assert code == 0
    assert out["acceptance"]["mode"] == "waived"
    assert "not applicable" in out["acceptance"]["reason"]


def test_marked_plan_without_acceptance_fails():
    code, _, err = compile_text(_minimal_marked_plan())
    assert code != 0
    assert "Acceptance" in err and "sealed-acceptance" in err


def test_fenced_acceptance_line_is_ignored():
    plan = _minimal_marked_plan("```\n" + SEAL_LINE + "\n```")
    code, _, err = compile_text(plan)
    assert code != 0, "a fenced example must not count as the plan's seal"


# ---------------------------------------------------------------------------
# Text-based compile helpers (thin wrappers to avoid duplicating subprocess logic)
# ---------------------------------------------------------------------------

def compile_plan_text(plan_md):
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return compile_plan(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)


def compile_raw_text(plan_md):
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return compile_plan_raw(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Suite acceptance disposition tests
# ---------------------------------------------------------------------------

def test_acceptance_suite_parsed():
    out = compile_plan_text(_minimal_marked_plan(
        "**Acceptance:** suite — verified by the committed suite"))
    assert out["acceptance"]["mode"] == "suite"
    assert "committed suite" in out["acceptance"]["reason"]


def test_acceptance_suite_satisfies_enforcement():
    r = compile_raw_text(_minimal_marked_plan("**Acceptance:** suite — x"))
    assert r.returncode == 0


def test_fenced_suite_line_is_ignored():
    plan = _minimal_marked_plan("```\n**Acceptance:** suite — fenced\n```")
    r = compile_raw_text(plan)
    assert r.returncode != 0, "a fenced suite line must not count as a disposition"


# ---------------------------------------------------------------------------
# Problem 3: writes parsing must count only path-like tokens
# ---------------------------------------------------------------------------

def test_modify_function_names_and_routes_are_not_writes(tmp_path):
    # A Modify block naming functions, and a body mentioning API routes, must not
    # land in `writes` — bare identifiers and routes are not files, and treating
    # them as writes fabricates spurious overlap edges between unrelated tasks.
    plan = tmp_path / "funcs.md"
    plan.write_text(
        "# Plan: Functions and routes\n\n"
        "### Task 1: parser\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `cmd_apply_create`, `_build_parser`\n- Modify: `apistub/cli.py`\n\n"
        "- [ ] **Step 1:** Wire the `/api/ledger` and `/api/session/start` routes into `apistub/cli.py`.\n\n"
        "### Task 2: handlers\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `apistub/handlers.py`\n\n"
        "- [ ] **Step 1:** Implement the `/api/ledger` handler.\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # Only the real path is a write; functions and routes are dropped.
    assert by_id["1"]["writes"] == ["apistub/cli.py"]
    assert "cmd_apply_create" not in by_id["1"]["writes"]
    assert "_build_parser" not in by_id["1"]["writes"]
    assert not any("/api/" in w for w in by_id["1"]["writes"])
    # The two tasks edit disjoint real files -> no fabricated overlap edge.
    assert not any(e["why"] == "write-after-write" for e in out["dag_edges"])
    assert out["waves"] == [["1", "2"]]


def test_extensionless_real_files_are_kept_identifiers_dropped(tmp_path):
    # Bare conventional filenames (Capitalized / ALL-CAPS, no dot, no underscore)
    # ARE files and must keep their write-after-write overlap; snake_case
    # identifiers and dotted attribute refs are not files and are dropped.
    plan = tmp_path / "makef.md"
    plan.write_text(
        "# Plan: Makefile\n\n"
        "### Task 1: edits the build files\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Makefile`, `Dockerfile`, `LICENSE`\n- Modify: `helper_func`, `schema.User`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: also edits Makefile\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Makefile`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["Dockerfile", "LICENSE", "Makefile"]  # real files kept
    assert "helper_func" not in by_id["1"]["writes"]   # snake_case identifier dropped
    assert "schema.User" not in by_id["1"]["writes"]   # dotted attribute ref dropped
    # the shared Makefile produces a real overlap edge (not lost to identifier noise)
    assert {"from": "1", "to": "2", "why": "write-after-write"} in out["dag_edges"]


def test_dotted_attribute_ref_is_not_a_write(tmp_path):
    # `schema.User` (CamelCase attribute) must not be admitted as a write — that
    # was the P3 gap: extension-only detection treated `.User` as an extension.
    plan = tmp_path / "attr.md"
    plan.write_text(
        "# Plan: Attr ref\n\n"
        "### Task 1: returns a model\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `schema.User`, `Foo.Bar`\n- Modify: `apistub/schema.py`\n\n"
        "- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["apistub/schema.py"]


def test_inline_files_all_nonpath_tokens_have_no_writes(tmp_path):
    # An inline **Files:** line whose backticked tokens are all non-path
    # identifiers contributes no writes (falls to ambiguous-files).
    plan = tmp_path / "inlinemiss.md"
    plan.write_text(
        "# Plan: Inline nonpath\n\n"
        "### Task 1: only identifiers\n\n**Type:** implementation\n\n"
        "**Files:** `cmd_foo` `cmd_bar`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == []


def test_no_space_wrong_level_heading_gets_three_hash_hint(tmp_path):
    plan = tmp_path / "nospace.md"
    plan.write_text(
        "# Plan: No space\n\n"
        "### Task 1: ok\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
        "####Task 2: four hashes no space\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "EXACTLY three hashes" in p.stderr


# ---------------------------------------------------------------------------
# Problem 5: heading-level hint and conflict/inference separation
# ---------------------------------------------------------------------------

def test_wrong_level_heading_emits_three_hash_hint(tmp_path):
    plan = tmp_path / "wronglevel.md"
    plan.write_text(
        "# Plan: Wrong level\n\n"
        "### Task 1: ok\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
        "## Task 2: two hashes\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "EXACTLY three hashes" in p.stderr
    assert "did you mean" in p.stderr.lower()


def test_caps_heading_does_not_get_level_hint(tmp_path):
    # `### TASK 2:` is the right level (three hashes); the fault is the case, so
    # the three-hash hint must NOT fire (it would mislead).
    plan = tmp_path / "caps.md"
    plan.write_text(
        "# Plan: Caps\n\n"
        "### Task 1: ok\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
        "### TASK 2: all caps\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "heading" in p.stderr.lower()
    assert "EXACTLY three hashes" not in p.stderr


def test_conflicts_carry_kind_and_inferences_are_separated(tmp_path):
    # A benign auto-inferred edge (write-after-create overriding Depends-on: none)
    # is tagged kind="inference"; a genuine problem (ghost dependency) is
    # kind="conflict". SKILL.md renders the two buckets separately.
    plan = tmp_path / "kinds.md"
    plan.write_text(
        "# Plan: Kinds\n\n"
        "### Task 1: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `f.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: modifier claiming independence\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** b\n\n"
        "### Task 3: names a ghost\n\n**Type:** implementation\n**Depends-on:** 9\n\n"
        "**Files:**\n- Create: `g.txt`\n\n- [ ] **Step 1:** c\n"
    )
    out = compile_plan(plan)
    assert all("kind" in c for c in out["marker_conflicts"])
    inferences = [c for c in out["marker_conflicts"] if c["kind"] == "inference"]
    conflicts = [c for c in out["marker_conflicts"] if c["kind"] == "conflict"]
    # the override of `Depends-on: none` by the file edge is an informational inference
    assert any("overridden" in c["note"] for c in inferences)
    # the ghost id 9 is a genuine conflict needing attention
    assert any("9" in c["note"] and "edge dropped" in c["note"] for c in conflicts)


# ---------------------------------------------------------------------------
# Problem 1 / 2: launch-ready task objects (single source of truth) + emit-launch
# ---------------------------------------------------------------------------

LAUNCH_PLAN = (
    "# Demo Implementation Plan\n\n"
    "**Acceptance:** waived — demo\n\n"
    "### Task 1: schema\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `apistub/schema.py`\n- Test: `tests/test_schema.py`\n\n"
    "- [ ] **Step 1:** Define the `User` dataclass.\n\n"
    "### Task 2: store\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
    "**Files:**\n- Create: `apistub/store.py`\n\n"
    "- [ ] **Step 1:** Build the store on top of the schema.\n"
)


def test_launch_waves_is_light_and_grouped(tmp_path):
    plan = tmp_path / "launch.md"
    plan.write_text(LAUNCH_PLAN)
    out = compile_plan(plan)
    # grouped exactly like waves, but with title/files/depends_on per task and NO body
    assert [[t["id"] for t in w] for w in out["launch_waves"]] == out["waves"]
    t1 = out["launch_waves"][0][0]
    assert t1["id"] == "1"
    assert t1["title"] == "schema"
    assert t1["files"] == ["apistub/schema.py", "tests/test_schema.py"]
    assert "body" not in t1            # light: no body inline
    t2 = out["launch_waves"][1][0]
    assert t2["depends_on"] == ["1"]


def test_emit_launch_writes_verbatim_bodies(tmp_path):
    plan = tmp_path / "launch.md"
    plan.write_text(LAUNCH_PLAN)
    launch = tmp_path / "out" / "waves.json"   # parent dir does not exist yet
    p = subprocess.run([sys.executable, str(COMPILER), str(plan),
                        "--emit-launch", str(launch)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    assert out["launch_file"] == str(launch)
    payload = json.loads(launch.read_text())
    # full, verbatim, fence-aware bodies — one entry per implementation task, by id
    ids = [t["id"] for t in payload["tasks"]]
    assert ids == ["1", "2"]
    body1 = next(t["body"] for t in payload["tasks"] if t["id"] == "1")
    assert "### Task 1: schema" in body1            # verbatim, includes the heading
    assert "Define the `User` dataclass." in body1
    assert payload["edges"] == [["1", "2"]]
    assert payload["waves"] == out["waves"]
    # files carried for FILES-scope/sibling threading
    assert next(t for t in payload["tasks"] if t["id"] == "1")["files"] == \
        ["apistub/schema.py", "tests/test_schema.py"]


def test_emit_launch_preserves_fenced_headings_in_bodies(tmp_path):
    # A `### Task 99:` inside a code fence is content, not a task; the verbatim
    # body the compiler writes must keep it intact (fence-aware extraction).
    plan = tmp_path / "fenced.md"
    plan.write_text(
        "# Demo Implementation Plan\n\n"
        "**Acceptance:** waived — demo\n\n"
        "### Task 1: documents a format\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** embed this example:\n\n"
        "```markdown\n### Task 99: not a real task\n```\n"
    )
    launch = tmp_path / "waves.json"
    p = subprocess.run([sys.executable, str(COMPILER), str(plan),
                        "--emit-launch", str(launch)], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    payload = json.loads(launch.read_text())
    assert [t["id"] for t in payload["tasks"]] == ["1"]   # 99 stayed fenced content
    assert "### Task 99: not a real task" in payload["tasks"][0]["body"]


def test_emit_launch_is_opt_in(tmp_path):
    # Without the flag, no launch_file key and no file written (back-compat).
    plan = tmp_path / "launch.md"
    plan.write_text(LAUNCH_PLAN)
    out = compile_plan(plan)
    assert "launch_file" not in out
    assert "launch_waves" in out            # the light grouping is always present


def test_global_constraints_and_interfaces_parse_into_new_fields(tmp_path):
    plan = tmp_path / "v6.md"
    plan.write_text(
        "# Plan: V6 blocks\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "## Global Constraints\n\n"
        "- Python 3.11+ only; no new third-party deps.\n"
        "- All public names use snake_case.\n\n"
        "---\n\n"
        "### Task 1: schema\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `apistub/schema.py`\n\n"
        "**Interfaces:**\n"
        "- Produces: `User` dataclass (id: int, name: str, email: str)\n"
        "- Produces: `FIELDS` dict\n\n"
        "- [ ] **Step 1:** write schema\n\n"
        "### Task 2: store\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `apistub/store.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `User` dataclass (id: int, name: str, email: str)\n\n"
        "- [ ] **Step 1:** write store\n"
    )
    out = compile_plan(plan)
    # Top-level Global Constraints captured verbatim (body only, header stripped).
    assert "Python 3.11+ only; no new third-party deps." in out["globalConstraints"]
    assert "All public names use snake_case." in out["globalConstraints"]
    assert "## Global Constraints" not in out["globalConstraints"]
    # Per-task interfaces, preserving the text after the Consumes:/Produces: label.
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["produces"] == [
        "`User` dataclass (id: int, name: str, email: str)",
        "`FIELDS` dict",
    ]
    assert by_id["1"]["interfaces"]["consumes"] == []
    assert by_id["2"]["interfaces"]["consumes"] == [
        "`User` dataclass (id: int, name: str, email: str)",
    ]
    assert by_id["2"]["interfaces"]["produces"] == []
    # The fields ride into the launch-ready objects the engine consumes.
    lw_by_id = {t["id"]: t for wave in out["launch_waves"] for t in wave}
    assert lw_by_id["1"]["interfaces"]["produces"][0].startswith("`User` dataclass")
    # The Interfaces sub-lines are NOT mis-read as malformed Files entries.
    assert not any(c["task"] in ("1", "2") and "Files" in c["note"]
                   for c in out["marker_conflicts"])
    # And they did not leak into the write sets (Files parsing stopped cleanly).
    assert by_id["1"]["writes"] == ["apistub/schema.py"]
    assert by_id["2"]["writes"] == ["apistub/store.py"]


def test_v5_plan_compiles_clean_with_empty_interface_defaults(tmp_path):
    plan = tmp_path / "v5.md"
    plan.write_text(
        "# Plan: V5 legacy\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: only\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    assert out["globalConstraints"] == ""
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"] == {"consumes": [], "produces": []}
    assert not any("Interface" in c["note"] or "Global Constraint" in c["note"]
                   for c in out["marker_conflicts"])


def test_interfaces_consumes_line_is_not_a_files_near_miss(tmp_path):
    plan = tmp_path / "exempt.md"
    plan.write_text(
        "# Plan: Exemption\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: consumer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `app.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `validate_payload(payload) -> list[str]`\n"
        "- Produces: `route(store, method, path, payload=None)`\n\n"
        "- [ ] **Step 1:** wire it\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["consumes"] == [
        "`validate_payload(payload) -> list[str]`"]
    assert by_id["1"]["interfaces"]["produces"] == [
        "`route(store, method, path, payload=None)`"]
    assert by_id["1"]["writes"] == ["app.py"]
    assert not any(c["task"] == "1" and "Files" in c["note"]
                   for c in out["marker_conflicts"])


EVAL_FLAWED = ROOT / "evals/fixtures/flawed/plan.md"


def test_flawed_fixture_interface_edge_orders_task4_after_task1():
    out = compile_plan(EVAL_FLAWED)
    assert {"from": "1", "to": "4", "why": "interface"} in out["dag_edges"]
    wave_of = {tid: i for i, wave in enumerate(out["waves"]) for tid in wave}
    assert wave_of["4"] > wave_of["1"]
    assert "4" not in out["waves"][0]


def test_flawed_fixture_emits_undeclared_dependency_finding():
    out = compile_plan(EVAL_FLAWED)
    findings = [c for c in out["marker_conflicts"]
                if c.get("kind") == "undeclared-dependency"]
    assert any(c["task"] == "4" and "1 -> 4" in c["edge"]
               and "undeclared" in c["note"].lower() for c in findings)


def test_interface_edge_requires_exact_token_match(tmp_path):
    plan = tmp_path / "nearmiss-iface.md"
    plan.write_text(
        "# Plan: Near-miss interface\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: producer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n"
        "**Interfaces:**\n- Produces: `User`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: near consumer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `b.py`\n\n"
        "**Interfaces:**\n- Consumes: `Users`\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "interface" for e in out["dag_edges"])
    assert not any(c.get("kind") == "undeclared-dependency"
                   for c in out["marker_conflicts"])
    assert out["waves"] == [["1", "2"]]


def test_interface_edge_covered_by_marker_emits_no_finding(tmp_path):
    plan = tmp_path / "covered-iface.md"
    plan.write_text(
        "# Plan: Covered interface\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: producer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n"
        "**Interfaces:**\n- Produces: `User` dataclass\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: declared consumer\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `b.py`\n\n"
        "**Interfaces:**\n- Consumes: `User` dataclass (id, name)\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "interface"} in out["dag_edges"]
    assert not any(c.get("kind") == "undeclared-dependency"
                   for c in out["marker_conflicts"])
    assert out["waves"] == [["1"], ["2"]]


# ---------------------------------------------------------------------------
# Task 1 (grammar-hardening plan, issue #85): interface placeholders parse as
# empty; symbol-list violations. 2026-07-03 foreign-run regression: a
# 'Produces: nothing' / 'Consumes: nothing' pairing fabricated an interface
# edge (and an undeclared-dependency finding) out of pure authoring prose,
# wasting a wave. Placeholder Consumes/Produces values must never pair.
# ---------------------------------------------------------------------------

PLACEHOLDER_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Cleanup

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `data/fixtures.json`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (test-data-only change)

- [ ] **Step 1: do it**

### Task 2: Leaf A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing (standalone)
- Produces: `helper_a() -> str`

- [ ] **Step 1: do it**

### Task 3: Leaf B

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/b.py`

**Interfaces:**
- Consumes: none
- Produces: `helper_b() -> str`

- [ ] **Step 1: do it**
"""


def test_placeholder_interfaces_produce_zero_edges():
    # 2026-07-03 foreign-run regression: 'Produces: nothing' paired with
    # 'Consumes: nothing' created two spurious edges and a wasted wave.
    out = compile_plan_text(PLACEHOLDER_PLAN)
    interface_edges = [e for e in out["dag_edges"] if e.get("why") == "interface"]
    assert interface_edges == []


def test_placeholder_interfaces_emit_no_undeclared_dependency():
    out = compile_plan_text(PLACEHOLDER_PLAN)
    assert not [c for c in out.get("marker_conflicts", [])
                if c.get("kind") == "undeclared-dependency"]


def test_all_three_tasks_share_wave_one():
    out = compile_plan_text(PLACEHOLDER_PLAN)
    assert sorted(out["waves"][0]) == ["1", "2", "3"]


def test_placeholder_token_set():
    from compile_plan import _interface_token
    for raw in ("nothing", "none", "N/A", "nothing (test-data-only change)",
                "`nothing`", "none — standalone"):
        assert _interface_token(raw) == "", raw
    assert _interface_token("`User` dataclass (id: int)") == "User"
    assert _interface_token("validate_payload(payload) -> list[str]") == "validate_payload"


def test_symbol_lead_with_prose_tail_still_tokens():
    # The tokenizer hardening (#85 redirect): a SYMBOL lead tokens (a backticked
    # symbol, any prose tail allowed; or a bare identifier alone / immediately
    # followed by a `(`-signature, `->`, or `=`), but a bare word followed by
    # more prose words is documentation and can never pair.
    from compile_plan import _interface_token
    assert _interface_token("`User` dataclass (id, name)") == "User"
    assert _interface_token("compiler `**Review:**` marker semantics") == ""
    assert _interface_token("validate_payload(payload) -> list[str]") == "validate_payload"
    assert _interface_token("every task object in the file carries a key") == ""


PROSE_INTERFACE_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Bake the reviewer prompt

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `harnesses/waves.js`

**Interfaces:**
- Consumes: nothing
- Produces: the baked reviewer prompt instructs regenerate-and-byte-compare

- [ ] **Step 1: do it**

### Task 2: Rework the reviewer source

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `references/reviewer-prompts.md`

**Interfaces:**
- Consumes: the reviewer-prompt source layout
- Produces: `helper() -> str`

- [ ] **Step 1: do it**
"""


def test_prose_interfaces_never_pair():
    # 2026-07-03 live incident (this cycle's redirect round): a leading bare
    # word 'the' tokenized identically across two prose Interfaces values, so
    # 'Produces: the baked reviewer prompt …' paired 'Consumes: the reviewer-
    # prompt source layout …' into a spurious interface edge that over-serialized
    # a real run. Prose contract descriptions are this repo's house style; they
    # must be structurally inert — zero interface edges, zero undeclared-
    # dependency findings.
    out = compile_plan_text(PROSE_INTERFACE_PLAN)
    assert [e for e in out["dag_edges"] if e.get("why") == "interface"] == []
    assert [c for c in out["marker_conflicts"]
            if c.get("kind") == "undeclared-dependency"] == []


# ---------------------------------------------------------------------------
# Strict Files grammar (#85): annotations, unknown labels, and globs are loud
# violations. An annotated Files line contributes NOTHING silently — it always
# surfaces with the extracted-path fix, so a same-wave write race can never hide
# behind a parenthetical (2026-07-03 foreign run: the two most contended files
# silently lost overlap coverage).
# ---------------------------------------------------------------------------

ANNOTATED_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Shared file owner

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/lib/db.js` (only the pool init, lines 12-40)

- [ ] **Step 1: do it**

### Task 2: Other writer

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/lib/db.js`

- [ ] **Step 1: do it**
"""


def test_annotated_files_line_is_a_violation_with_extract_fix():
    from compile_plan import _files_violations
    v = _files_violations({"id": "1", "files_raw": [
        ("Modify", "`src/lib/db.js` (only the pool init, lines 12-40)")]})
    assert len(v) == 1
    assert "src/lib/db.js" in v[0]          # the extracted path is shown
    assert "annotation" in v[0].lower()      # named for what it is


def test_unknown_label_is_a_violation_with_did_you_mean():
    from compile_plan import _files_violations
    v = _files_violations({"id": "3", "files_raw": [("Delete", "`old/x.py`")]})
    assert len(v) == 1 and "Modify" in v[0]


def test_glob_is_a_violation():
    from compile_plan import _files_violations
    v = _files_violations({"id": "4", "files_raw": [("Modify", "`src/**/*.py`")]})
    assert len(v) == 1 and "enumerate" in v[0].lower()


def test_annotated_line_fails_plain_compile_loudly():
    # front-door: plain compile on a violating plan is a loud error, not a silent
    # overlap drop (#85). Adapted to the subprocess helper (compile_raw_text):
    # SystemExit surfaces as a non-zero exit with the path on stderr.
    r = compile_raw_text(ANNOTATED_PLAN)
    assert r.returncode != 0
    assert "src/lib/db.js" in r.stderr


def test_canonical_files_block_compiles_clean():
    # The strict gate must not fire on a canonical block: bare labels, backticked
    # paths, no annotation. Multiple backticked paths on one bullet and the
    # `- none` empty declaration both stay legal.
    plan = """# P

**Acceptance:** suite — test

### Task 1: writer

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/a.py`
- Modify: `src/b.py`

- [ ] **Step 1: do it**

### Task 2: gate

**Type:** gate

**Files:**
- None

- [ ] run pytest
"""
    out = compile_plan_text(plan)
    assert not [c for c in out["marker_conflicts"] if "annotation" in c["note"].lower()]
    assert "src/a.py" in {f for t in out["tasks"] for f in t["writes"]}


# ---------------------------------------------------------------------------
# Task 2: Files-label coverage (fixtures / bulleted None / dotfiles) +
# empty-writes build/QA -> gate classification (issue #65 family)
# ---------------------------------------------------------------------------

def test_files_parser_accepts_fixture_label_none_and_dotfiles():
    # Title line first so compile_plan_text's waiver injection (after line 0)
    # lands at plan level, not inside Task 1's marker header block.
    plan = '''# Plan: fixture/dotfile coverage

### Task 1: Build
**Type:** implementation

**Files:**
- Modify: `.gitignore`
- Test fixture(s): `evals/fixtures/x/plan.md`

- [ ] step
'''
    out = compile_plan_text(plan)
    t1 = {t["id"]: t for t in out["tasks"]}["1"]
    assert ".gitignore" in t1["writes"]
    assert "evals/fixtures/x/plan.md" in (t1["writes"] + t1.get("reads", []))
    assert not any("ignored" in c["note"] or "near" in c["note"].lower()
                   for c in out["marker_conflicts"] if c.get("task") == "1")


def test_bulleted_none_in_files_is_not_a_conflict():
    plan = '''# Plan: bulleted none

### Task 1: Verify
**Type:** gate

**Files:**
- None

- [ ] run pytest
'''
    out = compile_plan_text(plan)
    assert not any(c.get("task") == "1" for c in out["marker_conflicts"])


def test_empty_writes_buildqa_task_classifies_as_gate():
    plan = '''# Plan: empty-writes build/QA gate

### Task 1: Build the bundle
**Type:** implementation

**Files:**
- Create: `src/a.py`

- [ ] write code

### Task 2: Final verification
**Files:**
- None

- [ ] Run the full build and the QA acceptance check.
'''
    out = compile_plan_text(plan)
    t2 = {t["id"]: t for t in out["tasks"]}["2"]
    assert t2["disposition"] == "gate"
    assert "2" in out["gates"]
    assert "2" not in [e["to"] for e in out["dag_edges"] if e.get("why", "").startswith("ambiguous")]


# ---------------------------------------------------------------------------
# Task 3: compiler diagnostics — description-inferred edge class, 0-markers
# flag, gate-heading boundary.
# (A `# Plan: …` title line precedes each marked plan so compile_plan_text's
# waiver injection — after line 0 — lands at plan level, not inside Task 1's
# marker header block; this mirrors the convention used throughout this file.)
# ---------------------------------------------------------------------------

def test_description_inferred_edge_has_distinct_kind():
    plan = '''# Plan: description-inferred edge

### Task 1: Ledger
**Type:** implementation

**Files:**
- Create: `merge_ledger.py`

- [ ] write it

### Task 2: Reader
**Type:** implementation

**Files:**
- Create: `reader.py`

**Interfaces:**
- Produces: a reader that complements `merge_ledger.py` by role.

- [ ] write it
'''
    out = compile_plan_text(plan)
    desc_edges = [c for c in out["marker_conflicts"] if c.get("kind") == "description-inferred"]
    assert desc_edges, "a backticked filename in a description must warn as description-inferred"


def test_zero_markers_plan_flags_all_heuristic():
    plan = '''# Plan: zero markers

### Task 1: A
**Files:**
- Create: `a.py`

- [ ] do

### Task 2: B
**Files:**
- Create: `b.py`

- [ ] do
'''
    out = compile_plan_text(plan)
    assert out["allHeuristic"] is True
    assert any("0 markers" in c["note"] or "all dispositions inferred" in c["note"]
               for c in out["marker_conflicts"])


def test_non_task_gate_heading_is_a_boundary():
    plan = '''# Plan: boundary fixture

### Task 1: Build
**Type:** implementation

**Files:**
- Create: `a.py`

- [ ] do

## Final Gate
**Type:** gate
**Depends-on:** 1

- [ ] run pytest
'''
    out = compile_plan_text(plan)
    # the gate heading's markers must NOT fold into Task 1 as stray-marker conflicts
    assert not any(c.get("task") == "1" and "outside the header block" in c["note"]
                   for c in out["marker_conflicts"])


def test_bare_none_files_entry_is_silent():
    """A gate task whose `**Files:**` block is only `- None` is an explicit
    empty-Files declaration: it must contribute no writes and raise no near-miss
    / marker_conflicts entry for the `- None` line ([76c7ef053adbf62e], #65)."""
    plan = '''# Plan: bare None Files

### Task 1: Build the module
**Type:** implementation

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** write a

### Task 2: Suite gate
**Type:** gate

**Files:**
- None

- [ ] **Step 1:** run the full pytest suite
'''
    out = compile_plan_text(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # The gate task's bare `- None` Files block contributes no writes ...
    assert by_id["2"]["writes"] == []
    # ... and surfaces no near-miss / marker_conflicts entry for that line.
    assert not any(c.get("task") == "2" for c in out["marker_conflicts"])
    assert not any(
        "None" in (c.get("note", "") + c.get("edge", ""))
        for c in out["marker_conflicts"])


def test_uppercase_extension_paths_serialize_same_file_writers(tmp_path):
    """Fable review HIGH finding: `Config.YAML` (uppercase ext, no slash) was
    dropped from write-sets, so two tasks modifying it waved in parallel."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Upper\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: writer one\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Config.YAML`\n- Modify: `a_only.py`\n\n"
        "- [ ] **Step 1:** edit config\n\n"
        "### Task B: writer two\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Config.YAML`\n- Modify: `b_only.py`\n\n"
        "- [ ] **Step 1:** edit config again\n")
    out = compile_plan(plan)
    a = next(t for t in out["tasks"] if t["id"] == "A")
    b = next(t for t in out["tasks"] if t["id"] == "B")
    assert "Config.YAML" in a["writes"] and "Config.YAML" in b["writes"]
    assert any(e["from"] == "A" and e["to"] == "B" and e["why"] == "write-after-write"
               for e in out["dag_edges"])
    assert out["waves"] == [["A"], ["B"]]


def test_mixed_case_attr_ref_still_dropped_from_files(tmp_path):
    """`schema.User` in a Files entry is an identifier, not a path — it must
    stay dropped, or it fabricates overlap edges."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Attr\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: uses attr ref\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `schema.User`\n- Modify: `real.py`\n\n"
        "- [ ] **Step 1:** work\n")
    out = compile_plan(plan)
    a = next(t for t in out["tasks"] if t["id"] == "A")
    assert a["writes"] == ["real.py"]


def test_prose_section_heading_with_task_word_and_colon_compiles(tmp_path):
    """Fable review MEDIUM finding: `## Task tracking: overview` refused the
    whole plan with a misleading three-hashes hint."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Sections\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: real work\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `a.py`\n\n- [ ] **Step 1:** work\n\n"
        "## Task tracking: overview\n\nprose about tracking\n\n"
        "## Task list: what remains\n\nmore prose\n")
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A"]


def test_wrong_level_task_id_heading_still_refuses(tmp_path):
    """The heading net must keep catching genuinely mis-leveled task headings —
    `## Task 2:` folds its content into the previous task silently."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Bad level\n\n**Acceptance:** waived — inline\n\n"
        "### Task 1: real work\n\n**Files:**\n- Modify: `a.py`\n\n"
        "- [ ] **Step 1:** work\n\n"
        "## Task 2: mis-leveled\n\n**Files:**\n- Modify: `b.py`\n\n"
        "- [ ] **Step 1:** more work\n")
    p = compile_plan_raw(plan)
    assert p.returncode != 0
    assert "not recognized" in p.stderr


def test_global_constraints_stop_at_first_task_heading(tmp_path):
    """Found at launch of this very plan: a `## Global Constraints` section
    followed directly by `### Task` headings swallowed the entire rest of the
    document (54KB) into globalConstraints — which the engine then appends to
    every implementer/reviewer prompt."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: GC\n\n**Acceptance:** waived — inline\n\n"
        "## Global Constraints\n\n- Rule one.\n- Rule two.\n\n---\n\n"
        "### Task A: work\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `a.py`\n\n- [ ] **Step 1:** do it\n")
    out = compile_plan(plan)
    gc = out["globalConstraints"]
    assert "Rule one." in gc and "Rule two." in gc
    assert "Task A" not in gc and "Step 1" not in gc


def test_emit_args_writes_complete_launch_skeleton(tmp_path):
    launch = tmp_path / "waves.json"
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-launch", str(launch),
                               "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    skel = json.loads(argsf.read_text())
    assert skel["waves"] == out["launch_waves"]
    assert skel["wavesPath"] == str(launch.resolve())
    assert skel["edges"] == [[e["from"], e["to"]] for e in out["dag_edges"]]
    assert skel["dependencyEdges"] == [
        f"{e['from']} -> {e['to']} ({e['why']})" for e in out["dag_edges"]]
    assert skel["acceptance"] == out["acceptance"]
    assert skel["globalConstraints"] == out["globalConstraints"]
    assert pathlib.Path(skel["planPath"]).is_absolute()
    assert out["args_file"] == str(argsf)


def test_emit_args_requires_emit_launch(tmp_path):
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-args", str(argsf)])
    assert p.returncode != 0
    assert "--emit-args requires --emit-launch" in (p.stderr + p.stdout)
    assert not argsf.exists()


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def test_emit_args_pre_emits_knob_slots(tmp_path):
    """Per-task knob slots ride the args wave entries — the object waves.js
    actually reads (#89: launch-file slots were filled but never consumed).
    tier is a null slot the orchestrator fills; review is plan-authored."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    skel = json.loads(args.read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries, "no wave entries emitted"
    for t in entries:
        assert "tier" in t and t["tier"] is None
        assert t["review"] == "lean"


def test_emit_launch_carries_no_knob_slots(tmp_path):
    """The launch file is bodies + context only. A tier/review key here is
    the dual channel regrowing — the exact defect #89 removed."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    payload = json.loads(launch.read_text())
    assert payload["tasks"], "no tasks emitted"
    for t in payload["tasks"]:
        assert "tier" not in t and "review" not in t


# ---------------------------------------------------------------------------
# **Review:** marker (#87) — authored review-depth slot, pre-emitted like tier
# ---------------------------------------------------------------------------

REVIEW_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Risky core

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Quiet follower

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""


def _emit_launch_payload(tmp_path, plan_markdown, name="plan.md"):
    """Write plan_markdown to tmp_path and compile it with --emit-launch,
    returning the parsed launch-file payload. Asserts a clean compile —
    callers that expect a compile error use _compile_raw instead."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / "launch.json"
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch)])
    assert p.returncode == 0, p.stderr
    return json.loads(launch.read_text())


def _emit_args_entries(tmp_path, plan_markdown, name="plan.md"):
    """Compile plan_markdown with --emit-launch/--emit-args and return the
    args skeleton's wave entries keyed by task id — the knob channel the
    engine reads (#89). Asserts a clean compile."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / "launch.json"
    argsf = tmp_path / "args.json"
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch), "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    skel = json.loads(argsf.read_text())
    return {t["id"]: t for wave in skel["waves"] for t in wave}


def _compile_raw(tmp_path, plan_markdown, name="plan.md"):
    """Write plan_markdown to tmp_path and run the compiler, returning the
    completed subprocess (non-zero exit allowed, not checked here)."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    return sh([sys.executable, str(COMPILER), str(plan)], check=False)


def test_review_marker_emits_adversarial_slot(tmp_path):
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["1"]["review"] == "adversarial"


def test_unmarked_task_emits_lean_review_slot(tmp_path):
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["2"]["review"] == "lean"


def test_invalid_review_value_is_a_compile_error(tmp_path):
    bad = REVIEW_PLAN.replace("**Review:** adversarial", "**Review:** paranoid")
    p = _compile_raw(tmp_path, bad, name="bad.md")
    assert p.returncode != 0
    assert "Task 1" in p.stderr and "adversarial" in p.stderr and "lean" in p.stderr


def test_duplicate_review_marker_is_a_compile_error(tmp_path):
    dup = REVIEW_PLAN.replace(
        "**Review:** adversarial",
        "**Review:** adversarial\n**Review:** lean")
    p = _compile_raw(tmp_path, dup, name="dup.md")
    assert p.returncode != 0
    assert "duplicate" in p.stderr.lower() and "Task 1" in p.stderr


# ---------------------------------------------------------------------------
# Task 3 (grammar-hardening plan, issue #85): the catch-all Files construct.
# `- catch-all: <prose>` declares an open write set the author cannot
# enumerate as concrete paths — the task must never share a wave with any
# other implementation task, and more than one bullet per task is a
# violation.
# ---------------------------------------------------------------------------

CATCHALL_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Independent A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Re-pointer sweep

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `docs/manual.md`
- catch-all: any doc-pinning test the full suite shows red — reconcile each pin preserving its semantics

- [ ] **Step 1: do it**

### Task 3: Independent B

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""


def test_catch_all_parses_and_is_not_a_violation():
    out = compile_plan_text(CATCHALL_PLAN)  # compiles loudly-clean
    assert out is not None


def test_catch_all_task_never_shares_a_wave():
    # 2026-07-03 home-run regression: a catch-all task was safe only because
    # it happened to ride the serial tail; now it is serial by construction.
    out = compile_plan_text(CATCHALL_PLAN)
    for wave in out["waves"]:
        if "2" in wave:
            assert wave == ["2"]


def test_second_catch_all_bullet_is_a_violation():
    doubled = CATCHALL_PLAN.replace(
        "- catch-all: any doc-pinning test",
        "- catch-all: one thing\n- catch-all: any doc-pinning test")
    r = compile_raw_text(doubled)
    assert r.returncode != 0
    # Specifically the "more than one" diagnosis, not just any mention of the
    # word "catch-all" (a bare unrecognized bullet would ALSO mention the
    # literal label name, which would make this pass for the wrong reason).
    assert "more than one catch-all" in r.stderr.lower()


def test_catch_all_conflict_edges_are_labeled():
    out = compile_plan_text(CATCHALL_PLAN)
    assert any(e.get("why") == "catch-all" for e in out["dag_edges"])


def test_catch_all_surfaces_in_emitted_launch_task(tmp_path):
    payload = _emit_launch_payload(tmp_path, CATCHALL_PLAN, name="catchall.md")
    by_id = {t["id"]: t for t in payload["tasks"]}
    assert by_id["2"]["catchAll"] == (
        "any doc-pinning test the full suite shows red — reconcile each pin "
        "preserving its semantics")
    assert by_id["1"]["catchAll"] is None


def test_catch_all_bullet_parses_into_task_dict():
    from compile_plan import split_tasks, parse_task
    plan = """### Task 1: X

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `a.py`
- catch-all: reconcile every red pin

- [ ] **Step 1: do it**
"""
    t = parse_task(split_tasks(plan)[0])
    assert t["catch_all"] == "reconcile every red pin"
    assert t["catch_all_raw"] == ["reconcile every red pin"]


def test_files_violations_flags_second_catch_all_bullet():
    from compile_plan import _files_violations
    v = _files_violations({"id": "2", "catch_all_raw": ["one thing", "two thing"]})
    assert len(v) == 1 and "catch-all" in v[0].lower()


def test_files_violations_allows_single_catch_all_bullet():
    from compile_plan import _files_violations
    v = _files_violations({"id": "2", "catch_all_raw": ["one thing"], "files_raw": []})
    assert v == []
