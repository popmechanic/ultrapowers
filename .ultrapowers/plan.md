# Jev sees the evidence each question turns on, and the authoring checks stop repeating themselves

**Grammar:** claims-v1
**Claim:** Every Jev question is sent the evidence its answer turns on and not much more, and the authoring checks send the store once and batch what shares a state, through the same client the fleet uses. (elicited)
**Summary:** An audit against TypeSafe's own guidance found most Jev questions short of the evidence they hinge on — the story check sees only the last step, the give-back question never sees what the task must prove, the conflict question can miss a conflict past its cut — while one authoring check re-sends the whole app store once per action. This gives each question the context it needs, sends shared context once with the questions batched over it, and moves the authoring checks onto the fleet's own Jev client. You get Jev answers worth calibrating before any readings pile up, and faster, cheaper authoring checks; nothing is calibrated yet (n=0), so no reading changes meaning.

**Goal:** Richer state for `flock_step`, `flock_resolve` and `flock_release`; `jev_checks.ts` on `makeJevClient` (with headers), one store send, batched per-item questions, and the missing context for `essential`, `stands_alone`, `story_passes_near_miss` and `link_expected`.
**Tech Stack:** Node (engine), Bun + TypeScript (authoring checks), JSON
**Spec:** none — the Jev context audit of 2026-09-29 against docs.typesafe.ai (state, choice, noul, citation-check); operator pick 2026-09-29 ("One plan, all fixes")

## Global Constraints

- Every question keeps its meaning and its thresholds; what changes is the state it is asked over and how calls are grouped. No policy cell's `mode` changes.
- A fleet call still carries no `Authorization` header of its own (the edge injects it); only the laptop's authoring checks send one.
- Check: python3 -m pytest -q

### Task 1: The story reading sees the whole story, and a big store still gets read

**Type:** implementation

**Files:**
- Modify: `factory/flock/step_reading.mjs`
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/questions.json`

**Claim:** Every Jev question is sent the evidence its answer turns on and not much more. (derived)
Machine: M1. `stepState(result, sentences, all)` from `factory/flock/step_reading.mjs`, given `all` holding `S1.1` (`did: ['a']`, `before: 'B1'`, `after: 'A1'`) and `S1.2` (`did: ['b']`, `before: 'B2'`, `after: 'A2'`) and `result` the `S1.2` result, returns `step: 'S1.2'`, `did` deep-equal to `['a', 'b']`, `before: 'B1'` and `after: 'A2'`. M2. When `before` and `after` together would make the state's JSON over 100000 characters, `stepState` returns no `before` or `after` key and a `changes` array with one entry per row that differs, each `{table, row, before, after}` (a missing row is `null`), and the state's JSON is at most 120000 characters.

**Authorized-by:** the Jev context audit of 2026-09-29; operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `stepState(result, sentences, all) -> object`

**Context:** Today `stepState(result, sentences)` sends Jev only the story's last step: its `did` and the store `before` and `after` that step. But the question asks whether the whole story sentence came true. A story whose outcome is built over several steps is judged on its last step's change alone.

Change `stepState` to take `all`, the `Map` of clause → latest result that `latestResults` already builds, and send:
- `did`: every step's `did` for that story (`S1.1`, `S1.2`, …, up to the result's own step), in step order, flattened.
- `before`: the first step's `before`.
- `after`: the last step's `after`.

A store is `[tables, values]`, with tables as `{table: {row: {cell: value}}}`. The client drops a state over `JEV_STATE_MAX_BYTES` (120000) without a call, so the reading is silently lost. When `before` and `after` would take the state's JSON over 100000 characters, send `changes` in their place: one `{table, row, before, after}` per row that differs between the first `before` and the last `after`, where `before`/`after` are the row's cells or `null`. Keep `screen_text`'s 4000-character cut.

`readSteps` and the engine's `readAndRecord` pass `all` through. Update `flock_step`'s `state` list and its `context` sentence in `factory/questions.json` to say that `did` is every step of the story and that `changes` may stand in for `before`/`after`. Leave the question, its criteria and its policy cell as they are.

**Proof:**
- Run: node --input-type=module -e "import { stepState } from './factory/flock/step_reading.mjs'; const all = new Map([['S1.1', { clause: 'S1.1', exit: 0, did: ['a'], before: 'B1', after: 'A1' }], ['S1.2', { clause: 'S1.2', exit: 0, did: ['b'], before: 'B2', after: 'A2' }]]); const s = stepState(all.get('S1.2'), { S1: 'the story' }, all); process.exit(s.step === 'S1.2' && JSON.stringify(s.did) === JSON.stringify(['a', 'b']) && s.before === 'B1' && s.after === 'A2' ? 0 : 1)" [M1]
- Run: node --input-type=module -e "import { stepState } from './factory/flock/step_reading.mjs'; const big = 'x'.repeat(70000); const all = new Map([['S1.1', { clause: 'S1.1', exit: 0, did: ['a'], before: [{ t: { r0: { v: big } } }, {}], after: [{ t: { r0: { v: big }, r1: { v: 'new' } } }, {}] }]]); const s = stepState(all.get('S1.1'), { S1: 'the story' }, all); const ok = !('before' in s) && !('after' in s) && Array.isArray(s.changes) && s.changes.length === 1 && s.changes[0].table === 't' && s.changes[0].row === 'r1' && s.changes[0].before === null && JSON.stringify(s.changes[0].after) === JSON.stringify({ v: 'new' }) && JSON.stringify(s).length <= 120000; process.exit(ok ? 0 : 1)" [M2]
- Legs: (a) a two-step story is read with both steps' actions, the first step's before and the last step's after [M1]; (b) a store too big to send whole becomes one changed-row entry and fits the budget [M2].

**Stale-if:**
- path-absent: `factory/flock/step_reading.mjs`

### Task 2: The conflict and give-back questions see what each side meant and what the task must prove

**Type:** implementation

**Files:**
- Modify: `factory/flock/trial_reading.mjs`
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/questions.json`

