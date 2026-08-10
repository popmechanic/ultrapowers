"""Closed-form makespans, fold replay, and structural bisection."""
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import schedule_model as sm

DUR = {"1": 10.0, "2": 20.0, "3": 5.0, "4": 8.0}


def test_waves_makespan_sum_of_maxima():
    waves = [["1", "3"], ["2"], ["4"]]
    assert sm.waves_makespan(waves, DUR) == 10.0 + 20.0 + 8.0


def test_frontier_makespan_is_critical_path():
    edges = [{"from": "1", "to": "2", "why": "marker"},
             {"from": "3", "to": "4", "why": "marker"}]
    # chains: 1->2 = 30, 3->4 = 13
    assert sm.frontier_makespan(["1", "2", "3", "4"], edges, DUR) == 30.0


def test_drop_same_file_edges():
    edges = [{"from": "1", "to": "2", "why": "marker"},
             {"from": "1", "to": "2", "why": "write-after-write"},
             {"from": "3", "to": "4", "why": "ambiguous-files"},
             {"from": "3", "to": "4", "why": "write-after-create"}]
    kept = sm.drop_same_file_edges(edges)
    assert [e["why"] for e in kept] == ["marker"]


def test_fold_all_uses_order_and_collects_conflicts():
    calls = []

    def fake_fold(base, frontier, task):
        calls.append(task)
        return frontier + [task], (["c-" + task] if task == "bad" else [])

    frontier, conflicts = sm.fold_all(fake_fold, [], ["a", "bad", "b"], [2, 0, 1])
    assert calls == ["b", "a", "bad"]
    assert frontier == ["b", "a", "bad"]
    assert conflicts == ["c-bad"]


def test_sampled_orders_small_is_exhaustive_large_is_seeded():
    assert len(sm.sampled_orders(3)) == 6
    big = sm.sampled_orders(10)
    assert len(big) == 20
    assert list(range(10)) in big
    assert big == sm.sampled_orders(10)  # deterministic


def test_bisect_single_finds_culprit_within_log_bound():
    # Elements are deliberately NOT their own indices, and n=13 is not a power
    # of two — both guard the contract (elements returned, bound still holds).
    tasks = ["t%d" % i for i in range(13)]
    culprit = "t11"

    probes_seen = []

    def is_red(subset):
        probes_seen.append(list(subset))
        return culprit in subset

    found, probes = sm.bisect_single(tasks, is_red)
    assert found == culprit
    assert probes == len(probes_seen)  # self-reported count matches reality
    assert probes <= math.ceil(math.log2(len(tasks)))


def test_isolate_min_set_pairwise():
    # dict elements: unhashable-in-sets is fine, but they are NOT order-
    # comparable, so this also guards the no-sorting contract.
    tasks = [{"id": i} for i in range(8)]
    pair = [{"id": 2}, {"id": 5}]

    probes_seen = []

    def is_red(subset):
        probes_seen.append(1)
        return all(p in subset for p in pair)

    found, probes = sm.isolate_min_set(tasks, is_red)
    assert found == pair  # input order preserved
    assert probes == len(probes_seen)
    assert probes > 0
