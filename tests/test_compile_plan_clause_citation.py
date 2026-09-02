"""Clause-to-leg citation (#554): a claims-v1 Machine line may number its
clauses (`M1. … M2. …`) and every Proof leg cites the clause it establishes
(`[M2]`). Active exactly when the Machine line carries a marker; every plan
authored before #554 is unnumbered and parses as it always did, drawing one
advisory. Under the active grammar the mechanical gaps run-51's gate rejected
11 of 24 pairs for are refusals, and the two judgment species are advisories.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(ROOT / "tests"))
from compile_plan import (  # noqa: E402
    clause_citation_advisories,
    machine_restatement,
    parse_claims_body,
    parse_machine_clauses,
    parse_proof_legs,
)
from test_compile_plan_claims import (  # noqa: E402
    AUTHORIZED_BY, CONTEXT, HEAD, INTERFACES, PROOF, STALE_IF,
    _body, _check_lines, _compile, _plan, _refuses, _sign, _write,
)

NUMBERED_CLAIM = (
    "**Claim:** An operator can ask for a widget of a given size and get "
    "one. (quoted from #489)\n"
    "Machine: M1. `make_widget(3)` returns a `Widget` whose `size` is `3`. "
    "M2. `make_widget(0)` raises `ValueError`.")
CITED_PROOF = (
    "**Proof:**\n"
    "- Test: `tests/test_widget.py`\n"
    "- Legs: (a) `make_widget(3).size == 3` [M1]; (b) `make_widget(0)` "
    "raises exactly `ValueError` [M2].")


def _numbered_plan(claim=NUMBERED_CLAIM, proof=CITED_PROOF):
    return _plan(claim, AUTHORIZED_BY, INTERFACES, CONTEXT, proof, STALE_IF)


# ---------------------------------------------------------------------------
# The parsers
# ---------------------------------------------------------------------------

def test_machine_restatement_joins_wrapped_lines():
    claim = ("**Claim:** x (elicited)\nMachine: M1. first\n"
             "clause continues. M2. second.")
    assert machine_restatement(claim) == \
        "M1. first clause continues. M2. second."
    assert machine_restatement("no machine half here") == ""


def test_parse_machine_clauses_reads_numbered_clauses_in_order():
    clauses, err = parse_machine_clauses("M1. alpha beta. M2. gamma.")
    assert err is None
    assert [c["id"] for c in clauses] == ["M1", "M2"]
    assert [c["text"] for c in clauses] == ["alpha beta.", "gamma."]


def test_parse_machine_clauses_is_inactive_without_a_marker():
    assert parse_machine_clauses("`f(1)` returns 2.") == ([], None)
    # A marker glued to a word or a literal, or not followed by whitespace,
    # is not a clause marker.
    assert parse_machine_clauses("the `M1.5` build, xM2. y") == ([], None)


def test_parse_machine_clauses_names_a_broken_numbering():
    _, err = parse_machine_clauses("M1. a. M3. b.")
    assert err == "M1, M3"
    _, err = parse_machine_clauses("M2. a. M1. b.")
    assert err == "M2, M1"


def test_parse_proof_legs_splits_on_sequential_labels_only():
    legs = parse_proof_legs(
        "- Test: `tests/t.py`\n"
        "- Legs: (a) one [M1]; (b) as (a) but two [M2, M3]; (c) three [M1][M2].")
    assert [l["label"] for l in legs] == ["(a)", "(b)", "(c)"]
    assert legs[1]["text"] == "as (a) but two [M2, M3];"
    assert [l["cites"] for l in legs] == [["M1"], ["M2", "M3"], ["M1", "M2"]]


def test_parse_proof_legs_falls_back_to_bullets_then_prose():
    legs = parse_proof_legs(
        "- Test: `tests/t.py`\n- first leg [M1]\n  wraps here [M2]\n- second\n"
        "```python\nassert x  # [M9] in a fence is not a citation\n```")
    assert [(l["label"], l["cites"]) for l in legs] == \
        [("#1", ["M1", "M2"]), ("#2", [])]
    assert parse_proof_legs("- Test: `tests/t.py`\nprose only [M1]") == \
        [{"label": "#1", "text": "prose only [M1]", "cites": ["M1"]}]
    assert parse_proof_legs("- Test: `tests/t.py`\n```\ncode\n```") == []


# ---------------------------------------------------------------------------
# The grammar through the compiler: inactive by default, refusals when active
# ---------------------------------------------------------------------------

def test_an_unnumbered_plan_compiles_as_before_and_draws_one_advisory(tmp_path):
    plan = _sign(_write(tmp_path, _plan()))
    _compile(plan)
    rc, lines = _check_lines(plan)
    assert rc == 0
    assert [l for l in lines if "numbered clauses" in l] == [
        "ADVISORY grammar: Machine line carries no numbered clauses — task 1; "
        "write it `M1. … M2. …` so every Proof leg can cite the clause it "
        "establishes (`[M1]`)"]
    claims = parse_claims_body(_body(_plan()), "1")
    assert claims["machine_clauses"] == [] and claims["violations"] == []


def test_a_numbered_plan_with_every_clause_cited_compiles(tmp_path):
    plan = _sign(_write(tmp_path, _numbered_plan()))
    out = _compile(plan)
    assert out["waves"] == [["1"]]
    rc, lines = _check_lines(plan)
    assert rc == 0, lines
    assert not [l for l in lines if "numbered clauses" in l]
    claims = parse_claims_body(_body(_numbered_plan()), "1")
    assert [c["id"] for c in claims["machine_clauses"]] == ["M1", "M2"]
    assert [l["cites"] for l in claims["proof_legs"]] == [["M1"], ["M2"]]


def test_an_uncited_clause_is_refused(tmp_path):
    proof = ("**Proof:**\n- Test: `tests/test_widget.py`\n"
             "- Legs: (a) `make_widget(3).size == 3` [M1].")
    _refuses(tmp_path, _numbered_plan(proof=proof),
             "grammar: Machine clause M2 has no citing Proof leg — task 1: "
             "`make_widget(0)` raises `ValueError`.")


def test_a_leg_citing_nothing_is_refused(tmp_path):
    proof = ("**Proof:**\n- Test: `tests/test_widget.py`\n"
             "- Legs: (a) `make_widget(3).size == 3` [M1, M2]; "
             "(b) the module imports cleanly.")
    _refuses(tmp_path, _numbered_plan(proof=proof),
             "grammar: Proof leg cites no Machine clause — task 1, leg (b): "
             "the module imports cleanly.")


def test_a_citation_of_an_unknown_clause_is_refused(tmp_path):
    proof = ("**Proof:**\n- Test: `tests/test_widget.py`\n"
             "- Legs: (a) `make_widget(3).size == 3` [M1]; "
             "(b) `make_widget(0)` raises [M2]; (c) also [M7].")
    _refuses(tmp_path, _numbered_plan(proof=proof),
             "grammar: Proof leg cites an unknown clause — task 1, leg (c) "
             "cites M7; the Machine line numbers M1–M2")


def test_a_broken_numbering_is_refused(tmp_path):
    claim = NUMBERED_CLAIM.replace("M2.", "M3.")
    proof = CITED_PROOF.replace("[M2]", "[M3]")
    _refuses(tmp_path, _numbered_plan(claim=claim, proof=proof),
             "grammar: Machine clauses must be numbered M1, M2, … "
             "consecutively — task 1: found M1, M3")


def test_a_citation_inside_a_fence_or_a_test_bullet_does_not_count(tmp_path):
    proof = ("**Proof:**\n- Test: `tests/test_widget.py` [M1] [M2]\n"
             "```python\nassert make_widget(3).size == 3  # [M1] [M2]\n```")
    _refuses(tmp_path, _numbered_plan(proof=proof),
             "grammar: Machine clause M1 has no citing Proof leg — task 1")


def test_the_citation_refusals_are_scoped_to_claims_v1(tmp_path):
    from test_compile_plan_claims import LEGACY_PLAN
    legacy = LEGACY_PLAN.replace(
        "- [ ] **Step 2: Implement** it.",
        "- [ ] **Step 2: Implement** it.\nMachine: M1. a. M2. b.\n"
        "Legs: (a) only one [M1].")
    plan = _write(tmp_path, legacy)
    _compile(plan)
    rc, lines = _check_lines(plan)
    assert rc == 0 and not [l for l in lines if "clause" in l]


# ---------------------------------------------------------------------------
# The judgment species are advisories, never refusals
# ---------------------------------------------------------------------------

def _clauses(machine):
    return parse_machine_clauses(machine)[0]


def test_a_universal_clause_without_a_falsifying_leg_is_an_advisory():
    clauses = _clauses("M1. every wave entry carries `testCmd`.")
    legs = parse_proof_legs("- Legs: (a) the first entry carries it [M1].")
    assert clause_citation_advisories("1", clauses, legs) == [
        "ADVISORY grammar: universal clause M1 has no falsifying leg — task 1: "
        "every wave entry carries `testCmd`.; a citing leg should name what "
        "fails, is absent, or is exactly so"]
    legs = parse_proof_legs(
        "- Legs: (a) each entry carries it, and an entry with a `docs/` path "
        "fails with `testCmd: None` [M1].")
    assert clause_citation_advisories("1", clauses, legs) == []


def test_a_negation_clause_without_a_falsifying_leg_is_an_advisory():
    clauses = _clauses("M1. the RUNBOOK issues `-n auto` nowhere on the "
                       "orchestrator, without exception.")
    legs = parse_proof_legs("- Legs: (a) the section mentions pytest [M1].")
    lines = clause_citation_advisories("1", clauses, legs)
    assert len(lines) == 1 and lines[0].startswith(
        "ADVISORY grammar: negation clause M1 has no falsifying leg — task 1:")
    legs = parse_proof_legs(
        "- Legs: (a) no §Orchestrator line contains `-n auto` [M1].")
    assert clause_citation_advisories("1", clauses, legs) == []


def test_an_enumerated_clause_with_one_citing_leg_is_an_advisory():
    clauses = _clauses("M1. for each of `node` and `pytest` the probe runs "
                       "`--version` exactly once.")
    legs = parse_proof_legs("- Legs: (a) node runs exactly once [M1].")
    assert clause_citation_advisories("1", clauses, legs) == [
        "ADVISORY grammar: enumerated clause M1 is cited by 1 leg — task 1: "
        "for each of `node` and `pytest` the probe runs `--version` exactly "
        "once.; each enumerated row needs its own leg"]
    legs = parse_proof_legs("- Legs: (a) node runs exactly once [M1]; "
                            "(b) pytest runs exactly once [M1].")
    assert clause_citation_advisories("1", clauses, legs) == []


def test_the_advisories_ride_check_and_never_refuse(tmp_path):
    claim = ("**Claim:** An operator can ask for a widget of a given size and "
             "get one. (quoted from #489)\n"
             "Machine: M1. every call to `make_widget` returns a `Widget`.")
    proof = ("**Proof:**\n- Test: `tests/test_widget.py`\n"
             "- Legs: (a) `make_widget(3)` returns a `Widget` [M1].")
    plan = _sign(_write(tmp_path, _numbered_plan(claim=claim, proof=proof)))
    _compile(plan)
    rc, lines = _check_lines(plan)
    assert rc == 0
    assert [l for l in lines if "falsifying leg" in l] == [
        "ADVISORY grammar: universal clause M1 has no falsifying leg — task 1: "
        "every call to `make_widget` returns a `Widget`.; a citing leg should "
        "name what fails, is absent, or is exactly so"]


# ---------------------------------------------------------------------------
# The committed corpus: every claims-v1 plan on disk predates #554, is
# unnumbered, and must still compile unchanged.
# ---------------------------------------------------------------------------

def test_every_committed_claims_plan_still_compiles():
    import subprocess
    plans = sorted((ROOT / "docs/superpowers/plans").glob("*.md"))
    checked = 0
    for plan in plans:
        if "**Grammar:** claims-v1" not in plan.read_text():
            continue
        r = subprocess.run([sys.executable, str(ROOT / "skills/ultrapowers/"
                            "scripts/compile_plan.py"), str(plan)],
                           capture_output=True, text=True)
        assert r.returncode == 0, "%s: %s" % (plan.name, r.stderr[-400:])
        checked += 1
    assert checked >= 4
