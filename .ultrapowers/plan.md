# A test that reads a directory is offered when a patch changes a file under it, and the select rows say why each candidate matched

**Grammar:** claims-v1

**Claim:** When a run lands a change, the tests it considers re-running include the ones that read a whole folder the change touched, and the record says why each test was considered — so a test nobody offered can be told apart from one the judge passed over. (elicited)
**Summary:** This widens the list of existing tests a factory run considers re-running after a change. It exists because on fixture run-36 the one test the merge broke read a folder rather than a file, was never offered, and a green self-merged run left a red test on main (n=1 run). After this run such a test is on the list, ranked below closer matches so it never crowds one out, and every row says why each test was there; it ships as an experiment with a switch to turn it off.

**Goal:** #1175: `factory/select.mjs` offers a test whose text names a directory a changed file sits under; the engine's `select:exam` and `select:landing` rows carry why each candidate matched; a `select.dir_needles` cell of `factory/policy.json` is the rollback. This is also the first run on the engine that carries today's three boot and re-fold fixes (#1179, #1181, run-197), so its own ending is a reading: the hub close, the spoke's leave, and the janitor's reap.
**Closes:** #1175

**Tech Stack:** Node 24 ESM, no new npm dependency.
Spec: none on disk — issue #1175 is the brief, and everything a worker needs is in the Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet skills factory/boot.sh factory/questions.json
- Candidate finding is code and stays pure: `factory/select.mjs` touches neither disk, git nor the network, and asks Jev nothing.
- A directory match never displaces a closer match: it fills the list, it does not reorder the top of it.

### Task 1: The candidate finder offers tests that name a changed file's directory, ranked last, and says why each candidate matched

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/select.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_select_dirs.mjs`

**Claim:** The tests a run considers re-running include the ones that read a whole folder the change touched, ranked below closer matches, and the record says why each was considered. (derived)
Machine: M1. `candidateTests` over the files `['tests/converge.test.ts', 'tests/other.test.ts']`, where `converge.test.ts` reads `run('git diff --quiet -- state-exams')` and `other.test.ts` reads `nothing here`, with `paths: ['state-exams/seeds/three-todos.json']` and no symbols, answers exactly one result, for `tests/converge.test.ts`, whose `why` is exactly `'dir'`; with `dirNeedles: false` the same call answers `[]`.
M2. With a third file `tests/seed.test.ts` reading `load('state-exams/seeds/three-todos.json')`, the same call answers `tests/seed.test.ts` first with `why` exactly `'path'` and `tests/converge.test.ts` second with `why` `'dir'`; and with `cap: 1` it answers only `tests/seed.test.ts` — a directory match never takes a closer match's place.
M3. Every result still carries `path` and `hits` as today, and a result matched only by a symbol has `why` exactly `'symbol'`; a needle shorter than 4 characters is still no needle, so a changed `src/a.ts` makes no `src` needle.
M4. In `factory/engine.mjs` the `select:exam` and `select:landing` rows carry `why`, an object from each candidate's path to its `why`; the engine passes `dirNeedles` from `policy.select.dir_needles`, on unless the cell is exactly `false`; and `factory/policy.json`'s `select` cell carries `dir_needles: true`.

**Authorized-by:** #1175; the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `candidateTests({ files, read, paths, symbols, exclude, cap, dirNeedles })`

**Context:** You see this task body and nothing else. `factory/select.mjs` (179 lines) is the pure candidate finder: given the repository's files and a `read(path)` function, `candidateTests({ files, read, paths = [], symbols = [], exclude = [], cap = 8 })` names the existing test files whose text mentions a needle, most mentions first, then by path, cut at `cap`. `buildNeedles(paths, symbols)` makes the needles: for each changed non-test path, the path itself and the stem of its basename, then every symbol; a needle under 4 characters is dropped; duplicates are dropped. `matchesNeedle(text, needle)` is a substring match for a needle containing `/` or `.`, and a whole-word match otherwise. **The defect (fixture run-36, 2026-09-21):** the patch added `state-exams/seeds/three-todos-mixed-due.json`; `tests/state-exams/two-pages-converge.test.ts` ran `git diff --quiet $ULTRA_BASE -- state-exams` and went red on the merged main; it names the DIRECTORY and none of the files, so it matched no needle, was among neither task's eight candidates, and Jev was never asked about it. **The change:** when `dirNeedles` is not `false` (default `true`), also make a needle of every ancestor directory of each changed non-test path — for `state-exams/seeds/three-todos.json`, `state-exams/seeds` and `state-exams` — under the same 4-character floor, matched as a substring when it contains `/` and as a whole word otherwise (so `state-exams` is a whole-word match: note that `matchesNeedle`'s word boundary treats `-` as a boundary character only if the regex says so — read `wholeWordMatch`: its class is `[A-Za-z0-9_$]`, so `state-exams` bounded by spaces, quotes or slashes matches, which is what the exam's fixture text uses). Keep which kind each needle is. A result's `why` is the closest kind among its hits, in the order `path`, `stem`, `symbol`, `dir`. Rank by the count of non-directory hits first (descending), then the count of directory hits (descending), then path — so a test matched only by a directory sorts after every test with any closer hit, and `cap` cuts from the bottom. `hits` stays the list of matched needle strings. In `factory/engine.mjs` the finder is called twice (about lines 1242 and 1412) and its results written to a `select:exam` row (about line 1254) and a `select:landing` row (about line 1446) as `candidates: found.map((c) => c.path)`; add `why: Object.fromEntries(found.map((c) => [c.path, c.why]))` to each row and pass `dirNeedles: selectPolicy.dir_needles !== false` to both calls. A sibling-free run: nobody else edits these files. In `factory/policy.json` add `"dir_needles": true` inside the existing `select` object, beside `max_candidates`; the cell is already marked `experiment` with its rollback, and this key's rollback is `false`. Touch nothing else in the policy file — a run-wide check holds `factory/questions.json` and `factory/boot.sh` byte-identical. **For the examiner:** the exam is pure — `import { candidateTests } from '../../factory/select.mjs'`, `files` an array of paths, `read` an `async (p) => TEXTS[p]` over an object of strings; no rig, no child process, no disk. M4 says what the engine and the policy file carry and is read against the diff; its `Run:` lines pin only that the words are there. The exam ends by printing `ALL TESTS PASSED` and exiting 0, and exits non-zero on the first failed assertion.

**Proof:**
- Test: `fleet/tests/test_factory_select_dirs.mjs`
- Run: grep -q "dirNeedles" factory/engine.mjs
- Run: python3 -c "import json; assert json.load(open('factory/policy.json'))['select']['dir_needles'] is True"
- Legs: (a) [M1] the two-file call answers an array of length exactly 1 whose one entry has `path` `tests/converge.test.ts` and `why` exactly `'dir'`, and the same call with `dirNeedles: false` answers an array of length exactly 0; (b) [M2] the three-file call answers paths exactly `['tests/seed.test.ts', 'tests/converge.test.ts']` with `why` values exactly `['path', 'dir']`, and with `cap: 1` answers paths exactly `['tests/seed.test.ts']`; (c) [M3] every answered entry has a string `path` and an array `hits`; a call with `paths: []`, `symbols: ['orderTodos']` over a file reading `orderTodos(ids)` answers one entry with `why` exactly `'symbol'`; and a call with `paths: ['src/a.ts']` over a file reading `import x from 'src'` answers length exactly 0; (d) [M4] the two `Run:` lines — the engine names `dirNeedles` and the policy cell is `true`; what the rows carry is read against the diff.

**Stale-if:**
- issue-closed: #1175
