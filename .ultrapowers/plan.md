# The janitor writes the death

**Grammar:** claims-v1

**Claim:** After this run, when a sandbox dies mid-run the janitor writes the death into the
record — the run's evidence branch says `failed`, carrying the unit's result with the journal
tail beside it — and the VM then goes the way of any finished run; a run whose unit is still
in flight is left alone. (elicited)

**Goal:** Give the janitor the half #607 decided on 2026-09-05: a sandbox that dies
mid-transition cannot file its own death certificate, so the janitor reads the run unit over
ssh (`systemctl --user show fleet-run@<N>.service`, the read Shelley blessed in Counsel 3
§2c) for every row whose page still says the run is in flight, and when systemd says the
unit has failed — or timed out — it commits the transition to `failed` on
`ultra/evidence-run-<N>` with the unit's `Result`/`ExecMainStatus` in `error` and the unit's
journal tail as a file beside the page. The reap then proceeds by the ordinary rule. No PR,
no notification; a unit that is `activating` or `active/running` with a stale page is in
flight and is left alone. `fleet/launch.mjs` keeps importing `janitor({ argv, exec, config,
now })` unchanged.
**Closes:** #607

**Tech Stack:** Node 24 ESM (`fleet/janitor.mjs`, the sims under `fleet/tests/`, each
printing `ALL TESTS PASSED`, joined to the Python suite by `tests/test_fleet_suite.py`);
`gh api` on the laptop for every read and write of the target; `ssh <ssh_dest>` for the
unit and its journal. Nothing is added to any dependency file.

**Spec:** #607 (the decision of 2026-09-05 is the issue's last comment; there is no separate
spec document).

**Parallelization rationale:** One wave, width 1. The behaviour change and the exam it
breaks are one task: `fleet/tests/test_janitor.mjs` pins at BASE that the janitor issues no
`ssh <ssh_dest>` at all, and the first unit read falsifies that pin, so the janitor and that
exam move together (a behaviour change owns every existing pin of it). The new surface —
liveness — gets its own exam file, `fleet/tests/test_janitor_liveness.mjs`.

## Global Constraints

- The launcher, the boot script, the lobby, the contract and the runbook are
  byte-identical to BASE: this plan changes the janitor and its exams and nothing else.
- Check: test "$(git hash-object fleet/launch.mjs)" = a2bcd0491f5af05f77606c747c8f4f6bc3659138
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 7cf62ab22f21a5664e26f9ba0c0130f4c05da01f
- Check: test "$(git hash-object fleet/lobby.mjs)" = 2f6289f1de89b48f5090b6a40d11a3d10c34b8b4
- Check: test "$(git hash-object fleet/CONTRACT.md)" = a91fa2bb3bde04fa34396f6580a11f56e6e4bd8d
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = 7a45c72253c10632d1c914230df166b7d0934d70
- The janitor's exports keep their shape: `janitor({ argv, exec, config, now })` and
  `renderJanitor(result)` are the functions `fleet/launch.mjs` imports at BASE.
- Check: node --input-type=module -e "const m = await import('./fleet/janitor.mjs'); if (typeof m.janitor !== 'function' || typeof m.renderJanitor !== 'function') process.exit(1)"
- The janitor runs no `git` and clones nothing: its reads and its writes of the target both
  go through `gh api`, and its only lobby mutation is still `rm`.
