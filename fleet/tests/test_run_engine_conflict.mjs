// fleet/tests/test_run_engine_conflict.mjs — the contended path: two tasks
// edit the same line, the real kernel stops with a conflict, the resolver
// replies THROUGH ITS SCHEMA (read-only role), the driver writes the reply
// directory and drives resolve → materialize → adopt. Plus the BLOCKED
// resolver route: the wave blocks cleanly (no git-merge fallback exists).
//
// Since #715 decision 3 the loop itself is a FUNCTION the folder can call:
// `resolveConflicts(...)` exported from fleet/run-engine.mjs. The two shapes
// below are the wave loop's end of that contract (M3, M4); the section headed
// "Task 1" calls the function directly with stub `agent`/`runCli` seams so the
// dispatch, retry, park and event rules (M1, M2, M5) are examined without a
// second kernel run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import * as engine from '../run-engine.mjs'

const { resolveConflicts, RESOLVER_SCHEMA } = engine
// M1 — the extraction itself: the loop is a callable export, not inline code.
assert.equal(typeof resolveConflicts, 'function',
  'M1: fleet/run-engine.mjs must export resolveConflicts({ agent, runCli, roles, common, ' +
  'taskArgs, commutesArgs, open, contendingBlock, waveDir, labelPrefix, onEvent })')

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
  const resolverPrompts = []
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
      resolverPrompts.push(prompt)
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
  const runDir = path.join(tmp, 'run1')
  const { run, integ } = rig({ repo, runDir, waves: waves(), stub, stamp: 'cf1' })
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

  // M4 leg (d) — the pre-existing resolved shape still holds after the
  // extraction, and the wave loop still supplies its own labelPrefix
  // ('resolve:wave' + waveNumber) and waveDir (<runDir>/frontier/wave-<n>).
  // The conflict index is the kernel's; the label and the reply directory are
  // the engine's, so both are checked against that index.
  assert.equal(resolverLabels.length, 1,
    'M4 (d): the resolved shape dispatches exactly one resolver: ' + JSON.stringify(resolverLabels))
  const t0 = fr.resolverTranscripts[0]
  assert.equal(fr.resolverTranscripts.length, 1,
    'M4 (d): one resolver transcript survives the extraction (a wave loop that dropped the ' +
    'returned transcripts fails here)')
  assert.equal(resolverLabels[0], 'resolve:wave1:' + t0.conflict + ':1',
    'M4 (d): labelPrefix is exactly resolve:wave1 — got ' + resolverLabels[0])
  assert.equal(t0.replyDir,
    path.join(runDir, 'frontier', 'wave-1', 'reply-' + t0.conflict + '-1'),
    'M4 (d): waveDir is exactly <runDir>/frontier/wave-1')
  assert.equal(t0.attempt, 1, 'M4 (d): the resolved shape resolves on the first attempt')
  assert.equal(t0.status, 'RESOLVED', 'M4 (d): the transcript records the reply status')

  // M3 leg (c) — the wave loop builds the contending block and it reaches the
  // prompt as its tail: one line per wave task, in wave order.
  const p0 = resolverPrompts[0]
  const iBlock = p0.indexOf('\nCONTENDING TASKS:')
  assert.ok(iBlock !== -1, 'M3 (c): the prompt carries \\nCONTENDING TASKS:')
  const iA = p0.indexOf('\n- task A: A edits line2 [files: a.txt]')
  const iB = p0.indexOf('\n- task B: B edits line2 [files: a.txt]')
  assert.ok(iA > iBlock, 'M3 (c): task A\'s line follows CONTENDING TASKS: — ' + JSON.stringify(p0))
  assert.ok(iB > iA, 'M3 (c): task B\'s line follows task A\'s, in wave order')
  // This rig sets no wavesPath, so the pointer sentence must be absent.
  assert.ok(!p0.includes('Their full verbatim task text'),
    'M3 (c): with no wavesPath the prompt carries no "Their full verbatim task text" sentence')
}

