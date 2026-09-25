# Three of today's gotchas become code, and the fourth becomes a guide row

**Grammar:** claims-v1
**Claim:** After this run, a plan that writes 'nothing' in backticks gets no made-up ordering between its tasks, a probe that starts with timeout reads the same on my laptop's check as on the sandbox, and a run that parks gives its VM back within the hour instead of holding it for six. (elicited)
**Summary:** This turns three of today's traps into fixes, and writes the fourth down for plan authors. Each one cost real time on 2026-09-24: 27 false ordering links on one plan, probes that looked broken on the laptop but worked on the sandbox, and two stopped runs whose VMs sat idle for about three hours until they were removed by hand. After this, the tools catch these for you, and a stopped run cleans up after itself.
**Goal:** `plan_parse.py` reads a backticked `none`/`nothing` Interfaces bullet as a placeholder; `plan_check.py`'s rehearsal at BASE supplies a `timeout` shim when none is on PATH; `factory/board.mjs` gains `mark-run`, and `factory/boot.sh` calls it with `work.state` `parked` or `failed` so `fleet/janitor.mjs` reaps the VM by its ordinary rule; `references/authoring-gotchas.md` carries the `chr(36)`/`chr(96)` row.
**Closes:** #1288
**Tech Stack:** Python 3 (the laptop scripts), Node 22 ESM and bash (the factory), Markdown (the skill reference).
**Spec:** #1288; the handoff `2026-09-24-1645-whole-codebase-review-and-the-referee-crash.md` §Traps (laptop only).
**Target:** popmechanic/ultrapowers at `567ef76ae73831d645efbfc6272e0a76407eb996` (main, 2026-09-24, v0.3.36 + #1290).

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/janitor.mjs factory/engine.mjs
- `factory/board.mjs` never fails a run: every hub answer, a dark hub and a missing `kata.json` included, is exit 0 from `board.mjs`, and every call `boot.sh` makes to it ends `|| true`.
- The janitor is not edited: it already reads `metadata['work.state']` of `done|parked|failed` on an open run issue as a finished run (`markedFinishOf`, `REAPABLE_STATES` in `fleet/janitor.mjs`), so the boot writing that key is the whole fix.

### Task 1: A backticked placeholder draws no ordering

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`

**Claim:** A plan that writes 'nothing' in backticks gets no made-up ordering between its tasks. (derived)
Machine: M1. `plan_parse.parse_plan_text` on the sample plan `evals/fixtures/claims/plan.md` with both of its `- Consumes: nothing…` bullets rewritten as a backticked `nothing` and one extra `- Produces:` bullet of a backticked `nothing` added to task 2 answers `dag_edges` exactly `[{"from": "1", "to": "2", "why": "interface"}]` — the one edge the unedited sample draws.

**Authorized-by:** #1288 item 1.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `_interface_token(text)` (`skills/ultrapowers/scripts/plan_parse.py` line 411) takes a backticked span through `BACKTICK_PATH_RE` and returns its first word as the symbol; the placeholder test (`if word.lower() in ("none", "nothing"): return None`, line 432) sits only on the bare-word path below it, so a backticked `nothing` is a symbol and every `Consumes:` of it matches every `Produces:` of it. Measured at BASE with the M1 edit: `dag_edges` is `[{2→1}, {2→3}]` and the true `1→2` edge is lost to the cycle guard; the engine-defects plan of 2026-09-24 drew 27 false `interface` edges this way. Apply the same placeholder test to the backticked span's first word (case-insensitive, `none` and `nothing`). The sample plan is read, never edited.

**Proof:**
- Run: python3 -c "import sys; sys.path.insert(0,'skills/ultrapowers/scripts'); import plan_parse as p; B=chr(96); t=open('evals/fixtures/claims/plan.md').read(); t=t.replace('- Consumes: nothing (first task)','- Consumes: '+B+'nothing'+B).replace('- Consumes: nothing\n','- Consumes: '+B+'nothing'+B+'\n').replace('- Produces: '+B+'catalog','- Produces: '+B+'nothing'+B+'\n- Produces: '+B+'catalog'); e=p.parse_plan_text(t)['dag_edges']; assert e==[{'from':'1','to':'2','why':'interface'}], e" [M1]
- Legs: (a) the edited sample's `dag_edges` equals exactly the one `1→2` interface edge, so a backticked placeholder on either side adds no edge and loses none [M1].

**Stale-if:**
- issue-closed: #1288

### Task 2: The laptop's rehearsal has a timeout

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`

**Claim:** A probe that starts with timeout reads the same on my laptop's check as on the sandbox. (derived)
Machine: M1. With `timeout` absent from the process's `PATH`, `plan_check.green_at_base_lines` handed one task whose one `Run:` is `timeout 5 true` cited `[M1]` returns a line containing `timeout 5 true` and `exits 0 at BASE`.

**Authorized-by:** #1288 item 2.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** macOS ships no `timeout`, so `bash -lc 'timeout 5 true'` exits 127 in the laptop's rehearsal while the sandbox (Linux) runs it; the `GREEN-AT-BASE` reading then lies by omission. At BASE `_rehearse` (`plan_check.py` line 954) cuts one worktree and runs each command through `_run_at_base` (line 927) with `env={**os.environ, "ULTRA_BASE": sha}`. The fix: when `shutil.which("timeout")` answers None, the rehearsal writes a two-line executable `timeout` shim (`#!/bin/sh`, then `shift; exec "$@"` — drop the duration, run the rest; the engine's `select.mjs` builds `['timeout', seconds, …]` argv of the same shape) into a directory under the rehearsal's own temporary directory, and prepends that directory to `PATH` in the rehearsed commands' environment; the rehearsal's own 30 s clock still bounds the command. Measured by hand at BASE on macOS: a `PATH` prefix holding exactly that shim survives `bash -lc`'s `path_helper` and the line reads `exits 0 at BASE`; without it the line is silent. When a real `timeout` is on PATH nothing is prepended.

**Proof:**
- Run: python3 -c "import os,sys,shutil,subprocess,tempfile; sys.path.insert(0,'skills/ultrapowers/scripts'); import plan_check as c; sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(); d=tempfile.mkdtemp(); [os.symlink(shutil.which(b),os.path.join(d,b)) for b in ('bash','git')]; os.environ['PATH']=d; ls=c.green_at_base_lines([{'id':'1','proofRuns':['timeout 5 true'],'proofRunClauses':[['M1']]}],c.BaseTree(os.getcwd(),sha),timeout_s=20); assert any('timeout 5 true' in l and 'exits 0 at BASE' in l for l in ls), ls" [M1]
- Legs: (a) with a `PATH` holding only `bash` and `git`, the rehearsal of `timeout 5 true` reads `exits 0 at BASE` — at BASE the line is absent [M1].

**Stale-if:**
- issue-closed: #1288

### Task 3: A parked or failed run marks itself finished on the hub

**Type:** implementation

**Files:**
- Modify: `factory/board.mjs`
- Modify: `factory/boot.sh`
- Modify: `fleet/RUNBOOK.md`
- Modify: `fleet/CONTRACT.md`

**Claim:** A run that parks gives its VM back within the hour instead of holding it for six. (derived)
Machine: M1. `node factory/board.mjs mark-run --kata-json <k> --run <run> --state parked --admin-url <url> --events <e>`, with `<k>` holding `{"project":{"id":7},"run":{"uid":"U1"},"tasks":{}}`, sends exactly one `POST /api/v1/projects/7/issues/U1/metadata` to `<url>` whose JSON body's `patch` carries `"work.state": "parked"`.
M2. `mark-run` exits 0 when its `kata.json` is missing and its hub is dark.
M3. `factory/boot.sh` calls `board.mjs mark-run` with `--state parked` on both parked ends — `publish` writing `parked` and the nothing-ahead-of-base park in `boot()` — and with `--state failed` from `fail()` once the evidence is ready, each call ending `|| true`.

**Authorized-by:** #1288 item 3; `fleet/RUNBOOK.md` trap #1150.

**Interfaces:**
- Consumes: none
- Produces: `mark-run`

**Context:** Runs 234 and 235 (2026-09-24) parked after the referee crash; their run issues stayed open and unmarked, so `fleet/janitor.mjs` read both VMs as live (it reaps an open issue only when `metadata['work.state']` is `done`, `parked` or `failed` — `markedFinishOf`, line ~291; the key is stored FLAT, dotted name and all) and two VMs sat ~3 h until a hand `rm`. At BASE `close_run` in `factory/boot.sh` (line ~507) returns early for anything but `done`; the nothing-ahead park in `boot()` (line ~528) and `fail()` (line ~84) never reach the hub. The metadata write is the janitor's own shape (`metadataPatch`, `fleet/janitor.mjs` ~line 266): `POST <admin-url>/api/v1/projects/<project.id>/issues/<run.uid>/metadata`, body `{"actor": "sandbox:<run>", "patch": {"work.state": "<state>"}}`, header `Idempotency-Key: <run>:run:mark:<state>`, `content-type: application/json` — copy `closeIssue`'s `fetch` with a 20 s abort (`factory/board.mjs` line 353) and read `kata.json` the way `cmdCloseRun` does (`doc.project.id` an integer, `doc.run.uid` a non-empty string; otherwise one skip row and exit 0). Append one row to `--events` whatever the hub answers (kind `board:mark`, `state`, `code`); `appendEventRow` hard-codes kind `board:close`, so give it the kind. Register `mark-run` in `main` beside `close-run` and in its usage line. In the boot: the spoke leaves first (`board_down`, idempotent) exactly as `close_run` does for `done`, then `fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" mark-run --kata-json "$FLEET_HOME/plans/$RUN_ID.kata.json" --run "$RUN_ID" --state <s> --admin-url "$KATA_ADMIN_URL" --events "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" || true`; `boot.sh` runs under `set -euo pipefail`, so every variable a call in `fail()` reads is guarded (`${VAR:-}`) since `fail()` can run before `parse_assignment` has set them — mark only inside `fail()`'s existing `EVIDENCE_READY` branch. The janitor needs no change. Rewrite the RUNBOOK trap at line ~769 (it says the boot closes the hub's run issue only on `done`) to say a parked or failed run marks `work.state` and is reaped by the janitor's ordinary rule; add one sentence to `fleet/CONTRACT.md`'s janitor paragraph (~line 423) naming the boot as the writer of that key on a park or a failure.

