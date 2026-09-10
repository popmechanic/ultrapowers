"""The gate reads the recorded suite result (Task 1 exam).

Claim: the gate no longer runs the suite itself — it reads the suite result the
run already recorded in the report's `tests` block, and passes or blocks on it.

Legs (a) and (b) drive `ultra_gate.py --result` through `python3` against a
throwaway git repo, the way `tests/test_ultra_gate.py`'s `make_repo` does, with
`gate_check.py` real. The scripts dir the driver runs from carries exactly the
two scripts this contract leaves alive — no `run_acceptance.sh`, because M4
deletes it.

Legs (c) and (d) are the guard: they read the committed files, so a later run
that re-adds the script or re-introduces a `run_acceptance` reference goes red
here. M4 names paths, not a directory sweep — every path it names is in this
task's Files.

At BASE this exam is red because the implementation is absent: `ultra_gate.py`
still administers acceptance out of `receipt.json` (shelling `run_acceptance.sh`)
and writes `receipt["acceptance"]` instead of `receipt["suite"]`, and the two
deleted paths are still on disk.
"""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"

# M3: the strings the acceptance block took with it when it left ultra_gate.py.
RETIRED_TOKENS = ("run_acceptance", "--suite-gate", "sealed", "waived")

# M4: deleted outright.
DELETED_PATHS = (
    "skills/ultrapowers/scripts/run_acceptance.sh",
    "tests/test_run_acceptance.py",
)

# M4: survive, but with no `run_acceptance` left in them.
SCRUBBED_FILES = (
    "skills/ultrapowers/scripts/ultra_gate.py",
    "skills/ultrapowers/scripts/gate_check.py",
    "skills/ultrapowers/SKILL.md",
    "fleet/tests/test_run_record_keys.mjs",
)


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True,
                          text=True)


def make_repo(tmp_path):
    """Throwaway repo + a scripts dir holding the driver and the real
    gate_check.py. Returns (repo, scripts, head)."""
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "f.txt").write_text("base\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    sh(["git", "checkout", "-qb", "ultra/int"], cwd=repo)
    (repo / "f.txt").write_text("work\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "work"], cwd=repo)
    head = sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    sh(["git", "checkout", "-q", "main"], cwd=repo)

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for f in ("ultra_gate.py", "gate_check.py"):
        shutil.copy2(SCRIPTS / f, scripts / f)

    run_dir = repo / ".claude/ultrapowers/run-t1"
    run_dir.mkdir(parents=True)
    # A run receipt as ultra_run stamps one: the gate is free to ignore it —
    # the suite result it reports on comes from the report, not from here.
    (run_dir / "receipt.json").write_text(json.dumps({
        "ok": True, "stamp": "t1", "baseBranch": "main",
        "testCmd": "python3 -m pytest -q"}))
    return repo, scripts, head


def report_with(head, tests):
    """A report gate_check.py passes on. `tests` is spliced in verbatim; pass
    None to omit the block entirely."""
    report = {"integrationBranch": "ultra/int", "waves": [["1"]],
              "tasks": [{"task": "1", "status": "done"}],
              "unfinished": [], "gitVerified": True,
              "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": head}],
              "coverage": {"tasks_merged": 1, "tasks_planned": 1,
                           "complete": True}}
    if tests is not None:
        report["tests"] = tests
    return report


def run_gate(tmp_path, tests):
    """Drive the gate over a report carrying `tests`. Returns
    (exit_code, printed_receipt, saved_receipt_or_None)."""
    repo, scripts, head = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(report_with(head, tests)))
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--result", str(result)], cwd=repo, check=False)
    try:
        printed = json.loads(r.stdout)
    except Exception as e:
        raise AssertionError(
            "gate printed no receipt JSON (%s)\nstdout:\n%s\nstderr:\n%s"
            % (e, r.stdout, r.stderr))
    saved_path = repo / ".claude/ultrapowers/run-t1/gate-receipt.json"
    saved = json.loads(saved_path.read_text()) if saved_path.is_file() else None
    return r.returncode, printed, saved


# ── leg (a) [M1] ─────────────────────────────────────────────────────────

