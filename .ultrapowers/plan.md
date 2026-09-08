# The launcher refuses on the laptop what the sandbox would refuse in a VM, and reserves N by the push

**Grammar:** claims-v1

**Claim:** A hash pin is a fact about BASE, and BASE is chosen at launch, not at authoring — so `launch.mjs` verifies every `git hash-object <path>` literal in the plan's `## Global Constraints` (and any `Run:`/`Check:` line of the same shape) against the tree at `--base` before it pushes `ultra/plan-run-<N>`, and refuses in seconds on the laptop with the path, the pinned sha and the real one printed. (quoted from #699)

**Goal:** #699 #684 #716 #790 — four launcher tickets on one seam, `fleet/launch.mjs`. At BASE
`1c97ba44` (0.3.21) the launcher pushes the plan without reading it: run-20 died in the sandbox
on a `git hash-object` pin copied three releases stale (#699); a plan push refused because
another launch took N a moment earlier is a failure rather than a retry, so launches from two
sessions cannot overlap (#684); a target with no detectable test command, and a plan whose
`**Exam command:**` line is written in backticks, each cost a VM before the sandbox's
`ultra_run.py` said why — #716, narrowed by its 2026-09-08 comment to those two stages now
that #712/#770 retired the red-baseline stage; and `fleet/RUNBOOK.md` says a parked page is
final without saying how the parked work lands, while the launcher rightly refuses a parked
branch as `--base` (#790). Five tasks, one wave: four of them give `fleet/launch.mjs` one new
region each and one exam file each; the fifth is prose with a `Run:` proof.
**Closes:** #699 #684 #716 #790

**Tech Stack:** Node 22 ESM (`fleet/launch.mjs` over its `exec` seam; sims under
`fleet/tests/test_launch*.mjs` run git for real against a bare origin the exam makes, stub the
lobby by rule, and print `ALL TESTS PASSED`), Python 3 (`skills/ultrapowers/scripts/compile_plan.py`,
pytest under `tests/`). The suite is `python3 -m pytest` from the repo root; it bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (glob `fleet/tests/test_*.mjs`, so a
new sim joins it by existing).

**Parallelization rationale:** one wave, width 5. No task consumes a symbol another produces;
the four launcher tasks each add their own function at their own place in `fleet/launch.mjs`
(named in each Context) and their own exam file, so the fold has four non-adjacent hunks and
no adjacent insert. Task 3 alone edits the five existing launch sims (their seeds), and the
one coordination fact — every launch sim's seed carries `pytest.ini` from now on — is a
literal in every Context, not an edge. Task 5 is a document with a `Run:` proof and touches
no code.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- fleet/lobby.mjs fleet/run-main.mjs skills/ultrapowers/scripts/ultra_run.py`
- The verification periphery is frozen (0.1.0) and the first Check is its pin; the second
  keeps this run off the three files it mirrors rather than edits — `highestRunOnTarget`,
  `detect_test_cmd` and the sandbox's preflight stay exactly as at BASE, and the launcher
  copies their rules rather than importing them.
- Every refusal a task adds to `fleet/launch.mjs` is a `Refusal` (exit 2) raised before any
  lobby verb is issued and before any `git push`, and its message begins `launch: `. `USAGE`
  gains no flag: the launch line the operator documents is unchanged, and
  `tests/test_docs_agree_with_code.py` is the lens for that.
- Where the sandbox already has words for a refusal, the launcher quotes them and does not
  paraphrase: the `ultra_run.py` `test-command` stage's failure line and
  `compile_plan.py`'s backtick note are copied verbatim into the launcher's messages.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The plan's hash pins are verified at --base before the push

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch_pins.mjs`

**Claim:** A hash pin is a fact about BASE, and BASE is chosen at launch, not at authoring — so `launch.mjs` verifies every `git hash-object <path>` literal in the plan's `## Global Constraints` (and any `Run:`/`Check:` line of the same shape) against the tree at `--base` before it pushes `ultra/plan-run-<N>`, and refuses in seconds on the laptop with the path, the pinned sha and the real one printed. `--stdin` slice pins (`sed … | git hash-object --stdin`) are run the same way in a temporary checkout of the base. (quoted from #699)
Machine: M1. `launch` reads every line of the plan text whose stripped form begins `- Check:` or `- Run:` — wherever in the plan it sits — and collects from those lines every pin of the path shape `test "$(git hash-object <path>)" = <40-hex>` and every pin of the slice shape `test "$(<command> | git hash-object --stdin)" = <40-hex>`; a pin written on any other kind of line is not a pin.
M2. For a path pin the real sha is the blob the tree at `--base` carries at `<path>` (`git rev-parse <base>:<path>` in the `--repo` checkout); a pin whose real sha differs from its pinned sha, and a pin whose path is absent at `--base`, each make the launch a `Refusal` (exit 2) whose message carries, for every stale pin and on one line per pin, the path, the pinned sha and the real sha — or `no such path` where the path is absent — so two stale pins are two lines.
M3. For a slice pin `<command>` runs under `/bin/sh -c` with its working directory a temporary directory holding the tree at `--base` (prefix `fleet-pin-` under the OS temp dir), its stdout is hashed with `git hash-object --stdin`, and a differing result is the same refusal with the command (whitespace-collapsed, clipped to 80 characters) in place of the path; the temporary directory is removed before `launch` returns or throws, and the checkout's `HEAD`, index and working tree are as they were.
M4. The refusal is raised after `--base` is verified present in the checkout and before any `ssh` command and before any `git push`, so no `ultra/` ref reaches the origin and no lobby verb is issued; a plan whose pins all match, and a plan carrying no pin, launch exactly as at BASE.

**Authorized-by:** #699 (its 2026-09-05 reading: "adopted — forbid pins + preflight", edit (1)); `fleet/CONTRACT.md` §Literals *Launch order*.

**Interfaces:**
- Consumes: nothing
- Produces: `verifyPlanPins({ exec, repoDir, base, planText }) -> Promise<void>`

**Context:** The shared literal of this plan's four launcher tasks: every refusal is
`throw new Refusal('launch: …')` — `Refusal` from `./lobby.mjs`, `exitCode` 2 — raised before
any `ssh` and before any `git push`; and every launch sim seeds its target with
`'pytest.ini': '[pytest]\n'` beside `README.md`, because a sibling task of this wave makes a
launch refuse when the tree at `--base` has no detectable test command (the seed at BASE,
`SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }`, has none).
Put `verifyPlanPins` in `fleet/launch.mjs` directly below `targetOfOriginUrl` and above
`defaultEngineSha`; call it in `launch` directly after the `baseCheck` refusal (the
`rev-parse --verify <base>^{commit}` read) and before `readDefaultBranch`, which is the first
`ls-remote` — so a stale pin is found with nothing but local git reads made. The other three
launcher tasks add their functions elsewhere in the file (below `SHALLOW_FIX`, below
`readDefaultBranch`, below `commitPlan`); keep to this region so the fold sees four separate
hunks.
The pin shapes at BASE, as plans write them (`skills/ultrawrite/SKILL.md` §Global Constraints
discipline calls the path shape "the shape for a single file"): a Global Constraints bullet
`- Check: test "$(git hash-object <path>)" = <40-hex>` and, in a task's Proof, a bullet
`- Run: test "$(sed -n '/^set -euo pipefail/,$p' fleet/sandbox-boot.sh | git hash-object --stdin)" = <40-hex>`;
a `Run:` may chain several such tests with `&&`, so one line can carry several pins, and
`compile_plan.py`'s `_claims_run_command` strips a whole-value backtick wrapper off a
`Run:`/`Check:` value — strip the same wrapper before matching. A pin whose path is absent at
`--base` is a stale pin, not a skipped one: `git rev-parse <base>:<path>` exits non-zero and
the line says `no such path`. The refusal line format, one per stale pin:
`launch: plan pin <path or clipped command>: pinned <pinned> but --base <base> has <real | no such path>`.
The blob id `git rev-parse <base>:<path>` answers is what `git hash-object <path>` answers in a
checkout of `<base>` (no clean filter is configured in this repository or in the sims). For
the slice shape a checkout is needed because the command reads files by path: extract the
tree at `--base` into the temporary directory with git reads only (`git archive <base> | tar
-x`, or a detached `git worktree add` that is removed in a `finally`) — never a `checkout`
of the operator's clone — and remove the directory in a `finally` so a refusal leaves
nothing behind. `$ULTRA_BASE` is the driver's, set in the environment of every `Check:` and
`Run:` on the sandbox, and nothing here reads or sets it. The launcher at BASE prints, for a
`--base` off the default branch, `launch: --base <sha> is not on <target>'s <branch> (tip
<tip>) — relaunch from main; a parked branch is re-driven as a plan on main, not as a base`
(`BASE_OFF_MAIN_FIX`, `fleet/launch.mjs` line 144); keep that text and that check where they
are. The exam builds its own bare origin with `makeTargetRepo` from
`fleet/tests/_lobby_helpers.mjs` and drives `launch` the way `fleet/tests/test_launch.mjs`
does (`makeExec` with `readRules`-shaped rules, git passing through for real, `localRemote`
pointing `origin` at the bare path); copy that scaffolding into the new file rather than
importing test_launch.mjs, which exports nothing. Sims run under
`tests/test_fleet_suite.py` with no network and a PATH shim for `ssh`/`gh`/`curl`; `git`,
`tar` and `/bin/sh` are real.

**Proof:**
- Test: `fleet/tests/test_launch_pins.mjs`
- Legs: (a) a plan whose `## Global Constraints` carries `- Check: test "$(git hash-object README.md)" = <the seed's real blob>` and whose one task's Proof carries `- Run: test "$(git hash-object src/app.js)" = 0000000000000000000000000000000000000000` is a `Refusal` with `exitCode` 2 whose message contains `src/app.js`, the forty zeros and the real blob of `src/app.js` at base, and does not contain `README.md` [M1] [M2]; (b) a pin on `missing.txt` (absent at base) refuses with `missing.txt`, its pinned sha and `no such path` in the message, and two stale pins on two paths refuse with both paths in the message [M2]; (c) a slice pin `- Run: test "$(sed -n '1p' README.md | git hash-object --stdin)" = <the sha the exam computes for the first line of README.md>` launches (`result.run` is 1, one `new`), the same pin with forty zeros refuses with the command text, the zeros and the computed sha in the message, and after each of the two launches no directory named `fleet-pin-*` remains under the OS temp dir, `git status --porcelain` in the checkout is empty, `git rev-parse HEAD` is unchanged and `git worktree list` has one line [M3]; (d) in every refusing case of the previous three legs `exec.calls` has no `ssh` command and no git `push`, `exec.mutating()` is `[]`, and the origin's `refs/heads/` carries no `ultra/` ref [M4]; (e) the BASE plan text with no pin launches, and a plan whose only stale pin sits on a `**Context:**` line of a task (not a `- Check:`/`- Run:` line) also launches — the pin is not read — with `result.run` 1 and one `new` line in each; and a `- Check:` whose sha is 39 hex characters, and one whose sha is 41, are not pins either: both launch [M1] [M4].

**Stale-if:**
- issue-closed: #699
- path-absent: `fleet/launch.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`

### Task 2: A refused plan push re-reads the highest run and takes N+1

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_launch_run_number.mjs`

**Claim:** `node fleet/launch.mjs` reserves N by the push itself: on a refused plan push (ref already exists / non-fast-forward) it re-reads the highest run on the target, takes N+1 and pushes again, up to a small bounded number of tries, then refuses with the refusal text. Two launches started in the same second on one target both succeed with distinct N. (quoted from #684)
Machine: M1. When `--run` was not given and the plan push exits non-zero, `launch` re-reads the highest run on the target with the same read `highestRunOnTarget` makes (`git ls-remote origin refs/heads/ultra/* refs/tags/ultra/*`), and when that reading is at least the N just tried it takes reading+1, builds a fresh plan commit for that N (subject `ultrapowers plan run-<N>`, parent `--base`) and pushes it to `ultra/plan-run-<N>`.
M2. A launch makes at most `PUSH_ATTEMPTS` (an exported constant, 3) plan pushes; when the last is refused, `launch` throws a `Refusal` (exit 2) whose message carries the last push's own output and the number 3, and no `new` is issued.
M3. A refused push whose re-read is below the N tried (no ref appeared: the refusal was not a race) is the BASE refusal after exactly one push and exactly one re-read, which is not acted on; a refused push under `--run <N>` is the BASE refusal after exactly one push and no re-read at all — in neither case is a second push made.
M4. When a retried push succeeds, the run number, the comment's `run=` and `plan=`, the VM name, `planBranch`, `runId` and the setup script on `new`'s stdin are all for the N that was pushed, and the origin's `ultra/plan-run-<N>` is `result.plan`.
M5. `fleet/CONTRACT.md`'s `**Run id:**` bullet says that a refused plan push re-reads the highest run and retries, up to three pushes, so the push is what reserves N.

**Authorized-by:** #684 (grilling #667 (b), 2026-09-05); #624 / R1 — `highestRunOnTarget` reads tags as well as branches.

**Interfaces:**
- Consumes: nothing
- Produces: `PUSH_ATTEMPTS`

**Context:** The shared literal of this plan's four launcher tasks: every refusal is
`throw new Refusal('launch: …')` — `Refusal` from `./lobby.mjs`, `exitCode` 2; and every
launch sim seeds its target with `'pytest.ini': '[pytest]\n'` beside `README.md`, because a
sibling task of this wave makes a launch refuse when the tree at `--base` has no detectable
test command (the BASE seed has none). At BASE the push is one block in `launch`
(`fleet/launch.mjs` lines 480–491): `commitPlan(...)`, then
`git -C <repo> push origin <planSha>:refs/heads/<planBranch>`, and a non-zero exit is
`throw new Refusal('launch: git push origin <planSha>:refs/heads/<planBranch> failed (exit
<code>):\n<output>')`. Replace that block with a call to a new `pushPlan` defined directly
below `commitPlan` (and above the `engineLine` comment) — that is this task's region; the
other three launcher tasks add theirs below `SHALLOW_FIX`, below `targetOfOriginUrl` and
below `readDefaultBranch`. Keep the BASE refusal text as the final refusal, with
` after 3 tries` after `failed` — e.g. `launch: git push origin <sha>:refs/heads/<branch>
failed after 3 tries (exit <code>):\n<output>` — and the BASE text unchanged when there was
one push. `highestRunOnTarget(exec, repoDir)` in `fleet/lobby.mjs` (line 487) is the read to
reuse; since #624 it reads `refs/heads/ultra/*` and `refs/tags/ultra/*` in one `ls-remote`
and `runOfBranch` reads both the branch shape `ultra/plan-run-<N>` and the tag shapes
`ultra/plan/run-<N>` / `ultra/evidence/run-<N>` (`fleet/tests/test_lobby.mjs` task-5 leg (b)
pins that), so the re-read sees a competitor's plan branch the moment it exists.
`commitPlan` writes the subject `ultrapowers plan run-<N>`, so the retried N needs a fresh
commit — re-run `commitPlan` per attempt rather than re-pushing the old sha under a new
name. Decide a race by the re-read, not by parsing git's words: a refusal whose re-read is
still below N is not another launch's, and is refused at once with the push's output. The
competitor in the exam has to be a SIBLING commit on base (a second `commit-tree` of base's
tree with `-p <base>` and a different message), never `<base>` itself — pushing a descendant
of base onto a ref that holds base is a fast-forward and is accepted. The exam is built like
`fleet/tests/test_launch.mjs` (copy its scaffolding: `makeTargetRepo`, `makeExec` with
`readRules`-shaped rules, `localRemote` pointing `origin` at the bare path, git for real);
its competitor rule matches the launcher's `git push` first — before `localRemote` — and
does, in order: push the sibling to `refs/heads/ultra/plan-run-<N tried>` in the bare origin
with a real `git push`, then run the launcher's own push for real through `defaultExec` with
`pointAtOrigin`; the `N tried` is read off the argv's `refs/heads/ultra/plan-run-<N>`. The
setup script for run N is `renderSetupScript({ run: String(N), ...readFleetFiles() })` from
`./setup-script.mjs`. The `**Run id:**` bullet of `fleet/CONTRACT.md` reads at BASE:
`N = 1 + max N over the target's … branches and over its … tags — the branches are transient
and the tags are the record, so a run number is read from both shapes and never from one
(--run N overrides). RUN_ID=run-N.` — add one sentence to that bullet, nowhere else, and keep
its opening `- **Run id:**` and the next bullet's `- **VM name:**` as they are
(`tests/test_docs_agree_with_code.py` reads the contract's `**VM name:**` line).

**Proof:**
- Test: `fleet/tests/test_launch_run_number.mjs`
- Run: sed -n '/^- \*\*Run id:\*\*/,/^- \*\*VM name:\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'refused.*re-reads.*three pushes'
- Legs: (a) with the competitor rule firing on the first push only, the launch succeeds: `result.run` is 2, `result.comment` starts `run=2 plan=<result.plan>`, `result.vm` starts `fleet-r2-`, `result.planBranch` is `ultra/plan-run-2`, the origin's `ultra/plan-run-2` is `result.plan` with subject `ultrapowers plan run-2` and `ultra/plan-run-1` is still the sibling, the `new` call's stdin equals the rendered setup script for run 2, exactly two `git push` calls and two `ls-remote … refs/heads/ultra/*` reads were made and the second read sits after the first push in `exec.calls` [M1] [M4]; (b) with the competitor rule firing on every push, the launch is a `Refusal` with `exitCode` 2 whose message contains `3` and the last push's rejection output (`rejected`), exactly three `git push` calls were made, no `new` line was issued, `exec.mutating()` is `[]`, and the origin's `ultra/plan-run-1`, `-2` and `-3` are each the sibling (a tree without `.ultrapowers/plan.md`) [M2]; (c) a rule that answers the push with exit 1 and stderr `! [remote rejected] … (pre-receive hook declined)` and touches the origin nothing refuses after exactly one push, with that stderr in the message and the BASE text (`failed (exit`, no `after`), with exactly one `ls-remote … refs/heads/ultra/*` read after the push in `exec.calls` and no second push; and `--run 5` with the competitor rule refuses after exactly one push with the BASE text, with no `ls-remote … refs/heads/ultra/*` read at all in `exec.calls`, `ultra/plan-run-5` on the origin being the sibling [M3]; (d) the `Run:` above exits 0: the `**Run id:**` bullet says a refused push re-reads and retries up to three pushes [M5].

**Stale-if:**
- issue-closed: #684
- path-absent: `fleet/launch.mjs`
- path-absent: `fleet/CONTRACT.md`

### Task 3: A target with no detectable test command is refused on the laptop

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/tests/test_launch.mjs`
- Modify: `fleet/tests/test_launch_hold.mjs`
- Modify: `fleet/tests/test_launch_effort.mjs`
- Modify: `fleet/tests/test_launch_engine_source.mjs`
- Modify: `fleet/tests/test_launch_reaps.mjs`
- Test: `fleet/tests/test_launch_test_command.mjs`

**Claim:** The target's test command is, like a hash pin, a fact about BASE the laptop can read: a launch whose tree at `--base` matches no rung of the sandbox's test-command ladder is refused on the laptop, in the sandbox's own words, before any VM exists — and a launch the sandbox would have run goes through as before. (derived)
Machine: M1. After the `--base` ancestry check and before the `integrations list` read, `launch` reads the tree at `--base` — never the working tree — down the sandbox's ladder, and a tree is detectable when it matches at least one rung: `pytest.ini` present; `pyproject.toml` present and containing `[tool.pytest`; `package.json` present, parseable as JSON, with a `scripts.test` key; `package.json` present with `bun.lock` or `bun.lockb` beside it; `Makefile` present with a line matching `^test\s*:`; `go.mod` present; `Cargo.toml` present.
M2. A tree matching no rung is a `Refusal` (exit 2) whose message contains the target, the `--base` sha, the sandbox's own line `no test command detected — pass --test-cmd <run-wide suite command>; the gate refuses to run without one`, and the word `pytest.ini`.
M3. That refusal is raised before any `ssh` command and before any `git push`, so no `new` is issued and no `ultra/` ref reaches the origin; a tree matching a rung launches as at BASE; and the read is of `--base`'s tree: an untracked `pytest.ini` in the working tree of a base without one still refuses, and a base with `pytest.ini` whose working tree has deleted it still launches.
M4. The five launch sims at BASE seed their targets with `pytest.ini`, so with the refusal in place `fleet/tests/test_launch.mjs`, `fleet/tests/test_launch_hold.mjs`, `fleet/tests/test_launch_effort.mjs`, `fleet/tests/test_launch_engine_source.mjs` and `fleet/tests/test_launch_reaps.mjs` print `ALL TESTS PASSED`, sim by sim.

**Authorized-by:** #716, narrowed by its 2026-09-08 comment ("What remains of this ticket: test-command detection and the backticked-Exam check on the laptop"); the plan-level Claim (#699) for the shape "a fact about BASE, verified on the laptop".

**Interfaces:**
- Consumes: nothing
- Produces: `detectTestCommand({ exec, repoDir, base }) -> Promise<{ rule: string } | null>`

**Context:** The shared literal of this plan's four launcher tasks: every refusal is
`throw new Refusal('launch: …')` — `Refusal` from `./lobby.mjs`, `exitCode` 2; and every
launch sim seeds its target with `'pytest.ini': '[pytest]\n'` beside `README.md` — this task
is the one that writes that seed into the five existing sims (`test_launch.mjs` line 97
`SEED`, `test_launch_reaps.mjs` line 61, `test_launch_engine_source.mjs` line 74, and the
inline `files: { 'README.md': '# target\n' }` of `test_launch_hold.mjs` line 107 and
`test_launch_effort.mjs` line 109); the three new sims of this wave seed it themselves.
Put `detectTestCommand` in `fleet/launch.mjs` directly below `readDefaultBranch` and above
`commitPlan`, and call it in `launch` directly after the `ancestry` refusal
(`merge-base --is-ancestor`) and before `githubName` — the other launcher tasks add theirs
below `SHALLOW_FIX`, below `targetOfOriginUrl` and below `commitPlan`. Read the tree at
`--base` with git reads only — `git -C <repo> cat-file -e <base>:<path>` for presence and
`git -C <repo> show <base>:<path>` for content — never `fs` on the working tree. The ladder
this mirrors is `detect_test_cmd` in `skills/ultrapowers/scripts/ultra_run.py` (lines 55–90
at BASE), which the sandbox runs from `fleet/run-main.mjs`'s preflight; its rungs in order,
verbatim: `pytest.ini` is a file → `pytest-ini`; `pyproject.toml` is a file and its text
contains `[tool.pytest` → `pyproject-pytest`; `package.json` is a file whose JSON `scripts`
has `test` → `package-json-pnpm` if `pnpm-lock.yaml` exists, else `package-json-bun` if
`bun.lock` or `bun.lockb` exists, else `package-json-npm`; `package.json` is a file (no
`test` script) and `bun.lock` or `bun.lockb` exists → `bun-lockfile`; `Makefile` is a file
with a line matching `^test\s*:` (multiline) → `makefile-test`; `go.mod` is a file →
`go-mod`; `Cargo.toml` is a file → `cargo-toml`; else `(None, None)`. A `package.json` that
does not parse counts as having no scripts. `bun.lock` without `package.json` is NOT a rung.
The launcher needs only whether a rung matches (`rule` is for the message); it never runs
pytest, never asks about xdist, and never spawns python. The sandbox's wording, from
`ultra_run.py` line 599 at BASE, verbatim: `no test command detected — pass --test-cmd
<run-wide suite command>; the gate refuses to run without one`. The launch line has no
`--test-cmd` and the assignment comment has no key for one (`COMMENT_KEYS` in
`fleet/lobby.mjs` refuses unknown keys), so the refusal quotes that line and then says what
the laptop can say: `launch: <target> at --base <sha>: <the sandbox line> — the launch line
carries no --test-cmd; commit one of pytest.ini, pyproject.toml [tool.pytest], package.json
scripts.test (or a bun lockfile beside it), Makefile test:, go.mod or Cargo.toml on the
target's default branch`. The launcher at BASE prints, for a `--base` off the default branch,
`launch: --base <sha> is not on <target>'s <branch> (tip <tip>) — relaunch from main; a
parked branch is re-driven as a plan on main, not as a base` (`BASE_OFF_MAIN_FIX`, line
144); keep that text and that check where they are, and put this one after it.
`$ULTRA_BASE` is the driver's on the sandbox and nothing here reads it. The exam is built
like `fleet/tests/test_launch.mjs` (copy its scaffolding: `makeTargetRepo` with `files`,
`makeExec` with `readRules`-shaped rules, `localRemote`, git for real); a seed per rung is one
`makeTargetRepo({ files })`. The cross-check leg spawns the real ladder from the repo root:
`python3 -c 'import sys; sys.path.insert(0, "skills/ultrapowers/scripts"); from ultra_run import detect_test_cmd; print(detect_test_cmd(sys.argv[1])[1])' <clone dir>`
prints the rule name or `None`; `python3` is real under the suite bridge (the PATH shim stubs
only `ssh`, `gh`, `curl`, `systemd-run`, `systemctl`). `tests/test_ultra_run.py`
(`test_detect_test_cmd_ladder` and the bun rungs) pins the Python ladder itself and is
untouched. Do not add a result key or a rendered line: `test_launch.mjs` leg (c) [M3 lines]
pins `renderLaunch`'s six lines and leg (e) [M5] the result's keys.

**Proof:**
- Test: `fleet/tests/test_launch_test_command.mjs`
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_hold.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_effort.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_engine_source.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) for each of the seven rungs — `pytest.ini`; `pyproject.toml` with `[tool.pytest]`; `package.json` with `"scripts": {"test": "x"}`; `package.json` without scripts plus `bun.lockb`; `Makefile` with a `test:` line; `go.mod`; `Cargo.toml` — a target seeded with that file beside `README.md` launches with `result.run` 1 and one `new` line [M1] [M3]; (b) for each of five trees — `README.md` alone; `pyproject.toml` with `[tool.black]` only; `package.json` with `"scripts": {"build": "x"}` and no lockfile; `bun.lock` with no `package.json`; `Makefile` with only a `build:` line — the launch is a `Refusal` with `exitCode` 2 whose message contains the target, the base sha, the sandbox's line `no test command detected — pass --test-cmd <run-wide suite command>; the gate refuses to run without one` and `pytest.ini` [M1] [M2]; (c) in each refusing case of the previous leg `exec.calls` has no `ssh` command and no git `push`, `exec.mutating()` is `[]`, and the origin's `refs/heads/` has no `ultra/` ref [M3]; (d) a `README.md`-only base with an untracked `pytest.ini` written into the clone's working tree refuses; a `pytest.ini` base whose working-tree copy is deleted with `fs.rmSync` launches with `result.run` 1 [M3]; (e) for each of the twelve seeds — the seven detectable trees of the first leg and the five undetectable trees of the second — the Python ladder spawned on the clone directory prints a rule name for the seven and `None` for the five [M1]; (f) the first `Run:` exits 0: `fleet/tests/test_launch.mjs` prints `ALL TESTS PASSED` — a sim that stops short of the sentinel makes its `grep -q` exit 1 and the `Run:` fail [M4]; (g) the second `Run:` exits 0: `fleet/tests/test_launch_hold.mjs` prints `ALL TESTS PASSED` [M4]; (h) the third `Run:` exits 0: `fleet/tests/test_launch_effort.mjs` prints `ALL TESTS PASSED` [M4]; (i) the fourth `Run:` exits 0: `fleet/tests/test_launch_engine_source.mjs` prints `ALL TESTS PASSED` [M4]; (j) the fifth `Run:` exits 0: `fleet/tests/test_launch_reaps.mjs` prints `ALL TESTS PASSED` [M4].

**Stale-if:**
- issue-closed: #716
- path-absent: `fleet/launch.mjs`
- path-absent: `skills/ultrapowers/scripts/ultra_run.py`

### Task 4: A backticked or non-command Exam command line is refused by the compiler and the launcher

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `fleet/launch.mjs`
- Test: `tests/test_compile_plan_exam_command.py`
- Test: `fleet/tests/test_launch_exam_command.mjs`

**Claim:** `compile_plan.py --check` refuses backticks or any non-command characters on the `**Exam command:**` line (the same species as its `run-chained-semicolon` advisory) (quoted from #716)
Machine: M1. `compile_plan.py --check` on a plan whose `**Exam command:**` value carries a backtick anywhere prints the violation `grammar: Exam command: command carries a backtick — <value[:80]>; the driver's shell reads it as a command substitution (run-74)` — `_backtick_command_violation("Exam command", value)` — and exits 2.
M2. Every whitespace-delimited word of the value is either exactly `{paths}` or matches the command-word class `^[A-Za-z0-9_.+/=:@,-]+$` — no quote, `$`, `(`, `)`, `;`, `&`, `|`, `<`, `>`, `*`, `?`, `!`, `#` or `\` anywhere — and the first word is never `{paths}`; a value breaking either rule prints `exam-command: <word> is not a command word — the sandbox reads the template as one runner and its arguments, probing the first word with command -v` naming the first offending word, and exits 2.
M3. `**Exam command:** node {paths}`, `**Exam command:** ./node_modules/.bin/vitest run {paths}`, `**Exam command:** python3 -m pytest -q --tb=short {paths}`, `**Exam command:** go test ./... {paths}` and a plan with no such line still print `PLAN OK` and exit 0; a value with two `{paths}` still draws the BASE `exam-command: the template must carry {paths} exactly once` refusal; and every Run-less fixture plan's bare `--check` output stays byte-identical to the compiler at the frozen sha.
M4. `launch` refuses (exit 2, before any `ssh` and before any `git push`) a plan whose header `**Exam command:**` value carries a backtick or a word outside that class, with the value in its message, and launches a plan whose value is `node {paths}` as at BASE.

**Authorized-by:** #716 (its 2026-09-08 comment keeps this half); #644 (the `**Exam command:**` line and its `exam-command:` refusal channel); run-74 (the backtick note).

**Interfaces:**
- Consumes: nothing
- Produces: `EXAM_RUNNER_WORD`

**Context:** Decision, stated: this is a REFUSAL, not an advisory. At BASE the compiler
already refuses a backtick on a `Run:` or `Check:` value through
`_backtick_command_violation` (`compile_plan.py` line 487: `grammar: %s: command carries a
backtick — %s%s` with `BACKTICK_COMMAND_NOTE = "; the driver's shell reads it as a command
substitution (run-74)"`), and `exam_command_violations` (line 424) is already a `--check`
refusal channel that #644 added for the `{paths}` count — the same line, the same channel,
the same reading. The issue's signed sentence says "refuses", and a passing exam has to make
it true. The frozen vocabulary is the gate scripts' and the species list's; neither moves.
Extend `exam_command_violations` and nothing else in the compiler: the backtick line first,
then the runner-word line, then the BASE `{paths}` count. The shared literal of the two
halves — the compiler's and the launcher's — is the command-word class
`^[A-Za-z0-9_.+/=:@,-]+$`, exported from `fleet/launch.mjs` as `EXAM_RUNNER_WORD` and written
as `EXAM_RUNNER_WORD = re.compile(r"^[A-Za-z0-9_.+/=:@,-]+$")` in the compiler; the rule is
word by word over the value split on whitespace — every word is `{paths}` itself or matches
the class, and the first word is not `{paths}` — and the refusal names the first word that
breaks it. The class admits what a runner and its flags are spelled with (`-q`, `--tb=short`,
`./...`, `pkg:test`, `a,b`) and excludes every shell operator, quote and expansion character,
which is what "non-command characters" means here: a `;`, `|`, `$(`, `>` or quote anywhere on
the line means the first word is not necessarily what runs the suite. The sandbox's reading this mirrors is
`ultra_run.py`'s `runner_for` (line 248): a command the `TASK_RUNNERS` table does not know
has its runner as `cmd.split()[0]`, probed with `/bin/sh -c 'command -v <word>'` — which is
why a template written `` `python3 -m pytest {paths}` `` reached `--validate-knobs` as a
runner literally named with a leading backtick (#716's finding 2) after `PLAN OK`. The
header value is read by `parse_exam_command` (line 417): `_plan_header_value` takes the
first header line (before the first `### Task` heading, outside fences) matching
`EXAM_COMMAND_LABEL_RE` = `^\*\*\s*exam[-\s]?command\s*(?::\s*\*\*|\*\*\s*:)\s*(.*)$`
(case-insensitive), joins wrapped lines on a space and collapses whitespace. The launcher
reads the same line the same way: put an `examCommandShapeOf(planText)` in
`fleet/launch.mjs` directly below `SHALLOW_FIX` (above `NEW_ATTEMPTS`) — this task's region;
the other three launcher tasks add theirs below `targetOfOriginUrl`, below
`readDefaultBranch` and below `commitPlan` — and call it in `launch` directly after the
`plan is empty` refusal, before the comment-length probe, so it is refused with nothing
executed. Its refusals: `launch: **Exam command:** carries a backtick — <value>; the driver's
shell reads it as a command substitution (run-74)` and `launch: **Exam command:** <word> is
not a command word — <value>`. The shared literal of this plan's launcher tasks:
every refusal is `throw new Refusal('launch: …')` — `Refusal` from `./lobby.mjs`,
`exitCode` 2; and every launch sim seeds its target with `'pytest.ini': '[pytest]\n'` beside
`README.md`, because a sibling task of this wave makes a launch refuse when the tree at
`--base` has no detectable test command. The fixture plans under `tests/fixtures/plans/` that
carry the line all read `**Exam command:** node {paths}` (four files, 2026-09-07), and no
plan under `evals/fixtures/` carries one, so `tests/test_compile_plan_proof_runs.py`'s
byte-identity leg (`BASE_SHA 0a3559a…`, bare `--check` on every Run-less fixture plan) is
unaffected — re-run it from the new tests as `tests/test_compile_plan_check_cost.py` does.
`tests/test_compile_plan_exam_command.py` is the surface's exam file (10 tests at BASE; its
`HEADER`, `EXAM_LINE` and `_task` helpers build a signed claims-v1 plan under `tmp_path`):
add this task's legs there under a comment naming the task. The launcher sim copies
`fleet/tests/test_launch.mjs`'s scaffolding and writes its own plan text with the header line
under test above one task.

**Proof:**
- Test: `tests/test_compile_plan_exam_command.py`
- Test: `fleet/tests/test_launch_exam_command.mjs`
- Legs: (a) a plan whose line is `` **Exam command:** `python3 -m pytest {paths}` `` exits 2 from `--check` and its output carries exactly the line `grammar: Exam command: command carries a backtick — ` + the value's first 80 characters + `; the driver's shell reads it as a command substitution (run-74)` [M1]; (b) for each of `$(which node) {paths}`, `'npx' vitest run {paths}`, `{paths}`, `node {paths}; rm -rf ~`, `node $(x) {paths}`, `node {paths} | tee out` and `node {paths} 2>&1`, `--check` exits 2 and its output carries `exam-command: <the first offending word of that value> is not a command word` — `$(which`, `'npx'`, `{paths}`, `{paths};`, `$(x)`, `|` and `2>&1` respectively [M2]; (c) `node {paths}`, `./node_modules/.bin/vitest run {paths}`, `python3 -m pytest -q --tb=short {paths}`, `go test ./... {paths}` — every word of each either `{paths}` or matching `^[A-Za-z0-9_.+/=:@,-]+$` — and a header with no line each print `PLAN OK` and exit 0, `node {paths} {paths}` exits 2 with `exam-command: the template must carry {paths} exactly once`, and the byte-identity assertion of `tests/test_compile_plan_proof_runs.py` re-run from this file passes [M3]; (d) in `fleet/tests/test_launch_exam_command.mjs`, a plan with the backticked line, a plan with `$(which node) {paths}` and a plan with `node {paths}; rm -rf ~` are each a `Refusal` with `exitCode` 2 whose message contains `**Exam command:**` and the value, with `exec.calls` empty of `ssh` and of git `push`, `exec.mutating()` `[]` and no `ultra/` ref on the origin; and a plan with `**Exam command:** node {paths}` launches with `result.run` 1 [M4].

**Stale-if:**
- issue-closed: #716
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `tests/test_compile_plan_exam_command.py`

### Task 5: The runbook says how a parked run is re-driven

**Type:** implementation

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_docs_agree_with_code.py`

**Claim:** `fleet/RUNBOOK.md`'s parked row (or a short section beside it) states the re-drive shape: a fixable defect is acked and merged, then fixed by its own run on main; a non-fixable one is closed and re-authored; the launcher never takes a run branch as base. (quoted from #790)
Machine: M1. Between `## States` and `## Reading a failure`, `fleet/RUNBOOK.md` carries a short section, headed `### Re-driving a parked run`, that says a parked run whose finding is fixable is acked and merged by hand — `gh pr ready <n>` then `gh pr merge <n> --squash`, not `--auto`, which GitHub refuses on a PR already in clean status — and that the finding is then fixed by its own run on main, whose plan's Claim is the finding.
M2. The section says a parked run whose finding is not fixable is closed — its pull request closed, its integration branch left to the retire sweep — and its plan re-authored.
M3. The section says the launcher never takes a run branch as `--base`, quoting the launcher's own refusal text `a parked branch is re-driven as a plan on main, not as a base`.
M4. `python3 -m pytest -q tests/test_docs_agree_with_code.py` exits 0 on the edited runbook, and the file still collects 23 tests, as at BASE.

**Authorized-by:** #790 (observed on run-54 / PR #782, re-driven as run-57); #715 decision 5 (a parked branch is re-driven as a plan on main); #383 for the park with nothing mergeable.

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `fleet/RUNBOOK.md` at BASE: `## States` opens at line 228 with the six-row table
(`parked` at line 238: "a gate verdict other than PASS that no `approve-receipt.json`
approved; `pr` is a draft PR, or `null` when the branch had nothing to publish"), then the
paragraph "A page already `done`, `parked` or `failed` is final: restarting the unit exits 0
and opens nothing twice", then the unit-state table; `## Reading a failure` opens at line 264.
Put the new `### Re-driving a parked run` section after the unit-state table and before
`## Reading a failure`; keep the table rows as they are. What the launcher says at BASE, for a
`--base` on a parked branch (`fleet/launch.mjs` line 144, `BASE_OFF_MAIN_FIX`): `relaunch
from main; a parked branch is re-driven as a plan on main, not as a base` — quote its second
clause verbatim. The shape that worked (2026-09-08, run-54 → run-57, 32 min): `gh pr ready
<n>` then `gh pr merge <n> --squash`; `gh pr merge --auto` is refused by GitHub on a PR that is
already clean ("Pull request is in clean status"), so say `--squash`, not `--auto`. A one-task
fix plan on main whose Claim is the finding is the follow-up. A park with nothing mergeable —
the branch zero commits ahead, `pr` null — is closed and re-authored (#383's case). Write the
three operative phrases so that the `Run:` bullets below find them, in this order within the
section: `gh pr ready` … `gh pr merge` … `--squash` … `not` … `--auto` … `its own run on
main`; `closed` … `re-authored`; `never takes a run branch as` … `re-driven as a plan on
main, not as a base`. `tests/test_docs_agree_with_code.py` reads this file structurally
(23 tests at BASE): every `fleet/<name>.mjs|sh` named must exist (naming `fleet/launch.mjs`
and `fleet/retire.mjs` is fine), the `RETIRED` tuple must not appear (`--pr-base`,
`sweep-branches`, `drive-one`, … — write `--base`, never `--pr-base`), and no `?ref=` may name
`ultra/evidence-run-`; nothing in it pins the States section's sentences, so no pin moves.
`docs/superpowers/` is absent from the sandbox: everything the section needs is in this
Context.

**Proof:**
- Run: sed -n '/^## States/,/^## Reading a failure/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'gh pr ready.*gh pr merge.*--squash.*not.*--auto.*its own run on main'
- Run: sed -n '/^## States/,/^## Reading a failure/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'closed.*re-authored'
- Run: sed -n '/^## States/,/^## Reading a failure/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'never takes a run branch as.*re-driven as a plan on main, not as a base'
- Run: sed -n '/^## States/,/^## Reading a failure/p' fleet/RUNBOOK.md | grep -q '^### Re-driving a parked run'
- Run: ! git show ${ULTRA_BASE}:fleet/RUNBOOK.md | sed -n '/^## States/,/^## Reading a failure/p' | tr '\n' ' ' | grep -q 'closed.*re-authored'
- Run: ! git show ${ULTRA_BASE}:fleet/RUNBOOK.md | sed -n '/^## States/,/^## Reading a failure/p' | grep -q '^### Re-driving a parked run'
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py
- Run: test "$(python3 -m pytest -q --collect-only tests/test_docs_agree_with_code.py | grep -c '::')" = 23
- Legs: (a) the first and fourth `Run:` exit 0 — the section exists between the two headings and names `gh pr ready`, `gh pr merge`, `--squash`, `not … --auto` and `its own run on main` in that order — and the sixth `Run:` exits 0 because the BASE file has no `### Re-driving a parked run` heading in that span [M1]; (b) the second `Run:` exits 0 on the edited file, and the fifth `Run:` exits 0 because the same grep over the BASE file's span finds no `closed … re-authored` sentence — the sentence is this task's [M2]; (c) the third `Run:` exits 0 — the launcher's refusal clause is quoted after `never takes a run branch as` [M3]; (d) the seventh `Run:` exits 0 and the eighth exits 0 with the per-file count 23 [M4].

**Stale-if:**
- issue-closed: #790
- path-absent: `fleet/RUNBOOK.md`
- path-absent: `tests/test_docs_agree_with_code.py`
