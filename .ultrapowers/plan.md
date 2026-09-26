# Fleet housekeeping after the review: one copy of each shared piece

**Grammar:** claims-v1

**Claim:** After this run, the fleet's laptop tools other than the launcher, and the engine, each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (elicited)
**Summary:** This is a tidy-up of the fleet's laptop tools and the engine, carrying out the small fixes the whole-codebase review of 2026-09-24 named. Over time the same few pieces — the health check's question about who may use a credential, the connection to the task board, the GitHub lookups, the loading of the agent toolkit — were copied into several places, so a fix to one copy could miss the others, and the engine's packages were still installed in the laptop tools' folder. With one copy of each and the engine's packages beside the engine, the next fix lands in one place, the health check reads the same settings the launcher does, and nothing about how a run behaves changes.

**Goal:** Carry out the #1279 bullets that still hold at BASE: the doctor's `integrations`, `kata` and `cloudflare` rows ask the policy question through one `policyRowFor`; the doctor imports its config reader and `parsePolicy` from `fleet/lobby.mjs` (and `fleet/target.mjs` shares that `parsePolicy`); one `hubFromEnv` in `fleet/lobby.mjs` serves `fleet/janitor.mjs` and `fleet/board-read.mjs`; `fleet/retire.mjs` reads GitHub through the janitor's `ghApi`/`readContentsAt`/`decidingPull`; the engine's one SDK loader hands the tools module what it needs, and the SDK dependency lives in `factory/package.json`; `fleet/jev-client.mjs` moves to `factory/jev-client.mjs`; fifty exports with no importer are un-exported; and the three census test files and the three plan-check test files each become one file with the same test count.
**Closes:** #1279

**Tech Stack:** Node 24 ES modules (`fleet/`, `factory/`), Python 3 + pytest (`tests/`). The suite: `python3 -m pytest -q` from the repository root, which bridges every `fleet/tests/test_*.mjs`.

