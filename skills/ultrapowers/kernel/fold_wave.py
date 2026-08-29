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

`fold`/`resolve --commutes <taskId>=<path,...>` (repeatable) carries the
plan's `Commutes:` declarations (spec 2026-08-18 §2b). A conflict on a path
EVERY writer declared gets the one-line `contract:` header in its hunks brief,
and — when every segment of every hunk is `added` — is resolved in process to
the kernel's own merged body with no resolver dispatch, so the fold does not
stop on it. `conflicts.json` marks that entry `"autoResolved": true` (it stays
`dispatchable`), and every reply carrying `conflicts` carries the call's
`autoResolved` count.

`materialize` refuses anything short of a complete fold, then turns the wave
into a candidate commit through a TEMPORARY INDEX, so the worktree and every
branch ref are untouched by construction; adoption is the engine's job.

**Patch input (One Driver Amendment 9, 2026-08-29).** A task may arrive as
`--patch <taskId>=<file>` instead of `--branch`: `<file>` is a `git diff
--binary --full-index --no-renames <BASE>` captured in the worker's own tree.
Folding is a function of CONTENT; only this adapter ever made it a function
of git, and with patch input it needs no ref the kernel can see — no shared
object store, no shared branches, no fetch, so the worker's substrate
(worktree, clone, anything) stops mattering. `repo_weave.apply_patch_tree`
turns each patch into a tree sha inside a temporary index of `--repo`
(deterministic: same patch over the same base, same sha), and everything
downstream reads that tree-ish exactly as it read a commit. The fold log
records `headSha` (the tree) AND `patch` (the file), so `rehydrate` can
re-derive the task from the run directory alone and refuse if the patch has
changed since it folded. A patch that does not apply is the exit-2 refusal —
the patch-side analogue of an undescended head, which a patch cannot be.
`materialize --patch` builds the candidate with the previous integration head
as its ONLY parent: there is no task commit to parent. `--branch` and
`--task-head` remain as the pre-cutover path (spec §10 stage 2) and are
deleted with it, on measurement.

Every invocation is a fresh process: no subcommand carries anything in
memory from the last one, per the fold log's self-sufficiency contract.

