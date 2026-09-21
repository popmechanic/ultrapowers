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
import importlib.util
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

# The eight fields the old compiler's wave entries also carry: the oracle set
# the M6 agreement tests compare over.
ORACLE_FIELDS = {"id", "title", "files", "depends_on", "proofTests",
                 "testCmd", "interfaces", "proofGuards"}
# Every field a task object prints: the oracle's eight plus the parser's own
# `runOnlyClauses` (run-195), `proofRuns`/`testCmds` and `proofRunClauses`
# (the Run-line clause-tag task), none of which the old compiler ever
# emitted.
TASK_FIELDS = ORACLE_FIELDS | {"runOnlyClauses", "proofRuns", "testCmds",
                               "proofRunClauses"}


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
                                    "pairs", "checks", "bootstrapCmd"}

    # A copy of the fixture alone in tmp_path, with no sibling file at all.
    tmp_plan = tmp_path / plan_path.name
    tmp_plan.write_text(plan_path.read_text())
    proc_without = run_parser(tmp_plan)
    assert proc_without.returncode == 0, proc_without.stdout + proc_without.stderr  # [M1]
    obj_without = parse_stdout_json(proc_without.stdout)
    assert set(obj_without.keys()) == {"tasks", "dag_edges", "launch_waves",
                                       "pairs", "checks", "bootstrapCmd"}  # [M1] [pairs-M1] [cmds-M2]

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
            compiler_fields[t["id"]] = {k: t[k] for k in ORACLE_FIELDS}

    for t in parser_obj["tasks"]:
        assert {k: t[k] for k in ORACLE_FIELDS} == compiler_fields[t["id"]]  # [M6]

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
                               "pairs", "checks", "bootstrapCmd"}
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


