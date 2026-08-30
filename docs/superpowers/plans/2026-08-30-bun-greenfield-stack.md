# Bun + TypeScript Greenfield Stack Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bun + TypeScript the standard stack for greenfield target apps — authoring defaults in ultraplan, an advisory nudge in the fleet's fitness preflight, Bun in the golden image, and an additive Bun A/B fixture — without the engine ever learning about Bun.

**Architecture:** The restriction lives in two places only: authoring guidance (a new `skills/ultraplan/references/greenfield-stack.md`, pointed to from `SKILL.md`) and the sandbox image (`fleet/RUNBOOK.md`). The engine keeps running an arbitrary `testCmd`. The fitness preflight gains an *advisory* channel that never changes its `fit` verdict — it is not, and must not become, a second gate. The A/B fixture is added alongside the existing fixtures, never converting them.

**Tech Stack:** Markdown (authoring docs), JavaScript ESM (fleet modules), Python 3 (pytest pins), and — inside the new fixture only — Bun + TypeScript.

**Spec:** Issue #425 (operator commitment 2026-08-29), sequenced after run-26 per the single-novelty rule; the A/B fixture lands only now that the rig from #402 item 6 exists.

## Global Constraints

- **The canonical greenfield knobs are exactly these two strings**, used verbatim everywhere they appear: `bunx tsc --noEmit && bun test` (testCmd) and `bun install` (bootstrapCmd). Note the deviation from #425's prose, which wrote bare `tsc`: bare `tsc` requires a global TypeScript install, while `bunx tsc` resolves the project's own devDependency, which is what makes a fresh clone bootstrap with nothing but Bun present. Verified 2026-08-30: the combined command exits 2 on a type error and 0 when clean.
- **The engine stays stack-agnostic.** No file under `fleet/` other than `fitness.mjs` (advisory text) and `RUNBOOK.md` (image build) may name Bun, and neither may change how a run executes.
- `skills/ultraplan/SKILL.md` is at its pinned word ceiling of 3038 (`tests/test_skill_budget.py`). Any edit to it must be **net-zero or negative** in words; the ceiling may not be raised outside a release commit.
- `evals/fixtures/*` are read-only baselines: the new fixture is added beside them; no existing fixture may be edited or converted.
- TypeScript type definitions for Bun come from the `@types/bun` devDependency with `"types": ["bun"]` in tsconfig. The older `bun-types` name fails with `TS2688: Cannot find type definition file`.
- Fleet `.mjs` tests print the sentinel `ALL TESTS PASSED` on success (they are bridged into pytest by `tests/test_fleet_suite.py`).

**Acceptance:** suite — the committed pytest suite (including the four new pins) plus per-task review is the verification; the operator actions in Task 6 are the live-only remainder.

---

### Task 1: Greenfield authoring defaults

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultraplan/references/greenfield-stack.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_greenfield_stack.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the two canonical knob strings as authored text — `bunx tsc --noEmit && bun test` and `bun install` — plus the reference path `references/greenfield-stack.md`. Tasks 2 and 4 reproduce these strings verbatim.

**Parallelization rationale:** this task fixes the shared vocabulary (the two knob strings) that the nudge text and the fixture both quote; settling it first as its own small task is what lets Tasks 2 and 4 be written against a contract instead of against each other. A good engineer would write the defaults down before wiring anything to them, parallelism or not.

