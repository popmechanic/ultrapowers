/**
 * Exam for Task 2 of the TinyApp state-exams plan: `fleet/sandbox-boot.sh`
 * sources the renderer address, hands it to the engine as one more environment
 * entry, and copies whatever the exams recorded under `state-exams/` onto the
 * evidence branch — file by file, nested once.
 *
 * The clauses this file pins, in the Proof's own words:
 *
 *   M1 / leg (a)  a boot whose case `env` names no `FLEET_RENDER_ENV` — so the
 *                 rig's own `renderEnvPath(ctx)`, which nothing planted, is the
 *                 file the script looks for — exits 0, and the `fleet-engine-7`
 *                 argv carries exactly one entry equal to `TINYAPP_RENDER_URL=`.
 *   M1 / leg (b)  a boot with `FLEET_RENDER_ENV` naming a file whose one line is
 *                 `TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`
 *                 carries exactly one such entry, equal to that line, among the
 *                 `env` prefix's entries of the engine unit's argv.
 *   M2 / leg (c)  in that same planted-file boot the `fleet-fold-7-1` argv
 *                 carries no entry beginning `TINYAPP_RENDER_URL=` — the fold
 *                 unit is absent from the set of argvs carrying one.
 *   M3 / leg (d)  with the five planted files, every one is present under
 *                 `<evidence>/.ultrapowers/runs/7/state-exams/task-1/buy-milk-0/`
 *                 with bytes equal to the run directory's copy (the PNG
 *                 included), `buy-milk-base/walls.json` is present too, and
 *                 `readdirSync` of `.ultrapowers/runs/7/state-exams/` is exactly
 *                 `['task-1']` with no `state-exams` entry at any depth below it.
 *   M3 / leg (e)  a boot with nothing planted leaves no
 *                 `.ultrapowers/runs/7/state-exams` path at all.
 *   M3 / leg (f)  the planted boot's evidence commits number at least three
 *                 (`commitStates` reads `running`, `publishing`, `done`), so the
 *                 once-nested assertion of leg (d) was made after repeated
 *                 copies of the same tree.
 *   M1, M3 / (g)  the green-path boot sim and the approval-evidence sim — the
 *                 transcripts copy and the once-nested rule for `transcripts/`,
 *                 which `state-exams/` sits after — still print the sentinel,
 *                 and the script parses under `bash -n`.
 *
 * The rig is `_sandbox_boot_helpers.mjs`, shared with `test_sandbox_boot.mjs`:
 * the stub bin dir, `makeHome`, `bootAsync`, `argvLines`, `foldArgv`,
 * `evidenceDir` and `runTests`. The one thing that rig cannot do is leave a
 * `state-exams/` tree behind, so `examHome()` splices the writes into the shared
 * engine stub — the same splice point and the same shape
 * `test_sandbox_boot_approval_evidence.mjs` uses for `transcripts/`. The bytes
 * are this file's own, so byte-equality is a real comparison and not two empty
 * files agreeing, and the screenshot is a few bytes of NON-UTF-8 content so
 * "byte for byte" is asked of a binary.
 *
 * A boot is ~40 forks of stub shell, so this exam runs exactly two of them —
 * the planted one and the bare one — side by side with the two sibling sims of
 * leg (g), and every leg reads one of those four.
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, RUN_PATH,
  STUBS, PRELUDE, makeHome, bootAsync, renderEnvPath,
  argvLines, foldArgv, unitsRun, commitStates, evidenceDir,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The repository root — where the sibling sims of leg (g) are run from. */
const ROOT = path.join(HERE, '..', '..')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the renderer address  [M1] ───────────────────────────────────────────────

/** The one URL any fleet script writes: exe.dev's edge, never Cloudflare's own
 *  host. Leg (b) spells it verbatim. */
const RENDER_URL =
  'https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering'
/** The file's one line, and therefore the argv entry the engine unit carries. */
const RENDER_LINE = `TINYAPP_RENDER_URL=${RENDER_URL}`
/** The entry a boot with no such file carries instead: the name, `=`, nothing. */
const EMPTY_ENTRY = 'TINYAPP_RENDER_URL='

