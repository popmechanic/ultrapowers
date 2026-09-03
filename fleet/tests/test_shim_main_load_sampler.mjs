// fleet/tests/test_shim_main_load_sampler.mjs — the sandbox samples its own
// load into the run dir, so the driver can read WHY a run crawled (#549).
//
// The engine's own timings say a wave was slow; they never say the box was
// oversubscribed. One line per minute of /proc/loadavg, `free -m` and the
// pytest/claude process counts, written into `<runDir>/load.jsonl`, rides the
// existing sandbox-logs pull off the VM before teardown — so the evidence
// survives the sandbox that produced it (#484).
//
// Every reader is injected here: no /proc read, no `free`, no `ps`, and the
// "minute" is 5 ms. The one leg that touches the host (h) asserts SHAPE only —
// all eight keys present, values may be null off Linux.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startLoadSampler, invokeEngineRun } from '../shim-main.mjs'
import { sandboxLogPullCommand } from '../drive.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-load-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lines = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0) : []

// The live shapes, verbatim: `/proc/loadavg`, the `Mem:` row of `free -m`
// (total used free shared buff/cache available), and `ps -eo args=`.
const LOADAVG = '1.50 0.75 0.25 3/400 12345\n'
const FREE = [
  '               total        used        free      shared  buff/cache   available',
  'Mem:           15000        3000        9000         100        3000       11500',
  'Swap:              0           0           0',
].join('\n')
const PROCS = ['python3 -m pytest -q tests', '/usr/bin/claude -p x', 'claude', 'node fleet/run-main.mjs']
const TS = '2026-09-02T00:00:00.000Z'
const readers = (over = {}) => ({
  readLoadavg: () => LOADAVG,
  readFree: () => FREE,
  listProcs: () => PROCS,
  now: () => TS,
  ...over,
})
const boom = () => { throw new Error('no such reader on this host') }

// --- (a) one line per interval, parsed off the injected readers -------------
{
  const t = tmp()
  const file = path.join(t, 'load.jsonl')
  const sampler = startLoadSampler({ file, intervalMs: 5, ...readers() })
  await sleep(30)
  sampler.stop()
  const got = lines(file)
  assert.ok(got.length >= 3, `expected at least three lines after ~30 ms at 5 ms, got ${got.length}`)
  assert.deepEqual(JSON.parse(got[0]), {
    ts: TS,
    load1: 1.5,
    load5: 0.75,
    load15: 0.25,
    memUsedMb: 3000,
    memAvailMb: 11500,
    pytest: 1,
    claude: 2,
  })
  ok('(a) a line per interval; the first parsed line is exactly the eight fields')
}

// --- (b) a reader that throws nulls ITS fields and the sampler continues ----
{
  const cases = [
    ['readFree', { memUsedMb: null, memAvailMb: null }, { load1: 1.5, pytest: 1, claude: 2 }],
    ['readLoadavg', { load1: null, load5: null, load15: null }, { memUsedMb: 3000, memAvailMb: 11500, pytest: 1 }],
    ['listProcs', { pytest: null, claude: null }, { load1: 1.5, memUsedMb: 3000, memAvailMb: 11500 }],
  ]
  for (const [broken, nulled, filled] of cases) {
    const t = tmp()
    const file = path.join(t, 'load.jsonl')
    const sampler = startLoadSampler({ file, intervalMs: 5, ...readers({ [broken]: boom }) })
    await sleep(30)
    sampler.stop()
    const got = lines(file)
    assert.ok(got.length >= 2, `${broken} threw and the sampler stopped: ${got.length} line(s)`)
    const first = JSON.parse(got[0])
    for (const [key, value] of Object.entries(nulled)) assert.equal(first[key], value, `${broken} → ${key}`)
    for (const [key, value] of Object.entries(filled)) assert.equal(first[key], value, `${broken} → ${key}`)
    assert.equal(first.ts, TS)
  }
  ok('(b) a throwing reader nulls only its own fields; the sampler keeps sampling')
}

// --- (g) the run dir does not exist yet — the sampler makes it -------------
{
  const t = tmp()
  const file = path.join(t, '.claude', 'ultrapowers', 'run-g', 'load.jsonl')
  const sampler = startLoadSampler({ file, intervalMs: 60000, ...readers() })
  sampler.stop()
  const got = lines(file)
  assert.equal(got.length, 1, 'the first line is written immediately, before any interval')
  assert.equal(JSON.parse(got[0]).memAvailMb, 11500)
  ok("(g) startLoadSampler creates the file's directory and writes the first line at once")
}

