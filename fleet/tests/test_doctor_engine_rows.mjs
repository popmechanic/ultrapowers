/**
 * Exam for Task 5 — "The doctor reports the engine, not a plugin".
 *
 * Every assertion below names the Proof leg (a)…(d) it discharges and the
 * Machine clause [M1]…[M4] that leg comes from, so the exam reads back onto
 * the task text one line at a time:
 *
 *   (a) [M1] the `orchestrator` row issues rev-parse, `show
 *            HEAD:.claude-plugin/plugin.json` and `describe --tags --always`
 *            in that order; green → `<orch> at <sha> — ultrapowers <version>
 *            (<describe>)`; a failed show or describe leaves the row `ok` with
 *            `… — version unreadable`; a non-hex or non-zero rev-parse reddens it.
 *   (b) [M2] the `golden` row issues the engine-clone command byte for byte,
 *            is `ok` with the exact detail on a 40-hex answer, `missing` with
 *            `engine clone` in the detail on code 1 and on a non-hex line, and
 *            keeps the xdist and settings commands as BASE's literals.
 *   (c) [M3] every scenario in this exam records into one shared command list,
 *            which carries red-row entries and no `claude plugin` substring.
 *   (d) [M4] DOCTOR_DEFAULTS, ROW_IDS, every row's `fix`, the untouched
 *            `exe-dev` / `token` / `preflight` rows and their commands, the
 *            two verdicts, `parseArgs` and `renderRows` all equal BASE's.
 */

import assert from 'node:assert/strict'

import { preflight } from '../preflight.mjs'
import {
  doctor,
  parseArgs,
  renderRows,
  ROW_IDS,
  DOCTOR_DEFAULTS
} from '../doctor.mjs'

// ── The task's shared literals ───────────────────────────────────────────────

// The config every stub-driven scenario runs against, so each substitution in
// the commands below is visibly a substitution and not a hard-coded default.
// `repoDir` is deliberately not `/home/exedev/repo`: [M1]'s three orchestrator
// commands substitute it, and [M2]'s golden command spells the sandbox engine
// clone path literally.
const CONFIG = { orchestrator: 'orch1', golden: 'gold1', repoDir: '/repo', tokenPath: '/tok' }

const ORCH_HEX = 'd6efce4da55f6a750a2632d30a70a0c635113c68'
const GOLDEN_HEX = '1f2e3d4c5b6a798899001122334455667788990a'

// [M1] The manifest the `show` command answers and the text `describe` prints.
const MANIFEST = '{"name":"ultrapowers","version":"0.3.3"}\n'
const DESCRIBE = 'v0.3.3-4-gabc'

// [M1] The three orchestrator commands, byte for byte, in the order the row
// issues them.
const CMD_REV_PARSE = "ssh orch1.exe.xyz 'git -C /repo rev-parse HEAD'"
const CMD_SHOW = "ssh orch1.exe.xyz 'git -C /repo show HEAD:.claude-plugin/plugin.json'"
const CMD_DESCRIBE = "ssh orch1.exe.xyz 'git -C /repo describe --tags --always'"
const ORCH_CMDS = [CMD_REV_PARSE, CMD_SHOW, CMD_DESCRIBE]

// [M2] The golden row's engine-clone command, in place of `claude plugin list`,
// plus the xdist and settings commands kept byte for byte from BASE.
const CMD_ENGINE =
  "ssh gold1.exe.xyz 'test -d /home/exedev/repo/fleet/node_modules && git -C /home/exedev/repo rev-parse HEAD'"
const CMD_XDIST = `ssh gold1.exe.xyz 'python3 -c "import xdist"'`
const CMD_SETTINGS = "ssh gold1.exe.xyz 'cat ~/.claude/settings.json'"
const GOLDEN_CMDS = [CMD_ENGINE, CMD_XDIST, CMD_SETTINGS]

// [M4] The two read-only commands BASE issues for the rows this task leaves
// alone, byte for byte.
const CMD_WHOAMI = 'ssh exe.dev whoami'
const CMD_TOKEN =
  "ssh orch1.exe.xyz 'stat -c %a /tok && head -c 10 /tok | grep -q ^sk-ant-oat && echo prefix-ok'"

