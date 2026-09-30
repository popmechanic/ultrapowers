#!/usr/bin/env node
/**
 * fleet/close-out.mjs — a run no VM carries, whose record still says live.
 *
 *   node fleet/close-out.mjs <owner>/<repo> <N> [--evidence-repo <owner>/<repo>] [--dry-run]
 *
 * A run whose VM is gone but whose live branch's `status.json` still says
 * `booting`, `running` or `publishing` will never record its own end. The
 * close-out writes that end for it — the page put back with `state: failed`,
 * the error naming why and the time it was written, every other cell kept —
 * and then seals the run (`sealRun`): the tag cut at the live branch's head,
 * and the live branch deleted once the tag is verified there.
 *
 * Both live in the operator's evidence repository (#1395): `--evidence-repo`,
 * else the `evidence` key of `~/.ultrapowers/fleet.json`, and never the
 * target's. The page is `runs/<slug>/<N>/status.json` on `live/<slug>/run-<N>`,
 * the tag `<slug>/run-<N>`; nothing here writes the evidence repository's
 * `main`, and nothing runs `git`.
 *
 * The janitor imports this file, so this file never imports the janitor.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  isRunNumber,
  isSafeTarget,
  listVms,
  liveBranchFor,
  parseArgs,
  parseComment,
  parseJson,
  readEvidenceSetting,
  runCli,
  runFolderFor,
  runTagFor
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/close-out.mjs <owner>/<repo> <N> [--evidence-repo <owner>/<repo>] [--dry-run]'

/** The states a page carries while its run is still going. */
export const LIVE_STATES = Object.freeze(['booting', 'running', 'publishing'])

export const CLOSE_OUT_ERROR = 'reaped before the run recorded its end'

const statusPath = (evidence, target, run) =>
  `repos/${evidence}/contents/${runFolderFor(target, run)}/status.json`

/** The contents envelope at the live branch: `{ page, sha }`, or null. */
async function readPage (exec, evidence, target, run) {
  const res = await exec('gh', ['api', `${statusPath(evidence, target, run)}?ref=${liveBranchFor(target, run)}`])
  if (res.code !== 0) return null
  const payload = parseJson(res.stdout)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  if (!decoded || typeof decoded !== 'object') return null
  return { page: decoded, sha: typeof payload.sha === 'string' ? payload.sha : null }
}

