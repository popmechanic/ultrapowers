#!/usr/bin/env node
/**
 * fleet/kata-hub.mjs — build the fleet's one kata hub, once.
 *
 *   node fleet/kata-hub.mjs [--dry-run] [--json]
 *
 * The hub is a single persistent VM named `kata-hub` running the kata issue
 * daemon, reachable from every sandbox through one `http-proxy --peer`
 * integration named `kata` and from the laptop over ssh. It is NOT part of a
 * run: it carries no tag, so the janitor's `fleet-r*` glob never lists it, and
 * its comment says so a second time.
 *
 * Three mutating verbs build it, in this order:
 *
 *   new --name kata-hub --cpu 1 --memory 2GB --disk 20GB --comment '…'
 *       --setup-script /dev/stdin --json      (the rendered script on stdin)
 *   share port kata-hub 8000                  (`docs/proxy.md` picks a port
 *                                              heuristically; this pins it)
 *   integrations add http-proxy --name kata --target <https_url> --peer
 *       --bearer - --comment '…' --policy 'tag:fleet'   (bearer on stdin)
 *
 * `<https_url>` is read off the `kata-hub` row of one `ls kata-hub --json`
 * issued directly after the `new`: a team VM's host is not necessarily
 * `<name>.exe.xyz`, so nothing here guesses a host. The same row's `ssh_dest`
 * is where every ssh goes.
 *
 * Nothing secret rides an argv. The bearer is 32 random bytes of hex, minted
 * here, handed to `integrations add` on stdin, written to the hub's own
 * `/etc/kata/kata.env` (root:exedev 0640) on stdin, and kept on the laptop in
 * `~/.ultrapowers/kata-hub.env` at mode 0600. The setup script carries neither
 * it nor the origin — exe.dev stores a rendered setup script as a property of
 * the VM, and the `https_url` does not exist until `new` has answered — so the
 * unit waits, via `ExecStartPre`, for an env file this tool delivers over ssh
 * once the VM's first boot is done.
 *
 * `new` answers long before first boot finishes, hence the bounded wait:
 * `.setup-done`, then the config, then the env and a restart, then
 * `is-active`. Only after the daemon answers `active` does the laptop's env
 * file appear, so the file's existence means the hub works.
 *
 * The build resumes. Every step is skipped when its object already exists, and
 * a `kata` integration in front of a rebuilt VM has its bearer rotated with
 * `integrations edit kata --bearer=-` rather than being added twice.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LobbyError,
  defaultExec,
  listIntegrations,
  lobby,
  output,
  parseArgs,
  parseJson,
  runCli
} from './lobby.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const USAGE = 'usage: node fleet/kata-hub.mjs [--dry-run] [--json]'
export const usage = () => USAGE

/** The hub's VM name, and the integration that fronts it. */
export const HUB_VM = 'kata-hub'
export const HUB_INTEGRATION = 'kata'
/** The port the daemon binds and the one verb that pins it. */
export const HUB_PORT = 8000
/** The policy every fleet integration rides, this one included. */
export const FLEET_POLICY = 'tag:fleet'
/** Two locks against the janitor: no tag at all, and a comment that says why. */
export const HUB_COMMENT = 'kata hub — persistent service, do not reap'
export const INTEGRATION_COMMENT = 'kata issue daemon on kata-hub'

/** The laptop's copy of the hub's address and bearer. */
export const ENV_FILE = ['.ultrapowers', 'kata-hub.env']

/** exe.dev's `--setup-script` cap is 10 KiB; this is the fleet's own budget. */
export const HUB_SETUP_BUDGET_BYTES = 8192
/** The quoted heredoc the unit's bytes ride in, and the line they replace. */
const UNIT_TAG = 'KATA_UNIT_EOF'
const UNIT_PLACEHOLDER = '__KATA_UNIT__'

/** How long between polls, and how long in all, both overridable. */
export const DEFAULT_POLL_SECONDS = 5
export const DEFAULT_WAIT_SECONDS = 600

// ── The setup script ────────────────────────────────────────────────────────

/** The two files this tool carries, as they sit beside this module. */
export function readHubFiles () {
  return {
    template: fs.readFileSync(path.join(HERE, 'kata-hub-setup.sh'), 'utf8'),
    unit: fs.readFileSync(path.join(HERE, 'kata.service'), 'utf8')
  }
}

/**
 * The template with its one `__KATA_UNIT__` line replaced by the unit's bytes.
 *
 * The unit rides a quoted heredoc, so the only thing that can go wrong is the
 * delimiter appearing inside it — say so rather than truncate, exactly as
 * `heredocBody` in `fleet/setup-script.mjs` does. The budget is checked here
 * because a two-byte overrun would otherwise surface at `new`, after the
 * operator has waited for a VM.
 */
