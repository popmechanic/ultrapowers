"""Arm G: the same wave, folded by plain git instead of by the kernel.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable C). The comparator needs a second, independent answer for the
same fold, and the only credible one is git's: replay the wave's recorded
tasks as ordinary commits over the wave base and merge them sequentially.

    scratch clone at <base_sha>
      task i:  git apply --index <patch_i>  ; git commit      -> commit_i
      integration: git merge -s ort -X no-renames commit_1 ... commit_n

`-X no-renames` is not incidental. The kernel's own patches are captured with
`--no-renames`, so a rename-detecting merge would be answering a different
question than the arm it is being compared against.

**Conflicts do not stop the arm.** Stopping at the first conflict would leave
every later path unanswered, and an unanswered path is class 2 — a divergence
the comparator would then report against a fold that never diverged. So each
conflicted path is recorded `"contended"` (its content is excluded from
comparison by construction) and the merge is *completed* so the wave can carry
on: with the weave's own content when the weave is clean there, and with
`--ours` when it is not, since that path is class-5 material either way.

Offline and deterministic: git only, a fixed identity and clock, and every
byte written under the caller's `work` directory.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import classify  # noqa: E402
import corpuslib  # noqa: E402

_FIXED_DATE = "2026-08-31T00:00:00+00:00"


def _env():
    """A git environment with no identity, config or clock of its own."""
    return dict(os.environ,
                GIT_AUTHOR_NAME="fold corpus arm G",
                GIT_AUTHOR_EMAIL="armg@example.invalid",
                GIT_COMMITTER_NAME="fold corpus arm G",
                GIT_COMMITTER_EMAIL="armg@example.invalid",
                GIT_AUTHOR_DATE=_FIXED_DATE,
                GIT_COMMITTER_DATE=_FIXED_DATE,
                GIT_CONFIG_GLOBAL=os.devnull,
                GIT_CONFIG_SYSTEM=os.devnull,
                TZ="UTC")


def _run(cwd, *args, text=True):
    return subprocess.run(["git", "-C", str(cwd), *args],
                          capture_output=True, text=text, env=_env())


def _git(cwd, *args, text=True):
    result = _run(cwd, *args, text=text)
    if result.returncode != 0:
        err = result.stderr if text else result.stderr.decode(errors="replace")
        raise RuntimeError("git %s failed: %s" % (" ".join(args), err.strip()))
    return result.stdout


def _clone(repo: Path, base_sha: str, work: Path) -> Path:
    """A scratch clone of `repo`, detached at `base_sha`.

    `--shared` so the clone sees every object the source has, not only what its
    refs reach — a corpus base sha may sit on an archived integration line.
    """
    work.mkdir(parents=True, exist_ok=True)
    clone = work / "arm-git"
    _git(work, "clone", "--quiet", "--shared", "--no-checkout", str(repo), str(clone))
    _git(clone, "checkout", "--quiet", "--detach", base_sha)
    return clone


def _tasks(entry):
    """`[(taskId, patch path)]` in fold-log order; branch-mode tasks are refused."""
    out = []
    log = Path(entry.wave_dir) / "fold_log.jsonl"
    for line in log.read_text().splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") != "fold":
            continue
        if not event.get("patch"):
            raise ValueError("arm G replays patch tasks; task %r in %s wave %d has no patch"
                             % (event.get("task"), entry.run_id, entry.wave))
        out.append((event["task"], Path(entry.wave_dir) / event["patch"]))
    return out


def _unmerged(clone):
    """The conflicted paths of the merge in progress, deduplicated, sorted."""
    out = _git(clone, "diff", "--name-only", "--diff-filter=U", "-z")
    return sorted({name for name in out.split("\0") if name})


def _complete_conflict(clone, path, weave):
    """Stage a conflicted path so the merge can be committed and the wave go on."""
    answer = weave.per_path.get(path) if weave is not None else None
    if answer is not None and answer.status == "clean":
        if answer.content is None:                  # the weave's clean answer is a deletion
            _run(clone, "rm", "--quiet", "-f", "--", path)
            return
        (Path(clone) / path).parent.mkdir(parents=True, exist_ok=True)
        (Path(clone) / path).write_bytes(answer.content)
    else:
        # Not clean on the weave arm either: class-5 material, whose content is
        # excluded from comparison. `--ours` keeps the integration line's side.
        _run(clone, "checkout", "--ours", "--", path)
    added = _run(clone, "add", "--", path)
    if added.returncode != 0:                       # e.g. a modify/delete conflict
        _run(clone, "rm", "--quiet", "-f", "--", path)


def _read_tree(clone, paths):
    """`{path: PathAnswer}` for `paths`, read out of the clone's HEAD tree."""
    present = {name for name in
               _git(clone, "ls-tree", "-r", "--name-only", "-z", "HEAD").split("\0") if name}
    answers = {}
    for path in paths:
        if path not in present:
            # Touched by the wave and absent from the result: a deletion that
            # survived. `None` content is what the weave arm reports too.
            answers[path] = corpuslib.PathAnswer("clean", None)
            continue
        content = _git(clone, "cat-file", "blob", "HEAD:%s" % path, text=False)
        answers[path] = corpuslib.PathAnswer("binary" if b"\x00" in content else "clean", content)
    return answers


