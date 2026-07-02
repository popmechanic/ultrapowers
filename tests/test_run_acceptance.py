"""Sealed acceptance: canonical hashing + deterministic exam runner, e2e
against a throwaway git repo and a tmp vault (no real ~/.ultrapowers use)."""
import json
import pathlib
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "run_acceptance.sh"
HASH = SCRIPTS / "seal_hash.py"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")


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


def make_vault(tmp_path, *, run_cmd=None, framework=None, ran_pattern=None,
               suite_files=None):
    """Create a vault entry. Accepts optional keyword args for non-pytest suites.
    Returns (vault_path, seal_id, digest) — same triple in all cases so the new
    tests can store it as a single variable and pass it to run_acceptance()."""
    suite = tmp_path / "vault" / "pending" / "suite"
    suite.mkdir(parents=True)
    if suite_files is None:
        (suite / "test_exam.py").write_text(
            "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    else:
        for name, content in suite_files.items():
            (suite / name).write_text(content)
    if run_cmd is None:
        run_cmd = "python3 -m pytest .ultra-acceptance -q"
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    entry = tmp_path / "vault" / seal_id
    (tmp_path / "vault" / "pending").rename(entry)
    manifest = {"sealId": seal_id, "suiteSha256": digest, "runCmd": run_cmd}
    if framework is not None:
        manifest["framework"] = framework
    if ran_pattern is not None:
        manifest["ranPattern"] = ran_pattern
    (entry / "manifest.json").write_text(json.dumps(manifest))
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


def baseline(suite, branch, repo, run_cmd, bootstrap=None):
    cmd = ["bash", str(RUN), "--baseline", "--suite", str(suite),
           "--branch", branch, "--run", run_cmd, "--repo", str(repo)]
    if bootstrap is not None:
        cmd += ["--bootstrap", bootstrap]
    r = sh(cmd, check=False)
    return r.returncode, json.loads(r.stdout)


def _bare_suite(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "test_exam.py").write_text(
        "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    return suite


def test_baseline_mode_proves_red(tmp_path):
    """Feature absent at baseline -> PROVEN_RED, exit 0 (the proof holds)."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = baseline(suite, "main", repo, "python3 -m pytest .ultra-acceptance -q")
    assert code == 0 and out["status"] == "PROVEN_RED" and out["passed"] is False


def test_baseline_mode_rejects_green(tmp_path):
    """Feature already present at baseline -> GREEN_AT_BASELINE, non-zero exit."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    code, out = baseline(suite, "main", repo, "python3 -m pytest .ultra-acceptance -q")
    assert code != 0 and out["status"] == "GREEN_AT_BASELINE" and out["passed"] is True


def test_baseline_mode_surfaces_bootstrap_error(tmp_path):
    """A failing bootstrap at baseline is an env error, not a proven red."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = baseline(suite, "main", repo,
                         "python3 -m pytest .ultra-acceptance -q", bootstrap="exit 4")
    assert code != 0 and out["status"] == "EXAM_BOOTSTRAP_ERROR" and out["passed"] is False


# ── framework-agnostic ("tests actually ran") tests ───────────────────────────

def run_acceptance(repo, vault):
    """Wrapper: vault is the (vault_path, seal_id, digest) triple from make_vault."""
    vault_path, seal_id, digest = vault
    _, out = administer(vault_path, seal_id, digest, repo)
    return out


def test_non_pytest_green_suite_certifies(tmp_path):
    """A non-pytest suite that exits 0 and emits the ranPattern must certify OK.
    Suite scripts live in .ultra-acceptance/ (the sealed suite dir); runCmd must
    reference them via that path from the exam worktree root."""
    repo = make_repo(tmp_path, feature_built=True)
    vault = make_vault(tmp_path, run_cmd="bash .ultra-acceptance/run.sh",
                       framework="generic", ran_pattern=r"[0-9]+ passed",
                       suite_files={"run.sh": 'echo "1 passed"; exit 0\n'})
    res = run_acceptance(repo, vault)
    assert res["status"] == "OK" and res["passed"] is True


def test_non_pytest_red_suite_is_assertion(tmp_path):
    """A non-pytest suite that exits non-zero and emits the ranPattern is redKind assertion."""
    repo = make_repo(tmp_path, feature_built=False)
    vault = make_vault(tmp_path, run_cmd="bash .ultra-acceptance/run.sh",
                       framework="generic", ran_pattern=r"[0-9]+ (passed|failed)",
                       suite_files={"run.sh": 'echo "1 failed"; exit 1\n'})
    res = run_acceptance(repo, vault)
    assert res["passed"] is False and res["redKind"] == "assertion"


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


# ── Harness JS-behavioral sims (issue #79) ────────────────────────────────────

def make_js_suite_repo(tmp_path, *, sim_body=None, name="jsrepo"):
    """Repo with a committed pytest suite, a harness JS file, and (optionally) a
    harness sim under tests/. `sim_body=None` means no harness sim exists."""
    repo = tmp_path / name
    (repo / "tests").mkdir(parents=True)
    (repo / "skills" / "ultrapowers" / "harnesses").mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / "tests" / "test_committed.py").write_text("def test_ok():\n    assert True\n")
    (repo / "skills/ultrapowers/harnesses" / "waves.js").write_text("// harness v1\n")
    (repo / "README.md").write_text("v1\n")
    if sim_body is not None:
        (repo / "tests" / "harness_sim.mjs").write_text(sim_body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def _branch_editing(repo, path, text, branch="feat"):
    """Create `branch` off HEAD, change one file, commit, return to main."""
    sh(["git", "checkout", "-q", "-b", branch], cwd=repo)
    (repo / path).write_text(text)
    sh(["git", "commit", "-qam", "change"], cwd=repo)
    sh(["git", "checkout", "-q", "main"], cwd=repo)
    return branch


GREEN_SIM = "// exercises harnesses/waves.js\nconsole.log('checked harness');\nconsole.log('ALL SCENARIOS PASSED');\n"
RED_SIM = "// exercises harnesses/waves.js\nconsole.log('checking harness');\nprocess.exit(1);\n"
SILENT_SIM = "// exercises harnesses/waves.js\nconsole.log('did setup but asserted nothing');\n"


@needs_node
def test_suite_gate_runs_harness_sims_green(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=GREEN_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert "ALL SCENARIOS PASSED" in out["output"]


@needs_node
def test_suite_gate_red_sim_parks(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=RED_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["redKind"] == "assertion"


@needs_node
def test_suite_gate_sim_false_green_is_error(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=SILENT_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"


@needs_node
def test_suite_gate_no_harness_diff_skips_sims(tmp_path):
    # A red sim exists, but the branch changes only a non-harness file, so the
    # sim must NOT run — proving detection gates on the diff (no regression).
    repo = make_js_suite_repo(tmp_path, sim_body=RED_SIM)
    br = _branch_editing(repo, "README.md", "v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code == 0 and out["status"] == "OK" and out["passed"] is True


@needs_node
def test_suite_gate_harness_diff_no_sim_is_error(tmp_path):
    # Harness JS changed but no tests/*.mjs exercises harnesses/ -> refuse to
    # green unverified JS (empty run-set is a hard error).
    repo = make_js_suite_repo(tmp_path, sim_body=None)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"


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