/** Every `TINYAPP_RENDER_URL=` entry in one argv, in argv order. */
const renderEntries = (argv) => (argv || []).filter((w) => w.startsWith(EMPTY_ENTRY))

/**
 * The `env` prefix's entries of a unit's argv: the words between the literal
 * `env` and the literal `node`. The child inherits no environment from the
 * script, so this slice IS the engine's environment.
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

/** Every unit whose `systemd-run` argv carries a `TINYAPP_RENDER_URL=` entry. */
const unitsCarryingRenderUrl = (ctx) =>
  argvLines(ctx, 'systemd-run')
    .filter((a) => renderEntries(a).length > 0)
    .map((a) => a.find((s) => s.startsWith('--unit='))?.slice(7))

// ── the state exams the engine records  [M3] ─────────────────────────────────

/** The last line of the shared engine stub — where the extension is spliced. */
const ENGINE_EXIT = 'exit ${STUB_ENGINE_CODE:-0}'

/** The screenshot's bytes: a PNG signature and a tail that is NOT valid UTF-8
 *  (`ff fe` and a lone `c3` lead byte), so a copy that decoded and re-encoded
 *  the file — or read it as text — cannot come out byte-equal. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0xff, 0xfe, 0x01, 0x02, 0x03, 0xc3, 0x28,
])
/** Those same bytes as a `printf` format of three-digit octal escapes, so the
 *  stub cannot write anything but exactly `PNG_BYTES`. */
const PNG_FORMAT = [...PNG_BYTES].map((b) => '\\' + b.toString(8).padStart(3, '0')).join('')

/** The four JSON records one exam pass leaves, each distinct and non-trivial:
 *  a copy that wrote one file twice, truncated, or re-serialized is not "byte
 *  for byte". */
const WALLS_BYTES =
  '{\n  "task": "1",\n  "stem": "buy-milk",\n  "pass": 0,\n' +
  '  "walls": [{"id": "w-1", "kind": "contract", "held": true}]\n}\n'
const MUTANT_BYTES =
  '{\n  "mutants": [{"id": "m-1", "killed": true}, {"id": "m-2", "killed": false}]\n}\n'
const CONTRACT_BYTES =
  '{\n  "produces": ["addTodo", "TodoStore"],\n  "consumes": []\n}\n'
const STORE_DIFF_BYTES =
  '{\n  "before": {"todos": {}},\n  "after": {"todos": {"t1": {"text": "buy milk"}}}\n}\n'
/** The base pass's record, in a SECOND directory at the same depth — the tree is
 *  `task-<id>/<stem>-<pass>/<file>`, so a copy that globbed one level down
 *  misses it. */
const BASE_WALLS_BYTES =
  '{\n  "task": "1",\n  "stem": "buy-milk",\n  "pass": "base",\n  "walls": []\n}\n'

/** The five files of the `buy-milk-0` pass, in the order `readdirSync` sorts
 *  them, with the bytes the rig writes for each. */
const PASS_FILES = [
  ['contract.json', Buffer.from(CONTRACT_BYTES)],
  ['mutant.json', Buffer.from(MUTANT_BYTES)],
  ['screenshot.png', PNG_BYTES],
  ['store-diff.json', Buffer.from(STORE_DIFF_BYTES)],
  ['walls.json', Buffer.from(WALLS_BYTES)],
]
const PASS_NAMES = PASS_FILES.map(([name]) => name)

/**
 * The engine's state-exam writes, under `$run_dir/state-exams/`, at the layout
 * the spec names (`task-<id>/<stem>-<pass>/<file>`) and nowhere else. Same
 * splice point and same shape as the approval sim's `TRANSCRIPTS_SNIPPET`.
 */
const STATE_EXAMS_SNIPPET = `
if [ -n "\${STUB_STATE_EXAMS:-}" ]; then
  pass_dir="$run_dir/state-exams/task-1/buy-milk-0"
  base_dir="$run_dir/state-exams/task-1/buy-milk-base"
  mkdir -p "$pass_dir" "$base_dir"
  printf '%s' "$STUB_EXAM_WALLS" >"$pass_dir/walls.json"
  printf '%s' "$STUB_EXAM_MUTANT" >"$pass_dir/mutant.json"
  printf '%s' "$STUB_EXAM_CONTRACT" >"$pass_dir/contract.json"
  printf '%s' "$STUB_EXAM_STORE_DIFF" >"$pass_dir/store-diff.json"
  printf '${PNG_FORMAT}' >"$pass_dir/screenshot.png"
  printf '%s' "$STUB_EXAM_BASE_WALLS" >"$base_dir/walls.json"
fi
`

