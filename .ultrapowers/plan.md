# Test selection on the factory: code finds the tests a task or a patch touches, Jev picks, and the engine runs those few

**Grammar:** claims-v1

**Claim:** do: run a plan on the factory against a repository that already has tests; see: before an exam is written the examiner is told which parts of the task an existing test already proves and writes only the rest, every landing runs the few existing tests its patch touches — picked by Jev from candidates that code found — and a test that was green before the patch and red after it is on the task's issue at once; nothing ever runs the whole collection. (elicited)
**Summary:** This is test selection for the factory: code finds the existing tests a task or a patch touches, Jev picks the ones that matter, and the engine runs only those few. It exists because the examiner costs nearly as much as the implementer (run-183, n=1 run, 5 tasks) while much of what it writes may already be in the tree, and because the factory today runs no existing test at all, so a patch can break something nobody is looking at. You get cheaper exams, regression protection that takes seconds instead of the whole suite, and every break written where the next worker reads it — as an experiment whose rollback is one switch in the policy file, together with three small repairs the last run's record asked for.

**Goal:** #1133 widened one step (operator, 2026-09-18, "Verification is mechanical and fast"): one candidate finder that is code, two Jev readers that select, and an engine that uses the selection twice — before the examiner is dispatched (clauses an existing test already establishes get no new leg) and at landing (the selected tests run in the candidate's clone; green at the anchor and red in the clone is a `[catch]` fact on the task's issue and makes the landing short for the one re-dispatch the engine already allows). Every threshold is an `experiment` under the n = 5 floor with its rollback named: `policy.select.enabled = false` is the engine exactly as run-192 drove it. Beside it, three repairs run-192's record asked for (n=1 run, 8 tasks, 2026-09-18): the boot strips a run's unguarded exam files before it pushes and copies them to the evidence record (the parser names them); Jev is shown the hunks that carry a clause's own literals instead of the first 20,000 characters of a patch (the claim reading fell from 0.90 on the smallest patch to 0.32 on the largest while per-clause coverage stayed at or above 0.88); and the gate text says a negation is always a leg (two negation clauses read 0.19 and 0.40 where both exams passed). Nothing under the old engine moves: `fleet/run-*.mjs`, `fleet/sandbox-boot.sh` and `fleet/roles/` are frozen.

**Tech Stack:** Node 24 ESM for the finder, the hunk picker, the judge and the engine, with no new npm dependency; Python 3 standard library for the parser; bash for the boot; `fleet/jev-client.mjs` consumed as-is through `factory/judge.mjs`.
Spec: `docs/superpowers/specs/2026-09-17-jev-factory.md` §The loop, and #1133, #1131, #810 on the target — laptop only; what a worker needs is in its Context.

