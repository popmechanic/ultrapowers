"""The compiler reads `Run:` proofs (task 1, plan run-64).

A claims-v1 Proof may name a COMMAND instead of (or beside) an exam file:
a bullet `- Run: <command>` is a proof run. This exam pins the six Machine
clauses of that grammar, leg by leg:

  M1 / leg (a) — `- Run: <command>` bullets fill `proof_runs` on the task's
    claims dict: the `<command>` strings verbatim, leading/trailing whitespace
    stripped and NOTHING else altered, in Proof order (a whole-value backtick
    wrapper is stripped, as it is for `Test:`).
  M2 / leg (b) — a Proof with `Run:` bullets and no `Test:` bullet draws no
    `grammar:` violation; `proof_tests` is `[]`, `testCmd` is `None`, and the
    compiled task object's `proofRuns` is that list.
  M3 / leg (c) — `Test:` and `Run:` bullets fill their own lists; the
    Proof/implementation disjointness rule still fires for a `Test:` path that
    is also a `Modify:` path, and never for a `Run:` command naming that path.
  M4 / leg (d) — `Run:` bullets are not legs: `parse_proof_legs` skips them the
    way it skips `Test:` bullets, so one draws no "cites no Machine clause"
    refusal and cites nothing.
  M5 / leg (e) — every fixture plan under `evals/fixtures/*/` and
    `tests/fixtures/plans/` that carries no `Run:` bullet gets `--check` output
    byte-identical to the BASE compiler's, the BASE compiler being the blob at
    the frozen sha 0a3559a (never `HEAD:`, which is a tautology once merged).
  M6 / leg (f) — every compiled task object carries `proofRuns`: `[]` for a
    task without `Run:` bullets, both commands for a task with two.

`proof_runs` is read off the claims dict `parse_claims_body` returns (the
function that fills a task's `claims`); `proofRuns` is read off the wave
entries `--emit-args` writes, beside `proofTests` and `testCmd`.
"""
import fcntl
import json
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
COMPILER_REL = "skills/ultrapowers/scripts/compile_plan.py"
# The frozen BASE sha leg (e) compares against. Never `HEAD:` — once this task
# merges, HEAD is the edited compiler and the comparison proves nothing.
BASE_SHA = "0a3559a2e0c9998553c0c725e5510e20e5802b1b"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    gate_input_hash,
    parse_claims_body,
    parse_proof_legs,
    split_tasks,
    verdicts_path,
)

HEADER = ("# Plan: The compiler reads `Run:` proofs\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# The two-clause Machine line every fixture task below restates. It NUMBERS its
# clauses, so the clause-to-leg citation grammar is active for every task here —
# which is what makes leg (d)'s "no refusal for the `Run:` bullet" a live check.
MACHINE = ("Machine: M1. The parser keeps the command verbatim. "
           "M2. The compiled entry carries it.\n")


def _task(task_id, files, proof):
    """One claims-v1 task carrying all six slots.

    `files` is the Files-block bullet lines, `proof` the Proof-slot bullet
    lines (each without its trailing newline).
    """
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator names the command that proves the task. "
            "(quoted from #589)\n"
            "%s"
            "\n"
            "**Authorized-by:** #589\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `run_probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no runner of its own yet, so nothing "
            "reads a command.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #589\n"
            % (task_id, task_id,
               "".join(line + "\n" for line in files),
               MACHINE, task_id,
               "".join(line + "\n" for line in proof)))


def _body(task_text):
    """The one task body inside a rendered task section."""
    tasks = split_tasks(HEADER + task_text)
    assert len(tasks) == 1, "fixture must render exactly one task"
    return tasks[0]["body"]


def _claims(task_text):
    return parse_claims_body(_body(task_text), "1")


def _runs(claims):
    """`proof_runs` off a claims dict, with the absent-key failure named."""
    assert "proof_runs" in claims, (
        "M1: the claims dict must carry `proof_runs` — found keys %s"
        % sorted(claims))
    return claims["proof_runs"]


