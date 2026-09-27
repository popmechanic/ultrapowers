# The catch counter reads the factory's fold catches

**Grammar:** claims-v1
**Claim:** The release catch report counts the catches a factory run makes: an existing test file a run turned red and then fixed reads one or more, not zero. (elicited)
**Summary:** This teaches the tally of which tests have ever caught a mistake to read how the current fleet engines record their test runs. It exists because the tally was written for the old engine and misses the moment the newer one catches a broken test after combining two pieces of work, so every release report has said every test caught nothing and no test deletion could rest on it. You get a report whose zeros mean what they say, with the plain caveat that runs on the new default engine never run the existing tests at all, so they add no catches.

**Goal:** `catch_counter.py` reads a `fold:verify` row's selected-test entries (`path`, attributed to the entry's `id`) and credits the fold re-attempt worker `impl:<id>:fold` as a fix round; and it judges a selected test's red by the engine's `catch` / `select:red-at-base` verdict rows, which the engine writes before the `select:landing` row, not after. The wave engine's `driver:*` rows stay readable.
**Closes:** #1324
**Tech Stack:** Python 3.9, standard library only; the counter's existing CLI (`--ledger FILE PATH`).
Spec: the 0.3.36 and 0.3.39 release notes (the ledger is "still blind to the factory's and the Flock's event kinds"); #778 (what a catch is); #1259 (the counter's first reading of the factory record).

## Global Constraints

- Check: python3 -m pytest -q tests/test_catch_counter.py tests/test_catch_report.py
- The counter stays read-only and advisory: no model call, no git write, no new file written besides the ledger it already appends to; a missing or malformed record is still an empty record, never a traceback.
- The row's shape is unchanged: `kind`, `runId`, `target`, `startedAt`, `driverRuns`, `catches`, `reds`, `touched`, `exercises`, `id`. No new key.
- The wave engine's rows (`driver:exam-run`, `driver:proof-run`, `driver:check-run`, a `worker:end` labelled `fix:<task>:<i>`) are read exactly as at BASE.
- No row kind is invented for the Flock engine: it records no run of an existing test file, so it contributes no catch.

