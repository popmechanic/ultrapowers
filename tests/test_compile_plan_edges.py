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
import os
import pathlib
import re
import shutil
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


# =========================================================================== #
# Task 1 (#538 item 2): `compile_plan.py --check --base` evaluates the five    #
# Stale-if predicates at BASE and refuses a task whose predicate holds.        #
#                                                                              #
# A task's Stale-if slot says what would make the task wrong before it runs.   #
# At BASE nothing reads it. Under `--check --base <base>` each entry is now a  #
# question the compiler puts to the tree at that base:                         #
#                                                                              #
#   * `path-exists:` / `path-absent:` hold on what the tree has (M1, M2),      #
#     `sha-matches: <path>@<sha>` on the blob id at BASE prefixed by `<sha>`   #
#     (M3), `issue-open:` / `issue-closed:` on what one `gh issue view` per    #
#     distinct issue number prints (M4).                                       #
#   * An entry that holds is one violation, line                               #
#     `STALE fact: task <id>: <entry> holds at BASE` — exit 2, no `PLAN OK`    #
#     (M5). `<entry>` is the Stale-if line as written after its bullet, so it  #
#     carries its backticks.                                                   #
#   * An issue entry `gh` cannot decide, and a malformed `sha-matches`/issue   #
#     argument, refuse nothing: the verdict prints as before and one           #
#     `STALE fact: task <id>: <entry> unreadable at BASE — <reason>` line      #
#     follows it on stdout (M6).                                               #
#   * Without a base — bare `--check`, or a plain compile with or without      #
#     `--base` — no predicate is evaluated at all (M7).                        #
#   * `skills/ultrawrite/SKILL.md` §The proof gate says both halves (M8).      #
#                                                                              #
# Every row below compiles a real plan inside a real one-commit git repository #
# under `tmp_path`, so the tree these predicates are asked about is a tree,    #
# not a stub; the plan sits inside that repository because a 40-hex `--base`   #
# is resolved in the plan's own toplevel. `gh` is never the real one: the      #
# issue rows put a shell script on a PATH the test built, which prints what a  #
# file beside it says and appends its argv to a log.                           #
# =========================================================================== #

PRESENT = "present.py"
MISSING = "missing.py"
PRESENT_TEXT = "print(1)\n"

# The two Stale-if bullets the shared TASK_1/TASK_2 templates carry. Neither
# path exists in the temp repository, so every plan below holds exactly the
# entries its own row substitutes in — and the eleven cases above, which never
# pass a `--base`, are untouched by any of this.
STALE_BULLET_1 = "- path-exists: `fleet/tests/sim_a.mjs`"
STALE_BULLET_2 = "- path-exists: `fleet/reader.mjs`"


def stale_plan(entry1, entry2=None, **kw):
    """`make_plan`'s body with task 1's (and optionally task 2's) Stale-if
    entry replaced. `entry` is the text after the bullet — what the compiler
    parses into `stale_if_entries` and what M5's line must carry verbatim."""
    text = make_plan(**kw)
    text = text.replace(STALE_BULLET_1, "- " + entry1)
    if entry2 is not None:
        text = text.replace(STALE_BULLET_2, "- " + entry2)
    return text


def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, " ".join(args) + "\n" + p.stdout + p.stderr
    return p.stdout


def base_repo(tmp_path):
    """A one-commit git repository holding `present.py` and nothing else.
    Returned as (repo path, HEAD sha, `git hash-object` id of present.py)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", ".")
    _git(repo, "config", "user.email", "exam@example.invalid")
    _git(repo, "config", "user.name", "exam")
    (repo / PRESENT).write_text(PRESENT_TEXT)
    _git(repo, "add", PRESENT)
    _git(repo, "commit", "-qm", "present")
    head = _git(repo, "rev-parse", "HEAD").strip()
    blob = _git(repo, "hash-object", PRESENT).strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head), head
    assert re.fullmatch(r"[0-9a-f]{40}", blob), blob
    return repo, head, blob


def compile_at(repo, name, text, *flags, env=None):
    """Write the plan (and its gate verdicts) inside `repo` and compile it."""
    plan = _write_plan(repo, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True,
                          env=None if env is None else dict(os.environ, **env))


def check_at(repo, name, text, base, env=None):
    return compile_at(repo, name, text, "--check", "--base", str(base),
                      env=env)


def holds_line(task_id, entry):
    """M5's line, exactly."""
    return "STALE fact: task %s: %s holds at BASE" % (task_id, entry)


