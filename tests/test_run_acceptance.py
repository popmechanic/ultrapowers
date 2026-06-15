"""Sealed acceptance: canonical hashing + deterministic exam runner, e2e
against a throwaway git repo and a tmp vault (no real ~/.ultrapowers use)."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "run_acceptance.sh"
HASH = SCRIPTS / "seal_hash.py"


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


def make_vault(tmp_path):
    suite = tmp_path / "vault" / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    entry = tmp_path / "vault" / seal_id
    (tmp_path / "vault" / "pending").rename(entry)
    (entry / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "suiteSha256": digest,
        "runCmd": "python3 -m pytest .ultra-acceptance -q"}))
    return tmp_path / "vault", seal_id, digest


def administer(vault, seal_id, digest, repo):
    r = sh(["bash", str(RUN), seal_id, "main", digest,
            "--vault", str(vault), "--repo", str(repo)], check=False)
    return r.returncode, json.loads(r.stdout)


def test_hash_is_stable_and_content_sensitive(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    again = sh([sys.executable, str(HASH), str(vault / seal_id / "suite")]).stdout.strip()
    assert again == digest and len(digest) == 64
    (vault / seal_id / "suite" / "test_exam.py").write_text("# tampered\n")
    assert sh([sys.executable, str(HASH), str(vault / seal_id / "suite")]).stdout.strip() != digest


def test_green_exam_passes(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert out["sealId"] == seal_id


def test_red_exam_fails_honestly(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["exitCode"] != 0


def test_broken_seal_refuses_to_run(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    (vault / seal_id / "suite" / "test_exam.py").write_text("assert True\n")
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "SEAL_BROKEN" and out["passed"] is False


def test_missing_seal_reports_missing(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(tmp_path / "vault", "000000000000", "0" * 64, repo)
    assert code != 0 and out["status"] == "SEAL_MISSING"


def test_worktree_cleaned_up(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    administer(vault, seal_id, digest, repo)
    listed = sh(["git", "worktree", "list"], cwd=repo).stdout.strip().splitlines()
    assert len(listed) == 1, "exam worktree leaked"


def test_malformed_manifest_never_false_greens(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    (vault / seal_id / "manifest.json").write_text(json.dumps({"sealId": seal_id}))
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0, "corrupt manifest must not exit 0"
    assert out["status"] == "ERROR" and out["passed"] is False


def test_unreadable_branch_reports_error(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    r = sh(["bash", str(RUN), seal_id, "no-such-branch", digest,
            "--vault", str(vault), "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    assert r.returncode != 0 and out["status"] == "ERROR" and out["passed"] is False


def _set_run_cmd(vault, seal_id, digest, run_cmd):
    """Rewrite the manifest's runCmd while preserving the recorded hash."""
    (vault / seal_id / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "suiteSha256": digest, "runCmd": run_cmd}))


def _write_manifest(vault, seal_id, digest, run_cmd, bootstrap_cmd=None):
    """Write a manifest preserving the recorded hash; optionally a bootstrapCmd."""
    m = {"sealId": seal_id, "suiteSha256": digest, "runCmd": run_cmd}
    if bootstrap_cmd is not None:
        m["bootstrapCmd"] = bootstrap_cmd
    (vault / seal_id / "manifest.json").write_text(json.dumps(m))


def test_runcmd_that_skips_the_suite_never_false_greens(tmp_path):
    """A runCmd that exits 0 without ever executing the sealed suite must NOT
    report passed. Feature is ABSENT here, so an honest pass is impossible."""
    vault, seal_id, digest = make_vault(tmp_path)
    _set_run_cmd(vault, seal_id, digest, "true")
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0, "a runCmd that never runs the suite must not exit 0"
    assert out["passed"] is False
    assert out["status"] == "ERROR"


