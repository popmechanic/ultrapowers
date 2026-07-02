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

## Shape the decomposition (before drawing tasks)

ultraplan is titled "Author Parallel-Ready Plans," but markers only *describe* a
decomposition writing-plans already drew — and writing-plans biases toward a
linear narrative, manufacturing `Depends-on` edges that are really just
reading order. Before you draw tasks, shape the decomposition to reveal the
independence the sequential pen glides over. Five moves:

1. **Map independent units.** Separate work that truly needs another unit's
   *output* from work that merely *reads* as a sequence.
2. **Front-load contracts (contract-first).** Where a consumer would wait on a
   producer, fix the shared interface up front as its own small early task that
   `Produces:` the signatures; consumers `Consume:` + `Depends-on:` it and build
   against the contract in parallel. This is the highest-leverage move, and it
   uses only the existing marker machinery.
3. **Cut along file seams.** Draw boundaries so same-wave tasks do not `Modify`
   the same file. Where genuinely-independent work collides on one file, consider
   splitting the file along its real responsibility seam.
4. **Interrogate every dependency.** For each `Depends-on` you are about to write:
   true data/interface dependency, or just the order you happened to think of it?
   Keep the real ones; drop the authoring-order ones.
5. **Right-size against overhead.** Never split below a real unit of work to
   inflate width — worktree overhead and the execution-fit recommender reward only
   genuine independent mass.

**The justification gate.** Moves 2 and 3 reshape the architecture, so each one
must (a) name a concrete independence win it produces, and (b) pass *"would a good engineer make this move even without parallelism in mind?"*. A contract introduced
only to fan out, or a file split only to dodge a collision, fails the gate — drop
it. For every architectural move that survives the gate, add a
`**Parallelization rationale:** <named independence win>` line in that task's body,
**after the `**Interfaces:**` block** (never in the `**Type:**`/`**Depends-on:**`
header block), so the operator can audit it when reviewing the plan.

**Escape valve.** It is correct to conclude there is **no latent parallelism** in a
spec and move on — small or inherently-linear work should not be reshaped. The gate
plus this escape valve are what keep shaping from manufacturing breadth; a plan that
genuinely does not fan out should stay narrow, and the recommender will route it to
a sequential executor honestly.

## Efforts too large for one plan

When a spec is decomposed into several plans run as separate `/ultrapowers`
invocations, per-phase green does **not** establish integrated green — each run's
completeness critic sees only its own plan's tree, never the seams between phases
(this is where a holistic review catches integration bugs that every per-phase
gate passed). So when you author one plan of a multi-plan effort:

1. Design the decomposition so the **final** plan carries an **integration-spanning
   acceptance** — a sealed exam or suite whose checks exercise behavior that crosses
   the earlier phases, run against a tree that already contains them.
2. Never let N green per-phase gates stand in for one integrated-green gate; an
   integration bug lives precisely *between* phases, where no single-phase exam looks.