def unreadable_prefix(task_id, entry):
    """M6's line, up to the reason — nothing pins the reason's wording."""
    return "STALE fact: task %s: %s unreadable at BASE — " % (task_id,
                                                                  entry)


def assert_refused(p, *lines):
    """[M5]: exit 2, each expected `STALE fact:` line present on stdout as a
    whole line, and no `PLAN OK` on either channel."""
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in out, out
    for line in lines:
        assert line in p.stdout.splitlines(), (line, out)


def assert_plan_ok(p):
    """The entry does not hold: the verdict is the unchanged `PLAN OK` and
    nothing is refused."""
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], out
    assert "holds at BASE" not in out, out


def both_bases(repo, head):
    """The two ways `--base` names this tree (M1): the checkout directory and
    its 40-hex HEAD sha. Every path/sha row is asked of each."""
    return [("directory base", str(repo)), ("sha base", head)]


# ── (a) M1: `path-exists:` holds on an entry of the tree at BASE ────────────
# "a task's `path-exists: <path>` entry holds when `<path>` is an entry of the
# tree at BASE ... and does not hold otherwise."

def test_a_path_exists_on_a_committed_file_is_refused_under_both_bases(tmp_path):
    """(a)/[M1]: `present.py` is committed, so task 1's entry holds — exit 2,
    the line names the task and the entry verbatim, and no `PLAN OK`."""
    repo, head, _ = base_repo(tmp_path)
    entry = "path-exists: `%s`" % PRESENT
    for label, base in both_bases(repo, head):
        p = check_at(repo, "a-%s.md" % label.split()[0],
                     stale_plan(entry), base)
        assert_refused(p, holds_line("1", entry))
        assert "1 violation(s)" in p.stdout, (label, p.stdout)


def test_a_path_exists_on_an_absent_file_passes_under_both_bases(tmp_path):
    """(a)/[M1]: the same task asking after `missing.py` — the entry does not
    hold, so the plan is the clean plan it was: `PLAN OK`, exit 0."""
    repo, head, _ = base_repo(tmp_path)
    entry = "path-exists: `%s`" % MISSING
    for label, base in both_bases(repo, head):
        assert_plan_ok(check_at(repo, "a2-%s.md" % label.split()[0],
                                stale_plan(entry), base))


# ── (b) M2: `path-absent:` holds exactly when the same read finds nothing ───
# "A `path-absent: <path>` entry holds exactly when the same read finds no
# entry."

def test_b_path_absent_on_an_absent_file_is_refused(tmp_path):
    """(b)/[M2]: nothing at `missing.py` at BASE, so `path-absent:` holds and
    carries its own line."""
    repo, head, _ = base_repo(tmp_path)
    entry = "path-absent: `%s`" % MISSING
    for label, base in both_bases(repo, head):
        assert_refused(check_at(repo, "b-%s.md" % label.split()[0],
                                stale_plan(entry), base),
                       holds_line("1", entry))


def test_b_path_absent_on_a_committed_file_passes(tmp_path):
    """(b)/[M2]: `present.py` is there, so `path-absent:` does not hold."""
    repo, head, _ = base_repo(tmp_path)
    entry = "path-absent: `%s`" % PRESENT
    for label, base in both_bases(repo, head):
        assert_plan_ok(check_at(repo, "b2-%s.md" % label.split()[0],
                                stale_plan(entry), base))


# ── (c) M3: `sha-matches:` holds on a blob id BASE's id begins with ─────────
# "A `sha-matches: <path>@<sha>` entry holds when `<path>` is a blob at BASE
# whose object id ... begins with `<sha>`; a `<path>` absent at BASE, or an id
# that does not begin with `<sha>`, does not hold."

