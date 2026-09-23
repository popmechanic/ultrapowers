"""The authoring record: one AUTHORING fact line, and a refusal when it is
malformed (#988 desired state 1).

The record sits at the top level of `<plan-stem>.gate-verdicts.json` beside
`tasks` and `tally`, and it is the one literal every task of this plan shares:

    {"authoring": {"minutes": 118, "probes": 12,
                   "routing": {"branch": "risk", "lane": "ultrapowers"},
                   "questions": [{"question": "Claim and summary",
                                  "options": ["A", "B"],
                                  "recommended": "A", "picked": "A"}]}}

Three clauses, one exam:

  * M1 — under `--check --base <sha>`, a well-formed record prints, after the
    verdict line, exactly one `AUTHORING fact:` line carrying the sitting's
    minutes, hub probes, the `tally`'s dispatches and rejections (`-` for an
    absent key), the routing branch and lane, and the question counts; the
    compile still exits 0 with `PLAN OK`.
  * M2 — a record with no `authoring` key prints `AUTHORING fact: none
    recorded` under the same flags, and a bare `--check` of either record
    prints no `AUTHORING fact:` line at all.
  * M3 — a malformed `authoring` object is refused at `--check`: exit 2, no
    `PLAN OK`, one `grammar: authoring record unreadable —` line naming the
    offending field.

Every plan below is a real claims-v1 plan written to a temp directory and
compiled by a subprocess, its gate verdicts hashed by the gate's own extractor,
so nothing here reaches into the compiler's internals. The `--base` legs put
that plan inside a one-commit git repository, because a 40-hex `--base` is
resolved in the plan's own toplevel.
"""
import copy
import json
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/plan_check.py"

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402

# --------------------------------------------------------------------------- #
# The plan. One claims-v1 task carrying the fixed grammar the compiler         #
# requires — the header, the six body slots, a numbered Machine clause, a      #
# cited leg, a provenance tag, a predicate Stale-if whose path is absent from  #
# the temp repository, so no plan below is refused for anything but its        #
# record.                                                                      #
# --------------------------------------------------------------------------- #

PLAN = """# Authoring record probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator compiling this plan is told what the sitting cost. (elicited)

### Task 1: The sim

**Type:** implementation

**Files:**
- Modify: `fleet/tests/sim_probe.mjs`

**Claim:** An operator running the sim sees it pass. (derived)
Machine: M1. The sim prints `PASSED`.

**Authorized-by:** #988

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The sim is a standalone script with no registry to update.

**Proof:**
- The suite asserts the sim prints `PASSED`. [M1]

**Stale-if:**
- path-exists: `fleet/tests/sim_probe.mjs`
"""

# The Context's example record, verbatim, and the `tally` it is read beside.
AUTHORING = {
    "minutes": 118,
    "probes": 12,
    "routing": {"branch": "risk", "lane": "ultrapowers"},
    "questions": [{"question": "Claim and summary", "options": ["A", "B"],
                   "recommended": "A", "picked": "A"}],
}
TALLY = {"dispatched": 4, "rejected": 1}

# M1's line for that pair, exactly as the Context writes it.
EXAMPLE_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                "4 gate dispatches, 1 rejected, routing risk->ultrapowers, "
                "1 questions, 1/1 recommended picked, 0 explain rounds")
# M2's line for a record with no `authoring` key.
NONE_LINE = "AUTHORING fact: none recorded"
# M3's refusal prefix.
UNREADABLE = "grammar: authoring record unreadable — "

FACT_PREFIX = "AUTHORING fact:"


def record(authoring=..., tally=TALLY):
    """The gate-verdict record minus its `tasks` key (which is hashed per
    plan). `authoring` omitted entirely when passed as None."""
    rec = {}
    if tally is not None:
        rec["tally"] = copy.deepcopy(tally)
    if authoring is ...:
        authoring = AUTHORING
    if authoring is not None:
        rec["authoring"] = copy.deepcopy(authoring)
    return rec


def write_plan(dirpath, name, rec):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest."""
    plan = dirpath / name
    plan.write_text(PLAN)
    entry = gate_input(plan, "1")
    full = dict(rec)
    full["tasks"] = {"1": {"hash": entry["hash"], "verdict": "pass",
                           "reason": "fixture"}}
    verdicts_path(plan).write_text(json.dumps(full))
    return plan


def run_compiler(plan, *flags):
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True)


def check(dirpath, name, rec, *flags):
    return run_compiler(write_plan(dirpath, name, rec), *flags)


def fact_lines(stdout):
    """Every line beginning `AUTHORING fact:` — the thing M1 and M2 count."""
    return [line for line in stdout.splitlines()
            if line.startswith(FACT_PREFIX)]


def carrying_lines(stdout):
    """Every line mentioning the fact prefix anywhere, so leg (d)'s "zero
    lines containing `AUTHORING fact:`" is read as written."""
    return [line for line in stdout.splitlines() if FACT_PREFIX in line]


