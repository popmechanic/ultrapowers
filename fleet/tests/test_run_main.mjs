// fleet/tests/test_run_main.mjs — the deterministic engine entry (#402).
//
// Three layers, three kinds of proof:
//   the pure pieces      parseArgs / fillTiers / ackDecision / criticDecision /
//                        boundedParallel
//   the provisioned run  real git: clones at BASE, roles, settings, and the
//                        composed agent capturing a REAL patch while
//                        discarding the model-typed coordinates
//   runMain              the whole flow over stubbed scripts — including the
//                        one-decision pin (args.patchInput IS the composed
//                        patches dir) and the two-move rule's both branches
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import {
  parseArgs, fillTiers, ackDecision, acksOf, criticDecision, boundedParallel, provisionRunTree,
  writeRoleFiles, writeConfineSettings, composeAgent, runMain, usage,
  makeAddDirsFor,
  WIDTH, ROLE_TIMEOUT_MS, ROLE_PROMPTS,
} from '../run-main.mjs'
import { makeEventLog } from '../run-waves.mjs'
import { ROLES } from '../run-worker.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runmain-'))
const git = (argv, cwd) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── parseArgs ────────────────────────────────────────────────────────────────
{
  const p = parseArgs(['plan.md', 'run-24'])
  assert.equal(p.planPath, 'plan.md')
  assert.equal(p.runId, 'run-24')
  assert.equal(p.tier, 'mostCapable')
  const q = parseArgs(['plan.md', 'run-24', '--tier', 'standard', '--overlap', 'serialize'])
  assert.equal(q.tier, 'standard')
  assert.equal(q.overlap, 'serialize')
  assert.throws(() => parseArgs(['plan.md']), /expected exactly/)
  assert.throws(() => parseArgs(['plan.md', 'run 24']), /runId must be/)
  assert.throws(() => parseArgs(['plan.md', 'run-24', '--bogus', 'x']), /unknown flag/)
  assert.ok(usage().includes('--tier'))
}

// ── fillTiers ────────────────────────────────────────────────────────────────
{
  const args = { waves: [[{ id: 'A', tier: null }, { id: 'B', tier: 'standard' }], [{ id: 'C', tier: null }]] }
  const n = fillTiers(args, 'mostCapable')
  assert.equal(n, 2, 'only null slots are filled')
  assert.equal(args.waves[0][0].tier, 'mostCapable')
  assert.equal(args.waves[0][1].tier, 'standard', 'an explicit tier is never overwritten')
  assert.equal(args.waves[1][0].tier, 'mostCapable')
}

// ── ackDecision — the two-move rule, both branches ───────────────────────────
// acks are NESTED under gateCheck (the real ultra_gate.py shape); a flat
// {acks} must read as EMPTY, not approve-everything.
{
  const gr = (acks) => ({ verdict: 'NEEDS_ACK', gateCheck: { acks } })
  assert.ok(ackDecision(gr([])).approve, 'no acks approves')
  assert.ok(ackDecision(gr([{ type: 'deferred:runtime' }, { type: 'deferred:external' }])).approve)
  const parked = ackDecision(gr([{ type: 'deferred:runtime' }, { type: 'coverage' }]))
  assert.ok(!parked.approve, 'a coverage ack parks')
  assert.match(parked.reason, /coverage/)
  assert.ok(!ackDecision(gr([{ type: 'deferred:manual' }])).approve, 'manual is never pre-authorized')
  // The bug the review caught: a FLAT top-level acks must NOT be read — it is
  // a shape the script never writes, so it reads as empty (approve), and a
  // parking ack placed there must be invisible, never a silent approve-all.
  assert.deepEqual(acksOf({ acks: [{ type: 'coverage' }] }), [], 'flat acks are not the ack channel')
  assert.ok(ackDecision({ acks: [{ type: 'coverage' }] }).approve,
    'a flat coverage ack is invisible — only gateCheck.acks is read')
}