- Every value interpolated into a remote command string passes `isRunNumber` or `isVmName`
  first; a row's `ssh_dest` is handed to `ssh` as its own argv element, never into a shell
  string.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The janitor reads the unit and writes the death

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/tests/test_janitor.mjs`
- Test: `fleet/tests/test_janitor_liveness.mjs`

**Claim:** When a sandbox's run unit has failed while its page still says the run is in
flight, the janitor writes `failed` into the run's record with the unit's result and the
journal tail beside it, and the VM then goes the way of any finished run; a unit still
running is left alone. (derived)
Machine: M1. For each `ls 'fleet-r*' --json` row whose evidence page (read as at BASE, off
`repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`) has
`state` `booting`, `running` or `publishing`, the janitor issues exactly one `ssh` whose
destination is the row's own `ssh_dest` field and whose remote command is
`XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@<N>.service -p ActiveState -p SubState -p Result -p ExecMainStatus`
with `<N>` the row's run; a row whose page says `done`, a row whose page says `parked`, a
row whose page says `failed`, a row with no page (404) and a row with no readable
assignment each draw no `ssh <ssh_dest>` command at all.
M2. When that read exits 0 and its output carries `ActiveState=failed`, or carries
`Result=timeout`, the janitor writes the death: exactly one `gh api -X PUT
repos/<target>/contents/.ultrapowers/runs/<N>/status.json` carrying `-f
branch=ultra/evidence-run-<N>`, `-f sha=<the sha of the contents envelope the page was read
from>`, an `-f message=` field, and `-f content=<base64>` that decodes to the page as read
with `state` `failed`, `updatedAt` the janitor's clock as ISO-8601, and `error` a string
containing `Result=<the unit's Result>`, `ExecMainStatus=<the unit's ExecMainStatus>` and
the state the page had said — `run`, `pr`, `branch`, `vm` and `startedAt` unchanged.
M3. Beside it, the journal: for each written death exactly one more `ssh` to the same
`ssh_dest` whose remote command is
`journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200`, and exactly one
`gh api -X PUT repos/<target>/contents/.ultrapowers/runs/<N>/janitor-journal.txt` carrying
`-f branch=ultra/evidence-run-<N>`, an `-f message=` field and `-f content=<base64>`
decoding to that read's stdout byte for byte, with no `sha=` field.
M4. The death is reported, and reaped only by the ordinary rule: the result carries
`deaths`, one entry per written death shaped `{ vm, run, state, unit, applied }` where
`state` is the page's and `unit` is `{ ActiveState, SubState, Result, ExecMainStatus }` as
read; `renderJanitor` prints for each a line beginning `death <vm>  run=<N> ` that contains
`Result=<r>` and `ExecMainStatus=<n>` and ends with `ultra/evidence-run-<N>`; the pass that
wrote the death issues no `rm <vm> --json` for that row; a later pass, more than `--age`
after the write, over a fleet where that row's page is the written page, issues `rm <vm>
--json` for it with an action shaped exactly as at BASE and no `ssh <ssh_dest>` for it; and
`dryRun`, `age`, `actions`, `stale` and `unknown` keep their BASE shapes.
M5. Nothing else is written, and no `git` is ever run: a unit read answering
`ActiveState=active` with `SubState=running`, one answering `ActiveState=activating`, one
answering `ActiveState=active` with `SubState=exited` and `Result=success`, one answering
`ActiveState=inactive` with `SubState=dead` and `Result=success`, an `ssh` exiting 255, and
an `ssh` exiting 0 with empty output each yield no `gh api` call carrying `-X`, no
`journalctl` read, no `deaths` entry and no `rm`, the row treated exactly as at BASE — in
`stale` shaped `{ vm, run, state, lastUpdate, from }` when its `updatedAt` is six hours old,
in nothing otherwise — and no `git` command is issued in any pass of this exam.
M6. Under `--dry-run` a dead unit draws the same unit read, no `gh api` call carrying `-X`,
a `deaths` entry with `applied` `false`, and a rendered line beginning `would write death
<vm>  run=<N> `.
M7. `fleet/tests/test_janitor.mjs`, `fleet/tests/test_janitor_reap_only.mjs`,
`fleet/tests/test_launch_reaps.mjs` and `fleet/tests/test_launch.mjs` each print `ALL TESTS
PASSED` on the tree, and `fleet/tests/test_janitor_reap_only.mjs` and the shared fixture
`fleet/tests/_lobby_helpers.mjs` are byte-identical to BASE.

**Authorized-by:** #607 (decision of 2026-09-05, the issue's last comment); the fleet
contract's unit-state table (`fleet/CONTRACT.md`, the setup-script bullet) and its
`journalctl` literal; Counsel 3 §2c.

**Interfaces:**
- Consumes: none
- Produces: `janitor({ argv, exec, config, now }) -> { dryRun, age, actions, stale, unknown, deaths }`
- Produces: `renderJanitor(result) -> string`

**Context:** How the janitor reads today: `fleet/janitor.mjs` lists the fleet with
`listVms` (`fleet/lobby.mjs:367`), whose rows carry `name`, `sshDest`, `comment`; reads each
run's page with `readEvidence` (`fleet/janitor.mjs:94`) — one `gh api <path>` through the
exec seam, whose answer is the contents envelope: `content` (base64), `encoding`, and `sha`,
the blob sha of the file as it sits on the branch. Today only `content` is decoded; the
write needs `sha`, so keep the envelope's `sha` beside the decoded page. The write goes
through `gh api` too — that is the code shape the janitor already has (no clone, no `git`,
the contract's "no ssh into any VM" was the pre-decision rule and #607 lifts it for this
one read): GitHub's contents API updates a file with `PUT
/repos/<owner>/<repo>/contents/<path>` and a JSON body of `message`, `content` (base64),
`branch`, and `sha` (required for an existing file, omitted for a new one — 422 otherwise);
`gh api -X PUT <path> -f message=… -f content=… -f branch=… -f sha=…` sends exactly that,
`-f` being gh's string-field flag, and answers `{ content: { sha }, commit: { sha } }` on
201/200. A non-zero exit from a PUT (a 409/422 because the sandbox pushed between the read
and the write) is recorded on the `deaths` entry as `applied: false` with the output under
`error`, and nothing retries: the next pass reads the fresh page. Rows shaped by the
sims: `test_janitor.mjs` cans `gh api` with `cmdRule('gh', 'api', …)`, which matches on
`argv[0] === 'api'` and finds the path as the first argv element starting `repos/`, so a
`gh api -X PUT repos/…` line — `argv` `['api', '-X', 'PUT', 'repos/…', '-f', …]` — is still
matched by that rule and still found by that scan; keep the path after `-X PUT` and every
field as its own `-f key=value` element (base64 has no `=`-ambiguity: split on the first
`=`).

The unit read is the literal above, one argv element after the destination:
`exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', row.sshDest, command])`.
`XDG_RUNTIME_DIR=/run/user/$(id -u)` is expanded by the VM's shell, not the laptop's, so
the `$(id -u)` travels as text. The `-o` pairs are free: the fixture's `exec.vm()`
(`fleet/tests/_lobby_helpers.mjs:99`) strips every `-o <value>` pair and answers `{ dest,
command }`, and `sshRule`/`vmRule` tell a lobby verb (`argv[0] === 'exe.dev'`) from a VM
command (any other first argument) — a `vmRule((cmd, argv) => …)` can answer per
destination by reading `argv` after the `-o` pairs. `BatchMode`/`ConnectTimeout` matter
because `fleet/launch.mjs:376` runs the janitor before every launch, and a VM that is dark
must cost a launch fifteen seconds, not hang it. `systemctl show` answers one `key=value`
per line (`ActiveState=failed`, `SubState=failed`, `Result=exit-code`, `ExecMainStatus=1`;
over the 6 h budget `Result=timeout`); parse the four keys and treat a non-zero exit, an
empty answer or a missing `ActiveState` as "unit unreadable" — which is what every existing
sim answers for an unruled `ssh <ssh_dest>` (`makeExec` with `passthrough: []` returns
`{ code: 0, stdout: '' }`), and is why `test_launch*.mjs` and `test_janitor.mjs`'s fleets,
which can no VM answer, keep their BASE outcomes. The unit is read only for pages in
`booting|running|publishing`: a page already `done|parked|failed` has nothing to
cross-check, and a row with no page at all (a boot that never committed evidence) has no
page to transition, so it stays as at BASE — reported `stale` off the plan commit's age
after six hours — and #607's out-of-band probe for it is not this task.

