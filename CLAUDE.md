# CLAUDE.md

## Purpose & vision

ultrapowers authors a plan and then executes it in parallel. It started as an
alternative execution engine for **superpowers**, the popular Claude Code skill for
software-engineering automation, and since #390 it owns the authoring end too
(`ultrawrite`). Where a sequential executor works a plan one task at a time,
ultrapowers compiles it into dependency-ordered waves and executes them on Claude
Code's native
[Workflows](https://code.claude.com/docs/en/workflows) feature, which orchestrates
parallelized subagents at scale across isolated git worktrees.

The aim is to move where humans spend their attention. ultrapowers keeps users
closely involved in **planning** — deciding what to build and how it will be
verified — and much less involved in **implementation**, which the engine fans out,
reviews, and integrates autonomously up to a single pre-merge gate. That makes
ambitious work approachable for less-technical operators: ultrapowers is built for
large, complex tasks that reward parallelism and independent verification.

This file is for agents **developing the plugin**; end-user docs are in `README.md`.
The plugin owns plan authoring via `ultrawrite` since #390; superpowers is an optional
companion, not a dependency.

## Commands

```bash
python3 -m pytest        # the test gate (pytest.ini scopes it to tests/)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers   # validate a skill dir
python3 skills/ultrapowers/scripts/compile_plan.py <plan.md>              # compile a marked plan to its waves
```

- CI (`.github/workflows/ci.yml`) runs `validate_skill.py` on `ultrapowers` + `ultrawrite`, then `pytest tests/` (which bridges every `fleet/tests/test_*.mjs`, the engine sims included).

## Layout

- `skills/ultrapowers/` — the operator skill: `SKILL.md` (the thin client — commit
  the plan, launch the fleet), `scripts/`, `references/`. **The engine lives in
  `fleet/run-engine.mjs` since 0.3.0** (Amendment 10: models never run git); its
  judgment prompts are plain files in `fleet/roles/*.md` — one copy, no bake step.
- `skills/ultrawrite/` — the owned plan-authoring skill (the claims-v1 grammar: six body
  slots, contracts signed and edges derived); it replaced the superpowers authoring
  invocation at #390. (Also `skills/ultradocket/`.)
- `hooks/session_start.sh` — injects the plan-routing rule into every session.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest + marketplace entry (the version lives here).
- `docs/superpowers/{specs,intents,plans}/` — design docs, named `YYYY-MM-DD-<topic>.md`.
  **`intents/` is the signed artifact under the post-#243 plan shape** (spec §6: seven slots,
  `Files:`+`tier` signed, one operator-verifiable acceptance statement per task); the plan is
  machine-derived per wave and disposable, so `plans/` is historical from 0.3.0.
- `evals/fixtures/` — sample plan repos (`wide`/`chained`/`mixed`/`flawed`/`degrade`) used as
  test data by `tests/test_compile_plan.py`.
