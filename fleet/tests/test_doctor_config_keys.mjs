/**
 * Exam for `~/.ultrapowers/fleet.json` as the doctor reads it — the keys nothing
 * reads, and the account the launcher defaults to.
 *
 * The config file carries two keys the doctor reads, `cpu` and `memory`, and one
 * the launcher reads, `account`. A key beside those three is a key nothing reads
 * — usually one left by a fleet from before the lift — and the `capacity` row is
 * red until the file is rewritten.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from. Groups 1–3 are
 * this file's BASE shape, extended for `account`; groups 4–5 are this task's own
 * clauses.
 *
 *   1  `fleetConfigKeys({ path })` answers the file's top-level key names in
 *      file order, or null; `doctor`'s `configKeys` option turns the `capacity`
 *      row red when it names a key that is none of the three.
 *   2  a `configKeys` list that lacks `cpu` or lacks `memory` keeps the row `ok`
 *      and names each lacking key as taking its default.
 *   3  the CLI reads the keys off the same file `--config` names: a stale file
 *      exits 1 and not-ready, the two-key file exits 0 and ready with `.config`
 *      still exactly the two keys.
 *   4  M3 / leg (c) — `fleetConfigAccount({ path })`, and the stale-key check
 *      accepting `account` beside `cpu` and `memory`.
 *   5  M3 / leg (c) — `loadFleetConfig` over the three-key file still answers
 *      exactly the two keys, and `DOCTOR_DEFAULTS` is still those two.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub, and
 * the CLI group drives it against a PATH shim. That rig is copied from
 * `test_doctor.mjs` rather than imported, because that file exports nothing.
 * The unit groups pass a fixture record path as `verbsPath`, never the real
 * `fleet/exe-verbs.json`. Nothing here opens a socket and nothing here reaches
 * exe.dev.
 *
 * The stale fixture's keys are `golden` and `stateRepo`: a key nothing reads is
 * echoed out of the operator's own file, so neither the doctor's source nor this
 * exam has to spell a retired name to describe one.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import * as doctorModule from '../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')

// ── the symbols this file asks for ───────────────────────────────────────────

// `fleet/doctor.mjs` exports `fleetConfigKeys({ path })` and, from M1 of this
// task, `fleetConfigAccount({ path })`. Asked through the namespace rather than
// as named imports, so an absent implementation reads as these lines rather
// than as a link error with no assertion behind it.
assert.equal(
  typeof doctorModule.fleetConfigKeys,
  'function',
  '0 fleet/doctor.mjs exports fleetConfigKeys({ path })'
)
assert.equal(
  typeof doctorModule.fleetConfigAccount,
  'function',
  '0 [M1] fleet/doctor.mjs exports fleetConfigAccount({ path })'
)
const { fleetConfigKeys, fleetConfigAccount, loadFleetConfig, doctor, DOCTOR_DEFAULTS } = doctorModule

// ── the exec rig, copied from test_doctor.mjs ────────────────────────────────

const CLAUDE_TOKEN = path.join(FLEET_DIR, 'claude-token.mjs')

const helpCmd = (verb) => `ssh exe.dev "help ${verb}"`

const CMD = {
  whoami: 'ssh exe.dev whoami',
  billing: 'ssh exe.dev "billing plan --json"',
  list: 'ssh exe.dev "integrations list --json"',
  github: 'ssh exe.dev "integrations setup github --list"',
  token: `node ${CLAUDE_TOKEN} status`,
  accounts: `node ${CLAUDE_TOKEN} accounts --json`
}

const TARGET = 'popmechanic/ultrapowers'
const ghName = (target) => `gh-${String(target).replace(/\//g, '-')}`

/** Measured on the live account: `claude-max`'s config_summary. */
const CLAUDE_SUMMARY = 'target=https://api.anthropic.com header=Authorization:Bearer ***'

/** claude-token's status line when the keychain holds a record. */
const STATUS_LINE = 'access token expires 2026-09-04T18:20:00Z (37 min)'

