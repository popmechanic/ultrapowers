/**
 * Exam for Task 1 of run 79: THE RIG OWNS THE RENDERER PATH.
 *
 * The claim: a boot sim never reads a renderer file the host installed, and a
 * sim that wants one writes its own. The production script is not edited —
 * `FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-…}"` in `fleet/sandbox-boot.sh` stays
 * as it is — so the whole fix is that the rig hands every boot a
 * `FLEET_RENDER_ENV` of its own, under the case's temp `FLEET_HOME`.
 *
 * The clauses this file pins, in the Machine's own words:
 *
 *   M1 / leg (a)   a boot started through `bootAsync` whose case `env` carries
 *                  no `FLEET_RENDER_ENV` runs with `FLEET_RENDER_ENV` equal to
 *                  `renderEnvPath(ctx)` — the path `<ctx.home>/render.env` — in
 *                  the environment the `systemd-run` stub records at
 *                  `<ctx.home>/systemd-run.env`, EVEN THOUGH the test process's
 *                  own environment carries a `FLEET_RENDER_ENV` naming a
 *                  readable file whose one line is the `abc123` address; and
 *                  that boot's `fleet-engine-7` argv carries exactly one entry
 *                  beginning `TINYAPP_RENDER_URL=`, equal to
 *                  `TINYAPP_RENDER_URL=`.
 *   M1 / leg (a2)  the same three readings of a boot started through the
 *                  BLOCKING `boot`, on a second home, under that same process
 *                  environment — the synchronous entry point is exercised on
 *                  its own rather than inferred from the promised one.
 *   M2 / leg (b)   a sim that first writes the `abc123` line at
 *                  `renderEnvPath(ctx)` and boots with `{}` gets that same line
 *                  as the ONE `TINYAPP_RENDER_URL=`-prefixed entry of its
 *                  `fleet-engine-7` argv, inside the `env` prefix — between the
 *                  argv's `env` and its `node`.
 *   M3 / leg (c)   no file among `_sandbox_boot_helpers.mjs` and every
 *                  `test_sandbox_boot*.mjs` — this guarded exam included —
 *                  contains the host's renderer path.
 *   M3 / leg (d)   `test_sandbox_boot.mjs`, `test_sandbox_boot_effort.mjs` and
 *                  `test_sandbox_boot_state_exams.mjs` are each a file under
 *                  `fleet/tests/`. Whether each one prints `ALL TESTS PASSED` is
 *                  its own bridge case's business: no sim runs another sim, so
 *                  this leg names the three the rig change touches and leaves
 *                  the running of them to the bridge.
 *
 * Two things about how this file is written.
 *
 * It never spells the host's renderer path: leg (c) forbids that string in this
 * very file, so the path is ASSEMBLED from its segments (the way
 * `RETIRED_NAMES` is assembled in the rig) and the host's file is a real file
 * this exam writes in a temp directory of its own, named through
 * `process.env.FLEET_RENDER_ENV`. That planted file is the host's installed one
 * as far as a boot can tell: readable, and carrying exactly the line
 * `fleet/setup-script.mjs` installs.
 *
 * And a boot is ~40 forks of stub shell, so this exam runs three of them: the
 * two promised ones start side by side at load, and leg (a2)'s blocking one
 * runs alone once they have both landed. `renderEnvPath` is read through the
 * module namespace rather than a named import so that a rig which does not
 * export it yet fails the legs that need it with a message that says so,
 * instead of failing to link.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  makeHome, boot, bootAsync,
  argvLines, readLog, unitsRun,
  runTests,
} from './_sandbox_boot_helpers.mjs'
import * as rig from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the renderer address ─────────────────────────────────────────────────────

/** The one URL any fleet script writes: exe.dev's edge, never Cloudflare's own
 *  host. M1 and M2 both spell it verbatim. */
const RENDER_URL =
  'https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering'
/** The file's one line, and therefore the argv entry a boot that sourced it
 *  carries. */
const RENDER_LINE = `TINYAPP_RENDER_URL=${RENDER_URL}`
/** The entry a boot with no such file carries instead: the name, `=`, nothing. */
const EMPTY_ENTRY = 'TINYAPP_RENDER_URL='

/**
 * The path the setup script installs the address at on a real sandbox —
 * ASSEMBLED, never written, because leg (c) forbids that string in this file
 * too. Leg (c) greps for exactly this.
 */
const HOST_RENDER_ENV = ['', 'etc', 'fleet', 'render.env'].join('/')

