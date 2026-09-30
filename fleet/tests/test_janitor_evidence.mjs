#!/usr/bin/env node
/**
 * fleet/tests/test_janitor_evidence.mjs — the janitor and the close-out read a
 * run's record, and write its end, in the operator's evidence repository
 * (#1395), never the target's.
 *
 * Every call goes through a recording exec stub: the lobby's `ls`, the unit
 * reads over ssh, and `gh api` answered by path. No socket is opened; the
 * config files live in a temp dir.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { closeOut } from '../close-out.mjs'
import { janitor } from '../janitor.mjs'

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

// M4 — closeOut: failed written to the live branch, tag cut, branch deleted, no ls-remote.
await test('M4: closeOut writes failed, tags, deletes the live branch, runs no ls-remote', async () => {
  const { exec, calls } = stub({
    vms: [],
    gh: {
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage())),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...sealAnswers('ops/evidence')
    }
  })
  const out = await closeOut({ exec, target: TARGET, run: RUN, evidence: 'ops/evidence', now })
  assert.equal(out.closed, true)
  assert.equal(out.reason, 'closed out as failed')
  const gh = ghCalls(calls)
  const put = gh.find((c) => methodOf(c) === 'PUT' && c.args.includes(STATUS('ops/evidence')))
  assert.ok(put, 'status PUT')
  assert.equal(field(put, 'branch'), 'live/o-r/run-5')
  const written = JSON.parse(Buffer.from(field(put, 'content'), 'base64').toString('utf8'))
  assert.equal(written.state, 'failed')
  const post = gh.find((c) => methodOf(c) === 'POST' && c.args.includes('repos/ops/evidence/git/refs'))
  assert.equal(field(post, 'ref'), 'refs/tags/o-r/run-5')
  assert.ok(gh.some((c) => methodOf(c) === 'DELETE' && c.args.includes('repos/ops/evidence/git/refs/heads/live/o-r/run-5')))
  assert.ok(!calls.some((c) => c.args.includes('ls-remote')), 'no git ls-remote')
  assert.ok(!calls.some((c) => c.cmd === 'git'), 'no git at all')
})

// The seal keeps the branch when the tag cannot be verified.
await test('sealRun: a tag that does not name the head keeps the live branch', async () => {
  const answers = sealAnswers('ops/evidence')
  answers['POST repos/ops/evidence/git/refs'] = { code: 1, stdout: '', stderr: 'gh: Reference already exists (HTTP 422)' }
  answers['GET repos/ops/evidence/git/ref/tags/o-r/run-5'] = ok(JSON.stringify({ object: { sha: 'c'.repeat(40) } }))
  const { exec, calls } = stub({
    vms: [],
    gh: {
      [`GET ${STATUS('ops/evidence')}?ref=live/o-r/run-5`]: ok(envelope(livePage())),
      [`PUT ${STATUS('ops/evidence')}`]: ok('{}'),
      ...answers
    }
  })
  const out = await closeOut({ exec, target: TARGET, run: RUN, evidence: 'ops/evidence', now })
  assert.equal(out.closed, true)
  assert.match(out.reason, /seal failed/)
  assert.ok(!ghCalls(calls).some((c) => methodOf(c) === 'DELETE'))
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

fs.rmSync(tmp, { recursive: true, force: true })
process.stdout.write(`${passed} tests\nALL TESTS PASSED\n`)
