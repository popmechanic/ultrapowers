# Authoring gotchas — the lessons the claims-v1 sittings paid for

Load this at self-review, before the gate readers are dispatched, and check the
plan against each rule. Every lesson is a rule with the one-line reason that
makes it a rule and the run or sitting that cost it — a fresh clone, a subagent
author and a stranger operator get the same guidance from this file that the
last sitting got from one agent's memory.

Two of these rules are refused outright: a `Run:`/`Check:` command carrying a
backtick is `command carries a backtick` from `plan_check.py`, and a `Check:` that
freezes a path covering a task's own Files or `Test:` path is refused the same way
(below). Every other species below is the author's own to check, here, against this
file — `suite-total-pin`, `directory-absence-pin` and, since the compiler left at cut B
(2026-09-21), the `one Run, one exam` sweep included. Nothing prints them.

## The rows

- **A zero-count grep over a source file counts its comments too.** A `Run:` that pins
  `grep -c <symbol> <file>` = 0 goes red the moment the implementer deletes the code and
  leaves the comment that named it — three of four tasks on run-127 (2026-09-14) took a fix
  round on exactly that, where run-126's Task 2 had listed the 14 comment carriers of
  `serialize` in Context and took none. Before dispatch, `grep -n` the literal across the
  task's Files and put the comment carriers in Context, or pin the definition (`^def x`,
  `^export const x`) instead of the bare word.

- **Every wave leaves the folded tree green.** A wave-1 producer that deletes or
  renames a symbol whose consumers are a wave-2 rewrite turns the wave-1 folded
  suite red by construction — the old consumers still import the old name — and
  a doc↔code pin (doctor `ROW_IDS` ↔ `first-run.md` headings) split across
  waves does the same; the engine gates every wave's folded tree with the full
  suite, so "the consumer rewrites it next wave" is not a plan. Keep the old
  export as a shim in the producer's task, or put the consumers in the
  producer's wave and let same-file text fold; keep both halves of any pin in
  one wave (run-72, 2026-09-04).
- **No backticks inside a `Run:` command.** The compiler strips only a
  whole-value backtick wrapper; an inner backtick reaches `bash -lc` as a
  command substitution and the proof exits 127, and the fix loop cannot repair a
  proof it does not own, so the task dies `fix-loop-exhausted` with a correct
  patch. Grep for the word, never for the backticked literal. Since 0.3.10 the
  compiler refuses it outright with `command carries a backtick` (run-74,
  2026-09-04).
- **The gate readers never see Context, so read every ordered Machine clause
  against every measured fact in the same task's Context before dispatching
  readers.** A clause that started a status server before waiting for the user
  bus — the exact race the Context had measured — passed nine rounds and was
  caught as `plan-defect` by both referees; a clause that orders a `--user` call
  names the bus precondition (run-75, 2026-09-04).
- **The gate's recurring rejection species, each with its fix** (19 of 33
  dispatches on 2026-09-04, 18 of 25 on 2026-09-05, every rejection correct): an
  enumerated clause ("X, Y and Z are gone") needs one leg per row — a
  count-and-pass pin lets one row survive; a universal sentence ("no file under
  tests/…") with a per-file exam is rejected — sweep the whole tree using
  named exclusions, or narrow the derived Claim to the files the task owns; `node
  sim.mjs` exiting 0 is not the sentinel — pipe it into
  `grep -q 'ALL TESTS PASSED'`; "finishes quickly" needs a clock
  (`timeout 60 node …`); a timing threshold wants both sides, with durations
  that separate sum from max; pin a decorator to its def
  (`grep -B3 'def x' | grep -q 'scope="session"'`), never with a bare presence
  grep; an enumerated value list (`low|medium|high`) needs one leg per value —
  write the leg as "for each of …"; a whole-file `grep -q` for a doc sentence is
  rejected every time — scope it with
  `sed -n '/^## A/,/^## B/p' … | tr '\n' ' ' | grep -q 'part one.*part two'` and
  pin the sentence's operative halves in order; a clause with two triggers needs
  a leg per trigger; "no reply" and BLOCKED are two rows; two independent
  conditions (path AND phrase) need a negative row for each — a row lacking both
  falsifies neither; a rule that would fire on an existing fixture is a plan
  defect, so read the sibling fixture before writing the clause; and `leg (e)`
  written inside another leg's prose splits the leg even when (e) is another
  file's leg — say "the previous leg" or "its frozen-sha comparison"; a
  negation or absence clause ("the enumerable keys are still exactly three",
  "none of these four words appear") is always a computable fact and always
  needs a leg of its own, because the diff shows nothing for what is not
  there — run-192 (n=1 run, 8 tasks, 2026-09-18) scored two such clauses 0.19
  and 0.40 by Jev where both exams passed. Nothing
  prints this list: read it here, row by row, before a reader is dispatched.
- **Absolute collected-count pins are integration-hostile.**
  `test "$(pytest --collect-only -q | tail -1 | cut -d' ' -f1)" = 1461` passes
  in the task's clone and fails on the adopted tree, where every merged `Run:`
  is re-run and every sibling's deletions have folded in — five blocking
  findings on a correct tree. Pin per-file counts
  (`--collect-only -q <file> | grep -c ::`) or state the delta, never the suite
  total. Likewise `test ! -e tests/<dir>` fails on a `__pycache__` survivor in
  the integration clone — pin the source files. The compiler names both:
  `suite-total-pin` and `directory-absence-pin` (run-4, 2026-09-04).
- **Every file a task can foresee touching is in its own Files,
  even a sibling's one-liner.** A compelled edit outside Files was ruled lawful
  in review round 1, reverted by the fix round told to "resolve every blocking
  issue", blocked in round 2, and the task died `fix-loop-exhausted`; same-file
  text folds, so listing the file costs nothing. A file the author could not
  foresee is no longer that death: it is a declared amendment the reviewer
  judges on its merits and never reverts, the rule since #990 — so the listing
  is foresight, not a fence (run-2, 2026-09-04). That foresight never becomes
  an authored ordering: the engine reads every overlapping or consuming pair
  itself, so a chain added only to keep two same-file edits apart is a defect,
  not caution — on run-193 the author chained the engine task behind the
  hunk-picker task to keep two import inserts out of the resolver, and the
  consumer waited on a producer it needed nothing from, about nine minutes of
  clock lost (n=1 run, 2026-09-18).
- **Never a process or authorship sentence in the plan-level Claim.** "Every
  task's exam was written by a peer before the implementer started" parked an
  otherwise clean run as `deferred:external`: the critic reads the tree, and no
  tree shows authorship order — that fact lives in the run record. The Claim is
  do:/see: about the product; the process is the engine's to record (walk run-3,
  2026-09-04).
