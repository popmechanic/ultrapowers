# The fold parses and examines before the suite

**Grammar:** claims-v1

**Claim:** After a fold with joins, I see the receipt name a joined path that does not parse or an exam that went red before any full suite ran, and a resolver's brief carries the sibling's task body whenever the joined path's frontier commit is one of ours. (elicited)

**Goal:** #751 and #754 — the two mechanical lessons of run-44 (2026-09-07, the first live fold
with joins, #715 decision 10). The fold joined four paths, dispatched four resolvers, then spent a
six-minute suite run to learn that `fleet/tests/test_retire.mjs` did not parse (both plans had
added the same top-level `const REPO_ROOT` and the resolver kept both), and after that a second
six-minute run to learn that the same file's own sim disagreed about one fixture — a fact the
joined file's exam would have said in thirty seconds. After this run the fold checks each joined
path parses (`node --check` / `bash -n` / `python3 -m py_compile` by extension) and then runs the
exams that name a joined path, before it spends the whole suite; a red check re-dispatches that
path's resolver once with the checker's message in its brief, and a second red is a disposition
that names the path (`cannot fold` / `<path> does not parse`, `suite red` / `<exam> red on
<path>`) with no suite run. (#754's second move — the brief carrying the sibling's Proof legs — is
dropped: the resolver brief already embeds each contending task's whole body, Proof slot included.
Run-44's briefs carried no frontier body at all for a different reason — `planTasksFor` compiles
the tag's `plan.md` without the tag's `gate-verdicts.json` beside it, so every claims-v1 frontier
plan renders as `no plan` — and that is #757, Task 3 of this plan.)
**Closes:** #751 #754 #757

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); the kernel is `skills/ultrapowers/kernel/fold_wave.py`
(sha-pinned, never patched). The two sims are real all the way down — a bare origin, two clones,
the kernel driven for real, the resolver a stub injected through `deps.makeAgent`, every
subprocess through a recording `deps.exec` around `execSeam` — no network. The suite is
`python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs` through
`tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file).

**Exam command:** node {paths}

**Parallelization rationale:** two waves — wave 1 width 2, wave 2 width 1. Wave 1 is Task 1 (the
parse check and the one-retry re-dispatch, in `fleet/publish-fold.mjs`) beside Task 3 (the tag's
record laid beside its plan in `fleet/publish-fold-block.mjs`): they share only `fleet/CONTRACT.md`,
in three different bullets, and same-file text folds. Wave 2 is
Task 2 alone (exams first), which consumes Task 1's `CANDIDATE_CHECKS`: the exam check has to ride the same one-retry loop — the refold that replays
every other conflict's saved reply and re-dispatches only the red path's resolver — and that loop is
runtime behaviour no literal can promise; two strangers each writing it into one function would be
the collision, so the wait is the cheaper of the two. The chain is one edge long; Task 2 also
modifies `fleet/publish-fold-block.mjs` after Task 3, but it needs nothing of Task 3 — it lifts the
walk around `planTasksFor` and leaves that function as the wave-1 tree has it.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/sandbox-boot.sh fleet/run-engine.mjs fleet/run-waves.mjs fleet/roles skills/ultrapowers/kernel`
- The kernel, the boot script, the resolver role and the wave loop are unchanged (the Check
  above): the fold's CLI argv is BASE's, `resolveConflicts` is called, never edited, and every
  new command — `node --check`, `bash -n`, `python3 -m py_compile`, `node <exam>`, the refold —
  is the driver's own `exec`. Amendment 10 holds: the only model the fold dispatches is the
  read-only resolver role answering through `RESOLVER_SCHEMA`.
- The receipt's disposition vocabulary is still the six words of BASE (`folded`, `nothing to
  join`, `tip unmoved`, `suite red`, `conflict parked`, `cannot fold`); the new outcomes are
  reasons under two of them, never a seventh word, so `fold_phrase` and `fold_hold_note` in the
  boot script read them without change.
- No committed sim compares the tree to BASE, reads `ULTRA_BASE`, or embeds a 40-hex commit sha.
- Every assertion that stands at BASE in `fleet/tests/test_publish_fold.mjs` and
  `fleet/tests/test_publish_fold_block.mjs` still holds, except the ones a task's Context names as
  re-scoped with what replaces them; the new legs sit under a comment naming their task, in the
  region the task's Context names.
- `fleet/CONTRACT.md` is the authority for every literal: a receipt field, a file name or a reason
  text this plan adds is written there by the task that adds it, and no other document names a
  mechanism that is not there (`tests/test_docs_agree_with_code.py` is the lens; Task 1 runs it).

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The fold checks each joined path parses before it spends the suite

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/publish-fold.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_publish_fold.mjs`

