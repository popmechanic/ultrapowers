#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_CONFIG_PATH,
  PLAN_FILE,
  Refusal,
  defaultExec,
  evidenceUrlFor,
  git,
  integrationBranchFor,
  isRunNumber,
  isSafeTarget,
  isVmName,
  listVms,
  liveBranchFor,
  lobby,
  LobbyError,
  output,
  parseArgs,
  parseComment,
  parseDuration,
  parseJson,
  readEvidenceSetting,
  runCli,
  runFolderFor,
  runOfBranch,
  runOfEvidenceRef,
  runOfVmName,
  runTagFor
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--target <owner>/<repo>] [--dry-run] [--json] [--help]'

export const usage = () => USAGE

export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
const LIVE_STATES = Object.freeze(['running', 'publishing'])
const DEFAULT_AGE = '1h'
const STALE_MS = 6 * 60 * 60 * 1000
const reapPlan = ({ finished, updatedAt, nowMs, ageMs }) => {
  const updated = Date.parse(String(updatedAt))
  if (!Number.isFinite(updated) || finished !== true) return { action: 'none', reapableAt: null }
  const at = updated + ageMs
  return nowMs >= at
    ? { action: 'rm', reapableAt: new Date(at).toISOString() }
    : { action: 'pending', reapableAt: new Date(at).toISOString() }
}
const NEVER_REAP = 'do not reap'

export const ghApi = async (exec, apiPath) => {
  const res = await exec('gh', ['api', apiPath])
  return res.code === 0 ? parseJson(res.stdout) : null
}

const ghList = async (exec, apiPath) => {
  const res = await exec('gh', ['api', '--paginate', '--slurp', apiPath])
  const payload = res.code === 0 ? parseJson(res.stdout) : null
  return Array.isArray(payload) ? payload.flat() : null
}

const contentsPath = (evidence, target, run, file) =>
  `repos/${evidence}/contents/${runFolderFor(target, run)}/${file}`

export async function readContentsAt (exec, evidence, target, run, ref) {
  const payload = await ghApi(exec, `${contentsPath(evidence, target, run, 'status.json')}?ref=${ref}`)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  const page = decoded && typeof decoded === 'object' ? decoded : null
  return { page, sha: typeof payload.sha === 'string' ? payload.sha : null, from: ref }
}

async function evidenceReading (exec, evidence, target, run) {
  if (evidence === null) return null
  const found = await readContentsAt(exec, evidence, target, run, runTagFor(target, run)) ??
    await readContentsAt(exec, evidence, target, run, liveBranchFor(target, run))
  if (found === null || found.page === null) return null
  const state = typeof found.page.state === 'string' ? found.page.state : null
  return {
    finished: REAPABLE_STATES.includes(state),
    live: LIVE_STATES.includes(state),
    state,
    updatedAt: typeof found.page.updatedAt === 'string' ? found.page.updatedAt : null,
    from: found.from,
    page: found.page,
    sha: found.sha
  }
}

