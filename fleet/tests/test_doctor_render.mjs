/**
 * Exam for the doctor's eighth row — the renderer `~/.ultrapowers/fleet.json`
 * names, read off the same `integrations list --json` the `claude` and
 * `integrations` rows already read.
 *
 * A fleet that names no renderer is green and says "not configured"; a fleet
 * that names one the edge does not carry is red, and points at the walk's
 * `## render` section. The `render` key itself is a key something reads, so it
 * no longer turns the `capacity` row red.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from.
 *
 *   1  M1 / leg (a) — `ROW_IDS` carries `render` eighth, after `verb-drift`,
 *      and a green doctor's rows are that list. (The hub's `kata` row was
 *      later appended after it, so `render` is eighth rather than last.)
 *   2  M2 / leg (b) — the `render` row: absent, null, present-and-found,
 *      present-and-absent, and an unreadable listing.
 *   3  M3 / leg (c) — `fleetConfigRender({ path })`, and `render` staying out
 *      of `result.config`.
 *   4  M4 / leg (d) — `CONFIG_KEYS` accepting `render`, and the reworded red
 *      detail.
 *   5  M5 / leg (e) — `renderRows` printing the eighth row after the seventh,
 *      with its first-run.md pointer under a red one.
 *   6  M5 / leg (f) — the CLI, against a PATH shim: `node fleet/doctor.mjs
 *      --json --config <fixture>` reads the file's `render` key.
 *   7  M1, M2 / leg (g) — `skills/ultrapowers/references/first-run.md`: one
 *      `## ` heading per row, `ROW_IDS` in order, `## render` the eighth.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub, and
 * group 6 drives it against a PATH shim. That rig is copied from
 * `test_doctor_config_keys.mjs` rather than imported, because that file exports
 * nothing. The unit groups pass a fixture record path as `verbsPath`, never the
 * real `fleet/exe-verbs.json`. Nothing here opens a socket and nothing here
 * reaches exe.dev.
 *
 * The proxy integration is named by its own name, `browser-run`, and by the
 * proxy address `browser-run.int.exe.xyz`: the renderer is reached only through
 * exe.dev's edge, so no host of the renderer's own vendor is spelled anywhere in
 * this file.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import * as doctorModule from '../doctor.mjs'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')
const FIRST_RUN = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'references', 'first-run.md')

// ── the symbols this file asks for ───────────────────────────────────────────

// M3: `fleet/doctor.mjs` exports `fleetConfigRender({ path })`. Asked through
// the namespace rather than as a named import, so an absent implementation
// reads as this line rather than as a link error with no assertion behind it.
assert.equal(
  typeof doctorModule.fleetConfigRender,
  'function',
  '0 [M3] fleet/doctor.mjs exports fleetConfigRender({ path })'
)
const { fleetConfigRender, doctor, renderRows, ROW_IDS } = doctorModule

// ── the exec rig, copied from test_doctor_config_keys.mjs ────────────────────

const CLAUDE_TOKEN = path.join(FLEET_DIR, 'claude-token.mjs')

const helpCmd = (verb) => `ssh exe.dev "help ${verb}"`

const CMD = {
  whoami: 'ssh exe.dev whoami',
  billing: 'ssh exe.dev "billing plan --json"',
  list: 'ssh exe.dev "integrations list --json"',
  github: 'ssh exe.dev "integrations setup github --list"',
  token: `node ${CLAUDE_TOKEN} status`,
  accounts: `node ${CLAUDE_TOKEN} accounts --json`,
  kataVm: 'ssh exe.dev "ls kata-hub --json"'
}

/** The policy read for one integration, and what it answers (measured 2026-09-11):
 *  `policy.selector` is the complete attachment expression, `revision` the
 *  opaque string `policy set --if-revision` echoes back. */
const policyCmd = (name) => `ssh exe.dev "integrations policy get ${name} --json"`
const REVISION = 'ar1_0123456789abcdef'
const policyJson = (name, selector = 'tag:fleet') => `${JSON.stringify({
  integration: { name, team: false },
  scope: 'personal',
  revision: REVISION,
  valid: true,
  policy: { selector, wire: selector, expiresAt: null, simpleSelectors: [selector] }
})}\n`
const policyAnswer = (name, selector) => ({ code: 0, stdout: policyJson(name, selector) })

const TARGET = 'popmechanic/ultrapowers'
const ghName = (target) => `gh-${String(target).replace(/\//g, '-')}`

