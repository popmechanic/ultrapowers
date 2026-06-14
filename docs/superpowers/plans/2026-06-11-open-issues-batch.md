# Open-Issues Batch (#8–#18) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — engine fixes; verified by the committed test suite, not a held-out exam.

**Goal:** Fix ten open GitHub issues (#8–#16, #18) across workflow.js, compile_plan.py, sweep_worktrees.sh, and the docs; close #17 won't-fix; ship 0.6.0.

**Architecture:** Four file-collision lanes serialized internally by Depends-on markers, parallel with each other: workflow.js (Tasks 1→2→3), compile_plan.py (4→5→6), sweep_worktrees.sh (7→8), docs (9, 10). Every behavior change is TDD'd against `tests/sim_workflow.mjs` (workflow logic) or pytest (compiler, sweep). Spec: `docs/superpowers/specs/2026-06-11-open-issues-batch-design.md`.

**Tech Stack:** Node (sim harness, no deps), Python 3 + pytest, bash, git worktrees.

**Suite commands (used throughout):** `python3 -m pytest tests/ -q` and `node tests/sim_workflow.mjs`. Both must pass before every commit.

---

### Task 1: workflow.js — fail loud on duplicate task ids (#9)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Test: `tests/sim_workflow.mjs`

- [ ] **Step 1: Write the failing sim scenario**

Add to `tests/sim_workflow.mjs` (alongside the other `async function scenario...` definitions; it uses the existing `runWorkflow`, `makeAgent`, and `assert` helpers):

```js
// ── Scenario: duplicate task ids across waves refuse to launch ────────────────
async function scenarioDuplicateTaskId() {
  const waves = [
    [{ id: 'A', title: 'one', body: 'b1' }],
    [{ id: 'A', title: 'two', body: 'b2' }],
  ]
  let threw = null
  try {
    await runWorkflow({ agent: makeAgent(), args: { waves, integrationBranch: 'ib', stamp: 's' }, budget: undefined })
  } catch (e) { threw = e }
  assert(threw && /duplicate task id "A"/.test(String(threw.message)),
    'dupId: launch must throw naming the duplicated id (got ' + String(threw && threw.message) + ')')
  console.log('scenario duplicate-task-id: OK')
}
```

Register it in the scenario runner at the bottom of the file, with the other `await scenarioXxx()` calls:

```js
await scenarioDuplicateTaskId()
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: `SIM ASSERT FAILED: dupId: launch must throw` (the run currently proceeds — no validation).

- [ ] **Step 3: Implement the validation**

In `skills/ultrapowers/workflow.js`, immediately after the `if (!validWaves) { throw ... }` block (currently ends ~line 53), add:

```js
// Duplicate ids would corrupt blockedByDep and report keying (tasks[],
// waveMerges.branches). compile_plan.py hard-errors on duplicates at the plan
// level; hand-authored waves must meet the same bar — refuse to run.
{
  const seenIds = new Set()
  for (const w of WAVES) for (const t of w) {
    if (seenIds.has(t.id)) {
      throw new Error('ultrapowers: duplicate task id "' + t.id + '" across waves — task ids ' +
        'must be unique (compile_plan.py enforces this at the plan level; hand-authored ' +
        'waves must too). Refusing to run.')
    }
    seenIds.add(t.id)
  }
}
```

- [ ] **Step 4: Run the suites**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: all scenarios OK (including `scenario duplicate-task-id: OK`), pytest green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs
git commit -m "fix: refuse to launch on duplicate task ids across waves (#9)"
```

---

### Task 2: workflow.js — budget exhaustion defers merge/reconcile/integration instead of dispatching them (#8)

**Type:** implementation
**Depends-on:** 1, 9

(Why these edges: 1 shares workflow.js and the sim file with this task; 9 rewrites `skills/ultrapowers/references/report-format.md`, which this task also edits.)

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/sim_workflow.mjs`

- [ ] **Step 1: Write two failing sim scenarios**

Add to `tests/sim_workflow.mjs`:

```js
// ── Scenario: budget dies mid-wave — no merge/reconcile/integration dispatch ──
async function scenarioBudgetDiesMidWave() {
  let implsDone = 0
  const labels = []
  const agent = makeAgent((label) => {
    labels.push(label)
    if (label.startsWith('impl:')) implsDone++
    return undefined // fall through to default stub behavior
  })
  // Both wave-1 tasks dispatch (checks at wave/chunk top pass), then the
  // budget reads 0 before the wave-1 merge.
  const budget = { total: 100, remaining: () => (implsDone >= 2 ? 0 : 50) }
  const r = await runWorkflow({ agent, args: baseArgs, budget })
  assert(!labels.some((l) => l.startsWith('merge:')), 'budgetMidWave: no merge dispatched')
  assert(!labels.some((l) => l.startsWith('reconcile:')), 'budgetMidWave: no reconcile dispatched')
  assert(!labels.includes('integration'), 'budgetMidWave: no integration review dispatched')
  assert(r.waveMerges.length === 1 && r.waveMerges[0].status === 'DEFERRED',
    'budgetMidWave: wave-1 merge recorded as DEFERRED (got ' + JSON.stringify(r.waveMerges) + ')')
  eq(r.blockedWaves, [], 'budgetMidWave: budget deferral is not a blocked wave')
  assert(r.unfinished.some((u) => /^C: deferred \(budget exhausted/.test(u)),
    'budgetMidWave: wave-2 task deferred with a budget reason')
  assert(r.judgmentCalls.some((j) => /budget exhausted/.test(j)), 'budgetMidWave: cause in judgmentCalls')
  assert(/budget exhausted/.test(r.tests.output), 'budgetMidWave: integration skip attributed to budget')
  eq(r.tests.passed, false, 'budgetMidWave: tests cannot read as passed')
  console.log('scenario budget-dies-mid-wave: OK')
}

// ── Scenario: budget dies after a CONFLICT merge — reconcile not dispatched ───
async function scenarioBudgetDiesBeforeReconcile() {
  let merged = false
  const labels = []
  const agent = makeAgent((label) => {
    labels.push(label)
    if (label.startsWith('merge:')) { merged = true; return { status: 'CONFLICT', detail: 'overlap' } }
    return undefined
  })
  const budget = { total: 100, remaining: () => (merged ? 0 : 50) }
  const r = await runWorkflow({ agent, args: baseArgs, budget })
  assert(!labels.some((l) => l.startsWith('reconcile:')), 'budgetReconcile: no reconcile dispatched')
  assert(r.waveMerges[0].status === 'DEFERRED',
    'budgetReconcile: DEFERRED, not CONFLICT (got ' + JSON.stringify(r.waveMerges[0]) + ')')
  eq(r.blockedWaves, [], 'budgetReconcile: not recorded as a merge failure')
  assert(r.unfinished.some((u) => /^C: deferred \(budget exhausted/.test(u)),
    'budgetReconcile: later tasks deferred, not cascade-blocked')
  assert(!r.unfinished.some((u) => /cascade-blocked/.test(u)), 'budgetReconcile: no cascade-block wording')
  console.log('scenario budget-dies-before-reconcile: OK')
}
```

Register both in the runner at the bottom:

```js
await scenarioBudgetDiesMidWave()
await scenarioBudgetDiesBeforeReconcile()
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — currently a merge IS dispatched in scenario 1, and scenario 2 records CONFLICT + cascade-block after two reconcile dispatches.

- [ ] **Step 3: Implement the three missing checks**

All in `skills/ultrapowers/workflow.js`.

**(a) Inside `mergeWave()`** — at the top of the reconciliation `for` loop body (before the `log(...)` line):

```js
  for (let attempt = 1; merge.status !== 'MERGED' && attempt <= 2; attempt++) {
    if (budgetExhausted()) {
      return { status: 'DEFERRED', detail: 'budget exhausted before reconciliation attempt ' +
        attempt + ' (last merge status: ' + merge.status + ') — task branches intact, not merged' }
    }
    log('wave ' + (waveIdx + 1) + ' reconciliation attempt ' + attempt + ': ' + merge.status)
    ...
```

Note: `mergeWave` is defined before `budgetExhausted` in source, but both live in the same async body and `mergeWave` only runs after setup — the reference is safe (same pattern the wave loop already relies on).

**(b) Before the merge dispatch** — immediately before `const merge = await mergeWave(results, w)`:

```js
  if (budgetExhausted()) {
    waveMerges.push({
      wave: w + 1,
      status: 'DEFERRED',
      detail: 'budget exhausted before wave merge — task branches exist unmerged; rerun or redirect after raising the budget',
      branches: mergeable.map((r) => r.task),
    })
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
    }
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted before wave ' + (w + 1) + ' merge)'))
    }
    log('wave ' + (w + 1) + ' merge deferred: budget exhausted')
    break
  }
```

**(c) After the merge dispatch** — the existing `waveMerges.push({...})` record stays as is (it records `DEFERRED` faithfully); between it and the `if (merge.status === 'MERGED' && !merge.headSha)` check, insert:

```js
  if (merge.status === 'DEFERRED') {
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
    }
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted during wave ' + (w + 1) + ' merge)'))
    }
    log('wave ' + (w + 1) + ' merge deferred mid-reconciliation: budget exhausted')
    break
  }
```

(`DEFERRED` breaks before the `merge.status !== 'MERGED'` branch, so it can never reach `blockedWaves` or the cascade-block loop.)

**(d) Before the integration review** — replace the current `let review` + `try` block opening with:

```js
let review
if (budgetExhausted()) {
  judgmentCalls.push('integration review deferred: budget exhausted — verify the suite manually before merging')
  log('integration review deferred: budget exhausted')
  review = { command: undefined, testsPassed: false,
             output: 'not run — budget exhausted before integration review',
             findings: ['integration review deferred: budget exhausted — verify the suite manually before merging'] }
} else {
  try {
    review = await agent(
      ...existing dispatch unchanged...
    )
  } catch (e) {
    ...existing catch unchanged...
  }
}
```

- [ ] **Step 4: Run the suites**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: all green, including both new scenarios. The pre-existing `exhausted budget defers every wave` scenario must still pass.

- [ ] **Step 5: Document the DEFERRED status**

In `skills/ultrapowers/references/report-format.md`, find where `waveMerges` statuses are described (search for `MERGED`/`SKIPPED` in the waveMerges section) and add:

```markdown
- `DEFERRED` — budget exhausted before or during this wave's merge; the wave's task
  branches exist unmerged, and later waves were deferred to `unfinished` (not
  cascade-blocked). Rerun or redirect after raising the budget — this is a budget
  outcome, never a merge failure.
```

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/workflow.js skills/ultrapowers/references/report-format.md tests/sim_workflow.mjs
git commit -m "fix: budget exhaustion defers merge/reconcile/integration instead of dispatching them (#8)"
```

---

### Task 3: workflow.js — code-quality nits: dead call and merged validation loops (#18)

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Test: `tests/sim_workflow.mjs` (no new scenarios — the whole existing suite is the regression net)

- [ ] **Step 1: Remove the dead wave-level `noteFailures()`**

In the wave loop, the chunk `for` loop ends with a `noteFailures()` call (after the lost-coordinates sweep), and is immediately followed by ANOTHER `noteFailures()` right before the `// When every task in the wave is dep-blocked...` comment. Delete that second, wave-level call — the per-chunk loop already ran it after the last chunk. Do NOT touch the `noteFailures()` at the top of the wave or inside the chunk loop.

- [ ] **Step 2: Merge the two tierOverrides validation loops**

Replace both loops (the `for (const k of Object.keys(tierOverrides))` key check and the `for (const k in tierOverrides)` value check) with one:

```js
for (const k of Object.keys(tierOverrides)) {
  if (k !== 'cheap' && k !== 'standard' && k !== 'mostCapable') {
    throw new Error('ultrapowers: tierOverrides key "' + k +
      '" is not a tier (valid: cheap, standard, mostCapable). Refusing to launch.')
  }
  if (VALID_MODELS.indexOf(tierOverrides[k]) === -1) {
    throw new Error(
      'ultrapowers: tierOverrides.' + k + ' = "' + tierOverrides[k] +
      '" is not a valid model alias (valid: haiku, sonnet, opus). Refusing to launch.'
    )
  }
}
```

(Behavior note: error precedence per key is now key-then-value, but a bad key and a bad value never coexist on the same valid key, and existing sim assertions match on message content, not ordering.)

The 4-line cascade-loop duplication is intentionally KEPT (rule of three — see issue #18 item 2). Do not extract it.

- [ ] **Step 3: Run the suites**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: everything green — this task changes no behavior.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/workflow.js
git commit -m "refactor: drop dead post-loop noteFailures, merge tierOverrides validation loops (#18)"
```

---

### Task 4: compile_plan.py — cycle errors print one concrete edge path with why labels (#10)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Test: `tests/test_compile_plan.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_compile_plan.py` (it already imports `subprocess`, `sys`, `pathlib` and defines `ROOT`/`COMPILER`; the `compile_plan()` helper asserts rc==0, so run the subprocess directly here):

```python
def test_cycle_error_names_one_concrete_edge_path(tmp_path):
    plan = tmp_path / "cycle.md"
    plan.write_text(
        "### Task 1: a\n\n**Depends-on:** 2\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Depends-on:** 1\n\n**Files:**\n- Modify: `b.py`\n"
    )
    p = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                       capture_output=True, text=True)
    assert p.returncode == 1
    assert "cycle detected among tasks 1, 2" in p.stderr
    # One concrete path, each hop labeled with the edge's why:
    assert "One cycle:" in p.stderr
    assert "-> 2 (marker)" in p.stderr
    assert "-> 1 (marker)" in p.stderr
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_compile_plan.py::test_cycle_error_names_one_concrete_edge_path -v`
Expected: FAIL — stderr today carries only the member list.

- [ ] **Step 3: Implement the cycle path finder**

In `skills/ultrapowers/scripts/compile_plan.py`, add above `layer()`:

```python
def find_cycle(members, edges):
    """One concrete cycle among `members` as an edge list, or None.
    Iterative DFS over the recorded edges restricted to the unplaced members —
    small by construction (only the Kahn leftovers), so no perf concern."""
    mset = set(members)
    succ = {}
    for e in edges:
        if e["from"] in mset and e["to"] in mset:
            succ.setdefault(e["from"], []).append(e)
    for start in members:
        stack = [(start, [])]
        while stack:
            node, path = stack.pop()
            for e in succ.get(node, []):
                if e["to"] == start:
                    return path + [e]
                if all(p["to"] != e["to"] for p in path):
                    stack.append((e["to"], path + [e]))
    return None
```

`layer()` currently takes `(impl, edges)` and prints the member-only message. Extend the failure branch:

```python
    if len(done) != len(order):
        members = [i for i in order if i not in done]
        cyc = find_cycle(members, edges)
        hint = ""
        if cyc:
            hint = (" One cycle: " + cyc[0]["from"] + " -> "
                    + " -> ".join(f"{e['to']} ({e['why']})" for e in cyc)
                    + " — break the weakest labeled constraint.")
        print(f"compile_plan: cycle detected among tasks {', '.join(members)} — "
              "revise the plan to break it; refusing to guess an ordering." + hint,
              file=sys.stderr)
        raise SystemExit(1)
```

The existing message text (prefix included) stays byte-identical — only the hint sentence is appended, so any pre-existing cycle test keeps matching.

- [ ] **Step 4: Run the test and the full suite**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: PASS, including any pre-existing cycle test (the original message is a prefix of the new one).

- [ ] **Step 5: Update the doc**

In `skills/ultrapowers/references/dependency-analysis.md`, the cycle-handling list item that quotes the error (`compile_plan: cycle detected among tasks A, B — revise the plan...`) gains: "The compiler also prints one concrete cycle with each hop's why label (`One cycle: A -> B (write-after-write) -> A (marker)`) so the author knows exactly which constraint to break."

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/references/dependency-analysis.md tests/test_compile_plan.py
git commit -m "feat: cycle errors print one concrete edge path with why labels (#10)"
```

---

### Task 5: compile_plan.py — plural text-dependency lists parse into edges (#11)

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Test: `tests/test_compile_plan.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_compile_plan.py`:

```python
def test_plural_text_dependency_parses_each_listed_id(tmp_path):
    plan = tmp_path / "plural-parse.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `b.py`\n\n"
        "- [ ] **Step 1:** This depends on Tasks 1 and 3 being merged first.\n\n"
        "### Task 3: c\n\n**Files:**\n- Modify: `c.py`\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "text"} in out["dag_edges"]
    assert {"from": "3", "to": "2", "why": "text"} in out["dag_edges"]
    # Parsed lists no longer surface the plural conflict:
    assert not any("plural" in c["note"].lower() for c in out["marker_conflicts"])


def test_plural_text_dependency_comma_list(tmp_path):
    plan = tmp_path / "plural-comma.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `b.py`\n\n"
        "### Task 3: c\n\n**Files:**\n- Modify: `c.py`\n\n"
        "Runs after Tasks 1, 2 and a final review.\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "3", "why": "text"} in out["dag_edges"]
    assert {"from": "2", "to": "3", "why": "text"} in out["dag_edges"]


def test_unparseable_plural_still_surfaces(tmp_path):
    plan = tmp_path / "plural-vague.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:**\n- Modify: `a.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `b.py`\n\n"
        "Runs after Tasks (the parser ones) are merged.\n"
        # "(": not an id token, so TEXT_DEP_LIST cannot match — a bare word like
        # "above" WOULD match as a ghost id and surface via the ghost-drop
        # conflict instead, which is also loud, just differently worded.
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert any(c["task"] == "2" and "plural" in c["note"].lower()
               for c in out["marker_conflicts"])
```

- [ ] **Step 2: Run to verify the first two fail**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k plural`
Expected: the two new parse tests FAIL (no text edges today); the existing `test_plural_tasks_text_dependency_surfaces` still passes for now.

- [ ] **Step 3: Implement list parsing**

In `compile_plan.py`, next to `TEXT_DEP`, add:

```python
# Plural conjunction/comma lists ("depends on Tasks 1 and 3", "after Tasks
# 1, 2 and 3") parse into one text edge per listed id. A `Tasks` mention the
# list regex cannot parse (e.g. "after Tasks above") still surfaces as a
# conflict so ordering intent is never silently lost.
TEXT_DEP_LIST = re.compile(
    r"(?:depends\s+on|after|requires)[\s:*]+Tasks\s+"
    r"((?:[A-Za-z0-9]+)(?:\s*(?:,|and|&)\s*[A-Za-z0-9]+)*)", re.I)
LIST_SPLIT = re.compile(r"\s*(?:,|\band\b|&)\s*", re.I)
```

In `build_edges()`, in the Tier-1 text-edge loop, after the existing `TEXT_DEP.finditer` block, add a second pass over `TEXT_DEP_LIST.finditer(b["prose"])`:

```python
        for m in TEXT_DEP_LIST.finditer(b["prose"]):
            for ref in LIST_SPLIT.split(m.group(1)):
                ref = ref.strip()
                if not ref or ref == b["id"]:
                    continue
                if ref in ids:
                    add(ref, b["id"], "text")
                else:
                    add_conflict(
                        b["id"], ref + " -> " + b["id"] + " (text)",
                        "text dependency names a task outside the implementation set "
                        "(unknown id or gate/release/manual) — edge dropped")
```

Note `test_plural_tasks_text_dependency_comma_list`'s trailing prose ("and a final review"): `[A-Za-z0-9]+` matches `a` as a token — `a` is not in `ids`, so it surfaces as a dropped-ghost conflict rather than an edge. That is acceptable conservatism; do not special-case it.

In `main()`, change the plural surface conflict to fire only when the plural mention did NOT parse into a list:

```python
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "plural text dependency ('depends on/after/requires Tasks …') could "
                 "not be parsed into task ids — encode each prerequisite as a "
                 "**Depends-on:** marker"}
        for t in tasks
        if TEXT_DEP_PLURAL.search(t["prose"]) and not TEXT_DEP_LIST.search(t["prose"])]
```

Update the stale comment above `TEXT_DEP_PLURAL` (it currently says plural prose is NOT parsed).

- [ ] **Step 4: Update the now-obsolete existing test**

`tests/test_compile_plan.py::test_plural_tasks_text_dependency_surfaces` (≈line 1036) asserts the old surface-only behavior — its fixture uses the dependency keyword followed by `Tasks 1 and 3`, which now parses. Rewrite that test to assert the new behavior (edges present, no plural conflict) or delete it in favor of `test_plural_text_dependency_parses_each_listed_id` — prefer deletion, the new test covers it.

- [ ] **Step 5: Run the suites**

Run: `python3 -m pytest tests/ -q && node tests/sim_workflow.mjs`
Expected: green.

- [ ] **Step 6: Update the doc**

In `skills/ultrapowers/references/dependency-analysis.md`, rule 4 (explicit text dependency) currently scopes the match to the singular `Task <id>`. Extend it: plural conjunction/comma lists — the dependency keywords followed by `Tasks 1 and 3` or `Tasks 1, 2 and 3` — parse into one edge per listed id; plural mentions that don't form a parseable id list still surface as conflicts. Task titles and phase-level prose remain unmatched.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/references/dependency-analysis.md tests/test_compile_plan.py
git commit -m "feat: plural text-dependency lists parse into edges (#11)"
```

---

### Task 6: compile_plan.py — inline **Files:** header values parse (#12)

**Type:** implementation
**Depends-on:** 5

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_inline_files_header_backticked_paths_parse(tmp_path):
    plan = tmp_path / "inline-files.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:** `x.py` and `y.py`\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `z.py`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["x.py", "y.py"]
    # Disjoint concrete paths -> no ambiguous-files serialization, one wave:
    assert not any(e["why"] == "ambiguous-files" for e in out["dag_edges"])
    assert out["waves"] == [["1", "2"]]


def test_inline_files_header_prose_value_surfaces(tmp_path):
    plan = tmp_path / "inline-prose.md"
    plan.write_text(
        "### Task 1: a\n\n**Files:** see the bullets in the spec\n\n"
        "### Task 2: b\n\n**Files:**\n- Modify: `z.py`\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == []          # falls to ambiguous-files as before
    assert any(c["task"] == "1" and "inline" in c["note"].lower()
               for c in out["marker_conflicts"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k inline_files`
Expected: FAIL — today the inline value is dropped entirely (task 1 ambiguous, fully serialized) and no conflict is surfaced.

- [ ] **Step 3: Implement**

In `parse_task()`, the `**Files:**` opener currently reads:

```python
        if s.startswith("**Files:**"):
            in_files = True
            files_entries_seen = False
            continue
```

Replace with:

```python
        if s.startswith("**Files:**"):
            in_files = True
            files_entries_seen = False
            # Inline header values: `**Files:** \`a.py\` \`b.py\`` carries the
            # paths on the header line itself. Backticked paths are honored as
            # writes (conservative: inline form does not distinguish
            # Create/Modify/Test, and a write is the safe assumption). A
            # non-backticked remainder surfaces a conflict instead of silently
            # falling to ambiguous-files with no pointer.
            rest = s[len("**Files:**"):].strip()
            if rest:
                inline = [p.split(":")[0] for p in PATH_RE.findall(rest) if p]
                if inline:
                    modifies.extend(inline)
                    files_entries_seen = True
                else:
                    files_near_miss.append(
                        s + "  <inline Files value has no backticked paths — "
                        "backtick each path or use - Create/Modify/Test bullets>")
            continue
```

(`files_near_miss` already feeds a surfaced conflict note in `main()` — no new conflict plumbing needed. The note's wording contains "inline", matching the test.)

- [ ] **Step 4: Run the suites**

Run: `python3 -m pytest tests/ -q`
Expected: green — in particular the existing Files-block tests (bullet form, blank-line handling, checkbox closing) must be untouched.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat: parse backticked paths from inline **Files:** header values (#12)"
```

---

### Task 7: sweep_worktrees.sh — derive ROOT from the worktree list, not dirname(common-dir) (#13)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Test: `tests/test_sweep_worktrees.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_sweep_worktrees.py` (uses the existing `git`, `make_repo`, `add_engine_worktree`, `branches` helpers):

```python
def test_sweep_root_survives_separate_git_dir(tmp_path):
    # --separate-git-dir puts the git dir OUTSIDE the repo: dirname(common-dir)
    # resolves to the git dir's parent, and the old derivation died with
    # "fatal: not a git repository".
    repo = tmp_path / "repo"
    repo.mkdir()
    gitdir = tmp_path / "gitdir"
    subprocess.run(["git", "init", "-b", "main", "--separate-git-dir", str(gitdir),
                    str(repo)], check=True, capture_output=True)
    git(repo, "config", "user.email", "sweep@test")
    git(repo, "config", "user.name", "sweep test")
    (repo / "a.txt").write_text("a\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "init")
    wt, br = add_engine_worktree(repo, "sep", "s.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt.exists()
    assert branches(repo) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_sweep_worktrees.py::test_sweep_root_survives_separate_git_dir -v`
Expected: FAIL — exit 128 / "fatal: not a git repository" in stderr.

- [ ] **Step 3: Implement**

In `sweep_worktrees.sh`, replace:

```bash
GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT="$(dirname "$GIT_COMMON")"
```

with:

```bash
# The MAIN worktree is the first entry of `git worktree list --porcelain`.
# dirname(--git-common-dir) breaks when the git dir sits outside the repo
# (--separate-git-dir) or under a superproject's .git (submodules) — the
# latter would aim branch -d at the WRONG repository.
ROOT="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
```

- [ ] **Step 4: Run the sweep suite**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -q`
Expected: all green, including every pre-existing scenario (standard layout, from-inside-a-worktree, stale dirs).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py
git commit -m "fix: derive sweep ROOT from git worktree list — survives separate-git-dir and submodules (#13)"
```

---

### Task 8: sweep_worktrees.sh — locked worktrees are kept by default (#14)

**Type:** implementation
**Depends-on:** 7, 9, 2

(Why these edges: 7 shares the sweep script and its test file; 9 and 2 rewrite the same SKILL.md / report-format.md sentences this task edits.)

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/test_sweep_worktrees.py`

- [ ] **Step 1: Update the existing test and add the force variant**

`test_sweep_survives_stale_dir_and_locked_worktree` currently asserts `not wt_locked.exists()`. Change that assertion block to the new contract and add a force test:

```python
    # (in test_sweep_survives_stale_dir_and_locked_worktree, replacing the
    #  three existence assertions)
    assert not stale.exists()
    assert wt_locked.exists()                       # locked => kept by default
    assert "kept (locked" in p.stdout
    assert not wt_real.exists()
    assert "swept:" in p.stdout          # the summary line printed — no mid-sweep abort


def test_sweep_force_removes_locked_worktree(tmp_path):
    repo = make_repo(tmp_path)
    wt_locked, br = add_engine_worktree(repo, "locked-f", "lf.txt", merge=True)
    git(repo, "worktree", "lock", str(wt_locked))

    p = subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_locked.exists()
    assert branches(repo) == []
```

- [ ] **Step 2: Run to verify the changed test fails**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -q -k locked`
Expected: `test_sweep_survives_stale_dir_and_locked_worktree` FAILS (locked worktree is currently removed); the force variant passes incidentally (current behavior already removes).

- [ ] **Step 3: Implement the skip**

In `sweep_worktrees.sh`:

(a) Add a lock probe after the `FORCE` parsing:

```bash
is_locked() {
  git -C "$ROOT" worktree list --porcelain | awk -v wt="$1" '
    $1 == "worktree" { cur = substr($0, 10) }
    $1 == "locked" && cur == wt { found = 1 }
    END { exit !found }'
}
```

(b) Initialize `kept_worktrees=0` next to `removed_worktrees=0`, and at the top of the worktree loop body (after the `[ -e "$wt" ] || continue` guard), add:

```bash
  # A lock marks possibly-live state (a concurrent run, an untriaged redirect):
  # keep it unless the caller explicitly forces. The branch survives too —
  # `branch -d` fails while its worktree exists.
  if [ "$FORCE" != "--force" ] && is_locked "$wt"; then
    kept_worktrees=$((kept_worktrees + 1))
    echo "kept (locked — possibly a live run; --force to remove): $wt"
    continue
  fi
```

(c) Extend the summary line, KEEPING the existing text contiguous (it is pinned by `test_sweep_is_a_noop_on_a_clean_repo`):

```bash
echo "swept: $removed_worktrees worktree(s) removed, $deleted branch(es) deleted, $kept kept, $kept_worktrees locked worktree(s) kept"
```

(d) Update the header comment (the "Run it only AFTER the run completes — it removes every wf_* worktree, including locked ones" paragraph) to the new contract: locked worktrees are kept by default and reported; `--force` removes them too (and force-deletes unmerged branches, as before).

- [ ] **Step 4: Run the sweep suite**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -q`
Expected: green.

- [ ] **Step 5: Update the two doc call sites**

Both sentences currently warn "never sweep while another ultrapowers run is active in this repo". Soften to match the new default — locked worktrees (a live run's state) are kept unless `--force` is passed; concurrent runs remain unsupported:

- `skills/ultrapowers/SKILL.md` — the Approve-step line referencing `scripts/sweep_worktrees.sh` (note: after Task 9 it reads `${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh`).
- `skills/ultrapowers/references/report-format.md` — the Approve bullet's parenthetical about the sweep.

In both, append/replace so the sentence states: "locked worktrees are kept by default (pass `--force` to remove them); concurrent runs in one repo remain unsupported."

- [ ] **Step 6: Run the full suites and commit**

Run: `python3 -m pytest tests/ -q && node tests/sim_workflow.mjs`
Expected: green (test_report_runbook.py and test_validate_skill.py pin doc wording — update any pinned sentence the suite flags, keeping the new meaning).

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_sweep_worktrees.py
git commit -m "fix: sweep keeps locked worktrees by default, --force overrides (#14)"
```

---

### Task 9: docs — standardize every path reference on ${CLAUDE_PLUGIN_ROOT} (#16)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Create: `tests/test_path_variables.py`

- [ ] **Step 1: Write the failing tripwire test**

Create `tests/test_path_variables.py`:

```python
"""One path-variable convention: ${CLAUDE_PLUGIN_ROOT}. Two conventions invite
a broken substitution on a surface where only one is set (issue #16)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_no_claude_skill_dir_variable_in_plugin_surfaces():
    hits = []
    for p in (ROOT / "skills").rglob("*"):
        if p.is_file() and p.suffix in {".md", ".js", ".sh", ".py"}:
            if "CLAUDE_SKILL_DIR" in p.read_text():
                hits.append(str(p.relative_to(ROOT)))
    assert hits == [], f"CLAUDE_SKILL_DIR crept back into: {hits}"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_path_variables.py -v`
Expected: FAIL listing `skills/ultrapowers/SKILL.md` and `skills/ultrapowers/references/report-format.md`.

- [ ] **Step 3: Sweep the references**

Current occurrences (verify with `grep -rn CLAUDE_SKILL_DIR skills/`):

- `skills/ultrapowers/SKILL.md` — the workflow-install lines:
  - `cp "${CLAUDE_SKILL_DIR}/workflow.js" ...` → `cp "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/workflow.js" ...`
  - `cp "${CLAUDE_SKILL_DIR}/probe.js" ...` → `cp "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/probe.js" ...`
  - the sweep line: `bash ${CLAUDE_SKILL_DIR}/scripts/sweep_worktrees.sh` → `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh`
- `skills/ultrapowers/references/report-format.md` — the Approve bullet's `bash ${CLAUDE_SKILL_DIR}/scripts/sweep_worktrees.sh` → `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh`

At the FIRST `${CLAUDE_PLUGIN_ROOT}` use in SKILL.md (the Step-2 compiler line), add the one-line resolution note: "(`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's installed root — the directory containing `skills/`.)"

- [ ] **Step 4: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: green — `test_report_runbook.py`, `test_validate_skill.py`, and `test_no_prompt_drift.py` pin doc lines; if any pin asserts the old `${CLAUDE_SKILL_DIR}` spelling, update the pin to the new spelling in the same commit.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_path_variables.py
git commit -m "docs: standardize on \${CLAUDE_PLUGIN_ROOT} with an absence tripwire (#16)"
```

---

### Task 10: docs — document the fence-tracker leniency (#15)

**Type:** implementation
**Depends-on:** 5

(Why this edge: 4 and 5 also edit `dependency-analysis.md` — serialized to avoid a write race; 5 already carries the edge from 4.)

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`

- [ ] **Step 1: Add the leniency note**

In `skills/ultrapowers/references/dependency-analysis.md`, the fence-aware extraction paragraph (the one beginning "Extract each task's verbatim body **fence-aware**") gains this follow-on note:

```markdown
> **Leniency note:** the tracker models info-stringed fence runs inside an open
> fence as nested openers so balanced nested examples (e.g. a `~~~` wrapper
> around a ``` example) stay content. On *unbalanced* trailing fences it is more
> lenient than strict CommonMark: a trailing line that strict CommonMark would
> keep fenced can be treated as prose and reach marker/text-dependency scanning.
> This triggers only on malformed example markdown — keep fenced examples
> balanced and the models agree.
```

- [ ] **Step 2: Run the suite**

Run: `python3 -m pytest tests/ -q`
Expected: green (doc-pinning tests unaffected by an added blockquote).

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/references/dependency-analysis.md
git commit -m "docs: state the fence-tracker leniency vs strict CommonMark (#15)"
```

---

### Task 11: Full-suite verification gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

Run and require green:

- `python3 -m pytest tests/ -q` — exit 0, no failures.
- `node tests/sim_workflow.mjs` — every scenario prints OK, exit 0.
- `git status` — clean tree, no unstaged leftovers.

---

### Task 12: Release 0.6.0

**Type:** release
**Depends-on:** 11

After the integration branch merges to main:

- [ ] Bump `"version"` to `0.6.0` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- [ ] Commit: `release: 0.6.0 — open-issues batch: budget deferral honesty, dup-id refusal, cycle paths, plural text deps, inline Files, sweep root + lock safety, one path variable`
- [ ] `git push origin main`

---

### Task 13: Close the issues

**Type:** manual
**Depends-on:** 12

Owner/orchestrator action with `gh`, after 0.6.0 is pushed:

- [ ] Close **#8, #9, #10, #11, #12, #13, #14, #15, #16, #18** as completed, each with a one-line comment naming the fixing commit and "shipped in 0.6.0". For partial-scope fixes note the scope: #11 "plural conjunction/comma lists parse; title/phase matching intentionally excluded", #15 "documented, not changed — leniency note in dependency-analysis.md", #18 "items 1 and 3; item 2 kept per rule of three".
- [ ] Close **#17** as not planned with: "Won't fix: real plans sit far below 100 tasks and compile is a one-shot orchestrator cost. If dense plans ever materialize, the fix is an incrementally maintained transitive-closure bitset (or incremental topological order) replacing the per-pair reachability DFS — see the issue body."
