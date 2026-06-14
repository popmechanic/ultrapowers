# Interop Hardening Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — engine interop change; verified by the committed compat/sim suite, not a held-out exam.

**Goal:** Close every finding from the 2026-06-10 review — the two P1 engine bugs, the three superpowers-interop frictions, the doc drift — and the three structural gaps (no upstream version coupling, LLM-only compilation, no engine preflight), then release 0.4.0.

**Architecture:** Three workstreams. (1) **Determinism:** a real compiler (`skills/ultrapowers/scripts/compile_plan.py`) mechanically parses marked plans into the transparency block — fence-aware splitting, marker/heuristic classification, DAG + Kahn waves — so LLM judgment shrinks to heuristic-flagged entries and run knobs. (2) **Engine hardening:** `workflow.js` gains failure containment (a thrown `agent()` call degrades to a failed task/CONFLICT merge instead of killing the run), dependency-aware cascade blocking via a new `args.edges`, worktree cleanup in the merge prompt, and small validations; every prompt change re-bakes through the existing BAKE/drift-test machinery. (3) **Interop truthing:** docs stop overclaiming (blockedWaves in the report contract, review-topology divergence stated honestly, executor-variance semantics for gate/release), the finishing-a-development-branch handoff is sequenced correctly, ultraplan amends the plan header that steers executors away from us, and new compat tests + an attestation + an engine probe detect drift in both substrates we depend on.

**Tech Stack:** Plain JavaScript (Workflow engine dialect) for workflow.js/probe.js, Python 3.11 + pytest (stdlib only) for the compiler and tests, node for the sim harness, markdown skill docs.

---

### Task 1: Deterministic plan compiler

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/compile_plan.py`
- Create: `tests/fixtures/unmarked-plan.md`
- Create: `tests/test_compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md` (wire the compiler in; add `derived_knobs` to the transparency block; soften the final-report claim)
- Modify: `tests/test_marker_compiler.py` (append three assertions)

Context: today the orchestrating agent derives waves by following prose — nondeterministic. Marked plans are mechanically parseable; this task makes them compile deterministically. The existing fixture `tests/fixtures/marked-plan.md` (5 tasks: 1,2 independent; 3 depends on 1; 4 is `gate`; 5 is `release`; task 2 has no `**Type:**` on purpose) becomes a real executable test.

- [ ] **Step 1: Write the failing tests.** Create `tests/test_compile_plan.py`:

```python
"""compile_plan.py turns a marked plan into the Step-3 transparency block,
deterministically. The marked fixture's documented expectations (waves
[[1,2],[3]], 4 -> gate config, 5 -> runbook) finally execute."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"


def compile_plan(path):
    p = subprocess.run([sys.executable, str(COMPILER), str(path)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_marked_fixture_compiles_to_documented_waves():
    out = compile_plan(ROOT / "tests/fixtures/marked-plan.md")
    assert out["waves"] == [["1", "2"], ["3"]]
    assert out["post_merge_runbook"] == ["5"]
    assert out["gates"] == ["4"]
    assert {"from": "1", "to": "3", "why": "marker"} in out["dag_edges"]
    assert out["marker_conflicts"] == []
    assert out["mode"] == "parallel"
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["2"]["disposition"] == "implementation"
    assert by_id["2"]["heuristic"] is True      # no Type: marker -> default, flagged
    assert by_id["1"]["heuristic"] is False     # explicit marker -> trusted


def test_unmarked_fixture_heuristics_and_conflict():
    out = compile_plan(ROOT / "tests/fixtures/unmarked-plan.md")
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["3"]["disposition"] == "release"   # git push step, no marker
    assert by_id["3"]["heuristic"] is True
    assert by_id["4"]["disposition"] == "gate"      # Files: none + pytest only
    # Task 5 says Depends-on: none but modifies a.txt created by Task 1:
    # the file edge wins and the disagreement is surfaced.
    assert {"from": "1", "to": "5", "why": "write-after-create"} in out["dag_edges"]
    assert any(c["task"] == "5" for c in out["marker_conflicts"])
    # The fenced "### Task 99:" inside Task 1's body is content, not a task.
    assert len(out["tasks"]) == 5
    # write-after-write: 2 and 5 both modify a.txt -> document order serializes
    assert {"from": "2", "to": "5", "why": "write-after-write"} in out["dag_edges"]


def test_cycle_is_a_loud_error(tmp_path):
    plan = tmp_path / "cyclic.md"
    plan.write_text(
        "# Plan: Cycle\n\n"
        "### Task A: first\n\n**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** write a\n\n"
        "### Task B: second\n\n**Type:** implementation\n**Depends-on:** A\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** write b\n"
    )
    p = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                       capture_output=True, text=True)
    assert p.returncode == 1
    assert "cycle" in p.stderr.lower()
    assert "A" in p.stderr and "B" in p.stderr


def test_small_plan_degrades_to_sequential(tmp_path):
    plan = tmp_path / "tiny.md"
    plan.write_text(
        "# Plan: Tiny\n\n"
        "### Task 1: only\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** write a\n"
    )
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert out["waves"] == [["1"]]
    assert out["degrade_reason"]
```

- [ ] **Step 2: Create the heuristics fixture** `tests/fixtures/unmarked-plan.md`:

````markdown
# Plan: Unmarked Fixture

> Exercises the classification heuristics, the marker-conflict path, and
> fence-aware splitting. Only Task 5 carries a marker — a deliberately wrong
> `Depends-on: none` that the file edge must override.

---

### Task 1: Create alpha

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to `a.txt`. The plan format embeds examples:

```markdown
### Task 99: this heading is fenced content, not a task
```

### Task 2: Edit alpha

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Append `beta` to `a.txt`.

### Task 3: Publish

**Files:**
- Modify: `plugin.json`

- [ ] **Step 1:** Bump the version, commit, and `git push origin main`.

### Task 4: Suite gate

**Files:** none (verification only)

- [ ] **Step 1:** Run: `pytest -q` — expect all green.

### Task 5: Rewrite alpha

**Depends-on:** none

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Replace the contents of `a.txt` with `gamma`.
````

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -v`
Expected: all 4 FAIL (`compile_plan.py` does not exist)

- [ ] **Step 4: Implement the compiler.** Create `skills/ultrapowers/scripts/compile_plan.py`:

```python
#!/usr/bin/env python3
"""Deterministic compiler for Superpowers plans carrying ultraplan markers.

Parses a plan into tasks (fence-aware), classifies each per the plan-markers
contract (explicit **Type:** trusted; heuristics otherwise, flagged
"heuristic": true), builds the dependency DAG (marker edges + file-overlap
inference + explicit text), runs Kahn layering with cycle detection, and
emits the Step-3 transparency block as JSON on stdout.

