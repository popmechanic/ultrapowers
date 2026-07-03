# Plan Grammar `--check` Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow the plan grammar and validate it loudly at authoring time (`compile_plan.py --check`), then delete the runtime tolerance branches — executing issue #85 with the 2026-07-03 field bugs as regression pins.

**Architecture:** Grammar narrowing lands inside `compile_plan.py` in three layers (interface placeholders, Files strictness, the catch-all construct), then a `--check` CLI mode surfaces every violation with did-you-mean diagnostics; plain compile fails loudly on the same violations (the checker is the parser's front door, not a separate linter). Docs and fixtures update to the canonical grammar.

**Tech Stack:** Python 3 (pytest), markdown reference docs with anti-drift pin tests.

**Spec:** `docs/superpowers/specs/2026-07-03-plan-grammar-check-design.md`

**Acceptance:** suite — ultrapowers engine/skill development; the committed pytest suite, the drift pins, and per-task adversarial review are the verification. This is the FINAL plan of a two-plan effort (after `2026-07-03-authored-review-depth.md`): its integration-spanning coverage is the `--check` validation of the `**Review:**` marker that the earlier plan introduced, exercised on a plan carrying all markers together.

## Global Constraints

- This plan assumes the authored-review-depth plan is already merged: `**Review:**` parses with values `adversarial`/`lean` and launch tasks carry a `review` slot. Do not re-implement any of it.
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere.
- `plugin.json` and `marketplace.json` stay untouched.
- `harnesses/*.js` is NOT touched by this plan (no `.mjs` sim obligations).
- The full check suite is `python3 -m pytest` from the repo root; every test green before any commit.
- Fixture seals hash the fixture's `acceptance/` directory only (`tests/test_fixture_seals.py`); editing a fixture's `plan.md` does not break a seal. Never modify any `acceptance/` suite content.
- `references/plan-markers.md` is the canonical contract; `skills/ultraplan/SKILL.md` mirrors its BAKE blocks (pinned by `tests/test_ultraplan_skill.py`). Edit both together, preserve pin semantics.

---

### Task 1: Interface placeholders parse as empty; symbol-list validation

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing
- Produces: `_interface_token(entry)` returns `""` for the placeholder set (`nothing`, `none`, `n/a`, `na` — bare or with trailing prose), so placeholder Consumes/Produces lines can never pair into an interface edge; a module-level `PLACEHOLDER_TOKENS` frozenset other layers reuse; a helper `_symbol_list_violations(entries)` returning a list of human-readable violations for non-placeholder, non-symbol interface values (used by the later `--check` task)

**Parallelization rationale:** contract root — the placeholder set and the violations helper are the vocabulary the `--check` mode consumes; this layer is pure parsing with no CLI surface.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_compile_plan.py`, reusing its existing plan-builder/compile helpers (the style of `test_interface_edge_requires_exact_token_match`, ~line 1827):

```python
PLACEHOLDER_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Cleanup

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `data/fixtures.json`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (test-data-only change)

- [ ] **Step 1: do it**

### Task 2: Leaf A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing (standalone)
- Produces: `helper_a() -> str`

- [ ] **Step 1: do it**

### Task 3: Leaf B

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/b.py`

**Interfaces:**
- Consumes: none
- Produces: `helper_b() -> str`

- [ ] **Step 1: do it**
"""


def test_placeholder_interfaces_produce_zero_edges(tmp_path):
    # 2026-07-03 foreign-run regression: 'Produces: nothing' paired with
    # 'Consumes: nothing' created two spurious edges and a wasted wave.
    result = compile_result(tmp_path, PLACEHOLDER_PLAN)  # existing helper
    interface_edges = [e for e in result["edges"] if e.get("why") == "interface"]
    assert interface_edges == []


def test_placeholder_interfaces_emit_no_undeclared_dependency(tmp_path):
    result = compile_result(tmp_path, PLACEHOLDER_PLAN)
    assert not [c for c in result.get("marker_conflicts", [])
                if "undeclared-dependency" in str(c)]


def test_all_three_tasks_share_wave_one(tmp_path):
    result = compile_result(tmp_path, PLACEHOLDER_PLAN)
    assert sorted(result["waves"][0]) == ["1", "2", "3"]


def test_placeholder_token_set():
    from compile_plan import _interface_token
    for raw in ("nothing", "none", "N/A", "nothing (test-data-only change)",
                "`nothing`", "none — standalone"):
        assert _interface_token(raw) == "", raw
    assert _interface_token("`User` dataclass (id: int)") == "User"
    assert _interface_token("validate_payload(payload) -> list[str]") == "validate_payload"


def test_symbol_list_violations_flags_sentences():
    from compile_plan import _symbol_list_violations
    bad = _symbol_list_violations(
        ["the launch file gains a review key that the engine consumes later"])
    assert len(bad) == 1 and "symbol" in bad[0].lower()
    assert _symbol_list_violations(["`User`", "validate_payload(p) -> list"]) == []
    assert _symbol_list_violations(["nothing (placeholder)"]) == []
```

Run: `python3 -m pytest tests/test_compile_plan.py -k "placeholder or symbol_list" -v`
Expected: FAIL — `_interface_token("nothing")` returns `"nothing"` today; `_symbol_list_violations` does not exist.

- [ ] **Step 2: Implement**

In `skills/ultrapowers/scripts/compile_plan.py`:

(a) Above `_interface_token` (~line 635) add:

```python
# Placeholder interface values — 'Consumes: nothing (…)' is authoring prose
# for "no contract", never a producible symbol. Tokenizing them to "" deletes
# the placeholder-pairing edge class at the representation (2026-07-03
# foreign run: 'nothing' paired 'nothing' → spurious edges → a wasted wave).
PLACEHOLDER_TOKENS = frozenset({"nothing", "none", "n/a", "na"})
```

(b) In `_interface_token`, after computing the token, normalize placeholders to empty:

```python
def _interface_token(entry):
    s = entry.strip().strip("`").strip()
    if not s:
        return ""
    token = re.split(r"[(\s:]", s, 1)[0].strip("`").strip()
    return "" if token.lower() in PLACEHOLDER_TOKENS else token
```

(c) Add the violations helper next to it:

```python
# A symbol list is backticked or bare identifier tokens (optionally with a
# signature tail), comma-separated. Sentences are authoring mistakes that
# the interface matcher would silently mis-tokenize — surface them.
_SYMBOL_OK = re.compile(r"^`?[A-Za-z_][\w.\-]*`?(\s*\(.*)?(\s*->.*)?$")


def _symbol_list_violations(entries):
    out = []
    for entry in entries:
        s = entry.strip()
        if not s or _interface_token(s) == "":
            continue  # empty or placeholder — fine
        parts = [p.strip() for p in s.split(",")]
        if not all(_SYMBOL_OK.match(p) for p in parts if p):
            out.append(
                "interface value is not a symbol list (backticked or bare "
                "identifiers, comma-separated): %r" % s)
    return out
```

Note the interface-edge builder (~lines 831–884) already skips empty tokens — verify it does; if it pairs on `""`, guard it (`if not token: continue`).

- [ ] **Step 3: Run the new tests, then the whole suite**

Run: `python3 -m pytest tests/test_compile_plan.py -k "placeholder or symbol_list" -v` → PASS.
Run: `python3 -m pytest` → green. The flawed-fixture interface tests (`test_flawed_fixture_interface_edge_orders_task4_after_task1`, ~line 1811) pin a REAL symbol (`User`) and must stay green untouched. If any existing test pinned the old placeholder-pairing behavior, that pin is the bug this task deletes — rewrite it to assert zero edges, citing issue #85.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "fix(compiler): interface placeholders tokenize to empty; symbol-list validation helper (#85)"
```

### Task 2: Files strictness — annotations, unknown labels, globs

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: `PLACEHOLDER_TOKENS` / the violations-helper pattern from the placeholder task (same file — write-after-write ordering)
- Produces: `_files_violations(task)` returning did-you-mean diagnostics for annotated Files lines, unknown labels, and globs; an annotated Files line contributes NOTHING silently — it is always a violation with the extracted-path fix shown

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_compile_plan.py`:

```python
ANNOTATED_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Shared file owner

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/lib/db.js` (only the pool init, lines 12-40)

- [ ] **Step 1: do it**

### Task 2: Other writer

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/lib/db.js`

- [ ] **Step 1: do it**
"""


def test_annotated_files_line_is_a_violation_with_extract_fix():
    from compile_plan import _files_violations
    v = _files_violations({"id": "1", "files_raw": [
        ("Modify", "`src/lib/db.js` (only the pool init, lines 12-40)")]})
    assert len(v) == 1
    assert "src/lib/db.js" in v[0]          # the extracted path is shown
    assert "annotation" in v[0].lower()      # named for what it is


def test_unknown_label_is_a_violation_with_did_you_mean():
    from compile_plan import _files_violations
    v = _files_violations({"id": "3", "files_raw": [("Delete", "`old/x.py`")]})
    assert len(v) == 1 and "Modify" in v[0]


def test_glob_is_a_violation():
    from compile_plan import _files_violations
    v = _files_violations({"id": "4", "files_raw": [("Modify", "`src/**/*.py`")]})
    assert len(v) == 1 and "enumerate" in v[0].lower()


def test_annotated_line_fails_plain_compile_loudly(tmp_path):
    # front-door behavior: plain compile on a violating plan is a loud error,
    # not a silent overlap drop (2026-07-03 foreign run: the two most
    # contended files silently lost overlap coverage).
    with pytest.raises(SystemExit) as exc:
        compile_result(tmp_path, ANNOTATED_PLAN)
    assert "src/lib/db.js" in str(exc.value)
```

Adapt the `_files_violations` input shape in these tests to whatever the implementation exposes — the contract under test is: (annotated line → one violation naming the path and the word "annotation"), (unknown label → suggests a canonical label), (glob → says enumerate), (plain compile on violation → `SystemExit` naming the path). If exposing a `files_raw` intermediate is unnatural in the current parse flow, have `_files_violations(task_dict)` re-derive from the task's recorded near-misses instead — the four behavioral pins above are the requirement, not the internal shape.

Run: `python3 -m pytest tests/test_compile_plan.py -k "annotated or unknown_label or glob_is" -v`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `compile_plan.py`, building on the existing near-miss machinery (`files_near_miss` collection at ~lines 392–404, glob collection at ~446–450):

(a) Add the canonical-label constant and the violations builder:

```python
CANONICAL_FILE_LABELS = ("Create", "Modify", "Test")
_LABEL_SUGGEST = {"delete": "Modify", "remove": "Modify", "read": "Test",
                  "create-or-modify": "Modify", "add": "Create"}
_PATH_IN_LINE = re.compile(r"`([^`]+)`")


def _files_violations(task):
    """Grammar violations for one task's Files block, each with a
    did-you-mean fix. Empty list == the block is canonical."""
    out = []
    for label, rest in task.get("files_raw", []):
        path_m = _PATH_IN_LINE.search(rest)
        path = path_m.group(1) if path_m else rest.strip()
        if label not in CANONICAL_FILE_LABELS:
            suggest = _LABEL_SUGGEST.get(label.lower(), "Create/Modify/Test")
            out.append("Task %s: unknown Files label %r for `%s` — use %s"
                       % (task.get("id"), label, path, suggest))
            continue
        if any(ch in path for ch in "*?[") :
            out.append("Task %s: glob `%s` — enumerate the paths"
                       % (task.get("id"), path))
            continue
        tail = rest.replace("`%s`" % path, "", 1).strip()
        if tail:
            out.append("Task %s: Files line has a trailing annotation.\n"
                       "  got:  - %s: %s\n"
                       "  fix:  - %s: `%s`   (move the note into the task prose)"
                       % (task.get("id"), label, rest, label, path))
    return out
```

(b) Record the raw `(label, rest)` pairs during `parse_task`'s Files handling (~lines 303–446) into `task["files_raw"]`, including lines currently routed to `files_near_miss` for unknown labels — capture, don't drop.

(c) In `main()`, after parsing all tasks and before edge building, collect `_files_violations` + `_symbol_list_violations` (from the interfaces of each task) across tasks; if any exist, print every diagnostic and `raise SystemExit` with the joined text (plain compile is now loud). Delete the silent-drop behavior: an annotated line must never reach overlap inference partially nor vanish.

(d) Keep `FILE_LINE`'s accepted labels as-is for now (`Test fixture(s)`/`Fixture(s)` remain canonical aliases only if existing fixtures/tests use them — check `grep -r "Test fixture" evals/ tests/`; if used, add them to `CANONICAL_FILE_LABELS`, if unused anywhere, drop them from `FILE_LINE` and note the deletion in the commit message).

(e) The canonical empty-Files form `- none` (gate tasks' house style, feeding the empty-writes gate classification) stays legal — it must produce zero violations. It is already not captured as a labeled pair; make sure the violation collection never flags it, and leave the existing gate-classification path untouched.

- [ ] **Step 3: Run the new tests, then the whole suite; reconcile displaced pins**

Run: `python3 -m pytest tests/test_compile_plan.py -k "annotated or unknown_label or glob_is" -v` → PASS.
Run: `python3 -m pytest` → tests that previously pinned TOLERANT behavior (e.g. `test_glob_paths_are_ambiguous` ~line 203, unknown-label near-miss pins ~line 392 region, `test_missing_files_block_is_conservatively_serialized` if it feeds violating grammar) will fail — rewrite each to pin the NEW loud behavior with the same scenario, citing #85 in the docstring. Fixture-driven tests must stay green (fixtures are canonicalized in the fixtures task; if one of them violates and reds a test HERE, coordinate via the plan order — this task must only rewrite unit-level pins, never fixture files).

If a sealed fixture's `plan.md` violates the new grammar and breaks compile-level tests in THIS task's suite run, stop and re-read the task ordering: the fixtures task depends on this one and will canonicalize them; for this task's commit, it is acceptable for the suite to be green only because no existing fixture violates. Verify with: `python3 -m pytest tests/test_compile_plan.py tests/test_fixture_seals.py -v` — if a fixture DOES violate, mark this task BLOCKED and report it rather than editing fixture files out of scope.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): strict Files grammar — annotations, unknown labels, globs are loud violations (#85)"
```

### Task 3: The catch-all construct — declared open write sets force serial placement

**Type:** implementation
**Depends-on:** 2
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: `_files_violations` and the strict-Files parse from the Files-strictness task (same file — write-after-write ordering)
- Produces: a Files bullet of the exact form `- catch-all: <prose>` parses as `task["catch_all"] = <prose>`; a catch-all task conflicts with every other implementation task for scheduling (never shares a wave); more than one catch-all bullet per task is a violation

- [ ] **Step 1: Write the failing tests**

```python
CATCHALL_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Independent A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Re-pointer sweep

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `docs/manual.md`
- catch-all: any doc-pinning test the full suite shows red — reconcile each pin preserving its semantics

- [ ] **Step 1: do it**

### Task 3: Independent B

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""


def test_catch_all_parses_and_is_not_a_violation(tmp_path):
    result = compile_result(tmp_path, CATCHALL_PLAN)
    assert result is not None  # compiles loudly-clean


def test_catch_all_task_never_shares_a_wave(tmp_path):
    # 2026-07-03 home-run regression: a catch-all task was safe only because
    # it happened to ride the serial tail; now it is serial by construction.
    result = compile_result(tmp_path, CATCHALL_PLAN)
    for wave in result["waves"]:
        if "2" in wave:
            assert wave == ["2"]


def test_second_catch_all_bullet_is_a_violation(tmp_path):
    doubled = CATCHALL_PLAN.replace(
        "- catch-all: any doc-pinning test",
        "- catch-all: one thing\n- catch-all: any doc-pinning test")
    with pytest.raises(SystemExit) as exc:
        compile_result(tmp_path, doubled)
    assert "catch-all" in str(exc.value)


def test_catch_all_conflict_edges_are_labeled(tmp_path):
    result = compile_result(tmp_path, CATCHALL_PLAN)
    assert any(e.get("why") == "catch-all" for e in result["edges"])
```

Run: `python3 -m pytest tests/test_compile_plan.py -k catch_all -v`
Expected: FAIL — today the `- catch-all:` line is an unknown-label violation (Task 2's strictness).

- [ ] **Step 2: Implement**

(a) In the Files-block parse, recognize the bullet before the strict-label path:

```python
CATCH_ALL_LINE = re.compile(r"^-\s*catch-all:\s*(.+)$", re.I)
```

First `CATCH_ALL_LINE` match in a task's Files block → `task["catch_all"] = m.group(1).strip()`; a second match → violation `"Task %s: more than one catch-all bullet — a task declares at most one open write set"`.

(b) In `build_edges` (~line 713), after the existing file-overlap tier: for every task with `catch_all`, order every other implementation task not already ordered relative to it BEFORE the catch-all task (the open write set integrates last; where an edge already exists in either direction, respect it), each added edge carrying `why: "catch-all"`. The net effect asserted by the tests: the catch-all task occupies a wave alone.

(c) Surface the catch-all in the emitted launch task dict as `"catchAll": <prose>` so the engine's implementer prompt shows the declared open scope (the field is additive; `waves.js` ignores unknown fields today — do NOT edit `waves.js` in this plan).

- [ ] **Step 3: Run tests, then the whole suite**

Run: `python3 -m pytest tests/test_compile_plan.py -k catch_all -v` → PASS.
Run: `python3 -m pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): catch-all Files construct — declared open write set forces serial placement (#85)"
```

### Task 4: The `--check` CLI mode

**Type:** implementation
**Depends-on:** 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Create: `tests/test_plan_check.py`

**Interfaces:**
- Consumes: `_files_violations`, `_symbol_list_violations`, the catch-all rules, and the marker validations (`Type`/`Depends-on`/`Review`) from the three grammar-layer tasks (same file — write-after-write ordering)
- Produces: `compile_plan.py --check <plan.md>` — exit 0 + `PLAN OK` on a canonical plan; exit 2 with every violation (did-you-mean diagnostics, one block per violation) on a non-canonical plan; `--check` is mutually exclusive with `--emit-launch`/`--emit-args`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_plan_check.py`:

```python
"""--check: authoring-time grammar validation (issue #85).
Runs compile_plan.py as a subprocess — --check is an operator-facing CLI
contract, so the exit codes and stdout shape are the pinned surface."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path("skills/ultrapowers/scripts/compile_plan.py")

CANONICAL = """# P

**Acceptance:** suite — test

### Task 1: A

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing
- Produces: `helper() -> str`

- [ ] **Step 1: do it**

### Task 2: Gate

**Type:** gate
**Depends-on:** 1

**Files:**
- none

- [ ] **Step 1: run the suite**
"""

VIOLATING = CANONICAL.replace(
    "- Modify: `src/a.py`",
    "- Modify: `src/a.py` (only the top half)\n- Delete: `old/b.py`")


def run_check(tmp_path, text):
    plan = tmp_path / "plan.md"
    plan.write_text(text)
    return subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                          capture_output=True, text=True)


def test_check_passes_a_canonical_plan(tmp_path):
    # includes a gate task with the canonical empty-Files form `- none`,
    # which must never count as a violation
    proc = run_check(tmp_path, CANONICAL)
    assert proc.returncode == 0
    assert "PLAN OK" in proc.stdout


def test_check_reports_every_violation_with_fixes(tmp_path):
    proc = run_check(tmp_path, VIOLATING)
    assert proc.returncode == 2
    out = proc.stdout + proc.stderr
    assert "annotation" in out.lower()      # the annotated Modify line
    assert "unknown files label" in out.lower()  # the Delete: line
    assert "src/a.py" in out                # extracted path shown as the fix


def test_check_validates_review_marker_values(tmp_path):
    bad = CANONICAL.replace("**Review:** adversarial", "**Review:** paranoid")
    proc = run_check(tmp_path, bad)
    assert proc.returncode == 2
    assert "adversarial" in (proc.stdout + proc.stderr)


def test_check_is_exclusive_with_emit(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(CANONICAL)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", str(plan),
         "--emit-launch", str(tmp_path / "launch.json")],
        capture_output=True, text=True)
    assert proc.returncode != 0
