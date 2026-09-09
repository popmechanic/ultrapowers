# The catch counter judges every red, credits only a real green, renders its table, sums its catches, and its docs promise only the flag the script has

**Grammar:** claims-v1

**Claim:** The catch counter judges every red, credits only a real green, renders its table, sums its catches, and its docs promise only the flag the script has. (elicited)

**Goal:** #822, #823 and #824 — the three residual sinks of #806 (run-70, PR #805, the catch
counter of map #414), one bundle because they share no file and one PR closes all three. Two
choices made in place of a question, each with the least machinery: (1) #822's fourth item asks
whether a receipt-present task with `writes: []` should leave an `exercises` key holding `[]`
or whether the report's tree walk stays the only source of `unobserved` rows — the tree walk
stays the only source, the empty union is still dropped, and the `derive_catches` docstring
says so, because that is a docstring paragraph and one pinning test instead of a second key
shape the report must learn; (2) #823's `- Run:` asks for a ledger holding one `catch-count`
row, but a `Run:` is one command and cannot write a fixture first, so the driver's command
reads a ledger path that does not exist (which the report's `--help` documents as "reads as no
rows") and pins the delimiter as the second stdout line, while the one-row ledger lives in the
exam's own leg. Two choices were decided before authoring: #824's first item takes the issue's
recommendation — the SKILL.md sentence is reworded and no default path enters the script — and
its second item takes the space-delimited control exactly as the issue spells it.
**Closes:** #822 #823 #824

**Tech Stack:** Python 3 (`skills/ultralearn/scripts/*.py`, stdlib only — no model call, no
network, no git write). The suite is `python3 -m pytest` from the repo root (`pytest.ini` scopes
it to `tests/`); the three exam files here import the scripts by path.

**Spec:** none — the three issues are the spec; each task quotes its issue's desired-state
sentence.

**Parallelization rationale:** one wave, width 3. Three tasks on three disjoint file pairs
(counter + its exam, report + its exam, skill prose + its exam) with no `Consumes:` between
them: nothing in the report task needs the counter's runtime behaviour (the report reads
ledger rows the exam writes by hand), and the docs task pins the counter's CLI as it already is
at BASE. No chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultralearn/scripts/_outcome.py skills/ultralearn/scripts/fleet_events.py skills/ultralearn/scripts/merge_ledger.py skills/ultralearn/scripts/harvest_fleet_runs.py
- A `catch-count` row still carries exactly the seven keys `kind`, `runId`, `driverRuns`,
  `catches`, `reds`, `touched`, `exercises`, and every path in it is the string the record
  spelled — nothing normalised, resolved or globbed.
- `--ledger` stays the counter's only flag and has no default: without it the counter appends
  nothing and prints `<n> run(s) counted, 0 row(s) appended, 0 already recorded` at exit 0, as
  at BASE.
- The report's pinned strings are unchanged: the header `| test | catches | touching runs | status |`,
  `## Zero-catch curve`, `N=<n>: <c> file(s)`, `max touching runs: <max>`,
  `## Zero catches over <N> runs`; the delimiter row is the one addition to the table.
- The 38 tests the three exam files collect at BASE stay green; new legs are added beside them
  under a comment naming the task.

**Acceptance:** suite — the committed suite is the verification.

---