The journal read is the contract's own literal (`fleet/CONTRACT.md`, "Logs without an env
var"): `journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200` needs no
`XDG_RUNTIME_DIR` because a field match asks the journal directly. Its stdout (or, on a
non-zero exit, stdout and stderr joined) is the file's content, written as
`.ultrapowers/runs/<N>/janitor-journal.txt` on the evidence branch — a new file, so no
`sha=`. Write the journal file before the status page: the page's transition is then the
branch's last commit, as the sandbox's own transitions are.

The written page is the read page with three cells changed — `state`, `updatedAt` (the
injected `now()` as ISO, the same clock the reap uses), `error` (for example
`janitor: fleet-run@7.service ActiveState=failed SubState=failed Result=exit-code ExecMainStatus=1 while the page said running`)
— so `phase`, `pr`, `prAuthor`, `merged`, `branch`, `vm`, `startedAt` ride through
untouched. Because `updatedAt` is now, the ordinary reap (`REAPABLE_STATES` and `--age`,
`fleet/janitor.mjs:180`) does not fire in the same pass; the next pass an hour on finds a
`failed` page older than `--age` and issues the `rm` — the hour is the operator's window to
ssh in, and the record already holds the journal. Under `--dry-run` the unit is read (a
read, like every other), nothing is PUT, and the `deaths` entry says `applied: false`;
the journal read may be skipped under `--dry-run`.

