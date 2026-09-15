"""The `proof-run` edge tier, and the run-wide `Check:` that a task owns (#978).

Two rules, one exam:

  * A Proof `Run:` command of task B that names a path in task A's Files — and
    not in B's own — orders B after A: `compile_plan.py` emits
    `{"from": A, "to": B, "why": "proof-run"}` in `dag_edges`, beside the
    `interface`, `write-after-create` and `non-text-overlap` tiers, and B lands
    in a later wave (M1). The same path in B's own Files orders nothing (M2),
    and an interface edge already recorded for the pair keeps its own label
    (M3).
  * A Global Constraints `- Check:` command that names a path an
    implementation task owns is refused at `--check` — the sim the whole plan
    would pay for on every task belongs in the owning task's `Run:` (M4).

M5 is the authoring skill saying both, in the two sections the Proof's `Run:`
lines scope.

Each plan below is a real claims-v1 plan written to a temp directory and
compiled by a subprocess, so nothing here reaches into the compiler's
internals: the assertions read `dag_edges` and `waves` off stdout, and the
`--check` verdict off the exit code and the two output channels.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
SKILL_MD = ROOT / "skills/ultrawrite/SKILL.md"
# The compiler's own probe fixture: a plan this rule must NOT fire on.
FIXTURE_PLAN = ROOT / "evals/fixtures/claims/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402

# --------------------------------------------------------------------------- #
# The plan shapes. One two-task claims-v1 body, parameterized on the three     #
# things these legs vary: each task's Files block, each task's Proof `Run:`    #
# line, and the Interfaces pair. Everything else is the fixed grammar the      #
# compiler requires — the header, the six body slots, numbered Machine         #
# clauses, a cited leg apiece, a provenance tag, a predicate Stale-if.         #
# --------------------------------------------------------------------------- #

HEAD = """# Edge probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator gets the two sims in the order their proofs require. (elicited)
"""

TASK_1 = """
### Task 1: The sim

**Type:** implementation

**Files:**
{files1}

**Claim:** An operator running the sim sees it pass. (derived)
Machine: M1. The sim prints `PASSED`.

**Authorized-by:** #978

**Interfaces:**
- Consumes: {consumes1}
- Produces: {produces1}

**Context:** The sim is a standalone script with no registry to update.

**Proof:**
- Test: `tests/test_sim_a.py`
{run1}- The suite asserts the sim prints `PASSED`. [M1]

**Stale-if:**
- path-exists: `fleet/tests/sim_a.mjs`
"""

TASK_2 = """
### Task 2: The reader

**Type:** implementation

**Files:**
{files2}

**Claim:** An operator asking the reader for a count gets one. (derived)
Machine: M1. The reader returns `1`.

**Authorized-by:** #978

**Interfaces:**
- Consumes: {consumes2}
- Produces: {produces2}

**Context:** The reader is a one-function module with no registry to update.

**Proof:**
- Test: `tests/test_reader.py`
{run2}- The suite asserts the reader returns `1`. [M1]

**Stale-if:**
- path-exists: `fleet/reader.mjs`
"""

# Task 1 owns the sim; task 2 owns the reader. Disjoint writes, no shared
# symbol — so every edge these plans grow is the one the leg is about.
SIM = "fleet/tests/sim_a.mjs"
FILES_1 = "- Modify: `%s`\n- Test: `tests/test_sim_a.py`" % SIM
# The same path under task 1's `Test:` bullet instead of its `Modify:` bullet.
FILES_1_AS_TEST = "- Test: `%s`\n- Test: `tests/test_sim_a.py`" % SIM
FILES_2 = "- Modify: `fleet/reader.mjs`\n- Test: `tests/test_reader.py`"
# ... and the same, with the sim in task 2's OWN Files as well.
FILES_2_SHARING_SIM = (
    "- Modify: `%s`\n- Modify: `fleet/reader.mjs`\n- Test: `tests/test_reader.py`"
    % SIM)

RUN_2_ON_SIM = "- Run: node %s | grep -q PASSED\n" % SIM
# The longer path: a command naming `<sim>.bak` names a DIFFERENT file.
RUN_2_ON_SIM_BAK = "- Run: node %s.bak | grep -q PASSED\n" % SIM
RUN_1_ON_READER = "- Run: node fleet/reader.mjs | grep -q PASSED\n"

GLOBAL_CONSTRAINTS = """
## Global Constraints

- Check: node %s
- The sims stay offline.
""" % SIM
GLOBAL_CONSTRAINTS_MINOR = """
## Global Constraints

- Check: node %s (minor)
- The sims stay offline.
""" % SIM
GLOBAL_CONSTRAINTS_NO_CHECK = """
## Global Constraints

