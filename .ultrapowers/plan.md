# Edges are facts: no task starts before the code it needs exists

**Grammar:** claims-v1

**Claim:** When one task needs code another task builds, it waits for that code every time, so no task starts blind and pays for attempts that could never pass. (elicited)
**Summary:** This makes the factory's ordering of tasks follow what the plan already says, instead of a judgment call that can go the wrong way. It exists because on the flock-baseline run-1 the catalog task started before the widget constructor existed: every attempt failed, and the detour cost more than the rest of the run. After this, a task that needs another's code waits for it automatically, and the model is left only the calls that cannot cause a blind start.

**Goal:** Map popmechanic/ultrapowers#1292's baseline reading (flock-baseline run-1, 2026-09-25): Jev read the constructor→catalog pair `chain` at 0.68, the engine averaged the Score to 1.39 and read it `look`, and the consumer started at second zero against a missing module. Make ordering mechanical: an interface edge whose consumed symbol is absent at BASE is a chain decided by code; the pair verdict is read as its most likely level; a landing whose probes fail on a missing sibling file waits for that sibling instead of being folded.

**Tech Stack:** Node 24 ES modules (`factory/`), Python 3 for the parser. The suite: `python3 -m pytest -q` from the repository root (it bridges every `fleet/tests/test_*.mjs`, the engine sims included).

Spec: popmechanic/ultrapowers#1292 (the baseline comment of 2026-09-25) and #1265 (the precedent: a proof-run edge is a fact, not a judgment).

## Global Constraints

- Check: python3 -m pytest -q
- Every new switch is a `factory/policy.json` cell carrying `n`, `window`, `basis`, `experiment` and `rollback`, and its rollback restores today's behaviour exactly.
- No judgment becomes a regex: a missing-sibling reading matches file paths and module names the plan's own Files name, never prose.

---

### Task 1: An interface edge whose symbol is absent at BASE is a chain, decided by code

**Type:** implementation

**Files:**
- Modify: `factory/pairs.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/policy.json`
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** When a task consumes a name another task produces and that name does not exist yet, the consumer waits for the producer without anyone having to judge it. (derived)
Machine: M1. For the parser's own pair on `evals/fixtures/claims/plan.md` (task 2 consumes `make_widget`, which task 1 creates), with every BASE file read as empty, `pairState` sets `shape.symbol_at_base` to `false` and `decideByCode` returns `"chain"`. M2. When one of the producer's Files at BASE contains the consumed symbol as a whole word, `shape.symbol_at_base` is `true` and `decideByCode` returns `null`, so the pair still goes to the reader. M3. A pair with no symbol keeps today's answer: shared files whose producer and consumer hits are disjoint decide `"fold"`. M4. `factory/policy.json` carries `pairs.interface_hard` with `enabled: true` and `rollback: "enabled = false"`, and the engine passes that switch to `decideByCode`, so with it off the pair goes to the reader as before. M5. `skills/ultrawrite/SKILL.md` §Decomposition judgment item 2 says that a consumed symbol absent at BASE is chained by code.

**Authorized-by:** popmechanic/ultrapowers#1292 (baseline comment, 2026-09-25); operator's pick 2026-09-25

**Interfaces:**
- Consumes: nothing
- Produces: `decideByCode(state, opts) -> 'fold' | 'chain' | null`

