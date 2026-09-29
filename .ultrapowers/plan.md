# Engine cleanup for 0.3.43: the switches no launch uses, the factory's record rows, and a doctor on the lobby's readers

**Grammar:** claims-v1
**Claim:** After this run, the engine has no switch a launch never sets, the pull request card and the status page show only what the Flock really records, the doctor answers with the same rows while reading exe.dev the way the launcher does, and the next five runs pull in only the changes their own task touches. (elicited)
**Summary:** This is a cleanup of the engine and the laptop tools from the 2026-09-29 review, plus a five-run trial in which each builder takes in only the work that touches its own task. The engine still carries a dozen switches and a few record rows left over from the retired factory that no launch sets and nothing reads, the doctor keeps its own copy of what the launcher already knows how to read from exe.dev, and on one run most conflicted pulls reached builders whose task never touched that file (n=1 run, run-268). You get less code to trust, a pull request card and status page that show only what is real, a doctor that cannot drift from the launcher, and after five runs a measured answer on narrow pulls, which is an experiment whose rollback is one setting back to pulling everything.

**Goal:** Delete the twelve engine flags no launch passes and the non-default branches they select; trial `flock.pulls.mode = narrow` for 5 runs; drop the `fold:verify` row, its audit check, and the stand-in `k`/`factsExit` landing fields and PR-card cells; drop the always-null status.json cells; make `fleet/doctor.mjs` read exe.dev through `fleet/lobby.mjs`'s exec seam and readers.
**Tech Stack:** Node (engine, record, doctor, lobby), JSON (policy), Markdown (contract)
**Spec:** none — the operator's 2026-09-29 review decisions (engine and fleet half); readings: run-268 events (15 conflict-marked pulls, 13 to builders whose task never touched the file, n=1 run)

## Global Constraints

- A launch's command line is unchanged: `factory/boot.sh` passes `--plan`, `--target`, `--base`, `--run-dir` and the kata flags, and the sims pass `--builder`, `--clock` and `--stall-minutes`; every one of those still works.
- The doctor's nine row ids, their order, and its `--json` shape are unchanged.
- Check: python3 -m pytest -q

### Task 1: The engine keeps only the switches a launch sets

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** After this run, the engine has no switch a launch never sets, and every run behaves as the default of each removed switch did. (derived)
Machine: M1. `factory/flock/engine.mjs` reads none of the twelve flags `--agents`, `--cap`, `--model`, `--settle`, `--publish`, `--done-ends`, `--tool-search`, `--brief`, `--stdin`, `--early-close`, `--order`, `--pulls`: the count of `arg('<flag>'` reads of those names in the file is 0. M2. The branches those flags selected away from their defaults are gone with the constants that held them: the count of lines naming `ELASTIC`, `SETTLE`, `PUBLISH`, `DONE_ENDS`, `TOOL_SEARCH`, `EARLY_CLOSE`, `BRIEF`, `STDIN` or `ORDER` in the file is 0. M3. Each default is kept: the scripted delete run still settles green and prints `DELETE OK`.

**Authorized-by:** operator, 2026-09-29 (review decision 1: delete the flags no launch passes, keep each default)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** No launch or sim passes any of the twelve: `factory/boot.sh` passes `--plan --target --base --run-dir` and the kata flags; the sims (`fleet/tests/test_flock_scope.mjs`, `flock_delete_probe.mjs`, `flock_jev_trials_probe.mjs`) pass `--builder`, `--clock`, `--stall-minutes` (grep at base 8dd30474 across `fleet/tests`, `tests`, `factory`, `fleet/*.mjs`: no hit for any of the twelve outside the engine). Keep `--builder`, `--clock`, `--quiet`, `--stall-minutes` and the kata flags.

Each flag's default becomes the only behaviour: an elastic pool capped at 16 (no fixed pool, no `NAMES` seeded builders); model `claude-opus-5-5`; settling `tested` (the `quiet` and `debounce` modes go; the debounce that guards an untested publish in `tested` stays); publish `explicit` (no after-batch publish, so the `dirty` map goes); `done` ends the copy (publishes, marks done, refuses later edits); tool search off (the `ENABLE_TOOL_SEARCH: 'false'` env always); the digest brief (no "Start with board_read"); every Bash command runs with stdin closed; early close `held`; board order `chain` (pass nothing, so `makeBoard` takes its own default, or pass `'chain'`).