// ── criticDecision — the brake #474 added ────────────────────────────────────
{
  const rep = (findings) => ({ completenessFindings: findings })
  assert.ok(criticDecision(rep([])).approve, 'no findings approves')
  assert.ok(criticDecision(rep([{ severity: 'minor', detail: 'x' }])).approve,
    'a minor finding is not a brake')
  const blocked = criticDecision(rep([
    { severity: 'minor', detail: 'x' },
    { severity: 'blocking', detail: 'task 2 deliverable absent' },
  ]))
  assert.ok(!blocked.approve)
  assert.equal(blocked.blocking.length, 1)
  assert.equal(blocked.blocking[0].detail, 'task 2 deliverable absent')
  assert.match(blocked.reason, /deliverable absent/)
  assert.ok(criticDecision(rep(['an old bare string finding'])).approve,
    'pre-#474 evidence carries no severity and cannot block')
  assert.ok(criticDecision({}).approve, 'a report with no findings field approves')
}

// ── boundedParallel ──────────────────────────────────────────────────────────
{
  let live = 0, peak = 0
  const thunk = (v) => async () => {
    live++; peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 15))
    live--
    return v
  }
  const out = await boundedParallel(2)([thunk(1), thunk(2), thunk(3), thunk(4), thunk(5)])
  assert.deepEqual(out, [1, 2, 3, 4, 5], 'results keep input order')
  assert.equal(peak, 2, 'never more than the bound in flight')
  await assert.rejects(boundedParallel(2)([async () => { throw new Error('boom') }]), /boom/)
  assert.equal(WIDTH, 12, 'the width bound is the measured clean figure (#398: 12/12 clean; raised 8->12 on 2026-09-01) — past it only with a width arm')
}

// ── role files + settings ────────────────────────────────────────────────────
{
  for (const role of Object.keys(ROLES)) {
    assert.ok(ROLE_PROMPTS[role], 'every dispatchable role has a prompt file: ' + role)
  }
  const rolesDir = path.join(tmp, 'roles')
  const promptFileFor = writeRoleFiles(rolesDir)
  for (const role of Object.keys(ROLE_PROMPTS)) {
    const p = promptFileFor(role)
    assert.ok(fs.existsSync(p))
    // Neutrality is the rule (spec §4): a role prompt that lectures the model
    // about its boundary turns every confinement probe into prompt-level
    // compliance. No prohibition language rides these files.
    const text = fs.readFileSync(p, 'utf8').toLowerCase()
    for (const banned of ['never', 'do not', 'must not', 'forbidden', 'only inside']) {
      assert.ok(!text.includes(banned), role + '.md carries confinement language: ' + banned)
    }
  }

  const runDir = path.join(tmp, 'settings-run')
  fs.mkdirSync(runDir, { recursive: true })
  const settingsFor = writeConfineSettings({ runDir, hookPath: '/repo/fleet/confine-hook.mjs' })
  const sp = settingsFor('implementer')
  assert.ok(sp && fs.existsSync(sp))
  assert.equal(settingsFor('writeSide'), sp, 'both acceptEdits roles share the one settings file')
  assert.equal(settingsFor('reviewer'), undefined, 'allowlist roles get no hook — the allowlist is the boundary')
  assert.equal(settingsFor('critic'), undefined)
  const settings = JSON.parse(fs.readFileSync(sp, 'utf8'))
  const entry = settings.hooks.PreToolUse[0]
  assert.equal(entry.matcher, 'Edit|Write|MultiEdit|NotebookEdit|Bash')
  assert.match(entry.hooks[0].command, /confine-hook\.mjs/)

  assert.ok(ROLE_TIMEOUT_MS.reviewer < ROLE_TIMEOUT_MS.implementer,
    'a read-only reviewer must be bounded tighter than an implementer')
}

// ── a real repo to provision against ─────────────────────────────────────────
const repo = path.join(tmp, 'repo')
fs.mkdirSync(repo, { recursive: true })
git(['init', '-q', '-b', 'fleet-base'], repo)
git(['config', 'user.email', 't@example.com'], repo)
git(['config', 'user.name', 't'], repo)
fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n')
git(['add', '-A'], repo)
git(['commit', '-q', '-m', 'base'], repo)
const BASE = git(['rev-parse', 'HEAD'], repo).trim()