// --- (c) after stop() nothing more is appended ------------------------------
{
  const t = tmp()
  const file = path.join(t, 'load.jsonl')
  const sampler = startLoadSampler({ file, intervalMs: 5, ...readers() })
  await sleep(20)
  sampler.stop()
  const before = lines(file).length
  await sleep(30)
  assert.equal(lines(file).length, before, 'a stopped sampler appended another line')
  ok('(c) stop() is final: no line after it')
}

// --- (d) invokeEngineRun brackets the spawn with the sampler ---------------
{
  const t = tmp()
  const seq = []
  const calls = []
  const startSampler = (opts) => {
    calls.push(opts)
    seq.push('startSampler')
    return { stop: () => seq.push('stop') }
  }
  const outcome = await invokeEngineRun({
    engineDir: '/engine',
    repoDir: t,
    planPath: 'docs/plan.md',
    runId: 'run-24',
    exec: async () => ({ code: 0, stdout: '' }),
    spawnEngine: async () => { seq.push('spawnEngine'); return 1 },
    log: () => {},
    startSampler,
  })
  assert.deepEqual(seq, ['startSampler', 'spawnEngine', 'stop'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, path.join(t, '.claude', 'ultrapowers', 'run-run-24', 'load.jsonl'))
  assert.equal(calls[0].intervalMs, 60000)
  assert.equal(outcome.gateGreen, false)

  // a rejecting spawn still stops the sampler, exactly once
  const seq2 = []
  const startSampler2 = () => {
    seq2.push('startSampler')
    return { stop: () => seq2.push('stop') }
  }
  await assert.rejects(
    invokeEngineRun({
      engineDir: '/engine',
      repoDir: t,
      planPath: 'docs/plan.md',
      runId: 'run-24',
      exec: async () => ({ code: 0, stdout: '' }),
      spawnEngine: async () => { seq2.push('spawnEngine'); throw new Error('spawn died') },
      log: () => {},
      startSampler: startSampler2,
    }),
    /spawn died/,
  )
  assert.deepEqual(seq2, ['startSampler', 'spawnEngine', 'stop'])
  ok('(d) start before the spawn, stop after it resolves OR rejects, on <runDir>/load.jsonl at 60000 ms')
}

// --- (h) the default seam, on this host: shape only ------------------------
{
  const t = tmp()
  await invokeEngineRun({
    engineDir: '/engine',
    repoDir: t,
    planPath: 'docs/plan.md',
    runId: 'run-h',
    exec: async () => ({ code: 0, stdout: '' }),
    spawnEngine: async () => 0,
    log: () => {},
  })
  const got = lines(path.join(t, '.claude', 'ultrapowers', 'run-run-h', 'load.jsonl'))
  assert.ok(got.length >= 1, 'the default sampler wrote no line')
  const first = JSON.parse(got[0])
  assert.deepEqual(
    Object.keys(first).sort(),
    ['claude', 'load1', 'load15', 'load5', 'memAvailMb', 'memUsedMb', 'pytest', 'ts'],
  )
  ok('(h) with no startSampler injected, the real sampler writes all eight keys into the run dir')
}

// --- (e) the sandbox-logs pull carries the run dir: load.jsonl rides the bundle
// #575: the run dir lives in the sandbox's TARGET clone and is renamed to the
// `repo/` prefix every reader expects on the way into the archive.
{
  assert.equal(
    sandboxLogPullCommand({ vmName: 'fleet-run-9', dest: '/d/x.tgz' }),
    'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null fleet-run-9.exe.xyz ' +
      "sh > /d/x.tgz <<'FLEET_PULL_EOF'\n" +
      `cd /home/exedev && tar czf - --transform 's,^target/,repo/,' --exclude="target/.claude/ultrapowers/run-*/clones" shim.log fleet-run.json .claude/projects ` +
      `$(cd target && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | sed "s|^|target/|") 2>/dev/null\n` +
      'FLEET_PULL_EOF',
  )
  ok('(e) sandboxLogPullCommand tars the target clone\'s run dirs under the repo/ prefix — load.jsonl rides with them')
}

// --- (f) the sibling shim sims still pass ----------------------------------
{
  for (const sim of ['test_shim_main_gate.mjs', 'test_shim_main_plan_assignment.mjs']) {
    const out = execFileSync('node', [path.join('fleet', 'tests', sim)], { cwd: repoRoot, encoding: 'utf8' })
    assert.match(out, /ALL TESTS PASSED/, `${sim} did not pass`)
  }
  ok('(f) test_shim_main_gate.mjs and test_shim_main_plan_assignment.mjs still print ALL TESTS PASSED')
}

console.log(`\nALL TESTS PASSED (${passed})`)
