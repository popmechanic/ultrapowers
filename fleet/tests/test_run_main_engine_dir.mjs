// fleet/tests/test_run_main_engine_dir.mjs — Task 1's exam: the engine
// resolves ITSELF from its own location, and builds whatever repository
// `--repo` points at.
//
// One variable at BASE becomes two: `ENGINE_DIR` (this module's own
// repository — scripts, roles, the confine hook) and `repoDir` (the target,
// mandatory, supplying BASE, the clones, the run dir and the gate). Each
// block below names the Proof leg and the Machine clause it encodes.
//
//   leg (a) / M1  ENGINE_DIR is exported, is the resolved parent of fleet/,
//                 is the same value from a process with an unrelated cwd, and
//                 REPO_DIR is gone
//   leg (b) / M2  --repo is mandatory, carries through, and DEFAULTS has no
//                 repoDir key
//   leg (c) / M3  every python3 exec of a green runMain flow runs an
//                 <ENGINE_DIR> script with cwd <target>; so does git rev-parse
//   leg (d) / M4  the hook path and the role files come from <ENGINE_DIR>,
//                 and <target>/fleet and <target>/skills appear nowhere
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_URL = new URL('../run-main.mjs', import.meta.url)
const MODULE_PATH = fileURLToPath(MODULE_URL)
// M1's own formula, computed here from this test's location rather than read
// back from the module: fleet/tests/../.. is the same directory as
// fleet/run-main.mjs's dirname/.. — the resolved parent of `fleet/`.
const ENGINE_DIR_EXPECTED = path.resolve(path.dirname(MODULE_PATH), '..')
const ENGINE_SCRIPTS = path.join(ENGINE_DIR_EXPECTED, 'skills/ultrapowers/scripts')
const ENGINE_HOOK = path.join(ENGINE_DIR_EXPECTED, 'fleet/confine-hook.mjs')
const ENGINE_ROLES = path.join(ENGINE_DIR_EXPECTED, 'fleet/roles')

// A dynamic import, not a static one, so an absent export reads as a named
// assertion failure instead of a link-time SyntaxError that hides every other
// leg. `import('../run-main.mjs')` is also the form leg (a) uses for the
// REPO_DIR check.
const mod = await import(MODULE_URL.href)
const { parseArgs, DEFAULTS, runMain } = mod

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runmain-enginedir-')))
const git = (argv, cwd) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const mkdir = (p) => { fs.mkdirSync(p, { recursive: true }); return p }

// ── leg (a) / M1 — ENGINE_DIR, and the end of REPO_DIR ───────────────────────
{
  assert.ok(Object.prototype.hasOwnProperty.call(mod, 'ENGINE_DIR'),
    '[leg a / M1] fleet/run-main.mjs exports ENGINE_DIR (exports seen: ' +
    Object.keys(mod).join(', ') + ')')
  assert.equal(typeof mod.ENGINE_DIR, 'string', '[leg a / M1] ENGINE_DIR is a path string')
  assert.equal(mod.ENGINE_DIR, ENGINE_DIR_EXPECTED,
    '[leg a / M1] ENGINE_DIR equals path.resolve(dirname(fileURLToPath(import.meta.url)), "..") ' +
    '— the resolved parent of fleet/')

  // Independent of process.cwd(): a child node process whose cwd is a fresh
  // temp directory, importing the module by absolute path, prints the same
  // value. `-e` code is CommonJS, so the dynamic import is the whole program.
  const childCwd = mkdir(path.join(tmp, 'unrelated-cwd-a'))
  const childCode = 'import(' + JSON.stringify(pathToFileURL(MODULE_PATH).href) + ').then(' +
    '(m) => process.stdout.write(JSON.stringify({ engineDir: m.ENGINE_DIR ?? null, names: Object.keys(m) })),' +
    '(e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(7) })'
  let printed
  try {
    printed = execFileSync(process.execPath, ['-e', childCode], { cwd: childCwd, encoding: 'utf8' })
  } catch (e) {
    assert.fail('[leg a / M1] the child process could not import fleet/run-main.mjs from an ' +
      'unrelated cwd: ' + String((e && (e.stderr || e.message)) || e))
  }
  const seen = JSON.parse(printed)
  assert.equal(seen.engineDir, ENGINE_DIR_EXPECTED,
    '[leg a / M1] a process whose cwd is ' + childCwd + ' resolves the same ENGINE_DIR — ' +
    'the value is derived from import.meta.url, not from process.cwd()')
  assert.ok(!seen.names.includes('REPO_DIR'),
    '[leg a / M1] the module no longer exports REPO_DIR (child saw: ' + seen.names.join(', ') + ')')
  assert.ok(!Object.prototype.hasOwnProperty.call(mod, 'REPO_DIR'),
    '[leg a / M1] import("../run-main.mjs") has no REPO_DIR export')
}