def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, " ".join(args) + "\n" + p.stdout + p.stderr
    return p.stdout


def base_repo(tmp_path):
    """A one-commit git repository holding `present.py` and nothing else,
    returned as (repo path, HEAD sha). The plan is written inside it, so a
    40-hex `--base` names a commit of the plan's own repository."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", ".")
    _git(repo, "config", "user.email", "exam@example.invalid")
    _git(repo, "config", "user.name", "exam")
    (repo / "present.py").write_text("print(1)\n")
    _git(repo, "add", "present.py")
    _git(repo, "commit", "-qm", "present")
    head = _git(repo, "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head), head
    return repo, head


def assert_one_fact_after_the_verdict(p, expected):
    """[M1]/[M2]: exit 0, `PLAN OK` as the first stdout line, and exactly one
    `AUTHORING fact:` line — equal to `expected` in full, and printed after
    the verdict line."""
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], out
    lines = p.stdout.splitlines()
    assert fact_lines(p.stdout) == [expected], out
    assert lines.index(expected) > lines.index("PLAN OK"), out


# ── (a) M1: the well-formed record prints the Context's example line ────────
# "a claims-v1 plan whose `<stem>.gate-verdicts.json` carries a well-formed
# top-level `authoring` object prints, after the verdict line, exactly one line
# of the form `AUTHORING fact: <minutes> min to PLAN OK, <probes> hub probes,
# <dispatched> gate dispatches, <rejected> rejected, routing <branch>-><lane>,
# <n> questions, <p>/<q> recommended picked, <e> explain rounds` ... and the
# compile still exits 0 with `PLAN OK`."

def test_a_the_example_record_prints_the_example_line(tmp_path):
    """(a)/[M1]: the Context's example `authoring` object beside a `tally` of
    dispatched 4 / rejected 1, compiled `--check --base <head>` inside a
    one-commit repository — exit 0, `PLAN OK` first, and exactly one
    `AUTHORING fact:` line, the Context's example line verbatim."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "a.md", record(), "--base", head)
    assert_one_fact_after_the_verdict(p, EXAMPLE_LINE)


# ── (b) M1: the tally's absent key, and the question counts ─────────────────
# "`<dispatched>` and `<rejected>` read from the record's `tally` (`-` when the
# key is absent), `<n>` the length of `questions`, `<q>` the count of questions
# whose `recommended` is not null and `<p>` the count of those whose `picked`
# equals `recommended`."

REJECTED_ABSENT_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                        "4 gate dispatches, - rejected, "
                        "routing risk->ultrapowers, "
                        "1 questions, 1/1 recommended picked, "
                        "0 explain rounds")

# One question carrying no recommended option, one whose pick is the
# recommendation: two questions, one of them recommended, that one picked.
TWO_QUESTIONS = [
    {"question": "Claim and summary", "options": ["A", "B"],
     "recommended": None, "picked": "B", "explain_rounds": 2},
    {"question": "Routing", "options": ["A", "B"],
     "recommended": "A", "picked": "A"},
]
TWO_QUESTIONS_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                      "4 gate dispatches, 1 rejected, "
                      "routing risk->ultrapowers, "
                      "2 questions, 1/1 recommended picked, "
                      "2 explain rounds")


