/**
 * Exam for `fleet/kata-hub.mjs`, `fleet/kata-hub-setup.sh` and
 * `fleet/kata.service` — "an operator runs one command and has a kata hub".
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from:
 *
 *   1  M2 / leg (b) — `renderHubSetupScript({ template, unit })`: the 8192-byte
 *      ceiling, `bash -n`, no token / no `KATA_AUTH_TOKEN` / `ANTHROPIC` /
 *      `public_origin` line, and the nine literals, one assertion each.
 *   2  M2 / leg (c) — the unit's bytes verbatim inside the quoted heredoc, the
 *      unit's own six literals and its absent `Environment=` line, and the two
 *      renders that must throw.
 *   3  M1 / leg (a) — a fresh build: exactly three mutating lobby verbs in
 *      order, the two lobby reads and no others, the rendered script on the
 *      `new`'s stdin, the bearer on the `integrations add`'s stdin and in no
 *      argv, and every VM ssh at the row's own `ssh_dest`.
 *   4  M3 / leg (d) — the bounded wait and the two deliveries, in order, with
 *      their exact stdin texts, the `sleep` spy's two `5`s, and the env file
 *      written 0600 with its two lines only after the last `is-active`.
 *   5  M4 / leg (e) — already built, the two partial builds (including the
 *      bearer rotation behind a rebuilt VM), and `--dry-run`.
 *   6  M5 / leg (f) — a `new` that fails, and a wait that exhausts
 *      `KATA_HUB_WAIT_SECONDS`.
 *
 * Nothing here opens a socket: every exe.dev verb and every VM command is
 * answered by `fleet/tests/_lobby_helpers.mjs`'s recording seam, the one child
 * process is `bash -n` over a rendered script in a temp directory under
 * `simEnv`, and the env file the tool writes lands under a per-case `home`.
 *
 * Two readings this file fixes, because the task's words admit one shape each:
 *
 *   - "no `ssh`" in M4 and M5 is read as no command on a VM (`ssh <ssh_dest> …`):
 *     the two lobby reads are `ssh exe.dev …` calls and M4 still lets a resume
 *     read the listing and the row.
 *   - what the tool "prints" is read as what it wrote to stdout during the call
 *     plus its own return value, so a report carried back to `main` counts.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from '../../_helpers.mjs'
import { answer, makeExec, sshRule, vmRule, vmsPayload } from '../../_lobby_helpers.mjs'
import { LobbyError } from '../../../lobby.mjs'
import * as hubModule from '../../../kata-hub.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.resolve(HERE, '..', '..', '..')
const TEMPLATE_FILE = path.join(FLEET, 'kata-hub-setup.sh')
const UNIT_FILE = path.join(FLEET, 'kata.service')
const HUB_MODULE = new URL('../../../kata-hub.mjs', import.meta.url)

const ROOT = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kata-hub-exam-'))

// ── the module's two entry points ────────────────────────────────────────────

/** The file-named main, as `fleet/target.mjs` exports `target()`. */
const kataHub = hubModule.kataHub ?? hubModule.default
assert.equal(
  typeof kataHub,
  'function',
  '0 fleet/kata-hub.mjs exports kataHub({ argv, exec, rand, sleep, home }) — the file-named main, as target.mjs exports target()'
)

const { renderHubSetupScript } = hubModule
assert.equal(
  typeof renderHubSetupScript,
  'function',
  '0 [Produces] fleet/kata-hub.mjs exports renderHubSetupScript({ template, unit }) -> string'
)

// ── the contract's literals ──────────────────────────────────────────────────

/** M1 leg (a): the `ls kata-hub --json` row the fixture answers after the `new`. */
const HTTPS_URL = 'https://kata-hub.example.exe.xyz'
const SSH_DEST = 'exedev@h1'
const KATA_ROW = { vm_name: 'kata-hub', status: 'running', https_url: HTTPS_URL, ssh_dest: SSH_DEST }

/** M1: the three mutating lobby verbs, verbatim. */
const NEW_VERB =
  "new --name kata-hub --cpu 1 --memory 2GB --disk 20GB " +
  "--comment 'kata hub — persistent service, do not reap' --setup-script /dev/stdin --json"