def _proof_runs_of(entry):
    """`proofRuns` off a compiled task object, with the absent-key failure
    named."""
    assert "proofRuns" in entry, (
        "M6: the compiled task object must carry `proofRuns` beside "
        "`proofTests`/`testCmd` — found keys %s" % sorted(entry))
    return entry["proofRuns"]


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


def _write_plan(tmp_path, *tasks, name="plan.md"):
    plan = tmp_path / name
    plan.write_text(HEADER + "\n".join(tasks))
    return _sign(plan)


def _check(plan):
    """`--check` on a plan: (returncode, stdout)."""
    p = subprocess.run([sys.executable, str(COMPILER), str(plan), "--check"],
                       capture_output=True, text=True, cwd=str(ROOT))
    return p.returncode, p.stdout


def _emit_args(tmp_path, plan_path, name="args"):
    """Compile `plan_path` with --emit-launch --emit-args; return the parsed
    args payload and the compile's own stdout payload."""
    launch = tmp_path / (name + ".launch.json")
    argsf = tmp_path / (name + ".args.json")
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(plan_path),
         "--emit-launch", str(launch), "--emit-args", str(argsf)],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, p.stdout + p.stderr
    return json.loads(argsf.read_text()), json.loads(p.stdout)


def _entries(payload):
    """Every wave entry, flattened, keyed by task id."""
    return {e["id"]: e for wave in payload["waves"] for e in wave}


def _compile_tasks(tmp_path, *tasks):
    plan = _write_plan(tmp_path, *tasks)
    payload, _ = _emit_args(tmp_path, plan)
    return _entries(payload)


# The Proof bullet the grammar defines; used to skip a corpus plan that has
# adopted one (leg (e) speaks only about plans that carry none).
RUN_BULLET_RE = re.compile(r"^[-*+]\s*Run:\s", re.M)

# The two commands leg (a) names: one bare, one wholly backticked.
RUN_BULLETS = ["- Run: python3 -m pytest -q tests/x.py",
               "- Run: `node check.mjs --strict`"]
RUN_COMMANDS = ["python3 -m pytest -q tests/x.py", "node check.mjs --strict"]

# Lettered legs, each citing one of MACHINE's two clauses.
LETTERED_LEGS = ["- Legs: (a) the command rides verbatim [M1]; (b) the "
                 "compiled entry carries it [M2]."]
# The same two legs as ordinal bullets. In this form EVERY prose bullet is a
# leg, so a `Run:` bullet the parser failed to skip would be leg #1 — citing
# nothing, and refused.
BULLET_LEGS = ["- The command rides verbatim [M1].",
               "- The compiled entry carries it [M2]."]


# --- (a) [M1] the commands, verbatim, in Proof order ------------------------

def test_run_bullets_fill_proof_runs_verbatim_in_proof_order():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           RUN_BULLETS + LETTERED_LEGS))
    assert _runs(claims) == RUN_COMMANDS, (
        "leg (a) [M1]: `proof_runs` is the `<command>` strings in Proof "
        "order; the second bullet is wholly backticked, so its backticks are "
        "stripped as a `Test:` value's are")


def test_run_bullet_whitespace_is_stripped_at_the_ends_only():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           ["- Run:   echo  two  spaces  "] + LETTERED_LEGS))
    assert _runs(claims) == ["echo  two  spaces"], (
        "leg (a) [M1]: leading and trailing whitespace is stripped, nothing "
        "else altered — the internal double spaces survive")


def test_a_command_that_is_not_wholly_backticked_is_not_rewritten():
    inner = "- Run: node -e \"console.log(`hi`)\""
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           [inner] + LETTERED_LEGS))
    assert _runs(claims) == ["node -e \"console.log(`hi`)\""], (
        "leg (a) [M1]: only a WHOLE-value backtick wrapper is stripped; a "
        "command carrying backticks inside it rides verbatim")


