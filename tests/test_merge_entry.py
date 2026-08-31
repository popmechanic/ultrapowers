"""The drain's merge and its docket transition are ONE operation (#252).

A docket entry may advance `queued -> executed` only on a merge this module
itself verified: `git merge` exit 0 AND the plan branch an ancestor of HEAD.
Every other outcome parks the entry with the reason named. The 2026-08-25 run
transitioned #222 to `executed` after a merge that had FAILED on a dirty
checkout; there is no two-step path left for that to happen on.
"""
import importlib.util
import json
import pathlib
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultradocket/scripts/merge_entry.py"


def load():
    spec = importlib.util.spec_from_file_location("merge_entry", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DOCKET = """# Docket

### #222: A queued plan
**State:** queued
**Score:** 8 — the entry under test
**Est-files:** lib/a.py
**Plan:** docs/superpowers/plans/2026-06-14-a.md

### #223: An accepted plan
**State:** accepted
**Score:** 7 — cannot advance straight to executed
**Est-files:** lib/b.py
"""


def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=check)


@pytest.fixture
def repo(tmp_path):
    """A repo on `integration` with a divergent `plan` branch that merges clean."""
    r = tmp_path / "repo"
    r.mkdir()
    git(r, "init", "-q", "-b", "integration")
    git(r, "config", "user.email", "t@example.com")
    git(r, "config", "user.name", "t")
    (r / "base.txt").write_text("base\n")
    git(r, "add", "-A")
    git(r, "commit", "-qm", "base")
    git(r, "checkout", "-q", "-b", "plan")
    (r / "plan.txt").write_text("plan work\n")
    git(r, "add", "-A")
    git(r, "commit", "-qm", "plan work")
    git(r, "checkout", "-q", "integration")
    return r


@pytest.fixture
def docket(tmp_path):
    p = tmp_path / "docket.md"
    p.write_text(DOCKET)
    return p


def state_of(mod, docket_path, issue):
    entries = mod.docket_lib.parse_docket(docket_path.read_text())
    return next(e for e in entries if e.issue == issue).state


def test_verified_merge_transitions_the_entry(repo, docket):
    mod = load()
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert res["merged"] is True
    assert res["state"] == "executed"
    assert state_of(mod, docket, "222") == "executed"
    # the merge really happened and the branch is an ancestor of HEAD
    assert (repo / "plan.txt").exists()
    git(repo, "merge-base", "--is-ancestor", "plan", "HEAD")


def test_dirty_checkout_parks_and_never_merges(repo, docket):
    mod = load()
    (repo / "base.txt").write_text("uncommitted edit\n")
    before = git(repo, "rev-parse", "HEAD").stdout
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert res["merged"] is False
    assert res["state"] == "parked"
    assert "base.txt" in res["reason"], res["reason"]
    assert state_of(mod, docket, "222") == "parked"
    assert git(repo, "rev-parse", "HEAD").stdout == before
    assert not (repo / "plan.txt").exists()


def test_conflicting_merge_parks_and_aborts(repo, docket):
    mod = load()
    (repo / "plan.txt").write_text("conflicting content\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "integration writes the same file")
    before = git(repo, "rev-parse", "HEAD").stdout
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert res["merged"] is False
    assert res["state"] == "parked"
    assert state_of(mod, docket, "222") == "parked"
    assert git(repo, "rev-parse", "HEAD").stdout == before
    # the merge was aborted, not left half-applied
    assert git(repo, "status", "--porcelain").stdout == ""


def test_merge_exit_zero_but_unverified_still_parks(repo, docket):
    """`git merge --no-commit` exits 0 and leaves the branch NOT an ancestor.
    Exit code alone is not the authority; the ancestry check is."""
    mod = load()
    res = mod.merge_and_transition(repo, "plan", docket, "222",
                                   merge_args=("--no-ff", "--no-commit"))
    assert res["merged"] is False
    assert res["state"] == "parked"
    assert "ancestor" in res["reason"] or "unverified" in res["reason"]
    assert state_of(mod, docket, "222") == "parked"


def test_illegal_transition_is_refused_before_any_merge(repo, docket):
    mod = load()
    before = git(repo, "rev-parse", "HEAD").stdout
    with pytest.raises(mod.MergeEntryError):
        mod.merge_and_transition(repo, "plan", docket, "223")
    assert git(repo, "rev-parse", "HEAD").stdout == before
    assert docket.read_text() == DOCKET


def test_unknown_issue_is_refused_before_any_merge(repo, docket):
    mod = load()
    before = git(repo, "rev-parse", "HEAD").stdout
    with pytest.raises(mod.MergeEntryError):
        mod.merge_and_transition(repo, "plan", docket, "999")
    assert git(repo, "rev-parse", "HEAD").stdout == before
    assert docket.read_text() == DOCKET


def test_dirty_docket_file_refuses_rather_than_layering_a_park(repo, docket):
    """If docket.md itself is the dirt, a park would be written on top of an
    in-flight edit. Refuse loudly instead."""
    mod = load()
    tracked = repo / "docket.md"
    tracked.write_text(DOCKET)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "docket")
    tracked.write_text(DOCKET + "\n### #999: a well-formed in-flight edit\n"
                       "**State:** triaged\n**Score:** 5 — in flight\n"
                       "**Est-files:** lib/c.py\n")
    with pytest.raises(mod.MergeEntryError):
        mod.merge_and_transition(repo, "plan", tracked, "222")
    assert not (repo / "plan.txt").exists()


def test_cli_exit_codes(repo, docket):
    ok = subprocess.run(["python3", str(SCRIPT), "--repo", str(repo), "--branch", "plan",
                         "--docket", str(docket), "--issue", "222"],
                        capture_output=True, text=True)
    assert ok.returncode == 0, ok.stderr
    assert json.loads(ok.stdout)["state"] == "executed"

    parked = subprocess.run(["python3", str(SCRIPT), "--repo", str(repo), "--branch", "plan",
                             "--docket", str(docket), "--issue", "223"],
                            capture_output=True, text=True)
    assert parked.returncode == 2, parked.stdout
