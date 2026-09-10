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
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  parseArgs, fillTiers, ackDecision, acksOf, criticDecision, boundedParallel, provisionRunTree,
  writeRoleFiles, writeConfineSettings, composeAgent, runMain, usage, DEFAULTS,
  makeAddDirsFor,
  WIDTH, ROLE_TIMEOUT_MS, ROLE_PROMPTS,
} from '../run-main.mjs'
import { makeEventLog } from '../run-waves.mjs'
import { ROLES } from '../run-worker.mjs'
import { simEnv } from './_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runmain-'))
// One environment for every child below: a HOME of the sim's own and a PATH of
// the interpreters, so nothing of the box reaches a git, a bash or a node here.
const ENV = simEnv()
const git = (argv, cwd) => execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── parseArgs ────────────────────────────────────────────────────────────────
{
  const p = parseArgs(['plan.md', 'run-24', '--repo', '/t'])
  assert.equal(p.planPath, 'plan.md')
  assert.equal(p.runId, 'run-24')
  assert.equal(p.tier, 'mostCapable')
  assert.equal(p.repoDir, '/t')
  const q = parseArgs(['plan.md', 'run-24', '--repo', '/t', '--tier', 'standard', '--overlap', 'serialize'])
  assert.equal(q.tier, 'standard')
  assert.equal(q.overlap, 'serialize')
  assert.throws(() => parseArgs(['plan.md']), /expected exactly/)
  assert.throws(() => parseArgs(['plan.md', 'run 24']), /runId must be/)
  assert.throws(() => parseArgs(['plan.md', 'run-24', '--bogus', 'x']), /unknown flag/)
  // The bootstrap knob's three states (run-66): unset (null → ultra_run.py
  // derives from the lockfile), '' (disables), a command (wins).
  assert.equal(p.bootstrapCmd, null)
  assert.equal(parseArgs(['plan.md', 'run-24', '--repo', '/t', '--bootstrap-cmd', '']).bootstrapCmd, '')
  assert.equal(parseArgs(['plan.md', 'run-24', '--repo', '/t', '--bootstrap-cmd', 'bun install']).bootstrapCmd, 'bun install')
  // #575: the target is mandatory. The engine builds the tree it is pointed
  // at; a default pointing it at its own checkout is the deleted self-host
  // case, so an omitted --repo is a refusal, not an inference.
  assert.throws(() => parseArgs(['plan.md', 'run-24']), /--repo/)
  assert.ok(!Object.keys(DEFAULTS).includes('repoDir'), 'DEFAULTS carries no repoDir key')
  assert.ok(usage().includes('--tier'))
  assert.ok(usage().includes('--repo'))
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
// Knobs: gateExit/acks steer the two-move branches, validateExit steers the
// knob-validate verb (#770 task 2 leg (c)).

// The line `ultra_run.py --validate-knobs` prints when a task carries a tier
// outside the four the compiler accepts — the shape the driver must carry out
// as its `detail`. Verbatim, so a driver that invented its own message fails.
const KNOB_DEFECT_LINE =
  '{"ok": false, "stage": "knob-validate", "detail": "task T1: tier \'opus\' is not null|cheap|standard|mostCapable"}'

function makeExecStub({ repoDir, runId, gateExit = 0, acks = [], waves, validateExit = 0 }) {
  const runDir = path.join(repoDir, '.claude/ultrapowers', 'run-' + runId)
  const argsFile = path.join(runDir, 'args.json')
  const calls = []
  const exec = async (cmd, argv, opts) => {
    calls.push([cmd, ...argv])
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv, { cwd: opts.cwd, env: ENV, encoding: 'utf8' }), stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String(e.stderr || e.message) }
      }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      // A knob defect: the verb exits non-zero with its one JSON line on stdout.
      if (validateExit !== 0) return { code: validateExit, stdout: KNOB_DEFECT_LINE, stderr: '' }
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      fs.mkdirSync(runDir, { recursive: true })
      fs.writeFileSync(argsFile, JSON.stringify({
        waves,
        wavesPath: path.join(runDir, 'launch.json'),
        edges: [], waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: repoDir, runDir, testCmd: 'true',
      }))
      // ultra_run prints the receipt to STDOUT on success (run-main derives the
      // run dir from receipt.argsFile, never a reconstructed path).
      const receipt = {
        ok: true, baseBranch: 'fleet-base', argsFile,
        testCmd: 'true', testCmdSource: 'plan',
      }
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

