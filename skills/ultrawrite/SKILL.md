---
name: ultrawrite
description: Use when writing ANY implementation plan — this plugin's owned authoring skill. Elicits the operator's claim, shapes the decomposition into signed contracts, runs the proof gate, and emits a claims-v1 plan that /ultrapowers runs as a pool of tasks on the fleet. Replaces the marker-layering skill and the external writing-plans dependency for plan bodies.
hooks:
  Stop:
    - hooks:
        - type: command
          command: bash "${CLAUDE_PLUGIN_ROOT}/hooks/keep_working.sh"
          timeout: 10
---

> **Audience: the authoring agent.** The operator brainstorms, answers elicitation and
> signs; they never write this artifact. Every imperative below addresses the agent doing
> the authoring.

# Ultrawrite — author signed, claim-first plans

A task says **what will be true** and **how that is examined**. It never says how to do
the work: there is no Steps slot, so procedure has nowhere to live. The implementer
derives it from a contract and its probes, against real code the plan never saw.

**Announce at start:** "I'm using ultrawrite to author this plan."

## The document

Above the first task: `**Grammar:** claims-v1` (absent, the compiler parses the legacy
grammar — that is the rollback path, not a choice), one `**Claim:**` line — the operator's
own do:/see: sentence about what they will see after the run, closed `(elicited)` when they
said it to you and `(quoted from #NNN)` when an issue already carries that sentence
verbatim; those two tags and no third — then `**Goal:**`, `**Tech Stack:**`, the spec path,
and `## Global Constraints`.

Directly under that `**Claim:**` line — the next line, no blank between — the plan carries
one `**Summary:**` paragraph: three sentences in the operator's register saying what this
is, why it exists and how it benefits the user. The author writes those sentences and the
operator confirms them in the same touch as the Claim, never a second one, and the pull
request the run opens quotes them verbatim, so what a reader meets is what the operator
signed. It is one paragraph running to the next blank line, no markdown inside; like
`**Closes:**` it is free prose to the compiler — nothing parses it.

Beside `**Tech Stack:**`, an optional `**Dependencies:**` line declares every package the run installs:
one line, space-separated specs, each `name` or `name@range`, with the single word `dev:`
marking where the development-only group begins — `**Dependencies:** tailwindcss@^4
@tailwindcss/vite dev: eslint @shadcn/lint` declares two packages for the app and two for
development. The range alphabet is closed to what a shell may be handed as one quoted
word: `^4`, `~1.2`, `4.x` and `==1.0` are specs, `>=1.2` is refused at `--check` with a
sentence naming the offending word, and so is a second `dev:` or a line naming no package
at all. A package is declared here and never discovered later: no task of the plan adds
one by editing `package.json`, `pyproject.toml` or a lockfile. A manifest on a task's
Files list is edited for a script or a config field, not for a dependency — the driver
reds a manifest edit outside a task's Files, so a package that is not on this line is a
package the run never gets.

A TinyApp plan that publishes carries `**Publish:** <deploy command>` (run in the
target's checkout after the self-merge, with `CLOUDFLARE_API_BASE_URL` pointed at the
`cloudflare` edge integration and `CLOUDFLARE_API_TOKEN` a placeholder; the checkout has
no `node_modules`, so the command installs what it needs), `**Verify:** <probe command>`
(run with `ULTRA_PUBLISH_URL` set to the first `https://…workers.dev` URL the deploy
printed; it must read that variable), and optionally `**Rollback:** <command>` (run once
when the verify exits non-zero); the account id is the target's `wrangler.jsonc`
`account_id`, never a plan line. The parser prints the three as `publish: {deploy, verify,
rollback}`.