/** Measured on the live account: `claude-max`'s config_summary. */
const CLAUDE_SUMMARY = 'target=https://api.anthropic.com header=Authorization:Bearer ***'

/** claude-token's status line when the keychain holds a record. */
const STATUS_LINE = 'access token expires 2026-09-04T18:20:00Z (37 min)'

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

/** M2: the integration the `render` key names, as the listing carries it — an
 *  http-proxy created once per account and attached to nothing. Presence by
 *  name is the whole check, so the entry says nothing else about itself. */
const RENDER_NAME = 'browser-run'
const RENDER_ACCOUNT = 'abc'
const RENDER_KEY = Object.freeze({ integration: RENDER_NAME, account: RENDER_ACCOUNT })

const renderObject = () => ({
  name: RENDER_NAME,
  type: 'http-proxy',
  attachments: null,
  comment: null
})

/** The hub's own http-proxy, as the listing carries it: a bearer in the
 *  summary, and the policy — not the attachments — is what grants it. */
const kataObject = () => ({
  name: 'kata',
  type: 'http-proxy',
  attachments: ['vm:fleet-r7-2609030900-a1b2'],
  comment: 'kata issue daemon on kata-hub',
  config_summary: 'target=https://kata-hub.example.exe.xyz header=Authorization:Bearer ***'
})

/** What `ls kata-hub --json` answers once the hub is built. */
const kataVms = () => `${JSON.stringify({
  vms: [{
    vm_name: 'kata-hub',
    status: 'running',
    https_url: 'https://kata-hub.example.exe.xyz',
    ssh_dest: 'kata-hub@exe.dev'
  }]
})}\n`

/** A healthy account with no renderer at the edge: the bearer, one target
 *  object on no tag, and the hub's own proxy. */
const GREEN_CATALOG = () => [claudeMax(), ghObject(TARGET), kataObject()]

/** The same account, with the renderer's own object beside them. */
const RENDER_CATALOG = () => [...GREEN_CATALOG(), renderObject()]

const BILLING = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'team' }
const GITHUB_LISTING = 'GitHub accounts:\n  popmechanic\n'

// ── the fixture verb record the unit groups read ─────────────────────────────

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-render-'))

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
  [policyCmd('claude-max')]: policyAnswer('claude-max'),
  [policyCmd(RENDER_NAME)]: policyAnswer(RENDER_NAME),
  [policyCmd('kata')]: policyAnswer('kata'),
  [CMD.kataVm]: { code: 0, stdout: kataVms() },
  ...Object.fromEntries(
    FIXTURE_NAMES.map((verb) => [helpCmd(verb), { code: 0, stdout: optionsBlock(verb, FIXTURE_VERBS[verb]) }])
  )
})

/** An exec stub over a green account, recording every command it is asked for.
 *  A command the doctor issues that the table does not name answers code 127,
 *  so it surfaces as a red row rather than a silent default. */
function makeExec (overrides = {}) {
  const calls = []
  const table = { ...GREEN(), ...overrides }
  const exec = async (cmd) => {
    calls.push(cmd)
    return table[cmd] ?? { code: 127, stdout: `unstubbed command: ${cmd}\n` }
  }
  return { exec, calls }
}

/** The config the file's two read keys carry in every case below. */
const CONFIG = { cpu: '8', memory: '16GB' }

/** Run the doctor over the green account with `overrides` applied to the exec
 *  table and `opts` spread onto the call, and answer the result plus the
 *  command log. An option this helper is not given is left out entirely, so
 *  "the option not given" is really an absent option. */
async function run ({ overrides = {}, ...opts } = {}) {
  const { exec, calls } = makeExec(overrides)
  const result = await doctor({ config: { ...CONFIG }, exec, target: null, verbsPath: RECORD, ...opts })
  return { result, calls }
}

/** The same run with the listing carrying the renderer's own object. */
const withRenderListing = (opts = {}) =>
  run({ overrides: { [CMD.list]: { code: 0, stdout: listing(RENDER_CATALOG()) } }, ...opts })

const rowById = (result, id) => result.rows.find((r) => r.id === id)
// `render` was the last row until the hub's `kata` row was appended after it,
// so the row this file is about is fetched by id rather than by position.
const renderRow = (result) => rowById(result, 'render')
const statusOf = (result) => Object.fromEntries(result.rows.map((r) => [r.id, r.status]))

/** M1: the rows, in the order the doctor reports them. `render` is the eighth,
 *  and the hub's `kata` row was appended after it. */