def test_recorded_green_suite_passes_the_gate(tmp_path):
    """Leg (a) [M1]: a report whose `tests.passed` is true, with a PASS
    gate_check, writes a gate receipt with verdict PASS and `suite` equal to
    {"passed": true, "output": <the report's tests.output>}, and exits 0."""
    output = "553 passed in 12.34s"
    code, printed, saved = run_gate(tmp_path, {
        "command": "python3 -m pytest -q", "passed": True, "output": output})

    assert printed["verdict"] == "PASS", (
        "[M1] leg (a): verdict is %r, not PASS — receipt: %s"
        % (printed.get("verdict"), json.dumps(printed)))
    assert printed.get("suite") == {"passed": True, "unattributed": [],
                                    "output": output}, (
        "[M1] leg (a): receipt.suite is %r, not the recorded result "
        "{'passed': True, 'unattributed': [], 'output': %r}"
        % (printed.get("suite"), output))
    assert code == 0, (
        "[M1] leg (a): exit %d, not 0 — receipt: %s" % (code, json.dumps(printed)))
    assert saved is not None, (
        "[M1] leg (a): no gate receipt written to run-t1/gate-receipt.json")
    assert saved["verdict"] == "PASS", (
        "[M1] leg (a): saved gate receipt records verdict %r, not PASS"
        % saved.get("verdict"))
    assert saved.get("suite") == {"passed": True, "unattributed": [],
                                  "output": output}, (
        "[M1] leg (a): saved gate receipt's suite is %r" % (saved.get("suite"),))


# ── leg (b) [M2] ─────────────────────────────────────────────────────────

def test_recorded_red_suite_blocks_the_gate(tmp_path):
    """Leg (b) [M2]: the same call with `tests.passed` false writes verdict
    BLOCKED and `suite.passed` false, and exits 1."""
    output = "1 failed, 552 passed in 12.34s"
    code, printed, saved = run_gate(tmp_path, {
        "command": "python3 -m pytest -q", "passed": False, "output": output})

    assert printed["verdict"] == "BLOCKED", (
        "[M2] leg (b): a recorded red suite yielded verdict %r, not BLOCKED — "
        "receipt: %s" % (printed.get("verdict"), json.dumps(printed)))
    assert printed.get("suite") == {"passed": False, "unattributed": [],
                                    "output": output}, (
        "[M2] leg (b): receipt.suite is %r, not {'passed': False, "
        "'unattributed': [], 'output': %r}" % (printed.get("suite"), output))
    assert code == 1, (
        "[M2] leg (b): exit %d, not 1 — a recorded red suite must block" % code)
    assert saved is not None and saved["verdict"] == "BLOCKED", (
        "[M2] leg (b): saved gate receipt is %r" % (saved,))


# ── the unattributed red (Task 1: "An unattributed red is reported, an ────────
#    attributed one is repaired") [M5]
#
# The `[]` case is leg (b) above, kept exactly as it was: a red suite whose
# failing paths are the run's own still BLOCKS. What is added here is the one
# reading that does not — a red every one of whose failing paths went red on a
# fold no task of its wave names. The gate copies the list into the receipt and
# passes, because that red is a fact about the repository the run inherited
# rather than about the work it did.


def test_unattributed_red_suite_passes_the_gate(tmp_path):
    """`tests.passed` false with a non-empty `tests.unattributed` writes
    verdict PASS, `suite.unattributed` equal to the report's list, and exits
    0."""
    output = "1 failed, 552 passed in 12.34s"
    code, printed, saved = run_gate(tmp_path, {
        "command": "python3 -m pytest -q", "passed": False,
        "unattributed": ["tests/other.py"], "output": output})

    assert printed["verdict"] == "PASS", (
        "[M5]: a red suite whose failing paths no task names yielded verdict "
        "%r, not PASS — receipt: %s"
        % (printed.get("verdict"), json.dumps(printed)))
    assert printed.get("suite") == {"passed": False,
                                    "unattributed": ["tests/other.py"],
                                    "output": output}, (
        "[M5]: receipt.suite is %r, not {'passed': False, 'unattributed': "
        "['tests/other.py'], 'output': %r}" % (printed.get("suite"), output))
    assert code == 0, (
        "[M5]: exit %d, not 0 — an unattributed red does not block" % code)
    assert saved is not None and saved["verdict"] == "PASS", (
        "[M5]: saved gate receipt is %r" % (saved,))
    assert saved.get("suite", {}).get("unattributed") == ["tests/other.py"], (
        "[M5]: the saved receipt's suite.unattributed is %r"
        % (saved.get("suite", {}).get("unattributed"),))


