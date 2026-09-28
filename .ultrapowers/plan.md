# A run starts from what the last one learned

**Grammar:** claims-v1
**Claim:** When a run follows one on the same repo that did not finish green, every builder starts already knowing what that run recorded: why it stopped, which checks failed and what they printed, and what its builders believed, in at most ten short items, without anyone having to remember to pass it on. (elicited)
**Summary:** When the previous run on a repository did not finish green, the next run now reads that run's record by itself and puts its lessons into every builder's opening brief. It exists because the lessons of a failed run, such as run-252's builder naming the real cause, were lost unless someone remembered to carry them over. The next builders start from at most ten short items, so they know what went wrong without wading through logs.

**Goal:** Feed a failed run's recorded lessons to the next run's builders automatically (operator, 2026-09-28: the simplest version).
**Tech Stack:** Node 24 (ESM); bash (`factory/boot.sh`).

Spec: this session's design, 2026-09-28. The previous run is the highest `ultra/evidence/run-<M>` tag on the target below this run's own number; only if it did not end `done` do builders see it.

## Global Constraints

- Reading behind the size limit (runs 247, 252, 257 and radio-station runs 1 and 2, 2026-09-26..28, n=5 runs): 0 to 2 builder beliefs per run, and a handful of red checks at most, so ten items of at most 300 characters each (about 3 KB) holds a failed run's lessons and every builder can see all of them.
- The record read is data only: `status.json`, `events.jsonl` and `red-checks.json` under `.ultrapowers/runs/<M>/` at the tag. No prose is written for a model to interpret.
- Reading the previous run can never slow or fail a run: any error (no remote, no tag, a missing file, a timeout of 30 s per git call) means builders see nothing extra and the run goes on.
- Check: python3 -m pytest -q tests/test_fleet_suite.py -k boot

### Task 1: A failed run's record as ten short items

**Type:** implementation

**Files:**
- Create: `factory/flock/past.mjs`

**Claim:** A failed run's record becomes at most ten short items, in the order a fixer needs them. (derived)
Machine: M1. `pastItems({status, events, redChecks})` answers `null` when `status.state` is `done`. M2. Otherwise it answers items in this order: one `stopped` item (from the last `terminal` row, `<pr>: <why>`, else `<state>: <phase>`), one `red-check` item per `redChecks.red` entry (`<cmd> exited <exit>: <tail>`), one `belief` item per `belief` row not by `host` (`<by> (<confidence>) about the <about>: <claim>`), then one `stall` item per `stall:<kind>` row; every item's `text` is at most 300 characters, and there are at most 10 items.

**Authorized-by:** operator, 2026-09-28 ("Yes, plan it": the simplest version)

**Interfaces:**
- Consumes: nothing
- Produces: `pastItems({ status, events, redChecks })`

**Context:** A pure function, no I/O, in a new `factory/flock/past.mjs`. Each item is `{kind, text}`, plus `task` for a red check and `about` for a belief (a belief with no `about` reads `<by> (<confidence>): <claim>`); texts are cut to 300 characters, and the list to its first 10. `redChecks` may be null (the record has no `red-checks.json`), and `events` may be empty.

**Proof:**
- Run: node --input-type=module -e "import {pastItems} from './factory/flock/past.mjs'; const events=[{kind:'belief',by:'A',confidence:0.9,about:'engine',claim:'copies have no .git'},{kind:'belief',by:'host',confidence:1,claim:'edge red'},{kind:'stall:no-progress',evidence:{best:3}},{kind:'terminal',pr:'draft',why:'no progress: the green count has not risen for 1200 s'}]; const red={red:[{task:'2',cmd:'test -f x',exit:1,tail:'x'.repeat(900)}]}; const it=pastItems({status:{state:'parked'},events,redChecks:red}); const k=it.map(i=>i.kind).join(','); const ok=k==='stopped,red-check,belief,stall'&&it[0].text==='draft: no progress: the green count has not risen for 1200 s'&&it.every(i=>i.text.length<=300)&&it[2].text==='A (0.9) about the engine: copies have no .git'&&pastItems({status:{state:'done'},events,redChecks:red})===null; const many=pastItems({status:{state:'failed'},events:Array.from({length:30},(_,i)=>({kind:'belief',by:'B',confidence:0.5,about:'app',claim:'n'+i}))}); if(!ok||many.length!==10){console.error(JSON.stringify({it,many:many.length}));process.exit(1)}" [M1, M2]
- Legs: (a) a `done` status answers `null` [M1]; (b) a parked record answers `stopped, red-check, belief, stall` in that order, with the exact `stopped` and `belief` texts, the host belief left out, a 900-character tail cut to 300, and 30 beliefs cut to 10 items [M2].

