#!/usr/bin/env node
/**
 * fleet/tests/test_janitor_evidence.mjs — the janitor reads a run's record,
 * and writes its end (the death and the close-out), in the operator's evidence
 * repository (#1395), never the target's; and it deletes a target's
 * integration branch whose pull request closed unmerged, and nothing else there.
 *
 * The evidence record is the default source and the hub is not asked (E1–E3);
 * `record: 'kata'` is the rollback, the hub first and the evidence repository
 * behind it (K1–K2); a run that ended with its live branch left and no tag is
 * sealed (S1–S4).
 *
 * Every call goes through a recording exec stub: the lobby's `ls`, the unit
 * reads over ssh, and `gh api` answered by path. The hub, where a leg needs
 * one, is the real kata client over a recording transport. No socket is
 * opened; the config files live in a temp dir.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { janitor, recordSourceOf } from '../janitor.mjs'
import { makeKataClient } from '../kata-client.mjs'

const TARGET = 'o/r'
const RUN = 5
const VM = 'fleet-r5-1234567890-abcd'
const DEST = 'fleet-r5-1234567890-abcd.exe.xyz'
const HEAD_SHA = 'a'.repeat(40)
const NOW = new Date('2026-09-30T12:00:00Z')
const now = () => NOW

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-evidence-'))
const configAt = (name, body) => {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, body === undefined ? '' : JSON.stringify(body))
  return file
}
const NO_CONFIG = path.join(tmp, 'absent.json')

const envelope = (page, sha = 'b'.repeat(40)) => JSON.stringify({
  content: Buffer.from(JSON.stringify(page), 'utf8').toString('base64'),
  sha
})
const livePage = (updatedAt = '2026-09-30T11:55:00Z') => ({ state: 'running', updatedAt, run: RUN })

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
const notFound = () => ({ code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })

/**
 * A recording exec. `gh` answers are keyed `<METHOD> <path>` (GET for a plain
 * `gh api <path>`); anything unkeyed is a 404. `vms` is the lobby listing,
 * `unit` the ActiveState the VM reports for the run's unit.
 */
function stub ({ vms = [], unit = 'active', gh = {} } = {}) {
  const calls = []
  const exec = async (cmd, args = []) => {
    calls.push({ cmd, args: [...args] })
    if (cmd === 'ssh' && args[0] === 'exe.dev') {
      if (/^ls /.test(args[1])) return ok(JSON.stringify({ vms }))
      return ok('{}')
    }
    if (cmd === 'ssh') {
      const command = args[args.length - 1]
      if (command.includes('systemctl')) {
        return ok(`ActiveState=${unit}\nSubState=${unit === 'failed' ? 'failed' : 'running'}\nResult=${unit === 'failed' ? 'exit-code' : 'success'}\nExecMainStatus=${unit === 'failed' ? 1 : 0}\n`)
      }
      if (command.includes('journalctl')) return ok('the unit died\n')
      return ok('')
    }
    if (cmd === 'gh' && args[0] === 'api') {
      const x = args.indexOf('-X')
      const method = x === -1 ? 'GET' : args[x + 1]
      const apiPath = args.find((a) => a.startsWith('repos/'))
      const answer = gh[`${method} ${apiPath}`]
      if (answer === undefined) return notFound()
      return typeof answer === 'function' ? answer(args) : answer
    }
    return { code: 127, stdout: '', stderr: `unexpected ${cmd}` }
  }
  return { exec, calls }
}

