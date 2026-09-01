"""`claims-v1` grammar: detection, the six-slot body parser, and the refusals.

The grammar is opt-in — declared by a `**Grammar:** claims-v1` line in the plan
header (spec 2026-08-31 §3). Absent, the compiler parses exactly as it does
today, which the legacy pins at the bottom of this file hold to literal values
captured before the mode existed.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    parse_claims_body,
    plan_grammar,
    split_tasks,
)

CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"

HEADER = (
    "# Plan: Sample\n"
    "\n"
    "**Grammar:** claims-v1\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
)

# Heading + head markers (`Type`/`Files`, which parse exactly as they do under
# legacy), then the six body slots — assembled by `_task` so each refusal case
# is one slot swapped out rather than string surgery over a blob.
HEAD = ("### Task 1: Sample\n"
        "\n"
        "**Type:** implementation\n"
        "\n"
        "**Files:**\n"
        "- Create: `app/widget.py`\n"
        "- Test: `tests/test_widget.py`")
CLAIM = ("**Claim:** An operator can ask for a widget of a given size and get "
         "one. (quoted from #489)\n"
         "Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`.")
AUTHORIZED_BY = ("**Authorized-by:** #489; spec `docs/superpowers/specs/"
                 "2026-08-31-owned-authoring-skill.md` §3")
INTERFACES = ("**Interfaces:**\n"
              "- Produces: `make_widget(n: int) -> Widget`\n"
              "- Consumes: nothing")
CONTEXT = ("**Context:** The repo has no widget module yet; `app/` is a flat\n"
           "package with no registry to register into.")
PROOF = ("**Proof:**\n"
         "- Test: `tests/test_widget.py`\n"
         "\n"
         "```python\n"
         "assert make_widget(3).size == 3\n"
         "```")
STALE_IF = "**Stale-if:** path-exists: `app/widget.py`"

SLOTS = (CLAIM, AUTHORIZED_BY, INTERFACES, CONTEXT, PROOF, STALE_IF)


def _task(*slots):
    return "\n\n".join((HEAD,) + slots) + "\n"


def _plan(*slots):
    return HEADER + _task(*(slots or SLOTS))


GOOD_PLAN = _plan()

LEGACY_PLAN = (
    "# Plan: Legacy\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
    "### Task 1: Sample\n"
    "\n"
    "**Type:** implementation\n"
    "**Depends-on:** none\n"
    "\n"
    "**Files:**\n"
    "- Create: `app/widget.py`\n"
    "- Test: `tests/test_widget.py`\n"
    "\n"
    "- [ ] **Step 1: Write failing tests** for `make_widget`.\n"
    "- [ ] **Step 2: Implement** it.\n"
)


def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return p


def _run(path, *extra):
    return subprocess.run([sys.executable, str(COMPILER), str(path)] + list(extra),
                          capture_output=True, text=True)


def _compile(path):
    p = _run(path)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _check_lines(path):
    """`--check` output lines (the authoring-time violation channel)."""
    p = _run(path, "--check")
    return p.returncode, p.stdout.splitlines()


def _body(plan_text, task_id="1"):
    return next(t["body"] for t in split_tasks(plan_text) if t["id"] == task_id)


def _refuses(tmp_path, plan_text, prefix):
    """A claims-v1 grammar violation refuses BOTH channels — the compile
    (SystemExit, message on stderr) and `--check` (exit 2, one line each) — with
    a message starting with the exact spec'd prefix."""
    plan = _write(tmp_path, plan_text)
    run = _run(plan)
    assert run.returncode != 0, "expected a refusal, got:\n" + run.stdout[:400]
    assert any(line.startswith(prefix) for line in run.stderr.splitlines()), \
        "stderr carries no %r line:\n%s" % (prefix, run.stderr)
    rc, lines = _check_lines(plan)
    assert rc == 2, lines
    assert any(line.startswith(prefix) for line in lines), \
        "--check carries no %r line:\n%s" % (prefix, "\n".join(lines))


# ---------------------------------------------------------------------------
# Grammar detection
# ---------------------------------------------------------------------------

def test_plan_grammar_reads_the_header_declaration():
    assert plan_grammar(GOOD_PLAN) == "claims-v1"


def test_plan_grammar_is_legacy_without_the_declaration():
    assert plan_grammar(LEGACY_PLAN) == "legacy"
    assert plan_grammar((ROOT / "evals/fixtures/wide/plan.md").read_text()) == "legacy"
    assert plan_grammar((ROOT / "evals/fixtures/chained/plan.md").read_text()) == "legacy"


def test_plan_grammar_ignores_a_fenced_or_inline_mention():
    # A plan that only TALKS about the grammar is not written in it.
    text = ("# Plan: Talking about it\n\n"
            "The mode is declared by a `**Grammar:** claims-v1` line.\n\n"
            "```\n**Grammar:** claims-v1\n```\n\n"
            "### Task 1: A\n\n**Type:** implementation\n")
    assert plan_grammar(text) == "legacy"


# ---------------------------------------------------------------------------
# The six-slot body parser
# ---------------------------------------------------------------------------

