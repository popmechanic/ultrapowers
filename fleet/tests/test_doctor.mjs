/**
 * Exam for fleet/doctor.mjs — "do you have a fleet?", seven rows read off
 * exe.dev's own truth.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from. Groups 1–6b are
 * this file's BASE shape, extended for the two new rows; groups 7–11 are the new
 * clauses.
 *
 *   1  M1 / leg (a) — ROW_IDS, DOCTOR_DEFAULTS, the five BASE reads, the
 *      accounts read, the help read per recorded verb and nothing else, no
 *      `goldenScriptSha` export, node:-only imports, the two new exports.
 *   2  the capacity row, against the capacity task's own clauses (numbered
 *      afresh — the row reports the pool and what one run asks for, is green
 *      whenever it could read both, never says how many runs fit or that the
 *      pool cannot hold one, and is red only for an unreadable pool or an
 *      unparseable config).
 *   3  claude, from the listing's bearer and claude-token's status line.
 *   4  github, from `integrations setup github --list`.
 *   5  integrations, the tag, `--target`, the verdict, and a target that is
 *      refused before any read.
 *   6  the surviving surface — parseArgs/renderRows, --json, --config, the
 *      two-key config file, and exit code 0 iff ready.
 *   6b M1/M2/M3/M5/M7 / legs (a), (g), (i) — the CLI against a PATH shim.
 *   7  M2 / leg (b) — the `accounts` row.
 *   8  M4 / leg (d) — `verbDrift({ help, recordPath })`.
 *   9  M5 / leg (e) — the `verb-drift` row and the verdict it does not move.
 *  10  M6 / leg (f) — `fleet/exe-verbs.json`, read from disk.
 *  11  M7 / leg (h) — first-run.md's two new sections and its opening sentence.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub, and
 * the CLI leg drives it against a PATH shim (`ssh`, `node`, and the other
 * binaries the run's constraints ask a test to stub). The unit legs pass a
 * fixture record path, never the real `fleet/exe-verbs.json`. Nothing here opens
 * a socket and nothing here reaches exe.dev.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import * as doctorModule from '../doctor.mjs'
import { doctor, parseIntegrations, ROW_IDS, DOCTOR_DEFAULTS } from '../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')
const RECORD_SRC = path.join(FLEET_DIR, 'exe-verbs.json')
const FIRST_RUN = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'references', 'first-run.md')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'))

// ── Shared literals ──────────────────────────────────────────────────────────

/** M1: the seven rows, in the order the doctor reports them. */
const EXPECTED_IDS = ['exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'verb-drift']

/** M1: the reads, in the order M1 lists them — the five BASE reads, then the
 *  accounts read, then one `help <verb>` per verb of the record in the record's
 *  key order. `<dir>` is the doctor's own directory, so both claude-token reads
 *  are an absolute path beside doctor.mjs. */
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

/** The five BASE reads, in BASE's order — M1 keeps them first and unchanged. */
const BASE_READS = [CMD.whoami, CMD.billing, CMD.list, CMD.github, CMD.token]

// ── the fixture record the unit legs read ────────────────────────────────────
//
// M1/M4: two verbs, not the twelve, so the stub table stays small. The real
// `fleet/exe-verbs.json` is read only by group 10 and by the CLI leg, which runs
// the real doctor against the real file beside it.

const FIXTURE_CAPTURED = '2026-09-05'
const FIXTURE_VERBS = { new: ['--json', '--name', '--pool'], rm: ['--force', '--json'] }
const FIXTURE_NAMES = Object.keys(FIXTURE_VERBS)

/** Write a record to a fresh path under the fixture root and answer that path. */
function recordFixture (name, body) {
  const p = path.join(ROOT, name)
  fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  return p
}

const RECORD = recordFixture('two-verb.json', { capturedAt: FIXTURE_CAPTURED, verbs: FIXTURE_VERBS })

const HELP_READS = FIXTURE_NAMES.map(helpCmd)

/** M1 leg (a): the whole ordered list of reads a green run over the fixture
 *  record issues, and the only commands it ever runs. (BASE's `FIVE_READS`.) */
const ALL_READS = [...BASE_READS, CMD.accounts, ...HELP_READS]

/** M4: what `help <verb>` prints — a `Command:` line, a description, an
 *  `Options:` block whose lines are two spaces, the flag, spaces, its
 *  description. The live flag set is every `^\s+(--[A-Za-z0-9-]+)`. */
const optionsBlock = (verb, flags) =>
  `Command: ${verb}\n` +
  `Does the ${verb} thing.\n` +
  'Options:\n' +
  `${flags.map((f) => `  ${f}  what it does`).join('\n')}\n`

/** M4: the lobby's answer for a verb it does not recognise — exit 0, and a
 *  stdout carrying no flag at all. */
const NO_HELP = 'No help available for unrecognized command: zzz\n'

const TARGET = 'popmechanic/ultrapowers'
const ghName = (target) => `gh-${String(target).replace(/\//g, '-')}`
const GH = ghName(TARGET)

/** The legacy runs integration, assembled rather than spelled out: this run's
 *  constraints forbid that literal anywhere under `fleet/`, while M5 still asks
 *  the doctor to report it when it rides the tag. */
const LEGACY_RUNS = ['fleet', 'runs'].join('-')

/** Measured on the live account: `claude-max`'s config_summary. */
const CLAUDE_SUMMARY = 'target=https://api.anthropic.com header=Authorization:Bearer ***'

/** claude-token's status line when the keychain holds a record. */
const STATUS_LINE = 'access token expires 2026-09-04T18:20:00Z (37 min)'

/** M2: the shape `node fleet/claude-token.mjs accounts --json` prints. */
const FRESH_AT = '2026-09-05T20:00:00.000Z'
const EXPIRED_AT = '2026-09-01T10:00:00.000Z'
const ACCOUNT_ONE = { name: 'ultrapowers', expiresAt: FRESH_AT, fresh: true }
const ACCOUNT_TWO = { name: 'b', expiresAt: EXPIRED_AT, fresh: false }
const ACCOUNTS_ONE = [ACCOUNT_ONE]
const ACCOUNTS_TWO = [ACCOUNT_ONE, ACCOUNT_TWO]
const accountsJson = (entries) => `${JSON.stringify(entries)}\n`

/** M2: the comment the credential tool sets on `claude-max` at every install,
 *  and the prose comment the live entry carries instead today. */
const EDGE_COMMENT = 'account=ultrapowers'
const PROSE_COMMENT = 'the subscription proxy, do not detach'

const listing = (entries) => `${JSON.stringify({ integrations: entries })}\n`

const claudeMax = (over = {}) => ({
  name: 'claude-max',
  type: 'http-proxy',
  attachments: null,
  comment: EDGE_COMMENT,
  config_summary: CLAUDE_SUMMARY,
  ...over
})

const ghObject = (target, over = {}) => ({
  name: ghName(target),
  type: 'github',
  attachments: null,
  config: { repositories: [target], installation_id: 4711, act_as_user: true },
  ...over
})

/** A healthy account: the bearer, and one target object on no tag. */
const GREEN_CATALOG = () => [claudeMax(), ghObject(TARGET)]

const billing = (over = {}) =>
  `${JSON.stringify({ max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'team', ...over })}\n`

const GITHUB_LISTING = 'GitHub accounts:\n  popmechanic\n'

const GREEN = () => ({
  [CMD.whoami]: { code: 0, stdout: 'marcus\n' },
  [CMD.billing]: { code: 0, stdout: billing() },
  [CMD.list]: { code: 0, stdout: listing(GREEN_CATALOG()) },
  [CMD.github]: { code: 0, stdout: GITHUB_LISTING },
  [CMD.token]: { code: 0, stdout: `${STATUS_LINE}\n` },
  [CMD.accounts]: { code: 0, stdout: accountsJson(ACCOUNTS_ONE) },
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

const rowById = (result, id) => result.rows.find((r) => r.id === id)

/** Run the doctor over a green account with `overrides` applied, and answer the
 *  whole result plus the command log. The fixture record is the default
 *  `verbsPath`, so no unit leg here reads the real `fleet/exe-verbs.json`. */
async function run (overrides = {}, opts = {}) {
  const { exec, calls } = makeExec(overrides)
  const result = await doctor({
    config: opts.config,
    exec,
    target: opts.target ?? null,
    configKeys: opts.configKeys ?? null,
    account: opts.account ?? null,
    verbsPath: 'verbsPath' in opts ? opts.verbsPath : RECORD
  })
  return { result, calls }
}

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

/** ALL_OK with one row reddened. */
const allOkBut = (id) => ({ ...ALL_OK, [id]: 'missing' })

// ── 1. M1 — the rows, the defaults, the reads, the exports ───────────────────

{
  // leg (a): ROW_IDS deep-equals the seven ids in order.
  assert.deepEqual([...ROW_IDS], EXPECTED_IDS, '1 [M1 leg a] ROW_IDS is the seven ids in order')

  // leg (a): DOCTOR_DEFAULTS deep-equals the config literal. lobby.mjs's
  // FLEET_DEFAULTS is byte-identical to it; two readers of one config file that
  // disagree about a default would certify a fleet the launcher never looks at.
  assert.deepEqual(
    { ...DOCTOR_DEFAULTS },
    { cpu: '8', memory: '16GB' },
    "1 [M1 leg a] DOCTOR_DEFAULTS is { cpu: '8', memory: '16GB' }"
  )

  // M3: the doctor still reads exactly two keys — `account` reaches doctor() as
  // its own option, and never through the config.
  assert.deepEqual(
    Object.keys(DOCTOR_DEFAULTS).sort(),
    ['cpu', 'memory'],
    '1 [M3] DOCTOR_DEFAULTS still has exactly the two keys cpu and memory'
  )
}

{
  // leg (a): a green run's command log is exactly the five BASE reads, then the
  // accounts read, then one help read per fixture verb in record order, with
  // nothing else — no golden read, no probe, no write.
  const { result, calls } = await run()
  assert.deepEqual(calls, ALL_READS, '1 [M1 leg a] a green run issues exactly the reads M1 names, in order')
  assert.equal(result.verdict, 'ready', `1 [M1] the green account is ready; got ${JSON.stringify(statusOf(result))}`)

  // leg (a): the help reads are `help <verb>`, not `<verb> --help` — the latter
  // is matched by the mutating-verb regex every launch exam applies.
  for (const cmd of calls) {
    assert.equal(/--help/.test(cmd), false, `1 [M1 leg a] no read is a --help read; got ${cmd}`)
  }

  const { calls: targeted } = await run({}, { target: TARGET })
  assert.deepEqual(targeted, ALL_READS, '1 [M1 leg a] --target adds no read')

  // Nothing in a run creates, copies or removes anything: twice over is the
  // same list again.
  const { exec, calls: twice } = makeExec()
  await doctor({ exec, verbsPath: RECORD })
  await doctor({ exec, verbsPath: RECORD })
  assert.deepEqual(twice, [...ALL_READS, ...ALL_READS], '1 [M1 leg a] the doctor is a read, twice over')
}

{
  // leg (a): the shape of the envelope and of every row.
  const { result } = await run()
  assert.ok(result && typeof result === 'object', '1 doctor resolves an object')
  assert.deepEqual(result.rows.map((r) => r.id), EXPECTED_IDS, '1 [M1] the rows come back in ROW_IDS order')
  assert.deepEqual({ ...result.config }, { ...DOCTOR_DEFAULTS }, '1 the envelope echoes the config it ran against')
  for (const r of result.rows) {
    assert.ok(['ok', 'missing'].includes(r.status), `1 ${r.id}'s status is ok or missing`)
    assert.equal(typeof r.detail, 'string', `1 ${r.id} carries a detail string`)
    assert.ok(r.detail.length > 0, `1 ${r.id}'s detail says something`)
    // FIXES is derived from ROW_IDS — each row's fix is its own `## ` heading
    // in references/first-run.md.
    assert.equal(r.fix, r.id, `1 ${r.id}'s fix is its own first-run.md heading`)
  }
}

{
  // leg (a): the module exports no `goldenScriptSha`, does export the four BASE
  // symbols, and exports the two this task produces beside them.
  assert.equal(
    Object.keys(doctorModule).includes('goldenScriptSha'),
    false,
    '1 [M1 leg a] fleet/doctor.mjs exports no goldenScriptSha'
  )
  assert.equal(doctorModule.goldenScriptSha, undefined, '1 [M1 leg a] goldenScriptSha is gone, not renamed in place')
  for (const name of ['ROW_IDS', 'DOCTOR_DEFAULTS', 'doctor', 'parseIntegrations', 'verbDrift', 'fleetConfigAccount']) {
    assert.ok(Object.keys(doctorModule).includes(name), `1 [M1 leg a] fleet/doctor.mjs exports ${name}`)
  }
  assert.equal(typeof doctorModule.verbDrift, 'function', '1 [M1 leg a] verbDrift is a function')
  assert.equal(typeof doctorModule.fleetConfigAccount, 'function', '1 [M1 leg a] fleetConfigAccount is a function')
  assert.equal(typeof parseIntegrations, 'function', '1 parseIntegrations is a function')
  assert.ok(parseIntegrations(listing(GREEN_CATALOG())), '1 parseIntegrations reads a listing')
  assert.ok(!parseIntegrations('not json at all'), '1 parseIntegrations refuses what is not JSON')
}

{
  // leg (a): every import specifier in the file starts with `node:` — the
  // doctor runs from an installed plugin cache where no node_modules under
  // fleet/ has ever existed, and it imports no other fleet module.
  const IMPORT_RE = /^\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
  const offenders = (source) => {
    const specs = []
    for (const m of source.matchAll(IMPORT_RE)) specs.push(m[1])
    return specs.filter((s) => !s.startsWith('node:'))
  }

  const source = fs.readFileSync(DOCTOR_SRC, 'utf8')
  assert.deepEqual(offenders(source), [], '1 [M1 leg a] every import specifier in fleet/doctor.mjs is node:-prefixed')

  // The extractor is live, not vacuous: one added bare import shows up, and so
  // does one added sibling fleet module.
  assert.deepEqual(
    offenders(`${source}\nimport fs2 from 'fs'\nimport { x } from './lobby.mjs'\n`),
    ['fs', './lobby.mjs'],
    '1 the import extractor catches a non-node: specifier when one is added'
  )
}

// ── 2. capacity — the pool, the ask, and never a count ───────────────────────
//
// The clause and leg names in this group are the capacity task's own, not this
// task's: its M1 pins the green sentence, M2 the readable-but-smaller pools, M3
// the absence of a count and of a refusal, M4 the two things still red.

/** M1: the sentence the doctor answers for the green pool (tier XLarge, 16 vCPU
 *  / 64GB) and the doctor's own defaults (cpu `8`, memory `16GB`) — the pool,
 *  then what one run asks for, and nothing after it. */
const POOL_AND_ASK = 'XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB'

/** M3: a count and a refusal, as the two substrings a detail and the doctor's
 *  own source are read for. Allocation on exe.dev is over-committable, so the
 *  row reports two numbers and draws no conclusion from them. */
const FORBIDDEN = ['fits', 'cannot hold']

/** Every capacity detail M1 and M2 produce, collected for leg (c). */
const GREEN_DETAILS = []

{
  // leg (a) [M1]: the green pool against the defaults is `ok`, and the detail is
  // asserted EQUAL to the pool-and-ask sentence — not merely including it, so a
  // row that appended a count would fail here.
  const { result } = await run()
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `2 [M1 leg a] a readable pool and a readable config is ok; got ${capacity.status} — ${capacity.detail}`
  )
  assert.equal(capacity.detail, POOL_AND_ASK, '2 [M1 leg a] the detail is exactly the pool and the ask')
  GREEN_DETAILS.push(capacity.detail)
}

for (const [label, over, expected] of [
  ['a pool one vCPU short of the run', { max_cpus: 7 }, 'XLarge pool 7 vCPU / 64GB; a run asks 8 vCPU / 16GB'],
  ['a pool one GB short of the run', { max_memory_gb: 15 }, 'XLarge pool 16 vCPU / 15GB; a run asks 8 vCPU / 16GB']
]) {
  // leg (b) [M2]: a readable pool smaller than the run leaves the row `ok`, and
  // the detail is the same sentence carrying the pool it actually read.
  const { result } = await run({ [CMD.billing]: { code: 0, stdout: billing(over) } })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `2 [M2 leg b] ${label} leaves the row ok; got ${capacity.status} — ${capacity.detail}`
  )
  assert.equal(capacity.detail, expected, `2 [M2 leg b] ${label} reports the pool it read and the ask`)
  GREEN_DETAILS.push(capacity.detail)
}

{
  // leg (b) [M2]: a pool half the run's size is a green fleet — the row is `ok`,
  // no other row moved, and the verdict is `ready`.
  const { result } = await run({ [CMD.billing]: { code: 0, stdout: billing({ max_cpus: 4 }) } })
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `2 [M2 leg b] a 4 vCPU pool leaves the row ok; got ${capacity.status} — ${capacity.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '2 [M2 leg b] a 4 vCPU pool reddens no row')
  assert.equal(result.verdict, 'ready', '2 [M2 leg b] a pool smaller than the run is still a ready fleet')
  GREEN_DETAILS.push(capacity.detail)
}

{
  // leg (c) [M3]: no detail of the four rows above carries a count or a
  // refusal…
  assert.equal(GREEN_DETAILS.length, 4, '2 [M3 leg c] the four details of the two previous legs are all collected')
  for (const detail of GREEN_DETAILS) {
    for (const needle of FORBIDDEN) {
      assert.equal(
        detail.includes(needle),
        false,
        `2 [M3 leg c] the detail carries no ${JSON.stringify(needle)}; got ${detail}`
      )
    }
  }

  // …and neither does the doctor's own source, comments included — this run's
  // Global Constraints say so of the whole file.
  const source = fs.readFileSync(DOCTOR_SRC, 'utf8')
  for (const needle of FORBIDDEN) {
    assert.equal(
      source.includes(needle),
      false,
      `2 [M3] fleet/doctor.mjs carries no ${JSON.stringify(needle)} anywhere`
    )
  }
}

for (const [leg, label, overrides, opts] of [
  ['d', 'billing plan --json exiting 1', { [CMD.billing]: { code: 1, stdout: 'billing: not entitled\n' } }, {}],
  ['e', 'billing plan --json answering text that is not JSON', { [CMD.billing]: { code: 0, stdout: 'no plan for you\n' } }, {}],
  ['f', "a config whose cpu is 'x'", {}, { config: { cpu: 'x', memory: '16GB' } }],
  ['g', "a config whose memory is '1.5GB'", {}, { config: { cpu: '8', memory: '1.5GB' } }]
]) {
  // legs (d)–(g) [M4]: an unreadable pool and an unparseable config are the two
  // things the row is still red for, and each detail names the file an operator
  // would open — the doctor read something it could not believe, not a fleet
  // too small.
  const { result } = await run(overrides, opts)
  const capacity = rowById(result, 'capacity')
  assert.equal(
    capacity.status,
    'missing',
    `2 [M4 leg ${leg}] ${label} turns capacity red; got ${capacity.status} — ${capacity.detail}`
  )
  assert.ok(
    capacity.detail.includes('fleet.json'),
    `2 [M4 leg ${leg}] the detail names fleet.json; got ${capacity.detail}`
  )
}

// ── 3. claude ────────────────────────────────────────────────────────────────

{
  // claude-max carrying the bearer in config_summary, on no tag, with
  // claude-token answering its status line.
  const { result } = await run()
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 a bearer in config_summary is ok; got ${claude.detail}`)
  assert.ok(
    claude.detail.includes(STATUS_LINE),
    `3 the detail carries claude-token's status line; got ${claude.detail}`
  )
}

