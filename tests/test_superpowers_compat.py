"""Upstream-drift tripwires: assert the superpowers contract lines ultrapowers
depends on, against the INSTALLED plugin cache. Skips when superpowers is not
installed locally (e.g. CI) — drift detection matters on machines that run it."""
import pathlib
import re
import types

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
    "using-git-worktrees",
    "verification-before-completion",
    "test-driven-development",
    "requesting-code-review",
]


def _version_key(p):
    parts = p.name.split(".")
    if all(x.isdigit() for x in parts):
        return (1, tuple(int(x) for x in parts), p.name)
    return (0, (), p.name)


def installed():
    versions = sorted((p for p in CACHE.iterdir() if p.is_dir()), key=_version_key)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


def test_version_key_sorts_numerically():
    fake = lambda name: types.SimpleNamespace(name=name)
    names = ["5.9.0", "5.10.0", "5.1.0"]
    assert sorted(names, key=lambda n: _version_key(fake(n)))[-1] == "5.10.0"


def test_every_handoff_skill_still_exists():
    for name in HANDOFF_SKILLS:
        assert (installed() / "skills" / name / "SKILL.md").exists(), (
            f"superpowers:{name} is gone or renamed — ultrapowers hands off to it; "
            "re-audit SKILL.md Steps 1/5/6")


def test_writing_plans_template_shape_unchanged():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]",
                  "- Create:", "- Modify:", "- Test:"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")


def test_writing_plans_header_line_ultraplan_replaces():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    line = ("**For agentic workers:** REQUIRED SUB-SKILL: Use "
            "superpowers:subagent-driven-development (recommended) or "
            "superpowers:executing-plans to implement this plan task-by-task. "
            "Steps use checkbox (`- [ ]`) syntax for tracking.")
    assert line in text, (
        "writing-plans reworded the agentic-workers header — "
        "skills/ultraplan/SKILL.md quotes and REPLACEs this exact line; re-audit it")


def test_rebake_source_prompt_files_still_exist():
    for rel in ("skills/subagent-driven-development/implementer-prompt.md",
                "skills/subagent-driven-development/spec-reviewer-prompt.md",
                "skills/subagent-driven-development/code-quality-reviewer-prompt.md",
                "skills/requesting-code-review/code-reviewer.md"):
        assert (installed() / rel).exists(), (
            rel + " is gone — reviewer-prompts.md names it as a re-bake source; "
            "re-audit the re-bake procedure in workflow-template.md")


def test_sdd_still_mandates_continuous_execution():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Continuous execution" in text and "without stopping" in text, (
        "subagent-driven-development changed its continuous-execution posture — "
        "re-audit plan-markers.md Executor variance and ultrapowers SKILL.md Step 6")


def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"Tested with superpowers (\d+\.\d+\.\d+)", skill)
    if not m:
        pytest.skip("attestation line not added to SKILL.md yet (orchestrator task)")
    if m.group(1) != installed().name:
        pytest.fail(
            f"installed superpowers {installed().name} != attested {m.group(1)} — "
            "re-run the interop audit, then bump the attestation in SKILL.md")