def git_answer(repo, entry, weave, work=None):
    """Replay one corpus wave through plain git; return its `ArmResult`.

    `weave` is the other arm's answer, consulted only to complete conflicts —
    the arm never copies a clean path's content from it, so the two answers
    stay independent everywhere the comparator compares them.

    `work` is where the scratch clone is built; a temporary directory is used
    and removed when it is omitted. `complete` is False when a patch would not
    apply or a merge failed for a reason that was not a conflict; the arm still
    returns every answer it did reach.
    """
    if work is None:
        with tempfile.TemporaryDirectory(prefix="arm-git-") as tmp:
            return git_answer(repo, entry, weave, work=Path(tmp))

    tasks = _tasks(entry)
    clone = _clone(Path(repo), entry.base_sha, Path(work))
    touched, complete = [], True
    for _, patch in tasks:
        for path in classify.patch_paths(patch.read_text(errors="replace")):
            if path not in touched:
                touched.append(path)

    commits = []
    for task_id, patch in tasks:
        _git(clone, "checkout", "--quiet", "--detach", entry.base_sha)
        applied = _run(clone, "apply", "--index", "--whitespace=nowarn", str(patch))
        if applied.returncode != 0:
            complete = False        # recorded, never silent: `complete` is the signal
            continue
        _git(clone, "commit", "--quiet", "--allow-empty", "-m", "task %s" % task_id)
        commits.append((task_id, _git(clone, "rev-parse", "HEAD").strip()))

    contended = set()
    _git(clone, "checkout", "--quiet", "--detach", entry.base_sha)
    for _, sha in commits:
        merged = _run(clone, "merge", "-s", "ort", "-X", "no-renames", "--no-edit", sha)
        if merged.returncode == 0:
            continue
        conflicted = _unmerged(clone)
        if not conflicted:          # failed for something other than a conflict
            _run(clone, "merge", "--abort")
            complete = False
            break
        contended.update(conflicted)
        for path in conflicted:
            _complete_conflict(clone, path, weave)
        _git(clone, "commit", "--quiet", "--no-edit")

    answers = _read_tree(clone, touched)
    for path in contended:
        prior = answers.get(path)
        content = prior.content if prior is not None else None
        # A binary path stays binary: its content is excluded from comparison
        # whether or not the merge stopped on it.
        if prior is not None and prior.status == "binary":
            continue
        answers[path] = corpuslib.PathAnswer("contended", content)
    return corpuslib.ArmResult(answers, complete)