// The eight read-only commands of a green probe-absent run, in row order.
const READ_ONLY_CMDS = [CMD_WHOAMI, ...ORCH_CMDS, ...GOLDEN_CMDS, CMD_TOKEN]

// [M4] The probe row's three commands at BASE. The two preflight legs are
// derived from the real module below so the byte-equality stays live.
const CP_CMD = 'ssh exe.dev "cp gold1 fleet-doctor-probe --json"'
const RM_CMD = 'ssh exe.dev "rm fleet-doctor-probe --json"'
const FETCH_CMD =
  "ssh orch1.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@fleet-doctor-probe.exe.xyz/home/exedev/repo'"
const LS_REMOTE_CMD =
  "ssh orch1.exe.xyz 'git ls-remote https://fleet-doctor-probe.exe.xyz/repo.git'"

// [M1] The two orchestrator details, spelled exactly as the Machine clause does.
const ORCH_DETAIL_OK = `orch1 at ${ORCH_HEX} — ultrapowers 0.3.3 (${DESCRIBE})`
const ORCH_DETAIL_UNREADABLE = `orch1 at ${ORCH_HEX} — version unreadable`

// [M2] The golden row's green detail, spelled exactly as the Machine clause does.
const GOLDEN_DETAIL_OK = 'gold1: engine clone, xdist and settings all clean'

// [M4] BASE's five `fix` headings, in row order.
const EXPECTED_FIXES = [
  'exe.dev account',
  'Orchestrator VM',
  'Golden VM build',
  'Engine auth — the Max subscription, delivered per run (#213)',
  'Preflight'
]

// [M4] BASE's three untouched row objects on an all-green probe-absent run.
const BASE_EXE_DEV_ROW = {
  id: 'exe-dev',
  status: 'ok',
  detail: 'signed in as marcus',
  fix: 'exe.dev account'
}
const BASE_TOKEN_ROW = {
  id: 'token',
  status: 'ok',
  detail: 'mode 600, prefix-ok',
  fix: 'Engine auth — the Max subscription, delivered per run (#213)'
}
const BASE_PREFLIGHT_ROW_SKIPPED = {
  id: 'preflight',
  status: 'skipped',
  detail: 'not requested — pass --probe to clone a probe VM',
  fix: 'Preflight'
}
const BASE_PREFLIGHT_ROW_OK = {
  id: 'preflight',
  status: 'ok',
  detail: 'ssh',
  fix: 'Preflight'
}

// [M3] The substring no command the doctor issues may contain.
const FORBIDDEN = 'claude plugin'

// The preflight command strings are the real module's, not a copied literal.
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
  assert.equal(derived[0], FETCH_CMD, '(d) [M4] the pinned fetch command is preflight\'s own')
  assert.equal(derived[1], LS_REMOTE_CMD, '(d) [M4] the pinned ls-remote command is preflight\'s own')
}

// ── The shared recorder [M3] ─────────────────────────────────────────────────

/** Every command every scenario below issues, in the order it was issued. */
const ALL_COMMANDS = []
/** The subset issued by the scenarios that expect a red row. */
const RED_RUN_COMMANDS = []

const GREEN = {
  [CMD_WHOAMI]: { code: 0, stdout: 'marcus\n' },
  [CMD_REV_PARSE]: { code: 0, stdout: `${ORCH_HEX}\n` },
  [CMD_SHOW]: { code: 0, stdout: MANIFEST },
  [CMD_DESCRIBE]: { code: 0, stdout: `${DESCRIBE}\n` },
  [CMD_ENGINE]: { code: 0, stdout: `${GOLDEN_HEX}\n` },
  [CMD_XDIST]: { code: 0, stdout: '' },
  [CMD_SETTINGS]: { code: 0, stdout: '{"permissions":{"defaultMode":"bypassPermissions"}}\n' },
  [CMD_TOKEN]: { code: 0, stdout: '600\nprefix-ok\n' },
  [CP_CMD]: { code: 0, stdout: 'cloned\n' },
  [RM_CMD]: { code: 0, stdout: 'removed\n' },
  [FETCH_CMD]: { code: 0, stdout: '' },
  [LS_REMOTE_CMD]: { code: 0, stdout: '' }
}

