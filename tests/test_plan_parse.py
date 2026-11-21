import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "skills/ultrapowers/scripts/plan_parse.py"

RECORD_FIXTURES = [
    ROOT / "evals/fixtures/claims/plan.md",
    ROOT / "tests/fixtures/plans/2026-09-01-511-attempt-racing.md",
    ROOT / "tests/fixtures/plans/2026-09-02-papercut-drain-2.md",
]

TASK_FIELDS = {"id", "title", "files", "wave", "proofRuns",
               "proofRunClauses", "body"}

TOP_KEYS = {"tasks", "dag_edges", "width", "checks", "bootstrapCmd", "publish"}


def run_parser(plan_path):
    return subprocess.run([sys.executable, str(PARSER), str(plan_path)],
                          capture_output=True, text=True)


def parse_stdout_json(stdout):
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


def make_header(title="Exam fixture plan", bootstrap=None, checks=()):
    lines = [f"# {title}", "",
             "**Grammar:** claims-v1", "",
             "**Claim:** An operator sees the placeholder claim proved. (elicited)", "",
             "**Summary:** Placeholder summary for an exam fixture.", "",
             "**Goal:** Placeholder goal for an exam fixture.", "",
             "**Tech Stack:** N/A (exam fixture, never executed).", ""]
    if bootstrap:
        lines += [f"**Bootstrap:** {bootstrap}", ""]
    lines += ["## Global Constraints", ""]
    if checks:
        lines += [f"- Check: {c}" for c in checks] + [""]
    else:
        lines += ["- None.", ""]
    return "\n".join(lines)


def make_plan(tasks, title="Exam fixture plan", bootstrap=None, checks=()):
    return (make_header(title=title, bootstrap=bootstrap, checks=checks)
            + "\n" + "\n\n".join(tasks) + "\n")


def task_block(task_id, title, *, creates=(), modifies=(), deletes=(),
               consumes=(), produces=(), run_cmds=(), legs=None):
    lines = [f"### Task {task_id}: {title}", ""]
    file_lines = ([f"- Create: `{p}`" for p in creates]
                  + [f"- Modify: `{p}`" for p in modifies]
                  + [f"- Delete: `{p}`" for p in deletes])
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
    proof_lines = [f"- Run: {c}" for c in run_cmds]
    if legs is not None:
        proof_lines.append(f"- Legs: {legs}")
    if not proof_lines:
        proof_lines = ["Proved by the run-wide Check."]
    lines += ["**Proof:**"] + proof_lines + [""]
    lines += ["**Stale-if:**", f"- path-exists: `unused/{task_id}.marker`"]
    return "\n".join(lines)


@pytest.mark.parametrize("plan_path", RECORD_FIXTURES, ids=lambda p: p.stem)
def test_m1_stdout_shape_with_and_without_verdict_record(plan_path, tmp_path):
    verdict_path = plan_path.with_name(plan_path.stem + ".gate-verdicts.json")
    assert verdict_path.exists(), "fixture setup: expected a sibling verdict record"

    proc_with = run_parser(plan_path)
    assert proc_with.returncode == 0, proc_with.stdout + proc_with.stderr
    obj_with = parse_stdout_json(proc_with.stdout)
    assert set(obj_with.keys()) == TOP_KEYS

    tmp_plan = tmp_path / plan_path.name
    tmp_plan.write_text(plan_path.read_text())
    proc_without = run_parser(tmp_plan)
    assert proc_without.returncode == 0, proc_without.stdout + proc_without.stderr
    obj_without = parse_stdout_json(proc_without.stdout)
    assert set(obj_without.keys()) == TOP_KEYS

    assert obj_with == obj_without


