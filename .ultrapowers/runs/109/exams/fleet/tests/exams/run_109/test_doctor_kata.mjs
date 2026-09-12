/**
 * Exam for the doctor's ninth row and the documents that carry it — "the
 * operator's own check says whether the hub is there".
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from:
 *
 *   1  M6 / leg (g) — `ROW_IDS` is the eight BASE ids followed by `kata`, and
 *      the reported rows come back in that order.
 *   2  M6 / leg (g) — the two new reads, exactly once each, in that order,
 *      directly after the accounts read and before the first `help` read.
 *   3  M6 / leg (g) — the green `kata` row: the listing's entry with a bearer,
 *      the policy read's own `policy.selector`, and the `ls` answer's row. Its
 *      `attachments` array names no `tag:` atom, so a row that read
 *      attachments instead of the policy is red here.
 *   4  M6 / leg (g) — the five absences, one assertion per opening phrase, per
 *      fix, per `fix` id and per verdict, and `integrations attach` in none of
 *      them.
 *   5  M7 / leg (h) — first-run.md's headings against `ROW_IDS`, the runbook's
 *      sixth step, the contract's doctor table and integration bullet, the one
 *      `integrations add http-proxy --name kata … --policy 'tag:fleet'` line
 *      the narrowed docs pin has to permit, and `integrations attach kata` in
 *      no document.
 *
 * Every read the doctor makes is driven through the `exec` seam with a stub
 * table, and an unstubbed command answers code 127 so a read this exam did not
 * expect surfaces as a red row rather than as a socket. The `verb-drift` row
 * reads a two-verb fixture record, never the committed `fleet/exe-verbs.json`.
 * Nothing here writes a file and nothing here reaches exe.dev.
 *
 * One reading this file fixes, because leg (g)'s words admit one shape: the
 * `accounts` read is `node <dir>/claude-token.mjs accounts --json` (the doctor
 * runs the credential tool rather than sshing for it), and "directly after
 * `… accounts --json`" is read against that command.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROW_IDS, doctor } from '../../../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..', '..', '..')
const REPO = path.resolve(FLEET_DIR, '..')
const REFERENCES = path.join(REPO, 'skills', 'ultrapowers', 'references')
const FIRST_RUN = path.join(REFERENCES, 'first-run.md')
const RUNBOOK = path.join(FLEET_DIR, 'RUNBOOK.md')
const CONTRACT = path.join(FLEET_DIR, 'CONTRACT.md')

const ROOT = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'doctor-kata-exam-'))

// ── Shared literals ──────────────────────────────────────────────────────────

/** M6: the eight BASE rows, then the hub's. */
const EXPECTED_IDS = [
  'exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'verb-drift', 'render', 'kata'
]

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

const policyCmd = (name) => `ssh exe.dev "integrations policy get ${name} --json"`

/** M6: the two new reads. */
const KATA_POLICY_READ = policyCmd('kata')
const KATA_VM_READ = 'ssh exe.dev "ls kata-hub --json"'

/** M6: the policy every fleet integration carries, and the repair for one that
 *  does not. `integrations attach` is refused at the edge since 2026-09-11, so
 *  no detail may name it. */
const FLEET_POLICY = 'tag:fleet'
const POLICY_GET = `integrations policy get kata --json`
const POLICY_SET = `integrations policy set kata 'tag:fleet' --permanent --if-revision=`
const BUILD_FIX = 'node fleet/kata-hub.mjs'

/** leg (g): the off-policy selector the fourth absence answers and the detail
 *  quotes. */
const OFF_POLICY = 'vm:fleet-r7-2609030900-a1b2'

/** M6: the four red openings, in the order M6 lists them. */
const NO_INTEGRATION = 'no kata http-proxy at the edge'
const NO_BEARER = 'kata carries no Authorization:Bearer header'
const NO_POLICY = "kata's policy is not tag:fleet"
const NO_VM = 'no kata-hub VM'

// ── The fixture ──────────────────────────────────────────────────────────────

const FIXTURE_VERBS = { new: ['--json', '--name', '--pool'], rm: ['--force', '--json'] }
const FIXTURE_NAMES = Object.keys(FIXTURE_VERBS)
const RECORD = path.join(ROOT, 'two-verb.json')
fs.writeFileSync(RECORD, JSON.stringify({ capturedAt: '2026-09-05', verbs: FIXTURE_VERBS }))