const EXPECTED_IDS = [
  'exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'verb-drift', 'render',
  'kata'
]
const RENDER_AT = EXPECTED_IDS.indexOf('render')

/** M2: the status map of a healthy fleet — the green fixture passes no
 *  `render`, which is the "not configured" green. */
const ALL_OK = Object.freeze({
  'exe-dev': 'ok',
  capacity: 'ok',
  claude: 'ok',
  accounts: 'ok',
  github: 'ok',
  integrations: 'ok',
  'verb-drift': 'ok',
  render: 'ok',
  kata: 'ok'
})

/** ALL_OK with one row reddened. */
const allOkBut = (id) => ({ ...ALL_OK, [id]: 'missing' })

// ── fixtures on disk ─────────────────────────────────────────────────────────

/** Write `text` to a fresh file under the fixture root and answer its path. */
function fixture (name, text) {
  const p = path.join(ROOT, name)
  fs.writeFileSync(p, text)
  return p
}

/** M3: the file the walk's `## render` section writes — the two read keys, and
 *  the `render` object beside them. */
const RENDER_FILE = fixture(
  'render.json',
  JSON.stringify({ cpu: '8', memory: '16GB', render: { ...RENDER_KEY } })
)

/** The same file without the key: a fleet that named no renderer. */
const NO_RENDER_FILE = fixture('no-render.json', '{"cpu":"8","memory":"16GB"}')

const ABSENT = path.join(ROOT, 'absent.json')
assert.equal(fs.existsSync(ABSENT), false, '0 fixture: the absent config path starts absent')

// ── 1. M1 / leg (a) — the eight ids, in order ────────────────────────────────

{
  // leg (a): `[...ROW_IDS]` deep-equals the ids in order — `render` eighth,
  // after `verb-drift`.
  assert.deepEqual([...ROW_IDS], EXPECTED_IDS, '1 [M1 leg a] ROW_IDS is the ids in order')
  assert.equal(ROW_IDS[RENDER_AT], 'render', '1 [M1 leg a] render is the eighth id')
  assert.equal(ROW_IDS[RENDER_AT - 1], 'verb-drift', '1 [M1 leg a] and it follows verb-drift')

  // leg (a): a green doctor's `result.rows.map(id)` is that same list.
  const { result } = await run()
  assert.deepEqual(
    result.rows.map((r) => r.id),
    EXPECTED_IDS,
    '1 [M1 leg a] a green doctor answers the rows in ROW_IDS order'
  )

  // `FIXES` derives from `ROW_IDS`, so the new row's fix is its own `## `
  // heading in references/first-run.md, like every other row's.
  for (const r of result.rows) {
    assert.equal(r.fix, r.id, `1 [M1] ${r.id}'s fix is its own first-run.md heading`)
    assert.ok(['ok', 'missing'].includes(r.status), `1 [M1] ${r.id}'s status is ok or missing`)
    assert.equal(typeof r.detail, 'string', `1 [M1] ${r.id} carries a detail string`)
    assert.ok(r.detail.length > 0, `1 [M1] ${r.id}'s detail says something`)
  }
}

// ── 2. M2 / leg (b) — the render row ─────────────────────────────────────────

{
  // leg (b): with no `render` option the LAST row is `{ id: 'render', status:
  // 'ok' }` and its detail begins `not configured` — a fleet that named no
  // renderer is green, because the doctor has two row states and `verdict` is
  // every row `ok`.
  const { result } = await run()
  const render = renderRow(result)
  assert.equal(render.id, 'render', '2 [M2 leg b] the render row is answered last')
  assert.equal(
    render.status,
    'ok',
    `2 [M2 leg b] no render option is a green row; got ${render.status} — ${render.detail}`
  )
  assert.equal(render.fix, 'render', '2 [M2 leg b] the row\'s fix is render')
  assert.ok(
    render.detail.startsWith('not configured'),
    `2 [M2 leg b] the detail begins "not configured"; got ${render.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '2 [M2 leg b] a fleet with no renderer reddens no row')
  assert.equal(result.verdict, 'ready', '2 [M2 leg b] a fleet with no renderer is a ready fleet')
}

{
  // leg (b): `render: null` passed explicitly is the same row as the absent
  // option — same status, same detail.
  const { result: absent } = await run()
  const { result } = await run({ render: null })
  const render = renderRow(result)
  assert.equal(render.id, 'render', '2 [M2 leg b] render: null still answers the render row last')
  assert.equal(
    render.status,
    'ok',
    `2 [M2 leg b] render: null is a green row; got ${render.status} — ${render.detail}`
  )
  assert.ok(
    render.detail.startsWith('not configured'),
    `2 [M2 leg b] render: null's detail begins "not configured"; got ${render.detail}`
  )
  assert.equal(
    render.detail,
    renderRow(absent).detail,
    `2 [M2 leg b] render: null answers the same detail as the absent option; got ${render.detail}`
  )
  assert.equal(result.verdict, 'ready', '2 [M2 leg b] render: null is a ready fleet')
}