- **A behaviour change owns every existing pin of it.** Before dispatch,
  `git grep` the literal a clause replaces across `tests/` and `fleet/tests/`
  and list every hit in the task's Files — an unlisted pin of the old value was
  run-8's one blocking finding. A sibling of the same species: a clause can
  contradict a frozen sim the plan also names as a `Run:` — both cannot pass, so
  read every sim a Proof invokes for the shape it pins before writing a
  rendering clause (run-8, 2026-09-04).
- **Check every field name a Context names against the report format.** A
  Context that wrote `report.review.findings` for what is
  `completenessFindings` made the examiner mark the leg unsatisfiable and adapt
  (run-10, 2026-09-05).
- **Two concurrent runs on disjoint Files can conflict on a seam.** One run's
  new test drove the other's changed label routing, and only CI on the merge
  commit caught it; run the fleet bridge on `merge(main, branch)` before arming
  the second auto-merge (2026-09-05).
- **Expect and budget for rejection rounds — a zero-streak indicts the gate, not
  the plan.** A whitespace edit to a Claim or a Proof changes the hash and
  re-dispatches, even a line-wrap fix, so re-dispatch per task as verdicts land
  rather than per round. And the provenance quote is trusted to no eyeball
  check: a `quoted from #NNN` claim is a verbatim substring of the raw issue
  body, markdown asterisks and backticks included (run-45, 2026-09-01).
