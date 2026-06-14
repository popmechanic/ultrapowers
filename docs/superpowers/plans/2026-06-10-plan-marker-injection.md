# Plan Marker Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers` — it dogfoods the `**Type:**`/`**Depends-on:**` markers it implements (the current engine ignores them gracefully; file-overlap inference still produces a correct ordering).

**Acceptance:** suite — engine/skill change; verified by the committed marker test suite, not a held-out exam.

**Goal:** Make Superpowers plans compile deterministically into ultrapowers waves by (1) defining an additive per-task marker contract (`Type:`, `Depends-on:`), (2) teaching the compile step (dependency analysis) to classify tasks against a worktree-pure contract — markers when present, heuristics otherwise — and (3) shipping an authoring-side `ultraplan` skill so new plans are born parallel-clean.

**Architecture:** One canonical contract document (`skills/ultrapowers/references/plan-markers.md`) consumed by three surfaces: the compiler reference (`dependency-analysis.md`, which classifies before building the DAG and emits dispositions + a post-merge runbook into the Step-3 transparency block), the orchestrator (`SKILL.md` Steps 2/3/5), and a new authoring skill (`skills/ultraplan/SKILL.md`) that mirrors the contract via BAKE-block anti-drift tests — the same pattern `test_no_prompt_drift.py` already uses for `workflow.js`. `workflow.js` is untouched: classification happens at compile time, excluded tasks never reach the workflow args, and the runbook is assembled by the main agent — **no re-bake required**.

**Tech Stack:** Markdown skill documents, Python 3.11 + pytest (static-assertion tests, matching the existing suite style), GitHub Actions CI.

---

