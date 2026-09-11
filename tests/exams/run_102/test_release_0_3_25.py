"""Exam for run-102 task 1 — "The plugin is 0.3.25, and the instructions say a
release is a fleet plan".

One test per Proof leg; each assertion names the leg and the Machine clause it
comes from.

  leg (a) [M1] — json.load of each manifest yields the version string `0.3.25`
                 at its place (plugin.json's top-level `version`;
                 marketplace.json's `plugins[name=ultrapowers]` entry's
                 `version`), and the BASE document of each file — with only that
                 one version string set to `0.3.25` — deep-equals the new one,
                 so any other key, top-level or nested, that changed fails it.
  leg (b) [M2] — the Versioning bullet, cut from `## Conventions` to the next
                 `- **` bullet and joined, matches
                 `0.3.25.*a release is a fleet plan.*merged by the sandbox.*gh release create v0\\.x\\.y`
                 and contains neither `--auto --squash` nor `gh run list`.
  leg (c) [M3] — `python3 -m pytest -q tests/test_version_sync.py` passes on the
                 tree.

This exam lives at tests/exams/run_102/; the repo root is three levels up.
"""

import copy
import json
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
PLUGIN = ".claude-plugin/plugin.json"
MARKETPLACE = ".claude-plugin/marketplace.json"
CLAUDE_MD = ROOT / "CLAUDE.md"

VERSION = "0.3.25"
PLUGIN_NAME = "ultrapowers"

# The base this exam was written against; $ULTRA_BASE overrides it when the
# driver sets one.
BASE_SHA = "00a431193fe97368e5ba5ae5829ef996889959e7"

BULLET_PATTERN = (
    r"0.3.25.*a release is a fleet plan.*merged by the sandbox"
    r".*gh release create v0\.x\.y"
)
FORBIDDEN_IN_BULLET = ["--auto --squash", "gh run list"]


def _read_new(relpath):
    """The manifest as it stands in the working tree."""
    return json.loads((ROOT / relpath).read_text())


def _read_base(relpath):
    """The manifest as it stood at BASE, or None when BASE is not reachable."""
    import os

    base = os.environ.get("ULTRA_BASE") or BASE_SHA
    try:
        blob = subprocess.check_output(
            ["git", "show", f"{base}:{relpath}"],
            cwd=str(ROOT),
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return json.loads(blob)


def _marketplace_entry(doc):
    entries = [p for p in doc["plugins"] if p["name"] == PLUGIN_NAME]
    assert entries, (
        f"leg (a) [M1]: marketplace.json has no plugins[name={PLUGIN_NAME!r}] entry"
    )
    return entries[0]


def _versioning_bullet_text():
    """The Versioning bullet: from `## Conventions` to the next `- **` bullet, joined."""
    lines = CLAUDE_MD.read_text().splitlines()
    heading = next(
        (i for i, line in enumerate(lines) if line.startswith("## Conventions")), None
    )
    assert heading is not None, (
        "leg (b) [M2]: CLAUDE.md has no `## Conventions` heading to cut the "
        "Versioning bullet from"
    )
    start = next(
        (i for i in range(heading + 1, len(lines)) if lines[i].startswith("- **")), None
    )
    assert start is not None, (
        "leg (b) [M2]: no `- **` bullet follows `## Conventions` in CLAUDE.md"
    )
    assert lines[start].startswith("- **Versioning:**"), (
        "leg (b) [M2]: the first bullet under `## Conventions` is not the "
        f"Versioning bullet: {lines[start]!r}"
    )
    end = next(
        (i for i in range(start + 1, len(lines)) if lines[i].startswith("- **")),
        len(lines),
    )
    return " ".join(line.strip() for line in lines[start:end]).strip()


# --- leg (a) [M1] ----------------------------------------------------------


def test_leg_a_plugin_json_version_is_0_3_25():
    """leg (a) [M1]: plugin.json's top-level `version` is the string `0.3.25`."""
    version = _read_new(PLUGIN)["version"]
    assert version == VERSION, (
        f"leg (a) [M1]: {PLUGIN} top-level `version` is {version!r}, want {VERSION!r}"
    )


def test_leg_a_marketplace_json_version_is_0_3_25():
    """leg (a) [M1]: marketplace.json's ultrapowers entry `version` is `0.3.25`."""
    version = _marketplace_entry(_read_new(MARKETPLACE))["version"]
    assert version == VERSION, (
        f"leg (a) [M1]: {MARKETPLACE} plugins[name={PLUGIN_NAME}].version is "
        f"{version!r}, want {VERSION!r}"
    )


def test_leg_a_plugin_json_changed_nothing_but_the_version():
    """leg (a) [M1]: BASE plugin.json with `version` set to 0.3.25 deep-equals the new one."""
    base = _read_base(PLUGIN)
    if base is None:
        pytest.skip(f"BASE copy of {PLUGIN} unavailable (no git object to read)")
    adjusted = copy.deepcopy(base)
    adjusted["version"] = VERSION
    new = _read_new(PLUGIN)
    assert adjusted == new, (
        f"leg (a) [M1]: {PLUGIN} changed more than its `version` — BASE with "
        f"version={VERSION!r} is {adjusted!r} but the tree has {new!r}"
    )


def test_leg_a_marketplace_json_changed_nothing_but_the_version():
    """leg (a) [M1]: BASE marketplace.json with the ultrapowers version set to
    0.3.25 deep-equals the new one."""
    base = _read_base(MARKETPLACE)
    if base is None:
        pytest.skip(f"BASE copy of {MARKETPLACE} unavailable (no git object to read)")
    adjusted = copy.deepcopy(base)
    for plugin in adjusted["plugins"]:
        if plugin["name"] == PLUGIN_NAME:
            plugin["version"] = VERSION
    new = _read_new(MARKETPLACE)
    assert adjusted == new, (
        f"leg (a) [M1]: {MARKETPLACE} changed more than the {PLUGIN_NAME} "
        f"version — BASE so adjusted is {adjusted!r} but the tree has {new!r}"
    )


# --- leg (b) [M2] ----------------------------------------------------------


def test_leg_b_versioning_bullet_says_a_release_is_a_fleet_plan():
    """leg (b) [M2]: the joined Versioning bullet matches the ordered pattern."""
    bullet = _versioning_bullet_text()
    assert re.search(BULLET_PATTERN, bullet), (
        f"leg (b) [M2]: the Versioning bullet does not match {BULLET_PATTERN!r} "
        f"(0.3.25, then `a release is a fleet plan`, then `merged by the "
        f"sandbox`, then `gh release create v0.x.y`, in that order). Bullet: {bullet!r}"
    )


@pytest.mark.parametrize("phrase", FORBIDDEN_IN_BULLET)
def test_leg_b_versioning_bullet_drops_the_ci_era_phrases(phrase):
    """leg (b) [M2]: the bullet contains neither `--auto --squash` nor `gh run list`."""
    bullet = _versioning_bullet_text()
    assert phrase not in bullet, (
        f"leg (b) [M2]: the Versioning bullet still contains {phrase!r}: {bullet!r}"
    )


# --- leg (c) [M3] ----------------------------------------------------------


def test_leg_c_version_sync_suite_passes():
    """leg (c) [M3]: `python3 -m pytest -q tests/test_version_sync.py` passes."""
    target = ROOT / "tests/test_version_sync.py"
    assert target.exists(), f"leg (c) [M3]: {target} is absent"
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "tests/test_version_sync.py"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "leg (c) [M3]: `python3 -m pytest -q tests/test_version_sync.py` failed "
        f"(exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
    )