// ── provisionRunTree: clones at BASE ─────────────────────────────────────────
{
  const runDir = path.join(tmp, 'prov-run')
  const tree = provisionRunTree({ repoDir: repo, runDir, base: BASE, taskIds: ['T1', 'T2'] })
  for (const d of ['integration', 'task-T1', 'task-T2']) {
    const c = path.join(tree.clonesDir, d)
    assert.equal(git(['rev-parse', 'HEAD'], c).trim(), BASE, d + ' is at BASE')
  }
  for (const d of [tree.patchesDir, tree.workersDir, tree.configDir]) assert.ok(fs.existsSync(d))
}

// ── composeAgent: capture is real, model coordinates are discarded ───────────
{
  const runDir = path.join(tmp, 'compose-run')
  const tree = provisionRunTree({ repoDir: repo, runDir, base: BASE, taskIds: ['T1'] })
  const eventLog = makeEventLog({ file: path.join(runDir, 'events.jsonl'), runId: 'run-t', base: BASE })
  // A fake `claude`: emits a clean envelope whose structured_output carries
  // MODEL-TYPED coordinates — a lying branch/sha and a patch path pointing at
  // a file the driver never wrote.
  const envelope = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, terminal_reason: null,
    api_error_status: null, total_cost_usd: 0, modelUsage: {},
    structured_output: { status: 'done', summary: 'did it', branch: 'model-lie',
                         headSha: 'deadbeef', patch: '/etc/hostile.patch' },
  })
  const spawnFn = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
    child.kill = () => {}
    setImmediate(() => { child.stdout.emit('data', envelope); child.emit('close', 0, null) })
    return child
  }
  const { agent, patchInput } = composeAgent({
    runId: 'run-t', base: BASE,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor: () => undefined, settingsFor: () => undefined,
    env: process.env, cli: 'claude', eventLog, spawnFn,
  })
  assert.equal(patchInput, tree.patchesDir,
    'the one decision: the flag the engine gets IS the patches dir the wrapper writes')
  // Simulate the worker's edit, then dispatch.
  const clone = path.join(tree.clonesDir, 'task-T1')
  fs.writeFileSync(path.join(clone, 'a.txt'), 'edited by T1\n')
  const reply = await agent('do the task', { label: 'impl:T1', isolation: 'worktree', model: 'opus' })
  assert.equal(reply.branch, '', 'model-typed branch is overwritten (detached by design)')
  assert.equal(reply.headSha, BASE, 'headSha is driver-derived from the clone, not model-typed')
  assert.ok(reply.patch.startsWith(tree.patchesDir + path.sep), 'the patch lives where the driver wrote it')
  assert.match(fs.readFileSync(reply.patch, 'utf8'), /edited by T1/, 'the patch carries the real diff')
  // A non-isolated role passes through untouched apart from the strip.
  const reply2 = await agent('review it', { label: 'review:T1:1', model: 'opus' })
  assert.equal(reply2.patch, undefined, 'a model-typed patch on a non-isolated reply is stripped')
}

// ── --add-dir scope (measured 2026-08-31, probe_addcwd_scope.mjs) ────────────
// A read-only worker's cwd is `<runDir>/clones/integration`, but `wavesPath`
// (launch.json) and `patches/` live in `<runDir>` — a parent. Under `dontAsk`
// read-only Bash is permitted as a class but only IN SCOPE, so those reads were
// denied across five consecutive runs and became the `cannotVerify` entries
// that parked them. `addDirsFor` was never supplied, so `--add-dir` was never
// emitted at all.
{
  const addDirsFor = makeAddDirsFor({ runDir: '/r/run-9' })
  for (const role of ['reviewer', 'resolver', 'critic']) {
    assert.deepEqual(addDirsFor({ label: 'review:1:1' }, role), ['/r/run-9'],
      role + ' must reach the run dir: its prompt sends it to wavesPath and patches/')
  }
  // SCOPED, not blanket: bypassPermissions does not path-gate (probe arm F), so
  // the write-side roles already read what they need. Granting more is exposure
  // for no gain.
  for (const role of ['implementer', 'writeSide']) {
    assert.deepEqual(addDirsFor({ label: 'impl:1' }, role), [],
      role + ' must get no --add-dir: it does not need one and the hook is its boundary')
  }
}