3. If the effort genuinely cannot end in an integration acceptance, declare it at the
   final gate as an explicit waiver ("cross-phase integration unverified — phases
   sealed separately"), never silently.

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

A plan carrying **no markers at all** still compiles, but every disposition is
guessed: the compiler sets `allHeuristic` and the Step-3 transparency render
flags it with **`0 markers — all dispositions inferred`**, so the operator knows
the entire wave plan rests on heuristics rather than an authored contract. Mark
your tasks to replace those guesses with a trusted classification.

## Replace the plan header

writing-plans mandates this header line on every plan:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

On a marked plan, REPLACE it with:

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

Without this, the header literally directs any skills-obedient agent into the
sequential executor — the parallel run happens only because a human typed
`/ultrapowers`.

## Execution Handoff (analyze, then recommend)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first — but do **not** default to Ultrapowers. First run the
execution-fit analysis below, then tag the single best-fit option as
**(recommended)**. The plugin is named Ultrapowers, but the recommendation is
earned per plan, not granted by reflex — recommending Subagent-Driven or Inline
when the plan does not benefit from parallel waves is the correct, honest
outcome.

### The fit analysis

Read three signals off the marked plan you just authored:

- **T** — the number of `implementation` tasks (`gate` / `release` / `manual`
  tasks do not run in waves and are not counted).
- **parallel width** — yes/no: is there at least one wave with ≥2 independent
  tasks, *after* treating same-file `Modify` pairs as dependencies (this is how
  the compiler nets out file contention, so two tasks colliding on a shared file
  are not width)? Compute it by hand from the `**Depends-on:**` graph plus the
  `**Files:**` blocks.
- **risk** — true if Acceptance is `sealed` (the operator cannot read the diff),
  or the work touches a high-stakes surface (auth, payments, migrations, data
  integrity, public API), or behavior is hard to verify by reading.

Decide with the first branch that matches:

1. **risk → Ultrapowers** — the **risk override**. Independent per-task review,
   the held-out sealed exam, and one pre-merge gate are the value here, not
   speed. Name the specific risk in the rationale.
2. **parallel width and T≥4 → Ultrapowers** — real parallel speedup clears the
   worktree/merge overhead.
3. **T≤2 → Inline** — too small to spin up machinery.
4. **else → Subagent-Driven** — linear chains, or narrow plans where parallel
   benefit does not pay; fresh-context isolation + review between tasks still
   earns its keep.

The bar in branch 2 is deliberately conservative: because the risk override
already carries every quality-critical plan, T≥4 only ever trades away marginal
parallelism on small low-risk plans, never verification. T is a proxy for
effort, so a handful of heavy fully-independent tasks may route to Subagent-Driven
— slower than ideal but still reviewed; accept it rather than lowering the bar.

### Render

Show a one-line analysis citing the signals, then the three options with
**(recommended)** on the analyzed winner. Ultrapowers stays listed first for
discoverability regardless of which option won:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: parallel waves, worktree
   isolation, per-task review, one pre-merge human gate. Selecting this option
   authorizes execution: ultrapowers renders its wave plan for transparency and
   launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution (upstream removed batch checkpoints in superpowers 5.0.0; its own handoff text still says otherwise — trust the behavior, not the menu).

Example analysis lines:

- `6 implementation tasks, widest wave 3, low risk → Ultrapowers (recommended).`
- `4 tasks, linear chain, touches auth → Ultrapowers (recommended; risk: auth).`
- `4 tasks in a linear chain, low risk → Subagent-Driven (recommended).`
- `2 trivial tasks → Inline (recommended).`

## Choose the right Type

- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed in the wave-plan transparency render. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.

A task with no `writes` whose steps are build/verification-only (no implementation
verb in its prose) compiles to `gate`, not `implementation` — otherwise its empty
Files block would draw an ambiguous-files fan-in from every upstream task and force
a serial tail. If a verification task is genuinely empty-Files, mark it `gate`.

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

## Populate the v6 blocks — they are load-bearing here

superpowers v6 adds two plan blocks. In ultrapowers they are **not just
documentation** — the compiler reads them, so populate them deliberately:

1. **`## Global Constraints`** (a header section, project-wide). Copy the spec's
   binding, cross-cutting requirements verbatim — version floors, naming/copy
   rules, platform requirements. ultrapowers forwards this block to **every
   reviewer as its attention lens**, so a reviewer gates the work against exactly
   what the spec demands.

2. **`**Interfaces:**`** (per task, with `Consumes:` / `Produces:` sub-bullets).
   `Produces:` names the function names and param/return types later tasks rely
   on; `Consumes:` names the signatures this task uses from earlier tasks. A
   worktree-isolated implementer sees only its own task body — Interfaces is how
   it learns the names and types its neighbors expose.

These are **load-bearing**: ultrapowers cross-checks each task's `Consumes`
against the `Produces` of every other task. When Task B `Consumes:` a symbol Task
A `Produces:`, the compiler infers B-depends-on-A — and if that edge is **not**
already covered by B's `**Depends-on:**` (or a file-overlap edge), it surfaces a
loud **"undeclared dependency"** finding in the wave-plan transparency render at
the Step-3 gate. The plan still compiles and waves correctly; the finding tells
you your `**Depends-on:**` was wrong — fix it at authoring time. So: whenever a
task `Consumes:` something a sibling `Produces:`, add the matching
`**Depends-on:**` yourself.

**One edge the compiler cannot see: a test-only import.** The cross-check above
catches a dependency you named in `Consumes:`/`Produces:`, but a dependency that
lives **only** inside a test's `import` of a sibling task's symbol is invisible —
ultrapowers reads markers, `Test:` overlap, and prose, never source or test *file
contents*. When a task's **test** imports a symbol a sibling task owns, declare it
as an explicit `**Depends-on:**` on the importing task; otherwise the two run in
parallel off a base where the imported sibling does not yet exist and the wave
cascade-blocks.

**Describe siblings by role, not by filename.** In a `Produces:`/`Consumes:`
field — and in any description prose above the first `- [ ]` step — name what a
sibling task *does*, never its output path. Backticking a sibling's filename
there (`app/schema.py`, `schema.User`) injects a **phantom serializing edge**:
the compiler cannot tell a genuine dependency from a passing mention, so it
infers the edge and warns `description-inferred` at the Step-3 gate. The
write-time fix is **not** to add a `**Depends-on:**` — it is to not write the
filename: describe the sibling by its role, and reserve backticked paths for
this task's own `**Files:**` entries. (This is the write-time rule; the
self-review checklist below still catches a slip that survives to review.)

