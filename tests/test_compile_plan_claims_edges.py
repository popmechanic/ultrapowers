"""`claims-v1` edge derivation, the ADVISORY channel, and the retired cross-check.

Under `claims-v1` ordering is DERIVED, never declared (spec 2026-08-31 §3): the
marker tier is empty because the grammar zeroes `depends_on`, the text tier is
OFF, and what is left is Interfaces, write-after-create, and the one same-file
tier the grammar can justify — a NON-TEXT overlap, which no kernel fold can
merge. Everything the compiler notices but will not order is an `ADVISORY
grammar:` line on the `--check` tail; nothing in this file refuses, at any word
count (spec §1.5).

The run-43 correction lives here too. The legacy `undeclared-dependency`
cross-check computes `declared = a["id"] in b["depends_on"]`, which the grammar
zeroes — so on the canonical happy path it fired, telling the author to add a
**Depends-on:** marker the grammar refuses outright. Under `claims-v1` it is
retired; under legacy it is byte-identical, pinned at the bottom of this file.
"""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402
from compile_plan import (  # noqa: E402
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

HEADER = ("# Plan: Edges\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n")


def _task(tid, title, *, files, consumes, produces, context,
          proof_test=None):
    """One well-formed claims-v1 task: head markers then the six body slots."""
    proof_test = proof_test or "tests/test_t%s.py" % tid
    return "\n\n".join([
        "### Task %s: %s" % (tid, title),
        "**Type:** implementation",
        "**Files:**\n" + "\n".join("- " + f for f in files),
        ("**Claim:** An operator asks for %s and gets it. (elicited)\n"
         "Machine: `thing%s()` returns `%s`." % (title.lower(), tid, tid)),
        "**Authorized-by:** #489",
        ("**Interfaces:**\n- Consumes: %s\n- Produces: %s"
         % (consumes, produces)),
        "**Context:** " + context,
        ("**Proof:**\n- Test: `%s`\n\n```python\nassert thing%s()\n```"
         % (proof_test, tid)),
        "**Stale-if:**\n- path-exists: `src/t%s.py`" % tid,
    ])


def _plan(*tasks):
    return HEADER + "\n" + "\n\n".join(tasks) + "\n"


def _sign(plan):
    """Every claims-v1 compile needs a fresh, current, all-pass gate-verdict
    record beside the plan (spec §4.5) — built the way tests/test_gate_verdicts
    builds it, keyed on the plan's LIVE (Claim, Proof) hashes."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in split_tasks(plan.read_text()):
        claims = parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": gate_input_hash(claims["claim"], claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return p


def _claims_plan(tmp_path, *tasks, name="plan.md"):
    return _sign(_write(tmp_path, _plan(*tasks), name))


def _run(path, *extra):
    return subprocess.run([sys.executable, str(COMPILER), str(path)] + list(extra),
                          capture_output=True, text=True)


def _compile(path, *extra):
    p = _run(path, *extra)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _check(path, *extra):
    p = _run(path, "--check", *extra)
    return p.returncode, p.stdout.splitlines()


def _advisories(lines, prefix="ADVISORY grammar: "):
    return [l for l in lines if l.startswith(prefix)]


def _git_repo(tmp_path, files):
    """A throwaway checkout holding `files` ({relpath: text}), tracked via the
    index — `git ls-files`/`git grep` need no commit."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    for rel, text in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    return repo


# ---------------------------------------------------------------------------
# Interface edges — the whole of the fixture's derived ordering
# ---------------------------------------------------------------------------

def test_the_fixture_interface_edge_is_the_only_edge_and_no_marker_edge_exists():
    out = _compile(CLAIMS_FIXTURE)
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    assert [e["why"] for e in out["dag_edges"]] == ["interface"]
    assert out["waves"] == [["1", "3"], ["2"]]
    # depends_on is zeroed by the grammar, so the marker tier cannot fire.
    assert [t["depends_on"] for t in out["tasks"]] == [[], [], []]


# ---------------------------------------------------------------------------
# The retired cross-check (the run-43 correction)
# ---------------------------------------------------------------------------

def test_the_canonical_claims_happy_path_draws_no_conflict_at_all():
    # The whole point: the grammar zeroes depends_on, so the legacy
    # `declared = a["id"] in b["depends_on"]` test is always False — without the
    # suppression the canonical fixture shouts at the author to add a
    # **Depends-on:** marker claims-v1 refuses outright.
    assert _compile(CLAIMS_FIXTURE)["marker_conflicts"] == []


def test_no_undeclared_dependency_conflict_for_any_claims_interface_edge(tmp_path):
    plan = _claims_plan(
        tmp_path,
        _task("1", "Widget", files=["Create: `app/widget.py`"],
              consumes="nothing", produces="`make_widget(n: int) -> Widget`",
              context="A flat package with no registry to update."),
        _task("2", "Catalog", files=["Create: `app/catalog.py`"],
              consumes="`make_widget(n: int) -> Widget`",
              produces="`catalog(sizes: list[int]) -> list[Widget]`",
              context="A thin mapping over the constructor."))
    out = _compile(plan)
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    assert [c for c in out["marker_conflicts"]
            if c["kind"] == "undeclared-dependency"] == []
    assert out["marker_conflicts"] == []


LEGACY_PLAN = (
    "# Plan: Legacy\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
    "### Task 1: Producer\n"
    "\n"
    "**Type:** implementation\n"
    "**Depends-on:** none\n"
    "\n"
    "**Files:**\n"
    "- Create: `app/widget.py`\n"
    "\n"
    "**Interfaces:**\n"
    "- Consumes: nothing\n"
    "- Produces: `make_widget(n: int) -> Widget`\n"
    "\n"
    "- [ ] **Step 1: Build it.**\n"
    "\n"
    "### Task 2: Consumer\n"
    "\n"
    "**Type:** implementation\n"
    "\n"
    "**Files:**\n"
    "- Create: `app/catalog.py`\n"
    "\n"
    "**Interfaces:**\n"
    "- Consumes: `make_widget(n: int) -> Widget`\n"
    "- Produces: `catalog(sizes: list[int]) -> list[Widget]`\n"
    "\n"
    "- [ ] **Step 1: Build it.**\n"
)


def test_a_legacy_plan_still_emits_undeclared_dependency_byte_for_byte(tmp_path):
    # The licensed exception is scoped to claims-v1 and to nothing else: the
    # legacy conflict keeps its exact task/edge/note/kind, verbatim.
    out = _compile(_write(tmp_path, LEGACY_PLAN))
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    assert out["marker_conflicts"] == [{
        "task": "2",
        "edge": "undeclared: 1 -> 2 (interface)",
        "note": "undeclared dependency: Task 2 Consumes make_widget which Task 1 "
                "Produces, but Task 2 does not declare **Depends-on:** 1 and "
                "shares no file with it — add the marker",
        "kind": "undeclared-dependency",
    }]


# ---------------------------------------------------------------------------
# The text tier is OFF — ordering phrasing in a body slot orders nothing
# ---------------------------------------------------------------------------

ORDERING_ADVISORY = "ADVISORY grammar: ordering phrasing in a body slot never orders"


def _ordering_plan(tmp_path):
    return _claims_plan(
        tmp_path,
        _task("1", "Widget", files=["Create: `app/widget.py`"],
              consumes="nothing", produces="`make_widget(n: int) -> Widget`",
              context="A flat package with no registry to update."),
        _task("2", "Report", files=["Create: `app/report.py`"],
              consumes="nothing", produces="`report(x: int) -> str`",
              context="The formatter is written after Task 1 completes."))


def test_ordering_phrasing_in_a_body_slot_orders_nothing(tmp_path):
    out = _compile(_ordering_plan(tmp_path))
    assert out["dag_edges"] == []
    assert out["waves"] == [["1", "2"]]


def test_ordering_phrasing_draws_an_advisory_and_never_refuses(tmp_path):
    rc, lines = _check(_ordering_plan(tmp_path))
    assert rc == 0 and lines[0] == "PLAN OK"
    assert [l for l in lines if l.startswith(ORDERING_ADVISORY)], lines


def test_a_legacy_plan_still_draws_the_text_edge(tmp_path):
    # The text tier is retired under claims-v1 ONLY.
    text = LEGACY_PLAN.replace("- [ ] **Step 1: Build it.**\n\n### Task 2",
                               "- [ ] **Step 1: Build it after Task 1.**\n\n### Task 2")
    out = _compile(_write(tmp_path, text))
    assert {(e["from"], e["to"]) for e in out["dag_edges"]} == {("1", "2")}


# ---------------------------------------------------------------------------
# Unmatched Consumes
# ---------------------------------------------------------------------------

CONSUMES_ADVISORY = "ADVISORY grammar: Consumes pairs with no sibling Produces"


def test_unmatched_consumes_draws_an_advisory_for_prose_and_for_a_typo(tmp_path):
    plan = _claims_plan(
        tmp_path,
        _task("1", "Widget", files=["Create: `app/widget.py`"],
              consumes="nothing", produces="`make_widget(n: int) -> Widget`",
              context="A flat package with no registry to update."),
        _task("2", "Prose", files=["Create: `app/prose.py`"],
              consumes="the widget registry, once someone builds one",
              produces="`prose(x: int) -> str`",
              context="Nothing here pairs with a sibling."),
        _task("3", "Typo", files=["Create: `app/typo.py`"],
              consumes="`make_widgt(n: int) -> Widget`",
              produces="`typo(x: int) -> str`",
              context="One character off is not a pairing."))
    rc, lines = _check(plan)
    assert rc == 0 and lines[0] == "PLAN OK"
    drawn = [l for l in lines if l.startswith(CONSUMES_ADVISORY)]
    assert len(drawn) == 2, drawn
    assert any("task 2" in l and "the widget registry" in l for l in drawn), drawn
    assert any("task 3" in l and "make_widgt" in l for l in drawn), drawn
    # ... and it orders nothing.
    assert _compile(plan)["dag_edges"] == []


def test_placeholder_consumes_values_draw_nothing():
    # The committed fixture: task 1 says `nothing (first task)`, task 3 says
    # `nothing`, task 2 pairs exactly. No unmatched-Consumes line at all.
    rc, lines = _check(CLAIMS_FIXTURE)
    assert rc == 0 and lines[0] == "PLAN OK"
    assert [l for l in lines if l.startswith(CONSUMES_ADVISORY)] == []


def test_a_none_consumes_value_draws_nothing(tmp_path):
    plan = _claims_plan(
        tmp_path,
        _task("1", "Solo", files=["Create: `app/solo.py`"],
              consumes="none", produces="`solo() -> int`",
              context="Nothing to consume."))
    rc, lines = _check(plan)
    assert rc == 0
    assert [l for l in lines if l.startswith(CONSUMES_ADVISORY)] == []


# ---------------------------------------------------------------------------
# Context word count — an ADVISORY, never a refusal (spec §1.5)
# ---------------------------------------------------------------------------

FIXTURE_CONTEXT_ADVISORIES = [
    "ADVISORY grammar: Context is 24 words — task 1",
    "ADVISORY grammar: Context is 27 words — task 2",
    "ADVISORY grammar: Context is 26 words — task 3",
]


def test_every_claims_task_draws_its_context_word_count():
    rc, lines = _check(CLAIMS_FIXTURE)
    assert rc == 0 and lines[0] == "PLAN OK"
    assert [l for l in lines
            if l.startswith("ADVISORY grammar: Context is")] == \
        FIXTURE_CONTEXT_ADVISORIES


def test_a_long_context_is_counted_and_never_refuses(tmp_path):
    plan = _claims_plan(
        tmp_path,
        _task("1", "Verbose", files=["Create: `app/verbose.py`"],
              consumes="nothing", produces="`verbose() -> int`",
              context=" ".join(["word"] * 400)))
    rc, lines = _check(plan)
    assert rc == 0 and lines[0] == "PLAN OK"
    assert "ADVISORY grammar: Context is 400 words — task 1" in lines
    assert _compile(plan)["waves"] == [["1"]]


def test_a_legacy_plan_draws_no_grammar_advisory_at_all(tmp_path):
    rc, lines = _check(_write(tmp_path, LEGACY_PLAN))
    assert rc == 0
    assert lines == ["PLAN OK"]


# ---------------------------------------------------------------------------
# Non-text same-file overlap
# ---------------------------------------------------------------------------

NOT_CLASSIFIABLE = "ADVISORY grammar: same-file pair not classifiable without a tree"


def _overlap_plan(tmp_path):
    return _claims_plan(
        tmp_path,
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Badge", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`badge() -> bytes`",
              context="The badge is stamped into the same raster asset."))


