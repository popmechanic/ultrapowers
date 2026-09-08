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
import {
  contendingBlock as buildContendingBlock, contendingTasks,
} from './publish-fold-block.mjs'
// The one rule for where a run's exams land, shared with the engine's handoff
// and `strip-exams.sh` so the writer and this reader cannot drift (#777).
import { reservedExamPath } from './exam-paths.mjs'

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

// ── the candidate's checks (#751) ────────────────────────────────────────────
// A check is a function of the joined files alone: no model, and never the
// whole suite. The folder runs the whole list, in order, on every candidate it
// materializes — BEFORE it spends the suite — so a candidate that cannot even
// be parsed costs a parser invocation rather than a full test run, and one whose
// joined paths fail their own exams (#754) costs those exams rather than all of
// them.
//
// `ctx` is
//   { repo, base, tip, run, tasks, candidate, joined, conflicted, integ, exec,
//     foldEvidence, attemptKey }
// with `joined` the ordered joined paths, `conflicted` the paths carrying a
// `conflicts.json` entry and `integ` the integration clone already laid on the
// candidate's tree. `run(ctx)` resolves either
//   { ok: true, checks }
// or
//   { ok: false, checks, path, message, disposition, reason }
// — the folder appends `checks` to the receipt row either way, and on
// `ok: false` either retries that path's resolver once (when the path is one a
// resolver owns and has not been retried this attempt) or records the
// disposition and the reason and runs no suite.

/**
 * The parse command for a joined path, by extension, as an argv — or `null`
 * for a path no parser owns, for which nothing is run at all.
 */
export function parseArgvFor (p) {
  const file = String(p == null ? '' : p)
  const ext = (/\.[^./\\]*$/.exec(file) || [''])[0].toLowerCase()
  if (ext === '.mjs' || ext === '.js') return ['node', '--check', file]
  if (ext === '.sh') return ['bash', '-n', file]
  if (ext === '.py') return ['python3', '-m', 'py_compile', file]
  return null
}

export const PARSE_CHECK = {
  name: 'parse',
  run: async (ctx) => {
    const checks = []
    for (const p of ctx.joined) {
      const argv = parseArgvFor(p)
      if (!argv) continue
      const r = await ctx.exec(argv[0], argv.slice(1), { cwd: ctx.integ })
      const ok = Boolean(r) && r.code === 0
      checks.push({ check: 'parse', path: p, result: ok ? 'pass' : 'fail' })
      if (ok) continue
      return {
        ok: false,
        checks,
        path: p,
        // What the parser said, which is what the re-briefed resolver is told.
        message: tail(String((r && r.stderr) || '') + String((r && r.stdout) || '')),
        disposition: 'cannot fold',
        reason: p + ' does not parse',
      }
    }
    return { ok: true, checks }
  },
}

// ── the exam check (#754) ────────────────────────────────────────────────────
// A joined path is a path two runs both wrote, and the run that wrote main's
// side left behind the exam that stands for it: the `- Test:` bullets of the
// Proof slot in the task whose Files name that path. Those exams are the
// cheapest true measurement of the candidate there is — they are about the very
// file the fold just joined — so they run after the parse check and before the
// whole suite, and a red one is `suite red` without ever spending the suite.

/**
 * The exam paths a task body names: the `- Test:` bullets of its `**Proof:**`
 * slot, in the body's own order, backticks stripped.
 *
 * The slot runs from the `**Proof:**` line to the line before the first later
 * line beginning `**Stale-if:**`, or to the body's end. That boundary is the
 * whole reason this is a reader and not a grep: a `Stale-if:` predicate may
 * name a path in the same bullet shape, and it is a staleness condition rather
 * than an exam. A body with no `**Proof:**` line names none.
 */
