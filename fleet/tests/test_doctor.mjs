/**
 * Exam for fleet/doctor.mjs — "do you have a fleet?", after the lift.
 *
 * The doctor is three reads: the account answers, the integration objects the
 * launch needs exist with the right attachments, and the golden was built by
 * the `golden-setup.sh` this plugin ships. This file drives all three through
 * the `exec` seam with stubs, then drives the CLI end to end against a fake
 * `ssh` on PATH.
 *
 * What each group checks:
 *
 *   1  loadFleetConfig — absent path → defaults; a file overrides one key only;
 *      an unreadable or non-object file falls back to the defaults.
 *   2  shape — doctor({config, exec}) → {config, rows, verdict}; ROW_IDS is the
 *      three ids in order; every row carries id/status/detail/fix.
 *   3  commands — a green run issues exactly three reads, in order, with the
 *      configured golden name substituted, and nothing else.
 *   4  integrations — each of the four objects missing, or on the tag when it
 *      must not be (only `fleet-runs` rides `tag:fleet`), turns the row red,
 *      and the detail names the object; with --target the target's one object
 *      `gh-<owner>-<repo>` joins the check and the detail carries the
 *      `fleet/target.mjs` command; any GitHub integration other than
 *      `fleet-runs` on the tag is red with or without --target.
 *   5  golden — no stamp → red; a stamp that is some other sha256 → red; a
 *      stamp equal to golden-setup.sh's sha256 → green.
 *   6  verdict — `ready` exactly when all three rows are ok.
 *   7  target validation — anything that is not `owner/repo` is refused rather
 *      than interpolated into an ssh string.
 *   8  CLI — --json, the human two-line miss form, exit codes, and the
 *      ~/.ultrapowers/fleet.json default config path.
 *   9  built-ins only — every import specifier is `node:`-prefixed, checked
 *      live against a mutated copy, and the named exports are present.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { FLEET_DEFAULTS, githubIntegrationFor } from '../lobby.mjs'
import * as doctorModule from '../doctor.mjs'
import {
  doctor,
  loadFleetConfig,
  goldenScriptSha,
  parseIntegrations,
  targetIntegration,
  ROW_IDS,
  DOCTOR_DEFAULTS
} from '../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')

// ── Shared literals ──────────────────────────────────────────────────────────

const EXPECTED_IDS = ['exe-dev', 'integrations', 'golden']

/** The config the stub-driven runs use, so every substitution is visibly a
 *  substitution and not a hard-coded default. */
const CONFIG = { golden: 'gold1' }

const CMD = {
  whoami: 'ssh exe.dev whoami',
  integrations: 'ssh exe.dev "integrations list --json"',
  stamp: 'ssh gold1.exe.xyz cat /home/exedev/.fleet-golden'
}
const READ_ONLY_CMDS = [CMD.whoami, CMD.integrations, CMD.stamp]

const TARGET = 'popmechanic/ultrapowers'
const GH = 'gh-popmechanic-ultrapowers'

/** A sha256 that is definitely not any file's — the "your golden is old" case. */
const OTHER_SHA = 'a'.repeat(64)

/** The sha of the golden script this plugin ships, or null when the script is
 *  not in this tree (it is a sibling deliverable of the same lift). The green
 *  legs need it; the red legs do not. */
const SCRIPT_SHA = await goldenScriptSha()

const integrationsJson = (entries) => `${JSON.stringify({ integrations: entries })}\n`

/** The four objects a fully-built fleet holds, with a target's one object. */
const fullCatalog = () => [
  { name: 'fleet-runs', type: 'github', repository: 'popmechanic/fleet-runs', attachments: ['tag:fleet'] },
  { name: 'claude-max', type: 'http-proxy', attachments: [] },
  { name: 'notify', type: 'notify', attachments: ['tag:fleet'] },
  { name: GH, type: 'github', repository: TARGET, attachments: ['vm:fleet-r7-2609032215-a1b2'] }
]

