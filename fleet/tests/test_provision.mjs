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
// succeeds immediately. Six logical steps, but the failed probe attempt
// means seven total exec calls (clone, probe-fail, probe-ok, delivery,
// push, shim-start = wait, that's 6 — count them below).
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
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

  // Exec call count: clone(1) + probe-fail(1) + probe-ok(1) + delivery(1) + push(1) + tunnel(1) + shim-start(1) = 7.
  assert.equal(cmds.length, 7, `expected 7 exec calls, got ${cmds.length}: ${JSON.stringify(cmds)}`)

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

  // Step 5: base push — via `-c core.sshCommand=` carrying the same flags,
  // since a bare `ssh://` URL gives git no way to pass ssh options.
  assert.ok(
    cmds[4].startsWith(
      `git -C /tmp/repo -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@fleet-r1.exe.xyz/home/exedev/repo refs/heads/main:refs/heads/fleet-base`
    ),
    `cmds[4] should be the base push, got: ${cmds[4]}`
  )
  assert.ok(cmds[4].includes(SANDBOX_SSH_OPTS), `the base push must carry the no-pin host-key flags, got: ${cmds[4]}`)

  // Step 6: the SSH reverse tunnel (#196). exe.dev VMs share no private
  // network, so the sandbox reaches the orchestrator's ws port only through a
  // reverse tunnel mapping sandbox:127.0.0.1:<port> back to the orchestrator's
  // 127.0.0.1:<port> — which is what keeps `wsUrl` true on both ends. It is
  // opened AFTER the reachability probe has passed and BEFORE the shim starts.
  assert.equal(
    cmds[5],
    `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes ${SANDBOX_SSH_OPTS} -fN -R 8151:127.0.0.1:8151 fleet-r1.exe.xyz`,
    `cmds[5] should be the reverse tunnel, got: ${cmds[5]}`
  )

  // Step 7: shim start — last, after the tunnel exists to carry its ws. Checks
  // out `fleet-base` first (#282: the golden's baked-in checkout is stale the
  // moment a new base is pushed), `&&`-gated ahead of `nohup` so a failed
  // checkout starts nothing; its output truncates shim.log, the shim appends.
  assert.equal(
    cmds[6],
    `ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-base > /home/exedev/shim.log 2>&1 && nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 &'`,
    `cmds[6] should be the shim start, got: ${cmds[6]}`
  )
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
      baseRef: 'refs/heads/main',
      repoDir: '/tmp/repo',
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8153/fleet',
    port: 8153,
    planPath: 'docs/plan.md',
    engineEnv: { CLAUDE_CODE_OAUTH_TOKEN: token },
    exec,
    clock: () => 1000,
  })
  // clone, probe, assignment, ENV FILE, push, tunnel, shim-start = 7 (probe passes first time here).
  assert.equal(cmds.length, 7, `expected 7 exec calls with engineEnv, got ${cmds.length}: ${JSON.stringify(cmds)}`)
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
  // The shim start checks out fleet-base, THEN sources the env file (set -a
  // exports every assignment) immediately before `nohup`, and carries NO
  // secret on its own argv.
  const start = cmds[6]
  assert.equal(
    start,
    `ssh ${SANDBOX_SSH_OPTS} fleet-r3.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-base > /home/exedev/shim.log 2>&1 && set -a && . /home/exedev/fleet-env && set +a && nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 &'`,
    `shim start must checkout fleet-base then source the env file, got: ${start}`
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
      golden: 'fleet-golden', runId: 'r4', baseRef: 'refs/heads/main', repoDir: '/tmp/repo', ttlMs: 1,
      wsUrl: 'ws://127.0.0.1:8154/fleet', port: 8154, planPath: 'docs/plan.md',
      engineEnv: { 'BAD KEY; rm -rf /': 'x' }, exec, clock: () => 1,
    }),
    /engineEnv/,
  )
  assert.equal(cmds.length, 0, 'an invalid engineEnv key must be refused before any command runs')
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden', runId: 'r5', baseRef: 'refs/heads/main', repoDir: '/tmp/repo', ttlMs: 1,
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
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
        baseRef: 'refs/heads/main',
        repoDir: '/tmp/repo',
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
        baseRef: 'refs/heads/main',
        repoDir: '/tmp/repo',
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
        baseRef: 'refs/heads/main',
        repoDir: '/tmp/repo',
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
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
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

console.log('ALL TESTS PASSED')