/** M2: the one-entry listing `claude-token.mjs accounts --json` prints, and the
 *  `account=<name>` comment the credential tool sets on `claude-max`. */
const ACCOUNTS = [{ name: 'ultrapowers', expiresAt: '2026-09-05T20:00:00.000Z', fresh: true }]
const ACCOUNTS_JSON = JSON.stringify(ACCOUNTS)
const EDGE_COMMENT = 'account=ultrapowers'

const listing = (entries) => `${JSON.stringify({ integrations: entries })}\n`

const claudeMax = () => ({
  name: 'claude-max',
  type: 'http-proxy',
  attachments: null,
  comment: EDGE_COMMENT,
  config_summary: CLAUDE_SUMMARY
})

const ghObject = (target) => ({
  name: ghName(target),
  type: 'github',
  attachments: null,
  config: { repositories: [target], installation_id: 4711, act_as_user: true }
})

/** A healthy account: the bearer, and one target object on no tag. */
const GREEN_CATALOG = () => [claudeMax(), ghObject(TARGET)]

const BILLING = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'team' }
const GITHUB_LISTING = 'GitHub accounts:\n  popmechanic\n'

// ── the fixture verb record the unit groups read ─────────────────────────────

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-config-keys-'))

const FIXTURE_CAPTURED = '2026-09-05'
const FIXTURE_VERBS = { rm: ['--json'] }
const FIXTURE_NAMES = Object.keys(FIXTURE_VERBS)

const optionsBlock = (verb, flags) =>
  `Command: ${verb}\nDoes the ${verb} thing.\nOptions:\n${flags.map((f) => `  ${f}  what it does`).join('\n')}\n`

const RECORD = path.join(ROOT, 'exe-verbs-fixture.json')
fs.writeFileSync(RECORD, JSON.stringify({ capturedAt: FIXTURE_CAPTURED, verbs: FIXTURE_VERBS }))

const GREEN = () => ({
  [CMD.whoami]: { code: 0, stdout: 'marcus\n' },
  [CMD.billing]: { code: 0, stdout: `${JSON.stringify(BILLING)}\n` },
  [CMD.list]: { code: 0, stdout: listing(GREEN_CATALOG()) },
  [CMD.github]: { code: 0, stdout: GITHUB_LISTING },
  [CMD.token]: { code: 0, stdout: `${STATUS_LINE}\n` },
  [CMD.accounts]: { code: 0, stdout: `${ACCOUNTS_JSON}\n` },
  ...Object.fromEntries(
    FIXTURE_NAMES.map((verb) => [helpCmd(verb), { code: 0, stdout: optionsBlock(verb, FIXTURE_VERBS[verb]) }])
  )
})

/** An exec stub over a green account. A command the doctor issues that the
 *  table does not name answers code 127, so it surfaces as a red row rather
 *  than a silent default. */
function greenExec () {
  const table = GREEN()
  return async (cmd) => table[cmd] ?? { code: 127, stdout: `unstubbed command: ${cmd}\n` }
}

/** The config the file's two read keys carry in every case below — the two-key
 *  file spells them, and the stale files leave them at their defaults, which is
 *  the same pair of values either way. */
const CONFIG = { cpu: '8', memory: '16GB' }

/** The `capacity` detail the pool row answers for this pool and this config:
 *  the pool, then what one run asks for. Every leg below that says "the pool
 *  sentence" means this exact string, and the stale-key check has to leave it
 *  intact inside whatever it says about the keys. */
const BASE_DETAIL = 'XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB'

const rowById = (result, id) => result.rows.find((r) => r.id === id)
const statusOf = (result) => Object.fromEntries(result.rows.map((r) => [r.id, r.status]))

/** The seven-row status map of a healthy fleet. */
const ALL_OK = Object.freeze({
  'exe-dev': 'ok',
  capacity: 'ok',
  claude: 'ok',
  accounts: 'ok',
  github: 'ok',
  integrations: 'ok',
  'verb-drift': 'ok'
})

