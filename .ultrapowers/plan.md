# Beliefs say who they're for

**Grammar:** claims-v1
**Claim:** When a builder is sure something is wrong with the engine itself, it says so in a way I see on the Kata board and in --follow while the run is still going, and every belief a builder posts is kept in the run's record as data, marked by who it's for. (elicited)
**Summary:** Builders already post short beliefs to each other during a run, and they are often right: in run-252 a builder named the real cause, copies that were not git checkouts, at 0.9 confidence, while the run spent 3.8 hours and $80 without anyone seeing it. Each belief now says whether it is about the builder's own task, the app being built, or the engine running it, and a confident belief about the engine shows up on the Kata board and in --follow at once. Every belief stays in the run's record as data a later agent can look up, and the failure.md page is removed, since everything in it was already stored as data and a page of prose only makes the next agent re-read it.

**Goal:** Route builders' beliefs by who they are for, surface engine beliefs live, and drop failure.md (operator, 2026-09-28).
**Tech Stack:** Node 24 (ESM); bash (`factory/boot.sh`); `factory/policy.json`.

Spec: this session's design, 2026-09-28. Beliefs are tuples on the blackboard; the next agent reads them by template (a later plan), so the record holds data, never prose an agent must interpret.

## Global Constraints

- Reading behind it (runs 247, 252, 257 and radio-station runs 1 and 2, 2026-09-26..28, n=5 runs): 4 builder beliefs in all, every one at confidence 0.85 or more and every one correct; run-252's was the root cause #1330 later fixed.
- A belief is a tuple `{by, claim, confidence, about, task}`: `about` is exactly one of `task`, `app` or `engine`, and `claim` is at most 300 characters.
- A surfaced engine belief's comment body is exactly `engine belief (<confidence>) from <builder>: <claim>`, posted to the belief's task issue, or to the run issue when the belief names no task the record knows; fire-and-forget, like every Kata post.
- The surfacing threshold is `factory/policy.json` `flock.surface.min_confidence` (0.8); rollback: `min_confidence = 2`, which surfaces nothing.
- No stored artifact is prose an agent must interpret: `failure.md` is gone, and `red-checks.json` and the event rows stay.
- Check: python3 -m pytest -q tests/test_fleet_suite.py -k "boot or board_read"

### Task 1: The Kata mirror surfaces a confident engine belief

**Type:** implementation

**Files:**
- Modify: `factory/flock/kata_mirror.mjs`

**Claim:** When a builder is sure something is wrong with the engine itself, it says so in a way I see on the Kata board while the run is still going. (derived)
Machine: M1. Over the stand-in board with task `1` at uid `U1` and `runUid` `R1`, posting an `engine` belief at 0.9 on task `1`, an `app` belief at 0.9, an `engine` belief at 0.5, and an `engine` belief at 0.85 with no task sends exactly two comments, in order: `engine belief (0.9) from A: copies have no .git` on `U1`, and `engine belief (0.85) from B: the check needs a git checkout` on `R1`.

**Authorized-by:** operator, 2026-09-28 ("Tag beliefs, surface engine ones")

**Interfaces:**
- Consumes: `mirrorBoard(board, { kata, projectId, tasks, onPost })`
- Produces: `mirrorBoard(board, { kata, projectId, tasks, onPost, track, runUid, surfaceAt })`

**Context:** `mirrorBoard` in `factory/flock/kata_mirror.mjs` already wraps `claim`, `release`, `reopen` and `done` and posts through a per-issue queue (never awaited by the board). Wrap `board.post` too: after the original returns, a belief whose `about` is `engine` and whose `confidence` is at least `surfaceAt` (default 0.8) is posted as `engine belief (<confidence>) from <builder>: <claim>`, the claim cut to 300 characters, to the uid of its `task` when `tasks` has one, else to `runUid`; with neither it is reported skipped, as a task with no issue is today. Beliefs about `task` or `app`, and engine beliefs under the threshold, post nothing. The same `onPost` report and `track` hook apply.

**Proof:**
- Run: node --input-type=module -e "import {makeBoard} from './factory/flock/flock_board.mjs'; import {mirrorBoard} from './factory/flock/kata_mirror.mjs'; const got=[]; const kata={comment:async(p,u,b)=>{got.push([p,u,b])}}; const m=mirrorBoard(await makeBoard('standin',{tasks:[{id:'1',title:'t',depends_on:[]}],now:()=>0}),{kata,projectId:'7',tasks:{'1':{uid:'U1'}},runUid:'R1'}); await m.post({by:'A',claim:'copies have no .git',confidence:0.9,about:'engine',task:'1'}); await m.post({by:'A',claim:'the heading belongs to episode.ts',confidence:0.9,about:'app',task:'1'}); await m.post({by:'B',claim:'maybe the hub',confidence:0.5,about:'engine',task:'1'}); await m.post({by:'B',claim:'the check needs a git checkout',confidence:0.85,about:'engine'}); await new Promise(r=>setTimeout(r,50)); const want=[['7','U1','engine belief (0.9) from A: copies have no .git'],['7','R1','engine belief (0.85) from B: the check needs a git checkout']]; if(JSON.stringify(got)!==JSON.stringify(want)){console.error(JSON.stringify(got));process.exit(1)}" [M1]
- Legs: (a) the fake Kata client records exactly the two expected `[projectId, uid, body]` triples in that order, so the `app` belief and the 0.5 engine belief posted nothing and the task-less one went to the run issue [M1].

