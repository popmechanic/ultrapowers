"""`--check --base` prints the tree's own facts about the plan (#896).

Two facts an author narrates from memory and gets wrong: what a file the plan
deletes actually holds (run-90 deleted a 2,576-line sim on the sentence
"entirely the check-runs poll"; 1,900 of its lines were five other exams), and
which files outside a task's Files carry a literal its Machine clauses pin
(runs 84, 88 and 90 each parked on one). Both are functions of the tree at
BASE, so the compiler reads them and prints them after the verdict — facts,
not advisories: nothing refuses on them, except a `Delete:` naming a path the
base does not have.

One test per leg, each naming its clause:

  (a) [M1] `- Delete:` is a canonical Files label: it parses into the task's
      `deletes` and `writes`, draws no unknown-label violation, and `Remove:`
      now suggests `Delete`;
  (b) [M2] under `--check --base`, a deleted file present at BASE prints one
      `BASE fact:` line with its line count, test-case count and every section
      banner; one absent at BASE is a `grammar:` refusal naming the path;
  (c) [M3] a Machine-clause literal carried at BASE by a file outside the
      task's Files prints one `BASE fact:` line naming that file; the same
      literal with the carrier in Files prints nothing; a path-shaped literal
      the tree does not have is still grepped for;
  (d) [M4] a bare `--check` (no `--base`) and a legacy-grammar plan print no
      `BASE fact:` line at all, and `PLAN OK` stays the first line.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    _files_violations, gate_input_hash, parse_task, plan_grammar,
    parse_plan_claim, split_tasks, verdicts_path,
)

OLD_PY = "\n".join([
    "# THE OLD WIDGET EXAM — three cases",
    "def test_one():",
    "    pass",
    "# a lowercase comment is not a banner",
    "def test_two():",
    "    pass",
    "# THE SECOND HALF, WHICH THE AUDIT FORGOT",
    "def test_three():",
    "    pass",
    "",
])
PIN_PY = "def test_pin():\n    assert 'frobnicate the widget' in out\n"
LITERAL = "frobnicate the widget"


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, "git %s failed: %s" % (" ".join(args), p.stderr)
    return p.stdout


def new_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "facts@example.com")
    git(repo, "config", "user.name", "Facts Test")
    for rel, text in {"pkg/old.py": OLD_PY, "tests/test_pin.py": PIN_PY,
                      "pkg/keep.py": "x = 1\n", "run_gone.sh": "echo gone\n"}.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    return repo


def plan_text(files, machine_literal=LITERAL, grammar=True):
    head = "# A plan\n\n"
    if grammar:
        head += ("**Grammar:** claims-v1\n\n**Claim:** do: run it. see: it "
                 "works. (elicited)\n\n**Goal:** g\n\n")
    return head + "\n".join([
        "### Task 1: the one task",
        "",
        "**Type:** implementation",
        "",
        "**Files:**",
        *files,
        "",
        "**Claim:** do: run it. see: it works. (derived)",
        "Machine: M1. the output says `%s` and never `run_gone.sh`." % machine_literal,
        "",
        "**Authorized-by:** #896",
        "",
        "**Interfaces:**",
        "- Consumes: none",
        "- Produces: none",
        "",
        "**Context:** nothing the tree cannot tell it.",
        "",
        "**Proof:**",
        "- Legs: (a) the Run: below exits 0 [M1].",
        "- Run: true",
        "",
        "**Stale-if:**",
        "- path-absent: `pkg/keep.py`",
        "",
    ])


def write_plan(repo, text):
    plan = repo / "docs" / "plan.md"
    plan.parent.mkdir(exist_ok=True)
    plan.write_text(text)
    if "claims-v1" in text:
        grammar = plan_grammar(text)
        tasks = [parse_task(t, raise_on_marker_error=False, grammar=grammar,
                            plan_claim=parse_plan_claim(text))
                 for t in split_tasks(text)]
        record = {"tasks": {}, "tally": {"dispatched": len(tasks)}}
        for t in tasks:
            c = t["claims"]
            record["tasks"][t["id"]] = {
                "hash": gate_input_hash(c["claim"], c["proof"]),
                "verdict": "pass", "reason": "fixture"}
        verdicts_path(plan).write_text(json.dumps(record))
    return plan


def check(plan, base=None):
    argv = [sys.executable, str(COMPILER), "--check"]
    if base is not None:
        argv += ["--base", str(base)]
    argv.append(str(plan))
    p = subprocess.run(argv, capture_output=True, text=True)
    return p.returncode, p.stdout


def facts(stdout):
    return [l for l in stdout.splitlines() if l.startswith("BASE fact:")]


# --- (a) [M1] the label -------------------------------------------------- #

def test_delete_is_a_canonical_label_that_parses_into_deletes_and_writes(tmp_path):
    text = plan_text(["- Delete: `pkg/old.py`", "- Modify: `pkg/keep.py`"])
    t = parse_task(split_tasks(text)[0], grammar=plan_grammar(text),
                   plan_claim=parse_plan_claim(text))
    assert t["deletes"] == ["pkg/old.py"], "leg (a) [M1]: Delete: parses into deletes"
    assert t["writes"] == ["pkg/keep.py", "pkg/old.py"], \
        "leg (a) [M1]: a deleted path is a write for overlap purposes"
    assert _files_violations(t) == [], "leg (a) [M1]: no unknown-label violation"


def test_remove_now_suggests_delete():
    v = _files_violations({"id": "3", "files_raw": [("Remove", "`old/x.py`")]})
    assert len(v) == 1 and "Delete" in v[0], "leg (a) [M1]: Remove: → use Delete"


# --- (b) [M2] the deleted file's shape ----------------------------------- #

def test_a_deleted_file_present_at_base_prints_its_shape(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(repo, plan_text(["- Delete: `pkg/old.py`"]))
    rc, out = check(plan, base=repo)
    assert rc == 0 and out.splitlines()[0] == "PLAN OK", out
    lines = [l for l in facts(out) if "deletes `pkg/old.py`" in l]
    assert len(lines) == 1, "leg (b) [M2]: one fact line for the deleted file:\n" + out
    line = lines[0]
    for needle in ("9 lines", "3 test cases", "2 section banners",
                   '"THE OLD WIDGET EXAM — three cases"',
                   '"THE SECOND HALF, WHICH THE AUDIT FORGOT"'):
        assert needle in line, "leg (b) [M2]: %r missing from: %s" % (needle, line)
    assert "lowercase comment" not in line, "leg (b) [M2]: a lowercase comment is not a banner"


def test_a_deleted_file_absent_at_base_is_a_refusal(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(repo, plan_text(["- Delete: `pkg/never.py`"]))
    rc, out = check(plan, base=repo)
    assert rc == 2, "leg (b) [M2]: a Delete: absent at BASE refuses — got %d:\n%s" % (rc, out)
    assert "pkg/never.py" in out and "absent at BASE" in out, out
    # ... and only with a base to read: a bare --check has no opinion.
    rc_bare, out_bare = check(plan)
    assert rc_bare == 0 and "never.py" not in out_bare, out_bare


# --- (c) [M3] a literal carried outside Files ---------------------------- #

def test_a_literal_carried_outside_files_names_its_carrier(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(repo, plan_text(["- Modify: `pkg/keep.py`"]))
    rc, out = check(plan, base=repo)
    assert rc == 0, out
    hits = [l for l in facts(out) if "`%s`" % LITERAL in l]
    assert len(hits) == 1 and "tests/test_pin.py" in hits[0] \
        and "not in this task's Files" in hits[0], \
        "leg (c) [M3]: the carrier outside Files is named:\n" + out


def test_the_same_literal_with_its_carrier_in_files_prints_nothing(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(repo, plan_text(["- Modify: `pkg/keep.py`",
                                       "- Modify: `tests/test_pin.py`"]))
    rc, out = check(plan, base=repo)
    assert rc == 0, out
    assert not [l for l in facts(out) if "`%s`" % LITERAL in l], \
        "leg (c) [M3]: a carrier the task owns is not a fact:\n" + out


def test_a_path_shaped_literal_the_tree_lacks_is_still_grepped(tmp_path):
    repo = new_repo(tmp_path)
    # `run_gone.sh` exists at this base, so as a referent it is skipped ...
    plan = write_plan(repo, plan_text(["- Modify: `pkg/keep.py`"]))
    _, out = check(plan, base=repo)
    assert not [l for l in facts(out) if "`run_gone.sh`" in l], out
    # ... and once deleted from the tree it is a literal like any other, and
    # the file that still says it is the fact (run-88's `run_acceptance.sh`).
    (repo / "notes.md").write_text("still says run_gone.sh here\n")
    git(repo, "rm", "-q", "run_gone.sh")
    git(repo, "add", "notes.md")
    git(repo, "commit", "-q", "-m", "delete run_gone.sh")
    _, out = check(plan, base=repo)
    hits = [l for l in facts(out) if "`run_gone.sh`" in l]
    assert len(hits) == 1 and "notes.md" in hits[0], \
        "leg (c) [M3]: a path-shaped literal the tree lacks names its carriers:\n" + out


# --- (d) [M4] silence without a base, and on a legacy plan --------------- #

def test_no_base_and_legacy_plans_print_no_fact(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(repo, plan_text(["- Delete: `pkg/old.py`"]))
    rc, out = check(plan)
    assert rc == 0 and out == "PLAN OK\n", "leg (d) [M4]: bare --check is the verdict alone: %r" % out
    legacy = repo / "docs" / "legacy.md"
    legacy.write_text(plan_text(["- Modify: `pkg/keep.py`"], grammar=False)
                      .replace("**Claim:** do: run it. see: it works. (derived)\n", "")
                      .replace("Machine: M1. the output says `%s` and never `run_gone.sh`.\n" % LITERAL, "")
                      + "\n- [ ] **Step 1:** do it\n")
    rc, out = check(legacy, base=repo)
    assert facts(out) == [], "leg (d) [M4]: a legacy plan prints no BASE fact:\n" + out
