"""Arm W of the fold-corpus replayer: the weave's answer for one recorded
wave, plus the two re-checks that say whether the record can be trusted.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable C). Three functions over one `corpuslib.CorpusEntry`:

* `weave_answer`   — what the weave produced, read off the record;
* `integrity_check`— does every recorded patch still yield its recorded tree;
* `determinism_check` — does a fresh fold over the same inputs land where the
  record says it did.

**The record is the answer.** `weave_answer` rehydrates the wave's own
`fold_log.jsonl` — `fold` events AND `resolve` events — rather than re-folding
from the patches: a fresh `fold` stops at the first conflict it cannot
auto-union (`FOLD_LOG.md`, "Folding is incremental"), so it has no answer at
all for a contended wave, while the log carries the resolution that actually
applied. Re-deriving would also silently drop every resolver reply the run
really made.

Offline and deterministic: git plus the corpus directory, no network and no
model calls. The one process-global effect is a chdir, described on `_in_dir`.
"""
import contextlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
FOLD_WAVE = KERNEL / "fold_wave.py"
# Import path per the mechanism `tests/test_frontier_kernel.py` already uses.
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import classify as classify_mod  # noqa: E402
import fold_wave  # noqa: E402
import frontier_fold as ff  # noqa: E402
import repo_weave as rw  # noqa: E402
from corpuslib import ArmResult, PathAnswer  # noqa: E402

LOG_NAME = "fold_log.jsonl"
INDEX_NAME = "conflicts.json"


@contextlib.contextmanager
def _in_dir(path):
    """Run the body with `path` as the working directory, always restored.

    The corpus records every `fold` event's `patch` as a corpus-RELATIVE name
    (`corpuslib`, `_localize`) so a corpus that moves keeps working, and
    `rehydrate` re-reads that field verbatim. Resolving it therefore means
    standing in the wave directory — the alternative, handing `rehydrate` a
    rewritten copy of the log, would replay something other than the record.

    Process-global, so this is not safe under a thread-parallel runner; the
    suite runs single-process (`pytest -p no:xdist`).
    """
    prior = os.getcwd()
    os.chdir(str(path))
    try:
        yield
    finally:
        os.chdir(prior)


def _read_log(wave_dir):
    """The wave's recorded events, or [] when it has no log."""
    path = Path(wave_dir) / LOG_NAME
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines()
            if line.strip()]


def _read_index(wave_dir):
    """The wave's conflicts index, or [] when nothing was ever narrated."""
    path = Path(wave_dir) / INDEX_NAME
    return json.loads(path.read_text()) if path.exists() else []


def _base_sha(events, entry):
    """The base the log opens with; the index's column is the fallback."""
    if events and events[0].get("type") == "base":
        return events[0]["sha"]
    return entry.base_sha


def _patch_path(wave_dir, recorded):
    """A recorded `patch` field resolved against the wave directory.

    Corpus logs carry relative names; a raw run's log carries the absolute
    path the CLI recorded. Both resolve here.
    """
    path = Path(recorded)
    return path if path.is_absolute() else Path(wave_dir) / path


def _folded_tasks(events):
    return [e["task"] for e in events if e.get("type") == "fold"]


def _conflict_set(wave_dir):
    """`{(path, kind)}` — conflict identity is `(path, kind)`, exactly as
    `repo_weave.Conflict.__eq__` defines it: the narration and the reporting
    task vary with fold order, so neither can be compared across folds."""
    return {(e.get("path"), e.get("kind")) for e in _read_index(wave_dir)}


def _completeness(wave_dir, events, entry):
    """`(complete, unresolved paths)` by the FOLD_LOG rule.

    `complete` is derived, never recorded: every task folded and no narrated
    path left unresolved. The unresolved half is the kernel's own derivation
    (`fold_wave._unresolved_paths`) rather than a second copy of the rule —
    the replayer exists to check the record against the kernel, so it must
    not carry its own opinion of what "unresolved" means.
    """
    unresolved = fold_wave._unresolved_paths(Path(wave_dir), events)
    folded = set(_folded_tasks(events))
    all_folded = all(task_id in folded for task_id in entry.tasks)
    return (not unresolved and all_folded), unresolved


