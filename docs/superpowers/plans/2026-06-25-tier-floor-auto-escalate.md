# Tier Resilience (auto-escalate + audit observability) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An implementer agent-error triggers one automatic retry at a stronger tier (recovering the run without operator salvage), and `audit_run.py` surfaces errored/escalated and thrashing implementers without needing same-model peers.

**Architecture:** Two independent changes. `waves.js` gains a pure `escalateTier` helper and a single bounded retry in `runTask`'s catch (harness logic, not a baked prompt). `audit_run.py`'s `audit()` gains `escalatedTasks` (a task with >1 implementer transcript) and `thrashCandidates` (absolute turns÷output heuristic).

**Tech Stack:** JavaScript (the committed `waves.js` harness), Python 3 standard library (`audit_run.py`), pytest, the `tests/sim_workflow.mjs` deterministic simulator.

**Acceptance:** suite — ultrapowers self-development; the operator reads every diff, and the committed pytest suite + the `sim_workflow.mjs` escalation cases + `test_no_prompt_drift` + adversarial review are the verification. No held-out exam. NOTE: `sim_workflow.mjs` is NOT in CI — the gate must run it explicitly (`node tests/sim_workflow.mjs`).

## Global Constraints

- No baked-prompt edits: do not change `references/reviewer-prompts.md` or `references/wave-merge.md`, and do not edit the embedded prompt *strings* in `waves.js`. `test_no_prompt_drift` must stay green. Only `waves.js` control-flow logic changes.
- `waves.js` stays launch-compatible — no change to the `args` contract.
- `audit_run.py`: Python 3 standard library only; no new dependencies. It is advisory by contract — a missing/empty/drifted dir returns a dict (now also with empty `escalatedTasks`/`thrashCandidates`), never raises.
- Escalation is bounded to exactly one retry; a second agent-error returns the same `failed`/`agent-error` result the engine produces today.
- `audit_run.py` thrash thresholds are tuned so healthy implementers are NOT flagged (a successful ~37-turn / ~90-tokens-per-turn implementer must stay clean).
- Tier ladder and model aliases (verbatim from the engine): `cheap→haiku`, `standard→sonnet`, `mostCapable→opus`; `tierKey` normalizes `most-capable`→`mostCapable`.

---

### Task 1: Auto-escalate on implementer agent-error (`waves.js`)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `escalateTier(name) -> name` (pure; ladder `cheap→standard→mostCapable`, top/unknown → `mostCapable`); `runTaskInner(task, baseSha, siblings, tierOverride)` (new optional 4th arg supersedes `task.tier` for model resolution); `runTask` retries once on a caught agent-error at `escalateTier(task.tier)` and records the escalation in `judgmentCalls`.

**Parallelization rationale:** `waves.js` is a different file from `audit_run.py` with no shared symbol — the audit's escalation detection reads agent transcripts (data), never this code. Genuinely independent of Task 2.

- [ ] **Step 1: Add the failing sim scenarios**

In `tests/sim_workflow.mjs`, add these two scenario functions immediately before the final runner block (the `Promise.all([...])` / sequence of `scenario*()` calls at the bottom):

```javascript
// ── Scenario: tier escalation — first impl throws, retry at next tier succeeds ──
async function scenarioEscalateRecovers() {
  const ONE = [[{ id: 'A', title: 't', body: 'b', tier: 'cheap' }]]
  const implModels = []
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label.startsWith('impl:')) {
      implModels.push(opts.model)
      if (implModels.length === 1) throw new Error('subagent completed without calling StructuredOutput')
      return { status: 'DONE', summary: 's', branch: 'wt-A', headSha: 'sha-A', commit: 'c-A' }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: { ...baseArgs, waves: ONE, dependencyEdges: [] }, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a && a.status === 'done', 'escalate: task A recovered to done (got ' + JSON.stringify(a) + ')')
  eq(implModels[0], 'haiku', 'escalate: first attempt ran at cheap/haiku')
  eq(implModels[1], 'sonnet', 'escalate: retry ran at escalated standard/sonnet')
  assert(r.judgmentCalls.some((j) => /escalat/i.test(j) && j.includes('A')), 'escalate: escalation recorded in judgmentCalls')
  console.log('scenario escalate-recovers: OK')
}

// ── Scenario: escalation bounded — two throws → task fails (exactly one retry) ──
async function scenarioEscalateBounded() {
  const ONE = [[{ id: 'A', title: 't', body: 'b', tier: 'cheap' }]]
  let implCount = 0
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label.startsWith('impl:')) { implCount++; throw new Error('persistent agent error') }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: { ...baseArgs, waves: ONE, dependencyEdges: [] }, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a && a.status === 'failed' && a.reviewVerdict === 'agent-error', 'bounded: task A failed after retry (got ' + JSON.stringify(a) + ')')
  eq(implCount, 2, 'bounded: exactly one retry — 2 impl attempts (got ' + implCount + ')')
  console.log('scenario escalate-bounded: OK')
}
```

