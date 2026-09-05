# Boot and record: the run directory is the receipt, the PR closes its tickets, the record is two tags

**Grammar:** claims-v1

**Claim:** After this run, a run I launch reads only its own run directory for its receipt,
its PR ends with one `Closes #N` per ticket my plan names so the self-merge closes them, its
record is two tags on the target — `ultra/plan/run-N` and `ultra/evidence/run-N` — with the
plan and evidence branches gone at publish, a sandbox whose `claude auth status` does not show
`oauth_token` fails before the engine starts and the record says which `claude --version` ran,
and `node fleet/retire.mjs --target owner/repo` turns the old branch pairs into tags. (elicited)

**Goal:** Bundle R1 of the 2026-09-05 wave — four boot-and-record tickets whose files are disjoint from every other bundle. #673: `gate_receipt_path()` and `approve_receipt_path()` in `fleet/sandbox-boot.sh` answer `$TARGET_DIR/fleet-receipts/$RUN_ID/…` FIRST, a pre-lift path that parked runs 13 and 14 on 2026-08-27 fossils; the read of `fleet-receipts/` goes, and the re-entry guard reads only the run directory's marker and receipt. #679 (decided 2026-09-05): the boot's `render_card` reads exactly one `**Closes:** #N #M` line from the plan and appends one `Closes #N` line per number to the PR body, so a self-merged PR closes its tickets; no compiler change, no launcher change, no assignment key. #624 (decision c, 2026-09-05): at publish the sandbox tags the plan commit `ultra/plan/run-N` and the evidence head `ultra/evidence/run-N`, verifies both tags against the remote, and deletes `ultra/plan-run-N` and `ultra/evidence-run-N` in the same step; the launcher reads tags for N (`lobby.mjs`), the harvester reads by tag, and a one-time `fleet/retire.mjs` does the same for the runs already on a target, highest N last. #384: a `claude auth status` that does not show `oauth_token` fails the boot before any worker starts, and the record carries `claude --version`. Two seams this plan cannot close because their files are outside the bundle: `fleet/janitor.mjs` still reads `?ref=ultra/evidence-run-<N>`, so until it follows the tag it cannot read a page whose branch this boot has deleted; and `skills/ultrapowers/SKILL.md`'s read-state recipe still spells the branch. Nothing in `fleet/launch.mjs`, `fleet/janitor.mjs`, `fleet/doctor.mjs`, any `skills/*/SKILL.md` or `README.md` is touched.
**Closes:** #673 #679 #624 #384

**Tech Stack:** bash (`fleet/sandbox-boot.sh` and its sims under `fleet/tests/`, driven against
stub binaries on a prefixed `PATH`), Node 24 ESM (`fleet/lobby.mjs`, the new `fleet/retire.mjs`,
the `fleet/tests/test_*.mjs` sims — each prints `ALL TESTS PASSED` and opens no socket), Python 3
(`skills/ultralearn/scripts/harvest_fleet_runs.py`, `python3 -m pytest`), Markdown. Nothing is
added to any dependency file; `fleet/lobby.mjs` and `fleet/retire.mjs` import only `node:`-prefixed
specifiers.

**Spec:** none — the four issues and the 2026-09-05 decisions recorded on them; every fact a
worker needs from them is in its task's Context, because the sandbox has no `docs/superpowers/`.

**Parallelization rationale:** One wave, width 8. Every task carries its own contract and its own
exam; the shared shapes — the two tag names, the `**Closes:**` line, the receipt path, the
evidence file name — are literals repeated in each Context, never a `Consumes:` of a sibling, so no
task waits on another. Four tasks edit `fleet/sandbox-boot.sh` in four different functions and
`fleet/tests/_sandbox_boot_helpers.mjs` in four different stubs; those are same-file text edits
and fold at merge. Two tasks extend `fleet/tests/test_sandbox_boot_edges.mjs` in two different
numbered sections, not at one location. The retire task, not the documents task, adds the
RUNBOOK line that names `fleet/retire.mjs`, because `tests/test_docs_agree_with_code.py` requires
every `fleet/*.mjs` a document names to exist on the tree the exam runs on, and only the retire
task's clone has the file.

## Global Constraints

- Check: bash -n fleet/sandbox-boot.sh
- Check: node --check fleet/lobby.mjs
- The two tags are spelled `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`; the three branches
  keep their BASE spellings `ultra/plan-run-<N>`, `ultra/integration-run-<N>`,
  `ultra/evidence-run-<N>`. No other ref shape is introduced anywhere.
- The status page keeps exactly its BASE cells (`run`, `state`, `phase`, `pr`, `prAuthor`,
  `merged`, `branch`, `vm`, `startedAt`, `updatedAt`, `error`) and its BASE state vocabulary; no
  task adds a cell or a state.
- Amendment 10 holds: every `git` and every GitHub call is a script's, never a model's, and the
  sandbox reaches GitHub only through `fleet_git`/`fleet_curl` against `github.int.exe.xyz`; the
  laptop tools reach `git`/`gh` only through the `exec` seam so the sims stub them.
- No file outside a task's own Files block is edited — in particular not `fleet/launch.mjs`,
  `fleet/janitor.mjs`, `fleet/doctor.mjs`, `skills/ultrapowers/SKILL.md`, `README.md`,
  `tests/test_harvest_evidence.py` or `fleet/tests/test_janitor*.mjs`; a pin in one of those
  files is kept green by the shape of the change, not by editing the pin.