def _tree(tmp_path, blob):
    root = tmp_path / "tree"
    (root / "assets").mkdir(parents=True)
    (root / "assets/logo.png").write_bytes(blob)
    return root


def test_a_binary_same_file_pair_is_ordered_when_a_tree_says_so(tmp_path):
    plan = _overlap_plan(tmp_path)
    root = _tree(tmp_path, b"\x89PNG\x00")
    out = _compile(plan, "--base", str(root))
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "non-text-overlap"}]
    assert out["waves"] == [["1"], ["2"]]


def test_a_symlink_at_the_shared_path_is_non_text(tmp_path):
    plan = _overlap_plan(tmp_path)
    root = tmp_path / "tree"
    (root / "assets").mkdir(parents=True)
    (root / "assets/logo.png").symlink_to(tmp_path / "elsewhere.png")
    out = _compile(plan, "--base", str(root))
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "non-text-overlap"}]


def test_a_text_same_file_pair_is_left_to_the_fold(tmp_path):
    plan = _overlap_plan(tmp_path)
    root = _tree(tmp_path, b"a text logo, line by line\n")
    out = _compile(plan, "--base", str(root))
    assert out["dag_edges"] == []
    assert out["waves"] == [["1", "2"]]


def test_without_a_tree_the_pair_is_unordered_and_draws_the_advisory(tmp_path):
    plan = _overlap_plan(tmp_path)
    assert _compile(plan)["dag_edges"] == []
    rc, lines = _check(plan)
    assert rc == 0 and lines[0] == "PLAN OK"
    drawn = [l for l in lines if l.startswith(NOT_CLASSIFIABLE)]
    assert len(drawn) == 1, lines
    assert "assets/logo.png" in drawn[0]


