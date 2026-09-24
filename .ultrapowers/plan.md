# A probe that imports a sibling's new file waits for it: import forms become proof-run edges, and proof-run edges stay hard under live pairs

**Grammar:** claims-v1
**Claim:** do: launch a plan where one task's probe imports a module a sibling task creates; see: that task starts after the sibling lands, its first probe run is against a tree that has the file, and no fold goes red for a module that did not exist yet. (elicited)
**Summary:** On the first foreign run of the factory, four tasks whose probes imported a file a sibling was still writing started at second zero, and eleven folds in a row were red for a file that did not exist yet. This makes that ordering a fact the engine reads itself: the parser now sees an import in a probe the way it already sees a path, and the engine keeps that kind of edge hard instead of asking Jev about it. After it, a task that needs a sibling's file simply starts when the file is there, and the authoring notes say so in one line.
**Goal:** `plan_parse.py`'s run tokenizer yields the file paths that Python and JavaScript import forms name, so its third-tier `proof-run` edge fires on `from tests.trends_fixtures import x` as it fires on `python3 tests/x.py`; `factory/engine.mjs` keeps `proof-run` edges as hard predecessors in live pairs mode, beside `write-after-create`, behind a policy cell `pairs.proof_run_hard` with its rollback; and the ultrawrite skill and its gotchas name the rule (#1265).
**Closes:** #1265
**Tech Stack:** Python 3 (`plan_parse.py`, pytest under `tests/`), Node 22 ESM (`factory/engine.mjs`, `factory/dispatch.mjs`, `fleet/tests/*.mjs` sims).
**Spec:** #1265 is the spec, with its table of run-1's four consumers and its mechanism section; there is no spec document.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- factory/pairs.mjs factory/judge.mjs factory/questions.json factory/boot.sh factory/worker.mjs skills/ultrapowers/kernel fleet/launch.mjs
- No judgment changes: `factory/questions.json` and `factory/pairs.mjs` are byte-identical to BASE. The rule this plan adds is a fact about files — a probe cannot import a module nobody has written — and lives in the parser and the engine's hard-edge set, never in a question to Jev.
- `pairs.mode` stays `live`; nothing here turns the pair reader off. The new cell is the experiment and its rollback is the cell, so the reader's own reading (`pair:label` rows) is untouched.
- A run with no such pair behaves exactly as at BASE: the same edges, the same dispatch at second zero.

### Task 1: The parser reads an import in a probe as the path it names

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Modify: `tests/test_plan_parse.py`

**Claim:** do: write a probe that imports a module a sibling task creates; see: the parser prints a `proof-run` edge from that sibling to the probe's task, exactly as it does when the probe names the file by path. (derived)
Machine: M1. For a two-task plan where task 1 creates `tests/trends_fixtures.py` and task 2's `Run:` is `python3 -c "from tests.trends_fixtures import make_canon_fixture; make_canon_fixture()"`, `plan_parse.py` prints `dag_edges` equal to `[{"from": "1", "to": "2", "why": "proof-run"}]`.
M2. The same for `import pkg.mod` where task 1 creates `pkg/mod.py`, and for a package: `from pkg import x` where task 1 creates `pkg/__init__.py`.
M3. The same for a JavaScript form: task 2's `Run:` is `node -e "import('./lib/a.mjs').then(m => m.a())"` and task 1 creates `lib/a.mjs`; and for an extensionless specifier `'./lib/b'` where task 1 creates `lib/b.ts`.
M4. A probe whose import names a module no sibling's Files carry — task 2 imports `tests.absent_fixture`, task 1 creates `tests/trends_fixtures.py` — yields `dag_edges` equal to `[]`; and a plan with no import in any probe prints the same `dag_edges` it printed at BASE (the existing sims of `tests/test_plan_parse.py` pin those).
M5. `python3 -m pytest -q -n0 tests/test_plan_parse.py` exits 0.

**Authorized-by:** #1265 ("Code rule before Jev … the same shape as the existing 'a `Run:` whose command names a path in a sibling's Files' rule … extended to Python import forms"); `skills/ultrawrite/SKILL.md` §Task shape ("A Proof `Run:` whose command names a path in a sibling's Files … the sibling that owns the file goes first").

**Interfaces:**
- Consumes: `_build_edges(impl) -> list` (`plan_parse.py`, its third tier, unchanged)
- Produces: `_run_tokens(cmd) -> list[str]`
- Produces: `_import_paths(cmd) -> list[str]`

