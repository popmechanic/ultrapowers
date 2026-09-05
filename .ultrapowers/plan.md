# Approved runs merge themselves

**Grammar:** claims-v1

**Claim:** After this run, a run the engine approved merges itself once CI is green with nobody
waiting on it, the record on the evidence branch shows that and how the run was approved, a
test that names the shouted words is not itself counted as shouting, and I can launch a run
whose implementers work at a lower effort while every judge keeps its own. (elicited)

**Goal:** The boot-, launch- and janitor-side half of the clock session (the engine half is the
concurrent plan `2026-09-05-task-chains-start-together.md`): #655 (the janitor arms auto-merge
on the first `done` it sees, so run-9's 12.6-minute human wait between a ready PR and main is
gone), #649 (`collect_evidence` never copied `approve-receipt.json` or `standing-approval.json`,
so the record could not tell an approved run from a PASS), #652 (the shouted-word scanner in
`test_run_engine_exam_fix_edit.mjs` flagged a peer exam's regex and cost run-9 a reconcile
round), and #522's knob (a launch flag that lowers implementer effort, default unchanged, so
the *first thought, best thought* A/B can be launched from the laptop). Nothing under
`fleet/run-engine.mjs`, `fleet/run-waves.mjs` or `fleet/roles/` is touched — those are the
concurrent plan's.

**Tech Stack:** bash (`fleet/sandbox-boot.sh` and its sims), Node 24 ESM (`fleet/launch.mjs`,
`fleet/lobby.mjs`, `fleet/janitor.mjs`, `fleet/run-main.mjs` and the sims under `fleet/tests/`,
each printing `ALL TESTS PASSED`), Python 3 (`python3 -m pytest`), Markdown. Nothing is added
to any dependency file.

**Spec:** #655 (shape (b)), #649, #652 (option (a)), #522 (the knob only; the operator's
decision of 2026-09-05: full plumbing, `--implementer-effort`, default unchanged). The issues
carry the design; there is no separate spec document.

**Parallelization rationale:** One wave, width 4. Tasks 1 and 4 both modify
`fleet/sandbox-boot.sh` (the evidence list and the done transition; the assignment parser and
the engine argv — separate functions, text that folds) and `fleet/CONTRACT.md` (the evidence
bullet; the comment sentence — text that folds). No task consumes a sibling's symbol, so no
edge is derived and no task waits. Each task's exams are new sim files, so no two examiners
write one file; Task 3's deliverable is an edit to an existing sim and proves itself with
`Run:` commands.

## Global Constraints

- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The engine, its clone routing, its worker and its role files are byte-identical to BASE — a
  concurrent run owns them.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = b90f2f30356dcad03049b4d2e050bfc1f9a78f14
- Check: test "$(git hash-object fleet/run-waves.mjs)" = 5283c073e830253bd70ce66f0faa9b689a512412
- Check: test "$(git hash-object fleet/run-worker.mjs)" = 5e4bff29dc74ed9f515c3e4f55d5990a35f8eb4c
- Check: test "$(git hash-object fleet/roles/implementer.md)" = 788b530dc0075cc6bd1c463030bfadf70b2e0f8b
- Check: test "$(git hash-object fleet/roles/examiner.md)" = 3a8c8acf9e60d1a868db0bbfcc2226d42566bbf4
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = 65ccf30820183187f373a82e7694e4b40842dc87
- The four operator documents still agree with the code: every flag on the documented launch
  line is in the launcher's usage, and the retired vocabulary of the pre-lift fleet appears
  nowhere.
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The janitor still issues no `git` and no `ssh <vm>` command, and reads nothing under
  `~/.ultrapowers/` but `fleet.json`.
- No shouted imperative (an all-caps must, never or always as a whole word) is added to
  `fleet/CONTRACT.md` or `fleet/RUNBOOK.md`.
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The approval receipts ride the evidence branch

