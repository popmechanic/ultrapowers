# Eval-Driven Hardening Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five skill improvements identified by the 2026-06-12/13 eval matrix — dependency lint, declared-file-scope guard, sibling wave context, exact-assertion test discipline, and a report-derived Salvage path at the pre-merge gate.

**Architecture:** Three change surfaces. (1) `compile_plan.py` gains a new semantic edge tier (`prose-reference`) so an undeclared dependency expressed only in prose serializes the tasks instead of cascading at runtime — this is the root-cause fix for eval run mixed-B-2. (2) The baked implementer/reviewer discipline (`references/reviewer-prompts.md` → re-baked into `workflow.js`, guarded by `tests/test_no_prompt_drift.py`) gains a FILES scope rule, a SIBLING FILES rule, and exact-assertion test guidance; `workflow.js` threads the per-task data into the prompts at dispatch. (3) SKILL.md Step 5 and `report-format.md` gain a **Salvage** choice that mechanically rebuilds Redirect waves from the run report — no engine change, the `resume: true` path already exists.

**Tech Stack:** Python 3 (compiler + pytest), plain JavaScript (workflow.js, sim harness `tests/sim_workflow.mjs`), markdown skill docs.

**Evidence base (context only — every task is self-contained below):** eval run `mixed-B-2` failed 3/7 acceptance because a sonnet implementer, waved in parallel with the task that creates `apistub/schema.py` (the plan said `Depends-on: none` while the spec text said "returns a `schema.User`"), first duplicated and then deleted the sibling-owned file; the fix loop could not recover and the cascade blocked half the plan. The blinded judge scored every condition 5/5 on correctness but docked the tiered runs for loose test assertions. The completeness critic identified an integration-ready branch the engine had no path to use.

---

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `skills/ultrapowers/scripts/compile_plan.py` | 1 | new `prose-reference` edge tier |
| `tests/test_compile_plan.py` | 1 | edge tests |
| `skills/ultrapowers/references/dependency-analysis.md` | 2 | edge rule 6 + label list |
| `skills/ultrapowers/references/plan-markers.md` | 2 | why-label list |
| `skills/ultrapowers/SKILL.md` | 2, 6 | Step-2 edge list; Step-5 Salvage |
| `skills/ultraplan/SKILL.md` | 2 | self-review bullet |
| `skills/ultrapowers/references/reviewer-prompts.md` | 3, 4, 5 | BAKE-block prompt source |
| `skills/ultrapowers/workflow.js` | 3, 4, 5 | re-baked constants + prompt threading |
| `tests/sim_workflow.mjs` | 3, 4 | prompt-threading scenario |
| `skills/ultrapowers/references/workflow-template.md` | 3 | `files` no longer "UNUSED" |
| `skills/ultrapowers/references/report-format.md` | 6 | Salvage presentation bullet |
| `tests/test_salvage_gate.py` | 6 | pin test (new) |

---

### Task 1: `prose-reference` edge in the plan compiler

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

The compiler already infers edges from `Files:` blocks, but a dependency expressed only in prose — a task body that names `schema.User` while its `Files:` block never mentions `apistub/schema.py` — is invisible to it. Add a semantic edge: when task B's fence-stripped prose contains a backticked reference to a path task A creates, emit edge A → B with `why: "prose-reference"`. The edge is cycle-guarded (prose matching is fuzzier than Files matching) and every *newly added* edge is surfaced in `marker_conflicts` so the Step-3 gate shows the inference. The existing `add()` machinery already surfaces the override when B declared `Depends-on: none`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py` (the file's `compile_plan(path)` helper already runs the compiler on a path and parses its JSON; `tmp_path` is the pytest fixture):

