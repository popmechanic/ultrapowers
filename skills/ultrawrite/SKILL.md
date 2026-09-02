---
name: ultrawrite
description: Use when writing ANY implementation plan — this plugin's owned authoring skill. Elicits the operator's claim, shapes the decomposition into signed contracts, runs the proof gate, and emits a claims-v1 plan that /ultrapowers compiles into waves. Replaces the marker-layering skill and the external writing-plans dependency for plan bodies.
---

> **Audience: the authoring agent.** The operator brainstorms, answers elicitation and
> signs; they never write this artifact. Every imperative below addresses the agent doing
> the authoring.

# Ultrawrite — author signed, claim-first plans

A task says **what will be true** and **how that is examined**. It never says how to do
the work: there is no Steps slot, so procedure has nowhere to live. The implementer
derives it from a contract and an exam, against real code the plan never saw.

**Announce at start:** "I'm using ultrawrite to author this plan."

## The document

Above the first task: `**Grammar:** claims-v1` (absent, the compiler parses the legacy
grammar — that is the rollback path, not a choice), `**Goal:**`, `**Tech Stack:**`, the
spec path, `## Global Constraints`, and one `**Acceptance:**` line.

## Task shape — pinned to what the parser actually reads

`### Task N: <title>`, then the header block, then the Files block, then exactly six body
slots.

Header markers: **Type:** and optionally **Review:** — nothing else; **Files:** is not a marker and ends the header block.

The compiler closes the header block at the first line that is not marker-shaped, so a
marker written below the Files block is not read — it is dropped and surfaced as a
conflict. Keep both markers in the contiguous run directly under the heading.

- `**Type:**` — `implementation` (the default, and the only Type that waves),
  `gate`, `release`, `manual`. A write-nothing verification task is `gate`; anything that
  pushes, deploys, or waits on a human is its own `release`/`manual` task.
- `**Review:**` — optional, `adversarial` or `lean`. Mark `adversarial` where failure is
  costly or hard to see; unmarked is `lean`.
- There is no `Tier` plan marker. Tier is a signed field of the *intent document* (One
  Driver spec §7), a spend authority — never written on a task here.
- `Depends-on` and `Commutes` lines are refused outright. Ordering is derived from
  Interfaces token-matching and Files overlap; same-path overlap is derived from Files.
  An operator who does not read diffs cannot verify an edge, so no edge is signed.

The Files block carries canonical `Create:` / `Modify:` / `Test:` bullets, backticked
paths, no globs and no open write sets. It is doubly load-bearing: wave shape *and* edge
derivation.

### The six body slots, in this order

- **Claim:** the bilingual pair. The operator's own sentence, verbatim, closed by
  `(quoted from #NNN)` or `(elicited)`; then a `Machine:` line restating it in the
  system's own terms, **its clauses numbered `M1. … M2. …`** — one clause per thing the
  exam must establish. Write do:/see: interactions, never system states. Register drift
  between the two halves is a defect the gate checks.
- **Authorized-by:** the reference licensing this task — issue, spec §, decision record.
- **Interfaces:** `Consumes:` / `Produces:` — exact signatures, exact test names, **one
  symbol per bullet** (the compiler reads the first symbol of a bullet and nothing after
  a comma, so a line listing three symbols derives no edge for the other two). **A test's
  import of a sibling's symbol is a `Consumes:`**; that is now the whole ordering story
  for test-only edges. Placeholders (`none`, `nothing`) are legal and quiet, but a
  `Consumes:` no sibling `Produces:` draws an `ADVISORY`, because with no marker backstop
  a typo and a prose sentence are both silently missing edges.
- **Context:** what the implementer must know that the repo cannot tell it. Its word count
  is reported as an `ADVISORY` and nothing refuses on it. Steps prose smuggled in here is
  caught structurally instead: fences are illegal outside Proof, and task-reference
  ordering phrases (`after Task 2`) draw an advisory and order nothing.
- **Proof:** the exam — tests, golden pairs, fixtures, executable probes. The only slot
  where code fences are legal. Its `Test:` paths must be **disjoint** from this task's
  `Create:`/`Modify:` paths: the exam is a distinct artifact. Its legs — `(a) … (b) …` —
  **each cite the clause they establish, `[M2]`**; the compiler refuses a clause no leg
  cites, a leg citing nothing, or a citation of a clause that does not exist. A universal
  or negation clause (`every`, `no`, `byte-identical`) wants a leg that names what fails
  or is absent; an enumerated clause (`for each of node, pytest`) wants one leg per row —
  both draw an `ADVISORY` when missing, which is the species run-51's gate rejected 11 of
  24 pairs for.
- **Stale-if:** predicates, one per line — `path-exists:` / `path-absent:` /
  `sha-matches: <path>@<sha>` / `issue-open: #NNN` / `issue-closed: #NNN`. A free sentence
  is a refusal; an undecidable staleness test is inert prose.