**Type:** implementation

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`

**Claim:** The record on the evidence branch shows that and how the run was approved. (derived)
Machine: M1. `collect_evidence` copies `approve-receipt.json` and `standing-approval.json` from
the run directory into `.ultrapowers/runs/<N>/` on the evidence worktree when each is present,
byte for byte, and a run that wrote neither commits neither. M2. The `done` status's `phase`
contains the PR URL and, after it, `verdict=PASS` when the gate receipt's verdict is `PASS`,
or `approved by the two-move rule` when a `NEEDS_ACK` verdict was greened by an
`approve-receipt.json`. M3. `fleet/CONTRACT.md`'s evidence-branch bullet — the one opening
`ultra/evidence-run-<N>` — names `approve-receipt.json` and `standing-approval.json` with
the words `present when the engine wrote them`.

**Authorized-by:** #649 ("add both files to the collect list (present-if-written; a genuine
park has neither), and let `status.json`'s `done` state say which of the two it was").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `collect_evidence()` in `fleet/sandbox-boot.sh` (line ~606) copies the gate
receipt from `gate_receipt_path`, then `for f in report.json events.jsonl receipt.json; do [ -f
"$run_dir/$f" ] && cp …` from `run_dir_path`, then the engine log and `status.json`; the two
approval files live in that same run directory (`fleet/run-main.mjs` writes
`approve-receipt.json` after `ultra_gate.py --approve` and `standing-approval.json` at line
~663), and `approve_receipt_path()` (line ~489) already answers the approve receipt's path. The
done transition is `if [ "$outcome" = "gate-green" ]; then write_status done "$PR_URL"; else
… write_status parked "$PR_URL"; fi` (line ~930), just after the outcome was decided at line
~888 with `approval=", approved by the two-move rule"` set on the receipt path and the log line
`outcome: $outcome (verdict=${verdict:-none}$approval)`; `write_status`'s second argument is
the `phase` cell, free text, and no sim pins the done phase's text — they read `.state`. The
boot sims (`fleet/tests/test_sandbox_boot.mjs`, `test_sandbox_boot_approved.mjs`, helpers in
`_sandbox_boot_helpers.mjs`: `makeHome`, `boot`, a stub engine that writes the receipts into
the run directory, `statusOf`, `evidenceDir`) drive the whole path against stub binaries; the
approved sim already writes a `NEEDS_ACK` gate receipt with and without an
`approve-receipt.json` and reads the evidence directory the way M1 needs. The CONTRACT bullet
to extend reads `\`ultra/evidence-run-<N>\` — the run's record under \`.ultrapowers/runs/<N>/\`:
\`status.json\`, \`receipt.json\`, \`gate-receipt.json\`, \`report.json\`, \`events.jsonl\`,
\`engine.log\`.` (line ~38).
**BASE facts:** (generated at af1e7c7)
- `done` at `fleet/run-worker.mjs:713` blob 5e4bff2
- `fleet/CONTRACT.md` blob 2962f5f
- `fleet/sandbox-boot.sh` blob 6be6ef3
- `from` at `fleet/run-main.mjs:328` blob d0a320f
- `fleet/run-main.mjs` blob d0a320f
- `fleet/tests/test_sandbox_boot.mjs` blob ec8ba1e
- `makeHome` at `fleet/tests/_sandbox_boot_helpers.mjs:299` blob 600e712
- `boot` at `fleet/tests/_sandbox_boot_helpers.mjs:319` blob 600e712
- `statusOf` at `fleet/tests/_sandbox_boot_helpers.mjs:354` blob 600e712
- `evidenceDir` at `fleet/tests/_sandbox_boot_helpers.mjs:390` blob 600e712
- `state` at `fleet/claude-token.mjs:54` blob 5f75f73
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 600e712

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Legs: (a) with a `NEEDS_ACK` gate receipt and an `approve-receipt.json` in the run
  directory, the evidence directory's `approve-receipt.json` is byte-equal to the run
  directory's, and with a `PASS` receipt and a `standing-approval.json` in the run directory
  the evidence directory's `standing-approval.json` is byte-equal to it [M1]; (b) with a `PASS`
  receipt and neither file written, neither `approve-receipt.json` nor
  `standing-approval.json` exists in the evidence directory [M1]; (c) the final `status.json`
  of the `PASS` run has `state` `done` and a `phase` that contains the PR URL followed by
  `verdict=PASS`, and the `NEEDS_ACK`-plus-receipt run's has `state` `done` and a `phase` that
  contains the PR URL followed by `approved by the two-move rule` [M2]; (d) the sim prints
  `ALL TESTS PASSED`.
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2].
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the green-path boot sim, whose collected-file list holds [M1].
- Run: node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the approved-run sim, whose done-state pins hold [M2].
- Run: sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'approve-receipt.json. and .standing-approval.json., present when the engine wrote them'
- The previous bullet reads only the evidence-branch bullet (from its opening to the next
  branch's bullet), wraps joined, and pins both names and the words `present when the engine
  wrote them` inside it (the dots stand for the backticks around each name, which a Run:
  command may not carry) [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents [M3].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #649

### Task 2: The janitor arms auto-merge on a done run

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_janitor_automerge.mjs`

**Claim:** A run the engine approved merges itself once CI is green with nobody waiting on it.
(derived)
Machine: M1. For every fleet VM whose status is `done` with a `pr` URL, the janitor runs
`gh pr view <url> --json state,isDraft,autoMergeRequest` and, when `state` is `OPEN`,
`isDraft` is false and `autoMergeRequest` is null, runs `gh pr merge <url> --auto --squash`
once, recording `{ kind: 'auto-merge', vm, run, pr, command, applied }` in the result's
`actions`; under `--dry-run` it still runs the view, records the action with `applied: false`
and issues no merge. M2. A PR whose view answers `autoMergeRequest` non-null, `state` other
than `OPEN`, or `isDraft` true gets no merge command; a run whose state is not `done`, or is
`done` with a null `pr`, gets no `gh pr view` at all. M3. When `gh pr merge --auto` exits
non-zero with `clean status` in its output — the PR is already mergeable — the janitor runs
`gh pr merge <url> --squash` once and records the action with `merged: true`; any other
non-zero exit is recorded as `applied: false` with the output's last non-empty line under
`error`. M4. The arming is independent of the reap: a `done` run younger
than `--age` is armed and not removed, one older than `--age` is armed (if still open) and
removed in the same pass; and across every leg the janitor issues no `git` command and no
`ssh <vm>` command. M5. `fleet/RUNBOOK.md`'s reap paragraph says the janitor arms auto-merge
on a done run's pull request.

**Authorized-by:** #655 (shape (b): "`fleet/janitor.mjs`, which already reads every run's
`status.json` off the evidence branch on a cron, arms auto-merge on the first `done` it sees
for a run whose PR is ready").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `janitor({ argv, exec, config, now })` in `fleet/janitor.mjs` (line ~123) lists
the fleet with `listVms(exec)`, reads each VM's assignment from its comment, then `readEvidence`
(one `gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=<evidence branch>`
through the exec seam, base64 `content` decoded) and decides `rm` for `done|parked|failed`
older than `--age`; `status.pr` is the PR URL the contract's `status.json` carries (`"pr":"<url
or null>"`). Every external call goes through `exec(cmd, argv)` — `ghApi` is `exec('gh',
['api', apiPath])` — so the two new calls are `exec('gh', ['pr', 'view', url, '--json',
'state,isDraft,autoMergeRequest'])` and `exec('gh', ['pr', 'merge', url, '--auto',
'--squash'])`; no `--subject` is passed, because the fold commit is titled from the plan's H1
(#633) and the squash takes it. GitHub refuses to enable auto-merge on a PR that is already
mergeable with a message containing `clean status`; the fallback merge is the state auto-merge
would have reached on its own, since a `done` run is an approved run (#622) and the branch
protection's required check has already passed for the refusal to occur. The mutations happen
after the read loop, as `rm` does today (`if (!dryRun) { for (const action of actions) … }`);
the view is a read and runs in the loop under `--dry-run` too. The sim
`fleet/tests/test_janitor.mjs` shows the rig: `makeExec({ rules })` from
`_lobby_helpers.mjs` with `cmdRule('gh', 'api', (cmd, argv) => …)` canning `gh` answers by
path, `vmRow`/`vmsPayload` for the `ls` answer, `writeStatus`, `exec.calls` for what was
issued, and its leg (c) asserting no `git` and no VM `ssh` across every leg — a second
`cmdRule('gh', 'pr', …)` cans the view and merge answers by their first arguments. The RUNBOOK
paragraph to extend is the one beginning `It lists the fleet, reads each VM's comment` (line
~179).
**BASE facts:** (generated at af1e7c7)
- `done` at `fleet/run-worker.mjs:713` blob 5e4bff2
- `pr` at `fleet/tests/test_sandbox_boot.mjs:294` blob ec8ba1e
- `state` at `fleet/claude-token.mjs:54` blob 5f75f73
- `actions` at `fleet/janitor.mjs:139` blob e084e38
- `error` at `evals/ab_runner.py:65` blob 7877c9d
- `git` at `fleet/lobby.mjs:252` blob 8239e76
- `fleet/RUNBOOK.md` blob ef7f52a
- `fleet/janitor.mjs` blob e084e38
- `readEvidence` at `fleet/janitor.mjs:87` blob e084e38
- `fleet/tests/test_janitor.mjs` blob 7fa3cd3
- `vmRow` at `fleet/tests/_lobby_helpers.mjs:55` blob 86c4674
- `vmsPayload` at `fleet/tests/_lobby_helpers.mjs:64` blob 86c4674
- `writeStatus` at `fleet/tests/_lobby_helpers.mjs:171` blob 86c4674
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674