// The bootstrap knob reaches ultra_run.py exactly as given (run-66): unset is
// NOT passed (the driver derives), '' IS passed (the driver disables), a
// command is passed verbatim. The preflight argv is the one seam.
{
  const preflightArgv = (calls) => calls.find((c) =>
    path.basename(c[1] || '') === 'ultra_run.py' && !c.includes('--validate-knobs'))
  const drive = async (name, bootstrapCmd) => {
    const repoDir = freshRepo(name)
    const runId = 'run-' + name
    const { exec, calls } = makeExecStub({ repoDir, runId, waves: WAVES })
    await runMain(
      { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd, cli: 'claude' },
      { exec, log: () => {}, runEngineFn: async () => ({ integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [] }),
        makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }) },
    )
    return preflightArgv(calls)
  }
  const unset = await drive('boot-unset', null)
  assert.ok(unset, 'preflight ran')
  assert.ok(!unset.includes('--bootstrap-cmd'), 'unset: the driver derives, nothing is passed')
  const empty = await drive('boot-empty', '')
  const i = empty.indexOf('--bootstrap-cmd')
  assert.ok(i > 0, "'' is forwarded, not dropped as falsy")
  assert.equal(empty[i + 1], '', "'' rides verbatim so ultra_run.py disables derivation")
  const given = await drive('boot-given', 'bun install')
  assert.equal(given[given.indexOf('--bootstrap-cmd') + 1], 'bun install')
}

// ── #753 Task 2 — a manual ack settled by the driver's own executed Run: ─────
// Claim: the ack decision pre-authorizes a `deferred:manual` ack whose `detail`
// cites `Run:` evidence the driver executed and that exited 0. Citing is the
// critic's act; verifying is the driver's — the citation test is a verbatim
// substring of an executed command carried in `report.integratedRuns`.
const CMD_GREEN = "sh -c 'grep -q sweep fleet/RUNBOOK.md'"
const CMD_RED = "sh -c 'grep -q nosuchtoken fleet/RUNBOOK.md'"
const R = {
  integratedRuns: [
    { task: 'T1', cmd: CMD_GREEN, exit: 0, stdout: '' },
    { task: 'T1', cmd: CMD_RED, exit: 2, stdout: '' },
  ],
}
const CITING_ACK = {
  type: 'deferred:manual',
  detail: 'fleet/RUNBOOK.md §Rollback — settled by `' + CMD_GREEN +
    '`; whether it reads well is judgment',
}
const NONCITING_ACK = {
  type: 'deferred:manual',
  detail: 'fleet/RUNBOOK.md §Rollback — whether it reads well is judgment',
}
const BOTH_ACK = {
  type: 'deferred:manual',
  detail: 'fleet/RUNBOOK.md §Rollback — settled by `' + CMD_GREEN + '` and `' + CMD_RED +
    '`; whether it reads well is judgment',
}
const PARKED_REASON = 'non-pre-authorized ack(s): deferred:manual'

// Leg (a) [M1] — pure: a citing manual ack against a report whose
// `integratedRuns` carries that command green is pre-authorized, and the reason
// names #753. BASE parks on any `deferred:manual` type, so BASE fails both rows.
{
  const gr = (acks) => ({ verdict: 'NEEDS_ACK', gateCheck: { acks } })
  const d = ackDecision(gr([CITING_ACK]), R)
  assert.equal(d.approve, true,
    'leg (a) [M1]: a deferred:manual ack whose detail quotes a green integratedRuns cmd verbatim ' +
    'is pre-authorized')
  assert.match(d.reason, /#753/,
    'leg (a) [M1]: the reason names #753 when a manual ack was pre-authorized this way')
  const d2 = ackDecision(gr([CITING_ACK, { type: 'deferred:external' }]), R)
  assert.equal(d2.approve, true,
    'leg (a) [M1]: a citing manual ack beside a deferred:external ack still approves')
  assert.match(d2.reason, /#753/,
    'leg (a) [M1]: the reason still names #753 when a manual ack rode with an external one')
}

