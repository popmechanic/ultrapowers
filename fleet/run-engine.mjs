// fleet/run-engine.mjs — the wave control flow as driver code (#366 Amendment 10).
//
// This module replaces loading `skills/ultrapowers/harnesses/waves.js` on the
// fleet path. The rule it implements: MODELS NEVER RUN GIT; DRIVERS NEVER MAKE
// JUDGMENTS. Every git verb, kernel-CLI invocation, path and sequence here is
// ordinary code run through the injected `exec`; a model is dispatched only to
// make a judgment — implement, review, fix, resolve, reconcile, attest — with
// the driver handing content in and capturing content out.
//
// waves.js is NOT edited and remains the Workflow-path fallback until cutover;
// the judgment-flow semantics here (single retry with tier escalation on a
// schema trip, the infra-death barrier retry, the fix-loop cap of 2, the
// fail-closed lost-coordinates sweep, dependency cascade-blocking) are ported
// from it verbatim in behavior. The choreography it dispatched agents for —
// setup, fold/resolve-apply/materialize, adoption, the critic's detach — is
// driver code below. The ordinary git-merge path is DELETED, not ported: under
// patch input waves.js itself routed every wave to the kernel unconditionally
// (waves.js:1851), so the path was unreachable — a disclosed narrowing of
// Amendment 10, licensed by Amendment 9 (fold is the only merge path).
//
// The report object returned matches references/report-format.md field for
// field: the frozen periphery (finalize_report.py, ultra_gate.py) runs
// unchanged against it. Producers that moved from agents to the driver are
// noted at the assembly at the bottom.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── model tiers (waves.js parity) ────────────────────────────────────────────
export const TIER = { standard: 'sonnet', mostCapable: 'opus' }
export const REVIEWER_MODEL = TIER.mostCapable
const tierKey = (t) => (t === 'most-capable' ? 'mostCapable' : t)
const TIER_LADDER = ['standard', 'mostCapable']
export const escalateTier = (t) => {
  const i = TIER_LADDER.indexOf(tierKey(t))
  if (i === -1) return 'mostCapable'
  return TIER_LADDER[Math.min(i + 1, TIER_LADDER.length - 1)]
}
const resolvedModel = (name) => {
  const v = Object.prototype.hasOwnProperty.call(TIER, tierKey(name)) ? TIER[tierKey(name)] : undefined
  return (typeof v === 'string') ? v : TIER.standard
}

// ── fault classifiers — THE ONE SHARED DEFINITION (spec §3.4) ────────────────
// run-worker.mjs's classify() speaks this vocabulary in its thrown messages;
// fleet/tests/test_run_worker.mjs pins classify's wording against THIS regex
// (it used to extract it from waves.js source — the pin now holds the engine
// that actually runs, not the fallback). A capability-fixable schema trip gets
// the one tier escalation; everything else retries in place; AGENT_NULL is the
// engine-minted infra marker and parks for the barrier retry — never free-text
// match Overloaded (agent() returns null rather than throwing overload text).
export const isSchemaTrip = (msg) =>
  /schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i.test(msg)
export const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
export const isInfraFault = (msg) => String(msg).startsWith('AGENT_NULL')

// Same chunking constant as waves.js: intra-wave dependency re-checks and the
// lost-coordinates sweep run at chunk boundaries, so the value is part of the
// ported semantics (the actual process-level width bound is the caller's
// `parallel`, run-main's boundedParallel(WIDTH)).
export const CONCURRENCY = 16

// ── judgment schemas ─────────────────────────────────────────────────────────
// IMPLEMENTER: branch/headSha are gone from the model's contract — the driver
// derives both (withPatchCapture). startHead is KEPT one more run: the #314
// guard's deletion waits for the measured license its own comment demands
// (run-waves.mjs:107-112), not this rewrite.
export const IMPLEMENTER_SCHEMA = {
  type: 'object',
  required: ['status', 'summary', 'startHead'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    startHead: { type: 'string' },
  },
}
// One severity vocabulary for the whole run (#474): the per-task reviewer and
// the completeness critic grade defects on the same two-word scale, and the
// pair is spelled here exactly once. Both schemas point at THIS array.
export const SEVERITY = Object.freeze(['blocking', 'minor'])
export const REVIEWER_SCHEMA = {
  type: 'object',
  required: ['verdict', 'issues'],
  properties: {
    verdict: { enum: ['PASS', 'FIX_REQUIRED'] },
    issues: { type: 'array', items: { type: 'object',
      required: ['severity', 'detail'], properties: {
        severity: { enum: SEVERITY },
        detail: { type: 'string' } } } },
    cannotVerify: { type: 'array', items: { type: 'object',
      required: ['requirement', 'why'], properties: {
        requirement: { type: 'string' }, why: { type: 'string' } } } },
  },
}
// RESOLVER: content OUT through the schema — the driver writes the kernel's
// reply directory itself (h<n>.txt per hunk + notes.txt, the grammar
// unchanged), so the resolver role is READ-ONLY and the write-side role family
// shrinks to the reconcile agent alone (spec §2). An outsized hunk that
// strains a structured reply surfaces as a failed resolution (the kernel's
// grammar check rejects a short reply), never a silent truncation.
export const RESOLVER_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['RESOLVED', 'BLOCKED'] },
    // `id` is the hunk header's own id verbatim ("h1", "h2", …) — the reply
    // file the driver writes is `<id>.txt`, exactly the grammar's name.
    hunks: { type: 'array', items: { type: 'object',
      required: ['id', 'content'], properties: {
        id: { type: 'string' }, content: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}
export const RECONCILE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['FIXED', 'BLOCKED'] },
    summary: { type: 'string' },
  },
}
// CRITIC: read-only judgment. testsPassed / onIntegrationHead / ancestryMisses
// are gone from the model's contract — the driver runs the suite and derives
// gitVerified and the ancestry check from its own receipts (spec §3.1).
export const CRITIC_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: { type: 'object',
      required: ['severity', 'detail'], properties: {
        severity: { enum: SEVERITY },
        detail: { type: 'string' } } } },
    deferredVerification: { type: 'array', items: { type: 'object',
      required: ['deliverable', 'reason'], properties: {
        deliverable: { type: 'string' },
        reason: { type: 'string', enum: ['browser', 'runtime', 'external', 'manual'] },
        why: { type: 'string' } } } },
  },
}

// ── role prompt files (spec §4: one copy, nothing to bake) ───────────────────
export const defaultRolesDir = () => fileURLToPath(new URL('./roles', import.meta.url))
export function loadRoles(rolesDir = defaultRolesDir()) {
  const roles = {}
  for (const name of ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']) {
    roles[name] = fs.readFileSync(path.join(rolesDir, name + '.md'), 'utf8')
  }
  return roles
}

// ── prompt input lines (waves.js parity — same vocabulary, plans unchanged) ──
//
// capWorkerParallelism (#436): the driver's own suite runs are serialized —
// one integration clone, one at a time — so `-n auto` is right for them. The
// implementers are not: up to WIDTH of them run concurrently, each in its own
// clone, each running the suite through its red/green/clean cycle. `-n auto`
// sizes to the whole machine per invocation, so WIDTH=8 on an 8-vCPU sandbox
// peaks around 64 pytest processes plus the workers themselves — thrash, or
// an OOM-killed xdist worker reported as a spurious red. Divide the machine
// among the workers that share it instead. Untouched when the plan pinned an
// explicit -n, and a no-op for every non-pytest stack.
export const capWorkerParallelism = (cmd, width, cpus) => {
  if (typeof cmd !== 'string' || !/-n\s+auto\b/.test(cmd)) return cmd
  const share = Math.max(1, Math.floor((cpus || 1) / Math.max(1, width)))
  return cmd.replace(/-n\s+auto\b/, share === 1 ? '-p no:xdist' : '-n ' + share)
}

const testCmdLine = (task, testCmd) => {
  const cmd = (task && typeof task.testCmd === 'string' && task.testCmd.trim()) || testCmd
  return cmd ? ('\nTEST COMMAND: ' + cmd) : ''
}
const filesLine = (task) => (Array.isArray(task.files) && task.files.length)
  ? ('\nFILES: ' + task.files.join(', ')) : ''