**Proof:**
- Test: `fleet/tests/test_janitor_automerge.mjs`
- Legs: (a) a `done` run with a `pr` URL whose view answers `{"state":"OPEN","isDraft":false,
  "autoMergeRequest":null}` produces exactly one `gh` call whose argv is exactly `['pr',
  'view', <url>, '--json', 'state,isDraft,autoMergeRequest']`, exactly one whose argv is
  exactly `['pr', 'merge', <url>, '--auto', '--squash']`, and one action deep-equal to `{
  kind: 'auto-merge', vm: <vm>, run: <N>, pr: <url>, command: 'gh pr merge <url> --auto
  --squash', applied: true }`; under `--dry-run` the same run produces the same view call, the
  same action with `applied: false`, and no merge call [M1]; (b) views answering
  `autoMergeRequest` as an object, `state` `MERGED`, and `isDraft` true each produce no merge
  call, and a `parked` run, a `running` run and a `done` run with `pr` null each produce no
  `gh pr view` call [M2]; (c) a merge answering exit 1 with `Pull request is in clean status`
  on stderr produces exactly one further `gh pr merge <url> --squash` call and an action with
  `merged: true`, while a merge answering exit 1 with `HTTP 502` as its last stderr line
  produces no further merge call and an action with `applied: false` and `error` equal to
  `HTTP 502` [M3]; (d) a `done` run
  updated ten minutes ago is armed and not in any `rm` action, and one updated two hours ago
  is both armed and `rm`ed, and across every leg `exec.calls` contains no `git` command and no
  `ssh` to a VM [M4]; (e) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_janitor_automerge.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3] [M4].