The pull mode stays selectable, but only from the policy cell: `flock.pulls.mode` in `factory/policy.json` (`all` when absent), and a value other than `narrow` or `all` still exits 2, now naming the policy cell. `factory/flock/pulls.mjs` stays as it is.

The `start` event row and `summary.json` may keep their keys with the constant values (readers of those rows are not changed by this task). The file's header usage comment lists only the flags that remain. A sibling task in this plan edits the `land()` function of the same file (the landing rows); leave that region alone.

**Proof:**
- Run: test "$(grep -cE "arg\('(agents|cap|model|settle|publish|done-ends|tool-search|brief|stdin|early-close|order|pulls)'" factory/flock/engine.mjs)" = 0 [M1]
- Run: test "$(grep -cE 'ELASTIC|\bSETTLE\b|\bPUBLISH\b|DONE_ENDS|TOOL_SEARCH|EARLY_CLOSE|\bBRIEF\b|\bSTDIN\b|\bORDER\b' factory/flock/engine.mjs)" = 0 [M2]
- Run: node fleet/tests/flock_delete_probe.mjs | grep -qx 'DELETE OK' [M3]
- Run: python3 -m pytest -q tests/test_fleet_suite.py -k test_flock_scope
- Run: node fleet/tests/flock_jev_trials_probe.mjs release | grep -qx 'JEV TRIALS release OK'
- Legs: (a) no `arg('…'` read of any of the twelve flag names is left in the engine [M1]; (b) no line names any of the nine constants that carried a non-default branch [M2]; (c) the scripted delete run exits green and lands its one commit, so the kept defaults still settle a run [M3].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`

### Task 2: Five runs trial narrow pulls

**Type:** implementation

**Files:**
- Modify: `factory/policy.json`

**Claim:** For the next five runs, each builder takes in only the changes its own task touches, and the policy says what reading decides whether that stays. (derived)
Machine: M1. `factory/policy.json`'s `flock.pulls` cell has `mode` `"narrow"`, `rollback` `"mode = all"` and `experiment` `true`. M2. Its `unread` names the reading: the conflict-marked pull notes each builder got in files outside its own task, and run cost, against runs 268–272 — the text carries `268`, `272`, `conflict` and `cost`.

**Authorized-by:** operator, 2026-09-29 (review decision 2: trial narrow pulls for 5 runs)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The evidence is one run (n=1 run, run-268): 15 conflict-marked pulls, 13 of them to builders whose task never touched the file. That is under the n = 5 runs floor, so the cell stays an experiment with its rollback. Set `n`, `window` and `basis` to say the reading (n 1, window run-268). The engine already reads this cell (`POLICY_FLOCK.pulls.mode`) and `factory/flock/pulls.mjs` implements `narrow`; nothing else changes. The scripted flock sims read this same file, so they run narrow once it lands.

**Proof:**
- Run: python3 -c "import json;p=json.load(open('factory/policy.json'))['flock']['pulls'];assert p['mode']=='narrow' and p['rollback']=='mode = all' and p['experiment'] is True" [M1]
- Run: python3 -c "import json;u=json.load(open('factory/policy.json'))['flock']['pulls']['unread'];assert all(w in u for w in ['268','272','conflict','cost'])" [M2]
- Run: python3 -m pytest -q tests/test_fleet_suite.py -k test_flock_scope
- Run: node fleet/tests/flock_delete_probe.mjs | grep -qx 'DELETE OK'
- Legs: (a) the pulls cell reads `narrow` with its `mode = all` rollback and `experiment` true [M1]; (b) its `unread` names runs 268 and 272, conflict-marked pulls and cost [M2].

**Stale-if:**
- path-absent: `factory/flock/pulls.mjs`

### Task 3: The record carries only what the Flock writes

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/audit.mjs`
- Modify: `factory/record.mjs`
- Modify: `factory/boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/_boot_helpers.mjs`
- Modify: `fleet/tests/test_factory_boot.mjs`
- Modify: `fleet/tests/test_factory_record.mjs`

**Claim:** After this run, the pull request card and the status page show only what the Flock really records. (derived)
Machine: M1. A settled Flock run writes no `fold:verify` row and exactly one `landing` row per task, carrying `candidateSha` and neither `k` nor `factsExit`: in the scripted delete run, the events hold 0 `fold:verify` rows and 1 `landing` row. M2. `auditRows` asks no `fold:verify` question: over one `landing` row with `state: 'done'` and no `bound`, `missing` is `[]`. M3. `record.mjs pr-body` prints each landing row as `| <task> | <candidateSha> |`: for a landing row of task 1 with `candidateSha` `abc`, the body carries the line `| 1 | abc |`. M4. `record.mjs status` writes no `disclosures` cell, and each task's cell carries `state` and `park` only: over one `landing` row for task 1 and one `parked` row for task 2 with reason `r`, `tasks` is `{"1": {"state": "folded", "park": null}, "2": {"state": "failed", "park": "r"}}`. M5. `fleet/CONTRACT.md` says the same: its status.json entry names no `wave`, `lastProof`, `blockedBy`, `attention`, `disclosures` or `examining`, and its Publish entry spells the row `| <task> | <candidateSha> |`.

**Authorized-by:** operator, 2026-09-29 (review decisions 3 and 4: old record rows; status.json)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** In `factory/flock/engine.mjs`'s `land()`, the settled path writes a `fold:verify` row and a `landing` row per task (`k: sessionsOf(id)`, `factsExit: 0` stand-ins for the retired factory); keep one `landing` row per task with `task` and `candidateSha`, and drop the `fold:verify` row, `k`, `factsExit` (and `sessionsOf` if nothing else uses it). A sibling task in this plan deletes engine flags elsewhere in the same file; leave those regions alone.

`factory/audit.mjs`: the `state: 'done'` check that lists `fold:verify task <id>` goes; the `bound` checks (`board:close task <id>`, `board:close run`, `board:leave`) stay, still over the landed tasks. Update its header comment.

`factory/record.mjs`: `landingRowLines` prints `| <task> | <candidateSha> |`; `renderStatus` drops `disclosures` (hard-coded null today), so the page has twelve cells, `tasks` still last; `projectTasks` gives each task `{state, park}` only (`wave`, `role`, `lastProof`, `attention`, `blockedBy` are always null today). Fix the "thirteen" wording in its comments and in `factory/boot.sh`'s comment above `write_status`.

Readers of status.json read only the run's top-level `state`/`phase`/`pr` (`fleet/janitor.mjs`, `fleet/board-read.mjs`; the launcher's duplicate check reads the VM comment, not the page), so none needs a change. The sims pin the old shape and move with it: `fleet/tests/_boot_helpers.mjs` (`EXPECTED_STATUS_KEYS`, and the fixture `landing` row it prints with `k`/`factsExit`), `fleet/tests/test_factory_boot.mjs` (the status `tasks` deep-equal and the expected PR body `| 1 | 1 | 0 | <sha> |`), `fleet/tests/test_factory_record.mjs` (`STATUS_KEYS`, `expectedTasks`, and the `| 1 | 1 | 0 | abc |` bodies in legs c and after).

