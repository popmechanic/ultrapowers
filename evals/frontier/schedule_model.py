"""Closed-form scheduling model + generic fold replay + structural bisection."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "skills" / "ultrapowers" / "kernel"))
from frontier_fold import sampled_orders, fold_all  # noqa: E402  (promoted to the kernel; modeling-only module imports back)

SAME_FILE_WHYS = frozenset({"write-after-create", "write-after-write",
                            "ambiguous-files"})


def waves_makespan(waves, durations):
    return float(sum(max(durations[t] for t in wave) for wave in waves if wave))


def frontier_makespan(task_ids, edges, durations):
    upstream = {t: [] for t in task_ids}
    for e in edges:
        if e["from"] in upstream and e["to"] in upstream:
            upstream[e["to"]].append(e["from"])
    memo = {}

    def finish(t):
        if t not in memo:
            memo[t] = durations[t] + max((finish(u) for u in upstream[t]),
                                         default=0.0)
        return memo[t]

    return float(max(finish(t) for t in task_ids)) if task_ids else 0.0


def drop_same_file_edges(edges):
    return [e for e in edges if e["why"] not in SAME_FILE_WHYS]


def bisect_single(tasks, is_red):
    lo, hi = 0, len(tasks)
    probes = 0
    while hi - lo > 1:
        mid = (lo + hi) // 2
        probes += 1
        if is_red(tasks[lo:mid]):
            hi = mid
        else:
            lo = mid
    return tasks[lo], probes


def isolate_min_set(tasks, is_red):
    # Returns surviving ELEMENTS in input order — never sorts (elements may not
    # be order-comparable, e.g. dicts).
    current = list(tasks)
    probes = 0
    changed = True
    while changed:
        changed = False
        for t in list(current):
            trial = [x for x in current if x is not t]
            probes += 1
            if is_red(trial):
                current = trial
                changed = True
    return current, probes
