# Self-merge residuals get a sink

**Grammar:** claims-v1

**Claim:** The sandbox writes every `deferred:external` ack and every non-blocking reviewer/critic finding into the PR body as a checklist, and files one follow-up issue per run (`watch-item`, the plan's program label) titled for the run, listing the same items with their evidence sentences — the inverse of the `**Closes:**` machinery. (quoted from #711)

**Goal:** #711 — since 0.3.17 a run merges itself, so the two-move rule's pre-authorized
`deferred:external` acks and the reviewers' and critic's non-blocking findings land nowhere a
person looks next. After this run the PR body carries a `### Residuals` checklist of exactly
those items, read off the run's own record (`gate-receipt.json`, `report.json`), and the sandbox
files one follow-up issue per run over the same REST edge the PR uses, labelled `watch-item`
plus the program label(s) of the plan's `**Closes:**` tickets, listing the same lines. A run
with no residual writes no section and files no issue. Self-merge stays the default; nothing
holds.
**Closes:** #711

**Tech Stack:** POSIX shell (`fleet/sandbox-boot.sh`, run by `bash` on Ubuntu; `python3` is on
every sandbox and is what the script already uses for JSON documents; `node` and `gh` are never
called by it); GitHub REST through the edge (`https://$GITHUB_INT_HOST/api/v3/repos/<owner>/<repo>/…`
via `fleet_curl`); the boot sims (`fleet/tests/test_sandbox_boot*.mjs` on the rig
`fleet/tests/_sandbox_boot_helpers.mjs`, `node:test`-free `test()` list run by `runTests`,
sentinel `ALL TESTS PASSED`); `fleet/CONTRACT.md` as the authority for every literal.

**Parallelization rationale:** wave 1 is two tasks wide — Task 1 (the reader, the PR-body
section and the rig's two record knobs) and Task 3 (the contract prose, which touches only
`fleet/CONTRACT.md`). Wave 2 is Task 2 alone, a chain of one behind Task 1 because it needs
Task 1's runtime behaviour, not its shape: the issue body must carry byte-for-byte the lines
`residual_items` printed into the PR body, and its exam boots the rig with the
`STUB_GATE_RECEIPT`/`STUB_REPORT` knobs that only exist once Task 1's patch is in the tree.

## Authoring notes

Choices taken in the operator's stead, each the `(Recommended)` option ultrawrite would have
offered. *How the sandbox learns the program label:* the least machinery is a REST read the
edge already proxies — `GET /repos/<owner>/<repo>/issues/<n>` for each number on the plan's
`**Closes:**` line, keeping the label names that are in the PROGRAM set CLAUDE.md enumerates
(`merge-frontier experience-compiler verification-frontier peer-review fleet determinism`), one
literal in `fleet/sandbox-boot.sh` — over a new plan line, which would have to be taught to
ultrawrite, written by every author and be absent from every plan already on a tag. A read that
fails or names no program label leaves `watch-item` alone. *When the issue is filed:* inside
`publish`, right after the `publish:pr` event, so it is filed exactly once per PR opened (the
re-entry guard that skips a second PR skips it too), for a ready PR and a draft alike, and
before the merge — attention lands after the merge without anything waiting on it. *The
reviewer items:* the engine records a merged task's reviewer minors as one `; `-joined
`notes` string; the reader splits on that literal rather than growing a new report field, so
`fleet/run-engine.mjs` and `fleet/run-main.mjs` are untouched (a Global Constraints Check pins
that). *Labels that do not exist on a foreign target:* GitHub creates a label named on issue
creation when the caller has push access, which the `gh-<owner>-<repo>` integration has; not
exercised by any sim. *Review:* `peer` on the two script tasks — a shell script that posts to a
live repository is a surface where a wrong line is expensive and invisible in a diff.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-main.mjs fleet/run-waves.mjs skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py`
- The record's shape is read, never changed: `gate-receipt.json` and `report.json` keep the
  fields they have at BASE, and the boot script reads them from the evidence directory
  `render_card` already reads (`$EVIDENCE_DIR/$EVIDENCE_PATH`).
- The boot script calls `gh` nowhere; every GitHub call is `fleet_curl` against
  `https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/…`, the PR's own edge.
- The `Closes #<n>` lines stay the last lines of the PR body; the two record tags, the evidence
  commits and the one notification of the green path are unchanged.
- No new cell on `status.json`: the follow-up's record is the log line and the event.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The PR body carries the residuals as a checklist

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_residuals.mjs`

**Claim:** The sandbox writes every `deferred:external` ack and every non-blocking reviewer/critic finding into the PR body as a checklist (quoted from #711)
Machine: M1. A green boot whose engine leaves, in the run directory, the gate receipt
`{"verdict":"PASS","gateCheck":{"acks":[{"type":"deferred:external","detail":"live verb record — the lobby answered only on the edge [structural false-green: sandbox could not execute it against the target]"},{"type":"deferred:runtime","detail":"runtime-only-B — never listed"},{"type":"deferred:external","detail":"usage endpoint — read only through the edge [structural false-green: sandbox could not execute it against the target]"}]}}`
and the report
`{"stamp":"run-7","completenessFindings":[{"severity":"minor","detail":"critic-C: the exam covers the success path only"},{"severity":"blocking","detail":"blocking-D"},{"severity":"minor","detail":"critic-C2: no negative row for the 404"}],"tasks":[{"task":"1","status":"done","notes":"E1 dup insert; E2 semantic miss"},{"task":"2","status":"failed","notes":"failed-F"},{"task":"3","status":"done","notes":"G3 comment names the wrong file"}]}`
posts a PR whose body carries a `### Residuals` heading placed after the `### Plan` heading's
link line and before the first `Closes #` line, and the checklist lines between that heading
and the next `### ` heading or the first `Closes #` line are exactly, in this order:
`- [ ] deferred:external — live verb record — the lobby answered only on the edge [structural false-green: sandbox could not execute it against the target]`,
`- [ ] deferred:external — usage endpoint — read only through the edge [structural false-green: sandbox could not execute it against the target]`,
`- [ ] critic — critic-C: the exam covers the success path only`,
`- [ ] critic — critic-C2: no negative row for the 404`,
`- [ ] task 1 reviewer — E1 dup insert`,
`- [ ] task 1 reviewer — E2 semantic miss`,
`- [ ] task 3 reviewer — G3 comment names the wrong file` — seven lines, every external ack,
every minor critic finding and every reviewer note of every merged task; and no line of the
body contains `runtime-only-B`, `blocking-D` or `failed-F`.
M2. A green boot with the rig's default receipt `{"verdict":"PASS"}` and default report
`{"stamp":"run-7"}` posts a body with no `### Residuals` line and no line beginning `- [ ]`,
and the body's last lines are still the plan's `Closes #<n>` lines — the existing
`fleet/tests/test_sandbox_boot.mjs` legs stay green.
M3. A receipt whose one `deferred:external` ack has a `detail` containing a newline
(`"line one\nline two"`) renders as exactly one checklist line, `- [ ] deferred:external — line one line two`; and a run whose evidence directory holds that receipt but no `report.json` at all renders exactly that one checklist line under `### Residuals`.
M4. The rig: with `STUB_GATE_RECEIPT` set in a boot's environment the engine stub writes
`<run dir>/gate-receipt.json` as that value followed by one newline; with `STUB_REPORT` set to a
non-empty value it writes `<run dir>/report.json` as that value followed by one newline; with
`STUB_REPORT` set to the empty string it writes no `report.json` at all; with both unset the
two files are the default lines above (each followed by one newline) — so the evidence copies
the boot commits read back as the supplied string plus one newline, the defaults plus one
newline, or, for the empty-string report, no file.

**Authorized-by:** #711 (desired state, 2026-09-06 reading); `fleet/CONTRACT.md` §Literals
(the evidence directory's files; the PR body as the run's index); #679 (the `**Closes:**`
machinery this inverts).

