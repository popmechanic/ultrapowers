# A task that promises nothing is not failed for the nothing it promised

**Grammar:** claims-v1

**Claim:** A task that promises nothing is not failed for the nothing it promised. (elicited)

**Goal:** #842 — the mechanical referee (#729) receives a task's raw `Produces:` bullet, and a
placeholder bullet (`none`, `nothing`, `n/a`, `na`, the compiler's own `PLACEHOLDER_TOKENS`)
leads with a token that matches `IDENT_RE`, so the linker hunts a file for an export named
`none`, grades the miss, and the task is `referee-red` after a repair round nobody can pass:
runs 74 and 77 (2026-09-09) each parked a different task of one plan on exactly this. The
desired state is the issue's: the linker answers `unlinked` for a placeholder bullet before
any file is read, with a detail that says "placeholder", and the token set is shared with the
compiler by spelling. One task, one source file changed. Two choices made in place of a question, each
with the least machinery: (1) the cross-suite pin is a **literal list in both places plus one
fleet-suite leg that reads the four words out of the Python source by regex** — the compiler
is frozen periphery and its own suite already pins the normaliser in
`test_placeholder_token_set` in `tests/test_compile_plan.py` — with three of the four words; the
one Python edit is adding the fourth, `na`, to that test's tuple — so the linker gets its own
exported `PLACEHOLDER_TOKENS`, the linker sim asserts it equals the set the regex
`PLACEHOLDER_TOKENS = frozenset\(\{([^}]*)\}\)` extracts from
`skills/ultrapowers/scripts/compile_plan.py`, and both suites name the four words; a drift in
either source file fails the fleet suite, and `compile_plan.py` itself is not touched. (2) The placeholder test runs on the **raw bullet
text before the lead-token and `IDENT_RE` tests**, because `n/a` has lead token `n` and would
otherwise be answered by `NOT_A_SYMBOL_RE` as "followed by `/`" — true, but not the sentence
the issue asks for; running it first is what lets all four spellings answer with one detail.
No change reaches `fleet/referee.mjs` or `fleet/run-engine.mjs`: the referee renders the
linker's `detail` verbatim into the settled line, so the block already says what the linker
says.
**Closes:** #842

**Tech Stack:** Node ESM (`fleet/*.mjs`; the fleet sims under `fleet/tests/test_*.mjs`
print `ALL TESTS PASSED` and ride the pytest suite through `tests/test_fleet_suite.py`, no
network). The suite is `python3 -m pytest` from the repo root.

**Spec:** none — #842 is the spec; the task quotes its desired-state sentence.

**Parallelization rationale:** one wave, width 1. One task on one source file and its two
sims; nothing to split — the linker change, its unit legs and its engine leg share one
contract, and the engine leg needs the linker's runtime behaviour (rule 2), so they stay one
task rather than a chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/referee.mjs fleet/run-engine.mjs skills/ultrapowers/scripts/compile_plan.py
- The linker's four statuses stay `resolved`, `declared`, `missing`, `unlinked`, and their
  grading order across candidates stays resolved > declared > unlinked > missing; a
  placeholder answer is `unlinked`, never a fifth status.
- Every existing leg of `fleet/tests/test_referee_linker.mjs` and
  `fleet/tests/test_run_engine_referee.mjs` stays green; new legs are added beside them under a
  comment naming the task, and the twelve `linker-*` fixture directories stay exactly twelve —
  no fixture is added for this task (the sim's inline `checkoutOf` is the shape).

**Acceptance:** suite — the committed suite is the verification.

---

### Task 1: A placeholder Produces is unlinked before any file is read, and the four spellings are the compiler's

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/referee-linker.mjs`
- Modify: `tests/test_compile_plan.py`
- Test: `fleet/tests/test_referee_linker.mjs`
- Test: `fleet/tests/test_run_engine_referee.mjs`

**Claim:** `linkProduces` answers `unlinked` — "placeholder, no symbol promised; no file was read" — for a bullet whose lead token, case-insensitively, is one of the compiler's placeholder tokens (`none`, `nothing`, `n/a`, `na`), bare or followed by trailing prose (`none — prose only`), and the referee block for that task says so in one line rather than listing the file's exports. The token set is shared with the compiler by spelling (one place in each, pinned by a test in both suites naming the four words). (quoted from #842)
Machine: M1. A bullet is a placeholder when, after the optional bullet marker and one optional wrapping backtick, its text opens with `none`, `nothing`, `n/a` or `na` compared case-insensitively and that word is followed by end-of-text, whitespace, a closing backtick or any character other than a letter, digit or underscore. For each of the four bare bullets `none`, `nothing`, `n/a`, `na`, `linkProduces({bullet, files: ['src/foo.mjs'], cloneDir, exec})` — where `src/foo.mjs` exists in `cloneDir` and exports `foo` — resolves to `status` `unlinked` with `detail` containing the word `placeholder`, and `exec` is called 0 times.
M2. For each of the three upper- or mixed-case bullets `None`, `NOTHING`, `N/A`, the same call resolves to `status` `unlinked` with `detail` containing `placeholder`, and `exec` is called 0 times.
M3. For each of the four trailing-prose bullets `none — standalone`, `` `nothing` (test-data-only change)``, `n/a — nothing exported`, `na (prose only)` — each the text after `- Produces:`, which is what `interfaces.produces` carries — the same call resolves to `status` `unlinked` with `detail` containing `placeholder`, and `exec` is called 0 times.
M4. For each of the four non-placeholder bullets `` `nonesuch(a)` ``, `` `None_` ``, `` `nothingness()` ``, `` `name(x)` `` over the same `src/foo.mjs`, the call resolves to `status` `missing` with `detail` containing `no export named`, and `exec` is called exactly 1 time.
M5. `fleet/referee-linker.mjs` exports `PLACEHOLDER_TOKENS`, a `Set` whose sorted members are exactly `['n/a', 'na', 'none', 'nothing']`, and that sorted list equals the sorted, lower-cased, unquoted words inside the one line of `skills/ultrapowers/scripts/compile_plan.py` matching `PLACEHOLDER_TOKENS = frozenset\(\{([^}]*)\}\)`.
M6. In the engine sim, a task whose files are `['lib.mjs']`, whose `interfaces.produces` is exactly `['none']` and whose implementer writes `lib.mjs` exporting `plus` reaches `status` `done` with no `fix:` dispatch, and the `n=0` referee record has zero `interface` findings and exactly one settled `interface` line whose `detail` contains `none` and `placeholder` and does not contain `no export named`.
M7. `test_placeholder_token_set` in `tests/test_compile_plan.py` names `"na"` as a quoted string inside its own body, where at BASE it is absent, so that the count of distinct quoted words among `nothing`, `none`, `N/A`, `na` inside that body is 4, and the test passes.

**Authorized-by:** #842 (desired state); #729 (the referee); #727.

**Interfaces:**
- Consumes: none
- Produces: `PLACEHOLDER_TOKENS`

**Context:** At BASE `3fb782b6` (`fleet/referee-linker.mjs` blob `ae745120`) `linkProduces`
(`:355-420`) parses the bullet with `parseBullet` (`LEAD_RE`, `:40`, consumes one bullet marker
and one backtick and takes `[A-Za-z][\w.-]*`), then answers `unlinked` in three cases before
any candidate file is read: no lead symbol (`:361`), a symbol failing `IDENT_RE` (`:364`), and a
symbol followed by `NOT_A_SYMBOL_RE`'s `[:/=.]` (`:368`); each of those uses the `answer(status,
symbol, detail)` helper (`:53`). `none` and `nothing` pass all three and reach the linkers, which
is the bug. The placeholder test belongs **before** those three, on the raw bullet text: `n/a`
has lead token `n` and rest `/a`, so a test placed after `NOT_A_SYMBOL_RE` would answer "followed
by `/`" — correct status, wrong sentence — and `N/A` must match case-insensitively. The
compiler's rule (`compile_plan.py:1693-1727`, `_interface_token`) is: strip the bullet marker
and a wrapping backtick, take the lead run, and a lead whose lower-case form is in
`PLACEHOLDER_TOKENS = frozenset({"nothing", "none", "n/a", "na"})` (`:1672`) normalises to `""`
whatever prose follows. The linker's counterpart wants the same boundary: the placeholder is the
whole lead word (`none`, `nothing`, `na`) or `n/a`, compared case-insensitively after the
bullet marker and one wrapping backtick are skipped, followed by end-of-text, whitespace, a
closing backtick, or any character outside `[A-Za-z0-9_]` (`—`, `:`, `(`) — and `nonesuch`, `None_`, `nothingness`,
`name` are real identifiers that merely start with a token, so they fall through to the
existing path and, over a `src/foo.mjs` exporting only `foo`, answer `missing` after exactly one
`node` spawn each. The answer's `symbol` may be the placeholder word as written or `''`; the
legs pin only `status` and `detail`. `interfaceCheck` in `fleet/referee.mjs` (`:165-202`) treats
`unlinked` as no-finding and pushes `'Produces: ' + bullet + ' ' + detail` as the one settled
line, so the referee block (`refereeBlock` in `fleet/run-engine.mjs`, `:489`) says what the linker's
`detail` says — no edit there. The engine sim's rig: `mkTask(id, files, over)` with
`interfaces: { consumes: [], produces: ['none'] }`, `drive(name, [task], { impl })`, the record
read by `readReferee(runDir, 'T1', 0)`, findings by `findingsOf(rec, 'interface')`, settled
lines by `settledOf(rec, 'interface')`, dispatches by `r.of('fix:')` — the `(g)` block of that
sim (`:514-560`) is the neighbour to extend; a task with a missing symbol there buys
`['fix:T1:0']`, which is what the placeholder task must not. The linker sim's `boom` stub (an
`exec` that throws) is its proof that no subprocess ran; a counting stub is the shape for
"called exactly once". `linkProduces` must keep resolving, never rejecting, on every input the
legs name. `test_placeholder_token_set` in `tests/test_compile_plan.py` (`:1613-1619`) loops over the
tuple `("nothing", "none", "N/A", "nothing (test-data-only change)", "`nothing`", "none — standalone")`
asserting `_interface_token(raw) == ""`; the compiler already normalises `na` to `""`, so
adding `"na"` to that tuple is the whole Python edit and it passes without a compiler change.

**Proof:**
- Test: `fleet/tests/test_referee_linker.mjs`
- Test: `fleet/tests/test_run_engine_referee.mjs`
- Guard: `fleet/tests/test_referee_linker.mjs`
- Guard: `fleet/tests/test_run_engine_referee.mjs`
- Run: node fleet/tests/test_referee_linker.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_referee.mjs | grep -q 'ALL TESTS PASSED'
- Run: node --input-type=module -e "import { PLACEHOLDER_TOKENS } from './fleet/referee-linker.mjs'; const a = [...PLACEHOLDER_TOKENS].sort().join(','); if (a !== 'n/a,na,none,nothing') { console.error(a); process.exit(1) }"
- Run: grep -c 'PLACEHOLDER_TOKENS = frozenset({"nothing", "none", "n/a", "na"})' skills/ultrapowers/scripts/compile_plan.py | grep -qx 1
- Run: sed -n '/^def test_placeholder_token_set/,/^def /p' tests/test_compile_plan.py | grep -oE '"(nothing|none|N/A|na)"' | sort -u | wc -l | grep -qx 4
- Run: python3 -m pytest tests/test_compile_plan.py -q -k test_placeholder_token_set -p no:cacheprovider
- Legs: every linker leg below runs over one `checkoutOf({'src/foo.mjs': 'export function
  foo (a) { return a }\n'})` with `files: ['src/foo.mjs']`, and "a counting stub" is an `exec`
  that increments a counter and throws, so a call is both counted and fatal; the four legs of
  M4 use a counting stub that delegates to `defaultExec` instead. (a) bullet `none` resolves
  `status === 'unlinked'`, `/placeholder/.test(detail)`, count `0` [M1]; (b) bullet `nothing`,
  the same three assertions [M1]; (c) bullet `n/a`, the same three [M1]; (d) bullet `na`, the
  same three [M1]; (e) bullet `None` resolves `unlinked`, `detail` matches `/placeholder/`,
  count `0` [M2]; (f) bullet `NOTHING`, the same three [M2]; (g) bullet `N/A`, the same three
  [M2]; (h) bullet `none — standalone` resolves `unlinked`, `detail` matches `/placeholder/`,
  count `0` [M3]; (i) bullet `` `nothing` (test-data-only change)``, the same three [M3]; (j)
  bullet `n/a — nothing exported`, the same three [M3]; (k) bullet `na (prose only)`, the
  same three [M3]; (l) bullet `` `nonesuch(a)` `` resolves `status === 'missing'`,
  `detail` includes `no export named`, and the delegating stub's count is exactly `1` [M4];
  (m) bullet `` `None_` ``, the same three [M4]; (n) bullet `` `nothingness()` ``, the same
  three [M4]; (o) bullet `` `name(x)` ``, the same three [M4]; (p) `PLACEHOLDER_TOKENS`
  imported from `../referee-linker.mjs` is a `Set`, `[...set].sort()` deep-equals
  `['n/a', 'na', 'none', 'nothing']`, and it deep-equals the sorted list obtained by reading
  the compiler source at `../../skills/ultrapowers/scripts/compile_plan.py` relative to the
  sim's own directory, matching `/PLACEHOLDER_TOKENS = frozenset\(\{([^}]*)\}\)/`, asserting
  exactly one match, splitting its group on commas, trimming quotes and whitespace and
  lower-casing [M5]; (q) the two one-line `Run:` probes — the exported set's sorted join is
  `n/a,na,none,nothing`, and the compiler source carries the frozen
  `frozenset({"nothing", "none", "n/a", "na"})` line exactly once — each exit 0 [M5]; (r) in
  `test_run_engine_referee.mjs`, under a comment naming this task beside block (g), `drive`
  with `mkTask('T1', ['lib.mjs'], { interfaces: { consumes: [], produces: ['none'] } })` and
  an `impl` writing `lib.mjs` as `export function plus (a, b) { return a + b }\n` gives
  `r.row('T1').status === 'done'`, `r.of('fix:')` deep-equals `[]`,
  `findingsOf(readReferee(r.runDir, 'T1', 0), 'interface')` deep-equals `[]`, and
  `settledOf(rec0, 'interface')` has length `1` with a `detail` that includes `none`, matches
  `/placeholder/` and does not include `no export named` [M6]; (s) the two sims print
  `ALL TESTS PASSED` under their `Run:` lines, the existing legs still green beside the new
  ones [M5, M6]; (t) the `Run:` that scopes `sed` to the body of `test_placeholder_token_set`
  and counts the distinct quoted words among `nothing`, `none`, `N/A`, `na` prints exactly `4`
  — at BASE it prints `3`, `na` being the absent one — and the pytest `Run:` selecting that one
  test exits 0 [M7].

**Stale-if:**
- issue-closed: #842
- path-absent: `fleet/referee-linker.mjs`
- path-absent: `fleet/tests/test_referee_linker.mjs`
- path-absent: `fleet/tests/test_run_engine_referee.mjs`