**Proof:**
- Run: node -e "const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),{execFile}=require('child_process');const d=fs.mkdtempSync(path.join(os.tmpdir(),'mark-'));fs.writeFileSync(d+'/k.json',JSON.stringify({project:{id:7},run:{uid:'U1'},tasks:{}}));const got=[];const s=http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{got.push([q.method,q.url,b]);r.writeHead(200,{'content-type':'application/json'});r.end('{}')})}).listen(0,'127.0.0.1',()=>{execFile('node',['factory/board.mjs','mark-run','--kata-json',d+'/k.json','--run','run-9','--state','parked','--admin-url','http://127.0.0.1:'+s.address().port,'--events',d+'/e.jsonl'],(e)=>{s.close();const m=got.filter(g=>g[0]==='POST'&&g[1]==='/api/v1/projects/7/issues/U1/metadata');if(e||m.length!==1||JSON.parse(m[0][2]).patch['work.state']!=='parked'){console.error(String(e),JSON.stringify(got));process.exit(1)}})})" [M1]
- Run: e=$(mktemp) && node factory/board.mjs mark-run --kata-json /nonexistent/kata.json --run run-9 --state parked --admin-url http://127.0.0.1:9 --events "$e" [M2]
- Run: bash -n factory/boot.sh
- Legs: (a) a stub hub receives exactly one metadata POST for the run issue whose `patch` sets `work.state` to `parked` — at BASE `mark-run` is an unknown command and exits 2 [M1]; (b) a missing `kata.json` and a dark hub still exit 0 — at BASE the same line exits 2 [M2]; (c) the boot's three call sites and the unchanged `done` path are read at landing against the `boot.sh` hunk [M3].