/**
 * A recording stub shaped exactly as fleet/preflight.mjs consumes it. `red`
 * marks a scenario whose expectation is a red row, so leg (c) can show the
 * shared list carries entries from one.
 */
function makeExec (overrides = {}, { red = false } = {}) {
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    ALL_COMMANDS.push(cmd)
    if (red) RED_RUN_COMMANDS.push(cmd)
    if (Object.prototype.hasOwnProperty.call(overrides, cmd)) return overrides[cmd]
    if (Object.prototype.hasOwnProperty.call(GREEN, cmd)) return GREEN[cmd]
    return { code: 0, stdout: '' }
  }
  return { exec, executed }
}

const rowOf = (result, id) => {
  const found = result.rows.find((r) => r.id === id)
  assert.ok(found, `row '${id}' is present in the result`)
  return found
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (a) [M1] — the orchestrator row: three commands, in order, and the two
// detail forms.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec })

  assert.deepEqual(
    executed.filter((c) => ORCH_CMDS.includes(c)),
    ORCH_CMDS,
    '(a) [M1] the orchestrator row issues rev-parse, then show HEAD:.claude-plugin/plugin.json, then describe --tags --always — all three present, in that order'
  )

  const orch = rowOf(result, 'orchestrator')
  assert.equal(orch.status, 'ok', '(a) [M1] a code-0 40-hex rev-parse makes the orchestrator row ok')
  assert.equal(
    orch.detail,
    ORCH_DETAIL_OK,
    '(a) [M1] with the show and describe commands green the detail is `<orch> at <sha> — ultrapowers <version> (<describe>)`'
  )
}

// A failing `show` never reddens the row; the detail falls back.
{
  const { exec, executed } = makeExec({ [CMD_SHOW]: { code: 128 } })
  const result = await doctor({ config: CONFIG, exec })
  const orch = rowOf(result, 'orchestrator')

  assert.ok(
    executed.includes(CMD_SHOW),
    '(a) [M1] the show command is still issued when it answers code 128'
  )
  assert.equal(orch.status, 'ok', '(a) [M1] a failing show command never reddens the orchestrator row')
  assert.equal(
    orch.detail,
    ORCH_DETAIL_UNREADABLE,
    '(a) [M1] a failing show command yields the detail `<orch> at <sha> — version unreadable`'
  )
}

// A failing `describe` never reddens the row either.
{
  const { exec, executed } = makeExec({ [CMD_DESCRIBE]: { code: 128 } })
  const result = await doctor({ config: CONFIG, exec })
  const orch = rowOf(result, 'orchestrator')

  assert.ok(
    executed.includes(CMD_DESCRIBE),
    '(a) [M1] the describe command is still issued when it answers code 128'
  )
  assert.equal(orch.status, 'ok', '(a) [M1] a failing describe command never reddens the orchestrator row')
  assert.equal(
    orch.detail,
    ORCH_DETAIL_UNREADABLE,
    '(a) [M1] a failing describe command yields the detail `<orch> at <sha> — version unreadable`'
  )
}

// A code-0 rev-parse whose first line is not 40 hex reddens the row.
{
  const { exec } = makeExec(
    { [CMD_REV_PARSE]: { code: 0, stdout: 'fatal: not a git repository\n' } },
    { red: true }
  )
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(
    rowOf(result, 'orchestrator').status,
    'missing',
    '(a) [M1] a code-0 rev-parse without a 40-hex first line makes the orchestrator row missing'
  )
}

// A non-zero rev-parse reddens the row even when its first line is 40 hex.
{
  const { exec } = makeExec(
    { [CMD_REV_PARSE]: { code: 1, stdout: `${ORCH_HEX}\n` } },
    { red: true }
  )
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(
    rowOf(result, 'orchestrator').status,
    'missing',
    '(a) [M1] a non-zero rev-parse makes the orchestrator row missing even with a 40-hex first line'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (b) [M2] — the golden row: the engine command, its two detail forms, and
// the xdist and settings commands unchanged from BASE.
// ─────────────────────────────────────────────────────────────────────────────
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec })

  assert.deepEqual(
    executed.filter((c) => GOLDEN_CMDS.includes(c)),
    GOLDEN_CMDS,
    '(b) [M2] the golden row issues the engine-clone command byte for byte, then the xdist and settings commands unchanged from BASE'
  )
  assert.ok(
    executed.includes(CMD_XDIST),
    '(b) [M2] the xdist command equals BASE\'s literal'
  )
  assert.ok(
    executed.includes(CMD_SETTINGS),
    '(b) [M2] the settings command equals BASE\'s literal'
  )

  const golden = rowOf(result, 'golden')
  assert.equal(golden.status, 'ok', '(b) [M2] a 40-hex answer to the engine command makes the golden row ok')
  assert.equal(
    golden.detail,
    GOLDEN_DETAIL_OK,
    '(b) [M2] the green golden detail is `<golden>: engine clone, xdist and settings all clean`'
  )
}