def test_a_proof_with_no_run_bullet_has_no_proof_runs():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           ["- Test: `tests/test_one.py`"] + LETTERED_LEGS))
    assert _runs(claims) == [], (
        "leg (a) [M1]: `proof_runs` is empty when the Proof names no `Run:`")


# --- (b) [M2] a Run-only Proof compiles clean -------------------------------

def test_run_only_task_draws_no_grammar_violation():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           RUN_BULLETS + LETTERED_LEGS))
    assert [v for v in claims["violations"] if v.startswith("grammar:")] == [], (
        "leg (b) [M2]: a Proof whose bullets are `Run:` and legs draws no "
        "`grammar:` violation")


def test_run_only_plan_checks_ok(tmp_path):
    plan = _write_plan(tmp_path, _task("1", ["- Create: `app/one.py`"],
                                       RUN_BULLETS + LETTERED_LEGS))
    rc, stdout = _check(plan)
    assert (rc, stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "leg (b) [M2]: `--check` accepts a Run-only Proof; got:\n" + stdout)


def test_run_only_task_has_empty_proof_tests_and_no_test_command(tmp_path):
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           RUN_BULLETS + LETTERED_LEGS))
    assert claims["proof_tests"] == []
    assert claims["proof_tests_ordered"] == []
    entry = _compile_tasks(tmp_path, _task("1", ["- Create: `app/one.py`"],
                                           RUN_BULLETS + LETTERED_LEGS))["1"]
    assert entry["proofTests"] == []
    assert entry["testCmd"] is None, (
        "leg (b) [M2]: a `Run:` command is never fed to derive_task_test_cmd")
    assert _proof_runs_of(entry) == RUN_COMMANDS, (
        "leg (b) [M2]: the compiled object's `proofRuns` equals `proof_runs`")


# --- (c) [M3] Test: and Run: side by side, and disjointness -----------------

def test_test_and_run_bullets_each_carry_their_own_list(tmp_path):
    proof = ["- Test: `tests/test_two.py`",
             "- Run: bash scripts/smoke.sh"] + LETTERED_LEGS
    claims = _claims(_task("1", ["- Create: `app/two.py`"], proof))
    assert claims["proof_tests_ordered"] == ["tests/test_two.py"]
    assert _runs(claims) == ["bash scripts/smoke.sh"]
    entry = _compile_tasks(tmp_path,
                           _task("1", ["- Create: `app/two.py`"], proof))["1"]
    assert entry["proofTests"] == ["tests/test_two.py"]
    assert _proof_runs_of(entry) == ["bash scripts/smoke.sh"], (
        "leg (c) [M3]: the two bullet kinds fill two lists")
    assert entry["testCmd"] == "python3 -m pytest -q tests/test_two.py", (
        "leg (c) [M3]: `testCmd` still derives from the `Test:` paths alone")


DISJOINT_VIOLATION = (
    "grammar: Proof test paths must be disjoint from implementation paths — "
    "task 1: `app/shared.py` is both a Proof `Test:` path and a "
    "`Create:`/`Modify:` path")


def test_a_test_path_that_is_also_modified_still_draws_the_disjointness_refusal():
    claims = _claims(_task("1", ["- Modify: `app/shared.py`"],
                           ["- Test: `app/shared.py`"] + LETTERED_LEGS))
    assert claims["violations"] == [DISJOINT_VIOLATION], (
        "leg (c) [M3]: the disjointness rule applies to `Test:` paths exactly "
        "as at BASE")


def test_a_run_command_naming_a_modified_path_draws_nothing(tmp_path):
    proof = ["- Run: python3 -m pytest -q app/shared.py"] + LETTERED_LEGS
    claims = _claims(_task("1", ["- Modify: `app/shared.py`"], proof))
    assert claims["violations"] == [], (
        "leg (c) [M3]: a `Run:` value is a command, not a path — it is never "
        "part of the disjointness set")
    assert _runs(claims) == ["python3 -m pytest -q app/shared.py"]
    plan = _write_plan(tmp_path, _task("1", ["- Modify: `app/shared.py`"],
                                       proof))
    rc, stdout = _check(plan)
    assert (rc, stdout.splitlines()[:1]) == (0, ["PLAN OK"]), stdout


