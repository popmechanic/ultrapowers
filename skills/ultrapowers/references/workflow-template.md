# Workflow Maintainer Guide (`workflow.js`)

This skill ships a **committed** Dynamic Workflow at `skills/ultrapowers/workflow.js`. It is **not
authored at runtime** — the main agent (SKILL.md) only computes waves and launches it. This file
documents the committed script's structure, its input contract, and the procedure for re-baking the
Superpowers discipline when it changes.

## Install path (saved workflow)

The canonical source is `skills/ultrapowers/workflow.js` — the only copy that is edited, reviewed,
and drift-tested. At launch time, SKILL.md Step 4a copies it to
`.claude/workflows/ultrapowers-run.js` in the target project (and `probe.js` to
`.claude/workflows/ultrapowers-probe.js` for the Step-4a½ preflight), because saved workflows are
the documented deterministic launch surface (run by name, with `args`) and plugins cannot ship them.
The installed copy is disposable: it is overwritten on every run and must never be edited in
place. Never launch via the `ultracode` keyword — that makes Claude author a new script instead
of running this one.

## What the script is

A pure orchestrator. The workflow runtime executes it headlessly in the background; the script body
has **no shell or filesystem access** — only `agent()` calls do work (clone, edit, commit, merge,
test). Runtime globals: `agent(prompt, opts)`, `parallel(thunks)`, `phase(title)`, `log(msg)`,
`args`, `budget`. The file is ESM (`export const meta`) with top-level `await` and top-level
`return`s (the budget-exhausted early return and the final report); this is the engine's wrapped
dialect (see "Syntax checking" below).

## Input contract (`args`)

The skill launches the workflow with:

```
args = { waves, integrationBranch, stamp, dependencyEdges, edges,
         baseBranch, planPath, resume?, testCmd?, reviewProfile?, tierOverrides? }
```

- `args.waves` — `Task[][]`, each task `{ id, title, body, tier, acceptance, files, review? }`. `body`
  is the full verbatim task text (the script cannot resolve file references). `review` is the optional
  per-task depth (`'adversarial'` | `'lean'`) the orchestrating agent derives from the task's
  risk/tier; it overrides the run-wide `reviewProfile`. **Only `id` and `body` are validated per task;
  `title`, `tier`, `acceptance`, `files`, and `review` are advisory inputs the prompts consume.**
- `args.integrationBranch` — required for resume; otherwise defaults to ultra/integration-<stamp>.
- `args.stamp` — a timestamp string (the script cannot call `Date.now()`).
- `args.dependencyEdges` — human-readable edges for the report (optional).
- `args.edges` — structured dependency pairs `[[fromTaskId, toTaskId], ...]` (optional). A failed
  task blocks its transitive dependents (computed via fixed-point closure, re-checked before every
  16-task chunk) instead of letting them run against a base that never received the prerequisite.

**Per-project knobs (all optional; omitting any preserves prior behavior):**

- `args.testCmd` — exact project test command (e.g. `'make test'`, `'pnpm -w test'`). Overrides the
  built-in detection ladder in the merge and completeness prompts. Use for monorepos / custom runners.
- `args.baseBranch` — the repo's default branch; the setup agent checks it out before creating the
  integration branch (guards against a stale checkout from a previous run).
- `args.planPath` — path to the plan document; threaded into the completeness prompt so the critic
  reads and reviews against the actual plan.
- `args.resume` — boolean; the deterministic redirect path. Setup checks out the EXISTING
  integration branch instead of creating one, and the waves carry only the redirected tasks.
  Requires an explicit `args.integrationBranch` (throws otherwise).
- `args.reviewProfile` — the **run-wide default** review depth: `'lean'` (one independent review pass
  per task) or `'adversarial'` (two independent reviewers over the same diff, findings unioned). A
  task's own `review` field overrides it, so high-stakes tasks can go adversarial without paying for
  the extra pass on every task.
- `args.tierOverrides` — remap model tiers per project, e.g. `{ cheap: 'sonnet' }`. Merged over the
  default `TIER` map. The plan's `most-capable` tier name is normalized to the `mostCapable` key.
  Values are validated at launch against `haiku` / `sonnet` / `opus`; an unknown alias throws
  before any agent runs.

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

- `meta` + `meta.phases` computed from `WAVES` as `{ title: 'Wave N' }` objects (+ Setup, Integration Review). The assignment is wrapped in a typeof-guard because newer engines extract the meta literal at parse time and do not expose the binding to the executing body; phase() calls group progress regardless.
- Baked constants: `GUARD`, `IMPLEMENTER_PROMPT`, `REVIEWER_PROMPT` (spec-compliance + code-quality
  merged), `SETUP/MERGE/RECONCILE/COMPLETENESS_PROMPT`, and the `*_SCHEMA` objects.
- `runTask(task, baseSha)` — implement (`isolation: 'worktree'`) → one independent review pass (spec-compliance
  + code-quality merged; **two** passes under `reviewProfile: 'adversarial'`) → bounded fix-loop
  (cap 2 = initial + 1; the fix re-dispatch runs at most-capable and anchors its `BASE` to the
  prior implementation's HEAD, not the integration base). The implementer schema requires
  `headSha`; a `done` result without one is not mergeable.
- Wave loop — `phase('Setup')` then per wave: `parallel()` over `runTask`, **chunked at 16** (the
  engine's concurrency cap, with dependency failures re-checked per chunk), then `mergeWave()`
  (non-isolated; reconciliation cap 2; cascade-block downstream — logged per wave — on an
  unrecoverable MERGE failure). A wave with no mergeable branches records `SKIPPED` and does NOT
  cascade; the integration branch is untouched.
- Failure containment: a budget exhausted at launch defers the whole run before setup (early
  return, every task in `unfinished`); mid-run exhaustion defers remaining waves/chunks; a thrown
  `agent()` call degrades to one failed task (`reviewVerdict: 'agent-error'`), never the run.
- `phase('Integration Review')` — one completeness-critic agent runs the suite and reviews against
  the plan.
- Returns the structured report from `report-format.md`.

### Concurrency math

The engine allows **up to 16 concurrent agents** (1000 total per run). Peak concurrency equals the
**wave width**, because each task's pipeline (implement → review → fix) is internally sequential —
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