**Claim:** Every Jev question is sent the evidence its answer turns on and not much more. (derived)
Machine: M1. `resolveState({ path, annotated, sides })`, given a 20000-character `annotated` whose only conflict section begins after character 15000, returns exactly the keys `path`, `conflicts` and `tasks`; `conflicts` has one string, at most 4000 characters, holding that section's `<<<<<<< begin`, `======= begin` and `>>>>>>> end` lines and both sides' text; `tasks` is `sides`. M2. `releaseState({ task, why, depends })` returns exactly the keys `task`, `title`, `files`, `claim`, `facts`, `reason`, `earlier_reasons` and `depends_on`. For a task whose `body` holds `**Claim:** C line\nMachine: M1. X.\n\n**Authorized-by:** z`, whose `facts` are `[['bash', '-lc', 'grep -q X a.txt']]` and whose `notes` are `['A released: first', 'an unrelated note']`, it returns `claim` `**Claim:** C line\nMachine: M1. X.`, `facts` `['grep -q X a.txt']` and `earlier_reasons` `['A released: first']`. M3. In `factory/questions.json`, `sets.flock_resolve.state` is `["path", "conflicts", "tasks"]` and `sets.flock_release.state` is `["task", "title", "files", "claim", "facts", "reason", "earlier_reasons", "depends_on"]`.

**Authorized-by:** the Jev context audit of 2026-09-29; operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `resolveState({ path, annotated, sides }) -> object`
- Produces: `releaseState({ task, why, depends }) -> object`