// ── 1b. the same shape with wavesPath set: the block gains the pointer ──────
// M3 leg (c) — the launch.json pointer sentence rides the contending block.
{
  const repo = makeRepo(path.join(tmp, 'r1b'))
  const wavesPath = path.join(tmp, 'waves-1b.json')
  fs.writeFileSync(wavesPath, JSON.stringify({ tasks: waves().flat() }))
  const resolverPrompts = []
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
      resolverPrompts.push(prompt)
      const m = /\nHUNKS FILE: (\S+)/.exec(prompt)
      assert.ok(m, 'resolver brief carries the hunks file path')
      const ids = [...fs.readFileSync(m[1], 'utf8').matchAll(/^HUNK (\S+) /gm)].map((x) => x[1])
      return { status: 'RESOLVED',
               hunks: ids.map((id) => ({ id, content: 'line2 from A\nline2 from B' })),
               notes: 'merged both sides' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run1b'), waves: waves(), stub,
                        stamp: 'cf1b', extraArgs: { wavesPath } })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.waveMerges))
  assert.equal(resolverPrompts.length, 1, 'M3 (c): one resolver dispatch')
  const p = resolverPrompts[0]
  const iBlock = p.indexOf('\nCONTENDING TASKS:')
  assert.ok(iBlock !== -1, 'M3 (c): the prompt carries \\nCONTENDING TASKS:')
  assert.ok(p.indexOf('\n- task A: A edits line2 [files: a.txt]') > iBlock,
    'M3 (c): task A\'s line follows the header')
  assert.ok(p.indexOf('\n- task B: B edits line2 [files: a.txt]') >
    p.indexOf('\n- task A: A edits line2 [files: a.txt]'),
    'M3 (c): task B\'s line follows task A\'s')
  assert.ok(p.includes('Their full verbatim task text lives in the JSON file at ' + wavesPath +
    ' — read the "tasks" array entry whose "id" matches.'),
    'M3 (c): with wavesPath set the pointer sentence is verbatim in the block: ' + JSON.stringify(p))
}