const ghPut = (exec, apiPath, { branch, message, content, sha = null }) => {
  const argv = [
    'api', '-X', 'PUT', apiPath,
    '-f', `branch=${branch}`,
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`
  ]
  if (sha !== null) argv.push('-f', `sha=${sha}`)
  return exec('gh', argv)
}

function assignmentOf (row) {
  if (!isVmName(row.name)) return null
  const fields = parseComment(row.comment)
  const run = isRunNumber(fields.run) ? Number(fields.run) : runOfVmName(row.name)
  const target = isSafeTarget(fields.target) ? fields.target : null
  if (run === null || target === null) return null
  return { run, target }
}

const saysNeverReap = (row) => String(row?.comment ?? '').includes(NEVER_REAP)

const unitOf = (run) => `fleet-run@${run}.service`

const UNIT_PROPERTIES = Object.freeze(['ActiveState', 'SubState', 'Result', 'ExecMainStatus'])

const showUnitCommand = (run) =>
  `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show ${unitOf(run)} ` +
  UNIT_PROPERTIES.map((p) => `-p ${p}`).join(' ')

const journalCommand = (run) => `journalctl _SYSTEMD_USER_UNIT=${unitOf(run)} --no-pager -n 200`

const onVm = (exec, dest, command) =>
  exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', dest, command])

async function readUnit (exec, dest, run) {
  const res = await onVm(exec, dest, showUnitCommand(run))
  if (res.code !== 0) return null
  const unit = {}
  for (const line of String(res.stdout ?? '').split('\n')) {
    const at = line.indexOf('=')
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    if (UNIT_PROPERTIES.includes(key)) unit[key] = line.slice(at + 1).trim()
  }
  return typeof unit.ActiveState === 'string' && unit.ActiveState !== '' ? unit : null
}

const unitIsDead = (unit) => unit.ActiveState === 'failed' || unit.Result === 'timeout'

const unitSummary = (unit) => UNIT_PROPERTIES
  .filter((p) => unit[p] !== undefined)
  .map((p) => `${p}=${unit[p]}`)
  .join(' ')

const deathError = (run, unit, state) =>
  `janitor: ${unitOf(run)} ${unitSummary(unit)} while the page said ${state}`

export const CLOSE_OUT_ERROR = 'reaped before the run recorded its end'

export async function sealRun ({ exec = defaultExec, evidence, target, run }) {
  const branch = liveBranchFor(target, run)
  const tag = runTagFor(target, run)
  const saidBy = (res) => output(res).split('\n')[0]
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

async function failRun ({ exec, evidence, target, run, found, at, error, why, journal = null }) {
  const branch = liveBranchFor(target, run)
  if (journal !== null) {
    await ghPut(exec, contentsPath(evidence, target, run, 'janitor-journal.txt'), {
      branch,
      message: `janitor: run ${run} journal at death`,
      content: journal
    })
  }
  const written = { ...found.page, state: 'failed', updatedAt: at, error }
  const res = await ghPut(exec, contentsPath(evidence, target, run, 'status.json'), {
    branch,
    message: `janitor: run ${run} failed — ${why}`,
    content: `${JSON.stringify(written, null, 2)}\n`,
    sha: found.sha
  })
  if (res.code !== 0) return { written: false, error: output(res) }
  return { written: true, sealed: await sealRun({ exec, evidence, target, run }) }
}

async function writeDeath ({ exec, dryRun, row, run, target, evidence, reading, unit, at }) {
  const death = { vm: row.name, run, target, state: reading.state, unit, applied: false }
  if (dryRun) return death
  const journal = await onVm(exec, row.sshDest, journalCommand(run))
  const out = await failRun({
    exec,
    evidence,
    target,
    run,
    found: reading,
    at,
    error: deathError(run, unit, reading.state),
    why: unitSummary(unit),
    journal: journal.code === 0
      ? String(journal.stdout ?? '')
      : `${journal.stdout ?? ''}${journal.stderr ?? ''}`
  })
  if (out.written) {
    death.applied = true
    death.sealed = out.sealed
  } else {
    death.error = out.error
  }
  return death
}

const matchingRefsPath = (target) =>
  `repos/${target}/git/matching-refs/heads/${integrationBranchFor('')}`

const evidenceRefsPath = (evidence, target) =>
  `repos/${evidence}/git/matching-refs/heads/${liveBranchFor(target, '')}`

async function integrationRunsOf (exec, target) {
  const payload = await ghList(exec, matchingRefsPath(target))
  if (!Array.isArray(payload)) return []
  const runs = []
  for (const entry of payload) {
    const run = runOfBranch(entry?.ref)
    if (run !== null && !runs.includes(run)) runs.push(run)
  }
  return runs.sort((a, b) => a - b)
}

export async function decidingPull (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghList(
    exec,
    `repos/${target}/pulls?state=all&per_page=100&head=${owner}:${integrationBranchFor(run)}`
  )
  const rows = Array.isArray(payload) ? payload : []
  let decider = null
  for (const row of rows) {
    const number = Number(row?.number)
    if (!Number.isFinite(number)) continue
    if (decider === null || number > decider.number) decider = { number, state: row.state, mergedAt: row.merged_at ?? null }
  }
  return decider
}

const isClosedUnmerged = (pull) =>
  pull !== null && pull.state === 'closed' && pull.mergedAt === null

async function closedUnmergedBranches (exec, targets) {
  const branches = []
  for (const target of [...targets].sort()) {
    for (const run of await integrationRunsOf(exec, target)) {
      const pull = await decidingPull(exec, target, run)
      if (!isClosedUnmerged(pull)) continue
      branches.push({ target, run, branch: integrationBranchFor(run), pr: pull.number, deleted: false })
    }
  }
  return branches
}

async function carriedNow (exec, target, run) {
  const vms = await listVms(exec)
  return vms.some((row) => {
    const fields = parseComment(row.comment)
    return fields.run === String(run) && fields.target === target
  })
}

async function closeOutOrphans ({ exec, evidence, targets, carried, nowMs, ageMs, now, dryRun }) {
  const closed = []
  const sealed = []
  if (evidence === null) return { closed, sealed }
  for (const target of [...targets].sort()) {
    const payload = await ghList(exec, evidenceRefsPath(evidence, target))
    if (!Array.isArray(payload)) continue
    const orphans = []
    for (const entry of payload) {
      const run = runOfEvidenceRef(target, entry?.ref)
      if (run === null || orphans.includes(run) || carried.has(`${target}#${run}`)) continue
      orphans.push(run)
    }
    for (const run of orphans.sort((a, b) => a - b)) {
      const found = await readContentsAt(exec, evidence, target, run, liveBranchFor(target, run))
      const page = found?.page ?? null
      if (page === null) continue
      const state = typeof page.state === 'string' ? page.state : null
      const ended = REAPABLE_STATES.includes(state)
      if (!ended && !LIVE_STATES.includes(state)) continue
      const updated = Date.parse(String(page.updatedAt))
      if (!Number.isFinite(updated) || nowMs - updated < ageMs) continue
      if (await carriedNow(exec, target, run)) continue
      if (ended) {
        if (dryRun) {
          sealed.push({ target, run, state, sealed: false })
          continue
        }
        const out = await sealRun({ exec, evidence, target, run })
        sealed.push({
          target, run, state, sealed: out.tagged && out.deleted, ...(out.reason === undefined ? {} : { reason: out.reason })
        })
        continue
      }
      if (dryRun) {
        closed.push({ target, run, state, closed: false })
        continue
      }
      const out = await failRun({
        exec, evidence, target, run, found, at: now().toISOString(), error: CLOSE_OUT_ERROR, why: CLOSE_OUT_ERROR
      })
      closed.push({ target, run, state, closed: out.written })
    }
  }
  return { closed, sealed }
}

