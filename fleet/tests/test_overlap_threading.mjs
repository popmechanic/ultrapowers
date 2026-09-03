// fleet/tests/test_overlap_threading.mjs — #514: one optional field, threaded
// end to end. `--overlap` is the fold-versus-serialize A/B knob; the engine
// side (`fleet/run-main.mjs`'s `--overlap`, forwarded to `ultra_run.py`)
// already worked, but nothing carried an operator's choice from the drive CLI
// across the sandbox boundary to it. This pins the four hops:
//
//   drive-one `parseArgs`/`buildDriveOptions`
//     → `driveOne`'s `provision({…})` call
//       → `provisionRun`'s assignment payload
//         → the shim's `oneDriverArgs` / `invokeEngineRun` argv
//
// and, at every hop, that the ABSENT case is byte-identical to what shipped
// before: no `overlap` key anywhere, no fourth argv entry. The fleet default
// stays knobless (Amendment 9: fold is the only merge path; serialize is the
// A/B rollback arm, never a standing default).
//
// No network, no live ssh, no `gh`: every sandbox-bound command is a stub, and
// the only real commands are git verbs against a throwaway repo under mkdtemp.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { buildDriveOptions, parseArgs, usage } from '../drive-one.mjs'
import { driveOne } from '../drive.mjs'
import { provisionRun } from '../provision.mjs'
import { invokeEngineRun, oneDriverArgs } from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-overlap-'))

// drive-one requires the two a launch names (#575); every argv below that is
// meant to PARSE carries them.
const NAMED = ['--target', 'o/r', '--base', '3f'.repeat(20)]

// --- hop 1: the drive CLI ---------------------------------------------------

{
  // (a) the flag is parsed and rides into the driveOne options.
  const parsed = parseArgs(['p.md', 'run-1', ...NAMED, '--overlap', 'serialize'])
  assert.equal(parsed.overlap, 'serialize')
  const o = buildDriveOptions(parsed, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
  assert.equal(o.overlap, 'serialize')
  ok('(a) --overlap serialize parses and reaches buildDriveOptions')
}

{
  // (c) the other legal mode, same path.
  const parsed = parseArgs(['p.md', 'run-1', ...NAMED, '--overlap', 'fold'])
  assert.equal(parsed.overlap, 'fold')
  const o = buildDriveOptions(parsed, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
  assert.equal(o.overlap, 'fold')
  ok('(c) --overlap fold parses and reaches buildDriveOptions')
}

{
  // (b) THE ABSENT CASE. Not `overlap: undefined` — no key at all, at both
  // ends. `JSON.stringify` would drop an undefined, but `driveOne`'s option
  // shape is read by `'overlap' in o`-grade checks downstream, and a knobless
  // default must stay knobless.
  const parsed = parseArgs(['p.md', 'run-1', ...NAMED])
  assert.equal('overlap' in parsed, false, `parseArgs invented an overlap key: ${JSON.stringify(parsed)}`)
  const o = buildDriveOptions(parsed, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
  assert.equal('overlap' in o, false, `buildDriveOptions invented an overlap key: ${JSON.stringify(Object.keys(o))}`)
  ok('(b) no flag → no overlap key in parseArgs or buildDriveOptions')
}

{
  // (c, second half) anything but the two legal modes is refused AT PARSE —
  // before a sandbox is cloned — and the refusal carries the usage line. The
  // match is case-sensitive: `ultra_run.py`'s `choices` are lowercase, so
  // `FOLD` would be refused two hops away, on the sandbox, as an argparse
  // error nobody reads.
  for (const argv of [
    ['p.md', 'run-1', ...NAMED, '--overlap', 'sideways'],
    ['p.md', 'run-1', ...NAMED, '--overlap', 'FOLD'],
    ['p.md', 'run-1', ...NAMED, '--overlap'],
  ]) {
    assert.throws(
      () => parseArgs(argv),
      (error) => {
        assert.ok(
          error.message.includes('usage:'),
          `${JSON.stringify(argv)} must refuse with the usage line, got: ${error.message}`,
        )
        return true
      },
      `${JSON.stringify(argv)} must be refused`,
    )
  }
  assert.match(usage(), /--overlap fold\|serialize/)
  ok('(c) a bad mode, a wrong-case mode and a missing value each refuse with usage:')
}

// --- hop 2: driveOne hands it to the provisioner -----------------------------

// A plan the fitness preflight reads as fit. It is shipped from the file
// (#575), so it only has to exist; the engine checkout must be CLEAN (the one
// new refusal), which is why the plan lives beside the repo, not in it.
const FIT_PLAN =
  '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'

const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) =>
      resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' }),
    )
  })