def weave_answer(repo, entry):
    """The weave's per-path answer for `entry` — `ArmResult`.

    Per path: `"contended"` for a path whose last narration carries no
    resolution at-or-after its epoch, `"binary"` for a non-text candidate
    (excluded from content comparison), else `"clean"` with the folded bytes.
    Contended and binary answers carry no content: there is nothing the arms
    can compare there, and a body would invite a comparison that means
    nothing.

    Raises `ValueError` (from `rehydrate`) when a recorded patch no longer
    yields its recorded tree — that record cannot be replayed at all, and
    `integrity_check` is the function that reports it rather than raising.
    """
    wave_dir = Path(entry.wave_dir)
    events = _read_log(wave_dir)
    with _in_dir(wave_dir):
        # The kernel's recursive merge walk gets the big stack here exactly as
        # it does under the CLI; a real corpus carries real file sizes.
        engine = fold_wave.run_on_kernel_thread(ff.rehydrate, repo,
                                                wave_dir / LOG_NAME)
    manifest = engine.manifest()

    complete, unresolved = _completeness(wave_dir, events, entry)
    # A kernel-limit park is unresolved without naming a path; it holds the
    # wave incomplete but is nobody's per-path answer.
    narrated = {e["path"] for e in _read_index(wave_dir) if e.get("path")}
    contended = set(unresolved) & narrated

    per_path = {}
    for path in sorted(set(manifest) | contended):
        content = manifest.get(path)
        if path in contended:
            per_path[path] = PathAnswer("contended")
        elif isinstance(content, bytes):
            per_path[path] = PathAnswer("binary")
        else:
            per_path[path] = PathAnswer("clean", content.encode())

    # A path a task deleted is absent from the manifest by design
    # (`repo_weave` keeps no tombstone-only paths), while Arm G reports a
    # deletion as `("clean", None)`. Emit the same shape for every
    # wave-touched path the manifest dropped, or an agreed whole-file
    # deletion reads as an unexplained class 2 (run-34 critic, blocking).
    touched = set()
    for _task_id, text in classify_mod.task_patches(entry):
        touched.update(classify_mod.patch_paths(text))
    for path in sorted(touched - set(per_path)):
        per_path[path] = PathAnswer("clean", None)
    return ArmResult(per_path=per_path, complete=complete)


def integrity_check(repo, entry):
    """Named failures where a recorded patch no longer yields its recorded
    tree; `[]` is a clean record.

    The patch file is the durable record — the tree it yields is unreferenced
    in the object store and may be pruned — so this is the one check that says
    whether the corpus still describes the fold it was extracted from. A patch
    that no longer applies at all is reported the same way, not raised: a
    damaged corpus entry is a finding, not a crash.
    """
    wave_dir = Path(entry.wave_dir)
    events = _read_log(wave_dir)
    if not events:
        return ["wave %s/%d has no %s" % (entry.run_id, entry.wave, LOG_NAME)]
    if events[0].get("type") != "base":
        return ["wave %s/%d: fold log does not open with a base event"
                % (entry.run_id, entry.wave)]
    base_sha = _base_sha(events, entry)

    failures = []
    for event in events:
        if event.get("type") != "fold" or not event.get("patch"):
            continue
        patch = _patch_path(wave_dir, event["patch"])
        try:
            tree = rw.apply_patch_tree(repo, base_sha, patch)
        except rw.PatchError as exc:
            failures.append("task %s: patch %s no longer applies over base %s: %s"
                            % (event["task"], event["patch"], base_sha[:7], exc))
            continue
        if tree != event["headSha"]:
            failures.append("task %s: patch %s yields tree %s, log records %s"
                            % (event["task"], event["patch"], tree[:7],
                               event["headSha"][:7]))
    return failures


def _task_specs(entry, events, wave_dir):
    """`[(flag, value)]` for the fresh fold's task list, in task-index order.

    The recorded `fold` events name each task's input; a task the fold never
    reached (it stopped at a conflict first) has none, and falls back to the
    corpus's `task-<id>.patch` convention. Raises `LookupError` when a task
    cannot be re-supplied at all — the caller reports it as a divergence.
    """
    by_task = {e["task"]: e for e in events if e.get("type") == "fold"}
    task_ids = list(entry.tasks) or _folded_tasks(events)
    specs = []
    for task_id in task_ids:
        event = by_task.get(task_id)
        if event is not None and event.get("patch"):
            specs.append(("--patch", "%s=%s"
                          % (task_id, _patch_path(wave_dir, event["patch"]))))
        elif event is not None:
            # Branch input: only the head sha is read back, but `--branch`
            # wants the name the run used, which the log does not record.
            specs.append(("--branch", "%s=replay/%s:%s"
                          % (task_id, task_id, event["headSha"])))
        elif (wave_dir / ("task-%s.patch" % task_id)).exists():
            specs.append(("--patch", "%s=%s"
                          % (task_id, wave_dir / ("task-%s.patch" % task_id))))
        else:
            raise LookupError("no recorded input for task %s" % task_id)
    return specs