**Claim:** After the resolvers reply and before the candidate's suite, `fleet/publish-fold.mjs` runs a parse check on every joined path by extension — `node --check` for `.mjs`/`.js`, `bash -n` for `.sh`, `python3 -m py_compile` for `.py` — and a failing path re-dispatches that path's resolver once with the parser's message in the brief; a second failure is `disposition: cannot fold` with `reason: <path> does not parse` in the receipt and the `driver:publish-fold` event, and no suite is run. (quoted from #751)
Machine: M1. After the kernel's `materialize` and before any `bash -lc <testCmd>` suite,
`publishFold` runs, in the integration clone laid on the candidate's tree, one parse command per
joined path (the paths in both `main.patch` and `run.patch`, in `run.patch`'s path order) — the argv `parseArgvFor(path)` returns: `['node', '--check', path]` for
`.mjs`/`.js`, `['bash', '-n', path]` for `.sh`, `['python3', '-m', 'py_compile', path]` for
`.py`, and `null` for every other extension, for which nothing is run — and appends one
`{ check: 'parse', path, result: 'pass' | 'fail' }` to the receipt row's `checks` array per
command run.
M2. A path whose parse command exits non-zero, that has an entry in the wave's conflicts index
and has not been retried in this attempt, is re-dispatched exactly once: the wave is folded again
from a fresh wave directory, every other conflict's reply is replayed by the driver from the
saved reply directory (matched by path) with no dispatch, and the red path's resolver is
dispatched with a prompt that begins with its first brief and ends with a
`PREVIOUS RESOLUTION FAILED A CHECK` section naming the path and carrying the parser's stderr
tail; that prompt is saved as `resolver-brief-<i>-<attempt>-retry.txt`, the retried wave
directory is kept in the evidence tree as `frontier/wave-<attempt>-retried/`, the row's
`checkRetries` is 1, and a second candidate that parses goes on to the suite and ends `folded`
on a green one.
M3. A path that fails its parse command after a retry, or a failing path with no conflicts-index
entry, ends the attempt with `disposition: 'cannot fold'`, `reason: '<path> does not parse'` and
`suite: 'none'` in the receipt row and in the `driver:publish-fold` event (which gains `reason`,
`checks` and `checkRetries`), no `bash -lc` suite is run, and `refs/heads/<branch>` stays on the
candidate so the pull request shows the file that failed.
M4. `fleet/CONTRACT.md`'s `publish-fold/` receipts sentence names `checks`, `checkRetries`,
`resolver-brief-<i>-<attempt>-retry.txt` and `frontier/wave-<attempt>-retried/`, and its
dispositions sentence carries the phrase `does not parse`.

**Authorized-by:** #751 (map #727, Determinism Ratchet: a parse check is a function of the joined
file alone — no model, no suite); `fleet/CONTRACT.md` §Literals (the `publish-fold/` receipts
directory and the fold's dispositions).

**Interfaces:**
- Consumes: none
- Produces: `CANDIDATE_CHECKS`
- Produces: `parseArgvFor(path: string) -> string[] | null`

**Context:** The seam this task builds and Task 2 extends, as one literal both Contexts carry:
`export const CANDIDATE_CHECKS = [PARSE_CHECK]` in `fleet/publish-fold.mjs`, an ordered array of
`{ name, run }`; the folder runs each `run(ctx)` in order on every candidate, where `ctx` is
`{ repo, base, tip, run, tasks, candidate, joined, conflicted, integ, exec, foldEvidence, attemptKey }`
(`joined` the ordered joined paths, `conflicted` the paths with a `conflicts.json` entry, `integ`
the integration clone already laid on the candidate's tree, `tasks` this run's `launch.json`
tasks), and `run` resolves `{ ok: true, checks }` or
`{ ok: false, checks, path, message, disposition, reason }` — the folder appends `checks` to the
row either way and on `ok: false` either retries (the `path` is in `conflicted` and unretried
this attempt) or records `disposition` and `reason`. The parse check's `disposition` is
`cannot fold`, its `reason` `<path> does not parse`, its `message` the parser's stderr tail. A
retry re-runs the whole check list from the first entry on the new candidate, and a path is
retried at most once per attempt across every check.
Why the retry is a refold and not a second `resolve`: the kernel refuses a re-issued `resolve`
on an applied conflict — `cmd_resolve` in `skills/ultrapowers/kernel/fold_wave.py` prints
`{"applied": false, "stale": true}` and exits 2 (its idempotency guard, read on the laptop
2026-09-07) — and `cmd_fold` refuses a wave whose `fold_log.jsonl` exists. So the licensed shape
is: copy the wave directory to `frontier/wave-<attempt>-retried/` in the evidence tree, remove
it from the run tree, `fold` again with BASE's argv (the kernel is deterministic over the same
two patches: same conflicts, same paths; match by `path`, never by `i`), and drive
`resolveConflicts` with an `agent` that answers a conflict on any path but the red one from the
saved `reply-<i>-<n>/` directory — `hunks` = one `{ id, content }` per `<id>.txt`, `notes` =
`notes.txt` — without dispatching, and dispatches the red path's resolver through the same
`buildAgent()` dispatch as the first pass, with the section appended after the contending block.
`resolversDispatched` counts real dispatches only (2 on a retried single-conflict fold), and the
event's `resolverRetries` keeps its BASE meaning (kernel-REJECTED replies) — `checkRetries` is the
new counter. The first pass's brief for `<i>` is saved as `resolver-brief-<i>-<attempt>.txt`
exactly as at BASE; the retry's is `resolver-brief-<i>-<attempt>-retry.txt`, a name the BASE leg
(g)'s regex `/^resolver-brief-\d+-1\.txt$/` does not match, so that leg's "exactly one" stands.
The candidate's tree is laid in the integration clone by BASE's step 6 (`fetch --no-tags` by
branch name, `read-tree -u --reset <candidate>^{tree}`); the checks run there before the suite,
and they run even when `args.json` carries no `testCmd` (the suite then stays `none` and the
disposition is `folded` on green checks). On a parse red the branch is already on the candidate
(BASE moves it before the suite) and stays there, as a `suite red` does. The measured parser
lines (rule 5, read on the laptop 2026-09-07, Node v24): `node --check` on a file declaring
`export const A` twice exits 1 with `SyntaxError: Identifier 'A' has already been declared` on
stderr; `bash -n` on `if true; then echo x` with no `fi` exits 2 with `syntax error: unexpected
end of file`; `python3 -m py_compile` on `def f(:` exits 1 with `SyntaxError: invalid syntax`.
The receipt row, whole, after this task:
`{ tip, candidate, pushedHead?, disposition, reason?, path?, pathsJoined, resolversDispatched, suite, checks, checkRetries }`
— `checks` is `[]` and `checkRetries` 0 on a fold with no joined path, and both are absent from
the replayed row of a re-entry only when the row on disk lacks them. The `driver:publish-fold`
event gains `reason` (absent when the row has none), `checks` and `checkRetries` beside BASE's
fields.
The exam file is `fleet/tests/test_publish_fold.mjs`, whose template (`buildTemplate`) seeds the
BASE tree; this task adds two files to it — `mod.mjs`, ten lines `export const l<n> = <n>` for
n = 1..10, and `mod.py`, ten lines `l<n> = <n>` — both in the `write(target, …)` list and in the
maker clone's orphan-branch `rmSync` list (which enumerates every seeded file by name), and it
adds moves to `MOVES` / `RUN_EDITS` for them; neither side of any BASE case touches them, so
every BASE case's patches, `pathsJoined` and dispositions are what they were. The new legs sit
in one block headed `// #751 Task 1 — the parse check`, placed immediately after leg (i)'s
closing brace and before the `console.log('ALL TESTS PASSED')` line; Task 2's block goes after
this one in a later wave. The stub resolver is `stubAgent(reply)` with `reply(nth, prompt)`, so
the first and second replies of one case are the same stub's `nth`; the recorder's `calls`
carry `cmd`, `argv`, `cwd` in call order, and `kernelCalls(rec)` the kernel verbs in order. Two
CONTRACT sentences change and nothing else in that file: the receipts sentence under §Literals
(`The publish fold writes its own `publish-fold/` receipts directory … `publish-fold-<attempt>.log`.`)
gains `checks`, `checkRetries`, the retry brief name and the retried wave directory; the
dispositions sentence in the boot-script bullet (`Its disposition is one of `folded`, …`) gains
the two check reasons — `cannot fold` with `<path> does not parse`, and (for Task 2 to fill)
`suite red` with `<exam> red on <path>`. `tests/test_docs_agree_with_code.py` pins none of those
sentences but reads the file's other literals, so the edit must leave them in the shape it reads.
**BASE facts:** (generated at 9395cd1)
- `fleet/publish-fold.mjs` blob 024f6f5
- `materialize` at `skills/ultrapowers/kernel/repo_weave.py:521` blob c9856c0
- `publishFold` at `fleet/publish-fold.mjs:89` blob 024f6f5
- `checks` at `fleet/run-engine.mjs:1274` blob 8694de1
- `reason` at `fleet/run-engine.mjs:633` blob 8694de1
- `fleet/CONTRACT.md` blob 486545c
- `ctx` at `fleet/tests/test_fleet_bootstrap.mjs:143` blob c7f9cba
- `joined` at `fleet/tests/test_janitor.mjs:1082` blob 6703100
- `integ` at `fleet/publish-fold.mjs:106` blob 024f6f5
- `tasks` at `fleet/fitness.mjs:112` blob 1cb6825
- `run` at `fleet/doctor.mjs:719` blob f9a1174
- `resolve` at `fleet/tests/test_run_engine_exam_together.mjs:138` blob f7ae858
- `cmd_resolve` at `skills/ultrapowers/kernel/fold_wave.py:1096` blob 41e5474
- `skills/ultrapowers/kernel/fold_wave.py` blob 41e5474
- `cmd_fold` at `skills/ultrapowers/kernel/fold_wave.py:987` blob 41e5474
- `fold` at `fleet/publish-fold.mjs:447` blob 024f6f5
- `i` at `fleet/run-engine.mjs:53` blob 8694de1
- `resolveConflicts` at `fleet/run-engine.mjs:567` blob 8694de1
- `agent` at `fleet/publish-fold.mjs:520` blob 024f6f5
- `notes` at `fleet/doctor.mjs:321` blob f9a1174
- `resolversDispatched` at `fleet/publish-fold.mjs:490` blob 024f6f5
- `resolverRetries` at `fleet/publish-fold.mjs:491` blob 024f6f5
- `testCmd` at `fleet/publish-fold.mjs:572` blob 024f6f5
- `none` at `fleet/tests/test_launch.mjs:934` blob 1f6c236
- `fleet/tests/test_publish_fold.mjs` blob bb75648
- `buildTemplate` at `fleet/tests/test_publish_fold.mjs:134` blob bb75648
- `MOVES` at `fleet/tests/test_publish_fold.mjs:384` blob bb75648
- `RUN_EDITS` at `fleet/tests/test_publish_fold.mjs:443` blob bb75648
- `pathsJoined` at `fleet/publish-fold.mjs:431` blob 024f6f5
- `nth` at `fleet/tests/test_sandbox_boot.mjs:1033` blob 120c765
- `calls` at `fleet/run-engine.mjs:1622` blob 8694de1
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `argv` at `fleet/janitor.mjs:183` blob c8d8258
- `cwd` at `fleet/confine-hook.mjs:208` blob e0cd408
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `suite` at `fleet/publish-fold.mjs:585` blob 024f6f5
- `bash` at `fleet/tests/test_confine_hook.mjs:177` blob 05bbf3e
- `candidate` at `fleet/publish-fold.mjs:299` blob 024f6f5
- `RESOLVED_H1` at `fleet/tests/test_publish_fold.mjs:459` blob bb75648