/** What a `gh` answer said, on one line, for a result's reason. */
const saidBy = (res) => `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n')[0]

/**
 * Seal run `run` of `target` in `evidence`: the tag `<slug>/run-<N>` cut at
 * the live branch's head through GitHub's refs API, read back to verify it
 * names that sha, and only then the live branch deleted. An answer that the
 * reference already exists is the tag being there, and the read-back decides.
 * Any refusal keeps the branch and says so: `{ tagged, deleted, reason? }`.
 */
export async function sealRun ({ exec = defaultExec, evidence, target, run }) {
  const branch = liveBranchFor(target, run)
  const tag = runTagFor(target, run)
  const head = await exec('gh', ['api', `repos/${evidence}/git/ref/heads/${branch}`])
  const sha = head.code === 0 ? parseJson(head.stdout)?.object?.sha : null
  if (typeof sha !== 'string') {
    return { tagged: false, deleted: false, reason: `no head for ${branch}: ${saidBy(head)}` }
  }
  const made = await exec('gh', [
    'api', '-X', 'POST', `repos/${evidence}/git/refs`,
    '-f', `ref=refs/tags/${tag}`,
    '-f', `sha=${sha}`
  ])
  if (made.code !== 0 && !/already exists/i.test(saidBy(made))) {
    return { tagged: false, deleted: false, reason: `tag ${tag} refused: ${saidBy(made)}` }
  }
  const check = await exec('gh', ['api', `repos/${evidence}/git/ref/tags/${tag}`])
  const tagged = check.code === 0 && parseJson(check.stdout)?.object?.sha === sha
  if (!tagged) {
    return { tagged: false, deleted: false, reason: `tag ${tag} does not name ${sha}; ${branch} kept` }
  }
  const gone = await exec('gh', ['api', '-X', 'DELETE', `repos/${evidence}/git/refs/heads/${branch}`])
  if (gone.code !== 0) {
    return { tagged: true, deleted: false, reason: `delete of ${branch} refused: ${saidBy(gone)}` }
  }
  return { tagged: true, deleted: true }
}

/**
 * Close out run `run` on `target`, whose record is in `evidence`. Answers
 * `{ target, run, state, closed, reason }`: `state` is the page's state
 * before, `closed` whether the page was (or, dry, would be) written.
 */
export async function closeOut ({ exec = defaultExec, target, run, evidence, now = () => new Date(), dryRun = false } = {}) {
  if (!isSafeTarget(target)) throw new Refusal(`close-out: target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  if (!isSafeTarget(evidence)) throw new Refusal(`close-out: evidence must be <owner>/<repo>, got ${JSON.stringify(evidence ?? null)}`)
  if (!isRunNumber(run)) throw new Refusal(`close-out: run must be a positive integer, got ${JSON.stringify(run ?? null)}`)
  const n = Number(run)

  // (1) A VM still carrying the run: it is not orphaned.
  const rows = await listVms(exec)
  const carried = rows.some((row) => {
    const fields = parseComment(row.comment)
    return fields.run === String(n) && fields.target === target
  })
  if (carried) return { target, run: n, state: null, closed: false, reason: 'a fleet VM still carries this run' }

  // (2) The page on the live branch, and only a live one is closed out.
  const found = await readPage(exec, evidence, target, n)
  if (found === null) return { target, run: n, state: null, closed: false, reason: 'no live branch page' }
  const state = typeof found.page.state === 'string' ? found.page.state : null
  if (!LIVE_STATES.includes(state)) return { target, run: n, state, closed: false, reason: 'not live' }

  if (dryRun) return { target, run: n, state, closed: false, reason: 'dry run: would write failed and seal' }

  // (3) The page put back, failed, every other cell kept.
  const written = { ...found.page, state: 'failed', error: CLOSE_OUT_ERROR, updatedAt: now().toISOString() }
  const argv = [
    'api', '-X', 'PUT', statusPath(evidence, target, n),
    '-f', `branch=${liveBranchFor(target, n)}`,
    '-f', `message=close-out: run ${n} failed — ${CLOSE_OUT_ERROR}`,
    '-f', `content=${Buffer.from(`${JSON.stringify(written, null, 2)}\n`, 'utf8').toString('base64')}`
  ]
  if (found.sha !== null) argv.push('-f', `sha=${found.sha}`)
  const res = await exec('gh', argv)
  if (res.code !== 0) {
    return { target, run: n, state, closed: false, reason: `write failed: ${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim()}` }
  }

  // (4) The seal: the tag cut at the page just written, then the live branch
  // deleted. A seal that cannot finish leaves the page written and the branch.
  const sealed = await sealRun({ exec, evidence, target, run: n })
  if (!sealed.deleted) return { target, run: n, state, closed: true, reason: `seal failed: ${sealed.reason}` }
  return { target, run: n, state, closed: true, reason: 'closed out as failed' }
}

async function main (argv) {
  const { opts, positional } = parseArgs(argv, { flags: ['dry-run'] })
  const [target, run] = positional
  if (!isSafeTarget(target) || !isRunNumber(run)) throw new Refusal(USAGE)
  const override = typeof opts['evidence-repo'] === 'string' ? opts['evidence-repo'] : null
  if (override !== null && !isSafeTarget(override)) {
    throw new Refusal(`close-out: --evidence-repo must be <owner>/<repo>, got ${JSON.stringify(override)}`)
  }
  const evidence = override ?? await readEvidenceSetting()
  if (evidence === null) {
    throw new Refusal('close-out: no evidence repository — pass --evidence-repo <owner>/<repo> or set `evidence` in ~/.ultrapowers/fleet.json')
  }
  const out = await closeOut({ target, run: Number(run), evidence, dryRun: opts['dry-run'] === true })
  process.stdout.write(`run ${out.run} on ${out.target}: ${out.closed ? 'closed' : 'not closed'} (state ${out.state ?? 'none'}) — ${out.reason}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
