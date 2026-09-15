# n on every row — every reading the doctrine and the authoring skill rest on carries its count and its window, no default flips under five runs, and a release's census line says which runs it read

**Grammar:** claims-v1

**Claim:** After this run, every number the project's rules lean on tells me how many runs it was read over and which ones, so I can see a thin reading before I trust it — and nothing flips a default on fewer than five runs without calling itself an experiment and naming its way back. (elicited)
**Summary:** This puts a weight on every number the project quotes as a reason: how many runs it was read over, and which. It exists because the record honoured "measured, never narrated" while the counts underneath were often two runs or one replay, and one default had already flipped on the one reading with a real n. After this run the project's own instructions state the floor — n on every row, no default flips under five runs or twenty tasks, a flip under that is an experiment with its rollback — every reading in the doctrine and the plan-writing skill carries its n and window, and the release census's last line names the runs it read.

**Goal:** #994's 2026-09-15 decision, written into the tree: `CLAUDE.md`'s test-doctrine bullet carries the floor (`n=… (window)` on every reading row; no default flips under n = 5 runs, or 20 tasks for a per-task reading; a flip under the floor is an experiment on its map and carries its rollback; a fact read once is dated, not counted) and names the three readings the decision applied to; the two doctrine readings in `CLAUDE.md` (the fold A/B, the parallel-runs drain and the resolver's record) and the five readings in `skills/ultrawrite/SKILL.md` plus the one-reviewer row of `skills/ultrapowers/references/report-format.md` each carry `n=… (window)`; ultrawrite's self-review tells an author to write a reading into a plan the same way and to call a thin-reading flip an experiment; and `authoring_census.py`'s `totals:` line carries `runs=<A>..<B>`. The four maps that own the readings (#870, #872, #732, #810) are GitHub issues a sandbox cannot write, so their comments are a `manual` task carrying the exact text.
**Closes:** #994

**Tech Stack:** Markdown (`CLAUDE.md`, `skills/ultrawrite/SKILL.md`, `skills/ultrapowers/references/report-format.md`); Python 3 stdlib scripts under `skills/` (pytest is the suite, `python3 -m pytest`).

**Spec:** #994 (the observation, the three questions) and its 2026-09-15 decision comment; maps #870, #872, #732, #810 for the readings they own. Every fact a worker needs is in its task's Context.

**Parallelization rationale:** one wave, width 3: the three implementation tasks touch disjoint files — `CLAUDE.md`; the skill and the report reference; the census script and its test — and share one literal (the floor sentence, in every Context) and no runtime behaviour, so no chain. Task 4 is `manual` and does not wave: the map comments are posted by hand after the merge.

## Global Constraints

- The floor is one literal in every task's Context and every document states it the same way: every reading row carries `n=… (window)`; no default flips under n = 5 runs (20 tasks for a per-task reading); a flip taken under the floor is an experiment on its map and carries its rollback; a fact read once (a kata seam, a trap) carries its date, not an n.
- No number is invented: every `n=` written names a count and a window the task's Context supplies, and no existing count, date or issue number is deleted — a row gains its n beside what it already said.
- No engine, boot, worker, role, kernel, contract or runbook changes; the fleet's vendor facts are dated facts, not readings, and gain no `n=`.
- Check: git diff --quiet $ULTRA_BASE -- fleet skills/ultrapowers/kernel
- The catch-counter pair already carries n on every row (`touching runs` per test, `Zero catches over N runs`) and is untouched.
- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/catch_report.py skills/ultrapowers/scripts/catch_counter.py

### Task 1: CLAUDE.md states the floor, and the two readings the doctrine rests on carry their n

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `CLAUDE.md`

