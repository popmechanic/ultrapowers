# Workflow Maintainer Guide (`waves.js`)

This skill ships a **committed** Dynamic Workflow at `skills/ultrapowers/harnesses/waves.js`. It is **not
authored at runtime** — the main agent (SKILL.md) only computes waves and launches it. This file
documents the committed script's structure, its input contract, and the procedure for re-baking the
Superpowers discipline when it changes.

## Install path (saved workflow)

The canonical sources live under `skills/ultrapowers/harnesses/` — each harness has a
`*.harness.json` manifest naming its file, purpose, and fixture/drift-test paths. At launch time,
SKILL.md Step 4a reads each manifest and copies the harness file to `.claude/workflows/` in the
target project, because saved workflows are the documented deterministic launch surface (run by
`meta.name`, with `args`) and plugins cannot ship them. Specifically:
- `harnesses/waves.js` → `.claude/workflows/waves.js` (installed name; launches by `meta.name` `ultrapowers-run` — NOT `ultrapowers`, which would shadow the `/ultrapowers` skill command; see `docs/bugs/2026-06-15-ultrapowers-command-collision.md`)
- `harnesses/probe.js` → `.claude/workflows/probe.js` (installed name; launches by `meta.name` `ultrapowers-probe`)

The installed copies are disposable: they are overwritten on every run and must never be edited in
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
         baseBranch, planPath, wavesPath?, resume?, testCmd?, bootstrapCmd?,
         reviewProfile?, tierOverrides?, acceptance? }