### Task 1: Canonical marker contract + marked-plan fixture

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/references/plan-markers.md`
- Create: `tests/fixtures/marked-plan.md`
- Create: `tests/test_marker_contract.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_marker_contract.py`:

```python
"""plan-markers.md is the single source of truth for the parallel-execution
marker contract. These tests pin its vocabulary and the fixture that exercises
every marker shape. Sibling test files keep the consumers (compiler reference,
authoring skill, orchestrator, report format) from drifting."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
FIXTURE = ROOT / "tests/fixtures/marked-plan.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)
TYPES = ("implementation", "gate", "release", "manual")


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_contract_defines_both_markers_and_all_types():
    text = CONTRACT.read_text()
    assert "**Type:**" in text
    assert "**Depends-on:**" in text
    for t in TYPES:
        assert t in text, f"type '{t}' missing from the contract"


def test_contract_has_bake_blocks_for_mirroring():
    blocks = contract_blocks()
    for name in ("MARKER_SYNTAX", "TYPE_SEMANTICS"):
        assert name in blocks, "missing BAKE marker for " + name


def test_contract_states_the_invariants():
    text = CONTRACT.read_text()
    assert "worktree-pure" in text          # contract is an invariant, not a pattern list
    assert "post-merge runbook" in text     # excluded tasks are never silently dropped
    assert "additive" in text               # Depends-on never replaces file-edge inference
    assert "fence-aware" in text            # body-extraction hazard is documented


def test_fixture_covers_every_marker_shape():
    p = FIXTURE.read_text()
    assert p.count("### Task") == 5
    assert p.count("**Type:**") == 4        # Task 2 deliberately has no Type (default)
    assert "**Type:** gate" in p
    assert "**Type:** release" in p
    assert "**Depends-on:** 1" in p          # explicit edge Task 1 -> Task 3
    assert "**Depends-on:** none" in p
    # canary expectations for the compiler: waves [[1,2],[3]], 4 -> config, 5 -> runbook
    assert "Create: `a.txt`" in p
    assert "Modify: `a.txt`" in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_marker_contract.py -v`
Expected: all 4 FAIL with `FileNotFoundError` (neither `plan-markers.md` nor `marked-plan.md` exists yet)

- [ ] **Step 3: Create the contract document**

Create `skills/ultrapowers/references/plan-markers.md`:

````markdown
# Plan Markers — the Parallel-Execution Contract

Additive per-task annotations on a `superpowers:writing-plans` document that make
wave compilation deterministic. Sequential executors (subagent-driven-development,
executing-plans) ignore them; ultrapowers trusts them. A plan without markers still
runs — `dependency-analysis.md` falls back to the classification heuristics below.

## The worktree-pure task contract

An ultrapowers task is **a pure diff against the integration branch**. Concretely it:

- pushes nothing to any remote and never checks out or merges a long-lived branch;
- needs no human interaction between launch and final commit;
- mutates nothing outside its own worktree — no deploys, no ssh, no launchd/systemd
  installs, no writes to shared services;
- is verified by tests that can run concurrently with other tasks' tests (unique
  ports, temp paths, no shared on-disk fixtures).

A task that satisfies the contract is waved. A task that violates it is classified
out of the DAG (see Type semantics). Classification is evidence checked against this
invariant, not pattern-matching a list of known-bad idioms — new idioms classify
correctly as long as the contract is what gets tested.

## Marker syntax

<!-- BAKE:MARKER_SYNTAX -->
Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.
<!-- /BAKE -->

Example:

```markdown
### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Modify: `app/server/server.ts`
```

`Depends-on` is **additive**: file-overlap edges are still inferred, and the union of
marker edges and inferred edges orders the waves. `**Depends-on:** none` asserts the
author expects no incoming edges; if inference still finds one, the file edge wins
and the disagreement is surfaced in the transparency block under `marker_conflicts` —
never silently dropped.

## Type semantics (dispositions)

<!-- BAKE:TYPE_SEMANTICS -->
- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed at the wave-plan approval gate. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.
<!-- /BAKE -->

## Classification heuristics (unmarked plans)

For tasks without a `**Type:**` marker, classify by evidence, in this precedence:

1. **release** — any step contains `git push`, checks out or merges a long-lived
   branch (`git checkout main`), deploys (`ssh`, `scp`, `systemctl`, provider CLIs),
   or the body says to run "after the branch merges".
2. **manual** — steps are addressed to the owner / a human ("the owner runs…",
   "cannot be done from this machine") or need credentials/hardware the repo does
   not contain.
3. **gate** — the `**Files:**` block is `none`, empty, or missing AND every step
   only runs tests, linters, `git status`, or `git log`.
4. otherwise **implementation**.

Precedence matters: a task that pushes AND verifies is `release`, not `gate`. The
empty-Files conservative default in `dependency-analysis.md` applies only to tasks
that classify as `implementation`.

## Compile-time obligations

Whatever the classification source (marker or heuristic), the compiler MUST:

- record every non-`implementation` disposition in the Step-3 transparency block —
  the human approves the **interpretation** of the plan, not just the wave grouping;
- collect `release` and `manual` tasks, verbatim and in document order, into the
  **post-merge runbook**, rendered with the final report and handed to
  `superpowers:finishing-a-development-branch` on approval;
- inline preamble coordination notes into the bodies of the tasks they affect —
  task agents see only their own `body`;
- convert global ordering prose ("execute phases in order") into edges only where it
  names concrete task pairs; blanket ordering is superseded by the computed DAG and
  the supersession is recorded as a judgment line;
- extract task bodies **fence-aware** — a heading inside a ``` code fence is content,
  not a section boundary (plans embed whole markdown documents in their steps).

## Authoring rules that complement the markers

For the plan author (loaded at writing time by the `ultraplan` skill):

- Make every task body self-contained; coordination knowledge lives in the affected
  task's body, never only in a preamble.
- Encode ordering as `**Depends-on:**` on the downstream task; never write global
  ordering prose.
- Never instruct branch creation — the executor owns branching.
- Give every test a unique port / temp path so same-wave suites can run concurrently.
- Mark gates, releases, and manual steps explicitly so nothing rides on heuristics.
````

- [ ] **Step 4: Create the fixture**

Create `tests/fixtures/marked-plan.md`:

````markdown
# Plan: Marked Fixture

> Tiny fixture for validating marker parsing, classification, and runbook
> extraction. Expected compile: waves `[[Task 1, Task 2], [Task 3]]` with edge
> `1 → 3` (marker AND write-after-create agree); Task 4 → gate (compiled into run
> config); Task 5 → release (post-merge runbook). Task 2 has no `Type:` marker on
> purpose — it must default to `implementation`.

---

### Task 1: Create alpha

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to `a.txt`.

### Task 2: Create beta

**Depends-on:** none

**Files:**
- Create: `b.txt`

- [ ] **Step 1:** Write `beta` to `b.txt`.

### Task 3: Append to alpha

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Append `gamma` to `a.txt`.

### Task 4: Suite gate

**Type:** gate

**Files:** none (verification only)

- [ ] **Step 1:** Run: `pytest -q` — expect all green.

### Task 5: Publish

**Type:** release

**Files:**
- Modify: `plugin.json`

- [ ] **Step 1:** Bump the version, commit, and `git push origin main`.
````

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_marker_contract.py -v`
Expected: all 4 PASS

- [ ] **Step 6: Validate and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `skill ok` (the new reference file is additive; SKILL.md does not mention it yet)

```bash
git add skills/ultrapowers/references/plan-markers.md tests/fixtures/marked-plan.md tests/test_marker_contract.py
git commit -m "feat: plan-markers contract — Type/Depends-on markers, worktree-pure contract, dispositions"
```

---

### Task 2: Compiler — classify before building the DAG

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Create: `tests/test_marker_compiler.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_marker_compiler.py`:

```python
"""The compiler reference (dependency-analysis.md) must consume the marker
contract: classification precedes DAG construction, Depends-on is an edge
source, and excluded tasks land in the post-merge runbook."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEP_ANALYSIS = ROOT / "skills/ultrapowers/references/dependency-analysis.md"
TYPES = ("implementation", "gate", "release", "manual")