**Proof:**
- Test: `fleet/tests/test_publish_fold.mjs`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`
- Run: `bash -c 'grep -q "does not parse" fleet/CONTRACT.md && grep -q checkRetries fleet/CONTRACT.md && grep -q "wave-<attempt>-retried" fleet/CONTRACT.md && grep -q "resolver-brief-<i>-<attempt>-retry.txt" fleet/CONTRACT.md'`
- Legs, under `// #751 Task 1 — the parse check`: (a) `parseArgvFor` answers, for each of
  `x/a.mjs`, `x/a.js`, `x/a.sh` and `x/a.py`, exactly `['node', '--check', <path>]`,
  `['node', '--check', <path>]`, `['bash', '-n', <path>]` and `['python3', '-m', 'py_compile', <path>]`,
  and exactly `null` for `x/a.txt` and `x/a.md` [M1]; (b) the retried `.mjs` fold — main rewrites
  `mod.mjs` line 2 to `export const l2 = 20`, the run rewrites it to `export const l2 = 2000`, the
  stub's first reply keeps both lines (a duplicate declaration) and its second reply is
  `export const l2 = 2020`: the stub was dispatched exactly twice; the second prompt starts with
  the first prompt's bytes and, after the contending block, contains
  `PREVIOUS RESOLUTION FAILED A CHECK`, `mod.mjs` and `already been declared`;
  `resolver-brief-<i>-1-retry.txt` (with `<i>` read from the wave's conflicts index) holds exactly the
  second prompt's bytes and `resolver-brief-<i>-1.txt` the first's; the recorder shows exactly two
  `node --check mod.mjs` calls with `cwd` the integration clone, each after a `materialize` and
  the first before the second `fold`, and one `bash -lc` call after the second; the row has
  `disposition` `folded`, `suite` `pass`, `checkRetries` 1, `resolversDispatched` 2 and `checks`
  exactly `[{ check: 'parse', path: 'mod.mjs', result: 'fail' }, { check: 'parse', path: 'mod.mjs', result: 'pass' }]`;
  the candidate's `mod.mjs` line 2 is `export const l2 = 2020` and the candidate's only parent is
  TIP; `frontier/wave-1-retried/` in the evidence tree holds a `reply-<i>-1/` directory and
  `frontier/wave-1/` holds the second pass's [M1][M2]; (c) the same fixture with both replies
  keeping both lines: `disposition` `cannot fold`, `reason` `mod.mjs does not parse`, `suite`
  `none`, `checkRetries` 1, two dispatches, no recorded call whose `cmd` is `bash` and whose first
  argument is `-lc`, the last `driver:publish-fold` event carrying the same `disposition`, `reason`,
  `suite` and a two-entry `checks`, and `refs/heads/<branch>` equal to the row's `candidate` [M3];
  (d) the no-resolver row — main appends `export const l11 = 11` as an eleventh line of `mod.mjs`
  and the run rewrites line 1 to `export const l11 = 1111`, with `noAgent()` (any dispatch throws):
  the fold completes without a conflict, one `node --check mod.mjs` call is recorded, the row is
  `cannot fold` / `mod.mjs does not parse` / `suite` `none` / `checkRetries` 0 /
  `resolversDispatched` 0, and no `bash -lc` call is recorded [M1][M3]; (e) the `.sh` row live, over two joined
  paths — main and the run rewrite line 2 of both `mod.mjs` and `tool.sh` differently in the same
  commits (two conflicts), the stub answers `mod.mjs`'s hunk with `export const l2 = 2020` and
  `tool.sh`'s with `if true; then echo tool` every time: the parse commands recorded, in order,
  are `node --check mod.mjs`, `bash -n tool.sh`, `node --check mod.mjs`, `bash -n tool.sh`, all
  with `cwd` the integration clone; `checks` is exactly `[{ check: 'parse', path: 'mod.mjs', result: 'pass' }, { check: 'parse', path: 'tool.sh', result: 'fail' }, { check: 'parse', path: 'mod.mjs', result: 'pass' }, { check: 'parse', path: 'tool.sh', result: 'fail' }]`
  — a folder that checks only the first joined path records no `tool.sh` entry and fails it; the
  stub was dispatched exactly three times, once with a label for `mod.mjs`'s `<i>` and twice for
  `tool.sh`'s (`mod.mjs`'s reply was replayed, not re-asked), the retry prompt names `tool.sh` and
  carries `syntax error`, the second pass's `frontier/wave-1/reply-<i of mod.mjs>-1/notes.txt`
  equals the retried wave's, and the row is `cannot fold` / `tool.sh does not parse` /
  `resolversDispatched` 3 / `checkRetries` 1 [M1][M2][M3]; (f) the `.py` row live — main and the run rewrite
  `mod.py`'s second line differently, the stub's first reply is `def f(:` and its second
  `l2 = 2020`: `python3 -m py_compile mod.py` is recorded twice, the retry prompt carries
  `SyntaxError`, and the row is `folded` with `checkRetries` 1 [M1][M2]; (g) the BASE `a.txt`
  conflict fixture (`conflictA` + `a2`, `RESOLVED_H1`) records `checks` exactly `[]`, no call whose
  `cmd` is `node` with `--check`, and its `bash -lc` suite call — a `.txt` path is not checked and
  the suite still runs [M1]; (h) the second `Run:` exits 0 only when all four literals are in
  `fleet/CONTRACT.md` (a contract missing any one of them fails it), and the first `Run:` passes
  the docs pin [M4].

