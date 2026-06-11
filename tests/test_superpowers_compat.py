"""Upstream-drift tripwires: assert the superpowers contract lines ultrapowers
depends on, against the INSTALLED plugin cache. Skips when superpowers is not
installed locally (e.g. CI) — drift detection matters on machines that run it."""
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"

pytestmark = pytest.mark.skipif(
    not CACHE.exists(), reason="superpowers plugin not installed locally")

HANDOFF_SKILLS = [
    "brainstorming",
    "writing-plans",
    "subagent-driven-development",
    "executing-plans",
    "finishing-a-development-branch",
]


def installed():
    versions = sorted((p for p in CACHE.iterdir() if p.is_dir()), key=lambda p: p.name)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


def test_every_handoff_skill_still_exists():
    for name in HANDOFF_SKILLS:
        assert (installed() / "skills" / name / "SKILL.md").exists(), (
            f"superpowers:{name} is gone or renamed — ultrapowers hands off to it; "
            "re-audit SKILL.md Steps 1/5/6")


def test_writing_plans_template_shape_unchanged():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")


def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"Tested with superpowers (\d+\.\d+\.\d+)", skill)
    if not m:
        pytest.skip("attestation line not added to SKILL.md yet (orchestrator task)")
    if m.group(1) != installed().name:
        pytest.fail(
            f"installed superpowers {installed().name} != attested {m.group(1)} — "
            "re-run the interop audit, then bump the attestation in SKILL.md")