**Stale-if:**
- path-absent: `factory/flock/kata_mirror.mjs`

### Task 2: The engine takes `about`, keeps it, and stops writing failure.md

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** When a builder is sure something is wrong with the engine itself, it says so in a way I see on the Kata board and in --follow while the run is still going, and every belief a builder posts is kept in the run's record as data, marked by who it's for. (derived)
Machine: M1. A one-task scripted run whose script posts the belief `{task: "1", claim: "copies have no .git", confidence: 0.9, about: "engine"}` (the script's `@beliefs` list), started with a Kata record whose run uid is `R1` and task `1` uid `U1`, writes exactly one `belief` row carrying `about: "engine"` and that claim, and the Kata server receives `POST /api/v1/projects/7/issues/U1/comments` with body `engine belief (0.9) from A: copies have no .git`. M2. A scripted run whose run-wide check prints `the check says no` and exits 1 still writes a `red-checks.json` with that check's entry at exit 1, and writes no `failure.md`.

**Authorized-by:** operator, 2026-09-28 ("Yes, author it": tag, surface, keep as data, remove failure.md)

**Interfaces:**
- Consumes: `mirrorBoard(board, { kata, projectId, tasks, onPost, track, runUid, surfaceAt })`
- Produces: nothing

**Context:** In `factory/flock/engine.mjs` the builders' `post_belief` tool takes `{claim, confidence, task?}` and its handler does `board.post(...)` then `ev('belief', b)`. Give the tool a required `about` (`task`, `app` or `engine`, as a zod enum) and cap `claim` at 300 characters (`z.string().max(300)`); say in the tool's description and in the builders' brief line that names the flock tools what each value means (your task / the app being built / the engine running this run, such as copies, checks or the board). Move the handler's body into one `postBelief(agent, a)` function that both the tool and the scripted builder call. A scripted-builder JSON may carry a top-level `@beliefs` list; a scripted session posts, through `postBelief`, each entry whose `task` is its own task, before it writes its files (a test seam beside `@hold_ms` and `@unwritten`). Pass `mirrorBoard` the record's `run.uid` as `runUid` and `flock.surface.min_confidence` from `factory/policy.json` as `surfaceAt` (0.8 when the cell is absent). Remove the `failure.md` half of `writeFailureRecord` and what only it used (the last-40-lines log buffer and the scope list kept for it); keep `red-checks.json` exactly as it is. The probes run the engine with `--builder scripted:<json>`, which needs no model.

**Proof:**
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; const B=String.fromCharCode(96); const code=200; const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-kata-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"},"@beliefs":[{"task":"1","claim":"copies have no .git","confidence":0.9,"about":"engine"}]})); fs.writeFileSync(path.join(d,"k.json"),JSON.stringify({run:{uid:"R1"},tasks:{"1":{uid:"U1"}}})); const got=[]; const srv=http.createServer((q,r)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{got.push([q.method,q.url,JSON.parse(b||"{}").body]);r.writeHead(code,{"content-type":"application/json"});r.end(JSON.stringify({issue:{uid:"U1",revision:1}}))})}); await new Promise(r=>srv.listen(0,"127.0.0.1",r)); const url="http://127.0.0.1:"+srv.address().port; const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json"),"--kata-url",url,"--kata-project","7","--kata-json",path.join(d,"k.json"),"--kata-actor","engine:run-1"],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); srv.close(); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const mir=rows.filter(x=>x.kind==="kata:mirror"); const b=rows.filter(x=>x.kind==="belief"); const cm=got.filter(x=>x[1].endsWith("/comments")).map(x=>x[1]+" "+x[2]); const ok=b.length===1&&b[0].about==="engine"&&b[0].claim==="copies have no .git"&&cm.includes("/api/v1/projects/7/issues/U1/comments engine belief (0.9) from A: copies have no .git"); if(!ok){console.error(JSON.stringify({b,cm}));process.exit(1)}' [M1]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-rec-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Check: sh -c \"echo the check says no; exit 1\"\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** It exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"}})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore"}); await new Promise(r=>p.on("exit",r)); const R=(f)=>fs.readFileSync(path.join(d,"run",f),"utf8"); const sha=(x)=>crypto.createHash("sha1").update(x).digest("hex"); const rc=JSON.parse(R("red-checks.json")); const ck=rc.red.find(x=>x.task==="check"); const ok=ck&&ck.exit===1&&!fs.existsSync(path.join(d,"run","failure.md")); if(!ok){console.error(JSON.stringify({rc,failure:fs.existsSync(path.join(d,"run","failure.md"))}));process.exit(1)}' [M2]
- Legs: (a) events.jsonl holds exactly one `belief` row, with `about === "engine"` and the claim, and the fake Kata server's comment requests include that body on `U1` [M1]; (b) with a red check, `red-checks.json` holds the `check` entry at exit 1 and no `failure.md` exists [M2].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`

### Task 3: --follow flags a surfaced engine belief

**Type:** implementation

**Files:**
- Modify: `fleet/board-read.mjs`

**Claim:** When a builder is sure something is wrong with the engine itself, it says so in a way I see on the Kata board and in --follow while the run is still going, and every belief a builder posts is kept in the run's record as data, marked by who it's for. (derived)
Machine: M1. `follow` prints a timeline row whose text begins `engine belief` with a leading `!`, and every other row with a leading space as today.

**Authorized-by:** operator, 2026-09-28 ("surface engine ones")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `follow` in `fleet/board-read.mjs` prints each new timeline row once as `  <time> run-<N> <name> <what>` (two leading spaces). A Kata comment's first 120 characters are its row's `what`, so a surfaced engine belief arrives as a row whose `what` begins `engine belief (<confidence>) from <builder>: <claim>`'s first two words. Print such a row with `!` in place of the first space, so it reads like the other warnings; nothing else changes, and it still prints once.

**Proof:**
- Run: node --input-type=module -e "import {follow} from './fleet/board-read.mjs'; const at='2026-09-28T23:00:00.000Z'; const read=async()=>({tasks:[{run:5,issue:10,name:'run-5',closed:'done',last:'closed done',lastAt:at}],timeline:[{eventId:1,at,run:5,issue:11,name:'task 1',what:'claimed by A'},{eventId:2,at,run:5,issue:11,name:'task 1',what:'engine belief (0.9) from A: copies have no .git'}]}); let out=''; await follow({read,write:(x)=>{out+=x},runs:[5],now:()=>Date.parse(at),sleep:async()=>{}}); const L=out.split(String.fromCharCode(10)); const ok=L.some(l=>l.startsWith('!')&&l.includes('engine belief (0.9) from A'))&&L.some(l=>l.startsWith(' ')&&l.endsWith('claimed by A')); if(!ok){console.error(out);process.exit(1)}" [M1]
- Legs: (a) a read carrying a `claimed by A` row and an `engine belief (0.9) from A: …` row prints the first with a leading space and the second with a leading `!` [M1].

**Stale-if:**
- path-absent: `fleet/board-read.mjs`

### Task 4: The record, the threshold and the contract

**Type:** implementation

**Files:**
- Modify: `factory/boot.sh`
- Modify: `factory/policy.json`
- Modify: `fleet/CONTRACT.md`

**Claim:** When a builder is sure something is wrong with the engine itself, it says so in a way I see on the Kata board and in --follow while the run is still going, and every belief a builder posts is kept in the run's record as data, marked by who it's for. (derived)
Machine: M1. `factory/boot.sh` no longer names `failure.md`. M2. `fleet/CONTRACT.md` names the surfaced `engine belief` comment and no longer names `failure.md`; what it says of the `about` field, the 300-character cap and the belief rows is read against the diff. M3. `factory/policy.json` carries `flock.surface` with `min_confidence` 0.8, `rollback` `min_confidence = 2` and `experiment` true.

**Authorized-by:** operator, 2026-09-28 ("Yes, author it")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `factory/boot.sh`'s `collect_evidence` and `evidence_commit` list `failure.md` among the Flock's files; take it out of both and leave the other six names. In `fleet/CONTRACT.md`, drop the `failure.md` bullet from the evidence list (and change "seven" to "six" where it counts them), and beside the Flock's Kata mirror entry describe belief tuples: `{by, claim, confidence, about, task}`, `about` one of `task`, `app`, `engine`, the claim at most 300 characters, every belief kept as a `belief` row in `events.jsonl`, and an `engine` belief at or over `flock.surface.min_confidence` posted to Kata as `engine belief (<confidence>) from <builder>: <claim>` on its task's issue or the run issue. In `factory/policy.json`, add `flock.surface` in the shape of the `flock` cells beside it: `min_confidence` 0.8, `n` 4 (beliefs, over 5 runs), window runs 247, 252, 257 and radio-station runs 1 and 2 (2026-09-26..28), basis "all 4 builder beliefs were at 0.85 or more and correct; run-252's named the cause #1330 fixed", `experiment` true, `rollback` `min_confidence = 2`. Keep the file's formatting.

**Proof:**
- Run: bash -c '! grep -q failure.md factory/boot.sh' [M1]
- Run: grep -q 'engine belief' fleet/CONTRACT.md [M2]
- Run: bash -c '! grep -q failure.md fleet/CONTRACT.md' [M2]
- Run: python3 -c "import json; c=json.load(open('factory/policy.json'))['flock']['surface']; assert c['min_confidence']==0.8 and c['rollback']=='min_confidence = 2' and c['experiment'] is True, c" [M3]
- Legs: (a) `failure.md` appears nowhere in the boot [M1]; (b) the contract names `engine belief` and no longer names `failure.md` [M2]; (c) the policy cell reads 0.8, its rollback and `experiment` true [M3].

**Stale-if:**
- path-absent: `factory/boot.sh`
