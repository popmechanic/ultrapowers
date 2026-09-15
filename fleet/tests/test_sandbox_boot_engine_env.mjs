/**
 * Exam for run-135 task 3 — "The sandbox side forgets the renderer — the boot's
 * env file and argv entry, the boot rig, the hermetic probe" (#997 desired
 * state 2, #834).
 *
 * Claim: the boot starts a run's engine with no renderer address and reads no
 * address file, and the boot rig and the hermetic probe stop naming one.
 *
 * Five machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  `fleet/sandbox-boot.sh` carries zero occurrences of
 *       `TINYAPP_RENDER_URL`, `FLEET_RENDER_ENV`, `render.env` and `TINYAPP_`,
 *       and the `fleet-engine-` unit's `env -u CLAUDE_CONFIG_DIR` line is
 *       followed by exactly the three entries `ANTHROPIC_BASE_URL=…`,
 *       `CLAUDE_CODE_OAUTH_TOKEN=placeholder` and `ULTRAPOWERS_FLEET_RUN=…`,
 *       in that order, then `node`                                 → leg (a)
 *   M2  a boot driven by the rig with `FLEET_RENDER_ENV` set in the boot's own
 *       environment to a planted file starts an engine whose recorded
 *       `systemd-run` argv carries no `planted.invalid` and no
 *       `TINYAPP_RENDER_URL` entry                                 → leg (b)
 *   M3  the rig exports no `renderEnvPath` and `bootEnv` sets no
 *       `FLEET_RENDER_ENV`                                         → leg (c)
 *   M4  the hermetic probe has no M5 and no leg (i), its `PLANT` names
 *       `TINYAPP_BROWSER` and `FLEET_PLANTED` in place of the two renderer
 *       names, its M7 fixture pin reads `/etc/fleet/planted.env` and the
 *       fixture reads that path                                    → leg (d)
 *   M5  `fleet/CONTRACT.md` names the renderer nowhere: no
 *       `TINYAPP_RENDER_URL` entry on the engine-unit line, no render-address
 *       sentence, and no `omits` clause on the publish-fold bullet → leg (e)
 *
 * WHAT THIS EXAM DOES NOT RUN. Legs (c) and (d) grade the TEXT of the rig, the
 * probe and its fixture; that those two boot sims and the probe still pass is
 * the task's second, third and fourth `Run:` lines, and this exam may not take
 * them over: `test_sims_are_hermetic.mjs`'s own leg (d) names a sim that spawns
 * a sibling sim and its leg (e) names one that so much as checks a sibling's
 * name for existence. So this file spawns nothing of its own — every boot below
 * goes through the rig's `bootAsync`, whose `bootEnv` derives from `simEnv` —
 * makes no existence check, and reads no string-literal absolute path. The one
 * sibling name it does spell is the probe's own, and only as the path of a file
 * it READS: M4 is a clause about that file's text, and there is no way to grade
 * it without opening it.
 *
 * A boot here is the rig's whole green run (~1.5 s); the two of leg (b) are
 * started together and awaited once.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as rig from './_sandbox_boot_helpers.mjs'
import { makeHome, bootAsync, argvLines, stream, runTests } from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// The four files this exam reads, by their repository-relative paths.
const BOOT_SCRIPT = 'fleet/sandbox-boot.sh'
const BOOT_HELPERS = 'fleet/tests/_sandbox_boot_helpers.mjs'
const PROBE = 'fleet/tests/test_sims_are_hermetic.mjs'
const FIXTURE = 'fleet/tests/fixtures/hermetic/leaky_sim.mjs'
const CONTRACT = 'fleet/CONTRACT.md'

/** One of this task's own files, read from the checkout. */
const read = (rel) => {
  const full = path.join(ROOT, ...rel.split('/'))
  try {
    return fs.readFileSync(full, 'utf8')
  } catch (error) {
    return assert.fail(
      `${rel} is one of this task's own files — it is modified, never removed: ${error.message}`)
  }
}