{
  // leg (b): `render: { integration: 'browser-run', account: 'abc' }` against a
  // listing carrying an entry named `browser-run` is `ok`, and the detail names
  // the integration.
  const { result } = await withRenderListing({ render: { ...RENDER_KEY } })
  const render = renderRow(result)
  assert.equal(render.id, 'render', '2 [M2 leg b] the render row is still last')
  assert.equal(
    render.status,
    'ok',
    `2 [M2 leg b] a named integration the listing carries is ok; got ${render.status} — ${render.detail}`
  )
  assert.ok(
    render.detail.includes(RENDER_NAME),
    `2 [M2 leg b] the green detail names the integration; got ${render.detail}`
  )
  assert.equal(
    render.detail.startsWith('not configured'),
    false,
    `2 [M2 leg b] a configured renderer is not "not configured"; got ${render.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '2 [M2 leg b] a renderer at the edge reddens no row')
  assert.equal(result.verdict, 'ready', '2 [M2 leg b] a renderer at the edge is a ready fleet')
}

{
  // leg (b): the same option against a listing WITHOUT that entry — the green
  // catalog — is `missing`, its `fix` is `render`, and the detail names both the
  // integration and the file that named it.
  const { result } = await run({ render: { ...RENDER_KEY } })
  const render = renderRow(result)
  assert.equal(render.id, 'render', '2 [M2 leg b] the red render row is still last')
  assert.equal(
    render.status,
    'missing',
    `2 [M2 leg b] a named integration the listing lacks is missing; got ${render.status} — ${render.detail}`
  )
  assert.equal(render.fix, 'render', '2 [M2 leg b] the red row\'s fix is render')
  assert.ok(
    render.detail.includes(RENDER_NAME),
    `2 [M2 leg b] the red detail names the integration; got ${render.detail}`
  )
  assert.ok(
    render.detail.includes('~/.ultrapowers/fleet.json'),
    `2 [M2 leg b] the red detail names ~/.ultrapowers/fleet.json; got ${render.detail}`
  )
  assert.deepEqual(statusOf(result), allOkBut('render'), '2 [M2 leg b] the render row is the only one that moved')
  assert.equal(result.verdict, 'not-ready', '2 [M2 leg b] a renderer that is not there is not a ready fleet')
}

for (const [label, answer] of [
  ['a listing that is not JSON', { code: 0, stdout: 'not json at all\n' }],
  ['a listing read that exits 1', { code: 1, stdout: '' }]
]) {
  // leg (b) / M2: `render` given and a listing the doctor cannot read is
  // `missing` — the row cannot say the integration is there, so it does not.
  const { result } = await run({
    overrides: { [CMD.list]: answer },
    render: { ...RENDER_KEY }
  })
  const render = renderRow(result)
  assert.equal(render.id, 'render', `2 [M2 leg b] ${label} still answers the render row last`)
  assert.equal(
    render.status,
    'missing',
    `2 [M2 leg b] ${label} turns the render row red; got ${render.status} — ${render.detail}`
  )
  assert.ok(render.detail.length > 0, `2 [M2 leg b] ${label} still says something`)
  assert.equal(result.verdict, 'not-ready', `2 [M2 leg b] ${label} is not a ready fleet`)
}

{
  // M2: an unreadable listing with NO `render` option is still the green
  // "not configured" row — the row reads the config first.
  const { result } = await run({ overrides: { [CMD.list]: { code: 0, stdout: 'not json at all\n' } } })
  const render = renderRow(result)
  assert.equal(
    render.status,
    'ok',
    `2 [M2] an unreadable listing without a render key is still green; got ${render.status} — ${render.detail}`
  )
  assert.ok(
    render.detail.startsWith('not configured'),
    `2 [M2] and its detail still begins "not configured"; got ${render.detail}`
  )
}

{
  // Context/M2: presence by name in the listing already parsed for the `claude`
  // and `integrations` rows is the whole of this row's check — the render row
  // issues no read of its own. (An http-proxy answers nothing useful to
  // `integrations test`.) The one command a configured renderer adds is the
  // `integrations` row's policy read of the renderer's object, which has to be
  // on tag:fleet like the other two: a run with it asks exactly the commands a
  // run without it asks, plus that one read.
  const { calls: bare } = await run()
  const { calls: configured } = await withRenderListing({ render: { ...RENDER_KEY } })
  const added = configured.filter((cmd) => !bare.includes(cmd))
  assert.deepEqual(
    added,
    [policyCmd(RENDER_NAME)],
    `2 [M2] a configured renderer adds exactly its policy read; got ${JSON.stringify(configured)}`
  )
  assert.deepEqual(
    configured.filter((cmd) => cmd !== policyCmd(RENDER_NAME)),
    bare,
    '2 [M2] and every other command is the same, in the same order'
  )

  // The renderer's object off the policy is the `integrations` row's red, and
  // the `render` row stays green: it answers presence, not reachability.
  const { result: offPolicy } = await withRenderListing({
    render: { ...RENDER_KEY },
    overrides: {
      [CMD.list]: { code: 0, stdout: listing(RENDER_CATALOG()) },
      [policyCmd(RENDER_NAME)]: policyAnswer(RENDER_NAME, 'vm:fleet-r7-2609032215-a1b2')
    }
  })
  assert.equal(rowById(offPolicy, 'render').status, 'ok', '2 [M2] the render row answers presence alone')
  assert.equal(rowById(offPolicy, 'integrations').status, 'missing', "2 [M2] the renderer's object off tag:fleet reddens integrations")
  assert.ok(
    rowById(offPolicy, 'integrations').detail.includes(`integrations policy set ${RENDER_NAME} 'tag:fleet' --permanent --if-revision=<revision>`),
    `2 [M2] naming the set for the renderer's object; got ${rowById(offPolicy, 'integrations').detail}`
  )
}

