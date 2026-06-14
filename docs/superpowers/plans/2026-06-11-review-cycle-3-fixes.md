# Review Cycle 3 Fixes Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — review-cycle fixes; verified by the committed test suite, not a held-out exam.

**Goal:** Close the iteration-3 review findings: transitive edge-precedence cycles (P1), CommonMark closing-fence handling, Files-section step bleed, shared-Test-path serialization, done-without-headSha surfacing, malformed-edges fail-loud, edge-less cascade fallback, tierOverrides truth, plus compat pins and doc truth-ups.

**Architecture:** Same file-cluster discipline: one code file plus its test file per task, or one or two docs plus their pinning test. Tasks sharing a file serialize via markers.

**Tech Stack:** Python 3 (pytest), Node 22 (sim), bash, markdown.

**House rules for every task:** before committing run `python3 -m pytest tests/ -q` (all green), `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` (both print `skill ok`). Commit on your assigned branch with a conventional message. No version bumps.

---

### Task 1: Compiler — transitive yielding, CommonMark fence closing, Files-section termination, shared-Test serialization, text-dep conflicts

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

Five verified findings in `skills/ultrapowers/scripts/compile_plan.py`:

**Bug A (P1) — `opposed()` checks only the direct reverse edge, so doc-order heuristics ignore transitive explicit ordering.** With markers producing edges B→A and C→B, and A/C sharing a write path with A earlier in the document, the write-after-write tier adds A→C (the pair (C,A) is not directly in `seen`) — creating the cycle A→C→B→A and rejecting a fully-marked, perfectly legal plan. Fix: replace the pairwise check with a reachability check — a document-order heuristic edge `a → b` is added only when `b` cannot already reach `a` through the edges recorded so far. Implementation inside `build_edges`:

```python
    def would_cycle(a, b):
        """True if adding a -> b would close a cycle (b already reaches a)."""
        adj = {}
        for e in edges:
            adj.setdefault(e["from"], []).append(e["to"])
        stack, visited = [b], set()
        while stack:
            n = stack.pop()
            if n == a:
                return True
            if n in visited:
                continue
            visited.add(n)
            stack.extend(adj.get(n, []))
        return False
```

Guard the write-after-write add and BOTH ambiguous-files adds with `not would_cycle(<from>, <to>)` (replacing the `opposed()` checks; delete `opposed()`). Since every tier-3 edge is now cycle-checked against everything added before it (tiers 1–2 plus earlier tier-3 edges), tier-3 can never create a cycle — any surviving cycle comes from explicit/semantic edges and is a genuine contradiction. Update the precedence comment to say "yield to any opposing earlier PATH (reachability), not just a direct reverse edge".

**Bug B (P2) — the fence tracker closes on info-stringed lines.** Per CommonMark a CLOSING fence may not carry an info string: inside an open ``` ``` ``` block, a line like ```` ```bash ```` is content, not a closer. The current `_fence_aware_lines` closes on any same-char run of sufficient length, so everything after a nested opener flips to prose — fabricating UNFLAGGED text edges and reclassifications from example content. Fix: close only when the stripped line consists solely of the fence run — in the close branch require `line.strip() == m.group(1)` (same char, length ≥ opener, nothing else on the line). Opening fences keep accepting info strings.

**Bug C (P3) — the Files-section scan never terminates at the checkbox steps.** `elif s and not s.startswith("-"): in_files = False` — checkbox steps start with `-`, so `in_files` stays open for the whole task and a prose step shaped `- Modify: nothing in ` `` `b.txt` `` ` should change yet` injects `b.txt` into the task's writes (over-serialization, and cycle fuel for Bug A's family). Fix: in the `in_files` branch, before the `FILE_LINE` match, close the section on checkbox lines: `if s.startswith("- ["): in_files = False` (then fall through to normal processing of that line).

