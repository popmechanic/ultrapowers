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
//      --no-baseline (knobs only; the driver runs no suite of its own)
//   →  provision the run tree (spec §5: clones at BASE, patches, workers,
//      roles, a fresh CLAUDE_CONFIG_DIR, the event log)
//   →  runEngine() with agent = withPatchCapture(createRunWorker(...))
//      (Amendment 10: the native engine — waves.js is no longer loaded here)
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
// in clones/integration (makeCwdFor routes it there); the DRIVER creates
// `ultra/integration-<stamp>` INSIDE that clone (run-engine setup — no agent
// is involved since Amendment 10), so at engine end the run's product exists
// only in the clone's refs. The frozen gate scripts, the shim's
// receipt discovery, and the publish leg all read the REPO checkout — 23 runs
// of evidence on that geometry. One driver-owned fetch bridges the two:
// repo ← clone, the integration branch only, after the engine returns. No
// agent is involved and no prompt knows about it.
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  cloneAtBase, makeCwdFor, withPatchCapture, makeEventLog, defaultTaskIdOf,
} from './run-waves.mjs'
import { runEngine } from './run-engine.mjs'
import { createRunWorker } from './run-worker.mjs'
import { makeKataClient, httpTransport } from './kata-client.mjs'

// ONE VARIABLE BECAME TWO (#575, spec §1). `ENGINE_DIR` is THIS module's own
// repository, resolved from its own location: the kernel scripts, the role
// prompts and the confine hook are the engine's, wherever the engine was
// started from. `repoDir` (the mandatory `--repo`) is the tree being BUILT:
// BASE, the clones, the run dir and the gate. They were the same variable
// while the engine only ever built itself; that self-host special case is
// what this deletes, so nothing here defaults one to the other.
export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The driver's scheduler bound: how many `claude -p` processes one run may
// have in flight. It is the PLAN's number — the task count of its widest wave,
// which the launcher already knows from the compile it sizes the VM against and
// writes into the run's arguments as `width`. A wave never has more work in it
// than it has tasks, so a bound above that reserves headroom nothing can use,
// and a plan of one task has no reason to hold twelve streams open.
//
// The fallback is 12, and it is what an argument set with no `width` gets: a
// re-drive of an older assignment, and every run whose arguments come off the
// sandbox's own compile, still boot. It is a MEASURED number, never a vendor
// one — the exe.dev plan is a dynamically shared pool (a VM's allocated size is
// a cap, not a reservation — RUNBOOK §Billing: "the plan meters CONSUMPTION,
// not allocation"), and the sandbox's vCPU are divided among the implementers'
// suites by capWorkerParallelism, which at width >= 8 already hands each one a
// serial pytest. So what the fallback guards is the subscription's
// concurrent-stream headroom.
//
// History: #398's study ran 12/12 clean and stopped there; 8 was chosen as
// "the last arm with real headroom" and stood until 2026-09-01, when run-49
// ran width 8 at load 1.5 of 8 cores while race-48's three arms ran beside it
// (eleven concurrent streams on one account, no throttling, pool meter at 25%).
// 12 is the study's clean figure. Raise past it only with a suite-running
// width arm that watches sandbox memory (~3 GB per busy implementer) and the
// pool meter, not the load average (#402 item 7).
export const WIDTH_FALLBACK = 12

/** The run's width bound: the `width` its arguments carry when that is a
 *  positive integer, and the fallback otherwise. */
export const widthOf = (args) => {
  const asked = Number(args?.width)
  return Number.isInteger(asked) && asked > 0 ? asked : WIDTH_FALLBACK
}

/** W for the arguments a launch composes, off the box's OWN compile: the
 *  `width` they already carry when that is a positive integer, else the widest
 *  wave of `args.waves`, else the fallback.
 *
 *  Why the waves and not the launcher's number: `args.json` is written on the
 *  box by `compile_plan.py --emit-args` and amended by `ultra_run.py` with the
 *  two command knobs only — neither writes a `width`, and neither is a file a
 *  plan may touch. So the W the launcher sized the VM to has no carrier down
 *  to here (the assignment's keys are enumerated in two places that fail a
 *  boot on a tenth), and without this the bound would be the fallback on every
 *  real run. The widest wave of the compile the box did itself IS that W —
 *  one plan, compiled twice off the same base — so the engine reads it rather
 *  than being told it. A re-drive whose compile answers no waves still boots,
 *  at the fallback. */
export const widestWaveOf = (args) => {
  const asked = Number(args?.width)
  if (Number.isInteger(asked) && asked > 0) return asked
  const waves = Array.isArray(args?.waves) ? args.waves : []
  const widest = Math.max(0, ...waves.map((w) => (Array.isArray(w) ? w.length : 0)))
  return widest > 0 ? widest : WIDTH_FALLBACK
}

