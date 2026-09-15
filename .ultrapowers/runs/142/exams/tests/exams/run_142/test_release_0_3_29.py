"""run-142 task 1 exam — "The plugin is 0.3.29 in both manifests and in its own instructions".

The Proof named this file `tests/test_release_0_3_29.py`; the run keeps it at
`tests/exams/run_142/test_release_0_3_29.py` (it is a one-run fact, unguarded,
so it lives on the evidence tag). Paths below are written for where it lands:
the repo root is three directories up.

Each test names the Machine clause and the Proof leg it comes from:

  M1 / leg (a)  both manifests carry the string `0.3.29` at their own place, and
                nothing else in either file changed against $ULTRA_BASE.
  M2 / leg (b)  CLAUDE.md's Versioning bullet reads 0.3.29 today, still says a
                release is a fleet plan merged by the sandbox and tagged with
                `gh release create`, and no longer says 0.3.28 today.
  M3 / leg (c)  the two manifests carry one and the same version string, and the
                diff against $ULTRA_BASE names nothing outside this task's files.

The last `Run:` of the Proof (`wc -w skills/*/SKILL.md fleet/roles/*.md`) is a
report — CLAUDE.md §"Judgment prompts are data files" says those sizes "gate
nothing" — so it is not a leg and earns no assertion here.
"""

import copy
import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]

PLUGIN = ".claude-plugin/plugin.json"
MARKETPLACE = ".claude-plugin/marketplace.json"
CLAUDE_MD = "CLAUDE.md"

VERSION = "0.3.29"
PRIOR_VERSION = "0.3.28"
PLUGIN_NAME = "ultrapowers"

# The sha this task's tree was cut at. $ULTRA_BASE is set for every exam command
# (fleet/CONTRACT.md); this literal is only the fallback for a hand run.
BASE_SHA = "fdb2dd2755ada15c8a00159ea9919c3bf6b2ae2a"

# leg (c): `git diff --name-only $ULTRA_BASE` may name these and nothing else.
ALLOWED_EXACT = {PLUGIN, MARKETPLACE, CLAUDE_MD, "tests/test_release_0_3_29.py"}
ALLOWED_PREFIX = "tests/exams/"


def _git(*args):
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ).stdout


@pytest.fixture(scope="module")
def base():
    """The base sha, from $ULTRA_BASE, falling back to this run's BASE."""
    sha = os.environ.get("ULTRA_BASE") or BASE_SHA
    try:
        _git("rev-parse", "--verify", sha + "^{commit}")
    except subprocess.CalledProcessError as exc:  # pragma: no cover - env fault
        pytest.fail(
            "cannot resolve the base sha %r (from %s): %s"
            % (sha, "$ULTRA_BASE" if os.environ.get("ULTRA_BASE") else "BASE_SHA",
               exc.stderr.decode(errors="replace"))
        )
    return sha


def _read_json(relpath):
    with (ROOT / relpath).open(encoding="utf-8") as fh:
        return json.load(fh)


def _base_json(base, relpath):
    return json.loads(_git("show", "%s:%s" % (base, relpath)).decode("utf-8"))


def _marketplace_entry(doc):
    entries = [p for p in doc["plugins"] if p["name"] == PLUGIN_NAME]
    assert len(entries) == 1, (
        "[M1/leg a] %s should hold exactly one plugins[] entry named %r, found %d"
        % (MARKETPLACE, PLUGIN_NAME, len(entries))
    )
    return entries[0]


# ---------------------------------------------------------------- M1 / leg (a)

def test_m1_plugin_json_version_is_0_3_29():
    """[M1/leg a] `.claude-plugin/plugin.json`'s `version` is the string `0.3.29`."""
    got = _read_json(PLUGIN)["version"]
    assert got == VERSION, (
        "[M1/leg a] %s's top-level `version` is %r, expected the string %r"
        % (PLUGIN, got, VERSION)
    )


def test_m1_marketplace_json_version_is_0_3_29():
    """[M1/leg a] marketplace.json's `plugins[name=ultrapowers].version` is `0.3.29`."""
    got = _marketplace_entry(_read_json(MARKETPLACE))["version"]
    assert got == VERSION, (
        "[M1/leg a] %s's plugins[name=%s].version is %r, expected the string %r"
        % (MARKETPLACE, PLUGIN_NAME, got, VERSION)
    )


def test_m1_plugin_json_changed_only_its_version(base):
    """[M1/leg a] no other key of plugin.json changes against $ULTRA_BASE."""
    was = _base_json(base, PLUGIN)
    now = _read_json(PLUGIN)
    expected = dict(was)
    expected["version"] = VERSION
    assert expected == now, (
        "[M1/leg a] %s changed more than its `version`: expected the base object with "
        "`version` set to %r, got %r" % (PLUGIN, VERSION, now)
    )