**Claim:** When I read the project's own instructions, the test-doctrine bullet states the floor — every reading carries its n and window, no default flips under five runs or twenty tasks, a flip under that is an experiment with its rollback — and names the three readings the decision was applied to, and the two readings the doctrine already leans on each say how many runs they were read over. (derived)
Machine: M1. The `**Test doctrine` bullet of `CLAUDE.md` — from the line beginning `- **Test doctrine` to the `## Working with the operator` heading — says, in this order, that every reading row carries `n=` with its `window`, that no default flips under `n = 5 runs` (`20 tasks` for a per-task reading), that a flip taken under the floor is an `experiment` on its map and carries its `rollback`, and that a fact read once carries its `date` and no n; and it cites `#994`.
M2. That same bullet names the three readings the decision applied, in this order: `#872`'s escapes reading at `n=9`, the fold rule `#1006` as an `experiment` until five, and one reviewer `#974` flipped on `n=71` and standing.
M3. The `**One merge, one writer.**` bullet's fold sentence carries `n=1 fixture` beside `0.640×`, and the 2026-08-30 re-read `0.594×` with `n=12 cells` naming `evals/results/2026-08-30-one-driver-fold-ab.md`.
M4. The `**Run in parallel` bullet carries `n=4 pairs` beside the 8-wide drain's reading and `n=6 dispatches` beside the resolver's record, and its strings `four kernel-seen pairs` and `6 dispatches, 2 misses, both caught` are still present.

**Authorized-by:** #994's 2026-09-15 decision comment ("n on every row, and no default flips under n = 5 runs … written … in CLAUDE.md's test-doctrine bullet"); `CLAUDE.md` §Doctrine "Test doctrine (operator, 2026-09-09)".

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The floor, one literal shared by every task of this plan: every reading row carries `n=… (window)`; no default flips under n = 5 runs (20 tasks for a per-task reading); a flip taken under the floor is an experiment on its map and carries its rollback; a fact read once (a kata seam, a trap) carries its date, not an n. The three applied readings, from the same comment: #872's escapes reading is n=9 merged runs (131–140) and over the floor; the fold rule (#1006, run-141 in flight at the decision) is one replay and stays an experiment until five, its rollback `foldAgeMs=0` (a fold at every landing); one reviewer (#974) was flipped on n=71 runs and stands. At BASE `CLAUDE.md` is 3083 words, carries no `n=` at all, and the three bullets this task edits are these, each rewritten in place rather than hunted for. (1) Lines 168–173, the bullet to extend: "- **Test doctrine (operator, 2026-09-09).** The implementer never does TDD: it iterates against the suite and writes no test of its own. The peer exam plus driver-run probes are the proof, and the target's suite is a *reported sensor* with attribution, measured and never asserted on a narrative. Deletion is owed per file, on the reading: a test file that has never caught anything goes, and `skills/ultrapowers/scripts/catch_counter.py` is what turns that reading into the deletion. Ballast goes behind a measurement gate, never on an incident narrative." — every sentence of it stays, and the floor and the three applied readings are added after the last sentence, dated `(operator, 2026-09-15, #994)`, in the order M1 and M2 pin: n and window, the 5-run / 20-task floor, experiment and rollback, the dated fact, then #872 n=9, #1006 experiment, #974 n=71. (2) Lines 151–153, inside the `**One merge, one writer.**` bullet: "`compile_plan.py` has defaulted to `overlap=fold` since the 2026-08-14 A/B (0.640× wall), so same-file concurrent writes are the shipped default" — the 2026-08-14 reading was one fixture (`contend-prod`; `evals/results/runs.jsonl` holds that day's nine cells, eight serialize and one fold), and the 2026-08-30 re-run in `evals/results/2026-08-30-one-driver-fold-ab.md` read 0.594× aggregate wall over twelve cells across six fixtures on the 0.3.0 engine, which that file itself calls a different measurement rather than a regression; so the parenthesis becomes "(0.640× wall, n=1 fixture; re-read 2026-08-30 at 0.594× over n=12 cells, 6 fixtures, `evals/results/2026-08-30-one-driver-fold-ab.md`)" and the rest of the sentence stays. (3) Lines 134–145, the `**Run in parallel; same-file overlap folds at publish**` bullet, two rows: "read on the 8-wide drain of 2026-09-08 — four kernel-seen pairs all folded green with zero conflicts" gains "(n=4 pairs, 8 runs, 2026-09-08)" after "zero conflicts", and "both 2026-09-07 — 6 dispatches, 2 misses, both caught" gains "(n=6 dispatches, runs 36 and 44)" after "both caught"; the decision that retired the earlier rule was read on eight runs, over the floor, and stands as written. The `**Every choice is an AskUserQuestion**` bullet's `pick rate` is read per release from the census's `recommended_picked=p/q`, which is its own n, and changes nothing here; the `## Layout` section, which `fleet/tests/test_launch_compile_facts.mjs` reads for `compile_plan.py --check --base` followed by `STALE fact:`, is untouched; no sim or test pins any sentence of the three bullets at BASE (`git grep` of `0.640`, `four kernel-seen pairs`, `6 dispatches`, `measured and never asserted` across `tests/` and `fleet/tests/` finds nothing). This is prose; the `Run:` lines are its proof, each sed range scoped by the bullet's opening line and the next bullet's, joined with spaces.