// The engine command answering code 1 → missing, `engine clone` in the detail.
{
  const { exec } = makeExec({ [CMD_ENGINE]: { code: 1, stdout: '' } }, { red: true })
  const result = await doctor({ config: CONFIG, exec })
  const golden = rowOf(result, 'golden')

  assert.equal(
    golden.status,
    'missing',
    '(b) [M2] a non-zero engine command makes the golden row missing'
  )
  assert.ok(
    golden.detail.includes('engine clone'),
    `(b) [M2] the red golden detail names 'engine clone'; got ${JSON.stringify(golden.detail)}`
  )
}

// The engine command answering a non-hex line → missing, `engine clone` in the detail.
{
  const { exec } = makeExec(
    { [CMD_ENGINE]: { code: 0, stdout: 'no such directory\n' } },
    { red: true }
  )
  const result = await doctor({ config: CONFIG, exec })
  const golden = rowOf(result, 'golden')

  assert.equal(
    golden.status,
    'missing',
    '(b) [M2] a code-0 engine command whose first line is not 40 hex makes the golden row missing'
  )
  assert.ok(
    golden.detail.includes('engine clone'),
    `(b) [M2] the red golden detail names 'engine clone' on a non-hex line; got ${JSON.stringify(golden.detail)}`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (d) [M4] — BASE's literals: defaults, ids, fixes, the three untouched
// rows and their commands, the two verdicts, parseArgs and renderRows.
// ─────────────────────────────────────────────────────────────────────────────

assert.deepEqual(
  { ...DOCTOR_DEFAULTS },
  {
    orchestrator: 'fleet-orchestrator',
    golden: 'fleet-golden-next',
    repoDir: '/home/exedev/repo',
    tokenPath: '/home/exedev/.fleet/claude-oauth-token'
  },
  '(d) [M4] DOCTOR_DEFAULTS is BASE\'s four-key literal'
)

assert.deepEqual(
  [...ROW_IDS],
  ['exe-dev', 'orchestrator', 'golden', 'token', 'preflight'],
  '(d) [M4] ROW_IDS is BASE\'s five row ids in order'
)

// The all-green probe-absent run: rows, fixes, commands and verdict.
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec })

  assert.deepEqual(
    result.rows.map((r) => r.id),
    ['exe-dev', 'orchestrator', 'golden', 'token', 'preflight'],
    '(d) [M4] the five rows keep BASE\'s ids and order'
  )
  assert.deepEqual(
    result.rows.map((r) => r.fix),
    EXPECTED_FIXES,
    '(d) [M4] every row\'s fix equals BASE\'s heading table'
  )

  assert.deepEqual(
    rowOf(result, 'exe-dev'),
    BASE_EXE_DEV_ROW,
    '(d) [M4] the exe-dev row object deep-equals BASE\'s literal on an all-green run'
  )
  assert.deepEqual(
    rowOf(result, 'token'),
    BASE_TOKEN_ROW,
    '(d) [M4] the token row object deep-equals BASE\'s literal on an all-green run'
  )
  assert.deepEqual(
    rowOf(result, 'preflight'),
    BASE_PREFLIGHT_ROW_SKIPPED,
    '(d) [M4] the preflight row object deep-equals BASE\'s skipped literal on a probe-absent run'
  )

  assert.deepEqual(
    executed.filter((c) => c === CMD_WHOAMI || c === CMD_TOKEN),
    [CMD_WHOAMI, CMD_TOKEN],
    '(d) [M4] the exe-dev and token rows issue BASE\'s literal commands, once each, in row order'
  )
  assert.deepEqual(
    executed,
    READ_ONLY_CMDS,
    '(d) [M1][M2][M4] a green probe-absent run issues exactly the eight read-only commands, in row order, and nothing else'
  )

  assert.equal(result.verdict, 'ready', '(d) [M4] every row green makes the verdict `ready`')
}