// Per-role wall-clock deadlines. Placement (which role gets which bound) is
// principled — a read-only reviewer has no suite to run and no tree to edit,
// so it must finish well before an implementer; merge agents run the test
// suite, so they get implementer time; the examiner reads the whole task and
// writes a suite, so it gets implementer time too.
//
// The deadline is a HANG guard, not a scope budget: it exists so a worker that
// never exits cannot hold a wave open forever, and it should sit far outside
// the working distribution. Measured on run-55 (2026-09-03, a seven-task
// claims-v1 plan): implementers ran 3/12/14/18/19/22 min and the widest task
// (19 files) was killed at the old 30-minute cap — the guard was adjudicating
// task width, which is the plan author's decision, not the engine's. 90 min
// keeps the hang protection above the observed spread. Reviewer-class roles
// ran 4–7 min, so their 15-minute bound stays.
export const ROLE_TIMEOUT_MS = {
  implementer: 90 * 60 * 1000,
  writeSide: 90 * 60 * 1000,
  examiner: 90 * 60 * 1000,
  reviewer: 15 * 60 * 1000,
  resolver: 15 * 60 * 1000,
}

// No `repoDir` key: the target is mandatory, and a default that pointed the
// engine at itself is exactly the self-host case being deleted.
export const DEFAULTS = Object.freeze({
  tier: 'mostCapable',
  // Unset means "the CLI's own default, for every role" — the knob only ever
  // turns the implementer down, and never touches a judge.
  implementerEffort: null,
  testCmd: null,
  bootstrapCmd: null,
  cli: 'claude',
  // No `kata` key: the run's kata record (`--kata`, written by the launcher
  // into the plan commit and landed beside the plan by the boot script) is
  // absent from a parse that did not name one, and absent means the run keeps
  // no state on the hub at all and the engine makes no request.
})

const FLAGS = Object.freeze({
  '--repo': 'repoDir',
  '--tier': 'tier',
  '--implementer-effort': 'implementerEffort',
  '--test-cmd': 'testCmd',
  '--bootstrap-cmd': 'bootstrapCmd',
  '--cli': 'cli',
  '--kata': 'kata',
})

export const usage = () =>
  'usage: node fleet/run-main.mjs <plan.md> <runId> --repo DIR [--tier standard|mostCapable] ' +
  '[--implementer-effort low|medium|high] ' +
  '[--test-cmd CMD] [--bootstrap-cmd CMD|\'\'] [--cli BIN] [--kata PATH]\n' +
  '  --bootstrap-cmd: omit to derive the install from the target\'s lockfile; \'\' disables it\n' +
  '  --kata: the run\'s kata.json record (url, project, run, tasks) — omit and the ' +
  'engine keeps no state on the hub'

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
  // The target is named or the run does not start. The shim always passes it
  // (its argv contract is [run-main.mjs, plan, runId, '--repo', target, …]),
  // and inferring one from this file's location is the deleted self-host case.
  if (!opts.repoDir) {
    throw new Error('run-main: --repo DIR is required — the engine builds the tree it is ' +
      'pointed at, never the one it lives in\n' + usage())
  }
  return { planPath, runId, ...opts }
}

// argv-based exec seam — never a shell string, because plan paths and branch
// names ride these calls. Resolves, never rejects; callers branch on code.
// timeoutMs (#436): opt-in per call. execFile kills the child on expiry and
// reports `error.killed`, which is otherwise indistinguishable from a plain
// non-zero exit — so a timed-out command returns `timedOut: true` and a
// diagnostic on stderr, and the caller can say WHY it failed instead of
// reporting a wedged suite as a test failure. Omitted = unbounded, which is
// still right for the short git verbs.
export const execSeam = (cmd, argv, { cwd, env, timeoutMs } = {}) =>
  new Promise((resolve) => {
    execFile(cmd, argv, {
      cwd,
      env: env || process.env,
      maxBuffer: 1024 * 1024 * 64,
      ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {}),
    }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && error.killed && timeoutMs)
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '') + (timedOut
          ? `\n[execSeam] killed after ${Math.round(timeoutMs / 1000)}s timeout (#436)`
          : ''),
        timedOut,
      })
    })
  })