def test_m2_task_and_wave_shape_on_widget_plan():
    plan_path = ROOT / "evals/fixtures/claims/plan.md"
    proc = run_parser(plan_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    obj = parse_stdout_json(proc.stdout)

    expected = {
        "1": dict(title="The widget constructor", files=["widgetkit/widget.py"], wave=1),
        "2": dict(title="The widget catalog", files=["widgetkit/catalog.py"], wave=2),
        "3": dict(title="Size formatting", files=["widgetkit/format.py"], wave=1),
    }

    assert [t["id"] for t in obj["tasks"]] == ["1", "2", "3"]
    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS
        assert isinstance(t["id"], str)
        exp = expected[t["id"]]
        assert t["title"] == exp["title"]
        assert t["files"] == exp["files"]
        assert t["files"] == sorted(t["files"])
        assert t["wave"] == exp["wave"]
    assert obj["width"] == 2


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
        assert ("1", "2") in pairs
    else:
        assert pairs == set()


def test_m4_write_after_create_edge(tmp_path):
    tasks = [
        task_block("1", "Creator", creates=["m4/p.py"]),
        task_block("2", "Modifier", modifies=["m4/p.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


def test_m4_interface_edge(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["m4/a2.py"], produces=["`f()`"]),
        task_block("2", "Consumer", creates=["m4/b2.py"], consumes=["`f()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "interface"}]


def test_m4_proof_run_edge(tmp_path):
    tasks = [
        task_block("1", "Owner", creates=["m4/p3.py"]),
        task_block("2", "Runner", creates=["m4/other3.py"],
                   run_cmds=["python3 m4/p3.py --x"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_m4_write_after_create_wins_over_interface_for_the_pair(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/p4.py"], produces=["`g()`"]),
        task_block("2", "B", modifies=["m4/p4.py"], consumes=["`g()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


def test_m4_reverse_interface_dropped_when_forward_already_reachable(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/p5.py"], consumes=["`h()`"]),
        task_block("2", "B", modifies=["m4/p5.py"], produces=["`h()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


def test_m4_reverse_proof_run_dropped_when_forward_already_reachable(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m4/a6.py"], produces=["`k()`"],
                   run_cmds=["python3 m4/b6.py --check"]),
        task_block("2", "B", creates=["m4/b6.py"], consumes=["`k()`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "interface"}]


def test_m4_shared_modify_with_no_other_relation_draws_no_edge(tmp_path):
    tasks = [
        task_block("1", "A", modifies=["m4/shared.py"]),
        task_block("2", "B", modifies=["m4/shared.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == []


def test_import_python_from_import_edge(tmp_path):
    tasks = [
        task_block("1", "Fixture owner", creates=["tests/trends_fixtures.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from tests.trends_fixtures import '
                             'make_canon_fixture; make_canon_fixture()"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_import_python_bare_import_dotted_module_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["pkg/mod.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "import pkg.mod; pkg.mod.go()"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_import_python_from_import_package_init_edge(tmp_path):
    tasks = [
        task_block("1", "Package owner", creates=["pkg/__init__.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from pkg import x"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_import_js_dynamic_import_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["lib/a.mjs"]),
        task_block("2", "Probe", creates=["app/x.mjs"],
                   run_cmds=["node -e \"import('./lib/a.mjs')"
                             ".then(m => m.a())\""]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_import_js_extensionless_specifier_edge(tmp_path):
    tasks = [
        task_block("1", "Module owner", creates=["lib/b.ts"]),
        task_block("2", "Probe", creates=["app/x.mjs"],
                   run_cmds=["bun -e \"import {b} from './lib/b'; b()\""]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "proof-run"}]


def test_import_of_module_no_sibling_creates_draws_no_edge(tmp_path):
    tasks = [
        task_block("1", "Fixture owner", creates=["tests/trends_fixtures.py"]),
        task_block("2", "Probe", creates=["app/x.py"],
                   run_cmds=['python3 -c "from tests.absent_fixture '
                             'import make"']),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == []


def test_m5_waves_are_kahn_layers_and_width_the_widest(tmp_path):
    tasks = [
        task_block("1", "A", creates=["m5/a.py"], produces=["`z()`"]),
        task_block("2", "B", creates=["m5/b.py"], consumes=["`z()`"]),
        task_block("3", "C", creates=["m5/c.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert {t["id"]: t["wave"] for t in obj["tasks"]} == {"1": 1, "2": 2, "3": 1}
    assert obj["width"] == 2


def assert_is_the_scripts_own_refusal(proc):
    assert "No such file or directory" not in proc.stderr, (
        "stderr is the interpreter's launch failure, not the script's own "
        "refusal -- plan_parse.py is missing: " + proc.stderr)


def test_m5_refusal_no_task_heading(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_header())
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1


def test_m5_refusal_duplicate_task_id(tmp_path):
    tasks = [
        task_block("1", "First", creates=["m5d/a.py"]),
        task_block("1", "Second", creates=["m5d/b.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1


def test_m5_refusal_cycle_names_both_tasks(tmp_path):
    tasks = [
        task_block("701", "A", creates=["m5c/a.py"], modifies=["m5c/b.py"]),
        task_block("702", "B", creates=["m5c/b.py"], modifies=["m5c/a.py"]),
    ]
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan(tasks))
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2
    lines = [l for l in proc.stderr.splitlines() if l.strip()]
    assert len(lines) == 1
    assert "701" in lines[0] and "702" in lines[0]


def test_guard_m3_bad_argv_variants_exit_2_with_usage(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan([task_block("1", "Solo", creates=["gf/a.py"])]))

    usage_lines = []
    for argv_tail in ([], ["--unguarded", str(plan_path)],
                      ["--frobnicate", str(plan_path)]):
        proc = subprocess.run([sys.executable, str(PARSER)] + argv_tail,
                              capture_output=True, text=True)
        assert_is_the_scripts_own_refusal(proc)
        assert proc.returncode == 2, argv_tail
        assert proc.stdout == ""
        lines = [l for l in proc.stderr.splitlines() if l.strip()]
        assert len(lines) == 1
        usage_lines.append(lines[0])

    assert len(set(usage_lines)) == 1


def test_interface_edge_and_waves(tmp_path):
    tasks = [
        task_block("1", "Producer", creates=["a.py"],
                   produces=["`make_widget(n)`"]),
        task_block("2", "Consumer", modifies=["b.py"],
                   consumes=["`make_widget(n)`"]),
        task_block("3", "Other modifier", modifies=["b.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    assert obj["dag_edges"] == [{"from": "1", "to": "2", "why": "interface"}]
    assert {t["id"]: t["wave"] for t in obj["tasks"]} == {"1": 1, "2": 2, "3": 1}


def test_cmds_m1_proofruns_field(tmp_path):
    tasks = [
        task_block("1", "Mixed", creates=["cm1/a.py"],
                   run_cmds=["python3 checks/one.py",
                             "`python3 checks/two.py`"]),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    assert t["proofRuns"] == ["python3 checks/one.py",
                              "python3 checks/two.py"]


def test_cmds_m2_checks_and_bootstrap_fields(tmp_path):
    tasks = [task_block("1", "Solo", creates=["cm2/a.py"])]
    obj = build_and_run(
        tmp_path, tasks,
        checks=["git diff --quiet $ULTRA_BASE -- fleet/", "`wc -w docs/x.md`"],
        bootstrap="bun install --frozen-lockfile")
    assert obj["checks"] == [
        {"cmd": "git diff --quiet $ULTRA_BASE -- fleet/"},
        {"cmd": "wc -w docs/x.md"},
    ]
    assert obj["bootstrapCmd"] == "bun install --frozen-lockfile"


def test_cmds_m2_a_minor_check_is_refused(tmp_path):
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(make_plan([task_block("1", "Solo", creates=["cm2m/a.py"])],
                                   checks=["wc -w docs/x.md (minor)"]))
    proc = run_parser(plan_path)
    assert_is_the_scripts_own_refusal(proc)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "ends `(minor)`, which is never run" in proc.stderr, proc.stderr


def test_cmds_m2_checks_and_bootstrap_absent_by_default(tmp_path):
    tasks = [task_block("1", "Solo", creates=["cm2b/a.py"])]
    obj = build_and_run(tmp_path, tasks)
    assert obj["checks"] == []
    assert obj["bootstrapCmd"] is None


def test_cmds_m3_key_sets_and_other_fields_unchanged(tmp_path):
    tasks = [
        task_block("1", "A", creates=["cm3/a.py"]),
        task_block("2", "B", modifies=["cm3/a.py"]),
    ]
    obj = build_and_run(
        tmp_path, tasks,
        checks=["echo check"], bootstrap="echo boot")

    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS

    assert set(obj.keys()) == TOP_KEYS

    assert obj["dag_edges"] == [
        {"from": "1", "to": "2", "why": "write-after-create"}]


THREE_RUN_CMDS = [
    "grep -q 'evidence' fleet/CONTRACT.md [M2]",
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
    assert t["proofRuns"] == [
        "grep -q 'evidence' fleet/CONTRACT.md",
        "bash -n x.sh",
        "true",
    ]
    assert t["proofRunClauses"] == [["M2"], [], ["M1", "M3"]]


def test_runcite_m2_bracket_not_at_end_is_part_of_the_command(tmp_path):
    tasks = [
        task_block("2", "Mid-command bracket", creates=["runcite2/a.py"],
                   run_cmds=['test "$(echo [M1])" = x']),
    ]
    obj = build_and_run(tmp_path, tasks)
    t = obj["tasks"][0]
    assert t["proofRuns"] == ['test "$(echo [M1])" = x']
    assert t["proofRunClauses"] == [[]]


def test_runcite_m4_key_set_and_no_run_line_task(tmp_path):
    tasks = [
        task_block("4", "Has a run", creates=["runcite4/a.py"],
                   run_cmds=["true [M1]"]),
        task_block("5", "No run at all", creates=["runcite5/a.py"]),
    ]
    obj = build_and_run(tmp_path, tasks)

    for t in obj["tasks"]:
        assert set(t.keys()) == TASK_FIELDS

    by_id = {t["id"]: t for t in obj["tasks"]}
    assert by_id["4"]["proofRunClauses"] == [["M1"]]
    assert by_id["5"]["proofRuns"] == []
    assert by_id["5"]["proofRunClauses"] == []