**Marker placement is unchanged.** `**Type:**` and `**Depends-on:**` stay in the
contiguous header block immediately after the `### Task N:` heading and before
`**Files:**`. `**Interfaces:**` is **not** a header marker: it sits **after** the
`**Files:**` block and before the first `- [ ]` step. Shape:

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

Because `**Interfaces:**` falls after `**Files:**`, it never enters the header
marker block, and `**Type:**`/`**Depends-on:**` keep their exact pinned positions.

## Seal the exam (after plan approval)

A marked plan is not execution-ready until it carries an `**Acceptance:**`
line (the compiler refuses it otherwise). After the human approves the plan:

1. Dispatch a fresh-context author subagent per
   `references/seal-author-prompt.md`. Its inputs are ONLY: the spec text,
   the repo's test conventions (framework, run command, naming), the base
   branch name, and the vault path `~/.ultrapowers/acceptance/`. Never the
   plan, never the task list, never this conversation's history.
2. The author writes the suite into the vault, authoring an optional
   `bootstrapCmd` when the repo's own libraries need an editable install /
   setup to import, and proves it RED through the exact gate runner
   (`run_acceptance.sh --baseline …`, which creates the worktree, runs the
   bootstrap, then the suite, exactly as the pre-merge gate will) — a suite
   that passes before the work exists tests nothing; a `redKind:"collection"`
   red must fail on the feature's own import, not a still-unbootstrapped repo
   library. The author writes `manifest.json` (recording `bootstrapCmd` so
   seal-time and gate-time share one run context) and returns ONLY: seal-id,
   sha256, red-run evidence, and a coverage summary mapping spec criteria to
   test names.
3. Append to the plan, after the header block:
   `**Acceptance:** sealed <seal-id> (sha256:<hash>)` plus the coverage
   summary as a short appendix (spec-derived, safe to show).
4. Two consecutive green-at-baseline attempts → stop and tell the human: the
   spec may describe behavior that already exists.

The operator may instead record `**Acceptance:** waived — <reason>`; waivers
surface verbatim at the wave-plan gate, in the report, and at the pre-merge
gate. Never waive silently on the operator's behalf.

When the operator reviews the appended coverage summary, point them to the vouching rubric in `ultrapowers` SKILL.md Step 3: they vouch by checking the summary faithfully and completely restates the spec — covered? / invented anything? / examples present? — not by reading the tests.

### Choosing the disposition

Every marked plan declares one of three Acceptance dispositions:

- **`**Acceptance:** sealed <seal-id> (sha256:<hash>)`** — feature work whose
  operator cannot read the code. A held-out exam, authored from the spec by an
  independent agent (the sealing step above). This is the default.
- **`**Acceptance:** suite — <reason>`** — ultrapowers' own engine / skill /
  doc / prompt / script development, where the author and operator both read
  the diffs and the committed test suite + drift pins + adversarial review are
  the verification. No held-out exam is authored; the engine binds acceptance
  to the committed test result (`acceptance.passed === tests.passed`).
- **`**Acceptance:** waived — <reason>`** — verification genuinely skipped, by
  explicit operator choice. Reserve this for the rare case where neither a
  held-out exam nor the committed suite applies.

Rule of thumb: building software *with* ultrapowers → `sealed`; building
ultrapowers *itself* → `suite`; opting out → `waived`.

## Self-review additions

After writing-plans' own self-review checklist, verify:

- Decomposition was shaped before annotation: every contract-first task and
  seam-split names its independence win and passes the good-engineer test, and
  each surviving architectural move carries a `**Parallelization rationale:**`
  line — or the plan is intentionally narrow because the work has no latent
  parallelism.
- Every task carries an explicit `**Type:**` (or is intentionally default
  `implementation`).
- Every cross-task constraint appears as `**Depends-on:**` on the downstream task.
- No preamble section holds load-bearing coordination that isn't also in the
  affected task bodies.
- Gates, release rituals, and owner actions are marked `gate` / `release` /
  `manual` — nothing relies on the executor's classification heuristics.
- Every backticked mention of a file or module another task creates (`apistub/schema.py`, `schema.User`) has a matching `**Depends-on:**` on the referencing task — otherwise the compiler infers a `prose-reference` edge and surfaces it as a conflict at the wave-plan gate.
- Every **test-asserted literal** traces to content the same task prescribes. Walk each task's test steps: every exact string, symbol, or behavior a test checks for must appear in what that task's implementation steps produce. A test asserting a literal the task never writes is a plan contradiction — the test is the authority (the implementer will make the assertion pass), so fix the plan to prescribe that content, or drop the assertion.
- The plan carries an **Acceptance:** line — sealed, suite, or an explicit operator waiver (see "Choosing the disposition").

(End of SKILL.md.)
