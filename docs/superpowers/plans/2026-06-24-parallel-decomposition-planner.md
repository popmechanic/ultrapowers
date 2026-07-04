# Parallel-Decomposition Planner Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow ultraplan from a marker annotator into a decomposition shaper, and prove with a micro-loop eval that the shaping widens waves without manufacturing breadth.

**Architecture:** Prompt change to `skills/ultraplan/SKILL.md` (the shaping phase + justification gate + rationale convention), plus eval tooling on the existing micro-loop: two new programmatic scorers in `evals/scripts/run-micro.py` (`wave_width` for efficacy, `wave_overshoot` for honesty), a `compose_prompt` tweak that hides scorer-only sample metadata, and spec-fixtures with declared ground-truth widths. All offline-testable; the live micro-run is operator-invoked.

**Tech Stack:** Markdown (skill), Python + pytest (eval scorers, fixtures, tests), JSON (fixtures).

## Global Constraints

- ultraplan changes are **prompt-only**; no ultrapowers **engine/compiler** change. (Eval-tooling changes to `evals/scripts/run-micro.py` are in scope.)
- The shaping phase is authored as a **positive recipe, not a prohibition** (the micro-loop measured prohibitions scoring below saying nothing).
- **Justification gate:** every architectural move (contract-first task, seam-split) must name a concrete independence win AND pass "would a good engineer make this move even without parallelism in mind?"; moves that fail are dropped in self-review.
- Each surviving architectural move carries a `**Parallelization rationale:** <named independence win>` line in the task body, placed **with/after the `**Interfaces:**` block — never inside the `**Type:**`/`**Depends-on:**` header marker block** (the compiler trusts only Type/Depends-on there).
- `skills/ultraplan/SKILL.md` must keep passing `skills/ultrapowers/scripts/validate_skill.py` (no new unresolved `references/...` or `scripts/...` mentions) and keep the existing anti-drift pins green (`test_ultraplan_mirrors_the_canonical_contract`, `test_ultraplan_overrides_the_execution_header_and_handoff`).
- **Eval honesty is structural:** each spec-fixture declares its true `_ground_truth_width`; `shaped` width must never exceed it (over-shoot 0), must beat `current` on latent/contract regimes, and must not widen `linear` traps.
- **Micro-loop output contract (parser ↔ instructions must match):** the produced decomposition is emitted as one line per task, exactly `Task <id>: deps=<comma-separated task ids, or none>`.
- Spec-fixtures hide scorer-only metadata behind keys prefixed `_` (e.g. `_ground_truth_width`, `_regime`); `compose_prompt` strips `_`-prefixed keys from the model-visible prompt.

**Acceptance:** suite — building ultrapowers' own planning skill + eval tooling; author and operator read every diff, and the committed pins plus the eval's structural over-shoot metric are the verification. No held-out exam applies.

---

### Task 1: Add the decomposition-shaping phase to ultraplan

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

Files-note — `skills/ultraplan/SKILL.md` (add a new section + a self-review item)
Files-note — `tests/test_ultraplan_skill.py` (add one test)

**Interfaces:**
- Consumes: none
- Produces: the shaping discipline in `skills/ultraplan/SKILL.md` — a `## Shape the decomposition (before drawing tasks)` section and a new self-review bullet. No code symbols.

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/test_ultraplan_skill.py` (the module already defines `ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"`):

```python
def test_ultraplan_shapes_decomposition_before_annotating():
    text = ULTRAPLAN.read_text()
    # The new up-front shaping phase exists...
    assert "Shape the decomposition" in text
    # ...with its load-bearing moves and the justification gate...
    assert "contract-first" in text
    assert "would a good engineer" in text
    assert "Parallelization rationale" in text
    # ...and an explicit escape valve so linear specs are not forced to widen.
    assert "no latent parallelism" in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultraplan_skill.py::test_ultraplan_shapes_decomposition_before_annotating -v`
Expected: FAIL — none of those phrases exist in the skill yet.

- [ ] **Step 3: Add the shaping section**

In `skills/ultraplan/SKILL.md`, find the line:

~~~text
## Add markers to every task
~~~

Insert the following section **immediately before** it (so shaping precedes annotation):

~~~markdown
## Shape the decomposition (before drawing tasks)

ultraplan is titled "Author Parallel-Ready Plans," but markers only *describe* a
decomposition writing-plans already drew — and writing-plans biases toward a
linear narrative, manufacturing `Depends-on` edges that are really just
reading order. Before you draw tasks, shape the decomposition to reveal the
independence the sequential pen glides over. Five moves:

