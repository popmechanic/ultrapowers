"""Exam for run-114 task 1 — "The plugin is 0.3.26 in both manifests and in its
own instructions".

Proof `Test:` path `tests/test_release_0_3_26.py`; this run lands it at
`tests/exams/run_114/test_release_0_3_26.py`, so ROOT is four parents up.

One test per assertion, each named for the Proof leg and the Machine clause it
encodes:

* leg (a) / M1 — `json.load` of each manifest yields the string `0.3.26` at its
  place, and the BASE document of each file, with only that version string set
  to `0.3.26`, deep-equals the new one (any other key, top-level or nested,
  that changed fails it).
* leg (b) / M2 — the Versioning bullet of `## Conventions & gotchas`, cut from
  its `- **Versioning:**` line to the next `- **` bullet and joined, carries
  `0.3.26 today`, `a release is a fleet plan`, `merged by the sandbox` and
  `gh release create v0.x.y` in that order; carries `0.3.25 today` nowhere; and
  carries neither `--auto --squash` nor `gh run list`.
* leg (c) / M3 — `python3 -m pytest -q tests/test_version_sync.py` passes on
  the tree.

Plus the plan's global constraint: the two manifests carry the same version
string.
"""

import copy
import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

HERE = pathlib.Path(__file__).resolve()
ROOT = HERE.parents[3]
PLUGIN = ROOT / ".claude-plugin" / "plugin.json"
MARKETPLACE = ROOT / ".claude-plugin" / "marketplace.json"
CLAUDE_MD = ROOT / "CLAUDE.md"
VERSION_SYNC = pathlib.Path("tests") / "test_version_sync.py"

TARGET = "0.3.26"
PREVIOUS = "0.3.25"

# The task's BASE. Leg (a) reads the BASE copy of each manifest with
# `git show $ULTRA_BASE:<path>`; these snapshots are the same bytes, kept here
# so the exam still states what BASE held when git cannot answer (shallow or
# detached checkout, exported tree).
BASE_SHA = "52b6355149bfd9742f606e4cfb08b64b0e551f41"

BASE_PLUGIN_JSON = r"""{
  "name": "ultrapowers",
  "version": "0.3.25",
  "description": "The client for ultrapowers: /ultrapowers <plan-path> commits an approved plan and runs on an exe.dev fleet you provision — parallel waves in a disposable sandbox, independent per-task review, the orchestrator opens the PR. No local engine.",
  "author": {
    "name": "Marcus Estes",
    "email": "marcus@vibes.diy"
  },
  "homepage": "https://github.com/popmechanic/ultrapowers",
  "repository": "https://github.com/popmechanic/ultrapowers",
  "license": "MIT",
  "keywords": [
    "skills",
    "fleet",
    "superpowers",
    "parallel",
    "claims-v1"
  ]
}
"""

BASE_MARKETPLACE_JSON = r"""{
  "name": "ultrapowers",
  "owner": {
    "name": "Marcus Estes",
    "email": "marcus@vibes.diy"
  },
  "description": "ultrapowers: authors plans with ultrawrite and executes them autonomously in parallel, on an exe.dev fleet you provision.",
  "plugins": [
    {
      "name": "ultrapowers",
      "source": "./",
      "description": "ultrapowers client — owns plan authoring (ultrawrite) and runs on an exe.dev fleet you provision (parallel waves in a sandbox, per-task review, orchestrator-opened PR); no local engine",
      "version": "0.3.25"
    }
  ]
}
"""


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _new_doc(path):
    """The manifest as it stands on the tree — `json.load` of the file."""
    assert path.is_file(), f"{path} is missing from the tree"
    with path.open() as fh:
        return json.load(fh)


def _base_doc(relpath, snapshot):
    """The manifest as it stood at BASE.

    `git show $ULTRA_BASE:<path>` when the object is reachable — that is the
    reading leg (a) names — otherwise the snapshot pinned above.
    """
    for sha in (os.environ.get("ULTRA_BASE"), BASE_SHA):
        if not sha:
            continue
        try:
            out = subprocess.run(
                ["git", "show", f"{sha}:{relpath}"],
                cwd=str(ROOT),
                capture_output=True,
                check=True,
            ).stdout
        except (OSError, subprocess.CalledProcessError):
            continue
        return json.loads(out.decode("utf-8"))
    return json.loads(snapshot)


