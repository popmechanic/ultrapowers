---
name: ultraplan
description: Use together with superpowers:writing-plans on EVERY implementation plan while this plugin is installed (not only plans already destined for /ultrapowers) — layers the additive parallel-execution markers (Type, Depends-on) and worktree-pure authoring rules so the plan compiles into waves deterministically; marked plans remain fully executable by the sequential executors.
---

# Ultraplan — Author Parallel-Ready Plans

Use **together with** `superpowers:writing-plans`: that skill owns plan structure,
TDD steps, and granularity. This skill adds the parallel-execution contract so
`/ultrapowers` compiles the plan by parsing instead of inferring. The two blocks
below mirror the canonical marker contract verbatim, pinned by an
anti-drift test.

**Announce at start:** "I'm also using ultraplan to make this plan parallel-ready."

Markers are additive bold-labeled lines that sequential readers ignore, so a
marked plan stays executable by subagent-driven-development and executing-plans.

## Shape the decomposition (before drawing tasks)

Markers only *describe* a decomposition writing-plans already drew — and that
skill biases toward a linear narrative, manufacturing `Depends-on` edges that
are really just reading order. Shape the decomposition first, to reveal the
independence the sequential pen glides over. Five moves:

1. **Map independent units.** Separate work that needs another unit's *output*
   from work that merely *reads* as a sequence.
2. **Front-load contracts (contract-first).** Where a consumer would wait on a
   producer, fix the shared interface up front as its own small early task that
   `Produces:` the signatures; consumers `Consume:` + `Depends-on:` it and build
   against the contract in parallel.
3. **Let same-file edits stand.** Coupling is interfaces and existence, not
   files. The compiler never serializes same-file text writes: the fold
   path resolves concurrent edits at merge, so a shared hot file is never a
   reason to reshape a plan. Three old workarounds are
   authoring **defects**: splitting a feature or a file to dodge a collision;
   chaining a fan of independent tasks to serialize writers; adding
   `Depends-on` for file overlap alone. Let colliding `Modify` lines collide.
   Two obligations survive: `**Files:**` blocks remain required — they are the
   compiler's contention-detection input — and declare `**Commutes:**` on shared
   append-natured surfaces so the engine can classify that contention and union
   the additions instead of resolving them. Registration surfaces (route
   tables, export lists, manifests) and shared test modules two tasks both
   append to qualify; never declare it on a file the task also modifies or
   deletes existing lines in. One exception: chain non-text (binary/symlink) same-file pairs with
   `Depends-on` — they run in parallel otherwise and always fall back.
   Blast radius follows the contract, not the file: a task that changes a
   declared `Produces:` shape owns every strict-equality pin of it, in any
   sibling's file — list that file in its own `**Files:**` (#233).
4. **Interrogate every dependency.** For each `Depends-on` you are about to write:
   true data/interface dependency, or just the order you thought of it in? Keep
   the real ones; drop the authoring-order ones.
5. **Right-size against overhead — depth is the billed dimension.** A wave's
   tasks run concurrently, but its tail — fold, full suite pass, adopt — is
   serial and paid once per wave regardless of width. Width is
   nearly free up to `WIDTH`; a dropped `Depends-on` that removes a wave
   is worth ~90 s. Never split below a real unit of work to inflate width.

**The justification gate.** Move 2 reshapes the architecture, so it must (a) name
a concrete independence win, and (b) pass *"would a good engineer make this move
even without parallelism in mind?"*. A contract introduced only to fan out fails
— drop it. Every surviving move carries a `**Parallelization rationale:**
<named independence win>` line in that task's body, **after the
`**Interfaces:**` block** (never in the header block), so the operator can audit it.

**Escape valve.** Concluding there is **no latent parallelism** in a spec is a
correct outcome — small or inherently-linear work should not be reshaped. Gate
plus valve keep shaping from manufacturing breadth; the recommender routes a
narrow plan to a sequential executor honestly.

**Author for the resolver.** Write tasks that fold cleanly: give each a stable anchor to edit near (a named
function, a labeled section), designate an append zone for a list two tasks both
grow, and prefer additive registration over rewriting a shared block. Resolver
guidance only — nothing parses it.

## Efforts too large for one plan

