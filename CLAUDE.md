# CLAUDE.md

## Purpose & vision

ultrapowers is an alternative execution engine for **superpowers**, the popular
Claude Code skill for software-engineering automation. Where superpowers runs an
approved plan sequentially, ultrapowers offers a parallel path: it compiles the plan
into dependency-ordered waves and executes them on Claude Code's native
[Workflows](https://code.claude.com/docs/en/workflows) feature, which orchestrates
parallelized subagents at scale across isolated git worktrees.

The aim is to move where humans spend their attention. ultrapowers keeps users
closely involved in **planning** — deciding what to build and how it will be
verified — and much less involved in **implementation**, which the engine fans out,
reviews, and integrates autonomously up to a single pre-merge gate. That makes
ambitious work approachable for less-technical operators: ultrapowers is built for
large, complex tasks that reward parallelism and independent verification.

This file is for agents **developing the plugin**; end-user docs are in `README.md`.
ultrapowers extends (does not fork) superpowers.

## Commands

```bash
python3 -m pytest        # the test gate (pytest.ini scopes it to tests/)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers   # validate a skill dir
python3 skills/ultrapowers/scripts/compile_plan.py <plan.md>              # compile a marked plan to its waves
```

- CI (`.github/workflows/ci.yml`) runs `validate_skill.py` on `ultrapowers` + `ultraplan`, then `pytest tests/`.
- The 5 `tests/*.mjs` viewer/sim specs are **not** in CI — run them manually: `node tests/<name>.mjs`.

## Layout

- `skills/ultrapowers/` — the engine: `SKILL.md` (operator steps), `harnesses/waves.js`
  (the committed Dynamic Workflow), `scripts/`, `references/` (prompt sources — see Anti-drift).
- `skills/ultraplan/` — plan-authoring markers (`Type`/`Depends-on`/`Interfaces`); pairs with
  `superpowers:writing-plans`. (Also `skills/ultradocket/`.)
- `hooks/session_start.sh` — injects the plan-routing rule into every session and installs the harnesses.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest + marketplace entry (the version lives here).
- `docs/superpowers/{specs,plans}/` — design docs, named `YYYY-MM-DD-<topic>.md`.
- `evals/fixtures/` — sample plan repos (`wide`/`chained`/`mixed`/`flawed`/`degrade`) used as
  test data by `tests/test_compile_plan.py` and `tests/test_fixture_seals.py`.
- `fleet/` — Width Program W1 (spec `docs/superpowers/specs/2026-08-21-width-program.md`):
  orchestrator (TinyBase ws-server + guard + spend authority), sandbox run shim, exe.dev
  provisioner, drive-one driver, `RUNBOOK.md` for the live run. Own npm deps in
  `fleet/package.json`; tests join the suite via `tests/test_fleet_suite.py`. Not plugin
  machinery — changes here never require a plugin release.

## Wayfinding (program-scale routing) — decided on #180

- **Brainstorm vs wayfind:** multi-session + foggy + many open decisions → chart a
  wayfinder map (decision tickets labeled `wayfinder:*`); a single effort you can spec
  in one sitting → `superpowers:brainstorming` as usual. Layering: wayfinder charts
  programs; superpowers owns every effort underneath — a map's destination is a spec
  that feeds writing-plans + ultraplan + /ultrapowers unchanged.
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
- **Open maps:** #238 *The Authoring Frontier* (plan authoring); #360 *The Merge
  Frontier* (the Manyana fold kernel — read its §Ground truth and §Rules before any
  kernel or orchestrator-store work; the binding one: *Manyana merges values,
  TinyBase coordinates the index* — never let the store's LWW merge a weave payload,
  and never patch `kernel/vendor/manyana.py`, it is sha-pinned on purpose).

## How features are built here

Brainstorm → spec in `docs/superpowers/specs/` → `superpowers:writing-plans` +
`ultrapowers:ultraplan` markers → plan in `docs/superpowers/plans/` → execute (subagent-driven,
or `/ultrapowers` itself) → PR. Every spec gets an **adversarial trim review** before operator
review — a fresh-context subagent proposing the trimmed version (dispatch brief in
`skills/ultralearn/references/distilling-proposals.md` §Trim review); the spec carries a
`## Trim review` section with adopt-or-answer for every trim, and the reviewer — never the
author — grades `netConceptDelta`. Plans default to `**Acceptance:** suite` (the committed
suite is the verification; no held-out exam unless the operator asks to seal).

## Conventions & gotchas (non-obvious — read before editing)

- **Versioning:** 0.x.y — minor bumps for architectural releases (0.1.0 = the subtraction
  release), patch bumps otherwise. A release bumps **both** `plugin.json` **and** `marketplace.json`
  to the same value — `plugin.json` wins silently if they drift, and they have. Release commit
  `chore(release): 0.0.x — …`, committed to `main`. **After pushing a release, confirm CI on
  `main` is green (`gh run list --branch main --limit 1`)** — main sat red across two releases
  (0.2.12→0.2.13) and nothing surfaced it until PR #161.
- **The verification periphery is FROZEN (0.1.0).** The sealing subsystem
  (`collect_seal.py`, `seal_hash.py`, `run_acceptance.sh`, the seal-author
  agent + brief), the gate scripts (`gate_check.py`, `ultra_gate.py`,
  `run_lock.sh`), and the compiler's diagnostic vocabulary change only for an
  eval-measured regression (`evals/ab_runner.py` numbers), never on an
  incident narrative alone — the one licensed exception is the Phase-2 tier
  deletion (`read-after-write`/`prose-reference`/`ambiguous-files`/`catch-all`,
  spec §2a), adjudicated by the recorded corpus migration reading
  (`evals/frontier/results/2026-08-20-phase2-migration.md`: exactly the
  expected `−3 prose-reference` + degrade-deletion mode flips — plus that
  deletion's one downstream wave-shape promotion, on a single plan whose
  deleted edge was gating — and no other delta, against the pre-registered
  97-plan census) plus the T15 rig re-run (Task 12). Sealed acceptance is
  opt-in ("seal this plan"); `suite` is the default disposition.
- **Prompts are baked; edit the source, not the copy.** The engine prompts in `harnesses/waves.js`
  are baked from `references/reviewer-prompts.md` + `references/wave-merge.md` and pinned by
  `tests/test_no_prompt_drift.py`. `ultraplan/SKILL.md` mirrors `references/plan-markers.md`, and the
  execution-handoff rubric is shared between `hooks/session_start.sh` and `ultraplan/SKILL.md`
  (pinned by `tests/test_recommendation_rubric.py`). Change the source `.md`, re-bake per
  `references/workflow-template.md`, and keep the pin green — never edit only the baked copy.
- **The suite-gate runs the `.mjs` harness sims when harness JS changes.** For a
  `suite`-disposition branch, `run_acceptance.sh --suite-gate --base <ref>` diffs
  `<ref>...HEAD`; if `skills/ultrapowers/harnesses/*.js` was touched it runs the
  `tests/*.mjs` that reference `harnesses/` via `node`, gated on exit code **and** a
  `ALL (SCENARIOS|TESTS) PASSED` sentinel. So a new harness sim MUST print that
  sentinel on success, and harness JS with no covering sim fails the gate (never a
  shallow green). The viewer specs (`swarm_*`, `audit_*`) reference `viewer/` and
  are not run by the gate.
- **No direct Anthropic API calls in repo code.** A distributed plugin must need no API key. LLM work
  happens inside Claude Code (the agent loop / `claude -p`), which rides the user's subscription — do
  not add the `anthropic` SDK or `ANTHROPIC_API_KEY` to any shipped or dev script.
- **The installed plugin lags the repo.** Editing files here does not change the running plugin until
  `/plugin` re-resolves the new version (interactive terminal only) **and** a new session starts. Skill
  text reloads in-session; hook/manifest changes need a new session.
- **`superpowers` is a dependency, not vendored.** No local checkout — read its skills from the plugin
  cache (`~/.claude/plugins/cache/.../superpowers/<ver>/`).
- **Self-hosting a `/ultrapowers` run? Serialize them.** Concurrent runs in one repo corrupt each
  other's checkout; clean up worktrees with `skills/ultrapowers/scripts/sweep_worktrees.sh`.
  This extends to *sessions* during an approve window (#134): `ultra_gate.py --approve` checks out
  the integration/main branch in the shared primary checkout, so only one session may do git work
  in a checkout while another session's gate approve can run — the RUN_LOCK serializes runs, not
  sessions, and a second session's branch silently becomes `main` mid-command otherwise.