const SHARE_VERB = 'share port kata-hub 8000'
const ADD_VERB =
  `integrations add http-proxy --name kata --target ${HTTPS_URL} --peer --bearer - ` +
  "--comment 'kata issue daemon on kata-hub' --policy 'tag:fleet'"
/** M4: the rotation a rebuilt hub behind an existing integration gets instead. */
const EDIT_VERB = 'integrations edit kata --bearer=-'

/** M1: the only two lobby reads the tool may issue. */
const LIST_READ = 'integrations list --json'
const LS_READ = 'ls kata-hub --json'

/** M3: the two deliveries, verbatim, and the two polls. */
const DONE_POLL = 'test -f /var/lib/kata/.setup-done'
const ACTIVE_POLL = 'systemctl is-active kata.service'
const CONFIG_DELIVERY =
  'sudo -n tee /var/lib/kata/config.toml >/dev/null && ' +
  'sudo -n chown exedev:exedev /var/lib/kata/config.toml && ' +
  'sudo -n chmod 0644 /var/lib/kata/config.toml'
const ENV_DELIVERY =
  'sudo -n install -d -m 0755 /etc/kata && ' +
  'sudo -n tee /etc/kata/kata.env >/dev/null && ' +
  'sudo -n chown root:exedev /etc/kata/kata.env && ' +
  'sudo -n chmod 0640 /etc/kata/kata.env && ' +
  'sudo -n systemctl restart kata.service'
const CONFIG_TEXT = `[web]\npublic_origin = "${HTTPS_URL}"\n`

/** M1: the bearer is 32 random bytes from the injectable `rand`, in lower-case
 *  hex. The fixture's bytes are 0x01…0x20, so the token is a fixed 64 hex
 *  characters this exam can look for in an argv. */
const TOKEN_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1))
const TOKEN = TOKEN_BYTES.toString('hex')

const envText = (token) =>
  `KATA_AUTH_TOKEN=${token}\nKATA_TRUST_PRIVATE_NETWORK=1\nKATA_HOME=/var/lib/kata\nPORT=8000\n`
const hubEnvText = (token) => `KATA_URL=${HTTPS_URL}\nKATA_TOKEN=${token}\n`

/** M2: the nine literals the rendered setup script carries. */
const SCRIPT_LITERALS = [
  'KATA_VERSION=0.17.2',
  'kata_0.17.2_linux_amd64.tar.gz',
  'https://github.com/kenn-io/kata/releases/download/v0.17.2/',
  'SHA256SUMS',
  'sha256sum -c',
  '/usr/local/bin/kata',
  '/etc/systemd/system/kata.service',
  'systemctl enable --now kata.service',
  '/var/lib/kata/.setup-done'
]

/** M2: what no line of the rendered script may name. The origin is not known
 *  until the VM exists, so it rides the env file and never the script. */
const SCRIPT_FORBIDDEN = ['KATA_AUTH_TOKEN', 'ANTHROPIC', 'public_origin']

/** M2: the unit's six literals. */
const UNIT_LITERALS = [
  'User=exedev',
  'EnvironmentFile=-/etc/kata/kata.env',
  'ExecStartPre=/usr/bin/test -f /etc/kata/kata.env',
  'ExecStart=/usr/local/bin/kata daemon start --foreground',
  'Restart=on-failure',
  'WantedBy=multi-user.target'
]

const UNIT_TAG = 'KATA_UNIT_EOF'
const UNIT_PLACEHOLDER = '__KATA_UNIT__'
const SETUP_SCRIPT_CEILING = 8192

// ── reading the seam ─────────────────────────────────────────────────────────

/**
 * The mutating lobby verbs, as M1 counts them. `_lobby_helpers.mjs`'s own
 * `exec.mutating()` does not count `share port` (its regex predates this verb,
 * and that file is outside this task's Files), so the count M1 asks for is
 * taken here: this predicate is a superset of the helper's.
 */
