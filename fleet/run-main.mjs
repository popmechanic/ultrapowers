#!/usr/bin/env node
// fleet/run-main.mjs — the deterministic engine entry (#402's drive-one assembly).
//
// This is the module that replaces the LLM engine session. SKILL.md §Engine had
// a Claude session run five steps — preflight, judge-and-fill, render, launch,
// gate — of which only one (the tier fill) was ever a judgment call, and that
// call is going away (#243: tier is signed in the intent). So the whole engine
// session becomes one deterministic program:
//
//   ultra_run.py preflight+compile  →  fill tiers  →  --validate-knobs
//   →  provision the run tree (spec §5: clones at BASE, patches, workers,
//      roles, a fresh CLAUDE_CONFIG_DIR, the event log)
//   →  runWaves() with agent = withPatchCapture(createRunWorker(...))
//   →  fetch the integration branch back from the clone
//   →  finalize_report.py → ultra_gate.py → the two-move rule → --approve
//
// It runs ON THE SANDBOX, spawned by the shim in place of `claude`
// (shim-main.mjs engine modes) — and from nothing else: ultra_run.py's
// fleet-run stage refuses without ULTRAPOWERS_FLEET_RUN, which main() sets
// from the runId, so a laptop invocation dies at preflight for pennies.
//
// TWO HALVES OF ONE DECISION, set together or not at all (#402 obligation 1,
// #418 review): `args.patchInput` and the withPatchCapture wrapper. The flag
// without the wrapper re-opens the model-typed-patch hole (waves.js would
// honour a patch path the worker invented); the wrapper without the flag
// strips every driver-captured patch and loses the whole run to
// lost-coordinates. composeAgent() below is the only place either exists,
// and it sets both — the flag's VALUE is the driver-owned patches directory,
// which waves.js uses as the trust anchor (a reply's patch outside that
// prefix is stripped).
//
// WHERE THE GATE RUNS, and why there is a fetch. The engine's write side works
// in clones/integration (makeCwdFor routes it there); the setup agent creates
// `ultra/integration-<stamp>` INSIDE that clone, so at engine end the run's
// product exists only in the clone's refs. The frozen gate scripts, the shim's
// receipt discovery, and the publish leg all read the REPO checkout — 23 runs
// of evidence on that geometry. One driver-owned fetch bridges the two:
// repo ← clone, the integration branch only, after the engine returns. No
// agent is involved and no prompt knows about it.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  runWaves, cloneAtBase, makeCwdFor, withPatchCapture, makeEventLog, defaultTaskIdOf,
} from './run-waves.mjs'
import { createRunWorker } from './run-worker.mjs'

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The driver's scheduler bound. The engine's own chunking constant
// (waves.js CONCURRENCY = 16) is the Workflow tool's cap and is #402 item 8's
// problem; the number that governs how many `claude -p` processes actually
// run at once is THIS one, and it is the spec's measured-margin default
// (#398: 12/12 clean where the study stopped; 8 is "the last arm with real
// headroom"). Raise it only with the suite-running width arm (#402 item 7).
export const WIDTH = 8

// Per-role wall-clock deadlines. Placement (which role gets which bound) is
// principled — a read-only reviewer has no suite to run and no tree to edit,
// so it must finish well before an implementer; merge agents run the test
// suite, so they get implementer time. The VALUES are defaults pending
// measurement: no per-role duration distribution exists yet (runs 18–23
// predate per-role timing), so these are sized from the one number known —
// the old single 30-minute default never tripped. The first runs' event logs
// (worker:start/end pairs) are the data that re-sizes them.
export const ROLE_TIMEOUT_MS = {
  implementer: 30 * 60 * 1000,
  writeSide: 30 * 60 * 1000,
  reviewer: 15 * 60 * 1000,
  critic: 15 * 60 * 1000,
}

export const DEFAULTS = Object.freeze({
  repoDir: REPO_DIR,
  tier: 'mostCapable',
  overlap: null,
  testCmd: null,
  bootstrapCmd: null,
  cli: 'claude',
})