- No sentence of a document is matched against itself: a documents claim proves itself by a
  scoped `Run:` command over the operative words.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The run directory is the only receipt

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`

**Claim:** the boot script stops reading `fleet-receipts/` at all — the receipt lives in the run
directory since 0.3.5 and the evidence branch is the copy that survives — and the re-entry guard
reads only the run directory's marker and receipt (quoted from #673)
Machine: M1. `gate_receipt_path()` prints `<target clone>/.claude/ultrapowers/run-<runId>/gate-receipt.json`
when that file exists and nothing otherwise, `approve_receipt_path()` the same for
`approve-receipt.json`, and the string `fleet-receipts` occurs nowhere in `fleet/sandbox-boot.sh`
nor in `fleet/tests/_sandbox_boot_helpers.mjs`. M2. A target tree that carries
`fleet-receipts/run-<N>/gate-receipt.json` with verdict `NEEDS_ACK` and whose engine then writes a
`PASS` receipt into the run directory ends `done` with the engine started exactly once and the PR
body carrying `PASS` — the fossil is not read. M3. A boot that finds the run directory's
`gate-receipt.json` already present and no engine marker does not start the engine and still
finishes the run from that receipt. M4. The helpers' engine stub writes the gate receipt at the
run directory path and no stub writes under `fleet-receipts/`, so the green path of every
sandbox-boot sim is green with the run directory as the only receipt.

**Authorized-by:** #673 (its second fix, "(2)", and the 2026-09-05 comment naming lines 512 and 523)

**Interfaces:**
- Consumes: none
- Produces: `gate_receipt_path()`
- Produces: `approve_receipt_path()`

**Context:** At BASE `fleet/sandbox-boot.sh` has `run_dir_path()` printing
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID` (`RUN_ID` is `run-<N>`, so the directory is
`run-run-7` for run 7 — that doubling is the engine's own convention and stays), and directly below
it `gate_receipt_path()` and `approve_receipt_path()` each test
`$TARGET_DIR/fleet-receipts/$RUN_ID/<file>` first and the run directory second. Both callers —
`engine_already_ran`, `collect_evidence`, `gate_verdict`, and the `code = 1` verdict check in
`do_boot` — read the function's stdout and treat an empty answer as "no receipt"; keep that
contract, only the search list changes. Why: on 2026-09-05 runs 13 and 14 parked in two seconds
because the target tree carried tracked `fleet-receipts/run-13 … run-64` from the stamped-run era,
run numbers had restarted at 1, and `engine_already_ran` found a 2026-08-27 receipt naming
`fleet/drive.mjs` before the engine had run. The fossils were deleted from this repository by
#672, so the tree cannot park a run today; the read order is still wrong and any target with an
old `fleet-receipts/` would do the same. In `fleet/tests/_sandbox_boot_helpers.mjs` the
`systemd-run` stub currently does `mkdir -p "$run_dir" "$FLEET_HOME/target/fleet-receipts/run-7"`
and writes `{"verdict":"$STUB_VERDICT"}` to `$FLEET_HOME/target/fleet-receipts/run-7/gate-receipt.json`
while writing `report.json` and `receipt.json` into `$run_dir`; move the receipt write to
`$run_dir/gate-receipt.json` and drop the `fleet-receipts` directory from the `mkdir`, so the
green path (`green()` in the helpers, memoized across every sandbox-boot sim) keeps its `PASS`
verdict through the run directory. `test_sandbox_boot_approved.mjs` and
`test_sandbox_boot_approval_evidence.mjs` already write their approve receipts into
`target/.claude/ultrapowers/run-run-7/` and need no change. The exam extends section 9
(`// ── 9. re-entry`) of `fleet/tests/test_sandbox_boot_edges.mjs`, under a comment naming this
task; another task of this plan extends section 5 of the same file, so add nothing at the end of
the file and nothing in section 5. The clone stub answers `git clone … <dir>` by `mkdir -p
<dir>/.git`, so an exam that pre-creates `<home>/target/fleet-receipts/run-7/gate-receipt.json`
before booting sees `clone_target` log `target: clone already present` and proceed — that is the
fossil case; and pre-creating `<home>/target/.claude/ultrapowers/run-run-7/gate-receipt.json` with
`{"verdict":"PASS"}` before booting is the re-entry case, where the boot logs `engine: already
finished (marker or gate receipt present) — not re-running` and `engineRuns(ctx)` is 0.
`prPosts(ctx)[0].body` is the rendered card and carries the verdict in its `| verdict | … |` row.
**BASE facts:** (generated at e04154b)
- `fleet/sandbox-boot.sh` blob 7cf62ab
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 8b5b99d
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `RUN_ID` at `fleet/tests/test_run_main_engine_dir.mjs:127` blob 51a487e
- `mkdir` at `fleet/tests/test_run_main_engine_dir.mjs:45` blob 51a487e
- `fleet/tests/test_sandbox_boot_edges.mjs` blob 04ae4ee
- `state` at `fleet/claude-token.mjs:54` blob 356883f

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`
- Legs: (a) a home whose `target/fleet-receipts/run-7/gate-receipt.json` is pre-written with
  `{"verdict":"NEEDS_ACK"}` boots to `state` `done`, `engineRuns(ctx)` equals 1, and the PR body's
  verdict row reads `PASS` and never `NEEDS_ACK` — a script that still reads the fossil first
  parks on it and fails this leg [M2]; (b) a home whose
  `target/.claude/ultrapowers/run-run-7/gate-receipt.json` is pre-written with `{"verdict":"PASS"}`
  and no `.fleet-engine-done` marker boots to `done` with `engineRuns(ctx)` equal to 0 and the
  boot log carrying `not re-running` [M3]; (c) the memoized green run's
  `<evidence>/.ultrapowers/runs/7/gate-receipt.json` reads verdict `PASS` while
  `<home>/target/fleet-receipts` does not exist at all after the boot — the receipt travelled from
  the run directory and nothing created the old directory [M4].
- Run: ! grep -n 'fleet-receipts' fleet/sandbox-boot.sh fleet/tests/_sandbox_boot_helpers.mjs
- The previous bullet is the leg that names what is absent: the string is gone from the script
  and from the stub rig, so no path under `fleet-receipts/` can be read or written by either [M1].
- Run: node fleet/tests/test_sandbox_boot_edges.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The two previous bullets run the extended edges sim and the green-path sim to their sentinel;
  the green-path sim's `gate-receipt.json` and `PASS` assertions pass only when the stub's receipt
  reaches the evidence through the run directory [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #673

### Task 2: The PR closes what the plan names, and links the tags

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot.mjs`

**Claim:** opens a PR whose body ends with one `Closes #N` per issue, so the self-merge closes
them (quoted from #679)
Machine: M1. `render_card` reads `$PLAN_FILE` — the plan file `prepare_plan` already writes from
the plan commit's `.ultrapowers/plan.md`, which is the only plan text on the sandbox — and takes
exactly one line: the first line beginning `**Closes:**` that follows the line beginning
`**Goal:**` and precedes the first line beginning `### `; every `#<digits>` token on that line, in
order, becomes one line `Closes #<digits>` and those lines are the last lines of the PR body.
M2. A plan with no such line produces a body with no line beginning `Closes #`. M3. `#<digits>`
tokens anywhere else — on the `**Goal:**` line, on a plain prose line between `**Goal:**` and the
first `### ` heading, on a `**Closes:**` line before `**Goal:**`, on a `**Closes:**` line after the
first `### ` heading — produce no `Closes` line. M4. The card's `### Plan` link is
`https://github.com/<owner>/<repo>/blob/ultra/plan/run-<N>/.ultrapowers/plan.md` and its
`### Evidence` link is `https://github.com/<owner>/<repo>/tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/`,
each under its own heading, and the `| plan | ` row still reads `.ultrapowers/plan.md` at the
plan sha.

**Authorized-by:** #679 (the 2026-09-05 comment "Decided 2026-09-05 (operator, AskUserQuestion): a dedicated `**Closes:**` header line"); #624 (decision c: the plan link is the tag path)

**Interfaces:**
- Consumes: none
- Produces: `plan_closes()`

**Context:** Decided 2026-09-05 on #679: a dedicated `**Closes:**` header line, not the Goal
line — scraping `#\d+` from `**Goal:**` would have had run-18's PR close #653 and #655 alongside
#660 and #668, because the Goal line cites decisions as well as tickets. The line's literal
format, the interface ultrawrite (another bundle) writes and this boot reads:
`**Closes:** #660 #668` — one line, space-separated `#<digits>` tokens, target-repo numbers only,
directly under `**Goal:**` (the Goal paragraph may wrap, so "directly under" is the first
`**Closes:**` line after the `**Goal:**` line and before the first `### ` heading). A number without
an `owner/repo#` prefix already means the target repository to GitHub, so the boot adds no prefix
and a foreign target closes its own tickets. A plan without the line closes nothing. Never a regex
over the body: only that one line is read. At BASE `render_card` in `fleet/sandbox-boot.sh` writes
the card to `<evidence>/.ultrapowers/runs/<N>/pr-body.md` and ends it with the `### Plan` link
`https://github.com/%s/blob/%s/%s` over `$TARGET_REPO`, `$PLAN_BRANCH`, `$PLAN_BLOB_PATH` and, above
it, the `### Evidence` link `https://github.com/%s/tree/%s/%s/` over `$TARGET_REPO`,
`$EVIDENCE_BRANCH`, `$EVIDENCE_PATH`; `publish` posts `$(cat "$body")` as the PR body, so the
body's last line is the file's last non-empty line. Append the `Closes #N` lines after the plan
link, one per line, nothing after them. The plan the boot reads is `$PLAN_FILE`
(`$PLANS_DIR/$RUN_ID.md`), written by `prepare_plan` with `git show "$PLAN_SHA:$PLAN_BLOB_PATH"`;
`plan_title` already reads it. The tag paths in the links are the record another task of this
plan creates at publish (`ultra/plan/run-<N>` at the plan commit, `ultra/evidence/run-<N>` at the
final evidence commit); the link strings are shared literals — this task changes only the two
`printf` lines and the helpers' `PLAN_LINK` and `EVIDENCE_LINK` constants, which
`test_sandbox_boot.mjs`'s "PR body links" test already pins, so both constants and both `printf`
lines change together. In `fleet/tests/_sandbox_boot_helpers.mjs` the `git` stub's `show` case
prints `# $STUB_PLAN_H1`, a blank line and `body` for `*:.ultrapowers/plan.md`; `PLAN_BYTES` pins
those exact bytes for the default run, so add an optional `STUB_PLAN_EXTRA` that the stub prints
(with a trailing newline) after `body` only when set — the exam's plans then read
`# <H1>`, blank, `body`, then whatever `**Goal:**`/`**Closes:**`/`### Task` lines the case needs,
passed through `boot(ctx, ['boot'], { STUB_PLAN_EXTRA: … })`. The exam extends section 1 of
`fleet/tests/test_sandbox_boot.mjs` directly after the test named "the PR body links the evidence
branch and the plan branch", under a comment naming this task; `prPosts(ctx)[0].body` is the
posted body.
**BASE facts:** (generated at e04154b)
- `fleet/sandbox-boot.sh` blob 7cf62ab
- `publish` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:307` blob f06979f
- `PLAN_LINK` at `fleet/tests/_sandbox_boot_helpers.mjs:62` blob 8b5b99d
- `EVIDENCE_LINK` at `fleet/tests/_sandbox_boot_helpers.mjs:61` blob 8b5b99d
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 8b5b99d
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `body` at `fleet/doctor.mjs:412` blob 5e0d5c9
- `PLAN_BYTES` at `fleet/tests/_sandbox_boot_helpers.mjs:89` blob 8b5b99d
- `fleet/tests/test_sandbox_boot.mjs` blob ec8ba1e
- `done` at `fleet/run-worker.mjs:713` blob ae07261

**Proof:**
- Test: `fleet/tests/test_sandbox_boot.mjs`
- Legs: (a) with `STUB_PLAN_EXTRA` carrying a `**Goal:** … #653 #655` line, then a plain prose
  line `see #888 for the decision`, then `**Closes:** #660 #668`, the posted body's last two
  lines are exactly `Closes #660` then `Closes #668`, in that order, and the run ends `done` — a
  body that carries the numbers anywhere but as its last lines, or in the other order, fails;
  and `STUB_PLAN_EXTRA` reaches the boot only as the tail of the `git show` stub's answer for
  `*:.ultrapowers/plan.md`, which `prepare_plan` writes to `$PLAN_FILE`, so a `render_card` that
  reads any source other than that file sees no `**Closes:**` line and fails this leg [M1]; (b)
  the memoized green run, whose plan carries no Closes line, posts a body with no line matching
  `^Closes #` — a body with any such line fails [M2]; (c) the plan of the first leg yields no
  `Closes #653`, no `Closes #655` and no `Closes #888` line — a reader that collects every
  `#<digits>` token after `**Goal:**`, or from the prose, fails; a plan whose only
  `**Closes:** #999` line sits after a `### Task 1: x` heading yields no `Closes #999` line and no
  line beginning `Closes #` at all; and a plan whose `STUB_PLAN_EXTRA` reads `**Closes:** #777`,
  then `**Goal:** x`, then `**Closes:** #660` yields exactly one `Closes` line, `Closes #660`, and
  no `Closes #777` — a reader that takes the first `**Closes:**` line in the file rather than the
  first one after `**Goal:**` fails; and a plan whose `STUB_PLAN_EXTRA` reads `**Goal:** x`, then
  `**Closes:** #660`, then `**Closes:** #661` yields exactly one line beginning `Closes #`,
  `Closes #660`, and no `Closes #661` — a reader that collects every `**Closes:**` line after
  `**Goal:**` rather than exactly the first fails [M1, M3]; (d) the green run's body contains
  `https://github.com/popmechanic/smoke/blob/ultra/plan/run-7/.ultrapowers/plan.md` after its
  `### Plan` heading and
  `https://github.com/popmechanic/smoke/tree/ultra/evidence/run-7/.ultrapowers/runs/7/` after its
  `### Evidence` heading, contains neither `blob/ultra/plan-run-7` nor `tree/ultra/evidence-run-7`,
  and still contains the `| plan | ` row naming `.ultrapowers/plan.md` at the plan sha — a card
  still linking either branch path, or a link under the wrong heading, fails [M4].
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs the whole green-path sim to its sentinel, which includes the BASE
  "PR body links" test against the changed `PLAN_LINK` and `EVIDENCE_LINK` constants [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- issue-closed: #679

### Task 3: No subscription, no run

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`

**Claim:** A sandbox whose `claude auth status` does not show `oauth_token` fails the run before
the engine starts, and the run's record carries the `claude --version` it ran on. (elicited)
Machine: M1. A `claude auth status` whose output contains neither `oauth_token` nor `api_key`
(the stub's `authMethod: none`, and an empty output) ends the run `failed` with an `error`
naming `oauth_token`, with no `systemd-run --unit=fleet-engine-<N>` issued, and with the `failed`
page committed and pushed on the evidence branch. M2. An output containing `api_key` still ends
the run `failed` with an `error` naming `api_key` and no engine started, as at BASE. M3. On a boot
that reaches the engine, `claude --version` is run once, before the engine unit is started, and
its output is the file `.ultrapowers/runs/<N>/claude-version.txt` in the evidence worktree's run
directory when the run ends `done`, staged with the run's last evidence commit. M4. The boot log
carries the line `claude auth status: authMethod: oauth_token` on the green path and a line
beginning `claude version: ` with that output.

**Authorized-by:** #384 (the 2026-09-05 comment: "make a non-`oauth_token` mode fail the run before the engine starts, and add `claude --version` to the receipt")

**Interfaces:**
- Consumes: none
- Produces: `log_auth_status()`

**Context:** `--bare` refuses `CLAUDE_CODE_OAUTH_TOKEN` on both 2.1.238 and 2.1.250 and the
docs say bare will become the `-p` default in a future release; the fleet rides the subscription
token, and the non-bare flag set lives in `buildArgs` in `fleet/run-worker.mjs` (untouched here).
Today's check is the one CLAUDE.md names: on the sandbox `claude auth status` has to show
`oauth_token` behind the `claude-max` proxy (the placeholder `CLAUDE_CODE_OAUTH_TOKEN`); a run
showing `x-api-key` is billing somewhere else. At BASE `log_auth_status()` in
`fleet/sandbox-boot.sh` runs `claude auth status` under `ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL
CLAUDE_CODE_OAUTH_TOKEN=placeholder`, logs the output on one line, fails on `*api_key*`, and on
no `oauth_token` logs `no oauth_token line (claude may not be installed) — continuing`; it is
called from `run_engine` after the `running` page has been committed and pushed and before the
`systemd-run … --unit=fleet-engine-<N>` call, so a `fail` there commits and pushes a `failed`
page (`commitStates` ends `failed`, `engineRuns` is 0). Keep that position; turn the continuing
branch into `fail "claude auth status shows no oauth_token — …"`. Run `claude --version` (same
env prefix) beside it, log it as `claude version: <output>`, and write the output to a file the
evidence collects: `collect_evidence` copies named files from the run directory and
`$STATUS_FILE`; the simplest shape is to write the version into `$FLEET_HOME/claude-version.txt`
in `log_auth_status` and have `collect_evidence` copy it to `$dest/claude-version.txt` when
present, so every later transition (`publishing`, `done`, `parked`, `failed`) carries it. The
evidence file list in `fleet/CONTRACT.md` is another task's to extend with this name; the
harvester's six-file list is not extended (this file is a receipt, not learning input). In
`fleet/tests/_sandbox_boot_helpers.mjs` the `claude` stub prints
`authMethod: ${STUB_AUTH:-oauth_token}` and `apiProvider: firstParty` for any argv; extend it so
`claude --version` prints `${STUB_CLAUDE_VERSION:-2.1.250 (Claude Code)}` and an empty
`STUB_AUTH` (set but empty) makes `auth status` print nothing. The exam extends section 5
(`// ── 5. refusals`) of `fleet/tests/test_sandbox_boot_edges.mjs` directly after the test
named "an api_key auth status stops the run before the engine spends a credit", under a comment
naming this task; another task of this plan extends section 9 of the same file, so add nothing
at the end of the file. `test_sandbox_boot.mjs` already pins the boot-log line
`claude auth status: authMethod: oauth_token` and that the `CALL claude auth status` line precedes
`CALL systemd-run engine`; both stay true.
**BASE facts:** (generated at e04154b)
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea
- `error` at `evals/ab_runner.py:65` blob 7877c9d
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `buildArgs` at `fleet/run-worker.mjs:256` blob ae07261
- `fleet/run-worker.mjs` blob ae07261
- `fleet/sandbox-boot.sh` blob 7cf62ab
- `running` at `fleet/tests/test_sandbox_boot_merge.mjs:137` blob bed2fad
- `fail` at `fleet/run-main.mjs:482` blob 8dcde61
- `commitStates` at `fleet/tests/_sandbox_boot_helpers.mjs:392` blob 8b5b99d
- `engineRuns` at `fleet/tests/_sandbox_boot_helpers.mjs:394` blob 8b5b99d
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `fleet/CONTRACT.md` blob a91fa2b
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 8b5b99d
- `claude` at `fleet/tests/test_doctor.mjs:292` blob 130b27c
- `fleet/tests/test_sandbox_boot_edges.mjs` blob 04ae4ee
- `boot` at `fleet/tests/_sandbox_boot_helpers.mjs:338` blob 8b5b99d
- `isEvidencePush` at `fleet/tests/_sandbox_boot_helpers.mjs:419` blob 8b5b99d
- `addArguments` at `fleet/tests/_sandbox_boot_helpers.mjs:424` blob 8b5b99d

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`
- Legs: (a) `boot` with `STUB_AUTH: 'none'` exits non-zero, `statusOf(ctx).state` is `failed`,
  `statusOf(ctx).error` matches `/oauth_token/`, `engineRuns(ctx)` is 0, `commitStates(ctx)`
  ends with `failed`, and in `gitLog(ctx)` the index of the last `isEvidencePush` call is greater
  than the index of the last `-C <evidence> commit` call — the `failed` page was committed and
  then pushed, so a script that fails without pushing, or pushes before the `failed` commit,
  fails this leg; and `boot` with `STUB_AUTH: ''` (empty output) fails the same way, with
  `engineRuns(ctx)` 0 and the same push-after-commit ordering — a script that logs and continues
  on a missing `oauth_token` starts the engine and fails this leg [M1]; (b) `boot` with
  `STUB_AUTH: 'api_key'` still fails with an `error` matching `/api_key/`, `engineRuns(ctx)` 0
  and `commitStates(ctx)` ending `failed` [M2]; (c) in the memoized green run the `claude` argv
  log carries exactly one `--version` call, its `CALL claude --version` line precedes
  `CALL systemd-run engine` in the boot stream,
  `<evidence>/.ultrapowers/runs/7/claude-version.txt` exists with content matching
  `/^2\.1\.250/`, and the last `-C <evidence> add` call in `gitLog(ctx)` carries the path
  `.ultrapowers/runs/7` (the run directory that file is under) or a path ending in
  `.ultrapowers/runs/7/claude-version.txt` — `addArguments` of that last add contains one of the
  two — and that add's index is less than the index of the last `-C <evidence> commit`, which is
  less than the index of the last `isEvidencePush` call — a version run after the engine, a file
  the evidence never collected, or a last add whose path scope (`status.json` alone, say) does
  not cover the file, fails [M3];
  (d) the green run's boot log contains `claude auth status: authMethod: oauth_token` and a line
  matching `/^claude version: 2\.1\.250/` [M4].
- Run: node fleet/tests/test_sandbox_boot_edges.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The two previous bullets run the extended edges sim and the green-path sim to their sentinel;
  the green-path sim's BASE assertion that `CALL claude auth status` precedes
  `CALL systemd-run engine` stays part of it [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- issue-closed: #384

### Task 4: The record is two tags

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_record.mjs`

**Claim:** At publish the sandbox tags the plan commit `ultra/plan/run-N` and the evidence head
`ultra/evidence/run-N`, then deletes both branches in the same step. (elicited)
Machine: M1. After the run's last evidence push in a `done` outcome and in both `parked`
outcomes (a draft PR, and nothing ahead of base), the script pushes
`<plan sha>:refs/tags/ultra/plan/run-<N>` from the target clone and
`HEAD:refs/tags/ultra/evidence/run-<N>` from the evidence worktree. M2. It then runs one
`git -C <target clone> ls-remote --tags origin refs/tags/ultra/plan/run-<N> refs/tags/ultra/evidence/run-<N>`
and only when that listing shows `ultra/plan/run-<N>` at the plan sha and `ultra/evidence/run-<N>`
at the evidence worktree's `HEAD` does it push one deletion of both
`refs/heads/ultra/plan-run-<N>` and `refs/heads/ultra/evidence-run-<N>`, after the listing; no
command ever names `ultra/integration-run-<N>` for deletion. M3. A listing that omits a tag, a
listing that shows the plan tag at a sha other than the plan sha, and a listing that shows the
evidence tag at a sha other than the evidence worktree's `HEAD`, each leave both branches
undeleted, log one line beginning `record:` that contains `kept`, and change neither the run's
final state nor its exit code. M4. A run that ends `failed` (engine exit non-zero) pushes no tag and deletes no
branch. M5. The states sequence, the evidence commit sequence, the PR POST and the one
notification of the green path are unchanged from BASE, and the first tag push comes after the
last evidence push.

**Authorized-by:** #624 (the 2026-09-05 comment "Decided 2026-09-05 (operator, AskUserQuestion): option (c), tags, and the branches are transient")

**Interfaces:**
- Consumes: none
- Produces: `record_tags()`

**Context:** Decided 2026-09-05 on #624: option (c), tags, and the branches are transient — the
integration branch already goes with the merge (delete-on-merge is on for both repos; when
`--hold` leaves the PR open the integration branch stays, and a parked draft's head stays), the
launcher reads tags for N, the harvester reads by tag, and a one-time sweep does the same for the
runs already on a target; each of those is another task of this plan, so this task does only the
sandbox's half and the tag names are shared literals: `ultra/plan/run-<N>` at the plan commit
(`$PLAN_SHA`, the tip of `ultra/plan-run-<N>` the assignment signed) and `ultra/evidence/run-<N>`
at the evidence worktree's `HEAD` after the last `push_evidence` — that last commit is the one
carrying the `done`/`parked` page, so the tag is placed after it, never before. How the boot
pushes today, and the shape this reuses: `push_evidence` runs `fleet_git -C "$EVIDENCE_DIR" push
origin "HEAD:refs/heads/$EVIDENCE_BRANCH"` (a refspec push from the detached worktree) and
`publish` runs `fleet_git -C "$TARGET_DIR" push origin "$BRANCH"`; both go to `origin`, which
`clone_target` points at `https://github.int.exe.xyz/<owner>/<repo>.git` whichever host answered
the clone, so the target's one `--act-as-user` integration authorizes every push and there is no
other credential to reach for. A lightweight tag needs no local tag object: a refspec push
`<sha>:refs/tags/<name>` creates it on the remote, and the worktree shares the clone's object
store, so `HEAD:refs/tags/…` from `$EVIDENCE_DIR` works the same way. Verify with `ls-remote`
against the remote and never `cat-file -e` or `fetch <sha>` — git satisfies a local want without
asking the server, so only the remote's own listing is a presence proof. Delete both branches in
one `push origin --delete <ref> <ref>`. Where: the three terminal paths in `do_boot` — after the
`push_evidence "$RUN_ID: parked — nothing ahead of base"` and before that path's `exit 0`, and
after the final `push_evidence "$RUN_ID: $outcome — $PR_URL"` — call the new function; the
`failed` paths (`fail`, and the engine-exit branch that pushes `$RUN_ID: failed (engine exit …)`)
do not, so a failed run's branches stay for the sweep. A tag that does not verify must not flip a
`done` run to `failed`: the record exists on the branches still, the sweep will retry it, so the
function logs `record: … kept for the sweep` and returns 0. In
`fleet/tests/_sandbox_boot_helpers.mjs` the `git` stub answers `rev-parse <anything but
FETCH_HEAD>` with `$STUB_HEAD_SHA` (so the evidence worktree's `HEAD` reads as `HEAD_SHA`,
`d4`×20) and `push` with exit 0 (except the evidence-branch push under `STUB_EVIDENCE_PUSH_FAIL`,
whose case pattern `*evidence-run-7*` would also match the deletion push — that run fails at its
first evidence push and never reaches the deletion, so nothing changes there); it has no
`ls-remote` case, so add one in its own `case` arm: when `$*` contains `--tags`, print
`${STUB_TAG_PLAN_SHA:-$STUB_PLAN_SHA}<tab>refs/tags/ultra/plan/run-7` and
`${STUB_TAG_EVIDENCE_SHA:-$STUB_HEAD_SHA}<tab>refs/tags/ultra/evidence/run-7`, and print nothing
when `STUB_TAGS_MISSING` is set. Another task of this plan edits the same stub's `show` arm and a
third its `systemd-run` and `claude` stubs; touch only the `git` stub's new arm. The exam is a
new sim named for this surface, `fleet/tests/test_sandbox_boot_record.mjs`, built on the rig
(`makeHome`, `boot`, `green`, `gitLog`, `verbOf`, `dirOf`, `states`, `commitStates`, `prPosts`,
`notifies`, `statusOf`, `stream`, `indexOf`, `lastIndexOf`, `isEvidencePush`, `runTests`); it
must print `ALL TESTS PASSED` and open no socket. The helpers export `OTHER_SHA` (`e5`×20) for the
wrong-sha row and `PLAN_SHA`, `HEAD_SHA` for the right ones.
**BASE facts:** (generated at e04154b)
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `kept` at `fleet/tests/test_sandbox_boot_merge.mjs:124` blob bed2fad
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea
- `publish` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:307` blob f06979f
- `origin` at `fleet/tests/_lobby_helpers.mjs:137` blob 86c4674
- `fail` at `fleet/run-main.mjs:482` blob 8dcde61
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 8b5b99d
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `push` at `fleet/launch.mjs:403` blob a2bcd04
- `claude` at `fleet/tests/test_doctor.mjs:292` blob 130b27c
- `makeHome` at `fleet/tests/_sandbox_boot_helpers.mjs:318` blob 8b5b99d
- `boot` at `fleet/tests/_sandbox_boot_helpers.mjs:338` blob 8b5b99d
- `green` at `fleet/tests/_sandbox_boot_helpers.mjs:472` blob 8b5b99d
- `gitLog` at `fleet/tests/_sandbox_boot_helpers.mjs:415` blob 8b5b99d
- `verbOf` at `fleet/tests/_sandbox_boot_helpers.mjs:412` blob 8b5b99d
- `dirOf` at `fleet/tests/_sandbox_boot_helpers.mjs:414` blob 8b5b99d
- `states` at `fleet/tests/_sandbox_boot_helpers.mjs:375` blob 8b5b99d
- `commitStates` at `fleet/tests/_sandbox_boot_helpers.mjs:392` blob 8b5b99d
- `prPosts` at `fleet/tests/_sandbox_boot_helpers.mjs:397` blob 8b5b99d
- `notifies` at `fleet/tests/_sandbox_boot_helpers.mjs:389` blob 8b5b99d
- `statusOf` at `fleet/tests/_sandbox_boot_helpers.mjs:374` blob 8b5b99d
- `stream` at `fleet/tests/_sandbox_boot_helpers.mjs:373` blob 8b5b99d
- `indexOf` at `fleet/tests/_sandbox_boot_helpers.mjs:383` blob 8b5b99d
- `lastIndexOf` at `fleet/tests/_sandbox_boot_helpers.mjs:384` blob 8b5b99d
- `isEvidencePush` at `fleet/tests/_sandbox_boot_helpers.mjs:419` blob 8b5b99d
- `runTests` at `fleet/tests/_sandbox_boot_helpers.mjs:488` blob 8b5b99d
- `OTHER_SHA` at `fleet/tests/_sandbox_boot_helpers.mjs:43` blob 8b5b99d
- `PLAN_SHA` at `fleet/tests/_sandbox_boot_helpers.mjs:35` blob 8b5b99d
- `HEAD_SHA` at `fleet/tests/_sandbox_boot_helpers.mjs:41` blob 8b5b99d
- `pr` at `fleet/tests/test_sandbox_boot.mjs:294` blob ec8ba1e
- `PR_URL` at `fleet/tests/_sandbox_boot_helpers.mjs:46` blob 8b5b99d
- `evidenceDisciplineProblem` at `fleet/tests/_sandbox_boot_helpers.mjs:439` blob 8b5b99d
- `fleet/sandbox-boot.sh` blob 7cf62ab

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_record.mjs`
- Legs: (a) in the memoized green run the git argv log contains
  `git -C <home>/target push origin <PLAN_SHA>:refs/tags/ultra/plan/run-7` and
  `git -C <home>/evidence push origin HEAD:refs/tags/ultra/evidence/run-7`, and a run booted with
  `STUB_VERDICT: 'NEEDS_ACK'` (draft PR, `parked`) and one with `STUB_VERDICT: 'NEEDS_ACK',
  STUB_NO_COMMITS: '1'` (nothing ahead, `parked`) each contain both tag pushes too, and in each
  of those two parked runs the log also contains exactly one `ls-remote --tags` call naming both
  tags and exactly one `push origin --delete refs/heads/ultra/plan-run-7
  refs/heads/ultra/evidence-run-7`, the deletion's index greater than the listing's, and the
  index of the first git call whose argv includes `refs/tags/ultra/plan/run-7` greater than the
  index of the last `isEvidencePush` call, and no git call in either parked run carries both
  `--delete` and `ultra/integration-run-7` (the draft PR's head, and the head nothing was pushed
  to, both stay) — a script that tags but never lists or deletes on a parked path, tags before
  the parked page is pushed, or deletes the integration branch on a parked path, fails
  [M1, M2, M5]; (b) the green run's log contains exactly one
  `git -C <home>/target ls-remote --tags origin refs/tags/ultra/plan/run-7 refs/tags/ultra/evidence/run-7`
  and exactly one `git -C <home>/target push origin --delete refs/heads/ultra/plan-run-7
  refs/heads/ultra/evidence-run-7`, the deletion's index is greater than the listing's, and no
  git call carries both `--delete` and `ultra/integration-run-7` [M2]; (c) a run booted with
  `STUB_TAGS_MISSING: '1'`, a run booted with `STUB_TAG_PLAN_SHA: OTHER_SHA` (the plan tag listed
  at a sha that is not `PLAN_SHA`), and a run booted with `STUB_TAG_EVIDENCE_SHA: OTHER_SHA` (the
  evidence tag listed at a sha that is not `HEAD_SHA`) each exit 0, end `done` with `pr` equal to
  `PR_URL`, contain no git call carrying `--delete`, and log one line matching
  `/^record: .*kept/` — a script that deletes without the listing agreeing on both tags, that
  checks only the evidence tag's sha, or that fails the run over it, fails this leg [M2, M3]; (d) a run booted with `STUB_ENGINE_CODE: '2'`
  contains no git call whose argv includes `refs/tags/` and none carrying `--delete` [M4]; (e)
  the green run's `states(ctx)` is exactly `['booting', 'running', 'publishing', 'done']`,
  `commitStates(ctx)` is exactly `['running', 'publishing', 'done']`, `prPosts(ctx).length` is 1,
  `notifies(ctx)` is exactly the one `run-7 done` notification, and the index of the first git
  call whose argv includes `refs/tags/ultra/plan/run-7` is greater than the index of the last
  `isEvidencePush` call [M5].
- Run: node fleet/tests/test_sandbox_boot_record.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The two previous bullets run the new sim and the green-path sim to their sentinel; the
  green-path sim pins the BASE evidence discipline (`evidenceDisciplineProblem`), the integration
  push shape and the one notification, which the tag step must leave standing [M5].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-exists: `fleet/tests/test_sandbox_boot_record.mjs`
- issue-closed: #624

### Task 5: The lobby reads tags

**Type:** implementation

**Files:**
- Modify: `fleet/lobby.mjs`
- Test: `fleet/tests/test_lobby.mjs`

**Claim:** The launcher reads tags for N (`lobby.mjs` `RUN_BRANCH`/`highestRunOnTarget`).
(elicited)
Machine: M1. `planTagFor(7)` is exactly `ultra/plan/run-7` and `evidenceTagFor(7)` is exactly
`ultra/evidence/run-7`, for a run spelled as a number or a string. M2. `runOfBranch` answers 7
for each of `ultra/plan/run-7`, `ultra/evidence/run-7`, `refs/tags/ultra/plan/run-7`,
`refs/tags/ultra/evidence/run-7`, and still for `ultra/plan-run-7`, `ultra/integration-run-7`,
`ultra/evidence-run-7` and `refs/heads/ultra/evidence-run-7`; it answers null for `main`,
`ultra/plan-run-x`, `ultra/plan/run-x`, `ultra/integration/run-7` and
`refs/tags/ultra/plan/run-7^{}`. M3. `highestRunOnTarget(exec, dir)` issues exactly one git
call, `git -C <dir> ls-remote origin refs/heads/ultra/* refs/tags/ultra/*`, and answers the
highest run over both patterns: a listing of tags only answers their maximum, a listing of tags
and branches answers the highest of either, an empty listing answers 0, and a non-zero exit is a
`Refusal`. M4. `planBranchFor`, `integrationBranchFor` and `evidenceBranchFor` answer exactly
what they answer at BASE.

**Authorized-by:** #624 (decision c, 2026-09-05: "The launcher reads tags for N (`lobby.mjs` `RUN_BRANCH`/`highestRunOnTarget`)")

**Interfaces:**
- Consumes: none
- Produces: `planTagFor(run) -> string`
- Produces: `evidenceTagFor(run) -> string`
- Produces: `runOfBranch(ref) -> number | null`
- Produces: `highestRunOnTarget(exec, repoDir) -> Promise<number>`

**Context:** Decided 2026-09-05 on #624: option (c) — a run's record is two tags on the
target, `ultra/plan/run-<N>` at the plan commit and `ultra/evidence/run-<N>` at the evidence
head, and the three branches are transient (the sandbox deletes the plan and evidence branches
at publish; delete-on-merge drops the integration branch). `highestRunOnTarget` is what
`fleet/launch.mjs` uses for `N = 1 + max`, so once a target's branches are gone it must see the
tags or the next launch would reuse a number. At BASE `RUN_BRANCH` in `fleet/lobby.mjs` is
`/^(?:refs\/heads\/)?ultra\/(?:plan|integration|evidence)-run-([1-9][0-9]*)$/` and
`highestRunOnTarget` runs `git(exec, repoDir, ['ls-remote', 'origin', 'refs/heads/ultra/*'])`
and reads the ref half of each `<sha>\t<ref>` line through `runOfBranch`. Keep the name
`runOfBranch` (nothing else needs a second name) and widen its regex to the two tag shapes,
with or without a `refs/tags/` head; there is no integration tag. `git ls-remote` accepts several
patterns in one call, so keep `refs/heads/ultra/*` as its own argv element and add
`refs/tags/ultra/*` as another — `fleet/tests/test_launch_reaps.mjs` finds the run-number read by
`argv.includes('refs/heads/ultra/*')` and `fleet/tests/test_launch.mjs` runs the real `git` against
a bare origin, so both stay green with that shape. The tags this plan creates are lightweight
(a refspec push of a sha), so the listing carries no peeled `^{}` line; an annotated tag would,
and its `^{}` line must answer null rather than a number. `fleet/tests/test_lobby.mjs` block
`(b)` at BASE pins the exact BASE argv with `deepEqual` and its `(a1)–(a3)` blocks pin the three
branch names and `runOfBranch`; this task owns that file: change the `(b)` argv pin to the
two-pattern argv and add this task's legs under a comment naming it, keeping every BASE
assertion that is still true. The file imports `lobby.mjs` as a namespace (`L`) and reads its
export names in block `(e)`.
**BASE facts:** (generated at e04154b)
- `RUN_BRANCH` at `fleet/lobby.mjs:118` blob 2f6289f
- `highestRunOnTarget` at `fleet/lobby.mjs:467` blob 2f6289f
- `runOfBranch` at `fleet/lobby.mjs:125` blob 2f6289f
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `Refusal` at `fleet/lobby.mjs:261` blob 2f6289f
- `planBranchFor` at `fleet/lobby.mjs:113` blob 2f6289f
- `integrationBranchFor` at `fleet/lobby.mjs:114` blob 2f6289f
- `evidenceBranchFor` at `fleet/lobby.mjs:115` blob 2f6289f
- `fleet/launch.mjs` blob a2bcd04
- `fleet/lobby.mjs` blob 2f6289f
- `fleet/tests/test_launch_reaps.mjs` blob 1031e90
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `fleet/tests/test_lobby.mjs` blob ee06669

**Proof:**
- Test: `fleet/tests/test_lobby.mjs`
- Legs: (a) `L.planTagFor(7)` and `L.planTagFor('7')` each equal `ultra/plan/run-7`, and
  `L.evidenceTagFor(7)` and `L.evidenceTagFor('7')` each equal `ultra/evidence/run-7`, one
  assertion each — a speller that stringifies a number differently from a string fails [M1]; (b) `L.runOfBranch` answers 7 for
  `ultra/plan/run-7`, for `ultra/evidence/run-7`, for `refs/tags/ultra/plan/run-7` and for
  `refs/tags/ultra/evidence/run-7`, one assertion each — a regex that still reads only the
  branch shapes answers null here and fails [M2]; (c) `L.runOfBranch` still answers 7 for
  `ultra/plan-run-7`, for `ultra/integration-run-7`, for `ultra/evidence-run-7` and for
  `refs/heads/ultra/evidence-run-7`, one assertion each [M2]; (d) `L.runOfBranch` answers null
  for `main`, for `ultra/plan-run-x`, for `ultra/plan/run-x`, for `ultra/integration/run-7` and
  for `refs/tags/ultra/plan/run-7^{}`, one assertion each — a regex that guesses a number from a
  peeled line or an integration tag fails [M2]; (e) with a recording seam answering a canned
  listing, `L.highestRunOnTarget(exec, '/tmp/target-clone')`
  makes exactly one call whose argv is exactly
  `['-C', '/tmp/target-clone', 'ls-remote', 'origin', 'refs/heads/ultra/*', 'refs/tags/ultra/*']`;
  a listing of `refs/tags/ultra/plan/run-18` and `refs/tags/ultra/evidence/run-18` answers 18; a
  listing of `refs/tags/ultra/evidence/run-18` and `refs/heads/ultra/plan-run-19` answers 19; a
  listing of `refs/heads/ultra/evidence-run-20` and `refs/tags/ultra/plan/run-3` answers 20; an
  empty listing answers 0; and a seam answering exit 128 makes it throw an `L.Refusal` [M3]; (f)
  `L.planBranchFor(7)`, `L.integrationBranchFor(7)` and `L.evidenceBranchFor(7)` equal
  `ultra/plan-run-7`, `ultra/integration-run-7` and `ultra/evidence-run-7` [M4].
- Run: node fleet/tests/test_lobby.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- The two previous bullets run the lobby sim and the launch-reaps sim to their sentinel; the
  latter finds the run-number read by its `refs/heads/ultra/*` element, so it passes only when
  that element survives beside the new one [M3].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`
- issue-closed: #624

### Task 6: The harvester reads the tag

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Test: `tests/test_harvest_fleet_runs.py`

**Claim:** the harvester reads by tag. (elicited)
Machine: M1. `evidence_tag(7)` and `evidence_tag('run-7')` are exactly `ultra/evidence/run-7`,
and `evidence_branch(7)` is still `ultra/evidence-run-7`. M2. `fetch_evidence` reads each of the
six evidence files at `?ref=ultra/evidence-run-<N>`; when a read answers absent before any file
has landed and the tag has not yet been tried, the same file is read once at
`?ref=ultra/evidence/run-<N>`, and if that read lands, every later file is read at the tag ref.
M3. A run whose branch is gone and whose tag holds all six files lands all six and bundles, with
exactly seven `gh api` calls: one at the branch ref, then six at the tag ref. M4. A run present
on the branch is read exactly as at BASE: six `gh api` calls, all at the branch ref, none at the
tag ref. M5. A run present on neither ref is a `FAILED-LOOKUP:` line naming the target, the run,
`ultra/evidence-run-<N>` and `ultra/evidence/run-<N>`, and `--help` names the tag.

**Authorized-by:** #624 (decision c, 2026-09-05: "the harvester reads by tag")

**Interfaces:**
- Consumes: none
- Produces: `evidence_tag(run) -> str`
- Produces: `fetch_evidence(target, run, dest) -> Path`

**Context:** Decided 2026-09-05 on #624: a run's record is the two tags `ultra/plan/run-<N>` and
`ultra/evidence/run-<N>`, the plan and evidence branches are deleted at publish by the sandbox,
and the runs already on a target are swept into tags by a one-time tool; while that sweep is
pending a run's record is still on `ultra/evidence-run-<N>`. GitHub's contents API resolves
`?ref=` to a branch or a tag alike, so reading by tag is only a different `ref` value on the same
path. At BASE `evidence_branch(run)` returns `ultra/evidence-run-<N>`, `_evidence_api_path(target,
run, name)` builds `repos/<target>/contents/.ultrapowers/runs/<N>/<name>?ref=<branch>`, and
`fetch_evidence` loops `EVIDENCE_FILES` calling `_gh_api`, which answers `None` on a non-zero
`gh` (an `HTTP 404` is an answer) — keep those names and give `_evidence_api_path` the ref as a
parameter. Why the branch is probed first and the tag second: `tests/test_harvest_evidence.py`
(outside this task's Files, and not to be edited) pins that a run on the branch is read with
exactly six `gh api` calls at `?ref=ultra/evidence-run-7`, including the case where two of the six
files are absent on the branch — so the tag may be tried only before anything has landed, once,
and never per missing file; the result set is the same either way (the branch while the sweep is
pending, the tag after it), and a swept run costs one extra `404`. A run on neither ref keeps the
BASE `FailedLookup` shape ("nothing readable"), naming both refs. The argparse help for
`--evidence` says `ultra/evidence-run-<N> branch`; make it name the tag as well. The exam extends
`tests/test_harvest_fleet_runs.py` under a comment naming this task and needs a `gh` on `PATH`
the way `tests/test_harvest_evidence.py` builds one — a Python executable named `gh` in a
directory that `monkeypatch.setenv("PATH", …)` makes the whole `PATH`, answering from a JSON map
keyed by the `repos/…` argv (a missing key is `gh: HTTP 404` on stderr and exit 1) and appending
each argv as a JSON line to a log file; restate that stub in this file rather than importing the
other exam. Pass `--engine-version 0.3.0` on every `main` call so nothing shells out to `git`
for a release timeline; six answers keyed by the tag ref, none by the branch ref, is the swept
run; the same six keyed by the branch ref is the BASE run.
**BASE facts:** (generated at e04154b)
- `fetch_evidence` at `skills/ultralearn/scripts/harvest_fleet_runs.py:134` blob eb03112
- `ref` at `fleet/lobby.mjs:475` blob 2f6289f
- `_gh_api` at `skills/ultralearn/scripts/harvest_fleet_runs.py:105` blob eb03112
- `_evidence_api_path` at `skills/ultralearn/scripts/harvest_fleet_runs.py:100` blob eb03112
- `tests/test_harvest_evidence.py` blob 1224371
- `FailedLookup` at `skills/ultralearn/scripts/_outcome.py:25` blob b3c8566
- `tests/test_harvest_fleet_runs.py` blob b446ff7
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `skills/ultralearn/scripts/harvest_fleet_runs.py` blob eb03112

**Proof:**
- Test: `tests/test_harvest_fleet_runs.py`
- Legs: (a) `hfr.evidence_tag(7)` and `hfr.evidence_tag("run-7")` equal `ultra/evidence/run-7`
  and `hfr.evidence_branch(7)` equals `ultra/evidence-run-7` [M1]; (b) with the stub answering
  all six files only at `?ref=ultra/evidence/run-7`, `main(["--evidence", "popmechanic/smoke",
  "--run", "7", "--cache", <tmp>, "--engine-version", "0.3.0"])` exits 0, writes
  `<cache>/runs/run-7/bundle.json` with `terminus` from the fetched gate receipt, and the stub's
  argv log holds exactly seven `api` calls: the first at
  `…/status.json?ref=ultra/evidence-run-7` and the other six at `?ref=ultra/evidence/run-7`, one
  per evidence file — a harvester that tries the tag per missing file, or never, fails this leg
  [M2, M3]; (c) with the stub answering all six at `?ref=ultra/evidence-run-7`, the same `main`
  exits 0 and the log holds exactly six `api` calls, all at the branch ref and none containing
  `ultra/evidence/run-7` — a harvester that probes the tag when the branch already answered
  fails [M2, M4]; (d) with the stub answering nothing, the same `main` exits 2, the
  stderr carries exactly one `FAILED-LOOKUP:` line containing `popmechanic/smoke`, `7`,
  `ultra/evidence-run-7` and `ultra/evidence/run-7`, `<cache>/runs` does not exist, and the
  log holds exactly seven `api` calls of which exactly one contains `ultra/evidence/run-7` — the
  `status.json` read at the tag ref, issued second, directly after the `status.json` read at the
  branch ref — and the other six are the six files at the branch ref in `EVIDENCE_FILES` order:
  a harvester that re-probes the tag for every remaining file after the one tag miss, or that
  never tries it, fails this leg [M2, M5];
  (e) with the stub answering `status.json`, `gate-receipt.json`, `report.json` and
  `events.jsonl` at `?ref=ultra/evidence-run-7` (so the first read lands and `receipt.json` and
  `engine.log` are absent on the branch) and all six files at `?ref=ultra/evidence/run-7`, the
  same `main` exits 0, writes the bundle, and the log holds exactly six `api` calls, all at the
  branch ref and none containing `ultra/evidence/run-7` — a harvester that falls back to the tag
  on an absent read after a file has already landed fails this leg, because the tag would have
  answered [M2].
- Run: python3 skills/ultralearn/scripts/harvest_fleet_runs.py --help | grep -q 'ultra/evidence/run-'
- The previous bullet is the leg for the help text naming the tag [M5].
- Run: python3 -m pytest tests/test_harvest_fleet_runs.py tests/test_harvest_evidence.py -q
- The previous bullet runs this task's exam and the BASE evidence exam together; the latter's
  six-call pins are what M4 promises [M4].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- path-absent: `tests/test_harvest_evidence.py`
- issue-closed: #624

### Task 7: `fleet/retire.mjs`, the one-time sweep

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/retire.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_retire.mjs`

**Claim:** `node fleet/retire.mjs --target owner/repo` turns every plan-and-evidence branch pair
on the target into the two tags, verified with `git ls-remote --tags` against the remote, then
deletes the pair, highest N last, one line per run, and `--dry-run` only says what it would do.
(elicited)
Machine: M1. `retire({ argv, exec })` refuses (a `Refusal`, exit 2, no `gh` call) without
`--target` or with a `--target` that `isSafeTarget` rejects, and `--dry-run` is a valueless
flag. M2. It lists the target with exactly one
`git ls-remote https://github.com/<owner>/<repo>.git refs/heads/ultra/* refs/tags/ultra/*`; a run N
is a candidate when both `refs/heads/ultra/plan-run-N` and `refs/heads/ultra/evidence-run-N` are
listed, candidates are processed in ascending N, and a lone branch of the pair prints one line
containing `skip` and is neither tagged nor deleted. M3. Per candidate, in this order: `gh api -X
POST repos/<owner>/<repo>/git/refs -f ref=refs/tags/ultra/plan/run-N -f sha=<plan branch head>`,
the same for `refs/tags/ultra/evidence/run-N` at the evidence branch head (a POST answering that
the reference already exists is not a failure), then one `git ls-remote --tags
https://github.com/<owner>/<repo>.git refs/tags/ultra/plan/run-N refs/tags/ultra/evidence/run-N`,
and only when that listing shows both tags at those two heads, `gh api -X DELETE
repos/<owner>/<repo>/git/refs/heads/ultra/plan-run-N` and `gh api -X DELETE
repos/<owner>/<repo>/git/refs/heads/ultra/evidence-run-N`; no command ever names
`refs/heads/ultra/integration-run-N`. M4. A listing that omits a tag or shows it at another sha
issues no DELETE for that N, prints one line containing `kept`, continues with the next N, and
the process exit code is 1 when any run was kept. M5. For each candidate it reads `gh api
repos/<owner>/<repo>/pulls?state=closed&head=<owner>:ultra/integration-run-N` and, for every PR
answered whose body contains `/blob/ultra/plan-run-N/` or `/tree/ultra/evidence-run-N/`, issues
`gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -f body=<body>` with those substrings
rewritten to `/blob/ultra/plan/run-N/` and `/tree/ultra/evidence/run-N/` and nothing else changed;
a PR whose body carries neither is not patched. M6. Under `--dry-run` the listing and the pulls
reads happen, no `gh api` call carries `-X`, and every per-run line contains `would`. M7. Output
is exactly one line per candidate, each beginning `run N:`, in ascending N, so the highest N is
last; `git` and `gh` are reached only through the `exec` seam.

**Authorized-by:** #624 (the 2026-09-05 comment: "A one-time `fleet/retire.mjs` tags runs 1–18 here and 1–7 on the walk repo, verifies each tag with `git ls-remote --tags` against the remote, then deletes the 36 + 14 branches, highest N last")

**Interfaces:**
- Consumes: none
- Produces: `retire({ argv, exec }) -> Promise<{ retired: number[], kept: number[], skipped: string[] }>`

**Context:** Decided 2026-09-05 on #624: tags are the record and the branches are transient;
`popmechanic/ultrapowers` carries 18 `ultra/plan-run-*` + 18 `ultra/evidence-run-*` and
`popmechanic/ultrapowers-walk` 7 + 7 (every integration branch already deleted), and the order
after this plan merges is: a smoke run proves a fresh run leaves two tags and no branch, then this
sweep, then confirm the next N is 19. The tag names are shared literals with the other tasks of
this plan: `ultra/plan/run-<N>` at the plan branch's head (that head is the plan commit the
launcher pushed) and `ultra/evidence/run-<N>` at the evidence branch's head. This tool runs on the
laptop with no clone: `git ls-remote <url>` needs none, and a tag pointing at a sha the remote
already holds is created through GitHub's refs API rather than a push, because `git push
<sha>:refs/tags/…` requires the object locally. Verify against the remote with `ls-remote` and
never `cat-file -e` or `fetch <sha>` — git satisfies a local want without asking the server. The
laptop's `gh` is authenticated as the operator (this is not the edge; nothing here runs on a VM),
and `gh api -f key=value` sends string fields, which is what `git/refs` (`ref`, `sha`) and
`pulls/<n>` (`body`) take. Build on `fleet/lobby.mjs` exactly as `fleet/janitor.mjs` and
`fleet/target.mjs` do: `export async function retire ({ argv = [], exec = defaultExec })`, then
`runCli` at the bottom when run as a script; `parseArgs(argv, { flags: ['dry-run'] })`,
`isSafeTarget`, `Refusal`, `output` and `defaultExec` are BASE exports of `lobby.mjs`; do not
import any name another task of this plan adds to `lobby.mjs` — read the branch pair with a
regex of your own over the `<sha>\t<ref>` lines, and spell the two tag names yourself. The PR
list filter `head=<owner>:<ref>` matches on the head ref's name, which GitHub keeps after the
branch is deleted, so a merged run's PR is found by `ultra/integration-run-N`; a closed-but-
unmerged measurement PR is found the same way and its links are rewritten too, because its body
links the same branches. Every line: `run N: retired ultra/plan/run-N@<7 hex> ultra/evidence/run-N@<7 hex>, 2 branches deleted, <k> PR(s) patched`,
`run N: kept — <why>`, `run N: would …` under `--dry-run`, and `skip — lone <ref>` for a
half pair. The exam is `fleet/tests/test_retire.mjs`, built on `makeExec` from
`fleet/tests/_lobby_helpers.mjs` (`cmdRule`, `answer`, rules matched in order, `exec.calls` and
`exec.line` per call); no rule runs `git` or `gh` for real (pass `passthrough: []`), and the sim
prints `ALL TESTS PASSED`. A `git ls-remote` answer is `<sha>\t<ref>` per line; a `gh api` POST
answer for an existing reference is exit 1 with `Reference already exists` in its output.
**BASE facts:** (generated at e04154b)
- `Refusal` at `fleet/lobby.mjs:261` blob 2f6289f
- `isSafeTarget` at `fleet/lobby.mjs:41` blob 2f6289f
- `kept` at `fleet/tests/test_sandbox_boot_merge.mjs:124` blob bed2fad
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `exec` at `fleet/tests/_lobby_helpers.mjs:85` blob 86c4674
- `ref` at `fleet/lobby.mjs:475` blob 2f6289f
- `sha` at `fleet/launch.mjs:207` blob a2bcd04
- `body` at `fleet/doctor.mjs:412` blob 5e0d5c9
- `fleet/lobby.mjs` blob 2f6289f
- `fleet/janitor.mjs` blob 236dc2f
- `fleet/target.mjs` blob c189a05
- `runCli` at `fleet/lobby.mjs:283` blob 2f6289f
- `output` at `fleet/lobby.mjs:228` blob 2f6289f
- `defaultExec` at `fleet/doctor.mjs:171` blob 5e0d5c9
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `cmdRule` at `fleet/tests/_lobby_helpers.mjs:47` blob 86c4674
- `answer` at `fleet/claude-token.mjs:106` blob 356883f
- `tests/test_docs_agree_with_code.py` blob c9687c7

**Proof:**
- Test: `fleet/tests/test_retire.mjs`
- Legs: (a) `retire({ argv: [], exec })` and `retire({ argv: ['--target', 'bad name'], exec })`
  each throw a `Refusal` whose `exitCode` is 2 with `exec.calls` empty [M1]; (b) a seam whose
  `ls-remote` answers `plan-run-3`, `evidence-run-3`, `plan-run-12`, `evidence-run-12` and a lone
  `evidence-run-5`: the first call is exactly `git ls-remote https://github.com/o/r.git
  refs/heads/ultra/* refs/tags/ultra/*` and it is the only call in `exec.calls` whose argv
  contains `refs/heads/ultra/*` — a tool that lists the heads again per run fails; the printed
  lines are `run 3: …`, `run 5: …`, `run 12: …` in that order with the `run 5:` line containing
  `skip` and no `gh` call naming run 5 [M2, M7];
  (c) for run 3 the `gh` calls are, in order, `api -X POST repos/o/r/git/refs -f
  ref=refs/tags/ultra/plan/run-3 -f sha=<plan-3 head>`, the same for
  `refs/tags/ultra/evidence/run-3` at the evidence-3 head, then a `git ls-remote --tags
  https://github.com/o/r.git refs/tags/ultra/plan/run-3 refs/tags/ultra/evidence/run-3`, then
  `api -X DELETE repos/o/r/git/refs/heads/ultra/plan-run-3` and `api -X DELETE
  repos/o/r/git/refs/heads/ultra/evidence-run-3` after the listing; a POST answering exit 1 with
  `Reference already exists` still reaches the DELETEs; and no call contains
  `ultra/integration-run` together with `DELETE` [M3]; (d) over the seam of the second leg, a
  variant whose tag listing for run 3 omits the evidence tag, and one whose listing for run 3
  shows the evidence tag at another sha, each yield no DELETE naming run 3, a `run 3:` line
  containing `kept`, and — after that line — the run-12 POSTs, listing and both run-12 DELETEs
  still issued and a `run 12:` line containing `retired`, with a resolved result whose `kept` is
  `[3]` and whose `retired` is `[12]` and `process.exitCode` 1 — a tool that halts at the first
  kept run never reaches run 12 and fails this leg [M4]; (e) with the pulls read
  for run 3 answering one PR whose body links `/blob/ultra/plan-run-3/.ultrapowers/plan.md` and
  `/tree/ultra/evidence-run-3/.ultrapowers/runs/3/`, one `api -X PATCH repos/o/r/pulls/<number>
  -f body=<body>` is issued whose body carries `/blob/ultra/plan/run-3/.ultrapowers/plan.md` and
  `/tree/ultra/evidence/run-3/.ultrapowers/runs/3/` and is otherwise byte-identical — a PATCH
  that rewrites any other byte, or that still carries a branch path, fails [M5]; (f) with the
  pulls read for run 12 answering one PR whose body carries neither branch path, no `api -X
  PATCH` names that PR's number [M5]; (g) `--dry-run` over the seam of the second leg issues the
  `ls-remote` and the pulls reads, no `gh` call whose argv includes `-X`, and every `run N:`
  line contains `would` [M6].
- Run: node fleet/tests/test_retire.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs the sim to its sentinel [M7].
- Run: node --check fleet/retire.mjs && grep -q 'node fleet/retire.mjs --target' fleet/RUNBOOK.md
- The previous bullet is the leg for the file parsing and the RUNBOOK naming the verb; the
  script-exists pin in `tests/test_docs_agree_with_code.py` reads that RUNBOOK line against this
  file [M7].

**Stale-if:**
- path-exists: `fleet/retire.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #624

### Task 8: The contract and the runbook say the record is two tags

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `tests/test_docs_agree_with_code.py`

**Claim:** The contract and the runbook say a run's record is the two tags, that the plan and
evidence branches are gone at publish, and how to read a run's state by tag — and the
docs-agree-with-code test holds them to it; and both documents describe the doctor's `capacity`
row as a report of the pool and of the size one run asks, never as a count of runs or a cap on
them. (derived)
Machine: M1. `fleet/CONTRACT.md` §Literals carries a bullet beginning `**The two tags`, and that
bullet, in this order, names `ultra/plan/run-<N>`, then `ultra/evidence/run-<N>`, then the two
branches `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` as the things deleted at publish, and
says that deletion comes after the tags are verified. M2. The contract's `**Run id:**` bullet
says N is 1 + the max over both the `ultra/*-run-<N>` branches and the
`ultra/{plan,evidence}/run-<N>` tags, and its boot-script bullet (`- **Boot script`) carries a
sub-bullet beginning `  - record:` that names both tags and the deletion of the two branches and
sits after the `  - merge:` sub-bullet. M3. `fleet/RUNBOOK.md`'s **Watch.** paragraph (the text
from `**Watch.**` to `**The PR.**`) reads `.ultrapowers/runs/<N>/status.json` at
`?ref=ultra/evidence/run-<N>`, and no `?ref=` in `fleet/RUNBOOK.md` or `fleet/CONTRACT.md` spells
`ultra/evidence-run-`. M4. The contract's evidence bullet still opens with the words
"evidence-run-<N>" followed by "— the run's record", still carries the words "present when the
engine wrote them", and now also names `claude-version.txt`; the boot-script bullet still carries
the words "unless the verdict is PASS or"; the contract's merge sentence and the runbook's Trust
section and "The PR." paragraph that the merge sims pin are unchanged. M5.
`tests/test_docs_agree_with_code.py` gains a test named `test_*two_tags*` that reads the two tag
literals out of the contract's `**The two tags` bullet and fails when either is absent, and a
test named `test_*evidence_tag*` that fails when any `?ref=` in `fleet/RUNBOOK.md` or
`fleet/CONTRACT.md` names `ultra/evidence-run-`; the whole file passes on this tree, and each of
the two tests fails on a tree where its literal has been edited back. M6. The doctor's capacity
row is described the same way in both documents: the runbook's setup row 2 says the pool (the
"billing plan --json" answer) and the size one run asks (the fleet.json cpu and memory) are what
the row reports; the runbook's "## Capacity" section says the capacity doctor row reports the
pool beside one run's cpu; the contract's doctor table capacity row says green is the pool and
the run's size both read and reported; and the phrases "cannot hold", "how many fit" and "how
many runs" occur in neither `fleet/RUNBOOK.md` nor `fleet/CONTRACT.md`.

**Authorized-by:** #624 (decision c, 2026-09-05); the plan-level Claim above

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Decided 2026-09-05 on #624: option (c) — at publish the sandbox tags the plan commit
`ultra/plan/run-<N>` and the evidence head `ultra/evidence/run-<N>`, verifies both with `git
ls-remote --tags` against the remote, then deletes `ultra/plan-run-<N>` and `ultra/evidence-run-<N>`
in the same step; the integration branch goes with the merge (delete-on-merge), and when `--hold`
leaves the PR open its integration branch stays; the launcher reads tags for N; the harvester
reads by tag; a one-time `fleet/retire.mjs` sweeps the runs already on a target. The sandbox's
tag-and-delete runs after the last evidence push of a `done` or `parked` run; a run that ends
`failed` keeps its branches for the sweep; a tag that does not verify keeps both branches and
logs `record: … kept`. The record's evidence directory gains `claude-version.txt` (the boot's
`claude --version` output, written before the engine starts). Two facts to write truthfully
rather than paper over: `fleet/janitor.mjs` (not in this plan) still reads
`.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`, so its bullet keeps that read
and says a page whose branch is already gone reads as absent to it until it follows the tag;
and `skills/ultrapowers/SKILL.md` (not in this plan) still shows the branch recipe. The read
recipe by tag is `gh api 'repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>' --jq .content | base64 -d`.
Sentences other sims pin by regex and that must survive verbatim: in `fleet/CONTRACT.md`, the
evidence bullet's opening text `ultra/evidence-run-<N>` — the run's record under
`.ultrapowers/runs/<N>/`` and, inside that same bullet before the `ultra/integration-run-<N>`
bullet, `plus `approve-receipt.json` and `standing-approval.json`, present when the engine wrote them`
(`test_sandbox_boot_approval_evidence.mjs`); `unless the verdict is PASS or `approve-receipt.json` is
present beside the gate receipt` (`test_sandbox_boot_approved.mjs`); the merge bullet's
`commits/<head>/check-runs` … `pulls/<n>/merge` … `hold=1` order and the Publish bullet's
`sandbox merges itself once its checks are green, unless the assignment carries `hold=1``
(`test_sandbox_boot_merge.mjs`). In `fleet/RUNBOOK.md`: `A ready PR merges itself: the sandbox
polls its head's check runs and squash-merges it once every check is green, unless the launch
said `--hold`` and, under `## Trust`, `a pull request whose merge waits on the target's own
checks, and `--hold` to keep a human at the merge button` (`test_sandbox_boot_merge.mjs`,
`test_sandbox_boot_selfmerge.mjs`, which slice `## Trust` to `## Rollback`). Literals
`tests/test_docs_agree_with_code.py` already reads out of the contract and must keep their shape:
`**VM name:** `fleet-r<N>-`, `systemctl --user start fleet-run@<N>.service`,
`/home/exedev/engines/<sha>`; and its `RETIRED` vocabulary (`sweep-branches`, `refs/fleet/`,
`fleetRuns`, …) must appear in neither document — say "sweep" or "retire", never
`sweep-branches`. Another task of this plan adds one paragraph to `fleet/RUNBOOK.md`'s **Reap.**
section naming `node fleet/retire.mjs --target …`; do not name `fleet/retire.mjs` in
`fleet/RUNBOOK.md` yourself (the script-exists pin would read it against a tree where only that
other task has the file) — name it in `fleet/CONTRACT.md`, which that pin does not read. Rewrite
`## The shape`, the **Watch.** recipe, the **Reap.** wording about branches, and `## Rollback`
(branches a run left are no longer deleted by hand — the record is the tags, and the sweep is
`retire`) in the RUNBOOK; in the contract rewrite the one-paragraph shape, `**Run id:**` (say
"branches" before "tags" and spell the tag pair as `ultra/{plan,evidence}/run-<N>`), the
three-branches bullet's framing (the branches are transient, the tags are the record), and add
the `**The two tags**` bullet directly under the three branches, saying in this order that
`ultra/plan/run-<N>` is the plan commit, `ultra/evidence/run-<N>` the final evidence commit, and
that the two branches are deleted after the tags are verified. In
`tests/test_docs_agree_with_code.py` add the two tests under the `# ── the contract's literals`
section with a regex over the `**The two tags` bullet, in the style of `contract_literal`. In the
contract's boot-script bullet the sub-bullets are two-space-indented `  - <word>:` lines (`  -
merge:` is the last one at BASE); add `  - record:` after it. One more rewording, for #681
(another run of this wave changes `fleet/doctor.mjs` so the `capacity` row reports and never
refuses; these two documents are this plan's): at BASE `fleet/RUNBOOK.md` setup row 2 ends "A pool
that cannot hold a run of this size is a run asked too large, and the launcher refuses before it
touches anything", its `## Capacity` section ends "The `capacity` doctor row divides the pool by
one run's `cpu` and says how many runs fit at once; that number is the width of a wave of runs",
and `fleet/CONTRACT.md`'s doctor table has the `capacity` row green when "the pool holds one run
of the configured size; the detail says how many fit". Rewrite those three so the row is a report
of two facts — the account's pool from `billing plan --json` and the size one run asks from
`fleet.json` — and never a count of how many runs fit, a width, or a refusal: capacity is
over-committable (56 vCPU allocated on a 16-vCPU plan, measured), so contention, not the
division, bounds concurrent runs, and no document may teach a number the doctor does not stand
behind. The phrases "cannot hold", "how many fit" and "how many runs" must be gone from both
files.
**BASE facts:** (generated at e04154b)
- `capacity` at `fleet/launch.mjs:355` blob a2bcd04
- `fleet/CONTRACT.md` blob a91fa2b
- `fleet/RUNBOOK.md` blob 7a45c72
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea
- `fleet/janitor.mjs` blob 236dc2f
- `skills/ultrapowers/SKILL.md` blob f286d45
- `contract_literal` at `tests/test_docs_agree_with_code.py:248` blob c9687c7
- `fleet/doctor.mjs` blob 5e0d5c9
- `cpu` at `fleet/launch.mjs:275` blob a2bcd04

**Proof:**
- Run: sed -n '/^- \*\*The two tags/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'ultra/plan/run-<N>.*ultra/evidence/run-<N>.*ultra/plan-run-<N>.*ultra/evidence-run-<N>.*deleted.*after.*verified'
- The previous bullet is the leg for the two-tags bullet naming both tags, then both branch
  spellings as what is deleted, then the deletion after verification, in that order — a bullet
  that names the tags but not which branches go, or puts the deletion before the verification,
  fails it [M1].
- Run: sed -n '/^- \*\*Run id:\*\*/,/^- \*\*VM name/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'branches.*tags' && grep -q 'ultra/{plan,evidence}/run-<N>' fleet/CONTRACT.md
- The previous bullet is the leg for the run-id bullet counting both shapes [M2].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status.json/p' fleet/CONTRACT.md | grep '^  - merge:\|^  - record:' | tr '\n' ' ' | grep -q '^  - merge:.*  - record:.*ultra/plan/run-<N>.*ultra/evidence/run-<N>.*delet'
- The previous bullet is the leg for the boot-script bullet's order: its `  - merge:` sub-bullet
  comes first and a `  - record:` sub-bullet naming both tags and the deletion comes after it —
  a bullet with the record step before the merge, or without it, fails [M2].
- Run: sed -n '/^\*\*Watch\.\*\*/,/^\*\*The PR\.\*\*/p' fleet/RUNBOOK.md | grep -q 'status.json?ref=ultra/evidence/run-<N>' && ! grep -q 'ref=ultra/evidence-run-' fleet/RUNBOOK.md fleet/CONTRACT.md
- The previous bullet is the leg for the Watch recipe by tag — the tag `?ref=` has to sit inside
  the paragraph between `**Watch.**` and `**The PR.**`, not elsewhere in the runbook — and for
  the absence of any branch `?ref=` in either document — a recipe still spelling the branch after
  `?ref=` in either file fails it [M3].
- Run: grep -q 'evidence-run-<N>. — the run' fleet/CONTRACT.md && grep -q 'present when the engine wrote them' fleet/CONTRACT.md && grep -q 'claude-version.txt' fleet/CONTRACT.md && grep -q 'unless the verdict is PASS or' fleet/CONTRACT.md
- The previous bullet is the leg for the four pinned contract phrases surviving and the new
  evidence file being named [M4].
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'
- The four previous bullets run the sims that pin the contract's and the runbook's merge and
  approval sentences by regex; each passes only while its sentence stands [M4].
- Run: grep -q 'def test_.*two_tags' tests/test_docs_agree_with_code.py && grep -q 'def test_.*evidence_tag' tests/test_docs_agree_with_code.py && python3 -m pytest tests/test_docs_agree_with_code.py -q
- The previous bullet is the leg for the two new tests existing by name and the whole
  docs-agree file passing on this tree [M5].
- Run: bash -c 'cp fleet/CONTRACT.md /tmp/contract-$$.bak && trap "mv /tmp/contract-$$.bak fleet/CONTRACT.md" EXIT && sed -i.orig "s#ultra/evidence/run-<N>#ultra/evidence-run-<N>#g" fleet/CONTRACT.md && rm -f fleet/CONTRACT.md.orig && ! python3 -m pytest tests/test_docs_agree_with_code.py -q -k two_tags'
- The previous bullet is the negative row for the new tag test: with every evidence-tag literal
  in the contract edited back to the branch spelling, the `two_tags` test fails; the trap
  restores the file whatever the outcome [M5].
- Run: bash -c 'cp fleet/RUNBOOK.md /tmp/runbook-$$.bak && trap "mv /tmp/runbook-$$.bak fleet/RUNBOOK.md" EXIT && sed -i.orig "s#status.json?ref=ultra/evidence/run-<N>#status.json?ref=ultra/evidence-run-<N>#" fleet/RUNBOOK.md && rm -f fleet/RUNBOOK.md.orig && grep -q "ref=ultra/evidence-run-<N>" fleet/RUNBOOK.md && ! python3 -m pytest tests/test_docs_agree_with_code.py -q -k evidence_tag'
- The previous bullet is the negative row for the new `?ref=` test: with the Watch recipe's
  `?ref=` edited back to the branch spelling (the grep confirms the edit took), the
  `evidence_tag` test fails — a test that only asserts its own name, or an `assert True`, passes
  here and fails this leg; the trap restores the file whatever the outcome [M5].
- Run: ! grep -n 'cannot hold' fleet/RUNBOOK.md fleet/CONTRACT.md
- Run: ! grep -n 'how many fit' fleet/RUNBOOK.md fleet/CONTRACT.md
- Run: ! grep -n 'how many runs' fleet/RUNBOOK.md fleet/CONTRACT.md
- The three previous bullets are the legs naming what is absent: the refusal wording, the
  fit-count wording and the run-count wording of the `capacity` row are gone from both
  documents [M6].
- Run: sed -n '/^\*\*2\. .capacity/,/^\*\*3\. .claude/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'billing plan --json.*fleet.json.*report' && sed -n '/^## Capacity/,/^## Trust/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q '.capacity. doctor row.*report.*.cpu.' && grep '^  | .capacity. |' fleet/CONTRACT.md | grep -q 'report'
- The previous bullet is the leg for the positive wording in all three places (the dots in its
  patterns stand for the backtick that quotes each word in the documents): the runbook's setup
  row 2 names the pool and fleet.json and says the row reports, its "## Capacity" section says
  the capacity doctor row reports beside one run's cpu, and the contract's capacity table row
  says it reports — a rewrite that merely deletes the three phrases and says nothing about
  reporting fails it [M6].
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q
- The previous bullet re-runs the docs-agree file after the capacity rewording, so the
  retired-vocabulary pin and the first-run heading pin still hold over the reworded rows [M6].

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`
- path-absent: `tests/test_docs_agree_with_code.py`
- issue-closed: #624