/** Run the doctor over the green account with `opts` spread onto it, and answer
 *  the whole result. `configKeys` is left out entirely when it is not given, so
 *  the "not given" case is really an absent option. */
async function run (opts = {}) {
  return doctor({ config: { ...CONFIG }, exec: greenExec(), target: null, verbsPath: RECORD, ...opts })
}

// ── fixtures on disk ─────────────────────────────────────────────────────────

/** Write `text` to a fresh file under the fixture root and answer its path. */
function fixture (name, text) {
  const p = path.join(ROOT, name)
  fs.writeFileSync(p, text)
  return p
}

/** The stale file: two keys, neither of them one anything reads. */
const STALE = fixture('stale.json', '{"golden":"x","stateRepo":"y"}')

/** Both read keys present, beside one stale key. */
const STALE_BESIDE = fixture('stale-beside.json', '{"cpu":"8","memory":"16GB","golden":"x"}')

/** The file the first-run walk writes: the two keys, explicitly. */
const TWO_KEY = fixture('two-key.json', '{"cpu":"8","memory":"16GB"}')

/** M3: the same file, plus the account the launcher defaults to. */
const THREE_KEY = fixture('three-key.json', '{"cpu":"8","memory":"16GB","account":"b"}')

const ABSENT = path.join(ROOT, 'absent.json')
assert.equal(fs.existsSync(ABSENT), false, '0 fixture: the absent config path starts absent')

// ── 1. fleetConfigKeys, and the configKeys option ────────────────────────────

{
  // The file's top-level key names, in file order.
  assert.deepEqual(
    await fleetConfigKeys({ path: STALE }),
    ['golden', 'stateRepo'],
    '1 fleetConfigKeys answers the stale file\'s two keys in file order'
  )

  // File order, not sorted order and not the doctor's own order — the stale key
  // is written last in the file and comes back last.
  assert.deepEqual(
    await fleetConfigKeys({ path: STALE_BESIDE }),
    ['cpu', 'memory', 'golden'],
    '1 fleetConfigKeys answers every top-level key, in file order'
  )

  assert.deepEqual(
    await fleetConfigKeys({ path: TWO_KEY }),
    ['cpu', 'memory'],
    '1 the two-key file answers exactly the two keys the doctor reads'
  )

  assert.deepEqual(
    await fleetConfigKeys({ path: THREE_KEY }),
    ['cpu', 'memory', 'account'],
    '1 [M3] the three-key file answers cpu, memory and account, in file order'
  )
}

{
  // Null when the file is absent, and null when it is not a JSON object — an
  // array is not one, and neither is text that is not JSON at all.
  assert.equal(await fleetConfigKeys({ path: ABSENT }), null, '1 an absent config file answers null')
  assert.equal(
    await fleetConfigKeys({ path: fixture('array.json', '[1,2]') }),
    null,
    '1 a file holding [1,2] answers null'
  )
  assert.equal(
    await fleetConfigKeys({ path: fixture('garbage.json', 'not json at all\n') }),
    null,
    '1 a file that is not a JSON object at all answers null rather than throwing'
  )
}