const GREEN = {
  [CMD.whoami]: { code: 0, stdout: 'marcus\n' },
  [CMD.integrations]: { code: 0, stdout: integrationsJson(fullCatalog()) },
  [CMD.stamp]: { code: 0, stdout: `${SCRIPT_SHA ?? OTHER_SHA}\n` }
}

/** An exec stub over GREEN, recording every command it is asked for. A command
 *  the doctor issues that GREEN does not name is a test failure, not a silent
 *  default: an unknown command answers code 127 so it shows up as a red row. */
function makeExec (overrides = {}) {
  const calls = []
  const table = { ...GREEN, ...overrides }
  const exec = async (cmd) => {
    calls.push(cmd)
    return table[cmd] ?? { code: 127, stdout: `unstubbed command: ${cmd}\n` }
  }
  return { exec, calls }
}

function assertRowShape (result, where) {
  assert.ok(result && typeof result === 'object', `${where}: doctor resolves an object`)
  assert.ok(Array.isArray(result.rows), `${where}: result.rows is an array`)
  assert.deepEqual(result.rows.map((r) => r.id), EXPECTED_IDS, `${where}: the three ids in order`)
  for (const r of result.rows) {
    assert.ok(['ok', 'missing'].includes(r.status), `${where}: ${r.id} status is ok or missing`)
    assert.equal(typeof r.detail, 'string', `${where}: ${r.id} carries a detail string`)
    assert.ok(r.detail.length > 0, `${where}: ${r.id}'s detail says something`)
    assert.equal(typeof r.fix, 'string', `${where}: ${r.id} carries a fix`)
  }
}

const rowById = (result, id) => result.rows.find((r) => r.id === id)

// ── 1. loadFleetConfig ───────────────────────────────────────────────────────

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-config-'))
  const absent = path.join(dir, 'absent.json')
  assert.deepEqual(
    await loadFleetConfig({ path: absent }),
    DOCTOR_DEFAULTS,
    '1 an absent config file yields the defaults'
  )

  const one = path.join(dir, 'one.json')
  fs.writeFileSync(one, JSON.stringify({ golden: 'my-golden', nonsense: 'ignored' }))
  const loaded = await loadFleetConfig({ path: one })
  assert.equal(loaded.golden, 'my-golden', '1 a named key overrides its default')
  assert.equal(loaded.fleetRuns, DOCTOR_DEFAULTS.fleetRuns, '1 an omitted key keeps its default')
  assert.equal(loaded.nonsense, undefined, '1 an unknown key is ignored')

  const broken = path.join(dir, 'broken.json')
  fs.writeFileSync(broken, 'not json at all')
  assert.deepEqual(
    await loadFleetConfig({ path: broken }),
    DOCTOR_DEFAULTS,
    '1 an unparseable config file yields the defaults'
  )

  const scalar = path.join(dir, 'scalar.json')
  fs.writeFileSync(scalar, '"a string"')
  assert.deepEqual(
    await loadFleetConfig({ path: scalar }),
    DOCTOR_DEFAULTS,
    '1 a config file that is not an object yields the defaults'
  )

  // The doctor copies its config reader rather than importing lobby.mjs's, so
  // that it depends on nothing. That copy has to stay a copy: a doctor whose
  // default golden or fleet-runs path differs from the launcher's would
  // certify a fleet no launch ever looks at.
  assert.deepEqual(
    { ...DOCTOR_DEFAULTS },
    { ...FLEET_DEFAULTS },
    '1 DOCTOR_DEFAULTS and lobby.mjs FLEET_DEFAULTS are the same config defaults'
  )
}

// ── 2. shape ─────────────────────────────────────────────────────────────────

{
  const { exec } = makeExec()
  const result = await doctor({ config: CONFIG, exec })
  assertRowShape(result, '2')
  assert.equal(result.config.golden, 'gold1', '2 the result echoes the config it ran against')
  assert.deepEqual([...ROW_IDS], EXPECTED_IDS, '2 ROW_IDS is the three row ids in order')
}

// ── 3. commands ──────────────────────────────────────────────────────────────

{
  const { exec, calls } = makeExec()
  await doctor({ config: CONFIG, exec })
  assert.deepEqual(calls, READ_ONLY_CMDS, '3 a run issues exactly the three reads, in order')
}