- `fleet/` — Width Program W1 (spec `docs/superpowers/specs/2026-08-21-width-program.md`):
  orchestrator (TinyBase ws-server + guard + spend authority), sandbox run shim, exe.dev
  provisioner, drive-one driver, `RUNBOOK.md` for the live run. **One Driver engine
  (#402):** `run-worker.mjs` (`agent()` backed by one `claude -p`), `run-waves.mjs` (the
  five other injected globals + clones-at-BASE + `withPatchCapture`), `run-main.mjs` (the
  deterministic engine entry — replaces the LLM `/ultrapowers` §Engine session), and
  `confine-hook.mjs` (the implementer's `PreToolUse` boundary). Live via
  `drive-one.mjs` — the ONLY engine since 0.3.0 (runs 26/27 met the pre-registered bar;
  the `claude` skill path and `waves.js` are deleted, PR #434). Own npm deps in
  `fleet/package.json`; tests join the suite via `tests/test_fleet_suite.py`. Not plugin
  machinery — changes here never require a plugin release.

## Wayfinding (program-scale routing) — decided on #180

- **Brainstorm vs wayfind:** multi-session + foggy + many open decisions → chart a
  wayfinder map (decision tickets labeled `wayfinder:*`); a single effort you can spec
  in one sitting → `superpowers:brainstorming` as usual. Layering: wayfinder charts
  programs; a map's destination is a spec that feeds ultrawrite + /ultrapowers
  unchanged.
- **Ticket ownership = label:** `wayfinder:grilling|research|prototype` tickets run their
  named mattpocock method — no superpowers ceremony fires (they produce decisions, not
  code); `wayfinder:task` and any code-producing work drops into the normal superpowers
  flow. Docket triage skips `wayfinder:*` issues.
- **Superpowers is HITL-only:** fleet sandboxes provision ultrapowers + engine only —
  superpowers never enters a sandbox. Revisit migrating off it only on a third
  version-skew incident, with a measured case.
- **"Frontier" is always qualified:** *merge frontier* (fold kernel) / *map frontier*
  (takeable wayfinder tickets) / *docket frontier* (run-integration tree). Bare
  "frontier" is banned in specs, docs, and issues.
- **Retired map — #366 *The One Driver* (chartered 2026-08-28, destination reached at 0.3.0).**
  The cutover shipped: the engine is `fleet/run-engine.mjs`, there is no LLM orchestrator and
  no Workflow tool, and `waves.js` + 118 tests were deleted (`44e0d15`) only after runs 26/27
  came back green. Read it as history, not as direction. Two of its rules outlive it and are
  enforced elsewhere: **cap what an agent is MADE to read, never what a file stores** — the live
  ceiling is 350 words on `fleet/roles/*.md`, at the point of dispatch (`fleet/tests/test_run_engine.mjs`);
  the SKILL.md word ceilings and `tests/test_skill_budget.py` are **deleted at #492** (three
  observed harms, zero observed saves — the count is now reported by CI's *Report skill prose
  sizes* step and by release commit bodies, and gates nothing). **Do not read that as the
  surviving ceiling being healthy: `reviewer.md` is at 349/350** — one word, the exact state
  #492 deleted the others for, and with no raise protocol since it is a literal in a test
  rather than a ratchet (**#496**). A budget a task cannot meet is a demolition order.
  Also standing: **deletion is owed
  per guard** — ballast goes behind a measurement gate, never on an incident narrative. Its
  design inputs, incl. Amendments 4–6 (sign intent, derive the plan, no verbatim implementation
  code, per-run token cap deleted) and #382's measured cache rows, remain the standing record in
  `docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md`.
- **Retired map — #238 *The Authoring Frontier* (destination reached 2026-09-01):** #239
  answered yes (six-slot claims-v1 grammar), #390 shipped it at 0.3.2 (`ultrawrite`;
  ultraplan + the writing-plans dependency deleted). Read as history.
- **Open maps:** #525 *The Verification Frontier* (review finds truth it cannot enforce —
  three generations of blocking-findings-that-could-not-block; tickets #518/#447/#519/#232,
  experiment queue #511→#522→#462→#516, single novelty per run window); #360 *The Merge Frontier* (the Manyana fold kernel — read its §Ground truth and §Rules before any
  kernel or orchestrator-store work; the binding one: *Manyana merges values,
  TinyBase coordinates the index* — never let the store's LWW merge a weave payload,
  and never patch `kernel/vendor/manyana.py`, it is sha-pinned on purpose).
  **One piece moved out of #360 by One Driver Amendment 9 (2026-08-29): the kernel's INPUT
  SHAPE** — it takes patches against BASE instead of `--branch <task>=<branch>:<sha>`, so no
  worker needs shared refs and the worktree-vs-clone question dissolves. Semantics, layering
  and the sha-pin are untouched and still #360's. **Isolation and CRDT merging are
  substitutes:** `compile_plan.py` has defaulted to `overlap=fold` since the 2026-08-14 A/B
  (0.640× wall), so same-file concurrent writes are the shipped default — a substrate that
  isolates harder than the kernel needs is buying nothing and costing width.
- **Three layers, three merges — never cross them.** `fleet/`'s store is a TinyBase
  **MergeableStore** (a real CRDT, HLC-stamped, synced through the orchestrator). Merge is
  **per slot** (`table.rowId.cellId`), so *which axis you put concurrency on decides whether
  data survives*: **row axis** = two rowIds, two slots, both survive (a grow-only set;
  totals are folds at read time — `totalSpent`); **cell axis** = one slot, HLC picks a
  winner and **discards** the other. The CRDT does not know your number is a sum. So
  **status is a register (cell), evidence is a set (row), totals are folds** — and file
  *content* is Manyana's, never either. The full rule, with the worked example and the
  `reportedTokens` counter-example, is documentation-as-code at the top of `fleet/store.mjs`
  — **read it before adding a table.**

## How features are built here