When a spec becomes several plans run as separate `/ultrapowers` invocations,
per-phase green does **not** establish integrated green: each run's completeness
critic sees only its own plan's tree, never the seams between phases — where
integration bugs live. So give the **final** plan an **integration-spanning
acceptance**: a suite whose checks cross the earlier phases, run
against a tree that contains them. Never let N green per-phase gates stand in for
one integrated-green gate; if the effort cannot end in one, declare an explicit
waiver at the final gate ("cross-phase integration unverified — phases gated
separately"), never silently.

## Add markers to every task

Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.
- `**Review:**` — optional; one of `adversarial` or `lean`. Names the tasks that
  earn a second independent review pass. Unmarked tasks are `lean`. An invalid
  or duplicate value is a compile error.
- `**Commutes:**` — optional; comma-separated backticked paths, each of which
  must also appear in this task's own `**Files:**` block. It asserts that this
  task's edits to those files are order-insensitive additive registrations, so
  the engine may union them instead of resolving them. Declare it only when
  true — review audits the claim the way it audits a test contract. A path
  outside the task's own `**Files:**` block is surfaced as a marker conflict and
  dropped, never a compile error. Like every marker it belongs in the
  header block; after `**Files:**` it is discarded and `--check` refuses it.

Decide review depth explicitly: mark
`**Review:** adversarial` on tasks whose failure is costly or hard to see — the
fit analysis's risk list below.

Placement is enforced: the compiler trusts markers only in the contiguous block
immediately after the task heading — a later marker is ignored and surfaced as a
conflict. A plan with **no markers** still
compiles, but every disposition is guessed and the render flags it
**`0 markers — all dispositions inferred`**.

## Replace the plan header

writing-plans mandates this header line on every plan:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

On a marked plan, REPLACE it with:

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

## Execution Handoff (analyze, then recommend)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first — but do **not** default to Ultrapowers. Run the
execution-fit analysis below, then tag the single best-fit option as
**(recommended)**. The recommendation is earned per plan: recommending
Subagent-Driven or Inline when the plan does not benefit from parallel waves is
the correct, honest outcome.

### The fit analysis

Read three signals off the marked plan:

- **T** — the number of `implementation` tasks (`gate`/`release`/`manual` tasks
  do not run in waves).
- **parallel width** — yes/no: is there at least one wave with ≥2 independent
  tasks, after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge)?
  Compute it by hand from the `**Depends-on:**` graph plus the `**Files:**` blocks.
- **risk** — true if Acceptance is `sealed` (the operator cannot read the diff),
  the work touches a high-stakes surface (auth, payments, migrations, data
  integrity, public API, loops/cursors/pagination/budgets/termination logic), or behavior is hard to verify by reading.

Decide with the first branch that matches:

1. **risk → Ultrapowers** — the **risk override**. Independent per-task review
   and one pre-merge gate are the value here, not speed. Name the risk in the
   rationale.
2. **parallel width and T≥4 → Ultrapowers** — real speedup clears the
   worktree/merge overhead.
3. **T≤2 → Inline** — too small to spin up machinery.
4. **else → Subagent-Driven** — linear chains, or narrow plans where parallel
   benefit does not pay; fresh-context isolation still earns its keep.

Branch 2's bar is deliberately conservative: the risk override already carries
every quality-critical plan, so T≥4 only trades away marginal parallelism on
small low-risk plans, never verification.

### Render

Show a one-line analysis citing the signals, then the three options with
**(recommended)** on the winner. Ultrapowers stays listed first regardless:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: commits the plan and drives it
   on the exe.dev fleet (parallel waves in a sandbox, per-task review, the
   orchestrator opens the PR). Selecting it authorizes execution: the plan
   is committed and the fleet run launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution (upstream removed batch checkpoints in 5.0.0; its handoff text still says otherwise — trust the behavior, not the menu).

Example analysis lines:

- `6 implementation tasks, widest wave 3, low risk → Ultrapowers (recommended).`
- `4 tasks, linear chain, low risk → Subagent-Driven (recommended).`

## Choose the right Type

- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed in the wave-plan transparency render. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.

Marking a write-nothing verification task `gate` is not optional bookkeeping: a
**marked** `implementation` task whose `**Files:**` block declares no path at all
is a compile-time refusal (a `Test:`-only block satisfies the rule).

