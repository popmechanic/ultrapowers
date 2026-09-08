# Authoring gotchas — the lessons the claims-v1 sittings paid for

Load this at self-review, before the gate readers are dispatched, and check the
plan against each rule. Every lesson is a rule with the one-line reason that
makes it a rule and the run or sitting that cost it — a fresh clone, a subagent
author and a stranger operator get the same guidance from this file that the
last sitting got from one agent's memory.

Where a rule is already enforced mechanically, the bullet names the compiler's
own line, so the reading to learn is the compiler's output and not this file:
`suite-total-pin` and `directory-absence-pin` are `ADVISORY proof-species:`
lines from `compile_plan.py --check`, and a `Run:`/`Check:` command carrying a
backtick is the grammar refusal `command carries a backtick`. Run the checker
and read its advisories before a reader is dispatched.

## The eleven rows

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
  file's leg — say "the previous leg" or "its frozen-sha comparison". The
  compiler names the mechanical half of these as `ADVISORY proof-species:`
  lines; read them before a reader is dispatched.
- **Absolute collected-count pins are integration-hostile.**
  `test "$(pytest --collect-only -q | tail -1 | cut -d' ' -f1)" = 1461` passes
  in the task's clone and fails on the adopted tree, where every merged `Run:`
  is re-run and every sibling's deletions have folded in — five blocking
  findings on a correct tree. Pin per-file counts
  (`--collect-only -q <file> | grep -c ::`) or state the delta, never the suite
  total. Likewise `test ! -e tests/<dir>` fails on a `__pycache__` survivor in
  the integration clone — pin the source files. The compiler names both:
  `suite-total-pin` and `directory-absence-pin` (run-4, 2026-09-04).
- **Every file a task must touch is in its own Files, even a sibling's
  one-liner.** A compelled edit outside Files was ruled lawful in review round
  1, reverted by the fix round told to "resolve every blocking issue", blocked
  in round 2, and the task died `fix-loop-exhausted`; same-file text folds, so
  listing the file costs nothing (run-2, 2026-09-04).
- **Never a process or authorship sentence in the plan-level Claim.** "Every
  task's exam was written by a peer before the implementer started" parked an
  otherwise clean run as `deferred:external`: the critic reads the tree, and no
  tree shows authorship order — that fact lives in the run record. The Claim is
  do:/see: about the product; the process is the engine's to record (walk run-3,
  2026-09-04).
- **A behaviour change owns every existing pin of it.** Before dispatch,
  `git grep` the literal a clause replaces across `tests/` and `fleet/tests/`
  and list every hit in the task's Files — an unlisted pin of the old value was
  run-8's one blocking finding. Two siblings of the same species: a clause can
  contradict a frozen sim the plan also names as a `Run:` (both cannot pass, so
  read every sim a Proof invokes for the shape it pins before writing a
  rendering clause), and the corpus byte-pins freeze advisory text, not only the
  vocabulary, so a reworded advisory line needs its frozen sha re-pinned outside
  the compiler task's Files (run-8, 2026-09-04).
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