{
  // Nothing in a run creates, copies or removes anything: running it twice
  // issues the same three reads again.
  const { exec, calls } = makeExec()
  await doctor({ config: CONFIG, exec })
  await doctor({ config: CONFIG, exec })
  assert.deepEqual(calls, [...READ_ONLY_CMDS, ...READ_ONLY_CMDS], '3 the doctor is a read, twice over')
}

{
  const { exec, calls } = makeExec()
  await doctor({ config: { golden: 'second-fleet' }, exec })
  assert.ok(
    calls.some((c) => c.includes('second-fleet.exe.xyz')),
    '3 the golden name is substituted from the config'
  )
}

// ── 4. integrations ──────────────────────────────────────────────────────────

{
  const { exec } = makeExec()
  const green = await doctor({ config: CONFIG, exec })
  assert.equal(rowById(green, 'integrations').status, 'ok', '4 a full catalog is ok without a target')
}

for (const name of ['fleet-runs', 'claude-max', 'notify']) {
  const catalog = fullCatalog().filter((e) => e.name !== name)
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const result = await doctor({ config: CONFIG, exec })
  const row = rowById(result, 'integrations')
  assert.equal(row.status, 'missing', `4 a missing ${name} turns the row red`)
  assert.ok(row.detail.includes(name), `4 the red detail names ${name}; got ${row.detail}`)
}

{
  // fleet-runs must be ON the tag: every sandbox writes its receipts there.
  const catalog = fullCatalog().map((e) =>
    e.name === 'fleet-runs' ? { ...e, attachments: [] } : e
  )
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'missing', '4 fleet-runs off the tag turns the row red')
  assert.ok(row.detail.includes('tag:fleet'), `4 the detail names the tag; got ${row.detail}`)
}

{
  // claude-max must NOT be on the tag: on the tag it is the subscription handed
  // to every fleet VM for as long as the object lives.
  const catalog = fullCatalog().map((e) =>
    e.name === 'claude-max' ? { ...e, attachments: ['tag:fleet'] } : e
  )
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'missing', '4 claude-max ON the tag turns the row red')
  assert.ok(row.detail.includes('claude-max'), `4 the detail names claude-max; got ${row.detail}`)
}

{
  // Without --target the per-target object is not asked about at all, so a
  // fleet with no targets yet is still green.
  const catalog = fullCatalog().filter((e) => e.name !== GH)
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'ok', '4 no target object is fine when no --target was given')
}

{
  const catalog = fullCatalog().filter((e) => e.name !== GH)
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const row = rowById(await doctor({ config: CONFIG, exec, target: TARGET }), 'integrations')
  assert.equal(row.status, 'missing', `4 --target with no ${GH} turns the row red`)
  assert.ok(row.detail.includes(GH), `4 the detail names the missing object; got ${row.detail}`)
  assert.ok(
    row.detail.includes(`fleet/target.mjs ${TARGET}`),
    `4 the detail names the command that builds it; got ${row.detail}`
  )
  assert.ok(!row.detail.includes('target.mjs add'), `4 there is no add verb; got ${row.detail}`)
}

for (const extra of [
  // The target's own object on the tag: red with and without --target.
  { name: GH, type: 'github', repository: TARGET, attachments: ['tag:fleet'] },
  // Another repo's object on the tag, recognised by its type…
  { name: 'gh-popmechanic-other', type: 'github', repository: 'popmechanic/other', attachments: ['tag:fleet'] },
  // …by its repository field alone…
  { name: 'legacy-github', repository: 'popmechanic/legacy', attachments: ['tag:fleet'] },
  // …or by the fleet's own naming when the listing says nothing else.
  { name: 'gh-bare-name', attachments: ['tag:fleet'] }
]) {
  // A tag attachment lands on every fleet VM, and two GitHub integrations
  // naming one repo on one VM leave the edge to pick by no documented rule
  // — so any GitHub object but fleet-runs on the tag is red, whether or not
  // --target named it.
  const catalog = fullCatalog().filter((e) => e.name !== extra.name).concat([extra])
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(catalog) }
  })
  const named = rowById(await doctor({ config: CONFIG, exec, target: TARGET }), 'integrations')
  assert.equal(named.status, 'missing', `4 ${extra.name} on the tag turns the row red with --target`)
  assert.ok(named.detail.includes(extra.name), `4 the detail names it; got ${named.detail}`)
  assert.ok(named.detail.includes('detach'), `4 and says to detach; got ${named.detail}`)
  const unnamed = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(unnamed.status, 'missing', `4 ${extra.name} on the tag turns the row red without --target too`)
  assert.ok(unnamed.detail.includes(extra.name), `4 the detail names it; got ${unnamed.detail}`)
}