`fleet/CONTRACT.md` line ~384 (`- **status.json:**`) and its paragraph on the `tasks` cell (one key per task, its state `folded` or `failed` and its `park` detail) describe what the Flock writes; the run's own `state` sequence stays as written. Line ~421 (Publish) spells the row `| <task> | <candidateSha> |`.

**Proof:**
- Run: d=$(mktemp -d) && sed -e '/fs.rmSync(tmp/d' -e 's#^const REPO = .*#const REPO = process.cwd()#' fleet/tests/flock_delete_probe.mjs > $d/p.mjs && TMPDIR=$d node $d/p.mjs | grep -qx 'DELETE OK' && python3 -c "import json,glob,sys;rows=[json.loads(l) for l in open(glob.glob(sys.argv[1]+'/flock-delete-*/run/events.jsonl')[0]) if l.strip()];ls=[r for r in rows if r['kind']=='landing'];assert not [r for r in rows if r['kind']=='fold:verify'] and len(ls)==1 and 'k' not in ls[0] and 'factsExit' not in ls[0] and ls[0].get('candidateSha')" $d [M1]
- Run: node --input-type=module -e "import('./factory/audit.mjs').then((m)=>process.exit(m.auditRows([{kind:'landing',task:1}],{state:'done'}).missing.length===0?0:1))" [M2]
- Run: d=$(mktemp -d) && printf '# T\n\n**Summary:** S.\n' > $d/p.md && printf '{"kind":"landing","task":1,"candidateSha":"abc"}\n' > $d/e.jsonl && node factory/record.mjs pr-body $d/p.md --events $d/e.jsonl > $d/o && grep -qx '| 1 | abc |' $d/o [M3]
- Run: d=$(mktemp -d) && printf '{"kind":"landing","task":1}\n{"kind":"parked","task":2,"reason":"r"}\n' > $d/e.jsonl && node factory/record.mjs status run=5 state=done --events $d/e.jsonl > $d/s.json && python3 -c "import json,sys;s=json.load(open(sys.argv[1]));assert 'disclosures' not in s and s['tasks']=={'1':{'state':'folded','park':None},'2':{'state':'failed','park':'r'}}" $d/s.json [M4]
- Run: test "$(sed -n '/^- \*\*status.json:\*\*/,/^- \*\*Publish:\*\*/p' fleet/CONTRACT.md | grep -cE 'wave|lastProof|blockedBy|attention|disclosures|examining')" = 0 [M5]
- Run: grep -qF '| <task> | <candidateSha> |' fleet/CONTRACT.md [M5]
- Run: python3 -m pytest -q tests/test_fleet_suite.py -k "test_factory_record or test_factory_boot or test_factory_publish or test_factory_preflight"
- Run: bash -n factory/boot.sh
- Legs: (a) the scripted delete run's events hold no `fold:verify` row and one `landing` row with a `candidateSha` and no `k` or `factsExit` [M1]; (b) a done run with one landing row audits to an empty `missing` [M2]; (c) the PR body's landing line is exactly `| 1 | abc |` [M3]; (d) the status page has no `disclosures` key and its `tasks` cell is exactly the two `{state, park}` entries — a page only `record.mjs status` writes [M4]; (e) the contract's status.json entry names none of the six retired words [M5]; (f) the contract spells the PR row `| <task> | <candidateSha> |` [M5].