def test_compiler_classifies_before_building_the_dag():
    text = DEP_ANALYSIS.read_text()
    assert "plan-markers.md" in text
    idx_classify = text.index("## Classify")
    idx_dag = text.index("## Build the DAG")
    assert idx_classify < idx_dag, "classification must precede DAG construction"
    for t in TYPES:
        assert t in text, f"type '{t}' missing from the compiler reference"


def test_compiler_consumes_depends_on_markers():
    text = DEP_ANALYSIS.read_text()
    assert "**Depends-on:**" in text
    assert "additive" in text
    assert "marker_conflicts" in text


def test_compiler_collects_runbook_and_inlines_preamble():
    text = DEP_ANALYSIS.read_text()
    assert "post-merge runbook" in text
    assert "preamble" in text.lower()
    assert "fence-aware" in text
    assert "dispositions" in text   # transparency block carries them
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_marker_compiler.py -v`
Expected: all 3 FAIL (`plan-markers.md` not mentioned; `## Classify` not found; `dispositions` absent)

- [ ] **Step 3: Implement — edit `skills/ultrapowers/references/dependency-analysis.md`**

**3a.** In the `## Input` section, append a fourth bullet to the task-shape list (after the checkbox-steps bullet):

```markdown
- Optionally, the parallel-execution markers from `plan-markers.md`: `**Type:**` and
  `**Depends-on:**` lines between the task heading and the `**Files:**` block.
```

**3b.** Immediately after the `reads` bullet (end of the `## Input` section), add:

```markdown
Extract each task's verbatim body **fence-aware**: a heading inside a ``` code fence
is content, not a section boundary — plans routinely embed whole markdown documents
inside their steps.
```

**3c.** Insert a new section between `## Input` and `## Build the DAG`:

```markdown
## Classify Before Building the DAG

Classify every task per `plan-markers.md` — trust an explicit `**Type:**` marker;
otherwise apply the contract heuristics there (release → manual → gate →
implementation, in that precedence). The dispositions:

- **implementation** — enters the DAG below.
- **gate** — leaves the task set. Compile it into run configuration: its suite
  command informs `testCmd`; its expectations are listed in the transparency block
  so the human sees what the engine's per-wave merge tests and completeness critic
  now cover. Never executed as a task.
- **release** / **manual** — leaves the task set. Collect verbatim, in document
  order, into the **post-merge runbook** (rendered with the final report; handed to
  `superpowers:finishing-a-development-branch` on approval). Never run headless,
  never silently dropped.

While classifying, also:

- **Inline preamble knowledge.** Coordination notes living outside task bodies
  (ordering sections, port tables, exclusion lists) must be copied into the bodies
  of the tasks they affect — task agents see only their own `body`.
- **Supersede blanket ordering prose.** "Execute phases in order" converts to edges
  only where it names concrete task pairs; otherwise the computed DAG supersedes it
  and the supersession is recorded as a judgment line in the transparency block.
```

