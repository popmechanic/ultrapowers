"""The laptop check stops rehearsing `Check:` lines at BASE (#1195).

`plan_check.py --base` used to cut a throwaway worktree at BASE and run every
`## Global Constraints` `- Check:` line there, printing a `RED-AT-BASE fact:`
line per command that exited non-zero. A sibling task moves that reading to
the sandbox, which runs each check once at base before the first dispatch and
records it as a `check:line` row. This task removes the laptop half: the
`red_at_base_lines` function and its `main()` call leave `plan_check.py`, and
`RED-AT-BASE`/`red_at_base` leave the file entirely.

Two legs, one per Machine clause this exam covers directly:

  * M1 — a signed one-task plan whose `## Global Constraints` carries one
    `Check:` that touches a marker file outside the repository and then exits
    1: `plan_check.py --base <head> <plan>` prints `PLAN OK` first, exits 0,
    prints no line beginning `RED-AT-BASE`, and leaves the marker absent — the
    laptop ran no `Check:` command at all. Graded by
    `test_m1_the_laptop_runs_no_check_command_at_base`.
  * M2 — the `plan_check` module carries no `red_at_base_lines` attribute and
    no `RED_FACT` attribute, while `green_at_base_lines` stays callable.
    Graded by `test_m2_red_at_base_symbols_are_gone_green_at_base_stays`, by
    `hasattr`/`callable` directly on the imported module.

M3 (the grep-for-the-literal and the rehearsal file's 14-test collection) and
M4 (the SKILL/gotchas prose and the RUNBOOK order) are graded by the task's
own `Run:` lines — shell greps and other files' pytest suites — not by
anything in this file, which proves only what a plan_check subprocess and the
`plan_check` module do.

The shape is `tests/test_plan_check_rehearsal.py`'s own BASE fixture, copied
rather than imported (that file loses its RED-AT-BASE section as part of this
same task): a one-commit git repository under `tmp_path`, a claims-v1 plan
signed with `<stem>.gate-verdicts.json` hashed by the gate's own extractor,
run as a real subprocess.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/plan_check.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import plan_check  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


# --------------------------------------------------------------------------- #
# The fixture: a one-commit repository, a signed claims-v1 plan whose         #
# Global Constraints carries one Check: that touches a marker file outside    #
# the repository and then exits 1 (`false`).                                  #
# --------------------------------------------------------------------------- #

AT_BASE = "at-base.txt"

HEAD = """# Check probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture

**Claim:** An operator's laptop check never rehearses `Check:` lines. (elicited)
"""

TASK = """
### Task 1: The prover

**Type:** implementation

**Files:**
- Modify: `src/prover.ts`
- Test: `tests/test_prover.py`

**Claim:** An operator running the prover sees it pass. (derived)
Machine: M1. The prover exits 0.

**Authorized-by:** #1195

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The prover is a standalone module with no registry to update.

**Proof:**
- Test: `tests/test_prover.py`
- (a) The suite asserts the prover exits 0. [M1]

**Stale-if:**
- sha-matches: `at-base.txt`
"""


def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, " ".join(args) + "\n" + p.stdout + p.stderr
    return p.stdout


def base_repo(tmp_path):
    """A one-commit git repository under `tmp_path` whose commit holds
    `at-base.txt` and nothing else. Returns (repo path, 40-hex HEAD sha)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", ".")
    _git(repo, "config", "user.email", "exam@example.invalid")
    _git(repo, "config", "user.name", "exam")
    (repo / AT_BASE).write_text("at base\n")
    _git(repo, "add", AT_BASE)
    _git(repo, "commit", "-qm", "at base")
    head = _git(repo, "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head), head
    return repo, head


def make_plan(check_cmd):
    """The plan text: one `## Global Constraints` `- Check:` bullet holding
    `check_cmd`, then the one-task body. No backtick in `check_cmd`."""
    assert "`" not in check_cmd, check_cmd
    constraints = "\n## Global Constraints\n\n- Check: %s\n" % check_cmd
    return HEAD + constraints + TASK


def write_plan(repo, name, text):
    """The plan plus the gate-verdict record claims-v1 requires (spec §4.5),
    hashed by the gate's own extractor so a fixture edit re-signs itself."""
    plan = pathlib.Path(repo) / name
    plan.write_text(text)
    entry = gate_input(plan, "1")
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": entry["hash"], "verdict": "pass",
                         "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


# =========================================================================== #
# [M1] — the laptop runs no Check: command at all                             #
# =========================================================================== #

def test_m1_the_laptop_runs_no_check_command_at_base(tmp_path):
    """[M1]: a signed one-task plan whose Global Constraints carries one
    `Check:` that touches a marker file outside the repository and then exits
    1 (`touch <marker>; false`) — under `--base <head> <plan>`, the first
    stdout line is exactly `PLAN OK`, the exit code is exactly 0, no stdout
    line begins `RED-AT-BASE`, and the marker file does not exist afterwards:
    the laptop ran no `Check:` command."""
    repo, head = base_repo(tmp_path)
    marker = tmp_path / "check-ran.marker"
    assert not str(marker).startswith(str(repo)), (
        "the marker must sit outside the repository")
    check_cmd = "touch %s; false" % marker
    plan = write_plan(repo, "m1.md", make_plan(check_cmd))

    p = subprocess.run(
        [sys.executable, str(COMPILER), "--base", head, str(plan)],
        capture_output=True, text=True)
    out = p.stdout + p.stderr

    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout
    red_lines = [line for line in p.stdout.splitlines()
                if line.startswith("RED-AT-BASE")]
    assert red_lines == [], p.stdout
    assert not marker.exists(), (
        "the marker file exists — the laptop ran the Check: command")


# =========================================================================== #
# [M2] — the module carries neither symbol, and green_at_base_lines stays     #
# =========================================================================== #

def test_m2_red_at_base_symbols_are_gone_green_at_base_stays():
    """[M2]: `plan_check` has no attribute `red_at_base_lines` and no
    attribute `RED_FACT`, while `green_at_base_lines` is still callable."""
    assert hasattr(plan_check, "red_at_base_lines") is False, (
        "plan_check still carries red_at_base_lines")
    assert hasattr(plan_check, "RED_FACT") is False, (
        "plan_check still carries RED_FACT")
    assert callable(getattr(plan_check, "green_at_base_lines", None)) is True, (
        "plan_check.green_at_base_lines is missing or not callable")
