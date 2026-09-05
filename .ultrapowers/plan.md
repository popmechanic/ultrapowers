# The janitor reads a finished run by its tag

**Grammar:** claims-v1

**Claim:** After this run, the janitor still reaps a run whose plan and evidence branches are
gone, because it reads the record by its tag; and a sandbox that died mid-run is still written
up and reaped exactly as it is today. (elicited)

**Goal:** Bundle R1c of the 2026-09-05 wave — one task, the janitor half of run-27's plan
(`2026-09-05-boot-and-record-follow-up.md`, task 2), re-derived against a BASE that carries
#607. At BASE the boot script's `record_tags` (in `fleet/sandbox-boot.sh`) tags a finished
run's plan commit `ultra/plan/run-<N>` and evidence head `ultra/evidence/run-<N>` and deletes
`ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in the same push, while `fleet/janitor.mjs`
reads a run's status page only at `?ref=ultra/evidence-run-<N>` and ages a page-less run only
from `branches/ultra/plan-run-<N>` — so for every finished run both reads answer 404 and its
VM is never reaped (run-25's critic on task 4). After this run the janitor reads the evidence
tag first and the branch only when the tag answers no contents envelope, ages a page-less run
from the plan tag's commit and then from the plan branch, and names the ref it read in every
`stale` line. #607's death write is untouched: a sandbox that died never published, so its
branches still exist and the death is written to the branch as today, and its sim stays green.
This plan closes nothing new — #624 closes with PR #704.

**Tech Stack:** Node 24 ESM (`fleet/janitor.mjs`; the `fleet/tests/test_*.mjs` sims, each
run as `node fleet/tests/<file>.mjs` to the sentinel `ALL TESTS PASSED`, opening no socket —
`gh` and `ssh` reach them only through the `exec` seam of `fleet/tests/_lobby_helpers.mjs`),
Python 3 (`python3 -m pytest`, which bridges every sim through `tests/test_fleet_suite.py`).
Nothing is added to any dependency file; the janitor keeps importing only `node:`-prefixed
specifiers and `./lobby.mjs`.

**Spec:** none — #624 (decision c, recorded 2026-09-05: tags are the record, branches are
transient, the harvester reads by tag), run-25's critic finding on its task 4 (the record step
blinds `fleet/janitor.mjs`), and #607 (the death write, merged as PR #690). Every fact a worker
needs from them is in the task's Context, because the sandbox has no `docs/superpowers/`.

**Parallelization rationale:** One wave, width 1. The plan is genuinely linear because it is
one contract: one module owns the read order, and its two sims — the exam and the reap-only
sim whose canned pages are keyed to the branch path — are pinned to that same module, so no
second task could carry its own contract without also carrying this one's file. No task
consumes a sibling's symbol; nothing waits.

## Global Constraints

- Check: test "$(git hash-object fleet/lobby.mjs)" = 62d348b5982a879df341fdf77e0115ae1d639719
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 50a1c28c8739e8c395241a4c4dec7c832be0ab4b
- Check: test "$(git hash-object fleet/launch.mjs)" = def913a048a5a4271a14ddd4c75d44e5c6b697dd
- The janitor's only mutation of the fleet is `rm <vm> --json`, and its only writes of the
  target are #607's two `gh api -X PUT` calls on the contents API; it runs no `git`, opens
  nothing under `~/.ultrapowers/` but `fleet.json`, and clones nothing.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The janitor reads a finished run by its tag

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/tests/test_janitor_reap_only.mjs`
- Test: `fleet/tests/test_janitor.mjs`