**Context:** Two changes, landed by run-269 (#1375) and not yet read (n=0).

- **`resolveState` today** sends the whole marked-up file cut at 8000 characters, so a conflict past that point is never seen, and only the task titles, where the question is what each side meant. Send instead:
  - `conflicts`: each marked section (from a `<<<<<<< begin` line to its `>>>>>>> end` line) with up to 10 unmarked lines on either side, each at most 4000 characters.
  - `tasks`: the `sides`, one `{title, claim}` per plan task whose `files` include the path.

  The engine builds `sides` from `W.tasks`, taking `claim` from each task's `body` as below.
- **`releaseState` today** sends no word of what the task must prove. Add:
  - `claim`: the task body's text from its `**Claim:**` line up to, not including, its `**Authorized-by:**` line, trimmed, at most 2000 characters.
  - `facts`: one string per fact. A `['bash', '-lc', cmd]` fact is `cmd`; any other argv is joined with spaces.
  - `earlier_reasons`: the task's `notes` that contain ` released: `, at most the last 3. The same reason three times is the plainest sign of a plan defect.

  The engine passes the board task, which carries `body`, `facts` and `notes`.

In `factory/questions.json`, update each set's `state` list and its `context` sentence to the new fields. The questions and criteria stay. `fleet/tests/flock_jev_trials_probe.mjs` (all three cases) must stay green.

**Proof:**
- Run: node --input-type=module -e "import { resolveState } from './factory/flock/trial_reading.mjs'; const ann = 'line\n'.repeat(3000) + '<<<<<<< begin left\nLEFT SIDE\n======= begin right\nRIGHT SIDE\n>>>>>>> end conflict\n' + 'tail\n'.repeat(1000); const sides = [{ title: 'T', claim: 'C' }]; const s = resolveState({ path: 'a.txt', annotated: ann, sides }); const k = Object.keys(s).sort().join(','); const c = s.conflicts || []; const ok = k === 'conflicts,path,tasks' && c.length === 1 && c[0].length <= 4000 && ['<<<<<<< begin', '======= begin', '>>>>>>> end', 'LEFT SIDE', 'RIGHT SIDE'].every((x) => c[0].includes(x)) && s.tasks === sides; process.exit(ok ? 0 : 1)" [M1]
- Run: node --input-type=module -e "import { releaseState } from './factory/flock/trial_reading.mjs'; const task = { id: '1', title: 'T', files: ['a.txt'], body: 'Task 1: T\n\n**Claim:** C line\nMachine: M1. X.\n\n**Authorized-by:** z\n', facts: [['bash', '-lc', 'grep -q X a.txt']], notes: ['A released: first', 'an unrelated note'] }; const s = releaseState({ task, why: 'red', depends: [] }); const ok = Object.keys(s).sort().join(',') === 'claim,depends_on,earlier_reasons,facts,files,reason,task,title' && s.claim === '**Claim:** C line\nMachine: M1. X.' && JSON.stringify(s.facts) === JSON.stringify(['grep -q X a.txt']) && JSON.stringify(s.earlier_reasons) === JSON.stringify(['A released: first']); process.exit(ok ? 0 : 1)" [M2]
- Run: node -e "const q=JSON.parse(require('fs').readFileSync('factory/questions.json','utf8')).sets; process.exit(JSON.stringify(q.flock_resolve.state)===JSON.stringify(['path','conflicts','tasks']) && JSON.stringify(q.flock_release.state)===JSON.stringify(['task','title','files','claim','facts','reason','earlier_reasons','depends_on']) ? 0 : 1)" [M3]
- Run: node fleet/tests/flock_jev_trials_probe.mjs release
- Run: node fleet/tests/flock_jev_trials_probe.mjs resolve
- Legs: (a) a conflict deep in a long file is sent whole, with both sides, beside each side's claim [M1]; (b) a give-back carries the task's claim, its facts as commands and its earlier give-back reasons [M2]; (c) both question sets list the new state [M3].

**Stale-if:**
- path-absent: `factory/flock/trial_reading.mjs`

### Task 3: The Jev client takes extra headers

**Type:** implementation

**Files:**
- Modify: `factory/jev-client.mjs`

**Claim:** The authoring checks go through the same client the fleet uses. (derived)
Machine: M1. `makeJevClient({ baseUrl, fetchImpl, headers: { Authorization: 'Bearer k' } }).ask(…)` sends a request whose headers carry `Authorization: Bearer k` and `content-type: application/json`; with no `headers` option the request's headers are exactly `{ 'content-type': 'application/json' }`.

**Authorized-by:** the Jev context audit of 2026-09-29 (and the ultrawrite review's DRY 4: `jev_checks.ts` re-implements this client without its status check or state budget)

**Interfaces:**
- Consumes: none
- Produces: `makeJevClient({ baseUrl, fetchImpl, timeoutMs, log, headers }) -> { ask }`

**Context:** `makeJevClient` sends only `content-type`, because on the fleet the edge injects the bearer. The laptop's authoring checks (`skills/ultrawrite/stories/jev_checks.ts`) call `api.typesafe.ai` directly with a key from `~/.ultrapowers/typesafe.env`, so they need to send it themselves. Add an optional `headers` object that is merged over the `content-type` header. The fleet passes none, so its requests are unchanged. Keep the file's header comment true: a fleet call still carries no `Authorization` of its own. `fleet/tests/test_jev_client.mjs` covers the client and must stay green.

**Proof:**
- Run: node --input-type=module -e "import { makeJevClient } from './factory/jev-client.mjs'; const seen = []; const fetchImpl = async (url, init) => { seen.push(init.headers); return { status: 200, text: async () => JSON.stringify({ answers: { q: { noul: 0.5 } } }) } }; await makeJevClient({ baseUrl: 'http://x', fetchImpl, headers: { Authorization: 'Bearer k' } }).ask({ state: {}, questions: { q: {} } }); await makeJevClient({ baseUrl: 'http://x', fetchImpl }).ask({ state: {}, questions: { q: {} } }); const a = seen[0], b = seen[1]; process.exit(a.Authorization === 'Bearer k' && a['content-type'] === 'application/json' && JSON.stringify(b) === JSON.stringify({ 'content-type': 'application/json' }) ? 0 : 1)" [M1]
- Run: node fleet/tests/test_jev_client.mjs
- Legs: (a) a caller's header rides beside the content type, and a call with none sends exactly the content type [M1].

**Stale-if:**
- path-absent: `factory/jev-client.mjs`

### Task 4: The authoring checks send the store once, batch what shares a state, and carry the missing context

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/jev_checks.ts`
- Modify: `skills/ultrawrite/stories/questions.json`
- Create: `fleet/tests/jev_calls_probe.mjs`

**Claim:** Every Jev question is sent the evidence its answer turns on and not much more, and the authoring checks send the store once and batch what shares a state, through the same client the fleet uses. (derived)
Machine: M1. `node fleet/tests/jev_calls_probe.mjs bundle` prints `JEV CALLS bundle OK` and exits 0. The case runs `jev_checks.ts` on a copy of `skills/ultrawrite/catalog/todo-tags` (2 pieces, 5 actions, 1 link) against a stand-in Jev and checks five things:
- exactly one request's state carries `store_module`, and it asks 5 questions;
- exactly one request's state carries `pieces`, and it has 2 entries;
- every request whose state carries `near_miss` also carries a non-empty `story_steps` array;
- the request whose state carries `link` also carries a non-empty `summary` string;
- every request carries the header `authorization: Bearer fake-key`, and the saved `product.json` holds exactly 5 readings whose `question` is `branches_on_text`.

M2. `node fleet/tests/jev_calls_probe.mjs map` prints `JEV CALLS map OK` and exits 0. It checks that every request of `--stage map` on that copy carries `other_purposes`, an array of the other concepts' purposes (1 entry), and has no top-level `purpose` key. M3. `node fleet/tests/jev_calls_probe.mjs decompose` prints `JEV CALLS decompose OK` and exits 0. It checks that every request of `--stage decompose` carries a non-empty `summary` string and a `built_before` array. M4. `node fleet/tests/jev_calls_probe.mjs understanding` prints `JEV CALLS understanding OK` and exits 0. It checks that `--stage understanding` sends exactly one request whose state carries `sentences`, with 2 entries (the ask's two sentences) and 2 questions.

**Authorized-by:** the Jev context audit of 2026-09-29; operator pick 2026-09-29

**Interfaces:**
- Consumes: `makeJevClient({ baseUrl, fetchImpl, timeoutMs, log, headers }) -> { ask }`
- Produces: none

**Context:** Changes to `jev_checks.ts` (and to `questions.json` beside it wherever a question's text must name a new path):

- **The client.** Drop `defaultAsk`'s own `fetch` and use `makeJevClient` from `factory/jev-client.mjs`. Pass `baseUrl` from `TYPESAFE_BASE_URL`, defaulting to `https://api.typesafe.ai`. Pass `headers: { Authorization: 'Bearer ' + key() }`, where `key()` reads `$ULTRAPOWERS_HOME/typesafe.env` as today, and `timeoutMs: 30000`. The client adds the status check and the state budget the hand-rolled call lacks. Bun imports the `.mjs` directly.
- **The store, once.** `branches_on_text` sends the whole store module (up to 20000 characters) once per action today; the todo-tags bundle sends it 5 times. Send one request whose state is `{store_module, actions: [{piece, name, description}, …]}`, with one question per action whose text names `` `actions[i].name` ``. Question ids are code-only, so any unique id works. Record each answer as today, one reading per action with `question: 'branches_on_text'`.
- **Batch what shares a state.** TypeSafe evaluates the questions of one request in parallel, independently, and adding questions barely changes the latency.
  - `two_apps`: one request, state `{ask, sentences: [...]}`, one question per sentence naming `` `sentences[i]` ``.
  - `same_need`: one request, state `{pieces: [{name, purpose}, …]}`, one question per pair naming both entries.
  - Everything else: calls that remain separate run concurrently, not one after another.
  - Every DOUBT and flag line, and every reading row, stays as it is today.
- **The missing context:**
  - `essential` (map): add `other_purposes`, the other concepts' purposes. Drop the duplicate top-level `purpose` and point `essential` and `serves_summary` at `` `piece.purpose` ``.
  - `stands_alone` (decompose): add `summary`, the product summary, and `built_before`, what earlier plans in the build order do.
  - `story_passes_near_miss`: add `story_steps`, each step's `{tool, args, see}`.
  - `link_expected`: add `summary`.

**The probe `fleet/tests/jev_calls_probe.mjs`** is unbridged (its name does not match `test_*.mjs`). It is a node script:
- It starts a `node:http` stand-in on `127.0.0.1` port 0. The stand-in answers every `POST /v1/systemone` with `{answers}`, giving every asked key `{noul: 0.5}`, and records each request's headers and JSON body.
- It copies `skills/ultrawrite/catalog/todo-tags` to a temp dir and writes `<temp>/home/typesafe.env` holding `TYPESAFE_API_KEY=fake-key`.
- It runs `bun skills/ultrawrite/stories/jev_checks.ts <copy> --stage <stage>` with `TYPESAFE_BASE_URL` set to the stand-in's URL and `ULTRAPOWERS_HOME` set to `<temp>/home`. The case is `argv[2]`: `bundle`, `map`, `decompose` or `understanding`. `bundle` is the stage `jev_checks.ts` runs with no `--stage`.
- It prints `JEV CALLS <case> OK` and exits 0, or names what differed and exits 1.

At BASE the checks ignore `TYPESAFE_BASE_URL`, so the stand-in receives nothing and every case fails.

**Proof:**
- Run: node fleet/tests/jev_calls_probe.mjs bundle [M1]
- Run: node fleet/tests/jev_calls_probe.mjs map [M2]
- Run: node fleet/tests/jev_calls_probe.mjs decompose [M3]
- Run: node fleet/tests/jev_calls_probe.mjs understanding [M4]
- Legs: (a) the store goes once with one question per action, pieces are compared in one request, the near-miss and link questions carry their new context, the key rides as a header, and every action still gets its reading [M1]; (b) each map request carries the other concepts and no duplicate purpose [M2]; (c) each build-order request carries the summary and what came before [M3]; (d) the ask's sentences go in one request [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/jev_checks.ts`