def test_zero_collected_tests_with_swallowed_exit_never_false_greens(tmp_path):
    """A runCmd that collects zero sealed tests yet exits 0 (exit swallowed with
    `|| true`, the classic accidental false-green) must be ERROR, never a pass."""
    vault, seal_id, digest = make_vault(tmp_path)
    _set_run_cmd(vault, seal_id, digest,
                 "mkdir -p _empty && (python3 -m pytest _empty -q || true)")
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0, "zero collected tests with a swallowed exit must not exit 0"
    assert out["passed"] is False
    assert out["status"] == "ERROR"


def test_collection_error_from_missing_module_is_honest_red(tmp_path):
    """A suite whose import fails because the feature module is absent is the
    canonical 'feature not built' case: an honest red (status OK, passed false),
    NOT swallowed by the no-tests-ran guard, which only protects the green path."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from featuremod import shiny\n\n\ndef test_shiny():\n    assert shiny() == 42\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    (vault / seal_id / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "suiteSha256": digest,
        "runCmd": "python3 -m pytest .ultra-acceptance -q"}))
    repo = make_repo(tmp_path, feature_built=False)  # featuremod absent
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["passed"] is False
    assert out["status"] == "OK", "missing-module collection error is an honest red, not ERROR"


def test_honest_green_still_passes_after_guard(tmp_path):
    """Regression: the no-tests-ran defense must not break the real green path."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["status"] == "OK" and out["passed"] is True


def test_assertion_red_is_labeled(tmp_path):
    """Feature built but wrong: a test executes and fails -> redKind 'assertion'."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    # break the feature so the executed test asserts false
    (repo / "mod.py").write_text("def add(a, b):\n    return a - b\n")
    sh(["git", "commit", "-aqm", "wrong"], cwd=repo)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["redKind"] == "assertion"


def test_collection_red_is_labeled(tmp_path):
    """Feature module absent: import fails at collection, no test runs -> 'collection'."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from featuremod import shiny\n\n\ndef test_shiny():\n    assert shiny() == 42\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q")
    repo = make_repo(tmp_path, feature_built=False)  # featuremod absent -> import fails
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["redKind"] == "collection"


def test_bootstrap_runs_before_suite(tmp_path):
    """A bootstrapCmd that provisions a needed file lets the suite reach its
    assertion and pass — proving bootstrap runs in the worktree before runCmd."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from repolib import val\n\n\ndef test_val():\n    assert val() == 7\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="printf 'def val():\\n    return 7\\n' > repolib.py")
    repo = make_repo(tmp_path, feature_built=True)  # repolib NOT committed at base
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["status"] == "OK" and out["passed"] is True


def test_env_caused_collection_red_is_fixed_by_bootstrap(tmp_path):
    """The finding scenario: a suite importing a repo library absent in a bare
    worktree is a false red WITHOUT a bootstrap, and a true result WITH one."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from repolib import val\n\n\ndef test_val():\n    assert val() == 7\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    repo = make_repo(tmp_path, feature_built=True)
    # No bootstrap: repolib is unimportable -> false red labeled 'collection'.
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q")
    code, out = administer(vault, seal_id, digest, repo)
    assert out["passed"] is False and out["redKind"] == "collection"
    # With a bootstrap that provisions repolib -> honest green.
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="printf 'def val():\\n    return 7\\n' > repolib.py")
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["passed"] is True


def test_bootstrap_failure_is_env_error_not_red(tmp_path):
    """A bootstrapCmd that fails is EXAM_BOOTSTRAP_ERROR — never a feature red."""
    vault, seal_id, digest = make_vault(tmp_path)
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="exit 3")
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0
    assert out["status"] == "EXAM_BOOTSTRAP_ERROR" and out["passed"] is False
    assert "redKind" not in out


def test_missing_module_collection_red_keeps_status_ok(tmp_path):
    """Regression on the prior contract: a feature-absent collection error is
    still status OK / passed False (now additionally labeled 'collection')."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert out["status"] == "OK" and out["passed"] is False
