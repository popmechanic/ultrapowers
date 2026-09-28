# The Flock mirrors its board to Kata

**Grammar:** claims-v1
**Claim:** While a Flock run is in flight, `node fleet/board-read.mjs --run <N> --target <owner>/<repo>` shows each task being claimed, released and finished as it happens, not only the closes at the end. (quoted from #1341)
**Summary:** The Flock now posts a short note to each task's Kata issue whenever a builder claims, releases or finishes it, and when the engine reopens it. It exists because the Kata board showed nothing during a Flock run and then closed everything in the same second, so there was no way to watch a run. Now reading the board mid-run shows who is working on what, and a slow or broken Kata can never slow down or fail the run.
**Goal:** Close the Flock's Kata gap with a fire-and-forget mirror of its in-memory board (#1341 option 1).
**Closes:** #1341
**Tech Stack:** Node 24 (ESM), the Kata REST client in `fleet/kata-client.mjs`.

Spec: #1341 (option 1, recommended).

## Global Constraints

- A Kata write never delays, fails or reorders a Flock run: every post is fire-and-forget, and the in-memory board stays the scheduler.
- No token or credential is written to disk or argv; the engine talks to the local spoke URL the boot already passes (`--kata-url`), exactly as the factory engine does.
- The comment bodies are exactly `claimed by <builder>`, `released: <why>`, `reopened: <why>` and `done by <builder>`; the event row is `kata:mirror`.
- Check: python3 -m pytest -q

### Task 1: The mirror module

**Type:** implementation

**Files:**
- Create: `factory/flock/kata_mirror.mjs`

**Claim:** While a Flock run is in flight, `node fleet/board-read.mjs --run <N> --target <owner>/<repo>` shows each task being claimed, released and finished as it happens, not only the closes at the end. (derived)
Machine: M1. Over the stand-in board, `mirrorBoard(board, {kata, projectId, tasks, onPost})` turns the sequence claim by A, release, claim by B, reopen, claim by A, done into exactly six calls of `kata.comment(projectId, uid, body)`, in order, with bodies `claimed by A`, `released: <why>`, `claimed by B`, `reopened: <why>`, `claimed by A`, `done by A`; a reopen posts one comment and no `released:` comment of its own. M2. `mirrorBoard` returns the very board object it was given. M3. No wrapped method waits on Kata or throws because of it: with a `kata.comment` that never settles, claim and done still resolve within 200 ms; with one that rejects, claim still resolves and `onPost` receives one record whose `ok` is `false`. M4. A task with no entry in `tasks` gets no comment, and its claim and done still work.

**Authorized-by:** #1341 option 1

**Interfaces:**
- Consumes: `makeBoard(kind, opts)`
- Produces: `mirrorBoard(board, { kata, projectId, tasks, onPost })`

**Context:** `factory/flock/flock_board.mjs` has the Flock's in-memory board (`StandInBoard`): `claim(agent)` answers the claimed task or `null`, `release(t, why)`, `reopen(t, why)` (which calls `this.release` internally), `done(t)` (the task's `owner` is still the builder at that point). `mirrorBoard` wraps those four methods on the board object in place and returns it, so `board.tasks`, `board.read()`, `board.post()` and the rest keep working. `kata` is a `fleet/kata-client.mjs` client; its `comment(projectId, uid, body)` posts one comment. `tasks` is the `tasks` object of the run's kata record, `{"<task id>": {"uid": …}}`. `onPost` (optional) is called once per attempted post with a record carrying at least `task`, `what` (the body) and `ok`; a task with no uid may be reported as skipped. A comment is started after the board operation it mirrors has completed and is never awaited by it.

