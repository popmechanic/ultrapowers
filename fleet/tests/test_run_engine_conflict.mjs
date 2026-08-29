// fleet/tests/test_run_engine_conflict.mjs — the contended path: two tasks
// edit the same line, the real kernel stops with a conflict, the resolver
// replies THROUGH ITS SCHEMA (read-only role), the driver writes the reply
// directory and drives resolve → materialize → adopt. Plus the BLOCKED
// resolver route: the wave blocks cleanly (no git-merge fallback exists).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-conf-'))
const waves = () => [[
  { id: 'A', title: 'A edits line2', files: ['a.txt'], tier: 'standard', review: 'lean',
    writes: ['a.txt'], commutes: [], body: 'task A' },
  { id: 'B', title: 'B edits line2', files: ['a.txt'], tier: 'standard', review: 'lean',
    writes: ['a.txt'], commutes: [], body: 'task B' },
]]

// ── 1. conflict → resolver schema reply → driver-written reply dir → adopt ──
{
  const repo = makeRepo(path.join(tmp, 'r1'))
  const resolverLabels = []
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, 'a.txt'),
        'line1\n' + (id === 'A' ? 'line2 from A' : 'line2 from B') + '\nline3\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'resolve') {
      resolverLabels.push(opts.label)
      // The brief names the hunks file; read it, answer every HUNK header
      // with a merge of both sides — content OUT through the schema, no file
      // writes (the role is read-only; the driver writes the reply dir).
      const m = /\nHUNKS FILE: (\S+)/.exec(prompt)
      assert.ok(m, 'resolver brief carries the hunks file path')
      const hunksText = fs.readFileSync(m[1], 'utf8')
      const ids = [...hunksText.matchAll(/^HUNK (\S+) /gm)].map((x) => x[1])
      assert.ok(ids.length >= 1, 'at least one hunk to resolve')
      return { status: 'RESOLVED',
               hunks: ids.map((id) => ({ id, content: 'line2 from A\nline2 from B' })),
               notes: 'merged both sides' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run1'), waves: waves(), stub, stamp: 'cf1' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.waveMerges) +
    ' judgments: ' + JSON.stringify(report.judgmentCalls))
  assert.ok(resolverLabels.length >= 1, 'a resolver was dispatched')
  const tip = gitSync(['rev-parse', 'ultra/integration-cf1'], integ)
  const merged = gitSync(['show', tip + ':a.txt'], integ)
  assert.ok(merged.includes('line2 from A') && merged.includes('line2 from B'),
    'both sides survived the fold: ' + JSON.stringify(merged))
  assert.equal(report.gitVerified, true)
  assert.equal(report.tests.passed, true)
  const fr = report.frontier[0]
  assert.ok(fr.resolverTranscripts.length >= 1, 'the resolver transcript is recorded')
  assert.equal(fr.selfChecks, 'ok')
}

// ── 2. a BLOCKED resolver blocks the wave cleanly ───────────────────────────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, 'a.txt'),
        'line1\n' + (id === 'A' ? 'A version' : 'B version') + '\nline3\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'resolve') return { status: 'BLOCKED', notes: 'cannot reconcile' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run2'), waves: waves(), stub, stamp: 'cf2' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'CONFLICT')
  assert.ok(report.blockedWaves.length === 1)
  assert.equal(report.gitVerified, false)
  // The integration branch never moved.
  const tip = gitSync(['rev-parse', 'ultra/integration-cf2'], integ)
  assert.equal(gitSync(['show', tip + ':a.txt'], integ), 'line1\nline2\nline3')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