**Stale-if:**
- path-exists: `factory/flock/past.mjs`

### Task 2: The engine reads the previous run and briefs its builders

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** When a run follows one on the same repo that did not finish green, every builder starts already knowing what that run recorded, without anyone having to remember to pass it on. (derived)
Machine: M1. A one-task scripted run started with `ULTRAPOWERS_FLEET_RUN=run-6`, whose target's origin carries the tag `ultra/evidence/run-5` with a `parked` status, a belief `copies have no .git` (engine, 0.9), a `terminal` row `draft` / `no progress` and a red check `test -f x` (exit 1, `no x`), writes a `past` event row naming run 5, and a `past.json` for run 5 whose first item text is `draft: no progress` and whose items include `A (0.9) about the engine: copies have no .git` and `test -f x exited 1: no x`; the run itself still exits 0 and ends `pr: "ready"`. M2. When run 5's status is `done`, the `past` row names run 5 with `items: 0` and no `past.json` is written. M3. The builders' opening brief ends with the previous run's items, one per line, under a sentence naming the run, whenever `past.json` was written; this is how the brief's code reads, judged against its hunk.

**Authorized-by:** operator, 2026-09-28 ("Yes, plan it")

**Interfaces:**
- Consumes: `pastItems({ status, events, redChecks })`
- Produces: nothing

**Context:** The boot starts the Flock with `ULTRAPOWERS_FLEET_RUN=run-<N>` in its environment and `--target` the run's clone of the target, whose `origin` is the target repository. Before builders start, when `N > 1`: list the origin's `refs/tags/ultra/evidence/run-*` tags (`git ls-remote`), take the highest number below `N`, fetch just that tag (`git fetch --depth=1 origin <ref>:<ref>`), and read `status.json`, `events.jsonl` and `red-checks.json` under `.ultrapowers/runs/<M>/` with `git show <ref>:<path>`. Every git call gets a 30 s timeout, and any failure (no remote, no tag, a missing file) is logged once and leaves builders with nothing extra. Pass what was read to `pastItems`; write one `past` event row `{run, items}` (the item count, 0 when `pastItems` answered `null`); when it answered items, write `past.json` (`{run, items}`) in the run directory, and append to `brief(task)`'s text a line `The previous run on this repository, run-<M>, did not finish green. What it recorded:` followed by the items' texts, one per line. The probes build a local bare origin carrying the tag, and run the engine with `--builder scripted:<json>`, which needs no model. The untagged guard is #1333's amendment run, started as run-6 against a target with no remote: it must still end `ready` with its one amendment.