**Interfaces:**
- Consumes: none
- Produces: `residual_items` (shell function in `fleet/sandbox-boot.sh`: prints the checklist lines, one per item, or nothing)
- Produces: `STUB_GATE_RECEIPT` (rig knob in `fleet/tests/_sandbox_boot_helpers.mjs`)
- Produces: `STUB_REPORT` (rig knob in `fleet/tests/_sandbox_boot_helpers.mjs`)

**Context:** Facts below were read off `main` at `1c97ba44` (v0.3.21); line numbers are that
tree's.

*Where the items live at BASE.* The gate receipt is `ultra_gate.py`'s document with
`gate_check.py`'s object one level down: the acks are `.gateCheck.acks[]`, each
`{ "type": "deferred:<reason>", "detail": "<deliverable> — <why>[ structural false-green …]" }`
(`gate_check.py` 132–140; `run-main.mjs` 262–263 `acksOf` is the engine's one reader of the
same path — a flat `.acks` is never written). The report is `run-engine.mjs`'s return object
(2318–2341): `completenessFindings` is the critic's `findings` array of
`{ severity: 'blocking' | 'minor', detail }` (schema 189–192); `tasks[]` rows carry
`{ task, status, notes, … }` where `notes` for a `done` task is the reviewers' minor findings
(`priorMinors.map((m) => m.detail)`), then `plan-defect: …` and `concern: …` entries, joined
with the literal `; ` (1625–1628); a `failed` task's `notes` is its blocking findings joined the
same way (1633) and is not a residual. `deferredVerification[]` is the critic's raw items; the
acks are their typed rendering, so the reader reads the receipt, not both. Run-59's record
(read on the laptop with git show of the evidence tag for run 59 — not a path in any tree)
confirms the keys: `report.json` top level is `integrationBranch,
baseSha, waves, dependencyEdges, tasks, tests, integratedRuns, integratedChecks, reviewEconomy,
acceptance, baseline, waveMerges, frontier, coverage, missingDeliverables, gitVerified,
ancestryMisses, deferredVerification, judgmentCalls, unfinished, completenessFindings,
blockedWaves`; `gate-receipt.json` top level is `mode, stamp, reportPath, branch, gateCheck,
gateCheckExit, acceptance, verdict`. A residual is, in this order: every receipt ack whose
`type` is exactly `deferred:external` (its `detail` whole, the evidence sentence included);
every `completenessFindings` entry whose `severity` is `minor`; every `; `-separated piece of
`notes` of every `tasks[]` row whose `status` is `done` and whose `notes` is non-empty. Every
item is ONE line: a newline inside a detail becomes a space. The three line shapes are the
literals in M1 — `- [ ] deferred:external — <detail>`, `- [ ] critic — <detail>`,
`- [ ] task <id> reviewer — <piece>` — and Task 2's issue body carries these same lines, so
the shape is shared, not restated.