- The sims stay offline.
"""


def make_plan(files1=FILES_1, files2=FILES_2, run1="", run2="",
              consumes1="nothing", produces1="nothing",
              consumes2="nothing", produces2="nothing", constraints=""):
    return (HEAD + constraints
            + TASK_1.format(files1=files1, run1=run1,
                            consumes1=consumes1, produces1=produces1)
            + TASK_2.format(files2=files2, run2=run2,
                            consumes2=consumes2, produces2=produces2))


def _write_plan(tmp_path, name, text):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest."""
    plan = tmp_path / name
    plan.write_text(text)
    entries = {tid: gate_input(plan, tid) for tid in ("1", "2")}
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {tid: {"hash": e["hash"], "verdict": "pass",
                         "reason": "fixture"}
                   for tid, e in entries.items()},
         "tally": {"dispatched": len(entries), "rejected": 0}}))
    return plan


def run_compiler(plan, *flags):
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True)


def compile_json(tmp_path, name, text):
    """Compile one plan and return its stdout JSON. No `--base`: these legs ask
    only about `dag_edges` and `waves`, which ride on stdout without one."""
    plan = _write_plan(tmp_path, name, text)
    p = run_compiler(plan)
    assert p.returncode == 0, p.stdout + p.stderr
    return json.loads(p.stdout)


def check(tmp_path, name, text):
    return run_compiler(_write_plan(tmp_path, name, text), "--check")


# ── (a) M1: a Run: naming a sibling's file orders the two ───────────────────
# "For implementation tasks A and B, when a Proof `Run:` command of B names a
# path that is in A's Files ... and not in B's own Files, `compile_plan.py`
# emits {"from": A, "to": B, "why": "proof-run"} in `dag_edges` and B's wave is
# later than A's."

PROOF_RUN_EDGE = {"from": "1", "to": "2", "why": "proof-run"}


def test_run_naming_a_siblings_modify_path_orders_the_pair(tmp_path):
    """(a)/[M1]: task 2's `Run:` runs the sim task 1 modifies — one
    `proof-run` edge 1 -> 2, and task 2 lands in the later wave."""
    out = compile_json(tmp_path, "a1.md",
                       make_plan(files1=FILES_1, run2=RUN_2_ON_SIM))
    assert out["dag_edges"] == [PROOF_RUN_EDGE]
    assert out["waves"] == [["1"], ["2"]]


def test_run_naming_a_siblings_test_path_orders_the_pair(tmp_path):
    """(a)/[M1]: the same, with the sim under task 1's `Test:` bullet instead
    of its `Modify:` bullet — a `Test:` path is Files too."""
    out = compile_json(tmp_path, "a2.md",
                       make_plan(files1=FILES_1_AS_TEST, run2=RUN_2_ON_SIM))
    assert out["dag_edges"] == [PROOF_RUN_EDGE]
    assert out["waves"] == [["1"], ["2"]]


def test_run_naming_a_longer_path_orders_nothing(tmp_path):
    """(a)/[M1]: a path is "named" as a whole token. The command runs
    `fleet/tests/sim_a.mjs.bak`; task 1 owns `fleet/tests/sim_a.mjs`. Those are
    two files, so there is no edge and the two tasks share one wave."""
    out = compile_json(tmp_path, "a3.md",
                       make_plan(files1=FILES_1, run2=RUN_2_ON_SIM_BAK))
    assert out["dag_edges"] == []
    assert out["waves"] == [["1", "2"]]


# ── (b) M2: a path in the runner's own Files orders nothing ─────────────────
# "When the named path is also in B's own Files, no `proof-run` edge is emitted
# and the two tasks keep the wave the other tiers give them."


def test_run_naming_a_path_the_runner_also_owns_orders_nothing(tmp_path):
    """(b)/[M2]: the sim is in task 2's Files as well, so running it says
    nothing about task 1 — no edge, and the pair keeps the single wave
    same-path overlap alone leaves it in."""
    out = compile_json(tmp_path, "b.md",
                       make_plan(files1=FILES_1, files2=FILES_2_SHARING_SIM,
                                 run2=RUN_2_ON_SIM))
    assert out["dag_edges"] == []
    assert out["waves"] == [["1", "2"]]


# ── (c) M3: a proof-run edge yields to an opposing interface path ───────────
# "when A's `Run:` names B's file and A `Consumes:` a symbol B `Produces:`, the
# interface edge B -> A stands, no `proof-run` edge is emitted, and the compile
# exits 0."

INTERFACE_EDGE = {"from": "2", "to": "1", "why": "interface"}


