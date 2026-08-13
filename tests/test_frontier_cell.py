"""Arm-B driver seams: edge-drop via the imported constant, serial resolver
dispatch with application validity, retry->park, live-K1 legs, preflight
park (spec 2026-08-11 component 3)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "skills" / "ultrapowers" / "kernel"))
sys.path.insert(0, str(ROOT / "tests"))
import run_frontier_cell as fc
import frontier_fold as ff
import schedule_model as sm
import repo_weave as rw
from test_frontier_weave import make_base


def test_plan_schedule_drops_exactly_the_same_file_edges():
    compiled = {"tasks": [{"id": t} for t in "1234"],
                "dag_edges": [("1", "2", "write-after-write"),
                              ("1", "3", "write-after-create"),
                              ("2", "3", "ambiguous-files"),
                              ("1", "4", "marker")]}
    ready, dropped = fc.plan_schedule(compiled)
    assert set(dropped) == {("1", "2"), ("1", "3"), ("2", "3")}
    assert ready[0] == {"1", "2", "3"}          # 4 blocked by the kept marker edge
    # The rule is the imported constant, not a re-typed list:
    assert fc.EDGE_DROP is sm.SAME_FILE_WHYS


def _conflicted_engine():
    base = make_base({"cli.py": "def a(x):\n    return x\n"})
    t1 = rw.task_state_from_contents(base, "t1", {"cli.py": "def a(x):\n    return x + 1\n"})
    t2 = rw.task_state_from_contents(base, "t2", {"cli.py": "def a(x):\n    return x - 1\n"})
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    conflicts = eng.fold(t2)
    assert conflicts, "fixture must actually conflict"
    return eng, conflicts[0]


def test_resolver_contract_violation_retries_once_then_parks():
    eng, conflict = _conflicted_engine()
    calls = []
    def bad_launcher(payload):
        calls.append(payload); return "not json at all"
    outcome = fc.resolve_conflict(eng, conflict, {"t1": "body", "t2": "body"}, bad_launcher)
    assert outcome.startswith("parked:") and len(calls) == 2


def test_valid_resolution_applies_whole_file():
    eng, conflict = _conflicted_engine()
    lines = ["def a(x):", "    return x  # resolved", ""]
    def launcher(payload):
        assert set(payload) >= {"path", "kind", "narration", "planBodies"}
        return json.dumps({"resolvedFileLines": lines})
    assert fc.resolve_conflict(eng, conflict, {"t1": "b", "t2": "b"}, launcher) == "applied"
    assert "resolved" in eng.manifest()["cli.py"]


def test_stale_resolution_renarrates():
    eng, conflict = _conflicted_engine()
    base = eng.base
    t3 = rw.task_state_from_contents(base, "t3", {"cli.py": "def a(x):\n    return 9\n"})
    seen = []
    def launcher(payload):
        if not seen:                 # first call: fold lands mid-flight
            eng.fold(t3)
        seen.append(payload["narration"])
        return json.dumps({"resolvedFileLines": ["def a(x):", "    return 0", ""]})
    outcome = fc.resolve_conflict(eng, conflict, {"t1": "b", "t2": "b", "t3": "b"}, launcher)
    assert outcome in ("applied", "re-narrated:applied")
    assert len(seen) == 2 and seen[0] != seen[1]   # fresh narration on retry


def test_preflight_failure_parks_the_arm(tmp_path):
    def dead_launcher(payload):
        raise RuntimeError("no headless sessions here")
    assert fc.preflight(tmp_path, {}, dead_launcher) is False


# --------------------------------------------------------------------------- #
# Driver seams beyond the plan's Step-1 pins (spec §Testing)                   #
# --------------------------------------------------------------------------- #
def test_plan_schedule_scopes_to_the_compiler_waves_when_present():
    """A gate/manual task is compiled but never dispatched: the scheduled
    universe is `waves` when the compiler emitted it (contend's task 5 is a
    gate), and the task list otherwise."""
    compiled = {"tasks": [{"id": t} for t in "1234"] + [{"id": "5"}],
                "waves": [["1", "4"], ["2"], ["3"]],
                "dag_edges": [{"from": "1", "to": "2", "why": "write-after-write"},
                              {"from": "1", "to": "3", "why": "write-after-write"},
                              {"from": "2", "to": "3", "why": "write-after-write"}]}
    ready, dropped = fc.plan_schedule(compiled)
    assert ready == [{"1", "2", "3", "4"}]      # every edge dropped: no barriers
    assert set(dropped) == {("1", "2"), ("1", "3"), ("2", "3")}


def test_unannotated_conflict_parks_without_dispatching():
    """G3: the dispatch predicate is the driver's gate, so a presence-kind
    conflict never reaches the resolver and its reason is recorded."""
    eng, _ = _conflicted_engine()
    bare = rw.Conflict("cli.py", "delete/modify", "t2",
                       "path cli.py deleted concurrently with text")
    calls = []
    outcome = fc.resolve_conflict(eng, bare, {"t2": "b"}, lambda p: calls.append(p))
    assert outcome.startswith("parked:") and calls == []


def test_two_conflicted_blocks_in_one_narration_resolve_whole_file():
    base = make_base({"cli.py": "top\nA\nmid\nB\nbottom\n"})
    t1 = rw.task_state_from_contents(base, "t1", {"cli.py": "top\nA1\nmid\nB1\nbottom\n"})
    t2 = rw.task_state_from_contents(base, "t2", {"cli.py": "top\nA2\nmid\nB2\nbottom\n"})
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    conflict = eng.fold(t2)[0]
    assert conflict.narration.count("<<<<<<<") == 2
    resolved = ["top", "A12", "mid", "B12", "bottom", ""]
    log = []
    outcome = fc.resolve_conflict(eng, conflict, {"t1": "b", "t2": "b"},
                                  lambda p: json.dumps({"resolvedFileLines": resolved}),
                                  log=log)
    assert outcome == "applied"
    assert eng.manifest()["cli.py"] == "top\nA12\nmid\nB12\nbottom\n"
    assert [e["narration"] for e in log] == [conflict.narration]   # verbatim, for E2


def test_resolution_log_records_every_attempt_verbatim():
    eng, conflict = _conflicted_engine()
    log = []
    outcome = fc.resolve_conflict(eng, conflict, {"t2": "b"},
                                  lambda p: "junk", log=log)
    assert outcome.startswith("parked:")
    assert [e["reply"] for e in log] == ["junk", "junk"]
    assert [e["attempt"] for e in log] == [1, 2]


def test_plan_bodies_ride_in_marker_order():
    eng, conflict = _conflicted_engine()
    seen = {}
    def launcher(payload):
        seen.update(payload)
        return json.dumps({"resolvedFileLines": ["def a(x):", "    return x", ""]})
    fc.resolve_conflict(eng, conflict, {"t1": "BODY-1", "t2": "BODY-2"}, launcher)
    # The narration names `frontier` (already-merged work) and `t2`; only the
    # marker-named tasks' bodies ride, in the order the markers introduce them.
    assert seen["planBodies"] == ["BODY-2"]


def test_live_k1_holds_for_a_folded_run():
    base = make_base({"a.py": "A\n", "b.py": "B\n"})
    tasks = [rw.task_state_from_contents(base, "t1", {"a.py": "A1\n"}),
             rw.task_state_from_contents(base, "t2", {"b.py": "B1\n"})]
    eng = ff.FrontierEngine(base)
    for t in tasks:
        eng.fold(t)
    ok, detail = fc.live_k1(eng, tasks)
    assert ok is True
    assert detail["shuffleOutcomes"] == 1 and detail["replayMatches"] is True


def test_live_k1_reports_a_replay_mismatch():
    """The event log is the durable record: a doctored log must red the leg
    rather than pass silently."""
    base = make_base({"a.py": "A\n"})
    tasks = [rw.task_state_from_contents(base, "t1", {"a.py": "A1\n"})]
    eng = ff.FrontierEngine(base)
    eng.fold(tasks[0])
    eng.events.append({"type": "resolve", "path": "a.py", "epoch": 99,
                       "lines": ["DOCTORED"]})
    ok, detail = fc.live_k1(eng, tasks)
    assert ok is False and detail["replayMatches"] is False
