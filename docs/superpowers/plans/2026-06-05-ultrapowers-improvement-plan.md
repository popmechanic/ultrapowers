# ultrapowers Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task. Tasks 2–5 are the
> candidates for parallel execution via `/ultrapowers` **once Task 1 confirms the engine launches**.
> Task 1 (the spike) is human-driven and is a hard go/no-go gate — do not dogfood the rest until it
> passes. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Note: several tasks touch shared files (`workflow.js`, `SKILL.md`, `README.md`), so ultrapowers'
> own dependency analysis will correctly serialize those into later waves. That is expected and is
> itself a useful dogfood signal.

**Goal:** Rework ultrapowers so its launch mechanism sits on a documented, durable surface (saved
workflow + `args`), its per-task review pipeline follows superpowers' lean direction (one `opus`
review pass, not two), and its per-project assumptions are parameterized through `args` — then
dogfood the result.

**Spec:** `docs/superpowers/specs/2026-06-05-ultrapowers-improvement.md`

**Tech Stack:** Claude Code plugin format, Dynamic Workflows (saved-workflow surface), `superpowers`
skills (soft dependency), Python 3 + pytest, Node for the orchestration simulation, git worktrees.

---

## Status (2026-06-05)

The spike-independent tasks were implemented directly (test-first, suite green at each step). The
operator chose to **skip dogfooding** and proceed classic-superpowers style after confirming this
(web/cloud) surface exposes **no `Workflow` tool** — so the workflow-engine tasks can't be launched
or validated here regardless of execution style.

| Task | Status |
|---|---|
| 1 — Spike (launch + handoff) | ⛔ **Dropped** — needs the live `Workflow` tool, absent on this surface. |
| 2 — Ground-truth corrections | ✅ **Done** — `af5e836` |
| 3 — Launch pivot | ⏸ **Deferred to an interactive session** — moot without the workflow engine; nothing for a sequential executor to launch. |
| 4 — Review + cost rework | ✅ **Done** — `fd43f90` |
| 5 — Portability (args knobs) | ✅ **Done** — `449ae5c` |
| 6 — Dogfood + finish | ⛔ **Skipped** (operator decision). |
| + Integration reporting | ✅ **Done** — `262df14`: per-wave `waveMerges[]` in the report (de-risk the merge black box) + environment-support docs. Launch-independent; done classic-superpowers style (test-first + independent review). |

---

## File Structure (target)

```
ultrapowers/
├── .claude-plugin/                    # manifest + marketplace (distribution updated)
├── README.md                          # motivation reframed; install updated for saved-workflow
├── skills/ultrapowers/
│   ├── SKILL.md                       # front door: validate plan, compute waves, gate, hand off
│   ├── workflow.js                    # orchestration skeleton (relocated/installed to .claude/workflows)
│   └── references/                    # reviewer-prompts (single reviewer), workflow-template, etc.
├── tests/                             # drift + simulation updated for single-reviewer + new args
└── docs/superpowers/{specs,plans}/    # this plan + the 2026-06-05 spec
```

---

### Task 1: Spike — prove the saved-workflow launch + handoff (GATE)

De-risk the core bet before any rebuild: that ultrapowers can launch on the **documented saved-workflow
surface** and receive a computed wave plan through `args`. This is the operator's first dogfood run.
Spike artifacts live in `/tmp/ultrapowers-spike-2/` and are **not committed**.

**Files:**
- Create (scratch, not committed): `/tmp/ultrapowers-spike-2/notes.md`

- [ ] **Step 1: Confirm the environment supports workflows.** Verify Claude Code ≥ v2.1.154, a paid
  plan, and that `disableWorkflows` is not set (`/config`; the `ultracode` keyword highlights and
  `/effort` offers `ultracode`). Record the version in `notes.md`.
- [ ] **Step 2: Save a minimal `/ultrapowers-probe` workflow.** With the `ultracode` keyword, have
  Claude author a one-phase workflow that reads `args`, normalizes the object-or-JSON-string delivery,
  and returns `{ rawType, argsSeen, wavesType }` (mirror `tests/fixtures/args-probe.js`). Save it via
  `/workflows` → `s` to `.claude/workflows/`. Confirm it appears as a slash command.
- [ ] **Step 3: Invoke the saved workflow with structured args.** Run `/ultrapowers-probe` with
  `args = { waves: [[{ id: 'probe' }]] }`. Expected: `argsSeen` includes `waves`, `wavesType: 'array'`.
  Record the exact delivery form (object vs JSON string) in `notes.md`.