**Context:** Today `decideByCode(state)` in `factory/pairs.mjs` can only ever answer `fold` (or `null`); every interface pair goes to Jev's `readPair`, and only a `chain` verdict puts the producer in the consumer's `chainPreds` in `factory/engine.mjs` (the pair loop near `const codeVerdict = … decideByCode(state)`), which with `speculate.on_candidate` true launches the consumer on the producer's measured candidate. Add to `pairState` one computed field, `shape.symbol_at_base`: `true` when `pair.symbol` appears as a whole word in any of the producer task's `files` read through `read(path)` at BASE (an absent file reads as `''`), else `false`; `false` also when `pair.symbol` is null. Make `decideByCode(state, opts)` answer `'chain'` when `state.shape.symbol` is set, `state.shape.symbol_at_base` is `false` and `opts.interfaceHard` is not `false` (absent `opts` means on); otherwise keep today's logic unchanged. In the engine, read `policyDoc.pairs.interface_hard.enabled` and pass `{ interfaceHard }` to `decideByCode`; the existing `by: 'code'` pair row records it. The new policy cell follows the shape of `pairs.proof_run_hard` (`n: 0`, `window: "none"`, `basis: "judgment"`, `experiment: true`, `rollback: "enabled = false"`, and an `unread` naming flock-baseline run-1). The parser's pair for the fixture plan is `{"a": "1", "b": "2", "why": ["interface"], "paths": [], "symbol": "make_widget", "producer": "1", "consumer": "2"}`, and `plan_parse.py`'s `tasks` carry `id`, `title`, `files`, `interfaces` but no `body` or `clauses`, so the probes add `body: ''` and `clauses: []`. In `skills/ultrawrite/SKILL.md`, item 2 of §Decomposition judgment ("**Write no ordering.**") currently says the engine "starts every task at once unless a pair reads as a chain by that reading"; add one sentence saying that a `Consumes:` whose symbol is absent at BASE is chained by code, the consumer starting on the producer's measured candidate.

**Proof:**
- Run: node -e "const cp = require('child_process'); const d = JSON.parse(cp.execFileSync('python3', ['skills/ultrapowers/scripts/plan_parse.py', 'evals/fixtures/claims/plan.md'])); import('./factory/pairs.mjs').then(async (m) => { const tasks = d.tasks.map((t) => ({ ...t, body: '', clauses: [] })); const s = await m.pairState({ pair: d.pairs[0], tasks, read: async () => '' }); process.exit(s.shape.symbol_at_base === false && m.decideByCode(s) === 'chain' ? 0 : 1) })" [M1]
- Run: node -e "const cp = require('child_process'); const d = JSON.parse(cp.execFileSync('python3', ['skills/ultrapowers/scripts/plan_parse.py', 'evals/fixtures/claims/plan.md'])); import('./factory/pairs.mjs').then(async (m) => { const tasks = d.tasks.map((t) => ({ ...t, body: '', clauses: [] })); const s = await m.pairState({ pair: d.pairs[0], tasks, read: async (p) => (p === 'widgetkit/widget.py' ? 'def make_widget(n):' : '') }); process.exit(s.shape.symbol_at_base === true && m.decideByCode(s) === null ? 0 : 1) })" [M2]
- Run: node -e "import('./factory/pairs.mjs').then((m) => process.exit(m.decideByCode({ shape: { symbol: null, stated_in_consumer: false }, shared: [{ path: 'a.py', producer_hits: ['f'], consumer_hits: ['g'] }] }) === 'fold' ? 0 : 1))" [M3]
- Run: node -e "const p = require('./factory/policy.json').pairs.interface_hard; process.exit(p && p.enabled === true && p.rollback === 'enabled = false' ? 0 : 1)" [M4]
- Run: node -e "const cp = require('child_process'); const d = JSON.parse(cp.execFileSync('python3', ['skills/ultrapowers/scripts/plan_parse.py', 'evals/fixtures/claims/plan.md'])); import('./factory/pairs.mjs').then(async (m) => { const tasks = d.tasks.map((t) => ({ ...t, body: '', clauses: [] })); const s = await m.pairState({ pair: d.pairs[0], tasks, read: async () => '' }); process.exit(m.decideByCode(s, { interfaceHard: false }) === null ? 0 : 1) })" [M4]
- Run: sed -n '/Write no ordering/,/Let same-file edits stand/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -qiE 'absent at BASE.*chained by code|chained by code.*absent at BASE' [M5]
- Legs: (a) the fixture's own pair, with the constructor missing at BASE, is chained by code [M1]; (b) the same pair with the symbol present at BASE is left to the reader [M2]; (c) a files-only pair with disjoint hits still folds [M3]; (d) the policy cell exists with its rollback, and with the switch off the pair is not decided by code [M4]; (e) the skill's item 2 carries the rule [M5].