```python
PROSE_REF_PLAN = """# Demo Implementation Plan

### Task 1: User schema

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

- [ ] **Step 1:** Define the `User` dataclass.

### Task 4: In-memory store

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

- [ ] **Step 1:** `add(name, email)` creates and returns a `schema.User` with an auto-incrementing id.
"""


def test_prose_reference_edge_orders_creator_before_referencer(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN)
    out = compile_plan(plan)
    assert {"from": "1", "to": "4", "why": "prose-reference"} in out["dag_edges"]
    assert out["waves"] == [["1"], ["4"]]
    notes = " ".join(c["note"] for c in out["marker_conflicts"])
    # the inference itself is surfaced, and the authored `none` override too
    assert "prose-reference" in notes
    assert "Depends-on: none overridden" in notes


def test_prose_reference_matches_basename_and_full_path(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN.replace(
        "returns a `schema.User`", "import `apistub/schema.py` and `schema.py`"))
    out = compile_plan(plan)
    assert {"from": "1", "to": "4", "why": "prose-reference"} in out["dag_edges"]


def test_prose_reference_dedupes_against_declared_marker(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(PROSE_REF_PLAN.replace(
        "**Depends-on:** none\n\n**Files:**\n- Create: `apistub/store.py`",
        "**Depends-on:** 1\n\n**Files:**\n- Create: `apistub/store.py`"))
    out = compile_plan(plan)
    whys = [e["why"] for e in out["dag_edges"]]
    assert "marker" in whys
    assert "prose-reference" not in whys          # deduped by the seen-pair guard
    assert out["marker_conflicts"] == []          # nothing newly inferred -> no note


def test_prose_reference_ignores_fenced_examples(tmp_path):
    plan = tmp_path / "plan.md"
    fenced = PROSE_REF_PLAN.replace(
        "- [ ] **Step 1:** `add(name, email)` creates and returns a `schema.User` with an auto-incrementing id.",
        "- [ ] **Step 1:** Implement the store. Example output:\n\n```\nuser = schema.User(id=1)\n```")
    plan.write_text(fenced)
    out = compile_plan(plan)
    assert all(e["why"] != "prose-reference" for e in out["dag_edges"])


def test_prose_reference_short_stem_requires_exact_or_basename(tmp_path):
    # stem 'a' (from a.txt) is below the minimum stem length: `a.something`
    # must NOT match, but the exact backticked filename `a.txt` must.
    plan = tmp_path / "plan.md"
    plan.write_text("""# Demo Implementation Plan

### Task 1: Alpha

**Type:** implementation

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to the file.

### Task 2: Beta

**Type:** implementation

**Files:**
- Create: `b.txt`

- [ ] **Step 1:** Write `a.member` style prose and copy the header from `a.txt`.
""")
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "prose-reference"} in out["dag_edges"]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -k prose_reference -v`
Expected: FAIL — no `prose-reference` edges are emitted yet.

- [ ] **Step 3: Implement.** In `skills/ultrapowers/scripts/compile_plan.py`, add a module-level helper immediately above `def build_edges(impl):`

```python
# Minimum module-stem length for attribute-style prose matching (`schema.User`).
# One- and two-letter stems (`a.txt` -> `a.`) match too much English to trust.
PROSE_REF_MIN_STEM = 3


def prose_references(creator_paths, prose):
    """Backticked tokens in fence-stripped prose that reference a created path:
    the exact path, its basename, or — for stems >= PROSE_REF_MIN_STEM — the
    module stem used as an attribute reference (`schema.User` referencing
    apistub/schema.py). Returns the set of matched created paths."""
    tokens = {t.strip() for t in PATH_RE.findall(prose)}
    hits = set()
    for path in creator_paths:
        base = path.rsplit("/", 1)[-1]
        stem = base.rsplit(".", 1)[0]
        for tok in tokens:
            if tok == path or tok.endswith("/" + path) or tok == base:
                hits.add(path)
            elif (len(stem) >= PROSE_REF_MIN_STEM and tok != base
                  and tok.startswith(stem + ".")):
                hits.add(path)
    return hits
```

Then in `build_edges`, insert a tier between the existing Tier-2 loop and the `# Tier 3: Document-order heuristics` comment:

