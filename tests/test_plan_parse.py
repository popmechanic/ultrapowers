"""The claims-v1 parser: `skills/ultrapowers/scripts/plan_parse.py`.

`plan_parse.py` reduces a claims-v1 plan to the nine fields the engine needs
(`tasks`, `dag_edges`, `launch_waves`) without ever touching the sibling
`<stem>.gate-verdicts.json` the old compiler (`compile_plan.py`) requires.
This exam never imports the module under test — it is a script invoked as
`python3 skills/ultrapowers/scripts/plan_parse.py <plan.md>` — so every
assertion below runs it as a subprocess and reads stdout/stderr/the exit
code, exactly as `factory/engine.mjs` would.

Every assertion is tagged with the Machine clause (M1-M6) it proves.

A later task, "The parser names a plan's unguarded exam files", adds the
`proofGuards` field and the `--unguarded` flag; its own legs live in a
dedicated section near the end of this file and are tagged `guard-M1`,
`guard-M2`, `guard-M3` (that task's own Machine clauses) to keep them
distinct from the M1-M6 tags above, which belong to the grammar-parser
clauses this file already covered.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "skills/ultrapowers/scripts/plan_parse.py"
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"

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

TASK_FIELDS = {"id", "title", "files", "depends_on", "proofTests",
               "testCmd", "interfaces", "proofGuards"}


# --------------------------------------------------------------------------- #
# Subprocess helpers.                                                         #
# --------------------------------------------------------------------------- #

def run_parser(plan_path):
    return subprocess.run([sys.executable, str(PARSER), str(plan_path)],
                          capture_output=True, text=True)


def run_compiler(plan_path):
    return subprocess.run([sys.executable, str(COMPILER), str(plan_path)],
                          capture_output=True, text=True)


def run_parser_unguarded(plan_path):
    return subprocess.run([sys.executable, str(PARSER), "--unguarded",
                           str(plan_path)],
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

def make_header(title="Exam fixture plan", exam_command=None):
    lines = [f"# {title}", "",
             "**Grammar:** claims-v1", "",
             "**Claim:** An operator sees the placeholder claim proved. (elicited)", "",
             "**Summary:** Placeholder summary for an exam fixture.", "",
             "**Goal:** Placeholder goal for an exam fixture.", "",
             "**Tech Stack:** N/A (exam fixture, never executed).", ""]
    if exam_command:
        lines += [f"**Exam command:** {exam_command}", ""]
    lines += ["## Global Constraints", "", "- None.", ""]
    return "\n".join(lines)


def make_plan(tasks, exam_command=None, title="Exam fixture plan"):
    return (make_header(title=title, exam_command=exam_command)
            + "\n" + "\n\n".join(tasks) + "\n")


def task_block(task_id, title, *, ttype="implementation",
               creates=(), modifies=(), deletes=(), tests=(),
               consumes=(), produces=(), run_cmds=(), guards=()):
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
    assert set(obj_with.keys()) == {"tasks", "dag_edges", "launch_waves"}  # [M1]

    # A copy of the fixture alone in tmp_path, with no sibling file at all.
    tmp_plan = tmp_path / plan_path.name
    tmp_plan.write_text(plan_path.read_text())
    proc_without = run_parser(tmp_plan)
    assert proc_without.returncode == 0, proc_without.stdout + proc_without.stderr  # [M1]
    obj_without = parse_stdout_json(proc_without.stdout)
    assert set(obj_without.keys()) == {"tasks", "dag_edges", "launch_waves"}  # [M1]

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
            files=["tests/test_widget.py", "widgetkit/widget.py"],
            proofTests=["tests/test_widget.py"],
            testCmd="python3 -m pytest -q tests/test_widget.py",
            interfaces={"consumes": ["nothing (first task)"],
                        "produces": ["`make_widget(n: int) -> Widget`"]}),
        "2": dict(
            title="The widget catalog",
            files=["tests/test_catalog.py", "widgetkit/catalog.py"],
            proofTests=["tests/test_catalog.py"],
            testCmd="python3 -m pytest -q tests/test_catalog.py",
            interfaces={"consumes": ["`make_widget(n: int) -> Widget`"],
                        "produces": ["`catalog(sizes: list[int]) -> list[Widget]`"]}),
        "3": dict(
            title="Size formatting",
            files=["tests/test_format.py", "widgetkit/format.py"],
            proofTests=["tests/test_format.py"],
            testCmd="python3 -m pytest -q tests/test_format.py",
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
        assert t["files"] == exp["files"]  # [M2]
        assert t["files"] == sorted(t["files"])  # [M2]
        assert t["proofTests"] == exp["proofTests"]  # [M2]
        assert t["testCmd"] == exp["testCmd"]  # [M2]
        assert t["interfaces"] == exp["interfaces"]  # [M2]

    for wave in obj["launch_waves"]:
        for t in wave:
            assert set(t.keys()) == TASK_FIELDS  # [M2]


def test_m2_testcmd_uses_declared_exam_command_template(tmp_path):
    tasks = [task_block("1", "Vitest task", creates=["src/a.ts"],
                        tests=["tests/a.test.ts", "tests/b.test.ts"])]
    obj = build_and_run(tmp_path, tasks, exam_command="npx vitest run {paths}")
    t = obj["tasks"][0]
    assert t["proofTests"] == ["tests/a.test.ts", "tests/b.test.ts"]  # [M2]
    assert t["testCmd"] == "npx vitest run tests/a.test.ts tests/b.test.ts"  # [M2]


def test_m2_testcmd_builtin_derivation_groups_by_shape(tmp_path):
    # Proof order names the .py path first; the built-in derivation still
    # emits the .mjs `node` command first, then the pytest command.
    tasks = [task_block("1", "Mixed shapes task", creates=["src/b.py"],
                        tests=["tests/x.py", "fleet/tests/test_y.mjs"])]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    assert t["proofTests"] == ["tests/x.py", "fleet/tests/test_y.mjs"]  # [M2]
    assert t["testCmd"] == ("node fleet/tests/test_y.mjs && "
                            "python3 -m pytest -q tests/x.py")  # [M2]


def test_m2_testcmd_null_for_unknown_shape(tmp_path):
    tasks = [task_block("1", "Doc-proof task", creates=["src/c.py"],
                        tests=["docs/x.md"])]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    assert t["proofTests"] == ["docs/x.md"]  # [M2]
    assert t["testCmd"] is None  # [M2]


def test_m2_testcmd_null_for_no_test_path(tmp_path):
    tasks = [task_block("1", "No-proof-test task", creates=["src/d.py"])]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    assert t["proofTests"] == []  # [M2]
    assert t["testCmd"] is None  # [M2]


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
# M6 — agreement with the old compiler.                                       #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("plan_path", RECORD_FIXTURES, ids=lambda p: p.stem)
def test_m6_agrees_with_old_compiler_on_record_bearing_fixtures(plan_path):
    parser_proc = run_parser(plan_path)
    assert parser_proc.returncode == 0, parser_proc.stdout + parser_proc.stderr
    parser_obj = parse_stdout_json(parser_proc.stdout)

    compiler_proc = run_compiler(plan_path)
    assert compiler_proc.returncode == 0, (
        "fixture setup: compile_plan.py must succeed on this fixture -- "
        + compiler_proc.stdout + compiler_proc.stderr)
    compiler_obj = json.loads(compiler_proc.stdout)

    parser_ids = [t["id"] for t in parser_obj["tasks"]]
    compiler_ids = [t["id"] for t in compiler_obj["tasks"]]
    assert parser_ids == compiler_ids  # [M6]

    # The old compiler's per-task files/proofTests/testCmd/interfaces ride on
    # its `launch_waves` entries, not its `tasks` entries -- flatten those.
    compiler_fields = {}
    for wave in compiler_obj["launch_waves"]:
        for t in wave:
            compiler_fields[t["id"]] = {k: t[k] for k in TASK_FIELDS}

    for t in parser_obj["tasks"]:
        assert t == compiler_fields[t["id"]]  # [M6]

    parser_pairs = {(e["from"], e["to"]) for e in parser_obj["dag_edges"]}
    compiler_pairs = {(e["from"], e["to"]) for e in compiler_obj["dag_edges"]}
    assert parser_pairs == compiler_pairs  # [M6]

    parser_waves = [[t["id"] for t in wave] for wave in parser_obj["launch_waves"]]
    compiler_waves = [[t["id"] for t in wave] for wave in compiler_obj["launch_waves"]]
    assert parser_waves == compiler_waves  # [M6]


@pytest.mark.parametrize("plan_path", RECORDLESS_FIXTURES, ids=lambda p: p.stem)
def test_m6_parser_succeeds_where_old_compiler_refuses(plan_path):
    parser_proc = run_parser(plan_path)
    assert parser_proc.returncode == 0, parser_proc.stdout + parser_proc.stderr  # [M6]
    parser_obj = parse_stdout_json(parser_proc.stdout)
    assert len(parser_obj["launch_waves"]) > 0  # [M6]

    compiler_proc = run_compiler(plan_path)
    assert compiler_proc.returncode != 0  # [M6]


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
# Task: "The parser names a plan's unguarded exam files".                    #
#                                                                             #
# guard-M1 -- every task object gains `proofGuards` (backticked `- Guard:`   #
#             paths, in order, deduplicated, `[]` when none) in both `tasks` #
#             and `launch_waves`; the seven pre-existing fields are          #
#             unchanged.                                                    #
# guard-M2 -- `--unguarded <plan.md>` prints, one per line and nothing else  #
#             on stdout, every implementation task's `proofTests` path not  #
#             among that task's `proofGuards`, in document order,           #
#             deduplicated, exit 0; a refused plan exits 2 with the same    #
#             refusal on stderr as without the flag.                        #
# guard-M3 -- any argv that is neither `<plan.md>` nor `--unguarded          #
#             <plan.md>` prints the usage line on stderr and exits 2.       #
# --------------------------------------------------------------------------- #

def test_guard_m1_proofguards_field_guarded_and_unguarded_tasks(tmp_path):
    tasks = [
        task_block("1", "Guarded", creates=["ga/impl.py"],
                   tests=["tests/test_a.py"], guards=["tests/test_a.py"]),
        task_block("2", "Unguarded", creates=["ga/impl2.py"],
                   tests=["tests/test_b.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)

    # proofGuards present and correct in `tasks`. [guard-M1]
    by_id = {t["id"]: t for t in obj["tasks"]}
    assert by_id["1"]["proofGuards"] == ["tests/test_a.py"]
    assert by_id["2"]["proofGuards"] == []

    # ...and in `launch_waves` alike. [guard-M1]
    wave_by_id = {t["id"]: t for wave in obj["launch_waves"] for t in wave}
    assert wave_by_id["1"]["proofGuards"] == ["tests/test_a.py"]
    assert wave_by_id["2"]["proofGuards"] == []

    # Every task object's key set is exactly the eight named fields, and the
    # seven pre-existing fields carry the values the grammar always derived
    # for them -- the new field changes nothing about them. [guard-M1]
    expected = {
        "1": dict(title="Guarded", files=["ga/impl.py", "tests/test_a.py"],
                  depends_on=[], proofTests=["tests/test_a.py"],
                  testCmd="python3 -m pytest -q tests/test_a.py",
                  interfaces={"consumes": ["none"], "produces": ["none"]}),
        "2": dict(title="Unguarded", files=["ga/impl2.py", "tests/test_b.py"],
                  depends_on=[], proofTests=["tests/test_b.py"],
                  testCmd="python3 -m pytest -q tests/test_b.py",
                  interfaces={"consumes": ["none"], "produces": ["none"]}),
    }
    for view in (obj["tasks"], [t for wave in obj["launch_waves"] for t in wave]):
        for t in view:
            assert set(t.keys()) == TASK_FIELDS  # [guard-M1]
            exp = expected[t["id"]]
            for key, val in exp.items():
                assert t[key] == val  # [guard-M1]


def test_guard_m1_proofguards_dedup_and_order(tmp_path):
    tasks = [
        task_block("1", "Multi-guard", creates=["gb/impl.py"],
                   tests=["tests/test_x.py", "tests/test_y.py"],
                   guards=["tests/test_y.py", "tests/test_x.py",
                           "tests/test_y.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # Written order preserved, the repeat of tests/test_y.py dropped on its
    # second occurrence (first occurrence kept). [guard-M1]
    assert t["proofGuards"] == ["tests/test_y.py", "tests/test_x.py"]


def test_guard_m2_unguarded_prints_only_unguarded_paths(tmp_path):
    tasks = [
        task_block("1", "Guarded", creates=["gc/impl.py"],
                   tests=["tests/test_a.py"], guards=["tests/test_a.py"]),
        task_block("2", "Unguarded", creates=["gc/impl2.py"],
                   tests=["tests/test_b.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser_unguarded(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr  # [guard-M2]
    # Exactly the one unguarded path, one per line, nothing else. [guard-M2]
    assert proc.stdout == "tests/test_b.py\n"


def test_guard_m2_unguarded_empty_when_every_test_path_guarded(tmp_path):
    tasks = [
        task_block("1", "Fully guarded", creates=["gd/impl.py"],
                   tests=["tests/test_a.py"], guards=["tests/test_a.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser_unguarded(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr  # [guard-M2]
    assert proc.stdout == ""  # [guard-M2]


def test_guard_m2_unguarded_dedup_document_order_and_impl_only(tmp_path):
    tasks = [
        task_block("1", "First unguarded", creates=["ge/a.py"],
                   tests=["tests/shared.py", "tests/only1.py"]),
        task_block("2", "Gate task", ttype="gate", creates=["ge/gate.txt"],
                   tests=["tests/gate_only.py"]),
        task_block("3", "Second unguarded", creates=["ge/b.py"],
                   tests=["tests/shared.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser_unguarded(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr  # [guard-M2]
    # Document order across tasks 1 then 3 (the gate task's own unguarded
    # path is never printed -- only implementation tasks count), and task
    # 3's repeat of tests/shared.py deduplicated against task 1's. [guard-M2]
    assert proc.stdout == "tests/shared.py\ntests/only1.py\n"


def test_guard_m2_unguarded_refusal_matches_plain_refusal(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_header())  # no '### Task' heading at all

    proc_flag = run_parser_unguarded(plan_path)
    assert_is_the_scripts_own_refusal(proc_flag)
    assert proc_flag.returncode == 2  # [guard-M2]
    assert proc_flag.stdout == ""  # [guard-M2]
    assert proc_flag.stderr.strip() != ""  # [guard-M2]

    proc_plain = run_parser(plan_path)
    assert proc_plain.returncode == 2
    # The same refusal on stderr as without the flag. [guard-M2]
    assert proc_flag.stderr == proc_plain.stderr


def test_guard_m3_bad_argv_variants_exit_2_with_usage(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan([task_block("1", "Solo", creates=["gf/a.py"])]))

    # `assert_is_the_scripts_own_refusal` is not used here: it guards against
    # mistaking an absent plan_parse.py for a genuine refusal, but a bare
    # `--unguarded` (no plan.md) is a real M3 case whose CURRENT, unfixed
    # behavior is to treat "--unguarded" as a plan path and fail to open it
    # -- a real OSError message that also happens to contain "No such file
    # or directory", which that helper would misread as the interpreter
    # itself being missing.
    usage_lines = []
    for argv_tail in ([], ["--unguarded"], ["--frobnicate", str(plan_path)]):
        proc = subprocess.run([sys.executable, str(PARSER)] + argv_tail,
                              capture_output=True, text=True)
        assert proc.returncode == 2, argv_tail  # [guard-M3]
        assert proc.stdout == ""  # [guard-M3]
        lines = [l for l in proc.stderr.splitlines() if l.strip()]
        assert len(lines) == 1  # [guard-M3]
        usage_lines.append(lines[0])

    # The same one usage line for every rejected shape. [guard-M3]
    assert len(set(usage_lines)) == 1