/** Every `TINYAPP_RENDER_URL=` entry of one argv, in argv order. */
const renderEntries = (argv) => (argv || []).filter((w) => w.startsWith(EMPTY_ENTRY))

/**
 * The `env` prefix's entries of a unit's argv: the words between the literal
 * `env` and the literal `node`. The child inherits no environment from the
 * script, so this slice IS the engine's environment; a word after `node` is an
 * argument to the engine instead.
 */
function envPrefix(argv, leg) {
  const from = argv.indexOf('env')
  const to = argv.indexOf('node')
  assert.ok(from >= 0 && to > from,
    `${leg} the unit's argv must still be an \`env … node …\` prefix, got: ${argv.join(' ')}`)
  return argv.slice(from + 1, to)
}

/** The engine unit's `systemd-run` argv. */
function engineArgv(ctx, leg) {
  const argv = argvLines(ctx, 'systemd-run').find((a) => a.includes('--unit=fleet-engine-7'))
  assert.ok(argv, `${leg} a systemd-run of --unit=fleet-engine-7; the units run were ` +
    JSON.stringify(unitsRun(ctx)))
  return argv
}

/** Every `FLEET_RENDER_ENV=` line of the environment the `systemd-run` stub
 *  recorded at `<ctx.home>/systemd-run.env` — the boot's own environment at
 *  engine dispatch. */
const renderEnvLines = (ctx) =>
  readLog(ctx, 'systemd-run.env').split('\n').filter((l) => l.startsWith('FLEET_RENDER_ENV='))

/** The default path M1 names, spelled as the Machine spells it. A sim can plant
 *  its file here before the rig is asked for the same path. */
const defaultRenderEnv = (ctx) => path.join(ctx.home, 'render.env')

/**
 * The rig's own answer, and the Produces contract in one reading:
 * `renderEnvPath(ctx: {home: string}) -> string`, equal to `<ctx.home>/render.env`.
 */
function renderEnvPath(ctx, leg) {
  assert.equal(typeof rig.renderEnvPath, 'function',
    `${leg} the rig \`_sandbox_boot_helpers.mjs\` must export \`renderEnvPath(ctx)\` — the ` +
      'path a boot of `ctx` reads its renderer file from; the rig exports no such function')
  const answer = rig.renderEnvPath(ctx)
  assert.equal(answer, defaultRenderEnv(ctx),
    `${leg} \`renderEnvPath(ctx)\` is the path \`<ctx.home>/render.env\``)
  return answer
}

// ── the host's installed file, and this process's environment ────────────────
//
// M1's condition: the test process's OWN environment carries a
// `FLEET_RENDER_ENV` naming a readable file whose one line is the address. This
// is that file — written here, under a temp root of this exam's own, so nothing
// in this exam depends on what the box it runs on has installed.

const HOST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-boot-host-render-'))
const HOST_FILE = path.join(HOST_ROOT, 'host-render.env')
fs.writeFileSync(HOST_FILE, RENDER_LINE + '\n')
const PROCESS_RENDER_ENV_BEFORE = process.env.FLEET_RENDER_ENV
process.env.FLEET_RENDER_ENV = HOST_FILE
process.on('exit', () => {
  if (PROCESS_RENDER_ENV_BEFORE === undefined) delete process.env.FLEET_RENDER_ENV
  else process.env.FLEET_RENDER_ENV = PROCESS_RENDER_ENV_BEFORE
  fs.rmSync(HOST_ROOT, { recursive: true, force: true })
})

// ── the boots ────────────────────────────────────────────────────────────────

/**
 * THE BARE BOOT of leg (a): no `FLEET_RENDER_ENV` in the case `env`, nothing
 * planted at the rig's path, and this process's environment naming the host's
 * file. Started through `bootAsync`, beside the planted one.
 */
const bareBoot = (() => {
  const ctx = makeHome()
  const done = bootAsync(ctx, ['boot'], {}).then((r) => ({ ctx, result: r }))
  // Marked handled at creation: a boot that failed while a sibling was still in
  // flight must reach the leg that reads it rather than killing the process as
  // an unhandled rejection.
  done.catch(() => {})
  return () => done
})()

/**
 * THE PLANTED BOOT of leg (b): the `abc123` line written at the rig's own
 * default path, and a case `env` that passes no `FLEET_RENDER_ENV` at all.
 */
const plantedBoot = (() => {
  const ctx = makeHome()
  const planted = defaultRenderEnv(ctx)
  fs.writeFileSync(planted, RENDER_LINE + '\n')
  const done = bootAsync(ctx, ['boot'], {}).then((r) => ({ ctx, result: r, planted }))
  done.catch(() => {})
  return () => done
})()