**3d.** In `## Build the DAG`, replace the three-item numbered edge-rule list with this four-item list (rule 1 is new; rules 2–3 are the old 1–2 verbatim; rule 4 extends the old rule 3 with phase-level references):

```markdown
1. **Explicit marker:** B carries `**Depends-on:**` naming A. Marker edges are
   **additive** to the inferred rules below — the union orders the waves.
   `**Depends-on:** none` asserts the author expects no incoming edges; if a file
   rule still finds one, the file edge wins and the disagreement is surfaced in the
   transparency block under `marker_conflicts`.
2. **Write-after-create:** B's `Modify:` set contains a path that appears in A's `Create:` set. B cannot modify a file that does not exist yet.
3. **Write-after-write (same file):** A's `writes` set and B's `writes` set share at least one path. Concurrent writes to the same file are never safe; serialize them in document order (A before B if A appears first in the plan).
4. **Explicit text dependency:** B's task body contains a phrase matching `depends on Task A`, `after Task A`, or `requires Task A` (case-insensitive, where A is the task number or title). A phase-level reference (`after phase C`) expands to an edge from every task in that phase.
```

**3e.** In `## Conservative Defaults`, change the first bullet's opening from:

```markdown
- **Ambiguous Files block:** if a task's `**Files:**` block is missing, empty, or contains glob patterns that cannot be resolved statically, treat that task as depending on all tasks that precede it in the document.
```

to:

```markdown
- **Ambiguous Files block:** if an `implementation` task's `**Files:**` block is missing, empty, or contains glob patterns that cannot be resolved statically, treat that task as depending on all tasks that precede it in the document. (Gates and release/manual tasks have already left the set during classification — this default applies only to tasks classified `implementation`.)
```

**3f.** In `## Transparency: Computed Output`, replace the fenced example block with:

```
dag_edges:
  - T1 → T3  (T3 modifies app/foo.ts created by T1)
  - T2 → T3  (explicit: "after Task 2")
  - T2 → T4  (marker: "Depends-on: 2")

dispositions:
  - T5: gate → compiled into testCmd / wave verification (not executed)
  - T6: release → post-merge runbook
marker_conflicts: []        # e.g. "Depends-on: none" overridden by a file edge
inlined_notes:
  - "port table from the preamble → T3, T4 bodies"

post_merge_runbook: [T6]    # rendered with the final report, in document order

waves:
  wave_0: [T1, T2]
  wave_1: [T3]
  wave_2: [T4]

mode: parallel   # or "sequential" if small-plan degrade applied
degrade_reason:  # populated only in sequential mode
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_marker_compiler.py tests/test_marker_contract.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/dependency-analysis.md tests/test_marker_compiler.py
git commit -m "feat: compiler classifies tasks against the marker contract before building the DAG"
```

---

