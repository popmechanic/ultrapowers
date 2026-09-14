"""Exam for task 1 — "The plugin is 0.3.27 in both manifests and in its own instructions".

Written against the task's Machine clauses and Proof legs; each test names the leg
and the clause it comes from.

  M1 / leg (a) — `.claude-plugin/plugin.json`'s top-level `version` and
      `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` are
      both the string `0.3.27`, and NOTHING else in either file changed: the BASE
      copy of each document, read with `git show $ULTRA_BASE:<path>` and with only
      that one version string set to `0.3.27`, must deep-equal the tree's copy.
  M2 / leg (b) — CLAUDE.md's Versioning bullet in `## Conventions & gotchas`, cut
      from its `- **Versioning:**` line to the next `- **` bullet and joined,
      matches `0\\.3\\.27 today.*a release is a fleet plan.*merged by the
      sandbox.*gh release create v0\\.x\\.y`, contains `0.3.26 today` nowhere, and
      contains neither `--auto --squash` nor `gh run list`.
  M3 / leg (c) — `python3 -m pytest -q tests/test_version_sync.py` passes on the tree.

Global constraint — the two manifests carry the same version string.

This file lives at tests/exams/run_123/ (the run's exam path for the Proof's
`tests/test_release_0_3_27.py`), so the repo root is three parents up.
"""
import copy
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
PLUGIN = ROOT / ".claude-plugin" / "plugin.json"
MARKETPLACE = ROOT / ".claude-plugin" / "marketplace.json"
CLAUDE_MD = ROOT / "CLAUDE.md"
VERSION_SYNC = ROOT / "tests" / "test_version_sync.py"

VERSION = "0.3.27"
PREVIOUS = "0.3.26"
ENTRY = "ultrapowers"

# The sha this exam was written at; $ULTRA_BASE names it at run time.
BASE_SHA = "47c936d0216fcae1293711b66e0299bc995a81e6"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _base_ref():
    """The BASE commit, from $ULTRA_BASE when the driver sets it, else the sha
    this exam was written at. Whichever resolves in this repo is used."""
    candidates = [c for c in (os.environ.get("ULTRA_BASE"), BASE_SHA) if c]
    tried = []
    for ref in candidates:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--verify", f"{ref}^{{commit}}"],
            capture_output=True, text=True,
        )
        if proc.returncode == 0:
            return ref
        tried.append(f"{ref}: {proc.stderr.strip()}")
    raise AssertionError(
        "leg (a) needs the BASE tree: no BASE commit resolved in this repo "
        f"(tried {tried})"
    )