```

Run: `python3 -m pytest tests/test_plan_check.py -v`
Expected: FAIL — unknown flag `--check`.

- [ ] **Step 2: Implement**

In `compile_plan.py` `main()` (~lines 1034–1054):

(a) Add `--check` to the parser: `p.add_argument("--check", action="store_true", help="validate the plan grammar and exit (0 = canonical, 2 = violations)")`, and reject the `--check` + `--emit-*` combination the same way `--emit-args`-without-`--emit-launch` is rejected today.

(b) Route the mode: parse the plan collecting ALL violations (files, symbol-list, catch-all, marker values — for markers, catch the `SystemExit`s the parse raises and convert each into a violation entry rather than dying on the first; the simplest shape is a `collect_violations(plan_path)` function that runs the same parse in a collecting mode). Print each violation separated by blank lines; end with either `PLAN OK` (exit 0) or `N violation(s)` (exit 2).

(c) Plain compile keeps its Task-2 behavior (loud `SystemExit` on the first violation set) — `--check` is the mode that guarantees ALL violations in one pass.

- [ ] **Step 3: Run tests, then the whole suite**

Run: `python3 -m pytest tests/test_plan_check.py -v` → PASS.
Run: `python3 -m pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_plan_check.py
git commit -m "feat(compiler): --check mode — every grammar violation with did-you-mean fixes, exit-code authority (#85)"
```

### Task 5: Fixture canonicalization + violation corpus

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `evals/fixtures/wide/plan.md`
- Modify: `evals/fixtures/chained/plan.md`
- Modify: `evals/fixtures/mixed/plan.md`
- Modify: `evals/fixtures/degrade/plan.md`
- Modify: `evals/fixtures/flawed/plan.md`
- Create: `tests/test_flawed_grammar.py`

**Interfaces:**
- Consumes: the `--check` CLI contract (exit 0/2, `PLAN OK`, did-you-mean text) from the CLI task
- Produces: every non-flawed fixture plan passes `--check`; the flawed fixture carries a `grammar/` violation corpus exercised by `tests/test_flawed_grammar.py`

- [ ] **Step 1: Canonicalize the shipping fixtures (failing check first)**

Run `--check` against each fixture plan:

```bash
for f in wide chained mixed degrade flawed; do
  python3 skills/ultrapowers/scripts/compile_plan.py --check "evals/fixtures/$f/plan.md" || echo "VIOLATES: $f"