### Task 3: `ultraplan` authoring skill

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `skills/ultraplan/SKILL.md`
- Create: `tests/test_ultraplan_skill.py`
- Modify: `tests/test_validate_skill.py` (add one test after `test_ultrapowers_skill_validates`)
- Modify: `.github/workflows/ci.yml` (add a validate step)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ultraplan_skill.py`:

```python
"""The ultraplan authoring skill must mirror the canonical marker contract
(plan-markers.md BAKE blocks) verbatim — same anti-drift discipline as
test_no_prompt_drift.py uses for workflow.js."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r"'s\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_ultraplan_mirrors_the_canonical_contract():
    blocks = contract_blocks()
    skill = normalize(ULTRAPLAN.read_text())
    for name in ("MARKER_SYNTAX", "TYPE_SEMANTICS"):
        expected = normalize(blocks[name])
        assert expected, "empty contract block " + name
        assert expected in skill, (
            "drift: BAKE:" + name + " in plan-markers.md is not mirrored in "
            "skills/ultraplan/SKILL.md — copy the block content verbatim.")


def test_ultraplan_does_not_cross_reference_other_skill_dirs():
    # validate_skill.py resolves `references/...` mentions against the skill's
    # OWN directory; a literal cross-skill path would fail validation or dangle.
    assert "references/plan-markers.md" not in ULTRAPLAN.read_text()


def test_ultraplan_pairs_with_writing_plans():
    text = ULTRAPLAN.read_text()
    assert "superpowers:writing-plans" in text
    assert "worktree-pure" in text
```

Append to `tests/test_validate_skill.py` (after `test_ultrapowers_skill_validates`):

```python
def test_ultraplan_skill_validates():
    code, out = run(ROOT / "skills/ultraplan")
    assert code == 0, out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_validate_skill.py -v`
Expected: the 3 new ultraplan tests FAIL (`FileNotFoundError`); `test_ultraplan_skill_validates` FAILS (`SKILL.md not found`); all pre-existing validator tests PASS

- [ ] **Step 3: Create the skill**

Create `skills/ultraplan/SKILL.md`. The two mirrored sections below are the BAKE-block contents from `plan-markers.md`, copied **verbatim** (minus the HTML comment markers) — do not paraphrase them, the anti-drift test normalizes both sides and requires containment:

````markdown
---
name: ultraplan
description: Use when writing or revising a Superpowers plan that will be executed by /ultrapowers — layers the parallel-execution markers (Type, Depends-on) and worktree-pure authoring rules on top of superpowers:writing-plans so the plan compiles into waves deterministically, without compile-time reinterpretation.
---

# Ultraplan — Author Parallel-Ready Plans

Use **together with** `superpowers:writing-plans`: that skill owns plan structure,
TDD steps, and granularity. This skill adds the parallel-execution contract so
`/ultrapowers` can compile the plan into waves by parsing instead of inferring. The
canonical contract is the plan-markers reference inside the ultrapowers skill; the
two blocks below mirror it verbatim and are pinned by an anti-drift test.

**Announce at start:** "I'm also using ultraplan to make this plan parallel-ready."

A plan written with these markers remains fully executable by the sequential
executors (subagent-driven-development, executing-plans) — markers are additive
bold-labeled lines that sequential readers simply ignore.

## Add markers to every task

Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.

## Choose the right Type

- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed at the wave-plan approval gate. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.

## Authoring rules (the worktree-pure contract)

Every `implementation` task must be a pure diff against the integration branch.
While writing tasks:

1. **Self-contained bodies.** Task agents see only their own task body — every
   coordination note (shared-file ordering, port assignments, "match on quoted
   text") must live in the body of each task it affects, never only in a preamble.
2. **Ordering is `Depends-on:`, not prose.** Never write "execute phases in order"
   or "within a phase, run tasks in numeric order" — put a `**Depends-on:**` line on
   each downstream task instead.
3. **No branch instructions.** The executor owns branching (sequential executors
   branch per their own skills; ultrapowers creates an integration branch and a
   worktree per task). Do not write `git checkout -b` steps.
4. **Concurrency-safe tests.** Same-wave tasks run their suites at the same time on
   one machine: give every test a unique port and temp path, and avoid shared
   on-disk fixtures.
5. **Split impure steps out.** If a task would push, deploy, ssh, or wait on a
   human, that part is its own `release` or `manual` task — implementation tasks
   never contain it.

## Self-review additions

After writing-plans' own self-review checklist, verify:

- Every task carries an explicit `**Type:**` (or is intentionally default
  `implementation`).
- Every cross-task constraint appears as `**Depends-on:**` on the downstream task.
- No preamble section holds load-bearing coordination that isn't also in the
  affected task bodies.
- Gates, release rituals, and owner actions are marked `gate` / `release` /
  `manual` — nothing relies on the executor's classification heuristics.
````

- [ ] **Step 4: Add the CI validate step**

In `.github/workflows/ci.yml`, after the existing `Validate skill` step, insert:

```yaml
      - name: Validate ultraplan skill
        run: python skills/ultrapowers/scripts/validate_skill.py skills/ultraplan
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_validate_skill.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: all PASS; `skill ok`

- [ ] **Step 6: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py tests/test_validate_skill.py .github/workflows/ci.yml
git commit -m "feat: ultraplan authoring skill — markers + worktree-pure rules at plan-writing time"
```

---

### Task 4: Orchestrator — wire the contract through Steps 2/3/5

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultrapowers/SKILL.md` (Step 2 bullets, Step 3 list, Step 5 first paragraph + Approve bullet, Resources list)
- Create: `tests/test_orchestrator_markers.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_orchestrator_markers.py`:

```python
"""The orchestrator SKILL.md must route the marker contract through its three
human-facing steps: classify at Step 2, approve dispositions at Step 3, render
the post-merge runbook at Step 5."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORCHESTRATOR = ROOT / "skills/ultrapowers/SKILL.md"


