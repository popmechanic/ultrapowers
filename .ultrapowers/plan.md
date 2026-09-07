# The retire sweep skips a live run

**Grammar:** claims-v1

**Claim:** `retire.mjs` reads each pair's `.ultrapowers/runs/<N>/status.json` off the evidence branch and skips a run whose `state` is not `done|parked|failed` (printing `run N: live (<state>) — skipped`), and a run with an open PR on `ultra/integration-run-<N>` likewise; `--dry-run` says the same. (elicited)

**Goal:** #706 — the first dry run of `node fleet/retire.mjs --target popmechanic/ultrapowers`
(2026-09-05 21:31) listed every pair 1–29 including runs 28 and 29, which were `running`.
Tagging and deleting a live run's `ultra/evidence-run-<N>` mid-run would strand its next
evidence push and leave `ultra/evidence/run-<N>` at a pre-terminal head. After this run the
sweep reads each pair's status page off the evidence branch before it touches anything, and a
pair whose page is not terminal — or whose integration branch still has an open pull request —
gets one `live … — skipped` line and no command, under `--dry-run` and without it alike.
**Closes:** #706

**Tech Stack:** Node 22 ESM (`fleet/retire.mjs`, `fleet/janitor.mjs`, `fleet/lobby.mjs`); the
sim `fleet/tests/test_retire.mjs` over `fleet/tests/_lobby_helpers.mjs` (`makeExec` records every
`git`/`gh` call as `{ cmd, argv, line }` and answers it from rules, `passthrough: []` — nothing
runs for real; the process legs spawn `node fleet/retire.mjs` against `git`/`gh` shims written
into a temporary PATH directory). The suite is `python3 -m pytest` from the repo root, which
bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel
`ALL TESTS PASSED`, 120 s per file).

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is one task, width 1. The skip is one contract — the status
read, the two skip reasons, the terminal control, the dry-run parity and the two sentences that
declare it — read by one sim file over one seam. The documents are not split off as a task of
their own because `fleet/CONTRACT.md` is the authority for every literal the sweep prints: a tree
where the authority and the script disagree is not a legal intermediate state, so the sentence
lands in the same patch as the behaviour it declares. There is no second contract to run beside
it.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/janitor.mjs fleet/lobby.mjs fleet/sandbox-boot.sh fleet/launch.mjs`
- The sweep reads what the boot writes and never writes it: `fleet/janitor.mjs` is imported for
  its `REAPABLE_STATES` and not edited (the Check above is the whole of that rule), and no
  `done`/`parked`/`failed` list is retyped in `fleet/retire.mjs`.
- No document under `fleet/` shows a `?ref=ultra/evidence-run-<N>` read — the record is read by
  tag, and `tests/test_docs_agree_with_code.py` refuses a `?ref=` at the branch; a sentence about
  the sweep's read names the branch in prose, never as a `?ref=`.
- The sim runs `git` and `gh` only through the `exec` seam or the PATH shims it writes; it never
  compares the tree to BASE, reads `ULTRA_BASE`, or embeds a commit sha.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The status read gates the sweep

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/retire.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_retire.mjs`

