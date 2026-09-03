// fleet/tests/test_race_cli.mjs — #511 Task 4: one command, `fleet/race.mjs`,
// with two verbs (launch, judge).
//
// The two verb modules (`race-launch.mjs`, `race-judge.mjs`) are wave-2
// siblings that DO NOT EXIST while this file is written, so nothing here may
// load them: `main` takes the verbs as injected deps, and the module-name
// wiring is proven with a recording `importer` handed to `resolveVerb`. The
// last leg reads this file's own source back to keep it that way.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, REPO_DIR } from '../drive-one.mjs'
import {
  VERB_MODULES,
  main,
  parseJudgeArgs,
  parseLaunchArgs,
  resolveVerb,
  usage,
} from '../race.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// drive-one requires both, so every launch argv here that is meant to PARSE
// carries them (#575). Where a drive runs from is no longer a flag on either
// side of the split, which is why `--k` is all the race owns now.
const TARGET = 'o/r'
const SHA = '3f'.repeat(20)
const NAMED = ['--target', TARGET, '--base', SHA]

// A verb stub that records every call and returns nothing interesting.
const recorder = () => {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    return undefined
  }
  fn.calls = calls
  return fn
}

// The injected sinks: `main` writes lines, never touches the real streams.
const sink = () => {
  const lines = []
  const write = (line) => lines.push(line)
  write.lines = lines
  return write
}

// --- (a) parseLaunchArgs: race flags split from drive-one's -----------------

{
  const p = parseLaunchArgs(['p.md', 'race-9', '--k', '3', '--port', '8190', ...NAMED])
  assert.equal(p.raceId, 'race-9')
  assert.equal(p.k, 3)
  assert.equal(p.port, 8190)
  assert.equal(p.planPath, 'p.md')
  // The raceId rides in as drive-one's runId positional (#211 grammar).
  assert.equal(p.runId, 'race-9')
  // Everything that is not --k is drive-one's and keeps its defaults — including
  // the checkout every attempt drives out of, which is not a flag at all.
  assert.equal(p.dbDir, DEFAULTS.dbDir)
  assert.equal(p.evidenceDir, DEFAULTS.evidenceDir)
  assert.equal(p.repoDir, REPO_DIR)
  assert.equal(p.target, TARGET)
  assert.equal(p.baseSha, SHA)

  // `--race-dir` went with the per-attempt checkout: there is nothing left for
  // it to name, so it is drive-one's unknown flag like any other.
  assert.throws(
    () => parseLaunchArgs(['p.md', 'race-9', ...NAMED, '--race-dir', '/x']),
    (error) => error.message.includes('unknown flag --race-dir'),
  )
  ok('(a) parseLaunchArgs yields raceId/k beside drive-one\'s options; --race-dir is gone')
}

// --- (b) --k: default 3, integer 1..26, else a refusal naming --k -----------

{
  assert.equal(parseLaunchArgs(['p.md', 'race-9', ...NAMED]).k, 3)
  assert.equal(parseLaunchArgs(['p.md', 'race-9', ...NAMED, '--k', '1']).k, 1)
  assert.equal(parseLaunchArgs(['p.md', 'race-9', ...NAMED, '--k', '26']).k, 26)

  for (const argv of [
    ['p.md', 'race-9', ...NAMED, '--k', '0'],
    ['p.md', 'race-9', ...NAMED, '--k', '27'],
    ['p.md', 'race-9', ...NAMED, '--k', 'x'],
    ['p.md', 'race-9', ...NAMED, '--k'],
  ]) {
    let thrown = null
    try {
      parseLaunchArgs(argv)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown, `${JSON.stringify(argv)} must be refused`)
    assert.ok(thrown.message.includes('--k'), `refusal must name --k: ${thrown.message}`)
    assert.ok(thrown.message.includes(usage()), `refusal must carry the usage line: ${thrown.message}`)
  }
  ok('(b) --k defaults to 3, accepts 1..26, and refuses 0/27/x/missing naming --k + usage')
}

// --- (c) an unknown flag is drive-one's refusal, not ours -------------------

{
  assert.throws(
    () => parseLaunchArgs(['p.md', 'race-9', ...NAMED, '--bogus']),
    (error) => error.message.includes('unknown flag') && error.message.includes('--bogus'),
  )
  ok('(c) an unknown flag falls through to drive-one\'s unknown-flag refusal')
}

// --- (d) parseJudgeArgs -----------------------------------------------------

{
  assert.deepEqual(parseJudgeArgs(['race-9']), {
    raceId: 'race-9',
    evidenceDir: DEFAULTS.evidenceDir,
    force: false,
  })
  assert.deepEqual(parseJudgeArgs(['race-9', '--force', '--evidence-dir', '/e']), {
    raceId: 'race-9',
    evidenceDir: '/e',
    force: true,
  })

  for (const argv of [[], ['race-9', 'race-10']]) {
    let thrown = null
    try {
      parseJudgeArgs(argv)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown, `${JSON.stringify(argv)} must be refused`)
    assert.ok(thrown.message.includes('judge'), `refusal must name judge: ${thrown.message}`)
  }
  ok('(d) parseJudgeArgs defaults force:false + DEFAULTS.evidenceDir, and refuses 0 or 2 positionals')
}

// --- (e) main dispatches to exactly one injected verb ------------------------

