#!/usr/bin/env python3
"""fold_wave — the wave-scoped CLI over the frontier kernel (spec
2026-08-12, component 3).

`fold` runs one wave's completed tasks through a fresh `FrontierEngine` and
writes its self-sufficient record: `fold_log.jsonl` (schema in
`kernel/FOLD_LOG.md`), one narration file per conflict (`conflict-<i>.txt`),
and the conflicts index (`conflicts.json`). It then runs both live self-checks
(K1 raw-shuffle order-independence and log-replay-reproduces-manifest) before
reporting.

`resolve` applies one resolver reply against a rehydrated engine. A valid
reply is appended to the log; a stale one is re-narrated exactly once — the
frontier's current whole file, markerless, since re-folding narrates nothing.

Every invocation is a fresh process: neither subcommand carries anything in
memory from the last one, per the fold log's self-sufficiency contract.

Exit codes: 0 success, 2 precondition refusal, 3 self-check failure (which
includes a kernel recursion limit the sized bound could not absorb — recorded
as a named kernel-limit park in the conflicts index, never a crash).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw
import frontier_fold as ff

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


def _renarration_dispatchable(body):
    """Size/type gate for a re-narration reply.

    The frontier's current whole file is markerless by construction
    (`manifest` never embeds conflict markers), so `dispatchable`'s marker
    gate never applies here — only the cap/text half of its predicate does.
    """
    if not isinstance(body, str):
        return False, "non-text manifest content"
    n = len(rw.split_lines(body))
    if n > ff.RESOLVER_LINE_CAP:
        return False, "%d exceeds %d visible lines" % (n, ff.RESOLVER_LINE_CAP)
    return True, ""


def cmd_fold(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if log_path.exists():
        print("fold log already exists for wave %d" % args.wave, file=sys.stderr)
        return 2

    repo = Path(args.repo)
    base_sha = args.base
    branches = args.branches  # [(taskId, branchName, headSha)], argv order

    touched = ff._union_touched(repo, base_sha, [h for _, _, h in branches])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    # Publish every task before folding any of them: `publish` is iterative,
    # so this costs no stack, and it puts the whole corpus in hand to size the
    # recursion bound from. (The scope is still the union derived above — the
    # union-then-fold ordering contract is unaffected.)
    states = {task_id: rw.publish(base, repo, base_sha, head_sha, task_id=task_id)
              for task_id, _branch_name, head_sha in branches}

    eng = ff.FrontierEngine(base)
    folded = []         # the TaskStates that actually folded, in fold order
    all_conflicts = []  # [(Conflict, epoch)] in fold order
    log_events = [{"type": "base", "sha": base_sha}]
    kernel_park = None

    with _recursion_headroom(_state_max_lines(base, states)) as headroom:
        for task_id, _branch_name, head_sha in branches:
            state = states[task_id]
            try:
                conflicts = eng.fold(state)
            except RecursionError:
                # `FrontierEngine.fold` assigns `self.frontier` only once
                # `rw.fold` has returned, so the raise leaves the engine
                # exactly at the previous task — the log truncates cleanly.
                kernel_park = (task_id, state, headroom.bound)
                break
            folded.append(state)
            log_events.append({"type": "fold", "task": task_id, "headSha": head_sha})
            epoch = eng.epoch()
            for c in conflicts:
                all_conflicts.append((c, epoch))

        wave_dir.mkdir(parents=True, exist_ok=True)
        _write_jsonl(log_path, log_events)

        manifest = eng.manifest()
        index = []
        for i, (c, epoch) in enumerate(all_conflicts, start=1):
            (wave_dir / ("conflict-%d.txt" % i)).write_text(c.narration)
            ok, reason = ff.dispatchable(c, manifest)
            index.append({"i": i, "path": c.path, "kind": c.kind,
                          "dispatchable": ok, "reason": reason, "epoch": epoch})
        if kernel_park is not None:
            entry = _kernel_limit_entry(len(index) + 1, eng.epoch(), *kernel_park)
            # Every index entry keeps a `conflict-<i>.txt`; a park that never
            # reached a narration carries its reason there instead.
            (wave_dir / ("conflict-%d.txt" % entry["i"])).write_text(
                entry["reason"] + "\n")
            index.append(entry)
        _write_index(wave_dir / "conflicts.json", index)

        if kernel_park is not None:
            # The wave is dead: the frontier omits the unfolded tasks, so the
            # engine must route to fallback rather than adopt a partial tree.
            self_checks = "failed: kernel recursion limit folding task %s" % (
                kernel_park[0],)
        else:
            try:
                if len(ff.raw_shuffle_outcomes(base, folded, sample_seed=42)) != 1:
                    self_checks = "failed: raw shuffle order-independence"
                elif ff.rehydrate(repo, log_path).manifest() != manifest:
                    self_checks = "failed: rehydrate manifest replay"
                else:
                    self_checks = "ok"
            except RecursionError:
                self_checks = "failed: kernel recursion limit in self-checks"

    dispatchable_n = sum(1 for e in index if e["dispatchable"])
    print(json.dumps({"clean": not index,
                      "conflicts": len(index),
                      "dispatchable": dispatchable_n,
                      "parked": len(index) - dispatchable_n,
                      "selfChecks": self_checks}))
    return 0 if self_checks == "ok" else 3


def cmd_resolve(args):
    wave_dir = _wave_dir(args.run_dir, args.wave)
    log_path = wave_dir / "fold_log.jsonl"
    if not log_path.exists():
        print("fold log missing for wave %d" % args.wave, file=sys.stderr)
        return 2

    repo = Path(args.repo)
    recorded = [json.loads(line)
                for line in rw.split_lines(log_path.read_text()) if line.strip()]
    base_sha = recorded[0]["sha"] if recorded and recorded[0].get("type") == "base" else None
    heads = [e["headSha"] for e in recorded if e.get("type") == "fold"]
    max_lines = _git_max_lines(repo, base_sha, heads) if base_sha else 0

    with _recursion_headroom(max_lines):
        try:
            eng = ff.rehydrate(repo, log_path)
        except RecursionError:
            print("kernel recursion limit rehydrating wave %d" % args.wave,
                  file=sys.stderr)
            return 3

        reply_text = Path(args.reply_file).read_text(encoding="utf-8")
        lines = rw.split_lines(reply_text)

        if eng.apply_resolution(args.path, args.epoch, lines):
            with log_path.open("a") as f:
                f.write(json.dumps(eng.events[-1]) + "\n")
            print(json.dumps({"applied": True}))
            return 0

        index_path = wave_dir / "conflicts.json"
        index = _read_index(index_path)
        next_i = max((e["i"] for e in index), default=0) + 1
        new_epoch = eng.epoch()
        body = eng.manifest().get(args.path)

    ok, reason = _renarration_dispatchable(body)
    kind = next((e["kind"] for e in reversed(index) if e["path"] == args.path), "lines")

    renarration_file = wave_dir / ("conflict-%d.txt" % next_i)
    renarration_file.write_text(body if isinstance(body, str) else "")
    index.append({"i": next_i, "path": args.path, "kind": kind,
                  "dispatchable": ok, "reason": reason, "epoch": new_epoch,
                  "renarration": True})
    _write_index(index_path, index)

    print(json.dumps({"applied": False, "stale": True,
                      "renarrationFile": str(renarration_file),
                      "epoch": new_epoch}))
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
    p_resolve.add_argument("--path", required=True)
    p_resolve.add_argument("--epoch", required=True, type=int)
    p_resolve.add_argument("--reply-file", required=True)
    p_resolve.set_defaults(func=cmd_resolve)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
