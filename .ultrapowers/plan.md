# The worker is a kata actor — notes, attention and needs-review on the task's own issue, never a won't-fix for a task that merely failed (#810 Phase A)

**Grammar:** claims-v1

**Claim:** do: launch a plan on the merged engine and open a task's issue on the hub while it runs. see: the worker's own notes and its stuck or needs-human signal on the issue as it works, the reviewer's findings on the issue before the fix round starts, and a task that failed left open for me with needs-review, never closed as won't-fix. (elicited)
**Summary:** This puts the worker on the tracker the way the tracker's author meant: each task's implementer speaks for itself on its own issue instead of the driver narrating on its behalf. It exists because today the hub is a log with a claim stamp — every line is the driver's, a stuck worker is discovered only when its fix rounds run out, and a task that failed is closed as if we had decided not to do it. After this run the operator opens an issue and reads what the worker was trying, sees it raise its hand the moment it is stuck, finds the review's findings where the fix session will read them, and finds failed work waiting for a person rather than buried; the next sitting's reading says how much of a run's wall is spent waiting at wave barriers, which decides whether the pool is worth building.

**Goal:** #810 Phase A as re-chartered 2026-09-13 (the comment of that date is the design; kata's own recipe is https://katatracker.com/docs/operations/agent-orchestration/ and its agent contract https://katatracker.com/docs/workflows/agents/): the sandbox carries the kata binary; every worker session runs with `KATA_SERVER`, a placeholder `KATA_AUTH_TOKEN` (the edge injects the real bearer), `KATA_AUTHOR=<label>@run-<N>` and `KATA_REF=<project>#<short_id>`; the write roles' settings carry kata's SessionStart/SessionEnd attention hooks; the implementer, fix and examiner roles are taught the four moves they own (comment notes, raise `stuck`/`needs-human`, label `needs-review`, never close); the driver polls the task issue's `work.attention` while a worker runs and records it as `driver:attention`, posts the reviewer's blocking findings as a comment before each fix round, and stops closing failed or unattempted tasks as `wontfix` (they stay open with `needs-review` and `work.attention=needs-human`); the boot's per-task status cells gain `attention`; `fleet/CONTRACT.md`'s two contradictory 412 sentences become one; and `evals/barrier_slack.py` lands with the pre-registered reading for Phase C (share of engine wall a task spends waiting for its wave to close, over the tags `ultra/evidence/run-70` … `run-112`; ≥ 20 % funds #813's sim). No scheduler change: waves, the fold, adoption and the run issue's close at publish are untouched.

**Tech Stack:** Node 24 ESM (`fleet/*.mjs`, sims under `fleet/tests/`), bash (`fleet/sandbox-boot.sh`, its python projection block), Python 3 (`evals/`, pytest under `tests/`), Markdown (`fleet/roles/*.md`, `fleet/CONTRACT.md`), kata v0.17.2 (the CLI on the sandbox, the daemon on the hub).

**Exam command:** node {paths}

**Spec:** the #810 comment of 2026-09-13; kata's agent-orchestration and agent-workflow pages (facts a worker needs are copied into Context; a sandbox reaches neither).

**Parallelization rationale:** one wave, six wide — tasks 1 (the binary on the sandbox), 2 (the worker's env and hooks), 3 (the roles), 4 (the driver reads attention and posts the review), 5 (close discipline and the contract), 6 (the barrier-slack reading). No task consumes another's runtime behaviour: the env variable names, the hook commands, the `driver:attention` event shape and the `needs-review` label are shared literals in every Context that touches them. Tasks 2, 4 and 5 all edit `fleet/run-engine.mjs` in different regions (dispatch env, the poll beside the worker call, the close sites) and tasks 1, 2 and 5 all edit `fleet/CONTRACT.md` in their own bullets; text folds. Each task's exam is its own file, named for its surface, so no two tasks append to one sim (rule 4's adjacent-insert shape).

## Global Constraints

- No worker ever holds a kata credential: the only `KATA_AUTH_TOKEN` a worker sees is the literal placeholder `edge-injects-the-bearer`, and no real token string is written anywhere under `fleet/`.
- Check: ! grep -rEn "KATA_AUTH_TOKEN=[A-Za-z0-9]{32,}" fleet/ skills/
- Workers never run git and the confine hook is untouched: the implementer's writable roots and its PreToolUse boundary are exactly what they are at BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/confine-hook.mjs fleet/run-worker.mjs
- The run issue's own close at publish (done with the PR, wontfix with the park reason, #940) is unchanged; nothing here edits `kata_close_run` in the boot.
- Check: test "$(git diff $ULTRA_BASE -- fleet/sandbox-boot.sh | grep -c '^[-+].*kata_close_run')" = 0
- Role files stay in their register: no line of `fleet/roles/*.md` is an all-caps imperative, and every kata command they teach names `$KATA_REF`, never a literal issue id.

