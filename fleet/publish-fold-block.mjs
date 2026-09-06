// fleet/publish-fold-block.mjs — the CONTENDING TASKS block for a cross-run
// conflict (#715 decision 3, spec §3.3).
//
// In-wave, the engine can point a resolver at one file: every contending task
// of the wave lives in this run's `launch.json`, so the block is a title line
// per task plus a pointer, and the model reads the bodies itself. Cross-run
// there is no such file. The frontier side of the hunk is `main` since this
// run's BASE, and the tasks that wrote it belong to a run that has already
// merged — its plan lives on the tag `ultra/plan/run-<M>`, not on any path a
// resolver can open. So the block EMBEDS the bodies, verbatim: this module
// reads them off the tag and transcribes them into the prompt, because a
// program transcribing text is lossless and a model transcribing it is not.
//
// Entries are run-qualified (`- run 3 task T1:`) for the plain reason that task
// ids collide across plans: run 3's `T1` and run 7's `T1` are different tasks,
// and an unqualified id would make the resolver's two sides indistinguishable.
//
// Attribution is best-effort by construction, never a park. The merge PUT a
// sibling task adds writes `Fleet-Run: <M>` into every squash commit from that
// change on, and `record_tags` pushes `ultra/plan/run-<M>` after the merge — so
// a trailered commit can predate the tag reaching the origin, and the tag is
// fetched per trailer rather than assumed present in the clone. Three things
// then look identical from here and all three yield the same one-line entry: a
// commit with no trailer (a human pushed it — main takes human commits on most
// days of this repository), a trailered commit whose tag the origin does not
// have, and a plan that will not compile. The resolver is dispatched either
// way; a park on an unattributable frontier was a rule for a docket frontier
// and is dropped.
//
// The block carries no branch name, no plan path and no repository path: the
// temporary file the plan is compiled through, the tag ref and the clone's
// location are all this module's business, and none of them are a fact about
// the conflict a resolver should be reasoning from.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// The compiler lives beside this module in the FLEET checkout, never in
// `repo` — `repo` is a clone of the target, which is a different repository
// and need not carry the skill at all.
const COMPILE_PLAN = path.resolve(HERE, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')

export const HEADING = '\nCONTENDING TASKS:'

/** The one sentence that tells a resolver which side of a hunk is which. */
export const sideSentence = (run) =>
  'The frontier side of each hunk is main since this run\'s base; ' +
  'the incoming side is labeled run-' + run + ' in the hunks.'

// `%x01` opens each record so the four `%x00`-separated fields can be split
// back out unambiguously: a subject cannot contain either byte, but the log's
// own newline terminator would otherwise glue one record's last field to the
// next record's sha.
const RECORD = '\u0001'
const FIELD = '\u0000'
const FORMAT = '%x01' + '%H' + '%x00' + '%(trailers:key=Fleet-Run,valueonly)' +
  '%x00' + '%s' + '%x00' + '%an'

// A trailer value rides into a ref name, so it is checked before it is spent:
// a run label is a token, and anything else is treated as no attribution at
// all rather than composed into a refspec.
const RUN_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function exec (cmd, argv, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, argv, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '') || (error ? String(error.message ?? error) : '')
      })
    })
  })
}

const git = (repo, argv) => exec('git', ['-C', repo, ...argv])

const filesOf = (task) =>
  (Array.isArray(task?.files) ? task.files : []).map((f) => String(f))

/**
 * One task's entry: the run-qualified title line, then a newline, then the
 * body exactly as the plan wrote it.
 */
const taskEntry = (run, task) =>
  '- run ' + run + ' task ' + String(task?.id ?? '') + ': ' + String(task?.title ?? '') +
  ' [files: ' + filesOf(task).join(', ') + ']\n' + String(task?.body ?? '')

/** The one line an unattributable frontier commit contributes. */
const noPlanLine = (commit) =>
  '- main ' + commit.sha.slice(0, 7) + ' "' + commit.subject + '" (' + commit.author + ', no plan)'

/**
 * The first-parent frontier: `<base>..<tip>` restricted to `<path>`, oldest to
 * newest. `--first-parent` is what makes a merge's own diff the unit — a side
 * commit that edited the path but never landed on the first-parent line is not
 * a change main took, and the merge that took it is.
 */
