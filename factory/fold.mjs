/**
 * factory/fold.mjs — folding a landing, behind one kernel wrapper.
 *
 * The fold seam `factory/engine.mjs` used to carry inside `runEngine`'s own
 * closure: the one kernel wrapper (`makeKernel`), the one fold step a task's
 * landing and a re-fold share (`foldOnto`), the resolver pass over whatever a
 * fold leaves open (`resolveConflicts`), the clone every fold check runs in
 * (`makeCloner`), the fold check's own runner (`runProofsAndChecks`), and a
 * run's `foldIn` / `reverifyAfterFold` pair over its own state (`makeFold`).
 *
 * MODELS NEVER RUN GIT: every `git` and every kernel call here is the
 * engine's own `child_process`, through the `sh` and `git` a caller hands in.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloneAtBase } from './clone.mjs'
import { bootstrapFor } from './commands.mjs'
import { hunksCarrying } from './hunks.mjs'
import { unionReply } from './union.mjs'
import { commandFor } from './select.mjs'
import { proofsAdopted, foldRound } from './reverify.mjs'
import { runLines } from './proofs.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const KERNEL = path.join(REPO, 'skills/ultrapowers/kernel/fold_wave.py')

const DEFAULT_TIMEOUT_SECONDS = 300

/** A fake `sh` may answer `{ status }`, `{ code }` or a bare number; read all
 *  three rather than let a sim's shorthand read as exit 0 by accident. */
const exitOf = (r) => {
  if (typeof r === 'number') return r
  if (!r || typeof r !== 'object') return 0
  for (const key of ['status', 'code', 'exitCode']) {
    if (typeof r[key] === 'number') return r[key]
  }
  return 0
}
const outOf = (r) => String((r && typeof r === 'object' && (r.stdout ?? r.out)) || '')

/** The JSON object the kernel printed, or `null`: the whole of stdout first,
 *  its last JSON line second. */
const lastJson = (text) => {
  const whole = String(text || '').trim()
  if (whole.startsWith('{')) {
    try { return JSON.parse(whole) } catch { /* not one document */ }
  }
  const lines = whole.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('{')) continue
    try { return JSON.parse(lines[i]) } catch { /* not this line */ }
  }
  return null
}

/** The paths one patch touches — `engine.mjs`'s `splitDiff`, keys only. */
const touchedPaths = (text) => {
  const pattern = /^diff --git a\/(\S+) b\/\S+\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm
  return [...String(text || '').matchAll(pattern)].map((m) => m[1])
}

