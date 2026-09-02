"""Each wave entry carries its Proof `Test:` paths, in Proof order.

The exam rides the assignment channel (#553, quoted from run-52's map #551):
alongside the derived `testCmd` (#515), `--emit-args` writes `proofTests` on
every wave entry — for a claims-v1 task the list of its Proof `Test:` paths in
Proof order (the very list `testCmd` derives from), `[]` when the Proof names
none; for a legacy-grammar task `[]`. The list is the Proof's, the command is
only derivable for the two runnable shapes, so the two keys disagree whenever
the Proof names something unrunnable — that is the point of shipping both.

Leg (f) pins the rest of the entry: with `proofTests` deleted, the `waves`
array of each corpus fixture deep-equals a literal recorded from the BASE
compiler, and the plan-determined lines of `--check --renders` stdout equal
the BASE bytes.
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
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

HEADER = ("# Plan: The exam rides the assignment channel\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")


def _task(task_id, proof_lines):
    """One claims-v1 task carrying all six slots; `proof_lines` is the Proof
    slot's `Test:` bullet list (possibly empty)."""
    # A Proof slot may never be empty (claims-v1 refuses that), so a task with
    # no `Test:` path still carries the exam's prose.
    proof = ("**Proof:**\n"
             + "".join("- Test: `%s`\n" % p for p in proof_lines)
             + "- Legs: the constructor returns a gizmo of the given size.\n")
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Create: `app/mod_%s.py`\n"
            "\n"
            "**Claim:** An operator gets a gizmo. (quoted from #489)\n"
            "Machine: `make_gizmo(3)` returns a `Gizmo` whose `size` is `3`.\n"
            "\n"
            "**Authorized-by:** #489\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `make_gizmo_%s(n: int) -> Gizmo`\n"
            "\n"
            "**Context:** The repo has no gizmo module yet.\n"
            "\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #489\n"
            % (task_id, task_id, task_id, task_id, proof))


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


# --- (a) Proof order, and the same entry's testCmd derives from that list ---

def test_proof_paths_ride_in_proof_order_beside_the_derived_command(tmp_path):
    entries = _compile_tasks(tmp_path, _task(
        "1", ["fleet/tests/test_x.mjs", "tests/test_y.py"]))
    assert entries["1"]["proofTests"] == [
        "fleet/tests/test_x.mjs", "tests/test_y.py"]
    assert entries["1"]["testCmd"] == (
        "node fleet/tests/test_x.mjs && python3 -m pytest -q tests/test_y.py")


# --- (b) an unrunnable Proof path still rides; only the command is None -----

def test_unrunnable_proof_path_rides_with_a_none_command(tmp_path):
    entries = _compile_tasks(tmp_path, _task("1", ["docs/x.md"]))
    assert entries["1"]["proofTests"] == ["docs/x.md"]
    assert entries["1"]["testCmd"] is None


# --- (c) no Proof `Test:` line at all --------------------------------------

def test_no_proof_test_line_emits_the_empty_list(tmp_path):
    entries = _compile_tasks(tmp_path, _task("1", []))
    assert entries["1"]["proofTests"] == []


# --- (d) legacy-grammar plans carry the empty list on every entry -----------

def test_legacy_fixture_entries_all_carry_the_empty_list(tmp_path):
    entries = _entries(_emit_args(tmp_path, WIDE_FIXTURE))
    assert entries, "expected the wide fixture to compile to wave entries"
    assert [e["proofTests"] for e in entries.values()] == [[]] * len(entries)


# --- (e) the claims corpus fixture -----------------------------------------

def test_claims_fixture_task_one_carries_its_proof_test(tmp_path):
    entries = _entries(_emit_args(tmp_path, CLAIMS_FIXTURE))
    assert entries["1"]["proofTests"] == ["tests/test_widget.py"]


# --- (f) every other key and value of every entry is unchanged -------------