// ── 2. a BLOCKED resolver blocks the wave cleanly ───────────────────────────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const resolverLabels = []
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, 'a.txt'),
        'line1\n' + (id === 'A' ? 'A version' : 'B version') + '\nline3\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'resolve') {
      resolverLabels.push(opts.label)
      return { status: 'BLOCKED', notes: 'cannot reconcile' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const runDir = path.join(tmp, 'run2')
  const { run, integ } = rig({ repo, runDir, waves: waves(), stub, stamp: 'cf2' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'CONFLICT')
  assert.ok(report.blockedWaves.length === 1)
  assert.equal(report.gitVerified, false)
  // The integration branch never moved.
  const tip = gitSync(['rev-parse', 'ultra/integration-cf2'], integ)
  assert.equal(gitSync(['show', tip + ':a.txt'], integ), 'line1\nline2\nline3')

  // M4 leg (d) — the BLOCKED shape after the extraction: the wave loop appends
  // the function's transcripts to its own BEFORE calling blocked(reason), so
  // exactly one transcript reaches the frontier entry.
  const fr = report.frontier[0]
  assert.equal(fr.resolverTranscripts.length, 1,
    'M4 (d): frontier[0].resolverTranscripts has length exactly 1 — a wave loop that dropped ' +
    'the returned transcripts fails here: ' + JSON.stringify(fr.resolverTranscripts))
  const t0 = fr.resolverTranscripts[0]
  assert.equal(t0.status, 'BLOCKED', 'M4 (d): the transcript records status BLOCKED')
  assert.equal(t0.attempt, 1, 'M4 (d): a BLOCKED reply is not retried — attempt 1')
  assert.equal(resolverLabels.length, 1,
    'M4 (d): a BLOCKED resolver is dispatched exactly once: ' + JSON.stringify(resolverLabels))
  assert.equal(resolverLabels[0], 'resolve:wave1:' + t0.conflict + ':1',
    'M4 (d): labelPrefix is exactly resolve:wave1 — got ' + resolverLabels[0])
  assert.equal(t0.replyDir,
    path.join(runDir, 'frontier', 'wave-1', 'reply-' + t0.conflict + '-1'),
    'M4 (d): waveDir is exactly <runDir>/frontier/wave-1')
}

// ════════════════════════════════════════════════════════════════════════════
// Task 1 (#715 decision 3): the resolver loop is a function the folder can
// call. Direct calls with a stub `agent` and a stub `runCli` answering the
// kernel's JSON shapes — no kernel, no wave loop, no `.` repo, no wave label.
// ════════════════════════════════════════════════════════════════════════════

const ROLE = 'RESOLVER ROLE TEXT — reply through the schema.\n'
const WAVES_JSON = path.join(tmp, 'folder-waves.json')
// The caller's block, opaque to the function: it must reach the prompt as its
// verbatim tail, and it starts with \nCONTENDING TASKS: so the retry leg can
// check the rejection line sits immediately before it.
const BLOCK = '\nCONTENDING TASKS:' +
  '\n- task Z: Z rewrites a.txt [files: a.txt]' +
  '\nTheir full verbatim task text lives in the JSON file at ' + WAVES_JSON +
  ' — read the "tasks" array entry whose "id" matches.'
const COMMON = ['--repo', 'x', '--run-dir', 'y', '--wave', '1']
const TASK_ARGS = ['--patch', 'main=m.patch', '--patch', 'run-7=r.patch']
const COMMUTES_ARGS = ['--commutes', 'run-7=a.txt']
const PREFIX = 'resolve:publish-fold:1'

let dirSeq = 0
const freshWaveDir = () => {
  const d = path.join(tmp, 'folder-wave-' + (++dirSeq))
  fs.mkdirSync(d, { recursive: true })
  return d
}
const hunksFile = (name, ids = ['h1']) => {
  const p = path.join(tmp, name)
  fs.writeFileSync(p, ids.map((id) => 'HUNK ' + id + ' a.txt @@ -1,3 +1,3 @@\nfrontier: old\nZ: new\n').join(''))
  return p
}
// The kernel's JSON shapes, as the driver's runCli returns them.
const cliOk = () => ({ code: 0, stdout: '', stderr: '',
                       parsed: { applied: true, complete: true, selfChecks: 'ok' } })
const cliWaiting = (waiting) => ({ code: 0, stdout: '', stderr: '',
                                   parsed: { applied: true, waiting } })
const cliRejected = (reason) => ({ code: 4, stdout: '', stderr: '', parsed: { reason } })

const resolvedReply = (ids = ['h1']) => ({
  status: 'RESOLVED',
  hunks: ids.map((id) => ({ id, content: 'frontier: old\nZ: new' })),
  notes: 'took both sides',
})

// ── (a) [M1] one conflict: dispatch, reply dir, resolve argv, ok ────────────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('a1.hunks.txt')
  const seen = []
  const agent = async (prompt, opts) => { seen.push({ prompt, opts }); return resolvedReply() }
  const argvs = []
  const runCli = async (argv) => { argvs.push(argv); return cliOk() }

  const out = await resolveConflicts({
    agent, runCli, roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS,
    commutesArgs: COMMUTES_ARGS, open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })

  assert.equal(out.ok, true, '(a) M1: a resolved conflict resolves ok: true — ' + JSON.stringify(out))
  assert.equal(out.reason, '', '(a) M1: ok: true carries an empty reason')
  assert.equal(out.selfChecks, 'ok', "(a) M1: selfChecks is the kernel's 'ok'")
  assert.equal(out.transcripts.length, 1, '(a) M1: exactly one transcript')
  assert.equal(out.transcripts[0].conflict, 0, '(a) M1: the transcript names conflict 0')
  assert.equal(out.transcripts[0].attempt, 1, '(a) M1: attempt 1')
  assert.equal(out.transcripts[0].path, 'a.txt', '(a) M1: the transcript names the path')
  assert.equal(out.transcripts[0].status, 'RESOLVED', '(a) M1: the transcript records the status')
  assert.equal(out.transcripts[0].replyDir, path.join(waveDir, 'reply-0-1'),
    '(a) M1: the transcript names <waveDir>/reply-0-1')

  // Exactly one dispatch, and its prompt is the M1 formula to the byte.
  assert.equal(seen.length, 1, '(a) M1: exactly one dispatch — ' +
    JSON.stringify(seen.map((s) => s.opts.label)))
  assert.equal(seen[0].opts.label, 'resolve:publish-fold:1:0:1',
    '(a) M1: the label is labelPrefix + ":" + i + ":" + attempt')
  assert.equal(seen[0].opts.schema, RESOLVER_SCHEMA,
    '(a) M1: the dispatch carries RESOLVER_SCHEMA')
  assert.equal(seen[0].prompt,
    ROLE + '\nHUNKS FILE: ' + hf + ' (conflicted path: a.txt)' + BLOCK,
    '(a) M1/M3: the prompt is roles.resolver + the HUNKS FILE line + contendingBlock verbatim')
  assert.ok(seen[0].prompt.startsWith(ROLE), '(a) M1: the prompt starts with roles.resolver')
  assert.ok(seen[0].prompt.includes('\nHUNKS FILE: ' + hf + ' (conflicted path: a.txt)'),
    '(a) M1: the prompt carries the hunks file and the conflicted path')
  assert.ok(seen[0].prompt.endsWith(BLOCK),
    '(a) M3: contendingBlock is the prompt\'s verbatim tail')

  // The driver writes the reply directory: <hunk id>.txt newline-terminated,
  // plus notes.txt.
  const replyDir = path.join(waveDir, 'reply-0-1')
  assert.equal(fs.readFileSync(path.join(replyDir, 'h1.txt'), 'utf8'),
    'frontier: old\nZ: new\n', '(a) M1: <waveDir>/reply-0-1/h1.txt is newline-terminated')
  const notes = fs.readFileSync(path.join(replyDir, 'notes.txt'), 'utf8')
  assert.ok(notes === 'took both sides\n' || notes === 'took both sides',
    '(a) M1: notes.txt holds the reply\'s notes — ' + JSON.stringify(notes))

  // One `resolve` call, argv exactly as M1 spells it.
  assert.equal(argvs.length, 1, '(a) M1: runCli was called exactly once')
  assert.deepEqual(argvs[0], ['resolve', ...COMMON, '--conflict', '0', '--reply-dir', replyDir,
    ...TASK_ARGS, ...COMMUTES_ARGS],
    "(a) M1: ['resolve', ...common, '--conflict', String(i), '--reply-dir', replyDir, " +
    '...taskArgs, ...commutesArgs]')
}