async function frontierCommits (repo, base, tip, target) {
  const r = await git(repo, [
    'log', '--first-parent', '--reverse', '--format=' + FORMAT,
    base + '..' + tip, '--', target
  ])
  if (r.code !== 0) {
    throw new Error('git log --first-parent ' + base + '..' + tip + ' -- ' + target +
      ' failed in ' + repo + ': ' + r.stderr.trim())
  }
  return r.stdout.split(RECORD).slice(1).map((record) => {
    const [sha, trailer, subject, author] = record.split(FIELD)
    // An absent trailer is an empty field; more than one Fleet-Run is read as
    // the first, since a squash commit carries exactly one and a hand-edited
    // message is not a second opinion worth honouring.
    const run = String(trailer ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
    return {
      sha: String(sha ?? '').trim(),
      run,
      subject: String(subject ?? ''),
      author: String(author ?? '').replace(/\n+$/, '')
    }
  })
}

/**
 * Run M's plan, off its tag: fetch, read `.ultrapowers/plan.md` out of the tag,
 * compile it, return the `tasks` array. `null` means "no plan" for any reason —
 * the origin lacks the tag (it postdates the clone and was never pushed), the
 * tag carries no plan, or the plan does not compile. Every one of those is a
 * line, never a throw.
 *
 * The refspec names its destination so the fetch LEAVES the tag in the clone
 * rather than only in FETCH_HEAD, and is forced so a second call over the same
 * clone is idempotent.
 */
async function planTasksFor (repo, run) {
  if (!RUN_LABEL.test(run)) return null
  const tag = 'refs/tags/ultra/plan/run-' + run
  const fetched = await git(repo, ['fetch', 'origin', '+' + tag + ':' + tag])
  if (fetched.code !== 0) return null
  const plan = await git(repo, ['show', tag + ':.ultrapowers/plan.md'])
  if (plan.code !== 0) return null

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-fold-block-'))
  try {
    const planFile = path.join(dir, 'plan.md')
    const launchFile = path.join(dir, 'launch.json')
    fs.writeFileSync(planFile, plan.stdout)
    // `--emit-launch` is the shape that carries verbatim bodies beside
    // id/title/files — the same object `<run dir>/launch.json` holds, so the
    // frontier side and this run's side are one shape and one code path.
    const compiled = await exec('python3', [COMPILE_PLAN, planFile, '--emit-launch', launchFile])
    if (compiled.code !== 0) return null
    const payload = JSON.parse(fs.readFileSync(launchFile, 'utf8'))
    return Array.isArray(payload?.tasks) ? payload.tasks : null
  } catch {
    return null
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The block, resolved.
 *
 *   repo   a full clone of the target with an `origin` remote
 *   base   this run's BASE; `tip`  main as the fold sees it
 *   run    this run's number (the label the incoming hunk side carries)
 *   path   the conflicted path
 *   tasks  this run's `launch.json` tasks — `{ id, title, body, files }`
 *
 * Frontier entries come first, oldest to newest; this run's entries follow in
 * the order `tasks` gives them. A task contributes exactly when its `files`
 * name the conflicted path.
 */
export async function contendingBlock ({ repo, base, tip, run, path: target, tasks }) {
  const entries = []
  const plans = new Map()

  for (const commit of await frontierCommits(repo, base, tip, target)) {
    if (!commit.run) { entries.push(noPlanLine(commit)); continue }
    if (!plans.has(commit.run)) plans.set(commit.run, await planTasksFor(repo, commit.run))
    const planTasks = plans.get(commit.run)
    if (!planTasks) { entries.push(noPlanLine(commit)); continue }
    for (const task of planTasks) {
      if (filesOf(task).includes(target)) entries.push(taskEntry(commit.run, task))
    }
  }

  for (const task of (Array.isArray(tasks) ? tasks : [])) {
    if (filesOf(task).includes(target)) entries.push(taskEntry(run, task))
  }

  return HEADING + '\n' + sideSentence(run) + entries.map((e) => '\n' + e).join('')
}

export default contendingBlock