def test_c_sha_matches_full_id_and_prefix_are_refused(tmp_path):
    """(c)/[M3]: the committed file's own id, whole and as its 7-character
    prefix — both hold, under a directory base and a sha base each."""
    repo, head, blob = base_repo(tmp_path)
    for n, sha in enumerate((blob, blob[:7])):
        entry = "sha-matches: `%s`@%s" % (PRESENT, sha)
        for label, base in both_bases(repo, head):
            assert_refused(check_at(repo, "c%d-%s.md" % (n, label.split()[0]),
                                    stale_plan(entry), base),
                           holds_line("1", entry))


def test_c_sha_matches_a_foreign_id_or_an_absent_path_passes(tmp_path):
    """(c)/[M3]: forty zeros is not a prefix of the blob's id, and a path with
    no blob at BASE cannot match any id — neither holds."""
    repo, head, blob = base_repo(tmp_path)
    rows = ["sha-matches: `%s`@%s" % (PRESENT, "0" * 40),
            "sha-matches: `%s`@%s" % (MISSING, blob)]
    for n, entry in enumerate(rows):
        for label, base in both_bases(repo, head):
            assert_plan_ok(check_at(repo, "c%d-%s.md" % (n + 2,
                                                         label.split()[0]),
                                    stale_plan(entry), base))


# ── (d) M4: the issue entries hold on what one `gh` read prints ─────────────
# "An `issue-open: #N` entry holds when `gh issue view N --json state -q
# .state`, run with the base repository as its working directory, prints
# `OPEN`, and an `issue-closed: #N` entry holds when it prints `CLOSED`; `gh`
# is run once per distinct issue number per compile, however many tasks name
# it."

ISSUE = "538"

_GH_SCRIPT = """#!/bin/sh
printf '%s\\n' "$*" >> '{log}'
cat '{answer}'
{stderr}exit {code}
"""


def fake_gh(tmp_path, name, answer, code=0, stderr_line=""):
    """A `gh` on a PATH this test built: it logs its argv and prints what the
    file beside it says. Returns (the directory to prepend to PATH, its log)."""
    bindir = tmp_path / name
    bindir.mkdir()
    log = bindir / "gh.log"
    answer_file = bindir / "answer"
    answer_file.write_text(answer)
    gh = bindir / "gh"
    gh.write_text(_GH_SCRIPT.format(
        log=log, answer=answer_file, code=code,
        stderr=("printf '%%s\\n' '%s' >&2\n" % stderr_line
                if stderr_line else "")))
    gh.chmod(0o755)
    return bindir, log


def with_gh(bindir):
    return {"PATH": str(bindir) + os.pathsep + os.environ["PATH"]}


def test_d_an_open_issue_holds_for_issue_open_and_not_for_issue_closed(tmp_path):
    """(d)/[M4]: the fake answers `OPEN` — `issue-open: #538` is refused with
    its line; `issue-closed: #538` does not hold, so the plan passes."""
    repo, _, _ = base_repo(tmp_path)
    bindir, _log = fake_gh(tmp_path, "bin-open", "OPEN\n")
    env = with_gh(bindir)
    open_entry = "issue-open: #%s" % ISSUE
    assert_refused(check_at(repo, "d1.md", stale_plan(open_entry), repo,
                            env=env),
                   holds_line("1", open_entry))
    assert_plan_ok(check_at(repo, "d2.md",
                            stale_plan("issue-closed: #%s" % ISSUE), repo,
                            env=env))


def test_d_a_closed_issue_swaps_the_two(tmp_path):
    """(d)/[M4]: the same two entries against a fake answering `CLOSED`."""
    repo, _, _ = base_repo(tmp_path)
    bindir, _log = fake_gh(tmp_path, "bin-closed", "CLOSED\n")
    env = with_gh(bindir)
    closed_entry = "issue-closed: #%s" % ISSUE
    assert_refused(check_at(repo, "d3.md", stale_plan(closed_entry), repo,
                            env=env),
                   holds_line("1", closed_entry))
    assert_plan_ok(check_at(repo, "d4.md",
                            stale_plan("issue-open: #%s" % ISSUE), repo,
                            env=env))