{
  // The same bearer read off `config.headers[]` instead.
  const catalog = [
    claudeMax({ config_summary: undefined, config: { headers: ['Authorization:Bearer ***'] } }),
    ghObject(TARGET)
  ]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 a bearer in config.headers is ok; got ${claude.detail}`)
}

{
  // An empty keychain leaves the status alone and only changes the detail — the
  // bearer is injected at the edge either way.
  const { result } = await run({
    [CMD.token]: { code: 1, stdout: 'no record in the keychain\n' }
  })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 an empty keychain does not turn claude red; got ${claude.detail}`)
  assert.ok(claude.detail.includes('keychain'), `3 the detail names the keychain; got ${claude.detail}`)
}

for (const [label, catalog] of [
  ['claude-max is absent', [ghObject(TARGET)]],
  ['claude-max carries no bearer', [claudeMax({ config_summary: 'target=https://api.anthropic.com' }), ghObject(TARGET)]]
]) {
  // No bearer at the edge is missing, and names the login command.
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'missing', `3 ${label} turns claude red`)
  assert.ok(
    claude.detail.includes('claude-token.mjs login'),
    `3 the detail names the login command; got ${claude.detail}`
  )
}

{
  // claude-max on tag:fleet is the subscription handed to every fleet VM for as
  // long as the object lives — red, naming the detach.
  const catalog = [claudeMax({ attachments: ['tag:fleet'] }), ghObject(TARGET)]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'missing', '3 claude-max on tag:fleet turns claude red')
  assert.ok(
    claude.detail.includes('integrations detach claude-max tag:fleet'),
    `3 the detail names the detach; got ${claude.detail}`
  )
}