// ── tier fill (the last LLM judgment, made deterministic) ────────────────────
// SKILL.md step 2 had the orchestrator judge each null tier "by scope and
// judgment-likelihood". The driver stamps ONE tier across the run — default
// mostCapable, the standing quality-over-tokens posture — and records the
// fill. This is deliberately cruder than the LLM's per-task judgment and
// deliberately honest about it: per-task tier is the intent document's slot
// (#243 — signed, not judged). #390 landed 2026-09-01: the signed slot is now
// the producer wherever the intent doc carries one; the uniform stamp remains
// the honest fallback for plans that do not. `review` is plan-authored
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
// runtime or external (ack.type is "deferred:<reason>", gate_check.py:134) —
// or a `deferred:manual` ack the driver's own executed evidence already
// settles (#753, below). Anything else — coverage acks, deferred:plan-defect,
// unknown types — leaves the gate receipt as the terminal artifact.
// Pre-authorized by the #243 grilling (manual acks pre-authorized, parks → 0)
// for exactly this closed list, widened by #753's one mechanical case.
//
// The acks live at `gateCheck.acks`: gate_check.py emits {verdict,checks,acks}
// and ultra_gate.py embeds that whole object one level down under `gateCheck`
// (ultra_gate.py:107). Reading a flat `receipt.acks` — which the script never
// writes — would see [] on EVERY run and approve unconditionally, the exact
// park-path bypass this function exists to prevent. `acksOf` is the one reader.
export const acksOf = (gateReceipt) =>
  (gateReceipt && gateReceipt.gateCheck && gateReceipt.gateCheck.acks) || []

// A `deferred:manual` ack is pre-authorized when the deferral's `why` cites, in
// the ack's frozen `detail` (`deliverable — why`, gate_check.py:132-140), a
// command the driver itself re-ran on the adopted tree and that exited 0
// (#753). `report.integratedRuns` is that execution record — `{ task, cmd,
// exit, stdout }` — so the citation test is a verbatim substring of an executed
// command. A detail that also names a RED command is not pre-authorized however
// many green ones it cites: the settled part of the item is the green evidence,
// and a red run is the opposite of settling. Citing is the deferring party's
// act, verifying is the driver's; a paraphrase is not a citation and parks,
// which is the safe failure. `report` defaults to `{}` — with no report nothing
// is cited. Since #964 Task 2 the run's only deferrals are the plan defects the
// engine defers itself (`deferred:plan-defect`, which this never pre-authorizes)
// — the manual lane stays for the receipts of runs that still carry one.
export function ackDecision(gateReceipt, report = {}) {
  const acks = acksOf(gateReceipt)
  const runs = (report && Array.isArray(report.integratedRuns)) ? report.integratedRuns : []
  const cmdsWithExit = (ok) => runs
    .filter((r) => r && typeof r.cmd === 'string' && r.cmd !== '' && (ok ? r.exit === 0 : r.exit !== 0))
    .map((r) => r.cmd)
  const green = cmdsWithExit(true)
  const red = cmdsWithExit(false)
  const citesExecutedGreen = (a) => a.type === 'deferred:manual' &&
    typeof a.detail === 'string' &&
    green.some((cmd) => a.detail.includes(cmd)) &&
    !red.some((cmd) => a.detail.includes(cmd))

  const citing = acks.filter(citesExecutedGreen)
  const bad = acks.filter((a) =>
    a.type !== 'deferred:runtime' && a.type !== 'deferred:external' && !citesExecutedGreen(a))
  if (bad.length) {
    return { approve: false, reason: 'non-pre-authorized ack(s): ' + bad.map((a) => a.type).join(', ') }
  }
  if (citing.length) {
    return {
      approve: true,
      reason: citing.length + ' deferred manual ack(s) citing green integrated Run: evidence — ' +
        'pre-authorized (#753); ' + (acks.length - citing.length) +
        ' deferred runtime/external ack(s) — pre-authorized (#243)',
    }
  }
  return { approve: true, reason: acks.length + ' deferred runtime/external ack(s) — pre-authorized (#243)' }
}

// ── the completeness brake (#474) ────────────────────────────────────────────
// A blocking completeness finding refuses the run before it can be approved.
// The check sits OUTSIDE the `gate.code === 2` branch on purpose: run-26 is the
// run that proves a clean `PASS` can carry unrouted findings, so the clean path
// is exactly the one that needs the brake. A bare-string finding is pre-#474
// evidence — the judge that wrote it had no way to say "blocking" — so it
// never blocks; runs 1–32 wrote strings and are still read.
// Since #964 Task 2 the findings this reads are the DRIVER's own — the red
// integrated `Check:`s of the run — and the name stays because the report key,
// the gate, the card and the viz projection all spell it this way.
export function criticDecision(report) {
  const findings = (report && report.completenessFindings) || []
  const blocking = findings.filter((f) => f && typeof f === 'object' && f.severity === 'blocking')
  if (blocking.length) {
    return {
      approve: false,
      reason: blocking.length + ' blocking completeness finding(s): ' +
        blocking.map((f) => f.detail).join('; '),
      blocking,
    }
  }
  return { approve: true, reason: findings.length + ' completeness finding(s), none blocking', blocking: [] }
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
  resolver:
    'You are running headless inside a disposable fleet sandbox; no operator is present.\n',
  critic:
    'You are running headless inside a disposable fleet sandbox; no operator is present.\n',
  // #553: same working tree as the implementer, a different job in it. The
  // preamble says the tree and nothing about making anything pass.
  examiner:
    'You are running headless inside a disposable fleet sandbox; no operator is present. ' +
    'Your working directory is the task\'s own working tree at BASE.\n',
}