**Stale-if:**
- path-absent: `factory/pairs.mjs`

### Task 2: The pair verdict is read as its most likely level, not its average

**Type:** implementation

**Files:**
- Modify: `factory/judge.mjs`
- Modify: `factory/policy.json`

**Claim:** When the model splits its reading of a pair between two answers, the factory acts on the answer it thought most likely, never on the one in between that it barely considered. (derived)
Machine: M1. `readPair`, given a verdict whose probabilities are `{0: 0.29, 1: 0.03, 2: 0.68}` and whose score is `1.39` (flock-baseline run-1's own reading), resolves the verdict `"chain"`. M2. Given `{0: 0.51, 1: 0.45, 2: 0.04}` with score `0.53`, it resolves `"fold"`. M3. A tie between two levels resolves to the higher level: `{0: 0.4, 1: 0.2, 2: 0.4}` resolves `"chain"`. M4. `factory/policy.json` carries `pairs.verdict_read` with `value: "most-likely"` and `rollback: "value = mean"`, and with `value` set to `"mean"` the reading of M1 resolves `"look"`, as today.

**Authorized-by:** popmechanic/ultrapowers#1292 (baseline comment, 2026-09-25); operator's pick 2026-09-25

**Interfaces:**
- Consumes: nothing
- Produces: `readPair(state) -> { verdict, score, where, answers }`

**Context:** In `factory/judge.mjs`, `readPair` today computes the verdict from `scoreOf(answers.verdict)` (the probability-weighted mean) against two cut points, `midFoldLook` and `midLookChain`, the midpoints between the `verdict` question's own level keys (`0`, `1`, `2`: fold, look, chain). The answer's `probabilities` object is already on `answers.verdict`. Read the verdict as the level with the highest probability, the higher level winning a tie, when `policy.pairs.verdict_read.value` is `"most-likely"` or the cell is absent; keep today's mean-and-cut-points reading when it is `"mean"`. `score` in the returned row stays the mean, for the record. A `null` reading still resolves `look`. The fake `ask` a probe hands `makeJudge` returns every answer `readPair`'s questions need: `verdict` as `{ score, probabilities }`, `where_producer` and `where_consumer` as `{ choice: 'imports' }`, and `ordering_matters`, `needs_behaviour` as `{ noul: 0.5 }`. `makeJudge` takes `{ ask, policyPath }`; the M4 probe writes a copy of `factory/policy.json` with `pairs.verdict_read.value` set to `"mean"` to a temp file and passes its path. The new cell carries `n: 0`, `window: "none"`, `basis: "judgment"`, `experiment: true`, and an `unread` naming flock-baseline run-1 and run-215 (the two recorded readings where the mean flipped a most-likely `chain` to `look`, n=42 pair readings).

**Proof:**
- Run: node -e "import('./factory/judge.mjs').then(async ({ makeJudge }) => { const j = makeJudge({ ask: async () => ({ verdict: { score: 1.39, probabilities: { 0: 0.29, 1: 0.03, 2: 0.68 } }, where_producer: { choice: 'imports' }, where_consumer: { choice: 'imports' }, ordering_matters: { noul: 0.5 }, needs_behaviour: { noul: 0.5 } }) }); const r = await j.readPair({ shared: [] }); process.exit(r.verdict === 'chain' ? 0 : 1) })" [M1]
- Run: node -e "import('./factory/judge.mjs').then(async ({ makeJudge }) => { const j = makeJudge({ ask: async () => ({ verdict: { score: 0.53, probabilities: { 0: 0.51, 1: 0.45, 2: 0.04 } }, where_producer: { choice: 'imports' }, where_consumer: { choice: 'imports' }, ordering_matters: { noul: 0.5 }, needs_behaviour: { noul: 0.5 } }) }); const r = await j.readPair({ shared: [] }); process.exit(r.verdict === 'fold' ? 0 : 1) })" [M2]
- Run: node -e "import('./factory/judge.mjs').then(async ({ makeJudge }) => { const j = makeJudge({ ask: async () => ({ verdict: { score: 1.0, probabilities: { 0: 0.4, 1: 0.2, 2: 0.4 } }, where_producer: { choice: 'imports' }, where_consumer: { choice: 'imports' }, ordering_matters: { noul: 0.5 }, needs_behaviour: { noul: 0.5 } }) }); const r = await j.readPair({ shared: [] }); process.exit(r.verdict === 'chain' ? 0 : 1) })" [M3]
- Run: node -e "const fs = require('fs'); const os = require('os'); const path = require('path'); const p = JSON.parse(fs.readFileSync('factory/policy.json', 'utf8')); if (!(p.pairs.verdict_read && p.pairs.verdict_read.value === 'most-likely' && p.pairs.verdict_read.rollback === 'value = mean')) process.exit(1); p.pairs.verdict_read.value = 'mean'; const f = path.join(os.tmpdir(), 'policy-mean-' + process.pid + '.json'); fs.writeFileSync(f, JSON.stringify(p)); import('./factory/judge.mjs').then(async ({ makeJudge }) => { const j = makeJudge({ policyPath: f, ask: async () => ({ verdict: { score: 1.39, probabilities: { 0: 0.29, 1: 0.03, 2: 0.68 } }, where_producer: { choice: 'imports' }, where_consumer: { choice: 'imports' }, ordering_matters: { noul: 0.5 }, needs_behaviour: { noul: 0.5 } }) }); const r = await j.readPair({ shared: [] }); process.exit(r.verdict === 'look' ? 0 : 1) })" [M4]
- Legs: (a) run-1's own split reading resolves chain [M1]; (b) a fold-leaning split resolves fold, not the barely-considered look [M2]; (c) a tie resolves to the higher level [M3]; (d) the cell exists with its rollback, and the rollback reproduces today's look on run-1's reading [M4].

**Stale-if:**
- path-absent: `factory/judge.mjs`

### Task 3: A landing whose probes fail on a missing sibling file waits for that sibling

**Type:** implementation

**Files:**
- Modify: `factory/dispatch.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/policy.json`

**Claim:** When a task's checks fail only because another task's file does not exist yet, the task waits for that file and tries again, instead of being accepted broken. (derived)
Machine: M1. `missingProducer({ runLines, tasks, taskId, adopted })` returns `"1"` when a failing run line's output says `ModuleNotFoundError: No module named 'widgetkit.widget'`, task `"1"`'s `files` include `widgetkit/widget.py`, task `"1"` is not in `adopted`, and `taskId` is `"2"`. M2. It returns `null` for the same output when task `"1"` is in `adopted`. M3. It returns `"1"` when a failing run line's output says `Cannot find module '/home/exedev/run/impl-2-0/factory/x.mjs'` and task `"1"`'s `files` include `factory/x.mjs`. M4. `factory/policy.json` carries `landing.requeue_missing_producer` with `enabled: true` and `rollback: "enabled = false"`. M5. `requeueDecision({ landing, tasks, taskId, adopted, requeued, enabled })` returns the sibling `missingProducer` names when `enabled` is true, `landing.best.factsExit` is not `0` and `taskId` is not in `requeued`; it returns `null` when `taskId` is already in `requeued`, when `enabled` is false, and when `landing.best.factsExit` is `0`. M6. `factory/engine.mjs`'s adoption loop calls `requeueDecision` for each settled landing before `foldIn`, and on a sibling id adds that sibling to the task's hard predecessors, adds the task to its requeued set, appends a `requeue` row naming the task and the sibling, and hands the task back to `settleReadiness()`.

**Authorized-by:** popmechanic/ultrapowers#1292 (baseline comment, 2026-09-25); operator's pick 2026-09-25

**Interfaces:**
- Consumes: nothing
- Produces: `missingProducer({ runLines, tasks, taskId, adopted }) -> string | null`
- Produces: `requeueDecision({ landing, tasks, taskId, adopted, requeued, enabled }) -> string | null`

**Context:** A candidate's measured `runLines` are `{ cmd, exit, tail }` per probe (`best.runLines` on a landing in `factory/engine.mjs`). `missingProducer` is pure and lives in `factory/dispatch.mjs` beside `waitsFor`: for each run line with a non-zero `exit`, it collects the module or path its `tail` names in one of three shapes — Python's `No module named '<dotted>'` (a dotted name `a.b` stands for `a/b.py` or `a/b/__init__.py`), Node's `Cannot find module '<path>'` (matched on its ending, since the path is absolute in the worker's clone), and `No such file or directory: '<path>'` — and returns the id of the first task other than `taskId`, not in `adopted`, whose `files` contain a matching path; else `null`. `adopted` is an array or Set of task ids. `requeueDecision` is pure and sits beside it: it holds the whole decision (the switch, the red facts, the once-per-task rule) so the engine only acts on its answer. `landing` is the settled landing object (`landing.best.factsExit`, `landing.best.runLines`); a landing with no `best` (a dead one) answers `null`; `requeued` is an array or Set of task ids. In the engine's adoption loop (the `while (inflightLandings.size > 0)` block, where `done.add(id)` precedes the `landing.dead` check), call `requeueDecision` with `enabled` read from `policyDoc.landing.requeue_missing_producer.enabled`, the `adopted` list and a run-scoped requeued Set, before `done.add(id)`; on a sibling id, skip `done.add(id)` and the fold for this landing, add the sibling to the task's `edgePreds`, add the task to the requeued Set, append `{ kind: 'requeue', task, waits_on }`, and `continue` to `settleReadiness()`, which launches the task again once the sibling is adopted. The new cell carries `n: 0`, `window: "none"`, `basis: "judgment"`, `experiment: true`, and an `unread` naming flock-baseline run-1 (task 2 adopted with `factsExit` 1 after both candidates and a re-dispatch failed on `No module named 'widgetkit.widget'`).