def _base_json(path):
    """`json.load` of `git show $ULTRA_BASE:<path>` — the file as it was at BASE."""
    ref = _base_ref()
    proc = subprocess.run(
        ["git", "-C", str(ROOT), "show", f"{ref}:{path}"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"leg (a): `git show {ref}:{path}` failed: {proc.stderr.strip()}"
    )
    return json.loads(proc.stdout)


def _tree_json(path):
    return json.loads((ROOT / path).read_text())


def _versioning_bullet():
    """CLAUDE.md's Versioning bullet, cut from its `- **Versioning:**` line to the
    next `- **` bullet and joined into one line (leg (b))."""
    text = CLAUDE_MD.read_text()
    lines = text.splitlines()
    starts = [i for i, ln in enumerate(lines) if ln.startswith("- **Versioning:**")]
    assert len(starts) == 1, (
        "leg (b) [M2]: CLAUDE.md must have exactly one `- **Versioning:**` bullet, "
        f"found {len(starts)}"
    )
    start = starts[0]
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("- **"):
            end = i
            break
    return " ".join(ln.strip() for ln in lines[start:end]).strip()


def _diff_keys(expected, actual, prefix=""):
    """Every path where two JSON documents differ, as dotted/indexed keys."""
    out = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(set(expected) | set(actual)):
            here = f"{prefix}.{key}" if prefix else key
            if key not in expected:
                out.append(f"{here} (added: {actual[key]!r})")
            elif key not in actual:
                out.append(f"{here} (removed: {expected[key]!r})")
            else:
                out.extend(_diff_keys(expected[key], actual[key], here))
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            out.append(f"{prefix} (length {len(expected)} -> {len(actual)})")
        else:
            for i, (e, a) in enumerate(zip(expected, actual)):
                out.extend(_diff_keys(e, a, f"{prefix}[{i}]"))
    elif expected != actual:
        out.append(f"{prefix} ({expected!r} -> {actual!r})")
    return out


# --------------------------------------------------------------------------- #
# leg (a) [M1] — both manifests read 0.3.27 and nothing else in them changed
# --------------------------------------------------------------------------- #
def test_leg_a_plugin_json_version_is_0_3_27():
    """leg (a) [M1]: `json.load` of .claude-plugin/plugin.json yields the version
    string `0.3.27` at its top-level `version`."""
    doc = _tree_json(".claude-plugin/plugin.json")
    assert doc["version"] == VERSION, (
        f"plugin.json version is {doc['version']!r}, expected the string {VERSION!r}"
    )


def test_leg_a_marketplace_json_ultrapowers_version_is_0_3_27():
    """leg (a) [M1]: `json.load` of .claude-plugin/marketplace.json yields the
    version string `0.3.27` at `plugins[name=ultrapowers].version`."""
    doc = _tree_json(".claude-plugin/marketplace.json")
    entries = [p for p in doc["plugins"] if p["name"] == ENTRY]
    assert len(entries) == 1, (
        f"marketplace.json must carry exactly one {ENTRY!r} plugins entry, "
        f"found {len(entries)}"
    )
    assert entries[0]["version"] == VERSION, (
        f"marketplace.json plugins[{ENTRY}].version is {entries[0]['version']!r}, "
        f"expected the string {VERSION!r}"
    )


def test_leg_a_plugin_json_changed_only_its_version():
    """leg (a) [M1]: the BASE plugin.json with its top-level `version` set to
    `0.3.27` deep-equals the tree's plugin.json — any other key, top-level or
    nested, that changed fails this."""
    expected = copy.deepcopy(_base_json(".claude-plugin/plugin.json"))
    expected["version"] = VERSION
    actual = _tree_json(".claude-plugin/plugin.json")
    assert expected == actual, (
        "plugin.json changed more than its version — differing keys: "
        f"{_diff_keys(expected, actual)}"
    )


def test_leg_a_marketplace_json_changed_only_the_ultrapowers_version():
    """leg (a) [M1]: the BASE marketplace.json with the `ultrapowers` entry's
    `version` set to `0.3.27` deep-equals the tree's marketplace.json — any other
    key, top-level or nested, that changed fails this."""
    expected = copy.deepcopy(_base_json(".claude-plugin/marketplace.json"))
    for plugin in expected["plugins"]:
        if plugin["name"] == ENTRY:
            plugin["version"] = VERSION
    actual = _tree_json(".claude-plugin/marketplace.json")
    assert expected == actual, (
        "marketplace.json changed more than the ultrapowers version — differing "
        f"keys: {_diff_keys(expected, actual)}"
    )


def test_global_constraint_both_manifests_carry_the_same_version_string():
    """Global constraint: the two manifests carry the same version string."""
    plugin_version = _tree_json(".claude-plugin/plugin.json")["version"]
    entry = next(
        p for p in _tree_json(".claude-plugin/marketplace.json")["plugins"]
        if p["name"] == ENTRY
    )
    assert plugin_version == entry["version"] == VERSION, (
        f"version drift: plugin.json={plugin_version!r}, marketplace.json "
        f"plugins[{ENTRY}]={entry['version']!r}; both must be {VERSION!r}"
    )


# --------------------------------------------------------------------------- #
# leg (b) [M2] — the Versioning bullet reads 0.3.27 and keeps its release story
# --------------------------------------------------------------------------- #
def test_leg_b_versioning_bullet_matches_the_ordered_phrases():
    """leg (b) [M2]: the joined Versioning bullet matches
    `0\\.3\\.27 today.*a release is a fleet plan.*merged by the sandbox.*gh release
    create v0\\.x\\.y` — the four phrases, in that order."""
    bullet = _versioning_bullet()
    pattern = (
        r"0\.3\.27 today"
        r".*a release is a fleet plan"
        r".*merged by the sandbox"
        r".*gh release create v0\.x\.y"
    )
    assert re.search(pattern, bullet, re.DOTALL), (
        "CLAUDE.md's Versioning bullet does not match "
        f"{pattern!r} — bullet reads: {bullet!r}"
    )


def test_leg_b_versioning_bullet_no_longer_says_0_3_26_today():
    """leg (b) [M2]: the bullet contains `0.3.26 today` nowhere — a bullet left at
    `0.3.26 today` fails."""
    bullet = _versioning_bullet()
    assert f"{PREVIOUS} today" not in bullet, (
        f"CLAUDE.md's Versioning bullet still says {PREVIOUS + ' today'!r} — "
        f"bullet reads: {bullet!r}"
    )


@pytest.mark.parametrize("retired", ["--auto --squash", "gh run list"])
def test_leg_b_versioning_bullet_omits_the_retired_phrases(retired):
    """leg (b) [M2]: the bullet contains neither `--auto --squash` nor `gh run list`."""
    bullet = _versioning_bullet()
    assert retired not in bullet, (
        f"CLAUDE.md's Versioning bullet must not contain {retired!r} — "
        f"bullet reads: {bullet!r}"
    )


# --------------------------------------------------------------------------- #
# leg (c) [M3] — the lockstep guard still passes on the tree
# --------------------------------------------------------------------------- #
def test_leg_c_version_sync_suite_passes():
    """leg (c) [M3]: `python3 -m pytest -q tests/test_version_sync.py` passes."""
    assert VERSION_SYNC.is_file(), f"{VERSION_SYNC} is missing"
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_version_sync.py"],
        cwd=str(ROOT), capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        "`python3 -m pytest -q tests/test_version_sync.py` failed "
        f"(exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
    )