### Task 1: Every red is judged, only a literal green closes the pair, and the outcome vocabulary is one tuple

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/catch_counter.py`
- Test: `tests/test_ultralearn_catches.py`

**Claim:** The gate moves off the red and onto the outcome: every red is judged; `_outcome_of` falls through to `rerun` — never `exam-edited`/`task-writes`/`caught` — when neither `report.json` nor `receipt.json` was readable, and the docstring's third paragraph goes. (2) Only a literal `exit == 0` closes the pair: `if events[green].get("exit") != 0: return "stayed-red"`. (3) `_outcome_of` returns members of `OUTCOMES` and the exam asserts against `counter.OUTCOMES` (`assert set(counter.OUTCOMES) == OUTCOMES`). (quoted from #822)
Machine: M1. In a run directory holding only `events.jsonl` — no `report.json`, no `receipt.json` — `derive_catches` judges every red driver run that names a test path: a red followed by a same-kind same-`cmd` red for the same task yields a `reds` entry with `outcome` `stayed-red`; a red followed by a same-kind same-`cmd` `exit` 0 event with no `fix:<task>:` `worker:end` between them yields `rerun`; and a red, then a `fix:1:0` `worker:end`, then the same-kind same-`cmd` `exit` 0 event yields `rerun` — never `caught`, `exam-edited` or `task-writes` — with `catches` exactly `{}`.
M2. When the next same-kind same-`cmd` event for the red's task carries no `exit` key at all, the red's `outcome` is `stayed-red` and `catches` is exactly `{}`, even with `report.json` and `receipt.json` present and a `fix:1:0` `worker:end` between the two events.
M3. `catch_counter.OUTCOMES` is exactly the tuple `("caught", "exam-edited", "task-writes", "rerun", "stayed-red", "no-green")`, the exam's own vocabulary set equals `set(catch_counter.OUTCOMES)`, every `reds[].outcome` over the six fixture shapes (credit, exam edited, task writes, no fix round, next run red, no later run) is a member of `catch_counter.OUTCOMES`, and the name `OUTCOMES` occurs at least twice in `skills/ultralearn/scripts/catch_counter.py` — its definition and a use.
M4. A task present in `receipt.json` with `writes: []` whose driver run names test path `T` leaves no `exercises[T]` key, `catch_counter.derive_catches.__doc__` names the report's tree walk as the only source of `unobserved` rows, and that docstring no longer says a recordless run reports no reds.

**Authorized-by:** #822 (desired state, items 1–4); #806; #414.

**Interfaces:**
- Consumes: none
- Produces: `OUTCOMES`

**Context:** At BASE `3fb782b6` the function is `derive_catches` (`catch_counter.py:195-254`) with
`_outcome_of` (`:175-192`), `_is_red` (`:135-138`, `exit not in (0, None)` — so an event with no
`exit` is "neither red nor green" and `_outcome_of` reads any not-red successor as the green),
`have_record = isinstance(report, dict) or isinstance(receipt, dict)` (`:212`) and the skip
`if not _is_red(event) or not have_record: continue` (`:231`) — the over-broad gate M1 removes.
`OUTCOMES` (`:65-66`) is defined once and referenced nowhere else (`grep -c OUTCOMES` prints
`1` at BASE); the six strings are literals inside `_outcome_of`. The `derive_catches` docstring's
third paragraph at BASE begins "A run with no record at all — neither `report.json` nor
`receipt.json` — has nothing to judge its reds by" and ends "reports no reds and no catches
rather than crediting a claim the record never made"; M4 replaces it with the choice: the empty
union is dropped (`:250-253` unchanged — `exercises` holds a key only where some task's writes
stand behind it) and `catch_report.py`'s tree walk (`tree_test_files`, its two globs) is the only
source of `unobserved` rows. `_read_json` returns `None` for a missing, unreadable or malformed
file, so "neither readable" is `report is None and receipt is None` — a run with only one of the
two present is judged exactly as at BASE (a fix round with the path in neither `examEdited` nor
`writes` is `caught`). The exam file `tests/test_ultralearn_catches.py` already carries 22 tests
(legs (a)–(n) plus the vocabulary test) built on `base_fixture(run_dir, kind=, run_id=,
exam_edited=, writes=, with_fix=, green_exit=, with_green=, extra=)`, `_write_run(run_dir, events,
report=None, receipt=None)` (writes `report.json`/`receipt.json` only when given), `_driver_run(seq,
kind, task, cmd, exit_code, **extra)` (always sets `exit=`, so an `exit`-less event is built with
`_ev(seq, kind=…, task=…, cmd=…, iter=0)` directly), `_fix_end(seq, label)`, `_report(rows)`,
`_receipt(entries)`, `THING`/`THING_CMD`; its local `OUTCOMES` set at `:33` is what M3 asserts
equal to the module's tuple. Existing pins that must stay green: leg (n) (`test_n_…`) — a
recordless run whose one driver run is green yields `catches == {}`, `touched == []`,
`exercises == {}` (green-only, so M1's judging adds no `reds` entry there); leg (i) — `exercises`
is the sorted union of the writes of every task whose runs named the path. Every new leg is red
at BASE `3fb782b6`: the recordless reds yield `reds == []` there, the `exit`-less successor is
credited `caught`, `grep -c OUTCOMES` is `1`, and the docstring still says "reports no reds".
The stdout line of the CLI, the row keys and `row_id` are untouched. The compiler's `base-sha-in-suite` advisory on this exam names the string `git diff --quiet $ULTRA_BASE -- fleet/x.mjs` at `:338`, a `cmd` fixture handed to `test_paths_of` at BASE — the exam reads no base sha, and that probe stays as it is.

**Proof:**
- Test: `tests/test_ultralearn_catches.py`
- Guard: `tests/test_ultralearn_catches.py`
- Run: python3 -m pytest tests/test_ultralearn_catches.py -q
- Run: test "$(grep -c OUTCOMES skills/ultralearn/scripts/catch_counter.py)" -ge 2
- Run: python3 -c 'import sys; sys.path.insert(0, "skills/ultralearn/scripts"); import catch_counter as c; d = c.derive_catches.__doc__; assert "unobserved" in d and "tree walk" in d and "reports no reds" not in d'
- Legs: (a) a recordless run directory (`_write_run` with neither `report` nor `receipt`) whose events are `run:open`, a red `driver:exam-run` for task `1` naming `THING`, then the same-kind same-`cmd` run with `exit` 1 — `derive_catches` judges both reds: exactly two `reds` entries, in event order, the first with `task` `1`, `path` `THING`, `outcome` `stayed-red` (its next same-kind same-`cmd` run is red) and the second with `outcome` `no-green` (no later same run at all), and `catches == {}` [M1]; (b) the same recordless directory with the second run at `exit` 0 and no `worker:end` between — exactly one entry, `outcome` `rerun` [M1]; (c) the same recordless directory with a `fix:1:0` `worker:end` between the red and the `exit` 0 run — exactly one entry, `outcome` `rerun`, and `catches == {}`, so the recordless credit of BASE is gone [M1]; (d) `base_fixture` with both records and a fix round, but the fourth event built without an `exit` key (`_ev(4, kind="driver:exam-run", task="1", cmd=THING_CMD, iter=0)`) — exactly one entry, `outcome` `stayed-red`, `catches == {}`, and no entry with `outcome` `caught` [M2]; (e) `counter.OUTCOMES == ("caught", "exam-edited", "task-writes", "rerun", "stayed-red", "no-green")` and `set(counter.OUTCOMES) == OUTCOMES` (the exam's set), and the existing vocabulary test asserts each `reds[].outcome` over the six `base_fixture` shapes `in counter.OUTCOMES`; the second `Run:` is the definition-plus-use count [M3]; (f) a run with both records whose receipt entry for task `1` has `writes: []` and whose one driver run for task `1` is a green `driver:exam-run` naming `THING` — `THING not in row["exercises"]` and `row["touched"] == []`; and the third `Run:` reads the docstring for `unobserved`, `tree walk`, and the absence of `reports no reds` [M4].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/catch_counter.py`
- path-absent: `tests/test_ultralearn_catches.py`
- issue-closed: #822