// ── leg (b) / M2 — --repo is mandatory and carried ───────────────────────────
{
  // A parse that RETURNS instead of throwing fails this leg: assert.throws
  // reports the missing exception rather than passing on a truthy default.
  assert.throws(
    () => parseArgs(['plan.md', 'run-1']),
    (e) => {
      assert.ok(e instanceof Error, '[leg b / M2] the refusal is an Error')
      assert.ok(String(e.message).includes('--repo'),
        '[leg b / M2] the message names --repo (got: ' + String(e.message) + ')')
      return true
    },
    '[leg b / M2] parseArgs(["plan.md", "run-1"]) refuses: --repo is mandatory, ' +
    'because a default that points the engine at itself is the deleted self-host case',
  )

  const p = parseArgs(['plan.md', 'run-1', '--repo', '/t'])
  assert.equal(p.repoDir, '/t', '[leg b / M2] --repo /t yields repoDir "/t"')
  assert.equal(p.planPath, 'plan.md', '[leg b / M2] the positional plan path is unchanged')
  assert.equal(p.runId, 'run-1', '[leg b / M2] the positional runId is unchanged')

  assert.ok(!Object.keys(DEFAULTS).includes('repoDir'),
    '[leg b / M2] repoDir is absent from Object.keys(DEFAULTS) (got: ' +
    Object.keys(DEFAULTS).join(', ') + ')')
}

// ── the green flow legs (c) and (d) share one run ────────────────────────────
// A target repo that is NOT the engine: a git repository with neither a
// `skills/` nor a `fleet/` directory, driven from a cwd that is neither.
const target = (() => {
  const dir = mkdir(path.join(tmp, 'target-repo'))
  git(['init', '-q', '-b', 'fleet-base'], dir)
  git(['config', 'user.email', 't@example.com'], dir)
  git(['config', 'user.name', 't'], dir)
  fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n')
  mkdir(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'app.txt'), 'app\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'base'], dir)
  return dir
})()
assert.ok(!fs.existsSync(path.join(target, 'skills')),
  '[legs c,d / M3,M4] the target carries no skills/ — that is the point of the fixture')
assert.ok(!fs.existsSync(path.join(target, 'fleet')),
  '[legs c,d / M3,M4] the target carries no fleet/ — that is the point of the fixture')

const RUN_ID = 'run-e1'
const PLAN_PATH = path.join(target, 'plan.md')
fs.writeFileSync(PLAN_PATH, '# plan\n')
const RUN_DIR = path.join(target, '.claude/ultrapowers', 'run-' + RUN_ID)
const ARGS_FILE = path.join(RUN_DIR, 'args.json')
const WAVES = [[
  { id: 'T1', title: 't1', files: ['a.txt'], tier: null, review: 'lean', writes: ['a.txt'], commutes: [] },
  { id: 'T2', title: 't2', files: ['src/app.txt'], tier: null, review: 'lean', writes: ['src/app.txt'], commutes: [] },
]]