// ── leg (d)'s sibling sims: names, not runs ──────────────────────────────────
//
// The three sims the rig change touches. NOT spawned from here — a sim that
// runs another sim runs it twice (the bridge already has a case for each) and
// hands it whatever environment this process happens to carry. They survive as
// names leg (d) checks exist under `fleet/tests/`; the bridge runs them.

const SIBLING_SIMS = [
  'test_sandbox_boot.mjs',
  'test_sandbox_boot_effort.mjs',
  'test_sandbox_boot_state_exams.mjs',
]

// ── (a) the promised boot runs under the rig's path, not the host's  [M1] ────

test('a promised boot pins FLEET_RENDER_ENV at renderEnvPath(ctx) and hands the engine an empty TINYAPP_RENDER_URL=  [M1 / leg (a)]', async () => {
  // The leg's own condition: this process's environment names a READABLE file
  // whose one line is the address. Without it the leg proves nothing.
  assert.equal(process.env.FLEET_RENDER_ENV, HOST_FILE,
    '(a) [M1] this leg runs with the test process\'s own FLEET_RENDER_ENV naming the file it ' +
      'planted')
  fs.accessSync(HOST_FILE, fs.constants.R_OK)
  assert.equal(fs.readFileSync(HOST_FILE, 'utf8'), RENDER_LINE + '\n',
    '(a) [M1] and that file\'s one line is the address the setup script installs')

  const { ctx, result } = await bareBoot()
  assert.equal(result.status, 0,
    `(a) [M1] a boot whose case env carries no FLEET_RENDER_ENV exits 0:\n${result.stdout}${result.stderr}`)

  const expected = renderEnvPath(ctx, '(a) [M1]')
  assert.notEqual(expected, HOST_FILE,
    '(a) [M1] the rig\'s path is the case\'s own, never the file this process\'s environment names')

  // M1's observation: the environment the `systemd-run` stub recorded.
  const found = renderEnvLines(ctx)
  assert.equal(found.length, 1,
    '(a) [M1] exactly one FLEET_RENDER_ENV= line in the environment the systemd-run stub ' +
      `recorded at <ctx.home>/systemd-run.env, got ${JSON.stringify(found)}`)
  assert.equal(found[0], `FLEET_RENDER_ENV=${expected}`,
    `(a) [M1] and it is the rig's own path, \`FLEET_RENDER_ENV=${expected}\``)

  // Nothing is planted there, so the value the script sources is nothing — and
  // that is the second half of the leak: the file must not exist unless a sim
  // wrote it.
  assert.ok(!fs.existsSync(expected),
    `(a) [M1] makeHome plants no ${path.basename(expected)}, so this boot sourced nothing`)

  const argv = engineArgv(ctx, '(a) [M1]')
  const entries = renderEntries(argv)
  assert.deepEqual(entries, [EMPTY_ENTRY],
    `(a) [M1] the engine argv's \`${EMPTY_ENTRY}\`-prefixed entries are exactly ` +
      `['${EMPTY_ENTRY}'] — one entry, empty, because the host's file was never read; got ` +
      `${JSON.stringify(entries)} in: ${argv.join(' ')}`)
  assert.deepEqual(renderEntries(envPrefix(argv, '(a) [M1]')), [EMPTY_ENTRY],
    '(a) [M1] and it rides in the `env` prefix, between `env` and `node`')
})

// ── (a2) the blocking boot, on its own  [M1] ─────────────────────────────────

test('the blocking boot pins the same path, on a home of its own  [M1 / leg (a2)]', async () => {
  // Both promised boots have landed before the blocking one starts: this leg
  // exercises `boot` alone rather than holding the event loop while its
  // siblings are still draining their pipes.
  await bareBoot()
  await plantedBoot()

  assert.equal(process.env.FLEET_RENDER_ENV, HOST_FILE,
    '(a2) [M1] under the same process environment as leg (a)')

  const ctx = makeHome()
  const result = boot(ctx, ['boot'], {})
  assert.equal(result.status, 0,
    `(a2) [M1] the synchronous entry point exits 0 too:\n${result.stdout}${result.stderr}`)

  const expected = renderEnvPath(ctx, '(a2) [M1]')
  const found = renderEnvLines(ctx)
  assert.equal(found.length, 1,
    '(a2) [M1] exactly one FLEET_RENDER_ENV= line in <ctx.home>/systemd-run.env, got ' +
      JSON.stringify(found))
  assert.equal(found[0], `FLEET_RENDER_ENV=${expected}`,
    `(a2) [M1] and it is \`FLEET_RENDER_ENV=${expected}\` — \`boot\` builds the same ` +
      'environment `bootAsync` does')

  const argv = engineArgv(ctx, '(a2) [M1]')
  assert.deepEqual(renderEntries(argv), [EMPTY_ENTRY],
    `(a2) [M1] the engine argv's \`${EMPTY_ENTRY}\`-prefixed entries are exactly ` +
      `['${EMPTY_ENTRY}'], got: ${argv.join(' ')}`)
})