/** The environment that turns the splice on. */
const STATE_EXAMS_ENV = {
  STUB_STATE_EXAMS: '1',
  STUB_EXAM_WALLS: WALLS_BYTES,
  STUB_EXAM_MUTANT: MUTANT_BYTES,
  STUB_EXAM_CONTRACT: CONTRACT_BYTES,
  STUB_EXAM_STORE_DIFF: STORE_DIFF_BYTES,
  STUB_EXAM_BASE_WALLS: BASE_WALLS_BYTES,
}

// ── paths ────────────────────────────────────────────────────────────────────

/** The engine's run directory — where the exams are written. */
const runDir = (ctx) => path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7')
/** The run's record on the evidence worktree — what the branch will carry. */
const evidenceRunDir = (ctx) => path.join(evidenceDir(ctx), RUN_PATH)
const runExams = (ctx) => path.join(runDir(ctx), 'state-exams')
const evidenceExams = (ctx) => path.join(evidenceRunDir(ctx), 'state-exams')

const read = (file) => fs.readFileSync(file)

/** Every entry name under `dir`, at any depth, as `<relative path>` strings. */
function walk(dir, prefix = '') {
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name
    out.push(rel)
    if (fs.statSync(path.join(dir, name)).isDirectory()) out.push(...walk(path.join(dir, name), rel))
  }
  return out
}

// ── the rig: an engine that leaves its state exams behind ────────────────────

function examHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this sim's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(ENGINE_EXIT, () => STATE_EXAMS_SNIPPET + ENGINE_EXIT))
  fs.chmodSync(file, 0o755)
  return ctx
}

/**
 * THE PLANTED BOOT: a `render.env` at a path named through `FLEET_RENDER_ENV`,
 * and an engine that records six state-exam files. Legs (b), (c), (d) and (f)
 * read this one run.
 */
const plantedBoot = (() => {
  const ctx = examHome()
  const renderEnv = renderEnvPath(ctx)
  fs.writeFileSync(renderEnv, RENDER_LINE + '\n')
  const done = bootAsync(ctx, ['boot'], { FLEET_RENDER_ENV: renderEnv, ...STATE_EXAMS_ENV })
    .then((r) => {
      assert.equal(r.status, 0,
        `the planted boot must run to completion:\n${r.stdout}${r.stderr}`)
      return ctx
    })
  // Marked handled at creation — the legs below attach their own handlers, and
  // a boot that failed while a sibling sim was still running must reach the leg
  // that reads it rather than killing the process as an unhandled rejection.
  done.catch(() => {})
  return () => done
})()

/**
 * THE BARE BOOT: no `FLEET_RENDER_ENV`, no planted file, and an engine that
 * records no exams. Legs (a) and (e) read this one run.
 */
const bareBoot = (() => {
  const ctx = examHome()
  const done = bootAsync(ctx, ['boot'], {}).then((r) => {
    assert.equal(r.status, 0, `the bare boot must run to completion:\n${r.stdout}${r.stderr}`)
    return { ctx, result: r }
  })
  done.catch(() => {})
  return () => done
})()

/** Leg (g)'s two sibling sims, started with the boots so the exam pays for them
 *  once in wall clock rather than one after the other. */
const sim = (file) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join('fleet', 'tests', file)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (c) => { stdout += c })
  child.stderr.on('data', (c) => { stderr += c })
  child.on('error', reject)
  child.on('close', (status) => resolve({ status, stdout, stderr }))
})
const greenSim = sim('test_sandbox_boot.mjs')
const approvalSim = sim('test_sandbox_boot_approval_evidence.mjs')

// ── (a) no render file: one empty entry, and the boot still exits 0  [M1] ────