### Task 1: The sandbox carries the kata binary

**Type:** implementation

**Files:**
- Modify: `fleet/setup-script.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_setup_script_kata.mjs`

**Claim:** Every sandbox can run the kata command from the moment its first boot finishes, installed the same verified way the hub was. (derived)
Machine: M1. The rendered setup script downloads `kata_0.17.2_linux_amd64.tar.gz` and `SHA256SUMS` from `https://github.com/kenn-io/kata/releases/download/v0.17.2/`, verifies the tarball with `sha256sum -c` against the line naming it, extracts the `kata` binary and installs it with `sudo -n install -m 0755 … /usr/local/bin/kata` — in that order, after the bun install and before the pytest install — and the script stays at or under 10240 bytes. M2. `fleet/CONTRACT.md`'s setup-script bullet lists kata 0.17.2 beside node, bun and pytest as what the script installs.

**Authorized-by:** #810 Phase A (2026-09-13); the hub's own install recipe `fleet/kata-hub-setup.sh` (lines 14–27)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `fleet/setup-script.mjs` renders the first-boot script as a template string (`renderSetupScript`); the bun install is the block around line 171 (`sudo -n install -m 0755 bun-linux-x64/bun /usr/local/bin/bun`) and pytest follows at ~176 (`sudo -n apt-get …`). Add the kata block between them, spelled like `fleet/kata-hub-setup.sh` lines 14–27: `KATA_VERSION=0.17.2`, `ASSET=kata_0.17.2_linux_amd64.tar.gz`, `BASE=https://github.com/kenn-io/kata/releases/download/v0.17.2/`, `curl -fsSL -o SHA256SUMS "${BASE}SHA256SUMS"`, `curl -fsSL -o "$ASSET" "${BASE}${ASSET}"`, `grep " $ASSET$" SHA256SUMS | sha256sum -c -`, `bin="$(tar -tzf "$ASSET" | grep -E '(^|/)kata$' | head -n 1)"`, `tar -xzf "$ASSET"`, `sudo -n install -m 0755 "$bin" /usr/local/bin/kata` (the release tarball holds one file, `kata`, measured 2026-09-12). The script runs as `exedev` with passwordless `sudo -n` (contract §Setup script); the budget is exe.dev's 10 KiB cap, checked by `fleet/tests/test_setup_script.mjs` — read that sim first: it renders the script into a temp dir with `_helpers.mjs` and pins the node and bun lines (its constants at ~51–54, its stub layout at ~155). Your sim is a sibling file that renders the same way and asserts the kata lines and their order; do not edit `test_setup_script.mjs`. The contract bullet is the one beginning `- **Setup script (generated by \`fleet/setup-script.mjs\`` (~line 195); its duties list names the toolchain — add kata there.