const MUTATING = /^(?:new|share|cp|rm|comment|rename|tag) |^integrations (?:add|attach|detach|edit|policy set) /
const mutating = (exec) => exec.lobby().filter((line) => MUTATING.test(line))
const reads = (exec) => exec.lobby().filter((line) => !MUTATING.test(line))

/** Every `ssh <ssh_dest> …` — a command on a VM — with its stdin. The `-o`
 *  pairs are stripped, so the destination is read where M1 puts it. */
const vmCalls = (exec) => exec.calls
  .filter((c) => c.cmd === 'ssh' && c.argv[0] !== 'exe.dev')
  .map((c) => {
    const rest = []
    for (let i = 0; i < c.argv.length; i += 1) {
      if (c.argv[i] === '-o') { i += 1; continue }
      rest.push(c.argv[i])
    }
    return { dest: rest[0], command: rest.slice(1).join(' ').trim(), input: c.options?.input }
  })

const lobbyCall = (exec, remote) => exec.calls.find((c) => c.cmd === 'ssh' && c.argv[0] === 'exe.dev' && c.argv[1] === remote)

/** What the tool said: stdout written during the call, plus its own answer. */
const said = ({ out, result }) =>
  `${out}\n${typeof result === 'string' ? result : JSON.stringify(result ?? null)}`

async function capture (body) {
  const chunks = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true }
  let result
  let error = null
  try {
    result = await body()
  } catch (caught) {
    error = caught
  } finally {
    process.stdout.write = original
  }
  return { result, error, out: chunks.join('') }
}

// ── the fixture ──────────────────────────────────────────────────────────────

let caseNumber = 0

/**
 * One build, against a canned lobby and a canned VM.
 *
 *   `integrations`  what `integrations list --json` answers
 *   `rowsBefore`    what `ls kata-hub --json` answers before the `new`
 *   `rowsAfter`     what it answers after it
 *   `newAnswer`     the `new` verb's answer
 *   `setupDone`     the exit codes `test -f …/.setup-done` answers, in order
 *   `isActive`      the stdouts `systemctl is-active` answers, in order; the
 *                   last one repeats forever
 *   `envFile`       text to pre-write at `<home>/.ultrapowers/kata-hub.env`
 */
function makeCase ({
  integrations = [],
  rowsBefore = [],
  rowsAfter = [KATA_ROW],
  newAnswer = answer('{}'),
  setupDone = [1, 0],
  isActive = ['activating', 'active'],
  envFile = null
} = {}) {
  caseNumber += 1
  const home = fs.mkdtempSync(path.join(ROOT, `home-${caseNumber}-`))
  const envPath = path.join(home, '.ultrapowers', 'kata-hub.env')
  if (envFile !== null) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true })
    fs.writeFileSync(envPath, envFile)
  }

  let created = false
  const doneQueue = [...setupDone]
  const activeQueue = [...isActive]

  const onVm = (cmd, argv) => {
    const command = String(argv[argv.length - 1] ?? '')
    if (command.includes('/var/lib/kata/.setup-done') && command.includes('test ')) {
      const code = doneQueue.length > 1 ? doneQueue.shift() : (doneQueue[0] ?? 0)
      return answer('', { code })
    }
    if (command.includes('tee /var/lib/kata/config.toml')) return answer('')
    if (command.includes('tee /etc/kata/kata.env')) return answer('')
    if (command.includes('is-active')) {
      const text = activeQueue.length > 1 ? activeQueue.shift() : (activeQueue[0] ?? 'active')
      return answer(`${text}\n`)
    }
    return answer(`no rule for a VM command: ${command}\n`, { code: 127 })
  }

  const exec = makeExec({
    passthrough: [],
    rules: [
      sshRule(LIST_READ, answer(integrations)),
      sshRule('ls kata-hub', () => vmsPayload(created ? rowsAfter : rowsBefore)),
      sshRule('new ', () => { created = true; return newAnswer }),
      sshRule('share port ', answer('')),
      sshRule('integrations add ', answer('{}')),
      sshRule('integrations edit ', answer('')),
      vmRule(onVm)
    ]
  })

  // Was the env file already on disk when each command ran? M3 writes it only
  // after the last `is-active`, so every one of these must be false.
  const existedAtCall = []
  const spy = (cmd, argv, options) => {
    existedAtCall.push(fs.existsSync(envPath))
    return exec(cmd, argv, options)
  }
  spy.calls = exec.calls
  spy.lobby = exec.lobby
  spy.vm = exec.vm
  spy.mutating = exec.mutating

  const randCalls = []
  const rand = (n) => { randCalls.push(n); return Buffer.from(TOKEN_BYTES) }

  const sleeps = []
  const sleep = async (seconds) => {
    sleeps.push(seconds)
    if (sleeps.length > 50) {
      throw new Error('sleep was called 50 times: the wait is not bounded by KATA_HUB_WAIT_SECONDS')
    }
  }

  return { home, envPath, exec: spy, rand, randCalls, sleep, sleeps, existedAtCall }
}