done
```

For every violation reported in `wide`/`chained`/`mixed`/`degrade`, apply exactly the did-you-mean fix (move annotations to prose, canonical labels, enumerate globs, placeholder forms) — semantic content must not change: after each edit re-run the fixture's compile-shape tests in `tests/test_compile_plan.py` and confirm identical waves/edges (except edges the placeholder fix legitimately deletes — if one appears, quote it in the commit message). Do NOT touch any `acceptance/` directory; `python3 -m pytest tests/test_fixture_seals.py -v` must stay green throughout (seals hash `acceptance/` only).

`flawed/plan.md` keeps its deliberate undeclared-dependency defect (that is its job) but is canonicalized for pure GRAMMAR violations if it has any — the flaw it exists to pin is semantic, not grammatical.

- [ ] **Step 2: Write the violation corpus + its test**

Create five one-task plan files under `evals/fixtures/flawed/grammar/` — each is this exact minimal plan with ONE line swapped. The base (this is `annotated-files.md` verbatim):

```markdown
# Grammar violation fixture

**Acceptance:** suite — test fixture

### Task 1: A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py` (only the top half)

**Interfaces:**
- Consumes: nothing
- Produces: `helper() -> str`

- [ ] **Step 1: do it**
```

The other four replace the `- Modify:` line (and only it) with:

- `prose-placeholder.md` — keep `- Modify: `src/a.py`` clean, but replace the Produces line with `- Produces: the module gains a helper the next task calls later`
- `glob.md` — `- Modify: `src/**/*.py``
- `unknown-label.md` — `- Delete: `old/b.py``
- `double-catch-all.md` — keep the clean Modify line and add two bullets after it: `- catch-all: pin sweep one` and `- catch-all: pin sweep two`

Create `tests/test_flawed_grammar.py`:

```python
"""The flawed fixture's grammar corpus: each file carries exactly one
violation class and --check must name it (issue #85 field bugs)."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path("skills/ultrapowers/scripts/compile_plan.py")
CORPUS = Path("evals/fixtures/flawed/grammar")

EXPECT = {
    "annotated-files.md": "annotation",
    "prose-placeholder.md": "symbol",
    "glob.md": "enumerate",
    "unknown-label.md": "unknown files label",
    "double-catch-all.md": "catch-all",
}


def test_every_corpus_file_fails_check_with_its_named_violation():
    for name, needle in EXPECT.items():
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--check", str(CORPUS / name)],
            capture_output=True, text=True)
        out = (proc.stdout + proc.stderr).lower()
        assert proc.returncode == 2, name
        assert needle in out, (name, out)


def test_shipping_fixture_plans_are_canonical():
    for fixture in ("wide", "chained", "mixed", "degrade"):
        plan = Path("evals/fixtures") / fixture / "plan.md"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--check", str(plan)],
            capture_output=True, text=True)
        assert proc.returncode == 0, (fixture, proc.stdout, proc.stderr)
```

Run: `python3 -m pytest tests/test_flawed_grammar.py -v` → PASS.

- [ ] **Step 3: Full suite, then commit**

Run: `python3 -m pytest` → green (fixture seals, compile-shape tests, the new corpus).

```bash
git add evals/fixtures tests/test_flawed_grammar.py
git commit -m "test(fixtures): canonical grammar across shipping fixtures; flawed gains the violation corpus (#85)"
```

### Task 6: Document the canonical grammar + ultraplan `--check` step

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

**Interfaces:**
- Consumes: the `--check` CLI contract (invocation, exit codes) from the CLI task
- Produces: plan-markers.md documents the full canonical grammar (Files labels, placeholder forms, the catch-all bullet, symbol-list rule); ultraplan's authoring rules end with the mandatory `--check` step

- [ ] **Step 1: Document the grammar in the canonical contract**

In `skills/ultrapowers/references/plan-markers.md`, extend the Files/authoring sections (~lines 100–173) with the narrowed grammar, one rule per bullet: canonical labels `Create`/`Modify`/`Test`; one backticked path per bullet, no trailing annotation (notes live in task prose); no globs; interface placeholder forms (`nothing`, `none`, `n/a`) parse as empty; interface values are symbol lists; at most one `- catch-all: <prose>` bullet per task, which forces serial placement. Keep additions OUTSIDE the existing BAKE blocks unless a block already covers the topic — if a BAKE block changes, mirror it into `skills/ultraplan/SKILL.md` verbatim (the pin normalizes formatting, not words).

- [ ] **Step 2: Make `--check` the final authoring step in ultraplan**

In `skills/ultraplan/SKILL.md`, at the end of the authoring-rules section, add:

```markdown
## The final authoring step — validate

A marked plan is not done until it passes the grammar check:

    python3 skills/ultrapowers/scripts/compile_plan.py --check <plan.md>

Exit 0 (`PLAN OK`) — hand the plan off. Any violation prints a did-you-mean
fix; apply it and re-run. The runtime parser accepts exactly this grammar and
rejects the rest loudly, so a plan that skips the check fails at compile time
instead — at launch, when a fix costs a session instead of seconds.
```

- [ ] **Step 3: Run the pins, then the suite**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_marker_contract.py tests/test_sibling_by_role_rule.py -v` → PASS (reconcile mirror pins if a BAKE block changed — same words both sides).
Run: `python3 -m pytest` → green.
Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` → OK.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "docs(ultraplan): canonical grammar documented; --check is the final authoring step (#85)"
```

### Task 7: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:**
- none

- [ ] **Step 1: Run the full gate**

```bash
python3 -m pytest
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan
python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-07-03-plan-grammar-check.md
python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-07-03-authored-review-depth.md
python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json
```

Expected: pytest fully green; validators OK; **both of this cycle's own plans pass `--check`** (the self-application pin — this plan and the review-depth plan are written in the canonical grammar, including the `**Review:**` markers the earlier plan shipped); the ratchet reports `compileFlags` 3 (was 2) offset by the deleted tolerance branches — if any gate-spec metric moved, the baseline was regenerated in the task that moved it.