### Task 2: The table renders and catches is a sum

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/catch_report.py`
- Test: `tests/test_ultralearn_catch_report.py`

**Claim:** `table_lines` emits the delimiter row immediately after `HEADER`, and the suite holds the sum. (quoted from #823)
Machine: M1. `table_lines(table)` returns `HEADER` as its first line and `| --- | --- | --- | --- |` as its second, followed by one `| <path> | <catches> | <touching runs> | <status> |` row per entry sorted by path; and the CLI's second stdout line is `| --- | --- | --- | --- |`, both for the leg-(a) ledger and for a `--ledger` path that does not exist.
M2. `catch_table(rows, tree_tests)["<T>"]["catches"]` is the sum over every `catch-count` row of that row's `catches[T]`: over `[ROW_A, dict(ROW_A, id="d"*16, runId="run-d")]` with an empty tree, `tests/test_a.py` has `catches` `2` and `touchingRuns` `2`.

**Authorized-by:** #823 (desired state); #806; #414.

**Interfaces:**
- Consumes: none

**Context:** At BASE `3fb782b6`, `table_lines` (`catch_report.py:176-182`) is `lines = [HEADER]`
followed directly by the data rows — no delimiter, which GFM requires for a table to render;
the repository's own emitter writes one (`merge_ledger.py:134-135`,
`"| --- | --- | --- | --- | --- |"` under its five-column header). `catch_table` (`:86-117`)
sums with `sum(_count(_mapping(row, "catches").get(path)) for row in rows)` (`:106-107`) and
counts `touchingRuns` as the rows whose `touched` intersects the union `exercised` (`:111-112`);
every existing fixture credits a test in at most one row (`ROW_A` alone carries
`tests/test_a.py`), so `max`, `any` or last-row-wins passes all eleven tests at BASE — M2's
two-row fixture is the one that separates sum from max (`2` vs `1`; `touchingRuns` `2` because
both rows' `touched` is `["lib/a.py"]`, which `ROW_A`'s `exercises` names for
`tests/test_a.py`). The exam file `tests/test_ultralearn_catch_report.py` already tolerates the
delimiter: `_is_separator` (`:254`) matches cells of `:?-{2,}:?` and `_table_rows` (`:258-270`)
skips such a row, so `CLI_ROWS` and legs (h)–(j) stay green with the delimiter in place; the
`mod` fixture and `_run(*args)` / `_lines(proc)` helpers are how a leg reaches the module and
the CLI. The CLI's `--ledger` help says a missing file "reads as no rows" (`:213-215`), which is
what the `Run:` relies on: with no rows the table is the tree's tests alone, and its second line
is the delimiter — at BASE that line is the first data row (`| fleet/tests/test_claims_grammar.mjs | 0 | 0 | unobserved |`
in this repository), so the `Run:` is red at BASE. `HEADER`, the curve strings and the
`## Zero catches over <N> runs` heading are unchanged.

