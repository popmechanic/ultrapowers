# The second papercut drain — eleven contracts, one wave

**Grammar:** claims-v1

**Goal:** Drain the papercuts filed after run-49, race-48 and run-50 in one fleet run whose
shape is itself a measurement: every task is its own contract, the compiler should derive no
edges, and the wave should run eleven wide. The run's own `events.jsonl` gives each task's
chain duration; the sum of chains is the serial estimate, the wall is the wide result
(run-49, eight wide, measured 0.19×).

**Tech Stack:** Node ESM in `fleet/` (no new npm dependencies; `fleet/package.json`
unchanged); Python 3 stdlib + pytest for the compiler, the preflight and the `tests/` exams.

**Spec:** issues #515, #234, #543, #544, #453, #537, #209 (each is its own record). Two
roster items collapsed during authoring and are NOT tasks here: #534's probe found the
race-48-c implementer had `cd fleet` in an earlier Bash call (the tool's cwd persists), so
its `ls docs/superpowers/specs/` ran from `fleet/` — mechanism (c), wrong root, no engine
defect (transcript `fleet-race-48-c-1788301211730`, calls 5–9); and #535 items 1–3 are
already pinned on main by `fleet/tests/test_race_launch.mjs` (f), `test_race_evidence.mjs`
(a null-degrading reader) and `test_race_judge.mjs` (i).

## Global Constraints

- The verification periphery stays frozen: `skills/ultrapowers/scripts/gate_check.py`,
  `ultra_gate.py`, `run_acceptance.sh` and `finalize_report.py` are byte-identical to BASE.
  `compile_plan.py --check` exit codes and its stdout on `evals/fixtures/*` and
  `tests/fixtures/*` are unchanged; any new compiler line is an `ADVISORY grammar: ` line.
- No engine or role change: `fleet/run-engine.mjs`, `fleet/run-main.mjs`,
  `fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/confine-hook.mjs` and
  `fleet/roles/*` are byte-identical to BASE.
- Every shape a sibling test already pins for the *absent-flag* case stays byte-identical:
  the sandbox assignment payload with no `plan` key, `buildDriveOptions` with no new flag,
  `driveOne`'s exec sequence with `pinRepoDir` omitted, `ultra_run.py --validate-knobs`
  output for an args file with no per-task `testCmd`, the store's existing run-row cells,
  and every existing PR-body section. An args wave entry keeps every existing key and value;
  the only addition is `testCmd`.
- Every new `fleet/tests/test_*.mjs` runs with no network, no live ssh and no `gh`, finishes
  under the suite's 120 s per-file cap, and prints `ALL TESTS PASSED` only on a clean exit —
  a `node:test` file gates the banner on exit code 0 (run-50's critic minor).
- Every new `tests/test_*.py` is offline and reads only committed files or fixtures it
  creates under a `tmp_path`.
- No token value appears on argv or in any rendered PR body; anything rendered from a
  drive error passes through the existing `scrub`.

**Acceptance:** suite — the committed suite is the verification.

**Parallelization rationale:** one wave, eleven wide; no chain. Every task carries its own
module or file region and its own exam, and no task needs a sibling's *runtime behaviour* —
where two tasks share a shape (Task 6 and Task 7 share the assignment payload key; Task 1
and Task 2 share the args-file `testCmd` slot) the shape is a literal in both Contexts, not
an edge. Same-file text edits stand and fold at merge: `fleet/drive.mjs` (Tasks 3, 4, 6),
`fleet/drive-one.mjs` (Tasks 3, 6), `fleet/shim-main.mjs` (Tasks 7, 11), `fleet/RUNBOOK.md`
(Tasks 9, 10); each such Context names its siblings and the region it owns.

### Task 1: The compiler derives each task's test command from its Proof

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`
- Test: `tests/test_compile_plan_task_test_cmd.py`

**Claim:** The implementer's inner loop (red→green iteration) can run task-scoped tests only (quoted from #515)
Machine: for a claims-v1 task whose Proof `Test:` paths all match `fleet/tests/test_*.mjs` or `tests/**/*.py`, every wave entry `compile_plan.py --emit-args` writes for that task carries `testCmd`: one `node <path>` per `.mjs` path in Proof order, then one `python3 -m pytest -q <py paths in Proof order>` when any `.py` path exists, joined with ` && `; a task with no Proof `Test:` path, any path outside those two shapes, or a legacy-grammar body carries `testCmd: null`; every other key and value of the entry is unchanged, and `--check` output is unchanged.

**Authorized-by:** #515 (tier 1, un-gated 2026-09-02); #443 (the depth multiplier); operator decision 2026-09-02 (memory: run-49's twelve workers ran the 1,272-test suite 28 times, ~70 agent-min, to check one-file exams)

**Interfaces:**
- Consumes: none
- Produces: `derive_task_test_cmd(proof_tests: list[str]) -> str | None`

**Context:** The engine seam already exists and is NOT to be touched: `fleet/run-engine.mjs:171-173`
(`testCmdLine`) hands the implementer `TEST COMMAND: <task.testCmd>` when the wave entry
carries a non-empty string and the run-wide command otherwise; `capWorkerParallelism`
(:161-166) rewrites only the run-wide command's `-n auto`; `fillTiers` in
`fleet/run-main.mjs:180-188` passes entries through untouched. The full suite still runs at
the integration head and the gate (the run-wide command) — this task changes only what the
implementer iterates against. Compiler geography: the claims-v1 task dict carries
`proof_tests` (a sorted list, `compile_plan.py:453`, from `_apply_claims_grammar`); legacy
tasks have no such key. Proof order is the order the `Test:` bullets appear in the Proof slot
— the exam pins that order, so derive from the Proof lines, not from the sorted
`proof_tests` set (add an ordered list alongside it if needed). The wave entries are built at
`:2489-2503` (`launch_waves`, the dict with `tier`, `review`, `writes`, `commutes`); the
`--emit-launch` payload at `:2537-2545` needs no `testCmd`. `--check` returns at `:2226`
before either is built. `ultra_run.py` copies `launch_waves` into the args file's `waves`
and stamps the run-wide `testCmd` at the top level (`:394`) — leave that file to Task 2,
which reads the per-task slot you emit under the literal name `testCmd` on each wave entry.
`tests/test_compile_plan.py` asserts individual entry fields (`:2361`, `:2374`), not whole
dicts; it is in this task's Files only so a whole-entry pin, if one turns up, can be updated
here. `evals/fixtures/claims/plan.md` (three tasks, `tests/test_widget.py` /
`tests/test_catalog.py` / `tests/test_format.py`) is a ready corpus plan: each entry derives
`python3 -m pytest -q tests/<file>.py`.

**Proof:**
- Test: `tests/test_compile_plan_task_test_cmd.py`
- Legs: (a) a temp claims-v1 plan with one task whose Proof lists `fleet/tests/test_x.mjs`, `tests/test_y.py`, `fleet/tests/test_z.mjs` in that order compiles (`--emit-launch --emit-args`) to a wave entry with `testCmd == "node fleet/tests/test_x.mjs && node fleet/tests/test_z.mjs && python3 -m pytest -q tests/test_y.py"`; (b) two `.py` paths collapse into one `python3 -m pytest -q a b` invocation in Proof order; (c) a task whose Proof names `docs/x.md` beside a `.py` path gets `testCmd: None`; (d) a task with no Proof `Test:` line gets `None`; (e) every wave entry of a legacy-grammar fixture plan (`evals/fixtures/wide/plan.md`) carries `testCmd: None`; (f) `evals/fixtures/claims/plan.md` derives `python3 -m pytest -q tests/test_widget.py` for task 1; (g) the entry's other keys (`id`, `title`, `files`, `depends_on`, `interfaces`, `tier`, `review`, `writes`, `commutes`) are present with their BASE values; (h) `derive_task_test_cmd([])` is `None` and `derive_task_test_cmd(["tests/a.py"])` is `"python3 -m pytest -q tests/a.py"`; (i) `compile_plan.py --check --renders evals/fixtures/claims/plan.md` exits 0 and its stdout contains no line mentioning `testCmd`.

**Stale-if:**
- issue-closed: #515

### Task 2: The preflight checks every per-task test command's runner

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run_task_test_cmds.py`

**Claim:** Before a run starts, every per-task test command's runner is checked in the preflight, so a task whose tests need a tool the sandbox lacks fails at preflight, not mid-wave. (elicited)
Machine: `ultra_run.py --validate-knobs <args.json>`, given an args file whose wave entries carry one or more `testCmd` strings, runs each distinct runner once with `--version` in the probe worktree — `node` for a command starting `node `, `python3 -m pytest` for one starting `python3 -m pytest` — and prints its `knob-validate` JSON line with a `perTaskTestCmds` list of `{cmd, runner, ok}` per distinct command; a runner that exits non-zero, or a command matching neither prefix, sets that entry's `ok` false and the line's `ok` false with exit code 1; an args file with no per-task `testCmd` and no run-wide knobs prints exactly the BASE line `{"ok": true, "stage": "knob-validate", "detail": "no bootstrapCmd — nothing to validate"}`.

**Authorized-by:** #234 (the watch item; its second-occurrence trigger is #515's derivation, which makes every claims-v1 run carry per-task commands); #515

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `run-main.mjs:465` calls `ultra_run.py --validate-knobs <argsFile>` AFTER compile
and tier fill, so the args file already carries whatever the compiler emitted. The slot is the
literal key `testCmd` on each entry of `waves[][]` (a string, or `null` when the task has no
derivable command — Task 1 emits it; do not consume Task 1's function, read the file). The
validator lives at `ultra_run.py:~150-260`: it walks `waves` checking `tier`/`review`
(`:176-192`), then validates the run-wide `bootstrapCmd`/`testCmd` knobs on a detached probe
worktree (`:197-250`, `probe_wt`, SIGTERM-safe `finally`). Add the per-task pass inside the
same `try`/`finally` so the worktree is always removed; a `--version` probe is the parse-check
#234 asks for — a dry run is impossible because a task's `Test:` files are created by the task
and do not exist at BASE. Keep the addition strictly additive: the `perTaskTestCmds` key
appears only when at least one entry carries a string, so every BASE output shape (`"no
bootstrapCmd — nothing to validate"`, the baseline result) is byte-identical when none does.
Also correct the stale `LLM_DERIVES` sentence at `:90-92` ("waves[][].testCmd per task, only
for polyglot plans …") to say the per-task command is compiler-derived from the task's Proof
`Test:` paths; the string is stamped into `receipt.json` `llmDerives` and no test pins its
wording (`grep -rn polyglot tests/` is empty at BASE).

**Proof:**
- Test: `tests/test_ultra_run_task_test_cmds.py`
- Legs: (a) in a temp git repo, an args file with two entries carrying `node fleet/tests/test_a.mjs` and `python3 -m pytest -q tests/test_b.py` and one carrying `null` → exit 0, the JSON line's `perTaskTestCmds` has exactly two items with runners `node` and `python3 -m pytest`, both `ok: true`; (b) an entry `weird-runner tests/x` → that item `ok: false`, `runner: null`, line `ok: false`, exit 1; (c) with `PATH` narrowed so `node` is absent, the `node` item is `ok: false` and exit is 1 while the pytest item stays `ok: true`; (d) an args file whose entries carry no `testCmd` key, with no run-wide knobs, prints exactly `{"ok": true, "stage": "knob-validate", "detail": "no bootstrapCmd — nothing to validate"}` (parsed JSON equality), and one whose entries all carry `null` prints the same; (e) after every case no `wt-knob-*` worktree remains (`git worktree list` shows one entry); (f) an args file with four entries carrying `node fleet/tests/test_a.mjs`, `node fleet/tests/test_a.mjs`, `node fleet/tests/test_b.mjs` and `python3 -m pytest -q tests/test_c.py` yields exactly three `perTaskTestCmds` items whose `cmd` values are exactly those three distinct commands (each item's `runner` matching its own `cmd`'s prefix), and a logging `node` shim placed first on `PATH` records exactly one `--version` invocation for the whole run; (g) the shim also records its working directory, which is a `wt-knob-*` path under the repo's `.claude/ultrapowers/` (the probe worktree, not the repo root); (h) a `node` shim that exits 3 on `--version` makes the `node` item `ok: false` and the exit code 1 while the pytest item stays `ok: true`; (i) a logging `python3` shim first on `PATH` (the test itself invokes the script by `sys.executable`, so only the probe sees the shim) that exits 3 on `-m pytest --version` makes the pytest item `ok: false` and the exit code 1 while the node item stays `ok: true`, and across an args file naming two distinct pytest commands it records exactly one `-m pytest --version` invocation.

**Stale-if:**
- issue-closed: #234

### Task 3: The run tip is pinned in one canonical repo

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/drive-one.mjs`
- Modify: `fleet/race-launch.mjs`
- Test: `fleet/tests/test_drive_pin_repo.mjs`

**Claim:** the drive should pin into ONE well-known repo regardless of `repoDir` (quoted from #543)
Machine: `driveOne({ pinRepoDir })`, after writing `refs/fleet/<runId>` in `repoDir`, also writes it in `pinRepoDir` (`git -C <pinRepoDir> fetch <repoDir> refs/fleet/<runId>:refs/fleet/<runId>`) and records a note naming both, with a failure pushed onto `errors` and never fatal; `pinRepoDir` omitted or equal to `repoDir` leaves the exec sequence byte-identical to BASE; `fleet/drive-one.mjs` sets `pinRepoDir` to the checkout the CLI lives in (`REPO_DIR`) unless `--pin-repo-dir` overrides it, and `fleet/race-launch.mjs` passes its `sourceRepo`.

**Authorized-by:** #543 §Proposed policy "Pin into one place"; #497 (the pin)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The pin leg is `fleet/drive.mjs:1296-1340`: after `git fetch` of the run branch into
`repoDir` (`:1282`) and `rev-parse FETCH_HEAD` (`:1290`), it `check-ref-format`s and
`update-ref`s `refs/fleet/<runId>` in `repoDir`, noting `pinned run tip: …` on success and
pushing an `errors` entry on failure. Mirror the pin AFTER that succeeds: a ref is always
fetchable from a local path, a bare sha is not (`uploadpack.allowAnySHA1InWant`), so fetch
the ref, never the sha. `pinRepoDir` is interpolated into a shell string — pass it through
the same guard `repoDir` gets (`shellQuote` at `:1606` is the precedent; refuse and record
rather than interpolate an unsafe path). Option docs live in the JSDoc block at `:500-560`;
the destructure at `:563-600` gives every option its default — `pinRepoDir = repoDir` keeps
the library behaviour identical for every existing caller and test
(`fleet/tests/test_drive_lifecycle.mjs:1049,1067` pin the `repoDir` ref and its gc survival
and must stay green). `fleet/drive-one.mjs`: `REPO_DIR` (`:21`) is the checkout the CLI lives
in, `DEFAULTS` (`:23`), the flag map (`:53-61`, `--repo-dir` → `repoDir`),
`buildDriveOptions` (`:141-160`, spreads only set values — `--overlap` at `:159` is the
shape to copy). `fleet/race-launch.mjs:119-135` builds each attempt's options from
`buildDriveOptions(...)` with a per-run `repoDir` clone; add `pinRepoDir: sourceRepo`
(the launch checkout, `:79`) — it is the same value across attempts, so
`fleet/tests/test_race_launch.mjs:185-190` ("exactly five keys differ") stays green. A sibling
(Task 4) edits `renderPullRequestBody` in the same file and Task 6 edits the fitness
preflight (`:659-745`) and the `provision(...)` call (`:1066-1080`); stay inside the pin leg,
the option docs and the destructure.

**Proof:**
- Test: `fleet/tests/test_drive_pin_repo.mjs`
- Legs: (a) with a stub `exec` that records every command, `driveOne({ repoDir: '/r', pinRepoDir: '/canon', … })` driven to a fetched tip issues, after the `update-ref` in `/r`, exactly one `git -C /canon fetch /r refs/fleet/<runId>:refs/fleet/<runId>` and the notes name both repos; (b) with `pinRepoDir` omitted, and again with `pinRepoDir: '/r'`, the recorded command list deep-equals a literal expected sequence frozen in the test from a run of the same stub against BASE (recorded before this task's edit, so any added or changed command fails it), and the `/canon` run's list equals that sequence plus the one mirror-fetch command; (c) a failing mirror fetch (stub code 1) leaves `detail.errors` carrying a line naming `/canon` and the run completes; (d) `pinRepoDir: '/bad path;x'` issues no fetch and records a refusal; (e) `parseArgs(['plan', 'run-1', '--pin-repo-dir', '/p'])` yields `pinRepoDir: '/p'`, `buildDriveOptions` forwards it, and without the flag `buildDriveOptions(parseArgs(['plan','run-1'])).pinRepoDir === REPO_DIR`; (f) on a real temp repo pair, the mirror fetch actually makes `git -C canon rev-parse refs/fleet/run-1` resolve to the tip; (g) `launchRace` with a stub `drive`, a stub `git` and `--repo-dir /launch` records `pinRepoDir === '/launch'` on every attempt's drive options.

**Stale-if:**
- issue-closed: #543

### Task 4: The PR says the work is pinned

**Type:** implementation

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/tests/test_drive_pr_rescue.mjs`
- Test: `fleet/tests/test_drive_pr_pin_line.mjs`

**Claim:** The parked/loser PR body gains one line: "Closing this PR does not lose the work: tip pinned as `refs/fleet/<runId>` on the orchestrator; evidence at `<path>`; the branch is swept after adoption." (quoted from #543)
Machine: `renderPullRequestBody` given `pinnedRef` and `evidencePath` renders, in every body (parked or green), the single line `Closing this PR does not lose the work: tip pinned as \`refs/fleet/<runId>\` on the orchestrator; evidence at \`<evidencePath>\`; the branch is swept after adoption.` with the run's real values, and renders no such line when `pinnedRef` is absent; `driveOne` passes the pinned ref and `<evidenceDir>/gate-read-<runId>.json` after a successful pin.

**Authorized-by:** #543 §Proposed policy "Say it on the PR"

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `renderPullRequestBody` (`fleet/drive.mjs:312-455`) takes a named-argument object
(`runId`, `planPath`, `branch`, `vmName`, `parked`, `receipt`, `read`, `receipts`, `closes`,
…); the `## Rescue` section (`:440-450`) fires only on a publish failure and stays as is —
the new line is unconditional on the pin, placed before the `Closes` lines. The pin result
is known at `:1324-1335` (`pinned?.code === 0`); carry the ref name and the evidence path
(`evidenceDir` is an option, `:81`; the gate read lands at `gate-read-<runId>.json` there)
into the render call. `fleet/tests/test_drive_pr_rescue.mjs` pins that parked-without-error
and green bodies render no `## Rescue`; it is in this task's Files so an assertion that a
green body carries no `refs/fleet` at all, if present, can be narrowed to the Rescue
section. Task 3 edits the pin leg itself in the same file and Task 6 the fitness preflight;
own only the renderer and the render call.

**Proof:**
- Test: `fleet/tests/test_drive_pr_pin_line.mjs`
- Legs: (a) a green body and a parked body rendered with `pinnedRef: 'refs/fleet/run-9'` and `evidencePath: '/e/gate-read-run-9.json'` each contain exactly one line equal to the sentence above with those values substituted; (b) the same inputs without `pinnedRef` contain no `Closing this PR does not lose the work`; (c) the line sits outside any fenced block and before the `Closes` lines; (d) a full stub-`exec` `driveOne` run whose `update-ref` succeeds produces a PR body file containing the line with `refs/fleet/<runId>` and the exact path `<evidenceDir>/gate-read-<runId>.json` for the evidence dir the drive was given, and one whose `update-ref` fails produces a body without it.

**Stale-if:**
- issue-closed: #543

### Task 5: A sweep verb for run branches

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/sweep-branches.mjs`
- Test: `fleet/tests/test_sweep_branches.mjs`

**Claim:** it deletes ONLY branches whose PR is MERGED or CLOSED **and** whose tip is pinned **and** whose gate read exists. Dry-run by default; prints what it would keep and why. (quoted from #543)
Machine: `node fleet/sweep-branches.mjs [--delete] [--repo-dir D] [--evidence-dir E]` lists every `ultra/integration-*` and `adopt/*` branch on origin with its PR state, whether its tip equals `refs/fleet/<runId>` in `D`, and whether `E/gate-read-<runId>.json` exists; without `--delete` it issues no `git push origin --delete`; with it, it deletes exactly the branches whose PR state is MERGED or CLOSED and whose tip is pinned and whose gate read exists, and prints a keep reason for every other branch.

**Authorized-by:** #543 §Proposed policy "A sweep verb, never the drive"; memory "PR merge practice" (`--delete-branch` never works here)

**Interfaces:**
- Consumes: none
- Produces: `sweepBranches(argv, deps) -> Promise<{kept: object[], deleted: string[]}>`

**Context:** A separate verb, never part of the drive (the drive deletes nothing by design).
Every external call goes through an injected `exec`/`gh` seam (`fleet/drive-one.mjs:128`
`shellExec` is the production runner; `fleet/race-launch.mjs` is the precedent for a CLI
with injected deps and a `main()` guarded by the `import.meta.url === pathToFileURL(...)`
check, `fleet/drive-one.mjs:174`). Reads: `git -C D ls-remote --heads origin
'refs/heads/ultra/integration-*' 'refs/heads/adopt/*'` for branch → tip; `gh pr list --head
<branch> --state all --json state,number --limit 1` for the PR state (`OPEN`/`MERGED`/`CLOSED`,
or none); `git -C D rev-parse --verify refs/fleet/<runId>` for the pin, where `runId` is the
text after `ultra/integration-`; `fs.existsSync(path.join(E, 'gate-read-<runId>.json'))`.
`adopt/*` branches carry no runId, so they are listed and always kept with reason `no runId
— not a run branch`. Defaults: `D` = the checkout the CLI lives in (the same `REPO_DIR`
shape as `fleet/drive-one.mjs:21`), `E` = `/home/exedev/fleet-evidence` (`DEFAULTS.evidenceDir`,
`:33`). Output: one line per branch (`keep`/`delete`/`would-delete` + reason), then a summary
count. The delete command is `git -C D push origin --delete <branch>`; a branch name is
interpolated into a shell string, so refuse any name outside `[A-Za-z0-9._/-]`.

**Proof:**
- Test: `fleet/tests/test_sweep_branches.mjs`
- Legs: (a) with canned `exec` outputs describing five branches — MERGED+pinned+read, CLOSED+pinned+read, CLOSED+pinned+no read, OPEN+pinned+read, MERGED+unpinned+read — a dry run issues zero `push --delete` commands and reports `would-delete` for exactly the first two with a reason for each of the other three; (b) `--delete` issues exactly two `git -C D push origin --delete <branch>` commands, for those two; (c) an `adopt/x` branch with a MERGED PR is kept with reason `no runId`; (d) a branch with no PR at all is kept; (e) a branch name containing `;` is refused before any command runs; (f) the summary line's counts match the per-branch lines; (g) `node fleet/sweep-branches.mjs --help` exits 0 without calling `exec`.

**Stale-if:**
- issue-closed: #543

### Task 6: The drive ships the plan and its verdicts in the assignment

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/drive-one.mjs`
- Modify: `fleet/provision.mjs`
- Test: `fleet/tests/test_drive_plan_in_assignment.mjs`

**Claim:** the plan and its verdict record ride the assignment (quoted from #544)
Machine: `driveOne({ planSource: 'assignment' })` reads the plan from the working tree at `planPath` and its sibling `<stem>.gate-verdicts.json`, runs the headless-fitness check on that text and never runs `git show <baseRef>:<planRel>` (so a plan absent from or differing at `baseRef` is not refused), and `provisionRun` embeds `plan: { text, verdicts }` (both strings, `verdicts` null when the sibling is absent) in the `fleet-run.json` payload; `fleet/drive-one.mjs --plan-from-assignment` sets the option; with the option absent, every exec string and the payload are byte-identical to BASE.

**Authorized-by:** #544 §Roadmap step 2 (option 1: "Ship the plan as a run artifact, not a repo file"); #337 (the plan-at-base rule this makes optional)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** This task does NOT untrack `docs/`; it only makes the plan-at-base rule optional
(#544 steps 1 and 3 are later work). The payload shape is a literal shared with Task 7 (the
shim), which writes it into the sandbox: `payload.plan = { text: <plan file text>, verdicts:
<verdict file text or null> }`, beside the existing `planPath` (unchanged — the receipt and PR
title keep naming the repo path). Drive side: the fitness preflight is
`fleet/drive.mjs:659-745` — `git show <baseRef>:<planRel>` (`:702`), the "not committed"
refusal (`:712`), the "differs from the working tree" refusal (`:717`), then
`assessHeadlessFitness(committedText)` (`:722`); under `planSource: 'assignment'` read
`planFile` from disk (`:675`), assess that text, skip both refusals, and read the sibling
verdicts file from the same directory. The `provision(...)` call is at `:1066-1080`; pass
`plan` there. `fleet/provision.mjs:219-226` builds the payload with `overlap` as the
absent-key precedent (`...(isNonEmptyString(overlap) ? { overlap } : {})`) — spread `plan` the
same way; the payload rides a `FLEET_EOF` heredoc (`:225`), so refuse a plan or verdict text
containing that sentinel exactly as `:52` refuses it for env values. `fleet/drive-one.mjs`:
boolean flag like `--allow-unfit-plan` (`:78`, `:96-100`), forwarded by `buildDriveOptions`
(`:141-160`) only when set. `fleet/tests/test_provision.mjs:72-82` parses the heredoc payload
and asserts fields, not the whole object. Task 3 edits the pin leg and Task 4 the PR renderer
in `fleet/drive.mjs`; own the preflight, the provision call, and the provision payload.

**Proof:**
- Test: `fleet/tests/test_drive_plan_in_assignment.mjs`
- Legs: (a) `provisionRun({ …, plan: { text: 'P', verdicts: 'V' } })` delivers a heredoc payload whose parsed `plan` deep-equals `{ text: 'P', verdicts: 'V' }` and whose other keys equal the BASE payload; (b) without `plan` the delivery command is byte-identical to BASE; (c) `plan.text` containing `FLEET_EOF` throws before any exec; (d) a stub-`exec` `driveOne({ planSource: 'assignment' })` whose `git show <baseRef>:<plan>` stub returns code 128 (absent at base) proceeds to provision and the recorded provision call carries `plan.text` equal to the working-tree file and `plan.verdicts` equal to the sibling file; (e) the same with no sibling verdict file carries `plan.verdicts === null`; (f) without `planSource`, an absent-at-base plan is still refused with the BASE message; (g) an unfit plan text on disk is refused under `planSource: 'assignment'` unless `allowUnfitPlan`; (h) `parseArgs([...,'--plan-from-assignment'])` sets `planSource: 'assignment'`, and `buildDriveOptions` of a parse without it has no `planSource` key; (i) a stub whose `git show <baseRef>:<plan>` returns text different from the working-tree file, under `planSource: 'assignment'`, proceeds and the provision call carries the working-tree text; (j) the full recorded exec list of a stub `driveOne` run without `planSource` deep-equals a literal expected sequence frozen in the test from a run of the same stub against BASE (recorded before this task's edit, so any added or changed command fails it), its provision payload carries no `plan` key, and the same run with `planSource: 'assignment'` differs from that sequence exactly by the absence of the `git show <baseRef>:<plan>` command.

**Stale-if:**
- issue-closed: #544

### Task 7: The sandbox builds from the assignment's plan

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_shim_main_plan_assignment.mjs`

**Claim:** the "plan at base" rule becomes "plan in the assignment, hash recorded in the receipt" (quoted from #544)
Machine: when the assignment carries `plan: { text, verdicts }`, `invokeEngineRun` writes `text` to `<repoDir>/.claude/ultrapowers/assignment-<runId>/<basename(planPath)>` and `verdicts` (when non-null) to `<same dir>/<stem>.gate-verdicts.json` after the `BASE_REF` checkout, launches the engine with that repo-relative path, and `main()` stamps `runs.<runId>.planSha256` (hex SHA-256 of `text`) on the store; an assignment without `plan` launches the engine with `planPath` exactly as at BASE and stamps no such cell.

**Authorized-by:** #544 §The one hard constraint (option 1); #190 (the run's own directories are the ones that did not exist before launch)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The payload literal (shared with Task 6, which produces it): `assignment.plan =
{ text: string, verdicts: string | null }`, beside the unchanged `planPath`. Geography in
`fleet/shim-main.mjs`: `main()` reads the assignment at `:820-822`; `preRunDirs` is snapshotted
at `:877` from `runArtifactDirs` (`:404-416`), which lists directories whose name starts
with `run-` — a directory created before launch is EXCLUDED from every gate-receipt read
(#190), so the assignment directory must not start with `run-` (`assignment-<runId>` is the
name). `invokeEngineRun` (`:745-800`) refuses without `planPath`/`runId`, checks out
`BASE_REF`, then spawns `oneDriverArgs(repoDir, planPath, runId, overlap)` (`:687-695`);
write the files after the checkout and before the spawn, and hand `oneDriverArgs` the
repo-relative `assignment-<runId>/<basename>` path. `.claude/ultrapowers/` self-ignores
(`ultra_run.py:349-353` writes `.gitignore: *` there; the sandbox also carries it in
`.git/info/exclude`), so the files never reach the run branch or the dirty baseline.
`compile_plan.py` finds `<stem>.gate-verdicts.json` beside the plan (`:476-485`) and refuses
a claims-v1 plan without it — that is why the verdict text rides along. The store cell is a
register on the run row (`fleet/store.mjs` top comment: status is a cell, evidence is a row);
`applyReportedTokens` (`:480`) is the shape for a `setCell` on `runs`. Task 11 edits the
token reader (`:245-268`, `:833`) in this file; own `invokeEngineRun`, the assignment read
and the new cell.

**Proof:**
- Test: `fleet/tests/test_shim_main_plan_assignment.mjs`
- Legs: (a) `invokeEngineRun` with `plan: { text: 'T', verdicts: 'V' }`, a stub `exec` and a stub `spawnEngine`: after the run, `<repoDir>/.claude/ultrapowers/assignment-r1/<basename>` reads `T`, the sibling `.gate-verdicts.json` reads `V`, and the spawned argv's plan argument is `.claude/ultrapowers/assignment-r1/<basename>` (repo-relative); (b) with `verdicts: null` no verdict file exists and the plan file does; (c) without `plan` the spawned argv deep-equals `oneDriverArgs(repoDir, planPath, 'r1', undefined)`; (d) the file writes happen after the `checkout` exec (order recorded by the stubs); (e) `runArtifactDirs(repoDir)` after the writes does not list the assignment directory; (f) a `main()` run through the existing shim harness (an orchestrator on a free port, a stub `invokeRun`) with `plan` in the assignment file stamps `runs.r1.planSha256` equal to `sha256('T')`, and without `plan` the cell is absent.

**Stale-if:**
- issue-closed: #544

### Task 8: The RUNBOOK's exe.dev verbs are attested

**Type:** implementation

**Files:**
- Create: `fleet/exe-verbs.json`
- Test: `tests/test_runbook_exe_verbs.py`

**Claim:** the RUNBOOK only instructs exe.dev verbs that appear in `fleet/provision.mjs` (or in an explicit allow-list with a comment naming who verified each and when) (quoted from #453)
Machine: a test collects every verb the RUNBOOK issues as `ssh exe.dev "<verb> …"` or `ssh exe.dev '<verb> …'`, collects the verbs `fleet/provision.mjs` issues the same way, loads `fleet/exe-verbs.json` (a map verb → `{verifiedBy, on, how}`), and fails on any RUNBOOK verb in neither set or any allow-list entry missing one of the three fields.

**Authorized-by:** #453 option 1 ("Pin the verb list"); run-30 reviewer's `deferred:external` ack

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the RUNBOOK issues nine verbs: `cp`, `rm`, `rename`, `new`, `ssh-key`,
`tag`, `ls`, `billing`, `stat` (`grep -n 'ssh exe.dev' fleet/RUNBOOK.md`); `fleet/provision.mjs`
attests exactly two (`:181` `cp`, `:287` `rm`, both exercised by
`fleet/tests/test_provision.mjs`). The allow-list therefore starts with the other seven,
each verified live: `rename` on the 2026-08-30 golden swap (memory "Sitting 2026-08-30 golden
rebuild"), `new`/`ssh-key`/`tag` on the orchestrator and golden builds (RUNBOOK §Golden VM
build, §Orchestrator VM), `ls`/`stat` in §Teardown guarantee and §Capacity, `billing` on the
2026-09-01 width read. JSON carries no comments, so the "comment" is the three fields per
entry; `verifiedBy` names the operator or the sitting. The verb is the first token after the
opening quote; `billing usage` and `billing plan` are one verb (`billing`). Multi-verb lines
(`rm fleet-run-1 fleet-run-2`) are one verb. The test reads both files from the repo, no
network.

**Proof:**
- Test: `tests/test_runbook_exe_verbs.py`
- Legs: (a) every verb the RUNBOOK issues at BASE is in the provision set or the allow-list (the test passes on the committed tree); (b) the extractor, run on a fixture string containing `ssh exe.dev "frobnicate x --json"` and `ssh exe.dev 'zorp'`, reports exactly `{"frobnicate", "zorp"}` and the assertion fails for both; (c) `fleet/exe-verbs.json` parses, every entry has non-empty `verifiedBy`, `on` (an ISO date) and `how`, and contains no verb the provision set already attests; (d) the provision extractor finds exactly `{"cp", "rm"}` at BASE; (e) the RUNBOOK extractor finds at least eight distinct verbs at BASE, so a broken regex cannot green the test.

**Stale-if:**
- issue-closed: #453

### Task 9: The RUNBOOK says orchestrator suite runs are serial

**Type:** implementation

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_runbook_orchestrator_serial.py`

**Claim:** say plainly that orchestrator-side suite runs are serial (quoted from #537)
Machine: `fleet/RUNBOOK.md` §Orchestrator VM contains, verbatim, the sentence `The orchestrator carries no \`pytest-xdist\`, so a suite run there is serial: \`python3 -m pytest\` without \`-n auto\` (141 s for the fleet files, measured 2026-09-01).`, and no line of the RUNBOOK issues `-n auto` on `fleet-orchestrator`.

**Authorized-by:** #537 (the `unrecognized arguments: -n auto` finding of 2026-09-01)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** §Orchestrator VM is `fleet/RUNBOOK.md:169-198`; add a short "Hand work on the
orchestrator" note after the clone step (`:189-193`). The golden's xdist install and the
`-n auto` detection are documented at `:54-68` (golden only) — leave them. At BASE no line
issues `-n auto` against `fleet-orchestrator` (`grep -n 'fleet-orchestrator' fleet/RUNBOOK.md
| grep 'n auto'` is empty), so the negative leg holds on the committed tree. Task 10 adds the
push-credential sentence to the same note; write yours as its own sentence so the two fold.
Serial timing measured 2026-09-01: 141 s for `tests/test_fleet_suite.py` on the orchestrator.

**Proof:**
- Test: `tests/test_runbook_orchestrator_serial.py`
- Legs: (a) the text between the `## Orchestrator VM` heading and the next `## ` heading contains the exact sentence `The orchestrator carries no \`pytest-xdist\`, so a suite run there is serial: \`python3 -m pytest\` without \`-n auto\` (141 s for the fleet files, measured 2026-09-01).` as a substring; (b) no RUNBOOK line containing `fleet-orchestrator` also contains `-n auto`, and the whole §Orchestrator VM section text (heading to next `## `) contains no `-n auto`; (c) the §Golden VM build section still contains the `pip install --user --break-system-packages pytest pytest-xdist` line (the golden install is untouched).

**Stale-if:**
- issue-closed: #537

### Task 10: The RUNBOOK names the laptop-side push rule

**Type:** implementation

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_runbook_orchestrator_push.py`

**Claim:** Adoption or rescue work done by hand on the orchestrator must therefore be fetched to the laptop over ssh and pushed from there (quoted from #537)
Machine: `fleet/RUNBOOK.md` §Orchestrator VM contains, verbatim, the sentence `The orchestrator shell has no GitHub push credential (the drive pushes with its own token inside \`drive.mjs\`), so adoption or rescue work done by hand there is fetched to the laptop over ssh and pushed from the laptop:` followed by a fenced `bash` block whose first command line starts `git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo ` and whose last starts `git push origin `; and the four §Park triage rescue commands present at BASE (`git rev-parse refs/fleet/run-<N>`, the `git fetch ssh://…/home/exedev/repo refs/fleet/run-<N>:refs/heads/ultra/integration-run-<N>` line, `git push origin ultra/integration-run-<N>`, and the `gh pr create` line) are still present verbatim.

**Authorized-by:** #537 (`could not read Username` on the orchestrator, 2026-09-01); #497 (the path that worked)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** §Orchestrator VM is `fleet/RUNBOOK.md:169-198`; §Park triage (`:585-660`) already
shows the four rescue steps with the same `git fetch ssh://exedev@fleet-orchestrator.exe.xyz/
home/exedev/repo refs/fleet/run-<N>:refs/heads/ultra/integration-run-<N>` shape (`:630-633`) —
reuse that shape for the general rule and do not edit §Park triage. Task 9 adds the
serial-suite sentence to the same note in §Orchestrator VM; write yours as its own sentence
plus the fenced block so the two fold. The 2026-09-01 adoption (#533) is the worked example:
files taken onto main on the orchestrator, fetched to the laptop over ssh, pushed with the
operator's credential.

**Proof:**
- Test: `tests/test_runbook_orchestrator_push.py`
- Legs: (a) the text between `## Orchestrator VM` and the next `## ` heading contains the exact sentence `The orchestrator shell has no GitHub push credential (the drive pushes with its own token inside \`drive.mjs\`), so adoption or rescue work done by hand there is fetched to the laptop over ssh and pushed from the laptop:` as a substring; (b) the first fenced block after that sentence is tagged `bash`, its first non-comment line starts `git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo ` and its last non-comment line starts `git push origin `; (c) the text between `## Park triage` and the next `## ` heading still contains all four lines verbatim: `git rev-parse refs/fleet/run-<N>`, `git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo refs/fleet/run-<N>:refs/heads/ultra/integration-run-<N>`, `git push origin ultra/integration-run-<N>`, and a line starting `gh pr create`.

**Stale-if:**
- issue-closed: #537

### Task 11: The spend reader reads the workers' envelopes

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_shim_main_envelope_tokens.mjs`

**Claim:** After a run, the token figure on the run row is the one the workers' own envelopes report, and the transcript sum is used only when no envelope exists. (elicited)
Machine: `readRunEnvelopeTokens(runDir)` returns `{ total, files }` where `total` sums `outputTokens` over every model in `modelUsage` of every `<runDir>/workers/*/envelope.json` and is `null` with `files: 0` when none exists; `main()`'s default `readTokens` uses that total when `files > 0` and `readRunConfigTokens(<runDir>/claude).total` otherwise, so `runs.<runId>.reportedTokens` equals the envelope sum whenever an envelope exists.

**Authorized-by:** #209; the 2026-09-01 ledger dedup (`1f17c57`) whose run-47 reading — transcripts 239,564 (dedup) vs envelopes 239,695 — is the equality this pins

**Interfaces:**
- Consumes: none
- Produces: `readRunEnvelopeTokens(runDir: string) -> { total: number | null, files: number }`

**Context:** The engine already captures the number: `fleet/run-worker.mjs:592` writes each
worker's `envelope.json` under `<runDir>/workers/<label>/`, and `meterOf` (`:441-451`) sums
`modelUsage[model].outputTokens` — the same sum this reader takes (never the envelope's
`usage`, which is the last call only). The transcript reader `readRunConfigTokens`
(`fleet/shim-main.mjs:245-268`, over `<runDir>/claude/projects/**/*.jsonl`, dedup by
`message.id` in `sumTranscriptOutputTokens` `:199-224`) stays as the fallback and is pinned
by `fleet/tests/test_shim_main_gate.mjs:315-355` — do not change it. `main()` builds the
default reader at `:833` from `oneDriverConfigDir` (`:832`); the run dir is one level up.
The `#209` sentinel (`:942-960`) keys off `readTokensSources`, which is `null` for one-driver
runs; leave it. `fleet/tests/test_shim_main_tokens.mjs` shows the harness for driving
`main()` with a stub `invokeRun` against an orchestrator on a free port. Task 7 edits
`invokeEngineRun` and the assignment read in this file; own the readers and the `:833`
default only.

**Proof:**
- Test: `fleet/tests/test_shim_main_envelope_tokens.mjs`
- Legs: (a) a temp run dir with three `workers/<label>/envelope.json` files whose `modelUsage` spans two models each sums every model's `outputTokens` to the expected total with `files: 3`; (b) an envelope with no `modelUsage`, and one that is not JSON, count as files but add 0, and `usage.output_tokens` on an envelope is ignored; (c) an empty or absent `workers/` gives `{ total: null, files: 0 }`; (d) a `main()` run through the shim harness whose stub `invokeRun` writes both envelopes summing to 1,000 and transcripts summing to 900 stamps `reportedTokens: 1000`; (e) the same with no envelopes stamps 900; (f) the test's docstring carries the run-47 figures (239,564 transcripts dedup / 239,695 envelopes) as the live equality it stands in for.

**Stale-if:**
- issue-closed: #209
