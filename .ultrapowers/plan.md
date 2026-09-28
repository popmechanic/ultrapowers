# A stuck Flock run stops early

**Grammar:** claims-v1
**Claim:** A Flock run that makes no progress for a set time ends as a draft and alerts, instead of running to its clock. (quoted from #1334)
**Summary:** A Flock run now watches whether its code is still getting closer to done, and if nothing has improved for 20 minutes it stops, publishes a draft pull request with what it has, and records why. It exists because run-252 went nearly four hours and $80 without improving and nobody knew until it ended; the draft pull request is the alert, since it notifies you. Twenty minutes is ten times the longest wait seen in seven normal runs, it is an experiment, and setting it to zero turns it off.
**Goal:** Stop a Flock run that makes no progress (#1334), under map #1292.
**Closes:** #1334
**Tech Stack:** Node 24 (ESM); `factory/policy.json` for the limit.

Spec: #1334 (Shape paragraph).

## Global Constraints

- Progress is the best-green count rising (every task fact that passes, plus the run-wide check), the count the edge already tracks; the run's start counts as the first progress.
- A stopped run ends as a draft through the same terminal path as the engine's other drafts, so the boot publishes it as a draft pull request.
- The limit is `factory/policy.json` `flock.stall.minutes` (20), overridable per launch with `--stall-minutes`; `0` turns the stop off and is the rollback.
- Check: python3 -m pytest -q

### Task 1: The engine stops a run that stops improving

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** A Flock run that makes no progress for a set time ends as a draft and alerts, instead of running to its clock. (derived)
Machine: M1. A one-task scripted run whose builder session is held for 30 s (the script's `@hold_ms`) and which is started with `--stall-minutes 0.05` writes a `terminal` row reading `pr: "draft"` and exactly one `stall:no-progress` row, and the whole run ends in under 20 s, because the stop cuts the held session short. M2. The engine reads the limit from `--stall-minutes`, else `flock.stall.minutes` in `factory/policy.json`, else 20, with `0` meaning off; it measures from the last rise of the best-green count, interrupts every live builder session when it stops, and names every stall row `stall:<kind>`; this is how the engine's code reads, judged against its hunk.

**Authorized-by:** #1334

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `factory/flock/engine.mjs`: the edge already computes the best-green count `g` and keeps `bestGreen`; record the time it rises. The `settle()` loop wakes every 500 ms; at the top of each pass, before any `continue`, a run whose last rise is older than the limit calls `stall('no-progress', …)`, then `terminal('draft', …)`, interrupts every live SDK session (keep the `query` handles of live sessions so they can be interrupted, as the clock `killer` does for one), and leaves the loop. `stall()` today writes `ev('stall', { kind, evidence })`, and the spread lets the stall's `kind` overwrite the row's own, so the row comes out named `deadlock` or `livelock`; nothing reads those names (searched 2026-09-28), so write `ev('stall:' + kind, { evidence })` instead. For the probe, a scripted-builder JSON may carry a top-level `@hold_ms`: a scripted session waits that long before writing its files, returning at once, without writing, if the run ends meanwhile. It is a test seam beside `@unwritten`. Readings behind the default: in the 7 Flock runs with a readable record (247, 251–255 and radio-station run-1, 2026-09-26..28, n=7 runs), the longest wait for a rise was 2.0 min, and run-252 ran 229.7 min after its last rise. The guard below is #1333's amendment run; it must still finish `ready`.

**Proof:**
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const T0=Date.now(); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-scope-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); const files={"hello.txt":"hi\n"}; fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":files,"@hold_ms":30000})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json"),"--stall-minutes","0.05"],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const wall=Date.now()-T0; const nop=rows.filter(x=>x.kind==="stall:no-progress"); if(!(term&&term.pr==="draft"&&nop.length===1&&wall<20000)){console.error(JSON.stringify({exit,term,nop,wall}));process.exit(1)}' [M1]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-scope-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); const files={"hello.txt":"hi\n","notes.txt":"an amendment\n"}; fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":files})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const amend=rows.filter(x=>x.kind==="driver:amendment").map(x=>x.path); const outside=rows.filter(x=>x.kind==="scope:outside"); if(!(exit===0&&term&&term.pr==="ready"&&JSON.stringify(amend)===JSON.stringify(["notes.txt"])&&outside.length===0)){console.error(JSON.stringify({exit,term,amend,outside}));process.exit(1)}'
- Legs: (a) with the session held 30 s and a 3 s limit, the run's `terminal` row has `pr === "draft"`, exactly one row is named `stall:no-progress`, and the probe's own clock reads under 20 s [M1]; M2 is read against the hunk.

**Stale-if:**
- issue-closed: #1334

### Task 2: The limit and the contract

**Type:** implementation

**Files:**
- Modify: `factory/policy.json`
- Modify: `fleet/CONTRACT.md`

**Claim:** A Flock run that makes no progress for a set time ends as a draft and alerts, instead of running to its clock. (derived)
Machine: M1. `factory/policy.json` carries `flock.stall` with `minutes` 20, `rollback` `minutes = 0` and `experiment` true; that its other keys follow the shape of the `flock` cells beside it is read against the diff. M2. `fleet/CONTRACT.md` names the `stall:no-progress` row; what it says about the limit, the draft and the rollback is read against the diff.

**Authorized-by:** #1334

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `factory/policy.json` `flock` holds cells such as `pulls`, `jev_step` and `scope`, each with `mode` (here `minutes`), `n`, `window`, `basis`, `experiment`, `rollback` and `unread`. Add `stall` in the same shape: `minutes` 20, `n` 7, window the 7 Flock runs 247, 251–255 and radio-station run-1 (2026-09-26..28), basis "the longest wait for a rise in the green count was 2.0 min; run-252 ran 229.7 min after its last rise", `rollback` `minutes = 0`. Keep the file's existing formatting. In `fleet/CONTRACT.md`, beside the Flock's other entries (the Kata mirror, the scope gate), say that a Flock run whose best-green count has not risen for `flock.stall.minutes` writes a `stall:no-progress` row and ends as a draft, that every stall row is now named `stall:<kind>`, and that `--stall-minutes` overrides the cell per launch.

**Proof:**
- Run: python3 -c "import json; c=json.load(open('factory/policy.json'))['flock']['stall']; assert c['minutes']==20 and c['rollback']=='minutes = 0' and c['experiment'] is True, c" [M1]
- Run: grep -q 'stall:no-progress' fleet/CONTRACT.md [M2]
- Legs: (a) the policy cell reads `minutes == 20`, `rollback == "minutes = 0"` and `experiment is True` [M1]; (b) `stall:no-progress` appears in the contract, where it appears nowhere at BASE [M2].

**Stale-if:**
- issue-closed: #1334