// Leg (b) [M1] — flow: runMain over a NEEDS_ACK gate carrying that manual ack,
// with the engine's report supplying the integrated runs that settle it.
{
  const repoDir = freshRepo('flow-ack-manual-cited')
  const runId = 'run-98'
  const { exec, calls, runDir } = makeExecStub({
    repoDir, runId, gateExit: 2, acks: [CITING_ACK], waves: WAVES,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
        integratedRuns: R.integratedRuns,
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0, 'leg (b) [M1]: exit code 0 — ' + out.verdict + ': ' + out.detail)
  assert.equal(out.verdict, 'approved', 'leg (b) [M1]: the verdict is approved')
  const saPath = path.join(runDir, 'standing-approval.json')
  assert.ok(fs.existsSync(saPath),
    'leg (b) [M1]: the pre-authorization record is written before the approve')
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'))
  assert.equal(sa.ackList.length, 1, 'leg (b) [M1]: standing-approval.json holds the one ack')
  assert.equal(sa.ackList[0].type, 'deferred:manual',
    'leg (b) [M1]: the recorded ack is the deferred:manual one that was pre-authorized')
  const ev = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  const dec = ev.find((e) => e.kind === 'driver:ack-decision')
  assert.ok(dec, 'leg (b) [M1]: the ack decision is on the event log')
  assert.equal(dec.approve, true, 'leg (b) [M1]: driver:ack-decision carries approve true')
  assert.ok(calls.some((c) => c.includes('--approve')),
    'leg (b) [M1]: the run reached ultra_gate.py --approve')
}

// Leg (c) [M2] — pure, four rows: what is NOT pre-authorized. Each parks with
// the frozen reason literal, verbatim.
{
  const gr = (acks) => ({ verdict: 'NEEDS_ACK', gateCheck: { acks } })
  const rows = [
    ['a manual ack whose detail names no executed command',
      ackDecision(gr([NONCITING_ACK]), R)],
    ['the citing ack against a report with no integratedRuns',
      ackDecision(gr([CITING_ACK]), {})],
    ['the citing ack against a report whose integratedRuns is empty',
      ackDecision(gr([CITING_ACK]), { integratedRuns: [] })],
    ['the citing ack with no report at all — a receipt read with no report',
      ackDecision(gr([CITING_ACK]))],
    ['a manual ack citing a red entry as well as a green one',
      ackDecision(gr([BOTH_ACK]), R)],
  ]
  for (const [what, d] of rows) {
    assert.equal(d.approve, false, 'leg (c) [M2]: ' + what + ' is not pre-authorized')
    assert.equal(d.reason, PARKED_REASON,
      'leg (c) [M2]: ' + what + ' parks with the frozen literal ' + PARKED_REASON)
  }
}

// Leg (d) [M2] — flow: the non-citing manual ack parks the run, whatever the
// report's integratedRuns holds.
{
  const repoDir = freshRepo('flow-ack-manual-uncited')
  const runId = 'run-99'
  const { exec, calls, runDir } = makeExecStub({
    repoDir, runId, gateExit: 2, acks: [NONCITING_ACK], waves: WAVES,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
        integratedRuns: R.integratedRuns,
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 1, 'leg (d) [M2]: exit code 1')
  assert.equal(out.verdict, 'needs-ack', 'leg (d) [M2]: the verdict is needs-ack')
  assert.ok(!fs.existsSync(path.join(runDir, 'standing-approval.json')),
    'leg (d) [M2]: a parked run writes no standing-approval.json')
  assert.ok(!calls.some((c) => c.includes('--approve')),
    'leg (d) [M2]: a parked run never calls --approve')
}

// Leg (e) [M3] — pure: BASE's approving branch and BASE's parking types are
// untouched, and `acksOf` still reads `gateCheck.acks` only. A decision keyed on
// the detail alone — rather than on the ack TYPE plus the citation — fails the
// coverage and plan-defect rows.
{
  const gr = (acks) => ({ verdict: 'NEEDS_ACK', gateCheck: { acks } })
  const d = ackDecision(gr([{ type: 'deferred:runtime' }, { type: 'deferred:external' }]), R)
  assert.equal(d.approve, true, 'leg (e) [M3]: runtime + external still approve')
  assert.equal(d.reason, '2 deferred runtime/external ack(s) — pre-authorized (#243)',
    "leg (e) [M3]: BASE's reason literal is unchanged when no manual ack was pre-authorized")
  assert.equal(ackDecision(gr([{ type: 'coverage', detail: CMD_GREEN }]), R).approve, false,
    'leg (e) [M3]: a coverage ack parks whatever the report holds')
  assert.equal(ackDecision(gr([{ type: 'deferred:plan-defect', detail: CMD_GREEN }]), R).approve, false,
    'leg (e) [M3]: a deferred:plan-defect ack is never pre-authorized')
  assert.deepEqual(acksOf({ acks: [{ type: 'coverage' }] }), [],
    'leg (e) [M3]: acksOf reads gateCheck.acks only — a flat acks is not the ack channel')
}

// Leg (f) [M4] — the prose deliverables prove themselves with the Proof's own
// `Run:` commands, executed here from the repo root.
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const sh = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: repoRoot, encoding: 'utf8', env: ENV })

  // The first two `Run:`s named two sibling sims. Named here, not run: the
  // bridge in tests/test_fleet_suite.py collects every fleet/tests/test_*.mjs
  // and dispatches each on a worker of its own, so a sim that spawned these two
  // ran them twice — and handed them whatever environment this process carries.
  // The coverage the leg keeps is the names: critic.md's shape is graded where
  // test_roles_peer.mjs lives, and the proposedPatches row where
  // test_exam_edited_patches.mjs does.
  for (const sim of ['test_roles_peer.mjs', 'test_exam_edited_patches.mjs']) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'fleet/tests', sim)),
      `leg (f) [M4]: fleet/tests/${sim} is still a sim under fleet/tests/, collected and run by ` +
      'the bridge, which asserts ALL TESTS PASSED there')
  }

  const criticGrep = sh("grep -n 'verbatim' fleet/roles/critic.md")
  const criticLines = criticGrep.stdout.split('\n').filter((l) => l.trim() !== '')
  assert.ok(criticLines.some((l) => /manual/.test(l) && /verbatim/.test(l)),
    'leg (f) [M4]: the third Run: prints a line of fleet/roles/critic.md naming `manual` on the ' +
    'same line as `verbatim` — the critic is told to quote the settling command verbatim in the ' +
    "item's why: " + JSON.stringify(criticLines))

  const rfGrep = sh("grep -n 'deferred:manual' skills/ultrapowers/references/report-format.md")
  const rfLines = rfGrep.stdout.split('\n').filter((l) => l.trim() !== '')
  assert.ok(rfLines.some((l) => /deferred:manual/.test(l) && /verbatim/.test(l)),
    'leg (f) [M4]: the fourth Run: prints a line of report-format.md naming `deferred:manual` and ' +
    '`verbatim` — the rule says a manual ack quoting a green integrated Run: verbatim is ' +
    'pre-authorized: ' + JSON.stringify(rfLines))
}