### Task 1: A fold's selected-test reds are read and credited

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/catch_counter.py`

**Claim:** When a factory run's fold turns an existing test file red and the fold's re-attempt worker turns it green, the report counts it as that test's catch. (derived)
Machine: M1. A `fold:verify` row whose `ran[]` carries an entry `{"id": "1", "kind": "test", "path": P, "exit": 1}` (row `task` "2") is read as a run of P for task "1": with a `receipt.json` giving task 1 writes `["fleet/a.mjs"]` and task 2 writes `["fleet/b.mjs"]`, the row's `exercises` is exactly `{P: ["fleet/a.mjs"]}`. M2. That red, then a `dispatch:end` labelled `impl:1:fold`, then a second `fold:verify` row carrying the same entry with `exit` 0, gives `catches == {P: 1}`. M3. The same red and green with no `impl:1:fold` worker between them gives `catches == {}` and one red judged `rerun`.

**Authorized-by:** release notes 0.3.39 §Zero catches ("owed before any deletion rides on this reading"); #778; CLAUDE.md §Doctrine, Test doctrine (deletion is owed per file, on the reading)

**Interfaces:**
- Consumes: none
- Produces: `derive_catches(run_dir, target=None) -> dict`

**Context:** The factory (`factory/fold.mjs`, `runProofsAndChecks`) writes one `fold:verify` row per fold, `{kind: 'fold:verify', task: <the task just folded>, ran: [...], attempt: 1 | 2}`. Each `ran[]` entry is either `{id, kind: 'probe', cmd, exit}` (a task's own `Run:` line) or `{id, kind: 'test', path, exit}` (an existing test file the engine selected for task `id`, re-run on the folded tree); `id` is the task that owns the probe or test, which is usually not the row's `task`. `exit` is an integer (the counter's `_exit_int` already accepts a string). At BASE `_facts` flattens every `fold:verify` entry with the row's `task` and only `cmd`, so a `kind: 'test'` entry names no path and is neither exercised nor judged, and a probe entry is attributed to the wrong task.

When attempt 1 is red, the engine dispatches a re-attempt worker per owning task, labelled exactly `impl:<id>:fold` (`factory/fold.mjs`, the `role: 'implement'` dispatch), whose end is a `dispatch:end` row with that label; attempt 2 is the next `fold:verify` row. That worker is the factory's fix round for a fold red: read it beside `fix:<task>` (the referee-driven fix) and the wave engine's `fix:<task>:<i>`. A red turned green with no such worker between is still `rerun`; a path in the owning task's writes is still `task-writes`.

Real record, run-244 (2026-09-26, the one run in 223–247 read by hand for this; n=1 run): fold 2's attempt 1 was red on `fleet/tests/test_doctor_cloudflare.mjs` (ids 1 and 2) and `fleet/tests/test_launch_duplicate.mjs` (id 3); `impl:2:fold`, `impl:7:fold`, `impl:1:fold`, `impl:3:fold` ended; attempt 2 was green on both. The counter at BASE reads run-244 as `catches: {}`.

Rows the counter does not read, on purpose: `worker:test-run` (an implementer iterating on its own clone, not a measurement of a candidate); `fold:red` (a verdict beside the `fold:verify` entry it repeats). The Flock engine (`factory/flock/engine.mjs`, the default since 0.3.39) runs only each task's `Run:` probes and the plan's one check — never a selected existing test. Its `fold:verify` rows carry only `kind: 'probe'` entries, written once at landing when every fact is green, and its `test` rows (an agent's own `pytest` run) carry no path and no exit. So a Flock run can show a test file exercised, when a probe's command names it, and never a catch.

A probe writes a run directory holding `events.jsonl` (one JSON row per line) and `receipt.json` (`{"compile": {"tasks": [{"id", "writes"}]}}`), runs `python3 skills/ultrapowers/scripts/catch_counter.py --ledger <file> <dir>`, and reads the one row appended.

**Proof:**
- Run: python3 -c "import json,os,subprocess,tempfile; d=tempfile.mkdtemp(); r=os.path.join(d,'run-1'); os.makedirs(r); P='fleet/tests/test_a.mjs'; ev=[{'kind':'fold:verify','task':'2','attempt':1,'ran':[{'id':'1','kind':'test','path':P,'exit':1}]},{'kind':'dispatch:end','task':'1','label':'impl:1:fold','role':'implement'},{'kind':'fold:verify','task':'2','attempt':2,'ran':[{'id':'1','kind':'test','path':P,'exit':0}]}]; open(os.path.join(r,'events.jsonl'),'w').write(''.join(json.dumps(e)+chr(10) for e in ev)); json.dump({'compile':{'tasks':[{'id':'1','writes':['fleet/a.mjs']},{'id':'2','writes':['fleet/b.mjs']}]}},open(os.path.join(r,'receipt.json'),'w')); L=os.path.join(d,'l.jsonl'); subprocess.run(['python3','skills/ultrapowers/scripts/catch_counter.py','--ledger',L,r],check=True,capture_output=True); row=json.loads(open(L).read()); assert row['exercises']=={P:['fleet/a.mjs']}, row['exercises']" [M1]
- Run: python3 -c "import json,os,subprocess,tempfile; d=tempfile.mkdtemp(); r=os.path.join(d,'run-1'); os.makedirs(r); P='fleet/tests/test_a.mjs'; ev=[{'kind':'fold:verify','task':'2','attempt':1,'ran':[{'id':'1','kind':'test','path':P,'exit':1}]},{'kind':'dispatch:end','task':'1','label':'impl:1:fold','role':'implement'},{'kind':'fold:verify','task':'2','attempt':2,'ran':[{'id':'1','kind':'test','path':P,'exit':0}]}]; open(os.path.join(r,'events.jsonl'),'w').write(''.join(json.dumps(e)+chr(10) for e in ev)); json.dump({'compile':{'tasks':[{'id':'1','writes':['fleet/a.mjs']},{'id':'2','writes':['fleet/b.mjs']}]}},open(os.path.join(r,'receipt.json'),'w')); L=os.path.join(d,'l.jsonl'); subprocess.run(['python3','skills/ultrapowers/scripts/catch_counter.py','--ledger',L,r],check=True,capture_output=True); row=json.loads(open(L).read()); assert row['catches']=={P:1}, row" [M2]
- Run: python3 -c "import json,os,subprocess,tempfile; d=tempfile.mkdtemp(); r=os.path.join(d,'run-1'); os.makedirs(r); P='fleet/tests/test_a.mjs'; ev=[{'kind':'fold:verify','task':'2','attempt':1,'ran':[{'id':'1','kind':'test','path':P,'exit':1}]},{'kind':'fold:verify','task':'2','attempt':2,'ran':[{'id':'1','kind':'test','path':P,'exit':0}]}]; open(os.path.join(r,'events.jsonl'),'w').write(''.join(json.dumps(e)+chr(10) for e in ev)); json.dump({'compile':{'tasks':[{'id':'1','writes':['fleet/a.mjs']}]}},open(os.path.join(r,'receipt.json'),'w')); L=os.path.join(d,'l.jsonl'); subprocess.run(['python3','skills/ultrapowers/scripts/catch_counter.py','--ledger',L,r],check=True,capture_output=True); row=json.loads(open(L).read()); assert row['catches']=={} and [x['outcome'] for x in row['reds']]==['rerun'], row" [M3]
- Legs: (a) a fold test entry for id 1 on a row for task 2 exercises P under task 1's writes and no other [M1]; (b) red, `impl:1:fold`, green credits P exactly once [M2]; (c) red then green with no fold worker between credits nothing and judges the red `rerun` [M3].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/catch_counter.py`