def test_the_is_binary_classifier(tmp_path):
    root = tmp_path / "root"
    (root / "d").mkdir(parents=True)
    (root / "d/text.txt").write_text("x" * 20000)
    (root / "d/binary.png").write_bytes(b"\x89PNG" + b"\x00" + b"z" * 100)
    # A NUL past the 8 KB sniff window is not seen — the read is capped.
    (root / "d/late.bin").write_bytes(b"z" * 9000 + b"\x00")
    (root / "d/link").symlink_to(root / "d/nowhere")
    assert compile_plan.is_binary(root, "d/text.txt") is False
    assert compile_plan.is_binary(root, "d/binary.png") is True
    assert compile_plan.is_binary(root, "d/late.bin") is False
    assert compile_plan.is_binary(root, "d/link") is True
    assert compile_plan.is_binary(root, "d/absent.png") is False


# ---------------------------------------------------------------------------
# `--check --renders --base` names the order it would impose
#
# Without a tree the same-file tier can only say it cannot tell (the pin above).
# WITH one it can: `--check` classifies each shared path with the same
# `is_binary` the compile uses, and for a non-text one it prints the order the
# compile WOULD impose — the whole point of asking. Text pairs stay silent
# because the kernel folds them; the rc never moves either way.
# ---------------------------------------------------------------------------