Brainstorm → spec in `docs/superpowers/specs/` → `ultrapowers:ultrawrite` → plan in
`docs/superpowers/plans/` → execute (subagent-driven, or `/ultrapowers` itself) → PR.
Every spec gets a **neutral fresh-context review** before operator
review (operator decision 2026-09-01, superseding the adversarial trim review — built for
the complexity-creep era; #519 had already demoted trims): the reviewer hunts
under-specification, scope reconciliation, and contradictions, with trim proposals
welcome but not the mandate; the spec carries a `## Spec review` section with
adopt-or-answer for every finding. Historical specs carry `## Trim review` sections
(dispatch brief still in `skills/ultralearn/references/distilling-proposals.md` §Trim review). Plans default to `**Acceptance:** suite — the committed suite is the verification.`
(the compiler's frozen vocabulary needs the `suite — <reason>` form; a bare `suite`
fails to parse — caught live on sitting 2's drain plan).

## Conventions & gotchas (non-obvious — read before editing)

- **Versioning:** 0.x.y — minor bumps for architectural releases (0.1.0 = the subtraction
  release), patch bumps otherwise. A release bumps **both** `plugin.json` **and** `marketplace.json`
  to the same value — `plugin.json` wins silently if they drift, and they have. Release commit
  `chore(release): 0.0.x — …`, committed to `main`. **After pushing a release, confirm CI on
  `main` is green (`gh run list --branch main --limit 1`)** — main sat red across two releases
  (0.2.12→0.2.13) and nothing surfaced it until PR #161.
- **The verification periphery is FROZEN (0.1.0).** The gate scripts
  (`gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`) and the
  compiler's diagnostic vocabulary change only for an
  eval-measured regression (`evals/ab_runner.py` numbers), never on an
  incident narrative alone — the one licensed exception is the Phase-2 tier
  deletion (`read-after-write`/`prose-reference`/`ambiguous-files`/`catch-all`,
  spec §2a), adjudicated by the recorded corpus migration reading
  (`evals/frontier/results/2026-08-20-phase2-migration.md`: exactly the
  expected `−3 prose-reference` + degrade-deletion mode flips — plus that
  deletion's one downstream wave-shape promotion, on a single plan whose
  deleted edge was gating — and no other delta, against the pre-registered
  97-plan census) plus the T15 rig re-run (Task 12). `suite` is the default
  disposition; a `sealed` line still parses (frozen vocabulary) but is
  `BLOCKED` at the gate — the sealing subsystem was cut in One Driver Phase 0
  (row 7).
- **Judgment prompts are data files.** `fleet/roles/*.md` (≤350 words each, pinned by
  the happy-path engine sim) are read at dispatch by `fleet/run-engine.mjs` — the single
  copy; the pre-0.3.0 bake/re-bake convention and its drift pin are deleted with
  `waves.js`. `references/plan-markers.md` is the runtime half only (its authoring rules
  were deleted at #390), and the execution-handoff rubric is still shared between
  `hooks/session_start.sh` and `ultrawrite/SKILL.md` (pinned by
  `tests/test_recommendation_rubric.py`).
- **Fleet engine sims ride the pytest suite.** `fleet/tests/test_*.mjs` are run by
  `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 120 s per file); the old
  `run_acceptance.sh --suite-gate` harness leg is inert since 0.3.0 (its
  `harnesses/*.js` trigger path no longer exists — the frozen script is untouched).
- **No direct Anthropic API calls in repo code.** A distributed plugin must need no API key. LLM work
  happens inside Claude Code (the agent loop / `claude -p`), which rides the user's subscription — do
  not add the `anthropic` SDK or `ANTHROPIC_API_KEY` to any shipped or dev script.
- **The installed plugin lags the repo.** Editing files here does not change the running plugin until
  `/plugin` re-resolves the new version (interactive terminal only) **and** a new session starts. Skill
  text reloads in-session; hook/manifest changes need a new session.
- **Session handoffs are OPT-IN — never read one unless the operator asks.** A session
  starts from the operator's intention, not from the last session's agenda. Reading a handoff
  unprompted makes every session a continuation and quietly hands the previous session's
  priorities the authority to set this one's; the operator said so directly on 2026-08-31,
  reversing the auto-discovery rule that stood here (#469). When they *do* ask to resume, the
  notes are in `.claude/ultrapowers/handoffs/` — **sort by mtime, never by filename**, since
  handoffs are named for the session they are FOR (`2026-09-04-*.md` can be older than
  `2026-08-31-*.md`). Treat any handoff as *what was true when it was written*: verify before
  acting on it, and expect a stale one, since nothing prunes them. `.claude/` is in
  `.git/info/exclude`, so a fresh clone, a fleet sandbox and CI all correctly find nothing.
- **`superpowers` is an optional companion, not a dependency (#390).** Plan authoring is
  `ultrawrite`'s; brainstorming and the practice skills are still worth reaching for when the
  operator has them installed. There is no local checkout and nothing is vendored — read those
  skills from the plugin cache (`~/.claude/plugins/cache/.../superpowers/<ver>/`).
