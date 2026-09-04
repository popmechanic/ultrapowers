"""Each wave entry carries the task-scoped test command its Proof derives.

The implementer's inner loop (red -> green iteration) runs task-scoped tests
only (#515): for a claims-v1 task whose Proof `Test:` paths are all
`fleet/tests/test_*.mjs`, `tests/**/*.py` or `tests/**/*.test.ts`, `--emit-args`
writes a `testCmd` on the task's wave entry — one `node <path>` per `.mjs` path
in Proof order, then a single `python3 -m pytest -q <py paths in Proof order>`
when any `.py` path is present, then a single `bun test <ts paths in Proof
order>` when any `.test.ts` path is present, joined with ` && `. Anything else
(a path outside those three shapes, no Proof `Test:` line at all, a
legacy-grammar body) carries None.
The run-wide command still runs at the integration head and the gate.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"
WIDE_FIXTURE = ROOT / "evals/fixtures/wide/plan.md"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    derive_task_test_cmd,
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

HEADER = ("# Plan: Task-scoped exams\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")


def _task(task_id, proof_lines, creates="app/mod_%s.py"):
    """One claims-v1 task carrying all six slots; `proof_lines` is the Proof
    slot's `Test:` bullet list (possibly empty)."""
    # A Proof slot may never be empty (claims-v1 refuses that), so a task with
    # no `Test:` path still carries the exam's prose.
    proof = ("**Proof:**\n"
             + "".join("- Test: `%s`\n" % p for p in proof_lines)
             + "- Legs: the constructor returns a widget of the given size.\n")
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Create: `%s`\n"
            "\n"
            "**Claim:** An operator gets a widget. (quoted from #489)\n"
            "Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`.\n"
            "\n"
            "**Authorized-by:** #489\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `make_widget_%s(n: int) -> Widget`\n"
            "\n"
            "**Context:** The repo has no widget module yet.\n"
            "\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #489\n"
            % (task_id, task_id, creates % task_id, task_id, proof))


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without (spec §4.5)."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in split_tasks(plan.read_text()):
        claims = parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": gate_input_hash(claims["claim"], claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _emit_args(tmp_path, plan_path, name="args"):
    """Compile `plan_path` with --emit-launch --emit-args; return the parsed
    args payload."""
    launch = tmp_path / (name + ".launch.json")
    argsf = tmp_path / (name + ".args.json")
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(plan_path),
         "--emit-launch", str(launch), "--emit-args", str(argsf)],
        capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(argsf.read_text())


def _entries(payload):
    """Every wave entry, flattened, keyed by task id."""
    return {e["id"]: e for wave in payload["waves"] for e in wave}


def _compile_tasks(tmp_path, *tasks):
    plan = tmp_path / "plan.md"
    plan.write_text(HEADER + "\n".join(tasks))
    _sign(plan)
    return _entries(_emit_args(tmp_path, plan))


# --- (a) mjs/py interleaved: node commands in Proof order, then one pytest ---

def test_mixed_proof_paths_derive_node_then_pytest(tmp_path):
    entries = _compile_tasks(tmp_path, _task(
        "1", ["fleet/tests/test_x.mjs", "tests/test_y.py",
              "fleet/tests/test_z.mjs"]))
    assert entries["1"]["testCmd"] == (
        "node fleet/tests/test_x.mjs && node fleet/tests/test_z.mjs"
        " && python3 -m pytest -q tests/test_y.py")


# --- (b) two .py paths collapse into ONE pytest invocation, in Proof order ---

def test_two_py_paths_collapse_into_one_pytest_invocation(tmp_path):
    entries = _compile_tasks(tmp_path, _task(
        "1", ["tests/test_b.py", "tests/sub/test_a.py"]))
    assert entries["1"]["testCmd"] == (
        "python3 -m pytest -q tests/test_b.py tests/sub/test_a.py")


# --- (c) any path outside the three shapes poisons the whole command --------

def test_non_test_path_beside_a_py_path_yields_none(tmp_path):
    entries = _compile_tasks(tmp_path, _task(
        "1", ["docs/x.md", "tests/test_y.py"]))
    assert entries["1"]["testCmd"] is None


