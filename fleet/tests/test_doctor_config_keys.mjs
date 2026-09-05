/**
 * Exam for task 4 — "the doctor names the keys in fleet.json that nothing reads".
 *
 * The config file carries two keys the doctor reads, `cpu` and `memory`. A key
 * beside them is a key nothing reads — usually one left by a fleet from before
 * the lift — and until this task the doctor dropped it silently, so an operator
 * whose file said something the doctor ignored was told the fleet was ready.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from.
 *
 *   1  M1 / leg (a) — `fleetConfigKeys({ path })` answers the file's top-level
 *      key names in file order, or null; `doctor`'s `configKeys` option turns
 *      the `capacity` row red when it names a key that is neither `cpu` nor
 *      `memory`, and leaves BASE's row alone when it does not.
 *   2  M2 / leg (b) — a `configKeys` list that lacks `cpu` or lacks `memory`
 *      keeps the row `ok` and names each lacking key as taking its default.
 *   3  M3 / leg (c) — the CLI reads the keys off the same file `--config`
 *      names: a stale file exits 1 and not-ready, the two-key file exits 0 and
 *      ready with `.config` still exactly the two keys.
 *
 * M4 (first-run.md's `## capacity` section and SKILL.md's capacity paragraph)
 * and M5 (`ROW_IDS`, first-run.md's headings, `test_doctor.mjs`) are the Proof's
 * own `Run:` bullets — a grep over each document and the two existing suites —
 * so nothing here reads a document.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub, and
 * the CLI group drives it against a PATH shim. That rig is copied from
 * `test_doctor.mjs` rather than imported, because that file exports nothing.
 * Nothing here opens a socket and nothing here reaches exe.dev.
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

// ── the two symbols this task produces ───────────────────────────────────────

// M1: `fleet/doctor.mjs` exports `fleetConfigKeys({ path })`. Asked through the
// namespace rather than as a named import, so an absent implementation reads as
// this line rather than as a link error with no assertion behind it.
assert.equal(
  typeof doctorModule.fleetConfigKeys,
  'function',
  '0 [M1 leg a] fleet/doctor.mjs exports fleetConfigKeys({ path })'
)
const { fleetConfigKeys, doctor } = doctorModule

// ── the exec rig, copied from test_doctor.mjs ────────────────────────────────

const CMD = {
  whoami: 'ssh exe.dev whoami',
  billing: 'ssh exe.dev "billing plan --json"',
  list: 'ssh exe.dev "integrations list --json"',
  github: 'ssh exe.dev "integrations setup github --list"',
  token: `node ${path.join(FLEET_DIR, 'claude-token.mjs')} status`
}

const TARGET = 'popmechanic/ultrapowers'
const ghName = (target) => `gh-${String(target).replace(/\//g, '-')}`

/** Measured on the live account: `claude-max`'s config_summary. */
const CLAUDE_SUMMARY = 'target=https://api.anthropic.com header=Authorization:Bearer ***'

/** claude-token's status line when the keychain holds a record. */
const STATUS_LINE = 'access token expires 2026-09-04T18:20:00Z (37 min)'

const listing = (entries) => `${JSON.stringify({ integrations: entries })}\n`