### Task 2: A selected test's red is judged by the verdict the engine wrote before it

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/catch_counter.py`

**Claim:** A selected test the engine judged a catch reads as caught in the run's row, and one it judged red at base reads as stayed red. (derived)
Machine: M1. With a `catch` row `{task: "1", path: P, exit: 1}` followed by a `select:landing` row for task 1 whose `ran[]` carries `{path: P, exit: 1}`, the row's `reds[]` judges P `caught` and `catches[P]` is 1. M2. With a `select:red-at-base` row `{task: "1", path: Q}` followed by that same `select:landing` row also carrying `{path: Q, exit: 1}`, `reds[]` judges Q `stayed-red`.

**Authorized-by:** #1259 (the factory's verdict rows are how a selected red is judged); release notes 0.3.39 §Zero catches

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `factory/measure.mjs` runs a candidate's selected tests, then for each red re-runs it at the anchor and appends its verdict — `{kind: 'catch', task, path, exit}` when green at the anchor, `{kind: 'select:red-at-base', task, path}` when red there too — and only after all of them appends the `{kind: 'select:landing', task, ran: [{path, exit}], ...}` row. So the verdict row always comes before the `select:landing` row it judges. At BASE the counter's `_verdict_after` looks only after the flattened `select:landing` entry, finds nothing, and judges every selected red `no-green`. The credit itself is already right: a `catch` row credits its path once on its own, and judging the red `caught` must not credit it a second time, so `catches[P]` stays 1. The row's `reds[]` entries keep their shape `{task, kind, path, cmd, outcome}`.

A probe writes a run directory holding `events.jsonl` (one JSON row per line) and `receipt.json` (`{"compile": {"tasks": [{"id", "writes"}]}}`), runs `python3 skills/ultrapowers/scripts/catch_counter.py --ledger <file> <dir>`, and reads the one row appended.

**Proof:**
- Run: python3 -c "import json,os,subprocess,tempfile; d=tempfile.mkdtemp(); r=os.path.join(d,'run-1'); os.makedirs(r); P='fleet/tests/test_a.mjs'; Q='fleet/tests/test_b.mjs'; ev=[{'kind':'catch','task':'1','path':P,'exit':1},{'kind':'select:red-at-base','task':'1','path':Q},{'kind':'select:landing','task':'1','ran':[{'path':P,'exit':1},{'path':Q,'exit':1}]}]; open(os.path.join(r,'events.jsonl'),'w').write(''.join(json.dumps(e)+chr(10) for e in ev)); json.dump({'compile':{'tasks':[{'id':'1','writes':['fleet/a.mjs']}]}},open(os.path.join(r,'receipt.json'),'w')); L=os.path.join(d,'l.jsonl'); subprocess.run(['python3','skills/ultrapowers/scripts/catch_counter.py','--ledger',L,r],check=True,capture_output=True); row=json.loads(open(L).read()); assert [(x['path'],x['outcome']) for x in row['reds']]==[(P,'caught'),(Q,'stayed-red')] and row['catches']=={P:1}, row" [M1, M2]
- Legs: (a) the red P preceded by its `catch` row is judged `caught` and P is credited exactly once [M1]; (b) the red Q preceded by its `select:red-at-base` row is judged `stayed-red` [M2].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/catch_counter.py`