- [ ] **Step 4: Prove the skill→workflow handoff.** Determine how the `/ultrapowers` **skill** hands
  computed `waves` to the saved workflow: can the skill trigger the saved workflow with a structured
  `args` object, or must a human invoke `/ultrapowers <plan>`? Record which mechanism fires and where
  the wave-approval gate sits relative to the headless launch.
- [ ] **Step 5: GATE — decide go / no-go.** If the saved-workflow launch + args delivery + handoff all
  work, proceed to the rebuild targeting that surface. If the handoff does not work, STOP and record
  the fallback (keep the path-launch but document it as preview-dependent) in `notes.md` and surface it
  to the human before continuing.
- [ ] **Step 6: No commit** (spike is scratch).

---

### Task 2: Ground-truth corrections (reframe + factual fixes)

Correct the record so the project is grounded in what superpowers actually does. Independent of the
launch rebuild except where it shares `SKILL.md` / `README.md`.

**Files:**
- Modify: `README.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `docs/superpowers/specs/2026-06-02-ultrapowers-design.md`

- [ ] **Step 1: Reframe the motivation.** In `README.md` and the 2026-06-02 spec, replace the
  "human gate is in the wrong place / autonomy" framing with "ultrapowers' value is **parallel
  throughput on decomposable work**; superpowers is already headless between tasks." Keep it factual.
- [ ] **Step 2: Fix the misattribution.** Wherever the "Never … dispatch multiple implementation
  subagents in parallel (conflicts)" prohibition is cited, attribute it to
  `superpowers:subagent-driven-development`, not `superpowers:dispatching-parallel-agents`.
- [ ] **Step 3: Tighten the plan detector.** In `SKILL.md` Step 1, change the heading check from
  `"Plan:"` to also accept `# … Implementation Plan` with `### Task N:` headings (the current
  superpowers `writing-plans` template). Keep the `**Files:**` + `- [ ]` fallback.
- [ ] **Step 4: Pin the baked-from version.** In `reviewer-prompts.md`, record the superpowers
  commit/release the discipline was baked from (note v5.0.6 / v5.1.0 as the upstream reference points),
  so a future re-bake has a diff to work against.
- [ ] **Step 5: Verify.** Run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
  → `skill ok`. Run `python3 -m pytest tests/ -q` → green.
- [ ] **Step 6: Commit** `docs: reframe motivation, fix attribution, tighten plan detector, pin baked version`.

---

### Task 3: Launch pivot to the saved-workflow surface

Relocate the orchestrator onto the documented saved-workflow surface and update the handoff +
distribution. Implements Task 1's confirmed mechanism. Depends on Task 1 (gate) and shares
`SKILL.md` / `README.md` with Task 2.

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Reconcile the launch step.** Rewrite `SKILL.md` Step 4 to launch via the saved-workflow
  mechanism confirmed in Task 1 (e.g. invoke `/ultrapowers` with `args = { waves, integrationBranch,
  stamp, dependencyEdges }`), removing the undocumented path-launch language and the `Workflow`-by-path
  framing. Keep the **wave-plan approval gate before launch** (headless run cannot gate mid-way).
- [ ] **Step 2: Confirm the orchestrator needs no path-launch assumptions.** Ensure `workflow.js`
  reads everything from `args` (it already does) and carries no committed path/`Workflow`-tool
  references. Update the maintainer notes in `workflow-template.md` to describe the saved-workflow
  install + invocation, replacing the path-launch description.
- [ ] **Step 3: Update distribution.** Update `README.md` install steps and the manifests so the
  workflow is installed to `.claude/workflows/` (document the install/copy step). Keep the plugin as
  the front door for the skill.
- [ ] **Step 4: Update the fallback.** Ensure `SKILL.md` Step 6 fallback (sequential
  `superpowers:subagent-driven-development`) still fires when the saved-workflow launch is unavailable.
- [ ] **Step 5: Verify.** `python3 -m pytest tests/ -q` and `validate_skill.py` → green; manually
  confirm `SKILL.md` no longer references an undocumented `Workflow`-tool path-launch.
- [ ] **Step 6: Commit** `feat: pivot launch to saved-workflow + args surface; update distribution`.

---

### Task 4: Review + cost rework (single opus reviewer, cap-2 fix loop)

Collapse the two-pass review into one independent `opus` review and tighten the fix loop, per the
spec's D3/D4/D5. Shares `workflow.js` with Task 3 (serialize after it).

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/test_no_prompt_drift.py`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/test_canary.py`

