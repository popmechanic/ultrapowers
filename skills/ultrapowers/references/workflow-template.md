# Workflow Maintainer Guide (`workflow.js`)

This skill ships a **committed** Dynamic Workflow at `skills/ultrapowers/workflow.js`. It is **not
authored at runtime** — the main agent (SKILL.md) only computes waves and launches it. This file
documents the committed script's structure, its input contract, and the procedure for re-baking the
Superpowers discipline when it changes.

## What the script is

A pure orchestrator. The workflow runtime executes it headlessly in the background; the script body
has **no shell or filesystem access** — only `agent()` calls do work (clone, edit, commit, merge,
test). Runtime globals: `agent(prompt, opts)`, `parallel(thunks)`, `phase(title)`, `log(msg)`,
`args`, `budget`. The file is ESM (`export const meta`) with top-level `await` and a top-level
`return`; this is the engine's wrapped dialect (see "Syntax checking" below).

## Input contract (`args`)

The skill launches the workflow with:

```
args = { waves, integrationBranch, stamp, dependencyEdges,
         testCmd, reviewProfile, tierOverrides }
```

- `args.waves` — `Task[][]`, each task `{ id, title, body, tier, acceptance, files }`. `body` is the
  full verbatim task text (the script cannot resolve file references). **Required.**
- `args.integrationBranch` — e.g. `ultra/integration-<stamp>` (falls back to `ultra/integration-<stamp>`).
- `args.stamp` — a timestamp string (the script cannot call `Date.now()`).
- `args.dependencyEdges` — human-readable edges for the report (optional).

**Per-project knobs (all optional; omitting any preserves prior behavior):**

- `args.testCmd` — exact project test command (e.g. `'make test'`, `'pnpm -w test'`). Overrides the
  built-in detection ladder in the merge and completeness prompts. Use for monorepos / custom runners.
- `args.reviewProfile` — `'lean'` (default: one independent review pass per task) or `'adversarial'`
  (two independent reviewers over the same diff, findings unioned) for high-stakes tasks.
- `args.tierOverrides` — remap model tiers per project, e.g. `{ cheap: 'sonnet' }`. Merged over the
  default `TIER` map. The plan's `most-capable` tier name is normalized to the `mostCapable` key.

The script **validates `args.waves` and throws loudly** if it is missing or malformed, converting a
silent `undefined` (which historically caused agents to mutate the session repo) into a safe, loud
failure that never touches git.

### Args-population note (the one risk to verify)

Live validation on 2026-06-02 saw `args` **fail to populate** the script globals for an *ad-hoc*
launch, leaving the target `undefined`. The current docs state `args` populates for committed/saved
workflows. Before relying on it for a real run, run the one-time **probe** (`tests/fixtures/args-probe.js`):
launch it via the real `/ultrapowers` install path with `args = { waves: [[{ id: 'probe' }]] }` and
confirm it reports `waves` as an array.

- **Probe passes** → the `args.waves` path is safe (current default).
- **Probe fails** → switch SKILL.md to the **temp-file fallback**: the main agent writes the waves
  JSON to a temp path and the workflow's phase-0 `agent()` reads it (agents have fs access) and
  returns parsed JSON, which the script then validates. The script must still never proceed on
  `undefined`.

**Probe result (2026-06-03, claude v2.1.161 via `claude --plugin-dir ... -p`):** `args` arrived as a
raw **JSON string** (`rawType: "string"`), not a parsed object — so `args.waves` was `undefined` until
parsed. Fix applied: `workflow.js` now `JSON.parse`s `args` when `typeof args === 'string'` before
reading `.waves` (and throws if the string is not valid JSON). After the fix the probe returns
`{ rawType: "string", argsSeen: ["waves"], wavesType: "array" }`. The defensive parse handles both
delivery forms (object or string), so the temp-file fallback is **not** needed. Re-run the probe if a
future Claude Code version changes how `args` is delivered.

Either way, the **GUARD** (baked into every agent prompt) is the backstop: it forbids any `git` in an
unrelated repo or a cwd fallback.

## No external target path

Task agents run with `isolation: 'worktree'`, which provisions a worktree **in the session repo**
natively; the non-isolated roles (setup, merge, reconcile, integration) operate on the session repo's
main checkout by design. So the script carries **no absolute repo path** — the old "bake the REPO
literal" rule is obsolete. Run the skill from inside the target repo.

## Structure (read the file for specifics)

- `meta` + `meta.phases` computed from `WAVES` as `{ title: 'Wave N' }` objects (+ Setup, Integration Review).
- Baked constants: `GUARD`, `IMPLEMENTER_PROMPT`, `REVIEWER_PROMPT` (spec-compliance + code-quality
  merged), `SETUP/MERGE/RECONCILE/COMPLETENESS_PROMPT`, and the `*_SCHEMA` objects.
- `runTask(task)` — implement (`isolation: 'worktree'`) → one independent review pass (spec-compliance
  + code-quality merged; **two** passes under `reviewProfile: 'adversarial'`) → bounded fix-loop
  (cap 2 = initial + 1, escalate to most-capable on re-dispatch).
- Wave loop — `phase('Setup')` then per wave: `parallel()` over `runTask`, **chunked at 16** (the
  engine's concurrency cap), then `mergeWave()` (non-isolated; reconciliation cap 2; cascade-block
  downstream on unrecoverable failure).
- `phase('Integration Review')` — completeness critic + full test run.
- Returns the structured report from `report-format.md`.

### Concurrency math

The engine allows **up to 16 concurrent agents** (1000 total per run). Peak concurrency equals the
**wave width**, because each task's pipeline (impl → spec → quality → fix) is internally sequential —
the reviewers do not multiply concurrency. The wave loop therefore chunks any wave wider than 16.

### Model-tier mapping (single source)

`reviewer-prompts.md` names tiers `cheap` / `standard` / `most-capable`; the workflow `agent()` API
takes the Claude aliases `haiku` / `sonnet` / `opus`. The mapping lives in **one place**, the `TIER`
constant in `workflow.js`, and `args.tierOverrides` is merged over it per run (`most-capable` is
normalized to the `mostCapable` key; unknown tiers fall back to `standard`). Reviewers always run at
`most-capable` (`opus`), regardless of overrides to the implementer tiers.

**Verified live (2026-06-03):** `small` / `medium` / `large` are **not** valid model identifiers —
the agent returns "There's an issue with the selected model" and does no work — whereas
`haiku` / `sonnet` / `opus` work. Re-verify with a model probe if a future version changes the
accepted identifiers.

## Re-bake procedure (when Superpowers discipline changes)

1. Update the canonical prose in `references/reviewer-prompts.md` (implementer/spec/quality/GUARD,
   inside the `<!-- BAKE:NAME -->` markers) and the merge/setup/reconcile prompts in
   `references/wave-merge.md`.
2. Copy the changed wording into the corresponding `const` blocks in `workflow.js`. Formatting need
   not match (the drift test normalizes away markdown/backticks/punctuation), but the **words must**.
3. Run `python3 -m pytest tests/test_no_prompt_drift.py` — it fails until the baked copy matches the
   source. Iterate until green.

## Syntax checking

Because the file mixes `export`, top-level `await`, and a top-level `return`, plain `node --check`
**false-passes**. Validate by wrapping (strip `export`, wrap in an async function) and running
`node --check --input-type=commonjs` — this is exactly what `tests/test_canary.py::test_workflow_parses_as_js`
does.