// ── 3. M3 / leg (c) — fleetConfigRender ──────────────────────────────────────

{
  // leg (c): the file's top-level `render` object, as `{ integration, account }`
  // — exactly those two keys, both strings.
  const answer = await fleetConfigRender({ path: RENDER_FILE })
  assert.deepEqual(
    answer,
    { integration: RENDER_NAME, account: RENDER_ACCOUNT },
    `3 [M3 leg c] fleetConfigRender answers { integration, account }; got ${JSON.stringify(answer)}`
  )
  assert.equal(typeof answer.integration, 'string', '3 [M3] integration is a string')
  assert.equal(typeof answer.account, 'string', '3 [M3] account is a string')
}

for (const [label, p] of [
  ['an absent path', ABSENT],
  ['a file of `not json`', fixture('not-json.json', 'not json\n')],
  ['a file of `[]`', fixture('empty-array.json', '[]')],
  ['a file of `{"cpu":"8"}`', fixture('cpu-only.json', '{"cpu":"8"}')],
  ['a file of `{"render":{"integration":"x"}}`', fixture('render-no-account.json', '{"render":{"integration":"x"}}')],
  ['a file of `{"render":"x"}`', fixture('render-string.json', '{"render":"x"}')]
]) {
  // leg (c): null for an absent file, for text that is not JSON, for a JSON
  // value that is not an object, for a file with no `render`, and for a `render`
  // that lacks either string.
  assert.equal(
    await fleetConfigRender({ path: p }),
    null,
    `3 [M3 leg c] ${label} answers null`
  )
}

for (const [label, body] of [
  ['a render whose account is not a string', '{"render":{"integration":"browser-run","account":3}}'],
  ['a render whose integration is not a string', '{"render":{"integration":3,"account":"abc"}}'],
  ['a render with neither key', '{"render":{}}'],
  ['a render that is an array', '{"render":[]}']
]) {
  // M3: `render` lacking either string is null, whichever of the two it lacks.
  assert.equal(
    await fleetConfigRender({ path: fixture(`${label.replace(/\W+/g, '-')}.json`, body) }),
    null,
    `3 [M3] ${label} answers null`
  )
}

{
  // leg (c): `render` never appears in `result.config` — the envelope stays
  // exactly the two keys `loadFleetConfig` answers, the way `account` does.
  const { result } = await withRenderListing({ render: { ...RENDER_KEY } })
  assert.deepEqual(
    { ...result.config },
    CONFIG,
    `3 [M3 leg c] render never reaches result.config; got ${JSON.stringify(result.config)}`
  )
  assert.deepEqual(
    Object.keys(result.config).sort(),
    ['cpu', 'memory'],
    `3 [M3 leg c] result.config has exactly the keys cpu and memory; got ${JSON.stringify(result.config)}`
  )
}