def test_orchestrator_wires_the_contract_through_its_gates():
    text = ORCHESTRATOR.read_text()
    assert "references/plan-markers.md" in text
    assert "Classify first" in text
    assert "post-merge runbook" in text
    assert "dispositions" in text.lower()   # Step 3 approves the interpretation
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_orchestrator_markers.py -v`
Expected: FAIL (`references/plan-markers.md` not yet mentioned in SKILL.md)

- [ ] **Step 3: Implement — edit `skills/ultrapowers/SKILL.md`**

**3a.** In Step 2, the bullet list currently opens with `- **Parse** each task's ...`. Insert a new first bullet above it:

```markdown
- **Classify first** per `references/plan-markers.md`: trust `**Type:**` markers when
  present, else the contract heuristics there. Only `implementation` tasks enter the
  DAG. Gates compile into run config (their suite commands inform `testCmd`);
  `release`/`manual` tasks go verbatim into the post-merge runbook. Extract task
  bodies fence-aware — headings inside code fences are content, not boundaries.
```

**3b.** Replace the Parse bullet:

```markdown
- **Parse** each task's `writes` set (`Create:` ∪ `Modify:`) and any explicit `depends on` text.
```

with:

```markdown
- **Parse** each task's `writes` set (`Create:` ∪ `Modify:`), any `**Depends-on:**`
  markers (additive to inference), and any explicit `depends on` text.
```

**3c.** Replace the Record bullet (last bullet of Step 2):

```markdown
- **Record** the DAG edges, wave list, mode, any degrade reason, and the derived knobs (the transparency block).
```

with:

```markdown
- **Record** the DAG edges, wave list, mode, any degrade reason, the dispositions
  (gates compiled into config, runbook entries, marker conflicts, inlined preamble
  notes), and the derived knobs (the transparency block).
```

**3d.** In Step 3's numbered list (currently items 1–4), append:

```markdown
5. **Dispositions** — which tasks were excluded as `release`/`manual` (the post-merge
   runbook), which gates were compiled into run config, any superseded ordering prose
   or marker conflicts. The human approves this **interpretation** of the plan, not
   just the grouping — a wrong classification gets caught here, before any tokens are
   spent.
```

**3e.** In Step 5's first paragraph, after the sentence ending "…and
anything unfinished or flagged by the completeness critic." add:

```markdown
Then render the **post-merge runbook** — the `release`/`manual` tasks excluded at
compile time, verbatim and in document order — so nothing classified out of the run
is forgotten.
```

And change the Approve bullet from:

```markdown
- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge / open a PR / clean up.
```

to:

```markdown
- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge /
  open a PR / clean up, carrying the post-merge runbook as its follow-up checklist.
```

**3f.** In `## Resources`, after the `dependency-analysis.md` line, insert:

```markdown
- `references/plan-markers.md` — the parallel-execution marker contract (`Type:`, `Depends-on:`), the worktree-pure task contract, classification heuristics for unmarked plans, and the compile-time obligations (post-merge runbook, preamble inlining, fence-aware extraction).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_orchestrator_markers.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: PASS; `skill ok` (the newly referenced `references/plan-markers.md` exists from Task 1)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md tests/test_orchestrator_markers.py
git commit -m "feat: orchestrator classifies via the marker contract and surfaces dispositions + runbook at both human gates"
```

---