const optionsBlock = (verb, flags) =>
  `Command: ${verb}\n` +
  `Does the ${verb} thing.\n` +
  'Options:\n' +
  `${flags.map((f) => `  ${f}  what it does`).join('\n')}\n`

const ok = (stdout) => ({ code: 0, stdout })

const policyJson = (name, selector) => `${JSON.stringify({
  integration: { name, team: false },
  scope: 'personal',
  revision: 'ar1_0123456789abcdef',
  valid: true,
  policy: { selector, wire: selector, expiresAt: null, simpleSelectors: [selector] }
})}\n`

/** leg (g): the policy read's answer for `kata`, as the leg spells it. */
const KATA_POLICY_JSON =
  '{"revision":"ar1_x","valid":true,"policy":{"selector":"tag:fleet","simpleSelectors":["tag:fleet"],"expiresAt":null}}\n'

/** leg (g): the listing entry for `kata`. Its `attachments` array names a VM,
 *  not a `tag:` atom — the policy read is the only thing that may make the row
 *  green. */
const KATA_ENTRY = {
  name: 'kata',
  type: 'http-proxy',
  attachments: [OFF_POLICY],
  config_summary: 'Authorization:Bearer ***'
}

const CLAUDE_MAX = {
  name: 'claude-max',
  type: 'http-proxy',
  attachments: ['tag:fleet'],
  config_summary: 'Authorization:Bearer ***',
  comment: 'account=ops@example.com'
}

const listing = (entries) => ok(`${JSON.stringify(entries)}\n`)

/** The green table: every read answered, the hub healthy. */
const GREEN = () => ({
  [CMD.whoami]: ok('exedev\n'),
  [CMD.billing]: ok(`${JSON.stringify({ max_cpus: 16, max_memory_gb: 64, tier: 'pro' })}\n`),
  [CMD.list]: listing([CLAUDE_MAX, KATA_ENTRY]),
  [CMD.github]: ok('GitHub accounts:\n  popmechanic\n'),
  [CMD.token]: ok('claude-max fresh until 2026-09-12T00:00:00Z\n'),
  [CMD.accounts]: ok(`${JSON.stringify([{ name: 'ops@example.com', expiresAt: '2026-09-12T00:00:00Z', fresh: true }])}\n`),
  [policyCmd('claude-max')]: ok(policyJson('claude-max', FLEET_POLICY)),
  [KATA_POLICY_READ]: ok(KATA_POLICY_JSON),
  [KATA_VM_READ]: ok(`${JSON.stringify({ vms: [{ vm_name: 'kata-hub', status: 'running' }] })}\n`),
  [helpCmd('new')]: ok(optionsBlock('new', FIXTURE_VERBS.new)),
  [helpCmd('rm')]: ok(optionsBlock('rm', FIXTURE_VERBS.rm))
})

/** One run over the green table with `overrides` applied. A command the table
 *  does not carry answers 127, so an unexpected read is a red row, never a
 *  socket. */
async function run (overrides = {}) {
  const table = { ...GREEN(), ...overrides }
  const commands = []
  const exec = async (cmd) => {
    commands.push(cmd)
    return table[cmd] ?? { code: 127, stdout: `no stub for: ${cmd}\n` }
  }
  const result = await doctor({
    config: { cpu: '8', memory: '16GB' },
    exec,
    verbsPath: RECORD
  })
  return { ...result, commands }
}

const rowOf = (result, id) => result.rows.find((r) => r.id === id)
const statusOf = (result, id) => rowOf(result, id)?.status
const detailOf = (result, id) => String(rowOf(result, id)?.detail ?? '')

/** Every row but `kata` is `ok` — so a red verdict is the hub's doing alone. */
const allOkBut = (result, id) =>
  result.rows.filter((r) => r.id !== id).map((r) => [r.id, r.status])
const EVERY_OTHER_OK = EXPECTED_IDS.filter((id) => id !== 'kata').map((id) => [id, 'ok'])

// ── 1. M6 / leg (g) — the ninth row ─────────────────────────────────────────

const green = await run()

{
  assert.deepEqual(
    [...ROW_IDS], EXPECTED_IDS,
    '1 [M6 leg g] ROW_IDS is the eight BASE ids followed by kata'
  )
  assert.deepEqual(
    green.rows.map((r) => r.id), EXPECTED_IDS,
    '1 [M6 leg g] and the doctor reports its rows in that order'
  )
}

// ── 2. M6 / leg (g) — where the two new reads sit ────────────────────────────

