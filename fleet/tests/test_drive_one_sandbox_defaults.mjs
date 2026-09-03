// fleet/tests/test_drive_one_sandbox_defaults.mjs — #546: a run sandbox is
// sized to the pool without being told.
//
// `fleet/drive-one.mjs` spread `--sandbox-cpu` / `--sandbox-memory` into the
// driveOne options only when the operator typed them, so a bare launch
// inherited the golden image's build size of 8 vCPU / 15 GB. Run-51 measured
// that ceiling (eleven-wide wave, load 2.89 on 8 vCPU, 3 GB used of 15);
// run-52, with the flags typed by hand, peaked at load 4.28 on 16 vCPU with
// 3.6 GB used of 48. Memory is the thinner margin — ~3 GB per busy
// implementer. This exam pins the defaults, and pins that nothing else about
// the option shape moved with them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildDriveOptions, parseArgs, usage } from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// Derived from THIS file's location, not from drive-one.mjs — so the repo-path
// value in the frozen literal below is checked against an independent
// derivation rather than against the module under test.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNBOOK = path.join(REPO_ROOT, 'fleet', 'RUNBOOK.md')
const DRIVE_ONE_TEST = path.join(REPO_ROOT, 'fleet', 'tests', 'test_drive_one.mjs')

// A launch names the repository and the commit; both are required.
const TARGET = 'o/r'
const SHA = '3f'.repeat(20)
const NAMED = ['--target', TARGET, '--base', SHA]

const options = (argv) => buildDriveOptions(parseArgs(argv), { readToken: () => 't' })

// --- (a) M1: a bare parse carries the pool defaults ------------------------

{
  const o = options(['p.md', 'run-x', ...NAMED])
  // The number 16, not the string '16': NUMERIC coerces the flag, so the
  // default has to arrive already coerced.
  assert.equal(o.sandboxCpu, 16)
  assert.equal(typeof o.sandboxCpu, 'number')
  assert.equal(o.sandboxMemory, '48GB')
  assert.equal(typeof o.sandboxMemory, 'string')
  ok('a bare parse defaults to 16 vCPU / 48GB, cpu as a number')
}

// --- (b) M2: the flags still override, in both directions ------------------

{
  const o = options(['p.md', 'run-x', ...NAMED, '--sandbox-cpu', '8', '--sandbox-memory', '16GB'])
  assert.equal(o.sandboxCpu, 8)
  assert.equal(typeof o.sandboxCpu, 'number')
  assert.equal(o.sandboxMemory, '16GB')
  ok('--sandbox-cpu / --sandbox-memory override the defaults downward, still coerced')
}

// --- (c) M3: the usage line names the two defaults beside their flags ------

{
  const text = usage()
  // Windowed, not a bare `includes`: a `16` anywhere else in the usage line
  // must not satisfy this.
  const near = (flag, want) => {
    const at = text.indexOf(flag)
    assert.notEqual(at, -1, `usage does not mention ${flag}: ${text}`)
    const window = text.slice(at + flag.length, at + flag.length + 24)
    assert.ok(window.includes(want), `usage does not name ${want} beside ${flag}: ${JSON.stringify(window)}`)
  }
  near('--sandbox-cpu', '16')
  near('--sandbox-memory', '48GB')
  ok('the usage line names 16 beside --sandbox-cpu and 48GB beside --sandbox-memory')
}

// --- (d) M4: the RUNBOOK states the default and the pool it is sized to ----

const SENTENCE = 'A run sandbox defaults to 16 vCPU and 48 GB; --sandbox-cpu and --sandbox-memory override it.'

{
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  assert.ok(text.includes(SENTENCE), `fleet/RUNBOOK.md does not state the default verbatim: ${SENTENCE}`)
  const sentences = text.split(/(?<=[.!?])\s+/)
  const pooled = sentences.filter(
    (s) => s.includes('pool') && s.includes('16 vCPU / 64 GB') && s.includes('cap') && s.includes('reservation'),
  )
  assert.equal(
    pooled.length,
    1,
    `expected exactly one sentence naming the pool as a cap, not a reservation; got ${pooled.length}`,
  )
  ok('RUNBOOK states the default verbatim and names the shared 16 vCPU / 64 GB pool as a cap')
}

// --- (e) M5: every other key buildDriveOptions returns is unchanged --------

// Frozen from BASE (ae24d58) — `buildDriveOptions(parseArgs(['p.md','run-x']))`
// with `engineEnv` and `exec` dropped — plus exactly the two entries this task
// adds. Any other key added, absent, or changed in value fails leg (e).
// Task 4 (#575) moved three entries: `pinRepoDir` and `prBase` are gone with
// their flags, and `target`/`baseSha` are what a launch now names.
const FROZEN_BARE_OPTIONS = {
  planPath: 'p.md',
  golden: 'fleet-golden',
  port: 8180,
  dbDir: '/tmp/fleet-orch-live',
  target: TARGET,
  baseSha: SHA,
  repoDir: REPO_ROOT,
  runId: 'run-x',
  ttlMs: 14400000,
  heartbeatTimeoutMs: 1800000,
  claimTimeoutMs: 600000,
  evidenceDir: '/home/exedev/fleet-evidence',
  allowUnfitPlan: false,
  githubTokenPath: '/home/exedev/.fleet/github-token',
  // the two added entries, and only these two
  sandboxCpu: 16,
  sandboxMemory: '48GB',
}

{
  const { engineEnv, exec, ...rest } = options(['p.md', 'run-x', ...NAMED])
  assert.deepEqual(rest, FROZEN_BARE_OPTIONS)
  // deepEqual is loose about key ORDER but not about presence; assert the two
  // dropped keys were actually there, so dropping them cannot hide a rename.
  assert.equal(typeof engineEnv, 'object')
  assert.equal(typeof exec, 'function')
  ok('the bare option shape is BASE plus exactly sandboxCpu/sandboxMemory')
}

// --- (f) M5: test_drive_one.mjs still asserts the two defaults, and is green -

// The #546 version of this leg froze test_drive_one.mjs by line count and by
// the SHA-256 of every line but two. #575 rewrites that file — every argv in
// it now names --target and --base — so the digest is retired rather than
// re-frozen against this run's own edit, which would prove nothing. What the
// leg still owns is the substance: the two default assertions are there, and
// the file is green.
{
  const text = fs.readFileSync(DRIVE_ONE_TEST, 'utf8')
  assert.match(text, /assert\.equal\(o\.sandboxCpu, 16\)/, 'test_drive_one.mjs no longer asserts the cpu default')
  assert.match(
    text,
    /assert\.equal\(o\.sandboxMemory, '48GB'\)/,
    'test_drive_one.mjs no longer asserts the memory default',
  )
  ok('test_drive_one.mjs still asserts 16 vCPU and 48GB on the bare option shape')
}

{
  const out = execFileSync(process.execPath, [DRIVE_ONE_TEST], { encoding: 'utf8' })
  assert.ok(out.includes('ALL TESTS PASSED'), out)
  ok('test_drive_one.mjs still exits 0 printing ALL TESTS PASSED')
}

console.log(`\nALL TESTS PASSED (${passed})`)
