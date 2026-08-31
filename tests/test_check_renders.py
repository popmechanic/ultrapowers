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
    assert lines == ["PLAN OK", "",
                     "ADVISORY renders skipped: %s is not a git checkout" % nogit]


def test_renders_skip_note_when_plan_is_outside_any_checkout_and_no_base(tmp_path):
    # default_base() is None here; the note must still carry the ADVISORY
    # prefix and name the directory it looked from — never a literal `None`.
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    p = check(plan, "--renders")
    assert p.returncode == 0
    lines = p.stdout.splitlines()
    assert lines == ["PLAN OK", "",
                     "ADVISORY renders skipped: no git checkout found for %s (pass --base)"
                     % tmp_path.resolve()]
    assert "None" not in p.stdout


def test_every_renders_line_starts_with_the_advisory_prefix(tmp_path):
    # the one shape contract every --renders line honours, across the skip
    # notes, the registered renders and the failure line alike.
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    nogit = tmp_path / "nogit"
    nogit.mkdir()
    for extra in (("--renders",), ("--renders", "--base", str(nogit))):
        out = check(plan, *extra).stdout
        tail = out.split("PLAN OK\n\n", 1)[1]
        assert tail and all(l.startswith("ADVISORY ") for l in tail.splitlines()), out


def test_failing_render_degrades_to_one_line_and_never_changes_exit(tmp_path, monkeypatch, capsys):
    repo = git_repo(tmp_path, {"src/a.py": "x = 1\n"})

    def boom(tasks, ctx):
        raise RuntimeError("no")

    monkeypatch.setattr(compile_plan, "ADVISORY_RENDERS", [
        ("boom", boom), ("after", lambda tasks, ctx: ["ADVISORY after: Task 1 ran"])])
    plan = tmp_path / "plan.md"
    plan.write_text(CLEAN_PLAN)
    rc = compile_plan.main(["--check", str(plan), "--renders", "--base", str(repo)])
    assert rc == 0
    assert capsys.readouterr().out == (
        "PLAN OK\n\nADVISORY boom: render failed (RuntimeError)\nADVISORY after: Task 1 ran\n")


def test_exclude_hides_paths_from_every_tracked_file_lookup(tmp_path):
    # --exclude (repeatable, requires --renders): the eval campaign's seam for
    # keeping its own files out of the measurement. Hidden from the blast
    # list, from the referent resolver's grep, and from ctx["tracked"].
    repo = git_repo(tmp_path, {
        "src/lib.py": "def widgetMaker():\n    pass\n",
        "tests/t1.py": "widgetMaker()\n",
        "tests/self_test.py": "widgetMaker()\nOUT = 'ghost/file.json'\n",
    })
    plan = tmp_path / "plan.md"
    plan.write_text(P1_PLAN.replace(
        "`helper(x: int) -> dict` now returns a dict; the `delivered` flag and the `shapeChanged` field are new",
        "`widgetMaker()`").replace("- [ ] **Step 1: do it**\n\n### Task 2",
                                   "- [ ] **Step 1:** write `ghost/file.json`\n\n### Task 2", 1))
    full = check(plan, "--renders", "--base", str(repo)).stdout
    assert "  - tests/self_test.py\n" in full and "ghost/file.json" not in full
    p = check(plan, "--renders", "--base", str(repo), "--exclude", "tests/self_test.py")
    assert p.returncode == 0
    assert p.stdout == (
        "PLAN OK\n"
        "\n"
        "ADVISORY blast-radius: Task 1 Produces `widgetMaker` — 1 file(s) at BASE outside Task 1's Files mention it:\n"
        "  - tests/t1.py\n"
        "ADVISORY referent: Task 1 names `ghost/file.json` — not at BASE, not in Task 1's Files, not Created by a task it Depends-on\n"
    )
    assert compile_plan._git_tracked(repo, ("tests/self_test.py",)) == {"src/lib.py", "tests/t1.py"}
    q = check(plan, "--exclude", "tests/self_test.py")
    assert q.returncode != 0 and "--exclude requires --renders" in q.stderr


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


# --------------------------------------------------------------------------- #
# Task 3 — P2 referent-existence                                              #
# --------------------------------------------------------------------------- #
P2_PLAN = """# P

**Acceptance:** suite — test

### Task 1: creator

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/new_mod.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1:** write `src/new_mod.py` beside `src/present.py`; note `src/missing.py`, `present.py`, `./rel.mjs`, `../up.mjs`, `/tmp/scratch`, `text/html`, `src/{a,b}.py`, `src/<name>.py`, `https://example.com/x.md`, `fleet-run.json`, and `src/missing.py:12-40` again

### Task 2: depender

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `src/present.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1:** read `src/new_mod.py`; fields `result.gitVerified`, `tasks[].status`, `report.nope`, `detail.errors`, `detail.creditSpendUsd`, `waveMerges[].headSha`; see Task 1 and Task 9 and Task 9 again; Task agents see only their body; Task IDs are strings

```markdown
Inside a fence: `docs/inside-fence.md` and `Task 99` and `detail.creditSpendUsd`.
```

### Task 3: stranger

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1:** also touches `src/new_mod.py`
"""

