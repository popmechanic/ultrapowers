#!/usr/bin/env python3
"""fold_wave — the wave-scoped CLI over the frontier kernel (spec
2026-08-12 component 3; incremental protocol per spec 2026-08-18 §1b).

The wave's task list is re-supplied on every call as the same
`<taskId>=<branch>:<headSha>` triples, and **the fold log is the authority
for what has folded**: its `fold` events must be an `(id, headSha)` prefix of
that list over the same `base`, else the CLI refuses (`log/list
disagreement`). `remaining` is the supplied list minus that prefix;
`complete` is DERIVED, never recorded — every task folded and no narrated
path left unresolved.

`fold` runs twice over the wave. First a **park pre-scan**: the whole wave is
folded once in memory, with no log written, so a wave that is going to park
is reported before a single resolver is dispatched (the pre-scan's park set
is conservatively a superset of the incremental pass's — a text resolution
can only ever remove a marker-shaped line, never add one). If it parks, the
park entries and their reasons are all that is written. Otherwise the
incremental pass writes `base` and folds in order until the first fold that
opens a conflict, narrating that fold's conflicts (`conflict-<i>.txt`, the
kernel's annotated truth, plus the hunk-scoped brief
`conflict-<i>.hunks.txt`) into `conflicts.json` and stopping there.

`resolve --conflict <i> --reply-dir D` locates the narration by its index
`i`, grammar-checks and splices the per-hunk replies into the whole-file line
list `FrontierEngine.apply_resolution` has always taken, and applies it at
that entry's epoch. A stale epoch is a REFUSAL (exit 2), never a
re-narration: the epoch check is the idempotency guard against a re-issued
command. Once every entry of the current stop is applied, the same call
CONTINUES folding to the next stop or to completion; the two live self-checks
(K1 raw-shuffle order-independence and log-replay-reproduces-manifest) run
inside whichever call completes the wave.

`materialize` refuses anything short of a complete fold, then turns the wave
into a candidate commit through a TEMPORARY INDEX, so the worktree and every
branch ref are untouched by construction; adoption is the engine's job.

Every invocation is a fresh process: no subcommand carries anything in
memory from the last one, per the fold log's self-sufficiency contract.

Exit codes: 0 success, 2 precondition refusal (a pre-existing log, a missing
log, a log/list disagreement, a stale resolution), 3 self-check failure
(which includes a kernel recursion limit the sized bound could not absorb —
recorded as a named kernel-limit park in the conflicts index, never a crash),
4 a rejected resolver reply. For `materialize` the non-zero codes carry its
named outcomes: 2 is a park (`{"park": reason}` on stdout — a mode change on
a folded path, two creators disagreeing on a mode, or a missing fold log) and
3 a fallback (`{"fallback": reason}` — an incomplete fold, a folded path that
cannot be a regular blob, or a kernel recursion limit while rehydrating).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw
import frontier_fold as ff
import hunks

# The vendored kernel's merge walk (`merge_states` -> `state_to_tree` ->
# `pull_out_tree`/`merge_trees`/`insert_tree`) recurses once per weave-state
# entry, ~2*lines+4 frames, so Python's default 1000-frame limit is blown by
# any file over ~500 lines. A FLAT ceiling is not a fix: it just moves the
# cliff, and past it the kernel raises RecursionError from inside `fold` —
# an exit outside the documented {0,2,3} contract, with no stdout JSON for
# the engine and no artifacts at all. The bound is therefore sized from the
# corpus actually being folded and the residual is caught into a named park
# (same shape as `evals/frontier/run_eval.py`, which earned this pattern).
RECURSION_LINE_FACTOR = 4
RECURSION_MARGIN = 1000

# The only modes a folded text/bytes path can carry into the candidate tree:
# `hash-object` writes a blob, and a blob is either executable or not.
REGULAR_MODES = ("100644", "100755")
MODE_NAMES = {"120000": "a symlink", "160000": "a gitlink"}


class _recursion_headroom:
    """Widen the recursion limit to fit this wave's corpus, then restore it.

    The bound is sized from the files actually being folded, so a small wave
    pays nothing and a large one gets real headroom; the previous limit is
    always restored on the way out, whether or not a RecursionError still
    escapes despite the widened bound.
    """

    def __init__(self, max_lines):
        self.bound = max(sys.getrecursionlimit(),
                         RECURSION_LINE_FACTOR * max_lines + RECURSION_MARGIN)
        self._previous = None

    def __enter__(self):
        self._previous = sys.getrecursionlimit()
        sys.setrecursionlimit(self.bound)
        return self

    def __exit__(self, exc_type, exc, tb):
        sys.setrecursionlimit(self._previous)
        return False


def _state_max_lines(base, states):
    """Largest line count among the text files this wave folds.

    Free of git: `base.files` and every task's weaves are already in hand,
    built by the kernel's `split_lines`, and `current_lines` is iterative —
    only `merge_states` recurses, which is why publishing every task BEFORE
    the fold loop is what lets the bound be sized at all.
    """
    counts = [0]
    counts += [len(manyana.current_lines(w)) for w in base.files.values()]
    for state in states.values():
        counts += [len(manyana.current_lines(w)) for w in state.weaves.values()]
    return max(counts)


def _git_max_lines(repo, base_sha, heads):
    """Largest touched text blob, read from git — `resolve` holds no state in
    memory before `rehydrate` (which folds, and therefore recurses)."""
    per_ref = {base_sha: set()}
    for head in heads:
        touched = set(rw.diff_paths(repo, base_sha, head))
        per_ref.setdefault(head, set()).update(touched)
        per_ref[base_sha].update(touched)
    biggest = 0
    for ref, paths in per_ref.items():
        for p in sorted(paths):
            try:
                blob = rw._git(repo, "show", "%s:%s" % (ref, p))
            except subprocess.CalledProcessError:
                continue                    # absent at this ref (an add/delete)
            if rw.is_binary(blob):
                continue
            biggest = max(biggest, len(rw.split_lines(blob.decode())))
    return biggest


def _kernel_limit_entry(i, epoch, task_id, state, bound):
    """The named kernel-limit park for a fold the sized bound could not absorb.

    Parks are the index entries with `dispatchable: false`, and the spec names
    kernel-limit parks (recursion) as belonging here alongside the cap parks
    `dispatchable()` reports. The named path is the task's largest text file —
    the weave whose depth the bound was too small for.
    """
    sizes = {p: len(manyana.current_lines(w)) for p, w in state.weaves.items()}
    path = max(sorted(sizes), key=sizes.get) if sizes else ""
    return {"i": i, "path": path, "kind": "kernel-limit", "dispatchable": False,
            "reason": ("kernel recursion limit exceeded folding task %s at bound "
                       "%d; largest text path %s (%d lines)"
                       % (task_id, bound, path or "-", sizes.get(path, 0))),
            "epoch": epoch}


def _wave_dir(run_dir, wave):
    return Path(run_dir) / "frontier" / ("wave-%d" % wave)


def _git_env(repo, env, *args, stdin=None):
    """`repo_weave._git` with an environment (the temporary `GIT_INDEX_FILE`)
    and optional stdin. Kept here rather than in the kernel: the temporary
    index is a CLI materialization concern, not a weave one."""
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, env=env, input=stdin).stdout


def _parse_task_head(spec):
    """`<taskId>=<headSha>` -> (taskId, headSha)."""
    task_id, eq, head_sha = spec.partition("=")
    if not eq or not task_id or not head_sha:
        raise argparse.ArgumentTypeError(
            "--task-head must be <taskId>=<headSha>, got %r" % spec)
    return task_id, head_sha


def _parse_branch(spec):
    """`<taskId>=<branchName>:<headSha>` -> (taskId, branchName, headSha)."""
    task_id, eq, rest = spec.partition("=")
    branch_name, colon, head_sha = rest.partition(":")
    if not eq or not colon or not task_id or not branch_name or not head_sha:
        raise argparse.ArgumentTypeError(
            "--branch must be <taskId>=<branchName>:<headSha>, got %r" % spec)
    return task_id, branch_name, head_sha


def _write_jsonl(path, events):
    path.write_text("".join(json.dumps(e) + "\n" for e in events))


def _read_index(path):
    if path.exists():
        return json.loads(path.read_text())
    return []


def _write_index(path, entries):
    path.write_text(json.dumps(entries, indent=2) + "\n")


def _read_log(log_path):
    """The recorded events, or [] when the wave has no log yet."""
    if not log_path.exists():
        return []
    return [json.loads(line)
            for line in rw.split_lines(log_path.read_text()) if line.strip()]


def _append_event(log_path, event):
    with log_path.open("a") as f:
        f.write(json.dumps(event) + "\n")


def _log_base(recorded):
    if recorded and recorded[0].get("type") == "base":
        return recorded[0]["sha"]
    return None


def _fold_prefix_check(recorded, branches, base_sha):
    """(ok, remaining_triples) against the supplied `--branch` list.

    The log is the authority for what has folded, and the supplied list is
    the authority for what the wave IS: the recorded `fold` events must be an
    `(id, headSha)` prefix of the list over the same base. Anything else —
    a reordered list, a re-run branch, a different wave's log — is a
    disagreement the CLI refuses rather than resolving into.
    """
    if base_sha is None:
        return False, []
    folds = [(e["task"], e["headSha"]) for e in recorded if e.get("type") == "fold"]
    if len(folds) > len(branches):
        return False, []
    for k, recorded_fold in enumerate(folds):
        if recorded_fold != (branches[k][0], branches[k][2]):
            return False, []
    return True, list(branches[len(folds):])


def _record_max_lines(wave_dir, max_lines):
    """Append this call's largest folded text file to `fold_stats.json`.

    The one fact nothing else records (FOLD_LOG's one-fact rule keeps it out
    of the log): `hunkCount`/`dispatchable`/`parked` are in `conflicts.json`
    and the CLI-call count is engine-side. One entry per invocation that
    actually folds — a clean wave still writes it.
    """
    path = wave_dir / "fold_stats.json"
    stats = json.loads(path.read_text()) if path.exists() else {"maxLines": []}
    stats["maxLines"].append(max_lines)
    path.write_text(json.dumps(stats, indent=2) + "\n")


def _verdict(conflict, manifest):
    """(dispatchable, reason, hunks text, hunk count) for one conflict.

    `dispatchable` owns the routing predicate; derivation is what turns an
    eligible narration into the resolver's brief, so a narration the hunk
    grammar cannot delimit (a repo whose sources quote kernel marker forms)
    parks with a named reason rather than being guessed at.
    """
    ok, reason = ff.dispatchable(conflict, manifest)
    try:
        text, blocks = hunks.derive(conflict.narration)
    except hunks.HunkError as exc:
        return False, "%s in %s" % (exc.reason, conflict.path), "", 0
    if ok and not blocks:
        return False, "no hunks derived for %s" % conflict.path, "", 0
    return ok, reason, text, len(blocks)


def _narrate(wave_dir, index, conflict, epoch, manifest):
    """Write one conflict's narration + hunks brief; append its index entry.

    `<i>` is monotonic across every CLI call of the wave — the index is the
    key `open`/`waiting` carry, because `(path, epoch)` is not unique when a
    presence park shares the pair with a kernel conflict.
    """
    i = max((e["i"] for e in index), default=0) + 1
    (wave_dir / ("conflict-%d.txt" % i)).write_text(conflict.narration)
    ok, reason, text, count = _verdict(conflict, manifest)
    hunks_file = ""
    if ok:
        path = wave_dir / ("conflict-%d.hunks.txt" % i)
        path.write_text(text)
        hunks_file = str(path)
    else:
        count = 0                       # nothing is briefed off a parked entry
    entry = {"i": i, "path": conflict.path, "kind": conflict.kind,
             "dispatchable": ok, "reason": reason, "epoch": epoch,
             "hunksFile": hunks_file, "hunkCount": count}
    index.append(entry)
    return entry


def _open_view(entry):
    """The engine's view of an open conflict — the narration file drops out;
    the resolver is briefed from the hunks file."""
    return {k: entry[k] for k in
            ("i", "path", "kind", "epoch", "hunksFile", "hunkCount")}


def _fold_until_stop(eng, states, remaining, log_path, wave_dir, index):
    """Fold `remaining` in order, stopping at the first fold that opens a
    conflict. Returns `(stop entries, remaining after, kernel park)`.

    The stop is signalled by NARRATION, not by dispatchability: a stop whose
    entries all parked is still a stop, and reporting it as "nothing opened"
    would claim a wave complete while tasks are still unfolded. Every fold
    that returns is recorded before the stop is narrated, so the log always
    describes exactly the frontier the narration was read off.
    """
    for k, (task_id, _branch_name, head_sha) in enumerate(remaining):
        try:
            conflicts = eng.fold(states[task_id])
        except RecursionError:
            # `FrontierEngine.fold` assigns `self.frontier` only once
            # `rw.fold` has returned, so the raise leaves the engine exactly
            # at the previous task — the log truncates cleanly.
            return [], list(remaining[k:]), (task_id, states[task_id])
        _append_event(log_path,
                      {"type": "fold", "task": task_id, "headSha": head_sha})
        if conflicts:
            epoch = eng.epoch()
            manifest = eng.manifest()
            entries = [_narrate(wave_dir, index, c, epoch, manifest)
                       for c in conflicts]
            return entries, list(remaining[k + 1:]), None
    return [], [], None


def _current_stop(index, recorded):
    """(stop entries, waiting entries) for the wave's current stop.

    The stop is the set of index entries narrated at the highest epoch; an
    entry is still waiting while its path carries no resolve event
    at-or-after that epoch. Folding only continues once the stop is empty of
    waiters, so a fold that opened several paths is fully resolved before the
    frontier moves under any of them.
    """
    if not index:
        return [], []
    top = max(e["epoch"] for e in index)
    stop = [e for e in index if e["epoch"] == top]
    resolved_at = {}
    for e in recorded:
        if e.get("type") == "resolve":
            resolved_at[e["path"]] = max(resolved_at.get(e["path"], -1), e["epoch"])
    return stop, [e for e in stop if resolved_at.get(e["path"], -1) < e["epoch"]]


def _self_checks(repo, base, eng, folded, log_path):
    """Both live self-checks, run by whichever call completes the wave."""
    try:
        if len(ff.raw_shuffle_outcomes(base, folded, sample_seed=42)) != 1:
            return "failed: raw shuffle order-independence"
        if ff.rehydrate(repo, log_path).manifest() != eng.manifest():
            return "failed: rehydrate manifest replay"
        return "ok"
    except RecursionError:
        return "failed: kernel recursion limit in self-checks"


def _write_kernel_park(wave_dir, index, epoch, park):
    """Record a mid-fold RecursionError as the named kernel-limit park.

    The wave is dead either way — the frontier omits the unfolded tasks — but
    the entry keeps the exit inside the documented contract and names the
    file whose depth the bound was too small for.
    """
    entry = _kernel_limit_entry(max((e["i"] for e in index), default=0) + 1,
                                epoch, *park)
    entry["hunksFile"], entry["hunkCount"] = "", 0
    # Every index entry keeps a `conflict-<i>.txt`; a park that never reached
    # a narration carries its reason there instead.
    (wave_dir / ("conflict-%d.txt" % entry["i"])).write_text(entry["reason"] + "\n")
    index.append(entry)
    _write_index(wave_dir / "conflicts.json", index)
    return entry


def _prepare(repo, base_sha, branches):
    """(base state, published task states, largest folded text file).

    Publishing every task BEFORE folding any of them is what lets the
    recursion bound be sized at all (`publish` is iterative, so it costs no
    stack), and the base is scoped to the union of ALL supplied heads — the
    ordering contract: a narrower scope would misclassify a path a later task
    also touches as an `add/add` instead of a `modify`.
    """
    touched = ff._union_touched(repo, base_sha, [h for _, _, h in branches])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    states = {task_id: rw.publish(base, repo, base_sha, head_sha, task_id=task_id)
              for task_id, _branch_name, head_sha in branches}
    return base, states, _state_max_lines(base, states)


def _pre_scan(base, states, branches):
    """Fold the whole wave in memory: `(parks, kernel park)`, no log written.

    Nothing is dispatched against a wave that is going to park, and the guard
    stays on the fold reply alone. Conservative by construction: a text
    resolution can only remove a marker-shaped line from a later narration,
    never add one, and presence/binary pairings are monotone — so this park
    set is a superset of the incremental pass's.
    """
    eng = ff.FrontierEngine(base)
    conflicts = []
    for task_id, _branch_name, _head_sha in branches:
        try:
            found = eng.fold(states[task_id])
        except RecursionError:
            return [], (eng.epoch(), task_id, states[task_id])
        epoch = eng.epoch()
        conflicts.extend((c, epoch) for c in found)
    manifest = eng.manifest()
    parks = []
    for conflict, epoch in conflicts:
        ok, reason, _text, _count = _verdict(conflict, manifest)
        if not ok:
            parks.append((conflict, epoch, reason))
    return parks, None


def cmd_fold(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if log_path.exists():
        print("fold log already exists for wave %d" % args.wave, file=sys.stderr)
        return 2

    repo = Path(args.repo)
    base_sha = args.base
    branches = args.branches  # [(taskId, branchName, headSha)], argv order
    all_ids = [task_id for task_id, _n, _h in branches]

    base, states, max_lines = _prepare(repo, base_sha, branches)
    wave_dir.mkdir(parents=True, exist_ok=True)
    _record_max_lines(wave_dir, max_lines)
    index = []

    with _recursion_headroom(max_lines) as headroom:
        parks, kernel_park = _pre_scan(base, states, branches)

        if kernel_park is not None:
            epoch, task_id, state = kernel_park
            _write_kernel_park(wave_dir, index, epoch,
                               (task_id, state, headroom.bound))
            _write_jsonl(log_path, [{"type": "base", "sha": base_sha}])
            print(json.dumps({"clean": False, "conflicts": 1, "dispatchable": 0,
                              "parked": 1, "open": [], "remaining": all_ids,
                              "complete": False,
                              "selfChecks": "failed: kernel recursion limit "
                                            "folding task %s" % task_id}))
            return 3

        if parks:
            for i, (conflict, epoch, reason) in enumerate(parks, start=1):
                (wave_dir / ("conflict-%d.txt" % i)).write_text(conflict.narration)
                index.append({"i": i, "path": conflict.path, "kind": conflict.kind,
                              "dispatchable": False, "reason": reason,
                              "epoch": epoch, "hunksFile": "", "hunkCount": 0})
            _write_index(wave_dir / "conflicts.json", index)
            print(json.dumps({"clean": False, "conflicts": len(parks),
                              "dispatchable": 0, "parked": len(parks),
                              "open": [], "remaining": all_ids,
                              "complete": False}))
            return 0

        eng = ff.FrontierEngine(base)
        _write_jsonl(log_path, [{"type": "base", "sha": base_sha}])
        stop, remaining, kernel_park = _fold_until_stop(
            eng, states, branches, log_path, wave_dir, index)
        _write_index(wave_dir / "conflicts.json", index)

        if kernel_park is not None:
            _write_kernel_park(wave_dir, index, eng.epoch(),
                               kernel_park + (headroom.bound,))
            print(json.dumps({"clean": False, "conflicts": len(index),
                              "dispatchable": 0, "parked": len(index),
                              "open": [], "remaining": [t for t, _n, _h in remaining],
                              "complete": False,
                              "selfChecks": "failed: kernel recursion limit "
                                            "folding task %s" % kernel_park[0]}))
            return 3

        if stop:
            # A mid-pass park the pre-scan could not see (the frontier is
            # larger mid-fold than at the end) rides `parked`, which the
            # engine reads order-first: the wave parks rather than dispatching
            # against a stop it can never drain.
            open_entries = [e for e in stop if e["dispatchable"]]
            print(json.dumps({"clean": False, "conflicts": len(open_entries),
                              "dispatchable": len(open_entries),
                              "parked": len(stop) - len(open_entries),
                              "open": [_open_view(e) for e in open_entries],
                              "remaining": [t for t, _n, _h in remaining],
                              "complete": False}))
            return 0

        folded = [states[task_id] for task_id, _n, _h in branches]
        self_checks = _self_checks(repo, base, eng, folded, log_path)

    # `complete` is derived, never recorded: every task folded (nothing
    # narrated stopped the pass) and no narrated path left unresolved.
    unresolved = _unresolved_paths(wave_dir, _read_log(log_path))
    if unresolved:
        self_checks = "failed: %d narrated path(s) unresolved" % len(unresolved)
    print(json.dumps({"clean": not index, "conflicts": 0, "dispatchable": 0,
                      "parked": 0, "open": [], "remaining": [],
                      "complete": not unresolved, "selfChecks": self_checks}))
    return 0 if self_checks == "ok" else 3


def cmd_resolve(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if not log_path.exists():
        print("fold log missing for wave %d" % args.wave, file=sys.stderr)
        return 2

    repo = Path(args.repo)
    branches = args.branches
    recorded = _read_log(log_path)
    base_sha = _log_base(recorded)
    ok, remaining = _fold_prefix_check(recorded, branches, base_sha)
    if not ok:
        print("log/list disagreement for wave %d: the recorded folds are not a "
              "prefix of the supplied task list" % args.wave, file=sys.stderr)
        return 2

    index = _read_index(wave_dir / "conflicts.json")
    entry = next((e for e in index if e["i"] == args.conflict), None)
    if entry is None:
        print("no conflict %d in wave %d" % (args.conflict, args.wave),
              file=sys.stderr)
        return 2

    # Grammar first: a rejected reply must cost no kernel work and must never
    # reach the log. The blocks are re-derived from the narration, which is
    # the only durable record of the hunk ids the resolver was briefed on.
    annotated = (wave_dir / ("conflict-%d.txt" % entry["i"])).read_text()
    try:
        _text, blocks = hunks.derive(annotated)
        replies = hunks.read_reply_dir(args.reply_dir, blocks)
        lines = hunks.splice(annotated, replies, blocks)
    except hunks.HunkError as exc:
        print(json.dumps({"applied": False, "rejected": True,
                          "reason": exc.reason}))
        return 4

    base, states, max_lines = _prepare(repo, base_sha, branches)

    with _recursion_headroom(max_lines) as headroom:
        try:
            # Not `ff.rehydrate`: it scopes the base to the RECORDED fold
            # heads, which at a stop is only a prefix of the wave. The
            # continued folds need the same union scope the first call used.
            eng = ff._apply_events(ff.FrontierEngine(base), states, recorded)
        except RecursionError:
            print("kernel recursion limit rehydrating wave %d" % args.wave,
                  file=sys.stderr)
            return 3

        if not eng.apply_resolution(entry["path"], entry["epoch"], lines):
            # The idempotency guard: a re-issued `resolve` would otherwise
            # re-apply old whole-file lines after the continued fold and
            # silently clobber the next task's contribution.
            print(json.dumps({"applied": False, "stale": True}))
            return 2
        _append_event(log_path, eng.events[-1])

        recorded = _read_log(log_path)
        _stop, waiting = _current_stop(index, recorded)
        if waiting:
            print(json.dumps({"applied": True,
                              "waiting": [e["i"] for e in waiting]}))
            return 0

        if remaining:
            _record_max_lines(wave_dir, max_lines)
            stop, remaining, kernel_park = _fold_until_stop(
                eng, states, remaining, log_path, wave_dir, index)
            _write_index(wave_dir / "conflicts.json", index)

            if kernel_park is not None:
                _write_kernel_park(wave_dir, index, eng.epoch(),
                                   kernel_park + (headroom.bound,))
                print("kernel recursion limit folding task %s in wave %d"
                      % (kernel_park[0], args.wave), file=sys.stderr)
                return 3

            if stop:
                open_entries = [e for e in stop if e["dispatchable"]]
                if len(open_entries) != len(stop):
                    # The resolve reply carries no `parked` field, and a stop
                    # holding an undispatchable entry can never be drained —
                    # folding would wait on it forever. Name the park and let
                    # the engine fall the wave back instead.
                    park = next(e for e in stop if not e["dispatchable"])
                    print("wave %d parked mid-fold on %s (%s)"
                          % (args.wave, park["path"], park["reason"]),
                          file=sys.stderr)
                    return 3
                print(json.dumps({"applied": True,
                                  "conflicts": len(open_entries),
                                  "dispatchable": len(open_entries),
                                  "open": [_open_view(e) for e in open_entries],
                                  "remaining": [t for t, _n, _h in remaining],
                                  "complete": False}))
                return 0

        folded = [states[task_id] for task_id, _n, _h in branches]
        self_checks = _self_checks(repo, base, eng, folded, log_path)

    # `complete` is derived, never recorded: every task folded and no
    # narrated path left unresolved.
    unresolved = _unresolved_paths(wave_dir, _read_log(log_path))
    if unresolved:
        print("wave %d folded every task but left %d narrated path(s) "
              "unresolved" % (args.wave, len(unresolved)), file=sys.stderr)
        return 3
    print(json.dumps({"applied": True, "open": [], "remaining": [],
                      "complete": True, "selfChecks": self_checks}))
    return 0 if self_checks == "ok" else 3


def _park(reason):
    print(json.dumps({"park": reason}))
    return 2


def _fallback(reason):
    print(json.dumps({"fallback": reason}))
    return 3


def _ls_tree_entry(repo, ref, path):
    """(mode, object type) for `path` at `ref`, or None when it is absent.

    `--literal-pathspecs` for the same reason `repo_weave._read_tree` uses it:
    a repo path may legally begin with ":", which git otherwise reads as
    pathspec magic and drops silently — the path would then look absent.
    """
    out = rw._git(repo, "--literal-pathspecs", "ls-tree", ref, "--", path).decode()
    if not out.strip():
        return None
    meta = out.split("\t", 1)[0].split(" ")
    return meta[0], meta[1]


def _observe_modes(repo, prev_head, task_heads, paths):
    """(modes, park reason, fallback reason) for the folded paths.

    Modes are OBSERVED, never assumed: the text pipeline is mode-blind
    (`git diff --name-status` reports a chmod as a plain `M` over identical
    blobs), so `git ls-tree` at the previous integration head and at each
    task head is the only witness of a mode. A path present at `prev_head`
    keeps that head's mode, but only after every task head that still carries
    the path is checked against it; a path the fold ADDS takes its creating
    task's mode, and creators that disagree park rather than pick one.

    Non-regular objects are scanned across ALL paths before any mode
    disagreement is reported, so the verdict never depends on which class of
    trouble the path order happens to reach first: a tree that cannot be
    represented at all is a fallback whatever else parks.
    """
    def carriers(path):
        """[(taskId, (mode, type))] for the task heads that still carry
        `path` — a task that deleted it witnesses no mode."""
        seen = [(task_id, _ls_tree_entry(repo, head, path))
                for task_id, head in task_heads]
        return [(task_id, e) for task_id, e in seen if e is not None]

    prev_entry = {p: _ls_tree_entry(repo, prev_head, p) for p in paths}
    task_entries = {p: carriers(p) for p in paths}

    for p in paths:
        witnesses = ([("the previous integration head", prev_entry[p])]
                     if prev_entry[p] else [])
        witnesses += [("task %s" % t, e) for t, e in task_entries[p]]
        for where, (mode, obj_type) in witnesses:
            if mode not in REGULAR_MODES or obj_type != "blob":
                return None, None, ("%s is %s at %s; the candidate tree can "
                                    "only carry a regular blob there"
                                    % (p, MODE_NAMES.get(mode, "mode %s" % mode),
                                       where))
        if not witnesses:
            return None, None, ("%s is in the fold manifest but present at "
                                "neither the previous integration head nor "
                                "any merged task head" % p)

    modes = {}
    for p in paths:
        if prev_entry[p] is not None:
            base_mode = prev_entry[p][0]
            differing = [(t, m) for t, (m, _) in task_entries[p] if m != base_mode]
            if differing:
                task_id, mode = differing[0]
                return None, ("%s changes mode: %s at the previous integration "
                              "head, %s at task %s" % (p, base_mode, mode, task_id)), None
            modes[p] = base_mode
        else:
            creators = {m for _, (m, _) in task_entries[p]}
            if len(creators) > 1:
                by_task = ", ".join("%s by task %s" % (m, t)
                                    for t, (m, _) in task_entries[p])
                return None, ("%s is created with differing modes: %s"
                              % (p, by_task)), None
            modes[p] = task_entries[p][0][1][0]
    return modes, None, None


def _build_candidate(repo, prev_head, task_heads, wave, touched, manifest, modes):
    """The temporary-index route: seed from `prev_head`, apply the touched set,
    write the tree, commit it. Nothing here names a worktree path or a ref, so
    the checkout cannot move; the blobs land in the object store unreferenced
    until the engine adopts the candidate.
    """
    with tempfile.TemporaryDirectory(prefix="fold-index-") as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        _git_env(repo, env, "read-tree", prev_head)
        for p in touched:
            if p in manifest:
                content = manifest[p]
                blob = content if isinstance(content, bytes) else content.encode("utf-8")
                sha = _git_env(repo, env, "hash-object", "-w", "--stdin",
                               stdin=blob).decode().strip()
                _git_env(repo, env, "update-index", "--add", "--cacheinfo",
                         "%s,%s,%s" % (modes[p], sha, p))
            else:
                # Absent from the manifest but inside the touched set: a task
                # deleted it. Keying on the manifest alone would silently
                # resurrect the path from the seeded index.
                _git_env(repo, env, "update-index", "--force-remove", "--", p)
        tree = _git_env(repo, env, "write-tree").decode().strip()
        parents = []
        for sha in [prev_head] + [h for _, h in task_heads]:
            parents += ["-p", sha]
        return _git_env(repo, env, "commit-tree", tree, *parents,
                        "-m", "frontier fold wave %d" % wave).decode().strip()


def _unresolved_paths(wave_dir, recorded):
    """Paths whose LAST narrated conflict has no resolution at-or-after it.

    conflicts.json is the narration record; the fold log's resolve events are
    the resolution record. A path counts as resolved iff some resolve event's
    epoch >= the path's highest narrated epoch — a resolution only ever
    applies when nothing touched the path after its narration, so an
    at-or-after epoch proves the resolver saw that conflict's state (or a
    later one). Kernel-limit parks fall out of the same rule: no resolve
    event ever reaches their epoch, so their wave cannot materialize (#144 —
    the frontier is marker-free, so without this check an unresolved
    conflicted file would weave into a plausible-looking candidate and the
    engine-side guard chain would be the only refusal).
    """
    entries = _read_index(wave_dir / "conflicts.json")
    if not entries:
        return []
    last_narrated = {}
    for e in entries:
        path = e.get("path") or "<kernel-limit>"
        last_narrated[path] = max(last_narrated.get(path, -1), e["epoch"])
    resolved_at = {}
    for e in recorded:
        if e.get("type") == "resolve":
            resolved_at[e["path"]] = max(resolved_at.get(e["path"], -1), e["epoch"])
    return sorted(p for p, epoch in last_narrated.items()
                  if resolved_at.get(p, -1) < epoch)


def cmd_materialize(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if not log_path.exists():
        return _park("fold log missing for wave %d" % args.wave)

    repo = Path(args.repo)
    task_heads = args.task_heads          # [(taskId, headSha)], argv order
    recorded = [json.loads(line)
                for line in rw.split_lines(log_path.read_text()) if line.strip()]
    base_sha = recorded[0]["sha"] if recorded and recorded[0].get("type") == "base" else None
    heads = [e["headSha"] for e in recorded if e.get("type") == "fold"]
    max_lines = _git_max_lines(repo, base_sha, heads) if base_sha else 0

    # The completeness refusal, before anything is built: a materialize
    # issued short of `complete` would otherwise construct a candidate that
    # omits every unfolded task and adopt it on a green suite. `complete` is
    # derived here exactly as the fold replies derive it — every supplied
    # `(id, headSha)` has a fold event, and no narrated path is unresolved.
    folded = {(e["task"], e["headSha"]) for e in recorded if e.get("type") == "fold"}
    unfolded = [task_id for task_id, sha in task_heads if (task_id, sha) not in folded]
    unresolved = [] if args.allow_unresolved else _unresolved_paths(wave_dir, recorded)
    if unfolded or unresolved:
        return _fallback("incomplete fold: %d task(s) unfolded / %d path(s) "
                         "unresolved" % (len(unfolded), len(unresolved)))

    with _recursion_headroom(max_lines):
        try:
            eng = ff.rehydrate(repo, log_path)
        except RecursionError:
            return _fallback("kernel recursion limit rehydrating wave %d" % args.wave)
        manifest = eng.manifest()

    # The touched set — not the manifest — is what the candidate applies: the
    # manifest omits deletions. It is derived from the fold events' own heads
    # against the log's base, exactly as the fold derived it (the routing rule
    # only folds a wave whose base IS the previous integration head).
    touched = sorted(ff._union_touched(repo, base_sha, heads))
    modes, park, fallback = _observe_modes(
        repo, args.prev_head, task_heads, [p for p in touched if p in manifest])
    if fallback is not None:
        return _fallback(fallback)
    if park is not None:
        return _park(park)

    candidate = _build_candidate(repo, args.prev_head, task_heads, args.wave,
                                 touched, manifest, modes)
    print(json.dumps({"candidateSha": candidate}))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="fold_wave.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fold = sub.add_parser("fold")
    p_fold.add_argument("--repo", required=True)
    p_fold.add_argument("--run-dir", required=True)
    p_fold.add_argument("--wave", required=True, type=int)
    p_fold.add_argument("--base", required=True)
    p_fold.add_argument("--branch", dest="branches", action="append",
                        type=_parse_branch, default=[], required=True)
    p_fold.set_defaults(func=cmd_fold)

    p_resolve = sub.add_parser("resolve")
    p_resolve.add_argument("--repo", required=True)
    p_resolve.add_argument("--run-dir", required=True)
    p_resolve.add_argument("--wave", required=True, type=int)
    p_resolve.add_argument("--conflict", required=True, type=int,
                           help="the conflicts.json index `i` of the narration "
                                "this reply answers")
    p_resolve.add_argument("--reply-dir", required=True,
                           help="directory holding one h<k>.txt per hunk")
    p_resolve.add_argument("--branch", dest="branches", action="append",
                           type=_parse_branch, default=[], required=True,
                           help="the wave's full task list, re-supplied on "
                                "every call in task-index order")
    p_resolve.set_defaults(func=cmd_resolve)

    p_mat = sub.add_parser("materialize")
    p_mat.add_argument("--repo", required=True)
    p_mat.add_argument("--run-dir", required=True)
    p_mat.add_argument("--wave", required=True, type=int)
    p_mat.add_argument("--prev-head", required=True)
    p_mat.add_argument("--task-head", dest="task_heads", action="append",
                       type=_parse_task_head, default=[], required=True)
    p_mat.add_argument("--allow-unresolved", action="store_true",
                       help="build the candidate even though conflicts.json "
                            "carries unresolved entries (forensics only — the "
                            "engine never passes this). Scoped to that term "
                            "alone: an unfolded task still refuses.")
    p_mat.set_defaults(func=cmd_materialize)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
