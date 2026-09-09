# The mechanical referee — driver arithmetic before any reviewer

**Grammar:** claims-v1

**Claim:** A driver pass over the captured patch, before any reviewer, produces a `referee.json` per task (quoted from #729)

**Goal:** #729 (map #727 The Determinism Ratchet, move A1; spec
`docs/superpowers/specs/2026-09-09-mechanical-referee.md`, signed 2026-09-08 after four neutral
review rounds — thirty adopted findings, every one binding here). `fleet/roles/reviewer.md` asks a
mostCapable model, once per lean task and twice per `peer` task, to do eight things, and three of
them are arithmetic on artifacts the driver already holds: the footprint (paths outside FILES, a
deleted BASE file, a sibling's path), whether every `Produces:` symbol resolves at HEAD, and
whether every Proof `Test:` file exists and ran. On the record (111 reviewer findings across 41
tasks, runs 4–29) 14 are footprint or interface, all minor, and the second reviewer added zero
marginal blocking findings on runs 24, 27 and 28. This plan moves that arithmetic into driver
code: a new pure module `fleet/referee.mjs` runs inside the pre-review pass as its fourth source
of reds, writes `<runDir>/referee/task-<id>-<n>.json`, routes an implementer-actor blocking finding
to the same `fix:<id>:0` round a red `Run:` takes, hands the reviewer a `REFEREE:` block of settled
facts, drops the second reviewer of a `peer` task only when a blocking finding was repaired, and
carries the file to the evidence record. The reviewer's duty-3 arithmetic and duty-4 INTERFACES
sentence are deleted in the same change, behind the replay (subtraction doctrine: deletion owed per
guard). The interface linker covers `.mjs`, `.py` and `.ts` in this release. Nothing in the frozen
verification periphery moves and the compiler is not touched.
**Closes:** #729

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`, `node:` modules only — `fleet/package.json` declares no
dependency), bash (`fleet/sandbox-boot.sh`), Markdown role and contract files. The engine sims run
the real engine below the agent seam (real git, real clones-at-BASE, real `withPatchCapture`
diffs, the real fold kernel through the real `sh` seam) with canned judgments, through `rig()` of
`fleet/tests/_engine_helpers.mjs`, whose repository's suite is `bash check.sh`. The boot sims run
the real `fleet/sandbox-boot.sh` with every external command stubbed on `PATH` through
`fleet/tests/_sandbox_boot_helpers.mjs`. The committed suite is `python3 -m pytest` from the repo
root, which bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel
`ALL TESTS PASSED`, no network; `pytest.ini` scopes collection to `tests/`, so nothing under
`fleet/tests/fixtures/` is ever collected as a test).

**Parallelization rationale:** two waves. Wave 1, width 4: the referee module with its replay sim
and fixtures (Task 1), the interface linker with its sim and fixtures (Task 2), the reviewer role
file (Task 4) and the record — boot script, contract, report format, boot sim (Task 5) — name no
common file and consume no common symbol; Tasks 1 and 2 share three literals written into both
Contexts (the finding triple, the `referee.json` shape, the linker's signature and result shape),
and the referee takes the linker as an injected argument, so it never imports the linker and the
replay stubs it. Wave 2, width 1: Task 3, the engine seam, `Consumes:` both `Produces:` of wave 1
and needs their runtime behaviour, not their shape — its sims run the real engine, which executes
`referee()` on real driver-captured patches in real clones and the real linker's `import()`
against real files, so a stubbed shape would prove nothing about the seam. No two tasks name one
file.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh skills/ultrapowers/scripts/compile_plan.py
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/examiner.md fleet/roles/critic.md fleet/roles/fix.md fleet/roles/implementer.md fleet/roles/resolver.md fleet/roles/reconcile.md
- The verification periphery is frozen (0.1.0): the first Check pins the three gate scripts and the
  compiler, whose diagnostic vocabulary and task JSON are read here and never changed. The second
  pins the roles this plan does not own — only `reviewer.md` changes.
- The referee and the linker are driver code: no model call, no network, no git write, no
  `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/`. A subprocess they spawn is
  `node` or `python3` on a file of the task's own clone, with a timeout, and nothing else.
- Amendment 10 holds: models never run git; every git command in the sims is the sim's own.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The referee grades a captured patch

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/referee.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-1/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-1/base/README.md`
- Create: `fleet/tests/fixtures/referee/footprint-1/base/src/snake.ts`
- Create: `fleet/tests/fixtures/referee/footprint-1/base/tests/snake.test.ts`
- Create: `fleet/tests/fixtures/referee/footprint-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-1/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-2/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-2/base/fleet/run-engine.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-2/base/fleet/tests/test_run_engine_exam_fix_edit.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-2/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-3/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-3/base/skills/ultrapowers/scripts/compile_plan.py`
- Create: `fleet/tests/fixtures/referee/footprint-3/base/tests/test_compile_plan_engine_self_change.py`
- Create: `fleet/tests/fixtures/referee/footprint-3/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-3/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-4/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-4/base/fleet/sandbox-boot.sh`
- Create: `fleet/tests/fixtures/referee/footprint-4/base/fleet/tests/test_sandbox_boot_merge.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-4/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-4/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-5/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-5/base/README.md`
- Create: `fleet/tests/fixtures/referee/footprint-5/base/src/kebab.ts`
- Create: `fleet/tests/fixtures/referee/footprint-5/base/tests/kebab.test.ts`
- Create: `fleet/tests/fixtures/referee/footprint-5/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-5/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-6/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-6/base/skills/ultrapowers/SKILL.md`
- Create: `fleet/tests/fixtures/referee/footprint-6/base/skills/ultrapowers/references/first-run.md`
- Create: `fleet/tests/fixtures/referee/footprint-6/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-6/expected.json`
- Create: `fleet/tests/fixtures/referee/footprint-7/task.json`
- Create: `fleet/tests/fixtures/referee/footprint-7/base/fleet/janitor.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-7/base/fleet/retire.mjs`
- Create: `fleet/tests/fixtures/referee/footprint-7/patch.diff`
- Create: `fleet/tests/fixtures/referee/footprint-7/expected.json`
- Create: `fleet/tests/fixtures/referee/exam-1/task.json`
- Create: `fleet/tests/fixtures/referee/exam-1/base/src/x.ts`
- Create: `fleet/tests/fixtures/referee/exam-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/exam-1/expected.json`
- Create: `fleet/tests/fixtures/referee/exam-2/task.json`
- Create: `fleet/tests/fixtures/referee/exam-2/base/src/x.ts`
- Create: `fleet/tests/fixtures/referee/exam-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/exam-2/expected.json`
- Create: `fleet/tests/fixtures/referee/exam-3/task.json`
- Create: `fleet/tests/fixtures/referee/exam-3/base/src/x.ts`
- Create: `fleet/tests/fixtures/referee/exam-3/patch.diff`
- Create: `fleet/tests/fixtures/referee/exam-3/expected.json`
- Create: `fleet/tests/fixtures/referee/exam-4/task.json`
- Create: `fleet/tests/fixtures/referee/exam-4/base/src/x.ts`
- Create: `fleet/tests/fixtures/referee/exam-4/patch.diff`
- Create: `fleet/tests/fixtures/referee/exam-4/expected.json`
- Create: `fleet/tests/fixtures/referee/testcount-1/task.json`
- Create: `fleet/tests/fixtures/referee/testcount-1/base/src/a.py`
- Create: `fleet/tests/fixtures/referee/testcount-1/base/tests/test_a.py`
- Create: `fleet/tests/fixtures/referee/testcount-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/testcount-1/expected.json`
- Create: `fleet/tests/fixtures/referee/testcount-2/task.json`
- Create: `fleet/tests/fixtures/referee/testcount-2/base/src/a.py`
- Create: `fleet/tests/fixtures/referee/testcount-2/base/tests/test_a.py`
- Create: `fleet/tests/fixtures/referee/testcount-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/testcount-2/expected.json`
- Create: `fleet/tests/fixtures/referee/deps-1/task.json`
- Create: `fleet/tests/fixtures/referee/deps-1/base/package.json`
- Create: `fleet/tests/fixtures/referee/deps-1/base/src/a.ts`
- Create: `fleet/tests/fixtures/referee/deps-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/deps-1/expected.json`
- Create: `fleet/tests/fixtures/referee/secrets-1/task.json`
- Create: `fleet/tests/fixtures/referee/secrets-1/base/src/config.ts`
- Create: `fleet/tests/fixtures/referee/secrets-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/secrets-1/expected.json`
- Create: `fleet/tests/fixtures/referee/secrets-2/task.json`
- Create: `fleet/tests/fixtures/referee/secrets-2/base/tests/config.test.ts`
- Create: `fleet/tests/fixtures/referee/secrets-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/secrets-2/expected.json`
- Create: `fleet/tests/fixtures/referee/clean-1/task.json`
- Create: `fleet/tests/fixtures/referee/clean-1/base/src/z.ts`
- Create: `fleet/tests/fixtures/referee/clean-1/base/tests/z.test.ts`
- Create: `fleet/tests/fixtures/referee/clean-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/clean-1/expected.json`
- Create: `fleet/tests/fixtures/referee/clean-2/task.json`
- Create: `fleet/tests/fixtures/referee/clean-2/base/docs/a.md`
- Create: `fleet/tests/fixtures/referee/clean-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/clean-2/expected.json`
- Test: `fleet/tests/test_referee_replay.mjs`

**Claim:** The referee module reads a captured patch, the task it belongs to and the clone at
HEAD, and answers with one `referee.json` object for the task — the footprint, the exam files,
the test count, the dependency manifests and a secret scan each decided as a finding with a
severity or as a settled line — and a replay over fixtures built from the recorded reviewer notes
shows it raising every footprint finding a reviewer once raised. (derived)
Machine: M1. `fleet/referee.mjs` exports `referee(opts)`; called with `{task, patchPath, baseSha,
headSha, cloneDir, siblingFiles, exam, examEvidence, n, linker, runDir}` it resolves to an object
`{task, n, findings, settled, linker, ms}` where `task` is `opts.task.id`, `findings` is an array of
`{check, severity, actor, detail}` with `check` one of `footprint`, `interface`, `exam-files`,
`test-count`, `dependencies`, `secrets`, `severity` one of `blocking`, `minor`, `actor` one of
`implementer`, `plan`, `settled` an array of `{check, detail}` holding, for each of `interface`,
`exam-files`, `test-count`, `dependencies` and `secrets`, exactly one line when that check raised
no finding and none when it did; for `footprint`, one line per path present in both own and
sibling and, when there is no such path and no footprint finding, exactly one line; plus one
`integrated-suite` line on every call; `linker` an object whose keys are the `task.files` paths
with extension `.mjs` or `.js` (value `mjs`), `.py` (value `py`), `.ts` or `.tsx` (value `ts`),
in `task.files` order, and nothing else; `ms` a non-negative integer; and it writes that object as JSON to `<runDir>/referee/task-<id>-<n>.json`, creating the
directory, byte-equal to `JSON.stringify(result, null, 2) + '\n'`; with `runDir` absent it writes
nothing and still resolves to the object.
M2. Footprint, from the patch's `diff --git a/<p> b/<p>` headers and `deleted file mode` lines,
with own = `task.files` ∪ `task.proofTests` and sibling = the union of `siblingFiles`: a touched
path in neither own nor sibling is a `footprint` `minor` finding, actor `implementer`, whose
detail contains the path; a touched path in sibling and not in own is a `footprint` `blocking`
finding, actor `implementer`, naming the path; a path present in both is settled, and the settled
`footprint` line names it; a path with a `deleted file mode` header that is not in own is exactly one
`footprint` `blocking` finding naming the path — the deletion rule wins and the outside-FILES
minor is not also raised for it; a patch whose every touched path is in own raises no footprint
finding.
M3. Exam files: when `exam` is `red` or `green-at-base` and `examEvidence` is an object with
`exit` 0, every `task.proofTests` path absent at `<cloneDir>/<path>` is one `exam-files` `blocking`
finding (one per path, never two for one path), actor `implementer` when the path is in
`task.files` and `plan` otherwise; when `examEvidence.exit` is non-zero the absent path raises no
finding and the settled `exam-files` line contains `already red as the exam`; when `exam` is
`blocked` or `null` no `exam-files` finding is raised and the settled line contains `unexamined`;
when every path is present the settled line names them.
M4. Interface: for each entry of `task.interfaces.produces`, `opts.linker` is called once with
`{bullet, files, cloneDir}` (the bullet verbatim, `task.files`, the clone) and its `{status,
symbol, detail}` maps to: `missing` → an `interface` `blocking` finding, actor `implementer`,
whose detail contains `symbol` and `detail`; `declared` → an `interface` `minor` finding
containing both; `resolved` and `unlinked` → no finding, the settled `interface` line carrying the
detail; a task with no produces entry gets the settled line `no Produces: to link`.
M5. Test count: over the patch's added lines (`+`, not `+++`) and removed lines (`-`, not `---`),
added minus removed lines matching `^def test_` in a `.py` file or `^\s*(test|it)\(` in a `.js`,
`.mjs`, `.ts` or `.tsx` file is the delta; a negative delta is a `test-count` `minor` finding,
actor `implementer`, naming the removed test names, unless some line of `task.body` contains one
of the words `delete`, `deleted`, `remove`, `removed` and also a removed test's name or one of
`task.proofTests` — then it is settled with the delta in the line; a zero or positive delta is
settled as `top-level tests +<a> / −<r>`; a file with no such match contributes 0.
M6. Dependencies: a hunk in a file whose basename is `package.json`, `package-lock.json`,
`bun.lock` or `pyproject.toml`, or matches `requirements*.txt`, at any directory depth, is one
`dependencies` `minor` finding, actor `implementer`, naming the file and every quoted key or
bare package token on its added and removed lines; no such hunk is settled `no manifest changed`.
M7. Secrets: an added line in a file whose path does not start with `fleet/tests/`, `tests/` or
`evals/` that matches any of `AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`,
`-----BEGIN [A-Z ]*PRIVATE KEY-----` is a `secrets` `blocking` finding, actor `implementer`,
naming the file and the pattern (never the matched literal); the same line under one of the three
excluded prefixes raises nothing; none is settled `no secret-shaped literal added`.
M8. The replay: for every fixture directory under `fleet/tests/fixtures/referee/` whose name begins
`footprint-`, `exam-`, `testcount-`, `deps-`, `secrets-` or `clean-`, the sim builds HEAD from
`base/` plus `patch.diff` with git, calls `referee()` with a stub linker answering `unlinked`, and
finds every `expected.json` finding raised (by `check`, `severity` and, when given, `actor`) and
every `expected.json` settled line present (by `check` and contained text); for every `clean-*`
fixture `findings` is `[]`; and the module imports only `node:` modules — never `child_process`,
never a model, never git.

**Authorized-by:** #729; spec `docs/superpowers/specs/2026-09-09-mechanical-referee.md` §3.1, §3.2,
§3.5 (routing), §4.1, §4.3; operator decisions 1, 4, 7; spec review round 2 findings 7, 9 and
round 3 findings 3, 6; map #727 rule 1 (an answer that is a function of held artifacts is a driver
check).