// ── 4. M4 / leg (d) — CONFIG_KEYS accepts render ─────────────────────────────

/** The `capacity` detail the pool row answers for this pool and this config:
 *  the pool, then what one run asks for. */
const BASE_DETAIL = 'XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB'

{
  // leg (d): `configKeys: ['cpu','memory','account','render']` leaves the
  // `capacity` row `ok`, with no `keys nothing reads` in its detail — `render`
  // is a key something reads.
  const { result } = await run({ configKeys: ['cpu', 'memory', 'account', 'render'] })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `4 [M4 leg d] render beside cpu, memory and account leaves capacity ok; got ${capacity.status} — ${capacity.detail}`
  )
  assert.equal(
    capacity.detail.includes('keys nothing reads'),
    false,
    `4 [M4 leg d] the detail carries no "keys nothing reads"; got ${capacity.detail}`
  )
  assert.equal(
    capacity.detail,
    BASE_DETAIL,
    `4 [M4 leg d] the detail is the pool sentence alone; got ${capacity.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '4 [M4 leg d] the render key reddens no row')
  assert.equal(result.verdict, 'ready', '4 [M4 leg d] a file carrying the four keys is a ready fleet')
}

{
  // leg (d): a key outside the four still turns the row `missing`, with a detail
  // keeping the phrase `keys nothing reads`, naming the stale key, and naming
  // each of `cpu`, `memory`, `account` and `render` as what is read.
  const { result } = await run({ configKeys: ['cpu', 'memory', 'render', 'stale'] })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `4 [M4 leg d] a key outside the four turns capacity red; got ${capacity.status} — ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('keys nothing reads'),
    `4 [M4 leg d] the red detail keeps the phrase "keys nothing reads"; got ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('stale'),
    `4 [M4 leg d] the red detail names the key nothing reads; got ${capacity.detail}`
  )
  for (const key of ['cpu', 'memory', 'account', 'render']) {
    assert.ok(
      capacity.detail.includes(key),
      `4 [M4 leg d] the red detail names ${key} as a key something reads; got ${capacity.detail}`
    )
  }
  assert.equal(capacity.fix, 'capacity', '4 [M4 leg d] the red row\'s fix is capacity')
  assert.ok(
    capacity.detail.includes(BASE_DETAIL),
    `4 [M4 leg d] the red detail still carries the pool sentence; got ${capacity.detail}`
  )
  assert.equal(result.verdict, 'not-ready', '4 [M4 leg d] a key nothing reads is not a ready fleet')
}

// ── 5. M5 / leg (e) — renderRows prints the eighth row ───────────────────────

assert.equal(typeof renderRows, 'function', '5 [M5] fleet/doctor.mjs exports renderRows')

{
  // leg (e): `renderRows` of a result whose rows are ROW_IDS prints `render` on
  // the EIGHTH line. A green run prints one line per row and no fix line, so
  // that line is the render row's own.
  const { result } = await run()
  assert.deepEqual(result.rows.map((r) => r.id), EXPECTED_IDS, '5 [M5 leg e] the result carries the rows')
  const lines = renderRows(result.rows).split('\n')
  assert.equal(lines.length, EXPECTED_IDS.length, `5 [M5 leg e] a green run prints one line per row; got:\n${lines.join('\n')}`)
  const line = lines[RENDER_AT]
  assert.equal(
    line.trim().split(/\s+/)[1],
    'render',
    `5 [M5 leg e] the eighth printed line is the render row's; got ${line}`
  )
  assert.ok(line.startsWith('ok'), `5 [M5 leg e] the green render line opens with its status; got ${line}`)
  assert.ok(
    line.includes('not configured'),
    `5 [M5 leg e] the green render line carries its detail; got ${line}`
  )
  // The row before it is verb-drift's: the eighth row prints after the seventh.
  assert.equal(
    lines[RENDER_AT - 1].trim().split(/\s+/)[1],
    'verb-drift',
    `5 [M5 leg e] render prints after verb-drift; got ${lines[RENDER_AT - 1]}`
  )
}