The orchestrating agent runs this instead of hand-deriving waves; its
judgment is reserved for heuristic-flagged classifications and the derived
run knobs (testCmd / baseBranch / tiers / review depth), which stay with
the agent per dependency-analysis.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TASK_HEAD = re.compile(r"^### Task ([A-Za-z0-9]+):\s*(.*)$")
FENCE = re.compile(r"^(`{3,})")
MARKER_TYPE = re.compile(r"^\*\*Type:\*\*\s*([a-z]+)\s*$")
MARKER_DEPS = re.compile(r"^\*\*Depends-on:\*\*\s*(.+?)\s*$")
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Test):\s*(.+)$")
PATH_RE = re.compile(r"`([^`]+)`")
TEXT_DEP = re.compile(r"(?:depends on|after|requires)\s+Task\s+([A-Za-z0-9]+)", re.I)

TYPES = ("implementation", "gate", "release", "manual")
RELEASE_EV = re.compile(
    r"(git push|git checkout main|git merge (?:main|master)\b|\bssh\b|\bscp\b"
    r"|systemctl|after the branch merges)", re.I)
MANUAL_EV = re.compile(
    r"(the owner runs|cannot be done from this machine|on the deployment)", re.I)
GATE_EV = re.compile(
    r"(pytest|npm test|bun test|cargo test|go test|ruff|eslint|git status|git log)", re.I)


def _fence_aware_lines(text):
    """Yield (line, in_fence) — a heading inside an open fence is content."""
    fence = None
    for line in text.splitlines():
        m = FENCE.match(line.strip())
        if m:
            tick = m.group(1)
            if fence is None:
                fence = tick
            elif len(tick) >= len(fence):
                fence = None
            yield line, True
            continue
        yield line, fence is not None


def split_tasks(text):
    lines = list(_fence_aware_lines(text))
    heads = []
    for i, (line, fenced) in enumerate(lines):
        if fenced:
            continue
        h = TASK_HEAD.match(line)
        if h:
            heads.append((h.group(1), h.group(2).strip(), i))
    tasks = []
    for n, (tid, title, start) in enumerate(heads):
        end = heads[n + 1][2] if n + 1 < len(heads) else len(lines)
        body = "\n".join(l for l, _ in lines[start:end]).strip()
        tasks.append({"id": tid, "title": title, "body": body, "order": n})
    return tasks


def parse_task(t):
    ttype = None
    deps, deps_none = [], False
    creates, modifies = [], []
    in_files = False
    for line, fenced in _fence_aware_lines(t["body"]):
        if fenced:
            continue
        s = line.strip()
        m = MARKER_TYPE.match(s)
        if m and ttype is None and m.group(1) in TYPES:
            ttype = m.group(1)
        m = MARKER_DEPS.match(s)
        if m and not deps and not deps_none:
            val = m.group(1).strip()
            if val.lower() == "none":
                deps_none = True
            else:
                deps = [d.strip() for d in val.split(",") if d.strip()]
        if s.startswith("**Files:**"):
            in_files = True
            continue
        if in_files:
            f = FILE_LINE.match(s)
            if f:
                paths = PATH_RE.findall(f.group(2)) or [f.group(2).strip()]
                paths = [p.split(":")[0] for p in paths]  # drop :line-range
                if f.group(1) == "Create":
                    creates.extend(paths)
                elif f.group(1) == "Modify":
                    modifies.extend(paths)
            elif s and not s.startswith("-"):
                in_files = False
    t.update(marker_type=ttype, depends_on=deps, depends_none=deps_none,
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             writes=sorted(set(creates) | set(modifies)))
    return t


def classify(t):
    """Returns (disposition, heuristic). Explicit marker wins; else evidence
    in plan-markers.md precedence: release -> manual -> gate -> implementation."""
    if t["marker_type"]:
        return t["marker_type"], False
    body = t["body"]
    if RELEASE_EV.search(body):
        return "release", True
    if MANUAL_EV.search(body):
        return "manual", True
    if not t["writes"] and GATE_EV.search(body):
        return "gate", True
    return "implementation", True


def build_edges(impl):
    ids = {t["id"] for t in impl}
    edges, conflicts, seen = [], [], set()

    def add(a, b, why):
        if a in ids and b in ids and a != b and (a, b) not in seen:
            seen.add((a, b))
            edges.append({"from": a, "to": b, "why": why})
            target = next(t for t in impl if t["id"] == b)
            if target["depends_none"] and why != "marker":
                conflicts.append({
                    "task": b,
                    "edge": f"{a} -> {b} ({why})",
                    "note": "Depends-on: none overridden by inferred edge (file edge wins)",
                })

    for t in impl:
        for d in t["depends_on"]:
            add(d, t["id"], "marker")
    for a in impl:
        for b in impl:
            if a["id"] == b["id"]:
                continue
            if set(a["creates"]) & set(b["modifies"]):
                add(a["id"], b["id"], "write-after-create")
            if set(a["writes"]) & set(b["writes"]) and a["order"] < b["order"]:
                add(a["id"], b["id"], "write-after-write")
    for b in impl:
        for m in TEXT_DEP.finditer(b["body"]):
            if m.group(1) != b["id"]:
                add(m.group(1), b["id"], "text")
    return edges, conflicts


