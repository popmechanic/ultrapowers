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


def test_durations_present_or_named_unavailable(tmp_path):
    repo, run_dir = make_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    for row in payload["durations"]:
        assert ("seconds" in row and row["seconds"] >= 0) or row.get("reason")
