import assert from 'node:assert/strict'
import { provisionRun, destroySandbox, SANDBOX_SSH_OPTS, sandboxGitSsh } from '../provision.mjs'
import { hashToken } from '../tokens.mjs'

// SANDBOX_SSH_OPTS / sandboxGitSsh: the no-pin host-key posture every
// sandbox-bound command threads through (#211) — sandboxes are ephemeral, so
// there is no host key worth pinning, and a reused/recycled hostname would
// otherwise trip a stale known_hosts entry on ssh's `accept-new` default.
assert.equal(SANDBOX_SSH_OPTS, '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null')
assert.equal(sandboxGitSsh, `ssh ${SANDBOX_SSH_OPTS}`)

// provisionRun: recording exec stub. The SSH-probe leg fails once (code 1)
// then succeeds (code 0) to prove the retry loop; every other command
// succeeds immediately. Eight logical steps (#575: the base push became a
// `git init` plus TWO pushes), and the failed probe attempt makes nine exec
// calls — count them below.
{
  const cmds = []
  let probeCalls = 0
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd.startsWith('ssh -o BatchMode=yes') && cmd.endsWith(' true')) {
      probeCalls++
      if (probeCalls === 1) return { code: 1, stdout: '' }
      return { code: 0, stdout: '' }
    }
    return { code: 0, stdout: '{}' }
  }

  const isSandboxBound = (cmd) => cmd.includes(SANDBOX_SSH_OPTS)

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
  })

  assert.equal(result.vmName, 'fleet-r1')
  assert.match(result.token, /^[0-9a-f]{64}$/)
  assert.equal(result.record.sandboxId, 'fleet-r1')
  assert.ok(!('token' in result.record), 'returned record carries only the hash, never the raw token')
  assert.equal(result.record.tokenHash, hashToken(result.token))
  assert.equal(result.record.expiresAt, 1000 + 60000)

  // Exec call count: clone(1) + probe-fail(1) + probe-ok(1) + delivery(1) + git-init(1) + engine-push(1) + target-push(1) + tunnel(1) + shim-start(1) = 9.
  assert.equal(cmds.length, 9, `expected 9 exec calls, got ${cmds.length}: ${JSON.stringify(cmds)}`)

  // Step 1: clone the golden VM — a LOBBY command, no host-key flags.
  assert.ok(
    cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r1 --json"'),
    `cmds[0] should be the golden-clone command, got: ${cmds[0]}`
  )
  assert.ok(!isSandboxBound(cmds[0]), `the lobby clone must carry no host-key flags, got: ${cmds[0]}`)

  // Step 2: wait-for-ssh probe, retried until it succeeds — the identical
  // command re-issued on retry (proving the retry loop, not a different path).
  assert.ok(cmds[1].startsWith('ssh -o BatchMode=yes -o ConnectTimeout=5 '), `cmds[1] should be the ssh probe, got: ${cmds[1]}`)
  assert.ok(cmds[1].includes('fleet-r1.exe.xyz true'))
  assert.ok(isSandboxBound(cmds[1]), `the reachability probe must carry the no-pin host-key flags, got: ${cmds[1]}`)
  assert.equal(cmds[2], cmds[1], 'retry re-issues the identical probe command')

  // Step 3: token mint issues no command — already proven by the exec call
  // count above (no seventh call between the probe and the delivery).

  // Step 4: token + assignment delivery, JSON embedded as a heredoc payload.
  assert.ok(
    cmds[3].startsWith(`ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json'`),
    `cmds[3] should be the delivery command, got: ${cmds[3]}`
  )
  const payloadMatch = cmds[3].match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
  assert.ok(payloadMatch, 'delivery command must embed a FLEET_EOF heredoc payload')
  const payload = JSON.parse(payloadMatch[1])
  assert.equal(payload.runId, 'r1')
  assert.equal(payload.token, result.token, 'the raw token is delivered to the sandbox')
  assert.equal(payload.wsUrl, 'ws://127.0.0.1:8151/fleet')
  assert.equal(payload.ttlMs, 60000)
  assert.equal(payload.planPath, 'docs/superpowers/plans/2026-08-21-width-w1.md', 'the plan path is delivered to the sandbox')
  assert.ok(!('engine' in payload), 'no engine key when unset — old assignments stay byte-identical')

  // Step 5 (#575): the target's fresh clone is initialised on the sandbox,
  // then the ENGINE is pushed into the golden's baked clone as `fleet-engine`
  // and the TARGET into the fresh one as `fleet-base` — each push via
  // `-c core.sshCommand=` carrying the no-pin flags, since a bare `ssh://` URL
  // gives git no way to pass ssh options. Byte for byte, in this order.
  assert.equal(cmds[4], `ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'git init -q /home/exedev/target'`, `cmds[4] should be the target git init, got: ${cmds[4]}`)
  assert.equal(
    cmds[5],
    `git -C /tmp/engine -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@fleet-r1.exe.xyz/home/exedev/repo ${'e'.repeat(40)}:refs/heads/fleet-engine`,
    `cmds[5] should be the engine push, got: ${cmds[5]}`
  )
  assert.equal(
    cmds[6],
    `git -C /tmp/targets/o--r -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@fleet-r1.exe.xyz/home/exedev/target ${'b'.repeat(40)}:refs/heads/fleet-base`,
    `cmds[6] should be the target push, got: ${cmds[6]}`
  )
  for (const i of [5, 6]) assert.ok(cmds[i].includes(SANDBOX_SSH_OPTS), `push ${i} must carry the no-pin host-key flags, got: ${cmds[i]}`)
  assert.ok(!('engine' in payload), 'the payload carries no engine key — #575 deleted it')

  // Step 6: the SSH reverse tunnel (#196). exe.dev VMs share no private
  // network, so the sandbox reaches the orchestrator's ws port only through a
  // reverse tunnel mapping sandbox:127.0.0.1:<port> back to the orchestrator's
  // 127.0.0.1:<port> — which is what keeps `wsUrl` true on both ends. It is
  // opened AFTER the pushes and BEFORE the shim starts.
  assert.equal(
    cmds[7],
    `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes ${SANDBOX_SSH_OPTS} -fN -R 8151:127.0.0.1:8151 fleet-r1.exe.xyz`,
    `cmds[7] should be the reverse tunnel, got: ${cmds[7]}`
  )

  // Step 7: shim start — last, after the tunnel exists to carry its ws. Checks
  // out `fleet-engine` in the ENGINE clone first (#282/#575: the golden's
  // baked-in checkout is stale the moment a new engine is pushed; the target's
  // `fleet-base` checkout is the shim's own), `&&`-gated ahead of `nohup` so a
  // failed checkout starts nothing; its output truncates shim.log, the shim
  // appends.
  assert.equal(
    cmds[8],
    `ssh -n ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-engine > /home/exedev/shim.log 2>&1 || exit 1; nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 < /dev/null &'`,
    `cmds[8] should be the shim start, got: ${cmds[8]}`
  )
  assert.ok(!cmds[8].includes('fleet-base'), 'the shim start never checks out fleet-base — that is the shim\'s own leg')
}