**Proof:**
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-past-")); const sh=(c,cwd)=>execSync(c,{cwd,shell:"/bin/bash",stdio:"pipe"}).toString().trim(); sh("git init -q --bare o.git && git init -q -b main s",d); const s=path.join(d,"s"); sh("git config user.email a@b && git config user.name a && echo base > README && git add . && git commit -qm base && git remote add origin ../o.git && git push -q origin main",s); sh("git checkout -q -b ev && mkdir -p .ultrapowers/runs/5",s); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/status.json"),JSON.stringify({state:"parked",phase:"x"})); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/events.jsonl"),JSON.stringify({kind:"belief",by:"A",confidence:0.9,about:"engine",claim:"copies have no .git"})+"\n"+JSON.stringify({kind:"terminal",pr:"draft",why:"no progress"})+"\n"); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/red-checks.json"),JSON.stringify({red:[{task:"1",cmd:"test -f x",exit:1,tail:"no x"}]})); sh("git add . && git commit -qm ev && git tag ultra/evidence/run-5 && git push -q origin ultra/evidence/run-5",s); sh("git clone -q o.git t",d); const t=path.join(d,"t"); const base=sh("git rev-parse HEAD",t); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** It exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"}})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore",env:{...process.env,ULTRAPOWERS_FLEET_RUN:"run-6"}}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const pr=rows.find(x=>x.kind==="past"); const pj=path.join(d,"run","past.json"); const past=fs.existsSync(pj)?JSON.parse(fs.readFileSync(pj,"utf8")):null; const term=rows.find(x=>x.kind==="terminal"); const texts=past?past.items.map(i=>i.text):[]; const ok=exit===0&&term&&term.pr==="ready"&&pr&&pr.run===5&&past&&past.run===5&&texts.includes("A (0.9) about the engine: copies have no .git")&&texts.includes("test -f x exited 1: no x")&&texts[0]==="draft: no progress"; if(!ok){console.error(JSON.stringify({exit,pr,past}));process.exit(1)}' [M1]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-past-")); const sh=(c,cwd)=>execSync(c,{cwd,shell:"/bin/bash",stdio:"pipe"}).toString().trim(); sh("git init -q --bare o.git && git init -q -b main s",d); const s=path.join(d,"s"); sh("git config user.email a@b && git config user.name a && echo base > README && git add . && git commit -qm base && git remote add origin ../o.git && git push -q origin main",s); sh("git checkout -q -b ev && mkdir -p .ultrapowers/runs/5",s); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/status.json"),JSON.stringify({state:"done",phase:"x"})); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/events.jsonl"),JSON.stringify({kind:"belief",by:"A",confidence:0.9,about:"engine",claim:"copies have no .git"})+"\n"+JSON.stringify({kind:"terminal",pr:"draft",why:"no progress"})+"\n"); fs.writeFileSync(path.join(s,".ultrapowers/runs/5/red-checks.json"),JSON.stringify({red:[{task:"1",cmd:"test -f x",exit:1,tail:"no x"}]})); sh("git add . && git commit -qm ev && git tag ultra/evidence/run-5 && git push -q origin ultra/evidence/run-5",s); sh("git clone -q o.git t",d); const t=path.join(d,"t"); const base=sh("git rev-parse HEAD",t); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** It exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":{"hello.txt":"hi\n"}})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore",env:{...process.env,ULTRAPOWERS_FLEET_RUN:"run-6"}}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const pr=rows.find(x=>x.kind==="past"); const pj=path.join(d,"run","past.json"); const past=fs.existsSync(pj)?JSON.parse(fs.readFileSync(pj,"utf8")):null; const term=rows.find(x=>x.kind==="terminal"); const ok=exit===0&&pr&&pr.run===5&&pr.items===0&&past===null; if(!ok){console.error(JSON.stringify({exit,pr,past}));process.exit(1)}' [M2]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-scope-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); const files={"hello.txt":"hi\n","notes.txt":"an amendment\n"}; fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":files})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore",env:{...process.env,ULTRAPOWERS_FLEET_RUN:"run-6"}}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const amend=rows.filter(x=>x.kind==="driver:amendment").map(x=>x.path); const outside=rows.filter(x=>x.kind==="scope:outside"); if(!(exit===0&&term&&term.pr==="ready"&&JSON.stringify(amend)===JSON.stringify(["notes.txt"])&&outside.length===0)){console.error(JSON.stringify({exit,term,amend,outside}));process.exit(1)}'
- Legs: (a) with a parked run 5, the `past` row names run 5, `past.json` starts `draft: no progress` and carries the belief and red-check texts, and the run exits 0 `ready` [M1]; (b) with run 5 `done`, the `past` row has `items: 0` and there is no `past.json` [M2]; M3 is read against the brief's hunk.

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`

### Task 3: The record keeps what builders were told

**Type:** implementation

**Files:**
- Modify: `factory/boot.sh`
- Modify: `fleet/CONTRACT.md`

**Claim:** The run's record keeps what its builders were told about the previous run. (derived)
Machine: M1. `collect_evidence` copies `past.json` from the run directory into the evidence directory beside the other Flock files. M2. `evidence_commit` commits `past.json` to the evidence branch even when the target's `.gitignore` ignores `*.json`. M3. `fleet/CONTRACT.md` names `past.json`; what it says of the previous-run read is judged against the diff.

**Authorized-by:** operator, 2026-09-28 ("Yes, plan it")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `factory/boot.sh`'s `collect_evidence` and `evidence_commit` each list the Flock's evidence files by name (`board-ops.json`, `board.json`, `weave-ops.digest.jsonl`, `snapshots.jsonl`, `snapshot-texts.json`, `red-checks.json`), copied only when present and added with `add -f`; add `past.json` to both. In `fleet/CONTRACT.md`, add `past.json` to the Flock's evidence list: the previous run's items the builders were briefed with (`{run, items}`, at most 10 items of at most 300 characters), written only when the previous run on the target did not end `done`; and say how the previous run is found (the highest `ultra/evidence/run-<M>` tag below this run's number) and that a failed read never affects the run.

**Proof:**
- Run: bash -c 'set -u; eval "$(sed -n "/^collect_evidence()/,/^}/p" factory/boot.sh)"; T=$(mktemp -d); RUN_DIR=$T/run; ENGINE_LOG=$T/engine.log; EVIDENCE_DIR=$T/ev; EVIDENCE_REL=.ultrapowers/runs/9; mkdir -p $RUN_DIR; for f in events.jsonl summary.json board-ops.json board.json weave-ops.jsonl weave-ops.digest.jsonl snapshots.json snapshots.jsonl snapshot-texts.json red-checks.json failure.md past.json; do echo "{}" > $RUN_DIR/$f; done; mkdir -p $RUN_DIR/checks; echo x > $ENGINE_LOG; collect_evidence || exit 1; got=$(cd $EVIDENCE_DIR/$EVIDENCE_REL && ls | sort | tr "\n" " "); want="board-ops.json board.json engine.log events.jsonl past.json red-checks.json snapshot-texts.json snapshots.jsonl summary.json weave-ops.digest.jsonl "; [ "$got" = "$want" ] || { echo "got: $got"; exit 1; }' [M1]
- Run: bash -c 'set -u; eval "$(sed -n "/^evidence_commit()/,/^}/p" factory/boot.sh)"; fleet_git() { git "$@"; }; log() { :; }; T=$(mktemp -d); git init -q --bare $T/origin.git; git init -q $T/ev; cd $T/ev; git config user.email a@b; git config user.name a; printf "*.json\n*.jsonl\n*.md\n" > .gitignore; git add .gitignore; git commit -qm base; git remote add origin $T/origin.git; EVIDENCE_DIR=$T/ev; EVIDENCE_REL=.ultrapowers/runs/9; EVIDENCE_BRANCH=ultra/evidence-run-9; mkdir -p $EVIDENCE_REL; for f in board-ops.json board.json weave-ops.digest.jsonl snapshots.jsonl snapshot-texts.json red-checks.json past.json; do echo "{}" > $EVIDENCE_REL/$f; done; evidence_commit "run-9: test" >/dev/null 2>&1; got=$(git -C $T/origin.git ls-tree -r --name-only ultra/evidence-run-9 -- $EVIDENCE_REL | sed "s#.*/##" | sort | tr "\n" " "); want="board-ops.json board.json past.json red-checks.json snapshot-texts.json snapshots.jsonl weave-ops.digest.jsonl "; [ "$got" = "$want" ] || { echo "got: $got"; exit 1; }' [M2]
- Run: grep -q 'past.json' fleet/CONTRACT.md [M3]
- Legs: (a) the evidence directory holds exactly the ten expected names, `past.json` among them [M1]; (b) the evidence branch's tree holds `past.json` through a `.gitignore` that ignores it [M2]; (c) the contract names `past.json`, where it appears nowhere at BASE [M3].

**Stale-if:**
- path-absent: `factory/boot.sh`
