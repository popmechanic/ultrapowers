"""`--check --renders` (#345 eval cell): the advisory-render surface.

The check vocabulary is frozen, so renders are ADVISORY: they print after the
verdict, only under --renders, never change the exit code, and print nothing
when there is nothing to say — `PLAN OK` stays byte-identical. This module
holds the plumbing pins (Task 1) and the append zone for the per-render pins
(P1 blast-radius, P2 referent) that later tasks add below.
"""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

CANONICAL = ("wide", "chained", "mixed", "degrade", "contend")

CLEAN_PLAN = """# P

**Acceptance:** suite — test

### Task 1: A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: do it**
"""

VIOLATING_PLAN = CLEAN_PLAN.replace("- Modify: `src/a.py`",
                                    "- Modify: `src/a.py` (only the top half)")


def git_repo(tmp_path, files):
    """A throwaway git checkout holding `files` ({relpath: text}), all
    tracked via the index — `git ls-files`/`git grep` need no commit."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    for rel, text in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    return repo


def check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True)


# --------------------------------------------------------------------------- #
# Task 1 — plumbing                                                            #
# --------------------------------------------------------------------------- #
def test_renders_requires_check(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    p = subprocess.run([sys.executable, str(COMPILER), str(plan), "--renders"],
                       capture_output=True, text=True)
    assert p.returncode != 0
    assert "--renders requires --check" in p.stderr


def test_base_requires_renders(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    p = check(plan, "--base", str(tmp_path))
    assert p.returncode != 0
    assert "--base requires --renders" in p.stderr


def test_canonical_fixtures_print_exactly_plan_ok_with_and_without_renders():
    # THE byte-identity pin: on every canonical fixture, arm A and arm B
    # produce the identical single line. Holds before any render is
    # registered and must keep holding after P1/P2 land (zero advisories).
    for name in CANONICAL:
        plan = ROOT / "evals/fixtures" / name / "plan.md"
        base = ROOT / "evals/fixtures" / name / "project"
        a = check(plan)
        b = check(plan, "--renders", "--base", str(base))
        assert a.returncode == 0 and b.returncode == 0, name
        assert a.stdout == "PLAN OK\n", (name, a.stdout)
        assert b.stdout == "PLAN OK\n", (name, b.stdout)


def test_renders_skip_note_when_base_is_not_a_git_checkout(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    nogit = tmp_path / "nogit"
    nogit.mkdir()
    p = check(plan, "--renders", "--base", str(nogit))
    assert p.returncode == 0
    lines = p.stdout.splitlines()
    assert lines[0] == "PLAN OK"
    assert lines[1] == ""
    assert lines[2].startswith("advisory renders skipped: ")
    assert "not a git checkout" in lines[2]


def test_registered_render_prints_after_verdict_and_never_changes_exit(tmp_path, monkeypatch, capsys):
    repo = git_repo(tmp_path, {"src/a.py": "x = 1\n"})
    fake = [("fake", lambda tasks, ctx: ["ADVISORY fake: Task %s hi" % tasks[0]["id"]])]
    monkeypatch.setattr(compile_plan, "ADVISORY_RENDERS", fake)

    clean = tmp_path / "clean.md"
    clean.write_text(CLEAN_PLAN)
    rc = compile_plan.main(["--check", str(clean), "--renders", "--base", str(repo)])
    assert rc == 0
    assert capsys.readouterr().out == "PLAN OK\n\nADVISORY fake: Task 1 hi\n"

    bad = tmp_path / "bad.md"
    bad.write_text(VIOLATING_PLAN)
    rc = compile_plan.main(["--check", str(bad), "--renders", "--base", str(repo)])
    assert rc == 2
    out = capsys.readouterr().out
    assert "1 violation(s)\n\nADVISORY fake: Task 1 hi\n" in out
    assert out.endswith("ADVISORY fake: Task 1 hi\n")


def test_render_context_shape(tmp_path, monkeypatch):
    repo = git_repo(tmp_path, {"src/a.py": "x = 1\n", "README.md": "hi\n"})
    seen = {}

    def spy(tasks, ctx):
        seen["tasks"] = [t["id"] for t in tasks]
        seen["ctx"] = ctx
        return []

    monkeypatch.setattr(compile_plan, "ADVISORY_RENDERS", [("spy", spy)])
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    assert compile_plan.render_advisories(plan, repo) == []
    assert seen["tasks"] == ["1"]
    assert seen["ctx"]["base"] == repo
    assert seen["ctx"]["plan_path"] == plan.resolve()
    assert seen["ctx"]["tracked"] == {"src/a.py", "README.md"}
    assert seen["ctx"]["task_ids"] == {"1"}


def test_git_helpers_search_code_files_only(tmp_path):
    repo = git_repo(tmp_path, {
        "src/a.py": "def helper():\n    return 1\n",
        "tests/t.mjs": "helper()\n",
        "notes.md": "helper is documented here\n",
        "data.json": "{\"helper\": 1}\n",
    })
    assert compile_plan._git_tracked(repo) == {"src/a.py", "tests/t.mjs", "notes.md", "data.json"}
    assert compile_plan._git_word_files(repo, "helper") == ["src/a.py", "tests/t.mjs"]
    assert compile_plan._git_word_files(repo, "nothing_here") == []
    assert compile_plan._git_literal_in_code(repo, "helper()") is True
    assert compile_plan._git_literal_in_code(repo, "documented") is False
    assert compile_plan.default_base(tmp_path / "repo" / "src" / "a.py") == repo.resolve()
    assert compile_plan.default_base(tmp_path / "nowhere.md") is None


def test_renders_run_nothing_on_a_plan_the_check_refused_structurally(tmp_path, monkeypatch):
    # duplicate task ids abort the check early; renders must not run over a
    # parse that could not be trusted.
    repo = git_repo(tmp_path, {"src/a.py": "x\n"})
    monkeypatch.setattr(compile_plan, "ADVISORY_RENDERS",
                        [("boom", lambda tasks, ctx: ["ADVISORY boom: Task 1"])])
    plan = tmp_path / "dup.md"
    plan.write_text(CLEAN_PLAN + "\n" + CLEAN_PLAN.split("**Acceptance:** suite — test\n")[1])
    assert compile_plan.render_advisories(plan, repo) == []


# --------------------------------------------------------------------------- #
# Task 2 — P1 blast-radius                                                     #
# --------------------------------------------------------------------------- #
P1_PLAN = """# P