*Where the body is built.* `render_card` (`sandbox-boot.sh` 1224–1259) writes
`$EVIDENCE_DIR/$EVIDENCE_PATH/pr-body.md` in one `{ … } >"$body"` block: the header table, `### Checks`
(the receipt it reads from `$dest/gate-receipt.json`), `fold_section`, `### Evidence`,
`### Plan` and its link line, then `plan_closes` LAST (1257, "so the self-merge closes what the
plan named"). `collect_evidence` (752–772) copies `gate-receipt.json` and `report.json` (with
`events.jsonl`, `receipt.json`, `standing-approval.json`, `acceptance.log`) into that same
`$dest` before any publish, so the reader takes both documents from `$dest`, never from the run
directory. `json_field` (227–231) answers the FIRST match only and cannot walk an array —
`fold_receipt` (887) and `append_event` (1338) show the pattern for a document: `python3 -c`
with the path in argv. The section goes between the `### Plan` link line and `plan_closes`, and
is omitted entirely (no heading, no blank line) when `residual_items` prints nothing.
`patch_pr_body` (1440) re-renders the card on a second attempt, so the section rides in the
PATCH too with no further code.

*Pins that must stay green.* `fleet/tests/test_sandbox_boot.mjs` legs: the body's last two
lines are the two `Closes` lines (411–414); `section('### Plan')` (486–498) is the text from
that heading to the next `\n### ` and must still hold `PLAN_LINK` and not the evidence link;
`evidenceSection = body.slice(indexOf('### Evidence'))` (358); the memoized green run's body is
byte-equal to `pr-body.md` less its trailing newline (343–346). Each of the four `test_sandbox_boot*`
sims that read `prPosts(ctx)[0].body` reads a body this task changes only when residuals exist,
and the rig's default record has none.

