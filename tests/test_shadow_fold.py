"""Shadow-fold: bound the chain, hand it to run_eval's inherited replay
machinery, compare against the shipped trees, park every unshadowable shape
by name (spec 2026-08-11 component 2)."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals/frontier/shadow_fold.py"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def _commit_all(repo, msg):
    git(repo, "add", "-A"); git(repo, "commit", "-qm", msg)
    return git(repo, "rev-parse", "HEAD")


def make_run(tmp_path):
    """fork -> recon (pre-first-merge) -> wave-1 merge(t1)+merge(t2) -> FF t3."""
    repo = tmp_path / "repo"; repo.mkdir()
    git(repo, "init", "-qb", "main")
    git(repo, "config", "user.email", "s@t"); git(repo, "config", "user.name", "s")
    (repo / "a.py").write_text("A = 1\n"); (repo / "b.py").write_text("B = 1\n")
    fork = _commit_all(repo, "fork")
    git(repo, "checkout", "-qb", "integ")
    (repo / "note.md").write_text("recon\n"); recon = _commit_all(repo, "recon")
    heads = {}
    for tid, path, text in (("t1", "a.py", "A = 2\n"), ("t2", "b.py", "B = 2\n")):
        git(repo, "checkout", "-qb", tid, recon if tid == "t1" else recon)
        (repo / path).write_text(text); heads[tid] = _commit_all(repo, tid)
        git(repo, "checkout", "-q", "integ")
        git(repo, "merge", "-q", "--no-ff", tid, "-m", "merge %s" % tid)
    wave1 = git(repo, "rev-parse", "HEAD")
    (repo / "a.py").write_text("A = 3\n"); heads["t3"] = _commit_all(repo, "t3")
    wave2 = heads["t3"]                                    # FF single-task wave
    run_dir = tmp_path / "run-shadowtest"; run_dir.mkdir()
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [
        {"wave": 1, "status": "MERGED", "headSha": wave1, "branches": ["t1", "t2"]},
        {"wave": 2, "status": "MERGED", "headSha": wave2, "branches": ["t3"]}],
        "tasks": [{"task": t, "headSha": h} for t, h in heads.items()]}))
    return repo, run_dir


def make_multiwave_run(tmp_path):
    """The engine's real multi-wave shape — each wave fast-forwards its first
    branch and `--no-ff` merges the rest:

        fork -> [wave 1: ff a, merge b, merge c] -> [wave 2: ff d, merge e]

    The floor must come from the FIRST merge (merge b, whose merge-base is the
    fork), not the last (merge e, whose merge-base is the wave-1 head).
    """
    repo = tmp_path / "repo"; repo.mkdir()
    git(repo, "init", "-qb", "main")
    git(repo, "config", "user.email", "s@t"); git(repo, "config", "user.name", "s")
    for name in ("a", "b", "c", "d", "e"):
        (repo / ("%s.py" % name)).write_text("%s = 1\n" % name.upper())
    fork = _commit_all(repo, "fork")
    git(repo, "checkout", "-qb", "integ")
    heads = {}

    def wave(base, tasks):
        for i, tid in enumerate(tasks):
            git(repo, "checkout", "-qb", tid, base)
            (repo / ("%s.py" % tid)).write_text("%s = 2\n" % tid.upper())
            heads[tid] = _commit_all(repo, tid)
            git(repo, "checkout", "-q", "integ")
            if i == 0:
                git(repo, "merge", "-q", "--ff-only", tid)
            else:
                git(repo, "merge", "-q", "--no-ff", tid, "-m", "merge %s" % tid)
        return git(repo, "rev-parse", "HEAD")

    wave1 = wave(fork, ["a", "b", "c"])
    wave2 = wave(wave1, ["d", "e"])
    run_dir = tmp_path / "run-multiwave"; run_dir.mkdir()
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [
        {"wave": 1, "status": "MERGED", "headSha": wave1,
         "branches": ["a", "b", "c"]},
        {"wave": 2, "status": "MERGED", "headSha": wave2, "branches": ["d", "e"]}],
        "tasks": [{"task": t, "headSha": h} for t, h in heads.items()]}))
    return repo, run_dir, fork


def make_ff_first_wave_with_prerun_drain_merge(tmp_path):
    """Regression: the walk BOUND row (the earliest MERGED wave head's
    *parent*, one commit BELOW the run) is itself a 2-parent merge from the
    base branch's own pre-run history (e.g. a drain merge on `main`) —

        root -> [drain-feature merge on main] (== bound) -> integ ->
        [wave 1: ff t1] -> [wave 2: ff t2, merge t3]

    A deepest-first scan that treats the bound row as a candidate would
    prefer that pre-run merge and float the floor dozens of commits below
    the run. The floor must come from the first IN-RUN merge (merge t3)
    instead, and never drop at/below the bound.
    """
    repo = tmp_path / "repo"; repo.mkdir()
    git(repo, "init", "-qb", "main")
    git(repo, "config", "user.email", "s@t"); git(repo, "config", "user.name", "s")
    (repo / "base.py").write_text("BASE = 1\n")
    _commit_all(repo, "root")
    git(repo, "checkout", "-qb", "drain-feature")
    (repo / "drain.py").write_text("DRAIN = 1\n")
    _commit_all(repo, "drain feature")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", "drain-feature", "-m", "drain merge")
    bound = git(repo, "rev-parse", "HEAD")           # pre-run 2-parent merge
    git(repo, "checkout", "-qb", "integ")
    heads = {}

    git(repo, "checkout", "-qb", "t1", "integ")
    (repo / "t1.py").write_text("T1 = 1\n"); heads["t1"] = _commit_all(repo, "t1")
    git(repo, "checkout", "-q", "integ"); git(repo, "merge", "-q", "--ff-only", "t1")
    wave1 = git(repo, "rev-parse", "HEAD")

    git(repo, "checkout", "-qb", "t2", "integ")
    (repo / "t2.py").write_text("T2 = 1\n"); heads["t2"] = _commit_all(repo, "t2")
    git(repo, "checkout", "-q", "integ"); git(repo, "merge", "-q", "--ff-only", "t2")
    git(repo, "checkout", "-qb", "t3", "integ")
    (repo / "t3.py").write_text("T3 = 1\n"); heads["t3"] = _commit_all(repo, "t3")
    git(repo, "checkout", "-q", "integ")
    git(repo, "merge", "-q", "--no-ff", "t3", "-m", "merge t3")
    wave2 = git(repo, "rev-parse", "HEAD")

    run_dir = tmp_path / "run-ffirst"; run_dir.mkdir()
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [
        {"wave": 1, "status": "MERGED", "headSha": wave1, "branches": ["t1"]},
        {"wave": 2, "status": "MERGED", "headSha": wave2, "branches": ["t2", "t3"]}],
        "tasks": [{"task": t, "headSha": h} for t, h in heads.items()]}))
    return repo, run_dir, bound, heads["t2"]


def run_shadow(repo, run_dir, out, extra=()):
    return subprocess.run([sys.executable, str(SCRIPT), str(run_dir),
                           "--repo", str(repo), "--out", str(out), *extra],
                          capture_output=True, text=True)


def test_merge_wave_folds_clean_and_ff_wave_takes_inherited_disposition(tmp_path):
    repo, run_dir = make_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    w1 = next(w for w in payload["waves"] if w["wave"] == 1)
    assert w1["disposition"] == "clean" and w1["endpoints"] == 2
    w2 = next(w for w in payload["waves"] if w["wave"] == 2)
    assert w2["disposition"] in ("absorbed", "trailing-cut")
    assert payload["floorSource"] == "merge-base"          # not the FF fallback


def test_no_report_parks_by_name(tmp_path):
    repo, run_dir = make_run(tmp_path)
    (run_dir / "report.json").unlink()
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert payload["parked"] == "no finalized report (unshadowable)"


def test_fabricated_task_sha_aborts_loud(tmp_path):
    repo, run_dir = make_run(tmp_path)
    doc = json.loads((run_dir / "report.json").read_text())
    doc["tasks"][0]["headSha"] = doc["tasks"][0]["headSha"][:7] + "0" * 33
    (run_dir / "report.json").write_text(json.dumps(doc))
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode != 0
    assert "does not resolve" in (p.stderr + p.stdout)


def test_non_merged_wave_entries_are_not_consumed(tmp_path):
    repo, run_dir = make_run(tmp_path)
    doc = json.loads((run_dir / "report.json").read_text())
    doc["waveMerges"][1]["status"] = "FAILED"
    (run_dir / "report.json").write_text(json.dumps(doc))
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert [w["wave"] for w in payload["waves"]] == [1]


def test_floor_comes_from_the_earliest_merge_so_every_wave_folds(tmp_path):
    """Regression: a tip-first floor search picks the LAST merge's merge-base,
    which drops every merge wave but the last below the floor."""
    repo, run_dir, fork = make_multiwave_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert payload["floorSource"] == "merge-base"
    assert payload["floor"] == fork
    assert [(w["wave"], w["disposition"], w["endpoints"])
            for w in payload["waves"]] == [(1, "clean", 2), (2, "clean", 1)]


def test_floor_never_drops_below_the_run_when_the_bound_row_is_itself_a_merge(tmp_path):
    """Regression: the walk bound's row (below the run) is a 2-parent merge;
    the earliest wave head is a single-parent FF. The candidate scan must
    skip the bound row itself, or the floor floats into pre-run history."""
    repo, run_dir, bound, expected_floor = \
        make_ff_first_wave_with_prerun_drain_merge(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert payload["floorSource"] == "merge-base"
    assert payload["floor"] == expected_floor
    assert payload["floor"] != bound
    is_ancestor = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", bound, payload["floor"]])
    assert is_ancestor.returncode == 0    # bound is an ancestor of the floor,
                                           # i.e. the floor never drops below it


def test_every_merged_task_of_a_multiwave_run_is_measured(tmp_path):
    repo, run_dir, _fork = make_multiwave_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert {row["task"] for row in payload["durations"]} == {"a", "b", "c", "d", "e"}
    assert [row for row in payload["durations"] if "seconds" not in row] == []


def test_durations_present_or_named_unavailable(tmp_path):
    repo, run_dir = make_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    for row in payload["durations"]:
        assert ("seconds" in row and row["seconds"] >= 0) or row.get("reason")
