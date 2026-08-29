#!/usr/bin/env python3
"""Fold-on-completion engine for the frontier production test (spec
2026-08-11, component 3). Pure state machine: no subprocesses, no kit
plumbing. The cell driver owns dispatch; this module owns merge state.

Invariants it enforces (pinned by tests/test_frontier_fold.py and
tests/test_rehydrate.py):
* the event log is the durable record: replay(base, tasks, events)
  reproduces the manifest deterministically, and rehydrate(repo, log)
  rebuilds the whole engine — epoch, touched map, events, manifest — from
  git plus the log alone (schema in kernel/FOLD_LOG.md);
* application validity: a resolution computed from a narration applies only
  if no intervening fold touched its path since the narration's epoch —
  live only; recorded resolutions re-apply unconditionally;
* the dispatch predicate: resolver-eligibility is annotated narration present
  and text manifest content — everything else parks with a named reason.
"""
import json
import random
import sys
from itertools import permutations
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw


def sampled_orders(n, seed=42):
    """All permutations of range(n) up to 4 elements; 20 seeded samples (the
    identity order plus 19 shuffles) above that. Moved from the eval-only
    schedule_model module: this is a generic fold-order sampler, not modeling
    logic, so the kernel owns it and schedule_model imports it back."""
    if n <= 4:
        return [list(p) for p in permutations(range(n))]
    rng = random.Random(seed)
    orders = [list(range(n))]
    while len(orders) < 20:
        o = list(range(n))
        rng.shuffle(o)
        orders.append(o)
    return orders


def fold_all(fold_fn, base, tasks, order):
    """Fold `tasks` (indexed by `order`) into `base` via `fold_fn`, threading
    the accumulating frontier and collecting every conflict along the way."""
    frontier, conflicts = base, []
    for i in order:
        frontier, cs = fold_fn(base, frontier, tasks[i])
        conflicts.extend(cs)
    return frontier, conflicts


def _resolved_state(frontier, path, lines):
    """Whole-file-in / whole-file-out: replace `path`'s visible lines.

    `lines` are already the kernel's own line list — the resolver's reply
    bytes are split by `rw.split_lines`, so exactly one normalization exists
    on that path and none is repeated here (`_visible` was the identity under
    the bijection and is deleted; spec 2026-08-12 §2).
    """
    files = dict(frontier.files)
    prior = files.get(path, manyana.initial_state([]))
    files[path] = manyana.update_state(prior, list(lines))
    return rw.RepoState(files=files,
                        deleted_marks=frontier.deleted_marks,
                        raw=dict(frontier.raw),
                        raw_candidates=dict(frontier.raw_candidates))


class FrontierEngine:
    """Folds tasks into a frontier as they complete, recording every step."""

    def __init__(self, base):
        self.base = base
        self.frontier = base
        self.events = []            # [{"type": "fold", "task": id} |
                                    #  {"type": "resolve", "path": p,
                                    #   "epoch": n, "lines": [...]}]
        self._touched_at = {}       # path -> last event index that folded or resolved it

    def epoch(self):
        """The event count. Capture it BEFORE reading a narration."""
        return len(self.events)

    def fold(self, task):
        """Fold one completed task; returns its per-fold pre-dedupe stream."""
        self.frontier, conflicts = rw.fold(self.base, self.frontier, task)
        idx = len(self.events)
        self.events.append({"type": "fold", "task": task.task_id})
        for p in set(task.weaves) | set(task.raw) | set(task.deleted):
            self._touched_at[p] = idx
        return conflicts

    def apply_resolution(self, path, epoch, lines):
        """Apply a resolution narrated at `epoch`; False = stale, re-narrate.

        Folds AND applied resolutions invalidate: a resolution records itself
        in `_touched_at`, so a second same-path resolution whose narration was
        captured before this one applied is refused rather than silently
        overwriting it (#143 — reachable from 3+ contenders on one path, where
        two narrations can be in flight against the same frontier state). The
        refusal routes through the same re-narrate leg an intervening fold
        does.
        """
        if self._touched_at.get(path, -1) >= epoch:
            return False            # an intervening fold or resolution touched the path
        self.frontier = _resolved_state(self.frontier, path, lines)
        self.events.append({"type": "resolve", "path": path,
                            "epoch": epoch, "lines": list(lines)})
        self._touched_at[path] = len(self.events) - 1
        return True

    def manifest(self):
        return rw.manifest(self.frontier)