/** What one resolver answers; the kernel's reply grammar, verbatim. */
const RESOLVER_SCHEMA = {
  type: 'object',
  required: ['status', 'hunks', 'notes'],
  properties: {
    status: { enum: ['RESOLVED', 'BLOCKED'] },
    hunks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'content'],
        properties: { id: { type: 'string' }, content: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

/**
 * The one kernel wrapper: `python3 fold_wave.py ...argv` through `sh`, cwd the
 * repository root, answering the last JSON object of stdout (or `null`, with
 * a `kernel <verb>: exit <n> <stderr tail>` log line). With
 * `fold.single_task_fast.enabled` explicitly `false` the kernel runs its old
 * four-pass fold: `ULTRA_FOLD_FULL_CHECKS=1` rides its environment (#1278).
 */
export function makeKernel ({ sh, log, policy }) {
  const fullChecks = (((policy || {}).fold || {}).single_task_fast || {}).enabled === false
  const say = typeof log === 'function' ? log : () => {}
  return (argv) => {
    const r = sh('env', [...(fullChecks ? ['ULTRA_FOLD_FULL_CHECKS=1'] : []), 'python3', KERNEL, ...argv], REPO)
    const answer = lastJson(outOf(r))
    if (!answer) say('kernel ' + argv[0] + ': exit ' + exitOf(r) + ' ' + String((r && r.stderr) || '').slice(-300))
    return answer
  }
}

/**
 * The one fold step both a landing and a re-fold go through: `fold` onto
 * `onto`, one `resolve` pass when the kernel answers an open conflict, and
 * `materialize` only on a completed fold. Never resets a repository and never
 * writes a row — the caller does both.
 *
 * Answers `{ sha, fold, reason, neededResolveConflicts, dispatchedResolver }`:
 * `sha` null on either failure, with `fold` the last fold answer so a caller
 * can tell an unfinished fold (`fold.complete !== true`) from a materialize
 * that answered no candidate.
 */
export async function foldOnto ({ kernel, common, patchArg, onto, subject, resolve }) {
  let neededResolveConflicts = false
  let dispatchedResolver = false
  let fold = kernel(['fold', ...common, '--base', onto, '--patch', patchArg])
  if (fold && fold.complete !== true) {
    neededResolveConflicts = true
    const result = await resolve(fold)
    fold = result.fold
    dispatchedResolver = result.dispatchedResolver
  }
  if (!fold || fold.complete !== true) {
    const reason = 'fold did not complete: ' + JSON.stringify(fold || null).slice(0, 300)
    return { sha: null, fold, reason, neededResolveConflicts, dispatchedResolver }
  }
  const mat = kernel(['materialize', ...common, '--prev-head', onto, '--patch', patchArg,
    '--subject', subject])
  if (!mat || typeof mat.candidateSha !== 'string') {
    const reason = 'materialize answered no candidate: ' + JSON.stringify(mat || null).slice(0, 300)
    return { sha: null, fold, reason, neededResolveConflicts, dispatchedResolver }
  }
  return { sha: mat.candidateSha, fold, reason: null, neededResolveConflicts, dispatchedResolver }
}

/** A `cloneAt(name, sha)` over one `target`: a fresh clone under `runDir`,
 *  detached at `sha`, its own private exclude so a candidate's bytecode
 *  cache never rides a captured patch. The one place either entry makes a
 *  clone, so both make it the same way.
 *
 *  M4: directly after the clone is made, and before anything else runs
 *  there, this installs whatever the target needs — `bootstrapFor`'s
 *  command over `planCmd: bootstrapCmd` and this clone's own tracked files
 *  — through `sh`, under the same `timeout` an exam command runs under. A
 *  non-zero exit there is not this clone's caller's problem to notice on
 *  its own: `appendEvent` (when given) gets a `bootstrap:red` row naming
 *  this clone and that exit, and `cloneAt` THROWS — an `Error` carrying a
 *  `bootstrapRed: { clone, exit, tail }` field — rather than answering a
 *  clone whose dependencies never installed as if it were ready. Every
 *  caller either lets that propagate (a re-fold, where no per-task park
 *  exists to route it to) or catches `err.bootstrapRed` to park the one
 *  task that clone was made for. `sh` absent (no caller left needs this,
 *  but a direct unit test of `makeCloner` alone might) skips bootstrapping
 *  entirely, exactly as before this task. */
export function makeCloner ({ target, runDir, git, sh, bootstrapCmd, timeoutSeconds, appendEvent }) {
  return (name, sha) => {
    const dest = path.join(runDir, name)
    fs.rmSync(dest, { recursive: true, force: true })
    const clone = cloneAtBase({ repo: target, dest, base: sha, git })
    try {
      fs.appendFileSync(path.join(clone, '.git', 'info', 'exclude'),
        '\n__pycache__/\n*.pyc\n.pytest_cache/\n')
    } catch { /* a clone shape without .git/info is still a clone */ }

    if (sh) {
      let files = []
      try { files = git(['ls-files'], clone).split('\n').map((s) => s.trim()).filter(Boolean) } catch { /* none tracked (or not a repo) reads as no evidence */ }
      const cmd = bootstrapFor({ planCmd: bootstrapCmd, files })
      if (cmd) {
        const r = sh('timeout', [String(timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS), 'bash', '-lc', cmd], clone)
        const exit = exitOf(r)
        if (exit !== 0) {
          if (appendEvent) appendEvent({ kind: 'bootstrap:red', clone, exit })
          const err = new Error('bootstrap failed in ' + clone + ': exit ' + exit)
          err.bootstrapRed = { clone, exit, tail: outOf(r).slice(-1500) }
          throw err
        }
      }
    }

    return clone
  }
}

/**
 * One pass of the resolver over whatever a fold left open — the union first
 * (M3, gated by `unionPolicy.mode`), then one resolver dispatch per
 * still-open conflict. Shared by a task's own landing (`foldIn`, which hands
 * in `withHandoff` and its task's id) and a re-fold (`runRefold`, which has
 * neither) — "the union and the resolver included", exactly the same for
 * both.
 */
export async function resolveConflicts ({
  fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
  RESOLVE_MD, appendEvent, taskId, labelId, kernel, withHandoff,
}) {
  const open = Array.isArray(fold.open) ? fold.open : []
  if (!open.length) return { fold, dispatchedResolver: false }
  const suffix = withHandoff || (async (p) => p)
  let latest = fold
  let dispatchedResolver = false
  for (const conflict of open) {
    if (unionPolicy.mode === 'live' && typeof readUnion === 'function') {
      let hunksFileText = null
      try { hunksFileText = fs.readFileSync(conflict.hunksFile, 'utf8') } catch { /* unreadable: no union */ }
      const union = hunksFileText !== null ? unionReply(hunksFileText) : null
      if (union) {
        const verdict = await readUnion({ hunks: union.hunks, who: { task: taskId ?? null, label: null } })
        if (verdict && verdict.union === true) {
          const replyDir = path.join(runDir, `reply-${labelId}-${conflict.i}`)
          fs.mkdirSync(replyDir, { recursive: true })
          for (const h of union.hunks) {
            const safeId = String((h && h.id) || '').replace(/[^A-Za-z0-9]/g, '')
            if (!safeId) continue
            const content = String((h && h.content) || '')
            fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
              content === '' ? '' : (content.endsWith('\n') ? content : content + '\n'))
          }
          fs.writeFileSync(path.join(replyDir, 'notes.txt'),
            'union: both sides only added, read as independent; kept in order, no resolver dispatched.\n')
          latest = kernel(['resolve', ...common, '--conflict', String(conflict.i),
            '--reply-dir', replyDir, '--patch', patchArg]) || latest
          appendEvent({ kind: 'union', task: taskId, path: conflict.path, hunks: union.hunks.length })
          if (latest && latest.complete === true) return { fold: latest, dispatchedResolver }
          continue
        }
      }
    }
    dispatchedResolver = true
    const answer = await dispatch({
      role: 'resolve', label: 'resolve:' + labelId + ':' + conflict.i,
      taskId, cwd: path.dirname(String(conflict.hunksFile || runDir)),
      model, systemPrompt: RESOLVE_MD, files: [], readOnly: true, schema: RESOLVER_SCHEMA,
      prompt: await suffix(
        'HUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
        '\n\nRead that file and resolve every block it carries.',
        taskId),
    })
    const reply = (answer && answer.result && answer.result.structured_output) || null
    if (!reply || reply.status !== 'RESOLVED') return { fold: latest, dispatchedResolver }
    const replyDir = path.join(runDir, `reply-${labelId}-${conflict.i}`)
    fs.mkdirSync(replyDir, { recursive: true })
    for (const h of reply.hunks || []) {
      const safeId = String((h && h.id) || '').replace(/[^A-Za-z0-9]/g, '')
      if (!safeId) continue
      const content = String((h && h.content) || '')
      fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
        content === '' ? '' : (content.endsWith('\n') ? content : content + '\n'))
    }
    fs.writeFileSync(path.join(replyDir, 'notes.txt'), String(reply.notes || '') + '\n')
    latest = kernel(['resolve', ...common, '--conflict', String(conflict.i),
      '--reply-dir', replyDir, '--patch', patchArg]) || latest
    if (latest && latest.complete === true) return { fold: latest, dispatchedResolver }
  }
  return { fold: latest, dispatchedResolver }
}

