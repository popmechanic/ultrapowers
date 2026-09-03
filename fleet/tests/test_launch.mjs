/**
 * fleet/tests/test_launch.mjs — the launcher.
 *
 * What is pinned here is behaviour the fleet cannot survive without:
 *
 *   1. every refusal happens with NOTHING executed, or with reads only — an
 *      account that refused a launch is byte-identical to one that was never
 *      asked;
 *   2. the four lobby verbs, in order, with `comment` LAST, because the comment
 *      is the start signal and a sandbox that sees it before its grants exist
 *      fails its first clone;
 *   3. the run number is one past the highest run anyone can see — a live VM's
 *      comment or a plan in the fleet-runs clone;
 *   4. the plan really is a commit: `plan=` is the sha of a commit that carries
 *      the plan at `plans/run-<N>.md` and is on the origin.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launch, nextRunNumber, usage } from '../launch.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeFleetRuns, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const BASE = 'a'.repeat(40)
const ENGINE = 'b'.repeat(40)
const TARGET = 'popmechanic/smoke'
const GOLDEN = 'fleet-golden'

const vmsPayload = (rows) => answer(rows)
const billing = (vm_count, max_vms) => answer({ vm_count, max_vms })

/** The three reads a launch always issues, canned green. */
const readRules = ({ vms = [], integrations = [], usage: use = billing(3, 50) } = {}) => [
  sshRule('ls --json', vmsPayload(vms)),
  sshRule('billing usage --json', use),
  sshRule('billing plan --json', answer({ max_vms: 50 })),
  sshRule('integrations list --json', answer(integrations)),
  cmdRule('git', 'ls-remote', answer(`${ENGINE}\tHEAD\n`))
]

/** A workspace: a plan file, its verdicts, and a real fleet-runs checkout. */
function workspace ({ seed = {}, verdicts = true } = {}) {
  const root = tempDir('fleet-launch-')
  const runs = makeFleetRuns({ root, seed })
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, '# a plan\n\nOne task.\n')
  if (verdicts) {
    fs.writeFileSync(path.join(planDir, 'a-plan.gate-verdicts.json'), '{"verdict":"green"}')
  }
  return {
    root,
    runs,
    planPath,
    config: { golden: GOLDEN, fleetRuns: runs.dir, vmTokenPath: path.join(root, 'vm-token') },
    cleanup: () => cleanup(root)
  }
}

const argvFor = (planPath, extra = []) =>
  [planPath, '--target', TARGET, '--base', BASE, ...extra]

// ── 1. Refusals, with nothing executed ──────────────────────────────────────
{
  const ws = workspace()
  const cases = [
    ['no plan', []],
    ['bad target', [ws.planPath, '--target', 'not-a-repo', '--base', BASE]],
    ['target with two slashes', [ws.planPath, '--target', 'a/b/c', '--base', BASE]],
    ['short base', [ws.planPath, '--target', TARGET, '--base', 'abc1234']],
    ['symbolic base', [ws.planPath, '--target', TARGET, '--base', 'HEAD']],
    ['bad engine', [...argvFor(ws.planPath), '--engine', 'HEAD']],
    ['bad overlap', [...argvFor(ws.planPath), '--overlap', 'merge']],
    ['bad tier', [...argvFor(ws.planPath), '--tier', 'cheap']],
    ['bad run', [...argvFor(ws.planPath), '--run', '0']],
    ['unreadable plan', ['/nonexistent/plan.md', '--target', TARGET, '--base', BASE]]
  ]
  for (const [name, argv] of cases) {
    const exec = makeExec({ rules: readRules() })
    const error = await thrown(() => launch({ argv, exec, config: ws.config }))
    assert.ok(error, `(1) ${name} must refuse`)
    assert.equal(error.exitCode, 2, `(1) ${name} refuses with exit 2`)
    assert.equal(exec.calls.length, 0, `(1) ${name} refuses before ANY exec, got ${exec.calls.map((c) => c.line)}`)
  }
  ws.cleanup()
}