# --- (d) [M4] a Run: bullet is not a leg ------------------------------------

def test_parse_proof_legs_skips_a_run_bullet_the_way_it_skips_test():
    proof = "\n".join(RUN_BULLETS + BULLET_LEGS) + "\n"
    assert parse_proof_legs(proof) == [
        {"label": "#1", "text": "The command rides verbatim [M1].",
         "cites": ["M1"]},
        {"label": "#2", "text": "The compiled entry carries it [M2].",
         "cites": ["M2"]},
    ], ("leg (d) [M4]: `Run:` bullets are absent from parse_proof_legs's "
        "output, and the remaining legs number from #1 — exactly what a "
        "`Test:` bullet does")


def test_a_run_bullet_among_ordinal_legs_draws_no_uncited_leg_refusal():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           RUN_BULLETS + BULLET_LEGS))
    assert claims["violations"] == [], (
        "leg (d) [M4]: a `Run:` bullet cites nothing and is refused for "
        "nothing — it is not a leg")
    assert [leg["label"] for leg in claims["proof_legs"]] == ["#1", "#2"]


def test_a_run_bullet_beside_lettered_legs_draws_no_uncited_leg_refusal():
    claims = _claims(_task("1", ["- Create: `app/one.py`"],
                           RUN_BULLETS[:1] + LETTERED_LEGS))
    assert claims["violations"] == [], (
        "leg (d) [M4]: one `Run:` bullet plus lettered legs — no \"cites no "
        "Machine clause\" violation for the bullet")
    assert [leg["label"] for leg in claims["proof_legs"]] == ["(a)", "(b)"]
    assert all("Run:" not in leg["text"] for leg in claims["proof_legs"])


# --- (e) [M5] the fixture corpus is byte-identical against the BASE blob ----

CORPUS = (sorted((ROOT / "evals/fixtures").glob("*/plan.md"))
          + sorted((ROOT / "tests/fixtures/plans").glob("*.md")))