const interfacesLine = (task) => {
  const i = task && task.interfaces
  if (!i || typeof i !== 'object') return ''
  const consumes = Array.isArray(i.consumes) ? i.consumes : []
  const produces = Array.isArray(i.produces) ? i.produces : []
  if (consumes.length === 0 && produces.length === 0) return ''
  return '\nINTERFACES:' +
    (consumes.length ? ('\nConsumes: ' + consumes.join(', ')) : '') +
    (produces.length ? ('\nProduces: ' + produces.join(', ')) : '')
}
// #458: the driver runs the suite on the folded tree and the critic was never
// told. A read-only critic cannot run it — running a PROGRAM is not classified
// read-only, measured 2026-08-31 (#457) — so it establishes pass/fail by static
// trace and then defers it as `deferred:runtime`. That deferral is manufactured:
// the answer already exists in `lastSuite`. Naming the driver's run authoritative
// is what the contend cell's critic explicitly asked for. Exported for the unit
// pin on the red branch (as capWorkerParallelism is) — the engine only ever
// adopts a green tree, so no live run reaches it.
// Composition pinning, as a pure function (exported for the unit pin).
// Per-task exclusion, never a wave-wide skip (review finding 10): one task
// missing `writes` must not silence a genuine undeclared double-write between
// two tasks that DID declare theirs.
// Claims-v1 retirement (#390): `Commutes:` is no longer authorable, so when no
// task in the wave declares one, an undeclared shared write is not a pinning
// failure — it is the shipped fold default. The check only means something
// while the declaration it audits can exist.
export const compositionUnpinnedRows = (waveNumber, tasks) => {
  const rows = []
  if (!tasks.some((t) => Array.isArray(t.commutes) && t.commutes.length)) return rows
  const declaring = tasks.filter((t) => Array.isArray(t.writes))
  for (const t of tasks) {
    if (!Array.isArray(t.writes)) {
      rows.push('wave ' + waveNumber + ': task ' + t.id +
        ' carries no writes field — excluded from composition rows')
    }
  }
  if (declaring.length < 2) return rows
  const writers = new Map()
  for (const t of declaring) for (const p of t.writes) writers.set(p, (writers.get(p) || []).concat(t.id))
  for (const [p, ids] of writers) {
    if (ids.length < 2) continue
    const undeclared = ids.filter((id) => {
      const t = tasks.find((x) => x.id === id)
      return !((t && t.commutes) || []).includes(p)
    })
    if (undeclared.length) {
      rows.push('composition-unpinned: wave ' + waveNumber + ' ' + p +
        ' — writers ' + ids.join(',') + '; undeclared: ' + undeclared.join(','))
    }
  }
  return rows
}

export const suiteLine = (suite, cmd) => {
  if (!suite) return ''
  return '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: ' + (cmd || '(unknown)') +
    '\npassed: ' + Boolean(suite.passed) +
    (suite.passed === false ? '\noutput: ' + tail(suite.output, 500) : '')
}
const siblingLine = (task, wave) => {
  const sibs = wave
    .filter((t) => t.id !== task.id && Array.isArray(t.files) && t.files.length)
    .map((t) => t.id + ': ' + t.files.join(', '))
  return sibs.length ? ('\nSIBLING FILES: ' + sibs.join(' | ')) : ''
}
const taskBodyBlock = (task, wavesPath) => {
  const inlineBody = (typeof task.body === 'string' && task.body.trim() !== '')
  if (inlineBody) return '\nTASK:\n' + task.body
  if (wavesPath) {
    return '\nTASK: read your verbatim task text from the JSON file at ' + wavesPath +
      ' — in its "tasks" array, find the object whose "id" is "' + task.id +
      '" and use that object\'s "body" field as the authoritative task text. Do ' +
      'not paraphrase it; that entry also lists your declared file scope.'
  }
  return '\nTASK:\n' + (typeof task.body === 'string' ? task.body : '')
}

// ── small exec adapters ──────────────────────────────────────────────────────
// Shell strings (testCmd, bootstrapCmd) run through `bash -lc`; git always
// runs argv-form. Both resolve, never reject — callers branch on code.
//
// SHELL_TIMEOUT_MS (#436): a suite that wedges must not consume the sandbox
// lease. Nothing else bounds these — ROLE_TIMEOUT_MS covers only agent()
// subprocesses, and the shim renews the lease on its own interval, so an
// unbounded `sh` surfaces four hours later as an expired-claim reap rather
// than a test failure. The value matches ultra_run.py's own baseline bound
// (timeout=1800) for the same command; xdist adds wedge modes serial pytest
// lacks (an OOM-killed worker, a stuck execnet gateway), which is what moved
// this from theoretical to owed before the golden ships parallel pytest.
export const SHELL_TIMEOUT_MS = 30 * 60 * 1000
const shOf = (exec) => (cmd, cwd, env) =>
  exec('bash', ['-lc', cmd], { cwd, env, timeoutMs: SHELL_TIMEOUT_MS })
const gitOf = (exec) => async (argv, cwd) => {
  const r = await exec('git', argv, { cwd })
  if (r.code !== 0) {
    throw new Error('git ' + argv.join(' ') + ' exited ' + r.code + ' in ' + cwd + ': ' +
      (r.stderr || r.stdout).slice(-400))
  }
  return r.stdout.trim()
}

// The kernel CLI prints one JSON object on stdout (fold_wave.py cmd_* —
// json.dumps per verdict). Parse defensively: whole-stdout first, then the
// last {..} line (a stray warning line must not turn a verdict into a crash).
export function parseCliJson(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return null
  try { return JSON.parse(text) } catch { /* line scan */ }
  let found = null
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    try { found = JSON.parse(s) } catch { /* not the verdict line */ }
  }
  return found
}

const tail = (s, n = 4000) => String(s || '').slice(-n)

// Second wall on the reply patch (spec §3.3, waves.js PATCH_PREFIX parity):
// withPatchCapture is the first wall (it overwrites the model-typed patch),
// but a reply reaching here with a patch outside the driver-owned prefix is
// stripped regardless — configuration can travel without its producer.
const stripUntrustedPatch = (r, patchPrefix) => {
  if (!r) return r
  if (r.patch != null) {
    const p = String(r.patch)
    const hasDotDot = p === '..' || p.startsWith('../') || p.endsWith('/..') || p.indexOf('/../') !== -1
    if (!p.startsWith(patchPrefix) || hasDotDot) delete r.patch
  }
  return r
}