**Shrink budget:** the `SKILL.md` edit must be **net delta ≤ 0 words** — the pointer sentence added must be paid for by trimming at least as many words elsewhere in the same file. Verify at task end as word-count(after) − word-count(before) over this task's own diff.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_greenfield_stack.py
"""Pin: the greenfield stack defaults exist as authoring guidance, SKILL.md
points at them, and the two canonical knob strings are stated verbatim (#425).
The strings are quoted by fleet/fitness.mjs's nudge and by the Bun eval
fixture; this is the one place they are defined."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REF = ROOT / "skills/ultraplan/references/greenfield-stack.md"
SKILL = ROOT / "skills/ultraplan/SKILL.md"

TEST_CMD = "bunx tsc --noEmit && bun test"
BOOTSTRAP_CMD = "bun install"


def test_reference_exists_and_states_the_canonical_knobs():
    assert REF.is_file()
    text = REF.read_text()
    assert TEST_CMD in text
    assert BOOTSTRAP_CMD in text
    # bare `tsc` needs a global install; the deviation from #425's prose is
    # deliberate and must stay documented where an author will see it.
    assert "bunx" in text
    # the engine boundary is the point of the whole restriction
    assert "engine" in text.lower()


def test_skill_points_at_the_reference():
    assert "references/greenfield-stack.md" in SKILL.read_text()


def test_skill_stays_within_its_pinned_ceiling():
    # the absolute lives in tests/test_skill_budget.py; this asserts the
    # net-zero obligation was honored rather than the ceiling raised.
    assert len(SKILL.read_text().split()) <= 3038


def test_types_gotcha_is_recorded():
    # @types/bun + "types": ["bun"]; `bun-types` fails TS2688. An author who
    # hits this loses an hour, so the reference must name it.
    text = REF.read_text()
    assert "@types/bun" in text
```

- [ ] **Step 2: Run it, confirm it fails** — `python3 -m pytest tests/test_greenfield_stack.py -q`, expected FAIL (the reference file does not exist).

- [ ] **Step 3: Write `skills/ultraplan/references/greenfield-stack.md`**

Content requirements (prose is yours; these points are mandatory):
- **When it applies:** greenfield target apps — a new codebase the plan creates. Never a restriction on existing repos, and never on ultrapowers' own suite (pytest) or the fleet driver (Node, whose spawn/SIGTERM semantics are measured there).
- **The two knobs, verbatim:** `**testCmd:** bunx tsc --noEmit && bun test` and `**bootstrapCmd:** bun install`, with the note that bare `tsc` needs a global install while `bunx` resolves the project's devDependency — which is what keeps a fresh clone's bootstrap to one `bun install`.
- **Why it earns the restriction:** `Consumes`/`Produces` stop being prose a reviewer must eyeball — `tsc --noEmit` on the integrated tree catches cross-task interface drift deterministically, which is the characteristic parallel-implementation failure. `bun test` is fast enough that every implementer iteration can afford the whole suite.
- **The tsconfig gotcha:** devDependency `@types/bun`, `"compilerOptions": { "types": ["bun"] }`. `bun-types` fails with `TS2688: Cannot find type definition file for 'bun-types'`.
- **The engine boundary:** ultrapowers' engine runs whatever `testCmd` it is handed and knows nothing about Bun. This page is authoring guidance; it never changes execution.
- **The baseline rule for any Bun fixture or greenfield plan run on the fleet:** the project tree must be green at BASE. A tree whose tests do not exist yet cannot pass knob validation, so a greenfield plan run through `/ultrapowers` must start from a seeded, passing skeleton — see Task 4's fixture for the shape.

- [ ] **Step 4: Add the pointer to `skills/ultraplan/SKILL.md`, net-zero**

Add one sentence in the authoring-rules area naming the reference — for example, after the "Name only what exists" rule:

```markdown
- **Greenfield targets take the Bun + TypeScript defaults** — knobs and rationale in `references/greenfield-stack.md` (#425).
```

Then pay for it: trim at least as many words from the same file without losing a rule. Re-run `python3 -m pytest tests/test_skill_budget.py -q` and confirm green.

- [ ] **Step 5: Run the tests, confirm they pass** — `python3 -m pytest tests/test_greenfield_stack.py tests/test_skill_budget.py -q`

- [ ] **Step 6: Commit**

```bash
git add skills/ultraplan/references/greenfield-stack.md skills/ultraplan/SKILL.md tests/test_greenfield_stack.py
git commit -m "feat(#425): Bun+TypeScript greenfield authoring defaults"
```

---

### Task 2: Fitness preflight nudge (advisory, never refuses)

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `fleet/fitness.mjs`
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_fitness.mjs`

**Interfaces:**
- Consumes: the canonical knob strings from Task 1 (`bunx tsc --noEmit && bun test`), quoted verbatim in the advisory text.
- Produces: `assessHeadlessFitness(planText) -> { fit, findings, notes }` — `notes` is a (possibly empty) array of `{ task, note }`. **`fit` is computed from `findings` alone; `notes` can never change it.**

**Parallelization rationale:** none — this task exists on its own because it edits fleet modules that nothing else in the plan touches; it is listed after Task 1 purely because it quotes Task 1's strings.

- [ ] **Step 1: Write the failing tests** (append to `fleet/tests/test_fitness.mjs`, before its final sentinel print)

```javascript
// #425: a TypeScript plan whose gate never typechecks gets a NUDGE — the
// whole value of the stack is tsc catching cross-task interface drift, and a
// plan that skips it silently gives that up. Advisory only: `fit` must not
// move, because fitness is not a second gate.
{
  const plan = [
    '# P', '',
    '### Task 1: Add the parser',
    '**Type:** implementation',
    '**Depends-on:** none', '',
    '**Files:**',
    '- Create: `src/parse.ts`',
    '- Test: `tests/parse.test.ts`', '',
    '- [ ] **Step 1: do**', '',
    '### Task 2: Suite',
    '**Type:** gate',
    '**Depends-on:** 1', '',
    '**Files:**',
    '- Test: `tests/parse.test.ts`', '',
    'Run: `bun test`',
  ].join('\n')
  const result = assessHeadlessFitness(plan)
  assert.equal(result.fit, true, 'a nudge must never make a plan unfit')
  assert.equal(result.findings.length, 0, 'a nudge is not a finding')
  assert.equal(result.notes.length, 1, `expected one note, got ${JSON.stringify(result.notes)}`)
  assert.match(result.notes[0].note, /bunx tsc --noEmit && bun test/,
    'the note must quote the canonical testCmd verbatim')
}

// A TypeScript plan whose gate DOES typecheck earns no note.
{
  const plan = [
    '# P', '',
    '### Task 1: Add the parser',
    '**Type:** implementation',
    '**Depends-on:** none', '',
    '**Files:**',
    '- Create: `src/parse.ts`',
    '- Test: `tests/parse.test.ts`', '',
    '- [ ] **Step 1: do**', '',
    '### Task 2: Suite',
    '**Type:** gate',
    '**Depends-on:** 1', '',
    '**Files:**',
    '- Test: `tests/parse.test.ts`', '',
    'Run: `bunx tsc --noEmit && bun test`',
  ].join('\n')
  const result = assessHeadlessFitness(plan)
  assert.equal(result.notes.length, 0, 'a typechecked gate needs no nudge')
}

// A plan with no TypeScript files is none of this task's business.
{
  const plan = [
    '# P', '',
    '### Task 1: Add the parser',
    '**Type:** implementation',
    '**Depends-on:** none', '',
    '**Files:**',
    '- Create: `src/parse.py`',
    '- Test: `tests/test_parse.py`', '',
    '- [ ] **Step 1: do**',
  ].join('\n')
  const result = assessHeadlessFitness(plan)
  assert.equal(result.notes.length, 0, 'a Python plan must never be nudged about tsc')
}

// The unfit doc-task class still reports findings AND still carries a notes
// array — shape stability for drive.mjs, which reads both.
{
  const plan = [
    '# P', '',
    '### Task 1: Write the note',
    '**Type:** implementation',
    '**Depends-on:** none', '',
    '**Files:**',
    '- Create: `docs/note.md`', '',
    '- [ ] **Step 1: do**',
  ].join('\n')
  const result = assessHeadlessFitness(plan)
  assert.equal(result.fit, false)
  assert.ok(Array.isArray(result.notes), 'notes must always be an array')
}
```

- [ ] **Step 2: Run it, confirm it fails** — `node fleet/tests/test_fitness.mjs`, expected a failed assertion on `result.notes` being undefined.

- [ ] **Step 3: Implement the nudge in `fleet/fitness.mjs`**

Add a `.ts`/`.tsx` detector and a gate-command reader, then collect notes separately from findings:

```javascript
// #425: TypeScript's value here is `tsc --noEmit` catching cross-task
// interface drift — the characteristic parallel-implementation failure. A
// plan that writes .ts files but never typechecks in its gate has given that
// up, probably without meaning to. Say so; never refuse. This module is not a
// second gate (see the header), and a nudge that could block would make it
// one.
const TS_FILE_RE = /\.tsx?`/
const TYPECHECK_RE = /tsc\s+--noEmit/
const GREENFIELD_TEST_CMD = 'bunx tsc --noEmit && bun test'
```

Rules the implementation must satisfy:
- A note is emitted **once per plan** (attach it to the first `implementation` task whose `Files:` entries include a `.ts`/`.tsx` path), not once per task.
- No note if any `gate`-typed task's body matches `TYPECHECK_RE`, and no note if the plan has no TypeScript file entries at all.
- The note text must quote `GREENFIELD_TEST_CMD` verbatim and say it is advisory.
- `fit` stays `findings.length === 0` — do not fold `notes` into it.
- Return `notes` unconditionally (an empty array when there is nothing to say), so callers never branch on `undefined`.

- [ ] **Step 4: Surface the notes in `fleet/drive.mjs`**

At the existing fitness call site (~line 499), after the `fit` handling, push each note onto the driver's `errors` array — the channel that renders as "Driver notes" in the report — prefixed so its advisory nature is unmistakable, e.g. `errors.push(\`headless-fitness note (advisory): ${n.task}: ${n.note}\`)`. **Do not** add any new throw: a note must never stop a drive, including when `allowUnfitPlan` is false.

- [ ] **Step 5: Run the tests, confirm they pass** — `node fleet/tests/test_fitness.mjs` prints `ALL TESTS PASSED`; then `python3 -m pytest tests/test_fleet_suite.py -q`.

- [ ] **Step 6: Commit**

```bash
git add fleet/fitness.mjs fleet/drive.mjs fleet/tests/test_fitness.mjs
git commit -m "feat(#425): fitness nudges TypeScript plans that skip the typecheck"
```

---

### Task 3: Golden image ships Bun

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_runbook_bun.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_runbook_bun.py
"""Pin: the golden VM build installs Bun and verifies it (#425). The image is
hand-built from RUNBOOK steps, so the RUNBOOK is the only executable record —
a missing line here is a sandbox that cannot run a Bun target."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = (ROOT / "fleet/RUNBOOK.md").read_text()


def test_runbook_installs_bun_in_the_golden_build():
    assert "bun.sh/install" in RUNBOOK or "install bun" in RUNBOOK.lower()


def test_runbook_verifies_the_install():
    assert "bun --version" in RUNBOOK


def test_runbook_says_bun_is_for_targets_not_the_driver():
    # the driver stays on Node — spawn/SIGTERM semantics are measured there
    lowered = RUNBOOK.lower()
    assert "driver" in lowered and "node" in lowered
```

- [ ] **Step 2: Run it, confirm it fails** — `python3 -m pytest tests/test_runbook_bun.py -q`

- [ ] **Step 3: Add the Bun step to the golden VM build section of `fleet/RUNBOOK.md`**

Place it beside the existing `pytest` install line, in the same `ssh fleet-golden.exe.xyz '…'` style:

```bash
# Bun for greenfield TypeScript targets (#425). One static binary; the target's
# own `bun install` then needs no network beyond the registry. The fleet DRIVER
# stays on node — its spawn/SIGTERM semantics are the measured ones.
ssh fleet-golden.exe.xyz 'curl -fsSL https://bun.sh/install | bash'
ssh fleet-golden.exe.xyz 'export PATH="$HOME/.bun/bin:$PATH" && bun --version'
```

Also note in that section that `~/.bun/bin` must be on the PATH the workers inherit, since a target's `testCmd` runs through `bash -lc`.

- [ ] **Step 4: Run the tests, confirm they pass**

- [ ] **Step 5: Commit**

```bash
git add fleet/RUNBOOK.md tests/test_runbook_bun.py
git commit -m "feat(#425): golden image ships Bun for greenfield targets"
```

---

### Task 4: Bun A/B fixture (additive)

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `evals/fixtures/bun-greenfield/plan.md`
- Create: `evals/fixtures/bun-greenfield/project/package.json`
- Create: `evals/fixtures/bun-greenfield/project/tsconfig.json`
- Create: `evals/fixtures/bun-greenfield/project/src/registry.ts`
- Create: `evals/fixtures/bun-greenfield/project/tests/registry.test.ts`
- Test: `tests/test_bun_fixture.py`

**Interfaces:**
- Consumes: the canonical knob strings from Task 1 — the fixture plan's gate task states `bunx tsc --noEmit && bun test`.
- Produces: the fixture name `bun-greenfield`, runnable as `python3 evals/ab_runner.py bun-greenfield --overlap fold|serialize --test-cmd 'bunx tsc --noEmit && bun test' --bootstrap-cmd 'bun install'`.

**Parallelization rationale:** none beyond quoting Task 1 — it is an independent tree of new files that no other task touches.

**The baseline rule this fixture must satisfy (learned 2026-08-30):** the `webapp` fixture can never be an A/B cell because its project has no tests at BASE, so knob validation refuses in 0.3s — a greenfield plan whose tests do not exist yet has no green baseline. This fixture therefore ships a **seeded, passing skeleton**: one module, one passing test, a clean typecheck. The plan then *adds* to it, with same-file contention so both arms have something to differ about.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_bun_fixture.py
"""Pin: the Bun A/B fixture is additive, compiles, and — the webapp lesson —
is GREEN AT BASE so knob validation can pass. Existing fixtures are untouched
baselines; this one joins them as a new cell (#425, #402)."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FX = ROOT / "evals/fixtures/bun-greenfield"
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
TEST_CMD = "bunx tsc --noEmit && bun test"


def test_fixture_has_the_standard_layout():
    assert (FX / "plan.md").is_file()
    assert (FX / "project" / "package.json").is_file()


def test_project_is_green_at_base_by_construction():
    """A greenfield tree with no tests cannot pass knob validation (webapp).
    This fixture seeds a passing test and a typecheckable module."""
    tests = list((FX / "project" / "tests").glob("*.test.ts"))
    assert tests, "the seeded skeleton must ship at least one passing test"
    srcs = list((FX / "project" / "src").glob("*.ts"))
    assert srcs, "the seeded skeleton must ship at least one module to typecheck"


def test_tsconfig_uses_the_working_types_package():
    cfg = (FX / "project" / "tsconfig.json").read_text()
    assert '"bun"' in cfg          # `bun-types` fails TS2688
    pkg = json.loads((FX / "project" / "package.json").read_text())
    assert "@types/bun" in pkg.get("devDependencies", {})


def test_plan_compiles_and_states_the_canonical_gate():
    result = subprocess.run([sys.executable, str(COMPILER), "--check",
                             str(FX / "plan.md")], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert TEST_CMD in (FX / "plan.md").read_text()


def test_plan_has_contention_for_the_ab_arms():
    """The A/B dimension needs same-file concurrent writers; without them both
    arms compile to the same shape and the cell measures only latency."""
    text = (FX / "plan.md").read_text()
    assert text.count("src/registry.ts") >= 2


def test_existing_fixtures_are_untouched():
    for name in ("wide", "chained", "contend", "contend-big", "contend-prod", "mixed"):
        assert (ROOT / "evals/fixtures" / name / "plan.md").is_file()
```

- [ ] **Step 2: Run it, confirm it fails** — `python3 -m pytest tests/test_bun_fixture.py -q`

- [ ] **Step 3: Write the seeded project skeleton**

`project/package.json` — private, ESM, with the Bun types devDependency:

```json
{
  "name": "bun-greenfield-fixture",
  "private": true,
  "type": "module",
  "devDependencies": { "typescript": "^5.6.0", "@types/bun": "latest" }
}
```

`project/tsconfig.json` — strict, no emit, Bun types (verified working 2026-08-30):

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"]
  },
  "include": ["src", "tests"]
}
```

`project/src/registry.ts` — a small keyed registry the plan's tasks will each extend, with an explicit exported type so cross-task drift is a *type* error:

```typescript
export type Entry = { readonly id: string; readonly label: string }

