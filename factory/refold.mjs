/**
 * factory/refold.mjs — the re-fold: a finished run's whole work, folded onto
 * a main that moved.
 *
 * `--refold` is the same fold a task's own landing goes through — `foldOnto`
 * from `./fold.mjs`, the union and the resolver included through
 * `resolveConflicts`, behind the one kernel wrapper `makeKernel` — asked once
 * for the whole of a finished run's own work rather than for one task's patch.
 *
 * The patch is the target's own `HEAD` (before this touches anything) against
 * `--base` — the run's own base — and the moving head the kernel folds it
 * onto is `--onto`, the new tip. A completed fold is re-verified before this
 * answers at all: every task's own Proof `Run:` lines, in a clone of the new
 * head, through `runProofsAndChecks` with no checks and no selected tests —
 * no exam file, no `--exams-dir` (M1). A red line there undoes the reset; an
 * unresolved conflict never touches the target to begin with.
 *
 * Resolves the one JSON object `main` prints verbatim: `{ refolded, head,
 * onto }` on success, `{ refolded: false, reason: 'red' | 'conflict' |
 * 'kernel', head?, onto }` otherwise.
 *
 * MODELS NEVER RUN GIT: every `git` and every kernel call here is the
 * engine's own `child_process`, through the `sh` and `git` a caller hands in.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runWorker } from './worker.mjs'
import { retrying } from './retry.mjs'
import { makeKernel, foldOnto, makeCloner, resolveConflicts, runProofsAndChecks } from './fold.mjs'
import { normalizeArgs, lastJson, defaultSh, defaultGit, DEFAULT_MODEL } from './engine.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const COMPILER = path.join(REPO, 'skills/ultrapowers/scripts/plan_parse.py')
const POLICY_PATH = path.join(HERE, 'policy.json')
const RESOLVE_ROLE = path.join(HERE, 'roles', 'resolve.md')

// The dispatched model id and the models the SDK reports it actually used,
// for a `dispatch:end` row: `models` is the sorted keys of the result's
// `modelUsage`, or `null` when there is none to report. The four token
// counts are summed over every model the result reports (#1298): `null`
// when there is none, never `0`, so "not reported" and "zero" stay apart.
// Shared with `runEngine`'s own dispatch, which imports both from here.
const TOKEN_CELLS = [
  ['input_tokens', 'inputTokens'],
  ['output_tokens', 'outputTokens'],
  ['cache_read_input_tokens', 'cacheReadInputTokens'],
  ['cache_creation_input_tokens', 'cacheCreationInputTokens'],
]
export function modelCells ({ model, result }) {
  const usage = result && typeof result === 'object' ? result.modelUsage : null
  const keys = usage && typeof usage === 'object' ? Object.keys(usage) : []
  const counts = {}
  for (const [cell, field] of TOKEN_CELLS) {
    counts[cell] = keys.length
      ? keys.reduce((sum, k) => sum + (Number((usage[k] || {})[field]) || 0), 0)
      : null
  }
  return { model: model ?? null, models: keys.length ? keys.sort() : null, ...counts }
}

// M4: no board, no examiner, no implementer — the one worker role a
// re-fold ever dispatches is the resolver, exactly as a task's own fold.
export function makeRefoldDispatch ({ worker, appendEvent, policy, sleep }) {
  const dispatchOnce = async (opts) => {
    appendEvent({
      kind: 'dispatch:start', task: opts.taskId, label: opts.label, role: opts.role,
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    let answer
    let turns = 0
    try {
      answer = await worker({
        cwd: opts.cwd, prompt: opts.prompt, systemPrompt: opts.systemPrompt, model: opts.model,
        files: opts.files, schema: opts.schema ?? null, mcpServers: opts.mcpServers ?? null,
        onMessage: (m) => { if (m && m.type === 'assistant') turns += 1 },
        readOnly: Boolean(opts.readOnly), role: opts.role, label: opts.label,
        task: opts.taskId,
        onDenied: (row) => appendEvent(row),
      })
    } catch (e) {
      answer = { result: null, denials: [], error: String((e && e.message) || e).slice(0, 500), turns }
    }
    appendEvent({
      kind: 'dispatch:end', task: opts.taskId, label: opts.label, role: opts.role,
      error: (answer && answer.error) || null,
      ...modelCells({ model: opts.model, result: answer && answer.result }),
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    return answer
  }
  return retrying(dispatchOnce, { policy, sleep })
}

export async function runRefold (rawArgs = {}, deps = {}) {
  const args = normalizeArgs(rawArgs)
  const target = path.resolve(String(args.target))
  const runDir = path.resolve(String(args.runDir ?? '.'))
  const base = String(args.base)
  const onto = String(args.onto)
  const model = args.model || DEFAULT_MODEL

  const worker = deps.worker || runWorker
  const sh = deps.sh || defaultSh
  const git = deps.git || defaultGit
  const log = deps.log || ((s) => process.stderr.write(String(s) + '\n'))

  fs.mkdirSync(runDir, { recursive: true })
  // Appended to, never truncated: `runDir` is the run's own directory, and the
  // file already holds every row the engine wrote. run-198 (2026-09-21) lost
  // its live `events.jsonl` to a `writeFileSync(eventsPath, '')` here — the
  // tagged evidence survived only because the boot had copied it first.
  const eventsPath = path.join(runDir, 'events.jsonl')
  const appendEvent = (row) => fs.appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n')

  const RESOLVE_MD = fs.readFileSync(RESOLVE_ROLE, 'utf8')

  const policyDoc = (() => {
    try {
      const policyFile = args.policy ? path.resolve(String(args.policy)) : POLICY_PATH
      return JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    } catch { return {} }
  })()
  const unionPolicy = (policyDoc.resolve || {}).union || {}
  const reverifyPolicy = (policyDoc.fold || {}).reverify || {}
  const timeoutSeconds = reverifyPolicy.timeout_seconds ?? 300
  // M5: same fallback chain as `runEngine`'s.
  const judge = deps.judge || {}
  const readUnion = typeof deps.readUnion === 'function' ? deps.readUnion
    : typeof judge.readUnion === 'function' ? judge.readUnion
      : null

  // The landing's own kernel wrapper, so `fold.single_task_fast` off reaches
  // a re-fold's kernel calls exactly as it reaches a landing's (#1278).
  const kernel = makeKernel({ sh, log, policy: policyDoc })

  const dispatch = makeRefoldDispatch({ worker, appendEvent, policy: policyDoc })

  // The plan, compiled only for the tasks' own test commands — every one of
  // them is what M2's re-verify runs.
  const compiledOut = spawnSync('python3', [COMPILER, String(args.plan)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const compiled = lastJson(compiledOut.stdout)
  if (!compiled || !Array.isArray(compiled.launch_waves)) {
    throw new Error('plan_parse.py did not answer a plan: ' + String(compiledOut.stderr || '').slice(0, 400))
  }
  const tasks = compiled.launch_waves.flat()
  // M4: same bootstrap-command resolution as runEngine's — the plan's own
  // `bootstrapCmd` when the parser printed one, else each clone's own
  // tracked files decide.
  const bootstrapCmd = typeof compiled.bootstrapCmd === 'string' && compiled.bootstrapCmd !== ''
    ? compiled.bootstrapCmd
    : null

  const cloneAt = makeCloner({ target, runDir, git, sh, bootstrapCmd, timeoutSeconds, appendEvent })

  // M1: the run's whole patch is the target's own HEAD, as it stands before
  // any of this touches it, against `--base`.
  const startHead = git(['rev-parse', 'HEAD'], target).trim()
  const patchFile = path.join(runDir, 'refold.diff')
  git(['diff', '--binary', '--full-index', '--no-renames', '--output=' + patchFile, base, startHead], target)
  const patchArg = 'refold=' + patchFile + '@' + base

  // The kernel's `--wave` is an integer and its fold log is per (run dir,
  // wave). run-198 passed `--wave refold`: argparse refused it, the kernel
  // answered no JSON, and the null was reported as a conflict — so no re-fold
  // had ever worked. Each re-fold gets a kernel directory of its own under the
  // run's, at wave 1, so neither the engine's waves nor an earlier re-fold's
  // log can collide with it.
  let attempt = 1
  while (fs.existsSync(path.join(runDir, 'refold-' + attempt))) attempt += 1
  const kernelDir = path.join(runDir, 'refold-' + attempt)
  fs.mkdirSync(kernelDir, { recursive: true })
  const common = ['--repo', target, '--run-dir', kernelDir, '--wave', '1']

  // A kernel that answered nothing to the fold itself is not a conflict: the
  // wrapper is watched for that one null so it can be said, and stopped on.
  let foldAnsweredNothing = false
  const watched = (argv) => {
    const answer = kernel(argv)
    if (argv[0] === 'fold' && !answer) foldAnsweredNothing = true
    return answer
  }
  const r = await foldOnto({
    kernel: watched, common, patchArg, onto, subject: 'refold onto ' + onto,
    resolve: (fold) => resolveConflicts({
      fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
      RESOLVE_MD, appendEvent, taskId: undefined, labelId: 'refold', kernel,
    }),
  })
  if (foldAnsweredNothing) {
    appendEvent({ kind: 'refold:kernel-error', step: 'fold', onto })
    return { refolded: false, reason: 'kernel', onto }
  }
  if (r.sha === null) {
    // M3: never touches the target — it is still exactly where it was.
    const fold = r.fold
    const openPath = (!fold || fold.complete !== true)
      ? ((Array.isArray(fold && fold.open) && fold.open[0] && fold.open[0].path) || null)
      : null
    appendEvent({ kind: 'refold:conflict', path: openPath })
    return { refolded: false, reason: 'conflict', onto }
  }
  const head = r.sha

  // M1: resets the target to the resulting commit.
  git(['reset', '-q', '--hard', head], target)

  // M2/M6: before answering, verify the new head in its own clone — every
  // task's own Proof `Run:` lines, and nothing else.
  const verifyDir = cloneAt('refold-verify', head)
  const { ran } = await runProofsAndChecks({ sh, appendEvent }, {
    dir: verifyDir, tasksToRun: tasks, foldedTaskId: undefined, timeoutSeconds, includeChecks: false,
  })
  const reds = ran
    .filter((x) => x.kind === 'probe' && x.exit !== 0)
    .map((x) => ({ task: x.id, cmd: x.cmd, exit: x.exit }))
  if (reds.length) {
    for (const red of reds) appendEvent({ kind: 'refold:red', task: red.task, cmd: red.cmd, exit: red.exit })
    // M2: a red re-verify resets the target back to the head it had.
    git(['reset', '-q', '--hard', startHead], target)
    return { refolded: false, reason: 'red', head, onto }
  }

  return { refolded: true, head, onto }
}