**Claim:** `retire.mjs` reads each pair's `.ultrapowers/runs/<N>/status.json` off the evidence branch and skips a run whose `state` is not `done|parked|failed` (printing `run N: live (<state>) — skipped`), and a run with an open PR on `ultra/integration-run-<N>` likewise; `--dry-run` says the same. (quoted from #706)
Machine: M1. For every pair — a run whose plan AND evidence heads are both in the one listing —
`retire({ argv, exec })` makes exactly one read
`gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`
through `exec`, before any command that names that run's tags or branches; a lone half gets no
such read. The page is the contents envelope's base64 `content`, decoded and parsed; the states
that let a run be swept are `REAPABLE_STATES` imported from `./janitor.mjs`, and the source of
`fleet/retire.mjs` carries no retyped `'done', 'parked', 'failed'` list.
M2. For each of `booting`, `running`, `publishing` and `blocked` — the three live states the
boot writes, and one word it never writes, because the test is membership in `REAPABLE_STATES`
and never a denylist of the live three: a pair whose page's `state` is that value
prints exactly one line for the run, `run <N>: live (<state>) — skipped`, and no POST, no
`ls-remote --tags`, no DELETE, no PATCH and no `/pulls` read names that run; the resolved value
carries it under a new field `live` as `{ run: <N>, why: '<state>' }` and under none of
`retired`, `kept` or `skipped` (which stays the lone halves' branch names); the sweep goes on
to the next N, and `process.exitCode` is not set to 1 for it. A pair whose read answers
non-zero, answers no `content` string, or answers a page whose `state` is not a string is
skipped the same way with `why` `no status page`.
M3. For each of `done`, `parked` and `failed`: a pair whose page's `state` is that value is
swept exactly as before the read existed — the two tag POSTs, the `ls-remote --tags` verify and
the two branch DELETEs in that order, then its `retired` line — so the read gates the sweep
and replaces none of it.
M4. A pair whose page is terminal is asked once, after its status read and before its first
POST, `gh api repos/<target>/pulls?state=open&head=<owner>:ultra/integration-run-<N>`; a
non-empty array answers → the run's one line is `run <N>: live (PR #<number> open) — skipped`
(the first row's `number`), `live` carries `{ run: <N>, why: 'PR #<number> open' }`, and no
POST, DELETE, PATCH or closed-PR read names the run; an empty array → the run proceeds to M3's
sweep. A pair skipped under M2 is asked no open-PR read.
M5. Under `--dry-run`, in either flag order, a run skipped under M2 or M4 prints the byte-
identical line it prints without the flag, and only a terminal pair with no open PR prints a
`would` line; the calls through the seam are exactly the one heads-and-tags listing, then per
pair in ascending N: the status read, then (terminal page only) the open-PR read, then (no open
PR only) the closed-PR read — no `-X` on any `gh` call and no `git` call but the listing.
M6. Run as a process against `git`/`gh` shims first on `PATH` whose `gh` answers the contents
read with a `running` envelope, `node fleet/retire.mjs --target <t>` exits 0, prints
`run 3: live (running) — skipped` on its own stdout, and the `gh` log carries no `-X` and no
`--delete`.
M7. `fleet/CONTRACT.md`'s `**The two tags**` bullet under §Literals and `fleet/RUNBOOK.md`'s
`## Rollback` section each say the sweep reads a pair's status page first and skips a run whose
state is not terminal or whose integration branch has an open pull request, each carrying the
line's literal `— skipped`, and `tests/test_docs_agree_with_code.py` is green over the edited
documents.

**Authorized-by:** #706 (desired state, 2026-09-05); `fleet/CONTRACT.md` §Literals (the
`**The two tags**` bullet — "a run that ends `failed` keeps them for the one-time sweep");
`fleet/janitor.mjs` `REAPABLE_STATES` (the one place the terminal states are spelled);
doctrine "One merge, one writer" in `CLAUDE.md` (run STATE has one writer — the sandbox — and
its record is git).

**Interfaces:**
- Consumes: none
- Produces: `live: Array<{ run: number, why: string }>`

**Context:** The facts below were read off the tree this plan was authored against; every line
number is approximate and the names are exact.

*What the sweep does at BASE.* `retire({ argv = [], exec = defaultExec })` (`fleet/retire.mjs`
~198) makes ONE `git ls-remote <url> refs/heads/ultra/* refs/tags/ultra/*`, `runsOf` (~94)
turns it into `{ run, plan, evidence, branches }` entries ascending, and the loop decides each
run with `say(line)` — `lines.push` then `process.stdout.write` — before the next is started. A
half pair is `run N: skip — lone <branches>` and pushes the branch NAMES onto `skipped`; that is
what `skipped` means and the live skip is a different reason under a different field (`live`).
`--dry-run` calls `pullsToPatch` (~167: `ghRead` of
`repos/<t>/pulls?state=closed&head=<owner>:ultra/integration-run-<N>`) and says `would retire …`;
without the flag the order is `createTag` ×2 (`gh api -X POST repos/<t>/git/refs -f ref=… -f
sha=…`), `readTags` (`git ls-remote --tags <url> refs/tags/<plan tag> refs/tags/<evidence tag>`),
`tagIsAt` → on a miss `kept.push(run)` and `run N: kept — <why>`, else DELETE ×2
(`gh api -X DELETE repos/<t>/git/refs/heads/<branch>`), `pullsToPatch` then `patchPull` per
patch, `retired.push(run)`, `run N: retired …`. `kept.length > 0` sets `process.exitCode = 1`;
nothing else does. `ghRead(exec, apiPath)` (~114) is `exec('gh', ['api', apiPath])` → `parseJson`
on exit 0, else `null`; `parseJson` (`fleet/lobby.mjs` ~359) answers `null` for empty text. The
return is `{ target, dryRun, retired, kept, skipped, lines }`; M2 adds `live` to it.

*How the page is read elsewhere at BASE — the shape to reproduce, not import.* The janitor's
`readContentsAt` (`fleet/janitor.mjs` ~134, module-private) does
`ghApi(exec, \`repos/${target}/contents/.ultrapowers/runs/${run}/status.json?ref=${ref}\`)`,
accepts only a payload with a string `content`, and decodes
`Buffer.from(payload.content, 'base64').toString('utf8')` through `parseJson`; a payload that is
not the envelope (a bare array, `null`) is "no page". `REAPABLE_STATES` (~106) is the exported
`Object.freeze(['done', 'parked', 'failed'])`; `LIVE_STATES` (~107) is
`['booting', 'running', 'publishing']`. `fleet/janitor.mjs` is importable without side effects
(its `main` is behind the same `invokedPath === fileURLToPath(import.meta.url)` guard as
`retire.mjs`'s) and nothing in `retire.mjs` imports it today. The Global Constraints' Check keeps
`janitor.mjs` unedited, so the four-line reader lives in `retire.mjs` and only the literal is
imported. The boot script (`fleet/sandbox-boot.sh`) writes the page's `state` as one of the six
words in the contract's `**status.json:**` bullet, and since #704 tags and deletes the evidence
branch at publish, so a pair still carrying a branch is a run in flight or one that ended before
publish — the page decides which. An evidence branch exists only after the boot's first
`running "engine starting"` commit, which carries `status.json`, so a pair with no readable page
is an anomaly and is skipped, never swept (M2's `no status page` row).

*The `head=` filter.* GitHub's pulls list matches `head=<owner>:<ref>` on the head ref's NAME;
`state=open` is the only difference between the open-PR read and `pullsToPatch`'s closed read.
Neither read names `refs/heads/ultra/integration-run-<N>`, and the existing rule "no command
names `refs/heads/ultra/integration-run-N` at all" stays true.

*What the read moves in the existing sim.* `fleet/tests/test_retire.mjs` builds every seam with
`makeSeam` (~231) whose rules answer the heads listing, the tag verify, the POST, the `/pulls?`
read (regex `/\/pulls\?/` on `argv[1]`, keyed by the run in `ultra/integration-run-<N>`), the
PATCH and the DELETE; a command no rule matches gets `{ code: 0, stdout: '' }`, which `parseJson`
reads as `null` — so without a new rule for the contents read every pair reads as `no status
page` and every existing candidate leg fails. The rule this task adds answers the contents read
from a per-run page map (default: run 3 and run 12 both `done`), as an envelope
`{ content: Buffer.from(JSON.stringify(page)).toString('base64'), sha: '<hex>' }`; the
`/pulls?` rule must tell `state=open` from `state=closed` (an `openPulls` map beside `PULLS`,
default empty). Three existing pins move with the read and are this task's to update, keeping
their meaning: `sweepOf` (~318) filters out `/pulls` lines only, so the contents read — which
`namesRun(l, 3)` matches on `run-3` — must be filtered out too, or `sweepLines` must carry it;
leg (g)'s `lines(exec)` deep-equals `[LIST_LINE, pullsLine(3), pullsLine(12)]` and becomes M5's
sequence; leg (i)'s `loggingShims` (~465) `gh` prints `[]` for every call and asserts `gh` is
reached exactly once under `--dry-run` — its shim must answer the `contents/` call (dispatch on
`$*`) with a `done` envelope, and the count becomes three (contents, open, closed). Fixtures:
`HEAD` (~70) has runs 3 and 12 as pairs and 5 as a lone half; `captured` (~169) grades only what
reached `process.stdout.write`; `runLine(out, N)` asserts exactly one `run N:` line; the final
loop over `SEAMS` (~434) asserts only `git` and `gh` reach the seam. New legs sit in their own
region under a comment naming this task (`#706 — the status read gates the sweep`), below the
existing groups and above the `cliRoot` process legs, except the process leg, which sits beside
the existing process legs; no `test_<task-noun>.mjs` is opened.

*The two sentences.* `fleet/CONTRACT.md` ~61–68, the `**The two tags**` bullet, ends "a run that
ends `failed` keeps them for the one-time sweep (`node fleet/retire.mjs --target <owner>/<repo>`,
for the runs already on a target). The record is read by tag: …" — the skip sentence joins
that bullet (the `Run:` below spans it from its `- **The two tags` line to the `- **Comment**`
line). `fleet/RUNBOOK.md` ~440–447, under `## Rollback` (the last section), says "the one-time
retire sweep is what clears those, never a `git push origin --delete` by hand" — the skip
sentence joins that paragraph. `tests/test_docs_agree_with_code.py` pins the contract's bullet
to the two tag literals and the two branch literals (unchanged) and refuses any `?ref=` that
starts `ultra/evidence-run-` in either file: the sentence says "on the evidence branch" in prose.
The runbook is a hand-executed record, and this task adds one sentence to it that no sandbox can
act on; its evidence is the second `Run:` below (the sentence is in the section) and the third
(the pins still hold) — review checks correspondence to those two exits, not the sweep's live
behaviour, which the seam legs establish.

**Proof:**
- Test: `fleet/tests/test_retire.mjs`
- Legs, under a comment naming this task (`#706 — the status read gates the sweep`):
  (a) on the healthy seam (both pages `done`), the `exec` seam's record `healthy.calls` has
  exactly one line naming run 3 that is
  `gh api repos/o/r/contents/.ultrapowers/runs/3/status.json?ref=ultra/evidence-run-3`, it
  precedes the first POST naming run 3, the same holds for run 12, and no call naming run 5 is a
  `contents/` read — a tool that reads the page after tagging, twice, or for the lone half fails
  it [M1];
  (b) the source of `fleet/retire.mjs` (`fs.readFileSync(RETIRE_SRC, 'utf8')`) matches
  `/import\s*\{[^}]*\bREAPABLE_STATES\b[^}]*\}\s*from\s*'\.\/janitor\.mjs'/` and does not match
  `/['"]done['"]\s*,\s*['"]parked['"]\s*,\s*['"]failed['"]/` — a retyped list fails it [M1];
  (c) for each of `booting`, `running`, `publishing` and `blocked` as run 3's page state (run 12
  `done`, so the live pair is the FIRST candidate and a terminal one follows it): `runLine(out, 3)` is
  exactly `run 3: live (<state>) — skipped`, the calls naming run 3 are exactly the one contents
  read (no POST, no `--tags`, no DELETE, no PATCH, no `/pulls`), `out.result.live` deep-equals
  `[{ run: 3, why: '<state>' }]`, `retired` deep-equals `[12]`, `kept` deep-equals `[]`,
  `skipped` still names only run 5, `sweepOf(exec, 12)` deep-equals `sweepLines(12)`, run 12's
  line says `retired` and comes after run 3's, and `out.exitCode` is not 1 — a tool that
  returns from the sweep after a skip, a run skipped as `kept`, one listed under `skipped`, or an
  exit code of 1 fails it, and so does a denylist of the three live states, which would sweep
  the `blocked` row; and the mirror, `running` as run 12's page state with run 3 `done`:
  `runLine(out, 12)` is exactly `run 12: live (running) — skipped`, `retired` deep-equals `[3]`,
  `live` deep-equals `[{ run: 12, why: 'running' }]` [M2];
  (d) for each of a contents read answering `code: 1` with `HTTP 404` on stderr, a bare `[]`
  body, and an envelope whose page is `{ run: '3' }` with no `state` — each as run 3's answer,
  run 12 `done`: `runLine(out, 3)` is exactly `run 3: live (no status page) — skipped`, no POST
  or DELETE names run 3, `live` deep-equals `[{ run: 3, why: 'no status page' }]`, and
  `retired` deep-equals `[12]` [M2];
  (e) with run 3's page state `done` (the healthy seam): `sweepOf(healthy, 3)` — with the
  contents and pulls reads filtered out — deep-equals `sweepLines(3)`, `runLine(base, 3)` says
  `retired`, and `base.result.live` deep-equals `[]` [M3];
  (f) with run 3's page state `parked` (run 12 `done`): `sweepOf(exec, 3)` deep-equals
  `sweepLines(3)`, `runLine(out, 3)` says `retired`, `live` deep-equals `[]` — a `parked` run
  that is skipped fails it [M3];
  (g) with run 3's page state `failed` (run 12 `done`): `sweepOf(exec, 3)` deep-equals
  `sweepLines(3)`, `runLine(out, 3)` says `retired`, `live` deep-equals `[]` — a `failed` run
  that is skipped fails it [M3];
  (h) with run 3's open-PR read answering `[{ number: 41, body: '' }]` and run 12's `[]`: the
  calls naming run 3 are exactly the contents read then
  `gh api repos/o/r/pulls?state=open&head=o:ultra/integration-run-3`, in that order, and none
  of POST, DELETE, PATCH or `state=closed`; `runLine(out, 3)` is exactly
  `run 3: live (PR #41 open) — skipped`; `live` deep-equals `[{ run: 3, why: 'PR #41 open' }]`;
  `sweepOf(exec, 12)` deep-equals `sweepLines(12)` and run 12's line says `retired`; and the
  open-PR read for run 12 sits after run 12's contents read and before run 12's first POST
  [M4];
  (i) on the healthy seam every pair's open-PR read answers `[]` and both runs are `retired`
  (the control), while in (c)'s `running`-as-run-3 case no `state=open` read names run 3 [M4];
  (j) for each of `['--target', TARGET, '--dry-run']` and `['--dry-run', '--target', TARGET]`,
  with run 3's page `running` and run 12 terminal with no open PR: `lines(exec)` deep-equals
  `[LIST_LINE, contentsLine(3), contentsLine(12), openPullsLine(12), pullsLine(12)]`,
  `runLine(out, 3)` equals the line captured in (c)'s `running`-as-run-3 case, `runLine(out, 12)`
  says `would`, no `gh` line carries ` -X `, no `git` line but `LIST_LINE` is made, and
  `exitCode` is not 1; and with run 3's page `done` and its open-PR read answering
  `[{ number: 41 }]`, run 12's page `running`: `lines(exec)` deep-equals
  `[LIST_LINE, contentsLine(3), openPullsLine(3), contentsLine(12)]`, `runLine(out, 3)` equals
  the line captured in (h), and `runLine(out, 12)` equals the line captured in (c)'s mirror —
  a dry run that prints `would` for a live run, stops after a skip, or prints a different skip
  line, fails it [M5];
  (k) a process spawned as `node fleet/retire.mjs --target o/r` against shims whose `git`
  prints run 3's pair listing and whose `gh` answers a `contents/` call with a `running`
  envelope and `[]` otherwise: `status` is 0, `stdout` has a line exactly
  `run 3: live (running) — skipped`, and no `gh` log line contains `-X` or `--delete`; and the
  existing process legs, their `gh` shim now answering the `contents/` call with a `done`
  envelope, still pass as written (dry: `run 3: would`, three `gh` calls; live: the first `-X`
  call is the plan-tag POST) [M6];
  (l) the three `Run:` commands below exit 0: the first finds `— skipped` inside the contract's
  `**The two tags**` bullet, the second finds it inside the runbook's `## Rollback` section, the
  third is the docs-pin suite green over both edited documents — a skip declared in one document
  only, or a `?ref=ultra/evidence-run-` in either, fails it [M7].
- Run: sed -n '/^- \*\*The two tags\*\*/,/^- \*\*Comment\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q -- '— skipped'
- Run: sed -n '/^## Rollback/,$p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q -- '— skipped'
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider

**Stale-if:**
- issue-closed: #706
- path-absent: `fleet/retire.mjs`
- path-absent: `fleet/tests/test_retire.mjs`
- path-absent: `fleet/janitor.mjs`