// The recording seam: every call keeps its cwd, because cwd is half of what
// M3 asserts. python3 is played by basename (as test_run_main.mjs does), so
// the stub is blind to WHERE the scripts live — the flow stays green at BASE
// and the assertions below are what read the path.
const calls = []
const exec = async (cmd, argv, opts = {}) => {
  calls.push({ cmd, argv: [...argv], cwd: opts.cwd })
  if (cmd === 'git') {
    try {
      return { code: 0, stdout: execFileSync('git', argv, { cwd: opts.cwd, encoding: 'utf8' }), stderr: '' }
    } catch (e) {
      return { code: 1, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) }
    }
  }
  if (cmd === 'claude' && argv[0] === 'auth') {
    return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }), stderr: '' }
  }
  const script = path.basename(argv[0])
  if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
    return { code: 0, stdout: '{"ok": true}', stderr: '' }
  }
  if (script === 'ultra_run.py') {
    mkdir(RUN_DIR)
    fs.writeFileSync(ARGS_FILE, JSON.stringify({
      waves: WAVES,
      wavesPath: path.join(RUN_DIR, 'launch.json'),
      edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
      globalConstraints: '', planPath: argv[1],
      pluginRoot: target, runDir: RUN_DIR, testCmd: 'true',
    }, null, 2))
    const receipt = { ok: true, baseBranch: 'fleet-base', argsFile: ARGS_FILE, testCmd: 'true' }
    fs.writeFileSync(path.join(RUN_DIR, 'receipt.json'), JSON.stringify(receipt))
    return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
  }
  if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
  if (script === 'ultra_gate.py' && argv.includes('--approve')) {
    return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: RUN_ID }), stderr: '' }
  }
  if (script === 'ultra_gate.py') {
    fs.writeFileSync(path.join(RUN_DIR, 'gate-receipt.json'), JSON.stringify({
      verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
    }))
    return { code: 0, stdout: '', stderr: '' }
  }
  throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
}