def test_d_gh_is_run_once_per_issue_number_however_many_tasks_name_it(tmp_path):
    """(d)/[M4]: both tasks name `#538` — one from each side. The compile
    answers both from one `gh` invocation, whose argv is the documented read."""
    repo, _, _ = base_repo(tmp_path)
    bindir, log = fake_gh(tmp_path, "bin-cache", "OPEN\n")
    open_entry = "issue-open: #%s" % ISSUE
    closed_entry = "issue-closed: #%s" % ISSUE
    p = check_at(repo, "d5.md", stale_plan(open_entry, closed_entry), repo,
                 env=with_gh(bindir))
    # `OPEN`: task 1's entry holds, task 2's does not.
    assert_refused(p, holds_line("1", open_entry))
    assert holds_line("2", closed_entry) not in p.stdout, p.stdout
    invocations = [line for line in log.read_text().splitlines() if line.strip()]
    assert len(invocations) == 1, invocations
    argv = invocations[0].split()
    for token in ("issue", "view", ISSUE):
        assert token in argv, (token, argv)
    assert "state" in invocations[0], invocations[0]


# ── (e) M5: every entry that holds is one violation ─────────────────────────
# "Every entry that holds is one violation whose line is `STALE fact: task
# <id>: <entry> holds at BASE` ... so the compile exits 2, prints those lines
# and prints no `PLAN OK`."

def test_e_two_holding_entries_are_two_violations(tmp_path):
    """(e)/[M5]: task 1's `path-exists:` and task 2's `path-absent:` both hold
    — both lines print, the tally is `2 violation(s)`, the exit is 2."""
    repo, _, _ = base_repo(tmp_path)
    entry1 = "path-exists: `%s`" % PRESENT
    entry2 = "path-absent: `%s`" % MISSING
    p = check_at(repo, "e.md", stale_plan(entry1, entry2), repo)
    assert_refused(p, holds_line("1", entry1), holds_line("2", entry2))
    assert "2 violation(s)" in p.stdout, p.stdout


# ── (f) M6: what the machine cannot read is an advisory, not a refusal ──────
# "An issue entry `gh` cannot decide ... and a `sha-matches` or issue entry
# whose argument is malformed ... is not a violation: the compile prints its
# verdict as before and, after it, one line `STALE fact: task <id>: <entry>
# unreadable at BASE — <reason>` on stdout per such entry, so a plan with
# nothing else wrong prints `PLAN OK` and exits 0."

def assert_advisory(p, entry):
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], out
    prefix = unreadable_prefix("1", entry)
    advisories = [line for line in p.stdout.splitlines()
                  if line.startswith(prefix)]
    assert len(advisories) == 1, (prefix, out)
    # An advisory is not a refusal: nothing here is counted or refused.
    assert "holds at BASE" not in out, out
    assert "violation(s)" not in out, out


def test_f_no_gh_on_path_is_an_advisory(tmp_path):
    """(f)/[M6]: a PATH holding only `git` — the issue is undecidable, so the
    verdict is `PLAN OK` and the entry prints as unreadable."""
    repo, _, _ = base_repo(tmp_path)
    git = shutil.which("git")
    assert git, "the exam needs a real `git` to build the gh-less PATH with"
    bindir = tmp_path / "bin-nogh"
    bindir.mkdir()
    (bindir / "git").symlink_to(git)
    entry = "issue-open: #%s" % ISSUE
    assert_advisory(check_at(repo, "f1.md", stale_plan(entry), repo,
                             env={"PATH": str(bindir)}),
                    entry)


def test_f_gh_exiting_non_zero_is_an_advisory(tmp_path):
    """(f)/[M6]: a `gh` that fails decides nothing."""
    repo, _, _ = base_repo(tmp_path)
    bindir, _log = fake_gh(tmp_path, "bin-fail", "", code=1,
                           stderr_line="could not resolve to an Issue")
    entry = "issue-open: #%s" % ISSUE
    assert_advisory(check_at(repo, "f2.md", stale_plan(entry), repo,
                             env=with_gh(bindir)),
                    entry)


