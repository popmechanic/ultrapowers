# Post-integration ancestry assertion (#70) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the final wave merge, cryptographically assert that every mergeable `done` task's commit is an ancestor of the integration HEAD — failing loud (BLOCKED) on any silent drop, instead of relying on a downstream dependency edge to surface the loss.

**Architecture:** The workflow **script (`waves.js`) has no shell or fs** (agents do — `wave-merge.md`). The existing cryptographic ground-truth check (`onIntegrationHead`, waves.js:1333) is therefore administered by the **completeness-critic agent**, which already sits on the integration HEAD and runs `git rev-parse HEAD`. #70 reuses that agent: the script accumulates the mergeable `{task, headSha}` set across all waves and passes it into the completeness prompt; the critic runs `git merge-base --is-ancestor <headSha> HEAD` for each and returns the misses; the script BLOCKs + records a `judgmentCall` + withholds `gitVerified` on any miss. Reuse, don't add a subsystem (issue ratchet note: minimal assertion, no new structure).

**Tech Stack:** JavaScript (`harnesses/waves.js` Workflow script), Markdown (`references/wave-merge.md` source prose), Python (`tests/test_no_prompt_drift.py` drift pin), Node (`tests/*.mjs` behavioral sim, manual).

## Global Constraints

- **Prompts are baked; edit the source, not the copy.** The ancestry-assertion prose is authored in `references/wave-merge.md` and baked into `waves.js` per `references/workflow-template.md`; `tests/test_no_prompt_drift.py` must stay green.
- **The script never shells out.** The git ancestry check is administered by the completeness-critic agent (fed the headSha set), never by `waves.js` directly.
- **Minimal assertion, no new structure** — reuse `isMergeable`, the per-wave `results`, and the existing completeness critic. Keep `engineLoc` near baseline.
- **No version bump, no direct Anthropic API calls.**
- **Worktree-pure tasks** — the executor owns branching.

## Suite-gate note

This plan's behavior lives in `waves.js` (JS). The committed **pytest** suite-gate
verifies the **baked-prose drift pin** and the script-side handling of an
`ancestryMisses` review result, but cannot execute the full JS flow. The behavioral
`.mjs` sim (Task 2) is run manually (`node`), not in CI/`pytest`. This entry is held
at the docket end gate for operator review rather than auto-trusted on a green gate
(see the 2026-07-01 shakedown JS-gate finding).

---

### Task 1: Critic-administered ancestry assertion

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: `isMergeable(r)` (waves.js:550); per-wave `results` (each mergeable result carries `task`, `branch`, `headSha`); `waveBaseSha` (final integration HEAD, waves.js:1266); `completenessPrompt(mergeHeadSha, cannotVerifyChecklist)` (waves.js:400); `REVIEW_SCHEMA` (waves.js:489); the `gitVerified` / `judgmentCalls` bookkeeping (waves.js:1333).
- Produces: an accumulated `mergedShas: [{task, headSha}]` set; an extended `completenessPrompt(mergeHeadSha, cannotVerifyChecklist, mergedShas)` instructing the critic to assert each headSha is an ancestor of HEAD and return `ancestryMisses`; a new `ancestryMisses` field on `REVIEW_SCHEMA`; a post-review block that BLOCKs the run (judgmentCall + `gitVerified` forced false) on any miss.

- [ ] **Step 1: Write the failing drift pin**

In `tests/test_no_prompt_drift.py`, add the ancestry-assertion prose block to the wave-merge.md → waves.js pins (a new `WAVE_BLOCKS` fragment asserting the ancestry paragraph's static wording appears, in order, in both `wave-merge.md` and `waves.js`). Follow the existing wave-merge pin pattern in that file.

- [ ] **Step 2: Run the pin to verify it fails**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: FAIL — the ancestry-assertion prose is not yet in `wave-merge.md`/`waves.js`.

- [ ] **Step 3: Author the source prose + bake it**

In `references/wave-merge.md` (Integration and Completeness Review section), add the ancestry-assertion contract: "the completeness critic, already on the integration HEAD, additionally asserts for each mergeable `done` task's recorded `headSha` that `git merge-base --is-ancestor <headSha> HEAD` succeeds; any miss is a silently dropped task and is returned under `ancestryMisses`; the controller treats a non-empty `ancestryMisses` as BLOCKED."

Then in `waves.js`:
1. Before the wave loop, `const mergedShas = []`. Inside the loop, after a MERGED wave, push the wave's mergeable results: `mergedShas.push(...results.filter(isMergeable).map(r => ({ task: r.task, headSha: r.headSha })))`.
2. Extend `completenessPrompt` to accept `mergedShas` and interpolate the ancestry instruction + the list (empty → omit).
3. Add `ancestryMisses` to `REVIEW_SCHEMA.properties` (`array` of `{task, headSha}`).
4. At the dispatch site (waves.js:1296) pass `mergedShas`.
5. After the review-null guard (waves.js:1324), add: if `review.ancestryMisses?.length`, push a judgmentCall naming each dropped task and force the run BLOCKED (withhold `gitVerified`/green).

Re-bake per `references/workflow-template.md` so the baked prose matches the source (keep the drift pin green).

- [ ] **Step 4: Run the pin to verify it passes**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS.

- [ ] **Step 5: (Manual, optional) behavioral sim**

Add `tests/wave_ancestry_sim.mjs` (a stubbed `results`/review harness like the other `tests/*.mjs` sims) exercising: a dropped headSha (not an ancestor) → BLOCKED + judgmentCall; all ancestors → clean. Run manually: `node tests/wave_ancestry_sim.mjs`. Not in `pytest`/CI (documented gap).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/test_no_prompt_drift.py tests/wave_ancestry_sim.mjs
git commit -m "feat(engine): assert every mergeable done task landed in the integration ancestry (#70)"
```

---

### Task 2: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all tests green, including the new ancestry drift pin.

---

## Acceptance

**Acceptance:** suite — ultrapowers' own engine change, verified by the committed pytest suite (the new drift pin in `test_no_prompt_drift.py`) plus adversarial diff review and the manual `.mjs` behavioral sim; no held-out exam. NB: the pytest gate does not execute the JS behavior (see the Suite-gate note); this entry is held at the docket end gate for operator review.
