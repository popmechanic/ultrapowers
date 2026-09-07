#!/usr/bin/env node
// fleet/publish-fold.mjs — the folder (#715, spec §3.1–§3.7).
//
// Between the engine and the push sits one more step: this run's integration
// branch is folded onto MAIN AS IT IS NOW, not onto the base the run was cut
// from. The engine folded task patches onto BASE; main moved underneath while
// the run worked. The folder cuts two patches against BASE — main's move and
// this run's whole result — hands both to the same kernel the wave loop drives,
// and materializes a candidate whose ONLY parent is main's tip.
//
// Amendment 10 holds throughout: no model runs git and no GitHub call is a
// model's. The one model this module may dispatch is the read-only resolver
// role, through `resolveConflicts` — the wave loop's own work list, lifted so
// the publish fold drives it with its own reply-directory root, contending
// block and label prefix. Every ref move, every reply directory and every
// receipt is the driver's. Nothing here pushes: `push_head` in the boot script
// does that, reading the disposition out of `publish-fold/receipt.json`.
//
// THE RECEIPT IS THE REPORT. Callers read the disposition from
// `<evidence-dir>/publish-fold/receipt.json`, never from stdout, and every
// write of that file goes through `receipt.json.tmp` + `deps.rename` so a
// reader never sees a half-written document. `engine-head` is written before
// anything else touches the world — it is the floor the boot script rewinds
// the branch to when this process dies mid-fold, so it must exist before the
// first fetch and must never be rewritten once it does.
//
// Re-entry (attempt 2, or a re-drive of attempt 1) reads the receipt BEFORE it
// fetches anything: an attempt that recorded a disposition is replayed from the
// receipt — the branch is restored to its candidate and the kernel is not
// invoked at all — and an attempt that recorded only a `tip` is discarded along
// with its wave directory, because `fold_wave.py fold` exits 2 on a wave whose
// `fold_log.jsonl` already exists.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENGINE_DIR, execSeam, composeAgent, writeRoleFiles, copyEngineRoles, writeConfineSettings,
} from './run-main.mjs'
import { loadRoles, parseCliJson, resolveConflicts } from './run-engine.mjs'
import { makeEventLog } from './run-waves.mjs'
import { contendingBlock as buildContendingBlock } from './publish-fold-block.mjs'

// Resolved against the ENGINE checkout, exactly as `runEngine` resolves it:
// the kernel ships with the code that is running, never with `--repo`.
const KERNEL = fileURLToPath(new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url))

const tail = (s, n = 400) => String(s || '').slice(-n)

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// The plan's H1, read the way `runEngine` reads it: the text after `# ` on the
// first line that begins that way. It titles the candidate commit, so a
// squash-merge of the folded head reads like the plan and not like a counter.
const planTitleOf = (planPath) => {
  if (!planPath) return undefined
  let text
  try { text = fs.readFileSync(planPath, 'utf8') } catch { return undefined }
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim() || undefined
  }
  return undefined
}

/**
 * One attempt of the publish fold.
 *
 *   repo         a full clone of the target with an `origin` remote — the
 *                sandbox's own working clone, where the branch lives
 *   base         BASE: the sha the run was cut from
 *   branch       `ultra/integration-run-<N>`
 *   run          this run's number
 *   runDir       `<repo>/.claude/ultrapowers/run-run-<N>`
 *   evidenceDir  the evidence worktree directory this run's receipts ride
 *   attempt      1 or 2
 *
 * `deps` are the three seams: `makeAgent` (the exam injects a stub resolver
 * exactly as runMain's seam is used), `exec` (every subprocess) and `rename`
 * (the only way the receipt's path is ever written).
 *
 * Resolves to the whole receipt document. It REJECTS only on a fault that is
 * not a disposition — a git call that throws, an unreadable run tree: the boot
 * script's non-zero branch then rewinds the branch and records `cannot fold`
 * itself. Every disposition this module names is a resolve.
 */
