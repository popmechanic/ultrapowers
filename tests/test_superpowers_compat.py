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
            "re-audit SKILL.md Steps 1/5/6, ultraplan's Execution Handoff, and the "
            "re-bake sources in reviewer-prompts.md/wave-merge.md")


def test_writing_plans_template_shape_unchanged():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]",
                  "- Create:", "- Modify:", "- Test:", ":123-145"):
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
    assert "Do not pause to check in with your human partner between tasks" in text, (
        "the exact sentence plan-markers.md quotes was reworded — update the quote")


def test_finishing_branch_still_gates_on_passing_tests():
    text = (installed() / "skills/finishing-a-development-branch/SKILL.md").read_text()
    assert "Cannot proceed with merge/PR until tests pass" in text, (
        "finishing-a-development-branch relaxed its passing-suite precondition — "
        "ultrapowers SKILL.md Step 5 gates the Approve path on this; re-audit it")


def test_sdd_still_requires_consent_for_main_branch_work():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "without explicit user consent" in text, (
        "subagent-driven-development dropped its main/master consent red flag — "
        "ultrapowers SKILL.md Step 6 relies on it for the fallback handoff")


def test_writing_plans_still_offers_two_execution_options():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "Two execution options" in text, (
        "writing-plans changed its Execution Handoff structure — "
        "ultraplan overlays a third option on exactly two; re-audit ultraplan SKILL.md")


def test_verification_skill_still_states_evidence_before_claims():
    text = (installed() / "skills/verification-before-completion/SKILL.md").read_text()
    assert "Evidence before claims" in text, (
        "verification-before-completion reworded its core principle — "
        "wave-merge.md and reviewer-prompts.md cite it as the critic's source")


def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"Tested with superpowers (\d+\.\d+\.\d+)", skill)
    if not m:
        pytest.skip("attestation line not added to SKILL.md yet (orchestrator task)")
    if m.group(1) != installed().name:
        pytest.fail(
            f"installed superpowers {installed().name} != attested {m.group(1)} — "
            "re-run the interop audit, then bump the attestation in SKILL.md")


def test_executing_plans_still_runs_continuously():
    text = (installed() / "skills/executing-plans/SKILL.md").read_text()
    assert "execute all tasks" in text.lower(), (
        "executing-plans changed its continuous-execution posture — "
        "re-audit plan-markers.md Executor variance and ultraplan's Inline option")


def test_writing_plans_header_still_carries_tech_stack():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "**Tech Stack:**" in text, (
        "writing-plans dropped the Tech Stack header line — "
        "ultrapowers SKILL.md Step 2 derives testCmd from it; re-audit the derivation")


def test_code_quality_reviewer_still_delegates_to_code_reviewer_template():
    text = (installed() / "skills/subagent-driven-development/code-quality-reviewer-prompt.md").read_text()
    assert "requesting-code-review/code-reviewer.md" in text, (
        "the code-quality reviewer no longer delegates to the code-reviewer template — "
        "reviewer-prompts.md's sourcing note and the re-bake procedure cite that delegation")


def test_sdd_implementer_status_taxonomy_unchanged():
    text = (installed() / "skills/subagent-driven-development/implementer-prompt.md").read_text()
    assert "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT" in text, (
        "the implementer status taxonomy changed — reviewer-prompts.md's headless-downgrade "
        "notes and workflow.js's IMPLEMENTER_SCHEMA enum are built on these four statuses")


def test_sdd_still_mandates_ordered_two_pass_review():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Start code quality review before spec compliance" in text, (
        "SDD no longer red-flags merging/reordering the two review passes — "
        "reviewer-prompts.md's 'deliberate divergence' note describes a mandate that moved; re-audit it")


def test_sdd_still_routes_through_using_git_worktrees():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "superpowers:using-git-worktrees" in text, (
        "subagent-driven-development no longer routes through using-git-worktrees — "
        "ultrapowers SKILL.md Step 6 hands it a clean checkout expecting it to "
        "self-isolate; re-audit the fallback")


def test_sdd_model_selection_section_still_exists():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Model Selection" in text, (
        "SDD's Model Selection section is gone or renamed — reviewer-prompts.md "
        "names it as the re-bake source for the model-tier scheme")


def test_code_reviewer_template_still_has_dropped_categories():
    text = (installed() / "skills/requesting-code-review/code-reviewer.md").read_text()
    for cat in ("**Architecture:**", "**Production readiness:**"):
        assert cat in text, (
            cat + " is gone from code-reviewer.md — reviewer-prompts.md's "
            "deliberate-drop note names it; re-audit the divergence note")


def test_sdd_blocked_ladder_still_includes_model_escalation():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "re-dispatch with a more capable model" in text, (
        "SDD's BLOCKED ladder changed — reviewer-prompts.md's headless-downgrade "
        "note paraphrases it; re-audit the paraphrase")


def test_writing_plans_menu_still_carries_the_stale_checkpoint_wording():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "batch execution with checkpoints" in text, (
        "writing-plans fixed its stale Inline-option wording — ultraplan SKILL.md "
        "explicitly calls it stale ('its own handoff text still says otherwise'); "
        "update ultraplan's Inline option to stop accusing upstream")


def test_sdd_done_with_concerns_handling_unchanged():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "address them before review" in text, (
        "SDD changed its DONE_WITH_CONCERNS handling — reviewer-prompts.md's "
        "headless-downgrade note paraphrases it; re-audit the paraphrase")


def test_code_reviewer_dropped_subchecks_still_exist():
    text = (installed() / "skills/requesting-code-review/code-reviewer.md").read_text()
    for sub in ("Type safety where applicable?", "Edge cases handled?",
                "Integration tests where they matter?"):
        assert sub in text, (
            sub + " is gone from code-reviewer.md — reviewer-prompts.md's "
            "deliberate-drop ledger names it; re-audit the divergence note")


def test_writing_plans_task_heading_still_adjacent_to_files():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "### Task N: [Component Name]\n\n**Files:**" in text, (
        "writing-plans now puts content between the task heading and the Files "
        "block — dependency-analysis.md's contiguous-header-block rationale and "
        "the compiler's marker placement rule assume adjacency; re-audit both")