const build = async (fixture, argv = [], main = kataHub) =>
  capture(() => main({ argv, exec: fixture.exec, rand: fixture.rand, sleep: fixture.sleep, home: fixture.home }))

// ── 1. M2 / leg (b) — the rendered setup script ──────────────────────────────

const TEMPLATE = fs.readFileSync(TEMPLATE_FILE, 'utf8')
const UNIT = fs.readFileSync(UNIT_FILE, 'utf8')
const SCRIPT = renderHubSetupScript({ template: TEMPLATE, unit: UNIT })

{
  assert.equal(typeof SCRIPT, 'string', '1 [M2 leg b] renderHubSetupScript answers a string')

  // The ceiling: exe.dev's `--setup-script` cap is 10 KiB and a two-byte
  // overrun would surface only at `new`.
  assert.ok(
    Buffer.byteLength(SCRIPT) <= SETUP_SCRIPT_CEILING,
    `1 [M2 leg b] the rendered script is at most ${SETUP_SCRIPT_CEILING} bytes; got ${Buffer.byteLength(SCRIPT)}`
  )

  const file = path.join(ROOT, 'rendered-setup.sh')
  fs.writeFileSync(file, SCRIPT)
  const syntax = spawnSync('bash', ['-n', file], { encoding: 'utf8', env: simEnv() })
  assert.equal(syntax.status, 0, `1 [M2 leg b] the rendered script passes bash -n; got ${syntax.stderr}`)

  // The template itself is a bash script before anything is substituted into it.
  const raw = path.join(ROOT, 'template-setup.sh')
  fs.writeFileSync(raw, TEMPLATE)
  const rawSyntax = spawnSync('bash', ['-n', raw], { encoding: 'utf8', env: simEnv() })
  assert.equal(
    rawSyntax.status, 0,
    `1 [M2 leg b] fleet/kata-hub-setup.sh passes bash -n unrendered; got ${rawSyntax.stderr}`
  )

  const lines = SCRIPT.split('\n')
  for (const needle of SCRIPT_FORBIDDEN) {
    const carrying = lines.filter((line) => line.includes(needle))
    assert.deepEqual(
      carrying, [],
      `1 [M2 leg b] no line of the rendered script names ${needle}; got ${JSON.stringify(carrying)}`
    )
  }

  // No token: the script is stored as a VM property server-side, so nothing
  // that could be a bearer may be in it.
  assert.equal(
    /[0-9a-f]{32,}/.test(SCRIPT), false,
    '1 [M2 leg b] the rendered script carries no hex string long enough to be a token'
  )
  assert.equal(SCRIPT.includes(TOKEN), false, '1 [M2 leg b] the rendered script carries no bearer')

  // The nine literals, one assertion each.
  for (const literal of SCRIPT_LITERALS) {
    assert.ok(
      SCRIPT.includes(literal),
      `1 [M2 leg b] the rendered script carries ${JSON.stringify(literal)}`
    )
  }
}

// ── 2. M2 / leg (c) — the unit, carried verbatim, and the two refusals ───────