**Context:** `_run_tokens(cmd)` at BASE (line 438 of `plan_parse.py`) splits the command on `_RUN_SPLIT_RE`, strips a leading `./`, and returns the tokens; the third tier of `_build_edges` (line ~508) intersects `set(_run_tokens(cmd))` with `files_of[a] - b_files` — the sibling's Files that the running task does not own — and adds `{"from": a, "to": b, "why": "proof-run"}` on a hit, after the `would_cycle` guard, and never twice for one pair (`seen`). This task adds `_import_paths(cmd)`, whose output `_run_tokens` appends to its own: for every Python form `from <dotted> import …` and `import <dotted>` (each `<dotted>` a `[\w.]+` name, several allowed after `import` separated by commas), the two candidate paths `<dotted with . → />.py` and `<dotted with . → />/__init__.py`; for every JavaScript form — `import <anything> from '<spec>'`, `import('<spec>')`, `require('<spec>')`, single or double quotes — with a relative `<spec>` (starting `./` or `../`), the specifier with its leading `./` stripped, and when it has no extension, also that path with each of `.ts`, `.mjs`, `.js`, `.tsx` appended and with `/index.ts`, `/index.mjs`, `/index.js` appended; a bare specifier (`tinybase`, `node:fs`) and an absolute one yield nothing. Extra candidates cost nothing: an edge fires only when a candidate is a path the sibling's Files carry and the running task's do not, so a module of the target that no task creates never draws one. Python's `-c` argument and shell quoting are already inside the command string the parser holds — read the forms with regular expressions over the whole `cmd`, never by parsing the shell. The sample plans the probes below write are exactly: a `**Grammar:** claims-v1` line, `**Claim:** fixture (elicited)`, `**Goal:** fixture`, then two `### Task N:` sections each with `**Type:** implementation`, a Files block whose bullets are backticked (the parser reads a bare path as no file — the probes build the backtick with `chr(96)` because a `Run:` line may carry none), and a `**Proof:**` slot with one untagged `- Run:` bullet; no Machine line, so no tag. `tests/test_plan_parse.py`'s existing edge cases (`test_m4_proof_run_edge` with `python3 m4/p3.py --x`, `test_m4_interface_edge`, the write-after-create cases) are unchanged in what they pin, and the file gains nothing this task needs — it is in Files because the same tokenizer feeds every case there and a widened tokenizer that broke one would show there first.