**Claim:** The janitor reaps a finished run whose plan and evidence branches the sandbox has
already deleted: it reads the run's status page at the evidence tag first and at the evidence
branch only while the sweep is pending, ages a run that has no page from the plan tag's commit
and then from the plan branch, says which ref it read, and still writes a dead sandbox's death
to its branch exactly as today. (derived)
Machine: M1. For every row with a readable assignment, the janitor's first `gh api` read is
`repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`; it
reads the same path with `?ref=ultra/evidence-run-<N>` only when the tag read answers no
contents envelope — a 404, or a body with no string `content` — and never when the tag
answered one; a page found on either ref drives the verdict as at BASE — `rm <vm> --json` for
a `state` in `done|parked|failed` whose `updatedAt` is older than `--age` (default `1h`),
nothing otherwise — and a page served bare on both refs removes nothing. M2. When neither ref
answers a page, the run is aged from the plan tag: `gh api
repos/<target>/git/ref/tags/ultra/plan/run-<N>` is read for `.object.sha`, then `gh api
repos/<target>/commits/<that sha>` for `.commit.committer.date`; `repos/<target>/branches/ultra/plan-run-<N>`
is read for `.commit.commit.committer.date` only when the tag ref read answers no hex string at
`.object.sha` — a 404, a JSON array, an object with no `.object.sha`, or an `.object.sha` that is
not hex — and then no `commits/` read is issued for that row; an age of six hours or more from either
source puts the row in `stale`, a younger age leaves it in neither `stale` nor `actions`, and a
row with no age from any source is in neither. M3. Every `stale` entry's `from` is the ref its
`lastUpdate` was read from — `ultra/evidence/run-<N>`, `ultra/evidence-run-<N>`,
`ultra/plan/run-<N>` or `ultra/plan-run-<N>` — and `renderJanitor` prints it in the parentheses
of the `stale` line, whose shape is otherwise BASE's: `stale <vm>  run=<N> state=<state or none>
last update <iso> (<from>) — look before you rm`. M4. #607 is unchanged: a page whose `state` is
`booting|running|publishing` draws exactly one unit read over `ssh` at the row's own `ssh_dest`;
when the unit is dead, the journal read to the same destination and both `gh api -X PUT` writes
follow, each carrying `-f branch=ultra/evidence-run-<N>`, the `status.json` write carrying
`-f sha=<the sha of the envelope the page was read from>` and a `content=` decoding to the page
with `state` `failed`, the `janitor-journal.txt` write carrying no `sha=`; a live or unreadable
unit writes nothing; and `fleet/tests/test_janitor_liveness.mjs`, byte-identical to BASE, prints
`ALL TESTS PASSED`. M5. Everything else holds as at BASE: `--dry-run` issues the same reads and
no `rm`; a row with no comment or no `target=` lands in `unknown`, is printed as `unknown <vm>
no readable assignment — look before you rm`, and draws no `gh api` read; every `gh` call that
is not one of M4's `-X PUT` writes is exactly two argv words, `api` and a path beginning
`repos/`; no `git` command is issued, every `ssh <ssh_dest>` command is M4's unit read or
journal read at the `ssh_dest` of a row whose page said `booting|running|publishing`, and
nothing under `~/.ultrapowers/` but `fleet.json` is read; `fleet/tests/test_janitor_reap_only.mjs`
with its pages re-keyed to the tag path, `fleet/tests/test_launch_reaps.mjs` untouched with its
pages on the branch path, and `fleet/tests/test_launch.mjs` untouched each print
`ALL TESTS PASSED`.

**Authorized-by:** #624 (decision c, 2026-09-05: the record is two tags, the branches are transient, the harvester reads by tag); run-25's critic finding on its task 4 (the record step blinds `fleet/janitor.mjs`); #607 (the death write, kept whole)

**Interfaces:**
- Consumes: none
- Produces: `janitor({ argv, exec, config, now }) -> Promise<{ dryRun, age, actions, stale, unknown, deaths }>`
- Produces: `renderJanitor(result) -> string`

**Context:** At BASE the boot's `record_tags` (in `fleet/sandbox-boot.sh`, not this task's to
touch) runs after the last evidence push of a `done` or `parked` run: it tags the plan commit
`ultra/plan/run-<N>` and the evidence head `ultra/evidence/run-<N>`, verifies both against the
remote with `git ls-remote --tags`, and deletes `ultra/plan-run-<N>` and `ultra/evidence-run-<N>`
in one push. So a finished run has its page on the tag and no branch; a run still in flight has
its page on the branch and no tag; a run that ended `failed`, a run whose tags did not verify,
and every run from before the tags keep their branches until a one-time sweep tags them. The
janitor at BASE reads only `?ref=ultra/evidence-run-<N>` (`readEvidence`) and ages a page-less
run only from `repos/<target>/branches/ultra/plan-run-<N>` (`planCommittedAt`), so for every
finished run both reads answer 404, both helpers return null, the loop continues, and no VM is
reaped. The contents API resolves `?ref=` to a branch or a tag alike, which is why the same path
with a different `ref=` is the whole change for the page read. The tag's own document is
`repos/<owner>/<repo>/git/ref/tags/ultra/plan/run-<N>` — slashes in the tag name spelled as they
are — answering `{ ref, node_id, url, object: { sha, type, url } }` for a lightweight tag; GitHub
answers a name with no exact match as a 404 on that endpoint, and the sibling `git/refs/` endpoint
answers an array of prefix matches, so treat anything without a string `object.sha` that passes
`isSafeSha` (a BASE export of `fleet/lobby.mjs`: 7 to 64 hex characters) as no tag and never
splice an unchecked value into a path. `repos/<owner>/<repo>/commits/<sha>` answers the commit
document whose committer date is at `.commit.committer.date` — one level shallower than the
branches endpoint's `.commit.commit.committer.date`. `gh api <path>` answers an absent ref as exit
1 with `HTTP 404` on stderr, which the module's `ghApi` already turns into null. `planTagFor`,
`evidenceTagFor`, `planBranchFor`, `evidenceBranchFor` and `isSafeSha` are BASE exports of
`fleet/lobby.mjs`; add no export there — its blob is pinned by the Global Constraints. Keep the
module's shape: `janitor({ argv, exec, config, now })`, the `ghApi` helper, `REAPABLE_STATES`,
`LIVE_STATES`, `DEFAULT_AGE`, `STALE_MS`, `renderJanitor`, `USAGE`, and the result's six fields
`{ dryRun, age, actions, stale, unknown, deaths }`; the reap stays the only removal. #607 lives in
the same module and is kept whole: `readUnit`, `unitIsDead`, `writeDeath` and the two `ghPut`
calls are unchanged, the unit read still fires for a page in `LIVE_STATES` whichever ref the page
came from, and the death is written to `ultra/evidence-run-<N>` with the envelope's `sha` as
today — a sandbox that died never reached `record_tags`, so its branches exist. The one thing
`readEvidence` must add to its answer is which ref the envelope came from, so `stale` can name
it: `from` was `planBranchFor(run)` or `evidenceBranchFor(run)` at BASE and now names whichever
of the four refs answered; the `stale` line's shape is otherwise unchanged, and so are the `rm`
action shape `{ kind, vm, run, state, updatedAt, command, applied }`, the `death` line and the
`unknown` line. Rewrite the module's header comment so it describes the tag-first read and the
plan-tag age. Three sims stub the janitor and are kept green as follows.
`fleet/tests/test_janitor_reap_only.mjs` (this task's to modify) cans two `done` pages under a
`PAGES` map keyed by its `evidencePath(run)` helper, which spells the branch path with
`evidenceBranchFor`, and pins the exact set of `gh` argvs as one read per row at that path plus
the two-argv-words rule: change its import from `evidenceBranchFor` to `evidenceTagFor`, re-key
`evidencePath` to the tag, and reword the assertion messages that spell the path, so the
janitor's one read per row is the tag read and every other leg — including its document legs
over `fleet/RUNBOOK.md` and `skills/ultrapowers/SKILL.md` — stands unchanged.
`fleet/tests/test_janitor_liveness.mjs` (not this task's; its blob is pinned) cans every page at
the branch path, a 404 row whose `branches/ultra/plan-run-37` answers three hours old, and unit
answers per `ssh_dest` through `vmRule`; it pins the `-f branch=` of both writes to
`evidenceBranchFor(n)` and the `stale` entry of a seven-hour-old `running` row to `from:
evidenceBranchFor(51)` — the tag-then-branch order keeps all of it green without an edit.
`fleet/tests/test_launch_reaps.mjs` (not this task's) cans two pages at the branch path, 404s
every other path, and asserts one `rm` for its old run. The exam `fleet/tests/test_janitor.mjs`
is rewritten by the examiner in its BASE shape — `makeExec({ rules, passthrough: [] })`,
`sshRule('ls ', …)` answering `vmsPayload(rows)`, `sshRule('rm ', answer(''))`, one
`cmdRule('gh', 'api', …)` answering canned paths (an envelope, a bare page, a branch document, a
tag-ref document, a commit document) and `HTTP 404` for every other path, `vmRule` for a per-
destination unit answer where a leg needs one, `exec.calls`, `exec.vm()` and `exec.mutating()`
read back: its BASE legs pin the branch-only read (`contentsReads` equal to the branch paths,
`?ref=ultra/evidence-run-9` as the exact path, `from` equal to `ultra/plan-run-21`) and must
become the tag-first legs below; the header docstring's clause list is rewritten to match. The
`stale` line at BASE is `stale <vm>  run=<N> state=<state or none> last update <iso> (<from>) —
look before you rm` with two spaces after the VM name; the `death` line ends with
`evidenceBranchFor(run)` and is not this task's to change.
**BASE facts:** (generated at 043b686)
- `state` at `fleet/claude-token.mjs:54` blob 356883f
- `updatedAt` at `fleet/janitor.mjs:339` blob c189200
- `stale` at `fleet/doctor.mjs:255` blob 2332a5a
- `actions` at `fleet/janitor.mjs:291` blob c189200
- `from` at `fleet/run-main.mjs:333` blob 8dcde61
- `renderJanitor` at `fleet/janitor.mjs:382` blob c189200
- `failed` at `fleet/run-engine.mjs:783` blob 5523301
- `fleet/tests/test_janitor_liveness.mjs` blob dce8666
- `unknown` at `fleet/janitor.mjs:293` blob c189200
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `fleet/tests/test_janitor_reap_only.mjs` blob adc4ac2
- `fleet/tests/test_launch_reaps.mjs` blob 1031e90
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fleet/janitor.mjs` blob c189200
- `fleet/sandbox-boot.sh` blob 50a1c28
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `readEvidence` at `fleet/janitor.mjs:114` blob c189200
- `planCommittedAt` at `fleet/janitor.mjs:152` blob c189200
- `isSafeSha` at `fleet/lobby.mjs:45` blob 62d348b
- `fleet/lobby.mjs` blob 62d348b
- `ghApi` at `fleet/janitor.mjs:103` blob c189200
- `planTagFor` at `fleet/lobby.mjs:126` blob 62d348b
- `evidenceTagFor` at `fleet/lobby.mjs:127` blob 62d348b
- `planBranchFor` at `fleet/lobby.mjs:113` blob 62d348b
- `evidenceBranchFor` at `fleet/lobby.mjs:115` blob 62d348b
- `REAPABLE_STATES` at `fleet/janitor.mjs:90` blob c189200
- `LIVE_STATES` at `fleet/janitor.mjs:92` blob c189200
- `DEFAULT_AGE` at `fleet/janitor.mjs:94` blob c189200
- `STALE_MS` at `fleet/janitor.mjs:96` blob c189200
- `USAGE` at `fleet/janitor.mjs:85` blob c189200
- `readUnit` at `fleet/janitor.mjs:210` blob c189200
- `unitIsDead` at `fleet/janitor.mjs:228` blob c189200
- `writeDeath` at `fleet/janitor.mjs:247` blob c189200
- `ghPut` at `fleet/janitor.mjs:135` blob c189200
- `sha` at `fleet/launch.mjs:165` blob def913a
- `death` at `fleet/janitor.mjs:248` blob c189200
- `PAGES` at `fleet/tests/test_janitor_reap_only.mjs:126` blob adc4ac2
- `evidencePath` at `fleet/tests/test_janitor.mjs:58` blob 0146544
- `fleet/RUNBOOK.md` blob a9e2912
- `skills/ultrapowers/SKILL.md` blob 802f596
- `vmRule` at `fleet/tests/_lobby_helpers.mjs:44` blob 86c4674
- `running` at `fleet/tests/test_sandbox_boot_merge.mjs:137` blob bed2fad
- `fleet/tests/test_janitor.mjs` blob 0146544
- `contentsReads` at `fleet/tests/test_janitor.mjs:128` blob 0146544
- `deaths` at `fleet/janitor.mjs:294` blob c189200
- `ls` at `fleet/tests/test_sandbox_boot_merge.mjs:508` blob bed2fad
- `applied` at `fleet/run-engine.mjs:1609` blob 5523301