```python
    # Tier 2.5: Semantic, order-independent — prose-reference. B's prose names a
    # file A creates (backticked exact path, basename, or module-stem attribute
    # like `schema.User`). Eval run mixed-B-2 (2026-06-13) is the motivating
    # failure: a task spec said "returns a `schema.User`" while declaring
    # Depends-on: none, waved parallel to the task creating apistub/schema.py,
    # and its failure cascade-blocked the rest of the diamond. Prose matching is
    # fuzzier than Files matching, so unlike tier 2 these edges are
    # cycle-guarded like tier 3, and each NEWLY added edge is surfaced in
    # marker_conflicts so the Step-3 gate shows the inference.
    for a in impl:
        if not a["creates"]:
            continue
        for b in impl:
            if a["id"] == b["id"]:
                continue
            hits = prose_references(a["creates"], b["prose"])
            if hits and not would_cycle(a["id"], b["id"]):
                before = len(edges)
                add(a["id"], b["id"], "prose-reference")
                if len(edges) > before:
                    add_conflict(
                        b["id"], a["id"] + " -> " + b["id"] + " (prose-reference)",
                        "task prose references " + ", ".join(sorted(hits)[:3])
                        + " created by Task " + a["id"]
                        + " — edge inferred; declare **Depends-on:** " + a["id"]
                        + " to make it explicit (or rewrite the mention if it is "
                        "not a real dependency)")
```

Also update the module docstring's edge enumeration (line ~6) to mention `prose-reference` alongside read-after-write.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py -k prose_reference -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite.**

Run: `python3 -m pytest tests/ -q`
Expected: PASS. If a pre-existing fixture test fails because a fixture *gained* a `prose-reference` edge, inspect the fixture: when the backticked mention is a genuine reference to another task's created file, update the test's expected edges/conflicts to include it (the rule is correct); never weaken the matching rule to keep an assertion green. `tests/fixtures/marked-plan.md` and `unmarked-plan.md` were checked while writing this plan — their cross-task mentions all already carry edges, so the seen-pair dedupe keeps their assertions intact.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "compile_plan: infer prose-reference edges (eval mixed-B-2 root cause)"
```

### Task 2: Document the `prose-reference` edge rule

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultraplan/SKILL.md`

Four doc surfaces name the edge rules; all four must agree with the compiler.

- [ ] **Step 1:** In `skills/ultrapowers/references/dependency-analysis.md`, under "## Build the DAG", append rule 6 after rule 5 ("Read-after-write"):

```markdown
6. **Prose-reference:** B's fence-stripped prose contains a backticked reference to a path in A's `Create:` set — the exact path, its basename, or (for stems of 3+ characters) its module stem used as an attribute (`schema.User` referencing `apistub/schema.py`). Edge A → B (`why: "prose-reference"`). Because prose matching is fuzzier than `Files:` matching, these edges are cycle-guarded like the document-order heuristics, and each newly inferred edge is surfaced in `marker_conflicts` so the Step-3 gate shows the inference. Motivating failure: eval run mixed-B-2 (2026-06-13) — a task spec said "returns a `schema.User`" while declaring `Depends-on: none`, waved parallel to the schema task, and its failure cascade-blocked the rest of the diamond.
```

- [ ] **Step 2:** In the same file, update the why-label line (currently line 77) to:

```markdown
Edge `why` labels emitted by the compiler: `marker`, `write-after-create`, `write-after-write`, `read-after-write`, `prose-reference`, `text`, `ambiguous-files`.
```

and extend the precedence paragraph below it with one sentence:

```markdown
`prose-reference` sits between the semantic rules and the document-order heuristics: order-independent in direction (creator → referencer) but cycle-guarded, so an explicit or semantic edge in the opposite direction always wins.
```

- [ ] **Step 3:** In `skills/ultrapowers/references/plan-markers.md`, the `Depends-on: none` paragraph (currently line ~50) enumerates the literal `why` labels a conflicting edge can carry — add `prose-reference` to that list: `` `write-after-create`, `write-after-write`, `read-after-write`, `prose-reference`, `text`, or `ambiguous-files` ``.

