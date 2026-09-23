"""`plan_check.py` refuses a run-wide `Check:` freeze that covers a task's own
Files (#1202).

Machine, restated, and where each clause is graded here:

  * M1 — a signed one-task plan whose `## Global Constraints` carries
    `- Check: git diff --quiet $ULTRA_BASE -- fleet/`, with task 1 naming
    `fleet/tests/test_x.mjs` as its `Create:` path and `src/prover.ts` as its
    `Modify:` path, exits 2 under a bare `plan_check.py <plan>` (no `--base`),
    prints no `PLAN OK`, and prints exactly one line carrying `freezes` — that
    line also carries the check's whole command, the pathspec `fleet/`,
    `task 1` and the path `fleet/tests/test_x.mjs`. Graded by leg (a),
    subprocess, and again directly against `freeze_violations` in leg (d).
  * M2 — the same plan with the check
    `git diff --quiet $ULTRA_BASE -- fleet/launch.mjs fleet/te` prints
    `PLAN OK`, exits 0, and carries no `freezes` line — `fleet/te` is a
    string prefix of the task's path, not a directory prefix, so it covers
    nothing. Graded by leg (b), and again directly in leg (d).
  * M3 — the same plan with the check
    `git diff --quiet $ULTRA_BASE -- docs src/prover.ts` exits 2 and prints a
    line carrying `freezes`, `src/prover.ts` and `task 1` — a pathspec equal
    to a task's path covers it. Graded by leg (c), and again directly in leg
    (d).
  * M4 — `freeze_violations(checks, tasks)` is a module-level function of
    `plan_check.py` that answers from the `checks`/`tasks` values alone, and
    the gotchas row and `SKILL.md`'s `## Global Constraints discipline`
    section each name the `plan_check.py` refusal. Graded by leg (d): the
    function's definition line and its answering M1/M2/M3 correctly when
    called directly on plain dicts (no `tmp_path`, no git, no subprocess —
    demonstrating it needs none), plus the two doc greps. `main` summing its
    answer into `violations` is what legs (a)-(c) already exercise end to
    end; that the function itself spawns nothing is a diff-reading claim (the
    Context's own words), not one this file can observe from outside.

The shape is `tests/test_plan_check_rehearsal.py`: a claims-v1 plan is built
directly (no repository — this task runs `plan_check.py` with no `--base`,
so none is needed) and signed with the gate's own extractor, then run as a
subprocess so stdout and the exit code are read as the compiler actually
prints them.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/plan_check.py"
GOTCHAS = ROOT / "skills/ultrawrite/references/authoring-gotchas.md"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import plan_check  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


# --------------------------------------------------------------------------- #
# The plan: one signed claims-v1 task, `## Global Constraints` varying only   #
# in its one `- Check:` bullet — the three commands M1, M2 and M3 each name.  #
# --------------------------------------------------------------------------- #

HEAD = """# Freeze probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator's run-wide freeze never covers a task's own Files. (elicited)
"""

TASK = """
### Task 1: The frozen file

**Type:** implementation

**Files:**
- Modify: `src/prover.ts`
- Create: `fleet/tests/test_x.mjs`

**Claim:** An operator's patch lands without the run-wide freeze going red. (derived)
Machine: M1. The freeze check does not cover the task's own paths.

**Authorized-by:** #1202

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The prover is a standalone module with no registry to update.

**Proof:**
- (a) The suite asserts the prover compiles. [M1]

**Stale-if:**
- sha-matches: `at-base.txt`
"""

# The three commands the Machine clauses name, verbatim.
CMD_M1 = "git diff --quiet $ULTRA_BASE -- fleet/"
CMD_M2 = "git diff --quiet $ULTRA_BASE -- fleet/launch.mjs fleet/te"
CMD_M3 = "git diff --quiet $ULTRA_BASE -- docs src/prover.ts"


def make_plan(check_cmd):
    constraints = "\n## Global Constraints\n\n- Check: %s\n" % check_cmd
    return HEAD + constraints + TASK


def write_plan(dirpath, name, text):
    """The plan plus the gate-verdict artifact claims-v1 compiles against,
    hashed by the gate's own extractor so a fixture edit re-signs itself."""
    plan = pathlib.Path(dirpath) / name
    plan.write_text(text)
    entry = gate_input(plan, "1")
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": entry["hash"], "verdict": "pass",
                         "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


def compile_plan(tmp_path, name, text):
    """`plan_check.py <plan>` — no `--base`: the Context says this refusal
    needs no repository, and none is set up here."""
    plan = write_plan(tmp_path, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan)],
                          capture_output=True, text=True)


def freeze_lines(stdout):
    """Every stdout line carrying the word `freezes`."""
    return [line for line in stdout.splitlines() if "freezes" in line]


# =========================================================================== #
# (a)/[M1] — the freeze is refused, one line, naming everything M1 names      #
# =========================================================================== #

def test_a_a_directory_pathspec_covering_the_test_path_is_refused(tmp_path):
    """[M1]: exit 2, no `PLAN OK`, exactly one `freezes` line, carrying the
    check's whole command, the pathspec `fleet/`, `task 1` and the covered
    path `fleet/tests/test_x.mjs`."""
    p = compile_plan(tmp_path, "a.md", make_plan(CMD_M1))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in p.stdout, p.stdout
    lines = freeze_lines(p.stdout)
    assert len(lines) == 1, (
        "expected exactly one line carrying 'freezes':\n%s" % p.stdout)
    line = lines[0]
    for token in (CMD_M1, "fleet/", "task 1", "fleet/tests/test_x.mjs"):
        assert token in line, "%r missing from freeze line: %r" % (token, line)


