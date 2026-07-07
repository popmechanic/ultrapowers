# Single-channel task knobs (#89)

**Status:** approved 2026-07-07
**Issue:** [#89](https://github.com/popmechanic/ultrapowers/issues/89)
**Acceptance:** suite

## Problem

The engine reads per-task `tier` and `review` from the inline args wave entries
(`waves.js:635,659,688,708,716`) and never opens the launch file. The compiler
pre-emits `tier: null` slots into the launch file, and both the driver receipt
(`ultra_run.py` `llmDerives`) and SKILL.md Step 2 tell the orchestrator to fill
them there. The orchestrator fills slots the engine never reads.

Field evidence: all five foreign runs sensed 2026-07-07 (engines 0.0.31–0.0.32)
ran every implementer at the default tier with lean review, despite filled
launch-file slots — including tasks the plan marked `adversarial` and tasks the
orchestrator assigned `mostCapable`. This silently violates the per-task-tiering
hard rule and the authored-review-depth contract (#87).

## Root cause

Workflow scripts have no filesystem access — even the `wavesPath` preflight
dispatches an agent to read the file. Task bodies therefore ride on disk (task
agents read them by id), but knobs must ride inline in the args. The launch
file's knob slots could never work; `--emit-args`'s own help text ("adds only
per-task tier/review/testCmd and run knobs") records the original, correct
intent. The docs channel and the engine channel diverged, and the docs channel
won.

## Design

One representation change: the knob slots move to the object the engine reads.
`waves.js` is untouched.

### 1. `compile_plan.py` — slots on the args wave entries

Each `launch_waves` entry gains two keys:

- `"tier": null` — the orchestrator's judgment slot (Step 2 tier derivation).
  Valid fills: `cheap`, `standard`, `mostCapable` (the engine also accepts the
  plan-idiom alias `most-capable`, `waves.js:508`).
- `"review": <plan-authored value>` — filled from the task's `**Review:**`
  marker, `"lean"` when unmarked. The orchestrator never touches it.

`launch_waves` feeds both channels — `args.json`'s `waves` (driver path) and
the compiler's stdout `launch_waves` (hand-launch path) — so both get the same
shape.

The launch payload's tasks **drop** their `tier` and `review` keys. The launch
file returns to what task agents actually read from disk: verbatim `body` plus
identity and context (`title`, `files`, `depends_on`, `interfaces`,
`catchAll`).

### 2. `ultra_run.py` — guidance and validation

- The `llmDerives` receipt strings change from "tasks[].tier in the launch
  file" to "waves[][].tier in the args file"; review is described as pre-filled
  there from the plan's `**Review:**` markers. The existing warning against
  `tierOverrides` stays — that knob legitimately remaps tier names to models
  and is unaffected.
- `validate_knobs` (which already reads the args file for the `bootstrapCmd`
  check) additionally checks every wave entry: `tier` must be `null`,
  `cheap`, `standard`, `mostCapable`, or the alias `most-capable` (the same
  set the engine accepts); `review` must be present and `lean` or
  `adversarial`. A
  violation fails closed with a JSON verdict naming the offending task id —
  before sixteen worktrees spin up. The engine's runtime unknown-value
  judgment-call fallback stays as the second net.

### 3. `SKILL.md` — Step 2/4 wording

The four knob-placement passages (Step 2 tier fill, review slot description,
derived-knobs list, args-shape sketch) reworded to the args channel. Net word
count stays roughly flat; the complexity ratchet watches `skillWords`.

### 4. Tests — migrate the wrong-channel pins, pin against regrowth

- `test_emit_launch_pre_emits_tier_slots` → `test_emit_args_pre_emits_knob_slots`:
  every args wave entry carries `tier: null` and a valid `review`.
- New `test_emit_launch_carries_no_knob_slots`: the launch payload's tasks have
  no `tier` or `review` key — the dual channel cannot quietly regrow.
- `test_ultra_run.py` slot assertions migrate to the args shape; the receipt's
  `llmDerives` must reference the args file.
- The review-marker tests assert plan-authored `review` lands on the args
  entries.
- New `validate_knobs` tests: bad tier name → exit 1; bad or missing review →
  exit 1; clean args → exit 0.
- No `.mjs` changes: `sim_workflow.mjs` scenario 6 already pins that
  `task.tier` on a wave entry drives the dispatched model, and this change
  never touches harness JS.

## Error handling

`--validate-knobs` is the single pre-launch net: enum violations and missing
`review` keys exit non-zero with the task id and offending value in the JSON
verdict. Runtime behavior is unchanged.

## Compatibility

Free. The engine never read the launch-file slots, so removing them changes
nothing at runtime. Orchestrators that already hand-copied knobs onto wave
entries (the observed field workaround) were using the correct channel and
keep working.

## Non-goals

- No `audit_run.py` intended-vs-effective cross-check — the single channel
  deletes that divergence class by construction.
- No misrank retry annotation here — it is independent audit polish, tracked
  with #91.
- No `tierOverrides` removal, no `waves.js` change, no review-depth policy
  change.

## Verification

`python3 -m pytest` (the committed suite is the verification; no held-out
exam). The suite-gate's `.mjs` sims are not triggered — no harness JS changes.