// composeAgent must actually SUPPLY addDirsFor. The defect was that the
// parameter existed end to end — buildArgs pushes `--add-dir`, createRunWorker
// forwards addDirsFor — and NOTHING ever passed it, so the push was dead code.
// Assert on the real argv the CLI would receive, not on the wiring.
{
  const runDir = path.join(tmp, 'adddir-run')
  const tree = provisionRunTree({ repoDir: repo, runDir, base: BASE, taskIds: ['T1'] })
  const eventLog = makeEventLog({ file: path.join(runDir, 'events.jsonl'), runId: 'run-a', base: BASE })
  const envelope = JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    session_id: 's', structured_output: { ok: true }, usage: {}, total_cost_usd: 0 }) + '\n'
  const argvSeen = []
  const spawnFn = (_cli, argv) => {
    argvSeen.push(argv)
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
    child.kill = () => {}
    setImmediate(() => { child.stdout.emit('data', envelope); child.emit('close', 0, null) })
    return child
  }
  const { agent } = composeAgent({
    runId: 'run-a', base: BASE, runDir,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor: () => undefined, settingsFor: () => undefined,
    env: process.env, cli: 'claude', eventLog, spawnFn,
  })

  await agent('review it', { label: 'review:T1:1', model: 'opus' })
  const revArgv = argvSeen.at(-1)
  const at = revArgv.indexOf('--add-dir')
  assert.ok(at !== -1, 'a reviewer must be dispatched WITH --add-dir (this is the regression)')
  assert.equal(revArgv[at + 1], runDir, '--add-dir must name this run dir')

  await agent('do the task', { label: 'impl:T1', isolation: 'worktree', model: 'opus' })
  assert.ok(!argvSeen.at(-1).includes('--add-dir'),
    'the write-side roles are scoped narrowly: bypassPermissions does not path-gate, ' +
    'so read reach they do not need is exposure for no gain')
}

// ── runMain, end to end over stubbed scripts ─────────────────────────────────
// The exec stub plays ultra_run/finalize/ultra_gate; git calls run for real.
// One knob: gateExit/acks steer the two-move branches.
function makeExecStub({ repoDir, runId, gateExit = 0, acks = [], waves }) {
  const runDir = path.join(repoDir, '.claude/ultrapowers', 'run-' + runId)
  const argsFile = path.join(runDir, 'args.json')
  const calls = []
  const exec = async (cmd, argv, opts) => {
    calls.push([cmd, ...argv])
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv, { cwd: opts.cwd, encoding: 'utf8' }), stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String(e.stderr || e.message) }
      }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      fs.mkdirSync(runDir, { recursive: true })
      fs.writeFileSync(argsFile, JSON.stringify({
        waves,
        wavesPath: path.join(runDir, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: repoDir, runDir, testCmd: 'true',
      }))
      // ultra_run prints the receipt to STDOUT on success (run-main derives the
      // run dir from receipt.argsFile, never a reconstructed path).
      const receipt = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: 'true' }
      fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt))
      return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: runId, branch: 'ultra/integration-' + runId }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      // The REAL gate-receipt shape (ultra_gate.py:107): acks are NESTED under
      // gateCheck, never flat at the top. A flat {acks} stub is what let the
      // two-move-rule bypass through review — the stub must match the script.
      fs.writeFileSync(path.join(runDir, 'gate-receipt.json'), JSON.stringify({
        verdict: gateExit === 0 ? 'PASS' : 'NEEDS_ACK',
        gateCheck: { verdict: gateExit === 0 ? 'PASS' : 'NEEDS_ACK', checks: [], acks },
        gateCheckExit: gateExit,
      }))
      return { code: gateExit, stdout: '', stderr: '' }
    }
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }), stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  return { exec, calls, runDir }
}

