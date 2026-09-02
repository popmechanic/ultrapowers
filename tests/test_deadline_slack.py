"""The python half of #478's deadline seam.

`tests/deadline_slack.py` and `fleet/tests/deadline-slack.mjs` are two files in
two languages with no import between them, so the literals they must agree on —
the variable name `FLEET_TEST_SLACK` and the default multiplier `4` — are pinned
here against both modules at once.

Legs (b), (d) and (f) of the task's Proof live here; (a), (c) and (e) are the
node-side shape, in fleet/tests/test_deadline_slack.mjs.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

from deadline_slack import DEFAULT_SLACK, SLACK_ENV, deadline_budget, slack  # noqa: E402

ULTRA_RUN_SPEC = ROOT / "tests/test_ultra_run.py"
SIGTERM_TEST = "test_validate_knobs_removes_its_probe_worktree_on_sigterm"


def _env(value):
    """A child environment with FLEET_TEST_SLACK unset (None) or set.

    PYTEST_ADDOPTS is dropped so a child pytest runs exactly the command the
    Proof names and does not inherit the parent's `-n auto`.
    """
    env = dict(os.environ)
    env.pop("PYTEST_ADDOPTS", None)
    env.pop(SLACK_ENV, None)
    if value is not None:
        env[SLACK_ENV] = value
    return env


@pytest.fixture
def slack_env(monkeypatch):
    def apply(value):
        if value is None:
            monkeypatch.delenv(SLACK_ENV, raising=False)
        else:
            monkeypatch.setenv(SLACK_ENV, value)

    return apply


# --- (b) the seam itself [M2] ---------------------------------------------


def test_b_unset_defaults_to_four(slack_env):
    slack_env(None)
    assert slack() == 4
    assert deadline_budget(300) == 1200


def test_b_one_takes_the_base_at_face_value(slack_env):
    slack_env("1")
    assert slack() == 1
    assert deadline_budget(300) == 300


@pytest.mark.parametrize("value", ["abc", "0", "-2"])
def test_b_a_value_that_is_not_a_positive_number_falls_back(slack_env, value):
    slack_env(value)
    assert slack() == 4


def test_b_both_modules_carry_the_same_variable_name_and_default():
    """Two languages, no import between them: the agreement is the contract."""
    r = subprocess.run(
        [
            "node",
            "-e",
            "import('./fleet/tests/deadline-slack.mjs').then("
            "(m) => console.log(JSON.stringify([m.SLACK_ENV, String(m.DEFAULT_SLACK)])))",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout) == [SLACK_ENV, str(DEFAULT_SLACK)]
    assert [SLACK_ENV, str(DEFAULT_SLACK)] == ["FLEET_TEST_SLACK", "4"]


# --- (d) the two deadlines in test_ultra_run.py are seam calls [M4] --------


def _ultra_run_source():
    return ULTRA_RUN_SPEC.read_text(encoding="utf-8")


def _sigterm_body(text):
    """The test's body: its `def` line through the next top-level `def`."""
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith(f"def {SIGTERM_TEST}("))
    end = next(
        (i for i in range(start + 1, len(lines)) if lines[i].startswith("def ")),
        len(lines),
    )
    return "\n".join(lines[start:end])


def test_d_no_bare_fifteen_second_deadline_survives():
    text = _ultra_run_source()
    assert "time.time() + 15" not in text
    assert "proc.wait(timeout=15)" not in text


def test_d_the_spec_imports_the_seam():
    assert re.search(
        r"^from deadline_slack import .*\bdeadline_budget\b", _ultra_run_source(), re.M
    ), "test_ultra_run.py must import deadline_budget from deadline_slack"


@pytest.mark.parametrize(
    "needle", ["time.time() + deadline_budget(15)", "proc.wait(timeout=deadline_budget(15)"]
)
def test_d_each_deadline_is_a_budget_call_with_no_bare_number(needle):
    body = _sigterm_body(_ultra_run_source())
    assert needle in body, f"{SIGTERM_TEST} must budget its deadline: {needle}"
    line = next(l for l in body.splitlines() if needle in l)
    outside = re.sub(r"deadline_budget\([^)]*\)", "", line)
    assert not re.search(r"\d", outside), (
        f"the deadline carries a numeric literal outside its deadline_budget( call, "
        f"so it is a bare widened number: {line.strip()}"
    )


# --- (f) the spec still passes, slack set and unset [M5] ------------------


@pytest.mark.parametrize("value", [None, "1"])
def test_f_test_ultra_run_passes_with_slack_set_and_unset(value):
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "tests/test_ultra_run.py"],
        cwd=ROOT,
        env=_env(value),
        capture_output=True,
        text=True,
    )
    label = "unset" if value is None else f"{SLACK_ENV}={value}"
    assert r.returncode == 0, f"tests/test_ultra_run.py failed with {label}:\n{r.stdout}{r.stderr}"