{
  const at = (cmd) => green.commands.filter((c) => c === cmd).length
  assert.equal(at(KATA_POLICY_READ), 1, `2 [M6 leg g] ${KATA_POLICY_READ} is issued exactly once`)
  assert.equal(at(KATA_VM_READ), 1, `2 [M6 leg g] ${KATA_VM_READ} is issued exactly once`)

  const accounts = green.commands.indexOf(CMD.accounts)
  assert.notEqual(accounts, -1, '2 [M6 leg g] the accounts read is issued')
  assert.equal(
    green.commands[accounts + 1], KATA_POLICY_READ,
    "2 [M6 leg g] the kata policy read is issued directly after the accounts read"
  )
  assert.equal(
    green.commands[accounts + 2], KATA_VM_READ,
    '2 [M6 leg g] and the ls kata-hub read directly after it, in that order'
  )

  const firstHelp = green.commands.findIndex((c) => c.startsWith('ssh exe.dev "help '))
  assert.notEqual(firstHelp, -1, '2 [M6 leg g] the verb-drift row still issues its help reads')
  assert.ok(
    firstHelp > accounts + 2,
    '2 [M6 leg g] both new reads come before the first help read'
  )
  assert.deepEqual(
    green.commands.filter((c) => c.startsWith('ssh exe.dev "help ')),
    FIXTURE_NAMES.map(helpCmd),
    "2 [M6 leg g] and the help reads are the fixture record's, unchanged"
  )
}

// ── 3. M6 / leg (g) — the green row ─────────────────────────────────────────

{
  assert.equal(statusOf(green, 'kata'), 'ok', `3 [M6 leg g] the kata row is ok; detail: ${detailOf(green, 'kata')}`)
  assert.equal(rowOf(green, 'kata').fix, 'kata', '3 [M6 leg g] its fix is the kata section of first-run.md')
  for (const needle of ['kata', FLEET_POLICY, 'running']) {
    assert.ok(
      detailOf(green, 'kata').includes(needle),
      `3 [M6 leg g] the green detail names ${JSON.stringify(needle)}; got ${detailOf(green, 'kata')}`
    )
  }
  assert.equal(green.verdict, 'ready', '3 [M6 leg g] and a whole fleet with a hub is ready')

  // The entry's attachments name a VM, never `tag:fleet`, so a row that read
  // the listing's attachments rather than the policy read would be red above.
  assert.deepEqual(
    KATA_ENTRY.attachments.filter((a) => String(a).startsWith('tag:')), [],
    '3 [M6 leg g] the fixture entry names no tag: atom, so only the policy read can green the row'
  )
}

// ── 4. M6 / leg (g) — the five absences ─────────────────────────────────────

const ABSENCES = [
  {
    what: 'no kata entry in the listing',
    overrides: { [CMD.list]: listing([CLAUDE_MAX]) },
    begins: NO_INTEGRATION,
    names: [BUILD_FIX]
  },
  {
    what: 'a kata entry with no bearer',
    overrides: { [CMD.list]: listing([CLAUDE_MAX, { name: 'kata', type: 'http-proxy', attachments: [OFF_POLICY] }]) },
    begins: NO_BEARER,
    names: [BUILD_FIX]
  },
  {
    what: 'a policy read exiting 1',
    overrides: { [KATA_POLICY_READ]: { code: 1, stdout: 'integration not found\n' } },
    begins: NO_POLICY,
    names: [POLICY_GET, POLICY_SET]
  },
  {
    what: 'a policy read answering an off-policy selector',
    overrides: { [KATA_POLICY_READ]: ok(policyJson('kata', OFF_POLICY)) },
    begins: NO_POLICY,
    names: [POLICY_GET, POLICY_SET, OFF_POLICY]
  },
  {
    what: 'an ls answering no VM',
    overrides: { [KATA_VM_READ]: ok(`${JSON.stringify({ vms: [] })}\n`) },
    begins: NO_VM,
    names: [BUILD_FIX]
  }
]