def test_red_suite_with_an_empty_unattributed_list_still_blocks(tmp_path):
    """The `[]` case, spelled out: `unattributed: []` is the same reading as no
    key at all — BLOCKED, exit 1."""
    code, printed, saved = run_gate(tmp_path, {
        "command": "python3 -m pytest -q", "passed": False,
        "unattributed": [], "output": "boom"})

    assert printed["verdict"] == "BLOCKED", (
        "[M5]: `unattributed: []` yielded verdict %r, not BLOCKED — receipt: %s"
        % (printed.get("verdict"), json.dumps(printed)))
    assert printed.get("suite") == {"passed": False, "unattributed": [],
                                    "output": "boom"}, (
        "[M5]: receipt.suite is %r" % (printed.get("suite"),))
    assert code == 1, (
        "[M5]: exit %d, not 1 — a red no `unattributed` excuses must block"
        % code)
    assert saved is not None and saved["verdict"] == "BLOCKED", (
        "[M5]: saved gate receipt is %r" % (saved,))


def test_report_without_a_tests_block_blocks_naming_tests(tmp_path):
    """Leg (b) [M2]: a report with no `tests` key writes BLOCKED with a detail
    naming `tests` — the gate has no suite result to read and says so."""
    code, printed, _ = run_gate(tmp_path, None)

    assert printed["verdict"] == "BLOCKED", (
        "[M2] leg (b): a report with no tests block yielded verdict %r, not "
        "BLOCKED — receipt: %s" % (printed.get("verdict"), json.dumps(printed)))
    detail = printed.get("detail", "")
    assert "tests" in detail, (
        "[M2] leg (b): the BLOCKED detail does not name `tests`: %r" % (detail,))
    assert code == 1, (
        "[M2] leg (b): exit %d, not 1, for a report with no tests block" % code)


# ── leg (c) [M3] ─────────────────────────────────────────────────────────

def test_no_acceptance_key_on_either_receipt(tmp_path):
    """Leg (c) [M3]: the gate receipt carries no `acceptance` key — neither on
    the green run of leg (a) nor on the red run of leg (b)."""
    for label, tests in (
            ("green", {"command": "x", "passed": True, "output": "ok"}),
            ("red", {"command": "x", "passed": False, "output": "boom"})):
        _, printed, saved = run_gate(tmp_path / label, tests)
        assert "acceptance" not in printed, (
            "[M3] leg (c): the %s receipt still carries an `acceptance` key: %r"
            % (label, printed.get("acceptance")))
        assert saved is not None and "acceptance" not in saved, (
            "[M3] leg (c): the saved %s gate receipt still carries an "
            "`acceptance` key: %r" % (label, (saved or {}).get("acceptance")))


def test_ultra_gate_keeps_none_of_the_retired_acceptance_strings():
    """Leg (c) [M3]: `ultra_gate.py` contains none of `run_acceptance`,
    `--suite-gate`, `sealed`, `waived`."""
    path = ROOT / "skills/ultrapowers/scripts/ultra_gate.py"
    assert path.is_file(), "[M3] leg (c): %s is missing" % path
    src = path.read_text()
    for token in RETIRED_TOKENS:
        hits = src.count(token)
        assert hits == 0, (
            "[M3] leg (c): skills/ultrapowers/scripts/ultra_gate.py still "
            "contains %r (%d occurrence(s)) — the acceptance block is meant to "
            "be gone, not renamed" % (token, hits))


# ── leg (d) [M4] ─────────────────────────────────────────────────────────

def test_deleted_paths_are_absent():
    """Leg (d) [M4]: `skills/ultrapowers/scripts/run_acceptance.sh` and
    `tests/test_run_acceptance.py` are absent."""
    for rel in DELETED_PATHS:
        assert not (ROOT / rel).exists(), (
            "[M4] leg (d): %s is still present — the gate administers no "
            "acceptance, so the script and its suite have no reader" % rel)


def test_named_files_carry_no_run_acceptance_reference():
    """Leg (d) [M4]: for each of `ultra_gate.py`, `gate_check.py`, `SKILL.md`
    and `fleet/tests/test_run_record_keys.mjs`, the string `run_acceptance`
    does not occur."""
    for rel in SCRUBBED_FILES:
        path = ROOT / rel
        assert path.is_file(), (
            "[M4] leg (d): %s is missing — it is modified by this task, not "
            "deleted" % rel)
        hits = path.read_text().count("run_acceptance")
        assert hits == 0, (
            "[M4] leg (d): %s still names `run_acceptance` (%d occurrence(s))"
            % (rel, hits))
