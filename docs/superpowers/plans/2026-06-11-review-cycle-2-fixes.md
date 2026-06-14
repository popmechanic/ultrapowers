# Review Cycle 2 Fixes Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — review-cycle fixes; verified by the committed test suite, not a held-out exam.

**Goal:** Close every fix-now finding from the iteration-2 three-agent review: compiler edge-precedence cycles (the write-after-create backward case can never compile), fence/parse blind spots, workflow wave-merge semantics (a fully-blocked wave must not cascade), fix-round dispatch incoherence, the report-format Approve-path contradiction, and a batch of compat/doc tripwires.

**Architecture:** Same file-cluster discipline as cycle 1: each task owns one code/script file plus its test file, or one doc plus its pinning test. Tasks 1→2 serialize on the compiler; tasks 3→4 serialize on workflow.js; docs that describe new behavior depend on the task that creates it.

**Tech Stack:** Python 3 (pytest), Node 22 (sim), bash, markdown.

**House rules for every task:** before committing run `python3 -m pytest tests/ -q` (all green), `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` (both print `skill ok`). Commit on your assigned branch with a conventional message. No version bumps.

---

### Task 1: Compiler edge precedence — doc-order heuristics must yield to semantic and explicit edges

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

**The bug (P1, verified live):** in `build_edges`, the write-after-create rule is order-independent ("B cannot modify a file that does not exist") while write-after-write serializes by document order. Because `creates ⊆ writes` and `modifies ⊆ writes`, any pair where the CREATOR appears later in the document than the MODIFIER gets BOTH `creator → modifier` (write-after-create) and `modifier → creator` (write-after-write, document order) — a guaranteed spurious cycle. A perfectly legal 2-task plan (Task A modifies `f.py`, Task B creates `f.py`) is rejected with "cycle detected". The same family: a backward read-after-write edge plus any shared write path cycles; the `ambiguous-files` doc-position edges can oppose a backward write-after-create or an explicit text edge.

**The fix — edge precedence with yielding.** Restructure `build_edges` to add edges in four tiers, where the doc-order-heuristic tiers SKIP any edge whose opposite is already present:

1. **Explicit:** marker edges (the marker `Depends-on` loop, unchanged including its outside-impl-set conflict records), then text edges (the `TEXT_DEP` loop, moved up from the bottom).
2. **Semantic, order-independent:** write-after-create and read-after-write (unchanged conditions).
3. **Doc-order heuristics, yielding:** write-after-write adds `a → b` only when `a["order"] < b["order"]` AND `(b["id"], a["id"]) not in seen`; the ambiguous-files edges (`U → T` for preceding, `T → U` for following) likewise each check `not in seen` for the opposing pair before adding.

Implementation sketch — add a helper inside `build_edges`:

```python
    def opposed(a, b):
        return (b, a) in seen
```

and guard the write-after-write add with `and not opposed(a["id"], b["id"])`, and each ambiguous-files add with the same check on its pair. Keep the `Depends-on: none` conflict recording inside `add()` unchanged. Add a short comment block stating the precedence: "explicit (marker, text) > semantic order-independent (write-after-create, read-after-write) > document-order heuristics (write-after-write, ambiguous-files), which yield to any opposing earlier edge. A cycle that survives this precedence is a genuine plan contradiction and stays a loud error."

