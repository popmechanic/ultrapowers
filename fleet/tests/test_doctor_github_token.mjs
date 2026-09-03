/**
 * Exam for Task 1 — "The doctor gains a `github-token` row and a `--target` flag".
 *
 * Every assertion below names the Proof leg (a)…(g) it discharges and the
 * Machine clause [M1]…[M7] that leg comes from, so the exam reads back onto
 * the task text one line at a time:
 *
 *   (a) [M1] `ROW_IDS` deep-equals the six-id list, a green stub run resolves
 *            six rows whose ids are that list in order, and the `github-token`
 *            row's `fix` is the exact RUNBOOK heading string.
 *   (b) [M2] a green no-target run records the M2 command byte for byte,
 *            exactly once, and the row is `ok` with detail
 *            `mode 600, token valid as popmechanic` on stdout `600\npopmechanic\n`.
 *   (c) [M3] a green run with `target: 'acme/widgets'` records the M3 command
 *            byte for byte, exactly once, and the row is `ok` with detail
 *            `mode 600, reaches acme/widgets` on stdout `600\nacme/widgets\n`.
 *   (d) [M4] four red stubs — exit 1 with a JSON error body, mode `644`,
 *            stdout `600\n` alone, and a target run answering `acme/other` —
 *            each make the row `missing` with the M4 detail form; and two leak
 *            stubs yield a `JSON.stringify(result)` that never contains `ghp_`.
 *   (e) [M5] `parseArgs` reads `--target`, `main` passes it through (checked as
 *            a subprocess against a stub `ssh` on PATH), and the row is
 *            read-only: red → `preflight` skipped and `not-ready`, green →
 *            `ready`.
 *   (f) [M6] every import specifier in fleet/doctor.mjs is `node:`-prefixed or
 *            exactly `./preflight.mjs`, and `DOCTOR_DEFAULTS` is still the
 *            four-key literal.
 *   (g) [M7] the green run's command list minus the one `github-token` command
 *            deep-equals the eight BASE commands in BASE order, and the five
 *            BASE rows keep their BASE `fix` headings and BASE detail forms.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { doctor, parseArgs, ROW_IDS, DOCTOR_DEFAULTS } from '../doctor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const DOCTOR_SRC = path.join(FLEET_DIR, 'doctor.mjs')

// ── The task's shared literals ───────────────────────────────────────────────

// [M1] The six row ids, in order — `github-token` between `token` and `preflight`.
const EXPECTED_IDS = [
  'exe-dev',
  'orchestrator',
  'golden',
  'token',
  'github-token',
  'preflight'
]

// [M1][M7] The six `fix` strings — exact `## ` headings in fleet/RUNBOOK.md.
// The five BASE headings, byte for byte, with the new one in row position.
const FIX_GITHUB_TOKEN = 'GitHub auth (#368) — the orchestrator opens the PR'
const EXPECTED_FIXES = [
  'exe.dev account',
  'Orchestrator VM',
  'Golden VM build',
  'Engine auth — the Max subscription, delivered per run (#213)',
  FIX_GITHUB_TOKEN,
  'Preflight'
]

// [M6] The four-key default config, verbatim from BASE.
const DEFAULT_CONFIG = {
  orchestrator: 'fleet-orchestrator',
  golden: 'fleet-golden',
  repoDir: '/home/exedev/repo',
  tokenPath: '/home/exedev/.fleet/claude-oauth-token'
}

// The config every stub-driven scenario runs against. `tokenPath` is
// deliberately not the default: the OAuth row substitutes it, and the
// `github-token` row must spell `/home/exedev/.fleet/github-token` literally.
const CONFIG = { orchestrator: 'orch1', golden: 'gold1', repoDir: '/repo', tokenPath: '/tok' }

const ORCH_HEX = 'd6efce4da55f6a750a2632d30a70a0c635113c68'
const GOLDEN_HEX = '1f2e3d4c5b6a798899001122334455667788990a'
const MANIFEST = '{"name":"ultrapowers","version":"0.3.3"}\n'
const DESCRIBE = 'v0.3.3-4-gabc'

// [M7] The eight BASE read-only commands, byte for byte, in BASE order.
const CMD_WHOAMI = 'ssh exe.dev whoami'
const CMD_REV_PARSE = "ssh orch1.exe.xyz 'git -C /repo rev-parse HEAD'"
const CMD_SHOW = "ssh orch1.exe.xyz 'git -C /repo show HEAD:.claude-plugin/plugin.json'"
const CMD_DESCRIBE = "ssh orch1.exe.xyz 'git -C /repo describe --tags --always'"
const CMD_ENGINE =
  "ssh gold1.exe.xyz 'test -d /home/exedev/repo/fleet/node_modules && git -C /home/exedev/repo rev-parse HEAD'"
const CMD_XDIST = `ssh gold1.exe.xyz 'python3 -c "import xdist"'`
const CMD_SETTINGS = "ssh gold1.exe.xyz 'cat ~/.claude/settings.json'"
const CMD_TOKEN =
  "ssh orch1.exe.xyz 'stat -c %a /tok && head -c 10 /tok | grep -q ^sk-ant-oat && echo prefix-ok'"

const BASE_READ_ONLY_CMDS = [
  CMD_WHOAMI,
  CMD_REV_PARSE,
  CMD_SHOW,
  CMD_DESCRIBE,
  CMD_ENGINE,
  CMD_XDIST,
  CMD_SETTINGS,
  CMD_TOKEN
]

// [M2] The one command the row issues without a target, byte for byte.
const CMD_GH_USER =
  "ssh orch1.exe.xyz 'stat -c %a /home/exedev/.fleet/github-token && GH_TOKEN=$(cat /home/exedev/.fleet/github-token) gh api user -q .login'"

// [M3] The one command the row issues with `target: 'acme/widgets'`, byte for
// byte — the M2 command with `gh api user -q .login` replaced.
const TARGET = 'acme/widgets'
const CMD_GH_REPO =
  "ssh orch1.exe.xyz 'stat -c %a /home/exedev/.fleet/github-token && GH_TOKEN=$(cat /home/exedev/.fleet/github-token) gh api repos/acme/widgets -q .full_name'"

// [M4] The stdout a real `gh` prints on a 404 — a JSON error body, exit 1.
const GH_404_BODY = '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}'

// ── Stub exec, shaped exactly as fleet/preflight.mjs consumes it ─────────────

const GREEN = {
  [CMD_WHOAMI]: { code: 0, stdout: 'marcus\n' },
  [CMD_REV_PARSE]: { code: 0, stdout: `${ORCH_HEX}\n` },
  [CMD_SHOW]: { code: 0, stdout: MANIFEST },
  [CMD_DESCRIBE]: { code: 0, stdout: `${DESCRIBE}\n` },
  [CMD_ENGINE]: { code: 0, stdout: `${GOLDEN_HEX}\n` },
  [CMD_XDIST]: { code: 0, stdout: '' },
  [CMD_SETTINGS]: { code: 0, stdout: '{"permissions":{"defaultMode":"bypassPermissions"}}\n' },
  [CMD_TOKEN]: { code: 0, stdout: '600\nprefix-ok\n' },
  [CMD_GH_USER]: { code: 0, stdout: '600\npopmechanic\n' },
  [CMD_GH_REPO]: { code: 0, stdout: `600\n${TARGET}\n` }
}

function makeExec (overrides = {}) {
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    if (Object.prototype.hasOwnProperty.call(overrides, cmd)) return overrides[cmd]
    if (Object.prototype.hasOwnProperty.call(GREEN, cmd)) return GREEN[cmd]
    return { code: 0, stdout: '' }
  }
  return { exec, executed }
}

const rowOf = (result, id) => {
  const row = result.rows.find((r) => r.id === id)
  assert.ok(row, `row '${id}' must be present; got ${JSON.stringify(result.rows.map((r) => r.id))}`)
  return row
}

// Every command the row could have issued mentions the token file by name, so
// "exactly one command" is asserted by counting, not by absence of failure.
const ghCommands = (executed) => executed.filter((c) => c.includes('github-token'))

// ─────────────────────────────────────────────────────────────────────────────
// Leg (a) [M1] — the six ids, the six rows in order, the exact fix heading.
// Leg (g) [M7] — the five BASE rows keep their BASE commands, fixes, details.
// Leg (e) [M5] — an all-green no-probe run is `ready`.
// ─────────────────────────────────────────────────────────────────────────────
{
  assert.deepEqual(
    [...ROW_IDS],
    EXPECTED_IDS,
    '(a) [M1] ROW_IDS is exactly the six ids, in order'
  )

  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec })

  assert.deepEqual(
    Object.keys(result).sort(),
    ['config', 'rows', 'verdict'],
    '(a) [M1] doctor resolves to exactly { config, rows, verdict }'
  )
  assert.deepEqual(
    result.rows.map((r) => r.id),
    EXPECTED_IDS,
    '(a) [M1] a green run resolves six rows whose ids are the six-id list, in order'
  )
  assert.equal(
    rowOf(result, 'github-token').fix,
    FIX_GITHUB_TOKEN,
    '(a) [M1] the github-token row\'s fix is exactly the RUNBOOK heading string'
  )
  assert.deepEqual(
    result.rows.map((r) => r.fix),
    EXPECTED_FIXES,
    '(g) [M7] the five BASE rows keep their BASE fix headings, with the new one in row position'
  )

  // (g) [M7] the recorded list minus the one github-token command is BASE's.
  assert.equal(
    ghCommands(executed).length,
    1,
    `(g) [M7] a green run issues exactly one github-token command; got ${JSON.stringify(ghCommands(executed))}`
  )
  assert.deepEqual(
    executed.filter((c) => !c.includes('github-token')),
    BASE_READ_ONLY_CMDS,
    '(g) [M7] the green run\'s commands, with the one github-token command removed, are the eight BASE commands in BASE order'
  )

  // (g) [M7] the five BASE rows' details, byte for byte in their BASE forms.
  assert.deepEqual(
    result.rows.filter((r) => r.id !== 'github-token').map((r) => r.detail),
    [
      'signed in as marcus',
      `orch1 at ${ORCH_HEX} — ultrapowers 0.3.3 (${DESCRIBE})`,
      'gold1: engine clone, xdist and settings all clean',
      'mode 600, prefix-ok',
      'not requested — pass --probe to clone a probe VM'
    ],
    '(g) [M7] the five BASE rows keep their BASE detail forms on a green run'
  )
  assert.deepEqual(
    result.rows.map((r) => r.status),
    ['ok', 'ok', 'ok', 'ok', 'ok', 'skipped'],
    '(g) [M7][M5] a green probe-absent run: five ok rows and a skipped preflight row'
  )
  assert.equal(
    result.verdict,
    'ready',
    '(e) [M5] an all-green no-probe run, github-token included, is `ready`'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (b) [M2] — the no-target command, issued exactly once, and its detail.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec({ [CMD_GH_USER]: { code: 0, stdout: '600\npopmechanic\n' } })
  const result = await doctor({ config: CONFIG, exec })
  const gh = ghCommands(executed)

  assert.deepEqual(
    gh,
    [CMD_GH_USER],
    '(b) [M2] without a target the row issues exactly one command, byte for byte'
  )
  assert.equal(
    rowOf(result, 'github-token').status,
    'ok',
    '(b) [M2] code 0 with a `600` line and a login line makes the row ok'
  )
  assert.equal(
    rowOf(result, 'github-token').detail,
    'mode 600, token valid as popmechanic',
    '(b) [M2] the green no-target detail is exactly `mode 600, token valid as popmechanic`'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (c) [M3] — the target command, issued exactly once, and its detail.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec, target: TARGET })
  const gh = ghCommands(executed)

  assert.deepEqual(
    gh,
    [CMD_GH_REPO],
    '(c) [M3] with a target the row issues exactly one command, the M2 command with `gh api repos/acme/widgets -q .full_name`'
  )
  assert.equal(
    executed.includes(CMD_GH_USER),
    false,
    '(c) [M3] with a target the `gh api user` command is not issued at all'
  )
  assert.equal(
    rowOf(result, 'github-token').status,
    'ok',
    '(c) [M3] code 0 with a `600` line and a line equal to the target makes the row ok'
  )
  assert.equal(
    rowOf(result, 'github-token').detail,
    'mode 600, reaches acme/widgets',
    '(c) [M3] the green target detail is exactly `mode 600, reaches acme/widgets`'
  )
  assert.deepEqual(
    executed.filter((c) => !c.includes('github-token')),
    BASE_READ_ONLY_CMDS,
    '(c) [M3][M7] a target run leaves the eight BASE commands untouched'
  )
  assert.equal(
    result.verdict,
    'ready',
    '(c) [M3][M5] a green target run is `ready`'
  )
  assert.deepEqual(
    Object.keys(result).sort(),
    ['config', 'rows', 'verdict'],
    '(c) [M3] the target never widens the envelope: still exactly { config, rows, verdict }'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (d) [M4] — the four red stubs and the M4 detail forms.
// ─────────────────────────────────────────────────────────────────────────────
const RED_CASES = [
  {
    name: 'exit 1 with a JSON error body',
    target: null,
    stub: { code: 1, stdout: `600\n${GH_404_BODY}\n` },
    detail: 'mode 600, token rejected (code 1)'
  },
  {
    name: 'mode 644',
    target: null,
    stub: { code: 0, stdout: '644\npopmechanic\n' },
    detail: 'mode 644, token rejected (code 0)'
  },
  {
    name: 'stdout `600\\n` alone — no login line',
    target: null,
    stub: { code: 0, stdout: '600\n' },
    detail: 'mode 600, token rejected (code 0)'
  },
  {
    name: 'a target run whose repository line is acme/other',
    target: TARGET,
    stub: { code: 0, stdout: '600\nacme/other\n' },
    detail: 'mode 600, cannot reach acme/widgets (code 0)'
  },
  {
    // [M4] `mode unreadable` when no mode line was read.
    name: 'no mode line at all, exit 1',
    target: null,
    stub: { code: 1, stdout: '' },
    detail: 'mode unreadable, token rejected (code 1)'
  },
  {
    name: 'no mode line at all with a target, exit 1',
    target: TARGET,
    stub: { code: 1, stdout: '' },
    detail: 'mode unreadable, cannot reach acme/widgets (code 1)'
  }
]

for (const c of RED_CASES) {
  const cmd = c.target === null ? CMD_GH_USER : CMD_GH_REPO
  const { exec, executed } = makeExec({ [cmd]: c.stub })
  const result = await doctor({ config: CONFIG, exec, target: c.target })
  const row = rowOf(result, 'github-token')

  assert.deepEqual(
    ghCommands(executed),
    [cmd],
    `(d) [M4] ${c.name}: still exactly one github-token command, byte for byte`
  )
  assert.equal(
    row.status,
    'missing',
    `(d) [M4] ${c.name}: the row is missing`
  )
  assert.equal(
    row.detail,
    c.detail,
    `(d) [M4] ${c.name}: the detail is exactly ${JSON.stringify(c.detail)}`
  )
  assert.equal(
    row.detail.includes('Not Found'),
    false,
    `(d) [M4] ${c.name}: no line of the command's stdout other than the mode and the login or repository name reaches the detail`
  )
  assert.equal(
    row.fix,
    FIX_GITHUB_TOKEN,
    `(d) [M4][M1] ${c.name}: a red row still names its RUNBOOK heading`
  )

  // [M5] The other four read-only rows stay green and only this row is red.
  assert.deepEqual(
    result.rows.filter((r) => r.id !== 'github-token').map((r) => r.status),
    ['ok', 'ok', 'ok', 'ok', 'skipped'],
    `(d) [M4][M5] ${c.name}: no other row changes status`
  )
  assert.equal(
    result.verdict,
    'not-ready',
    `(d) [M4][M5] ${c.name}: a red github-token row makes the verdict not-ready`
  )
}

// [M4] The two leak stubs — nothing resembling a token reaches the result.
const LEAK_CASES = [
  {
    name: 'a red row whose stdout carries a token',
    stub: { code: 1, stdout: '600\nghp_SECRETSECRETSECRET\n' },
    status: 'missing'
  },
  {
    name: 'a green row whose stdout carries an extra token line',
    stub: { code: 0, stdout: '600\npopmechanic\nghp_SECRET\n' },
    status: 'ok'
  }
]

for (const c of LEAK_CASES) {
  const { exec } = makeExec({ [CMD_GH_USER]: c.stub })
  const result = await doctor({ config: CONFIG, exec })

  assert.equal(
    rowOf(result, 'github-token').status,
    c.status,
    `(d) [M4] ${c.name}: the row is ${c.status}`
  )
  assert.equal(
    JSON.stringify(result).includes('ghp_'),
    false,
    `(d) [M4] ${c.name}: JSON.stringify(result) contains no \`ghp_\`; got ${JSON.stringify(rowOf(result, 'github-token'))}`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (e) [M5] — parseArgs, the read-only row, and the CLI.
// ─────────────────────────────────────────────────────────────────────────────
{
  assert.equal(
    parseArgs(['--target', TARGET]).target,
    TARGET,
    '(e) [M5] parseArgs reads `--target <owner>/<repo>` into opts.target'
  )
  assert.equal(
    parseArgs([]).target,
    null,
    '(e) [M5] parseArgs yields target null when the flag is absent'
  )
  assert.deepEqual(
    Object.keys(parseArgs([])).sort(),
    ['configPath', 'json', 'probe', 'target'],
    '(e) [M5] parseArgs yields exactly { json, probe, configPath, target }'
  )
  assert.deepEqual(
    parseArgs(['--json', '--probe', '--config', '/c', '--target', TARGET]),
    { json: true, probe: true, configPath: '/c', target: TARGET },
    '(e) [M5] --target composes with the BASE flags and leaves them unchanged'
  )
}

// [M5] The row is read-only: a red github-token row leaves preflight skipped
// and the verdict not-ready, even with probe:true.
{
  const { exec, executed } = makeExec({ [CMD_GH_USER]: { code: 1, stdout: '600\n' } })
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.equal(
    rowOf(result, 'github-token').status,
    'missing',
    '(e) [M5] the red github-token stub reddens its row'
  )
  assert.equal(
    rowOf(result, 'preflight').status,
    'skipped',
    '(e) [M5] a red github-token row leaves the preflight row skipped'
  )
  assert.equal(
    result.verdict,
    'not-ready',
    '(e) [M5] a red github-token row makes the verdict not-ready'
  )
  assert.equal(
    executed.some((c) => c.includes('fleet-doctor-probe')),
    false,
    '(e) [M5] with the github-token row red, no probe VM command is issued'
  )
}

// [M5] The CLI: --target reaches doctor() through main.
const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-github-token-cli-'))
process.on('exit', () => {
  fs.rmSync(cliRoot, { recursive: true, force: true })
})

{
  const absentConfig = path.join(cliRoot, 'absent.json')
  assert.equal(fs.existsSync(absentConfig), false, '(e) fixture: the CLI config path must start absent')

  const sshDir = fs.mkdtempSync(path.join(cliRoot, 'ssh-'))
  const sshLog = path.join(sshDir, 'ssh.log')
  const sshPath = path.join(sshDir, 'ssh')
  fs.writeFileSync(sshPath, `#!/bin/sh
printf '%s\\n' "$*" >> '${sshLog}'
case "$*" in
  *"gh api repos/acme/widgets"*) printf '600\\nacme/widgets\\n' ;;
  *"gh api user"*) printf '600\\npopmechanic\\n' ;;
  *whoami*) echo marcus ;;
  *"show HEAD:"*) echo '{"name":"ultrapowers","version":"0.3.3"}' ;;
  *"describe --tags"*) echo ${DESCRIBE} ;;
  *rev-parse*) echo ${ORCH_HEX} ;;
  *"import xdist"*) : ;;
  *settings.json*) echo '{"permissions":{"defaultMode":"bypassPermissions"}}' ;;
  *"stat -c"*) printf '600\\nprefix-ok\\n' ;;
  *) : ;;
esac
exit 0
`, { mode: 0o755 })
  fs.chmodSync(sshPath, 0o755)

  const res = spawnSync(
    process.execPath,
    [DOCTOR_SRC, '--json', '--target', TARGET, '--config', absentConfig],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${sshDir}:${process.env.PATH}` },
      timeout: 60000
    }
  )

  assert.equal(
    res.status,
    0,
    `(e) [M5] the green --target CLI run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`
  )
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `(e) [M5] --json prints parseable JSON; got ${JSON.stringify(res.stdout)}`)

  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['config', 'rows', 'verdict'],
    '(e) [M5] the --json envelope keeps exactly { config, rows, verdict } — the target appears only in the row detail'
  )
  assert.deepEqual(
    parsed.rows.map((r) => r.id),
    EXPECTED_IDS,
    '(e) [M5] the printed envelope carries the six rows in order'
  )
  const ghRow = parsed.rows.find((r) => r.id === 'github-token')
  assert.equal(
    ghRow.detail,
    'mode 600, reaches acme/widgets',
    `(e) [M5] main passes --target through to doctor: the github-token detail names acme/widgets; got ${JSON.stringify(ghRow)}`
  )
  assert.equal(ghRow.status, 'ok', '(e) [M5] the stubbed CLI run leaves the github-token row ok')
  assert.equal(parsed.verdict, 'ready', '(e) [M5] the all-green --target CLI run is `ready`')

  const log = fs.readFileSync(sshLog, 'utf8')
  assert.ok(
    log.includes('gh api repos/acme/widgets -q .full_name'),
    `(e) [M5] the CLI issued the repository probe for the target; log: ${log}`
  )
  assert.equal(
    log.includes('gh api user'),
    false,
    `(e) [M5] with --target the CLI does not also issue the login probe; log: ${log}`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (f) [M6] — built-ins-only imports and the untouched four-key defaults.
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
    '(f) [M6] every import specifier in fleet/doctor.mjs is node:-prefixed or exactly ./preflight.mjs'
  )

  // The extractor is live, not vacuous: one added bare-package import shows up.
  const mutantDir = fs.mkdtempSync(path.join(cliRoot, 'mutant-'))
  const mutantPath = path.join(mutantDir, 'doctor.mjs')
  fs.writeFileSync(mutantPath, `${source}\nimport { GITHUB_TOKEN_PATH } from './drive.mjs'\n`)
  assert.deepEqual(
    offenders(fs.readFileSync(mutantPath, 'utf8')),
    ['./drive.mjs'],
    '(f) [M6] the extractor catches a non-built-in import when one is added'
  )

  // [M6] The token path is a string literal in doctor.mjs, not an import.
  assert.ok(
    source.includes('/home/exedev/.fleet/github-token'),
    '(f) [M6] the GitHub token path is a string literal in fleet/doctor.mjs'
  )

  assert.deepEqual(
    { ...DOCTOR_DEFAULTS },
    DEFAULT_CONFIG,
    '(f) [M6] DOCTOR_DEFAULTS is still the four-key literal — target is a call option, not a config key'
  )
}

console.log('ALL TESTS PASSED')