**Parallelization rationale:** wave 1 is six wide — the finder, the readers, the hunk picker, the parser, the boot and the gate text share no file, and the shapes they share (the finder's answer, the readers' answers, the parser's `--unguarded` line format, the `policy.select` object) are literals in every Context that needs them. Wave 2 is the engine alone: it imports the finder and the hunk picker, and its exam drives the real finder over a fixture tree, so it needs their runtime behaviour — which test files the finder answers for a given tree — and not merely their shape; it also edits `factory/engine.mjs` after the hunk picker's task has, which keeps two import inserts at one location out of the resolver.

## Global Constraints

- A selection is never the run's failure: a finder that answers nothing, a Jev that does not answer, a selected test that cannot be run — each is one row or one log line, and the landing proceeds as it would have at BASE.
- Nothing runs the whole test collection: the engine runs a task's own exam command and at most `policy.select.max_run` selected test files per measurement, each under `timeout`.
- Models never run git and never choose which tests run: candidates come from code, the selection from Jev, and the engine's own `child_process` runs them.
- A judgment is a question in `factory/questions.json` read through `factory/judge.mjs` with its threshold in `factory/policy.json`, carrying `n`, `window`, `experiment` and `rollback`; no threshold is a literal in code.
- Check: git diff --quiet $ULTRA_BASE -- ':(glob)fleet/run-*.mjs' fleet/sandbox-boot.sh fleet/fleet-bootstrap.sh fleet/roles fleet/kata-client.mjs fleet/launch.mjs skills/ultrapowers/kernel skills/ultrapowers/scripts/compile_plan.py

### Task 1: The candidate finder — code names the test files a set of paths and symbols touches

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/select.mjs`
- Test: `fleet/tests/test_factory_select.mjs`

**Claim:** Given the files of a repository and the paths and names a task or a patch is about, code answers the few existing test files that mention them, most mentions first, and says how each one would be run. (derived)
Machine: M1. `candidateTests({ files, read, paths, symbols, exclude, cap })` resolves an array of `{ path, hits }` holding only test files — a path in `files` whose basename matches `test_*.py`, `test_*.mjs`, `test_*.js`, `test_*.ts`, `*_test.py`, `*.test.ts`, `*.test.js` or `*.test.mjs` — that are not in `exclude` and whose text, as `read(path)` answers it, contains at least one needle; `hits` is the distinct needles found, in needle order; the array is ordered by `hits.length` descending then `path` ascending and holds at most `cap` entries, `cap` defaulting to 8; `read` is called for test files only. M2. The needles are, in order: for each entry of `paths` that is not itself a test file, the path and then its basename without extension; then each entry of `symbols`; deduplicated, and any needle shorter than 4 characters is dropped; a needle containing `/` or `.` matches as a substring, any other needle matches only as a whole word. M3. `symbolsOf(clauses)` answers, in order of appearance and deduplicated, one string per backticked span of the clause texts: the whole span when it contains `/` and ends in a file extension, otherwise the span's leading identifier (`[A-Za-z_$][A-Za-z0-9_$]*`), and nothing for a span whose string would be shorter than 4 characters. M4. `commandFor(path, seconds)` answers the argv `['timeout', String(seconds), 'bun', 'test', path]` for a path ending `.test.ts`, `['timeout', String(seconds), 'python3', '-m', 'pytest', '-q', path]` for one ending `.py`, `['timeout', String(seconds), 'node', path]` for one ending `.mjs` or `.js`, and `null` for anything else.

**Authorized-by:** #1133 ("code finds candidate tests by path and symbol … Jev picks"); CLAUDE.md "Verification is mechanical and fast" (operator, 2026-09-18)

**Interfaces:**
- Consumes: none
- Produces: `candidateTests({ files, read, paths, symbols, exclude, cap }) -> Promise<Array<{ path, hits }>>`
- Produces: `symbolsOf(clauses) -> string[]`
- Produces: `commandFor(path, seconds) -> string[] | null`

**Context:** This module is pure: it takes the repository as a list of repository-relative paths (`files`) and a function `read(path)` that answers a file's text (it may be async), and touches neither the disk nor git nor the network itself — the engine, a sibling task, hands it `git ls-files` and a reader over a clone. It is the code half of select-instead-of-generate: it must be cheap and deterministic, and it decides nothing — Jev selects among what it answers. `exclude` is how the engine keeps a task's own exam files out of the candidates. Whole-word means the needle is not flanked by an identifier character on either side, so `catalog` matches in `from src.catalog import catalog` and not in `catalogue`. Matching is case-sensitive. The exam drives the three exports with plain arrays and an in-memory `read`; it spawns nothing.

**Proof:**
- Test: `fleet/tests/test_factory_select.mjs`
- Legs: (a) with `files` `['src/catalog.py', 'tests/test_catalog.py', 'tests/test_other.py', 'tests/helpers.py', 'fleet/tests/test_engine.mjs']`, texts `from src.catalog import catalog` for `tests/test_catalog.py`, `nothing here` for `tests/test_other.py`, `catalog make_widget` for `tests/helpers.py` and `catalog(); make_widget()` for `fleet/tests/test_engine.mjs`, `paths` `['src/catalog.py']` and `symbols` `['make_widget', 'abc']`, the answer deep-equals `[{ path: 'fleet/tests/test_engine.mjs', hits: ['catalog', 'make_widget'] }, { path: 'tests/test_catalog.py', hits: ['catalog'] }]` and `read` was never called with `tests/helpers.py` or `src/catalog.py`; with `exclude` `['tests/test_catalog.py']` the answer holds only the engine test; with `cap` 1 it holds only the engine test; with twelve matching test files and no `cap` it holds exactly 8 [M1]; (b) a test file whose text is `catalogue abc` is not answered for `paths` `['src/catalog.py']` and `symbols` `['abc']`, and a test file whose text is `see src/catalog.py` is answered with `hits` `['src/catalog.py', 'catalog']`, the stem matching as a whole word between `/` and `.` [M2]; (c) `symbolsOf(['`catalog([1, 3])` returns two `Widget`s from `widgetkit/catalog.py`', '`x` is `ok` and `catalog` again'])` deep-equals `['catalog', 'Widget', 'widgetkit/catalog.py']` [M3]; (d) `commandFor('tests/test_a.py', 300)` deep-equals `['timeout', '300', 'python3', '-m', 'pytest', '-q', 'tests/test_a.py']`, `commandFor('fleet/tests/test_b.mjs', 300)` deep-equals `['timeout', '300', 'node', 'fleet/tests/test_b.mjs']`, `commandFor('tests/c.test.ts', 60)` deep-equals `['timeout', '60', 'bun', 'test', 'tests/c.test.ts']`, and `commandFor('README.md', 300)` is `null` [M4].

**Stale-if:**
- path-exists: `factory/select.mjs`

### Task 2: The two selection readers — Jev says which test already proves a clause, and which tests guard a patch

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/judge.mjs`
- Modify: `factory/questions.json`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_judge_select.mjs`

**Claim:** The judge can be asked two new things about candidate tests that code found: which of them, passing, already establishes a clause, and which of them would go red if a patch broke what it touches; each answer is graded by a number in the policy file, and a judge that does not answer selects nothing. (derived)
Machine: M1. `factory/questions.json` gains a set `select` whose `questions` has keys exactly `covers` and `guards`, both of `type` `noul`, the `covers` instructions carrying both `<i>` and `<j>` and the `guards` instructions carrying `<j>`; `factory/policy.json` gains `select` deep-equal to `{ "enabled": true, "t_covers": { "value": 0.8, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": 1.01 }, "t_guards": { "value": 0.5, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": 1.01 }, "max_candidates": 8, "max_run": 3, "timeout_seconds": 300, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": "enabled = false" }`. M2. `makeJudge(...)` answers a reader `readCovering({ clauses, tests })`, `tests` an array of `{ path, text }`, that puts one question per (clause, test) pair under the key `M<i+1>__t<j>` in a single `ask` whose state is `{ clauses, tests }` with `tests` keyed `t0`, `t1`, … by text, and resolves `{ covered, scores }` where `scores[i][j]` is the pair's noul and `covered[i]` is the path of clause `i`'s highest-scoring test when that score is at or above `policy.select.t_covers.value`, else `null`. M3. It answers a reader `readGuards({ patch, tests })` that puts one question per test under the key `g<j>` in a single `ask` whose state is `{ patch, tests }` keyed the same way, and resolves `{ selected, scores }` where `scores[j]` is the test's noul and `selected` is the paths whose score is at or above `policy.select.t_guards.value`, highest score first, ties in the order given, at most `policy.select.max_run` of them. M4. Either reader resolves `null` after one `log` line beginning `jev:` when `ask` resolves `null`, rejects, or leaves a needed key unanswered; with an empty `tests` it resolves `null` without calling `ask`; the seven readers the judge answered before are still answered.

**Authorized-by:** #1133 ("Jev answers one Noul per (clause, candidate)"); CLAUDE.md "Verification is mechanical and fast" (regression protection is selection)

**Interfaces:**
- Consumes: none
- Produces: `readCovering({ clauses, tests }) -> Promise<{ covered, scores } | null>`
- Produces: `readGuards({ patch, tests }) -> Promise<{ selected, scores } | null>`

**Context:** `factory/judge.mjs` builds every reader the same way: read the set from `factory/questions.json`, put its questions once through `ask({ state, questions })`, grade against `factory/policy.json`, and resolve `null` with one `jev:` log line when Jev does not answer or a needed key is missing — `askOnce` and `refuse` are that shape, and `readLanding` is the existing pairwise reader to follow: it fills a template's `<i>` and `<j>` through every string with `fill` and files answers clause-major. A noul answer is `{ type: 'noul', noul }` or a bare number; `noulOf` reads both. The source of `judge.mjs` carries no decimal literal — every number comes from the policy document — and that stays true. The `covers` question asks whether test `tests.t<j>`, if it passes, establishes clause `clauses[<i>]` (a zero-based index into the state's array, as `readLanding`'s template does); the `guards` question asks whether test `tests.t<j>` exercises behaviour this patch changes, so that it would go red if the patch broke that behaviour. A set in `questions.json` also carries `when`, `reader`, `rollback`, `state`, `provenance` and `calibrated` (false here) beside `questions`; existing questions are not reworded. The seven existing readers are `readTask`, `readLanding`, `gradeFinding`, `readNote`, `readAmendment`, `readSupervisor`, `readSettled`. The thresholds are judgment, unread: 0.8 for `covers` because a wrong yes costs a clause its leg, 0.5 for `guards` because a wrong yes costs one test run. The exam injects a fake `ask` that records its argument and answers a configured object, and temporary copies of the two JSON documents through `questionsPath` and `policyPath` where it needs a different number; it touches no network.

**Proof:**
- Test: `fleet/tests/test_factory_judge_select.mjs`
- Legs: (a) `factory/questions.json` parses with `sets.select.questions` holding keys exactly `covers` and `guards`, each `type` `noul`, the serialized `covers` question containing `<i>` and `<j>` and the serialized `guards` question containing `<j>`; `factory/policy.json` parses with `select` deep-equal to the clause's object [M1]; (b) with two clauses, `tests` `[{ path: 'a', text: 'A' }, { path: 'b', text: 'B' }]` and a fake `ask` answering `M1__t0` 0.9, `M1__t1` 0.85, `M2__t0` 0.3, `M2__t1` 0.79, `readCovering` resolves `covered` `['a', null]` and `scores` `[[0.9, 0.85], [0.3, 0.79]]`, `ask` was called once, its `questions` has keys exactly those four and its `state.tests` deep-equals `{ t0: 'A', t1: 'B' }` [M2]; (c) with five tests `p0`…`p4` and a fake `ask` answering `g0` 0.4, `g1` 0.9, `g2` 0.6, `g3` 0.7, `g4` 0.95, `readGuards` resolves `selected` `['p4', 'p1', 'p3']` and `scores` `[0.4, 0.9, 0.6, 0.7, 0.95]`; with a copied policy whose `select.t_guards.value` is 0.92 it resolves `selected` `['p4']` [M3]; (d) with `ask` resolving `null`, `readCovering` resolves `null` and `log` saw exactly one line beginning `jev:`; with `ask` answering only `g0` for two tests, `readGuards` resolves `null`; with `tests` `[]` both resolve `null` and `ask` was never called; the object `makeJudge` answers has the keys `readTask`, `readLanding`, `gradeFinding`, `readNote`, `readAmendment`, `readSupervisor`, `readSettled`, `readCovering` and `readGuards`, each a function [M4].

**Stale-if:**
- path-absent: `factory/judge.mjs`

### Task 3: Jev is shown the hunks that carry a clause's own words, not the head of the patch

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/hunks.mjs`
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_hunks.mjs`

**Claim:** When a patch is too long to show Jev whole, Jev sees the parts of it that mention what the task's clauses name, whole, ahead of the parts that do not — so a large patch is read on the lines that matter and not on whichever came first. (derived)
Machine: M1. `literalsOf(clauses)` answers, in order and deduplicated, every backticked span of the clause texts that is at least 3 characters long, verbatim. M2. `hunksCarrying(diffText, literals, cap)` splits a unified diff into file sections — each beginning at a `diff --git ` line, or at the start of the text when it begins with none — and each section into a header (everything before its first line beginning `@@ `) and hunks (each beginning at such a line); it answers one string built from whole hunks only: first every hunk containing at least one literal, in original order, then the rest in original order, each kept hunk preceded by its section's header exactly once, stopping before the first hunk that would take the string past `cap` characters; when any hunk was left out the string ends with a final line `(<n> hunks omitted)` with `<n>` the count, which is outside the cap; a text that already fits in `cap` is answered unchanged. M3. In `factory/engine.mjs`, `measure` hands `readLanding` `patch` as `hunksCarrying(<the patch text>, literalsOf(task.clauses), 20000)` and each `files.f<j>` as `hunksCarrying(<that file's diff>, literalsOf(task.clauses), 6000)`, where BASE handed it the first 20,000 and the first 6,000 characters.

**Authorized-by:** run-192's record (n=1 run, 8 tasks, 2026-09-18): the claim reading fell with patch size, 0.90 on the smallest patch and 0.32 on the largest, while per-clause coverage stayed at or above 0.88; map #1131

**Interfaces:**
- Consumes: none
- Produces: `hunksCarrying(diffText, literals, cap) -> string`
- Produces: `literalsOf(clauses) -> string[]`

**Context:** `factory/engine.mjs`'s `measure` captures a candidate's patch, splits it per file with `splitDiff(text)` (which answers each file's diff WITHOUT its `diff --git` line, so a per-file text begins with its `index`/`---`/`+++` lines — the "start of the text" section of M2), and asks the judge's `readLanding` with `patch: text.slice(0, 20000)` and `files` built from `perFile[n].slice(0, 6000)`. Those two slices are the defect: on a large patch Jev reads whatever file sorted first. The new module is pure string work with no import beyond the language. "Containing a literal" is a plain case-sensitive substring test over the hunk's text. Put the engine's new import on the line directly after the `./judge.mjs` import; a sibling task adds its own import after the `./board.mjs` line. The exam drives the two exports with literal diff strings, and for M3 drives `runEngine` with the fake rig of `fleet/tests/_engine_helpers.mjs` (`makeRepo`, a fake `worker` that writes a file into its `cwd`, a fake `judge` whose `readLanding` records its argument, a fake `sh`), and it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_hunks.mjs`
- Legs: (a) `literalsOf(['`runEngine(args)` answers `ok` and `x`', 'again `ok ` and `runEngine(args)`'])` deep-equals `['runEngine(args)', 'ok ']` [M1]; (b) for a two-file diff whose first file has hunks H1 and H2 and whose second has H3, each hunk about 400 characters and only H3 containing the literal `needle_fn`: with `cap` 100000 the answer equals the input exactly; with a `cap` that fits two hunks and their headers the answer contains H3 before H1, contains the second file's `diff --git ` line exactly once and before H3, does not contain H2's text, and its last line is `(1 hunks omitted)`; every `@@ ` line of the answer is followed by that hunk's complete original text; a per-file text with no `diff --git ` line keeps its `---`/`+++` header ahead of its first kept hunk [M2]; (c) on a rig drive whose fake worker writes a patch longer than 20,000 characters whose only hunk containing the task's backticked literal lies past character 20,000, the `patch` the fake `readLanding` received contains that literal and ends with a line matching `(<n> hunks omitted)`, and no `files` value it received is longer than 6,000 characters plus that one line [M3].

**Stale-if:**
- path-exists: `factory/hunks.mjs`

### Task 4: The parser names a plan's unguarded exam files

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Test: `tests/test_plan_parse.py`

**Claim:** The parser the sandbox runs can say which of a plan's exam files are guarded and which belong only to the run, so whoever publishes the run knows what to take out of the pull request. (derived)
Machine: M1. Every task object `plan_parse.py <plan.md>` prints — in `tasks` and in `launch_waves` — gains one field, `proofGuards`: the backticked paths of the Proof slot's `- Guard:` bullets, in order, deduplicated, and `[]` when there is none; the seven fields it had (`id`, `title`, `files`, `depends_on`, `proofTests`, `testCmd`, `interfaces`) are unchanged. M2. `plan_parse.py --unguarded <plan.md>` prints, one per line and nothing else on stdout, every implementation task's `proofTests` path that is not among that task's `proofGuards`, in document order, deduplicated, and exits 0; a plan with no such path prints nothing and exits 0; a plan the parser refuses exits 2 with the refusal on stderr, as without the flag. M3. Any argv that is neither `<plan.md>` nor `--unguarded <plan.md>` prints the usage line on stderr and exits 2.

**Authorized-by:** the hand commit on PR #1147 (seven unguarded exam files removed by hand because the factory boot has no strip step; 2026-09-18); `skills/ultrawrite/SKILL.md` §Proof (`- Guard:`)

**Interfaces:**
- Consumes: none
- Produces: `plan_parse.py --unguarded <plan.md>`

**Context:** `skills/ultrapowers/scripts/plan_parse.py` is the 574-line parser the factory engine runs in place of the old compiler; `_parse_task_body` reads the Proof slot's `- Test:` and `- Run:` bullets with `PROOF_TEST_BULLET` and `PROOF_RUN_BULLET`, skipping fenced lines, and `public_view` is the one place a task's printed fields are chosen. A `- Guard:` bullet names one of the Proof's own `- Test:` paths and means the exam file is merged with the task; an exam with no Guard belongs to the run's evidence record and must not reach the pull request. The parser does not validate that a Guard path is one of the Test paths — it reads what is written. The exam file `tests/test_plan_parse.py` already exists and already pins the task-object key set as `TASK_FIELDS`: this task's exam EXTENDS that file — its new legs grouped under a comment naming this task — and brings `TASK_FIELDS` to the eight fields; the file's existing helper that writes a plan already emits a `- Guard:` bullet for some tasks. It runs the parser as a subprocess.

**Proof:**
- Test: `tests/test_plan_parse.py`
- Guard: `tests/test_plan_parse.py`
- Legs: (a) for a plan whose task 1 Proof carries `- Test: `tests/test_a.py`` and `- Guard: `tests/test_a.py`` and whose task 2 Proof carries `- Test: `tests/test_b.py`` and no Guard, the printed task 1 has `proofGuards` `['tests/test_a.py']` and task 2 has `[]`, in `tasks` and in `launch_waves` alike, and every task object's key set is exactly the eight named [M1]; (b) `--unguarded` on that plan prints exactly `tests/test_b.py` and a newline, exit 0; on a plan where every Test path is guarded it prints nothing, exit 0; on a plan with no `### Task` heading it exits 2 with empty stdout [M2]; (c) `plan_parse.py` with no argument, with `--unguarded` alone, and with `--frobnicate x.md` each exit 2 with the usage line on stderr [M3].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_parse.py`

### Task 5: The boot takes the run's own exam files out of the pull request and keeps them in the record

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_factory_boot_exams.mjs`

**Claim:** A run's pull request carries the work and the exams the plan chose to keep; every other exam the run wrote is taken out before the push and kept with the run's evidence, where a reader can still find it. (derived)
Machine: M1. In `publish`, before the push of `HEAD` to the integration branch, the boot runs `python3 <engine checkout>/skills/ultrapowers/scripts/plan_parse.py --unguarded <plan file>` through a `fleet_python3` wrapper; for every printed path that is a regular file under `$TARGET_DIR` it copies the file to `$EVIDENCE_DIR/$EVIDENCE_REL/exams/<path>` and removes it from the target with `git rm`; after at least one removal it makes exactly one commit in `$TARGET_DIR` whose subject is `<RUN_ID>: exams to evidence`, and that commit is made before the push. M2. `evidence_commit` adds `$EVIDENCE_REL/exams` whenever that directory exists, so the copies are on the evidence branch by the `publishing` commit. M3. When the listing command exits non-zero, prints nothing, or names no path that is a file in the target, the boot logs exactly one line beginning `exams:`, makes no commit in the target, and pushes as at BASE; in every case the run's final state and the boot's exit code are what they are without this step.

**Authorized-by:** the hand commit on PR #1147 (2026-09-18: seven unguarded exam files removed by hand; one of them flaky on the laptop and three printing a sentinel the suite bridge does not read); `skills/ultrawrite/SKILL.md` §Proof ("An exam with no `Guard:` lives instead on the run's evidence tag … and publish strips it from the pull request")

**Interfaces:**
- Consumes: none
- Produces: `factory/boot.sh boot`

**Context:** `factory/boot.sh` reaches every external program through a `fleet_*` wrapper (`fleet_git`, `fleet_curl`, …) so an exam can stub it on `PATH`; add `fleet_python3() { python3 "$@"; }` beside them. `publish` today pushes `HEAD:refs/heads/$BRANCH` from `$TARGET_DIR` as its first act, then writes the `publishing` status and calls `evidence_commit`, which adds only `status.json`, `events.jsonl` and `engine.log` under `$EVIDENCE_REL`, by name — never `git add -A`. `$ENGINE_REPO_DIR` is the engine checkout, `$PLAN_FILE` the plan, `$RUN_ID` is `run-<N>`; `ensure_git_identity` must have run before a commit. The engine's adopted patches carry each task's exam files because the exam is copied into the implementer's clone and the patch is an `add -A`; that is how they reach `$TARGET_DIR`. The listing's format, fixed by a sibling task: one repository-relative path per line on stdout, nothing else, exit 0; an empty stdout is a plan with nothing to strip. The script runs under `set -u` on bash 3.2 (the laptop) and bash 5 (the sandbox): an empty array is expanded as `${arr[@]+"${arr[@]}"}`. The exam is the stub-on-`PATH` shape run-187's boot exam used: a temporary `FLEET_HOME`; stubs for `curl`, `git`, `npm`, `claude`, `systemd-run`, `systemctl`, `node`, `python3`, `tar`, `sha256sum` and `kata` placed first on `PATH`, each appending its argv to a log file under `FLEET_HOME`; `FLEET_ASSIGNMENT` set to `run=7 plan=<40 hex> target=acme/t base=<40 hex> engine=<40 hex>`; `FLEET_COMMIT_SECONDS=1` and `FLEET_KATA_WAIT_SECONDS=1`; the stub `git rev-parse HEAD` in the target answering a sha other than base so the run reaches `publish`; the exam itself creating the files the stub `python3` lists under `<FLEET_HOME>/target/`; `env: simEnv(...)` from `fleet/tests/_helpers.mjs`, never `process.env`. It asserts on recorded argv order and on files on disk, never on timing, and prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_boot_exams.mjs`
- Legs: (a) with the stub `python3` printing `fleet/tests/test_x.mjs` and `tests/test_gone.py`, only the first existing under the target: the stub `python3` saw `<engine checkout>/skills/ultrapowers/scripts/plan_parse.py --unguarded <plan file>`; `<FLEET_HOME>/evidence/.ultrapowers/runs/7/exams/fleet/tests/test_x.mjs` holds the file's bytes; the stub `git` log shows, in the target, an `rm` naming `fleet/tests/test_x.mjs`, then exactly one `commit` whose message is `run-7: exams to evidence`, then the `push origin HEAD:refs/heads/` line, in that order, and no `rm` naming `tests/test_gone.py` [M1]; (b) on that drive the stub `git` log shows an `add` in the evidence worktree naming `.ultrapowers/runs/7/exams` before the evidence commit whose message is `run-7: publishing` [M2]; (c) for each of: the stub `python3` exiting 1, and the stub printing nothing — the boot log carries exactly one line beginning `exams:`, the stub `git` log shows no `commit` in the target and still shows the push, and the final `status.json` state and the boot's exit code equal those of drive (a) [M3].

**Stale-if:**
- path-absent: `factory/boot.sh`

### Task 6: The gate text says a negation is always a leg

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`

**Claim:** An author and a gate reader are both told that a clause saying something is absent, unchanged or exactly so many always needs a leg of its own, because the model that reads the diff at landing cannot see what is not there. (derived)
Machine: M1. In `skills/ultrawrite/SKILL.md` §The proof gate, the quoted reader question gains one sentence saying that a negation or absence clause is always a computable fact and always needs a leg, because the run-time reader cannot see absence. M2. In `skills/ultrawrite/references/authoring-gotchas.md`, the existing row on the gate's recurring rejection species gains that rule with its reading — run-192, two negation clauses read 0.19 and 0.40 by Jev where both exams passed (n=1 run, 8 tasks, 2026-09-18) — and the rows between `## The sixteen rows` and `## Three older lessons` still number exactly 16. M3. `skills/ultrawrite` still validates.

**Authorized-by:** run-192's record (n=1 run, 8 tasks, 2026-09-18): "Jev cannot see absence"; CLAUDE.md "Verification is mechanical and fast"

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The facts-only reader question sits in `skills/ultrawrite/SKILL.md` §The proof gate as a markdown blockquote (lines beginning `> `), and says a clause that only states what the code says is judged at run time by a model reading the diff. Run-192 showed the one place that division fails: a clause such as "the enumerable keys are still exactly three" or "none of these four words appear" is a fact about absence, the diff shows nothing for it, and Jev scored the two such clauses 0.19 and 0.40 on patches whose exams proved them. So the rule is one sentence inside the blockquote, in the question's own register. In the gotchas file the rule joins the existing bullet that begins "The gate's recurring rejection species" — it does NOT become a new row, because `tests/test_compile_plan_exam_sweep.py` pins the count of rows under `## The sixteen rows` at exactly 16. Keep each file's register: a rule, its reason, and the run that paid for it. On the factory these two files are judged by Jev over their clauses; the `Run:` lines below are the reviewer's reading.

**Proof:**
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure/p' skills/ultrawrite/SKILL.md | grep '^>' | tr '\n' ' ' | grep -qiE 'negation[^.]*always[^.]*leg|negation[^.]*leg[^.]*always'
- Run: sed -n '/^## The sixteen rows/,/^## Three older/p' skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -qiE 'negation.*run-192|run-192.*negation'
- Run: test "$(sed -n '/^## The sixteen rows/,/^## Three older/p' skills/ultrawrite/references/authoring-gotchas.md | grep -c '^- \*\*')" = 16
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Legs: (a) the first `Run:` establishes the sentence is inside the quoted question and joins negation, always and leg [M1]; (b) the second establishes the gotchas rows name the rule with run-192, and the third that the rows still number 16 [M2]; (c) the fourth exits 0 only when the skill validates [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/authoring-gotchas.md`

### Task 7: The engine selects — the examiner is told what is already proven, and every landing runs the few tests its patch touches

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Modify: `factory/roles/exam.md`
- Test: `fleet/tests/test_factory_engine_select.mjs`

**Claim:** Before an exam is written the examiner is told which clauses an existing test already proves; after a candidate is measured the engine runs the few existing tests Jev picked for its patch, and a test that was green before the patch and red after it is on the task's issue at once and buys the landing its one more attempt; with the switch off the engine is what it was. (derived)
Machine: M1. When `policy.select.enabled` is true and the judge answers `readCovering`, then before a task's exam worker is dispatched the engine lists the tracked files of the exam clone with its own `git ls-files`, calls `candidateTests` with `paths` the task's implementation files, `symbols` `symbolsOf(task.clauses)`, `exclude` the task's `proofTests` and `cap` `policy.select.max_candidates`, asks `readCovering` once with each candidate's first 6,000 characters, appends `{ kind: 'select:exam', task, candidates, covered }` to `events.jsonl` (`candidates` the paths, `covered` one path or `null` per clause), and the exam prompt carries, directly after its `TEST COMMAND:` line, a block `\n\nCOVERED:\n` followed by one line `M<n>: <path>` per covered clause; with no clause covered the prompt carries no `COVERED:` block, and with no candidates the judge is not asked. M2. After the best candidate is selected and its landing posted, the engine calls `candidateTests` with `paths` the paths its patch touches, `symbols` the names `candidatesOf` reads off the patch, and the same `exclude` and `cap`; asks `readGuards` once with `patch` `hunksCarrying(<patch text>, <those names>, 20000)`; forms the run set — the task's covering tests first, then `selected`, deduplicated, at most `policy.select.max_run` — and runs each through `sh` in the candidate's clone with `commandFor(path, policy.select.timeout_seconds)`; it appends `{ kind: 'select:landing', task, candidates, selected, ran }` with `ran` an array of `{ path, exit }`. M3. For each run-set test that exits non-zero in the candidate's clone the engine runs the same argv in a clone at the landing's anchor: non-zero there as well appends `{ kind: 'select:red-at-base', task, path }` and posts nothing; zero there appends `{ kind: 'catch', task, path, exit }` and calls `board.post(task.id, 'catch', <text>)` with text carrying the path, the exit code and the last 1,500 characters of the test's output. M4. A landing with at least one catch is short: with `policy.landing.redispatch.enabled` true it gets the one re-dispatch even when its exam exited 0 and its coverage is above the floor; after that re-dispatch the run set is run and read again the same way; no task ever has a third implementer dispatch. M5. `runEngine` reads the policy document from `args.policy` when given, else from `POLICY_PATH`; with `select.enabled` false, or a judge answering neither reader, the engine appends no row whose kind begins `select:` or is `catch`, no prompt carries `COVERED:`, and `sh` is never called with `timeout` as its command. M6. `factory/roles/exam.md` tells the examiner that a `COVERED:` block names clauses an existing test already establishes, that it writes no leg for those, and that its hand-in note names each covering test beside the clause.

**Authorized-by:** #1133 (the examiner selects before it generates; "the examiner's brief lists the clauses already covered with their test paths, asking for the missing legs only"; rollback: delete the pre-dispatch read); CLAUDE.md "Verification is mechanical and fast" (code supplies the candidate tests a patch touches, Jev selects, the engine runs those few); the operator's picks of 2026-09-18: both halves live behind one switch, and a catch counts as a short landing

**Interfaces:**
- Consumes: `candidateTests({ files, read, paths, symbols, exclude, cap }) -> Promise<Array<{ path, hits }>>`
- Consumes: `readCovering({ clauses, tests }) -> Promise<{ covered, scores } | null>`
- Consumes: `hunksCarrying(diffText, literals, cap) -> string`
- Produces: `runEngine(args, deps) -> Promise<{ done, adopted, head, wall_ms, cost_usd }>`

**Context:** `factory/engine.mjs` at the head this task starts from: `land(task, anchor)` clones the anchor as `exam-<id>`, dispatches the exam worker with `examPrompt(task)` (`TASK:`, `EXAM FILES:`, `TEST COMMAND:`, `INTERFACES:`, then any `SETTLED:` lines, then the `HAND-OFF:` block `withHandoff` adds), dispatches `k` implementers, measures each with `measure`, selects the best, calls `postLanding`, parks a worker that died without a patch, then decides `short` — a red exam, or a lowest coverage under `policy.landing.redispatch.coverage_floor` — and when `redispatch.enabled` dispatches exactly one more implementer labelled `impl:<id>:redispatch` in the same clone and measures again; then the referee. This task adds the two selection points and one more reason to be short. The siblings it builds on: `factory/select.mjs` exports `candidateTests` (pure; give it the `git ls-files` lines and a `read` over the clone; it answers `[{ path, hits }]`, already capped), `symbolsOf(clauses)` and `commandFor(path, seconds)` (an argv array beginning `timeout`, or `null` for a path it cannot run — skip those); `factory/hunks.mjs` exports `hunksCarrying`; the judge answers `readCovering({ clauses, tests }) -> { covered, scores } | null` and `readGuards({ patch, tests }) -> { selected, scores } | null`, `tests` an array of `{ path, text }`; `factory/policy.json` carries `select` `{ enabled, t_covers, t_guards, max_candidates: 8, max_run: 3, timeout_seconds: 300, … }`. Every judge call goes through the engine's `read(name, arg)`, which answers `null` for a reader that is absent or throws, and a `null` selects nothing. `sh(cmd, argv, cwd)` is the seam a sim fakes; call it as `sh(argv[0], argv.slice(1), dir)` and read its exit with `exitOf`. The anchor clone for M3 is made lazily with `cloneAt('base-' + task.id, anchor)`, once per task, only when a run-set test is red. The kernel's fold also goes through `sh` (as `python3`), so a selected test's call is told apart by its command, `timeout`. A worker that died without a patch parks before any landing selection is made. A catch never parks a task and never blocks adoption: the landing is adopted as before and the catch stays on the issue and in `events.jsonl`. Put this task's new imports on the line directly after the `./board.mjs` import. `[catch]` is a fact kind like the board's others: `board.post` brackets whatever kind it is given, and `makeBoard({})` resolves every call, so no call site needs a guard. The engine's exports and its resolved answer's five keys stand. The exam is the fake-driven rig of `fleet/tests/_engine_helpers.mjs` (`makeRepo` with a fixture tree that holds real test files for the real finder to find; a fake `worker`; a fake `judge` with configured `readCovering` and `readGuards` that record their arguments; a fake `sh` that records `(cmd, argv, cwd)` and answers a configured exit per path and per directory; a fake board recording `post`), a policy copy handed in as `args.policy`, and it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_engine_select.mjs`
- Run: grep -q 'COVERED:' factory/roles/exam.md
- Legs: (a) on a fixture repository holding `tests/test_catalog.py` whose text names the task's backticked symbol, with the fake `readCovering` answering `covered` `['tests/test_catalog.py', null]` for a two-clause task: the fake saw `tests` whose one entry has that path and a `text` at most 6,000 characters long, `events.jsonl` carries a `select:exam` row with `candidates` `['tests/test_catalog.py']` and that `covered`, and the exam worker's prompt contains `TEST COMMAND:` followed directly by `\n\nCOVERED:\nM1: tests/test_catalog.py` and no `M2:` line; with `covered` `[null, null]` the prompt contains no `COVERED:`; on a fixture with no test file the fake `readCovering` was never called [M1]; (b) with the fake worker writing `src/catalog.py` and the fake `readGuards` answering `selected` `['tests/test_catalog.py', 'tests/test_b.py']`, a covering test `tests/test_cover.py` for the task and a policy copy whose `select.max_run` is 2: the fake `readGuards` was called once with a `patch` string and `tests` entries of `{ path, text }`, the recorded `sh` calls whose command is `timeout` are, in the candidate's clone and in this order, exactly `timeout 300 python3 -m pytest -q tests/test_cover.py` and `timeout 300 python3 -m pytest -q tests/test_catalog.py`, and none names `tests/test_b.py`, and the `select:landing` row's `ran` deep-equals `[{ path: 'tests/test_cover.py', exit: 0 }, { path: 'tests/test_catalog.py', exit: 0 }]` [M2]; (c) with the fake `sh` answering exit 1 for `tests/test_catalog.py` in the candidate's clone and 0 in a directory whose name begins `base-`: `events.jsonl` carries `{ kind: 'catch', path: 'tests/test_catalog.py', exit: 1 }` for the task and the fake board recorded `post(<task>, 'catch', <text containing the path and the test's output tail>)`; with exit 1 in both directories there is a `select:red-at-base` row, no `catch` row and no `catch` post [M3]; (d) on drive (c)'s first case, with the task's own exam exiting 0 and coverage `[0.9, 0.9]`, the dispatch labels for the task contain exactly two beginning `impl:`, the second being `impl:<id>:redispatch`, and the fake `sh` saw the selected test's argv in the candidate's clone twice; with the test still red after the re-dispatch there are still exactly two such labels and the task is adopted; with `landing.redispatch.enabled` false in the policy copy there is one [M4]; (e) with a policy copy whose `select.enabled` is false, and again with a fake judge that has neither reader: no row of `events.jsonl` has a kind beginning `select:` or equal to `catch`, no recorded prompt contains `COVERED:`, and no recorded `sh` call has `timeout` as its command [M5]; (f) the `Run:` line establishes the examiner's brief names the `COVERED:` block [M6].

**Stale-if:**
- path-absent: `factory/engine.mjs`
