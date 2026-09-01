"""Pin: the #390 cutover wording in the three operator-facing docs.

After the cutover the plugin OWNS plan authoring (`ultrawrite`); superpowers is
an optional companion, not a requirement, and no doc may quietly reinstate it as
the authoring authority. Also pinned: the weaker sequential-executor property —
a claims-v1 plan has no steps to follow — stated in the same words the skill uses.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLAUDE_MD = (ROOT / "CLAUDE.md").read_text()
README = (ROOT / "README.md").read_text()
MARKETPLACE_TEXT = (ROOT / ".claude-plugin/marketplace.json").read_text()
MARKETPLACE = json.loads(MARKETPLACE_TEXT)
SKILL = (ROOT / "skills/ultrawrite/SKILL.md").read_text()


def flat(text):
    """Prose in these docs is hard-wrapped; compare on one line."""
    return " ".join(text.split())


FLAT_CLAUDE_MD = flat(CLAUDE_MD)
FLAT_README = flat(README)

SEQUENTIAL_PROPERTY = (
    "A claims-v1 plan has no steps to follow, but a sequential executor can "
    "implement task-by-task from contract plus proof."
)


# --- CLAUDE.md (Step 1) ---------------------------------------------------

def test_claude_md_drops_the_extends_sentence_and_its_lifted_annotation():
    assert "extends (does not fork)" not in FLAT_CLAUDE_MD
    assert "LIFTED by the operator" not in FLAT_CLAUDE_MD


def test_claude_md_states_the_owned_authoring_posture():
    assert (
        "The plugin owns plan authoring via `ultrawrite` since #390; superpowers "
        "is an optional companion, not a dependency." in FLAT_CLAUDE_MD
    )


def test_claude_md_has_no_ultraplan_references_left():
    assert "ultraplan" not in FLAT_CLAUDE_MD


def test_claude_md_layout_names_the_owned_authoring_skill():
    assert "- `skills/ultrawrite/`" in CLAUDE_MD


def test_claude_md_drops_the_stale_plan_markers_mirror_claim():
    assert "mirrors `references/plan-markers.md`" not in FLAT_CLAUDE_MD


def test_claude_md_rubric_lockstep_line_names_ultrawrite():
    assert (
        "the execution-handoff rubric is still shared between "
        "`hooks/session_start.sh` and `ultrawrite/SKILL.md` (pinned by "
        "`tests/test_recommendation_rubric.py`)" in FLAT_CLAUDE_MD
    )


def test_claude_md_feature_pipeline_line_names_only_ultrawrite():
    assert (
        "Brainstorm → spec in `docs/superpowers/specs/` → `ultrapowers:ultrawrite` "
        "→ plan in `docs/superpowers/plans/`" in FLAT_CLAUDE_MD
    )
    assert "superpowers:writing-plans" not in FLAT_CLAUDE_MD


# --- README (Step 2) ------------------------------------------------------

def test_readme_does_not_require_superpowers():
    assert "Superpowers is required" not in FLAT_README
    assert "**Superpowers is required.**" not in FLAT_README


def test_readme_states_superpowers_is_an_optional_companion():
    assert (
        "Superpowers is an optional companion, not a requirement: brainstorming "
        "and its practice skills pair well with ultrapowers, but plan authoring "
        "is ultrapowers' own — the `ultrawrite` skill writes the plan." in FLAT_README
    )


def test_readme_states_the_weaker_sequential_executor_property():
    assert SEQUENTIAL_PROPERTY in FLAT_README


def test_the_sequential_property_is_worded_exactly_as_the_skill_words_it():
    assert SEQUENTIAL_PROPERTY in flat(SKILL)


def test_readme_does_not_promise_plans_of_steps_and_verbatim_code():
    assert "exact steps, often the actual code" not in FLAT_README


def test_readme_keeps_the_product_sentence():
    assert "runs on an exe.dev fleet" in FLAT_README


# --- marketplace.json (Step 2) -------------------------------------------

def test_marketplace_descriptions_are_exactly_the_cutover_wording():
    entry = next(p for p in MARKETPLACE["plugins"] if p["name"] == "ultrapowers")
    assert MARKETPLACE["description"] == (
        "ultrapowers: authors plans with ultrawrite and executes them "
        "autonomously in parallel, on an exe.dev fleet you provision."
    )
    assert entry["description"] == (
        "ultrapowers client — owns plan authoring (ultrawrite) and runs on an "
        "exe.dev fleet you provision (parallel waves in a sandbox, per-task "
        "review, orchestrator-opened PR); no local engine"
    )


def test_marketplace_no_longer_calls_them_superpowers_plans():
    assert "Superpowers plans" not in MARKETPLACE_TEXT