const FLAGS = Object.freeze({
  '--repo': 'repoDir',
  '--tier': 'tier',
  '--overlap': 'overlap',
  '--test-cmd': 'testCmd',
  '--bootstrap-cmd': 'bootstrapCmd',
  '--cli': 'cli',
})

export const usage = () =>
  'usage: node fleet/run-main.mjs <plan.md> <runId> [--repo DIR] [--tier standard|mostCapable] ' +
  '[--overlap fold|serialize] [--test-cmd CMD] [--bootstrap-cmd CMD] [--cli BIN]'

export function parseArgs(argv) {
  const positional = []
  const opts = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = FLAGS[arg]
      if (!key) throw new Error('run-main: unknown flag ' + arg + '\n' + usage())
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('run-main: ' + arg + ' needs a value\n' + usage())
      }
      opts[key] = value
      i += 1
      continue
    }
    positional.push(arg)
  }
  const [planPath, runId, ...extra] = positional
  if (!planPath || !runId || extra.length) {
    throw new Error('run-main: expected exactly <plan.md> <runId>\n' + usage())
  }
  // Same shape rule as drive-one (#211), and doubly load-bearing here: the
  // runId IS the stamp, so it names the run dir, the integration branch and
  // the wf_ worktree glob.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId)) {
    throw new Error('run-main: runId must be [A-Za-z0-9-] (got ' + JSON.stringify(runId) + ')')
  }
  return { planPath, runId, ...opts }
}

// argv-based exec seam — never a shell string, because plan paths and branch
// names ride these calls. Resolves, never rejects; callers branch on code.
export const execSeam = (cmd, argv, { cwd, env } = {}) =>
  new Promise((resolve) => {
    execFile(cmd, argv, {
      cwd,
      env: env || process.env,
      maxBuffer: 1024 * 1024 * 64,
    }, (error, stdout, stderr) => resolve({
      code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      stdout: String(stdout ?? ''), stderr: String(stderr ?? ''),
    }))
  })

// ── tier fill (the last LLM judgment, made deterministic) ────────────────────
// SKILL.md step 2 had the orchestrator judge each null tier "by scope and
// judgment-likelihood". The driver stamps ONE tier across the run — default
// mostCapable, the standing quality-over-tokens posture — and records the
// fill. This is deliberately cruder than the LLM's per-task judgment and
// deliberately honest about it: per-task tier is the intent document's slot
// (#243 — signed, not judged), and until #390 lands the uniform stamp is the
// only producer that cannot hallucinate a judgment. `review` is plan-authored
// and never touched.
export function fillTiers(argsObj, tier) {
  let filled = 0
  for (const wave of argsObj.waves || []) {
    for (const t of wave) {
      if (t.tier == null) { t.tier = tier; filled += 1 }
    }
  }
  return filled
}

// ── the two-move rule (SKILL.md step 5, made deterministic) ──────────────────
// NEEDS_ACK approves iff EVERY ack is a deferredVerification item with reason
// runtime or external (ack.type is "deferred:<reason>", gate_check.py:134).
// Anything else — coverage acks, unknown types — leaves the gate receipt as
// the terminal artifact. Pre-authorized by the #243 grilling (manual acks
// pre-authorized, parks → 0) for exactly this closed list, nothing wider.
//
// The acks live at `gateCheck.acks`: gate_check.py emits {verdict,checks,acks}
// and ultra_gate.py embeds that whole object one level down under `gateCheck`
// (ultra_gate.py:107). Reading a flat `receipt.acks` — which the script never
// writes — would see [] on EVERY run and approve unconditionally, the exact
// park-path bypass this function exists to prevent. `acksOf` is the one reader.
export const acksOf = (gateReceipt) =>
  (gateReceipt && gateReceipt.gateCheck && gateReceipt.gateCheck.acks) || []