```markdown
### Task 2: The widget catalog

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `widgetkit/catalog.py`
- Test: `tests/test_catalog.py`

**Claim:** An operator lists the sizes they want and gets one widget per size, in the
order they asked. (quoted from #489)
Machine: M1. `catalog([1, 3])` returns two `Widget`s whose `size` values are `[1, 3]`.
M2. `catalog([])` returns an empty list.

**Authorized-by:** #489; spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3

**Interfaces:**
- Consumes: `make_widget(n: int) -> Widget`
- Produces: `catalog(sizes: list[int]) -> list[Widget]`

**Context:** The catalog is a thin mapping over the constructor — it neither validates
sizes nor caches, so a bad size surfaces as the constructor's own `ValueError`.

**Proof:**
- Test: `tests/test_catalog.py`
- Legs: (a) `catalog([1, 3])` yields exactly two widgets with sizes `[1, 3]` in that
  order [M1]; (b) `catalog([])` is exactly `[]` [M2].

**Stale-if:**
- path-absent: `widgetkit/widget.py`
```

## Elicit the claim — never draft it for countersigning

**From a filed issue** (the common path, and what keeps autonomous drains working): quote
the operator's own words as the Claim, anchored to the issue; bind the machine
restatement; show the pair once for confirmation — confirmation, not authorship.
**Quote desired-state sentences, never diagnosis sentences**: an issue's description of
the defect ("today X happens") makes a claim a passing exam renders *false* — the gate
rejects it. Quote the sentence that says what should be true instead.

**From a bare idea:** ask scenario questions — *"after this run, what can you see or do
that you couldn't before?"* — offering 2–3 pre-chewed do:/see: options via
AskUserQuestion. The operator's pick plus their edits is the claim.

Aim claims where the suite is structurally blind: integration seams, visual states, CLI
output, error-path wording. A claim that only restates what a test already asserts buys
nothing.

## The proof gate — before any compile

One fresh-context subagent per task, asked one question: *if this exam passes, is the
sentence necessarily true, at the right layer?* Layer mismatch means no compile until the
task is revised. Run `compile_plan.py --check` first: the mechanical gaps (an uncited
clause, an uncited leg) are refusals there, so the gate reads the pair clause by clause
with those already closed and spends its judgment on the species only it can see — does
leg (b) actually falsify M2, or merely mention it?

Its diet is capped mechanically, not by the reader's restraint:

    UW=${CLAUDE_PLUGIN_ROOT}/skills/ultrawrite/scripts
    python3 $UW/extract_gate_input.py <plan.md> --task <id>

Feed the subagent **only** that output — no plan body, no ledger, no sibling tasks. Write
each verdict, keyed on the hash the extractor prints, into the sibling
`<plan-stem>.gate-verdicts.json`, with the run's `tally`. The verdict is an artifact, not
a memory: the compiler refuses a plan whose record is missing or whose hashes are stale,
so an edited Claim or Proof re-dispatches. The gate agent never authors proofs, and the
wave author never chooses which proof a task satisfies.

Then resolve provenance and compile:

    python3 $UW/check_provenance.py <plan.md>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py --check --renders <plan.md>

`check_provenance.py` (needs `gh`) resolves every anchor and string-matches every
`quoted from #NNN` claim against its issue body at signing time. `compile_plan.py --check`
must print `PLAN OK`; read its `ADVISORY` lines before handoff. A plan is not done until
all three pass.

## The worktree-pure contract

Every `implementation` task is a pure diff against the integration branch:

1. **Self-contained bodies.** A task agent sees only its own body — every coordination
   note (port assignments, shared literals) lives in the body of each task it affects,
   never only in a preamble.
2. **No branch instructions.** The executor owns branching.
3. **Concurrency-safe proofs.** Same-wave suites run at once on one machine: unique port
   and temp path per test, no shared on-disk fixtures.
4. **Name only what exists.** Every path a slot cites must exist at BASE or be created by
   a task this one derivably follows.
5. **Claims about the live world carry their evidence.** A task asserting what a live
   system does is unverifiable from a sandbox — paste the commands and their output into
   Context so review checks correspondence to a record, not truth it cannot reach.
6. **Isolate `CLAUDE_CONFIG_DIR`** in any task that spawns the agent CLI, or it writes
   false memories into the host project.
7. **Greenfield targets take the Bun + TypeScript defaults** — `bun install` to
   bootstrap, `bunx tsc --noEmit && bun test` as the suite. Both knobs verbatim,
   the `@types/bun` tsconfig gotcha, and where the restriction stops:
   `references/greenfield-stack.md`.

## Decomposition judgment

Independence is a property of contracts, not of files.