**Stale-if:**
- path-absent: `fleet/publish-fold.mjs`
- path-absent: `fleet/tests/test_publish_fold.mjs`
- issue-closed: #751

### Task 2: The fold runs the joined paths' own exams before the whole suite

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/publish-fold.mjs`
- Modify: `fleet/publish-fold-block.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_publish_fold.mjs`
- Test: `fleet/tests/test_publish_fold_block.mjs`

**Claim:** After the parse check, the fold runs the exam files that name a joined path (every `Test:` in either plan's Proof whose Files overlap the joined set — the plan is on the branch at `.ultrapowers/plan.md`, the sibling's on its tag) before the whole suite; a red exam re-dispatches that path's resolver once with the exam's failure tail in the brief, and a second red is `disposition: suite red` with `reason: <exam> red on <path>` and the whole suite is not run. (quoted from #754)
Machine: M1. `contendingTasks({ repo, base, tip, run, path, tasks })` in
`fleet/publish-fold-block.mjs` resolves the ordered array of `{ run, task }` entries whose bodies
`contendingBlock` renders for that path — the frontier plans' tasks read off their tags, oldest
commit first, then this run's `tasks` in their order, each included exactly when its `files`
name the path — and `contendingBlock`'s string for the same arguments is what it was.
M2. `EXAM_CHECK`, the second entry of `CANDIDATE_CHECKS`, runs after the parse check on every
candidate: for each joined path in order, for each contending task whose `files` name it, the
paths of the `- Test:` bullets in the `**Proof:**` slot of the task's body (from the `**Proof:**`
line to the line before the first later line beginning `**Stale-if:**`, or the body's end), each
exam once in first-seen order; a task whose body has no `**Proof:**` line contributes none. Each
exam whose extension has a runner — `examArgvFor(exam)` is `['node', exam]` for `.mjs`/`.js`,
`['python3', '-m', 'pytest', '-q', exam]` for `.py`, `['bun', 'test', exam]` for `.test.ts`, and
`null` otherwise — is run in the integration clone on the candidate's tree, its stdout and stderr
written to `exam-<attempt>-<n>.txt` (`n` from 1, counting every exam run in the attempt) and
recorded in `checks` as `{ check: 'exam', exam, path, result: 'pass' | 'fail' }`, `path` the
joined path that brought it; an exam with no runner is recorded with `result: 'skipped'` and not
run; the first red exam stops the pass.
M3. A red exam whose `path` has a conflicts-index entry not yet retried in this attempt
re-dispatches that path's resolver once through Task 1's refold-and-replay, the retry prompt's
`PREVIOUS RESOLUTION FAILED A CHECK` section naming the exam and carrying the tail of its output;
`checkRetries` is 1, and a green second pass goes on to the suite.
M4. A red exam after a retry, or a red exam whose `path` has no conflicts-index entry, ends the
attempt with `disposition: 'suite red'`, `reason: '<exam> red on <path>'` and `suite: 'none'` in
the receipt row and the `driver:publish-fold` event, no `bash -lc` suite is run, and the branch
stays on the candidate.
M5. `fleet/CONTRACT.md`'s receipts sentence names `exam-<attempt>-<n>.txt` and its dispositions
sentence carries the phrase `red on`.

**Authorized-by:** #754 §Desired state move 1 (map #727); #751 for the retry it rides;
`fleet/CONTRACT.md` §Literals.

**Interfaces:**
- Consumes: `CANDIDATE_CHECKS`
- Produces: `contendingTasks({ repo, base, tip, run, path, tasks }) -> Promise<Array<{ run, task }>>`
- Produces: `examArgvFor(exam: string) -> string[] | null`
- Produces: `EXAM_CHECK`

**Context:** The seam Task 1 built, as one literal both Contexts carry:
`export const CANDIDATE_CHECKS = [PARSE_CHECK]` in `fleet/publish-fold.mjs`, an ordered array of
`{ name, run }`; the folder runs each `run(ctx)` in order on every candidate, where `ctx` is
`{ repo, base, tip, run, tasks, candidate, joined, conflicted, integ, exec, foldEvidence, attemptKey }`
(`joined` the ordered joined paths, `conflicted` the paths with a `conflicts.json` entry, `integ`
the integration clone already laid on the candidate's tree, `tasks` this run's `launch.json`
tasks), and `run` resolves `{ ok: true, checks }` or
`{ ok: false, checks, path, message, disposition, reason }` — the folder appends `checks` to the
row either way and on `ok: false` either retries (the `path` is in `conflicted` and unretried
this attempt) or records `disposition` and `reason`. A retry re-runs the whole check list from
the first entry on the new candidate, and a path is retried at most once per attempt across every
check. This task makes the array `[PARSE_CHECK, EXAM_CHECK]`; `EXAM_CHECK`'s `disposition` is
`suite red`, its `reason` `<exam> red on <path>`, its `message` the exam's output tail. What this
task needs of Task 1's runtime and no literal gives it: a red exam's retry is the refold that
replays every other reply and dispatches only the red path's resolver, and `checks` from both
passes accumulate on one row.
The contending tasks come from `fleet/publish-fold-block.mjs`, where BASE's `contendingBlock`
walks the first-parent frontier, fetches each `Fleet-Run: <M>` commit's `ultra/plan/run-<M>` tag,
compiles the plan with `--emit-launch` and renders the entries; this task lifts that walk into
`contendingTasks`, has `contendingBlock` render from it, and leaves the rendered string
byte-identical (`fleet/tests/test_publish_fold_block.mjs` pins it byte for byte; this task touches
`taskEntry` not at all, and each entry already embeds the task's whole body, Proof slot included).
Task 3 (wave 1, #757) has already changed `planTasksFor` to lay the tag's
`.ultrapowers/gate-verdicts.json` beside the plan before compiling, and has added a fourth region
to `fleet/tests/test_publish_fold_block.mjs` headed `// #757 Task 3`, pinning a claims-v1 frontier
tag byte for byte through the same `contendingBlock`; this task keeps `planTasksFor` as it finds it
and its own legs in that file sit below the `// #757 Task 3` region and above the
`console.log('ALL TESTS PASSED')` line.
`launch.json`'s `files` for a task is
`creates ∪ modifies ∪ reads`, so a `Test:` path is in `files` — a joined path that IS an exam file
(run-44's `fleet/tests/test_retire.mjs`) brings its own task, and so its own exam. A task body is
the verbatim plan section, in either grammar; the `- Test:` bullets are read as
``- Test: `<path>` `` lines under `**Proof:**`, backticks stripped, and `compile_plan.py`
emits a legacy-grammar body carrying a `**Proof:**` slot verbatim (checked on the laptop
2026-09-07: `--emit-launch` on a legacy plan whose T1 has `**Proof:**` / `- Test: `exam_main.mjs``
gives `files` `['a.txt', 'exam_main.mjs']` and the slot in `body`). The exams run in the
integration clone on the candidate's tree, where BASE's step 6 lays it; an exam's exit code is its
verdict, and the exams run even when `args.json` carries no `testCmd`.
The exam file is `fleet/tests/test_publish_fold.mjs`; its template is untouched by this task —
every fixture is per case: `mainMoves` on the maker clone commits a.txt edits with a
`Fleet-Run: 5` trailer, adds `exam_main.mjs` beside them, and pushes `ultra/plan/run-5` the way
`buildTemplate` pushes run 3's (an orphan branch holding `.ultrapowers/plan.md`, tagged, the tag
pushed, `main` checked out again); `runEdits` writes the run's own `exam_run.mjs`; this run's
`launch.json` task is a `TASK_A`-shaped object whose `files` are `['a.txt', 'exam_run.mjs']` and
whose body carries `**Proof:**` and ``- Test: `exam_run.mjs` ``. Run 5's plan is legacy grammar
(no `**Grammar:**` line, no gate record needed) with T1: `**Files:**` `- Modify: `a.txt``,
`- Test: `exam_main.mjs``, then `**Proof:**`, `- Test: `exam_main.mjs``. `exam_main.mjs` reads
`a.txt`, prints `exam_main: line 2 is <the line>` and exits 0 exactly when line 2 is
`line2 from main`; `exam_run.mjs` exits 0 exactly when some line is `line2 from run`. The stub's
wrong reply puts the run's line first (`line2 from run\nline2 from main`), which `exam_main.mjs`
rejects; the right one is `RESOLVED_H1`'s (`line2 from main\nline2 from run`). The new legs sit
in one block headed `// #754 Task 2 — exams first`, placed below the `// #751 Task 1` block and
above the `console.log('ALL TESTS PASSED')` line; the BASE fixtures (`PLAN_RUN3`, `TASK_A`,
`TASK_BODY`) carry no `**Proof:**` line, so every BASE case runs no exam and grades as it did —
leg (g) below pins that. Two CONTRACT sentences change, the same two Task 1 changes (same-file
text folds): the receipts sentence gains `exam-<attempt>-<n>.txt`, the dispositions sentence
gains `suite red` with `<exam> red on <path>`.
**BASE facts:** (generated at 9395cd1)
- `fleet/publish-fold-block.mjs` blob 162a9b3
- `contendingBlock` at `fleet/publish-fold-block.mjs:179` blob 162a9b3
- `tasks` at `fleet/fitness.mjs:112` blob 1cb6825
- `files` at `fleet/run-main.mjs:342` blob 97baef8
- `n` at `fleet/tests/test_claude_token.mjs:50` blob 15a4988
- `checks` at `fleet/run-engine.mjs:1274` blob 8694de1
- `fleet/CONTRACT.md` blob 486545c
- `fleet/publish-fold.mjs` blob 024f6f5
- `ctx` at `fleet/tests/test_fleet_bootstrap.mjs:143` blob c7f9cba
- `joined` at `fleet/tests/test_janitor.mjs:1082` blob 6703100
- `integ` at `fleet/publish-fold.mjs:106` blob 024f6f5
- `run` at `fleet/doctor.mjs:719` blob f9a1174
- `reason` at `fleet/run-engine.mjs:633` blob 8694de1
- `fleet/tests/test_publish_fold_block.mjs` blob ffa3882
- `taskEntry` at `fleet/publish-fold-block.mjs:90` blob 162a9b3
- `planTasksFor` at `fleet/publish-fold-block.mjs:139` blob 162a9b3
- `fleet/tests/test_retire.mjs` blob 12a9bf2
- `body` at `fleet/claude-token.mjs:401` blob b7e8e7b
- `testCmd` at `fleet/publish-fold.mjs:572` blob 024f6f5
- `fleet/tests/test_publish_fold.mjs` blob bb75648
- `buildTemplate` at `fleet/tests/test_publish_fold.mjs:134` blob bb75648
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `TASK_A` at `fleet/tests/test_publish_fold.mjs:71` blob bb75648
- `RESOLVED_H1` at `fleet/tests/test_publish_fold.mjs:459` blob bb75648
- `PLAN_RUN3` at `fleet/tests/test_publish_fold.mjs:76` blob bb75648
- `TASK_BODY` at `fleet/tests/test_publish_fold.mjs:64` blob bb75648
- `task` at `fleet/run-engine.mjs:1900` blob 8694de1
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `cwd` at `fleet/confine-hook.mjs:208` blob e0cd408
- `materialize` at `skills/ultrapowers/kernel/repo_weave.py:521` blob c9856c0
- `suite` at `fleet/publish-fold.mjs:585` blob 024f6f5
- `RESOLVED_A` at `fleet/tests/test_publish_fold.mjs:467` blob bb75648
- `none` at `fleet/tests/test_launch.mjs:934` blob 1f6c236
- `candidate` at `fleet/publish-fold.mjs:299` blob 024f6f5
- `check` at `fleet/tests/test_sandbox_boot.mjs:288` blob 120c765
- `exam` at `fleet/run-engine.mjs:1030` blob 8694de1
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `resolversDispatched` at `fleet/publish-fold.mjs:490` blob 024f6f5