- **A `Run:` grep inside a guarded exam pins another file's wording, and
  wording folds.** On run-13, `set-filter.test.ts` leg (g) grepped
  `lint-cli.test.ts` for the literal `toContain('setFilter')`, and run-12's
  publish fold had already merged that file semantically, so the literal was
  gone. A guarded exam asserts behaviour through imports and calls; a text
  pin on a sibling file belongs in a `Run:` line of the plan, and
  never in the merged exam (run-13 and run-12, popmechanic/tinyapp-fixture,
  2026-09-15; #1019).
- **A `Run:` that names two exams at once is a sweep; do not write one.** A Proof
  `Run:` naming two or more paths under `tests/state-exams/` — or the bare
  `tests/state-exams` directory, which names all of them — was the old compiler's
  `one Run, one exam` refusal; nothing refuses it now. The reading behind it: 19
  of 29 fixture exam files spawned a runner over their neighbours, one leg took
  573 s, and the fold suite grew from 2.4 to 19 minutes over four fixture runs
  ending at run-24. One claim, one prover; regression is the fold's one suite
  run per merge, so a sweep the operator wants is written once in the owning
  task's own `Run:` (a `Check:` line is not read by this rule).
- **A `Run:`/`Check:` line writes only to stdout.** `tee /dev/stderr` — and any
  write to `/dev/stderr` or `/dev/tty` — is refused under the sandbox's
  service shell (`tee: /dev/stderr: Permission denied`), so the proof exits
  non-zero on plumbing with the claim already proven. The driver captures the
  command's stdout and stderr already (the last 4,000 characters ride the
  reviewer's evidence), so a line that wants its output on the record lets the
  driver keep it and never duplicates it; and a proof line's exit comes from
  the command that proves the claim, not from plumbing (fixture run-25,
  popmechanic/tinyapp-fixture, 2026-09-17).
- **A fake that stands in for a client a sibling feature also calls
  over-counts the moment the sibling lands.** Give the fake per-exam shape
  recognition so it records only the states with this exam's own shape
  (`note`, `amendment`) and answers null to the rest, never an exact call
  count on a fake shared across features — run-183's
  `test_run_engine_worker_notes.mjs` pinned "exactly three asks" on the one
  `jev.ask` fake, run-182's tier rows asked the same client at every dispatch
  and review, the count read 7 where the exam pinned 3, and the publish fold
  went red on a correct tree; the amendments exam had the same leg, 4 ≠ 2
  (run-183, PR #1111, hand fold `f3c69320`).

- **A `Check:` red at BASE is a red no task of the plan owns, unless one
  task's Files hold the offender.** A run-wide `Check:` is paid by every task
  on every pass; one already failing before any work is done costs repair
  attempts that can change nothing, because no task caused it and no task can
  turn it green. The sandbox runs every `Check:` once at base before the
  first dispatch and records it as a `check:line` row carrying `base: true`
  (#1195), so the author's defence before launch is to run the command by
  hand in an installed checkout. A fixture `Check:` copied verbatim from
  `greenfield-stack.md` exited 1 at BASE on a file no task owned, turned both
  fold checks red, and bought two repair attempts that could change nothing
  (fixture run-36, popmechanic/tinyapp-fixture, 2026-09-21; #1173).

- **A `Check:` that freezes a path must not cover any task's own Files or `Test:` path.**
  A run-wide `git diff --quiet $ULTRA_BASE -- <paths>` is green at BASE by construction: it
  goes red the moment a task's own patch lands under a frozen path — and on the factory an
  exam file rides the patch into the folded tree even when it is unguarded and stripped at
  publish. `plan_check.py` refuses such a plan outright — one line naming the check, the
  pathspec, the task and the path, exit 2 (#1202) — so freeze files, not the directory they
  sit in. Run-199 froze `fleet/` while its one task's exam was
  `fleet/tests/test_factory_select_dirs.mjs`: the check exited 1 on both fold passes, the
  repair could change nothing, and a task adopted green parked as `done: false` with a draft
  pull request (n=1 run, 2026-09-21) — the gate fix of #1172 working exactly as designed on a
  plan defect.

- **An exam of a record other tasks also write must assert that the record carries these keys,
  never that it has exactly these keys.** A whole-row deep-equal is lawful only over
  a row the exam's own fake received from the one function under test — never over a row
  read back from a shared log or a shared JSON file that another task's own leg also
  writes. On run-195 (2026-09-18) one task added `ts` to every row of the run's event log
  and the exams of two sibling tasks, each asserting a row's exact key list, went red on
  the folded tree with both features right; the gate now refuses such a leg before
  dispatch.

- **An end-to-end exam cannot pass in a lone clone at BASE when it drives a sibling's
  region, and its stub must be able to answer.** A task whose exam boots the whole
  system exercises every sibling's lines, so an assertion that only a sibling's edit
  satisfies is red in that task's own clone whatever the task does — the author's
  "passes at BASE" assumption is the thing to check, clause by clause, against the Files
  of every sibling. Either the clause names only what this task's Files can change, or
  the exam is one only the fold runs. And a rig that starts its subject with `spawnSync`
  beside an in-process `http.createServer` stub deadlocks on itself: the stub never
  answers while the loop is blocked, the child aborts, and the leg reads the fallback
  value as a defect. On run-215 (2026-09-22) task 3 paid both at once — two implementers
  and a re-dispatch, 90 worker-minutes, every one red on a `ts` a sibling wrote and on a
  preflight stub that could not reply — where task 2's examiner had hit the same rig bug
  in its own draft and fixed it with an async `spawn`. The retry (#1225) fixed the exam,
  not the boot.

## Three older lessons of the same kind

- **Quote desired-state sentences, never diagnosis sentences.** An issue's
  "today X happens" taken as the Claim is rendered false by a passing exam; the
  skill's elicitation section says so, and the instinct to quote the vivid line
  is strong (run-45, 2026-09-01).
- **The exam's quantifier matches the claim's.** "Some swallows stay" needs an
  exam asserting at least one survives, and an exam broader than the claim — any
  `raise` where the claim names `FailedLookup` — fails the same way; loosen the
  claim or tighten the exam, deliberately (run-45, 2026-09-01).
- **Two plan-defect species of run-45 recur:** an exam/Files enumeration
  mismatch, where a glob exam quantifies over a directory the Files block
  under-enumerates, and a contract that assumes a consumed function's behaviour
  — raising where it only advises — so read the consumed symbol before writing
  the clause that depends on it (run-45, 2026-09-01).