**Proof:**
- Test: `tests/test_ultralearn_catch_report.py`
- Guard: `tests/test_ultralearn_catch_report.py`
- Run: python3 -m pytest tests/test_ultralearn_catch_report.py -q
- Run: python3 skills/ultralearn/scripts/catch_report.py --ledger /nonexistent/catch-ledger.jsonl | sed -n 2p | grep -qx '| --- | --- | --- | --- |'
- Legs: (a) `mod.table_lines(mod.catch_table(ROWS, TREE_FILES))[0] == HEADER`, `[1] == "| --- | --- | --- | --- |"`, and `[2:]` is exactly the four `CLI_ROWS` rendered as `| a | b | c | d |` lines in that order; a table of one entry yields exactly three lines [M1]; (b) the CLI over the leg-(a) ledger and the `tree` fixture: `_lines(proc)[1] == "| --- | --- | --- | --- |"` and `_table_rows(lines) == CLI_ROWS` still; the CLI over a `--ledger` path under `tmp_path` that does not exist: line index 1 is that same delimiter and the following data rows are the tree's two files `unobserved` [M1]; (c) `mod.catch_table([ROW_A, dict(ROW_A, id="d"*16, runId="run-d")], [])["tests/test_a.py"]` has `catches == 2` and `touchingRuns == 2` — a `max`, `any` or last-row-wins reading yields `1` and fails this leg [M2].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/catch_report.py`
- path-absent: `tests/test_ultralearn_catch_report.py`
- issue-closed: #823

### Task 3: The skill promises only the flag the counter has, and the docs control is real

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/SKILL.md`
- Test: `tests/test_ultralearn_docs.py`

**Claim:** the SKILL.md sentence reads "appends … to the file named by `--ledger`, the counter's only flag" (then `grep -c 'overrides that path' skills/ultralearn/SKILL.md` = 0). Recommendation: reword — the findings ledger is untracked on the laptop by #544 and a default path baked into a script that the sandbox also runs is a path nothing there can write. (2) The control becomes a space-delimited spelling that must match neither regex — `"the row says examEdited and writes in the receipt"` — red with the `[^ \n]` classes removed from the patterns. (quoted from #824)
Machine: M1. The catch-counter section of `skills/ultralearn/SKILL.md` (`## The catch counter` through `## Verb 2`), joined on one line, says the counter appends one `catch-count` row per run to the file named by `--ledger`, the counter's only flag, in that order; the string `overrides that path` occurs zero times in the file; the section still names `docs/superpowers/observations/ledger.jsonl` (as the findings ledger an operator usually names, not as a default); and `python3 skills/ultralearn/scripts/catch_counter.py tests/fixtures/ultralearn/census` without `--ledger` prints exactly `2 run(s) counted, 0 row(s) appended, 0 already recorded`.
M2. The docs exam's two record-field patterns — `[^ \n]examEdited[^ \n]` and `[^ \n]writes[^ \n] in the receipt` — each match the section and each reject the control string `the row says examEdited and writes in the receipt`, while the same two patterns with their `[^ \n]` classes removed (`examEdited` and `writes in the receipt`) each match that control string.

