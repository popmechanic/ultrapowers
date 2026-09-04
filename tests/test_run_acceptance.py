"""The committed-suite gate (run_acceptance.sh --suite-gate), e2e against a
throwaway git repo. The sealed exam and --baseline modes died with the
sealing subsystem (One Driver Phase 0, row 7)."""
import json
import os
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "run_acceptance.sh"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path, feature_built):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    body = "def add(a, b):\n    return a + b\n" if feature_built \
        else "def add(a, b):\n    raise NotImplementedError\n"
    (repo / "mod.py").write_text(body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def make_suite_repo(tmp_path, test_body, *, name="repo"):
    """A repo whose COMMITTED suite is tests/test_committed.py."""
    repo = tmp_path / name
    (repo / "tests").mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / "tests" / "test_committed.py").write_text(test_body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def suite_gate(repo, branch="main", run=None, base=None):
    cmd = ["bash", str(RUN), "--suite-gate", "--branch", branch, "--repo", str(repo)]
    if run:
        cmd += ["--run", run]
    if base:
        cmd += ["--base", base]
    r = sh(cmd, check=False)
    return r.returncode, json.loads(r.stdout)


def test_suite_gate_green_passes(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert True\n")
    code, out = suite_gate(repo)            # default run cmd = python3 -m pytest
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert out["sealId"] == "(suite)"


def test_suite_gate_red_parks(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert False\n")
    code, out = suite_gate(repo)
    assert code != 0 and out["passed"] is False and out["exitCode"] != 0


def test_suite_gate_red_carries_assertion_redkind(tmp_path):
    """The drain parks a red suite-gate keyed on its redKind (ultradocket SKILL:
    park 'with a reason (the gate's redKind or the failure)'). A committed suite
    with a deliberately failing test must label the red 'assertion' — a test
    executed and failed — so the drain records a precise park reason, not just a
    bare non-zero exit. suite is the drain's dominant disposition, so this is the
    red the park decision most often keys on; the plain suite-gate path never
    asserted the label before."""
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert False\n")
    code, out = suite_gate(repo)
    assert code != 0 and out["passed"] is False
    assert out["redKind"] == "assertion"


def test_suite_gate_no_tests_never_false_greens(tmp_path):
    repo = make_suite_repo(tmp_path, "# no tests here\n")
    code, out = suite_gate(repo)            # pytest exits 5 (no tests collected)
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"


def test_suite_gate_worktree_cleaned_up(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert True\n")
    suite_gate(repo)
    listed = sh(["git", "worktree", "list"], cwd=repo).stdout.strip().splitlines()
    assert len(listed) == 1, "suite-gate worktree leaked"


# ── One Driver Phase 0, row 7: the sealed and --baseline modes are gone ──────

@pytest.mark.parametrize("argv", [
    ["abc123def456", "main", "d" * 64],                      # old sealed form
    ["--baseline", "--suite", "s", "--branch", "main", "--run", "true"],
])
def test_deleted_modes_are_refused_with_usage(tmp_path, argv):
    """Any invocation that is not --suite-gate is a usage error: exit 2, the
    usage line on stderr, NOTHING on stdout (no JSON receipt a caller could
    mistake for a verdict)."""
    repo = make_repo(tmp_path, feature_built=True)
    r = sh(["bash", str(RUN), *argv, "--repo", str(repo)], check=False)
    assert r.returncode == 2
    assert "usage: run_acceptance.sh --suite-gate" in r.stderr
    assert r.stdout == ""


def test_suite_gate_without_base_warns_disarmed(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", "echo ok", "--repo", str(repo)], check=False)
    assert p.returncode == 0
    assert "harness-JS sim guard disarmed" in p.stderr


def test_suite_gate_with_base_does_not_warn(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--base", "main", "--run", "echo ok", "--repo", str(repo)],
           check=False)
    assert p.returncode == 0
    assert "disarmed" not in p.stderr


def test_exam_worktree_temp_parent_is_cleaned(tmp_path, monkeypatch):
    repo = make_repo(tmp_path, feature_built=True)
    tdir = tmp_path / "tmpdir"
    tdir.mkdir()
    monkeypatch.setenv("TMPDIR", str(tdir))
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", "echo ok", "--repo", str(repo)], check=False)
    assert p.returncode == 0
    assert list(tdir.iterdir()) == [], "mktemp parent dir leaked"


def test_huge_exam_output_still_emits_json_receipt(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    big = "python3 -c \"print('x' * 400000)\""
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", big, "--repo", str(repo)], check=False)
    assert p.returncode == 0
    obj = json.loads(p.stdout)
    assert obj["passed"] is True
    assert len(obj["output"]) <= 8000


# --- suite-gate bootstrap + empty-run refusal (issue #96) ---

def _suite_gate(repo, *extra, branch="main"):
    """Raw --suite-gate invocation: passes `extra` through verbatim so a test can
    send an EMPTY --run or a --bootstrap, neither of which the `suite_gate`
    helper above can express. Returns (CompletedProcess, parsed JSON receipt);
    the receipt is the LAST stdout line because the disarmed-guard warning and
    other diagnostics may precede it on stderr."""
    r = sh(["bash", str(RUN), "--suite-gate", "--branch", branch,
            "--repo", str(repo), *extra], check=False)
    return r, json.loads(r.stdout.strip().splitlines()[-1])


def test_suite_gate_bootstrap_provisions_worktree(tmp_path):
    """The #96 fix: the suite gate can prepare the exam worktree's environment
    before running the suite. The run command asserts a file only the bootstrap
    creates, so a green here proves the bootstrap ran IN the worktree."""
    repo = make_repo(tmp_path, feature_built=True)
    r, payload = _suite_gate(repo, "--run", "test -f .deps-installed",
                             "--bootstrap", "echo ok > .deps-installed")
    assert payload["passed"] is True and payload["status"] == "OK", payload
    assert r.returncode == 0


def test_suite_gate_without_bootstrap_still_reds_honestly(tmp_path):
    # The pre-#96 false-BLOCKED shape — the flag is what fixes it. `test -f`
    # exits 1 and the suite-gate red path classifies non-zero/non-5 exits as
    # redKind "assertion": an ABSENT bootstrap reds exactly as it does today.
    repo = make_repo(tmp_path, feature_built=True)
    r, payload = _suite_gate(repo, "--run", "test -f .deps-installed")
    assert payload["passed"] is False
    assert payload["redKind"] == "assertion"
    assert r.returncode != 0


def test_suite_gate_failed_bootstrap_is_env_not_assertion(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    r, payload = _suite_gate(repo, "--run", "true", "--bootstrap", "exit 7")
    assert payload["status"] == "EXAM_BOOTSTRAP_ERROR"
    assert payload["passed"] is False
    assert "redKind" not in payload
    assert r.returncode != 0


def test_suite_gate_rejects_empty_run(tmp_path):
    # An empty command evals to exit 0 — a false green the gate must refuse.
    repo = make_repo(tmp_path, feature_built=True)
    r, payload = _suite_gate(repo, "--run", "")
    assert payload["status"] == "ERROR"
    assert r.returncode == 1


# ── #117: canonical exam/suite-gate worktree paths ───────────────────────────
# Both provisioning sites handed `$(mktemp -d)/...` straight to
# `git worktree add`. That path traverses a symlink whenever the temp root does
# — always on macOS (/var -> private/var), and on Linux whenever TMPDIR points
# at one — so the suite ran with a logical cwd that did not match its physical
# one, false-redding every path-identity-sensitive toolchain.
#
# PWD-vs-getcwd is the cheapest faithful stand-in for that whole class: bash's
# `cd` sets PWD logically (symlink preserved) while getcwd(3) is always
# physical, so the two differ exactly when the worktree path traverses a
# symlink and agree exactly when it does not.
PATH_IDENTITY_TEST = (
    "import os\n\n\n"
    "def test_cwd_is_canonical():\n"
    "    assert os.environ['PWD'] == os.getcwd()\n"
)


def _mk_path_identity_repo(tmp_path):
    """A repo whose one-test suite fails iff the worktree path traverses a
    symlink — the stand-in for every path-identity-sensitive toolchain."""
    repo = tmp_path / "repo"
    (repo / "tests").mkdir(parents=True)
    (repo / "tests" / "test_path_identity.py").write_text(PATH_IDENTITY_TEST)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    sh(["git", "add", "-A"], cwd=repo)
    sh(["git", "commit", "-qm", "fixture"], cwd=repo)
    sh(["git", "branch", "work"], cwd=repo)
    return repo


def _symlinked_tmpdir_env(tmp_path, name):
    """An environment whose TMPDIR reaches the real temp dir through a symlink.

    The differential's mechanism differs by platform (#124): macOS `mktemp -d`
    ignores TMPDIR entirely, so there the symlink under test is the system's
    own /var -> /private/var link; Linux honors TMPDIR, so this fixture's
    explicit symlink carries the differential. Either way the provisioning
    sites see a symlinked temp parent and the `pwd -P` canonicalization is
    what keeps worktree paths identity-stable."""
    real = tmp_path / (name + "-real")
    real.mkdir()
    link = tmp_path / (name + "-link")
    link.symlink_to(real)
    return dict(os.environ, TMPDIR=str(link))


def test_suite_gate_survives_symlinked_tmpdir(tmp_path):
    # #117 differential pin (GREEN at HEAD; RED at BASE recorded in the commit).
    repo = _mk_path_identity_repo(tmp_path)
    env = _symlinked_tmpdir_env(tmp_path, "sg")
    r = subprocess.run(
        ["bash", str(RUN), "--suite-gate", "--branch", "work",
         "--run", sys.executable + " -m pytest -q tests/", "--repo", str(repo)],
        capture_output=True, text=True, env=env)
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["passed"] is True, r.stdout + r.stderr
    assert r.returncode == 0



def test_uncreatable_temp_parent_errors_instead_of_using_cwd(tmp_path):
    """The guard half of the canonicalization, pinned against the cleanup trap.

    `cd ""` SUCCEEDS in bash and yields the process cwd, so if `mktemp -d`
    fails an unguarded canonicalization silently provisions the worktree at
    `$PWD/suite-gate` — and `cleanup` then runs `rm -rf "$(dirname ...)"` over
    the caller's own directory. The gate must refuse instead, and the caller's
    files must still be there afterwards."""
    repo = _mk_path_identity_repo(tmp_path)
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake = fakebin / "mktemp"
    fake.write_text("#!/bin/sh\nexit 1\n")
    fake.chmod(0o755)
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    canary = cwd / "canary.txt"
    canary.write_text("must survive")
    env = dict(os.environ, PATH=str(fakebin) + os.pathsep + os.environ["PATH"])
    r = subprocess.run(
        ["bash", str(RUN), "--suite-gate", "--branch", "work",
         "--run", sys.executable + " -m pytest -q tests/", "--repo", str(repo)],
        capture_output=True, text=True, env=env, cwd=str(cwd))
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["status"] == "ERROR"
    assert out["passed"] is False
    assert r.returncode != 0
    assert canary.is_file() and canary.read_text() == "must survive"


# ── #105: whitespace-empty command knobs ──────────────────────────────────────

@pytest.mark.parametrize("cmd", ["   ", "\t", "\n", ""])
def test_suite_gate_refuses_whitespace_only_run(tmp_path, cmd):
    """#105 differential pin: BASE returns {"passed": true} for a whitespace-only
    --run (the false green — `eval "   "` exits 0 without running a suite); HEAD
    refuses loudly. The empty-string case rides the same branch so the stripped
    emptiness check cannot regress the refusal it replaces."""
    repo = _mk_path_identity_repo(tmp_path)
    r = subprocess.run(
        ["bash", str(RUN), "--suite-gate", "--branch", "work",
         "--run", cmd, "--repo", str(repo)],
        capture_output=True, text=True)
    assert r.returncode != 0, r.stdout + r.stderr
    assert '"passed": true' not in r.stdout
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["status"] == "ERROR"
    assert out["passed"] is False
    assert "--run" in out["output"]