export async function publishFold (opts, deps = {}) {
  const { repo, base, branch, run, runDir, evidenceDir, attempt } = opts
  const {
    makeAgent = composeAgent,
    exec = execSeam,
    rename = fs.renameSync,
  } = deps

  const attemptKey = String(attempt)
  const attemptNum = Number(attemptKey)
  const foldEvidence = path.join(evidenceDir, 'publish-fold')
  const receiptPath = path.join(foldEvidence, 'receipt.json')
  const receiptTmp = receiptPath + '.tmp'
  const engineHeadPath = path.join(foldEvidence, 'engine-head')
  const foldRunDir = path.join(runDir, 'publish-fold')
  const waveDirOf = (a) => path.join(foldRunDir, 'frontier', 'wave-' + a)
  const evidenceWaveDirOf = (a) => path.join(foldEvidence, 'frontier', 'wave-' + a)
  const integ = path.join(runDir, 'clones', 'integration')

  // Resolves, never rejects — callers branch on `code`.
  const git = (argv, cwd = repo) => exec('git', argv, { cwd })
  // Throws on a non-zero exit: a git verb that fails here is a fault, not a
  // verdict, and the boot script's rewind is the right handler for it.
  const gitR = async (argv, cwd = repo) => {
    const r = await git(argv, cwd)
    if (r.code !== 0) {
      throw new Error('git ' + argv.join(' ') + ' exited ' + r.code + ' in ' + cwd +
        ': ' + tail(r.stderr || r.stdout))
    }
    return r
  }
  const gitOut = async (argv, cwd = repo) => (await gitR(argv, cwd)).stdout.trim()

  const eventLog = makeEventLog({
    file: path.join(runDir, 'events.jsonl'),
    runId: process.env.ULTRAPOWERS_FLEET_RUN || ('run-' + run),
    base,
    source: 'fleet/publish-fold.mjs',
  })

  // ── engine-head, before anything else ──────────────────────────────────────
  // The branch's sha as the ENGINE left it. Written once and never rewritten:
  // attempt 2 reads the same file, and so does a re-drive of attempt 1, because
  // the floor a rewind aims at must not move when the branch does.
  fs.mkdirSync(foldEvidence, { recursive: true })
  let engineHead = ''
  try { engineHead = fs.readFileSync(engineHeadPath, 'utf8').trim() } catch { engineHead = '' }
  if (!engineHead) {
    engineHead = await gitOut(['rev-parse', '--verify', 'refs/heads/' + branch])
    // No trailing newline: this file IS the sha, and a reader that does not
    // trim must still get one.
    fs.writeFileSync(engineHeadPath, engineHead)
  }

  // ── the receipt, read before any fetch of the default branch ───────────────
  let rawReceipt = null
  try { rawReceipt = fs.readFileSync(receiptPath, 'utf8') } catch { rawReceipt = null }
  let parsedReceipt = null
  let unparsable = false
  if (rawReceipt !== null) {
    try {
      const doc = JSON.parse(rawReceipt)
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('not an object')
      parsedReceipt = doc
    } catch { unparsable = true }
  }
  // A tmp left by a killed writer is the folder's own litter, never evidence:
  // it dies at re-entry rather than being renamed over the receipt.
  fs.rmSync(receiptTmp, { force: true })

  let receipt = parsedReceipt || { engineHead, attempts: {} }
  if (!receipt.attempts || typeof receipt.attempts !== 'object' || Array.isArray(receipt.attempts)) {
    receipt.attempts = {}
  }
  // What is on disk right now, semantically. A write that would not change the
  // document is not made at all: a pure replay must leave the receipt's bytes
  // exactly as it found them.
  let onDisk = (parsedReceipt && !unparsable) ? JSON.stringify(receipt) : null

  const writeReceipt = () => {
    const now = JSON.stringify(receipt)
    if (now === onDisk) return
    onDisk = now
    fs.writeFileSync(receiptTmp, JSON.stringify(receipt, null, 2) + '\n')
    rename(receiptTmp, receiptPath)
  }

  const rowOf = (a) => {
    const key = String(a)
    const row = receipt.attempts[key]
    if (!row || typeof row !== 'object' || Array.isArray(row)) receipt.attempts[key] = {}
    return receipt.attempts[key]
  }
  const peek = (a) => {
    const row = receipt.attempts[String(a)]
    return (row && typeof row === 'object' && !Array.isArray(row)) ? row : null
  }

  // The kernel's wave directory, copied whole (reply directories included) into
  // the evidence tree at the end of EVERY attempt, whatever it decided.
  const collectWave = () => {
    const src = waveDirOf(attemptKey)
    if (!fs.existsSync(src)) return
    const dest = evidenceWaveDirOf(attemptKey)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
  }

  const conflictsIndex = () => {
    const entries = readJson(path.join(waveDirOf(attemptKey), 'conflicts.json'))
    return Array.isArray(entries) ? entries : []
  }

  // ── the integration clone ──────────────────────────────────────────────────
  // The resolver reads TIP's tree there and the suite runs the candidate's
  // there. Both borrow the clone; neither keeps it. `integHead` is the clone's
  // own head, captured before the first borrow and put back on every exit.
  let integHead = ''
  let integBorrowed = false
  const borrowInteg = async () => {
    if (!integHead) integHead = await gitOut(['rev-parse', 'HEAD'], integ)
    integBorrowed = true
  }
  const restoreInteg = async () => {
    if (!integBorrowed) return
    integBorrowed = false
    await gitR(['reset', '--hard', integHead], integ)
  }

  // ── the one record ─────────────────────────────────────────────────────────
  const record = (fields) => {
    const {
      disposition, reason, conflictPath, candidate, pushedHead = '', suite = 'none',
      tip = '', pathsJoined = 0, pathsConflicted = 0,
      resolversDispatched = 0, resolverRetries = 0,
    } = fields
    const row = rowOf(attemptKey)
    if (tip) row.tip = tip
    row.candidate = candidate
    // Only the unparsable-receipt row carries one: elsewhere the folder is not
    // what pushed, so it has nothing to say about the remote's head.
    if (pushedHead) row.pushedHead = pushedHead
    row.disposition = disposition
    if (reason) row.reason = reason
    if (conflictPath) row.path = conflictPath
    row.pathsJoined = pathsJoined
    row.resolversDispatched = resolversDispatched
    row.suite = suite
    writeReceipt()
    collectWave()
    eventLog.onEvent({
      kind: 'driver:publish-fold',
      run, attempt, base, tip, candidate,
      pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
      suite, disposition,
    })
    return receipt
  }

  // ── the resolver's agent ───────────────────────────────────────────────────
  // Built from the run directory the way `runMain` builds it, and built LAZILY:
  // a fold with nothing to dispatch must not write preambles, roles or worker
  // directories it will never use. No token in any argv — the credentials are
  // the environment the unit handed this process — and `CLAUDE_CONFIG_DIR` is
  // the run tree's own `claude/`.
  const buildAgent = () => {
    const clonesDir = path.join(runDir, 'clones')
    const patchesDir = path.join(runDir, 'patches')
    const workersDir = path.join(runDir, 'workers')
    for (const d of [patchesDir, workersDir, path.join(runDir, 'claude')]) {
      fs.mkdirSync(d, { recursive: true })
    }
    const promptFileFor = writeRoleFiles(path.join(runDir, 'preambles'))
    copyEngineRoles(path.join(runDir, 'roles'))
    const settingsFor = writeConfineSettings({
      runDir, hookPath: path.join(ENGINE_DIR, 'fleet/confine-hook.mjs'),
    })
    const made = makeAgent({
      runId: process.env.ULTRAPOWERS_FLEET_RUN || ('run-' + run),
      base: () => base,
      runDir, clonesDir, patchesDir, workersDir,
      promptFileFor, settingsFor,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: path.join(runDir, 'claude'),
        FLEET_RUN_DIR: runDir,
        DISABLE_AUTOUPDATER: '1',
      },
      cli: 'claude',
      eventLog,
    })
    return (made && typeof made === 'object' && typeof made.agent === 'function')
      ? made.agent
      : made
  }

  try {
    // ── re-entry: an unparsable receipt ──────────────────────────────────────
    // The document is gone, so what the remote holds is the only witness of
    // what this run published. `git fetch origin <branch>` leaves it in the
    // clone's `refs/remotes/origin/<branch>`; with no such branch on the
    // origin, nothing was ever pushed and the engine's head is the floor.
    if (unparsable) {
      const fetched = await git(['fetch', 'origin', branch])
      let pushedHead = ''
      if (fetched.code === 0) {
        const rp = await git(['rev-parse', '--verify', 'refs/remotes/origin/' + branch])
        if (rp.code === 0) pushedHead = rp.stdout.trim()
      }
      const candidate = pushedHead || engineHead
      // Replaced whole, through the same tmp + rename: a document nothing can
      // parse is not repaired in place.
      receipt = { engineHead, attempts: {} }
      onDisk = null
      await gitR(['update-ref', 'refs/heads/' + branch, candidate])
      return record({
        disposition: 'cannot fold', reason: 'receipt unparsable', candidate, pushedHead,
      })
    }

    if (receipt.engineHead !== engineHead) receipt.engineHead = engineHead

    // ── re-entry: discard every dangling attempt ─────────────────────────────
    // A row with a `tip` and no `disposition` is an attempt that died mid-fold.
    // Its wave directory holds a `fold_log.jsonl` the kernel would refuse to
    // fold over (exit 2), so the directory goes — in the run tree AND in the
    // evidence tree, which is a copy of it — and the row goes with it.
    for (const key of Object.keys(receipt.attempts)) {
      const row = peek(key)
      if (!row || row.tip == null || row.disposition != null) continue
      fs.rmSync(waveDirOf(key), { recursive: true, force: true })
      fs.rmSync(evidenceWaveDirOf(key), { recursive: true, force: true })
      delete receipt.attempts[key]
    }

    // ── re-entry: replay a completed attempt ────────────────────────────────
    // Keyed on `disposition`, never on a lock file: an attempt at or above the
    // invoked one already decided, so this invocation restores the branch to
    // the highest such candidate and exits with that disposition. Nothing is
    // dispatched and the kernel is not invoked.
    const decided = Object.keys(receipt.attempts)
      .filter((k) => Number(k) >= attemptNum && peek(k) && peek(k).disposition)
      .map(Number).sort((a, b) => a - b)
    if (decided.length) {
      const top = String(decided[decided.length - 1])
      const row = peek(top)
      if (row.candidate) await gitR(['update-ref', 'refs/heads/' + branch, row.candidate])
      writeReceipt()
      collectWave()
      eventLog.onEvent({
        kind: 'driver:publish-fold',
        run, attempt, base,
        tip: row.tip || '',
        candidate: row.candidate || '',
        pathsJoined: typeof row.pathsJoined === 'number' ? row.pathsJoined : 0,
        pathsConflicted: 0,
        resolversDispatched: typeof row.resolversDispatched === 'number' ? row.resolversDispatched : 0,
        resolverRetries: 0,
        suite: row.suite || 'none',
        disposition: row.disposition,
      })
      return receipt
    }

    // The engineHead mirror lands before the first fetch, so a folder that dies
    // in step 1 still leaves a receipt naming the floor.
    writeReceipt()

    // ── step 1: the default branch, and TIP ─────────────────────────────────
    const sym = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const defaultBranch = sym.code === 0
      ? sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
      : 'main'
    await gitR(['fetch', 'origin', defaultBranch])
    const tip = await gitOut(['rev-parse', 'refs/remotes/origin/' + defaultBranch])
    // WRITTEN HERE, before any comparison: a folder that dies between the fetch
    // and its verdict has to leave behind which tip it was looking at, or
    // re-entry cannot tell a dangling attempt from one that never started.
    rowOf(attemptKey).tip = tip
    writeReceipt()

    // The sha the branch must hold after this attempt when the fold does not
    // produce one: the engine's head on attempt 1, the previous attempt's
    // candidate on attempt 2 (the folded head that was pushed and opened the PR).
    const priorKeys = Object.keys(receipt.attempts)
      .map(Number).filter((n) => n < attemptNum).sort((a, b) => a - b)
    const prior = priorKeys.length ? peek(String(priorKeys[priorKeys.length - 1])) : null
    const floor = (prior && prior.candidate) || engineHead

    // ── attempt 2 on an unmoved tip ─────────────────────────────────────────
    // Nothing moved since the attempt that already folded: re-folding would
    // rebuild the same candidate under a fresh wave number for no gain.
    if (prior && prior.tip && prior.tip === tip) {
      return record({ disposition: 'tip unmoved', candidate: floor, tip })
    }

    // ── TIP == BASE: nothing to join ────────────────────────────────────────
    if (tip === base) {
      return record({ disposition: 'nothing to join', candidate: engineHead, tip })
    }

    // ── the ancestry precondition ───────────────────────────────────────────
    const ancestry = await git(['merge-base', '--is-ancestor', base, tip])
    if (ancestry.code !== 0) {
      return record({
        disposition: 'cannot fold',
        reason: 'ancestry: BASE ' + base + ' is not an ancestor of the default branch tip ' +
          tip + ' — the branch this run was cut from is not on that history, so main since ' +
          'BASE is not a diff the fold can take',
        candidate: floor,
        tip,
      })
    }

    // ── step 2: the two patches ─────────────────────────────────────────────
    // One argv shape, one range word: main's move and this run's whole result,
    // both against BASE, so the kernel sees two peers rather than a rebase.
    const mainPatch = path.join(foldEvidence, 'main.patch')
    const runPatch = path.join(foldEvidence, 'run.patch')
    const diffArgv = (range) => ['diff', '--binary', '--full-index', '--no-renames', range]
    fs.writeFileSync(mainPatch, (await gitR(diffArgv(base + '..' + tip))).stdout)
    fs.writeFileSync(runPatch, (await gitR(diffArgv(base + '..' + engineHead))).stdout)

    const pathsOf = async (file) => {
      const set = new Set()
      let size = 0
      try { size = fs.statSync(file).size } catch { size = 0 }
      if (!size) return set
      const r = await gitR(['apply', '--numstat', file])
      for (const line of r.stdout.split('\n')) {
        const cols = line.split('\t')
        if (cols.length < 3) continue
        const p = cols.slice(2).join('\t').trim()
        if (p) set.add(p)
      }
      return set
    }
    const mainPaths = await pathsOf(mainPatch)
    const runPaths = await pathsOf(runPatch)
    // Disjoint sides still fold: an empty intersection is a fact about the two
    // patches, never a refusal.
    let pathsJoined = 0
    for (const p of runPaths) if (mainPaths.has(p)) pathsJoined += 1

    // ── step 3: the kernel ──────────────────────────────────────────────────
    const runCli = async (argv) => {
      const r = await exec('python3', [KERNEL, ...argv], { cwd: repo })
      return { ...r, parsed: parseCliJson(r.stdout) }
    }
    const common = ['--repo', repo, '--run-dir', foldRunDir, '--wave', attemptKey]
    // main FIRST: the frontier side of every hunk is main since BASE, and the
    // incoming side is this run — which is what the resolver is told.
    const taskArgs = ['--patch', 'main=' + mainPatch, '--patch', 'run-' + run + '=' + runPatch]
    // Never any: `--commutes` licenses an auto-union from a task's own
    // declaration, and a cross-run frontier has no such declaration to read.
    const commutesArgs = []

    const fold = await runCli(['fold', ...common, '--base', base, ...taskArgs])
    const f = fold.parsed
    const parked = (reason, conflictPath, extra = {}) => record({
      disposition: 'conflict parked', reason, conflictPath, candidate: floor, tip,
      pathsJoined, pathsConflicted: conflictsIndex().length, ...extra,
    })
    const cannot = (reason, extra = {}) => record({
      disposition: 'cannot fold', reason, candidate: floor, tip,
      pathsJoined, pathsConflicted: conflictsIndex().length, ...extra,
    })

    if (!f) {
      return cannot('fold printed no verdict (exit ' + fold.code + '): ' + tail(fold.stderr))
    }
    if (typeof f.parked === 'number' && f.parked > 0) {
      // The kernel narrated a stop no resolver can drain: two sides on one
      // binary path, a delete/modify pairing, a kernel-limit park. The
      // conflicted path is read off the index it wrote, never guessed.
      const entry = conflictsIndex().find((e) => e && e.dispatchable === false) || conflictsIndex()[0]
      return parked('fold parked ' + f.parked + ' conflict(s) — ' +
        ((entry && entry.reason) || 'see the conflicts index'), entry && entry.path)
    }
    if (fold.code !== 0 && !(Array.isArray(f.open) && f.open.length)) {
      return cannot('fold exited ' + fold.code + ': ' + (f.selfChecks || tail(fold.stderr)))
    }
    if (typeof f.conflicts !== 'number') {
      return cannot('fold reported no conflicts count to verify against')
    }
    const open = Array.isArray(f.open) ? f.open.slice() : []
    if (f.conflicts > 0 && open.length === 0) {
      return cannot('fold counted ' + f.conflicts + ' conflict(s) but named none to resolve')
    }
    const expectOpen = (typeof f.dispatchable === 'number') ? f.dispatchable : f.conflicts
    if (open.length !== expectOpen) {
      return cannot('fold named ' + open.length + ' open conflict(s) but counted ' +
        expectOpen + ' still to resolve')
    }
    if (open.length === 0 && f.complete !== true) {
      return cannot('fold reported no conflicts but did not complete (selfChecks: ' +
        (f.selfChecks || 'absent') + ')')
    }

    // ── step 4: the resolvers ───────────────────────────────────────────────
    let resolversDispatched = 0
    let resolverRetries = 0
    if (open.length) {
      // The brief, per conflicted path, concatenated in the kernel's own `open`
      // order — `resolveConflicts` briefs every dispatch of a multi-path stop
      // with ONE string, so a two-path stop's block is the two blocks whole,
      // first path first. The folder prepends and appends nothing.
      const launch = readJson(path.join(runDir, 'launch.json'))
      const tasks = Array.isArray(launch && launch.tasks) ? launch.tasks : []
      const blocks = []
      for (const c of open) {
        blocks.push(await buildContendingBlock({ repo, base, tip, run, path: c.path, tasks }))
      }
      const block = blocks.join('')

      // TIP's tree, in the clone the resolver runs in: the frontier side of
      // every hunk is main since BASE, so the tree a resolver can open has to
      // be main's. `read-tree -u --reset` lays the tree down; the `reset --hard`
      // that follows puts the clone's own head on it, so `HEAD^{tree}` in the
      // resolver's cwd IS the tip's tree rather than the base it was cut at.
      await borrowInteg()
      await gitR(['fetch', repo, 'refs/remotes/origin/' + defaultBranch], integ)
      await gitR(['read-tree', '-u', '--reset', tip + '^{tree}'], integ)
      await gitR(['reset', '--hard', tip], integ)

      const roles = loadRoles()
      const dispatch = buildAgent()
      // The brief a resolver was handed IS the record of what it was asked, so
      // it is saved beside the reply directory it wrote, under the same `<i>`
      // the kernel's index gave the conflict.
      const agent = async (prompt, agentOpts) => {
        const m = /:(\d+):(\d+)$/.exec(String((agentOpts && agentOpts.label) || ''))
        if (m) {
          fs.writeFileSync(
            path.join(foldEvidence, 'resolver-brief-' + m[1] + '-' + attemptKey + '.txt'), prompt)
        }
        return dispatch(prompt, agentOpts)
      }

      const resolution = await resolveConflicts({
        agent, runCli, roles, common, taskArgs, commutesArgs,
        open, contendingBlock: block,
        waveDir: waveDirOf(attemptKey),
        labelPrefix: 'resolve:publish-fold:' + attemptKey,
      })
      resolversDispatched = resolution.transcripts.length
      resolverRetries = resolution.transcripts.filter((t) => t.attempt === 2).length
      if (!resolution.ok) {
        const last = resolution.transcripts[resolution.transcripts.length - 1]
        await restoreInteg()
        return parked(resolution.reason, (last && last.path) || open[0].path,
          { resolversDispatched, resolverRetries })
      }
      await restoreInteg()
    }

    // ── step 5: the candidate ───────────────────────────────────────────────
    const args = readJson(path.join(runDir, 'args.json')) || {}
    const planTitle = planTitleOf(
      typeof args.planPath === 'string' && args.planPath.trim() ? args.planPath : undefined)
    const subjectArgs = planTitle ? ['--subject', planTitle] : []
    const mat = await runCli(['materialize', ...common, '--prev-head', tip, ...taskArgs, ...subjectArgs])
    const m = mat.parsed
    const pathsConflicted = conflictsIndex().length
    if (!m || !m.candidateSha) {
      // A `park` here is the cross-run chmod shape: a path whose mode on main
      // since BASE differs from the mode this run's side carries. The kernel's
      // own reason is the reason, verbatim.
      return record({
        disposition: 'cannot fold',
        reason: (m && (m.park || m.fallback)) || ('materialize refused (exit ' + mat.code +
          '): ' + tail(mat.stderr)),
        candidate: floor, tip, pathsJoined, pathsConflicted,
        resolversDispatched, resolverRetries,
      })
    }
    const candidate = m.candidateSha
    // The branch moves BEFORE the suite: the suite measures the candidate, and
    // a red suite leaves the branch on it so the PR shows what failed.
    await gitR(['update-ref', 'refs/heads/' + branch, candidate])

    // ── step 6: the suite, on the candidate, in the integration clone ───────
    const testCmd = (typeof args.testCmd === 'string' && args.testCmd.trim()) ? args.testCmd : ''
    if (!testCmd) {
      return record({
        disposition: 'folded', candidate, tip, suite: 'none',
        pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
      })
    }
    await borrowInteg()
    // By NAME, not by sha: the integration clone was cut `--local` at BASE and
    // holds neither the tip nor the candidate, and a bare sha is not advertised
    // under every protocol.
    await gitR(['fetch', '--no-tags', repo, 'refs/heads/' + branch], integ)
    await gitR(['read-tree', '-u', '--reset', candidate + '^{tree}'], integ)
    const suite = await exec('bash', ['-lc', testCmd], { cwd: integ })
    fs.writeFileSync(path.join(foldEvidence, 'suite-' + attemptKey + '.txt'),
      String(suite.stdout || '') + String(suite.stderr || ''))
    await restoreInteg()

    return record({
      disposition: suite.code === 0 ? 'folded' : 'suite red',
      ...(suite.code === 0 ? {} : { reason: 'the candidate\'s suite exited ' + suite.code }),
      candidate, tip, suite: suite.code === 0 ? 'pass' : 'fail',
      pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
    })
  } finally {
    // Every exit, parked dispositions included: the integration clone is
    // borrowed, never kept.
    try { await restoreInteg() } catch { /* the clone is a scratch tree */ }
  }
}

