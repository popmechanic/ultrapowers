"""Run-130 task 1's exam: the plugin is 0.3.28 in both manifests and in CLAUDE.md.

Each assertion names the Proof leg and the Machine clause it comes from, so the
exam reads back against the task's own words:

  M1 / leg (a) — `.claude-plugin/plugin.json`'s `version` is the string `0.3.28`,
  and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is
  the string `0.3.28`; no other key in either file changes. The "no other key"
  half is read the way the first `Run:` line reads it: load each manifest as it
  stood at the run's base, apply only the version bump to that baseline, and
  require deep equality with the file on disk.

  M2 / leg (b) — CLAUDE.md's Versioning bullet in `## Conventions & gotchas`,
  read as the text from `**Versioning:**` through the next `- **` line, contains
  `0.3.28` followed by `today`, the phrases `a release is a fleet plan`,
  `merged by the` and `gh release create`, and contains `0.3.27` followed by
  `today` nowhere.
"""

import copy
import json
import os
import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
PLUGIN = REPO / ".claude-plugin" / "plugin.json"
MARKETPLACE = REPO / ".claude-plugin" / "marketplace.json"
CLAUDE_MD = REPO / "CLAUDE.md"

VERSION = "0.3.28"
PREVIOUS = "0.3.27"

# The run's base sha, as the driver's `Run:` lines get it. The literal is the
# fallback for a shell that did not export it; HEAD is the last resort.
BASE_SHA = "690d22315650be28f65b42040d58a5008f22de9f"


def _baseline(relpath):
    """The manifest at `relpath` as it stood at the run's base, parsed."""
    refs = [r for r in (os.environ.get("ULTRA_BASE"), BASE_SHA, "HEAD") if r]
    errors = []
    for ref in refs:
        try:
            blob = subprocess.check_output(
                ["git", "show", "{0}:{1}".format(ref, relpath)],
                cwd=str(REPO),
                stderr=subprocess.PIPE,
            )
        except (subprocess.CalledProcessError, OSError) as exc:
            errors.append("{0}: {1}".format(ref, exc))
            continue
        return json.loads(blob.decode("utf-8"))
    raise AssertionError(
        "could not read {0} at the run's base: {1}".format(relpath, "; ".join(errors))
    )


def _versioning_bullet():
    """CLAUDE.md's Versioning bullet, read as the `Run:` lines read it.

    sed's `/\\*\\*Versioning:\\*\\*/,/^- \\*\\*/p` range: from the line holding
    `**Versioning:**` through the next line that begins `- **`, inclusive;
    `tr '\\n' ' '` then joins it into one line.
    """
    lines = CLAUDE_MD.read_text(encoding="utf-8").split("\n")
    start = next(
        (i for i, line in enumerate(lines) if "**Versioning:**" in line), None
    )
    assert start is not None, "CLAUDE.md has no `**Versioning:**` bullet [M2, leg (b)]"
    end = next(
        (i for i in range(start + 1, len(lines)) if lines[i].startswith("- **")),
        len(lines) - 1,
    )
    return " ".join(lines[start:end + 1])


# --- M1, leg (a): the two manifests ---------------------------------------


def test_plugin_json_version_is_0_3_28():
    """[M1, leg (a)] `plugin.json`'s `version` is the string `0.3.28`."""
    data = json.loads(PLUGIN.read_text(encoding="utf-8"))
    assert data["version"] == VERSION
    assert isinstance(data["version"], str)


def test_marketplace_json_ultrapowers_version_is_0_3_28():
    """[M1, leg (a)] marketplace `plugins[name=ultrapowers].version` is `0.3.28`."""
    data = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
    entries = [p for p in data["plugins"] if p.get("name") == "ultrapowers"]
    assert len(entries) == 1, "expected exactly one ultrapowers plugin entry"
    assert entries[0]["version"] == VERSION
    assert isinstance(entries[0]["version"], str)


def test_plugin_json_changes_nothing_but_the_version():
    """[M1, leg (a)] no key of `plugin.json` but `version` differs from the base."""
    expected = dict(_baseline(".claude-plugin/plugin.json"))
    expected["version"] = VERSION
    actual = json.loads(PLUGIN.read_text(encoding="utf-8"))
    assert actual == expected, "plugin.json changed more than version"


def test_marketplace_json_changes_nothing_but_the_version():
    """[M1, leg (a)] no key of `marketplace.json` but that version differs."""
    expected = copy.deepcopy(_baseline(".claude-plugin/marketplace.json"))
    for entry in expected["plugins"]:
        if entry.get("name") == "ultrapowers":
            entry["version"] = VERSION
    actual = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
    assert actual == expected, "marketplace.json changed more than the ultrapowers version"


def test_both_manifests_carry_the_same_version_string():
    """[M1, leg (a); Global Constraint] the two manifests agree, at `0.3.28`."""
    plugin = json.loads(PLUGIN.read_text(encoding="utf-8"))["version"]
    entries = [
        p
        for p in json.loads(MARKETPLACE.read_text(encoding="utf-8"))["plugins"]
        if p.get("name") == "ultrapowers"
    ]
    assert plugin == entries[0]["version"] == VERSION


# --- M2, leg (b): the Versioning bullet ------------------------------------


def test_versioning_bullet_lives_in_conventions_and_gotchas():
    """[M2, leg (b)] the bullet M2 speaks of sits in `## Conventions & gotchas`."""
    text = CLAUDE_MD.read_text(encoding="utf-8")
    heading = text.index("\n## Conventions & gotchas")
    following = text.find("\n## ", heading + 1)
    section = text[heading:] if following == -1 else text[heading:following]
    assert "**Versioning:**" in section


def test_versioning_bullet_reads_0_3_28_today():
    """[M2, leg (b)] the bullet has `0.3.28` and then `today`."""
    bullet = _versioning_bullet()
    assert VERSION in bullet
    assert "today" in bullet
    assert re.search(r"0\.3\.28.*today", bullet), bullet


def test_versioning_bullet_keeps_the_three_phrases():
    """[M2, leg (b)] the bullet still says what a release is and who merges it."""
    bullet = _versioning_bullet()
    for phrase in ("a release is a fleet plan", "merged by the", "gh release create"):
        assert phrase in bullet, "missing phrase {0!r}".format(phrase)


def test_versioning_bullet_orders_version_then_the_phrases():
    """[M2, leg (b)] the whole ordered reading of the bullet, as the grep leg has it."""
    bullet = _versioning_bullet()
    pattern = (
        r"0\.3\.28.*today.*a release is a fleet plan"
        r".*merged by the.*gh release create"
    )
    assert re.search(pattern, bullet), bullet


def test_versioning_bullet_has_no_0_3_27_before_today():
    """[M2, leg (b)] `0.3.27` followed by `today` appears nowhere in the bullet."""
    bullet = _versioning_bullet()
    stale = re.findall(r"0\.3\.27[^0-9]*today", bullet)
    assert stale == [], stale


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))
