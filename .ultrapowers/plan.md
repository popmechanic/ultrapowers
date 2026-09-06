# The sandbox folds its branch onto main at publish

**Grammar:** claims-v1

**Claim:** After this run, two plans that touch the same file can run at the same time on this
repository and both merge on their own — no 405, no hand rebase — and the second one's evidence
shows the fold it did onto main. (elicited)

**Goal:** #715 (Tier 2 of #360, chartered 2026-09-06, eleven decisions on the recommended
option). The signed design is `docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md`
(nineteen fresh-context review rounds; §3 mechanisms, §4 proof). Today the second of two runs
that touched one file meets git's three-way merge outside the engine — a hand rebase (run-27),
a merge PUT answering 405 (runs 8 and 10 on the 2×2 target), or the doctrine that forbids the
shape. After this run every sandbox folds its own integration branch onto main's tip in its own
sandbox before the head is pushed, re-runs the suite on the folded tree, opens its PR on that
head, retries the merge exactly once when main moved between the fold and the PUT, and records
the fold as a `driver:publish-fold` event plus a receipts directory on the evidence branch. The
kernel, the frozen gate scripts, the roles and `collect_evidence` are untouched. #715 is not
closed by this PR: it closes when its Tier-2 metric (three concurrent runs on overlapping files
within 1.2× of solo, zero refused PUTs, every cross-run resolver graded clean) is met on live
runs.

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`), bash (`fleet/sandbox-boot.sh`, `set -euo
pipefail`), the python kernel CLI `skills/ultrapowers/kernel/fold_wave.py` driven as a
subprocess; the sims use real git and the real kernel with the agent stubbed and every external
binary the boot script calls stubbed through a PATH shim. The suite is `python3 -m pytest` from
the repo root, which bridges every `fleet/tests/test_*.mjs`.

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is five wide — Task 1 (the `resolveConflicts`
extraction in `fleet/run-engine.mjs`), Task 2 (the contending block builder, a pure function
over git and the compiled plans), Task 4 (the boot script's publish path, sim-stubbed), Task 5
(the launcher's base-ancestry refusal) and Task 6 (the contract prose) touch five disjoint
files and share only literals, which every Context carries. Wave 2 is Task 3 alone, the folder:
it imports `resolveConflicts` from `fleet/run-engine.mjs` and `contendingBlock` from
`fleet/publish-fold-block.mjs`, and its exam dispatches a resolver through that loop with that
block, so it needs both siblings' runtime behaviour (the exports must resolve at import time,
the single-retry loop must actually run under the folder's own `runCli`, and the block must
really read a tag off the origin), which no shared literal can stand in for — the one chain,
length two. Task 4 is not chained behind Task 3: its sim stubs the `fleet-fold-*` unit through
the shared `systemd-run` stub and never executes the folder, so the boot script's argv naming
`fleet/publish-fold.mjs` is a string the sim records, not a file the sim runs. Task 4 is one
task and not two, deliberately: `push_head`, `FOLD_HOLD`, the trailers, `MERGE_RETRY` and the
attempt-2 sequence are one contract read by one `do_boot` region and pinned by one sim file,
and two same-wave tasks appending cases to `test_sandbox_boot_merge.mjs` and branches to the
shared stub would be the adjacent-insert shape the fold sends to a resolver.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/ skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `bash -c 'diff <(git show $ULTRA_BASE:fleet/sandbox-boot.sh | sed -n "/^collect_evidence() {/,/^}/p") <(sed -n "/^collect_evidence() {/,/^}/p" fleet/sandbox-boot.sh)'`
- Check: `git diff --quiet $ULTRA_BASE -- fleet/roles/ fleet/claude-token.mjs fleet/janitor.mjs fleet/target.mjs fleet/doctor.mjs fleet/run-waves.mjs fleet/run-worker.mjs fleet/confine-hook.mjs`
- Check: `bash -n fleet/sandbox-boot.sh`
- The fold kernel (`skills/ultrapowers/kernel/`, the sha-pinned `vendor/manyana.py` most of
  all) and the frozen gate scripts are not the fix: the first Check above is the whole of that
  rule, and a mode park on a chmod main made since BASE is counted, not patched around.
- `collect_evidence` in `fleet/sandbox-boot.sh` is byte-identical to BASE (the second Check): a
  concurrent run (#702) owns that function, and every receipt this plan adds rides the evidence
  commit by being written directly into the evidence worktree, never by a list change there.
- Amendment 10 stands: no model runs git and no GitHub call is a model's. The resolver the
  folder may dispatch is the read-only `fleet/roles/resolver.md` role answering through
  `RESOLVER_SCHEMA`; the driver writes every reply directory, every ref move and every push.
- No token on any VM and none in any argv: the folder runs under the same edge-injected envelope
  as the engine (`ANTHROPIC_BASE_URL` at the proxy, `CLAUDE_CODE_OAUTH_TOKEN=placeholder`,
  `CLAUDE_CONFIG_DIR` unset at the unit and set to the run tree's `claude/` for workers).
- `status.json`'s shape is unchanged — the same ten cells; the fold's record is the
  `driver:publish-fold` event, the `publish-fold/` receipts directory and the PR body's
  `## Publish fold` section, never a new cell on the page.
- The wave loop's in-wave behaviour is unchanged by the extraction: same prompt, same labels,
  same reply-directory grammar, same park conditions; a run with no conflict dispatches nothing.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The resolver loop is a function the folder can call

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_conflict.mjs`

**Claim:** a narrated textual conflict dispatches the in-wave resolver — hunks file in, reply
dir out, one at a time, single retry (quoted from #715)
Machine: M1. `fleet/run-engine.mjs` exports `resolveConflicts({ agent, runCli, roles, common,
taskArgs, commutesArgs, open, contendingBlock, waveDir, labelPrefix, onEvent })`, which walks
`open` in order and, per conflict `{ i, path, hunksFile, epoch }`, calls
`agent(roles.resolver + '\nHUNKS FILE: ' + hunksFile + ' (conflicted path: ' + path + ')' +
contendingBlock, { label: labelPrefix + ':' + i + ':' + attempt, schema: RESOLVER_SCHEMA })`,
writes `<waveDir>/reply-<i>-<attempt>/<hunk id>.txt` (newline-terminated) and `notes.txt` from
the reply, runs `runCli(['resolve', ...common, '--conflict', String(i), '--reply-dir',
replyDir, ...taskArgs, ...commutesArgs])`, and resolves `{ ok: true, reason: '', transcripts,
selfChecks: 'ok' }` once the kernel answers `complete: true` with `selfChecks: 'ok'`.
M2. A `resolve` exit 4 re-dispatches the same conflict exactly once more with `\nPREVIOUS REPLY
REJECTED: <the kernel's reason>` inserted before `\nCONTENDING TASKS:`; a second exit 4, a reply
whose `status` is not `RESOLVED`, or a second null reply resolves `{ ok: false, reason }` with
`reason` naming the conflicted path (and the status, when the reply had one), and no conflict is
dispatched a third time; an `agent` error whose message starts `RUN_FATAL` is rethrown.
M3. `contendingBlock` reaches the prompt verbatim as its tail, and the wave loop's own call
supplies the block it built before the extraction — `\nCONTENDING TASKS:` followed by one
`\n- task <id>: <title> [files: <files joined by ', '>]` line per wave task and the sentence
`Their full verbatim task text lives in the JSON file at <wavesPath> — read the "tasks" array
entry whose "id" matches.` when `wavesPath` is set.
M4. The wave loop calls the function with the values it already holds (`common` =
`['--repo', '.', '--run-dir', runDir, '--wave', String(waveNumber)]`, `waveDir` =
`<runDir>/frontier/wave-<n>`, `labelPrefix` = `'resolve:wave' + waveNumber`), keeps
`blocked()` and the frontier entry to itself, appends the function's `transcripts` to its own
before calling `blocked(reason)` on `ok: false`, and both pre-existing shapes hold: two tasks
editing one line resolve to a `MERGED` wave whose tree carries both sides with
`selfChecks: 'ok'`, and a BLOCKED resolver ends the wave `CONFLICT` with the integration branch
unmoved and one transcript of status `BLOCKED` in `frontier[0].resolverTranscripts`.
M5. `onEvent`, when supplied, is called once per non-null reply with `{ kind:
'resolver:reply', label, conflict: i, attempt, status }`; when absent nothing is called and the
function behaves the same.

**Authorized-by:** #715 decision 3; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.3 (the loop), §3.8 (the one
licensed edit to `run-engine.mjs`).

**Interfaces:**
- Consumes: none
- Produces: `resolveConflicts({ agent, runCli, roles, common, taskArgs, commutesArgs, open, contendingBlock, waveDir, labelPrefix, onEvent }) -> Promise<{ ok, reason, transcripts, selfChecks }>`

