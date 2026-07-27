# Field-Hardening Remainder (#91) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land issue #91's four remaining adopted items: the ultralearn tilde-path fix, disposition-scoped Files-grammar enforcement in the plan compiler, the resume-gate deferredVerification union rule, and the shipped-SHA re-verification rule.

**Architecture:** Four independent fixes on disjoint files. One `expanduser()` call with a tilde test; one ordering refactor in the compiler (classify dispositions before the Files gate, then enforce Files grammar only on `implementation` tasks, in both the compile path and `--check`); two prose rules in the engine skill docs.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-field-hardening-remainder.md`

**Acceptance:** suite — the committed pytest suite is the verification; driver/skill-doc surfaces, not the frozen verification periphery. No seal requested.

## Global Constraints

- **Files grammar stays fully loud for `implementation` tasks** — an unknown label, annotation, glob, or double catch-all on an implementation task must fail the compile path and `--check` exactly as before; only non-waved dispositions (gate/manual/release) are exempted.
- **Marker validation, heading checks, and duplicate-id checks stay universal** — the disposition scoping applies to Files grammar only.
- **Scope is issue #91 items 2, 3, 5, 6 ONLY** — item 1 belongs to #96, item 4 touches the frozen seal-author brief (`skills/ultraplan/references/seal-author-prompt.md` must not be modified), item 7 plans with #96.
- **No changes outside** `skills/ultralearn/scripts/merge_ledger.py`, `tests/test_merge_ledger.py`, `skills/ultrapowers/scripts/compile_plan.py`, `tests/test_compile_plan.py`, `tests/test_plan_check.py`, `skills/ultrapowers/SKILL.md`, and `skills/ultrapowers/references/finishing-notes.md`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: `bundle_lookups` expands the user path

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Test: `tests/test_merge_ledger.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `bundle_lookups(cache_dir)` accepts `~`-prefixed paths (unchanged signature and return shape).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_merge_ledger.py` (the module is imported as `m`; `json` is imported):

```python
def test_bundle_lookups_expands_tilde(tmp_path, monkeypatch):
    # The skill doc's own example call passes ~/.claude/ultralearn; an
    # unexpanded tilde made every bundle read fail closed to 'foreign' and
    # silently dropped the engine-version stamp (#91 item 2).
    monkeypatch.setenv("HOME", str(tmp_path))
    bundle_dir = tmp_path / ".claude/ultralearn/runs/r9"
    bundle_dir.mkdir(parents=True)
    (bundle_dir / "bundle.json").write_text(json.dumps(
        {"origin": "home", "engineVersion": {"epoch": "0.1.12"}}))
    origin, engine = m.bundle_lookups("~/.claude/ultralearn")
    assert origin("r9") == "home"
    assert engine("r9") == "0.1.12"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_merge_ledger.py::test_bundle_lookups_expands_tilde -v`
Expected: FAIL — `origin("r9")` returns `"foreign"` (the tilde path never resolves, the read throws, and the lookup fails closed).

- [ ] **Step 3: Expand the path**

In `skills/ultralearn/scripts/merge_ledger.py`, in `bundle_lookups`, replace:

```python
    cache_dir = Path(cache_dir)
```

with:

```python
    cache_dir = Path(cache_dir).expanduser()
```

- [ ] **Step 4: Run the test file to verify green**

Run: `python3 -m pytest tests/test_merge_ledger.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/merge_ledger.py tests/test_merge_ledger.py
git commit -m "fix: bundle_lookups expands ~ so home bundles are not misclassified foreign (#91)"
```

---

### Task 2: Disposition-scoped Files-grammar enforcement

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`
- Test: `tests/test_plan_check.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: compile path and `collect_violations` skip `_files_violations` for tasks whose disposition is not `implementation`; task dicts carry `t["disposition"]`/`t["heuristic"]` stamped before the Files gate.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_plan_check.py` (reuse `CANONICAL`, `run_check`):

```python
def test_check_ignores_files_grammar_on_gate_tasks(tmp_path):
    # A gate task's Files block never enters overlap inference; its
    # placeholder values must not warn (#91 item 3).
    plan = CANONICAL.replace("**Files:**\n- none",
                             "**Files:**\n- Verify: `(none)`")
    proc = run_check(tmp_path, plan)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "PLAN OK" in proc.stdout


def test_check_still_flags_files_grammar_on_implementation_tasks(tmp_path):
    plan = CANONICAL.replace("- Modify: `src/a.py`", "- Tweak: `src/a.py`")
    proc = run_check(tmp_path, plan)
    assert proc.returncode == 2
    assert "unknown files label" in (proc.stdout + proc.stderr).lower()
```

Append to `tests/test_compile_plan.py` (reuse `compile_plan`, `compile_plan_raw`):

