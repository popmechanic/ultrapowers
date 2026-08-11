#!/usr/bin/env python3
"""Fold-on-completion engine for the frontier production test (spec
2026-08-11, component 3). Pure state machine: no subprocesses, no kit
plumbing. The cell driver owns dispatch; this module owns merge state.

Invariants it enforces (each pinned by tests/test_frontier_fold.py):
* the event log is the durable record: replay(base, tasks, events)
  reproduces the manifest deterministically;
* application validity: a resolution computed from a narration applies only
  if no intervening fold touched its path since the narration's epoch;
* the dispatch predicate: only annotated-block narrations, <= 400 visible
  lines, are resolver-eligible — everything else parks with a named reason.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw
import schedule_model as sm

RESOLVER_LINE_CAP = 400


def _visible(lines):
    """A resolver's `resolvedFileLines` -> the weave's visible-line list.

    The contract says "no trailing-newline entries", but a whole-file reply
    built by splitting text on "\\n" carries one anyway. Normalizing through
    `repo_weave`'s own text convention (`split_lines` drops exactly one
    trailing newline) makes both spellings mean the same file and keeps a
    genuinely blank final line expressible as two trailing entries.
    """
    return rw.split_lines("\n".join(lines))


def _resolved_state(frontier, path, lines):
    """Whole-file-in / whole-file-out: replace `path`'s visible lines."""
    files = dict(frontier.files)
    prior = files.get(path, manyana.initial_state([]))
    files[path] = manyana.update_state(prior, _visible(lines))
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
        self._touched_at = {}       # path -> last event index that folded it

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

        Only folds invalidate: a resolution is dispatched serially (at most
        one in flight), so no other resolution can have landed on the path
        between this narration and its application.
        """
        if self._touched_at.get(path, -1) >= epoch:
            return False            # an intervening fold touched the path
        self.frontier = _resolved_state(self.frontier, path, lines)
        self.events.append({"type": "resolve", "path": path,
                            "epoch": epoch, "lines": list(lines)})
        return True

    def manifest(self):
        return rw.manifest(self.frontier)


def replay(base, tasks_by_id, events):
    """Re-run the exact recorded sequence; the return must equal the live
    manifest (G2's event-log leg).

    Validity is not re-checked: the log records what actually applied, and
    re-deciding it here would let replay diverge from the run it replays.
    """
    eng = FrontierEngine(base)
    for e in events:
        if e["type"] == "fold":
            eng.fold(tasks_by_id[e["task"]])
        else:
            eng.frontier = _resolved_state(eng.frontier, e["path"], e["lines"])
    return eng.manifest()


def raw_shuffle_outcomes(base, tasks, sample_seed):
    """Live-K1 leg 1: shuffled raw folds (resolutions excluded) must be
    outcome-identical to each other; set-based conflict keys per #132."""
    outcomes = set()
    for order in sm.sampled_orders(len(tasks), seed=sample_seed):
        frontier, conflicts = sm.fold_all(rw.fold, base, tasks, order)
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(sorted({(c.path, c.kind) for c in conflicts}))))
    return outcomes


def dispatchable(conflict, manifest):
    """(ok, park_reason). Resolver-eligible iff the narration carries
    manyana's annotated conflict block AND the file is text under the cap."""
    if not any(line.startswith(rw.MARKERS)
               for line in conflict.narration.splitlines()):
        return False, "no annotated narration for %s (%s)" % (conflict.path,
                                                              conflict.kind)
    body = manifest.get(conflict.path)
    if not isinstance(body, str):
        return False, "non-text manifest content for %s" % conflict.path
    if len(body.splitlines()) > RESOLVER_LINE_CAP:
        return False, "%s exceeds %d visible lines" % (conflict.path,
                                                       RESOLVER_LINE_CAP)
    return True, ""
