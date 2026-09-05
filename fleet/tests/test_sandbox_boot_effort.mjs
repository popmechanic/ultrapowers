/**
 * fleet/tests/test_sandbox_boot_effort.mjs — the sandbox half of "a launch flag
 * turns implementer effort down": `effort=<v>` in the assignment comment
 * becomes `--implementer-effort <v>` on the engine's argv.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (b) [M2] `fleet/sandbox-boot.sh` accepts `effort=<v>` in the assignment and
 *       appends `--implementer-effort <v>` to the engine's argv AFTER the tier
 *       and overlap knobs — for each of `low`, `medium`, `high`; the helper's
 *       assignment, which carries no `effort=` key, records the argv the
 *       green-path sim pins, unchanged from BASE; and a value outside the three
 *       (`effort=max`) fails the boot with `assignment` in its failure line.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the same stub bin dir, relocated
 * `FLEET_HOME` and recorded argv the other two halves of the boot exam use. No
 * network, no systemd, no real `claude`, no `git` that reaches a remote.
 */

import assert from 'node:assert/strict'

import {
  ENGINE_SHA, ASSIGNMENT,
  makeHome, boot, green,
  readLog, argvLines, statusOf, engineRuns,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The three values the knob offers. */
const EFFORTS = ['low', 'medium', 'high']

/** The one `systemd-run` argv that started the engine, as recorded words. */
const engineArgv = (ctx) => {
  const runs = argvLines(ctx, 'systemd-run').filter((a) => a.includes('--unit=fleet-engine-7'))
  assert.equal(runs.length, 1, 'the engine is started exactly once')
  return runs[0]
}

/**
 * The engine argv the green-path sim pins for the helper's assignment
 * (`overlap=fold tier=mostCapable`), plus whatever `tail` the case expects
 * after the tier and overlap knobs. Spelled in full, so the leg is an equality
 * over the whole argv rather than a search inside it.
 */
const expectedArgv = (home, tail = []) => [
  'systemd-run', '--user', '--unit=fleet-engine-7', '--pipe', '--wait', '--collect',
  '-p', 'MemoryMax=40G', '-p', 'MemorySwapMax=0', '-p', `WorkingDirectory=${home}/target`, '--',
  'env', '-u', 'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz',
  'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
  'ULTRAPOWERS_FLEET_RUN=run-7',
  'node', `${home}/engines/${ENGINE_SHA}/fleet/run-main.mjs`,
  `${home}/plans/run-7.md`, 'run-7', '--repo', `${home}/target`,
  '--tier', 'mostCapable', '--overlap', 'fold',
  ...tail,
]

// ── b. [M2] effort=<v> in the assignment → --implementer-effort <v> ─────────

for (const v of EFFORTS) {
  test(`effort=${v} in the assignment appends --implementer-effort ${v} after the tier and overlap knobs  [M2 / leg (b)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} effort=${v}` })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(statusOf(ctx).state, 'done', `effort=${v} is accepted: the run reaches done`)

    const argv = engineArgv(ctx)
    assert.deepEqual(
      argv, expectedArgv(ctx.home, ['--implementer-effort', v]),
      `(b) [M2] effort=${v} rides the engine argv as --implementer-effort ${v}, and nothing else moves`
    )
    // The clause's own words: the two knobs the boot script already appended
    // come first, and the new pair is last.
    assert.deepEqual(
      argv.slice(-2), ['--implementer-effort', v],
      `(b) [M2] the last two words of the engine argv are --implementer-effort and ${v}`
    )
    assert.ok(
      argv.lastIndexOf('--tier') < argv.indexOf('--implementer-effort') &&
      argv.lastIndexOf('--overlap') < argv.indexOf('--implementer-effort'),
      '(b) [M2] and they come after the tier and overlap knobs'
    )
  })
}

test("the helper's assignment carries no effort= key, so the engine argv is BASE's  [M2 / leg (b)]", () => {
  const ctx = green()
  const argv = engineArgv(ctx)
  assert.deepEqual(
    argv, expectedArgv(ctx.home),
    '(b) [M2] without the key the argv is as at BASE — the default is unchanged'
  )
  assert.ok(
    !argv.includes('--implementer-effort'),
    '(b) [M2] and no --implementer-effort word appears at all'
  )
})

test('effort=max fails the assignment: no clone, no engine, `assignment` in the failure line  [M2 / leg (b)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} effort=max` })
  assert.notEqual(r.status, 0, 'a value outside the three must exit non-zero')

  const status = statusOf(ctx)
  assert.equal(status.state, 'failed', '(b) [M2] the run is failed')
  assert.match(
    String(status.error), /assignment/,
    `(b) [M2] the failure line names the assignment; got: ${status.error}`
  )
  assert.equal(readLog(ctx, 'git.log'), '', '(b) [M2] nothing is cloned on a refused assignment')
  assert.equal(engineRuns(ctx), 0, '(b) [M2] and no engine is started')
})

runTests(tests)