// ── 4. github ────────────────────────────────────────────────────────────────

{
  // The two-line listing — a header and one indented account.
  const { result } = await run()
  const github = rowById(result, 'github')
  assert.equal(github.status, 'ok', `4 one account under the header is ok; got ${github.detail}`)
  assert.ok(
    github.detail.includes('popmechanic'),
    `4 the detail carries the accounts; got ${github.detail}`
  )
}

for (const [label, answer] of [
  ['the header with no names', { code: 0, stdout: 'GitHub accounts:\n' }],
  ['a listing that exits 1', { code: 1, stdout: 'integrations: not set up\n' }]
]) {
  // No account is missing, and names the browser step.
  const { result } = await run({ [CMD.github]: answer })
  const github = rowById(result, 'github')
  assert.equal(github.status, 'missing', `4 ${label} turns github red`)
  assert.ok(
    github.detail.includes('integrations setup github'),
    `4 the detail names the browser step; got ${github.detail}`
  )
}

// ── 5. integrations, and the verdict ─────────────────────────────────────────

for (const [label, extra, named] of [
  // Recognised by its declared type…
  [`${LEGACY_RUNS} on the tag`, { name: LEGACY_RUNS, type: 'github', attachments: ['tag:fleet'] }, LEGACY_RUNS],
  // …by the fleet's own naming when the listing says nothing else…
  ['a gh-x-y on the tag', { name: 'gh-x-y', attachments: ['tag:fleet'] }, 'gh-x-y'],
  // …or by its type under a name that says nothing.
  ['a github-typed themis on the tag', { name: 'themis', type: 'github', attachments: ['tag:fleet'] }, 'themis']
]) {
  // A tag attachment lands on every fleet VM, so any GitHub object on the tag
  // is red — with or without --target — and names the detach.
  const catalog = [...GREEN_CATALOG(), extra]
  const answer = { [CMD.list]: { code: 0, stdout: listing(catalog) } }

  for (const target of [null, TARGET]) {
    const { result } = await run(answer, { target })
    const row = rowById(result, 'integrations')
    const where = target === null ? 'without --target' : 'with --target'
    assert.equal(row.status, 'missing', `5 ${label} turns integrations red ${where}`)
    assert.ok(
      row.detail.includes(`integrations detach ${named} tag:fleet`),
      `5 the detail names the detach ${where}; got ${row.detail}`
    )
    assert.equal(result.verdict, 'not-ready', `5 ${label} is not a ready fleet ${where}`)
  }
}

{
  // --target with no object of its own is red, and names the command that
  // builds it.
  const { result } = await run({}, { target: 'popmechanic/smoke' })
  const row = rowById(result, 'integrations')
  assert.equal(row.status, 'missing', '5 --target with no gh-popmechanic-smoke turns the row red')
  assert.ok(
    row.detail.includes('gh-popmechanic-smoke'),
    `5 the detail names the missing object; got ${row.detail}`
  )
  assert.ok(
    row.detail.includes('node fleet/target.mjs popmechanic/smoke'),
    `5 the detail names the command that builds it; got ${row.detail}`
  )
}

{
  // The target's own object on the tag is red as well.
  const catalog = [claudeMax(), ghObject(TARGET, { attachments: ['tag:fleet'] })]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } }, { target: TARGET })
  const row = rowById(result, 'integrations')
  assert.equal(row.status, 'missing', "5 the target's own object on the tag turns the row red")
  assert.ok(
    row.detail.includes(`integrations detach ${GH} tag:fleet`),
    `5 the detail names the detach; got ${row.detail}`
  )
}

{
  // No GitHub object on the tag and the target's object unattached is ok — and
  // so is a fleet with no targets yet.
  const { result: targeted } = await run({}, { target: TARGET })
  assert.equal(
    rowById(targeted, 'integrations').status,
    'ok',
    `5 an unattached target object is ok; got ${rowById(targeted, 'integrations').detail}`
  )
  const { result: bare } = await run()
  assert.equal(rowById(bare, 'integrations').status, 'ok', '5 no --target asks for no target object')
}