const entries = new Map<string, Entry>()

export const register = (entry: Entry): void => { entries.set(entry.id, entry) }
export const lookup = (id: string): Entry | undefined => entries.get(id)
export const size = (): number => entries.size
```

`project/tests/registry.test.ts` — the seed test that makes BASE green:

```typescript
import { expect, test } from "bun:test"
import { register, lookup, size } from "../src/registry"

test("registers and looks up an entry", () => {
  register({ id: "a", label: "Alpha" })
  expect(lookup("a")?.label).toBe("Alpha")
  expect(size()).toBe(1)
})
```

- [ ] **Step 4: Write `evals/fixtures/bun-greenfield/plan.md`**

A marked plan in the same shape as `evals/fixtures/contend/plan.md`, with:
- header, `**Acceptance:** suite — the committed Bun suite is the verification`, Goal, and a **Tech Stack** line naming `bunx tsc --noEmit && bun test` and `bun install` verbatim;
- **three `implementation` tasks, none with `Depends-on`**, each adding one exported helper to `src/registry.ts` **and** its own `tests/<name>.test.ts` — so all three genuinely write the same file (the contention the A/B arms differ on) while their tests stay separate;
- each task's helper must have an explicit TypeScript signature in its body (e.g. `export const byLabel = (label: string): Entry | undefined`), so `tsc --noEmit` on the merged tree is what catches a task that drifts from the shared `Entry` type;
- a `gate`-typed final task whose body states `Run: bunx tsc --noEmit && bun test`.

Validate with `python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/bun-greenfield/plan.md` — must print `PLAN OK`.

- [ ] **Step 5: Verify the skeleton is actually green** (this is the whole point of the seeding rule)

```bash
cd evals/fixtures/bun-greenfield/project && export PATH="$HOME/.bun/bin:$PATH" && bun install && bunx tsc --noEmit && bun test
```

Expected: install succeeds, typecheck silent, one test passes. Then remove any `node_modules`/lockfile the check created if they are not intended to be committed (check `.gitignore` first; fixtures ship source only).

- [ ] **Step 6: Run the tests, confirm they pass** — `python3 -m pytest tests/test_bun_fixture.py -q`

- [ ] **Step 7: Commit**

```bash
git add evals/fixtures/bun-greenfield tests/test_bun_fixture.py
git commit -m "feat(#425): additive Bun greenfield A/B fixture, green at BASE"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/test_greenfield_stack.py`, `fleet/tests/test_fitness.mjs`, `tests/test_runbook_bun.py`, `tests/test_bun_fixture.py`

Run: `python3 -m pytest -q` — the whole committed suite green, including the four new pins and the unchanged skill-budget ceiling.

---

### Task 6: Operator actions — golden rebuild and the first Bun cell

**Type:** manual
**Depends-on:** 5

**Files:**
- Test: `evals/results/runs.jsonl`

Two operator steps, in order, neither runnable from a sandbox:

1. **Rebuild the golden image** following `fleet/RUNBOOK.md` §Golden VM build, which now installs Bun. This is also the moment the xdist install (#426) reaches sandboxes — and therefore the moment **#436 must already be resolved** (the engine's unbounded `sh(testCmd)` and the WIDTH×cpu_count oversubscription both go live with parallel pytest in-sandbox).
2. **Run the first Bun A/B pair** on the laptop, one at a time:

```bash
python3 evals/ab_runner.py bun-greenfield --overlap fold \
  --test-cmd 'bunx tsc --noEmit && bun test' --bootstrap-cmd 'bun install'
