# Publish decisions as events

**Grammar:** claims-v1

**Claim:** a held run, a merged run and a merge that failed are three different records (elicited)

**Goal:** #703. The Claim above is that issue's desired-state sentence verbatim, confirmed by the
operator on 2026-09-07. Today the boot script decides the PR, the hold and the merge and records
each decision only as a log line and as the `phase` text of `status.json` (`left open: hold=1`,
`left open: merge PUT answered 405`, `merged <sha>`); `events.jsonl` — the record the ultralearn
readers replay — carries nothing for any of them, so a held run, a run left open by a red check,
and a merge GitHub refused read identically off the events. After this run the boot appends its
three decisions to the run's event log as events of their own — `publish:pr`, `publish:hold`,
`publish:merge` — stamped the way the engine stamps every event, committed in the evidence copy
of `events.jsonl`, named in the contract, and rendered by the unchanged ultralearn reader as the
tail of the run.
**Closes:** #703

**Tech Stack:** bash (`fleet/sandbox-boot.sh`, with `python3` for JSON and the id) + Node 22 ESM
sims (`fleet/tests/*.mjs`) + Python 3 (`skills/ultralearn/scripts/*.py`, read but not changed);
the suite is `python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs`
through `tests/test_fleet_suite.py` (120 s per file, `git`/`gh`/`curl`/`systemd-run` stubbed
through a PATH shim) and runs `tests/test_*.py`.

