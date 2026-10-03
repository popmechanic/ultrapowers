<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. Commands here name the
     plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

## Self-review

The author reads `references/authoring-gotchas.md` — the lessons every claims-v1 sitting
since run-45 paid for, each a rule with its reason — before the gate readers are
dispatched, and checks the plan against each of them. They are the author's own to
check — nothing prints them.

`plan_check.py` refuses two shape slips outright, so this list leaves them out: the six
slots each once, non-empty and in order, and a fence only in Proof. Three wording rules are
the author's alone (the checker stopped refusing them, #1440): the `**Summary:**` is exactly
three sentences; `**Closes:**` sits directly under the `**Goal:**` paragraph; and a dated
reading in a Context or the Summary carries its `n=`.

- No task carries checkbox steps.
- The plan carries one `**Claim:**` above the first task, elicited or quoted from an
  issue. Every task Claim is either the operator's words with a provenance tag or
  `(derived)` under the plan-level Claim, paired with a machine restatement at the same
  layer, and its gate verdict is recorded and fresh.
- The plan's `**Summary:**` is in the operator's register — what this is, why it exists,
  how it benefits them.
- Every Stale-if entry is a predicate; every Proof `Run:` prover ends in the tag of a
  clause the Machine line numbers, and no test-file or guard bullet is written.
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
- The `**Closes:**` line, when present, names only the target repository's issues.
- No pinned number is a guess: every pinned literal was computed, not assumed — the author
  ran the command or did the arithmetic at BASE and pasted back what it printed, rather
  than the figure the sentence wanted to be true.
- Every reading a plan's Context or Summary cites carries `n=… (window)` — `n=9 merged
  runs (131–140)`, never a bare count — and a plan whose default flip rests on a reading
  under the floor says `experiment` in its Summary and names its `rollback` there; the
  floor is `CLAUDE.md`'s `Test doctrine` bullet (n = 5 runs, 20 tasks for a per-task
  reading).