// ── #770 Task 2 — the driver asks for knob validation without the baseline ───
// Claim: the driver asks the knob check to skip the baseline and issues no
// suite command of its own before the engine starts, and a knob defect still
// stops the run before any clone is cut.
//
// The sim stubs `ultra_run.py`, so nothing here asserts what happens INSIDE the
// script — the seam is argv, and argv is exactly what these legs read. (A
// sibling task teaches `--no-baseline` to the script itself; its exam covers
// the other half.)

// Legs (a) [M1] and (b) [M2] — one green runMain drive, read at two points.
{
  const repoDir = freshRepo('flow-no-baseline')
  const runId = 'run-100'
  const { exec, calls, runDir } = makeExecStub({ repoDir, runId, gateExit: 0, waves: WAVES })
  const argsFilePath = path.join(runDir, 'args.json')
  // The boundary M2 measures "before" against: how many execs the driver had
  // issued at the moment the engine seam was entered.
  let callsAtEngine = -1
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => {
        callsAtEngine = calls.length
        return { integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [] }
      },
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0, 'the drive is green — ' + out.verdict + ': ' + out.detail)

  // (a) [M1] Exactly one exec per run carries `--validate-knobs`, and that argv
  // carries the args file path and `--no-baseline`.
  const vkCalls = calls.filter((c) => c.includes('--validate-knobs'))
  assert.equal(vkCalls.length, 1,
    'leg (a) [M1]: exactly one exec of the whole run carries --validate-knobs, not zero and not two: ' +
    JSON.stringify(vkCalls))
  const vk = vkCalls[0]
  assert.ok(vk.includes(argsFilePath),
    'leg (a) [M1]: the --validate-knobs argv names the args file: ' + vk.join(' '))
  assert.ok(vk.includes('--no-baseline'),
    'leg (a) [M1]: the --validate-knobs argv also carries --no-baseline — the driver asks the ' +
    'knob check to skip the baseline: ' + vk.join(' '))

  // (b) [M2] Before the engine seam: exactly two ultra_run.py execs — the
  // preflight, then the knob check — and no suite command of the driver's own.
  assert.ok(callsAtEngine >= 0, 'leg (b) [M2]: runEngineFn was entered, so the boundary is real')
  const before = calls.slice(0, callsAtEngine)
  const ultraRun = before.filter((c) => path.basename(String(c[1] || '')) === 'ultra_run.py')
  assert.equal(ultraRun.length, 2,
    'leg (b) [M2]: exactly two ultra_run.py execs precede the engine — the preflight and the ' +
    'knob check, no third: ' + JSON.stringify(ultraRun))

  const preflight = ultraRun[0]
  assert.equal(preflight[2], 'plan.md', 'leg (b) [M2]: the first is the preflight — argv[0] is the plan path')
  assert.equal(preflight[3], '--stamp', 'leg (b) [M2]: the preflight names --stamp next')
  assert.equal(preflight[4], runId, 'leg (b) [M2]: the stamp is the runId')
  assert.ok(!preflight.includes('--validate-knobs'),
    'leg (b) [M2]: the preflight is not the knob check: ' + preflight.join(' '))
  assert.ok(!preflight.includes('--no-baseline'),
    'leg (b) [M2]: --no-baseline rides the knob check only — the preflight never executes a ' +
    'suite, so the flag would name a mechanism that is not there: ' + preflight.join(' '))
  assert.ok(ultraRun[1].includes('--validate-knobs'),
    'leg (b) [M2]: the second ultra_run.py exec is the knob check: ' + ultraRun[1].join(' '))

  // The driver runs no suite of its own before the engine. `true` is the args
  // file's testCmd; a shell is how a driver would have run it.
  for (const c of before) {
    assert.ok(!['true', 'sh', 'bash', '/bin/sh'].includes(String(c[0])),
      'leg (b) [M2]: no exec before the engine has the args file\'s testCmd or a shell as its ' +
      'command — the driver issues no suite command of its own: ' + c.join(' '))
  }
}

