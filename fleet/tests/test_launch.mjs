/**
 * fleet/tests/test_launch.mjs — the lobby reader and the launcher.
 *
 * What is pinned is behaviour the fleet cannot survive without:
 *
 *   0. the lobby: `ls` sends the name pattern server-side and reads `.vms[]`
 *      ONLY (a shared VM is never a fleet row); a failing verb surfaces the
 *      lobby's whole output; a VM name is one incarnation, never N alone;
 *   1. every refusal happens with NOTHING executed;
 *   2. the run number is one past the highest `plans/run-*.md`;
 *   3. the verbs in order — cp, the two attaches (`claude-max`, then the
 *      target's one GitHub object), the comment — and the ssh start ONLY after
 *      all of them, so the boot never races an attachment; a target with no
 *      GitHub object is a refusal before the plan is committed;
 *   4. a refused `cp` prints exe.dev's own words and stops there;
 *   5. the ssh wait retries, then gives up naming the start command;
 *   6. the plan really is a commit on the origin.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launch, renderLaunch, usage, startCommandFor, SSH_WAIT_MS, SSH_RETRY_MS } from '../launch.mjs'
import {
  LobbyError, isVmName, listVms, runOfVmName, statusUrlFor, vmNameFor, vmPatternFor
} from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeFleetRuns, sshRule, tempDir, thrown, vmRow, vmRule, vmsPayload
} from './_lobby_helpers.mjs'

const BASE = 'a'.repeat(40)
const ENGINE = 'b'.repeat(40)
const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration, which every launch attaches. */
const GH = 'gh-popmechanic-smoke'
const GOLDEN = 'fleet-golden'
const NOW = new Date('2026-09-03T22:15:00.000Z')
const RAND = 'a1b2'
/** The name every launch in this file mints: run 1 at NOW with RAND. */
const VM1 = 'fleet-r1-2609032215-a1b2'
/** And the command that starts run 1: the template instanced with N. */
const START_1 = startCommandFor(1)

/** The reads and the post-cp lookup, canned green: `ls '<vm>'` answers a row for
 *  whatever name was asked about, with an ssh_dest that is not the DNS name. */
const readRules = ({ integrations = [{ name: GH, attachments: [] }], ls } = {}) => [
  sshRule('integrations list --json', answer(integrations)),
  sshRule('ls ', ls ?? ((cmd, argv) => {
    const name = /^ls '([^']+)'/.exec(argv[1])?.[1]
    return vmsPayload([vmRow(name)])
  })),
  vmRule(answer('')),
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

const launchIn = (ws, { argv = argvFor(ws.planPath), exec, sleep = async () => {}, refreshCredential = () => ({ ok: true }) } = {}) =>
  launch({ argv, exec, config: ws.config, now: () => NOW, sleep, rand: RAND, refreshCredential })