**Proof:**
- Test: `fleet/tests/test_publish_fold.mjs`
- Test: `fleet/tests/test_publish_fold_block.mjs`
- Run: `bash -c 'grep -q "exam-<attempt>-<n>.txt" fleet/CONTRACT.md && grep -q "red on <path>" fleet/CONTRACT.md'`
- Legs, under `// #754 Task 2 — exams first`: (a) `examArgvFor` answers, for each of `t/e.mjs`,
  `t/e.js`, `t/e.py` and `t/e.test.ts`, exactly `['node', <exam>]`, `['node', <exam>]`,
  `['python3', '-m', 'pytest', '-q', <exam>]` and `['bun', 'test', <exam>]`, and exactly `null`
  for `t/e.txt` and `t/e.sh` [M2]; (b) `contendingTasks` on the run-5 fixture for `a.txt` with
  `tasks` `[<the exam task>, TASK_B-shaped task naming only b.txt]` resolves entries whose
  `(run, task.id)` pairs are exactly `[('5', 'T1'), ('7', <the exam task's id>)]` in that order,
  each `task` carrying `id`, `title`, `files` and `body`, and `contendingBlock` on the same
  arguments equals the heading, the side sentence and those two entries rendered by the sim's own
  `taskEntry` — a
  `contendingTasks` that drops the frontier entry, or orders this run's first, fails it, and the
  three BASE legs of `fleet/tests/test_publish_fold_block.mjs` — the four-commit frontier byte for
  byte, the missing tag's no-plan line, the untouched path — stand unchanged in that file and
  pass [M1];
  (c) the retried fold — the run-5 move plus `a2` and the exam task, where run 5's T1 Proof is
  followed by a `**Stale-if:**` line, a predicate, and a decoy line ``- Test: `ghost.mjs` `` below
  it (no such file exists), and the exam task's Proof ends its body, the stub's first reply the wrong order and its second `RESOLVED_H1`'s: two dispatches; the second prompt starts with the
  first's bytes and contains `PREVIOUS RESOLUTION FAILED A CHECK`, `exam_main.mjs` and
  `exam_main: line 2 is line2 from run`; the recorder shows `node exam_main.mjs` with `cwd` the
  integration clone once in the first pass and `node exam_main.mjs` then `node exam_run.mjs` in
  the second, all after a `materialize` and before the one `bash -lc` call; `checks` is exactly
  `[{ check: 'exam', exam: 'exam_main.mjs', path: 'a.txt', result: 'fail' }, { check: 'exam', exam: 'exam_main.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_run.mjs', path: 'a.txt', result: 'pass' }]`;
  `exam-1-1.txt` holds the red output (`line2 from run`) and `exam-1-2.txt`, `exam-1-3.txt` exist;
  no `checks` entry and no recorded call names `ghost.mjs` — a reader that runs past the
  `**Stale-if:**` line fails it; the row is `folded` / `suite` `pass` / `checkRetries` 1, and the
  candidate's `a.txt` is `RESOLVED_A` [M2][M3]; (d) the same fixture with the wrong order twice: `suite red`,
  `reason` `exam_main.mjs red on a.txt`, `suite` `none`, `checkRetries` 1, no recorded `bash -lc`
  call, the last `driver:publish-fold` event carrying the same `disposition`, `reason` and `suite`,
  and `refs/heads/<branch>` equal to the row's `candidate` [M4]; (e) the no-resolver row — main's
  run-5 move rewrites line 1 (`line1 from main`) and adds `exam_main.mjs` (expecting line 1
  `line1 from main`), the run rewrites line 10 (`a10`) with an `exam_run.mjs` that exits 1 whenever
  line 1 is not `line1`, `noAgent()`: the fold completes with no conflict and no dispatch,
  `checks` is `[{ check: 'exam', exam: 'exam_main.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_run.mjs', path: 'a.txt', result: 'fail' }]`,
  the row is `suite red` / `exam_run.mjs red on a.txt` / `suite` `none` / `checkRetries` 0, and no
  `bash -lc` call is recorded [M2][M4]; (f) the skipped row — the exam task's Proof names
  `- Test: `notes.txt`` beside `exam_run.mjs`, with the right reply first: `checks` carries
  `{ check: 'exam', exam: 'notes.txt', path: 'a.txt', result: 'skipped' }`, no recorded call names
  `notes.txt`, and the row is `folded` [M2]; (g) the BASE `a.txt` conflict fixture (`conflictA` +
  `a2`, `TASK_A`, `RESOLVED_H1`): `checks` has no entry whose `check` is `exam`, no recorded call
  whose `cmd` is `node` names a `.mjs` under the integration clone, and the `bash -lc` suite call is
  recorded — a body without `**Proof:**` contributes no exam and the suite still runs [M2];
  (h) the `Run:` exits 0 only when both literals are in `fleet/CONTRACT.md` [M5]; (i) the order
  of the two checks — `CANDIDATE_CHECKS.map((c) => c.name)` is exactly `['parse', 'exam']`; and
  live, over `mod.mjs` (the template's ten-line module): main's `Fleet-Run: 5` move rewrites its
  line 2 to `export const l2 = 20` and adds `exam_mod.mjs`, which imports `./mod.mjs` and exits 0
  exactly when its `l2` is `2020`, with a run-5 plan whose T1 names `mod.mjs` and
  ``- Test: `exam_mod.mjs` ``; the run rewrites line 2 to `export const l2 = 2000`; the stub's
  first reply keeps both lines and its second is `export const l2 = 2020`: `checks` is exactly
  `[{ check: 'parse', path: 'mod.mjs', result: 'fail' }, { check: 'parse', path: 'mod.mjs', result: 'pass' }, { check: 'exam', exam: 'exam_mod.mjs', path: 'mod.mjs', result: 'pass' }]`,
  the first recorded `node --check mod.mjs` call precedes every recorded `node exam_mod.mjs`
  call, exactly one `node exam_mod.mjs` call is recorded, and the row is `folded` with
  `checkRetries` 1 — a folder that runs the exam before, or instead of, the parse check records
  an `exam` entry first and fails it [M2]; (j) two joined paths live — main's one `Fleet-Run: 5`
  commit rewrites `a.txt` line 2 (`line2 from main`) and `mod.mjs` line 2 (`export const l2 = 20`)
  and adds `exam_main.mjs` (as in the retried fold) and `exam_mod.mjs` (as in the previous leg),
  with a run-5 plan whose T1 names only `a.txt` with ``- Test: `exam_main.mjs` `` and whose T2
  names only `mod.mjs` with ``- Test: `exam_mod.mjs` ``; the run rewrites `a.txt` line 2
  (`line2 from run`) and `mod.mjs` line 2 (`export const l2 = 2000`) and its one task's `files`
  are `['a.txt', 'mod.mjs', 'exam_run.mjs']` with ``- Test: `exam_run.mjs` `` (two conflicts, `a.txt`
  first in `run.patch`); the stub answers `a.txt`'s hunk with `RESOLVED_H1`'s order every time and
  `mod.mjs`'s hunk with `export const l2 = 2000` first and `export const l2 = 2020` second: the
  stub was dispatched exactly three times, once for `a.txt`'s `<i>` and twice for `mod.mjs`'s, the
  retry prompt names `exam_mod.mjs` and `mod.mjs`; the recorded exam calls, in order, are
  `node exam_main.mjs`, `node exam_run.mjs`, `node exam_mod.mjs`, `node exam_main.mjs`,
  `node exam_run.mjs`, `node exam_mod.mjs`, all with `cwd` the integration clone; `checks` is exactly
  `[{ check: 'parse', path: 'mod.mjs', result: 'pass' }, { check: 'exam', exam: 'exam_main.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_run.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_mod.mjs', path: 'mod.mjs', result: 'fail' }, { check: 'parse', path: 'mod.mjs', result: 'pass' }, { check: 'exam', exam: 'exam_main.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_run.mjs', path: 'a.txt', result: 'pass' }, { check: 'exam', exam: 'exam_mod.mjs', path: 'mod.mjs', result: 'pass' }]`
  — a folder that examines only the first joined path records no `exam_mod.mjs` entry and fails
  it, and one that runs `exam_run.mjs` once per path that names it records it twice in a pass and
  fails it; the row is `folded` / `suite` `pass` / `checkRetries` 1 / `resolversDispatched` 3, and
  the candidate's `mod.mjs` line 2 is `export const l2 = 2020` [M2][M3].

**Stale-if:**
- path-absent: `fleet/publish-fold.mjs`
- path-absent: `fleet/publish-fold-block.mjs`
- issue-closed: #754

### Task 3: The resolver brief carries the frontier sibling's body — the tag's record laid beside its plan

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/publish-fold-block.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_publish_fold_block.mjs`

**Claim:** The resolver brief carries the frontier sibling's task body — Proof slot included, exactly as it already carries this run's own — whenever the joined path's frontier commit is one of ours: `planTasksFor` reads both `.ultrapowers/plan.md` and `.ultrapowers/gate-verdicts.json` off `ultra/plan/run-<M>` and lays the verdicts beside the plan as `<stem>.gate-verdicts.json` before it compiles (quoted from #757)
Machine: M1. `contendingBlock({ repo, base, tip, run, path, tasks })` for a path whose first-parent
frontier holds a `Fleet-Run: <M>` commit, where the origin's tag `ultra/plan/run-<M>` carries a
claims-v1 `.ultrapowers/plan.md` and beside it the `.ultrapowers/gate-verdicts.json` signed for it,
renders — for every task of that plan whose `files` name the path, in the frontier's first-parent
order — `- run <M> task <id>: <title> [files: …]`, a newline, and the task's verbatim body with its
`**Proof:**` slot, through the same entry template this run's own `tasks` are rendered with.
M2. The same frontier where the tag carries a claims-v1 `.ultrapowers/plan.md` and no
`.ultrapowers/gate-verdicts.json` renders that commit as `- main <sha7> "<subject>" (<author>, no plan)`,
no `- run <M> ` entry, and throws nothing.
M3. A tag carrying a legacy-grammar plan and no record renders the entry it rendered at BASE, and
the block over the BASE fixture — a run-3 legacy tag, a human commit, a merge, an untagged run 4 —
is the string it was.
M4. The `The two tags` bullet of `fleet/CONTRACT.md` says that a `Fleet-Run: <N>` frontier commit is
attributed to its run's tasks only when `ultra/plan/run-<N>` carries the `gate-verdicts.json` its
plan needs to compile, and that a claims-v1 tag without it is a `no plan` line.

**Authorized-by:** #757 (`bug`, `fleet`); #715 decision 3 (the block embeds the sibling's body
verbatim); `fleet/CONTRACT.md` §Literals (the two tags).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `planTasksFor` (`fleet/publish-fold-block.mjs:139`) fetches the tag, `git show`s only
`<tag>:.ultrapowers/plan.md` (line 144) into a temp directory as `plan.md`, and runs
`compile_plan.py plan.md --emit-launch`; a non-zero exit is `null` and `null` is the no-plan line.
Reproduced on the laptop 2026-09-07 with `ultra/plan/run-42`'s plan alone (rule 5):
`compile_plan: claims-v1 grammar violation(s) — refusing to compile:` /
`grammar: gate verdicts missing — expected `plan.gate-verdicts.json` beside the plan; the proof gate's verdict is an artifact, not a memory (spec §4.5). Run the gate and commit its record.`,
exit 1; with `git show ultra/plan/run-42:.ultrapowers/gate-verdicts.json` written beside it as
`plan.gate-verdicts.json`, the same command exits 0 and emits two tasks, each `body` carrying
`**Proof:**`. The compiler's sibling name is `<stem>.gate-verdicts.json` (`GATE_VERDICTS_SUFFIX`,
`verdicts_path` in `skills/ultrapowers/scripts/compile_plan.py`); the tag's blob is
`.ultrapowers/gate-verdicts.json` — `VERDICTS_BLOB_PATH` in `fleet/sandbox-boot.sh:127`, laid
beside the run's own plan at line 466 as `${PLAN_FILE%.md}.gate-verdicts.json`, `VERDICTS_PATH` in
`fleet/launch.mjs:137`; `git ls-tree ultra/plan/run-42` shows base + those two files. The record is
optional on the tag and mandatory beside the plan when it exists (the boot script's rule, line
460): a `git show` of the absent blob on a legacy tag exits non-zero and that plan still compiles.
The compiler checks each record entry's `hash` against the live Claim/Proof pair, so a fixture's
record must be the one signed for its plan: `evals/fixtures/claims/plan.md` (blob `b22de65`) with
`evals/fixtures/claims/plan.gate-verdicts.json` (blob `0e474ec`) — the compiler corpus's claims-v1
sample, pinned by `tests/test_compile_plan_claims.py` — compile together to three tasks; task `1`
`The widget constructor` has `files` `['tests/test_widget.py', 'widgetkit/widget.py']` and a body
carrying `**Proof:**`, ``- Test: `tests/test_widget.py` `` and a python fence; tasks `2` and `3`
name `widgetkit/catalog.py` and `widgetkit/format.py`, never `widgetkit/widget.py`. The sim reaches
them as `path.resolve(HERE, '../../evals/fixtures/claims/…')`, the way it reaches the compiler;
`pytest.ini` keeps pytest out of `evals/`, and nothing there is executed. The brief is the block:
`fleet/publish-fold.mjs:43` imports `contendingBlock` and line 531 hands it to the brief builder,
and `fleet/tests/test_publish_fold.mjs`'s brief leg pins the entries in the block's order — so the
exam is at the block, and a body the block carries is a body the brief carries.
The exam file is `fleet/tests/test_publish_fold_block.mjs`; its `buildFixture` (the four-commit
frontier on `a.txt`), `makeTag` (writes only `.ultrapowers/plan.md`), `compiledTask` (compiles a
plan text with no record beside it), `heading`, `noPlanLine` and `taskEntry` are untouched. The new
legs sit in one region headed `// #757 Task 3 — the tag's record beside its plan`, placed after the
untouched-path leg's closing brace and before the `console.log('ALL TESTS PASSED')` line (Task 2, a
later wave, adds its legs below this region), with an origin of their own: a seed commit holding
`widgetkit/widget.py` and `b.txt`, then on `main`, oldest first, three commits each rewriting
`widgetkit/widget.py` — `Fleet-Run: 11`, `Fleet-Run: 12`, `Fleet-Run: 13` — and three tags on
orphan commits the way `makeTag` makes them: `ultra/plan/run-11` holding the claims fixture's plan
as `.ultrapowers/plan.md` and its record as `.ultrapowers/gate-verdicts.json`; `ultra/plan/run-12`
holding that plan alone; `ultra/plan/run-13` holding a legacy-grammar plan of `PLAN_RUN3`'s shape
whose T1 names `widgetkit/widget.py`; all three pushed to the origin, and the clone under test
fetched to the tip with `--no-tags`. This run's `tasks` are a `TASK_A`-shaped task naming
`widgetkit/widget.py` and one naming only `b.txt`. Run numbers 11–13 are this file's alone (the
BASE fixture uses 3 and 4; Task 2's fixture in the other sim uses 5). The oracle for run 11's entry
is the compiler on the fixture pair with the record beside the plan; the oracle for run 13's is
BASE's `compiledTask`. One CONTRACT bullet changes and nothing else in that file: `The two tags`
(line 65, `- **The two tags** — a run's record, …`, fifteen lines to the next bullet) gains one
sentence; Task 1's two CONTRACT sentences are in the branches bullet and the boot-script bullet,
so the same-wave fold has nothing adjacent to order. `tests/test_docs_agree_with_code.py` reads
the file's other literals and must still find them.
**BASE facts:** (generated at 9395cd1)
- `planTasksFor` at `fleet/publish-fold-block.mjs:139` blob 162a9b3
- `files` at `fleet/run-main.mjs:342` blob 97baef8
- `tasks` at `fleet/fitness.mjs:112` blob 1cb6825
- `fleet/CONTRACT.md` blob 486545c
- `fleet` at `fleet/tests/test_janitor_liveness.mjs:242` blob dce8666
- `fleet/publish-fold-block.mjs:139` blob 162a9b3 line 139 `async function planTasksFor (repo, run) {`
- `body` at `fleet/claude-token.mjs:401` blob b7e8e7b
- `verdicts_path` at `skills/ultrapowers/scripts/compile_plan.py:1055` blob e86ad06
- `skills/ultrapowers/scripts/compile_plan.py` blob e86ad06
- `fleet/sandbox-boot.sh:127` blob f2adff7 line 127 `VERDICTS_BLOB_PATH=".ultrapowers/gate-verdicts.json"`
- `VERDICTS_PATH` at `fleet/launch.mjs:137` blob 6150d59
- `fleet/launch.mjs:137` blob 6150d59 line 137 `export const VERDICTS_PATH = '.ultrapowers/gate-verdicts.jso`
- `evals/fixtures/claims/plan.md` blob b22de65
- `evals/fixtures/claims/plan.gate-verdicts.json` blob 0e474ec
- `tests/test_compile_plan_claims.py` blob 3c9e409
- `pytest.ini` blob 251eb61
- `fleet/publish-fold.mjs:43` blob 024f6f5 line 43 `import { contendingBlock as buildContendingBlock } from './p`
- `contendingBlock` at `fleet/publish-fold-block.mjs:179` blob 162a9b3
- `fleet/tests/test_publish_fold.mjs` blob bb75648
- `fleet/tests/test_publish_fold_block.mjs` blob ffa3882
- `buildFixture` at `fleet/tests/test_publish_fold_block.mjs:114` blob ffa3882
- `makeTag` at `fleet/tests/test_publish_fold_block.mjs:170` blob ffa3882
- `compiledTask` at `fleet/tests/test_publish_fold.mjs:193` blob bb75648
- `heading` at `fleet/tests/test_publish_fold_block.mjs:212` blob ffa3882
- `noPlanLine` at `fleet/publish-fold-block.mjs:95` blob 162a9b3
- `taskEntry` at `fleet/publish-fold-block.mjs:90` blob 162a9b3
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `PLAN_RUN3` at `fleet/tests/test_publish_fold.mjs:76` blob bb75648
- `TASK_A` at `fleet/tests/test_publish_fold.mjs:71` blob bb75648
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `t1` at `fleet/tests/test_publish_fold_block.mjs:223` blob ffa3882
- `fleet/publish-fold-block.mjs` blob 162a9b3

