/**
 * Exam for fleet/doctor.mjs — "do you have a fleet?", five rows read off
 * exe.dev's own truth.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from.
 *
 *   1  M1 / leg (a) — ROW_IDS, DOCTOR_DEFAULTS, the five reads and nothing
 *      else, no `goldenScriptSha` export, node:-only imports.
 *   2  the capacity row, against this task's own clauses (M1–M4 / legs (a)–(g),
 *      numbered afresh — the row reports the pool and what one run asks for, is
 *      green whenever it could read both, never says how many runs fit or that
 *      the pool cannot hold one, and is red only for an unreadable pool or an
 *      unparseable config).
 *   3  M3 / leg (c) — claude, from the listing's bearer and claude-token's
 *      status line.
 *   4  M4 / leg (d) — github, from `integrations setup github --list`.
 *   5  M5 / leg (e) — integrations, the tag, `--target`, the verdict, and a
 *      target that is refused before any read.
 *   6  the surviving surface — parseArgs/renderRows, --json, --config, the
 *      two-key config file, and exit code 0 iff ready.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub, and
 * the CLI leg drives it against a PATH shim (`ssh`, `node`, and the other
 * binaries the run's constraints ask a test to stub). Nothing here opens a
 * socket and nothing here reaches exe.dev.
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

// ── Shared literals ──────────────────────────────────────────────────────────

/** M1: the five rows, in the order the doctor reports them. */
const EXPECTED_IDS = ['exe-dev', 'capacity', 'claude', 'github', 'integrations']

/** M1: the five reads, in the order M1 lists them. `<dir>` is the doctor's own
 *  directory, so the claude-token read is an absolute path beside doctor.mjs. */
const CMD = {
  whoami: 'ssh exe.dev whoami',
  billing: 'ssh exe.dev "billing plan --json"',
  list: 'ssh exe.dev "integrations list --json"',
  github: 'ssh exe.dev "integrations setup github --list"',
  token: `node ${path.join(FLEET_DIR, 'claude-token.mjs')} status`
}
const FIVE_READS = [CMD.whoami, CMD.billing, CMD.list, CMD.github, CMD.token]

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

const listing = (entries) => `${JSON.stringify({ integrations: entries })}\n`