- [ ] **Step 4:** In `skills/ultrapowers/SKILL.md` Step 2, the "Build the DAG" bullet currently reads "(marker, write-after-create, write-after-write, text, read-after-write)" — change to "(marker, write-after-create, write-after-write, text, read-after-write, prose-reference)".

- [ ] **Step 5:** In `skills/ultraplan/SKILL.md`, under "## Self-review additions", append a bullet:

```markdown
- Every backticked mention of a file or module another task creates (`apistub/schema.py`, `schema.User`) has a matching `**Depends-on:**` on the referencing task — otherwise the compiler infers a `prose-reference` edge and surfaces it as a conflict at the wave-plan gate.
```

- [ ] **Step 6: Run the full suite** (several tests pin these docs against each other).

Run: `python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/dependency-analysis.md skills/ultrapowers/references/plan-markers.md skills/ultrapowers/SKILL.md skills/ultraplan/SKILL.md
git commit -m "docs: prose-reference edge rule across all four edge-rule surfaces"
```

### Task 3: Declared file scope (FILES) threaded into implementer and reviewer prompts

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Test: `tests/sim_workflow.mjs`

`task.files` already rides on every task object (`{ id, title, body, tier, acceptance, files, review? }`) but is currently unused. Thread it into prompts as a `FILES:` line and give both prompts a hard scope rule. The deletion rule is the mechanical guard: in eval run mixed-B-2 the implementer's final commit deleted a file its task never named, and the reviewer treated it as an ordinary judgment call.

The BAKE contract: `tests/test_no_prompt_drift.py` asserts each `<!-- BAKE:NAME -->` block in `reviewer-prompts.md` appears (whitespace/formatting-normalized) in `workflow.js`. Every prompt edit below is made in BOTH files, with identical wording; the dynamic file list is appended at dispatch, *outside* the baked constants (same pattern as the existing `TASK:`/`BASE:` lines).

- [ ] **Step 1: Extend the sim harness with a failing scenario.** In `tests/sim_workflow.mjs`, add this scenario function alongside the existing ones, and register it in the runner block at the bottom of the file (add `await scenarioFileScope()` next to the other `await scenario...()` calls):

