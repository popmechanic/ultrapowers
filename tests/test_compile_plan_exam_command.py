"""The plan-declared exam command, and the refusal that makes silence loud (#644).

Task 1's exam for the compiler half. Two rules land in `compile_plan.py`:

* the refusal — a `**Review:** peer` task whose Proof names a `Test:` path in
  none of the three built-in shapes (`fleet/tests/test_*.mjs`, `tests/**/*.py`,
  `tests/**/*.test.ts`), on a plan whose header carries no `**Exam command:**`
  line, is an `exam-shape:` violation: `--check` prints it and exits 2. Peer
  review on a project whose exam the fleet cannot run is the silence #644's
  decision 2 ("Make silence impossible first") refuses;
* the declaration — a header line `**Exam command:** <template>` carrying
  `{paths}` exactly once makes every task's `testCmd` that template with
  `{paths}` replaced by the task's Proof `Test:` paths, space-joined in Proof
  order. Zero or two `{paths}` is an `exam-command:` violation.

Offline: every case writes its own claims-v1 plan (and its gate-verdict
record, which claims-v1 refuses to compile without) under `tmp_path` and runs
the committed compiler against it.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402
from compile_plan import (  # noqa: E402
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

HEADER = ("# Plan: The exam command\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — compiler fixture; this plan is compiled, "
          "never executed\n"
          "\n")

# The declared template of legs (c): `{paths}` exactly once.
EXAM_LINE = "**Exam command:** npx vitest run {paths}\n\n"


def _task(task_id, proof_tests=(), review=None, proof_runs=()):
    """One claims-v1 task carrying all six body slots. `proof_tests` is the
    Proof slot's `Test:` bullets in Proof order (possibly empty — a Proof may
    name only a `Run:`); `review` writes the `**Review:**` marker when given
    and omits the line entirely when None (which the compiler reads as lean)."""
    proof = ("**Proof:**\n"
             + "".join("- Test: `%s`\n" % p for p in proof_tests)
             + "".join("- Run: %s\n" % r for r in proof_runs)
             + "- Legs: (a) the constructor returns a widget of the given "
               "size [M1].\n")
    marker = "**Review:** %s\n" % review if review else ""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "%s"
            "\n"
            "**Files:**\n"
            "- Create: `app/mod_%s.py`\n"
            "\n"
            "**Claim:** An operator gets a widget. (quoted from #489)\n"
            "Machine: M1. `make_widget_%s(3)` returns a `Widget` whose `size` "
            "is `3`.\n"
            "\n"
            "**Authorized-by:** #489\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `make_widget_%s(n: int) -> Widget`\n"
            "\n"
            "**Context:** The repo has no widget module of its own yet, so "
            "this task creates one.\n"
            "\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #489\n"
            "\n"
            % (task_id, task_id, marker, task_id, task_id, task_id, proof))


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile or check one without (spec §4.5)."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in split_tasks(plan.read_text()):
        claims = parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": gate_input_hash(claims["claim"], claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _plan(tmp_path, header, tasks, name="plan"):
    plan = tmp_path / (name + ".md")
    plan.write_text(header + "".join(tasks))
    return _sign(plan)


def _check(plan):
    return subprocess.run([sys.executable, str(COMPILER), str(plan), "--check"],
                          capture_output=True, text=True)


def _violations(stdout, species):
    """The `--check` violation blocks whose species word is `species`. The
    check prints every violation separated by a blank line, then the tally."""
    return [b.strip() for b in stdout.split("\n\n") if b.strip().startswith(species)]


def _entries(tmp_path, plan, name="args"):
    """Every wave entry of a full `--emit-launch --emit-args` compile, by id."""
    launch = tmp_path / (name + ".launch.json")
    args_path = tmp_path / (name + ".args.json")
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(plan), "--emit-launch", str(launch),
         "--emit-args", str(args_path)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    payload = json.loads(args_path.read_text())
    return {e["id"]: e for wave in payload["waves"] for e in wave}


# --- leg (a) [M1]: peer + an unmatched Proof path + no header line = refusal --

def test_peer_task_with_unrunnable_proof_path_and_no_exam_command_is_refused(
        tmp_path):
    plan = _plan(tmp_path, HEADER,
                 [_task("1", ["src/widget.test.js"], review="peer")])
    r = _check(plan)
    assert r.returncode == 2, "expected --check to refuse\n" + r.stdout + r.stderr
    blocks = _violations(r.stdout, "exam-shape: task")
    assert len(blocks) == 1, "expected one exam-shape violation\n" + r.stdout
    assert blocks[0].startswith("exam-shape: task 1"), blocks[0]
    # It names the path it cannot run, and it names the way out.
    assert "src/widget.test.js" in blocks[0], blocks[0]
    assert "Exam command" in blocks[0], blocks[0]


# --- leg (b) [M2]: the refusal fires only for the pair peer-and-unmatched ----

def test_the_same_plan_unmarked_is_clean(tmp_path):
    # The `**Review:**` line deleted: lean review never had an examiner to
    # lose, so the same unrunnable path is not a refusal.
    plan = _plan(tmp_path, HEADER, [_task("1", ["src/widget.test.js"])])
    r = _check(plan)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.splitlines()[0] == "PLAN OK", r.stdout
    assert _violations(r.stdout, "exam-shape") == []


def test_the_same_peer_plan_with_a_built_in_shape_is_clean(tmp_path):
    # `tests/widget.test.ts` is the Bun shape the table already knows, so the
    # fleet can run this task's exam and peer review keeps its examiner.
    plan = _plan(tmp_path, HEADER,
                 [_task("1", ["tests/widget.test.ts"], review="peer")])
    r = _check(plan)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.splitlines()[0] == "PLAN OK", r.stdout
    assert _violations(r.stdout, "exam-shape") == []


def test_a_peer_task_naming_no_test_path_is_not_refused(tmp_path):
    # M1's antecedent is a NAMED `Test:` path the table cannot run. A peer task
    # whose Proof names none never had an exam to lose — its peer review is the
    # second reviewer, and the refusal must not fire.
    plan = _plan(tmp_path, HEADER,
                 [_task("1", [], review="peer", proof_runs=["echo hi"])])
    r = _check(plan)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.splitlines()[0] == "PLAN OK", r.stdout
    assert _violations(r.stdout, "exam-shape") == []


# --- leg (c) [M3]: the declared template, one row per built-in shape ---------

FIVE_TASKS = (_task("1", ["src/a.test.js", "src/b.test.js"]),
              _task("2", ["tests/c.py"]),
              _task("3", ["fleet/tests/test_x.mjs"]),
              _task("4", ["tests/a.test.ts"]),
              _task("5", [], proof_runs=["echo hi"]))


def test_the_declared_template_substitutes_every_tasks_proof_paths(tmp_path):
    plan = _plan(tmp_path, HEADER + EXAM_LINE, FIVE_TASKS, name="declared")
    entries = _entries(tmp_path, plan, name="declared")
    # The template wins for every task naming at least one `Test:` path —
    # including the three paths the built-in table could have derived itself.
    assert entries["1"]["testCmd"] == "npx vitest run src/a.test.js src/b.test.js"
    assert entries["2"]["testCmd"] == "npx vitest run tests/c.py"
    assert entries["3"]["testCmd"] == "npx vitest run fleet/tests/test_x.mjs"
    assert entries["4"]["testCmd"] == "npx vitest run tests/a.test.ts"
    # A task naming no `Test:` path keeps its null: there are no paths to
    # substitute, so there is no exam to run.
    assert entries["5"]["testCmd"] is None
    # The paths themselves still ride, in Proof order.
    assert entries["1"]["proofTests"] == ["src/a.test.js", "src/b.test.js"]


def test_without_the_header_line_the_built_in_derivation_is_unchanged(tmp_path):
    plan = _plan(tmp_path, HEADER, FIVE_TASKS, name="silent")
    entries = _entries(tmp_path, plan, name="silent")
    assert entries["1"]["testCmd"] is None
    assert entries["2"]["testCmd"] == "python3 -m pytest -q tests/c.py"
    assert entries["3"]["testCmd"] == "node fleet/tests/test_x.mjs"
    assert entries["4"]["testCmd"] == "bun test tests/a.test.ts"
    assert entries["5"]["testCmd"] is None


# --- leg (d) [M4]: a template carrying `{paths}` any number but once ---------

def test_a_template_without_the_paths_token_is_a_violation(tmp_path):
    plan = _plan(tmp_path, HEADER + "**Exam command:** npx vitest run\n\n",
                 [_task("1", ["tests/c.py"])], name="zero")
    r = _check(plan)
    assert r.returncode == 2, "expected --check to refuse\n" + r.stdout + r.stderr
    blocks = _violations(r.stdout, "exam-command:")
    assert len(blocks) == 1, "expected one exam-command violation\n" + r.stdout


def test_a_template_with_two_paths_tokens_is_a_violation(tmp_path):
    plan = _plan(tmp_path, HEADER + "**Exam command:** {paths} {paths}\n\n",
                 [_task("1", ["tests/c.py"])], name="twice")
    r = _check(plan)
    assert r.returncode == 2, "expected --check to refuse\n" + r.stdout + r.stderr
    blocks = _violations(r.stdout, "exam-command:")
    assert len(blocks) == 1, "expected one exam-command violation\n" + r.stdout


# --- the produced helpers, called directly ----------------------------------

def test_parse_exam_command_reads_the_header_line_and_only_the_header(tmp_path):
    # Produces: `parse_exam_command(md_text: str) -> str | None`
    declared = HEADER + EXAM_LINE + _task("1", ["tests/c.py"])
    assert compile_plan.parse_exam_command(declared) == "npx vitest run {paths}"
    # Absent from the header: None, and the plan parses as it did before #644.
    assert compile_plan.parse_exam_command(HEADER + _task("1", ["tests/c.py"])) is None
    # A line in a TASK body is not a plan-level declaration — the header is
    # everything above the first task heading.
    in_body = HEADER + _task("1", ["tests/c.py"]) + EXAM_LINE
    assert compile_plan.parse_exam_command(in_body) is None


def test_exam_command_violations_pins_the_token_count(tmp_path):
    # Produces: `exam_command_violations(md_text: str) -> list[str]`
    body = _task("1", ["tests/c.py"])
    assert compile_plan.exam_command_violations(HEADER + body) == []
    assert compile_plan.exam_command_violations(HEADER + EXAM_LINE + body) == []
    for template in ("npx vitest run", "{paths} {paths}"):
        line = "**Exam command:** %s\n\n" % template
        found = compile_plan.exam_command_violations(HEADER + line + body)
        assert len(found) == 1, (template, found)
        assert found[0].startswith("exam-command:"), found[0]