**Bug D (P2, interop) — two tasks sharing a `Test:` path compile into the same wave.** Upstream writing-plans TDD semantics make `Test:` a WRITE — the task writes the failing test into that file and commits it. Two tasks listing the same `Test:` path both write it; compiling them parallel guarantees a merge conflict. Fix: the write-after-write rule's overlap set becomes `(writes ∪ reads)` on both sides — `(set(a["writes"]) | set(a["reads"])) & (set(b["writes"]) | set(b["reads"]))`, keeping the doc-order condition and the Bug-A reachability guard, and keeping read-after-write as-is in tier 2 (forward-direction duplicates dedup via `seen`; opposite-direction pairs yield via reachability). Two pure readers of one shared fixture now serialize too — accepted conservatism; note it in a comment.

**Bug E (P3) — out-of-set text dependencies drop silently.** The marker loop records an "edge dropped" conflict when `Depends-on` names a task outside the implementation set, but the text-dep loop's `add()` silently no-ops for the same case. Fix: in the text-dep loop, when `m.group(1)` is not in `ids` (and differs from the task's own id), append the same style of conflict entry: `{"task": b["id"], "edge": m.group(1) + " -> " + b["id"] + " (text)", "note": "text dependency names a task outside the implementation set (unknown id or gate/release/manual) — edge dropped"}`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py` (reuse `compile_plan` / `compile_plan_raw`; letter IDs):

```python
def test_doc_order_edge_yields_to_transitive_marker_path(tmp_path):
    plan = tmp_path / "transitive.md"
    plan.write_text(
        "# Plan: Transitive yield\n\n"
        "### Task A: last by markers, first in doc\n\n"
        "**Type:** implementation\n**Depends-on:** B\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: middle\n\n"
        "**Type:** implementation\n**Depends-on:** C\n\n"
        "**Files:**\n- Create: `other.txt`\n\n- [ ] **Step 1:** other\n\n"
        "### Task C: first by markers, last in doc\n\n"
        "**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Modify: `f.txt`\n\n- [ ] **Step 1:** edit f first\n"
    )
    out = compile_plan(plan)   # must NOT be a spurious cycle
    assert not any(e["from"] == "A" and e["to"] == "C" for e in out["dag_edges"])
    assert out["waves"] == [["C"], ["B"], ["A"]]


