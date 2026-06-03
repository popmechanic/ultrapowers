# ultrapowers — Committed Workflow Refactor

- **Date:** 2026-06-03
- **Status:** Implemented
- **Supersedes (in part):** the runtime-authoring design in `2026-06-02-ultrapowers-design.md`
- **Skill:** renamed `ultra-driven-development` → `ultrapowers` (invoked as `/ultrapowers <plan-path>`)

## Why

The original design had the **main agent author the Dynamic Workflow script at runtime** from a prose
template, loading `superpowers:*` skills via the Skill tool mid-run and baking their prompts into each
`agent()` call. Two problems:

1. **Nondeterminism** — the orchestration was re-derived from prose on every run.
2. **Fragile runtime coupling** — execution depended on live Superpowers skill resolution.

The Claude Code workflows docs and the "dynamic workflows" blog (Shihipar & Bidasaria, 2026-06-02)
both endorse shipping a **committed workflow file inside the skill**, with discipline baked in, and
treating re-baking as a *build-time* maintenance step. This refactor adopts that, to increase
**determinism and skill-prompt adherence**.

## What changed

- **New core artifact:** `skills/ultrapowers/workflow.js` — a committed, frozen Dynamic Workflow. The
  implementer/reviewer/completeness prompts, the safety GUARD, and the JSON schemas are baked in as
  constants. The main agent launches it with `args.waves`; it never authors it.
- **Single source of truth + anti-drift test:** `references/reviewer-prompts.md` holds the canonical
  prompts inside `<!-- BAKE:NAME -->` markers; `tests/test_no_prompt_drift.py` fails if the baked copy
  in `workflow.js` diverges. Merge/setup/reconcile prompts are sourced from `references/wave-merge.md`.
- **Runtime decoupling:** no `superpowers:*` skills are loaded during execution. Superpowers and
  ultrapowers hand off only through the plan file on disk. (Brainstorming, writing-plans, and
  finishing-a-development-branch remain Superpowers, human-gated, before/after the run.)
- **New wave-plan approval gate:** the main agent computes waves (still per
  `references/dependency-analysis.md`, so they are human-visible) and the human approves the wave plan
  before launch. Gates are now: plan approval → wave-plan approval → pre-merge review.
- **Fallback:** if the committed workflow cannot run, fall back to
  `superpowers:subagent-driven-development` (sequential). Never re-author an ad-hoc workflow.
- **Dropped the absolute-REPO-path baking:** runtime `isolation: 'worktree'` binds worktrees to the
  session repo, so no external target path is carried. The GUARD (forbid undefined/non-repo/cwd
  fallback) is kept as the backstop. This retires the 2026-06-02 "bake REPO literal" hardening while
  keeping its safety intent.
- **Concurrency:** the wave loop chunks each wave to the engine's **16 concurrent agents** cap
  (1000 total/run). Peak concurrency = wave width (each task pipeline is internally sequential).

## Known risk and its mitigation: `args` population

The 2026-06-02 failure (ad-hoc launch where `args` did not populate, target resolved to `undefined`,
agents mutated the session repo) is mitigated three ways: (1) `workflow.js` validates `args.waves` and
**throws** rather than proceed on `undefined`; (2) the GUARD forbids cwd/unrelated-repo fallback;
(3) a one-time **probe** (`tests/fixtures/args-probe.js`) confirms `args` populates in a committed
workflow before we rely on it — if it fails, SKILL.md switches to a temp-file handoff. Record the
probe result in `references/workflow-template.md` once run on the install path.

## Verification

- `python3 -m pytest tests/` — validator, canary plan, `workflow.js` parse (wrapped `node --check`),
  API-usage, baked-marker, and anti-drift tests all pass.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`.
- Manual: the args probe, then a real `/ultrapowers` run against a throwaway 3-task plan (incl. the
  negative `args={}`-throws check and the fallback check). See the approved plan for the full script.

## Still deferred

- Running the args probe + the real end-to-end `/ultrapowers` launch on a live `claude --plugin-dir`
  install (cannot be exercised from the static test suite).