```

- `args.waves` — `Task[][]`, each task `{ id, title, body, tier, acceptance, files, review?, testCmd? }`. `body`
  is the full verbatim task text (the script cannot resolve file references). `review` is the optional
  per-task depth (`'adversarial'` | `'lean'`) the orchestrating agent derives from the task's
  risk/tier; it overrides the run-wide `reviewProfile`. **`id` is always validated per task. `body` is
  validated UNLESS `args.wavesPath` is supplied (see below), in which case each task agent reads its own
  verbatim body from that file by id. `title` (completeness task list), `tier` (model selection),
  `review` (per-task depth), and `testCmd` (per-task test command) are consumed; `acceptance` is
  currently UNUSED; `files` is threaded into the implementer/reviewer prompts as the `FILES`
  declared-scope line (string array of the task's Create/Modify/Test paths). The verbatim `body` remains
  authoritative for acceptance criteria.**
- `args.wavesPath` — absolute path to a launch-ready waves file the compiler wrote
  (`compile_plan.py --emit-launch <path>`). It carries the FULL verbatim, fence-aware task bodies under a
  top-level `tasks` array keyed by `id`. **This is the first-class large-plan delivery path.** A
  multi-task plan's bodies can total tens of KB; an LLM orchestrator cannot reliably emit that as one
  escaped inline JSON value, and relaying it through a phase-0 agent fares no better (a model still has to
  echo every byte). So when `wavesPath` is supplied, the orchestrator passes only the LIGHT `launch_waves`
  inline (id/title/files/tier/review — no bodies), and each implementer/reviewer/fix agent reads its own
  verbatim body from the file **by absolute path** — the same fs-read mechanism `planPath` already uses.
  No model ever transcribes a body, and delivery does not depend on `baseBranch` containing the plan
  (the file is read off disk, not out of git). Inline bodies still work for small/back-compat plans, and
  the two forms can mix (a task with an inline `body` uses it; one without reads from the file).
- `args.integrationBranch` — required for resume; otherwise defaults to ultra/integration-<stamp>.
- `args.stamp` — a timestamp string (the script cannot call `Date.now()`).
- `args.dependencyEdges` — human-readable edges for the report (optional).
- `args.edges` — structured dependency pairs `[[fromTaskId, toTaskId], ...]` (optional; omitting it and supplying `[]` differ — see the SKIPPED-cascade note under Structure). A failed
  task blocks its transitive dependents (computed via fixed-point closure, re-checked before every
  16-task chunk) instead of letting them run against a base that never received the prerequisite.

**Per-project knobs (all optional; omitting any preserves prior behavior):**

- `args.testCmd` — exact project test command (e.g. `'make test'`, `'pnpm -w test'`). Overrides the
  built-in detection ladder in the merge and completeness prompts. Use for monorepos / custom runners.
  A per-task `task.testCmd` overrides it for that task's implementer/reviewer only (a polyglot plan may
  have Python tasks running `pytest` and Bun tasks running `bun test`); the merge and completeness roles,
  which test the integrated tree on the session main checkout, keep using the run-wide `testCmd` (so for
  polyglot repos set it to a command that exercises BOTH stacks, e.g. `pytest -q && (cd app && bun test)`).
- `args.bootstrapCmd` — a per-worktree setup command threaded into the FRESH, worktree-isolated roles
  (implementer, reviewer, fix) so they install dependencies before testing. Engine worktrees are cut
  clean from the integration HEAD: they have no `.venv`, no `node_modules`. A polyglot/monorepo repo
  (pytest at root + `bun test` in `app/`) needs its stacks installed in each worktree before any suite
  runs, e.g. `python3 -m venv .venv && .venv/bin/pip install -e . && (cd app && bun install)`. The
  non-isolated roles (setup/merge/reconcile/completeness) operate on the session main checkout, which
  already has its deps, so they do NOT run it.
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
- `args.acceptance` — optional sealed acceptance exam descriptor. Shape:
  `{ mode: 'sealed', sealId, sha256, scriptPath }` or `{ mode: 'waived', reason }` or
  `{ mode: 'suite', reason }`. When `sealed`,
  the orchestrator resolves `scriptPath` to the absolute path of `run_acceptance.sh` from the plugin
  root at launch (the workflow has no filesystem introspection). The runner command is
  `bash <scriptPath> <sealId> <integrationBranch> <sha256>`; it must print one JSON object
  `{ sealId, status: OK|SEAL_MISSING|SEAL_BROKEN|ERROR, passed, exitCode, output }` and exit 0 iff
  verified-and-passed. The engine treats the script as the authority; the agent only relays its
  stdout verbatim. When `suite`, no held-out exam is dispatched — the committed test suite
  is the acceptance authority; `report.acceptance.passed` mirrors `tests.passed` (the integration
  test result); a failing suite pushes a gate-blocking judgment call. When absent, `report.acceptance = null`.

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
parsed. Fix applied: `waves.js` now `JSON.parse`s `args` when `typeof args === 'string'` before
reading `.waves` (and throws if the string is not valid JSON). After the fix the probe returns
`{ rawType: "string", argsSeen: ["waves"], wavesType: "array" }`. The defensive parse handles both
delivery forms (object or string). Re-run the probe if a future Claude Code version changes how `args`
is delivered.

**Large-plan body delivery (supersedes the old "temp-file fallback is not needed" note).** The
above only fixes *delivery form*; it does not fix *size*. A real run (a 14-task plan with ~88KB of
task bodies, 2026-06-15) showed that an LLM orchestrator cannot reliably emit all bodies as one
inline JSON value — escaping and transcription risk are too high — and the symmetric "phase-0 agent
reads a temp file and returns the waves" handshake is no better, because a model still has to echo
every byte of the bodies. The implemented fix routes the bodies around every model: `compile_plan.py
--emit-launch <path>` writes the verbatim, fence-aware bodies to a file, the orchestrator passes
`args.wavesPath` plus the LIGHT inline `launch_waves`, and each task agent reads its own body from the
file by absolute path (see `args.wavesPath` above). This was a **code** change to `waves.js` (validation
+ dispatch construction), not a change to any baked discipline prompt, so the re-bake procedure below
did not apply — but the harness changed, so `waves.harness.json` `version` was bumped and the drift
(`test_no_prompt_drift.py`) and canary (`test_canary.py`) pins were re-confirmed green.

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
  unrecoverable MERGE failure). A wave with no mergeable branches records `SKIPPED` (integration branch untouched); it cascades conservatively only when `args.edges` was omitted (an explicitly supplied empty array counts as supplied — the compiler proved independence) and tasks actually ran.
- Failure containment: a budget exhausted at launch defers the whole run before setup (early
  return, every task in `unfinished`); mid-run exhaustion defers remaining waves/chunks; a thrown
  task-pipeline `agent()` call degrades to one failed task (`reviewVerdict: 'agent-error'`);
  merge/reconcile/integration throws are caught and contained; the one deliberate exception is
  SETUP — a failed setup aborts the run before any task spends tokens.
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
constant in `waves.js`, and `args.tierOverrides` is merged over it per run (per-task `most-capable` is normalized to the
`mostCapable` key and unknown *task* tiers fall back to `standard` with a judgment call; unknown
override *keys or model values* throw at launch). Reviewers and the completeness critic always run at the DEFAULT `most-capable` (`opus`), override-proof; every other role follows the override-merged map (setup/merge at `cheap`, reconcile/fix at `mostCapable`).

**Verified live (2026-06-03):** `small` / `medium` / `large` are **not** valid model identifiers —
the agent returns "There's an issue with the selected model" and does no work — whereas
`haiku` / `sonnet` / `opus` work. Re-verify with a model probe if a future version changes the
accepted identifiers.

## Re-bake procedure (when Superpowers discipline changes)

1. Update the canonical prose in `references/reviewer-prompts.md` (implementer/spec/quality/GUARD,
   inside the `<!-- BAKE:NAME -->` markers) and the merge/setup/reconcile prompts in
   `references/wave-merge.md`.
2. Copy the changed wording into the corresponding `const` blocks in `waves.js`. Formatting need
   not match (the drift test normalizes away markdown/backticks/punctuation), but the **words must**.
3. Run `python3 -m pytest tests/test_no_prompt_drift.py` — it fails until the baked copy matches the
   source. Iterate until green.

## Syntax checking

Because the file mixes `export`, top-level `await`, and a top-level `return`, plain `node --check`
**false-passes**. Validate by wrapping (strip `export`, wrap in an async function) and running
`node --check --input-type=commonjs` — this is exactly what `tests/test_canary.py::test_workflow_parses_as_js`
does.