python3 evals/ab_runner.py bun-greenfield --overlap serialize \
  --test-cmd 'bunx tsc --noEmit && bun test' --bootstrap-cmd 'bun install'
```

Each appends a row to `evals/results/runs.jsonl`. These are **additive cells**: they extend the A/B set with a Bun data point and never replace the 2026-08-30 baseline rows.

---

## Operator smoke

- do: open `skills/ultraplan/references/greenfield-stack.md` and read the two knob lines.
- see: `bunx tsc --noEmit && bun test` and `bun install`, with the note that bare `tsc` needs a global install.
- do: `cd evals/fixtures/bun-greenfield/project && export PATH="$HOME/.bun/bin:$PATH" && bun install && bunx tsc --noEmit && bun test`
- see: install completes, typecheck prints nothing, one test passes — the fixture is green at BASE, so knob validation will not refuse it the way `webapp` was refused.
- do: introduce a deliberate type error (`echo 'export const bad: number = "x"' > src/bad.ts`), then re-run `bunx tsc --noEmit && bun test`; delete the file afterward.
- see: a `TS2322` error and a non-zero exit — proof the typecheck actually gates the suite command, which is the entire premise of the stack choice.
- do: `python3 evals/ab_runner.py bun-greenfield --overlap fold --test-cmd 'bunx tsc --noEmit && bun test' --bootstrap-cmd 'bun install'`
- see: a JSON row printed with a non-zero `outputTokens` and a `waveShape` of one wave (the three contending tasks folded together).