**Context:** This is a mechanical move, not a redesign. The loop lives today inside
`runEngine`'s wave loop in `fleet/run-engine.mjs` (the `worklist:` labelled `while
(outstanding.length)` block, roughly lines 1550–1660 at BASE): one resolver at a time per
narrated conflict, `roles.resolver` + `HUNKS FILE:` + `PREVIOUS REPLY REJECTED:` on the single
retry + `CONTENDING TASKS:` + the `launch.json` pointer, the driver-written reply directory
(`h<k>.txt` per hunk — the id stripped to `[A-Za-z0-9]` for the filename — plus `notes.txt`),
`resolve` driven with the same `common`/`taskArgs`/`commutesArgs` as `fold`, the `waiting` /
`open` / `complete` continuation rules, and `blocked(...)` on every park. Only `RESOLVER_SCHEMA`
and `loadRoles` are exported at BASE; the loop is not a function. The extraction keeps every
rule and every wording of the `blocked` reasons — the function returns the reason string and
the wave loop passes it to its existing `blocked()`, which still writes `frontier`,
`judgmentCalls` and the wave status and stays where it is. `runCli` is the caller's closure
(the wave loop's counts `calls`, `wallSec`, `autoResolved`; the folder's own), so the function
takes it as an argument and never builds one. `transcripts` is a fresh array the function
returns; the wave loop's `entry()` reads its own `transcripts`, so on `ok: false` the wave loop
pushes the returned entries into its array first and then calls `blocked(reason)` — a reader of
`resolverTranscripts` sees exactly what it saw before. The null-reply rule stays: a first null
reply is retried with the rejection text `the previous resolver produced no reply (transient
death) — resolve afresh`, a second returns `ok: false` with `resolver dispatch returned no
reply twice on <path>`. The `RUN_FATAL` rethrow stays inside the function (a dead credential
must surface as the engine crash it is, review finding 4 of the cutover). The wave loop's
`contendingBlock` is built by the caller from `waveTasks` and `wavesPath` exactly as the inline
code builds it today; the folder — a sibling task in this plan — will call the same function
with its own block (verbatim task bodies, run-qualified entries), an empty `commutesArgs`, its
own `common` (`--repo <target clone> --run-dir <run dir>/publish-fold --wave <attempt>`) and
`labelPrefix` `resolve:publish-fold:<attempt>`, so nothing in the function may assume the
wave loop's directory layout, the `.` repo path or the `wave` label. `onEvent` is optional and
the wave loop passes none; it exists so a caller can count replies without reading
transcripts. The exam extends `fleet/tests/test_run_engine_conflict.mjs`, whose two existing
shapes (resolved → `MERGED`, BLOCKED → `CONFLICT`) use `rig` from `_engine_helpers.mjs` with a
stub agent keyed on the label prefix; the new legs sit under a comment naming this task and
call `resolveConflicts` directly with a stub `agent` and a stub `runCli` that answers the
kernel's JSON shapes (`{ applied: true, complete: true, selfChecks: 'ok' }`; `{ code: 4, parsed:
{ reason } }` for a rejection) so the retry and park rules are examined without a second kernel
run, plus the captured prompt of the existing resolved shape for M3.

**Proof:**
- Test: `fleet/tests/test_run_engine_conflict.mjs`
- Legs: (a) `resolveConflicts` called directly with `open` of one conflict `{ i: 0, path:
  'a.txt', hunksFile: <a file holding one `HUNK h1 ` header>, epoch: 1 }`, a stub agent that
  answers `RESOLVED` with one hunk `h1`, a stub `runCli` answering `{ applied: true, complete:
  true, selfChecks: 'ok' }`, `waveDir` a temp directory and `labelPrefix` `resolve:publish-fold:1`
  resolves `ok: true` with `selfChecks: 'ok'` and one transcript; the agent saw exactly one
  dispatch labelled `resolve:publish-fold:1:0:1` whose prompt starts with `roles.resolver`,
  carries `HUNKS FILE: <that file> (conflicted path: a.txt)` and ends with the supplied
  `contendingBlock` verbatim; `<waveDir>/reply-0-1/h1.txt` holds the hunk content
  newline-terminated and `notes.txt` the notes; the stub `runCli` received exactly one call
  whose argv deep-equals `['resolve', ...common, '--conflict', '0', '--reply-dir', <that dir>,
  ...taskArgs, ...commutesArgs]` with `common` = `['--repo', 'x', '--run-dir', 'y', '--wave',
  '1']`, `taskArgs` = `['--patch', 'main=m.patch', '--patch', 'run-7=r.patch']` and
  `commutesArgs` = `['--commutes', 'run-7=a.txt']` verbatim, and with `commutesArgs` `[]` the
  argv ends exactly at `...taskArgs`; and with `open` of two conflicts `i: 0` on `a.txt` and
  `i: 1` on `b.txt`, `runCli` answering `{ applied: true, waiting: [1] }` for conflict 0 and
  `{ applied: true, complete: true, selfChecks: 'ok' }` for conflict 1, the agent sees exactly
  two dispatches labelled `resolve:publish-fold:1:0:1` then `resolve:publish-fold:1:1:1` in
  that order, two transcripts in that order, and `ok: true` [M1]; (b) with `runCli` answering `{ code: 4, parsed: { reason: 'bad
  hunk' } }` on every `resolve`, the same call dispatches exactly two times — the second prompt
  containing `PREVIOUS REPLY REJECTED: bad hunk` immediately before `CONTENDING TASKS:` and the
  first containing no `PREVIOUS REPLY REJECTED` — writes `reply-0-1` and `reply-0-2`, and
  resolves `ok: false` with `reason` `resolver reply rejected twice on a.txt: bad hunk`; with
  the agent answering `{ status: 'BLOCKED', notes: 'cannot' }` it dispatches exactly once, calls
  `runCli` zero times and resolves `ok: false` with `reason` `resolver reported BLOCKED on
  a.txt`; with the agent answering `null` twice it resolves `ok: false` with the
  `returned no reply twice` reason after exactly two dispatches; with the agent throwing
  `new Error('RUN_FATAL: dead')` the call rejects with that same error [M2]; (c) the existing
  resolved shape (two tasks A and B editing `a.txt` line 2) records the resolver's prompt, and
  that prompt contains `\nCONTENDING TASKS:`, the line `- task A: A edits line2 [files:
  a.txt]`, the line `- task B: B edits line2 [files: a.txt]` in that order after it, and the
  text `read the "tasks" array entry whose "id" matches` when the rig sets `wavesPath` — and a
  rig with no `wavesPath` yields a prompt with no `Their full verbatim task text` sentence [M3];
  (d) the existing resolved shape still ends `waveMerges[0].status === 'MERGED'` with both
  `line2 from A` and `line2 from B` in the integration tip's `a.txt`, `gitVerified` true and
  `frontier[0].selfChecks === 'ok'`; the existing BLOCKED shape still ends `CONFLICT` with
  `a.txt` at the integration tip equal to `line1\nline2\nline3`, `blockedWaves.length === 1`, and
  `frontier[0].resolverTranscripts` of length exactly 1 with `status` `BLOCKED` and `attempt` 1
  — a wave loop that dropped the returned transcripts fails on that length; and in both
  existing shapes the resolver stub's recorded label is exactly `resolve:wave1:0:1` and
  `frontier[0].resolverTranscripts[0].replyDir` equals exactly
  `<runDir>/frontier/wave-1/reply-0-1` (the rig's `runDir` joined by the exam), so a wave loop
  passing any other `labelPrefix` or `waveDir` fails [M4]; (e) the direct
  call of the first leg with an `onEvent` spy receives exactly one event `{ kind:
  'resolver:reply', label: 'resolve:publish-fold:1:0:1', conflict: 0, attempt: 1, status:
  'RESOLVED' }`, the rejected-twice call receives exactly two with attempts 1 and 2, and the
  same calls without `onEvent` resolve the same `ok` and `reason` and throw nothing [M5].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_conflict.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #715

### Task 2: The contending block for a cross-run conflict

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/publish-fold-block.mjs`
- Test: `fleet/tests/test_publish_fold_block.mjs`

**Claim:** with the contending-context block rebuilt from this run's task bodies plus the merged
run's plan read off its `ultra/plan/run-<M>` tag (M found from main's merge commits since BASE)
(quoted from #715)
Machine: M1. `fleet/publish-fold-block.mjs` exports `contendingBlock({ repo, base, tip, run,
path, tasks })`, which resolves a string beginning `\nCONTENDING TASKS:\nThe frontier side of
each hunk is main since this run's base; the incoming side is labeled run-<run> in the hunks.`
followed by one entry per first-parent commit of `<base>..<tip>` touching `<path>` in `repo`,
oldest to newest, then this run's entries — `- run <run> task <id>: <title> [files: <files
joined by ', '>]` and a newline and the task's `body` verbatim, in the order of `tasks`, one
entry per task of `tasks` whose `files` contains `<path>` — and nothing else.
M2. A frontier commit carrying the trailer `Fleet-Run: <M>` contributes, after `git fetch origin
refs/tags/ultra/plan/run-<M>` in `repo`, one `- run <M> task <id>: <title> [files: …]` entry
plus a newline and the verbatim body per task of run M's plan whose Files name `<path>`, the
plan read as `refs/tags/ultra/plan/run-<M>:.ultrapowers/plan.md` into a temporary file and
compiled with `skills/ultrapowers/scripts/compile_plan.py` for its `tasks` array; a commit
with no `Fleet-Run` trailer, and a trailered commit whose tag the origin does not have,
contribute exactly one line `- main <sha7> "<subject>" (<author>, no plan)`; the block carries
no branch name, no plan path and no repository path.
M3. A `<path>` no frontier commit touched yields a block with the heading, the sentence and
this run's entries only; `tasks` naming no task whose `files` contains `<path>` yields no
`- run <run>` entry.

**Authorized-by:** #715 decision 3; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.3 (the block, the trailer).

**Interfaces:**
- Consumes: none
- Produces: `contendingBlock({ repo, base, tip, run, path, tasks }) -> Promise<string>`

**Context:** The block is what a cross-run resolver reads as `CONTENDING TASKS:` — in-wave the
engine writes a title line per task plus a pointer into this run's `launch.json`; cross-run
there is no one file to point at, because run M's plan lives on a tag, so the block embeds the
bodies verbatim (a program transcribes nothing through a model). Entries are run-qualified
because task ids collide across plans. The frontier side is main since BASE: `git log
--first-parent <base>..<tip> -- <path>` in `repo` (a full clone of the target with an `origin`
remote), per commit the trailer read with `--format=%H%x00%(trailers:key=Fleet-Run,valueonly)%x00%s%x00%an`
(an absent trailer is an empty field); the merge PUT a sibling task adds writes that trailer
into every squash commit from this change on, and the tag `ultra/plan/run-<M>` is pushed by
`record_tags` after the merge, so it can postdate the clone — fetch it per trailer, and treat
a fetch that fails (the remote lacks the tag) as the no-plan line. The plan on the tag is
`.ultrapowers/plan.md`; `compile_plan.py <file>` prints one JSON object whose `tasks` array
carries `{ id, title, body, files }` per task, the same shape `<run dir>/launch.json` holds —
the folder (a sibling task) passes `launch.json`'s `tasks` as this function's `tasks`, so the
incoming side is never a second parse. The resolver is dispatched whether or not every
frontier commit is attributable: a park on an unattributable side was a rule for a docket
frontier and is dropped, because main takes human commits on most days of this repository. No
contract line is synthesized into a cross-run hunk header. The exam builds a real repository
with a bare origin (`git init --bare --initial-branch=main`, a clone that seeds and pushes
`main`), a second clone that makes the frontier commits on `main` — one with a `Fleet-Run: 3`
trailer whose `ultra/plan/run-3` tag (a commit carrying `.ultrapowers/plan.md`, a claims-v1 or
legacy plan `compile_plan.py` accepts, with one task whose Files name the path) is pushed to the
origin only after the first clone was made, one human commit without a trailer, one trailered
`Fleet-Run: 4` commit whose tag is never pushed — and calls the export against the first clone.
Every fixture lives in its own temp directory (same-wave sims share one machine); `python3` is
real on the box.

**Proof:**
- Test: `fleet/tests/test_publish_fold_block.mjs`
- Legs: (a) main since BASE holds, oldest to newest: a trailered `Fleet-Run: 3` commit editing
  `a.txt` (its tag pushed to the origin after the clone; run 3's plan on that tag has two tasks,
  `T1` whose Files name `a.txt` and `T2` whose Files name only `z.txt`), a human commit editing
  `a.txt` with no trailer, a merge commit whose second parent is a side branch that edited
  `a.txt` (the merge's own first-parent diff touches `a.txt`, the side commit is not on the
  first-parent line), and a trailered `Fleet-Run: 4` commit editing `a.txt` whose tag is never
  pushed; `tasks` holds three entries in order — `A` naming `a.txt`, `B` naming only `b.txt`,
  `C` naming `a.txt` and `b.txt`; the exam builds the expected string itself from the fixture's
  sha7s, subjects, authors and bodies — the heading line, the sentence, `- run 3 task T1:
  <title> [files: a.txt]` plus a newline plus T1's body, the human commit's `- main <sha7>
  "<subject>" (<author>, no plan)`, the merge commit's `- main …` line, the run-4 commit's
  `- main …` line, `- run 7 task A: <title> [files: a.txt]` plus A's body, `- run 7 task C:
  <title> [files: a.txt, b.txt]` plus C's body — and asserts the returned string deep-equals
  it byte for byte, so a `T2` entry, a `B` entry, a side-commit line, a swapped order or any
  extra character fails; and the string contains no `refs/`, no `ultra/`, no `.ultrapowers/`,
  no `launch.json` and no filesystem path of the fixture [M1] [M2]; (b) the tag fetch is real: before the call the
  clone has no `refs/tags/ultra/plan/run-3`, after it the ref exists, and a run of the same
  fixture with the tag deleted from the origin turns run 3's entry into the `no plan` line with
  no thrown error [M2]; (c) with `<path>` set to `c.txt`, which no frontier commit touched, the
  string is the heading, the sentence and this run's `c.txt` entries only — no `- main` line and
  no `- run 3` line, and deep-equals the heading, the sentence and the `c.txt` entries built
  by the exam; with `tasks` naming no task whose `files` contains `<path>` the string
  deep-equals the heading plus the sentence and nothing more [M3].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #715

### Task 3: The folder — `fleet/publish-fold.mjs`

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/publish-fold.mjs`
- Test: `fleet/tests/test_publish_fold.mjs`

**Claim:** the sandbox folds its own integration branch onto **main's tip** at publish
(quoted from #715)
Machine: M1. `node fleet/publish-fold.mjs --repo <target clone> --base <BASE> --branch
ultra/integration-run-<N> --run <N> --run-dir <run dir> --evidence-dir <dir> --attempt 1|2`
runs the exported `publishFold(opts, deps)` and exits 0 for every disposition it names; before
any fetch on attempt 1 it writes `<evidence-dir>/publish-fold/engine-head` (the branch's sha as
the engine left it, `mkdir -p` first, written once and never rewritten) and mirrors it as
`engineHead` in `<evidence-dir>/publish-fold/receipt.json`, whose shape is `{ engineHead,
attempts: { "<attempt>": { tip, candidate, pushedHead, disposition, reason, path, pathsJoined,
resolversDispatched, suite } } }`; every write of the receipt goes to `receipt.json.tmp` then
`mv` (a `deps.rename` seam, `fs.renameSync` by default, is the only way the receipt's path is
written); `tip` is written right after step 1's fetch and TIP read (`git rev-parse
refs/remotes/origin/<default>`) and before the `TIP == BASE` comparison; the disposition is
read by callers from the receipt, never from stdout.
M2. With the default branch's tip TIP ≠ BASE and BASE an ancestor of TIP, the folder cuts
`main.patch` = `git diff --binary --full-index --no-renames <BASE>..<TIP>` (that argv, the range
as one two-dot word) and `run.patch` = the same diff `<BASE>..<engineHead>`, runs `fold_wave.py fold --repo <clone> --run-dir <run dir>/publish-fold
--wave <attempt> --base BASE --patch main=<main.patch> --patch run-<N>=<run.patch>` (main
first), on a clean fold runs `materialize --prev-head TIP --patch main=… --patch run-<N>=…
--subject "<plan H1>"`, moves `refs/heads/ultra/integration-run-<N>` to `candidateSha` with
`git update-ref` before the suite, and records disposition `folded` with `candidate` =
`candidateSha`, whose only parent is TIP and whose tree carries every path main changed since
BASE and every path the run changed — with `pathsJoined` = the number of paths both sides
touched, so two disjoint sides still fold (`pathsJoined: 0`, candidate on TIP); TIP == BASE
instead records disposition `nothing to join` with `pathsJoined: 0`, `candidate` =
`engineHead`, leaves the branch untouched and invokes the kernel zero times.
M3. The suite: top-level `testCmd` from `<run dir>/args.json` runs in `<run dir>/clones/integration`
after `git fetch --no-tags <target clone> refs/heads/ultra/integration-run-<N>` into it and
`read-tree -u --reset <candidate>^{tree}`, through `bash -lc`, its output written to
`<evidence-dir>/publish-fold/suite-<attempt>.txt`, then `reset --hard` back to that clone's own
HEAD; exit 0 keeps `folded` with `suite: 'pass'`, non-zero records `suite red` with `suite:
'fail'` and the branch still at the candidate; an `args.json` with no `testCmd` records
`folded` with `suite: 'none'` and runs nothing.
M4. A textual conflict the kernel narrates is handed to `resolveConflicts` with `labelPrefix`
`resolve:publish-fold:<attempt>`, `commutesArgs` `[]`, `waveDir` =
`<run dir>/publish-fold/frontier/wave-<attempt>` (the kernel's own `--run-dir` tree, where the
reply directories are written), and `contendingBlock` = the string
`contendingBlock({ repo, base, tip, run, path, tasks })` answers for the conflicted path with
this run's `tasks` from `<run dir>/launch.json` — so the brief carries the trailered run's task
body read off its plan tag, a human commit's one-line notice and this run's task body, in that
order; before the first dispatch `clones/integration` has
`refs/remotes/origin/<default>` fetched by name from the target clone and TIP's tree checked out
(`read-tree -u --reset`), and that clone is restored with `reset --hard` on every exit, parked
dispositions included; each brief is saved as `<evidence-dir>/publish-fold/resolver-brief-<i>-<attempt>.txt`;
a resolved conflict continues to materialize and `folded` with `resolversDispatched` = the
number of resolver replies.
M5. A resolver reporting BLOCKED, a second rejected reply, a conflict the kernel narrates as
undispatchable (two sides on one binary path, a delete/modify pairing) or a kernel park records
`conflict parked` with `path` = the conflicted path and `candidate` = `engineHead` on attempt 1,
the branch untouched, and no materialize; a `materialize` answering `park` (a mode change on
main since BASE, on a path this run edited or not) and a BASE that is not an ancestor of TIP each
record `cannot fold` with `reason` = the kernel's reason or the ancestry text, the branch
untouched.
M6. Re-entry runs before any fetch of the default branch and keys on `disposition`: every
attempt with `tip` and no `disposition` has `<run dir>/publish-fold/frontier/wave-<attempt>/`
deleted and its entry removed; then, if some attempt ≥ the invoked one records a
`disposition`, the folder restores the branch to the highest such attempt's `candidate` and exits
with that disposition, dispatching nothing and invoking the kernel zero times; an unparsable
`receipt.json` is replaced (tmp + `mv`) with one whose invoked attempt reads `cannot fold`,
`reason: receipt unparsable`, `candidate` and `pushedHead` both = the remote's
`refs/remotes/origin/ultra/integration-run-<N>` after `git fetch origin <branch>` — or
`candidate` = the `engine-head` file and `pushedHead` unset when the remote has no such branch —
and the branch is restored to that `candidate` before exit (the target clone's
`refs/remotes/origin/ultra/integration-run-<N>` is what `git fetch origin <branch>` left);
`receipt.json.tmp` is deleted at re-entry.
M7. One event `{ kind: 'driver:publish-fold', run, attempt, base, tip, candidate, pathsJoined,
pathsConflicted, resolversDispatched, resolverRetries, suite: 'pass' | 'fail' | 'none',
disposition }` is appended to `<run dir>/events.jsonl` per completed attempt, and the receipts
sit under `<evidence-dir>/publish-fold/`: `main.patch`, `run.patch`, every brief and
`suite-<attempt>.txt` are written there directly, and at the end of every attempt (every
disposition) the kernel's `<run dir>/publish-fold/frontier/wave-<attempt>/` directory, reply
directories inside it, is copied to `<evidence-dir>/publish-fold/frontier/wave-<attempt>/`;
a re-entry that discards a dangling attempt deletes both copies.
M8. Attempt 2 whose fresh TIP equals attempt 1's recorded `tip` records `tip unmoved` with
`candidate` = attempt 1's `candidate` and invokes the kernel zero times; attempt 2 on a moved
TIP cuts `run.patch` from `engineHead` (not from the attempt-1 candidate) and its candidate's
only parent is the new TIP.

**Authorized-by:** #715 decisions 1, 2, 3, 6, 7, 9; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.1 (steps, receipt, idempotence),
§3.2 (the suite), §3.3 (the block), §3.6 (dispositions), §3.7 (binaries), §4 (the sims).

**Interfaces:**
- Consumes: `resolveConflicts({ agent, runCli, roles, common, taskArgs, commutesArgs, open, contendingBlock, waveDir, labelPrefix, onEvent }) -> Promise<{ ok, reason, transcripts, selfChecks }>`
- Consumes: `contendingBlock({ repo, base, tip, run, path, tasks }) -> Promise<string>`
- Produces: `publishFold({ repo, base, branch, run, runDir, evidenceDir, attempt }, deps) -> Promise<receipt>`

**Context:** The folder is a new engine entry cloned to the sandbox with the rest of the
engine; `do_boot` (a sibling task in this plan) runs it once per attempt as a transient unit
`fleet-fold-<N>-<attempt>` under the engine's `systemd-run` envelope, with the argv of M1, after
the engine has exited and before the head is pushed, and reads the disposition from the receipt
— so the folder pushes nothing, opens nothing and writes no status page. Ground truth it builds
on: the kernel CLI `skills/ultrapowers/kernel/fold_wave.py` (`fold --repo --run-dir --wave
--base --patch <id>=<file>` narrates conflicts to `<run-dir>/frontier/wave-<n>/conflict-<i>.txt`
+ `.hunks.txt` and exits 2 when that wave's `fold_log.jsonl` already exists — which is why a
dangling attempt's wave directory is deleted at re-entry; `resolve --conflict <i> --reply-dir
<dir>` exits 4 on a bad reply; `materialize --prev-head <sha> --patch … [--subject <s>]` prints
`{"candidateSha"}`, a commit whose only parent is `prev-head` when every task arrived as a
patch, and answers `{"park": …}` with exit 2 when `_observe_modes` finds a touched path's mode
at `prev-head` differing from the tasks' — the cross-run chmod shape; every command prints one
JSON object, parsed with `parseCliJson` from `run-engine.mjs`). The kernel path is
`new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url)` as `runEngine` resolves
it; `compile_plan.py` is `../skills/ultrapowers/scripts/compile_plan.py` the same way, and it
prints a JSON object whose `tasks` array carries `{ id, title, body, files, … }` — the same
shape `<run dir>/launch.json` holds for this run (that file is written by `ultra_run.py`
through `--emit-launch`; never parse the plan a second time for this run's bodies). The run
directory is `<target clone>/.claude/ultrapowers/run-run-<N>` (the boot's `run_dir_path`) and
holds `args.json` (top-level `testCmd`, `bootstrapCmd`, `planPath` — the H1 for `--subject` is
the first `# ` line of that file, as `runEngine` reads it), `launch.json`, `events.jsonl`,
`clones/integration` (cut `--local` at BASE by `provisionRunTree`, dependencies installed there
by `bootstrapCmd`, holding neither TIP nor the candidate until fetched — hence the by-name
fetch, since a bare sha is not advertised under every protocol), `clones/task-<id>`,
`patches/`, `workers/`, `claude/`, `preambles/`, `roles/`. The default branch's name is read
from `refs/remotes/origin/HEAD` in the target clone (`git symbolic-ref`), as the boot's
`default_branch` reads it; TIP is `refs/remotes/origin/<default>` after `git fetch origin
<default>`. The ancestry precondition is `git merge-base --is-ancestor BASE TIP` in the target
clone, which is a full clone. The agent: build it with `composeAgent` from `fleet/run-main.mjs`,
rebuilding the inputs `runMain` builds from the run directory — `promptFileFor =
writeRoleFiles(<run dir>/preambles)`, `copyEngineRoles(<run dir>/roles)`, `settingsFor =
writeConfineSettings({ runDir, hookPath: <ENGINE_DIR>/fleet/confine-hook.mjs })` (all
idempotent), the worker env `{ ...process.env, CLAUDE_CONFIG_DIR: <run dir>/claude,
FLEET_RUN_DIR: <run dir>, DISABLE_AUTOUPDATER: '1' }`, `clonesDir`/`patchesDir`/`workersDir`
under the run directory, `cli` `claude`, `eventLog = makeEventLog({ file: <run dir>/events.jsonl,
runId, base, source: 'fleet/publish-fold.mjs' })` from `run-waves.mjs`, `base` a function
returning BASE — and label each dispatch `resolve:publish-fold:<attempt>:<i>:<a>` (the
`labelPrefix` of M5 plus what `resolveConflicts` appends): `createRunWorker` derives the
resolver role from the `resolve:` prefix, a non-worktree label routes its cwd to
`clones/integration`, `addDirsFor` grants the run directory, and `nextWorkerDir` plus the fresh
prefix avoid session collisions. `publishFold` takes `deps = { makeAgent = composeAgent, exec =
execSeam }` so the exam injects a stub agent exactly as `runMain`'s `makeAgent` seam is used;
`roles` come from `loadRoles()` in `run-engine.mjs`. `resolveConflicts` is a sibling task's
export from `fleet/run-engine.mjs` with the signature in Interfaces; it returns the reason
string the wave loop would have parked on, and the folder maps `ok: false` to `conflict parked`
with `path` = the first outstanding conflict's path. `pathsJoined` = the size of the
intersection of the two patches' path sets (read with `git apply --numstat`); `pathsConflicted`
= the number of conflicts the kernel narrated; `resolverRetries` = transcripts with `attempt`
2. The block itself — the trailer scan, the plan-tag fetch, the compile of run M's plan and the
entry grammar — is a sibling task's export `contendingBlock({ repo, base, tip, run, path,
tasks })` from `fleet/publish-fold-block.mjs`, called once per conflicted path with the target
clone, BASE, TIP, this run's number, the repo-relative path and `launch.json`'s `tasks`; the
folder prepends nothing and appends nothing to what it returns. The restore rule for `candidate`: on every disposition
it is the sha the branch must hold after this attempt — the folded commit on `folded` and `suite
red`, `engineHead` on attempt 1's other rows, attempt 1's `candidate` on attempt 2's other rows.
Attempt 1's `pushedHead` is written later by the boot script's `push_head`, not by the folder;
the folder reads it only to know which attempts completed. The exam: `fleet/tests/test_publish_fold.mjs`
builds a real repository with a bare `origin` whose `HEAD` points at the pushed default
branch (`git init --bare --initial-branch=main`, then a clone that seeds, pushes `main` and holds
`refs/remotes/origin/HEAD`), a run directory provisioned with `provisionRunTree` from
`run-main.mjs` (which cuts `clones/integration` at BASE), an `args.json` carrying `testCmd`
(`bash check.sh`-style, a script the fixture commits so the suite is green or red by fixture
choice) and `planPath`, a `launch.json` with this run's `tasks`, an integration branch built by
committing on top of BASE, and main moved on the origin by commits made in a second clone —
one of them with a `Fleet-Run: 3` trailer and a tag `ultra/plan/run-3` pushed to the origin
AFTER the target clone was made, carrying a `.ultrapowers/plan.md` whose one task names the
conflicted path; the agent is a stub through `deps.makeAgent`. Run every fold in the sim from a
unique temp directory (same-wave sims share one machine). `python3` is real on the box the sims
run on; the kernel is driven for real.

**Proof:**
- Test: `fleet/tests/test_publish_fold.mjs`
- Legs: (a) main moved by a commit editing `b.txt` and the run editing `a.txt`: attempt 1 records
  `folded`, `candidate`'s parent list is exactly `[TIP]`, `git show <candidate>:a.txt` is the
  run's text and `:b.txt` main's, `refs/heads/ultra/integration-run-<N>` equals `candidate`,
  `main.patch` and `run.patch` exist under `<evidence-dir>/publish-fold/` and `pathsJoined` is
  0 — so disjoint sides fold and land on TIP; the recording `deps.exec` (a wrapper around
  `execSeam` the exam injects) shows the kernel `materialize` argv carrying `--prev-head <TIP>`
  and `--subject <the first "# " line of the fixture's plan file, verbatim>`, and the candidate
  commit's subject line equals that H1 [M2]; the same fixture with both sides editing different
  lines of `a.txt` gives `pathsJoined` 1, `resolversDispatched` 0 and a tree carrying both
  edits [M2]; every fixture passes a `--run-dir` and an `--evidence-dir` that are distinct
  directories (`<tmp>/run` and `<tmp>/evidence/.ultrapowers/runs/<N>`); `engine-head` holds
  the branch sha the fixture built, `receipt.json`'s `engineHead` equals it, the recording
  `deps.exec` asserts at the moment of the first `git fetch` call that `engine-head` already
  exists with that sha (an `engine-head` written after any fetch fails there), a second run of
  attempt 1 after the file exists leaves its mtime and content unchanged; the exam's
  `deps.rename` spy records every call, asserts each one is exactly
  `(<evidence-dir>/publish-fold/receipt.json.tmp, <evidence-dir>/publish-fold/receipt.json)`
  and reads the tmp's bytes before letting the rename through, and the receipt's final bytes
  equal the last tmp bytes the spy saw — a write that bypasses the seam leaves the two
  different; and the recording `deps.exec` shows the two patch cuts as `['diff', '--binary',
  '--full-index', '--no-renames', '<BASE>..<TIP>']` and `['diff', '--binary', '--full-index',
  '--no-renames', '<BASE>..<engineHead>']`, with main's first [M1] [M2]; the moved-main fixture
  run with a `deps.exec` that lets `fetch origin main` and the following `rev-parse
  refs/remotes/origin/main` through and throws on the next git call: the folder exits non-zero,
  the receipt afterward holds `engineHead`, attempt 1 `tip` = the moved TIP and no attempt-1
  `disposition`, no kernel call was made, and a further `--attempt 1` with a plain
  `deps.exec` completes `folded` — so `tip` is written after the fetch and before anything
  else, and a folder writing `tip` later fails on the first receipt read [M1] [M6]; (b) with the origin's `main` still at BASE the receipt records `nothing to join`,
  `pathsJoined: 0`, `candidate` = `engineHead`, `tip` = BASE, the branch's sha is unchanged, no
  `publish-fold/frontier/` directory exists, and the CLI exits 0 [M2] [M1]; (c) the fixture's
  `check.sh` made to exit 1 yields `suite red` with `suite: 'fail'`, `suite-1.txt` carrying the
  script's output, the branch still at the candidate, and `clones/integration`'s HEAD and
  working tree equal to what they were before the fold; the passing fixture yields `folded`
  with `suite: 'pass'` and the same restore; an `args.json` with no `testCmd` yields `folded`
  with `suite: 'none'`, no `suite-1.txt` and no `bash` call in the recording `deps.exec`; and
  the recording `deps.exec` (a wrapper around `execSeam` the exam injects) shows, in order, a
  `git` call `['fetch', '--no-tags', <target clone>, 'refs/heads/ultra/integration-run-<N>']`
  with cwd `clones/integration`, a `git read-tree -u --reset <candidate>^{tree}` there, exactly
  one `['bash', '-lc', <the args.json testCmd verbatim>]` with cwd `clones/integration`, then a
  `git reset --hard` there [M3]; (d) main and the run both edit line 2 of
  `a.txt`, main's edit carrying `Fleet-Run: 3` and a second, later main commit by a human with
  no trailer: the stub resolver is dispatched once with a label starting
  `resolve:publish-fold:1:`, its prompt (also saved as `resolver-brief-0-1.txt`) contains, in
  this order, the sentence `The frontier side of each hunk is main since this run's base`,
  `- run 3 task ` followed by run 3's task body verbatim from the tag's plan (a tag pushed to
  the origin after the target clone was made, its plan compiled through `compile_plan.py`), `- main <sha7> "<subject>" (<author>, no plan)`
  for the human commit, and `- run <N> task ` followed by this run's task body verbatim from
  `launch.json`; the prompt contains no branch name and no `launch.json` path; at the moment of
  dispatch `clones/integration`'s HEAD tree equals TIP's tree (the stub reads `a.txt` from its
  cwd and finds main's line); the receipt records `folded` with `resolversDispatched` 1 and the
  event `resolverRetries` 0; the reply directory the resolver's reply was written to is exactly
  `<run dir>/publish-fold/frontier/wave-1/reply-0-1/` (so `waveDir` is that path), and after
  the attempt `<evidence-dir>/publish-fold/frontier/wave-1/reply-0-1/h1.txt` exists with the
  same bytes while `<evidence-dir>/publish-fold/resolver-brief-0-1.txt` is a file there; the
  recording `deps.exec` shows the kernel `fold` argv carrying `--wave 1`, `--run-dir
  <run dir>/publish-fold`, `--patch main=…` before `--patch run-<N>=…`, and no `--commutes`
  word anywhere in any kernel argv; and `clones/integration` is back at its own HEAD afterward
  [M4]; (e) a stub resolver answering BLOCKED yields `conflict parked` with `path` `a.txt`,
  `candidate` = `engineHead`, the branch unchanged, no `materialize` in the kernel's wave
  directory (no `candidateSha` anywhere in the receipt) and `clones/integration` restored; a
  stub resolver answering `RESOLVED` with an empty `hunks` list on both dispatches (the kernel
  rejects the reply with exit 4 twice) yields `conflict parked` with `resolversDispatched` 2,
  the event's `resolverRetries` 1 and the branch unchanged; a
  binary `logo.png` committed on main and a different `logo.png` on the run yields `conflict
  parked` with `path` `logo.png` and zero resolver dispatches; main deleting `d.txt` while the
  run edits `d.txt` yields `conflict parked` with `path` `d.txt` and the branch unchanged; a
  `chmod +x` of `tool.sh` on main since BASE with the run never touching `tool.sh` yields
  `cannot fold` with `reason` containing the kernel's park text and the branch unchanged, and
  the same chmod with the run editing `tool.sh`'s content yields `cannot fold` too; a `--base`
  that is not an ancestor of TIP (a side commit's sha) yields `cannot fold` with `reason`
  naming ancestry and no kernel call; and the CLI's exit status is 0 on every one of these
  shapes and on the `folded`, `suite red` and `tip unmoved` shapes of the other legs — a
  non-zero exit on any named disposition fails [M5] [M1];
  (f) a receipt pre-written with attempt 1 `{ tip, candidate: <some sha the fixture commits>,
  disposition: 'folded' }` beside a planted `receipt.json.tmp` holding `stray` makes
  `--attempt 1` restore the branch to that sha, exit with `folded`, dispatch nothing, leave no
  new `frontier/wave-1/` entries, and leave no `receipt.json.tmp` behind (the planted file is
  gone and the receipt's bytes are unchanged); a receipt with attempt
  1 `conflict parked` and `candidate` = `engineHead` restores to `engineHead` (the parked
  attempt wins); a receipt with attempt 1 `folded` at candidate X and attempt 2 `folded` at
  candidate Y (both shas the fixture commits) makes `--attempt 1` restore the branch to Y, not
  X, and exit with attempt 2's disposition; a receipt with attempt 1 complete and attempt 2 holding `tip` but no
  `disposition`, plus a pre-made `frontier/wave-2/fold_log.jsonl` under both
  `<run dir>/publish-fold/` and `<evidence-dir>/publish-fold/`, makes `--attempt 1` delete both
  `frontier/wave-2/` directories, drop attempt 2 from the receipt and exit with attempt 1's
  disposition; a
  `receipt.json` holding `{not json` with the branch pushed to the origin makes `--attempt 1`
  write a receipt whose attempt 1 reads `cannot fold`, `reason: receipt unparsable`, `candidate`
  and `pushedHead` both equal to the origin's branch sha, the local branch restored to it,
  the clone's `refs/remotes/origin/ultra/integration-run-<N>` present afterward — the
  `git fetch origin <branch>` happened — and nothing dispatched; the same with the origin holding no such branch yields `candidate` =
  `engine-head`'s content and no `pushedHead` key; a stray `receipt.json.tmp` is absent after
  any of these [M6]; (g) after the clean fold `events.jsonl`'s last `driver:publish-fold` event
  deep-equals the expected object on every one of the twelve named keys (`run`, `attempt`,
  `base`, `tip`, `candidate`, `pathsJoined`, `pathsConflicted`, `resolversDispatched`,
  `resolverRetries`, `suite`, `disposition` plus `kind`), the conflicted fold's event carries
  `pathsConflicted` 1, and `ls <evidence-dir>/publish-fold/` names `main.patch`, `run.patch`,
  `frontier`, `suite-1.txt` and, for the resolved shape, `resolver-brief-0-1.txt`, with
  `<evidence-dir>/publish-fold/frontier/wave-1/fold_log.jsonl` byte-equal to
  `<run dir>/publish-fold/frontier/wave-1/fold_log.jsonl`; and the parked shape (BLOCKED) also
  leaves `<evidence-dir>/publish-fold/frontier/wave-1/` in place [M7]; (h) after a
  completed attempt 1 with `pushedHead` written into the receipt by the sim, `--attempt 2` with
  the origin's `main` unmoved records attempt 2 `tip unmoved` with `candidate` equal to attempt
  1's and no `frontier/wave-2/` directory; with `main` moved again, attempt 2's candidate has
  parent exactly the new TIP, `run.patch` under attempt 2 equals the diff `BASE..engineHead`
  (not `BASE..<candidate 1>`), and the tree carries the run's edit, main's first move and main's
  second move [M8].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/run-main.mjs`
- path-absent: `skills/ultrapowers/kernel/fold_wave.py`
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #715

### Task 4: The boot script publishes the folded head and retries the merge once

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** A red suite after a clean fold holds the PR with the failure in its body.
(quoted from #715)
Machine: M1. After the engine's exit, on any outcome with commits ahead of BASE (gate-green and
parked alike), `do_boot` writes `running` with phase `publish fold`, runs `mkdir -p
<evidence worktree>/.ultrapowers/runs/<N>/publish-fold`, and starts `systemd-run --user
--unit=fleet-fold-<N>-1 --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 -p
WorkingDirectory=<target> -- env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=<proxy>
CLAUDE_CODE_OAUTH_TOKEN=placeholder ULTRAPOWERS_FLEET_RUN=run-<N> node
<engine>/fleet/publish-fold.mjs --repo <target> --base <BASE> --branch ultra/integration-run-<N>
--run <N> --run-dir <run dir> --evidence-dir <evidence worktree>/.ultrapowers/runs/<N>
--attempt 1` inside `set +e` … `${PIPESTATUS[0]}` … `set -e` with its output teed to
`publish-fold/publish-fold-1.log`, with no `phase_refresher` beside it and no write of
`ENGINE_DONE_MARKER`; then waits `await_engine_inactive fleet-fold-<N>-1` before `write_status
publishing`, and the first `systemd-run` of a `fleet-fold-*` unit comes after the engine's unit
and after the `running "publish fold"` page write; a run whose branch has nothing ahead of BASE
starts no fold unit.
M2. After the unit exits `do_boot` reads the page first: a `parked` page (the deadman's) makes
it `rm -f` the receipt's `.tmp`, `collect_evidence`, `push_evidence "run-<N>: parked —
deadman"`, `record_tags` and exit 0 with no branch push, no PR POST and no `write_status`;
otherwise a non-zero exit with no `disposition` recorded for the invoked attempt makes it run
`git -C <target> update-ref refs/heads/ultra/integration-run-<N> <restore>` — `<restore>` the
`engine-head` file's content on attempt 1 (written first as `git -C <target> rev-parse
<branch>` when that file is absent) and the receipt's attempt-1 `candidate` on attempt 2 — and
write, through `python3` as `check_runs_verdict` reads JSON, the invoked attempt's `disposition:
"cannot fold"`, `reason` = the exit code and the last line of `publish-fold-<attempt>.log`, and
`candidate` = `<restore>` into the receipt (tmp + `mv`, starting from `{ "engineHead":
<restore>, "attempts": {} }` when the file is absent or unparsable), and continue to `push_head`; and `do_deadman` stops every active `fleet-fold-<N>-*` unit
beside `fleet-engine-<N>`, its `parked` page carrying the `pr`, `prAuthor` and `merged` cells
the page it overwrites held.
M3. `push_head` replaces the `git push` inside `publish`: it pushes `ultra/integration-run-<N>`
plainly when no attempt in the receipt names a `pushedHead` and with
`--force-with-lease=ultra/integration-run-<N>:<pushedHead>` (the highest attempt's) otherwise,
`|| fail` either way, then runs `await_branch_visible` and writes the pushed sha as the highest
attempt's `pushedHead` (python3, tmp + `mv`); `publish` keeps only the POST and is still skipped
when the page records a `pr`.
M4. `render_card` reads the receipt: a `## Publish fold` section sits before `### Evidence` on
any disposition other than `folded` and `nothing to join`, and on a `folded` whose
`resolversDispatched` is non-zero; it names the disposition and, on `suite red`, the tail of
`publish-fold/suite-<attempt>.txt` of the highest attempt carrying a `disposition`; the
evidence listing names `publish-fold`; `plan_closes`' lines stay last; no section is rendered
for a `folded` with zero resolvers or a `nothing to join`; after a disposition that lands after
the POST (attempt 2's, or `405 twice`) `do_boot` sends `PATCH /repos/<t>/pulls/<n>` with the
re-rendered body, that same text is the `done`/`parked` page's phase, and a one-attempt run
with no post-POST disposition sends no PATCH.
M5. `do_boot` sets `FOLD_HOLD` from the disposition — `left open: publish fold — suite red`,
`left open: publish fold — conflict parked on <path>`, `left open: publish fold — cannot fold:
<reason>` — and empty for `folded` and `nothing to join`; `merge_pr` treats a non-empty
`FOLD_HOLD` exactly as `HOLD=1`, reading no check runs, issuing no PUT and setting `MERGE_NOTE`
to `FOLD_HOLD`'s text; a gate-green outcome under `FOLD_HOLD` still opens its PR non-draft and
a parked outcome stays a draft; `hold=1` keeps `left open: hold=1` whatever the disposition.
M6. The merge PUT's payload carries `commit_message` equal to `Fleet-Run: <N>\nPlan-Tag:
ultra/plan/run-<N>` beside the unchanged `merge_method`, `commit_title` and `sha`.
M7. A PUT answering 405 whose body's `message` contains `not mergeable` sets `MERGE_RETRY=1`
and returns with no second PUT from `merge_pr`; `do_boot` tests `MERGE_RETRY` exactly once,
between its two `merge_pr` calls, and on it runs, in this order: `write_status running
"publish fold (attempt 2)"` with `collect_evidence` + `push_evidence`, the fold unit
`fleet-fold-<N>-2` (`--attempt 2`), `await_engine_inactive fleet-fold-<N>-2`, `push_head`
(with the lease on attempt 1's `pushedHead`), `write_status publishing` with `collect_evidence`
+ `push_evidence`, then `merge_pr` again, which on entry with `MERGE_RETRY` set re-enters its
check-runs loop on the new `BRANCH_HEAD` with the same grace and wait, then polls `GET
/repos/<t>/pulls/<n>` until its `mergeable` is not null, then PUTs; a second 405 sets
`MERGE_NOTE="left open: merge PUT answered 405 twice"`; the evidence commits' states read
`running, publishing, running, publishing, done`; a disposition of `tip unmoved` on attempt 2
skips `push_head` and `merge_pr`, writes `publishing`, and sets that same `405 twice` note;
a 405 whose message is anything else, a 409, and every other non-2xx keep one PUT and start no
attempt 2, with `MERGE_NOTE="left open: merge PUT answered <code>"`.
M8. The shared rig's `systemd-run` stub answers a `fleet-fold-*` unit as its first branch —
writing `engine-head`, the receipt (`STUB_FOLD_DISPOSITION`, `STUB_FOLD_PATH`, and per-attempt
values), the fold log's last line, exiting `STUB_FOLD_CODE`, and under `STUB_FOLD_PARK` writing
`$FLEET_HOME/www/status.json` with `state: parked` before exiting non-zero — its `systemctl
is-active fleet-fold-*` answers `inactive`, its `git` stub records `update-ref` and
`--force-with-lease` argv, its `curl` stub answers `GET …/pulls/<n>` with a `mergeable` body,
`PATCH …/pulls/<n>` into `patch.log`, and a merge PUT with `STUB_MERGE_CODE` and
`STUB_MERGE_MESSAGE`, `STUB_FOLD_CODE_2` for attempt 2's exit and `STUB_INTEGRATION_PUSH_FAIL`
for a refused integration push; every existing case of `test_sandbox_boot_merge.mjs`, of
`test_sandbox_boot.mjs`, `test_sandbox_boot_edges.mjs`, `test_sandbox_boot_record.mjs`,
`test_sandbox_boot_approved.mjs`, `test_sandbox_boot_approval_evidence.mjs`,
`test_sandbox_boot_effort.mjs` and `test_sandbox_boot_selfmerge.mjs` still passes.

**Authorized-by:** #715 decisions 2, 4, 7, 9; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.1 (the unit, the bracket, the
crash row, the deadman), §3.4 (`push_head`, the PR body, the retry), §3.6 (dispositions,
`FOLD_HOLD`), §4.

**Interfaces:**
- Consumes: nothing a sibling produces (the folder is a sibling task in this plan; this task's sim stubs its unit and never runs it)
- Produces: `FOLD_HOLD` (a boot-script variable read by `merge_pr`)

**Context:** HARD CONSTRAINT: `collect_evidence` in `fleet/sandbox-boot.sh` is not edited by
this task, not one byte — a concurrent run (#702) owns that function; every file this task
adds to the record is written directly into the evidence worktree under
`$EVIDENCE_DIR/$EVIDENCE_PATH/publish-fold/` (the folder's `--evidence-dir` is
`$EVIDENCE_DIR/$EVIDENCE_PATH`, i.e. `/home/exedev/evidence/.ultrapowers/runs/<N>`), and
`push_evidence` stages the whole `$EVIDENCE_PATH`, so it rides the next commit with no list
change. Ground truth at BASE: `do_boot` computes `outcome` (`gate-green` on PASS or an approve
receipt, else `parked`), calls `await_engine_inactive` (hardwired to `fleet-engine-$RUN_N`;
from this change on it takes the unit name as `$1` and `do_boot` calls it for the engine and
for each fold unit), refuses to publish a branch with nothing ahead of BASE (`rev-list --count
"^$BASE_SHA" "$BRANCH"` = 0 → `parked`, evidence, tags, exit 0 — this path starts no fold
unit), writes `publishing` + evidence commit, then `publish` (which today pushes the branch,
waits `await_branch_visible` — which records `BRANCH_HEAD` — renders the card and POSTs the PR)
unless `PR_URL` was read off the page (guard 2), then `merge_pr` on gate-green, then `done` /
`parked`, evidence, `record_tags`, notify. `run_engine` is the model for the fold bracket:
`set +e`, `fleet_systemd_run --user "--unit=…" --pipe --wait --collect -p MemoryMax=40G -p
MemorySwapMax=0 -p "WorkingDirectory=$TARGET_DIR" -- env -u CLAUDE_CONFIG_DIR
"ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" "CLAUDE_CODE_OAUTH_TOKEN=placeholder"
"ULTRAPOWERS_FLEET_RUN=$RUN_ID" node … 2>&1 | tee -a <log> >>"$BOOT_LOG"`,
`code=${PIPESTATUS[0]}`, `set -e` — reuse exactly those three lines' shape and nothing else of
it: no `phase_refresher` (it rewrites `running` from `engine:phase` events and would erase the
deadman's page), no `ENGINE_DONE_MARKER` write (`engine_exit_code` would read it on re-entry as
an engine failure). The script is `set -euo pipefail`, so a non-zero `--wait` outside the
bracket would kill `do_boot` before any check. The engine checkout is `$ENGINE_REPO_DIR`; the
run directory is `$(run_dir_path)` = `$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`. The fold
runs under the `running` state with phase `publish fold` because `publishing` and `parked` are
this script's claims that no model is running and the folder may dispatch one; attempt 1's
`running "publish fold"` write is a phase change inside the state the engine's commit already
made and carries no evidence commit (intended); attempt 2's `running "publish fold (attempt
2)"` is a new transition and carries one. The page-first rule: the deadman (`do_deadman`) writes
`parked` while the unit runs, and a stopped unit exits non-zero too, so after the bracket read
the page (`read_status_field state`) before the exit code; on `parked` take the deadman's own
exit (rm the tmp, `collect_evidence`, `push_evidence "$RUN_ID: parked — deadman"`,
`record_tags`, `exit 0`, no `write_status`). The crash row's `reason` is the exit code and the
last line of `publish-fold/publish-fold-<attempt>.log`; `mkdir -p` the directory before the
bracket because `tee -a` needs it. Restore targets: attempt 1 → the `engine-head` file
(`<evidence-dir>/publish-fold/engine-head`; when absent, a crash before the folder wrote it
never moved the ref, so write it first as `git -C "$TARGET_DIR" rev-parse "$BRANCH"`); attempt
2 → the receipt's attempt-1 `candidate`; an absent or unparsable receipt at crash time → `git
rev-parse "$BRANCH"` itself and a plain push. A folder that wrote its `disposition` and then
died in a final `reset --hard` keeps its row: the crash row is written only when the invoked
attempt has no `disposition`. The receipt's shape, shared with the folder: `{ engineHead,
attempts: { "1": { tip, candidate, pushedHead, disposition, reason, path, pathsJoined,
resolversDispatched, suite }, "2": { … } } }` at `<evidence-dir>/publish-fold/receipt.json`;
every writer writes `receipt.json.tmp` then `mv`. The disposition vocabulary, verbatim: `folded`,
`nothing to join`, `tip unmoved`, `suite red`, `conflict parked`, `cannot fold`; `reason` and
`path` feed the notes. `push_head`'s one rule: lease with the highest attempt that names a
`pushedHead`, plain when none does — attempt 2's candidate is parented on the new TIP, so a plain
push there is refused as non-fast-forward; a refused lease is `fail` (the run ends `failed` with
the PR open at attempt 1's head, disclosed). `merge_pr` at BASE: `MERGE_NOTE=""` on entry,
returns on no `PR_URL` / recorded `MERGED_SHA` / `HOLD=1`, reads `BRANCH_HEAD`, writes
`publishing "$PR_URL — awaiting checks"`, polls `commits/<head>/check-runs` through
`check_runs_verdict`, PUTs once with `{"merge_method":"squash","commit_title":<H1>,"sha":<head>}`,
and on non-2xx sets `MERGE_NOTE="left open: merge PUT answered $code"` and `return 0` — every
path returns 0 under `set -e`, which is why the retry signal is a variable (`MERGE_RETRY=1`) and
never a return code; `do_boot` never clears it and `merge_pr` reads it on entry (set means the
second call). GitHub answers 405 for unmet branch protection too and 409 for a head-sha
mismatch; only a 405 whose `message` says the pull request is not mergeable retries. After a
force-push the new head has no check runs yet and mergeability is recomputed asynchronously,
hence the re-entered check-runs loop and the `GET /pulls/<n>` poll until `mergeable` is
non-null. `render_card` is bash reading the receipt with `python3` (never `events.jsonl`); the
`## Publish fold` section links `publish-fold/receipt.json` under the evidence tree URL; the
evidence listing is a bare `ls "$dest"` so `publish-fold` appears without a slash. The body
PATCH is `fleet_curl -sS -X PATCH https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/<n>
-H 'content-type: application/json' -d {"body": …}` through the edge like the POST. State
sequence on a retry: `running → publishing → running → publishing → done`; `tip unmoved` still
writes `publishing` before `done`. `do_deadman` at BASE stops `fleet-engine-$RUN_N.service`
when active and writes `parked` carrying `startedAt` and `vm` forward; it gains the
`fleet-fold-$RUN_N-*` units (list with `systemctl --user list-units --all 'fleet-fold-<N>-*'`
or try `-1` and `-2`) and the `pr`/`prAuthor`/`merged` carry-forward. The sim: `fleet/tests/test_sandbox_boot_merge.mjs`
is the file that stubs `curl` for the merge (the rig is `_sandbox_boot_helpers.mjs`: `makeHome`,
`boot`, `green`, the stub bin with `argv`/`say` preludes, `STUB_*` env knobs, readers
`commitStates`, `mergePuts`, `mergeArgv`, `checkReads`, `unitsRun`, `engineRuns`, `prPosts`,
`gitLog`, `stream`, `statusOf`); its `systemd-run` stub today treats every non-`fleet-status`
unit as the engine, so the `fleet-fold-*` case goes first; under `--wait` the stub runs to
completion, so the deadman shape is the stub itself writing `$FLEET_HOME/www/status.json` with
`state: parked` before exiting non-zero. New legs sit under a comment naming this task; the
existing M5 pins on `CONTRACT.md` (the Boot-script bullet's `commits/<head>/check-runs` →
`pulls/<n>/merge` → `hold=1` order, the Publish bullet's `sandbox merges itself once its checks
are green, unless the assignment carries … hold=1`) are read by this same sim and this task
edits no document, so they hold as they are. `bash -n fleet/sandbox-boot.sh` is a Global
Check. The pushed argv the sim reads for the lease comes from the receipt's `pushedHead`, which
the `fleet-fold-*` stub writes for attempt 1 since `git` is a PATH stub there.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Legs: (a) the green boot's `unitsRun` lists `fleet-engine-7` then `fleet-fold-7-1` and no
  other `fleet-fold-*`; the fold's `systemd-run` argv carries `--pipe`, `--wait`, `--collect`,
  `-p MemoryMax=40G`, `env`, `-u`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz`,
  `CLAUDE_CODE_OAUTH_TOKEN=placeholder`, `ULTRAPOWERS_FLEET_RUN=run-7`, `-p
  MemorySwapMax=0`, `-p WorkingDirectory=<home>/target`, a word ending
  `/fleet/publish-fold.mjs`, and the pairs `--repo <home>/target`, `--base <BASE_SHA>`,
  `--branch ultra/integration-run-7`, `--run 7`, `--attempt 1`, `--evidence-dir
  <home>/evidence/.ultrapowers/runs/7` and `--run-dir <home>/target/.claude/ultrapowers/run-run-7`
  as adjacent words; `<home>/evidence/.ultrapowers/runs/7/publish-fold/publish-fold-1.log`
  exists afterward and contains the line the stub printed to its stdout (`fold stub speaking`),
  which is the boot's own `tee`; the stub's `say "fold dir present"` line is in the boot log,
  which the stub writes only when `<home>/evidence/.ultrapowers/runs/7/publish-fold` already
  exists at its start; in the boot log the `status:
  state=running phase=publish fold` line precedes the fold's `systemd-run` line, which precedes
  `systemctl is-active fleet-fold-7-1.service`, which precedes `status: state=publishing`; the
  fold unit's environment file shows no `phase_refresher` line between the two (the log holds
  exactly one `status: state=running` line after the engine's exit line); `<home>/.fleet-engine-done`
  holds the engine's exit code, not the fold's; a parked outcome (`STUB_VERDICT=NEEDS_ACK`) also
  runs `fleet-fold-7-1`; and `STUB_NO_COMMITS` runs zero `fleet-fold-*` units [M1]; (b)
  `STUB_FOLD_CODE=3` with no disposition written: the git log carries `-C <home>/target
  update-ref refs/heads/ultra/integration-run-7 <the engine-head file's content>`, the receipt
  afterward reads attempt 1 `disposition` `cannot fold`, `reason` containing `exit 3` and the
  last line of `publish-fold-1.log` as the boot's `tee` wrote it, `candidate` equal to that same sha, the branch push and the PR POST still
  happen, and the `done` page's phase contains `cannot fold`; the same with the stub writing
  no `engine-head` file: `rev-parse ultra/integration-run-7` precedes the `update-ref` in the
  git log and the receipt is created from nothing with `engineHead` = that sha; the same with
  `STUB_FOLD_CODE=3` but a `disposition: folded` already written: no `update-ref`, no crash row,
  disposition still `folded`; the two-attempt run with `STUB_FOLD_CODE_2=3` (attempt 2 exits 3
  with no attempt-2 disposition): the git log carries `update-ref refs/heads/ultra/integration-run-7
  <attempt 1's candidate as the receipt records it>`, not `engine-head`'s content (the stub
  writes the two values distinct), attempt 2's row reads `cannot fold` with `candidate` equal
  to that same attempt-1 candidate, and the push that follows carries the lease; `STUB_FOLD_CODE=3`
  with the stub leaving `receipt.json` holding `{not json`: the boot's crash row still lands —
  the receipt afterward parses, its `engineHead` equals the `rev-parse ultra/integration-run-7`
  answer, its attempt 1 reads `cannot fold`, the `update-ref` carries that sha and the push
  carries no `--force-with-lease` word; `STUB_FOLD_PARK=1`: the log's `status: state=parked` line comes
  from the stub, the boot then commits evidence with subject containing `parked — deadman`,
  calls `record_tags` (the `ls-remote --tags` argv is present), pushes no integration branch,
  POSTs no PR, exits 0, and writes no status line after the stub's, and no `receipt.json.tmp`
  survives [M2]; (c) the green boot's git log has exactly one push of `ultra/integration-run-7`
  with no `--force-with-lease` word, followed by the `branches/` curl read, and the receipt's
  attempt 1 `pushedHead` equals `HEAD_SHA` afterward; the attempt-2 boot's second push carries
  `--force-with-lease=ultra/integration-run-7:<attempt 1's pushedHead>`; a re-entry with `pr`
  on the page POSTs no PR and still pushes; `STUB_INTEGRATION_PUSH_FAIL=1` (the git stub exits
  1 on the integration branch's push) ends the boot `failed` with `error` naming `push` and
  `ultra/integration-run-7`, no `branches/` read, no PR POST and a non-zero exit [M3]; (d) `STUB_FOLD_DISPOSITION="suite red"` with a
  `suite-1.txt` the stub writes: `prPosts()[0].body` contains `## Publish fold` before `###
  Evidence`, contains `suite red` and the suite file's last line, contains `- publish-fold` in
  the evidence listing, and its `Closes` lines are its last lines; `conflict parked` with
  `STUB_FOLD_PATH=a.txt` puts `conflict parked on a.txt` in the body; `folded` with
  `resolversDispatched: 1` puts a `## Publish fold` section in the body and `folded` with
  `resolversDispatched: 0` puts none; `nothing to join` puts none [M4]; (e) `suite red` on a
  PASS verdict: `checkReads` is 0, `mergePuts` is empty, the PR was opened with `draft: false`,
  and the `done` phase contains `left open: publish fold — suite red`; `conflict parked` on
  `a.txt`: the phase contains `left open: publish fold — conflict parked on a.txt`; `cannot
  fold` with reason `base not an ancestor`: the phase contains `left open: publish fold —
  cannot fold: base not an ancestor`; `suite red` on a `NEEDS_ACK` verdict opens `draft: true`;
  `hold=1` with `folded` keeps `left open: hold=1`; `folded` and `nothing to join` on PASS
  merge as the green path does [M5]; (f) the green boot's one merge PUT payload has
  `commit_message` exactly `Fleet-Run: 7\nPlan-Tag: ultra/plan/run-7`, `commit_title` the
  plan's H1, `merge_method` `squash` and `sha` `HEAD_SHA` [M6]; (g) `STUB_MERGE_CODE=405` with
  `STUB_MERGE_MESSAGE="Pull Request is not mergeable"` for the first PUT and 200 for the second:
  `commitStates` reads exactly `['running', 'publishing', 'running', 'publishing', 'done']`,
  `unitsRun` lists `fleet-fold-7-2` after `fleet-fold-7-1`, the boot log orders `status:
  state=running phase=publish fold (attempt 2)` → the second fold's `systemd-run` → `systemctl
  is-active fleet-fold-7-2.service` → the lease push → `status: state=publishing` → a
  `check-runs` read whose URL carries the second head → a `GET …/pulls/1` read → the second
  PUT; `mergePuts` has length exactly 2 and the `done` phase contains `merged`; the same with
  405 on both PUTs: `mergePuts` length exactly 2 and the phase contains `left open: merge PUT
  answered 405 twice`; the stub's attempt-2 disposition `tip unmoved`: exactly one push, exactly
  one PUT, `commitStates` still ends `publishing, done` and the phase contains `405 twice`; a
  405 with message `Base branch was modified`: exactly one PUT, no `fleet-fold-7-2`, phase
  `left open: merge PUT answered 405`; a 409: exactly one PUT, no second unit, phase `left
  open: merge PUT answered 409`; a 422 and a 500, each: exactly one PUT, no second unit,
  `commitStates` exactly `['running', 'publishing', 'done']` and phase `left open: merge PUT
  answered 422` / `answered 500`; a `GET …/pulls/1` answering `mergeable: null` twice then
  `true`: exactly three such reads before the second PUT [M7]; (h) the two-attempt run sends
  exactly one `PATCH …/pulls/1` (`patch.log` has one line) whose `body` contains `## Publish
  fold` and attempt 2's disposition, and the `done` page's phase carries that disposition's
  text; the 405-twice run also sends exactly one PATCH whose `body` contains `## Publish fold`
  and `merge PUT answered 405 twice`, and the PATCH's line in the boot log comes after the
  second PUT's; the green one-attempt run sends zero PATCHes [M4]; (i) `sandbox-boot.sh deadman`
  against a page in `running` with `pr`, `prAuthor` and `merged` cells set and
  `STUB_FOLD_ACTIVE=active`: the systemctl log carries `stop fleet-engine-7.service` and `stop
  fleet-fold-7-1.service`, and the written page is `parked` with the same three cells verbatim
  [M2]; (j) the rig's `systemd-run` stub answers a `fleet-fold-7-1` unit without writing
  `gate-receipt.json` (the engine's branch is not taken), `systemctl is-active
  fleet-fold-7-1.service` prints `inactive`, and every sim named in the last clause prints `ALL TESTS
  PASSED` [M8].
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the green-path boot sim on the tree as it stands, whose evidence
  discipline and collected-file pins hold beside the fold unit [M8].
- Run: node fleet/tests/test_sandbox_boot_edges.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the edges sim, whose re-entry and failure pins hold [M8].
- Run: node fleet/tests/test_sandbox_boot_record.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the record sim, whose tag pins hold with the deadman's `record_tags`
  beside them [M8].
- Run: node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the two-move-rule sim [M8].
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the approval-evidence sim [M8].
- Run: node fleet/tests/test_sandbox_boot_effort.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the effort-knob sim [M8].
- Run: node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the self-merge sim [M8].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot_merge.mjs`
- issue-closed: #715

### Task 5: The launcher refuses a base that is not on main

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch.mjs`

**Claim:** `launch.mjs` refuses a `--base` that is not an ancestor of the target's default
branch (laptop-side `git ls-remote` + merge-base, before any VM). (quoted from #715)
Machine: M1. After the `rev-parse --verify <base>^{commit}` check and before the plan commit is
pushed, `launch` runs `git ls-remote --symref origin HEAD` in the launch clone to read the
default branch's name and tip, `git fetch origin <default>`, then `git merge-base
--is-ancestor <base> <tip>`; a non-zero `merge-base` answer throws a `Refusal` whose message
names `<base>`, `<tip>` and the fix text `relaunch from main; a parked branch is re-driven as
a plan on main, not as a base`, with zero mutating lobby verbs issued and no `ultra/plan-run-*`
ref on the origin.
M2. A launch clone whose `git rev-parse --is-shallow-repository` answers `true` is refused with
a `Refusal` whose message names the clone's path and carries the text `is a shallow clone —
unshallow it by hand and relaunch`, before the `ls-remote`, with no `--unshallow` and no `--depth` fetch issued, zero mutating verbs and no
plan ref on the origin.
M3. A green launch (base on `main`) still issues exactly one mutating verb, `new …`, and the
fetch moves only `refs/remotes/origin/<default>`: the launch clone's `HEAD`, its local `main`
and its working tree are unchanged by the launch.

**Authorized-by:** #715 decision 5; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.5.

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes

**Context:** At BASE `fleet/launch.mjs` checks only that the local clone has `--base`
(`git(exec, repoDir, ['rev-parse', '--verify', base + '^{commit}'])`, in the reads section
after `readOriginUrl`), and nothing checks that the base is on the default branch — run-27's
hand rebase came from a launch off a parked branch. Every git command goes through the `exec`
seam as `git(exec, repoDir, argv)`; every refusal is a `Refusal` from `fleet/lobby.mjs` thrown
before any mutating lobby verb, and the plan push (`commitPlan` + the push of
`ultra/plan-run-<N>`) comes later in `launch`, so a refusal here leaves nothing on the remote.
The launcher touches no working tree and no local branch of the operator's clone: `git fetch
origin <default>` moves `refs/remotes/origin/<default>` only. `ls-remote --symref origin HEAD`
prints a `ref: refs/heads/<name>\tHEAD` line and a `<sha>\tHEAD` line; the name comes off the
first, the tip off the second. Decision 5's second sentence (relaunch from main with the parked
branch as a patch) is operator procedure, not machinery: no flag carries a branch's patch. The
exam is `fleet/tests/test_launch.mjs`, whose rig (`_lobby_helpers.mjs`) builds a real target
with `makeTargetRepo` — a bare origin with `main` and a clone whose `origin` is spelled like a
real target's — and whose `localRemote` seam rule rewrites `origin`/`github.com` to the bare
path for `push` and `ls-remote` and runs them for real; extend that rule to `fetch` (the seam
is the test's own) so the new fetch also reaches the bare origin. Build a non-ancestor base by
committing on a side branch in the clone (its sha passes `rev-parse --verify` and is not on the
origin's `main`); build a shallow launch clone with `git clone --depth 1 file://<origin>`
(depth needs the `file://` transport). New legs sit under a comment naming this task; every
existing group of the exam (the one-`new` green launch, the refusals with nothing mutated, the
run number, the three attempts, the result keys, the account, the credential seam, the drift
preflight) keeps passing.

**Proof:**
- Test: `fleet/tests/test_launch.mjs`
- Legs: (a) a `--base` equal to a side-branch commit's sha: `launch` rejects with a `Refusal`
  whose message contains that sha, the origin's `main` tip and the full text `relaunch from
  main; a parked branch is re-driven as a plan on main, not as a base`;
  `exec.mutating()` is empty and `repo.branches()` has no `ultra/plan-run-` key; the exec log
  shows `ls-remote --symref origin HEAD`, `fetch origin main` and `merge-base --is-ancestor
  <base> <tip>` in that order, all after the `rev-parse --verify` read [M1]; (b) a launch run
  with `--repo` pointing at a `--depth 1` clone of the origin rejects with a `Refusal` whose
  message contains that clone's path and the full text `is a shallow clone — unshallow it by
  hand and relaunch`, `exec.mutating()` is empty, no exec call carries `--unshallow` or
  `--depth`, no `ls-remote --symref` call was made, and the origin has no `ultra/plan-run-` ref
  [M2]; (c) the existing green launch still records exactly one mutating verb starting `new `;
  the exam snapshots `git for-each-ref` of the clone, `HEAD`'s sha and `git status --porcelain`
  before the launch and again after it, and the two snapshots differ in exactly one line —
  `refs/remotes/origin/main`, which afterward equals the origin's `main` — with `HEAD`,
  `refs/heads/main` and the porcelain output (empty) identical [M3].

**Stale-if:**
- path-absent: `fleet/launch.mjs`
- path-absent: `fleet/tests/test_launch.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #715

### Task 6: The contract names the fold

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`

**Claim:** A builder reading the fleet contract finds the publish fold where they find the
engine: which unit runs it, when the page says `running` a second time, that the merge is
retried exactly once, and which push is the one made before its evidence commit. (derived)
Machine: M1. `fleet/CONTRACT.md`'s `status.json` bullet — the one that lists the states — names the
sequence `running → publishing → running → publishing → done` as the shape of a run that
retried its merge, and that sequence appears in no other bullet.
M2. The Boot-script bullet's merge sentence names the single retry — a 405 whose message says
the pull request is not mergeable re-folds onto the new tip and PUTs once more, a second 405
leaves the PR open — and the two trailers `Fleet-Run: <N>` and `Plan-Tag: ultra/plan/run-<N>`
in `commit_message`, while its `commits/<head>/check-runs` → `pulls/<n>/merge` → `hold=1`
order is kept.
M3. The Boot-script bullet lists the fold unit `fleet-fold-<N>-<attempt>` beside the engine's
`systemd-run` line, with `fleet/publish-fold.mjs` as what it runs and its own `is-active` wait
before `publishing`.
M4. The sentence that evidence is committed before the push names attempt 2's push under
`running` as the one exception, and the evidence-branch bullet names the `publish-fold/`
receipts directory with `receipt.json` inside it.
M5. `tests/test_docs_agree_with_code.py` stays green on the edited file, and so does
`fleet/tests/test_sandbox_boot_merge.mjs`, whose three `CONTRACT.md` cases (they read the
`status.json` literal, the Boot-script bullet's ordered pin and the Publish bullet's
merge sentence) are still present in that sim and still pass.

**Authorized-by:** #715 decision 4; spec
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md` §3.4 (the contract's state list,
merge bullet, unit line and the evidence-before-push exception), §6.

**Interfaces:**
- Consumes: nothing a sibling produces
- Produces: nothing a sibling consumes

**Context:** `fleet/CONTRACT.md` is the authority for every fleet literal (the contract wins
over the runbook and the skill). The facts to write, all fixed by this plan's sibling tasks and
none of them decided here: the fold runs as a transient user unit `fleet-fold-<N>-<attempt>`
through the same `systemd-run` prefix as the engine (`--pipe --wait --collect -p MemoryMax=40G
-p MemorySwapMax=0`, `env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz
CLAUDE_CODE_OAUTH_TOKEN=placeholder ULTRAPOWERS_FLEET_RUN=run-N node
<engine>/fleet/publish-fold.mjs --repo /home/exedev/target --base <base> --branch
ultra/integration-run-N --run N --run-dir <run dir> --evidence-dir
/home/exedev/evidence/.ultrapowers/runs/N --attempt 1|2`), under the `running` state with phase
`publish fold`, after the engine's unit is inactive and before `publishing`, and `publishing`
is written only after `systemctl --user is-active fleet-fold-<N>-<attempt>.service` is inactive
too; the receipt is `.ultrapowers/runs/<N>/publish-fold/receipt.json` (`{ engineHead, attempts:
{ "1": { tip, candidate, pushedHead, disposition, reason, path, pathsJoined,
resolversDispatched, suite } } }`) beside `engine-head`, `main.patch`, `run.patch`,
`frontier/wave-<attempt>/`, `resolver-brief-<i>-<attempt>.txt`, `suite-<attempt>.txt` and
`publish-fold-<attempt>.log`; dispositions `folded`, `nothing to join`, `tip unmoved`, `suite
red`, `conflict parked`, `cannot fold`; the head is pushed by `push_head` (plain on attempt 1,
`--force-with-lease=<branch>:<pushedHead>` on attempt 2); the merge PUT carries
`commit_message` = `Fleet-Run: <N>` and `Plan-Tag: ultra/plan/run-<N>` on two lines; on a 405
whose `message` says the PR is not mergeable the script writes `running "publish fold (attempt
2)"` (an evidence commit), re-folds onto the new tip, pushes with the lease, writes `publishing`
(an evidence commit), re-enters its check-runs loop on the new head, polls `GET /pulls/<n>`
until `mergeable` is non-null and PUTs once more; a second 405 leaves the PR open with `left
open: merge PUT answered 405 twice`; any other non-2xx keeps one PUT; a `suite red`, `conflict
parked` or `cannot fold` disposition opens the PR held (non-draft on a green verdict, merge
skipped, `left open: publish fold — <disposition text>`) and the PR body carries a `## Publish
fold` section before `### Evidence`; `hold=1` still folds and keeps `left open: hold=1`; the
launcher refuses a `--base` that is not an ancestor of the target's default branch and a
shallow launch clone. The one exception to "evidence committed BEFORE the push": attempt 2's
push happens under `running`, before its `publishing` commit. Keep every literal the existing
pins read: the `status.json` bullet's cells verbatim (`"prAuthor":"<GitHub login or
null>","merged":"<40-hex or null>"` within two lines of the bullet's opening — the shape is
unchanged; extend only the `state` enumeration's prose, not the literal); the Boot-script
bullet's text must still match the regex `commits/<head>/check-runs.*pulls/<n>/merge.*hold=1`
when read from `- **Boot script` to `- **status.json` joined by spaces; the Publish bullet must
still contain `sandbox merges itself once its checks are green, unless the assignment carries`
followed later by `hold=1`; `tests/test_docs_agree_with_code.py` reads the contract for the
unit template `fleet-run@`, the engine directory `/home/exedev/engines/<sha>`, the VM name
shape `fleet-r<N>-` and the two tags, and reads the four operator documents (not the contract)
for named `fleet/*.mjs` scripts — this task edits only the contract. The retired vocabulary
(orchestrator, control VM, golden image, grant step, `fleet-runs` repository, tunnel) must not
reappear. `docs/superpowers/` is untracked and absent on the sandbox: cite the spec by path as
a reference only, never as something a reader must open. `fleet/RUNBOOK.md`, `SKILL.md` and
`README.md` are not this task's — their sentences are pinned structurally and nothing here
requires them to change.

**Proof:**
- Run: sed -n '/^- \*\*status\.json:\*\*/,/^- \*\*Publish:\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'running → publishing → running → publishing → done'
- The previous bullet reads only the `status.json` bullet (from its opening to the Publish
  bullet's) wraps-joined and finds the retried run's state sequence there [M1].
- Run: test "$(tr '\n' ' ' < fleet/CONTRACT.md | grep -o 'running → publishing → running → publishing → done' | wc -l | tr -d ' ')" = 1
- The previous bullet counts the sequence across the whole contract and finds exactly one,
  so it is the `status.json` bullet's and no other's [M1].
- Run: test "$(grep -n '^- \*\*status\.json:\*\*' fleet/CONTRACT.md | cut -d: -f1)" -lt "$(grep -n '^- \*\*Publish:\*\*' fleet/CONTRACT.md | cut -d: -f1)"
- The previous bullet establishes that the Publish bullet still follows the `status.json`
  bullet, so the window above closes where it should [M1].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'commits/<head>/check-runs.*pulls/<n>/merge.*hold=1'
- The previous bullet reads only the Boot-script bullet and finds the pre-existing ordered pin
  intact [M2].
- Run: test "$(grep -n '^- \*\*Boot script' fleet/CONTRACT.md | cut -d: -f1)" -lt "$(grep -n '^- \*\*status\.json' fleet/CONTRACT.md | cut -d: -f1)"
- The previous bullet establishes that the `status.json` bullet still follows the Boot-script
  bullet, so every `sed` window below closes where it should instead of running to the end of
  the file [M2] [M3] [M4].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'a 405 whose .message. says the pull request is not mergeable.*re-folds onto the new tip.*PUTs once more.*a second 405 leaves the PR open'
- The previous bullet finds the retry sentence in the Boot-script bullet with its four parts in
  order: the trigger, the re-fold, the one further PUT, the second 405's outcome [M2].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'left open: merge PUT answered 405 twice'
- The previous bullet finds the second 405's exact note in the Boot-script bullet [M2].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'Fleet-Run: <N>.*Plan-Tag: ultra/plan/run-<N>'
- The previous bullet finds both trailers, in order, in the Boot-script bullet [M2].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'unit=fleet-engine-<N>.*unit=fleet-fold-<N>-<attempt>.*fleet/publish-fold.mjs'
- The previous bullet finds the fold unit's `systemd-run` line after the engine's in the
  Boot-script bullet, naming the script it runs [M3].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q '.publishing. (written only after .systemctl --user is-active fleet-engine-<N>.service. and .systemctl --user is-active fleet-fold-<N>-<attempt>.service. are inactive'
- The previous bullet finds the `publishing` sentence naming both inactivity waits, the fold
  unit's beside the engine's, as what precedes that state [M3].
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status\.json/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -o 'evidence committed BEFORE the push[^)]*' | grep -q 'except attempt 2.s push, made under .running'
- The previous bullet reads only the evidence-before-push parenthesis and finds attempt 2's push
  under `running` named as its exception [M4].
- Run: sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'publish-fold/.*receipt.json'
- The previous bullet reads only the evidence-branch bullet and finds the receipts directory and
  its receipt [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the documents and the contract's literals [M5].
- Run: test "$(grep -c "CONTRACT.md's" fleet/tests/test_sandbox_boot_merge.mjs)" -ge 3
- The previous bullet counts the merge sim's contract-reading cases (each is named
  `CONTRACT.md's …`) and finds the three still present, so the next bullet's sentinel is that
  of a sim that did read the contract [M5].
- Run: node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the merge sim, whose three contract cases read the edited file's
  `status.json` literal, Boot-script bullet and Publish bullet; on this task's own clone it runs
  the boot script as it stands, and on the adopted tree it runs the sibling's edits, green
  either way [M5].

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`
- path-absent: `tests/test_docs_agree_with_code.py`
- issue-closed: #715