```js
// ── Scenario: declared file scope is threaded into impl/review prompts ───────
async function scenarioFileScope() {
  const waves = [[
    { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'cheap',
      files: ['a.txt', 'tests/test_a.py'] },
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'cheap' }, // no files
  ]]
  const prompts = {}
  const agent = makeAgent((label, prompt) => { prompts[label] = prompt; return undefined })
  await runWorkflow({ agent, args: { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', dependencyEdges: [], edges: [] }, budget: undefined })
  assert(prompts['impl:A'].includes('\nFILES: a.txt, tests/test_a.py'),
    'scope: impl:A prompt carries the FILES line')
  assert(prompts['review:A:1'].includes('\nFILES: a.txt, tests/test_a.py'),
    'scope: review:A prompt carries the FILES line')
  assert(!prompts['impl:B'].includes('\nFILES:'),
    'scope: impl:B has no FILES line when task.files is absent')
  console.log('scenario fileScope: OK')
}
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: `SIM ASSERT FAILED: scope: impl:A prompt carries the FILES line`.

- [ ] **Step 3: Edit the prompt source.** In `skills/ultrapowers/references/reviewer-prompts.md`:

(a) Inside `<!-- BAKE:IMPLEMENTER_PROMPT -->`, add to the **Inputs you receive** list:

```markdown
- `FILES`: the task's declared file scope — the Create/Modify/Test paths the plan assigns to this task (may be absent)
```

(b) Same block, add to **Self-verify before reporting**:

```markdown
- If `FILES` is present: confirm every file you created, modified, or deleted is named there or is plainly required by the task text. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.
```

(c) Inside `<!-- BAKE:REVIEWER_PROMPT -->`, extend Spec-compliance item 3 (the scope-creep item) with:

```markdown
When `FILES` (the task's declared file scope) is provided: a deletion of any file that exists at `BASE` but is not named in `FILES` is automatically a blocking issue; modifications outside `FILES` are blocking unless the task text plainly requires them.
```

- [ ] **Step 4: Re-bake into `workflow.js`.** Mirror the three additions word-for-word into the `IMPLEMENTER_PROMPT` and `REVIEWER_PROMPT` constants (plain-text lines in the joined arrays, markdown formatting dropped — match the style of the surrounding lines). Then add the dispatch threading: after the existing `const testCmdLine = ...` line, add

```js
// task.files (advisory at validation) becomes the FILES prompt line: the
// declared scope the implementer must stay inside and the reviewer enforces.
// Eval run mixed-B-2 (2026-06-13): an implementer deleted a file its task
// never named; nothing mechanical caught it before the fix loop burned out.
const filesLine = (task) => (Array.isArray(task.files) && task.files.length)
  ? ('\nFILES: ' + task.files.join(', '))
  : ''
```

and thread `filesLine(task)` into all three dispatch prompts in `runTaskInner`:

- initial implementer: `... + '\n\nBASE: ' + baseSha + testCmdLine + filesLine(task) + '\nTASK:\n' + task.body`
- reviewer (`reviewPrompt`): `... + '\nBASE: ' + baseSha + testCmdLine + filesLine(task)`
- fix-round implementer: `... + '\n\nBASE: ' + impl.headSha + testCmdLine + filesLine(task) + '\nTASK:\n' + task.body + ...`

Update the `args.waves` validation error message in `workflow.js` (currently "acceptance/files are advisory") to "(acceptance is advisory; files feeds the FILES prompt line)".

- [ ] **Step 5:** In `skills/ultrapowers/references/workflow-template.md`, the `args.waves` bullet currently says `acceptance` and `files` are "currently UNUSED by the workflow" — change to: `acceptance` is currently UNUSED; `files` is threaded into the implementer/reviewer prompts as the `FILES` declared-scope line (string array of the task's Create/Modify/Test paths). The verbatim `body` remains authoritative for acceptance criteria.

- [ ] **Step 6: Verify**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: sim prints `scenario fileScope: OK` and all scenarios pass; pytest green (in particular `test_no_prompt_drift.py` — if it fails, the md and js wordings have drifted; make them identical).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/workflow.js skills/ultrapowers/references/workflow-template.md tests/sim_workflow.mjs
git commit -m "feat: thread declared file scope (FILES) into prompts; deletions outside scope are blocking"
```

### Task 4: Sibling wave context (SIBLING FILES) in prompts

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/workflow.js`
- Test: `tests/sim_workflow.mjs`

A task reviewed in worktree isolation cannot be green when a same-wave sibling owns a file it needs — in eval run mixed-B-2 the fix-round implementer deleted its duplicate of a sibling-owned file (defensible for integration) and was failed because its isolated suite could no longer import. Tell both roles which files belong to same-wave siblings so the failure mode is named precisely ("missing dependency edge") instead of fought.

Same BAKE contract as Task 3: identical wording in `reviewer-prompts.md` and the `workflow.js` constants; the dynamic sibling list is appended at dispatch outside the baked text.

- [ ] **Step 1: Extend the sim scenario (failing).** In `tests/sim_workflow.mjs`, inside `scenarioFileScope` from Task 3, give task B its own files and add sibling assertions. Replace the B task line with:

```js
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'cheap', files: ['b.txt'] },
```

and add after the existing assertions (the impl:B FILES assertion changes accordingly):

```js
  assert(prompts['impl:B'].includes('\nFILES: b.txt'),
    'scope: impl:B now carries its own FILES line')
  assert(prompts['impl:A'].includes('\nSIBLING FILES: B: b.txt'),
    'sibling: impl:A names B-owned files')
  assert(prompts['impl:B'].includes('\nSIBLING FILES: A: a.txt, tests/test_a.py'),
    'sibling: impl:B names A-owned files')
  assert(prompts['review:A:1'].includes('\nSIBLING FILES: B: b.txt'),
    'sibling: review:A names B-owned files')