**Proof:**
- Run: node --input-type=module -e "import {makeBoard} from './factory/flock/flock_board.mjs'; import {mirrorBoard} from './factory/flock/kata_mirror.mjs'; const got=[]; const kata={comment:async(p,u,b)=>{got.push([p,u,b])}}; const b=await makeBoard('standin',{tasks:[{id:'1',title:'t',depends_on:[]}],now:()=>0}); const m=mirrorBoard(b,{kata,projectId:'7',tasks:{'1':{uid:'U1'}}}); if(m!==b) process.exit(3); let t=await m.claim('A'); await m.release(t,'A released: blocked'); t=await m.claim('B'); await m.reopen(t,'edge red'); t=await m.claim('A'); await m.done(t); await new Promise(r=>setTimeout(r,50)); const want=[['7','U1','claimed by A'],['7','U1','released: A released: blocked'],['7','U1','claimed by B'],['7','U1','reopened: edge red'],['7','U1','claimed by A'],['7','U1','done by A']]; if(JSON.stringify(got)!==JSON.stringify(want)){console.error(JSON.stringify(got));process.exit(1)}" [M1, M2]
- Run: node --input-type=module -e "import {makeBoard} from './factory/flock/flock_board.mjs'; import {mirrorBoard} from './factory/flock/kata_mirror.mjs'; const rows=[]; const hang={comment:()=>new Promise(()=>{})}; const bad={comment:async()=>{throw new Error('kata 500')}}; const mk=()=>makeBoard('standin',{tasks:[{id:'1',title:'t',depends_on:[]}],now:()=>0}); const h=mirrorBoard(await mk(),{kata:hang,projectId:'7',tasks:{'1':{uid:'U1'}}}); const r=await Promise.race([(async()=>{const t=await h.claim('A'); await h.done(t); return 'ok'})(), new Promise(res=>setTimeout(()=>res('late'),200))]); if(r!=='ok'){console.error('waited on kata');process.exit(1)} const f=mirrorBoard(await mk(),{kata:bad,projectId:'7',tasks:{'1':{uid:'U1'}},onPost:(x)=>rows.push(x)}); await f.claim('A'); await new Promise(res=>setTimeout(res,50)); if(!(rows.length===1 && rows[0].ok===false)){console.error(JSON.stringify(rows));process.exit(1)}" [M3]
- Run: node --input-type=module -e "import {makeBoard} from './factory/flock/flock_board.mjs'; import {mirrorBoard} from './factory/flock/kata_mirror.mjs'; const got=[]; const kata={comment:async(...a)=>{got.push(a)}}; const m=mirrorBoard(await makeBoard('standin',{tasks:[{id:'R:1',title:'t',depends_on:[]}],now:()=>0}),{kata,projectId:'7',tasks:{'1':{uid:'U1'}}}); const t=await m.claim('A'); await m.done(t); await new Promise(r=>setTimeout(r,50)); if(!t || got.length!==0){console.error(JSON.stringify(got));process.exit(1)}" [M4]
- Legs: (a) the six comment calls equal the six expected `[projectId, uid, body]` triples in order, and `mirrorBoard` returned `b` itself [M1, M2]; (b) claim-then-done over a never-settling comment finishes before a 200 ms timer, and a rejecting comment yields exactly one `onPost` record with `ok === false` [M3]; (c) a task `R:1` absent from `tasks` is claimed and done with zero comment calls [M4].

**Stale-if:**
- path-exists: `factory/flock/kata_mirror.mjs`

### Task 2: The engine mirrors when the boot passes a Kata record

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** While a Flock run is in flight, `node fleet/board-read.mjs --run <N> --target <owner>/<repo>` shows each task being claimed, released and finished as it happens, not only the closes at the end. (derived)
Machine: M1. Started with `--kata-url`, `--kata-project 7` and `--kata-json` naming a record whose task `1` has uid `U1`, a one-task scripted run sends the Kata server exactly two comment requests, both `POST /api/v1/projects/7/issues/U1/comments`, with bodies `claimed by A` then `done by A`, and writes two `kata:mirror` rows to its events.jsonl with `ok: true`. M2. When the Kata server answers 500 to every request, the same run still exits 0 and its `terminal` row reads `pr: "ready"`.

**Authorized-by:** #1341 option 1

**Interfaces:**
- Consumes: `mirrorBoard(board, { kata, projectId, tasks, onPost })`
- Consumes: `makeKataClient({ transport, actor })`
- Consumes: `httpTransport({ url })`
- Produces: nothing

**Context:** `factory/boot.sh` (line ~254) already passes `--kata-url` (the local spoke), `--kata-project` (the spoke's project id), `--kata-json` (the run's kata record) and `--kata-actor engine:<run>` to either engine; today the Flock ignores all four (header comment near line 10 and the note near line 44 say so; both change to say what it now does). When all of `--kata-url`, `--kata-project` and `--kata-json` are given and the record reads, wrap the board made at `const board = await makeBoard(BOARD, …)` with `mirrorBoard` from `./kata_mirror.mjs`, over `makeKataClient({ transport: httpTransport({ url }), actor })` from `fleet/kata-client.mjs` (the factory engine builds its client the same way), passing the record's `tasks` and an `onPost` that writes each record as an event row of kind `kata:mirror` through the engine's own `ev`. Without them, or when the record does not read, the board is the plain stand-in and nothing is sent. `kata:*` rows are bookkeeping the status projection already skips. The builders in a scripted run are named `A`, `B`, …; the probes below run the engine with `--builder scripted:<json>`, which needs no model and no npm package.