{
  // The verdict is `ready` exactly when all seven rows are ok. Each scenario
  // below reddens exactly one row, and each is not-ready.
  const { result: green } = await run()
  assert.deepEqual(statusOf(green), ALL_OK, '5 the green account is seven ok rows')
  assert.equal(green.verdict, 'ready', '5 seven ok rows is a ready verdict')

  const scenarios = {
    'exe-dev': { [CMD.whoami]: { code: 1, stdout: '' } },
    // A pool smaller than the run is green now (group 2), so the one thing that
    // still reddens this row is a billing read the doctor cannot believe.
    capacity: { [CMD.billing]: { code: 1, stdout: '' } },
    claude: { [CMD.list]: { code: 0, stdout: listing([ghObject(TARGET)]) } },
    // M2: an accounts read the doctor cannot believe.
    accounts: { [CMD.accounts]: { code: 1, stdout: '' } },
    github: { [CMD.github]: { code: 1, stdout: '' } },
    integrations: {
      [CMD.list]: {
        code: 0,
        stdout: listing([...GREEN_CATALOG(), { name: 'themis', type: 'github', attachments: ['tag:fleet'] }])
      }
    }
  }
  for (const [id, overrides] of Object.entries(scenarios)) {
    const { result } = await run(overrides)
    assert.deepEqual(statusOf(result), allOkBut(id), `5 the ${id} scenario reddens ${id} and nothing else`)
    assert.equal(result.verdict, 'not-ready', `5 one red row (${id}) is not a ready verdict`)
  }

  // An empty whoami is not an account name.
  const { result: empty } = await run({ [CMD.whoami]: { code: 0, stdout: '\n' } })
  assert.equal(rowById(empty, 'exe-dev').status, 'missing', '5 an empty whoami is not an account')
}

for (const bad of ['a;b', 'owner', 'owner/repo; rm -rf /', 'owner/repo extra', '', '../../etc', 'a/b/c', 'a b/c']) {
  // A target that is not owner/repo is refused BEFORE any read, so it is never
  // interpolated into an ssh string.
  const { exec, calls } = makeExec()
  await assert.rejects(
    () => doctor({ exec, target: bad, verbsPath: RECORD }),
    `5 ${JSON.stringify(bad)} is refused as a target`
  )
  assert.deepEqual(calls, [], `5 nothing runs for a refused target (${JSON.stringify(bad)})`)
}

{
  const { result } = await run({}, { target: 'a-b.c/d_e.f' })
  assert.ok(result, '5 a dotted, hyphenated owner/repo is accepted')
}

// ── 6. the surviving surface: parseArgs, renderRows ──────────────────────────

{
  const { parseArgs, renderRows } = doctorModule
  assert.equal(typeof parseArgs, 'function', '6 parseArgs survives the lift')
  assert.equal(typeof renderRows, 'function', '6 renderRows survives the lift')

  const opts = parseArgs(['--json', '--config', '/tmp/x.json', '--target', TARGET])
  assert.equal(opts.json, true, '6 parseArgs reads --json')
  assert.equal(opts.configPath, '/tmp/x.json', '6 parseArgs reads --config')
  assert.equal(opts.target, TARGET, '6 parseArgs reads --target')

  // A red row still prints its first-run.md pointer.
  const { result } = await run({ [CMD.whoami]: { code: 1, stdout: '' } })
  const text = renderRows(result.rows)
  assert.ok(
    text.includes('→ references/first-run.md §exe-dev'),
    `6 a red row points at its first-run.md heading; got ${text}`
  )
}

// ── 6b. CLI, against a PATH shim ─────────────────────────────────────────────

const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-'))

/** M6: the real record, read from disk. The CLI leg runs the real doctor
 *  against the real file beside it, so the green `ssh` shim renders that file's
 *  own flags. Group 10 pins its content; this only has to read it. */
function readRealRecord () {
  assert.ok(fs.existsSync(RECORD_SRC), `6b [M6] fleet/exe-verbs.json exists at ${RECORD_SRC}`)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(RECORD_SRC, 'utf8'))
  } catch (error) {
    assert.fail(`6b [M6] fleet/exe-verbs.json parses as JSON; got ${error.message}`)
  }
  assert.ok(
    parsed && typeof parsed.verbs === 'object' && parsed.verbs !== null,
    '6b [M6] fleet/exe-verbs.json carries a verbs object'
  )
  return parsed
}

const REAL_RECORD = readRealRecord()
const REAL_VERBS = Object.keys(REAL_RECORD.verbs)

/** The `Options:` block the green `ssh` shim prints for one verb, as a printf
 *  argument: the flags the real record holds for it, so a green shim answers a
 *  record that has not drifted. */
const shellOptions = (verb, flags) =>
  `Command: ${verb}\\nOptions:\\n${flags.map((f) => `  ${f}  x`).join('\\n')}\\n`

const HELP_CASES = REAL_VERBS
  .map((verb) => `  *"help ${verb}"*) printf '${shellOptions(verb, REAL_RECORD.verbs[verb])}' ;;`)
  .join('\n')

/** M2: the accounts JSON the green `node` shim prints for `accounts --json`. */
const ACCOUNTS_SHIM_JSON = JSON.stringify(ACCOUNTS_ONE)

/** A PATH directory holding stubs for every binary this run's constraints ask a
 *  test to stub. `ssh` and `node` carry the behaviour; the rest are inert, so a
 *  doctor that reached for one would be visibly wrong rather than live. */
function shimDir (name, { ssh, node }) {
  const dir = fs.mkdtempSync(path.join(cliRoot, `${name}-`))
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
const BILLING_JSON = JSON.stringify({ max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'team' })

const GREEN_DIR = shimDir('green', {
  ssh: `#!/bin/sh
case "$*" in
${HELP_CASES}
  *whoami*) echo marcus ;;
  *"billing plan"*) echo '${BILLING_JSON}' ;;
  *"integrations list"*) echo '${CATALOG_JSON}' ;;
  *"integrations setup github"*) printf 'GitHub accounts:\\n  popmechanic\\n' ;;
  *) exit 1 ;;
esac
exit 0
`,
  // M1/M2: `accounts --json` answers the listing on stdout; every other
  // claude-token read answers the status line on stderr, as at BASE.
  node: `#!/bin/sh
case "$*" in
  *"accounts --json"*) echo '${ACCOUNTS_SHIM_JSON}' ;;
  *) echo '${STATUS_LINE}' >&2 ;;
esac
exit 0
`
})

const RED_DIR = shimDir('red', {
  ssh: '#!/bin/sh\necho "ssh: no" >&2\nexit 1\n',
  node: '#!/bin/sh\necho "no record in the keychain" >&2\nexit 1\n'
})

const runCli = (args, { dir, home } = {}) => {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  if (home) env.HOME = home
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], { encoding: 'utf8', env, timeout: 60000 })
}

const absentConfig = path.join(cliRoot, 'absent.json')
assert.equal(fs.existsSync(absentConfig), false, '6b fixture: the CLI config path starts absent')

{
  // leg (g): the green shim exits 0 with the seven rows in order, and the
  // verb-drift detail is the real record's own match sentence.
  const res = runCli(['--json', '--config', absentConfig], { dir: GREEN_DIR })
  assert.equal(res.status, 0, `6b [leg g] a ready run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '6b [leg g] an all-green CLI run is ready')
  assert.deepEqual(parsed.rows.map((r) => r.id), EXPECTED_IDS, '6b [leg g] the envelope carries the seven rows in order')
  assert.deepEqual(parsed.config, { cpu: '8', memory: '16GB' }, '6b an absent config file means the defaults')

  const drift = parsed.rows.find((r) => r.id === 'verb-drift')
  assert.equal(drift.status, 'ok', `6b [leg g] verb-drift is ok against the real record; got ${drift.detail}`)
  assert.equal(
    drift.detail,
    '12 verbs match fleet/exe-verbs.json (captured 2026-09-05)',
    `6b [M4 leg g] the green CLI run's verb-drift detail is the twelve-verb match sentence; got ${drift.detail}`
  )

  const accounts = parsed.rows.find((r) => r.id === 'accounts')
  assert.equal(accounts.status, 'ok', `6b [M2] the accounts row is ok under the green shim; got ${accounts.detail}`)
  assert.ok(
    accounts.detail.includes(`ultrapowers fresh until ${FRESH_AT}`),
    `6b [M2] the CLI's accounts detail names the entry; got ${accounts.detail}`
  )
}

{
  const res = runCli(['--json', '--config', absentConfig], { dir: RED_DIR })
  assert.equal(res.status, 1, `6b a not-ready run exits 1; stderr: ${res.stderr}`)
  assert.equal(JSON.parse(res.stdout).verdict, 'not-ready', '6b an all-red CLI run is not-ready')
}