export async function janitor ({
  argv = [], exec = defaultExec, now = () => new Date(), evidence = null, configPath
}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json', 'help'] })
  const dryRun = opts['dry-run'] === true
  const age = opts.age === undefined || opts.age === true ? DEFAULT_AGE : String(opts.age)
  const ageMs = parseDuration(age)
  if (ageMs === null) throw new Refusal(`janitor: --age must look like 1h or 30m, got ${JSON.stringify(age)}`)
  if (opts.target !== undefined && !isSafeTarget(opts.target)) {
    throw new Refusal(`janitor: --target must be <owner>/<repo>, got ${JSON.stringify(opts.target)}`)
  }
  const evidenceRepo = isSafeTarget(evidence)
    ? evidence
    : await readEvidenceSetting({ path: configPath ?? DEFAULT_CONFIG_PATH() })

  const nowMs = now().getTime()
  const rows = await listVms(exec)

  const actions = []
  const pending = []
  const stale = []
  const unknown = []
  const deaths = []
  const kept = []
  const unread = []
  const runs = []
  const targets = new Set()
  const carried = new Set()
  const nowIso = new Date(nowMs).toISOString()
  for (const row of rows) {
    if (saysNeverReap(row)) {
      const held = assignmentOf(row)
      if (held !== null) carried.add(`${held.target}#${held.run}`)
      kept.push({ vm: row.name, comment: row.comment })
      continue
    }
    const assignment = assignmentOf(row)
    if (assignment === null) {
      unknown.push({ vm: row.name, comment: row.comment })
      continue
    }
    const { run, target } = assignment
    targets.add(target)
    carried.add(`${target}#${run}`)

    const reading = await evidenceReading(exec, evidenceRepo, target, run)
    runs.push({
      vm: row.name,
      run,
      target,
      live: reading?.live ?? null,
      state: reading?.state ?? null
    })
    if (reading === null) {
      unread.push({ vm: row.name, run, target })
      continue
    }

    if (reading.live && typeof row.sshDest === 'string' && isRunNumber(run)) {
      const unit = await readUnit(exec, row.sshDest, run)
      if (unit !== null && unitIsDead(unit)) {
        deaths.push(await writeDeath({
          exec, dryRun, row, run, target, evidence: evidenceRepo, reading, unit, at: nowIso
        }))
        continue
      }
    }

    const updated = Date.parse(String(reading.updatedAt))
    if (!Number.isFinite(updated)) continue

    const plan = reapPlan({ finished: reading.finished, updatedAt: reading.updatedAt, nowMs, ageMs })
    if (plan.action === 'rm') {
      actions.push({
        kind: 'rm',
        vm: row.name,
        run,
        state: reading.state,
        updatedAt: reading.updatedAt,
        command: `rm ${row.name} --json`,
        applied: !dryRun
      })
      continue
    }
    if (plan.action === 'pending') {
      pending.push({ vm: row.name, run, state: reading.state, reapableAt: plan.reapableAt })
    }
    if (nowMs - updated >= STALE_MS) {
      stale.push({
        vm: row.name,
        run,
        state: reading.state,
        lastUpdate: new Date(updated).toISOString(),
        from: reading.from
      })
    }
  }

  const sweep = opts.target === undefined ? targets : new Set([...targets, opts.target])
  const branches = await closedUnmergedBranches(exec, sweep)
  const { closed: closedOut, sealed } = await closeOutOrphans({
    exec, evidence: evidenceRepo, targets: sweep, carried, nowMs, ageMs, now, dryRun
  })

  if (!dryRun) {
    for (const action of actions) {
      try {
        await lobby(exec, action.command)
        action.applied = true
      } catch (error) {
        if (!(error instanceof LobbyError)) throw error
        action.applied = false
        action.error = String(error.message ?? error)
      }
    }
    for (const branch of branches) {
      const res = await exec('gh', ['api', '-X', 'DELETE', `repos/${branch.target}/git/refs/heads/${branch.branch}`])
      branch.deleted = res.code === 0
      if (!branch.deleted) branch.error = output(res)
    }
  }

  return {
    dryRun,
    age,
    actions,
    stale,
    unknown,
    unread,
    deaths,
    branches,
    closedOut,
    sealed,
    kept,
    pending,
    runs,
    evidence: evidenceRepo
  }
}

