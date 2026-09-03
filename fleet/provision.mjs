/**
 * Provisioner — clone the golden VM, wait for it to come up, deliver a
 * short-TTL store token + run assignment, push the ENGINE and the TARGET as
 * two refs into two clones (#575), start the sandbox-side shim, and tear the
 * sandbox back down when the run is over.
 *
 * Every side effect goes through the injected `exec(cmd)` seam — this module
 * never shells out itself, so it is fully testable without real ssh.
 */
import { mintToken } from './tokens.mjs'
import { isSafeSha } from './shim-main.mjs'

const PROBE_MAX_RETRIES = 60
const PROBE_BACKOFF_MS = 500

/**
 * Every sandbox-bound ssh (and git-over-ssh) command carries these flags.
 * Sandboxes are ephemeral (`fleet-<runId>.exe.xyz`) — a fresh VM is minted per
 * run and never reused, so there is no host key worth pinning, and reusing a
 * runId (or exe.dev recycling a hostname) would otherwise leave a STALE
 * known_hosts entry that makes `accept-new` refuse the new VM's key on every
 * leg — tunnel, push, pull (#211). Lobby-addressed commands (`exe.dev` itself,
 * and the golden `fleet-golden.exe.xyz`) are long-lived and keep the normal
 * host-key config; they never get these flags.
 */
export const SANDBOX_SSH_OPTS = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'
/** The `core.sshCommand` value for a git-over-ssh call to a sandbox. */
export const sandboxGitSsh = `ssh ${SANDBOX_SSH_OPTS}`

/** Where the per-run engine env file lands on the sandbox (#213). */
export const ENGINE_ENV_PATH = '/home/exedev/fleet-env'
const ENGINE_ENV_EOF = 'FLEET_ENV_EOF'
/** The heredoc sentinel the run assignment itself rides. */
const ASSIGNMENT_EOF = 'FLEET_EOF'
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** POSIX single-quote a value: `'` becomes `'\''`. */
const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

/** True for a value that is a `string` with at least one character. */
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

/**
 * Render `engineEnv` as the body of a `.`-sourceable sh file, one
 * `KEY='value'` line per entry. Keys must be plain env identifiers and values
 * must be single-line and must not contain the heredoc sentinel — anything
 * else is refused up front, before a command is issued, so nothing can smuggle
 * shell into the sourced file.
 */
export function engineEnvFileBody(engineEnv) {
  const lines = []
  for (const [key, value] of Object.entries(engineEnv ?? {})) {
    if (!ENV_KEY.test(key)) throw new Error(`provisionRun: engineEnv key ${JSON.stringify(key)} is not a plain env identifier`)
    const text = String(value)
    if (/[\r\n]/.test(text) || text.includes(ENGINE_ENV_EOF)) {
      throw new Error(`provisionRun: engineEnv value for ${key} must be a single line without the heredoc sentinel`)
    }
    lines.push(`${key}=${shQuote(text)}`)
  }
  return lines.join('\n')
}

/**
 * The `plan` slot of the run assignment (#544 step 2): the plan text and its
 * gate verdicts, SHIPPED to the sandbox — the plan is a file the driver
 * reads, never a path in any repository (#575). Returns null for an absent
 * plan — the pre-#544 shape, where the key does not exist at all and the
 * sandbox falls back to `planPath`.
 *
 * `verdicts` normalizes to null when there is no sibling verdict file, so the
 * key is always present and always a string-or-null: a consumer never has to
 * distinguish "absent" from "empty".
 *
 * Both texts ride the FLEET_EOF heredoc, so either one carrying that sentinel
 * would close the heredoc early and hand the remainder to the sandbox's shell.
 * Refused here — the same refusal `engineEnvFileBody` makes for an env value,
 * and made up front, before the first command is issued.
 */
export function assignmentPlan(plan) {
  if (!isNonEmptyString(plan?.text)) return null
  const verdicts = isNonEmptyString(plan.verdicts) ? plan.verdicts : null
  for (const [field, text] of [['text', plan.text], ['verdicts', verdicts]]) {
    if (typeof text === 'string' && text.includes(ASSIGNMENT_EOF)) {
      throw new Error(`provisionRun: plan ${field} must not contain the heredoc sentinel ${ASSIGNMENT_EOF}`)
    }
  }
  return { text: plan.text, verdicts }
}

/** The engine env-file delivery command: same umask-077 heredoc pattern as the assignment. */
export function engineEnvDeliveryCommand({ vmName, engineEnv }) {
  return `ssh ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz 'umask 077 && cat > ${ENGINE_ENV_PATH}' <<'${ENGINE_ENV_EOF}'\n${engineEnvFileBody(engineEnv)}\n${ENGINE_ENV_EOF}`
}