const claudeMax = () => ({
  name: 'claude-max',
  type: 'http-proxy',
  attachments: null,
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

const GREEN = () => ({
  [CMD.whoami]: { code: 0, stdout: 'marcus\n' },
  [CMD.billing]: { code: 0, stdout: `${JSON.stringify(BILLING)}\n` },
  [CMD.list]: { code: 0, stdout: listing(GREEN_CATALOG()) },
  [CMD.github]: { code: 0, stdout: GITHUB_LISTING },
  [CMD.token]: { code: 0, stdout: `${STATUS_LINE}\n` }
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

/** The `capacity` detail BASE answers for this pool and this config. Every leg
 *  that says "what BASE answers" means this exact string. */
const BASE_DETAIL = 'XLarge pool 16 vCPU / 64GB fits 2 runs of 8 vCPU / 16GB'

const rowById = (result, id) => result.rows.find((r) => r.id === id)
const statusOf = (result) => Object.fromEntries(result.rows.map((r) => [r.id, r.status]))

/** Run the doctor over the green account with `opts` spread onto it, and answer
 *  the whole result. `configKeys` is left out entirely when it is not given, so
 *  the "not given" case of M1 is really an absent option. */
async function run (opts = {}) {
  return doctor({ config: { ...CONFIG }, exec: greenExec(), target: null, ...opts })
}

// ── fixtures on disk ─────────────────────────────────────────────────────────

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-config-keys-'))

/** Write `text` to a fresh file under the fixture root and answer its path. */
function fixture (name, text) {
  const p = path.join(ROOT, name)
  fs.writeFileSync(p, text)
  return p
}

/** The stale file: two keys, neither of them one the doctor reads. */
const STALE = fixture('stale.json', '{"golden":"x","stateRepo":"y"}')

/** Both read keys present, beside one stale key. */
const STALE_BESIDE = fixture('stale-beside.json', '{"cpu":"8","memory":"16GB","golden":"x"}')

/** The file the first-run walk writes: the two keys, explicitly. */
const TWO_KEY = fixture('two-key.json', '{"cpu":"8","memory":"16GB"}')

const ABSENT = path.join(ROOT, 'absent.json')
assert.equal(fs.existsSync(ABSENT), false, '0 fixture: the absent config path starts absent')

// ── 1. M1 — fleetConfigKeys, and the configKeys option ───────────────────────

{
  // leg (a): the file's top-level key names, in file order.
  assert.deepEqual(
    await fleetConfigKeys({ path: STALE }),
    ['golden', 'stateRepo'],
    '1 [M1 leg a] fleetConfigKeys answers the stale file\'s two keys in file order'
  )

  // M1: file order, not sorted order and not the doctor's own order — the
  // stale key is written last in the file and comes back last.
  assert.deepEqual(
    await fleetConfigKeys({ path: STALE_BESIDE }),
    ['cpu', 'memory', 'golden'],
    '1 [M1 leg a] fleetConfigKeys answers every top-level key, in file order'
  )

  assert.deepEqual(
    await fleetConfigKeys({ path: TWO_KEY }),
    ['cpu', 'memory'],
    '1 [M1 leg a] the two-key file answers exactly the two keys the doctor reads'
  )
}

{
  // leg (a): null when the file is absent, and null when it is not a JSON
  // object — an array is not one, and neither is text that is not JSON at all.
  assert.equal(await fleetConfigKeys({ path: ABSENT }), null, '1 [M1 leg a] an absent config file answers null')
  assert.equal(
    await fleetConfigKeys({ path: fixture('array.json', '[1,2]') }),
    null,
    '1 [M1 leg a] a file holding [1,2] answers null'
  )
  assert.equal(
    await fleetConfigKeys({ path: fixture('garbage.json', 'not json at all\n') }),
    null,
    '1 [M1] a file that is not a JSON object at all answers null rather than throwing'
  )
}

{
  // leg (a): a configKeys list naming keys other than cpu and memory turns the
  // capacity row red, names every such key, and says which two are read.
  const result = await run({ configKeys: ['golden', 'stateRepo'] })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `1 [M1 leg a] keys nothing reads turn capacity red; got ${capacity.status} — ${capacity.detail}`
  )
  for (const key of ['golden', 'stateRepo']) {
    assert.ok(
      capacity.detail.includes(key),
      `1 [M1 leg a] the detail names the stale key ${key}; got ${capacity.detail}`
    )
  }
  assert.ok(
    capacity.detail.includes('keys nothing reads'),
    `1 [M1 leg a] the detail says these are keys nothing reads; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('reads cpu and memory only'),
    `1 [M1 leg a] the detail says it reads cpu and memory only; got ${capacity.detail}`
  )
  assert.equal(capacity.fix, 'capacity', '1 [M1 leg a] the red row\'s fix is capacity')

  // The red detail still carries the pool sentence BASE would have produced —
  // an operator learns the pool fits as well as which key is stale.
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `1 [M1] the red detail still carries BASE's pool sentence; got ${capacity.detail}`
  )

  // The file's other keys never travel into `config`: the envelope is still
  // exactly the two keys the doctor reads.
  assert.deepEqual(
    { ...result.config },
    CONFIG,
    `1 [M1] a stale key does not reach result.config; got ${JSON.stringify(result.config)}`
  )

  // The row is the only one that moved, and one red row is not a ready fleet.
  assert.deepEqual(
    statusOf(result),
    { 'exe-dev': 'ok', capacity: 'missing', claude: 'ok', github: 'ok', integrations: 'ok' },
    '1 [M1] a stale key reddens capacity and nothing else'
  )
  assert.equal(result.verdict, 'not-ready', '1 [M1] a red capacity row is not a ready fleet')
}

{
  // leg (a): both read keys present beside one stale key is still red, the
  // detail names the stale key — and does not list `cpu` among the stale ones.
  const capacity = rowById(await run({ configKeys: ['cpu', 'memory', 'golden'] }), 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `1 [M1 leg a] one stale key beside the two read keys is still red; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('golden'),
    `1 [M1 leg a] the detail names the stale key; got ${capacity.detail}`
  )
  assert.ok(
    !capacity.detail.includes('cpu,'),
    `1 [M1 leg a] a key the doctor reads is not named as stale; got ${capacity.detail}`
  )
  assert.equal(capacity.fix, 'capacity', '1 [M1 leg a] the red row\'s fix is capacity')
}

for (const [label, opts] of [
  ['the two read keys', { configKeys: ['cpu', 'memory'] }],
  ['null', { configKeys: null }],
  ['the option not given', {}]
]) {
  // leg (a): naming only the two read keys, naming nothing, and not asking at
  // all each leave the row exactly as BASE answers it for this pool and config.
  const capacity = rowById(await run(opts), 'capacity')
  assert.equal(capacity.status, 'ok', `1 [M1 leg a] configKeys ${label} leaves capacity ok; got ${capacity.detail}`)
  assert.equal(
    capacity.detail,
    BASE_DETAIL,
    `1 [M1 leg a] configKeys ${label} answers BASE's detail; got ${capacity.detail}`
  )
}

// ── 2. M2 — a list that lacks a key the doctor reads ─────────────────────────

for (const [given, lacking, def] of [
  [['memory'], 'cpu', '8'],
  [['cpu'], 'memory', '16GB']
]) {
  // leg (b): a list that lacks one of the two read keys is not stale — the row
  // stays ok — and the detail says the lacking key is taking its default.
  const capacity = rowById(await run({ configKeys: given }), 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `2 [M2 leg b] configKeys ${JSON.stringify(given)} names no stale key, so the row is ok; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes(`${lacking} not in`),
    `2 [M2 leg b] the detail says ${lacking} is not in the file; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes(`the default ${def}`),
    `2 [M2 leg b] the detail names ${lacking}'s default ${def}; got ${capacity.detail}`
  )
  // Only the lacking key is named as lacking: the key the file does carry is
  // taking the file's value, not a default.
  assert.ok(
    !capacity.detail.includes(`${given[0]} not in`),
    `2 [M2] the key the file carries is not named as taking a default; got ${capacity.detail}`
  )
  // The row still says what BASE said about the pool.
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `2 [M2] the ok detail still carries BASE's pool sentence; got ${capacity.detail}`
  )
}

// ── 3. M3 — the CLI, against a PATH shim ─────────────────────────────────────

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
echo '${STATUS_LINE}' >&2
exit 0
`
})

const runCli = (args, { dir }) => {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], { encoding: 'utf8', env, timeout: 60000 })
}

{
  // leg (c): the CLI reads the keys off the same file --config names. Under the
  // green shim every other row is ok, so a stale file is the whole difference
  // between ready and not-ready.
  const res = runCli(['--json', '--config', STALE], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    1,
    `3 [M3 leg c] a stale config file exits 1 under a green shim; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  const capacity = parsed.rows.find((r) => r.id === 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `3 [M3 leg c] the printed capacity row is missing; got ${JSON.stringify(capacity)}`
  )
  assert.equal(parsed.verdict, 'not-ready', '3 [M3 leg c] a stale config file is not a ready fleet')
  for (const key of ['golden', 'stateRepo']) {
    assert.ok(
      capacity.detail.includes(key),
      `3 [M3 leg c] the printed detail names the stale key ${key}; got ${capacity.detail}`
    )
  }
  assert.equal(capacity.fix, 'capacity', '3 [M3 leg c] the printed red row\'s fix is capacity')
  assert.deepEqual(
    parsed.config,
    CONFIG,
    `3 [M3] the stale keys stay out of the CLI's .config; got ${res.stdout}`
  )
}

{
  // leg (c): the file the first-run walk writes — both keys, explicitly — is
  // ready, and the envelope echoes exactly those two keys.
  const res = runCli(['--json', '--config', TWO_KEY], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    0,
    `3 [M3 leg c] the two-key config file exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '3 [M3 leg c] the two-key config file is a ready fleet')
  assert.deepEqual(
    parsed.config,
    { cpu: '8', memory: '16GB' },
    `3 [M3 leg c] the CLI's .config is exactly the two keys; got ${res.stdout}`
  )
  assert.equal(
    parsed.rows.find((r) => r.id === 'capacity').status,
    'ok',
    '3 [M3 leg c] the two-key config file leaves capacity ok'
  )
}

// leg (d)
console.log('ALL TESTS PASSED')