const ghCalls = (calls) => calls.filter((c) => c.cmd === 'gh')
const ghPaths = (calls) => ghCalls(calls).map((c) => c.args.find((a) => a.startsWith('repos/')))
const methodOf = (c) => { const x = c.args.indexOf('-X'); return x === -1 ? 'GET' : c.args[x + 1] }
const field = (c, name) => {
  const hit = c.args.find((a) => a.startsWith(`${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 1)
}

const ROW = { vm_name: VM, ssh_dest: DEST, comment: `run=${RUN} target=${TARGET}` }
const STATUS = (repo) => `repos/${repo}/contents/runs/o-r/5/status.json`
const JOURNAL = (repo) => `repos/${repo}/contents/runs/o-r/5/janitor-journal.txt`

/** The seal's refs-API answers in `repo`, the tag verified at HEAD_SHA. */
const sealAnswers = (repo) => ({
  [`GET repos/${repo}/git/ref/heads/live/o-r/run-5`]: ok(JSON.stringify({ object: { sha: HEAD_SHA } })),
  [`POST repos/${repo}/git/refs`]: ok(JSON.stringify({ ref: 'refs/tags/o-r/run-5' })),
  [`GET repos/${repo}/git/ref/tags/o-r/run-5`]: ok(JSON.stringify({ object: { sha: HEAD_SHA } })),
  [`DELETE repos/${repo}/git/refs/heads/live/o-r/run-5`]: ok('')
})

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed += 1
  process.stdout.write(`ok - ${name}\n`)
}

// M1 — the tag read, then the live-branch read, both in the evidence repo.
await test('M1: the status reads go to the evidence repository, tag then live branch', async () => {
  const { exec, calls } = stub({
    vms: [ROW],
    unit: 'active',
    gh: { [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage())) }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  const paths = ghPaths(calls)
  const tagAt = paths.indexOf(`${STATUS('ops/evidence')}?ref=o-r/run-5`)
  const liveAt = paths.indexOf(`${STATUS('ops/evidence')}?ref=live/o-r/run-5`)
  assert.ok(tagAt !== -1, `no tag read in ${JSON.stringify(paths)}`)
  assert.ok(liveAt > tagAt, `the live read must follow the tag read: ${JSON.stringify(paths)}`)
  assert.deepEqual(paths.filter((p) => p.startsWith('repos/o/r/contents/')), [])
  assert.equal(result.evidence, 'ops/evidence')
  assert.equal(result.deaths.length, 0)
})

// M2 — the death: both PUTs on the live branch, then the tag, then the delete.
await test('M2: a dead unit under a running page writes the death and seals the run', async () => {
  const { exec, calls } = stub({
    vms: [ROW],
    unit: 'failed',
    gh: {
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage())),
      [`PUT ${JOURNAL('ops/evidence')}`]: ok('{}'),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...sealAnswers('ops/evidence')
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  const gh = ghCalls(calls)
  const journalPut = gh.findIndex((c) => methodOf(c) === 'PUT' && c.args.includes(JOURNAL('ops/evidence')))
  const statusPut = gh.findIndex((c) => methodOf(c) === 'PUT' && c.args.includes(STATUS('ops/evidence')))
  const tagPost = gh.findIndex((c) => methodOf(c) === 'POST' && c.args.includes('repos/ops/evidence/git/refs'))
  const del = gh.findIndex((c) => methodOf(c) === 'DELETE' && c.args.includes('repos/ops/evidence/git/refs/heads/live/o-r/run-5'))
  assert.ok(journalPut !== -1 && statusPut > journalPut, 'journal PUT then status PUT')
  assert.equal(field(gh[journalPut], 'branch'), 'live/o-r/run-5')
  assert.equal(field(gh[statusPut], 'branch'), 'live/o-r/run-5')
  const written = JSON.parse(Buffer.from(field(gh[statusPut], 'content'), 'base64').toString('utf8'))
  assert.equal(written.state, 'failed')
  assert.ok(tagPost > statusPut, 'the tag is cut after the status PUT')
  assert.equal(field(gh[tagPost], 'ref'), 'refs/tags/o-r/run-5')
  assert.equal(field(gh[tagPost], 'sha'), HEAD_SHA)
  assert.ok(del > tagPost, 'the live branch is deleted after the tag')
  assert.equal(result.deaths.length, 1)
  assert.equal(result.deaths[0].applied, true)
  assert.deepEqual(result.deaths[0].sealed, { tagged: true, deleted: true })
  assert.deepEqual(ghPaths(calls).filter((p) => p.startsWith('repos/o/r/contents/')), [])
})

// M3 — the orphan listing names the evidence repository's live prefix.
await test('M3: the orphan close-out lists the evidence repository\'s live branches', async () => {
  const { exec, calls } = stub({ vms: [ROW], unit: 'active' })
  await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  assert.ok(ghPaths(calls).includes('repos/ops/evidence/git/matching-refs/heads/live/o-r/run-'))
  assert.ok(!ghPaths(calls).some((p) => p.startsWith('repos/o/r/git/matching-refs/heads/ultra/evidence')))
})

// M3, driven: an orphan found there is closed out in the evidence repository.
await test('M3: an orphan found on the live prefix is closed out there', async () => {
  const other = { vm_name: 'fleet-r9-1234567890-abcd', ssh_dest: 'x', comment: `run=9 target=${TARGET}` }
  const { exec, calls } = stub({
    vms: [other],
    unit: 'active',
    gh: {
      'GET repos/ops/evidence/git/matching-refs/heads/live/o-r/run-': ok(JSON.stringify([
        { ref: 'refs/heads/live/o-r/run-5', object: { sha: HEAD_SHA } }
      ])),
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage('2026-09-30T09:00:00Z'))),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...sealAnswers('ops/evidence')
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  assert.deepEqual(result.closedOut, [{ target: TARGET, run: RUN, state: 'running', closed: true }])
  assert.ok(ghCalls(calls).some((c) => methodOf(c) === 'DELETE' && c.args.includes('repos/ops/evidence/git/refs/heads/live/o-r/run-5')))
})

// M4 — the orphan's end: failed written to the live branch, tag cut, branch
// deleted, and no git at all (folded from close-out.mjs's own leg).
await test('M4: an orphan is written failed, tagged, its live branch deleted, with no git', async () => {
  const { exec, calls } = stub({
    vms: [{ vm_name: 'fleet-r9-1234567890-abcd', ssh_dest: 'x', comment: `run=9 target=${TARGET}` }],
    gh: {
      'GET repos/ops/evidence/git/matching-refs/heads/live/o-r/run-': ok(JSON.stringify([
        { ref: 'refs/heads/live/o-r/run-5', object: { sha: HEAD_SHA } }
      ])),
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage('2026-09-30T09:00:00Z'))),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...sealAnswers('ops/evidence')
    }
  })
  const out = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  assert.deepEqual(out.closedOut, [{ target: TARGET, run: RUN, state: 'running', closed: true }])
  const gh = ghCalls(calls)
  const put = gh.find((c) => methodOf(c) === 'PUT' && c.args.includes(STATUS('ops/evidence')))
  assert.ok(put, 'status PUT')
  assert.equal(field(put, 'branch'), 'live/o-r/run-5')
  const written = JSON.parse(Buffer.from(field(put, 'content'), 'base64').toString('utf8'))
  assert.equal(written.state, 'failed')
  assert.equal(written.error, 'reaped before the run recorded its end')
  assert.equal(written.run, RUN, 'every other cell kept')
  const post = gh.find((c) => methodOf(c) === 'POST' && c.args.includes('repos/ops/evidence/git/refs'))
  assert.equal(field(post, 'ref'), 'refs/tags/o-r/run-5')
  assert.ok(gh.some((c) => methodOf(c) === 'DELETE' && c.args.includes('repos/ops/evidence/git/refs/heads/live/o-r/run-5')))
  assert.ok(!calls.some((c) => c.cmd === 'git'), 'no git at all')
})

// M4, raced: a VM that came up for the orphan since the pass listed the fleet
// is not an orphan — nothing is written.
await test('M4: an orphan the fleet carries when listed again is left alone', async () => {
  let listings = 0
  const late = { vm_name: 'fleet-r5-1234567891-abcd', ssh_dest: DEST, comment: `run=${RUN} target=${TARGET}` }
  const other = { vm_name: 'fleet-r9-1234567890-abcd', ssh_dest: 'x', comment: `run=9 target=${TARGET}` }
  const base = stub({
    gh: {
      'GET repos/ops/evidence/git/matching-refs/heads/live/o-r/run-': ok(JSON.stringify([
        { ref: 'refs/heads/live/o-r/run-5', object: { sha: HEAD_SHA } }
      ])),
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage('2026-09-30T09:00:00Z')))
    }
  })
  const exec = async (cmd, args = []) => {
    if (cmd === 'ssh' && args[0] === 'exe.dev' && /^ls /.test(args[1])) {
      listings += 1
      base.calls.push({ cmd, args: [...args] })
      return ok(JSON.stringify({ vms: listings === 1 ? [other] : [other, late] }))
    }
    return base.exec(cmd, args)
  }
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  assert.deepEqual(result.closedOut, [])
  assert.ok(!ghCalls(base.calls).some((c) => methodOf(c) === 'PUT'), 'no PUT')
})

// The seal keeps the branch when the tag cannot be verified.
await test('sealRun: a tag that does not name the head keeps the live branch', async () => {
  const answers = sealAnswers('ops/evidence')
  answers['POST repos/ops/evidence/git/refs'] = { code: 1, stdout: '', stderr: 'gh: Reference already exists (HTTP 422)' }
  answers['GET repos/ops/evidence/git/ref/tags/o-r/run-5'] = ok(JSON.stringify({ object: { sha: 'c'.repeat(40) } }))
  const { exec, calls } = stub({
    vms: [ROW],
    unit: 'failed',
    gh: {
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage())),
      [`PUT ${JOURNAL('ops/evidence')}`]: ok('{}'),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...answers
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: 'ops/evidence', configPath: NO_CONFIG })
  assert.equal(result.deaths[0].applied, true)
  assert.equal(result.deaths[0].sealed.deleted, false)
  assert.match(result.deaths[0].sealed.reason, /does not name/)
  assert.ok(!ghCalls(calls).some((c) => methodOf(c) === 'DELETE'))
})

// The death's hub marking: one metadata POST under the death's idempotency
// key and no `If-Match` — the client's own patchMetadata, handed a key.
await test('M2: under the kata rollback, a hub-read death marks the run issue under janitor:run-<N>:death, no If-Match', async () => {
  const requests = []
  const issue = { uid: 'u5', status: 'open', revision: 7, updated_at: '2026-09-30T11:55:00Z', metadata: { run: RUN } }
  const transport = {
    async request (req) {
      requests.push(req)
      if (req.method === 'GET' && req.path.endsWith('/projects?limit=1000')) {
        return { status: 200, json: { projects: [{ id: 3, uid: 'p3', name: 'o-r' }] } }
      }
      if (req.method === 'GET' && req.path.endsWith('/issues?limit=1000')) return { status: 200, json: { issues: [issue] } }
      return { status: 200, json: { issue: { ...issue, revision: 8 } } }
    }
  }
  const { exec } = stub({ vms: [ROW], unit: 'failed' })
  const result = await janitor({
    argv: ['--json'], exec, kata: makeKataClient({ transport, actor: 'janitor' }), now, configPath: NO_CONFIG, record: 'kata'
  })
  assert.equal(result.deaths[0].hubMarked, true)
  const patches = requests.filter((r) => r.method === 'POST' && r.path.endsWith('/issues/u5/metadata'))
  assert.equal(patches.length, 1)
  assert.equal(patches[0].headers['Idempotency-Key'], 'janitor:run-5:death')
  assert.equal(patches[0].headers['If-Match'], undefined)
  assert.equal(patches[0].body.patch['work.state'], 'failed')
})

// R1 — the integration-branch sweep (folded from test_retire_integration_only):
// a closed, unmerged pull request's branch is the ONE thing deleted on the
// target; no tag, no PATCH, nothing naming a plan or evidence branch.
const PULLS = 'GET repos/o/r/pulls?state=all&per_page=100&head=o:ultra/integration-run-3'
const sweepAnswers = (pulls) => ({
  'GET repos/o/r/git/matching-refs/heads/ultra/integration-run-': ok(JSON.stringify([
    { ref: 'refs/heads/ultra/integration-run-3', object: { sha: HEAD_SHA } }
  ])),
  [PULLS]: ok(JSON.stringify(pulls)),
  'DELETE repos/o/r/git/refs/heads/ultra/integration-run-3': ok('')
})
const onTarget = (calls) => ghCalls(calls).filter((c) => methodOf(c) !== 'GET' && c.args.some((a) => a.startsWith('repos/o/r/')))
const DELETE_3 = [['api', '-X', 'DELETE', 'repos/o/r/git/refs/heads/ultra/integration-run-3']]

await test('R1: a closed unmerged PR\'s integration branch is deleted, and nothing else on the target', async () => {
  const { exec, calls } = stub({ vms: [ROW], unit: 'active', gh: sweepAnswers([{ number: 12, state: 'closed', merged_at: null }]) })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, configPath: NO_CONFIG })
  assert.deepEqual(onTarget(calls).map((c) => c.args), DELETE_3)
  assert.ok(!calls.some((c) => c.args.some((a) => /plan-run-3|evidence-run-3/.test(String(a)))))
  assert.deepEqual(result.branches, [{ target: TARGET, run: 3, branch: 'ultra/integration-run-3', pr: 12, deleted: true }])
})

await test('R1: --dry-run reads the same and deletes nothing', async () => {
  const { exec, calls } = stub({ vms: [ROW], unit: 'active', gh: sweepAnswers([{ number: 12, state: 'closed', merged_at: null }]) })
  const result = await janitor({ argv: ['--json', '--dry-run'], exec, kata: null, now, configPath: NO_CONFIG })
  assert.deepEqual(onTarget(calls), [])
  assert.equal(result.branches[0].deleted, false)
})

await test('R1: the highest-numbered PR decides; open, merged or none keeps the branch', async () => {
  for (const pulls of [
    [{ number: 12, state: 'closed', merged_at: null }, { number: 20, state: 'open', merged_at: null }],
    [{ number: 20, state: 'closed', merged_at: '2026-09-30T10:00:00Z' }, { number: 12, state: 'closed', merged_at: null }],
    []
  ]) {
    const { exec, calls } = stub({ vms: [ROW], unit: 'active', gh: sweepAnswers(pulls) })
    const result = await janitor({ argv: ['--json'], exec, kata: null, now, configPath: NO_CONFIG })
    assert.deepEqual(onTarget(calls), [], JSON.stringify(pulls))
    assert.deepEqual(result.branches, [])
  }
})

await test('R2: --target sweeps a target no VM names, and refuses one that is not owner/repo', async () => {
  const { exec, calls } = stub({ vms: [], gh: sweepAnswers([{ number: 12, state: 'closed', merged_at: null }]) })
  const result = await janitor({ argv: ['--json', '--target', TARGET], exec, kata: null, now, configPath: NO_CONFIG })
  assert.deepEqual(onTarget(calls).map((c) => c.args), DELETE_3)
  assert.equal(result.branches.length, 1)
  await assert.rejects(janitor({ argv: ['--target', 'not a repo'], exec, kata: null, now, configPath: NO_CONFIG }), /--target must be/)
})

// M5 — handed no evidence, the janitor reads the setting from its config file.
await test('M5: the config file\'s evidence setting steers the status reads', async () => {
  const configPath = configAt('other.json', { evidence: 'ops/other' })
  const { exec, calls } = stub({ vms: [ROW], unit: 'active' })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, configPath })
  assert.ok(ghPaths(calls).includes(`${STATUS('ops/other')}?ref=o-r/run-5`))
  assert.ok(ghPaths(calls).includes(`${STATUS('ops/other')}?ref=live/o-r/run-5`))
  assert.equal(result.evidence, 'ops/other')
})

// M6 — no setting at all: no evidence read, and `evidence` null on the result.
await test('M6: no setting reads nothing from any evidence repository', async () => {
  for (const configPath of [NO_CONFIG, configAt('empty.json', { cpu: '8' })]) {
    const { exec, calls } = stub({ vms: [ROW], unit: 'failed' })
    const result = await janitor({ argv: ['--json'], exec, kata: null, now, configPath })
    const paths = ghPaths(calls)
    assert.deepEqual(paths.filter((p) => p.includes('contents/runs/') || p.includes('matching-refs/heads/live/')), [])
    assert.equal(result.evidence, null)
    assert.equal(result.runs.length, 1)
  }
})

// ── The evidence record decides, and the hub is not asked ──────────────────

const EV = 'ops/evidence'
const vmOf = (run) => `fleet-r${run}-1234567890-abcd`
const rowOf = (run) => ({ vm_name: vmOf(run), ssh_dest: `${vmOf(run)}.exe.xyz`, comment: `run=${run} target=${TARGET}` })
const statusOf = (run) => `repos/${EV}/contents/runs/o-r/${run}/status.json`
const atTag = (run, page) => ({ [`GET ${statusOf(run)}?ref=o-r/run-${run}`]: ok(envelope(page)) })
const atLive = (run, page) => ({ [`GET ${statusOf(run)}?ref=live/o-r/run-${run}`]: ok(envelope(page)) })
const OLD = '2026-09-30T09:00:00Z'
const rmCommands = (calls) => calls
  .filter((c) => c.cmd === 'ssh' && c.args[0] === 'exe.dev' && /^rm /.test(c.args[1]))
  .map((c) => c.args[1])

/** A hub that cannot be reached: every request throws, and every one is counted. */
const darkHub = () => {
  const requests = []
  const transport = { async request (req) { requests.push(req); throw new Error('ssh: connect to host kata-hub.exe.xyz: Connection refused') } }
  return { client: makeKataClient({ transport, actor: 'janitor' }), requests }
}

// E1 — one pass over a done, a parked, a running and an unreadable run, the
// hub unreachable and never asked: the policy file's default is what decides.
await test('E1: with the hub unreachable, a done and a parked run are reaped, a running one left, an unread one never touched', async () => {
  const hub = darkHub()
  const { exec, calls } = stub({
    vms: [rowOf(1), rowOf(2), rowOf(3), rowOf(4)],
    unit: 'active',
    gh: {
      ...atTag(1, { state: 'done', updatedAt: OLD }),
      ...atTag(2, { state: 'parked', updatedAt: OLD }),
      ...atLive(3, { state: 'running', updatedAt: '2026-09-30T11:59:00Z' })
      // run 4: no page at its tag or its live branch.
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: hub.client, now, evidence: EV, configPath: NO_CONFIG })
  assert.equal(result.record, 'evidence', 'the default source')
  assert.equal(hub.requests.length, 0, 'the hub is not asked')
  assert.equal(result.hub, null)
  assert.deepEqual(rmCommands(calls), [`rm ${vmOf(1)} --json`, `rm ${vmOf(2)} --json`])
  assert.deepEqual(result.actions.map((a) => [a.run, a.state, a.applied]), [[1, 'done', true], [2, 'parked', true]])
  assert.deepEqual(result.unread, [{ vm: vmOf(4), run: 4, target: TARGET }])
  assert.deepEqual(result.runs.map((r) => [r.run, r.live, r.state]), [[1, false, 'done'], [2, false, 'parked'], [3, true, 'running'], [4, null, null]])
})

// E2 — a read that fails is not a finished run: gh answering an error for
// every status read removes nothing.
await test('E2: a status read that fails removes nothing', async () => {
  const failed = { code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' }
  const { exec, calls } = stub({
    vms: [rowOf(1)],
    gh: {
      [`GET ${statusOf(1)}?ref=o-r/run-1`]: failed,
      [`GET ${statusOf(1)}?ref=live/o-r/run-1`]: failed
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(rmCommands(calls), [])
  assert.deepEqual(result.actions, [])
  assert.deepEqual(result.unread, [{ vm: vmOf(1), run: 1, target: TARGET }])
})

// E3 — a finished run inside its hour is pending, not removed; the switch's
// default is the policy file's own cell.
await test('E3: a done run inside --age is pending; the repo policy cell says evidence', async () => {
  const { exec, calls } = stub({ vms: [rowOf(1)], gh: atTag(1, { state: 'done', updatedAt: '2026-09-30T11:30:00Z' }) })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(rmCommands(calls), [])
  assert.deepEqual(result.pending, [{ vm: vmOf(1), run: 1, state: 'done', reapableAt: '2026-09-30T12:30:00.000Z' }])
  assert.equal(recordSourceOf(), 'evidence')
  assert.equal(recordSourceOf(configAt('policy-kata.json', { janitor: { record: { source: 'kata' } } })), 'kata')
  assert.equal(recordSourceOf(configAt('policy-odd.json', { janitor: { record: { source: 'elsewhere' } } })), 'evidence')
  assert.equal(recordSourceOf(NO_CONFIG), 'evidence')
})

// ── The rollback: `record: 'kata'` reads as every pass did before ──────────

// K1 — the hub answers: a closed run issue is the finish, and no status page
// is read for that row.
await test('K1: under the kata rollback a closed run issue reaps the VM with no evidence read', async () => {
  const requests = []
  const issue = { uid: 'u1', status: 'closed', closed_reason: 'done', closed_at: OLD, updated_at: OLD, metadata: { run: 1 } }
  const transport = {
    async request (req) {
      requests.push(req)
      if (req.path.endsWith('/projects?limit=1000')) return { status: 200, json: { projects: [{ id: 3, uid: 'p3', name: 'o-r' }] } }
      return { status: 200, json: { issues: [issue] } }
    }
  }
  const { exec, calls } = stub({ vms: [rowOf(1)] })
  const result = await janitor({
    argv: ['--json'], exec, kata: makeKataClient({ transport, actor: 'janitor' }), now, evidence: EV, configPath: NO_CONFIG, record: 'kata'
  })
  assert.equal(result.record, 'kata')
  assert.equal(requests.length, 2, 'the projects listing and the issues page')
  assert.deepEqual(rmCommands(calls), [`rm ${vmOf(1)} --json`])
  assert.deepEqual(ghPaths(calls).filter((p) => p.includes('/status.json')), [])
})

// K2 — the hub is dark: one failed request darkens the pass, the report says
// so, and the row is read off the evidence repository.
await test('K2: under the kata rollback a dark hub is reported and the evidence repository read instead', async () => {
  const hub = darkHub()
  const { exec, calls } = stub({ vms: [rowOf(1), rowOf(2)], gh: { ...atTag(1, { state: 'done', updatedAt: OLD }), ...atTag(2, { state: 'done', updatedAt: OLD }) } })
  const result = await janitor({ argv: ['--json'], exec, kata: hub.client, now, evidence: EV, configPath: NO_CONFIG, record: 'kata' })
  assert.equal(hub.requests.length, 1, 'one dark read, not one per row')
  assert.match(result.hub.dark, /Connection refused/)
  assert.deepEqual(rmCommands(calls), [`rm ${vmOf(1)} --json`, `rm ${vmOf(2)} --json`])
})

// ── A run that ended with its live branch left and no tag is sealed ────────

const liveRefs = (...runs) => ({
  [`GET repos/${EV}/git/matching-refs/heads/live/o-r/run-`]: ok(JSON.stringify(
    runs.map((run) => ({ ref: `refs/heads/live/o-r/run-${run}`, object: { sha: HEAD_SHA } }))
  ))
})
const sealOf = (run) => ({
  [`GET repos/${EV}/git/ref/heads/live/o-r/run-${run}`]: ok(JSON.stringify({ object: { sha: HEAD_SHA } })),
  [`POST repos/${EV}/git/refs`]: ok(JSON.stringify({ ref: `refs/tags/o-r/run-${run}` })),
  [`GET repos/${EV}/git/ref/tags/o-r/run-${run}`]: ok(JSON.stringify({ object: { sha: HEAD_SHA } })),
  [`DELETE repos/${EV}/git/refs/heads/live/o-r/run-${run}`]: ok('')
})
const writes = (calls) => ghCalls(calls).filter((c) => methodOf(c) !== 'GET').map((c) => `${methodOf(c)} ${c.args.find((a) => a.startsWith('repos/'))}`)

// S1 — no VM carries run 7, its page says done and is over an hour old: the
// tag is cut at the branch's head, verified, the branch deleted; the page is
// not rewritten.
await test('S1: an ended run no VM carries, its live branch left, is sealed and its page not rewritten', async () => {
  const { exec, calls } = stub({
    vms: [rowOf(9)],
    gh: { ...liveRefs(7), ...atLive(7, { state: 'done', updatedAt: OLD }), ...sealOf(7) }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(result.sealed, [{ target: TARGET, run: 7, state: 'done', sealed: true }])
  assert.deepEqual(result.closedOut, [])
  assert.deepEqual(writes(calls), [`POST repos/${EV}/git/refs`, `DELETE repos/${EV}/git/refs/heads/live/o-r/run-7`])
  const post = ghCalls(calls).find((c) => methodOf(c) === 'POST')
  assert.equal(field(post, 'ref'), 'refs/tags/o-r/run-7')
  assert.equal(field(post, 'sha'), HEAD_SHA)
})

// S2 — `--dry-run` names it and writes nothing; a page inside `--age` is the
// sandbox still sealing, and is not named at all.
await test('S2: --dry-run names the seal and writes nothing; a page inside --age is left to its sandbox', async () => {
  const dry = stub({ vms: [rowOf(9)], gh: { ...liveRefs(7), ...atLive(7, { state: 'parked', updatedAt: OLD }), ...sealOf(7) } })
  const named = await janitor({ argv: ['--json', '--dry-run'], exec: dry.exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(named.sealed, [{ target: TARGET, run: 7, state: 'parked', sealed: false }])
  assert.deepEqual(writes(dry.calls), [])
  const young = stub({ vms: [rowOf(9)], gh: { ...liveRefs(7), ...atLive(7, { state: 'done', updatedAt: '2026-09-30T11:59:30Z' }), ...sealOf(7) } })
  const left = await janitor({ argv: ['--json'], exec: young.exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(left.sealed, [])
  assert.deepEqual(writes(young.calls), [])
})

// S3 — a seal the evidence repository refuses keeps the branch and says why.
await test('S3: a refused seal keeps the live branch and reports the reason', async () => {
  const { exec, calls } = stub({
    vms: [rowOf(9)],
    gh: {
      ...liveRefs(7),
      ...atLive(7, { state: 'done', updatedAt: OLD }),
      ...sealOf(7),
      [`POST repos/${EV}/git/refs`]: { code: 1, stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)' }
    }
  })
  const result = await janitor({ argv: ['--json'], exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.equal(result.sealed.length, 1)
  assert.equal(result.sealed[0].sealed, false)
  assert.match(result.sealed[0].reason, /tag o-r\/run-7 refused/)
  assert.ok(!writes(calls).some((w) => w.startsWith('DELETE')))
})

// S4 — `--target` reaches a target no VM names: its ended run is sealed too,
// and a VM that still carries a run keeps that run's branch.
await test('S4: --target seals on a target no VM names; a carried run is never sealed', async () => {
  const bare = stub({ vms: [], gh: { ...liveRefs(7), ...atLive(7, { state: 'done', updatedAt: OLD }), ...sealOf(7) } })
  const result = await janitor({ argv: ['--json', '--target', TARGET], exec: bare.exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(result.sealed, [{ target: TARGET, run: 7, state: 'done', sealed: true }])
  const carried = stub({ vms: [rowOf(7)], gh: { ...liveRefs(7), ...atLive(7, { state: 'done', updatedAt: OLD }), ...sealOf(7) } })
  const kept = await janitor({ argv: ['--json'], exec: carried.exec, kata: null, now, evidence: EV, configPath: NO_CONFIG })
  assert.deepEqual(kept.sealed, [])
  assert.deepEqual(writes(carried.calls), [])
  assert.deepEqual(rmCommands(carried.calls), [`rm ${vmOf(7)} --json`], 'its VM is reaped on the page it has')
})

fs.rmSync(tmp, { recursive: true, force: true })
process.stdout.write(`${passed} tests\nALL TESTS PASSED\n`)