{
  // A non-GitHub object on the tag is not the doctor's concern here: notify
  // rides the tag in the full catalog and the row is green.
  const { exec } = makeExec({
    [CMD.integrations]: { code: 0, stdout: integrationsJson(fullCatalog()) }
  })
  const row = rowById(await doctor({ config: CONFIG, exec, target: TARGET }), 'integrations')
  assert.equal(row.status, 'ok', '4 a full catalog with the target object is ok')
}

{
  const { exec } = makeExec({ [CMD.integrations]: { code: 1, stdout: 'nope\n' } })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'missing', '4 a failing integrations list turns the row red')
}

{
  const { exec } = makeExec({ [CMD.integrations]: { code: 0, stdout: 'not json\n' } })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'missing', '4 unreadable JSON turns the row red')
}

{
  // The reader survives the shapes exe.dev might answer with: a bare array, an
  // `id` instead of a `name`, and an attachment as an object rather than a
  // `tag:` string. Each of these turning the row red would be a false alarm.
  const bare = JSON.stringify([
    { name: 'fleet-runs', attached: [{ tag: 'fleet' }] },
    { id: 'claude-max' },
    { name: 'notify', attachedTo: ['tag:fleet'] }
  ])
  const { exec } = makeExec({ [CMD.integrations]: { code: 0, stdout: bare } })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'integrations')
  assert.equal(row.status, 'ok', `4 a bare-array answer with object attachments reads ok; got ${row.detail}`)
}

{
  assert.equal(parseIntegrations('garbage'), null, '4 parseIntegrations refuses non-JSON')
  assert.equal(parseIntegrations('{"nope":1}'), null, '4 parseIntegrations refuses a shapeless object')
  const parsed = parseIntegrations('[{"name":"a","attachments":["tag:fleet","vm:x"]}]')
  assert.equal(parsed.get('a').tags.has('fleet'), true, '4 parseIntegrations reads a tag attachment')
  assert.equal(parsed.get('a').tags.has('x'), false, '4 a vm attachment is not a tag')
  assert.equal(targetIntegration('owner/repo'), 'gh-owner-repo', '4 targetIntegration replaces the slash')

  // The doctor looks for the object fleet/target.mjs creates, by the name
  // fleet/lobby.mjs gives it. A doctor checking for `gh-owner-repo` while the
  // launcher attaches `target-owner-repo` would be green on a fleet no run can
  // use.
  assert.equal(
    targetIntegration(TARGET),
    githubIntegrationFor(TARGET),
    '4 the doctor and lobby.mjs name the target integration alike'
  )
}

// ── 5. golden ────────────────────────────────────────────────────────────────

{
  const { exec } = makeExec({ [CMD.stamp]: { code: 1, stdout: '' } })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'golden')
  assert.equal(row.status, 'missing', '5 no stamp on the golden turns the row red')
  assert.ok(row.detail.includes('golden.sh build'), `5 the detail names the build command; got ${row.detail}`)
}

{
  const { exec } = makeExec({ [CMD.stamp]: { code: 0, stdout: 'not-a-sha\n' } })
  const row = rowById(await doctor({ config: CONFIG, exec }), 'golden')
  assert.equal(row.status, 'missing', '5 a stamp that is not a sha256 turns the row red')
}