@pytest.fixture(scope="module")
def base_compiler(tmp_path_factory):
    """The compiler as of the frozen BASE sha, written to a temp file. A
    depth-1 checkout (CI) does not hold BASE; fetch exactly that commit from
    origin, which serves any reachable sha.

    Five test modules share this fixture (two call it as a plain function), so
    under xdist several workers reach the fetch at once — and concurrent
    fetches into one repository lose on `.git/shallow.lock`: three of four exit
    128 and the loser's `git show` then reports the sha as absent (CI run
    33980815350 on 3e5ce33, 2026-09-05; reproduced 24/32 in fresh depth-1
    clones). So the probe-and-fetch runs under one file lock shared by every
    worker, each worker re-probes after taking it, and a fetch that fails is a
    failure here, not a silent one."""
    lock_path = tmp_path_factory.getbasetemp().parent / "ultra-base-sha.lock"
    with open(lock_path, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            probe = subprocess.run(
                ["git", "cat-file", "-e", BASE_SHA + "^{commit}"],
                cwd=str(ROOT), capture_output=True)
            if probe.returncode != 0:
                fetch = subprocess.run(
                    ["git", "fetch", "-q", "--depth=1", "origin", BASE_SHA],
                    cwd=str(ROOT), capture_output=True)
                assert fetch.returncode == 0, fetch.stderr.decode(
                    "utf-8", "replace")
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    blob = subprocess.run(["git", "show", "%s:%s" % (BASE_SHA, COMPILER_REL)],
                          cwd=str(ROOT), capture_output=True)
    assert blob.returncode == 0, blob.stderr.decode("utf-8", "replace")
    path = tmp_path_factory.mktemp("base") / "compile_plan.py"
    path.write_bytes(blob.stdout)
    return path


def _check_bytes(compiler, plan):
    p = subprocess.run([sys.executable, str(compiler), str(plan), "--check"],
                       capture_output=True, cwd=str(ROOT))
    return p.returncode, p.stdout, p.stderr


def test_the_fixture_corpus_is_not_empty():
    assert len(CORPUS) >= 15, (
        "leg (e) [M5]: the witnesses are the fixture plans themselves — "
        "found only %d" % len(CORPUS))


def test_every_run_less_fixture_plan_checks_byte_identically_to_base(base_compiler):
    compared, differing = [], []
    for plan in CORPUS:
        if RUN_BULLET_RE.search(plan.read_text()):
            continue
        compared.append(plan)
        if _check_bytes(COMPILER, plan) != _check_bytes(base_compiler, plan):
            differing.append(str(plan.relative_to(ROOT)))
    assert compared, "leg (e) [M5]: no Run-less fixture plan was compared"
    assert differing == [], (
        "leg (e) [M5]: `Run:` is additive — `--check` output must stay "
        "byte-identical to the BASE compiler (%s) for every plan carrying no "
        "`Run:` bullet; these differ: %s" % (BASE_SHA[:7], differing))


def test_the_base_blob_is_not_the_current_compiler(base_compiler):
    assert base_compiler.read_bytes() != COMPILER.read_bytes(), (
        "leg (e) [M5]: the frozen-sha comparison is vacuous until the "
        "compiler actually changes — %s is unedited" % COMPILER_REL)


# --- (f) [M6] proofRuns on every compiled task object -----------------------

def test_a_run_less_task_carries_the_empty_list(tmp_path):
    entry = _compile_tasks(tmp_path, _task(
        "1", ["- Create: `app/one.py`"],
        ["- Test: `tests/test_one.py`"] + LETTERED_LEGS))["1"]
    assert _proof_runs_of(entry) == [], (
        "leg (f) [M6]: `[]` for a task without `Run:` bullets")


def test_a_two_run_task_carries_both_commands_in_proof_order(tmp_path):
    entry = _compile_tasks(tmp_path, _task(
        "1", ["- Create: `app/one.py`"], RUN_BULLETS + LETTERED_LEGS))["1"]
    assert _proof_runs_of(entry) == RUN_COMMANDS


def test_the_key_is_absent_from_no_compiled_task_object(tmp_path):
    plan = _write_plan(
        tmp_path,
        _task("1", ["- Create: `app/one.py`"], RUN_BULLETS + LETTERED_LEGS),
        _task("2", ["- Create: `app/two.py`"],
              ["- Test: `tests/test_two.py`"] + LETTERED_LEGS))
    payload, stdout_payload = _emit_args(tmp_path, plan)
    entries = [e for wave in payload["waves"] for e in wave]
    assert len(entries) == 2
    assert all("proofRuns" in e for e in entries), (
        "leg (f) [M6]: every wave entry carries the key — found %s"
        % [sorted(e) for e in entries])
    assert {e["id"]: e["proofRuns"] for e in entries} == {
        "1": RUN_COMMANDS, "2": []}
    launch = [e for wave in stdout_payload["launch_waves"] for e in wave]
    assert {e["id"]: e.get("proofRuns") for e in launch} == {
        "1": RUN_COMMANDS, "2": []}, (
        "leg (f) [M6]: the compiled task object on stdout carries it too")


@pytest.mark.parametrize("fixture", ["evals/fixtures/claims/plan.md",
                                     "evals/fixtures/wide/plan.md"])
def test_fixture_plan_entries_all_carry_the_empty_list(tmp_path, fixture):
    payload, _ = _emit_args(tmp_path, ROOT / fixture)
    entries = [e for wave in payload["waves"] for e in wave]
    assert entries, "expected %s to compile to wave entries" % fixture
    assert [_proof_runs_of(e) for e in entries] == [[]] * len(entries), (
        "leg (f) [M6]: a plan with no `Run:` bullet — claims-v1 or legacy — "
        "carries `[]` on every task object")