**Stale-if:**
- issue-closed: #1288

### Task 4: The guide says how a probe writes a dollar sign and a backtick

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`

**Claim:** A plan author reads, before writing a fixture-building probe, that a literal dollar sign and a backtick inside python3 -c go in as chr(36) and chr(96). (derived)
Machine: M1. `skills/ultrawrite/references/authoring-gotchas.md` gains one row under `## The rows` naming `chr(36)` for a literal `$ULTRA_BASE` inside a double-quoted `python3 -c "…"` (the shell expands it otherwise) and `chr(96)` for a backtick a fixture needs (`plan_check.py` refuses a backtick in any `Run:`), with the sitting it cost (2026-09-24, one gate rejection each).

**Authorized-by:** #1288 (the paragraph "Kept as prose").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both slips were caught by the proof gate on 2026-09-24, not by a run: a probe wrote `$ULTRA_BASE` inside `python3 -c "…"`, where bash expands it before Python sees it, and a fixture-building probe needed backticks, which `plan_check.py` refuses in a `Run:` as `command carries a backtick`. Write the row in the file's style: the rule in bold, the reason, the sitting that paid for it. Neither literal appears in the file at BASE.

**Proof:**
- Run: f=skills/ultrawrite/references/authoring-gotchas.md && grep -q 'chr(36)' "$f" && grep -q 'chr(96)' "$f" [M1]
- Legs: (a) the guide carries both `chr(36)` and `chr(96)`, neither present at BASE [M1].

**Stale-if:**
- issue-closed: #1288
