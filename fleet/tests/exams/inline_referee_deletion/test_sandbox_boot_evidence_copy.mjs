/**
 * Exam for Task 3 of the referee-deletion plan (#911): the evidence the
 * sandbox commits for a run carries `transcripts/` and `state-exams/` as
 * before and never a `referee/` directory — even when the run directory holds
 * one.
 *
 *   M2 / leg (b)  a boot whose engine stub leaves `<run_dir>/transcripts/s1.jsonl`,
 *                 `<run_dir>/state-exams/task-1/buy-milk-0/walls.json` and
 *                 `<run_dir>/referee/task-1-0.json` behind exits 0; under the
 *                 evidence worktree's `.ultrapowers/runs/7/` the transcript and
 *                 the walls file are present and byte-equal to the run
 *                 directory's; the planted `referee/task-1-0.json` DOES exist in
 *                 the run directory (so a green leg is not two absences
 *                 agreeing); and a walk of the record yields no entry whose
 *                 path contains `referee`.
 *
 * The rig is `_sandbox_boot_helpers.mjs`, in the shape of
 * `test_sandbox_boot_state_exams.mjs`: the engine is the `systemd-run` stub,
 * and a snippet spliced in front of its `ENGINE_EXIT` line plants the three
 * files under `$run_dir` when `STUB_PLANT_REFEREE` is set. This exam lands
 * under `fleet/tests/exams/<slug>/`, so the helpers are two levels up.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  RUN_PATH, STUBS, PRELUDE, makeHome, bootAsync, evidenceDir, runDir, runTests,
} from '../../_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The last line of the shared engine stub — where the extension is spliced. */
const ENGINE_EXIT = 'exit ${STUB_ENGINE_CODE:-0}'

const TRANSCRIPT_BYTES = '{"type":"user","text":"sim transcript line"}\n'
const WALLS_BYTES =
  '{\n  "task": "1",\n  "stem": "buy-milk",\n  "pass": 0,\n' +
  '  "walls": [{"id": "w-1", "kind": "contract", "held": true}]\n}\n'
const REFEREE_BYTES = '{}'

const PLANT_SNIPPET = `
if [ -n "\${STUB_PLANT_REFEREE:-}" ]; then
  mkdir -p "$run_dir/transcripts" "$run_dir/state-exams/task-1/buy-milk-0" "$run_dir/referee"
  printf '%s' "$STUB_PLANT_TRANSCRIPT" >"$run_dir/transcripts/s1.jsonl"
  printf '%s' "$STUB_PLANT_WALLS" >"$run_dir/state-exams/task-1/buy-milk-0/walls.json"
  printf '%s' "$STUB_PLANT_REFEREE_JSON" >"$run_dir/referee/task-1-0.json"
fi
`
const PLANT_ENV = {
  STUB_PLANT_REFEREE: '1',
  STUB_PLANT_TRANSCRIPT: TRANSCRIPT_BYTES,
  STUB_PLANT_WALLS: WALLS_BYTES,
  STUB_PLANT_REFEREE_JSON: REFEREE_BYTES,
}

const evidenceRunDir = (ctx) => path.join(evidenceDir(ctx), RUN_PATH)
const read = (file) => fs.readFileSync(file)

/** Every entry under `dir`, at any depth, as relative paths. */
function walk(dir, prefix = '') {
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name
    out.push(rel)
    if (fs.statSync(path.join(dir, name)).isDirectory()) out.push(...walk(path.join(dir, name), rel))
  }
  return out
}

function plantedHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this exam's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(ENGINE_EXIT, () => PLANT_SNIPPET + ENGINE_EXIT))
  fs.chmodSync(file, 0o755)
  return ctx
}

const plantedBoot = (() => {
  const ctx = plantedHome()
  const done = bootAsync(ctx, ['boot'], PLANT_ENV).then((r) => {
    assert.equal(r.status, 0, `the planted boot must run to completion:\n${r.stdout}${r.stderr}`)
    return ctx
  })
  done.catch(() => {})
  return () => done
})()

// ── (b) the record carries the transcript and the walls, never referee/ [M2] ─

test('the planted files are where the engine left them  [M2 / leg (b)]', async () => {
  const ctx = await plantedBoot()
  const rd = runDir(ctx)
  assert.deepEqual(read(path.join(rd, 'transcripts', 's1.jsonl')), Buffer.from(TRANSCRIPT_BYTES),
    '(b) [M2] the rig wrote the transcript it meant to')
  assert.deepEqual(read(path.join(rd, 'state-exams', 'task-1', 'buy-milk-0', 'walls.json')),
    Buffer.from(WALLS_BYTES), '(b) [M2] the rig wrote the walls file it meant to')
  assert.ok(fs.existsSync(path.join(rd, 'referee', 'task-1-0.json')),
    '(b) [M2] the planted referee/task-1-0.json exists in the run directory — a green leg is ' +
      'not two absences agreeing')
})

test('transcripts/ and state-exams/ reach the record byte for byte  [M2 / leg (b)]', async () => {
  const ctx = await plantedBoot()
  const rd = runDir(ctx)
  const rec = evidenceRunDir(ctx)
  assert.ok(fs.existsSync(path.join(rec, 'gate-receipt.json')),
    `(b) [M2] ${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the ` +
      'wrong directory')
  const transcript = path.join(rec, 'transcripts', 's1.jsonl')
  assert.ok(fs.existsSync(transcript), `(b) [M2] ${RUN_PATH}/transcripts/s1.jsonl is collected, got: ` +
    walk(rec).join(' '))
  assert.deepEqual(read(transcript), read(path.join(rd, 'transcripts', 's1.jsonl')),
    '(b) [M2] the collected transcript is byte-equal to the run directory\'s')
  const walls = path.join(rec, 'state-exams', 'task-1', 'buy-milk-0', 'walls.json')
  assert.ok(fs.existsSync(walls),
    `(b) [M2] ${RUN_PATH}/state-exams/task-1/buy-milk-0/walls.json is collected, got: ` +
      walk(rec).join(' '))
  assert.deepEqual(read(walls), read(path.join(rd, 'state-exams', 'task-1', 'buy-milk-0', 'walls.json')),
    '(b) [M2] the collected walls file is byte-equal to the run directory\'s')
})

test('no entry named referee at any depth of the record  [M2 / leg (b)]', async () => {
  const ctx = await plantedBoot()
  const rec = evidenceRunDir(ctx)
  const stray = walk(rec).filter((rel) => rel.includes('referee'))
  assert.deepEqual(stray, [],
    `(b) [M2] the record under ${RUN_PATH} carries no referee entry — a surviving copy block ` +
      'would put one there, got: ' + stray.join(' '))
})

runTests(tests)