{
  // The unit's bytes sit verbatim between the quoted heredoc's two delimiters.
  const lines = SCRIPT.split('\n')
  const open = lines.findIndex((line) => line.includes(`<<'${UNIT_TAG}'`))
  assert.notEqual(open, -1, `2 [M2 leg c] the rendered script opens a quoted heredoc <<'${UNIT_TAG}'`)
  const close = lines.indexOf(UNIT_TAG, open + 1)
  assert.notEqual(close, -1, `2 [M2 leg c] the heredoc is closed by a ${UNIT_TAG} line of its own`)
  const body = `${lines.slice(open + 1, close).join('\n')}\n`
  const want = UNIT.endsWith('\n') ? UNIT : `${UNIT}\n`
  assert.equal(body, want, "2 [M2 leg c] the unit's bytes are inside the heredoc verbatim")

  // The unit's own six literals, one assertion each, and no `Environment=`:
  // the env file is delivered over ssh, never baked into the unit.
  for (const literal of UNIT_LITERALS) {
    assert.ok(UNIT.includes(literal), `2 [M2] fleet/kata.service carries ${JSON.stringify(literal)}`)
  }
  const envLines = UNIT.split('\n').filter((line) => line.startsWith('Environment='))
  assert.deepEqual(envLines, [], `2 [M2] no line of fleet/kata.service begins Environment=; got ${JSON.stringify(envLines)}`)

  // The template carries the one placeholder line the renderer replaces…
  const placeholder = TEMPLATE.split('\n').filter((line) => line.trim() === UNIT_PLACEHOLDER)
  assert.equal(
    placeholder.length, 1,
    `2 [M2 leg c] fleet/kata-hub-setup.sh carries one ${UNIT_PLACEHOLDER} line; got ${placeholder.length}`
  )

  // …and a template without it, or a unit carrying the delimiter on a line of
  // its own, is a throw rather than a silent truncation.
  const stripped = TEMPLATE.split('\n').filter((line) => line.trim() !== UNIT_PLACEHOLDER).join('\n')
  assert.throws(
    () => renderHubSetupScript({ template: stripped, unit: UNIT }),
    `2 [M2 leg c] a template with no ${UNIT_PLACEHOLDER} line throws`
  )
  assert.throws(
    () => renderHubSetupScript({ template: TEMPLATE, unit: `${want}${UNIT_TAG}\n` }),
    `2 [M2 leg c] a unit carrying ${UNIT_TAG} on a line of its own throws`
  )
}

// ── 3. M1 / leg (a) — a fresh build ─────────────────────────────────────────

const green = makeCase()
const greenRun = await build(green)