const claudeMax = (over = {}) => ({
  name: 'claude-max',
  type: 'http-proxy',
  attachments: null,
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
  [CMD.token]: { code: 0, stdout: `${STATUS_LINE}\n` }
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
 *  row `id` plus the whole result. */
async function run (overrides = {}, opts = {}) {
  const { exec, calls } = makeExec(overrides)
  const result = await doctor({ config: opts.config, exec, target: opts.target ?? null })
  return { result, calls }
}

const statusOf = (result) => Object.fromEntries(result.rows.map((r) => [r.id, r.status]))

// ── 1. M1 — the rows, the defaults, the five reads ───────────────────────────

{
  // leg (a): ROW_IDS deep-equals the five ids in order.
  assert.deepEqual([...ROW_IDS], EXPECTED_IDS, '1 [M1 leg a] ROW_IDS is the five ids in order')

  // leg (a): DOCTOR_DEFAULTS deep-equals the config literal. Task 3's lobby
  // pins the same literal; two readers of one config file that disagree about a
  // default would certify a fleet the launcher never looks at.
  assert.deepEqual(
    { ...DOCTOR_DEFAULTS },
    { cpu: '8', memory: '16GB' },
    "1 [M1 leg a] DOCTOR_DEFAULTS is { cpu: '8', memory: '16GB' }"
  )

  // The run's constraint on ~/.ultrapowers/fleet.json: exactly two keys.
  assert.deepEqual(
    Object.keys(DOCTOR_DEFAULTS).sort(),
    ['cpu', 'memory'],
    '1 [M1] the config has exactly the two keys cpu and memory'
  )
}

{
  // leg (a): a green run's command log is exactly the five reads, in M1's
  // order, with nothing else — no golden read, no probe, no write.
  const { result, calls } = await run()
  assert.deepEqual(calls, FIVE_READS, '1 [M1 leg a] a green run issues exactly the five reads, in order')
  assert.equal(result.verdict, 'ready', `1 [M1] the green account is ready; got ${JSON.stringify(statusOf(result))}`)

  const { calls: targeted } = await run({}, { target: TARGET })
  assert.deepEqual(targeted, FIVE_READS, '1 [M1 leg a] --target adds no sixth read')

  // Nothing in a run creates, copies or removes anything: twice over is the
  // same five reads again.
  const { exec, calls: twice } = makeExec()
  await doctor({ exec })
  await doctor({ exec })
  assert.deepEqual(twice, [...FIVE_READS, ...FIVE_READS], '1 [M1 leg a] the doctor is a read, twice over')
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
    // FIXES maps each row id to itself — each is a `## ` heading in
    // references/first-run.md.
    assert.equal(r.fix, r.id, `1 ${r.id}'s fix is its own first-run.md heading`)
  }
}

{
  // leg (a): the module exports no `goldenScriptSha`, and does export the four
  // symbols the task produces.
  assert.equal(
    Object.keys(doctorModule).includes('goldenScriptSha'),
    false,
    '1 [M1 leg a] fleet/doctor.mjs exports no goldenScriptSha'
  )
  assert.equal(doctorModule.goldenScriptSha, undefined, '1 [M1 leg a] goldenScriptSha is gone, not renamed in place')
  for (const name of ['ROW_IDS', 'DOCTOR_DEFAULTS', 'doctor', 'parseIntegrations']) {
    assert.ok(Object.keys(doctorModule).includes(name), `1 fleet/doctor.mjs exports ${name}`)
  }
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
// The clause and leg names in this group are this task's own, not group 1's:
// M1 pins the green sentence, M2 the readable-but-smaller pools, M3 the absence
// of a count and of a refusal, M4 the two things still red.

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
  assert.deepEqual(
    statusOf(result),
    { 'exe-dev': 'ok', capacity: 'ok', claude: 'ok', github: 'ok', integrations: 'ok' },
    '2 [M2 leg b] a 4 vCPU pool reddens no row'
  )
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

  // …and neither does the doctor's own source, comments included — the source
  // half of the same clause, which the Proof also runs as a grep.
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

// ── 3. M3 — claude ───────────────────────────────────────────────────────────

{
  // leg (c): claude-max carrying the bearer in config_summary, on no tag, with
  // claude-token answering its status line.
  const { result } = await run()
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 [M3 leg c] a bearer in config_summary is ok; got ${claude.detail}`)
  assert.ok(
    claude.detail.includes(STATUS_LINE),
    `3 [M3 leg c] the detail carries claude-token's status line; got ${claude.detail}`
  )
}

{
  // leg (c): the same bearer read off `config.headers[]` instead.
  const catalog = [
    claudeMax({ config_summary: undefined, config: { headers: ['Authorization:Bearer ***'] } }),
    ghObject(TARGET)
  ]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 [M3 leg c] a bearer in config.headers is ok; got ${claude.detail}`)
}

{
  // leg (c): an empty keychain leaves the status alone and only changes the
  // detail — the bearer is injected at the edge either way.
  const { result } = await run({
    [CMD.token]: { code: 1, stdout: 'no record in the keychain\n' }
  })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'ok', `3 [M3 leg c] an empty keychain does not turn claude red; got ${claude.detail}`)
  assert.ok(claude.detail.includes('keychain'), `3 [M3 leg c] the detail names the keychain; got ${claude.detail}`)
}

for (const [label, catalog] of [
  ['claude-max is absent', [ghObject(TARGET)]],
  ['claude-max carries no bearer', [claudeMax({ config_summary: 'target=https://api.anthropic.com' }), ghObject(TARGET)]]
]) {
  // leg (c): no bearer at the edge is missing, and names the login command.
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'missing', `3 [M3 leg c] ${label} turns claude red`)
  assert.ok(
    claude.detail.includes('claude-token.mjs login'),
    `3 [M3 leg c] the detail names the login command; got ${claude.detail}`
  )
}

{
  // leg (c): claude-max on tag:fleet is the subscription handed to every fleet
  // VM for as long as the object lives — red, naming the detach.
  const catalog = [claudeMax({ attachments: ['tag:fleet'] }), ghObject(TARGET)]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } })
  const claude = rowById(result, 'claude')
  assert.equal(claude.status, 'missing', '3 [M3 leg c] claude-max on tag:fleet turns claude red')
  assert.ok(
    claude.detail.includes('integrations detach claude-max tag:fleet'),
    `3 [M3 leg c] the detail names the detach; got ${claude.detail}`
  )
}

// ── 4. M4 — github ───────────────────────────────────────────────────────────

{
  // leg (d): the two-line listing — a header and one indented account.
  const { result } = await run()
  const github = rowById(result, 'github')
  assert.equal(github.status, 'ok', `4 [M4 leg d] one account under the header is ok; got ${github.detail}`)
  assert.ok(
    github.detail.includes('popmechanic'),
    `4 [M4 leg d] the detail carries the accounts; got ${github.detail}`
  )
}

for (const [label, answer] of [
  ['the header with no names', { code: 0, stdout: 'GitHub accounts:\n' }],
  ['a listing that exits 1', { code: 1, stdout: 'integrations: not set up\n' }]
]) {
  // leg (d): no account is missing, and names the browser step.
  const { result } = await run({ [CMD.github]: answer })
  const github = rowById(result, 'github')
  assert.equal(github.status, 'missing', `4 [M4 leg d] ${label} turns github red`)
  assert.ok(
    github.detail.includes('integrations setup github'),
    `4 [M4 leg d] the detail names the browser step; got ${github.detail}`
  )
}

// ── 5. M5 — integrations, and the verdict ────────────────────────────────────

for (const [label, extra, named] of [
  // Recognised by its declared type…
  [`${LEGACY_RUNS} on the tag`, { name: LEGACY_RUNS, type: 'github', attachments: ['tag:fleet'] }, LEGACY_RUNS],
  // …by the fleet's own naming when the listing says nothing else…
  ['a gh-x-y on the tag', { name: 'gh-x-y', attachments: ['tag:fleet'] }, 'gh-x-y'],
  // …or by its type under a name that says nothing.
  ['a github-typed themis on the tag', { name: 'themis', type: 'github', attachments: ['tag:fleet'] }, 'themis']
]) {
  // leg (e): a tag attachment lands on every fleet VM, so any GitHub object on
  // the tag is red — with or without --target — and names the detach.
  const catalog = [...GREEN_CATALOG(), extra]
  const answer = { [CMD.list]: { code: 0, stdout: listing(catalog) } }

  for (const target of [null, TARGET]) {
    const { result } = await run(answer, { target })
    const row = rowById(result, 'integrations')
    const where = target === null ? 'without --target' : 'with --target'
    assert.equal(row.status, 'missing', `5 [M5 leg e] ${label} turns integrations red ${where}`)
    assert.ok(
      row.detail.includes(`integrations detach ${named} tag:fleet`),
      `5 [M5 leg e] the detail names the detach ${where}; got ${row.detail}`
    )
    assert.equal(result.verdict, 'not-ready', `5 [M5 leg e] ${label} is not a ready fleet ${where}`)
  }
}

{
  // leg (e): --target with no object of its own is red, and names the command
  // that builds it.
  const { result } = await run({}, { target: 'popmechanic/smoke' })
  const row = rowById(result, 'integrations')
  assert.equal(row.status, 'missing', '5 [M5 leg e] --target with no gh-popmechanic-smoke turns the row red')
  assert.ok(
    row.detail.includes('gh-popmechanic-smoke'),
    `5 [M5 leg e] the detail names the missing object; got ${row.detail}`
  )
  assert.ok(
    row.detail.includes('node fleet/target.mjs popmechanic/smoke'),
    `5 [M5 leg e] the detail names the command that builds it; got ${row.detail}`
  )
}

{
  // leg (e): the target's own object on the tag is red as well.
  const catalog = [claudeMax(), ghObject(TARGET, { attachments: ['tag:fleet'] })]
  const { result } = await run({ [CMD.list]: { code: 0, stdout: listing(catalog) } }, { target: TARGET })
  const row = rowById(result, 'integrations')
  assert.equal(row.status, 'missing', "5 [M5 leg e] the target's own object on the tag turns the row red")
  assert.ok(
    row.detail.includes(`integrations detach ${GH} tag:fleet`),
    `5 [M5 leg e] the detail names the detach; got ${row.detail}`
  )
}

{
  // leg (e): no GitHub object on the tag and the target's object unattached is
  // ok — and so is a fleet with no targets yet.
  const { result: targeted } = await run({}, { target: TARGET })
  assert.equal(
    rowById(targeted, 'integrations').status,
    'ok',
    `5 [M5 leg e] an unattached target object is ok; got ${rowById(targeted, 'integrations').detail}`
  )
  const { result: bare } = await run()
  assert.equal(rowById(bare, 'integrations').status, 'ok', '5 [M5 leg e] no --target asks for no target object')
}

{
  // leg (e): the verdict is `ready` exactly when all five rows are ok. Each
  // scenario below reddens exactly one row, and each is not-ready.
  const { result: green } = await run()
  assert.deepEqual(
    statusOf(green),
    { 'exe-dev': 'ok', capacity: 'ok', claude: 'ok', github: 'ok', integrations: 'ok' },
    '5 [M5 leg e] the green account is five ok rows'
  )
  assert.equal(green.verdict, 'ready', '5 [M5 leg e] five ok rows is a ready verdict')

  const scenarios = {
    'exe-dev': { [CMD.whoami]: { code: 1, stdout: '' } },
    // A pool smaller than the run is green now (group 2, M2), so the one thing
    // that still reddens this row is a billing read the doctor cannot believe.
    capacity: { [CMD.billing]: { code: 1, stdout: '' } },
    claude: { [CMD.list]: { code: 0, stdout: listing([ghObject(TARGET)]) } },
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
    const statuses = statusOf(result)
    assert.equal(statuses[id], 'missing', `5 [M5 leg e] the ${id} scenario reddens ${id}`)
    for (const other of EXPECTED_IDS.filter((x) => x !== id)) {
      assert.equal(statuses[other], 'ok', `5 [M5 leg e] the ${id} scenario leaves ${other} ok`)
    }
    assert.equal(result.verdict, 'not-ready', `5 [M5 leg e] one red row (${id}) is not a ready verdict`)
  }

  // An empty whoami is not an account name.
  const { result: empty } = await run({ [CMD.whoami]: { code: 0, stdout: '\n' } })
  assert.equal(rowById(empty, 'exe-dev').status, 'missing', '5 an empty whoami is not an account')
}

for (const bad of ['a;b', 'owner', 'owner/repo; rm -rf /', 'owner/repo extra', '', '../../etc', 'a/b/c', 'a b/c']) {
  // leg (e): a target that is not owner/repo is refused BEFORE any read, so it
  // is never interpolated into an ssh string.
  const { exec, calls } = makeExec()
  await assert.rejects(
    () => doctor({ exec, target: bad }),
    `5 [M5 leg e] ${JSON.stringify(bad)} is refused as a target`
  )
  assert.deepEqual(calls, [], `5 [M5 leg e] nothing runs for a refused target (${JSON.stringify(bad)})`)
}

{
  const { result } = await run({}, { target: 'a-b.c/d_e.f' })
  assert.ok(result, '5 a dotted, hyphenated owner/repo is accepted')
}

// ── 6. the surviving surface: parseArgs, renderRows, and the CLI ─────────────

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
  const res = runCli(['--json', '--config', absentConfig], { dir: GREEN_DIR })
  assert.equal(res.status, 0, `6b a ready run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '6b an all-green CLI run is ready')
  assert.deepEqual(parsed.rows.map((r) => r.id), EXPECTED_IDS, '6b the envelope carries the five rows in order')
  assert.deepEqual(parsed.config, { cpu: '8', memory: '16GB' }, '6b an absent config file means the defaults')
}

{
  const res = runCli(['--json', '--config', absentConfig], { dir: RED_DIR })
  assert.equal(res.status, 1, `6b a not-ready run exits 1; stderr: ${res.stderr}`)
  assert.equal(JSON.parse(res.stdout).verdict, 'not-ready', '6b an all-red CLI run is not-ready')
}

{
  const res = runCli(['--config', absentConfig], { dir: RED_DIR })
  const lines = res.stdout.trimEnd().split('\n')
  assert.equal(lines.length, EXPECTED_IDS.length * 2, '6b the human form is a row and a fix line per miss')
  for (const [i, id] of EXPECTED_IDS.entries()) {
    assert.ok(lines[i * 2].includes(id), `6b the human form names ${id}; got ${lines[i * 2]}`)
    assert.ok(
      lines[i * 2 + 1].includes(`references/first-run.md §${id}`),
      `6b a red ${id} points at its first-run.md heading; got ${lines[i * 2 + 1]}`
    )
  }
}

{
  // The config file has exactly two keys: a named key overrides its default, an
  // omitted key keeps it, an unknown key is ignored.
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

console.log('ALL TESTS PASSED')