def _apply_events(eng, states, events):
    """Walk a recorded event list into `eng` — the only event walk there is.
    `rehydrate` (from git) and `replay` (from memory) differ only in how they
    build `eng` and `states`, so the two cannot drift.

    Validity is never re-checked: the log records what actually applied, and
    re-running `apply_resolution`'s staleness check would silently drop a
    recorded resolution. Resolve events ARE appended to the engine's event
    list, so the epoch clock reconstructs exactly — and they update
    `_touched_at` exactly as a live `apply_resolution` does, so a rebuilt
    engine refuses a stale stacked resolution the same way a live one would
    (#143: `cmd_resolve` rehydrates per dispatch; without this, the replayed
    map held fold indexes only). `base` events are inert.
    """
    for e in events:
        kind = e["type"]
        if kind == "base":
            continue
        if kind == "fold":
            eng.fold(states[e["task"]])
        elif kind == "resolve":
            eng.frontier = _resolved_state(eng.frontier, e["path"], e["lines"])
            eng.events.append({"type": "resolve", "path": e["path"],
                               "epoch": e["epoch"], "lines": list(e["lines"])})
            eng._touched_at[e["path"]] = len(eng.events) - 1
        else:
            raise ValueError("unknown fold-log event type: %r" % (kind,))
    return eng


def _union_touched(repo, base_sha, heads):
    """The union of every head's touched paths, derived BEFORE any fold.

    The ordering contract (spec 2026-08-12 §2): a per-task streaming scope
    would misclassify a path another task later touches as an add/add instead
    of a modify, because `task_state_from_contents` branches on membership in
    the base.
    """
    touched = set()
    for head in heads:
        touched.update(rw.diff_paths(repo, base_sha, head))
    return touched


def rehydrate(repo, log_path):
    """Rebuild a live FrontierEngine from git + the fold log.

    `fold` events re-publish their task from its recorded `headSha` (a pure
    function of git objects) and re-fold it, which also reconstructs the
    touched-path map; `resolve` events re-apply their recorded lines
    unconditionally. The log plus the repo are the whole record — the wave's
    CLI invocations carry nothing in memory between them.

    A fold event that carries `patch` (patch input, Amendment 9) is
    re-derived from that file over the base — the tree it yields is
    unreferenced in the object store and could be pruned, so the file is the
    durable record — and REFUSED (`ValueError`) if it no longer yields the
    recorded `headSha`: a patch edited after it folded would otherwise
    rehydrate into a frontier the log never described.
    """
    log_path = Path(log_path)
    events = [json.loads(line)
              for line in rw.split_lines(log_path.read_text()) if line.strip()]
    if not events or events[0].get("type") != "base":
        raise ValueError("fold log %s does not open with a base event" % log_path)
    base_sha = events[0]["sha"]
    task_heads = []
    for e in events:
        if e["type"] != "fold":
            continue
        if e.get("patch"):
            tree = rw.apply_patch_tree(repo, base_sha, e["patch"])
            if tree != e["headSha"]:
                raise ValueError(
                    "fold log records task %s at tree %s but its patch %s now "
                    "yields %s — the patch changed after it folded"
                    % (e["task"], e["headSha"][:7], e["patch"], tree[:7]))
        task_heads.append((e["task"], e["headSha"]))
    base = rw.snapshot_scoped(repo, base_sha,
                              _union_touched(repo, base_sha,
                                             [h for _, h in task_heads]))
    states = {tid: rw.publish(base, repo, base_sha, head, task_id=tid)
              for tid, head in task_heads}
    return _apply_events(FrontierEngine(base), states, events)


def replay(base, tasks_by_id, events):
    """Re-run the exact recorded sequence from in-memory inputs; the return
    must equal the live manifest (G2's event-log leg). A thin wrapper over the
    same event walk `rehydrate` uses."""
    return _apply_events(FrontierEngine(base), tasks_by_id, events).manifest()


def raw_shuffle_outcomes(base, tasks, sample_seed):
    """Live-K1 leg 1: shuffled raw folds (resolutions excluded) must be
    outcome-identical to each other; set-based conflict keys per #132."""
    outcomes = set()
    for order in sampled_orders(len(tasks), seed=sample_seed):
        frontier, conflicts = fold_all(rw.fold, base, tasks, order)
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(sorted({(c.path, c.kind) for c in conflicts}))))
    return outcomes


def dispatchable(conflict, manifest):
    """(ok, park_reason). Resolver-eligible iff the narration carries
    manyana's annotated conflict block AND the file is text.

    Two terms, no size term: the resolver line cap retired with spec 2026-08-18
    §1d. The cap existed because the kernel's merge walk blew the main
    thread's stack on a large file; `fold_wave.run_on_kernel_thread` gives
    that walk a 1 GiB stack instead, so size no longer decides what a
    resolver may be briefed on. A residual `RecursionError` is still caught
    into a named kernel-limit park — the only ceiling left.
    """
    if not any(line.startswith(rw.MARKERS)
               for line in rw.split_lines(conflict.narration)):
        return False, "no annotated narration for %s (%s)" % (conflict.path,
                                                              conflict.kind)
    body = manifest.get(conflict.path)
    if not isinstance(body, str):
        return False, "non-text manifest content for %s" % conflict.path
    return True, ""