- [ ] **Step 1 (red): update the simulation expectations.** In `sim_workflow.mjs`, change the
  per-task pipeline to expect a single review pass (one `review:<id>:<iter>` agent, no separate
  `qual:`), fix-loop cap 2, reviewer at `opus`. Update `test_canary.py` assertions referencing the
  two-reviewer constants. Confirm the suite now FAILS against the current `workflow.js`.
- [ ] **Step 2: rewrite the source of truth.** In `reviewer-prompts.md`, replace
  `SPEC_REVIEWER_PROMPT` + `QUALITY_REVIEWER_PROMPT` with one `<!-- BAKE:REVIEWER_PROMPT -->` block
  that merges spec-compliance + code-quality (independent; do-not-trust-implementer; map every
  acceptance criterion; flag scope creep; check separation/error-handling/DRY/test-quality; run the
  suite). Set the fix-loop policy to cap 2. Keep the verdict schema.
- [ ] **Step 3 (green): re-bake into `workflow.js`.** Replace the two reviewer constants and the
  two-call section of `runTask` with the single `REVIEWER_PROMPT` pass; reviewer model stays
  `TIER.mostCapable` (`opus`); fix loop cap 2; implementers stay tiered. Update `meta`/labels as needed.
- [ ] **Step 4: update the drift test.** Adjust `test_no_prompt_drift.py`'s expected block list to
  `GUARD, IMPLEMENTER_PROMPT, REVIEWER_PROMPT`.
- [ ] **Step 5: Verify.** `python3 -m pytest tests/ -q` → green (drift + simulation + canary all pass
  with the single-reviewer pipeline).
- [ ] **Step 6: Commit** `feat: single opus review pass + cap-2 fix loop (follow superpowers v5.0.6 direction)`.

---

### Task 5: Portability — parameterize per-project variables through args

Push the per-project knobs into `args` so one frozen orchestrator fits several different web apps.
Defaults preserve current behavior. Shares `workflow.js` / `SKILL.md` with Tasks 3–4 (serialize last).

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `tests/sim_workflow.mjs`

- [ ] **Step 1 (red): add simulation coverage.** In `sim_workflow.mjs`, add a scenario passing
  `args.testCmd = 'make test'`, `args.reviewProfile = 'adversarial'`, and `args.tierOverrides`, and
  assert: the merge/integration agents use the supplied `testCmd`; `adversarial` restores a two-pass
  review; tier overrides change the implementer model. Confirm FAIL against current `workflow.js`.
- [ ] **Step 2: read the new args.** In `workflow.js`, read `testCmd`, `reviewProfile`
  (`lean` default | `adversarial`), and `tierOverrides` from the normalized `args`; thread `testCmd`
  into the `MERGE_PROMPT` / `COMPLETENESS_PROMPT` (override the detection ladder when present); make
  the review pass count depend on `reviewProfile`; apply `tierOverrides` over the `TIER` map. Keep all
  defaults equal to today's behavior when the fields are absent.
- [ ] **Step 3: document the contract.** Update `workflow-template.md` (the `args` contract) and
  `wave-merge.md` (test-command override) and `SKILL.md` (how the main agent populates the new fields
  per project). Note `reviewProfile: adversarial` as the opt-in for high-stakes tasks.
- [ ] **Step 4: Verify.** `python3 -m pytest tests/ -q` → green, including the new portability scenario.
- [ ] **Step 5: Commit** `feat: parameterize testCmd, reviewProfile, tierOverrides through args`.

---

### Task 6: Dogfood + finish

Execute a slice of this plan through the rebuilt ultrapowers and capture the run report as the
validation artifact.

**Files:**
- Create: `docs/superpowers/specs/2026-06-05-dogfood-report.md`

- [ ] **Step 1: Run the full static suite once more.** `python3 -m pytest tests/ -q` and
  `validate_skill.py skills/ultrapowers` → all green.
- [ ] **Step 2: Dogfood.** With Task 1 green, run `/ultrapowers` against a throwaway 2–3 task plan in a
  scratch repo (or a small slice of this very plan) and confirm: waves compute, the approval gate
  fires, the saved-workflow launches, the single-reviewer pipeline runs, and a structured pre-merge
  report returns. Capture the report in `docs/superpowers/specs/2026-06-05-dogfood-report.md`.
- [ ] **Step 3: Commit** `test: dogfood run report (engine launch validated end-to-end)`.
- [ ] **Step 4: Complete the branch.** REQUIRED SUB-SKILL: use
  `superpowers:finishing-a-development-branch` to decide merge / PR / cleanup.