// ── (a) [M1] an empty commutesArgs ends the argv at taskArgs ────────────────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('a2.hunks.txt')
  const argvs = []
  const out = await resolveConflicts({
    agent: async () => resolvedReply(),
    runCli: async (argv) => { argvs.push(argv); return cliOk() },
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: [],
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })
  assert.equal(out.ok, true, '(a) M1: resolves ok with an empty commutesArgs')
  assert.equal(argvs.length, 1, '(a) M1: one resolve call')
  assert.deepEqual(argvs[0], ['resolve', ...COMMON, '--conflict', '0', '--reply-dir',
    path.join(waveDir, 'reply-0-1'), ...TASK_ARGS],
    '(a) M1: with commutesArgs [] the argv ends exactly at ...taskArgs')
}

// ── (a) [M1] two conflicts: walked in `open` order, one at a time ───────────
{
  const waveDir = freshWaveDir()
  const hfA = hunksFile('a3a.hunks.txt')
  const hfB = hunksFile('a3b.hunks.txt')
  const seen = []
  const argvs = []
  const out = await resolveConflicts({
    agent: async (prompt, opts) => { seen.push(opts.label); return resolvedReply() },
    runCli: async (argv) => {
      argvs.push(argv)
      return argv[argv.indexOf('--conflict') + 1] === '0' ? cliWaiting([1]) : cliOk()
    },
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hfA, epoch: 1 },
           { i: 1, path: 'b.txt', hunksFile: hfB, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })
  assert.deepEqual(seen, ['resolve:publish-fold:1:0:1', 'resolve:publish-fold:1:1:1'],
    '(a) M1: `open` is walked in order, exactly two dispatches')
  assert.equal(out.ok, true, '(a) M1: both conflicts resolved → ok: true — ' + JSON.stringify(out))
  assert.equal(out.selfChecks, 'ok', '(a) M1: selfChecks from the completing call')
  assert.equal(out.transcripts.length, 2, '(a) M1: two transcripts')
  assert.deepEqual(out.transcripts.map((t) => t.conflict), [0, 1],
    '(a) M1: the transcripts are in dispatch order')
  assert.deepEqual(out.transcripts.map((t) => t.path), ['a.txt', 'b.txt'],
    '(a) M1: each transcript names its own conflicted path')
  assert.equal(argvs.length, 2, '(a) M1: one resolve call per conflict')
}