{
  // A configKeys list naming keys nothing reads turns the capacity row red and
  // names every such key.
  const result = await run({ configKeys: ['golden', 'stateRepo'] })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `1 keys nothing reads turn capacity red; got ${capacity.status} — ${capacity.detail}`
  )
  for (const key of ['golden', 'stateRepo']) {
    assert.ok(
      capacity.detail.includes(key),
      `1 the detail names the stale key ${key}; got ${capacity.detail}`
    )
  }
  assert.ok(
    capacity.detail.includes('keys nothing reads'),
    `1 [M3] the red detail keeps the phrase "keys nothing reads"; got ${capacity.detail}`
  )
  // M3: the `it reads` sentence is reworded to say the launcher reads `account`
  // beside the two the doctor reads.
  for (const key of ['cpu', 'memory', 'account']) {
    assert.ok(
      capacity.detail.includes(key),
      `1 [M3] the red detail names ${key} as a key something reads; got ${capacity.detail}`
    )
  }
  assert.equal(capacity.fix, 'capacity', '1 the red row\'s fix is capacity')

  // The red detail still carries the pool sentence the row would have answered
  // — an operator learns the pool and the ask as well as which key is stale.
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `1 the red detail still carries the pool sentence; got ${capacity.detail}`
  )

  // The file's other keys never travel into `config`: the envelope is still
  // exactly the two keys the doctor reads.
  assert.deepEqual(
    { ...result.config },
    CONFIG,
    `1 a stale key does not reach result.config; got ${JSON.stringify(result.config)}`
  )

  // The row is the only one that moved, and one red row is not a ready fleet.
  assert.deepEqual(
    statusOf(result),
    { ...ALL_OK, capacity: 'missing' },
    '1 a stale key reddens capacity and nothing else'
  )
  assert.equal(result.verdict, 'not-ready', '1 a red capacity row is not a ready fleet')
}

{
  // leg (c) [M3]: both read keys present beside one stale key is still red, and
  // the detail names the stale key.
  const capacity = rowById(await run({ configKeys: ['cpu', 'memory', 'golden'] }), 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `1 [M3 leg c] configKeys ['cpu','memory','golden'] turns capacity red; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('golden'),
    `1 [M3 leg c] the detail names golden; got ${capacity.detail}`
  )
  assert.equal(capacity.fix, 'capacity', '1 the red row\'s fix is capacity')

  // `golden` is the one key nothing reads, and it is the one the row echoes out
  // of the file. That the three keys something DOES read are never echoed as
  // stale is group 4's leg: `['cpu','memory','account']` leaves the row ok with
  // no `keys nothing reads` at all.
  assert.ok(
    capacity.detail.includes('golden'),
    `1 [M3 leg c] the detail names the key nothing reads; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `1 the red detail still carries the pool sentence; got ${capacity.detail}`
  )
}

for (const [label, opts] of [
  ['the two read keys', { configKeys: ['cpu', 'memory'] }],
  ['null', { configKeys: null }],
  ['the option not given', {}]
]) {
  // Naming only the two read keys, naming nothing, and not asking at all each
  // leave the row exactly the pool sentence for this pool and config.
  const capacity = rowById(await run(opts), 'capacity')
  assert.equal(capacity.status, 'ok', `1 configKeys ${label} leaves capacity ok; got ${capacity.detail}`)
  assert.equal(
    capacity.detail,
    BASE_DETAIL,
    `1 configKeys ${label} answers the pool sentence alone; got ${capacity.detail}`
  )
}

// ── 2. a list that lacks a key the doctor reads ──────────────────────────────

for (const [given, lacking, def] of [
  [['memory'], 'cpu', '8'],
  [['cpu'], 'memory', '16GB']
]) {
  // A list that lacks one of the two read keys is not stale — the row stays ok
  // — and the detail says the lacking key is taking its default.
  const capacity = rowById(await run({ configKeys: given }), 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `2 configKeys ${JSON.stringify(given)} names no stale key, so the row is ok; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes(`${lacking} not in`),
    `2 the detail says ${lacking} is not in the file; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes(`the default ${def}`),
    `2 the detail names ${lacking}'s default ${def}; got ${capacity.detail}`
  )
  // Only the lacking key is named as lacking: the key the file does carry is
  // taking the file's value, not a default.
  assert.ok(
    !capacity.detail.includes(`${given[0]} not in`),
    `2 the key the file carries is not named as taking a default; got ${capacity.detail}`
  )
  // The row still says what the pool row said about the pool and the ask.
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `2 the ok detail still carries the pool sentence; got ${capacity.detail}`
  )
}

// ── 3. the CLI, against a PATH shim ──────────────────────────────────────────

/** A PATH directory holding stubs for every binary this run's constraints ask a
 *  test to stub. `ssh` and `node` carry the behaviour; the rest are inert, so a
 *  doctor that reached for one would be visibly wrong rather than live. */