test('a boot with no render.env exits 0 and hands the engine an empty TINYAPP_RENDER_URL=  [M1 / leg (a)]', async () => {
  const { ctx, result } = await bareBoot()
  // Leg (a)'s own condition: the file the rig points every boot at was never
  // planted, so this boot really does source nothing. The rig pins the path
  // inside the case's home, which is why no file the box itself carries can
  // make the empty-value assertion below meaningless.
  assert.ok(!fs.existsSync(renderEnvPath(ctx)),
    `(a) [M1] this leg needs ${renderEnvPath(ctx)} absent — it is the path the rig hands ` +
      'the script when a case names no FLEET_RENDER_ENV of its own')

  // `set -euo pipefail`: a bare `$TINYAPP_RENDER_URL` under `set -u`, or an
  // unguarded source of a missing file, kills the boot here.
  assert.equal(result.status, 0,
    `(a) [M1] a boot with no render file exits 0:\n${result.stdout}${result.stderr}`)

  const argv = engineArgv(ctx, '(a) [M1]')
  const entries = renderEntries(argv)
  assert.equal(entries.length, 1,
    `(a) [M1] exactly one entry beginning \`${EMPTY_ENTRY}\` in the engine's argv, got ` +
      `${JSON.stringify(entries)} in: ${argv.join(' ')}`)
  assert.equal(entries[0], EMPTY_ENTRY,
    `(a) [M1] with no file to source the value is the empty string — the entry is exactly ` +
      `\`${EMPTY_ENTRY}\`, got ${JSON.stringify(entries[0])}`)

  // And it rides in the `env` prefix, where the child's environment is: a word
  // parked after `node` would be an argument to the engine, not a variable.
  assert.deepEqual(renderEntries(envPrefix(argv, '(a) [M1]')), [EMPTY_ENTRY],
    '(a) [M1] the entry is one of the `env` prefix\'s entries, between `env` and `node`')
})

// ── (b) the sourced address reaches the engine unit  [M1] ────────────────────

test('a boot whose FLEET_RENDER_ENV names a render.env hands the engine that line  [M1 / leg (b)]', async () => {
  const ctx = await plantedBoot()

  // The rig planted the line it meant to, at the path FLEET_RENDER_ENV names.
  const planted = renderEnvPath(ctx)
  assert.equal(fs.readFileSync(planted, 'utf8'), RENDER_LINE + '\n',
    '(b) [M1] the rig planted the one line the setup script writes')

  const argv = engineArgv(ctx, '(b) [M1]')
  const entries = renderEntries(argv)
  assert.equal(entries.length, 1,
    `(b) [M1] exactly one entry beginning \`${EMPTY_ENTRY}\` in the engine's argv, got ` +
      `${JSON.stringify(entries)} in: ${argv.join(' ')}`)
  assert.equal(entries[0], RENDER_LINE,
    `(b) [M1] the entry carries the SOURCED value: it must equal \`${RENDER_LINE}\`, got ` +
      JSON.stringify(entries[0]))

  assert.deepEqual(renderEntries(envPrefix(argv, '(b) [M1]')), [RENDER_LINE],
    '(b) [M1] and it rides among the `env` prefix\'s entries, between `env` and `node`')
})

// ── (c) the publish fold's unit carries no such entry  [M2] ──────────────────

test('the fold unit of the same planted boot carries no TINYAPP_RENDER_URL= entry  [M2 / leg (c)]', async () => {
  const ctx = await plantedBoot()
  const fold = foldArgv(ctx, 1)
  assert.ok(fold,
    `(c) [M2] the planted boot must start --unit=fleet-fold-7-1; the units run were ` +
      JSON.stringify(unitsRun(ctx)))

  assert.deepEqual(renderEntries(fold), [],
    '(c) [M2] the publish fold\'s argv carries no entry beginning `' + EMPTY_ENTRY + '`, got: ' +
      fold.join(' '))

  // Said the other way the leg says it: of every unit this boot started, only
  // the engine's argv carries one.
  assert.deepEqual(unitsCarryingRenderUrl(ctx), ['fleet-engine-7'],
    '(c) [M2] the fold unit is absent from the set of argvs carrying a `' + EMPTY_ENTRY +
      '` entry — the units run were ' + JSON.stringify(unitsRun(ctx)))
})

// ── (d) every recorded file rides to the evidence worktree, nested once  [M3] ─