{
  assert.equal(greenRun.error, null, `3 [M1 leg a] a green build does not fail; got ${greenRun.error?.message}`)

  // The three mutating verbs, in order, with the target read off the row.
  assert.deepEqual(
    mutating(green.exec), [NEW_VERB, SHARE_VERB, ADD_VERB],
    '3 [M1 leg a] exactly three mutating lobby verbs, in M1\'s order, with --target the row\'s https_url'
  )

  // The whole lobby conversation: the `ls` read sits between the `new` and the
  // `share port`, and the non-mutating calls are those two reads and no others.
  assert.deepEqual(
    green.exec.lobby(), [LIST_READ, LS_READ, NEW_VERB, LS_READ, SHARE_VERB, ADD_VERB],
    '3 [M1 leg a] the ls read sits directly after the new and before the share port'
  )
  assert.deepEqual(
    reads(green.exec), [LIST_READ, LS_READ, LS_READ],
    '3 [M1 leg a] the lobby reads are one integrations list --json and two ls kata-hub --json, and nothing else'
  )

  // The `new` carries the size and no tag: the janitor's `fleet-r*` glob never
  // lists the hub, and the comment is the second lock.
  const newCall = lobbyCall(green.exec, NEW_VERB)
  assert.ok(newCall, '3 [M1 leg a] the new verb was issued through lobby()')
  assert.ok(NEW_VERB.includes('--cpu 1 --memory 2GB --disk 20GB'), '3 [M1 leg a] the new is 1 vCPU / 2GB / 20GB')
  assert.equal(NEW_VERB.includes('--tag'), false, '3 [M1 leg a] no --tag anywhere in the new')
  for (const line of green.exec.lobby()) {
    assert.equal(line.includes('--tag'), false, `3 [M1 leg a] no lobby verb tags the hub; got ${line}`)
  }

  // The rendered script rides the `new`'s stdin, never an argv.
  assert.equal(newCall.options?.input, SCRIPT, "3 [M1 leg a] the rendered setup script is on the new's stdin")

  // The bearer rides the `integrations add`'s stdin, is 32 bytes of lower-case
  // hex from the injectable `rand`, and is in no argv of any call.
  const addCall = lobbyCall(green.exec, ADD_VERB)
  assert.ok(addCall, '3 [M1 leg a] the integrations add verb was issued through lobby()')
  assert.equal(addCall.options?.input, TOKEN, "3 [M1 leg a] the bearer is on the integrations add's stdin")
  assert.match(String(addCall.options?.input), /^[0-9a-f]{64}$/, '3 [M1] the bearer is 32 random bytes in lower-case hex')
  assert.equal(green.randCalls.length, 1, '3 [M1] the bearer is minted once, from the injectable rand')
  for (const asked of green.randCalls) {
    if (asked !== undefined) assert.equal(asked, 32, `3 [M1] rand is asked for 32 bytes; got ${asked}`)
  }
  assert.equal(
    JSON.stringify(green.exec.calls.map((c) => c.argv)).includes(TOKEN), false,
    '3 [M1 leg a] the bearer appears in the argv of no call the tool makes'
  )

  // Every command the tool runs is an ssh, and every VM ssh goes to the row's
  // own ssh_dest — never a host guessed from the name.
  for (const call of green.exec.calls) {
    assert.equal(call.cmd, 'ssh', `3 [M1 leg a] the tool runs ssh and nothing else; got ${call.cmd}`)
  }
  const vm = vmCalls(green.exec)
  assert.ok(vm.length > 0, '3 [M1 leg a] the tool talks to the VM')
  for (const call of vm) {
    assert.equal(call.dest, SSH_DEST, `3 [M1 leg a] every VM ssh goes to the row's ssh_dest; got ${call.dest}`)
  }
}

// ── 4. M3 / leg (d) — the bounded wait, the two deliveries, the env file ─────

{
  const vm = vmCalls(green.exec)
  assert.deepEqual(
    vm.map((c) => c.command),
    [DONE_POLL, DONE_POLL, CONFIG_DELIVERY, ENV_DELIVERY, ACTIVE_POLL, ACTIVE_POLL],
    '4 [M3 leg d] the VM commands in order: the two .setup-done polls, the config, the env, the two is-active polls'
  )

  // The leg's own containment checks, so a reader sees which half each command is.
  assert.ok(vm[2].command.includes('sudo -n tee /var/lib/kata/config.toml'), '4 [M3 leg d] the third VM command tees config.toml')
  for (const needle of ['sudo -n tee /etc/kata/kata.env', 'chown root:exedev', 'chmod 0640', 'systemctl restart kata.service']) {
    assert.ok(vm[3].command.includes(needle), `4 [M3 leg d] the env delivery carries ${JSON.stringify(needle)}`)
  }

  // The two texts, exactly, on the stdin of their own delivery.
  assert.equal(vm[2].input, CONFIG_TEXT, '4 [M3 leg d] the config text is delivered verbatim on stdin')
  assert.equal(vm[3].input, envText(TOKEN), '4 [M3 leg d] the env text is delivered verbatim on stdin')

  // One poll apart, at the default of five seconds: once after the first
  // `.setup-done` answer and once after `activating`.
  assert.deepEqual(green.sleeps, [5, 5], '4 [M3 leg d] the sleep spy was called with 5 exactly twice')

  // The env file: 0600, exactly two lines, and written after the last command.
  assert.ok(fs.existsSync(green.envPath), `4 [M3 leg d] ${green.envPath} was written`)
  assert.equal(
    fs.readFileSync(green.envPath, 'utf8'), hubEnvText(TOKEN),
    '4 [M3 leg d] the env file is exactly KATA_URL and KATA_TOKEN'
  )
  assert.equal(
    fs.statSync(green.envPath).mode & 0o777, 0o600,
    `4 [M3 leg d] the env file is mode 0600; got ${(fs.statSync(green.envPath).mode & 0o777).toString(8)}`
  )
  assert.deepEqual(
    green.existedAtCall.filter(Boolean), [],
    '4 [M3 leg d] the env file existed during no command — it is written after the last is-active'
  )
}