export function renderHubSetupScript ({ template, unit }) {
  const lines = String(template ?? '').split('\n')
  const at = lines.indexOf(UNIT_PLACEHOLDER)
  if (at === -1) {
    throw new Error(`the hub setup template carries no ${UNIT_PLACEHOLDER} line`)
  }
  const body = String(unit ?? '')
  if (body.split('\n').includes(UNIT_TAG)) {
    throw new Error(`the unit carries the heredoc delimiter ${UNIT_TAG} on a line of its own`)
  }
  lines.splice(at, 1, ...body.replace(/\n$/, '').split('\n'))
  const script = lines.join('\n')
  const bytes = Buffer.byteLength(script, 'utf8')
  if (bytes > HUB_SETUP_BUDGET_BYTES) {
    throw new Error(`hub setup script is ${bytes} bytes; the fleet's budget is ${HUB_SETUP_BUDGET_BYTES}`)
  }
  return script
}

// ── The three verbs, as strings ─────────────────────────────────────────────

export const newVerb = () =>
  `new --name ${HUB_VM} --cpu 1 --memory 2GB --disk 20GB ` +
  `--comment '${HUB_COMMENT}' --setup-script /dev/stdin --json`

export const sharePortVerb = () => `share port ${HUB_VM} ${HUB_PORT}`

export const addVerb = (httpsUrl) =>
  `integrations add http-proxy --name ${HUB_INTEGRATION} --target ${httpsUrl} --peer ` +
  `--bearer - --comment '${INTEGRATION_COMMENT}' --policy '${FLEET_POLICY}'`

export const editVerb = () => `integrations edit ${HUB_INTEGRATION} --bearer=-`

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The `kata-hub` row of `ls kata-hub --json`, or null.
 *
 * `listVms` in `fleet/lobby.mjs` maps a row to name/sshDest/sshHost/status/
 * comment/tags and drops `https_url`, which is the one field this tool cannot
 * do without — so the raw payload is read here instead of widening a helper
 * three other CLIs share.
 */
export async function readHubRow (exec) {
  const res = await lobby(exec, `ls ${HUB_VM} --json`)
  const payload = parseJson(res.stdout)
  const rows = Array.isArray(payload?.vms) ? payload.vms : []
  const row = rows.find((entry) => entry?.vm_name === HUB_VM)
  if (!row) return null
  return {
    name: row.vm_name,
    httpsUrl: typeof row.https_url === 'string' ? row.https_url : null,
    sshDest: typeof row.ssh_dest === 'string' ? row.ssh_dest : null,
    status: typeof row.status === 'string' ? row.status : null
  }
}

// ── One command on the hub ──────────────────────────────────────────────────

/**
 * `BatchMode` refuses to ask for a password and `ConnectTimeout` bounds a dark
 * VM at fifteen seconds — the same shape the janitor's `onVm` uses. `input`,
 * when given, is the only way a secret reaches the hub.
 */
const onVm = (exec, dest, command, options) => {
  const argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', dest, command]
  return options === undefined ? exec('ssh', argv) : exec('ssh', argv, options)
}

export const DONE_FLAG = '/var/lib/kata/.setup-done'

export const configCommand = () =>
  'sudo -n tee /var/lib/kata/config.toml >/dev/null && ' +
  'sudo -n chown exedev:exedev /var/lib/kata/config.toml && ' +
  'sudo -n chmod 0644 /var/lib/kata/config.toml'

export const envCommand = () =>
  'sudo -n install -d -m 0755 /etc/kata && ' +
  'sudo -n tee /etc/kata/kata.env >/dev/null && ' +
  'sudo -n chown root:exedev /etc/kata/kata.env && ' +
  'sudo -n chmod 0640 /etc/kata/kata.env && ' +
  'sudo -n systemctl restart kata.service'

/** What the daemon validates the request `Host` against. */
export const configText = (httpsUrl) => `[web]\npublic_origin = "${httpsUrl}"\n`

/** What the unit sources. `PORT` is what makes the daemon bind 0.0.0.0. */
export const envText = (bearer) =>
  `KATA_AUTH_TOKEN=${bearer}\nKATA_TRUST_PRIVATE_NETWORK=1\nKATA_HOME=/var/lib/kata\nPORT=${HUB_PORT}\n`

// ── The bounded wait ────────────────────────────────────────────────────────

/**
 * Poll `attempt` until it answers done, sleeping `poll` seconds between tries
 * and spending from a budget shared by every wait in one build. An exhausted
 * budget is a `LobbyError` naming the hub and the last answer seen — the last
 * answer is the whole diagnosis, so it is carried verbatim.
 */
async function waitFor (attempt, { sleep, poll, budget, what }) {
  let last = ''
  for (;;) {
    const seen = await attempt()
    if (seen.done) return
    last = seen.answer
    if (budget.spent + poll > budget.total) break
    await sleep(poll)
    budget.spent += poll
  }
  throw new LobbyError(
    `${HUB_VM} is not ready after ${budget.total}s: ${what} last answered "${last}"`
  )
}

const answerOf = (res) => {
  const text = output(res)
  return text === '' ? `exit ${res.code}` : text
}

// ── The build ───────────────────────────────────────────────────────────────

const defaultSleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

/**
 * 32 random bytes as lower-case hex. `rand` is the seam a sim replaces, so a
 * substitute answering hex already is taken at its word rather than encoded
 * twice.
 */
