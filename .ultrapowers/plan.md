# Jev reads two engine moments beside the builders, on the record only

**Grammar:** claims-v1
**Claim:** Every run records what Jev would have said at two moments the engine now spends a builder session on — a merge conflict and a task given back — without changing what the run does. (elicited)
**Summary:** Today every merge conflict and every task a builder gives back costs a full builder session, even though on atlas every conflict task changed nothing (n=5 runs) and run-252 spent $80.57 on give-backs of one task no builder could fix. This asks Jev a one-second question at each of those moments and writes its answer into the run's record, beside what the builders then actually did, while the run carries on exactly as before. After five runs the record says whether Jev's answer could have skipped those sessions; this is an experiment, and its rollback is turning each question off in the policy file.

**Goal:** Two record-only Jev questions in the Flock: `flock_resolve` when a resolve task is added, `flock_release` when a task is given back; each written as a `jev:resolve` / `jev:release` row, each behind its own policy cell.
**Tech Stack:** Node (the Flock engine), JSON
**Spec:** none — the whole-codebase review of 2026-09-29 (factory reading, Jev candidates 1 and 2); operator pick 2026-09-29 ("Engine Jev trials")

## Global Constraints

- Neither question changes what the run does: no task is added, skipped, parked or closed because of an answer, and a run with no Jev (no `TYPESAFE_BASE_URL`, or a cell's `mode` of `off`) writes no `jev:resolve` or `jev:release` row and makes no request.
- The `flock_step` question set and the `flock.jev_step` cell are unchanged.
- Check: python3 -m pytest -q

### Task 1: The two questions and their reader

**Type:** implementation

**Files:**
- Modify: `factory/questions.json`
- Create: `factory/flock/trial_reading.mjs`

**Claim:** Every run records what Jev would have said at a merge conflict and at a task given back. (derived)
Machine: M1. `factory/questions.json`'s `sets` carries `flock_step` unchanged (the sha256 of its `JSON.stringify` is `4b4b98871a45d9551d79b0e082aa7c7cdced60747160458b8525aa6635b2b717`, as at BASE) plus `flock_resolve` and `flock_release`; `flock_resolve.questions` has one key, `already_joined`, of `type` `choice` whose `criteria` keys are exactly `no_edit_needed`, `needs_edit` and `contradictory`; `flock_release.questions` has one key, `blocker`, of `type` `choice` whose `criteria` keys are exactly `fixable`, `waiting_on_peer` and `plan_defect`; both sets carry `calibrated` `false`, a `reader` of `factory/flock/engine.mjs`, and a `rollback` naming `flock.jev_resolve` and `flock.jev_release` respectively. M2. `readTrial` from `factory/flock/trial_reading.mjs`, given an `ask` that resolves `{blocker: {choice: 'fixable', confidence: 0.7}}`, calls `emit` exactly once with the given `row` fields plus `answer: 'fixable'` and `confidence: 0.7`; given an `ask` that resolves `null`, it emits once with `answer: null` and `confidence: null`. M3. `resolveState` returns exactly the keys `path`, `annotated` and `tasks`, with `annotated` cut to its first 8000 characters; `releaseState` returns exactly the keys `task`, `title`, `files`, `reason` and `depends_on`, with `reason` cut to its first 1500 characters.

**Authorized-by:** the factory review reading of 2026-09-29 (Jev candidates 1 and 2); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `readTrial({ ask, key, question, state, row, emit }) -> Promise<void>`
- Produces: `resolveState({ path, annotated, titles }) -> object`
- Produces: `releaseState({ task, why, depends }) -> object`

**Context:** The live pattern to copy is `factory/flock/step_reading.mjs` (`readSteps`) and the `flock_step` set in `factory/questions.json`. A question is literal: it names no policy word and decides nothing. Jev's reply is `{answers: {<key>: {choice, confidence}}}`; `makeJevClient().ask({state, questions})` resolves `answers` or `null`, and never throws.

The two sets, besides `questions`, carry `when`, `reader`, `rollback`, `state` (the state's key list), `provenance` and `calibrated: false`, like `flock_step`. Update the file's `about` so it names three sets.

- **`flock_resolve`**, `already_joined`: "In `annotated`, do the left and right sides of each conflict already fit together as the merged text shows them, so the file needs no edit?" `context` explains that `annotated` is the merged file with `<<<<<<<`/`=======`/`>>>>>>>` sections, that `path` is the file, and that `tasks` are the titles of the tasks that touch it. Criteria:
  - `no_edit_needed`: both sides say things that stand together as merged.
  - `needs_edit`: one side's meaning is lost, or the text does not read as one file, until someone edits it.
  - `contradictory`: the two sides want opposite things, and one must be chosen.
- **`flock_release`**, `blocker`: "Given `reason`, what stands between this task and its facts passing?" Criteria:
  - `fixable`: another attempt at `files` could make them pass.
  - `waiting_on_peer`: they need work another task in `depends_on` or elsewhere has not published yet.
  - `plan_defect`: no change to `files` can make them pass as the plan states them.

`readTrial` sends `ask({ state, questions: { [key]: question } })` and emits `{ ...row, answer, confidence }`: `answer` is the reply's `choice` when it is a string, else `null`; `confidence` is its number, else `null`. It never throws. `resolveState({path, annotated, titles})` gives `{path, annotated, tasks: titles}`. `releaseState({task, why, depends})` gives `{task: task.id, title: task.title, files: task.files ?? [], reason, depends_on: depends}`.

**Proof:**
- Run: node -e "const q=JSON.parse(require('fs').readFileSync('factory/questions.json','utf8')).sets; const r=q.flock_resolve, l=q.flock_release; const k=(o)=>Object.keys(o).sort().join(','); if(!(require('crypto').createHash('sha256').update(JSON.stringify(q.flock_step)).digest('hex')==='4b4b98871a45d9551d79b0e082aa7c7cdced60747160458b8525aa6635b2b717' && k(r.questions)==='already_joined' && r.questions.already_joined.type==='choice' && k(r.questions.already_joined.criteria)==='contradictory,needs_edit,no_edit_needed' && k(l.questions)==='blocker' && l.questions.blocker.type==='choice' && k(l.questions.blocker.criteria)==='fixable,plan_defect,waiting_on_peer' && r.calibrated===false && l.calibrated===false && r.reader==='factory/flock/engine.mjs' && l.reader==='factory/flock/engine.mjs' && r.rollback.includes('flock.jev_resolve') && l.rollback.includes('flock.jev_release'))) process.exit(1)" [M1]
- Run: node --input-type=module -e "import { readTrial } from './factory/flock/trial_reading.mjs'; const rows=[]; await readTrial({ ask: async () => ({ blocker: { choice: 'fixable', confidence: 0.7 } }), key: 'blocker', question: {}, state: {}, row: { task: '1' }, emit: (x) => rows.push(x) }); await readTrial({ ask: async () => null, key: 'blocker', question: {}, state: {}, row: { task: '2' }, emit: (x) => rows.push(x) }); const ok = rows.length === 2 && JSON.stringify(rows[0]) === JSON.stringify({ task: '1', answer: 'fixable', confidence: 0.7 }) && JSON.stringify(rows[1]) === JSON.stringify({ task: '2', answer: null, confidence: null }); process.exit(ok ? 0 : 1)" [M2]
- Run: node --input-type=module -e "import { resolveState, releaseState } from './factory/flock/trial_reading.mjs'; const a = resolveState({ path: 'a.txt', annotated: 'x'.repeat(9000), titles: ['t'] }); const b = releaseState({ task: { id: '1', title: 'T', files: ['a.txt'] }, why: 'y'.repeat(2000), depends: [] }); const k = (o) => Object.keys(o).sort().join(','); const ok = k(a) === 'annotated,path,tasks' && a.annotated.length === 8000 && k(b) === 'depends_on,files,reason,task,title' && b.reason.length === 1500; process.exit(ok ? 0 : 1)" [M3]
- Legs: (a) the two new sets carry exactly the named keys, criteria, reader, rollback and `calibrated: false`, and `flock_step` hashes as at BASE [M1]; (b) an answer is emitted with its choice and confidence, and a null reply is emitted as nulls, once each [M2]; (c) both state builders give exactly their keys and cut at 8000 and 1500 characters [M3].

**Stale-if:**
- path-absent: `factory/questions.json`

### Task 2: The engine asks at both moments and records the answers

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/policy.json`
- Create: `fleet/tests/flock_jev_trials_probe.mjs`

**Claim:** Every run records what Jev would have said at a merge conflict and at a task given back, without changing what the run does. (derived)
Machine: M1. `node fleet/tests/flock_jev_trials_probe.mjs release` prints `JEV TRIALS release OK` and exits 0. The case runs the scripted Flock with a local stand-in Jev that answers every question `{choice: 'plan_defect', confidence: 0.9}`, on a one-task plan whose script names no files. So the task is given back until it parks, and the case checks that `events.jsonl` holds exactly as many `jev:release` rows as give-backs (3), each with `task` `'1'`, `answer` `'plan_defect'` and `confidence` `0.9`, and still one `task:parked` row for task 1. M2. `node fleet/tests/flock_jev_trials_probe.mjs resolve` prints `JEV TRIALS resolve OK` and exits 0. The case runs a two-task plan whose scripted builders write different text into the same line of `a.txt`, so the engine adds a resolve task, and it checks that `events.jsonl` holds at least one `jev:resolve` row, every one with `path` `'a.txt'` and `answer` `'plan_defect'` (the stand-in's one answer). M3. `node fleet/tests/flock_jev_trials_probe.mjs off` prints `JEV TRIALS off OK` and exits 0. The case runs the `release` plan with `TYPESAFE_BASE_URL` empty, and checks that no `jev:release` row is written and the stand-in receives no request. M4. `factory/policy.json`'s `flock` carries `jev_resolve` and `jev_release`, each with `mode` `record`, `n` `0`, `experiment` `true` and `rollback` `mode = off`, and `flock.jev_step` is unchanged.

**Authorized-by:** the factory review reading of 2026-09-29 (Jev candidates 1 and 2); operator pick 2026-09-29

**Interfaces:**
- Consumes: `readTrial({ ask, key, question, state, row, emit }) -> Promise<void>`
- Consumes: `resolveState({ path, annotated, titles }) -> object`
- Consumes: `releaseState({ task, why, depends }) -> object`
- Produces: none

**Context:** The engine already asks Jev once per story at a ready settle (`JEV_STEP`, `STEP_QUESTION`, `jev`, `readAndRecord`, ~lines 108–160). Follow that shape. Each trial is on when its policy cell's `mode` is `record` and `process.env.TYPESAFE_BASE_URL` is set, and only then does it make a Jev client. Load the two questions from `factory/questions.json` (`sets.flock_resolve.questions.already_joined`, `sets.flock_release.questions.blocker`).

- **Resolve:** where the settle loop adds an `R:<path>` task (~line 990, beside `ev('resolve-task', …)`), ask with `resolveState({ path: p, annotated: ann, titles })`. `titles` are the titles of the plan's tasks whose `files` include `p`. Emit `ev('jev:resolve', { path: p, snap: r.snap, answer, confidence })`.
- **Release:** in `giveBack` (~line 604), which every give-back goes through, ask with `releaseState({ task, why, depends })`. `depends` is `[{id, state}]` for `task.depends_on`. Emit `ev('jev:release', { task: task.id, releases: task.released, answer, confidence })`.
- **Nothing waits on an answer:** neither call is awaited before the task is added, released or parked. Keep each pending promise in a set, and before the engine writes `summary.json` and exits, wait for the set for at most `JEV_TIMEOUT_MS` (`factory/jev-client.mjs`, 10 s). An answer that has not arrived by then is simply absent.

The two policy cells follow `jev_step`'s shape: `mode: "record"`, `n: 0`, `window: "none"`, `basis: "judgment"`, `experiment: true`, `rollback: "mode = off"`. Each `unread` names its reading:
- `jev_resolve`: the `jev:resolve` answers against whether the `R:` task's session then edited the path (its `edit` rows), over 5 runs with a resolve task. Atlas: every resolve task changed nothing (n=5 runs).
- `jev_release`: the `jev:release` answers against whether the task was later done or parked, over 20 given-back tasks. Run-252: ~1,150 give-backs of one task, $80.57.

**The probe** `fleet/tests/flock_jev_trials_probe.mjs` is an unbridged probe (its name does not match `test_*.mjs`), in the shape of `fleet/tests/test_flock_scope.mjs`:
- It builds a throwaway git target in a temp dir, writes a claims-v1 plan, and runs `factory/flock/engine.mjs --builder scripted:<json>` with `--clock 120 --stall-minutes 2` under `simEnv` from `./_helpers.mjs`.
- `TYPESAFE_BASE_URL` points at a `node:http` server on `127.0.0.1` port 0. It answers every `POST /v1/systemone` with a JSON body whose `answers` gives each asked key `{choice: 'plan_defect', confidence: 0.9}`, and it counts requests. In the `off` case, `TYPESAFE_BASE_URL` is `''`.
- The case is `argv[2]`, one of `release`, `resolve` or `off`. It prints `JEV TRIALS <case> OK` and exits 0, or names what differed and exits 1.
- In the `release` plan, task 1's probe is `grep -q DONE a.txt` and the script is `{}`, so the scripted builder gives the task back ("the script names no files").
- In the `resolve` plan, tasks 1 and 2 both `Modify: a.txt` (base content `x\n`). The script writes `ONE\n` for 1 and `TWO\n` for 2, and the probes are `grep -q ONE a.txt` and `grep -q TWO a.txt`, so the join conflicts and a resolve task is added.

If the engine turns out not to add a resolve task for that shape, change the fixture until it does. Keep the clause: a `jev:resolve` row is written when a resolve task is added.

**Proof:**
- Run: node fleet/tests/flock_jev_trials_probe.mjs release [M1]
- Run: node fleet/tests/flock_jev_trials_probe.mjs resolve [M2]
- Run: node fleet/tests/flock_jev_trials_probe.mjs off [M3]
- Run: node -e "const f=JSON.parse(require('fs').readFileSync('factory/policy.json','utf8')).flock; const ok=['jev_resolve','jev_release'].every((k)=>f[k]&&f[k].mode==='record'&&f[k].n===0&&f[k].experiment===true&&f[k].rollback==='mode = off') && f.jev_step.mode==='record' && f.jev_step.rollback==='mode = off'; process.exit(ok?0:1)" [M4]
- Run: node fleet/tests/test_flock_scope.mjs
- Legs: (a) a task given back three times yields three `jev:release` rows carrying the stand-in's answer, and it still parks [M1]; (b) a resolve task yields at least one `jev:resolve` row for `a.txt` carrying the stand-in's answer [M2]; (c) with no Jev URL no row is written and no request is made [M3]; (d) both cells are record-only experiments with `mode = off` as rollback, and `jev_step` is unchanged [M4].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`