def test_nested_fence_with_info_string_stays_content(tmp_path):
    plan = tmp_path / "nested.md"
    plan.write_text(
        "# Plan: Nested fence\n\n"
        "### Task A: base\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: embeds a nested example\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** document this snippet:\n\n"
        "```\n"
        "```bash\n"
        "git push origin main\n"
        "```\n"
        "this line runs after Task A in the example\n"
        "```\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["B"]["disposition"] == "implementation"   # fenced git push inert
    assert not any(e["why"] == "text" for e in out["dag_edges"])  # fenced text-dep inert


def test_checkbox_step_shaped_like_files_line_adds_no_writes(tmp_path):
    plan = tmp_path / "stepbleed.md"
    plan.write_text(
        "# Plan: Step bleed\n\n"
        "### Task A: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** write a\n"
        "- Modify: nothing in `b.txt` should change yet\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert "b.txt" not in by_id["A"]["writes"]
    assert out["dag_edges"] == []
```

Note on the step-bleed fixture: the stray `- Modify:` line sits AFTER a checkbox step, which under the fix closes the Files section; today it still parses as a Files line and serializes A before B.

```python
def test_shared_test_path_serializes(tmp_path):
    plan = tmp_path / "sharedtest.md"
    plan.write_text(
        "# Plan: Shared test file\n\n"
        "### Task A: first feature\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `feat_a.py`\n- Test: `tests/test_shared.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task B: second feature\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `feat_b.py`\n- Test: `tests/test_shared.py`\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-write"} in out["dag_edges"]
    assert out["waves"] == [["A"], ["B"]]


def test_text_dependency_outside_impl_set_surfaces_conflict(tmp_path):
    plan = tmp_path / "textghost.md"
    plan.write_text(
        "# Plan: Text ghost\n\n"
        "### Task A: gate-ish\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** Run after Task A passes.\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert any(c["task"] == "B" and "edge dropped" in c["note"] for c in out["marker_conflicts"])
```

- [ ] **Step 2: Run them, confirm all five fail** (transitive → exit 1 cycle; nested fence → release classification or text edge; step bleed → b.txt in writes; shared test → no edge; text ghost → no conflict) — `python3 -m pytest tests/test_compile_plan.py -q`.
- [ ] **Step 3: Implement fixes A–E.** Update the module docstring's edge summary (one clause: WAW overlap covers writes ∪ Test: paths; heuristics yield by reachability).
- [ ] **Step 4: Full suite** — `python3 -m pytest tests/ -q`. All green (existing fixtures don't share Test: paths and the cycle-2 yield tests keep passing — reachability subsumes the direct-reverse check).
- [ ] **Step 5: Both validators** — `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py && git commit -m "fix: reachability yielding, CommonMark fence closing, Files-section termination, shared-Test serialization, text-dep conflicts"`.

### Task 2: Workflow — lost-done surfacing, fail-loud edges, edge-less cascade fallback, budget-deferral logs, honest error message

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`

Six verified findings in `skills/ultrapowers/workflow.js`:

**Fix A — a `done` result that fails `isMergeable` vanishes silently.** The implementer schema requires `headSha`, so this needs an engine schema bypass to occur — but when it does, the task reports `done`/`clean`, its branch never merges, nothing lands in `judgmentCalls` or `unfinished`, dependents still dispatch (only `'failed'` feeds `noteFailures`), and the SKIPPED detail claims every task "failed, was blocked, or was deferred". Fix in the wave loop, right after `for (const r of results) taskResults.push(r)`: collect `const lost = results.filter((r) => r && r.status === 'done' && !isMergeable(r))`; for each, push a judgmentCall `'task ' + r.task + ': reported done without mergeable coordinates (branch/headSha) — branch not merged; treating as failed for dependency blocking'` and a log line, and set `r.status = 'failed'` BEFORE the post-results `noteFailures()` so dependents block. Also reword the SKIPPED `detail` to `'no mergeable branches — every task in this wave failed, was blocked, was deferred, or reported done without mergeable coordinates; integration branch untouched'`.

**Fix B — malformed `args.edges` entries are silently filtered, disabling dependency blocking.** An orchestrator passing the compiler's `dag_edges` objects (`{from,to,why}`) verbatim gets `EDGES = []` with no warning — the blocked-dependent guarantee silently evaporates. Fail loud instead: replace the silent `.filter(...)` with validation that THROWS at launch when any entry is not a 2-element array:

```js
const EDGES = (ARGS && Array.isArray(ARGS.edges))
  ? ARGS.edges.map((e, i) => {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new Error(
          'ultrapowers: args.edges[' + i + '] is not a [fromTaskId, toTaskId] pair. ' +
          'Convert compiler dag_edges objects to pairs (e.g. [e.from, e.to]) before launch. ' +
          'Refusing to run with dependency blocking silently disabled.')
      }
      return [String(e[0]), String(e[1])]
    })
  : []
```

**Fix C — with no `edges` supplied, a zero-mergeable wave skips without cascading, letting later waves run against a base missing every prerequisite.** The SKIPPED-no-cascade semantics lean on dependency edges to block downstream work; without edges there is nothing to lean on. Fix in the SKIPPED branch: when `EDGES.length === 0` AND the wave dispatched at least one task (`results.length > 0`), fall back to the conservative pre-hardening behavior — record the wave in `blockedWaves` with detail `'no mergeable branches and no dependency edges supplied — cascading conservatively'`, log it, cascade-block later waves (same loop as the merge-failure path), and `break`. The SKIPPED-continue path remains for runs WITH edges (and for waves where nothing ran, `results.length === 0`, e.g. everything dep-blocked or deferred — those are already accounted for).

**Fix D — mid-run budget deferrals are invisible in logs and judgmentCalls.** The launch-time deferral logs and records a judgment call; the per-wave and mid-wave deferrals only push `unfinished` strings. Add a `log('wave ' + (w + 1) + ' deferred: budget exhausted')` in the wave-level branch and `log('wave ' + (w + 1) + ' chunk deferred: budget exhausted mid-wave')` in the chunk-level branch, plus ONE judgmentCall the first time a mid-run deferral happens (guard with a `let budgetDeferred = false` flag): `'budget exhausted mid-run — remaining work deferred to unfinished'`.

**Fix E — dead guard in `mergeWave`.** `if (merged.length === 0) return { status: 'TEST_FAILED', detail: 'no branches to merge' }` is unreachable (the caller skips empty merges) and, if ever reached again, would resurrect the cascade bug. Delete it and add the comment: `// Caller guarantees ≥1 mergeable result (the SKIPPED path filters empty waves).`

**Fix F — the args-validation error message implies six required task fields.** It says `Expected Task[][] where each task = { id, title, body, tier, acceptance, files }` but only `id` and `body` are validated. Reword to: `Expected Task[][] where each task = { id, body, ... } (id and body are validated; title/tier/review are consumed by prompts; acceptance/files are advisory).`

Sim additions/updates in `tests/sim_workflow.mjs`:

1. Extend `scenarioDoneWithoutHeadShaNotMerged`: after the existing assertions, assert the new surfacing — `r.judgmentCalls.some((j) => /without mergeable coordinates/.test(j))`, and the task record for A now has `status === 'failed'`.
2. New `scenarioMalformedEdgesThrow`: launch with `edges: [{ from: 'A', to: 'C', why: 'marker' }]` (object-shaped) and assert the run throws with a message matching `/args\.edges\[0\]/`.
3. New `scenarioNoEdgesZeroMergeableCascades`: waves `[[A],[B]]`, NO `edges`; A's reviewer always returns a blocking issue (fix-loop exhaustion → A failed → wave 1 has zero mergeable). Assert: B never dispatched, `r.blockedWaves.length === 1`, `r.unfinished` contains a `cascade-blocked` entry for B.
4. Register the new scenarios in the await-list.

- [ ] **Step 1: Add/extend the sim scenarios first**, run `node tests/sim_workflow.mjs` — expect failures (no judgment call, no throw, no cascade).
- [ ] **Step 2: Apply fixes A–F.**
- [ ] **Step 3: Re-run the sim** — `ALL SCENARIOS PASSED`. (Check `scenarioFullyBlockedWaveDoesNotCascade` still passes — it supplies `edges`, so Fix C must not affect it; `scenarioTransitiveDepBlock` and `scenarioIntraWaveDepAcrossChunks` also supply edges. The agent-throw scenario has no edges but its wave 1 contains a PASSING sibling, so the wave merges normally — unaffected.)
- [ ] **Step 4: Full suite** — `python3 -m pytest tests/ -q` (no BAKE text changed). All green.
- [ ] **Step 5: Both validators** — `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs && git commit -m "fix: surface lost done-results, fail loud on malformed edges, conservative cascade without edges, budget-deferral logs"`.

### Task 3: Sim coverage — baseBranch threading, reconcile-model pin, frozen base across SKIPPED waves

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `tests/sim_workflow.mjs`

Anchor to BASE first (the workflow-semantics task already landed on your branch's base). Three documented behaviors have zero test coverage; deleting the implementing code passes the whole suite today:

1. **`baseBranch` stale-checkout protection.** workflow.js threads `args.baseBranch` into the setup prompt ("Check out the base branch X first.") — no sim scenario passes `baseBranch`. New `scenarioBaseBranchThreaded`: launch with `baseArgs`-style args plus `baseBranch: 'main'`, capture the `setup` prompt, assert `/Check out the base branch main/.test(setupPrompt)`; also run one without `baseBranch` and assert the sentence is absent.
2. **Reconcile model is part of the documented tier contract** ("reconcile is a fixer, not a reviewer, so it tracks the implementer-side mostCapable") — never asserted. Extend the existing `scenarioPortability` (or add a small scenario): force a merge `CONFLICT` once so a `reconcile:` dispatch happens, capture its `opts.model`, and assert it equals the overridden `mostCapable` value when `tierOverrides: { mostCapable: 'sonnet' }` is supplied — proving overrides reach reconcile (the documented behavior after the cycle-3 doc truth-up) while the reviewer stays `opus` (already asserted elsewhere).
3. **Review base stays frozen across a SKIPPED wave.** Extend `scenarioFullyBlockedWaveDoesNotCascade`: capture the LAST `BASE: <sha>` occurrence in Z's implementer prompt (same technique as `scenarioBaseShaThreading`) and assert it equals the wave-1 merge headSha — i.e. the SKIPPED wave 2 did not advance or corrupt the review base.

- [ ] **Step 1: Add the three scenarios/extensions**, registering any new scenario in the await-list.
- [ ] **Step 2: Run** `node tests/sim_workflow.mjs` — `ALL SCENARIOS PASSED` (these pin existing behavior; if any assertion fails, the code — not the test — is wrong: investigate and report).
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add tests/sim_workflow.mjs && git commit -m "test: pin baseBranch threading, reconcile tier override, frozen base across SKIPPED waves"`.

### Task 4: Compat pins round 3 — executing-plans posture, Tech Stack token, delegation line

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_superpowers_compat.py`

Three unpinned interop claims (superpowers 5.1.0 installed; nothing skips). Append:

```python
def test_executing_plans_still_runs_continuously():
    text = (installed() / "skills/executing-plans/SKILL.md").read_text()
    assert "execute all tasks" in text.lower(), (
        "executing-plans changed its continuous-execution posture — "
        "plan-markers.md Executor variance covers both sequential executors; re-audit it")


def test_writing_plans_header_still_carries_tech_stack():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    assert "**Tech Stack:**" in text, (
        "writing-plans dropped the Tech Stack header line — "
        "ultrapowers SKILL.md Step 2 derives testCmd from it; re-audit the derivation")


def test_code_quality_reviewer_still_delegates_to_code_reviewer_template():
    text = (installed() / "skills/subagent-driven-development/code-quality-reviewer-prompt.md").read_text()
    assert "requesting-code-review/code-reviewer.md" in text, (
        "the code-quality reviewer no longer delegates to the code-reviewer template — "
        "reviewer-prompts.md's sourcing note and the re-bake procedure cite that delegation")
```

- [ ] **Step 1: Apply; run** `python3 -m pytest tests/test_superpowers_compat.py -q` — all pass, none skipped.
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add tests/test_superpowers_compat.py && git commit -m "test: pin executing-plans posture, Tech Stack header, code-reviewer delegation"`.

### Task 5: plan-markers.md + ultraplan — executor attribution, marker scope, disclosure precision, tilde fences

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`

CRITICAL: do NOT touch the `<!-- BAKE:MARKER_SYNTAX -->` / `<!-- BAKE:TYPE_SEMANTICS -->` blocks in plan-markers.md NOR their verbatim mirrors in ultraplan (tests/test_ultraplan_skill.py pins them against each other). Keep pinned strings (tests/test_marker_contract.py, test_ultraplan_skill.py): `**Type:**`, `**Depends-on:**`, all four type names, `worktree-pure`, `post-merge runbook`, `additive`, `fence-aware`, `## Executor variance`, `sequential executor`, `REQUIRED SUB-SKILL`, `ultrapowers:ultrapowers`, `Execution Handoff`, `superpowers:writing-plans`.

Six edits:

1. **plan-markers.md, Executor variance — correct the version attribution.** The sentence "Since superpowers 5.1.0, the sequential executors run **continuously**" misattributes: executing-plans dropped per-batch checkpoints in superpowers 5.0.0; subagent-driven-development's explicit directive landed in 5.1.0. Replace "Since superpowers 5.1.0, the sequential executors run **continuously** —" with "As of superpowers 5.1.0 both sequential executors run **continuously** (executing-plans dropped its batch checkpoints in 5.0.0; subagent-driven-development's explicit directive landed in 5.1.0) —". (A compat test pins both executors' posture.)
2. **plan-markers.md — marker scope note.** After the paragraph following the marker-syntax example (the one about `Depends-on` being additive), add: "`Depends-on` edges bind only between `implementation` tasks: a marker naming a `gate`/`release`/`manual` task (or an unknown id) is dropped at compile time and surfaced in `marker_conflicts` — ordering against excluded tasks is meaningless once they leave the wave set."
3. **plan-markers.md — conflict-note kinds.** The parenthetical "(the compiler's conflict note names which kind: file, read, text, or ambiguous-files)" doesn't match the literal labels. Replace with "(the compiler's conflict note carries the edge's literal `why` label: `write-after-create`, `write-after-write`, `read-after-write`, `text`, or `ambiguous-files`)".
4. **plan-markers.md — gate-axis disclosure precision.** The disclosure says the gate heuristic is "likewise [a] regex subset"; on the Files axis it is broader, not narrower: any task with no `Create:`/`Modify:` writes counts — including one whose Files block lists only `Test:` paths. In the disclosure paragraph, after "(an existence check, not a proof that every step is read-only)", insert ", and on the Files axis it is broader than the contract: a `Test:`-only Files block counts as 'no writes'".
5. **plan-markers.md — fence vocabulary + classification scope.** In the fence-aware compile-time obligation bullet, after "a heading inside a ``` code fence is content, not a section boundary", add "(tilde `~~~` fences too; classification evidence and text dependencies are likewise matched against fence-stripped prose only — fenced examples never drive classification or edges)".
6. **ultraplan SKILL.md — two small edits.** (a) In the Execution Handoff list, change "**Inline** — superpowers:executing-plans, batch execution with checkpoints." to "**Inline** — superpowers:executing-plans, batch execution (continuous since superpowers 5.0.0 — no per-task checkpoints)." (b) In the authoring rules, append to rule 1 (self-contained bodies): "Wrap embedded examples in code fences (``` or `~~~`) — fenced content never drives classification, edges, or task splitting."

- [ ] **Step 1: Apply the six edits**, mirrors and BAKE blocks untouched.
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md && git commit -m "docs: executor attribution, marker scope, disclosure precision, fence vocabulary"`.

### Task 6: dependency-analysis.md + SKILL.md — shared-Test rule, fence-stripped scanning, zero-impl routing, edges conversion, tierOverrides truth

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `skills/ultrapowers/SKILL.md`

Verify the compiler and workflow behavior on your branch first (both prerequisite tasks landed: WAW overlap now covers writes ∪ Test: paths with reachability yielding; workflow.js now throws on malformed `args.edges`). PINNED STRINGS that must survive: dependency-analysis.md — "## Classify" before "## Build the DAG", `plan-markers.md`, `**Depends-on:**`, `additive`, `marker_conflicts`, `post-merge runbook`, `preamble`, `fence-aware`, `dispositions`, `compile_plan.py`, `derived_knobs`, `"heuristic": true`; SKILL.md — `Classify first`, `post-merge runbook`, `` `meta.name` ``, `not found`, `restore the session checkout`, `git checkout <baseBranch>`, `Tested with superpowers N.N.N`, `scripts/compile_plan.py`, `ultrapowers-probe`, `tests.passed`, `git checkout <integrationBranch>`.

Six edits:

1. **dependency-analysis.md — reads bullet truth-up (shared-Test rule).** Replace the current reads bullet ("**reads** = `Test:` paths. A reader generates no outbound edges, but when another task writes a path this task reads, the compiler adds an edge writer → reader (`why: \"read-after-write\"`) — you cannot test a file that does not exist yet.") with: "**reads** = `Test:` paths. Two effects: a task that `Test:`s a path another task writes depends on the writer (`why: \"read-after-write\"`), AND `Test:` paths count toward the write-after-write overlap — upstream TDD tasks WRITE their test files, so two tasks sharing any path (written or tested) serialize in document order unless an explicit or semantic edge orders them."
2. **dependency-analysis.md — rule 3 (write-after-write) alignment.** Append to that rule: "The overlap set is `writes ∪ Test:` paths on both sides (see the reads bullet)."
3. **dependency-analysis.md — rule 4 fence note + precedence wording.** In rule 4 (text dependencies), after "(case-insensitive, where A is the task NUMBER exactly as written in the heading)", insert "— matched against fence-stripped prose only; fenced examples never create edges". And in the precedence note, replace "yield to any opposing explicit or semantic edge" with "yield to any opposing explicit or semantic PATH (reachability through earlier edges, not just a direct reverse edge)".
4. **dependency-analysis.md — residual runbook phrasing.** The dispositions list still says the runbook is "handed to `superpowers:finishing-a-development-branch` on approval". Replace that ending with "carried by the orchestrating agent through the finishing-a-development-branch handoff (the upstream skill accepts no checklist input)".
5. **SKILL.md Step 2 — zero-implementation routing.** After the compiler-invocation bullet, add: "If the compiler reports `no implementation tasks` (gates/release/manual only — `waves: []`), do NOT launch the workflow (it refuses empty waves): compile the gates into run config as usual, then go straight to a Step-5-style presentation of the post-merge runbook for the human to execute or schedule."
6. **SKILL.md Step 4b — edges conversion + tierOverrides truth.** (a) In the `edges` bullet, append: "Convert the compiler's `dag_edges` objects to bare pairs (`[e.from, e.to]`) — the workflow throws on malformed entries rather than silently disabling dependency blocking." (b) Replace the `tierOverrides` parenthetical "(reviewers stay at the strongest model regardless)" with "(reviewers and the completeness critic stay at the strongest model regardless; setup/merge run at the overridden `cheap`, and reconcile/fix-rounds at the overridden `mostCapable`)".

- [ ] **Step 1: Apply the edits.**
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/dependency-analysis.md skills/ultrapowers/SKILL.md && git commit -m "docs: shared-Test serialization, fence-stripped scanning, zero-impl routing, edges conversion, tier truth"`.

### Task 7: reviewer-prompts.md + workflow-template.md — DONE_WITH_CONCERNS downgrade, tier truth, dead fields, containment scope

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`

CRITICAL: do NOT touch the BAKE blocks in reviewer-prompts.md (tests/test_no_prompt_drift.py). Four edits, all outside them:

1. **reviewer-prompts.md — DONE_WITH_CONCERNS headless downgrade.** Upstream SDD addresses correctness concerns BEFORE review; headless ultrapowers logs them and proceeds straight to review. The headless-downgrade paragraph covers NEEDS_CONTEXT and BLOCKED only. Append: "`DONE_WITH_CONCERNS` is likewise downgraded: upstream addresses the concerns before review; headless, the independent review pass IS that check — concerns are logged as judgment calls, surfaced at the pre-merge gate, and never block dispatch of the review."
2. **reviewer-prompts.md — tier-table footnote.** Below the Model tiers table, the line about reviewers always running at most-capable stays; extend the surrounding prose with: "`tierOverrides` reaches every non-review role: setup and merge run at the overridden `cheap`, reconcile and fix-rounds at the overridden `mostCapable`. Only the reviewer and completeness-critic models are pinned to the default most-capable, override-proof."
3. **workflow-template.md — dead advisory fields.** Replace "**Only `id` and `body` are validated per task; `title`, `tier`, `acceptance`, `files`, and `review` are advisory inputs the prompts consume.**" with "**Only `id` and `body` are validated per task. `title` (completeness task list), `tier` (model selection), and `review` (per-task depth) are consumed; `acceptance` and `files` are currently UNUSED by the workflow — the verbatim `body` is authoritative for acceptance criteria and file lists.**"
4. **workflow-template.md — containment scope + tier truth.** (a) In the failure-containment bullet, replace "a thrown `agent()` call degrades to one failed task (`reviewVerdict: 'agent-error'`), never the run" with "a thrown task-pipeline `agent()` call degrades to one failed task (`reviewVerdict: 'agent-error'`); merge/reconcile/integration throws are caught and contained; the one deliberate exception is SETUP — a failed setup aborts the run before any task spends tokens". (b) In the model-tier section, replace "Reviewers always run at `most-capable` (`opus`), regardless of overrides to the implementer tiers." with "Reviewers and the completeness critic always run at the DEFAULT `most-capable` (`opus`), override-proof; every other role follows the override-merged map (setup/merge at `cheap`, reconcile/fix at `mostCapable`)."

- [ ] **Step 1: Apply the four edits**, BAKE blocks byte-identical.
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/references/workflow-template.md && git commit -m "docs: DONE_WITH_CONCERNS downgrade, override-proof tier truth, dead advisory fields, containment scope"`.

### Task 8: Sweep — count only successful removals

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `tests/test_sweep_worktrees.py`

The `removed_worktrees` counter increments even when BOTH `git worktree remove` and the `rm -rf` fallback fail (the warn path), so the summary overstates. Fix: increment only on success —

```bash
if git -C "$ROOT" worktree remove --force --force "$wt" 2>/dev/null; then
  removed_worktrees=$((removed_worktrees + 1))
elif rm -rf "$wt" 2>/dev/null; then
  removed_worktrees=$((removed_worktrees + 1))
else
  echo "warn: could not fully remove $wt — inspect manually" >&2
fi
```

- [ ] **Step 1: Strengthen the existing test** — in `test_sweep_warns_but_finishes_when_rm_fails`, add `assert "1 worktree(s) removed" in p.stdout` (only `wf_zzz-real` actually goes; the protected stale dir must not be counted). Run it, confirm it fails (today it reports 2).
- [ ] **Step 2: Apply the fix; re-run** — `python3 -m pytest tests/test_sweep_worktrees.py -q`, all pass.
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py && git commit -m "fix: sweep summary counts only successful removals"`.

### Task 9: report-format.md + wave-merge.md — budget-deferral routing, branch-lock phrasing, detection-ladder pin

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `tests/test_canary.py`

CRITICAL: do NOT touch wave-merge.md's five BAKE blocks. Verify on your branch that workflow.js now logs mid-run budget deferrals and records one judgment call for them (the workflow-semantics prerequisite added both). Keep report-format pinned strings (`Post-merge runbook`, `Step-2`, `finishing-a-development-branch`, `blockedWaves`, `Blocked waves`, `tests.passed`, `git checkout <integrationBranch>`, `SKIPPED`, no `clean up worktrees`). Three edits plus one test:

1. **report-format.md — `judgmentCalls` budget wording.** In the row's list, replace "budget deferrals" with "budget deferrals (one judgment call at launch-time exhaustion and one for the first mid-run deferral; every deferred task is itemized in `unfinished`)".
2. **wave-merge.md — No Silent Caps row for budget.** Add a table row: "| Budget exhausted (launch or mid-run) | `log()` | `unfinished` (`deferred (budget exhausted…)`) + one `judgmentCalls` entry |".
3. **wave-merge.md — branch-lock phrasing.** Replace "Branches are locked for the duration of the run." with "Branches are locked while their worktree exists (the merge agent removes merged branches' worktrees mid-run; failed/blocked branches stay locked until swept)."
4. **Detection-ladder pin** — the default test-command ladder is prose in wave-merge.md and code in workflow.js with no tripwire. Append to `tests/test_canary.py`:

```python
def test_default_test_detection_ladder_matches_wave_merge_doc():
    ladder = "pnpm check, npm test, pytest, cargo test, or go test ./..."
    wf = WORKFLOW.read_text()
    doc = (ROOT / "skills/ultrapowers/references/wave-merge.md").read_text()
    assert ladder in wf, "workflow.js reworded the detection ladder — update wave-merge.md and this pin"
    assert ladder in doc, "wave-merge.md reworded the detection ladder — update workflow.js and this pin"
```

- [ ] **Step 1: Add the canary test, run it** — `python3 -m pytest tests/test_canary.py -q` (it should pass already — both sides carry the string today; it pins future drift; if it fails, fix whichever side reworded).
- [ ] **Step 2: Apply the three doc edits.**
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/report-format.md skills/ultrapowers/references/wave-merge.md tests/test_canary.py && git commit -m "docs: budget-deferral routing, branch-lock phrasing; pin the detection ladder"`.

### Task 10: Full-suite gate

**Type:** gate
**Depends-on:** none

**Files:** none (verification only)

- [ ] **Step 1:** Run: `python3 -m pytest tests/ -q` — every test green, zero failures.
- [ ] **Step 2:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — `skill ok`.
- [ ] **Step 3:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — `skill ok`.
- [ ] **Step 4:** Run: `node tests/sim_workflow.mjs` — `ALL SCENARIOS PASSED`.