```python
def test_gate_task_files_noise_does_not_block_compile(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: Gate\n\n**Type:** gate\n**Depends-on:** 1\n\n"
        "**Files:**\n- Verify: `(none)`\n\n- [ ] **Step 1: run the suite**\n")
    out = compile_plan(plan)
    assert out["waves"] == [["1"]]


def test_implementation_files_noise_still_blocks_compile(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Tweak: `a.py`\n\n- [ ] **Step 1: do**\n")
    p = compile_plan_raw(plan)
    assert p.returncode != 0
    assert "unknown files label" in (p.stdout + p.stderr).lower()
```

- [ ] **Step 2: Run them to verify the two gate-task cases fail**

Run: `python3 -m pytest tests/test_plan_check.py tests/test_compile_plan.py -k "gate_task or ignores_files or still_flags or noise" -v`
Expected: `test_check_ignores_files_grammar_on_gate_tasks` and `test_gate_task_files_noise_does_not_block_compile` FAIL (the unknown label on the gate task blocks today); the two implementation-task cases PASS already (they pin the guard's real job).

- [ ] **Step 3: Classify before the Files gate in the compile path**

In `skills/ultrapowers/scripts/compile_plan.py`, in `main`, replace:

```python
    files_violations = [v for t in tasks for v in _files_violations(t)]
```

with:

```python
    # Dispositions resolve BEFORE the Files gate (#91): Files grammar feeds
    # overlap inference, which only implementation tasks enter — a
    # gate/manual/release task's placeholder Files text is structurally
    # inert and must neither block compile nor warn.
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"], t["heuristic"] = disp, heuristic

    files_violations = [v for t in tasks
                        if t["disposition"] == "implementation"
                        for v in _files_violations(t)]
```

and replace the now-redundant classification in the output loop:

```python
    out_tasks = []
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"] = disp
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"],
                          "interfaces": t["interfaces"]})
```

with:

```python
    out_tasks = []
    for t in tasks:
        out_tasks.append({"id": t["id"], "title": t["title"],
                          "disposition": t["disposition"],
                          "heuristic": t["heuristic"], "writes": t["writes"],
                          "depends_on": t["depends_on"],
                          "interfaces": t["interfaces"]})
```

- [ ] **Step 4: Scope `collect_violations` the same way**

In `collect_violations`, replace:

```python
    for t in tasks:
        violations.extend(_files_violations(t))
    return violations
```

with:

```python
    # Files grammar is disposition-scoped (#91): only implementation tasks
    # enter overlap inference, so only their Files blocks are checked.
    for t in tasks:
        if classify(t)[0] != "implementation":
            continue
        violations.extend(_files_violations(t))
    return violations
```

- [ ] **Step 5: Run the compiler test files to green**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_plan_check.py -v`
Expected: ALL PASS — the four new tests and every pre-existing case (existing fixtures put canonical Files on implementation tasks, whose enforcement is unchanged).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py tests/test_plan_check.py
git commit -m "fix: Files grammar enforcement scopes to waved dispositions (#91)"
```

---

### Task 3: Resume-gate deferredVerification union rule

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on (operator-facing prose).

- [ ] **Step 1: Add the union rule to Step 5**

In `skills/ultrapowers/SKILL.md` Step 5, insert a new paragraph immediately BEFORE the line starting `Render the report per` :

```markdown
**Resume gates carry the union.** A Salvage/Redirect relaunch produces a fresh
report, so at any gate reached via relaunch, present the **union** of
`deferredVerification` items across every gate report this integration branch
has produced — carry prior items forward yourself; an item leaves the ack list
only by explicit operator disposition, never as a relaunch side effect.
```

- [ ] **Step 2: Verify and commit**

Run: `grep -c "Resume gates carry the union" skills/ultrapowers/SKILL.md`
Expected: `1`

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "docs: resume gates present the union of deferredVerification across relaunches (#91)"
```

---

### Task 4: Shipped-SHA re-verification rule

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/finishing-notes.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on (orchestrator-read prose).

- [ ] **Step 1: Append the new section**

At the end of `skills/ultrapowers/references/finishing-notes.md`, append:

```markdown
## Shipped SHA ≠ gate-verified SHA — re-verify, mandatorily

The gate's verdict attaches to one exact tree. If the SHA being shipped
differs from the SHA the gate verified — any rebase, squash, or history
rebuild after the gate — re-run the full committed suite AND the plan's
acceptance per its disposition (the sealed exam for `sealed` plans, the
suite gate for `suite`) on the rebuilt tree before opening the PR. This is
mandatory, not judgment: a rebuild can absorb real base drift, and the old
verdict says nothing about the new tree ([15f51ca2]).

A rebase-only repo defeats the recommend-squash guidance above — the
history rebuild is the expected path there, so this re-verification is the
norm in such repos, not the exception.
```

- [ ] **Step 2: Verify and commit**

Run: `grep -c "re-verify, mandatorily" skills/ultrapowers/references/finishing-notes.md`
Expected: `1`

```bash
git add skills/ultrapowers/references/finishing-notes.md
git commit -m "docs: shipped SHA differing from gate-verified SHA mandates full re-verification (#91)"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

- [ ] **Step 1: Run the full committed suite**

Run: `python3 -m pytest`
Expected: all tests pass, no skips introduced by this plan.
