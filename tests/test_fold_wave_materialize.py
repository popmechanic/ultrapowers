"""fold_wave.py `materialize` — the temporary-index route from a folded wave
to a candidate commit.

Everything here is pinned against real git objects, never against the CLI's
own bookkeeping: the candidate's parents, its tree entries (content AND mode),
and — the property the temporary index exists for — that the repository's
worktree and branch refs are exactly where they were before the invocation.

Every scenario builds its own `tmp_path` git repo; no shared fixtures.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import repo_weave as rw  # noqa: E402


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _git_bytes(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True).stdout


def _init(repo):
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "integration")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


def run_cli(*args):
    return subprocess.run([sys.executable, CLI, *args],
                          capture_output=True, text=True)


def do_fold(repo, run_dir, wave, base_sha, branch_specs):
    """branch_specs: [(taskId, headSha), ...] in task-index order."""
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base_sha]
    for tid, sha in branch_specs:
        args += ["--branch", "%s=%s:%s" % (tid, tid, sha)]
    return run_cli(*args)


def do_materialize(repo, run_dir, wave, prev_head, task_heads):
    args = ["materialize", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--prev-head", prev_head]
    for tid, sha in task_heads:
        args += ["--task-head", "%s=%s" % (tid, sha)]
    return run_cli(*args)


def last_json(result):
    return json.loads(result.stdout.strip().splitlines()[-1])


def tree_entries(repo, ref):
    """path -> (mode, type, sha) for the whole tree at `ref`."""
    out = _git_bytes(repo, "ls-tree", "-r", "-z", ref).decode()
    entries = {}
    for record in filter(None, out.split("\0")):
        meta, path = record.split("\t", 1)
        mode, obj_type, sha = meta.split(" ")
        entries[path] = (mode, obj_type, sha)
    return entries


def parents_of(repo, sha):
    return _git(repo, "rev-list", "--parents", "-n", "1", sha).split()[1:]


def commit_and_capture(repo, message):
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message)
    return _git(repo, "rev-parse", "HEAD")


def make_repo(tmp_path):
    """One base commit on `integration`, two task branches off it.

    Base tree:
      app.py    100644  three independent lines
      other.txt 100644  deleted by t2
      run.sh    100755  content-edited by t1 (a FOLDED executable)
      tool.sh   100755  touched by nobody
      link.txt  120000  symlink to tool.sh, touched by nobody

    t1 edits app.py's first line and run.sh; t2 edits app.py's last line,
    deletes other.txt, and creates new.sh with mode 100755. The two app.py
    edits are on different lines, so the wave folds clean.
    """
    repo = tmp_path / "repo"
    _init(repo)
    (repo / "app.py").write_text("a = 1\nb = 1\nc = 1\n")
    (repo / "other.txt").write_text("hello\n")
    (repo / "run.sh").write_text("#!/bin/sh\necho base\n")
    os.chmod(repo / "run.sh", 0o755)
    (repo / "tool.sh").write_text("#!/bin/sh\necho tool\n")
    os.chmod(repo / "tool.sh", 0o755)
    os.symlink("tool.sh", repo / "link.txt")
    base_sha = commit_and_capture(repo, "base")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text("a = 2\nb = 1\nc = 1\n")
    (repo / "run.sh").write_text("#!/bin/sh\necho t1\n")
    t1_sha = commit_and_capture(repo, "t1")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "app.py").write_text("a = 1\nb = 1\nc = 2\n")
    (repo / "other.txt").unlink()
    (repo / "new.sh").write_text("#!/bin/sh\necho new\n")
    os.chmod(repo / "new.sh", 0o755)
    t2_sha = commit_and_capture(repo, "t2")

    _git(repo, "checkout", "-q", "integration")
    return repo, base_sha, [("t1", t1_sha), ("t2", t2_sha)]


def folded_candidate(tmp_path):
    """make_repo + a clean fold + materialize; returns everything asserted on."""
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    fold = do_fold(repo, run_dir, 1, base_sha, heads)
    assert fold.returncode == 0, fold.stdout + fold.stderr

    result = do_materialize(repo, run_dir, 1, base_sha, heads)
    assert result.returncode == 0, result.stdout + result.stderr
    candidate = last_json(result)["candidateSha"]
    return repo, base_sha, heads, candidate


# --- the candidate commit -------------------------------------------------


def test_materialize_builds_candidate_with_touched_set_and_parents(tmp_path):
    repo, base_sha, heads, candidate = folded_candidate(tmp_path)

    assert _git(repo, "cat-file", "-t", candidate) == "commit"
    assert parents_of(repo, candidate) == [base_sha] + [s for _, s in heads]

    # The folded content of the contested path reached the tree: t1's first
    # line and t2's last line, in one file.
    assert _git_bytes(repo, "show", "%s:app.py" % candidate) == b"a = 2\nb = 1\nc = 2\n"

    # The temporary index is the whole point: nothing moved in the checkout.
    assert _git(repo, "status", "--porcelain") == ""
    assert _git(repo, "rev-parse", "HEAD") == base_sha
    assert _git(repo, "rev-parse", "integration") == base_sha
    assert _git(repo, "symbolic-ref", "HEAD") == "refs/heads/integration"
    # The candidate is an object, not a ref: no branch points at it.
    assert candidate not in _git(repo, "for-each-ref", "--format=%(objectname)")


def test_materialize_deletion_reaches_tree_untouched_paths_survive(tmp_path):
    repo, base_sha, _heads, candidate = folded_candidate(tmp_path)

    base_tree = tree_entries(repo, base_sha)
    cand_tree = tree_entries(repo, candidate)

    # t2's `git rm` reaches the tree. The fold manifest omits deletions, so
    # keying on the manifest alone (rather than on the touched set) would
    # silently resurrect this path from the seeded index.
    assert "other.txt" in base_tree
    assert "other.txt" not in cand_tree

    # Paths outside the touched set are never visited, so their modes and
    # link targets survive byte-for-byte — entry identical to the base's.
    assert cand_tree["tool.sh"] == base_tree["tool.sh"]
    assert cand_tree["tool.sh"][0] == "100755"
    assert cand_tree["link.txt"] == base_tree["link.txt"]
    assert cand_tree["link.txt"][0] == "120000"
    assert _git_bytes(repo, "show", "%s:link.txt" % candidate) == b"tool.sh"


def test_materialize_folded_path_keeps_base_mode_and_created_path_takes_creator_mode(tmp_path):
    repo, _base_sha, _heads, candidate = folded_candidate(tmp_path)
    cand_tree = tree_entries(repo, candidate)

    # Folded executable: the mode comes from the previous integration head,
    # not from the mode-blind text pipeline (which would rebuild it 100644).
    assert cand_tree["run.sh"][0] == "100755"
    assert _git_bytes(repo, "show", "%s:run.sh" % candidate) == b"#!/bin/sh\necho t1\n"

    # A path the fold ADDS takes its creating task's mode.
    assert cand_tree["new.sh"][0] == "100755"
    assert _git_bytes(repo, "show", "%s:new.sh" % candidate) == b"#!/bin/sh\necho new\n"


# --- named parks ----------------------------------------------------------


def test_materialize_parks_on_mode_change_and_on_differing_creator_modes(tmp_path):
    # (a) a task chmods a folded path: identical blob, different mode. The
    # text pipeline cannot see it (`--name-status` reports a plain M), so
    # without `ls-tree` observation the candidate would silently revert it.
    repo = tmp_path / "chmod"
    _init(repo)
    (repo / "app.py").write_text("a = 1\nb = 1\n")
    base_sha = commit_and_capture(repo, "base")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text("a = 2\nb = 1\n")
    t1_sha = commit_and_capture(repo, "t1")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    os.chmod(repo / "app.py", 0o755)
    _git(repo, "update-index", "--chmod=+x", "app.py")
    t2_sha = commit_and_capture(repo, "t2")
    assert tree_entries(repo, t2_sha)["app.py"][0] == "100755"
    assert tree_entries(repo, t2_sha)["app.py"][2] == tree_entries(repo, base_sha)["app.py"][2]

    _git(repo, "checkout", "-q", "integration")
    run_dir = tmp_path / "run-chmod"
    heads = [("t1", t1_sha), ("t2", t2_sha)]
    fold = do_fold(repo, run_dir, 1, base_sha, heads)
    assert fold.returncode == 0, fold.stdout + fold.stderr

    result = do_materialize(repo, run_dir, 1, base_sha, heads)
    assert result.returncode == 2, result.stdout + result.stderr
    payload = last_json(result)
    assert set(payload) == {"park"}
    assert "app.py" in payload["park"] and "t2" in payload["park"]
    assert _git(repo, "status", "--porcelain") == ""
    assert _git(repo, "rev-parse", "integration") == base_sha

    # (b) two creators of one new path with differing modes. Identical
    # content, so the fold itself is clean — only the modes disagree.
    repo2 = tmp_path / "creators"
    _init(repo2)
    (repo2 / "keep.txt").write_text("keep\n")
    base2 = commit_and_capture(repo2, "base")

    _git(repo2, "checkout", "-q", "-b", "t1", base2)
    (repo2 / "made.sh").write_text("#!/bin/sh\n")
    t1b = commit_and_capture(repo2, "t1")

    _git(repo2, "checkout", "-q", "-b", "t2", base2)
    (repo2 / "made.sh").write_text("#!/bin/sh\n")
    os.chmod(repo2 / "made.sh", 0o755)
    t2b = commit_and_capture(repo2, "t2")
    assert tree_entries(repo2, t1b)["made.sh"][0] == "100644"
    assert tree_entries(repo2, t2b)["made.sh"][0] == "100755"

    _git(repo2, "checkout", "-q", "integration")
    run_dir2 = tmp_path / "run-creators"
    heads2 = [("t1", t1b), ("t2", t2b)]
    fold2 = do_fold(repo2, run_dir2, 1, base2, heads2)
    assert fold2.returncode == 0, fold2.stdout + fold2.stderr

    result2 = do_materialize(repo2, run_dir2, 1, base2, heads2)
    assert result2.returncode == 2, result2.stdout + result2.stderr
    payload2 = last_json(result2)
    assert set(payload2) == {"park"}
    assert "made.sh" in payload2["park"]
    assert "100644" in payload2["park"] and "100755" in payload2["park"]
    assert _git(repo2, "rev-parse", "integration") == base2


# --- named fallback -------------------------------------------------------


def test_materialize_falls_back_on_a_non_regular_folded_path(tmp_path):
    """A folded symlink cannot be a regular blob in the candidate tree.

    Writing it through `hash-object` + `--cacheinfo 100644` would turn the
    link into a text file holding its own target — so the whole wave routes
    to the fallback with a named reason, exit 3.
    """
    repo = tmp_path / "symlink"
    _init(repo)
    (repo / "a.txt").write_text("a\n")
    (repo / "b.txt").write_text("b\n")
    os.symlink("a.txt", repo / "link.txt")
    base_sha = commit_and_capture(repo, "base")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "link.txt").unlink()
    os.symlink("b.txt", repo / "link.txt")
    t1_sha = commit_and_capture(repo, "t1")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "a.txt").write_text("a2\n")
    t2_sha = commit_and_capture(repo, "t2")

    _git(repo, "checkout", "-q", "integration")
    run_dir = tmp_path / "run"
    heads = [("t1", t1_sha), ("t2", t2_sha)]
    fold = do_fold(repo, run_dir, 1, base_sha, heads)
    assert fold.returncode == 0, fold.stdout + fold.stderr

    result = do_materialize(repo, run_dir, 1, base_sha, heads)
    assert result.returncode == 3, result.stdout + result.stderr
    payload = last_json(result)
    assert set(payload) == {"fallback"}
    assert "link.txt" in payload["fallback"]
    assert _git(repo, "status", "--porcelain") == ""
    assert _git(repo, "rev-parse", "integration") == base_sha


def test_materialize_parks_when_the_wave_has_no_fold_log(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    result = do_materialize(repo, tmp_path / "run", 1, base_sha, heads)
    assert result.returncode == 2, result.stdout + result.stderr
    assert last_json(result) == {"park": "fold log missing for wave 1"}


# --- byte fidelity --------------------------------------------------------


def test_materialize_no_final_newline_byte_identity(tmp_path):
    """A resolved file with no final newline reaches the tree byte-identical.

    `split_lines`/`join_lines` are inverses, so the manifest carries the
    resolver's exact bytes; `hash-object --stdin` must not re-normalize them.
    """
    repo = tmp_path / "nonewline"
    _init(repo)
    (repo / "app.py").write_text("a = 1\nb = 1\nc = 1\n")
    base_sha = commit_and_capture(repo, "base")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text("a = 1\nb = 2\nc = 1\n")
    t1_sha = commit_and_capture(repo, "t1")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "app.py").write_text("a = 1\nb = 3\nc = 1\n")
    t2_sha = commit_and_capture(repo, "t2")

    _git(repo, "checkout", "-q", "integration")
    run_dir = tmp_path / "run"
    heads = [("t1", t1_sha), ("t2", t2_sha)]
    fold = do_fold(repo, run_dir, 1, base_sha, heads)
    assert fold.returncode == 0, fold.stdout + fold.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    entry = json.loads((wave_dir / "conflicts.json").read_text())[0]
    assert entry["path"] == "app.py" and entry["dispatchable"] is True

    reply_text = "a = 1\nb = 4\nc = 1"          # no final newline
    reply_file = tmp_path / "reply.txt"
    reply_file.write_text(reply_text)
    resolved = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                       "--wave", "1", "--path", "app.py",
                       "--epoch", str(entry["epoch"]),
                       "--reply-file", str(reply_file))
    assert resolved.returncode == 0, resolved.stdout + resolved.stderr
    assert last_json(resolved) == {"applied": True}

    result = do_materialize(repo, run_dir, 1, base_sha, heads)
    assert result.returncode == 0, result.stdout + result.stderr
    candidate = last_json(result)["candidateSha"]

    blob = _git_bytes(repo, "cat-file", "blob", "%s:app.py" % candidate)
    assert blob == reply_text.encode()
    assert rw.join_lines(rw.split_lines(reply_text)) == reply_text
