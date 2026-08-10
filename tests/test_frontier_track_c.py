"""Track (c): archived-run extraction and replay fidelity, on a synthetic repo."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import run_eval


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def build_integration_repo(tmp_path, with_reconciliation=False):
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\na2\n")
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    # two task branches off base
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\na2\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "task2", base)
    (repo / "b.py").write_text("b1\nb2\nb3\n")
    git(repo, "commit", "-qam", "task2 work")
    # integration branch: merge both
    git(repo, "checkout", "-qb", "ultra/integration-test", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    if with_reconciliation:
        (repo / "a.py").write_text("a1-reconciled\na2\n")
        git(repo, "commit", "-qam", "fix after merge")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-test'")
    return repo


def test_extract_finds_clean_run(tmp_path):
    repo = build_integration_repo(tmp_path)
    result = run_eval.extract_archived_runs(repo)
    assert result["excluded"] == []
    assert len(result["runs"]) == 1
    groups = result["runs"][0]["groups"]
    assert sum(len(g["tasks"]) for g in groups) == 2


def test_trailing_reconciliation_recovers_with_comparison_cut(tmp_path):
    """A recon commit after the last merge no longer excludes the run (#133):
    fidelity comparison cuts at the last merge, and the cut is recorded."""
    repo = build_integration_repo(tmp_path, with_reconciliation=True)
    result = run_eval.extract_archived_runs(repo)
    assert result["excluded"] == []
    assert len(result["runs"]) == 1
    run = result["runs"][0]
    assert sum(len(g["tasks"]) for g in run["groups"]) == 2
    assert all(g["recons"] == [] for g in run["groups"])
    assert len(run["trailing_recons"]) == 1

    out = tmp_path / "out"
    summary = run_eval.run_tracks(["c"], out, repo=repo, seed=42)
    assert summary["track_c"]["recovered_n"] == 1
    case = json.loads(next(out.glob("c-*.json")).read_text())
    assert case["fidelity"]["silent_divergence"] == []
    assert case["reconciliation"]["pseudo_tasks"] == []
    assert case["reconciliation"]["trailing_cut"] == run["trailing_recons"]
    rollup = (out / "rollup.md").read_text()
    assert "comparison cut at last merge" in rollup


def test_between_wave_recon_is_absorbed_by_next_wave_base(tmp_path):
    """A recon between waves whose next wave forks after it needs no
    pseudo-task: the next group's base snapshot already contains it."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\na2\n")
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\na2\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "ultra/integration-t", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    (repo / "a.py").write_text("a1-reconciled\na2\n")
    git(repo, "commit", "-qam", "reconcile wave 1")
    recon = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task2", recon)
    (repo / "b.py").write_text("b1\nb2\nb3\n")
    git(repo, "commit", "-qam", "task2 work")
    git(repo, "checkout", "-q", "ultra/integration-t")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    result = run_eval.extract_archived_runs(repo)
    assert result["excluded"] == []
    run = result["runs"][0]
    assert len(run["groups"]) == 2
    assert run["groups"][1]["base_sha"] == recon
    assert all(g["recons"] == [] for g in run["groups"])
    assert run["trailing_recons"] == []

    summary = run_eval.run_track_c(repo, tmp_path / "out", seed=42)
    assert summary["silent_divergence"] == []


def test_mid_wave_recon_folds_as_pseudo_task(tmp_path):
    """A recon between two same-base merges folds into that wave as a
    pseudo-task, and the wave's fold reproduces the post-recon merge tree."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\na2\n")
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\na2\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "task2", base)
    (repo / "b.py").write_text("b1\nb2\nb3\n")
    git(repo, "commit", "-qam", "task2 work")
    git(repo, "checkout", "-qb", "ultra/integration-t", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    (repo / "c.py").write_text("c1-from-recon\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "mid-wave reconcile")
    recon = git(repo, "rev-parse", "HEAD")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    result = run_eval.extract_archived_runs(repo)
    assert result["excluded"] == []
    run = result["runs"][0]
    assert len(run["groups"]) == 1
    group = run["groups"][0]
    assert [t["task_id"] for t in group["tasks"]] == [
        git(repo, "rev-parse", "task1")[:8], git(repo, "rev-parse", "task2")[:8]]
    assert [r["task_id"] for r in group["recons"]] == ["recon-%s" % recon[:8]]
    assert run["trailing_recons"] == []

    out = tmp_path / "out"
    summary = run_eval.run_track_c(repo, out, seed=42)
    assert summary["silent_divergence"] == []
    case = json.loads(next(out.glob("c-*.json")).read_text())
    # 3 fold participants (2 tasks + 1 pseudo-task) -> all 6 permutations.
    assert case["folds"]["orders_sampled"] == 6
    assert case["folds"]["k1_identical"] is True
    assert case["reconciliation"]["pseudo_tasks"] == ["recon-%s" % recon[:8]]
    # c.py exists only in the recon commit; reaching the merged manifest
    # proves the pseudo-task actually folded.
    assert "c.py" not in case["fidelity"]["silent_divergence"]


def test_consecutive_recons_coalesce_into_one_pseudo_task(tmp_path):
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "task2", base)
    (repo / "b.py").write_text("b1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "task2 work")
    git(repo, "checkout", "-qb", "ultra/integration-t", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    (repo / "c.py").write_text("c1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "reconcile one")
    (repo / "c.py").write_text("c1\nc2\n")
    git(repo, "commit", "-qam", "reconcile two")
    last_recon = git(repo, "rev-parse", "HEAD")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    run = run_eval.extract_archived_runs(repo)["runs"][0]
    assert [r["task_id"] for g in run["groups"] for r in g["recons"]] == [
        "recon-%s" % last_recon[:8]]
    summary = run_eval.run_track_c(repo, tmp_path / "out", seed=42)
    assert summary["silent_divergence"] == []


def test_recon_not_in_next_wave_base_folds_into_that_wave(tmp_path):
    """When the next wave's tasks forked *before* the recon landed, the recon
    is not in that wave's merge-base and must fold there as a pseudo-task."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    (repo / "b.py").write_text("b1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "ultra/integration-t", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    wave1 = git(repo, "rev-parse", "HEAD")
    # task2 forks from the wave-1 merge, BEFORE the recon lands.
    git(repo, "checkout", "-qb", "task2", wave1)
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "commit", "-qam", "task2 work")
    git(repo, "checkout", "-q", "ultra/integration-t")
    (repo / "c.py").write_text("c1-from-recon\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "reconcile")
    recon = git(repo, "rev-parse", "HEAD")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    run = run_eval.extract_archived_runs(repo)["runs"][0]
    assert len(run["groups"]) == 2
    assert run["groups"][0]["recons"] == []
    assert [r["task_id"] for r in run["groups"][1]["recons"]] == [
        "recon-%s" % recon[:8]]
    summary = run_eval.run_track_c(repo, tmp_path / "out", seed=42)
    assert summary["silent_divergence"] == []


def test_merge_less_chain_is_excluded_by_name(tmp_path):
    """An integration branch that carries only ordinary commits (no per-task
    merges) has nothing to replay and is excluded honestly."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "ultra/integration-t")
    (repo / "a.py").write_text("a1-direct\n")
    git(repo, "commit", "-qam", "direct work, no task merges")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    result = run_eval.extract_archived_runs(repo)
    assert result["runs"] == []
    assert len(result["excluded"]) == 1
    assert "no per-task merges" in result["excluded"][0]["reason"]


def test_replay_fidelity_and_floor(tmp_path):
    repo = build_integration_repo(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    summary = run_eval.run_track_c(repo, out, seed=42)
    cases = list(out.glob("c-*.json"))
    assert len(cases) == 1
    case = json.loads(cases[0].read_text())
    assert case["fidelity"]["silent_divergence"] == []
    # one recovered run < floor of 3 -> K3 not evaluated, stated with n
    assert summary["K3"] == "not evaluated (recovered-n=1 below floor 3)"


# ---------------------------------------------------------------------------
# beyond the plan's three: the group/fidelity/runner contract in detail
# ---------------------------------------------------------------------------

def test_group_shape_is_one_wave_with_both_task_tips(tmp_path):
    repo = build_integration_repo(tmp_path)
    result = run_eval.extract_archived_runs(repo)
    run = result["runs"][0]
    assert run["ref"] == git(repo, "rev-parse", "main")
    assert len(run["groups"]) == 1
    group = run["groups"][0]
    assert group["base_sha"] == git(repo, "rev-parse", "main^2^1^1")
    assert group["after_sha"] == git(repo, "rev-parse", "main^2")
    assert [t["tip_sha"] for t in group["tasks"]] == [
        git(repo, "rev-parse", "task1"), git(repo, "rev-parse", "task2")]
    assert [t["task_id"] for t in group["tasks"]] == [
        git(repo, "rev-parse", "task1")[:8], git(repo, "rev-parse", "task2")[:8]]


def test_case_record_shape_matches_the_other_tracks(tmp_path):
    repo = build_integration_repo(tmp_path)
    out = tmp_path / "out"
    summary = run_eval.run_track_c(repo, out, seed=42)
    ref = git(repo, "rev-parse", "main")
    case = json.loads((out / ("c-%s.json" % ref[:8])).read_text())
    assert case["name"] == ref[:8]
    assert case["track"] == "c"
    assert case["makespans"] is None
    assert case["excluded"] is None
    assert case["no_interleaving"] is None
    assert case["expectations_met"] is None
    assert case["conflicts"] == []
    assert case["folds"]["k1_identical"] is True
    assert case["folds"]["k2_idempotent"] is True
    assert case["folds"]["orders_sampled"] == 2
    assert case["fidelity"] == {"paths_checked": 2, "silent_divergence": [],
                                "conflicted_paths": []}
    assert summary["recovered_n"] == 1
    assert summary["silent_divergence"] == []
    assert summary["excluded"] == []


def test_silent_divergence_on_a_clean_path_is_caught(tmp_path):
    """A hand-edited integration merge diverges from the replay on a clean path."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-from-task\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "ultra/integration-x", base)
    # An evil merge: recorded tree does NOT match either side.
    git(repo, "merge", "-q", "--no-ff", "--no-commit", "task1")
    (repo / "a.py").write_text("a1-hand-edited\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "merge task1")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip, "-m",
        "Merge branch 'ultra/integration-x'")

    out = tmp_path / "out"
    summary = run_eval.run_track_c(repo, out, seed=42)
    case = json.loads(next(out.glob("c-*.json")).read_text())
    assert case["fidelity"]["silent_divergence"] == ["a.py"]
    assert case["fidelity"]["conflicted_paths"] == []
    assert summary["silent_divergence"] == ["a.py"]
    # still under the floor, so K3 stays honest about n rather than claiming false
    assert summary["K3"] == "not evaluated (recovered-n=1 below floor 3)"


def test_run_tracks_c_wires_rollup_and_k3(tmp_path):
    repo = build_integration_repo(tmp_path)
    out = tmp_path / "out"
    summary = run_eval.run_tracks(["c"], out, repo=repo, seed=42)
    ref = git(repo, "rev-parse", "main")
    assert summary["k_gates"]["K3"] == "not evaluated (recovered-n=1 below floor 3)"
    assert summary["tracks_unavailable"] == []
    assert summary["track_c"]["recovered_n"] == 1
    rollup = (out / "rollup.md").read_text()
    assert "## Track (c) recovered runs" in rollup
    assert ref[:8] in rollup
    assert "not evaluated (recovered-n=1 below floor 3)" in rollup


def test_run_tracks_c_reports_exclusions_in_rollup(tmp_path):
    """A chain with no per-task merges is the shape that still excludes."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "ultra/integration-t")
    (repo / "a.py").write_text("a1-direct\n")
    git(repo, "commit", "-qam", "direct work, no task merges")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-t'")

    out = tmp_path / "out"
    summary = run_eval.run_tracks(["c"], out, repo=repo, seed=42)
    ref = git(repo, "rev-parse", "main")
    assert summary["k_gates"]["K3"] == "not evaluated (recovered-n=0 below floor 3)"
    assert list(out.glob("c-*.json")) == []
    reasons = [e["reason"] for e in summary["exclusions"]]
    assert any("no per-task merges" in r for r in reasons)
    rollup = (out / "rollup.md").read_text()
    assert "no per-task merges" in rollup
    assert ref[:8] in rollup


def test_run_tracks_c_without_repo_is_refused(tmp_path):
    try:
        run_eval.run_tracks(["c"], tmp_path, seed=42)
    except ValueError as exc:
        assert "repo" in str(exc)
    else:
        raise AssertionError("track (c) without a repo must raise")


def test_unreplayable_run_is_demoted_to_a_named_exclusion(tmp_path, monkeypatch):
    """The kernel's recursion depth must cost one named run, not the whole track."""
    repo = build_integration_repo(tmp_path)

    def boom(*args, **kwargs):
        raise RecursionError("maximum recursion depth exceeded")

    monkeypatch.setattr(run_eval, "_replay_group", boom)
    out = tmp_path / "out"
    summary = run_eval.run_track_c(repo, out, seed=42)
    assert summary["recovered_n"] == 0
    assert summary["runs"] == []
    assert list(out.glob("c-*.json")) == []
    assert summary["excluded"] == [
        {"ref": git(repo, "rev-parse", "main"),
         "reason": "recursion depth: maximum recursion depth exceeded"}]
    assert summary["K3"] == "not evaluated (recovered-n=0 below floor 3)"


def build_large_file_repo(tmp_path, n_lines=3000):
    """One ~3000-line file, modified by a task branch, alongside a normal one."""
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    big = "\n".join("line%d" % i for i in range(n_lines)) + "\n"
    (repo / "big.py").write_text(big)
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "big.py").write_text(big.replace("line1500\n", "line1500-edited\n"))
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "task2", base)
    (repo / "b.py").write_text("b1\nb2\nb3\n")
    git(repo, "commit", "-qam", "task2 work")
    git(repo, "checkout", "-qb", "ultra/integration-big", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-big'")
    return repo


def test_large_file_replay_recovers_via_recursion_headroom(tmp_path):
    """A ~3000-line file must not push the run into the recursion exclusion.

    Before the fix, replaying this file's ~3000-line weave under the
    interpreter's default recursion limit raised RecursionError deep inside
    the vendored kernel, and the run was demoted to a named exclusion instead
    of being recovered and replayed.
    """
    repo = build_large_file_repo(tmp_path)
    out = tmp_path / "out"
    summary = run_eval.run_track_c(repo, out, seed=42)
    assert summary["excluded"] == []
    assert summary["recovered_n"] == 1
    case = json.loads(next(out.glob("c-*.json")).read_text())
    assert case["fidelity"]["silent_divergence"] == []


def test_repo_with_no_integration_merges_recovers_nothing(tmp_path):
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    result = run_eval.extract_archived_runs(repo)
    assert result == {"runs": [], "excluded": []}
    summary = run_eval.run_track_c(repo, tmp_path / "out", seed=42)
    assert summary["K3"] == "not evaluated (recovered-n=0 below floor 3)"