NON_TEXT_PAIR = "ADVISORY grammar: non-text same-file pair"


def _disjoint_plan(tmp_path):
    """Two claims tasks that share no path at all."""
    return _claims_plan(
        tmp_path,
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Badge", files=["Modify: `assets/badge.png`"],
              consumes="nothing", produces="`badge() -> bytes`",
              context="The badge is its own raster asset."))


ORDERED_LINE = (
    "ADVISORY grammar: non-text same-file pair \u2014 tasks 1 and 2 both name "
    "`assets/logo.png`; the compile orders 1 -> 2 (non-text-overlap)")


def test_with_a_tree_a_binary_pair_names_the_order_the_compile_imposes(tmp_path):
    # Leg (a): one line, both ids, the path, the label, document order.
    plan = _overlap_plan(tmp_path)
    root = _tree(tmp_path, b"\x89PNG\x00")
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0 and lines[0] == "PLAN OK"
    drawn = [l for l in lines if l.startswith(NON_TEXT_PAIR)]
    assert drawn == [ORDERED_LINE], lines
    # ... and it is the order the compile actually imposes on the same tree.
    assert _compile(plan, "--base", str(root))["dag_edges"] == [
        {"from": "1", "to": "2", "why": "non-text-overlap"}]


def test_with_a_tree_a_symlink_pair_names_the_order_the_compile_imposes(tmp_path):
    # Leg (b): a symlink is non-text for exactly the same reason.
    plan = _overlap_plan(tmp_path)
    root = tmp_path / "tree"
    (root / "assets").mkdir(parents=True)
    (root / "assets/logo.png").symlink_to(tmp_path / "elsewhere.png")
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert [l for l in lines if l.startswith(NON_TEXT_PAIR)] == [ORDERED_LINE], lines


