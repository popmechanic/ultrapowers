# The Flock refuses to settle on a change nobody made

**Grammar:** claims-v1
**Claim:** A Flock run refuses to settle on a snapshot that changes a file outside every task's Files, unless a builder declared that change as an amendment. (quoted from #1333)
**Summary:** Before a Flock run can finish green, it now checks every file the finished code changes against the files the plan's tasks name. A change outside the plan that a builder made is kept and noted on the record as an amendment, but a change outside the plan that no builder made stops the run from finishing green, so it ends as a draft for you to look at. This exists because run-247 finished green and merged a corrupted file no task had touched, and nothing it ran could see it; it is an experiment, and its rollback is one setting that turns the check back into a note.
**Goal:** Close the Flock's scope gap at the edge (#1333), under map #1292.
**Closes:** #1333
**Tech Stack:** Node 24 (ESM); `factory/policy.json` for the switch.

Spec: #1333 (Shape paragraph).

## Global Constraints

- A builder's own change outside the plan's Files is never refused: it is recorded as an amendment (#990, the plan is a submission).
- A snapshot change that no builder wrote, outside every task's Files, never settles green while the switch reads `enforce`.
- The switch is `factory/policy.json` `flock.scope.mode`, `enforce` or `record`; `record` writes the same rows and blocks nothing, and is the rollback.
- Check: python3 -m pytest -q

### Task 1: The scope rule

**Type:** implementation

**Files:**
- Create: `factory/flock/scope.mjs`

**Claim:** A Flock run refuses to settle on a snapshot that changes a file outside every task's Files, unless a builder declared that change as an amendment. (derived)
Machine: M1. `scopeOf({changed, files, written})` puts a changed path that is in no task's Files and was written by no builder into `outside`. M2. It puts a changed path that is in no task's Files but was written by a builder into `amended`. M3. A changed path in some task's Files is in neither list; both lists come back sorted.

**Authorized-by:** #1333

**Interfaces:**
- Consumes: nothing
- Produces: `scopeOf({ changed, files, written })`

**Context:** A pure function, no I/O. `changed` is the list of paths whose content or existence in the snapshot differs from BASE; `files` is every path any task's Files names; `written` is every path any builder changed in its copy. It answers `{ outside: string[], amended: string[] }`. Duplicates in the inputs are harmless.

**Proof:**
- Run: node --input-type=module -e "import {scopeOf} from './factory/flock/scope.mjs'; const r=scopeOf({changed:['c.js','a.js','b.js'],files:['a.js'],written:['b.js','a.js']}); if(JSON.stringify(r)!==JSON.stringify({outside:['c.js'],amended:['b.js']})){console.error(JSON.stringify(r));process.exit(1)}" [M1, M2, M3]
- Legs: (a) with `changed` `c.js`, `a.js`, `b.js`, Files `a.js` and written `b.js`, `a.js`, the answer is exactly `{outside: ['c.js'], amended: ['b.js']}`: `c.js` (unwritten, outside) is outside [M1], `b.js` (written, outside) is amended [M2], and `a.js` (in Files) is in neither [M3].

**Stale-if:**
- path-exists: `factory/flock/scope.mjs`

### Task 2: The edge applies the rule

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`

**Claim:** A Flock run refuses to settle on a snapshot that changes a file outside every task's Files, unless a builder declared that change as an amendment. (derived)
Machine: M1. In a one-task scripted run whose builder writes `hello.txt` (in the task's Files) and `notes.txt` (in no task's Files), the engine exits 0, its `terminal` row reads `pr: "ready"`, it writes exactly one `driver:amendment` row, for `notes.txt`, and no `scope:outside` row. M2. When the scripted builder plants `README` with new text that no builder wrote (the script's `@unwritten` map, M3), the run ends a draft: its `terminal` row reads `pr: "draft"` and a `scope:outside` row names `README`. M3. A scripted-builder JSON may carry a top-level `@unwritten` map of path to text; a scripted session puts each entry into its copy's weave after syncing from disk and before publishing, without recording the path as written, which stands in for a weave fault like run-247's.

**Authorized-by:** #1333

**Interfaces:**
- Consumes: `scopeOf({ changed, files, written })`
- Produces: nothing

**Context:** The edge is `function edge (reason)` in `factory/flock/engine.mjs`. It reads the merged snapshot `m` (`m.files` path → text, `m.exists` path → bool), which holds every base file byte-exact plus every builder change. Changed paths are the snapshot's paths whose text differs from the file in `BASE_DIR`, or which exist on one side only; compute them from `m` and `BASE_DIR` before any fact or check runs, since those write build output into the edge copy. Files: the union of every board task's `files` (a resolve task `R:<path>` owns `<path>`). Written: every path in `lastEditT` for any builder (`edited()` records both tool edits and disk drift). Emit one `driver:amendment` row per amended path per run (`{path, snap}`), a `scope:outside` row (`{snap, paths}`) whenever `outside` is non-empty, and fold `outside` into `lastEdge.green`, including the cached-verdict branch for a snapshot hash seen before. A red that only scope causes has no lever, so the settle loop ends the run a draft (`exhausted`); that is the intended outcome. The switch is `factory/policy.json` `flock.scope.mode`, read the way `POLICY_FLOCK` already reads `flock.pulls`; the values are `enforce` and `record`, and an absent cell reads `enforce`. The probes run the engine with `--builder scripted:<json>`, which needs no model and no npm package. The `@unwritten` entries are applied in `scriptedSession`, between its `syncFromDisk(agent)` and `publishCopy(agent)`, with the weave's own `rewrite` op and no `edited()` call; they are a test seam and touch nothing outside scripted runs. Under `record` the same planted change writes its `scope:outside` row and the run still settles green.

**Proof:**
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-scope-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); const files={"hello.txt":"hi\n","notes.txt":"an amendment\n"}; fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":files})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const amend=rows.filter(x=>x.kind==="driver:amendment").map(x=>x.path); const outside=rows.filter(x=>x.kind==="scope:outside"); if(!(exit===0&&term&&term.pr==="ready"&&JSON.stringify(amend)===JSON.stringify(["notes.txt"])&&outside.length===0)){console.error(JSON.stringify({exit,term,amend,outside}));process.exit(1)}' [M1]
- Run: node --input-type=module -e 'import {execSync,spawn} from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const B=String.fromCharCode(96); const d=fs.mkdtempSync(path.join(os.tmpdir(),"flock-scope-")); const t=path.join(d,"t"); fs.mkdirSync(t); execSync("git init -q && echo base > README && git add . && git -c user.email=a@b -c user.name=a commit -qm base",{cwd:t,shell:"/bin/bash"}); const base=execSync("git rev-parse HEAD",{cwd:t}).toString().trim(); fs.writeFileSync(path.join(d,"plan.md"),"# Toy\n\n**Grammar:** claims-v1\n**Claim:** A hello file exists. (elicited)\n**Summary:** A toy. It tests. It helps.\n**Goal:** toy\n**Tech Stack:** none\n\n## Global Constraints\n\n- Nothing.\n\n### Task 1: Hello\n\n**Type:** implementation\n\n**Files:**\n- Create: "+B+"hello.txt"+B+"\n\n**Claim:** A hello file exists. (derived)\nMachine: M1. "+B+"hello.txt"+B+" exists.\n\n**Authorized-by:** toy\n\n**Interfaces:**\n- Produces: nothing\n\n**Context:** none.\n\n**Proof:**\n- Run: test -f hello.txt [M1]\n- Legs: (a) the file exists [M1].\n\n**Stale-if:**\n- path-exists: "+B+"nothing-here"+B+"\n"); const files={"hello.txt":"hi\n"}; fs.writeFileSync(path.join(d,"s.json"),JSON.stringify({"1":files,"@unwritten":{"README":"corrupted\n"}})); const p=spawn("node",["factory/flock/engine.mjs","--plan",path.join(d,"plan.md"),"--target",t,"--base",base,"--run-dir",path.join(d,"run"),"--builder","scripted:"+path.join(d,"s.json")],{stdio:"ignore"}); const exit=await new Promise(r=>p.on("exit",r)); const rows=fs.readFileSync(path.join(d,"run","events.jsonl"),"utf8").trim().split("\n").map(JSON.parse); const term=rows.find(x=>x.kind==="terminal"); const outside=rows.filter(x=>x.kind==="scope:outside").flatMap(x=>x.paths); if(!(term&&term.pr==="draft"&&outside.includes("README"))){console.error(JSON.stringify({exit,term,outside}));process.exit(1)}' [M2, M3]
- Legs: (a) the scripted run exits 0 with `pr === "ready"`, its `driver:amendment` rows name exactly `["notes.txt"]` (so `hello.txt`, in Files, is not one), and it has zero `scope:outside` rows [M1]; (b) with `README` planted through `@unwritten`, the run's `terminal` row has `pr === "draft"` and its `scope:outside` rows include `README` [M2, M3].

**Stale-if:**
- issue-closed: #1333

### Task 3: The switch and the contract

**Type:** implementation

**Files:**
- Modify: `factory/policy.json`
- Modify: `fleet/CONTRACT.md`

**Claim:** A Flock run refuses to settle on a snapshot that changes a file outside every task's Files, unless a builder declared that change as an amendment. (derived)
Machine: M1. `factory/policy.json` carries `flock.scope` with `mode` `enforce`, `rollback` `mode = record` and `experiment` true; that its other keys follow the shape of the `flock` cells beside it is read against the diff. M2. `fleet/CONTRACT.md` names the `scope:outside` row; what it says about `driver:amendment` rows and the switch is read against the diff.

**Authorized-by:** #1333

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `factory/policy.json` `flock` holds `pulls` and `jev_step` today, each with `mode`, `n`, `window`, `basis`, `experiment`, `rollback` and `unread`; add `scope` beside them in the same shape, `n` 0 and `window` `none`, basis run-247 (#1322, a green run that merged a corrupted file no task listed). Keep the file's existing formatting. In `fleet/CONTRACT.md`, beside the Flock's Kata mirror entry, say that the Flock's edge refuses a snapshot changing a path outside every task's Files that no builder wrote (a `scope:outside` row), records a builder's own such change as a `driver:amendment` row, and that `flock.scope.mode = record` is the rollback.

**Proof:**
- Run: python3 -c "import json; c=json.load(open('factory/policy.json'))['flock']['scope']; assert c['mode']=='enforce' and c['rollback']=='mode = record' and c['experiment'] is True, c" [M1]
- Run: grep -q 'scope:outside' fleet/CONTRACT.md [M2]
- Legs: (a) the policy cell reads `mode == "enforce"`, `rollback == "mode = record"` and `experiment is True` [M1]; (b) `scope:outside` appears in the contract, where it appears nowhere at BASE [M2].

**Stale-if:**
- issue-closed: #1333