const WAVES = [[{ id: 'T1', title: 't', files: ['a.txt'], tier: null, review: 'lean', writes: ['a.txt'], commutes: [] }]]

// A fresh repo per flow run (runMain provisions clones into the repo's run dir).
function freshRepo(name) {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  git(['init', '-q', '-b', 'fleet-base'], dir)
  git(['config', 'user.email', 't@example.com'], dir)
  git(['config', 'user.name', 't'], dir)
  fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'base'], dir)
  return dir
}

// Green flow: PASS gate → approve; the engine sees patchInput === patchesDir.
{
  const repoDir = freshRepo('flow-green')
  const runId = 'run-90'
  const { exec, calls, runDir } = makeExecStub({ repoDir, runId, gateExit: 0, waves: WAVES })
  let seenArgs = null
  const fakeReport = { integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [] }
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec,
      log: () => {},
      runEngineFn: async ({ args }) => { seenArgs = args; return fakeReport },
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0, out.verdict + ': ' + out.detail)
  assert.equal(out.verdict, 'approved')
  assert.equal(seenArgs.patchInput, path.join(runDir, 'patches'),
    'the engine is armed with the driver-owned patches dir, never a bare true')
  assert.equal(seenArgs.integrationBranch, 'ultra/integration-' + runId)
  assert.equal(seenArgs.stamp, runId)
  assert.equal(seenArgs.baseBranch, 'fleet-base')
  assert.equal(seenArgs.waves[0][0].tier, 'mostCapable', 'the null tier slot was stamped')
  // The tier fill was written back before --validate-knobs read the file.
  const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, 'args.json'), 'utf8'))
  assert.equal(onDisk.waves[0][0].tier, 'mostCapable')
  assert.ok(fs.existsSync(path.join(runDir, 'workflow-result.json')))
  assert.ok(fs.existsSync(path.join(runDir, 'approve-receipt.json')))
  assert.ok(fs.existsSync(path.join(runDir, 'events.jsonl')))
  const kinds = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l).kind)
  assert.ok(kinds.includes('run:open') && kinds.includes('driver:stage') && kinds.includes('driver:approved'))
  assert.ok(calls.some((c) => c.includes('--validate-knobs')))
  // Clones were provisioned at the repo's BASE.
  const b = git(['rev-parse', 'HEAD'], repoDir).trim()
  assert.equal(git(['rev-parse', 'HEAD'], path.join(runDir, 'clones', 'task-T1')).trim(), b)
}