`fleet/tests/test_janitor.mjs` pins at BASE, across every fleet it builds, that
`exec.vm()` is empty ("the janitor issues no ssh <ssh_dest> command", its last loop) —
its LEG_A fleet carries `running`, `booting` and `publishing` rows, so that pin is
falsified by design. Replace that one assertion with: every `exec.vm()` entry's `dest` is
the `ssh_dest` of a row whose page said `booting|running|publishing`, and its `command`
begins `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@` or
`journalctl _SYSTEMD_USER_UNIT=fleet-run@`; keep the "no git" assertion beside it and
update the header's M3 sentence. Every other pin there — the `gh api` paths, the `rm`
set, `stale`, `unknown`, `--dry-run`, the `~/.ultrapowers/` canary — holds unchanged,
because an unruled VM ssh answers empty and empty is "unreadable, leave alone".
`fleet/tests/test_janitor_reap_only.mjs` pins, over a fleet of two `done` rows, that every
`gh` call is two argv words with no flag — those rows draw no unit read and no write, so it
holds as it is and is pinned byte-identical above.

The new exam `fleet/tests/test_janitor_liveness.mjs` uses the same rig: `makeExec({ rules,
passthrough: [] })`, `sshRule('ls ', …)` answering `vmsPayload(rows)`, `sshRule('rm ',
answer(''))`, a `cmdRule('gh', 'api', …)` that answers the envelope — with a `sha` — for a
GET and a `{ content: { sha }, commit: { sha } }` answer for a `-X PUT`, recording the PUT's
fields, and a `vmRule` answering the canned `systemctl show` text or journal text by
destination and command. `vmRow(name, extra)` already sets `ssh_dest` to
`exedev@<name>.ssh.exe.xyz` — deliberately not `<name>.exe.xyz` — so a janitor that derives
the destination from the name is caught by an equality on `dest`. Nothing here touches the
network; there is no PATH shim to arrange, the seam is the stub.
**BASE facts:** (generated at e04154b)
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea
- `state` at `fleet/claude-token.mjs:54` blob 356883f
- `running` at `fleet/tests/test_sandbox_boot_merge.mjs:137` blob bed2fad
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `updatedAt` at `fleet/janitor.mjs:175` blob 236dc2f
- `error` at `evals/ab_runner.py:65` blob 7877c9d
- `run` at `fleet/doctor.mjs:483` blob 5e0d5c9
- `pr` at `fleet/tests/test_sandbox_boot.mjs:294` blob ec8ba1e
- `branch` at `fleet/janitor.mjs:108` blob 236dc2f
- `vm` at `fleet/launch.mjs:420` blob a2bcd04
- `startedAt` at `fleet/tests/test_setup_script.mjs:305` blob 32f2a4d
- `unit` at `fleet/lobby.mjs:333` blob 2f6289f
- `renderJanitor` at `fleet/janitor.mjs:214` blob 236dc2f
- `dryRun` at `fleet/janitor.mjs:132` blob 236dc2f
- `age` at `fleet/claude-token.mjs:133` blob 356883f
- `actions` at `fleet/janitor.mjs:146` blob 236dc2f
- `stale` at `fleet/doctor.mjs:258` blob 5e0d5c9
- `unknown` at `fleet/janitor.mjs:148` blob 236dc2f
- `git` at `fleet/lobby.mjs:252` blob 2f6289f
- `applied` at `fleet/run-engine.mjs:1593` blob ab943ea
- `fleet/tests/test_janitor.mjs` blob 7fa3cd3
- `fleet/tests/test_janitor_reap_only.mjs` blob adc4ac2
- `fleet/tests/test_launch_reaps.mjs` blob 1031e90
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `fleet/CONTRACT.md` blob a91fa2b
- `fleet/janitor.mjs` blob 236dc2f
- `listVms` at `fleet/lobby.mjs:367` blob 2f6289f
- `fleet/lobby.mjs:367` blob 2f6289f line 367 `export async function listVms (exec, pattern = FLEET_PATTERN`
- `name` at `fleet/doctor.mjs:310` blob 5e0d5c9
- `comment` at `fleet/launch.mjs:411` blob a2bcd04
- `readEvidence` at `fleet/janitor.mjs:94` blob 236dc2f
- `fleet/janitor.mjs:94` blob 236dc2f line 94 `async function readEvidence (exec, target, run) {`
- `sha` at `fleet/launch.mjs:207` blob a2bcd04
- `argv` at `fleet/run-worker.mjs:258` blob ae07261
- `fleet/tests/_lobby_helpers.mjs:99` blob 86c4674 line 99 `exec.vm = () => calls.filter((c) => isVmSsh(c.cmd, c.argv)).`
- `fleet/launch.mjs:376` blob a2bcd04 line 376 `const reap = await janitor({ argv: [], exec, config: setting`
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `merged` at `fleet/tests/test_run_engine_conflict.mjs:56` blob 79e3105
- `REAPABLE_STATES` at `fleet/janitor.mjs:72` blob 236dc2f
- `fleet/janitor.mjs:180` blob 236dc2f line 180 `if (REAPABLE_STATES.includes(state) && nowMs - updated >= ag`
- `dest` at `fleet/run-engine.mjs:1053` blob ab943ea
- `command` at `fleet/target.mjs:65` blob c189a05
- `vmRule` at `fleet/tests/_lobby_helpers.mjs:44` blob 86c4674
- `janitor` at `fleet/janitor.mjs:130` blob 236dc2f
- `now` at `fleet/tests/test_run_engine_exam_fix_edit.mjs:301` blob 747c5d5
- `of` at `skills/ultrapowers/kernel/frontier_fold.py:182` blob 4d1d20d