def test_b_a_tally_without_rejected_prints_a_dash(tmp_path):
    """(b)/[M1]: the same record with `tally` lacking `rejected` — the line is
    the example line with `- rejected` in place of `1 rejected`."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "b1.md", record(tally={"dispatched": 4}), "--base", head)
    assert_one_fact_after_the_verdict(p, REJECTED_ABSENT_LINE)


def test_b_two_questions_count_only_the_recommended_ones(tmp_path):
    """(b)/[M1]: two questions, one with `recommended` null and one picked
    equal to its recommendation — `2 questions, 1/1 recommended picked`."""
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = TWO_QUESTIONS
    p = check(repo, "b2.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(p, TWO_QUESTIONS_LINE)


def test_b_a_multi_select_question_is_one_row(tmp_path):
    """#1189: `picked` may be a list for a multi-select question — one row, one
    question, counted as recommended-picked when the recommendation is among
    the picks; a pick outside `options` is still refused."""
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = [{"question": "which features", "options":
                               ["rename", "sort", "tags", "none"],
                               "recommended": "sort",
                               "picked": ["rename", "sort"]}]
    p = check(repo, "b3.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(
        p, EXAMPLE_LINE)  # 1 questions, 1/1 recommended picked
    authoring["questions"][0]["picked"] = ["rename", "nope"]
    p = check(repo, "b4.md", record(authoring=authoring))
    assert p.returncode == 2 and "questions[0].picked" in p.stdout


# ── (c) M2: no record, one `none recorded` line ─────────────────────────────
# "The same `--check --base <sha>` compile of a record with no `authoring` key
# exits 0 with `PLAN OK` and prints exactly one line `AUTHORING fact: none
# recorded` after the verdict."

def test_c_a_record_with_no_authoring_key_says_none_recorded(tmp_path):
    """(c)/[M2]: the same plan, the same tally, no `authoring` key — exit 0,
    `PLAN OK`, and exactly one `AUTHORING fact: none recorded` line."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "c.md", record(authoring=None), "--base", head)
    assert_one_fact_after_the_verdict(p, NONE_LINE)


# ── (d) M2: a bare `--check` prints no fact line at all ─────────────────────
# "a bare `--check` of either record prints no line beginning `AUTHORING
# fact:` at all."

@pytest.mark.parametrize("label,authoring", [
    ("with the authoring key", AUTHORING),
    ("without the authoring key", None),
])
def test_d_a_bare_check_prints_no_fact_line(tmp_path, label, authoring):
    """(d)/[M2]: with no `--base` there is no tree to cost a sitting against —
    zero lines containing `AUTHORING fact:`, either way. And the bare verdict
    is the unchanged one the global constraint pins: stdout is `PLAN OK` and
    nothing else."""
    p = check(tmp_path, "d.md", record(authoring=authoring))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert carrying_lines(p.stdout) == [], out
    assert carrying_lines(p.stderr) == [], out
    assert p.stdout.strip() == "PLAN OK", out


# ── (e) M3: a malformed record is refused, naming the field ─────────────────
# "A record whose `authoring` object is malformed is refused at `--check` —
# exit 2, no `PLAN OK` — with one violation line beginning `grammar: authoring
# record unreadable —` that names the offending field, for each of: `minutes`
# not a non-negative integer; `probes` not a non-negative integer;
# `routing.branch` outside `risk`, `width`, `inline`, `subagent`;
# `routing.lane` outside `ultrapowers`, `subagent`, `inline`; a question whose
# `options` has fewer than 2 entries; a question whose `picked` is not one of
# its `options`; a question whose `recommended` is neither null nor one of its
# `options`."


def _with(**fields):
    """The example record with top-level fields replaced."""
    a = copy.deepcopy(AUTHORING)
    a.update(fields)
    return a


def _routing(**fields):
    a = copy.deepcopy(AUTHORING)
    a["routing"].update(fields)
    return a


def _question(**fields):
    a = copy.deepcopy(AUTHORING)
    a["questions"][0].update(fields)
    return a


# Each row carries exactly one defect, so the one line the clause promises is
# the line about that row's field and nothing else.
MALFORMED = [
    ("minutes -1", _with(minutes=-1), "minutes"),
    ('minutes "12"', _with(minutes="12"), "minutes"),
    ("probes -1", _with(probes=-1), "probes"),
    ('branch "speed"', _routing(branch="speed"), "branch"),
    ('lane "fleet"', _routing(lane="fleet"), "lane"),
    ('options ["only"]', _question(options=["only"], recommended="only",
                                   picked="only"), "options"),
    ('picked "C"', _question(picked="C"), "picked"),
    ('recommended "C"', _question(recommended="C"), "recommended"),
    ("explain_rounds -1", _question(explain_rounds=-1),
     "questions[0].explain_rounds"),
]


@pytest.mark.parametrize("row,authoring,field", MALFORMED,
                         ids=[r[0] for r in MALFORMED])
def test_e_a_malformed_record_is_refused_naming_the_field(tmp_path, row,
                                                          authoring, field):
    """(e)/[M3]: each malformed row, at a bare `--check` — exit 2, no
    `PLAN OK`, and exactly one line beginning `grammar: authoring record
    unreadable —`, naming the field the row broke."""
    p = check(tmp_path, "e.md", record(authoring=authoring))
    out = p.stdout + p.stderr
    assert p.returncode == 2, (row, out)
    assert "PLAN OK" not in out, (row, out)
    named = [line for line in out.splitlines()
             if line.startswith(UNREADABLE)]
    assert len(named) == 1, (row, out)
    assert field in named[0], (row, named[0])