function shimDir (name, { ssh, node }) {
  const dir = fs.mkdtempSync(path.join(ROOT, `${name}-`))
  const write = (bin, body) => {
    const p = path.join(dir, bin)
    fs.writeFileSync(p, body, { mode: 0o755 })
    fs.chmodSync(p, 0o755)
  }
  write('ssh', ssh)
  write('node', node)
  for (const bin of ['gh', 'curl', 'systemd-run', 'systemctl', 'git']) {
    write(bin, `#!/bin/sh\necho "${bin} is stubbed: $*" >&2\nexit 127\n`)
  }
  return dir
}

const CATALOG_JSON = JSON.stringify({ integrations: GREEN_CATALOG() })
const BILLING_JSON = JSON.stringify(BILLING)

// The `ssh` shim answers no `help <verb>` read: under it every help read exits
// 1, which M5 says is a finding in a green `verb-drift` row and never a
// refusal, so the runs below are still ready when nothing else is wrong.
const GREEN_DIR = shimDir('green', {
  ssh: `#!/bin/sh
case "$*" in
  *whoami*) echo marcus ;;
  *"billing plan"*) echo '${BILLING_JSON}' ;;
  *"integrations list"*) echo '${CATALOG_JSON}' ;;
  *"integrations setup github"*) printf 'GitHub accounts:\\n  popmechanic\\n' ;;
  *) exit 1 ;;
esac
exit 0
`,
  node: `#!/bin/sh
case "$*" in
  *"accounts --json"*) echo '${ACCOUNTS_JSON}' ;;
  *) echo '${STATUS_LINE}' >&2 ;;
esac
exit 0
`
})

const runCli = (args, { dir }) => {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], { encoding: 'utf8', env, timeout: 60000 })
}

{
  // The CLI reads the keys off the same file --config names. Under the green
  // shim every other row is ok, so a stale file is the whole difference between
  // ready and not-ready.
  const res = runCli(['--json', '--config', STALE], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    1,
    `3 a stale config file exits 1 under a green shim; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  const capacity = parsed.rows.find((r) => r.id === 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `3 the printed capacity row is missing; got ${JSON.stringify(capacity)}`
  )
  assert.equal(parsed.verdict, 'not-ready', '3 a stale config file is not a ready fleet')
  for (const key of ['golden', 'stateRepo']) {
    assert.ok(
      capacity.detail.includes(key),
      `3 the printed detail names the stale key ${key}; got ${capacity.detail}`
    )
  }
  assert.equal(capacity.fix, 'capacity', '3 the printed red row\'s fix is capacity')
  assert.deepEqual(
    parsed.config,
    CONFIG,
    `3 the stale keys stay out of the CLI's .config; got ${res.stdout}`
  )
}

{
  // The file the first-run walk writes — both keys, explicitly — is ready, and
  // the envelope echoes exactly those two keys.
  const res = runCli(['--json', '--config', TWO_KEY], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    0,
    `3 the two-key config file exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '3 the two-key config file is a ready fleet')
  assert.deepEqual(
    parsed.config,
    { cpu: '8', memory: '16GB' },
    `3 the CLI's .config is exactly the two keys; got ${res.stdout}`
  )
  assert.equal(
    parsed.rows.find((r) => r.id === 'capacity').status,
    'ok',
    '3 the two-key config file leaves capacity ok'
  )

  // M5: every `help <verb>` read failed under this shim, and `verb-drift` is
  // still ok — an unreadable help is a finding, never a refusal.
  const drift = parsed.rows.find((r) => r.id === 'verb-drift')
  assert.equal(
    drift.status,
    'ok',
    `3 [M5] verb-drift is ok when every help read fails; got ${drift.status} — ${drift.detail}`
  )
}

// ── 4. M3 / leg (c) — fleetConfigAccount, and account beside the read keys ───