// The golden engine command answering code 1 makes the verdict not-ready.
{
  const { exec } = makeExec({ [CMD_ENGINE]: { code: 1, stdout: '' } }, { red: true })
  const result = await doctor({ config: CONFIG, exec })
  assert.equal(
    result.verdict,
    'not-ready',
    '(d) [M4] a red golden row makes the verdict `not-ready`'
  )
}

// [M3] `probe: false` is the probe-absent run; [M4] `probe: true` runs the
// preflight row and issues BASE's three probe commands around it.
{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec, probe: false })
  assert.deepEqual(
    executed,
    READ_ONLY_CMDS,
    '(d) [M4] probe:false issues exactly the eight read-only commands'
  )
  assert.deepEqual(
    rowOf(result, 'preflight'),
    BASE_PREFLIGHT_ROW_SKIPPED,
    '(d) [M4] probe:false leaves BASE\'s skipped preflight row'
  )
}

{
  const { exec, executed } = makeExec()
  const result = await doctor({ config: CONFIG, exec, probe: true })

  assert.deepEqual(
    executed,
    [...READ_ONLY_CMDS, CP_CMD, FETCH_CMD, RM_CMD],
    '(d) [M4] a green probe run issues the eight read-only commands, then BASE\'s cp, preflight fetch and rm'
  )
  assert.deepEqual(
    rowOf(result, 'preflight'),
    BASE_PREFLIGHT_ROW_OK,
    '(d) [M4] the preflight row object deep-equals BASE\'s ok literal on a green probe run'
  )
  assert.equal(result.verdict, 'ready', '(d) [M4] an all-green probe run is `ready`')
}

// parseArgs of the four-flag argv.
assert.deepEqual(
  parseArgs(['--json', '--probe', '--config', '/c']),
  { json: true, probe: true, configPath: '/c' },
  '(d) [M4] parseArgs([\'--json\', \'--probe\', \'--config\', \'/c\']) deep-equals BASE\'s literal'
)

// renderRows of a fixed rows array, byte for byte.
{
  const FIXED_ROWS = [
    { id: 'exe-dev', status: 'ok', detail: 'signed in as marcus', fix: 'exe.dev account' },
    { id: 'golden', status: 'missing', detail: 'engine clone: absent', fix: 'Golden VM build' },
    { id: 'preflight', status: 'skipped', detail: 'not requested', fix: 'Preflight' }
  ]
  const EXPECTED_RENDER = [
    'ok      exe-dev  signed in as marcus',
    'missing golden  engine clone: absent',
    '    → RUNBOOK §Golden VM build',
    'skipped preflight  not requested'
  ].join('\n')

  assert.equal(
    renderRows(FIXED_ROWS),
    EXPECTED_RENDER,
    '(d) [M4] renderRows of a fixed rows array is byte-identical to BASE\'s output'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg (c) [M3] — the shared command list, at the end of the exam.
// ─────────────────────────────────────────────────────────────────────────────
{
  assert.ok(
    ALL_COMMANDS.length > 0,
    '(c) [M3] the shared command list is non-empty — every scenario above records into it'
  )
  assert.ok(
    RED_RUN_COMMANDS.length > 0,
    '(c) [M3] the shared list carries at least one entry from a run whose expectation is a red row'
  )
  for (const cmd of RED_RUN_COMMANDS) {
    assert.ok(
      ALL_COMMANDS.includes(cmd),
      `(c) [M3] the red-row entry ${JSON.stringify(cmd)} is in the shared list`
    )
  }

  const offenders = ALL_COMMANDS.filter((cmd) => cmd.includes(FORBIDDEN))
  assert.deepEqual(
    offenders,
    [],
    `(c) [M3] no command the doctor issues, with or without --probe, contains the substring '${FORBIDDEN}'; got ${JSON.stringify(offenders)}`
  )
}

console.log('ALL TESTS PASSED')