// ── 0. The lobby reader and the names ───────────────────────────────────────
{
  assert.equal(vmNameFor(7, NOW, RAND), 'fleet-r7-2609032215-a1b2', '(0) fleet-r<N>-<yymmddHHMM>-<4 hex>')
  assert.ok(isVmName('fleet-r7-2609032215-a1b2'), '(0) a minted name is a VM name')
  assert.ok(!isVmName('fleet-run-7'), '(0) the pre-lift shape is not')
  assert.ok(!isVmName('fleet-golden'), '(0) nor is the golden')
  assert.equal(runOfVmName('fleet-r70-2609032215-ffff'), 70, '(0) the run number is read back off the name')
  assert.equal(runOfVmName('fleet-golden'), null, '(0) and a non-run name has none')
  assert.equal(vmPatternFor(7), 'fleet-r7-*', '(0) the pattern for one run')
  assert.equal(statusUrlFor('fleet-r7-2609032215-a1b2'), 'https://fleet-r7-2609032215-a1b2.exe.xyz/status.json', '(0) the status URL is the VM name')
  assert.ok(/^fleet-r3-[0-9]{10}-[0-9a-f]{4}$/.test(vmNameFor(3)), '(0) the defaults mint a well-formed name')
  assert.notEqual(vmNameFor(3), vmNameFor(3), '(0) two mints differ — a name is one incarnation')

  // `.vms[]` only: the shared row is another account's, whatever its name.
  const exec = makeExec({
    rules: [sshRule('ls ', vmsPayload(
      [vmRow('fleet-r7-2609032215-a1b2', { comment: 'run=7', tags: ['fleet'] }), vmRow('fleet-golden')],
      [vmRow('fleet-r7-2609032215-dead', { comment: 'run=7' }), vmRow('snw-build')]
    ))]
  })
  const rows = await listVms(exec, vmPatternFor(7))
  assert.deepEqual(exec.lobby(), ["ls 'fleet-r7-*' --json"], '(0) the pattern is sent server-side, quoted')
  assert.deepEqual(rows.map((r) => r.name), ['fleet-r7-2609032215-a1b2', 'fleet-golden'], '(0) .vms[] rows only — no shared_vms row is ever seen')
  assert.deepEqual(rows[0], {
    name: 'fleet-r7-2609032215-a1b2',
    sshDest: 'exedev@fleet-r7-2609032215-a1b2.ssh.exe.xyz',
    sshHost: 'fleet-r7-2609032215-a1b2.ssh.exe.xyz',
    status: 'running',
    comment: 'run=7',
    tags: ['fleet']
  }, '(0) the documented fields, plus the optional two when present')
  assert.equal(rows[1].comment, null, '(0) an absent comment is null, not a crash')
  assert.equal(rows[1].tags, null, '(0) absent tags are null')
  await listVms(exec)
  assert.equal(exec.lobby().at(-1), "ls 'fleet-r*' --json", '(0) the default pattern is the whole fleet')

  const broken = makeExec({
    rules: [sshRule('ls ', answer('Error: something the lobby said\n', { code: 3, stderr: 'and on stderr too\n' }))]
  })
  const error = await thrown(() => listVms(broken))
  assert.ok(error instanceof LobbyError, '(0) a non-zero ls is a LobbyError')
  assert.equal(error.exitCode, 1, '(0) exit 1')
  assert.match(error.message, /^exe\.dev ls failed \(exit 3\):\n/, '(0) the verb and the exit code')
  assert.match(error.message, /something the lobby said/, '(0) stdout is in the message')
  assert.match(error.message, /and on stderr too/, '(0) and so is stderr — nothing is swallowed')

  const bare = makeExec({ rules: [sshRule('ls ', answer([vmRow('fleet-r1-2609032215-a1b2')]))] })
  assert.deepEqual(await listVms(bare), [], '(0) a payload with no .vms has no rows — a bare array is not the envelope')
}

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
    const error = await thrown(() => launchIn(ws, { argv, exec }))
    assert.ok(error, `(1) ${name} must refuse`)
    assert.equal(error.exitCode, 2, `(1) ${name} refuses with exit 2`)
    assert.equal(exec.calls.length, 0, `(1) ${name} refuses before ANY exec, got ${exec.calls.map((c) => c.line)}`)
  }
  ws.cleanup()
}

// ── 2. The run number: one past the highest plan ────────────────────────────
{
  const ws = workspace({ seed: { 'plans/run-9.md': '# nine\n', 'plans/run-12.md': '# twelve\n' } })
  const exec = makeExec({ rules: readRules() })
  const result = await launchIn(ws, { exec })
  assert.equal(result.run, 13, '(2) max(plans/run-*.md) + 1')
  assert.equal(result.vm, 'fleet-r13-2609032215-a1b2', '(2) the VM is named for the run, the minute and the random half')
  assert.equal(result.statusUrl, 'https://fleet-r13-2609032215-a1b2.exe.xyz/status.json', '(2) status URL')
  assert.ok(
    !exec.lobby().some((line) => line.startsWith("ls 'fleet-r*'")),
    '(2) no fleet-wide ls is needed to number a run — plans/ is the record'
  )
  ws.cleanup()

  const forced = workspace({ seed: { 'plans/run-9.md': '# nine\n' } })
  const exec2 = makeExec({ rules: readRules() })
  const result2 = await launchIn(forced, { argv: [...argvFor(forced.planPath), '--run', '42'], exec: exec2 })
  assert.equal(result2.run, 42, '(2) --run forces the number')
  assert.equal(result2.vm, 'fleet-r42-2609032215-a1b2', '(2) and the name')
  forced.cleanup()
}