// ── (b) [M2] exit 4 → one retry carrying the kernel's reason, then park ─────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('b1.hunks.txt')
  const seen = []
  const argvs = []
  const out = await resolveConflicts({
    agent: async (prompt, opts) => { seen.push({ prompt, label: opts.label }); return resolvedReply() },
    runCli: async (argv) => { argvs.push(argv); return cliRejected('bad hunk') },
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })
  assert.equal(seen.length, 2,
    '(b) M2: exit 4 re-dispatches the same conflict exactly once more — no third dispatch: ' +
    JSON.stringify(seen.map((s) => s.label)))
  assert.deepEqual(seen.map((s) => s.label),
    ['resolve:publish-fold:1:0:1', 'resolve:publish-fold:1:0:2'],
    '(b) M2: the retry is attempt 2 of the same conflict')
  assert.ok(!seen[0].prompt.includes('PREVIOUS REPLY REJECTED'),
    '(b) M2: the first prompt carries no PREVIOUS REPLY REJECTED')
  assert.equal(seen[1].prompt,
    ROLE + '\nHUNKS FILE: ' + hf + ' (conflicted path: a.txt)' +
    '\nPREVIOUS REPLY REJECTED: bad hunk' + BLOCK,
    "(b) M2: '\\nPREVIOUS REPLY REJECTED: <reason>' is inserted before '\\nCONTENDING TASKS:'")
  assert.equal(seen[1].prompt.indexOf('\nPREVIOUS REPLY REJECTED: bad hunk') +
    '\nPREVIOUS REPLY REJECTED: bad hunk'.length,
    seen[1].prompt.indexOf('\nCONTENDING TASKS:'),
    '(b) M2: the rejection line sits immediately before \\nCONTENDING TASKS:')
  assert.ok(fs.existsSync(path.join(waveDir, 'reply-0-1', 'h1.txt')),
    '(b) M2: attempt 1 wrote reply-0-1')
  assert.ok(fs.existsSync(path.join(waveDir, 'reply-0-2', 'h1.txt')),
    '(b) M2: attempt 2 wrote reply-0-2')
  assert.deepEqual(argvs.map((a) => a[a.indexOf('--reply-dir') + 1]),
    [path.join(waveDir, 'reply-0-1'), path.join(waveDir, 'reply-0-2')],
    '(b) M2: each attempt drives resolve with its own reply dir')
  assert.equal(out.ok, false, '(b) M2: a second exit 4 parks')
  assert.equal(out.reason, 'resolver reply rejected twice on a.txt: bad hunk',
    "(b) M2: the reason names the conflicted path and the kernel's reason")
}

// ── (b) [M2] a non-RESOLVED status parks at once, with no resolve call ──────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('b2.hunks.txt')
  const seen = []
  const argvs = []
  const out = await resolveConflicts({
    agent: async (prompt, opts) => { seen.push(opts.label); return { status: 'BLOCKED', notes: 'cannot' } },
    runCli: async (argv) => { argvs.push(argv); return cliOk() },
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })
  assert.equal(seen.length, 1, '(b) M2: a BLOCKED reply is dispatched exactly once')
  assert.equal(argvs.length, 0, '(b) M2: a BLOCKED reply drives no resolve')
  assert.equal(out.ok, false, '(b) M2: a status other than RESOLVED parks')
  assert.equal(out.reason, 'resolver reported BLOCKED on a.txt',
    '(b) M2: the reason names the status and the conflicted path')
  assert.equal(out.transcripts.length, 1, '(b) M2: the BLOCKED reply is still transcribed')
  assert.equal(out.transcripts[0].status, 'BLOCKED', '(b) M2: the transcript records BLOCKED')
}

// ── (b) [M2] two null replies park after exactly two dispatches ─────────────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('b3.hunks.txt')
  const seen = []
  const argvs = []
  const out = await resolveConflicts({
    agent: async (prompt, opts) => { seen.push({ prompt, label: opts.label }); return null },
    runCli: async (argv) => { argvs.push(argv); return cliOk() },
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
  })
  assert.equal(seen.length, 2,
    '(b) M2: a first null reply is retried once and no more: ' +
    JSON.stringify(seen.map((s) => s.label)))
  assert.deepEqual(seen.map((s) => s.label),
    ['resolve:publish-fold:1:0:1', 'resolve:publish-fold:1:0:2'],
    '(b) M2: the null retry is attempt 2 of the same conflict')
  assert.ok(seen[1].prompt.includes(
    '\nPREVIOUS REPLY REJECTED: the previous resolver produced no reply (transient death) — resolve afresh'),
    '(b) M2: the null retry carries the transient-death rejection text verbatim')
  assert.equal(argvs.length, 0, '(b) M2: a null reply drives no resolve')
  assert.equal(out.ok, false, '(b) M2: a second null reply parks')
  assert.equal(out.reason, 'resolver dispatch returned no reply twice on a.txt',
    '(b) M2: the reason names the conflicted path')
  assert.equal(out.transcripts.length, 0, '(b) M2: a null reply has nothing to transcribe')
}