// NEEDS_ACK with only pre-authorized acks → standing-approval, then approve.
{
  const repoDir = freshRepo('flow-ack')
  const runId = 'run-91'
  const { exec, runDir } = makeExecStub({
    repoDir, runId, gateExit: 2,
    acks: [{ type: 'deferred:runtime', task: 'T1' }], waves: WAVES,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({ integrationBranch: 'x', waveMerges: [], tasks: [] }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0)
  const sa = JSON.parse(fs.readFileSync(path.join(runDir, 'standing-approval.json'), 'utf8'))
  assert.equal(sa.ackList.length, 1, 'the consumed acks are recorded before the approve')
}

// NEEDS_ACK with a non-pre-authorized ack → parked, no approve, no standing file.
{
  const repoDir = freshRepo('flow-park')
  const runId = 'run-92'
  const { exec, calls, runDir } = makeExecStub({
    repoDir, runId, gateExit: 2, acks: [{ type: 'coverage' }], waves: WAVES,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({ integrationBranch: 'x', waveMerges: [], tasks: [] }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 1)
  assert.equal(out.verdict, 'needs-ack')
  assert.ok(!fs.existsSync(path.join(runDir, 'standing-approval.json')))
  assert.ok(!calls.some((c) => c.includes('--approve')), 'a parked run never approves')
}

// PASS gate + a BLOCKING completeness finding → refused, on the clean path.
{
  const repoDir = freshRepo('flow-critic-block')
  const runId = 'run-94'
  const { exec, calls, runDir } = makeExecStub({ repoDir, runId, gateExit: 0, waves: WAVES })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
        completenessFindings: [
          { severity: 'minor', detail: 'a nit' },
          { severity: 'blocking', detail: 'task 2 deliverable absent' },
        ],
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 1)
  assert.equal(out.verdict, 'critic-blocking')
  assert.ok(!calls.some((c) => c.includes('--approve')), 'a refused run never invokes --approve')
  assert.ok(!fs.existsSync(path.join(runDir, 'approve-receipt.json')),
    'no approve receipt is written on a refusal')
  const block = JSON.parse(fs.readFileSync(path.join(runDir, 'critic-block.json'), 'utf8'))
  assert.equal(block.stamp, runId)
  assert.equal(block.integrationBranch, 'ultra/integration-' + runId)
  assert.equal(block.gateVerdict, 'PASS', 'the brake fires on a CLEAN gate — that is the point')
  assert.equal(block.blocking.length, 1)
  assert.equal(block.blocking[0].detail, 'task 2 deliverable absent')
  const ev = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  const dec = ev.find((e) => e.kind === 'driver:critic-decision')
  assert.ok(dec, 'the decision is on the event log, like driver:ack-decision')
  assert.equal(dec.approve, false)
  assert.match(dec.reason, /deliverable absent/)
}

// PASS gate + a MINOR finding → approves exactly as it does at BASE.
{
  const repoDir = freshRepo('flow-critic-minor')
  const runId = 'run-95'
  const { exec, calls, runDir } = makeExecStub({ repoDir, runId, gateExit: 0, waves: WAVES })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
        completenessFindings: [{ severity: 'minor', detail: 'a nit' }],
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0, out.verdict + ': ' + out.detail)
  assert.equal(out.verdict, 'approved')
  assert.ok(fs.existsSync(path.join(runDir, 'approve-receipt.json')))
  assert.ok(!fs.existsSync(path.join(runDir, 'critic-block.json')))
  assert.ok(calls.some((c) => c.includes('--approve')))
  const ev = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  const dec = ev.find((e) => e.kind === 'driver:critic-decision')
  assert.ok(dec && dec.approve === true, 'an approving decision is recorded too, not only a refusal')
}

// NEEDS_ACK over a PRE-AUTHORIZED ack + a blocking finding → refused anyway.
// #243 pre-authorizes "the sandbox could not execute this"; it was never a
// licence to merge a named defect. The brake outranks the ack path.
{
  const repoDir = freshRepo('flow-critic-over-ack')
  const runId = 'run-96'
  const { exec, calls, runDir } = makeExecStub({
    repoDir, runId, gateExit: 2,
    acks: [{ type: 'deferred:runtime', task: 'T1' }], waves: WAVES,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
        completenessFindings: [{ severity: 'blocking', detail: 'task 2 deliverable absent' }],
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 1)
  assert.equal(out.verdict, 'critic-blocking', 'the brake precedes the ack path, not the other way round')
  assert.ok(!fs.existsSync(path.join(runDir, 'standing-approval.json')),
    'the run never reached the pre-authorization record')
  assert.ok(!calls.some((c) => c.includes('--approve')))
  const block = JSON.parse(fs.readFileSync(path.join(runDir, 'critic-block.json'), 'utf8'))
  assert.equal(block.gateVerdict, 'NEEDS_ACK')
  assert.equal(block.blocking.length, 1)
}

// Empty waves → refuse before provisioning anything.
{
  const repoDir = freshRepo('flow-empty')
  const runId = 'run-93'
  const { exec, runDir } = makeExecStub({ repoDir, runId, waves: [] })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    { exec, log: () => {}, runEngineFn: async () => { throw new Error('must not launch') } },
  )
  assert.equal(out.code, 1)
  assert.equal(out.verdict, 'empty-plan')
  assert.ok(!fs.existsSync(path.join(runDir, 'clones')), 'no clone is cut for an empty plan')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
