---
name: ultraplan
description: Use together with superpowers:writing-plans on EVERY implementation plan while this plugin is installed (not only plans already destined for /ultrapowers) — layers the additive parallel-execution markers (Type, Depends-on) and worktree-pure authoring rules so the plan compiles into waves deterministically; marked plans remain fully executable by the sequential executors.
---

# Ultraplan — Author Parallel-Ready Plans

Use **together with** `superpowers:writing-plans`: that skill owns plan structure,
TDD steps, and granularity. This skill adds the parallel-execution contract so
`/ultrapowers` can compile the plan into waves by parsing instead of inferring. The
canonical contract is the plan-markers reference inside the ultrapowers skill; the
two blocks below mirror it verbatim and are pinned by an anti-drift test.

**Announce at start:** "I'm also using ultraplan to make this plan parallel-ready."

A plan written with these markers remains fully executable by the sequential
executors (subagent-driven-development, executing-plans) — markers are additive
bold-labeled lines that sequential readers simply ignore.

## Add markers to every task

Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.

Placement is enforced: the compiler trusts markers only as the contiguous block
immediately after the task heading — a marker after a description paragraph (or
anywhere later) is ignored and surfaced as a conflict in the wave-plan
transparency render.

## Replace the plan header

writing-plans mandates this header line on every plan:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

On a marked plan, REPLACE it with:

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

Without this, the header literally directs any skills-obedient agent into the
sequential executor — the parallel run happens only because a human typed
`/ultrapowers`.

## Execution Handoff (third option)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first:

1. **Ultrapowers (recommended for marked plans)** — `/ultrapowers <plan-path>`:
   parallel waves, worktree isolation, per-task review, one pre-merge human gate.
   Selecting this option authorizes execution: ultrapowers renders its wave plan
   for transparency and launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution (upstream removed batch checkpoints in superpowers 5.0.0; its own handoff text still says otherwise — trust the behavior, not the menu).

## Choose the right Type

- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed in the wave-plan transparency render. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.

## Authoring rules (the worktree-pure contract)

Every `implementation` task must be a pure diff against the integration branch.
While writing tasks:

1. **Self-contained bodies.** Task agents see only their own task body — every
   coordination note (shared-file ordering, port assignments, "match on quoted
   text") must live in the body of each task it affects, never only in a preamble.
   Wrap embedded examples in code fences (``` or `~~~`) — fenced content never
   drives classification, edges, or task splitting.
2. **Ordering is `Depends-on:`, not prose.** Never write "execute phases in order"
   or "within a phase, run tasks in numeric order" — put a `**Depends-on:**` line on
   each downstream task instead.
3. **No branch instructions.** The executor owns branching (sequential executors
   branch per their own skills; ultrapowers creates an integration branch and a
   worktree per task). Do not write `git checkout -b` steps.
4. **Concurrency-safe tests.** Same-wave tasks run their suites at the same time on
   one machine: give every test a unique port and temp path, and avoid shared
   on-disk fixtures.
5. **Split impure steps out.** If a task would push, deploy, ssh, or wait on a
   human, that part is its own `release` or `manual` task — implementation tasks
   never contain it.

## Seal the exam (after plan approval)

A marked plan is not execution-ready until it carries an `**Acceptance:**`
line (the compiler refuses it otherwise). After the human approves the plan:

1. Dispatch a fresh-context author subagent per
   `references/seal-author-prompt.md`. Its inputs are ONLY: the spec text,
   the repo's test conventions (framework, run command, naming), the base
   branch name, and the vault path `~/.ultrapowers/acceptance/`. Never the
   plan, never the task list, never this conversation's history.
2. The author writes the suite into the vault, proves it RED against a
   pristine baseline worktree (a suite that passes before the work exists
   tests nothing — collection errors from missing modules count as red; the
   suite's own syntax errors do not), writes `manifest.json`, and returns
   ONLY: seal-id, sha256, red-run evidence, and a coverage summary mapping
   spec criteria to test names.
3. Append to the plan, after the header block:
   `**Acceptance:** sealed <seal-id> (sha256:<hash>)` plus the coverage
   summary as a short appendix (spec-derived, safe to show).
4. Two consecutive green-at-baseline attempts → stop and tell the human: the
   spec may describe behavior that already exists.

The operator may instead record `**Acceptance:** waived — <reason>`; waivers
surface verbatim at the wave-plan gate, in the report, and at the pre-merge
gate. Never waive silently on the operator's behalf.

## Self-review additions

After writing-plans' own self-review checklist, verify:

- Every task carries an explicit `**Type:**` (or is intentionally default
  `implementation`).
- Every cross-task constraint appears as `**Depends-on:**` on the downstream task.
- No preamble section holds load-bearing coordination that isn't also in the
  affected task bodies.
- Gates, release rituals, and owner actions are marked `gate` / `release` /
  `manual` — nothing relies on the executor's classification heuristics.
- Every backticked mention of a file or module another task creates (`apistub/schema.py`, `schema.User`) has a matching `**Depends-on:**` on the referencing task — otherwise the compiler infers a `prose-reference` edge and surfaces it as a conflict at the wave-plan gate.
- The plan carries an **Acceptance:** line — sealed (preferred) or an explicit operator waiver.

(End of SKILL.md.)
