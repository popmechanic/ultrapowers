# Split the launcher by phase: plan pins, toolchain, kata filing, compiler

**Grammar:** claims-v1

**Claim:** After the run, the launcher reads as the step-by-step walk of a launch, about 1,300 lines, with each of its four self-contained jobs in its own short file, and every launch behaves exactly as before. (elicited)
**Summary:** This splits the launcher, the one long program that checks a plan and starts a run, into four smaller files, one each for checking a plan's pinned file fingerprints, checking that the sandbox has every program a plan's probes call, filing the run on the task board, and fetching and running the plan checker, while the launcher itself keeps only the step-by-step walk of a launch. The launcher has grown to nearly two thousand lines and each of these four jobs already stands on its own, so reading or fixing one today means scrolling past all the others. Every launch behaves exactly as it did before; the next fix to any of these jobs is made in one short file, and the launcher stops advertising internals that nothing else uses.

**Goal:** Move the plan-pin check into `fleet/plan-pins.mjs`, the sandbox-toolchain check into `fleet/toolchain.mjs`, the hub filing into `fleet/kata-file.mjs` and the checker/parser fetch-and-run into `fleet/compiler.mjs`, as pure moves; `launchBody` stays in `fleet/launch.mjs` as the ordered walk, and every `fleet/launch.mjs` export no file imports is un-exported.
**Closes:** #1277

**Tech Stack:** Node 24 ES modules (`fleet/`). The suite: `python3 -m pytest -q` from the repository root, which bridges every `fleet/tests/test_*.mjs`.

Spec: popmechanic/ultrapowers#1277 (fleet proposal S9 of the 2026-09-24 whole-codebase review).

## Global Constraints

- This is a move, not a change: every refusal message, every argv the launcher executes, every hub call and every line `renderLaunch` prints is what it was at BASE. A moved function's body is byte-identical to BASE apart from its `export` keyword; only import lines are added or removed.
- `fleet/launch.mjs` keeps exporting `USAGE`, `usage`, `launch`, `renderLaunch`, `defaultRefreshCredential`, `defaultReadUsage` and `USAGE_REFUSE_PCT` — the `fleet/tests/test_launch_*.mjs` sims import them from there.
- No new module imports `fleet/launch.mjs` (no import cycle), and no file outside `fleet/launch.mjs`, the four new modules, `fleet/tests/test_launch_probe_runners.mjs`, `fleet/CONTRACT.md` and `fleet/RUNBOOK.md` is edited; in particular `fleet/doctor.mjs`, `fleet/lobby.mjs`, `fleet/kata-client.mjs` and everything under `factory/` are untouched.
- The hub client is still built inside `launchBody` exactly as at BASE (`readKataEnv` → `kataHostOf` → `sshTransport` → `makeKataClient`); no `hubFromEnv` is created or used by this plan.

---

### Task 1: The plan-pin check lives in fleet/plan-pins.mjs

**Type:** implementation

**Files:**
- Create: `fleet/plan-pins.mjs`
- Modify: `fleet/launch.mjs`

**Claim:** `launchBody` stays as the ordered walk (~600); launch.mjs lands near 1,300. (derived)
Machine: M1. `fleet/plan-pins.mjs` exports exactly one name, `verifyPlanPins`. M2. Handed a plan text whose two `- Run:` lines pin `fleet/lobby.mjs` (a path pin) and `cat fleet/lobby.mjs` (a slice pin) to forty zeros, with `base: "HEAD"` and the real `defaultExec`, `verifyPlanPins` from `fleet/plan-pins.mjs` throws a message of exactly two lines, the first starting `launch: plan pin fleet/lobby.mjs: pinned 0000000000000000000000000000000000000000` and the second `launch: plan pin cat fleet/lobby.mjs: pinned 0000000000000000000000000000000000000000`. M3. `fleet/launch.mjs` no longer defines any of `planPins`, `verifyPlanPins`, `basePinCheckout`, `slicePinSha`, `PIN_LINE`, `WHOLLY_BACKTICKED`, `PATH_PIN`, `SLICE_PIN`, `clipCommand`, `pinRefusalLine`, and its module namespace has neither `planPins` nor `verifyPlanPins`. M4. `fleet/launch.mjs` is at most `1757` lines long (it is `1907` at BASE).