- Run: node fleet/tests/test_janitor.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing expiry sim, whose reap and no-git pins hold with the
  arming beside them [M4].
- Run: tr '\n' ' ' < fleet/RUNBOOK.md | grep -q 'arms auto-merge'
- The previous bullet is the reap paragraph's new sentence, wraps joined [M5].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #655

### Task 3: The shouted-word scanner leaves test files alone

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_run_engine_exam_fix_edit.mjs`

**Claim:** A test that names the shouted words is not itself counted as shouting. (derived)
Machine: M1. Leg (g) of `fleet/tests/test_run_engine_exam_fix_edit.mjs` does not walk a
changed path under `fleet/tests/` or under `tests/`: a tree whose only gained whole-word shout
is inside a new file under `fleet/tests/` passes the sim, a tree whose only gained shout is
inside a new file under `tests/` passes the sim, and the sim on the tree as it stands passes.
M2. A file outside those two directories that gains one of the words still fails the
leg — the sim on such a tree does not print its sentinel.

**Authorized-by:** #652 (option (a): "the scanner skips `fleet/tests/` and `tests/` (a test
that names the words is checking for them, not shouting) … (a) is the smallest and honest").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The leg (line ~235) assembles the three words from pieces (`SHOUT = ['NEV' +
'ER', …]`), runs `git diff --name-only d6efce4` from `REPO_ROOT`, and for every listed path
that still exists compares the set of whole upper-case words now against the blob at
`d6efce4`, failing on any gained word; it already skips the leg entirely when `d6efce4` is not
in the object store (a depth-1 clone). The skip is one `continue` on `rel.startsWith(
'fleet/tests/') || rel.startsWith('tests/')` at the top of that loop, with a comment saying
why a test that names the words is checking for them. The proofs below drive the scanner in
a temporary full clone of this repository so the tree can be given a probe file without
touching the working tree: the clone carries the history the leg diffs against, the working
copy of the sim is copied over the clone's, and the probe's words are assembled by `printf`
from pieces so this plan carries none of them whole.
**BASE facts:** (generated at af1e7c7)
- `fleet/tests/test_run_engine_exam_fix_edit.mjs` blob 7ec34ef
- `from` at `fleet/run-main.mjs:328` blob d0a320f

**Proof:**
- Legs: (a) the sim on the tree as it stands prints its sentinel [M1]; (b) with a new file
  under `fleet/tests/` that spells the three words, and separately with one under `tests/`,
  the sim prints its sentinel — neither path is walked [M1]; (c) with the same file directly
  under `fleet/`, the sim does not print its sentinel: the leg fails on the gained words, so
  the scanner still walks what it walked before [M2].
- Run: node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim on the tree as it stands [M1].
- Run: d=$(mktemp -d) && git clone -q . "$d" && cp fleet/tests/test_run_engine_exam_fix_edit.mjs "$d/fleet/tests/" && printf 'const re = /(MU%sST|NEV%sER|ALW%sAYS)/\n' '' '' '' > "$d/fleet/tests/zz_probe_shout.mjs" && git -C "$d" add -A && (cd "$d" && node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED')
- The previous bullet plants a new file under `fleet/tests/` that spells all three words as
  a regex, in a full temporary clone carrying this tree's copy of the sim, and expects the
  sim green [M1].
- Run: d=$(mktemp -d) && git clone -q . "$d" && cp fleet/tests/test_run_engine_exam_fix_edit.mjs "$d/fleet/tests/" && printf 'const re = /(MU%sST|NEV%sER|ALW%sAYS)/\n' '' '' '' > "$d/tests/zz_probe_shout.py" && git -C "$d" add -A && (cd "$d" && node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED')
- The previous bullet is the same probe planted under `tests/`, the second skipped directory,
  and expects the sim green [M1].
- Run: d=$(mktemp -d) && git clone -q . "$d" && cp fleet/tests/test_run_engine_exam_fix_edit.mjs "$d/fleet/tests/" && printf 'const re = /(MU%sST|NEV%sER|ALW%sAYS)/\n' '' '' '' > "$d/fleet/zz_probe_shout.mjs" && git -C "$d" add -A && ! (cd "$d" && node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED')
- The previous bullet is the negative control: the same probe directly under `fleet/` still
  turns the sim red, so the scanner scans what it scanned before [M2].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_exam_fix_edit.mjs`
