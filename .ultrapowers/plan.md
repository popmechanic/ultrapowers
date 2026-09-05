# Boot and record, the follow-up: the retire sweep lands, the janitor reads by tag, and the documents say so

**Grammar:** claims-v1

**Claim:** After this run, `node fleet/retire.mjs --target owner/repo` tags every run already on
a target, verifies each tag with `git ls-remote --tags` against the remote, then deletes the
branch pairs highest N last; the janitor still reaps a run whose plan and evidence branches are
gone, because it reads the record by its tag; and the contract, the runbook and the boot
script's own banner say the record is the two tags and the branches are transient. (elicited)

**Goal:** Bundle R1b of the 2026-09-05 wave — the follow-up to run-25 (draft PR #693), which
landed seven of the eight boot-and-record tasks and parked on two findings. **BASE for this plan
is not `main`: it is `f17b977587a0a55508d1caced58d3dc7a10d92a3`, the head of PR #693
(`ultra/integration-run-25`), the folded tree of run-25's seven landed tasks.** Four tasks, one
wave, disjoint Files: (1) `fleet/retire.mjs`, the one-time sweep that run-25's task 7 lost to an
exam-edit standoff — settled here in the plan: retire prints its one line per run on stdout, may
also return them, and the exam grades stdout; (2) `fleet/janitor.mjs` reads a finished run's
record at the evidence tag first and the branch second, because at BASE the boot deletes both
branches at publish and the janitor's branch-only read returns null for every finished run, so no
VM is ever reaped (run-25's critic, task 4); (3) `fleet/CONTRACT.md`'s PR-body sentence still
spells the branch links the boot no longer writes (run-25's blocking finding) and
`fleet/RUNBOOK.md`'s per-run paragraph still computes N from branches only — both say the tag
spellings, and the janitor's read-by-tag is described where each document describes the janitor;
(4) `fleet/sandbox-boot.sh`'s header banner still presents the three branches as durable — a
comment-only edit. #673, #679, #624 and #384 are the tickets run-25 was authored to close; PR #693
is a draft, so this plan carries the same line.
**Closes:** #673 #679 #624 #384

**Tech Stack:** Node 24 ESM (`fleet/lobby.mjs`, `fleet/janitor.mjs`, the new `fleet/retire.mjs`,
the `fleet/tests/test_*.mjs` sims — each prints `ALL TESTS PASSED` and opens no socket; `git`,
`gh`, `ssh` reach the sims only through the `exec` seam of `fleet/tests/_lobby_helpers.mjs`),
bash (`fleet/sandbox-boot.sh`, comment-only here), Python 3 (`python3 -m pytest`), Markdown.
Nothing is added to any dependency file; every new module imports only `node:`-prefixed
specifiers and `./lobby.mjs`.

**Spec:** none — the four issues, the 2026-09-05 decisions recorded on #624 and #679, and run-25's
report (`.ultrapowers/runs/25/report.json` on the target's `ultra/evidence-run-25`); every fact a
worker needs from them is in its task's Context, because the sandbox has no `docs/superpowers/`.

**Parallelization rationale:** One wave, width 4. Every task carries its own contract and its own
exam; the shared shapes — the two tag names `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`,
the two branch names they replace — are literals repeated in each Context, never a `Consumes:` of
a sibling, so no task waits on another. The Files blocks are pairwise disjoint: the retire task
creates `fleet/retire.mjs` and its exam; the janitor task owns `fleet/janitor.mjs` and its two
sims; the documents task owns the two operator documents; the banner task owns
`fleet/sandbox-boot.sh`. No task names `fleet/retire.mjs` in `fleet/RUNBOOK.md`, because
`tests/test_docs_agree_with_code.py` requires every `fleet/*.mjs` a document names to exist on the
tree the exam runs on, and only the retire task's clone has the file; `fleet/CONTRACT.md` already
names the verb at BASE and that pin does not read the contract.

## Global Constraints

- Check: test "$(git hash-object fleet/lobby.mjs)" = 62d348b5982a879df341fdf77e0115ae1d639719
- Check: test "$(git hash-object fleet/launch.mjs)" = a2bcd0491f5af05f77606c747c8f4f6bc3659138
- Check: test "$(git hash-object skills/ultralearn/scripts/harvest_fleet_runs.py)" = 5e20e6b5ac745a17fe19de01114fbbbef9bea1e9
- Check: test "$(git hash-object fleet/doctor.mjs)" = 5e0d5c9a9342fa35f6fb5e5dfb18ca5be7a05466
- Check: bash -n fleet/sandbox-boot.sh
- Check: node --check fleet/janitor.mjs
- The two tags are spelled `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`; the three branches
  keep their spellings `ultra/plan-run-<N>`, `ultra/integration-run-<N>`, `ultra/evidence-run-<N>`.
  No other ref shape is introduced anywhere.
- Amendment 10 holds: every `git` and every GitHub call is a script's, never a model's; the laptop
  tools reach `git` and `gh` only through the `exec` seam so the sims stub them, and no sim opens a
  socket.
- `fleet/retire.mjs` is named by no document but `fleet/CONTRACT.md`, where BASE already names it:
  `tests/test_docs_agree_with_code.py` checks that every `fleet/*.mjs` named in `fleet/RUNBOOK.md`,
  `README.md` and the two skill documents exists on the tree under test.
- No `?ref=` in `fleet/RUNBOOK.md` or `fleet/CONTRACT.md` names `ultra/evidence-run-` — the
  docs-agree suite pins it; a branch fallback is described in prose, never as a `?ref=` recipe.
- No file outside a task's own Files block is edited — in particular not `fleet/launch.mjs`,
  `fleet/lobby.mjs`, `fleet/doctor.mjs`, `skills/ultrapowers/SKILL.md`, `README.md`, `CLAUDE.md`,
  `tests/test_docs_agree_with_code.py` or `fleet/tests/test_launch_reaps.mjs`; a pin in one of
  those files is kept green by the shape of the change, not by editing the pin.
- No sentence of a document is matched against itself: a documents claim proves itself by a
  scoped `Run:` command over the operative words.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: `fleet/retire.mjs`, the one-time sweep

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/retire.mjs`
- Test: `fleet/tests/test_retire.mjs`

**Claim:** `node fleet/retire.mjs --target owner/repo` turns every plan-and-evidence branch pair
on the target into the two tags, verified with `git ls-remote --tags` against the remote, then
deletes the pair, highest N last, printing one line per run on stdout as it goes, and `--dry-run`
only says what it would do. (derived)
Machine: M1. `retire({ argv, exec })` refuses (a `Refusal`, `exitCode` 2, no `gh` call and no
`git` call) without `--target` or with a `--target` that `isSafeTarget` rejects, and `--dry-run`
is a valueless flag; run as a process, `node fleet/retire.mjs` with no `--target` exits 2, names
`--target` on stderr, and starts no `gh` and no `git` — the script's entry calls `retire` with
`process.argv` and the real exec, and its exit code is the refusal's. M2. It lists the target with exactly one
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
`retire` sets `process.exitCode` to 1 when any run was kept. M5. For each candidate it reads `gh
api repos/<owner>/<repo>/pulls?state=closed&head=<owner>:ultra/integration-run-N` and, for every
PR answered whose body contains `/blob/ultra/plan-run-N/` or `/tree/ultra/evidence-run-N/`, issues
`gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -f body=<body>` with those substrings
rewritten to `/blob/ultra/plan/run-N/` and `/tree/ultra/evidence/run-N/` and nothing else changed;
a PR whose body carries neither is not patched. M6. Under `--dry-run` the calls through the `exec` seam
are exactly the one heads-and-tags listing and one pulls read per candidate — no `gh api` call
carries `-X`, no `git` call but the listing is made, nothing is created or deleted through any
command — and every candidate's line contains `would`; run as a process, `node fleet/retire.mjs
--target <owner>/<repo> --dry-run` reaches `git` and `gh` on `PATH` through the real exec, prints
its lines on the process's stdout, and exits 0. M7.
Every per-run line — one per run number the listing carries, candidates and lone halves alike,
each beginning `run N:` — is written to `process.stdout` as that run is decided, in ascending N so
the highest N is last; stdout is the record, the resolved value may also carry the same lines
under `lines`, and the exam grades stdout. `git` and `gh` are reached only through the `exec`
seam.

**Authorized-by:** #624 (the 2026-09-05 decision comment: a one-time `fleet/retire.mjs` tags runs 1–18 here and 1–7 on the walk repo, verifies each tag with `git ls-remote --tags` against the remote, then deletes the 36 + 14 branches, highest N last); run-25's task 7 record (exam edited, `fix-loop-exhausted`), settled by this plan's M7

**Interfaces:**
- Consumes: none
- Produces: `retire({ argv, exec }) -> Promise<{ retired: number[], kept: number[], skipped: string[], lines: string[] }>`

**Context:** Decided 2026-09-05 on #624: tags are the record and the branches are transient;
`popmechanic/ultrapowers` carries 18 `ultra/plan-run-*` + 18 `ultra/evidence-run-*` and
`popmechanic/ultrapowers-walk` 7 + 7 (every integration branch already deleted), and the order
after this plan merges is: a smoke run proves a fresh run leaves two tags and no branch, then this
sweep, then confirm the next N is 19. Run-25's attempt at this task died on one hunk of the peer
exam: the peer's `sweep()` helper captured `process.stdout.write` and fell back to a returned
`lines` array when nothing was printed; the implementer removed the fallback, and the reviewer
ruled the graded file is the peer's. This plan settles it in M7: the lines go to stdout as they
are decided (write them with `process.stdout.write` or `console.log`, both of which the exam's
capture sees), the returned value may carry them too, and the exam reads stdout and never the
returned array — an examiner who writes a fallback to `result.lines` is writing a leg that
cannot fail. The tag names are shared literals with the boot's record step:
`ultra/plan/run-<N>` at the plan branch's head (the plan commit the launcher pushed) and
`ultra/evidence/run-<N>` at the evidence branch's head. This tool runs on the laptop with no
clone: `git ls-remote <url>` needs none, and a tag pointing at a sha the remote already holds is
created through GitHub's refs API rather than a push, because `git push <sha>:refs/tags/…`
requires the object locally. Verify against the remote with `ls-remote` and never `cat-file -e`
or `fetch <sha>` — git satisfies a local want without asking the server. The laptop's `gh` is
authenticated as the operator (this is not the edge; nothing here runs on a VM), and `gh api -f
key=value` sends string fields, which is what `git/refs` (`ref`, `sha`) and `pulls/<n>` (`body`)
take. Build on `fleet/lobby.mjs` exactly as `fleet/janitor.mjs` and `fleet/target.mjs` do:
`export async function retire ({ argv = [], exec = defaultExec })`, then `runCli` at the bottom
when run as a script (`runCli` prints a thrown `Refusal` and sets `process.exitCode` from its
`exitCode`; a kept run is not a throw, so `retire` sets `process.exitCode = 1` itself);
`parseArgs(argv, { flags: ['dry-run'] })`, `isSafeTarget`, `Refusal`, `output`, `defaultExec`,
`planBranchFor`, `evidenceBranchFor`, `planTagFor`, `evidenceTagFor` and `runOfBranch` (the run
number of any of the five ref shapes, with or without a `refs/heads/` or `refs/tags/` head, else
null) are BASE exports of `lobby.mjs`. The PR list filter `head=<owner>:<ref>` matches on the
head ref's name, which GitHub keeps after the branch is deleted, so a merged run's PR is found by
`ultra/integration-run-N`; a closed-but-unmerged measurement PR is found the same way and its
links are rewritten too, because its body links the same branches. Every line: `run N: retired
ultra/plan/run-N@<7 hex> ultra/evidence/run-N@<7 hex>, 2 branches deleted, <k> PR(s) patched`,
`run N: kept — <why>`, `run N: would …` under `--dry-run`, and `run N: skip — lone <ref>` for a
half pair. No document is edited by this task: `fleet/CONTRACT.md` already names `node
fleet/retire.mjs --target <owner>/<repo>` at BASE, and `fleet/RUNBOOK.md` refers to "the one-time
retire sweep" and defers to the contract for the script — it must keep doing so, because
`tests/test_docs_agree_with_code.py` reads every `fleet/*.mjs` the runbook names against the tree
under test. The exam is `fleet/tests/test_retire.mjs`, built on `makeExec` from
`fleet/tests/_lobby_helpers.mjs` (`cmdRule`, `answer`, rules matched in order, `exec.calls` and
`exec.line` per call); no rule runs `git` or `gh` for real (pass `passthrough: []`), and the sim
prints `ALL TESTS PASSED`. A `git ls-remote` answer is `<sha>\t<ref>` per line; a `gh api` POST
answer for an existing reference is exit 1 with `Reference already exists` in its output; a
`pulls?…` read answers a JSON array of `{ number, body }`. The exam's one process-level leg
spawns `node fleet/retire.mjs` with `spawnSync` (as `fleet/tests/test_doctor.mjs` and
`fleet/tests/test_claude_token.mjs` spawn their CLIs) under a `PATH` whose first entry is a
`tempDir()` holding executable `git` and `gh` shims the exam wrote with `fs.writeFileSync` (mode
`0o755`) — `defaultExec` is `execFile`, so the shims are what the real exec finds; no network is
reached and nothing outside the temporary directory is written. The script's entry (the
`invokedPath === fileURLToPath(import.meta.url)` guard `fleet/janitor.mjs` uses) must call
`retire({ argv: process.argv.slice(2) })` so that leg sees the real exec.
**BASE facts:** (generated at f17b977)
- `Refusal` at `fleet/lobby.mjs:280` blob 62d348b
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `isSafeTarget` at `fleet/lobby.mjs:41` blob 62d348b
- `kept` at `fleet/tests/test_sandbox_boot_merge.mjs:124` blob bed2fad
- `lines` at `fleet/doctor.mjs:410` blob 5e0d5c9
- `exec` at `fleet/tests/_lobby_helpers.mjs:85` blob 86c4674
- `fleet/lobby.mjs` blob 62d348b
- `fleet/janitor.mjs` blob 236dc2f
- `fleet/target.mjs` blob c189a05
- `runCli` at `fleet/lobby.mjs:302` blob 62d348b
- `output` at `fleet/lobby.mjs:247` blob 62d348b
- `defaultExec` at `fleet/doctor.mjs:171` blob 5e0d5c9
- `planBranchFor` at `fleet/lobby.mjs:113` blob 62d348b
- `evidenceBranchFor` at `fleet/lobby.mjs:115` blob 62d348b
- `planTagFor` at `fleet/lobby.mjs:126` blob 62d348b
- `evidenceTagFor` at `fleet/lobby.mjs:127` blob 62d348b
- `runOfBranch` at `fleet/lobby.mjs:143` blob 62d348b
- `fleet/CONTRACT.md` blob b8e36ad
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `cmdRule` at `fleet/tests/_lobby_helpers.mjs:47` blob 86c4674
- `answer` at `fleet/claude-token.mjs:106` blob 356883f

**Proof:**
- Test: `fleet/tests/test_retire.mjs`
- Legs: (a) `retire({ argv: [], exec })` and `retire({ argv: ['--target', 'bad name'], exec })`
  each reject with a `Refusal` whose `exitCode` is 2 with `exec.calls` empty [M1]; (b) a seam whose
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
  `[3]` and whose `retired` is `[12]`, and `process.exitCode` equal to 1 after the call (reset by
  the exam before and after) — a tool that halts at the first kept run never reaches run 12 and
  fails this leg; over the second leg's seam, where nothing is kept, `process.exitCode` is not set
  to 1 [M4]; (e) with the pulls read for run 3 answering one PR whose body links
  `/blob/ultra/plan-run-3/.ultrapowers/plan.md` and `/tree/ultra/evidence-run-3/.ultrapowers/runs/3/`,
  one `api -X PATCH repos/o/r/pulls/<number> -f body=<body>` is issued whose body carries
  `/blob/ultra/plan/run-3/.ultrapowers/plan.md` and `/tree/ultra/evidence/run-3/.ultrapowers/runs/3/`
  and is otherwise byte-identical — a PATCH that rewrites any other byte, or that still carries a
  branch path, fails [M5]; (f) with the pulls read for run 12 answering one PR whose body carries
  neither branch path, no `api -X PATCH` names that PR's number [M5]; (g) `--dry-run` over the
  seam of the second leg leaves `exec.calls` equal to exactly three calls — the one heads-and-tags
  `ls-remote`, then the pulls read for run 3, then the pulls read for run 12 — so no `gh` call
  carries `-X`, no `git push`, no `--delete` and no second `ls-remote` is made through the seam;
  and each of the `run 3:` and `run 12:` lines contains `would` [M6]; (h) every
  line the previous legs read is taken from `process.stdout.write` captured for the duration of
  the call and never from the resolved value — the helper that collects them asserts the capture
  is non-empty and does not consult `result.lines`; and, over the seam of the second leg, the
  `run 3:` line has been written before the run-12 POST is issued, so a tool that buffers every
  line until it returns fails [M7]; (i) spawned as a child process with a temporary directory
  first on `PATH` holding two shims the exam writes — a `git` that appends its arguments to a log
  and prints the two-line listing `<sha>\trefs/heads/ultra/plan-run-3` and
  `<sha>\trefs/heads/ultra/evidence-run-3`, and a `gh` that appends its arguments to a log and
  prints `[]` — `node fleet/retire.mjs --target o/r --dry-run` exits 0, its stdout carries a line
  beginning `run 3: would`, the git log holds exactly one line and it contains `ls-remote`, the gh
  log holds exactly one line, that line contains `api repos/o/r/pulls` and no line of either log
  contains `-X` or `--delete`; and spawned the same way with `--target o/r` and no `--dry-run`, the
  gh log's first line is the `api -X POST repos/o/r/git/refs` for `refs/tags/ultra/plan/run-3` —
  a script whose entry hands `retire` an inert exec, or prints nothing on the process's stdout,
  fails this leg [M1, M6, M7].
- Run: node fleet/tests/test_retire.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs the sim to its sentinel [M7].
- Run: d="$(mktemp -d)" && printf '#!/bin/sh\ntouch %s/called\nexit 1\n' "$d" > "$d/gh" && cp "$d/gh" "$d/git" && chmod +x "$d/gh" "$d/git" && (PATH="$d:$PATH" node fleet/retire.mjs >/dev/null 2>"$d/err" && exit 1 || test "$?" = 2) && grep -q -- '--target' "$d/err" && test ! -f "$d/called"
- The previous bullet runs the script as a process with no `--target`, with `gh` and `git` shimmed
  to leave a marker if started: the process exits 2 (exit 0 fails the subshell outright, any other
  code fails the test), stderr names `--target`, and the marker is absent [M1].
- Run: node --check fleet/retire.mjs && grep -c 'node fleet/retire.mjs --target' fleet/CONTRACT.md | grep -q '^1$'
- The previous bullet is the leg for the file parsing and the contract naming the verb exactly
  once, as it did before this task — a task that added a second mention, or one in the runbook,
  fails the script-exists pin in a sibling's clone [M7].
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider
- The previous bullet is the docs-agree suite on a tree that has the file, its own exit status
  the evidence: no document names a script that is not there [M7].

**Stale-if:**
- path-exists: `fleet/retire.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- issue-closed: #624

### Task 2: The janitor reads a finished run by its tag

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/tests/test_janitor_reap_only.mjs`
- Test: `fleet/tests/test_janitor.mjs`

**Claim:** The janitor reaps a finished run whose plan and evidence branches the sandbox has
already deleted: it reads the run's status page at the evidence tag first and at the evidence
branch only while the sweep is pending, ages a run that has no page from the plan tag's commit
and then from the plan branch, and says which ref it read. (derived)
Machine: M1. For every row with a readable assignment, the janitor issues `gh api
repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` first, and
issues the same path with `?ref=ultra/evidence-run-<N>` only when the tag read answers no contents
envelope; a page found on either ref drives the same verdict — `rm <vm> --json` for a state in
`done|parked|failed` whose `updatedAt` is older than `--age` (default `1h`), nothing otherwise —
and a page found on the tag issues no branch read for that row. M2. When neither ref answers a
page, the run's age is the plan tag's commit: `gh api
repos/<target>/git/ref/tags/ultra/plan/run-<N>` read for `.object.sha`, then `gh api
repos/<target>/commits/<that sha>` read for `.commit.committer.date`; only when the tag ref read
answers no `.object.sha` is `repos/<target>/branches/ultra/plan-run-<N>` read for
`.commit.commit.committer.date` as at BASE; an age over six hours from either source puts the row
in `stale`, a younger age leaves it alone, and a row with no age from any source is neither
`stale` nor an action. M3. Every `stale` entry's `from` is the ref the state or the age was read
from — `ultra/evidence/run-<N>`, `ultra/evidence-run-<N>`, `ultra/plan/run-<N>` or
`ultra/plan-run-<N>` — and `renderJanitor` prints it in the parentheses of the `stale` line,
whose shape is otherwise BASE's. M4. Everything else holds as at BASE: `--dry-run` issues the
same reads and no `rm`; a row with no comment or no `target=` gets no `gh api` read; every `gh`
call is exactly `api <path>` with no flag; no `git` command, no `ssh <ssh_dest>` command, and
nothing under `~/.ultrapowers/` but `fleet.json` is read; and `fleet/tests/test_launch_reaps.mjs`,
untouched, still reaps its two-hour-old `done` run from a page canned at the branch path.

**Authorized-by:** #624 (decision c, 2026-09-05: the launcher reads tags for N, the harvester reads by tag); run-25's task 4 critic finding (the record step blinds `fleet/janitor.mjs`); #607

**Interfaces:**
- Consumes: none
- Produces: `janitor({ argv, exec, config, now }) -> Promise<{ dryRun, age, actions, stale, unknown }>`

**Context:** At BASE the boot's `record_tags` (in `fleet/sandbox-boot.sh`) runs after the last
evidence push of a `done` or `parked` run: it tags the plan commit `ultra/plan/run-<N>` and the
evidence head `ultra/evidence/run-<N>`, verifies both against the remote, and deletes
`ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in one push. So a finished run has its page on
the tag and no branch; a run still in flight has its page on the branch and no tag; a run that
ended `failed`, a run whose tag did not verify, and every run from before the tags keep their
branches until the one-time sweep (`fleet/retire.mjs`, another task of this plan) tags them and
deletes the pair. The janitor at BASE reads only `?ref=ultra/evidence-run-<N>` and ages a
page-less run only from `repos/<target>/branches/ultra/plan-run-<N>`, so for every finished run
both reads answer 404, `readEvidence` and `planCommittedAt` return null, the loop `continue`s,
and no VM is reaped — run-25's critic on task 4. The contents API resolves `?ref=` to a branch or
a tag alike, which is why the same path with a different `ref=` is the whole change for the page
read. A lightweight tag's `git/ref/tags/<name>` document is `{ ref, object: { sha, type } }`
(`gh api repos/<o>/<r>/git/ref/tags/ultra/plan/run-3`, slashes in the name spelled as they are),
and `repos/<o>/<r>/commits/<sha>` answers the commit document whose committer date is at
`.commit.committer.date` — one level shallower than the branches endpoint's
`.commit.commit.committer.date`. `gh api <path>` answers an absent ref as exit 1 with `HTTP 404`,
which `ghApi` already turns into null. `planTagFor`, `evidenceTagFor`, `planBranchFor` and
`evidenceBranchFor` are BASE exports of `fleet/lobby.mjs`; add no export to `lobby.mjs` (its hash
is pinned by the Global Constraints). Keep the module's shape: `janitor({ argv, exec, config, now
})`, the `ghApi` helper, `REAPABLE_STATES`, `DEFAULT_AGE`, `STALE_MS`, `renderJanitor`, `USAGE`;
the reap stays the only mutation. Two sims stub the janitor's reads and are kept green as follows.
`fleet/tests/test_janitor_reap_only.mjs` (this task's to modify) pins the exact set of `gh` argvs
over a fleet of two `done` runs as one read per row at the branch path; re-key its canned `PAGES`
to the tag path (`evidenceTagFor`), so the janitor's one read per row is the tag read and the
exact-set pin, the two-argv-words pin and every other leg stand unchanged — change nothing else in
that file but the path helper and the assertion messages that spell it.
`fleet/tests/test_launch_reaps.mjs` (not this task's) cans its two pages at the branch path and
404s every other path, and asserts one `rm` for its old run — the tag-then-branch order keeps it
green without an edit, and it is a `Run:` below. The exam `fleet/tests/test_janitor.mjs` is
rewritten by the examiner in its BASE shape (`makeExec` with `passthrough: []`, `sshRule('ls ',
…)` answering `vmsPayload(rows)`, `sshRule('rm ', answer(''))`, a `cmdRule('gh', 'api', …)`
answering canned paths and `HTTP 404` for every other path, `exec.calls` read back): its BASE
legs pin the branch-only read (`contentsReads` equal to the branch paths, `?ref=ultra/evidence-run-9`
as the exact path) and must become the tag-first legs below; the header docstring's M1–M3 lines
are rewritten to match. The `stale` line at BASE is `stale <vm>  run=<N> state=<state or none>
last update <iso> (<from>) — look before you rm`; `from` was `planBranchFor(run)` or
`evidenceBranchFor(run)` and now names whichever ref answered. Update the module's header comment
so it describes the tag-first read and the plan-tag age.
**BASE facts:** (generated at f17b977)
- `updatedAt` at `fleet/janitor.mjs:175` blob 236dc2f
- `stale` at `fleet/doctor.mjs:258` blob 5e0d5c9
- `from` at `fleet/run-main.mjs:333` blob 8dcde61
- `renderJanitor` at `fleet/janitor.mjs:214` blob 236dc2f
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `fleet/tests/test_launch_reaps.mjs` blob 1031e90
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `fleet/janitor.mjs` blob 236dc2f
- `fleet/sandbox-boot.sh` blob d509807
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea
- `readEvidence` at `fleet/janitor.mjs:94` blob 236dc2f
- `planCommittedAt` at `fleet/janitor.mjs:107` blob 236dc2f
- `ghApi` at `fleet/janitor.mjs:83` blob 236dc2f
- `planTagFor` at `fleet/lobby.mjs:126` blob 62d348b
- `evidenceTagFor` at `fleet/lobby.mjs:127` blob 62d348b
- `planBranchFor` at `fleet/lobby.mjs:113` blob 62d348b
- `evidenceBranchFor` at `fleet/lobby.mjs:115` blob 62d348b
- `fleet/lobby.mjs` blob 62d348b
- `fleet/tests/test_janitor_reap_only.mjs` blob adc4ac2
- `PAGES` at `fleet/tests/test_janitor_reap_only.mjs:126` blob adc4ac2
- `fleet/tests/test_janitor.mjs` blob 7fa3cd3
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `contentsReads` at `fleet/tests/test_janitor.mjs:109` blob 7fa3cd3
- `running` at `fleet/tests/test_sandbox_boot_merge.mjs:137` blob bed2fad
- `actions` at `fleet/janitor.mjs:146` blob 236dc2f
- `unknown` at `fleet/janitor.mjs:148` blob 236dc2f
- `ls` at `fleet/tests/test_sandbox_boot_merge.mjs:508` blob bed2fad

**Proof:**
- Test: `fleet/tests/test_janitor.mjs`
- Legs: (a) over a fleet of nine rows whose pages are canned at the tag path only (`done`,
  `parked`, `failed` two hours old; `failed` thirty minutes old; `done` sixty-one and fifty-nine
  minutes old; `running` a minute old; `booting` and `publishing` three hours old): every row
  gets exactly one contents read, at `repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`,
  no `gh` path contains `ultra/evidence-run-`, and the mutating lobby verbs are exactly `rm <vm>
  --json` for the three two-hour-old rows and the sixty-one-minute `done` row; `--age 3h` over the
  same fleet removes nothing and still issues every tag read [M1]; (b) over the same nine rows
  with the pages canned at the branch path only: each row's contents reads are the tag path then
  the branch path in that order, the same four `rm`s fire, and a row whose comment says
  `target=other/repo` is read under `repos/other/repo/contents/.ultrapowers/runs/9/status.json`
  with `?ref=ultra/evidence/run-9` first and `?ref=ultra/evidence-run-9` second [M1]; (c) a page
  served bare instead of as the contents envelope, on either ref, removes nothing [M1]; (d) four
  page-less rows: run 21, whose `git/ref/tags/ultra/plan/run-21` answers `{ object: { sha } }` and
  whose `commits/<sha>` answers a committer date seven hours old, is `stale` with `from`
  `ultra/plan/run-21` and `lastUpdate` that date, and `branches/ultra/plan-run-21` is never read
  for it; run 24, the same with a date three hours old, is neither `stale` nor an action; run 25,
  whose tag ref answers 404 and whose `branches/ultra/plan-run-25` answers a committer date seven
  hours old, is `stale` with `from` `ultra/plan-run-25` and no `commits/` read; run 26, with the
  tag ref 404 and the branch date three hours old, is neither; and run 27, with every read 404,
  is in neither `stale` nor `actions` [M2, M3]; (e) a `running` row silent seven hours whose page
  was read from the tag is `stale` with `from` `ultra/evidence/run-<N>`; the same page canned at
  the branch path gives `from` `ultra/evidence-run-<N>`; each rendered line matches `^stale <vm>
  run=<N> state=running last update <iso> \(<from>\) — look before you rm$` with that `from`, the
  page-less stale line of the fourth leg matches the same shape with `state=none`, and a row
  updated a minute ago is not stale [M3]; (f) a row with no comment and a row whose comment carries no
  `target=` (`run=12 base=abc`) land in `unknown`, are printed as `unknown <vm>  no readable assignment — look
  before you rm`, and cause no `gh api` read naming run 12 or run 20; `--dry-run` over the fleet
  of the first leg issues the same `gh` paths and the same `ls` read, no `rm`, reports the four
  rows unapplied, and prints `would rm`; every `gh` call across every leg is two argv words
  beginning `api` and `repos/`; no leg issues a `git` command or an `ssh <ssh_dest>` command; and
  with `HOME` pointed at a directory holding `fleet.json` beside a canary `runs/3/status.json` that
  says run 3 finished a day ago, run 3 is not removed [M4].
- Run: node fleet/tests/test_janitor.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs the exam to its sentinel [M1, M2, M3, M4].
- Run: node fleet/tests/test_janitor_reap_only.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the reap-only sim, re-keyed to the tag path: one read per row, two argv
  words, no flag, one `rm` [M4].
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launcher's reap over pages canned at the branch path, untouched by
  this task: the branch fallback keeps it green [M1, M4].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launcher sim, which runs the janitor before its launch [M4].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
- path-absent: `fleet/tests/test_janitor_reap_only.mjs`
- issue-closed: #624

### Task 3: The contract and the runbook say what the boot and the janitor now do

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`

**Claim:** The contract says the PR body links the plan blob and the evidence tree by tag, the
runbook's per-run paragraph says N comes from the branches and the tags, and both documents say
the janitor reads a finished run's page at its tag first and at its branch only while the sweep
is pending. (derived)
Machine: M1. In `fleet/CONTRACT.md`'s boot-script bullet (the text from `- **Boot script` to
`- **status.json:**`), the sentence about the PR body says it links the plan blob at
`blob/ultra/plan/run-<N>/.ultrapowers/plan.md` and the evidence tree at
`tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/`, and no line of `fleet/CONTRACT.md` says the
body links a blob at `ultra/plan-run-<N>` or a tree at `ultra/evidence-run-<N>`. M2. In
`fleet/RUNBOOK.md`'s per-run paragraph (the text from `## Per run` to `**Watch.**`), the launcher
computes N from the target's `ultra/*-run-*` branches and its `ultra/{plan,evidence}/run-<N>`
tags. M3. `fleet/RUNBOOK.md`'s **Reap.** paragraph (the text from `**Reap.**` to `## States`) and
`fleet/CONTRACT.md`'s janitor bullet (the text from `- **Janitor` to `- **Laptop config`) each
say the janitor reads the run's status page at the evidence tag `ultra/evidence/run-<N>` first and
at the branch `ultra/evidence-run-<N>` only while the sweep is pending, and that a run with no
page is aged from the plan tag `ultra/plan/run-<N>` and then the plan branch; neither says the
janitor reads the branch and not the tag, and neither says a run whose branches are gone reads
as absent. M4. Sentences other exams pin survive verbatim: `fleet/RUNBOOK.md` carries `The
launcher runs it before every launch; nothing schedules it`, does not carry `arms auto-merge`,
and the word `cron` is in neither document; the contract's `  - record:` sub-bullet, its `**The
two tags` bullet and its `**Run id:**` bullet are unchanged from BASE; no `?ref=` in either
document names `ultra/evidence-run-`; and `fleet/retire.mjs` is named in `fleet/CONTRACT.md`
exactly once and in `fleet/RUNBOOK.md` not at all. M5. `python3 -m pytest
tests/test_docs_agree_with_code.py` passes on this tree, and so do the sims that pin these two
documents: `fleet/tests/test_janitor_reap_only.mjs`, `fleet/tests/test_sandbox_boot_merge.mjs`,
`fleet/tests/test_sandbox_boot_selfmerge.mjs`, `fleet/tests/test_sandbox_boot_approved.mjs` and
`fleet/tests/test_sandbox_boot_approval_evidence.mjs`.

**Authorized-by:** run-25's blocking completeness finding (`fleet/CONTRACT.md:158`, the PR-body sentence still in branch spellings); run-25's task 5 critic note (`fleet/RUNBOOK.md:152` computes N from branches only); #624 (decision c, 2026-09-05)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the boot's `render_card` writes the PR body's links as
`https://github.com/<owner>/<repo>/blob/ultra/plan/run-<N>/.ultrapowers/plan.md` and
`https://github.com/<owner>/<repo>/tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/`, and its
`record_tags` deletes `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` after both tags verify —
but `fleet/CONTRACT.md`'s boot-script bullet still reads "The body links the plan blob
(`.ultrapowers/plan.md` at `ultra/plan-run-<N>`) and the evidence tree (`.ultrapowers/runs/<N>/`
at `ultra/evidence-run-<N>`), so the PR is the whole index of the run" — a sentence contradicted
by the same file's `**The two tags` bullet seven lines earlier, and the contract is the stated
authority for every literal. Rewrite that one sentence to the tag paths as the boot spells them:
"The body links the plan blob (`blob/ultra/plan/run-<N>/.ultrapowers/plan.md`) and the evidence
tree (`tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/`), so the PR is the whole index of the
run." — the exam's grep wants the words "body links the plan blob", the blob path, "evidence
tree" and the tree path in that order.
`fleet/RUNBOOK.md`'s `## The shape` already says N comes from the `ultra/*-run-*` branches and the
`ultra/{plan,evidence}/run-<N>` tags; its `## Per run` paragraph ("The launcher, in this order:
… computes N from the target's `ultra/*-run-*` branches; refuses …") does not — say both there,
as `## The shape` does: "computes N from the target's `ultra/*-run-*` branches and its
`ultra/{plan,evidence}/run-<N>` tags", those words in that order. The janitor: another task of this plan changes `fleet/janitor.mjs` to
read `.ultrapowers/runs/<N>/status.json` at `?ref=ultra/evidence/run-<N>` first and at the branch
`ultra/evidence-run-<N>` only when the tag answers nothing (a run still in flight, or one whose
sweep is pending), to age a page-less run from the plan tag `ultra/plan/run-<N>`'s commit and
then from the plan branch, and to name the ref it read in its `stale` line. At BASE both documents
describe the defect instead: the contract's janitor bullet says "It reads the branch, not the
tag, so a run whose branches the record step has already deleted reads as absent to it until it
follows the tag; an absent page is never a reap", and the runbook's **Reap.** paragraph says "a
run whose evidence branch the sandbox has already replaced with its tag reads as absent to it —
an absent page is reported as stale, never reaped". Replace both with the tag-first description —
in each, the words in this order: the tag `ultra/evidence/run-<N>` is read first, the branch
`ultra/evidence-run-<N>` only while the run is in flight or its sweep is pending, and a run with
no page is aged from the plan tag `ultra/plan/run-<N>` and then the plan branch (the exam greps
for `ultra/evidence/run-<N>`, then "first", then `ultra/evidence-run-<N>`, then "only while", then
"sweep", then "pending", then `ultra/plan/run-<N>`, then `ultra/plan-run-<N>`, in that order
within the paragraph — so name the plan branch after the plan tag, as "and then the plan branch
`ultra/plan-run-<N>`");
keep the rest of each paragraph (the `ls`, the comment parse, the one-hour rule, the six-hour
stale line, no ssh, no `created_at`, no clone, merges nothing, run by the launcher before every
launch and by hand after a sleep). Spell the branch fallback in prose — "the branch
`ultra/evidence-run-<N>`" — never as a `?ref=ultra/evidence-run-<N>` recipe, because
`tests/test_docs_agree_with_code.py` fails on any `?ref=` in either document that names
`ultra/evidence-run-`. Sentences other sims pin by regex and that must survive verbatim: in
`fleet/RUNBOOK.md`, `The launcher runs it before every launch; nothing schedules it` (with the
next words on the same or the following line; `fleet/tests/test_janitor_reap_only.mjs` joins
line breaks and asserts the sentence, asserts `arms auto-merge` is absent, and asserts `cron` is
absent from the runbook); under `## Trust`, `a pull request whose merge waits on the target's own
checks, and `--hold` to keep a human at the merge button`, and `A ready PR merges itself: the
sandbox polls its head's check runs and squash-merges it once every check is green, unless the
launch said `--hold`` (`test_sandbox_boot_merge.mjs`, `test_sandbox_boot_selfmerge.mjs`, which
slice `## Trust` to `## Rollback`). In `fleet/CONTRACT.md`: the evidence bullet's opening
`ultra/evidence-run-<N>` — the run's record under `.ultrapowers/runs/<N>/`` and `plus
`approve-receipt.json` and `standing-approval.json`, present when the engine wrote them`
(`test_sandbox_boot_approval_evidence.mjs`); `unless the verdict is PASS or `approve-receipt.json`
is present beside the gate receipt` (`test_sandbox_boot_approved.mjs`); the merge sub-bullet's
`commits/<head>/check-runs` … `pulls/<n>/merge` … `hold=1` order and the Publish bullet's
`sandbox merges itself once its checks are green, unless the assignment carries `hold=1``
(`test_sandbox_boot_merge.mjs`); the `  - record:` sub-bullet, which run-25's docs task wrote on
one physical line so a `grep '^  - record:'` selects it whole — leave that line alone. Literals
`tests/test_docs_agree_with_code.py` reads out of the contract and must keep their shape:
`**VM name:** `fleet-r<N>-`, `systemctl --user start fleet-run@<N>.service`,
`/home/exedev/engines/<sha>`, the `- **The two tags` bullet naming both tags and both branches;
its `RETIRED` vocabulary (`sweep-branches`, `refs/fleet/`, `fleetRuns`, `github-token`, …) must
appear in neither document — say "sweep" or "retire", never `sweep-branches`. Do not name
`fleet/retire.mjs` in `fleet/RUNBOOK.md`: that test reads every `fleet/*.mjs` the runbook names
against the tree under test, and this task's clone has no such file; `fleet/CONTRACT.md` already
names the verb once and that test does not read the contract for scripts. Do not touch
`CLAUDE.md`, `README.md` or any skill document. Wrap prose at roughly 100 columns as the rest of
each file does.
**BASE facts:** (generated at f17b977)
- `fleet/CONTRACT.md` blob b8e36ad
- `fleet/RUNBOOK.md` blob c3dd45b
- `fleet/tests/test_janitor_reap_only.mjs` blob adc4ac2
- `fleet/tests/test_sandbox_boot_merge.mjs` blob bed2fad
- `fleet/tests/test_sandbox_boot_selfmerge.mjs` blob f06979f
- `fleet/tests/test_sandbox_boot_approved.mjs` blob 5a98524
- `fleet/tests/test_sandbox_boot_approval_evidence.mjs` blob be35f1c
- `fleet/CONTRACT.md:158` blob b8e36ad line 158 `The body links the plan blob (`.ultrapowers/plan.md` at `ult`
- `fleet/RUNBOOK.md:152` blob c3dd45b line 152 `reads the pool; computes N from the target's `ultra/*-run-*``
- `fleet/janitor.mjs` blob 236dc2f
- `stale` at `fleet/doctor.mjs:258` blob 5e0d5c9
- `ls` at `fleet/tests/test_sandbox_boot_merge.mjs:508` blob bed2fad
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `CLAUDE.md` blob ff1281b
- `README.md` blob b218e1f

**Proof:**
- Run: sed -n '/^- \*\*Boot script/,/^- \*\*status.json:\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'body links the plan blob.*blob/ultra/plan/run-<N>/.ultrapowers/plan.md.*evidence tree.*tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/'
- The previous bullet is the contract's PR-body sentence in tag spellings, in order [M1].
- Run: ! tr '\n' ' ' < fleet/CONTRACT.md | grep -q 'plan blob.\{0,120\}ultra/plan-run-<N>' && ! tr '\n' ' ' < fleet/CONTRACT.md | grep -q 'evidence tree.\{0,120\}ultra/evidence-run-<N>' && test "$(tr '\n' ' ' < fleet/CONTRACT.md | grep -o 'plan blob' | wc -l | tr -d ' ')" = 1
- The previous bullet is what is absent, over the file with its line breaks joined so wrapping
  cannot hide it: no `ultra/plan-run-<N>` within 120 characters after the words "plan blob", no
  `ultra/evidence-run-<N>` within 120 characters after "evidence tree", and "plan blob" occurs in
  the contract exactly once — the sentence the first bullet matched [M1].
- Run: sed -n '/^## Per run/,/^\*\*Watch\.\*\*/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'computes N from the target.s .ultra/\*-run-\*. branches and its .ultra/{plan,evidence}/run-<N>. tags'
- The previous bullet is the per-run paragraph naming branches and tags for N [M2].
- Run: sed -n '/^\*\*Reap\.\*\*/,/^## States/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'ultra/evidence/run-<N>.*first.*ultra/evidence-run-<N>.*only while.*sweep.*pending.*ultra/plan/run-<N>.*ultra/plan-run-<N>'
- The previous bullet is the runbook's reap paragraph: tag first, branch only while the sweep
  is pending, plan tag for the age [M3].
- Run: sed -n '/^- \*\*Janitor/,/^- \*\*Laptop config/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'ultra/evidence/run-<N>.*first.*ultra/evidence-run-<N>.*only while.*sweep.*pending.*ultra/plan/run-<N>.*ultra/plan-run-<N>'
- The previous bullet is the contract's janitor bullet saying the same [M3].
- Run: ! grep -q 'reads the branch, not the tag' fleet/CONTRACT.md && ! grep -q 'reads the branch, not the tag' fleet/RUNBOOK.md && ! grep -q 'not the tag' fleet/CONTRACT.md && ! grep -q 'not the tag' fleet/RUNBOOK.md && ! grep -q 'reads as absent' fleet/CONTRACT.md && ! grep -q 'reads as absent' fleet/RUNBOOK.md
- The previous bullet is what is absent, in each document: neither says the janitor reads the
  branch and not the tag, and neither says a run reads as absent [M3].
- Run: tr '\n' ' ' < fleet/RUNBOOK.md | grep -q 'The launcher runs it before every launch; nothing schedules it' && ! grep -q 'arms auto-merge' fleet/RUNBOOK.md && ! grep -qi 'cron' fleet/RUNBOOK.md && ! grep -qi 'cron' fleet/CONTRACT.md
- The previous bullet is the reap-only sim's sentence pins, kept [M4].
- Run: test "$(grep -c '^  - record:' fleet/CONTRACT.md)" = 1 && test "$(grep '^  - record:' fleet/CONTRACT.md | git hash-object --stdin)" = 725eed75fc32ede3a13ee54f4e8fd7f23361c9bd && test "$(sed -n '/^- \*\*The two tags/,/^- \*\*Comment/p' fleet/CONTRACT.md | git hash-object --stdin)" = 9e48fc537b1410ae1543608328466b69b96bab06 && test "$(sed -n '/^- \*\*Run id:\*\*/,/^- \*\*VM name:\*\*/p' fleet/CONTRACT.md | git hash-object --stdin)" = 70f51efb8ddaeae10d80c4ccdd27954437e9e237
- The previous bullet compares three slices of the contract — the record sub-bullet, the
  two-tags bullet and the run-id bullet — against their frozen BASE hashes, taken on `f17b977`
  with the same `sed` and `git hash-object --stdin`: each slice is byte-identical to BASE [M4].
- Run: ! grep -q '?ref=ultra/evidence-run-' fleet/RUNBOOK.md fleet/CONTRACT.md && test "$(grep -c 'fleet/retire.mjs' fleet/CONTRACT.md)" = 1 && ! grep -q 'retire.mjs' fleet/RUNBOOK.md
- The previous bullet is the ref-recipe pin and the script-name count [M4].
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider
- The previous bullet is the docs-agree suite on this tree, its own exit status the evidence — a
  single failed test fails the bullet [M5].
- Run: node fleet/tests/test_janitor_reap_only.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet runs each of the five sims that pin sentences of these two documents to
  its sentinel, one row per sim, chained so any one failing fails the bullet [M5].

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`
- path-absent: `fleet/RUNBOOK.md`
- path-absent: `tests/test_docs_agree_with_code.py`
- issue-closed: #624

### Task 4: The boot script's banner says the branches are transient

**Type:** implementation

**Files:**
- Modify: `fleet/sandbox-boot.sh`

**Claim:** The comment at the top of `fleet/sandbox-boot.sh` says the plan and evidence branches
are deleted at publish once the two tags verify, instead of presenting the three branches as
what a run leaves behind. (derived)
Machine: M1. The header banner — every line before `set -euo pipefail` — names, in this order,
the tags `ultra/plan/run-<N>` and `ultra/evidence/run-<N>` and says the branches
`ultra/plan-run-<N>` and `ultra/evidence-run-<N>` are deleted at publish after the two tags
verify against the remote, and it no longer describes the evidence branch as never merged and
linked from the PR body. M2. Every line of the banner after the shebang is a comment line
beginning `#`, and everything from `set -euo pipefail` to the end of the file is byte-identical
to BASE: that tail hashes to `2443a80de700904c5fe891b0853b8c5a87099af1` under `git hash-object
--stdin`. M3. `bash -n fleet/sandbox-boot.sh` exits 0.

**Authorized-by:** run-25's task 4 review finding (the header banner, BASE lines 30–37, still presents the three branches as the run's durable artifacts); #624 (decision c, 2026-09-05)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the banner's paragraph beginning `# THREE BRANCHES, all on the TARGET
repository and none of them anywhere else` says `ultra/evidence-run-<N>` is "this script's — one
commit per transition, parented on the plan commit, never merged, linked from the PR body" —
written before the record step existed. Since run-25 the same file's `record_tags` (after the
last evidence push of a `done` or `parked` run) tags the plan commit `ultra/plan/run-<N>` and the
evidence head `ultra/evidence/run-<N>`, verifies both with `git ls-remote --tags` against the
remote, and deletes `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in one push; a run that
ends `failed`, or whose tags do not verify, keeps both branches for the one-time sweep; the PR
body links the plan blob and the evidence tree by tag. Rewrite that paragraph so it says the
branches are where the run works and the two tags are what it leaves, with the deletion after
the tags verify — keep it a comment, keep the paragraph's place among the banner's paragraphs,
and change nothing at or below `set -euo pipefail`: not a function body, not a variable, not a
blank line. The hash in M2 was taken on BASE (`f17b977`, the head of PR #693) as `sed -n
'/^set -euo pipefail/,$p' fleet/sandbox-boot.sh | git hash-object --stdin`, so the exam's
comparison measures the tail against the pre-edit bytes, not against HEAD. The sims under
`fleet/tests/test_sandbox_boot*.mjs` drive the script's behaviour and read none of its comments.
**BASE facts:** (generated at f17b977)
- `fleet/sandbox-boot.sh` blob d509807
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `failed` at `fleet/run-engine.mjs:767` blob ab943ea

**Proof:**
- Run: sed -n '1,/^set -euo pipefail/p' fleet/sandbox-boot.sh | tr '\n' ' ' | grep -q 'ultra/plan/run-<N>.*ultra/evidence/run-<N>.*ultra/plan-run-<N>.*ultra/evidence-run-<N>.*deleted at publish.*verif'
- The previous bullet is the banner naming both tags, then both branches as deleted at publish
  after they verify, in that order [M1].
- Run: ! sed -n '1,/^set -euo pipefail/p' fleet/sandbox-boot.sh | tr '\n' ' ' | grep -q 'never merged, linked from the PR'
- The previous bullet is what is absent: the old durable-evidence-branch wording [M1].
- Run: test "$(sed -n '2,/^set -euo pipefail/p' fleet/sandbox-boot.sh | sed '$d' | grep -vc '^#')" = 0
- The previous bullet is every banner line after the shebang being a comment [M2].
- Run: test "$(sed -n '/^set -euo pipefail/,$p' fleet/sandbox-boot.sh | git hash-object --stdin)" = 2443a80de700904c5fe891b0853b8c5a87099af1
- The previous bullet is the tail of the file, from `set -euo pipefail` to its end, hashing to
  the frozen BASE value — any edit to a function body fails it [M2].
- Run: bash -n fleet/sandbox-boot.sh
- The previous bullet is the script still parsing [M3].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- issue-closed: #624