// ── the engine ───────────────────────────────────────────────────────────────
export async function runEngine({
  args, agent, parallel, exec,
  paths, // { repoDir, runDir, clonesDir }
  log = () => {}, phase = () => {},
  rolesDir,
  // Live patch base (optional): a { current } holder shared with the caller's
  // withPatchCapture wrapper. Wave 1 captures against BASE; each adopted wave
  // advances it so wave N+1's diffs are taken against the tree its tasks
  // actually built on — a static base would silently re-diff later waves
  // against the original BASE and re-fold wave 1's work into every patch.
  patchBase,
}) {
  const roles = loadRoles(rolesDir)
  const sh = shOf(exec)
  const git = gitOf(exec)
  const { runDir, clonesDir } = paths
  const repoDir = path.resolve(paths.repoDir)
  const integ = path.join(clonesDir, 'integration')

  // ── args (waves.js parity, minus the deleted subsystems) ───────────────────
  const WAVES = args.waves
  if (!Array.isArray(WAVES) || WAVES.length === 0 ||
      !WAVES.every((w) => Array.isArray(w) && w.length > 0 &&
        w.every((t) => t && typeof t.id === 'string' &&
          ((typeof t.body === 'string' && t.body.trim() !== '') || Boolean(args.wavesPath))))) {
    throw new Error('run-engine: args.waves missing or malformed (Task[][], each task ' +
      '{ id, body, ... }; body may live in args.wavesPath instead)')
  }
  {
    const seen = new Set()
    for (const w of WAVES) for (const t of w) {
      if (seen.has(t.id)) throw new Error('run-engine: duplicate task id "' + t.id + '"')
      seen.add(t.id)
    }
  }
  if (args.resume === true) {
    // The redirect lane is a future engine feature; refusing loudly beats a
    // half-ported resume that reuses a branch it never verified.
    throw new Error('run-engine: resume is not supported on the driver path')
  }
  const stamp = args.stamp || 'run'
  const integrationBranch = (typeof args.integrationBranch === 'string' && args.integrationBranch) ||
    ('ultra/integration-' + stamp)
  const dependencyEdges = args.dependencyEdges || []
  const edgesSupplied = Array.isArray(args.edges)
  const EDGES = edgesSupplied
    ? args.edges.map((e, i) => {
        if (!Array.isArray(e) || e.length !== 2) {
          throw new Error('run-engine: args.edges[' + i + '] is not a [from, to] pair')
        }
        return [String(e[0]), String(e[1])]
      })
    : []
  const testCmd = (typeof args.testCmd === 'string' && args.testCmd.trim()) || undefined
  // #436: the driver's own suite runs stay at full width (serialized, one
  // integration clone); the concurrent implementers get the machine divided
  // among them. args.width lets run-main pass its real WIDTH; the default
  // matches it so a caller that omits it is not silently uncapped.
  const workerWidth = Number.isInteger(args.width) && args.width > 0 ? args.width : 8
  const workerTestCmd = capWorkerParallelism(testCmd, workerWidth, os.cpus().length)
  if (workerTestCmd !== testCmd) {
    log('run-engine: worker testCmd capped for concurrency (#436) — ' + workerTestCmd)
  }
  const bootstrapCmd = (typeof args.bootstrapCmd === 'string' && args.bootstrapCmd.trim()) || undefined
  const ACCEPTANCE = (args.acceptance && typeof args.acceptance === 'object') ? args.acceptance : null
  const reviewProfile = (args.reviewProfile === 'adversarial') ? 'adversarial' : 'lean'
  const globalConstraints = (typeof args.globalConstraints === 'string' && args.globalConstraints.trim()) || ''
  const planPath = (typeof args.planPath === 'string' && args.planPath.trim()) || undefined
  const wavesPath = (typeof args.wavesPath === 'string' && args.wavesPath.trim()) || undefined
  // Patch input is the ONLY input shape here (Amendment 9): the value is the
  // driver-owned patches directory, the trust anchor for reply patches.
  const patchPrefix = (typeof args.patchInput === 'string' && args.patchInput.charAt(0) === '/')
    ? (args.patchInput.endsWith('/') ? args.patchInput : args.patchInput + '/')
    : null
  if (!patchPrefix) {
    throw new Error('run-engine: args.patchInput must be the absolute driver-owned patches ' +
      'directory — the engine has no branch-input mode (Amendment 9: fold is the only merge path)')
  }
  if (!testCmd) throw new Error('run-engine: args.testCmd is mandatory (#96)')

  const globalConstraintsBlock = globalConstraints ? ('\nGLOBAL CONSTRAINTS:\n' + globalConstraints) : ''
  const taskReviewProfile = (task) =>
    (task.review === 'adversarial' || reviewProfile === 'adversarial') ? 'adversarial' : 'lean'

  // ── report accumulators (waves.js parity) ──────────────────────────────────
  const taskResults = []
  const blockedWaves = []
  const waveMerges = []
  const judgmentCalls = []
  const unfinished = []
  const cannotVerifyItems = []
  const frontier = []

  // Edge sanity (ported): an unbound / inverted / same-wave edge weakens
  // dependency blocking — surfaced, never thrown.
  {
    const waveIndexOf = Object.create(null)
    WAVES.forEach((w, i) => w.forEach((t) => { waveIndexOf[t.id] = i }))
    for (const [a, b] of EDGES) {
      if (!(a in waveIndexOf) || !(b in waveIndexOf)) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoint not in this run — ' +
          'unbound for dependency blocking (check for a typo)')
      } else if (waveIndexOf[a] > waveIndexOf[b]) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': \'' + b + '\' does not run after \'' + a +
          '\' (earlier wave) — dependency blocking cannot bind; move the dependent to a later wave')
      } else if (waveIndexOf[a] === waveIndexOf[b]) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoints share a wave — blocking is ' +
          'chunk-position-dependent (fires only across ' + CONCURRENCY + '-task chunk boundaries)')
      }
    }
  }

  // ── SETUP — driver git (was: a haiku agent told to run `git worktree add`;
  // run-25's park class). The integration clone sits detached at BASE; the
  // branch is created there, bootstraps run, and the baseline is established,
  // all through exec. No prompt exists for any of this to be misread. ────────
  phase('Setup')
  const branchExists = await exec('git', ['show-ref', '--verify', '--quiet',
    'refs/heads/' + integrationBranch], { cwd: integ })
  if (branchExists.code === 0) {
    throw new Error('run-engine: integration branch ' + integrationBranch +
      ' already exists in the clone — refusing to reuse a branch this run did not create')
  }
  await git(['checkout', '-q', '-b', integrationBranch], integ)
  const baseSha = await git(['rev-parse', 'HEAD'], integ)
  if (bootstrapCmd) {
    // Every fresh clone needs its dependencies before a suite can run there —
    // the integration clone (baseline, reconcile, driver suite runs) and each
    // task clone (implementer red-green cycles). Driver-run, so the warm-cache
    // prompt choreography does not exist on this path.
    for (const dir of [integ, ...WAVES.flat().map((t) => path.join(clonesDir, 'task-' + t.id))]) {
      const b = await sh(bootstrapCmd, dir)
      if (b.code !== 0) {
        judgmentCalls.push('bootstrap failed in ' + path.basename(dir) + ' (exit ' + b.code +
          ') — the suite may be unrunnable there: ' + tail(b.stderr || b.stdout, 300))
        log('bootstrap failed in ' + path.basename(dir))
      }
    }
  }
  const baselineRun = await sh(testCmd, integ)
  const baseline = { passed: baselineRun.code === 0, output: tail(baselineRun.stdout + baselineRun.stderr, 2000) }
  if (!baseline.passed) {
    judgmentCalls.push('baseline: test suite was already failing before any task ran (' +
      tail(baseline.output, 500) + ') — task results inherit a red suite')
    log('setup: baseline tests FAILED before any work began')
  }
  log('setup: branch ' + integrationBranch + ' at ' + baseSha + '; baseline ' +
    (baseline.passed ? 'green' : 'RED'))

  // ── dependency cascade (ported) ────────────────────────────────────────────
  const blockedByDep = new Set()
  const noteFailures = () => {
    const failed = new Set(taskResults.filter((r) => r && r.status === 'failed').map((r) => r.task))
    let grew = true
    while (grew) {
      grew = false
      for (const [a, b] of EDGES) {
        if ((failed.has(a) || blockedByDep.has(a)) && !blockedByDep.has(b) && !failed.has(b)) {
          blockedByDep.add(b)
          grew = true
        }
      }
    }
  }

  const hasCoordinates = (r) => r && r.headSha && r.patch
  const isMergeable = (r) => r && r.status === 'done' && hasCoordinates(r)

  // Every RETRY dispatch gets a clean tree (review finding 3): waves.js
  // retries got a fresh worktree per dispatch, but here the retry re-enters
  // the SAME clone, which the failed attempt may have dirtied or committed to
  // — the fresh implementer would then be told "your tree is at BASE" over a
  // tree that is not, duplicate its own work into the cumulative patch, and
  // trip the #314 guard with a false alarm. Fix rounds are the one deliberate
  // exception: they BUILD on the prior attempt's tree, so only runTask's
  // retry lanes call this.
  const resetTaskClone = async (taskId, sha) => {
    const cdir = path.join(clonesDir, 'task-' + taskId)
    await git(['reset', '--hard', '--quiet', sha], cdir)
    await exec('git', ['clean', '-fdq'], { cwd: cdir })
  }

  // ── per-task pipeline: implement → review → bounded fix loop (ported) ──────
  async function runTaskInner(task, baseShaForTask, siblingsStr, tierOverride) {
    const tierName = (typeof tierOverride === 'string') ? tierOverride : task.tier
    const baseModel = resolvedModel(tierName)
    const economics = { tier: baseModel, review: taskReviewProfile(task) }
    const concerns = []
    const noteConcerns = (res) => {
      if (res && res.status === 'DONE_WITH_CONCERNS' && Array.isArray(res.concerns)) {
        for (const c of res.concerns) {
          if (concerns.indexOf(c) !== -1) continue
          concerns.push(c)
          judgmentCalls.push('task ' + task.id + ': ' + c)
        }
      }
    }
    if (task.review && task.review !== 'adversarial' && task.review !== 'lean') {
      judgmentCalls.push('task ' + task.id + ': unknown review="' + task.review +
        '" — fell back to the run default (' + reviewProfile + ')')
    }
    if (task.tier && !Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))) {
      judgmentCalls.push('task ' + task.id + ': unknown tier="' + task.tier +
        '" — fell back to standard (valid: standard, mostCapable/most-capable)')
    }

    const commonInputs = testCmdLine(task, workerTestCmd) + filesLine(task) + siblingsStr +
      globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task, wavesPath)
    let impl = await agent(
      roles.implementer + '\nBASE: ' + baseShaForTask + commonInputs,
      { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA })
    if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null (terminal Overloaded or skipped)')
    stripUntrustedPatch(impl, patchPrefix)
    noteConcerns(impl)
    // #314 guard, kept one more run (spec §3.1): clones are cut at BASE by
    // construction, so a mismatch here is a check on a thing that cannot
    // happen — which is what a guard on an inexpressible defect looks like.
    let baseCorrected = null
    if (typeof impl.startHead === 'string' && impl.startHead.trim()) {
      if (impl.startHead.trim() !== baseShaForTask) {
        baseCorrected = { from: impl.startHead.trim(), to: baseShaForTask }
        judgmentCalls.push('task ' + task.id + ': tree reported at ' + baseCorrected.from +
          ', not BASE ' + baseShaForTask + ' (#314 guard — should be inexpressible under cloneAtBase)')
      }
    } else {
      judgmentCalls.push('task ' + task.id + ': implementer reported no startHead — BASE anchoring unverified (#314)')
    }
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
      return { task: task.id, baseCorrected, status: 'failed', branch: '',
               reviewVerdict: 'not-reviewed', notes: impl.summary,
               tier: economics.tier, review: economics.review, fixIterations: 0 }
    }
    if (!hasCoordinates(impl)) {
      // With driver capture the only way here is a capture failure — reply
      // carries captureError, cleared coordinates (run-waves.mjs). Honest loss.
      judgmentCalls.push('task ' + task.id + ': no driver-captured coordinates (' +
        (impl.captureError || 'capture absent') + ') — failed before review')
      return { task: task.id, baseCorrected, status: 'failed', branch: '',
               reviewVerdict: 'lost-coordinates',
               notes: 'no driver-captured patch/headSha — downgraded to failed before review',
               tier: economics.tier, review: economics.review, fixIterations: 0 }
    }

    for (let iter = 1; iter <= 2; iter++) {
      const reviewPrompt = roles.reviewer + taskBodyBlock(task, wavesPath) +
        '\nPATCH: ' + impl.patch +
        '\nHEAD: ' + impl.headSha +
        '\nBASE: ' + baseShaForTask + filesLine(task) + siblingsStr +
        globalConstraintsBlock + interfacesLine(task)
      const reviewOpts = (pass) => ({
        label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
        model: REVIEWER_MODEL, schema: REVIEWER_SCHEMA,
      })
      let issues, verdicts
      if (taskReviewProfile(task) === 'adversarial') {
        // Sequential on purpose (waves.js parity): each task pipeline stays
        // single-agent so peak concurrency equals wave width.
        const r1 = await agent(reviewPrompt, reviewOpts(1))
        if (r1 === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
        const r2 = await agent(reviewPrompt, reviewOpts(2))
        if (r2 === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
        issues = (r1.issues || []).concat(r2.issues || [])
        verdicts = [r1.verdict, r2.verdict]
        for (const cv of (r1.cannotVerify || []).concat(r2.cannotVerify || [])) {
          cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
        }
      } else {
        const review = await agent(reviewPrompt, reviewOpts())
        if (review === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
        issues = review.issues || []
        verdicts = [review.verdict]
        for (const cv of (review.cannotVerify || [])) {
          cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
        }
      }
      const seenIssue = {}
      issues = issues.filter((i) => {
        const key = (i.severity || '') + '|' + (i.detail || '')
        if (seenIssue[key]) return false
        seenIssue[key] = true
        return true
      })
      if (!verdicts.some((v) => v === 'PASS' || v === 'FIX_REQUIRED')) {
        judgmentCalls.push('task ' + task.id + ': reviewer returned no recognizable verdict — ' +
          'treating as FIX_REQUIRED with a blocking issue (never merging on an empty review)')
        issues = issues.concat([{ severity: 'blocking',
          detail: 'review result carried no recognizable verdict — re-review required' }])
      }
      const blocking = issues.filter((i) => i.severity === 'blocking')
      const minors = issues.filter((i) => i.severity === 'minor')
      if (blocking.length === 0) {
        if (verdicts.indexOf('FIX_REQUIRED') !== -1) {
          judgmentCalls.push('task ' + task.id +
            ': reviewer said FIX_REQUIRED with no blocking issues — merged on the severity rule')
        }
        return { task: task.id, baseCorrected, status: 'done', branch: '',
                 headSha: impl.headSha, patch: impl.patch,
                 reviewVerdict: iter === 1 ? 'clean' : 'fixed',
                 notes: minors.map((m) => m.detail)
                   .concat(concerns.map((c) => 'concern: ' + c)).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: iter - 1 }
      }
      if (iter === 2) {
        return { task: task.id, baseCorrected, status: 'failed', branch: '',
                 reviewVerdict: 'fix-loop-exhausted', notes: blocking.map((b) => b.detail).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: 1 }
      }
      // Fix round: same tree (isolation routes fix:<id> to the task's clone),
      // prior work is simply the tree's state; capture stays cumulative
      // against the task BASE by construction (withPatchCapture).
      impl = await agent(
        roles.fix + taskBodyBlock(task, wavesPath) + testCmdLine(task, workerTestCmd) +
          filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) +
          '\n\nBlocking issues to resolve:\n' + blocking.map((b) => '- ' + b.detail).join('\n'),
        { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree',
          model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA })
      if (impl === null) throw new Error('AGENT_NULL: fix-round implementer agent returned null (terminal Overloaded or skipped)')
      stripUntrustedPatch(impl, patchPrefix)
      noteConcerns(impl)
      if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') && !hasCoordinates(impl)) {
        judgmentCalls.push('task ' + task.id + ': fix round lost driver-captured coordinates (' +
          (impl.captureError || 'capture absent') + ') — failed before re-review')
        return { task: task.id, baseCorrected, status: 'failed', branch: '',
                 reviewVerdict: 'lost-coordinates',
                 notes: 'fix round produced no driver-captured patch/headSha',
                 tier: economics.tier, review: economics.review, fixIterations: 1 }
      }
      if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
        return { task: task.id, baseCorrected, status: 'failed', branch: '',
                 reviewVerdict: 'blocked-after-fix', notes: impl.summary,
                 tier: economics.tier, review: economics.review, fixIterations: 1 }
      }
    }
  }

  async function runTask(task, baseShaForTask, siblingsStr) {
    try {
      return await runTaskInner(task, baseShaForTask, siblingsStr)
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (isInfraFault(msg)) {
        judgmentCalls.push('task ' + task.id + ': infra-death (' + msg +
          ') — parked for one barrier retry (no immediate retry into the live storm)')
        log('task ' + task.id + ' infra-death — parked for barrier retry')
        return { task: task.id, status: 'parked-infra', reviewVerdict: 'agent-error',
                 notes: msg, tier: resolvedModel(task.tier || 'standard'),
                 review: taskReviewProfile(task), fixIterations: 0 }
      }
      const capabilityFixable = isSchemaTrip(msg)
      const retryTier = capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')
      if (looksStructural(msg)) {
        judgmentCalls.push('task ' + task.id + ': agent error looks structural (' + msg +
          ') — looks like a missing dependency edge (the plan\'s Interfaces/Files do not order these tasks); a tier change will not fix it')
      }
      judgmentCalls.push('task ' + task.id + ': agent error at ' + (task.tier || 'standard') +
        ' — retrying once at ' + retryTier +
        (capabilityFixable ? ' (schema trip → escalate)' : ' (same tier)') + ': ' + msg)
      log('task ' + task.id + ' agent error — retrying at ' + retryTier)
      try {
        await resetTaskClone(task.id, baseShaForTask)
        const res = await runTaskInner(task, baseShaForTask, siblingsStr, retryTier)
        judgmentCalls.push('task ' + task.id + ': recovered after ' +
          (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier)
        return res
      } catch (e2) {
        const msg2 = String((e2 && e2.message) || e2)
        judgmentCalls.push('task ' + task.id + ': agent error after ' +
          (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier + ' — ' + msg2)
        log('task ' + task.id + ' FAILED after retry: ' + msg2)
        return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                 notes: msg2, tier: resolvedModel(retryTier),
                 review: taskReviewProfile(task), fixIterations: 0 }
      }
    }
  }

  // ── the fold — driver exec (was: an opus agent typing the CLI string the
  // engine composed). Kernel stdout keys are translated here exactly as the
  // STEP prompts ordered the agent to translate them; the receipts (fold log,
  // conflicts index, this frontier entry) are the record. ────────────────────
  // Resolved relative to the ENGINE, not the target repo: the kernel ships
  // with the checkout that is running this code, and a foreign target repo
  // (any non-self-hosted plan) has no skills/ tree of its own.
  const KERNEL = fileURLToPath(new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url))
  const waveDirOf = (n) => path.join(runDir, 'frontier', 'wave-' + n)

  async function foldWave(merged, waveIdx, waveTasks, prevHead) {
    const waveNumber = waveIdx + 1
    const transcripts = []
    let calls = 0
    let wallSec = 0
    let selfChecks = ''
    let autoResolved = 0
    const runCli = async (argv) => {
      calls += 1
      const t0 = Date.now()
      const r = await exec('python3', [KERNEL, ...argv], { cwd: integ })
      wallSec += (Date.now() - t0) / 1000
      const parsed = parseCliJson(r.stdout)
      if (parsed && typeof parsed.autoResolved === 'number') autoResolved += parsed.autoResolved
      return { ...r, parsed }
    }
    const entry = () => ({
      wave: waveNumber,
      foldLogPath: path.join(waveDirOf(waveNumber), 'fold_log.jsonl'),
      conflictsIndex: path.join(waveDirOf(waveNumber), 'conflicts.json'),
      selfChecks,
      foldCliCalls: calls,
      foldCliWallTimeSec: calls ? wallSec : null,
      autoResolved,
      resolverTranscripts: transcripts,
    })
    const blocked = (reason) => {
      frontier.push(entry())
      judgmentCalls.push('wave ' + waveNumber + ': fold path blocked — ' + reason)
      log('wave ' + waveNumber + ' fold blocked: ' + reason)
      return { status: 'CONFLICT', detail: reason }
    }

    const taskArgs = merged.flatMap((r) => ['--patch', r.task + '=' + r.patch])
    const commutesArgs = waveTasks
      .filter((t) => Array.isArray(t.commutes) && t.commutes.length)
      .flatMap((t) => ['--commutes', t.id + '=' + t.commutes.join(',')])
    const common = ['--repo', '.', '--run-dir', runDir, '--wave', String(waveNumber)]

    const fold = await runCli(['fold', ...common, '--base', prevHead, ...taskArgs, ...commutesArgs])
    if (!fold.parsed) return blocked('fold printed no verdict (exit ' + fold.code + '): ' + tail(fold.stderr, 300))
    const f = fold.parsed
    if (typeof f.selfChecks === 'string') selfChecks = f.selfChecks
    if (typeof f.parked === 'number' && f.parked > 0) {
      return blocked('fold parked ' + f.parked + ' conflict(s) — see the conflicts index')
    }
    if (fold.code !== 0 && !(Array.isArray(f.open) && f.open.length)) {
      return blocked('fold exited ' + fold.code + ': ' + (f.selfChecks || tail(fold.stderr, 300)))
    }
    if (typeof f.conflicts !== 'number') {
      return blocked('fold reported no conflicts count to verify against')
    }
    let outstanding = (Array.isArray(f.open) ? f.open : []).slice()
    if (f.conflicts > 0 && outstanding.length === 0) {
      return blocked('fold counted ' + f.conflicts + ' conflict(s) but named none to resolve')
    }
    const expectOpen = (typeof f.dispatchable === 'number') ? f.dispatchable : f.conflicts
    if (outstanding.length !== expectOpen) {
      return blocked('fold named ' + outstanding.length + ' open conflict(s) but counted ' +
        expectOpen + ' still to resolve')
    }
    if (outstanding.length === 0 && f.complete !== true) {
      return blocked('fold reported no conflicts but did not complete (selfChecks: ' +
        (f.selfChecks || 'absent') + ')')
    }

    // Resolver work list (ported semantics): one JUDGMENT agent per conflict —
    // hunk resolutions arrive in its schema, the DRIVER writes the reply
    // directory (grammar unchanged: h<n>.txt per hunk + notes.txt) and drives
    // `resolve`. REJECTED (exit 4) is the one retryable status — one re-brief
    // carrying the kernel's reason.
    worklist:
    while (outstanding.length) {
      const conflict = outstanding[0]
      let rejection = ''
      for (let attempt = 1; attempt <= 2; attempt++) {
        let res
        try {
          res = await agent(
            roles.resolver +
              '\nHUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
              (rejection ? ('\nPREVIOUS REPLY REJECTED: ' + rejection) : '') +
              '\nCONTENDING TASKS:' + waveTasks.map((t) =>
                '\n- task ' + t.id + ': ' + (t.title || '') +
                ((Array.isArray(t.files) && t.files.length) ? (' [files: ' + t.files.join(', ') + ']') : '')).join('') +
              (wavesPath ? ('\nTheir full verbatim task text lives in the JSON file at ' + wavesPath +
                ' — read the "tasks" array entry whose "id" matches.') : ''),
            { label: 'resolve:wave' + waveNumber + ':' + conflict.i + ':' + attempt,
              schema: RESOLVER_SCHEMA })
        } catch (e) {
          // A run-fatal (credential/config) must surface as the engine crash
          // it is — swallowing it here would misreport a dead credential as a
          // merge CONFLICT (review finding 4).
          if (String((e && e.message) || e).startsWith('RUN_FATAL')) throw e
          return blocked('resolver dispatch threw on ' + conflict.path + ': ' + String((e && e.message) || e))
        }
        if (!res) {
          // A null reply is a transient process death (agent()'s documented
          // condition), not a judgment about the conflict: spend the second
          // attempt on it rather than blocking the wave on one API blip.
          if (attempt === 1) { rejection = 'the previous resolver produced no reply (transient death) — resolve afresh'; continue }
          return blocked('resolver dispatch returned no reply twice on ' + conflict.path)
        }
        const replyDir = path.join(waveDirOf(waveNumber), 'reply-' + conflict.i + '-' + attempt)
        transcripts.push({ conflict: conflict.i, attempt, path: conflict.path,
          epoch: conflict.epoch, hunksFile: conflict.hunksFile,
          replyDir, status: res.status, notes: res.notes || '' })
        if (res.status !== 'RESOLVED') {
          return blocked('resolver reported ' + res.status + ' on ' + conflict.path)
        }
        // Driver writes the reply directory from the schema contents. Each
        // hunk file is newline-terminated (the grammar's shape); an empty
        // content is an empty file (the block resolves to nothing).
        fs.mkdirSync(replyDir, { recursive: true })
        for (const h of (res.hunks || [])) {
          const c = String(h.content || '')
          // The id rides the reply verbatim but the filename is driver-built:
          // strip anything path-shaped so a hostile id cannot escape replyDir.
          const safeId = String(h.id || '').replace(/[^A-Za-z0-9]/g, '')
          if (!safeId) continue
          fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
            c === '' ? '' : (c.endsWith('\n') ? c : c + '\n'))
        }
        fs.writeFileSync(path.join(replyDir, 'notes.txt'), String(res.notes || '') + '\n')

        const applied = await runCli(['resolve', ...common,
          '--conflict', String(conflict.i), '--reply-dir', replyDir, ...taskArgs, ...commutesArgs])
        const a = applied.parsed
        if (applied.code === 4) {
          const reason = (a && a.reason) || tail(applied.stderr, 200)
          if (attempt === 1) { rejection = reason; continue }
          return blocked('resolver reply rejected twice on ' + conflict.path + ': ' + reason)
        }
        if (!a || a.applied !== true) {
          return blocked('resolution of ' + conflict.path + ' not applied (exit ' + applied.code +
            '): ' + ((a && (a.reason || (a.stale ? 'stale' : ''))) || tail(applied.stderr, 300)))
        }
        if (Array.isArray(a.waiting) && a.waiting.length) {
          // The stop has not drained: the engine's outstanding list minus the
          // entry just applied must be exactly what the CLI says is waiting.
          const expectWaiting = outstanding.slice(1).map((e) => e.i)
          const sameIds = a.waiting.length === expectWaiting.length &&
            a.waiting.slice().sort((x, y) => x - y).join(',') ===
            expectWaiting.slice().sort((x, y) => x - y).join(',')
          if (!sameIds) {
            return blocked('resolve on ' + conflict.path + ' reported waiting [' +
              a.waiting.join(', ') + '] but the engine was holding [' + expectWaiting.join(', ') + ']')
          }
          outstanding.shift()
          continue worklist
        }
        if (Array.isArray(a.open) && a.open.length) {
          if (typeof a.conflicts !== 'number') {
            return blocked('continued fold reported open conflicts with no count to verify against')
          }
          if (a.dispatchable !== a.open.length) {
            return blocked('continued fold named ' + a.open.length + ' open conflict(s) but counted ' +
              a.dispatchable + ' still to resolve')
          }
          outstanding = a.open.slice()
          continue worklist
        }
        if (a.complete === true) {
          if (a.selfChecks !== 'ok') {
            return blocked('fold self-checks did not pass: ' + (a.selfChecks || '(absent)'))
          }
          selfChecks = a.selfChecks
          outstanding = []
          continue worklist
        }
        return blocked('resolution of ' + conflict.path + ' left the wave in an unrecognized state')
      }
      return blocked('resolver attempts exhausted on ' + conflict.path)
    }

    // Materialize → candidate, then the adopt choreography the old ADOPT step
    // ordered in prose: test the candidate with the branch unmoved
    // (read-tree -u --reset), suite, adopt with reset --hard on green. On red,
    // the reconcile JUDGMENT agent (spec §2's named addition — the old patch
    // route had no post-fold suite repair at all): it edits files only, the
    // driver commits and re-runs the suite; cap 2; still red restores prevHead
    // and the wave is TEST_FAILED.
    const mat = await runCli(['materialize', ...common, '--prev-head', prevHead, ...taskArgs])
    const m = mat.parsed
    if (!m || !m.candidateSha) {
      return blocked('materialize refused: ' + ((m && (m.park || m.fallback)) || tail(mat.stderr, 300)))
    }
    const candidate = m.candidateSha
    // The adopt leg's last kernel call (Tier 1, spec 2026-09-01 §2.1): the
    // weave dir is a sidecar seeded from the head that was ACTUALLY adopted,
    // so it runs after the branch moved and never before. Its refusal costs
    // the next wave its seed and nothing else — a judgment-call note, never a
    // wave status, and never a touch on the fold log.
    const emitWeave = async (headSha) => {
      const r = await runCli(['emit-weave', ...common, '--adopt-head', headSha])
      if (r.code !== 0) judgmentCalls.push('wave ' + waveNumber +
        ': emit-weave failed (exit ' + r.code + ') — weave persistence skipped, fold unaffected')
    }
    await git(['read-tree', '-u', '--reset', candidate + '^{tree}'], integ)
    let suite = await sh(testCmd, integ)
    if (suite.code === 0) {
      await git(['reset', '--hard', candidate], integ)
      await emitWeave(candidate)
      frontier.push(entry())
      return { status: 'MERGED', headSha: candidate,
               suite: { passed: true, output: tail(suite.stdout + suite.stderr) } }
    }
    for (let attempt = 1; attempt <= 2 && suite.code !== 0; attempt++) {
      log('wave ' + waveNumber + ' candidate suite RED — reconcile attempt ' + attempt)
      let rec
      try {
        rec = await agent(
          roles.reconcile + '\nTEST COMMAND: ' + testCmd +
            '\n\nFailing output:\n' + tail(suite.stdout + suite.stderr, 3000),
          { label: 'reconcile:wave' + waveNumber + ':' + attempt,
            model: TIER.mostCapable, schema: RECONCILE_SCHEMA })
      } catch (e) {
        if (String((e && e.message) || e).startsWith('RUN_FATAL')) throw e
        rec = null
      }
      if (!rec || rec.status !== 'FIXED') {
        judgmentCalls.push('wave ' + waveNumber + ': reconcile attempt ' + attempt +
          (rec ? (' reported ' + rec.status + ': ' + (rec.summary || '')) : ' produced no reply'))
        break
      }
      await git(['add', '-A'], integ)
      // A FIXED report over an unchanged tree must not move the branch
      // (review finding 5): there is no fix to adopt, and a flaky suite going
      // green on re-run would otherwise credit an empty commit. "Changed
      // nothing" is two comparisons because the index legitimately differs
      // from HEAD on attempt 1 (it holds the candidate tree from read-tree):
      // no change vs the CANDIDATE means attempt 1 edited nothing; no change
      // vs HEAD means a later attempt edited nothing (and git commit would
      // refuse anyway).
      const vsCandidate = await exec('git', ['diff', '--cached', '--quiet', candidate], { cwd: integ })
      const vsHead = await exec('git', ['diff', '--cached', '--quiet', 'HEAD'], { cwd: integ })
      if (vsCandidate.code === 0 || vsHead.code === 0) {
        judgmentCalls.push('wave ' + waveNumber + ': reconcile reported FIXED but changed nothing — not committing')
        break
      }
      await git(['commit', '-q', '-m',
        'wave ' + waveNumber + ' reconcile (attempt ' + attempt + ')'], integ)
      suite = await sh(testCmd, integ)
    }
    if (suite.code === 0) {
      const headSha = await git(['rev-parse', 'HEAD'], integ)
      // The reconcile commits sit on top of prevHead carrying the candidate
      // tree + fixes: reset --hard is unnecessary (the commit already moved
      // the branch), but assert the tree is clean before declaring MERGED.
      await emitWeave(headSha)
      frontier.push(entry())
      judgmentCalls.push('wave ' + waveNumber + ': candidate adopted after reconcile (' +
        candidate + ' + fixes → ' + headSha + ')')
      return { status: 'MERGED', headSha,
               suite: { passed: true, output: tail(suite.stdout + suite.stderr) } }
    }
    await git(['reset', '--hard', prevHead], integ)
    await exec('git', ['clean', '-fd'], { cwd: integ })
    frontier.push(entry())
    return { status: 'TEST_FAILED',
             detail: 'candidate suite failed after reconcile attempts: ' +
               tail(suite.stdout + suite.stderr, 800) }
  }

  // ── wave loop (ported: chunking, lost sweep, barrier retry, cascade) ───────
  // (waves.js pre-registered every phase up front for the Workflow tool's
  // roadmap API; here phase() appends timestamped events, so an up-front burst
  // would record the run entering every phase at t=0 — review finding 6. Each
  // phase is announced once, when it actually starts.)
  const waveLabel = (w) => 'Wave ' + (w + 1)

  let waveBaseSha = baseSha
  const compositionRows = (waveNumber, tasks) => {
    for (const line of compositionUnpinnedRows(waveNumber, tasks)) judgmentCalls.push(line)
  }

  let lastSuite = null
  for (let w = 0; w < WAVES.length; w++) {
    phase(waveLabel(w))
    noteFailures()
    // Anchor this wave: the capture base advances with the integration head,
    // and every task clone of a LATER wave is re-anchored onto that head (the
    // adopt sha exists only in the integration clone's odb, so fetch it from
    // there first). Wave 1 clones are already at BASE from provisioning.
    //
    // A re-anchor failure is FAIL-CLOSED (review finding 1): a task dispatched
    // into a tree still at the old base yields a patch — diffed against the
    // NEW wave base — whose hunks silently REVERT the prior wave's adopted
    // work, and nothing downstream can tell. The task is failed before any
    // dispatch, exactly like lost-coordinates.
    if (patchBase) patchBase.current = waveBaseSha
    const preFailed = new Set()
    if (w > 0 && waveBaseSha !== baseSha) {
      for (const t of WAVES[w]) {
        const cdir = path.join(clonesDir, 'task-' + t.id)
        try {
          await git(['fetch', '--quiet', '--no-tags', integ, integrationBranch], cdir)
          await git(['checkout', '--quiet', '--detach', waveBaseSha], cdir)
          // The adopted head may have added dependencies wave 1 installed only
          // in its own trees — a stale install here fails the wave-2 suite
          // with a module error looksStructural() would mis-diagnose (review
          // finding 9).
          if (bootstrapCmd) {
            const b = await sh(bootstrapCmd, cdir)
            if (b.code !== 0) {
              judgmentCalls.push('task ' + t.id + ': re-anchor bootstrap failed (exit ' + b.code +
                ') — the suite may be unrunnable in its clone')
            }
          }
        } catch (e) {
          preFailed.add(t.id)
          const detail = 'could not re-anchor its clone at wave base ' + waveBaseSha +
            ' — ' + String((e && e.message) || e)
          judgmentCalls.push('task ' + t.id + ': ' + detail +
            ' — failed closed before dispatch (a patch from a mis-anchored tree would silently revert the prior wave)')
          log('task ' + t.id + ' re-anchor failed — task failed closed')
        }
      }
    }
    const results = []
    for (const id of preFailed) {
      const r = { task: id, status: 'failed', reviewVerdict: 'reanchor-failed',
                  notes: 'clone could not be re-anchored at the wave base — never dispatched',
                  tier: resolvedModel((WAVES[w].find((t) => t.id === id) || {}).tier || 'standard'),
                  review: 'lean', fixIterations: 0 }
      results.push(r); taskResults.push(r)
    }
    for (let off = 0; off < WAVES[w].length; off += CONCURRENCY) {
      noteFailures()
      const chunk = WAVES[w].slice(off, off + CONCURRENCY)
      const runnable = chunk.filter((t) => {
        if (preFailed.has(t.id)) return false // already failed closed at re-anchor
        if (blockedByDep.has(t.id)) {
          unfinished.push(t.id + ': blocked — depends on a failed task')
          log('task ' + t.id + ' skipped: upstream dependency failed')
          return false
        }
        return true
      })
      if (runnable.length === 0) continue
      const chunkResults = await parallel(runnable.map((task) => () =>
        runTask(task, waveBaseSha, siblingLine(task, WAVES[w]))))
      for (const r of chunkResults) { results.push(r); taskResults.push(r) }
      const chunkLost = chunkResults.filter((r) => r && r.status === 'done' && !isMergeable(r))
      for (const r of chunkLost) {
        judgmentCalls.push('task ' + r.task + ': reported done without driver-captured coordinates — treating as failed for dependency blocking')
        r.status = 'failed'
        r.reviewVerdict = 'lost-coordinates'
        r.notes = (r.notes ? r.notes + '; ' : '') + 'done without coordinates — downgraded to failed'
      }
      noteFailures()
    }

    // Infra-death barrier retry (ported): exactly one retry per parked task,
    // at the wave barrier, same tier — barrier position is the backoff.
    const parkedInfra = results.filter((r) => r && r.status === 'parked-infra')
    for (let off = 0; off < parkedInfra.length; off += CONCURRENCY) {
      const pchunk = parkedInfra.slice(off, off + CONCURRENCY)
      log('wave ' + (w + 1) + ' barrier: retrying ' + pchunk.length + ' infra-parked task(s)')
      const retried = await parallel(pchunk.map((p) => () => (async () => {
        const task = WAVES[w].find((t) => t.id === p.task)
        try {
          await resetTaskClone(task.id, waveBaseSha)
          const res = await runTaskInner(task, waveBaseSha, siblingLine(task, WAVES[w]))
          judgmentCalls.push('task ' + task.id + ': parked on infra-death, recovered at the barrier retry')
          return res
        } catch (e2) {
          const msg2 = String((e2 && e2.message) || e2)
          judgmentCalls.push('task ' + task.id + ': barrier retry after infra-death failed — ' + msg2)
          return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                   notes: msg2, tier: p.tier, review: p.review, fixIterations: 0 }
        }
      })()))
      for (let k = 0; k < pchunk.length; k++) {
        const p = pchunk[k], res = retried[k]
        const ri = results.indexOf(p); if (ri !== -1) results[ri] = res
        const ti = taskResults.indexOf(p); if (ti !== -1) taskResults[ti] = res
        if (res.status === 'failed') {
          for (const [a, b] of EDGES) {
            if (a === p.task && results.some((r2) => r2 && r2.task === b)) {
              judgmentCalls.push('task ' + b + ': ran while same-wave dependency ' + a +
                ' was parked and the barrier retry then failed — WaW ordering weakened; the suite gate is the backstop')
            }
          }
        }
      }
      noteFailures()
    }

    const mergeable = results.filter(isMergeable)
    if (mergeable.length === 0) {
      if (!edgesSupplied && results.length > 0) {
        const cascadeDetail = 'no mergeable results and no dependency edges supplied — cascading conservatively'
        blockedWaves.push({ wave: w + 1, detail: cascadeDetail })
        for (let d = w + 1; d < WAVES.length; d++) {
          WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
        }
        waveMerges.push({ wave: w + 1, status: 'SKIPPED', detail: cascadeDetail, branches: [] })
        break
      }
      waveMerges.push({
        wave: w + 1, status: 'SKIPPED',
        detail: 'no mergeable results — every task in this wave failed, was blocked, or lost its coordinates; integration branch untouched',
        branches: [],
      })
      log('wave ' + (w + 1) + ' merge skipped: no mergeable results')
      continue
    }

    const waveTasks = (Array.isArray(WAVES[w]) ? WAVES[w] : [])
      .filter((t) => t && mergeable.some((r) => r.task === t.id))
    compositionRows(w + 1, waveTasks)
    const merge = await foldWave(mergeable, w, waveTasks, waveBaseSha)
    waveMerges.push({
      wave: w + 1,
      status: merge.status,
      headSha: merge.headSha,
      detail: merge.detail,
      branches: mergeable.map((r) => r.task),
    })
    if (merge.status === 'MERGED') {
      waveBaseSha = merge.headSha
      lastSuite = merge.suite
      continue
    }
    blockedWaves.push({ wave: w + 1, detail: merge.detail || merge.status })
    log('wave ' + (w + 1) + ' BLOCKED: ' + (merge.detail || merge.status))
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
    }
    break
  }

  // ── the depth-1 leg (#465) ────────────────────────────────────────────────
  // The gate is the operator's single pre-merge checkpoint, and until this leg
  // it certified against a clone the merge target does not match: the sandbox
  // clone carries full history, `actions/checkout@v4` defaults to fetch-depth
  // 1, and git reports a shallow boundary commit as INTRODUCING EVERY FILE —
  // so `git log -- <path>` returns the tip commit for any path that exists.
  // Run-32 gated green (7/7 checks, 979 tests) and CI went red on exactly that;
  // a human diagnosed and patched it, which is the work the single-gate promise
  // is supposed to absorb. The class is wider than the instance: any test
  // coupled to repository state — history, tags, remotes, tree cleanliness —
  // passes here and fails on main.
  //
  // Cost is one suite pass (~90 s at 16 vCPU), paid only when there is a green
  // adopted tree to re-certify. A red leg becomes a `deferred:manual` item, not
  // a failed `tests` field: the driver's full-clone run really did pass, and a
  // depth-1 degradation can legitimately be correct behaviour in a consumer
  // clone (#465's own reading of `_release_timeline` returning None there). Which
  // it is, is a human judgment — so it reaches the gate as the one ack type that
  // is NOT pre-authorized (run-main's ackDecision), and the run parks on real
  // evidence instead of surprising the operator after the merge.
  let shallowSuite = null
  let shallowDeferred = null
  if (args.shallowLeg !== false && waveMerges.some((m) => m && m.status === 'MERGED') &&
      lastSuite && lastSuite.passed) {
    phase('Depth-1 Leg')
    // Under clonesDir on purpose: it is a full repo copy (plus whatever
    // bootstrapCmd installs), and drive.mjs's evidence pull excludes exactly
    // `run-*/clones` from the tarball — "never the repo itself" is that
    // command's whole rule. A sibling directory would ride home in every bundle.
    const shallowDir = path.join(clonesDir, 'shallow')
    fs.rmSync(shallowDir, { recursive: true, force: true })
    // `file://` is load-bearing: git IGNORES --depth on a plain local path clone
    // (it hardlinks the whole object store), so a path form would silently
    // certify a second full clone and always agree. The path is resolved because
    // a `file://` URL is only a URL when it is absolute (repoDir is resolved for
    // the same reason); clonesDir arrives from the caller unnormalized.
    const cl = await exec('git', ['clone', '--quiet', '--depth', '1', '--branch',
      integrationBranch, 'file://' + path.resolve(integ), shallowDir], { cwd: runDir })
    if (cl.code !== 0) {
      judgmentCalls.push('depth-1 leg: cloning ' + integrationBranch + ' at depth 1 failed (' +
        tail(cl.stderr || cl.stdout, 300) + ') — the shallow-clone class is unchecked this run')
    } else {
      if (bootstrapCmd) {
        const b = await sh(bootstrapCmd, shallowDir)
        if (b.code !== 0) {
          judgmentCalls.push('depth-1 leg: bootstrap failed in the shallow clone (exit ' + b.code +
            ') — a red leg below may be a missing dependency rather than a history coupling')
        }
      }
      const s = await sh(testCmd, shallowDir)
      shallowSuite = { depth: 1, command: testCmd, passed: s.code === 0,
                       output: tail(s.stdout + s.stderr, 2000) }
      log('depth-1 leg: ' + (shallowSuite.passed ? 'green' : 'RED'))
      if (!shallowSuite.passed) {
        const why = 'the suite passed on the full clone and failed on a depth-1 clone of ' +
          integrationBranch + ' — CI checks out at fetch-depth 1, so the merge target will not ' +
          'reproduce this run\'s green. Either a test is coupled to repository history (fix the ' +
          'test) or the degradation is correct for a shallow consumer (ack it): ' +
          tail(shallowSuite.output, 800)
        judgmentCalls.push('depth-1 leg: ' + why)
        shallowDeferred = { deliverable: 'depth-1 clone of ' + integrationBranch,
                            reason: 'manual', why }
      }
    }
  }

  // ── completeness critic — read-only judgment; the driver already ran the
  // suite (per adopted wave) and derives gitVerified below from receipts. ────
  phase('Integration Review')
  const taskList = WAVES.flat().map((t) => t.id + ': ' + (t.title || '')).join('\n')
  const waveMergedAny = waveMerges.some((m) => m && m.status === 'MERGED')
  // criticRan gates gitVerified below (review finding 2): waves.js's critic
  // attestation made a dead critic fail-closed at the gate, and receipts alone
  // cannot preserve that — clean receipts say the merge is intact, not that
  // anyone reviewed its completeness.
  let criticRan = false
  let review
  if (!waveMergedAny) {
    // Nothing merged: the tree is at BASE, and a critic told it holds "the
    // final integrated tree" would emit confident findings about the wrong
    // tree (review finding 8). gitVerified is already false on this path.
    review = { findings: [{ severity: 'blocking',
                           detail: 'no wave merged — completeness review skipped (the tree is at BASE)' }],
               deferredVerification: [] }
  } else {
    try {
      // Checklist hygiene (review finding 8): dedupe (iter-1 and iter-2
      // reviews repeat items) and drop items from tasks that never merged —
      // those are already accounted under missingDeliverables, and handing
      // them to the critic manufactures findings about absent-by-record work.
      const doneTasks = new Set(taskResults.filter((r) => r.status === 'done').map((r) => r.task))
      const seenCv = new Set()
      const checklistItems = cannotVerifyItems.filter((c) => {
        const key = c.task + '|' + c.requirement
        if (seenCv.has(key) || !doneTasks.has(c.task)) return false
        seenCv.add(key)
        return true
      })
      const cannotVerifyChecklist = checklistItems.length
        ? ('\nCANNOT-VERIFY checklist (escalated by the per-task reviewers — verify each against the integrated tree):\n' +
           checklistItems.map((c) => '- [' + c.task + '] ' + c.requirement + ' (' + c.why + ')').join('\n'))
        : ''
      review = await agent(
        roles.critic +
          (planPath ? ('\nPLAN: read the original plan document at ' + planPath + ' first.') : '') +
          globalConstraintsBlock + cannotVerifyChecklist +
          '\n\nTasks:\n' + taskList +
          '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
          suiteLine(lastSuite, testCmd) +
          (baseline.passed === false
            ? '\nBaseline: the test suite failed before any task ran — ' + tail(baseline.output, 500)
            : ''),
        { label: 'integration', model: REVIEWER_MODEL, schema: CRITIC_SCHEMA })
    } catch (e) {
      const msg = String((e && e.message) || e)
      judgmentCalls.push('integration review failed to run: ' + msg)
      review = null
    }
    if (review && typeof review === 'object') {
      criticRan = true
    } else {
      judgmentCalls.push('integration review returned no result — the completeness critic died; gitVerified is withheld (fail-closed, as the old attestation path was)')
      review = { findings: [{ severity: 'blocking',
                             detail: 'integration review did not run — completeness unverified; check the tree before merging' }],
                 deferredVerification: [] }
    }
  }

  // Driver detach: releases the integration branch in the clone. Nothing on
  // the driver path needs the branch checked out from here on (the fetch
  // bridge reads refs, the gate operates on the repo checkout).
  try { await git(['checkout', '-q', '--detach'], integ) } catch { /* non-fatal */ }

  // ── driver-derived verification (spec §3.1: gitVerified is REDEFINED and
  // disclosed) — the branch tip must equal the last adopt receipt, and every
  // task reported merged must appear as a fold event in its wave's fold log.
  // The old meaning (the critic's own attestation) cannot exist when the
  // critic no longer detaches; this is the receipt-based equivalent of #70. ──
  const ancestryMisses = []
  for (const wm of waveMerges) {
    if (wm.status !== 'MERGED') continue
    let foldedIds = new Set()
    try {
      const logLines = fs.readFileSync(path.join(waveDirOf(wm.wave), 'fold_log.jsonl'), 'utf8')
      for (const line of logLines.split('\n')) {
        if (!line.trim()) continue
        try {
          const e = JSON.parse(line)
          if (e.type === 'fold') foldedIds.add(e.task)
        } catch { /* not a record */ }
      }
    } catch { /* missing log = every task misses below */ }
    for (const t of wm.branches) {
      if (!foldedIds.has(t)) ancestryMisses.push({ task: t, headSha: '(no fold event in wave ' + wm.wave + ' log)' })
    }
  }
  let tipSha = ''
  try { tipSha = await git(['rev-parse', integrationBranch], integ) } catch { /* no branch tip */ }
  const lastMerged = waveMerges.filter((m) => m.status === 'MERGED').pop()
  const tipMatches = !!(lastMerged && lastMerged.headSha && tipSha === lastMerged.headSha)
  if (lastMerged && !tipMatches) {
    judgmentCalls.push('integration branch tip ' + tipSha + ' does not equal the last adopt receipt ' +
      lastMerged.headSha + ' — gitVerified withheld')
  }
  for (const m of ancestryMisses) {
    judgmentCalls.push('integration ancestry miss (#70, receipt-based): task ' + m.task +
      ' reported merged but ' + m.headSha + ' — silently dropped; the run is BLOCKED, do not merge')
  }
  const anyWaveMerged = waveMergedAny
  // gitVerified = receipts intact AND the completeness review actually ran
  // (spec §3.1's redefinition, plus review finding 2's fail-closed condition).
  const gitVerified = anyWaveMerged && tipMatches && ancestryMisses.length === 0 && criticRan
  const deferredVerification = (Array.isArray(review.deferredVerification)
    ? review.deferredVerification : [])
    .concat(shallowDeferred ? [shallowDeferred] : [])

  if (cannotVerifyItems.length && !anyWaveMerged) {
    for (const c of cannotVerifyItems) {
      judgmentCalls.push('cannot-verify (task ' + c.task + '): ' + c.requirement +
        ' — no wave merged, so the critic had no integrated tree; verify manually before the gate')
    }
  }

  // tests: the DRIVER's own suite run on the adopted tree (was: the critic's).
  const tests = lastSuite
    ? { command: testCmd, passed: lastSuite.passed, output: lastSuite.output }
    : { command: testCmd, passed: false, output: 'not run — no wave merged' }

  let acceptance = null
  if (ACCEPTANCE && ACCEPTANCE.mode === 'waived') {
    acceptance = { mode: 'waived', reason: String(ACCEPTANCE.reason || ''), passed: null }
  } else if (ACCEPTANCE && ACCEPTANCE.mode === 'suite') {
    acceptance = { mode: 'suite', passed: tests.passed, reason: String(ACCEPTANCE.reason || '') }
    if (!acceptance.passed) judgmentCalls.push(
      'suite acceptance did not pass (committed test suite failed) — gate must not Approve')
  } else if (ACCEPTANCE && ACCEPTANCE.mode === 'sealed') {
    acceptance = { mode: 'sealed', sealId: ACCEPTANCE.sealId, sha256: ACCEPTANCE.sha256,
                   status: 'PENDING_GATE', passed: null,
                   note: 'administered deterministically at the pre-merge gate' }
  }

  const mergedBranches = new Set()
  for (const wm of waveMerges) if (wm && wm.status === 'MERGED') for (const b of (wm.branches || [])) mergedBranches.add(b)
  const tasksPlanned = WAVES.flat().length
  const coverage = { tasks_merged: mergedBranches.size, tasks_planned: tasksPlanned,
                     complete: mergedBranches.size >= tasksPlanned }
  const failedIds = taskResults.filter((t) => t.status === 'failed').map((t) => t.task)
  const blockedIds = unfinished
    .map((u) => (typeof u === 'string' ? u.split(/[:\s]/)[0] : (u && u.task)))
    .filter(Boolean)
  const missingIds = [...new Set([...failedIds, ...blockedIds])]
  const missingDeliverables = missingIds
    .map((id) => ({ task: id, files: ((WAVES.flat().find((t) => t.id === id) || {}).files) || [] }))
    .filter((m) => m.files.length)

  return {
    integrationBranch,
    baseSha,
    waves: WAVES.map((w) => w.map((t) => t.id)),
    dependencyEdges,
    tasks: taskResults,
    tests,
    shallowSuite,
    acceptance,
    baseline,
    waveMerges,
    frontier,
    coverage,
    missingDeliverables,
    gitVerified,
    ancestryMisses,
    deferredVerification,
    judgmentCalls,
    unfinished,
    completenessFindings: review.findings || [],
    blockedWaves,
  }
}