/** Every line of `text` a string occurs in, or a regex matches, as `<n>: <line>`. */
const hits = (text, needle) => text
  .split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => (typeof needle === 'string' ? line.includes(needle) : needle.test(line)))
  .map(([n, line]) => `${n}: ${line.trim()}`)

// ── (a) the boot script  [M1] ────────────────────────────────────────────────
//
// The first `Run:` line, read here as source rather than as a shell: the four
// names counted over the whole file, and the engine unit read as ONE range from
// the line naming the unit to the first `run-main.mjs` after it — the same
// `sed -n '/--unit=fleet-engine-/,/run-main.mjs/p'` range, so the fold unit's
// own prefix, which carries the same three entries, is never what matched.

/** The four names the first `Run:` line greps for, `render\.env` literally. */
const FORBIDDEN = ['TINYAPP_RENDER_URL', 'FLEET_RENDER_ENV', 'render.env', 'TINYAPP_']

/** The three entries the engine unit hands the child, verbatim and in order. */
const ENTRIES = [
  '"ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \\',
  '"CLAUDE_CODE_OAUTH_TOKEN=placeholder" \\',
  '"ULTRAPOWERS_FLEET_RUN=$RUN_ID" \\',
]
const ENV_LINE = 'env -u CLAUDE_CONFIG_DIR \\'

/** The engine unit's lines, from `--unit=fleet-engine-` to `run-main.mjs`. */
const engineUnitRange = (text) => {
  const all = text.split('\n')
  const from = all.findIndex((l) => l.includes('--unit=fleet-engine-'))
  assert.notEqual(from, -1,
    `(a) [M1] ${BOOT_SCRIPT} starts the run's engine as a \`--unit=fleet-engine-<N>\` unit`)
  let to = from
  while (to < all.length && !all[to].includes('run-main.mjs')) to += 1
  assert.ok(to < all.length,
    '(a) [M1] and that unit runs `node <engine>/fleet/run-main.mjs` — the range the first `Run:` ' +
    'line reads has no end otherwise')
  return all.slice(from, to + 1)
}

test('(a) the boot names the renderer nowhere at all  [M1]', () => {
  const text = read(BOOT_SCRIPT)
  for (const name of FORBIDDEN) {
    assert.deepEqual(hits(text, name), [],
      `(a) [M1] ${BOOT_SCRIPT} carries zero occurrences of \`${name}\` — the default and its ` +
      'comment, the sourcing block and the argv entry all go, and so does every other mention ' +
      `the deletion leaves behind:\n  ${hits(text, name).join('\n  ')}`)
  }
  const any = hits(text, /TINYAPP_|FLEET_RENDER_ENV|render\.env/)
  assert.deepEqual(any, [],
    '(a) [M1] which is the first `Run:` line\'s own count over the four names, zero lines:\n  ' +
    any.join('\n  '))
})

test('(a) the engine unit hands the child exactly three entries, then node  [M1]', () => {
  const range = engineUnitRange(read(BOOT_SCRIPT))
  const trimmed = range.map((l) => l.trim())

  const envAt = trimmed.indexOf(ENV_LINE)
  assert.notEqual(envAt, -1,
    `(a) [M1] the engine unit's prefix ends \`${ENV_LINE}\`, byte for byte:\n  ` +
    trimmed.join('\n  '))
  const nodeAt = trimmed.findIndex((l, i) => i > envAt && l.startsWith('node '))
  assert.notEqual(nodeAt, -1,
    '(a) [M1] and `node <engine>/fleet/run-main.mjs` follows the entries:\n  ' + trimmed.join('\n  '))
  assert.deepEqual(trimmed.slice(envAt + 1, nodeAt), ENTRIES,
    '(a) [M1] with EXACTLY these three entries between them, in this order and no fourth — the ' +
    'renderer entry is gone and the other three stand byte for byte:\n  ' +
    JSON.stringify(trimmed.slice(envAt + 1, nodeAt), null, 2))

  // The same reading as one line, the shape the first `Run:` line greps after
  // `tr '\n' ' '`: nothing but spaces and continuations between the entries.
  const joined = range.join(' ')
  assert.match(
    joined,
    /env -u CLAUDE_CONFIG_DIR[ \\]*"ANTHROPIC_BASE_URL=[^"]*"[ \\]*"CLAUDE_CODE_OAUTH_TOKEN=placeholder"[ \\]*"ULTRAPOWERS_FLEET_RUN=[^"]*"[ \\]*node/,
    '(a) [M1] the first `Run:` line\'s own pattern, over the unit range joined by spaces:\n' +
    joined)
})

