# The retire sweep skips an unreadable pulls answer

**Grammar:** claims-v1

**Claim:** A non-2xx exit or a non-array payload on the open-PR read is `run N: unreadable (pulls) — skipped`, never 'no open PR', and --dry-run says the same. (elicited)

**Goal:** #752 — the sweep's two gate reads handle a degenerate answer asymmetrically. The status
read treats anything it cannot read as "no page" and skips the run; the open-PR read builds
`rows = Array.isArray(payload) ? payload : []`, so a `gh` that exits non-zero or answers anything
that is not a JSON array — a rate-limit body, a 5xx, a truncated stream — reads as "no open PR",
and the pair is swept: tags pushed, branches deleted, while its PR may be open. After this run
the open-PR read has the status read's allowlist posture: only a JSON array is an answer, and
every other shape prints one `run N: unreadable (pulls) — skipped` line and issues no command,
under `--dry-run` and without it alike. The header prose of `fleet/retire.mjs` says so.
**Closes:** #752

**Tech Stack:** Node 22 ESM (`fleet/retire.mjs` over `fleet/lobby.mjs`); the sim
`fleet/tests/test_retire.mjs` over `fleet/tests/_lobby_helpers.mjs` (`makeExec` records every
`git`/`gh` call as `{ cmd, argv, line }` and answers it from rules, `passthrough: []` — nothing
runs for real; the process legs spawn `node fleet/retire.mjs` against `git`/`gh` shims written
into a temporary PATH directory). The suite is `python3 -m pytest` from the repo root, which
bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel
`ALL TESTS PASSED`).

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is one task, width 1. The fix is one contract — one read's
answer shape, one skip line, its dry-run parity and the header sentence that declares it — read
by one sim file over one seam. There is no second contract to run beside it: the header sentence
names the line the code prints, so a tree where the two disagree is not a legal intermediate
state, and the sentence lands in the same patch as the behaviour.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/janitor.mjs fleet/lobby.mjs fleet/tests/_lobby_helpers.mjs`
- The pair sweep's commands and their order are BASE's: the status read, then the open-PR read,
  then the two tag POSTs, the `ls-remote --tags` verify and the two branch DELETEs; this run
  changes what one read's answer means and adds no read and no write.
- The status read's own lines are unchanged: an unreadable status page still prints
  `run N: live (no status page) — skipped`, a live state still prints `run N: live (<state>) —
  skipped`, and an open pull request still prints `run N: live (PR #<number> open) — skipped`.
- HARD: no committed sim compares the tree to BASE, reads `ULTRA_BASE`, or embeds a literal
  40-hex commit sha — a fixture gets its object names from the file's `sha(seed)` helper, as
  every existing fixture in `fleet/tests/test_retire.mjs` does.
- Every assertion that stands at BASE in `fleet/tests/test_retire.mjs` still holds as written;
  the new legs sit in a fresh region under a comment naming this task.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The open-PR read takes the status read's posture

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/retire.mjs`
- Test: `fleet/tests/test_retire.mjs`

**Claim:** A non-2xx exit or a non-array payload on the open-PR read is `run N: unreadable (pulls) — skipped` — the same allowlist posture as the status read — never "no open PR"; `--dry-run` says the same. (quoted from #752)
Machine: M1. For each of three answers to run 3's open-PR read
`gh api repos/o/r/pulls?state=open&head=o:ultra/integration-run-3` — (i) exit code 1, empty
stdout, `gh: API rate limit exceeded (HTTP 403)` on stderr; (ii) exit 0 with a JSON object
`{ "message": "API rate limit exceeded", "documentation_url": "…" }` as stdout; (iii) exit 0
with a stdout that is not JSON at all, the truncated stream `[{"number": 41` — with run 3's
status page `done` and run 12 the healthy pair behind it: run 3's one line is exactly
`run 3: unreadable (pulls) — skipped`; the calls naming run 3 are exactly its status read then
its open-PR read, in that order — no POST, no `ls-remote --tags`, no DELETE, no PATCH and no
`state=closed` read; the resolved value carries `live` deep-equal to
`[{ run: 3, why: 'unreadable (pulls)' }]`, `retired` deep-equal to `[12]`, `kept` deep-equal to
`[]`, and `skipped` still naming only the lone half (run 5); run 12 is swept in full — its two
POSTs, verify and two DELETEs — and its `retired` line is printed after run 3's; and
`process.exitCode` is not set to 1.
M2. The mirror: run 12's open-PR read answers (ii) with run 3 healthy — `retired` deep-equals
`[3]`, run 12's one line is exactly `run 12: unreadable (pulls) — skipped`, and `live`
deep-equals `[{ run: 12, why: 'unreadable (pulls)' }]`.
M3. Under `--dry-run`, in either flag order, with run 3's open-PR read answering (ii) and run 12
healthy: the calls through the seam are exactly the one heads-and-tags listing, then run 3's
status read and open-PR read, then run 12's status read, open-PR read and `state=closed` read —
six lines, nothing else; run 3's line is byte-identical to the line M1 captured for answer (ii);
run 12's line says `would`; no `gh` line carries ` -X `; no `git` call but the listing is made;
and `process.exitCode` is not set to 1.
M4. A JSON array is still the answer it was: an empty array lets run 3 through to the whole
sweep (its two POSTs, verify and two DELETEs, in BASE's order, and a `retired` line, `live`
empty), and `[{ number: 41, body: '' }]` still prints exactly `run 3: live (PR #41 open) —
skipped` with no POST and no DELETE naming run 3; and a status read that answers non-zero still
prints exactly `run 3: live (no status page) — skipped` — the status read's line is not
renamed.
M5. Run as a process, `node fleet/retire.mjs --target o/r` against `git`/`gh` shims first on
`PATH` whose `gh` answers the `contents/` call with a `done` envelope and the `pulls?state=open`
call with the rate-limit object of (ii), exit 0: the process exits 0, prints
`run 3: unreadable (pulls) — skipped` on its own stdout, and the `gh` log carries no `-X` and no
`--delete`.
M6. The header comment of `fleet/retire.mjs` — the prose before its first `import` — names the
line `unreadable (pulls)` beside the sentence that names `live (<why>)`, and its `--dry-run`
paragraph still says the open-PR read is made per terminal candidate.

**Authorized-by:** #752 (desired state, 2026-09-07, and its comment of 23:48 UTC on the header
prose); #706 (the status read's allowlist posture, landed `02bb068`); `fleet/CONTRACT.md`
§Literals (the `**The two tags**` bullet — the sweep skips a run it cannot read).

**Interfaces:**
- Consumes: none
- Produces: `live: Array<{ run: number, why: string }>` (the value `why: 'unreadable (pulls)'` is new)

**Context:** The facts below were read off `main` at `89e06af` (v0.3.19), the tree this plan was
authored against; line numbers are that tree's and the names are exact.

*The two reads at BASE.* `ghRead(exec, apiPath)` (`fleet/retire.mjs` 154–157) is
`exec('gh', ['api', apiPath])` → `parseJson(res.stdout)` on exit 0, else `null`; `parseJson`
(`fleet/lobby.mjs`) answers `null` for empty or unparsable text, so a truncated stream and a
non-zero exit both arrive as `null`, and a rate-limit body arrives as an object.
`readStatusPage` (168–176) accepts only a payload with a string `content` and returns `null`
for everything else; `liveReason` (183–187) turns `null` into `'no status page'`, and
`sweepPair` (367–431) prints `live (${why}) — skipped` for any non-null `why` (389–392) after
pushing `{ run, why }` onto `live` (355, 390). `openPullOf` (195–203) is the defect: line 201
`const rows = Array.isArray(payload) ? payload : []` makes every unreadable shape an empty
list, and line 386–387 reads an empty list as "no open PR" and lets the pair through to the
POSTs (403–404). The dry-run branch (394–401) sits after the gate, so the gate is what
`--dry-run` shares with the live sweep. `integrationFate` (293–311) and `pullsToPatch` (253–269)
carry the same `Array.isArray(payload) ? payload : []` idiom; they are not this task's — the
fate read answers a `stays` on no rows, which deletes nothing, and the closed-PR read runs after
the deletes — and this task leaves both lines as they are.

*The line and the field.* The new line is `run <N>: unreadable (pulls) — skipped` — the pair's
segment is `unreadable (pulls) — skipped`, joined to `run <N>: ` by the existing `say` loop
(433–445), and followed by `; <integration segment>` only for a run whose listing carries an
integration branch, which none of the pairs in the file's default fixture does. The resolved
value records the run under `live` — the array of runs the sweep declined to touch — as
`{ run: <N>, why: 'unreadable (pulls)' }`; the segment is not `live (unreadable (pulls))`, it is
the literal the Claim names. `kept` keeps its tag-verify meaning and `process.exitCode` is not
set for it, exactly as for `no status page`. The header comment (2–76) says at 59–62 that "A
live page, an unreadable one, or an open pull request … prints `run <N>: live (<why>) —
skipped`"; the sentence this task adds beside it names the pulls read's own line, and the
`--dry-run` paragraph (71–75) already reads "the open-PR read per terminal candidate" at line
72 — #724 (`214d5add`) wrote that, so the reviewer's "per pair" complaint on #752 is already
answered at BASE and M6 pins it as a stays, not a change.

*What the sim already holds and how it is answered.* `makeSeam` (`fleet/tests/test_retire.mjs`
357–437) answers the open-PR read from an `openPulls` map (rule at 383–390: `answer(rows)`,
always exit 0, always an array), the contents read from `pages` with a `contentsAnswers`
per-run override that returns a raw `answer(...)` object (370–381) — the shape to copy for this
task: a per-run override of the open-PR read's whole answer (a map beside `openPulls`, checked
before it, returning the raw `answer` object), so a leg can make one run's read exit 1, answer an
object, or answer a non-JSON string. `answer(stdout, { code, stderr })`
(`fleet/tests/_lobby_helpers.mjs` 28–32) JSON-encodes a non-string `stdout`, so a truncated
stream is passed as the string `'[{"number": 41'` and an object as itself. The existing
literals are `LIST_LINE` (167), `contentsLine(run)` (186), `openPullsLine(run)` (189),
`pullsLine(run)` (181), `sweepLines(run)` (201), `sweepOf(exec, run)` (493, filters out
`/pulls` and `/contents/` lines), `runLine(out, run)` (291, asserts exactly one `run N:` line),
`captured(body)` (261, grades only what reached `process.stdout.write`, resets `exitCode`),
`liveSkip(run, why)` (630) and `PR_3 = 41` (232); the default fixture is runs 3 and 12 as pairs
and 5 as a lone half (`HEAD`, 138). The existing legs this task must keep green are `#706 (d)`
(711–729, `no status page`), `(h)` (753–773, `PR #41 open`), `(i)` (775–785), `(j)` (787–828,
dry-run call lists), `(k)` (963–977, the process skip) and the `#724 Task 1` region
(1001–1321), whose seams all answer the open-PR read with an array. The process helper
`loggingShims(name, { state })` (899–921) writes a `gh` shim whose `case "$*"` answers
`*contents/*` with the envelope and everything else with `[]`; the M5 leg wants a shim whose
`*pulls?state=open*` arm prints the rate-limit object — either a new option on `loggingShims` or
a sibling helper. `cliRoot` is cleaned at 998 (`cleanup(cliRoot)`), so a process leg placed
below the `#724 Task 1` region creates its own `tempDir('retire-pulls-')` and cleans it, or the
whole new region sits between `#706 (k)` and `cleanup(cliRoot)`; either way its comment names
this task (`#752 Task 1 — the open-PR read takes the status read's posture`) and every group
comment inside it cites the leg and clause. The `SEAMS` sweep at the end of the file asserts only
`git` and `gh` reach any seam, and the sentinel `ALL TESTS PASSED` (1327) is the last line.

*Where the Claim is silent.* The issue names the line and the posture; the `live` field's `why`
value, the exit code and the order of the two reads are this plan's derivations from "the same
allowlist posture as the status read" — the status read's unreadable case sits under `live`,
sets no exit code, and is the first read of the pair, so the pulls read's unreadable case sits
under `live`, sets no exit code, and stays the second read.

**Proof:**
- Test: `fleet/tests/test_retire.mjs`
- Legs, in a fresh region under a comment naming this task
  (`#752 Task 1 — the open-PR read takes the status read's posture`):
  The three rows of M1 share one assertion set, spelled once here and applied per row: with
  the row's answer as run 3's open-PR answer, run 3's page `done` and run 12 healthy,
  `runLine(out, 3)` is exactly `run 3: unreadable (pulls) — skipped`;
  `linesOf(exec, (l) => namesRun(l, 3))` deep-equals `[contentsLine(3), openPullsLine(3)]`;
  `out.result.live` deep-equals `[{ run: 3, why: 'unreadable (pulls)' }]`, `out.result.retired`
  deep-equals `[12]`, `out.result.kept` deep-equals `[]`, and `out.result.skipped` names only
  run 5; `sweepOf(exec, 12)` deep-equals `sweepLines(12)`, `runLine(out, 12)` includes `retired`
  and its index in `out.lines` is greater than run 3's; and `out.exitCode` is not 1 — a tool
  that prints `live (…)`, sweeps run 3, lists it under `kept` or `skipped`, returns after the
  skip, sets exit 1, or names run 3 in a POST, DELETE, PATCH or `state=closed` read fails the
  row.
  (a) row (i): the read exits 1 with empty stdout and `gh: API rate limit exceeded (HTTP 403)`
  on stderr — the assertion set above holds [M1];
  (b) row (ii): the read exits 0 with the object
  `{ message: 'API rate limit exceeded', documentation_url: 'https://docs.github.com/rest' }`
  as stdout — the assertion set above holds, and run 3's line is captured for the dry-run leg
  [M1];
  (c) row (iii): the read exits 0 with the string `[{"number": 41` as stdout, which is not JSON
  — the assertion set above holds [M1];
  (d) the mirror, the object answer as run 12's open-PR answer with run 3 healthy:
  `out.result.retired` deep-equals `[3]`, `runLine(out, 12)` is exactly
  `run 12: unreadable (pulls) — skipped`, and `out.result.live` deep-equals
  `[{ run: 12, why: 'unreadable (pulls)' }]` [M2];
  (e) for each of `['--target', TARGET, '--dry-run']` and `['--dry-run', '--target', TARGET]`,
  with run 3's open-PR read answering the object and run 12 healthy: `lines(exec)` deep-equals
  `[LIST_LINE, contentsLine(3), openPullsLine(3), contentsLine(12), openPullsLine(12),
  pullsLine(12)]`; `runLine(out, 3)` equals the line the object row captured;
  `runLine(out, 12)` includes `would`; `linesOf(exec, (l) => l.includes(' -X '))` deep-equals
  `[]`; `linesOf(exec, (l) => l.startsWith('git ') && l !== LIST_LINE)` deep-equals `[]`; and
  `out.exitCode` is not 1 — a dry run that says `would` for run 3, prints a different skip line,
  or stops after the skip fails it [M3];
  (f) the empty-array control, on this region's own seam: with run 3's open-PR read answering
  `[]` and run 12 healthy, `sweepOf(exec, 3)` deep-equals `sweepLines(3)`, `runLine(out, 3)`
  includes `retired` and `out.result.live` deep-equals `[]` — a tool that reads an empty array
  as unreadable fails it [M4];
  (g) the open-PR control: with run 3's open-PR read answering `[{ number: PR_3, body: '' }]`,
  `runLine(out, 3)` is exactly `liveSkip(3, 'PR #41 open')` and no line naming run 3 carries
  `POST` or `DELETE` [M4];
  (h) the status-read control: with run 3's status read answering exit 1 with `HTTP 404` on
  stderr, `runLine(out, 3)` is exactly `liveSkip(3, 'no status page')` and no `state=open` read
  names run 3 — a tool that renames the status read's line fails it [M4];
  (i) a process spawned as `node fleet/retire.mjs --target o/r` against PATH shims whose `git`
  prints run 3's pair listing and whose `gh` answers the `contents/` call with a `done` envelope
  and the `pulls?state=open` call with the rate-limit object, exit 0 for both: `res.status` is
  0, `res.stdout` split on newlines includes exactly `run 3: unreadable (pulls) — skipped`, and
  no line of the `gh` log includes `-X` or `--delete` — the CLI layer, not only the seam [M5];
  (j) the two `Run:` commands below that read the header exit 0: the first finds
  `unreadable (pulls)` in the prose before the first `import` of `fleet/retire.mjs`, the second
  finds `open-PR read per terminal candidate` there — a header that names the new line nowhere,
  or a rewrite of the `--dry-run` paragraph that says the read is per pair again, fails one of
  the two [M6].
- Run: node fleet/tests/test_retire.mjs | grep -q 'ALL TESTS PASSED'
- Run: sed -n '1,/^import /p' fleet/retire.mjs | grep -q 'unreadable (pulls)'
- Run: sed -n '1,/^import /p' fleet/retire.mjs | tr '\n' ' ' | grep -q 'open-PR read per terminal candidate'

**Stale-if:**
- issue-closed: #752
- path-absent: `fleet/retire.mjs`
- path-absent: `fleet/tests/test_retire.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