def test_parse_claims_body_populates_every_slot_verbatim():
    got = parse_claims_body(_body(GOOD_PLAN), "1")
    assert got["claim"] == (
        "An operator can ask for a widget of a given size and get one. "
        "(quoted from #489)\n"
        "Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`.")
    assert got["authorized_by"] == (
        "#489; spec `docs/superpowers/specs/"
        "2026-08-31-owned-authoring-skill.md` §3")
    assert got["interfaces"] == (
        "- Produces: `make_widget(n: int) -> Widget`\n"
        "- Consumes: nothing")
    assert got["context"] == (
        "The repo has no widget module yet; `app/` is a flat\n"
        "package with no registry to register into.")
    assert got["proof"] == (
        "- Test: `tests/test_widget.py`\n"
        "\n"
        "```python\n"
        "assert make_widget(3).size == 3\n"
        "```")
    assert got["stale_if"] == "path-exists: `app/widget.py`"
    assert got["claim_provenance"] == "quoted:#489"
    assert got["violations"] == []


def test_parse_claims_body_reads_an_elicited_provenance_tag():
    text = _plan(CLAIM.replace("(quoted from #489)", "(elicited)"),
                 *SLOTS[1:])
    got = parse_claims_body(_body(text), "1")
    assert got["claim_provenance"] == "elicited"
    assert got["violations"] == []


def test_the_provenance_tag_closes_a_wrapped_operator_sentence():
    # The tag closes the operator SENTENCE, which may wrap; the machine
    # restatement below it is not where a tag can hide.
    wrapped = ("**Claim:** An operator can ask for a widget of a given size\n"
               "and get one. (quoted from #489)\n"
               "Machine: `make_widget(3)` returns a `Widget`.")
    got = parse_claims_body(_body(_plan(wrapped, *SLOTS[1:])), "1")
    assert got["claim_provenance"] == "quoted:#489"
    assert got["violations"] == []


def test_a_tag_only_in_the_machine_restatement_is_not_provenance(tmp_path):
    tagged_machine = ("**Claim:** An operator can ask for a widget of a given "
                      "size and get one.\n"
                      "Machine: `make_widget(3)` returns a `Widget`. (elicited)")
    text = _plan(tagged_machine, *SLOTS[1:])
    _refuses(tmp_path, text, "grammar: Claim carries no provenance tag")
    assert parse_claims_body(_body(text), "1")["claim_provenance"] is None


def test_a_well_formed_claims_plan_compiles(tmp_path):
    out = _compile(_write(tmp_path, GOOD_PLAN))
    assert out["waves"] == [["1"]]
    assert out["tasks"] == [{
        "id": "1", "title": "Sample", "disposition": "implementation",
        "heuristic": False, "writes": ["app/widget.py"], "depends_on": [],
        "interfaces": {"consumes": ["nothing"],
                       "produces": ["`make_widget(n: int) -> Widget`"]},
    }]
    rc, lines = _check_lines(_write(tmp_path, GOOD_PLAN))
    assert rc == 0 and lines[0] == "PLAN OK"


# ---------------------------------------------------------------------------
# Refusals — every message starts with the spec'd `grammar:` prefix
# ---------------------------------------------------------------------------

def test_a_checkbox_step_is_refused(tmp_path):
    _refuses(tmp_path, GOOD_PLAN + "\n- [ ] **Step 1: Implement** the widget.\n",
             "grammar: Steps are not a slot")


def test_a_depends_on_marker_is_refused(tmp_path):
    text = GOOD_PLAN.replace("**Type:** implementation",
                             "**Type:** implementation\n**Depends-on:** none")
    _refuses(tmp_path, text, "grammar: Depends-on is not signed under claims-v1")


def test_a_commutes_marker_is_refused(tmp_path):
    text = GOOD_PLAN.replace("**Type:** implementation",
                             "**Type:** implementation\n"
                             "**Commutes:** `app/widget.py`")
    _refuses(tmp_path, text, "grammar: Commutes is not signed under claims-v1")


def test_a_fence_outside_proof_is_refused(tmp_path):
    fenced_context = ("**Context:**\n\n```python\nmake_widget(3)\n```\n\n"
                      "The repo has no widget module yet.")
    _refuses(tmp_path,
             _plan(CLAIM, AUTHORIZED_BY, INTERFACES, fenced_context, PROOF,
                   STALE_IF),
             "grammar: code fences are legal only in Proof")


def test_a_missing_slot_is_refused(tmp_path):
    _refuses(tmp_path, _plan(CLAIM, INTERFACES, CONTEXT, PROOF, STALE_IF),
             "grammar: expected slot")


def test_slots_out_of_order_are_refused(tmp_path):
    _refuses(tmp_path,
             _plan(CLAIM, AUTHORIZED_BY, INTERFACES, PROOF, CONTEXT, STALE_IF),
             "grammar: expected slot")


def test_an_empty_slot_is_refused(tmp_path):
    _refuses(tmp_path,
             _plan(CLAIM, AUTHORIZED_BY, INTERFACES, "**Context:**", PROOF,
                   STALE_IF),
             "grammar: expected slot")