**Proof:**
- Run: python3 -c "import tempfile, os, json, subprocess; d=tempfile.mkdtemp(); B=chr(96); p=os.path.join(d,'p.md'); open(p,'w').write('**Grammar:** claims-v1\n**Claim:** fixture (elicited)\n**Goal:** fixture\n\n### Task 1: A\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'tests/trends_fixtures.py'+B+'\n\n**Proof:**\n- Run: true\n\n### Task 2: B\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'app/x.py'+B+'\n\n**Proof:**\n- Run: python3 -c \"from tests.trends_fixtures import make_canon_fixture; make_canon_fixture()\"\n'); o=json.loads(subprocess.run(['python3','skills/ultrapowers/scripts/plan_parse.py',p],capture_output=True,text=True,check=True).stdout); assert o['dag_edges']==[{'from':'1','to':'2','why':'proof-run'}], o['dag_edges']" [M1]
- Run: python3 -c "import tempfile, os, json, subprocess; d=tempfile.mkdtemp(); B=chr(96); r=[]; [ (open(os.path.join(d,n+'.md'),'w').write('**Grammar:** claims-v1\n**Claim:** fixture (elicited)\n**Goal:** fixture\n\n### Task 1: A\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+cr+B+'\n\n**Proof:**\n- Run: true\n\n### Task 2: B\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'app/x.py'+B+'\n\n**Proof:**\n- Run: '+run+'\n'), r.append(json.loads(subprocess.run(['python3','skills/ultrapowers/scripts/plan_parse.py',os.path.join(d,n+'.md')],capture_output=True,text=True,check=True).stdout)['dag_edges'])) for n,cr,run in [('a','pkg/mod.py','python3 -c \"import pkg.mod; pkg.mod.go()\"'),('b','pkg/__init__.py','python3 -c \"from pkg import x\"')] ]; assert r==[[{'from':'1','to':'2','why':'proof-run'}]]*2, r" [M2]
- Run: python3 -c "import tempfile, os, json, subprocess; d=tempfile.mkdtemp(); B=chr(96); r=[]; [ (open(os.path.join(d,n+'.md'),'w').write('**Grammar:** claims-v1\n**Claim:** fixture (elicited)\n**Goal:** fixture\n\n### Task 1: A\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+cr+B+'\n\n**Proof:**\n- Run: true\n\n### Task 2: B\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'app/x.mjs'+B+'\n\n**Proof:**\n- Run: '+run+'\n'), r.append(json.loads(subprocess.run(['python3','skills/ultrapowers/scripts/plan_parse.py',os.path.join(d,n+'.md')],capture_output=True,text=True,check=True).stdout)['dag_edges'])) for n,cr,run in [('a','lib/a.mjs','node -e \"import(\\'./lib/a.mjs\\').then(m => m.a())\"'),('b','lib/b.ts','bun -e \"import {b} from \\'./lib/b\\'; b()\"')] ]; assert r==[[{'from':'1','to':'2','why':'proof-run'}]]*2, r" [M3]
- Run: python3 -c "import tempfile, os, json, subprocess; d=tempfile.mkdtemp(); B=chr(96); p=os.path.join(d,'p.md'); open(p,'w').write('**Grammar:** claims-v1\n**Claim:** fixture (elicited)\n**Goal:** fixture\n\n### Task 1: A\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'tests/trends_fixtures.py'+B+'\n\n**Proof:**\n- Run: true\n\n### Task 2: B\n\n**Type:** implementation\n\n**Files:**\n- Create: '+B+'app/x.py'+B+'\n\n**Proof:**\n- Run: python3 -c \"from tests.absent_fixture import make\"\n'); o=json.loads(subprocess.run(['python3','skills/ultrapowers/scripts/plan_parse.py',p],capture_output=True,text=True,check=True).stdout); assert o['dag_edges']==[], o['dag_edges']" [M4]
- Run: python3 -m pytest -q -n0 tests/test_plan_parse.py [M4, M5]
- Legs: (a) the Python `from … import` probe draws exactly the one `proof-run` edge from the creator to the runner [M1]; (b) `import pkg.mod` against `pkg/mod.py` and `from pkg import x` against `pkg/__init__.py` each draw the same edge [M2]; (c) a dynamic `import('./lib/a.mjs')` against `lib/a.mjs` and an extensionless `'./lib/b'` against `lib/b.ts` each draw the same edge [M3]; (d) an import of a module no sibling creates draws no edge, and the parser's existing edge sims still pin what they pinned [M4]; (e) the parser's sim file exits 0 [M5].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_parse.py`
- issue-closed: #1265

### Task 2: The engine keeps a proof-run edge hard under live pairs

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Modify: `factory/dispatch.mjs`
- Modify: `factory/policy.json`
- Modify: `fleet/tests/test_factory_refold_dispatch.mjs`

**Claim:** do: run a plan whose parser printed a `proof-run` edge; see: with live pairs on, the consumer waits for the producer's landing as it would for a write-after-create edge, and with the new cell rolled back it waits only as it did at BASE. (derived)
Machine: M1. `hardEdgePreds({ dagEdges, pairsLive, proofRunHard })`, exported from `factory/dispatch.mjs`, answers a `Map` of task id to `Set` of predecessor ids in which, for `dagEdges` `[{from:'1',to:'2',why:'write-after-create'},{from:'1',to:'3',why:'proof-run'},{from:'2',to:'4',why:'interface'}]`: with `pairsLive` true and `proofRunHard` true, `2` waits on `{1}`, `3` on `{1}`, `4` on `{}`; with `pairsLive` true and `proofRunHard` false, `2` on `{1}`, `3` on `{}`, `4` on `{}`; with `pairsLive` false, `2` on `{1}`, `3` on `{1}`, `4` on `{2}`.
M2. `factory/policy.json` carries `pairs.proof_run_hard` with `enabled` true, `n` 0, `window` `"none"`, `basis` `"judgment"`, `experiment` true and `rollback` exactly `enabled = false`; `pairs.mode` is still `live`.
M3. `factory/engine.mjs` builds its hard predecessor map through `hardEdgePreds` with `proofRunHard` read from that cell, and every other edge the parser printed still becomes a `pairs` entry the reader reads.
M4. `node fleet/tests/test_factory_refold_dispatch.mjs` and `node fleet/tests/test_factory_select.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** #1265 ("`readPairCandidate` runs after a producer lands and can flag a consumer, but cannot un-dispatch one"); CLAUDE.md §Doctrine (every threshold is a cell of `policy.json` carrying its `n`, `window`, `experiment` and `rollback`; a judgment is a question, a fact is code); `factory/engine.mjs` line 716–726 at BASE.

