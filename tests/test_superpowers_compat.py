"""Upstream-drift tripwires: assert the superpowers contract lines ultrapowers
depends on, against the VENDORED v6 snapshot. Skips when the snapshot is absent
(run Task 1 first to vendor it under tests/fixtures/superpowers-v6/).

The v6 snapshot is a partial snapshot (only the handoff-surface files changed in
v6, per PROVENANCE). Tests that read skills NOT in the snapshot are conditioned on
file existence — they pass trivially on the partial snapshot and fire as real
tripwires once the GA flip points the seam at a full installed cache."""
import pathlib
import re
import types

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

# ── GA-FLIP SEAM ────────────────────────────────────────────────────────────
# Superpowers v6 is unreleased, so there is no installed cache to attest against.
# We attest against the pinned v6 snapshot vendored under tests/fixtures/ (frozen
# from dev commit 08fc48c; see that dir's PROVENANCE note). When v6 reaches the
# marketplace, flip this ONE function back to the live plugin cache: replace the
# return body below with the two commented lines, and bump ATTESTED_VERSION to the
# published version string. Nothing else in this file changes — every read of the
# Superpowers source goes through superpowers_source().
ATTESTED_VERSION = "6.0.0-dev-08fc48c"


def superpowers_source():
    return ROOT / "tests/fixtures/superpowers-v6"
    # GA flip — when v6 publishes, delete the line above and uncomment these two,
    # then set ATTESTED_VERSION to the published version (e.g. "6.0.0"):
    # cache = pathlib.Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"
    # return installed_version_dir(cache)


# Resolves the newest semver directory under the live plugin cache. Unused while
# the seam points at the vendored snapshot; kept intact so the GA flip is a pure
# one-liner. Exercised by test_version_key_sorts_numerically below.
def installed_version_dir(cache):
    versions = sorted((p for p in cache.iterdir() if p.is_dir()), key=_version_key)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


pytestmark = pytest.mark.skipif(
    not superpowers_source().exists(),
    reason="superpowers v6 snapshot missing (run Task 1 first)")

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


def test_version_key_sorts_numerically():
    fake = lambda name: types.SimpleNamespace(name=name)
    names = ["5.9.0", "5.10.0", "5.1.0"]
    assert sorted(names, key=lambda n: _version_key(fake(n)))[-1] == "5.10.0"


def test_every_handoff_skill_still_exists():
    # Only assert skills that are present in the partial v6 snapshot; the remaining
    # skills fire as real tripwires once the GA flip points at the installed cache.
    for name in HANDOFF_SKILLS:
        skill_path = superpowers_source() / "skills" / name / "SKILL.md"
        if not skill_path.exists():
            continue  # not in the partial snapshot; checked after GA flip
        assert skill_path.exists(), (
            f"superpowers:{name} is gone or renamed — ultrapowers hands off to it; "
            "re-audit SKILL.md Steps 1/5/6, ultraplan's Execution Handoff, and the "
            "re-bake sources in reviewer-prompts.md/wave-merge.md")


def test_writing_plans_template_shape_unchanged():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]",
                  "- Create:", "- Modify:", "- Test:", ":123-145",
                  "## Global Constraints", "**Interfaces:**"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")


def test_writing_plans_header_line_ultraplan_replaces():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    line = ("**For agentic workers:** REQUIRED SUB-SKILL: Use "
            "superpowers:subagent-driven-development (recommended) or "
            "superpowers:executing-plans to implement this plan task-by-task. "
            "Steps use checkbox (`- [ ]`) syntax for tracking.")
    assert line in text, (
        "writing-plans reworded the agentic-workers header — "
        "skills/ultraplan/SKILL.md quotes and REPLACEs this exact line; re-audit it")


def test_rebake_source_prompt_files_still_exist():
    for rel in ("skills/subagent-driven-development/implementer-prompt.md",
                "skills/subagent-driven-development/task-reviewer-prompt.md",
                "skills/requesting-code-review/code-reviewer.md"):
        assert (superpowers_source() / rel).exists(), (
            rel + " is gone — reviewer-prompts.md names it as a re-bake source; "
            "re-audit the re-bake procedure in workflow-template.md")


def test_sdd_still_mandates_continuous_execution():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Continuous execution" in text and "without stopping" in text, (
        "subagent-driven-development changed its continuous-execution posture — "
        "re-audit plan-markers.md Executor variance and ultrapowers SKILL.md Step 6")
    assert "Do not pause to check in with your human partner between tasks" in text, (
        "the exact sentence plan-markers.md quotes was reworded — update the quote")


def test_finishing_branch_still_gates_on_passing_tests():
    p = superpowers_source() / "skills/finishing-a-development-branch/SKILL.md"
    if not p.exists():
        pytest.skip("finishing-a-development-branch not in the partial v6 snapshot; "
                    "tripwire activates when the GA flip points at the installed cache")
    text = p.read_text()
    assert "Cannot proceed with merge/PR until tests pass" in text, (
        "finishing-a-development-branch relaxed its passing-suite precondition — "
        "ultrapowers SKILL.md Step 5 gates the Approve path on this; re-audit it")


def test_sdd_still_requires_consent_for_main_branch_work():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "without explicit user consent" in text, (
        "subagent-driven-development dropped its main/master consent red flag — "
        "ultrapowers SKILL.md Step 6 relies on it for the fallback handoff")


def test_writing_plans_still_offers_two_execution_options():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    assert "Two execution options" in text, (
        "writing-plans changed its Execution Handoff structure — "
        "ultraplan overlays a third option on exactly two; re-audit ultraplan SKILL.md")