## Authoring rules (the worktree-pure contract)

Every `implementation` task must be a pure diff against the integration branch.
While writing tasks:

1. **Self-contained bodies.** Task agents see only their own task body — every
   coordination note (port assignments, "match on quoted text") lives in the body
   of each task it affects, never only in a preamble. Wrap embedded examples in
   code fences (``` or `~~~`) — fenced content never drives classification or edges.
2. **Ordering is `Depends-on:`, not prose.** Never write "execute phases in order"
   — put a `**Depends-on:**` line on each downstream task instead.
3. **No branch instructions.** The executor owns branching — no `git checkout -b`
   steps.
4. **Concurrency-safe tests.** Same-wave suites run at the same time on one
   machine: unique port and temp path per test, no shared on-disk fixtures.
5. **Split impure steps out.** If a task would push, deploy, ssh, or wait on a
   human, that part is its own `release`/`manual` task.
6. **Name only what exists.** Every path, `report.json` field, or task a body
   cites must exist at BASE, be created by a task it `Depends-on`, or be defined
   in `report-format.md`. Run `compile_plan.py --check --renders <plan>` and
   read its `ADVISORY` blast-radius and referent lines before handoff.
- **Claims about the live world carry their evidence.** A task editing a
  hand-executed record (`fleet/RUNBOOK.md`) or asserting what a live system does
  is unverifiable from a sandbox — the reviewer defers. Paste the commands and
  their output into the body so review checks **correspondence** to recorded
  evidence, not truth it cannot reach. `--check --renders` flags these.
- **Greenfield targets take the Bun + TypeScript defaults** — knobs and
  rationale in `references/greenfield-stack.md` (#425).
- **Bodies may sketch routine glue — an ultraplan override.** writing-plans
  demands complete code in every step; here that holds only where the code
  carries information the implementer cannot derive. An `implementation` body
  must be **interface- and test-complete** — exact signatures, exact test
  assertions, exact literals — while its implementation steps may sketch routine
  glue in prose. The exception: a task marked `**Review:** adversarial` keeps
  exact code in every step, because its second reviewer audits the diff against
  the plan text.
- **Shrink budgets are acceptance criteria — stated as deltas.** When a task
  edits a complexity-ratcheted surface (SKILL.md, gate-spec docs), state the
  net word delta its diff implies (`net delta ≤ +N words`, or `≤ −N`),
  verified at task end as word-count(after) − word-count(before). Never state
  an absolute ceiling — it drifts against sibling deltas; the absolute lives
  in `tests/test_skill_budget.py`.
- **Tier escalation-prone tasks up front.** Large single-file refactors blow the
  StructuredOutput retry cap at lower tiers and pay the task twice — mark them
  `most-capable` rather than letting the launch guess it.
- **Spike tasks that spawn the real agent CLI must isolate `CLAUDE_CONFIG_DIR` (or disable session persistence)** — otherwise it can write false memories into the host project.

## The final authoring step — validate

A marked plan is not done until it passes the grammar check (the compiler
lives in the ultrapowers skill's scripts directory):

    COMPILE_PLAN=skills/ultrapowers/scripts
    python3 $COMPILE_PLAN/compile_plan.py --check <plan.md>

Exit 0 (`PLAN OK`) — hand the plan off. Any violation prints a did-you-mean
fix; apply it and re-run. The runtime parser accepts exactly this grammar:
skipping the check moves the fix cost from seconds to a session.

## Operator smoke — aim the one human check

After validating, append a `## Operator smoke` section to the plan document
itself (never a separate file) — the operator's post-merge hands-on check:
3–5 behavioral probes, each two lines —

- `do:` one concrete action in the running software (a command, a page, a
  button)
- `see:` the observable result that proves the seam works

Choose probes adversarially: aim where the suite is structurally blind —
integration seams, visual/UI states, CLI output feel,
error-path wording. Never restate what a committed test asserts. Write probes a
non-technical operator can run verbatim. If the work has no observable surface
(pure refactor, internal tooling), write the single line "No observable surface
— suite is the whole story." The manifest is ADVISORY ONLY: never a gate input,
never parsed, never a merge blocker.

## Populate the v6 blocks — they are load-bearing here

superpowers v6 adds two plan blocks. The compiler reads them, so populate
them deliberately:

1. **`## Global Constraints`** (a header section, project-wide). Copy the spec's
   binding, cross-cutting requirements verbatim — version floors, naming/copy
   rules, platform requirements. ultrapowers forwards it to **every reviewer as
   its attention lens**. Process rules — TDD ordering, "write the failing
   test first", commit cadence — are per-task steps, never Global Constraints:
   forwarded as a reviewer lens they can only produce unverifiable process
   findings against every task, since no diff evidences the order work was
   done in. State what must be true of the result (tests present, behavior
   covered).

2. **`**Interfaces:**`** (per task). `Produces:` names the function names and
   param/return types later tasks rely on; `Consumes:` names the signatures this
   task uses from earlier tasks. A worktree-isolated implementer sees only its
   own body — Interfaces is how it learns what its neighbors expose.

These are **load-bearing**: when Task B `Consumes:` a symbol Task A `Produces:`,
the compiler infers B-depends-on-A — and if B's `**Depends-on:**` does not
already cover that edge, it surfaces a loud **"undeclared dependency"** finding
at the Step-3 gate. The plan still waves correctly; the finding tells you your
`**Depends-on:**` was wrong.

**One edge the compiler cannot see: a test-only import.** A dependency living
**only** inside a test's `import` of a sibling's symbol is invisible —
ultrapowers reads markers, `Files:` paths, and `Interfaces:` symbols, never
source or test *file contents*. An explicit `**Depends-on:**` is now the **only**
thing that orders a task's `Test:` against a file a sibling creates. Declare it,
or the two run in parallel off a base where the sibling does not yet exist and
the wave cascade-blocks.

**Placement:** `**Interfaces:**` is **not** a header marker — it sits **after**
the `**Files:**` block and before the first `- [ ]` step, so the header markers
keep their pinned positions. Shape:

```markdown
### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `app/server/server.ts`

**Interfaces:**
- Consumes: `schema.User` (from Task 1), `makeProbe(port: number): Probe` (from Task 2)
- Produces: `healthProbe(): Promise<HealthReport>`

- [ ] **Step 1: …**
```

## Acceptance disposition

Every marked plan declares one of two Acceptance dispositions:

- **`**Acceptance:** suite — <reason>`** — the default. The committed suite plus
  per-task review is the verification; the engine binds acceptance to the
  committed test result (`acceptance.passed === tests.passed`).
- **`**Acceptance:** waived — <reason>`** — verification genuinely skipped, by
  explicit operator choice. Waivers surface verbatim at the wave-plan gate, in
  the report, and at the pre-merge gate.

`sealed` is no longer producible: the sealing subsystem was cut (One Driver
Phase 0, row 7) — the compiler still parses a `sealed` line (frozen vocabulary)
and the gate reports it `BLOCKED`. Never waive silently on the operator's behalf.

## Self-review additions

After writing-plans' own self-review checklist, verify:

- Decomposition was shaped before annotation: every contract-first task names
  its independence win and passes the good-engineer test, each surviving move
  carries a `**Parallelization rationale:**` line — or the plan is intentionally
  narrow because the work has no latent parallelism — and no task shape exists
  only to dodge a same-file collision (no unnatural split, no chain-for-a-fan,
  no overlap-only `Depends-on`).
- Every `**Commutes:**` claim is true: the declared paths are in that task's own
  `**Files:**`, and its edits to them really are additive registrations.
- Every task carries an explicit `**Type:**` (or is intentionally default
  `implementation`), and every marked `implementation` task declares at least
  one path under `**Files:**`.
- Every cross-task constraint appears as `**Depends-on:**` on the downstream task
  — including a test-only import of a sibling's symbol.
- No preamble holds load-bearing coordination missing from the task bodies.
- Gates, release rituals, and owner actions are marked `gate` / `release` /
  `manual` — nothing rides on classification heuristics.
- Every **test-asserted literal** traces to content the same task prescribes: a test asserting a string, symbol, or behavior the task never writes is a plan contradiction — the test is the authority, so prescribe that content or drop the assertion.
- The plan carries an **Acceptance:** line — suite or an explicit waiver.

(End of SKILL.md.)