// ── the CLI ──────────────────────────────────────────────────────────────────
// One attempt per invocation, exit 0 for every disposition it names. The
// disposition is in the receipt; stdout is narration and nothing reads it.

export const usage = () =>
  'usage: node fleet/publish-fold.mjs --repo DIR --base SHA --branch NAME --run N ' +
  '--run-dir DIR --evidence-dir DIR --attempt 1|2'

export function parseArgs (argv) {
  const KEYS = {
    '--repo': 'repo', '--base': 'base', '--branch': 'branch', '--run': 'run',
    '--run-dir': 'runDir', '--evidence-dir': 'evidenceDir', '--attempt': 'attempt',
  }
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const key = KEYS[argv[i]]
    if (!key) throw new Error('publish-fold: unknown argument "' + argv[i] + '"\n' + usage())
    if (i + 1 >= argv.length) throw new Error('publish-fold: ' + argv[i] + ' needs a value\n' + usage())
    out[key] = argv[++i]
  }
  for (const [flag, key] of Object.entries(KEYS)) {
    if (!out[key]) throw new Error('publish-fold: ' + flag + ' is required\n' + usage())
  }
  out.repo = path.resolve(out.repo)
  out.runDir = path.resolve(out.runDir)
  out.evidenceDir = path.resolve(out.evidenceDir)
  return out
}

export async function main (argv = process.argv.slice(2), deps = {}) {
  const opts = parseArgs(argv)
  const receipt = await publishFold(opts, deps)
  const row = (receipt && receipt.attempts && receipt.attempts[String(opts.attempt)]) || {}
  console.error('publish-fold: attempt ' + opts.attempt + ' — ' +
    (row.disposition || '(no disposition)') + (row.reason ? (' — ' + row.reason) : ''))
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => { process.exitCode = code }, (e) => {
    console.error('publish-fold: ' + String((e && e.stack) || e))
    process.exitCode = 1
  })
}

export default publishFold
