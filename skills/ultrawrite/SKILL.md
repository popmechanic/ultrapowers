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
A TinyApp target is planned differently: see Story planning below.

**Announce at start:** "I'm using ultrawrite to author this plan."

## The document

Above the first task: `**Grammar:** claims-v1` (absent, `plan_parse.py` refuses the plan —
there is no legacy grammar to fall back to), one `**Claim:**` line — the operator's
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
development. The range alphabet is conventionally what a shell may be handed as one quoted
word: `^4`, `~1.2`, `4.x` and `==1.0` are specs; nothing today reads this line to refuse a
wider range, a second `dev:`, or a line naming no package — the alphabet is the author's own
to keep. A package is declared here and never discovered later: no task of the plan adds
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
when the verify exits non-zero); the account id is the `CLOUDFLARE_ACCOUNT_ID=` prefix in
the target's `deploy` script, never a plan line and never `wrangler.jsonc`, which celld refuses it in. The parser prints the three as `publish: {deploy, verify,
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

## Story planning — TinyApp targets (`stories-v1`)

A TinyApp plan is compiled from a story bundle, not written. **Before any TinyApp plan,
read `references/stories.md` in full and follow it step by step**, after the enrichment in
`references/enrich.md`. Its commands use `<plugin-root>`, which is `${CLAUDE_PLUGIN_ROOT}`.

## Task shape — pinned to what the parser actually reads

`### Task N: <title>`, then the header block, then the Files block, then exactly six body
slots.

Header markers: **Type:** — nothing else; **Files:** is not a marker and ends the header block.

The compiler closes the header block at the first line that is not marker-shaped, so a
marker written below the Files block is not read — it is dropped and surfaced as a
conflict. Keep the marker directly under the heading.

- `**Type:**` — `implementation`, the default and the only Type the Flock runs;
  `plan_check.py` refuses any other. A write-nothing verification is a `Run:` probe or a
  `Check:`, never a task of its own; a deploy goes through the plan's `**Publish:**`
  header (above), and nothing in a run waits on a human.
- `Depends-on` and `Commutes` lines are refused by `plan_check.py` as a `grammar:`
  violation; `plan_parse.py` reads neither. Ordering is derived from
  Interfaces token-matching and Files overlap; same-path overlap is derived from Files.
  A Proof `Run:` whose command names a path in a sibling's Files — and not in the running
  task's own — is derived the same way: the sibling that owns the file goes first, because
  a command cannot run a file nobody has written yet.
  An operator who does not read diffs cannot verify an edge, so no edge is signed.

The Files block carries canonical `Create:` / `Modify:` / `Delete:` bullets, backticked
paths, no globs and no open write sets. It is load-bearing for edge derivation.

That block is the expected footprint of a submission, not a fence. A worker that must go outside
it, that must read a clause otherwise, or that must re-aim a sim declares an amendment: the record
carries it as a `driver:amendment` row and on the pull request card, and Jev reads it as a
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
  caught structurally instead: fences belong in Proof, and `plan_check.py` refuses a
  fence anywhere else. A task-reference
  ordering phrase (`after Task 2`) orders nothing at all.
- **Proof:** the plan's `Run:` probes, citing clauses, and nothing else. The only slot
  where code fences are legal. Its legs — `(a) … (b) …` —
  **each cite the clause they establish, `[M2]`**; nothing mechanical closes an uncited
  clause, a leg citing nothing, or a citation of a clause that does not exist — the gate
  reader names those on the read (see the Gate section below), and `plan_check.py`
  refuses a `Run:` tag naming a clause the Machine line does not number. **A probe
  computes facts and nothing else**: an exit code, a recorded argv, a byte-exact string, a
  count, an ordering of events, agreement with an oracle. A clause, or the part of one, that
  only says what the code says or how it is shaped is Jev's to read against the hunk at
  landing and needs no leg of its own beyond the citation. One case per behaviour, never one
  per variant, synonym or error flavour: an enumerated clause is still one behaviour. A
  universal or negation clause about a computable fact (`no file is written`, `exits 2`)
  still wants the one leg that names what fails or is absent.
  A `Run:` bullet names a command — one of the task's facts — that the builder who claimed
  the task runs on its copy; the task is done only when every one exits 0, so a non-zero
  exit keeps the builder at work on it. A task whose
  deliverable is prose proves itself with `Run:` commands, never with a test that
  matches sentences of a document.
  And one `Run:` names one probe — a command the driver pays once, never a loop over a glob
  of sims (run-87 paid 175 s per boot sim, three passes, for two such lines). A sweep over
  every sim belongs to the one task that owns the sims, as one line, or nowhere.
  A `Run:` whose command ends in a citation tag of the same shape a leg carries —
  `- Run: grep -q 'kata 0.17.2' fleet/CONTRACT.md [M2]`, or `[M1, M3]` — is a *prover*,
  paired with the clause it names: `plan_check.py` strips the tag before the driver runs the
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
  The plan's Global Constraints `Check:` lines are not rehearsed on the laptop, and the Flock
  records no base run of them either — so run a check at BASE yourself before signing, since
  one red before any task lands keeps the whole run from settling green.
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
  `sha-matches: <path>@<sha>` / `issue-open: #NNN` / `issue-closed: #NNN`.
  A free sentence is a `grammar:` refusal from `plan_check.py`; an undecidable staleness
  test is inert prose.