**Stale-if:**
- path-absent: `factory/audit.mjs`

### Task 4: The doctor reads exe.dev through the lobby

**Type:** implementation

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/tests/test_doctor_claude.mjs`
- Modify: `fleet/tests/test_doctor_cloudflare.mjs`

**Claim:** After this run, the doctor answers with the same rows while reading exe.dev the way the launcher does. (derived)
Machine: M1. `listIntegrations`'s rows also carry `bearer` (true when the entry's `config_summary`, or a string of its `config.headers`, carries `Authorization:Bearer` with spaces ignored), `comment` (the entry's comment string, or null) and `tags` (the tag names its attachments and its own `tags` field name): for a listing of one entry with `config_summary` `Authorization: Bearer z`, `comment` `account=a` and attachment `tag:fleet`, the row's `bearer` is true, `comment` is `account=a` and `tags` holds `fleet`. M2. `fleet/doctor.mjs` imports `listIntegrations`, `readPlanCapacity` and `parseJson` from `./lobby.mjs` and defines no `readJson` or `parseIntegrations` of its own. M3. Its `--json` rows are unchanged: over a stubbed exe.dev (PATH shims for `ssh` and `security`), the rows other than `verb-drift` hash to the sha256 they had at base, `3630327336a69a0c262fde08f2eeaa3faf891c1db3db2036e1677c3430e57415`. M4. A banner line printed before the `integrations list --json` and `billing plan --json` answers leaves those rows exactly as they are without it.

**Authorized-by:** operator, 2026-09-29 (review decision 5: the doctor uses the lobby's parsers)

**Interfaces:**
- Consumes: none
- Produces: `listIntegrations(exec) -> [{ name, repository, attachments, bearer, comment, tags }]`

**Context:** `fleet/doctor.mjs` hand-writes its reads as shell strings (`READS`, `policyRead`, `help <verb>`: `ssh exe.dev "…"` through `/bin/sh -c`) and parses them itself (`readJson`, `parseIntegrations` with `hasBearer`/`attachedTags`/`isGithub`, the billing fields in `poolRow`, the `ls kata-hub --json` rows). `fleet/lobby.mjs` has the exec seam `defaultExec(cmd, argv, options)` → `{code, stdout, stderr}` (execFile, no shell), `lobby(exec, remote)` (throws `LobbyError` on a non-zero exit, carrying the output), `listIntegrations`, `readPlanCapacity` (throws when `max_cpus` is not a number; `max_memory_gb` absent reads 0), `listVms`, `parsePolicy` and `parseJson` (tolerates a leading banner line). Move the doctor onto that seam and those readers: the doctor's `ssh` reads become `exec('ssh', ['exe.dev', '<remote>'])` (directly or through `lobby`), its `claude-token.mjs` reads `exec('node', [CLAUDE_TOKEN, …])`. Extend `listIntegrations` with `bearer`, `comment`, `tags` (move the doctor's `hasBearer`/`attachedTags` logic there) — additive, so `fleet/launch.mjs`, `fleet/target.mjs` and `fleet/kata-hub.mjs` keep working; the doctor keeps its own GitHub-ness test if lobby has none.

Every row must read exactly as before. The traps: `lobby()` throws on a non-zero exit, where today's details say `answered code <n>` — catch it and keep the code (e.g. read `exec` directly and parse with the lobby's parsers); the claude row's token status is the first line of stdout and stderr joined (claude-token logs its status line on stderr), so join them as today; the capacity row stays red when `max_memory_gb` is not a number; the verb-drift row's `help unreadable (code <n>)` keeps its code. The row detail strings that tell the operator to run `ssh exe.dev "…"` (the policy fixes, the verb-drift re-capture) are text for the operator and stay.

The M3/M4 probe runs `node fleet/doctor.mjs --json --config <tmp>/fleet.json --target o/r` with `HOME` a temp dir and `PATH` led by a temp dir holding an `ssh` shim (answers keyed on its argv joined by spaces, exit 1 for anything else) and a `security` shim that exits 1 (so `claude-token.mjs` finds no keychain entry and fetches nothing). The frozen sha was computed at base 8dd30474 with the verb-drift row left out, because that row also depends on `fleet/exe-verbs.json`; keep the verb-drift row's text unchanged all the same. At base the bannered run turns the capacity and claude rows red, since the doctor's own JSON reader takes no banner.

The two sims stub the doctor's reads by whole command string (`KNOWN` maps keyed `ssh exe.dev "…"`; `policyRead('cloudflare')`); re-key them on the new seam's `(cmd, argv)` and keep every assertion they make about rows.

**Proof:**
- Run: node --input-type=module -e "import('./fleet/lobby.mjs').then(async (m)=>{const rows=await m.listIntegrations(async()=>({code:0,stdout:JSON.stringify([{name:'k',config_summary:'Authorization: Bearer z',comment:'account=a',attachments:['tag:fleet']}]),stderr:''}));const r=rows[0];process.exit(r.bearer===true&&r.comment==='account=a'&&[...r.tags].includes('fleet')?0:1)})" [M1]
- Run: python3 -c "import re;s=open('fleet/doctor.mjs').read();m=re.search(r'import \{([^}]*)\} from .\./lobby\.mjs.',s);assert m and all(n in m.group(1) for n in ['listIntegrations','readPlanCapacity','parseJson']);assert not re.search(r'^((async )?function|const|let) (readJson|parseIntegrations)\b',s,re.M)" [M2]
- Run: node --input-type=module -e "const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),cp=await import('node:child_process'),cr=await import('node:crypto');const run=(banner)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'doc-'));const B=banner?'Welcome to exe.dev\n':'';const L=[{name:'claude-max',config_summary:'Authorization:Bearer x',comment:'account=a@b.c',attachments:['tag:fleet']},{name:'gh-o-r',repository:'o/r',attachments:['tag:fleet']},{name:'kata',config_summary:'Authorization:Bearer y',attachments:['vm:fleet-r1-2609290000-abcd']},{name:'cloudflare',attachments:[]}];const A={'exe.dev whoami':[0,'me@b.c\n'],'exe.dev billing plan --json':[0,B+JSON.stringify({max_cpus:16,max_memory_gb:64,tier:'pro',plan:'p'})],'exe.dev integrations list --json':[0,B+JSON.stringify(L)],'exe.dev integrations setup github --list':[0,'GitHub accounts:\n  me\n'],'exe.dev integrations policy get kata --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'1'})],'exe.dev integrations policy get cloudflare --json':[0,JSON.stringify({policy:{selector:'tag:other'},revision:'2'})],'exe.dev integrations policy get claude-max --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'3'})],'exe.dev integrations policy get gh-o-r --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'4'})],'exe.dev ls kata-hub --json':[0,JSON.stringify({vms:[{vm_name:'kata-hub',status:'running'}]})],'exe.dev help new':[0,'Options:\n  --json  x\n']};fs.writeFileSync(path.join(d,'answers.json'),JSON.stringify(A));fs.writeFileSync(path.join(d,'ssh'),'#!/usr/bin/env node\nconst a=JSON.parse(require(\'fs\').readFileSync(process.env.DOCTOR_ANSWERS,\'utf8\'));const r=a[process.argv.slice(2).join(\' \')];if(!r)process.exit(1);process.stdout.write(r[1]);process.exit(r[0])\n',{mode:0o755});fs.writeFileSync(path.join(d,'security'),'#!/bin/sh\nexit 1\n',{mode:0o755});fs.writeFileSync(path.join(d,'fleet.json'),JSON.stringify({cpu:'4',memory:'16GB',account:'a@b.c'}));const r=cp.spawnSync('node',['fleet/doctor.mjs','--json','--config',path.join(d,'fleet.json'),'--target','o/r'],{encoding:'utf8',env:{...process.env,HOME:d,DOCTOR_ANSWERS:path.join(d,'answers.json'),PATH:d+':'+process.env.PATH}});return JSON.stringify(JSON.parse(r.stdout).rows.filter(x=>x.id!=='verb-drift'))};const a=run(false);process.exit(cr.createHash('sha256').update(a).digest('hex')==='3630327336a69a0c262fde08f2eeaa3faf891c1db3db2036e1677c3430e57415'?0:1)" [M3]
- Run: node --input-type=module -e "const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),cp=await import('node:child_process'),cr=await import('node:crypto');const run=(banner)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'doc-'));const B=banner?'Welcome to exe.dev\n':'';const L=[{name:'claude-max',config_summary:'Authorization:Bearer x',comment:'account=a@b.c',attachments:['tag:fleet']},{name:'gh-o-r',repository:'o/r',attachments:['tag:fleet']},{name:'kata',config_summary:'Authorization:Bearer y',attachments:['vm:fleet-r1-2609290000-abcd']},{name:'cloudflare',attachments:[]}];const A={'exe.dev whoami':[0,'me@b.c\n'],'exe.dev billing plan --json':[0,B+JSON.stringify({max_cpus:16,max_memory_gb:64,tier:'pro',plan:'p'})],'exe.dev integrations list --json':[0,B+JSON.stringify(L)],'exe.dev integrations setup github --list':[0,'GitHub accounts:\n  me\n'],'exe.dev integrations policy get kata --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'1'})],'exe.dev integrations policy get cloudflare --json':[0,JSON.stringify({policy:{selector:'tag:other'},revision:'2'})],'exe.dev integrations policy get claude-max --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'3'})],'exe.dev integrations policy get gh-o-r --json':[0,JSON.stringify({policy:{selector:'tag:fleet'},revision:'4'})],'exe.dev ls kata-hub --json':[0,JSON.stringify({vms:[{vm_name:'kata-hub',status:'running'}]})],'exe.dev help new':[0,'Options:\n  --json  x\n']};fs.writeFileSync(path.join(d,'answers.json'),JSON.stringify(A));fs.writeFileSync(path.join(d,'ssh'),'#!/usr/bin/env node\nconst a=JSON.parse(require(\'fs\').readFileSync(process.env.DOCTOR_ANSWERS,\'utf8\'));const r=a[process.argv.slice(2).join(\' \')];if(!r)process.exit(1);process.stdout.write(r[1]);process.exit(r[0])\n',{mode:0o755});fs.writeFileSync(path.join(d,'security'),'#!/bin/sh\nexit 1\n',{mode:0o755});fs.writeFileSync(path.join(d,'fleet.json'),JSON.stringify({cpu:'4',memory:'16GB',account:'a@b.c'}));const r=cp.spawnSync('node',['fleet/doctor.mjs','--json','--config',path.join(d,'fleet.json'),'--target','o/r'],{encoding:'utf8',env:{...process.env,HOME:d,DOCTOR_ANSWERS:path.join(d,'answers.json'),PATH:d+':'+process.env.PATH}});return JSON.stringify(JSON.parse(r.stdout).rows.filter(x=>x.id!=='verb-drift'))};process.exit(run(true)===run(false)?0:1)" [M4]
- Run: python3 -m pytest -q tests/test_fleet_suite.py -k "test_doctor or test_launch_credential or test_launch_duplicate"
- Legs: (a) a one-entry listing through `listIntegrations` yields `bearer` true, `comment` `account=a` and a `tags` holding `fleet` [M1]; (b) the doctor's lobby import names the three readers and it defines no JSON or listing parser of its own [M2]; (c) the stubbed doctor's rows other than verb-drift hash to the base sha `3630327336a69a0c262fde08f2eeaa3faf891c1db3db2036e1677c3430e57415` [M3]; (d) the same doctor with a banner before the listing and billing answers prints the identical rows [M4].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`