test('every state-exam file reaches the evidence worktree byte for byte  [M3 / leg (d)]', async () => {
  const ctx = await plantedBoot()
  const source = path.join(runExams(ctx), 'task-1', 'buy-milk-0')
  const collected = path.join(evidenceExams(ctx), 'task-1', 'buy-milk-0')

  // The rig left the six files where the engine leaves them, with the bytes it
  // meant to — otherwise a green leg would be two absences agreeing.
  assert.deepEqual(fs.readdirSync(source).sort(), PASS_NAMES,
    `(d) [M3] the engine stub must write ${PASS_NAMES.join(', ')} under ${source}`)
  for (const [name, bytes] of PASS_FILES) {
    assert.deepEqual(read(path.join(source, name)), bytes,
      `(d) [M3] the rig wrote the bytes it meant to for ${name}`)
  }
  assert.notDeepEqual(Buffer.from(PNG_BYTES.toString('utf8'), 'utf8'), PNG_BYTES,
    '(d) [M3] the screenshot is not valid UTF-8 — a copy that round-tripped it as text ' +
      'would not come out byte-equal, which is what makes the comparison below a binary one')

  // M3: every regular file is on the record, at the SAME relative path, byte
  // for byte.
  assert.ok(fs.existsSync(collected),
    `(d) [M3] collect_evidence must copy the run's state exams into ${RUN_PATH}/state-exams, ` +
      'got: ' + fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  assert.deepEqual(fs.readdirSync(collected).sort(), PASS_NAMES,
    `(d) [M3] ${RUN_PATH}/state-exams/task-1/buy-milk-0 must hold exactly ` +
      `${PASS_NAMES.join(', ')}, got: ` + fs.readdirSync(collected).join(' '))
  for (const [name, bytes] of PASS_FILES) {
    const dest = path.join(collected, name)
    assert.ok(fs.existsSync(dest),
      `(d) [M3] ${RUN_PATH}/state-exams/task-1/buy-milk-0/${name} must be collected, got: ` +
        fs.readdirSync(collected).join(' '))
    assert.deepEqual(read(dest), read(path.join(source, name)),
      `(d) [M3] the collected ${name} must be byte-equal to the run directory's`)
    assert.deepEqual(read(dest), bytes,
      `(d) [M3] and equal to the bytes the engine recorded for ${name}`)
  }

  // The SECOND pass directory, at the same depth: a copy that walked only one
  // level, or globbed a single directory, leaves it behind.
  const baseWalls = path.join(evidenceExams(ctx), 'task-1', 'buy-milk-base', 'walls.json')
  assert.ok(fs.existsSync(baseWalls),
    `(d) [M3] ${RUN_PATH}/state-exams/task-1/buy-milk-base/walls.json must be collected too — ` +
      'the tree is `task-<id>/<stem>-<pass>/<file>` and every regular file under it is copied')
  assert.deepEqual(read(baseWalls),
    read(path.join(runExams(ctx), 'task-1', 'buy-milk-base', 'walls.json')),
    '(d) [M3] byte-equal to the run directory\'s')
  assert.deepEqual(read(baseWalls), Buffer.from(BASE_WALLS_BYTES))

  // The record is the real one — the receipts are in it beside the exams.
  assert.ok(fs.existsSync(path.join(evidenceRunDir(ctx), 'gate-receipt.json')),
    `(d) [M3] ${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads ` +
      'the wrong directory')
})

test('the copied state-exams tree is nested exactly once  [M3 / leg (d)]', async () => {
  const ctx = await plantedBoot()
  const dir = evidenceExams(ctx)
  assert.ok(fs.existsSync(dir),
    `(d) [M3] collect_evidence must leave a ${RUN_PATH}/state-exams directory on the record, ` +
      'got: ' + fs.readdirSync(evidenceRunDir(ctx)).join(' '))

  // `collect_evidence` runs at EVERY `write_status` transition. A `cp -R` of
  // the directory itself puts a second `state-exams/` inside the first copy on
  // the second pass; walking the regular files leaves exactly one tree, however
  // many times the function ran.
  assert.deepEqual(fs.readdirSync(dir).sort(), ['task-1'],
    `(d) [M3] ${RUN_PATH}/state-exams must hold exactly ['task-1'] — a nested \`state-exams\` ` +
      'entry is a later transition copying the directory itself, got: ' +
      fs.readdirSync(dir).join(' '))
  assert.deepEqual(fs.readdirSync(path.join(dir, 'task-1')).sort(), ['buy-milk-0', 'buy-milk-base'],
    `(d) [M3] ${RUN_PATH}/state-exams/task-1 holds the two passes and nothing else, got: ` +
      fs.readdirSync(path.join(dir, 'task-1')).join(' '))

  const nested = walk(dir).filter((rel) => rel.split('/').includes('state-exams'))
  assert.deepEqual(nested, [],
    '(d) [M3] no `state-exams` entry at any depth below the copied one, got: ' +
      nested.join(' '))
})

// ── (e) a run that recorded none commits none  [M3] ──────────────────────────

test('a boot whose engine recorded no state exams commits none  [M3 / leg (e)]', async () => {
  const { ctx } = await bareBoot()
  assert.ok(!fs.existsSync(runExams(ctx)),
    '(e) [M3] this run\'s engine wrote no state-exams directory')

  // The evidence directory is the real one — the run's record is in it.
  const dir = evidenceRunDir(ctx)
  assert.ok(fs.existsSync(path.join(dir, 'gate-receipt.json')),
    `(e) [M3] ${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads ` +
      'the wrong directory')
  assert.ok(fs.existsSync(path.join(dir, 'status.json')),
    `(e) [M3] ${RUN_PATH}/status.json must be collected`)

  assert.ok(!fs.existsSync(evidenceExams(ctx)),
    `(e) [M3] no ${RUN_PATH}/state-exams path at all on the branch of a run that recorded ` +
      'none, got: ' + fs.readdirSync(dir).join(' '))
  assert.ok(!fs.readdirSync(dir).includes('state-exams'),
    '(e) [M3] and no such entry in the record\'s listing, got: ' + fs.readdirSync(dir).join(' '))
})

// ── (f) the once-nested reading was made after repeated copies  [M3] ─────────

test('the planted boot committed the record at least three times  [M3 / leg (f)]', async () => {
  const ctx = await plantedBoot()
  const states = commitStates(ctx)
  assert.ok(states.length >= 3,
    '(f) [M3] the planted boot commits the evidence record at least three times — leg (d)\'s ' +
      'once-nested reading is only a claim about repeated copies if the copy ran repeatedly; ' +
      'the states committed were ' + JSON.stringify(states))
  for (const state of ['running', 'publishing', 'done']) {
    assert.ok(states.includes(state),
      `(f) [M3] the committed states include \`${state}\`, got ${JSON.stringify(states)}`)
  }
})

// ── (g) the siblings still pass, and the script parses  [M1, M3] ─────────────

test('the boot script parses  [M1, M3 / leg (g)]', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, `(g) bash -n ${SCRIPT}:\n${r.stdout}${r.stderr}`)
})

test('the green-path boot sim still prints the sentinel  [M1, M3 / leg (g)]', async () => {
  const r = await greenSim
  assert.ok(r.stdout.includes('ALL TESTS PASSED'),
    '(g) [M1, M3] `node fleet/tests/test_sandbox_boot.mjs` must still print ALL TESTS PASSED:\n' +
      r.stdout.split('\n').filter((l) => !l.startsWith('ok ')).join('\n') + r.stderr)
  assert.equal(r.status, 0, '(g) [M1, M3] and exit 0')
})

test('the approval-evidence sim still prints the sentinel  [M1, M3 / leg (g)]', async () => {
  // The transcripts copy and the once-nested rule for `transcripts/` live in
  // this sim; `state-exams/` is added AFTER that block, and must not disturb it.
  const r = await approvalSim
  assert.ok(r.stdout.includes('ALL TESTS PASSED'),
    '(g) [M1, M3] `node fleet/tests/test_sandbox_boot_approval_evidence.mjs` must still ' +
      'print ALL TESTS PASSED:\n' +
      r.stdout.split('\n').filter((l) => !l.startsWith('ok ')).join('\n') + r.stderr)
  assert.equal(r.status, 0, '(g) [M1, M3] and exit 0')
})

runTests(tests)