export function mintBearer (rand) {
  const minted = rand(32)
  if (typeof minted === 'string') {
    return /^[0-9a-f]{64}$/.test(minted) ? minted : Buffer.from(minted, 'utf8').toString('hex')
  }
  return Buffer.from(minted).toString('hex')
}

const positive = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Build the hub, or resume a half-built one, and answer what was done.
 *
 * The reads come first, because what is already there decides every verb
 * below; the bearer is minted before the first mutation, because a rebuilt VM
 * needs a fresh one at the edge whether the integration is added or edited.
 */
export async function kataHub ({
  argv = [],
  exec = defaultExec,
  rand = randomBytes,
  sleep = defaultSleep,
  home = os.homedir(),
  env = process.env,
  files = null
} = {}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json'] })
  const dryRun = opts['dry-run'] === true
  const json = opts.json === true
  // The usage is the answer to `--help`, and it is plain text whatever else
  // was asked for.
  if (opts.help === true) return reported({ help: true, json: false })
  const poll = positive(env.KATA_HUB_POLL_SECONDS, DEFAULT_POLL_SECONDS)
  const budget = { spent: 0, total: positive(env.KATA_HUB_WAIT_SECONDS, DEFAULT_WAIT_SECONDS) }
  const envPath = path.join(home, ...ENV_FILE)

  const integrations = await listIntegrations(exec)
  const listed = integrations.some((entry) => entry.name === HUB_INTEGRATION)
  let row = await readHubRow(exec)

  if (dryRun) {
    return reported({
      dryRun: true,
      json,
      verbs: [newVerb(), sharePortVerb(), addVerb(row?.httpsUrl ?? '<https_url>')]
    })
  }
  if (listed && row && fs.existsSync(envPath)) {
    return reported({ alreadyBuilt: true, json, vm: HUB_VM, url: row.httpsUrl })
  }

  const bearer = mintBearer(rand)
  // A `kata` in the listing with no VM behind it is a hub that was rebuilt:
  // the edge still injects the bearer the old daemon held, so it is rotated.
  const rebuilt = listed && !row

  if (!row) {
    const { template, unit } = files ?? readHubFiles()
    await lobby(exec, newVerb(), { input: renderHubSetupScript({ template, unit }) })
    row = await readHubRow(exec)
    if (!row) throw new LobbyError(`exe.dev new answered, but no ${HUB_VM} row followed it`)
    await lobby(exec, sharePortVerb())
  }
  if (!row.httpsUrl) throw new LobbyError(`the ${HUB_VM} row carries no https_url`)
  if (!row.sshDest) throw new LobbyError(`the ${HUB_VM} row carries no ssh_dest`)

  if (!listed) await lobby(exec, addVerb(row.httpsUrl), { input: bearer })
  else if (rebuilt) await lobby(exec, editVerb(), { input: bearer })

  // First boot: the setup script's last act before it deletes itself.
  await waitFor(async () => {
    const res = await onVm(exec, row.sshDest, `test -f ${DONE_FLAG}`)
    return { done: res.code === 0, answer: answerOf(res) }
  }, { sleep, poll, budget, what: `test -f ${DONE_FLAG}` })

  // The origin first — the daemon reads it at start — then the bearer and the
  // restart that picks both up.
  const config = await onVm(exec, row.sshDest, configCommand(), { input: configText(row.httpsUrl) })
  if (config.code !== 0) throw new LobbyError(`${HUB_VM}: writing config.toml failed:\n${output(config)}`)
  const delivered = await onVm(exec, row.sshDest, envCommand(), { input: envText(bearer) })
  if (delivered.code !== 0) throw new LobbyError(`${HUB_VM}: writing kata.env failed:\n${output(delivered)}`)

  await waitFor(async () => {
    const res = await onVm(exec, row.sshDest, 'systemctl is-active kata.service')
    return { done: String(res.stdout ?? '').trim() === 'active', answer: answerOf(res) }
  }, { sleep, poll, budget, what: 'systemctl is-active kata.service' })

  // Last: the file whose existence means the hub answers.
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, `KATA_URL=${row.httpsUrl}\nKATA_TOKEN=${bearer}\n`, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)

  return reported({
    built: true,
    json,
    vm: HUB_VM,
    url: row.httpsUrl,
    envFile: envPath,
    integration: HUB_INTEGRATION
  })
}

export const renderKataHub = (result) => {
  if (result.help) return USAGE
  if (result.dryRun) return result.verbs.join('\n')
  if (result.alreadyBuilt) return `${HUB_VM} already built`
  return `${HUB_VM} is up at ${result.url} — ${result.integration} at the edge, ${result.envFile} on the laptop`
}

/**
 * Every answer carries the line the operator reads, so what the tool has to
 * say survives the trip back to `main` — one place decides the wording, and a
 * caller holding the result holds the report too.
 */
const reported = (result) => ({ ...result, report: renderKataHub(result) })

async function main (argv) {
  const result = await kataHub({ argv })
  process.stdout.write(result.json ? `${JSON.stringify(result)}\n` : `${result.report}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
