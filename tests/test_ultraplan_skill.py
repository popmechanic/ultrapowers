"""The ultraplan authoring skill CITES the canonical marker contract
(skills/ultrapowers/references/plan-markers.md) instead of mirroring it.

#492: the mirror existed because the SKILL was believed unable to reference
across skill directories. It could — `validate_skill.py` has resolved a
`skills/<name>/references/<file>` prefix against the sibling skill's directory
since #159; only this file's own prohibition test enforced the ban, and its
comment stated a rationale the validator had already outgrown. A citation
cannot drift from its source, so the two anti-drift pins it replaces are gone.
What is still pinned here is the CONTRACT's own content and the SKILL's
authoring judgment, which is ultraplan's and is not in the contract."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_ultraplan_cites_the_canonical_contract():
    # The inverse of the prohibition this replaces. Two separate things have to
    # be true and only one of them is validate_skill.py's business:
    #
    #  (a) it VALIDATES — `validate_skill.py` resolves a `skills/<name>/` prefix
    #      against the SIBLING skill's directory (#159), and the ${...} prefix
    #      does not defeat that match. CI proves it every run.
    #  (b) it RESOLVES FOR THE AGENT — a bare repo-relative path does not. The
    #      authoring agent's cwd is the USER's project, not the plugin root, so
    #      a citation without ${CLAUDE_PLUGIN_ROOT} validates in CI and then
    #      dangles in the only place that matters. That is the idiom
    #      dependency-analysis.md and report-format.md already use for paths an
    #      agent must actually open.
    text = ULTRAPLAN.read_text()
    assert "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/references/plan-markers.md" in text
    bare = text.count("skills/ultrapowers/references/plan-markers.md")
    rooted = text.count("${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/references/plan-markers.md")
    assert bare == rooted, (
        "a citation of plan-markers.md without ${CLAUDE_PLUGIN_ROOT} will not "
        "resolve from the agent's cwd")


def test_the_cited_contract_exists_where_the_skill_says_it_does():
    # The citation is only as good as the file. If plan-markers.md ever moves,
    # this fails here rather than silently in an authoring session.
    assert CONTRACT.is_file()


def test_ultraplan_pairs_with_writing_plans():
    text = ULTRAPLAN.read_text()
    assert "superpowers:writing-plans" in text
    assert "worktree-pure" in text


def test_ultraplan_overrides_the_execution_header_and_handoff():
    text = ULTRAPLAN.read_text()
    assert "REQUIRED SUB-SKILL" in text          # quotes the upstream header it replaces
    assert "ultrapowers:ultrapowers" in text     # names the parallel executor
    assert "Execution Handoff" in text           # overrides writing-plans' two-option menu
    # Anti-drift pin for the no-pause contract (2026-06-12): the handoff's
    # option 1 must keep saying that selecting ultrapowers authorizes
    # execution with no further approval pause (mirrors SKILL.md Step 3).
    assert "authorizes execution" in text
    assert "without a further approval pause" in text


def test_ultraplan_handoff_analyzes_before_recommending():
    text = ULTRAPLAN.read_text()
    # The reflex crown is gone: no unconditional "recommended for marked plans".
    assert "(recommended for marked plans)" not in text
    # The handoff now runs a fit analysis grounded in the rubric.
    assert "parallel width" in text
    assert "risk override" in text
    assert "T≥4" in text
    # All three lanes are named as recommendable outcomes.
    for lane in ("Ultrapowers", "Subagent-Driven", "Inline"):
        assert lane in text


def test_ultraplan_names_every_marker_the_contract_defines():
    # The SKILL no longer restates marker semantics, but it must still NAME each
    # marker — an author who never learns a marker exists will not go read its
    # contract. The contract half of the pin stays: a BAKE-block edit that drops
    # **Review:** is still caught.
    blocks = contract_blocks()
    assert "**Review:**" in blocks["MARKER_SYNTAX"]
    text = ULTRAPLAN.read_text()
    for marker in ("**Type:**", "**Depends-on:**", "**Review:**", "**Commutes:**"):
        assert marker in text, "ultraplan does not name the " + marker + " marker"
    assert "adversarial" in text and "lean" in text


def test_ultraplan_carries_the_commutes_doctrine():
    text = ULTRAPLAN.read_text()
    # The Commutes marker is authored here, not only in the compiler.
    assert "**Commutes:**" in text


def test_ultraplan_drops_the_phantom_edge_authoring_rules():
    # The prose-reference / description-inferred tiers are deleted from the
    # compiler, so the authoring rules that existed only to dodge them go too.
    text = ULTRAPLAN.read_text()
    assert "Describe siblings by role" not in text
    assert "description-inferred" not in text
    assert "prose-reference" not in text


def test_contract_documents_the_files_grammar():
    # plan-markers.md is the canonical contract (#85): it must document the
    # narrowed Files grammar the compiler now enforces — canonical labels,
    # the annotation/glob bail, and the catch-all construct.
    text = CONTRACT.read_text()
    assert "Create" in text and "Modify" in text and "Test" in text
    assert "glob" in text.lower()
    # Pin the annotation bail to the Files-grammar section specifically. The
    # old `"annotation" in text.lower()` was satisfied by the preamble line
    # "Additive per-task annotations", not the Files grammar (Task-6 review,
    # #85 redirect); "parenthetical note" appears only in the Files bullet
    # that forbids a trailing annotation on a path.
    assert "parenthetical note" in text.lower()


def test_contract_documents_the_interfaces_grammar():
    # plan-markers.md documents the symbol-list rule and the placeholder
    # forms that tokenize to empty (#85).
    text = CONTRACT.read_text()
    assert "symbol list" in text.lower()
    for placeholder in ("nothing", "none", "n/a"):
        assert placeholder in text


def test_ultraplan_ends_authoring_with_the_check_step():
    # #85: a marked plan is not done until `--check` passes — this is the
    # mandatory final authoring step, not an optional suggestion.
    text = ULTRAPLAN.read_text()
    assert "compile_plan.py --check" in text
    assert "PLAN OK" in text
    assert "not done until it passes the grammar check" in text


def test_shaping_moves_state_the_wave_cost_model():
    """#444 item 1: the four shaping moves are doctrine without a reason.
    An author who does not know the tail is serial and paid per wave has no
    reason to fight for an edge removal — #443 measured 54% of waves are
    decomposition shape, not dependency floor."""
    text = ULTRAPLAN.read_text()
    assert "paid once per wave" in text
    assert "billed dimension" in text
    # width is the cheap axis and the skill must say so
    assert "nearly free up to `WIDTH`" in text


def test_authoring_rules_require_evidence_for_live_world_claims():
    """#458: run-30's acks were guaranteed by its plan's shape. A reviewer can
    check correspondence to recorded evidence; it cannot check truth."""
    text = (ROOT / "skills/ultraplan/SKILL.md").read_text()
    assert "correspondence" in text
    assert "hand-executed record" in text


# --- #360 sitting 3: the anti-workaround doctrine is deduped ------------------
# The retired failure class is same-file-contention steering: the compiler folds
# concurrent same-file text writes, so the argument restatements are dead weight
# while the imperatives they wrap are live contract. plan-markers.md keeps the
# ONE imperative copy; SKILL.md keeps only the obligations that still bind.

MARKERS = ROOT / "skills/ultrapowers/references/plan-markers.md"


def norm(text):
    """Whitespace-insensitive view — these files hard-wrap prose."""
    return " ".join(text.split())


def test_skill_drops_the_anti_workaround_argumentation():
    text = norm(ULTRAPLAN.read_text())
    assert "Three old workarounds are authoring **defects**" not in text
    assert "splitting a feature or a file to dodge a collision" not in text
    assert "chaining a fan of independent tasks to serialize writers" not in text
    assert "adding `Depends-on` for file overlap alone" not in text


def test_skill_self_review_drops_the_dodge_clause():
    text = norm(ULTRAPLAN.read_text())
    assert "no task shape exists only to dodge a same-file collision" not in text
    assert "no unnatural split, no chain-for-a-fan, no overlap-only `Depends-on`" not in text
    # The bullet itself survives, ending on the escape valve.
    assert (
        "- Decomposition was shaped before annotation: every contract-first task names "
        "its independence win and passes the good-engineer test, each surviving move "
        "carries a `**Parallelization rationale:**` line — or the plan is intentionally "
        "narrow because the work has no latent parallelism."
    ) in text


def test_skill_drops_the_resolver_choreography_paragraph():
    text = norm(ULTRAPLAN.read_text())
    assert "Author for the resolver" not in text
    assert "author for the resolver" not in text.lower()
    assert "Write tasks that fold cleanly" not in text
    assert "stable anchor to edit near" not in text
    assert "append zone" not in text
    assert "Resolver guidance only — nothing parses it." not in text


def test_skill_keeps_every_move_3_imperative_verbatim():
    text = norm(ULTRAPLAN.read_text())
    # Files: required — the contention-detection input.
    assert (
        "Two obligations survive: `**Files:**` blocks remain required — they are the "
        "compiler's contention-detection input — and declare `**Commutes:**` on shared "
        "append-natured surfaces so the engine can classify that contention and union "
        "the additions instead of resolving them. Registration surfaces (route tables, "
        "export lists, manifests) and shared test modules two tasks both append to "
        "qualify; never declare it on a file the task also modifies or deletes existing "
        "lines in."
    ) in text
    # The non-text exception.
    assert (
        "One exception: chain non-text (binary/symlink) same-file pairs with "
        "`Depends-on` — they run in parallel otherwise and always fall back."
    ) in text
    # #233 blast radius.
    assert (
        "Blast radius follows the contract, not the file: a task that changes a "
        "declared `Produces:` shape owns every strict-equality pin of it, in any "
        "sibling's file — list that file in its own `**Files:**` (#233)."
    ) in text
    # The move survives as an imperative, and the deleted argument leaves no seam.
    assert (
        "reason to reshape a plan. Let colliding `Modify` lines collide. Two obligations"
    ) in text


def test_markers_keeps_the_one_imperative_copy_of_the_doctrine():
    text = norm(MARKERS.read_text())
    # The imperative survives here — this is the surviving copy.
    assert (
        "Let same-file edits stand. Never split a feature, chain a fan, or add a "
        "`**Depends-on:**` to dodge a collision."
    ) in text
    # The rationale restatement does not; the marker semantics section above
    # already carries it once (`the fold path resolves them at merge`).
    assert "Concurrent same-file text writes fold at merge, so never" not in text
    # Live contract, untouched.
    assert (
        "Declare `**Commutes:**` on shared append-natured surfaces — registration "
        "surfaces (route tables, export lists, manifests) and shared test modules where "
        "two tasks each append test functions to the same file; both writers declare it, "
        "and only for append-shaped edits. Chain only non-text (binary/symlink) same-file "
        "pairs, which always fall back. Blast radius follows the contract, not the file: "
        "a task that changes a declared `Produces:` shape owns every strict-equality pin "
        "of it, in any sibling's file — list that file in its own `**Files:**` (#233)."
    ) in text


def test_markers_pinned_vocabulary_is_untouched():
    text = MARKERS.read_text()
    for word in ("worktree-pure", "additive", "fence-aware"):
        assert word in text