# --- (d) no Proof `Test:` line at all --------------------------------------

def test_no_proof_test_line_yields_none(tmp_path):
    entries = _compile_tasks(tmp_path, _task("1", []))
    assert entries["1"]["testCmd"] is None


# --- (e) legacy-grammar plans never derive a command -----------------------

def test_legacy_fixture_entries_all_carry_none(tmp_path):
    payload = _emit_args(tmp_path, WIDE_FIXTURE)
    entries = _entries(payload)
    assert entries, "expected the wide fixture to compile to wave entries"
    assert {e["testCmd"] for e in entries.values()} == {None}


# --- (f) the claims corpus fixture ----------------------------------------

def test_claims_fixture_task_one_derives_its_pytest_command(tmp_path):
    entries = _entries(_emit_args(tmp_path, CLAIMS_FIXTURE))
    assert entries["1"]["testCmd"] == "python3 -m pytest -q tests/test_widget.py"


# --- (g) every other key and value of the entry is unchanged ---------------

def test_entry_keeps_every_other_key_at_its_base_value(tmp_path):
    entries = _entries(_emit_args(tmp_path, CLAIMS_FIXTURE))
    entry = entries["1"]
    assert entry == {
        "id": "1",
        "title": "The widget constructor",
        "files": ["tests/test_widget.py", "widgetkit/widget.py"],
        "depends_on": [],
        "interfaces": {"consumes": ["nothing (first task)"],
                       "produces": ["`make_widget(n: int) -> Widget`"]},
        "tier": None,
        "review": "lean",
        "writes": ["widgetkit/widget.py"],
        "commutes": [],
        # The Proof `Test:` paths this entry's command derives from (#553).
        "proofTests": ["tests/test_widget.py"],
        "testCmd": "python3 -m pytest -q tests/test_widget.py",
        # The Proof `Run:` commands (#589) — `[]` here, because this fixture
        # task's Proof names an exam file and no command.
        "proofRuns": [],
    }


# --- (h) the produced helper, called directly ------------------------------

def test_derive_task_test_cmd_on_empty_and_single_py():
    assert derive_task_test_cmd([]) is None
    assert derive_task_test_cmd(["tests/a.py"]) == "python3 -m pytest -q tests/a.py"


# --- (i) --check output is unchanged: it never mentions testCmd ------------

def test_check_renders_output_never_mentions_test_cmd():
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(CLAIMS_FIXTURE),
         "--check", "--renders"],
        capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert [line for line in p.stdout.splitlines() if "testCmd" in line] == []


# The greenfield stack (Bun + TypeScript) is the third runnable shape. Before
# 2026-09-04 a `tests/x.test.ts` path derived None, and the engine dispatches
# the examiner only when a task command exists — so no Bun target ever got a
# peer-written exam (runs 74 and 1: `exam: null` on every task).
def test_bun_test_paths_derive_one_bun_test_process():
    assert derive_task_test_cmd(["tests/count.test.ts"]) == "bun test tests/count.test.ts"
    assert derive_task_test_cmd(["tests/b.test.ts", "tests/a.test.ts"]) == \
        "bun test tests/b.test.ts tests/a.test.ts"
    assert derive_task_test_cmd(["tests/unit/deep.test.ts"]) == "bun test tests/unit/deep.test.ts"


def test_bun_paths_follow_node_and_pytest_parts():
    assert derive_task_test_cmd(
        ["tests/z.test.ts", "fleet/tests/test_a.mjs", "tests/y.py"]) == \
        "node fleet/tests/test_a.mjs && python3 -m pytest -q tests/y.py && bun test tests/z.test.ts"


def test_a_ts_path_that_is_not_a_bun_test_still_voids_the_command():
    # `src/x.ts` is a module, `tests/helpers.ts` a fixture: neither is an exam
    # `bun test <path>` can run, and a partial command would drop a named exam.
    assert derive_task_test_cmd(["tests/count.test.ts", "tests/helpers.ts"]) is None
    assert derive_task_test_cmd(["src/count.ts"]) is None