P2_FILES = {
    "src/present.py": "errors = []\nOUT = 'fleet-run.json'\n",
    "README.md": "hi\n",
}


def test_path_referent_heuristics():
    f = compile_plan._path_referent
    assert f("src/missing.py") == "src/missing.py"
    assert f("src/missing.py:12-40") == "src/missing.py"
    assert f("docs/dir/") == "docs/dir"
    assert f("present.py") == "present.py"
    assert f("fleet-run.json") == "fleet-run.json"
    for skip in ("./rel.mjs", "../up.mjs", "/tmp/scratch", "text/html",
                 "src/{a,b}.py", "src/<name>.py", "https://example.com/x.md",
                 "src/*.py", "${dbDir}-evidence", "~/.claude/x.md",
                 "fetch('/links')", "a b/c", "-flag", "helper", "schema.User",
                 "detail.errors", "0.2.22", ".gitignore"):
        assert f(skip) is None, skip


def test_report_field_vocab_reads_report_format():
    vocab = compile_plan._report_field_vocab()
    for name in ("integrationBranch", "gitVerified", "waveMerges", "headSha",
                 "status", "detail", "coverage", "complete", "tasks_merged"):
        assert name in vocab, name
    assert "creditSpendUsd" not in vocab


def test_missing_report_format_degrades_to_a_note_not_a_traceback(tmp_path):
    # the critic's repro: the compiler copied into a tree with no
    # report-format.md. PLAN OK, exit 0, one note, field referents skipped
    # (never reported as unknown), path/task referents still rendered.
    tree = tmp_path / "tree" / "skills" / "ultrapowers" / "scripts"
    tree.mkdir(parents=True)
    copy = tree / "compile_plan.py"
    copy.write_text(COMPILER.read_text())
    repo = git_repo(tmp_path, P2_FILES)
    plan = tmp_path / "plan.md"
    plan.write_text(P2_PLAN)
    p = subprocess.run([sys.executable, str(copy), "--check", str(plan),
                        "--renders", "--base", str(repo)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "Traceback" not in p.stderr and "render failed" not in p.stdout
    assert p.stdout.startswith("PLAN OK\n\n")
    adv = [l for l in p.stdout.splitlines() if l.startswith("ADVISORY referent:")]
    assert adv[0] == ("ADVISORY referent: report-format.md vocabulary unavailable — "
                      "field referents not checked")
    assert not any("report-format.md field" in l for l in adv)
    assert any("names `src/missing.py`" in l for l in adv)
    assert any("names Task 9" in l for l in adv)


def test_referents_render_each_unresolved_once(tmp_path):
    repo = git_repo(tmp_path, P2_FILES)
    plan = tmp_path / "plan.md"
    plan.write_text(P2_PLAN)
    p = check(plan, "--renders", "--base", str(repo))
    assert p.returncode == 0
    adv = [l for l in p.stdout.splitlines() if l.startswith("ADVISORY referent:")]
    assert adv == [
        "ADVISORY referent: Task 1 names `src/missing.py` — not at BASE, not in Task 1's Files, not Created by a task it Depends-on",
        "ADVISORY referent: Task 2 names `report.nope` — `nope` is not a report-format.md field and appears in no code file at BASE",
        "ADVISORY referent: Task 2 names `detail.creditSpendUsd` — `creditSpendUsd` is not a report-format.md field and appears in no code file at BASE",
        "ADVISORY referent: Task 2 names `docs/inside-fence.md` — not at BASE, not in Task 2's Files, not Created by a task it Depends-on",
        "ADVISORY referent: Task 2 names Task 9 — no such task heading in this plan",
        "ADVISORY referent: Task 3 names `src/new_mod.py` — not at BASE, not in Task 3's Files, not Created by a task it Depends-on",
    ]
    # nothing else leaked: resolved paths, skipped shapes, resolved fields,
    # real task refs, prose "Task agents"/"Task IDs", fenced `Task 99`.
    for absent in ("present.py", "rel.mjs", "up.mjs", "/tmp/scratch", "text/html",
                   "{a,b}", "<name>", "example.com", "fleet-run.json",
                   "gitVerified", "tasks[].status", "detail.errors", "headSha",
                   "names Task 1", "Task 99", "agents", "IDs"):
        assert not any(absent in l for l in adv), absent
    assert check(plan).stdout == "PLAN OK\n"


def test_referents_are_silent_on_canonical_fixtures():
    for name in CANONICAL:
        plan = ROOT / "evals/fixtures" / name / "plan.md"
        base = ROOT / "evals/fixtures" / name / "project"
        p = check(plan, "--renders", "--base", str(base))
        assert p.returncode == 0 and "ADVISORY referent" not in p.stdout, name


# --------------------------------------------------------------------------- #
# P3 — unverifiable-from-sandbox (#458)                                        #
# --------------------------------------------------------------------------- #
HAND_EXECUTED_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Correct the runbook

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/RUNBOOK.md`

- [ ] **Step 1: fix the install line**

### Task 2: Ordinary code change

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/run-engine.mjs`

- [ ] **Step 1: do it**
"""

P3_FILES = {
    "fleet/RUNBOOK.md": "# runbook\n",
    "fleet/run-engine.mjs": "export const x = 1\n",
    "fleet/tests/PROBES.md": "# probes\n",
}

_UNVERIFIABLE = ("ADVISORY unverifiable-from-sandbox: Task %s edits %s — a "
                 "hand-executed record. No reviewer can check its claims from a "
                 "sandbox; carry the evidence (commands and their output) in the "
                 "task body so review can check correspondence instead of truth.")


def test_renders_flag_a_task_editing_a_hand_executed_record(tmp_path):
    """#458: run-30's three acks were guaranteed by its Task 5's shape before
    the run started. A sandbox cannot verify a claim about a live VM."""
    repo = git_repo(tmp_path, P3_FILES)
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN)
    r = check(plan, "--renders", "--base", str(repo))
    assert r.returncode == 0
    assert "PLAN OK" in r.stdout
    adv = [l for l in r.stdout.splitlines()
           if l.startswith("ADVISORY unverifiable-from-sandbox")]
    assert adv == [_UNVERIFIABLE % ("1", "fleet/RUNBOOK.md")]
    # the ordinary task must not be flagged
    assert "Task 2" not in r.stdout.split("ADVISORY unverifiable-from-sandbox")[1]


def test_renders_advisory_does_not_change_the_frozen_verdict(tmp_path):
    """The advisory is additive: the verdict, its wording and the exit code are
    frozen at 0.1.0 and must be byte-identical with and without --renders."""
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN)
    plain = check(plan)
    assert plain.returncode == 0
    assert plain.stdout.strip() == "PLAN OK"


def test_unverifiable_advisory_names_every_hand_executed_record_a_task_edits(tmp_path):
    """One line per offending task, listing its records sorted — not one line
    per record, and not a bare count."""
    repo = git_repo(tmp_path, P3_FILES)
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN.replace(
        "- Modify: `fleet/RUNBOOK.md`",
        "- Modify: `fleet/tests/PROBES.md`\n- Modify: `fleet/RUNBOOK.md`"))
    r = check(plan, "--renders", "--base", str(repo))
    assert r.returncode == 0
    adv = [l for l in r.stdout.splitlines()
           if l.startswith("ADVISORY unverifiable-from-sandbox")]
    assert adv == [_UNVERIFIABLE % ("1", "fleet/RUNBOOK.md, fleet/tests/PROBES.md")]


def test_unverifiable_advisory_covers_created_records_not_only_modified(tmp_path):
    """Writing a hand-executed record from scratch makes the same unverifiable
    claims as editing one."""
    repo = git_repo(tmp_path, {"fleet/run-engine.mjs": "export const x = 1\n"})
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN.replace("- Modify: `fleet/RUNBOOK.md`",
                                               "- Create: `fleet/RUNBOOK.md`"))
    r = check(plan, "--renders", "--base", str(repo))
    assert r.returncode == 0
    adv = [l for l in r.stdout.splitlines()
           if l.startswith("ADVISORY unverifiable-from-sandbox")]
    assert adv == [_UNVERIFIABLE % ("1", "fleet/RUNBOOK.md")]


def test_unverifiable_advisory_is_silent_on_a_task_that_only_reads_one(tmp_path):
    """Reading a hand-executed record asserts nothing about live infrastructure;
    only a task that writes one carries unverifiable claims. (`Test:` is this
    grammar's read label.)"""
    repo = git_repo(tmp_path, P3_FILES)
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN.replace("- Modify: `fleet/RUNBOOK.md`",
                                               "- Test: `fleet/RUNBOOK.md`\n"
                                               "- Modify: `fleet/other.md`"))
    r = check(plan, "--renders", "--base", str(repo))
    assert r.returncode == 0
    assert "unverifiable-from-sandbox" not in r.stdout


def test_unverifiable_advisory_is_silent_on_canonical_fixtures():
    for name in CANONICAL:
        plan = ROOT / "evals/fixtures" / name / "plan.md"
        base = ROOT / "evals/fixtures" / name / "project"
        p = check(plan, "--renders", "--base", str(base))
        assert p.returncode == 0 and "unverifiable-from-sandbox" not in p.stdout, name


def test_hand_executed_records_is_a_tuple_of_paths_present_at_head():
    """A short explicit list, not a heuristic — and every entry names a file
    that exists, so the constant cannot rot into a no-op."""
    assert isinstance(compile_plan.HAND_EXECUTED_RECORDS, tuple)
    assert "fleet/RUNBOOK.md" in compile_plan.HAND_EXECUTED_RECORDS
    for rel in compile_plan.HAND_EXECUTED_RECORDS:
        assert isinstance(rel, str) and not rel.startswith("/"), rel
        assert (ROOT / rel).is_file(), rel