if (SCRIPT_SHA === null) {
  // fleet/golden-setup.sh is not in this tree. The doctor's contract for that
  // is a red row that says so rather than a green one it cannot justify.
  const { exec } = makeExec()
  const row = rowById(await doctor({ config: CONFIG, exec }), 'golden')
  assert.equal(row.status, 'missing', '5 an unreadable golden-setup.sh turns the row red')
  assert.ok(
    row.detail.includes('golden-setup.sh'),
    `5 the detail names the script it could not hash; got ${row.detail}`
  )
  console.error('note: fleet/golden-setup.sh absent — the green golden legs did not run')
} else {
  assert.match(SCRIPT_SHA, /^[0-9a-f]{64}$/, '5 goldenScriptSha returns a sha256')

  const stale = makeExec({ [CMD.stamp]: { code: 0, stdout: `${OTHER_SHA}\n` } })
  const staleRow = rowById(await doctor({ config: CONFIG, exec: stale.exec }), 'golden')
  assert.equal(staleRow.status, 'missing', '5 a stamp from another script turns the row red')
  assert.ok(
    staleRow.detail.includes('golden.sh build'),
    `5 a stale golden names the rebuild command; got ${staleRow.detail}`
  )

  const fresh = makeExec()
  const freshRow = rowById(await doctor({ config: CONFIG, exec: fresh.exec }), 'golden')
  assert.equal(freshRow.status, 'ok', `5 a stamp equal to the script's sha is ok; got ${freshRow.detail}`)
}

// ── 6. verdict ───────────────────────────────────────────────────────────────

if (SCRIPT_SHA !== null) {
  const { exec } = makeExec()
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(result.verdict, 'ready', '6 three ok rows is a ready verdict')
}

for (const cmd of READ_ONLY_CMDS) {
  const { exec } = makeExec({ [cmd]: { code: 1, stdout: '' } })
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(result.verdict, 'not-ready', `6 one red row is not-ready (${cmd})`)
}

{
  const { exec } = makeExec({ [CMD.whoami]: { code: 0, stdout: '\n' } })
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(rowById(result, 'exe-dev').status, 'missing', '6 an empty whoami is not an account')
}

// ── 7. target validation ─────────────────────────────────────────────────────

for (const bad of ['owner', 'owner/repo; rm -rf /', 'owner/repo extra', '', '../../etc', 'a/b/c']) {
  const { exec, calls } = makeExec()
  await assert.rejects(
    () => doctor({ config: CONFIG, exec, target: bad }),
    `7 ${JSON.stringify(bad)} is refused as a target`
  )
  assert.deepEqual(calls, [], `7 nothing runs for a refused target (${JSON.stringify(bad)})`)
}

{
  const { exec } = makeExec()
  const result = await doctor({ config: CONFIG, exec, target: 'a-b.c/d_e.f' })
  assert.ok(result, '7 a dotted, hyphenated owner/repo is accepted')
}

// ── 8. CLI ───────────────────────────────────────────────────────────────────

const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-'))
const absentConfig = path.join(cliRoot, 'absent.json')
assert.equal(fs.existsSync(absentConfig), false, '8 fixture: the CLI config path starts absent')

function fakeSshDir (name, body) {
  const dir = fs.mkdtempSync(path.join(cliRoot, `${name}-`))
  const log = path.join(dir, 'ssh.log')
  fs.writeFileSync(path.join(dir, 'ssh'), body(log), { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'ssh'), 0o755)
  return { dir, log }
}

const RED_SSH = fakeSshDir('red', (log) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
exit 1
`)

const CATALOG_JSON = JSON.stringify({ integrations: fullCatalog() })
const GREEN_SSH = fakeSshDir('green', (log) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *whoami*) echo marcus ;;
  *integrations*) echo '${CATALOG_JSON}' ;;
  *fleet-golden*) echo ${SCRIPT_SHA ?? OTHER_SHA} ;;
  *) : ;;
esac
exit 0
`)

const runCli = (args, { sshDir, home } = {}) => {
  const env = { ...process.env, PATH: `${sshDir}:${process.env.PATH}` }
  if (home) env.HOME = home
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], { encoding: 'utf8', env, timeout: 60000 })
}