export function writeRoleFiles(destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const files = {}
  for (const [role, text] of Object.entries(ROLE_PROMPTS)) {
    const p = path.join(destDir, role + '.md')
    fs.writeFileSync(p, text)
    files[role] = p
  }
  return (role) => files[role]
}

// ── the engine's judgment prompts, recorded in the run tree ──────────────────
// `fleet/roles/*.md` are the OTHER kind of role file: the prompts run-engine
// hands a model when it asks for a judgment (loadRoles, from run-engine's own
// location — Amendment 10). They are the engine's, so they are read from
// ENGINE_DIR and never from `--repo`; a target repository has no `fleet/` and
// is never asked for one. Copying them beside the transcripts makes the run
// directory a complete record: the evidence bundle is ONE tree, and what a
// worker was asked is half of what it did.
export function copyEngineRoles(destDir, sourceDir = path.join(ENGINE_DIR, 'fleet/roles')) {
  fs.mkdirSync(destDir, { recursive: true })
  const copied = []
  for (const name of fs.readdirSync(sourceDir).sort()) {
    const from = path.join(sourceDir, name)
    if (!fs.statSync(from).isFile()) continue
    fs.copyFileSync(from, path.join(destDir, name))
    copied.push(name)
  }
  return copied
}

// ── the PreToolUse settings (spec §4, #402 item 5) ───────────────────────────
// One settings file, handed to the three bypass-mode write roles only: the hook
// derives its writable roots from the worker's own cwd (always the right
// clone, by makeCwdFor) plus $FLEET_RUN_DIR, so nothing per-task is generated
// and nothing can point at the wrong tree. The allowlist roles get no
// settings — for them the allowlist is the boundary (parity R-w3), and a
// second mechanism would be a second thing to verify.
//
// #810: with a kata record the same file also carries the attention hooks —
// `kata attention-hook start` at SessionStart and `kata attention-hook end` at
// SessionEnd, so a write worker's issue is stamped with its start and its end
// without the worker remembering to do it. Only the three write roles get the
// file, so only they are stamped; a session whose env carries no `KATA_REF`
// (`integration`, the critic) runs the hook and it exits 0 doing nothing, which
// is kata's own documented behaviour. The PreToolUse entry is untouched: the
// confine boundary is what it was, and without a record the file is byte for
// byte the one BASE wrote.
export function writeConfineSettings({ runDir, hookPath, kataOn = false }) {
  const settingsPath = path.join(runDir, 'confine-settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
        hooks: [{ type: 'command', command: 'node ' + hookPath }],
      }],
      ...(kataOn ? {
        SessionStart: [{ hooks: [{ type: 'command', command: 'kata attention-hook start' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'kata attention-hook end' }] }],
      } : {}),
    },
  }, null, 2))
  return (role) => (role === 'implementer' || role === 'writeSide' || role === 'examiner')
    ? settingsPath : undefined
}

// ── what a worker knows about the hub (#810 Phase A) ─────────────────────────
// The literal placeholder, and the only `KATA_AUTH_TOKEN` any worker ever sees:
// the sandbox reaches the hub through the exe.dev edge, which replaces the
// `Authorization` header with the real bearer on the way out. No real token is
// written anywhere under `fleet/`, and this one buys nothing off the VM.
export const KATA_WORKER_TOKEN = 'edge-injects-the-bearer'
// The hub, when the record does not name one. The record's own `url` is what
// the engine's client is built on, so a worker pointed anywhere else would be
// reading a different run.
export const KATA_SERVER_FALLBACK = 'https://kata.int.exe.xyz'

/** The issue a worker label holds, `<project name>#<short_id>`, or null when
 *  the label names no task the record knows, when that task's short id has not
 *  been read yet (its dispatch has not happened), or when the record names no
 *  project. The label→task rule is `kataUidFor`'s (#943): the second
 *  colon-segment, so `impl:3`, `exam:3`, `fix:3:0` and `review:3:1:2` are all
 *  task 3 while `integration` and `reconcile:wave1:1` are the run's. */
export function kataRefFor(record, label) {
  if (!record || typeof record !== 'object') return null
  const rows = (record.tasks && typeof record.tasks === 'object') ? record.tasks : {}
  const id = String(label || '').split(':')[1]
  if (!id || !Object.prototype.hasOwnProperty.call(rows, id)) return null
  const row = rows[id]
  if (!row || typeof row !== 'object') return null
  const shortId = row.shortId || row.short_id
  const project = (record.project && typeof record.project === 'object')
    ? record.project.name : null
  if (typeof shortId !== 'string' || !shortId || typeof project !== 'string' || !project) return null
  return project + '#' + shortId
}