**Authorized-by:** #824 (desired state, items 1–2, item 1 by the issue's own recommendation); #806; #544.

**Interfaces:**
- Consumes: none

**Context:** At BASE `3fb782b6` the sentence is `SKILL.md:90-94`: "counts a run — or every run
under a tree — and appends one `catch-count` row per run to
`docs/superpowers/observations/ledger.jsonl`, the same file the findings land in. `--ledger`
overrides that path and is the counter's only flag; paths inside a row stay exactly as the
record spells them." `catch_counter.py:356-357` declares `--ledger` with no default, and without
it `main` appends nothing (`:361-362`) — the census fixture `tests/fixtures/ultralearn/census`
holds two run directories (`run-101`, `run-102` carry `events.jsonl`; `run-103` holds only
`report.json` and `status.json` and is not a run directory), so the counter over it prints
`2 run(s) counted, 0 row(s) appended, 0 already recorded` at BASE and after — that `Run:` pins
that no default appeared. The findings ledger is untracked on the laptop by #544, so a default
baked into a script the sandbox also runs would be a path nothing there can write — which is why
the sentence moves and the script does not. The docs exam `tests/test_ultralearn_docs.py`
addresses the section as `_catch_section()` (from the `## The catch counter` line through the
`## Verb 2` line, both included) and its leg (b) (`:85-91`) asserts the section names
`catch_counter.py`, `catch_report.py`, `catch-count` and
`docs/superpowers/observations/ledger.jsonl` — so the reworded sentence keeps that path in the
section, as the file the findings land in and the one an operator usually names; leg (c)
(`:94-111`) holds the two patterns `exam_edited = r"[^ \n]examEdited[^ \n]"` and
`writes_field = r"[^ \n]writes[^ \n] in the receipt"`, matched against the section (the section
at BASE spells "the task row's `examEdited`" and "the task's `writes` in the receipt", which the
rewording keeps), and the control `prose = "the counter writes the ledger"` at `:108` — a string
holding no `examEdited`, so its first `assert not re.search` can never fail; M2 replaces it with
the space-delimited spelling and adds the positive half, that the class-stripped patterns do
match it. Leg (e) (`:121-131`) asserts every `--[a-z][a-z-]*` token in the section is in one of
the two CLIs' `--help`, so the rewording introduces no flag; leg (f) runs `validate_skill.py`
on the skill. The `Run:` pins avoid backticks: the sentence pin greps the words with `.*`
across the code spans, and `counter.s` matches the apostrophe with `.` so the pattern stays inside
one pair of single quotes (guide review, 2026-09-09: the looseness is one character and the
`--ledger` inside the quoted pattern is not read as a grep option).

**Proof:**
- Test: `tests/test_ultralearn_docs.py`
- Guard: `tests/test_ultralearn_docs.py`
- Run: python3 -m pytest tests/test_ultralearn_docs.py -q
- Run: test "$(grep -c 'overrides that path' skills/ultralearn/SKILL.md)" = 0
- Run: sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | tr '\n' ' ' | grep -q 'appends one.*catch-count.*row per run to the file named by.*--ledger.*the counter.s only flag'
- Run: test "$(python3 skills/ultralearn/scripts/catch_counter.py tests/fixtures/ultralearn/census)" = '2 run(s) counted, 0 row(s) appended, 0 already recorded'
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn
- Legs: (a) the section joined on one line matches `appends one.*catch-count.*row per run to the file named by.*--ledger.*the counter.s only flag`, `overrides that path` is not in `SKILL.read_text()`, and `docs/superpowers/observations/ledger.jsonl` is in the section (the existing section-names pin); the second, third and fourth `Run:` are the same three facts read by the driver, and the fourth compares the counter's whole stdout, as one string, to the pinned line, so a second line or a default-path notice fails it [M1]; (b) `re.search(exam_edited, section)` and `re.search(writes_field, section)` are both truthy; for the control `prose = "the row says examEdited and writes in the receipt"`, `re.search(exam_edited, prose)` and `re.search(writes_field, prose)` are both `None`; and `re.search(r"examEdited", prose)` and `re.search(r"writes in the receipt", prose)` are both truthy — so the classes are what the control demonstrates, and a test with the classes removed from the two patterns fails on this control [M2].

**Stale-if:**
- path-absent: `skills/ultralearn/SKILL.md`
- path-absent: `tests/test_ultralearn_docs.py`
- issue-closed: #824