Then add `await scenarioEscalateRecovers()` and `await scenarioEscalateBounded()` to the runner block at the bottom alongside the existing `await scenario*()` calls.

- [ ] **Step 2: Run the sim to verify the new scenarios fail**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `scenarioEscalateRecovers` asserts (task A is `failed`, not `done`, because the current `runTask` does not retry; `implModels` has length 1).

- [ ] **Step 3: Add the `escalateTier` helper**

In `skills/ultrapowers/harnesses/waves.js`, immediately after the `tierKey` definition (the line `const tierKey = (t) => (t === 'most-capable' ? 'mostCapable' : t)`), add:

```javascript
// Escalate a tier name one rung for the single post-error retry; the top tier
// (and any unknown tier) retries in place, so every agent-error yields exactly
// one retry. Mirrors the DEFAULT_TIER ladder; tierKey normalizes 'most-capable'.
const TIER_LADDER = ['cheap', 'standard', 'mostCapable']
const escalateTier = (t) => {
  const i = TIER_LADDER.indexOf(tierKey(t))
  if (i === -1) return 'mostCapable'
  return TIER_LADDER[Math.min(i + 1, TIER_LADDER.length - 1)]
}
```

- [ ] **Step 4: Thread `tierOverride` into `runTaskInner`**

In `runTaskInner`, change the signature from `async function runTaskInner(task, baseSha, siblings) {` to:

```javascript
async function runTaskInner(task, baseSha, siblings, tierOverride) {
```

and replace the model-resolution lines (currently):

```javascript
  const tierValue = Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))
    ? TIER[tierKey(task.tier)] : undefined
  const baseModel = (typeof tierValue === 'string') ? tierValue : TIER.standard
```

with:

```javascript
  const tierName = (typeof tierOverride === 'string') ? tierOverride : task.tier
  const tierValue = Object.prototype.hasOwnProperty.call(TIER, tierKey(tierName))
    ? TIER[tierKey(tierName)] : undefined
  const baseModel = (typeof tierValue === 'string') ? tierValue : TIER.standard
```

(The reported `economics.tier` already derives from `baseModel`, so the recovered task reports the escalated model.)

- [ ] **Step 5: Retry once in `runTask`'s catch**

Replace the entire current `runTask` function:

```javascript
async function runTask(task, baseSha, siblings) {
  try {
    return await runTaskInner(task, baseSha, siblings)
  } catch (e) {
    const msg = String((e && e.message) || e)
    judgmentCalls.push('task ' + task.id + ': agent error — ' + msg)
    log('task ' + task.id + ' FAILED on agent error: ' + msg)
    const safeTier = Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))
      ? TIER[tierKey(task.tier)] : undefined
    return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
             notes: msg, tier: (typeof safeTier === 'string') ? safeTier : TIER.standard,
             review: taskReviewProfile(task), fixIterations: 0 }
  }
}
```

with:

```javascript
const resolvedModel = (name) => {
  const v = Object.prototype.hasOwnProperty.call(TIER, tierKey(name)) ? TIER[tierKey(name)] : undefined
  return (typeof v === 'string') ? v : TIER.standard
}
async function runTask(task, baseSha, siblings) {
  try {
    return await runTaskInner(task, baseSha, siblings)
  } catch (e) {
    const msg = String((e && e.message) || e)
    const retryTier = escalateTier(task.tier)
    judgmentCalls.push('task ' + task.id + ': agent error at ' + (task.tier || 'standard') +
      ' — retrying once at ' + retryTier + ': ' + msg)
    log('task ' + task.id + ' agent error — escalating to ' + retryTier)
    try {
      const res = await runTaskInner(task, baseSha, siblings, retryTier)
      judgmentCalls.push('task ' + task.id + ': recovered after escalation to ' + retryTier)
      return res
    } catch (e2) {
      const msg2 = String((e2 && e2.message) || e2)
      judgmentCalls.push('task ' + task.id + ': agent error after escalation to ' + retryTier + ' — ' + msg2)
      log('task ' + task.id + ' FAILED after escalation: ' + msg2)
      return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
               notes: msg2, tier: resolvedModel(retryTier),
               review: taskReviewProfile(task), fixIterations: 0 }
    }
  }
}
```

- [ ] **Step 6: Run the sim to verify the new scenarios pass**

Run: `node tests/sim_workflow.mjs`
Expected: PASS — `scenario escalate-recovers: OK` and `scenario escalate-bounded: OK`, and every pre-existing scenario still prints `OK`.

- [ ] **Step 7: Document escalation in the report format**

In `skills/ultrapowers/references/report-format.md`, find the `judgmentCalls` row of the field-reference table and append this clause to its description (do not change any other text):

```
 Also records tier escalations: an implementer agent-error triggers one automatic retry at a stronger tier (cheap→standard→mostCapable), and the recovered task's reported `tier` reflects the escalated model; a second agent-error leaves the task failed.
```

- [ ] **Step 8: Confirm no prompt drift**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS (this change is harness logic only; no prompt strings moved).

- [ ] **Step 9: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/report-format.md tests/sim_workflow.mjs
git commit -m "feat(engine): auto-escalate implementer tier once on agent-error"
```

---

### Task 2: Audit observability — escalated + thrash signals (`audit_run.py`)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_audit_escalation.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `audit(transcript_dir)` dict gains `escalatedTasks` (sorted list of task ids with >1 implementer transcript) and `thrashCandidates` (list of agent dicts flagged by the absolute turns÷output heuristic). Both present (possibly empty) on every return path, including the missing-dir path.

**Parallelization rationale:** `audit_run.py` is a different file from `waves.js`; the escalation *signal* is detected from agent transcript files (data shape), with no dependency on Task 1's code. Independent of Task 1.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_audit_escalation.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"))
import audit_run


def _impl_file(d, n, task_id, model, turns, out_per_turn):
    lines = [json.dumps({"type": "user", "message": {"role": "user", "content": [
        {"type": "text", "text": f'You are an implementer subagent. Implement the object whose "id" is "{task_id}".'}]}})]
    for _ in range(turns):
        lines.append(json.dumps({"type": "assistant", "message": {"role": "assistant",
            "model": model, "usage": {"output_tokens": out_per_turn},
            "content": [{"type": "text", "text": "x"}]}}))
    (d / f"agent-{n}.jsonl").write_text("\n".join(lines) + "\n")


def test_escalated_task_detected(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-haiku-4-5-20251001", 5, 100)
    _impl_file(tmp_path, 2, "1", "claude-sonnet-4-6", 5, 200)
    out = audit_run.audit(tmp_path)
    assert out["escalatedTasks"] == ["1"]


def test_single_impl_not_escalated(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-sonnet-4-6", 5, 200)
    out = audit_run.audit(tmp_path)
    assert out["escalatedTasks"] == []


def test_thrash_flags_low_output_high_turns(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-haiku-4-5-20251001", 40, 10)  # 10 tok/turn, 40 turns
    out = audit_run.audit(tmp_path)
    assert [c["role"] for c in out["thrashCandidates"]] == ["impl:1"]


def test_thrash_ignores_healthy_implementer(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-sonnet-4-6", 37, 90)  # 90 tok/turn -> healthy
    out = audit_run.audit(tmp_path)
    assert out["thrashCandidates"] == []


def test_missing_dir_has_empty_signals(tmp_path):
    out = audit_run.audit(tmp_path / "nope")
    assert out["escalatedTasks"] == [] and out["thrashCandidates"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_audit_escalation.py -v`