export function ackDecision(gateReceipt) {
  const acks = acksOf(gateReceipt)
  const bad = acks.filter((a) => a.type !== 'deferred:runtime' && a.type !== 'deferred:external')
  if (bad.length) {
    return { approve: false, reason: 'non-pre-authorized ack(s): ' + bad.map((a) => a.type).join(', ') }
  }
  return { approve: true, reason: acks.length + ' deferred runtime/external ack(s) — pre-authorized (#243)' }
}

// ── the run tree (spec §5) ───────────────────────────────────────────────────
// Everything lives under the ultra_run-minted run dir (already self-ignored
// via the state dir's `.gitignore: *`), so the evidence bundle is ONE tree:
// receipts beside clones beside the event log, and the shim's receipt
// discovery finds it where it always has.
export function provisionRunTree({ repoDir, runDir, base, taskIds }) {
  const clonesDir = path.join(runDir, 'clones')
  const patchesDir = path.join(runDir, 'patches')
  const workersDir = path.join(runDir, 'workers')
  const configDir = path.join(runDir, 'claude')
  for (const d of [patchesDir, workersDir, configDir]) fs.mkdirSync(d, { recursive: true })
  cloneAtBase({ repo: repoDir, dest: path.join(clonesDir, 'integration'), base })
  for (const id of taskIds) {
    cloneAtBase({ repo: repoDir, dest: path.join(clonesDir, 'task-' + id), base })
  }
  return { clonesDir, patchesDir, workersDir, configDir }
}

// ── role prompt files (spec §4) ──────────────────────────────────────────────
// Appended per role via --append-system-prompt-file. NEUTRAL on purpose, and
// that is a rule, not a style: confinement is verified against a neutral role
// prompt and a hostile task (spec §4) — a role prompt that asks the model to
// respect its boundary turns every confinement probe into prompt-level
// compliance, and the hook's denials stop being evidence. So these carry
// orientation (headless, disposable sandbox, where you are) and NOTHING about
// what the role may not touch; the allowlists and the PreToolUse hook are the
// boundary. One file per ROLES key; content constant per role so the shared
// cache prefix holds across workers (#382).
export const ROLE_PROMPTS = {
  implementer:
    'You are running headless inside a disposable fleet sandbox; no operator is present. ' +
    'Your working directory is your task\'s own working tree.\n',
  writeSide:
    'You are running headless inside a disposable fleet sandbox; no operator is present. ' +
    'Your working directory is the run\'s integration tree.\n',
  reviewer:
    'You are running headless inside a disposable fleet sandbox; no operator is present.\n',
  critic:
    'You are running headless inside a disposable fleet sandbox; no operator is present.\n',
}

export function writeRoleFiles(rolesDir) {
  fs.mkdirSync(rolesDir, { recursive: true })
  const files = {}
  for (const [role, text] of Object.entries(ROLE_PROMPTS)) {
    const p = path.join(rolesDir, role + '.md')
    fs.writeFileSync(p, text)
    files[role] = p
  }
  return (role) => files[role]
}

// ── the PreToolUse settings (spec §4, #402 item 5) ───────────────────────────
// One settings file, handed to the two acceptEdits roles only: the hook
// derives its writable roots from the worker's own cwd (always the right
// clone, by makeCwdFor) plus $FLEET_RUN_DIR, so nothing per-task is generated
// and nothing can point at the wrong tree. The allowlist roles get no
// settings — for them the allowlist is the boundary (parity R-w3), and a
// second mechanism would be a second thing to verify.
export function writeConfineSettings({ runDir, hookPath }) {
  const settingsPath = path.join(runDir, 'confine-settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
        hooks: [{ type: 'command', command: 'node ' + hookPath }],
      }],
    },
  }, null, 2))
  return (role) => (role === 'implementer' || role === 'writeSide') ? settingsPath : undefined
}