```

Delete the now-stale `!prompts['impl:B'].includes('\nFILES:')` assertion.

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: `SIM ASSERT FAILED: sibling: impl:A names B-owned files`.

- [ ] **Step 3: Edit the prompt source.** In `skills/ultrapowers/references/reviewer-prompts.md`:

(a) `<!-- BAKE:IMPLEMENTER_PROMPT -->`, **Inputs you receive** list, add:

```markdown
- `SIBLING FILES`: files owned by tasks running in parallel with yours (may be absent). They do NOT exist at `BASE` and are not yours: never create, duplicate, modify, or delete a sibling-owned path. If your task cannot be implemented or tested without one, report `BLOCKED` naming the file — that is a missing dependency edge in the plan, not yours to work around.
```

(b) `<!-- BAKE:REVIEWER_PROMPT -->`, add after item 8 (the check-suite item):

```markdown
When `SIBLING FILES` is provided and the check suite fails ONLY because a sibling-owned file is absent at `BASE`, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.
```

- [ ] **Step 4: Re-bake and thread.** Mirror both additions into the `workflow.js` constants. Then add next to `filesLine`:

```js
// Same-wave siblings own files this task must not touch — they are not at
// BASE (a wave merges only after all its tasks finish). Naming them lets the
// implementer and reviewer tell "missing sibling file" from "broken work".
const siblingLine = (task, wave) => {
  const sibs = wave
    .filter((t) => t.id !== task.id && Array.isArray(t.files) && t.files.length)
    .map((t) => t.id + ': ' + t.files.join(', '))
  return sibs.length ? ('\nSIBLING FILES: ' + sibs.join(' | ')) : ''
}
```

Change `runTask(task, baseSha)` and `runTaskInner(task, baseSha)` to accept a third parameter `siblings` (a string; `runTask` forwards it), change the dispatch call site in the wave loop to

```js
    const chunkResults = await parallel(runnable.map((task) => () =>
      runTask(task, waveBaseSha, siblingLine(task, WAVES[w]))))
```

and append `siblings` immediately after `filesLine(task)` in all three prompts from Task 3 (initial implementer, reviewer, fix-round implementer).

- [ ] **Step 5: Verify**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: sim green including the sibling assertions; pytest green including `test_no_prompt_drift.py`.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/workflow.js tests/sim_workflow.mjs
git commit -m "feat: SIBLING FILES wave context in prompts; missing-sibling failures named, not fought"
```

### Task 5: Exact-assertion test discipline in the baked prompts

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/workflow.js`

All three blinded eval judgments scored every condition 5/5 on correctness; the tiered runs lost on test thoroughness — loose `any(...)` containment where the task defined exact error lists and ordering, missing type-edge cases. This is promptable. Same BAKE contract as Tasks 3–4.

- [ ] **Step 1: Edit the prompt source.** In `skills/ultrapowers/references/reviewer-prompts.md`:

(a) `<!-- BAKE:IMPLEMENTER_PROMPT -->`, replace workflow step 3, currently:

```markdown
3. Write or update tests that encode those criteria. Confirm they fail (`pnpm check` or equivalent).
```

with:

```markdown
3. Write or update tests that encode those criteria. Where the task specifies exact outputs — error lists and their order, JSON shapes, return values — assert the full expected value with equality, not loose containment, and cover the type edge cases the spec implies (e.g. a bool passing an int check). Confirm they fail (`pnpm check` or equivalent).
```

(b) `<!-- BAKE:REVIEWER_PROMPT -->`, extend Code-quality item 7 (test quality) with:

```markdown
Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.
```

- [ ] **Step 2: Re-bake.** Mirror both edits word-for-word into the `IMPLEMENTER_PROMPT` and `REVIEWER_PROMPT` constants in `workflow.js`.

- [ ] **Step 3: Verify**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q && node tests/sim_workflow.mjs && python3 -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/workflow.js
git commit -m "feat: exact-assertion test discipline in implementer and reviewer prompts"
```