1. **Map independent units.** Separate work that truly needs another unit's
   *output* from work that merely *reads* as a sequence.
2. **Front-load contracts (contract-first).** Where a consumer would wait on a
   producer, fix the shared interface up front as its own small early task that
   `Produces:` the signatures; consumers `Consume:` + `Depends-on:` it and build
   against the contract in parallel. This is the highest-leverage move, and it
   uses only the existing marker machinery.
3. **Cut along file seams.** Draw boundaries so same-wave tasks do not `Modify`
   the same file. Where genuinely-independent work collides on one file, consider
   splitting the file along its real responsibility seam.
4. **Interrogate every dependency.** For each `Depends-on` you are about to write:
   true data/interface dependency, or just the order you happened to think of it?
   Keep the real ones; drop the authoring-order ones.
5. **Right-size against overhead.** Never split below a real unit of work to
   inflate width — worktree overhead and the execution-fit recommender reward only
   genuine independent mass.

**The justification gate.** Moves 2 and 3 reshape the architecture, so each one
must (a) name a concrete independence win it produces, and (b) pass *"would a good
engineer make this move even without parallelism in mind?"*. A contract introduced
only to fan out, or a file split only to dodge a collision, fails the gate — drop
it. For every architectural move that survives the gate, add a
`**Parallelization rationale:** <named independence win>` line in that task's body,
**after the `**Interfaces:**` block** (never in the `**Type:**`/`**Depends-on:**`
header block), so the operator can audit it when reviewing the plan.

**Escape valve.** It is correct to conclude there is **no latent parallelism** in a
spec and move on — small or inherently-linear work should not be reshaped. The gate
plus this escape valve are what keep shaping from manufacturing breadth; a plan that
genuinely does not fan out should stay narrow, and the recommender will route it to
a sequential executor honestly.
~~~

- [ ] **Step 4: Add the self-review bullet**

In `skills/ultraplan/SKILL.md`, find the `## Self-review additions` list and the bullet:

~~~text
- The plan carries an **Acceptance:** line — sealed, suite, or an explicit operator waiver (see "Choosing the disposition").
~~~

Insert this bullet **immediately before** it:

~~~text
- Decomposition was shaped before annotation: every contract-first task and
  seam-split names its independence win and passes the good-engineer test, and
  each surviving architectural move carries a `**Parallelization rationale:**`
  line — or the plan is intentionally narrow because the work has no latent
  parallelism.
~~~

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_validate_skill.py::test_ultraplan_skill_validates -v`
Expected: PASS — the new test passes, and the existing pins stay green (the new section adds no `references/`/`scripts/` mentions, and does not touch the Execution Handoff section or the MARKER_SYNTAX/TYPE_SEMANTICS mirror blocks).

- [ ] **Step 6: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "feat(ultraplan): shape the decomposition before annotating"
```

---

### Task 2: Add wave-structure scorers to the micro-loop

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/scripts/run-micro.py`
- Test: `tests/test_run_micro.py`

Files-note — `evals/scripts/run-micro.py` (add helpers + two scorers; tweak `compose_prompt`)
Files-note — `tests/test_run_micro.py` (add tests)

**Interfaces:**
- Consumes: none
- Produces:
  - `_parse_markers(text: str) -> dict[str, list[str]]` — parses `Task <id>: deps=<ids|none>` lines into `{task_id: [dep_ids]}`.
  - `_max_wave_width(dag: dict[str, list[str]]) -> int` — layered (Kahn) max wave width; unknown dep ids treated as already-satisfied; cycles stop layering.
  - `SCORERS["wave_width"](output, sample) -> float` — `float(_max_wave_width(_parse_markers(output)))`.
  - `SCORERS["wave_overshoot"](output, sample) -> float` — `float(max(0, width - sample["_ground_truth_width"]))`.
  - `compose_prompt(instruction, sample)` now strips keys whose name starts with `_` from the model-visible body.

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/test_run_micro.py` (the module already imports `run_micro` via `importlib`):