// ── 5. M4 / leg (e) — already built, the two resumes, and --dry-run ─────────

const KATA_LISTED = [{
  name: 'kata',
  type: 'http-proxy',
  attachments: ['vm:fleet-r7-2609030900-a1b2'],
  config_summary: 'Authorization:Bearer ***'
}]

{
  // Already built: the listing names `kata`, the row is there and the env file
  // exists. Nothing mutates, nothing reaches the VM, nothing is written.
  const SENTINEL = 'KATA_URL=https://already.example.exe.xyz\nKATA_TOKEN=deadbeef\n'
  const done = makeCase({ integrations: KATA_LISTED, rowsBefore: [KATA_ROW], envFile: SENTINEL })
  const run = await build(done)
  assert.equal(run.error, null, `5 [M4 leg e] an already-built hub exits 0; got ${run.error?.message}`)
  assert.deepEqual(mutating(done.exec), [], '5 [M4 leg e] an already-built hub issues no mutating verb')
  assert.deepEqual(done.exec.mutating(), [], '5 [M4 leg e] and none the shared helper counts either')
  assert.deepEqual(vmCalls(done.exec), [], '5 [M4 leg e] and no command on the VM')
  assert.equal(fs.readFileSync(done.envPath, 'utf8'), SENTINEL, "5 [M4 leg e] the env file's bytes are unchanged")
  assert.ok(
    said(run).includes('kata-hub already built'),
    `5 [M4 leg e] it says "kata-hub already built"; got ${said(run)}`
  )
}

{
  // The row exists, the listing does not name `kata`, there is no env file:
  // the `new` and the `share port` are skipped, the add is issued, and M3's
  // wait and delivery still run before the env file is written.
  const resume = makeCase({ integrations: [], rowsBefore: [KATA_ROW] })
  const run = await build(resume)
  assert.equal(run.error, null, `5 [M4 leg e] a resume past the VM does not fail; got ${run.error?.message}`)
  assert.deepEqual(
    mutating(resume.exec), [ADD_VERB],
    '5 [M4 leg e] a hub whose VM exists issues exactly the integrations add'
  )
  assert.deepEqual(
    vmCalls(resume.exec).map((c) => c.command),
    [DONE_POLL, DONE_POLL, CONFIG_DELIVERY, ENV_DELIVERY, ACTIVE_POLL, ACTIVE_POLL],
    "5 [M4 leg e] M3's wait and delivery run on a resume too"
  )
  assert.equal(fs.readFileSync(resume.envPath, 'utf8'), hubEnvText(TOKEN), '5 [M4 leg e] and the env file is written')
}

{
  // `kata` is listed but the VM was rebuilt behind it: the `new` and the
  // `share port` are issued, and the edge's bearer is rotated to the one the
  // rebuilt hub holds — never a second `integrations add`.
  const rebuilt = makeCase({ integrations: KATA_LISTED, rowsBefore: [] })
  const run = await build(rebuilt)
  assert.equal(run.error, null, `5 [M4 leg e] a rebuilt hub does not fail; got ${run.error?.message}`)
  assert.deepEqual(
    mutating(rebuilt.exec), [NEW_VERB, SHARE_VERB, EDIT_VERB],
    '5 [M4 leg e] a rebuilt VM behind an existing integration rotates the bearer with integrations edit'
  )
  const edit = lobbyCall(rebuilt.exec, EDIT_VERB)
  assert.equal(edit?.options?.input, TOKEN, "5 [M4 leg e] the freshly minted bearer is on the edit's stdin")
  assert.match(String(edit?.options?.input), /^[0-9a-f]{64}$/, '5 [M4 leg e] and it is 64 lower-case hex characters')
  assert.deepEqual(
    vmCalls(rebuilt.exec).map((c) => c.command),
    [DONE_POLL, DONE_POLL, CONFIG_DELIVERY, ENV_DELIVERY, ACTIVE_POLL, ACTIVE_POLL],
    "5 [M4 leg e] M3's wait and delivery run behind the rotation"
  )
  assert.equal(
    vmCalls(rebuilt.exec)[3].input, envText(TOKEN),
    '5 [M4 leg e] the hub is given the same bearer the edge now injects'
  )
  assert.equal(fs.readFileSync(rebuilt.envPath, 'utf8'), hubEnvText(TOKEN), '5 [M4 leg e] and the env file carries it')
}