def test_with_a_tree_a_text_pair_is_silent(tmp_path):
    # Leg (c): a text pair folds, so there is nothing to say — and the
    # not-classifiable line is retired the moment a tree can classify.
    plan = _overlap_plan(tmp_path)
    root = _tree(tmp_path, b"a text logo, line by line\n")
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert [l for l in lines if "non-text" in l] == [], lines
    assert [l for l in lines if l.startswith(NOT_CLASSIFIABLE)] == [], lines
    assert _compile(plan, "--base", str(root))["dag_edges"] == []


def test_with_a_tree_a_pair_sharing_no_path_is_silent(tmp_path):
    # The machine sentence's other silent case: no shared path at all.
    plan = _disjoint_plan(tmp_path)
    root = _tree(tmp_path, b"\x89PNG\x00")
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert [l for l in lines if "non-text" in l] == [], lines
    assert [l for l in lines if l.startswith(NOT_CLASSIFIABLE)] == [], lines


def test_the_base_check_rc_is_the_no_base_rc(tmp_path):
    # Leg (d): the advisory rides the tail; it never moves the verdict, on a
    # clean plan or on one the structural net rejects.
    root = _tree(tmp_path, b"\x89PNG\x00")
    clean = _overlap_plan(tmp_path)
    assert _check(clean, "--renders", "--base", str(root))[0] == _check(clean)[0] == 0
    broken = _write(tmp_path, _plan(
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Badge", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`badge() -> bytes`",
              context="The badge is stamped into the same raster asset."),
    ).replace("**Authorized-by:** #489", "", 1), name="broken.md")
    rc_base, _ = _check(broken, "--renders", "--base", str(root))
    rc_plain, _ = _check(broken)
    assert rc_base == rc_plain == 2


def _overlap_pair_with_interface(tmp_path, *, reversed_):
    """The same shared-binary pair, plus ONE interface edge across it.

    `reversed_` picks which way the interface tier points it: task 1 Consumes
    what task 2 Produces (edge 2 -> 1, the reverse of document order), or the
    other way round (edge 1 -> 2, document order)."""
    return _claims_plan(
        tmp_path,
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="`badge() -> bytes`" if reversed_ else "nothing",
              produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Badge", files=["Modify: `assets/logo.png`"],
              consumes="nothing" if reversed_ else "`logo() -> bytes`",
              produces="`badge() -> bytes`",
              context="The badge is stamped into the same raster asset."))