# Recorded from the BASE compiler (4a8b242) before this task's edit, so any
# other key added, dropped or changed on any entry fails the comparison.
BASE_CLAIMS_WAVES = [
    [
        {
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
            "testCmd": "python3 -m pytest -q tests/test_widget.py",
        },
        {
            "id": "3",
            "title": "Size formatting",
            "files": ["tests/test_format.py", "widgetkit/format.py"],
            "depends_on": [],
            "interfaces": {"consumes": ["nothing"],
                           "produces": ["`format_size(n: int) -> str`"]},
            "tier": None,
            "review": "lean",
            "writes": ["widgetkit/format.py"],
            "commutes": [],
            "testCmd": "python3 -m pytest -q tests/test_format.py",
        },
    ],
    [
        {
            "id": "2",
            "title": "The widget catalog",
            "files": ["tests/test_catalog.py", "widgetkit/catalog.py"],
            "depends_on": [],
            "interfaces": {"consumes": ["`make_widget(n: int) -> Widget`"],
                           "produces": ["`catalog(sizes: list[int]) -> list[Widget]`"]},
            "tier": None,
            "review": "lean",
            "writes": ["widgetkit/catalog.py"],
            "commutes": [],
            "testCmd": "python3 -m pytest -q tests/test_catalog.py",
        },
    ],
]

BASE_WIDE_WAVES = [
    [
        {
            "id": task_id,
            "title": "%s module" % mod,
            "files": ["tests/test_%s.py" % mod, "textkit/%s.py" % mod],
            "depends_on": [],
            "interfaces": {"consumes": [], "produces": []},
            "tier": None,
            "review": "lean",
            "writes": ["textkit/%s.py" % mod],
            "commutes": [],
            "testCmd": None,
        }
        for task_id, mod in [("1", "word_count"), ("2", "truncate"),
                             ("3", "titlecase"), ("4", "redact"),
                             ("5", "ngrams"), ("6", "reverse_words")]
    ],
]

BASE_CLAIMS_CHECK = (
    'PLAN OK\n'
    'ADVISORY grammar: Context is 24 words — task 1\n'
    'ADVISORY grammar: Machine line carries no numbered clauses — task 1; write it `M1. … M2. …` so every Proof leg can cite the clause it establishes (`[M1]`)\n'
    'ADVISORY grammar: Context is 27 words — task 2\n'
    'ADVISORY grammar: Machine line carries no numbered clauses — task 2; write it `M1. … M2. …` so every Proof leg can cite the clause it establishes (`[M1]`)\n'
    'ADVISORY grammar: Context is 26 words — task 3\n'
    'ADVISORY grammar: Machine line carries no numbered clauses — task 3; write it `M1. … M2. …` so every Proof leg can cite the clause it establishes (`[M1]`)\n')

BASE_WIDE_CHECK = "PLAN OK\n"


def _waves_without_proof_tests(payload):
    return [[{k: v for k, v in e.items() if k != "proofTests"} for e in wave]
            for wave in payload["waves"]]


def _check_renders(fixture):
    """The plan-determined lines of `--check --renders` stdout.

    The whole render is a function of the tree, not of the plan alone: its
    blast-radius paragraphs list every tracked code file mentioning a task's
    Produces symbols, so a file some other task adds turns a whole-stdout pin
    red for a reason that has nothing to do with the compiler (#563). What
    this pin compares is the two kinds of line the plan text alone decides —
    the `PLAN OK` verdict and every `ADVISORY grammar:` line."""
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(fixture), "--check", "--renders"],
        capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    return "".join(line for line in p.stdout.splitlines(True)
                   if line == "PLAN OK\n"
                   or line.startswith("ADVISORY grammar:"))


def test_claims_fixture_entries_keep_every_other_key_at_its_base_value(tmp_path):
    payload = _emit_args(tmp_path, CLAIMS_FIXTURE)
    assert _waves_without_proof_tests(payload) == BASE_CLAIMS_WAVES


def test_wide_fixture_entries_keep_every_other_key_at_its_base_value(tmp_path):
    payload = _emit_args(tmp_path, WIDE_FIXTURE)
    assert _waves_without_proof_tests(payload) == BASE_WIDE_WAVES


def test_claims_fixture_check_renders_stdout_is_unchanged():
    assert _check_renders(CLAIMS_FIXTURE) == BASE_CLAIMS_CHECK


def test_wide_fixture_check_renders_stdout_is_unchanged():
    assert _check_renders(WIDE_FIXTURE) == BASE_WIDE_CHECK