// ── (b) [M2] a RUN_FATAL agent error is rethrown, not parked ────────────────
{
  const waveDir = freshWaveDir()
  const hf = hunksFile('b4.hunks.txt')
  const boom = new Error('RUN_FATAL: dead')
  let calls = 0
  await assert.rejects(
    () => resolveConflicts({
      agent: async () => { calls += 1; throw boom },
      runCli: async () => cliOk(),
      roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
      open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
      contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
    }),
    (e) => {
      assert.equal(e, boom, '(b) M2: the RUN_FATAL error itself is rethrown')
      assert.equal(e.message, 'RUN_FATAL: dead', '(b) M2: with its message intact')
      return true
    },
    '(b) M2: an agent error whose message starts RUN_FATAL is rethrown, not turned into ok: false')
  assert.equal(calls, 1, '(b) M2: the fatal is not retried')
}

// ── (e) [M5] onEvent fires once per non-null reply; absent, nothing changes ─
{
  // The resolved shape of leg (a), with a spy.
  const waveDir = freshWaveDir()
  const hf = hunksFile('e1.hunks.txt')
  const events = []
  const out = await resolveConflicts({
    agent: async () => resolvedReply(),
    runCli: async () => cliOk(),
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
    onEvent: (e) => events.push(e),
  })
  assert.equal(out.ok, true, '(e) M5: onEvent does not change the outcome')
  assert.equal(events.length, 1, '(e) M5: exactly one event for one non-null reply')
  assert.deepEqual(events[0], { kind: 'resolver:reply', label: 'resolve:publish-fold:1:0:1',
    conflict: 0, attempt: 1, status: 'RESOLVED' },
    '(e) M5: the event is { kind, label, conflict, attempt, status }')
}
{
  // The rejected-twice shape of leg (b), with a spy: two events, attempts 1, 2.
  const waveDir = freshWaveDir()
  const hf = hunksFile('e2.hunks.txt')
  const events = []
  const out = await resolveConflicts({
    agent: async () => resolvedReply(),
    runCli: async () => cliRejected('bad hunk'),
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
    onEvent: (e) => events.push(e),
  })
  assert.equal(out.ok, false, '(e) M5: the rejected-twice outcome is unchanged by onEvent')
  assert.equal(out.reason, 'resolver reply rejected twice on a.txt: bad hunk',
    '(e) M5: and so is its reason')
  assert.equal(events.length, 2, '(e) M5: one event per non-null reply — two replies, two events')
  assert.deepEqual(events.map((e) => e.attempt), [1, 2], '(e) M5: attempts 1 then 2')
  assert.deepEqual(events, [
    { kind: 'resolver:reply', label: 'resolve:publish-fold:1:0:1', conflict: 0, attempt: 1, status: 'RESOLVED' },
    { kind: 'resolver:reply', label: 'resolve:publish-fold:1:0:2', conflict: 0, attempt: 2, status: 'RESOLVED' },
  ], '(e) M5: each event names its own label and attempt')
}
{
  // A non-null BLOCKED reply is still a reply: one event carrying its status.
  const waveDir = freshWaveDir()
  const hf = hunksFile('e3.hunks.txt')
  const events = []
  const out = await resolveConflicts({
    agent: async () => ({ status: 'BLOCKED', notes: 'cannot' }),
    runCli: async () => cliOk(),
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
    onEvent: (e) => events.push(e),
  })
  assert.equal(out.ok, false, '(e) M5: the BLOCKED outcome is unchanged by onEvent')
  assert.deepEqual(events, [{ kind: 'resolver:reply', label: 'resolve:publish-fold:1:0:1',
    conflict: 0, attempt: 1, status: 'BLOCKED' }],
    '(e) M5: onEvent is called once per NON-NULL reply, whatever its status')
}
{
  // A null reply is not a reply: no event, and the run is otherwise identical.
  const waveDir = freshWaveDir()
  const hf = hunksFile('e4.hunks.txt')
  const events = []
  const out = await resolveConflicts({
    agent: async () => null,
    runCli: async () => cliOk(),
    roles: { resolver: ROLE }, common: COMMON, taskArgs: TASK_ARGS, commutesArgs: COMMUTES_ARGS,
    open: [{ i: 0, path: 'a.txt', hunksFile: hf, epoch: 1 }],
    contendingBlock: BLOCK, waveDir, labelPrefix: PREFIX,
    onEvent: (e) => events.push(e),
  })
  assert.equal(out.ok, false, '(e) M5: the null-twice outcome is unchanged by onEvent')
  assert.equal(out.reason, 'resolver dispatch returned no reply twice on a.txt',
    '(e) M5: and so is its reason')
  assert.deepEqual(events, [], '(e) M5: a null reply raises no event')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