def _versioning_bullet():
    """The Versioning bullet of `## Conventions & gotchas`, joined to one line.

    Cut from the `- **Versioning:**` line to the next `- **` bullet, per leg
    (b); lines are stripped and joined with a single space so the bullet's hard
    wrapping is not what the phrase checks are reading.
    """
    assert CLAUDE_MD.is_file(), f"{CLAUDE_MD} is missing from the tree"
    lines = CLAUDE_MD.read_text(encoding="utf-8").splitlines()

    section = None
    for i, line in enumerate(lines):
        if line.startswith("## Conventions & gotchas"):
            section = i
            break
    assert section is not None, (
        "CLAUDE.md has no `## Conventions & gotchas` heading — M2 names the "
        "Versioning bullet inside that section"
    )

    end = len(lines)
    for i in range(section + 1, len(lines)):
        if lines[i].startswith("## "):
            end = i
            break

    start = None
    for i in range(section + 1, end):
        if lines[i].lstrip().startswith("- **Versioning:**"):
            start = i
            break
    assert start is not None, (
        "no `- **Versioning:**` bullet in CLAUDE.md's `## Conventions & "
        "gotchas` section"
    )

    stop = end
    for i in range(start + 1, end):
        if lines[i].lstrip().startswith("- **"):
            stop = i
            break

    joined = " ".join(part.strip() for part in lines[start:stop])
    return re.sub(r"\s+", " ", joined).strip()


# --------------------------------------------------------------------------
# leg (a) / M1 — both manifests read 0.3.26, and nothing else in them moved
# --------------------------------------------------------------------------


def test_leg_a_plugin_json_version_is_0_3_26():
    """leg (a) [M1]: plugin.json's top-level `version` is the string 0.3.26."""
    version = _new_doc(PLUGIN)["version"]
    assert isinstance(version, str), (
        f".claude-plugin/plugin.json `version` must be a string, got "
        f"{type(version).__name__}"
    )
    assert version == TARGET, (
        f".claude-plugin/plugin.json `version` is {version!r}, expected "
        f"{TARGET!r}"
    )


def test_leg_a_marketplace_json_ultrapowers_version_is_0_3_26():
    """leg (a) [M1]: marketplace.json's plugins[name=ultrapowers].version is
    the string 0.3.26."""
    market = _new_doc(MARKETPLACE)
    entries = [p for p in market["plugins"] if p.get("name") == "ultrapowers"]
    assert len(entries) == 1, (
        f"expected exactly one `ultrapowers` entry in marketplace.json's "
        f"plugins, found {len(entries)}"
    )
    version = entries[0]["version"]
    assert isinstance(version, str), (
        f"marketplace.json plugins[ultrapowers].version must be a string, got "
        f"{type(version).__name__}"
    )
    assert version == TARGET, (
        f"marketplace.json plugins[ultrapowers].version is {version!r}, "
        f"expected {TARGET!r}"
    )


def test_leg_a_plugin_json_changed_nothing_but_its_version():
    """leg (a) [M1]: BASE plugin.json with `version` set to 0.3.26 deep-equals
    the new document — any other key that changed fails this."""
    base = _base_doc(".claude-plugin/plugin.json", BASE_PLUGIN_JSON)
    new = _new_doc(PLUGIN)
    adjusted = copy.deepcopy(base)
    adjusted["version"] = TARGET
    assert adjusted == new, (
        ".claude-plugin/plugin.json changed more than its `version`: expected "
        "the BASE document with `version` set to 0.3.26.\n"
        f"expected: {json.dumps(adjusted, sort_keys=True, ensure_ascii=False)}\n"
        f"actual:   {json.dumps(new, sort_keys=True, ensure_ascii=False)}"
    )


def test_leg_a_marketplace_json_changed_nothing_but_its_version():
    """leg (a) [M1]: BASE marketplace.json with the `ultrapowers` entry's
    `version` set to 0.3.26 deep-equals the new document — any other key,
    top-level or nested, that changed fails this."""
    base = _base_doc(".claude-plugin/marketplace.json", BASE_MARKETPLACE_JSON)
    new = _new_doc(MARKETPLACE)
    adjusted = copy.deepcopy(base)
    for entry in adjusted["plugins"]:
        if entry.get("name") == "ultrapowers":
            entry["version"] = TARGET
    assert adjusted == new, (
        ".claude-plugin/marketplace.json changed more than the ultrapowers "
        "entry's `version`: expected the BASE document with that one string "
        "set to 0.3.26.\n"
        f"expected: {json.dumps(adjusted, sort_keys=True, ensure_ascii=False)}\n"
        f"actual:   {json.dumps(new, sort_keys=True, ensure_ascii=False)}"
    )