{
  // --dry-run over the fresh build's own fixtures: nothing mutates, nothing
  // reaches the VM, nothing is written, and the three verbs are printed.
  const dry = makeCase()
  const run = await build(dry, ['--dry-run'])
  assert.equal(run.error, null, `5 [M4 leg e] --dry-run does not fail; got ${run.error?.message}`)
  assert.deepEqual(mutating(dry.exec), [], '5 [M4 leg e] --dry-run issues no mutating verb')
  assert.deepEqual(vmCalls(dry.exec), [], '5 [M4 leg e] --dry-run runs no command on the VM')
  assert.equal(fs.existsSync(dry.envPath), false, '5 [M4 leg e] --dry-run writes nothing')
  const text = said(run)
  for (const verb of [
    'new --name kata-hub --cpu 1 --memory 2GB --disk 20GB',
    SHARE_VERB,
    'integrations add http-proxy --name kata',
    "--policy 'tag:fleet'"
  ]) {
    assert.ok(text.includes(verb), `5 [M4 leg e] --dry-run prints ${JSON.stringify(verb)}; got ${text}`)
  }
}

// ── 6. M5 / leg (f) — a failed `new`, and a wait that runs out ───────────────

{
  const failed = makeCase({ newAnswer: answer('boom', { code: 1 }) })
  const run = await build(failed)
  assert.ok(run.error instanceof LobbyError, `6 [M5 leg f] a new that fails is a LobbyError; got ${run.error}`)
  assert.match(String(run.error?.message), /boom/, "6 [M5 leg f] carrying the lobby's own words")
  assert.deepEqual(mutating(failed.exec), [NEW_VERB], '6 [M5 leg f] no share port and no integrations add follow a failed new')
  assert.deepEqual(vmCalls(failed.exec), [], '6 [M5 leg f] and no command on the VM')
  assert.equal(fs.existsSync(failed.envPath), false, '6 [M5 leg f] and no env file')
}

{
  // A daemon that never comes up: the wait is bounded by KATA_HUB_WAIT_SECONDS,
  // and what it gives up on is a LobbyError naming the VM and the last answer
  // it saw. The module is re-imported under the bound, so a tool that reads the
  // variable once at load sees it too.
  const previous = process.env.KATA_HUB_WAIT_SECONDS
  process.env.KATA_HUB_WAIT_SECONDS = '20'
  let bounded
  try {
    const fresh = await import(`${HUB_MODULE.href}?kata-hub-wait=20`)
    const main = fresh.kataHub ?? fresh.default
    bounded = makeCase({ isActive: ['activating'] })
    const run = await build(bounded, [], main)
    assert.ok(
      run.error instanceof LobbyError,
      `6 [M5 leg f] a wait that exhausts KATA_HUB_WAIT_SECONDS is a LobbyError; got ${run.error}`
    )
    assert.match(String(run.error?.message), /kata-hub/, '6 [M5 leg f] naming kata-hub')
    assert.match(String(run.error?.message), /activating/, '6 [M5 leg f] and the last answer it saw')
  } finally {
    if (previous === undefined) delete process.env.KATA_HUB_WAIT_SECONDS
    else process.env.KATA_HUB_WAIT_SECONDS = previous
  }

  const polls = vmCalls(bounded.exec).filter((c) => c.command === ACTIVE_POLL)
  assert.ok(
    polls.length >= 1 && polls.length <= 5,
    `6 [M5 leg f] at most five is-active calls under a 20 second bound; got ${polls.length}`
  )
  assert.equal(fs.existsSync(bounded.envPath), false, '6 [M5 leg f] and no env file follows an exhausted wait')
}

console.log('ALL TESTS PASSED')