Expected: FAIL — `KeyError: 'escalatedTasks'` (the key does not exist yet).

- [ ] **Step 3: Add the threshold constants**

In `skills/ultrapowers/scripts/audit_run.py`, near the top (after the imports / regex constants), add:

```python
# Absolute thrash heuristic (no same-model-peer requirement, unlike the relative
# misrank detector): an implementer doing many turns for little output. Tuned so
# healthy implementers (~90 tokens/turn) are not flagged; a genuine thrasher
# (<40 tokens/turn over >=30 turns) is.
THRASH_MIN_TURNS = 30
THRASH_MAX_PER_TURN = 40
```

- [ ] **Step 4: Compute and return the two signals in `audit()`**

In `audit()`, in the missing/empty-dir early return, add the two keys:

```python
    if not files:
        return {"agents": [], "totals": {"turns": 0, "outputTokens": 0},
                "misrankCandidates": [], "escalatedTasks": [], "thrashCandidates": [],
                "note": f"no agent-*.jsonl under {transcript_dir}"}
```

Then, just before the final `return` of the populated branch, compute the signals:

```python
    impl_by_task = {}
    for a in agents:
        if a["role"].startswith("impl:"):
            tid = a["role"].split(":", 1)[1]
            impl_by_task.setdefault(tid, []).append(a)
    escalated = sorted(tid for tid, lst in impl_by_task.items() if len(lst) > 1)
    thrash = [a for a in agents
              if a["role"].startswith("impl")
              and a["turns"] >= THRASH_MIN_TURNS
              and (a["outputTokens"] / a["turns"] if a["turns"] else 0) < THRASH_MAX_PER_TURN]
```

and add both keys to the returned dict:

```python
    return {"agents": agents, "totals": totals, "misrankCandidates": misrank,
            "escalatedTasks": escalated, "thrashCandidates": thrash}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_audit_escalation.py -v`
Expected: PASS (all five tests).

- [ ] **Step 6: Render the signals in the CLI**

In `main()`, after the existing tier-misrank block, add rendering so an operator running the script sees them:

```python
    audit_data = audit(Path(sys.argv[1])) if len(sys.argv) > 1 else None
    if audit_data:
        if audit_data.get("escalatedTasks"):
            print("\n**Escalated tasks** (an agent-error triggered a tier retry): " +
                  ", ".join(audit_data["escalatedTasks"]))
        if audit_data.get("thrashCandidates"):
            print("\n**Thrash candidates** (high turns / low output — likely wrong tier):")
            for a in audit_data["thrashCandidates"]:
                print(f"- {a['role']} on {a['model']}: {a['turns']} turns, "
                      f"{a['outputTokens']} output tokens")
```

(Place this so it does not disturb the existing table output; it reuses `audit()` rather than re-deriving rows. If `main()` already computes rows inline, leaving that intact and appending this block is correct — the duplicate read is advisory and cheap.)

- [ ] **Step 7: Run the full suite (no regression)**

Run: `python3 -m pytest tests/ -q`
Expected: PASS — the new file plus the existing suite (including `test_audit_refactor.py`) all green.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_escalation.py
git commit -m "feat(audit): surface escalated tasks + absolute thrash candidates"
```

---

### Task 3: Verification gate

**Type:** gate

**Files:** none — verification only; writes nothing.

Verification expectations (the suite is the acceptance authority):

- `python3 -m pytest tests/` → all pass (new `test_audit_escalation.py` + existing suite, including `test_no_prompt_drift.py`).
- `node tests/sim_workflow.mjs` → every scenario prints `OK`, including `escalate-recovers` and `escalate-bounded`. (Not in CI — run explicitly.)
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok` (exit 0).

`testCmd`: `python3 -m pytest`

---

### Task 4: Release (post-merge runbook)

**Type:** release

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

Carried verbatim into the post-merge runbook — not waved:

- Bump **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` from `0.0.19` to `0.0.20` (they must match).
- Commit on `main`: `chore(release): 0.0.20 — tier auto-escalate + audit observability`.
- The installed plugin picks up the new version only after `/plugin` re-resolves it and a new session starts.
