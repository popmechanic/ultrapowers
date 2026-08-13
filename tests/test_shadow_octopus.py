"""Shadow's two-leg octopus probe: per-wave excluded row + whole-run reason.

Commit graphs are built with `git commit-tree` over a single empty tree — the
probe reads only parent counts and the merge-base plumbing shadow already
uses, never file contents, so an empty tree is a faithful, cheap stand-in for
a real integration chain shaped the same way.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import shadow_fold as sf


def _git(repo, *args, input_text=None):
    return subprocess.run(["git", "-C", str(repo)] + list(args), check=True,
                          capture_output=True, text=True,
                          input=input_text).stdout.strip()


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "a@b.c"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "test"], check=True)
    return repo


def empty_tree(repo):
    return _git(repo, "mktree", input_text="")


def commit(repo, tree, parents, msg):
    args = ["commit-tree", tree]
    for p in parents:
        args += ["-p", p]
    args += ["-m", msg]
    return _git(repo, *args)


def _report(waves):
    """`waveMerges` for the given `[(wave_n, headSha, branches)]` rows, all MERGED."""
    return {"waveMerges": [{"wave": n, "status": "MERGED", "headSha": sha,
                            "branches": list(branches)}
                           for n, sha, branches in waves]}


def test_mixed_run_contended_wave_first_gets_per_wave_excluded_row(tmp_path):
    # chain: base -> octopus O (3 parents) -> ordinary 2-parent merge M.
    repo = make_repo(tmp_path)
    tree = empty_tree(repo)
    root = commit(repo, tree, [], "root")
    b2 = commit(repo, tree, [root], "b2")
    b3 = commit(repo, tree, [root], "b3")
    O = commit(repo, tree, [root, b2, b3], "octopus O")
    b4 = commit(repo, tree, [O], "b4")
    M = commit(repo, tree, [O, b4], "merge M")

    report = _report([(1, O, ["t1", "t2", "t3"]), (2, M, ["t4"])])
    payload = sf._shadow(repo, report, tmp_path)

    assert payload["floorSource"] == "merge-base"
    waves = {w["wave"]: w for w in payload["waves"]}
    assert waves[1]["disposition"] == "excluded"
    assert "octopus" in waves[1]["reason"]
    assert waves[1]["disposition"] != "absorbed"
    # M's wave shadows normally — not excluded, not absorbed.
    assert waves[2]["disposition"] not in ("excluded", "absorbed")


def test_modal_shape_octopus_plus_fastforward_uses_octopus_whole_run_reason(tmp_path):
    # chain: base -> octopus O -> single-parent (fast-forwarded) head H.
    repo = make_repo(tmp_path)
    tree = empty_tree(repo)
    root = commit(repo, tree, [], "root")
    b2 = commit(repo, tree, [root], "b2")
    b3 = commit(repo, tree, [root], "b3")
    O = commit(repo, tree, [root, b2, b3], "octopus O")
    H = commit(repo, tree, [O], "fast-forward H")

    report = _report([(1, O, ["t1", "t2", "t3"]), (2, H, ["t4"])])
    payload = sf._shadow(repo, report, tmp_path)

    # no 2-parent merge anywhere -> no-floor branch.
    assert payload["floorSource"] != "merge-base"
    assert payload["waves"] == []
    assert "octopus" in payload["excluded"]
    assert payload["excluded"] != sf.NO_PER_TASK_MERGES_REASON


def test_merge_free_run_keeps_existing_name(tmp_path):
    # chain of single-parent commits only.
    repo = make_repo(tmp_path)
    tree = empty_tree(repo)
    root = commit(repo, tree, [], "root")
    c2 = commit(repo, tree, [root], "c2")
    c3 = commit(repo, tree, [c2], "c3")

    report = _report([(1, c2, ["t1"]), (2, c3, ["t2"])])
    payload = sf._shadow(repo, report, tmp_path)

    assert payload["floorSource"] != "merge-base"
    assert payload["waves"] == []
    assert payload["excluded"] == sf.NO_PER_TASK_MERGES_REASON