**Authorized-by:** popmechanic/ultrapowers#1277 (the `plan-pins.mjs` bullet)

**Interfaces:**
- Consumes: nothing
- Produces: `verifyPlanPins({ exec, repoDir, base, planText }) -> Promise<void>`

**Context:** At BASE the plan-pin seam of `fleet/launch.mjs` is lines 461–625: the section comment opening "A hash pin is a fact about BASE", `PIN_LINE`, `WHOLLY_BACKTICKED`, `PATH_PIN`, `SLICE_PIN`, `clipCommand`, `pinRefusalLine`, `export function planPins`, `async function basePinCheckout`, `async function slicePinSha` and `export async function verifyPlanPins`. Move all of it, comments included, into `fleet/plan-pins.mjs`, which imports what it needs itself (`node:fs/promises`, `node:os`, `node:path`, `spawnSync` from `node:child_process`, and `Refusal`, `git`, `output` from `./lobby.mjs`) and exports only `verifyPlanPins` — `planPins` becomes a plain function there, since nothing outside the module calls it. `launch.mjs` imports `verifyPlanPins` from `./plan-pins.mjs`; its one call in `launchBody` is unchanged. `spawnSync` and `os` stay imported in `launch.mjs` (other code there uses them). Three sibling tasks move other seams out of `launch.mjs` at the same time (toolchain, kata filing, compiler) and a fourth un-exports what is left; this task touches none of their lines. The refusal wording is `launch: plan pin <subject>: pinned <sha> but --base <base> has <real>`, one line per stale pin — unchanged.

**Proof:**
- Run: node --input-type=module -e 'const m = await import("./fleet/plan-pins.mjs"); if (Object.keys(m).join(",") !== "verifyPlanPins") { console.log(Object.keys(m)); process.exit(1) }' [M1]
- Run: node --input-type=module -e 'import { verifyPlanPins } from "./fleet/plan-pins.mjs"; import { defaultExec } from "./fleet/lobby.mjs"; const z = "0".repeat(40); const plan = "- Run: test \"$(git hash-object fleet/lobby.mjs)\" = " + z + "\n- Run: test \"$(cat fleet/lobby.mjs | git hash-object --stdin)\" = " + z; let m = ""; try { await verifyPlanPins({ exec: defaultExec, repoDir: ".", base: "HEAD", planText: plan }) } catch (e) { m = e.message } const lines = m.split("\n"); if (lines.length !== 2 || !lines[0].startsWith("launch: plan pin fleet/lobby.mjs: pinned " + z) || !lines[1].startsWith("launch: plan pin cat fleet/lobby.mjs: pinned " + z)) { console.log(m); process.exit(1) }' [M2]
- Run: test $(grep -cE '^(export )?(async )?(function|const) (planPins|verifyPlanPins|basePinCheckout|slicePinSha|PIN_LINE|WHOLLY_BACKTICKED|PATH_PIN|SLICE_PIN|clipCommand|pinRefusalLine)[ =(]' fleet/launch.mjs) -eq 0 && node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); if ("planPins" in m || "verifyPlanPins" in m) process.exit(1)' [M3]
- Run: test $(wc -l < fleet/launch.mjs) -le 1757 [M4]
- Run: node fleet/tests/test_launch_duplicate.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the namespace of `fleet/plan-pins.mjs` is exactly `verifyPlanPins` — red while the file is absent or another name is exported [M1]; (b) one stale path pin and one stale slice pin, checked against the clone's own `HEAD`, come back as exactly two refusal lines in plan order with the pinned sha in each — red if the moved code lost an import it needs (the slice pin runs the throwaway checkout and `/bin/sh`) or a line's wording moved [M2]; (c) no definition of the ten seam names is left in `launch.mjs` and its namespace carries neither exported name — red while any is still there [M3]; (d) `launch.mjs` is at most 1757 lines — red while the 165-line seam is still inside it [M4]. The duplicate-guard sim, which drives a whole launch through `verifyPlanPins`, is the untagged guard.