{
  // leg (g): the red shim exits 1 with `verb-drift` still `ok` — every `help`
  // read fails, and an unreadable help is a finding, never a refusal. The human
  // form is two lines for each red row and one for verb-drift.
  const res = runCli(['--json', '--config', absentConfig], { dir: RED_DIR })
  const parsed = JSON.parse(res.stdout)
  const drift = parsed.rows.find((r) => r.id === 'verb-drift')
  assert.equal(
    drift.status,
    'ok',
    `6b [M5 leg g] verb-drift is ok even when every help read fails; got ${drift.status} — ${drift.detail}`
  )
  assert.ok(
    drift.detail.includes('help unreadable (code 1)'),
    `6b [M5 leg g] the red run's verb-drift detail reports the unreadable help; got ${drift.detail}`
  )

  const red = parsed.rows.filter((r) => r.status === 'missing').map((r) => r.id)
  assert.deepEqual(
    red,
    EXPECTED_IDS.filter((id) => id !== 'verb-drift'),
    `6b [M5 leg g] every row but verb-drift is red under the red shim; got ${JSON.stringify(statusOf(parsed))}`
  )

  const human = runCli(['--config', absentConfig], { dir: RED_DIR })
  const lines = human.stdout.trimEnd().split('\n')
  assert.equal(
    lines.length,
    red.length * 2 + 1,
    `6b [leg g] the human form is two lines per red row and one for verb-drift; got:\n${human.stdout}`
  )
  for (const [i, id] of red.entries()) {
    assert.ok(lines[i * 2].includes(id), `6b the human form names ${id}; got ${lines[i * 2]}`)
    assert.ok(
      lines[i * 2 + 1].includes(`references/first-run.md §${id}`),
      `6b a red ${id} points at its first-run.md heading; got ${lines[i * 2 + 1]}`
    )
  }
  const last = lines[lines.length - 1]
  assert.ok(last.includes('verb-drift'), `6b [leg g] the last human line is verb-drift's; got ${last}`)
  assert.ok(
    !last.includes('references/first-run.md'),
    `6b [leg g] a green verb-drift row prints no fix line; got ${last}`
  )
}

{
  // The config file's read keys: a named key overrides its default, an omitted
  // key keeps it, an unknown key is ignored by `loadFleetConfig`.
  const partial = path.join(cliRoot, 'partial.json')
  fs.writeFileSync(partial, JSON.stringify({ cpu: '4', nonsense: 'ignored' }))
  const res = runCli(['--json', '--config', partial], { dir: GREEN_DIR })
  assert.deepEqual(
    JSON.parse(res.stdout).config,
    { cpu: '4', memory: '16GB' },
    `6b a partial config overrides one key and ignores the unknown one; got ${res.stdout}`
  )
}

{
  // The default config path is ~/.ultrapowers/fleet.json, read from HOME.
  const home = fs.mkdtempSync(path.join(cliRoot, 'home-'))
  fs.mkdirSync(path.join(home, '.ultrapowers'))
  fs.writeFileSync(path.join(home, '.ultrapowers', 'fleet.json'), JSON.stringify({ memory: '32GB' }))
  const res = runCli(['--json'], { dir: RED_DIR, home })
  assert.equal(
    JSON.parse(res.stdout).config.memory,
    '32GB',
    `6b the CLI reads ~/.ultrapowers/fleet.json when no --config is given; got ${res.stdout}`
  )
}

{
  const res = runCli(['--json', '--config', absentConfig, '--target', 'a;b'], { dir: GREEN_DIR })
  assert.notEqual(res.status, 0, '6b a malformed --target is refused rather than run')
}

// ── 6b, leg (i) — the CLI passes fleet.json's account to the accounts row ─────

{
  // leg (i) [M2] [M3]: a config file naming an account the keychain does not
  // hold exits 1 with `accounts` missing, and the detail names it. The green
  // shim's keychain holds `ultrapowers` only.
  const zzz = path.join(cliRoot, 'account-zzz.json')
  fs.writeFileSync(zzz, JSON.stringify({ cpu: '8', memory: '16GB', account: 'zzz' }))
  const res = runCli(['--json', '--config', zzz], { dir: GREEN_DIR })
  assert.equal(res.status, 1, `6b [leg i] a fleet.json naming an unheld account exits 1; got ${res.stdout} ${res.stderr}`)
  const parsed = JSON.parse(res.stdout)
  const accounts = parsed.rows.find((r) => r.id === 'accounts')
  assert.equal(accounts.status, 'missing', `6b [leg i] the accounts row is missing; got ${JSON.stringify(accounts)}`)
  assert.ok(accounts.detail.includes('zzz'), `6b [leg i] the detail names zzz; got ${accounts.detail}`)
  assert.equal(parsed.verdict, 'not-ready', '6b [leg i] an unheld account is not a ready fleet')

  // M3: `account` beside the two read keys is not a key nothing reads.
  const capacity = parsed.rows.find((r) => r.id === 'capacity')
  assert.equal(
    capacity.status,
    'ok',
    `6b [M3 leg i] the account key leaves capacity ok; got ${capacity.status} — ${capacity.detail}`
  )

  // M3: `account` never travels into `result.config`.
  assert.deepEqual(
    parsed.config,
    { cpu: '8', memory: '16GB' },
    `6b [M3 leg i] the CLI's .config is still exactly the two keys; got ${res.stdout}`
  )
}

{
  // leg (i): the same file naming an account the keychain does hold exits 0,
  // with the accounts row green and saying so.
  const held = path.join(cliRoot, 'account-held.json')
  fs.writeFileSync(held, JSON.stringify({ cpu: '8', memory: '16GB', account: 'ultrapowers' }))
  const res = runCli(['--json', '--config', held], { dir: GREEN_DIR })
  assert.equal(res.status, 0, `6b [leg i] a fleet.json naming a held account exits 0; got ${res.stdout} ${res.stderr}`)
  const accounts = JSON.parse(res.stdout).rows.find((r) => r.id === 'accounts')
  assert.equal(accounts.status, 'ok', `6b [leg i] the accounts row is ok; got ${JSON.stringify(accounts)}`)
  assert.ok(
    accounts.detail.includes('fleet.json names ultrapowers'),
    `6b [M2 leg i] the detail says fleet.json names ultrapowers; got ${accounts.detail}`
  )
}

{
  // leg (i): with no --config, the account is read from
  // ~/.ultrapowers/fleet.json under HOME.
  const home = fs.mkdtempSync(path.join(cliRoot, 'home-account-'))
  fs.mkdirSync(path.join(home, '.ultrapowers'))
  fs.writeFileSync(
    path.join(home, '.ultrapowers', 'fleet.json'),
    JSON.stringify({ cpu: '8', memory: '16GB', account: 'zzz' })
  )
  const res = runCli(['--json'], { dir: GREEN_DIR, home })
  assert.equal(
    res.status,
    1,
    `6b [leg i] a HOME fleet.json naming an unheld account exits 1; got ${res.stdout} ${res.stderr}`
  )
  const accounts = JSON.parse(res.stdout).rows.find((r) => r.id === 'accounts')
  assert.equal(
    accounts.status,
    'missing',
    `6b [leg i] the accounts row is missing from the default config path; got ${JSON.stringify(accounts)}`
  )
  assert.ok(accounts.detail.includes('zzz'), `6b [leg i] the detail names zzz; got ${accounts.detail}`)
}

// ── 7. M2 / leg (b) — the accounts row ───────────────────────────────────────

/** Run the doctor with an accounts read of `entries` and a `claude-max` whose
 *  comment is `comment`, and answer the accounts row. */
async function accountsRow ({ entries, comment = EDGE_COMMENT, answer, account = null } = {}) {
  const catalog = [claudeMax(comment === null ? { comment: null } : { comment }), ghObject(TARGET)]
  const overrides = {
    [CMD.list]: { code: 0, stdout: listing(catalog) },
    [CMD.accounts]: answer ?? { code: 0, stdout: accountsJson(entries) }
  }
  const { result } = await run(overrides, { account })
  return { row: rowById(result, 'accounts'), result }
}

{
  // Context/M2: `parseIntegrations` grows a `comment` field — the string, or
  // null when the listing carries none.
  const found = parseIntegrations(listing([claudeMax(), ghObject(TARGET)]))
  assert.equal(
    found.get('claude-max').comment,
    EDGE_COMMENT,
    '7 [M2] parseIntegrations carries the listing entry\'s comment string'
  )
  const bare = parseIntegrations(listing([claudeMax({ comment: undefined }), ghObject(TARGET)]))
  assert.equal(
    bare.get('claude-max').comment,
    null,
    '7 [M2] an entry with no comment carries null rather than undefined'
  )
}