**Proof:**
- Run: sed -n '/^- \*\*Test doctrine/,/^## Working with the operator/p' CLAUDE.md | tr '\n' ' ' | grep -q 'n=.*window.*n = 5 runs.*20 tasks.*experiment.*rollback.*date.*#994'
- Run: sed -n '/^- \*\*Test doctrine/,/^## Working with the operator/p' CLAUDE.md | tr '\n' ' ' | grep -q '#872.*n=9.*#1006.*experiment.*#974.*n=71'
- Run: sed -n '/^- \*\*Test doctrine/,/^## Working with the operator/p' CLAUDE.md | tr '\n' ' ' | grep -q 'never does TDD.*reported sensor.*measured and never asserted.*catch_counter.py.*measurement gate'
- Run: sed -n '/^- \*\*One merge, one writer/,/^- \*\*Handoffs are opt-in/p' CLAUDE.md | tr '\n' ' ' | grep -q 'overlap=fold.*0.640.*n=1 fixture.*0.594.*n=12 cells.*evals/results/2026-08-30-one-driver-fold-ab.md'
- Run: sed -n '/^- \*\*Run in parallel/,/^- \*\*One merge, one writer/p' CLAUDE.md | tr '\n' ' ' | grep -q 'four kernel-seen pairs.*n=4 pairs.*6 dispatches, 2 misses, both caught.*n=6 dispatches'
- Run: wc -w CLAUDE.md
- Legs: (a) [M1] the first `Run:` line reads the test-doctrine bullet and matches `n=`, `window`, `n = 5 runs`, `20 tasks`, `experiment`, `rollback`, `date` and `#994` in that order; (b) [M2] the second `Run:` line reads the same bullet and matches `#872` then `n=9`, `#1006` then `experiment`, `#974` then `n=71`, in that order; (c) [M1] the third `Run:` line pins that the bullet's five existing operative phrases survive in their original order, so the floor was added and nothing rewritten away; (d) [M3] the fourth `Run:` line reads the one-merge bullet and matches `overlap=fold`, `0.640`, `n=1 fixture`, `0.594`, `n=12 cells` and the evals file's path in that order; (e) [M4] the fifth `Run:` line reads the parallel-runs bullet and matches `four kernel-seen pairs` then `n=4 pairs`, and `6 dispatches, 2 misses, both caught` then `n=6 dispatches`, in that order — the old strings present and each followed by its n; (f) [M1] the sixth `Run:` line reports the file's size, a reported sensor gating nothing.

**Stale-if:**
- issue-closed: #994
- path-absent: `CLAUDE.md`

### Task 2: Every reading the authoring skill cites carries its n and window, and self-review says a plan writes readings the same way

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`

**Claim:** When an author reads the plan-writing skill, every number it gives as a reason says how many runs it was read over and which, the self-review tells the author to write a reading into a plan the same way and to call a thin-reading flip an experiment with its rollback, and the report reference's one-reviewer row carries the same n. (derived)
Machine: M1. In `skills/ultrawrite/SKILL.md`, the `**Review:**` bullet of §Task shape (the range from `## Task shape` to `## Elicit the claim`) carries `n=71 runs` after `8 marginal findings`, with the window `through 2026-09-13` and `#964`.
M2. §Authoring a queue (from `## Authoring a queue` to `## The proof gate`) carries `n=3 runs` beside its `clock census`, with the window `runs 10–12` and `2026-09-05`.
M3. §The proof gate (from `## The proof gate` to `## The worktree-pure contract`) carries `n=1 sitting` and `9 rounds` beside `Measured 2026-09-04`, before `13 of the 22 minutes`.
M4. §Decomposition judgment (from `## Decomposition judgment` to `## Global Constraints discipline`) carries `n=2 runs` beside `Measured 2026-09-02` before `#541`, and `n=1 drain of 3 runs` beside `0.26×` with `#454` and `2026-09-01`.
M5. §Self-review (from `## Self-review` to the end of the file) carries one bullet saying that every reading a plan's Context or Summary cites carries `n=… (window)`, that a plan whose default flip rests on a reading under the floor says `experiment` in its Summary and names its `rollback`, and that the floor is `CLAUDE.md`'s `Test doctrine` bullet.
M6. In `skills/ultrapowers/references/report-format.md`, the `reviewEconomy` row carries `n=71 runs` and `through 2026-09-13` after `eight marginal findings`.
M7. No reading is deleted: each of `8 marginal findings`, `10–12`, `13 of the 22 minutes`, `79 min`, `49.5 min` and `0.26×` still occurs in `skills/ultrawrite/SKILL.md`, and `eight marginal findings across 71 runs` still occurs in `report-format.md`.