// Leg (c) [M3] — a knob defect still stops the run before any clone is cut.
{
  const repoDir = freshRepo('flow-knob-defect')
  const runId = 'run-101'
  const { exec, calls, runDir } = makeExecStub({
    repoDir, runId, gateExit: 0, waves: WAVES, validateExit: 1,
  })
  const out = await runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec, log: () => {},
      runEngineFn: async () => { throw new Error('must not launch') },
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 1, 'leg (c) [M3]: a knob defect is exit code 1 — ' + out.verdict + ': ' + out.detail)
  assert.equal(out.verdict, 'knob-validate-failed', 'leg (c) [M3]: the verdict is knob-validate-failed')
  assert.ok(String(out.detail).includes("task T1: tier"),
    'leg (c) [M3]: the detail carries the JSON line\'s own detail, so the operator reads the bad ' +
    'tier and not only an exit code: ' + JSON.stringify(out.detail))
  // runEngineFn throws `must not launch` if entered; reaching here at all means
  // it was not, and the refusal came from the knob check rather than the engine.
  assert.ok(!String(out.detail).includes('must not launch'),
    'leg (c) [M3]: runEngineFn was never entered — the run stopped at the knob check')
  assert.ok(!fs.existsSync(path.join(runDir, 'clones')),
    'leg (c) [M3]: no clones directory exists under the run dir — provisioning is step 3, and a ' +
    'knob defect refuses before it')
  assert.ok(calls.some((c) => c.includes('--validate-knobs')),
    'leg (c) [M3]: the run did reach the knob check')
  assert.ok(!calls.some((c) => c.includes('--approve')), 'leg (c) [M3]: a refused run never approves')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