Exit codes: 0 success, 2 precondition refusal (a pre-existing log, a missing
log, a log/list disagreement, a stale resolution, a task head not descended
from the base), 3 self-check failure
(which includes a kernel recursion limit the fold thread could not absorb —
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
import threading
from pathlib import Path
from typing import NamedTuple, Optional

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw
import frontier_fold as ff
import hunks

# The vendored kernel's merge walk (`merge_states` -> `state_to_tree` ->
# `pull_out_tree`/`merge_trees`/`insert_tree`) recurses once per weave-state
# entry, ~2*lines+4 frames. Raising `sys.setrecursionlimit` alone does not buy
# those frames: the C stack runs out first and the interpreter dies on a
# SIGSEGV — an exit outside the documented {0,2,3} contract with no stdout
# JSON and no artifacts at all. So the recursion limit is raised on a thread
# given a 1 GiB stack, which is what makes a 100k-line fold land (spec
# 2026-08-18 §1d). The sized bound this replaced is gone: the limit is fixed,
# and the only ceiling left is the residual `RecursionError` caught into a
# named kernel-limit park.
STACK_BYTES = 1 << 30
THREAD_RECURSION_LIMIT = 1_000_000

# The one-line composition contract written under every hunk header of a path
# every writer declared commutative (spec §1a wording; §2b consumer 2).
CONTRACT_LINE = ("contract: both sides declared these edits commutative — union, "
                 "preserve each side's internal order, do not reorder existing lines")

# The only modes a folded text/bytes path can carry into the candidate tree:
# `hash-object` writes a blob, and a blob is either executable or not.
REGULAR_MODES = ("100644", "100755")
MODE_NAMES = {"120000": "a symlink", "160000": "a gitlink"}


def run_on_kernel_thread(fn, *args, **kwargs):
    """Run `fn` on a thread with a 1 GiB stack and the fixed recursion limit.

    The result and any exception are marshalled back to the caller — including
    `SystemExit`, so the CLI's exit codes are unchanged by the hop. A platform
    that refuses the big stack (`ValueError` from `threading.stack_size`) or
    the thread itself (`RuntimeError` from `Thread.start()`) falls through to
    a main-thread call plus one stderr line: the work still runs, just without
    the headroom. `threading.stack_size` is process-global like the recursion
    limit, so the prior stack size is restored in every path — a thread's
    stack is fixed at `start()`, so threads created later are unaffected.

    `sys.setrecursionlimit` is interpreter-global, not per-thread, so raising
    it inside the thread raises it for the whole process. The limit is
    therefore restored before the thread ends — the caller (and, in-process,
    every later caller) keeps the limit it had. Restoring is safe because the
    thread's own stack is shallow again by then: `fn` has already returned or
    unwound.
    """
    box = {}

    def target():
        prior = sys.getrecursionlimit()
        sys.setrecursionlimit(THREAD_RECURSION_LIMIT)
        try:
            box["result"] = fn(*args, **kwargs)
        except BaseException as e:      # marshal everything back, incl. SystemExit
            box["exc"] = e
        finally:
            sys.setrecursionlimit(prior)

    try:
        prior_stack = threading.stack_size(STACK_BYTES)
    except ValueError as e:
        # Nothing was changed: stack_size raises before mutating.
        print("fold_wave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    try:
        t = threading.Thread(target=target, name="fold-kernel")
        t.start()
    except RuntimeError as e:
        print("fold_wave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    finally:
        # Process-global, like the recursion limit: a thread's stack is fixed
        # at start(), so restoring here affects only threads created later.
        threading.stack_size(prior_stack)
    t.join()
    if "exc" in box:
        raise box["exc"]
    return box["result"]


def _state_max_lines(base, states):
    """Largest line count among the text files this wave folds.

    Free of git: `base.files` and every task's weaves are already in hand,
    built by the kernel's `split_lines`, and `current_lines` is iterative —
    only `merge_states` recurses. Nothing routes on this number since the cap
    retired; it is the sensor reading `fold_stats.json` records as `maxLines`.
    """
    counts = [0]
    counts += [len(manyana.current_lines(w)) for w in base.files.values()]
    for state in states.values():
        counts += [len(manyana.current_lines(w)) for w in state.weaves.values()]
    return max(counts)


def _kernel_limit_entry(i, epoch, task_id, state):
    """The named kernel-limit park for a fold the kernel thread could not absorb.

    Parks are the index entries with `dispatchable: false`, and the spec names
    kernel-limit parks (recursion) as belonging here. Now that the size cap is
    retired this is the ONLY ceiling left, so the entry names the task's
    largest text file — the weave whose depth outran the fixed limit.
    """
    sizes = {p: len(manyana.current_lines(w)) for p, w in state.weaves.items()}
    path = max(sorted(sizes), key=sizes.get) if sizes else ""
    return {"i": i, "path": path, "kind": "kernel-limit", "dispatchable": False,
            "reason": ("kernel recursion limit exceeded folding task %s; "
                       "largest text path %s (%d lines)"
                       % (task_id, path or "-", sizes.get(path, 0))),
            "epoch": epoch}


def _wave_dir(run_dir, wave):
    return Path(run_dir) / "frontier" / ("wave-%d" % wave)


def _git_env(repo, env, *args, stdin=None):
    """`repo_weave._git` with an environment (the temporary `GIT_INDEX_FILE`)
    and optional stdin. Kept here rather than in the kernel: the temporary
    index is a CLI materialization concern, not a weave one."""
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, env=env, input=stdin).stdout


class TaskRef(NamedTuple):
    """One supplied task, whatever shape it arrived in.

    `ref` is the tree-ish the pipeline reads (a commit sha for `--branch` /
    `--task-head`, the derived tree sha for `--patch`); `patch` is the patch
    path or None.
    """
    task_id: str
    ref: str
    patch: Optional[str]


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


def _parse_patch(spec):
    """`<taskId>=<patchFile>` -> (taskId, absolute patchFile).

    Absolute because the path is RECORDED — in the fold log, which rehydrate
    re-reads verbatim from any cwd. `absolute()` rather than `resolve()`:
    anchoring to cwd is the point, symlink normalization would make the
    recorded path differ from the one the caller can grep for.
    """
    task_id, eq, patch = spec.partition("=")
    if not eq or not task_id or not patch:
        raise argparse.ArgumentTypeError(
            "--patch must be <taskId>=<patchFile>, got %r" % spec)
    if not Path(patch).is_file():
        raise argparse.ArgumentTypeError(
            "--patch %s: no such file %r" % (task_id, patch))
    return task_id, str(Path(patch).absolute())


# `--branch` / `--patch` / `--task-head` append `(kind, parsed)` into ONE
# shared dest, so the interleaving survives: argv order is the fold order,
# and the log's prefix check is against exactly that order. argparse's own
# `append` preserves it across different options sharing a dest.
def _branch_arg(spec):
    return ("branch", _parse_branch(spec))


def _patch_arg(spec):
    return ("patch", _parse_patch(spec))


def _head_arg(spec):
    return ("head", _parse_task_head(spec))


def _resolve_tasks(repo, base_sha, specs):
    """`[(kind, parsed)]` -> `[TaskRef]`, in argv order.

    The one place patch content becomes a tree-ish: each `--patch` is applied
    over `base_sha` in a temporary index (`rw.apply_patch_tree`). Raises
    `rw.PatchError` naming the task when a patch does not apply — the
    caller's exit-2 refusal, before anything is written.
    """
    tasks = []
    for kind, parsed in specs:
        if kind == "branch":
            task_id, _branch_name, sha = parsed
            tasks.append(TaskRef(task_id, sha, None))
        elif kind == "head":
            task_id, sha = parsed
            tasks.append(TaskRef(task_id, sha, None))
        else:
            task_id, patch = parsed
            try:
                tree = rw.apply_patch_tree(repo, base_sha, patch)
            except rw.PatchError as e:
                raise rw.PatchError("patch for task %s (%s) does not apply "
                                    "against base %s: %s"
                                    % (task_id, patch, base_sha[:7], e))
            tasks.append(TaskRef(task_id, tree, patch))
    return tasks


def _parse_commutes(spec):
    """`<taskId>=<path1,path2,...>` -> (taskId, [paths])."""
    task_id, eq, rest = spec.partition("=")
    paths = [p for p in rest.split(",") if p]
    if not eq or not task_id or not paths:
        raise argparse.ArgumentTypeError(
            "--commutes must be <taskId>=<path1,path2,...>, got %r" % spec)
    return task_id, paths


class Contracts:
    """One CLI call's `--commutes` declarations, and what they license.

    Two consumers hang off `eligible()` (spec §2b): the `contract:` hunk
    header on the resolver brief, and the assume rung's in-process union.
    Both need the same both-sides condition, so it exists once.

    `touched` is derived from git LAZILY — a call with no declarations never
    pays for it, which is why the empty-map short circuit comes first.
    """

    def __init__(self, repo, base_sha, branches, commutes_map, folded_ids):
        self.repo = repo
        self.base_sha = base_sha
        self.branches = branches
        self.map = commutes_map
        self.folded = list(folded_ids)   # tasks folded before the next fold
        self.auto = 0                    # conflicts auto-resolved in this call
        self._touched = None

    def _touched_map(self):
        if self._touched is None:
            self._touched = {
                t.task_id: set(rw.diff_paths(self.repo, self.base_sha, t.ref))
                for t in self.branches}
        return self._touched

    def eligible(self, path, incoming):
        """True iff EVERY writer of `path` declared it commutative.

        Rev 7's unit is every writer, not a pair: the incoming task, plus
        every already-folded task whose `base..head` diff touches the path.
        For three writers of whom two declare, the path is undeclared.
        """
        if not self.map or path not in self.map.get(incoming, ()):
            return False
        touched = self._touched_map()
        return all(path in self.map.get(tid, ())
                   for tid in self.folded if path in touched.get(tid, ()))


def _commutes_map(pairs):
    """[(taskId, [paths])] -> {taskId: {paths}}; a repeated task unions."""
    out = {}
    for task_id, paths in pairs:
        out.setdefault(task_id, set()).update(paths)
    return out


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
        if recorded_fold != (branches[k].task_id, branches[k].ref):
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


def _verdict(conflict, manifest, contract=None):
    """(dispatchable, reason, hunks text, hunk count) for one conflict.

    `dispatchable` owns the routing predicate; derivation is what turns an
    eligible narration into the resolver's brief, so a narration the hunk
    grammar cannot delimit (a repo whose sources quote kernel marker forms)
    parks with a named reason rather than being guessed at. `contract` only
    adds a line to the brief — it can neither park nor unpark.
    """
    ok, reason = ff.dispatchable(conflict, manifest)
    try:
        text, blocks = hunks.derive(conflict.narration, contract=contract)
    except hunks.HunkError as exc:
        return False, "%s in %s" % (exc.reason, conflict.path), "", 0
    if ok and not blocks:
        return False, "no hunks derived for %s" % conflict.path, "", 0
    return ok, reason, text, len(blocks)


def _narrate(wave_dir, index, conflict, epoch, manifest, contract=None):
    """Write one conflict's narration + hunks brief; append its index entry.

    `<i>` is monotonic across every CLI call of the wave — the index is the
    key `open`/`waiting` carry, because `(path, epoch)` is not unique when a
    presence park shares the pair with a kernel conflict.
    """
    i = max((e["i"] for e in index), default=0) + 1
    (wave_dir / ("conflict-%d.txt" % i)).write_text(conflict.narration)
    ok, reason, text, count = _verdict(conflict, manifest, contract=contract)
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


def _auto_union(eng, wave_dir, entry, log_path):
    """The assume rung (spec §2b consumer 3): resolve one declared-commutative
    all-`added` conflict in process, with no resolver dispatch.

    The resolution is the KERNEL's own merged block body, applied through the
    same splice + `apply_resolution` path a resolver reply takes — so the log
    records an ordinary `resolve` event and rehydrate, replay, the K-gates and
    the epoch idempotency guard are all untouched.

    The safety ground is weave-inertness, not the self-checks: the union reply
    byte-equals the frontier's current visible lines for the path, and
    `update_state` is the identity on visible-equal lines, so the live fold
    sequence stays equal to the raw one the completion self-checks gate. That
    ground is only held while the body is `union_replies`' output — a caller
    that reshaped it (reordering, say) would lose it silently.

    False on every non-eligible shape — a `deleted` segment, a park, a
    presence/binary kind, a stale epoch — and the caller falls through to an
    ordinary open entry. No new refusal path.
    """
    if not entry["dispatchable"] or entry["kind"] not in ("lines", "add/add"):
        return False
    annotated = (wave_dir / ("conflict-%d.txt" % entry["i"])).read_text()
    # `dispatchable` is what `_verdict` sets after deriving this same text, so
    # the grammar has already passed here.
    _text, blocks = hunks.derive(annotated)
    replies = hunks.union_replies(annotated, blocks)
    if replies is None:
        return False
    lines = hunks.splice(annotated, replies, blocks)
    if not eng.apply_resolution(entry["path"], entry["epoch"], lines):
        return False
    _append_event(log_path, eng.events[-1])
    entry["autoResolved"] = True        # `dispatchable` stays True (rev 7, B2)
    return True


def _fold_until_stop(eng, states, remaining, log_path, wave_dir, index,
                     contracts=None):
    """Fold `remaining` in order, stopping at the first fold that opens a
    conflict no contract auto-resolved. Returns `(stop entries, remaining
    after, kernel park)`.

    The stop is signalled by NARRATION, not by dispatchability: a stop whose
    entries all parked is still a stop, and reporting it as "nothing opened"
    would claim a wave complete while tasks are still unfolded. Every fold
    that returns is recorded before the stop is narrated, so the log always
    describes exactly the frontier the narration was read off.

    The assume rung is the one exception to "narration stops the fold": a
    conflict every writer declared commutative is resolved here and never
    appears in `open`, so a fold whose conflicts ALL auto-resolve keeps going
    (spec §2b consumer 3). Dispatch stops and parks are unchanged.
    """
    for k, task in enumerate(remaining):
        task_id = task.task_id
        try:
            conflicts = eng.fold(states[task_id])
        except RecursionError:
            # `FrontierEngine.fold` assigns `self.frontier` only once
            # `rw.fold` has returned, so the raise leaves the engine exactly
            # at the previous task — the log truncates cleanly.
            return [], list(remaining[k:]), (task_id, states[task_id])
        event = {"type": "fold", "task": task_id, "headSha": task.ref}
        if task.patch is not None:
            # `headSha` is the derived TREE; `patch` is what rehydrate
            # re-derives it from, so the log + run dir are the whole record.
            event["patch"] = task.patch
        _append_event(log_path, event)
        if conflicts:
            epoch = eng.epoch()
            manifest = eng.manifest()
            open_entries = []
            for conflict in conflicts:
                eligible = (contracts is not None
                            and contracts.eligible(conflict.path, task_id))
                entry = _narrate(wave_dir, index, conflict, epoch, manifest,
                                 contract=CONTRACT_LINE if eligible else None)
                if eligible and _auto_union(eng, wave_dir, entry, log_path):
                    contracts.auto += 1
                    continue
                open_entries.append(entry)
            if open_entries:
                return open_entries, list(remaining[k + 1:]), None
        if contracts is not None:
            contracts.folded.append(task_id)
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
    except (rw.PatchError, ValueError) as e:
        # A recorded patch that no longer applies, or no longer yields the
        # recorded tree: the run directory disagrees with its own log.
        return "failed: rehydrate: %s" % e


def _write_kernel_park(wave_dir, index, epoch, park):
    """Record a mid-fold RecursionError as the named kernel-limit park.

    The wave is dead either way — the frontier omits the unfolded tasks — but
    the entry keeps the exit inside the documented contract and names the
    file whose depth outran the kernel thread's fixed limit.
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


def _undescended(repo, base_sha, branches):
    """The task heads the base is NOT an ancestor of: `[(taskId, headSha)]`.

    `rw.publish` diffs each head two-point against the base, so a head cut
    from a stale ref (a worktree the implementer never re-anchored) reads as
    "revert everything the base gained since" — folded, that reverted 3,472
    lines of an integration line on a green suite (#246). Such a head is the
    one input the fold cannot interpret; the caller refuses before writing
    anything, and the engine's fallback (an ordinary three-way merge) handles
    the stale parent correctly.

    Patch tasks are not checked: a patch is against the base by construction
    (it was applied over it to exist as a tree at all), and a tree has no
    ancestry for `merge-base` to test. The patch-side refusal is "does not
    apply", raised in `_resolve_tasks` before this runs.
    """
    stale = []
    for task in branches:
        if task.patch is not None:
            continue
        r = subprocess.run(["git", "-C", str(repo), "merge-base",
                            "--is-ancestor", base_sha, task.ref],
                           capture_output=True)
        if r.returncode != 0:
            stale.append((task.task_id, task.ref))
    return stale


def _refuse_undescended(repo, base_sha, branches, wave):
    """Exit-2 refusal path shared by `fold` and `resolve`: True when refused."""
    stale = _undescended(repo, base_sha, branches)
    if not stale:
        return False
    print("refusing wave %d: task head(s) not descended from base %s: %s — "
          "the worktree was cut from a stale ref; rebase or cherry-pick onto "
          "the base before folding (#246)"
          % (wave, base_sha[:7],
             ", ".join("%s=%s" % (t, h[:7]) for t, h in stale)),
          file=sys.stderr)
    return True


def _prepare(repo, base_sha, branches):
    """(base state, published task states, largest folded text file).

    The third element is the sensor reading alone — nothing routes on it. The
    base is scoped to the union of ALL supplied heads: the ordering contract,
    since a narrower scope would misclassify a path a later task also touches
    as an `add/add` instead of a `modify`.
    """
    touched = ff._union_touched(repo, base_sha, [t.ref for t in branches])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    states = {t.task_id: rw.publish(base, repo, base_sha, t.ref, task_id=t.task_id)
              for t in branches}
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
    for task_id in (t.task_id for t in branches):
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
    try:
        branches = _resolve_tasks(repo, base_sha, args.tasks)  # [TaskRef], argv order
    except rw.PatchError as e:
        print("refusing wave %d: %s" % (args.wave, e), file=sys.stderr)
        return 2
    all_ids = [t.task_id for t in branches]

    if _refuse_undescended(repo, base_sha, branches, args.wave):
        return 2
    base, states, max_lines = _prepare(repo, base_sha, branches)
    wave_dir.mkdir(parents=True, exist_ok=True)
    _record_max_lines(wave_dir, max_lines)
    index = []
    contracts = Contracts(repo, base_sha, branches,
                          _commutes_map(args.commutes), [])

    parks, kernel_park = _pre_scan(base, states, branches)

    if kernel_park is not None:
        epoch, task_id, state = kernel_park
        _write_kernel_park(wave_dir, index, epoch, (task_id, state))
        _write_jsonl(log_path, [{"type": "base", "sha": base_sha}])
        print(json.dumps({"clean": False, "conflicts": 1, "dispatchable": 0,
                          "parked": 1, "open": [], "remaining": all_ids,
                          "autoResolved": contracts.auto,
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
                          "autoResolved": contracts.auto,
                          "complete": False}))
        return 0

    eng = ff.FrontierEngine(base)
    _write_jsonl(log_path, [{"type": "base", "sha": base_sha}])
    stop, remaining, kernel_park = _fold_until_stop(
        eng, states, branches, log_path, wave_dir, index, contracts)
    _write_index(wave_dir / "conflicts.json", index)

    if kernel_park is not None:
        _write_kernel_park(wave_dir, index, eng.epoch(), kernel_park)
        print(json.dumps({"clean": False, "conflicts": len(index),
                          "dispatchable": 0, "parked": len(index),
                          "open": [], "remaining": [t.task_id for t in remaining],
                          "autoResolved": contracts.auto,
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
                          "remaining": [t.task_id for t in remaining],
                          "autoResolved": contracts.auto,
                          "complete": False}))
        return 0

    folded = [states[t.task_id] for t in branches]
    self_checks = _self_checks(repo, base, eng, folded, log_path)

    # `complete` is derived, never recorded: every task folded (nothing
    # narrated stopped the pass) and no narrated path left unresolved.
    unresolved = _unresolved_paths(wave_dir, _read_log(log_path))
    if unresolved:
        self_checks = "failed: %d narrated path(s) unresolved" % len(unresolved)
    # `clean` stays a raw-fold fact: an auto-unioned wave narrated a conflict,
    # so its index is non-empty and it is not clean.
    print(json.dumps({"clean": not index, "conflicts": 0, "dispatchable": 0,
                      "parked": 0, "open": [], "remaining": [],
                      "autoResolved": contracts.auto,
                      "complete": not unresolved, "selfChecks": self_checks}))
    return 0 if self_checks == "ok" else 3


def cmd_resolve(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if not log_path.exists():
        print("fold log missing for wave %d" % args.wave, file=sys.stderr)
        return 2

    repo = Path(args.repo)
    recorded = _read_log(log_path)
    base_sha = _log_base(recorded)
    if base_sha is None:
        print("log/list disagreement for wave %d: the fold log carries no base"
              % args.wave, file=sys.stderr)
        return 2
    try:
        branches = _resolve_tasks(repo, base_sha, args.tasks)
    except rw.PatchError as e:
        print("refusing wave %d: %s" % (args.wave, e), file=sys.stderr)
        return 2
    ok, remaining = _fold_prefix_check(recorded, branches, base_sha)
    if not ok:
        print("log/list disagreement for wave %d: the recorded folds are not a "
              "prefix of the supplied task list" % args.wave, file=sys.stderr)
        return 2
    if _refuse_undescended(repo, base_sha, branches, args.wave):
        return 2

    # The already-folded prefix is the log's own fold events, in order — the
    # both-sides condition counts every writer that has landed so far.
    contracts = Contracts(repo, base_sha, branches,
                          _commutes_map(args.commutes),
                          [e["task"] for e in recorded if e.get("type") == "fold"])

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
            eng, states, remaining, log_path, wave_dir, index, contracts)
        _write_index(wave_dir / "conflicts.json", index)

        if kernel_park is not None:
            _write_kernel_park(wave_dir, index, eng.epoch(), kernel_park)
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
                              "remaining": [t.task_id for t in remaining],
                              "autoResolved": contracts.auto,
                              "complete": False}))
            return 0

    folded = [states[t.task_id] for t in branches]
    self_checks = _self_checks(repo, base, eng, folded, log_path)

    # `complete` is derived, never recorded: every task folded and no
    # narrated path left unresolved.
    unresolved = _unresolved_paths(wave_dir, _read_log(log_path))
    if unresolved:
        print("wave %d folded every task but left %d narrated path(s) "
              "unresolved" % (args.wave, len(unresolved)), file=sys.stderr)
        return 3
    print(json.dumps({"applied": True, "open": [], "remaining": [],
                      "autoResolved": contracts.auto,
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


def _build_candidate(repo, prev_head, parents, wave, touched, manifest, modes):
    """The temporary-index route: seed from `prev_head`, apply the touched set,
    write the tree, commit it. Nothing here names a worktree path or a ref, so
    the checkout cannot move; the blobs land in the object store unreferenced
    until the engine adopts the candidate.

    `parents` are the task COMMITS to record beside `prev_head` — the
    `--task-head` shas. A `--patch` task has no commit, so it contributes no
    parent: under patch input the candidate is a plain commit on the
    integration line, and the task's provenance is the fold log, not the DAG.
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
        parent_args = []
        for sha in [prev_head] + list(parents):
            parent_args += ["-p", sha]
        return _git_env(repo, env, "commit-tree", tree, *parent_args,
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
    recorded = _read_log(log_path)
    base_sha = _log_base(recorded)
    if base_sha is None:
        return _park("fold log for wave %d carries no base" % args.wave)
    try:
        tasks = _resolve_tasks(repo, base_sha, args.tasks)   # [TaskRef], argv order
    except rw.PatchError as e:
        return _fallback(str(e))
    task_heads = [(t.task_id, t.ref) for t in tasks]
    heads = [e["headSha"] for e in recorded if e.get("type") == "fold"]

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

    try:
        eng = ff.rehydrate(repo, log_path)
    except RecursionError:
        return _fallback("kernel recursion limit rehydrating wave %d" % args.wave)
    except (rw.PatchError, ValueError) as e:
        return _fallback("rehydrating wave %d: %s" % (args.wave, e))
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

    candidate = _build_candidate(repo, args.prev_head,
                                 [t.ref for t in tasks if t.patch is None],
                                 args.wave, touched, manifest, modes)
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
    p_fold.add_argument("--branch", dest="tasks", action="append",
                        type=_branch_arg, default=[],
                        help="<taskId>=<branchName>:<headSha>; repeatable")
    p_fold.add_argument("--patch", dest="tasks", action="append",
                        type=_patch_arg, default=[],
                        help="<taskId>=<patchFile>, a `git diff --binary "
                             "--full-index --no-renames <BASE>`; repeatable, "
                             "in task-index order, mixable with --branch")
    p_fold.add_argument("--commutes", dest="commutes", action="append",
                        type=_parse_commutes, default=[],
                        help="a task's declared-commutative paths, "
                             "<taskId>=<path1,path2,...>; repeatable")
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
    p_resolve.add_argument("--branch", dest="tasks", action="append",
                           type=_branch_arg, default=[],
                           help="the wave's full task list, re-supplied on "
                                "every call in task-index order")
    p_resolve.add_argument("--patch", dest="tasks", action="append",
                           type=_patch_arg, default=[],
                           help="the patch-input form of --branch; same list, "
                                "same order, every call")
    p_resolve.add_argument("--commutes", dest="commutes", action="append",
                           type=_parse_commutes, default=[],
                           help="a task's declared-commutative paths, "
                                "<taskId>=<path1,path2,...>; repeatable")
    p_resolve.set_defaults(func=cmd_resolve)

    p_mat = sub.add_parser("materialize")
    p_mat.add_argument("--repo", required=True)
    p_mat.add_argument("--run-dir", required=True)
    p_mat.add_argument("--wave", required=True, type=int)
    p_mat.add_argument("--prev-head", required=True)
    p_mat.add_argument("--task-head", dest="tasks", action="append",
                       type=_head_arg, default=[],
                       help="<taskId>=<headSha>; repeatable")
    p_mat.add_argument("--patch", dest="tasks", action="append",
                       type=_patch_arg, default=[],
                       help="the patch-input form of --task-head: the same "
                            "patch files the fold was given")
    p_mat.add_argument("--allow-unresolved", action="store_true",
                       help="build the candidate even though conflicts.json "
                            "carries unresolved entries (forensics only — the "
                            "engine never passes this). Scoped to that term "
                            "alone: an unfolded task still refuses.")
    p_mat.set_defaults(func=cmd_materialize)

    args = parser.parse_args(argv)
    if not args.tasks:
        # One shared destination, so neither flag can be `required` on its
        # own: the wave must name at least one task, in either shape.
        parser.error("%s needs at least one task: --branch or --patch%s"
                     % (args.command,
                        " (or --task-head)" if args.command == "materialize" else ""))
    # Every subcommand drives the kernel's recursive merge walk, so the whole
    # body runs on the big-stack thread; the result (and any exception) comes
    # straight back, leaving the exit contract untouched.
    return run_on_kernel_thread(args.func, args)


if __name__ == "__main__":
    sys.exit(main())