{
  const tmp = tmpDir()
  try {
    const repoDir = path.join(tmp, 'repo')
    const planFile = path.join(tmp, 'plans', 'plan.md')
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    fs.mkdirSync(path.join(repoDir, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '9.9.9' }))
    fs.writeFileSync(planFile, FIT_PLAN)
    const init = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        'git add -A && git -c commit.gpgsign=false commit -q -m init',
      repoDir,
    )
    assert.equal(init.code, 0, `fixture git init failed: ${init.stderr}`)
    const headSha = (await sh('git rev-parse HEAD', repoDir)).stdout.trim()
    // #575: the target's cache clone is cut from this same repo, so the base
    // (its HEAD) is really there for the preflight's `cat-file -e` to find.
    const targetsDir = path.join(tmp, 'targets')

    // The drive is aborted at the provision hop: the stub records what it was
    // handed and throws, so nothing downstream of provisioning runs. (`driveOne`
    // turns a provision failure into a red read rather than a rejection — the
    // recorded argument object is the assertion, not the outcome.)
    //
    // Stubbing `provision` and `destroy` is NOT enough to keep this offline.
    // `driveOne` claims `vmName = sandboxIdFor(runId)` BEFORE it calls
    // `provision` (drive.mjs, "the VM's name is claimed BEFORE the attempt"),
    // so the provision throw still lands in a teardown whose `destroyOnce`
    // calls `pullLogsOnce` first — and that shells `sandboxLogPullCommand`
    // (`ssh … <vm>.exe.xyz 'tar czf -'`) and `sandboxStatCommand`
    // (`ssh … exe.dev "stat <vm>"`), two live ssh invocations per drive, one of
    // them addressed at the real control plane. So the exec seam intercepts
    // every sandbox-bound command the way `_drive_helpers.mjs`'s `makeExec`
    // does, and only real git verbs reach `/bin/sh`. `sshAttempts` records what
    // was intercepted, and is asserted below: if a future teardown path grows a
    // capture this stub does not know about, that is a caught escape, not a
    // silent packet.
    const sshAttempts = []
    const isSandboxBound = (cmd) => cmd.startsWith('ssh ') || /\bssh:\/\//.test(cmd)
    const driveToProvision = async (extra) => {
      let seen = null
      await driveOne({
        planPath: planFile,
        golden: 'fleet-golden',
        port: 0,
        target: 'o/r',
        baseSha: headSha,
        repoDir,
        targetsDir,
        dbDir: path.join(tmp, `db-${extra.runId}`),
        evidenceDir: path.join(tmp, `ev-${extra.runId}`),
        githubTokenPath: path.join(tmp, 'no-such-token'),
        exec: async (cmd) => {
          if (isSandboxBound(cmd)) {
            sshAttempts.push(cmd)
            return { code: 0, stdout: '{}' }
          }
          // The target's first-use clone would go to GitHub; cut it from the
          // fixture repo instead (the `_drive_helpers.mjs` retargeting).
          const cloned = cmd.match(/ clone https:\/\/github\.com\/o\/r\.git (\S+)$/)
          if (cloned) return sh(`git clone -q "${repoDir}" "${cloned[1]}"`, tmp)
          return sh(cmd, repoDir)
        },
        ttlMs: 60_000,
        tickMs: 25,
        settleMs: 50,
        // Belt to the interception's braces: even an unintercepted capture
        // cannot hold the file past a blink of the suite's 120 s per-file cap.
        logPullTimeoutMs: 2_000,
        progressLog: () => {},
        provision: async (args) => {
          seen = args
          throw new Error('overlap-probe: stop at the provision hop')
        },
        destroy: async () => ({ code: 0, stdout: '' }),
        ...extra,
      })
      assert.ok(seen, 'the provision seam must have been reached')
      return seen
    }

    const withFlag = await driveToProvision({ runId: 'run-overlap-on', overlap: 'serialize' })
    assert.equal(withFlag.overlap, 'serialize')

    const without = await driveToProvision({ runId: 'run-overlap-off' })
    assert.equal(
      without.overlap,
      undefined,
      `driveOne must not invent an overlap: ${JSON.stringify(without.overlap)}`,
    )
    ok('(hop 2) driveOne forwards overlap to provision, and forwards nothing when unset')

    // Every sandbox-bound command this block produced went to the stub, and
    // each is one of the two teardown captures — not, say, a shim start, which
    // would mean the drive ran past the hop the stub was supposed to stop it at.
    for (const cmd of sshAttempts) {
      assert.ok(
        /^ssh [\s\S]*\.exe\.xyz [\s\S]*tar czf -/.test(cmd) || /^ssh .* exe\.dev "stat /.test(cmd),
        `unexpected sandbox-bound command reached the exec seam: ${cmd}`,
      )
    }
    ok(`(hop 2) all ${sshAttempts.length} sandbox-bound commands were intercepted, none shelled`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// --- hop 3: the sandbox assignment payload -----------------------------------

// Reads the delivered payload back out of the FLEET_EOF heredoc, exactly as
// test_provision.mjs:79-85 does — that is the wire, and the wire is the pin.
const deliveredPayload = async (extra) => {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }
  const result = await provisionRun({
    golden: 'fleet-golden',
    runId: 'r1',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'docs/superpowers/plans/2026-08-21-width-w1.md',
    exec,
    clock: () => 1000,
    ...extra,
  })
  const delivery = cmds.find((c) => c.includes('/home/exedev/fleet-run.json'))
  assert.ok(delivery, `no assignment delivery command among: ${JSON.stringify(cmds)}`)
  const match = delivery.match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
  assert.ok(match, 'the delivery command must embed a FLEET_EOF heredoc payload')
  return { payload: JSON.parse(match[1]), token: result.token }
}