**Stale-if:**
- issue-closed: #1277
- path-exists: `fleet/plan-pins.mjs`

### Task 2: The sandbox-toolchain check lives in fleet/toolchain.mjs

**Type:** implementation

**Files:**
- Create: `fleet/toolchain.mjs`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/tests/test_launch_probe_runners.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`

**Claim:** `launchBody` stays as the ordered walk (~600); launch.mjs lands near 1,300. (derived)
Machine: M1. `fleet/toolchain.mjs` exports exactly `SANDBOX_TOOLCHAIN`, `probeWordsOf` and `toolchainViolations`. M2. `fleet/tests/test_launch_probe_runners.mjs` imports those three from `../toolchain.mjs` and prints `ALL TESTS PASSED`. M3. `fleet/launch.mjs` no longer defines any of `SHELL_WORDS`, `SANDBOX_TOOLCHAIN`, `probeWordsOf`, `toolchainViolations`, and its module namespace has none of those four names. M4. `fleet/launch.mjs` is at most `1777` lines long (it is `1907` at BASE). M5. No line of `fleet/CONTRACT.md` or `fleet/RUNBOOK.md` that names `SANDBOX_TOOLCHAIN` names `launch.mjs`, and each of the two files names `fleet/toolchain.mjs`.

**Authorized-by:** popmechanic/ultrapowers#1277 (the `toolchain.mjs` bullet)

**Interfaces:**
- Consumes: nothing
- Produces: `toolchainViolations(compiled) -> Array<{ task, word, cmd }>`
- Produces: `probeWordsOf(line) -> string[]`
- Produces: `SANDBOX_TOOLCHAIN`

**Context:** At BASE the toolchain seam of `fleet/launch.mjs` is lines 295–436: `SHELL_WORDS` (with its comment), `SANDBOX_TOOLCHAIN`, `probeWordsOf` and `toolchainViolations`, all pure — no imports needed. Move them, comments included, into `fleet/toolchain.mjs`, exporting `SANDBOX_TOOLCHAIN`, `probeWordsOf` and `toolchainViolations` (the sim reads all three) and keeping `SHELL_WORDS` a plain module constant. `launch.mjs` imports `toolchainViolations` from `./toolchain.mjs`; its one call in `launchBody` and the refusal it builds (`launch: task <id>: probe runner '<word>' is not in the sandbox toolchain — <line>`) are unchanged. At BASE `fleet/tests/test_launch_probe_runners.mjs` line 32 does `import * as launchModule from '../launch.mjs'` and line 39 destructures `probeWordsOf`, `toolchainViolations`, `SANDBOX_TOOLCHAIN` and `launch` from it; re-aim the three pure names to `../toolchain.mjs` (keep `launch` from `../launch.mjs`), and let its `isFunction` message name `fleet/toolchain.mjs`; no assertion changes. A sim may import any `fleet/*.mjs` module but never a sibling `test_*.mjs`. `fleet/CONTRACT.md` line 143 and `fleet/RUNBOOK.md` line 245 each say `SANDBOX_TOOLCHAIN` is in `fleet/launch.mjs`; point both at `fleet/toolchain.mjs`, keeping the rest of each sentence. Sibling tasks move the plan-pin, kata-filing and compiler seams out of `launch.mjs` concurrently and a fourth un-exports what is left; this task touches none of their lines.

**Proof:**
- Run: node --input-type=module -e 'const m = await import("./fleet/toolchain.mjs"); if (Object.keys(m).join(",") !== "SANDBOX_TOOLCHAIN,probeWordsOf,toolchainViolations") { console.log(Object.keys(m)); process.exit(1) }' [M1]
- Run: grep -q "toolchain.mjs'" fleet/tests/test_launch_probe_runners.mjs && node fleet/tests/test_launch_probe_runners.mjs | grep -q 'ALL TESTS PASSED' [M2]
- Run: test $(grep -cE '^(export )?(async )?(function|const) (SHELL_WORDS|SANDBOX_TOOLCHAIN|probeWordsOf|toolchainViolations)[ =(]' fleet/launch.mjs) -eq 0 && node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); for (const k of ["SHELL_WORDS", "SANDBOX_TOOLCHAIN", "probeWordsOf", "toolchainViolations"]) if (k in m) process.exit(1)' [M3]
- Run: test $(wc -l < fleet/launch.mjs) -le 1777 [M4]
- Run: ! grep -h 'SANDBOX_TOOLCHAIN' fleet/CONTRACT.md fleet/RUNBOOK.md | grep -q 'launch.mjs' && grep -q 'fleet/toolchain.mjs' fleet/CONTRACT.md && grep -q 'fleet/toolchain.mjs' fleet/RUNBOOK.md [M5]
- Legs: (a) the namespace of `fleet/toolchain.mjs` is exactly the three names — red while the file is absent or `SHELL_WORDS` is exported [M1]; (b) the probe-runners sim names `toolchain.mjs` in an import and still prints its sentinel, which exercises all three names and a whole refused launch — red if the re-aim is missing or the move changed a word list [M2]; (c) no definition of the four names is left in `launch.mjs` and its namespace carries none of them — red while any is still there [M3]; (d) `launch.mjs` is at most 1777 lines — red while the 142-line seam is still inside it [M4]; (e) neither doc line naming `SANDBOX_TOOLCHAIN` still says `launch.mjs`, and both docs name the new file — red on either stale pointer [M5].

**Stale-if:**
- issue-closed: #1277
- path-exists: `fleet/toolchain.mjs`

### Task 3: Filing a run on the hub lives in fleet/kata-file.mjs

**Type:** implementation

**Files:**
- Create: `fleet/kata-file.mjs`
- Modify: `fleet/launch.mjs`

**Claim:** `launchBody` stays as the ordered walk (~600); launch.mjs lands near 1,300. (derived)
Machine: M1. `fleet/kata-file.mjs` exports exactly one name, `fileRunOnHub`. M2. Called with a fake hub, `call` that just runs its function, plan text `# Title` then `**Claim:** c`, target `acme/w`, `n: 7` and one wave holding task `1`, `fileRunOnHub` from `fleet/kata-file.mjs` answers a record whose `url` is `https://kata.int.exe.xyz`, whose `project.name` is `acme-w` and whose task `1` carries the `short_id` of the second create (`s2`); the first create it made is titled `run-7: Title` with an idempotency key matching `acme/w:<40 hex>:run-7`. M3. `fleet/launch.mjs` no longer defines any of `fileRunOnHub`, `planBlobSha`, `planTitleOf`, `planClaimOf`, `planClosesOf`, `KATA_SANDBOX_URL`, its module namespace has none of those six names, and neither `fleet/launch.mjs` nor `fleet/kata-file.mjs` names `hubFromEnv`. M4. `fleet/launch.mjs` is at most `1752` lines long (it is `1907` at BASE).

**Authorized-by:** popmechanic/ultrapowers#1277 (the `kata-file.mjs` bullet)

**Interfaces:**
- Consumes: nothing
- Produces: `fileRunOnHub({ hub, call, planText, target, base, n, compiled }) -> Promise<{ url, project, run, tasks }>`

**Context:** At BASE the kata-filing seam of `fleet/launch.mjs` is three pieces: `KATA_SANDBOX_URL` with its comment (lines 130–134), `planTitleOf`, `planClaimOf`, `planClosesOf` with their comments (166–187), and `planBlobSha` plus `async function fileRunOnHub` with their comments and the trailing `export { fileRunOnHub }` (1702–1846). Move all of it, comments included, into `fleet/kata-file.mjs`, which imports what it needs itself (`crypto` from `node:crypto`; `Refusal` and `kataProjectFor` from `./lobby.mjs`) and exports only `fileRunOnHub`. `launch.mjs` imports `fileRunOnHub` from `./kata-file.mjs`; the `kataStep` closure in `launchBody` that calls it is unchanged, and `launch.mjs` drops its now-unused `node:crypto` import and `kataProjectFor` from its `./lobby.mjs` import list. The hub client stays built inside `launchBody` exactly as at BASE — `readKataEnv(kataEnvPath)`, then `kataHostOf`, `sshTransport`, `makeKataClient` (around line 1058) — and `readKataEnv`, `KATA_PATH`, `commitPlan` and `pushPlan` stay in `launch.mjs`. Do not create or call any `hubFromEnv`: a sibling plan (#1279) creates that helper in another file, and this plan must not depend on it. The record's keys and order (`url`, `project`, `run`, `tasks`), the idempotency keys (`<target>:<plan blob sha>:run-<n>` and `…:task-<id>`) and every hub call are unchanged. Sibling tasks move the plan-pin, toolchain and compiler seams out of `launch.mjs` concurrently and a fourth un-exports what is left (including the `KATA_PATH` line just above `KATA_SANDBOX_URL`); this task touches none of their lines.

**Proof:**
- Run: node --input-type=module -e 'const m = await import("./fleet/kata-file.mjs"); if (Object.keys(m).join(",") !== "fileRunOnHub") { console.log(Object.keys(m)); process.exit(1) }' [M1]
- Run: node --input-type=module -e 'import { fileRunOnHub } from "./fleet/kata-file.mjs"; const creates = []; let u = 0; const hub = { createProject: async (name) => ({ id: "p", uid: "pu", name }), createIssue: async (pid, body) => { creates.push(body); u += 1; return { uid: "u" + u, short_id: "s" + u, revision: 1 } }, getIssue: async (uid) => ({ revision: 2 }), patchMetadata: async () => ({}), link: async () => ({}) }; const rec = await fileRunOnHub({ hub, call: (m, fn) => fn(), planText: "# Title\n**Claim:** c\n", target: "acme/w", base: "b", n: 7, compiled: { waves: [[{ id: "1", title: "t" }]], edges: [] } }); const ok = rec.url === "https://kata.int.exe.xyz" && rec.project.name === "acme-w" && rec.tasks["1"].short_id === "s2" && creates[0].title === "run-7: Title" && /^acme\/w:[0-9a-f]{40}:run-7$/.test(creates[0].idempotencyKey); if (!ok) { console.log(JSON.stringify({ rec, creates })); process.exit(1) }' [M2]
- Run: test $(grep -cE '^(export )?(async )?(function|const) (fileRunOnHub|planBlobSha|planTitleOf|planClaimOf|planClosesOf|KATA_SANDBOX_URL)[ =(]' fleet/launch.mjs) -eq 0 && ! grep -q hubFromEnv fleet/launch.mjs fleet/kata-file.mjs && node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); for (const k of ["fileRunOnHub", "planBlobSha", "planTitleOf", "planClaimOf", "planClosesOf", "KATA_SANDBOX_URL"]) if (k in m) process.exit(1)' [M3]
- Run: test $(wc -l < fleet/launch.mjs) -le 1752 [M4]
- Legs: (a) the namespace of `fleet/kata-file.mjs` is exactly `fileRunOnHub` — red while the file is absent or a helper is exported [M1]; (b) one filing against a fake hub answers the sandbox url, the target's project name, the task's short id and a run issue titled from the plan's H1 with a `run-7` idempotency key over a 40-hex plan sha — red if the move lost `crypto`, `kataProjectFor` or a plan reader [M2]; (c) no definition of the six names is left in `launch.mjs`, its namespace carries none of them, and neither file names `hubFromEnv` — red while any is still there or the sibling's helper was pulled in [M3]; (d) `launch.mjs` is at most 1752 lines — red while the seam is still inside it [M4].

**Stale-if:**
- issue-closed: #1277
- path-exists: `fleet/kata-file.mjs`

### Task 4: Fetching and running the plan checker lives in fleet/compiler.mjs

**Type:** implementation

**Files:**
- Create: `fleet/compiler.mjs`
- Modify: `fleet/launch.mjs`

**Claim:** `launchBody` stays as the ordered walk (~600); launch.mjs lands near 1,300. (derived)
Machine: M1. `fleet/compiler.mjs` exports exactly `compilePlanForRun`, `fetchCompilerAt` and `verifyPlanCompiles`. M2. With a fake `exec` that answers every `git` call with `body` and a newline, a `python3` call carrying `--base` with `PLAN OK` then `BASE fact: x`, and any other `python3` call with a parse holding one launch wave, the three functions of `fleet/compiler.mjs` answer: `fetchCompilerAt` a `source` of `git-show` and a `scriptPath` ending `skills/ultrapowers/scripts/plan_check.py` whose parser file holds `body` and a newline; `verifyPlanCompiles` exactly `["BASE fact: x"]`; `compilePlanForRun` one wave under stamp `run-1`. M3. `fleet/launch.mjs` no longer defines any of `CHECKER_REL`, `PARSER_REL`, `fetchCompilerAt`, `requireCompilerPath`, `PIN_SCRIPT_REL`, `BASE_FACTS_STAMP`, `verifyPlanCompiles`, `compilePlanForRun`, and its module namespace has none of `fetchCompilerAt`, `verifyPlanCompiles`, `compilePlanForRun`. M4. `fleet/launch.mjs` is at most `1737` lines long (it is `1907` at BASE).

**Authorized-by:** popmechanic/ultrapowers#1277 (the `compiler.mjs` bullet)

**Interfaces:**
- Consumes: nothing
- Produces: `fetchCompilerAt({ exec, engine, pluginRoot }) -> Promise<{ dir, scriptPath, parserPath, source }>`
- Produces: `verifyPlanCompiles({ exec, repoDir, base, planPath, planText, compilerPath }) -> Promise<string[]>`
- Produces: `compilePlanForRun({ exec, repoDir, planPath, stamp, compilerPath }) -> Promise<{ stamp, payload, waves, edges }>`

**Context:** At BASE the compiler seam of `fleet/launch.mjs` is lines 627–821: `CHECKER_REL`, `PARSER_REL`, `fetchCompilerAt`, `requireCompilerPath`, `PIN_SCRIPT_REL`, `BASE_FACTS_STAMP`, `verifyPlanCompiles` and `compilePlanForRun`, each with its comment. Move them into `fleet/compiler.mjs`, which imports what it needs itself (`node:fs/promises`, `node:os`, `node:path`; `ENGINE_REPO`, `Refusal`, `git`, `output` from `./lobby.mjs`) and exports only the three functions. `PLUGIN_ROOT` and its comment (lines 634–640) stay in `launch.mjs`, because `launchBody` passes it to `fetchCompilerAt` as `pluginRoot`; `defaultEngineSha` stays in `launch.mjs` too. `launch.mjs` imports the three from `./compiler.mjs`, their calls in `launchBody` are unchanged, and `ENGINE_REPO` leaves its `./lobby.mjs` import list (nothing else there uses it). Every refusal text (`launch: could not fetch …`, `launch: plan_check.py --base … refused …`, `launch: plan_parse.py for … failed …`) and every argv (`python3 <plan_check.py> --base <base> --repo <repoDir> <plan>`, `python3 <plan_parse.py> <plan>`) is unchanged. Sibling tasks move the plan-pin, toolchain and kata-filing seams out of `launch.mjs` concurrently and a fourth un-exports what is left; this task touches none of their lines.

**Proof:**
- Run: node --input-type=module -e 'const m = await import("./fleet/compiler.mjs"); if (Object.keys(m).join(",") !== "compilePlanForRun,fetchCompilerAt,verifyPlanCompiles") { console.log(Object.keys(m)); process.exit(1) }' [M1]
- Run: node --input-type=module -e 'import fs from "node:fs"; import { fetchCompilerAt, verifyPlanCompiles, compilePlanForRun } from "./fleet/compiler.mjs"; const exec = async (cmd, argv) => cmd === "git" ? { code: 0, stdout: "body\n", stderr: "" } : argv.includes("--base") ? { code: 0, stdout: "PLAN OK\nBASE fact: x\n", stderr: "" } : { code: 0, stdout: JSON.stringify({ launch_waves: [[{ id: "1" }]], dag_edges: [] }), stderr: "" }; const c = await fetchCompilerAt({ exec, engine: "e".repeat(40), pluginRoot: "." }); const facts = await verifyPlanCompiles({ exec, repoDir: ".", base: "b".repeat(40), planPath: "p.md", planText: "# p\n", compilerPath: c.scriptPath }); const run = await compilePlanForRun({ exec, repoDir: ".", planPath: "p.md", stamp: "run-1", compilerPath: c.parserPath }); const ok = c.source === "git-show" && c.scriptPath.endsWith("skills/ultrapowers/scripts/plan_check.py") && fs.readFileSync(c.parserPath, "utf8") === "body\n" && JSON.stringify(facts) === JSON.stringify(["BASE fact: x"]) && run.waves.length === 1 && run.stamp === "run-1"; fs.rmSync(c.dir, { recursive: true, force: true }); if (!ok) { console.log(JSON.stringify({ c, facts, run })); process.exit(1) }' [M2]
- Run: test $(grep -cE '^(export )?(async )?(function|const) (CHECKER_REL|PARSER_REL|fetchCompilerAt|requireCompilerPath|PIN_SCRIPT_REL|BASE_FACTS_STAMP|verifyPlanCompiles|compilePlanForRun)[ =(]' fleet/launch.mjs) -eq 0 && node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); for (const k of ["fetchCompilerAt", "verifyPlanCompiles", "compilePlanForRun"]) if (k in m) process.exit(1)' [M3]
- Run: test $(wc -l < fleet/launch.mjs) -le 1737 [M4]
- Run: node fleet/tests/test_launch_plan_path.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the namespace of `fleet/compiler.mjs` is exactly the three functions — red while the file is absent or a constant or `requireCompilerPath` is exported [M1]; (b) the fetch writes the fetched body under its real relative path from `git show`, the check keeps only the fact line, and the parse answers the one wave under its stamp — red if the move lost an import (`fs`, `os`, `path`, `git`, `output`) or changed a filter [M2]; (c) no definition of the eight names is left in `launch.mjs` and its namespace carries none of the three functions — red while any is still there [M3]; (d) `launch.mjs` is at most 1737 lines — red while the seam is still inside it [M4]. The plan-path sim, which drives a whole launch through the fetch, the check and the parse and reads every `python3` argv, is the untagged guard.

**Stale-if:**
- issue-closed: #1277
- path-exists: `fleet/compiler.mjs`

### Task 5: fleet/launch.mjs exports only what the sims import

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`

**Claim:** `launchBody` stays as the ordered walk (~600); launch.mjs lands near 1,300. (derived)
Machine: M1. The module namespace of `fleet/launch.mjs` has none of these nineteen names: `DEFAULT_ACCOUNT`, `PLAN_PATH`, `VERDICTS_PATH`, `KATA_PATH`, `KATA_HUB_FIX`, `defaultKataEnvPath`, `readKataEnv`, `BASE_OFF_MAIN_FIX`, `SHALLOW_FIX`, `NEW_ATTEMPTS`, `RETRY_MIN_MS`, `RETRY_MAX_MS`, `vmSizeFor`, `sizeFromCompile`, `stampWidth`, `targetOfOriginUrl`, `publishRefusal`, `liveDuplicatesOf`, `PUSH_ATTEMPTS`. M2. The namespace still has each of the seven names the sims import: `USAGE`, `usage`, `launch`, `renderLaunch`, `defaultRefreshCredential`, `defaultReadUsage`, `USAGE_REFUSE_PCT`.

**Authorized-by:** popmechanic/ultrapowers#1277; the operator's decision for this bundle (un-export every `fleet/launch.mjs` export that has no importer anywhere in the repository)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** At BASE `fleet/launch.mjs` exports 40 names. Read at BASE across `fleet/`, `factory/`, `tests/` and `skills/`, the only files importing it are the five `fleet/tests/test_launch_*.mjs` sims, and together they use `USAGE`, `usage`, `launch`, `renderLaunch`, `defaultRefreshCredential`, `defaultReadUsage`, `USAGE_REFUSE_PCT` — plus `probeWordsOf`, `toolchainViolations` and `SANDBOX_TOOLCHAIN`, which a sibling task moves to `fleet/toolchain.mjs` together with the sim's import. Fourteen more exports leave with the four sibling moves (plan pins, toolchain, kata filing, compiler). This task drops the `export` keyword from the remaining nineteen, each a declaration outside those seams, and nothing else: `DEFAULT_ACCOUNT` (line 113), `PLAN_PATH` (124), `VERDICTS_PATH` (125), `KATA_PATH` (129), `readKataEnv` (150), `BASE_OFF_MAIN_FIX` (190), `SHALLOW_FIX` (195), `NEW_ATTEMPTS`, `RETRY_MIN_MS`, `RETRY_MAX_MS` (201–203), `vmSizeFor` (236), `sizeFromCompile` (258), `stampWidth` (286), `targetOfOriginUrl` (449), `publishRefusal` (908), `liveDuplicatesOf` (936), `PUSH_ATTEMPTS` (1636); and deletes the re-export line `export { KATA_HUB_FIX, defaultKataEnvPath }` (138) — both stay imported from `./lobby.mjs`, where `launchBody` still uses them — trimming that line's comment ("re-exported so the launcher's callers see them here") to match. Every declaration stays, every body is unchanged. The seven names the sims import stay exported. Do not touch `KATA_SANDBOX_URL` (lines 130–134, the kata-filing sibling moves it) or any line of the four moved seams.

**Proof:**
- Run: node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); const left = ["DEFAULT_ACCOUNT", "PLAN_PATH", "VERDICTS_PATH", "KATA_PATH", "KATA_HUB_FIX", "defaultKataEnvPath", "readKataEnv", "BASE_OFF_MAIN_FIX", "SHALLOW_FIX", "NEW_ATTEMPTS", "RETRY_MIN_MS", "RETRY_MAX_MS", "vmSizeFor", "sizeFromCompile", "stampWidth", "targetOfOriginUrl", "publishRefusal", "liveDuplicatesOf", "PUSH_ATTEMPTS"].filter((k) => k in m); if (left.length) { console.log(left); process.exit(1) }' [M1]
- Run: node --input-type=module -e 'const m = await import("./fleet/launch.mjs"); const gone = ["USAGE", "usage", "launch", "renderLaunch", "defaultRefreshCredential", "defaultReadUsage", "USAGE_REFUSE_PCT"].filter((k) => !(k in m)); if (gone.length) { console.log(gone); process.exit(1) }' [M2]
- Run: node fleet/tests/test_launch_credential.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_one_engine.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) none of the nineteen names is on the namespace — red while any is still exported, and red at BASE where all nineteen are [M1]; (b) each of the seven kept names is still on the namespace — red if the un-export took one too many [M2]. The credential and one-engine sims, which link against those names by named import, are the untagged guards.

**Stale-if:**
- issue-closed: #1277