{
  // leg (c): the file's top-level `account` when it is a non-empty string.
  assert.equal(
    await fleetConfigAccount({ path: THREE_KEY }),
    'b',
    '4 [M3 leg c] fleetConfigAccount answers the file\'s top-level account'
  )
}

for (const [label, p] of [
  ['an absent file', ABSENT],
  ['a file holding `{`', fixture('unparseable.json', '{')],
  ['a file holding `[]`', fixture('empty-array.json', '[]')],
  ['a file with no account key', fixture('cpu-only.json', '{"cpu":"8"}')],
  ['a file whose account is not a string', fixture('account-number.json', '{"account": 3}')]
]) {
  // leg (c): null for an absent file, unparseable JSON, a non-object, and an
  // `account` that is absent or not a string.
  assert.equal(
    await fleetConfigAccount({ path: p }),
    null,
    `4 [M3 leg c] ${label} answers null`
  )
}

{
  // M3: an `account` that is the empty string is not a non-empty string.
  assert.equal(
    await fleetConfigAccount({ path: fixture('account-empty.json', '{"account": ""}') }),
    null,
    '4 [M3] an empty-string account answers null'
  )
}

{
  // leg (c): a configKeys of ['cpu','memory','account'] leaves the capacity row
  // `ok`, with no `keys nothing reads` in its detail — `account` is a key the
  // launcher reads, not a key nothing reads.
  const result = await run({ configKeys: ['cpu', 'memory', 'account'] })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `4 [M3 leg c] account beside cpu and memory leaves capacity ok; got ${capacity.status} — ${capacity.detail}`
  )
  assert.equal(
    capacity.detail.includes('keys nothing reads'),
    false,
    `4 [M3 leg c] the detail carries no "keys nothing reads"; got ${capacity.detail}`
  )
  assert.equal(
    capacity.detail,
    BASE_DETAIL,
    `4 [M3 leg c] the detail is the pool sentence alone; got ${capacity.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '4 [M3 leg c] the account key reddens no row')
  assert.equal(result.verdict, 'ready', '4 [M3 leg c] a file naming an account the keychain holds is a ready fleet')
}

{
  // leg (c): the account option is not part of `result.config`, which stays
  // exactly the two keys `loadFleetConfig` answers.
  const result = await run({ configKeys: ['cpu', 'memory', 'account'], account: 'ultrapowers' })
  assert.deepEqual(
    { ...result.config },
    CONFIG,
    `4 [M3 leg c] account never reaches result.config; got ${JSON.stringify(result.config)}`
  )
}

// ── 5. M3 / leg (c) — loadFleetConfig and DOCTOR_DEFAULTS ────────────────────

{
  // leg (c): `loadFleetConfig` over the three-key file answers exactly the two
  // keys — `account` is read by `fleetConfigAccount` and by nothing else here.
  const config = await loadFleetConfig({ path: THREE_KEY })
  assert.deepEqual(
    { ...config },
    { cpu: '8', memory: '16GB' },
    `5 [M3 leg c] loadFleetConfig over the three-key file answers exactly { cpu, memory }; got ${JSON.stringify(config)}`
  )
  assert.deepEqual(
    Object.keys(config).sort(),
    ['cpu', 'memory'],
    '5 [M3 leg c] loadFleetConfig answers no third key'
  )
}

{
  // The two-key pin stands: DOCTOR_DEFAULTS is the literal lobby.mjs's
  // FLEET_DEFAULTS is byte-identical to, and it has exactly two keys.
  assert.deepEqual(
    Object.keys(DOCTOR_DEFAULTS).sort(),
    ['cpu', 'memory'],
    '5 [M3] DOCTOR_DEFAULTS still has exactly the two keys cpu and memory'
  )
  assert.deepEqual(
    { ...DOCTOR_DEFAULTS },
    { cpu: '8', memory: '16GB' },
    "5 [M3] DOCTOR_DEFAULTS is still { cpu: '8', memory: '16GB' }"
  )
}

console.log('ALL TESTS PASSED')