### Task 6: Salvage choice at the Step-5 pre-merge gate

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Create: `tests/test_salvage_gate.py`

In eval run mixed-B-2 the completeness critic produced a precise close-out path (an integration-ready kept branch, two unimplemented tasks, the gate to re-run) — and the orchestration had no instruction to act on it; the run forfeited 4 of 7 acceptance criteria that a few dollars of follow-up would have recovered. The engine's `resume: true` Redirect path already exists; Salvage is Redirect with the corrective instructions derived mechanically from the report instead of typed by the human.

- [ ] **Step 1: Write the failing pin test** — create `tests/test_salvage_gate.py`:

```python
"""SKILL.md Step 5 must offer the report-derived Salvage path, and
report-format.md must present it alongside Approve/Redirect."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_skill_step5_offers_salvage():
    text = SKILL.read_text()
    assert "**Salvage**" in text
    assert "PRIOR ATTEMPT" in text          # failed-task bodies carry the kept branch + findings
    assert text.count("resume: true") >= 2  # both Salvage and Redirect relaunch via resume


def test_salvage_is_built_from_the_report():
    text = SKILL.read_text()
    assert "kept branch" in text            # prior-attempt coordinates from tasks[]
    assert "unfinished" in text             # dep-blocked tasks ride along verbatim


def test_report_format_presents_salvage():
    text = REPORT.read_text()
    assert "**Salvage**" in text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_salvage_gate.py -v`
Expected: FAIL — no Salvage text exists yet.

- [ ] **Step 3: Edit `skills/ultrapowers/SKILL.md` Step 5.** Change "present two choices:" to "present these choices:" and insert a new bullet between **Approve** and **Redirect**:

```markdown
- **Salvage** — offer this whenever the report carries `failed` tasks or dep-blocked `unfinished` entries; it is Redirect with the corrective instructions derived from the report instead of typed by the human. Build the new `waves` array mechanically: every `failed` task plus every dep-blocked or cascade-blocked task from `unfinished`, preserving their original relative wave order and the Step-2 edges among them. To each failed task's `body`, append a `PRIOR ATTEMPT` note carrying: its kept branch and HEAD sha from `tasks[]`, the blocking issues from its `notes`, and any completeness-critic finding that names the task — plus the instruction that when the prior branch already contains correct work, the implementer should pull that content in (`git diff <sha>` / `git checkout <sha> -- <path>` against the named commit; BASE stays the integration HEAD) instead of reimplementing from scratch. Blocked tasks ride verbatim. Present the constructed salvage waves to the human for approval, then relaunch per the Redirect mechanics below (`resume: true`, same `integrationBranch`) and return to this gate when it completes.
```

- [ ] **Step 4: Edit `skills/ultrapowers/references/report-format.md`.** In the presentation section, insert between the **Approve** and **Redirect** bullets:

```markdown
- **Salvage** — when `failed` tasks or dep-blocked `unfinished` entries exist: the orchestrator pre-builds the Redirect waves from the report (failed + blocked tasks, with each failed task's kept branch, review findings, and critic findings appended to its body as a `PRIOR ATTEMPT` note) and presents them for approval; mechanics identical to Redirect (`resume: true`, same integration branch).
```

- [ ] **Step 5: Verify**

Run: `python3 -m pytest tests/test_salvage_gate.py tests/test_report_runbook.py -v && python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_salvage_gate.py
git commit -m "feat: Salvage choice at the pre-merge gate — report-derived redirect waves"
```

### Task 7: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:** none

- [ ] **Step 1:** Run `python3 -m pytest tests/ -q` — expect all green, zero failures.
- [ ] **Step 2:** Run `node tests/sim_workflow.mjs` — expect every scenario to print `OK` and exit 0.
- [ ] **Step 3:** Run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — expect `skill ok` twice.