def _only(lines, prefix=None):
    drawn = [l for l in lines if l.startswith(prefix or NON_TEXT_PAIR)]
    assert len(drawn) == 1, lines
    return drawn[0]


def test_a_reversing_interface_edge_is_reported_in_its_own_direction(tmp_path):
    # Tier 2b is CYCLE-GUARDED: the interface tier has already ordered 2 -> 1,
    # so `would_cycle(1, 2)` fires and Tier 2b adds nothing. The advisory must
    # name THAT order, not the document order it would have proposed — naming
    # `1 -> 2 (non-text-overlap)` here would be the reverse of the truth and a
    # label carried by no edge the compile emits.
    plan = _overlap_pair_with_interface(tmp_path, reversed_=True)
    root = _tree(tmp_path, b"\x89PNG\x00")
    edges = _compile(plan, "--base", str(root))["dag_edges"]
    assert edges == [{"from": "2", "to": "1", "why": "interface"}]
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert _only(lines) == (
        "ADVISORY grammar: non-text same-file pair \u2014 tasks 1 and 2 both "
        "name `assets/logo.png`; the compile orders 2 -> 1 (interface)")
    assert "non-text-overlap" not in _only(lines)


def test_an_agreeing_interface_edge_is_reported_with_its_own_label(tmp_path):
    # The milder half of the same gap: the pair is already ordered 1 -> 2, so
    # Tier 2b's `seen` guard suppresses its edge. The direction is right but the
    # `why` is `interface`, and the advisory says `interface`.
    plan = _overlap_pair_with_interface(tmp_path, reversed_=False)
    root = _tree(tmp_path, b"\x89PNG\x00")
    edges = _compile(plan, "--base", str(root))["dag_edges"]
    assert edges == [{"from": "1", "to": "2", "why": "interface"}]
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert _only(lines) == (
        "ADVISORY grammar: non-text same-file pair \u2014 tasks 1 and 2 both "
        "name `assets/logo.png`; the compile orders 1 -> 2 (interface)")


def test_a_transitively_ordered_pair_names_no_edge_it_does_not_have(tmp_path):
    # 3 -> 2 -> 1 by interface; 1 and 3 share the raster. Tier 2b's cycle guard
    # declines (3 already reaches 1), so NO direct edge joins the pair. The
    # order is nonetheless real, and the advisory reports it as transitive
    # rather than inventing an edge, or a `why`, for it.
    plan = _claims_plan(
        tmp_path,
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="`mid() -> int`", produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Middle", files=["Modify: `src/mid.py`"],
              consumes="`deep() -> int`", produces="`mid() -> int`",
              context="The middle stage is plain text."),
        _task("3", "Deep", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`deep() -> int`",
              context="The deep stage restamps the same raster asset."))
    root = _tree(tmp_path, b"\x89PNG\x00")
    edges = _compile(plan, "--base", str(root))["dag_edges"]
    assert edges == [{"from": "2", "to": "1", "why": "interface"},
                     {"from": "3", "to": "2", "why": "interface"}]
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert rc == 0
    assert _only(lines) == (
        "ADVISORY grammar: non-text same-file pair \u2014 tasks 1 and 3 both "
        "name `assets/logo.png`; the compile already orders 3 before 1, "
        "transitively")


def test_a_pair_the_dag_never_reaches_is_reported_as_unordered(tmp_path):
    # Only implementation tasks enter the edge tiers. A gate task sharing the
    # raster with an implementation task is a real, UNMANAGED non-text overlap
    # — so the advisory says the compile orders neither, rather than promising
    # an order no tier will impose.
    plan = _claims_plan(
        tmp_path,
        _task("1", "Logo", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`logo() -> bytes`",
              context="The logo is a raster asset."),
        _task("2", "Badge", files=["Modify: `assets/logo.png`"],
              consumes="nothing", produces="`badge() -> bytes`",
              context="The badge is stamped into the same raster asset.")
        .replace("**Type:** implementation", "**Type:** gate", 1))
    root = _tree(tmp_path, b"\x89PNG\x00")
    assert _compile(plan, "--base", str(root))["dag_edges"] == []
    rc, lines = _check(plan, "--renders", "--base", str(root))
    assert _only(lines) == (
        "ADVISORY grammar: non-text same-file pair \u2014 tasks 1 and 2 both "
        "name `assets/logo.png`; the compile orders neither \u2014 the pair is "
        "not two implementation tasks, so no edge tier reaches it")