// ── 3. The happy path: verbs in order, start only after attach + comment ────
{
  const ws = workspace()
  const exec = makeExec({
    rules: readRules({
      integrations: [
        { name: 'fleet-runs', attachments: ['tag:fleet'] },
        { name: GH, attachments: [] },
        { name: 'claude-max', attachments: [] }
      ]
    })
  })
  const result = await launchIn(ws, {
    argv: [...argvFor(ws.planPath), '--overlap', 'fold', '--tier', 'mostCapable'], exec
  })

  assert.equal(result.run, 1, '(3) the first run is 1')
  assert.equal(result.vm, VM1, '(3) the VM name')
  assert.deepEqual(exec.lobby(), [
    'integrations list --json',
    `cp fleet-golden ${VM1} --copy-tags --json`,
    `integrations attach claude-max vm:${VM1} --for 6h`,
    `integrations attach ${GH} vm:${VM1} --for 6h`,
    `comment ${VM1} '${result.comment}'`,
    `ls '${VM1}' --json`
  ], '(3) the read, then cp with the tags, the two 6 h attachments, the comment, the ssh_dest lookup')
  assert.equal(result.github, GH, '(3) the record names the GitHub object the run rides')
  assert.deepEqual(exec.vm(), [
    { dest: `exedev@${VM1}.ssh.exe.xyz`, command: 'true' },
    { dest: `exedev@${VM1}.ssh.exe.xyz`, command: START_1 }
  ], '(3) then ssh to the row\'s ssh_dest: the readiness probe, then the start')
  // No `--no-block` (Counsel 3): the unit is Type=exec, so the blocking start's
  // exit status is the launch ack. The instance carries the run number.
  assert.equal(START_1, 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user start fleet-run@1.service', '(3) the start command')
  assert.equal(startCommandFor(70), 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user start fleet-run@70.service', '(3) instanced per run')
  assert.equal(result.sshDest, `exedev@${VM1}.ssh.exe.xyz`, '(3) ssh_dest is read off the row, never derived from the name')

  // Start is last: after both attaches and the comment, as call indices.
  const index = (pred) => exec.calls.findIndex((c) => pred(c))
  const startAt = index((c) => c.cmd === 'ssh' && c.argv.includes(START_1))
  const lastMutation = Math.max(
    index((c) => c.argv[1]?.startsWith('integrations attach claude-max')),
    index((c) => c.argv[1]?.startsWith(`integrations attach ${GH}`)),
    index((c) => c.argv[1]?.startsWith('comment '))
  )
  assert.ok(startAt > lastMutation, '(3) the start happens only after both attaches and the comment')
  assert.equal(exec.calls.filter((c) => c.argv.includes(START_1)).length, 1, '(3) and exactly once')
  for (const call of exec.calls) {
    assert.notEqual(call.cmd, 'sh', '(3) nothing goes through a shell')
    assert.notEqual(call.cmd, 'bash', '(3) nothing goes through a shell')
  }

  assert.equal(
    result.comment,
    `run=1 plan=${result.plan} target=${TARGET} base=${BASE} engine=${ENGINE} overlap=fold tier=mostCapable`,
    '(3) the assignment comment, keys in contract order'
  )
  assert.ok(Buffer.byteLength(result.comment, 'utf8') <= 200, '(3) inside the 200-byte ceiling')
  assert.equal(result.engine, ENGINE, '(3) --engine absent → git ls-remote HEAD of the public engine')
  assert.deepEqual(
    renderLaunch(result).split('\n'),
    ['run-1', VM1, `https://${VM1}.exe.xyz/status.json`, result.comment],
    '(3) printed: the run id, the VM, the status URL, the assignment'
  )
  for (const key of ['run', 'runId', 'vm', 'statusUrl', 'comment', 'sshDest', 'plan']) {
    assert.ok(key in result, `(3) --json carries ${key}`)
  }

  // (6) The plan commit is real, and it is on the origin.
  assert.match(result.plan, /^[0-9a-f]{40}$/, '(6) plan= is a 40-hex sha')
  assert.equal(ws.runs.git(['rev-parse', 'HEAD']), result.plan, '(6) plan= is HEAD of the clone')
  assert.equal(ws.runs.git(['log', '-1', '--format=%s']), 'plan run-1', '(6) the commit message')
  assert.equal(
    ws.runs.git(['show', `${result.plan}:plans/run-1.md`]),
    fs.readFileSync(ws.planPath, 'utf8').trim(),
    '(6) the commit carries the plan at plans/run-1.md'
  )
  assert.equal(
    ws.runs.git(['show', `${result.plan}:plans/run-1.gate-verdicts.json`]),
    '{"verdict":"green"}',
    '(6) and the sibling gate verdicts'
  )
  assert.equal(ws.runs.git(['rev-parse', 'origin/main']), result.plan, '(6) the commit was pushed')
  ws.cleanup()
}

// ── 3b. No GitHub object for the target: a refusal, before the plan commit ──
{
  // A public repo would still clone from github.com, but nothing could push
  // its branch or open its PR — so the launch refuses, with exe.dev and
  // fleet-runs untouched, and names the one command that builds the object.
  const ws = workspace()
  const before = ws.runs.git(['rev-parse', 'origin/main'])
  const exec = makeExec({ rules: readRules({ integrations: [{ name: 'claude-max', attachments: [] }] }) })
  const error = await thrown(() => launchIn(ws, { exec }))
  assert.ok(error, '(3b) a target with no gh- object must refuse')
  assert.equal(error.exitCode, 2, '(3b) exit 2')
  assert.match(error.message, new RegExp(`no ${GH} integration`), '(3b) naming the missing object')
  assert.match(error.message, /public .*github\.com/, '(3b) saying a public target would clone but not publish')
  assert.ok(error.message.includes(`node fleet/target.mjs ${TARGET}`), '(3b) and the command that builds it')
  assert.deepEqual(exec.mutating(), [], '(3b) no cp, no attach, no comment')
  assert.deepEqual(exec.vm(), [], '(3b) no ssh into anything')
  assert.equal(ws.runs.git(['rev-parse', 'origin/main']), before, '(3b) and no plan was committed — the run number is not spent')
  assert.ok(!fs.existsSync(path.join(ws.runs.dir, 'plans', 'run-1.md')), '(3b) not even locally')
  ws.cleanup()
}

// ── 4. A refused cp is exe.dev's own text, and nothing follows it ───────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: [
      sshRule('cp ', answer('name already reserved: fleet-r1-2609032215-a1b2\n', { code: 1, stderr: 'usage: cp <src> <dst>\n' })),
      ...readRules()
    ]
  })
  const error = await thrown(() => launchIn(ws, { exec }))
  assert.ok(error instanceof LobbyError, '(4) a refused cp is a failure, exit 1')
  assert.equal(error.exitCode, 1, '(4) exit 1')
  assert.match(error.message, /exe\.dev cp failed \(exit 1\):\n/, '(4) the verb named')
  assert.match(error.message, /name already reserved: fleet-r1-2609032215-a1b2/, '(4) the lobby\'s stdout, verbatim')
  assert.match(error.message, /usage: cp <src> <dst>/, '(4) and its stderr')
  assert.deepEqual(exec.mutating(), [`cp fleet-golden ${VM1} --copy-tags --json`], '(4) no attach, no comment after a refused cp')
  assert.deepEqual(exec.vm(), [], '(4) and no ssh into anything')
  ws.cleanup()
}