// ── --add-dir scope, per role (measured 2026-08-31) ──────────────────────────
// A read-only worker's cwd is `<runDir>/clones/integration`, but the two things
// its prompt tells it to read — `wavesPath` (launch.json, where compile_plan
// puts every task body by design) and `patches/` — live in `<runDir>`, a
// PARENT. Under `dontAsk`, read-only Bash is permitted as a class but only IN
// SCOPE, so those reads were denied: five consecutive runs of `cannotVerify`
// entries that became deferred acks and parked the run. `--add-dir` is what
// puts a parent in scope, and it reaches Bash, not just the file tools
// (probe_addcwd_scope.mjs arms B and C).
//
// SCOPED, NOT BLANKET. The write-side roles get NOTHING: `bypassPermissions`
// does not path-gate at all (arm F), so they can already read what they need,
// and granting read reach they do not need is exposure for no gain. Their
// boundary is the confine hook, unchanged.
//
// The residual, stated rather than hidden: `<runDir>` also contains `clones/`,
// so a read-only role CAN read a sibling's tree. It cannot write one (the
// allowlist closes writes), so this is a confidentiality widening, not an
// integrity one — but it does soften "each reviewer saw one diff in isolation".
// Closing it properly means giving the reviewer a per-task subset of the launch
// file in its own cwd, which is new machinery; filed rather than smuggled in.
export const makeAddDirsFor = ({ runDir }) => (opts, role) =>
  (role === 'reviewer' || role === 'resolver')
    ? [runDir]
    : []

// ── agent composition — the one decision, both halves ────────────────────────
export function composeAgent({ runId, base, runDir, clonesDir, patchesDir, workersDir,
                               promptFileFor, settingsFor, env, cli, eventLog, spawnFn,
                               implementerEffort, filesFor, envFor }) {
  // One knob, one role. `roleForLabel` maps both `impl:` and `fix:` to
  // `implementer`; every other role answers undefined, so `buildArgs` pushes no
  // `--effort` for it and each judge keeps the CLI's own default (#522).
  const effortFor = implementerEffort
    ? (role) => (role === 'implementer' ? implementerEffort : undefined)
    : undefined
  // #810: the kata variables of THIS worker, merged over the run-wide env on
  // the way to its child process. They are applied HERE, in the composition,
  // and not inside `createRunWorker`: that module holds each role's writable
  // root and the confine boundary, and it stays exactly what it is.
  //
  // The unit is the DISPATCH, so the overlay travels with it — an async-local
  // store opened around each `agent(...)` call and read by the spawn that call
  // reaches. That is what makes it correct with several workers in flight at
  // once (`boundedParallel`): a latched "current label" would hand one wave's
  // author to another wave's child. Merged LAST, so a per-worker value wins
  // over a run-wide one the driver inherited; with no `envFor`, or with an
  // empty answer, the spawn is the one it was.
  const kataEnv = new AsyncLocalStorage()
  const baseSpawn = spawnFn || spawn
  const spawnWithKata = (cmd, argv, options) => {
    const overlay = kataEnv.getStore()
    if (!overlay || !Object.keys(overlay).length) return baseSpawn(cmd, argv, options)
    return baseSpawn(cmd, argv, {
      ...options, env: { ...(options && options.env), ...overlay },
    })
  }
  const inner = createRunWorker({
    runId,
    workersDir,
    cwdFor: makeCwdFor({ clonesDir }),
    addDirsFor: makeAddDirsFor({ runDir }),
    promptFileFor,
    settingsFor,
    env,
    cli,
    timeoutMsFor: (role) => ROLE_TIMEOUT_MS[role],
    ...(effortFor ? { effortFor } : {}),
    onEvent: eventLog.onEvent,
    ...(spawnFn || envFor ? { spawnFn: spawnWithKata } : {}),
  })
  const captured = withPatchCapture({
    agent: inner, clonesDir, base, patchesDir,
    taskIdOf: defaultTaskIdOf, onEvent: eventLog.onEvent,
    // #714: the task's Files, by label. The capture drops an untracked binary
    // no task named rather than folding a `__pycache__` four clones wrote at
    // once; without a lookup it falls back to the `FILES:` line of the prompt
    // the worker was handed, which is the same compiled array.
    ...(filesFor ? { filesFor } : {}),
  })
  // `envFor` is read at dispatch, not here: the short id of a task's issue
  // lands on the kata record at that task's own dispatch (run-engine.mjs),
  // which is long after this wrapper is built.
  const agent = envFor
    ? (prompt, opts = {}) => kataEnv.run(envFor(opts) || {}, () => captured(prompt, opts))
    : captured
  // The flag's value IS the trust anchor: waves.js strips any reply patch
  // outside this prefix, so a launch template carrying `patchInput: true`
  // with no driver behind it anchors nothing and a model-typed path outside
  // the driver's directory is inert.
  return { agent, patchInput: patchesDir }
}