def test_the_canonical_claims_fixture_is_unmoved_by_a_base(tmp_path):
    # Leg (f): the canonical fixture shares no path, so `--base` adds nothing
    # to its tail — its `--check --renders` output is byte-identical with and
    # without the tree root the renders already default to.
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=ROOT,
                          capture_output=True, text=True, check=True).stdout.strip()
    rc_base, with_base = _check(CLAIMS_FIXTURE, "--renders", "--base", root)
    rc_plain, without = _check(CLAIMS_FIXTURE, "--renders")
    assert (rc_base, with_base) == (rc_plain, without)
    assert [l for l in with_base if "non-text" in l] == []


# ---------------------------------------------------------------------------
# The half-threaded seam (run-43 Task-1 residue)
# ---------------------------------------------------------------------------

def test_render_advisories_reparses_under_the_plans_own_grammar(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path, {"keep.py": "x = 1\n"})
    plan = _sign(_write(tmp_path, CLAIMS_FIXTURE.read_text()))
    seen = {}

    def capture(tasks, ctx):
        seen["tasks"] = tasks
        return []

    monkeypatch.setattr(compile_plan, "ADVISORY_RENDERS", [("capture", capture)])
    assert compile_plan.render_advisories(plan, repo) == []
    got = seen["tasks"]
    assert [t["id"] for t in got] == ["1", "2", "3"]
    # Grammar-aware: the claims overlay ran, so the slot bodies were parsed as
    # slots and the two unsigned tiers were zeroed — not read as legacy prose.
    assert all("claims" in t for t in got), [sorted(t) for t in got]
    assert [t["depends_on"] for t in got] == [[], [], []]
    assert got[0]["claims"]["claim_provenance"] == "quoted:#489"


def test_check_renders_on_the_claims_fixture_reads_no_slot_as_legacy_prose():
    p = _run(CLAIMS_FIXTURE, "--check", "--renders")
    assert p.returncode == 0, p.stdout
    lines = p.stdout.splitlines()
    assert lines[0] == "PLAN OK"
    assert [l for l in lines if l.startswith("ADVISORY referent:")] == []
    assert [l for l in lines if l.startswith(ORDERING_ADVISORY)] == []
    assert [l for l in lines
            if l.startswith("ADVISORY grammar: Context is")] == \
        FIXTURE_CONTEXT_ADVISORIES


# ---------------------------------------------------------------------------
# Legacy pin — the corpus is untouched by every line above
# ---------------------------------------------------------------------------

def test_the_legacy_fixture_corpus_is_untouched():
    # Pinned to the pre-plan values (the same literals tests/test_compile_plan
    # _claims.py holds): no line in this file may move a legacy edge, a legacy
    # wave, or the legacy `--check` verdict.
    wide = _compile(ROOT / "evals/fixtures/wide/plan.md")
    assert wide["dag_edges"] == []
    assert wide["waves"] == [["1", "2", "3", "4", "5", "6"]]
    chained = _compile(ROOT / "evals/fixtures/chained/plan.md")
    assert chained["dag_edges"] == [{"from": "1", "to": "2", "why": "marker"},
                                    {"from": "2", "to": "3", "why": "marker"},
                                    {"from": "3", "to": "4", "why": "marker"},
                                    {"from": "4", "to": "5", "why": "marker"}]
    assert chained["waves"] == [["1"], ["2"], ["3"], ["4"], ["5"]]
    for name in ("wide", "chained"):
        rc, lines = _check(ROOT / "evals/fixtures" / name / "plan.md")
        assert rc == 0 and lines == ["PLAN OK"], (name, lines)