async function liveDuplicatesOf ({ exec, repoDir, target, evidence, planText, runs }) {
  const candidates = runs.filter((r) => r.target === target && r.live !== false && isRunNumber(r.run))
  if (candidates.length === 0) return []
  const hashed = await exec('git', ['-C', repoDir, 'hash-object', '--stdin'], { input: planText })
  if (hashed.code !== 0) return []
  const wanted = String(hashed.stdout ?? '').trim()
  const found = []
  for (const row of candidates) {
    const branch = liveBranchFor(target, row.run)
    const fetched = await git(exec, repoDir, ['fetch', evidenceUrlFor(evidence), `refs/heads/${branch}`])
    if (fetched.code !== 0) continue
    const planFile = `${runFolderFor(target, row.run)}/${PLAN_FILE}`
    const blob = await git(exec, repoDir, ['rev-parse', '--verify', '--quiet', `FETCH_HEAD:${planFile}`])
    if (blob.code !== 0) continue
    if (String(blob.stdout ?? '').trim() === wanted) found.push({ run: row.run, vm: row.vm })
  }
  return found
}

export async function preflight ({
  exec = defaultExec, now = () => new Date(), evidence, repoDir, target, planText, again = false
}) {
  const reaped = []
  let reapError = null
  let fleetRuns = null
  try {
    const reap = await janitor({ argv: [], exec, now, evidence })
    fleetRuns = Array.isArray(reap.runs) ? reap.runs : []
    for (const action of reap.actions) {
      if (action.kind === 'rm' && action.applied === true) reaped.push(action.vm)
    }
  } catch (error) {
    reapError = String(error?.message ?? error) || 'launch: the reap failed'
  }

  if (fleetRuns === null && again !== true) {
    throw new Refusal(
      `launch: the reap did not answer, so the duplicate guard (#1036) cannot run — ${reapError}; ` +
      'pass --again to launch without it'
    )
  }

  const duplicates = fleetRuns === null
    ? []
    : await liveDuplicatesOf({ exec, repoDir, target, evidence, planText, runs: fleetRuns })
  if (duplicates.length > 0 && again !== true) {
    throw new Refusal(duplicates.map((d) =>
      `launch: run-${d.run} is live on ${target} with this plan (VM ${d.vm}) — nothing was pushed; ` +
      'pass --again to launch it again on purpose (two runs of one plan build the same change twice)'
    ).join('\n'))
  }
  return { reaped, reapError, again: duplicates }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}` +
  (a.error === undefined ? '' : ` (failed: ${a.error})`)

const renderDeath = (d, dryRun) =>
  `${dryRun ? 'would write death' : 'death'} ${d.vm}  run=${d.run} ` +
  `${d.state} → failed: ${unitSummary(d.unit)} — ${liveBranchFor(d.target, d.run)}`

const renderBranch = (b, dryRun) =>
  `${dryRun ? 'would delete' : b.deleted ? 'deleted' : 'kept'} branch ${b.branch}  ` +
  `target=${b.target} PR #${b.pr} closed, not merged` +
  (b.error === undefined ? '' : ` (delete failed: ${b.error})`)