// ── (b) the boot reads no address file  [M2] ─────────────────────────────────

/** The planted address, and the hook the BASE boot sources it through. */
const PLANTED_URL = 'http://planted.invalid'
const PLANTED_LINE = `TINYAPP_RENDER_URL=${PLANTED_URL}\n`
const ENTRY_NAME = 'TINYAPP_RENDER_URL'

/** The `systemd-run` argv of this run's engine unit, as the stub recorded it. */
const engineArgv = (ctx) =>
  argvLines(ctx, 'systemd-run').find((a) => a.includes('--unit=fleet-engine-7'))

/** An argv with the case's own home replaced, so two runs compare as one. */
const withoutHome = (argv, ctx) => argv.map((w) => w.split(ctx.home).join('<home>'))

test('(b) a planted address file reaches no engine argv  [M2]', async () => {
  // THE EXACT HOOK THE BASE BOOT SOURCES: `FLEET_RENDER_ENV` in the boot's own
  // environment, naming a file this case wrote — the BASE boot sources it and
  // puts `TINYAPP_RENDER_URL=http://planted.invalid` in the engine's argv.
  const planted = makeHome()
  const plantedFile = path.join(planted.home, 'render.env')
  fs.writeFileSync(plantedFile, PLANTED_LINE)
  // And a second boot with no such variable at all, to compare against.
  const bare = makeHome()

  const [withFile, without] = await Promise.all([
    bootAsync(planted, ['boot'], { FLEET_RENDER_ENV: plantedFile }),
    bootAsync(bare, ['boot'], { FLEET_RENDER_ENV: undefined }),
  ])
  assert.equal(withFile.status, 0,
    '(b) [M2] the boot given a planted address file still runs green — the file is a fact of the ' +
    'box the boot ignores, never one it fails on:\n' + withFile.stdout + withFile.stderr)
  assert.equal(without.status, 0,
    '(b) [M2] and so does the boot given none:\n' + without.stdout + without.stderr)

  const argv = engineArgv(planted)
  assert.ok(argv,
    '(b) [M2] that boot reached its engine start and the `systemd-run` stub recorded the argv:\n' +
    stream(planted).join('\n'))
  assert.deepEqual(argv.filter((w) => w.includes(PLANTED_URL)), [],
    `(b) [M2] no word of the engine's recorded argv carries \`${PLANTED_URL}\` — the BASE boot, ` +
    'given this same environment, sourced the file and carried it:\n  ' + argv.join('\n  '))
  assert.deepEqual(argv.filter((w) => w.includes(ENTRY_NAME)), [],
    `(b) [M2] and no word of it is a \`${ENTRY_NAME}\` entry, empty or otherwise — the entry is ` +
    'gone from the unit, not merely emptied:\n  ' + argv.join('\n  '))
  assert.deepEqual(stream(planted).filter((l) => l.includes(plantedFile)), [],
    '(b) [M2] and the boot log names that file nowhere: the boot reads no address file at all  ' +
    '[Claim]:\n' + stream(planted).join('\n'))

  const other = engineArgv(bare)
  assert.ok(other, '(b) [M2] the second boot reached its engine start too:\n' + stream(bare).join('\n'))
  assert.deepEqual(withoutHome(other, bare), withoutHome(argv, planted),
    '(b) [M2] and its engine argv differs from the first in nothing but the case\'s own home — a ' +
    'boot with a planted address file and a boot with none start the engine alike, which a boot ' +
    'that still sourced one (or still fell back to the box\'s own file) could not do')
})

// ── (c) the rig  [M3] ────────────────────────────────────────────────────────

