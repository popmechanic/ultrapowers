# Ordering follow-up: the pair builder reads BASE, and a requeue waits only for a sibling that can still arrive

**Grammar:** claims-v1

**Claim:** When the factory decides whether one task must wait for another, it looks at the real code as it stands before the run, and it never makes a task wait for something that cannot arrive. (elicited)
**Summary:** This fixes the two defects run-239's own reviewer found in the new ordering rules. The factory was reading every file as empty when deciding who waits for whom, so it made every task that uses another's code wait, even when that code already existed; and a task sent back to wait for a sibling could end up waiting on one that had already given up, or on one that was waiting for it. After this, a task starts at once when what it needs is already there, and a task only waits for work that can still land.

**Goal:** Run-239's referee findings (2026-09-25), task 1: `factory/engine.mjs` hands `pairState` and `labelPair` its judge reader `read(name, arg)` where `factory/pairs.mjs` expects a file reader `read(path)`, so every BASE file reads as `''` in live runs. The shared-file outlines are always empty (why the `where_producer`/`where_consumer` Choices only ever offered the `_shared` placeholder), and since run-239 `shape.symbol_at_base` is always `false`, so every interface pair is chained by code even when its symbol already exists. Give the pair builder a real BASE reader. And task 3's two plan findings: `requeueDecision` adds a wait with no check that the sibling can still be adopted (a parked sibling never is) and no cycle check (a sibling that waits on the requeued task never lands first); either strands the task until the run ends and parks it.

**Tech Stack:** Node 24 ES modules (`factory/`). The suite: `python3 -m pytest -q` from the repository root.

Spec: popmechanic/ultrapowers#1292 (baseline comment, 2026-09-25) and run-239's referee findings (PR #1295).

## Global Constraints

- Check: python3 -m pytest -q

---

### Task 1: A BASE reader for the pair builder

**Type:** implementation

**Files:**
- Create: `factory/baseread.mjs`
- Modify: `factory/engine.mjs`