// ── 5. The ssh wait: retries, then gives up naming the start ────────────────
{
  const ws = workspace()
  let probes = 0
  const exec = makeExec({
    rules: [
      vmRule((cmd, argv) => {
        if (argv.at(-1) !== 'true') return answer('')
        probes += 1
        return probes < 3 ? answer('', { code: 255, stderr: 'Connection refused\n' }) : answer('')
      }),
      ...readRules()
    ]
  })
  const slept = []
  const result = await launchIn(ws, { exec, sleep: async (ms) => { slept.push(ms) } })
  assert.equal(probes, 3, '(5) two refusals, then an answer')
  assert.deepEqual(slept, [SSH_RETRY_MS, SSH_RETRY_MS], '(5) one sleep per refusal')
  assert.equal(exec.vm().filter((c) => c.command === START_1).length, 1, '(5) the start is issued once, after the probe answers')
  assert.equal(exec.vm().at(-1).command, START_1, '(5) and last')
  assert.equal(result.vm, VM1, '(5) the launch completes')
  ws.cleanup()

  // Never answers: the clock runs out and the operator gets the start command.
  const stuck = workspace()
  let t = 0
  const exec2 = makeExec({
    rules: [vmRule(answer('', { code: 255, stderr: 'Connection timed out\n' })), ...readRules()]
  })
  const error = await thrown(() => launch({
    argv: argvFor(stuck.planPath),
    exec: exec2,
    config: stuck.config,
    now: () => new Date(NOW.getTime() + t),
    sleep: async (ms) => { t += ms },
    rand: RAND
  }))
  assert.ok(error instanceof LobbyError, '(5) a VM that never answers is a failure')
  assert.match(error.message, new RegExp(`within ${SSH_WAIT_MS / 1000} s`), '(5) naming the wait')
  assert.match(error.message, /Connection timed out/, '(5) with the last ssh answer')
  assert.ok(error.message.includes(`ssh exedev@${VM1}.ssh.exe.xyz '${START_1}'`), '(5) and the start command to run by hand')
  assert.ok(!exec2.vm().some((c) => c.command === START_1), '(5) no start was issued')
  assert.ok(t >= SSH_WAIT_MS, '(5) it waited the whole window')
  stuck.cleanup()
}