### Task 5: Report format — present the post-merge runbook

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md` (Presentation list + Approve bullet)
- Create: `tests/test_report_runbook.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_report_runbook.py`:

```python
"""report-format.md must present the post-merge runbook at the pre-merge gate
and route it into the finishing handoff on approval."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_report_presents_the_runbook():
    text = REPORT.read_text()
    assert "Post-merge runbook" in text
    assert "Step-2" in text   # sourced from compile-time dispositions, not the workflow return
    assert "finishing-a-development-branch" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_report_runbook.py -v`
Expected: FAIL (`Post-merge runbook` absent)

- [ ] **Step 3: Implement — edit `skills/ultrapowers/references/report-format.md`**

**3a.** In `## Presentation`, after item 8 (`**Unfinished / completeness findings**…`), append:

```markdown
9. **Post-merge runbook** — the `release`/`manual` tasks excluded at compile time,
   rendered verbatim in document order. Sourced from the Step-2 dispositions (the
   main agent carries it), **not** from the workflow return — the schema above is
   unchanged. Empty runbook means the whole plan was waveable.
```

**3b.** Change the Approve bullet at the bottom from:

```markdown
- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge, clean up worktrees, and close the plan.
```

to:

```markdown
- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge, clean up worktrees, and close the plan; the post-merge runbook travels with the handoff as its follow-up checklist.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_report_runbook.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/report-format.md tests/test_report_runbook.py
git commit -m "feat: pre-merge report presents the post-merge runbook from compile-time dispositions"
```

---

### Task 6: README — document the authoring path

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Modify: `README.md` (insert one section between `## How a run works` and `## Install`)

- [ ] **Step 1: Implement**

In `README.md`, insert this section immediately before the `## Install` heading:

```markdown
## Authoring parallel-ready plans (ultraplan)

Superpowers plans are written for a sequential, human-in-the-loop executor;
ultrapowers executes them parallel and headless. Most plans compile cleanly anyway —
real cross-task constraints tend to be shared-file edges, which the dependency
analysis already infers — but release rituals, verification-only gate tasks, and
"execute phases in order" prose need interpretation. Two layers close that gap:

- **Markers** — additive per-task annotations defined in
  `skills/ultrapowers/references/plan-markers.md`:
  `**Type:** implementation | gate | release | manual` and
  `**Depends-on:** <task-ids>`. Sequential executors ignore them; ultrapowers
  compiles them deterministically. Gates become run configuration (their suite
  commands inform `testCmd`); `release`/`manual` tasks are excluded into a
  **post-merge runbook** presented with the final report — never run headless,
  never silently dropped.
- **The `ultraplan` skill** — load it alongside `superpowers:writing-plans` when
  authoring a plan destined for `/ultrapowers`. It injects the markers and the
  worktree-pure authoring rules (self-contained bodies, ordering as `Depends-on:`,
  no branch instructions, concurrency-safe tests) at writing time, so the compile
  step parses instead of inferring.

Unmarked plans still run: the compiler classifies each task against the
worktree-pure contract (no pushes, no human steps, no mutation outside the
worktree) and surfaces every reinterpretation in the wave-plan approval gate —
you approve the interpretation, not just the grouping.
```

- [ ] **Step 2: Verify**

Run: `grep -c "ultraplan" README.md`
Expected: ≥ 2

Run: `grep -n "^## " README.md`
Expected: `Authoring parallel-ready plans (ultraplan)` appears between `How a run works` and `Install`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README documents the marker contract and the ultraplan authoring path"
```

---

### Task 7: Full gate

**Type:** gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: 0 failures; the suite now includes the five new test files (`test_marker_contract.py`, `test_marker_compiler.py`, `test_ultraplan_skill.py`, `test_orchestrator_markers.py`, `test_report_runbook.py`) alongside all pre-existing tests (canary, no-prompt-drift, validator, workflow sim)

- [ ] **Step 2: Validate both skills**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: `skill ok` twice

- [ ] **Step 3: Confirm a clean tree**

Run: `git status --porcelain`
Expected: empty output (every task committed its own changes)

---

### Task 8: Release — version bump + marketplace

**Type:** release

**Files:**
- Modify: `.claude-plugin/plugin.json` (version)
- Modify: `.claude-plugin/marketplace.json` (plugins[0].version)

Run after the branch merges (this is the publish ritual — it belongs to the post-merge runbook under ultrapowers execution, or runs as the final sequential task otherwise).

- [ ] **Step 1: Bump versions**

In `.claude-plugin/plugin.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.
In `.claude-plugin/marketplace.json`, change the plugin entry's `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 2: Commit and push**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: 0.3.0 — plan-marker contract, ultraplan authoring skill, post-merge runbook"
git push origin main
```

- [ ] **Step 3: Verify**

Run: `git show HEAD:.claude-plugin/plugin.json | grep version`
Expected: `"version": "0.3.0"`