1. **Split by default.** Every piece of work that can carry its own contract — a module
   with its own exports and its own tests — is its own task. Where a consumer would wait
   on a producer, put the shared shape (a schema, a signature, a file format) as one
   literal in the Context of every task that touches it; the critic checks that the
   implementations agree with it. A `Consumes:` of a sibling's `Produces:` orders the two;
   a shared literal does not, so prefer the literal wherever the consumer only needs the
   shape. Workers have no shared memory — a chain of two tasks is two strangers in
   sequence, not one mind holding a design — so a chain buys no coherence, only the wait.
2. **A chain must justify itself.** The only reason to make task B wait on task A is that
   B needs A's *runtime behaviour*, not A's shape — something no contract can promise.
   Name that behaviour in B's Context, in one sentence. "At this size", "a good engineer
   would keep this together" and "it is one file" are not reasons: same-file edits fold,
   and size is what width is for. Measured 2026-09-02: the same tool built as a two-task
   chain took 79 min with one fix round; as nine contracts, seven wide, it took 49.5 min
   with none (#541).
3. **State the width.** The plan's `**Parallelization rationale:**` line names each
   wave's width and every chain longer than one with its sentence from rule 2. Concluding
   that a plan is genuinely linear is still a legal outcome — it just has to say why.
4. **Let same-file edits stand.** Concurrent same-file *text* writes fold at merge, so a
   shared hot file is never a reason to reshape a plan — let colliding `Modify` lines
   collide. Non-text (binary, symlink) same-file pairs are ordered automatically. Blast
   radius follows the contract, not the file: a task that changes a `Produces:` shape owns
   every strict-equality pin of it, in any sibling's file — list that file in its own
   Files block.
5. **Prefer several small concurrent plans** folding into one frontier over one large plan
   (N=3 drains measured 0.26× batch). Until that fold lands (Tier 2), an effort split
   across plans gives the **final** plan an integration-spanning acceptance — per-phase
   green never establishes integrated green — or declares the gap explicitly at the final
   gate. Never silently.

## Global Constraints discipline

`## Global Constraints` is forwarded to every reviewer as its attention lens. Copy the
spec's binding, cross-cutting requirements: version floors, naming and copy rules,
platform requirements. State what must be true **of the result**. Process rules — TDD
ordering, commit cadence, "write the failing test first" — are never Global Constraints:
no diff evidences the order work was done in, so as a lens they yield only unverifiable
findings, one per task.

## Execution handoff — analyze, then recommend

Offer three options, parallel first, and do **not** default to the parallel lane. Read
three signals off the plan:

- **T** — the number of `implementation` tasks.
- **parallel width** — is there a wave with ≥2 independent tasks, after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge)? Compute it from derived edges plus the Files blocks.
- **risk** — a high-stakes surface (auth, payments, migrations, data integrity, public
  API, loops/cursors/pagination/budgets/termination logic), or behavior hard to verify by
  reading.

First match wins: risk → Ultrapowers (the **risk override** — independent per-task review
is the value, not speed); parallel width and T≥4 → Ultrapowers; T≤2 → Inline;
else → Subagent-Driven. Show a one-line analysis, then the three options, tagging the
winner **(recommended)**:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: commits the plan and drives it on the
   exe.dev fleet (parallel waves in a sandbox, per-task review, the orchestrator opens the
   PR). Selecting it authorizes execution: the plan is committed and the fleet run
   launches immediately, without a further approval pause.
2. **Subagent-Driven** — sequential, fresh context and review between tasks.
3. **Inline** — continuous inline execution.

A claims-v1 plan has no steps to follow, but a sequential executor can implement
task-by-task from contract plus proof.

## Acceptance disposition

- `**Acceptance:** suite — <reason>` — the default: the committed suite plus per-task
  review is the verification.
- `**Acceptance:** waived — <reason>` — verification genuinely skipped, by explicit
  operator choice. Waivers surface verbatim at the wave-plan gate, in the report, and at
  the pre-merge gate. Never waive silently on the operator's behalf.

## Self-review

- Every task carries all six slots, in order, none empty, and no checkbox steps.
- Every Claim is the operator's words with a provenance tag, paired with a machine
  restatement at the same layer, and its gate verdict is recorded and fresh.
- Every Stale-if entry is a predicate; every Proof `Test:` path is disjoint from the
  task's own writes; every fence sits in Proof.
- Every Machine clause is numbered and cited by a leg; every universal or negation clause
  has a leg that names what fails or is absent; every enumerated row has its own leg.
- Every cross-task edge is derivable — Interfaces symbols match a sibling's `Produces:`,
  or the Files blocks overlap. Nothing rides on prose.
- The rationale line states each wave's width; every chain longer than one names the
  runtime behaviour its consumer needs (rule 2), and any exam that quantifies over a
  directory was checked against BASE for pre-existing violators (#536).
- Global Constraints state results, not process; the plan carries an Acceptance line.