// ── agent composition — the one decision, both halves ────────────────────────
export function composeAgent({ runId, base, clonesDir, patchesDir, workersDir,
                               promptFileFor, settingsFor, env, cli, eventLog, spawnFn }) {
  const inner = createRunWorker({
    runId,
    workersDir,
    cwdFor: makeCwdFor({ clonesDir }),
    promptFileFor,
    settingsFor,
    env,
    cli,
    timeoutMsFor: (role) => ROLE_TIMEOUT_MS[role],
    onEvent: eventLog.onEvent,
    ...(spawnFn ? { spawnFn } : {}),
  })
  const agent = withPatchCapture({
    agent: inner, clonesDir, base, patchesDir,
    taskIdOf: defaultTaskIdOf, onEvent: eventLog.onEvent,
  })
  // The flag's value IS the trust anchor: waves.js strips any reply patch
  // outside this prefix, so a launch template carrying `patchInput: true`
  // with no driver behind it anchors nothing and a model-typed path outside
  // the driver's directory is inert.
  return { agent, patchInput: patchesDir }
}

// Bounded parallel: at most WIDTH thunks in flight. Rejection semantics match
// defaultParallel (the first rejection propagates); waves.js's dispatch sites
// catch their own agent errors, so a rejection here is a programming error
// surfacing, not a worker outcome.
export const boundedParallel = (limit) => async (thunks) => {
  const results = new Array(thunks.length)
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, thunks.length)) }, async () => {
    while (next < thunks.length) {
      const i = next++
      results[i] = await thunks[i]()
    }
  })
  await Promise.all(lanes)
  return results
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// ── the engine, end to end ───────────────────────────────────────────────────
// Returns { code, verdict, detail } — code is the process exit (0 only on an
// approved run), verdict names where it ended for the log. Every refusal path
// leaves whatever receipt already exists as the terminal artifact (no receipt
// reads red at the shim; a BLOCKED gate receipt reads BLOCKED).
export async function runMain(parsed, deps = {}) {
  const {
    exec = execSeam,
    runWavesFn = runWaves,
    makeAgent = composeAgent,
    log = console.error,
    env = process.env,
  } = deps
  const { planPath, runId, tier, overlap, testCmd, bootstrapCmd, cli } = parsed
  // Absolute, always: patchesDir is derived from repoDir, and waves.js's
  // PATCH_PREFIX second wall arms only for an absolute patchInput — a relative
  // --repo would silently disarm it, leaving only withPatchCapture's reply
  // strip (review finding 4). Resolve here so the invariant is unconditional.
  const repoDir = path.resolve(parsed.repoDir)
  const stamp = runId
  const py = 'python3'
  const scripts = path.join(repoDir, 'skills/ultrapowers/scripts')
  // ULTRAPOWERS_FLEET_RUN: ultra_run's fleet-run stage (and nothing else here)
  // reads it; setting it from the runId is what makes this entry the engine.
  const pyEnv = { ...env, ULTRAPOWERS_FLEET_RUN: runId }

  // The run dir is NOT reconstructed from repoDir: ultra_run.py writes it under
  // the git TOPLEVEL (its own `git rev-parse --show-toplevel`), which differs
  // from repoDir if repoDir is a subdir — and on macOS even the toplevel is
  // symlink-resolved (/tmp → /private/tmp). Reconstructing it here would then
  // read a receipt at a path the script never wrote and silently see empty
  // acks (review LOW note). So the run dir is DERIVED from ultra_run's own
  // receipt (`argsFile`'s directory) — wherever the script actually wrote.
  // The event log therefore opens AFTER preflight; a compile-death is still
  // recorded, by ultra_run's own receipt.json (the record either way).
  let eventLog = { onEvent: () => {}, log: () => {}, phase: () => {} }
  const stage = (name, detail) => {
    eventLog.onEvent({ kind: 'driver:stage', stage: name, ...(detail ? { detail } : {}) })
    log('run-main: ' + name + (detail ? ' — ' + detail : ''))
  }
  const fail = (verdict, detail) => {
    eventLog.onEvent({ kind: 'driver:fail', verdict, detail })
    log('run-main: ' + verdict + ' — ' + detail)
    return { code: 1, verdict, detail }
  }

  // 1. Preflight + compile (ultra_run.py, fail-closed; its receipt is the
  // record either way). The receipt is ultra_run's stdout on success.
  stage('preflight')
  const runArgv = [path.join(scripts, 'ultra_run.py'), planPath, '--stamp', stamp]
  if (testCmd) runArgv.push('--test-cmd', testCmd)
  if (bootstrapCmd) runArgv.push('--bootstrap-cmd', bootstrapCmd)
  if (overlap) runArgv.push('--overlap', overlap)
  const pre = await exec(py, runArgv, { cwd: repoDir, env: pyEnv })
  if (pre.code !== 0) {
    return fail('preflight-failed', 'ultra_run.py exited ' + pre.code + ': ' +
      (pre.stderr || pre.stdout).slice(-500))
  }
  let receipt
  try {
    receipt = JSON.parse(pre.stdout)
  } catch (e) {
    return fail('preflight-unreadable', 'ultra_run.py exited 0 but its receipt is not JSON: ' +
      String((e && e.message) || e))
  }
  const argsFilePath = receipt.argsFile
  if (typeof argsFilePath !== 'string' || !argsFilePath) {
    return fail('preflight-unreadable', 'ultra_run.py receipt carries no argsFile path')
  }
  // The authoritative run dir: where ultra_run put args.json. The event log,
  // clones, patches, roles and receipts all hang off THIS, never a guess.
  const runDir = path.dirname(argsFilePath)
  eventLog = makeEventLog({
    file: path.join(runDir, 'events.jsonl'), runId, base: '', source: 'fleet/run-main.mjs',
  })
  const baseBranch = receipt.baseBranch
  const argsObj = readJson(argsFilePath)
  if (!Array.isArray(argsObj.waves) || argsObj.waves.length === 0) {
    return fail('empty-plan', 'compile produced no waves — nothing to launch')
  }

  // 2. Fill tiers, write back, validate.
  const filled = fillTiers(argsObj, tier)
  fs.writeFileSync(argsFilePath, JSON.stringify(argsObj, null, 2))
  stage('tiers', filled + ' null tier slot(s) stamped ' + tier + ' (uniform driver fill; per-task tier is the intent document\'s slot, #243)')
  const vk = await exec(py, [path.join(scripts, 'ultra_run.py'), '--validate-knobs', argsFilePath],
    { cwd: repoDir, env: pyEnv })
  if (vk.code !== 0) {
    // Exit 3 is the red-baseline signal; SKILL.md launched past it only on a
    // plan-note pre-authorization, which is prose the driver does not read.
    // Fail closed; the operator re-drives with the repair plan.
    return fail('knob-validate-failed', 'ultra_run.py --validate-knobs exited ' + vk.code + ': ' +
      (vk.stdout || vk.stderr).slice(-500))
  }

  // 3. Provision the run tree.
  const baseR = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoDir })
  if (baseR.code !== 0) return fail('no-base', 'git rev-parse HEAD failed in ' + repoDir)
  const base = baseR.stdout.trim()
  const taskIds = argsObj.waves.flat().map((t) => t.id)
  stage('provision', 'BASE ' + base + '; ' + taskIds.length + ' task clone(s) + integration')
  const tree = provisionRunTree({ repoDir, runDir, base, taskIds })
  const promptFileFor = writeRoleFiles(path.join(runDir, 'roles'))
  const settingsFor = writeConfineSettings({
    runDir, hookPath: path.join(repoDir, 'fleet/confine-hook.mjs'),
  })

  // 4. The engine. CLAUDE_CONFIG_DIR points into the run tree (spec §5) so
  // every transcript is evidence; the credential rides the inherited env
  // (CLAUDE_CODE_OAUTH_TOKEN from the shim's per-run env file) untouched.
  const workerEnv = { ...env, CLAUDE_CONFIG_DIR: tree.configDir, FLEET_RUN_DIR: runDir }
  const { agent, patchInput } = makeAgent({
    runId, base,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor, settingsFor, env: workerEnv, cli, eventLog,
  })
  const integrationBranch = 'ultra/integration-' + stamp
  const launchArgs = {
    ...argsObj,
    integrationBranch,
    stamp,
    baseBranch,
    patchInput,
  }
  stage('engine', 'waves ' + argsObj.waves.map((w) => w.length).join('/') +
    ', width bound ' + WIDTH + ', patch input armed')
  let report
  try {
    report = await runWavesFn({
      agent,
      args: launchArgs,
      parallel: boundedParallel(WIDTH),
      log: eventLog.log,
      phase: eventLog.phase,
    })
  } catch (e) {
    return fail('engine-crashed', String((e && e.stack) || e).slice(0, 1500))
  }
  const resultPath = path.join(runDir, 'workflow-result.json')
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))
  stage('engine-done', 'report saved')

  // 5. Bridge: the integration branch, clone → repo. A missing branch (setup
  // never ran, or refused) falls through to finalize, which names it.
  const integ = path.join(tree.clonesDir, 'integration')
  const fetched = await exec('git', ['fetch', '--no-tags', integ,
    integrationBranch + ':' + integrationBranch], { cwd: repoDir })
  if (fetched.code !== 0) {
    stage('fetch-miss', 'integration branch not fetchable from the clone: ' +
      (fetched.stderr || '').slice(-300))
  }

  // 6. Gate. finalize non-zero is a pre-gate failure: the gate never runs.
  stage('finalize')
  const fin = await exec(py, [path.join(scripts, 'finalize_report.py'),
    '--report', resultPath, '--repo', repoDir, '--branch', integrationBranch],
    { cwd: repoDir, env: pyEnv })
  if (fin.code !== 0) {
    return fail('finalize-failed', (fin.stderr || fin.stdout).slice(-800))
  }
  stage('gate')
  const gate = await exec(py, [path.join(scripts, 'ultra_gate.py'),
    '--stamp', stamp, '--result', resultPath], { cwd: repoDir, env: pyEnv })
  if (gate.code !== 0 && gate.code !== 2) {
    return fail('gate-blocked', 'ultra_gate exited ' + gate.code +
      ' — gate receipt is the terminal artifact')
  }
  if (gate.code === 2) {
    const gr = readJson(path.join(runDir, 'gate-receipt.json'))
    const decision = ackDecision(gr)
    eventLog.onEvent({ kind: 'driver:ack-decision', approve: decision.approve, reason: decision.reason })
    if (!decision.approve) {
      return fail('needs-ack', decision.reason + ' — gate receipt is the terminal artifact')
    }
    // The pre-authorization record BEFORE the approve, exactly as SKILL.md
    // ordered it: the instruction is the launch itself.
    fs.writeFileSync(path.join(runDir, 'standing-approval.json'), JSON.stringify({
      grantedAt: 'launch directive',
      instruction: 'node fleet/run-main.mjs ' + planPath + ' ' + runId + ' (deterministic driver; #243 pre-authorization)',
      ackList: acksOf(gr),
    }, null, 2))
    stage('acks', decision.reason)
  }

  // 7. Approve: checkout + re-verify, receipt saved verbatim — the shim
  // greens the run only on this file with a matching stamp.
  stage('approve')
  const app = await exec(py, [path.join(scripts, 'ultra_gate.py'),
    '--approve', '--stamp', stamp], { cwd: repoDir, env: pyEnv })
  if (app.stdout.trim()) {
    fs.writeFileSync(path.join(runDir, 'approve-receipt.json'), app.stdout)
  }
  if (app.code !== 0) {
    return fail('approve-failed', 'ultra_gate --approve exited ' + app.code + ': ' +
      (app.stderr || app.stdout).slice(-500))
  }
  eventLog.onEvent({ kind: 'driver:approved', stamp, integrationBranch })
  log('run-main: approved — ' + integrationBranch)
  return { code: 0, verdict: 'approved', detail: integrationBranch }
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const parsed = parseArgs(argv)
  const out = await runMain(parsed, deps)
  return out.code
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error?.stack ?? error)
    process.exit(1)
  })
}