/**
 * The fold check's own runner: every task's own probes and selected tests,
 * and — with `proofsEnabled` — every entry of the plan's own `checks`, run
 * once in `dir`. Callable with any list of tasks and any directory, so a
 * re-fold runs it over every task at once, not only the one just folded.
 *
 * `ctx`: `{ sh, appendEvent, selectedByTask, selectTimeoutSeconds,
 * proofsEnabled, checks, runBase, proofTimeoutSeconds }`.
 *
 * M3: a check's command runs with `ULTRA_BASE` in its own environment, set to
 * the run's base sha — never the anchor, never the candidate's own base — and
 * every check runs, minor or not; only a non-minor failure is folded into
 * `reds` alongside a red exam.
 */
export async function runProofsAndChecks (ctx, { dir, tasksToRun, foldedTaskId, timeoutSeconds, includeChecks = true }) {
  const { sh, appendEvent, proofsEnabled, runBase, proofTimeoutSeconds } = ctx
  const selectedByTask = ctx.selectedByTask || {}
  const ran = []
  const reds = []
  // Every touched task's own probes and selected tests, through the one
  // runner the fold check and `--refold` both use (#1163).
  for (const t of tasksToRun) {
    const lines = Array.isArray(t.proofRuns) ? t.proofRuns : []
    if (lines.length) {
      const results = await runLines({ lines, cwd: dir, sh, env: undefined, timeoutSeconds })
      for (const r of results) {
        ran.push({ id: t.id, kind: 'probe', cmd: r.cmd, exit: r.exit })
        if (r.exit !== 0) reds.push({ kind: 'probe', id: t.id, exit: r.exit, out: r.tail })
      }
    }
    const testPaths = selectedByTask[t.id] || selectedByTask[String(t.id)] || []
    for (const p of testPaths) {
      const argv = commandFor(p, ctx.selectTimeoutSeconds)
      if (!argv) continue
      const r = sh(argv[0], argv.slice(1), dir)
      const exit = exitOf(r)
      ran.push({ id: t.id, kind: 'test', path: p, exit })
      if (exit !== 0) reds.push({ kind: 'test', id: t.id, path: p, exit, out: outOf(r) })
    }
  }
  const checks = includeChecks && proofsEnabled && Array.isArray(ctx.checks) ? ctx.checks : []
  if (checks.length) {
    const results = await runLines({
      lines: checks.map((c) => c.cmd), cwd: dir, sh,
      env: { ULTRA_BASE: runBase }, timeoutSeconds: proofTimeoutSeconds,
    })
    results.forEach((r, i) => {
      const minor = Boolean(checks[i] && checks[i].minor)
      appendEvent({ kind: 'check:line', task: foldedTaskId, cmd: r.cmd, exit: r.exit, minor })
      if (r.exit !== 0 && !minor) reds.push({ kind: 'check', cmd: r.cmd, exit: r.exit, out: r.tail })
    })
  }
  return { ran, reds }
}

