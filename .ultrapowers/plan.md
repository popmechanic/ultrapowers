# A run merges itself unless held

**Grammar:** claims-v1

**Claim:** After this run, a run I launch merges its own pull request once its checks are
green unless I said --hold, the janitor only reaps and the launcher runs it for me, and the
doctor tells me when fleet.json carries keys nobody reads or no run size. (elicited)

**Goal:** #660 as decided on 2026-09-05 (no local scheduler — "a process every five minutes
is too fragile"): the janitor's merge role moves into the sandbox and its reap role moves to
the launcher. The boot script polls the PR head's check runs over REST through the target's
integration after it publishes a ready PR and merges the PR itself (squash, the plan's H1 as
the title), recording the merged sha on the status page; a failed check, the bound, or a
refused merge leaves the PR open and the run `done` as today. `launch.mjs --hold` writes
`hold=1` into the assignment so a measurement run (#653's A/B) publishes and never merges.
The janitor keeps only the reap — #655's laptop-side arming and its sim are deleted — and
`launch.mjs` runs it before every launch; there is no cron. #668: the doctor's `capacity` row
names the keys in `~/.ultrapowers/fleet.json` that nothing reads and says which two it does,
and the first-run walk writes both keys explicitly. Nothing under `fleet/run-engine.mjs`,
`fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/roles/`, `skills/ultrawrite/`,
`skills/ultralearn/` or `skills/ultrapowers/scripts/` is touched — three concurrent plans own
those.

**Tech Stack:** bash (`fleet/sandbox-boot.sh` and its sims), Node 24 ESM (`fleet/launch.mjs`,
`fleet/lobby.mjs`, `fleet/janitor.mjs`, `fleet/doctor.mjs` and the sims under `fleet/tests/`,
each printing `ALL TESTS PASSED`), Python 3 (`python3 -m pytest`), Markdown. Nothing is added
to any dependency file; `fleet/doctor.mjs` keeps importing only `node:`-prefixed specifiers.

**Spec:** #660 (its first paragraph, "Decided 2026-09-05", is the design; the rest is history)
and #668. The issues carry the design; there is no separate spec document.

**Parallelization rationale:** One wave, width 4. Tasks 1 and 2 are joined by one shared
literal — the comment key `hold=1`, written by the launcher and read by the boot script — put
in both Contexts and in the contract sentence Task 2 writes, so neither waits on the other.
Tasks 1, 2 and 3 all modify `fleet/CONTRACT.md`, `fleet/RUNBOOK.md` and
`skills/ultrapowers/SKILL.md` in distinct bullets, paragraphs and steps (named in each
Context); Tasks 2 and 3 both modify `fleet/launch.mjs` (the flag parse and the comment fields;
one call before the run number is read); Tasks 3 and 4 both modify
`skills/ultrapowers/references/first-run.md` (the exe-dev section's key sentence; the
capacity section) — all text that folds. No task consumes a sibling's symbol, so no edge is
derived and no task waits. Every exam is a new sim file, so no two examiners write one file.

## Global Constraints

- The engine, its clone routing, its worker, its two role files, the authoring skill, the
  distilling reference, the compiler and the vendored kernel are byte-identical to BASE — three
  concurrent plans own them, and `manyana.py` is sha-pinned on purpose.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = 762be27108232d1625964d4f2c97e9f4bd7f06de
- Check: test "$(git hash-object fleet/run-waves.mjs)" = 350bb663dcdfa2d7cc90b85cd306e985fe359171
- Check: test "$(git hash-object fleet/run-worker.mjs)" = ae072613d281ad35529ee0865bb96bad6ef09c9c
- Check: test "$(git hash-object fleet/roles/implementer.md)" = 0a92a3d5a6c43ab88710d7c93322fcacda011152
- Check: test "$(git hash-object fleet/roles/examiner.md)" = 3a8c8acf9e60d1a868db0bbfcc2226d42566bbf4
- Check: test "$(git hash-object skills/ultrawrite/SKILL.md)" = 366683a35618d97008c3004a96f16f812c49617c
- Check: test "$(git hash-object skills/ultralearn/references/distilling-proposals.md)" = c3aabdbbfdc8390e929ebe5f562d013f40eb78c7
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = 18ad6070d1e0c33142710ebc107f11fe8f6765fa
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The four operator documents still agree with the code: every flag on the documented launch
  line is in the launcher's usage, the doctor's row ids are `first-run.md`'s headings in order,
  and the retired vocabulary of the pre-lift fleet appears nowhere.
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The boot script still parses.
- Check: bash -n fleet/sandbox-boot.sh
- The janitor still issues no `git` and no `ssh <vm>` command, and reads nothing under
  `~/.ultrapowers/` but `fleet.json`; the boot script still runs no `gh`.
- No source under `fleet/` spells the retired state repository's name in any of its three
  casings (the boot sims scan for them); a doctor detail that names a stale key echoes the
  file's own key, never a literal of its own.
- No shouted imperative (an all-caps must, never or always as a whole word) is added to any
  document or script.
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The sandbox merges its own pull request once its checks are green

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** After `publish`, the boot script polls the PR head's check runs over REST through
the target's integration (`GET /repos/<t>/commits/<sha>/check-runs`), and on success merges
over REST (`PUT /repos/<t>/pulls/<n>/merge`, squash, the plan's title as the commit title),
then writes `done` with `merged: <sha>`; a failed check leaves the PR open and the run `done`
as today. (quoted from #660)
Machine: M1. After a gate-green publish, the script reads
`https://github.int.exe.xyz/api/v3/repos/<target>/commits/<head>/check-runs` — `<head>` the
pushed integration-branch sha — every `POLL_SECONDS`, and once the answer lists at least one
check run and every listed run has `status` `completed` with `conclusion` one of `success`,
`neutral`, `skipped`, it issues exactly one `PUT
https://github.int.exe.xyz/api/v3/repos/<target>/pulls/<n>/merge` whose JSON payload carries
`"merge_method":"squash"`, `"commit_title":"<the plan's H1>"` and `"sha":"<head>"`; a 2xx
answer's `sha` is recorded as `merged` on the `done` page. M2. A listed run whose `status` is
not `completed` keeps the poll going; an answer listing no check run keeps it going through
the first `MERGE_CHECKS_GRACE` seconds' worth of attempts and is taken as nothing to wait for
after them (the PUT is issued); a completed run whose conclusion is outside the three
(`failure`) stops the poll with no PUT; a poll still pending after `MERGE_CHECK_WAIT` seconds'
worth of attempts stops with no PUT; a PUT answering non-2xx gets no second PUT — and in each
of those four the run ends `done` with `merged` null and `pr` still the PR URL. M3. A parked
outcome issues no check-runs read and no PUT and ends `parked`; an assignment carrying
`hold=1` publishes, issues no check-runs read and no PUT, and ends `done` with `merged` null;
an assignment carrying `hold=` with any other value fails before any clone with `assignment`
in its error. M4. Every status page carries a `merged` cell, null on every page before the
merge and the merge sha on the `done` page; the green path's evidence commits are still
exactly `running`, `publishing`, `done`, and its one notification is unchanged. M5.
`fleet/CONTRACT.md`'s status.json literal carries `"merged":`, its Boot-script bullet names
the check-runs read and the merge PUT, and its Publish bullet says the sandbox merges the PR
itself unless the assignment carries `hold=1`. M6. `fleet/RUNBOOK.md`'s "The PR." paragraph
says the sandbox merges the PR itself once its checks are green unless the launch said
`--hold`, its States table's `done` row names `merged`, and its Trust section no longer puts a
human at the merge button. M7. `skills/ultrapowers/SKILL.md`'s step 4 says a ready PR merges
itself once its checks are green and that `--hold` keeps it open.

**Authorized-by:** #660 (decided 2026-09-05, item (1): "After `publish`, the boot script polls
the PR head's check runs over REST through the target's integration … and on success merges
over REST … then writes `done` with `merged: <sha>`; a failed check leaves the PR open and the
run `done` as today"; item (2)'s sandbox half: "the sandbox publishes and never merges").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The shared literal with the launcher's task: the assignment comment's optional
last key is `hold=1` (exactly that value), which `parse_assignment` (line ~366, the `case
"$key" in run|plan|target|base|engine|overlap|tier|effort … *) fail "assignment: unknown key
…"` ladder, then the `case "$OVERLAP"/"$TIER"/"$EFFORT"` validators) reads into a new `HOLD`
variable, accepting `''` or `1` and failing anything else the way `effort=max` fails; the
`assignment:` log line gains `hold=${HOLD:-<default>}`. The merge step is one new function
called from `do_boot` (line ~802) right after the publish guard — `if [ -n "$PR_URL" ]; then
log "publish: … already recorded" else publish "$outcome" fi` (line ~930) — and only when
`outcome` is `gate-green`; the `done` transition it feeds is `write_status done "$PR_URL —
$approved_how"` (line ~939), whose phase text a sibling sim reads for the PR URL followed by
`verdict=PASS` or `approved by the two-move rule` (`test_sandbox_boot_approval_evidence.mjs`),
so the merge outcome is appended after those words (`— merged <sha>`, or `— left open:
<reason>`). The PR number is the tail of `PR_URL` (`…/pull/<n>`); the head is `fleet_git -C
"$TARGET_DIR" rev-parse "$BRANCH"` as `await_branch_visible` (line ~731) already reads it. The
two bounds are literals beside `PUBLISH_BRANCH_WAIT` (line ~118), env-overridable the same way:
`MERGE_CHECK_WAIT="${FLEET_MERGE_CHECK_WAIT:-1800}"` (30 minutes) and
`MERGE_CHECKS_GRACE="${FLEET_MERGE_CHECKS_GRACE:-120}"`; attempts come from `poll_attempts`
(line ~336: `timeout / step + 1`, step at least 1, so the sims' `FLEET_POLL_SECONDS=0` runs the
whole loop in a second), counted from 1 — an empty answer at an attempt no greater than the
grace's attempts is pending, at a greater one it is nothing to wait for. The GET carries no
`-f` and no `-X`, `-w '\n%{http_code}'` as the branch read does; a non-2xx GET is pending. The
PUT is `fleet_curl -sS -X PUT … -H 'content-type: application/json' -d "$payload" -w
'\n%{http_code}'`; `json_field` (line ~201) reads quoted string fields only — the PUT answer's
first `"sha"` is the merge commit (`{"sha":"…","merged":true,"message":"Pull Request
successfully merged"}`), and in a check-runs answer every `"status"` and every `"conclusion"`
is a quoted string while a run is completed, `"conclusion": null` (unquoted) while it is not,
and `"total_count"` is a number — the script has no jq by rule (line ~193's comment), so a
`grep -o` over those fields is the shape. Log lines, one each: `merge: checks green after <n>s
— merging <pr>`, `merge: merged <pr> as <sha>`, `merge: hold=1 — leaving <pr> open`, `merge:
check <name> concluded <conclusion> — leaving <pr> open`, `merge: checks still pending after
<MERGE_CHECK_WAIT>s — leaving <pr> open`, `merge: PUT answered <code> — leaving <pr> open`,
`merge: no check runs after <MERGE_CHECKS_GRACE>s — nothing to wait for`. No evidence commit
between the PR and `done`: `test_sandbox_boot.mjs` pins the green path's `commitStates` at
exactly `['running', 'publishing', 'done']` and its notification at exactly `{ title: 'run-7
done', message: '<target> — <pr>' }`; the served page may be rewritten (`write_status
publishing "<pr> — awaiting checks"`) without a commit, since `states()` collapses repeats.
`write_status` (line ~232) gains a `merged` cell after `prAuthor` — `MERGED_SHA` empty means
`null` — and `do_boot`'s re-entry reads (`PR_URL="$(read_status_field pr)"`, line ~808) gain
`MERGED_SHA`. The rig: `fleet/tests/_sandbox_boot_helpers.mjs` — `STUBS.curl` (line ~99)
answers by URL, unknown URLs `exit 22`; it gains two cases before `*notify.int.exe.xyz*)`: a
`*github.int.exe.xyz/api/v3/repos/*/commits/*/check-runs)` case that `bump checks`, logs `say
"curl check-runs <n>"`, and prints a body then a code — by default
`{"total_count":1,"check_runs":[{"name":"test","status":"completed","conclusion":"success"}]}`
and `200`, the first `STUB_CHECKS_PENDING` answers instead `"status":"in_progress","conclusion":null`,
`STUB_CHECKS` set to a JSON document replaces the body wholesale (that is how a sim answers
`failure`, `neutral` plus `skipped`, or `{"total_count":0,"check_runs":[]}`), and
`STUB_CHECKS_CODE` replaces the code; and a `*github.int.exe.xyz/api/v3/repos/*/pulls/*/merge)`
case that logs `say "curl pr merge"`, appends the payload to a merge log beside `pr.log` under `$FLEET_HOME`, and
prints `{"sha":"<STUB_MERGE_SHA or MERGE_SHA>","merged":true,"message":"Pull Request
successfully merged"}` then `${STUB_MERGE_CODE:-200}`. New exports: `MERGE_SHA` (`'f6'`
repeated twenty times), `mergePuts(ctx)` (the parsed lines of that merge log), `mergeArgv(ctx)` (the
curl argv whose URL ends `/merge`), `checkReads(ctx)` (the count of `CALL curl check-runs`
lines). With those defaults the existing green path (`green()`) now merges, and every pin the
three existing halves make still holds: they read named fields and named calls (`prArgv` finds
the argv ending `/pulls`, which `/pulls/1/merge` does not), and `test_sandbox_boot.mjs`'s
"the PR POST is the next curl after the branch became visible" is about the calls before the
POST. The helper's `ASSIGNMENT` (line ~88) carries no `hold=` and stays as it is. The PR
answer the stub returns (`PR_JSON`, line ~73) has `html_url` ending `/pull/1` and `number: 1`.
Documents — the sentences the Proof greps for, to be written where named: CONTRACT's
`- **status.json:**` bullet (line ~163) gains `"merged":"<40-hex or null>"` after
`"prAuthor":…`; the Boot-script bullet (line ~87) gains a sub-bullet after the re-entry one:
`- merge: after a gate-green publish the script polls GET /repos/<owner>/<repo>/commits/<head>/check-runs
every 2 s and, when every listed run is completed with success, neutral or skipped, issues one
PUT /repos/<owner>/<repo>/pulls/<n>/merge (merge_method squash, commit_title the plan's H1, sha
the head) and records the answer's sha as merged; an answer with no runs waits
MERGE_CHECKS_GRACE (120 s) and is then merged as having nothing to wait for; a failed run, 30
minutes (MERGE_CHECK_WAIT) of pending, or a refused PUT leaves the PR open with merged null;
hold=1 in the assignment skips all of it`; the `- **Publish:**` bullet (line ~168) replaces
`The human gate is the PR: ready on PASS or on the two-move rule's approval, a draft otherwise;
the operator merges or closes it.` with `The PR is ready on PASS or on the two-move rule's
approval, a draft otherwise; a ready PR the sandbox merges itself once its checks are green,
unless the assignment carries hold=1, and a draft is the operator's to merge or close.`
RUNBOOK's `**The PR.**` paragraph (line ~162) replaces `The PR is the gate: merge it, or close
it.` with `A ready PR merges itself: the sandbox polls its head's check runs and squash-merges
it once every check is green, unless the launch said --hold; a failed check, thirty minutes of
pending, or a refused merge leaves it open for you, and status.json's merged cell says which.
A draft is yours to merge or close.`; the States table's `done` row gains `; merged is the
squash commit's sha, or null when the PR was left open`; `## Trust` replaces `a pull request
rather than a merge, and a human at the merge button` with `a pull request whose merge waits
on the target's own checks, and --hold to keep a human at the merge button`. SKILL.md's step
4 (`4. **The PR is the gate.**`) replaces `The operator merges or closes the PR;` with `A ready
PR merges itself once its checks are green — status.json's merged cell is the squash commit —
and --hold on the launch line keeps it open for the operator; a draft PR is the operator's to
merge or close;`.
**BASE facts:** (generated at c32c08f)
- `publish` at `skills/ultrapowers/kernel/repo_weave.py:289` blob c9856c0
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `status` at `fleet/claude-token.mjs:287` blob 5f75f73
- `sha` at `fleet/launch.mjs:201` blob f47370d
- `merged` at `fleet/janitor.mjs:173` blob 2de1fc7
- `pr` at `fleet/janitor.mjs:245` blob 2de1fc7
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `assignment` at `fleet/janitor.mjs:218` blob 2de1fc7
- `fleet/CONTRACT.md` blob 1bf320d
- `fleet/RUNBOOK.md` blob f630c6a
- `skills/ultrapowers/SKILL.md` blob 3df41c3
- `outcome` at `fleet/janitor.mjs:299` blob 2de1fc7
- `commitStates` at `fleet/tests/_sandbox_boot_helpers.mjs:372` blob 600e712
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 600e712
- `prArgv` at `fleet/tests/_sandbox_boot_helpers.mjs:379` blob 600e712
- `ASSIGNMENT` at `fleet/tests/_sandbox_boot_helpers.mjs:88` blob 600e712
- `PR_JSON` at `fleet/tests/_sandbox_boot_helpers.mjs:73` blob 600e712
- `HEAD_SHA` at `fleet/tests/_sandbox_boot_helpers.mjs:41` blob 600e712
- `PLAN_H1` at `fleet/tests/_sandbox_boot_helpers.mjs:85` blob 600e712
- `state` at `fleet/claude-token.mjs:54` blob 5f75f73
- `PR_URL` at `fleet/tests/_sandbox_boot_helpers.mjs:46` blob 600e712
- `failed` at `fleet/run-engine.mjs:734` blob 762be27
- `error` at `evals/ab_runner.py:65` blob 7877c9d
- `notifies` at `fleet/tests/_sandbox_boot_helpers.mjs:369` blob 600e712
- `fleet/sandbox-boot.sh` blob fbe4d8d

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Legs: (a) with the rig's default answers, the green path issues at least one GET whose URL
  is exactly the check-runs URL for the helper's target and `HEAD_SHA`, carrying no `-X`, and
  exactly one curl whose argv carries `-X` then `PUT` and whose URL is exactly the merge URL
  for pull `1`; the one recorded merge payload parses to `merge_method` `squash`, `commit_title`
  equal to `PLAN_H1` and `sha` equal to `HEAD_SHA`; the final page has `state` `done`, `pr`
  `PR_URL` and `merged` equal to `MERGE_SHA`, and the log carries `merge: merged` [M1]; (b)
  for each of `success`, `neutral` and `skipped`, a `STUB_CHECKS` body of three completed
  runs whose conclusions are the three names is merged, and a body whose single run has that
  one conclusion is merged — one PUT, `merged` equal to `MERGE_SHA` [M1]; (c) with
  `STUB_CHECKS_PENDING` `2`, the check-runs read count is exactly three and the PUT follows
  the third read in the stream [M2]; (d) with `STUB_CHECKS` `{"total_count":0,"check_runs":[]}`,
  `FLEET_MERGE_CHECKS_GRACE` `1` and `FLEET_MERGE_CHECK_WAIT` `5`, the read count is exactly
  three, one PUT is issued, `merged` equals `MERGE_SHA`, and the log carries `nothing to wait
  for` [M2]; (e) for each of `failure`, `cancelled` and `timed_out`, with a `STUB_CHECKS` body whose
  one run is `completed` with that conclusion, no PUT is issued, the read count is exactly
  one, the page is `done` with `merged` null and `pr` `PR_URL`, and the log carries
  `concluded <that conclusion> — leaving` — so a completed conclusion outside the three
  green names is refused by allowlist, not by a denylist of `failure` [M1] [M2]; (f) with
  `STUB_CHECKS_PENDING` `50` and `FLEET_MERGE_CHECK_WAIT` `3`, the read count is exactly
  four, no PUT is issued, the page is `done` with `merged` null and `pr` `PR_URL`, and the
  log carries `still pending after 3s` [M2]; (g) with `STUB_MERGE_CODE` `405`, exactly one PUT is issued, the
  page is `done` with `merged` null and `pr` `PR_URL`, and the log carries `PUT answered
  405` [M2]; (m) a `STUB_CHECKS` body of two completed runs, one `success` and one
  `failure`, issues no PUT and ends `done` with `merged` null and `pr` `PR_URL` after
  exactly one read, and a body of one completed `success` beside one `in_progress` run with
  `FLEET_MERGE_CHECK_WAIT` `3` is read exactly four times, issues no PUT, and ends `done`
  with `merged` null and `pr` `PR_URL` — a green run beside a red or pending one merges
  nothing [M1] [M2]; (h) a `NEEDS_ACK` verdict with no approval issues no check-runs read and no
  PUT and ends `parked` with `merged` null [M3]; (i) the helper's assignment with ` hold=1`
  appended reaches `done` with `pr` `PR_URL`, `merged` null, one PR POST, zero check-runs
  reads, zero PUTs, and the log carries `merge: hold=1 — leaving` [M3]; (j) for each of ` hold=yes` and ` hold=0`, the helper's assignment with that appended
  exits non-zero with `state` `failed`, `assignment` in `error`, an empty `git.log` and no
  engine run, and that `failed` page has a `merged` key whose value is null [M3] [M4]; (k) on the green path every evidence
  commit's snapshot has a `merged` key — null on the `running` and `publishing` snapshots and
  `MERGE_SHA` on the last — and the parked page and the hold page each have a `merged` key
  whose value is null, `commitStates` is exactly `running`, `publishing`, `done`, and
  `notifies` is exactly one `{ title: 'run-7 done', message: '<target> — <pr>' }` [M4]; (l)
  `bash -n` accepts the script and the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3] [M4].
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the green-path sim, whose commit-list, notification, curl-order and
  re-entry pins hold with the merge step beside them [M4].
- Run: node fleet/tests/test_sandbox_boot_edges.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the edges sim: the retired-name scan over the script and its three
  rig files, and the re-entry cases, hold [M4].
- Run: node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the approved-run sim, whose parked and done pins hold [M3].
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet reads the done phase for the PR URL followed by the approval words,
  which the merge outcome is appended after [M4].
- Run: node fleet/tests/test_sandbox_boot_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the effort sim, whose engine-argv equality holds with the new key
  parsed beside the old ones [M3].
- Run: grep -A2 '^- \*\*status.json:\*\*' fleet/CONTRACT.md | tr '\n' ' ' | grep -q '"prAuthor":"<GitHub login or null>","merged":"<40-hex or null>"'
- The previous bullet reads only the contract's status.json bullet and its continuation
  lines and pins the new cell directly after `prAuthor` [M5].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'commits/<head>/check-runs.*pulls/<n>/merge.*hold=1'
- The previous bullet reads only the Boot-script bullet, from its opening to the status.json
  bullet, and pins the read, the PUT and the hold key in order [M5].
- Run: sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'sandbox merges itself once its checks are green, unless the assignment carries.*hold=1'
- The previous bullet reads only the Publish bullet and pins its new sentence's operative
  halves [M5].
- Run: sed -n '/^\*\*The PR\.\*\*/,/^\*\*Reap\.\*\*/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'A ready PR merges itself.*once every check is green, unless the launch said.*--hold'
- The previous bullet reads only the RUNBOOK's "The PR." paragraph [M6].
- Run: grep '^| .done. |' fleet/RUNBOOK.md | grep -q 'merged is the squash commit'
- The previous bullet reads only the States table's done row [M6].
- Run: sed -n '/^## Trust/,/^## Rollback/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'merge waits on the target.s own checks, and.*--hold.*to keep a human at the merge button'
- The previous bullet reads only the Trust section [M6].
- Run: ! sed -n '/^## Trust/,/^## Rollback/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'a pull request rather than a merge'
- The previous bullet is the Trust section's old sentence, gone [M6].
- Run: sed -n '/^4\. \*\*The PR is the gate/,/^5\. \*\*Reap/p' skills/ultrapowers/SKILL.md | tr '\n' ' ' | grep -q 'A ready PR merges itself once its checks are green.*--hold.*on the launch line keeps it open'
- The previous bullet reads only SKILL.md's step 4 [M7].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents [M5] [M6] [M7].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #660

### Task 2: --hold on the launch line rides the assignment as hold=1

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `fleet/tests/test_launch_effort.mjs`
- Modify: `fleet/tests/test_launch_toolchain.mjs`
- Test: `fleet/tests/test_launch_hold.mjs`

**Claim:** `launch.mjs --hold` → comment key `hold=1` → the sandbox publishes and never merges
(measurement runs, the walk A/B). (quoted from #660)
Machine: M1. `node fleet/launch.mjs … --hold` writes `hold=1` as the last key of the
assignment comment — after `effort=<v>` when `--implementer-effort` is given, after
`tier=<v>` when only `--tier` is, and directly after `engine=<sha>` when neither is; without
the flag the comment is byte-identical to BASE's for the same launch; `COMMENT_KEYS` in
`fleet/lobby.mjs` is exactly `run, plan, target, base, engine, overlap, tier, effort, hold`;
and the launcher's usage string names `[--hold]`. M2. A `--hold=<value>` spelling is a
refusal naming the bare flag, made before the plan file is read and before any command is
issued. M3. `fleet/CONTRACT.md`'s Comment sentence
lists `hold=1` as the fourth optional key, directly after `effort=low|medium|high`;
`fleet/RUNBOOK.md`'s per-run flags paragraph and `skills/ultrapowers/SKILL.md`'s step 2 each
say `--hold` keeps the PR open for a person. M4. The two existing sims that pin the comment
keys and the usage flags — `test_launch_effort.mjs` and `test_launch_toolchain.mjs` — stay
green, and each spells the new name inside the list it pins.

**Authorized-by:** #660 (decided 2026-09-05, item (2): "`launch.mjs --hold` → comment key
`hold=1` → the sandbox publishes and never merges (measurement runs, the walk A/B)").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The shared literal with the boot script's task: the comment's optional last key
is `hold=1`, exactly that spelling, and the boot script accepts no other value. The comment is
the only channel from the laptop to the sandbox (`fleet/CONTRACT.md` line ~44: five required
keys, then optional `overlap=fold|serialize`, `tier=standard|mostCapable`,
`effort=low|medium|high`, at most 200 bytes). `buildComment` in `fleet/lobby.mjs` (line ~436)
emits `COMMENT_KEYS` (line ~427, eight names ending `effort`) in order, skipping empty ones;
`parseComment` keeps unknown keys, so the janitor needs no change. `fleet/launch.mjs` parses
with `parseArgs(argv, { flags: ['json'] })` (line ~230; a name in `flags` takes no value and
becomes `true`, a `--name=value` spelling becomes the string after `=`), validates the
enumerated flags at lines ~246–255 with a `Refusal` naming the values, builds `fields = { run,
plan, target, base, engine, overlap, tier, effort: implementerEffort }` at line ~290 for the
byte-ceiling probe and again at line ~379 for the real comment, and declares every flag in
`USAGE` (line ~91), which `tests/test_docs_agree_with_code.py` reads. `main` (line ~524) parses
with the same `flags` list. So `--hold` joins the `flags` list in both places, `fields.hold` is
`'1'` when `opts.hold === true` and undefined otherwise, and a string `opts.hold` (the
`--hold=<value>` spelling) is a `Refusal` reading `launch: --hold takes no value`. The
existing pins to keep green and to move: `fleet/tests/test_launch.mjs` asserts the comment
`run=1 plan=… target=… base=… engine=… overlap=fold tier=mostCapable` for a launch without
the new flag and `renderLaunch` at exactly four lines; `fleet/tests/test_launch_effort.mjs`
asserts at lines ~255–263 that `COMMENT_KEYS` ends with `effort` and that the keys before it
are BASE's seven — those two assertions become one `deepEqual` of `[...COMMENT_KEYS]` against
the nine names in order; `fleet/tests/test_launch_toolchain.mjs`'s usage-flags case (line ~281) pins the
sorted set of flags in `USAGE` as `BASE_FLAGS`, which gains `'--hold'` between `'--engine'`
and `'--implementer-effort'`. The rig for the new sim is `test_launch_effort.mjs`'s: a
`workspace()` with `makeTargetRepo`, `readRules` over `makeExec`, `launchIn`, `newLines`.
Documents — the sentences the Proof greps for: CONTRACT's `- **Comment**` bullet (line ~44)
lists the optional keys as `overlap=fold|serialize`, `tier=standard|mostCapable`,
`effort=low|medium|high`, `hold=1` (each backticked, in that order). RUNBOOK's per-run flags
paragraph — the one beginning `` `--engine <sha>` pins the engine `` (line ~149) — gains the
sentence `--hold keeps the pull request open for a person: the sandbox publishes it and does
not merge it (a measurement run).` SKILL.md's step 2 (`2. **Launch.** One line:`) gains,
after the paragraph that follows its code block, the sentence `Add --hold to that line when
the PR should stay open for a person — a measurement run; the sandbox then publishes and does
not merge.` — as prose, never as a second `node …fleet/launch.mjs` line, since
`tests/test_docs_agree_with_code.py` requires exactly one such line in SKILL.md.
**BASE facts:** (generated at c32c08f)
- `COMMENT_KEYS` at `fleet/lobby.mjs:427` blob 4455604
- `fleet/lobby.mjs` blob 4455604
- `fleet/CONTRACT.md` blob 1bf320d
- `fleet/RUNBOOK.md` blob f630c6a
- `skills/ultrapowers/SKILL.md` blob 3df41c3
- `buildComment` at `fleet/lobby.mjs:437` blob 4455604
- `effort` at `fleet/tests/test_run_main_effort.mjs:162` blob b35e8ad
- `parseComment` at `fleet/lobby.mjs:445` blob 4455604
- `fleet/launch.mjs` blob f47370d
- `Refusal` at `fleet/lobby.mjs:261` blob 4455604
- `USAGE` at `fleet/janitor.mjs:76` blob 2de1fc7
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `renderLaunch` at `fleet/launch.mjs:516` blob f47370d
- `fleet/tests/test_launch_effort.mjs` blob 3e8c111
- `fleet/tests/test_launch_toolchain.mjs` blob 25c8f11
- `BASE_FLAGS` at `fleet/tests/test_launch_toolchain.mjs:282` blob 25c8f11
- `makeTargetRepo` at `fleet/tests/_lobby_helpers.mjs:135` blob 86c4674
- `readRules` at `fleet/tests/test_launch.mjs:113` blob 9faf40b
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `launchIn` at `fleet/tests/test_launch.mjs:159` blob 9faf40b
- `newLines` at `fleet/tests/test_launch.mjs:173` blob 9faf40b
- `git` at `fleet/lobby.mjs:252` blob 4455604

**Proof:**
- Test: `fleet/tests/test_launch_hold.mjs`
- Legs: (a) a green launch with `--hold`, `--tier mostCapable` and `--implementer-effort
  low` yields a comment ending `tier=mostCapable effort=low hold=1`; one with `--hold` and
  `--tier mostCapable` and no effort flag yields a comment ending `tier=mostCapable hold=1`;
  one with `--hold` and neither yields a comment equal to the five required keys then
  ` hold=1`; and in each the `new` line carries that comment quoted once and under 200 bytes
  [M1]; (b) a launch without `--hold` yields a comment byte-equal to
  `run=1 plan=<sha> target=<t> base=<base> engine=<engine> overlap=fold tier=mostCapable`
  for the flags `--overlap fold --tier mostCapable`, with no `hold=` in it [M1]; (c)
  `[...COMMENT_KEYS]` deep-equals the nine names in order, and `USAGE` contains `[--hold]`
  [M1]; (d) a launch with `--hold=1` and a plan path that does not exist throws a `Refusal`
  whose message contains `--hold takes no value` and not `cannot read plan`, and the seam's
  `exec.calls` is exactly empty — no `git`, no `ssh`, nothing [M2]; (e) the sim prints `ALL
  TESTS PASSED`.
- Run: node fleet/tests/test_launch_hold.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing launch sim, whose no-flag comment pin and four-line
  render pin hold [M1].
- Run: node fleet/tests/test_launch_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the effort sim, now pinning the nine keys [M4].
- Run: node fleet/tests/test_launch_toolchain.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the toolchain sim, whose flag set now carries the new flag [M4].
- Run: grep -q "'hold'" fleet/tests/test_launch_effort.mjs
- The previous bullet finds the new key's name, quoted, inside the effort sim [M4].
- Run: grep -q "'--hold'" fleet/tests/test_launch_toolchain.mjs
- The previous bullet finds the new flag, quoted, inside the toolchain sim's flag list [M4].
- Run: node fleet/tests/test_launch_engine_source.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the engine-source sim, untouched by the flag [M1].
- Run: node fleet/tests/test_lobby.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the lobby sim [M1].
- Run: grep -A3 '^- \*\*Comment\*\*' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'effort=low|medium|high., .hold=1'
- The previous bullet reads only the contract's Comment bullet and its three continuation
  lines, wraps joined, and pins the new key directly after `effort=` (the dots stand for the
  backticks around each key, which a Run: command may not carry) [M3].
- Run: sed -n '/^.--engine <sha>. pins the engine/,/^\*\*Watch/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q -- '--hold.\{0,1\} keeps the pull request open for a person'
- The previous bullet reads only the RUNBOOK's per-run flags paragraph [M3].
- Run: sed -n '/^2\. \*\*Launch/,/^3\. \*\*Walk away/p' skills/ultrapowers/SKILL.md | tr '\n' ' ' | grep -q 'Add .\{0,1\}--hold.\{0,1\} to that line when the PR should stay open for a person'
- The previous bullet reads only SKILL.md's step 2 [M3].
- Run: test "$(grep -c '^ *node .*fleet/launch.mjs' skills/ultrapowers/SKILL.md)" = 1
- The previous bullet counts SKILL.md's launch lines — lines beginning with the word node
  and naming the launcher — and pins one, so the hold sentence was written as prose and not
  as a second launch line [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents, which reads the
  launcher's usage string against SKILL.md's one launch line [M1] [M3].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`
- path-absent: `fleet/tests/test_launch_effort.mjs`
- issue-closed: #660

### Task 3: The janitor keeps only the reap, and the launcher runs it

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/tests/test_janitor_automerge.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/first-run.md`
- Test: `fleet/tests/test_janitor_reap_only.mjs`
- Test: `fleet/tests/test_launch_reaps.mjs`

**Claim:** The janitor keeps only `rm` of VMs an hour past done; `launch.mjs` runs it before
every launch, and the client runs it by hand after a sleep. (quoted from #660)
Machine: M1. For a `done` run whose status page carries a `pr` URL the janitor issues no
`gh pr` command of any kind — its only `gh` commands are `gh api` reads — and every action it
records has `kind` `rm`; a `done` run updated two hours ago is removed and one updated ten
minutes ago is not; `--dry-run` issues no `rm`; and the module exports no `PR_VIEW_JSON`. M2.
`fleet/tests/test_janitor_automerge.mjs` is absent. M3. `launch()` runs `janitor({ exec,
config, now })` — no `--dry-run` — after the pool read and before the `git ls-remote` that
computes the run number: for a fleet with a `done` VM two hours old and one ten minutes old,
exactly one `rm <old vm> --json` is issued, after the `billing plan --json` verb, before that
`ls-remote` and before `new`, the
result's `reaped` is `[<old vm>]` and its `reapError` is null; when the fleet listing verb
answers non-zero, no `rm` is issued, `reapError` is a non-empty string, and the launch still
completes with one `new`; `renderLaunch` prints one `reaped <vm>` line per name after the
comment, and no such line when nothing was reaped. M4. `skills/ultrapowers/SKILL.md`'s step 5
says the launcher runs the janitor before every launch and that nothing schedules it;
`fleet/RUNBOOK.md`'s Reap paragraph says the same and no longer says `arms auto-merge`;
`fleet/CONTRACT.md`'s Janitor bullet says it is run by the launcher and merges nothing, and
its Launch-order bullet names the reap before the run-number read; and the word `cron` appears
in none of `fleet/RUNBOOK.md`, `skills/ultrapowers/SKILL.md` and
`skills/ultrapowers/references/first-run.md`.

**Authorized-by:** #660 (decided 2026-09-05, item (3): "The janitor keeps only `rm` of VMs an
hour past done; `launch.mjs` runs it before every launch, and the client runs it by hand after
a sleep"; and "#655's laptop-side arming is deleted with (1)").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `fleet/janitor.mjs` at BASE: the arming is `PR_VIEW_JSON` (line ~87),
`CLEAN_STATUS`, `outputOf`, `lastNonEmptyLine`, `viewPr` (line ~140), `isArmable`,
`armAutoMerge` (line ~164), the `auto-merge` push inside the row loop (lines ~243–255), the
`if (action.kind === 'auto-merge')` branch of the mutation loop (line ~288), and
`renderAction`'s auto-merge line (line ~298) — all deleted, with the header comment's
auto-merge paragraph (lines ~33–48). What stays is the shape `fleet/tests/test_janitor.mjs`
pins: `listVms`, `assignmentOf`, `readEvidence`, `planCommittedAt`, the `rm` action `{ kind:
'rm', vm, run, state, updatedAt, command, applied }`, `stale`, `unknown`, `--dry-run`, and
`renderJanitor`. `fleet/tests/test_janitor_automerge.mjs` — the sim of #655's arming, whose
M5 pins the RUNBOOK sentence `arms auto-merge` — is deleted outright (`git rm`); the fleet
bridge `tests/test_fleet_suite.py` globs `fleet/tests/test_*.mjs`, so a name that leaves the
directory drops out of the list. The new janitor sim's rig is `test_janitor.mjs`'s: `makeExec`
from `_lobby_helpers.mjs` with `sshRule('ls ', …)` answering `vmsPayload(rows)`, `sshRule('rm
', answer(''))`, `cmdRule('gh', 'api', …)` answering the contents envelope (base64 `content`)
for `repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`,
`exec.calls` for what was issued, `exec.mutating()` for the lobby's mutating verbs. In
`fleet/launch.mjs`, the reap goes between the capacity refusal (line ~340, `readPlanCapacity`)
and `const run = opts.run ? Number(opts.run) : await highestRunOnTarget(exec, repoDir) + 1`
(line ~352): `import { janitor } from './janitor.mjs'`, then `await janitor({ argv: [], exec,
config: settings, now })` inside a try — `settings` is the config already loaded at line ~260,
so the file is read once — recording `reaped` (the `vm` of every action whose `kind` is `rm`
and `applied` is true) and `reapError` (null, or the thrown error's message; `listVms` throws
a `LobbyError` when `ls 'fleet-r*' --json` answers non-zero) on the result object at line
~413, whose keys `test_launch.mjs`'s result-keys case checks with `key in result` (an added key breaks
nothing). `renderLaunch` (line ~516) is pinned by that sim at exactly four lines for a launch
where nothing was reaped, so the `reaped <vm>` lines are appended only when `reaped` is
non-empty. In every existing launch sim the seam answers an unmatched `ssh` with empty stdout,
which `listVms` reads as no rows, so those sims see no `rm`. The new launch sim's rig is
`test_launch.mjs`'s (lines ~40–175): `workspace()` over `makeTargetRepo`, `readRules({ repo })`
with `localRemote` running the launcher's own `ls-remote` and `push` against the bare origin,
`launchIn`, `newLines`, and `exec.calls` — to which the sim adds `sshRule('ls ', …)` answering
two `vmRow`s whose `comment`s carry `run=` and `target=`, a `cmdRule('gh', 'api', …)`
answering each run's status page, and `sshRule('rm ', answer(''))`; the order leg reads the
index of the `rm` call, of the `git … ls-remote … refs/heads/ultra/*` call and of the `new`
call in `exec.calls`. Documents — the sentences the Proof greps for: SKILL.md's step 5
(`5. **Reap.**`) becomes `` `node <plugin-root>/fleet/janitor.mjs` removes the VMs of runs
that finished over an hour ago, and reports the stale ones rather than removing them. The
launcher runs it before every launch; nothing schedules it, and the agent runs it by hand
when this machine has been asleep. ``; RUNBOOK's `**Reap.**` paragraph (the one beginning `It lists
the fleet, reads each VM's comment`, line ~182) loses its four arming sentences (`It also arms
auto-merge …` through `… the plain squash follows.`) and replaces `Run it from cron every five
minutes, or by hand.` with `The launcher runs it before every launch; nothing schedules it.
Run it by hand after a sleep.`; RUNBOOK's key paragraph (line ~54, `A second key, tag-scoped …`)
replaces `Put the janitor's cron behind it.` with `That is the key for a machine that only
reaps by hand.`; first-run.md's exe-dev bullet (line ~39) replaces `that is the one to put
behind the janitor's cron, never the one that launches` with `that is the one for a machine
that only reaps by hand, never the one that launches`; CONTRACT's `- **Janitor** ` bullet
(line ~177) gains, after `No ssh into any VM, no created_at, no clone.`, the sentence `Run by
fleet/launch.mjs before every launch and by hand after a sleep; nothing schedules it, and the
janitor merges nothing — the sandbox merges its own PR.`; CONTRACT's `- **Launch order**`
bullet (line ~50) gains `→ run the janitor (fleet/janitor.mjs, the reap)` directly before
`→ git ls-remote the target's ultra/*-run-* for N`.
**BASE facts:** (generated at c32c08f)
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `pr` at `fleet/janitor.mjs:245` blob 2de1fc7
- `kind` at `fleet/lobby.mjs:399` blob 4455604
- `PR_VIEW_JSON` at `fleet/janitor.mjs:87` blob 2de1fc7
- `fleet/tests/test_janitor_automerge.mjs` blob b983c28
- `renderLaunch` at `fleet/launch.mjs:516` blob f47370d
- `skills/ultrapowers/SKILL.md` blob 3df41c3
- `fleet/RUNBOOK.md` blob f630c6a
- `fleet/CONTRACT.md` blob 1bf320d
- `skills/ultrapowers/references/first-run.md` blob a042dcd
- `fleet/janitor.mjs` blob 2de1fc7
- `CLEAN_STATUS` at `fleet/janitor.mjs:89` blob 2de1fc7
- `outputOf` at `fleet/janitor.mjs:92` blob 2de1fc7
- `lastNonEmptyLine` at `fleet/janitor.mjs:95` blob 2de1fc7
- `viewPr` at `fleet/janitor.mjs:140` blob 2de1fc7
- `isArmable` at `fleet/janitor.mjs:151` blob 2de1fc7
- `armAutoMerge` at `fleet/janitor.mjs:164` blob 2de1fc7
- `renderAction` at `fleet/janitor.mjs:296` blob 2de1fc7
- `fleet/tests/test_janitor.mjs` blob 7fa3cd3
- `listVms` at `fleet/lobby.mjs:367` blob 4455604
- `assignmentOf` at `fleet/janitor.mjs:188` blob 2de1fc7
- `readEvidence` at `fleet/janitor.mjs:116` blob 2de1fc7
- `planCommittedAt` at `fleet/janitor.mjs:129` blob 2de1fc7
- `renderJanitor` at `fleet/janitor.mjs:305` blob 2de1fc7
- `tests/test_fleet_suite.py` blob d2ac604
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `fleet/launch.mjs` blob f47370d
- `readPlanCapacity` at `fleet/lobby.mjs:504` blob 4455604
- `vm` at `fleet/launch.mjs:388` blob f47370d
- `applied` at `fleet/run-engine.mjs:1552` blob 762be27
- `LobbyError` at `fleet/lobby.mjs:274` blob 4455604
- `makeTargetRepo` at `fleet/tests/_lobby_helpers.mjs:135` blob 86c4674
- `localRemote` at `fleet/tests/test_launch.mjs:90` blob 9faf40b
- `push` at `fleet/launch.mjs:371` blob f47370d
- `launchIn` at `fleet/tests/test_launch.mjs:159` blob 9faf40b
- `newLines` at `fleet/tests/test_launch.mjs:173` blob 9faf40b
- `vmRow` at `fleet/tests/_lobby_helpers.mjs:55` blob 86c4674
- `comment` at `fleet/launch.mjs:379` blob f47370d
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `git` at `fleet/lobby.mjs:252` blob 4455604
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674

**Proof:**
- Test: `fleet/tests/test_janitor_reap_only.mjs`
- Test: `fleet/tests/test_launch_reaps.mjs`
- Legs: (a) a fleet of two `done` runs, each with a `pr` URL, one updated two hours ago and
  one ten minutes ago: `exec.calls` filtered to `cmd` `gh` whose first argv word is `pr` is
  exactly empty, every `gh` call's argv is exactly two words — `api` and a path beginning
  `repos/` — so no `gh` call carries `-X`, `--method`, `-f`, `-F`, `--input` or any flag,
  every recorded action has `kind` `rm`, the mutating lobby verbs are exactly one `rm <old vm> --json`, and the young run's VM
  is in no action; the same fleet under `--dry-run` issues no `rm`; and `Object.keys` of the
  janitor module does not contain `PR_VIEW_JSON` [M1]; (b) `fs.existsSync` of
  `fleet/tests/test_janitor_automerge.mjs` is false [M2]; (c) a green launch over a fleet
  listing of a `done` VM two hours old and a `done` VM ten minutes old issues exactly one
  `rm <old vm> --json`, whose index in `exec.calls` is above the index of the lobby verb
  `billing plan --json`, below the index of the `git` call carrying `ls-remote` and
  `refs/heads/ultra/*`, and below the index of the `new` line; the
  result's `reaped` deep-equals `[<old vm>]` and `reapError` is null; `renderLaunch` of that
  result is the four BASE lines followed by `reaped <old vm>`; a launch whose `ls 'fleet-r*'
  --json` rule answers exit 1 issues no `rm`, has `reapError` a non-empty string, `reaped`
  `[]`, still issues exactly one `new`, and `renderLaunch` of it is exactly the four BASE
  lines [M3]; (d) both sims print `ALL TESTS PASSED`.
- Run: node fleet/tests/test_janitor_reap_only.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the janitor sim's sentinel [M1].
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launch sim's sentinel [M3].
- Run: test ! -e fleet/tests/test_janitor_automerge.mjs
- The previous bullet is the deleted sim [M2].
- Run: ! grep -q 'auto-merge\|PR_VIEW_JSON\|gh pr' fleet/janitor.mjs
- The previous bullet is the arming's vocabulary, gone from the source [M1].
- Run: node fleet/tests/test_janitor.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing expiry sim, whose reap, dry-run and no-git pins hold
  [M1].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing launch sim, whose one-`new`, refusal and four-line
  render pins hold with the reap running over an empty listing [M3].
- Run: sed -n '/^5\. \*\*Reap/,/^## Resources/p' skills/ultrapowers/SKILL.md | tr '\n' ' ' | grep -q 'The launcher runs it before every launch; nothing schedules it'
- The previous bullet reads only SKILL.md's step 5 [M4].
- Run: sed -n '/^\*\*Reap\.\*\*/,/^## States/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'The launcher runs it before every launch; nothing schedules it'
- The previous bullet reads only the RUNBOOK's Reap section [M4].
- Run: ! grep -q 'arms auto-merge' fleet/RUNBOOK.md
- The previous bullet is the arming sentence, gone from the RUNBOOK [M4].
- Run: grep -A5 '^- \*\*Janitor' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'Run by.*fleet/launch.mjs.*before every launch.*the janitor merges nothing'
- The previous bullet reads only the contract's Janitor bullet and its continuation lines
  [M4].
- Run: sed -n '/^- \*\*Launch order/,/^- \*\*Setup script/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'run the janitor.*fleet/janitor.mjs.*the reap.*ls-remote'
- The previous bullet reads only the contract's Launch-order bullet and pins the reap before
  the run-number read [M4].
- Run: ! grep -q -i 'cron' fleet/RUNBOOK.md skills/ultrapowers/SKILL.md skills/ultrapowers/references/first-run.md
- The previous bullet is the word, absent from all three documents [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents, which checks that
  every fleet script a document names exists [M4].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #660

### Task 4: The doctor names the keys in fleet.json that nothing reads

**Type:** implementation

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `skills/ultrapowers/references/first-run.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `fleet/tests/test_doctor_config_keys.mjs`

**Claim:** the doctor's `capacity` row names unknown keys as stale and says which two it reads
(a `fix` pointing at first-run.md §capacity), and the first-run walk writes
`{"cpu":"8","memory":"16GB"}` explicitly rather than relying on defaults. (quoted from #668)
Machine: M1. `fleet/doctor.mjs` exports `fleetConfigKeys({ path })`, which answers the
config file's top-level key names in file order, or null when the file is absent or not a
JSON object, and `doctor()` takes a `configKeys` option: when it names a key other than `cpu`
or `memory`, the `capacity` row is `missing`, its `detail` names every such key and says it
reads `cpu` and `memory` only, and its `fix` is `capacity`; when it names only those two, or
is null, or is not given, the row is what BASE answers for the same pool and config. M2. When
`configKeys` is a list that lacks `cpu` or lacks `memory`, the `ok` row's detail names each
lacking key as taking its default. M3. The CLI reads the keys off the same file `--config` (or
`~/.ultrapowers/fleet.json`) names: with a file carrying two stale keys it exits 1 and prints
the capacity row as `missing` under a green shim; with `{"cpu":"8","memory":"16GB"}` it exits
0 and `ready`. M4. `skills/ultrapowers/references/first-run.md`'s `## capacity` section says
the agent writes the file with both keys explicitly, spells `{"cpu":"8","memory":"16GB"}`,
and says a key the doctor does not read turns the row red; `skills/ultrapowers/SKILL.md`'s
capacity paragraph in `## Setup` says a red row naming keys nothing reads is repaired by
rewriting the file with `cpu` and `memory` only, with no question asked. M5. `ROW_IDS` and
`first-run.md`'s headings are unchanged, and `test_doctor.mjs` stays green.

**Authorized-by:** #668 ("Fix: the doctor's `capacity` row names unknown keys as stale and
says which two it reads (a `fix` pointing at first-run.md §capacity), and the first-run walk
writes `{"cpu":"8","memory":"16GB"}` explicitly rather than relying on defaults").

**Interfaces:**
- Consumes: none
- Produces: `fleetConfigKeys({ path }) -> string[] | null`

**Context:** `fleet/doctor.mjs` imports only `node:`-prefixed specifiers and no other fleet
module (the contract's rule; `test_doctor.mjs` pins it). `loadFleetConfig` (line ~118) copies
only `DOCTOR_DEFAULTS`'s two keys out of the parsed file, and `doctor({ config, exec, target })`
(line ~410) spreads that over the defaults into `cfg`, which is echoed as `result.config` —
`test_doctor.mjs` pins `result.config` and the CLI's `.config` as exactly `{ cpu, memory }`,
so the file's other keys travel on a separate option, `configKeys`, and never into `config`.
`capacityRow(res, config)` (line ~174) builds the row; its signature gains the keys. `main`
(line ~465) reads `loadFleetConfig({ path })` and passes `config` — it also reads
`fleetConfigKeys({ path })` off the same path and passes `configKeys`. The red detail's shape:
`~/.ultrapowers/fleet.json carries <k1>, <k2> — keys nothing reads; it reads cpu and memory
only`, followed by the pool sentence BASE would have produced; the ok detail with a lacking
key appends ` (cpu not in ~/.ultrapowers/fleet.json — the default 8)` per lacking key, in the
words the sim reads for. A stale key's name is echoed from the file, so no retired name is
spelled in the source (the boot sims scan `fleet/` sources for the retired state
repository's name in three casings, and `tests/test_docs_agree_with_code.py` refuses that
name in the four operator documents — first-run.md describes such a key as one "left by a
fleet from before the lift" and names none). `renderRows` (line ~456) prints the `fix` line
`→ references/first-run.md §capacity` for a `missing` row. The CLI rig is `test_doctor.mjs`'s
section 6b (lines ~520–560): `shimDir(name, { ssh, node })` writes a PATH directory whose `ssh`
answers `whoami`, `billing plan --json` (`{ max_cpus: 16, max_memory_gb: 64, tier: 'XLarge',
plan: 'team' }`), `integrations list --json` (the green catalog) and `integrations setup
github --list`, and whose other binaries exit 127; `runCli(args, { dir, home })` spawns
`process.execPath` on `fleet/doctor.mjs` with that PATH; the sim copies that rig rather than
importing it (nothing in `test_doctor.mjs` is exported). The existing pins to keep green:
`test_doctor.mjs` section 6b's partial config `{ cpu: '4', nonsense: 'ignored' }` reads back
`.config` as `{ cpu: '4', memory: '16GB' }` and asserts nothing about the row's status, and
its absent-config run is `ready` with exit 0. The sim's stale fixture uses the keys `golden`
and `stateRepo` — neither is a retired literal any scan refuses. Documents — the sentences the
Proof greps for: first-run.md's `## capacity` section replaces `The file has exactly two keys,
both optional, and these are also the defaults:` with `The agent writes the file with both
keys explicitly — these are also the defaults, and a key the doctor does not read (one left by
a fleet from before the lift) turns the row red until it is removed:` keeping the JSON block
that follows, and its bullet `An unknown key in the file is ignored, and a missing file means
the defaults.` becomes `A missing file means the defaults; a key the doctor does not read is
named in the red detail, and the agent rewrites the file with cpu and memory only.` SKILL.md's
capacity paragraph (the one beginning `` `capacity` — the pool the account's plan allows ``)
gains, before the AskUserQuestion sentence, `When the detail names keys nothing reads, the
agent rewrites the file with cpu and memory only, keeping any size it already carried, and
re-runs the doctor — no question is asked.`
**BASE facts:** (generated at c32c08f)
- `capacity` at `fleet/launch.mjs:340` blob f47370d
- `fix` at `fleet/tests/test_roles_peer.mjs:48` blob 4847687
- `fleet/doctor.mjs` blob 7e35dcd
- `cpu` at `fleet/launch.mjs:261` blob f47370d
- `memory` at `fleet/launch.mjs:262` blob f47370d
- `missing` at `fleet/target.mjs:128` blob c189a05
- `detail` at `fleet/run-engine.mjs:1288` blob 762be27
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob 3a21313
- `skills/ultrapowers/references/first-run.md` blob a042dcd
- `skills/ultrapowers/SKILL.md` blob 3df41c3
- `ROW_IDS` at `fleet/doctor.mjs:57` blob 7e35dcd
- `loadFleetConfig` at `fleet/doctor.mjs:118` blob 7e35dcd
- `DOCTOR_DEFAULTS` at `fleet/doctor.mjs:53` blob 7e35dcd
- `cfg` at `fleet/doctor.mjs:411` blob 7e35dcd
- `config` at `fleet/doctor.mjs:120` blob 7e35dcd
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `renderRows` at `fleet/doctor.mjs:456` blob 7e35dcd
- `whoami` at `fleet/doctor.mjs:418` blob 7e35dcd
- `status` at `fleet/claude-token.mjs:287` blob 5f75f73
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `fleet/tests/test_doctor.mjs` blob 130b27c

**Proof:**
- Test: `fleet/tests/test_doctor_config_keys.mjs`
- Legs: (a) a temp file holding `{"golden":"x","stateRepo":"y"}`: `fleetConfigKeys` answers
  `['golden', 'stateRepo']`; `doctor({ config, exec, target: null, configKeys })` with a green
  exec answers a `capacity` row whose `status` is `missing`, whose `detail` contains
  `golden`, `stateRepo`, `keys nothing reads` and `reads cpu and memory only`, and whose `fix`
  is `capacity`; a file holding `{"cpu":"8","memory":"16GB","golden":"x"}` — both read keys
  present beside one stale key — answers a `missing` row whose detail contains `golden` and
  not `cpu,`; with `configKeys` `['cpu', 'memory']`, with null, and with the option not
  given, the row's `status` is `ok` and its `detail` equals BASE's `XLarge pool 16 vCPU / 64GB
  fits 2 runs of 8 vCPU / 16GB`; `fleetConfigKeys` of an absent path is null and of a file
  holding `[1,2]` is null [M1]; (b) with `configKeys` `['memory']` the row is `ok` and its
  detail contains `cpu not in` and `the default 8`; with `['cpu']` it contains `memory not
  in` and `the default 16GB` [M2]; (c) under the green shim, `--json --config <stale file>`
  exits 1 with the printed `capacity` row `missing` and `verdict` `not-ready`, and `--json
  --config <file holding {"cpu":"8","memory":"16GB"}>` exits 0 with `verdict` `ready` and
  `.config` equal to `{ cpu: '8', memory: '16GB' }` [M3]; (d) the sim prints `ALL TESTS
  PASSED`.
- Run: node fleet/tests/test_doctor_config_keys.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3].
- Run: node fleet/tests/test_doctor.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing doctor sim: `ROW_IDS`, the two-key config echo, the
  node:-only imports and the CLI pins hold [M5].
- Run: sed -n '/^## capacity/,/^## claude/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'The agent writes the file with both keys explicitly.*"cpu": "8",.*"memory": "16GB".*a key the doctor does not read is named in the red detail'
- The previous bullet reads only first-run.md's capacity section and pins the explicit write,
  the two keys and the red-detail sentence in order [M4].
- Run: sed -n '/^.capacity. — the pool/,/^.claude. — the token/p' skills/ultrapowers/SKILL.md | tr '\n' ' ' | grep -q 'rewrites the file with .\{0,1\}cpu.\{0,1\} and .\{0,1\}memory.\{0,1\} only.*no question is asked'
- The previous bullet reads only SKILL.md's capacity paragraph in the Setup section (the dots
  stand for the backticks around the row ids) [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin: `ROW_IDS` against first-run.md's headings, and
  no retired name in the four documents [M5].

**Stale-if:**
- path-absent: `fleet/doctor.mjs`
- path-absent: `fleet/tests/test_doctor.mjs`
- issue-closed: #668