Genuine cycles must STILL error: two tasks that each read a file the other creates, or contradictory markers, remain unsatisfiable.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py` (reuse `compile_plan` / `compile_plan_raw` helpers; use letter task IDs in fixtures):

```python
def test_backward_write_after_create_compiles_without_cycle(tmp_path):
    plan = tmp_path / "wac-back.md"
    plan.write_text(
        "# Plan: WAC backward\n\n"
        "### Task A: modifier first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `f.py`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: creator second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `f.py`\n\n- [ ] **Step 1:** create f\n"
    )
    out = compile_plan(plan)   # must NOT exit 1 with a spurious cycle
    assert {"from": "B", "to": "A", "why": "write-after-create"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_backward_read_after_write_with_shared_write_compiles(tmp_path):
    plan = tmp_path / "raw-back.md"
    plan.write_text(
        "# Plan: RAW backward\n\n"
        "### Task A: reader first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `reader.py`\n- Modify: `shared.txt`\n- Test: `data.json`\n\n"
        "- [ ] **Step 1:** consume data\n\n"
        "### Task B: writer second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `data.json`\n- Modify: `shared.txt`\n\n"
        "- [ ] **Step 1:** produce data\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "read-after-write"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_marker_edge_beats_doc_order_write_after_write(tmp_path):
    plan = tmp_path / "marker-vs-waw.md"
    plan.write_text(
        "# Plan: Marker beats WAW\n\n"
        "### Task A: declared dependent\n\n"
        "**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: declared prerequisite\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f first\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "marker"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_text_edge_beats_ambiguous_files_position(tmp_path):
    plan = tmp_path / "text-vs-ambig.md"
    plan.write_text(
        "# Plan: Text beats ambiguous\n\n"
        "### Task A: ambiguous early\n\n**Type:** implementation\n\n"
        "- [ ] **Step 1:** refactor, runs after Task B finishes\n\n"
        "### Task B: concrete later\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `g.py`\n\n- [ ] **Step 1:** create g\n"
    )
    out = compile_plan(plan)
    assert {"from": "B", "to": "A", "why": "text"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_genuine_cycle_still_errors(tmp_path):
    plan = tmp_path / "genuine.md"
    plan.write_text(
        "# Plan: Genuine cycle\n\n"
        "### Task A: needs B's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.out`\n- Test: `b.out`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: needs A's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.out`\n- Test: `a.out`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "cycle" in p.stderr.lower()
```

- [ ] **Step 2: Run them, confirm the first four fail** (today they exit 1 on spurious cycles or emit both edges) and the fifth already passes — `python3 -m pytest tests/test_compile_plan.py -q`.
- [ ] **Step 3: Implement the precedence restructure** in `build_edges` as specified.
- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. Expected all green (existing fixtures only exercise forward cases, which are unaffected).
- [ ] **Step 5: Run both validators** — expected `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py && git commit -m "fix: edge precedence — doc-order heuristics yield to semantic and explicit edges (no more spurious cycles)"`.

### Task 2: Compiler parse hardening — tilde fences, fence-aware classification and text deps, path fallback, zero-impl warning

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

Anchor to BASE before editing (the edge-precedence task already landed on your branch's base). Five verified gaps:

**Gap A — tilde fences not recognized.** `FENCE = re.compile(r"^(\x60{3,})")` tracks only backtick fences; a `~~~`-fenced example containing `### Task 42: ...` becomes a phantom executable task (verified: 3 tasks compile from a 2-task plan). Tilde fences are CommonMark-legal and the natural wrapper when the example itself contains backtick fences. Fix: `FENCE = re.compile(r"^(\x60{3,}|~{3,})")` (write the backtick literally, not as \x60), and in `_fence_aware_lines` track the fence CHARACTER as well as length — a fence closes only on a run of the SAME character at least as long as the opener.

**Gap B — classification evidence and text-dependency regexes scan the raw body, not fence-stripped prose.** `classify()` runs `RELEASE_EV`/`MANUAL_EV`/`GATE_EV` over `t["body"]`, and `build_edges` runs `TEXT_DEP` over `b["body"]` — so a fenced bash example containing `git push origin main` reclassifies an unmarked implementation task as `release` (excluding it from execution!), and fenced prose like "runs after Task A" creates a real edge. The compiler is already fence-aware for headings, markers, and Files lines — extend that: in `parse_task`, build `prose = "\n".join(line for line, fenced in _fence_aware_lines(t["body"]) if not fenced)` and store it as `t["prose"]`; `classify()` matches against `t["prose"]`; the `TEXT_DEP` loop in `build_edges` iterates `t["prose"]`.

**Gap C — unbackticked Files paths keep trailing prose; brace globs unflagged.** `paths = PATH_RE.findall(f.group(2)) or [f.group(2).strip()]` — an unbackticked line `- Create: src/app.py — the new module` yields the literal write path `"src/app.py — the new module"`, silently missing overlap edges against `` `src/app.py` ``. Fix the fallback to take the first whitespace-delimited token: `or [f.group(2).strip().split()[0]]` (paths containing spaces must be backticked — note it in a comment). Also add `{` to the glob-character set so `src/{a,b}.py` flags `files_ambiguous`.

**Gap D — a plan with zero implementation tasks compiles to `waves: []` silently.** workflow.js refuses empty waves, and the orchestrator gets no hint. In `main()`, after computing `impl`, when `not impl`: print to stderr `compile_plan: no implementation tasks — nothing to wave (plan is gates/release/manual only); the runbook and gates still apply.` (keep exit code 0 and emit the JSON).

**Gap E — missing degrade-trigger test.** The fully-overlapping-writes degrade (an O(n²) all-pairs predicate) and its exact `degrade_reason` wording have no test.

Also update the module docstring's edge list to mention the precedence/yielding rule introduced by the prerequisite task (one clause is enough).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py`:

```python
def test_tilde_fenced_heading_is_content_not_a_task(tmp_path):
    plan = tmp_path / "tilde.md"
    plan.write_text(
        "# Plan: Tilde\n\n"
        "### Task A: embeds an example\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** document the format:\n\n"
        "~~~markdown\n### Task 42: fenced by tildes, not a task\n~~~\n\n"
        "### Task B: second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A", "B"]


def test_fenced_release_evidence_does_not_reclassify(tmp_path):
    plan = tmp_path / "fenced-release.md"
    plan.write_text(
        "# Plan: Fenced evidence\n\n"
        "### Task A: implementation with a fenced example\n\n"
        "**Files:**\n- Create: `deploy_docs.md`\n\n"
        "- [ ] **Step 1:** document the release command:\n\n"
        "```bash\ngit push origin main\n```\n"
    )
    out = compile_plan(plan)
    assert out["tasks"][0]["disposition"] == "implementation"


def test_fenced_text_dependency_creates_no_edge(tmp_path):
    plan = tmp_path / "fenced-text.md"
    plan.write_text(
        "# Plan: Fenced text dep\n\n"
        "### Task A: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: embeds prose example\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** include this sample text:\n\n"
        "```text\nthis step runs after Task A in the example\n```\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert out["waves"] == [["A", "B"]]


def test_unbackticked_path_drops_trailing_prose(tmp_path):
    plan = tmp_path / "plainpath.md"
    plan.write_text(
        "# Plan: Plain path\n\n"
        "### Task A: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: src/app.py — the new module\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-create"} in out["dag_edges"]


def test_brace_glob_flags_ambiguous(tmp_path):
    plan = tmp_path / "brace.md"
    plan.write_text(
        "# Plan: Brace glob\n\n"
        "### Task A: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** one\n\n"
        "### Task B: brace glob\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/{a,b}.py`\n\n- [ ] **Step 1:** sweep\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "ambiguous-files"} in out["dag_edges"]


def test_zero_implementation_plan_warns_loudly(tmp_path):
    plan = tmp_path / "zeroimpl.md"
    plan.write_text(
        "# Plan: Gates only\n\n"
        "### Task A: suite gate\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 0
    assert "no implementation tasks" in p.stderr
    import json as _json
    assert _json.loads(p.stdout)["waves"] == []


def test_fully_overlapping_writes_degrade_and_reason(tmp_path):
    plan = tmp_path / "overlap.md"
    body = "".join(
        "### Task {i}: writer {i}\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `same.txt`\n\n- [ ] **Step 1:** edit\n\n".replace("{i}", i)
        for i in ("A", "B", "C"))
    plan.write_text("# Plan: Overlap\n\n" + body)
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert out["degrade_reason"] == "Sequential mode: 3 implementation tasks, fully overlapping writes"
    assert out["waves"] == [["A"], ["B"], ["C"]]
```

- [ ] **Step 2: Run them, confirm the new tests fail** (tilde → 3 tasks; fenced release → `release`; fenced text → edge present; plain path → no edge; brace → no edge; zero-impl → no stderr note; overlap → may already pass except the exact-wording pin — keep it regardless).
- [ ] **Step 3: Implement gaps A–D** plus the docstring touch.
- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. All green.
- [ ] **Step 5: Run both validators** — `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py && git commit -m "fix: tilde fences, fence-aware classify/text-deps, path fallback, zero-impl warning"`.

### Task 3: Workflow wave/merge semantics — no cascade from an empty merge, headSha-gated merges, per-chunk dependency checks

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`

Four verified issues in `skills/ultrapowers/workflow.js`:

**Fix A — a wave with zero mergeable results converts dependency-blocking into a whole-run cascade.** When every task in a wave is dep-blocked (or failed before producing a branch), `mergeWave` returns `TEST_FAILED: 'no branches to merge'`, the wave is recorded blocked, and ALL later waves cascade-block — even though no merge was attempted and the integration branch is untouched. This defeats the stated purpose of `args.edges` (block exactly the transitive dependents). Fix in the wave loop: before calling `mergeWave`, compute `const mergeable = results.filter(isMergeable)`; when `mergeable.length === 0`, push `{ wave: w + 1, status: 'SKIPPED', detail: 'no mergeable branches — every task in this wave failed, was blocked, or was deferred; integration branch untouched', branches: [] }` onto `waveMerges`, `log('wave ' + (w + 1) + ' merge skipped: no mergeable branches')`, and `continue` (review base unchanged, no blockedWaves entry, no cascade). The `merged.length === 0` early return inside `mergeWave` becomes unreachable; leave it as defense.

**Fix B — cascade-blocking is not logged per wave.** wave-merge.md's No Silent Caps table promises "one line per blocked wave". In the cascade loop (the `for (let d = w + 1; ...)` block), add `log('wave ' + (d + 1) + ' cascade-blocked by wave ' + (w + 1))` as its first statement.

**Fix C — `isMergeable` ignores `headSha`.** The docs promise "downstream steps refuse to operate on a guessed sha", but a `done` result without `headSha` is merged with `sha=` empty. Change `isMergeable` to `(r) => r && r.status === 'done' && r.branch && r.headSha`.

**Fix D — intra-wave dependency failures aren't re-checked between 16-task chunks.** `noteFailures()` runs at wave start; with a wave wider than 16 and an intra-wave edge, a chunk-2 dependent dispatches even though its chunk-1 dependency already failed. Add a `noteFailures()` call at the top of each chunk iteration (inside the `for (let off = 0; ...)` loop, before the budget check is fine).

Sim additions/updates in `tests/sim_workflow.mjs` (the harness already supports a custom `parallel` override and has `makeAgent`/`taskIdFromLabel` helpers):

```js
// ── Scenario: fully dep-blocked wave does NOT cascade ─────────────────────────
async function scenarioFullyBlockedWaveDoesNotCascade() {
  const implCalled = new Set()
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'X', title: 'task X', body: 'do X', tier: 'cheap' },
    ],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
    [{ id: 'Z', title: 'task Z', body: 'do Z', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B']] }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'noCascade: dep-blocked B never dispatched')
  assert(implCalled.has('Z'), 'noCascade: unrelated wave-3 task Z DID dispatch')
  const zr = r.tasks.find((t) => t.task === 'Z')
  eq(zr && zr.status, 'done', 'noCascade: Z completed')
  const w2 = r.waveMerges.find((m) => m.wave === 2)
  eq(w2 && w2.status, 'SKIPPED', 'noCascade: wave-2 merge recorded SKIPPED')
  eq(r.blockedWaves, [], 'noCascade: no wave recorded blocked')
  assert(!r.unfinished.some((u) => /cascade-blocked/.test(u)), 'noCascade: nothing cascade-blocked')
  console.log('scenario fully-blocked-wave-no-cascade: OK')
}

// ── Scenario: done-without-headSha is not mergeable ───────────────────────────
async function scenarioDoneWithoutHeadShaNotMerged() {
  let mergePrompt = null
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'G', title: 'good task', body: 'do G', tier: 'cheap' },
    ],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label === 'impl:A') {
        return { status: 'DONE', summary: 's', branch: 'wt-A', commit: 'c-A' } // no headSha
      }
      if (label.startsWith('merge:')) {
        mergePrompt = prompt
        return { status: 'MERGED', headSha: 'm1' }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(mergePrompt !== null, 'noHeadSha: wave still merged (G is mergeable)')
  assert(mergePrompt.indexOf('wt-A') === -1, 'noHeadSha: branch without headSha excluded from the merge list')
  assert(mergePrompt.indexOf('wt-G') !== -1, 'noHeadSha: good branch merged')
  console.log('scenario done-without-headsha-not-merged: OK')
}

// ── Scenario: intra-wave edge respected across 16-task chunks ─────────────────
async function scenarioIntraWaveDepAcrossChunks() {
  const tasks = Array.from({ length: 17 }, (_, i) =>
    ({ id: 'T' + i, title: 't' + i, body: 'do ' + i, tier: 'cheap' }))
  const args = { waves: [tasks], integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['T0', 'T16']] }
  const implCalled = new Set()
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'T0') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('T16'), 'chunkDep: chunk-2 dependent of failed chunk-1 task never dispatched')
  assert(r.unfinished.some((u) => /^T16: blocked/.test(u)), 'chunkDep: T16 surfaced in unfinished')
  eq(r.tasks.filter((t) => t.status === 'done').length, 15, 'chunkDep: the other 15 completed')
  console.log('scenario intra-wave-dep-across-chunks: OK')
}
```

Register all three in the await-list at the bottom. Note for the existing `scenarioDependentBlockedByFailedTask`: after Fix A its single-task wave 2 (B dep-blocked) now records a `SKIPPED` merge instead of a blocked wave — if it asserts anything about waveMerges/blockedWaves, update those assertions to the new semantics (its core assertions about B and A are unchanged).

- [ ] **Step 1: Add the sim scenarios first**, run `node tests/sim_workflow.mjs` — expect failures (cascade fires, sha-less branch merged, T16 dispatched).
- [ ] **Step 2: Apply fixes A–D** to workflow.js.
- [ ] **Step 3: Re-run** `node tests/sim_workflow.mjs` — `ALL SCENARIOS PASSED`.
- [ ] **Step 4: Full suite** — `python3 -m pytest tests/ -q` (test_no_prompt_drift unaffected: no BAKE text changes here). All green.
- [ ] **Step 5: Both validators** — `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs && git commit -m "fix: empty-merge waves skip instead of cascading; headSha gates merges; per-chunk dep checks; cascade logging"`.

### Task 4: Fix-round dispatch coherence — anchor to the prior implementation, not BASE

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`

Anchor to BASE before editing (the wave-semantics task already landed on your branch's base).

**The bug (P2, verified by reading the three baked instructions):** the fix-round re-dispatch in `runTaskInner` reuses `IMPLEMENTER_PROMPT` verbatim with `BASE: baseSha` and appends "resolve these blocking issues on the same branch (<impl.branch>)". Three contradictions: (1) the fix agent gets a FRESH engine worktree on its own new branch, while `impl.branch` is still locked by the original implementer's worktree (the reviewer prompt itself documents that lock); (2) the implementer prompt's step 1 says "if HEAD differs from BASE, git reset --hard BASE" — followed literally in the fresh worktree this DISCARDS the prior implementation the fix is supposed to amend; (3) whichever branch the fix agent actually commits on is what gets reported to the merge, so behavior depends on agent improvisation.

**The fix:** make the fix dispatch anchor to the prior implementation commit. In `runTaskInner`, change the fix re-dispatch prompt construction from `'\n\nBASE: ' + baseSha + ...` plus the current `'\n\nFIX REQUIRED — resolve these blocking issues on the same branch (' + impl.branch + '):\n'` suffix to:

```js
    impl = await agent(
      GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + impl.headSha + testCmdLine + '\nTASK:\n' + task.body +
        '\n\nFIX ROUND — the prior implementation of this task exists at commit ' + impl.headSha +
        ' (branch ' + impl.branch + ', locked by its own worktree — do not try to check it out).' +
        ' BASE above IS that commit: anchoring to BASE gives you the prior work to amend, not a blank slate.' +
        ' Resolve these blocking issues on top of it, commit on YOUR assigned branch, and report YOUR branch and HEAD:\n' +
        blocking.map((b) => '- ' + b.detail).join('\n'),
      { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA }
    )
```

(The reviewer's iteration-2 prompt keeps `BASE: baseSha` — it reviews the FULL task diff against the integration base. Only the fix implementer's BASE changes.)

**Doc truth-ups in reviewer-prompts.md** (none of these touch BAKE blocks — verify with the markers before editing):

1. Fix-loop policy item 1 currently says "re-dispatch the implementer on the same branch with the issues appended to the original task text." Replace with: "re-dispatch an implementer in a fresh worktree whose `BASE` is the prior implementation's HEAD (not the integration base) — anchoring to BASE hands it the work to amend. The prior branch stays locked by its worktree; the fix agent commits on its own engine-assigned branch and reports it, and that report supersedes the original mapping at merge time."
2. The Model tiers table's most-capable row lists "escalated `BLOCKED` tasks" — no such escalation exists (a first-dispatch BLOCKED fails immediately as `not-reviewed`). Replace "escalated `BLOCKED` tasks" with "fix-round re-dispatches".
3. The "Headless downgrade" note covers only `NEEDS_CONTEXT`. Extend that paragraph with: "The same downgrade applies to `BLOCKED`: upstream's interactive ladder (add context → stronger model → split → human) cannot run headless, so a first-dispatch `BLOCKED` records the task as `failed` (`not-reviewed`) and surfaces at the pre-merge gate for a redirect."

**Sim:** extend the existing `scenarioFixLoop` to capture the `fix:A:1` dispatch prompt and assert the new anchoring:

```js
    // inside the agent stub, when label === 'fix:A:1', capture the prompt
    assert(fixPrompt.indexOf('BASE: sha-A') !== -1, 'fixLoop: fix round anchors BASE to the prior implementation HEAD')
    assert(fixPrompt.indexOf('FIX ROUND') !== -1, 'fixLoop: fix preamble present')
    assert(fixPrompt.indexOf('locked by its own worktree') !== -1, 'fixLoop: branch-lock warning present')
```

(Adapt to the scenario's existing stub structure; `sha-A` is what its implementer stub reports as headSha.)

- [ ] **Step 1: Extend `scenarioFixLoop` first**, run `node tests/sim_workflow.mjs` — expect its new assertions to fail (prompt still says FIX REQUIRED / BASE is int0).
- [ ] **Step 2: Apply the workflow.js change**, re-run the sim — `ALL SCENARIOS PASSED`.
- [ ] **Step 3: Apply the three reviewer-prompts.md edits** (outside BAKE blocks).
- [ ] **Step 4: Full suite** — `python3 -m pytest tests/ -q` (test_no_prompt_drift must stay green — you changed no BAKE text; the FIX ROUND suffix is workflow.js-only, like the old FIX REQUIRED suffix was). All green.
- [ ] **Step 5: Both validators** — `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs skills/ultrapowers/references/reviewer-prompts.md && git commit -m "fix: fix-round dispatch anchors to the prior implementation; tier table and BLOCKED downgrade told truthfully"`.

### Task 5: Compat tripwires round 2 — pin the remaining load-bearing upstream lines

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_superpowers_compat.py`

Five interop claims still have no pin against the installed superpowers cache (superpowers 5.1.0 is installed here, so nothing skips). Keep the existing `pytestmark` and helpers; append:

```python
def test_finishing_branch_still_gates_on_passing_tests():
    text = (installed() / "skills/finishing-a-development-branch/SKILL.md").read_text()
    assert "Cannot proceed with merge/PR until tests pass" in text, (
        "finishing-a-development-branch relaxed its passing-suite precondition — "
        "ultrapowers SKILL.md Step 5 gates the Approve path on this; re-audit it")


def test_sdd_still_requires_consent_for_main_branch_work():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "without explicit user consent" in text, (
        "subagent-driven-development dropped its main/master consent red flag — "
        "ultrapowers SKILL.md Step 6 relies on it for the fallback handoff")


def test_writing_plans_still_offers_two_execution_options():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "Two execution options" in text, (
        "writing-plans changed its Execution Handoff structure — "
        "ultraplan overlays a third option on exactly two; re-audit ultraplan SKILL.md")


def test_verification_skill_still_states_evidence_before_claims():
    text = (installed() / "skills/verification-before-completion/SKILL.md").read_text()
    assert "Evidence before claims" in text, (
        "verification-before-completion reworded its core principle — "
        "wave-merge.md and reviewer-prompts.md cite it as the critic's source")
```

And in the existing `test_sdd_still_mandates_continuous_execution`, additionally pin the sentence plan-markers.md quotes verbatim:

```python
    assert "Do not pause to check in with your human partner between tasks" in text, (
        "the exact sentence plan-markers.md quotes was reworded — update the quote")
```

- [ ] **Step 1: Apply the additions.**
- [ ] **Step 2: Run the file** — `python3 -m pytest tests/test_superpowers_compat.py -q`. Expected: all pass, none skipped.
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add tests/test_superpowers_compat.py && git commit -m "test: pin finishing precondition, SDD consent + exact quote, writing-plans handoff, verification principle"`.

### Task 6: dependency-analysis.md + SKILL.md — run the compiler on every plan; edge-precedence and wording truth-ups

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `skills/ultrapowers/SKILL.md`

Verify the compiler behavior on your branch first (`skills/ultrapowers/scripts/compile_plan.py` — it now has edge-precedence yielding from the prerequisite task). PINNED STRINGS that must survive: dependency-analysis.md — section order "## Classify" before "## Build the DAG", and `plan-markers.md`, `**Depends-on:**`, `additive`, `marker_conflicts`, `post-merge runbook`, `preamble`, `fence-aware`, `dispositions`, `compile_plan.py`, `derived_knobs`, `"heuristic": true` (tests/test_marker_compiler.py); SKILL.md — `Classify first`, `post-merge runbook`, `` `meta.name` ``, `not found`, `restore the session checkout`, `git checkout <baseBranch>`, the `Tested with superpowers N.N.N` line, `scripts/compile_plan.py`, `ultrapowers-probe`, `tests.passed`, `git checkout <integrationBranch>` (tests/test_orchestrator_markers.py).

Six edits:

1. **Compiler for every plan (resolves a README contradiction — README already says "the same compiler classifies each task" for unmarked plans).** In dependency-analysis.md, the "Classify Before Building the DAG" opening currently scopes the compiler to marked plans ("If the plan contains any `**Type:**` or `**Depends-on:**` line, run …"). Replace that opening sentence with: "**Run the compiler on every plan, marked or not:** `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>`. It implements the classification heuristics itself and flags every non-marker judgment `\"heuristic\": true`. On a **marked** plan, use its JSON verbatim for the `dag_edges`, `dispositions` (rendered from `tasks[].disposition` plus `gates`), `marker_conflicts`, `post_merge_runbook`, `waves`, `mode`, and `degrade_reason` of the transparency block, reserving judgment for heuristic-flagged entries. On an **unmarked** plan, treat the same JSON as the draft analysis: verify every flagged classification and inferred edge against `plan-markers.md` before adopting it — never hand-derive from scratch what the compiler already computed."
2. **SKILL.md Step 2, same change.** Replace the bullet text "For marked plans, do not hand-derive: run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>` and adopt its JSON as the transparency block's waves/edges/dispositions verbatim, applying judgment only to `\"heuristic\": true` entries and the derived knobs." with "Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>` on every plan. Marked plans: adopt its JSON as the transparency block's waves/edges/dispositions verbatim, applying judgment only to `\"heuristic\": true` entries and the derived knobs. Unmarked plans: the compiler applies the contract heuristics and flags every call — verify the flagged entries against `references/plan-markers.md` instead of hand-deriving."
3. **Edge precedence note.** In dependency-analysis.md "Build the DAG", after the edge-rule list and the `why`-labels sentence, add: "Precedence: document-order heuristics (write-after-write, ambiguous-files) yield to any opposing explicit or semantic edge (marker, text, write-after-create, read-after-write). A cycle that survives this precedence is a genuine plan contradiction — surfaced as a loud error, never resolved by guessing."
4. **"File edge wins" wording (Build the DAG, rule 1).** Replace "if a file rule still finds one, the file edge wins and the disagreement is surfaced in the transparency block under `marker_conflicts`" with "if inference still finds one, the inferred edge wins (its `why` is named in the conflict note) and the disagreement is surfaced in the transparency block under `marker_conflicts`".
5. **Cycle-detection method sentence.** Replace "After building the adjacency list, run DFS-based cycle detection before computing any waves." with "After building the adjacency list, run cycle detection before accepting any waves — the compiler detects cycles as tasks Kahn layering cannot place; when hand-deriving, DFS works too."
6. **Scope the unimplemented defaults.** In "Conservative Defaults", the "Implicit shared directories" and "Unknown paths" bullets describe rules the compiler does NOT implement. Prefix the two bullets with a one-line note: "The remaining two defaults are hand-derivation guidance only — the compiler is static and does not inspect the repo; apply them when reviewing heuristic-flagged output:". Keep both bullets.

Also in SKILL.md Step 5's Approve bullet, replace "carrying the post-merge runbook as its follow-up checklist" with "the orchestrator carries the post-merge runbook and presents it again when finishing-a-development-branch completes (the upstream skill takes no checklist input)".

- [ ] **Step 1: Apply the edits** exactly as written.
- [ ] **Step 2: Full suite** — `python3 -m pytest tests/ -q` (test_marker_compiler + test_orchestrator_markers green). All green.
- [ ] **Step 3: Both validators** — `skill ok` twice.
- [ ] **Step 4: Sanity-check README** — confirm README's unmarked-plan claims ("the same compiler classifies each task … flags every heuristic call") now match the docs; no README edit expected.
- [ ] **Step 5: Commit** — `git add skills/ultrapowers/references/dependency-analysis.md skills/ultrapowers/SKILL.md && git commit -m "docs: compiler runs on every plan; edge precedence, cycle method, runbook handoff wording"`.

### Task 7: wave-merge.md truth-up — SKIPPED merges, integration-review reality, report-field routing

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`

CRITICAL: do NOT touch the five `<!-- BAKE:* -->` blocks (pinned by tests/test_no_prompt_drift.py). Verify on your branch that workflow.js now records `SKIPPED` wave merges and logs per-cascaded-wave (the prerequisite task added both). Four edits, all outside BAKE blocks:

1. **Per-Wave Merge section** — append a paragraph: "A wave that produces **no mergeable branches** (every task failed, dep-blocked, or deferred) skips its merge entirely: `waveMerges` records `status: 'SKIPPED'`, the integration branch and review base are untouched, and later waves still run — dependency edges, not the cascade, decide what downstream work is blocked."
2. **Integration and Completeness Review** — the numbered list describes the controller running the suite and then dispatching a critic that receives "the final test output". Reality: ONE completeness-critic agent both runs the suite and reviews (the report's `tests` field comes from it), and it receives the task list, blocked waves, and the baseline-failure note only when the baseline was red. Collapse the two numbered items into one accurate item and fix the inputs sentence.
3. **Section-header claims** — "The report section header for this step is `## Integration Review`. Blocked waves appear under `## Blocked Waves`." — these headers exist nowhere in report-format.md (the canonical presentation is a numbered list, and the workflow only has a `phase('Integration Review')` progress label). Replace with: "In the structured report this lands in `tests` and `completenessFindings`; blocked waves land in `blockedWaves` (presentation item 6), cascaded work in `unfinished`." Also update the No Silent Caps table's "Appears in report" cells that name `## Blocked Waves` to name the report FIELDS (`blockedWaves`, `unfinished`) instead.
4. **Cascade rationale** — the sentence "and by wave construction each wave-N+1 task depends on some wave-N task — so continuing selectively would integrate onto a broken base" is false for degraded sequential runs (singleton waves may be independent). Qualify: "…and in parallel mode each wave-N+1 task depends on some wave-N task by construction; degraded sequential runs cascade conservatively too — after a failed MERGE the integration branch is in an unknown state either way. (A SKIPPED merge — nothing to integrate — does not cascade.)"

- [ ] **Step 1: Apply the four edits**, BAKE blocks byte-identical.
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/wave-merge.md && git commit -m "docs: wave-merge documents SKIPPED merges, one-agent integration review, report-field routing"`.

### Task 8: report-format.md — fix the Approve-path contradiction; document SKIPPED; pin the gates

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `tests/test_report_runbook.py`

**The P1:** report-format.md's Approve bullet says only "run the sweep, then proceed to finishing-a-development-branch" — omitting BOTH the `tests.passed` gate and the `git checkout <integrationBranch>` step that SKILL.md Step 5 mandates (Step 5 restores the BASE branch before presenting the report, so following report-format.md literally sweeps against the wrong HEAD — every merged branch classified unmerged — and hands finishing-a-development-branch the wrong checkout, possibly on a red suite). Two loaded documents giving different gate procedures is exactly where an orchestrator picks the shorter one.

Keep pinned strings: `Post-merge runbook`, `Step-2`, `finishing-a-development-branch`, `blockedWaves`, `Blocked waves`; the file must still NOT contain the phrase `clean up worktrees`.

Three doc edits:

1. **Approve bullet** — replace it with: "**Approve** — first gate on the report's `tests.passed`: if false, do NOT hand off; present the failure and offer Redirect instead. If true: `git checkout <integrationBranch>` (finishing-a-development-branch verifies tests on the CURRENT checkout, and the sweep classifies 'merged' against HEAD), then run `bash ${CLAUDE_SKILL_DIR}/scripts/sweep_worktrees.sh` (the deterministic sweep — do not assume the merge agents' prompted cleanup ran), then proceed to `superpowers:finishing-a-development-branch`; the orchestrator carries the post-merge runbook and presents it again when that handoff completes."
2. **`waveMerges` row** — extend the status enumeration to "`MERGED`/`CONFLICT`/`TEST_FAILED`/`SKIPPED` (`SKIPPED` = no mergeable branches; integration branch untouched, no cascade)".
3. **`judgmentCalls` row** — replace the closed list with: "Any non-obvious decisions made autonomously during the run — including implementer `DONE_WITH_CONCERNS` concerns, a red baseline, reviewer verdict/severity mismatches, agent errors, budget deferrals, merges reported without a headSha, and a failed integration review".

Then extend `tests/test_report_runbook.py` so the Approve procedure can't drift apart again — append:

```python
def test_report_approve_path_matches_skill_step5():
    text = REPORT.read_text()
    assert "tests.passed" in text          # the gate
    assert "git checkout <integrationBranch>" in text  # the checkout before sweep/handoff
    assert "SKIPPED" in text               # waveMerges vocabulary documents the skip status
```

- [ ] **Step 1: Add the test, confirm it fails** — `python3 -m pytest tests/test_report_runbook.py -q`.
- [ ] **Step 2: Apply the three doc edits**, re-run that file — all pass.
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/report-format.md tests/test_report_runbook.py && git commit -m "docs: report-format Approve path matches SKILL.md Step 5; SKIPPED and judgmentCalls documented; pinned"`.

### Task 9: plan-markers.md — widen the heuristic disclosure; release-pattern three-way pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `tests/test_marker_contract.py`

CRITICAL: do NOT touch the `<!-- BAKE:MARKER_SYNTAX -->` / `<!-- BAKE:TYPE_SEMANTICS -->` blocks (pinned against the ultraplan skill). Keep pinned strings: `**Type:**`, `**Depends-on:**`, all four type names, `worktree-pure`, `post-merge runbook`, `additive`, `fence-aware`, `## Executor variance`, `sequential executor`.

Three edits plus one test:

1. **Widen the regex-subset disclosure.** The paragraph after the classification-heuristics list discloses the compiler's conservative regex subset for `release` evidence only. The gate and manual heuristics also diverge: gate is implemented as "no `Create:`/`Modify:` writes AND any test-runner/lint/`git status`/`git log` mention anywhere in the prose" (an existence check — NOT a proof that every step is read-only), and the manual regex additionally matches the phrase "on the deployment", which the documented heuristic never mentions. Extend that paragraph with: "The gate and manual heuristics are likewise regex subsets: gate fires on 'no write paths plus any test-runner/lint/git-status mention in the prose' (an existence check, not a proof that every step is read-only), and manual additionally fires on the phrase 'on the deployment'. All such classifications arrive flagged for re-judgment."
2. **Runbook handoff phrasing.** In the compile-time obligations list, the runbook bullet ends "rendered with the final report and handed to `superpowers:finishing-a-development-branch` on approval". Upstream's finishing skill takes no checklist input — replace that ending with "rendered with the final report; on approval the orchestrating agent carries it through the finishing-a-development-branch handoff and presents it as the follow-up list (the upstream skill accepts no checklist input)".
3. **Inferred-edge note already says "(file or text — the compiler's conflict note names which)"** — update to cover all inferred kinds: "(the compiler's conflict note names which kind: file, read, text, or ambiguous-files)".

Test — append to `tests/test_marker_contract.py` a three-way pin so the documented pattern list, the compiler regex, and this test move together:

```python
RELEASE_PATTERNS = ("git push", "git checkout main", "git merge", "ssh", "scp",
                    "systemctl", "after the branch merges")


def test_contract_documents_compiler_release_patterns():
    doc = CONTRACT.read_text()
    src = (ROOT / "skills/ultrapowers/scripts/compile_plan.py").read_text()
    for pat in RELEASE_PATTERNS:
        assert pat in src, (
            f"compiler lost release pattern {pat!r} — update plan-markers.md's "
            "disclosure paragraph and this list together")
        assert pat in doc, (
            f"plan-markers.md does not disclose compiler release pattern {pat!r}")
```

- [ ] **Step 1: Add the test, run it** — `python3 -m pytest tests/test_marker_contract.py -q`. It may already pass for the doc side (cycle-1 added the disclosure); if so it still pins against future drift — keep it.
- [ ] **Step 2: Apply the three doc edits.**
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/plan-markers.md tests/test_marker_contract.py && git commit -m "docs: disclose gate/manual heuristic subsets; release-pattern three-way pin; runbook handoff wording"`.

### Task 10: Sweep round 2 — contained rm failures, worktree-safe ROOT resolution

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `tests/test_sweep_worktrees.py`

Two verified gaps in `skills/ultrapowers/scripts/sweep_worktrees.sh`:

**Gap A — the `rm -rf` fallback can abort the sweep.** Under `set -e`, a failing `rm -rf "$wt"` (e.g. permission-denied content) exits mid-loop, skipping the prune, the branch sweep, and the summary — exactly what the "never aborts mid-loop" comment promises against. Fix: `rm -rf "$wt" 2>/dev/null || echo "warn: could not fully remove $wt — inspect manually" >&2`.

**Gap B — run from inside an engine worktree, the sweep silently no-ops.** `git rev-parse --show-toplevel` resolves to the WORKTREE root, so the `$ROOT/.claude/worktrees/wf_*` glob matches nothing. The header says "Run from anywhere inside the target repo". Fix ROOT resolution to the main repository root via the common git dir:

```bash
GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT="$(dirname "$GIT_COMMON")"
```

(`--git-common-dir` points at the MAIN checkout's `.git` from any worktree; its parent is the main root. Requires git ≥ 2.31 for `--path-format`, fine here.)

- [ ] **Step 1: Write the failing tests** — append to `tests/test_sweep_worktrees.py` (reuse `git`, `make_repo`, `add_engine_worktree`, `branches`; `import os` if not present):

```python
def test_sweep_from_inside_a_worktree_still_sweeps(tmp_path):
    repo = make_repo(tmp_path)
    wt_a, _ = add_engine_worktree(repo, "inside", "i.txt", merge=True)
    wt_b, _ = add_engine_worktree(repo, "other", "x.txt", merge=True)

    # cwd INSIDE an engine worktree: ROOT must still resolve to the main repo.
    p = subprocess.run(["bash", str(SWEEP)], cwd=wt_a, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_a.exists()
    assert not wt_b.exists()
    assert "2 worktree(s) removed" in p.stdout


def test_sweep_warns_but_finishes_when_rm_fails(tmp_path):
    import os
    repo = make_repo(tmp_path)
    stale = repo / ".claude" / "worktrees" / "wf_aaa-protected"
    stale.mkdir(parents=True)
    (stale / "f.txt").write_text("f\n")
    wt_real, _ = add_engine_worktree(repo, "zzz-real", "z.txt", merge=True)
    os.chmod(stale, 0o555)   # contents cannot be unlinked -> rm -rf fails
    try:
        p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        assert "warn: could not fully remove" in p.stderr
        assert not wt_real.exists()          # later worktree still swept
        assert "swept:" in p.stdout          # summary still printed
    finally:
        os.chmod(stale, 0o755)               # let pytest clean tmp_path
```

- [ ] **Step 2: Run them, confirm both fail** (in-worktree run removes 0; rm failure aborts with rc 1).
- [ ] **Step 3: Apply both fixes** (and update the header comment's "Run from anywhere inside the target repo" line to mention it now includes engine worktrees).
- [ ] **Step 4: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 5: Commit** — `git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py && git commit -m "fix: sweep survives rm failures and resolves the main root from inside a worktree"`.

### Task 11: Full-suite gate

**Type:** gate
**Depends-on:** none

**Files:** none (verification only)

- [ ] **Step 1:** Run: `python3 -m pytest tests/ -q` — every test green, zero failures.
- [ ] **Step 2:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — `skill ok`.
- [ ] **Step 3:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — `skill ok`.
- [ ] **Step 4:** Run: `node tests/sim_workflow.mjs` — `ALL SCENARIOS PASSED`.