// provisionRun: a tunnel that fails to open is surfaced, not swallowed — a run
// whose tunnel never came up would otherwise hang at `claimed` forever. The
// shim is NOT started on top of a dead tunnel.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd.includes(' -fN -R ')) return { code: 255, stdout: 'remote port forwarding failed' }
    return { code: 0, stdout: '{}' }
  }
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden',
      runId: 'r2',
      engineDir: '/tmp/engine',
      engineSha: 'e'.repeat(40),
      targetDir: '/tmp/targets/o--r',
      baseSha: 'b'.repeat(40),
      ttlMs: 60000,
      wsUrl: 'ws://127.0.0.1:8152/fleet',
      port: 8152,
      planPath: 'docs/plan.md',
      exec,
      clock: () => 1000,
    }),
    /tunnel/,
    'a failed tunnel open must reject with an error naming the tunnel'
  )
  assert.ok(
    !cmds.some((cmd) => cmd.includes('shim-main.mjs')),
    `the shim must not be started over a dead tunnel, got: ${JSON.stringify(cmds)}`
  )
}

// provisionRun (#575): a REJECTED push is surfaced, not swallowed — the shim
// would otherwise check out a stale `fleet-engine` (or nothing) and the drive
// would idle to its claim timeout with no line naming the push. Neither the
// tunnel nor the shim start is issued behind a failed push.
for (const [step, hit] of [['engine push', / push ssh:\/\/\S+\/home\/exedev\/repo /], ['target push', / push ssh:\/\/\S+\/home\/exedev\/target /], ['target git init', /git init -q \/home\/exedev\/target/]]) {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (hit.test(cmd)) return { code: 1, stdout: '', stderr: '! [rejected] (non-fast-forward)' }
    return { code: 0, stdout: '{}' }
  }
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden',
      runId: 'r-push-fail',
      engineDir: '/tmp/engine',
      engineSha: 'e'.repeat(40),
      targetDir: '/tmp/targets/o--r',
      baseSha: 'b'.repeat(40),
      ttlMs: 60000,
      wsUrl: 'ws://127.0.0.1:8151/fleet',
      port: 8151,
      planPath: 'p.md',
      exec,
      clock: () => 1000,
    }),
    (error) => {
      assert.ok(error.message.includes(step), `${step}: the error names the step, got: ${error.message}`)
      assert.ok(error.message.includes('non-fast-forward'), `${step}: the error carries git's reason`)
      return true
    },
  )
  assert.ok(!cmds.some((c) => / -fN -R /.test(c)), `${step}: no tunnel behind a failed push`)
  assert.ok(!cmds.some((c) => /shim-main\.mjs/.test(c)), `${step}: no shim start behind a failed push`)
}