*The rig.* `fleet/tests/_sandbox_boot_helpers.mjs` 549–550 is where the engine stub writes the
two records: `printf '{"verdict":"%s"}\n' "$STUB_VERDICT" >"$run_dir/gate-receipt.json"` and
`printf '{"stamp":"run-7"}\n' >"$run_dir/report.json"`, with `run_dir` set at 505 to
`$FLEET_HOME/target/.claude/ultrapowers/run-run-7`. The two knobs replace exactly these two
lines: `if [ -n "${STUB_GATE_RECEIPT+set}" ]; then printf '%s\n' "$STUB_GATE_RECEIPT" >…; else <the line as it is>; fi`
and the same for `STUB_REPORT` — the stub body is a JS template literal, so a `$` and a
backslash in it are written as `\$`/`\\` exactly as the neighbouring lines do. `M3`'s missing
report is `STUB_REPORT` set to the empty string with the stub then writing NO file (an empty
value means "no report" — pin that in the stub's comment), not an empty file. The exam is a new
sim named for its surface, `fleet/tests/test_sandbox_boot_residuals.mjs`, built on the rig like
`test_sandbox_boot_selfmerge.mjs` (imports `SCRIPT, TARGET, PR_URL, PLAN_H1, RUN_PATH, makeHome,
boot, stream, prPosts, evidenceDir, runTests`; every case its own `makeHome()`; a plan with
`STUB_PLAN_EXTRA: '**Goal:** x\n**Closes:** #660 #668'` where a `Closes` line is needed); it
must end with the sentinel `ALL TESTS PASSED`, which `runTests` prints. Linux refuses an
environment string past 128 KiB — the M1 documents are far under it.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_residuals.mjs`
- Legs: (a) boot with `STUB_GATE_RECEIPT` and `STUB_REPORT` set to the two M1 documents; read
  `prPosts(ctx)[0].body`; assert `### Residuals` is present, its index is greater than the index
  of the `### Plan` link line and less than the index of the first line matching `/^Closes #/`;
  slice from the heading to the next `\n### ` or the first `Closes #` line, filter lines
  beginning `- [ ]`, and `deepEqual` them to the seven M1 lines in order [M1]; (b) on the same
  body assert no line includes `runtime-only-B`, `blocking-D` or `failed-F` [M1]; (c) boot with
  neither knob; assert no body line is `### Residuals`, no line starts with `- [ ]`, and the last
  two lines are `Closes #660` and `Closes #668` [M2]; (d) `Run:` the existing sim, whose Closes
  and card legs read the same body [M2]; (e) boot with a receipt whose single external ack's
  `detail` is `"line one\nline two"` (a JSON `\n` escape in the document) and the default report;
  assert exactly one `- [ ]` line, equal to `- [ ] deferred:external — line one line two` [M3];
  (f) boot with that receipt and `STUB_REPORT` set to the empty string; assert
  `<evidenceDir>/<RUN_PATH>/report.json` does not exist and the body's `- [ ]` lines are exactly
  that one line [M3]; (g) for each of the two knobs, boot with it set to a distinctive non-empty
  document and read the evidence copy (`<evidenceDir>/<RUN_PATH>/gate-receipt.json` or
  `<evidenceDir>/<RUN_PATH>/report.json`) — assert it equals the supplied string plus one
  trailing newline; boot with `STUB_REPORT` set to the empty string and assert
  `<evidenceDir>/<RUN_PATH>/report.json` does not exist; then boot with both unset and assert
  the two copies are `{"verdict":"PASS"}` and `{"stamp":"run-7"}` each with one trailing
  newline [M4].
- Run: `node fleet/tests/test_sandbox_boot_residuals.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'`

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #711

### Task 2: The run files one follow-up issue listing the same items

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_residuals.mjs`

**Claim:** files one follow-up issue per run (`watch-item`, the plan's program label) titled for the run, listing the same items with their evidence sentences (quoted from #711)
Machine: M1. A green boot with Task 1's M1 receipt and report, a plan whose header carries
`**Closes:** #660 #668`, and the rig answering every `GET /repos/popmechanic/smoke/issues/<n>`
with labels `enhancement`, `peer-review`, `fleet` makes, after the `POST …/pulls` and before the
first check-runs read, exactly two issue reads — `/issues/660` then `/issues/668` — and exactly
one `POST https://github.int.exe.xyz/api/v3/repos/popmechanic/smoke/issues` (`-X POST`, JSON
content type, payload after `-d`) whose payload has `title` exactly
`fleet run-7 residuals: <plan H1>`, `labels` deep-equal to `["watch-item","peer-review","fleet"]`
(`watch-item` first, then each program label once in the order first seen, `enhancement`
absent), and `body` whose first line is the PR's `html_url`, whose second line is empty, and
whose remaining lines are byte-for-byte the seven `- [ ]` lines the PR body's `### Residuals`
section carries, in the same order; the boot log carries
`followup: https://github.com/popmechanic/smoke/issues/9`; and the run's `events.jsonl` carries
exactly one `publish:followup` event, `{ kind: "publish:followup", url: "https://github.com/popmechanic/smoke/issues/9", items: 7 }` plus its `id`/`ts` stamp, after the `publish:pr` event.
M2. No residual, no sink: with the rig's default record the boot makes no `/issues` read, no
`/issues` POST and appends no `publish:followup` event; and a run that opens no PR (engine exit
1, `NEEDS_ACK`, zero commits ahead) with Task 1's M1 receipt makes no `/issues` read and no
`/issues` POST either.
M3. The sink never holds the run: a POST answered 422 leaves the boot merging as before (the
`curl pr merge` call is made, the final page is `done`), logs
`followup: POST /repos/popmechanic/smoke/issues answered 422` and appends no `publish:followup`
event; an issue read answered 404 for both tickets still POSTs once, with `labels` exactly
`["watch-item"]`.
M4. A plan with no `**Closes:**` line and Task 1's M1 record makes no `/issues/<n>` read and one
POST with `labels` exactly `["watch-item"]`, `title` `fleet run-7 residuals: <plan H1>`.
M5. The rig: `GET …/issues/<n>` answers `{"number":<n>,"labels":<STUB_ISSUE_LABELS>}` then the
status `STUB_ISSUE_READ_CODE` (default 200), logging `curl issue read <n>`; `POST …/issues`
appends the payload to `$FLEET_HOME/issues.log`, logs `curl issue create`, and answers
`{"html_url":"https://github.com/popmechanic/smoke/issues/9","number":9}` then
`STUB_ISSUE_CODE` (default 201); `STUB_ISSUE_LABELS` defaults to `[]`.

**Authorized-by:** #711 (desired state — "the inverse of the `**Closes:**` machinery");
`fleet/CONTRACT.md` §Literals `- **Publish:**` (the PR is one REST call through the edge, never
`gh`; the publish record is event kinds on `events.jsonl`).

**Interfaces:**
- Consumes: `residual_items`
- Consumes: `STUB_GATE_RECEIPT`
- Consumes: `STUB_REPORT`
- Produces: `file_followup` (shell function in `fleet/sandbox-boot.sh`: one POST /issues, or nothing)
- Produces: `STUB_ISSUE_LABELS` (rig knob: the JSON array GitHub's issue document carries as `labels`)

**Context:** Facts read off `main` at `1c97ba44` (v0.3.21). Task 1's contract, which this
task depends on: `residual_items` prints the checklist lines the PR body's `### Residuals`
section carries — `- [ ] deferred:external — <detail>`, `- [ ] critic — <detail>`,
`- [ ] task <id> reviewer — <piece>`, one line per item, in record order — or nothing; and the
rig's `STUB_GATE_RECEIPT` / `STUB_REPORT` write a boot's two records verbatim (M1's documents
are the two literals in Task 1's M1, reused here unchanged).

*Where the POST goes.* `publish` (`sandbox-boot.sh` 1399–1438) POSTs
`https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls` with `fleet_curl -sS -X POST … -H
'content-type: application/json' -d "$payload" -w '\n%{http_code}'`, reads the code off the last
line, takes `html_url` with `json_field`, logs `publish: <url>`, and ends with
`append_event publish:pr "url=s:$PR_URL" "number=i:…" "draft=b:$draft"`. `file_followup` is
called from `publish` after that event — never from `do_boot`'s re-entry branch (1919–1923),
which skips `publish` when the page already names a PR, so one PR is one filing — and before
`merge_pr` (1929). Its POST is the same shape against `…/repos/$TARGET_REPO/issues` with payload
`{"title":…,"body":…,"labels":[…]}` built with `json_escape` (234–237: it escapes a string cell
and turns newlines into `\n`); the title is `fleet $RUN_ID residuals: $(plan_title)` (with the
`$RUN_ID` fallback `publish` uses when the plan has no H1); the body is `$PR_URL`, an empty line,
then `residual_items`'s lines. A non-2xx answer or a `fleet_curl` failure is one log line,
`followup: POST /repos/$TARGET_REPO/issues answered <code>`, and `return 0` — the run's fate is
the merge's; the sink is never a gate. A 2xx logs `followup: <html_url>` and appends
`append_event publish:followup "url=s:<html_url>" "items=i:<count>"` (`append_event` at 1338,
tags `s`/`i`/`b`/`n`; `fleet_events.py`'s `read_events` accepts any kind and renders an unknown
kind capped at 200 chars, so a fourth kind needs no reader change). The count is the number of
lines `residual_items` printed; zero lines is `return 0` before any REST call.

*Labels.* The ticket numbers are the same line `plan_closes` (1127–1141) reads — reuse its awk
by stripping `Closes #` from its output; nothing else in the plan is read. For each number, one
`GET https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/issues/<n>` (the edge proxies
`/repos/<owner>/<repo>/…`, which this is); the document's `labels` is an array of objects
`{ "name": … }`, walked with `python3` (`json_field` returns the first match only). Keep a name
iff it is in the one literal `PROGRAM_LABELS="merge-frontier experience-compiler
verification-frontier peer-review fleet determinism"` declared beside the other literals at the
top of the script; `labels` is `watch-item` followed by the kept names, each once, in the order
first seen across the tickets in the plan's order. A read that answers non-2xx, does not parse,
or names nothing keeps nothing. No `gh`: the rig's `gh` stub logs `gh DIRECT` and
`test_sandbox_boot.mjs` asserts `argvLines(ctx, 'gh').length === 0`.

*The rig.* The curl stub (`_sandbox_boot_helpers.mjs` 154–257) dispatches on the URL with
`case "$url"`; a URL no arm matches falls to `*) say "curl UNKNOWN $url"; exit 22`, so both new
arms are needed and go before that default (and the `/issues/[0-9]*` arm before the `/issues`
arm). Their shapes, following the `/pulls` arm at 205–207 (`say "curl pr create"; printf '%s\n'
"$payload" >>"$FLEET_HOME/pr.log"; printf '%s\n%s\n' "$STUB_PR_BODY" "${STUB_PR_CODE:-201}"`):
`*github.int.exe.xyz/api/v3/repos/*/issues/[0-9]*)` → `num="${url##*/}"; say "curl issue read $num"; printf '{"number":%s,"labels":%s}\n%s\n' "$num" "${STUB_ISSUE_LABELS:-[]}" "${STUB_ISSUE_READ_CODE:-200}"`;
`*github.int.exe.xyz/api/v3/repos/*/issues)` → `say "curl issue create"; printf '%s\n' "$payload" >>"$FLEET_HOME/issues.log"; printf '{"html_url":"https://github.com/popmechanic/smoke/issues/9","number":9}\n%s\n' "${STUB_ISSUE_CODE:-201}"`.
In the template literal every `$` is written `\$` and `\n` as `\\n`, as the neighbouring arms
do. The exam extends `fleet/tests/test_sandbox_boot_residuals.mjs` under a comment naming this
task (`// #711 Task 2 — the follow-up issue`), reading `$FLEET_HOME/issues.log` (a file the
stub creates under the case's temp home at boot time, as `pr.log` is) the way `prPosts` reads
`pr.log`, the stream with `stream(ctx)` / `indexOf(ctx, 'CALL curl issue read 660')`,
and the run's events from `<home>/target/.claude/ultrapowers/run-run-7/events.jsonl`
(`RUN_DIR_PATH`), one JSON object per line, as `test_sandbox_boot_selfmerge.mjs` 400–430 does.
The parked-no-PR recipe is `boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1', STUB_ENGINE_CODE: '1', STUB_GATE_RECEIPT: … })`
(`test_sandbox_boot.mjs` 722). M1's label array is
`[{"name":"enhancement"},{"name":"peer-review"},{"name":"fleet"}]`.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_residuals.mjs`
- Legs: (a) boot with Task 1's M1 knobs, `STUB_PLAN_EXTRA: '**Goal:** x\n**Closes:** #660 #668'`
  and `STUB_ISSUE_LABELS` as in Context; assert the stream's `CALL curl issue read 660` and
  `CALL curl issue read 668` both sit after `CALL curl pr create` and before
  `CALL curl check-runs 1`, that exactly two `CALL curl issue read` lines exist, and that
  exactly one `CALL curl issue create` line exists and its index is greater than both issue
  reads' and less than `CALL curl check-runs 1`'s [M1]; (b) on the same boot, find the curl argv whose URL ends in
  `/issues`, assert `-X POST`, the `content-type: application/json` header and `-d`; parse
  `issues.log`'s one line; assert `title` equals `fleet run-7 residuals: ${PLAN_H1}`, `labels`
  deep-equals `['watch-item', 'peer-review', 'fleet']`, and `body.split('\n')` is `[PR_URL, '',
  ...L]` where `L` is the `- [ ]` lines sliced out of `prPosts(ctx)[0].body`'s `### Residuals`
  section — the two lists compared with `deepEqual`, and `L.length === 7` [M1]; (c) on the same
  boot assert the stream has a line equal to `followup: https://github.com/popmechanic/smoke/issues/9`,
  and the run's `events.jsonl` has exactly one object with `kind === 'publish:followup'`, whose
  record less `id`/`ts` deep-equals `{ kind: 'publish:followup', url: 'https://github.com/popmechanic/smoke/issues/9', items: 7 }`,
  and whose line index is greater than the `publish:pr` line's [M1]; (d) boot with neither
  knob; assert no stream line includes `curl issue`, `issues.log` is absent, and no event has
  kind `publish:followup` [M2]; (e) boot with the parked-no-PR recipe and `STUB_GATE_RECEIPT`
  set to Task 1's M1 receipt; assert no stream line includes `curl issue` and `issues.log` is
  absent [M2]; (f) boot as (a) with `STUB_ISSUE_CODE: '422'`; assert the stream has
  `CALL curl pr merge` and the line `followup: POST /repos/popmechanic/smoke/issues answered 422`,
  the final `status.json` state is `done`, and no `publish:followup` event exists [M3]; (g) boot
  as (a) with `STUB_ISSUE_READ_CODE: '404'`; assert one `curl issue create` and the payload's
  `labels` deep-equals `['watch-item']` [M3]; (h) boot with Task 1's M1 knobs, no
  `STUB_PLAN_EXTRA` and `STUB_ISSUE_LABELS` unset (the rig's `[]` default); assert no
  `curl issue read` line, one `curl issue create`, `labels` deep-equals `['watch-item']` and
  `title` equals `fleet run-7 residuals: ${PLAN_H1}` [M4] [M5]; (i) on boot (a)'s curl argv log assert the two
  issue-read argvs carry the URLs ending `/repos/popmechanic/smoke/issues/660` and `/668`, and
  that the stream has both `CALL curl issue read` lines and one `CALL curl issue create` [M5];
  (j) on boot (a) assert `issues.log` holds exactly one line and it equals the string after `-d`
  in the POST's argv [M5].
- Run: `node fleet/tests/test_sandbox_boot_residuals.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `! grep -E 'gh (api|issue)' fleet/sandbox-boot.sh | grep -v '^ *#' | grep -q .`

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #711

### Task 3: The contract names the sink

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`
- Test: `tests/test_docs_agree_with_code.py`

**Claim:** After the run, the fleet contract's `- **Publish:**` bullet says the PR body carries the `### Residuals` checklist and that the run files one `watch-item` follow-up issue, recorded as a `publish:followup` event. (derived)
Machine: M1. The text of `fleet/CONTRACT.md` from the line beginning `- **Publish:**` to the
line beginning `- **Integration naming` contains, in this order, `### Residuals`, then `deferred:external`, then `Closes #` — the
section is named as sitting before the `Closes` lines.
M2. The same range contains `POST /repos/<owner>/<repo>/issues`, `watch-item`, the six program
label names as one backticked comma-separated list in this order — `merge-frontier`,
`experience-compiler`, `verification-frontier`, `peer-review`, `fleet`, `determinism` — and
the phrase `never a gate` — the issue's labels and its posture are declared.
M3. The same range names `publish:followup` beside `url` and `items`, and the sentence that
counted the publish record's kinds now says `four event kinds`, with `three event kinds` absent
from the range.
M4. `tests/test_docs_agree_with_code.py` stays green — the range's other literals are
untouched.

**Authorized-by:** #711; `fleet/CONTRACT.md` header ("the contract wins" — every literal a task
introduces is declared here); `fleet/tests/test_sandbox_boot_selfmerge.mjs` M7 (the Publish bullet
names the publish record's kinds and fields).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The `- **Publish:**` bullet is `fleet/CONTRACT.md` 256–277 at `1c97ba44`; the
next bullet, `- **Integration naming:**`, starts at 278. `fleet/tests/test_sandbox_boot_selfmerge.mjs`
736–748 slices exactly this range (`section(CONTRACT, /^- \*\*Publish:\*\*/, /^- \*\*Integration naming/)`)
and asserts it still includes `publish:pr`, `publish:hold`, `publish:merge`, `url`, `number`,
`draft`, `why`, `left`, `detail`, `checks red`, `checks pending`, `refused` — keep every one. The
sentence "The publish record is three event kinds, appended to the run's `events.jsonl` …"
(271) becomes "four event kinds", and the `publish:followup` clause joins the list at its end
(after the `publish:merge` account, before "The LAST `publish:merge` line …"): `publish:followup`
(`url`, `items`) once the follow-up issue's POST answers 2xx. The residuals sentence belongs
with the body's description — beside "the body carries a `## Publish fold` section before
`### Evidence`" (266–267): after `### Plan`, the body carries a `### Residuals` checklist —
one `- [ ]` line per `deferred:external` ack of the gate receipt and per non-blocking
reviewer/critic finding of `report.json`, with its evidence sentence — before the `Closes #<n>`
lines, and no section when there is none. The issue sentence: with residuals, the sandbox files
ONE follow-up issue per PR opened, `POST /repos/<owner>/<repo>/issues`, titled
`fleet run-<N> residuals: <plan H1>`, labelled `watch-item` plus the program labels
(`merge-frontier`, `experience-compiler`, `verification-frontier`, `peer-review`, `fleet`,
`determinism`) read off the `**Closes:**` tickets, its body the PR's URL and the same lines; a
refused POST is one log line and never a gate. This task owns every sentence above — no other
task of this plan touches `fleet/CONTRACT.md`; another plan launched this sitting may, and
same-file text folds. Lines 266–277 are where the three edits land; `tests/test_docs_agree_with_code.py` reads this file for the unit, engine-directory,
VM-name and two-tags literals (233–335), none of which is in this bullet.

**Proof:**
- Test: `tests/test_docs_agree_with_code.py`
- Legs: (a) `Run:` the scoped grep for `### Residuals` … `deferred:external` … `Closes #` in
  order [M1]; (b) `Run:` the scoped greps for the POST path, `watch-item`, the six program
  labels as one ordered list (backticks matched as any character) and `never a gate` [M2]; (c) `Run:` the scoped grep for
  `publish:followup` beside `url` and `items`, and for `four event kinds` with `three event
  kinds` absent [M3]; (d) `Run:` the docs pin file [M4].
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q '### Residuals.*deferred:external.*Closes #'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'POST /repos/<owner>/<repo>/issues'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | grep -q 'watch-item'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'merge-frontier., .experience-compiler., .verification-frontier., .peer-review., .fleet., .determinism.'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'never a gate'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'publish:followup.*url.*items'`
- Run: `sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'four event kinds'`
- Run: `! sed -n '/^- \*\*Publish:\*\*/,/^- \*\*Integration naming/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'three event kinds'`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`
- issue-closed: #711