{
  // leg (e): a `missing` render row prints the
  // `→ references/first-run.md §render` pointer on the line under it.
  const { result } = await run({ render: { ...RENDER_KEY } })
  assert.equal(renderRow(result).status, 'missing', '5 [M5 leg e] the fixture\'s render row is red')
  const lines = renderRows(result.rows).split('\n')
  const pointer = lines[RENDER_AT + 1]
  assert.ok(
    pointer.includes('→ references/first-run.md §render'),
    `5 [M5 leg e] a red render row points at its first-run.md heading; got ${pointer}`
  )
  assert.equal(
    lines[RENDER_AT].trim().split(/\s+/)[1],
    'render',
    `5 [M5 leg e] the pointer sits under the render row; got ${lines[RENDER_AT]}`
  )
  assert.equal(
    lines.length,
    EXPECTED_IDS.length + 1,
    `5 [M5 leg e] one red row is one extra line; got:\n${lines.join('\n')}`
  )
}

// ── 6. M5 / leg (f) — the CLI, against a PATH shim ───────────────────────────

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

/** The listing the shim prints: the bearer, the target object, and the
 *  renderer's own object — the six reads leg (f) names, answered off a shim
 *  rather than off exe.dev. */
const CATALOG_JSON = JSON.stringify({ integrations: RENDER_CATALOG() })
const BILLING_JSON = JSON.stringify(BILLING)