// ── (b) a sim that wants a renderer writes its own  [M2] ─────────────────────

test('a sim that writes the address at renderEnvPath(ctx) and boots with {} gets that line in the engine argv  [M2 / leg (b)]', async () => {
  const { ctx, result, planted } = await plantedBoot()
  assert.equal(result.status, 0,
    `(b) [M2] the planted boot runs to completion:\n${result.stdout}${result.stderr}`)

  // The rig planted the one line, at the path the rig itself names.
  assert.equal(fs.readFileSync(planted, 'utf8'), RENDER_LINE + '\n',
    '(b) [M2] the sim wrote the one line the setup script writes')
  assert.equal(renderEnvPath(ctx, '(b) [M2]'), planted,
    '(b) [M2] at `renderEnvPath(ctx)` — the path the boot reads with no FLEET_RENDER_ENV in ' +
      'its case env')

  const found = renderEnvLines(ctx)
  assert.deepEqual(found, [`FLEET_RENDER_ENV=${planted}`],
    '(b) [M2] the boot ran with FLEET_RENDER_ENV naming that file, and nothing else, got ' +
      JSON.stringify(found))

  const argv = engineArgv(ctx, '(b) [M2]')
  const entries = renderEntries(argv)
  assert.deepEqual(entries, [RENDER_LINE],
    `(b) [M2] the ONE \`${EMPTY_ENTRY}\`-prefixed entry of the engine argv carries the sourced ` +
      `value: exactly ['${RENDER_LINE}'] — an empty entry or a second one fails this leg; got ` +
      `${JSON.stringify(entries)} in: ${argv.join(' ')}`)

  // In the `env` prefix, between `env` and `node`: a word parked after `node`
  // would be an argument to the engine, not a variable in its environment.
  assert.deepEqual(renderEntries(envPrefix(argv, '(b) [M2]')), [RENDER_LINE],
    '(b) [M2] and it rides among the `env` prefix\'s entries, between `env` and `node`')
  assert.deepEqual(renderEntries(argv.slice(argv.indexOf('node'))), [],
    '(b) [M2] and no such entry sits after `node`, where it would be an engine argument')
})

// ── (c) no boot sim names the host's renderer path  [M3] ─────────────────────

test('neither the rig nor any test_sandbox_boot*.mjs names the host renderer path  [M3 / leg (c)]', () => {
  const RIG = '_sandbox_boot_helpers.mjs'
  const swept = [RIG, ...fs.readdirSync(HERE)
    .filter((n) => n.startsWith('test_sandbox_boot') && n.endsWith('.mjs'))
    .sort()]

  // The sweep is the `Run:`'s: the rig, and every boot sim beside it — this
  // guarded exam included, and the three sims leg (d) runs.
  const SELF = path.basename(fileURLToPath(import.meta.url))
  for (const name of [RIG, SELF, ...SIBLING_SIMS]) {
    assert.ok(swept.includes(name),
      `(c) [M3] the sweep must cover ${name}; it covered ${swept.join(' ')}`)
  }

  const survivors = swept.filter((name) =>
    fs.readFileSync(path.join(HERE, name), 'utf8').includes(HOST_RENDER_ENV))
  assert.deepEqual(survivors, [],
    `(c) [M3] no file among the rig and the boot sims contains the host's renderer path — a ` +
      'boot sim that names it reads a file the host installed, or asserts on one; the ' +
      `survivors were ${survivors.join(' ')}`)
})

// ── (d) the boot sims the rig change touches are each a real sim  [M3] ───────

for (const file of SIBLING_SIMS) {
  test(`${file} is a sim the bridge runs  [M3 / leg (d)]`, () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'fleet/tests', file)),
      `(d) [M3] \`fleet/tests/${file}\` must exist — it is one of the sims the rig change ` +
        'touches, and the bridge has a case of its own that runs it and asserts ' +
        'ALL TESTS PASSED. This leg names it; it does not run it.')
  })
}

runTests(tests)