// destroySandbox: the VM is removed FIRST (the billing clock is what teardown
// protects), then the detached `-fN -R` tunnel process left on the orchestrator
// is killed (#196). The pkill pattern is exact enough to match only the tunnel
// — and it must not be able to match the shell that carries it: a bare
// `pkill -f "-R <port>:…"` matches its own `sh -c` argv and kills the caller
// (it did, in the live run). `[-]R` matches `-R` in the tunnel's argv but not
// the literal `[-]R` in its own.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '' }
  }
  await destroySandbox({ vmName: 'fleet-r1', port: 8151, exec })
  assert.equal(cmds.length, 2, `expected rm + tunnel-kill, got: ${JSON.stringify(cmds)}`)
  assert.equal(cmds[0], 'ssh exe.dev "rm fleet-r1 --json"')
  assert.ok(!cmds[0].includes('StrictHostKeyChecking') && !cmds[0].includes('UserKnownHostsFile'), `the lobby rm must carry no host-key flags, got: ${cmds[0]}`)
  assert.ok(cmds[1].startsWith('pkill -f '), `cmds[1] should be the tunnel kill, got: ${cmds[1]}`)
  assert.ok(cmds[1].includes('[-]R 8151:127.0.0.1:8151 fleet-r1.exe.xyz'), `tunnel-kill pattern must name port and vm: ${cmds[1]}`)
  assert.ok(!/ -R 8151/.test(cmds[1]), `tunnel-kill pattern must not be matchable by its own argv: ${cmds[1]}`)
  // The pattern really does match the tunnel's argv (with its host-key flags)
  // and really does not match the kill command's own argv.
  const pattern = cmds[1].match(/pkill -f '([^']+)'/)[1]
  const re = new RegExp(pattern)
  assert.ok(re.test(`ssh -o BatchMode=yes -o ExitOnForwardFailure=yes ${SANDBOX_SSH_OPTS} -fN -R 8151:127.0.0.1:8151 fleet-r1.exe.xyz`))
  assert.ok(!re.test(`/bin/sh -c ${cmds[1]}`))
}