def test_a_claim_without_a_provenance_tag_is_refused(tmp_path):
    text = _plan(CLAIM.replace(" (quoted from #489)", ""), *SLOTS[1:])
    _refuses(tmp_path, text, "grammar: Claim carries no provenance tag")
    assert parse_claims_body(_body(text), "1")["claim_provenance"] is None


def test_a_prose_stale_if_is_refused(tmp_path):
    text = _plan(*SLOTS[:5],
                 "**Stale-if:** if someone else writes the widget module first")
    _refuses(tmp_path, text, "grammar: Stale-if entry is not a predicate")


def test_every_stale_if_predicate_form_is_accepted(tmp_path):
    entries = ("path-exists: `app/widget.py`", "path-absent: `app/widget.py`",
               "sha-matches: `app/widget.py`@abc1234", "issue-open: #489",
               "issue-closed: #489")
    text = _plan(*SLOTS[:5],
                 "**Stale-if:**\n" + "\n".join("- " + e for e in entries))
    got = parse_claims_body(_body(text), "1")
    assert got["violations"] == []
    assert got["stale_if_entries"] == list(entries)
    assert _compile(_write(tmp_path, text))["waves"] == [["1"]]


def test_a_proof_test_path_that_is_also_an_impl_path_is_refused(tmp_path):
    bad_proof = PROOF.replace("- Test: `tests/test_widget.py`",
                              "- Test: `app/widget.py`")
    _refuses(tmp_path, _plan(*SLOTS[:4], bad_proof, STALE_IF),
             "grammar: Proof test paths must be disjoint from implementation paths")


def test_the_refusals_are_scoped_to_claims_v1(tmp_path):
    # The same shape without the header declaration is legacy: checkbox steps
    # and a Depends-on marker are ordinary content there.
    out = _compile(_write(tmp_path, LEGACY_PLAN))
    assert out["waves"] == [["1"]]
    rc, lines = _check_lines(_write(tmp_path, LEGACY_PLAN))
    assert rc == 0 and lines[0] == "PLAN OK"


# ---------------------------------------------------------------------------
# The committed claims fixture
# ---------------------------------------------------------------------------

def test_claims_fixture_is_claims_v1_and_compiles():
    text = CLAIMS_FIXTURE.read_text()
    assert plan_grammar(text) == "claims-v1"
    out = _compile(CLAIMS_FIXTURE)
    assert [t["id"] for t in out["tasks"]] == ["1", "2", "3"]
    assert out["waves"] == [["1", "3"], ["2"]]
    assert out["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    rc, lines = _check_lines(CLAIMS_FIXTURE)
    assert rc == 0 and lines[0] == "PLAN OK"


def test_every_claims_fixture_task_carries_all_six_slots():
    text = CLAIMS_FIXTURE.read_text()
    for t in split_tasks(text):
        got = parse_claims_body(t["body"], t["id"])
        assert got["violations"] == [], (t["id"], got["violations"])
        for slot in ("claim", "authorized_by", "interfaces", "context",
                     "proof", "stale_if"):
            assert got[slot], (t["id"], slot)
        assert (got["claim_provenance"] == "elicited"
                or got["claim_provenance"].startswith("quoted:#")), \
            (t["id"], got["claim_provenance"])
        assert got["stale_if_entries"], t["id"]
    assert "`make_widget(n: int) -> Widget`" in \
        parse_claims_body(_body(text, "1"), "1")["interfaces"]
    assert "`make_widget(n: int) -> Widget`" in \
        parse_claims_body(_body(text, "2"), "2")["interfaces"]


# ---------------------------------------------------------------------------
# Legacy pins — literals captured from the compiler BEFORE claims-v1 existed
# ---------------------------------------------------------------------------

WIDE = {
    "waves": [["1", "2", "3", "4", "5", "6"]],
    "dag_edges": [],
    "waveLabels": ["6 Modules"],
    "gates": ["7"],
    "post_merge_runbook": [],
    "mode": "parallel",
    "degrade_reason": None,
    "allHeuristic": False,
}
CHAINED = {
    "waves": [["1"], ["2"], ["3"], ["4"], ["5"]],
    "dag_edges": [{"from": "1", "to": "2", "why": "marker"},
                  {"from": "2", "to": "3", "why": "marker"},
                  {"from": "3", "to": "4", "why": "marker"},
                  {"from": "4", "to": "5", "why": "marker"}],
    "waveLabels": ["Entry validation", "Line parser", "Running balance",
                   "Report formatter", "CLI entry point"],
    "gates": ["6"],
    "post_merge_runbook": [],
    "mode": "parallel",
    "degrade_reason": None,
    "allHeuristic": False,
}


def test_legacy_wide_fixture_is_pinned():
    out = _compile(ROOT / "evals/fixtures/wide/plan.md")
    assert {k: out[k] for k in WIDE} == WIDE


def test_legacy_chained_fixture_is_pinned():
    out = _compile(ROOT / "evals/fixtures/chained/plan.md")
    assert {k: out[k] for k in CHAINED} == CHAINED