def test_e_the_same_record_made_well_formed_is_not_refused(tmp_path):
    """(e)/[M3]: the refusal is the malformation and nothing else about the
    record — the example record, unbroken, still prints `PLAN OK` at a bare
    `--check` and earns no `unreadable` line."""
    p = check(tmp_path, "e-ok.md", record())
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.strip() == "PLAN OK", out
    assert UNREADABLE not in out, out


# ── extractor-and-authoring-refusals task 2 (#1029): a refused record prints
# its violation on the fact line, never `none recorded` ──────────────────────

REFUSED_PREFIX = "AUTHORING fact: refused — "


def _no_routing():
    a = copy.deepcopy(AUTHORING)
    del a["routing"]
    return a


def _no_picked():
    a = copy.deepcopy(AUTHORING)
    del a["questions"][0]["picked"]
    return a


def _rule_of(grammar_line, name):
    """The `<key>: <rule>` text after the backticked file name on a
    `grammar: authoring record unreadable —` line."""
    head = UNREADABLE + "`" + name + "`: "
    assert grammar_line.startswith(head), grammar_line
    return grammar_line[len(head):]


ONE_DEFECT = [
    ("minutes null", _with(minutes=None), "minutes:"),
    ("routing absent", _no_routing(), "routing:"),
    ("picked absent", _no_picked(), "questions[0].picked:"),
]


@pytest.mark.parametrize("row,authoring,key", ONE_DEFECT,
                         ids=[r[0] for r in ONE_DEFECT])
def test_f_m1_a_refused_record_prints_its_violation_on_the_fact_line(
        tmp_path, row, authoring, key):
    """(a) [M1] and (d) [M3]: under `--check --base <head>`, exactly one
    `AUTHORING fact: refused — ` line, equal to the `<key>: <rule>` of the one
    `grammar:` line, beginning with the row's key; no `none recorded`; still
    exit 2, no `PLAN OK`; and a bare `--check` prints no fact line at all."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "f.md", record(authoring=authoring), "--base", head)
    out = p.stdout + p.stderr
    assert p.returncode == 2, (row, out)
    assert "PLAN OK" not in out, (row, out)
    grammar = [l for l in out.splitlines() if l.startswith(UNREADABLE)]
    assert len(grammar) == 1, (row, out)
    refused = [l for l in p.stdout.splitlines() if l.startswith(REFUSED_PREFIX)]
    assert len(refused) == 1, (row, out)
    rule = refused[0][len(REFUSED_PREFIX):]
    assert rule == _rule_of(grammar[0], "f.gate-verdicts.json"), (row, out)
    assert rule.startswith(key), (row, rule)
    assert NONE_LINE not in p.stdout.splitlines(), (row, out)
    bare = check(repo, "f-bare.md", record(authoring=authoring))
    assert carrying_lines(bare.stdout + bare.stderr) == [], bare.stdout + bare.stderr


def test_f_m1_two_defects_print_two_refused_lines(tmp_path):
    """(b) [M1]: `minutes` null and `routing` absent — exactly two
    `refused` lines, one per key, and no `none recorded`."""
    repo, head = base_repo(tmp_path)
    a = _with(minutes=None)
    del a["routing"]
    p = check(repo, "f2.md", record(authoring=a), "--base", head)
    refused = [l[len(REFUSED_PREFIX):] for l in p.stdout.splitlines()
               if l.startswith(REFUSED_PREFIX)]
    assert len(refused) == 2, p.stdout + p.stderr
    assert sorted(r.split(":")[0] for r in refused) == ["minutes", "routing"], refused
    assert NONE_LINE not in p.stdout.splitlines(), p.stdout


def test_f_m4_the_runbook_names_the_refused_shape():
    """(e) [M4]: the RUNBOOK's Per run section names the refused line beside
    the cost and none-recorded lines, in the launcher's order."""
    text = (pathlib.Path(__file__).resolve().parents[1] / "fleet" / "RUNBOOK.md").read_text()
    start = text.index("## Per run")
    end = text.index("## States")
    flat = " ".join(text[start:end].splitlines())
    assert re.search(r"AUTHORING fact: refused.*key.*rule", flat)
    assert re.search(r"BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line", flat)