Spec: popmechanic/ultrapowers#1279 (fleet proposals S6–S8, S11, S12 and engine S4 of the 2026-09-24 whole-codebase review).

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/launch.mjs
- Check: node --input-type=module -e "await import('./fleet/launch.mjs'); console.log('ok')"
- `fleet/launch.mjs` is not edited by this plan — a sibling plan (#1277) owns it. Every name it imports at BASE (from `./doctor.mjs`: `fleetConfigAccount`, `verbDrift`; from `./janitor.mjs`: `janitor`; and its `./lobby.mjs` and `./kata-client.mjs` names) stays exported from the file it comes from.
- The doctor's nine row ids (`exe-dev`, `capacity`, `claude`, `accounts`, `github`, `integrations`, `verb-drift`, `kata`, `cloudflare`) and their order are unchanged; each is a `## ` heading in `skills/ultrapowers/references/first-run.md`.
- No package is added or removed: the one dependency stays `@anthropic-ai/claude-agent-sdk` at `^0.3.274`, only its manifest's directory changes.
- Nothing a run, the doctor, the janitor, the sweep or the board reader prints or decides changes; every edit is a move or a deduplication.

---

### Task 1: The doctor asks the policy question in one place

**Type:** implementation

**Files:**
- Modify: `fleet/doctor.mjs`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. In `fleet/doctor.mjs` the `integrations`, `kata` and `cloudflare` rows ask whether an object is on `tag:fleet` through one function, `policyRowFor`: the file carries exactly one `parsePolicy(` call and exactly one `tags.has('fleet')` read (three of each at BASE), and `policyRowFor` is named at least four times (its definition and three rows). M2. The rows still decide as before: with `claude-max` and `kata` both present and bearer-carrying, a policy read answering `tag:other` makes both the `integrations` and the `kata` row `missing`, one answering `tag:fleet` (and a `kata-hub` VM listed) makes both `ok`, and with `kata` absent from the listing the `kata` row is `missing`. M3. `fleet/tests/test_doctor_cloudflare.mjs` (row ids, order, and the `cloudflare` row absent-is-ok, on-policy, off-policy) prints `ALL TESTS PASSED`. M4. `fleet/tests/test_doctor_claude.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** popmechanic/ultrapowers#1279 (its first bullet, "Doctor rows")

**Interfaces:**
- Consumes: nothing
- Produces: `policyRowFor`

**Context:** At BASE the three rows are `integrationsRow` (~line 765), `kataRow` (~829) and `cloudflareRow` (~882); each repeats the same question — the listing's own `tag:fleet` attachment first (`found.get(name).tags.has('fleet')`), then `parsePolicy(<policy read>.stdout)` and `selector === 'tag:fleet'`. Collapse that question into one `policyRowFor` (the issue's shape is `policyRowFor(name, { absentIsOk })`: `cloudflare` is the one row whose absent object is `ok`; `kata` also checks the bearer and then the `kata-hub` VM, and `integrations` also checks the target's `gh-<owner>-<repo>` exists first — those stay row-specific around the shared call). Keep every row's id and `fix`. The off-policy detail may be unified on `policyFix(name)`, which already contains the literal `integrations policy set <name> 'tag:fleet'` that `test_doctor_cloudflare.mjs` leg (d) greps for. Nothing else in the doctor changes; the `claude`/`accounts` rows and their three reads are out of scope. A sibling task moves `parsePolicy`'s definition out of this file into `fleet/lobby.mjs` (and imports it back) and another un-exports `fleetConfigKeys`, `parseIntegrations` and `renderRows` — both edit other regions of this file; `parsePolicy(` with a paren counts calls only (the definition at BASE is spelled `parsePolicy (`, with a space). No sim is edited.

**Proof:**
- Run: test "$(grep -c 'parsePolicy(' fleet/doctor.mjs)" -eq 1 && test "$(grep -c "tags.has('fleet')" fleet/doctor.mjs)" -eq 1 && test "$(grep -c 'policyRowFor' fleet/doctor.mjs)" -ge 4 [M1]
- Run: node --input-type=module -e "import {doctor} from './fleet/doctor.mjs'; const cm={name:'claude-max',config_summary:'Authorization:Bearer x'}; const kt={name:'kata',config_summary:'Authorization:Bearer k'}; const run=async(items,sel)=>{const exec=async(c)=>c.includes('integrations list')?{code:0,stdout:JSON.stringify(items)}:c.includes('policy get')?{code:0,stdout:JSON.stringify({policy:{selector:sel},revision:'r'})}:c.includes('ls kata-hub')?{code:0,stdout:JSON.stringify({vms:[{vm_name:'kata-hub',status:'running'}]})}:{code:1,stdout:''}; const r=await doctor({config:{},exec}); return Object.fromEntries(r.rows.map(x=>[x.id,x.status]))}; const off=await run([cm,kt],'tag:other'); const on=await run([cm,kt],'tag:fleet'); const gone=await run([cm],'tag:fleet'); process.exit(off.kata==='missing'&&off.integrations==='missing'&&on.kata==='ok'&&on.integrations==='ok'&&gone.kata==='missing'?0:1)" [M2]
- Run: node fleet/tests/test_doctor_cloudflare.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Run: node fleet/tests/test_doctor_claude.mjs | grep -q 'ALL TESTS PASSED' [M4]
- Legs: (a) the file carries one `parsePolicy(` call, one `tags.has('fleet')` read and at least four mentions of `policyRowFor` — red while any row still asks the question itself [M1]; (b) off-policy both rows are `missing`, on-policy both `ok`, and an absent `kata` is `missing` — red if the collapse changed any of those decisions [M2]; (c) the cloudflare sim prints its sentinel [M3]; (d) the claude sim prints its sentinel [M4].

**Stale-if:**
- issue-closed: #1279

### Task 2: The doctor reads the launcher's config and policy readers

**Type:** implementation

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/target.mjs`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `fleet/doctor.mjs` imports from `./lobby.mjs` and defines none of `DOCTOR_DEFAULTS`, `loadFleetConfig`, `parseMemoryGb` or `DEFAULT_CONFIG_PATH` itself (all four defined there at BASE). M2. `parsePolicy` is defined once, exported from `fleet/lobby.mjs`, and neither `fleet/doctor.mjs` nor `fleet/target.mjs` defines one. M3. The doctor still behaves on the lobby's readers and still exports what the launcher imports: `doctor({ exec, configKeys: ['cpu'] })` with a readable billing plan answers `config` `{ cpu: '8', memory: '16GB' }` and a `capacity` row `ok` whose detail names `the default 16GB`, and `fleetConfigAccount` and `verbDrift` are exported functions. M4. `target({ argv: ['o/r'], exec })`, when `gh-o-r` already exists unattached and its policy read answers a selector other than `tag:fleet` with no `revision`, still throws and never issues `integrations policy set`.

**Authorized-by:** popmechanic/ultrapowers#1279 (its second bullet, "Doctor imports lobby")

**Interfaces:**
- Consumes: nothing
- Produces: `parsePolicy(stdout) -> { selector, revision } | null`

**Context:** At BASE `fleet/doctor.mjs` copies `lobby.mjs`'s config reading by hand — `DOCTOR_DEFAULTS` (~line 76, identical to lobby's `FLEET_DEFAULTS`), `DEFAULT_CONFIG_PATH` (~135), `parseMemoryGb` (~153) and `loadFleetConfig` (~165) — on the stated ground that the doctor "imports nothing so it runs when nothing else does". That ground is gone: `fleet/lobby.mjs` imports only `node:` built-ins (and a sibling task adds a relative `./kata-client.mjs` import, itself built-ins-free), so the doctor still runs from the plugin cache with no `node_modules`. Import `FLEET_DEFAULTS`, `DEFAULT_CONFIG_PATH`, `loadFleetConfig` and `parseMemoryGb` from `./lobby.mjs`, use `FLEET_DEFAULTS` wherever `DOCTOR_DEFAULTS` was read, and rewrite the header comment (lines ~5–8) and the "copied" comments in both files so neither claims the copy any more. `parsePolicy` exists twice: `doctor.mjs` ~462 (null only when both selector and revision are absent) and `target.mjs` ~84 (null whenever `revision` is absent, because `ensurePolicy` writes with `--if-revision=<revision>`). Move one definition into `lobby.mjs` (exported) and import it in both; keep `target.mjs`'s refusal — a policy read with a non-`tag:fleet` selector and no revision throws a `LobbyError` rather than issuing a `policy set` with no revision. `fleet/launch.mjs` imports `fleetConfigAccount` and `verbDrift` from `./doctor.mjs` and must not be edited, so both stay exported from the doctor; nothing else imports the four copied names from the doctor (`git grep` at BASE). Sibling tasks also edit these files: one collapses the doctor's three policy rows (which call `parsePolicy` — keep that name), one adds `hubFromEnv` to `lobby.mjs`, one un-exports `fleetConfigKeys`, `parseIntegrations`, `renderRows` in the doctor and six names in `target.mjs`.

**Proof:**
- Run: grep -q "from './lobby.mjs'" fleet/doctor.mjs && ! grep -qE '^(export )?(async )?(function|const) (DOCTOR_DEFAULTS|loadFleetConfig|parseMemoryGb|DEFAULT_CONFIG_PATH)[ (=]' fleet/doctor.mjs [M1]
- Run: test "$(grep -cE '^export (async )?(function|const) parsePolicy[ (=]' fleet/lobby.mjs)" -eq 1 && ! grep -qE '^(export )?(function|const) parsePolicy[ (=]' fleet/doctor.mjs fleet/target.mjs [M2]
- Run: node --input-type=module -e "import {doctor, fleetConfigAccount, verbDrift} from './fleet/doctor.mjs'; const exec=async(c)=>c.includes('billing plan')?{code:0,stdout:JSON.stringify({max_cpus:16,max_memory_gb:64,tier:'t'})}:{code:1,stdout:''}; const r=await doctor({exec,configKeys:['cpu']}); const cap=r.rows.find(x=>x.id==='capacity'); process.exit(r.config.cpu==='8'&&r.config.memory==='16GB'&&cap.status==='ok'&&cap.detail.includes('the default 16GB')&&typeof fleetConfigAccount==='function'&&typeof verbDrift==='function'?0:1)" [M3]
- Run: node --input-type=module -e "import {target} from './fleet/target.mjs'; const calls=[]; const exec=async(c,a)=>{const r=a[1]; calls.push(r); if(r.startsWith('integrations list')) return {code:0,stdout:JSON.stringify([{name:'gh-o-r'}])}; if(r.startsWith('integrations policy get')) return {code:0,stdout:JSON.stringify({policy:{selector:'tag:other'}})}; return {code:0,stdout:''}}; let threw=false; try{await target({argv:['o/r'],exec})}catch(e){threw=true}; process.exit(threw&&!calls.some(r=>r.startsWith('integrations policy set'))?0:1)" [M4]
- Legs: (a) the doctor imports the lobby and defines none of the four copied names — red while any copy stands [M1]; (b) exactly one exported `parsePolicy` in `lobby.mjs` and none in the doctor or `target.mjs` — red while either copy stands or the shared one is missing [M2]; (c) the doctor's config defaults and capacity note come out as before and the launcher's two names are still exported functions [M3]; (d) a revisionless off-policy read still throws and issues no `policy set` — red if the shared parser let `target.mjs` write with no revision [M4].

**Stale-if:**
- issue-closed: #1279

### Task 3: One hubFromEnv opens the hub for the janitor and the board reader

**Type:** implementation

**Files:**
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/board-read.mjs`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `fleet/lobby.mjs` exports `hubFromEnv({ exec, actor, kataEnvPath })`, resolving `{ client, host, transport, dark }`: for an env file whose `KATA_URL` is `https://hub.example`, `host` is `hub.example`, `dark` is `null`, and the client's `listProjects()` reaches `exec` with `hub.example` as the ssh destination; for an absent env file, `client` is `null` and `dark` names `no kata hub env at`. M2. Neither `fleet/janitor.mjs` nor `fleet/board-read.mjs` calls `kataHostOf(`, `parseKataEnv(`, `sshTransport(` or `makeKataClient(` itself (each calls some of them at BASE). M3. `fleet/tests/test_board_read.mjs`, which drives `main` over a real env file, a missing one and one with no host, prints `ALL TESTS PASSED`. M4. `fleet/janitor.mjs` still imports cleanly and still exports `janitor` as a function.

**Authorized-by:** popmechanic/ultrapowers#1279 (its third bullet, "One `hubFromEnv`")

**Interfaces:**
- Consumes: nothing
- Produces: `hubFromEnv({ exec, actor, kataEnvPath }) -> Promise<{ client, host, transport, dark }>`

**Context:** At BASE the read-env → `kataHostOf` → `sshTransport` → `makeKataClient` chain is written out three times: `fleet/janitor.mjs` `openHub` (~228–248, actor `HUB_ACTOR` = `janitor`, and it also builds `patchMetadata: metadataPatch(transport)` on the same transport), `fleet/board-read.mjs` `main` (~322–338, actor `board-read`, which `fail()`s on a missing file or hostless URL), and `fleet/launch.mjs` (~1057–1062). Write the chain once as `hubFromEnv` in `fleet/lobby.mjs` (which then imports `sshTransport` and `makeKataClient` from `./kata-client.mjs` — that module imports nothing, so the lobby stays built-ins-only). `kataEnvPath` defaults to `defaultKataEnvPath()`. It never throws on a missing or hostless env: it answers `client: null`, `host: null`, `transport: null` and `dark` set to the exact texts the two callers produce today — `` `no kata hub env at ${envPath} (${error?.code ?? error?.message ?? error}) — ${KATA_HUB_FIX}` `` and `` `${envPath} names KATA_URL ${JSON.stringify(env.url)}, not a url with a host — ${KATA_HUB_FIX}` `` — so the janitor keeps returning its `dark` and board-read keeps `fail(dark)`ing with the same words its sim pins. The janitor keeps its injected-`kata` short-circuit and adds `patchMetadata: metadataPatch(hub.transport)` onto the answered client. `fleet/launch.mjs` keeps its own copy — a sibling plan owns that file and swaps it after both merge; do not edit it. The ssh destination is the second-to-last argv element `sshTransport` hands `exec` (`['-o','BatchMode=yes','-o','ConnectTimeout=15', host, remote]`), and an exec answering `{"projects":[]}` then a newline then `200` on stdout is a 200. Sibling tasks also edit `lobby.mjs` (adds `parsePolicy`) and `janitor.mjs` (exports its GitHub readers; un-exports thirteen constants and helpers, `HUB_ACTOR` among them — keep using it).

**Proof:**
- Run: node --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {hubFromEnv} from './fleet/lobby.mjs'; const d=fs.mkdtempSync(path.join(os.tmpdir(),'hub-')); const f=path.join(d,'kata-hub.env'); fs.writeFileSync(f,'KATA_URL=https://hub.example\nKATA_TOKEN=x\n'); const seen=[]; const exec=async(c,a)=>{seen.push(a[a.length-2]); return {code:0,stdout:'{\"projects\":[]}\n200'}}; const h=await hubFromEnv({exec,actor:'probe',kataEnvPath:f}); await h.client.listProjects(); const miss=await hubFromEnv({exec,actor:'probe',kataEnvPath:path.join(d,'absent.env')}); process.exit(h.host==='hub.example'&&h.dark===null&&seen[0]==='hub.example'&&miss.client===null&&/no kata hub env at/.test(miss.dark)?0:1)" [M1]
- Run: ! grep -qE 'kataHostOf\(|parseKataEnv\(|sshTransport\(|makeKataClient\(' fleet/janitor.mjs fleet/board-read.mjs [M2]
- Run: node fleet/tests/test_board_read.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Run: node --input-type=module -e "import {janitor} from './fleet/janitor.mjs'; process.exit(typeof janitor==='function'?0:1)" [M4]
- Legs: (a) `hubFromEnv` answers the host, a null `dark` and a client whose call reaches `hub.example`, and for an absent file a null client with the `no kata hub env at` reason — red while the function is missing or throws [M1]; (b) no call to any of the four chain steps remains in either caller — red while either still builds the hub by hand [M2]; (c) the board-read sim prints its sentinel [M3]; (d) the janitor still imports and exports `janitor` [M4].

**Stale-if:**
- issue-closed: #1279

### Task 4: The sweep reads GitHub through the janitor's readers

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/retire.mjs`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `fleet/janitor.mjs` exports `ghApi`, `readContentsAt` and `decidingPull`, each a function. M2. `fleet/retire.mjs` has no GitHub read of its own: it names no `ghRead`, and it calls `decidingPull(` and `readContentsAt(`. M3. The highest-numbered pull request still decides the sweep: `retire({ argv: ['--target','o/r','--dry-run'], exec })` over a listing holding only `ultra/integration-run-3`, whose pulls read answers `#4 closed, unmerged` before `#9 open`, prints a line naming `PR #9 open`. M4. The janitor's comment claiming the rule is "carried here by literal and never by an import of the sweep" is gone.

**Authorized-by:** popmechanic/ultrapowers#1279 (its fourth bullet, "Share `ghApi`/`readContentsAt`")

**Interfaces:**
- Consumes: nothing
- Produces: `ghApi(exec, apiPath) -> Promise<object | null>`
- Produces: `readContentsAt(exec, target, run, ref) -> Promise<{ page, sha, from } | null>`
- Produces: `decidingPull(exec, target, run) -> Promise<{ number, state, mergedAt } | null>`

**Context:** At BASE `fleet/janitor.mjs` has `ghApi` (~369), `readContentsAt` (~387) and `decidingPull` (~647), all unexported, and `fleet/retire.mjs` (which already imports `REAPABLE_STATES` from `./janitor.mjs`) carries its own `ghRead` (~158, byte-for-byte `ghApi`), `readStatusPage` (~172, `readContentsAt` at the evidence branch, answering only `page`) and the deciding-row loop inside `integrationFate` (~308–326). Export the janitor's three and make retire use them: `ghRead` → `ghApi` everywhere in retire (its `openPullOf` and PR-patching reads included), `readStatusPage` → `(await readContentsAt(exec, target, run, evidenceBranchFor(run)))?.page ?? null`, and `integrationFate`'s loop → `decidingPull`, which answers `{ number, state, mergedAt }` (`mergedAt` a string when merged, else `null`); `integrationFate` keeps its `{ number, why, deletable }` answer and its words (`open`, `merged`, `no pull request`). Delete the janitor comment at ~660–667 that says the rule is carried "by literal and never by an import of the sweep" — it is now shared; say so in one line or drop it. Nothing retire writes or prints changes. A sibling task also edits `janitor.mjs` (swaps `openHub` onto `hubFromEnv`; un-exports thirteen names — none of these three).

**Proof:**
- Run: node --input-type=module -e "import * as j from './fleet/janitor.mjs'; process.exit(['ghApi','readContentsAt','decidingPull'].every(k=>typeof j[k]==='function')?0:1)" [M1]
- Run: ! grep -q 'ghRead' fleet/retire.mjs && grep -q 'decidingPull(' fleet/retire.mjs && grep -q 'readContentsAt(' fleet/retire.mjs [M2]
- Run: node --input-type=module -e "import {retire} from './fleet/retire.mjs'; const exec=async(c,a)=>{ if(c==='git') return {code:0,stdout:'1111111111111111111111111111111111111111\trefs/heads/ultra/integration-run-3\n'}; if(a[1].includes('pulls?state=all')) return {code:0,stdout:JSON.stringify([{number:4,state:'closed',merged_at:null},{number:9,state:'open',merged_at:null}])}; return {code:1,stdout:''}}; const r=await retire({argv:['--target','o/r','--dry-run'],exec}); process.exit(r.lines.some(l=>l.includes('PR #9 open'))?0:1)" [M3]
- Run: ! grep -q 'never by an import of the sweep' fleet/janitor.mjs [M4]
- Legs: (a) the three readers are exported functions of the janitor — red while any is private [M1]; (b) retire names no `ghRead` and calls both shared readers — red while its copies stand [M2]; (c) with `#4 closed` listed before `#9 open`, the sweep's line names `PR #9 open` — red if the shared rule took the first row, or a closed-unmerged row, instead of the highest number [M3]; (d) the "by literal, never by an import" comment is absent [M4].

**Stale-if:**
- issue-closed: #1279

### Task 5: One SDK loader, and the SDK installed beside the engine

**Type:** implementation

**Files:**
- Create: `factory/package.json`
- Create: `factory/.gitignore`
- Delete: `fleet/package.json`
- Modify: `factory/engine.mjs`
- Modify: `factory/tools.mjs`
- Modify: `factory/boot.sh`
- Modify: `tests/test_fleet_suite.py`
- Modify: `fleet/tests/_boot_helpers.mjs`
- Modify: `CLAUDE.md`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `factory/package.json` declares `@anthropic-ai/claude-agent-sdk` at `^0.3.274`, and `fleet/package.json` does not exist. M2. No file under `factory/` names `fleet/node_modules` or `fleet/package` (the engine, the tools module and the boot all do at BASE), and the boot's `engine_deps` installs in `$ENGINE_REPO_DIR/factory`, never `$ENGINE_REPO_DIR/fleet`. M3. `factory/tools.mjs` resolves no module itself — it carries no `createRequire` and no `import(` — and `factory/engine.mjs` exports `loadSdk` as a function and carries no `createRequire`. M4. `factoryTools({ task, candidates, sdk })`, handed a fake `sdk` of `{ createSdkMcpServer, tool, z }`, answers the server `createSdkMcpServer` built with the name `factory` and six tools; with no `sdk` it throws. M5. The pytest bridge installs the engine's packages in `factory/`: `tests/test_fleet_suite.py`'s `ENGINE_DEPS_DIR` resolves to the repository's `factory` directory. M6. `fleet/tests/test_factory_boot.mjs` and `fleet/tests/test_factory_tools.mjs` print `ALL TESTS PASSED`. M7. `CLAUDE.md` no longer says the fleet owns npm deps in `fleet/package.json`.

**Authorized-by:** popmechanic/ultrapowers#1279 (its fifth bullet, "One SDK resolver", and the SDK half of its sixth, "Move `@anthropic-ai/claude-agent-sdk` … into `factory/`"); CLAUDE.md §Layout ("fleet/ is laptop tools and the bootstrap only, not an engine")

**Interfaces:**
- Consumes: nothing
- Produces: `loadSdk() -> Promise<{ query, createSdkMcpServer, tool, z } | null>`
- Produces: `factoryTools({ kata, projectId, task, candidates, board, runProof, sdk }) -> server`
- Produces: `ENGINE_DEPS_DIR`

**Context:** At BASE the only npm dependency of the repository is `@anthropic-ai/claude-agent-sdk` `^0.3.274` in `fleet/package.json` (`name` `ultrapowers-fleet`, `private`, `type: module`); no `fleet/` module imports it, and `fleet/package-lock.json` is untracked (`fleet/.gitignore` lists `node_modules/` and `package-lock.json` — leave that file alone). Move the manifest to `factory/package.json` unchanged but for a factory `name`, and give `factory/` a `.gitignore` with the same two lines. `zod` arrives as the SDK's peer dependency, hoisted into the same `node_modules`. The SDK is resolved three ways twice today: `factory/engine.mjs` `sdkQuery` (~211–249, `createRequire` rooted at `../fleet/package.json`, answering `query` only) and `factory/tools.mjs` `load` (~24–93, the same three attempts for the SDK and for `zod`, at module evaluation). With the install in `factory/node_modules`, a bare specifier from any `factory/` file resolves on node's own walk, so replace both with one `loadSdk()` in `engine.mjs`: import `@anthropic-ai/claude-agent-sdk` and `zod` once, lazily, cached; answer `{ query, createSdkMcpServer, tool, z }` (zod's `z` export, or its `default`), or `null` when either import fails — `runWorker`'s own `no query()` message stays the loud one. `buildDeps` (~1548–1561) passes `query` to `runWorker` and `{ createSdkMcpServer, tool, z }` as `sdk` into `factoryTools`; `factoryTools` throws a message naming the missing SDK when `sdk` is absent, and `makeHandlers` still needs neither (`test_factory_tools.mjs` imports only `makeHandlers` and `candidatesOf`). `sdkQuery` is used nowhere else (`git grep` at BASE). `factory/boot.sh` `engine_deps` (~239–244) checks, `npm ci`s (when a lockfile is present) or `npm install`s in `$ENGINE_REPO_DIR/factory` instead of `fleet`. `tests/test_fleet_suite.py` `_ensure_node_modules` (~66–79) installs under a module-level `ENGINE_DEPS_DIR` pointing at the repository's `factory/` and flocks its `package.json`. `fleet/tests/_boot_helpers.mjs` `buildEngineDir` (~142–149) symlinks `factory` to the real `factory/` and makes `engines/<sha>/fleet/node_modules` so the boot sim's `engine_deps` returns without running npm; after the move it must still keep the boot sim from running npm — making `node_modules` inside the symlinked real `factory/` would write into the checkout, so build the engine dir's `factory` so its `node_modules` exists without that (for instance a real directory whose entries are symlinks to the real files, plus its own `node_modules`). In `CLAUDE.md` §Layout the `fleet/` bullet says "Own npm deps in `fleet/package.json`." — say the engine's deps are `factory/package.json`'s. A sibling task moves `fleet/jev-client.mjs` into `factory/` and rewrites `engine.mjs`'s import of it (~line 46); another un-exports `DEFAULT_REFEREE_MODEL` and `buildDeps` in `engine.mjs`. `loadSdk` stays exported.

**Proof:**
- Run: node -e "const p=require('./factory/package.json'); process.exit(p.dependencies['@anthropic-ai/claude-agent-sdk']==='^0.3.274'?0:1)" && test ! -e fleet/package.json [M1]
- Run: ! grep -rqE 'fleet/(node_modules|package)' factory/ && sed -n '/^engine_deps()/,/^}/p' factory/boot.sh | grep -q 'ENGINE_REPO_DIR/factory' && ! sed -n '/^engine_deps()/,/^}/p' factory/boot.sh | grep -q 'ENGINE_REPO_DIR/fleet' [M2]
- Run: ! grep -qE 'createRequire|import\(' factory/tools.mjs && ! grep -q 'createRequire' factory/engine.mjs && node --input-type=module -e "import {loadSdk} from './factory/engine.mjs'; process.exit(typeof loadSdk==='function'?0:1)" [M3]
- Run: node --input-type=module -e "import {factoryTools} from './factory/tools.mjs'; const z={string:()=>({describe:()=>({})})}; const sdk={createSdkMcpServer:(o)=>({type:'sdk',name:o.name,n:o.tools.length}),tool:(name,d,s,handler)=>({name,handler}),z}; const s=factoryTools({task:{id:'1',uid:'u',files:[]},candidates:[],sdk}); let threw=false; try{factoryTools({task:{id:'1',uid:'u',files:[]},candidates:[]})}catch(e){threw=true}; process.exit(s.name==='factory'&&s.n===6&&s.tools.length===6&&threw?0:1)" [M4]
- Run: python3 -c "import os,sys; sys.path.insert(0,'tests'); import test_fleet_suite as t; sys.exit(0 if os.path.realpath(t.ENGINE_DEPS_DIR)==os.path.realpath('factory') else 1)" [M5]
- Run: node fleet/tests/test_factory_boot.mjs | grep -q 'ALL TESTS PASSED' [M6]
- Run: node fleet/tests/test_factory_tools.mjs | grep -q 'ALL TESTS PASSED' [M6]
- Run: ! grep -q 'Own npm deps in .fleet/package.json' CLAUDE.md [M7]
- Legs: (a) the factory manifest carries the SDK at `^0.3.274` and the fleet manifest is absent [M1]; (b) nothing under `factory/` names the fleet install and `engine_deps` installs only in `factory` — red while any of the three BASE carriers stands [M2]; (c) the tools module resolves nothing itself, the engine carries no `createRequire`, and `loadSdk` is an exported function [M3]; (d) a fake `sdk` yields a `factory` server of six tools and no `sdk` throws — red while `factoryTools` still loads its own SDK [M4]; (e) the bridge's `ENGINE_DEPS_DIR` is `factory/` [M5]; (f) the boot sim and (g) the tools sim each print their sentinel [M6]; (h) the `CLAUDE.md` sentence naming `fleet/package.json` is gone [M7].

**Stale-if:**
- issue-closed: #1279
- path-exists: `factory/package.json`

### Task 6: The Jev client lives in factory/

**Type:** implementation

**Files:**
- Create: `factory/jev-client.mjs`
- Delete: `fleet/jev-client.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/judge.mjs`
- Modify: `fleet/tests/test_jev_client.mjs`
- Modify: `evals/readings/autoresearch.py`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `factory/jev-client.mjs` exports `makeJevClient` as a function, and `fleet/jev-client.mjs` does not exist. M2. `factory/engine.mjs` imports `makeJevClient` from `./jev-client.mjs` and still imports cleanly. M3. No file under `factory/`, `fleet/tests/` or `evals/readings/` names `fleet/jev-client`, and `evals/readings/autoresearch.py` no longer builds the client's path through a `"fleet"` directory. M4. `fleet/tests/test_jev_client.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** popmechanic/ultrapowers#1279 (the Jev half of its sixth bullet, "Move … `fleet/jev-client.mjs` into `factory/`")

**Interfaces:**
- Consumes: nothing
- Produces: `makeJevClient`

**Context:** `fleet/jev-client.mjs` (108 lines, imports nothing) is used only by the engine: `factory/engine.mjs` line 46 `import { makeJevClient } from '../fleet/jev-client.mjs'`; `fleet/launch.mjs` does not import it (so this move edits no launcher line). Move the file's content unchanged to `factory/jev-client.mjs`, updating its own header comment (line 1 names `fleet/jev-client.mjs`). Other carriers of the old path at BASE: `factory/engine.mjs` ~1498 (a comment), `factory/judge.mjs` line 8 (a comment), `fleet/tests/test_jev_client.mjs` (its dynamic `import('../jev-client.mjs')` at ~59, which becomes `../../factory/jev-client.mjs`, and comments at ~15, ~21, ~64 — the sim stays in `fleet/tests/` because the bridge runs only that directory), and `evals/readings/autoresearch.py` (docstring line 24, and ~653–654 `Path(__file__).resolve().parents[2] / "fleet" / "jev-client.mjs"`, which becomes `"factory"`; that file's only `"fleet"` literal is that one). `skills/ultrawrite/SKILL.md` names `fleet/jev-client.mjs` as history of a past drain — leave it. A sibling task edits `factory/engine.mjs` near its imports (drops `createRequire`/`pathToFileURL`, lines 43–44) and near `buildDeps`; another un-exports two engine names.

**Proof:**
- Run: node --input-type=module -e "import {makeJevClient} from './factory/jev-client.mjs'; process.exit(typeof makeJevClient==='function'?0:1)" && test ! -e fleet/jev-client.mjs [M1]
- Run: grep -q "from './jev-client.mjs'" factory/engine.mjs && node --input-type=module -e "await import('./factory/engine.mjs'); console.log('ok')" [M2]
- Run: ! grep -rq 'fleet/jev-client' factory fleet/tests evals/readings && ! grep -q '"fleet"' evals/readings/autoresearch.py [M3]
- Run: node fleet/tests/test_jev_client.mjs | grep -q 'ALL TESTS PASSED' [M4]
- Legs: (a) the factory client exports `makeJevClient` and the fleet copy is absent [M1]; (b) the engine imports it from its own directory and loads [M2]; (c) no carrier of the old path remains and the readings script no longer walks through `"fleet"` — red while any stands [M3]; (d) the Jev client sim prints its sentinel against the moved file [M4].

**Stale-if:**
- issue-closed: #1279
- path-exists: `factory/jev-client.mjs`

### Task 7: Exports nothing imports are un-exported

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/doctor.mjs`
- Modify: `fleet/claude-token.mjs`
- Modify: `fleet/target.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/dispatch.mjs`
- Modify: `factory/fold.mjs`
- Modify: `factory/measure.mjs`
- Modify: `factory/pairs.mjs`
- Modify: `factory/refold.mjs`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. None of these fifty names is a named export any more (each is at BASE): in `fleet/janitor.mjs` `ATTENTION_KEY`, `ATTENTION_MSG_KEY`, `DEATH_ATTENTION`, `DEATH_STATE`, `DEFAULT_AGE`, `HUB_ACTOR`, `LIVE_STATES`, `NEVER_REAP`, `STALE_MS`, `STATE_KEY`, `deathKeyFor`, `reapPlan`, `renderJanitor` (13); in `fleet/doctor.mjs` `fleetConfigKeys`, `parseIntegrations`, `renderRows` (3); in `fleet/claude-token.mjs` `CLIPBOARD_POLL_MS`, `CLIPBOARD_WAIT_MS`, `INTEGRATION`, `KEYCHAIN`, `LIVE_FLOOR_MS`, `LOCK_PATH`, `LOCK_STALE_MS`, `OAUTH`, `REFRESH_AHEAD_MS`, `authorizeUrlFor`, `cleanCode`, `codeForState`, `defaultDeps`, `exchange`, `integrationExists`, `parseKeychainDump`, `pkce`, `readRecord`, `refreshGrant`, `renderUsage`, `writeRecord` (21); in `fleet/target.mjs` `addCommand`, `addCommandAttach`, `attachCommand`, `policyGetCommand`, `policySetCommand`, `renderTarget` (6); in `factory/engine.mjs` `DEFAULT_REFEREE_MODEL`, `buildDeps` (2); and `missingProducer` in `factory/dispatch.mjs`, `KERNEL` in `factory/fold.mjs`, `excerptTests` in `factory/measure.mjs`, `outlineOf` in `factory/pairs.mjs`, `TOKEN_CELLS` in `factory/refold.mjs` (5). M2. Every one of those ten modules still imports cleanly.

**Authorized-by:** popmechanic/ultrapowers#1279 (its seventh bullet, "Un-export")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The fifty were computed at BASE as every `export function|const|let|class <name>` in these files whose name appears in no other tracked file outside `docs/` and `*.md` (a word match, so a mention in another file's comment kept a name exported — conservative). Drop the `export` keyword and keep each definition: every one is still used inside its own file or is a CLI's own helper. Names left exported on purpose: anything `fleet/launch.mjs` imports (that file is not edited by this plan; its import of `./doctor.mjs` is `fleetConfigAccount`, `verbDrift`, of `./janitor.mjs` is `janitor`), `DOCTOR_DEFAULTS` (a sibling task deletes it), `sdkQuery` (a sibling task replaces it with `loadSdk`), and every name a module's `export default { … }` object lists (`factory/record.mjs`'s renderers, `factory/audit.mjs`'s `auditRows`, `factory/worker.mjs`'s `makeConfineHook`) — no importer uses a default object either, but that is a different edit. Do not delete any default object. Sibling tasks edit these files too — `janitor.mjs` (hub opener; exports `ghApi`, `readContentsAt`, `decidingPull`), `doctor.mjs` (policy rows; lobby imports), `target.mjs` (shared `parsePolicy`), `engine.mjs` (SDK loader; Jev import) — each in other regions.

**Proof:**
- Run: ! grep -qE '^export (async )?(function|const|let|class) (ATTENTION_KEY|ATTENTION_MSG_KEY|DEATH_ATTENTION|DEATH_STATE|DEFAULT_AGE|HUB_ACTOR|LIVE_STATES|NEVER_REAP|STALE_MS|STATE_KEY|deathKeyFor|reapPlan|renderJanitor)[ (=]' fleet/janitor.mjs [M1]
- Run: ! grep -qE '^export (async )?(function|const|let|class) (fleetConfigKeys|parseIntegrations|renderRows)[ (=]' fleet/doctor.mjs [M1]
- Run: ! grep -qE '^export (async )?(function|const|let|class) (CLIPBOARD_POLL_MS|CLIPBOARD_WAIT_MS|INTEGRATION|KEYCHAIN|LIVE_FLOOR_MS|LOCK_PATH|LOCK_STALE_MS|OAUTH|REFRESH_AHEAD_MS|authorizeUrlFor|cleanCode|codeForState|defaultDeps|exchange|integrationExists|parseKeychainDump|pkce|readRecord|refreshGrant|renderUsage|writeRecord)[ (=]' fleet/claude-token.mjs [M1]
- Run: ! grep -qE '^export (async )?(function|const|let|class) (addCommand|addCommandAttach|attachCommand|policyGetCommand|policySetCommand|renderTarget)[ (=]' fleet/target.mjs [M1]
- Run: ! grep -qE '^export (async )?(function|const|let|class) (DEFAULT_REFEREE_MODEL|buildDeps)[ (=]' factory/engine.mjs [M1]
- Run: ! grep -qE '^export (async )?(function|const|let|class) (missingProducer|KERNEL|excerptTests|outlineOf|TOKEN_CELLS)[ (=]' factory/dispatch.mjs factory/fold.mjs factory/measure.mjs factory/pairs.mjs factory/refold.mjs [M1]
- Run: node --input-type=module -e "for (const f of ['./fleet/janitor.mjs','./fleet/doctor.mjs','./fleet/claude-token.mjs','./fleet/target.mjs','./factory/engine.mjs','./factory/dispatch.mjs','./factory/fold.mjs','./factory/measure.mjs','./factory/pairs.mjs','./factory/refold.mjs']) await import(f); console.log('ok')" [M2]
- Legs: (a)–(f) for each of the six groups, no named export of any listed name remains — red while any one is still exported (13 + 3 + 21 + 6 + 2 + 5 at BASE) [M1]; (g) all ten modules import — red if a dropped keyword broke a module or a sibling's import [M2].

**Stale-if:**
- issue-closed: #1279

### Task 8: The authoring-census tests are one file

**Type:** implementation

**Files:**
- Modify: `tests/test_authoring_census.py`
- Delete: `tests/test_authoring_census_amendments.py`
- Delete: `tests/test_authoring_census_jev.py`
- Modify: `tests/test_jev_census.py`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `tests/test_authoring_census.py` collects exactly `50` tests (19 + 17 + 14 across the three files at BASE) and all pass. M2. `tests/test_authoring_census_amendments.py` and `tests/test_authoring_census_jev.py` do not exist. M3. No top-level function or class name is defined twice in `tests/test_authoring_census.py`.

**Authorized-by:** popmechanic/ultrapowers#1279 (its eighth bullet, "Merge the pytest files", census half)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** At BASE the three files (549 + 651 + 592 lines) each drive `skills/ultrawrite/scripts/authoring_census.py` as a subprocess over directories built under `tmp_path`, and repeat their setup: the module-level `HERE`, `ROOT`, `CENSUS`, `HEADER`, `COLUMN_NAMES`, `TOTALS`, `REGISTER`, `REPORT_EMPTY`, `DECOY`, `FAKE_GH` and the helpers `amendment`, `blob`, `build_root`, `census`, `decoy_env`, `fake_gh`, `fetch_answers`, `lines`, `load_module`, `plan_path`, `report_path`, `run_fetch`, `status_path`, `tsv`, `write_run` are each defined in two or three of them. Merge the three into `tests/test_authoring_census.py` with each helper once; where two copies of a helper differ, keep one that serves every caller (a parameter with a default is the usual shape). No test function names collide across the three at BASE; every test keeps its name and its assertions. `tests/test_jev_census.py`'s docstring (~line 47) names `tests/test_authoring_census_jev.py` — point it at the merged file. Test counts are `python3 -m pytest -n0 --collect-only -q <file> | grep -c ::` at BASE.

**Proof:**
- Run: test "$(python3 -m pytest -n0 --collect-only -q tests/test_authoring_census.py | grep -c ::)" -eq 50 && python3 -m pytest -n0 -q tests/test_authoring_census.py [M1]
- Run: test ! -e tests/test_authoring_census_amendments.py && test ! -e tests/test_authoring_census_jev.py [M2]
- Run: python3 -c "import ast,collections,sys; t=ast.parse(open('tests/test_authoring_census.py').read()); c=collections.Counter(n.name for n in t.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))); sys.exit(1 if [k for k,v in c.items() if v>1] else 0)" [M3]
- Legs: (a) the merged file collects exactly 50 tests and they pass — red if one was lost or shadowed in the merge [M1]; (b) both merged-away files are absent [M2]; (c) no top-level name is defined twice — red if a second copy of a helper silently overrode the first [M3].

**Stale-if:**
- issue-closed: #1279
- path-absent: `tests/test_authoring_census.py`

### Task 9: The plan-check tests are one file

**Type:** implementation

**Files:**
- Create: `tests/test_plan_check.py`
- Delete: `tests/test_plan_check_freeze.py`
- Delete: `tests/test_plan_check_rehearsal.py`
- Delete: `tests/test_authoring_record.py`
- Modify: `skills/ultrapowers/scripts/plan_check.py`

**Claim:** After this run, the fleet's laptop tools and the engine each keep one copy of every shared piece — the doctor's policy check, the hub connection, the GitHub reads, the agent toolkit's loading — the engine's own packages live beside the engine, and the merged test files still run every test they ran before. (derived)
Machine: M1. `tests/test_plan_check.py` collects exactly `43` tests (7 + 14 + 22 across the three files at BASE) and all pass. M2. `tests/test_plan_check_freeze.py`, `tests/test_plan_check_rehearsal.py` and `tests/test_authoring_record.py` do not exist. M3. No top-level function or class name is defined twice in `tests/test_plan_check.py`.

**Authorized-by:** popmechanic/ultrapowers#1279 (its eighth bullet, "Merge the pytest files", plan-check half)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** At BASE `tests/test_plan_check_freeze.py` (284 lines), `tests/test_plan_check_rehearsal.py` (645) and `tests/test_authoring_record.py` (466) all drive `skills/ultrapowers/scripts/plan_check.py` and repeat `COMPILER`, `HEAD`, `ROOT`, `SOURCE`, `TASK` and the helpers `_git`, `base_repo`, `fact_lines`, `make_plan`, `write_plan` in two or three of them. Merge them into one new `tests/test_plan_check.py` with each helper once; where two copies differ, keep one that serves every caller. No test function names collide across the three at BASE; every test keeps its name and its assertions. `skills/ultrapowers/scripts/plan_check.py` names `tests/test_plan_check_rehearsal.py` in a docstring (~line 432) — point it at the merged file; change nothing else in that script. Test counts are `python3 -m pytest -n0 --collect-only -q <file> | grep -c ::` at BASE.

**Proof:**
- Run: test "$(python3 -m pytest -n0 --collect-only -q tests/test_plan_check.py | grep -c ::)" -eq 43 && python3 -m pytest -n0 -q tests/test_plan_check.py [M1]
- Run: test ! -e tests/test_plan_check_freeze.py && test ! -e tests/test_plan_check_rehearsal.py && test ! -e tests/test_authoring_record.py [M2]
- Run: python3 -c "import ast,collections,sys; t=ast.parse(open('tests/test_plan_check.py').read()); c=collections.Counter(n.name for n in t.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))); sys.exit(1 if [k for k,v in c.items() if v>1] else 0)" [M3]
- Legs: (a) the merged file collects exactly 43 tests and they pass — red if one was lost or shadowed [M1]; (b) the three merged-away files are absent [M2]; (c) no top-level name is defined twice [M3].

**Stale-if:**
- issue-closed: #1279
- path-exists: `tests/test_plan_check.py`