test('(c) the boot rig exports no renderEnvPath and pins no FLEET_RENDER_ENV  [M3]', () => {
  assert.deepEqual(Object.keys(rig).filter((n) => n === 'renderEnvPath'), [],
    '(c) [M3] the rig exports no `renderEnvPath` — the address file was the rig\'s to pin only ' +
    `while the boot read one: ${JSON.stringify(Object.keys(rig))}`)
  assert.equal(rig.renderEnvPath, undefined, '(c) [M3] and the name answers nothing')

  const text = read(BOOT_HELPERS)
  for (const name of ['FLEET_RENDER_ENV', 'renderEnvPath', ENTRY_NAME]) {
    assert.deepEqual(hits(text, name), [],
      `(c) [M3] ${BOOT_HELPERS} names \`${name}\` nowhere — \`bootEnv\` sets no such key, and the ` +
      `helper and its comment are gone with it:\n  ${hits(text, name).join('\n  ')}`)
  }
  // The two boot sims that drive this rig are the task's second and third
  // `Run:` lines; this exam grades the rig's text and runs no sibling sim.
})

// ── (d) the hermetic probe and its fixture  [M4] ─────────────────────────────

/** The braced block a `const <name> = {` opens, as text. */
const blockOf = (text, decl) => {
  const from = text.indexOf(decl)
  assert.notEqual(from, -1, `(d) [M4] the probe still declares \`${decl}\``)
  let depth = 0
  for (let i = from + decl.indexOf('{'); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return assert.fail(`(d) [M4] \`${decl}\` is never closed`)
}

/** The six prefixes the probe's own M1 sweeps, one planted key each. */
const PLANT_KEYS = [
  'ULTRA_PLANTED', 'TINYAPP_BROWSER', 'FLEET_PLANTED',
  'CLAUDE_CONFIG_DIR', 'GH_TOKEN', 'ANTHROPIC_API_KEY',
]
const PLANTED_PATH = '/etc/fleet/planted.env'
/** The read the fixture makes and the probe's leg (g) pins, verbatim. */
const FIXTURE_PIN = `fs.readFileSync('${PLANTED_PATH}', 'utf8')`

test('(d) the probe plants two names that are not the renderer\'s  [M4]', () => {
  const probe = read(PROBE)
  const plant = blockOf(probe, 'const PLANT = {')
  const keys = [...plant.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1])
  assert.deepEqual([...keys].sort(), [...PLANT_KEYS].sort(),
    '(d) [M4] `PLANT` names `TINYAPP_BROWSER` and `FLEET_PLANTED` IN PLACE OF the two renderer ' +
    `names — one key per swept prefix, no key more and none fewer: ${JSON.stringify(keys)}`)
  for (const prefix of ['ULTRA_', 'TINYAPP_', 'FLEET_', 'ANTHROPIC_', 'CLAUDE_', 'GH_']) {
    assert.equal(keys.filter((k) => k.startsWith(prefix)).length, 1,
      `(d) [M4] and exactly one of them begins \`${prefix}\`, so every leg that loops \`PLANT\` ` +
      `still plants one key per dropped prefix: ${JSON.stringify(keys)}`)
  }
  assert.match(plant, /TINYAPP_BROWSER\s*:\s*'\/planted\/chrome'/,
    `(d) [M4] \`TINYAPP_BROWSER\` is planted as '/planted/chrome': ${plant.replace(/\s+/g, ' ')}`)
  assert.match(plant, /FLEET_PLANTED\s*:\s*'\/planted\/file'/,
    `(d) [M4] and \`FLEET_PLANTED\` as '/planted/file': ${plant.replace(/\s+/g, ' ')}`)
})

test('(d) the probe\'s M7 pin and the fixture read the planted path  [M4]', () => {
  const probe = read(PROBE)
  const fixture = read(FIXTURE)
  assert.ok(probe.includes(FIXTURE_PIN),
    `(d) [M4] the probe pins the fixture's absolute read as \`${FIXTURE_PIN}\` — its M7 fixture ` +
    'pin reads the planted path, and the renderer\'s file is not what the fixture leaks any more')
  assert.ok(fixture.includes(FIXTURE_PIN),
    `(d) [M4] and ${FIXTURE} makes that read, verbatim — the pin and the fixture are one text`)
  assert.deepEqual(hits(fixture, 'render.env'), [],
    `(d) [M4] the fixture names \`render.env\` nowhere, in its \`reads\` function or its comment:` +
    `\n  ${hits(fixture, 'render.env').join('\n  ')}`)
})