// ── 2. Refusal on an existing VM, and on no headroom: reads only ────────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: readRules({ vms: [{ name: 'fleet-run-4', comment: 'run=4 target=x/y' }] })
  })
  const error = await thrown(() => launch({ argv: [...argvFor(ws.planPath), '--run', '4'], exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(2) an existing fleet-run-<N> refuses')
  assert.match(error.message, /fleet-run-4 already exists/, '(2) the refusal names the VM')
  assert.deepEqual(exec.mutating(), [], '(2) nothing was mutated on exe.dev')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ usage: billing(48, 50) }) })
  const error = await thrown(() => launch({ argv: argvFor(ws.planPath), exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(2) vm_count 48 of max_vms 50 refuses (headroom 2)')
  assert.match(error.message, /vm_count 48 of max_vms 50/, '(2) the refusal quotes the meter')
  assert.deepEqual(exec.mutating(), [], '(2) nothing was mutated on exe.dev')
  // The plan must not have been committed either.
  const ws2 = workspace()
  const exec2 = makeExec({ rules: readRules({ usage: billing(47, 50) }) })
  const ok = await launch({ argv: argvFor(ws2.planPath), exec: exec2, config: ws2.config })
  assert.equal(ok.run, 1, '(2) one below the bar still launches')
  ws.cleanup()
  ws2.cleanup()
}

// ── 3. The run number ───────────────────────────────────────────────────────
{
  assert.equal(nextRunNumber({ vms: [], highestPlan: 0 }), 1, '(3) an empty world starts at run 1')
  assert.equal(
    nextRunNumber({ vms: [{ name: 'fleet-run-7', comment: 'run=7 plan=x' }], highestPlan: 3 }),
    8, '(3) a live comment wins over an older plans/ directory'
  )
  assert.equal(
    nextRunNumber({ vms: [{ name: 'fleet-run-2', comment: '' }], highestPlan: 9 }),
    10, '(3) a reaped run still counts through plans/run-9.md'
  )
  assert.equal(
    nextRunNumber({ vms: [{ name: 'fleet-run-12', comment: '' }], highestPlan: 3 }),
    13, '(3) a VM with no comment counts through its name'
  )

  const ws = workspace({ seed: { 'plans/run-9.md': '# nine\n' } })
  const exec = makeExec({
    rules: readRules({ vms: [{ name: 'fleet-run-7', comment: `run=7 plan=${BASE}` }] })
  })
  const result = await launch({ argv: argvFor(ws.planPath), exec, config: ws.config })
  assert.equal(result.run, 10, '(3) max(comment run=7, plans/run-9.md) + 1 = 10')
  assert.equal(result.vm, 'fleet-run-10', '(3) the VM is named for the run')
  assert.equal(result.statusUrl, 'https://fleet-run-10.exe.xyz/status.json', '(3) status URL')
  ws.cleanup()
}

// ── 4. The happy path: four verbs in order, comment last, a real commit ─────
{
  const ws = workspace()
  const exec = makeExec({
    rules: readRules({
      integrations: [
        { name: 't-popmechanic-smoke-ro', attachments: [] },
        { name: 't-popmechanic-smoke-rw', attachments: [] },
        { name: 'claude-max', attachments: [] }
      ]
    })
  })
  const result = await launch({
    argv: [...argvFor(ws.planPath), '--overlap', 'fold', '--tier', 'mostCapable'],
    exec,
    config: ws.config
  })

  assert.equal(result.run, 1, '(4) the first run is 1')
  assert.deepEqual(exec.lobby(), [
    'ls --json',
    'billing usage --json',
    'integrations list --json',
    'cp fleet-golden fleet-run-1 --json',
    'integrations attach claude-max vm:fleet-run-1 --for=6h',
    'integrations attach t-popmechanic-smoke-ro vm:fleet-run-1 --for=4h',
    `comment fleet-run-1 '${result.comment}'`
  ], '(4) the reads, then cp, then the two grants, then the comment')
  assert.equal(
    exec.lobby().at(-1),
    `comment fleet-run-1 '${result.comment}'`,
    '(4) the comment is the LAST lobby verb — it is the start signal'
  )
  for (const call of exec.calls) {
    assert.notEqual(call.cmd, 'sh', '(4) nothing goes through a shell')
    assert.notEqual(call.cmd, 'bash', '(4) nothing goes through a shell')
  }

  // The comment, key by key, in contract order with the optionals trailing.
  assert.equal(
    result.comment,
    `run=1 plan=${result.plan} target=${TARGET} base=${BASE} engine=${ENGINE} overlap=fold tier=mostCapable`,
    '(4) the assignment comment'
  )
  assert.ok(Buffer.byteLength(result.comment, 'utf8') <= 200, '(4) inside the 200-byte ceiling')
  assert.equal(result.engine, ENGINE, '(4) --engine absent → git ls-remote HEAD of the public engine')

  // The plan commit is real, and it is on the origin.
  assert.match(result.plan, /^[0-9a-f]{40}$/, '(4) plan= is a 40-hex sha')
  assert.equal(ws.runs.git(['rev-parse', 'HEAD']), result.plan, '(4) plan= is HEAD of the clone')
  assert.equal(ws.runs.git(['log', '-1', '--format=%s']), 'plan run-1', '(4) the commit message')
  assert.equal(
    ws.runs.git(['show', `${result.plan}:plans/run-1.md`]),
    fs.readFileSync(ws.planPath, 'utf8').trim(),
    '(4) the commit carries the plan at plans/run-1.md'
  )
  assert.equal(
    ws.runs.git(['show', `${result.plan}:plans/run-1.gate-verdicts.json`]),
    '{"verdict":"green"}',
    '(4) and the sibling gate verdicts'
  )
  assert.equal(
    ws.runs.git(['rev-parse', 'origin/main']), result.plan,
    '(4) the commit was pushed — the sandbox clones fleet-runs from GitHub'
  )
  ws.cleanup()
}

// ── 5. The read grant: tag-attached, per-VM, or absent ──────────────────────
{
  const tagged = workspace()
  const exec = makeExec({
    rules: readRules({
      integrations: [{ name: 't-popmechanic-smoke-ro', attachments: ['tag:fleet'] }]
    })
  })
  const result = await launch({ argv: argvFor(tagged.planPath), exec, config: tagged.config })
  assert.ok(
    !exec.lobby().some((line) => line.startsWith('integrations attach t-popmechanic-smoke-ro')),
    '(5) a tag-attached -ro is not attached again per VM'
  )
  assert.equal(result.readGrant, 'tag:fleet', '(5) and the result says where the read grant came from')
  assert.deepEqual(exec.mutating(), [
    'cp fleet-golden fleet-run-1 --json',
    'integrations attach claude-max vm:fleet-run-1 --for=6h',
    `comment fleet-run-1 '${result.comment}'`
  ], '(5) four mutating verbs become three, the comment still last')
  tagged.cleanup()

  const none = workspace()
  const exec2 = makeExec({ rules: readRules({ integrations: [] }) })
  const result2 = await launch({ argv: argvFor(none.planPath), exec: exec2, config: none.config })
  assert.ok(
    !exec2.lobby().some((line) => line.includes('t-popmechanic-smoke-ro')),
    '(5) no -ro object → no read grant (a public target needs none)'
  )
  assert.match(result2.readGrant, /node fleet\/target\.mjs add popmechanic\/smoke/,
    '(5) and the operator is told how to make one')
  none.cleanup()
}

// ── 6. --engine pins, --golden overrides, --run forces ──────────────────────
{
  const ws = workspace()
  const pinned = 'c'.repeat(40)
  const exec = makeExec({ rules: readRules() })
  const result = await launch({
    argv: [...argvFor(ws.planPath), '--engine', pinned, '--golden', 'fleet-golden-next', '--run', '42'],
    exec,
    config: ws.config
  })
  assert.equal(result.engine, pinned, '(6) --engine is used verbatim')
  assert.ok(
    !exec.calls.some((c) => c.cmd === 'git' && c.argv[0] === 'ls-remote'),
    '(6) and no ls-remote is issued when the engine is pinned'
  )
  assert.ok(exec.lobby().includes('cp fleet-golden-next fleet-run-42 --json'), '(6) --golden and --run')
  ws.cleanup()
}

// ── 7. The usage line names every flag the docs promise ────────────────────
{
  for (const flag of ['--target', '--base', '--engine', '--overlap', '--tier', '--golden', '--run', '--json']) {
    assert.ok(usage().includes(flag), `(7) usage names ${flag}`)
  }
}

console.log('ALL TESTS PASSED')