{
  const res = runCli(['--json', '--config', absentConfig], { sshDir: RED_SSH.dir })
  assert.equal(res.status, 1, `8 a not-ready run exits 1; stderr: ${res.stderr}`)
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `8 --json prints parseable JSON; got ${JSON.stringify(res.stdout)}`)
  assert.equal(parsed.verdict, 'not-ready', '8 an all-red CLI run is not-ready')
  assert.deepEqual(parsed.rows.map((r) => r.id), EXPECTED_IDS, '8 the envelope carries the three rows in order')
  assert.deepEqual(parsed.config, DOCTOR_DEFAULTS, '8 an absent --config path yields the defaults')
}

{
  const res = runCli(['--config', absentConfig], { sshDir: RED_SSH.dir })
  const lines = res.stdout.trimEnd().split('\n')
  assert.equal(lines.length, EXPECTED_IDS.length * 2, '8 the human form is a row and a fix per miss')
  for (const [i, id] of EXPECTED_IDS.entries()) {
    assert.ok(lines[i * 2].includes(id), `8 the human form names ${id}`)
    assert.ok(
      lines[i * 2 + 1].includes('references/first-run.md'),
      `8 a red ${id} points at first-run.md; got ${lines[i * 2 + 1]}`
    )
  }
}

if (SCRIPT_SHA !== null) {
  const res = runCli(['--json', '--config', absentConfig], { sshDir: GREEN_SSH.dir })
  assert.equal(res.status, 0, `8 a ready run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.equal(JSON.parse(res.stdout).verdict, 'ready', '8 an all-green CLI run is ready')
}

{
  // The default config path is ~/.ultrapowers/fleet.json, read from HOME.
  const home = fs.mkdtempSync(path.join(cliRoot, 'home-'))
  fs.mkdirSync(path.join(home, '.ultrapowers'))
  fs.writeFileSync(
    path.join(home, '.ultrapowers', 'fleet.json'),
    JSON.stringify({ golden: 'home-golden' })
  )
  const res = runCli(['--json'], { sshDir: RED_SSH.dir, home })
  assert.equal(
    JSON.parse(res.stdout).config.golden,
    'home-golden',
    '8 the CLI reads ~/.ultrapowers/fleet.json when no --config is given'
  )
  assert.ok(
    fs.readFileSync(RED_SSH.log, 'utf8').includes('home-golden.exe.xyz'),
    '8 the config from HOME reaches the commands'
  )
}

{
  const res = runCli(['--json', '--config', absentConfig, '--target', 'owner/repo; whoami'], {
    sshDir: RED_SSH.dir
  })
  assert.notEqual(res.status, 0, '8 a malformed --target is refused rather than run')
}

// ── 9. built-ins only ────────────────────────────────────────────────────────

{
  const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
  const offenders = (source) => {
    const specs = []
    for (const m of source.matchAll(IMPORT_RE)) specs.push(m[1])
    return specs.filter((s) => !/^node:/.test(s))
  }

  const source = fs.readFileSync(DOCTOR_SRC, 'utf8')
  assert.deepEqual(
    offenders(source),
    [],
    '9 every import specifier in fleet/doctor.mjs is node:-prefixed'
  )

  // The extractor is live, not vacuous: one added bare-package import shows up.
  const mutantDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mutant-'))
  fs.writeFileSync(path.join(mutantDir, 'doctor.mjs'), `${source}\nimport fs2 from 'fs'\n`)
  assert.deepEqual(
    offenders(fs.readFileSync(path.join(mutantDir, 'doctor.mjs'), 'utf8')),
    ['fs'],
    '9 the extractor catches a non-built-in import when one is added'
  )

  for (const name of ['ROW_IDS', 'loadFleetConfig', 'doctor', 'DOCTOR_DEFAULTS', 'defaultExec']) {
    assert.ok(Object.keys(doctorModule).includes(name), `9 fleet/doctor.mjs exports ${name}`)
  }
}

console.log('ALL TESTS PASSED')