**Proof:**
- Test: `fleet/tests/test_janitor_liveness.mjs`
- Legs: (a) a fleet of a `booting` row, a `running` row and a `publishing` row (each page a
  minute old, each row's `ssh_dest` distinct), plus a `done` row two hours old, a `parked`
  row, a `failed` row, a row whose evidence answers 404 and a row with no comment, with the
  VM rule answering `ActiveState=active` / `SubState=running` / `Result=success` /
  `ExecMainStatus=0`: `exec.vm()` is exactly three entries, one per live row, each `dest`
  equal to that row's `exedev@<name>.ssh.exe.xyz` and each `command` equal to the
  `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@<N>.service -p ActiveState -p SubState -p Result -p ExecMainStatus`
  literal with that row's N, and — one assertion per row — no entry's `dest` is the `done`
  row's, the `parked` row's, the `failed` row's, the 404 row's or the no-comment row's
  [M1]; (b) three dead rows — a `running` page whose unit answers
  `ActiveState=failed` / `SubState=failed` / `Result=exit-code` / `ExecMainStatus=1`, a
  `publishing` page whose unit answers `ActiveState=failed` / `Result=timeout` /
  `ExecMainStatus=15`, and a `booting` page whose unit answers `ActiveState=inactive` /
  `SubState=dead` / `Result=timeout` / `ExecMainStatus=0` — each with its envelope carrying
  a distinct `sha`: for each, exactly one `gh` call has `-X` followed by `PUT` and the path
  `repos/<target>/contents/.ultrapowers/runs/<N>/status.json`, its `-f` fields include
  `branch=ultra/evidence-run-<N>`, `sha=<that envelope's sha>` and a `message=` field, and
  its `content=` field base64-decoded and parsed has `state` `failed`, `updatedAt` equal to
  the injected clock's ISO string, `error` containing `Result=exit-code` and
  `ExecMainStatus=1` and `running` (respectively `Result=timeout`, `ExecMainStatus=15`,
  `publishing`; and `Result=timeout`, `ExecMainStatus=0`, `booting`), and `run`, `pr`,
  `branch`, `vm`, `startedAt` deep-equal to the page as read [M2]; (c) for each of the
  three, `exec.vm()` carries exactly one entry with that `dest` and `command` equal to
  `journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200`, and exactly one
  `gh` call has `-X` followed by `PUT` and the path
  `repos/<target>/contents/.ultrapowers/runs/<N>/janitor-journal.txt`, its fields include
  `branch=ultra/evidence-run-<N>` and a `message=` field, its `content=` decodes to the
  canned journal text for that destination byte for byte, and no argv element of that call
  starts `sha=` [M3]; (d) the result's `deaths` deep-equals, per dead row, `{ vm, run,
  state: <the page's state>, unit: { ActiveState, SubState, Result, ExecMainStatus } as
  canned, applied: true }`; `renderJanitor(result)` has, per dead row, a line matching
  `^death <vm>  run=<N> .*Result=<r>.*ExecMainStatus=<n>.*ultra/evidence-run-<N>$`;
  `exec.mutating()` contains no `rm` naming any dead row; a second `janitor` call with
  `now` two hours later, over a fleet whose page for the first dead row is the parsed
  `content=` of its status PUT, has `exec.mutating()` equal to `['rm <vm> --json']`, its
  `actions` deep-equal to `[{ kind: 'rm', vm, run, state: 'failed', updatedAt: <the written
  updatedAt>, command: 'rm <vm> --json', applied: true }]`, and an `exec.vm()` of `[]`; and
  in the first pass `result.dryRun` is `false`, `result.age` is `'1h'`, `result.stale` is
  `[]`, `result.unknown` is `[]` and `result.actions` is `[]` [M4]; (e) six `running` rows,
  one per case — `ActiveState=active` with `SubState=running`; `ActiveState=activating`;
  `ActiveState=active` with `SubState=exited` and `Result=success`; `ActiveState=inactive`
  with `SubState=dead` and `Result=success`; an ssh answering exit 255 with empty stdout;
  an ssh answering exit 0 with empty stdout — the first with its page seven hours old, the
  rest a minute old: no `gh` argv contains `-X`, `exec.vm()` has exactly six entries and
  none whose `command` starts `journalctl`, the result's `deaths` is `[]`, `exec.mutating()` is
  `[]`, `result.stale` deep-equals `[{ vm, run, state: 'running', lastUpdate: <the
  seven-hour-old updatedAt>, from: 'ultra/evidence-run-<N>' }]` for the first row alone;
  and across every exec this exam built, `exec.calls.filter((c) => c.cmd === 'git')` is
  `[]` [M5]; (f) `--dry-run` over the three-dead-row fleet of the second leg: the unit-read entries of `exec.vm()`
  equal the wet pass's, no `gh` argv contains `-X`, every `deaths` entry has `applied`
  `false`, and `renderJanitor` has, per dead row, a line matching `^would write death <vm>
  run=<N> ` [M6]; (g) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_janitor_liveness.mjs > /tmp/janitor-liveness.out && grep -q 'ALL TESTS PASSED' /tmp/janitor-liveness.out
- The previous bullet is the new sim's sentinel [M1] [M2] [M3] [M4] [M5] [M6].
- Run: node fleet/tests/test_janitor.mjs > /tmp/janitor.out && grep -q 'ALL TESTS PASSED' /tmp/janitor.out
- The previous bullet is the existing expiry exam, its "no ssh" pin narrowed to live rows [M7].
- Run: node fleet/tests/test_janitor_reap_only.mjs > /tmp/janitor-reap-only.out && grep -q 'ALL TESTS PASSED' /tmp/janitor-reap-only.out
- The previous bullet is the reap-only exam, unchanged [M7].
- Run: node fleet/tests/test_launch_reaps.mjs > /tmp/launch-reaps.out && grep -q 'ALL TESTS PASSED' /tmp/launch-reaps.out
- The previous bullet is the launcher's reap exam, unchanged [M7].
- Run: node fleet/tests/test_launch.mjs > /tmp/launch.out && grep -q 'ALL TESTS PASSED' /tmp/launch.out
- The previous bullet is the launcher's own exam, unchanged, with its "nothing is ssh-ed into the VM" pin [M7].
- Run: test "$(git hash-object fleet/tests/test_janitor_reap_only.mjs)" = adc4ac2fd3206cc958485aa9bfc8d9e7ddb02166
- The previous bullet is the reap-only exam's frozen pre-edit blob sha [M7].
- Run: test "$(git hash-object fleet/tests/_lobby_helpers.mjs)" = 86c4674085d8fefc940938ef80553e4b945ebb34
- The previous bullet is the shared fixture's frozen pre-edit blob sha [M7].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- path-absent: `fleet/tests/test_janitor.mjs`
- path-absent: `fleet/tests/test_janitor_reap_only.mjs`
- issue-closed: #607
