# `--check` Renders Eval Cell Implementation Plan (#345)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two advisory `--check` renders commissioned by #345 — P1 Produces blast-radius and P2 referent-existence — behind a `--renders` flag, plus the A/B campaign script that measures both over the fixture corpus and the 2026-08-27 fleet plans and writes the results doc the operator adjudicates.

**Architecture:** `compile_plan.py --check` gains an advisory-render registry (`ADVISORY_RENDERS`) that runs ONLY under `--renders`, prints AFTER the frozen check verdict, and prints nothing when it has nothing to say — so the `PLAN OK` line stays byte-identical and the exit code is never touched. P1 and P2 are two independent render functions registered on that surface; each keys off the same `parse_task` output the compiler already produces, plus `git ls-files` / `git grep` against a `--base` tree (default: the git toplevel of the plan's directory). `evals/check_renders_ab.py` runs arm A (`--check`) and arm B (`--check --renders`) over the corpus and writes `evals/frontier/results/2026-08-29-check-renders.md`.

**Tech Stack:** Python 3 stdlib only (`re`, `subprocess`, `pathlib`); `git` on PATH; pytest.

**Spec:** issue #345 (the commission) + `docs/superpowers/specs/2026-08-28-distill-proposals.md` P1/P2 (the adopted proposals; prose halves shipped in #346, this is the engine half) + the frozen-vocabulary rule in `CLAUDE.md` ("The verification periphery is FROZEN (0.1.0)").

**Acceptance:** suite — the committed suite (synthetic-plan pins on both renders, the byte-identity pin on the canonical fixtures, and the campaign script's output-schema pin) plus per-task review is the verification. The eval NUMBERS are not asserted by any test.

**Adoption bar (from #345 — the operator's mechanical verdict at integration, NOT a task):** every known instance surfaced (the `## Known instances` table in the results doc reads `yes` on every row) AND zero false positives on the wide/chained/mixed/degrade/contend fixtures (the `## Canonical false positives` table is all zeros). The doc's `## Bar` section computes both; the operator reads it and decides whether the renders graduate from `--renders` to default-on in a later, separate change.

## Global Constraints

- Lane: `skills/ultrapowers/scripts/compile_plan.py`, `tests/*.py`, `evals/check_renders_ab.py`, `evals/frontier/results/2026-08-29-check-renders.md` ONLY. `skills/ultrapowers/references/report-format.md` is READ-only. Never touch `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/references/reviewer-prompts.md`, anything under `skills/ultraplan/`, or anything under `fleet/` — a concurrent plan owns those.
- The `--check` diagnostic vocabulary is frozen (0.1.0): the renders are ADVISORY. `compile_plan.py --check` exit codes (0 = `PLAN OK`, 2 = violations) are unchanged with or without `--renders`; no advisory ever changes an exit code.
- Every advisory line starts with the literal prefix `ADVISORY ` and prints only under `--renders`. Without `--renders`, `--check` stdout is byte-for-byte what it is at BASE. With `--renders`, a plan with zero advisories prints exactly what it prints without the flag (no trailing blank line, no footer).
- Plain compile (no `--check`) is untouched: no new edges, no new `marker_conflicts` entries, no output change.
- No `anthropic` SDK, no `ANTHROPIC_API_KEY`, no new third-party dependency; `git` is the only external tool the renders call, and every git failure degrades to "no information" (never a traceback).
- Tests use a per-test `tmp_path` git repo (`git init` + `git add`; no commits needed for `git ls-files`/`git grep`) — no shared on-disk fixtures, no ports.
- `python3 -m pytest` green at task end (baseline: 1159 tests on `main` at `7dfc4fa`, plus whatever `main` has gained).

---

### Task 1: Advisory-render plumbing — `--renders`/`--base` flags, registry, git helpers, byte-identity pin

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Create: `tests/test_check_renders.py`

**Interfaces:**
- Consumes: nothing from sibling tasks (uses the existing `split_tasks`, `parse_task`, `_malformed_task_headings`, `collect_violations` in `compile_plan.py`).
- Produces: `ADVISORY_RENDERS: list[tuple[str, Callable]]` (module-level registry; each entry is `(name, fn)` with `fn(tasks, ctx) -> list[str]`), `CODE_EXTS: tuple[str, ...]`, `_git(base, *args) -> str`, `_git_tracked(base) -> set[str]`, `_git_word_files(base, word) -> list[str]`, `_git_literal_in_code(base, literal) -> bool`, `default_base(plan_path) -> Path | None`, `render_advisories(plan_path, base) -> list[str]`, and the `ctx` dict shape `{"base": Path, "plan_path": Path, "tracked": set[str], "task_ids": set[str]}`; CLI flags `--renders` (requires `--check`) and `--base DIR` (requires `--renders`). Test helpers `git_repo(tmp_path, files: dict[str, str]) -> Path`, `check(plan, *extra) -> CompletedProcess`, and `CANONICAL: tuple[str, ...]` in `tests/test_check_renders.py`.

**Parallelization rationale:** the registry + git helpers are the shared contract both renders build against; fixing it first lets P1 and P2 (genuinely independent scans over the same parse) run in one wave. A good engineer would factor the flag/registry/git plumbing out of the two renders regardless — it is one seam, not two.

**Why a flag:** the check vocabulary is frozen, so the renders ship OFF. Arm B of the eval is `--check --renders`; adoption (flipping the default) is a later, operator-made change, never part of this plan.

- [ ] **Step 1: Write the failing tests** — create `tests/test_check_renders.py`:

```python
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


# --- per-render pins are appended below this line (append zone) ------------
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_check_renders.py -q`
Expected: FAIL — `--renders` is an unrecognized argument (argparse exit 2 with "unrecognized arguments", not the required message), `compile_plan` has no `ADVISORY_RENDERS`/`render_advisories`/`_git_tracked`.

- [ ] **Step 3: Add the plumbing to `skills/ultrapowers/scripts/compile_plan.py`.** Add `import subprocess` to the import block (after `import re`). Then insert the following block immediately BEFORE `def main(argv=None):`:

```python
# --------------------------------------------------------------------------- #
# Advisory renders (#345 eval cell) — `--check --renders` ONLY.               #
# --------------------------------------------------------------------------- #
# The --check diagnostic vocabulary is frozen (0.1.0). These renders are
# ADVISORY: they print AFTER the check verdict, never change the exit code,
# and print nothing at all when they have nothing to say — so `PLAN OK` stays
# byte-identical on a clean plan. They live behind the `--renders` flag so the
# default `--check` output is unchanged until an eval-measured adoption flips
# the default (evals/check_renders_ab.py writes the measurement).
#
# A render is `fn(tasks, ctx) -> list[str]`: `tasks` is the parse_task output
# for every task in document order; `ctx` is {"base": Path, "plan_path": Path,
# "tracked": set[str] (git ls-files under base), "task_ids": set[str]}. Every
# line a render returns starts with the literal prefix "ADVISORY ".
CODE_EXTS = (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh")
# Registry of (name, fn). Renders APPEND themselves here — an order-insensitive
# registration surface; the order lines print in is registration order.
ADVISORY_RENDERS = []


def _git(base, *args):
    """git in `base`; stdout text, or '' on ANY failure (missing git, not a
    checkout, no match) — advisory code never raises."""
    try:
        p = subprocess.run(["git", "-C", str(base), *args],
                           capture_output=True, text=True)
    except OSError:
        return ""
    return p.stdout if p.returncode == 0 else ""


def _git_tracked(base):
    """Tracked paths under `base`, relative to it."""
    return set(_git(base, "ls-files").split())


def _code_pathspecs():
    return ["--"] + ["*" + ext for ext in CODE_EXTS]


def _git_word_files(base, word):
    """Tracked CODE files (CODE_EXTS) under `base` containing `word` as a
    whole word (`git grep -l -w -F`), sorted, relative to `base`."""
    return sorted(_git(base, "grep", "-l", "-w", "-F", word, *_code_pathspecs()).split())


def _git_literal_in_code(base, literal):
    """True when some tracked CODE file under `base` contains `literal`."""
    return bool(_git(base, "grep", "-l", "-F", literal, *_code_pathspecs()).strip())


def default_base(plan_path):
    """The git toplevel of the plan's directory, or None outside a checkout."""
    top = _git(Path(plan_path).resolve().parent, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else None


def render_advisories(plan_path, base):
    """Every registered render's lines for `plan_path` against the tree at
    `base`. Returns [] when the plan failed the check's structural early-abort
    net (malformed heading, no tasks, duplicate ids) — a parse the check could
    not trust is not one to render over. A `base` that is not a git checkout
    yields the single skip note instead of guessing."""
    plan_text = Path(plan_path).read_text()
    if _malformed_task_headings(plan_text):
        return []
    raw = split_tasks(plan_text)
    ids = [t["id"] for t in raw]
    if not raw or len(set(ids)) != len(ids):
        return []
    if base is None or not _git(base, "rev-parse", "--show-toplevel").strip():
        return ["advisory renders skipped: %s is not a git checkout" % base]
    tasks = [parse_task(t, raise_on_marker_error=False) for t in raw]
    ctx = {"base": Path(base), "plan_path": Path(plan_path).resolve(),
           "tracked": _git_tracked(base), "task_ids": set(ids)}
    lines = []
    for _name, fn in ADVISORY_RENDERS:
        lines.extend(fn(tasks, ctx))
    return lines


# --- advisory renders register below (append zone) --------------------------
```

- [ ] **Step 4: Wire the flags into `main()`.** Add the two arguments after the existing `--run-dir` argument:

```python
    ap.add_argument("--renders", action="store_true",
                    help="with --check only (#345): after the verdict, print "
                         "the ADVISORY renders (Produces blast-radius, "
                         "referent-existence). Advisory: never changes the exit "
                         "code; prints nothing when there is nothing to say.")
    ap.add_argument("--base", type=Path, default=None,
                    help="with --renders only: the tree the renders resolve "
                         "against (default: the git toplevel of the plan's "
                         "directory)")
```

Then, immediately after the existing `if args.check and (emit_launch is not None ...` mutual-exclusion `sys.exit(...)`, add:

```python
    if args.renders and not args.check:
        sys.exit("error: --renders requires --check (renders are the check's "
                 "advisory tail; plain compile never prints them)")
    if args.base is not None and not args.renders:
        sys.exit("error: --base requires --renders")
```

And replace the existing `--check` branch —

```python
    if args.check:
        violations = collect_violations(args.plan)
        if violations:
            print("\n\n".join(violations))
            print()
            print(f"{len(violations)} violation(s)")
            return 2
        print("PLAN OK")
        return 0
```

— with:

```python
    if args.check:
        violations = collect_violations(args.plan)
        if violations:
            print("\n\n".join(violations))
            print()
            print(f"{len(violations)} violation(s)")
            rc = 2
        else:
            print("PLAN OK")
            rc = 0
        if args.renders:
            # Advisory tail (#345): after the frozen verdict, separated by one
            # blank line, ONLY when there is something to say. rc is untouched.
            lines = render_advisories(args.plan,
                                      args.base if args.base is not None
                                      else default_base(args.plan))
            if lines:
                print()
                print("\n".join(lines))
        return rc
```

- [ ] **Step 5: Run the new tests and the existing check pins**

Run: `python3 -m pytest tests/test_check_renders.py tests/test_plan_check.py tests/test_flawed_grammar.py tests/test_compile_plan.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_check_renders.py
git commit -m "feat(compile_plan): --check --renders advisory-render plumbing — registry, git helpers, byte-identity pin (#345)"
```

---

### Task 2: P1 — Produces blast-radius render

**Type:** implementation
**Depends-on:** 1
**Commutes:** `skills/ultrapowers/scripts/compile_plan.py`, `tests/test_check_renders.py`

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_check_renders.py`

**Interfaces:**
- Consumes: `ADVISORY_RENDERS`, `_git_word_files(base, word)`, the `ctx` dict shape (from Task 1); `PATH_RE`, `PLACEHOLDER_TOKENS` (existing); test helpers `git_repo`, `check`, `CANONICAL` (from Task 1).
- Produces: `_produces_symbols(task) -> list[str]`, `_render_blast_radius(tasks, ctx) -> list[str]`, registered as `("blast-radius", _render_blast_radius)`.

**The rule (P1, #233 build):** for every symbol a task's `Interfaces: Produces` declares, list the CODE files at BASE outside that task's own `Files:` that mention the symbol as a whole word. Keyed on EVERY Produces symbol — additive shape changes too (run-14's `runShim` outcome gained a `delivered` field; the strict-equality pin `assert.deepEqual(await sandbox, { status: 'gate-green', delivered: true })` lived in sibling-owned `fleet/tests/test_drive.mjs`, and a deleted/renamed-only grep would have missed it). Advisory: a listed file is a place the implementer must look, not a violation.

**Symbol heuristics (decided here, pinned by the tests):**
- Each backticked span in a Produces entry, reduced the way `_interface_token` reduces its lead span (cut at the first `(`, whitespace, or `:`), kept only if identifier-shaped (`^[A-Za-z_]\w*$`) and not a placeholder (`nothing`/`none`/`n/a`/`na`).
- The entry's LEAD span (the compiler's own contract token) is kept when it is ≥ 5 chars or multi-word (camelCase / snake_case / CONSTANT_CASE: an uppercase letter after the first char, or an underscore). Non-lead spans are kept only when multi-word. Single common words (`main`, `null`, `false`, `token`, `delivered`) are noise measured on the 2026-08-27 plans — `main` alone hit 104 files.
- Search space = tracked files with a `CODE_EXTS` extension under BASE (pins live in code and tests; markdown, receipts and JSON records are not pins), minus the task's own `Files:` paths (creates ∪ modifies ∪ reads).
- Per symbol: one header line, then up to 8 `  - <path>` lines, then `  … +N more` when capped. Symbols deduped per task; a task with no Produces, or a symbol with zero outside hits, renders nothing.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_check_renders.py` (below the append-zone comment; do not edit anything above it):

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_check_renders.py -q -k "produces_symbols or blast_radius"`
Expected: FAIL — `compile_plan` has no `_produces_symbols`; the render output is missing.

- [ ] **Step 3: Implement the render** — append to `skills/ultrapowers/scripts/compile_plan.py` inside the advisory append zone (after the `# --- advisory renders register below (append zone)` comment, before `def main(`):

```python
# P1 — Produces blast radius (#233 build, #345 eval cell). For every symbol a
# task's Produces declares, the CODE files at BASE outside the task's own
# Files that mention it as a whole word. Keyed on EVERY Produces symbol, not
# only deleted/renamed ones — run-14's additive `runShim` shape change had its
# strict-equality pin in a sibling-owned test file. Advisory: a listed file
# is somewhere the implementer must look (ultraplan Move 3), never a refusal.
_SYMBOL_RE = re.compile(r"^[A-Za-z_]\w*$")
_BLAST_LIST_CAP = 8


def _multiword_symbol(sym):
    """camelCase / snake_case / CONSTANT_CASE — an identifier, not a word."""
    return "_" in sym or any(c.isupper() for c in sym[1:])


def _produces_symbols(task):
    """Symbol tokens the task's Produces lines declare, document order, deduped.
    Every backticked span reduces like _interface_token's lead (cut at the
    first '(', whitespace, or ':'); the lead span is kept at >= 5 chars or
    multi-word, a non-lead span only when multi-word — single common words
    (`main`, `delivered`, `token`) are grep noise, measured (#345)."""
    out = []
    for entry in task["interfaces"]["produces"]:
        for k, span in enumerate(PATH_RE.findall(entry)):
            sym = re.split(r"[(\s:]", span, 1)[0].strip("`").strip()
            if not _SYMBOL_RE.match(sym) or sym.lower() in PLACEHOLDER_TOKENS:
                continue
            if not _multiword_symbol(sym) and (k > 0 or len(sym) < 5):
                continue
            if sym not in out:
                out.append(sym)
    return out


def _render_blast_radius(tasks, ctx):
    lines = []
    for t in tasks:
        own = set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
        for sym in _produces_symbols(t):
            hits = [f for f in _git_word_files(ctx["base"], sym) if f not in own]
            if not hits:
                continue
            lines.append("ADVISORY blast-radius: Task %s Produces `%s` — %d file(s) "
                         "at BASE outside Task %s's Files mention it:"
                         % (t["id"], sym, len(hits), t["id"]))
            lines.extend("  - " + f for f in hits[:_BLAST_LIST_CAP])
            if len(hits) > _BLAST_LIST_CAP:
                lines.append("  … +%d more" % (len(hits) - _BLAST_LIST_CAP))
    return lines


ADVISORY_RENDERS.append(("blast-radius", _render_blast_radius))
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_check_renders.py tests/test_plan_check.py tests/test_flawed_grammar.py -q`
Expected: PASS, including the Task 1 byte-identity pin (canonical fixtures declare no Produces, so P1 prints nothing there).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_check_renders.py
git commit -m "feat(compile_plan): P1 Produces blast-radius advisory render under --check --renders (#345, #233)"
```

---

### Task 3: P2 — referent-existence render

**Type:** implementation
**Depends-on:** 1
**Commutes:** `skills/ultrapowers/scripts/compile_plan.py`, `tests/test_check_renders.py`

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_check_renders.py`
- Test: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- Consumes: `ADVISORY_RENDERS`, `_git_word_files(base, word)`, `_git_literal_in_code(base, literal)`, the `ctx` dict shape (from Task 1); `PATH_RE`, `EXT_RE`, `FENCE`, `_fence_aware_lines`, `PLUGIN_ROOT` (existing); test helpers `git_repo`, `check`, `CANONICAL` (from Task 1).
- Produces: `_path_referent(tok) -> str | None`, `_report_field_vocab() -> set[str]`, `_referent_scan_lines(task) -> list[str]`, `_render_referents(tasks, ctx) -> list[str]`, registered as `("referent", _render_referents)`.

**The rule (P2, #321 item 2 ∪ #237(b) ∪ #237(c)):** resolve every referent a task body names; render each unresolved one once, advisory. Three referent kinds, three resolvers:

1. **Path referents** — a backticked token that contains `/`, or whose extension (via the compiler's `EXT_RE`) is in a fixed file-extension list. Skipped as not-a-repo-path: tokens with glob/template/placeholder characters (`* ? { } < > $ ~`, a space, `(`, `)`, quotes), URLs (`://`), absolute paths (`/…`), module-relative import specifiers (`./…`, `../…`), and MIME types (`text/html`). A `:N-M` line-range suffix and a trailing `/` are stripped first. A path RESOLVES when it is tracked at BASE, is in the task's own `Files:`, is `Create:`d by a task named in this task's `Depends-on:`, is dir-less and matches the basename of any tracked path or of any task's `Files:` path, or appears as a literal inside some tracked CODE file at BASE (a runtime artifact the code names — `fleet-run.json`, `shim.log`). A sibling's `Create:` with no `Depends-on:` edge does NOT resolve — that is the #237(c) dead-letter hand-off.
2. **Field referents** — a backticked dotted token whose head is a report-envelope root (`report`, `result`, `detail`) or a `report-format.md` top-level property (`tasks`, `waveMerges`, `frontier`, `coverage`, `acceptance`, `tests`, `baseline`, `blockedWaves`, `missingDeliverables`, `deferredVerification`), `[]` allowed on any segment. Each segment after the head RESOLVES when it is a name in `report-format.md` (any JSON key in its schema block or any segment of any backticked token in it) OR a whole word in some tracked CODE file at BASE (the fleet `detail.*` contract lives in `fleet/drive.mjs`, not in `report-format.md`). The first unresolved segment is named.
3. **Task references** — `Task <id>` / `Tasks <id>` in the task's fence-stripped prose where `<id>` looks like a task id (contains a digit, or is 1–3 uppercase alphanumerics starting with a letter — `9`, `A3`, `IV`; never `Task agents`, `Task IDs`). RESOLVES when `<id>` is one of the plan's own task headings. Only the first id of a list/range is checked (`Tasks 1–3` checks `1`) — under-reporting is the safe direction.

**Scan surface:** kinds 1 and 2 scan every body line INCLUDING fenced content — run-14's dead referents sat inside a ```markdown fence (text destined for a doc) — minus the fence-marker lines themselves (their backtick runs mis-pair `PATH_RE`), the `Files:` bullets (the contract, checked by the grammar), and the `**Commutes:**` marker. Kind 3 scans fence-stripped prose only (a fenced example plan carries its own task numbering — the repo's own compiler tests embed whole example plans, headings included, inside fences). Dedupe: one line per (task, normalized referent).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_check_renders.py` (below the append-zone comment):

````python
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
````

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_check_renders.py -q -k "referent or path_referent or field_vocab"`
Expected: FAIL — `compile_plan` has no `_path_referent`/`_report_field_vocab`/`_render_referents`.

- [ ] **Step 3: Implement the render** — append to `skills/ultrapowers/scripts/compile_plan.py` inside the advisory append zone (after the `# --- advisory renders register below (append zone)` comment, before `def main(`):

```python
# P2 — referent existence (#321 item 2 ∪ #237(b) ∪ #237(c); #345 eval cell).
# A plan body asserting the existence of something the compiler can check —
# a path against the tree at BASE, a report/detail field against
# report-format.md (or the code that defines it), a `Task N` against the
# plan's own headings — is resolved once; each unresolved referent renders
# once, advisory. Ultraplan authoring rule 6 is the prose half.
_REFERENT_EXTS = frozenset(
    "py js mjs cjs ts tsx jsx md json jsonl sh yml yaml toml txt html css "
    "sql csv lock cfg ini env tgz log".split())
_MIME_RE = re.compile(r"^(text|application|image|audio|video|multipart)/")
_FIELD_HEADS = ("report", "result", "detail", "tasks", "waveMerges", "frontier",
                "coverage", "acceptance", "tests", "baseline", "blockedWaves",
                "missingDeliverables", "deferredVerification")
_FIELD_RE = re.compile(r"^(?:%s)(?:\[\])?(?:\.[A-Za-z_]\w*(?:\[\])?)+$"
                       % "|".join(_FIELD_HEADS))
# `Task <id>` where <id> LOOKS like a task id: contains a digit, or is 1-3
# uppercase alphanumerics led by a letter (`A`, `B3`, `IV`). `Task agents`,
# `Task IDs`, `Task list` never match. Only the first id of a list/range is
# captured — under-reporting is the safe direction for an advisory.
_TASK_REF_RE = re.compile(r"\bTasks?\s+((?=[A-Za-z0-9]*\d)[A-Za-z0-9]+|[A-Z][A-Z0-9]{0,2})\b")
_FILES_BULLET_RE = re.compile(
    r"^\s*[-*+]\s*(Create|Modify|Test|Test fixture\(s\)|Fixture\(s\))\s*:")


def _path_referent(tok):
    """The normalized repo path a backticked token names, or None when the
    token is not a repo-path referent (identifier, dotted field, URL, glob,
    template, placeholder, absolute path, import specifier, MIME type)."""
    t = tok.strip()
    if (not t or any(c in t for c in "*?{}<>$~ ()'\"") or "://" in t
            or t.startswith(("-", "/", "./", "../")) or _MIME_RE.match(t)):
        return None
    t = re.sub(r":\d+(?:-\d+)?$", "", t).rstrip("/")
    if "/" in t:
        return t
    if t.startswith("."):
        return None  # a dotfile name alone is not a referent worth resolving
    m = EXT_RE.search(t)
    if m and m.group(1).lower() in _REFERENT_EXTS:
        return t
    return None


def _report_field_vocab():
    """Every field name report-format.md defines: JSON keys in its schema
    block plus every segment of every backticked dotted token in its text."""
    text = (PLUGIN_ROOT / "skills/ultrapowers/references/report-format.md").read_text()
    names = set(re.findall(r'"([A-Za-z_]\w*)"\s*:', text))
    for tok in re.findall(r"`([A-Za-z_][\w\[\].]*)`", text):
        for seg in tok.split("."):
            seg = seg.replace("[]", "")
            if seg:
                names.add(seg)
    return names


def _referent_scan_lines(task):
    """Body lines whose backticked tokens are referents: EVERY line including
    fenced content (a fenced markdown block names paths just as deadly),
    minus the fence markers themselves (their backtick runs mis-pair
    PATH_RE), the Files: bullets (the contract, grammar-checked), and the
    Commutes marker."""
    out = []
    for line, _fenced in _fence_aware_lines(task["body"]):
        s = line.strip()
        if FENCE.match(s) or _FILES_BULLET_RE.match(line) or s.startswith("**Commutes:**"):
            continue
        out.append(line)
    return out


def _render_referents(tasks, ctx):
    base, tracked, ids = ctx["base"], ctx["tracked"], ctx["task_ids"]
    basenames = {p.rsplit("/", 1)[-1] for p in tracked}
    creates = {t["id"]: set(t["creates"]) for t in tasks}
    all_files = set()
    for t in tasks:
        all_files |= set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
    vocab = _report_field_vocab()
    lines = []
    for t in tasks:
        own = set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
        dep_creates = set()
        for d in t["depends_on"]:
            dep_creates |= creates.get(d, set())
        seen = set()
        for line in _referent_scan_lines(t):
            for tok in PATH_RE.findall(line):
                tok = tok.strip()
                p = _path_referent(tok)
                if p is not None:
                    if p in seen:
                        continue
                    seen.add(p)
                    resolved = (
                        p in tracked or p in own or p in dep_creates
                        or ("/" not in p and (p in basenames
                                              or any(f.endswith("/" + p) for f in all_files)))
                        or _git_literal_in_code(base, p))
                    if not resolved:
                        lines.append("ADVISORY referent: Task %s names `%s` — not at BASE, "
                                     "not in Task %s's Files, not Created by a task it "
                                     "Depends-on" % (t["id"], p, t["id"]))
                    continue
                if _FIELD_RE.match(tok):
                    if tok in seen:
                        continue
                    seen.add(tok)
                    segs = [s.replace("[]", "") for s in tok.split(".")[1:]]
                    missing = [s for s in segs
                               if s not in vocab and not _git_word_files(base, s)]
                    if missing:
                        lines.append("ADVISORY referent: Task %s names `%s` — `%s` is not a "
                                     "report-format.md field and appears in no code file "
                                     "at BASE" % (t["id"], tok, missing[0]))
        for m in _TASK_REF_RE.finditer(t["prose"]):
            ref = m.group(1)
            key = "Task " + ref
            if ref in ids or key in seen:
                continue
            seen.add(key)
            lines.append("ADVISORY referent: Task %s names Task %s — no such task heading "
                         "in this plan" % (t["id"], ref))
    return lines


ADVISORY_RENDERS.append(("referent", _render_referents))
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_check_renders.py tests/test_plan_check.py tests/test_flawed_grammar.py -q`
Expected: PASS, including the Task 1 byte-identity pin — the canonical fixtures' prose names only paths present in their `project/` trees or in their own `Files:`, and no report fields or phantom task ids (measured on `main` at `7dfc4fa` with exactly these heuristics: 0 advisories on all ten fixtures). If a canonical fixture renders an advisory, the heuristic is wrong, not the fixture — fix the heuristic; never edit a fixture.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_check_renders.py
git commit -m "feat(compile_plan): P2 referent-existence advisory render under --check --renders (#345, #237)"
```

---

### Task 4: Campaign script `evals/check_renders_ab.py` + the committed results doc

**Type:** implementation
**Depends-on:** 2, 3
**Review:** adversarial

**Files:**
- Create: `evals/check_renders_ab.py`
- Create: `evals/frontier/results/2026-08-29-check-renders.md`
- Create: `tests/test_check_renders_ab.py`

**Interfaces:**
- Consumes: the CLI contract `compile_plan.py --check <plan> --renders --base <dir>` and the advisory line grammar — `ADVISORY blast-radius: Task <id> Produces …` followed by `  - <path>` / `  … +N more` detail lines (from Task 2); `ADVISORY referent: Task <id> names …` single lines (from Task 3).
- Produces: `evals/check_renders_ab.py` with `corpus() -> list[dict]`, `run_check(plan, base, renders: bool) -> CompletedProcess`, `parse_advisories(stdout: str) -> list[dict]`, `measure(entry: dict) -> dict`, `known_status(rows) -> list[dict]`, `render_doc(rows, known, base_sha) -> str`, `main(argv=None) -> int`, and the pinned `KNOWN_INSTANCES: list[dict]`, `CANONICAL: tuple[str, ...]`, `RENDERS: tuple[str, ...]`, `DOC_SECTIONS: tuple[str, ...]`; the results doc at `evals/frontier/results/2026-08-29-check-renders.md`.

**What the cell measures (from #345):** arm A = `--check`; arm B = `--check --renders`. Corpus = every `evals/fixtures/<name>/plan.md` (BASE = that fixture's `project/`; canonical = wide/chained/mixed/degrade/contend, where zero advisories is the bar) + every `docs/superpowers/plans/2026-08-27-*.md` (BASE = repo root; the run-14 known instances live in `2026-08-27-w2-entry-slate.md`). Per plan: exit code per arm (must match — the frozen contract), whether the verdict line is identical, advisory count per render, bytes and lines arm B adds. Plus: true positives against the pinned known-instance list, false positives on the canonical fixtures, total render size. The script writes the doc; the numbers are the operator's to read — the tests pin the doc's schema, never its values.

**Known instances pinned in the script (the true-positive list):** all three from run-14 (`2026-08-27-w2-entry-slate.md`): (1) P1 — Task 1 Produces `runShim`; the strict-equality pin sits in sibling-owned `fleet/tests/test_drive.mjs` (#233 second occurrence); (2) P2 — Task 4 names `.claude/ultrapowers/fleet-runs-2026-08-26/`, a gitignored evidence dir cited as if committed (#321 item 2); (3) P2 — Task 4 names `detail.creditSpendUsd`, the per-run spend field labeled with a monthly baseline; at BASE the field itself is gone (#343 deleted credit telemetry), so the existence check surfaces it. A needle is a substring expected on some line of an advisory block for that (plan, render, task).

- [ ] **Step 1: Write the failing tests** — create `tests/test_check_renders_ab.py`:

```python
"""evals/check_renders_ab.py (#345): the campaign's OUTPUT SCHEMA is pinned;
its numbers are the operator's to read at integration, never asserted."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals/check_renders_ab.py"
DOC = ROOT / "evals/frontier/results/2026-08-29-check-renders.md"
sys.path.insert(0, str(ROOT / "evals"))
import check_renders_ab as cell  # noqa: E402


def _table_rows(text, heading):
    """Data rows (list of cell lists) of the first markdown table under `heading`."""
    section = text.split(heading, 1)[1].split("\n## ", 1)[0]
    rows = [l for l in section.splitlines() if l.startswith("|")]
    return [[c.strip() for c in r.strip("|").split("|")] for r in rows[2:]]


def test_parse_advisories_groups_blocks():
    out = ("PLAN OK\n\n"
           "ADVISORY blast-radius: Task 1 Produces `runShim` — 2 file(s) at BASE outside Task 1's Files mention it:\n"
           "  - fleet/drive.mjs\n  - fleet/tests/test_drive.mjs\n"
           "ADVISORY referent: Task 4 names `x/y.md` — not at BASE, not in Task 4's Files, not Created by a task it Depends-on\n")
    blocks = cell.parse_advisories(out)
    assert [(b["render"], b["task"], len(b["lines"])) for b in blocks] == [
        ("blast-radius", "1", 3), ("referent", "4", 1)]
    assert cell.parse_advisories("PLAN OK\n") == []


def test_corpus_is_fixtures_plus_0827_plans():
    entries = cell.corpus()
    names = [e["name"] for e in entries]
    for f in cell.CANONICAL:
        assert f in names
    assert "2026-08-27-w2-entry-slate" in names
    assert sum(1 for e in entries if e["canonical"]) == 5
    for e in entries:
        assert e["plan"].exists() and e["base"].is_dir()


def test_restricted_campaign_writes_the_schema(tmp_path):
    out = tmp_path / "cell.md"
    p = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out),
                        "--only", "wide", "--only", "2026-08-27-w2-entry-slate"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    text = out.read_text()
    for heading in cell.DOC_SECTIONS:
        assert heading in text, heading
    corpus_rows = _table_rows(text, "## Corpus")
    assert [r[0] for r in corpus_rows] == ["`wide`", "`2026-08-27-w2-entry-slate`"]
    # exit parity is the frozen contract, not a number: pinned per row
    for r in corpus_rows:
        assert r[2] == r[3], r
    known_rows = _table_rows(text, "## Known instances")
    assert len(known_rows) == len(cell.KNOWN_INSTANCES)
    assert all(r[4] in ("yes", "NO", "not run") for r in known_rows)
    fp_rows = _table_rows(text, "## Canonical false positives")
    assert [r[0] for r in fp_rows] == ["`wide`"]
    assert re.search(r"^- known instances surfaced: \d+/%d$" % len(cell.KNOWN_INSTANCES),
                     text, re.M)
    assert re.search(r"^- canonical false positives: \d+ \(bar: 0\)$", text, re.M)


def test_committed_results_doc_matches_schema():
    assert DOC.exists(), "Task 4 runs the campaign and commits the doc"
    text = DOC.read_text()
    for heading in cell.DOC_SECTIONS:
        assert heading in text, heading
    assert len(_table_rows(text, "## Corpus")) == len(cell.corpus())
    assert len(_table_rows(text, "## Known instances")) == len(cell.KNOWN_INSTANCES)
    assert [r[0] for r in _table_rows(text, "## Canonical false positives")] == \
        ["`%s`" % f for f in cell.CANONICAL]
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_check_renders_ab.py -q`
Expected: FAIL — `check_renders_ab` does not exist.

- [ ] **Step 3: Write `evals/check_renders_ab.py`:**

```python
#!/usr/bin/env python3
"""Eval cell #345 — the two `--check` advisory renders, measured together.

Arm A = `compile_plan.py --check <plan>` (current); arm B = `--check --renders
--base <base>` (P1 Produces blast-radius + P2 referent-existence). Corpus =
every evals/fixtures/<name>/plan.md (BASE = its project/; canonical = wide/
chained/mixed/degrade/contend, where the bar is zero advisories) + every
docs/superpowers/plans/2026-08-27-*.md (BASE = repo root; run-14's known
instances live in the w2-entry-slate plan).

Per plan it records exit code per arm (the frozen contract: must match),
verdict-line identity, advisory counts per render, and the bytes/lines arm B
adds; then true positives against KNOWN_INSTANCES, false positives on the
canonical fixtures, and render size. It WRITES the results doc; it asserts
nothing about the numbers — those are the operator's to read (adoption bar:
every known instance surfaced, zero canonical false positives). Deterministic,
headless, stdlib + git only. Never runs in CI beyond the schema pin in
tests/test_check_renders_ab.py.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
DEFAULT_OUT = ROOT / "evals/frontier/results/2026-08-29-check-renders.md"
CANONICAL = ("wide", "chained", "mixed", "degrade", "contend")
RENDERS = ("blast-radius", "referent")
DOC_SECTIONS = ("## Corpus", "## Known instances", "## Canonical false positives",
                "## Render size", "## Bar (#345)", "## Raw advisories (arm B)")

# The true-positive list: (plan stem, render, task id, needle). A needle is a
# substring expected on SOME line of an advisory block for that plan/render/
# task in arm B's stdout. All three are run-14 (#345's specimens).
KNOWN_INSTANCES = [
    {"plan": "2026-08-27-w2-entry-slate", "render": "blast-radius", "task": "1",
     "needle": "fleet/tests/test_drive.mjs",
     "why": "run-14 task 1: additive `runShim` outcome shape change; the strict-equality "
            "pin lived in sibling-owned test_drive.mjs; cost one redirect round (#233)"},
    {"plan": "2026-08-27-w2-entry-slate", "render": "referent", "task": "4",
     "needle": ".claude/ultrapowers/fleet-runs-2026-08-26",
     "why": "gitignored evidence dir named as if committed (#321 item 2)"},
    {"plan": "2026-08-27-w2-entry-slate", "render": "referent", "task": "4",
     "needle": "detail.creditSpendUsd",
     "why": "per-run spend field labeled with a monthly baseline; the field is gone at "
            "BASE since #343, so the existence check surfaces it"},
]

ADVISORY_RE = re.compile(r"^ADVISORY (blast-radius|referent): Task ([A-Za-z0-9]+) ")


def corpus():
    entries = []
    for plan in sorted((ROOT / "evals/fixtures").glob("*/plan.md")):
        name = plan.parent.name
        entries.append({"name": name, "plan": plan, "base": plan.parent / "project",
                        "canonical": name in CANONICAL})
    for plan in sorted((ROOT / "docs/superpowers/plans").glob("2026-08-27-*.md")):
        entries.append({"name": plan.stem, "plan": plan, "base": ROOT, "canonical": False})
    return entries


def run_check(plan, base, renders):
    cmd = [sys.executable, str(COMPILER), "--check", str(plan)]
    if renders:
        cmd += ["--renders", "--base", str(base)]
    return subprocess.run(cmd, capture_output=True, text=True)


def parse_advisories(stdout):
    """Advisory blocks: a header line + its indented detail lines."""
    blocks = []
    for line in stdout.splitlines():
        m = ADVISORY_RE.match(line)
        if m:
            blocks.append({"render": m.group(1), "task": m.group(2), "lines": [line]})
        elif line.startswith("  ") and blocks:
            blocks[-1]["lines"].append(line)
    return blocks


def measure(entry):
    a = run_check(entry["plan"], entry["base"], False)
    b = run_check(entry["plan"], entry["base"], True)
    blocks = parse_advisories(b.stdout)
    base = entry["base"]
    return {
        "name": entry["name"], "canonical": entry["canonical"],
        "base": "." if base == ROOT else str(base.relative_to(ROOT)),
        "exit_a": a.returncode, "exit_b": b.returncode,
        "verdict_identical": a.stdout.splitlines()[:1] == b.stdout.splitlines()[:1],
        "counts": {r: sum(1 for k in blocks if k["render"] == r) for r in RENDERS},
        "bytes_added": len(b.stdout.encode()) - len(a.stdout.encode()),
        "lines_added": b.stdout.count("\n") - a.stdout.count("\n"),
        "advisories": blocks,
        "stdout_b": b.stdout,
    }


def known_status(rows):
    by_name = {r["name"]: r for r in rows}
    out = []
    for k in KNOWN_INSTANCES:
        row = by_name.get(k["plan"])
        if row is None:
            status = "not run"
        else:
            hit = any(b["render"] == k["render"] and b["task"] == k["task"]
                      and any(k["needle"] in l for l in b["lines"])
                      for b in row["advisories"])
            status = "yes" if hit else "NO"
        out.append({**k, "surfaced": status})
    return out


def render_doc(rows, known, base_sha):
    L = []
    L.append("# Eval cell: two `--check` renders — P1 blast-radius + P2 referent-existence (#345)")
    L.append("")
    L.append("Base: `%s`. Arms: **A** = `compile_plan.py --check <plan>` (current); **B** = "
             "`--check --renders --base <base>` (both renders). Corpus: every "
             "`evals/fixtures/*/plan.md` (BASE = the fixture's `project/`; canonical = %s) + "
             "every `docs/superpowers/plans/2026-08-27-*.md` (BASE = repo root). Produced by "
             "`python3 evals/check_renders_ab.py`; numbers below are read by the operator, "
             "not asserted by any test." % (base_sha, "/".join(CANONICAL)))
    L.append("")
    L.append("## Corpus")
    L.append("")
    L.append("| Plan | Canonical | exit A | exit B | verdict line identical | blast-radius | referent | +bytes | +lines |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        L.append("| `%s` | %s | %d | %d | %s | %d | %d | %d | %d |" % (
            r["name"], "yes" if r["canonical"] else "no", r["exit_a"], r["exit_b"],
            "yes" if r["verdict_identical"] else "NO",
            r["counts"]["blast-radius"], r["counts"]["referent"],
            r["bytes_added"], r["lines_added"]))
    L.append("")
    L.append("## Known instances")
    L.append("")
    L.append("| Plan | Render | Task | Needle | Surfaced | Why |")
    L.append("|---|---|---|---|---|---|")
    for k in known:
        L.append("| `%s` | %s | %s | `%s` | %s | %s |" % (
            k["plan"], k["render"], k["task"], k["needle"], k["surfaced"], k["why"]))
    L.append("")
    L.append("## Canonical false positives")
    L.append("")
    L.append("| Fixture | blast-radius | referent |")
    L.append("|---|---|---|")
    canon = [r for r in rows if r["canonical"]]
    for r in canon:
        L.append("| `%s` | %d | %d |" % (r["name"], r["counts"]["blast-radius"],
                                        r["counts"]["referent"]))
    L.append("")
    L.append("## Render size")
    L.append("")
    total_b = sum(r["bytes_added"] for r in rows)
    total_l = sum(r["lines_added"] for r in rows)
    L.append("- arm B adds %d bytes / %d lines across %d plan(s) (mean %.1f bytes, %.1f lines per plan)."
             % (total_b, total_l, len(rows),
                total_b / len(rows) if rows else 0.0, total_l / len(rows) if rows else 0.0))
    for name in RENDERS:
        L.append("- %s: %d advisory block(s) in total." % (
            name, sum(r["counts"][name] for r in rows)))
    L.append("")
    L.append("## Bar (#345)")
    L.append("")
    surfaced = sum(1 for k in known if k["surfaced"] == "yes")
    fp = sum(r["counts"]["blast-radius"] + r["counts"]["referent"] for r in canon)
    parity = [r["name"] for r in rows if r["exit_a"] != r["exit_b"] or not r["verdict_identical"]]
    L.append("- known instances surfaced: %d/%d" % (surfaced, len(known)))
    L.append("- canonical false positives: %d (bar: 0)" % fp)
    L.append("- exit-code / verdict-line parity: %s" % (
        "all rows equal" if not parity else "MISMATCH on " + ", ".join(parity)))
    L.append("")
    L.append("## Raw advisories (arm B)")
    L.append("")
    for r in rows:
        L.append("### `%s`" % r["name"])
        L.append("")
        L.append("```text")
        adv = [l for b in r["advisories"] for l in b["lines"]]
        L.extend(adv if adv else ["(none)"])
        L.append("```")
        L.append("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", action="append", default=[],
                    help="restrict the corpus to these names (repeatable)")
    args = ap.parse_args(argv)
    entries = corpus()
    if args.only:
        entries = [e for e in entries if e["name"] in args.only]
    rows = [measure(e) for e in entries]
    known = known_status(rows)
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip() or "unknown"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_doc(rows, known, sha) + "\n")
    print(json.dumps({
        "out": str(args.out), "plans": len(rows),
        "known_surfaced": sum(1 for k in known if k["surfaced"] == "yes"),
        "known_total": len(known),
        "canonical_false_positives": sum(
            r["counts"]["blast-radius"] + r["counts"]["referent"]
            for r in rows if r["canonical"]),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the campaign and commit its output.** From the repo root:

Run: `python3 evals/check_renders_ab.py`
Expected: prints one JSON line naming `evals/frontier/results/2026-08-29-check-renders.md`, `plans` = the corpus size (10 fixtures + 5 plans on `main` at `7dfc4fa`), and the two headline counts. Do NOT edit the doc by hand and do NOT tune a heuristic to change its numbers — the numbers are the measurement. If `known_surfaced` < `known_total` or `canonical_false_positives` > 0, leave it so: the operator adjudicates at integration.

- [ ] **Step 5: Run the tests**

Run: `python3 -m pytest tests/test_check_renders_ab.py tests/test_check_renders.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add evals/check_renders_ab.py evals/frontier/results/2026-08-29-check-renders.md tests/test_check_renders_ab.py
git commit -m "eval: #345 cell — check_renders_ab.py campaign over fixtures + 2026-08-27 plans; results doc committed"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- none

- [ ] **Step 1: Full gate**

Run: `python3 -m pytest`
Expected: PASS — baseline 1159 on `main` at `7dfc4fa` plus the new `tests/test_check_renders.py` and `tests/test_check_renders_ab.py`; `tests/test_all_plans_compile.py`, `tests/test_plan_check.py`, `tests/test_flawed_grammar.py` all still green.

- [ ] **Step 2: This plan still checks clean under both arms**

Run: `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-08-29-check-renders-eval-cell.md && python3 skills/ultrapowers/scripts/compile_plan.py --check --renders docs/superpowers/plans/2026-08-29-check-renders-eval-cell.md`
Expected: both exit 0 with `PLAN OK` as the first line.

---

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check --renders docs/superpowers/plans/2026-08-27-w2-entry-slate.md`
  see: `PLAN OK`, a blank line, then `ADVISORY blast-radius: Task 1 Produces \`runShim\` …` listing `fleet/tests/test_drive.mjs`, and `ADVISORY referent: Task 4 names …` lines for `.claude/ultrapowers/fleet-runs-2026-08-26` and `detail.creditSpendUsd`; the command exits 0.
- do: the same command WITHOUT `--renders`.
  see: exactly one line, `PLAN OK` — nothing else, no trailing blank line.
- do: open `evals/frontier/results/2026-08-29-check-renders.md` and read `## Bar (#345)`.
  see: `known instances surfaced: N/3` and `canonical false positives: F (bar: 0)` — the two numbers the adoption verdict is made from; `## Raw advisories (arm B)` shows every line each plan would print, so the render's feel (noise vs signal) is judged from real output, not from the counts.
- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check --renders --base /tmp evals/fixtures/wide/plan.md`
  see: `PLAN OK`, a blank line, then `advisory renders skipped: /tmp is not a git checkout` — the renders never guess a tree.

## Execution handoff

`4 implementation tasks, widest wave 2 (P1 ∥ P2 against the Task 1 contract), risk = true (edits the frozen-vocabulary `--check` surface and its exit path; correctness of the eval instrument is hard to see by reading) → Ultrapowers (recommended).`

1. **Ultrapowers (recommended)** — `/ultrapowers docs/superpowers/plans/2026-08-29-check-renders-eval-cell.md`: parallel waves, worktree isolation, per-task review (adversarial on Tasks 1 and 4), one pre-merge gate where the operator reads the results doc's `## Bar` section.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution.