def _fold_env():
    """git with no config of its own: the re-fold must not depend on the
    machine it re-runs on. No identity is needed — `fold` writes trees through
    a temporary index and commits nothing."""
    return dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull,
                GIT_CONFIG_SYSTEM=os.devnull, TZ="UTC")


def _manifest_divergence(recorded, fresh):
    """The paths on which two manifests disagree, or None."""
    differing = sorted(p for p in set(recorded) | set(fresh)
                       if recorded.get(p) != fresh.get(p))
    if not differing:
        return None
    return "manifest diverges at %s" % ", ".join(differing)


def _determinism_check(repo, entry):
    wave_dir = Path(entry.wave_dir)
    events = _read_log(wave_dir)
    if not events:
        raise LookupError("wave %s/%d has no %s under %s"
                          % (entry.run_id, entry.wave, LOG_NAME, wave_dir))
    base_sha = _base_sha(events, entry)
    specs = _task_specs(entry, events, wave_dir)

    with tempfile.TemporaryDirectory(prefix="arm-weave-refold-") as scratch:
        cmd = [sys.executable, str(FOLD_WAVE), "fold", "--repo", str(repo),
               "--run-dir", scratch, "--wave", str(entry.wave),
               "--base", base_sha]
        for flag, value in specs:
            cmd += [flag, value]
        for task_id, paths in sorted(entry.commutes.items()):
            cmd += ["--commutes", "%s=%s" % (task_id, ",".join(paths))]
        result = subprocess.run(cmd, capture_output=True, text=True,
                                env=_fold_env())
        fresh_dir = Path(scratch) / "frontier" / ("wave-%d" % entry.wave)
        if not (fresh_dir / LOG_NAME).exists():
            return _diverged("fresh fold produced no log (exit %d): %s"
                             % (result.returncode,
                                (result.stderr or result.stdout).strip()))

        recorded_conflicts = _conflict_set(wave_dir)
        fresh_conflicts = _conflict_set(fresh_dir)
        if recorded_conflicts != fresh_conflicts:
            return _diverged(
                "conflict set diverges: recorded %s, fresh fold %s"
                % (_show(recorded_conflicts), _show(fresh_conflicts)))

        # The manifest is only comparable when BOTH folds ran to the end: a
        # fresh fold stops at the first conflict no contract unions, so for a
        # wave a resolver completed its frontier is a prefix of the record's,
        # not a competing answer to it.
        complete, _unresolved = _completeness(wave_dir, events, entry)
        try:
            fresh_complete = bool(json.loads(result.stdout).get("complete"))
        except (ValueError, AttributeError):
            fresh_complete = False
        if not (complete and fresh_complete):
            return {"matches": True, "divergence": None}

        with _in_dir(wave_dir):
            recorded_manifest = fold_wave.run_on_kernel_thread(
                ff.rehydrate, repo, wave_dir / LOG_NAME).manifest()
        fresh_manifest = fold_wave.run_on_kernel_thread(
            ff.rehydrate, repo, fresh_dir / LOG_NAME).manifest()
        divergence = _manifest_divergence(recorded_manifest, fresh_manifest)
        if divergence:
            return _diverged(divergence)
    return {"matches": True, "divergence": None}


def _show(conflicts):
    return "[%s]" % ", ".join("%s (%s)" % pair for pair in sorted(conflicts))


def _diverged(why):
    return {"matches": False, "divergence": why}


def determinism_check(repo, entry):
    """`{"matches": bool, "divergence": str | None}` for one recorded wave.

    Re-folds the wave's own inputs — same base, same task order, same
    `--commutes` declaration — through the real CLI into a scratch run
    directory, and compares what comes out against the record: the conflict
    set always, and the manifest when both folds ran to completion.

    Nothing here raises. A corpus entry that cannot be re-folded at all — a
    missing log, an input no longer on disk, a refusing CLI — is exactly the
    finding this check exists to surface, so it is reported in `divergence`
    rather than thrown at a caller replaying a whole corpus.
    """
    try:
        return _determinism_check(repo, entry)
    except Exception as exc:            # noqa: BLE001 - reported, never raised
        return _diverged("re-fold failed: %s: %s" % (type(exc).__name__, exc))