**Proof:**
- Test: `fleet/tests/test_publish_fold_block.mjs`
- Run: `bash -c "sed -n '/^- \*\*The two tags\*\*/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'gate-verdicts.json.*no plan'"`
- Legs, under `// #757 Task 3 — the tag's record beside its plan`: (a) the block for
  `widgetkit/widget.py` over the three-commit frontier, with `tasks` [the widget task, the `b.txt`
  task], equals byte for byte the heading, the side sentence, `taskEntry(11, t1)` — `t1` the claims
  fixture's task `1` as the compiler emits it with the record beside the plan — then
  `noPlanLine(<the run-12 commit>)`, then `taskEntry(13, <the legacy T1 by compiledTask>)`, then
  `taskEntry(RUN, <the widget task>)`; a `planTasksFor` that compiles run 11's plan alone renders
  it as a no-plan line and fails it [M1][M2][M3]; (b) the run-11 entry in that block contains
  `**Proof:**` and `- Test: ` followed by `tests/test_widget.py` in backticks, and the block contains
  no `- run 11 task 2:` and no `- run 11 task 3:` line — the catalog and format tasks name other
  files [M1]; (c) the same block contains exactly one `- main ` line, it is the run-12 commit's
  `- main <sha7> "<subject>" (<author>, no plan)`, and no `- run 12 ` line — the call resolved rather
  than threw [M2]; (d) the run-13 entry's bytes are `taskEntry(13, compiledTask(<the legacy plan>, 'T1'))`
  and the BASE fixture's block for `a.txt` with `[TASK_A, TASK_B, TASK_C]` is still the heading,
  `taskEntry(3, t1)`, the three no-plan lines and this run's two entries — the four-commit leg, the
  missing-tag leg and the untouched-path leg of this file pass unchanged [M3]; (e) the `Run:` exits
  0 only when the `The two tags` bullet carries `gate-verdicts.json` and, after it, `no plan` — a
  contract whose bullet lacks either fails it [M4].

**Stale-if:**
- path-absent: `fleet/publish-fold-block.mjs`
- path-absent: `evals/fixtures/claims/plan.gate-verdicts.json`
- issue-closed: #757