# =========================================================================== #
# (b)/[M2] — a string prefix that is not a directory prefix covers nothing    #
# =========================================================================== #

def test_b_a_string_prefix_pathspec_is_not_a_directory_prefix(tmp_path):
    """[M2]: `fleet/te` is a string prefix of `fleet/tests/test_x.mjs`, not a
    directory prefix — `PLAN OK`, exit 0, no `freezes` line at all."""
    p = compile_plan(tmp_path, "b.md", make_plan(CMD_M2))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout
    assert freeze_lines(p.stdout) == [], p.stdout


# =========================================================================== #
# (c)/[M3] — a pathspec equal to a task's path covers it                      #
# =========================================================================== #

def test_c_a_pathspec_equal_to_the_modify_path_is_refused(tmp_path):
    """[M3]: `src/prover.ts` named exactly among the freeze's pathspecs
    refuses the plan; at least one stdout line carries `freezes`,
    `src/prover.ts` and `task 1` together (`command_violations`' own "names"
    line may also fire here — that line says a different thing and is not
    asserted against)."""
    p = compile_plan(tmp_path, "c.md", make_plan(CMD_M3))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    lines = freeze_lines(p.stdout)
    assert lines, "expected at least one 'freezes' line:\n%s" % p.stdout
    assert any(all(tok in line for tok in ("freezes", "src/prover.ts", "task 1"))
               for line in lines), lines


# =========================================================================== #
# (d)/[M4] — the module-level function, answering from strings alone, and    #
# the two doc greps                                                          #
# =========================================================================== #

SOURCE = COMPILER.read_text()


def fake_task(id_, modifies=(), creates=(), deletes=(),
             type_="implementation"):
    return {"id": id_, "type": type_, "creates": list(creates),
            "modifies": list(modifies), "deletes": list(deletes)}


def fake_check(cmd):
    return {"cmd": cmd, "minor": False}


TASK1 = fake_task("1", modifies=["src/prover.ts"],
                  creates=["fleet/tests/test_x.mjs"])


def test_d_freeze_violations_is_defined_at_module_level():
    """[M4]: `def freeze_violations(checks, tasks)` at module level, the
    Proof's own signature, and reachable as `plan_check.freeze_violations`."""
    assert re.search(r"^def freeze_violations\(checks, tasks\)\s*:", SOURCE,
                     re.M), (
        "plan_check.py carries no `def freeze_violations(checks, tasks):` "
        "definition")
    assert callable(getattr(plan_check, "freeze_violations", None)), (
        "plan_check has no module-level freeze_violations")


def test_d_freeze_violations_answers_m1_m2_m3_from_plain_dicts_alone():
    """[M4]: called directly on plain `checks`/`tasks` dicts — no `tmp_path`,
    no git, no subprocess anywhere in this test — `freeze_violations`
    reproduces the M1, M2 and M3 verdicts on its own, which is what "reads
    only the strings the parser printed" means in practice."""
    m1 = plan_check.freeze_violations([fake_check(CMD_M1)], [TASK1])
    assert len(m1) == 1, m1
    for token in (CMD_M1, "fleet/", "task 1", "fleet/tests/test_x.mjs"):
        assert token in m1[0], "%r missing from: %r" % (token, m1[0])

    assert plan_check.freeze_violations([fake_check(CMD_M2)], [TASK1]) == [], (
        plan_check.freeze_violations([fake_check(CMD_M2)], [TASK1]))

    m3 = plan_check.freeze_violations([fake_check(CMD_M3)], [TASK1])
    assert m3, "expected a violation for a pathspec equal to the task's path"
    assert any(all(tok in line for tok in
                   ("freezes", "src/prover.ts", "task 1")) for line in m3), m3


def sed_range(text, start_pat, end_pat):
    """`sed -n '/start_pat/,/end_pat/p'`: from the first line matching
    `start_pat` (inclusive) through the next line matching `end_pat`
    (inclusive)."""
    start_re = re.compile(start_pat)
    end_re = re.compile(end_pat)
    out = []
    in_range = False
    for line in text.splitlines():
        if not in_range and start_re.search(line):
            in_range = True
        if in_range:
            out.append(line)
            if end_re.search(line):
                break
    return "\n".join(out)


def test_d_the_gotchas_row_names_the_plan_check_refusal():
    """[M4]: the Proof's second `Run:` line, as a python equivalent of
    `sed -n '/that freezes a path must not cover/,/^## Three older lessons/p'
    ... | tr '\\n' ' ' | grep -q 'plan_check.py.*refuses'`."""
    text = GOTCHAS.read_text()
    segment = sed_range(text, r"that freezes a path must not cover",
                        r"^## Three older lessons")
    assert segment, "authoring-gotchas.md carries no such row"
    joined = " ".join(segment.split("\n"))
    assert re.search(r"plan_check\.py.*refuses", joined), (
        "gotchas row does not name the plan_check.py refusal:\n%s" % segment)


def test_d_the_skill_global_constraints_section_names_the_freeze_refusal():
    """[M4]: the Proof's third `Run:` line, as a python equivalent of
    `sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p'
    ... | tr '\\n' ' ' | grep -q 'freezes.*plan_check.py'`."""
    text = SKILL.read_text()
    segment = sed_range(text, r"^## Global Constraints discipline",
                        r"^## Execution handoff")
    assert segment, "SKILL.md carries no ## Global Constraints discipline section"
    joined = " ".join(segment.split("\n"))
    assert re.search(r"freezes.*plan_check\.py", joined), (
        "Global Constraints discipline section does not name the freeze "
        "refusal:\n%s" % segment)