**Claim:** The pair builder sees each shared file as it stood at BASE, and an absent file as empty. (derived)
Machine: M1. `baseReader({ git, target, base })` returns an async function that, for a path, resolves the stdout of `git(['show', base + ':' + path], target)`. M2. When that `git` call throws (the path is absent at `base`), the function resolves `''`. M3. Against this repository at `$ULTRA_BASE`, the reader resolves text of `factory/pairs.mjs` that contains `export function decideByCode`, and resolves `''` for `no/such/file.txt`. M4. `factory/engine.mjs` passes `baseReader({ git, target, base })` (the run's own `git`, `target` and base sha) as the `read` of both `pairsMod.pairState` and `pairsMod.labelPair`, where it passes the judge's `read` today.

**Authorized-by:** popmechanic/ultrapowers#1292; run-239 referee findings (2026-09-25, PR #1295)

**Interfaces:**
- Consumes: nothing
- Produces: `baseReader({ git, target, base }) -> (path) => Promise<string>`

**Context:** `factory/pairs.mjs` is pure and takes all file text through a caller-supplied `read(path)` that answers `''` for a missing file. In `factory/engine.mjs` the pair loop calls `pairsMod.pairState({ pair, tasks, read })` and, after the run settles, `pairsMod.labelPair({ pair, tasks, read, folds, foldOrder })`, where `read` is the judge wrapper `async (name, arg) => …` defined near `const read = async (name, arg)`; it answers `null` for a path, so every file reads as `''`. The engine's `git(args, cwd)` is `deps.git || defaultGit` and throws on a non-zero exit; the run's base sha is `args.base` (the engine's initial `head`); `target` is `path.resolve(String(args.target))`. `baseReader` is its own small module so a probe can import it without starting the engine.

**Proof:**
- Run: node -e "import('./factory/baseread.mjs').then(async (m) => { const calls = []; const r = m.baseReader({ git: (a, c) => { calls.push([a, c]); return 'def make_widget(n):' }, target: '/t', base: 'abc' }); const t = await r('widgetkit/widget.py'); process.exit(t === 'def make_widget(n):' && calls[0][0].join(' ') === 'show abc:widgetkit/widget.py' && calls[0][1] === '/t' ? 0 : 1) })" [M1]
- Run: node -e "import('./factory/baseread.mjs').then(async (m) => { const r = m.baseReader({ git: () => { throw new Error('fatal: path does not exist') }, target: '/t', base: 'abc' }); process.exit((await r('x.py')) === '' ? 0 : 1) })" [M2]
- Run: node -e "const cp = require('child_process'); import('./factory/baseread.mjs').then(async (m) => { const git = (a, c) => cp.execFileSync('git', a, { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); const r = m.baseReader({ git, target: process.cwd(), base: process.env.ULTRA_BASE }); const a = await r('factory/pairs.mjs'); const b = await r('no/such/file.txt'); process.exit(a.includes('export function decideByCode') && b === '' ? 0 : 1) })" [M3]
- Legs: (a) the reader asks git for exactly `show <base>:<path>` in the target and returns its text [M1]; (b) a failing git call reads as empty [M2]; (c) against the real repository at BASE, a present file reads with its content and an absent one as empty [M3]; M4 is the call site in the engine, read against the hunk at landing, with the suite's engine sims under the run-wide `Check:`.

**Stale-if:**
- path-exists: `factory/baseread.mjs`

### Task 2: A requeue waits only for a sibling that can still arrive

**Type:** implementation

**Files:**
- Modify: `factory/dispatch.mjs`
- Modify: `factory/engine.mjs`

**Claim:** A task sent back to wait for a sibling's file waits only when that sibling can still land before it. (derived)
Machine: M1. `requeueDecision` returns `null` when the sibling `missingProducer` names is in `parked`. M2. It returns `null` when that sibling waits, directly or through other tasks, on the requeued task itself, read through `predsOf`: with `predsOf` `{ '1': ['3'], '3': ['2'] }`, task `'2'`'s requeue behind `'1'` returns `null`. M3. With neither condition, run-1's own case still returns `'1'`. M4. `factory/engine.mjs` passes `parked` (its parked set) and `predsOf` (each task id to the ids `allPreds` returns for it) to `requeueDecision`.

**Authorized-by:** popmechanic/ultrapowers#1292; run-239 referee findings (2026-09-25, PR #1295)

**Interfaces:**
- Consumes: nothing
- Produces: `requeueDecision({ landing, tasks, taskId, adopted, requeued, enabled, parked, predsOf }) -> string | null`

**Context:** `requeueDecision` in `factory/dispatch.mjs` today returns `missingProducer(...)`'s sibling whenever the switch is on, the landing's `factsExit` is not `0` and the task has not been requeued. Add two optional inputs: `parked` (an array or Set of task ids) and `predsOf` (a Map or plain object from a task id to an iterable of the ids it waits on). After `missingProducer` names a sibling, return `null` if the sibling is in `parked`, or if walking `predsOf` from the sibling reaches `taskId`; absent inputs mean no such check, so every existing caller keeps its answer. In `factory/engine.mjs` the call is `requeueDecision({ landing, tasks, taskId: id, adopted, requeued: requeuedTasks, enabled: requeueEnabled })` in the adoption loop; `parked` is the engine's parked Set and `allPreds(task)` returns a task's adoption and candidate predecessors, so pass `predsOf` built from `tasks` as `{ [t.id]: allPreds(t) }`. The run-1 case: tasks `[{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]`, a landing with `factsExit: 1` and one run line whose tail is `ModuleNotFoundError: No module named 'widgetkit.widget'`.

**Proof:**
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]; const landing = { best: { factsExit: 1, runLines: [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }] } }; process.exit(m.requeueDecision({ landing, tasks, taskId: '2', adopted: [], requeued: [], enabled: true, parked: new Set(['1']) }) === null ? 0 : 1) })" [M1]
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }, { id: '3', files: ['x.py'] }]; const landing = { best: { factsExit: 1, runLines: [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }] } }; process.exit(m.requeueDecision({ landing, tasks, taskId: '2', adopted: [], requeued: [], enabled: true, parked: [], predsOf: { '1': ['3'], '3': ['2'] } }) === null ? 0 : 1) })" [M2]
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]; const landing = { best: { factsExit: 1, runLines: [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }] } }; process.exit(m.requeueDecision({ landing, tasks, taskId: '2', adopted: [], requeued: [], enabled: true, parked: [], predsOf: { '1': [] } }) === '1' ? 0 : 1) })" [M3]
- Legs: (a) a parked sibling is never waited on [M1]; (b) a sibling that waits, through a third task, on the requeued task is never waited on [M2]; (c) the plain run-1 case still requeues behind the constructor [M3]; M4 is the call site in the engine, read against the hunk at landing, with the suite's engine sims under the run-wide `Check:`.

**Stale-if:**
- path-absent: `factory/dispatch.mjs`