// destroySandbox without a port (no tunnel was opened): rm only.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '' }
  }
  await destroySandbox({ vmName: 'fleet-r1', exec })
  assert.deepEqual(cmds, ['ssh exe.dev "rm fleet-r1 --json"'])
  assert.ok(!cmds[0].includes('StrictHostKeyChecking') && !cmds[0].includes('UserKnownHostsFile'), `the lobby rm must carry no host-key flags, got: ${cmds[0]}`)
}


// provisionRun with `engineEnv` (#213): the engine's credentials — today the
// Max-subscription `CLAUDE_CODE_OAUTH_TOKEN` — are delivered per run from the
// orchestrator as a sourced env file, never baked into the golden image and
// never placed on a process argv. The file rides the same umask-077 heredoc
// pattern as `fleet-run.json`; the shim is started with it sourced so the
// engine `spawn` inherits it. Without `engineEnv` nothing changes (the
// scenario above still counts 7 execs).
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }
  const token = 'sk-ant-oat01-FAKE-TOKEN-with-$dollar-and-\'quote\''
  await provisionRun({
    golden: 'fleet-golden',
    runId: 'r3',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8153/fleet',
    port: 8153,
    planPath: 'docs/plan.md',
    engineEnv: { CLAUDE_CODE_OAUTH_TOKEN: token },
    exec,
    clock: () => 1000,
  })
  // clone, probe, assignment, ENV FILE, git-init, engine-push, target-push, tunnel, shim-start = 9 (probe passes first time here).
  assert.equal(cmds.length, 9, `expected 9 exec calls with engineEnv, got ${cmds.length}: ${JSON.stringify(cmds)}`)
  const envCmd = cmds[3]
  assert.ok(
    envCmd.startsWith(`ssh ${SANDBOX_SSH_OPTS} fleet-r3.exe.xyz 'umask 077 && cat > /home/exedev/fleet-env'`),
    `cmds[3] should deliver the env file under umask 077, got: ${envCmd}`
  )
  const body = envCmd.match(/<<'FLEET_ENV_EOF'\n([\s\S]*?)\nFLEET_ENV_EOF/)
  assert.ok(body, 'env delivery must embed a FLEET_ENV_EOF heredoc payload')
  // One `KEY='value'` line per entry, single-quoted with embedded quotes
  // escaped, so `.`-sourcing it in sh yields the exact value back.
  assert.equal(body[1], `CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-FAKE-TOKEN-with-$dollar-and-'\\''quote'\\'''`)
  // The shim start checks out fleet-engine, THEN sources the env file (set -a
  // exports every assignment) immediately before `nohup`, and carries NO
  // secret on its own argv.
  const start = cmds[8]
  assert.equal(
    start,
    `ssh -n ${SANDBOX_SSH_OPTS} fleet-r3.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-engine > /home/exedev/shim.log 2>&1 || exit 1; set -a && . /home/exedev/fleet-env && set +a; nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 < /dev/null &'`,
    `shim start must checkout fleet-engine then source the env file, got: ${start}`
  )
  assert.ok(!start.includes('sk-ant-oat01'), 'the token must never appear on the shim-start argv')
  // The store-token assignment is still delivered, unchanged, before the env file.
  assert.ok(cmds[2].includes('fleet-run.json'), `cmds[2] should still be the assignment delivery, got: ${cmds[2]}`)
}