{
  // (d) with the field set, it rides the assignment.
  const { payload, token } = await deliveredPayload({ overlap: 'serialize' })
  assert.deepEqual(payload, {
    runId: 'r1',
    token,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    ttlMs: 60000,
    planPath: 'docs/superpowers/plans/2026-08-21-width-w1.md',
    overlap: 'serialize',
  })
  ok('(d) provisionRun delivers overlap: serialize in the assignment payload')
}

{
  // (d, absent) the whole payload — keys and order — byte-identical to the
  // shipped pin. An old sandbox image reading this file must see exactly what
  // it saw before #514.
  const { payload, token } = await deliveredPayload({})
  assert.equal('overlap' in payload, false, `no overlap key when unset, got: ${JSON.stringify(payload)}`)
  assert.deepEqual(Object.keys(payload), ['runId', 'token', 'wsUrl', 'ttlMs', 'planPath'])
  assert.deepEqual(payload, {
    runId: 'r1',
    token,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    ttlMs: 60000,
    planPath: 'docs/superpowers/plans/2026-08-21-width-w1.md',
  })
  ok('(d) no flag → the assignment payload is byte-identical to the shipped pin')
}

// --- hop 4: the engine launch argv -------------------------------------------

{
  // (e) `overlap` appends exactly two entries, in run-main.mjs's own flag
  // spelling; without it the five-entry array is today's pinned launch.
  const base = { engineDir: '/engine', repoDir: '/repo', planPath: 'docs/plan.md', runId: 'run-24' }
  assert.deepEqual(
    oneDriverArgs({ ...base, overlap: 'serialize' }),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/repo', '--overlap', 'serialize'],
  )
  assert.deepEqual(
    oneDriverArgs(base),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/repo'],
  )
  ok('(e) oneDriverArgs appends --overlap <mode> only when given')
}

{
  // (f) and that argv is what is actually spawned, from the assignment's field.
  const spawnedArgs = async (extra) => {
    const tmp = tmpDir()
    try {
      const spawns = []
      await invokeEngineRun({
        engineDir: '/engine',
        repoDir: tmp,
        planPath: 'docs/plan.md',
        runId: 'run-24',
        exec: async () => ({ code: 0, stdout: '' }),
        spawnEngine: async (call) => {
          spawns.push(call)
          return 0
        },
        log: () => {},
        ...extra,
      })
      assert.equal(spawns.length, 1)
      assert.equal(spawns[0].command, 'node')
      return spawns[0].args.map((a) => String(a).replace(tmp, '/repo'))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  assert.deepEqual(await spawnedArgs({ overlap: 'serialize' }), [
    '/engine/fleet/run-main.mjs',
    'docs/plan.md',
    'run-24',
    '--repo',
    '/repo',
    '--overlap',
    'serialize',
  ])
  assert.deepEqual(await spawnedArgs({}), [
    '/engine/fleet/run-main.mjs',
    'docs/plan.md',
    'run-24',
    '--repo',
    '/repo',
  ])
  ok('(f) invokeEngineRun spawns seven argv entries with overlap, exactly five without')
}

console.log(`\nALL TESTS PASSED (${passed})`)