// The driver's own cwd is an unrelated directory for the whole flow (M3).
const unrelatedCwd = mkdir(path.join(tmp, 'unrelated-cwd-flow'))
const enteredFrom = process.cwd()
let out
try {
  process.chdir(unrelatedCwd)
  out = await runMain(
    { planPath: PLAN_PATH, runId: RUN_ID, repoDir: target, tier: 'mostCapable',
      overlap: null, testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec,
      log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + RUN_ID, waveMerges: [], tasks: [],
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
} finally {
  process.chdir(enteredFrom)
}
assert.equal(out.code, 0, '[legs c,d / M3,M4] the flow is green — ' + out.verdict + ': ' + out.detail)
assert.equal(out.verdict, 'approved', '[legs c,d / M3,M4] the flow is the approved path')

// ── leg (c) / M3 — every script is the engine's, every cwd is the target ─────
{
  const py = calls.filter((c) => c.cmd === 'python3')
  assert.equal(py.length, 5,
    '[leg c / M3] the flow issues five python3 execs (ultra_run twice, finalize_report, ' +
    'ultra_gate twice); saw ' + py.length)

  for (const c of py) {
    assert.ok(c.argv[0].startsWith(ENGINE_SCRIPTS + path.sep),
      '[leg c / M3] argv[0] lives under <ENGINE_DIR>/skills/ultrapowers/scripts/ — expected the ' +
      'prefix ' + ENGINE_SCRIPTS + path.sep + ', got ' + c.argv[0])
    // A python3 call with any other cwd fails this leg: the scripts come from
    // the engine, the tree they read comes from --repo.
    assert.equal(c.cwd, target,
      '[leg c / M3] ' + path.basename(c.argv[0]) + ' runs with cwd equal to the target repo ' +
      '(expected ' + target + ', got ' + String(c.cwd) + ')')
  }

  assert.deepEqual(
    py.map((c) => path.basename(c.argv[0])).sort(),
    ['finalize_report.py', 'ultra_gate.py', 'ultra_gate.py', 'ultra_run.py', 'ultra_run.py'],
    '[leg c / M3] the five scripts are exactly ultra_run.py twice, finalize_report.py, ' +
    'ultra_gate.py twice',
  )

  assert.deepEqual(
    py[0].argv,
    [path.join(ENGINE_SCRIPTS, 'ultra_run.py'), PLAN_PATH, '--stamp', RUN_ID],
    '[leg c / M3] the first python3 exec is <ENGINE_DIR> ultra_run.py <plan> --stamp <runId>',
  )

  const revParse = calls.filter((c) => c.cmd === 'git' &&
    c.argv[0] === 'rev-parse' && c.argv[1] === 'HEAD')
  assert.equal(revParse.length, 1, '[leg c / M3] the flow takes BASE with one git rev-parse HEAD')
  assert.equal(revParse[0].cwd, target,
    '[leg c / M3] git rev-parse HEAD runs with cwd equal to the target repo — BASE is the ' +
    'target\'s, not the engine\'s (expected ' + target + ', got ' + String(revParse[0].cwd) + ')')
}

// ── leg (d) / M4 — the hook, the roles, and no target-side engine path ───────
{
  // The confine settings file under the run directory: located by shape (a
  // top-level JSON carrying hooks.PreToolUse), so the leg reads the hook
  // command rather than a file name.
  const settingsFiles = fs.readdirSync(RUN_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(RUN_DIR, n))
    .filter((p) => fs.statSync(p).isFile())
    .filter((p) => {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'))
        return Boolean(j && j.hooks && j.hooks.PreToolUse)
      } catch { return false }
    })
  assert.equal(settingsFiles.length, 1,
    '[leg d / M4] exactly one confine settings file sits under the run directory (found ' +
    settingsFiles.length + ')')
  const entry = JSON.parse(fs.readFileSync(settingsFiles[0], 'utf8')).hooks.PreToolUse[0]
  const command = entry.hooks[0].command
  assert.ok(command.includes(ENGINE_HOOK),
    '[leg d / M4] the hook command names <ENGINE_DIR>/fleet/confine-hook.mjs — expected to ' +
    'contain ' + ENGINE_HOOK + ', got ' + command)

  // The role files are the engine's own, byte for byte.
  const rolesDir = path.join(RUN_DIR, 'roles')
  assert.ok(fs.existsSync(rolesDir), '[leg d / M4] the run directory has a roles/ directory')
  const roleFiles = fs.readdirSync(rolesDir)
    .filter((n) => fs.statSync(path.join(rolesDir, n)).isFile())
  assert.ok(roleFiles.length >= 1, '[leg d / M4] at least one role file was written')
  for (const name of roleFiles) {
    const source = path.join(ENGINE_ROLES, name)
    assert.ok(fs.existsSync(source),
      '[leg d / M4] <runDir>/roles/' + name + ' has its source at <ENGINE_DIR>/fleet/roles/' +
      name + ' — the roles are read relative to the module, not from --repo')
    assert.ok(
      fs.readFileSync(path.join(rolesDir, name)).equals(fs.readFileSync(source)),
      '[leg d / M4] <runDir>/roles/' + name + ' is byte-identical to ' + source,
    )
  }

  // Nothing anywhere reconstructs the engine's layout inside the target.
  const forbidden = [path.join(target, 'fleet'), path.join(target, 'skills')]
  for (const c of calls) {
    for (const piece of [c.cmd, ...c.argv]) {
      for (const bad of forbidden) {
        assert.ok(!String(piece).includes(bad),
          '[leg d / M4] no exec argument names ' + bad + ' — saw it in: ' +
          c.cmd + ' ' + c.argv.join(' '))
      }
    }
  }

  // Walk the run directory recursively, clones/ included, skipping only .git/.
  const walk = (dir, acc = []) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === '.git') continue
        walk(p, acc)
      } else if (ent.isFile()) acc.push(p)
    }
    return acc
  }
  const files = walk(RUN_DIR)
  assert.ok(files.length >= 10,
    '[leg d / M4] the walk visits at least ten files under the run directory (visited ' +
    files.length + ') — a walk that finds nothing proves nothing')
  for (const p of files) {
    const text = fs.readFileSync(p).toString('utf8')
    for (const bad of forbidden) {
      assert.ok(!text.includes(bad),
        '[leg d / M4] no file under the run directory names ' + bad + ' — found in ' + p)
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
