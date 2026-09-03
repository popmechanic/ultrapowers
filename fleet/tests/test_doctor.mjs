/**
 * Exam for Task 1 — "The doctor answers 'do you have a fleet'".
 *
 * Every assertion below names the Proof leg (a)…(j) it discharges and the
 * Machine clause [M1]…[M8] that leg comes from, so the exam reads back onto
 * the task text one line at a time:
 *
 *   (a) [M1] loadFleetConfig: absent path → the four-key defaults; a file
 *            holding {"orchestrator":"my-orch"} overrides that key only.
 *   (b) [M2] doctor({config, exec}) → {config, rows, verdict}; five rows with
 *            exactly the five ids in order, each carrying status/detail/fix,
 *            and the five fix strings are exactly the five RUNBOOK headings.
 *   (c) [M3][M5] a green probe-absent run issues exactly the eight read-only
 *            commands, in order, substituted from config, and nothing else.
 *   (d) [M3] one stub per red condition → exactly that row `missing`, every
 *            other read-only row `ok`, golden detail naming engine clone /
 *            xdist / settings.
 *   (e) [M4] a token stdout carrying a secret never reaches the result.
 *   (f) [M5] probe:true green → cp, the preflight ssh fetch (byte-equal to what
 *            fleet/tests/test_preflight.mjs pins), rm — row ok, detail `ssh`;
 *            fetch red + ls-remote green → detail exactly `https-fallback`.
 *   (g) [M5] cp red / BLOCKED / a rejecting exec all still issue the rm; a red
 *            prior row skips the probe entirely.
 *   (h) [M6] verdict is `ready` exactly when the four read-only rows are ok and
 *            preflight is ok or skipped.
 *   (i) [M7] the CLI: --json, exit codes, the human two-line miss form,
 *            --probe, and the ~/.ultrapowers/fleet.json default config path.
 *   (j) [M8] every import specifier is `node:`-prefixed or `./preflight.mjs`
 *            (checked live against a mutated copy), and the four named exports.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { preflight } from '../preflight.mjs'
import * as doctorModule from '../doctor.mjs'
import { doctor, loadFleetConfig, ROW_IDS, DOCTOR_DEFAULTS } from '../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')

// ── The task's shared literals ───────────────────────────────────────────────

// [M1] The four-key default config, verbatim from the Machine clause.
const DEFAULT_CONFIG = {
  orchestrator: 'fleet-orchestrator',
  golden: 'fleet-golden',
  repoDir: '/home/exedev/repo',
  tokenPath: '/home/exedev/.fleet/claude-oauth-token'
}

// [M2] The five row ids, in order.
const EXPECTED_IDS = ['exe-dev', 'orchestrator', 'golden', 'token', 'preflight']

// [M2] The five `fix` strings — exact `## ` headings in fleet/RUNBOOK.md.
const EXPECTED_FIXES = [
  'exe.dev account',
  'Orchestrator VM',
  'Golden VM build',
  'Engine auth — the Max subscription, delivered per run (#213)',
  'Preflight'
]

const STATUSES = new Set(['ok', 'missing', 'skipped'])

// The config the stub-driven tests run against, so every substitution in the
// read-only commands is visibly a substitution and not a hard-coded default.
const CONFIG = { orchestrator: 'orch1', golden: 'gold1', repoDir: '/repo', tokenPath: '/tok' }

const HEX40 = 'd6efce4da55f6a750a2632d30a70a0c635113c68'
const GOLDEN_HEX40 = '1f2e3d4c5b6a798899001122334455667788990a'

// The manifest the `show` command answers and the text `describe` prints.
const MANIFEST = '{"name":"ultrapowers","version":"0.3.3"}\n'
const DESCRIBE = 'v0.3.3-4-gabc'

// [M3] The eight read-only commands, byte for byte, with <orch>, <golden>,
// <repoDir> and <tokenPath> substituted from CONFIG. The golden's engine
// command spells the sandbox engine clone literally: that path is fixed on
// every sandbox, so it is not <repoDir>.
const CMD = {
  whoami: 'ssh exe.dev whoami',
  revParse: "ssh orch1.exe.xyz 'git -C /repo rev-parse HEAD'",
  show: "ssh orch1.exe.xyz 'git -C /repo show HEAD:.claude-plugin/plugin.json'",
  describe: "ssh orch1.exe.xyz 'git -C /repo describe --tags --always'",
  engine:
    "ssh gold1.exe.xyz 'test -d /home/exedev/repo/fleet/node_modules && git -C /home/exedev/repo rev-parse HEAD'",
  xdist: `ssh gold1.exe.xyz 'python3 -c "import xdist"'`,
  settings: "ssh gold1.exe.xyz 'cat ~/.claude/settings.json'",
  token:
    "ssh orch1.exe.xyz 'stat -c %a /tok && head -c 10 /tok | grep -q ^sk-ant-oat && echo prefix-ok'"
}

const READ_ONLY_CMDS = [
  CMD.whoami,
  CMD.revParse,
  CMD.show,
  CMD.describe,
  CMD.engine,
  CMD.xdist,
  CMD.settings,
  CMD.token
]

// [M5] The probe's two lifecycle commands.
const CP_CMD = 'ssh exe.dev "cp gold1 fleet-doctor-probe --json"'
const RM_CMD = 'ssh exe.dev "rm fleet-doctor-probe --json"'

// [M5] The preflight commands for orchVm 'orch1', probeVm 'fleet-doctor-probe'
// — the strings fleet/tests/test_preflight.mjs pins. Derived from the real
// module below so the byte-equality is live, not a copied literal.
const FETCH_CMD =
  "ssh orch1.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@fleet-doctor-probe.exe.xyz/home/exedev/repo'"
const LS_REMOTE_CMD =
  "ssh orch1.exe.xyz 'git ls-remote https://fleet-doctor-probe.exe.xyz/repo.git'"

{
  const derived = []
  await preflight({
    orchVm: 'orch1',
    probeVm: 'fleet-doctor-probe',
    exec: async (cmd) => {
      derived.push(cmd)
      return { code: 1, stdout: '' }
    }
  })
  assert.equal(derived[0], FETCH_CMD, '(f) [M5] the pinned fetch command must be preflight\'s own')
  assert.equal(derived[1], LS_REMOTE_CMD, '(f) [M5] the pinned ls-remote command must be preflight\'s own')
}

// ── Stub exec, shaped exactly as fleet/preflight.mjs consumes it ─────────────

const GREEN = {
  [CMD.whoami]: { code: 0, stdout: 'marcus\n' },
  [CMD.revParse]: { code: 0, stdout: `${HEX40}\n` },
  [CMD.show]: { code: 0, stdout: MANIFEST },
  [CMD.describe]: { code: 0, stdout: `${DESCRIBE}\n` },
  [CMD.engine]: { code: 0, stdout: `${GOLDEN_HEX40}\n` },
  [CMD.xdist]: { code: 0, stdout: '' },
  [CMD.settings]: { code: 0, stdout: '{"permissions":{"defaultMode":"bypassPermissions"}}\n' },
  [CMD.token]: { code: 0, stdout: '600\nprefix-ok\n' },
  [CP_CMD]: { code: 0, stdout: 'cloned\n' },
  [RM_CMD]: { code: 0, stdout: 'removed\n' },
  [FETCH_CMD]: { code: 0, stdout: '' },
  [LS_REMOTE_CMD]: { code: 0, stdout: '' }
}

function makeExec (overrides = {}, opts = {}) {
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    if (opts.throwOn && cmd === opts.throwOn) throw new Error('exec rejected')
    if (Object.prototype.hasOwnProperty.call(overrides, cmd)) return overrides[cmd]
    if (Object.prototype.hasOwnProperty.call(GREEN, cmd)) return GREEN[cmd]
    return { code: 0, stdout: '' }
  }
  return { exec, executed }
}

const rowOf = (result, id) => {
  const row = result.rows.find((r) => r.id === id)
  assert.ok(row, `row '${id}' must be present`)
  return row
}

// [M2] Shape assertions applied to every scenario's rows.
function assertRowShape (result, where) {
  assert.deepEqual(
    result.rows.map((r) => r.id),
    EXPECTED_IDS,
    `${where} [M2] rows must be the five ids in exactly this order`
  )
  for (const row of result.rows) {
    assert.ok(
      STATUSES.has(row.status),
      `${where} [M2] row '${row.id}' status must be one of ok/missing/skipped, got ${JSON.stringify(row.status)}`
    )
    assert.equal(typeof row.detail, 'string', `${where} [M2] row '${row.id}' must carry a detail string`)
    assert.equal(typeof row.fix, 'string', `${where} [M2] row '${row.id}' must carry a fix string`)
  }
  assert.deepEqual(
    result.rows.map((r) => r.fix),
    EXPECTED_FIXES,
    `${where} [M2] the five fix strings must be the five RUNBOOK headings`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (a) [M1] — loadFleetConfig defaults and single-key override.
// ─────────────────────────────────────────────────────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-config-'))
  const cfgPath = path.join(tmp, 'fleet.json')

  assert.equal(fs.existsSync(cfgPath), false, '(a) fixture: the config path must start absent')
  assert.deepEqual(
    await loadFleetConfig({ path: cfgPath }),
    DEFAULT_CONFIG,
    '(a) [M1] an absent config file yields exactly the four-key default object'
  )

  fs.writeFileSync(cfgPath, JSON.stringify({ orchestrator: 'my-orch' }))
  assert.deepEqual(
    await loadFleetConfig({ path: cfgPath }),
    { ...DEFAULT_CONFIG, orchestrator: 'my-orch' },
    '(a) [M1] a file holding {"orchestrator":"my-orch"} overrides that one key and leaves the other three at their defaults'
  )

  // [M1][M8] the exported defaults are that same four-key literal.
  assert.deepEqual(
    DOCTOR_DEFAULTS,
    DEFAULT_CONFIG,
    '(a) [M1][M8] DOCTOR_DEFAULTS is the four-key default config'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (b) [M2] — the all-green envelope: ids, per-row fields, fix headings.
// Leg (c) [M3][M5] — the exact six commands, in order, and nothing else.
// Leg (h) [M6] — verdict `ready` for the all-green probe-absent run.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec })

  assert.deepEqual(
    Object.keys(result).sort(),
    ['config', 'rows', 'verdict'],
    '(b) [M2] doctor resolves to exactly { config, rows, verdict }'
  )
  assert.deepEqual(result.config, CONFIG, '(b) [M2] the envelope carries the config it ran against')
  assertRowShape(result, '(b)')
  assert.deepEqual(
    result.rows.map((r) => r.status),
    ['ok', 'ok', 'ok', 'ok', 'skipped'],
    '(b) [M2][M5] an all-green run with probe absent: four ok rows and a skipped preflight row'
  )

  assert.deepEqual(
    executed,
    READ_ONLY_CMDS,
    '(c) [M3] a green probe-absent run issues exactly the eight read-only commands, in order, and nothing else'
  )
  assert.equal(
    executed.some((c) => c.includes('fleet-doctor-probe')),
    false,
    '(c) [M5] with probe absent no command containing fleet-doctor-probe is issued'
  )

  assert.equal(result.verdict, 'ready', '(h) [M6] four ok rows plus a skipped preflight row is `ready`')
}

// [M5] `probe: false` behaves as `probe` absent.
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec, probe: false })
  assert.equal(rowOf(result, 'preflight').status, 'skipped', '(c) [M5] probe:false leaves the preflight row skipped')
  assert.deepEqual(executed, READ_ONLY_CMDS, '(c) [M5] probe:false issues exactly the eight read-only commands')
  assert.equal(result.verdict, 'ready', '(h) [M6] probe:false all-green is `ready`')
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (d) [M3] — one stub per red condition.
// Leg (h) [M6] — each of them makes the verdict `not-ready`.
// ─────────────────────────────────────────────────────────────────────────────
const RED_CASES = [
  {
    name: 'whoami code 1',
    overrides: { [CMD.whoami]: { code: 1, stdout: '' } },
    red: 'exe-dev'
  },
  {
    name: 'whoami code 0 with empty stdout',
    overrides: { [CMD.whoami]: { code: 0, stdout: '' } },
    red: 'exe-dev'
  },
  {
    // code 0 with no 40-hex prefix — a code-only check fails this leg.
    name: 'rev-parse code 0 with `fatal: not a git repository`',
    overrides: { [CMD.revParse]: { code: 0, stdout: 'fatal: not a git repository\n' } },
    red: 'orchestrator'
  },
  {
    name: 'engine command code 1 — no clone or no node_modules',
    overrides: { [CMD.engine]: { code: 1, stdout: '' } },
    red: 'golden',
    detailIncludes: 'engine clone'
  },
  {
    // code 0 with no 40-hex prefix — a code-only check fails this leg too.
    name: 'engine command code 0 with a non-hex line',
    overrides: { [CMD.engine]: { code: 0, stdout: 'no such directory\n' } },
    red: 'golden',
    detailIncludes: 'engine clone'
  },
  {
    name: 'xdist code 1',
    overrides: { [CMD.xdist]: { code: 1, stdout: "ModuleNotFoundError: No module named 'xdist'\n" } },
    red: 'golden',
    detailIncludes: 'xdist'
  },
  {
    name: 'settings containing ANTHROPIC_API_KEY',
    overrides: { [CMD.settings]: { code: 0, stdout: '{"env":{"ANTHROPIC_API_KEY":"sk-x"}}\n' } },
    red: 'golden',
    detailIncludes: 'settings'
  },
  {
    name: 'settings containing ANTHROPIC_BASE_URL',
    overrides: { [CMD.settings]: { code: 0, stdout: '{"env":{"ANTHROPIC_BASE_URL":"https://gw"}}\n' } },
    red: 'golden',
    detailIncludes: 'settings'
  },
  {
    name: 'token mode 644',
    overrides: { [CMD.token]: { code: 0, stdout: '644\nprefix-ok\n' } },
    red: 'token',
    // Context: "a 644 file is missing with detail naming the mode".
    detailIncludes: '644'
  },
  {
    name: 'token stdout `600` alone',
    overrides: { [CMD.token]: { code: 0, stdout: '600\n' } },
    red: 'token'
  }
]

for (const testCase of RED_CASES) {
  const { exec } = makeExec(testCase.overrides)
  const result = await doctor({ config: CONFIG, exec })
  const where = `(d) [${testCase.name}]`

  assertRowShape(result, where)
  for (const id of EXPECTED_IDS.slice(0, 4)) {
    assert.equal(
      rowOf(result, id).status,
      id === testCase.red ? 'missing' : 'ok',
      `${where} [M3] row '${id}' must be ${id === testCase.red ? 'missing' : 'ok'} under this stub`
    )
  }
  if (testCase.detailIncludes) {
    assert.ok(
      rowOf(result, testCase.red).detail.includes(testCase.detailIncludes),
      `${where} [M3] the '${testCase.red}' detail must name '${testCase.detailIncludes}', got ${JSON.stringify(rowOf(result, testCase.red).detail)}`
    )
  }
  assert.equal(
    result.verdict,
    'not-ready',
    `${where} [M6] a red read-only row makes the verdict not-ready`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (e) [M4] — the token value never reaches the result.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec } = makeExec({
    [CMD.token]: { code: 0, stdout: '600\nsk-ant-oat01-SECRETVALUE\nprefix-ok\n' }
  })
  const result = await doctor({ config: CONFIG, exec })

  assert.equal(
    JSON.stringify(result).includes('SECRETVALUE'),
    false,
    '(e) [M4] no field of the returned object may carry stdout beyond the mode and prefix-ok'
  )
  for (const row of result.rows) {
    assert.equal(
      row.detail.includes('SECRETVALUE'),
      false,
      `(e) [M4] row '${row.id}' detail must not carry the token value`
    )
  }
  assert.equal(
    JSON.stringify(result).includes('sk-ant-oat01'),
    false,
    '(e) [M4] no field of the returned object may carry the token prefix line'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (f) [M5] — the probe lifecycle, green.
// Leg (h) [M6] — an all-green probe run is `ready`.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assertRowShape(result, '(f) green probe')
  assert.deepEqual(
    executed,
    [...READ_ONLY_CMDS, CP_CMD, FETCH_CMD, RM_CMD],
    '(f) [M5] a green probe run issues the six read-only commands, then the cp, then preflight\'s ssh fetch, then the rm'
  )
  assert.equal(rowOf(result, 'preflight').status, 'ok', '(f) [M5] verdict `ssh` makes the preflight row ok')
  assert.equal(
    rowOf(result, 'preflight').detail,
    'ssh',
    '(f) [M5] the preflight row detail is exactly the preflight verdict'
  )
  assert.equal(result.verdict, 'ready', '(h) [M6] four ok rows plus an ok preflight row is `ready`')
}

// [M5] fetch red, ls-remote green → detail exactly `https-fallback`.
{
  const { exec, executed } = makeExec({ [FETCH_CMD]: { code: 1, stdout: 'permission denied\n' } })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.deepEqual(
    executed,
    [...READ_ONLY_CMDS, CP_CMD, FETCH_CMD, LS_REMOTE_CMD, RM_CMD],
    '(f) [M5] a fallback probe run issues the cp, both preflight legs, then the rm'
  )
  assert.equal(rowOf(result, 'preflight').status, 'ok', '(f) [M5] verdict `https-fallback` makes the preflight row ok')
  assert.equal(
    rowOf(result, 'preflight').detail,
    'https-fallback',
    '(f) [M5] the preflight row detail is exactly `https-fallback`'
  )
  assert.equal(result.verdict, 'ready', '(h) [M6] an https-fallback preflight row is still `ready`')
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (g) [M5] — the probe's failure paths; the rm always runs.
// Leg (h) [M6] — the BLOCKED case is `not-ready`.
// ─────────────────────────────────────────────────────────────────────────────

// cp fails.
{
  const { exec, executed } = makeExec({ [CP_CMD]: { code: 1, stdout: 'quota exceeded\n' } })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.ok(executed.includes(CP_CMD), '(g) [M5] the cp is issued when the four prior rows are ok')
  assert.ok(executed.includes(RM_CMD), '(g) [M5] the rm is issued even when the cp fails')
  assert.equal(rowOf(result, 'preflight').status, 'missing', '(g) [M5] a failed cp makes the preflight row missing')
  assert.equal(result.verdict, 'not-ready', '(h) [M6] a missing preflight row makes the verdict not-ready')
}

// Both preflight legs fail → BLOCKED.
{
  const { exec, executed } = makeExec({
    [FETCH_CMD]: { code: 1, stdout: '' },
    [LS_REMOTE_CMD]: { code: 1, stdout: '' }
  })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.equal(rowOf(result, 'preflight').status, 'missing', '(g) [M5] a BLOCKED preflight makes the row missing')
  assert.equal(
    rowOf(result, 'preflight').detail,
    'BLOCKED',
    '(g) [M5] the preflight row detail is exactly `BLOCKED`'
  )
  assert.ok(executed.includes(RM_CMD), '(g) [M5] the rm is issued even when preflight is BLOCKED')
  assert.equal(result.verdict, 'not-ready', '(h) [M6] a BLOCKED preflight row makes the verdict not-ready')
}

// exec rejects on the fetch — an implementation without a `finally` fails here.
{
  const { exec, executed } = makeExec({}, { throwOn: FETCH_CMD })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.equal(
    executed[executed.length - 1],
    RM_CMD,
    '(g) [M5] the rm is the last command issued even when preflight rejects'
  )
  assert.equal(rowOf(result, 'preflight').status, 'missing', '(g) [M5] a rejected preflight makes the row missing')
  assert.equal(result.verdict, 'not-ready', '(h) [M6] a rejected preflight leaves the verdict not-ready')
}

// A red prior row skips the probe entirely.
{
  const { exec, executed } = makeExec({ [CMD.whoami]: { code: 1, stdout: '' } })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.equal(
    executed.some((c) => c.includes('fleet-doctor-probe')),
    false,
    '(g) [M5] with a prior row missing, no command containing fleet-doctor-probe is issued'
  )
  assert.equal(rowOf(result, 'preflight').status, 'skipped', '(g) [M5] a red prior row leaves the preflight row skipped')
  assert.equal(result.verdict, 'not-ready', '(h) [M6] a missing read-only row is not-ready even with preflight skipped')
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (i) [M7] — the CLI.
// ─────────────────────────────────────────────────────────────────────────────

const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-'))
const absentConfig = path.join(cliRoot, 'absent.json')
assert.equal(fs.existsSync(absentConfig), false, '(i) fixture: the CLI config path must start absent')

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

const GREEN_SSH = fakeSshDir('green', (log) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *whoami*) echo marcus ;;
  *"show HEAD:"*) echo '{"name":"ultrapowers","version":"0.3.3"}' ;;
  *"describe --tags"*) echo ${DESCRIBE} ;;
  *rev-parse*) echo ${HEX40} ;;
  *"import xdist"*) : ;;
  *settings.json*) echo '{"permissions":{"defaultMode":"bypassPermissions"}}' ;;
  *"stat -c"*) printf '600\\nprefix-ok\\n' ;;
  *fetch*) : ;;
  *ls-remote*) : ;;
  *"cp "*) echo cloned ;;
  *"rm "*) echo removed ;;
  *) : ;;
esac
exit 0
`)

const runCli = (args, { sshDir, home } = {}) => {
  const env = { ...process.env, PATH: `${sshDir}:${process.env.PATH}` }
  if (home) env.HOME = home
  return spawnSync(process.execPath, [DOCTOR_SRC, ...args], { encoding: 'utf8', env, timeout: 60000 })
}

// --json with everything red.
{
  const res = runCli(['--json', '--config', absentConfig], { sshDir: RED_SSH.dir })
  assert.equal(res.status, 1, `(i) [M7] a not-ready run exits 1; stderr: ${res.stderr}`)
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `(i) [M7] --json prints parseable JSON to stdout; got: ${JSON.stringify(res.stdout)}`)
  assert.equal(parsed.verdict, 'not-ready', '(i) [M7] an all-red CLI run reports verdict not-ready')
  assert.deepEqual(
    parsed.rows.map((r) => r.id),
    EXPECTED_IDS,
    '(i) [M7] the printed envelope carries the five rows in order'
  )
  assert.deepEqual(parsed.config, DEFAULT_CONFIG, '(i) [M7] an absent --config path yields the defaults')
}

// The human two-line miss form.
{
  const res = runCli(['--config', absentConfig], { sshDir: RED_SSH.dir })
  assert.equal(res.status, 1, `(i) [M7] a not-ready human-form run exits 1; stderr: ${res.stderr}`)
  const lines = res.stdout.split('\n')
  const idx = lines.findIndex((l) => l.startsWith('missing') && l.includes('exe-dev'))
  assert.notEqual(
    idx,
    -1,
    `(i) [M7] one line per row, status first: expected a line starting 'missing' and naming exe-dev; got ${JSON.stringify(res.stdout)}`
  )
  assert.equal(
    lines[idx + 1],
    '    → RUNBOOK §exe.dev account',
    `(i) [M7] a missing row is followed by its RUNBOOK pointer line, verbatim; got ${JSON.stringify(lines[idx + 1])}`
  )
}

// Green, no --probe.
{
  const res = runCli(['--json', '--config', absentConfig], { sshDir: GREEN_SSH.dir })
  assert.equal(res.status, 0, `(i) [M7] a ready run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '(i) [M7] an all-green CLI run reports verdict ready')
  assert.equal(parsed.rows[4].status, 'skipped', '(i) [M7][M5] without --probe the preflight row is skipped')
}

// Green, --probe.
{
  const res = runCli(['--json', '--probe', '--config', absentConfig], { sshDir: GREEN_SSH.dir })
  assert.equal(res.status, 0, `(i) [M7] a ready --probe run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  const parsed = JSON.parse(res.stdout)
  assert.equal(parsed.verdict, 'ready', '(i) [M7] an all-green --probe CLI run reports verdict ready')
  assert.equal(parsed.rows[4].status, 'ok', '(i) [M7][M5] --probe sets probe:true and the preflight row runs')
  const log = fs.readFileSync(GREEN_SSH.log, 'utf8')
  assert.ok(
    log.includes('cp fleet-golden fleet-doctor-probe --json'),
    `(i) [M7][M5] --probe clones the golden into fleet-doctor-probe; log: ${log}`
  )
  assert.ok(
    log.includes('rm fleet-doctor-probe --json'),
    `(i) [M7][M5] --probe removes the probe VM; log: ${log}`
  )
}

// The default config path, resolved against os.homedir().
{
  const home = fs.mkdtempSync(path.join(cliRoot, 'home-'))
  fs.mkdirSync(path.join(home, '.ultrapowers'))
  fs.writeFileSync(
    path.join(home, '.ultrapowers', 'fleet.json'),
    JSON.stringify({ orchestrator: 'cfg-orch' })
  )
  const res = runCli(['--json'], { sshDir: RED_SSH.dir, home })
  const parsed = JSON.parse(res.stdout)
  assert.equal(
    parsed.config.orchestrator,
    'cfg-orch',
    '(i) [M7] with no --config the default path is ~/.ultrapowers/fleet.json against os.homedir()'
  )
  assert.equal(
    parsed.config.golden,
    DEFAULT_CONFIG.golden,
    '(i) [M7][M1] the keys that file omits stay at their defaults'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (j) [M8][M2] — built-ins-only imports and the four named exports.
// ─────────────────────────────────────────────────────────────────────────────
{
  // `import 'spec'` first so a bare import cannot be swallowed by the
  // `import … from 'spec'` alternative reaching into a later statement.
  const offenders = (text) => {
    const re = /^import\s*['"]([^'"]+)['"]|^import\b[^'"]*?from\s*['"]([^'"]+)['"]/gm
    const specs = []
    for (const m of text.matchAll(re)) specs.push(m[1] ?? m[2])
    return specs.filter((s) => !/^node:/.test(s) && s !== './preflight.mjs')
  }

  const source = fs.readFileSync(DOCTOR_SRC, 'utf8')
  assert.deepEqual(
    offenders(source),
    [],
    '(j) [M8] every import specifier in fleet/doctor.mjs is node:-prefixed or exactly ./preflight.mjs'
  )

  // The extractor is live, not vacuous: one added bare-package import shows up.
  const mutantDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mutant-'))
  const mutantPath = path.join(mutantDir, 'doctor.mjs')
  fs.writeFileSync(mutantPath, `${source}\nimport fs from 'fs'\n`)
  assert.deepEqual(
    offenders(fs.readFileSync(mutantPath, 'utf8')),
    ['fs'],
    '(j) [M8] the extractor catches a non-built-in import when one is added'
  )

  for (const name of ['ROW_IDS', 'loadFleetConfig', 'doctor', 'DOCTOR_DEFAULTS']) {
    assert.ok(
      Object.keys(doctorModule).includes(name),
      `(j) [M8] fleet/doctor.mjs must export ${name}`
    )
  }
  assert.deepEqual(ROW_IDS, EXPECTED_IDS, '(j) [M8][M2] ROW_IDS is the five row ids in order')
}

console.log('ALL TESTS PASSED')
