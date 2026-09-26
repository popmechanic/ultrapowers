# The Flock on the fleet, behind an engine switch

**Grammar:** claims-v1
**Claim:** I launch a plan with --kind flock and the Flock builds it on the fleet and opens the pull request the way a factory run does; a launch without the flag still runs the factory. (elicited)
**Summary:** This moves the Flock, the swarm of builders that share their work as they go, from the laptop onto the fleet as a second engine picked at launch. It exists because the Flock settled the Run Room plan a third faster than the factory (n=3 runs, one workload, 2026-09-26), so adopting it is an experiment until it has five fleet runs behind it. You get the faster engine one flag away, and the rollback is simply launching without the flag.

**Goal:** A launch flag `--kind flock` that the sandbox reads from the assignment and answers by running the Flock engine in place of the factory, with the same inputs, the same exit-code meaning and the same publish, plus narrow pulls built behind a policy switch that ships off (map #1292, operator 2026-09-26).
**Tech Stack:** Node 22 ESM, Python 3, bash; the Claude Agent SDK already in `factory/package.json`.
Spec: map #1292 (the pre-registration, rounds 1–3 and the operator's call).

## Global Constraints

- Models never run git: every git command is the engine's or the boot's own child process, and a builder's Bash is denied any command that runs git.
- A launch without `--kind` builds the same assignment comment, byte for byte, that it builds today, and the sandbox runs the factory for it exactly as today.
- `skills/ultrapowers/kernel/vendor/manyana.py` is sha-pinned and never edited.
- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/vendor/

### Task 1: The plan reader

**Type:** implementation

**Files:**
- Create: `factory/flock/plan.mjs`

**Claim:** The Flock reads a signed plan the way the sandbox does. (derived)
Machine: M1. `workloadFromPlan('fleet/tests/fixtures/flock-tiny/plan.md')` returns two tasks whose `depends_on` lists are `[]` and `['1']`, in plan order. M2. Task `1`'s `files` is `['calc.py']`, its `facts` is one argv whose first two items are `bash` and `-lc`, and its `body` starts with `Task 1: The adder`. M3. The workload's `check` is one `['bash', '-lc', <cmd>]` argv whose command carries the plan's `Check:` line, and its `setup` is `null` for a plan with no bootstrap command.

**Authorized-by:** map #1292 (operator 2026-09-26: proceed with the Flock plan, engine switch)

**Interfaces:**
- Consumes: none
- Produces: `workloadFromPlan(planPath) -> { tasks, check, setup }`

**Context:** `factory/flock/plan.mjs` is an ES module exporting `workloadFromPlan(planPath)`, synchronous. It runs `python3 <repo>/skills/ultrapowers/scripts/plan_parse.py <planPath>` (repo = two directories above the module file) and reads its JSON: `tasks[]` with `id`, `title`, `files`, `depends_on` (always empty — the edges are elsewhere), `proofRuns` (command strings, clause tags already stripped); `dag_edges[]` of `{from, to, why}`; `checks[]` of `{cmd, minor}`; `bootstrapCmd` (a string or null). It returns `{ tasks, check, setup }`: each task `{ id, title, body, files, depends_on, facts }`, where `depends_on` is the `from` of every `dag_edges` entry whose `to` is that task's id, `facts` is each `proofRuns` command as `['bash', '-lc', cmd]`, and `body` is the task's own section of the plan text — `'Task ' +` everything after its `### Task ` heading marker up to the next one, trimmed (the prototype's `fromPlan` in `flock/proto/workloads.mjs` on branch `flock-runroom` did exactly this by regex). `check` joins every non-minor `checks[].cmd` with ` && ` into one `['bash', '-lc', joined]`, or is `null` when there are none. `setup` is `['bash', '-lc', bootstrapCmd]` or `null`. A parser exit other than 0 throws with its stderr. The fixture `fleet/tests/fixtures/flock-tiny/plan.md` exists at BASE: two tasks, task 2 consuming task 1's `add`, one `Check:` line `test -n "$ULTRA_BASE"`, no bootstrap.

**Proof:**
- Run: node -e "import('./factory/flock/plan.mjs').then(m => console.log(JSON.stringify(m.workloadFromPlan('fleet/tests/fixtures/flock-tiny/plan.md'))))" | python3 -c "import json,sys; w=json.load(sys.stdin); t=w['tasks']; assert [x['id'] for x in t]==['1','2'] and [x['depends_on'] for x in t]==[[],['1']]" [M1]
- Run: node -e "import('./factory/flock/plan.mjs').then(m => console.log(JSON.stringify(m.workloadFromPlan('fleet/tests/fixtures/flock-tiny/plan.md'))))" | python3 -c "import json,sys; t=json.load(sys.stdin)['tasks'][0]; assert t['files']==['calc.py'] and len(t['facts'])==1 and t['facts'][0][:2]==['bash','-lc'] and t['body'].startswith('Task 1: The adder')" [M2]
- Run: node -e "import('./factory/flock/plan.mjs').then(m => console.log(JSON.stringify(m.workloadFromPlan('fleet/tests/fixtures/flock-tiny/plan.md'))))" | python3 -c "import json,sys; w=json.load(sys.stdin); c=w['check']; assert c[:2]==['bash','-lc'] and 'ULTRA_BASE' in c[2] and len(c)==3 and w['setup'] is None" [M3]
- Legs: (a) the fixture's two tasks come back in order with task 2 depending on task 1 [M1]; (b) task 1's files, its one bash argv and its body's opening are as stated [M2]; (c) the check argv carries the Check line and setup is null [M3].

**Stale-if:**
- path-exists: `factory/flock/plan.mjs`

### Task 2: The Flock engine

**Type:** implementation

**Files:**
- Create: `factory/flock/engine.mjs`
- Delete: `factory/flock/host.mjs`
- Modify: `factory/flock/flock_board.mjs`

**Claim:** The Flock engine takes the factory's inputs, builds the plan, and leaves the boot one commit to publish and the rows the pull request card reads. (derived)
Machine: M1. On the flock-tiny fixture with `--builder scripted:fleet/tests/fixtures/flock-tiny/green.json`, `node factory/flock/engine.mjs --plan <plan> --target <dir> --base <sha> --run-dir <dir>` exits 0, the target's HEAD is exactly one commit ahead of the base, and `total([1, 2, 3])` is `6` in the target. M2. That run's `events.jsonl` in the run dir carries exactly two rows whose `kind` is `landing`, one for each task. M3. With `red.json` in place of `green.json` the engine exits 1, the target's HEAD is one commit ahead of the base, and `events.jsonl` carries a row with `kind` `parked` for task `1`.

**Authorized-by:** map #1292 (operator 2026-09-26: the Flock is adopted as an experiment behind an engine switch; the round-3 arm is the measured shape)

**Interfaces:**
- Consumes: `workloadFromPlan(planPath) -> { tasks, check, setup }`
- Produces: `node factory/flock/engine.mjs --plan <plan.md> --target <dir> --base <sha> --run-dir <dir>`

**Context:** `factory/flock/host.mjs` at BASE is the laptop prototype, copied unchanged from branch `flock-runroom`; it imports a `./workloads.mjs` that is not here, so it does not run. Turn it into `factory/flock/engine.mjs` and delete it. Keep its machinery: the weave keeper `factory/flock/weave.py` (a JSON-lines child process), the stand-in board from `factory/flock/flock_board.mjs`, `edit_spans.mjs`, the edge, the conflict ledger, early close, settling, the elastic builder pool and the builders' in-process tools. What changes:
(1) CLI. The factory engine's own flags: `--plan`, `--target` (a git checkout of the target, left at `--base` by the boot), `--base` (40-hex), `--run-dir`; also accept and ignore `--kata-url`, `--kata-project`, `--kata-json`, `--kata-actor` (the boot passes them to either engine; the Flock keeps its stand-in board). Add `--builder sdk|scripted:<json>` (default `sdk`) and keep `--model` (default `claude-opus-5-5`).
(2) The workload comes from `workloadFromPlan(plan)` in `factory/flock/plan.mjs`. BASE is the target's tree at `--base`, read with the engine's own `git ls-tree`/`git show`; `setup`, when not null, runs once in the deps dir as the prototype's `W.setup` did. Every fact, the check and `setup` run with `ULTRA_BASE=<base>` in their environment.
(3) Defaults are the round-3 arm (n=3 runs, runroom-r3-1..3, 2026-09-26): elastic builders, cap 16, `--settle tested`, `--done-ends on`, `--tool-search off`, `--brief digest`, `--stdin closed`, `--early-close held`, `--order chain`. Each flag stays, and the old value of each is its rollback. `--clock` defaults to 13800 s, under the boot's 14400 s unit limit.
(4) The run dir holds `events.jsonl` (the prototype's rows, each `{t, kind, …}` plus `ts`, a non-empty ISO-8601 string, which every factory row carries and the boot's sims read) and `summary.json`. Scratch copies (`base/`, `deps/`, `agents/`, `edge/`) go under `<run-dir>/work/`.
(5) The builders' system prompt names no test runner. The prototype said `python3 -m pytest …`; say instead that a builder runs its task's facts with `run_proof`.
(6) The ending. On outcome `ready`, write the settled snapshot's files into `--target`'s working tree (write the ones that exist, delete the ones that don't) and commit once with the engine's own git (`git add -A`, then `git -c user.name=flock -c user.email=flock@ultrapowers.invalid commit -qm 'flock: settled <snap>'`). Then append one row per task `{kind: 'landing', task: <id>, k: <sessions that task had>, factsExit: 0, candidateSha: <the commit's sha>}` and exit 0. On outcome `draft`, if the last edge snapshot differs from BASE, commit it the same way with message `flock: draft <snap>`, append `{kind: 'parked', task: <id>, reason: 'red at <snap>'}` for every task whose facts were red at that edge, and exit 1. With nothing to commit, exit 1 and leave HEAD at base (the boot then records the failure).
(7) `--builder scripted:<json>` needs no model. The JSON maps a task id to `{path: text}`. A scripted session writes those files into its copy, then goes through the same `syncFromDisk` → publish → board done path a `done` call takes, and ends. A task the JSON does not name ends released.
(8) The builder's git denial stays a PreToolUse deny. `factory/gitblock.mjs` exports `findGit(command)`, which answers non-null when a Bash line runs git; use it in place of the prototype's regex.
`flock_board.mjs` imports `../../fleet/kata-client.mjs`, which resolves from `factory/flock/`. Keep that import or drop the Kata board; the stand-in is the one used. `zod` resolves from `factory/node_modules`, installed as the SDK's peer by the boot's `npm ci`.

**Proof:**
- Run: d=$(mktemp -d) && cp -R fleet/tests/fixtures/flock-tiny/base/. $d && git -C $d init -q && git -C $d add -A && git -C $d -c user.name=t -c user.email=t@t.invalid commit -qm base && b=$(git -C $d rev-parse HEAD) && node factory/flock/engine.mjs --plan fleet/tests/fixtures/flock-tiny/plan.md --target $d --base $b --run-dir $d.run --builder scripted:fleet/tests/fixtures/flock-tiny/green.json && test "$(git -C $d rev-list --count $b..HEAD)" = 1 && (cd $d && python3 -c "from report import total; assert total([1, 2, 3]) == 6") && python3 -c "import json,sys; r=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; assert sorted(str(x['task']) for x in r if x.get('kind')=='landing')==['1','2']" $d.run/events.jsonl [M1, M2]
- Run: d=$(mktemp -d) && cp -R fleet/tests/fixtures/flock-tiny/base/. $d && git -C $d init -q && git -C $d add -A && git -C $d -c user.name=t -c user.email=t@t.invalid commit -qm base && b=$(git -C $d rev-parse HEAD) && { node factory/flock/engine.mjs --plan fleet/tests/fixtures/flock-tiny/plan.md --target $d --base $b --run-dir $d.run --builder scripted:fleet/tests/fixtures/flock-tiny/red.json; test $? = 1; } && test "$(git -C $d rev-list --count $b..HEAD)" = 1 && python3 -c "import json,sys; r=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; assert any(x.get('kind')=='parked' and str(x.get('task'))=='1' for x in r)" $d.run/events.jsonl [M3]
- Legs: (a) the green run exits 0, leaves one commit ahead of base, and the target's `total` works, which needs both tasks' files and the `ULTRA_BASE` check green [M1]; (b) exactly the two tasks have landing rows [M2]; (c) the red run exits 1, still leaves its draft as one commit, and parks task 1 [M3].

**Stale-if:**
- path-absent: `factory/flock/host.mjs`

### Task 3: The sandbox switch

**Type:** implementation

**Files:**
- Modify: `factory/boot.sh`
- Modify: `fleet/CONTRACT.md`

**Claim:** A sandbox given `kind=flock` runs the Flock, and one given no kind runs the factory. (derived)
Machine: M1. `factory/boot.sh boot` with the assignment `run=1 plan=<40 a> target=o/r base=<40 b> engine=<40 c> kind=flock` logs an `assignment:` line ending ` kind=flock`, and the boot goes on to the target clone. M2. The same assignment without `kind=` logs an `assignment:` line ending ` kind=factory`. M3. With `kind=bogus` the boot fails with `assignment: kind is not flock or factory ('bogus')`.

**Authorized-by:** map #1292 (operator 2026-09-26: an engine switch, the factory the rollback)

**Interfaces:**
- Consumes: none
- Produces: `kind=flock`

**Context:** The assignment comment gains one optional key, `kind`, whose value is `flock` or `factory`; absent means `factory`. In the comment it comes after `engine=` and before the optional `hold=1`. The laptop writes it (`fleet/launch.mjs --kind flock`, another task); the sandbox reads it here. In `parse_assignment`, set `ENGINE_KIND` (default `factory`), accept `kind)`, refuse any other value with `fail "assignment: kind is not flock or factory ('$val')"`, and end the `log "assignment: …"` line with ` kind=$ENGINE_KIND`. In `run_engine`, the flock kind runs `node "$ENGINE_REPO_DIR/factory/flock/engine.mjs"` with exactly the arguments the factory's `factory/engine.mjs` gets (`--plan --target --base --run-dir` plus the board args), under the same transient unit, environment and log. The factory's line is unchanged. The re-fold on a moved main (`factory/engine.mjs --refold`) is engine-agnostic: it folds the target's HEAD against the base and re-runs the plan's probes, so it stays as it is for both kinds. In `fleet/CONTRACT.md` §Comment, add `kind=` beside `hold=1`, with its two values and its default. With `REFLECTION_URL=http://127.0.0.1:9` and `GITHUB_INT_HOST=127.0.0.1:9` set, the boot's VM-name read and its clone both fail at once (each is overridable at the top of `boot.sh` today). That is how the probes read the parse in under a second without the network. Unset, the VM-name read waits about 75 s on a laptop.

**Proof:**
- Run: d=$(mktemp -d) && REFLECTION_URL=http://127.0.0.1:9 GITHUB_INT_HOST=127.0.0.1:9 FLEET_HOME=$d FLEET_ASSIGNMENT="run=1 plan=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa target=o/r base=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb engine=cccccccccccccccccccccccccccccccccccccccc kind=flock" bash factory/boot.sh boot > $d.out 2>&1; grep -q 'assignment: run-1 .* kind=flock$' $d.out && grep -q 'FAILED: clone: target' $d.out [M1]
- Run: d=$(mktemp -d) && REFLECTION_URL=http://127.0.0.1:9 GITHUB_INT_HOST=127.0.0.1:9 FLEET_HOME=$d FLEET_ASSIGNMENT="run=1 plan=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa target=o/r base=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb engine=cccccccccccccccccccccccccccccccccccccccc" bash factory/boot.sh boot > $d.out 2>&1; grep -q 'assignment: run-1 .* kind=factory$' $d.out [M2]
- Run: d=$(mktemp -d) && REFLECTION_URL=http://127.0.0.1:9 FLEET_HOME=$d FLEET_ASSIGNMENT="run=1 plan=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa target=o/r base=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb engine=cccccccccccccccccccccccccccccccccccccccc kind=bogus" bash factory/boot.sh boot > $d.out 2>&1; grep -qF "FAILED: assignment: kind is not flock or factory ('bogus')" $d.out [M3]
- Run: bash -n factory/boot.sh
- Run: node fleet/tests/test_factory_boot.mjs
- Legs: (a) a flock assignment parses, is logged with its kind and reaches the clone [M1]; (b) no kind logs `kind=factory` [M2]; (c) any other value fails the boot with the stated message [M3].

**Stale-if:**
- path-absent: `factory/boot.sh`

### Task 4: The launch flag

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/lobby.mjs`

**Claim:** `--kind flock` on a launch puts `kind=flock` in the assignment, and a launch without it builds today's assignment. (derived)
Machine: M1. `buildComment({run: '7', plan: 'p', target: 'o/r', base: 'b', engine: 'e', kind: 'flock', hold: '1'})` returns `run=7 plan=p target=o/r base=b engine=e kind=flock hold=1`. M2. The same fields without `kind` return `run=7 plan=p target=o/r base=b engine=e hold=1`. M3. `node fleet/launch.mjs x.md --target o/r --base <40 b> --kind bogus` exits 2 printing `launch: --kind must be flock or factory, got "bogus"`.

**Authorized-by:** map #1292 (operator 2026-09-26: an engine switch, the factory one flag away)

**Interfaces:**
- Consumes: none
- Produces: `--kind flock`

**Context:** The assignment comment gains one optional key, `kind`, whose value is `flock` or `factory`. In `COMMENT_KEYS` (`fleet/lobby.mjs`) it goes after `engine` and before `hold`, and it is absent when the launch was given no `--kind`, so a launch without the flag builds today's comment byte for byte. The sandbox (`factory/boot.sh`, another task) accepts exactly those two values. In `fleet/launch.mjs`, `--kind <value>` is validated where `--hold` and `--again` are, before the plan is read, with `throw new Refusal(\`launch: --kind must be flock or factory, got ${JSON.stringify(opts.kind)}\`)` (a `Refusal` exits 2). A valid value rides into `buildComment` beside `hold`. The comment's byte ceiling check (`COMMENT_MAX_BYTES`) already covers the longer comment. Add `[--kind flock|factory]` to `USAGE`. The comment above `COMMENT_KEYS` and the one near `launch.mjs:973`, which say six keys, now say seven.

**Proof:**
- Run: node -e "import('./fleet/lobby.mjs').then(m => process.exit(m.buildComment({run: '7', plan: 'p', target: 'o/r', base: 'b', engine: 'e', kind: 'flock', hold: '1'}) === 'run=7 plan=p target=o/r base=b engine=e kind=flock hold=1' ? 0 : 1))" [M1]
- Run: node -e "import('./fleet/lobby.mjs').then(m => process.exit(m.buildComment({run: '7', plan: 'p', target: 'o/r', base: 'b', engine: 'e', hold: '1'}) === 'run=7 plan=p target=o/r base=b engine=e hold=1' ? 0 : 1))" [M2]
- Run: o=$(mktemp) && { node fleet/launch.mjs x.md --target o/r --base bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --kind bogus > $o 2>&1; test $? = 2; } && grep -qF 'launch: --kind must be flock or factory, got "bogus"' $o [M3]
- Legs: (a) a flock comment carries `kind=flock` between `engine=` and `hold=` [M1]; (b) with no kind the comment is today's [M2]; (c) any other value is refused with exit 2 and the stated message [M3].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`

### Task 5: Narrow pulls, built and switched off

**Type:** implementation

**Files:**
- Create: `factory/flock/pulls.mjs`
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/flock/weave.py`
- Modify: `factory/policy.json`

**Claim:** A builder can take in only the peer changes its own work touches, behind a switch that ships off. (derived)
Machine: M1. `pullScope({task, tasks, touched: ['notes.md'], mode: 'narrow'})` for the flock-tiny fixture's task 2 returns a set whose sorted items are `['calc.py', 'notes.md', 'report.py']`, and with `mode: 'all'` it returns `null`. M2. `factory/policy.json` carries a cell `flock.pulls` whose `mode` is `all`, whose `experiment` is `true` and which names a `rollback`. M3. The engine run on the fixture with `green.json` and `--pulls narrow` exits 0 with the target one commit ahead of base.

**Authorized-by:** map #1292 (round-3 reading: cache reads 3.4–3.7M against the factory's 2.4–2.9M, n=3 runs each, 2026-09-26; narrow pulls named as the next lever, untested)

**Interfaces:**
- Consumes: `workloadFromPlan(planPath) -> { tasks, check, setup }`
- Consumes: `node factory/flock/engine.mjs --plan <plan.md> --target <dir> --base <sha> --run-dir <dir>`
- Produces: `pullScope({ task, tasks, touched, mode }) -> Set | null`

**Context:** Today every builder, after each tool batch, merges every peer's published change into its copy (`pullInto` → the weave keeper's `pull` op). That is where the Flock's cache reads go. `pullScope` in `factory/flock/pulls.mjs` decides what a builder takes in. In mode `all` it returns `null`, meaning everything, which is today's behaviour. In mode `narrow` it returns the union of the task's own `files`, the `files` of every task in its `depends_on`, and `touched` (the paths this builder has read or edited in its copy). A task is `{ id, files, depends_on, … }` as `workloadFromPlan` returns it. The engine keeps `touched` per builder from its Read, Edit, MultiEdit and Write tool calls. Under `narrow` it asks the weave for only the scoped paths: the `pull` op gains an optional `paths` list and changes nothing when it is absent. Unpulled peer changes stay published, and the edge still merges and tests everything. The mode comes from `--pulls narrow|all`, else from the policy cell `flock.pulls.mode`. Add the cell in the house shape: `{"mode": "all", "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": "mode = all", "unread": "narrow pulls (#1292): cache reads and wall per run against the round-3 arm"}` under a top-level `flock` object. The engine prints its chosen mode in its `start` row as `pulls`.

**Proof:**
- Run: node -e "Promise.all([import('./factory/flock/pulls.mjs'), import('./factory/flock/plan.mjs')]).then(([p, w]) => { const { tasks } = w.workloadFromPlan('fleet/tests/fixtures/flock-tiny/plan.md'); const s = p.pullScope({ task: tasks[1], tasks, touched: ['notes.md'], mode: 'narrow' }); const a = p.pullScope({ task: tasks[1], tasks, touched: [], mode: 'all' }); process.exit(JSON.stringify([...s].sort()) === JSON.stringify(['calc.py', 'notes.md', 'report.py']) && a === null ? 0 : 1) })" [M1]
- Run: python3 -c "import json; c=json.load(open('factory/policy.json'))['flock']['pulls']; assert c['mode']=='all' and c['experiment'] is True and c.get('rollback')" [M2]
- Run: d=$(mktemp -d) && cp -R fleet/tests/fixtures/flock-tiny/base/. $d && git -C $d init -q && git -C $d add -A && git -C $d -c user.name=t -c user.email=t@t.invalid commit -qm base && b=$(git -C $d rev-parse HEAD) && node factory/flock/engine.mjs --plan fleet/tests/fixtures/flock-tiny/plan.md --target $d --base $b --run-dir $d.run --builder scripted:fleet/tests/fixtures/flock-tiny/green.json --pulls narrow && test "$(git -C $d rev-list --count $b..HEAD)" = 1 [M3]
- Legs: (a) the narrow scope is the task's files plus its dependency's files plus what it touched, and `all` is null [M1]; (b) the policy cell ships `all` as an experiment with a rollback [M2]; (c) a narrow run still settles and commits [M3].

**Stale-if:**
- path-exists: `factory/flock/pulls.mjs`