/**
 * The detached shim start. Checks out the pushed `fleet-engine` FIRST, in the
 * ENGINE clone (`/home/exedev/repo`) — the shim itself has to be at the
 * engine commit before it starts, and the golden image's baked-in checkout is
 * stale the moment a new engine is pushed on top of it (#282, #575). The
 * target's `fleet-base` checkout is the shim's own (`invokeEngineRun`), in
 * `/home/exedev/target`, and never happens here. The checkout is `&&`-gated
 * ahead of `nohup`, so a failed checkout (e.g. a dirty tree refusing it)
 * starts nothing rather than silently running the wrong code. Its own output
 * truncates `shim.log` (`>`); the shim then appends (`>>`), so the checkout's
 * failure reason survives in the same file the shim itself logs to.
 *
 * With an env file delivered, it is sourced under `set -a` (immediately
 * before `nohup`) so every assignment is exported to the shim and, through
 * its inherited-env `spawn`, to the engine — the secret is never on an argv.
 */
export function shimStartCommand({ vmName, withEngineEnv = false }) {
  const prefix = withEngineEnv ? `set -a && . ${ENGINE_ENV_PATH} && set +a; ` : ''
  // Detaching the shim from the ssh session took THREE fds and one grammar
  // rule, each measured (#305, #310):
  //   `-n`            local ssh stdin (an open pipe from the caller's exec);
  //   `< /dev/null`   the shim's own stdin;
  //   `; nohup … &`   the load-bearing one — in `A && B &` the `&` binds to
  //                   the WHOLE AND-list, which runs in a backgrounded
  //                   subshell that inherits the session's stdout/stderr
  //                   (per-command redirects don't cover the subshell) and
  //                   waits on node as its foreground child, so sshd holds
  //                   the channel until the shim DIES. run-11 and run-12
  //                   both blocked provisionRun for the shim's whole life
  //                   this way; on the golden, the AND-list shape returns in
  //                   childLifetime+1s, the `;` shape in ~1s. `|| exit 1`
  //                   keeps the failed-checkout gate the `&&` used to carry.
  // The env sourcing stays in the MAIN shell (`;`-joined) so its exports
  // still reach the nohup'd node.
  return `ssh -n ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-engine > /home/exedev/shim.log 2>&1 || exit 1; ${prefix}nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 < /dev/null &'`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Validate and build size flags for sandbox provisioning.
 * @param {object} opts
 * @param {number} [opts.cpu] - number of vCPUs (positive integer)
 * @param {string} [opts.memory] - memory size (must match ^\d+GB$)
 * @param {string} [opts.disk] - disk size (must match ^\d+GB$)
 * @returns {string} space-prefixed flags string, empty string if no sizes given
 */
const sizeFlags = ({ cpu, memory, disk }) => {
  const flags = []
  if (cpu !== undefined) {
    if (!Number.isInteger(cpu) || cpu <= 0) {
      throw new Error(`provisionRun: cpu must be a positive integer, got ${JSON.stringify(cpu)}`)
    }
    flags.push(`--cpu=${cpu}`)
  }
  for (const [name, v] of [['memory', memory], ['disk', disk]]) {
    if (v !== undefined) {
      if (typeof v !== 'string' || !/^\d+GB$/.test(v)) {
        throw new Error(`provisionRun: ${name} must match ^\\d+GB$, got ${JSON.stringify(v)}`)
      }
      flags.push(`--${name}=${v}`)
    }
  }
  return flags.length ? ' ' + flags.join(' ') : ''
}

/**
 * @param {object} opts
 * @param {string} opts.golden - name of the golden VM to clone from.
 * @param {string} opts.runId - the run this sandbox is provisioned for.
 * @param {string} opts.engineDir - the orchestrator's ENGINE checkout, pushed
 *   to the sandbox's `/home/exedev/repo` as `fleet-engine` (#575).
 * @param {string} opts.engineSha - the engine commit to push; a full hex sha
 *   (`isSafeSha`), never a symbolic ref.
 * @param {string} opts.targetDir - the target's cache clone on the
 *   orchestrator (`/home/exedev/targets/<owner>--<repo>`), pushed to the
 *   sandbox's fresh `/home/exedev/target` as `fleet-base`.
 * @param {string} opts.baseSha - the target commit to push as the run's base;
 *   a full hex sha (`isSafeSha`).
 * @param {number} opts.ttlMs - token/lease TTL delivered to the sandbox.
 * @param {string} opts.wsUrl - orchestrator ws URL delivered to the sandbox.
 * @param {number} [opts.port] - the orchestrator's ws port. When given, an SSH
 *   reverse tunnel is opened from the sandbox's 127.0.0.1:<port> back to the
 *   orchestrator's 127.0.0.1:<port> before the shim starts — exe.dev VMs share
 *   no private network and raw VM→VM TCP is blocked, so this is the transport
 *   that makes a loopback `wsUrl` true on both ends (#196).
 * @param {string} opts.planPath - the plan's file name as the sandbox will
 *   know it (the driver ships `path.basename`; the text rides `plan`).
 * @param {Record<string,string>} [opts.engineEnv] - environment the engine
 *   must see (e.g. `CLAUDE_CODE_OAUTH_TOKEN` for Max-subscription auth, #213).
 *   Delivered per run as a sourced env file on the sandbox — never baked into
 *   the golden image, never on a process argv. Omit for none.
 * @param {'fold'|'serialize'} [opts.overlap] - the engine's overlap mode
 *   (#514). Rides the assignment only when set; absent leaves the payload
 *   byte-identical to a pre-#514 one.
 * @param {number} [opts.cpu] - number of vCPUs for the cloned sandbox.
 * @param {string} [opts.memory] - memory size for the cloned sandbox (e.g. '8GB').
 * @param {string} [opts.disk] - disk size for the cloned sandbox (e.g. '30GB').
 * @param {(cmd: string) => Promise<{stdout: string, code: number}>} opts.exec
 * @param {() => number} [opts.clock] - defaults to Date.now.
 * @returns {Promise<{vmName: string, token: string, record: object}>}
 */
export async function provisionRun({ golden, runId, engineDir, engineSha, targetDir, baseSha, ttlMs, wsUrl, port, planPath, plan, engineEnv, overlap, cpu, memory, disk, registerToken, exec, clock = Date.now }) {
  // Validate the payload before the first ssh (#190): `JSON.stringify` silently
  // drops `undefined` fields, so an unvalidated caller mistake does not fail
  // here — it fails two stages later, on the sandbox, with a payload missing
  // the field (a literal `undefined` plan path burns a sandbox; a missing
  // `ttlMs` breaks the lease math). Refuse loudly instead, exactly as
  // `driveOne`'s runId guard does.
  if (!isNonEmptyString(runId)) throw new Error('provisionRun: invalid payload — runId is missing')
  if (!isNonEmptyString(wsUrl)) throw new Error('provisionRun: invalid payload — wsUrl is missing')
  if (!isNonEmptyString(planPath)) throw new Error('provisionRun: invalid payload — planPath is missing')
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) {
    throw new Error('provisionRun: invalid payload — ttlMs is not a positive finite number')
  }
  // #575: two shas, two directories, both interpolated into git command
  // strings below. A symbolic ref here would let two runs claim one commit
  // and resolve it differently; a value that fails the sha grammar is refused
  // before the golden is cloned, exactly as `driveOne` refuses its own inputs.
  if (!isSafeSha(engineSha)) throw new Error(`provisionRun: invalid payload — engineSha ${JSON.stringify(engineSha)} fails isSafeSha`)
  if (!isSafeSha(baseSha)) throw new Error(`provisionRun: invalid payload — baseSha ${JSON.stringify(baseSha)} fails isSafeSha`)
  if (!isNonEmptyString(engineDir)) throw new Error('provisionRun: invalid payload — engineDir is missing')
  if (!isNonEmptyString(targetDir)) throw new Error('provisionRun: invalid payload — targetDir is missing')

  const vmName = `fleet-${runId}`
  const withEngineEnv = Boolean(engineEnv && Object.keys(engineEnv).length > 0)
  // Validate up front: a bad key/value must fail before the golden is cloned.
  const engineEnvCommand = withEngineEnv ? engineEnvDeliveryCommand({ vmName, engineEnv }) : null
  // Validate sizing knobs before any exec call.
  const sizeFlagsStr = sizeFlags({ cpu, memory, disk })
  // Same rule for the shipped plan (#544): a text carrying the heredoc
  // sentinel must cost a refusal here, not a cloned sandbox two steps later.
  const planArtifact = assignmentPlan(plan)

  // 1. Clone the golden VM into a fresh, run-scoped sandbox.
  await exec(`ssh exe.dev "cp ${golden} ${vmName}${sizeFlagsStr} --json"`)

  // 2. Wait for the clone's SSH to come up before touching it further.
  const probeCmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz true`
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
  // 3b. Register it with the caller's gate BEFORE anything on the sandbox can
  //     try to use it (#302). The shim-start ssh below returns while the
  //     remote node process is still booting, so a caller that waits for
  //     provisionRun to return before registering the record races the
  //     sandbox's first ws connect on a millisecond margin — measured lost on
  //     run-10 (instant 401), and the silent-client form of the same loss was
  //     the 9-series' zero-write #288. The record is still returned below;
  //     this callback is the ordering channel, not a replacement.
  if (typeof registerToken === 'function') registerToken(record)

  // 4. Deliver the token + run assignment. The payload rides a heredoc inside
  //    the single exec(cmd) string, since exec has no separate stdin channel.
  // `overlap` (#514) rides only when set: JSON.stringify drops undefined, and
  // an absent key IS the old path — the shim launches the engine with the
  // argv it always did, so old assignments stay byte-identical. `plan` (#544
  // step 2) rides on the same terms: with it the sandbox writes the shipped
  // text and runs THAT; without it, it reads `planPath` out of the pushed
  // base exactly as before. `planPath` stays either way — the receipt and the
  // PR title keep naming the plan. (The `engine` key that used to ride here
  // was set by nothing and read by nothing; #575 deleted it.)
  const payload = {
    runId, token, wsUrl, ttlMs, planPath,
    ...(isNonEmptyString(overlap) ? { overlap } : {}),
    ...(planArtifact ? { plan: planArtifact } : {}),
  }
  await exec(
    `ssh ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json' <<'${ASSIGNMENT_EOF}'\n${JSON.stringify(payload)}\n${ASSIGNMENT_EOF}`
  )

  // 4b. Deliver the engine's env (#213) the same way — a 0600 file the shim
  //     start below sources. Nothing here reads the values; they pass through.
  if (engineEnvCommand) await exec(engineEnvCommand)

  // 5. Two pushes, two clones (#575). The ENGINE — the orchestrator's own
  //    checkout at `engineSha` — lands in the golden's baked clone as
  //    `fleet-engine`: that clone's HEAD is `main`, so a push to another
  //    branch is accepted, exactly as `fleet-base` was before. The TARGET —
  //    the base commit out of its cache clone — lands in a FRESH `git init`
  //    at `/home/exedev/target` as `fleet-base`: an empty repo has no branch
  //    checked out, so the push is accepted there too, and the shim checks it
  //    out itself (`invokeEngineRun`). The sandbox never talks to GitHub; both
  //    pushes ride the orchestrator's ssh key over the sandbox's no-pin
  //    host-key posture. Order matters only for legibility: the init before
  //    the push that needs it, the engine before the tree it will build.
  //    Each result is CHECKED, as the tunnel's is: a rejected engine push
  //    would otherwise leave the shim to check out whatever `fleet-engine`
  //    the golden already carried (the wrong engine, caught only by the #282
  //    stamp after a full run), and a rejected target push leaves it nothing
  //    to check out at all (a drive idling to its claim timeout with no line
  //    naming the push). The caller sets `vmName` before this runs, so a
  //    throw here still reaches teardown and the VM is destroyed.
  const failed = (step, result) =>
    new Error(`provisionRun: ${step} for ${vmName} failed (code ${result?.code}): ${[(result?.stdout ?? '').trim(), (result?.stderr ?? '').trim()].filter(Boolean).join(' ')}`)
  const init = await exec(`ssh ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz 'git init -q /home/exedev/target'`)
  if (init?.code !== 0) throw failed('target git init', init)
  const enginePush = await exec(
    `git -C ${engineDir} -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@${vmName}.exe.xyz/home/exedev/repo ${engineSha}:refs/heads/fleet-engine`
  )
  if (enginePush?.code !== 0) throw failed('engine push (fleet-engine)', enginePush)
  const targetPush = await exec(
    `git -C ${targetDir} -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@${vmName}.exe.xyz/home/exedev/target ${baseSha}:refs/heads/fleet-base`
  )
  if (targetPush?.code !== 0) throw failed('target push (fleet-base)', targetPush)

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
        `provisionRun: reverse tunnel ${port}:127.0.0.1:${port} to ${vmName} failed to open (code ${tunnel?.code}): ${[(tunnel?.stdout ?? '').trim(), (tunnel?.stderr ?? '').trim()].filter(Boolean).join(' ')}`
      )
    }
  }

  // 7. Start the sandbox-side shim, detached — with the engine env sourced
  //    when one was delivered.
  await exec(shimStartCommand({ vmName, withEngineEnv }))

  return { vmName, token, record }
}

/** The reverse-tunnel command, as proven in the live run (#196). */
export function tunnelCommand({ vmName, port }) {
  return `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes ${SANDBOX_SSH_OPTS} -fN -R ${port}:127.0.0.1:${port} ${vmName}.exe.xyz`
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