{
  const launch = recorder()
  const judge = recorder()
  const err = sink()
  const code = await main(['launch', 'p.md', 'race-9', '--k', '2'], { launch, judge, stderr: err })
  assert.equal(code, 0)
  assert.equal(launch.calls.length, 1)
  assert.deepEqual(launch.calls[0][0], ['p.md', 'race-9', '--k', '2'])
  assert.equal(typeof launch.calls[0][1].stderr, 'function')
  assert.equal(judge.calls.length, 0)
  assert.deepEqual(err.lines, [])
}

{
  const launch = recorder()
  const judge = recorder()
  const code = await main(['judge', 'race-9'], { launch, judge })
  assert.equal(code, 0)
  assert.equal(judge.calls.length, 1)
  assert.deepEqual(judge.calls[0][0], ['race-9'])
  assert.equal(launch.calls.length, 0)
  ok('(e) main hands the verb argv to exactly one injected verb and returns 0')
}

// --- (f) a bad verb, no verb, or a throwing verb: usage/message + 1 ----------

{
  for (const argv of [['fly'], []]) {
    const launch = recorder()
    const judge = recorder()
    const err = sink()
    const out = sink()
    const code = await main(argv, { launch, judge, stderr: err, stdout: out })
    assert.equal(code, 1, `${JSON.stringify(argv)} must exit non-zero`)
    assert.ok(
      err.lines.join('\n').includes(usage()),
      `${JSON.stringify(argv)} must print the usage line to stderr: ${err.lines.join('\n')}`,
    )
    assert.equal(launch.calls.length, 0)
    assert.equal(judge.calls.length, 0)
  }

  const judge = recorder()
  const err = sink()
  const code = await main(['launch', 'p.md', 'race-9'], {
    launch: () => {
      throw new Error('boom-511')
    },
    judge,
    stderr: err,
  })
  assert.equal(code, 1)
  assert.ok(err.lines.join('\n').includes('boom-511'), err.lines.join('\n'))
  assert.equal(judge.calls.length, 0)
  ok('(f) an unknown verb, a missing verb, and a throwing verb each write to stderr and return 1')
}

// --- (g) VERB_MODULES and the run-time resolver ------------------------------

{
  assert.deepEqual(VERB_MODULES, { launch: './race-launch.mjs', judge: './race-judge.mjs' })
  assert.equal(Object.isFrozen(VERB_MODULES), true)
}

{
  // No verb injected: main falls back to resolveVerb, once, by name.
  for (const [verb, rest] of [['launch', ['p.md', 'race-9']], ['judge', ['race-9']]]) {
    const resolved = recorder()
    const resolveCalls = []
    const code = await main([verb, ...rest], {
      resolveVerb: (...args) => {
        resolveCalls.push(args)
        return Promise.resolve(resolved)
      },
    })
    assert.equal(code, 0)
    assert.equal(resolveCalls.length, 1)
    assert.deepEqual(resolveCalls[0], [verb])
    assert.equal(resolved.calls.length, 1)
    assert.deepEqual(resolved.calls[0][0], rest)
  }
}

{
  // The wiring itself, proven against a recording importer — the real sibling
  // modules are never loaded.
  const specs = []
  const importer = (spec) => {
    specs.push(spec)
    return Promise.resolve({ launchRace: () => 'launched', judgeRace: () => 'judged' })
  }

  const launchFn = await resolveVerb('launch', importer)
  assert.deepEqual(specs, ['./race-launch.mjs'])
  assert.equal(launchFn(), 'launched')

  specs.length = 0
  const judgeFn = await resolveVerb('judge', importer)
  assert.deepEqual(specs, ['./race-judge.mjs'])
  assert.equal(judgeFn(), 'judged')

  specs.length = 0
  await assert.rejects(() => resolveVerb('fly', importer))
  assert.deepEqual(specs, [], 'an unknown verb must reject before importing anything')
  ok('(g) VERB_MODULES is the frozen literal; resolveVerb imports it by name and returns launchRace/judgeRace')
}

// --- (h) as a process: no verb and a bad verb exit 1 without a sibling load --

{
  const bad = spawnSync(process.execPath, ['fleet/race.mjs', 'fly'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(bad.status, 1)
  assert.ok(bad.stderr.includes(usage()), bad.stderr)

  const none = spawnSync(process.execPath, ['fleet/race.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(none.status, 1)

  // Neither path reaches the resolver: the wave-2 siblings do not exist yet,
  // so a module-not-found would be the loudest thing on stderr if it did.
  for (const r of [bad, none]) {
    const text = `${r.stdout}${r.stderr}`
    assert.ok(!text.includes('race-launch.mjs'), text)
    assert.ok(!text.includes('race-judge.mjs'), text)
    assert.ok(!text.includes('ERR_MODULE_NOT_FOUND'), text)
  }
  ok('(h) `node fleet/race.mjs fly` and a bare `node fleet/race.mjs` exit 1 without loading a sibling')
}

// --- (i) this file never statically imports a wave-2 sibling ----------------

{
  const STATIC_SIBLING_IMPORT = /^[ \t]*(?:import|export)\b[^\n]*race-(?:launch|judge)\.mjs/m
  const SELF = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.equal(
    STATIC_SIBLING_IMPORT.test(SELF),
    false,
    'this test must never statically import a wave-2 sibling module',
  )
  const SOURCE = fs.readFileSync(path.join(ROOT, 'fleet', 'race.mjs'), 'utf8')
  assert.equal(
    STATIC_SIBLING_IMPORT.test(SOURCE),
    false,
    'race.mjs must reach its verbs only through the run-time resolver',
  )
  ok('(i) neither this test nor race.mjs statically imports race-launch.mjs / race-judge.mjs')
}

console.log(`\nALL TESTS PASSED (${passed})`)