**Proof:**
- Test: `fleet/tests/test_setup_script_kata.mjs`
- Guard: `fleet/tests/test_setup_script_kata.mjs`
- Legs: (a) the rendered script contains the six kata lines of M1 verbatim (the two curl lines, the `sha256sum -c` line, the `tar -tzf … grep -E '(^|/)kata$'` line that finds the binary's path, the `tar -xzf "$ASSET"` line that extracts it, the `install -m 0755 … /usr/local/bin/kata` line), their byte offsets strictly increasing in that order — both curls before the checksum, the checksum before the extract, the extract before the install — and the install line's offset greater than that of `/usr/local/bin/bun` and less than that of `python3-pytest` (the one apt line that installs pytest); a script that installs before verifying, or before bun, fails [M1]; (b) the rendered script's byte length is at most 10240 [M1]; (c) the `Run:` below: the setup-script bullet of `fleet/CONTRACT.md`, cut from its `- **Setup script` line to the next `- **` bullet and joined, matches `kata 0\.17\.2` [M2].
- Run: sed -n '/^- \*\*Setup script/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'kata 0\.17\.2'
- Run: bash -n fleet/kata-hub-setup.sh

**Stale-if:**
- path-exists: `fleet/setup-script.mjs`
- path-exists: `fleet/kata-hub-setup.sh`

### Task 2: Every worker session is a kata actor with its issue in hand

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/run-worker.mjs`
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_worker_kata_env.mjs`

**Claim:** A worker knows which issue it is working and speaks as itself: its session carries the hub's address, its own actor name and its task's issue reference, and its start and end are stamped on the issue without the worker remembering to do it. (derived)
Machine: M1. With a kata record, the env of every worker process carries `KATA_SERVER=https://kata.int.exe.xyz`, `KATA_AUTH_TOKEN=edge-injects-the-bearer`, `KATA_AUTHOR=<label>@run-<N>` (the worker's label as the engine spells it, e.g. `impl:3@run-114`, `review:3:1:2@run-114`) and, for a worker whose label names a task the record knows, `KATA_REF=<project name>#<short_id>` of that task's issue; a worker whose label names no task (`integration`, the critic) carries no `KATA_REF`; without a kata record none of the four is set. M2. With a kata record, the settings file handed to the write roles (implementer, writeSide, examiner) carries, beside the PreToolUse confine hook, a `SessionStart` hook running `kata attention-hook start` and a `SessionEnd` hook running `kata attention-hook end`; the PreToolUse entry is byte-identical to BASE's; without a kata record the file is byte-identical to BASE's. M3. The `short_id` of each task issue is read once at dispatch from the same `getIssue` answer that checks the sheet's revision, and stored on the task's kata row; no second hub read is made for it. M4. `fleet/CONTRACT.md`'s kata record (engine) bullet names the four variables and the two hooks.

**Authorized-by:** #810 Phase A (2026-09-13); kata's agent contract (`KATA_AUTHOR`, `KATA_REF`, `attention-hook start|end`, measured on the hub 2026-09-13)

**Interfaces:**
- Consumes: none
- Produces: `envFor(opts) -> Record<string,string>`

**Context:** Measured 2026-09-13 from a fleet-tagged VM: `KATA_SERVER=https://kata.int.exe.xyz KATA_AUTH_TOKEN=edge-injects-the-bearer KATA_AUTHOR=probe:x kata list --project <name> --agent` answers `OK list …` through the peer proxy — the edge replaces the `Authorization` header with the real bearer, so the placeholder is what the worker holds and it is worth nothing outside the fleet; `kata whoami --agent` answers `actor=probe:x source=env`; `kata attention-hook start` with `KATA_REF` unset exits 0 doing nothing (kata's own documented behaviour). The kata CLI resolves a project-qualified reference `<project>#<short_id>` without a workspace binding (its docs: "an explicit `--project` or qualified issue reference"). The plumbing: `fleet/run-main.mjs` builds `workerEnv` at ~709 (`{ ...env, CLAUDE_CONFIG_DIR, FLEET_RUN_DIR, DISABLE_AUTOUPDATER }`) and hands `makeAgent` a `filesFor(opts)` seam at ~727–738 — add `envFor(opts)` beside it, the same shape (read at call time from the task objects, sheet first), returning the four kata variables for the worker whose `opts.label` is given, and `makeAgent`/`run-worker.mjs`'s `childEnvFor(env, prompt)` (~851) merges that object last so a per-worker value wins. The task→issue map lives in the engine: `kataRecord.tasks[id] = {uid, revision}` (from `.ultrapowers/kata.json`; `kataRecord.project.name` is the project) and the dispatch read at ~1636–1653 (`kataCall('getissue', …)`) already returns the issue — its `short_id` is in that answer (the client's `MUTATION_KEYS` at `kata-client.mjs:158` keeps it); store it as `row.shortId` and let `envFor` read it. The label→task rule is `kataUidFor`'s (#943): second colon-segment of `impl:3`, `exam:3`, `fix:3:0`, `review:3:1:2`; `integration` and `reconcile:*` are the run's. The settings file is written once by `writeConfineSettings({runDir, hookPath})` in `fleet/run-main.mjs` ~391–404 and handed to the three write roles; give it a `kataOn` argument and, when true, add `SessionStart: [{hooks: [{type: 'command', command: 'kata attention-hook start'}]}]` and `SessionEnd: [{hooks: [{type: 'command', command: 'kata attention-hook end'}]}]` — the Claude Code hook schema is the one the PreToolUse entry already uses. The CLI is `kata` on PATH (task 1 installs it; the sim needs no binary). `fleet/tests/test_run_worker.mjs` and `test_run_main_effort.mjs` show the rigs for `makeAgent` and `run-main`; write the new sim beside them, never editing them. The contract bullet is `- **Kata record (engine):**` (~line 377).

**Proof:**
- Test: `fleet/tests/test_worker_kata_env.mjs`
- Guard: `fleet/tests/test_worker_kata_env.mjs`
- Legs: (a) with a kata record naming project `p` and tasks `3` (short_id `ab12`) and `4`, `envFor({label: 'impl:3'})` returns exactly the four variables with `KATA_AUTHOR` `impl:3@run-<N>` and `KATA_REF` `p#ab12`; `envFor({label: 'review:3:1:2'})` the same `KATA_REF`; `envFor({label: 'integration'})` three variables and no `KATA_REF`; and the spawned child's env (through `childEnvFor`) carries them; with no kata record `envFor` returns `{}` and the child env has none of the four [M1]; (b) `writeConfineSettings({…, kataOn: true})` writes a file whose `hooks.PreToolUse` deep-equals BASE's and whose `hooks.SessionStart[0].hooks[0].command` is `kata attention-hook start` and `hooks.SessionEnd[0].hooks[0].command` is `kata attention-hook end`; with `kataOn: false` and `hookPath` `/x/confine-hook.mjs` the file's `git hash-object` is the frozen pre-edit literal `19d85fde0477d667538d9a6ac213560fe0736e3a` (BASE's file for that hookPath, computed 2026-09-13) [M2]; (c) the engine sim's kata stub counts exactly one `getIssue` per task through dispatch, its answer carrying `short_id`, and the row the engine keeps afterwards has `shortId` equal to it [M3]; (d) the `Run:` below matches the contract bullet [M4].
- Run: sed -n '/^- \*\*Kata record (engine)/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'KATA_SERVER.*KATA_AUTH_TOKEN.*KATA_AUTHOR.*KATA_REF.*attention-hook start.*attention-hook end'
- Run: node fleet/tests/test_run_worker.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_kata.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-exists: `fleet/run-main.mjs`
- path-exists: `fleet/kata-client.mjs`

### Task 3: The roles teach the four moves a worker owns

**Type:** implementation

**Files:**
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/roles/examiner.md`
- Test: `fleet/tests/test_roles_kata.mjs`

**Claim:** A worker that reads its role knows to leave its notes on the issue, to raise its hand when stuck, to mark work it could not finish for review, and never to close anything. (derived)
Machine: M1. Each of `fleet/roles/implementer.md`, `fleet/roles/fix.md` and `fleet/roles/examiner.md` contains a section headed `## The issue` that names, each in a fenced or backticked command using the literal `$KATA_REF`: `kata comment $KATA_REF --body` (notes: the intended approach before a long task, a partial attempt before stopping, the decision a later session needs), `kata meta set $KATA_REF work.attention stuck` and `kata meta set $KATA_REF work.attention needs-human` with `kata meta set $KATA_REF work.attention_msg` (raised mid-session, with one line saying why; cleared with `work.attention ok` when unblocked), and `kata label add $KATA_REF needs-review` (when stopping short of the task, beside an honest comment). M2. The same section says the worker never runs `kata close`, and that a missing `KATA_REF` means no kata at all (every command is skipped, nothing else changes). M3. No line of the three files is an all-caps imperative (no line matches `^[A-Z][A-Z ,.'!-]{11,}$`), and the three files together grow by at most 900 words.

**Authorized-by:** #810 Phase A (2026-09-13); kata's agent contract (comment, `work.attention`, `needs-review`, close only when verified); the role-file pin of #496 (stylistic only)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The roles are plain files read at dispatch by `fleet/run-engine.mjs` (`roles.implementer`, `roles.fix`, `roles.examiner`); their register is the second person, plain sentences, and #496 left one stylistic pin — no shouted imperatives — checked by `fleet/tests/test_roles_peer.mjs` (read it to see how the role files are loaded and grepped; write a sibling sim, do not edit it). Word counts today: `wc -w fleet/roles/*.md` totals 4187; keep the addition under 900 across the three. The worker's shell has the kata CLI on PATH with its env set by the driver (task 2's literals: `KATA_SERVER`, `KATA_AUTH_TOKEN`, `KATA_AUTHOR`, `KATA_REF`); an implementer's Bash is confined for writes by path, and a kata command writes no path, so it runs. The examiner writes the exam and can note a leg it could not make satisfiable the same way (`needs-human` with a message) — that is the exam seam of #925 said on the issue as well as in its reply. Say in each section that the driver posts the review's findings on the issue before a fix round (task 4's behaviour, a shared literal here: a comment beginning `review round <n>:`), so the fix role's first move is `kata show $KATA_REF --agent`. The reviewer and critic roles run read-only and are not taught these moves. The message floor: a comment has no minimum; a close does, and the worker never closes.

**Proof:**
- Test: `fleet/tests/test_roles_kata.mjs`
- Guard: `fleet/tests/test_roles_kata.mjs`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) for each of the three files, the text from the line `## The issue` to the next `## ` heading (or end of file) contains each of the five literals `kata comment $KATA_REF --body`, `kata meta set $KATA_REF work.attention stuck`, `kata meta set $KATA_REF work.attention needs-human`, `kata meta set $KATA_REF work.attention_msg`, `kata label add $KATA_REF needs-review` — one assertion per file per literal, so a file missing any one fails [M1]; (b) the same section of each file contains `never` within six words of `kata close` and names `KATA_REF` as the condition under which the commands are skipped [M2]; (c) no line of the three files matches `^[A-Z][A-Z ,.'!-]{11,}$`, and the sum of their word counts minus the sum at BASE (read with `git show $ULTRA_BASE:<path>` in the `Run:` below, since a committed sim never reads BASE) is at most 900 [M3].
- Run: test "$(( $(cat fleet/roles/implementer.md fleet/roles/fix.md fleet/roles/examiner.md | wc -w) - $( (git show $ULTRA_BASE:fleet/roles/implementer.md; git show $ULTRA_BASE:fleet/roles/fix.md; git show $ULTRA_BASE:fleet/roles/examiner.md) | wc -w) ))" -le 900
- Run: node fleet/tests/test_roles_kata.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-exists: `fleet/roles/implementer.md`
- path-exists: `fleet/tests/test_roles_peer.mjs`

### Task 4: The driver reads the worker's hand and posts the review where the fix will look

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_run_engine_attention.mjs`

**Claim:** While a worker runs, the run's record shows the moment it raised its hand and what it said; and before a fix round starts, the review's findings are on the issue. (derived)
Machine: M1. While a task's worker runs, the engine polls that task's issue metadata every `ATTENTION_POLL_MS` (default 15000, an engine option) and, on each change of `work.attention` to `stuck` or `needs-human` or back to `ok`, appends one `driver:attention` event `{task, attention, msg, actor}` with `msg` from `work.attention_msg` and `actor` from the metadata event's actor when the client exposes it (else `''`); an unchanged value appends nothing; a hub read that fails appends nothing and does not end the run. M2. Before each fix round's worker is dispatched, the engine posts one comment on the task's issue whose body begins `review round <n>:` followed by the blocking findings the fix prompt carries, one per line, through the non-fatal write path (#934); a refused post is one `kata:write-failed` and the fix round still runs. M3. `sandbox-boot.sh`'s status projection writes, per task cell, `attention: {value, msg, ts}` from that task's latest `driver:attention` event (`null` when none), beside `state`, `role`, `lastProof` and `park`. M4. `fleet/CONTRACT.md`'s status-cell sentence names the `attention` cell and the kata bullet names the `driver:attention` event and the `review round <n>:` comment.

**Authorized-by:** #810 Phase A (2026-09-13); kata's orchestration recipe (the coordinator reads `work.attention`, never writes it; a dashboard sees `issue.metadata_updated` diffs); #877 (per-task cells)

**Interfaces:**
- Consumes: none
- Produces: `driver:attention`

**Context:** The engine's kata surface is `fleet/kata-client.mjs` (13 methods; `getIssue(uid)` returns the issue with `metadata`, `revision`, `short_id`); `kataCall(what, uid, thunk)` (~1049) records a refused write as `kata:write-failed` and answers `null`; the comment chain `kataPost` (#943) is the write path for M2. The worker call sites: implementer at ~1932 (`agent(roles.implementer + …, {label: 'impl:' + task.id, …})`), fix rounds at ~2299 and ~2588 (`label: 'fix:' + task.id + ':' + iter`), review at ~2393; `agent()` resolves when the worker exits, so the poll is a timer started before each `await agent(…)` for a task with a kata row and cleared in a `finally` — one timer per worker, never two for one task; `ATTENTION_POLL_MS` is an `args` option so the sim sets it to 50. The metadata keys are kata's `work.attention` (`ok | needs-human | stuck`) and `work.attention_msg`, last-write-wins; the engine only reads them (the coordinator role). The fix prompt's blocking list is built at ~2299 (`'\n\nBlocking issues to resolve:\n' + reds.map(r => '- ' + r.line …)`) and at ~2588 (`blocking.map(b => b.detail)`) — post the same lines, `review round 0:` for the pre-review repair round and `review round <iter>:` for the reviewer rounds, before the `agent(roles.fix …)` call. The boot's projection is the python block in `fleet/sandbox-boot.sh` ~471–495 (`"lastProof": proof.get(tid), "park": park.get(tid)`), pinned by `fleet/tests/test_sandbox_boot_viz.mjs` — read that sim's rig (it feeds an `events.jsonl` and reads `status.json`); add the `attention` cell there and its leg in your own sim using the same rig helpers from `_sandbox_boot_helpers.mjs`. The engine sim rig is `fleet/tests/test_run_engine_kata.mjs` (a stub kata client whose calls are recorded; the worker seam is a script) — write your sim beside it with the same helpers, never editing it. The contract sentences: the per-task cells are described in the evidence-branch section (grep `lastProof` in `fleet/CONTRACT.md`), the kata bullet is `- **Kata record (engine):**`.

**Proof:**
- Test: `fleet/tests/test_run_engine_attention.mjs`
- Guard: `fleet/tests/test_run_engine_attention.mjs`
- Legs: (a) with `ATTENTION_POLL_MS` 50 and a stub issue whose metadata the sim flips `ok → stuck (msg "no async API") → needs-human → ok` while a 400 ms worker script runs, the event log carries exactly three `driver:attention` events for that task, in that order, with the messages, each with `actor` equal to the actor the stub's metadata answer exposes (`impl:1@run-x`) and, in a second pass whose stub exposes no actor, `actor` `''`; and none while the value is unchanged; the stub answering an error on one poll appends nothing and the task still completes; a task with no kata row is never polled (zero `getIssue` calls during its worker) [M1]; (b) a task whose pre-review pass is red posts exactly one comment beginning `review round 0:` carrying each red line before the fix worker's `worker:start`, and a task sent to review round 1 with two blocking findings posts one `review round 1:` comment carrying both before that fix worker starts; with the stub refusing the post, one `kata:write-failed` is appended and the fix worker still starts [M2]; (c) the boot rig fed an `events.jsonl` with two `driver:attention` events for task 2 (`stuck` then `ok`) and none for task 1 writes `tasks["2"].attention` `{value: "ok", msg: …, ts: …}` and `tasks["1"].attention` `null` [M3]; (d) the two `Run:` lines below [M4].
- Run: sed -n '/^- \*\*Kata record (engine)/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'driver:attention.*review round'
- Run: grep -c '"attention"' fleet/CONTRACT.md | xargs test 1 -le
- Run: node fleet/tests/test_sandbox_boot_viz.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_kata.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-exists: `fleet/run-engine.mjs`
- path-exists: `fleet/tests/test_sandbox_boot_viz.mjs`

### Task 5: A task that failed waits for a person; only a decision is a won't-fix

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/kata-client.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_run_engine_kata_close.mjs`

**Claim:** A task the run could not finish is left open on the hub, marked for review with the reason on it, and only a task adopted into the tree is ever closed. (derived)
Machine: M1. At the end of a run, a task whose result is not `done` — failed, blocked, skipped, never attempted — is not closed: the engine adds the label `needs-review` to its issue, sets `work.attention` to `needs-human` and `work.attention_msg` to `<status>: <reviewVerdict>` (the first 200 characters), and posts one comment carrying the result's notes; a task in a wave the barrier could not make green is treated the same; every such write goes through the non-fatal path (#934). M2. A task adopted into the tree is closed `done` exactly as at BASE (message, title, merge sha, evidence). M3. `kata-client.mjs` gains `addLabel(projectId, uid, label)` posting to `/api/v1/projects/<id>/issues/<uid>/labels` and the engine uses it; no other method changes. M4. `fleet/CONTRACT.md` says a failed task stays open with `needs-review` and `needs-human`, that `wontfix` is reserved for the run issue's park (#940) and for a person's decision — every line of the file that contains `wontfix` also contains `run issue`, `#940` or `a person` — and carries exactly one sentence on what a 412 on `touched_files` does — recorded as `kata:write-failed`, the run goes on — with the contradicting sentence (~line 439, "a 412 there ends the run as a mismatch does") gone.

**Authorized-by:** #810 Phase A (2026-09-13); kata's close discipline ("Incomplete work gets a needs-review label and an honest comment instead of a close"; `audit closes`); lens-2 finding on the contract's 412 drift

**Interfaces:**
- Consumes: none
- Produces: `addLabel(projectId, uid, label)`

**Context:** The close sites in `fleet/run-engine.mjs`: the wave-blocked loop at ~3216–3223 (`kataClose(id, {reason: 'wontfix', message: 'wave N blocked: …'})`) and the end-of-run sweep at ~3527–3538 (`for r of taskResults … if (!r || r.status === 'done') continue; kataClose(r.task, {reason: 'wontfix', …})`); the adoption close (`done`, ~3325) stays. Replace each `wontfix` with the three writes of M1 — `addLabel`, `patchMetadata(projectId, uid, {'work.attention': 'needs-human', 'work.attention_msg': …}, revision)` (the client's existing metadata call; kata's metadata is a merge-patch, so the two keys are one call), `comment` — each through `kataCall` so a refusal is one `kata:write-failed`; keep `kataClosed` as the once-guard so a task is marked at most once. Metadata keys are plain strings; `work.attention` values are exactly `ok`, `needs-human`, `stuck`. The labels endpoint (kata v0.17.2 OpenAPI, read on the hub 2026-09-13): `POST /api/v1/projects/{project_id}/issues/{ref}/labels` with a JSON body naming the label — read the request schema from the client's existing `link`/`comment` methods for the header and body conventions (`X-Kata-…`, `Idempotency-Key` where the others send one) and mirror them; `ref` accepts the issue uid. The sim rig is `fleet/tests/test_run_engine_kata.mjs` (stub client records every call; drive a two-task plan where one task fails its fix loop) — write your sim beside it, never editing it. The contract's kata bullets: `- **Kata record (engine):**` (~377) and the evidence-branch kata sentence (~252–256, the correct 412 rule) and ~433–439 (the wrong one).

**Proof:**
- Test: `fleet/tests/test_run_engine_kata_close.mjs`
- Guard: `fleet/tests/test_run_engine_kata_close.mjs`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) a two-task run where task 2 fails `fix-loop-exhausted`: the stub records for task 2 exactly one `addLabel` with `needs-review`, one metadata patch with `work.attention` `needs-human` and `work.attention_msg` beginning `failed: fix-loop-exhausted`, one comment carrying the notes, and zero `close` calls; a wave the barrier blocks marks both its tasks the same way and closes neither; with the stub refusing `addLabel`, one `kata:write-failed` with `what: 'label'` is appended and the metadata patch and comment still happen; with the stub refusing the metadata patch instead, one `kata:write-failed` with `what: 'metadata'` and the label and comment still happen; with the stub refusing the comment, one `kata:write-failed` with `what: 'comment'` and the label and patch still happen — and in each of the three the engine still returns its report (the run goes on); (a3) one row per remaining outcome: a task the engine skips because its wave-1 dependency failed (status `skipped`) gets the same three writes with `work.attention_msg` beginning `skipped:`; a task never attempted because the run died before its wave (absent from `taskResults`, present in the record) gets the same three writes with the message beginning `unattempted:`; a task the barrier's reconcile left `blocked` gets them with `blocked:` — and none of the three is closed; (a4) a failed task whose `reviewVerdict` is 300 characters long stores a `work.attention_msg` of exactly 200 characters, equal to the first 200 of `failed: <verdict>` [M1]; (a2) in the same run task 1 is closed `done` with the same message shape and evidence as at BASE — exactly one `close` call, reason `done`, evidence carrying the merge sha — and a run where every task is done makes zero `addLabel` calls [M2]; (b) `addLabel` issues `POST /api/v1/projects/<id>/issues/<uid>/labels` with a body naming the label and the same headers the `comment` method sends, and `Object.keys(makeKataClient(...))` at HEAD equals BASE's set plus `addLabel` [M3]; (c) the `Run:` lines below: the contract matches `needs-review.*needs-human` in the kata bullet, every `wontfix` line also says `run issue`, `#940` or `a person` and at least one such line names `a person` and one names `#940` (so the rule is not satisfied by deleting the word), exactly one line contains `412` and that line says `kata:write-failed`, and the sentence `a 412 there ends the run` is gone [M4].
- Run: sed -n '/^- \*\*Kata record (engine)/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'needs-review.*needs-human'
- Run: test "$(grep -c '412' fleet/CONTRACT.md)" = 1
- Run: grep '412' fleet/CONTRACT.md | grep -q 'kata:write-failed'
- Run: ! grep -q 'a 412 there ends the run' fleet/CONTRACT.md
- Run: test "$(grep 'wontfix' fleet/CONTRACT.md | grep -v -c 'run issue\|#940\|a person')" = 0
- Run: grep 'wontfix' fleet/CONTRACT.md | grep -q 'a person'
- Run: grep 'wontfix' fleet/CONTRACT.md | grep -q '#940'
- Run: node fleet/tests/test_run_engine_kata.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_kata_client.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-exists: `fleet/kata-client.mjs`
- issue-open: #810

### Task 6: The barrier-slack reading — how long a finished task waits for its wave

**Type:** implementation

**Files:**
- Create: `evals/barrier_slack.py`
- Test: `tests/test_barrier_slack.py`

**Claim:** For every run on the record, the reading says what share of the engine's wall a finished task spent waiting for its wave to close — the number that decides whether the pool is worth building. (derived)
Machine: M1. `python3 evals/barrier_slack.py <events.jsonl>…` reads each file and, per task, computes `slack = ts(driver:wave-adopted whose tasks[] names it) − ts(last worker:end whose label's second colon-segment is the task)`, ignoring tasks with no adoption event; per file it prints one line `run=<id> tasks=<n> engine_wall_ms=<W> slack_sum_ms=<S> share=<S/W to 3 places> median_ms=<m> p90_ms=<p>` where `W = ts(last driver:wave-adopted) − ts(first worker:start)` and p90 is the value at index `ceil(0.9·n) − 1` of the ascending slacks; and a final line `all: files=<k> share=<ΣS/ΣW to 3 places> median_ms=<m> p90_ms=<p>` over every task of every file. M2. `--tags 70-112` makes it read `git show ultra/evidence/run-<N>:.ultrapowers/runs/<N>/events.jsonl` for each N in the range, skipping a tag that is absent or carries no `events.jsonl`, and reports the skipped Ns on one `skipped:` line; it never fetches. M3. A file with no `driver:wave-adopted` prints its `run=` line with `tasks=0` and share `0.000` and is excluded from `all:`.

**Authorized-by:** #810 Phase A (2026-09-13), the pre-registered reading for Phase C (≥ 20 % funds #813's sim); lens-3 shape A

**Interfaces:**
- Consumes: none
- Produces: `evals/barrier_slack.py`

**Context:** The engine's event shapes, from run-112's tag (`.ultrapowers/runs/112/events.jsonl`): `{"kind":"worker:start","label":"impl:1","role":"implementer",…,"ts":<ms>}`, `{"kind":"worker:end","label":"review:1:1:2",…,"ts":<ms>}`, `{"kind":"driver:wave-adopted","wave":1,"tasks":["1"],"headSha":"…","ts":<ms>}`; labels are `impl:<task>`, `exam:<task>`, `fix:<task>:<n>`, `review:<task>:<round>:<k>`; `integration`, `reconcile:*` and the critic carry no task. `ts` is epoch milliseconds. A run may carry two `run:open` lines (the engine's and `publish-fold.mjs`'s) — ignore them. Tags exist on origin for runs 70–112 except those runs that died before an evidence commit; the sandbox's clone is a full clone, so `git show <tag>:<path>` works when the tag is fetched — the `Run:` below fetches tags first on its own line, and the script itself never runs `git fetch`. The pytest file drives the script on two fixtures written by the test into `tmp_path` with hand-computed numbers (`tests/` is the pytest root; `pytest.ini` scopes collection). Python 3.12, no third-party imports.

**Proof:**
- Test: `tests/test_barrier_slack.py`
- Guard: `tests/test_barrier_slack.py`
- Legs: (a) a fixture with two tasks: task 1's last `worker:end` at 100 000, task 2's at 130 000, one `driver:wave-adopted` naming both at 160 000, first `worker:start` at 10 000 → slacks 60 000 and 30 000, `engine_wall_ms=150000`, `slack_sum_ms=90000`, `share=0.600`, `median_ms=45000`, `p90_ms=60000` (n=2: index `ceil(1.8)−1` = 1 → 60 000) — each field asserted from the printed line [M1]; (b) a second fixture with one task whose two labels (`impl:1`, `review:1:1:1`) end at 50 000 and 80 000 and an adoption at 90 000 → slack 10 000 (the LAST end), and the `all:` line over both fixtures reads `files=2 share=0.…` computed from the sums (`100000 / (150000 + W2)`, W2 from the fixture's own first start), and that `all:` line carries `median_ms=30000 p90_ms=60000` over the three slacks (sorted 10 000, 30 000, 60 000; p90 index `ceil(2.7)−1` = 2); a script that uses the first `worker:end` fails; (b2) a third fixture with two waves — task 1's last `worker:end` at 100 000 adopted by a `driver:wave-adopted` naming only `["1"]` at 120 000, task 2's last `worker:end` at 130 000 adopted by a second one naming `["2"]` at 160 000 — answers slacks 20 000 and 30 000 (`slack_sum_ms=50000`, `median_ms=25000`), where pairing every task with the last adoption would answer 60 000 and 30 000; a task whose id appears in no adoption's `tasks[]` while a later adoption exists is ignored (`tasks=` counts only adopted tasks) [M1]; (c) `--tags 5-7` in a temporary git repo the test creates with a tag `ultra/evidence/run-5` carrying an `events.jsonl`, a tag `ultra/evidence/run-6` whose tree has no `events.jsonl`, and no tag for 7 prints `skipped: 6 7` and exactly one `run=5` line, with no `fetch` in the script's source (`grep -c 'fetch' evals/barrier_slack.py` is 0) [M2]; (d) a fixture with workers but no adoption prints `tasks=0` and `share=0.000` and the `all:` line's `files=` excludes it [M3].
- Run: git fetch -q --tags origin && python3 evals/barrier_slack.py --tags 70-112 | tail -3

**Stale-if:**
- path-absent: `evals/barrier_slack.py`
- issue-open: #810
