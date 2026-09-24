"""The claims-v1 parser: `skills/ultrapowers/scripts/plan_parse.py`.

`plan_parse.py` reduces a claims-v1 plan to the nine fields the engine needs
(`tasks`, `dag_edges`, `launch_waves`) without ever touching the sibling
`<stem>.gate-verdicts.json` `plan_check.py` reads (and the old compiler required).
This exam never imports the module under test — it is a script invoked as
`python3 skills/ultrapowers/scripts/plan_parse.py <plan.md>` — so every
assertion below runs it as a subprocess and reads stdout/stderr/the exit
code, exactly as `factory/engine.mjs` would.

Every assertion is tagged with the Machine clause (M1-M6) it proves.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "skills/ultrapowers/scripts/plan_parse.py"

# The three claims-v1 fixtures that carry a `.gate-verdicts.json` record
# beside them — the old compiler's oracle set for M6.
RECORD_FIXTURES = [
    ROOT / "evals/fixtures/claims/plan.md",
    ROOT / "tests/fixtures/plans/2026-09-01-511-attempt-racing.md",
    ROOT / "tests/fixtures/plans/2026-09-02-papercut-drain-2.md",
]

# The six claims-v1 fixtures under tests/fixtures/plans/ that carry NO
# verdict record — the old compiler refuses every one of them on that
# ground alone.
RECORDLESS_FIXTURES = sorted(
    (ROOT / "tests/fixtures/plans/2026-09-07").glob("*.md"))

# Every field a task object prints (M1): a `- Test:`/`- Guard:` bullet or an
# `**Exam command:**` header adds no field here -- cut three (2026-09-22)
# retired the examiner they fed, and `plan_check.py` refuses a plan that
# still carries one instead.
TASK_FIELDS = {"id", "title", "files", "depends_on", "proofRuns",
               "proofRunClauses", "interfaces"}


# --------------------------------------------------------------------------- #
# Subprocess helpers.                                                         #
# --------------------------------------------------------------------------- #

def run_parser(plan_path):
    return subprocess.run([sys.executable, str(PARSER), str(plan_path)],
                          capture_output=True, text=True)


def parse_stdout_json(stdout):
    """The one JSON object `plan_parse.py` prints on stdout (M1): parsing
    fails loudly if stdout carries anything besides that one value."""
    text = stdout.strip()
    obj, end = json.JSONDecoder().raw_decode(text)
    assert end == len(text), (
        "stdout carries more than one JSON value: %r" % (text,))
    return obj


def build_and_run(tmp_path, tasks, **plan_kwargs):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks, **plan_kwargs))
    proc = run_parser(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return parse_stdout_json(proc.stdout)


# --------------------------------------------------------------------------- #
# Minimal claims-v1 plan/task builders. Every task carries the full six-slot  #
# body (Claim, Authorized-by, Interfaces, Context, Proof, Stale-if) so a      #
# parser reading the grammar's whole shape never trips on an absent slot —   #
# only the fields the Machine clauses examine are varied per test.           #
# --------------------------------------------------------------------------- #

def make_header(title="Exam fixture plan", exam_command=None, bootstrap=None,
                checks=()):
    lines = [f"# {title}", "",
             "**Grammar:** claims-v1", "",
             "**Claim:** An operator sees the placeholder claim proved. (elicited)", "",
             "**Summary:** Placeholder summary for an exam fixture.", "",
             "**Goal:** Placeholder goal for an exam fixture.", "",
             "**Tech Stack:** N/A (exam fixture, never executed).", ""]
    if exam_command:
        lines += [f"**Exam command:** {exam_command}", ""]
    if bootstrap:
        lines += [f"**Bootstrap:** {bootstrap}", ""]
    lines += ["## Global Constraints", ""]
    if checks:
        lines += [f"- Check: {c}" for c in checks] + [""]
    else:
        lines += ["- None.", ""]
    return "\n".join(lines)


def make_plan(tasks, exam_command=None, title="Exam fixture plan",
              bootstrap=None, checks=()):
    return (make_header(title=title, exam_command=exam_command,
                        bootstrap=bootstrap, checks=checks)
            + "\n" + "\n\n".join(tasks) + "\n")


def task_block(task_id, title, *, ttype="implementation",
               creates=(), modifies=(), deletes=(), tests=(),
               consumes=(), produces=(), run_cmds=(), guards=(), legs=None):
    lines = [f"### Task {task_id}: {title}", ""]
    if ttype is not None:
        lines += [f"**Type:** {ttype}", ""]
    file_lines = ([f"- Create: `{p}`" for p in creates]
                  + [f"- Modify: `{p}`" for p in modifies]
                  + [f"- Delete: `{p}`" for p in deletes]
                  + [f"- Test: `{p}`" for p in tests])
    if not file_lines:
        file_lines = [f"- Modify: `unused/{task_id}-files.marker`"]
    lines += ["**Files:**"] + file_lines + [""]
    lines += [f"**Claim:** Placeholder claim sentence for task {task_id}. (elicited)",
              f"Machine: placeholder machine restatement for task {task_id}.", ""]
    lines += ["**Authorized-by:** #1", ""]
    consumes_lines = list(consumes) or ["none"]
    produces_lines = list(produces) or ["none"]
    lines += (["**Interfaces:**"]
              + [f"- Consumes: {c}" for c in consumes_lines]
              + [f"- Produces: {p}" for p in produces_lines]
              + [""])
    lines += [f"**Context:** Placeholder context prose for task {task_id}.", ""]
    proof_lines = ([f"- Test: `{p}`" for p in tests]
                   + [f"- Run: {c}" for c in run_cmds]
                   + [f"- Guard: `{p}`" for p in guards])
    if legs is not None:
        proof_lines.append(f"- Legs: {legs}")
    if not proof_lines:
        proof_lines = [f"- Guard: `unused/{task_id}-guard.marker`"]
    lines += ["**Proof:**"] + proof_lines + [""]
    lines += ["**Stale-if:**", f"- path-exists: `unused/{task_id}.marker`"]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# M1 — stdout shape, exit 0, indifferent to the sibling verdict record.       #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("plan_path", RECORD_FIXTURES, ids=lambda p: p.stem)
def test_m1_stdout_shape_with_and_without_verdict_record(plan_path, tmp_path):
    verdict_path = plan_path.with_name(plan_path.stem + ".gate-verdicts.json")
    assert verdict_path.exists(), "fixture setup: expected a sibling verdict record"

    # The record present, beside the fixture in its own directory.
    proc_with = run_parser(plan_path)
    assert proc_with.returncode == 0, proc_with.stdout + proc_with.stderr  # [M1]
    obj_with = parse_stdout_json(proc_with.stdout)
    # Pin extended to the fourth top-level key, `pairs`, by "The parser
    # lists every pair of tasks that share a file or an interface", and to
    # the fifth and sixth, `checks` and `bootstrapCmd`, by this task. [M1] [pairs-M1] [cmds-M2]
    assert set(obj_with.keys()) == {"tasks", "dag_edges", "launch_waves",
                                    "pairs", "checks", "bootstrapCmd", "publish"}

    # A copy of the fixture alone in tmp_path, with no sibling file at all.
    tmp_plan = tmp_path / plan_path.name
    tmp_plan.write_text(plan_path.read_text())
    proc_without = run_parser(tmp_plan)
    assert proc_without.returncode == 0, proc_without.stdout + proc_without.stderr  # [M1]
    obj_without = parse_stdout_json(proc_without.stdout)
    assert set(obj_without.keys()) == {"tasks", "dag_edges", "launch_waves",
                                       "pairs", "checks", "bootstrapCmd", "publish"}  # [M1] [pairs-M1] [cmds-M2]

    # Reading no file but the plan: the answer does not change when the
    # sibling verdict record vanishes. [M1]
    assert obj_with == obj_without


# --------------------------------------------------------------------------- #
# M2 — task/wave entry shape and field derivation.                            #
# --------------------------------------------------------------------------- #

def test_m2_task_and_wave_shape_on_widget_plan():
    plan_path = ROOT / "evals/fixtures/claims/plan.md"
    proc = run_parser(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    obj = parse_stdout_json(proc.stdout)

    expected = {
        "1": dict(
            title="The widget constructor",
            files=["widgetkit/widget.py"],
            interfaces={"consumes": ["nothing (first task)"],
                        "produces": ["`make_widget(n: int) -> Widget`"]}),
        "2": dict(
            title="The widget catalog",
            files=["widgetkit/catalog.py"],
            interfaces={"consumes": ["`make_widget(n: int) -> Widget`"],
                        "produces": ["`catalog(sizes: list[int]) -> list[Widget]`"]}),
        "3": dict(
            title="Size formatting",
            files=["widgetkit/format.py"],
            interfaces={"consumes": ["nothing"],
                        "produces": ["`format_size(n: int) -> str`"]}),
    }

    assert [t["id"] for t in obj["tasks"]] == ["1", "2", "3"]  # [M2]
    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS  # [M2]
        assert isinstance(t["id"], str)  # [M2]
        assert t["depends_on"] == []  # [M2]
        exp = expected[t["id"]]
        assert t["title"] == exp["title"]  # [M2]
        # A task's `files` is `Create:` and `Modify:` paths only -- its own
        # `- Test:` bullet adds no path (cut three, 2026-09-22). [M2]
        assert t["files"] == exp["files"]  # [M2]
        assert t["files"] == sorted(t["files"])  # [M2]
        assert t["interfaces"] == exp["interfaces"]  # [M2]

    for wave in obj["launch_waves"]:
        for t in wave:
            assert set(t.keys()) == TASK_FIELDS  # [M2]


def test_m2_test_bullet_and_exam_command_add_no_field_or_path(tmp_path):
    # A task built with `tests=[...]` under both Files and Proof, and an
    # `**Exam command:**` template declared at the header -- cut three
    # (2026-09-22) retired the examiner both fed. [M2]
    tasks = [task_block("1", "Vitest task", creates=["src/a.ts"],
                        tests=["tests/a.test.ts", "tests/b.test.ts"])]
    obj = build_and_run(tmp_path, tasks, exam_command="npx vitest run {paths}")
    t = obj["tasks"][0]
    assert "testCmd" not in t  # [M2]
    assert "proofTests" not in t  # [M2]
    assert "testCmds" not in t  # [M2]
    # The Test: bullet's path never joins `files`. [M2]
    assert t["files"] == ["src/a.ts"]


def test_m2_gate_release_manual_excluded_absent_type_included(tmp_path):
    tasks = [
        task_block("1", "Explicit implementation", creates=["m2/impl.py"]),
        task_block("2", "No Type marker at all", ttype=None,
                   creates=["m2/nomarker.py"]),
        task_block("3", "Gate task", ttype="gate", creates=["m2/gate.txt"]),
        task_block("4", "Release task", ttype="release",
                   creates=["m2/release.txt"]),
        task_block("5", "Manual task", ttype="manual",
                   creates=["m2/manual.txt"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # implementation-or-absent tasks are in; gate/release/manual are in
    # neither list. [M2]
    assert [t["id"] for t in obj["tasks"]] == ["1", "2"]
    wave_ids = {t["id"] for wave in obj["launch_waves"] for t in wave}
    assert wave_ids == {"1", "2"}  # [M2]


# --------------------------------------------------------------------------- #
# M3 — the Interfaces-bullet token rule.                                      #
# --------------------------------------------------------------------------- #

INTERFACE_TOKEN_CASES = [
    pytest.param("`catalog(sizes: list[int]) -> list[Widget]`", "catalog",
                 True, id="backtick-signature-cut-at-paren"),
    pytest.param("`export async function runWorker(opts)`", "runWorker",
                 True, id="decl-keywords-dropped"),
    pytest.param("`def make_widget(n)`", "make_widget",
                 True, id="def-keyword-dropped"),
    pytest.param("none", "none", False, id="none-yields-no-token"),
    pytest.param("nothing", "nothing", False, id="nothing-yields-no-token"),
    pytest.param("makeWidget", "makeWidget", True, id="bare-word-alone"),
    pytest.param("makeWidget", "makeWidget is produced by task 1", False,
                 id="bare-word-with-trailing-prose-yields-no-token"),
]


@pytest.mark.parametrize("produces_entry,consumes_entry,expect_edge",
                         INTERFACE_TOKEN_CASES)
def test_m3_interface_token_rule(tmp_path, produces_entry, consumes_entry,
                                  expect_edge):
    tasks = [
        task_block("1", "Producer", creates=["m3/p.py"],
                   produces=[produces_entry]),
        task_block("2", "Consumer", creates=["m3/c.py"],
                   consumes=[consumes_entry]),
    ]
    obj = build_and_run(tmp_path, tasks)
    pairs = {(e["from"], e["to"]) for e in obj["dag_edges"]}
    if expect_edge:
        assert ("1", "2") in pairs  # [M3]
    else:
        assert pairs == set()  # [M3]


# --------------------------------------------------------------------------- #
# M4 — the edge rule and its precedence.                                      #
# --------------------------------------------------------------------------- #

def test_m4_write_after_create_edge(tmp_path):
    tasks = [
        task_block("1", "Creator", creates=["m4/p.py"]),
        task_block("2", "Modifier", modifies=["m4/p.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]  # [M4]


def test_m4_interface_edge(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["m4/a2.py"], produces=["`f()`"]),
        task_block("2", "Consumer", creates=["m4/b2.py"], consumes=["`f()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "interface"}]  # [M4]


def test_m4_proof_run_edge(tmp_path):
    tasks = [
        task_block("1", "Owner", creates=["m4/p3.py"]),
        task_block("2", "Runner", creates=["m4/other3.py"],
                   run_cmds=["python3 m4/p3.py --x"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [M4]


def test_m4_write_after_create_wins_over_interface_for_the_pair(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/p4.py"], produces=["`g()`"]),
        task_block("2", "B", modifies=["m4/p4.py"], consumes=["`g()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # Exactly one edge for the pair; the first-firing rule (write-after-
    # create) labels it, not the interface match that also holds. [M4]
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


def test_m4_reverse_interface_dropped_when_forward_already_reachable(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/p5.py"], consumes=["`h()`"]),
        task_block("2", "B", modifies=["m4/p5.py"], produces=["`h()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # A->B by write-after-create; B produces what A consumes would draw the
    # reverse B->A by interface, but A->B already reaches B, so the reverse
    # is not added. [M4]
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


def test_m4_reverse_proof_run_dropped_when_forward_already_reachable(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/a6.py"], produces=["`k()`"],
                   run_cmds=["python3 m4/b6.py --check"]),
        task_block("2", "B", creates=["m4/b6.py"], consumes=["`k()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # A->B by interface (B consumes what A produces); A's Run: names B's own
    # file, which would draw the reverse B->A by proof-run, but A->B already
    # reaches B, so the reverse is not added. [M4]
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "interface"}]


def test_m4_shared_modify_with_no_other_relation_draws_no_edge(tmp_path):
    tasks = [
        task_block("1", "A", modifies=["m4/shared.py"]),
        task_block("2", "B", modifies=["m4/shared.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == []  # [M4]


# --------------------------------------------------------------------------- #
# import-M1..M4 -- a probe's import draws the same proof-run edge a Run:     #
# that names the sibling's file by path draws.                               #
# --------------------------------------------------------------------------- #

def test_import_python_from_import_edge(tmp_path):
    tasks = [
        task_block("1", "Fixture owner", creates=["tests/trends_fixtures.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from tests.trends_fixtures import '
                             'make_canon_fixture; make_canon_fixture()"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [import-M1]


def test_import_python_bare_import_dotted_module_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["pkg/mod.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "import pkg.mod; pkg.mod.go()"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [import-M2]


def test_import_python_from_import_package_init_edge(tmp_path):
    tasks = [
        task_block("1", "Package owner", creates=["pkg/__init__.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from pkg import x"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [import-M2]


def test_import_js_dynamic_import_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["lib/a.mjs"]),
        task_block("2", "Probe", creates=["app/x.mjs"],
                   run_cmds=["node -e \"import('./lib/a.mjs')"
                             ".then(m => m.a())\""]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [import-M3]


def test_import_js_extensionless_specifier_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["lib/b.ts"]),
        task_block("2", "Probe", creates=["app/x.mjs"],
                   run_cmds=["bun -e \"import {b} from './lib/b'; b()\""]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]  # [import-M3]


def test_import_of_module_no_sibling_creates_draws_no_edge(tmp_path):
    tasks = [
        task_block("1", "Fixture owner", creates=["tests/trends_fixtures.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from tests.absent_fixture '
                             'import make"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == []  # [import-M4]


# --------------------------------------------------------------------------- #
# M5 — Kahn layering, and the three loud refusals.                            #
# --------------------------------------------------------------------------- #

def test_m5_launch_waves_kahn_layering_in_document_order(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m5/a.py"], produces=["`z()`"]),
        task_block("2", "B", creates=["m5/b.py"], consumes=["`z()`"]),
        task_block("3", "C", creates=["m5/c.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    wave_ids = [[t["id"] for t in wave] for wave in obj["launch_waves"]]
    assert wave_ids == [["1", "3"], ["2"]]  # [M5]


def assert_is_the_scripts_own_refusal(proc):
    """A missing plan_parse.py also exits 2 with one stderr line naming the
    interpreter's own launch failure -- guard against mistaking that for a
    genuine M5 refusal, so an absent implementation reads as absent rather
    than as an accidental pass."""
    assert "No such file or directory" not in proc.stderr, (
        "stderr is the interpreter's launch failure, not the script's own "
        "refusal -- plan_parse.py is missing: " + proc.stderr)


def test_m5_refusal_no_task_heading(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_header())
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2  # [M5]
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1  # [M5]


def test_m5_refusal_duplicate_task_id(tmp_path):
    tasks = [
        task_block("1", "First", creates=["m5d/a.py"]),
        task_block("1", "Second", creates=["m5d/b.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2  # [M5]
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1  # [M5]


def test_m5_refusal_cycle_names_both_tasks(tmp_path):
    # Task ids chosen to be unlikely to appear by coincidence in an
    # unrelated error string (an interpreter launch failure, a file path).
    tasks = [
        task_block("701", "A", creates=["m5c/a.py"], modifies=["m5c/b.py"]),
        task_block("702", "B", creates=["m5c/b.py"], modifies=["m5c/a.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2  # [M5]
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1  # [M5]
    assert "701" in lines[0] and "702" in lines[0]  # [M5]


# --------------------------------------------------------------------------- #
# M6 — a plan with no verdict record still parses (the old compiler, gone at cut B, refused it). #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("plan_path", RECORDLESS_FIXTURES, ids=lambda p: p.stem)
def test_m6_parser_succeeds_without_a_verdict_record(plan_path):
    parser_proc = run_parser(plan_path)
    assert parser_proc.returncode == 0, parser_proc.stdout + parser_proc.stderr  # [M6]
    parser_obj = parse_stdout_json(parser_proc.stdout)
    assert len(parser_obj["launch_waves"]) > 0  # [M6]


def test_m6_fixture_inventory_sanity():
    """Guards the two oracle sets this file's M6 tests depend on: three
    fixtures with a verdict record, six under tests/fixtures/plans/2026-09-07
    without one -- so a drift in the fixture tree fails loudly here instead
    of silently shrinking the M6 coverage above."""
    assert len(RECORD_FIXTURES) == 3
    assert all(p.exists() for p in RECORD_FIXTURES)
    assert len(RECORDLESS_FIXTURES) == 6
    for p in RECORDLESS_FIXTURES:
        assert not p.with_name(p.stem + ".gate-verdicts.json").exists()


# --------------------------------------------------------------------------- #
# guard-M3 -- any argv that is not exactly one `<plan.md>` prints the usage   #
#             line on stderr and exits 2 -- an unrecognized flag such as     #
#             `--unguarded` included, since the parser reads none such any   #
#             more (cut three, 2026-09-22).                                  #
# --------------------------------------------------------------------------- #

def test_guard_m3_bad_argv_variants_exit_2_with_usage(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan([task_block("1", "Solo", creates=["gf/a.py"])]))

    usage_lines = []
    for argv_tail in ([], ["--unguarded", str(plan_path)],
                      ["--frobnicate", str(plan_path)]):
        proc = subprocess.run([sys.executable, str(PARSER)] + argv_tail,
                              capture_output=True, text=True)
        assert_is_the_scripts_own_refusal(proc)
        assert proc.returncode == 2, argv_tail  # [guard-M3]
        assert proc.stdout == ""  # [guard-M3]
        lines = [l for l in proc.stderr.splitlines() if l.strip()]
        assert len(lines) == 1  # [guard-M3]
        usage_lines.append(lines[0])

    # The same one usage line for every rejected shape. [guard-M3]
    assert len(set(usage_lines)) == 1


# --------------------------------------------------------------------------- #
# Task: "The parser lists every pair of tasks that share a file or an        #
# interface".                                                                #
#                                                                             #
# pairs-M1 -- a new top-level key `pairs`: one entry per unordered pair of   #
#             implementation tasks whose `files` intersect or whose         #
#             Consumes/Produces tokens match, each entry                    #
#             `{a, b, why, paths, symbol, producer, consumer}` with `a`     #
#             before `b` in document order, `why` drawn from `files` then   #
#             `interface` in that order, `paths` the sorted shared paths    #
#             (`[]` when none), `symbol`/`producer`/`consumer` the matched  #
#             token and task ids for an interface pair and `null`/`null`/   #
#             `null` for a files-only pair, and the whole `pairs` list in   #
#             document order of `a` then of `b`.                            #
# pairs-M2 -- `tasks`, `dag_edges` and `launch_waves` are unchanged: every   #
#             edge still carries its `why`, and an interface pair is still  #
#             an `interface` edge.                                          #
# pairs-M3 -- `--unguarded <plan.md>` prints what it printed before.        #
# --------------------------------------------------------------------------- #

def test_pairs_m1_files_and_interface_pairs_shape_and_order(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["a.py"],
                   produces=["`make_widget(n)`"]),
        task_block("2", "Consumer", modifies=["b.py"],
                   consumes=["`make_widget(n)`"]),
        task_block("3", "Other modifier", modifies=["b.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # The new top-level key, alongside the three pre-existing ones (plus the
    # `checks`/`bootstrapCmd` pair added by this task). [pairs-M1] [cmds-M2]
    assert set(obj.keys()) == {"tasks", "dag_edges", "launch_waves",
                               "pairs", "checks", "bootstrapCmd", "publish"}
    # Full entry shape, values and list order: (1, 2) by interface (no shared
    # file so no "files" reason, symbol/producer/consumer filled in), (2, 3)
    # by files (no interface so those three are null); (1, 3) shares neither
    # a file nor a token so draws no entry at all. [pairs-M1]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["interface"], "paths": [],
         "symbol": "make_widget", "producer": "1", "consumer": "2"},
        {"a": "2", "b": "3", "why": ["files"], "paths": ["b.py"],
         "symbol": None, "producer": None, "consumer": None},
    ]


def test_pairs_m1_why_lists_files_before_interface_when_both_match(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["a.py"],
                   produces=["`make_widget(n)`"]),
        task_block("2", "Consumer", modifies=["a.py", "b.py"],
                   consumes=["`make_widget(n)`"]),
        task_block("3", "Other modifier", modifies=["b.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    first = obj["pairs"][0]
    assert (first["a"], first["b"]) == ("1", "2")  # [pairs-M1]
    # Both reasons hold for (1, 2) now that task 2 also modifies a.py; "why"
    # names "files" before "interface", and "paths" is the shared path
    # between the two tasks only (not b.py, which task 1 never touches). [pairs-M1]
    assert first["why"] == ["files", "interface"]
    assert first["paths"] == ["a.py"]


def test_pairs_m1_paths_sorted_for_multiple_shared_files(tmp_path):
    tasks = [
        task_block("1", "A", modifies=["z.py", "a.py"]),
        task_block("2", "B", modifies=["z.py", "a.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # Shared paths sorted, not left in source/declaration order. [pairs-M1]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["files"], "paths": ["a.py", "z.py"],
         "symbol": None, "producer": None, "consumer": None},
    ]


def test_pairs_m1_files_intersection_excludes_test_paths(tmp_path):
    tasks = [
        task_block("1", "A", creates=["src/a.py"],
                   tests=["tests/shared_test.py"]),
        task_block("2", "B", creates=["src/b.py"],
                   tests=["tests/shared_test.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # A `- Test:` bullet adds no path to a task's `files`, so a Test:-only
    # overlap draws no "files" pair. [pairs-M1]
    assert obj["pairs"] == []


def test_pairs_m1_symbol_tie_break_uses_consumers_bullet_order(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["ta1.py"],
                   produces=["`alpha()`", "`beta()`"]),
        task_block("2", "Consumer", creates=["ta2.py"],
                   consumes=["`beta()`", "`alpha()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # Both alpha and beta match; the consumer lists `beta()` before
    # `alpha()` in its own Consumes bullets, so "symbol" is "beta" even
    # though the producer declared "alpha" first. [pairs-M1]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["interface"], "paths": [],
         "symbol": "beta", "producer": "1", "consumer": "2"},
    ]


def test_pairs_m1_producer_tie_break_uses_earlier_document_task_when_mutual(tmp_path):
    tasks = [
        task_block("1", "Earlier", creates=["tb1.py"],
                   produces=["`x()`"], consumes=["`y()`"]),
        task_block("2", "Later", creates=["tb2.py"],
                   produces=["`y()`"], consumes=["`x()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # Each side consumes what the other produces (task 1 makes x() which
    # task 2 consumes; task 2 makes y() which task 1 consumes); the earlier
    # document task, 1, is the producer, and the matched token follows from
    # that role assignment: task 1 produces x() and task 2 consumes it. [pairs-M1]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["interface"], "paths": [],
         "symbol": "x", "producer": "1", "consumer": "2"},
    ]


def test_pairs_m1_pairs_ordered_by_document_position_not_id_string(tmp_path):
    # Ids "9" and "10" sort the wrong way lexically ("10" < "9"); document
    # order (task 9 appears before task 10) must win over id-string order.
    tasks = [
        task_block("0", "X", modifies=["shared.py"]),
        task_block("9", "Y", modifies=["shared.py"]),
        task_block("10", "Z", modifies=["shared.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # "a" before "b" in document order, and the whole list in document order
    # of "a" then "b": all three tasks share one file, so the pair list
    # walks (0,9), (0,10) -- both "a"="0" pairs, "b" in document order, not
    # lexical order -- then (9,10). [pairs-M1]
    assert [(p["a"], p["b"]) for p in obj["pairs"]] == [
        ("0", "9"), ("0", "10"), ("9", "10"),
    ]
    for p in obj["pairs"]:
        assert p["why"] == ["files"]  # [pairs-M1]
        assert p["paths"] == ["shared.py"]  # [pairs-M1]
        assert (p["symbol"], p["producer"], p["consumer"]) == (None, None, None)  # [pairs-M1]


def test_pairs_m1_pairs_only_among_implementation_tasks(tmp_path):
    tasks = [
        task_block("1", "Impl", modifies=["shared2.py"]),
        task_block("2", "Gate", ttype="gate", modifies=["shared2.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # A gate task shares a file with the implementation task, but "pairs" is
    # a list of pairs of *implementation* tasks only, so no entry is drawn. [pairs-M1]
    assert obj["pairs"] == []


def test_pairs_m2_dag_edges_and_launch_waves_unchanged(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["a.py"],
                   produces=["`make_widget(n)`"]),
        task_block("2", "Consumer", modifies=["b.py"],
                   consumes=["`make_widget(n)`"]),
        task_block("3", "Other modifier", modifies=["b.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # The interface edge still carries its "why", unaffected by "pairs"
    # being added alongside it. [pairs-M2]
    assert obj["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    wave_ids = [[t["id"] for t in wave] for wave in obj["launch_waves"]]
    assert wave_ids == [["1", "3"], ["2"]]  # [pairs-M2]


# --------------------------------------------------------------------------- #
# Task: "The parser says what a plan wants run -- its proof lines, its       #
# checks, its bootstrap, and its test commands one by one".                  #
#                                                                             #
# This task's own Machine clauses are M1-M3, colliding by number with the    #
# grammar-parser's M1-M6 tags used at the top of this file -- its legs are   #
# tagged cmds-M1, cmds-M2, cmds-M3 to stay unambiguous, mirroring            #
# guard-M*/pairs-M*.                                                         #
#                                                                             #
# cmds-M1 -- every task object gains `proofRuns` (the task's Proof           #
#            `- Run:` commands in order, a whole-value backtick wrapper      #
#            removed, `[]` when none).                                      #
# cmds-M2 -- the printed object gains `checks` (one `{"cmd", "minor"}` per   #
#            `- Check:` bullet of `## Global Constraints`, in order, with    #
#            `minor` true exactly when the bullet ends with `(minor)`,       #
#            which is not part of `cmd`) and `bootstrapCmd` (the text of a   #
#            `**Bootstrap:**` header line above the first task, `null` when  #
#            the plan has none).                                            #
# cmds-M3 -- the other task fields, `dag_edges`, `launch_waves` and `pairs`  #
#            are unchanged; the task-object key set is the earlier set plus #
#            `proofRuns`, the top-level key set is the earlier set plus     #
#            `checks`/`bootstrapCmd`, both and nothing else.                #
# --------------------------------------------------------------------------- #

def test_cmds_m1_proofruns_field(tmp_path):
    tasks = [
        task_block("1", "Mixed", creates=["cm1/a.py"],
                   tests=["fleet/tests/test_a.mjs", "tests/test_b.py"],
                   run_cmds=["python3 checks/one.py",
                             "`python3 checks/two.py`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # proofRuns: the two `- Run:` commands in order, the second's whole-value
    # backtick wrapper removed (the first carried none to begin with). [cmds-M1]
    assert t["proofRuns"] == ["python3 checks/one.py",
                              "python3 checks/two.py"]


def test_cmds_m2_checks_and_bootstrap_fields(tmp_path):
    tasks = [task_block("1", "Solo", creates=["cm2/a.py"])]
    obj = build_and_run(
        tmp_path, tasks,
        checks=["git diff --quiet $ULTRA_BASE -- fleet/",
                "wc -w docs/x.md (minor)"],
        bootstrap="bun install --frozen-lockfile")
    # checks: one {"cmd", "minor"} per `- Check:` bullet, in order; the
    # trailing "(minor)" marks the bullet as minor and is not part of "cmd". [cmds-M2]
    assert obj["checks"] == [
        {"cmd": "git diff --quiet $ULTRA_BASE -- fleet/", "minor": False},
        {"cmd": "wc -w docs/x.md", "minor": True},
    ]
    # bootstrapCmd: the text of the **Bootstrap:** header line. [cmds-M2]
    assert obj["bootstrapCmd"] == "bun install --frozen-lockfile"


def test_cmds_m2_checks_and_bootstrap_absent_by_default(tmp_path):
    tasks = [task_block("1", "Solo", creates=["cm2b/a.py"])]
    obj = build_and_run(tmp_path, tasks)
    # A plan with neither a `- Check:` bullet nor a **Bootstrap:** line
    # prints checks [] and bootstrapCmd null. [cmds-M2]
    assert obj["checks"] == []
    assert obj["bootstrapCmd"] is None


def test_cmds_m3_key_sets_and_other_fields_unchanged(tmp_path):
    tasks = [
        task_block("1", "A", creates=["cm3/a.py"], tests=["tests/cm3_test.py"]),
        task_block("2", "B", modifies=["cm3/a.py"]),
    ]
    obj = build_and_run(
        tmp_path, tasks,
        checks=["echo check"], bootstrap="echo boot")

    # The task-object key set is exactly TASK_FIELDS, in both views. [cmds-M3]
    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS
    for wave in obj["launch_waves"]:
        for t in wave:
            assert set(t.keys()) == TASK_FIELDS

    # The top-level key set is the earlier set plus `checks` and
    # `bootstrapCmd`, nothing else. [cmds-M3]
    assert set(obj.keys()) == {"tasks", "dag_edges", "launch_waves",
                               "pairs", "checks", "bootstrapCmd", "publish"}

    # dag_edges and pairs are what they were: the write-after-create edge
    # (task "1" creates cm3/a.py, task "2" modifies it) still fires with its
    # own "why", and the pair still carries "files". [cmds-M3]
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["files"], "paths": ["cm3/a.py"],
         "symbol": None, "producer": None, "consumer": None},
    ]


# --------------------------------------------------------------------------- #
# runcite -- "The sandbox's parser strips a Run line's clause tag and prints #
# the clauses beside the command": a Proof `Run:` bullet may close with a    #
# `[M2]` / `[M1, M3]` citation tag, the same shape a Legs bullet's own       #
# citation carries. The tag is cut from `proofRuns` (the command a shell     #
# would actually run) and reappears, parallel to `proofRuns`, as the new     #
# `proofRunClauses` field -- `[]` for a command that carried no tag.         #
# runcite-M1 -- for a task whose Proof carries the three named `Run:`        #
#               bullets, `proofRuns` is exactly the three commands with      #
#               every tag stripped and `proofRunClauses` is exactly          #
#               `[["M2"], [], ["M1", "M3"]]`.                                #
# runcite-M2 -- a bracket that is not at the end of the command is part of   #
#               the command: it survives in `proofRuns` unchanged and        #
#               `proofRunClauses` is `[[]]`.                                 #
# runcite-M3 -- on that same plan, the compiler's own (pure, per-task) parse #
#               of `proof_runs` agrees with the parser's `proofRuns`,        #
#               element for element.                                        #
# runcite-M4 -- every task object gains exactly the one key                  #
#               `proofRunClauses` (TASK_FIELDS, line 52, already has it      #
#               folded in) and a task with no `Run:` bullet at all prints    #
#               `proofRunClauses` exactly `[]`.                              #
# --------------------------------------------------------------------------- #

# The three `- Run:` bullets named by the task's own Machine restatement
# (M1): one tagged [M2], one untagged, one tagged [M1, M3].
THREE_RUN_CMDS = [
    "grep -q 'kata 0.17.2' fleet/CONTRACT.md [M2]",
    "bash -n x.sh",
    "true [M1, M3]",
]


def test_runcite_m1_three_run_task_proofruns_and_clauses(tmp_path):
    tasks = [
        task_block("1", "Three runs", creates=["runcite1/a.py"],
                   run_cmds=THREE_RUN_CMDS),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # proofRuns: the citation tag stripped off every command that carries
    # one, the untagged command riding back unchanged, all three in Proof
    # order. [runcite-M1]
    assert t["proofRuns"] == [
        "grep -q 'kata 0.17.2' fleet/CONTRACT.md",
        "bash -n x.sh",
        "true",
    ]
    # proofRunClauses: parallel to proofRuns, [] for the untagged command,
    # each tag's ids sorted numerically. [runcite-M1]
    assert t["proofRunClauses"] == [["M2"], [], ["M1", "M3"]]


def test_runcite_m2_bracket_not_at_end_is_part_of_the_command(tmp_path):
    tasks = [
        task_block("2", "Mid-command bracket", creates=["runcite2/a.py"],
                   run_cmds=['test "$(echo [M1])" = x']),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # The bracket sits mid-command, not at the end of the value -- it is part
    # of the command and proofRuns prints the whole value unchanged.
    # [runcite-M2]
    assert t["proofRuns"] == ['test "$(echo [M1])" = x']
    # No tag was cut off it, so its clause list is empty. [runcite-M2]
    assert t["proofRunClauses"] == [[]]


def test_runcite_m4_key_set_and_no_run_line_task(tmp_path):
    tasks = [
        task_block("4", "Has a run", creates=["runcite4/a.py"],
                   run_cmds=["true [M1]"]),
        task_block("5", "No run at all", creates=["runcite5/a.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)

    # Every task object's key set is exactly TASK_FIELDS, which now carries
    # proofRunClauses and nothing else new -- in both `tasks` and
    # `launch_waves`. [runcite-M4]
    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS
    for wave in obj["launch_waves"]:
        for t in wave:
            assert set(t.keys()) == TASK_FIELDS

    by_id = {t["id"]: t for t in obj["tasks"]}
    assert by_id["4"]["proofRunClauses"] == [["M1"]]  # [runcite-M4]
    # A task with no Run: bullet at all prints proofRunClauses exactly [].
    # [runcite-M4]
    assert by_id["5"]["proofRuns"] == []
    assert by_id["5"]["proofRunClauses"] == []