**Parallelization rationale:** one task, width 1. The issue's second half — "ultralearn read the
tail off events instead of parsing the phase string" — needs no second task at BASE: neither
`skills/ultralearn/scripts/fleet_events.py` nor `_outcome.py` parses `left open`, `merged` or
`hold=` anywhere (verified by grep on `00fb224`; the only phase-string reader in the tree is the
boot's own `last_phase`, which reads `engine:phase` events, not the merge note), `read_events`
already sorts every record by `id` and `_summarize_one` already renders an unlisted `kind` as its
fields, so the reader reads the tail the moment the boot writes it. A reader-side task would
have nothing to move; the reader is pinned untouched instead. No chain.

## Global Constraints

- Check: `bash -n fleet/sandbox-boot.sh`
- Check: `bash -c 'for f in write_status phase_refresher last_phase; do diff <(git show $ULTRA_BASE:fleet/sandbox-boot.sh | sed -n "/^$f() *{/,/^}/p") <(sed -n "/^$f() *{/,/^}/p" fleet/sandbox-boot.sh) || exit 1; done'`
- The event log is append-only: no line the engine or the folder wrote to `events.jsonl` is
  changed or reordered, and every line the boot appends is one JSON object carrying `kind`,
  `id` (a 26-character Crockford-base32 ULID) and `ts` (epoch milliseconds), the stamp
  `makeEventLog` in `fleet/run-waves.mjs` puts on every engine event.
- The boot script's `write_status`, `phase_refresher` and `last_phase` functions are the base's
  bytes — a concurrent run edits them, and this plan touches only `publish`, `merge_pr`,
  `do_boot` and what it adds beside them.
- The boot script runs no `node` and no `gh` — the sims count a direct call of either as a
  finding; `python3` is already the script's JSON reader and is on every sandbox.

**Acceptance:** suite — the committed suite is the verification.


### Task 1: The boot writes its publish decisions as events

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_selfmerge.mjs`

**Claim:** The boot writes the publish decisions into the run's event log as events — `publish:pr` (url, number), `publish:hold` (hold=1), `publish:merge` (sha, or the reason it was left open: checks red, checks pending, refused) — so a held run, a merged run and a merge that failed are three different records (quoted from #703)
Machine: M1. A boot that POSTs a pull request appends to `<run dir>/events.jsonl`, after the
POST's 2xx answer, exactly one line parsing to
`{"kind":"publish:pr","url":<html_url>,"number":<n>,"draft":<bool>,"id":…,"ts":…}` — `url` the
answer's `html_url`, `number` its integer `number`, `draft` the boolean the POST carried; a
parked run's record is that one line with `draft` true and no `publish:hold` and no
`publish:merge` line; a run that opens no PR (nothing ahead of base) appends no line whose
`kind` starts with `publish:`. M2. A run whose assignment carries `hold=1` appends, after its
`publish:pr`, exactly one `{"kind":"publish:hold","why":"hold=1"}` and no `publish:merge`; a
gate-green run whose publish fold ended `suite red`, `conflict parked` or `cannot fold` appends
exactly one `{"kind":"publish:hold","why":"publish fold — <phrase>"}` where `<phrase>` is the
text `fold_phrase` renders for that attempt (the same text that follows `left open: ` in the
`done` page's phase), and no `publish:merge`; a gate-green run that is held by neither appends
no `publish:hold`. M3. A gate-green, unheld run appends one `publish:merge` line per merge
decision: a 2xx PUT appends `{"kind":"publish:merge","sha":"<the answer's sha>"}` with no `left`
key; a check run concluding outside `success`/`neutral`/`skipped` appends
`{"kind":"publish:merge","sha":null,"left":"checks red","detail":"check <name> concluded <conclusion>"}`
and no PUT is made; checks still pending when `MERGE_CHECK_WAIT` runs out appends
`{"kind":"publish:merge","sha":null,"left":"checks pending","detail":"still pending after <N>s"}`
and no PUT is made; a non-2xx PUT appends
`{"kind":"publish:merge","sha":null,"left":"refused","detail":"merge PUT answered <code>"}`; and
the one retry (a 405 whose body says the PR is not mergeable, a second fold, a second PUT)
leaves two `publish:merge` lines in that order, the first `left` `refused` with `detail`
`merge PUT answered 405` and the last the second PUT's outcome — so the last `publish:merge`
line of a record is what became of the PR. M4. Every line the boot appends carries `id`, a
26-character string over the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` whose first ten
characters are `ts` in base 32 most-significant first (the engine's `b32(ts, 10)`), and `ts`, an
integer of epoch milliseconds taken at the append, no earlier than the boot's start and no later
than the exam's read; in file order the boot's `id`s strictly ascend; sorted by `id` as
`fleet_events.read_events` sorts, every boot line follows every line the engine wrote; the
file's first line is byte-identical to the line the engine left; and the boot mints the id with
no direct `node` or `gh` call. M5. The evidence copy `<evidence worktree>/.ultrapowers/runs/<N>/events.jsonl`
committed with the run's terminal page (`done` or `parked`) is byte-identical to the run dir's
file, publish lines included. M6. `python3 skills/ultralearn/scripts/fleet_events.py <run dir>`
run over a finished run's directory, with `skills/ultralearn/`, `fleet/run-waves.mjs`,
`fleet/run-engine.mjs`, `fleet/run-main.mjs` and `fleet/publish-fold.mjs` byte-for-byte BASE's,
exits 0 and prints a timeline whose last line names `publish:merge` and the squash sha for a
merged run, `publish:hold` and `hold=1` for a held run, and `publish:merge`, `refused` and the
code for a refused merge, with the `publish:pr` line carrying the PR URL before it. M7.
`fleet/CONTRACT.md`'s `- **Publish:**` bullet names `publish:pr`, `publish:hold` and
`publish:merge` with their fields, and every byte of `fleet/CONTRACT.md` outside that bullet is
BASE's.

**Authorized-by:** #703

**Interfaces:**
- Consumes: `none`
- Produces: `none`

**Context:** HARD CONSTRAINT on the exam: M6 and M7 are established by the `Run:` commands alone, where the driver supplies `$ULTRA_BASE`; the committed sim `fleet/tests/test_sandbox_boot_selfmerge.mjs` never compares the tree to BASE, never reads `ULTRA_BASE`, and embeds no commit sha — a BASE literal frozen into the suite goes red on the first unrelated commit to `fleet/CONTRACT.md` or the engine files, which is how run-35 parked. HARD CONSTRAINT on `fleet/sandbox-boot.sh`: a concurrent run is editing
`write_status` and `phase_refresher` (and `last_phase` beside them) in the same file, and
extending `commitStates` pins in `fleet/tests/test_sandbox_boot.mjs`; this task's edits sit in
`publish` (line 1189 at BASE), `merge_pr` (1326), `do_boot` (1517 — the attempt-2 `tip unmoved`
branch sets its own `MERGE_NOTE` there without entering `merge_pr`) and a new helper placed
beside them, never in those three functions — a Global Constraint diffs them against BASE on
every pass. The boot never writes `events.jsonl` today: it only reads it (`last_phase`, line
557, greps `"kind":"engine:phase"` and takes the last) and copies it (`collect_evidence`, line
678, `for f in report.json events.jsonl receipt.json standing-approval.json`, into
`$EVIDENCE_DIR/$EVIDENCE_PATH`). The writers are the engine and the folder, both through
`makeEventLog` in `fleet/run-waves.mjs` (line 461): one JSON object per line,
`JSON.stringify({ ...e, id: ulid(ts), ts })`, where `ulid(now)` is `b32(ts, 10) + b32(seq, 4) +`
twelve random characters over `B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'` and `b32(n, len)`
takes `n % 32` into the low position and divides by 32 `len` times — so the first ten
characters of any id are the millisecond clock, most significant first, and the readers
(`fleet_events.read_events`) sort by `id` as a string, never by `ts`. The boot's id must be the
same shape so the boot's lines sort after the engine's and the folder's; its last sixteen
characters are the boot's own (randomness, or four zeros then randomness). `node` is stubbed in
the rig and a direct call is a finding (`directCalls`); `python3` is on every sandbox and is
what the script already uses for `check_runs_verdict` and `mergeable_field`, so it is the tool
for both the id and the JSON line — `json_escape` is a shell function that escapes for a string
cell, not a JSON encoder. The run directory is `run_dir_path()` =
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`, in the rig `<home>/target/.claude/ultrapowers/run-run-7`
(the engine stub in `_sandbox_boot_helpers.mjs`, line 465, writes exactly one line there:
`{"kind":"engine:phase","phase":"gate","id":"x","ts":1}`); the evidence copy is
`<home>/evidence/.ultrapowers/runs/7/events.jsonl` (`EVIDENCE_DIR=$FLEET_HOME/evidence`,
`RUN_PATH` in the helpers), refreshed by `collect_evidence` at every `write_status` transition
and once more before the terminal push. The stub's `"id":"x"` sorts AFTER every real ULID
(lowercase `x` is above `Z`), which is a stub artefact the real engine never produces: the rig's
engine line becomes a ULID-shaped id that encodes its `ts` of 1 — `"id":"0000000001"` followed
by sixteen `0`s — so M4's and M6's sorted order is the production order; nothing else pins that
literal (`grep '"id":"x"' fleet/tests/` finds only the helpers). The decision sites at BASE, each
already a `log` line: `publish` records `PR_URL` from the answer's `html_url` (`json_field
html_url`, first match — the PR document's own field precedes the head/base repositories') and
the number is `${PR_URL##*/}` (`pr_number`); `merge_pr` returns early with `MERGE_NOTE="left
open: hold=1"` when `HOLD=1` (tested before `FOLD_HOLD`, so a held run under a red fold keeps
`hold=1`), with `MERGE_NOTE="$FOLD_HOLD"` (`left open: publish fold — <fold_phrase>`, where
`fold_phrase` yields `suite red`, `conflict parked on <path>`, `cannot fold: <reason>` or the
disposition text) when the fold held, then polls check runs and ends with `MERGE_NOTE` one of
`left open: check <name> concluded <conclusion>`, `left open: checks still pending after
${MERGE_CHECK_WAIT}s`, `left open: merge PUT answered <code>` (also `… 405`, which sets
`MERGE_RETRY=1` when the body says `not mergeable`), `left open: merge PUT answered 405 twice`,
or `merged <sha>` (`MERGED_SHA` from the answer's `sha`); `do_boot` then folds again on
`MERGE_RETRY=1` and either re-enters `merge_pr` or, on `tip unmoved`, sets `left open: merge PUT
answered 405 twice` itself. A parked run (`STUB_VERDICT: NEEDS_ACK`) opens a draft and never
enters `merge_pr`; a re-entry with `pr` already on the page opens no second PR; `ahead == 0`
(`STUB_NO_COMMITS`) publishes nothing. The event vocabulary this task fixes, one line each,
fields in this order before the stamp:

    {"kind":"publish:pr","url":"https://github.com/popmechanic/smoke/pull/1","number":1,"draft":false,"id":"<ULID>","ts":<ms>}
    {"kind":"publish:hold","why":"hold=1","id":"<ULID>","ts":<ms>}
    {"kind":"publish:hold","why":"publish fold — suite red","id":"<ULID>","ts":<ms>}
    {"kind":"publish:merge","sha":"f6f6…f6f6","id":"<ULID>","ts":<ms>}
    {"kind":"publish:merge","sha":null,"left":"checks red","detail":"check test concluded failure","id":"<ULID>","ts":<ms>}
    {"kind":"publish:merge","sha":null,"left":"checks pending","detail":"still pending after 3s","id":"<ULID>","ts":<ms>}
    {"kind":"publish:merge","sha":null,"left":"refused","detail":"merge PUT answered 405","id":"<ULID>","ts":<ms>}

`detail` is the tail of the existing log line after `merge: `, minus ` — leaving <url> open`;
the retry's second refusal is `merge PUT answered 405 twice`. A `publish:hold`'s `why` is the
phase's text after `left open: ` — the same string, so a reader of either record matches the
other. The rig knobs the legs use, all in `_sandbox_boot_helpers.mjs`: `green()` (memoized green
boot — PASS, one successful check, the PUT answers 200 with `MERGE_SHA`),
`ran({ FLEET_ASSIGNMENT: \`${ASSIGNMENT} hold=1\` })`, `ran({ STUB_FOLD_DISPOSITION: 'suite red' })`
(the fold stub writes that disposition, the boot holds, phase `left open: publish fold — suite
red`), `ran({ STUB_FOLD_DISPOSITION: 'conflict parked', STUB_FOLD_PATH: 'a.txt' })` and
`ran({ STUB_FOLD_DISPOSITION: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor' })` (the
stub writes `path` and `reason` into the receipt row, which `fold_phrase` renders), `ran({ STUB_VERDICT: 'NEEDS_ACK' })` (parked draft), `ran({ STUB_NO_COMMITS: '1' })` (no PR;
the boot exits 0 with the page `parked`), `ran({ STUB_CHECKS: checksBody([completed('test',
'failure')]) })`, `ran({ STUB_CHECKS_PENDING: '50', FLEET_MERGE_CHECK_WAIT: '3' })` (the wait is 3 s
of wall clock at `FLEET_POLL_SECONDS=0`), `ran({ STUB_MERGE_CODE: '405' })` (the stub's default
message does not say `not mergeable`, so one PUT and no retry), and
`ran({ STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: 'Pull Request is not mergeable' })` (the retry:
two fold units, two PUTs, the second answering 200 with `MERGE_SHA`). The file runs in 39 s at
BASE with about twenty boots and the bridge caps it at 120 s, so the new legs add at most ten
boots (about 20 s) and take the merged row from `green()`. Readers of the run dir's and the evidence copy's
`events.jsonl` (`runDir(ctx)`, `events(ctx)`, `publishEvents(ctx)`, or the like) belong in the
helpers, exported beside `foldReceipt`, so the sibling sims can read the same record. Leg (j)
runs the real reader: `spawnSync('python3', [<repo>/skills/ultralearn/scripts/fleet_events.py,
runDir], { encoding: 'utf8' })` — `render_timeline` prints one line per event, `<id>  +<s>s
<kind>  <summary>`, and for an unlisted kind the summary is `json.dumps` of the record minus
`kind`/`id`/`ts`, so `publish:pr`'s line carries the URL and `publish:merge`'s the sha or the
`left`/`detail` pair. `fleet/CONTRACT.md`: the `- **Publish:**` bullet (from its own line up to,
not including, `- **Integration naming:**`) already ends with the fold's record sentence — "The
fold's record is that section, the `publish-fold/` receipts directory and the
`driver:publish-fold` event; `status.json` gains no cell for it." — and the publish record's
sentence goes beside it, naming the three kinds and their fields; the `- merge:` sub-bullet, the
`- **status.json:**` line, the evidence-branch bullet and the `**The two tags` bullet are BASE's
(`tests/test_docs_agree_with_code.py` pins the two-tags bullet and the state list; the
concurrent run edits the state list). Every new leg extends `test_sandbox_boot_selfmerge.mjs`
under one comment naming this task (`#703 Task 1`); no sibling test file is created, and the
existing legs' assertions on `merged`, the phase text and the log lines stay as they are — the
events are added beside the page, never instead of it. Every literal the legs reuse from the
page and the log (`hold=1`, `left open: `, `suite red`, `merge PUT answered 405`, the three
green conclusions, `html_url`) is BASE's and stays as it is — the sibling sims that pin them
keep passing, which the fifth `Run:` shows.

**BASE facts:** (generated at 00fb224)
- `fleet/sandbox-boot.sh` blob 5f05767
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 72ce4f8
- `fleet/tests/test_sandbox_boot_selfmerge.mjs` blob 41a24b8
- `fleet/CONTRACT.md` blob 9cbbeb8
- `fleet/run-waves.mjs` blob 27f25b5
- `fleet/run-engine.mjs` blob 8694de1
- `fleet/run-main.mjs` blob b182a5b
- `fleet/publish-fold.mjs` blob 024f6f5
- `skills/ultralearn/scripts/fleet_events.py` blob 47ad4d9
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `tests/test_fleet_events.py` blob 39be477
- `makeEventLog` at `fleet/run-waves.mjs:461` blob 27f25b5
- `RUN_PATH` at `fleet/tests/_sandbox_boot_helpers.mjs:56` blob 72ce4f8
- `directCalls` at `fleet/tests/_sandbox_boot_helpers.mjs:620` blob 72ce4f8
- `foldReceipt` at `fleet/tests/_sandbox_boot_helpers.mjs:644` blob 72ce4f8

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_selfmerge.mjs`
- Run: `bash -c 'b=$(sed -n "/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p" fleet/CONTRACT.md); for w in publish:pr publish:hold publish:merge url number draft why left detail "checks red" "checks pending" refused; do printf "%s" "$b" | grep -q -- "$w" || exit 1; done'`
- Run: `bash -c 'diff <(git show $ULTRA_BASE:fleet/CONTRACT.md | sed "/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/{/^- \*\*Integration naming/!d;}") <(sed "/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/{/^- \*\*Integration naming/!d;}" fleet/CONTRACT.md)'`
- Run: `git diff --quiet $ULTRA_BASE -- skills/ultralearn/ fleet/run-waves.mjs fleet/run-engine.mjs fleet/run-main.mjs fleet/publish-fold.mjs`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py tests/test_fleet_events.py`
- Run: `bash -c 'for f in fleet/tests/test_sandbox_boot.mjs fleet/tests/test_sandbox_boot_edges.mjs fleet/tests/test_sandbox_boot_merge.mjs fleet/tests/test_sandbox_boot_approval_evidence.mjs fleet/tests/test_sandbox_boot_record.mjs; do node "$f" >/dev/null || exit 1; done'`
- Legs, under a comment naming this task (`#703 Task 1`): (a) `green()`'s run dir
  `events.jsonl` holds exactly one line whose `kind` is `publish:pr`, parsing to `url` equal to
  `PR_URL`, `number` equal to the integer `1` and `draft` equal to `false`; the parked run
  (`STUB_VERDICT: 'NEEDS_ACK'`) holds exactly one `publish:pr` with `draft` `true`, zero
  `publish:hold` lines and zero `publish:merge` lines; and the run with nothing ahead of base
  (`STUB_NO_COMMITS: '1'`) holds zero lines whose `kind` starts with `publish:` while
  `prPosts(ctx)` is empty [M1]; (b) the `hold=1` run's lines whose `kind` starts with `publish:`
  are, in file order, exactly `[publish:pr, publish:hold]`, the hold's `why` is exactly the
  string `hold=1`, `mergePuts(ctx)` is empty and no `publish:merge` line exists; the `suite red`
  fold run's `publish:`-lines are exactly `[publish:pr, publish:hold]` with `why` exactly
  `publish fold — suite red`, equal to the `done` page's `phase` text after `left open: `, and
  `mergePuts` empty; the `conflict parked` fold run (`STUB_FOLD_DISPOSITION: 'conflict parked',
  STUB_FOLD_PATH: 'a.txt'`) likewise holds exactly `[publish:pr, publish:hold]` with `why` exactly
  `publish fold — conflict parked on a.txt` and `mergePuts` empty; the `cannot fold` run
  (`STUB_FOLD_DISPOSITION: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor'`) likewise,
  with `why` exactly `publish fold — cannot fold: base not an ancestor`; `green()` holds zero
  `publish:hold` lines [M2]; (c) `green()` holds exactly
  one `publish:merge` line, whose `sha` equals `MERGE_SHA` and which has no `left` key and no
  `detail` key, and `statusOf(ctx).merged` equals that `sha` [M3]; (d) the red run
  (`STUB_CHECKS: checksBody([completed('test', 'failure')])`) holds exactly one `publish:merge`,
  parsing to `sha` `null`, `left` `checks red`, `detail` `check test concluded failure`, with
  `mergePuts` empty [M3]; (e) the pending run (`STUB_CHECKS_PENDING: '50', FLEET_MERGE_CHECK_WAIT:
  '3'`) holds exactly one `publish:merge` with `sha` `null`, `left` `checks pending`, `detail`
  `still pending after 3s`, with `mergePuts` empty [M3]; (f) the refused run (`STUB_MERGE_CODE:
  '405'`) holds exactly one `publish:merge` with `sha` `null`, `left` `refused`, `detail` `merge
  PUT answered 405`, with `mergePuts` of length 1 [M3]; (g) the retry run (`STUB_MERGE_CODE:
  '405', STUB_MERGE_MESSAGE: 'Pull Request is not mergeable'`) holds exactly two `publish:merge`
  lines, the first with `sha` `null`, `left` `refused`, `detail` `merge PUT answered 405`, the
  last with `sha` equal to `MERGE_SHA` and no `left` key, `mergePuts` of length 2 and
  `statusOf(ctx).merged` equal to `MERGE_SHA`; and across (a)–(g) every run holds exactly one
  `publish:pr` line, and in every run the last line whose `kind` starts with `publish:` is the
  line the case named as its outcome [M3]; (h) for every boot in (a)–(g), each line whose `kind`
  starts with `publish:` has an `id` matching `/^[0-9A-HJKMNP-TV-Z]{26}$/`, decoding its first ten
  characters over `0123456789ABCDEFGHJKMNPQRSTVWXYZ` most-significant-first yields an integer
  equal to its `ts`, `ts` is an integer no less than a `Date.now()` taken before that boot and no
  more than one taken after it, the `id`s of the boot's lines strictly ascend in file order, the
  records of the whole file sorted by `id` as strings put every `publish:` line after the
  engine-stub line, the file's first line is byte-identical to the engine stub's line, a line
  with `"id":"x"` is absent from every file, and `directCalls(ctx)` is `[]` for `green()` [M4];
  (i) for `green()`, the `hold=1` run and the refused run, `<home>/evidence/.ultrapowers/runs/7/events.jsonl`
  read as a buffer `deepEqual`s the run dir's file read the same way, and each holds the
  case's `publish:` lines [M5]; (j) `spawnSync('python3', [fleet_events.py, runDir])` over
  `green()` exits 0 and its stdout's last non-empty line contains `publish:merge` and `MERGE_SHA`
  and the line before it contains `publish:pr` and `PR_URL`; over the `hold=1` run the last line
  contains `publish:hold` and `hold=1`; over the refused run the last line contains
  `publish:merge`, `refused` and `405`; and the third `Run:` (`git diff --quiet` over
  `skills/ultralearn/` and the four engine files) exits 0, failing when any byte of the reader
  or the engine's event writer differs from BASE [M6]; (k) the first `Run:` reads the `- **Publish:**` bullet alone and exits 0 only when it
  carries all three kinds and the field names `url`, `number`, `draft`, `why`, `left`, `detail`,
  `checks red`, `checks pending` and `refused` — a kind or a field named only elsewhere in the
  file fails it; the second `Run:` excises the
  `- **Publish:**` bullet from BASE's and the tree's `fleet/CONTRACT.md` and `diff`s the
  remainders, so a changed byte anywhere outside that bullet — the `- merge:` sub-bullet, the
  `- **status.json:**` line, the `**The two tags` bullet — is a non-empty diff and exit 1; the
  fourth `Run:` passes `tests/test_docs_agree_with_code.py` and `tests/test_fleet_events.py`;
  and the fifth `Run:` passes the five sibling sandbox-boot sims that share the changed rig
  [M7].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot_selfmerge.mjs`
- path-absent: `skills/ultralearn/scripts/fleet_events.py`
- issue-closed: #703