A complete task with every slot filled is in `references/example-task.md`; read it before
drafting your first task.

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

When the operator hands over several issues at once, read `references/authoring-a-queue.md`
and follow it.

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
row's exact key list, went red on the merged tree with both features right (n=2 probes on
1 run, read by hand against the merged head); a Flock builder's copy keeps merging its
peers' published work, so such a leg goes red under its own builder, and the gate's job is
that it is never written.
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
`truncated` flagged when the cap cut. An entry for a path the task's own `Modify:` or
`Delete:` bullet names carries `own` (`modify` or `delete`): its excerpt is the text the
task is about to replace, never a rival pin (#1497). The reader's question gains its second half on that
excerpt: *whether a named file already pins the opposite of a clause, and whether every
section, path or symbol a leg names exists at BASE — or does not exist there at all.* — so "this sim already asserts the task count"
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
`plan_check.py --base`, ending with the explain count, and the launcher carries that line onto the
launch line. The record is telemetry: a field it does not say, or says oddly, prints `-` and never
refuses the plan (#1440). A release reads a run
range with `python3 $UW/authoring_census.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>`,
and its last `totals:` line is what the release notes carry. A missing task, a
stale hash, or a `fail` is a compile refusal. The verdict is an artifact, not
a memory: the compiler refuses a plan whose record is missing or whose hashes are stale,
so an edited Claim or Proof re-dispatches. The gate agent never authors proofs, and the
plan author never chooses which proof a task satisfies.

Dispatch is **per task**, not per round, and every reader runs in the foreground. Dispatch
it with the Agent tool, `subagent_type: "general-purpose"`, `run_in_background: false` —
one call per task, and several such calls may share one message, but none of them is
backgrounded, because a backgrounded reader's verdict is delivered to the session that
spawned the author rather than to the author, who then stops to wait for a message that
never arrives (2026-09-08: of four concurrent authors, three had backgrounded their
readers and had to be resumed by hand with the verdict pasted in, two of them with no
`.gate-verdicts.json` written at all). In the foreground the verdict returns to the author
that dispatched it, as that call's result: the reader answers with its verdict line and one
sentence, and the author records that verdict into `<plan-stem>.gate-verdicts.json` through
Jev's recording command (below), never by hand and never by the reader — the reader sees
only the extractor's output and has no plan path to write beside. A task whose verdict lands first gets its next
reader the moment its Claim or Proof is edited: re-extract that one task with
`extract_gate_input.py`, dispatch one reader for it, and do not wait for the round's
other verdicts to arrive — the verdict is still keyed on the hash, so the edit is what
re-dispatches, and a round boundary buys nothing. Measured 2026-09-04 (n=1 sitting,
9 rounds): the four wide rounds took 13 of the 22 minutes; rounds five through nine were
one or two tasks apiece,
each of them idle behind a barrier it did not need.

Jev reads beside each reader. The author extracts each diet with `--base`, dispatches the
reader on it, and records the reader's verdict on every round — `pass` or `fail`, a
rejection included — with
`bun $UW/../stories/gate_jev.ts <diet> --record <plan-stem>.gate-verdicts.json --agent <verdict> --reason "<the reader's sentence>"`
on the very diet that reader was fed (the laptop's key is `~/.ultrapowers/typesafe.env`).
That one call writes the verdict and Jev's reading of the same diet, clause scores
included. Before signing, the author reads Jev's lowest `caught` clause and treats it as
the leg to strengthen. At the release census, each disagreement between the two readers is
labelled with
`bun $UW/../stories/gate_jev.ts --label <file> --task <id> --round <n> --right agent|jev --because "<run evidence>"`,
and the notes carry both `--agreement` lines from
`bun $UW/../stories/gate_jev.ts --agreement docs/superpowers/plans`
and the `--readings` lines from `bun $UW/../stories/gate_jev.ts --readings docs/superpowers/plans`.
Since #1497 Jev asks `caught_v2` and never reads a base entry the extractor marks `own`
(policy.json `gate_reading`, each cell its own rollback); a reworded question is a new
question, so each reading is counted apart, and a round recorded before then counts as
`caught/read`.

The bar for Jev taking over (operator, 2026-09-30): Jev leads the reading once, across n=5 plans
in which Jev saw the base on every round, there is no labelled disagreement with
`right: agent`; after that the agent reader is kept only as a tie-breaker on a clause Jev
scores low. Until then Jev decides nothing and the agent's verdict is the gate — an
`experiment`, whose rollback is dropping these two paragraphs. The reading that prompted
it: on 2026-09-29, over n=6 plans, Jev disagreed with the agent reader four times once the
rejected rounds were read — Jev right once (a loosened grep), the agent reader right three
times, two of them on facts Jev was never shown.

Then resolve provenance and check:

    python3 $UW/check_provenance.py <plan.md>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/plan_check.py --base <checkout-dir|sha> <plan.md>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/plan_parse.py <plan.md>

`plan_check.py` sits on `plan_parse.py`, the parser the sandbox runs, and refuses only
what a parser cannot see: a gate record that is missing, stale or `fail`, a `Check:` carrying a backtick or naming a path one task owns, a
`Check:` that freezes a pathspec covering a task's own Files, a Stale-if predicate that
already holds at BASE, a `Run:` tag citing a clause the Machine line does not number, a
task without its six slots once each, non-empty and in order, and a code fence outside a
task's Proof. The parser itself refuses a task whose `**Type:**` is not `implementation`. It is not a grammar check — the old
compiler's grammar refusals left with it at cut B (2026-09-21), so read `plan_parse.py`'s
own output for the plan before launching (`proofRuns`, `proofRunClauses`, `checks`,
`dag_edges`): what it prints is what the engine will do.

`check_provenance.py` (needs `gh`) resolves every anchor and string-matches every
`quoted from #NNN` claim against its issue body at signing time. The plan is done when
`plan_check.py` prints `PLAN OK` and those two checks — the proof gate and
`check_provenance.py` — have passed.

`--base` takes a checkout directory or a 40-hex sha, and a sha must be present locally:
the check reads that commit's tree with `git show`/`git ls-tree` in the plan's own
repository, so every read at BASE — which paths exist, whether a Stale-if predicate
holds, which `Run:` lines are already green — resolves against the exact commit
`launch.mjs --base` will hand the run, not against whatever the working tree happens to
hold. Unset, `--base` defaults to the plan's own git toplevel.

A `**Stale-if:**` predicate is read against the same base, and it is the one thing there
that does refuse: a predicate that already holds at that base is a `STALE fact: task <id>:
<entry> holds at BASE` refusal — the task is stale before it is dispatched, so the compile
exits 2 and prints no `PLAN OK`. An issue predicate the laptop cannot read is unreadable,
not false: no `gh` on PATH, a non-zero exit, or an answer that is neither `OPEN` nor
`CLOSED` prints `STALE fact: task <id>: <entry> unreadable at BASE — <reason>` as an
advisory line after the verdict, so an offline laptop still
prints `PLAN OK` and exits 0. Only `plan_check.py --base` asks: a plain compile with no
`--base` evaluates no predicate at all.

The launcher
runs this same compile at `--base` before it pushes anything and prints the same
lines, so a plan that does not compile at the launch base is refused on the laptop
(#865).

The rejection species are listed in `references/authoring-gotchas.md` and read by the
author before a reader is dispatched — nothing prints them.

## Decomposition, the worktree-pure contract, Global Constraints

Read `references/decomposition.md` before splitting the work into tasks and before writing
the Global Constraints block. It holds the worktree-pure contract, the decomposition
judgment and the Global Constraints discipline.

## Execution handoff — analyze, then recommend

Offer three options, parallel first, and do **not** default to the parallel lane. Read
three signals off the plan:

- **T** — the number of `implementation` tasks.
- **parallel width** — are there ≥2 tasks with no edge between them, after treating non-text same-file edits between tasks as dependencies (text overlap merges in the weave)? Compute it from derived edges plus the Files blocks.
- **risk** — a high-stakes surface (auth, payments, migrations, data integrity, public
  API, loops/cursors/pagination/budgets/termination logic), or behavior hard to verify by
  reading.

Since 2026-09-29 the author computes none of these signals:
`python3 $UW/routing.py <plan.md>` prints them, and the branch, on one `ROUTING fact:` line,
and the author reads that line (#1440 moved it out of the launch-time check).

First match wins: risk → Ultrapowers (the **risk override** — every task held to its own probes
and the run to its checks is the value, not speed); parallel width and T≥3 → Ultrapowers; T≤2 → Inline;
else → Subagent-Driven. Show a one-line analysis, then the three options, tagging the
winner **(recommended)**:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: commits the plan and drives it on the
   exe.dev fleet (builders in a sandbox claim tasks from a board and merge each other's
   published work, the plan's probes and checks as the proof, the sandbox opens the PR). Selecting it authorizes execution: the plan is committed and the fleet run
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

Before the execution handoff, read `references/self-review.md` and run every check in it
on the plan.