// Bounded parallel: at most `limit` thunks in flight. Rejection semantics match
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
  // run-main's own comment chain to the hub (subscribed to the event log at
  // step 1b below): every return path — an approval, a refusal, a crash —
  // waits for the posts it queued, so the run issue holds the last stage
  // before the process ends.
  const hub = makeHubChain()
  try {
    return await runMainInner(parsed, deps, hub)
  } finally {
    await hub.drain()
  }
}

// One sequential promise chain: a push starts the moment the post before it
// has answered, never two in flight, push order = post order. The engine keeps
// the same shape for its own lines (run-engine.mjs `kataPost`); this one is
// run-main's, for the `driver:` lines it appends around the engine — the
// stages, the credential, the critic and ack decisions, the approval — which
// never reached the hub before run-112 (2026-09-12).
export const makeHubChain = () => {
  let chain = Promise.resolve()
  return {
    push: (thunk) => { chain = chain.then(thunk).catch(() => { /* recorded by the thunk */ }) },
    drain: async () => {
      let head
      do { head = chain; await head } while (head !== chain)
    },
  }
}

async function runMainInner(parsed, deps, hub) {
  const {
    exec = execSeam,
    runEngineFn = runEngine,
    makeAgent = composeAgent,
    log = console.error,
    env = process.env,
    // The hub client, from the record: a sim hands in a fake and no request
    // leaves the box; production builds `httpTransport` on the record's url.
    kataClientFor = (record, id) => makeKataClient({
      transport: httpTransport({ url: record.url }),
      actor: 'engine:' + id,
    }),
  } = deps
  const { planPath, runId, tier, implementerEffort, testCmd, bootstrapCmd, cli,
          kata: kataPath } = parsed
  // Absolute, always: patchesDir is derived from repoDir, and waves.js's
  // PATCH_PREFIX second wall arms only for an absolute patchInput — a relative
  // --repo would silently disarm it, leaving only withPatchCapture's reply
  // strip (review finding 4). Resolve here so the invariant is unconditional.
  const repoDir = path.resolve(parsed.repoDir)
  const stamp = runId
  const py = 'python3'
  const scripts = path.join(ENGINE_DIR, 'skills/ultrapowers/scripts')
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
  // Forwarded whenever it was GIVEN, the empty string included: the one
  // derivation lives in ultra_run.py (derive_bootstrap_cmd — the lockfile-
  // implied install, run-66), where an unset knob derives and `''` disables.
  // Dropping a falsy `''` here would turn the operator's "no bootstrap" into
  // "derive one".
  if (bootstrapCmd !== null && bootstrapCmd !== undefined) runArgv.push('--bootstrap-cmd', bootstrapCmd)
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

  // 1b. The run's kata record, read BEFORE anything is provisioned — and before
  // the first stage the log records, so the hub's view of the run starts where
  // the record's does. The file is the launcher's own (`.ultrapowers/kata.json`
  // in the plan commit, landed beside the plan by the boot script): the hub's
  // url, the project, the run issue and one entry per task. A run told to keep
  // state on the hub and unable to read what that state IS has nothing to
  // reconcile against, so an unreadable or malformed file ends it here —
  // before a clone exists, before a worker is dispatched, and with the receipt
  // naming why.
  let kataRecord = null
  let kata = null
  if (kataPath) {
    try {
      kataRecord = JSON.parse(fs.readFileSync(kataPath, 'utf8'))
    } catch (e) {
      return fail('kata-unreadable', 'could not read --kata ' + kataPath + ': ' +
        String((e && e.message) || e))
    }
    if (!kataRecord || typeof kataRecord !== 'object' || Array.isArray(kataRecord)) {
      return fail('kata-unreadable', '--kata ' + kataPath + ' is not a JSON object')
    }
    // No token, ever: the sandbox reaches the hub through the exe.dev edge,
    // which injects the bearer. The actor names the run, so every mutation on
    // the hub is attributable to the engine that made it.
    kata = kataClientFor(kataRecord, runId)
    // run-main's mirror: each `driver:` line this log appends from here on is
    // a comment on the run issue, through the same non-fatal rule as the
    // engine's — a refused post is one `kata:write-failed` event, never a
    // failure. Only `driver:` lines: the engine appends its own straight to
    // the file (never through this log) and mirrors them itself, and the
    // worker envelopes and phase marks are the engine's to route (its
    // `eventLog` subscription, run-engine.mjs `kataUidFor`), so no line is
    // posted twice. Subscribed before the `kata` stage so that stage is the
    // first line on the hub.
    const runUid = (kataRecord.run || {}).uid
    const projectId = (kataRecord.project || {}).id
    if (runUid && projectId != null) {
      eventLog.subscribe((e, line) => {
        if (!String((e && e.kind) || '').startsWith('driver:')) return
        hub.push(async () => {
          try {
            await kata.comment(projectId, runUid, line)
          } catch (err) {
            eventLog.onEvent({ kind: 'kata:write-failed', what: 'comment', uid: runUid,
              detail: String((err && err.message) || err).slice(0, 600) })
          }
        })
      })
    }
    stage('kata', 'record ' + kataPath + ' → ' + String(kataRecord.url))
  }

  // 2. Fill tiers, write back, validate.
  const filled = fillTiers(argsObj, tier)
  fs.writeFileSync(argsFilePath, JSON.stringify(argsObj, null, 2))
  stage('tiers', filled + ' null tier slot(s) stamped ' + tier + ' (uniform driver fill; per-task tier is the intent document\'s slot, #243)')
  // `--no-baseline`: the driver asks the knob check for the knobs alone and
  // runs no suite command of its own before the engine. The red-BASE reading
  // is the engine's lazy baseline (fleet/run-engine.mjs, the `baseline:`
  // judgment call, run only when a wave's candidate suite is red, #712).
  const vk = await exec(py,
    [path.join(scripts, 'ultra_run.py'), '--validate-knobs', argsFilePath, '--no-baseline'],
    { cwd: repoDir, env: pyEnv })
  if (vk.code !== 0) {
    // A knob defect only: with --no-baseline the verb never runs the suite, so
    // every non-zero exit here is the plan's own knobs failing validation.
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
  // Two different files per role, kept in two directories so neither can be
  // mistaken for the other: `preambles/` holds the neutral orientation text
  // appended to a worker's system prompt, `roles/` holds the engine's own
  // judgment prompts verbatim. Both come from ENGINE_DIR; so does the hook.
  const promptFileFor = writeRoleFiles(path.join(runDir, 'preambles'))
  copyEngineRoles(path.join(runDir, 'roles'))
  const settingsFor = writeConfineSettings({
    runDir, hookPath: path.join(ENGINE_DIR, 'fleet/confine-hook.mjs'),
    kataOn: Boolean(kataRecord),
  })

  // 4. The engine. CLAUDE_CONFIG_DIR points into the run tree (spec §5) so
  // every transcript is evidence; the credential rides the inherited env
  // (CLAUDE_CODE_OAUTH_TOKEN from the shim's per-run env file) untouched.
  // DISABLE_AUTOUPDATER: headless `-p` sessions check for updates too (docs:
  // "on startup and periodically"), and #382 measured that the shared cache
  // prefix is keyed on CLI version — a mid-wave version roll costs every later
  // worker ~18k tokens. CLI versions move only through fleet/update-cli.sh,
  // where the parity probes run at the moment of change.
  const workerEnv = { ...env, CLAUDE_CONFIG_DIR: tree.configDir, FLEET_RUN_DIR: runDir,
                      DISABLE_AUTOUPDATER: '1' }
  // The live patch base: wave 1 captures against BASE; runEngine advances
  // `current` to each adopted integration head so later waves diff against
  // the tree they actually built on (see run-engine.mjs patchBase).
  const patchBase = { current: base }
  // #714: the compiled `files` array of each task, by task id — the SAME array
  // the engine builds its `FILES:` line from, so the scope the implementer was
  // told to stay inside and the scope the capture keeps are one fact. Built
  // here because the wrapper is built once, before the engine runs, and a
  // second parse of the plan would be a second fact.
  // …and the TASK OBJECTS, not a Map of their arrays: the engine receives these
  // very objects as `args.waves`, and with a kata record it replaces a task's
  // `files` with the hub's own `factsheet.files` at the start of that task's
  // pipeline. A Map built here would have frozen the compiled array before the
  // sheet arrived, so the scope the implementer is told to stay inside and the
  // scope the capture keeps would be two different facts again. Read at CALL
  // time, sheet first.
  const tasksById = new Map(argsObj.waves.flat().map((t) => [t.id, t]))
  const filesFor = (opts) => {
    const task = tasksById.get(defaultTaskIdOf(opts && opts.label))
    if (!task) return []
    const sheet = task.factsheet
    if (sheet && Array.isArray(sheet.files)) return sheet.files
    return Array.isArray(task.files) ? task.files : []
  }
  // #810: the kata variables ONE worker carries, by its label — the same seam
  // shape as `filesFor`, and read at CALL time for the same reason: the short id
  // of a task's issue lands on the record's row at that task's dispatch
  // (run-engine.mjs), which is after this wrapper is built.
  //
  // A worker is an actor on the hub, so it is told who it is (`KATA_AUTHOR`, the
  // label the engine spells its events with) and which issue it is working
  // (`KATA_REF`, project-qualified so the CLI resolves it with no workspace
  // binding). The task is its label's second colon-segment — `kataUidFor`'s rule
  // (#943), which is why `review:3:1:2` holds task 3's issue; `integration` and
  // `reconcile:*` name no task the record knows, so they carry no `KATA_REF` and
  // their attention hooks exit 0 doing nothing.
  //
  // NO TOKEN, EVER. The placeholder is the whole of what a worker holds: the
  // request leaves through the exe.dev edge, which replaces the `Authorization`
  // header with the real bearer, so the string below is worth nothing outside
  // the fleet (measured 2026-09-13). Without a record none of the four is set.
  const envFor = (opts) => {
    if (!kataRecord) return {}
    const label = String((opts && opts.label) || '')
    const out = {
      KATA_SERVER: (typeof kataRecord.url === 'string' && kataRecord.url)
        ? kataRecord.url : KATA_SERVER_FALLBACK,
      KATA_AUTH_TOKEN: KATA_WORKER_TOKEN,
      KATA_AUTHOR: label + '@run-' + String(runId).replace(/^run-/, ''),
    }
    const ref = kataRefFor(kataRecord, label)
    if (ref) out.KATA_REF = ref
    return out
  }
  const { agent, patchInput } = makeAgent({
    runId, base: () => patchBase.current, runDir,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor, settingsFor, env: workerEnv, cli, eventLog, implementerEffort,
    filesFor, envFor,
  })
  // #213 credential evidence (restored after the cutover deleted the shim's
  // copy — review finding 6): name the credential the workers will ride, in
  // the run's own event log. Best-effort; an unreadable status never blocks.
  const auth = await exec(cli, ['auth', 'status'], { env: workerEnv })
  try {
    const parsed = JSON.parse(auth.stdout)
    eventLog.onEvent({ kind: 'driver:auth', authMethod: parsed.authMethod ?? null,
      apiKeySource: parsed.apiKeySource ?? null, subscriptionType: parsed.subscriptionType ?? null })
  } catch {
    eventLog.onEvent({ kind: 'driver:auth', detail: 'auth status unreadable (exit ' + auth.code + ')' })
  }

  const integrationBranch = 'ultra/integration-' + stamp
  const launchArgs = {
    ...argsObj,
    // The dispatch width, derived here because nothing carries the launcher's
    // down: `args.json` has `waves` and no `width` (see `widestWaveOf`).
    width: widestWaveOf(argsObj),
    integrationBranch,
    stamp,
    baseBranch,
    patchInput,
  }
  stage('engine', 'waves ' + argsObj.waves.map((w) => w.length).join('/') +
    ', width bound ' + widthOf(launchArgs) + ', patch input armed')
  let report
  try {
    // Amendment 10: the native engine (fleet/run-engine.mjs) — every git verb
    // and kernel invocation is driver code through `exec`; agents are
    // dispatched only for judgments. waves.js was deleted at 0.3.0 (PR #434).
    report = await runEngineFn({
      // #436: the engine caps the implementers' suite parallelism by the
      // number of them that share the machine — it must be told the real one.
      // The kata pair travels together or not at all: the client is the seam,
      // the record is which project and which issue each task is.
      args: { ...launchArgs, width: widthOf(launchArgs), ...(kata ? { kataRecord } : {}) },
      ...(kata ? { kata } : {}),
      agent,
      parallel: boundedParallel(widthOf(launchArgs)),
      exec,
      paths: { repoDir, runDir, clonesDir: tree.clonesDir },
      log: eventLog.log,
      phase: eventLog.phase,
      // The log itself, for the envelopes the engine mirrors but never writes.
      eventLog,
      patchBase,
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
  // The completeness brake, BEFORE the ack branch and on the PASS path alike:
  // it governs both surviving gate paths, and its precedence over the ack path
  // is deliberate. #243 pre-authorizes "the sandbox could not execute this"; it
  // was never a licence to merge a named defect. The report is read from
  // resultPath — the gate receipt does not carry the field.
  // One read, two readers: the critic brake reads `completenessFindings` and
  // the ack decision reads `integratedRuns` off the same report object.
  const resultReport = readJson(resultPath)
  const critic = criticDecision(resultReport)
  eventLog.onEvent({ kind: 'driver:critic-decision', approve: critic.approve, reason: critic.reason })
  if (!critic.approve) {
    let gateVerdict = gate.code === 0 ? 'PASS' : 'NEEDS_ACK'
    try {
      gateVerdict = readJson(path.join(runDir, 'gate-receipt.json')).verdict ?? gateVerdict
    } catch { /* the receipt is the gate's record, not this refusal's authority */ }
    fs.writeFileSync(path.join(runDir, 'critic-block.json'), JSON.stringify({
      stamp, integrationBranch, gateVerdict, blocking: critic.blocking,
    }, null, 2))
    return fail('critic-blocking', critic.reason + ' — critic-block.json is the terminal artifact')
  }

  if (gate.code === 2) {
    const gr = readJson(path.join(runDir, 'gate-receipt.json'))
    const decision = ackDecision(gr, resultReport)
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
