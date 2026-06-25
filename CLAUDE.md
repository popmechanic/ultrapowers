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

## How features are built here

Brainstorm → spec in `docs/superpowers/specs/` → `superpowers:writing-plans` +
`ultrapowers:ultraplan` markers → plan in `docs/superpowers/plans/` → execute (subagent-driven,
or `/ultrapowers` itself) → PR. Engine/skill/doc changes use `**Acceptance:** suite` (the committed
suite is the verification; no held-out exam).

## Conventions & gotchas (non-obvious — read before editing)

- **Versioning stays `0.0.x`.** A release bumps **both** `plugin.json` **and** `marketplace.json`
  to the same value — `plugin.json` wins silently if they drift, and they have. Release commit
  `chore(release): 0.0.x — …`, committed to `main`.
- **Prompts are baked; edit the source, not the copy.** The engine prompts in `harnesses/waves.js`
  are baked from `references/reviewer-prompts.md` + `references/wave-merge.md` and pinned by
  `tests/test_no_prompt_drift.py`. `ultraplan/SKILL.md` mirrors `references/plan-markers.md`, and the
  execution-handoff rubric is shared between `hooks/session_start.sh` and `ultraplan/SKILL.md`
  (pinned by `tests/test_recommendation_rubric.py`). Change the source `.md`, re-bake per
  `references/workflow-template.md`, and keep the pin green — never edit only the baked copy.
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