// The `ssh` shim answers no `help <verb>` read: under it every help read exits
// 1, which is a finding in a green `verb-drift` row and never a refusal, so the
// runs below are still ready when nothing else is wrong.
const GREEN_DIR = shimDir('green', {
  ssh: `#!/bin/sh
case "$*" in
  *whoami*) echo marcus ;;
  *"billing plan"*) echo '${BILLING_JSON}' ;;
  *"integrations list"*) echo '${CATALOG_JSON}' ;;
  *"integrations policy get claude-max"*) echo '${policyJson('claude-max').trim()}' ;;
  *"integrations policy get ${RENDER_NAME}"*) echo '${policyJson(RENDER_NAME).trim()}' ;;
  *"integrations policy get kata"*) echo '${policyJson('kata').trim()}' ;;
  *"ls kata-hub"*) echo '${kataVms().trim()}' ;;
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
  // The shim dir first on PATH and nothing of the box behind it, and a HOME of
  // this call's own, so the CLI never reads the box's ~/.ultrapowers/fleet.json.
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], {
    encoding: 'utf8', env: simEnv({ bin: dir }), timeout: 60000,
  })
}

{
  // leg (f): the CLI over a fixture carrying `render`, under a shim whose
  // listing carries `browser-run`, prints a JSON whose rows END with
  // `{ id: 'render', status: 'ok', … }`.
  const res = runCli(['--json', '--config', RENDER_FILE], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    0,
    `6 [M5 leg f] a fleet.json naming a renderer that exists exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  assert.deepEqual(
    parsed.rows.map((r) => r.id),
    EXPECTED_IDS,
    `6 [M5 leg f] the printed envelope carries the rows in order; got ${res.stdout}`
  )
  const render = parsed.rows[RENDER_AT]
  assert.equal(render.id, 'render', `6 [M5 leg f] the printed rows carry the render row eighth; got ${res.stdout}`)
  assert.equal(
    render.status,
    'ok',
    `6 [M5 leg f] the printed render row is ok; got ${JSON.stringify(render)}`
  )
  assert.ok(
    render.detail.includes(RENDER_NAME),
    `6 [M5 leg f] the printed detail names the integration; got ${render.detail}`
  )
  assert.equal(parsed.verdict, 'ready', '6 [M5 leg f] a renderer that exists is a ready fleet')

  // M4: the `render` key in the file is not a key nothing reads.
  const capacity = parsed.rows.find((r) => r.id === 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `6 [M4 leg f] the render key leaves capacity ok; got ${capacity.status} — ${capacity.detail}`
  )

  // M3: and it never travels into the printed `.config`.
  assert.deepEqual(
    parsed.config,
    CONFIG,
    `6 [M3 leg f] the CLI's .config is still exactly the two keys; got ${res.stdout}`
  )
}

{
  // leg (f): the same run against a fixture WITHOUT `render` ends with a render
  // row whose detail begins `not configured` — the CLI path reads the key, and
  // the difference between the two runs is the file.
  const res = runCli(['--json', '--config', NO_RENDER_FILE], { dir: GREEN_DIR })
  assert.equal(
    res.status,
    0,
    `6 [M5 leg f] a fleet.json naming no renderer exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  const parsed = JSON.parse(res.stdout)
  const render = parsed.rows[RENDER_AT]
  assert.equal(render.id, 'render', `6 [M5 leg f] the printed rows carry the render row eighth; got ${res.stdout}`)
  assert.equal(
    render.status,
    'ok',
    `6 [M5 leg f] a fleet that named no renderer is green; got ${JSON.stringify(render)}`
  )
  assert.ok(
    render.detail.startsWith('not configured'),
    `6 [M5 leg f] the printed detail begins "not configured"; got ${render.detail}`
  )
  assert.equal(parsed.verdict, 'ready', '6 [M5 leg f] a fleet that named no renderer is a ready fleet')
}

// ── 7. M1, M2 / leg (g) — the walk's section ─────────────────────────────────

/** `sed -n '/<start>/,/<end>/p'`, in JS: the half-open line range from the first
 *  match of `start` through the first following match of `end`. `end` null runs
 *  to the end of the file; `start` null starts at line 1. Null when the span
 *  does not exist at all. */
function span (lines, start, end) {
  const from = start === null ? 0 : lines.findIndex((line) => start.test(line))
  if (from === -1) return null
  if (end === null) return [from, lines.length]
  const rest = lines.slice(from + 1).findIndex((line) => end.test(line))
  return [from, rest === -1 ? lines.length : from + 1 + rest + 1]
}

/** The span's text, joined by spaces the way the Proof's `tr '\n' ' '` joins it
 *  — so a phrase that straddles a line wrap is still found. */
const textOf = (lines, range) => (range === null ? '' : lines.slice(range[0], range[1]).join(' '))

const FIRST_RUN_LINES = fs.readFileSync(FIRST_RUN, 'utf8').split('\n')

{
  // leg (g) [M1]: the walk's `## ` headings are exactly ROW_IDS, in that order —
  // `render` the eighth of them. This is the agreement
  // tests/test_docs_agree_with_code.py reads.
  const headings = FIRST_RUN_LINES
    .filter((line) => /^## /.test(line))
    .map((line) => line.slice(3).trim())
  assert.equal(
    headings.length,
    ROW_IDS.length,
    `7 [M1 leg g] first-run.md has one ## heading per row; got ${JSON.stringify(headings)}`
  )
  assert.deepEqual(
    headings,
    [...ROW_IDS],
    `7 [M1 leg g] first-run.md's ## headings are ROW_IDS, in order; got ${JSON.stringify(headings)}`
  )
  assert.equal(headings[RENDER_AT], 'render', '7 [M1 leg g] ## render is the eighth section')
  assert.equal(headings[RENDER_AT - 1], 'verb-drift', '7 [M1 leg g] and it follows ## verb-drift')

  // The opening paragraph no longer says the doctor answers seven rows.
  const head = textOf(FIRST_RUN_LINES, span(FIRST_RUN_LINES, null, /^## exe-dev/))
  assert.equal(
    head.includes('seven rows'),
    false,
    `7 [M1 leg g] the opening no longer says seven rows; got:\n${head}`
  )
}

{
  // leg (g) [M2]: the `## render` section — the last — names the http-proxy
  // shape, the stdin bearer, the config key and the proxy URL, IN THAT ORDER.
  // The four needles and their order are the Proof's own scoped grep over
  // `sed -n '/^## render/,$p'`.
  const range = span(FIRST_RUN_LINES, /^## render/, null)
  assert.notEqual(range, null, '7 [M2 leg g] first-run.md has a ## render section at all')
  const text = textOf(FIRST_RUN_LINES, range)

  const NEEDLES = ['http-proxy', '--bearer -', 'fleet.json', 'browser-run.int.exe.xyz']
  let at = -1
  for (const needle of NEEDLES) {
    const found = text.indexOf(needle, at + 1)
    assert.notEqual(
      found,
      -1,
      `7 [M2 leg g] the ## render section names ${JSON.stringify(needle)} after the one before it; got:\n${text}`
    )
    assert.ok(
      found > at,
      `7 [M2 leg g] the ## render section names ${JSON.stringify(needle)} in order; got:\n${text}`
    )
    at = found
  }

  // …and the scoped grep is live rather than vacuous: redacting a needle inside
  // the section only is enough to lose it.
  for (const needle of NEEDLES) {
    const redacted = FIRST_RUN_LINES.map((line, i) =>
      i >= range[0] && i < range[1] ? line.split(needle).join('REDACTED') : line
    )
    assert.equal(
      textOf(redacted, span(redacted, /^## render/, null)).includes(needle),
      false,
      `7 [M2 leg g] the ## render grep is live: it misses ${JSON.stringify(needle)} when the section lacks it`
    )
  }
}

console.log('ALL TESTS PASSED')