{
  // leg (b): two entries with the edge comment `account=ultrapowers` — `ok`,
  // and the detail names each entry, then the edge's account.
  const { row, result } = await accountsRow({ entries: ACCOUNTS_TWO })
  assert.equal(row.status, 'ok', `7 [M2 leg b] a readable listing of two entries is ok; got ${row.detail}`)
  assert.ok(
    row.detail.includes(`ultrapowers fresh until ${FRESH_AT}`),
    `7 [M2 leg b] the detail names the fresh entry as "<name> fresh until <expiresAt>"; got ${row.detail}`
  )
  assert.ok(
    row.detail.includes(`b expired ${EXPIRED_AT}`),
    `7 [M2 leg b] the detail names the stale entry as "<name> expired <expiresAt>"; got ${row.detail}`
  )
  assert.ok(
    row.detail.includes('; edge carries ultrapowers'),
    `7 [M2 leg b] the detail says which account the edge carries; got ${row.detail}`
  )
  // M2's order: the entries, then the edge.
  assert.ok(
    row.detail.indexOf(`b expired ${EXPIRED_AT}`) < row.detail.indexOf('; edge carries'),
    `7 [M2] the entries come before the edge clause; got ${row.detail}`
  )
  // No `account` was given, so the detail says nothing about fleet.json.
  assert.equal(
    row.detail.includes('fleet.json names'),
    false,
    `7 [M2] no account option means no fleet.json clause; got ${row.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '7 [M2 leg b] a readable accounts listing reddens no row')
  assert.equal(result.verdict, 'ready', '7 [M2 leg b] a readable accounts listing is a ready fleet')
}

{
  // leg (b): the same, with a `claude-max` comment carrying no `account=`
  // token — still green, and the detail says the edge account is unrecorded.
  const { row } = await accountsRow({ entries: ACCOUNTS_TWO, comment: PROSE_COMMENT })
  assert.equal(row.status, 'ok', `7 [M2 leg b] a comment with no account= token is still ok; got ${row.detail}`)
  assert.ok(
    row.detail.includes('; edge account unrecorded'),
    `7 [M2 leg b] the detail says the edge account is unrecorded; got ${row.detail}`
  )
  assert.equal(
    row.detail.includes('edge carries'),
    false,
    `7 [M2] an unrecorded edge account names no account; got ${row.detail}`
  )

  // And the same when the entry carries no comment at all.
  const { row: none } = await accountsRow({ entries: ACCOUNTS_TWO, comment: null })
  assert.equal(none.status, 'ok', `7 [M2 leg b] no comment at all is still ok; got ${none.detail}`)
  assert.ok(
    none.detail.includes('; edge account unrecorded'),
    `7 [M2 leg b] no comment means the edge account is unrecorded; got ${none.detail}`
  )
}

{
  // M2: the value is the one after `account=` in the first whitespace-separated
  // token that starts with it, wherever in the comment that token sits.
  const { row } = await accountsRow({ entries: ACCOUNTS_TWO, comment: 'set by the launcher account=b at install' })
  assert.equal(row.status, 'ok', `7 [M2] a comment with a leading phrase is ok; got ${row.detail}`)
  assert.ok(
    row.detail.includes('; edge carries b'),
    `7 [M2] the edge account is the token after account=; got ${row.detail}`
  )
}

{
  // leg (b): `account: 'b'` — a name the keychain does hold — is green, and the
  // detail says fleet.json names it.
  const { row, result } = await accountsRow({ entries: ACCOUNTS_TWO, account: 'b' })
  assert.equal(row.status, 'ok', `7 [M2 leg b] an account fleet.json names and the keychain holds is ok; got ${row.detail}`)
  assert.ok(
    row.detail.includes('; fleet.json names b'),
    `7 [M2 leg b] the detail says fleet.json names b; got ${row.detail}`
  )
  // M2's order: the fleet.json clause comes last.
  assert.ok(
    row.detail.indexOf('; edge carries') < row.detail.indexOf('; fleet.json names'),
    `7 [M2] the edge clause comes before the fleet.json clause; got ${row.detail}`
  )
  assert.equal(result.verdict, 'ready', '7 [M2 leg b] a held account is a ready fleet')
}

{
  // leg (b): `account: 'c'` — a name no entry carries — turns the row red and
  // the detail names it.
  const { row, result } = await accountsRow({ entries: ACCOUNTS_TWO, account: 'c' })
  assert.equal(row.status, 'missing', `7 [M2 leg b] an account no entry carries turns the row red; got ${row.detail}`)
  assert.ok(row.detail.includes('c'), `7 [M2 leg b] the detail names the account; got ${row.detail}`)
  assert.deepEqual(statusOf(result), allOkBut('accounts'), '7 [M2 leg b] an unheld account reddens accounts only')
  assert.equal(result.verdict, 'not-ready', '7 [M2 leg b] an unheld account is not a ready fleet')

  // `c` is one letter, so the assertion above is read again with a name no
  // other word in a detail could carry: the detail really names the account
  // fleet.json asked for.
  const { row: odd } = await accountsRow({ entries: ACCOUNTS_TWO, account: 'zzzq' })
  assert.equal(odd.status, 'missing', `7 [M2 leg b] an unheld account turns the row red; got ${odd.detail}`)
  assert.ok(odd.detail.includes('zzzq'), `7 [M2 leg b] the detail names the unheld account; got ${odd.detail}`)
}

{
  // leg (b): an empty array is red, and the detail names the login command that
  // fills the keychain.
  const { row } = await accountsRow({ entries: [] })
  assert.equal(row.status, 'missing', `7 [M2 leg b] an empty keychain listing is red; got ${row.detail}`)
  assert.ok(
    row.detail.includes('node fleet/claude-token.mjs login'),
    `7 [M2 leg b] the detail names the login command; got ${row.detail}`
  )
}

for (const [label, answer] of [
  ['an accounts read that exits 1', { code: 1, stdout: '' }],
  ['a stdout that is not JSON', { code: 0, stdout: 'not json\n' }],
  ['a stdout that parses but is not an array', { code: 0, stdout: '{}\n' }]
]) {
  // leg (b): a read the doctor cannot believe is red.
  const { row } = await accountsRow({ answer })
  assert.equal(row.status, 'missing', `7 [M2 leg b] ${label} turns the accounts row red; got ${row.detail}`)
  assert.ok(row.detail.length > 0, `7 [M2 leg b] ${label} still says something`)
}

// ── 8. M4 / leg (d) — verbDrift ──────────────────────────────────────────────

const { verbDrift } = doctorModule

/** A `help` seam over a table of verb → `{ code, stdout }`, recording every verb
 *  it was asked for. An unnamed verb answers the recorded flags. */
function makeHelp (overrides = {}) {
  const asked = []
  const help = async (verb) => {
    asked.push(verb)
    if (Object.prototype.hasOwnProperty.call(overrides, verb)) return overrides[verb]
    return { code: 0, stdout: optionsBlock(verb, FIXTURE_VERBS[verb] ?? []) }
  }
  return { help, asked }
}

{
  // leg (d): a help stub answering the recorded flags — readable, no findings,
  // and the match sentence.
  const { help, asked } = makeHelp()
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(answer.readable, true, '8 [M4 leg d] a readable record answers readable true')
  assert.equal(answer.capturedAt, FIXTURE_CAPTURED, '8 [M4 leg d] the answer echoes the record\'s capturedAt')
  assert.deepEqual(answer.findings, [], '8 [M4 leg d] a record that matches the lobby has no findings')
  assert.equal(
    answer.detail,
    `2 verbs match fleet/exe-verbs.json (captured ${FIXTURE_CAPTURED})`,
    `8 [M4 leg d] the no-drift detail is the match sentence; got ${answer.detail}`
  )
  assert.deepEqual(asked, FIXTURE_NAMES, '8 [M4 leg d] help is called once per verb, in record order')
}

{
  // leg (d): `new` answering one extra flag — one finding, `appeared` exactly
  // that flag, and the whole detail is the drift sentence.
  const extra = [...FIXTURE_VERBS.new, '--pool2']
  const { help } = makeHelp({ new: { code: 0, stdout: optionsBlock('new', extra) } })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(answer.readable, true, '8 [M4 leg d] a drifted record is still readable')
  assert.equal(answer.findings.length, 1, `8 [M4 leg d] one drifted verb is one finding; got ${JSON.stringify(answer.findings)}`)
  assert.equal(answer.findings[0].verb, 'new', '8 [M4 leg d] the finding names the verb')
  assert.deepEqual(answer.findings[0].appeared, ['--pool2'], '8 [M4 leg d] appeared is the live flag the record lacks')
  assert.deepEqual(answer.findings[0].vanished, [], '8 [M4 leg d] nothing vanished')
  assert.equal(
    answer.detail,
    `drift since ${FIXTURE_CAPTURED}: new: --pool2 appeared`,
    `8 [M4 leg d] the detail is the drift sentence; got ${answer.detail}`
  )
}

{
  // leg (d): `rm` answering no `--json` — the recorded flag it no longer prints
  // is `vanished`, and the detail carries that segment.
  const { help } = makeHelp({ rm: { code: 0, stdout: optionsBlock('rm', ['--force']) } })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(answer.findings.length, 1, `8 [M4 leg d] one vanished flag is one finding; got ${JSON.stringify(answer.findings)}`)
  assert.equal(answer.findings[0].verb, 'rm', '8 [M4 leg d] the finding names rm')
  assert.deepEqual(answer.findings[0].vanished, ['--json'], '8 [M4 leg d] vanished is the recorded flag the lobby no longer prints')
  assert.deepEqual(answer.findings[0].appeared, [], '8 [M4 leg d] nothing appeared')
  assert.ok(
    answer.detail.includes('rm: --json vanished'),
    `8 [M4 leg d] the detail carries the vanished segment; got ${answer.detail}`
  )
  assert.ok(
    answer.detail.startsWith(`drift since ${FIXTURE_CAPTURED}: `),
    `8 [M4 leg d] a drifted detail opens with the drift sentence; got ${answer.detail}`
  )
}

{
  // M4: two drifted verbs join with `; `, in record order.
  const { help } = makeHelp({
    new: { code: 0, stdout: optionsBlock('new', [...FIXTURE_VERBS.new, '--pool2']) },
    rm: { code: 0, stdout: optionsBlock('rm', ['--force']) }
  })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(
    answer.detail,
    `drift since ${FIXTURE_CAPTURED}: new: --pool2 appeared; rm: --json vanished`,
    `8 [M4] the segments are "; "-joined in record order; got ${answer.detail}`
  )
  assert.deepEqual(
    answer.findings.map((f) => f.verb),
    ['new', 'rm'],
    '8 [M4] the findings come back in record order'
  )
}

{
  // M4: several flags in one segment join with `, `.
  const { help } = makeHelp({
    new: { code: 0, stdout: optionsBlock('new', [...FIXTURE_VERBS.new, '--pool2', '--zone']) }
  })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.deepEqual(answer.findings[0].appeared, ['--pool2', '--zone'], '8 [M4] both new flags appear')
  assert.equal(
    answer.detail,
    `drift since ${FIXTURE_CAPTURED}: new: --pool2, --zone appeared`,
    `8 [M4] the flags of one segment join with ", "; got ${answer.detail}`
  )
}

{
  // leg (d): `rm` answering exit 255 — the finding is `unreadable` 255 and the
  // detail carries the code.
  const { help } = makeHelp({ rm: { code: 255, stdout: 'ssh: connection closed\n' } })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(answer.readable, true, '8 [M4 leg d] an unreadable help does not make the record unreadable')
  assert.equal(answer.findings.length, 1, `8 [M4 leg d] the unreadable verb is one finding; got ${JSON.stringify(answer.findings)}`)
  assert.equal(answer.findings[0].verb, 'rm', '8 [M4 leg d] the finding names rm')
  assert.equal(answer.findings[0].unreadable, 255, '8 [M4 leg d] unreadable is the exit code help answered')
  assert.ok(
    answer.detail.includes('rm: help unreadable (code 255)'),
    `8 [M4 leg d] the detail carries the unreadable segment; got ${answer.detail}`
  )
}

{
  // leg (d): the lobby answers an unknown verb with a line starting `No help
  // available for unrecognized command:` and exit 0 — a stdout carrying no flag
  // at all is `unreadable` 0, not a verb whose every flag vanished.
  const { help } = makeHelp({ rm: { code: 0, stdout: NO_HELP } })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(answer.findings.length, 1, `8 [M4 leg d] the unrecognised verb is one finding; got ${JSON.stringify(answer.findings)}`)
  assert.equal(answer.findings[0].verb, 'rm', '8 [M4 leg d] the finding names rm')
  assert.equal(
    answer.findings[0].unreadable,
    0,
    `8 [M4 leg d] a stdout with no flag at all is unreadable 0; got ${JSON.stringify(answer.findings[0])}`
  )
  assert.ok(
    answer.detail.includes('rm: help unreadable (code 0)'),
    `8 [M4 leg d] the detail carries the unreadable segment; got ${answer.detail}`
  )
}

for (const [label, fixtureName, body] of [
  ['an absent record', null, null],
  ['a record holding `{`', 'broken.json', '{'],
  ['a record with no verbs object', 'no-verbs.json', '{"capturedAt":"x"}']
]) {
  // leg (d): a record the doctor cannot read answers readable false, with a
  // detail naming the file an operator would open.
  const p = fixtureName === null ? path.join(ROOT, 'never-written.json') : recordFixture(fixtureName, body)
  if (fixtureName === null) assert.equal(fs.existsSync(p), false, '8 fixture: the absent record path starts absent')
  const { help, asked } = makeHelp()
  const answer = await verbDrift({ help, recordPath: p })
  assert.equal(answer.readable, false, `8 [M4 leg d] ${label} answers readable false`)
  assert.ok(
    answer.detail.includes('fleet/exe-verbs.json'),
    `8 [M4 leg d] ${label}'s detail names fleet/exe-verbs.json; got ${answer.detail}`
  )
  assert.equal(answer.capturedAt ?? null, null, `8 [M4 leg d] ${label} has no capturedAt`)
  assert.deepEqual(asked, [], `8 [M4 leg d] ${label} asks help for nothing`)
}

{
  // leg (d): a key that is not a verb name never reaches an ssh string — it is
  // reported as unreadable with code -1, and help is never called with it.
  const p = recordFixture('injection.json', { capturedAt: FIXTURE_CAPTURED, verbs: { 'rm; whoami': ['--json'] } })
  const { help, asked } = makeHelp()
  const answer = await verbDrift({ help, recordPath: p })
  assert.equal(answer.readable, true, '8 [M4 leg d] the record itself is readable')
  assert.equal(answer.findings.length, 1, `8 [M4 leg d] the refused key is one finding; got ${JSON.stringify(answer.findings)}`)
  assert.equal(answer.findings[0].verb, 'rm; whoami', '8 [M4 leg d] the finding names the key')
  assert.equal(answer.findings[0].unreadable, -1, '8 [M4 leg d] a key that is not a verb name is unreadable -1')
  assert.deepEqual(asked, [], '8 [M4 leg d] help was never called with a key that is not a verb name')
  assert.ok(
    answer.detail.includes('help unreadable (code -1)'),
    `8 [M4 leg d] the detail reports the refusal as a finding; got ${answer.detail}`
  )
}

{
  // M4: the live flag set is every `^\s+(--[A-Za-z0-9-]+)` at the START of a
  // line — a flag named mid-sentence in the description is not a live flag.
  const prose = 'Command: rm\nRemoves a VM. See --force and --json below.\nOptions:\n  --force  x\n  --json  x\n'
  const { help } = makeHelp({ rm: { code: 0, stdout: prose } })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.deepEqual(
    answer.findings,
    [],
    `8 [M4] only line-leading flags count as live; got ${JSON.stringify(answer.findings)}`
  )
}

// ── 9. M5 / leg (e) — the verb-drift row ─────────────────────────────────────

{
  // leg (e): a run whose help reads drift is `ready`, with `verb-drift` `ok`
  // and exactly the detail verbDrift answers for the same reads.
  const drifted = { code: 0, stdout: optionsBlock('new', [...FIXTURE_VERBS.new, '--pool2']) }
  const { result } = await run({ [helpCmd('new')]: drifted })
  const row = rowById(result, 'verb-drift')
  assert.equal(row.status, 'ok', `9 [M5 leg e] a drift is a finding in a green row; got ${row.status} — ${row.detail}`)

  const { help } = makeHelp({ new: drifted })
  const answer = await verbDrift({ help, recordPath: RECORD })
  assert.equal(row.detail, answer.detail, `9 [M5 leg e] the row's detail is verbDrift's; got ${row.detail}`)

  assert.deepEqual(statusOf(result), ALL_OK, '9 [M5 leg e] a drift reddens no row')
  assert.equal(result.verdict, 'ready', '9 [M5 leg e] an account whose only blemish is a drift is ready')
}

{
  // leg (e): a run whose every help read exits 255 is still `ready`, with the
  // unreadable helps reported as findings in a green row.
  const dead = { code: 255, stdout: 'ssh: connection closed\n' }
  const overrides = Object.fromEntries(FIXTURE_NAMES.map((verb) => [helpCmd(verb), dead]))
  const { result } = await run(overrides)
  const row = rowById(result, 'verb-drift')
  assert.equal(row.status, 'ok', `9 [M5 leg e] an unreadable help is never a refusal; got ${row.status} — ${row.detail}`)
  assert.ok(
    row.detail.includes('help unreadable (code 255)'),
    `9 [M5 leg e] the detail carries the unreadable helps; got ${row.detail}`
  )
  assert.deepEqual(statusOf(result), ALL_OK, '9 [M5 leg e] unreadable helps redden no row')
  assert.equal(result.verdict, 'ready', '9 [M5 leg e] unreadable helps still leave the fleet ready')
}

{
  // leg (e): a run whose verbsPath is absent is `not-ready` with `verb-drift`
  // `missing` and every other row unchanged.
  const absent = path.join(ROOT, 'no-record-here.json')
  assert.equal(fs.existsSync(absent), false, '9 fixture: the absent record path starts absent')
  const { result, calls } = await run({}, { verbsPath: absent })
  const row = rowById(result, 'verb-drift')
  assert.equal(row.status, 'missing', `9 [M5 leg e] an unreadable record turns the row red; got ${row.detail}`)
  assert.ok(
    row.detail.includes('fleet/exe-verbs.json'),
    `9 [M5 leg e] the red detail names the record; got ${row.detail}`
  )
  assert.equal(row.fix, 'verb-drift', '9 [M5 leg e] the red row\'s fix is its own first-run.md heading')
  assert.deepEqual(statusOf(result), allOkBut('verb-drift'), '9 [M5 leg e] every other row is unchanged')
  assert.equal(result.verdict, 'not-ready', '9 [M5 leg e] an unreadable record is not a ready fleet')

  // M1: an unreadable record issues no help read at all.
  assert.deepEqual(
    calls,
    [...BASE_READS, CMD.accounts],
    `9 [M1] an unreadable record issues the reads before it and no help read; got ${JSON.stringify(calls)}`
  )
}

// ── 10. M6 / leg (f) — fleet/exe-verbs.json ──────────────────────────────────

/** M6: the record's content, captured from the live lobby on 2026-09-05. The
 *  copy verb is absent on purpose: it left the fleet with the golden image, and
 *  its tag-copying flag is a string banned under `fleet/` by the sweep in
 *  fleet/tests/test_launch.mjs. */
const RECORDED = {
  capturedAt: '2026-09-05',
  verbs: {
    new: [
      '--comment', '--cpu', '--disk', '--env', '--image', '--integration', '--json', '--memory',
      '--name', '--no-email', '--pool', '--prompt', '--registry-auth', '--setup-script', '--tag'
    ],
    rm: ['--json'],
    ls: ['--group', '--json', '--l'],
    comment: ['--json'],
    tag: ['--d', '--json'],
    'integrations add': [
      '--act-as-user', '--attach', '--bearer', '--comment', '--fields', '--for', '--header',
      '--name', '--no-auth', '--peer', '--readonly', '--repository', '--strip-prefix', '--target', '--team'
    ],
    'integrations attach': ['--for', '--team', '--until'],
    'integrations detach': ['--team'],
    'integrations list': ['--json', '--usage'],
    'integrations edit': [
      '--act-as-user', '--bearer', '--clear-header', '--comment', '--fields', '--header', '--no-auth',
      '--readonly', '--repository', '--strip-prefix', '--target', '--team', '--webhook-url'
    ],
    'ssh-key generate-api-key': ['--cmds', '--exp', '--json', '--label', '--vm'],
    'billing plan': ['--json']
  }
}

{
  // leg (f): the file on disk deep-equals the twelve-verb literal, with its
  // keys in that order and `capturedAt` 2026-09-05.
  assert.deepEqual(REAL_RECORD, RECORDED, '10 [M6 leg f] fleet/exe-verbs.json is the recorded literal')
  assert.deepEqual(
    Object.keys(REAL_RECORD.verbs),
    Object.keys(RECORDED.verbs),
    '10 [M6 leg f] the verbs keys are exactly the twelve, in that order'
  )
  assert.equal(REAL_RECORD.capturedAt, '2026-09-05', '10 [M6 leg f] capturedAt is 2026-09-05')
  assert.equal(REAL_VERBS.length, 12, '10 [M6 leg f] the record holds twelve verbs')

  // The copy verb is not recorded: its tag-copying flag is banned under fleet/.
  assert.equal(
    Object.prototype.hasOwnProperty.call(REAL_RECORD.verbs, 'cp'),
    false,
    '10 [M6 leg f] the copy verb is not in the record'
  )

  // Every key is a verb name the doctor may interpolate, and every value is a
  // flat array of flag names — the diff unit is the flag set, not the prose.
  for (const [verb, flags] of Object.entries(REAL_RECORD.verbs)) {
    assert.ok(/^[a-z][a-z0-9 -]*$/.test(verb), `10 [M6 leg f] ${JSON.stringify(verb)} is a verb name`)
    assert.ok(Array.isArray(flags) && flags.length > 0, `10 [M6 leg f] ${verb} carries a non-empty flag array`)
    for (const flag of flags) {
      assert.ok(/^--[A-Za-z0-9-]+$/.test(flag), `10 [M6 leg f] ${verb}'s ${JSON.stringify(flag)} is a flag name`)
    }
  }
}

// ── 11. M7 / leg (h) — first-run.md ──────────────────────────────────────────

/** `sed -n '/<start>/,/<end>/p'`, in JS: the half-open line range from the first
 *  match of `start` through the first following match of `end`. `end` null runs
 *  to the end of the file; `start` null starts at line 1, which is
 *  `sed -n '1,/<end>/p'`. Null when the span does not exist at all. */
function span (lines, start, end) {
  const from = start === null ? 0 : lines.findIndex((line) => start.test(line))
  if (from === -1) return null
  if (end === null) return [from, lines.length]
  const rest = lines.slice(from + 1).findIndex((line) => end.test(line))
  return [from, rest === -1 ? lines.length : from + 1 + rest + 1]
}

/** The span's text, joined by spaces the way the Proof's `tr '\n' ' '` joins
 *  it — so a phrase that straddles a line wrap is still found. */
const textOf = (lines, range) => (range === null ? '' : lines.slice(range[0], range[1]).join(' '))

const FIRST_RUN_MD = fs.readFileSync(FIRST_RUN, 'utf8')
const FIRST_RUN_LINES = FIRST_RUN_MD.split('\n')

/** The three scoped greps of leg (h): the span each `sed` cuts, and the words
 *  M7 asks that span to name. */
const GREPS = [
  {
    name: '## accounts',
    cut: (lines) => span(lines, /^## accounts/, /^## github/),
    words: ['--account', '--no-install', 'accounts', 'usage', '"account"']
  },
  {
    name: '## verb-drift',
    cut: (lines) => span(lines, /^## verb-drift/, null),
    words: ['fleet/exe-verbs.json', 'help', 'finding']
  },
  {
    name: 'the text before ## exe-dev',
    cut: (lines) => span(lines, null, /^## exe-dev/),
    words: ['seven rows']
  }
]

for (const { name, cut, words } of GREPS) {
  // leg (h): each scoped grep finds every word M7 names in that span.
  const range = cut(FIRST_RUN_LINES)
  assert.notEqual(range, null, `11 [M7 leg h] first-run.md has a ${name} span at all`)
  const text = textOf(FIRST_RUN_LINES, range)
  for (const word of words) {
    assert.ok(
      text.includes(word),
      `11 [M7 leg h] ${name} names ${JSON.stringify(word)}; got:\n${text}`
    )
  }

  // …and each grep exits non-zero when its span lacks that word, so none of
  // these checks is vacuous: the word is redacted inside the span only, and the
  // same grep, re-cut over the redacted page, no longer finds it.
  for (const word of words) {
    const redacted = FIRST_RUN_LINES.map((line, i) =>
      i >= range[0] && i < range[1] ? line.split(word).join('REDACTED') : line
    )
    assert.equal(
      textOf(redacted, cut(redacted)).includes(word),
      false,
      `11 [M7 leg h] the ${name} grep is live: it misses ${JSON.stringify(word)} when the span lacks it`
    )
  }
}

{
  // leg (h): the check test_docs_agree_with_code.py makes — ROW_IDS and
  // first-run.md's `## ` headings agree in membership and order.
  const headings = FIRST_RUN_LINES
    .filter((line) => /^## /.test(line))
    .map((line) => line.slice(3).trim())
  assert.deepEqual(
    headings,
    EXPECTED_IDS,
    `11 [M7 leg h] first-run.md's ## headings are ROW_IDS, in order; got ${JSON.stringify(headings)}`
  )

  // M7: `## accounts` sits between `## claude` and `## github`, and
  // `## verb-drift` after `## integrations`.
  assert.equal(headings[headings.indexOf('accounts') - 1], 'claude', '11 [M7] ## accounts follows ## claude')
  assert.equal(headings[headings.indexOf('accounts') + 1], 'github', '11 [M7] ## accounts precedes ## github')
  assert.equal(headings[headings.length - 1], 'verb-drift', '11 [M7] ## verb-drift is the last section')

  // M7: the opening paragraph says seven rows, and no longer five.
  const head = textOf(FIRST_RUN_LINES, span(FIRST_RUN_LINES, null, /^## exe-dev/))
  assert.equal(head.includes('five rows'), false, `11 [M7] the opening no longer says five rows; got:\n${head}`)
}

console.log('ALL TESTS PASSED')