**Proof:**
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]; const runLines = [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }]; process.exit(m.missingProducer({ runLines, tasks, taskId: '2', adopted: [] }) === '1' ? 0 : 1) })" [M1]
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]; const runLines = [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }]; process.exit(m.missingProducer({ runLines, tasks, taskId: '2', adopted: ['1'] }) === null ? 0 : 1) })" [M2]
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['factory/x.mjs'] }, { id: '2', files: ['factory/y.mjs'] }]; const runLines = [{ cmd: 'node y', exit: 1, tail: 'Error: Cannot find module \'/home/exedev/run/impl-2-0/factory/x.mjs\'' }]; process.exit(m.missingProducer({ runLines, tasks, taskId: '2', adopted: new Set() }) === '1' ? 0 : 1) })" [M3]
- Run: node -e "const p = require('./factory/policy.json').landing.requeue_missing_producer; process.exit(p && p.enabled === true && p.rollback === 'enabled = false' ? 0 : 1)" [M4]
- Run: node -e "import('./factory/dispatch.mjs').then((m) => { const tasks = [{ id: '1', files: ['widgetkit/widget.py'] }, { id: '2', files: ['widgetkit/catalog.py'] }]; const landing = { best: { factsExit: 1, runLines: [{ cmd: 'python3 -c x', exit: 1, tail: 'ModuleNotFoundError: No module named \'widgetkit.widget\'' }] } }; const d = (o) => m.requeueDecision({ landing, tasks, taskId: '2', adopted: [], requeued: [], enabled: true, ...o }); const ok = d({}) === '1' && d({ requeued: ['2'] }) === null && d({ enabled: false }) === null && d({ landing: { best: { ...landing.best, factsExit: 0 } } }) === null; process.exit(ok ? 0 : 1) })" [M5]
- Legs: (a) run-1's own missing-module failure names the unadopted constructor task [M1]; (b) once that task is adopted the same failure names nobody [M2]; (c) a Node missing-module failure maps an absolute clone path back to the sibling's file [M3]; (d) the policy cell exists with its rollback [M4]; (e) the decision names the sibling once, and answers `null` on a second ask, with the switch off, and when the facts are green [M5]; M6 is the call site in the engine, read against the hunk at landing, with the suite's engine sims under the run-wide `Check:` as its regression guard [M6].

**Stale-if:**
- path-absent: `factory/dispatch.mjs`