```python
def test_parse_markers_reads_task_dependency_lines():
    text = "Task 1: deps=none\nTask 2: deps=1\nTask 3: deps=1, 2\nnoise line\n"
    dag = run_micro._parse_markers(text)
    assert dag == {"1": [], "2": ["1"], "3": ["1", "2"]}


def test_max_wave_width_linear_chain_is_one():
    dag = {"1": [], "2": ["1"], "3": ["2"]}
    assert run_micro._max_wave_width(dag) == 1


def test_max_wave_width_all_independent_is_n():
    dag = {"1": [], "2": [], "3": [], "4": []}
    assert run_micro._max_wave_width(dag) == 4


def test_max_wave_width_diamond():
    # 1 -> {2,3} -> 4 : widest wave is {2,3} = 2
    dag = {"1": [], "2": ["1"], "3": ["1"], "4": ["2", "3"]}
    assert run_micro._max_wave_width(dag) == 2


def test_wave_width_scorer_returns_width():
    out = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=1"
    assert run_micro.SCORERS["wave_width"](out, sample={}) == 2.0


def test_wave_overshoot_is_zero_when_within_ground_truth():
    out = "Task 1: deps=none\nTask 2: deps=none"  # width 2
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 2}) == 0.0
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 4}) == 0.0


def test_wave_overshoot_flags_manufactured_width():
    out = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=none"  # width 3
    # linear-trap ground truth is 1 → 2 units of manufactured breadth
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 1}) == 2.0


def test_compose_prompt_hides_underscore_metadata_from_model():
    prompt = run_micro.compose_prompt("Decompose:", {"spec": "do X", "_ground_truth_width": 3})
    assert "do X" in prompt
    assert "_ground_truth_width" not in prompt
    assert "3" not in prompt
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_micro.py -k "wave or parse or compose_prompt_hides" -v`
Expected: FAIL — `_parse_markers`, `_max_wave_width`, the two scorers do not exist, and `compose_prompt` still emits `_ground_truth_width`.

- [ ] **Step 3: Add the helpers and scorers**

In `evals/scripts/run-micro.py`, add `import re` near the top imports (after `import os`). Then add these functions above the `SCORERS` dict:

```python
def _parse_markers(text):
    """Parse 'Task <id>: deps=<ids|none>' lines into {id: [dep_ids]}.
    Tolerant: lines that don't match are ignored; ids are strings."""
    dag = {}
    for line in text.splitlines():
        m = re.match(r"\s*Task\s+([A-Za-z0-9]+)\s*:\s*deps\s*=\s*(.+)", line, re.I)
        if not m:
            continue
        tid = m.group(1)
        rest = m.group(2).strip()
        if rest.lower() in ("none", "-", ""):
            deps = []
        else:
            deps = [d.strip() for d in rest.split(",") if d.strip()]
        dag[tid] = deps
    return dag


def _max_wave_width(dag):
    """Layered (Kahn) max wave width of a dependency DAG. A dep id that is not
    itself a task in the dag is treated as already-satisfied. A cycle stops
    layering (width reflects what could be layered)."""
    remaining = dict(dag)
    done = set()
    width = 0
    while remaining:
        ready = [t for t, deps in remaining.items()
                 if all(d in done or d not in dag for d in deps)]
        if not ready:
            break
        width = max(width, len(ready))
        for t in ready:
            done.add(t)
            del remaining[t]
    return width


def _score_wave_width(output, sample):
    """Max wave width of the produced decomposition (efficacy; higher = wider)."""
    return float(_max_wave_width(_parse_markers(output)))


def _score_wave_overshoot(output, sample):
    """Width above the spec's honest ground truth (manufacturing; 0 = honest).
    Requires sample['_ground_truth_width']."""
    width = _max_wave_width(_parse_markers(output))
    return float(max(0, width - sample["_ground_truth_width"]))
```

Then extend the `SCORERS` dict to:

```python
SCORERS = {
    "json_object": _score_json_object,
    "nonempty": _score_nonempty,
    "wave_width": _score_wave_width,
    "wave_overshoot": _score_wave_overshoot,
}
```

- [ ] **Step 4: Hide scorer-only metadata in `compose_prompt`**

Replace the existing `compose_prompt`:

```python
def compose_prompt(instruction, sample):
    body = json.dumps(sample, sort_keys=True)
    return (instruction + "\n\n" + body) if instruction.strip() else body
```

with:

```python
def compose_prompt(instruction, sample):
    # Keys starting with "_" are scorer-only metadata (e.g. ground-truth answers)
    # and must never reach the model.
    visible = {k: v for k, v in sample.items() if not str(k).startswith("_")}
    body = json.dumps(visible, sort_keys=True)
    return (instruction + "\n\n" + body) if instruction.strip() else body
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_micro.py -v`
Expected: PASS — the new tests pass and every existing test stays green (existing samples carry no `_`-prefixed keys, so `compose_prompt`'s visible body is unchanged for them).

- [ ] **Step 6: Commit**

```bash
git add evals/scripts/run-micro.py tests/test_run_micro.py
git commit -m "feat(evals): wave_width + wave_overshoot scorers; hide scorer-only sample keys"
```

---

### Task 3: Spec-fixtures with ground-truth widths

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `evals/planning-fixtures/samples.json`
- Create: `evals/planning-fixtures/variants.json`
- Create: `evals/planning-fixtures/README.md`
- Test: `tests/test_planning_fixtures.py`

**Interfaces:**
- Consumes: `run_micro.SCORERS["wave_width"]`, `run_micro.SCORERS["wave_overshoot"]`, and the sample schema convention `sample["_ground_truth_width"]` (from Task 2).
- Produces: the planning-eval fixtures consumed by the operator-invoked micro-run.

**Parallelization rationale:** depends on Task 2 only for the scorer interface (a contract: scorer function names + the `_ground_truth_width` key + the `Task <id>: deps=<ids|none>` output format); the fixtures themselves share no file with any other task.

- [ ] **Step 1: Write the failing test**

Create `tests/test_planning_fixtures.py`:

```python
"""Validates the planning-eval fixtures and their wiring to the wave scorers.
No model calls: the scorers are pure, so we run them on recorded example
outputs to prove the fixture + scorer contract holds."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "evals" / "planning-fixtures"

_SPEC = importlib.util.spec_from_file_location(
    "run_micro", ROOT / "evals" / "scripts" / "run-micro.py")
run_micro = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(run_micro)

REGIMES = {"latent", "contract", "linear"}


def test_samples_have_spec_regime_and_positive_ground_truth():
    samples = json.loads((FIX / "samples.json").read_text())
    assert samples, "no samples"
    for s in samples:
        assert isinstance(s.get("spec"), str) and s["spec"].strip()
        assert s.get("_regime") in REGIMES
        assert isinstance(s.get("_ground_truth_width"), int) and s["_ground_truth_width"] >= 1


def test_linear_traps_have_ground_truth_width_one():
    samples = json.loads((FIX / "samples.json").read_text())
    linear = [s for s in samples if s["_regime"] == "linear"]
    assert linear, "need at least one linear trap"
    assert all(s["_ground_truth_width"] == 1 for s in linear)


def test_variants_define_current_and_shaped():
    variants = json.loads((FIX / "variants.json").read_text())
    names = {v["name"] for v in variants}
    assert {"ultraplan-current", "ultraplan-shaped"} <= names
    for v in variants:
        assert v["instruction"].strip()


def test_scorers_reward_revelation_and_flag_manufacturing():
    # A latent spec with ground-truth width 3.
    sample = {"spec": "x", "_regime": "latent", "_ground_truth_width": 3}
    narrow = "Task 1: deps=none\nTask 2: deps=1\nTask 3: deps=2"       # width 1
    revealed = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=none"  # width 3
    manufactured = ("Task 1: deps=none\nTask 2: deps=none\n"
                    "Task 3: deps=none\nTask 4: deps=none")            # width 4
    ww = run_micro.SCORERS["wave_width"]
    wo = run_micro.SCORERS["wave_overshoot"]
    assert ww(revealed, sample) > ww(narrow, sample)        # shaping widens
    assert wo(revealed, sample) == 0.0                      # honest revelation
    assert wo(manufactured, sample) == 1.0                  # over-shoot is caught
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_planning_fixtures.py -v`
Expected: FAIL — `evals/planning-fixtures/` and its files do not exist yet.

- [ ] **Step 3: Create the samples fixture**

Create `evals/planning-fixtures/samples.json`. Each sample's `spec` is shown to the model; `_regime` and `_ground_truth_width` are scorer-only (the `_` prefix hides them). Use these five:

```json
[
  {
    "_regime": "latent",
    "_ground_truth_width": 4,
    "spec": "Add a health-check endpoint to each of four independent microservices (auth, billing, search, notifications). Each service is its own module with its own tests; the endpoints share no code and no files."
  },
  {
    "_regime": "latent",
    "_ground_truth_width": 3,
    "spec": "Add a new optional field `archived: bool` to three unrelated data models (Project, Invoice, Comment), each in its own file, with a migration and tests per model. The models do not reference each other."
  },
  {
    "_regime": "contract",
    "_ground_truth_width": 3,
    "spec": "Build a JSON event bus: a publisher, and three consumers (audit log, email notifier, metrics counter) that each handle the same Event shape. Once the Event type is fixed, the publisher and the three consumers can be built independently."
  },
  {
    "_regime": "linear",
    "_ground_truth_width": 1,
    "spec": "Parse a CSV file, then validate the parsed rows against a schema, then transform valid rows into domain objects, then persist them. Each step consumes the previous step's output directly."
  },
  {
    "_regime": "linear",
    "_ground_truth_width": 1,
    "spec": "Implement a three-stage compiler pass: tokenizer, then parser that consumes the tokens, then a type-checker that consumes the parse tree. Each stage needs the prior stage's full output."
  }
]
```

- [ ] **Step 4: Create the variants fixture**

Create `evals/planning-fixtures/variants.json`. The two instructions share the exact output-format line so the `wave_width`/`wave_overshoot` parser can read both; only the `ultraplan-shaped` variant adds the shaping recipe:

```json
[
  {
    "name": "ultraplan-current",
    "instruction": "Decompose the spec in the JSON below into implementation tasks and their dependencies. Output ONLY one line per task, exactly: `Task <id>: deps=<comma-separated task ids, or none>`. No prose."
  },
  {
    "name": "ultraplan-shaped",
    "instruction": "You are shaping a decomposition to reveal genuine parallelism. Before drawing tasks: (1) separate work that truly needs another task's output from work that only reads as a sequence; (2) where a consumer would wait on a producer, define the shared interface as its own early task so consumers build against it in parallel; (3) cut tasks so independent work does not share a file; (4) for each dependency ask 'true data dependency, or just authoring order?' and keep only the real ones; (5) never split below a real unit of work just to add tasks. If the work is genuinely linear, keep it linear. Then output ONLY one line per task, exactly: `Task <id>: deps=<comma-separated task ids, or none>`. No prose."
  }
]
```

- [ ] **Step 5: Create the fixtures README**

Create `evals/planning-fixtures/README.md`:

```markdown
# Planning-eval fixtures

A *planning* eval (not execution): does ultraplan's decomposition-shaping reveal
real parallelism without manufacturing it? Rides the micro-loop
(`evals/scripts/run-micro.py`).

- `samples.json` — specs spanning three regimes. `_regime` and
  `_ground_truth_width` are scorer-only (the `_` prefix hides them from the model).
  Ground truth is the honest max wave width of the work's true dependency
  structure (`linear` traps are 1).
- `variants.json` — `ultraplan-current` (decompose only) vs `ultraplan-shaped`
  (the shaping recipe). The loop auto-injects `control-no-guidance` as the floor.

## Run (operator-invoked; spends API)

Efficacy — shaped should widen latent/contract specs:

    evals/scripts/run-micro.py --variants evals/planning-fixtures/variants.json \
        --samples evals/planning-fixtures/samples.json --scorer wave_width --n 5

Honesty — shaped mean must be 0 (no width above ground truth, anywhere):

    evals/scripts/run-micro.py --variants evals/planning-fixtures/variants.json \
        --samples evals/planning-fixtures/samples.json --scorer wave_overshoot --n 5

Validated: shaped `wave_width` mean > current on latent/contract, shaped
`wave_overshoot` mean == 0 across all samples, and shaped does not widen the
linear traps.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_planning_fixtures.py -v`
Expected: PASS — schema holds, linear traps are width 1, both variants present, and the scorers reward revelation while flagging manufacturing.

- [ ] **Step 7: Commit**

```bash
git add evals/planning-fixtures/ tests/test_planning_fixtures.py
git commit -m "feat(evals): planning-eval spec-fixtures with ground-truth widths"
```

---

### Task 4: Full-suite verification gate

**Type:** gate

**Files:**
- None (verification only; writes nothing)

The pre-merge gate runs the full Python suite from the repo root and must be green, with no regression in the existing eval-tooling or skill pins.

Suite command: `python3 -m pytest`

Expected: all tests pass — including the three added/extended this plan (`tests/test_ultraplan_skill.py::test_ultraplan_shapes_decomposition_before_annotating`, the new `wave`/`compose_prompt` cases in `tests/test_run_micro.py`, and `tests/test_planning_fixtures.py`) and the untouched pins (`tests/test_validate_skill.py`, the rest of `tests/test_ultraplan_skill.py`, `tests/test_run_micro.py`).