def test_pairs_m1_files_intersection_includes_test_paths(tmp_path):
    tasks = [
        task_block("1", "A", creates=["src/a.py"],
                   tests=["tests/shared_test.py"]),
        task_block("2", "B", creates=["src/b.py"],
                   tests=["tests/shared_test.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    # A task's `files` includes its Test: paths, so a Test:-only overlap
    # still draws a "files" pair. [pairs-M1]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["files"], "paths": ["tests/shared_test.py"],
         "symbol": None, "producer": None, "consumer": None},
    ]


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


def test_pairs_m3_unguarded_flag_output_unchanged(tmp_path):
    tasks = [
        task_block("1", "Guarded", creates=["pc/impl.py"],
                   tests=["tests/test_a.py"], guards=["tests/test_a.py"]),
        task_block("2", "Unguarded", creates=["pc/impl2.py"],
                   tests=["tests/test_b.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser_unguarded(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr  # [pairs-M3]
    # Exactly the one unguarded path, one per line, nothing else -- the same
    # as before "pairs" existed. [pairs-M3]
    assert proc.stdout == "tests/test_b.py\n"


# --------------------------------------------------------------------------- #
# Task: "A green exam settles it -- the re-attempt floor reads only what Jev #
# can see".                                                                   #
#                                                                             #
# This task's own Machine clauses are M1-M5, colliding by number with the    #
# grammar-parser's M1-M6 tags already used above -- its legs are tagged      #
# floor-M1..floor-M5 to stay unambiguous, mirroring guard-M*/pairs-M*.       #
#                                                                             #
# floor-M1 -- every task object gains `runOnlyClauses`: the ascending clause #
#             numbers `n` such that every `- Legs:` leg citing `[M<n>]`      #
#             contains the text `Run:` (a leg is the text from one          #
#             `(<letter>)` marker to the next); `[]` when no such clause;    #
#             present the same way in `tasks` and in `launch_waves`; the     #
#             earlier field set, the top-level key set and `--unguarded`     #
#             are unchanged.                                                 #
# floor-M2..floor-M5 -- the engine's re-attempt floor decision and its       #
#             `floor` event; proved in fleet/tests/test_factory_floor.mjs,   #
#             not in this file.                                             #
# --------------------------------------------------------------------------- #

TASK_FIELDS_WITH_RUN_ONLY = TASK_FIELDS | {"runOnlyClauses"}


def test_floor_m1_run_only_clauses_field(tmp_path):
    # Leg (a) containing `Run:` and citing only [M1]; leg (b) citing only
    # [M2] and never saying `Run:`; leg (c) containing `Run:` and citing
    # both [M2] and [M3]. Clause 1 is cited only by a Run:-bearing leg (a)
    # -> included. Clause 2 is cited by leg (b), which is not a Run: leg
    # -> excluded even though leg (c) also cites it and does say Run:.
    # Clause 3 is cited only by leg (c), which does say Run: -> included.
    # Expected runOnlyClauses: [1, 3].
    legs_text = ("(a) `Run: python3 check_one.py` prints the count [M1]; "
                 "(b) f() equals 3, read straight from the diff [M2]; "
                 "(c) `Run: python3 check_two.py` prints the count again "
                 "[M2][M3]")
    tasks = [
        task_block("1", "Legged task", creates=["floor1/impl.py"],
                   tests=["tests/floor_legged.py"], legs=legs_text),
        task_block("2", "No legs task", creates=["floor1/other.py"],
                   tests=["tests/floor_nolegs.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)

    by_id = {t["id"]: t for t in obj["tasks"]}
    assert by_id["1"]["runOnlyClauses"] == [1, 3]  # [floor-M1]
    # A task with no `- Legs:` line at all prints `[]`. [floor-M1]
    assert by_id["2"]["runOnlyClauses"] == []

    # ...and the same values in `launch_waves` alike. [floor-M1]
    wave_by_id = {t["id"]: t for wave in obj["launch_waves"] for t in wave}
    assert wave_by_id["1"]["runOnlyClauses"] == [1, 3]
    assert wave_by_id["2"]["runOnlyClauses"] == []

    # Every task object's key set is the earlier set plus `runOnlyClauses`
    # and nothing else, in both views, and the values of the earlier fields
    # are undisturbed. [floor-M1]
    expected = {
        "1": dict(title="Legged task",
                  files=["floor1/impl.py", "tests/floor_legged.py"],
                  depends_on=[], proofTests=["tests/floor_legged.py"],
                  testCmd="python3 -m pytest -q tests/floor_legged.py",
                  interfaces={"consumes": ["none"], "produces": ["none"]},
                  proofGuards=[]),
        "2": dict(title="No legs task",
                  files=["floor1/other.py", "tests/floor_nolegs.py"],
                  depends_on=[], proofTests=["tests/floor_nolegs.py"],
                  testCmd="python3 -m pytest -q tests/floor_nolegs.py",
                  interfaces={"consumes": ["none"], "produces": ["none"]},
                  proofGuards=[]),
    }
    for view in (obj["tasks"], [t for wave in obj["launch_waves"] for t in wave]):
        for t in view:
            assert set(t.keys()) == TASK_FIELDS_WITH_RUN_ONLY
            exp = expected[t["id"]]
            for key, val in exp.items():
                assert t[key] == val

    # The top-level key set is unchanged by the new task-level field (beyond
    # the `checks`/`bootstrapCmd` pair added by this task). [floor-M1] [cmds-M2]
    assert set(obj.keys()) == {"tasks", "dag_edges", "launch_waves",
                               "pairs", "checks", "bootstrapCmd"}

    # `--unguarded` on this plan (one unguarded Test path per task, neither
    # guarded) still prints exactly those paths, one per line. [floor-M1]
    proc = run_parser_unguarded(tmp_path / "plan.md")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == "tests/floor_legged.py\ntests/floor_nolegs.py\n"


# --------------------------------------------------------------------------- #
# Task: "The parser says what a plan wants run -- its proof lines, its       #
# checks, its bootstrap, and its test commands one by one".                  #
#                                                                             #
# This task's own Machine clauses are M1-M3, colliding by number with the    #
# grammar-parser's M1-M6 tags used at the top of this file -- its legs are   #
# tagged cmds-M1, cmds-M2, cmds-M3 to stay unambiguous, mirroring            #
# guard-M*/pairs-M*/floor-M*.                                                #
#                                                                             #
# cmds-M1 -- every task object gains `proofRuns` (the task's Proof           #
#            `- Run:` commands in order, a whole-value backtick wrapper      #
#            removed, `[]` when none) and `testCmds` (the list of commands   #
#            whose ` && `-join is `testCmd`, `[]` when `testCmd` is `null`). #
# cmds-M2 -- the printed object gains `checks` (one `{"cmd", "minor"}` per   #
#            `- Check:` bullet of `## Global Constraints`, in order, with    #
#            `minor` true exactly when the bullet ends with `(minor)`,       #
#            which is not part of `cmd`) and `bootstrapCmd` (the text of a   #
#            `**Bootstrap:**` header line above the first task, `null` when  #
#            the plan has none).                                            #
# cmds-M3 -- `testCmd`, the other task fields, `dag_edges`, `launch_waves`,  #
#            `pairs` and `--unguarded` are unchanged; the task-object key    #
#            set is the earlier set plus `proofRuns`/`testCmds`, the         #
#            top-level key set is the earlier set plus                      #
#            `checks`/`bootstrapCmd`, both and nothing else.                #
# --------------------------------------------------------------------------- #

def test_cmds_m1_proofruns_and_testcmds_fields(tmp_path):
    tasks = [
        task_block("1", "Mixed", creates=["cm1/a.py"],
                   tests=["fleet/tests/test_a.mjs", "tests/test_b.py"],
                   run_cmds=["python3 checks/one.py",
                             "`python3 checks/two.py`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # testCmds is the list whose " && "-join is testCmd. [cmds-M1]
    assert t["testCmds"] == ["node fleet/tests/test_a.mjs",
                             "python3 -m pytest -q tests/test_b.py"]
    assert t["testCmd"] == " && ".join(t["testCmds"])  # [cmds-M1]
    assert t["testCmd"] == ("node fleet/tests/test_a.mjs && "
                            "python3 -m pytest -q tests/test_b.py")  # [cmds-M1]
    # proofRuns: the two `- Run:` commands in order, the second's whole-value
    # backtick wrapper removed (the first carried none to begin with). [cmds-M1]
    assert t["proofRuns"] == ["python3 checks/one.py",
                              "python3 checks/two.py"]


def test_cmds_m1_proofruns_and_testcmds_empty_when_absent(tmp_path):
    tasks = [task_block("1", "No proof", creates=["cm1b/a.py"])]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    # No Test path -> testCmds [] and testCmd null; no Run: bullets ->
    # proofRuns []. [cmds-M1]
    assert t["testCmds"] == []
    assert t["testCmd"] is None
    assert t["proofRuns"] == []


def test_cmds_m1_testcmds_single_item_under_exam_command_template(tmp_path):
    tasks = [task_block("1", "Vitest task", creates=["cm1c/a.ts"],
                        tests=["tests/a.test.ts", "tests/b.test.ts"])]
    obj = build_and_run(tmp_path, tasks, exam_command="npx vitest run {paths}")
    t = obj["tasks"][0]
    # Under an **Exam command:** template, testCmds is a list of exactly one
    # command -- that command being the whole (templated) testCmd. [cmds-M1]
    assert t["testCmds"] == ["npx vitest run tests/a.test.ts tests/b.test.ts"]
    assert t["testCmd"] == t["testCmds"][0]


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

    # The task-object key set is the earlier set plus `proofRuns` and
    # `testCmds`, nothing else -- TASK_FIELDS already carries that pin. [cmds-M3]
    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS
    for wave in obj["launch_waves"]:
        for t in wave:
            assert set(t.keys()) == TASK_FIELDS

    # The top-level key set is the earlier set plus `checks` and
    # `bootstrapCmd`, nothing else. [cmds-M3]
    assert set(obj.keys()) == {"tasks", "dag_edges", "launch_waves",
                               "pairs", "checks", "bootstrapCmd"}

    # testCmd, the other task fields, dag_edges, launch_waves and pairs are
    # what they were: the write-after-create edge (task "1" creates
    # cm3/a.py, task "2" modifies it) still fires with its own "why", and the
    # pair still carries "files". [cmds-M3]
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]
    assert obj["pairs"] == [
        {"a": "1", "b": "2", "why": ["files"], "paths": ["cm3/a.py"],
         "symbol": None, "producer": None, "consumer": None},
    ]
    by_id = {t["id"]: t for t in obj["tasks"]}
    assert by_id["1"]["testCmd"] == "python3 -m pytest -q tests/cm3_test.py"  # [cmds-M3]
    assert by_id["2"]["testCmd"] is None  # [cmds-M3]

    # --unguarded on a plan with one unguarded Test path still prints
    # exactly that path and a newline. [cmds-M3]
    plan_path = tmp_path / "plan.md"
    proc = run_parser_unguarded(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == "tests/cm3_test.py\n"


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


def _load_compile_plan_oracle():
    """Import `compile_plan.py` by path -- the oracle module for runcite-M3,
    never the module under test (that is `plan_parse.py`, run only as a
    subprocess throughout this file)."""
    spec = importlib.util.spec_from_file_location(
        "compile_plan_oracle_for_test_plan_parse", COMPILER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_runcite_m3_agrees_with_compiler_proof_runs(tmp_path):
    tasks = [
        task_block("3", "Oracle agreement", creates=["runcite3/a.py"],
                   run_cmds=THREE_RUN_CMDS),
    ]
    plan_text = make_plan(tasks)
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(plan_text)

    parser_proc = run_parser(plan_path)
    assert parser_proc.returncode == 0, parser_proc.stdout + parser_proc.stderr
    parser_task = parse_stdout_json(parser_proc.stdout)["tasks"][0]

    # The compiler's parse of proof_runs needs no sibling gate-verdicts
    # record to get there -- read only its pure per-task parse
    # (`parse_claims_body`), which never touches the filesystem. [runcite-M3]
    compile_plan = _load_compile_plan_oracle()
    compiler_body = next(t["body"] for t in compile_plan.split_tasks(plan_text)
                         if t["id"] == "3")
    compiler_parsed = compile_plan.parse_claims_body(compiler_body, "3")

    assert compiler_parsed["proof_runs"] == parser_task["proofRuns"]  # [runcite-M3]


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