/**
 * A run's `foldIn` and `reverifyAfterFold`, over that run's own state.
 *
 * `ctx` carries what the engine's closure used to: `target`, `runDir`, `git`,
 * `kernel`, `board`, `appendEvent`, `dispatch`, `model`, `IMPL_MD`,
 * `RESOLVE_MD`, `unionPolicy`, `readUnion`, `withHandoff`, `implPrompt`,
 * `capture`, `cloneAt`, `tasks`, `adopted`, `reverifyPolicy`,
 * `attributionPolicy`, `foldOutcomes`, `foldOrder`, the `runProofsAndChecks`
 * fields (`sh`, `selectedByTask`, `selectTimeoutSeconds`, `proofsEnabled`,
 * `checks`, `runBase`, `proofTimeoutSeconds`), and `state` — an object whose
 * `head`, `wave` and `foldUnresolved` read and set the run's own.
 */
export function makeFold (ctx) {
  const {
    target, runDir, git, kernel, board, appendEvent, dispatch, model, IMPL_MD, RESOLVE_MD,
    unionPolicy, readUnion, withHandoff, implPrompt, capture, cloneAt, tasks, adopted,
    reverifyPolicy, attributionPolicy, foldOutcomes, foldOrder, state,
  } = ctx
  const proofs = (opts) => runProofsAndChecks(ctx, opts)

  // M5: records both the outcome and the order it was set in, so `labelPair`
  // can tell which of two tasks folded later.
  const setFoldOutcome = (id, outcome) => {
    foldOutcomes.set(id, outcome)
    foldOrder.push(id)
  }

  /**
   * One landing, folded. The kernel answers `fold` with `complete`; a fold that
   * is not complete is a conflict, and one resolver pass is what it gets — a
   * second would be a loop, and the task is parked instead.
   */
  const foldIn = async (landing, { reattempt = false } = {}) => {
    state.wave += 1
    const id = landing.task.id
    const common = ['--repo', target, '--run-dir', runDir, '--wave', String(state.wave)]
    const patchArg = id + '=' + landing.best.patch + '@' + landing.anchor
    const r = await foldOnto({
      kernel, common, patchArg, onto: state.head, subject: 'task ' + id,
      resolve: (fold) => resolveConflicts({
        fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
        RESOLVE_MD, appendEvent, taskId: id, labelId: id, kernel, withHandoff,
      }),
    })
    if (r.sha === null) {
      if (!reattempt) {
        if (!r.fold || r.fold.complete !== true) await board.post(id, 'conflict', r.reason)
        appendEvent({ kind: 'parked', task: id, reason: r.reason })
        setFoldOutcome(id, 'parked')
      }
      return { sha: null, reason: r.reason }
    }
    git(['reset', '-q', '--hard', r.sha], target)
    state.head = r.sha
    // M5's `labelPair` reads this back as `folds`: `clean` when the kernel's
    // own three-way merge completed with no conflict, `resolved` when a
    // resolver was dispatched for this fold, `union` when `resolveConflicts`
    // settled it without ever dispatching one.
    const outcome = r.dispatchedResolver ? 'resolved' : (r.neededResolveConflicts ? 'union' : 'clean')
    setFoldOutcome(id, outcome)
    return { sha: r.sha }
  }

  /**
   * M2-M4/M6: directly after a task's fold, the probes and selected tests of
   * every adopted task (the folded task's own first), plus the plan's own
   * `checks`, run once on the folded tree; every red goes through one
   * `foldRound` (`./reverify.mjs`) — attributed, judged, re-attempted by the
   * right worker, verified once more. Still red sets `foldUnresolved` without
   * unadopting anything. A minor check's own failure is recorded
   * (`check:line`) and buys neither a red row nor a re-attempt.
   */
  const reverifyAfterFold = async (task, best, headBefore) => {
    const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
    if (!touchedPaths(patchText).length) return
    const cap = Number.isInteger(reverifyPolicy.max_run) ? reverifyPolicy.max_run : 6
    const timeoutSeconds = reverifyPolicy.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS

    const tasksToRun = reverifyPolicy.enabled === true
      ? proofsAdopted({ folded: task.id, adopted, tasks, selected: ctx.selectedByTask, cap })
      : []
    const checksNamed = ctx.proofsEnabled && Array.isArray(ctx.checks) ? ctx.checks : []
    if (!tasksToRun.length && !checksNamed.length) return

    // A `bootstrapRed` here is not this landing's own park: read as "this fold's re-verify could not run".
    let first
    try {
      first = await proofs({
        dir: cloneAt('fold-verify-' + task.id, state.head), tasksToRun, foldedTaskId: task.id, timeoutSeconds,
      })
    } catch (err) {
      if (!(err && err.bootstrapRed)) throw err
      first = { ran: [], reds: [], bootstrapRed: err.bootstrapRed }
    }
    appendEvent({ kind: 'fold:verify', task: task.id, ran: first.ran, attempt: 1 })
    if (first.bootstrapRed) { state.foldUnresolved = true; return }
    if (!first.reds.length) return

    for (const red of first.reds) {
      await board.post(task.id, 'fold-red',
        (red.kind === 'probe' ? ('probe ' + red.id) : red.kind === 'test' ? ('test ' + red.path) : ('check ' + red.cmd)) +
        ' exit ' + red.exit + '\n' + red.out.slice(-1500))
    }

    const hunks = hunksCarrying(patchText, [],
      Number.isInteger(attributionPolicy.hunks_cap) ? attributionPolicy.hunks_cap : 4000)

    // A `cloneAt` throw here rejects, which `foldRound` reads as `null`.
    const runProofsAt = async (id, sha) => {
      const t = tasks.find((tk) => tk.id === id)
      if (!t) return 0
      const dir = cloneAt('fold-before-' + id + '-' + task.id, sha)
      const { reds } = await proofs({
        dir, tasksToRun: [t], foldedTaskId: task.id, timeoutSeconds, includeChecks: false,
      })
      return reds.length ? reds[0].exit : 0
    }

    // A fresh clone, the implementer dispatched with the fact riding its own prompt, folded as any landing.
    const reattempt = async (action) => {
      const actionTask = tasks.find((t) => t.id === action.task)
      if (!actionTask) return false
      const anchor = state.head
      let dir
      try {
        dir = cloneAt('fold-fix-' + action.role + '-' + action.task + '-' + task.id, anchor)
      } catch (err) {
        if (err && err.bootstrapRed) return false
        throw err
      }
      await dispatch({
        role: 'implement', label: 'impl:' + action.task + ':fold',
        taskId: action.task, cwd: dir, model, mcpServers: null,
        systemPrompt: IMPL_MD, files: actionTask.files || [],
        prompt: await withHandoff(
          (await implPrompt(actionTask)) + '\n\n' + action.fact,
          action.task),
      })
      const patch = capture(dir, anchor, path.join(runDir, `patch-${action.task}-fold-${task.id}.diff`))
      const folded = await foldIn({ task: actionTask, anchor, best: { patch } }, { reattempt: true })
      return folded.sha !== null
    }

    const verify = () => proofs({
      dir: cloneAt('fold-verify-' + task.id, state.head), tasksToRun, foldedTaskId: task.id, timeoutSeconds,
    })

    const { unresolved } = await foldRound({
      reds: first.reds, folded: task.id, headBefore, head: state.head,
      enabled: attributionPolicy.enabled === true, hunks,
      runProofsAt, appendEvent, reattempt, verify,
    })
    if (unresolved) state.foldUnresolved = true
  }

  return { foldIn, reverifyAfterFold }
}