**Proof:**
- Test: `fleet/tests/test_janitor.mjs`
- Legs: (a) over a fleet of nine rows whose pages are canned at the tag path only — `done`,
  `parked` and `failed` two hours old; `failed` thirty minutes old; `done` sixty-one and
  fifty-nine minutes old; `running` a minute old; `booting` and `publishing` three hours old —
  every row gets exactly one contents read, at `repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`,
  no `gh` path contains `ultra/evidence-run-`, and the mutating lobby verbs are exactly
  `rm <vm> --json` for the three two-hour-old rows and the sixty-one-minute `done` row;
  `--age 3h` over the same fleet removes nothing and still issues every tag read [M1]; and over
  that same tag-served fleet the `running`, `booting` and `publishing` rows each draw exactly one
  `ssh <ssh_dest>` unit read at their own `ssh_dest` while the six finished rows draw none — the
  unit read fires for a live page whichever ref served it [M4]; (b) over
  the same nine rows with the pages canned at the branch path only: each row's contents reads are
  the tag path then the branch path `?ref=ultra/evidence-run-<N>`, in that order and no others, the same four `rm`s fire, and a
  row whose comment says `target=other/repo` with its page on the branch is read under
  `repos/other/repo/contents/.ultrapowers/runs/9/status.json` with `?ref=ultra/evidence/run-9`
  first and `?ref=ultra/evidence-run-9` second, and its `rm` fires [M1]; (c) a two-hour-old
  `done` page served bare — the status JSON with no `content` — on the tag with the branch 404,
  and served bare on the branch with the tag 404, each remove nothing and report no action; the
  same page bare on the tag and enveloped on the branch draws the branch read and its `rm`
  [M1]; (d) ten page-less rows, one per row: run 21, whose `git/ref/tags/ultra/plan/run-21`
  answers an `.object.sha` of 40 hex characters and whose `commits/<that sha>` answers a
  committer date seven hours old, is `stale` with `from` `ultra/plan/run-21` and `lastUpdate`
  that date, and `branches/ultra/plan-run-21` is never read; run 24, the same with a date three
  hours old, is in neither `stale` nor `actions`; run 25, whose tag ref answers 404 and whose
  `branches/ultra/plan-run-25` answers a committer date seven hours old, is `stale` with `from`
  `ultra/plan-run-25` and no `commits/` read; run 26, with the tag ref 404 and the branch date
  three hours old, is in neither; run 27, with every read 404, is in neither; run 28, whose tag
  ref answers a JSON array and whose branch date is seven hours old, is `stale` with `from`
  `ultra/plan-run-28` and no `commits/` read; run 29, whose tag ref answers
  `{ object: { sha: 'not-a-sha' } }` and whose branch date is seven hours old, is `stale` with
  `from` `ultra/plan-run-29`, and no `gh` path contains `not-a-sha`; run 30, whose tag ref
  answers `{ object: {} }` — no `.object.sha` at all — and whose branch date is seven hours old,
  is `stale` with `from` `ultra/plan-run-30` and no `commits/` read; run 31, whose tag sha's
  commit date is exactly six hours old, is `stale` with `from` `ultra/plan/run-31`; run 32, whose
  tag sha's commit date is five hours and fifty-nine minutes old, is in neither; and across these
  ten rows the only `commits/` reads are runs 21, 24, 31 and 32's, each at its own tag's sha
  [M2, M3]; (e) a `running`
  row silent seven hours whose page is on the tag is `stale` with `from`
  `ultra/evidence/run-<N>`; the same page on the branch gives `from` `ultra/evidence-run-<N>`;
  each rendered line matches `^stale <vm>  run=<N> state=running last update <iso> \(<from>\) —
  look before you rm$` with that `from`; the page-less `stale` lines of the previous leg match
  the same shape with `state=none` and their own `from`; and a `running` row updated a minute
  ago is not stale [M3]; (f) a `running` page a minute old on the branch with the tag 404, whose
  `ssh_dest` answers `ActiveState=failed`, `SubState=failed`, `Result=exit-code`,
  `ExecMainStatus=1` to the unit read and a journal text to the journal read: exactly one unit
  read and one journal read, both at that `ssh_dest`; exactly one `gh` call with `-X` `PUT` at
  `.../runs/<N>/status.json` carrying `-f branch=ultra/evidence-run-<N>`, `-f sha=` the sha the
  envelope carried, and a `content=` decoding to the page with `state` `failed`; exactly one
  `-X` `PUT` at `.../runs/<N>/janitor-journal.txt` with the same `branch=` and no `sha=`; the row
  in `deaths` with `applied: true` and in no action; the same dead row with its page served from the tag and the branch 404 draws the
  same two `-X` `PUT` writes, each carrying `-f branch=ultra/evidence-run-<N>` — never
  `ultra/evidence/run-<N>` — and the `status.json` write carrying `-f sha=` the sha the tag's
  envelope carried; the same row whose unit answers `ActiveState=active` draws no `gh` call
  carrying `-X` and no journal read; and
  `fleet/tests/test_janitor_liveness.mjs`, at its frozen BASE blob, runs to its sentinel in the
  Run bullets below [M4]; (g) a row with
  no comment and a row whose comment is `run=12 base=abc` — no `target=` — land in `unknown`, are printed as
  `unknown <vm>  no readable assignment — look before you rm`, and cause no `gh api` read naming
  run 12 or run 20; `--dry-run` over the fleet of the first leg issues the same `gh` paths and the
  same `ls` read, no `rm`, reports the four rows with `applied` false, and prints `would rm`;
  across every exec of every leg, every `gh` call whose argv lacks `-X` is two argv words
  beginning `api` and `repos/`, no `git` command is issued, and every `ssh <ssh_dest>` command
  starts with the unit read or the journal read literal and goes to the `ssh_dest` of a row whose
  page said `booting|running|publishing`; and with `HOME` pointed at a directory holding
  `fleet.json` beside a canary `runs/3/status.json` saying run 3 finished a day ago, run 3 is not
  removed [M5].