**Acceptance:** suite — test

### Task 1: producer

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/lib.py`

**Interfaces:**
- Consumes: nothing
- Produces: `helper(x: int) -> dict` now returns a dict; the `delivered` flag and the `shapeChanged` field are new
- Produces: `main()` unchanged

- [ ] **Step 1: do it**

### Task 2: consumer

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/other.py`
- Test: `tests/test_other.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: do it**
"""

P1_FILES = {
    "src/lib.py": "def helper(x):\n    return {}\n\ndef main():\n    pass\n",
    "src/other.py": "from lib import helper\n",
    "tests/test_other.py": "assert helper(1) == {}\nshapeChanged = True\n",
    "tests/test_lib.py": "from lib import helper, main\ndelivered = True\n",
    "notes.md": "helper and shapeChanged are documented here\n",
}


def test_produces_symbols_heuristics():
    task = {"interfaces": {"produces": [
        "`helper(x: int) -> dict` now returns a dict; the `delivered` flag and the `shapeChanged` field are new",
        "`main()` unchanged",
        "`runShim(...)` resolves `{ status: string, delivered: boolean }`",
        "`driveOne` gains optional `provision = provisionRun` and `destroy = destroySandbox`",
        "nothing",
        "`CREDITS_REFUSAL_NOTE` constant",
        "`schema.User` dataclass",
    ]}}
    # `provision = provisionRun` reduces (cut at whitespace) to the non-lead
    # single word `provision` and is dropped; `{ status: … }` reduces to `{`.
    assert compile_plan._produces_symbols(task) == [
        "helper", "shapeChanged", "runShim", "driveOne", "CREDITS_REFUSAL_NOTE"]


def test_blast_radius_lists_code_files_outside_own_files(tmp_path):
    repo = git_repo(tmp_path, P1_FILES)
    plan = tmp_path / "plan.md"
    plan.write_text(P1_PLAN)
    p = check(plan, "--renders", "--base", str(repo))
    assert p.returncode == 0
    assert p.stdout == (
        "PLAN OK\n"
        "\n"
        "ADVISORY blast-radius: Task 1 Produces `helper` — 3 file(s) at BASE outside Task 1's Files mention it:\n"
        "  - src/other.py\n"
        "  - tests/test_lib.py\n"
        "  - tests/test_other.py\n"
        "ADVISORY blast-radius: Task 1 Produces `shapeChanged` — 1 file(s) at BASE outside Task 1's Files mention it:\n"
        "  - tests/test_other.py\n"
    )
    # `main` (lead, 4 chars) and `delivered` (non-lead single word) are not
    # keyed; notes.md is not a code file; src/lib.py is Task 1's own file;
    # Task 2 Produces nothing.
    assert "`main`" not in p.stdout and "`delivered`" not in p.stdout
    assert "notes.md" not in p.stdout and "src/lib.py" not in p.stdout
    assert "Task 2 Produces" not in p.stdout
    # arm A on the same plan is the bare verdict
    assert check(plan).stdout == "PLAN OK\n"


def test_blast_radius_caps_the_file_list_at_eight(tmp_path):
    files = {"src/lib.py": "def widgetMaker():\n    pass\n"}
    for i in range(10):
        files["tests/t%02d.py" % i] = "widgetMaker()\n"
    repo = git_repo(tmp_path, files)
    plan = tmp_path / "plan.md"
    plan.write_text(P1_PLAN.replace("`helper(x: int) -> dict` now returns a dict; the `delivered` flag and the `shapeChanged` field are new",
                                    "`widgetMaker()`"))
    p = check(plan, "--renders", "--base", str(repo))
    lines = p.stdout.splitlines()
    header = [l for l in lines if "Produces `widgetMaker`" in l][0]
    assert header.endswith("— 10 file(s) at BASE outside Task 1's Files mention it:")
    i = lines.index(header)
    assert lines[i + 1:i + 9] == ["  - tests/t%02d.py" % k for k in range(8)]
    assert lines[i + 9] == "  … +2 more"


def test_blast_radius_is_silent_on_canonical_fixtures():
    for name in CANONICAL:
        plan = ROOT / "evals/fixtures" / name / "plan.md"
        base = ROOT / "evals/fixtures" / name / "project"
        p = check(plan, "--renders", "--base", str(base))
        assert p.returncode == 0 and "ADVISORY blast-radius" not in p.stdout, name


# --- per-render pins are appended below this line (append zone) ------------