An optional `**Closes:**` line names the tickets the plan closes. It sits directly under
`**Goal:**` — the next line — and is one line: `**Closes:** #660 #668`, the numbers
space-separated, each an issue of the target repository (a bare `#N` means the target to
GitHub, so a foreign target's plan names that repository's issues, never this plugin's).
The sandbox reads exactly that line from `.ultrapowers/plan.md` and appends one
`Closes #N` per number to the pull request body, so the run's merge closes them; a plan
without the line closes nothing. The line is free prose to the compiler — nothing parses
it, so a number scraped from `**Goal:**` is never used: the Goal line cites decisions as
well as tickets, which is why scraping it was rejected.

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
- `**Review:**` — optional, `peer` or `lean`, kept for the record. Since the engine plan of
  2026-09-14 (PR #974) every task gets exactly one reviewer and one fix round whatever the
  value says; the pair `peer` used to buy is gone on its reading (8 marginal findings,
  n=71 runs through 2026-09-13, #964).
- There is no `Tier` plan marker. Tier is a signed field of the *intent document* (One
  Driver spec §7), a spend authority — never written on a task here.
- `Depends-on` and `Commutes` lines are refused outright. Ordering is derived from
  Interfaces token-matching and Files overlap; same-path overlap is derived from Files.
  A Proof `Run:` whose command names a path in a sibling's Files — and not in the running
  task's own — is derived the same way: the sibling that owns the file goes first, because
  a command cannot run a file nobody has written yet.
  An operator who does not read diffs cannot verify an edge, so no edge is signed.

The Files block carries canonical `Create:` / `Modify:` / `Delete:` bullets, backticked
paths, no globs and no open write sets. It is doubly load-bearing: wave shape *and* edge
derivation.

That block is the expected footprint of a submission, not a fence. A worker that must go outside
it, that must read a clause otherwise, or that must re-aim a sim declares an amendment: the record
carries it as a `driver:amendment` row and on the pull request card, and the reviewer reads it as a
lens on the diff rather than as a breach to revert. So the author still lists every file they can
foresee the task touching — an unforeseen one now costs a declared amendment, not a dead task — and
reads a run's amendments as the next plan's input, since what the workers had to declare is exactly
where this plan's Files sets were wrong.

### The six body slots, in this order

- **Claim:** the bilingual pair. The operator's own sentence, verbatim, closed by
  `(quoted from #NNN)`, `(elicited)`, or `(derived)` when it descends from the plan-level
  Claim rather than a sentence the operator said about this task; then a `Machine:` line
  restating it in the
  system's own terms, **its clauses numbered `M1. … M2. …`** — one clause per thing the
  exam must establish. Write do:/see: interactions, never system states. Register drift
  between the two halves is a defect the gate checks.
- **Authorized-by:** the reference licensing this task — issue, spec §, decision record.
- **Interfaces:** `Consumes:` / `Produces:` — exact signatures, exact test names, **one
  symbol per bullet** (the compiler reads the first symbol of a bullet and nothing after
  a comma, so a line listing three symbols derives no edge for the other two). **A test's
  import of a sibling's symbol is a `Consumes:`**; that is now the whole ordering story
  for test-only edges. Placeholders (`none`, `nothing`) are legal and quiet. Read every
  `Consumes:` against its sibling's `Produces:` yourself, because with no marker backstop
  a typo and a prose sentence are both silently missing edges, and nothing warns on one.
- **Context:** what the implementer must know that the repo cannot tell it. Keep it short;
  nothing refuses on its length. Steps prose smuggled in here is
  caught structurally instead: fences are illegal outside Proof, and a task-reference
  ordering phrase (`after Task 2`) orders nothing at all.
- **Proof:** the plan's `Run:` probes, citing clauses, and nothing else. The only slot
  where code fences are legal. Its legs — `(a) … (b) …` —
  **each cite the clause they establish, `[M2]`**; the compiler refuses a clause no leg
  cites, a leg citing nothing, or a citation of a clause that does not exist. **A probe
  computes facts and nothing else**: an exit code, a recorded argv, a byte-exact string, a
  count, an ordering of events, agreement with an oracle. A clause, or the part of one, that
  only says what the code says or how it is shaped is Jev's to read against the hunk at
  landing and needs no leg of its own beyond the citation. One case per behaviour, never one
  per variant, synonym or error flavour: an enumerated clause is still one behaviour. A
  universal or negation clause about a computable fact (`no file is written`, `exits 2`)
  still wants the one leg that names what fails or is absent.
  A `Run:` bullet names a command the driver executes in the task's clone after the
  implementer's patch lands; its exit code and output are evidence the reviewer reads
  against the legs, and a non-zero exit sends the task to the fix loop. A task whose
  deliverable is prose proves itself with `Run:` commands, never with a test that
  matches sentences of a document.
  And one `Run:` names one probe — a command the driver pays once, never a loop over a glob
  of sims (run-87 paid 175 s per boot sim, three passes, for two such lines). A sweep over
  every sim belongs to the one task that owns the sims, as one line, or nowhere.
  A `Run:` whose command ends in a citation tag of the same shape a leg carries —
  `- Run: grep -q 'kata 0.17.2' fleet/CONTRACT.md [M2]`, or `[M1, M3]` — is a *prover*,
  paired with the clause it names: the compiler strips the tag before the driver runs the
  command, refuses a tag naming a clause the Machine line does not number, and never counts
  the tag as a citing leg (the legs still cite). A `Run:` with no tag is a *guard* — a
  `bash -n`, a sim that must stay green. **An untagged prover settles nothing**: the
  engine's `settled` read null on every clause of every landing on run-225 because no probe
  carried a tag, so Jev read every clause from the diff alone (n=1 run, 3 tasks,
  2026-09-22) — tag every prover.
  Under `--base <sha>` `plan_check.py` cuts a
  clean worktree at BASE and runs every `Run:` there, printing one line per command that
  exits 0 at BASE: a `GREEN-AT-BASE fact:` line naming the task and the command, ending for
  a prover `this line cannot falsify its clause` and for a guard `a guard, no leg cites it`.
  A command still running at 30 s is killed and reported `not run (timeout after 30 s)`; a
  non-zero exit prints nothing. This release the line is a fact, not a refusal — `PLAN OK`
  still prints, and the refusal for a prover green at BASE comes after one release's census.
  The plan's Global Constraints `Check:` lines are not rehearsed on the laptop: the sandbox
  runs each one once at base before the first dispatch and records it as a `check:line` row
  carrying `base: true`, so a check red before any task landed is a fact on the run's record.
  Without `--base` nothing is run.
  A `byte-identical to BASE` or `git show HEAD:` comparison is a **tautology at the
  integration head**, where HEAD already carries the edit — so a BASE comparison is a
  `Check:` with `$ULTRA_BASE`, which the driver sets in the environment of every `Check:`
  and `Run:` it executes, or a probe carries the value measured *before* the edit: a
  **frozen pre-edit literal**, such as a `git hash-object` sha
  written into it, or a full **40-hex sha** fetched with
  `git fetch --depth=1 origin <sha>`, because `actions/checkout` leaves the clone at
  depth 1 and a short or unfetched sha is not in it.
  That frozen literal is the *only* lawful sha a probe carries: a committed probe
  **never reads ULTRA_BASE** and never **freezes a commit sha** of the plan's own
  repository, because a BASE comparison is a `Check:` or `Run:` — the driver hands that
  command the sha, and a depth-1 clone holds no other commit to compare against.
- **Stale-if:** predicates, one per line — `path-exists:` / `path-absent:` /
  `sha-matches: <path>@<sha>` / `issue-open: #NNN` / `issue-closed: #NNN`. A free sentence
  is a refusal; an undecidable staleness test is inert prose.

```markdown
### Task 2: The widget catalog

**Type:** implementation
**Review:** peer

**Files:**
- Create: `widgetkit/catalog.py`

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
- Run: python3 -c "from widgetkit.catalog import catalog; ws = catalog([1, 3]); assert [w.size for w in ws] == [1, 3] and len(ws) == 2" [M1]
- Run: python3 -c "from widgetkit.catalog import catalog; assert catalog([]) == []" [M2]
- Legs: (a) `catalog([1, 3])` yields exactly two widgets with sizes `[1, 3]` in that
  order [M1]; (b) `catalog([])` is exactly `[]` [M2].

**Stale-if:**
- path-absent: `widgetkit/widget.py`
```

## Elicit the claim — drafted, then confirmed

A Claim is **drafted by the author** and **confirmed by the operator**, and the two happen in
one touch: the author writes the sentence off the issue or the conversation, puts it with its
machine restatement and its summary inside a single AskUserQuestion, and the operator's pick —
or their edit — is the signature. That, and only that, is what the `(elicited)` tag on a signed
Claim records: not that the operator typed the sentence, but that they saw it and adopted it.
Pretending otherwise costs a round trip and buys nothing, because a Claim the author never
drafted is a bare open question wearing a tag.

A Claim question may also be put **without a (Recommended)** option, when the author has two
honest drafts and no preference between them. Then the register row for that question records
its `recommended` as `null`, and the pick carries information: an untagged question is the one
place where what the operator chose is data rather than assent.

**Every question carries a Please explain option.** Every AskUserQuestion of a sitting — the
Claim, the execute question, every sitting-level pick — lists `Please explain` as one of its
options beside the 2–3 choices, never as the `Other` path. On that pick the author asks the
same question again, in place, with the explanation written into the question's own text above
the Claim, the same options and the same `(Recommended)` tag, and `Please explain` still listed.
The explanation escalates by round: round one in plain words — what the sentence means, what
they will see or do differently after the run, and what each option costs them, all inside the
re-asked question's text; round two a concrete before-and-after — one thing they see today and
the same thing after the run, not more words; round three the author says the sentence itself
is the problem, rewrites the Claim simpler, and offers the rewrite as a new option, and that
pick is the operator's edit. Each round adds 1 to that question's `explain_rounds` in the record
and is not a second touch of the ceremony. A question that took two or more rounds is a sentence
to rewrite at the release census, not a question to retire (#526, #239).

A question whose recommended option is **picked on every plan** of a release is not a question.
At the release census it is **retired** — its default written down here, the sitting one touch
shorter (#727) — and what stays in the register is only what a pick can still move.

**From a filed issue** (the common path, and what keeps autonomous drains working): quote
the operator's own words as the Claim, anchored to the issue; bind the machine
restatement; show the pair once for confirmation — confirmation, not authorship.
**Quote desired-state sentences, never diagnosis sentences**: an issue's description of
the defect ("today X happens") makes a claim a passing exam renders *false* — the gate
rejects it. Quote the sentence that says what should be true instead.

**From a bare idea:** ask scenario questions — *"after this run, what can you see or do
that you couldn't before?"* — offering 2–3 pre-chewed do:/see: options via
AskUserQuestion. The operator's pick plus their edits is the claim.

**The summary rides with the claim.** Draft the three `**Summary:**` sentences yourself —
what this is, why it exists, how it benefits them — in the operator's register, off the
issue or the conversation, and put that draft to the operator inside the *same*
AskUserQuestion that carries the Claim: one touch, not two. The operator adjudicates and
never authors: their edits are the summary. A summary written in the technical register —
a file name, a function name, a sha — is a defect you fix before the gate.

Aim claims where the suite is structurally blind: integration seams, visual states, CLI
output, error-path wording. A claim that only restates what a test already asserts buys
nothing.

## Authoring a queue

A sitting's queue of well-defined issues drains by partitioning it by files into
disjoint bundles, and it must partition by `Create:` paths as well as by files: two
plans that would touch one file go in one bundle, since same-file edits fold inside
one run and never across two PRs, and two plans that would create one path go in
one bundle, or the second declares `Consumes:` on the first and launches after it
(the 2026-09-17 drain serialized #1095 and #1096 by hand after both listed `Create:
fleet/jev-client.mjs`). Dispatch one author subagent per bundle — each loads this
skill, pins its own BASE facts, dispatches its own fresh gate readers per task,
writing each diet to `<issue>-gate-<t>.json` so the filename carries the plan's
own issue prefix and two authors' readers never collide on the scratchpad (six
authors once collided on bare `gate-<t>.json` names, and author-1096's round-2
readers read a sibling's diet for tasks 2–4, discarding three verdicts), and
compiles to `PLAN OK`. The issue's desired-state sentence is the plan's Claim,
quoted rather than drafted, exactly as the elicitation path above has it.
Grill an issue only when its ticket carries the `wayfinder:grilling` label; an undecided
choice found mid-authoring comes back as a question, not as a guess.

Hold the operator to one Claim confirmation and one execute choice per plan — an explain
round is part of the same touch, not a third — each asked with AskUserQuestion. Launches stay serial: N plans are N launches back to back, because
concurrent launches race on the run number (#667). The clock census (n=3 runs, runs
10–12, 2026-09-05) found authoring throughput, not the sandbox, was the first bound on
how many runs could be live at once — a queue authored in parallel is what lifts it.

## The proof gate — before any compile

One fresh-context subagent per task, asked the facts-only question, word for word:

> A clause that states a COMPUTABLE FACT the Claim depends on — an exit code, a recorded
> argv, a byte-exact string, a count, an ordering of events — needs at least one leg that
> would fail if that fact were false. A clause, or part of one, that only says what the code
> says or how it is shaped is judged at run time by a model reading the diff against the
> clause; it needs no leg of its own. A clause stating a negation or an absence — that
> something is gone, unchanged, or exactly so many — is always a COMPUTABLE FACT and
> always needs a leg, because the run-time reader sees only the diff and the diff shows
> nothing for what is not there. One representative case per behaviour is enough: do
> NOT ask for a leg per enumerated variant, per synonym, or per error flavour. A path absent
> at BASE may be created by this task or an earlier sibling; that is not a failure. Fail
> ONLY when: a computable fact the Claim's sentence depends on has no leg that could catch
> it being false; or a literal a clause pins is unsatisfiable under the clauses' own rules
> (compute it); or a leg contradicts its clause; or the `base` excerpts show a file already
> pinning the opposite; or a leg pins exactly these keys on a record other tasks also
> write — a row of a shared log, a cell of a shared JSON file — where the clause needs
> only that the record carries these keys. A computable fact wants a probe, and a probe is one command with its clause tag.

The question it replaced — *if this exam passes, is the sentence necessarily true* — can
only be satisfied by enumeration, so its readers asked for a leg per variant: on the
2026-09-18 feedback-board plan it rejected seven of nine tasks, every rejection a request
for more legs, where this question passed the same seven in one round and still holds what
the gate is for (n=1 plan, 16 dispatches, 2026-09-18 — an `experiment`; its rollback is
that sentence). What the gate has actually caught is contradiction, unsatisfiability and
vacuity — a proof line that passed with its variable unset, a cycle clause its own edge rule
made impossible, a leg pinning a sha where its clause pinned `HEAD:` — and each would have
cost a fleet run. **An author who answers a rejection by adding legs is answering the wrong
question: narrow the clause first.** A mismatch means no compile until the task is revised.
The exactly-these-keys clause exists because on run-195 (2026-09-18) one task added `ts`
to every row of the run's event log and the probes of two sibling tasks, each asserting a
row's exact key list, went red on the folded tree with both features right (n=2 probes on
1 run, read by hand against the folded head); the fold check now re-runs every adopted
task's probes, and the gate's job is that such a leg is never written.
The literal-computing half is there because on walk run-10 a
Claim pinned `4` vowels in `Ada Lovelace` — `6` under its own M1 and M2 — and the reader
passed the legs on shape without ever computing the number, where a reader asked exactly
this computed six on the re-read and passed the corrected plan.
Nothing mechanical closes the citation gaps any more (an uncited clause, an uncited leg
— the compiler that refused them left at cut B, 2026-09-21), so the gate reads the pair
clause by clause and names those too, beside the species only it can see — does leg (b)
actually falsify M2, or merely mention it?

Its diet is capped mechanically, not by the reader's restraint:

    UW=${CLAUDE_PLUGIN_ROOT}/skills/ultrawrite/scripts
    python3 $UW/extract_gate_input.py <plan.md> --task <id> --base <sha>

Since #989 the reader reads BASE as well: with `--base <sha>` (the launch base, a 40-hex
commit of the plan's repository, or a checkout directory) the diet carries one more key,
`base` — for the task's Files and every path its Proof names, whether the path exists
there, its line count, its headings or test names, and an `excerpt` of the lines that
carry the diet's own literals, at most `8000` bytes per file and `24000` in total,
`truncated` flagged when the cap cut. The reader's question gains its second half on that
excerpt: *whether a named file already pins the opposite of a clause, and whether every
section, path or symbol a leg names exists at BASE — or does not exist there at all.* — so "this sim already asserts the wave count"
and "this doc section does not exist" are the reader's to say, not the sandbox's. The
`hash` a verdict is keyed on is `unchanged` by the excerpt — it is still over the Claim and
Proof only — so a moved base never stales a verdict; record the base a verdict was read
against in the tally (`tally.base`), as the 2026-09-15 plans do.
`--base` takes a checkout directory or the 40-hex sha; a value that is neither a checkout
directory nor a 40-hex sha — an abbreviation of a real commit, a typo — is refused with exit 2
on one line, never read as a tree in which every file is absent (an 8-character abbreviation
handed six readers exactly that on 2026-09-15, #1025).

Feed the subagent **only** that output — no plan body, no ledger, no sibling tasks. Write
each verdict, keyed on the hash the extractor prints, into the sibling
`<plan-stem>.gate-verdicts.json`, with the run's `tally`. The compiler reads exactly this
shape: `{"tasks": {"<id>": {"hash": "<the extractor's hash>", "verdict": "pass" | "fail",
"reason": "<one sentence>"}, …}, "tally": {…}}` — `tasks` keyed by task id with those three
fields, `verdict` one of `pass`/`fail`, `tally` a free-form count object (`dispatched`,
`rejected`, per-round counts) that is kept for the record and not validated; any extra
key, such as a `history` array of every round's verdicts, is tolerated. One such key is
reserved: beside `tasks` and `tally` the record carries the sitting's own `authoring` object,

    {"authoring": {"minutes": 118, "probes": 12, "routing": {"branch": "risk", "lane": "ultrapowers"}, "questions": [{"question": "Claim and summary", "options": ["A", "B"], "recommended": "A", "picked": "A", "explain_rounds": 0}]}}

where `minutes` is the sitting's wall-clock minutes to `PLAN OK`, `probes` the hub probes made,
`routing` the handoff rule's own verdict (§Execution handoff), and `questions` one row per
AskUserQuestion of the sitting — the execute question included, `recommended` null when no
option carried the tag, and `explain_rounds` the number of Please explain rounds that question
took (absent reads 0). The author writes the whole object once, at the execution handoff after
`PLAN OK` and before the launch; the compiler prints it as one `AUTHORING fact:` line under
`--check --base`, ending with the explain count, and the launcher carries that line onto the
launch line. A release reads a run
range with `python3 $UW/authoring_census.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>`,
and its last `totals:` line is what the release notes carry. A missing task, a
stale hash, or a `fail` is a compile refusal. The verdict is an artifact, not
a memory: the compiler refuses a plan whose record is missing or whose hashes are stale,
so an edited Claim or Proof re-dispatches. The gate agent never authors proofs, and the
wave author never chooses which proof a task satisfies.

Dispatch is **per task**, not per round, and every reader runs in the foreground. Dispatch
it with the Agent tool, `subagent_type: "general-purpose"`, `run_in_background: false` —
one call per task, and several such calls may share one message, but none of them is
backgrounded, because a backgrounded reader's verdict is delivered to the session that
spawned the author rather than to the author, who then stops to wait for a message that
never arrives (2026-09-08: of four concurrent authors, three had backgrounded their
readers and had to be resumed by hand with the verdict pasted in, two of them with no
`.gate-verdicts.json` written at all). In the foreground the verdict returns to the author
that dispatched it, as that call's result: the reader answers with its verdict line and one
sentence, and `<plan-stem>.gate-verdicts.json` is written by the author from that returned
verdict, never by the reader — the reader sees only the extractor's output and has no plan
path to write beside. A task whose verdict lands first gets its next
reader the moment its Claim or Proof is edited: re-extract that one task with
`extract_gate_input.py`, dispatch one reader for it, and do not wait for the round's
other verdicts to arrive — the verdict is still keyed on the hash, so the edit is what
re-dispatches, and a round boundary buys nothing. Measured 2026-09-04 (n=1 sitting,
9 rounds): the four wide rounds took 13 of the 22 minutes; rounds five through nine were
one or two tasks apiece,
each of them idle behind a barrier it did not need.

Then resolve provenance and check:

    python3 $UW/check_provenance.py <plan.md>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/plan_check.py --base <checkout-dir|sha> <plan.md>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/plan_parse.py <plan.md>

`plan_check.py` sits on `plan_parse.py`, the parser the sandbox runs, and refuses only
what a parser cannot see: a gate record that is missing, stale or `fail`, a malformed
authoring record, a `Check:` carrying a backtick or naming a path one task owns, a
`Check:` that freezes a pathspec covering a task's own Files, a Stale-if predicate that
already holds at BASE — and, since a plan's proof is its `Run:` probes and nothing else, a `Test:` or `Guard:` bullet or an `Exam command` header is refused outright. It is not a grammar check — the old
compiler's grammar refusals left with it at cut B (2026-09-21), so read `plan_parse.py`'s
own output for the plan before launching (`proofRuns`, `proofRunClauses`, `checks`,
`dag_edges`, `pairs`): what it prints is what the engine will do.

`check_provenance.py` (needs `gh`) resolves every anchor and string-matches every
`quoted from #NNN` claim against its issue body at signing time. The plan is done when
`plan_check.py` prints `PLAN OK` and those two checks — the proof gate and
`check_provenance.py` — have passed.

`--base` takes a checkout directory or a 40-hex sha, and a sha must be present locally:
the check reads that commit's tree with `git show`/`git ls-tree` in the plan's own
repository, so every BASE fact — which paths exist, which file mentions a `Produces:`
symbol, which test pins a Machine-clause span — resolves against the exact commit
`launch.mjs --base` will hand the run, not against whatever the working tree happens to
hold. Unset, `--base` defaults to the plan's own git toplevel.

With a base, the verdict is followed by the tree's own facts about the plan, one
`BASE fact:` line each (#896): what a `- Delete:` file holds at BASE (its line count,
test-case count and section banners — read them before signing a sentence about what
the file is; run-90 deleted five exams on the sentence "entirely the check-runs poll"),
and every file outside a task's Files that carries a literal its Machine clauses pin —
the shape that parked runs 84, 88 and 90. A carrier that pins the value the task
changes goes into that task's Files; the line is a fact, never a refusal.

A `**Stale-if:**` predicate is read against the same base, and it is the one thing there
that does refuse: a predicate that already holds at that base is a `STALE fact: task <id>:
<entry> holds at BASE` refusal — the task is stale before it is dispatched, so the compile
exits 2 and prints no `PLAN OK`. An issue predicate the laptop cannot read is unreadable,
not false: no `gh` on PATH, a non-zero exit, or an answer that is neither `OPEN` nor
`CLOSED` prints `STALE fact: task <id>: <entry> unreadable at BASE — <reason>` as an
advisory line after the verdict, beside the `BASE fact:` lines, so an offline laptop still
prints `PLAN OK` and exits 0. Only `--check --base` asks: a bare `--check` and a plain
compile evaluate no predicate at all.

The launcher
runs this same compile at `--base` before it pushes anything and prints the same
lines, so a plan that does not compile at the launch base is refused on the laptop
(#865), and a `**BASE facts:**` block generated at another sha is refused with the
re-pin command.

The rejection species are listed in `references/authoring-gotchas.md` and read by the
author before a reader is dispatched — nothing prints them.

## The worktree-pure contract

Every `implementation` task is a pure diff against the integration branch:

1. **Self-contained bodies.** A task agent sees only its own body — every coordination
   note (port assignments, shared literals) lives in the body of each task it affects,
   never only in a preamble.
2. **No branch instructions.** The executor owns branching.
3. **Concurrency-safe proofs.** Same-wave suites run at once on one machine: unique port
   and temp path per test, no shared on-disk fixtures.
4. **Name only what exists.** Every path a slot cites must exist at BASE or be created by
   a task this one derivably follows. `docs/superpowers/` is untracked (#544) and absent
   from every sandbox, so a spec path is a reference for the reader, never something a
   worker is asked to open — put what the worker needs from a spec into Context.
5. **Claims about the live world carry their evidence.** A task asserting what a live
   system does is unverifiable from a sandbox — paste the commands and their output into
   Context so review checks correspondence to a record, not truth it cannot reach.
6. **Isolate `CLAUDE_CONFIG_DIR`** in any task that spawns the agent CLI, or it writes
   false memories into the host project.
7. **Greenfield targets take the Bun + TypeScript + TinyBase defaults** — `bun install` to
   bootstrap, `bunx tsc --noEmit && bun test` as the suite, one TinyBase store as the
   app's state; the synced shape (store → WsSynchronizer → Durable Object) is a *TinyApp*.
   Both knobs verbatim, the `@types/bun` tsconfig gotcha, the TinyApp shape, and where the
   restriction stops: `references/greenfield-stack.md`. State exams — a Bun test over a
   seed and an expected store state, once named as a test-file path — are deferred since
   cut three (2026-09-22): a TinyApp task is proven like any other, by `Run:` probes and
   the stack's `Check:` line, until state exams return as probes (owed on map #1248;
   `references/greenfield-stack.md` §State exams carries the shape for that day).

## Decomposition judgment

Independence is a property of contracts, not of files.

1. **Split by default.** Every piece of work that can carry its own contract — a module
   with its own exports and its own tests — is its own task. Where a consumer would wait
   on a producer, put the shared shape (a schema, a signature, a file format) as one
   literal in the Context of every task that touches it; the critic checks that the
   implementations agree with it. A `Consumes:` of a sibling's `Produces:` orders the two,
   and a `Create:` a sibling task later `Modify:`s is the same kind of fact; a shared
   literal orders neither, so prefer the literal wherever the consumer only needs the
   shape. Workers have no shared memory — a chain of two tasks is two strangers in
   sequence, not one mind holding a design — so a chain buys no coherence, only the wait.
   One thing a literal cannot stand in for is the file itself: a probe that imports a sibling's created module
   (`from tests.trends_fixtures import …`, `import('./lib/a.mjs')`) is a `proof-run` edge
   the parser derives and the engine keeps hard under live pairs (#1265), so write the
   probe as it is and list nothing under `Modify:` to force the wait — the wait is derived.
2. **Write no ordering.** On the factory an author writes no ordering: the engine reads
   every overlapping or consuming pair itself, with Jev, starts every task at once unless
   a pair reads as a chain by that reading, and runs every adopted task's probes after every fold.
   `Consumes:`/`Produces:` bullets are still written exactly, one symbol per bullet,
   because they are how a pair is found — but the chain they imply is derived, never
   authored, and there is no width to state and no rationale line to write. An edge an
   author takes only to keep two same-file edits apart — not because a sibling needs the
   other's runtime behaviour — is a defect: on run-193 the author chained the engine task
   behind the hunk-picker task to keep two import inserts out of the resolver, and the
   consumer waited on a producer it needed nothing from — about nine minutes of clock lost
   (n=1 run, 2026-09-18).
3. **Let same-file edits stand.** Concurrent same-file *text* writes fold at merge, so a
   shared hot file is never a reason to reshape a plan — let colliding `Modify` lines
   collide. Non-text (binary, symlink) same-file pairs are ordered automatically. Blast
   radius follows the contract, not the file: a task that changes a `Produces:` shape owns
   every strict-equality pin of it, in any sibling's file — list that file in its own
   Files block. One shape does not fold, though: N tasks that each add one line to one
   list are N **adjacent inserts at one location**, which the fold sends to a resolver —
   run-12 (2026-09-05, PR #662) had five tasks each append one registration line to
   `compile_plan.py`, and the fold spent three resolver workers
   (3.4 worker-minutes, 6.6 of the 13-minute post-review tail) ordering
   five lines any order would have satisfied. Give each such task its **own region or
   file**: a registration is a new file discovered by glob, never an appended line.
4. **Prefer several small concurrent plans** folding into one frontier over one large plan
   (0.26× batch wall, n=1 drain of 3 runs, #454, 2026-09-01). Until that fold lands
   (Tier 2), an effort split
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

The section holds two kinds of bullet, and they are read by different machinery. A
`- Check:` bullet is a command the driver executes in every task's clone before review
and once on the adopted tree — blocking, unless it ends `(minor)`, which is recorded and
never dispatched. A prose bullet is only the referee's attention lens: it is what decides
whether a finding is minor, and nothing runs it. So a constraint a command can decide is
written as a Check:, never as prose — prose is where the undecidable half goes. A prose
bullet naming a byte-identical file or a script's output is one the driver could have run,
so write it as a `Check:` beside the prose. Such a comparison has a base to compare
against: a `Check:` or `Run:` that compares the tree against BASE writes `$ULTRA_BASE`,
which the driver sets, in the environment of every `Check:` and `Run:` it executes, to the
run's base sha — so `- Check: git diff --quiet $ULTRA_BASE -- fleet/` is writable without
knowing the sha, where a frozen `git hash-object` literal is the shape for a single file.
And a `Check:` that runs a sim is paid by every task on every pass, where the same command
in the owning task's `Run:` is paid once: put it there, and keep this section for what no
single task owns. That is not only advice: a `Check:` whose command names a file one task's
Files own is refused at `--check`, naming the task and the path, because a check a single
task would turn green was never run-wide. A `Check:` that freezes a pathspec covering any
task's `Create:`, `Modify:` or `Delete:` path is refused by `plan_check.py` the
same way, because it goes red the moment that task's own patch lands (run-199, n=1 run,
2026-09-21) — freeze files, not the directory they sit in.
## Execution handoff — analyze, then recommend

Offer three options, parallel first, and do **not** default to the parallel lane. Read
three signals off the plan:

- **T** — the number of `implementation` tasks.
- **parallel width** — are there ≥2 tasks with no edge between them, after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge)? Compute it from derived edges plus the Files blocks.
- **risk** — a high-stakes surface (auth, payments, migrations, data integrity, public
  API, loops/cursors/pagination/budgets/termination logic), or behavior hard to verify by
  reading.

First match wins: risk → Ultrapowers (the **risk override** — independent per-task review
is the value, not speed); parallel width and T≥3 → Ultrapowers; T≤2 → Inline;
else → Subagent-Driven. Show a one-line analysis, then the three options, tagging the
winner **(recommended)**:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: commits the plan and drives it on the
   exe.dev fleet (a pool of tasks in a sandbox, several implementers per task, the plan's
   probes and checks as the proof, the sandbox opens the PR). Selecting it authorizes execution: the plan is committed and the fleet run
   launches immediately, without a further approval pause.
2. **Subagent-Driven** — sequential, fresh context and review between tasks.
3. **Inline** — continuous inline execution.

Both halves of that go on the record: the branch that fired and the lane they picked are
written into the plan record's `routing` as `branch` — one of `risk`, `width`, `inline`,
`subagent`, the four branches above, first match wins — and `lane`, one of `ultrapowers`,
`subagent`, `inline`, whichever of the three options above they took (§The proof gate). The
pair is what tells a release how often the recommendation was the lane.

A claims-v1 plan has no steps to follow, but a sequential executor can implement
task-by-task from contract plus proof.

## Self-review

The author reads `references/authoring-gotchas.md` — the lessons every claims-v1 sitting
since run-45 paid for, each a rule with its reason — before the gate readers are
dispatched, and checks the plan against each of them. They are the author's own to
check — nothing prints them.

- Every task carries all six slots, in order, none empty, and no checkbox steps.
- The plan carries one `**Claim:**` above the first task, elicited or quoted from an
  issue. Every task Claim is either the operator's words with a provenance tag or
  `(derived)` under the plan-level Claim, paired with a machine restatement at the same
  layer, and its gate verdict is recorded and fresh.
- The plan carries one `**Summary:**` paragraph of three sentences directly under that
  Claim, in the operator's register — what this is, why it exists, how it benefits them.
- Every Stale-if entry is a predicate; every Proof `Run:` prover ends in the tag of a
  clause the Machine line numbers, and no test-file or guard bullet is written; every
  fence sits in Proof.
- No Proof pins a sentence of a document as its evidence; a prose task's Proof is a
  `Run:`.
- Every Machine clause is numbered and cited by a leg; every computable fact a clause states
  has the one leg that would catch it false, and no behaviour has a leg per variant.
- Every cross-task edge is derivable — Interfaces symbols match a sibling's `Produces:`,
  or the Files blocks overlap. Nothing rides on prose.
- No edge is written to keep same-file edits apart; every ordering left standing is a
  fact the engine can derive — a `Consumes:` matching a sibling's `Produces:`, or a
  `Create:` a sibling later `Modify:`s — and any probe that quantifies over a directory was
  checked against BASE for pre-existing violators (#536).
- Global Constraints state results, not process.
- The `**Closes:**` line, when present, sits directly under `**Goal:**` and names only the
  target repository's issues.
- No pinned number is a guess: every pinned literal was computed, not assumed — the author
  ran the command or did the arithmetic at BASE and pasted back what it printed, rather
  than the figure the sentence wanted to be true.
- Every reading a plan's Context or Summary cites carries `n=… (window)` — `n=9 merged
  runs (131–140)`, never a bare count — and a plan whose default flip rests on a reading
  under the floor says `experiment` in its Summary and names its `rollback` there; the
  floor is `CLAUDE.md`'s `Test doctrine` bullet (n = 5 runs, 20 tasks for a per-task
  reading).