def test_f_gh_printing_neither_state_is_an_advisory(tmp_path):
    """(f)/[M6]: output that is neither `OPEN` nor `CLOSED`."""
    repo, _, _ = base_repo(tmp_path)
    bindir, _log = fake_gh(tmp_path, "bin-maybe", "MAYBE\n")
    entry = "issue-closed: #%s" % ISSUE
    assert_advisory(check_at(repo, "f3.md", stale_plan(entry), repo,
                             env=with_gh(bindir)),
                    entry)


def test_f_an_issue_entry_with_no_digits_is_an_advisory(tmp_path):
    """(f)/[M6]: `issue-open: #` names no issue — malformed, not false."""
    repo, _, _ = base_repo(tmp_path)
    bindir, _log = fake_gh(tmp_path, "bin-open2", "OPEN\n")
    entry = "issue-open: #"
    assert_advisory(check_at(repo, "f4.md", stale_plan(entry), repo,
                             env=with_gh(bindir)),
                    entry)


def test_f_a_sha_matches_with_no_at_is_an_advisory(tmp_path):
    """(f)/[M6]: `sha-matches:` with no `@` pins no id — malformed, and the
    path being present at BASE does not make it hold."""
    repo, _, _ = base_repo(tmp_path)
    entry = "sha-matches: `%s`" % PRESENT
    assert_advisory(check_at(repo, "f5.md", stale_plan(entry), repo), entry)


# ── (g) M7: no base, no predicate ───────────────────────────────────────────
# "A bare `--check` without `--base`, and a plain compile with or without
# `--base`, evaluate no predicate."

def test_g_a_bare_check_evaluates_nothing(tmp_path):
    """(g)/[M7]: the very plan leg (a) refuses, compiled with no `--base` —
    `PLAN OK`, exit 0, nothing said about the predicate."""
    repo, _, _ = base_repo(tmp_path)
    entry = "path-exists: `%s`" % PRESENT
    p = compile_at(repo, "g1.md", stale_plan(entry), "--check")
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.strip() == "PLAN OK", p.stdout
    assert "STALE fact:" not in p.stdout + p.stderr, p.stdout + p.stderr


def test_g_a_plain_compile_with_a_base_evaluates_nothing(tmp_path):
    """(g)/[M7]: the same plan compiled plainly with `--base <dir>` — exit 0,
    stdout is the launch JSON, and no `STALE fact:` on either channel."""
    repo, _, _ = base_repo(tmp_path)
    entry = "path-exists: `%s`" % PRESENT
    p = compile_at(repo, "g2.md", stale_plan(entry), "--base", str(repo))
    assert p.returncode == 0, p.stdout + p.stderr
    json.loads(p.stdout)
    assert "STALE fact:" not in p.stdout, p.stdout
    assert "STALE fact:" not in p.stderr, p.stderr


# ── (h) M8: the authoring skill says both halves ────────────────────────────
# "The `## The proof gate` section of `skills/ultrawrite/SKILL.md` says that a
# Stale-if predicate that holds at the base is a `STALE fact:` refusal and that
# an issue predicate the laptop cannot read is an advisory line." This is the
# Proof's `Run:` line, verbatim.

RUN_PROOF_GATE = (
    "sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' "
    "skills/ultrawrite/SKILL.md | tr '\\n' ' ' "
    "| grep -q 'STALE fact.*refus.*unreadable.*advisory'")


def test_h_proof_gate_section_documents_the_refusal_and_the_advisory():
    """(h)/[M8]: the proof-gate section's flattened text names `STALE fact`, a
    refusal, `unreadable` and `advisory`, in that order."""
    p = _shell(RUN_PROOF_GATE)
    assert p.returncode == 0, (
        "the `## The proof gate` section of %s does not say that a Stale-if "
        "predicate holding at the base is a `STALE fact:` refusal and that an "
        "unreadable issue predicate is an advisory line" % SKILL_MD)