for (const absence of ABSENCES) {
  const result = await run(absence.overrides)
  const detail = detailOf(result, 'kata')

  assert.equal(statusOf(result, 'kata'), 'missing', `4 [M6 leg g] ${absence.what}: the kata row is missing`)
  assert.ok(
    detail.startsWith(absence.begins),
    `4 [M6 leg g] ${absence.what}: the detail begins ${JSON.stringify(absence.begins)}; got ${JSON.stringify(detail)}`
  )
  assert.ok(
    detail.includes(' — '),
    `4 [M6 leg g] ${absence.what}: the detail carries the em dash before its fix; got ${JSON.stringify(detail)}`
  )
  for (const needle of absence.names) {
    assert.ok(
      detail.includes(needle),
      `4 [M6 leg g] ${absence.what}: the detail names ${JSON.stringify(needle)}; got ${JSON.stringify(detail)}`
    )
  }
  assert.equal(
    detail.includes('integrations attach'), false,
    `4 [M6 leg g] ${absence.what}: no detail names integrations attach — the edge refuses it; got ${JSON.stringify(detail)}`
  )
  assert.equal(rowOf(result, 'kata').fix, 'kata', `4 [M6 leg g] ${absence.what}: the row's fix is kata`)
  assert.deepEqual(
    allOkBut(result, 'kata'), EVERY_OTHER_OK,
    `4 [M6 leg g] ${absence.what}: every other row is still ok`
  )
  assert.equal(result.verdict, 'not-ready', `4 [M6 leg g] ${absence.what}: a red kata row alone is not-ready`)
}

// ── 5. M7 / leg (h) — the documents ─────────────────────────────────────────

const readDoc = (file) => fs.readFileSync(file, 'utf8')

{
  // first-run.md's sections are the doctor's rows, in order, ending with the hub.
  const headings = readDoc(FIRST_RUN)
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
  assert.deepEqual(
    headings, EXPECTED_IDS,
    '5 [M7 leg h] first-run.md\'s ## headings are ROW_IDS in order, ending ## kata'
  )

  // The one-line add command the narrowed docs pin has to permit: an
  // http-proxy named kata, on the fleet policy, on a single line.
  const kataAdds = readDoc(FIRST_RUN)
    .split('\n')
    .filter((line) => /integrations add http-proxy --name kata .*--policy 'tag:fleet'/.test(line))
  assert.equal(
    kataAdds.length, 1,
    `5 [M7 leg h] first-run.md carries one line adding the kata http-proxy on --policy 'tag:fleet'; got ${kataAdds.length}`
  )

  // The runbook's sixth one-time step.
  const runbook = readDoc(RUNBOOK)
    .split('\n## ')
    .find((section) => section.startsWith('One-time setup') || section.startsWith('# One-time setup'))
  assert.ok(runbook, '5 [M7 leg h] fleet/RUNBOOK.md has a One-time setup section')
  for (const needle of ['**6. `kata` — the hub.**', 'node fleet/kata-hub.mjs', '--copy-tags=false']) {
    assert.ok(
      runbook.includes(needle),
      `5 [M7 leg h] the One-time setup section carries ${JSON.stringify(needle)}`
    )
  }

  // The contract's doctor table, and its integration-naming bullet.
  const contract = readDoc(CONTRACT)
  const table = contract.slice(
    contract.indexOf('- **Doctor ('),
    contract.indexOf('- **Janitor (')
  )
  assert.ok(table.length > 0, '5 [M7 leg h] fleet/CONTRACT.md carries a doctor bullet before the janitor one')
  const kataRows = table.split('\n').filter((line) => /^\s*\|\s*`kata`\s*\|/.test(line))
  assert.equal(
    kataRows.length, 1,
    `5 [M7 leg h] the contract's doctor table carries one | \`kata\` | row; got ${kataRows.length}`
  )

  const naming = contract.slice(
    contract.indexOf('- **Integration naming:**'),
    contract.indexOf('- **Doctor (')
  )
  assert.ok(naming.length > 0, '5 [M7 leg h] fleet/CONTRACT.md carries an Integration naming bullet')
  assert.ok(
    naming.includes('no GitHub object rides'),
    '5 [M7 leg h] the integration bullet says no GitHub object rides the shared tag'
  )
  assert.ok(
    /kata[\s\S]*http-proxy|http-proxy[\s\S]*kata/.test(naming),
    '5 [M7 leg h] and that the kata http-proxy does'
  )

  // Nothing anywhere tells an operator to attach: the verb is refused at the edge.
  const docs = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) docs.push(full)
    }
  }
  walk(FLEET_DIR)
  walk(REFERENCES)
  const attaching = docs.filter((file) => readDoc(file).includes('integrations attach kata'))
  assert.deepEqual(
    attaching.map((f) => path.relative(REPO, f)), [],
    '5 [M7 leg h] no document under fleet/ or references/ names an attach of the kata integration'
  )
}

console.log('ALL TESTS PASSED')