test('(d) the probe and the fixture carry neither renderer name  [M4]', () => {
  // The fourth `Run:` line's own grep, over the three files it counts.
  for (const rel of [PROBE, BOOT_HELPERS, FIXTURE]) {
    const text = read(rel)
    for (const name of [ENTRY_NAME, 'FLEET_RENDER_ENV']) {
      assert.deepEqual(hits(text, name), [],
        `(d) [M4] ${rel} carries zero occurrences of \`${name}\`:\n  ${hits(text, name).join('\n  ')}`)
    }
  }
})

test('(d) the probe has no M5 and no leg (i)  [M4]', () => {
  const probe = read(PROBE)
  assert.deepEqual(hits(probe, /\bM5\b/), [],
    '(d) [M4] the probe\'s header lists no M5 and no case names one — the clause about the boot ' +
    `naming \`/etc/fleet/render.env\` once is gone, and nothing was renumbered:\n  ${hits(probe, /\bM5\b/).join('\n  ')}`)
  assert.deepEqual(hits(probe, 'leg (i)'), [],
    '(d) [M4] and no `leg (i)` is left — the two cases that read the boot\'s default and the ' +
    `rig's pin go, and the header's \`Legs:\` line loses \`(i) M5\`:\n  ${hits(probe, 'leg (i)').join('\n  ')}`)
})

// ── (e) the contract  [M5] ───────────────────────────────────────────────────

/** One `  - <name>:` bullet of §the boot script, to the next bullet at its indent. */
const bulletOf = (text, opening) => {
  const from = text.indexOf(opening)
  assert.notEqual(from, -1, `(e) [M5] ${CONTRACT} still carries the \`${opening}\` bullet`)
  const next = text.indexOf('\n  - ', from + 1)
  return text.slice(from, next === -1 ? text.length : next)
}

test('(e) the contract names the renderer nowhere  [M5]', () => {
  const text = read(CONTRACT)
  assert.deepEqual(hits(text, ENTRY_NAME), [],
    `(e) [M5] ${CONTRACT} carries zero occurrences of \`${ENTRY_NAME}\` — the fifth \`Run:\` ` +
    `line's first half:\n  ${hits(text, ENTRY_NAME).join('\n  ')}`)
  assert.deepEqual(hits(text, 'render address'), [],
    '(e) [M5] and zero of `render address` — the sentence "The render entry passes the boot\'s ' +
    `render address through to the engine …" is gone, its second half:\n  ${hits(text, 'render address').join('\n  ')}`)
  assert.deepEqual(hits(text, 'The render entry'), [],
    `(e) [M5] that sentence's opening words with it:\n  ${hits(text, 'The render entry').join('\n  ')}`)

  const engine = bulletOf(text, '  - engine: `systemd-run')
  assert.ok(engine.includes('ULTRAPOWERS_FLEET_RUN=run-N node '),
    '(e) [M5] the engine-unit line reads `ULTRAPOWERS_FLEET_RUN=run-N node <engine>/fleet/' +
    'run-main.mjs …` — the entry is removed from between them, and the line otherwise stands:\n' +
    engine)

  const fold = bulletOf(text, '  - publish fold:')
  assert.deepEqual(hits(fold, 'omits'), [],
    '(e) [M5] and the publish-fold bullet no longer says the fold unit `omits` an entry — with ' +
    'nothing left to except, its line is the engine\'s prefix and names no exception:\n' + fold)
  assert.ok(/same `systemd-run` prefix/.test(fold),
    '(e) [M5] which it still describes as the same `systemd-run` prefix as the engine\'s line ' +
    'above:\n' + fold)
})

runTests(tests)