def test_m1_marketplace_json_changed_only_the_ultrapowers_version(base):
    """[M1/leg a] no other key of marketplace.json changes against $ULTRA_BASE."""
    was = _base_json(base, MARKETPLACE)
    now = _read_json(MARKETPLACE)
    expected = copy.deepcopy(was)
    for entry in expected["plugins"]:
        if entry["name"] == PLUGIN_NAME:
            entry["version"] = VERSION
    assert expected == now, (
        "[M1/leg a] %s changed more than the %s version: expected the base object with "
        "that one `version` set to %r, got %r"
        % (MARKETPLACE, PLUGIN_NAME, VERSION, now)
    )


# ---------------------------------------------------------------- M2 / leg (b)

def _versioning_bullet():
    """CLAUDE.md's Versioning bullet, newlines folded to spaces.

    The Proof reads it with `sed -n '/\\*\\*Versioning:\\*\\*/,/^- \\*\\*/p' | tr '\\n' ' '`:
    the range opens on the first line holding `**Versioning:**` and closes on the
    next line beginning `- **` (sed never tests the end pattern against the line
    that opened the range), and both endpoints are printed.
    """
    lines = (ROOT / CLAUDE_MD).read_text(encoding="utf-8").split("\n")
    starts = [i for i, line in enumerate(lines) if "**Versioning:**" in line]
    assert starts, (
        "[M2/leg b] %s has no line containing `**Versioning:**` — the bullet the "
        "clause names is gone" % CLAUDE_MD
    )
    start = starts[0]
    end = len(lines) - 1
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("- **"):
            end = i
            break
    return " ".join(lines[start:end + 1]) + " "


def test_m2_versioning_bullet_reads_in_order():
    """[M2/leg b] the bullet holds `0.3.29`, then `today`, then the three phrases.

    This is the Proof's second `Run:` verbatim: one ordered match over the
    flattened bullet.
    """
    bullet = _versioning_bullet()
    pattern = (r"0\.3\.29.*today.*a release is a fleet plan.*merged by the"
               r".*gh release create")
    assert re.search(pattern, bullet), (
        "[M2/leg b] the Versioning bullet does not read %r in that order; bullet is:\n%s"
        % (pattern, bullet)
    )


@pytest.mark.parametrize("needle", [
    VERSION,
    "today",
    "a release is a fleet plan",
    "merged by the",
    "gh release create",
])
def test_m2_versioning_bullet_contains(needle):
    """[M2/leg b] each thing the clause names is present in the bullet."""
    bullet = _versioning_bullet()
    assert needle in bullet, (
        "[M2/leg b] the Versioning bullet does not contain %r; bullet is:\n%s"
        % (needle, bullet)
    )


def test_m2_versioning_bullet_no_longer_says_0_3_28_today():
    """[M2/leg b] the bullet contains `0.3.28` followed by `today` nowhere.

    The Proof's third `Run:`: `grep -c '0\\.3\\.28[^0-9]*today'` over the flattened
    bullet must be 0.
    """
    bullet = _versioning_bullet()
    hits = re.findall(r"0\.3\.28[^0-9]*today", bullet)
    assert hits == [], (
        "[M2/leg b] the Versioning bullet still says %s ... today: %r"
        % (PRIOR_VERSION, hits)
    )


# ---------------------------------------------------------------- M3 / leg (c)

def test_m3_both_manifests_carry_one_and_the_same_version():
    """[M3/leg c] the two manifests carry one and the same version string.

    The Proof's fourth `Run:` asserts the two are equal; M1 pins what that one
    shared string is, so both are asserted here.
    """
    a = _read_json(PLUGIN)["version"]
    b = _marketplace_entry(_read_json(MARKETPLACE))["version"]
    assert a == b, (
        "[M3/leg c] the manifests drifted: %s carries %r, %s carries %r"
        % (PLUGIN, a, MARKETPLACE, b)
    )
    assert a == VERSION, (
        "[M3/leg c + M1] the one version string both manifests carry is %r, "
        "expected %r" % (a, VERSION)
    )


def test_m3_diff_names_nothing_outside_this_task(base):
    """[M3/leg c] `git diff --name-only $ULTRA_BASE` names no path outside scope.

    The Proof's fifth `Run:`: everything but the three modified files,
    `tests/exams/` and this task's own exam path must be absent from the diff.
    """
    named = [p for p in _git("diff", "--name-only", base).decode("utf-8").split("\n") if p]
    stray = [p for p in named
             if p not in ALLOWED_EXACT and not p.startswith(ALLOWED_PREFIX)]
    assert stray == [], (
        "[M3/leg c] the diff against the base names paths outside this task's scope: %r "
        "(allowed: %r plus anything under %r)"
        % (stray, sorted(ALLOWED_EXACT), ALLOWED_PREFIX)
    )