def test_interface_edge_stands_and_no_proof_run_edge_is_added(tmp_path):
    """(c)/[M3]: task 1 runs task 2's file AND consumes what task 2 produces.
    `dag_edges` is exactly the one `interface` entry from 2 to 1 — the pair is
    not relabelled `proof-run` and no second entry appears."""
    plan = _write_plan(tmp_path, "c.md",
                       make_plan(run1=RUN_1_ON_READER,
                                 consumes1="`reader() -> int`",
                                 produces2="`reader() -> int`"))
    p = run_compiler(plan)
    assert p.returncode == 0, p.stdout + p.stderr
    out = json.loads(p.stdout)
    assert out["dag_edges"] == [INTERFACE_EDGE]
    assert [e for e in out["dag_edges"] if e["why"] == "proof-run"] == []
    assert out["waves"] == [["2"], ["1"]]


# ── (d) M4: a run-wide Check: naming a task's file is refused ───────────────
# "Under `--check`, a Global Constraints `Check:` command that names a path in
# any implementation task's Files is a refusal: the exit is non-zero, the
# output names that task's id and the path, and `PLAN OK` is not printed; the
# same plan with that `Check:` removed prints `PLAN OK`."

# The refusal names the task the way every other `--check` task violation does.
TASK_1_REFERENCE = re.compile(r"(?i)\btask\s+1\b")


def _assert_refused_naming_task_1_and_the_sim(p):
    output = p.stdout + p.stderr
    assert p.returncode != 0, output
    assert "PLAN OK" not in output, output
    assert SIM in output, output
    assert TASK_1_REFERENCE.search(output), output
    # One line, naming both — the shape a task violation already prints.
    named = [line for line in output.splitlines()
             if SIM in line and TASK_1_REFERENCE.search(line)]
    assert named, output


def test_check_refuses_a_constraint_check_that_runs_a_tasks_file(tmp_path):
    """(d)/[M4]: `- Check: node fleet/tests/sim_a.mjs` while task 1 owns that
    path — refused, naming the task id and the path, and no `PLAN OK`."""
    _assert_refused_naming_task_1_and_the_sim(
        check(tmp_path, "d1.md", make_plan(constraints=GLOBAL_CONSTRAINTS)))


def test_check_refuses_a_minor_constraint_check_the_same_way(tmp_path):
    """(d)/[M4]: `(minor)` records the check rather than blocking on it; it is
    still a command every task pays for, so it is refused identically."""
    _assert_refused_naming_task_1_and_the_sim(
        check(tmp_path, "d2.md",
              make_plan(constraints=GLOBAL_CONSTRAINTS_MINOR)))


def test_check_passes_the_same_plan_without_that_check(tmp_path):
    """(d)/[M4]: the refusal is the `Check:` line and nothing else about the
    plan — remove it and the same plan prints `PLAN OK`."""
    p = check(tmp_path, "d3.md",
              make_plan(constraints=GLOBAL_CONSTRAINTS_NO_CHECK))
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.strip() == "PLAN OK"


def test_probe_fixture_plan_still_checks_clean():
    """(d)/[M4], the Proof's first `Run:`: the compiler's own fixture is not a
    plan this rule fires on — `PLAN OK`, before and after."""
    p = run_compiler(FIXTURE_PLAN, "--check")
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.strip() == "PLAN OK"


# ── (e) M5: the authoring skill says both ───────────────────────────────────
# "`skills/ultrawrite/SKILL.md` says, in its Task shape section, that ordering
# is also derived from a Proof `Run:` that names a sibling's file, and in its
# Global Constraints discipline section that a `Check:` naming a file one task
# owns is refused at `--check`." These are the Proof's second and third `Run:`
# lines, verbatim.

RUN_TASK_SHAPE = (
    "sed -n '/^## Task shape/,/^## Elicit the claim/p' "
    "skills/ultrawrite/SKILL.md | tr '\\n' ' ' | grep -q 'Run:.*sibling'")
RUN_CONSTRAINTS = (
    "sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' "
    "skills/ultrawrite/SKILL.md | tr '\\n' ' ' | grep -q 'Check:.*refused'")


def _shell(cmd):
    return subprocess.run(["bash", "-c", cmd], cwd=str(ROOT),
                          capture_output=True, text=True)


def test_skill_task_shape_section_documents_the_proof_run_ordering():
    """(e)/[M5]: the Task shape section says a `Run:` naming a sibling's file
    orders the sibling first."""
    p = _shell(RUN_TASK_SHAPE)
    assert p.returncode == 0, (
        "the Task shape section of %s does not say a Proof `Run:` naming a "
        "sibling's file orders the two" % SKILL_MD)


def test_skill_global_constraints_section_documents_the_check_refusal():
    """(e)/[M5]: the Global Constraints discipline section says a `Check:`
    naming a file a task owns is refused at `--check`."""
    p = _shell(RUN_CONSTRAINTS)
    assert p.returncode == 0, (
        "the Global Constraints discipline section of %s does not say a "
        "`Check:` naming a file a task owns is refused" % SKILL_MD)