def test_global_constraint_both_manifests_carry_the_same_version_string():
    """Plan constraint: the two manifests carry the same version string."""
    plugin_version = _new_doc(PLUGIN)["version"]
    market = _new_doc(MARKETPLACE)
    entry = next(p for p in market["plugins"] if p.get("name") == "ultrapowers")
    assert entry["version"] == plugin_version, (
        f"version drift: plugin.json={plugin_version!r} but marketplace.json "
        f"plugins[ultrapowers]={entry['version']!r}"
    )


# --------------------------------------------------------------------------
# leg (b) / M2 — CLAUDE.md's Versioning bullet
# --------------------------------------------------------------------------


def test_leg_b_versioning_bullet_carries_the_four_phrases_in_order():
    """leg (b) [M2]: the joined bullet matches
    `0\\.3\\.26 today.*a release is a fleet plan.*merged by the sandbox.*gh
    release create v0\\.x\\.y`."""
    bullet = _versioning_bullet()
    pattern = re.compile(
        r"0\.3\.26 today"
        r".*a release is a fleet plan"
        r".*merged by the sandbox"
        r".*gh release create v0\.x\.y",
        re.S,
    )
    assert pattern.search(bullet), (
        "CLAUDE.md's Versioning bullet does not carry `0.3.26 today`, "
        "`a release is a fleet plan`, `merged by the sandbox` and "
        "`gh release create v0.x.y` in that order.\n"
        f"bullet: {bullet}"
    )


def test_leg_b_versioning_bullet_says_0_3_26_today_not_0_3_25_today():
    """leg (b) [M2]: the bullet contains `0.3.25 today` nowhere — a bullet left
    at `0.3.25 today` fails."""
    bullet = _versioning_bullet()
    assert f"{PREVIOUS} today" not in bullet, (
        "CLAUDE.md's Versioning bullet still says `0.3.25 today`; the "
        "parenthetical must read `— 0.3.26 today —`.\n"
        f"bullet: {bullet}"
    )
    assert f"{TARGET} today" in bullet, (
        "CLAUDE.md's Versioning bullet does not say `0.3.26 today`.\n"
        f"bullet: {bullet}"
    )


@pytest.mark.parametrize("forbidden", ["--auto --squash", "gh run list"])
def test_leg_b_versioning_bullet_names_no_retired_ci_mechanics(forbidden):
    """leg (b) [M2]: the bullet contains neither `--auto --squash` nor
    `gh run list` — the sandbox merges, there is no CI to poll."""
    bullet = _versioning_bullet()
    assert forbidden not in bullet, (
        f"CLAUDE.md's Versioning bullet mentions {forbidden!r}; the release "
        "is merged by the sandbox and #871 decision 3 left no CI.\n"
        f"bullet: {bullet}"
    )


def test_leg_b_versioning_bullet_keeps_its_0_3_25_example():
    """leg (b) [M2], per the task's Context: only the parenthetical changes —
    the bullet's `0.3.25 (2026-09-10) was the first release shipped this way`
    sentence stays, so a blanket 0.3.25 → 0.3.26 replace fails."""
    bullet = _versioning_bullet()
    assert "0.3.25 (2026-09-10) was the first release shipped this way" in bullet, (
        "CLAUDE.md's Versioning bullet lost its `0.3.25 (2026-09-10) was the "
        "first release shipped this way` sentence; every sentence but the "
        "`— 0.3.25 today —` parenthetical is left as it is.\n"
        f"bullet: {bullet}"
    )


# --------------------------------------------------------------------------
# leg (c) / M3 — the lockstep guard still passes
# --------------------------------------------------------------------------


def test_leg_c_test_version_sync_passes_on_the_tree():
    """leg (c) [M3]: `python3 -m pytest -q tests/test_version_sync.py` passes."""
    assert (ROOT / VERSION_SYNC).is_file(), (
        f"{VERSION_SYNC} is missing from the tree — M3 pins that it passes"
    )
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            VERSION_SYNC.as_posix(),
        ],
        cwd=str(ROOT),
        capture_output=True,
        timeout=300,
    )
    assert proc.returncode == 0, (
        "python3 -m pytest -q tests/test_version_sync.py failed "
        f"(exit {proc.returncode}):\n"
        f"{proc.stdout.decode('utf-8', 'replace')}\n"
        f"{proc.stderr.decode('utf-8', 'replace')}"
    )
