"""Single source of truth for the superpowers contract tokens ultrapowers depends
on. Imported by both the runtime preflight (check_superpowers_compat.py) and the
pytest tripwire (test_superpowers_compat.py), so there is exactly one token list.

Each MANIFEST entry names a file (relative to a superpowers install root), the
literal token that must be present in it (or `any_of` alternatives, or
`exists_only` for a file whose mere presence is the contract), and WHY ultrapowers
depends on it. To re-verify against a newer superpowers release, run the live
tripwire (tests/test_superpowers_compat.py) against it, then bump TESTED_AGAINST."""
from dataclasses import dataclass, field
import pathlib

TESTED_AGAINST = "6.1.1"  # latest released superpowers whose contract we verified

MANIFEST = [
    # writing-plans template shape — compile_plan.py + Step-1 shape check parse these
    {"rel": "skills/writing-plans/SKILL.md", "token": "Implementation Plan",
     "why": "Step-1 heading convenience match"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "### Task N:",
     "why": "compile_plan.py + Step-1 shape check parse the task heading"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "### Task N: [Component Name]",
     "why": "dependency-analysis.md's contiguous-header-block rule assumes heading↔Files adjacency"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Files:**",
     "why": "the Files block is the writes/reads source for the DAG"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- [ ]",
     "why": "checkbox step syntax the compiler/executors track"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Create:",
     "why": "writes-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Modify:",
     "why": "writes-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Test:",
     "why": "reads-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": ":123-145",
     "why": "line-range file-reference form the parser tolerates"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "## Global Constraints",
     "why": "forwarded to every reviewer as the attention lens"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Interfaces:**",
     "why": "Consumes/Produces drive undeclared-dependency detection"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Tech Stack:**",
     "why": "Step 2 derives testCmd from it"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "Two execution options",
     "why": "ultraplan overlays a third option on exactly two"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "batch execution with checkpoints",
     "why": "ultraplan's Inline option calls this wording stale on purpose"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "## Self-Review",
     "why": "ultraplan's self-review additions extend this section"},
    # subagent-driven-development — Step 6 fallback + re-bake sources
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "Continuous execution",
     "why": "plan-markers Executor variance + Step 6 rely on the no-pause posture"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "without stopping",
     "why": "continuous-execution posture"},
    {"rel": "skills/subagent-driven-development/SKILL.md",
     "token": "Do not pause to check in with your human partner between tasks",
     "why": "exact sentence plan-markers.md quotes"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "without explicit user consent",
     "why": "Step 6 fallback relies on the main/master consent red flag"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "spec compliance",
     "why": "unified task-reviewer design is built on this verdict"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "any_of": ["code quality", "task quality"],
     "why": "unified task-reviewer quality verdict"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "superpowers:using-git-worktrees",
     "why": "Step 6 hands a clean checkout expecting self-isolation"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "Model Selection",
     "why": "reviewer-prompts.md re-bakes the model-tier scheme from here"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "re-dispatch with a more capable model",
     "why": "reviewer-prompts.md headless-downgrade note paraphrases the BLOCKED ladder"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "address them before review",
     "why": "reviewer-prompts.md paraphrases DONE_WITH_CONCERNS handling"},
    {"rel": "skills/subagent-driven-development/implementer-prompt.md",
     "token": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
     "why": "IMPLEMENTER_SCHEMA enum + headless-downgrade notes built on these four"},
    {"rel": "skills/subagent-driven-development/task-reviewer-prompt.md", "exists_only": True,
     "why": "reviewer-prompts.md names it as a re-bake source"},
    # requesting-code-review template
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "**Architecture:**",
     "why": "reviewer-prompts.md deliberate-drop note names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "**Production readiness:**",
     "why": "reviewer-prompts.md deliberate-drop note names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Type safety where applicable?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Edge cases handled?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Integration tests where they matter?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    # other handoff skills ultrapowers gates on
    {"rel": "skills/finishing-a-development-branch/SKILL.md",
     "token": "Cannot proceed with merge/PR until tests pass",
     "why": "Step 5 gates the Approve path on this precondition"},
    {"rel": "skills/verification-before-completion/SKILL.md", "token": "Evidence before claims",
     "why": "wave-merge.md + reviewer-prompts.md cite it as the critic's source"},
    {"rel": "skills/executing-plans/SKILL.md", "token": "execute all tasks",
     "why": "plan-markers Executor variance + ultraplan's Inline option assume continuous execution"},
]


@dataclass
class Report:
    ok: bool
    missing: list = field(default_factory=list)
    checked: int = 0


def check(superpowers_root):
    """Return a Report of which MANIFEST tokens are absent from the given
    superpowers install root. An absent file counts every one of its entries as
    missing (no partial-tree skip).

    Matching is plain substring containment (`token in file_text`): the contract
    only asks whether the literal token appears ANYWHERE in the target file, which
    is how the consuming parsers actually find it. Real upstream SKILL.md files
    carry these tokens mid-line (e.g. "### Task N:" lives inside the heading
    "### Task N: [Component Name]", "- Test:" inside "- Test: `path`"), so a
    line-anchored match that required each token to TERMINATE a line would falsely
    report most of them missing against a perfectly healthy install.

    Note the deliberate consequence: a token that is a substring of another token
    in the same file (e.g. "### Task N:" within "### Task N: [Component Name]") is
    satisfied whenever the longer one is present — correct here, because in real
    upstream files the two are the same occurrence."""
    root = pathlib.Path(superpowers_root)
    missing = []
    for entry in MANIFEST:
        path = root / entry["rel"]
        if not path.exists():
            missing.append(entry)
            continue
        if entry.get("exists_only"):
            continue
        text = path.read_text()
        tokens = entry.get("any_of", [entry.get("token")])
        if not any(tok in text for tok in tokens):
            missing.append(entry)
    return Report(ok=not missing, missing=missing, checked=len(MANIFEST))
