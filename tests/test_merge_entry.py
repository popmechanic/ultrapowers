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


# --- regressions from the /code-review high pass on PR #482 -------------------

TWO_QUEUED = """# Docket

### #222: first queued plan
**State:** queued
**Score:** 8 — merged first
**Est-files:** lib/a.py
**Plan:** docs/superpowers/plans/a.md

### #224: second queued plan
**State:** queued
**Score:** 7 — must still be mergeable after the first
**Est-files:** lib/b.py
**Plan:** docs/superpowers/plans/b.md
"""


def test_consecutive_entries_both_merge(repo, tmp_path):
    """The docket write must be COMMITTED. Left dirty, it trips this module's
    own dirty guard on the next entry and the drain halts after one merge."""
    mod = load()
    tracked = repo / "docket.md"
    tracked.write_text(TWO_QUEUED)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "docket")
    git(repo, "checkout", "-q", "-b", "plan2", "integration")
    (repo / "plan2.txt").write_text("more plan work\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "plan2 work")
    git(repo, "checkout", "-q", "integration")

    first = mod.merge_and_transition(repo, "plan", tracked, "222")
    assert first["merged"] is True
    assert git(repo, "status", "--porcelain").stdout == "", "docket left dirty"
    second = mod.merge_and_transition(repo, "plan2", tracked, "224")
    assert second["merged"] is True, second["reason"]
    assert state_of(mod, tracked, "222") == "executed"
    assert state_of(mod, tracked, "224") == "executed"


def test_untracked_file_does_not_park_a_mergeable_entry(repo, docket):
    """`parked` is terminal in docket_lib, so a false park cannot be undone
    in-band. A stray artifact must not cost an entry that git would merge."""
    mod = load()
    (repo / "scratch.log").write_text("executor leftover\n")
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert res["merged"] is True, res["reason"]
    assert state_of(mod, docket, "222") == "executed"


def test_to_parked_is_refused(repo, docket):
    mod = load()
    with pytest.raises(mod.MergeEntryError):
        mod.merge_and_transition(repo, "plan", docket, "222", to_state="parked")


def test_unexpected_error_exits_2_not_1(repo, tmp_path):
    """Exit 1 is the contract's 'parked, and the docket records why'. Anything
    that wrote no docket must not claim it."""
    missing = tmp_path / "nope.md"
    r = subprocess.run(["python3", str(SCRIPT), "--repo", str(repo), "--branch", "plan",
                        "--docket", str(missing), "--issue", "222"],
                       capture_output=True, text=True)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "FileNotFoundError" in r.stderr


def test_conflict_reason_names_the_file(repo, docket):
    mod = load()
    (repo / "plan.txt").write_text("conflicting content\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "integration writes the same file")
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert "plan.txt" in res["reason"], res["reason"]


def test_failed_abort_is_named_in_the_reason(repo, docket, monkeypatch):
    """The abort is the only thing keeping 'never left half-applied' true."""
    mod = load()
    (repo / "plan.txt").write_text("conflicting content\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "integration writes the same file")
    real = mod._git

    def flaky(r, *args):
        if args[:2] == ("merge", "--abort"):
            return subprocess.CompletedProcess(args, 128, "", "fatal: no MERGE_HEAD\n")
        return real(r, *args)

    monkeypatch.setattr(mod, "_git", flaky)
    res = mod.merge_and_transition(repo, "plan", docket, "222")
    assert "abort FAILED" in res["reason"], res["reason"]