- Run: node fleet/tests/test_janitor.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs the exam to its sentinel [M1, M2, M3, M4, M5].
- Run: test "$(git hash-object fleet/tests/test_janitor_liveness.mjs)" = dce86660d81281523f3ee2cba4f30279589c416c
- The previous bullet is the frozen pre-edit blob of #607's sim: the sim the next bullet runs is
  BASE's, byte for byte [M4].
- Run: node fleet/tests/test_janitor_liveness.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is #607's sim over pages canned at the branch path: one unit read per
  live row, the death written with `branch=ultra/evidence-run-<N>` and the envelope's `sha=`,
  nothing written for a live or unreadable unit [M4].
- Run: grep -q evidenceTagFor fleet/tests/test_janitor_reap_only.mjs && ! grep -q evidenceBranchFor fleet/tests/test_janitor_reap_only.mjs
- The previous bullet pins the re-keying: the reap-only sim spells its page path with the tag
  helper and no longer imports the branch helper [M5].
- Run: node fleet/tests/test_janitor_reap_only.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the reap-only sim, re-keyed to the tag path: one read per row, two
  argv words, no flag, one `rm`, and its document legs [M5].
- Run: test "$(git hash-object fleet/tests/test_launch_reaps.mjs)" = 1031e90dae32b3ec0d47663a22de5b75e5c41bbc
- The previous bullet is the frozen pre-edit blob of the launcher's reap sim: the sim the next
  bullet runs is BASE's [M5].
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launcher's reap over pages canned at the branch path, untouched by
  this task: the branch fallback keeps it green [M1, M5].
- Run: test "$(git hash-object fleet/tests/_lobby_helpers.mjs)" = 86c4674085d8fefc940938ef80553e4b945ebb34
- The previous bullet is the frozen pre-edit blob of the helper seam every sim above is built
  on [M5].
- Run: test "$(git hash-object fleet/tests/test_launch.mjs)" = 9faf40b1e3ed606b2283c829c0115a74057be9be
- The previous bullet is the frozen pre-edit blob of the launcher sim: the sim the next bullet
  runs is BASE's [M5].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launcher sim, which runs the janitor before its launch [M5].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
- path-absent: `fleet/tests/test_janitor_reap_only.mjs`
- path-absent: `fleet/tests/test_janitor_liveness.mjs`