export function proofExams (body) {
  const lines = String(body == null ? '' : body).split('\n')
  const start = lines.findIndex((l) => l.startsWith('**Proof:**'))
  if (start < 0) return []
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('**Stale-if:**')) { end = i; break }
  }
  const exams = []
  for (const line of lines.slice(start, end)) {
    const m = /^\s*-\s*Test:\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const exam = m[1].replace(/`/g, '').trim()
    if (exam) exams.push(exam)
  }
  return exams
}

/**
 * The command that runs one exam, as an argv — or `null` for an exam whose
 * extension no runner owns, which is recorded and not run.
 */
export function examArgvFor (exam) {
  const file = String(exam == null ? '' : exam)
  if (/\.test\.ts$/i.test(file)) return ['bun', 'test', file]
  const ext = (/\.[^./\\]*$/.exec(file) || [''])[0].toLowerCase()
  if (ext === '.mjs' || ext === '.js') return ['node', file]
  if (ext === '.py') return ['python3', '-m', 'pytest', '-q', file]
  return null
}

// `n` counts every exam RUN in the attempt, across both passes of a retry, so
// it is read off the evidence directory rather than kept in a closure the retry
// rebuilds: the first pass's `exam-1-1.txt` is the red output a reader goes
// looking for, and the second pass's runs continue the sequence.
const nextExamIndex = (dir, attemptKey) => {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return 1 }
  const re = new RegExp('^exam-' + String(attemptKey).replace(/[^A-Za-z0-9_-]/g, '.') +
    '-(\\d+)\\.txt$')
  let max = 0
  for (const name of names) {
    const m = re.exec(name)
    if (m && Number(m[1]) > max) max = Number(m[1])
  }
  return max + 1
}

export const EXAM_CHECK = {
  name: 'exam',
  run: async (ctx) => {
    const checks = []
    // Each exam ONCE per pass, in first-seen order, under the joined path that
    // brought it: one task can name an exam for two joined paths, and running
    // it twice would say nothing the first run did not.
    const seen = new Set()
    let n = nextExamIndex(ctx.foldEvidence, ctx.attemptKey)
    for (const p of ctx.joined) {
      const contenders = await contendingTasks({
        repo: ctx.repo, base: ctx.base, tip: ctx.tip, run: ctx.run, path: p, tasks: ctx.tasks,
      })
      for (const { run: contenderRun, task } of contenders) {
        for (const exam of proofExams(task && task.body)) {
          // A Proof names the path its exam was written FOR; the engine's
          // handoff writes it to the reserved directory of the run that
          // produced it, so the fold looks there FIRST — under the contender's
          // OWN run, which for a main-side task is the number its frontier
          // commit carries. The Proof path is the fallback: a `Guard:` exam
          // keeps its own path, and a path under neither test root maps to
          // itself, which is why the rig's root-level exams are unaffected.
          const landed = reservedExamPath(exam, 'run-' + contenderRun)
          const where = [landed, exam].find(
            (c) => fs.existsSync(path.join(ctx.integ, c)))
          if (!where) {
            // Present at neither path — a main-side run's exams were stripped
            // onto its evidence tag when it published, so they ride no later
            // tree. That is recorded, not run, and is not a red: the fold
            // cannot measure what was never meant to be here, and the seam it
            // covered stays with CI on the merge commit (#767 decision 1).
            if (seen.has(exam)) continue
            seen.add(exam)
            checks.push({ check: 'exam', exam, path: p, result: 'skipped' })
            continue
          }
          // Deduped by the path actually run, so one task naming one exam for
          // two joined paths still runs it once.
          if (seen.has(where)) continue
          seen.add(where)
          const argv = examArgvFor(where)
          if (!argv) {
            checks.push({ check: 'exam', exam: where, path: p, result: 'skipped' })
            continue
          }
          const r = await ctx.exec(argv[0], argv.slice(1), { cwd: ctx.integ })
          const out = String((r && r.stdout) || '') + String((r && r.stderr) || '')
          fs.writeFileSync(
            path.join(ctx.foldEvidence, 'exam-' + ctx.attemptKey + '-' + n + '.txt'), out)
          n += 1
          const ok = Boolean(r) && r.code === 0
          // The recorded `exam` is the path that ran, not the path the Proof
          // named: a reader following the receipt to a file must find one.
          checks.push({ check: 'exam', exam: where, path: p, result: ok ? 'pass' : 'fail' })
          if (ok) continue
          // The first red exam stops the pass: the candidate has already been
          // measured false, and the exams after it would measure the same one.
          return {
            ok: false,
            checks,
            path: p,
            exam: where,
            message: tail(out),
            disposition: 'suite red',
            reason: where + ' red on ' + p,
          }
        }
      }
    }
    return { ok: true, checks }
  },
}

export const CANDIDATE_CHECKS = [PARSE_CHECK, EXAM_CHECK]

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
      checks = [], checkRetries = 0,
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
    // The candidate checks (#751): every entry every pass appended, in order,
    // and the number of resolvers a red check sent back. Both stand on every
    // row — `[]` and 0 on a fold with no joined path.
    row.checks = checks
    row.checkRetries = checkRetries
    writeReceipt()
    collectWave()
    eventLog.onEvent({
      kind: 'driver:publish-fold',
      run, attempt, base, tip, candidate,
      ...(reason ? { reason } : {}),
      pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
      suite, disposition, checks, checkRetries,
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
        ...(row.reason ? { reason: row.reason } : {}),
        pathsJoined: typeof row.pathsJoined === 'number' ? row.pathsJoined : 0,
        pathsConflicted: 0,
        resolversDispatched: typeof row.resolversDispatched === 'number' ? row.resolversDispatched : 0,
        resolverRetries: 0,
        suite: row.suite || 'none',
        disposition: row.disposition,
        // Replayed, never recomputed: a re-entry re-reads the row it found, so
        // a row written before #751 stays a row without these two.
        ...(Array.isArray(row.checks) ? { checks: row.checks } : {}),
        ...(typeof row.checkRetries === 'number' ? { checkRetries: row.checkRetries } : {}),
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
    // patches, never a refusal. `joined` keeps run.patch's own path order —
    // the order the candidate's checks run in.
    const joined = [...runPaths].filter((p) => mainPaths.has(p))
    const pathsJoined = joined.length

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

    // Everything the pass below reads out of the run tree, read once.
    const launch = readJson(path.join(runDir, 'launch.json'))
    const tasks = Array.isArray(launch && launch.tasks) ? launch.tasks : []
    const args = readJson(path.join(runDir, 'args.json')) || {}
    const planTitle = planTitleOf(
      typeof args.planPath === 'string' && args.planPath.trim() ? args.planPath : undefined)
    const subjectArgs = planTitle ? ['--subject', planTitle] : []
    const testCmd = (typeof args.testCmd === 'string' && args.testCmd.trim()) ? args.testCmd : ''

    // The tallies a pass adds to. `resolversDispatched` counts REAL dispatches
    // (a replayed reply is not one); `resolverRetries` keeps its meaning — the
    // replies the kernel rejected; `checkRetries` is the new counter, the
    // number of times a red check sent a resolver back.
    let resolversDispatched = 0
    let resolverRetries = 0
    let checks = []
    let checkRetries = 0
    const retriedPaths = new Set()

    const parked = (reason, conflictPath) => record({
      disposition: 'conflict parked', reason, conflictPath, candidate: floor, tip,
      pathsJoined, pathsConflicted: conflictsIndex().length,
      resolversDispatched, resolverRetries, checks, checkRetries,
    })
    const cannot = (reason) => record({
      disposition: 'cannot fold', reason, candidate: floor, tip,
      pathsJoined, pathsConflicted: conflictsIndex().length,
      resolversDispatched, resolverRetries, checks, checkRetries,
    })

    // ── the re-brief a red check writes ─────────────────────────────────────
    // Appended AFTER the contending block, so the retry's prompt begins with
    // the bytes of the brief the same resolver already answered.
    // An exam check names the exam that went red as well as the path: the
    // resolver's own file is the path, but what it has to satisfy is the exam,
    // and `exam_main.mjs` is a name it can open in its own clone.
    const failedCheckSection = (r) =>
      '\n\nPREVIOUS RESOLUTION FAILED A CHECK\n' +
      'Your previous resolution was folded into the candidate, and ' + r.path +
      ' then failed the ' + r.check + ' check there' +
      (r.exam ? ' — the exam ' + r.exam + ' exited non-zero on it' : '') +
      '. The checker said:\n\n' +
      r.message + '\n\n' +
      'Resolve the same hunks again so that ' + r.path + ' passes that check. ' +
      'Nothing else about this conflict has changed.\n'

    // ── the reply a replayed conflict gives back ────────────────────────────
    // A retry re-folds the WHOLE wave, so the kernel narrates every conflict
    // again — but only the red path's resolver is asked again. Every other
    // conflict answers out of the reply directory it already wrote, matched by
    // path (never by `i`), with no dispatch.
    const replayReply = (r, conflictPath) => {
      const entry = (r.index || []).find((e) => e && e.path === conflictPath)
      if (!entry) return null
      let names = []
      try { names = fs.readdirSync(r.waveDir) } catch { return null }
      const re = new RegExp('^reply-' + entry.i + '-(\\d+)$')
      let dir = ''
      let best = -1
      for (const name of names) {
        const m = re.exec(name)
        if (m && Number(m[1]) > best) { best = Number(m[1]); dir = path.join(r.waveDir, name) }
      }
      if (!dir) return null
      const hunks = []
      let notes = ''
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith('.txt')) continue
        const content = fs.readFileSync(path.join(dir, file), 'utf8')
        // `resolveConflicts` writes `notes.txt` as the notes plus one newline
        // and each hunk file newline-terminated: the notes are handed back
        // without that newline and the hunks with theirs, so the reply
        // directory the replay produces is the one it was read from, byte for
        // byte.
        if (file === 'notes.txt') { notes = content.replace(/\n$/, ''); continue }
        hunks.push({ id: file.slice(0, -'.txt'.length), content })
      }
      return { status: 'RESOLVED', hunks, notes }
    }

    // ── the pass: the kernel, the resolvers, the candidate, the checks ──────
    // Run once, and once more when a check goes red on a path a resolver owns
    // and has not already been sent back this attempt. A retry re-runs the
    // check list from its first entry on the new candidate, so a candidate is
    // only ever measured whole.
    let retry = null   // { path, check, exam, message, index, waveDir }
    for (;;) {
      if (retry) {
        // `cmd_fold` refuses a wave whose `fold_log.jsonl` exists and
        // `cmd_resolve` refuses an applied conflict, so the fold is re-driven
        // from a FRESH wave directory: the one that produced the red candidate
        // is kept whole in the evidence tree and removed from the run tree.
        const kept = evidenceWaveDirOf(attemptKey + '-retried')
        fs.rmSync(kept, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(kept), { recursive: true })
        fs.cpSync(waveDirOf(attemptKey), kept, { recursive: true })
        fs.rmSync(waveDirOf(attemptKey), { recursive: true, force: true })
        retry.waveDir = kept
        checkRetries += 1
        retriedPaths.add(retry.path)
        await restoreInteg()
      }

      // ── step 3: the kernel ────────────────────────────────────────────────
      const fold = await runCli(['fold', ...common, '--base', base, ...taskArgs])
      const f = fold.parsed

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

      // ── step 4: the resolvers ─────────────────────────────────────────────
      if (open.length) {
        // The brief, per conflicted path, concatenated in the kernel's own
        // `open` order — `resolveConflicts` briefs every dispatch of a
        // multi-path stop with ONE string, so a two-path stop's block is the
        // two blocks whole, first path first. The folder prepends nothing, and
        // appends only the re-brief a red check earned.
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
        // the kernel's index gave the conflict. On a retry only the red path is
        // asked again, under `-retry`, so the first pass's brief stands.
        const agent = async (prompt, agentOpts) => {
          const m = /:(\d+):(\d+)$/.exec(String((agentOpts && agentOpts.label) || ''))
          const i = m ? m[1] : ''
          const entry = i ? conflictsIndex().find((e) => e && String(e.i) === i) : null
          const conflictPath = (entry && entry.path) || ''
          if (retry && conflictPath && conflictPath !== retry.path) {
            const replayed = replayReply(retry, conflictPath)
            if (replayed) return replayed
          }
          const text = (retry && conflictPath === retry.path)
            ? prompt + failedCheckSection(retry)
            : prompt
          if (i) {
            fs.writeFileSync(path.join(foldEvidence, 'resolver-brief-' + i + '-' + attemptKey +
              (retry ? '-retry' : '') + '.txt'), text)
          }
          const reply = await dispatch(text, agentOpts)
          if (reply) resolversDispatched += 1
          return reply
        }

        const resolution = await resolveConflicts({
          agent, runCli, roles, common, taskArgs, commutesArgs,
          open, contendingBlock: block,
          waveDir: waveDirOf(attemptKey),
          labelPrefix: 'resolve:publish-fold:' + attemptKey,
        })
        resolverRetries += resolution.transcripts.filter((t) => t.attempt === 2).length
        if (!resolution.ok) {
          const last = resolution.transcripts[resolution.transcripts.length - 1]
          await restoreInteg()
          return parked(resolution.reason, (last && last.path) || open[0].path)
        }
        await restoreInteg()
      }

      // ── step 5: the candidate ─────────────────────────────────────────────
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
          resolversDispatched, resolverRetries, checks, checkRetries,
        })
      }
      const candidate = m.candidateSha
      // The branch moves BEFORE the checks and the suite: both measure the
      // candidate, and a red one leaves the branch on it so the PR shows what
      // failed.
      await gitR(['update-ref', 'refs/heads/' + branch, candidate])

      // ── step 6: the checks, on the candidate, in the integration clone ────
      // By NAME, not by sha: the integration clone was cut `--local` at BASE and
      // holds neither the tip nor the candidate, and a bare sha is not
      // advertised under every protocol.
      await borrowInteg()
      await gitR(['fetch', '--no-tags', repo, 'refs/heads/' + branch], integ)
      await gitR(['read-tree', '-u', '--reset', candidate + '^{tree}'], integ)

      const conflicted = conflictsIndex().map((e) => e && e.path).filter(Boolean)
      const ctx = {
        repo, base, tip, run, tasks, candidate, joined, conflicted, integ, exec,
        foldEvidence, attemptKey,
      }
      let red = null
      for (const check of CANDIDATE_CHECKS) {
        const out = await check.run(ctx)
        if (out && Array.isArray(out.checks)) checks = checks.concat(out.checks)
        if (out && out.ok === false) { red = { ...out, check: check.name }; break }
      }

      if (red) {
        // One retry per path per attempt, and only where a resolver owns the
        // path: a red check on a path no resolver wrote has nobody to ask.
        if (conflicted.includes(red.path) && !retriedPaths.has(red.path)) {
          retry = {
            path: red.path, check: red.check, message: red.message || '',
            exam: red.exam || '', index: conflictsIndex(), waveDir: '',
          }
          continue
        }
        await restoreInteg()
        return record({
          disposition: red.disposition, reason: red.reason,
          candidate, tip, suite: 'none',
          pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
          checks, checkRetries,
        })
      }

      // ── step 7: the suite ─────────────────────────────────────────────────
      if (!testCmd) {
        await restoreInteg()
        return record({
          disposition: 'folded', candidate, tip, suite: 'none',
          pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
          checks, checkRetries,
        })
      }
      const suite = await exec('bash', ['-lc', testCmd], { cwd: integ })
      fs.writeFileSync(path.join(foldEvidence, 'suite-' + attemptKey + '.txt'),
        String(suite.stdout || '') + String(suite.stderr || ''))
      await restoreInteg()

      return record({
        disposition: suite.code === 0 ? 'folded' : 'suite red',
        ...(suite.code === 0 ? {} : { reason: 'the candidate\'s suite exited ' + suite.code }),
        candidate, tip, suite: suite.code === 0 ? 'pass' : 'fail',
        pathsJoined, pathsConflicted, resolversDispatched, resolverRetries,
        checks, checkRetries,
      })
    }
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
