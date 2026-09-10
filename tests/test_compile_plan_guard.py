"""`Guard:` in the compiler (task 2, plan run-66).

A claims-v1 Proof may carry `- Guard: <path>` bullets: paths the task asserts
its change must not silently break. A `Guard:` is a task field, not new frozen
vocabulary — it is read into the claims dict and written out beside the Proof's
tests and runs. It is never a `grammar:` refusal. This exam pins the two
Machine clauses that survive the advisory tier's deletion, leg by leg:

  M1 / leg (a) — `parse_claims_body` reads every `- Guard: <path>` bullet of
    the Proof slot (backticks stripped, whitespace trimmed, first occurrence
    kept, Proof order) into `claims["proof_guards"]`, and `--emit-args` writes
    `proofGuards` on EVERY wave entry: that list for a claims-v1 task, `[]` for
    a task naming none and for a legacy-grammar body.
  M4 / leg (e) — a `Guard:` bullet is neither a `Test:` path nor a `Run:`
    command: it is absent from `proofTests` and from `proofRuns`, derives no
    `testCmd` of its own, draws no `grammar:` refusal, and a plan whose only
    change is a `Guard:` bullet still prints `PLAN OK` — byte-identically to
    the same plan with the bullet deleted.

`proof_guards` is read off the claims dict `parse_claims_body` returns (the
function that fills a task's `claims`); `proofGuards` is read off the wave
entries `--emit-args` writes, beside `proofTests`, `testCmd` and `proofRuns`.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
# The legacy-grammar corpus fixture leg (a)'s last clause reads: it carries no
# `**Grammar:** claims-v1` marker, so no task of it has a claims body at all.
WIDE_FIXTURE = ROOT / "evals/fixtures/wide/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)


# --------------------------------------------------------------------------- #
# Fixture plans                                                                #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: `Guard:` in the compiler\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived \u2014 inline test plan\n"
          "\n")

# The Machine line every fixture task restates. It NUMBERS its clauses, so the
# clause-to-leg citation grammar is active on every fixture here — which is
# what keeps M4's "draws no `grammar:` line" a live check rather than a check
# run under a grammar that refuses nothing.
MACHINE = ("Machine: M1. The parser reads the guard. "
           "M2. The render names it.\n")


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
            "**Claim:** An operator sees each guard checked against the "
            "task's own Files. (quoted from #777)\n"
            "%s"
            "\n"
            "**Authorized-by:** #777\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no guard reader of its own yet, so "
            "nothing checks a guard path against the task's Files block "
            "today.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #777\n"
            % (task_id, task_id,
               "".join(line + "\n" for line in files),
               MACHINE, task_id,
               "".join(line + "\n" for line in proof)))


LEGS = "- Legs: (a) the guard rides beside the exam [M1][M2]."

# --- leg (a) / leg (e): THE guarded task ------------------------------------ #
# Its `Guard:` path is a Files path AND a Proof `Test:` path.
GUARDED_FILES = ["- Create: `app/probe_1.py`", "- Test: `tests/test_w.py`"]
GUARDED_PROOF = ["- Test: `tests/test_w.py`",
                 "- Guard: `tests/test_w.py`",
                 LEGS]
GUARDED_TASK = _task("1", GUARDED_FILES, GUARDED_PROOF)
# leg (e): the SAME plan with the `Guard:` bullet deleted and nothing else
# changed — the byte-identity comparand.
UNGUARDED_TASK = _task(
    "1", GUARDED_FILES, [l for l in GUARDED_PROOF if "Guard:" not in l])

# --- leg (a): a sibling task naming no `Guard:` at all ---------------------- #
SIBLING_TASK = _task("2", ["- Create: `app/probe_2.py`",
                           "- Test: `tests/test_s.py`"],
                     ["- Test: `tests/test_s.py`", LEGS])

# --- leg (a): repeated and interleaved `Guard:` bullets --------------------- #
# `tests/test_w.py`, then `tests/test_v.py`, then `tests/test_w.py` again;
# neither path is in the Files block, so M2's first half fires for both — twice,
# not three times, because the repeat is not a second guard.
REPEAT_TASK = _task("1", ["- Create: `app/probe_1.py`"],
                    ["- Test: `tests/test_w.py`",
                     "- Guard: `tests/test_w.py`",
                     "- Guard: `tests/test_v.py`",
                     "- Guard: `tests/test_w.py`",
                     LEGS])

# --- leg (a) [M1]: the value is trimmed and its backticks stripped ---------- #
PADDED_TASK = _task("1", GUARDED_FILES,
                    ["- Test: `tests/test_w.py`",
                     "- Guard:   `tests/test_w.py`   ",
                     LEGS])

# --- leg (c): a guard path in neither the Files block nor the Proof --------- #
ELSEWHERE = "tests/test_elsewhere.py"
ELSEWHERE_TASK = _task("1", GUARDED_FILES,
                       ["- Test: `tests/test_w.py`",
                        "- Guard: `%s`" % ELSEWHERE,
                        LEGS])


# --------------------------------------------------------------------------- #
# Driving the compiler                                                         #
# --------------------------------------------------------------------------- #
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


def _write(tmp_path, name, *tasks):
    plan = tmp_path / name
    plan.write_text(HEADER + "\n".join(tasks))
    return _sign(plan)


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _emit_args(tmp_path, plan_path, name="args"):
    """Compile `plan_path` with --emit-launch --emit-args; return the parsed
    args payload."""
    launch = tmp_path / (name + ".launch.json")
    argsf = tmp_path / (name + ".args.json")
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(plan_path),
         "--emit-launch", str(launch), "--emit-args", str(argsf)],
        capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    return json.loads(argsf.read_text())


def _entries(payload):
    """Every wave entry, flattened, keyed by task id."""
    return {e["id"]: e for wave in payload["waves"] for e in wave}


def _compile_tasks(tmp_path, *tasks):
    return _entries(_emit_args(tmp_path, _write(tmp_path, "plan.md", *tasks)))


def _claims(task_text):
    tasks = split_tasks(HEADER + task_text)
    assert len(tasks) == 1, "fixture must render exactly one task"
    return parse_claims_body(tasks[0]["body"], tasks[0]["id"])


def _guards(claims):
    """`proof_guards` off a claims dict, with the absent-key failure named."""
    assert "proof_guards" in claims, (
        "M1: the claims dict `parse_claims_body` returns must carry "
        "`proof_guards` beside `proof_tests_ordered`/`proof_runs` \u2014 found "
        "keys %s" % sorted(claims))
    return claims["proof_guards"]


def _proof_guards_of(entry):
    """`proofGuards` off a wave entry, with the absent-key failure named."""
    assert "proofGuards" in entry, (
        "M1: `--emit-args` must write `proofGuards` on every wave entry, "
        "beside `proofTests`/`testCmd`/`proofRuns` \u2014 found keys %s"
        % sorted(entry))
    return entry["proofGuards"]


def _no_grammar_refusal(stdout, leg):
    """M4's "draws no `grammar:` line", in its refusal sense.

    A violation prints as a bare `grammar: …` paragraph (`collect_violations`
    output, exit 2). So the live assertion is that no line OPENS the refusal
    channel."""
    refusals = [l for l in stdout.splitlines() if l.strip().startswith("grammar:")]
    assert refusals == [], (
        "%s [M4]: a `Guard:` bullet draws no `grammar:` refusal \u2014 the "
        "compiler's diagnostic vocabulary gains no word; got:\n%s"
        % (leg, "\n".join(refusals)))
    assert [l for l in stdout.splitlines() if "grammar:" in l] == [], (
        "%s [M4]: no line of `--check` stdout names `grammar:` at all" % leg)


# --------------------------------------------------------------------------- #
# (a) [M1] the Proof's guards reach the claims dict and every wave entry       #
# --------------------------------------------------------------------------- #
def test_a_guard_bullet_fills_proof_guards_on_the_claims_dict():
    assert _guards(_claims(GUARDED_TASK)) == ["tests/test_w.py"], (
        "leg (a) [M1]: a Proof carrying `- Test: `tests/test_w.py``, "
        "`- Guard: `tests/test_w.py`` and a `- Legs:` line returns "
        "`proof_guards == [\"tests/test_w.py\"]`")


def test_a_guard_value_is_trimmed_and_its_backticks_stripped():
    assert _guards(_claims(PADDED_TASK)) == ["tests/test_w.py"], (
        "leg (a) [M1]: the bullet's value is read with backticks stripped and "
        "whitespace trimmed, so `- Guard:   `tests/test_w.py`   ` names the "
        "same path as the tight form")


def test_a_the_guarded_task_entry_carries_its_guard(tmp_path):
    entries = _compile_tasks(tmp_path, GUARDED_TASK)
    assert _proof_guards_of(entries["1"]) == ["tests/test_w.py"], (
        "leg (a) [M1]: `--emit-args` writes `proofGuards == "
        "[\"tests/test_w.py\"]` on the guarded task's wave entry")


def test_a_a_sibling_task_naming_no_guard_carries_the_empty_list(tmp_path):
    entries = _compile_tasks(tmp_path, GUARDED_TASK, SIBLING_TASK)
    assert _proof_guards_of(entries["1"]) == ["tests/test_w.py"], (
        "leg (a) [M1]: the guarded task keeps its guard when a sibling rides "
        "the same plan")
    assert _proof_guards_of(entries["2"]) == [], (
        "leg (a) [M1]: a sibling task whose Proof names no `Guard:` writes "
        "`proofGuards == []` \u2014 the key is on EVERY entry, not only the "
        "guarded ones")


def test_a_legacy_grammar_entries_all_carry_the_empty_list(tmp_path):
    entries = _entries(_emit_args(tmp_path, WIDE_FIXTURE))
    assert entries, "expected the legacy wide fixture to compile to wave entries"
    assert [_proof_guards_of(e) for e in entries.values()] == [[]] * len(entries), (
        "leg (a) [M1]: every entry of a legacy-grammar plan carries "
        "`proofGuards == []` \u2014 a legacy body has no claims dict to read "
        "a guard from, and the key is still written")


def test_a_repeated_guard_keeps_the_first_occurrence_in_proof_order(tmp_path):
    assert _guards(_claims(REPEAT_TASK)) == ["tests/test_w.py",
                                             "tests/test_v.py"], (
        "leg (a) [M1]: `- Guard: `tests/test_w.py``, then "
        "`- Guard: `tests/test_v.py``, then `- Guard: `tests/test_w.py`` "
        "again returns `proof_guards == [\"tests/test_w.py\", "
        "\"tests/test_v.py\"]` \u2014 first occurrence kept, Proof order")
    entries = _compile_tasks(tmp_path, REPEAT_TASK)
    assert _proof_guards_of(entries["1"]) == ["tests/test_w.py",
                                              "tests/test_v.py"], (
        "leg (a) [M1]: the wave entry carries that same list, in that same "
        "Proof order")


# --------------------------------------------------------------------------- #
# (e) [M4] a guard is neither a `Test:` path nor a `Run:` command              #
# --------------------------------------------------------------------------- #
def test_e_the_guard_is_absent_from_the_proof_test_and_run_lists(tmp_path):
    entries = _compile_tasks(tmp_path, GUARDED_TASK)
    assert entries["1"]["proofTests"] == ["tests/test_w.py"], (
        "leg (e) [M4]: the guarded task's `proofTests` is its Proof `Test:` "
        "list \u2014 the `Guard:` bullet adds nothing to it")
    assert entries["1"]["proofRuns"] == [], (
        "leg (e) [M4]: a `Guard:` bullet is not a `Run:` command, so "
        "`proofRuns` stays `[]`")
    assert entries["1"]["testCmd"] == "python3 -m pytest -q tests/test_w.py", (
        "leg (e) [M4]: `testCmd` still derives from the Proof `Test:` paths "
        "alone")


def test_e_a_guard_at_another_path_derives_no_test_cmd_of_its_own(tmp_path):
    entries = _compile_tasks(tmp_path, ELSEWHERE_TASK)
    assert entries["1"]["proofTests"] == ["tests/test_w.py"], (
        "leg (e) [M4]: `%s` is a `Guard:`, not a `Test:` \u2014 it is absent "
        "from `proofTests`" % ELSEWHERE)
    assert entries["1"]["proofRuns"] == [], (
        "leg (e) [M4]: it is absent from `proofRuns` too")
    assert entries["1"]["testCmd"] == "python3 -m pytest -q tests/test_w.py", (
        "leg (e) [M4]: it derives no `testCmd` of its own \u2014 the command "
        "names the Proof's `Test:` path and nothing else")


def test_e_a_plan_carrying_a_guard_still_prints_plan_ok(tmp_path):
    plan = _write(tmp_path, "guarded_ok.md", GUARDED_TASK)
    p = _check(plan)
    assert p.returncode == 0, (
        "leg (e) [M4]: a plan whose only change is a `Guard:` bullet still "
        "checks clean; got rc=%d\n%s%s" % (p.returncode, p.stdout, p.stderr))
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], (
        "leg (e) [M4]: `--check` prints `PLAN OK`; got:\n%s" % p.stdout)
    _no_grammar_refusal(p.stdout, "leg (e)")


def test_e_deleting_the_guard_bullet_leaves_check_stdout_byte_identical(
        tmp_path):
    guarded = _write(tmp_path, "with_guard.md", GUARDED_TASK)
    plain = _write(tmp_path, "without_guard.md", UNGUARDED_TASK)
    bare_guarded, bare_plain = _check(guarded), _check(plain)
    assert bare_guarded.stdout == bare_plain.stdout, (
        "leg (e) [M4]: the same plan with the `Guard:` bullet deleted prints "
        "byte-identical `--check` stdout\n--- with guard ---\n%s"
        "--- without ---\n%s" % (bare_guarded.stdout, bare_plain.stdout))
    assert (bare_guarded.returncode, bare_plain.returncode) == (0, 0), (
        "leg (e) [M4]: both plans check clean")
    _no_grammar_refusal(bare_guarded.stdout, "leg (e)")