def test_verification_skill_still_states_evidence_before_claims():
    p = superpowers_source() / "skills/verification-before-completion/SKILL.md"
    if not p.exists():
        pytest.skip("verification-before-completion not in the partial v6 snapshot; "
                    "tripwire activates when the GA flip points at the installed cache")
    text = p.read_text()
    assert "Evidence before claims" in text, (
        "verification-before-completion reworded its core principle — "
        "wave-merge.md and reviewer-prompts.md cite it as the critic's source")


def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"vendored Superpowers v6 snapshot \(dev (\w+)\)", skill)
    if not m:
        pytest.skip("v6 attestation line not added to SKILL.md yet (Task 8)")
    if not ATTESTED_VERSION.endswith(m.group(1)):
        pytest.fail(
            f"SKILL.md attests snapshot dev {m.group(1)} but the seam's "
            f"ATTESTED_VERSION is {ATTESTED_VERSION!r} — reconcile the GA-FLIP "
            "SEAM commit with the SKILL.md/README wording")


def test_executing_plans_still_runs_continuously():
    p = superpowers_source() / "skills/executing-plans/SKILL.md"
    if not p.exists():
        pytest.skip("executing-plans not in the partial v6 snapshot; "
                    "tripwire activates when the GA flip points at the installed cache")
    text = p.read_text()
    assert "execute all tasks" in text.lower(), (
        "executing-plans changed its continuous-execution posture — "
        "re-audit plan-markers.md Executor variance and ultraplan's Inline option")


def test_writing_plans_header_still_carries_tech_stack():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    assert "**Tech Stack:**" in text, (
        "writing-plans dropped the Tech Stack header line — "
        "ultrapowers SKILL.md Step 2 derives testCmd from it; re-audit the derivation")


def test_sdd_implementer_status_taxonomy_unchanged():
    text = (superpowers_source() / "skills/subagent-driven-development/implementer-prompt.md").read_text()
    assert "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT" in text, (
        "the implementer status taxonomy changed — reviewer-prompts.md's headless-downgrade "
        "notes and workflow.js's IMPLEMENTER_SCHEMA enum are built on these four statuses")


def test_sdd_still_mandates_both_review_verdicts():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "spec compliance" in text, (
        "SDD dropped its spec compliance verdict requirement — "
        "reviewer-prompts.md's unified task-reviewer design is built on this; re-audit it")
    assert "code quality" in text or "task quality" in text, (
        "SDD dropped its quality verdict requirement — "
        "reviewer-prompts.md's unified task-reviewer design is built on this; re-audit it")


def test_sdd_still_routes_through_using_git_worktrees():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "superpowers:using-git-worktrees" in text, (
        "subagent-driven-development no longer routes through using-git-worktrees — "
        "ultrapowers SKILL.md Step 6 hands it a clean checkout expecting it to "
        "self-isolate; re-audit the fallback")


def test_sdd_model_selection_section_still_exists():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Model Selection" in text, (
        "SDD's Model Selection section is gone or renamed — reviewer-prompts.md "
        "names it as the re-bake source for the model-tier scheme")


def test_code_reviewer_template_still_has_dropped_categories():
    text = (superpowers_source() / "skills/requesting-code-review/code-reviewer.md").read_text()
    for cat in ("**Architecture:**", "**Production readiness:**"):
        assert cat in text, (
            cat + " is gone from code-reviewer.md — reviewer-prompts.md's "
            "deliberate-drop note names it; re-audit the divergence note")


def test_sdd_blocked_ladder_still_includes_model_escalation():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "re-dispatch with a more capable model" in text, (
        "SDD's BLOCKED ladder changed — reviewer-prompts.md's headless-downgrade "
        "note paraphrases it; re-audit the paraphrase")


def test_writing_plans_menu_still_carries_the_stale_checkpoint_wording():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    assert "batch execution with checkpoints" in text, (
        "writing-plans fixed its stale Inline-option wording — ultraplan SKILL.md "
        "explicitly calls it stale ('its own handoff text still says otherwise'); "
        "update ultraplan's Inline option to stop accusing upstream")


def test_sdd_done_with_concerns_handling_unchanged():
    text = (superpowers_source() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "address them before review" in text, (
        "SDD changed its DONE_WITH_CONCERNS handling — reviewer-prompts.md's "
        "headless-downgrade note paraphrases it; re-audit the paraphrase")


def test_code_reviewer_dropped_subchecks_still_exist():
    text = (superpowers_source() / "skills/requesting-code-review/code-reviewer.md").read_text()
    for sub in ("Type safety where applicable?", "Edge cases handled?",
                "Integration tests where they matter?"):
        assert sub in text, (
            sub + " is gone from code-reviewer.md — reviewer-prompts.md's "
            "deliberate-drop ledger names it; re-audit the divergence note")


def test_writing_plans_task_heading_still_adjacent_to_files():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    assert "### Task N: [Component Name]\n\n**Files:**" in text, (
        "writing-plans now puts content between the task heading and the Files "
        "block — dependency-analysis.md's contiguous-header-block rationale and "
        "the compiler's marker placement rule assume adjacency; re-audit both")


def test_writing_plans_self_review_section_still_exists():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    assert "## Self-Review" in text, (
        "writing-plans dropped its Self-Review checklist — ultraplan's "
        "'Self-review additions' section extends it; re-audit ultraplan SKILL.md")
