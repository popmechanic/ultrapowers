#!/usr/bin/env node
/**
 * fleet/close-out.mjs — a run no VM carries, whose record still says live.
 *
 *   node fleet/close-out.mjs <owner>/<repo> <N> [--dry-run]
 *
 * A run whose VM is gone but whose evidence branch's `status.json` still says
 * `booting`, `running` or `publishing` will never record its own end. The
 * close-out writes that end for it — the page put back with `state: failed`,
 * the error naming why and the time it was written, every other cell kept —
 * and then runs retire's sweep for the target, which reads the page now saying
 * `failed` and tags the run as publish's `record_tags` does (#1314).
 *
 * The janitor imports this file, so this file never imports the janitor.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  evidenceBranchFor,
  isRunNumber,
  isSafeTarget,
  listVms,
  parseArgs,
  parseComment,
  parseJson,
  runCli
} from './lobby.mjs'
import { retire } from './retire.mjs'

export const USAGE = 'usage: node fleet/close-out.mjs <owner>/<repo> <N> [--dry-run]'

/** The states a page carries while its run is still going. */
export const LIVE_STATES = Object.freeze(['booting', 'running', 'publishing'])

export const CLOSE_OUT_ERROR = 'reaped before the run recorded its end'

const statusPath = (target, run) => `repos/${target}/contents/.ultrapowers/runs/${run}/status.json`

/** The contents envelope at the evidence branch: `{ page, sha }`, or null. */
async function readPage (exec, target, run) {
  const res = await exec('gh', ['api', `${statusPath(target, run)}?ref=${evidenceBranchFor(run)}`])
  if (res.code !== 0) return null
  const payload = parseJson(res.stdout)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  if (!decoded || typeof decoded !== 'object') return null
  return { page: decoded, sha: typeof payload.sha === 'string' ? payload.sha : null }
}

/**
 * Close out run `run` on `target`. Answers `{ target, run, state, closed,
 * reason }`: `state` is the page's state before, `closed` whether the page
 * was (or, dry, would be) written.
 */
export async function closeOut ({ exec = defaultExec, target, run, now = () => new Date(), dryRun = false } = {}) {
  if (!isSafeTarget(target)) throw new Refusal(`close-out: target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  if (!isRunNumber(run)) throw new Refusal(`close-out: run must be a positive integer, got ${JSON.stringify(run ?? null)}`)
  const n = Number(run)

  // (1) A VM still carrying the run: it is not orphaned.
  const rows = await listVms(exec)
  const carried = rows.some((row) => {
    const fields = parseComment(row.comment)
    return fields.run === String(n) && fields.target === target
  })
  if (carried) return { target, run: n, state: null, closed: false, reason: 'a fleet VM still carries this run' }

  // (2) The page on the evidence branch, and only a live one is closed out.
  const found = await readPage(exec, target, n)
  if (found === null) return { target, run: n, state: null, closed: false, reason: 'no evidence branch page' }
  const state = typeof found.page.state === 'string' ? found.page.state : null
  if (!LIVE_STATES.includes(state)) return { target, run: n, state, closed: false, reason: 'not live' }

  if (dryRun) return { target, run: n, state, closed: false, reason: 'dry run: would write failed and sweep' }

  // (3) The page put back, failed, every other cell kept.
  const written = { ...found.page, state: 'failed', error: CLOSE_OUT_ERROR, updatedAt: now().toISOString() }
  const argv = [
    'api', '-X', 'PUT', statusPath(target, n),
    '-f', `branch=${evidenceBranchFor(n)}`,
    '-f', `message=close-out: run ${n} failed — ${CLOSE_OUT_ERROR}`,
    '-f', `content=${Buffer.from(`${JSON.stringify(written, null, 2)}\n`, 'utf8').toString('base64')}`
  ]
  if (found.sha !== null) argv.push('-f', `sha=${found.sha}`)
  const res = await exec('gh', argv)
  if (res.code !== 0) {
    return { target, run: n, state, closed: false, reason: `write failed: ${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim()}` }
  }

  // (4) The sweep: the page now says failed, so retire tags the run and
  // deletes its branches. A sweep that cannot finish leaves the page written.
  try {
    await retire({ argv: ['--target', target], exec })
  } catch (error) {
    return { target, run: n, state, closed: true, reason: `sweep failed: ${error?.message ?? error}` }
  }
  return { target, run: n, state, closed: true, reason: 'closed out as failed' }
}

async function main (argv) {
  const { opts, positional } = parseArgs(argv, { flags: ['dry-run'] })
  const [target, run] = positional
  if (!isSafeTarget(target) || !isRunNumber(run)) throw new Refusal(USAGE)
  const out = await closeOut({ target, run: Number(run), dryRun: opts['dry-run'] === true })
  process.stdout.write(`run ${out.run} on ${out.target}: ${out.closed ? 'closed' : 'not closed'} (state ${out.state ?? 'none'}) — ${out.reason}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