const renderClosedOut = (c, dryRun) =>
  `${dryRun ? 'would close out' : 'closed out'} run=${c.run} target=${c.target} ${c.state} → failed`

const renderSealed = (s, dryRun) => {
  const what = `run=${s.run} target=${s.target} ${s.state}`
  if (dryRun) return `would seal ${what} — its live branch is still there`
  if (s.sealed) return `sealed ${what} — tag ${runTagFor(s.target, s.run)} cut, live branch deleted`
  return `not sealed ${what} — ${s.reason ?? 'unknown'}`
}

const renderUnread = (u, evidence) =>
  `unread ${u.vm}  run=${u.run} ` +
  (evidence === null
    ? 'no evidence repository is set ("evidence" in ~/.ultrapowers/fleet.json)'
    : `no status page in ${evidence} at ${runTagFor(u.target, u.run)} or ${liveBranchFor(u.target, u.run)}`) +
  ' — left alone'

const renderKept = (k) => `kept ${k.vm}  comment says do not reap — never removed`

const renderJanitor = (result) => {
  const lines = [
    ...(result.deaths ?? []).map((d) => renderDeath(d, result.dryRun)),
    ...(result.actions ?? []).map((a) => renderAction(a, result.dryRun)),
    ...(result.kept ?? []).map(renderKept),
    ...(result.stale ?? []).map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`),
    ...(result.pending ?? []).map((p) => `pending ${p.vm}  run=${p.run} state=${p.state ?? 'none'} reapable at ${p.reapableAt}`),
    ...(result.unknown ?? []).map((u) => `unknown ${u.vm}  no readable assignment — look before you rm`),
    ...(result.unread ?? []).map((u) => renderUnread(u, result.evidence ?? null)),
    ...(result.branches ?? []).map((b) => renderBranch(b, result.dryRun)),
    ...(result.closedOut ?? []).map((c) => renderClosedOut(c, result.dryRun)),
    ...(result.sealed ?? []).map((s) => renderSealed(s, result.dryRun))
  ]
  return lines.length === 0 ? 'nothing to do' : lines.join('\n')
}

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json', 'help'] })
  if (opts.help === true) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const result = await janitor({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderJanitor(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