// engineEnv keys are validated: anything that is not a plain env identifier
// is refused before a single command is issued (no way to smuggle shell into
// the sourced file via a key).
{
  const cmds = []
  const exec = async (cmd) => { cmds.push(cmd); return { code: 0, stdout: '{}' } }
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden', runId: 'r4', engineDir: '/tmp/engine', engineSha: 'e'.repeat(40), targetDir: '/tmp/targets/o--r', baseSha: 'b'.repeat(40), ttlMs: 1,
      wsUrl: 'ws://127.0.0.1:8154/fleet', port: 8154, planPath: 'docs/plan.md',
      engineEnv: { 'BAD KEY; rm -rf /': 'x' }, exec, clock: () => 1,
    }),
    /engineEnv/,
  )
  assert.equal(cmds.length, 0, 'an invalid engineEnv key must be refused before any command runs')
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden', runId: 'r5', engineDir: '/tmp/engine', engineSha: 'e'.repeat(40), targetDir: '/tmp/targets/o--r', baseSha: 'b'.repeat(40), ttlMs: 1,
      wsUrl: 'ws://127.0.0.1:8155/fleet', port: 8155, planPath: 'docs/plan.md',
      engineEnv: { OK_KEY: 'line1\nFLEET_ENV_EOF\nrm -rf /' }, exec, clock: () => 1,
    }),
    /engineEnv/,
  )
  assert.equal(cmds.length, 0, 'a multi-line engineEnv value must be refused before any command runs')
}

// provisionRun with sizing knobs: cpu, memory, disk (#216)
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }

  await provisionRun({
    golden: 'fleet-golden',
    runId: 'r6',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 1000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'p.md',
    exec,
    cpu: 4,
    memory: '8GB',
    disk: '30GB',
  })

  assert.ok(
    cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r6 --cpu=4 --memory=8GB --disk=30GB --json"'),
    'sized clone must carry the flags: ' + cmds[0]
  )
}

// sized clone with only cpu and memory, disk omitted
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }

  await provisionRun({
    golden: 'fleet-golden',
    runId: 'r7',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 1000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'p.md',
    exec,
    cpu: 2,
    memory: '16GB',
  })

  assert.ok(
    cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r7 --cpu=2 --memory=16GB --json"'),
    'partial sizing must carry only the provided flags: ' + cmds[0]
  )
}

// unsized clone unchanged (the existing scenario — no sizing knobs)
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd.startsWith('ssh -o BatchMode=yes') && cmd.endsWith(' true')) {
      return { code: 0, stdout: '' }
    }
    return { code: 0, stdout: '{}' }
  }

  await provisionRun({
    golden: 'fleet-golden',
    runId: 'r8',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 1000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'p.md',
    exec,
  })

  assert.ok(
    cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r8 --json"'),
    'unsized clone must not have sizing flags: ' + cmds[0]
  )
}

// provisionRun: bad cpu values are refused before any exec call
for (const bad of [{ cpu: 'four' }, { cpu: 0 }, { cpu: -2 }, { cpu: 3.5 }]) {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }

  await assert.rejects(
    () =>
      provisionRun({
        golden: 'fleet-golden',
        runId: 'r9',
        engineDir: '/tmp/engine',
        engineSha: 'e'.repeat(40),
        targetDir: '/tmp/targets/o--r',
        baseSha: 'b'.repeat(40),
        ttlMs: 1000,
        wsUrl: 'ws://127.0.0.1:8151/fleet',
        port: 8151,
        planPath: 'p.md',
        exec,
        cpu: bad.cpu,
      }),
    /cpu/,
    'invalid cpu must be refused: ' + JSON.stringify(bad)
  )
  assert.equal(cmds.length, 0, 'refusal must happen before any exec call for: ' + JSON.stringify(bad))
}

// provisionRun: bad memory values are refused before any exec call
for (const bad of [{ memory: '8' }, { memory: '8gb; rm -rf /' }, { memory: 'lots' }]) {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }

  await assert.rejects(
    () =>
      provisionRun({
        golden: 'fleet-golden',
        runId: 'r10',
        engineDir: '/tmp/engine',
        engineSha: 'e'.repeat(40),
        targetDir: '/tmp/targets/o--r',
        baseSha: 'b'.repeat(40),
        ttlMs: 1000,
        wsUrl: 'ws://127.0.0.1:8151/fleet',
        port: 8151,
        planPath: 'p.md',
        exec,
        memory: bad.memory,
      }),
    /memory/,
    'invalid memory must be refused: ' + JSON.stringify(bad)
  )
  assert.equal(cmds.length, 0, 'refusal must happen before any exec call for: ' + JSON.stringify(bad))
}

