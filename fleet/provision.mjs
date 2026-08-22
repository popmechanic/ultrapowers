/**
 * Provisioner — clone the golden VM, wait for it to come up, deliver a
 * short-TTL store token + run assignment, push the base ref, start the
 * sandbox-side shim, and tear the sandbox back down when the run is over.
 *
 * Every side effect goes through the injected `exec(cmd)` seam — this module
 * never shells out itself, so it is fully testable without real ssh.
 */
import { mintToken } from './tokens.mjs'

const PROBE_MAX_RETRIES = 60
const PROBE_BACKOFF_MS = 500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {object} opts
 * @param {string} opts.golden - name of the golden VM to clone from.
 * @param {string} opts.runId - the run this sandbox is provisioned for.
 * @param {string} opts.baseRef - git ref to push as the sandbox's build base.
 * @param {string} opts.repoDir - local path to the repo to push from.
 * @param {number} opts.ttlMs - token/lease TTL delivered to the sandbox.
 * @param {string} opts.wsUrl - orchestrator ws URL delivered to the sandbox.
 * @param {number} [opts.port] - the orchestrator's ws port. When given, an SSH
 *   reverse tunnel is opened from the sandbox's 127.0.0.1:<port> back to the
 *   orchestrator's 127.0.0.1:<port> before the shim starts — exe.dev VMs share
 *   no private network and raw VM→VM TCP is blocked, so this is the transport
 *   that makes a loopback `wsUrl` true on both ends (#196).
 * @param {string} opts.planPath - repo-relative path to the plan the sandbox's
 *   engine invocation should run against.
 * @param {(cmd: string) => Promise<{stdout: string, code: number}>} opts.exec
 * @param {() => number} [opts.clock] - defaults to Date.now.
 * @returns {Promise<{vmName: string, token: string, record: object}>}
 */
export async function provisionRun({ golden, runId, baseRef, repoDir, ttlMs, wsUrl, port, planPath, exec, clock = Date.now }) {
  const vmName = `fleet-${runId}`

  // 1. Clone the golden VM into a fresh, run-scoped sandbox.
  await exec(`ssh exe.dev "cp ${golden} ${vmName} --json"`)

  // 2. Wait for the clone's SSH to come up before touching it further.
  const probeCmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${vmName}.exe.xyz true`
  let reachable = false
  for (let attempt = 0; attempt < PROBE_MAX_RETRIES; attempt++) {
    const result = await exec(probeCmd)
    if (result.code === 0) {
      reachable = true
      break
    }
    await sleep(PROBE_BACKOFF_MS)
  }
  if (!reachable) {
    throw new Error(`provisionRun: ${vmName} did not become reachable after ${PROBE_MAX_RETRIES} probes`)
  }

  // 3. Mint the short-TTL store token (pure computation — no command).
  const now = clock()
  const { token, record } = mintToken({ sandboxId: vmName, ttlMs, now })

  // 4. Deliver the token + run assignment. The payload rides a heredoc inside
  //    the single exec(cmd) string, since exec has no separate stdin channel.
  const payload = { runId, token, wsUrl, ttlMs, planPath }
  await exec(
    `ssh ${vmName}.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json' <<'FLEET_EOF'\n${JSON.stringify(payload)}\nFLEET_EOF`
  )

  // 5. Push the base ref the sandbox builds its run from.
  await exec(
    `git -C ${repoDir} push ssh://exedev@${vmName}.exe.xyz/home/exedev/repo ${baseRef}:refs/heads/fleet-base`
  )

  // 6. Open the reverse tunnel the sandbox's ws rides, now that the sandbox is
  //    reachable and before anything on it tries to connect. `-fN` detaches the
  //    tunnel process on the orchestrator; `ExitOnForwardFailure` turns a port
  //    that cannot be bound into a non-zero exit instead of a silent no-op. A
  //    tunnel that does not come up is surfaced here — a run whose tunnel never
  //    opened would otherwise sit at `claimed` until the heartbeat timeout with
  //    nothing to say why.
  if (port !== undefined) {
    const tunnel = await exec(tunnelCommand({ vmName, port }))
    if (tunnel?.code !== 0) {
      throw new Error(
        `provisionRun: reverse tunnel ${port}:127.0.0.1:${port} to ${vmName} failed to open (code ${tunnel?.code}): ${(tunnel?.stdout ?? '').trim()}`
      )
    }
  }

  // 7. Start the sandbox-side shim, detached.
  await exec(`ssh ${vmName}.exe.xyz 'nohup node /home/exedev/repo/fleet/shim-main.mjs > shim.log 2>&1 &'`)

  return { vmName, token, record }
}

/** The reverse-tunnel command, as proven in the live run (#196). */
export function tunnelCommand({ vmName, port }) {
  return `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN -R ${port}:127.0.0.1:${port} ${vmName}.exe.xyz`
}

/**
 * The pattern that kills the detached tunnel process and ONLY it. `[-]R` is a
 * bracket expression that matches the literal `-R` in the tunnel's argv but
 * does not match the literal `[-]R` in the argv of the `sh -c` that carries
 * this very command — a bare `pkill -f "-R <port>…"` matched its own shell and
 * killed the caller in the live run.
 */
export function tunnelKillCommand({ vmName, port }) {
  return `pkill -f '[-]R ${port}:127.0.0.1:${port} ${vmName}.exe.xyz'`
}

/**
 * @param {object} opts
 * @param {string} opts.vmName
 * @param {number} [opts.port] - when given, the detached reverse tunnel for
 *   this vm/port is killed after the VM is removed. The tunnel dies on its own
 *   once its remote endpoint vanishes; this is belt-and-suspenders.
 * @param {(cmd: string) => Promise<{stdout: string, code: number}>} opts.exec
 * @returns {Promise<void>}
 */
export async function destroySandbox({ vmName, port, exec }) {
  // The VM first — its billing clock is what teardown protects.
  await exec(`ssh exe.dev "rm ${vmName} --json"`)
  // pkill exits 1 when nothing matched (the tunnel already died with the VM);
  // that is not a failure of teardown.
  if (port !== undefined) await exec(tunnelKillCommand({ vmName, port }))
}
