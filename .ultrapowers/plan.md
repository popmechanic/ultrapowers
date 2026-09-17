# The reviewer is handed its task text inline, and its role file says which instruments it has

**Grammar:** claims-v1

**Claim:** Hand the reviewer its task body inline — the `inlineBody` branch — as the implementer already gets it. (quoted from #1100)
**Summary:** Every review on the record opened by asking the reviewer to fetch its own task text from a JSON file, which it tried to do with a program the sandbox refuses, wasting one to three turns per review. This plan hands the reviewer its task text directly, the way the implementer already gets it, and tells the reviewer in one sentence which instruments it has. Reviews start on the code instead of on a denial, saving about a tenth of a dollar and half a minute per review across every run.

**Goal:** Issue #1100, both halves of its fix: the engine reads every task's body out of the launch file once, at argument time, so `taskBodyBlock` renders `TASK:` followed by the body text for every worker of every task — reviewer, fix round, implementer and examiner alike — and the pointer sentence that sent a referee to a JSON file is gone from the engine; and `fleet/roles/reviewer.md` gains one sentence saying the referee has no shell that runs a program. The reading owed after five runs, and not asserted by any exam of this plan: denied Bash turns per review, read off the transcripts on the evidence tags the way the 2026-09-16 census read them, expected `0` against a median of `1` and a p90 of `2` at BASE (n=502 reviews, runs 1–170, both targets).
**Closes:** #1100

**Tech Stack:** Node ESM (`fleet/run-engine.mjs`, the engine sims under `fleet/tests/test_run_engine_*.mjs` bridged by `tests/test_fleet_suite.py`, the rig in `fleet/tests/_engine_helpers.mjs`), the role prompts under `fleet/roles/`, Python 3 only as the pytest bridge.

**Spec:** none — issue #1100 is the signed input, restated in each task's Context.

**Parallelization rationale:** one wave of width 2. Task 1 owns the engine, the two comment carriers that say bodies cannot be inlined, and the guarded exam; Task 2 owns the reviewer's role file. The Files sets are disjoint, neither task consumes a symbol the other produces, and neither needs the other's runtime behaviour — Task 1's exam slices the role text off the front of each review prompt by reading `fleet/roles/reviewer.md` at run time, so it is indifferent to the sentence Task 2 adds. No chain.

## Global Constraints

- Check: node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/implementer.md fleet/roles/examiner.md fleet/roles/fix.md fleet/roles/resolver.md fleet/roles/reconcile.md fleet/roles/README.md
- Check: git diff --quiet $ULTRA_BASE -- skills/
- `args.wavesPath` is still accepted and still recorded: the launch file at that path is still written by the compiler, `waveContendingBlock` still names it to the resolver exactly as at BASE, and no argument key is added to or removed from `args.json`.
- No new event kind is appended to `events.jsonl`, and nothing under `skills/` changes — the compiler's `--emit-launch`/`--emit-args` split is untouched.
- Findings are about the result — what the prompts, the sims and the role file now carry — never about the order the work was done in, the number of commits, or whether a test was written before its code.

### Task 1: The engine reads each task's body from the launch file once and hands it inline to every worker

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-worker.mjs`
- Modify: `fleet/run-main.mjs`
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`

**Claim:** do: launch a plan whose task bodies ride the launch file, as every launch does; see: each of a task's four workers — its implementer, its examiner, its fix round and, first among them, its reviewer — is handed `TASK:` followed by the task's own text, and none of those four is told to go and read that text out of a JSON file; the resolver's brief over a conflicted wave is not one of the four and still names the file exactly as it did. (derived)
Machine: M1. For a task whose `args.waves` entry carries no `body` and whose text lives under `tasks[].body` in the JSON file at `args.wavesPath`, each of the four prompts the engine dispatches for that task — labels `impl:<id>`, `exam:<id>`, `fix:<id>:0` and `review:<id>:1` — contains the string `\nTASK:\n` immediately followed by that task's `body` string from the file, byte for byte.
M2. No prompt the engine dispatches contains the phrase `read your verbatim task text from the JSON file`, and `fleet/run-engine.mjs` contains no line carrying the phrase `read your verbatim task text`.
M3. A task whose `body` is inline in its `args.waves` entry, with no `args.wavesPath` given, is dispatched with the same `\nTASK:\n` followed by that body in its implementer and reviewer prompts — the shape every engine sim at BASE already drives.
M4. When `args.wavesPath` names a file whose `tasks` array carries no entry for a task and that task's `args.waves` entry carries no `body`, `runEngine` rejects before any worker is dispatched, with an error message naming the task id and the path.
M5. `waveContendingBlock({ waveTasks, wavesPath, receipts })` renders exactly as at BASE: the resolver brief sim prints `ALL TESTS PASSED` on the patched tree.

**Authorized-by:** #1100 (Fix, items 1 and 3)

**Interfaces:**
- Consumes: none
- Produces: none — `runEngine({ args, agent, … })` keeps its signature; the change is what `taskBodyBlock` renders

**Context:** At BASE `taskBodyBlock(task, wavesPath)` at `fleet/run-engine.mjs:1162-1172` has two branches, and in production only the pointer branch ever fires, for every role: the compiler's `--emit-args` payload (`compile_plan.py`, `launch_waves`, around line 3312) is LIGHT — `{id, title, files, depends_on, interfaces, tier, review, …}` with no `body` — while the bodies are written only to the `--emit-launch` file, which `ultra_run.py` puts at `<runDir>/launch.json` (its lines 336–337) and hands the engine as `args.wavesPath`. The engine never loads that file: the input check at 2277 lets a body-less task through when `args.wavesPath` is set, 2367 keeps the path, and the three call sites (3100 for the shared implementer/examiner inputs, 4044 for the fix round, 4287 for the reviewer) all pass the path down. So "as the implementer already gets it" is true only in the sims, which put `body` inline; on the fleet the implementer gets the pointer too and reads the file with `python3` under `bypassPermissions`, which is why only the reviewer (`dontAsk`, read-only Bash: `fleet/run-worker.mjs:50-80`, `python3`/`node` refused) paid for it. The fix is at the load: directly after `wavesPath` is computed (2367), read the file once with `JSON.parse(fs.readFileSync(wavesPath, 'utf8'))`, index its `tasks` by `id`, and for every task in `WAVES` whose `body` is not a non-empty string set `task.body` from that index. A task still without a body after that is malformed — throw `run-engine: task <id> has no body: not inline in args.waves and not in <wavesPath>` from the same place the 2277 check throws, before any dispatch. Then `taskBodyBlock` needs only its inline branch, and the pointer branch — the text `read your verbatim task text from the JSON file at …` — is deleted rather than kept as a fallback, so the phrase cannot reach a prompt by any path; a source comment that quotes the phrase would fail this task's own `Run:` line, so the engine's comment says what changed without quoting it. `wavesPath` itself stays: it is still the resolver's pointer in `waveContendingBlock` (1543–1549, pinned by `fleet/tests/test_resolver_brief.mjs` legs at 605 and 629), still an `args.json` key on the record, and still what the `--add-dir` scope in `run-main.mjs:makeAddDirsFor` reasons about; none of that changes. Two comment carriers say the opposite of this task and are in its Files for that reason only: `fleet/run-worker.mjs:88-91` ("Bodies CANNOT be inlined instead … task bodies ride the launch file by design and never the prompt") and `fleet/run-main.mjs:490-494` ("the two things its prompt tells it to read — `wavesPath` …"); each becomes a sentence saying the engine reads the launch file once and hands the body inline since #1100, and that the `--add-dir` grant stays for `patches/`. The guarded exam extends `fleet/tests/test_run_engine_own_proofs.mjs`, the sim that owns what each role's prompt carries, under a section marker naming this task, the way its `── Task 3 (2026-09-17) ──` marker already does: S1 of that file is the scenario shape to copy — one task with `proofTests: ['t1_test.sh']`, a `testCmd`, and two `proofRuns` of which the second is red on the implementer's tree and green once the fix round has written its file, so one run records `impl:T1`, `exam:T1`, `fix:T1:0` and `review:T1:1`; the rig's `extraArgs` is how `wavesPath` reaches `runEngine`, and the launch file is written under the sim's own temp root with `tasks: [{ id, body: BODY, … }]` and the task's `mkTask` entry given `body: undefined`. `runEngine` is async, so M4 is `await assert.rejects(run(), /T1/)` on a launch file whose `tasks` names another id, with the recorded labels empty. Every prompt assertion reads the string `'\nTASK:\n' + BODY` as a substring, and M2's reads `includes('read your verbatim task text from the JSON file')` as false on every captured prompt. The reading owed and not asserted here: denied Bash turns per review from the transcripts, expected `0`, read after 5 runs (n=502 reviews, runs 1–170 at BASE: median 1, p90 2, max 3).

**Proof:**
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`
- Guard: `fleet/tests/test_run_engine_own_proofs.mjs`
- Run: test "$(grep -c 'read your verbatim task text' fleet/run-engine.mjs)" = 0
- Run: node fleet/tests/test_resolver_brief.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) one run driven with a body-less task and a launch file at `wavesPath`: the four captured prompts `impl:T1`, `exam:T1`, `fix:T1:0` and `review:T1:1` each contain `'\nTASK:\n' + BODY`, asserted one label at a time, and the four labels are all recorded [M1]; (b) none of those four prompts, and none of the prompts of the inline-body run of the next leg, contains `read your verbatim task text from the JSON file` — asserted per prompt, naming the label that carried it — and the first `Run:` counts zero lines of `fleet/run-engine.mjs` carrying `read your verbatim task text` [M2]; (c) a second run with `body: BODY` inline and no `wavesPath`: its `impl:T2` and `review:T2:1` prompts each contain `'\nTASK:\n' + BODY` [M3]; (d) a third run whose launch file's `tasks` array holds only an entry for `T9` while the wave's body-less task is `T3`: `run()` rejects with an error whose message contains `T3` and the launch file's path, and the stub recorded no label at all [M4]; (e) the second `Run:` executes the resolver brief sim on the patched tree and finds its sentinel, which is the sim that pins the `wavesPath` sentence of `waveContendingBlock` [M5].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_own_proofs.mjs`
- issue-closed: #1100

### Task 2: The reviewer's role file says it has no shell that runs a program

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/roles/reviewer.md`

**Claim:** do: open the referee's role file; see: one sentence, up front, telling the referee it has no shell that runs a program and naming the instruments it does have, so a review starts on the diff and not on a refused command. (derived)
Machine: M1. In `fleet/roles/reviewer.md`, the text before the first numbered rule (the line beginning `1. `) contains, in this order, the phrases `no shell that runs a program`, `python3`, `node`, `Read`, `Grep`, `Glob`, `cat`, `wc`.
M2. The file still begins with the line `You are a referee: your job is to check that this submission establishes its claim by the stated exam, and to help it get there.`, contains no `FACTS`, and the amendment-lens sim, which pins its numbered rules, prints `ALL TESTS PASSED` on the patched tree.
M3. The file's word count is reported: `wc -w fleet/roles/reviewer.md` runs and prints it.

**Authorized-by:** #1100 (Fix, item 2)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The referee runs under `dontAsk` with the allowlist `Read`, `Grep`, `Glob`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(git status *)` (`fleet/run-worker.mjs`, `ROLES.reviewer`); read-only Bash such as `cat` and `wc` passes as a class, and running a program — `python3 -c …`, `node -e …`, `pytest` — is refused (`fleet/run-worker.mjs:50-80`, measured 2026-08-31 with `probe_dontask_readonly_bash.mjs` and `probe_addcwd_scope.mjs`). At BASE the file is 133 lines and 1500 words; its second paragraph (lines 3–5) is "Your input is the task text and the driver-captured patch at PATCH — the implementer's complete change, diffed against BASE. Do not run git, read any implementer report, or modify anything; output only your verdict." The one sentence goes in or directly after that paragraph, before rule `1.` at line 7, in the file's own register — a clause the referee can act on, no shouted imperative — and says: the referee has no shell that runs a program, so a `python3` or `node` call is refused; `Read`, `Grep`, `Glob` and read-only `cat`/`wc` are its instruments. Nothing else in the file changes: `fleet/tests/test_run_engine_amendment_lens.mjs` slices the file's full text off the front of every review prompt and pins six rows of the numbered rules (its M3), and `fleet/tests/test_resolver_brief.mjs` T5 (e) pins that the file contains no `FACTS`. The word count is a reported sensor (CLAUDE.md, Judgment prompts are data files): the third `Run:` prints it and gates nothing.

**Proof:**
- Run: sed -n '1,/^1\. /p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'no shell that runs a program.*python3.*node.*Read.*Grep.*Glob.*cat.*wc'
- Run: test "$(head -1 fleet/roles/reviewer.md)" = "You are a referee: your job is to check that this submission establishes its claim by the stated exam, and to help it get there."
- Run: test "$(grep -c FACTS fleet/roles/reviewer.md)" = 0
- Run: node fleet/tests/test_run_engine_amendment_lens.mjs | grep -q 'ALL TESTS PASSED'
- Run: wc -w fleet/roles/reviewer.md
- Legs: (a) the first `Run:` joins the lines from the top of the file to the first `1. ` rule into one line and finds the eight phrases in the order M1 lists them, failing when any is absent or out of order or sits only below the rules [M1]; (b) the second `Run:` pins the first line verbatim, the third counts zero `FACTS`, and the fourth executes the amendment-lens sim, whose precondition is that every review prompt opens with this file verbatim and whose legs (f) and (h)–(l) grep the numbered rules, on the patched tree [M2]; (c) the fifth `Run:` prints the word count as evidence the reviewer reads, exit 0 [M3].

**Stale-if:**
- path-absent: `fleet/roles/reviewer.md`
- issue-closed: #1100