**Proof:**
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; const B=String.fromCharCode(96); const code=200; const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-kata-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"}})); fs.writeFileSync(path.join(d,"k.json"),JSON.stringify({tasks:{"1":{uid:"U1"}}})); const got=[]; const srv=http.createServer((q,r)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{got.push([q.method,q.url,JSON.parse(b||"{}").body]);r.writeHead(code,{"content-type":"application/json"});r.end(JSON.stringify({issue:{uid:"U1",revision:1}}))})}); await new Promise(r=>srv.listen(0,"127.0.0.1",r)); const url="http://127.0.0.1:"+srv.address().port; const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json"),"--kata-url",url,"--kata-project","7","--kata-json",path.join(d,"k.json"),"--kata-actor","engine:run-1"],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); srv.close(); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const mir=rows.filter(x=>x.kind==="kata:mirror"); const w=JSON.stringify([["POST","/api/v1/projects/7/issues/U1/comments","claimed by A"],["POST","/api/v1/projects/7/issues/U1/comments","done by A"]]); const cm=got.filter(x=>x[1].endsWith("/comments")); if(JSON.stringify(cm)!==w||mir.filter(x=>x.ok===true).length!==2){console.error(JSON.stringify({cm,mir}));process.exit(1)}' [M1]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; const B=String.fromCharCode(96); const code=500; const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-kata-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"}})); fs.writeFileSync(path.join(d,"k.json"),JSON.stringify({tasks:{"1":{uid:"U1"}}})); const got=[]; const srv=http.createServer((q,r)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{got.push([q.method,q.url,JSON.parse(b||"{}").body]);r.writeHead(code,{"content-type":"application/json"});r.end(JSON.stringify({issue:{uid:"U1",revision:1}}))})}); await new Promise(r=>srv.listen(0,"127.0.0.1",r)); const url="http://127.0.0.1:"+srv.address().port; const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json"),"--kata-url",url,"--kata-project","7","--kata-json",path.join(d,"k.json"),"--kata-actor","engine:run-1"],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); srv.close(); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const mir=rows.filter(x=>x.kind==="kata:mirror"); if(!(exit===0&&term&&term.pr==="ready"&&got.length>0)){console.error(JSON.stringify({exit,term,got}));process.exit(1)}' [M2]
- Legs: (a) the comment requests the fake Kata server recorded are exactly `[["POST","/api/v1/projects/7/issues/U1/comments","claimed by A"],["POST","/api/v1/projects/7/issues/U1/comments","done by A"]]` and events.jsonl holds two `kata:mirror` rows with `ok === true` [M1]; (b) with every request answered 500 the engine exits 0, its `terminal` row has `pr === "ready"`, and at least one post was attempted [M2].

**Stale-if:**
- issue-closed: #1341

### Task 3: The contract and runbook say what the Flock mirrors

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`

**Claim:** While a Flock run is in flight, `node fleet/board-read.mjs --run <N> --target <owner>/<repo>` shows each task being claimed, released and finished as it happens, not only the closes at the end. (derived)
Machine: M1. `fleet/CONTRACT.md` names the Flock's `kata:mirror` event row; what its entry says about the four comment bodies and about Kata failures never delaying or failing a run is read against the diff. M2. `fleet/RUNBOOK.md` names the `claimed by` comments a Flock run's board shows; that this sits in the **Watch.** paragraph beside what it already says about the factory is read against the diff.

**Authorized-by:** #1341 ("The RUNBOOK §Watch line gets fixed whichever option lands")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The RUNBOOK's **Watch.** paragraph (around line 266) says the hub mirrors a run's progress and names `fleet/CONTRACT.md` as the authority for what the current engine mirrors; CONTRACT's `**Kata record (engine):**` bullet (around line 296) describes only the factory engine's worker hooks. Add the Flock's half beside it. The Flock mirrors only when the boot passes `--kata-url`, `--kata-project` and `--kata-json`; it posts to the spoke, which federates to the hub; posts are fire-and-forget. Before this change the Flock posted nothing and the board showed only the launcher's filing and the boot's closes (radio-station run-1, 2026-09-28, n=1 run).

**Proof:**
- Run: grep -q 'kata:mirror' fleet/CONTRACT.md [M1]
- Run: grep -q 'claimed by' fleet/RUNBOOK.md [M2]
- Legs: (a) `kata:mirror` appears in `fleet/CONTRACT.md`, where it appears nowhere at BASE [M1]; (b) `claimed by` appears in `fleet/RUNBOOK.md`, where it appears nowhere at BASE [M2].

**Stale-if:**
- issue-closed: #1341