- issue-closed: #652

### Task 4: A launch flag turns implementer effort down

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_launch_effort.mjs`
- Test: `fleet/tests/test_sandbox_boot_effort.mjs`
- Test: `fleet/tests/test_run_main_effort.mjs`

**Claim:** I can launch a run whose implementers work at a lower effort while every judge
keeps its own. (derived)
Machine: M1. `node fleet/launch.mjs … --implementer-effort <v>` with `v` one of `low`,
`medium`, `high` writes `effort=<v>` as the last key of the assignment comment, after `tier=`
when present; any other value is a refusal naming the three; without the flag the comment is
byte-identical to BASE's for the same launch; `COMMENT_KEYS` in `fleet/lobby.mjs` ends with
`effort`, and the launcher's usage string names `--implementer-effort low|medium|high`. M2.
`fleet/sandbox-boot.sh` accepts `effort=<v>` in the assignment and appends
`--implementer-effort <v>` to the engine's argv after the tier and overlap knobs; without the
key the argv is as at BASE; a value outside the three fails the assignment. M3.
`fleet/run-main.mjs` accepts `--implementer-effort <v>` for each of the three values and its
worker passes `--effort <v>` on every `impl:<id>` and `fix:<id>:<n>` dispatch and on no `exam:<id>`, `review:<id>:<n>`,
`integration`, `resolve:<…>`, `merge:<…>` or `reconcile:<…>` dispatch; with no flag no dispatch
carries `--effort`. M4. `fleet/CONTRACT.md`'s comment sentence lists `effort=low|medium|high`
as the third optional key, directly after `tier=standard|mostCapable`.

**Authorized-by:** #522 ("One engine knob: per-role thinking … off for implementers and fix
rounds, unchanged for review/critic/resolver/proof-gate"); operator decision 2026-09-05 (full
plumbing, `--implementer-effort`, default unchanged).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The comment is the only channel from the laptop to the engine (`fleet/CONTRACT.md`
line ~44: `run=<N> plan=<40-hex> target=<owner>/<repo> base=<40-hex> engine=<40-hex>` then
optional `overlap=fold|serialize`, `tier=standard|mostCapable`, ≤200 bytes). `buildComment` in
`fleet/lobby.mjs` (line ~436) emits `COMMENT_KEYS` (`['run', 'plan', 'target', 'base',
'engine', 'overlap', 'tier']`, line ~427) in order, skipping empty ones; `parseComment` keeps
unknown keys, so the janitor needs no change. `fleet/launch.mjs` validates `--tier` against
`TIER_VALUES` at line ~244 (a `Refusal` naming the values), carries the fields into
`buildComment` at line ~281 (`fields = { run, plan, target, base, engine, overlap, tier }`) and
the byte-ceiling probe there, and declares every flag in `USAGE` (line ~91), which
`tests/test_docs_agree_with_code.py` reads. `fleet/sandbox-boot.sh` parses the comment in
`parse_assignment` (line ~295: `case "$key" in run|plan|target|base|engine|overlap|tier …
*) fail "assignment: unknown key …"`), validates `OVERLAP` and `TIER` beneath it, and builds
the engine argv in the run function (line ~540: `[ -n "$TIER" ] && knobs+=(--tier "$TIER")`,
then `--overlap`) before `node "$ENGINE_REPO_DIR/fleet/run-main.mjs" "$PLAN_FILE" "$RUN_ID"
--repo "$TARGET_DIR" ${knobs[@]+"${knobs[@]}"}`. `fleet/run-main.mjs` maps flags to args at
line ~113 (`'--tier': 'tier', '--overlap': 'overlap', …`), prints its own usage at line ~122,
and composes the worker in `composeAgent({ runId, base, runDir, clonesDir, patchesDir,
workersDir, promptFileFor, settingsFor, env, cli, eventLog, spawnFn })` (line ~384), which
calls `createRunWorker({ …, timeoutMsFor: (role) => ROLE_TIMEOUT_MS[role], … })`;
`createRunWorker` already accepts `effortFor` (a `role → effort` function, `fleet/run-worker.mjs`
line ~542) and `buildArgs` already appends `--effort <v>` when it is given (line ~273), and
`roleForLabel` (line ~192) maps both `impl:` and `fix:` to the role `implementer`, `exam:` to
`examiner`, `review:` to `reviewer`, `integration` to `critic`, `resolve:` to `resolver` and
`merge:`/`reconcile:` to `writeSide` — so the whole engine end is one `effortFor` that answers
the value for `implementer` and `undefined` otherwise, carried from the parsed args into
`composeAgent`. The `claude` CLI accepts `--effort low|medium|high|xhigh|max`; the knob offers
the lower three. The existing pins to keep green: `fleet/tests/test_launch.mjs` asserts the
comment `run=1 plan=… target=… base=… engine=… overlap=fold tier=mostCapable` for a launch
without the new flag; `fleet/tests/test_sandbox_boot.mjs` asserts the engine argv ending
`--tier mostCapable --overlap fold` for the helper's `ASSIGNMENT` (which carries no `effort=`);
`fleet/tests/test_run_main.mjs` drives `composeAgent` with a `spawnFn` fake `claude` (line
~193) whose `(cli, argv)` arguments are the place to read `--effort` off each dispatch.
**BASE facts:** (generated at af1e7c7)
- `v` at `fleet/run-engine.mjs:45` blob b90f2f3
- `COMMENT_KEYS` at `fleet/lobby.mjs:427` blob 8239e76
- `fleet/lobby.mjs` blob 8239e76
- `fleet/sandbox-boot.sh` blob 6be6ef3
- `fleet/run-main.mjs` blob d0a320f
- `integration` at `fleet/run-waves.mjs:102` blob 5283c07
- `fleet/CONTRACT.md` blob 2962f5f
- `buildComment` at `fleet/lobby.mjs:436` blob 8239e76
- `fleet/launch.mjs` blob 61d0e7a
- `TIER_VALUES` at `fleet/launch.mjs:101` blob 61d0e7a
- `Refusal` at `fleet/lobby.mjs:261` blob 8239e76
- `USAGE` at `fleet/janitor.mjs:60` blob e084e38
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `createRunWorker` at `fleet/run-worker.mjs:533` blob 5e4bff2
- `fleet/run-worker.mjs` blob 5e4bff2
- `buildArgs` at `fleet/run-worker.mjs:256` blob 5e4bff2
- `roleForLabel` at `fleet/run-worker.mjs:192` blob 5e4bff2
- `examiner` at `fleet/tests/test_exam_dispatch_role.mjs:54` blob 051dad7
- `reviewer` at `fleet/tests/test_roles_peer.mjs:42` blob 4847687
- `critic` at `fleet/run-main.mjs:641` blob d0a320f
- `composeAgent` at `fleet/run-main.mjs:384` blob d0a320f
- `claude` at `fleet/tests/test_doctor.mjs:292` blob 130b27c
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fleet/tests/test_sandbox_boot.mjs` blob ec8ba1e
- `ASSIGNMENT` at `fleet/tests/_sandbox_boot_helpers.mjs:88` blob 600e712
- `fleet/tests/test_run_main.mjs` blob 8335fb7
- `spawnFn` at `fleet/tests/test_run_main.mjs:193` blob 8335fb7
- `assignment` at `fleet/janitor.mjs:143` blob e084e38