def layer(impl, edges):
    order = [t["id"] for t in impl]
    indeg = {i: 0 for i in order}
    succ = {i: [] for i in order}
    for e in edges:
        succ[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    waves, done = [], set()
    ready = [i for i in order if indeg[i] == 0]
    while ready:
        waves.append(sorted(ready, key=order.index))
        nxt = []
        for r in ready:
            done.add(r)
            for s in succ[r]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    nxt.append(s)
        ready = nxt
    if len(done) != len(order):
        members = [i for i in order if i not in done]
        print(f"compile_plan: cycle detected among tasks {', '.join(members)} — "
              "revise the plan to break it; refusing to guess an ordering.",
              file=sys.stderr)
        raise SystemExit(1)
    return waves


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    args = ap.parse_args(argv)
    tasks = [parse_task(t) for t in split_tasks(args.plan.read_text())]
    if not tasks:
        print("compile_plan: no '### Task N:' headings found.", file=sys.stderr)
        raise SystemExit(1)

    out_tasks = []
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"] = disp
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"]})

    impl = [t for t in tasks if t["disposition"] == "implementation"]
    edges, conflicts = build_edges(impl)
    waves = layer(impl, edges)

    mode, degrade = "parallel", None
    fully_overlapping = (len(impl) > 1 and all(
        set(a["writes"]) & set(b["writes"])
        for a in impl for b in impl if a["id"] != b["id"]))
    if len(impl) <= 2 or fully_overlapping:
        mode = "sequential"
        degrade = f"Sequential mode: {len(impl)} implementation tasks" + (
            ", fully overlapping writes" if fully_overlapping else "")
        waves = [[t["id"]] for t in impl]

    print(json.dumps({
        "tasks": out_tasks,
        "dag_edges": edges,
        "marker_conflicts": conflicts,
        "gates": [t["id"] for t in tasks if t["disposition"] == "gate"],
        "post_merge_runbook": [t["id"] for t in tasks
                               if t["disposition"] in ("release", "manual")],
        "waves": waves,
        "mode": mode,
        "degrade_reason": degrade,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py -v`
Expected: all 4 PASS. If `test_marked_fixture_compiles_to_documented_waves` fails on wave shape, debug the splitter/edges against the fixture before touching the test.

- [ ] **Step 6: Wire the compiler into `skills/ultrapowers/references/dependency-analysis.md`** (three edits, match on quoted text):

6a. Immediately under the heading `## Classify Before Building the DAG`, insert this paragraph before the existing "Classify every task…" paragraph:

```markdown
**Marked plans compile mechanically.** If the plan contains any `**Type:**` or
`**Depends-on:**` line, run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>`
and use its JSON verbatim for the `dag_edges`, `dispositions`, `marker_conflicts`,
`post_merge_runbook`, `waves`, `mode`, and `degrade_reason` of the transparency
block. Reserve judgment for entries flagged `"heuristic": true` (verify or
override them, recording why) and for the derived knobs below — the compiler
does not derive `testCmd`, `baseBranch`, tiers, or review depth.
```

6b. In the `## Transparency: Computed Output` fenced example block, insert after the `post_merge_runbook:` line:

```
derived_knobs:
  testCmd: python3 -m pytest tests/ -q
  baseBranch: main
  review: { T1: adversarial, default: lean }
  tierOverrides: {}
```

6c. Replace the sentence claiming the block "is also included in the final report (see `report-format.md`)" with:

```markdown
The waves, dependency edges, and post-merge runbook reappear in the final
report; the full block itself is rendered only at the Step-3 gate.
```

- [ ] **Step 7: Append to `tests/test_marker_compiler.py`:**

```python
def test_compiler_reference_wires_the_executable_compiler():
    text = DEP_ANALYSIS.read_text()
    assert "compile_plan.py" in text
    assert "derived_knobs" in text
    assert '"heuristic": true' in text
```

- [ ] **Step 8: Run the full suite and commit**

Run: `python3 -m pytest tests/ -q`
Expected: 0 failures

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/fixtures/unmarked-plan.md tests/test_compile_plan.py skills/ultrapowers/references/dependency-analysis.md tests/test_marker_compiler.py
git commit -m "feat: deterministic compile_plan.py — marked plans compile mechanically into the transparency block"
```

---

### Task 2: Engine failure containment

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (runTask wrapper, mergeWave catches, integration catch, headSha judgment, resume-aware setup error, tierOverrides key validation, budget check per chunk)
- Modify: `tests/sim_workflow.mjs` (new scenarios)

Context: `workflow.js` has zero try/catch around `agent()` calls. `parallel()` is fail-fast, so one engine-side agent error in a 16-wide wave rejects the wave, the exception propagates, and a multi-hour headless run dies with **no structured report**. Coordination note: this file is also modified by the dependency-cascade and worktree-cleanup tasks — those declare `Depends-on:` on this task; make your changes self-contained and committed.

- [ ] **Step 1: Wrap `runTask` so a thrown agent call degrades to a failed task.** In `skills/ultrapowers/workflow.js`, rename the existing `async function runTask(task, baseSha) {` to `async function runTaskInner(task, baseSha) {` and insert above it:

```js
// A thrown agent() call (engine fault, schema failure, transient error) must
// cost ONE task, never the run: parallel() is fail-fast, so an uncaught throw
// in a 16-wide wave would reject the whole wave and lose the report.
async function runTask(task, baseSha) {
  try {
    return await runTaskInner(task, baseSha)
  } catch (e) {
    const msg = String((e && e.message) || e)
    judgmentCalls.push('task ' + task.id + ': agent error — ' + msg)
    log('task ' + task.id + ' FAILED on agent error: ' + msg)
    return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
             notes: msg, tier: TIER[tierKey(task.tier)] || TIER.standard,
             review: taskReviewProfile(task), fixIterations: 0 }
  }
}
```

- [ ] **Step 2: Contain merge/reconcile agent errors.** In `mergeWave`, replace the line `let merge = await agent(` … `)` (the MERGE_PROMPT dispatch) with:

```js
  let merge
  try {
    merge = await agent(
      GUARD + '\n\n' + MERGE_PROMPT + '\nMerge in this order:\n' + branchList,
      { label: 'merge:wave' + (waveIdx + 1), model: TIER.cheap, schema: MERGE_SCHEMA }
    )
  } catch (e) {
    merge = { status: 'CONFLICT', detail: 'merge agent error: ' + String((e && e.message) || e) }
  }
```

and wrap the reconcile dispatch inside the retry loop the same way:

```js
    try {
      merge = await agent(
        GUARD + '\n\n' + RECONCILE_PROMPT + '\nFailure:\n' + (merge.detail || ''),
        { label: 'reconcile:wave' + (waveIdx + 1) + ':' + attempt, model: TIER.mostCapable, schema: MERGE_SCHEMA }
      )
    } catch (e) {
      merge = { status: 'CONFLICT', detail: 'reconcile agent error: ' + String((e && e.message) || e) }
    }
```

- [ ] **Step 3: Contain the integration-review agent.** Wrap the `const review = await agent(` … COMPLETENESS_PROMPT … `)` dispatch:

```js
let review
try {
  review = await agent(
    GUARD + '\n\n' + COMPLETENESS_PROMPT +
      '\n\nTasks:\n' + taskList + '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
      (baseline.passed === false
        ? '\nBaseline: the test suite FAILED before any task ran — ' + (baseline.output || 'no output')
        : ''),
    { label: 'integration', model: REVIEWER_MODEL, schema: REVIEW_SCHEMA }
  )
} catch (e) {
  const msg = String((e && e.message) || e)
  judgmentCalls.push('integration review failed to run: ' + msg)
  review = { testsPassed: false, output: 'integration agent error: ' + msg,
             findings: ['integration review did not run — verify the suite manually before merging'] }
}
```

(`const review` becomes `let review`; the rest of the return block is unchanged.)

- [ ] **Step 4: Surface MERGED-without-headSha instead of silently freezing the review base.** Immediately before the existing line `if (merge.status === 'MERGED' && merge.headSha) waveBaseSha = merge.headSha`, insert:

```js
  if (merge.status === 'MERGED' && !merge.headSha) {
    judgmentCalls.push('wave ' + (w + 1) + ': merge reported MERGED without headSha — ' +
      'review base stays at ' + String(waveBaseSha).slice(0, 12) +
      '; later reviewers may see this wave\'s changes as task scope')
    log('wave ' + (w + 1) + ': MERGED without headSha; review base frozen')
  }
```

- [ ] **Step 5: Resume-aware setup error + tierOverrides key validation.** Change the setup error string `'ultrapowers: setup failed to create integration branch '` to:

```js
    'ultrapowers: setup failed to ' + (resume ? 'check out existing' : 'create') +
    ' integration branch ' + integrationBranch +
```

Next to the existing tierOverrides **value** validation loop, add key validation:

```js
for (const k of Object.keys(tierOverrides)) {
  if (k !== 'cheap' && k !== 'standard' && k !== 'mostCapable') {
    throw new Error('ultrapowers: tierOverrides key "' + k +
      '" is not a tier (valid: cheap, standard, mostCapable). Refusing to launch.')
  }
}
```

- [ ] **Step 6: Check the budget per 16-task chunk, not only per wave.** Extract the existing wave-level budget condition into a helper above the wave loop and call it in both places:

```js
const budgetExhausted = () => {
  if (typeof budget === 'undefined' || !budget) return false
  const r = (typeof budget.remaining === 'function') ? budget.remaining() : budget.remaining
  return typeof r === 'number' && r <= 0
}
```

Wave level keeps its current behavior via `if (budgetExhausted()) { ... }`. Inside the chunk loop, before dispatching each chunk:

```js
    if (budgetExhausted()) {
      chunk.forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted mid-wave)'))
      continue
    }
```

- [ ] **Step 7: Add sim scenarios.** Read `tests/sim_workflow.mjs` first and follow its existing scenario/stub patterns exactly (it stubs `agent()` per label). Add three scenarios:
1. **agent-throw-degrades**: the stub throws for one task's `impl:` label in a 2-task wave; assert the run still returns a report, the thrown task has `status: 'failed'` and `reviewVerdict: 'agent-error'`, the sibling task is `done`, and `judgmentCalls` mentions the error.
2. **merged-without-headsha**: the merge stub returns `{ status: 'MERGED' }` (no headSha); assert the run completes and `judgmentCalls` contains an entry matching `/without headSha/`.
3. **meta-absent-engine**: a wrapping variant that strips the entire `export const meta = { ... }` declaration (not just the `export` keyword) before evaluating, simulating parse-time meta extraction; assert the run completes (the `typeof meta !== 'undefined'` guard holds).

- [ ] **Step 8: Verify and commit**

Run: `python3 -m pytest tests/ -q`
Expected: 0 failures (includes `test_workflow_sim.py` driving the updated sim and the no-prompt-drift suite — no BAKE block changed in this task)

```bash
git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs
git commit -m "fix: contain agent errors (task/merge/integration), surface headSha-less merges, validate tierOverrides keys, per-chunk budget"
```

---

### Task 3: Dependency-aware cascade blocking

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (accept `args.edges`, skip transitive dependents of failed tasks)
- Modify: `tests/sim_workflow.mjs` (one scenario)
- Modify: `tests/test_canary.py` (one assertion)

Context: today only failed **merges** cascade; a wave-N task that fails review leaves its wave mergeable, so wave-N+1 tasks whose `Depends-on:` prerequisite never landed still dispatch — running against a base missing the dependency. The orchestrating agent already records edges as prose strings; this adds a structured form.

- [ ] **Step 1: Accept structured edges.** In `skills/ultrapowers/workflow.js`, next to the existing `const dependencyEdges = (ARGS && ARGS.dependencyEdges) || []`, add:

```js
// Structured dependency pairs [[fromTaskId, toTaskId], ...] — optional. When
// present, a failed task blocks its transitive dependents instead of letting
// them run against a base that never received the prerequisite.
const EDGES = (ARGS && Array.isArray(ARGS.edges))
  ? ARGS.edges.filter((e) => Array.isArray(e) && e.length === 2).map((e) => [String(e[0]), String(e[1])])
  : []
```

- [ ] **Step 2: Skip dependents of failed tasks.** Above the wave loop, add:

```js
// Tasks transitively downstream of a failure — never dispatched, always reported.
const blockedByDep = new Set()
const noteFailures = () => {
  const failed = new Set(taskResults.filter((r) => r && r.status === 'failed').map((r) => r.task))
  let grew = true
  while (grew) {
    grew = false
    for (const [a, b] of EDGES) {
      if ((failed.has(a) || blockedByDep.has(a)) && !blockedByDep.has(b) && !failed.has(b)) {
        blockedByDep.add(b)
        grew = true
      }
    }
  }
}
```

Inside the wave loop, after `for (const r of results) taskResults.push(r)`, call `noteFailures()`. Where each chunk is built (`const chunk = WAVES[w].slice(...)`), filter before dispatch:

```js
    const runnable = chunk.filter((t) => {
      if (blockedByDep.has(t.id)) {
        unfinished.push(t.id + ': blocked — depends on a failed task')
        log('task ' + t.id + ' skipped: upstream dependency failed')
        return false
      }
      return true
    })
    if (runnable.length === 0) continue
    const chunkResults = await parallel(runnable.map((task) => () => runTask(task, waveBaseSha)))
```

(Call `noteFailures()` once before the wave's chunk loop as well, so failures from earlier waves block this wave's tasks.)

- [ ] **Step 3: Sim scenario.** In `tests/sim_workflow.mjs`, add **dependent-blocked-by-failed-task**: two waves `[[A],[B]]` with `args.edges = [["A","B"]]`; stub A's review to return blocking issues twice (fix-loop exhaustion → A `failed`); assert B never dispatches (no `impl:B` stub call), `unfinished` contains an entry matching `/B: blocked — depends on a failed task/`, and the run still returns a report.

- [ ] **Step 4: Pin the contract.** Append to `tests/test_canary.py`:

```python
def test_workflow_consumes_structured_edges():
    wf = WORKFLOW.read_text()
    assert "ARGS.edges" in wf
    assert "blockedByDep" in wf
```

- [ ] **Step 5: Verify and commit**

Run: `python3 -m pytest tests/ -q`
Expected: 0 failures

```bash
git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs tests/test_canary.py
git commit -m "feat: failed tasks block their transitive dependents via structured args.edges"
```

---

### Task 4: Worktree cleanup after successful merges

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md` (MERGE_PROMPT BAKE block + the "persists until the merge step consumes it" sentence + the test-detection ladder wording)
- Modify: `skills/ultrapowers/workflow.js` (re-bake MERGE_PROMPT)
- Modify: `tests/sim_workflow.mjs` (assert cleanup instruction reaches the merge agent)

Context: a real run leaves every task worktree (`.claude/worktrees/wf_*`) and branch (`worktree-wf_*`) behind — 16 leftovers observed. The merge agent is the right janitor: it knows which branches merged. **Re-bake discipline:** the MERGE_PROMPT lives canonically in `wave-merge.md` inside `<!-- BAKE:MERGE_PROMPT -->` markers and is duplicated as a `const` in `workflow.js`; `tests/test_no_prompt_drift.py` fails unless both copies match after normalization — edit the BAKE block first, then mirror the same text into the workflow constant.

- [ ] **Step 1: Extend the MERGE_PROMPT BAKE block.** In `skills/ultrapowers/references/wave-merge.md`, inside `<!-- BAKE:MERGE_PROMPT -->`, append this paragraph to the prompt text:

```
After ALL branches in your list are merged and the test suite passes, clean up
the merged branches only: use git worktree list to find each merged branch's
worktree, git worktree remove it, then git branch -d the branch. Leave any
branch you did NOT merge — and its worktree — untouched; failed and blocked
work must stay inspectable.
```

- [ ] **Step 2: Re-bake into `skills/ultrapowers/workflow.js`.** Append the same sentences (as string concatenation, matching the surrounding style) to the `MERGE_PROMPT` constant.

- [ ] **Step 3: Fix the two stale sentences in `wave-merge.md`** (outside BAKE blocks):

3a. Replace the sentence containing `the worktree persists until the merge step consumes it` with:

```markdown
the worktree persists until the wave's merge agent has merged the branch and
the suite passed — then the merge agent removes the worktree and deletes the
branch. Failed/blocked branches and their worktrees are deliberately left for
inspection; the orchestrating agent may sweep them after the pre-merge gate.
```

3b. Replace the file-based test-detection ladder sentence (the one listing `pnpm-lock.yaml → pnpm check; package.json → npm test; …`) with the actual baked wording:

```markdown
When no `testCmd` is provided, the merge agent detects and runs the project
test command (pnpm check, npm test, pytest, cargo test, or go test ./...).
```

- [ ] **Step 4: Sim assertion.** In `tests/sim_workflow.mjs`, in the happy-path scenario, assert the prompt received by the merge stub matches `/git worktree remove/` — pinning that the cleanup instruction actually reaches the merge agent.

- [ ] **Step 5: Verify and commit**

Run: `python3 -m pytest tests/ -q`
Expected: 0 failures — `test_no_prompt_drift.py` proves the re-bake matched

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/workflow.js tests/sim_workflow.mjs
git commit -m "feat: merge agent cleans up merged worktrees/branches; fix stale wave-merge wording"
```

---

### Task 5: Report contract truthing — blockedWaves and the cleanup claim

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `tests/test_report_runbook.py` (append one test)

Context: `workflow.js` returns `blockedWaves` and even comments that the return "matches references/report-format.md" — but the schema, field table, and presentation order omit it, so a Step-5 agent following the doc verbatim silently drops blocked waves from the human gate. The doc also promises `finishing-a-development-branch` will "clean up worktrees", which its provenance rules forbid.

- [ ] **Step 1: Write the failing test.** Append to `tests/test_report_runbook.py`:

```python
def test_report_contract_includes_blocked_waves():
    text = REPORT.read_text()
    assert "blockedWaves" in text          # schema + field table
    assert "Blocked waves" in text         # presentation item
    assert "clean up worktrees" not in text  # finishing-a-development-branch never will
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_report_runbook.py -v`
Expected: the new test FAILS (`blockedWaves` absent)

- [ ] **Step 3: Edit `skills/ultrapowers/references/report-format.md`:**

3a. In the JSON schema, after the `"waveMerges"` property, add:

```json
    "blockedWaves": { "type": "array", "items": { "type": "object",
      "properties": { "wave": {"type":"integer"}, "detail": {"type":"string"} } } },
```

3b. In the field-reference table, after the `waveMerges` row, add:

```markdown
| `blockedWaves` | no | Waves whose merge did not land (`wave`, `detail`); later waves were cascade-blocked into `unfinished` |
```

3c. In `## Presentation`, renumber to insert between the wave-merges item and the test-result item:

```markdown
6. **Blocked waves** — any wave whose merge failed after reconciliation, with the failure detail; everything cascade-blocked behind it appears under unfinished. Omit the section only when the array is empty.
```

(The former items 6–9 become 7–10.)

3d. Replace the Approve bullet's `to merge, clean up worktrees, and close the plan` with `to merge and close the plan (the engine's merge agents already removed merged task worktrees; sweep any failed-task leftovers under .claude/worktrees/ before merging)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_report_runbook.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/report-format.md tests/test_report_runbook.py
git commit -m "fix: report contract carries blockedWaves; stop promising cleanup finishing-a-development-branch cannot do"
```

---

### Task 6: Reviewer-prompts honesty — divergence, NEEDS_CONTEXT, schema BAKE coverage

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `tests/test_no_prompt_drift.py` (cover the two JSON schemas)

Context: the doc justifies the merged single review pass by citing "v5.0.6's direction", but installed superpowers 5.1.0 reasserts two-stage review (spec first, then quality — with red flags against merging them). The divergence is fine; the claim of fidelity is not. Separately, the implementer/reviewer JSON schemas in this doc have no `<!-- BAKE -->` markers, so the drift test never checks them against `workflow.js` — an enum edit in either copy passes CI. Note: BAKE markers must wrap text that ALREADY matches the workflow constants — wrap, don't rewrite, the schema blocks.

- [ ] **Step 1: Reword the divergence honestly.** In `skills/ultrapowers/references/reviewer-prompts.md`, replace the sentence(s) citing v5.0.6's direction for the merged review pass with:

```markdown
**Deliberate divergence from superpowers 5.1.0:** upstream subagent-driven-development
mandates two ORDERED review passes (spec compliance first, then code quality) and
red-flags merging them. Ultrapowers runs ONE merged spec+quality pass per fix-loop
iteration (`lean`), or two independent merged passes (`adversarial`) — a deliberate
trade of upstream's ordering for headless wall-clock, not an implementation of it.
If upstream's evidence later shows the ordering matters, the adversarial profile is
the place to restore it (pass 1 spec-only, pass 2 quality-only).
```

- [ ] **Step 2: Document the NEEDS_CONTEXT downgrade.** After the paragraph describing implementer statuses, add:

```markdown
**Headless downgrade:** upstream treats `NEEDS_CONTEXT` as "answer the question and
re-dispatch". A headless workflow cannot answer, so `workflow.js` records the task
as `failed` with the question in `notes` — it surfaces at the pre-merge gate for a
redirect rather than pausing a run that cannot pause.
```

- [ ] **Step 3: BAKE-wrap the schemas.** Wrap the implementer-schema JSON block in `<!-- BAKE:IMPLEMENTER_SCHEMA -->` / `<!-- /BAKE -->` and the reviewer-schema JSON block in `<!-- BAKE:REVIEWER_SCHEMA -->` / `<!-- /BAKE -->` — wrapping the existing text verbatim.

- [ ] **Step 4: Extend the drift test.** Append to `tests/test_no_prompt_drift.py`:

```python
# ── JSON schemas: enum/key drift between reviewer-prompts.md and workflow.js ──
SCHEMA_BLOCKS = ["IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"]


@pytest.mark.parametrize("name", SCHEMA_BLOCKS)
def test_schema_block_is_baked(name):
    blocks = baked_blocks()
    assert name in blocks, "missing BAKE marker for " + name
    wf = normalize(WORKFLOW.read_text())
    expected = normalize(blocks[name])
    assert expected, "empty source block for " + name
    assert expected in wf, (
        "drift: BAKE:" + name + " in reviewer-prompts.md does not match workflow.js.\n"
        "Re-bake per references/workflow-template.md.\nexpected (normalized):\n" + expected)
```

If the normalized containment fails because the md block and the JS constant legitimately differ in shape (e.g. the md shows JSON, the JS uses object literals), align the md block to the workflow constant's content — the constant is the runtime truth; the md documents it.

- [ ] **Step 5: Verify and commit**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/ -q`
Expected: 0 failures

```bash
git add skills/ultrapowers/references/reviewer-prompts.md tests/test_no_prompt_drift.py
git commit -m "docs: state the review-topology divergence from 5.1.0 honestly; BAKE-cover the JSON schemas"
```

---

### Task 7: Executor-variance semantics in the marker contract

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `tests/test_marker_contract.py` (append one test)

Context: we advertise "sequential executors ignore the markers" as graceful degradation, but for `gate` and `release` the ignoring changes semantics: ultrapowers never executes them; subagent-driven-development runs them as ordinary tasks (push included — acceptable there because a human approves each task). The same document prescribing different behavior per executor must say so explicitly.

- [ ] **Step 1: Write the failing test.** Append to `tests/test_marker_contract.py`:

```python
def test_contract_defines_executor_variance():
    text = CONTRACT.read_text()
    assert "## Executor variance" in text
    assert "sequential executor" in text.lower()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_marker_contract.py -v`
Expected: the new test FAILS

- [ ] **Step 3: Add the section.** In `skills/ultrapowers/references/plan-markers.md`, after the `## Type semantics (dispositions)` section (below its closing `<!-- /BAKE -->`), insert:

```markdown
## Executor variance

The dispositions above bind **ultrapowers**. A sequential executor
(subagent-driven-development, executing-plans) reads the same plan and treats
every task — including `gate`, `release`, and `manual` — as an ordinary task to
execute in document order. That is safe by construction, not by accident: the
sequential executors keep a human in the loop at each task, so a `release` push
or a `manual` owner step gets human eyes before it runs. The semantic difference
to author for:

- `gate` — ultrapowers compiles it into run config; a sequential executor runs
  it as written. Write gates so both work: pure verification commands, no writes.
- `release` / `manual` — ultrapowers defers them to the post-merge runbook; a
  sequential executor runs them inline at their document position. Place them
  LAST in the plan so the inline execution order equals the deferred order.
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

Run: `python3 -m pytest tests/test_marker_contract.py -v`
Expected: all PASS

```bash
git add skills/ultrapowers/references/plan-markers.md tests/test_marker_contract.py
git commit -m "docs: plan-markers states the executor-variance semantics for gate/release/manual"
```

---

### Task 8: Ultraplan owns the plan header and the third handoff option

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `tests/test_ultraplan_skill.py` (append one test)

Context: writing-plans mandates a header on every plan — `> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans…` — and its Execution Handoff offers only those two options. Combined with using-superpowers' "you MUST use the skill" rule, that header steers any orchestrating agent away from ultrapowers. Ultraplan, as the authoring overlay, must rewrite the header and add the third option.

- [ ] **Step 1: Write the failing test.** Append to `tests/test_ultraplan_skill.py`:

```python
def test_ultraplan_overrides_the_execution_header_and_handoff():
    text = ULTRAPLAN.read_text()
    assert "REQUIRED SUB-SKILL" in text          # quotes the upstream header it replaces
    assert "ultrapowers:ultrapowers" in text     # names the parallel executor
    assert "Execution Handoff" in text           # overrides writing-plans' two-option menu
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_ultraplan_skill.py -v`
Expected: the new test FAILS

- [ ] **Step 3: Add the override sections.** In `skills/ultraplan/SKILL.md`, after the `## Add markers to every task` section, insert:

```markdown
## Replace the plan header

writing-plans mandates this header line on every plan:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

On a marked plan, REPLACE it with:

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

Without this, the header literally directs any skills-obedient agent into the
sequential executor — the parallel run happens only because a human typed
`/ultrapowers`.

## Execution Handoff (third option)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first:

1. **Ultrapowers (recommended for marked plans)** — `/ultrapowers <plan-path>`:
   parallel waves, worktree isolation, per-task review, two human gates.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, batch execution with checkpoints.
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

Run: `python3 -m pytest tests/test_ultraplan_skill.py -v`
Expected: all PASS

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "feat: ultraplan replaces the writing-plans execution header and adds the /ultrapowers handoff option"
```

---

### Task 9: Engine preflight probe

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/probe.js`
- Create: `tests/test_probe.py`

Context: the Workflow engine is undocumented and drifts (two behavior changes observed 2026-06-10: parse-time `meta` extraction, name-vs-filename resolution). A trivial saved workflow that echoes its args, launched before the real run, converts engine drift into a clean fallback instead of a mid-run crash. The probe spawns zero agents and finishes in seconds.

- [ ] **Step 1: Write the failing test.** Create `tests/test_probe.py`:

```python
"""probe.js is the engine preflight: echoes args, spawns no agents.
Validated the same way test_canary.py validates workflow.js — engine-wrapped
syntax check plus a stubbed execution."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBE = ROOT / "skills/ultrapowers/probe.js"


def test_probe_shape():
    src = PROBE.read_text()
    assert "name: 'ultrapowers-probe'" in src   # launch name (meta.name resolution)
    assert "throw new Error(" in src            # fail-loud on args not populating
    assert "agent(" not in src                  # zero agents — preflight must be free


def test_probe_executes_and_echoes():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    src = PROBE.read_text().replace("export const meta", "const meta", 1)
    harness = (
        "const args = { ping: 'pong' };\n"
        "(async () => {\n" + src + "\n})()"
        ".then(r => { if (!r || r.ok !== true) { console.error('bad result'); process.exit(1); } "
        "console.log(JSON.stringify(r)); })"
        ".catch(e => { console.error(String(e)); process.exit(1); });\n"
    )
    p = subprocess.run([node, "--input-type=module", "-"], input=harness,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert '"ok":true' in p.stdout.replace(" ", "")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_probe.py -v`
Expected: both FAIL (`probe.js` does not exist)

- [ ] **Step 3: Create `skills/ultrapowers/probe.js`:**

```js
// Engine preflight for ultrapowers. Launched as the saved workflow
// 'ultrapowers-probe' with args { ping: 'pong' } BEFORE the real run.
// Spawns no agents. If args fail to populate or the engine dialect changed,
// this throws — and SKILL.md routes to the sequential fallback instead of
// risking a mid-run crash in the real workflow.

export const meta = {
  name: 'ultrapowers-probe',
  description: 'Ultrapowers engine preflight: echoes args, spawns no agents.',
  phases: [],
}

let A = (typeof args !== 'undefined') ? args : undefined
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { /* fall through to the check below */ }
}
if (!A || A.ping !== 'pong') {
  throw new Error('ultrapowers-probe: args did not populate (got ' +
    JSON.stringify(A) + ') — engine args delivery changed; use the fallback.')
}

return {
  ok: true,
  echo: A.ping,
  // True on engines that still expose the meta binding to the script body;
  // false where meta is extracted at parse time. Informational either way.
  metaExposed: typeof meta !== 'undefined',
}
```

Note for the test harness: the probe body ends in a top-level `return`, which plain node rejects. If `test_probe_executes_and_echoes` hits a syntax error on `return`, wrap the source in an async arrow inside the harness string — the assertions stay the same; follow `test_canary.py`'s wrapping precedent.

- [ ] **Step 4: Run tests to verify they pass, then commit**

Run: `python3 -m pytest tests/test_probe.py -v`
Expected: both PASS

```bash
git add skills/ultrapowers/probe.js tests/test_probe.py
git commit -m "feat: ultrapowers-probe — zero-agent engine preflight that fails loud when the engine drifts"
```

---

### Task 10: Superpowers compatibility tests + attestation check

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `tests/test_superpowers_compat.py`

Context: ultrapowers depends on superpowers' conventions but nothing detects upstream drift — the review found a fidelity claim already stale against installed 5.1.0. These tests read the *installed* superpowers plugin cache and assert the few contract lines ultrapowers actually relies on. They skip cleanly where superpowers isn't installed (CI), and bite on every dev machine and user checkout — which is where drift matters. The attestation line they check against SKILL.md is added by the orchestrator task; until that lands this file's last test is skipped via its own guard, so this task is self-contained.

- [ ] **Step 1: Create `tests/test_superpowers_compat.py`:**

```python
"""Upstream-drift tripwires: assert the superpowers contract lines ultrapowers
depends on, against the INSTALLED plugin cache. Skips when superpowers is not
installed locally (e.g. CI) — drift detection matters on machines that run it."""
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"

pytestmark = pytest.mark.skipif(
    not CACHE.exists(), reason="superpowers plugin not installed locally")

HANDOFF_SKILLS = [
    "brainstorming",
    "writing-plans",
    "subagent-driven-development",
    "executing-plans",
    "finishing-a-development-branch",
]


def installed():
    versions = sorted((p for p in CACHE.iterdir() if p.is_dir()), key=lambda p: p.name)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


def test_every_handoff_skill_still_exists():
    for name in HANDOFF_SKILLS:
        assert (installed() / "skills" / name / "SKILL.md").exists(), (
            f"superpowers:{name} is gone or renamed — ultrapowers hands off to it; "
            "re-audit SKILL.md Steps 1/5/6")


def test_writing_plans_template_shape_unchanged():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")


def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"Tested with superpowers (\d+\.\d+\.\d+)", skill)
    if not m:
        pytest.skip("attestation line not added to SKILL.md yet (orchestrator task)")
    if m.group(1) != installed().name:
        pytest.fail(
            f"installed superpowers {installed().name} != attested {m.group(1)} — "
            "re-run the interop audit, then bump the attestation in SKILL.md")
```

- [ ] **Step 2: Run it**

Run: `python3 -m pytest tests/test_superpowers_compat.py -v`
Expected on this machine: first two PASS against the 5.1.0 cache; the attestation test SKIPS until the orchestrator task adds the line. On CI: all SKIP.

- [ ] **Step 3: Commit**

```bash
git add tests/test_superpowers_compat.py
git commit -m "test: upstream-drift tripwires against the installed superpowers cache"
```

---

### Task 11: Orchestrator wiring — attestation, preflights, handoff sequencing, edges

**Type:** implementation
**Depends-on:** 1, 3, 9

**Files:**
- Modify: `skills/ultrapowers/SKILL.md` (sole owner of this file in this plan)
- Modify: `tests/test_orchestrator_markers.py` (append one test)

Context: this task threads every new capability through the orchestrator's steps. It depends on the compiler (Step 2 invokes `scripts/compile_plan.py` — the validator requires that file to exist), structured edges (Step 4b passes them), and the probe (Step 4 launches it).

- [ ] **Step 1: Write the failing test.** Append to `tests/test_orchestrator_markers.py`:

```python
def test_orchestrator_wires_the_hardening():
    text = ORCHESTRATOR.read_text()
    assert re.search(r"Tested with superpowers \d+\.\d+\.\d+", text)
    assert "scripts/compile_plan.py" in text       # Step 2 runs the compiler
    assert "ultrapowers-probe" in text             # Step 4 preflight
    assert "edges" in text                          # Step 4b passes structured pairs
    assert "tests.passed" in text                   # Step 5 gates the finishing handoff
    assert "git checkout <integrationBranch>" in text  # finishing verifies the right tree
```

Add `import re` to the imports if absent.

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_orchestrator_markers.py -v`
Expected: the new test FAILS

- [ ] **Step 3: Edit `skills/ultrapowers/SKILL.md`** (seven edits, match on quoted text):

3a. **Attestation + version preflight.** In Step 1, after the Workflow-tool preflight paragraph, add:

```markdown
**Tested with superpowers 5.1.0.** Check the installed version (the directory name
under `~/.claude/plugins/cache/claude-plugins-official/superpowers/`). A newer
version is not a blocker — warn and continue: "ultrapowers was validated against
superpowers 5.1.0; you have <X>. If plan parsing or a handoff misbehaves, suspect
upstream drift first (run `python3 -m pytest tests/test_superpowers_compat.py` in
the ultrapowers repo to localize it)."
```

3b. **Compiler in Step 2.** In the Step 2 `- **Classify first**` bullet, after "Only `implementation` tasks enter the DAG.", insert:

```markdown
  For marked plans, do not hand-derive: run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>`
  and adopt its JSON as the transparency block's waves/edges/dispositions verbatim,
  applying judgment only to `"heuristic": true` entries and the derived knobs.
```

3c. **Probe in Step 4.** In Step 4a, extend the install block to also copy the probe:

```
cp "${CLAUDE_SKILL_DIR}/probe.js" .claude/workflows/ultrapowers-probe.js
```

and add after the determinism-guard blockquote:

```markdown
**4a½ — Engine preflight.** Launch the saved workflow `ultrapowers-probe` with
`args = { ping: 'pong' }`. It spawns no agents and returns `{ ok: true, ... }` in
seconds. If the launch errors or `ok` is not true, the engine has drifted — go
directly to Step 6; do not launch the real workflow.
```

3d. **Edges in Step 4b.** In the `args = { ... }` block, after `dependencyEdges,` add `edges,` and add to the bullet list below it:

```markdown
- `edges` — the structured dependency pairs `[[fromTaskId, toTaskId], ...]` from
  Step 2 (the same edges rendered as prose in `dependencyEdges`). The workflow uses
  them to block transitive dependents of a failed task instead of dispatching them.
```

3e. **Step 5 handoff sequencing.** Replace the Approve bullet:

```markdown
- **Approve** — first gate on the report's `tests.passed`: if false, do NOT hand
  off; present the failure and offer Redirect instead (finishing-a-development-branch's
  own precondition is a passing suite). If true: `git checkout <integrationBranch>`
  (its Step 1 verifies tests on the CURRENT checkout — it must see the integration
  tree, not the base branch you restored for the report), then proceed to
  `superpowers:finishing-a-development-branch` to merge / open a PR / clean up,
  carrying the post-merge runbook as its follow-up checklist.
```

3f. **Step 6 branch-state note.** At the end of Step 6, add:

```markdown
When falling back, hand subagent-driven-development a clean checkout and let its
own using-git-worktrees setup create isolation — do not hand it a dirty tree or
silently leave it implementing on main; it requires explicit consent for that.
```

3g. **Autonomy wording + Resources.** In the Autonomy Posture section, replace `they appear under blocked waves / unfinished in the report` with `they appear in the report as failed tasks, blocked waves, or unfinished entries — never silently dropped`. In `## Resources`, add:

```markdown
- `scripts/compile_plan.py` — deterministic compiler for marked plans: transparency-block JSON from a plan path.
- `probe.js` — the zero-agent engine preflight installed and launched at Step 4a½.
```

- [ ] **Step 4: Verify and commit**

Run: `python3 -m pytest tests/test_orchestrator_markers.py tests/test_superpowers_compat.py tests/test_validate_skill.py -v`
Expected: all PASS — including the compat attestation test now un-skipping, and the validator resolving `scripts/compile_plan.py`

```bash
git add skills/ultrapowers/SKILL.md tests/test_orchestrator_markers.py
git commit -m "feat: orchestrator wires compiler, probe, edges, attestation, and correct finishing-handoff sequencing"
```

---

### Task 12: Hygiene — gitignore, keywords, workflow-template drift

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `.gitignore`
- Modify: `.claude-plugin/plugin.json` (keywords only)
- Modify: `skills/ultrapowers/references/workflow-template.md`

- [ ] **Step 1: `.gitignore`.** Append:

```
# ultrapowers run artifacts (installed copies + engine worktrees)
.claude/worktrees/
.claude/workflows/ultrapowers-run.js
.claude/workflows/ultrapowers-probe.js
```

- [ ] **Step 2: plugin.json.** Remove the `"ultracode"` entry from `keywords` (it advertises exactly the launch path the skill's determinism guard forbids).

- [ ] **Step 3: workflow-template.md** (three edits):

3a. In the headline `args` block, align with reality by listing the full contract: `waves, integrationBranch, stamp, dependencyEdges, edges, baseBranch, planPath, resume?, testCmd?, reviewProfile?, tierOverrides?` — and note `only id and body are validated per task; title/tier/acceptance/files/review are advisory inputs the prompts consume`.

3b. Fix the garbled fallback sentence — replace the text containing `(falls back to `ultra/integration-<stamp>`)` so it reads: `integrationBranch — required for resume; otherwise defaults to ultra/integration-<stamp>`.

3c. In the Structure section's description of `meta.phases`, add: `the assignment is wrapped in a typeof-guard because newer engines extract the meta literal at parse time and do not expose the binding to the executing body; phase() calls group progress regardless.`

- [ ] **Step 4: Verify and commit**

Run: `python3 -m pytest tests/ -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: 0 failures; `skill ok`

```bash
git add .gitignore .claude-plugin/plugin.json skills/ultrapowers/references/workflow-template.md
git commit -m "chore: gitignore run artifacts, drop ultracode keyword, fix workflow-template drift"
```

---

### Task 13: Full gate

**Type:** gate
**Depends-on:** none

**Files:** none (verification only)

- [ ] **Step 1:** Run: `python3 -m pytest tests/ -q` — expect 0 failures across the full suite (compiler, probe, compat, sim, drift, contract tests).
- [ ] **Step 2:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — expect `skill ok` twice.
- [ ] **Step 3:** Run: `git status --porcelain` — expect empty.

---

### Task 14: Release 0.4.0

**Type:** release
**Depends-on:** none

**Files:**
- Modify: `.claude-plugin/plugin.json` (version)
- Modify: `.claude-plugin/marketplace.json` (plugins[0].version)

Run after the branch merges — under ultrapowers execution this rides the post-merge runbook.

- [ ] **Step 1:** In both manifests, change `"version": "0.3.1"` to `"version": "0.4.0"`.
- [ ] **Step 2:**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: 0.4.0 — deterministic compiler, engine hardening, interop truthing, drift tripwires"
git push origin main
```

- [ ] **Step 3:** Verify: `git show HEAD:.claude-plugin/plugin.json | grep version` → `"version": "0.4.0"`.
