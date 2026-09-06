# The folder: run-32's task 3, re-driven on the parked branch

**Grammar:** claims-v1

**Claim:** After this run, two plans that touch the same file can run at the same time on this
repository and both merge on their own — no 405, no hand rebase — and the second one's evidence
shows the fold it did onto main. (elicited)

**Goal:** #715 (Tier 2 of #360, chartered 2026-09-06; the signed design is
`docs/superpowers/specs/2026-09-06-tier2-cross-run-fold.md`, §3.1 the folder's steps and receipt,
§3.2 the suite, §3.3 the block, §3.6 the dispositions). This plan is the re-drive of run-32's
task 3 — the folder, `fleet/publish-fold.mjs` — on the parked branch that run left:
`ultra/integration-run-32` (PR #720, closed unmerged) already carries the other five tasks of the
#715 build — `resolveConflicts` exported from `fleet/run-engine.mjs`, `contendingBlock` in
`fleet/publish-fold-block.mjs`, the boot script's `publish_fold()` path in `fleet/sandbox-boot.sh`
(which runs `node <engine>/fleet/publish-fold.mjs` as the unit `fleet-fold-<N>-<attempt>`), the
launcher's base-ancestry refusal and the contract prose — and this run's BASE is that branch's
tip, so the one file that is missing is the one this plan builds. Run-32's task 3 died on two
defects of its own Proof, not of the design: leg (d) read TIP's tree from the target clone before
the folder had fetched anything into it, and leg (g) expected a human commit that never touched
`a.txt` to appear in `a.txt`'s contending block. Both are repaired below, and what run-32's
examiner learned about the kernel's numbering, the CLI's seams and the block's arity is written
into Context so the next examiner does not re-derive it. #715 is not closed by this PR: it closes
when its Tier-2 metric is met on live runs.

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); the python kernel CLI
`skills/ultrapowers/kernel/fold_wave.py` driven as a subprocess; the sim uses real git (a bare
origin and two clones) and the real kernel CLI, with the resolver agent stubbed through the
module's `deps` seam. The suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py`.

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is one task, width 1. The folder is one contract — one
module, one CLI, one receipt — read by one sim file, and its exam dispatches a stub resolver
through the real `resolveConflicts` loop with the real `contendingBlock` string, so the two
exports it consumes are exercised for their runtime behaviour, which is why they had to land
first (they did, at BASE). There is no second contract to split off: the boot script's side of
the receipt, the merge retry and the PR body are already built and pinned by their own sims.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/ skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh fleet/sandbox-boot.sh fleet/run-engine.mjs fleet/publish-fold-block.mjs fleet/launch.mjs`
- The folder is the only new code (the Check above is the whole of that rule). A kernel
  behaviour the folder meets — conflict indices from 1, a mode park on a chmod main made since
  BASE, exit 2 on an existing fold log — is met on the folder's side, never patched around.
- Amendment 10 stands: no model runs git and no GitHub call is a model's. The one model the folder
  may dispatch is the read-only `fleet/roles/resolver.md` role answering through
  `RESOLVER_SCHEMA`; the driver writes every reply directory and every ref move, and the folder
  pushes nothing — `push_head` in the boot script does.
- No token in any argv: the folder reads its credentials from the environment the unit hands it
  and sets `CLAUDE_CONFIG_DIR` to the run tree's `claude/` for the worker it composes.
- `status.json`'s shape is unchanged; the fold's record is the `driver:publish-fold` event and
  the `publish-fold/` receipts directory under the evidence directory.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The folder — `fleet/publish-fold.mjs`

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
as one two-dot word) and `run.patch` = the same diff `<BASE>..<engineHead>`, runs `fold_wave.py
fold --repo <clone> --run-dir <run dir>/publish-fold --wave <attempt> --base BASE --patch
main=<main.patch> --patch run-<N>=<run.patch>` (main first), on a clean fold runs `materialize
--prev-head TIP --patch main=… --patch run-<N>=… --subject "<plan H1>"`, moves
`refs/heads/ultra/integration-run-<N>` to `candidateSha` with `git update-ref` before the suite,
and records disposition `folded` with `candidate` = `candidateSha`, whose only parent is TIP and
whose tree carries every path main changed since BASE and every path the run changed — with
`pathsJoined` = the number of paths both sides touched, so two disjoint sides still fold
(`pathsJoined: 0`, candidate on TIP); TIP == BASE instead records disposition `nothing to join`
with `pathsJoined: 0`, `candidate` = `engineHead`, leaves the branch untouched and invokes the
kernel zero times.
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
reply directories `reply-<i>-<a>` are written, `<i>` the kernel's index from `conflicts.json`,
which starts at 1), and `contendingBlock` = the concatenation, in the order of the kernel's
`open` list, of the strings `contendingBlock({ repo, base, tip, run, path, tasks })` answers for
each conflicted path with this run's `tasks` from `<run dir>/launch.json` — so for one conflicted
path the brief carries the trailered run's task body read off its plan tag, the one-line notice
of a human commit that touched that path, and this run's task body, in that order, and for two
conflicted paths it carries the first path's block whole and then the second's; before the first
dispatch `clones/integration` has `refs/remotes/origin/<default>` fetched by name from the target
clone and TIP's tree checked out (`read-tree -u --reset`), and that clone is restored with `reset
--hard` on every exit, parked dispositions included; each brief is saved as
`<evidence-dir>/publish-fold/resolver-brief-<i>-<attempt>.txt` with the same `<i>` as its reply
directory; a resolved conflict continues to materialize and `folded` with `resolversDispatched`
= the number of resolver replies.
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
§3.2 (the suite), §3.3 (the block), §3.6 (dispositions), §3.7 (binaries), §4 (the sims);
run-32 / PR #720 (closed unmerged — the two Proof defects named in Goal).

**Interfaces:**
- Consumes: `resolveConflicts({ agent, runCli, roles, common, taskArgs, commutesArgs, open, contendingBlock, waveDir, labelPrefix, onEvent }) -> Promise<{ ok, reason, transcripts, selfChecks }>`
- Consumes: `contendingBlock({ repo, base, tip, run, path, tasks }) -> Promise<string>`
- Produces: `publishFold({ repo, base, branch, run, runDir, evidenceDir, attempt }, deps) -> Promise<receipt>`

**Context:** The folder is a new engine entry cloned to the sandbox with the rest of the
engine. Both exports it consumes are at BASE, not in a sibling task: `resolveConflicts` is
exported from `fleet/run-engine.mjs` with the signature in Interfaces (it takes ONE
`contendingBlock` string for the whole work list — every dispatch of a multi-path stop is
briefed with the same string, which is why a two-path stop's block is the per-path blocks
concatenated in `open` order, each beginning with its own `CONTENDING TASKS:` heading; it labels
each dispatch `<labelPrefix>:<i>:<a>` with the kernel's `i` and the attempt `a`, writes the reply
directory at `path.join(waveDir, 'reply-' + i + '-' + a)`, retries exactly once on the kernel's
exit 4, and returns the reason string the wave loop would have parked on, so the folder maps `ok:
false` to `conflict parked` with `path` = the first outstanding conflict's path); `contendingBlock`
is exported from `fleet/publish-fold-block.mjs` and restricts `git log --first-parent
<base>..<tip> -- <path>` to the conflicted path, so a frontier commit that never touched the
path contributes nothing to that path's block — run-32's leg (g) expected a `- main …` notice
for a commit that edited only `b.txt` in `a.txt`'s block, which no folder can produce, and this
plan's fixture has the human commit touch `a.txt` itself; its string opens with the heading
`\nCONTENDING TASKS:` and the sentence `The frontier side of each hunk is main since this run's
base; the incoming side is labeled run-<N> in the hunks.`, and the folder prepends nothing and
appends nothing to what it returns beyond that concatenation. The boot script's side is at BASE
too: `publish_fold()` in `fleet/sandbox-boot.sh` runs the folder once per attempt as the transient
unit `fleet-fold-<N>-<attempt>` with `WorkingDirectory=<target clone>` and the argv of M1, after
the engine has exited and before the head is pushed, and reads the disposition from the receipt
— so the folder pushes nothing, opens nothing and writes no status page; attempt 1's `pushedHead`
is written later by the boot script's `push_head`, and the folder reads it only to know which
attempts completed. Ground truth on the kernel, `skills/ultrapowers/kernel/fold_wave.py`:
`fold --repo --run-dir --wave --base --patch <id>=<file>` narrates conflicts to
`<run-dir>/frontier/wave-<n>/conflict-<i>.txt` + `conflict-<i>.hunks.txt` and indexes them in
`conflicts.json`, and **`<i>` starts at 1** (`_narrate` assigns `max(i in index, default 0) + 1`),
so the first conflict's reply directory is `reply-1-1/` and its brief is named with that same 1 —
run-32's exam asserted `reply-0-1` and could never have passed; the exam below keys every
reply-directory and brief name on the `i` it reads from `conflicts.json`, never on a literal;
hunk ids in a hunks file are `h1`, `h2`, … and a `RESOLVED` reply's `hunks[].id` is that id
verbatim. `fold` exits 2 when that wave's `fold_log.jsonl` already exists — which is why a
dangling attempt's wave directory is deleted at re-entry; `resolve --conflict <i> --reply-dir
<dir>` exits 4 on a bad reply (an empty `hunks` list is one); `materialize --prev-head <sha>
--patch … [--subject <s>]` prints `{"candidateSha"}`, a commit whose only parent is `prev-head`
when every task arrived as a patch, and answers `{"park": "<path> changes mode: <mode> at the
previous integration head, <mode> at task <id>"}` with exit 2 when `_observe_modes` finds a
touched path's mode at `prev-head` differing from the tasks' — the cross-run chmod shape; every
command prints one JSON object, parsed with `parseCliJson` from `run-engine.mjs`; `fold`'s reply
carries `open: [{ i, path, kind, epoch, hunksFile, hunkCount }]`, `conflicts`, `dispatchable`,
`parked` and `complete`, read the way `foldWave` in `run-engine.mjs` reads them. The kernel path
is `new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url)` as `runEngine`
resolves it; `compile_plan.py` is `../skills/ultrapowers/scripts/compile_plan.py` the same way,
and `<run dir>/launch.json` carries `tasks: [{ id, title, body, files, … }]` (written by
`ultra_run.py` through `--emit-launch`; never parse the plan a second time for this run's
bodies). The run directory is `<target clone>/.claude/ultrapowers/run-run-<N>` (the boot's
`run_dir_path`) and holds `args.json` (top-level `testCmd`, `bootstrapCmd`, `planPath` — the H1
for `--subject` is the first `# ` line of that file, as `runEngine` reads it), `launch.json`,
`events.jsonl`, `clones/integration` (cut `--local` at BASE by `provisionRunTree`, dependencies
installed there by `bootstrapCmd`, holding neither TIP nor the candidate until fetched — hence
the by-name fetch, since a bare sha is not advertised under every protocol), `clones/task-<id>`,
`patches/`, `workers/`, `claude/`, `preambles/`, `roles/`. The default branch's name is read
from `refs/remotes/origin/HEAD` in the target clone (`git symbolic-ref`), as the boot's
`default_branch` reads it; TIP is `refs/remotes/origin/<default>` after `git fetch origin
<default>`. The ancestry precondition is `git merge-base --is-ancestor BASE TIP` in the target
clone, which is a full clone. The agent: build it with `composeAgent` from `fleet/run-main.mjs`
(`composeAgent({ runId, base, runDir, clonesDir, patchesDir, workersDir, promptFileFor,
settingsFor, env, cli, eventLog }) -> { agent, patchInput }`), rebuilding the inputs `runMain`
builds from the run directory — `promptFileFor = writeRoleFiles(<run dir>/preambles)`,
`copyEngineRoles(<run dir>/roles)`, `settingsFor = writeConfineSettings({ runDir, hookPath:
<ENGINE_DIR>/fleet/confine-hook.mjs })` (all idempotent), the worker env `{ ...process.env,
CLAUDE_CONFIG_DIR: <run dir>/claude, FLEET_RUN_DIR: <run dir>, DISABLE_AUTOUPDATER: '1' }`,
`clonesDir`/`patchesDir`/`workersDir` under the run directory, `cli` `claude`, `eventLog =
makeEventLog({ file: <run dir>/events.jsonl, runId, base, source: 'fleet/publish-fold.mjs' })`
from `run-waves.mjs`, `base` a function returning BASE — and label each dispatch
`resolve:publish-fold:<attempt>:<i>:<a>` (the `labelPrefix` of M4 plus what `resolveConflicts`
appends): `roleForLabel` derives the resolver role from the `resolve:` prefix, a non-worktree
label routes its cwd to `clones/integration` (`makeCwdFor`), `makeAddDirsFor` grants the run
directory, and `nextWorkerDir` plus the fresh prefix avoid session collisions. `publishFold`
takes `deps = { makeAgent = composeAgent, exec = execSeam, rename = fs.renameSync }` so the exam
injects a stub agent exactly as `runMain`'s `makeAgent` seam is used, records every subprocess
call, and spies the receipt's rename; `roles` come from `loadRoles()` in `run-engine.mjs`.
`pathsJoined` = the size of the intersection of the two patches' path sets (read with `git apply
--numstat`); `pathsConflicted` = the number of conflicts the kernel narrated; `resolverRetries`
= transcripts with `attempt` 2. The restore rule for `candidate`: on every disposition it is the
sha the branch must hold after this attempt — the folded commit on `folded` and `suite red`,
`engineHead` on attempt 1's other rows, attempt 1's `candidate` on attempt 2's other rows. The
exam layer, as run-32's examiner found it: **the CLI has no injection seam for a stub resolver**
(it composes the real `claude` agent), so the two resolver-driven park shapes (BLOCKED; RESOLVED
with an empty `hunks` list rejected twice) and the resolved shape are asserted in-process by
calling `publishFold(opts, deps)` with a stub `makeAgent`, and every model-free shape (`nothing
to join`, the disjoint fold, the same-file-different-lines fold, `suite red`, `suite: 'none'`, the
binary pair, the delete/modify pair, both chmod shapes, the non-ancestor base, every re-entry
shape and both attempt-2 shapes) is swept through the real CLI — `node fleet/publish-fold.mjs …`
spawned with `execFileSync`, asserting exit 0 and the receipt's disposition. The exam,
`fleet/tests/test_publish_fold.mjs`, builds a real repository: a bare `origin` (`git init --bare
--initial-branch=main`), a first clone that seeds and pushes `main` and holds
`refs/remotes/origin/HEAD` (this is the target clone, `--repo`), and a second clone that moves
`main` on the origin afterwards and pushes run 3's plan tag `ultra/plan/run-3` — carrying a
`.ultrapowers/plan.md` whose one task `T1` names the conflicted path in its Files — AFTER the
target clone was made; a run directory provisioned with `provisionRunTree` from `run-main.mjs`
(which cuts `clones/integration` at BASE), an `args.json` carrying `testCmd` (`bash check.sh`, a
script the fixture commits at BASE so the suite is green or red by fixture choice) and
`planPath`, a `launch.json` with this run's `tasks`, and an integration branch built by committing
on top of BASE in the target clone. **TIP is never read from the target clone before the folder
runs** — that clone was cut before main moved and nothing fetches into it until the folder does,
so run-32's leg (d), which ran `git rev-parse <TIP>^{tree}` there before the call, failed under
every implementation; a fixture-sanity read of TIP comes from the bare origin (`git -C <origin>
rev-parse refs/heads/main`) or the second clone, and a read from the target clone's
`refs/remotes/origin/main` is made only after `publishFold` has returned. The conflicted
fixture's literals: `a.txt` at BASE is ten lines `line1` … `line10`, each newline-terminated;
main's first move (in the second clone, message trailer `Fleet-Run: 3`) rewrites line 2 as `line2
from main`; main's second move (a human: no trailer, author name `A Human`, subject `tidy the
tail`) appends an eleventh line `line11 human` — a region neither side fights over, so it folds
and the commit still appears in `a.txt`'s first-parent log; the run rewrites line 2 as `line2
from run`; the stub resolver answers `RESOLVED` with `hunks: [{ id: 'h1', content: 'line2 from
main\nline2 from run' }]`; the candidate's `a.txt` is therefore `line1\nline2 from main\nline2
from run\nline3\n` … `line10\nline11 human\n`. The two-path fixture repeats the line-2 shape on
`c.txt` in the same commits (main's trailered commit rewrites line 2 of both files; the run
rewrites line 2 of both; this run's `launch.json` task names both files; run 3's plan task names
only `a.txt`, so `c.txt`'s block has no `- run 3` entry). Run every fold in the sim from a unique
temp directory (same-wave sims share one machine); `tests/test_fleet_suite.py` gives each sim
file 120 s, so build the seeded origin and clones once as a template and copy it per case rather
than re-seeding. `python3` is real on the box the sims run on; the kernel is driven for real.

**Proof:**
- Test: `fleet/tests/test_publish_fold.mjs`
- Legs: (a) main moved by a commit editing `b.txt` and the run editing `a.txt`: attempt 1 records
  `folded`, `candidate`'s parent list is exactly `[TIP]` where TIP was read from the bare origin
  before the call, `git show <candidate>:a.txt` is the run's text and `git show <candidate>:b.txt` main's,
  `refs/heads/ultra/integration-run-<N>` equals `candidate`, the target clone's
  `refs/remotes/origin/main` equals TIP after the call, `main.patch` and `run.patch` exist under
  `<evidence-dir>/publish-fold/` and `pathsJoined` is 0 — so disjoint sides fold and land on TIP;
  the recording `deps.exec` (a wrapper around `execSeam` the exam injects) shows the kernel
  `materialize` argv carrying `--prev-head <TIP>` and `--subject <the first "# " line of the
  fixture's plan file, verbatim>`, and the candidate commit's subject line equals that H1 [M2];
  the same fixture with both sides editing different lines of `a.txt` gives `pathsJoined` 1,
  `resolversDispatched` 0 and a tree carrying both edits [M2]; every fixture passes a `--run-dir`
  and an `--evidence-dir` that are distinct directories (`<tmp>/run` and
  `<tmp>/evidence/.ultrapowers/runs/<N>`); `engine-head` holds the branch sha the fixture built,
  `receipt.json`'s `engineHead` equals it, the recording `deps.exec` asserts at the moment of the
  first `git fetch` call that `engine-head` already exists with that sha (an `engine-head`
  written after any fetch fails there), a second run of attempt 1 after the file exists leaves
  its mtime and content unchanged; the exam's `deps.rename` spy records every call, asserts each
  one is exactly `(<evidence-dir>/publish-fold/receipt.json.tmp,
  <evidence-dir>/publish-fold/receipt.json)` and reads the tmp's bytes before letting the rename
  through, and the receipt's final bytes equal the last tmp bytes the spy saw — a write that
  bypasses the seam leaves the two different; and the recording `deps.exec` shows the two patch
  cuts as `['diff', '--binary', '--full-index', '--no-renames', '<BASE>..<TIP>']` and `['diff',
  '--binary', '--full-index', '--no-renames', '<BASE>..<engineHead>']`, with main's first [M1]
  [M2]; the moved-main fixture run with a `deps.exec` that lets `fetch origin main` and the
  following `rev-parse refs/remotes/origin/main` through and throws on the next git call: the
  folder rejects, the receipt afterward holds `engineHead`, attempt 1 `tip` = the moved TIP (as
  the bare origin reports it) and no attempt-1 `disposition`, no kernel call was made, and a
  further `--attempt 1` with a plain `deps.exec` completes `folded` — so `tip` is written after
  the fetch and before anything else, and a folder writing `tip` later fails on the first receipt
  read [M1] [M6]; (b) with the origin's `main` still at BASE the CLI's receipt records `nothing
  to join`, `pathsJoined: 0`, `candidate` = `engineHead`, `tip` = BASE, the branch's sha is
  unchanged, no `publish-fold/frontier/` directory exists, and the CLI exits 0 [M2] [M1]; (c)
  the fixture's `check.sh` made to exit 1 yields, through the CLI, `suite red` with `suite:
  'fail'`, `suite-1.txt` carrying the script's output, the branch still at the candidate, and
  `clones/integration`'s HEAD and working tree equal to what they were before the fold; the
  passing fixture yields `folded` with `suite: 'pass'` and the same restore; an `args.json` with
  no `testCmd` yields `folded` with `suite: 'none'`, no `suite-1.txt` and no `bash` call in the
  recording `deps.exec`; and the recording `deps.exec` (in-process, on the passing fixture)
  shows, in order, a `git` call `['fetch', '--no-tags', <target clone>,
  'refs/heads/ultra/integration-run-<N>']` with cwd `clones/integration`, a `git read-tree -u
  --reset <candidate>^{tree}` there, exactly one `['bash', '-lc', <the args.json testCmd
  verbatim>]` with cwd `clones/integration`, then a `git reset --hard` there [M3]; (d) the
  conflicted fixture of Context (main's trailered line-2 rewrite of `a.txt`, then the human
  commit appending `line11 human`, the run's line-2 rewrite), in-process with the stub resolver:
  the stub is dispatched once with a label starting `resolve:publish-fold:1:`; its prompt
  contains, in this order, the sentence `The frontier side of each hunk is main since this run's
  base; the incoming side is labeled run-<N> in the hunks.`, `- run 3 task T1: ` followed on the
  next line by run 3's `T1` body verbatim from the tag's plan (a tag pushed to the origin after
  the target clone was made, compiled through `compile_plan.py` by the block builder), the line
  `- main <sha7> "tidy the tail" (A Human, no plan)` with `<sha7>` the human commit's first seven
  hex digits, and `- run <N> task ` followed by this run's task body verbatim from `launch.json`;
  the prompt contains neither `ultra/integration-run-` nor the string `launch.json`; inside the
  stub, `git rev-parse HEAD^{tree}` in its cwd equals the tree of TIP as the bare origin reports
  it and `a.txt` read from that cwd contains `line2 from main` and `line11 human`; the receipt
  records `folded` with `resolversDispatched` 1 and the event `resolverRetries` 0; the reply
  directory the resolver's reply was written to is `<run dir>/publish-fold/frontier/wave-1/reply-<i>-1/`
  with `<i>` equal to the `i` of the sole entry in that wave directory's `conflicts.json` (1 —
  and the leg reads it, never assumes it), and after the attempt
  `<evidence-dir>/publish-fold/frontier/wave-1/reply-<i>-1/h1.txt` exists with the same bytes
  while `<evidence-dir>/publish-fold/resolver-brief-<i>-1.txt` is a file there whose bytes equal
  the prompt the stub received; `git show <candidate>:a.txt` is byte-equal to `line1\nline2 from
  main\nline2 from run\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11 human\n`;
  the recording `deps.exec` shows the kernel `fold` argv carrying `--wave 1`, `--run-dir <run
  dir>/publish-fold`, `--patch main=…` before `--patch run-<N>=…`, and no `--commutes` word
  anywhere in any kernel argv; and `clones/integration` is back at its own HEAD afterward [M4];
  (e)
  in-process: a stub resolver answering BLOCKED yields `conflict parked` with `path` `a.txt`,
  `candidate` = `engineHead`, the branch unchanged, no `materialize` in the recording
  `deps.exec` (and no `candidateSha` anywhere in the receipt) and `clones/integration` restored;
  a stub resolver answering `RESOLVED` with an empty `hunks` list on both dispatches (the kernel
  rejects the reply with exit 4 twice) yields `conflict parked` with `resolversDispatched` 2,
  the event's `resolverRetries` 1 and the branch unchanged; through the CLI, each asserting exit
  0 and the receipt's disposition: a binary `logo.png` committed on main and a different
  `logo.png` on the run yields `conflict parked` with `path` `logo.png` and
  `resolversDispatched` 0; main deleting `d.txt` while the run edits `d.txt` yields `conflict
  parked` with `path` `d.txt` and the branch unchanged; a `chmod +x` of `tool.sh` on main since
  BASE with the run never touching `tool.sh` yields `cannot fold` with `reason` containing
  `changes mode` and the branch unchanged, and the same chmod with the run editing `tool.sh`'s
  content yields `cannot fold` too; a `--base` that is not an ancestor of TIP (a side commit's
  sha) yields `cannot fold` with `reason` naming ancestry and no `frontier/` directory (no
  kernel call); and the CLI's exit status is 0 on every one of these shapes and on the `nothing
  to join`, `folded`, `suite red` and `tip unmoved` shapes the other CLI-driven legs produce — a
  non-zero exit on any named disposition fails, while the in-process shapes assert that
  `publishFold` resolves rather than rejects [M5] [M1]; (f) through the CLI: a receipt
  pre-written with attempt 1 `{ tip, candidate: <some sha the fixture commits>, disposition:
  'folded' }` beside a planted `receipt.json.tmp` holding `stray` makes `--attempt 1` restore the
  branch to that sha, exit with `folded`, dispatch nothing, leave no new `frontier/wave-1/`
  entries, and leave no `receipt.json.tmp` behind (the planted file is gone and the receipt's
  bytes are unchanged); a receipt with attempt 1 `conflict parked` and `candidate` =
  `engineHead` restores to `engineHead` (the parked attempt wins); a receipt with attempt 1
  `folded` at candidate X and attempt 2 `folded` at candidate Y (both shas the fixture commits)
  makes `--attempt 1` restore the branch to Y, not X, and exit with attempt 2's disposition; a
  receipt with attempt 1 complete and attempt 2 holding `tip` but no `disposition`, plus a
  pre-made `frontier/wave-2/fold_log.jsonl` under both `<run dir>/publish-fold/` and
  `<evidence-dir>/publish-fold/`, makes `--attempt 1` delete both `frontier/wave-2/` directories,
  drop attempt 2 from the receipt and exit with attempt 1's disposition; a `receipt.json`
  holding `{not json` with the branch pushed to the origin makes `--attempt 1` write a receipt
  whose attempt 1 reads `cannot fold`, `reason: receipt unparsable`, `candidate` and
  `pushedHead` both equal to the origin's branch sha, the local branch restored to it, the
  clone's `refs/remotes/origin/ultra/integration-run-<N>` present afterward —
  `git fetch origin <branch>` happened — and nothing dispatched; the same with the origin holding no such
  branch yields `candidate` = `engine-head`'s content and no `pushedHead` key; a stray
  `receipt.json.tmp` is absent after any of these [M6]; (g) after the clean fold `events.jsonl`'s
  last `driver:publish-fold` event deep-equals the expected object on every one of the twelve
  named keys (`run`, `attempt`, `base`, `tip`, `candidate`, `pathsJoined`, `pathsConflicted`,
  `resolversDispatched`, `resolverRetries`, `suite`, `disposition` plus `kind`), the conflicted
  fold's event carries `pathsConflicted` 1, and `ls <evidence-dir>/publish-fold/` names
  `main.patch`, `run.patch`, `frontier`, `suite-1.txt` and, for the resolved shape, exactly one
  name matching `/^resolver-brief-\d+-1\.txt$/` whose `<i>` equals `conflicts.json`'s, with
  `<evidence-dir>/publish-fold/frontier/wave-1/fold_log.jsonl` byte-equal to
  `<run dir>/publish-fold/frontier/wave-1/fold_log.jsonl`; and the parked shape (BLOCKED) also
  leaves `<evidence-dir>/publish-fold/frontier/wave-1/` in place [M7]; (h) through the CLI:
  after a completed attempt 1 with `pushedHead` written into the receipt by the sim, `--attempt
  2` with the origin's `main` unmoved records attempt 2 `tip unmoved` with `candidate` equal to
  attempt 1's and no `frontier/wave-2/` directory; with `main` moved again (a further commit
  pushed from the second clone), attempt 2's candidate has parent exactly the new TIP as the bare
  origin reports it, `run.patch` under attempt 2 equals the diff `BASE..engineHead` (not
  `BASE..<candidate 1>`), and the tree carries the run's edit, main's first move and main's
  second move [M8]; (i) the two-path fixture of Context (`a.txt` and `c.txt` both rewritten at line 2 on both
  sides), in-process with the stub resolver: the stub is dispatched exactly twice, once per `i`
  in that wave directory's `conflicts.json`, and each of the two prompts contains `a.txt`'s block
  before `c.txt`'s — the `- run <N> task ` entry naming `a.txt` precedes the second
  `CONTENDING TASKS:` heading, and no `- run 3` line follows that second heading — with the
  receipt `folded`, `resolversDispatched` 2, the event `pathsConflicted` 2, and the candidate's
  `c.txt` carrying the stub's `h1` content at line 2 [M4].

**Stale-if:**
- path-exists: `fleet/publish-fold.mjs`
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/publish-fold-block.mjs`
- path-absent: `fleet/run-main.mjs`
- path-absent: `skills/ultrapowers/kernel/fold_wave.py`
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #715