// ── 5b. A start that answers non-zero is a launch failure, verbatim ─────────
{
  // Type=exec: `systemctl start` fails when the bootstrap cannot be exec'd.
  // That answer is the whole point of dropping `--no-block`, so it has to
  // surface as a failure with systemd's own words, not as a launched run.
  const ws = workspace()
  const exec = makeExec({
    rules: [
      vmRule((cmd, argv) => argv.at(-1) === START_1
        ? answer('', { code: 1, stderr: 'Job for fleet-run@1.service failed because the control process exited with error code.\nSee "systemctl --user status fleet-run@1.service" and "journalctl --user -xeu fleet-run@1.service" for details.\n' })
        : answer('')),
      ...readRules()
    ]
  })
  const error = await thrown(() => launchIn(ws, { exec }))
  assert.ok(error instanceof LobbyError, '(5b) a non-zero start is a failure, exit 1')
  assert.equal(error.exitCode, 1, '(5b) exit 1')
  assert.match(error.message, /run 1 did not start/, '(5b) named as the run not starting')
  assert.match(error.message, /\(exit 1\)/, '(5b) with the exit status')
  assert.ok(error.message.includes(`ssh exedev@${VM1}.ssh.exe.xyz '${START_1}'`), '(5b) and the command that failed')
  assert.ok(error.message.includes('Job for fleet-run@1.service failed'), '(5b) and systemd\'s words, verbatim')
  assert.equal(exec.vm().filter((c) => c.command === START_1).length, 1, '(5b) the start was issued once and not retried')
  ws.cleanup()
}

// ── 7. --engine pins, --golden overrides, usage names the flags ─────────────
{
  const ws = workspace()
  const pinned = 'c'.repeat(40)
  const exec = makeExec({ rules: readRules() })
  const result = await launchIn(ws, {
    argv: [...argvFor(ws.planPath), '--engine', pinned, '--golden', 'fleet-golden-next'], exec
  })
  assert.equal(result.engine, pinned, '(7) --engine is used verbatim')
  assert.ok(!exec.calls.some((c) => c.cmd === 'git' && c.argv[0] === 'ls-remote'), '(7) no ls-remote when the engine is pinned')
  assert.ok(exec.lobby().includes(`cp fleet-golden-next ${VM1} --copy-tags --json`), '(7) --golden')
  ws.cleanup()

  for (const flag of ['--target', '--base', '--engine', '--overlap', '--tier', '--golden', '--run', '--json']) {
    assert.ok(usage().includes(flag), `(7) usage names ${flag}`)
  }
}

// ── 9. The Claude credential is refreshed before any VM exists ───────────────
{
  const ws = workspace()
  const order = []
  const exec = makeExec({ rules: readRules() })
  await launchIn(ws, { exec, refreshCredential: () => { order.push(`refresh@${exec.calls.length}`); return { ok: true } } })
  const cpIndex = exec.calls.findIndex((c) => c.argv.join(' ').includes(' cp '))
  assert.equal(order.length, 1, '(9) refresh runs once')
  assert.ok(Number(order[0].split('@')[1]) <= cpIndex, '(9) refresh runs before cp')
  ws.cleanup()

  const ws2 = workspace()
  const exec2 = makeExec({ rules: readRules() })
  const error = await thrown(() => launchIn(ws2, { exec: exec2, refreshCredential: () => ({ ok: false, out: 'token endpoint answered 400: nope' }) }))
  assert.match(error?.message ?? '', /could not be refreshed — no VM was created/, '(9) a failed refresh refuses')
  assert.match(error.message, /token endpoint answered 400/, '(9) with the tool\'s own words')
  assert.ok(!exec2.calls.some((c) => c.argv.join(' ').includes(' cp ')), '(9) and no cp was issued')
  ws2.cleanup()
}

console.log('ALL TESTS PASSED')