// provisionRun: bad disk values are refused before any exec call
for (const bad of [{ disk: 'lots' }, { disk: '30' }, { disk: '30gb; rm -rf /' }]) {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }

  await assert.rejects(
    () =>
      provisionRun({
        golden: 'fleet-golden',
        runId: 'r11',
        engineDir: '/tmp/engine',
        engineSha: 'e'.repeat(40),
        targetDir: '/tmp/targets/o--r',
        baseSha: 'b'.repeat(40),
        ttlMs: 1000,
        wsUrl: 'ws://127.0.0.1:8151/fleet',
        port: 8151,
        planPath: 'p.md',
        exec,
        disk: bad.disk,
      }),
    /disk/,
    'invalid disk must be refused: ' + JSON.stringify(bad)
  )
  assert.equal(cmds.length, 0, 'refusal must happen before any exec call for: ' + JSON.stringify(bad))
}

// #302: the token record must be registered with the gate BEFORE the shim
// start command is issued. The shim-start ssh returns while the remote node
// process is still booting, so a caller that waits for provisionRun to return
// before registering the record races the sandbox's first ws connect on a
// millisecond margin — measured lost on run-10 (instant 401), and the
// silent-client form of the same loss is the 9-series' zero-write #288.
{
  const events = []
  const exec = async (cmd) => {
    if (/nohup node/.test(cmd)) events.push('shim-start')
    return { code: 0, stdout: '{}' }
  }
  const { record } = await provisionRun({
    golden: 'fleet-golden',
    runId: 'r302',
    engineDir: '/tmp/engine',
    engineSha: 'e'.repeat(40),
    targetDir: '/tmp/targets/o--r',
    baseSha: 'b'.repeat(40),
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:9/fleet',
    planPath: 'p.md',
    exec,
    registerToken: (r) =>
      events.push(`register:${typeof r?.tokenHash === 'string' && r.tokenHash.length === 64 ? 'ok' : 'bad'}`),
  })
  assert.deepEqual(
    events,
    ['register:ok', 'shim-start'],
    `the record must be registered before the shim start, got ${JSON.stringify(events)}`,
  )
  // The same record is still returned — the callback is an ADDITIONAL channel,
  // not a replacement for the return value existing callers read.
  assert.equal(typeof record.tokenHash, 'string')
}

// --- #190: payload validation refuses before any command ---------------------
{
  const base = { golden: 'fleet-golden', runId: 'run-v1', engineDir: '/tmp/engine', engineSha: 'e'.repeat(40), targetDir: '/tmp/targets/o--r', baseSha: 'b'.repeat(40), ttlMs: 60_000, wsUrl: 'ws://127.0.0.1:1/fleet', port: 1, planPath: 'docs/p.md', registerToken: () => {}, clock: () => 0 }
  for (const [field, value, problem] of [
    ['runId', undefined, 'missing'],
    ['planPath', undefined, 'missing'],
    ['planPath', '', 'missing'],
    ['wsUrl', undefined, 'missing'],
    ['ttlMs', undefined, 'missing'],
    ['ttlMs', -5, 'not a positive finite number'],
    // #575: the two shas and the two directories are refused before any exec.
    ['engineSha', 'main', 'fails isSafeSha'],
    ['engineSha', undefined, 'fails isSafeSha'],
    ['baseSha', 'HEAD', 'fails isSafeSha'],
    ['baseSha', 'refs/heads/main', 'fails isSafeSha'],
    ['engineDir', undefined, 'missing'],
    ['targetDir', '', 'missing'],
  ]) {
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '{}' }
    }
    await assert.rejects(
      provisionRun({ ...base, [field]: value, exec }),
      new RegExp(`invalid payload — ${field}`),
      `${field}=${String(value)} must refuse`,
    )
    assert.deepEqual(cmds, [], `${field}=${String(value)} must refuse BEFORE any exec call`)
  }
}

console.log('ALL TESTS PASSED')