**Authorized-by:** #994's 2026-09-15 decision comment ("every reading row carries `n=… (window)`; a flip taken under n is called an experiment on its map and carries its rollback"); `skills/ultrawrite/SKILL.md` §Self-review; CLAUDE.md §Doctrine "Test doctrine".

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The floor, one literal shared by every task of this plan: every reading row carries `n=… (window)`; no default flips under n = 5 runs (20 tasks for a per-task reading); a flip taken under the floor is an experiment on its map and carries its rollback; a fact read once (a kata seam, a trap) carries its date, not an n. At BASE `skills/ultrawrite/SKILL.md` is 5576 words and carries no `n=`; its section headings, in file order, are `## The document` (line 18), `## Task shape — pinned to what the parser actually reads` (52), `## Elicit the claim — drafted, then confirmed` (187), `## Authoring a queue` (228), `## The proof gate — before any compile` (245), `## The worktree-pure contract` (352), `## Decomposition judgment` (380), `## Global Constraints discipline` (420), `## Execution handoff — analyze, then recommend` (446), `## Self-review` (478). The five sentences to rewrite in place, with their n and window from the record: (1) lines 66–68, "the pair `peer` used to buy is gone on its reading (8 marginal findings in 71 runs)" — the reading is the review reading of 2026-09-13 (#964 Task 2: 22 blocking findings in 12 of 71 runs, the second reviewer's 8 marginal findings none of the five real defects), so the parenthesis becomes "(8 marginal findings, n=71 runs through 2026-09-13, #964)"; (2) lines 241–243, "The 2026-09-05 clock census of runs 10–12 found authoring throughput, not the sandbox, was the first bound on how many runs could be live at once" — gains "(n=3 runs, runs 10–12, 2026-09-05)" after "clock census"; (3) lines 304–306, "Measured 2026-09-04: the four wide rounds took 13 of the 22 minutes; rounds five through nine were one or two tasks apiece" — becomes "Measured 2026-09-04 (n=1 sitting, 9 rounds): the four wide rounds took 13 of the 22 minutes; …", one sitting's gate rounds being what was read; (4) lines 396–398, "Measured 2026-09-02: the same tool built as a two-task chain took 79 min with one fix round; as nine contracts, seven wide, it took 49.5 min with none (#541)" — becomes "Measured 2026-09-02 (n=2 runs, one pair): …" with "(#541)" kept at the end; (5) line 415, "(N=3 drains measured 0.26× batch)" — the reading is #454's scenario-2 launch shape, three concurrent `driveOne` runs of one plan measured on 2026-09-01 at 0.26× of the batch wall with zero 429s (recorded in the 2026-09-01 #511 decision), so it becomes "(0.26× batch wall, n=1 drain of 3 runs, #454, 2026-09-01)" — one drain, not three, is what was measured, and the sentence's "N=3" was the drain's width. The new self-review bullet is one `- ` bullet at the end of §Self-review, after the "No pinned number is a guess" bullet: every reading a plan's Context or Summary cites carries `n=… (window)` — `n=9 merged runs (131–140)`, never a bare count — and a plan whose default flip rests on a reading under the floor says `experiment` in its Summary and names its rollback there; the floor is `CLAUDE.md`'s `Test doctrine` bullet (n = 5 runs, 20 tasks for a per-task reading). In `skills/ultrapowers/references/report-format.md` the `reviewEconomy` row is one table line (line 105 at BASE, beginning "| `reviewEconomy` | no |") whose parenthesis "(#964 Task 2: eight marginal findings across 71 runs, none of them one of the five real defects)" becomes "(#964 Task 2: eight marginal findings across 71 runs, n=71 runs through 2026-09-13, none of them one of the five real defects)" — a table row stays one line. Two pins live in sections this task edits and both stay: `tests/test_compile_plan_edges.py` (lines 786–791) reads §The proof gate for its sentence that a Stale-if predicate holding at the base is a `STALE fact:` refusal and an unreadable issue predicate an advisory line — add beside it, delete nothing there — and `tests/test_review_peer.py` reads the skill for the `**Review:**` marker's shape, not the reading; no test at BASE pins `71 runs`, `0.26`, `79 min`, `13 of the 22` or `clock census`; the clock-census sentence wraps between `runs` and `10–12` at BASE, which is why the preservation loop greps `10–12` alone and the ordered pattern reads the section with newlines joined (`git grep` across `tests/` and `fleet/tests/` finds none). `references/authoring-gotchas.md` is untouched: its rows already carry their counts and dates (`19 of 33 dispatches on 2026-09-04, 18 of 25 on 2026-09-05`). This is prose; the `Run:` lines are its proof, each sed range scoped by two headings and joined with spaces.

**Proof:**
- Run: sed -n '/^## Task shape/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q '8 marginal findings.*n=71 runs.*through 2026-09-13.*#964'
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'clock census.*n=3 runs.*runs 10–12.*2026-09-05'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Measured 2026-09-04.*n=1 sitting.*9 rounds.*13 of the 22 minutes'
- Run: sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Measured 2026-09-02.*n=2 runs.*79 min.*49.5 min.*#541'
- Run: sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q '0.26×.*n=1 drain of 3 runs.*#454.*2026-09-01'
- Run: sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'n=.*window.*experiment.*Summary.*rollback.*CLAUDE.md.*Test doctrine'
- Run: grep 'reviewEconomy' skills/ultrapowers/references/report-format.md | grep -q 'eight marginal findings across 71 runs.*n=71 runs.*through 2026-09-13'
- Run: for s in '8 marginal findings' '10–12' '13 of the 22 minutes' '79 min' '49.5 min' '0.26×'; do grep -q -F -- "$s" skills/ultrawrite/SKILL.md || { echo "lost $s"; exit 1; }; done
- Run: test "$(grep -c 'eight marginal findings across 71 runs' skills/ultrapowers/references/report-format.md)" = 1
- Run: wc -w skills/ultrawrite/SKILL.md
- Legs: (a) [M1] the first `Run:` line reads §Task shape and matches `8 marginal findings`, `n=71 runs`, `through 2026-09-13` and `#964` in that order; (b) [M2] the second reads §Authoring a queue and matches `clock census`, `n=3 runs`, `runs 10–12`, `2026-09-05` in order; (c) [M3] the third reads §The proof gate and matches `Measured 2026-09-04`, `n=1 sitting`, `9 rounds`, then `13 of the 22 minutes`; (d) [M4] the fourth and fifth read §Decomposition judgment: `Measured 2026-09-02` then `n=2 runs` then `79 min`, `49.5 min`, `#541`; and `0.26×` then `n=1 drain of 3 runs` then `#454` then `2026-09-01`; (e) [M5] the sixth reads §Self-review to the end of the file and matches `n=`, `window`, `experiment`, `Summary`, `rollback`, `CLAUDE.md`, `Test doctrine` in that order; (f) [M6] the seventh greps the `reviewEconomy` row of the report reference and matches the old phrase followed by `n=71 runs` and `through 2026-09-13` on that one line; (g) [M7] the eighth `Run:` line loops over the six literals and names the first one lost, exiting 1 on it, and the ninth pins the report reference's phrase to exactly one occurrence — a deletion or a duplication fails it; (h) [M1] the tenth reports the skill's size, a reported sensor gating nothing.

**Stale-if:**
- issue-closed: #994
- path-absent: `skills/ultrawrite/SKILL.md`

### Task 3: The release census's totals line names the runs it read

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrawrite/scripts/authoring_census.py`
- Modify: `tests/test_authoring_census.py`

**Claim:** When I read a release's census, its last line tells me which runs it was read over, not only how many. (derived)
Machine: M1. `authoring_census.py`'s table ends with the line `totals: plans=<n> runs=<A>..<B> risk_override=<k>/<m> recommended_picked=<p>/<q> authoring_min=<a> run_min=<r>`, where `<A>` and `<B>` are the lowest and highest run numbers among the rows; over a directory holding records for `run-9` and `run-133` and nothing else the line is exactly `totals: plans=2 runs=9..133 risk_override=0/0 recommended_picked=0/0 authoring_min=0 run_min=0`.
M2. Over a directory with no run records the line is exactly `totals: plans=0 runs=- risk_override=0/0 recommended_picked=0/0 authoring_min=0 run_min=0`; over both directories the header line is exactly the ten tab-separated columns `run`, `authoring_min`, `probes`, `dispatched`, `rejected`, `routing`, `lane`, `questions`, `recommended_picked`, `run_min` in that order; and the per-run row for `run-9` (dispatched 3, rejected 0, no authoring record, no status) is exactly the tab-separated `9 - - 3 0 - - - - -`, as at BASE.
M3. `tests/test_authoring_census.py` pins the new shape — its `--from` fixture (runs 9, 131, 133) expects `runs=9..133` and its `--fetch` fixture (runs 131, 133) expects `runs=131..133` — and every case in the file passes.

**Authorized-by:** #994's 2026-09-15 decision comment ("every reading row carries `n=… (window)`"); `skills/ultrawrite/SKILL.md` §The proof gate ("its last `totals:` line is what the release notes carry").

**Interfaces:**
- Consumes: nothing
- Produces: `_totals_line(rows) -> str`

**Context:** The floor, one literal shared by every task of this plan: every reading row carries `n=… (window)`; no default flips under n = 5 runs (20 tasks for a per-task reading); a flip taken under the floor is an experiment on its map and carries its rollback; a fact read once (a kata seam, a trap) carries its date, not an n. The `totals:` line is the one reading row a script prints for a release, and at BASE it carries its n (`plans=<n>`, `recommended_picked=<p>/<q>`) and no window: `_totals_line(rows)` (lines 183–201 of `skills/ultrawrite/scripts/authoring_census.py`) returns `"totals: plans=%d risk_override=%d/%d recommended_picked=%d/%d authoring_min=%d run_min=%d"`, and `render_table(rows)` appends it after the header and one line per row. `census_rows(root)` sorts rows by run number, so `<A>` is the first row's `run` and `<B>` the last's; the `runs=` field goes directly after `plans=`, `runs=-` when `rows` is empty (the census over an empty directory prints the header and the totals line and exits 0 at BASE, and keeps doing so). The header is `COLUMNS` joined by tabs — `run`, `authoring_min`, `probes`, `dispatched`, `rejected`, `routing`, `lane`, `questions`, `recommended_picked`, `run_min` — and `render_register` prints no totals line; neither changes. Two pins at BASE read the old line and both are this task's to update: `tests/test_authoring_census.py` line 137, `TOTALS = ("totals: plans=3 risk_override=1/2 recommended_picked=2/2 " "authoring_min=165 run_min=16")`, over the `build_root` fixture whose runs are 9, 131 and 133 (`runs=9..133`), and line 437, the `--fetch` case's `"totals: plans=2 risk_override=1/2 recommended_picked=2/2 " "authoring_min=165 run_min=16"` over runs 131 and 133 (`runs=131..133`); `grep -c 'totals: plans=' tests/test_authoring_census.py` is 2 at BASE and stays 2. The test file drives the script as a subprocess over directories built under `tmp_path`; a record is `<root>/run-<N>/gate-verdicts.json` (`RECORD_NAME`) and a run directory without one earns no row, which is why the `Run:` lines below build their fixture with `mkdir` and `printf` and nothing else. `CLAUDE.md`'s Layout bullet names the script and its `totals:` line and does not spell the line's fields, so it does not change; no other file in the tree reads `totals:` (`git grep 'totals: plans'` at BASE hits the script and the test only).

**Proof:**
- Run: d=$(mktemp -d) && mkdir -p $d/run-9 $d/run-133 && printf '%s' '{"tasks":{},"tally":{"dispatched":3,"rejected":0}}' > $d/run-9/gate-verdicts.json && printf '%s' '{"tasks":{},"tally":{"dispatched":2}}' > $d/run-133/gate-verdicts.json && python3 skills/ultrawrite/scripts/authoring_census.py --from $d | tail -1 | grep -qxF 'totals: plans=2 runs=9..133 risk_override=0/0 recommended_picked=0/0 authoring_min=0 run_min=0'
- Run: d=$(mktemp -d) && mkdir -p $d/run-9 $d/run-133 && printf '%s' '{"tasks":{},"tally":{"dispatched":3,"rejected":0}}' > $d/run-9/gate-verdicts.json && printf '%s' '{"tasks":{},"tally":{"dispatched":2}}' > $d/run-133/gate-verdicts.json && python3 skills/ultrawrite/scripts/authoring_census.py --from $d | head -1 | grep -qxF "$(printf 'run\tauthoring_min\tprobes\tdispatched\trejected\trouting\tlane\tquestions\trecommended_picked\trun_min')"
- Run: d=$(mktemp -d) && mkdir -p $d/run-9 $d/run-133 && printf '%s' '{"tasks":{},"tally":{"dispatched":3,"rejected":0}}' > $d/run-9/gate-verdicts.json && printf '%s' '{"tasks":{},"tally":{"dispatched":2}}' > $d/run-133/gate-verdicts.json && python3 skills/ultrawrite/scripts/authoring_census.py --from $d | sed -n 2p | grep -qxF "$(printf '9\t-\t-\t3\t0\t-\t-\t-\t-\t-')"
- Run: e=$(mktemp -d) && python3 skills/ultrawrite/scripts/authoring_census.py --from $e | tail -1 | grep -qxF 'totals: plans=0 runs=- risk_override=0/0 recommended_picked=0/0 authoring_min=0 run_min=0'
- Run: e=$(mktemp -d) && python3 skills/ultrawrite/scripts/authoring_census.py --from $e | head -1 | grep -qxF "$(printf 'run\tauthoring_min\tprobes\tdispatched\trejected\trouting\tlane\tquestions\trecommended_picked\trun_min')"
- Run: grep -qF 'runs=9..133' tests/test_authoring_census.py && grep -qF 'runs=131..133' tests/test_authoring_census.py
- Run: test "$(grep -c 'totals: plans=' tests/test_authoring_census.py)" = 2
- Run: python3 -m pytest -q tests/test_authoring_census.py
- Legs: (a) [M1] the first `Run:` line builds a directory with records for runs 9 and 133 only and pins the whole totals line as a fixed string (`-F`, so `..` is the two dots and not any two characters), `runs=9..133` in its place between `plans=2` and `risk_override=0/0`, anchored at both ends; (b) [M2] the fourth `Run:` line pins the empty-directory totals line with `runs=-` the same way; the second and fifth pin the header, over the two-run directory and over the empty one, as the exact tab-joined ten-column line; and the third pins the `run-9` row as the exact tab-joined line `9 - - 3 0 - - - - -`, so a changed column, a reordered one or a changed row cell fails; (c) [M3] the sixth `Run:` line finds both fixture windows written into the test file as fixed strings, the seventh pins that the file still carries exactly two totals pins — one per fixture, none added or dropped — and the eighth runs the whole test file, whose exit code is the evidence.

**Stale-if:**
- issue-closed: #994
- path-absent: `skills/ultrawrite/scripts/authoring_census.py`

### Task 4: The four maps that own a reading carry the floor, posted by hand

**Type:** manual

**Files:**
- Modify: none — GitHub issues #870, #872, #732 and #810, which no sandbox can write

**Claim:** After the merge, each map that owns one of the readings says the floor on its own page, with its reading's n and window beside it, so a reader of the map sees the weight without opening the tree. (derived)
Machine: M1. #870 carries one comment whose text is the `#870` block in Proof, verbatim.
M2. #872 carries one comment whose text is the `#872` block in Proof, verbatim.
M3. #732 carries one comment whose text is the `#732` block in Proof, verbatim.
M4. #810 carries one comment whose text is the `#810` block in Proof, verbatim.

**Authorized-by:** #994's 2026-09-15 decision comment ("written on the map that owns each reading (#870, #872, #732, #810)"); CLAUDE.md §Working with the operator "Propose, then wait for 'file it.'"

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The floor, one literal shared by every task of this plan: every reading row carries `n=… (window)`; no default flips under n = 5 runs (20 tasks for a per-task reading); a flip taken under the floor is an experiment on its map and carries its rollback; a fact read once (a kata seam, a trap) carries its date, not an n. This task is the operator's or the coordinator's, after the run's PR has merged: four `gh issue comment <N> --repo popmechanic/ultrapowers --body-file <file>` calls, one per map, each body the block below with `run-<N>` replaced by this plan's run number. The readings named in the blocks are the record's own: #872's escapes reading of 2026-09-15 is 0 escapes over n=9 merged runs (131–140) against 0 over n=6 (116–130); the one-reviewer flip (#974) rests on #964's review reading, n=71 runs through 2026-09-13; #1006's fold rule is the run-134 replay against run-129, `foldAgeMs=0` its rollback (a fold at every landing, #1006's own words); #732's race-48 (#511, 2026-09-01) was one race of K=3; #810's interface-findings baseline is the 18 of 41 notes its 2026-09-09 charter read, and Phase C's barrier slack is run-134's 2.52; #870's rule 3 reads the catch counter, whose `touching runs` column is the n on each of its rows. Nothing below extends the decision: each block states the floor and puts the n and window on the readings that map already carries.

**Proof:**
- Legs: (a) [M1] `gh issue view 870 --repo popmechanic/ultrapowers --comments` shows the `#870` block below as its newest comment; (b) [M2] the same for #872 and the `#872` block; (c) [M3] the same for #732 and the `#732` block; (d) [M4] the same for #810 and the `#810` block — each read by the operator, since no driver runs a `manual` task.

```markdown
#870
**n on every row (operator, 2026-09-15, #994; in the tree since run-<N>).** Every reading on this map carries `n=… (window)` on its row — `n=9 merged runs (131–140)`, never a bare count — and no default flips under n = 5 runs, or 20 tasks for a per-task reading. A flip taken under that floor is an experiment on this map and carries its rollback. A fact read once (a kata seam, a trap) is dated, not counted. Rule 3's reading is the catch counter's `touching runs` column — that is the n on each of its rows, and a deletion cites it. The floor is written in CLAUDE.md's test-doctrine bullet and in ultrawrite's self-review.

#872
**n on every row (operator, 2026-09-15, #994; in the tree since run-<N>).** The escapes reading above is `n=9 merged runs (131–140)` against a baseline of `n=6 merged runs (116–130)` — over the floor of five, so one reviewer and one fix round stand as a default, not an experiment; the flip itself (#974) rested on `n=71 runs (through 2026-09-13, #964)`. Every later reading of this experiment's successors carries `n=… (window)` the same way, and a flip under n = 5 runs (20 tasks for a per-task reading) is an experiment that names its rollback.

#732
**n on every row (operator, 2026-09-15, #994; in the tree since run-<N>).** Every reading this map cites carries `n=… (window)`: race-48 is `n=1 race of K=3 (2026-09-01, #511)`; the two-reviewer variance reading (#462) and the `54% of waves` figure carry theirs when they are next read. No default flips on this map under n = 5 runs (20 tasks for a per-task reading); a flip taken under that is an experiment here and carries its rollback — and a compiler pick recorded against one run's outcome is one row, not a rule.

#810
**n on every row (operator, 2026-09-15, #994; in the tree since run-<N>).** The fold rule (#1006) is one replay — `n=1 run (run-134 against run-129)` — and stays an experiment on this map until five runs, its rollback `foldAgeMs=0` (a fold at every landing). Phase C's barrier-slack reading is `n=1 replay (run-134, 2.52)`; the interface-findings baseline is `18 of 41 notes (n=41 notes, the runs this charter read on 2026-09-09)`. Every reading here carries `n=… (window)`, and no default flips under n = 5 runs (20 tasks for a per-task reading) without being called an experiment with its rollback.
```

**Stale-if:**
- issue-closed: #994