**Interfaces:**
- Consumes: none
- Produces: `referee(opts) -> Promise<{task, n, findings, settled, linker, ms}>`

**Context:** This module is driver arithmetic: it reads the captured patch file, the clone at HEAD
and the task object, and decides; it never dispatches a model, never touches the network, and
never writes git state — its only write is the JSON file under `<runDir>/referee/`. It imports
only `node:fs` and `node:path` (plus `node:url` if needed); the linker it calls is injected
through `opts.linker`, so this module never imports the sibling linker module and the replay stubs
it with `async () => ({status: 'unlinked', symbol: '', detail: 'stub'})`. Ordering of `findings`:
footprint, interface, exam-files, test-count, dependencies, secrets, and within a check the
patch's path order. The engine hands it the compiled task object, whose fields it reads are
`task.id` (string), `task.files` (array of paths — `creates` ∪ `modifies` ∪ `reads` as the
compiler emits them), `task.proofTests` (the Proof `Test:` paths, array, `[]` when none),
`task.interfaces.produces` (array of bullet strings as the compiler stores them — the text after
`- Produces:`, backticks included, for instance the string of backtick, `foo(a, b) -> Widget`,
backtick) and `task.body` (the task's six-slot text). `siblingFiles` is an array of arrays — the
wave's other tasks' `files` — never a rendered string. `exam` is the engine's per-task exam status
and is one of `red`, `green-at-base`, `blocked`, `null` (`null` when the Proof names no `Test:`
path); `examEvidence` is `{cmd, exit, stdout}` or `null`, the driver's own execution of the exam in
this pass. `patchPath` is the driver-captured file `<runDir>/patches/task-<id>.patch`, written by
`withPatchCapture` in `fleet/run-waves.mjs` as `git diff --cached --binary --full-index
--no-renames` against BASE — so a rename is a delete plus an add and a deleted BASE file carries
a `deleted file mode` header; the patch is the referee's sole input for the footprint and the
count checks, and `baseSha`/`headSha` are recorded for the reader, not consulted. `n` is the
number of fix rounds preceding the patch being graded (`0` for the pre-pass tree); the file name
carries it so no round overwrites another's record.

The `referee.json` shape, verbatim from the spec (a shared literal with the sibling tasks that
read it):

    {
      "task": "3", "n": 0,
      "findings": [
        {"check": "footprint", "severity": "blocking", "actor": "implementer",
         "detail": "deleted BASE file `fleet/retire.mjs` absent from FILES"},
        {"check": "interface", "severity": "blocking", "actor": "implementer",
         "detail": "Produces: `countVowels(s)` — no export named countVowels in fleet/x.mjs (found: countVowel)"},
        {"check": "footprint", "severity": "minor", "actor": "implementer",
         "detail": "path outside FILES: `fleet/tests/helper.mjs`"}
      ],
      "settled": [
        {"check": "footprint", "detail": "every touched path is in FILES"},
        {"check": "interface", "detail": "Produces: `foo(a, b)` resolves to fleet/foo.mjs export foo/2"},
        {"check": "exam-files", "detail": "tests/test_foo.py exists; exam ran, exit 0"},
        {"check": "test-count", "detail": "top-level tests +3 / −0 across the patch"},
        {"check": "dependencies", "detail": "no manifest changed"},
        {"check": "secrets", "detail": "no secret-shaped literal added"}
      ],
      "linker": {"fleet/foo.mjs": "mjs", "tests/test_foo.py": "py", "src/x.ts": "ts"},
      "ms": 412
    }

Every finding carries the same `{severity, detail, actor}` triple `REVIEWER_SCHEMA` in
`fleet/run-engine.mjs` requires of a reviewer's issue (`severity` from `SEVERITY = ['blocking',
'minor']`, `actor` from `['implementer', 'plan']`), so the engine's existing de-dup on
`severity|detail`, actor routing, fix round and report machinery consume it unchanged. The
`integrated-suite` settled line, always emitted, reads: the run's Acceptance is `suite`; the driver
runs the integrated suite on the adopted tree, not this review — eight recorded reviewer findings
were the reviewer asking for exactly that run. A settled or finding detail must never contain the
strings `EXAM EVIDENCE`, `RUN EVIDENCE` or `CHECK EVIDENCE` (engine sims assert those block names
are absent from a prompt that carries no such block, and this file's lines are rendered into the
review prompt by a sibling task). The severity table, verbatim from the spec:

| check | input | finding | severity |
|---|---|---|---|
| footprint: outside FILES | patch paths vs `task.files` | a touched path not in FILES | minor |
| footprint: sibling | patch paths vs siblings' `files` | a touched path owned by a wave sibling and absent from the task's own FILES (a path in both is the shipped `overlap=fold` case: settled, not a finding) | blocking |
| footprint: deleted BASE | `deleted file mode` headers vs FILES | a BASE file deleted and not in FILES | blocking |
| interface linker | each `Produces:` first symbol vs `task.files` at HEAD | name appears nowhere in the candidate files: blocking; declared but not exported/top-level: minor; non-identifier symbol or no linker: unlinked, never a finding | blocking / minor / none |
| exam files | Proof `Test:` paths vs the tree at HEAD; the exam evidence | a `Test:` path absent at HEAD when an exam ran — one finding, and only when the same pass minted no red exam, never two; when `exam` is `blocked` or `null` the task proceeds unexamined by driver decision: a settled line, never a finding | blocking |
| test-count delta | added minus removed lines matching `^def test_` (py), `^\s*(test\|it)\(` (js/ts/bun) | net drop when neither the task's Proof nor its Context contains the word `delete`/`deleted`/`remove` beside a `Test:` path or test name; fleet sims (top-level asserts, no `test(`) always count 0 and are never a finding | minor |
| dependency delta | patch hunks in `package.json`, `package-lock.json`, `bun.lock`, `requirements*.txt`, `pyproject.toml`, `fleet/package.json` | a manifest changed | minor, naming the added/removed names |
| secrets | added lines outside `fleet/tests/`, `tests/`, `evals/` vs a fixed pattern list (`AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`) | a match | blocking, actor implementer |

The Proof `Test:` paths count as inside the footprint because the driver itself hands the peer's
exam into the graded clone after the implementer returns (the exam handoff in `runTaskInner`), so
the recaptured patch carries them on every examined task; every engine sim's hand-built task
lists `files: ['one.txt']` with `proofTests: ['t1_test.sh']`, and a referee that read those as
outside FILES would put a minor into every such sim's `notes`. The exam-files actor rule: a
`Test:` path outside the task's own FILES and created by no sibling is a plan defect (actor
`plan`); a path in FILES is the implementer's. The linker's signature and result, the shared
literal with the sibling linker task: `linkProduces({bullet, files, cloneDir, exec, timeoutMs})
-> Promise<{status, symbol, detail}>` with `status` one of `resolved`, `declared`, `missing`,
`unlinked`; the referee passes each `produces` bullet verbatim and reads `status`, `symbol` and
`detail` only; the `linker` object in the result maps each `task.files` path whose extension is
`.mjs`/`.js` → `mjs`, `.py` → `py`, `.ts`/`.tsx` → `ts`, and omits the rest. The deletion words
for the test-count rule are matched case-insensitively as whole words on a line of `task.body`
that also contains the removed test's name (for instance `test_two`) or a `task.proofTests` path
verbatim. The dependency names: on a `package.json`-style hunk the JSON keys of added and removed
lines (`"left-pad": "1.3.0"` → `left-pad`); on a requirements line the token before `==`, `>=` or
end of line. Secrets are reported by pattern name, never by echoing the literal. `ms` is the wall
clock of the call in milliseconds. The minus sign in the test-count lines (`+2 / −0`, `−1`) is
U+2212, the same byte sequence in the module and in the sim. The engine (a later task) is the
caller: it invokes `referee()` inside its pre-review pass with the driver-captured patch of every
task — this module never imports the engine and is proven as a library.

The fixture layout, one directory per fixture under `fleet/tests/fixtures/referee/`: `task.json`
holds `{"task": {...}, "siblingFiles": [[...]], "exam": ..., "examEvidence": ...}` where `task`
carries exactly the compiled-task fields named above (`id`, `files`, `proofTests`, `interfaces`
with `consumes` and `produces`, `body`); `base/` holds the files at BASE as a tree; `patch.diff`
is a unified diff against `base/` in the `git diff --no-renames` shape (`diff --git a/<p> b/<p>`
headers, `new file mode` / `deleted file mode` lines, `index` lines may carry any hashes — the
sim applies it with `git apply` and refuses a patch that does not apply); `expected.json` is
`{"findings": [{"check", "severity", "actor"?}], "settled": [{"check", "contains"}]?}`. The sim
copies `base/` to a temporary directory, `git init -q -b main`, commits everything as BASE, `git
apply --index patch.diff`, commits as HEAD, and calls `referee()` with `cloneDir` that directory,
`patchPath` the fixture's `patch.diff`, the stub linker, `n` 0 and `runDir` a temporary directory
it removes; it also asserts the written `referee/task-<id>-0.json` parses to the returned object.
The replay globs only the six prefixes above — the `linker-*` fixtures belong to the linker sim.
Every replay fixture's `produces` is `[]` except `clean-1`'s, and every `consumes` is `[]`.

The fixtures, from the recorded reviewer notes (the species table of the 2026-09-08 harvest, rows
numbered as there) and by construction where the record never saw the species:

| fixture | source | `task.files` | `siblingFiles` | `base/` | `patch.diff` | exam / evidence | expected |
|---|---|---|---|---|---|---|---|
| `footprint-1` | row 3 (run-5 t1): a self-authored test beside the reserved exam path, `.impl.test.ts` | `README.md`, `src/snake.ts`, `tests/snake.test.ts`; proofTests `tests/snake.test.ts` | `[]` | the three files | modifies `src/snake.ts`, adds `tests/snake.impl.test.ts` (two `test(` lines) | `red` / `{cmd: "bun test tests/snake.test.ts", exit: 0}` | one `footprint` `minor` `implementer` |
| `footprint-2` | rows 10/15 (run-10 t1): an edit of a sim the Proof called unchanged | `fleet/run-engine.mjs` | `[]` | `fleet/run-engine.mjs` (a ten-line stub), `fleet/tests/test_run_engine_exam_fix_edit.mjs` (top-level `assert.ok` lines, no `test(`) | modifies both | `null` / `null` | one `footprint` `minor` `implementer`; settled `exam-files` contains `unexamined`; settled `test-count` contains `+0 / −0` |
| `footprint-3` | rows 53/54 (run-17 t1): `_impl.py` beside the exam | `skills/ultrapowers/scripts/compile_plan.py`, `tests/test_compile_plan_engine_self_change.py`; proofTests the test file | `[]` | both | modifies `compile_plan.py`, adds `tests/test_compile_plan_engine_self_change_impl.py` with two `def test_` lines | `red` / exit 0 | one `footprint` `minor`; settled `test-count` contains `+2 / −0` |
| `footprint-4` | rows 60/63 (run-18 t1): `_selfmerge.mjs` beside the exam | `fleet/sandbox-boot.sh`, `fleet/tests/test_sandbox_boot_merge.mjs`; proofTests the sim | `[]` | both | modifies the script, adds `fleet/tests/test_sandbox_boot_selfmerge.mjs` | `red` / exit 0 | one `footprint` `minor` |
| `footprint-5` | rows 118/120 (walk-7 t1): `.local.test.ts` beside the exam | `README.md`, `src/kebab.ts`, `tests/kebab.test.ts`; proofTests the exam | `[["README.md", "src/capitalize.ts", "tests/capitalize.test.ts"]]` | the three own files | modifies `src/kebab.ts`, adds `tests/kebab.local.test.ts` | `red` / exit 0 | one `footprint` `minor` |
| `footprint-6` | row 71 (run-18 t4): an authorized overlap, plus a sibling-only path | `skills/ultrapowers/SKILL.md` | `[["skills/ultrapowers/SKILL.md", "skills/ultrapowers/references/first-run.md"]]` | both | edits both | `null` / `null` | one `footprint` `blocking` `implementer` (first-run.md); settled `footprint` contains `skills/ultrapowers/SKILL.md` |
| `footprint-7` | synthetic: a deleted BASE file | `fleet/janitor.mjs` | `[]` | `fleet/janitor.mjs`, `fleet/retire.mjs` | modifies `janitor.mjs`, deletes `retire.mjs` (`deleted file mode 100644`) | `null` / `null` | one `footprint` `blocking` `implementer` whose detail contains `fleet/retire.mjs` |
| `exam-1` | synthetic: exam file missing, path in FILES | `src/x.ts`, `tests/x.test.ts`; proofTests `tests/x.test.ts` | `[]` | `src/x.ts` only | modifies `src/x.ts` | `red` / `{cmd: "bun test tests/x.test.ts", exit: 0}` | one `exam-files` `blocking` `implementer` |
| `exam-2` | synthetic: exam path outside FILES, created by no sibling | `src/x.ts`; proofTests `tests/x.test.ts` | `[["src/y.ts"]]` | `src/x.ts` | modifies `src/x.ts` | `red` / exit 0 | one `exam-files` `blocking` `plan` |
| `exam-3` | synthetic: the examiner was blocked | `src/x.ts`, `tests/x.test.ts`; proofTests `tests/x.test.ts` | `[]` | `src/x.ts` | modifies `src/x.ts` | `blocked` / `null` | no finding; settled `exam-files` contains `unexamined` |
| `exam-4` | synthetic: the exam itself is already red | as `exam-1` | `[]` | `src/x.ts` | modifies `src/x.ts` | `red` / `{cmd: "bun test tests/x.test.ts", exit: 1}` | no finding; settled `exam-files` contains `already red as the exam` |
| `testcount-1` | synthetic (#257's guard): a `def test_` drop with no deletion word | `src/a.py`, `tests/test_a.py`; proofTests `tests/test_a.py`; body has a Proof with no deletion word | `[]` | `src/a.py`, `tests/test_a.py` with `def test_one` and `def test_two` | modifies `src/a.py`, removes `test_two` | `red` / exit 0 | one `test-count` `minor` `implementer` naming `test_two` |
| `testcount-2` | synthetic: the same drop, declared | as `testcount-1`, body's Context line reads: `test_two` is removed — its behaviour moved into `test_one` | `[]` | same | same | `red` / exit 0 | no finding; settled `test-count` contains `−1` |
| `deps-1` | synthetic: a manifest hunk | `package.json`, `src/a.ts` | `[]` | `package.json` with an empty `dependencies` object, `src/a.ts` | adds `"left-pad": "1.3.0"` under `dependencies`, modifies `src/a.ts` | `null` / `null` | one `dependencies` `minor` `implementer` whose detail contains `left-pad` |
| `secrets-1` | synthetic: a token-shaped literal in source | `src/config.ts` | `[]` | `src/config.ts` | adds a line assigning the 40-character string `ghp_` followed by the 26 upper-case letters and the ten digits | `null` / `null` | one `secrets` `blocking` `implementer` whose detail contains `ghp_` and not the full literal |
| `secrets-2` | synthetic: the same literal under an excluded prefix | `tests/config.test.ts` | `[]` | `tests/config.test.ts` | adds the same line in `tests/config.test.ts` | `null` / `null` | no finding; settled `secrets` |
| `clean-1` | synthetic: entirely inside FILES | `src/z.ts`, `tests/z.test.ts`; proofTests `tests/z.test.ts`; produces one bullet naming `z(a)` | `[["src/w.ts"]]` | both (the test file with one `test(`) | modifies `src/z.ts`, adds one `test(` to `tests/z.test.ts` | `red` / exit 0 | `findings` `[]`; settled checks are exactly `footprint`, `interface`, `exam-files`, `test-count`, `dependencies`, `secrets`, `integrated-suite` |
| `clean-2` | synthetic: the fold overlap | `docs/a.md` | `[["docs/a.md"]]` | `docs/a.md` | edits `docs/a.md` | `null` / `null` | `findings` `[]`; settled `footprint` contains `docs/a.md` |

The interface-consumes rows of the record (105, 107) and the eight "acceptance is suite but only
the exam ran" rows (2, 9, 14, 72, 117, 119, 121, 124) have no fixture: the first are a sibling's
shape and route to the integrated pass, the second are the `integrated-suite` settled line. Evidence-gap,
quality and plan-defect rows stay with the model.
**BASE facts:** (generated at fe0541e)
- `task` at `fleet/run-engine.mjs:2207` blob 95be538
- `findings` at `fleet/doctor.mjs:593` blob f9a1174
- `check` at `fleet/tests/test_sandbox_boot.mjs:288` blob c5a6b7a
- `blocking` at `fleet/run-engine.mjs:1799` blob 95be538
- `plan` at `fleet/doctor.mjs:265` blob f9a1174
- `settled` at `fleet/tests/test_sandbox_boot_merge.mjs:103` blob d980f3d
- `py` at `fleet/run-main.mjs:532` blob 4cb8b21
- `ts` at `fleet/run-engine.mjs:763` blob 95be538
- `runDir` at `fleet/run-main.mjs:588` blob 4cb8b21
- `exam` at `fleet/publish-fold.mjs:163` blob 39fbd16
- `red` at `fleet/publish-fold.mjs:904` blob 39fbd16
- `examEvidence` at `fleet/run-engine.mjs:1674` blob 95be538
- `blocked` at `fleet/run-engine.mjs:1949` blob 95be538
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `delete` at `evals/fixtures/contend-big/project/app/storage.py:31` blob 95a10a1
- `deleted` at `fleet/tests/test_launch_test_command.mjs:388` blob ef7fd8f
- `removed` at `fleet/run-engine.mjs:580` blob 95be538
- `reads` at `fleet/tests/test_claude_token.mjs:405` blob 15a4988
- `files` at `fleet/run-main.mjs:377` blob 4cb8b21
- `withPatchCapture` at `fleet/run-waves.mjs:192` blob 27f25b5
- `fleet/run-waves.mjs` blob 27f25b5
- `baseSha` at `fleet/run-engine.mjs:945` blob 95be538
- `headSha` at `fleet/run-engine.mjs:2092` blob 95be538
- `n` at `fleet/launch.mjs:1034` blob 8cc2fc3
- `fleet/retire.mjs` blob 3c94125
- `REVIEWER_SCHEMA` at `fleet/run-engine.mjs:137` blob 95be538
- `fleet/run-engine.mjs` blob 95be538
- `from` at `fleet/run-main.mjs:398` blob 4cb8b21
- `suite` at `fleet/publish-fold.mjs:939` blob 39fbd16
- `fleet/package.json` blob 3f88b0c
- `runTaskInner` at `fleet/run-engine.mjs:1047` blob 95be538
- `notes` at `fleet/doctor.mjs:321` blob f9a1174
- `produces` at `fleet/run-engine.mjs:279` blob 95be538
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `proofTests` at `fleet/run-engine.mjs:1076` blob 95be538
- `consumes` at `fleet/run-engine.mjs:278` blob 95be538
- `body` at `fleet/claude-token.mjs:401` blob b7e8e7b
- `index` at `fleet/tests/test_publish_fold.mjs:846` blob 7d47d63
- `README.md` blob 47febb7
- `fleet/tests/test_run_engine_exam_fix_edit.mjs` blob 1d5b2ac
- `skills/ultrapowers/scripts/compile_plan.py` blob 6c21a29
- `tests/test_compile_plan_engine_self_change.py` blob f7d8bed
- `tests/test_compile_plan_engine_self_change_impl.py` blob f375809
- `fleet/sandbox-boot.sh` blob a7dc914
- `fleet/tests/test_sandbox_boot_merge.mjs` blob d980f3d
- `fleet/tests/test_sandbox_boot_selfmerge.mjs` blob 00ac21b
- `skills/ultrapowers/SKILL.md` blob f297964
- `fleet/janitor.mjs` blob c8d8258
- `skills/ultrapowers/references/first-run.md` blob 0897044
- `bullet` at `fleet/launch.mjs:337` blob 8cc2fc3
- `cloneDir` at `fleet/run-engine.mjs:1142` blob 95be538

**Proof:**
- Test: `fleet/tests/test_referee_replay.mjs`
- Legs: (a) `referee()` on `clean-1` resolves to an object with exactly the keys `task`, `n`,
  `findings`, `settled`, `linker`, `ms`, `task` equal to the fixture's id, `n` 0, `findings` `[]`,
  `settled` holding one line for each of the six checks plus one `integrated-suite` line and no
  other, `linker` equal to `{"src/z.ts": "ts", "tests/z.test.ts": "ts"}`, an integer `ms >= 0`,
  [M1]; (b) after that call the file `<runDir>/referee/task-<id>-0.json` reads as
  `JSON.stringify(result, null, 2) + '\n'`, and a second call without `runDir` writes no file
  under a fresh temporary directory and resolves to an object with the same keys [M1]; (c) `footprint-1`, `footprint-2`, `footprint-3`,
  `footprint-4` and `footprint-5` each raise one `footprint` `minor` `implementer` finding whose
  detail names the added or edited path, and `clean-1` raises none [M2]; (d) `footprint-6` raises
  exactly one `footprint` `blocking` finding naming `skills/ultrapowers/references/first-run.md`
  and its settled `footprint` line names `skills/ultrapowers/SKILL.md`; `clean-2` raises none
  and its settled `footprint` line names `docs/a.md` [M2]; (e) `footprint-7` raises exactly one
  `footprint` finding, `blocking` `implementer`, whose detail contains `fleet/retire.mjs` [M2];
  (f) `exam-1` raises exactly one `exam-files` `blocking` finding with actor `implementer` and
  `exam-2` exactly one with actor `plan`; a task.json for `exam-1` edited in memory to list the
  same absent path twice in `proofTests` still raises exactly one, and edited to `exam:
  'green-at-base'` still raises exactly one [M3]; (g) `exam-3` and `exam-4`
  raise no `exam-files` finding, and their settled `exam-files` lines contain `unexamined` and
  `already red as the exam` respectively; `clean-1`'s (exam `red`, evidence exit 0) names
  `tests/z.test.ts` [M3]; (h) with a linker stub answering `{status: 'missing', symbol: 'countVowels', detail: 'no export named
  countVowels in src/x.mjs (found: countVowel)'}`, `clean-1` raises exactly one `interface`
  `blocking` `implementer` finding whose detail contains `countVowels` and `countVowel` [M4];
  (i) with the stub answering `declared` it raises exactly one `interface` `minor` finding and
  no blocking one [M4]; (j) with the stub answering `resolved`, and again `unlinked`, it raises
  no `interface` finding and the settled `interface` line carries the stub's detail; the stub
  records exactly one call per produces bullet with `bullet` verbatim, `files` equal to
  `task.files` and `cloneDir` the HEAD directory; `footprint-2` (no produces) gets the settled
  line `no Produces: to link` [M4]; (k)
  `testcount-1` raises one `test-count` `minor` finding naming `test_two`; `testcount-2` raises
  none and its settled line contains `−1`; `footprint-3`'s settled line contains `+2 / −0` and
  `footprint-2`'s `+0 / −0` [M5]; (l) `deps-1` raises one `dependencies` `minor` finding whose
  detail contains `package.json` and `left-pad`; every other fixture's settled `dependencies`
  line is `no manifest changed` [M6]; (m) `secrets-1` raises one `secrets` `blocking`
  `implementer` finding whose detail contains `ghp_` and does not contain the 40-character
  literal; `secrets-2` raises none and carries the settled `secrets` line; a copy of
  `secrets-1`'s patch rewritten in memory so that its one added line is replaced by three added
  lines carrying `AKIAABCDEFGHIJKLMNOP`, `sk-` followed by twenty-four letters, and `-----BEGIN
  RSA PRIVATE KEY-----` raises exactly three `secrets` findings, one naming each pattern [M7]; (n) the replay walks every directory whose name begins `footprint-`, `exam-`,
  `testcount-`, `deps-`, `secrets-` or `clean-`, asserts every
  `expected.json` finding present by `check`/`severity`/`actor` and every settled entry present
  by `check` and contained text, asserts `findings` is `[]` for every `clean-*` fixture, refuses
  a patch `git apply --check` rejects, and asserts `fleet/referee.mjs`'s source imports no
  specifier other than `node:` ones and contains neither `child_process` nor `execFile` [M8].
- Run: node fleet/tests/test_referee_replay.mjs | grep -q 'ALL TESTS PASSED'
- Run: test "$(ls -d fleet/tests/fixtures/referee/*/ | grep -c -E '/(footprint|exam|testcount|deps|secrets|clean)-[0-9]+/$')" = 18

**Stale-if:**
- path-absent: `fleet/run-waves.mjs`
- issue-closed: #729

### Task 2: The interface linker resolves a Produces symbol per language

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/referee-linker.mjs`
- Create: `fleet/tests/fixtures/referee/linker-mjs-1/task.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-1/base/src/foo.mjs`
- Create: `fleet/tests/fixtures/referee/linker-mjs-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-mjs-1/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-2/task.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-2/base/src/foo.mjs`
- Create: `fleet/tests/fixtures/referee/linker-mjs-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-mjs-2/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-3/task.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-3/base/src/foo.mjs`
- Create: `fleet/tests/fixtures/referee/linker-mjs-3/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-mjs-3/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-4/task.json`
- Create: `fleet/tests/fixtures/referee/linker-mjs-4/base/src/boom.mjs`
- Create: `fleet/tests/fixtures/referee/linker-mjs-4/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-mjs-4/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-py-1/task.json`
- Create: `fleet/tests/fixtures/referee/linker-py-1/base/pkg/mod.py`
- Create: `fleet/tests/fixtures/referee/linker-py-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-py-1/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-py-2/task.json`
- Create: `fleet/tests/fixtures/referee/linker-py-2/base/pkg/mod.py`
- Create: `fleet/tests/fixtures/referee/linker-py-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-py-2/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-py-3/task.json`
- Create: `fleet/tests/fixtures/referee/linker-py-3/base/pkg/mod.py`
- Create: `fleet/tests/fixtures/referee/linker-py-3/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-py-3/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-1/task.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-1/base/src/foo.ts`
- Create: `fleet/tests/fixtures/referee/linker-ts-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-ts-1/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-2/task.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-2/base/src/foo.ts`
- Create: `fleet/tests/fixtures/referee/linker-ts-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-ts-2/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-3/task.json`
- Create: `fleet/tests/fixtures/referee/linker-ts-3/base/src/foo.ts`
- Create: `fleet/tests/fixtures/referee/linker-ts-3/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-ts-3/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-1/task.json`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-1/base/fleet/run-engine.mjs`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-1/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-1/expected.json`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-2/task.json`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-2/base/fleet/sandbox-boot.sh`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-2/patch.diff`
- Create: `fleet/tests/fixtures/referee/linker-unlinked-2/expected.json`
- Test: `fleet/tests/test_referee_linker.mjs`

**Claim:** A `Produces:` symbol is looked up in the task's own files at HEAD by a linker for its
language — `import()` for `.mjs`, `ast` for `.py`, an export-declaration scan for `.ts` — and
answered as resolved, declared, missing or unlinked — a renamed export answered `missing` with
both names in the detail, and a symbol the linker cannot read answered `unlinked`, never
`missing`. (derived)
Machine: M1. `fleet/referee-linker.mjs` exports `linkProduces({bullet, files, cloneDir, exec,
timeoutMs})` resolving to `{status, symbol, detail}` with `status` one of `resolved`, `declared`,
`missing`, `unlinked`; `symbol` is the bullet's lead token — the first match of
`^\s*(?:[-*+]\s*)?`?([A-Za-z][\w.-]*)` with any wrapping backtick removed — and the arity, when
the bullet carries a parenthesised list directly after the symbol, is the count of non-empty
comma-separated entries inside it; a `symbol` that does not match `^[A-Za-z_]\w*$`, or that is
followed in the bullet, after optional spaces, by `:`, `/`, `=` or `.`, is `unlinked` without any
file being read; the
candidate files are the entries of `files` whose extension is `.mjs`, `.js`, `.py`, `.ts` or
`.tsx` and which exist under `cloneDir`; no candidate file is `unlinked` with a detail naming the
reason; across candidates `resolved` wins over `declared`, which wins over `unlinked`, which wins
over `missing` — a symbol is `missing` only when every candidate was read and none held it.
M2. `.mjs`/`.js`: one subprocess `node --input-type=module -e <script>` per candidate, cwd
`cloneDir`, killed after `timeoutMs`, whose script dynamically imports the candidate's file URL
and prints JSON `{has: name in module, length: the export's length when it is a function}`;
`has` true is `resolved` with a detail naming the file and `<symbol>/<length>`, except that a
bullet arity below `length` is `declared` with a detail naming both counts (a bullet arity above
`length` is still `resolved` — rest and default parameters make `length` a floor); `has` false
with `\b<symbol>\b` present in the candidate's text is `declared` with the detail `declared, not
exported`; a subprocess that exits non-zero, prints no JSON or is killed at the timeout is
`unlinked` with the detail carrying the first line of its stderr or `timeout`, never a finding
status; and the module runs only that script — never `bash -lc`, never git.
M3. `.py`: one subprocess `python3 -c <script>` per candidate that `ast.parse`s the file and
prints JSON naming the top-level `def`, `class` and simple assignment targets with each `def`'s
count of positional parameters without defaults; a top-level name equal to `symbol` is
`resolved`, with the arity floor rule of M2 applied to that count; `\b<symbol>\b` present in the
text without a top-level definition is `declared`; otherwise `missing`; the file is never
imported.
M4. `.ts`/`.tsx`: a regex scan of the file's text for `export (default )?(async )?function
<symbol>\s*\(`, `export const <symbol>\b`, `export class <symbol>\b`, `export interface
<symbol>\b`, `export type <symbol>\b`, or `<symbol>` as a name inside an `export { … }` list, is
`resolved` (arity from the function's parameter list counting entries without `?`
or `=`, floor rule); `\b<symbol>\b` present without such a declaration is `declared`; otherwise
`missing`; `tsc` is invoked only when `<cloneDir>/node_modules/typescript` exists, and the
fixtures never create it.
M5. Every fixture under `fleet/tests/fixtures/referee/linker-*` answers as its `expected.json`
says: per language one `resolved`, one `declared` and one `missing`; a `.mjs` whose import throws
is `unlinked`; a dotted symbol is `unlinked`, and a shell-function symbol whose only candidate
file is `.sh` is `unlinked`; and a `missing` detail names the symbol, the file it was looked for
in, and the names that file does export.

**Authorized-by:** #729; spec `docs/superpowers/specs/2026-09-09-mechanical-referee.md` §3.3;
operator decisions 2 and 7; spec review round 1 findings 5, 6, 7 and round 2 finding 8.

**Interfaces:**
- Consumes: none
- Produces: `linkProduces({bullet, files, cloneDir, exec, timeoutMs}) -> Promise<{status, symbol, detail}>`

**Context:** The linker is the one piece of the referee that must read a language, so it lives in
its own module and is injected into the referee by the engine; the referee never imports it. The
shared literal every task that touches it carries: `linkProduces({bullet, files, cloneDir, exec,
timeoutMs}) -> Promise<{status, symbol, detail}>`, `status` one of `resolved`, `declared`,
`missing`, `unlinked`. `bullet` is one entry of the compiled task's `interfaces.produces` — the
text after `- Produces:` as the compiler stores it, backticks included, for instance the string
of backtick, `foo(a, b) -> Widget`, backtick — and the lead token is the compiler's own
`_INTERFACE_LEAD_RE`, `^\s*(?:[-*+]\s*)?`?([A-Za-z][\w.-]*)` in
`skills/ultrapowers/scripts/compile_plan.py`, which is why one symbol per bullet is the authoring
rule. `exec` is optional and has the engine's seam shape — `exec(cmd, argv, {cwd, timeoutMs}) ->
Promise<{code, stdout, stderr}>`; the default runs `node:child_process`'s `execFile` with the
same result shape, so the sim runs the real thing and the engine can pass its seam. `timeoutMs`
defaults to thirty minutes (the engine passes its `SHELL_TIMEOUT_MS`, `30 * 60 * 1000`); a
fixture never needs it to fire. `import()` executes the module, so a file whose import throws,
times out or exits the process (a `main()` at module scope, the `launch.mjs` shape) is `unlinked`
with the reason — never a finding, since the reviewer never had this evidence either. The graded
miss (operator decision 7): across the ninety `2026-09-0*` plans 41 of 334 `Produces:` symbols
were report fields, event kinds, paths, shell functions or constant assignments — 12% — so a
non-identifier symbol is `unlinked`, `declared` is the minor grade, and only a name that appears
nowhere in the candidate files is `missing`. A `Consumes:` is never linked. Across candidates the answer is the best grade any candidate
earned, in the order resolved, declared, unlinked, missing: a throwing candidate beside a clean
miss is `unlinked`, because the throwing file may hold the name. The `.ts` path is the
regex scan because the sandbox installs node, bun and pytest only and the fleet sims have no
network (`bunx tsc` would fetch); `tsc --declaration` may run only when
`node_modules/typescript` already exists in the clone. The `.py` path shells out to `python3`
(present on every sandbox: `python3-pytest` is installed by the setup script) and parses with
`ast`, never importing the module. The `.mjs` eval script wraps the `import()` in a try/catch and, on a throw, prints
`e.message` as its first stderr line and exits 1 — which is how `boom at import` reaches the
`unlinked` detail; on success it prints one JSON line `{has, length, names}` where `names` is
`Object.keys(m)`, the list the `(found: …)` clause is built from. The `.py` script prints
`{names: [...], arity: {name: count}}` the same way. Detail wording for a miss, the shape the
referee's blocking finding carries verbatim: `no export named countVowels in src/foo.mjs (found: countVowel)` — the
`(found: …)` clause names the exported or top-level names of that file, comma-separated, and is
omitted when there are none.

The fixture layout matches the sibling replay fixtures — `task.json` `{"task": {"id", "files",
"proofTests", "interfaces": {"consumes", "produces"}, "body"}}`, `base/` the tree at HEAD,
`patch.diff` (empty for every linker fixture: HEAD is `base/`; the sim applies a non-empty one
with `git apply` after committing `base/`), `expected.json` `{"results": [{"symbol", "status",
"contains"?}]}`, one result per produces bullet in order. The sim copies `base/` into a temporary
directory it removes, runs `git init -q -b main` and one commit there (so `cloneDir` is a real
checkout), and calls `linkProduces` for each bullet. The fixtures:

| fixture | `task.files` | `base/` | `produces` | expected |
|---|---|---|---|---|
| `linker-mjs-1` | `src/foo.mjs` | `export function foo (a, b) { return a + b }` and `export const other = 1` | `foo(a, b)`, then `foo(a)` | `resolved` with detail containing `foo/2`; then `declared` with detail containing `arity` |
| `linker-mjs-2` | `src/foo.mjs` | `function foo (a, b) { … }` not exported, `export const other = 1` | `foo(a, b)` | `declared` with detail containing `not exported` |
| `linker-mjs-3` | `src/foo.mjs` | `export function countVowel (s) { … }` | `countVowels(s)` | `missing` with detail containing `countVowels`, `src/foo.mjs` and `countVowel` |
| `linker-mjs-4` | `src/boom.mjs` | `throw new Error('boom at import')` at module scope, then `export function foo () {}` | `foo()` | `unlinked` with detail containing `boom` |
| `linker-py-1` | `pkg/mod.py` | top-level `def foo(a, b):` | `foo(a, b)` | `resolved` |
| `linker-py-2` | `pkg/mod.py` | `def outer():` containing a nested `def foo(a, b):`; no top-level `foo` | `foo(a, b)` | `declared` |
| `linker-py-3` | `pkg/mod.py` | top-level `def bar():` only | `foo(a)` | `missing` with detail containing `foo` and `pkg/mod.py` |
| `linker-ts-1` | `src/foo.ts` | `export function foo(a: number, b: number): number` | `foo(a, b)` | `resolved` |
| `linker-ts-2` | `src/foo.ts` | `function foo(a: number, b: number)` not exported, `export const other = 1` | `foo(a, b)` | `declared` |
| `linker-ts-3` | `src/foo.ts` | `export function bar(): void` only | `foo(a)` | `missing` |
| `linker-unlinked-1` | `fleet/run-engine.mjs` | a ten-line stub exporting `runEngine` | the bullet `report.reviewEconomy` | `unlinked` (dotted symbol; no file is read) |
| `linker-unlinked-2` | `fleet/sandbox-boot.sh` | a shell file defining `record_tags() { :; }` | `record_tags()` | `unlinked` (no linker for `.sh`) |
**BASE facts:** (generated at fe0541e)
- `missing` at `fleet/target.mjs:128` blob c189a05
- `files` at `fleet/run-main.mjs:377` blob 4cb8b21
- `cloneDir` at `fleet/run-engine.mjs:1142` blob 95be538
- `bullet` at `fleet/launch.mjs:337` blob 8cc2fc3
- `skills/ultrapowers/scripts/compile_plan.py` blob 6c21a29
- `exec` at `fleet/publish-fold-block.mjs:69` blob 65a8466
- `SHELL_TIMEOUT_MS` at `fleet/run-engine.mjs:527` blob 95be538
- `names` at `fleet/claude-token.mjs:118` blob b7e8e7b
- `produces` at `fleet/run-engine.mjs:279` blob 95be538
- `boom` at `fleet/tests/test_run_engine_conflict.mjs:458` blob 88b807e
- `fleet/run-engine.mjs` blob 95be538
- `runEngine` at `fleet/run-engine.mjs:739` blob 95be538
- `fleet/sandbox-boot.sh` blob a7dc914
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `cwd` at `fleet/confine-hook.mjs:279` blob cb77dc8

**Proof:**
- Test: `fleet/tests/test_referee_linker.mjs`
- Legs: (a) `linkProduces` on the bullet of `linker-mjs-1`'s first entry returns `symbol`
  `foo` and `status` `resolved`; the bullet `report.reviewEconomy` (`linker-unlinked-1`) and the
  bullets `record_tags()` (`linker-unlinked-2`), `X = 1` and `path/to/thing` each return
  `unlinked` — for the dotted, `=` and `/` bullets with `exec` replaced by a stub that throws, so
  no subprocess ran; a `files` list with no linkable extension returns `unlinked`; and with
  `files` naming a `.mjs` that resolves and a `.py` where the name is `missing`, the answer is
  `resolved` [M1]; (b) `linker-mjs-1` answers `resolved` with `foo/2` in the detail for
  `foo(a, b)` and `declared` with `arity` in the detail for `foo(a)`; a bullet `foo(a, b, c)` on
  the same file answers `resolved`; `linker-mjs-2` answers `declared` with `declared, not exported` in the detail;
  `linker-mjs-3` answers `missing` with `countVowels`, `src/foo.mjs` and the literal `(found:
  countVowel)` in the detail; `linker-mjs-4` answers `unlinked` with `boom` in the detail; with `exec` replaced by a
  recording stub, the argv the linker issues for a `.mjs` candidate begins `node`,
  `--input-type=module`, `-e` and the stub's `cwd` is `cloneDir`; with the default `exec` and `timeoutMs` 500 on a
  `.mjs` written by the sim whose module scope starts a `setInterval` and then awaits a promise
  that never settles (so the process neither exits nor prints), the answer is `unlinked` with
  `timeout` in the detail, within five seconds; with `files` naming that hanging `.mjs` and a
  second `.mjs` where the name is absent, the answer is `unlinked`, not `missing` [M2]; (c) `linker-py-1` answers `resolved`, `linker-py-2` `declared`,
  `linker-py-3` `missing` naming `foo` and `pkg/mod.py`; with `exec` replaced by a recording
  stub the argv begins `python3`, `-c` and no argv element is `-m` or names `import pkg`
  [M3]; (d) `linker-ts-1` answers `resolved`, `linker-ts-2` `declared`, `linker-ts-3` `missing`;
  a bullet `foo(a)` on `linker-ts-1` answers `declared` with `arity`; a `.ts` written by the sim
  with `function foo() {}` followed by `export { foo }`, and another with `export default function
  foo() {}`, each answer `resolved`; with `exec` replaced by a stub that throws, every `.ts` case
  still answers (no subprocess for `.ts` when `node_modules/typescript` is absent) [M4]; (e) the sim walks every `fleet/tests/fixtures/referee/linker-*` directory,
  builds a checkout from `base/`, and asserts each `expected.json` result by `symbol`, `status`
  and contained text; the twelve directories are exactly `linker-mjs-1` … `linker-mjs-4`,
  `linker-py-1` … `linker-py-3`, `linker-ts-1` … `linker-ts-3`, `linker-unlinked-1`,
  `linker-unlinked-2` [M5].
- Run: node fleet/tests/test_referee_linker.mjs | grep -q 'ALL TESTS PASSED'
- Run: test "$(ls -d fleet/tests/fixtures/referee/linker-*/ | wc -l | tr -d ' ')" = 12

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #729

### Task 3: The engine runs the referee before any reviewer

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_referee.mjs`
- Test: `fleet/tests/test_run_engine_review_pair.mjs`
- Test: `fleet/tests/test_run_engine_review_economy.mjs`

**Claim:** Every task's captured patch is graded by the referee inside the driver's pre-review
pass; a blocking finding the implementer can act on takes the same one repair round a red `Run:`
takes, a plan defect is parked for the gate, the reviewer reads the settled facts as a `REFEREE:`
block, a `peer` task whose blocking finding was repaired gets one reviewer instead of two, and the
report counts what the referee found. (derived)
Machine: M1. `prePass()` runs for every task, its command, exam and check legs empty when the
task declares none, and after them calls `referee()` (from `fleet/referee.mjs`) with the task,
`patchPath` the driver-captured `impl.patch`, `cloneDir`, the wave's other tasks' `files` arrays
as `siblingFiles`, the task's `exam`, that pass's exam evidence, `n`, the linker and `runDir` — so
`<runDir>/referee/task-<id>-0.json` exists for a task with no `Run:`, no `Check:` and no exam,
and `n` is the number of fix rounds that preceded the graded patch: `0` for the pre-pass tree,
`1` after `fix:<id>:0`, and in round 2 `proofFixes + 1`.
M2. In the pre-pass, each `implementer`-actor `blocking` referee finding joins `reds` as `{line:
detail, stdout: ''}`, so a task with a red `Run:` and such a finding gets exactly one
`fix:<id>:0` dispatch whose prompt lists both lines under `Blocking issues to resolve:`, and
zero `review:` dispatches before it; after that round the whole pass — commands, exam, checks,
referee — repeats once, and `referee/task-<id>-1.json` exists beside `-0.json`; still red after
the round the task fails with `reviewVerdict` `proof-red` when any command, exam or check is red
and `referee-red` when only the referee is, `notes` carrying the detail, and no reviewer is
dispatched.
M3. A `plan`-actor `blocking` referee finding never joins `reds`: its raw detail is pushed to
`planDefects` for the task, a judgment call `task <id>: referee <check> — <detail>` is recorded,
and the task proceeds to review; on a `done` task that detail appears once in `notes` prefixed
`plan-defect: ` and once in `deferredVerification` with reason `plan-defect`.
M4. The exam-files rule at the seam: a `Test:` path absent at HEAD with an exam that exited 0
yields exactly one blocking finding — actor `implementer` when the path is in the task's FILES
(a `fix:<id>:0` round follows), `plan` otherwise (no fix round, and a `peer` task still gets two
reviewers); an `exam` of `blocked` yields a settled `unexamined` line and no finding.
M5. Every review round's prompt ends with a `REFEREE:` block rendered by an exported pure
function `refereeBlock(result)` from that round's `referee/task-<id>-<n>.json` — an opening
sentence beginning `REFEREE: the driver's own arithmetic over the patch`, then one line per
finding carrying its severity and detail, then one line per settled entry — placed after the
CHECK EVIDENCE block, and `refereeBlock(null)` renders `''`; referee `minor` findings are appended
to `priorMinors` (de-dup on `detail`), so a task that merges carries them in `notes` and round
2's PRIOR-ROUND ADVISORIES block lists them.
M6. Round 2 (after `fix:<id>:1`) re-runs the referee on the repaired patch after that round's
re-executed evidence and before any reviewer dispatch, writing `-<proofFixes + 1>.json`; an
`implementer`-actor blocking finding there ends the task `fix-loop-exhausted` with the detail in
`notes` and no round-2 reviewer dispatch.
M7. Pair rule: on a task whose profile `isPairReview` says pair, a review round dispatches
exactly one reviewer (`review:<id>:<iter>`, no pass suffix) when the pre-review pass that
preceded it raised an `implementer`-actor blocking referee finding and repaired it in
`fix:<id>:0`, and two (`review:<id>:<iter>:1` and `:2`) otherwise — a clean or minor-only pass,
and a pass whose only blocking finding had actor `plan`; `pairRounds` counts only two-reviewer
rounds and `refereeSkippedPairs` counts the one-reviewer rounds.
M8. `report.reviewEconomy` carries exactly `reviewerMs`, `blockingFindings`,
`blockingPerReviewerMinute`, `pairRounds`, `r2MarginalBlocking`, `refereeFindings` (every
referee finding of the run, all severities, all rounds), `refereeBlocking` (the blocking ones)
and `refereeSkippedPairs`.
M9. The linker the engine hands the referee is `args.linker` when that is a function and
otherwise `linkProduces` from `fleet/referee-linker.mjs` called with the engine's `exec` seam and
`SHELL_TIMEOUT_MS`; a run whose tasks touch only files with no linkable extension records only
`unlinked` and `no Produces: to link` settled lines and raises no `interface` finding.
M10. Everything else a review prompt carried is unchanged: with the `REFEREE:` block cut from
its header to the end of the prompt, every role's prompt on a run with no `proofRuns`, no
`constraintChecks` and clean reviews is byte-identical to the same run on the engine at
`2cc873fb2d040fbe081f35ff0ababc408eaa6500`.

**Authorized-by:** #729; spec `docs/superpowers/specs/2026-09-09-mechanical-referee.md` §3.1, §3.4,
§3.5, §4.2 (a)–(d); operator decisions 3, 5, 6; spec review round 1 findings 1, 2, 3, 4, 9,
round 2 findings 1–5, round 3 findings 1, 2, 4, 6, 7, round 4 findings 1 and 2.

**Interfaces:**
- Consumes: `referee(opts) -> Promise<{task, n, findings, settled, linker, ms}>`
- Consumes: `linkProduces({bullet, files, cloneDir, exec, timeoutMs}) -> Promise<{status, symbol, detail}>`
- Produces: `refereeBlock(result) -> string`

**Context:** The seam is `runTaskInner` in `fleet/run-engine.mjs`. Ground truth at BASE, by
region rather than line, since sibling runs are editing this file: the pre-review pass is the
block headed by the comment `the driver's own Run:/Check: pass`, where `runCommands(iter)`,
`runExam(iter)` and `runChecks(iter)` are defined, `RUN_FAIL`, `CHECK_FAIL` and `EXAM_FAIL` mint
the red lines, and `prePass()` is defined INSIDE the guard `if (proofRuns.length ||
constraintChecks.length || examRunnable)` — that guard goes: `prePass()` runs for every task and
its legs are empty when the task declares none. `reds` is the array of `{line, stdout}` the
`fix:<id>:0` prompt renders as `- <line>` followed by the output header; a referee finding joins
it as `{line: detail, stdout: ''}` so the fix prompt carries the detail verbatim. `proofFixes` is
set to 1 when the pass was red; keep that meaning — a referee-only red still counts as one
pre-review repair round, and the `still red after the pre-review repair round` return chooses
`proof-red` when any command, exam or check is red and the new `referee-red` when only referee
findings remain. The review loop is `for (let iter = 1; iter <= 2; iter++)` where `reviewPrompt`
is assembled as `roles.reviewer + taskBodyBlock + PATCH + HEAD + BASE + filesLine + siblingsStr +
globalConstraintsBlock + interfacesLine + priorAdvisoriesBlock(priorMinors) + EXAM EDITED +
runEvidenceBlock + examEvidenceBlock + checkEvidenceBlock`; the `REFEREE:` block goes last, after
`checkEvidenceBlock`. The pair branch is `if (isPairReview(taskReviewProfile(task)))` dispatching
`timedReview(reviewPrompt, reviewOpts(1))` and `reviewOpts(2)` concurrently, incrementing
`pairRounds` and computing `r2MarginalBlocking`; the single branch dispatches `reviewOpts()`. The
actor routing is `routeToPlan(i)` with `planDefects.push({task: task.id, detail})` for a
plan-actor issue; `planNotes` renders them as `plan-defect: <detail>` into `notes`, and the
report's end pushes every `planDefects` entry of a `done` task into `deferredVerification` with
reason `plan-defect` and a judgment call — that carry is run-scoped already, so a pre-pass push
needs no new plumbing. `priorMinors` is the array round 2's `priorAdvisoriesBlock` reads and
`notes` joins. `reviewEconomy` is built in the report object at the end of `runEngine` from the
run-scoped counters `reviewerMs`, `reviewerBlockingKeys`, `pairRounds`, `r2MarginalBlocking`;
add three run-scoped counters beside them. Sibling files: `runTask(task, waveBaseSha,
siblingLine(task, WAVES[w]))` is called from the wave loop with the RENDERED sibling string; pass
the structured list too — `WAVES[w].filter((t) => t.id !== task.id).map((t) => t.files || [])` —
built where `siblingLine` builds its string, never parsed back out of the string. `runDir` is
`paths.runDir`; the patches directory is `patchPrefix`; `impl.patch` is the captured patch's
absolute path and `impl.headSha` the clone's head. `exam` is the local variable holding `red`,
`green-at-base`, `blocked` or `null`; the pass's exam evidence is `preExam` (round 1) and
`runExam(iter)`'s result (round 2). `SHELL_TIMEOUT_MS` is exported from this file; `exec` is the
engine's seam. Import `referee` from `./referee.mjs` and `linkProduces` from
`./referee-linker.mjs`; the linker seam for sims is `args.linker` (a function, in-process only —
`run-main.mjs` never sets it); the engine hands the referee a closure `(o) => linker({...o, exec,
timeoutMs: SHELL_TIMEOUT_MS})` so the referee itself passes only `{bullet, files, cloneDir}`. The
pair decision is one per-task boolean set in the pre-pass — true when a `fix:<id>:0` round was
dispatched with at least one `implementer`-actor blocking referee finding among its lines — read
by round 1's dispatch and never by round 2's — round 2 of a pair task always dispatches two
reviewers, since a round-2 blocking referee finding ends the task before any dispatch. The
byte-pin run of the economy sim is referee-clean as well as review-clean: its tasks write only
their own `files` entries, so no `fix:` dispatch appears that BASE's engine never made.

The shared literals this task reads: the `referee.json` shape — `{task, n, findings:
[{check, severity, actor, detail}], settled: [{check, detail}], linker: {path: lang}, ms}` with
`check` one of `footprint`, `interface`, `exam-files`, `test-count`, `dependencies`, `secrets`
(settled also `integrated-suite`), `severity` one of `blocking`, `minor`, `actor` one of
`implementer`, `plan`; the referee's call signature `referee({task, patchPath, baseSha, headSha,
cloneDir, siblingFiles, exam, examEvidence, n, linker, runDir})`, which writes
`<runDir>/referee/task-<id>-<n>.json` itself and resolves to the object; and the linker's
`linkProduces({bullet, files, cloneDir, exec, timeoutMs}) -> Promise<{status, symbol, detail}>`,
`status` one of `resolved`, `declared`, `missing`, `unlinked`. The referee treats
`task.proofTests` as inside the footprint and grades the exam-files check from the `exam` and
`examEvidence` it is handed, so the engine passes the SAME evidence the pass minted its
`EXAM_FAIL` red from — that is what makes a red exam and an absent path one finding, not two.

The judgment-call literal for every blocking referee finding, both actors: `task <id>: referee
<check> — <detail>`. The `REFEREE:` block's opening sentence, verbatim: `REFEREE: the driver's own
arithmetic over the patch — the footprint, whether every Produces: symbol resolves at HEAD, and
whether every exam file exists and ran. A line marked settled is decided; a line marked as a
finding is already the fix loop's.` — then `- blocking: <detail>` / `- minor: <detail>` per
finding and `- settled (<check>): <detail>` per settled entry. The block must never contain the
strings `EXAM EVIDENCE:`, `RUN EVIDENCE:` or `CHECK EVIDENCE:` — `test_run_engine_exam_evidence.mjs`
asserts those block names are absent from a prompt that carries no such block, and
`test_run_engine_pre_review.mjs` pins the CHECK EVIDENCE block as following RUN EVIDENCE to the
byte, which is why the referee block sits after it and nowhere else.

Pins this behaviour change owns, all in this task's Test files: `test_run_engine_review_economy.mjs`
holds `ECONOMY_KEYS` as the sorted five-key list and asserts `deepEqual(Object.keys(eco).sort(),
ECONOMY_KEYS)` twice — it becomes the eight keys; its leg (h) `[M8]` drives the BASE engine at
`2cc873fb2d040fbe081f35ff0ababc408eaa6500` (skipped in a depth-1 clone) and asserts every role's
prompt byte-identical — every review prompt now ends with the `REFEREE:` block by design, so
that comparison is made on the prompt with the block removed (from the index of `\n\nREFEREE:`
to the end; a prompt without the block is compared whole), which is this task's M10.
`test_run_engine_review_pair.mjs` owns the pair profile's dispatch shape (`review:T1:1:1`,
`review:T1:1:2`, the advisories block, `notes` union); its legs stand as written, since their
tasks list every path they write in `files`, and the pair-rule legs of this task extend it under a
comment naming this task. The rig: `rig({repo, runDir, waves, stub, extraArgs})` of
`fleet/tests/_engine_helpers.mjs` — `extraArgs` merges into `runEngine`'s `args`, which is how a
sim passes `args.linker`; a stub receives `(prompt, opts, cwd)` with `opts.label` one of
`impl:<id>`, `exam:<id>`, `fix:<id>:<n>`, `review:<id>:<iter>[:<pass>]`, `integration`; `makeRepo`
seeds `check.sh` and `a.txt`; `doneImpl(cwd)`, `passReview()`, `cleanCritic()` are the canned
replies; `report.tasks[]` rows carry `status`, `reviewVerdict`, `notes`, `proofFixes`,
`fixIterations`; `report.judgmentCalls`, `report.deferredVerification`, `report.reviewEconomy`
are the run-level records. A task object in a sim is `{id, title, files, tier, review, writes,
commutes, proofTests, proofRuns, interfaces, body}`; a `.mjs` file in `files` with a
`produces` bullet naming an export the implementer stub does not write is how leg (a) is driven
when the real linker is used, and `args.linker` stubs are how it is driven without one. The
engine sims that exist at BASE carry tasks whose `files` are `.txt` and `.sh` paths and whose
`produces` bullets are backticked words like `ONE` — every one of them links `unlinked`, so
wiring the real linker raises no finding in them (M9's second clause is the pin).
**BASE facts:** (generated at fe0541e)
- `peer` at `fleet/run-engine.mjs:1295` blob 95be538
- `cloneDir` at `fleet/run-engine.mjs:1142` blob 95be538
- `files` at `fleet/run-main.mjs:377` blob 4cb8b21
- `exam` at `fleet/publish-fold.mjs:163` blob 39fbd16
- `n` at `fleet/launch.mjs:1034` blob 8cc2fc3
- `runDir` at `fleet/run-main.mjs:588` blob 4cb8b21
- `blocking` at `fleet/run-engine.mjs:1799` blob 95be538
- `reds` at `fleet/run-engine.mjs:1564` blob 95be538
- `notes` at `fleet/doctor.mjs:321` blob f9a1174
- `plan` at `fleet/doctor.mjs:265` blob f9a1174
- `planDefects` at `fleet/run-engine.mjs:891` blob 95be538
- `done` at `fleet/run-worker.mjs:972` blob 3606982
- `deferredVerification` at `fleet/run-engine.mjs:2472` blob 95be538
- `blocked` at `fleet/run-engine.mjs:1949` blob 95be538
- `priorMinors` at `fleet/run-engine.mjs:1661` blob 95be538
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `isPairReview` at `fleet/run-engine.mjs:289` blob 95be538
- `pairRounds` at `fleet/run-engine.mjs:906` blob 95be538
- `reviewerMs` at `fleet/run-engine.mjs:905` blob 95be538
- `r2MarginalBlocking` at `fleet/run-engine.mjs:907` blob 95be538
- `exec` at `fleet/publish-fold-block.mjs:69` blob 65a8466
- `SHELL_TIMEOUT_MS` at `fleet/run-engine.mjs:527` blob 95be538
- `proofRuns` at `fleet/run-engine.mjs:1148` blob 95be538
- `constraintChecks` at `fleet/run-engine.mjs:834` blob 95be538
- `runTaskInner` at `fleet/run-engine.mjs:1047` blob 95be538
- `fleet/run-engine.mjs` blob 95be538
- `RUN_FAIL` at `fleet/run-engine.mjs:1548` blob 95be538
- `CHECK_FAIL` at `fleet/run-engine.mjs:1549` blob 95be538
- `EXAM_FAIL` at `fleet/run-engine.mjs:1553` blob 95be538
- `proofFixes` at `fleet/run-engine.mjs:1387` blob 95be538
- `reviewPrompt` at `fleet/run-engine.mjs:1680` blob 95be538
- `checkEvidenceBlock` at `fleet/run-engine.mjs:347` blob 95be538
- `planNotes` at `fleet/run-engine.mjs:1807` blob 95be538
- `priorAdvisoriesBlock` at `fleet/run-engine.mjs:405` blob 95be538
- `runEngine` at `fleet/run-engine.mjs:739` blob 95be538
- `reviewerBlockingKeys` at `fleet/run-engine.mjs:908` blob 95be538
- `siblingLine` at `fleet/run-engine.mjs:465` blob 95be538
- `patchPrefix` at `fleet/run-engine.mjs:860` blob 95be538
- `red` at `fleet/publish-fold.mjs:904` blob 39fbd16
- `preExam` at `fleet/run-engine.mjs:1560` blob 95be538
- `check` at `fleet/tests/test_sandbox_boot.mjs:288` blob c5a6b7a
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `missing` at `fleet/target.mjs:128` blob c189a05
- `examEvidence` at `fleet/run-engine.mjs:1674` blob 95be538
- `ECONOMY_KEYS` at `fleet/tests/test_run_engine_review_economy.mjs:49` blob 8d80cc9
- `fleet/tests/_engine_helpers.mjs` blob 8aa0df0
- `extraArgs` at `fleet/tests/test_run_engine_fold_subject.mjs:50` blob 8a38a1b
- `args` at `fleet/publish-fold.mjs:669` blob 39fbd16
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `makeRepo` at `fleet/tests/_engine_helpers.mjs:21` blob 8aa0df0
- `produces` at `fleet/run-engine.mjs:279` blob 95be538
- `findings` at `fleet/doctor.mjs:593` blob f9a1174
- `failed` at `fleet/run-engine.mjs:1005` blob 95be538
- `T1` at `fleet/tests/test_publish_fold.mjs:237` blob 7d47d63
- `clean` at `fleet/claude-token.mjs:109` blob b7e8e7b
- `judgmentCalls` at `fleet/run-engine.mjs:880` blob 95be538
- `reason` at `fleet/run-engine.mjs:690` blob 95be538
- `add` at `evals/fixtures/flawed/reference/apistub/store.py:9` blob c96aa3c
- `fleet/tests/test_run_engine_review_pair.mjs` blob 6ae7389
- `fleet/tests/test_run_engine_review_economy.mjs` blob 8d80cc9

**Proof:**
- Test: `fleet/tests/test_run_engine_referee.mjs`
- Test: `fleet/tests/test_run_engine_review_pair.mjs`
- Test: `fleet/tests/test_run_engine_review_economy.mjs`
- Legs (in `fleet/tests/test_run_engine_referee.mjs`): (a) a lean task with `proofRuns: []`,
  no checks and `proofTests: []` whose implementer writes only its one `files` entry ends `done`
  and `<runDir>/referee/task-<id>-0.json` exists, parses, and carries `findings` `[]` and a
  settled `footprint` line; a task in `files: ['x.mjs']` whose `produces` is one bullet naming
  `countVowels(s)` and whose implementer writes `x.mjs` exporting `countVowel` gets, with
  `args.linker` a stub answering `missing` with detail `no export named countVowels in x.mjs
  (found: countVowel)` on the first call and `resolved` afterwards, exactly one `fix:<id>:0`
  dispatch whose prompt contains `countVowels` and `countVowel` under `Blocking issues to
  resolve:`, no `review:` label before it in the dispatch order, and both `-0.json` (one
  `interface` `blocking` finding) and `-1.json` (`findings` `[]`) on disk; the same task with
  `proofRuns: ['test -e c.txt']` and a fix stub that writes `c.txt` gets exactly one `fix:<id>:0`
  dispatch whose prompt carries both the `the Proof's Run: command failed: test -e c.txt` line
  and the `countVowels` line; on the task with no `Run:`, with the fix stub writing nothing and the linker stub always
  `missing`, the task ends `failed`, `reviewVerdict` `referee-red`, `notes` containing
  `countVowels`, `proofFixes` 1 and no `review:` dispatch; on the repaired `countVowels` task the
  round-1 review prompt's `REFEREE:` block is the rendering of `-1.json` (no `countVowels` line),
  not of `-0.json`; with the fix stub writing nothing and
  the linker stub answering `resolved` on the second call but the `Run:` still red the verdict
  is `proof-red` [M1, M2]; (b) a task whose implementer writes its `files` entry and also
  deletes `a.txt` (present at BASE, absent from `files`) gets a `fix:<id>:0` prompt containing
  `a.txt` and, when the fix stub restores `a.txt`, ends `done`; two same-wave tasks `T1` (`files:
  ['t1.txt']`) and `T2` (`files: ['t2.txt']`) where T1's implementer writes `t1.txt` and `t2.txt`
  gets T1 a `fix:T1:0` prompt naming `t2.txt` as a sibling path; two same-wave tasks whose `files`
  both list `shared.txt` and both write it end `done` with no `footprint` finding in either
  `-0.json`; a task whose implementer writes its `files` entry and an extra `helper.txt` ends
  `done` with `reviewVerdict` `clean`, no `fix:` dispatch, `notes` containing `helper.txt`, and
  the round-1 review prompt's `REFEREE:` block containing `minor` and `helper.txt` [M2, M5];
  (c) a lean task with `files: ['one.txt']`, `proofTests: ['t1_test.sh']` and `testCmd: 'bash
  check.sh'`, whose examiner stub returns `{status: 'DONE', summary: 'exam written'}` without
  writing any file (so the handoff copies nothing and the driver's exam runs with `t1_test.sh`
  absent at HEAD, exit 0) and whose implementer writes `one.txt`: the task ends `done` with no
  `fix:` dispatch, `-0.json` carries exactly one `exam-files` `blocking` finding with actor
  `plan`, `judgmentCalls` contains a line beginning `task T1: referee exam-files —`, the row's
  `notes` contains `plan-defect: ` followed by that detail exactly once, and
  `deferredVerification` holds exactly one item with `deliverable` `T1` and `reason`
  `plan-defect` [M3, M4]; (d) the same shape with `files: ['one.txt', 't1_test.sh']` gets a
  `fix:T1:0` dispatch whose prompt names `t1_test.sh`, and with the fix stub writing
  `t1_test.sh` ends `done` with `proofFixes` 1 and `fixIterations` 0; the shape of the previous
  leg with `review: 'peer'` and the examiner stub returning `{status: 'BLOCKED', summary: 'no'}`
  leaves `-0.json` with no finding and a settled `exam-files` line containing `unexamined`, and
  makes two `review:T1:1:` dispatches; the plan-actor shape of the previous leg with `review:
  'peer'` also makes two `review:T1:1:` dispatches and `refereeSkippedPairs` 0 [M4, M7]; (e) `refereeBlock(null)` and `refereeBlock(undefined)` return `''`;
  `refereeBlock({findings: [{check: 'footprint', severity: 'minor', actor: 'implementer',
  detail: 'd1'}], settled: [{check: 'secrets', detail: 's1'}]})` begins with `\n\nREFEREE: the
  driver's own arithmetic over the patch`, contains `- minor: d1` and `- settled (secrets): s1`,
  and contains none of `EXAM EVIDENCE:`, `RUN EVIDENCE:`, `CHECK EVIDENCE:`; in a run the
  round-1 review prompt's last block is that rendering of `-0.json` (`prompt.slice(prompt.indexOf('\n\nREFEREE:'))` equals `refereeBlock(parsed -0.json)`), and it sits after
  `CHECK EVIDENCE:` when checks exist; a task with an outside-FILES minor whose round-1 reviewer
  returns one blocking issue gets a round-2 prompt whose `PRIOR-ROUND ADVISORIES` block lists
  the minor's detail exactly once, although round 2's referee raised the same minor again, and
  the row's `notes` carries it once [M5]; (f) a lean task whose round-1 reviewer returns a blocking issue and
  whose `fix:<id>:1` stub writes the file AND deletes `a.txt` (a deleted BASE file outside
  `files`) ends `failed`, `reviewVerdict` `fix-loop-exhausted`, `notes` containing `a.txt`, with
  no `review:<id>:2` dispatch, and `referee/task-<id>-1.json` exists (proofFixes 0, so round 2's
  file is `-1`); the same with a green pre-pass `proofRuns` red first (proofFixes 1) writes
  `-2.json` [M1, M6]; (g) `args.linker` absent: a task with `files: ['a.txt']` and `produces`
  the backticked bullet `ONE` ends `done` and `-0.json` carries an `interface` settled line
  containing `unlinked` and no `interface` finding; a task with no `interfaces` key at all ends
  `done` with the settled line `no Produces: to link`; a task with `files: ['lib.mjs']`, `produces`
  the bullet `add(a, b)`, whose implementer writes `lib.mjs` with `export function add (a, b)`
  ends `done` with a settled `interface` line containing `add/2`, and one whose implementer
  writes `export function plus (a, b)` instead gets a `fix:<id>:0` prompt containing `add` and
  `plus` [M9]; (h) `report.reviewEconomy.refereeFindings` equals the count of findings across
  every `referee/*.json` of the run and `refereeBlocking` the blocking ones: both 0 on a run
  whose only task is clean, `1` and `0` on the `helper.txt` run, `1` and `1` on the deleted-`a.txt`
  run (its `-1.json` is clean) [M8].
- Legs (in `fleet/tests/test_run_engine_review_pair.mjs`, under a comment naming this task): (i)
  a `peer` task whose implementer writes an outside-FILES `helper.txt` (a minor) and whose
  reviewers pass gets `review:T1:1:1` and `review:T1:1:2`, `pairRounds` 1,
  `refereeSkippedPairs` 0; a `peer` task whose implementer deletes `a.txt` (blocking, repaired by
  the fix stub restoring it) gets exactly one round-1 review dispatch labelled `review:T1:1`
  (no `:1`/`:2` suffix), `pairRounds` 0, `refereeSkippedPairs` 1, and ends `done`; a `peer` task
  with a clean referee gets two; a `peer` task with a plan-actor exam-files finding (the
  examiner-returns-DONE-writes-nothing shape) gets two and `refereeSkippedPairs` 0 [M7]; (j)
  the four legs that stand at BASE in this file still pass unchanged [M7].
- Legs (in `fleet/tests/test_run_engine_review_economy.mjs`): (k) `ECONOMY_KEYS` is the sorted
  eight-key list and both `deepEqual` assertions on `Object.keys(eco).sort()` hold [M8]; (l) the
  byte-pin against the `2cc873fb2d040fbe081f35ff0ababc408eaa6500` engine compares each role's
  prompt with the text from `\n\nREFEREE:` to the end removed (unchanged when absent), and every
  role's prompt so trimmed is byte-identical to BASE's; the same run's every review prompt
  contains `\n\nREFEREE:` exactly once [M10].
- Run: node fleet/tests/test_run_engine_referee.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_pair.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_economy.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_actor_routing.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_peer.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_fixloop.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/referee.mjs`
- path-absent: `fleet/referee-linker.mjs`
- issue-closed: #729

### Task 4: The reviewer reads the referee's facts instead of re-deriving them

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/roles/reviewer.md`

**Claim:** A reviewer is no longer asked to compute the footprint or check that the diff produces
the named `Produces:` contract; it is told that a `REFEREE:` block, when present, has decided
those, that a settled line is not a finding, and that the one judgment left in that territory — a
criterion unsatisfiable only because a sibling-owned file is absent at BASE — is still its own.
(derived)
Machine: M1. `fleet/roles/reviewer.md` contains none of the strings `FILES is the expected
footprint`, `deleting a file present at BASE`, `touching a SIBLING FILES path`: the numbered
duty that opened with the first of them is deleted whole.
M2. It contains neither `and against INTERFACES` nor `the diff produces the named Produces
contract`, and duty 4 reads `Gate the diff against each GLOBAL CONSTRAINT given.` and nothing
more on that item.
M3. It contains one paragraph beginning `REFEREE, when present, is the driver's own arithmetic
over the patch` which also contains `A line marked settled is decided`, `re-deriving it is not a
finding`, `leave the routing to the loop that owns it` and `missing dependency edge`.
M4. Duties 1, 2, 5, 6, 7 and 8 keep their numerals and their text: the file still contains `1.
Map everything the task requires`, `2. Flag work the task does not require`, `5. Code quality:`,
`6. Plan-supplied code is not privileged.`, `7. A diff is a result, not a history`, `8. EXAM
EDITED, when present`, the actor paragraph beginning `Every issue names its `actor``, and the
`RUN EVIDENCE, when present`, `EXAM EVIDENCE, when present` and `CHECK EVIDENCE, when present`
paragraphs; and the role-file sims that pin its rules still pass.

**Authorized-by:** #729; spec `docs/superpowers/specs/2026-09-09-mechanical-referee.md` §1, §3.4,
§4.2 (g); operator decision 4; spec review round 1 findings 10 and 13.

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the role file is read by the engine at dispatch

**Context:** The role file at BASE is a numbered list of eight duties followed by the actor
paragraph and the RUN / EXAM / CHECK EVIDENCE paragraphs, the prose-constraint paragraph, the
`unverified:` paragraph and the closing two. Duty 3 at BASE reads, in full: `FILES is the expected
footprint, not a fence: modifying a path outside it is minor, naming that path; deleting a file
present at BASE but absent from FILES is blocking. So is touching a SIBLING FILES path, or a
criterion unsatisfiable only because a sibling-owned file is absent at BASE — name it and "missing
dependency edge".` Its two arithmetic sentences are deleted and its one judgment clause (the
sibling-owned file absent at BASE) moves into the new paragraph, so the numbered item is removed
whole; the remaining duties keep their numerals (the list reads 1, 2, 4, 5, 6, 7, 8 — engine
comments and sims name rules by number, `rule 6`, `rule 8`). Duty 4 at BASE reads `Gate the diff
against each GLOBAL CONSTRAINT given, and against INTERFACES: the diff produces the named Produces
contract with its stated types and uses each Consumes symbol as named.` — it becomes `Gate the
diff against each GLOBAL CONSTRAINT given.` The paragraph to add, placed directly after the CHECK
EVIDENCE paragraph and verbatim from the spec:

    REFEREE, when present, is the driver's own arithmetic over the patch: the footprint (paths outside
    FILES, sibling paths, deleted BASE files), whether every `Produces:` symbol resolves at HEAD, and
    whether every exam file exists and ran. A line marked settled is decided — re-deriving it is not
    a finding. A line marked as a finding is already the fix loop's — say what the diff gets wrong and
    leave the routing to the loop that owns it. What it cannot see is still yours: a criterion
    unsatisfiable only because a sibling-owned file is absent at BASE — name it and "missing
    dependency edge".

Prose word counts in `fleet/roles/*.md` are reported by CI and gate nothing (#496). The pins that
read this file at BASE and must keep passing: `fleet/tests/test_roles_peer.mjs` (no word
`adversarial` in any role; the three patterns `plan-defect:` … `blocking` … `FILES`,
`red-then-green`, `unverified:` in reviewer.md and not in fix.md; the critic's opening sentence),
`fleet/tests/test_run_engine.mjs` (rule 6's plan-defect/blocking/FILES pattern and rule 7's
`red-then-green` with `is not a finding`), and `fleet/tests/test_run_engine_exam_evidence.mjs`
(a paragraph naming `EXAM EVIDENCE`). The engine renders the block whose name this paragraph
teaches as `REFEREE:` with a colon; the paragraph, like its three siblings, uses the comma form
so a prompt with no block never matches a `REFEREE:` grep. Nothing in `fleet/run-engine.mjs`
reads this file except `loadRoles`, and nothing else in this plan touches it.
**BASE facts:** (generated at fe0541e)
- `fleet/roles/reviewer.md` blob a1e35d8
- `fleet/tests/test_roles_peer.mjs` blob 4847687
- `blocking` at `fleet/run-engine.mjs:1799` blob 95be538
- `fleet/tests/test_run_engine.mjs` blob d4f826c
- `fleet/tests/test_run_engine_exam_evidence.mjs` blob d5b39fb
- `fleet/run-engine.mjs` blob 95be538
- `loadRoles` at `fleet/run-engine.mjs:209` blob 95be538

**Proof:**
- Run: test "$(grep -c 'FILES is the expected footprint' fleet/roles/reviewer.md)" = 0
- Run: test "$(grep -c 'deleting a file present at BASE' fleet/roles/reviewer.md)" = 0
- Run: test "$(grep -c 'touching a SIBLING FILES path' fleet/roles/reviewer.md)" = 0
- Run: test "$(grep -c '^3\. ' fleet/roles/reviewer.md)" = 0
- Run: test "$(grep -c 'and against INTERFACES' fleet/roles/reviewer.md)" = 0
- Run: test "$(grep -c 'the diff produces the named Produces contract' fleet/roles/reviewer.md)" = 0
- Run: grep -q '^4\. Gate the diff against each GLOBAL CONSTRAINT given\.$' fleet/roles/reviewer.md
- Run: grep -q "^REFEREE, when present, is the driver's own arithmetic" fleet/roles/reviewer.md
- Run: sed -n '/^REFEREE, when present/,/^$/p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'A line marked settled is decided.*re-deriving it is not a finding.*leave the routing to the loop that owns it.*missing dependency edge'
- Run: test "$(grep -c 'missing dependency edge' fleet/roles/reviewer.md)" = 1
- Run: grep -q '^1\. Map everything the task requires' fleet/roles/reviewer.md
- Run: grep -q '^2\. Flag work the task does not require' fleet/roles/reviewer.md
- Run: grep -q '^5\. Code quality:' fleet/roles/reviewer.md
- Run: grep -q '^6\. Plan-supplied code is not privileged\.' fleet/roles/reviewer.md
- Run: grep -q '^7\. A diff is a result, not a history' fleet/roles/reviewer.md
- Run: grep -q '^8\. EXAM EDITED, when present' fleet/roles/reviewer.md
- Run: grep -q '^Every issue names its' fleet/roles/reviewer.md
- Run: grep -q '^RUN EVIDENCE, when present' fleet/roles/reviewer.md
- Run: grep -q '^EXAM EVIDENCE, when present' fleet/roles/reviewer.md
- Run: grep -q '^CHECK EVIDENCE, when present' fleet/roles/reviewer.md
- Run: node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the first three counts are 0 and no line begins `3. ` [M1]; (b) the two INTERFACES
  counts are 0 and duty 4 is exactly the shortened line [M2]; (c) the paragraph grep, the scoped
  ordered grep of its four phrases, and the count of exactly one `missing dependency edge` in
  the file [M3]; (d) the ten opening-line greps — each exits 1 when its line is absent or renumbered — and
  the two role-file sims [M4].

**Stale-if:**
- path-absent: `fleet/roles/reviewer.md`
- issue-closed: #729

### Task 5: The referee's file reaches the record, and the documents say so

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`

**Claim:** A reader of a run's evidence record — the run directory the boot script stages and
commits — finds every `referee/task-<id>-<n>.json` the engine wrote, beside the receipts, and the contract and the report format name the directory, the
`referee-red` verdict and the three referee counts a report now carries. (derived)
Machine: M1. `collect_evidence` in `fleet/sandbox-boot.sh` copies every `<run dir>/referee/*.json`
into `<evidence worktree>/.ultrapowers/runs/<N>/referee/<same name>` byte for byte, file by file,
so a completed boot leaves exactly the copied names under `referee/` and nothing nested; a run
whose engine wrote no `referee/` directory commits none; the evidence commit stages the whole run
directory (`git add -- .ultrapowers/runs/<N>`), so the new subdirectory rides it; the script
passes `bash -n`.
M2. The `ultra/evidence-run-<N>` bullet of `fleet/CONTRACT.md` §Literals names
`referee/task-<id>-<n>.json` with the words `present when the engine wrote them`.
M3. `skills/ultrapowers/references/report-format.md`: the `tasks[].reviewVerdict` row names
`referee-red` beside `proof-red`; the schema's `reviewEconomy` object and the `reviewEconomy` row
both name `refereeFindings`, `refereeBlocking` and `refereeSkippedPairs`; the `tasks[].proofFixes`
row says a red command or a blocking referee finding buys the round; and the
`deferredVerification` row's `plan-defect` clause carries the words `per-task reviewer or the
driver's referee`.

**Authorized-by:** #729; spec `docs/superpowers/specs/2026-09-09-mechanical-referee.md` §3.5
(Record), §4.2 (h), §5 item 5; spec review round 1 finding 8 and round 3 finding 5.

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the boot script, the contract and the report format are read by operators and by their own sims

**Context:** `collect_evidence()` in `fleet/sandbox-boot.sh` (the `# --- evidence` region) copies
named files from `run_dir` (`$(run_dir_path)`) into `dest="$EVIDENCE_DIR/$EVIDENCE_PATH"`, and
copies the engine's transcripts with one guarded loop — `if [ -d "$run_dir/transcripts" ]; then
mkdir -p "$dest/transcripts"; cp "$run_dir/transcripts/"*.jsonl "$dest/transcripts/" 2>/dev/null
|| true; fi` — file by file and never `cp -R`, because the function runs at every `write_status`
transition and once more at `fail`, so a directory copy nests a second directory inside the first
on the second pass. The referee directory gets the same loop over `referee/*.json`. The engine
writes `<run dir>/referee/task-<id>-<n>.json` — `<run dir>` is
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`, and `n` is the number of fix rounds that preceded
the graded patch (`-0` the pre-pass tree, `-1` after the first fix round). The boot sim rig
(`fleet/tests/_sandbox_boot_helpers.mjs`): `makeHome()` writes every stub of `STUBS` under a
temporary `bin/`, `boot(ctx, ['boot'], env)` runs the real script with them on `PATH`, the engine
is the `systemd-run` stub whose body ends in the line `exit ${STUB_ENGINE_CODE:-0}` and writes
its receipts into `run_dir="$FLEET_HOME/target/.claude/ultrapowers/run-run-7"`, and
`evidenceDir(ctx)` plus `RUN_PATH` (`.ultrapowers/runs/7`) locate the record.
`fleet/tests/test_sandbox_boot_approval_evidence.mjs` is the exam of this surface — it splices
`APPROVAL_SNIPPET + TRANSCRIPTS_SNIPPET + ACCEPTANCE_SNIPPET` before that `ENGINE_EXIT` line in
`approvalHome()`, memoizes one boot per case in `run(name, env)`, and has a `transcriptsRun()`
case whose legs assert the names, the bytes, no nesting and the absence case; the referee legs
follow that shape with a `REFEREE_SNIPPET` writing two files `task-1-0.json` and `task-1-1.json`
of distinct non-trivial bytes under `$run_dir/referee/` when `STUB_REFEREE_A` is set, and a
`refereeRun()` case. The contract bullet at BASE (§Literals, `- **The three branches on the
target**`, second sub-bullet) reads in part: `transcripts/<sessionId>.jsonl` — one per worker
session, the reduced record ultralearn's readers slice — is there on the same terms, present when
the engine wrote them.` — add one sentence after it naming `referee/task-<id>-<n>.json` and its
meaning with the same closing words; `tests/test_docs_agree_with_code.py` reads this file for the
unit, the engine directory, the VM name and the two-tags bullet and must keep passing. In
`report-format.md` the four places: the schema's `"reviewEconomy": { "type": "object",
"properties": { "reviewerMs" … "r2MarginalBlocking": {"type":"integer"} } }` gains
`"refereeFindings": {"type":"integer"}, "refereeBlocking": {"type":"integer"},
"refereeSkippedPairs": {"type":"integer"}`; the `tasks[].reviewVerdict` row's failed-task list,
after its `proof-red` entry, gains `referee-red` (the driver's referee alone was still blocking
after the one pre-review repair round — no reviewer was dispatched); the `tasks[].proofFixes`
row's `1` case reads that a red command or a blocking referee finding bought the round; the
`reviewEconomy` row gains the three fields — `refereeFindings` every referee finding of the run
(all severities, all rounds), `refereeBlocking` the blocking ones, `refereeSkippedPairs` the
rounds a `peer` task dispatched one reviewer because the referee's blocking finding had just been
repaired; and the `deferredVerification` row's `plan-defect` parenthesis, which opens `a per-task
referee returned a blocking issue whose actor is the **plan**`, reads that the issue came from a
per-task reviewer or the driver's referee. No test under `tests/` pins `report-format.md`'s
sentences.
**BASE facts:** (generated at fe0541e)
- `fleet/sandbox-boot.sh` blob a7dc914
- `fleet/CONTRACT.md` blob 9fdde77
- `skills/ultrapowers/references/report-format.md` blob 4ab481f
- `deferredVerification` at `fleet/run-engine.mjs:2472` blob 95be538
- `fail` at `fleet/run-main.mjs:552` blob 4cb8b21
- `n` at `fleet/launch.mjs:1034` blob 8cc2fc3
- `fleet/tests/_sandbox_boot_helpers.mjs` blob eee4b3b
- `STUBS` at `fleet/tests/_sandbox_boot_helpers.mjs:156` blob eee4b3b
- `RUN_PATH` at `fleet/tests/_sandbox_boot_helpers.mjs:58` blob eee4b3b
- `fleet/tests/test_sandbox_boot_approval_evidence.mjs` blob fefa54a
- `ENGINE_EXIT` at `fleet/tests/test_sandbox_boot_approval_evidence.mjs:88` blob fefa54a
- `tests/test_docs_agree_with_code.py` blob ffe9fa2
- `peer` at `fleet/run-engine.mjs:1295` blob 95be538
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `add` at `evals/fixtures/flawed/reference/apistub/store.py:9` blob c96aa3c
- `bare` at `fleet/tests/test_doctor.mjs:985` blob 0f9de8d

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Legs: (a) a boot whose engine stub wrote `referee/task-1-0.json` and `referee/task-1-1.json`
  under the run directory leaves both under `<evidence>/.ultrapowers/runs/7/referee/` byte-equal
  to the sources, `readdirSync` of that directory sorted equals exactly those two names (no
  nested `referee` entry), `gate-receipt.json` is beside them, and the stub `git`'s argv log
  carries an `add` whose pathspec is `.ultrapowers/runs/7` (the whole run directory) [M1]; (b)
  the `bare` boot,
  whose engine wrote no `referee/` directory, leaves no `referee` entry under the run's record
  [M1].
- Run: bash -n fleet/sandbox-boot.sh
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- Run: sed -n '/ultra\/evidence-run-<N>. — the run/,/publish-fold/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'referee/task-<id>-<n>\.json.*present when the engine wrote them'
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py
- Run: sed -n '/^| .tasks\[\]\.reviewVerdict./p' skills/ultrapowers/references/report-format.md | grep -q 'proof-red.*referee-red'
- Run: sed -n '/"reviewEconomy": { "type": "object"/,/"acceptance":/p' skills/ultrapowers/references/report-format.md | tr '\n' ' ' | grep -q '"refereeFindings": {"type":"integer"}.*"refereeBlocking": {"type":"integer"}.*"refereeSkippedPairs": {"type":"integer"}'
- Run: sed -n '/^| .reviewEconomy./p' skills/ultrapowers/references/report-format.md | grep -q 'refereeFindings.*refereeBlocking.*refereeSkippedPairs'
- Run: sed -n '/^| .tasks\[\]\.proofFixes./p' skills/ultrapowers/references/report-format.md | grep -q 'a red command or a blocking referee finding'
- Run: sed -n '/^| .deferredVerification./p' skills/ultrapowers/references/report-format.md | grep -q "plan-defect.*per-task reviewer or the driver's referee"
- Legs (of the Run: lines): (c) the contract's evidence bullet, scoped from its opening to the
  `publish-fold` sentence, carries `referee/task-<id>-<n>.json` before `present when the engine
  wrote them` (the grep exits 1 when either phrase is absent from that bullet), and the
  docs-agree suite still passes [M2]; (d) the `reviewVerdict` row carries
  `referee-red` after `proof-red`; the schema's `reviewEconomy` object carries the three integer
  fields in order; the `reviewEconomy` row names all three in order; the `tasks[].proofFixes` row carries
  the new phrase; the `deferredVerification` row's plan-defect text carries `per-task reviewer or the
  driver's referee` [M3].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- issue-closed: #729