**Proof:**
- Test: `fleet/tests/test_launch_effort.mjs`
- Test: `fleet/tests/test_sandbox_boot_effort.mjs`
- Test: `fleet/tests/test_run_main_effort.mjs`
- Legs: (a) for each of `low`, `medium` and `high`, a green launch with
  `--implementer-effort <v>` and `--tier mostCapable` yields a comment ending `tier=mostCapable
  effort=<v>`; a launch with `--implementer-effort low` and no `--tier` yields a comment
  ending `engine=<sha> effort=low`; one with `--implementer-effort xhigh` is a refusal whose
  message names `low`, `medium` and `high`; one without the flag yields the comment BASE's
  launch yields; `COMMENT_KEYS` ends with `effort` and `USAGE` contains `--implementer-effort
  low|medium|high` [M1]; (b) for each of `low`, `medium` and `high`, the boot sim with an
  assignment carrying `effort=<v>` records an engine argv whose last two words are
  `--implementer-effort` and `<v>` after the tier and overlap knobs; the helper's assignment
  without the key records the argv the green-path sim pins; and `effort=max` fails the boot
  with `assignment` in its failure line [M2]; (c) for each of `low`, `medium` and `high`,
  `composeAgent` given `implementerEffort: <v>` and a fake `claude` that records argv:
  `impl:T1` and `fix:T1:0` dispatches carry `--effort <v>`, and `exam:T1`, `review:T1:1`,
  `integration`, `resolve:x`, `merge:1` and `reconcile:1` carry no `--effort`; given no
  `implementerEffort`, none of the eight carries `--effort`; and `run-main`'s flag-to-arg map
  turns `--implementer-effort` into `implementerEffort` [M3]; (d) all three
  sims print `ALL TESTS PASSED`.
- Run: node fleet/tests/test_launch_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launcher and lobby sim's sentinel [M1].
- Run: node fleet/tests/test_sandbox_boot_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the boot sim's sentinel [M2].
- Run: node fleet/tests/test_run_main_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the engine-end sim's sentinel [M3].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing launch sim, whose comment pin holds without the flag
  [M1].
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing boot sim, whose argv pin holds without the key [M2].
- Run: node fleet/tests/test_run_main.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing run-main sim [M3].
- Run: grep -A3 '^- \*\*Comment\*\*' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'tier=standard|mostCapable., .effort=low|medium|high'
- The previous bullet reads only the contract's Comment bullet and its three continuation
  lines, wraps joined, and pins the new key directly after `tier=` (the dots stand for the
  backticks around each key, which a Run: command may not carry) [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents, which reads the
  launcher's usage string [M1] [M4].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`
- path-absent: `fleet/run-worker.mjs`
- issue-closed: #522