**Interfaces:**
- Consumes: `waitsFor({ taskId, hardPreds, chainPreds, policy }) -> { adoption, candidate }` (`factory/dispatch.mjs`, unchanged)
- Consumes: `parse_plan_full(text) -> tuple` (`plan_parse.py`, whose `dag_edges` carry `why` `proof-run` for a probe that imports a sibling's file once Task 1 lands; this task reads the `why` it already prints today for path literals)
- Produces: `hardEdgePreds({ dagEdges, pairsLive, proofRunHard }) -> Map`

**Context:** At BASE `factory/engine.mjs` lines 716–726 read: `const edgePreds = new Map(tasks.map((t) => [t.id, new Set(t.depends_on || [])]))` then `for (const edge of compiled.dag_edges || []) { if (pairsLive && edge.why !== 'write-after-create') continue; if (edgePreds.has(edge.to)) edgePreds.get(edge.to).add(edge.from) }`, with `pairsLive = pairsPolicy.mode === 'live'` two lines above and the comment "only the parser's `write-after-create` edges (every other edge the parser printed is instead a `pairs` entry M2 reads for itself)". This task moves that loop into `factory/dispatch.mjs` as `hardEdgePreds({ dagEdges, pairsLive, proofRunHard })` — pure, no disk, like `waitsFor` beside it — keeping `depends_on` seeding at the call site, where the engine reads `proofRunHard` as `(pairsPolicy.proof_run_hard || {}).enabled === true` and calls the function once; `pairsList` (the `pairs` entries the reader reads, line 714) is untouched, so a `proof-run` pair is still read and labelled — a hard edge and a pair label are two records of one fact, and the label is the reading. The kept `why` set under live mode is exactly `write-after-create` and, when the cell is enabled, `proof-run`; `interface` edges stay the reader's. The policy cell, exactly: `"proof_run_hard": { "enabled": true, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": "enabled = false", "unread": "#1265: run-1 on vibecoding-analyzer (2026-09-23, 17 tasks) started four consumers whose probes imported a sibling's created module at second zero — 11 red folds, 2 redispatches, ~50 min; a probe cannot import a file nobody has written, so a proof-run edge is a fact and stays hard. Pre-registered reading per release: red folds whose cause is a missing sibling file, and consumers held by this cell that Jev's pair label also read as chain" }`, placed inside the existing `pairs` object beside `t_changes_consumer`. `fleet/tests/test_factory_refold_dispatch.mjs` is the one sim that imports `factory/dispatch.mjs`; it drives `waitsFor` and is in Files so its import list can grow, not because any pin of it moves. `fleet/tests/test_factory_select.mjs` reads `compiled.pairs` through the engine's selection seam and is named as a guard that the engine still loads. The comment at line 716 is rewritten to say what the loop now keeps and why.

**Proof:**
- Run: node --input-type=module -e "import { hardEdgePreds } from './factory/dispatch.mjs'; const E = [{from:'1',to:'2',why:'write-after-create'},{from:'1',to:'3',why:'proof-run'},{from:'2',to:'4',why:'interface'}]; const s = (m, id) => JSON.stringify([...(m.get(id) || [])].sort()); const a = hardEdgePreds({ dagEdges: E, pairsLive: true, proofRunHard: true }); const b = hardEdgePreds({ dagEdges: E, pairsLive: true, proofRunHard: false }); const c = hardEdgePreds({ dagEdges: E, pairsLive: false, proofRunHard: true }); const got = [s(a,'2'),s(a,'3'),s(a,'4'),s(b,'2'),s(b,'3'),s(b,'4'),s(c,'2'),s(c,'3'),s(c,'4')]; const want = ['[\"1\"]','[\"1\"]','[]','[\"1\"]','[]','[]','[\"1\"]','[\"1\"]','[\"2\"]']; if (JSON.stringify(got) !== JSON.stringify(want)) { console.error({ got, want }); process.exit(1) }" [M1]
- Run: python3 -c "import json; p=json.load(open('factory/policy.json'))['pairs']; c=p['proof_run_hard']; assert p['mode']=='live' and c['enabled'] is True and c['n']==0 and c['window']=='none' and c['basis']=='judgment' and c['experiment'] is True and c['rollback']=='enabled = false', c" [M2]
- Run: grep -q 'hardEdgePreds(' factory/engine.mjs && grep -q 'proof_run_hard' factory/engine.mjs [M3]
- Run: node fleet/tests/test_factory_refold_dispatch.mjs 2>&1 | tail -n 1 | grep -q 'ALL TESTS PASSED' [M4]
- Run: node fleet/tests/test_factory_select.mjs 2>&1 | tail -n 1 | grep -q 'ALL TESTS PASSED' [M4]
- Legs: (a) the three tables of `hardEdgePreds` are exactly the pinned predecessor sets: live and enabled keeps write-after-create and proof-run, live and disabled keeps write-after-create only, off keeps all three [M1]; (b) the cell carries the pinned record keys and `pairs.mode` is still live [M2]; (c) the engine calls the function and reads the cell [M3]; (d) the two sims pass [M4].

**Stale-if:**
- path-absent: `factory/dispatch.mjs`
- issue-closed: #1265

### Task 3: The authoring rule says it in one line

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`

**Claim:** do: read the authoring skill's decomposition rule and its gotchas; see: one sentence in each says a probe that imports a sibling's created module is a proof-run edge the engine keeps hard, so the author neither writes an ordering for it nor lists the file under Modify to force one. (derived)
Machine: M1. `skills/ultrawrite/SKILL.md` §Decomposition judgment, item 1, carries the phrase `a probe that imports a sibling's created module` and, in the same paragraph, `proof-run` and `#1265`.
M2. `skills/ultrawrite/references/authoring-gotchas.md` carries a bullet that begins `- **A probe that imports the producer's created module is a proof-run edge` and names `run-1` and `#1265` in its body.

**Authorized-by:** #1265 ("Authoring gotcha row"); `skills/ultrawrite/SKILL.md` §Decomposition judgment ("a shared literal orders neither").

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** `skills/ultrawrite/SKILL.md` §Decomposition judgment item 1 ends "a shared literal orders neither, so prefer the literal wherever the consumer only needs the shape. Workers have no shared memory — a chain of two tasks is two strangers in sequence, not one mind holding a design — so a chain buys no coherence, only the wait." Append to that paragraph: "One thing a literal cannot stand in for is the file itself: a probe that imports a sibling's created module (`from tests.trends_fixtures import …`, `import('./lib/a.mjs')`) is a `proof-run` edge the parser derives and the engine keeps hard under live pairs (#1265), so write the probe as it is and list nothing under `Modify:` to force the wait — the wait is derived." The gotchas file gains one bullet under `## The rows`, after the `**An untagged \`Run:\` settles nothing.**` bullet, beginning exactly `- **A probe that imports the producer's created module is a proof-run edge, kept hard.**` and saying: on run-1 of vibecoding-analyzer (2026-09-23, 17 tasks) four consumers whose probes imported a file a sibling was creating were dispatched at second zero because the pair reader was asked about them; eleven folds were red on a module that did not exist and two implementers were re-dispatched (~50 min, n=1 run, #1265); since this plan the parser reads the import as the path it names and the engine keeps a `proof-run` edge as a hard predecessor, so the author writes the import and no ordering — and a Context that carries the shared shape as a literal is still right, because the literal is for the shape and the edge is for the file.

**Proof:**
- Run: sed -n '/^## Decomposition judgment/,/^## /p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q "a probe that imports a sibling's created module" && sed -n '/^## Decomposition judgment/,/^## /p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'proof-run' && sed -n '/^## Decomposition judgment/,/^## /p' skills/ultrawrite/SKILL.md | grep -q '#1265' [M1]
- Run: grep -q "^- \*\*A probe that imports the producer's created module is a proof-run edge" skills/ultrawrite/references/authoring-gotchas.md && sed -n "/^- \*\*A probe that imports the producer's created module/,/^- \*\*/p" skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -q 'run-1' && sed -n "/^- \*\*A probe that imports the producer's created module/,/^- \*\*/p" skills/ultrawrite/references/authoring-gotchas.md | grep -q '#1265' [M2]
- Legs: (a) the decomposition section carries the phrase, `proof-run` and the ticket number [M1]; (b) the gotchas carry the bullet with the pinned opening, `run-1` and the ticket number [M2].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #1265
