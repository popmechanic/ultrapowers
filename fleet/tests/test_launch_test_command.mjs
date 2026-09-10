/**
 * fleet/tests/test_launch_test_command.mjs — a target with no detectable test
 * command is refused on the laptop.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] [M3] each of the seven rungs of the sandbox's ladder —
 *       `pytest.ini`; `pyproject.toml` with `[tool.pytest]`; `package.json`
 *       with a `scripts.test`; `package.json` with no scripts beside a
 *       `bun.lockb`; a `Makefile` with a `test:` line; `go.mod`; `Cargo.toml` —
 *       launches: `result.run` is 1 and the lobby sees one `new` line;
 *   (b) [M1] [M2] each of five trees matching no rung is a `Refusal` with
 *       `exitCode` 2, whose message carries the target, the `--base` sha, the
 *       sandbox's own failure line and the word `pytest.ini`, and which is
 *       raised after the `merge-base --is-ancestor` read;
 *   (c) [M3] every one of those refusals issues no `ssh` and no `git push`,
 *       mutates no lobby verb, and leaves the origin with no `ultra/` ref;
 *   (d) [M3] the read is of `--base`'s tree: an untracked `pytest.ini` in the
 *       working tree of a base without one still refuses, and a base carrying
 *       `pytest.ini` whose working-tree copy is deleted still launches;
 *   (e) [M1] the cross-check: the sandbox's own `detect_test_cmd`, spawned on
 *       each of the twelve clone directories, names a rung for the seven and
 *       `None` for the five — the laptop's ladder answers what the sandbox's
 *       does;
 *   (f) [M4] `node fleet/tests/test_launch.mjs` exits 0 and prints
 *       `ALL TESTS PASSED`;
 *   (g) [M4] and `fleet/tests/test_launch_hold.mjs`;
 *   (h) [M4] and `fleet/tests/test_launch_effort.mjs`;
 *   (i) [M4] and `fleet/tests/test_launch_engine_source.mjs`;
 *   (j) [M4] and `fleet/tests/test_launch_reaps.mjs`.
 *
 * Nothing here opens a network socket. Every `ssh` goes through the injected
 * exec seam, and the target of every launch is a real repository — the bare
 * origin `makeTargetRepo` builds and its clone — so a plan push is a real push
 * against a path and the refs a leg reads are the origin's own. The keychain is
 * never touched: every launch is handed a `refreshCredential` of the exam's
 * own. The one subprocess the exam spawns besides the five sims is `python3`,
 * running the frozen ladder in `skills/ultrapowers/scripts/ultra_run.py`, which
 * this task does not edit.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

import { launch } from '../launch.mjs'
import { FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration, so the integrations read is green. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

/** The sandbox's own words for this refusal — `ultra_run.py`'s `test-command`
 *  stage failure line, verbatim, which M2 says the laptop quotes. */
const SANDBOX_LINE =
  'no test command detected — pass --test-cmd <run-wide suite command>; ' +
  'the gate refuses to run without one'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const ULTRA_RUN = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'scripts', 'ultra_run.py')

// ── The seam's rules, as `fleet/tests/test_launch.mjs` builds them ───────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/** `origin` pointed at the bare repository the exam really made; a bare
 *  `fetch origin <branch>` is spelled with the refspec a configured remote
 *  supplies, so the tracking ref moves the way it does in a real checkout. */
const pointAtOrigin = (repo, argv) => {
  const pointed = argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a))
  const fetchAt = argv.indexOf('fetch')
  if (fetchAt < 0) return pointed
  const remoteAt = argv.indexOf('origin', fetchAt)
  const branch = String(argv[remoteAt + 1] ?? '')
  if (remoteAt < 0 || branch === '' || branch.startsWith('-') || branch.includes(':')) return pointed
  pointed[remoteAt + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  return pointed
}

const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
})

/** No socket, whatever else the launcher tries. */
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })

const readRules = ({ repo, integrations = [{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }] } = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  {
    when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
    answer: OFFLINE
  },
  {
    when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
    answer: OFFLINE
  }
]

// ── The workspace: a real target repository and a plan beside it ─────────────

/** A target whose base commit carries `README.md` plus whatever `files` says. */
function workspace ({ files } = {}) {
  const root = tempDir('fleet-launch-testcmd-')
  const repo = makeTargetRepo({ root, files: { 'README.md': '# target\n', ...(files ?? {}) } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** The origin's own `refs/heads/*`, read off the bare path the exam made. */
const branchesOf = (ws) => {
  const out = {}
  for (const line of ws.repo.git(['ls-remote', '--heads', ws.repo.origin]).split('\n')) {
    const [sha, ref] = line.split('\t')
    if (!ref) continue
    out[ref.trim().replace(/^refs\/heads\//, '')] = sha.trim()
  }
  return out
}

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]

/** The keychain is never read: the credential seam is the exam's own. */
const refreshCredential = () => ({ ok: true })

const launchIn = (ws, { argv, exec } = {}) => launch({
  argv: argv ?? argvFor(ws),
  exec,
  config: CONFIG,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential
})

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))
const gitCallAt = (exec, text) =>
  exec.calls.findIndex((c) => c.cmd === 'git' && c.argv.map(String).join(' ').includes(text))

// ── The twelve seeds: seven rungs of the ladder, and five trees off it ───────

/** The seven rungs M1 spells, each with the rule name the sandbox's ladder
 *  gives it — the name leg (e) reads back out of `detect_test_cmd`. */
const DETECTABLE = [
  { name: 'pytest.ini', files: { 'pytest.ini': '[pytest]\n' }, rule: 'pytest-ini' },
  {
    name: 'pyproject.toml with [tool.pytest]',
    files: { 'pyproject.toml': '[project]\nname = "t"\n\n[tool.pytest.ini_options]\n' },
    rule: 'pyproject-pytest'
  },
  {
    name: 'package.json with a scripts.test',
    files: { 'package.json': '{"name":"t","scripts":{"test":"x"}}\n' },
    rule: 'package-json-npm'
  },
  {
    name: 'package.json with no scripts, beside a bun.lockb',
    files: { 'package.json': '{"name":"t"}\n', 'bun.lockb': 'not really a lockfile\n' },
    rule: 'bun-lockfile'
  },
  {
    name: 'a Makefile with a test: line',
    files: { Makefile: 'all:\n\techo all\n\ntest:\n\techo test\n' },
    rule: 'makefile-test'
  },
  { name: 'go.mod', files: { 'go.mod': 'module example.com/t\n\ngo 1.22\n' }, rule: 'go-mod' },
  {
    name: 'Cargo.toml',
    files: { 'Cargo.toml': '[package]\nname = "t"\nversion = "0.1.0"\n' },
    rule: 'cargo-toml'
  }
]

/** Five trees matching no rung: each is one rung away from matching. */
const UNDETECTABLE = [
  { name: 'README.md alone', files: {} },
  {
    name: 'pyproject.toml with [tool.black] only',
    files: { 'pyproject.toml': '[project]\nname = "t"\n\n[tool.black]\nline-length = 100\n' }
  },
  {
    name: 'package.json with a scripts.build and no lockfile',
    files: { 'package.json': '{"name":"t","scripts":{"build":"x"}}\n' }
  },
  { name: 'bun.lock with no package.json', files: { 'bun.lock': 'not really a lockfile\n' } },
  {
    name: 'a Makefile with only a build: line',
    files: { Makefile: '# no suite here\nbuild:\n\techo build\n' }
  }
]

// ── The fixture: the sandbox's own words, read off the frozen ladder ─────────
{
  assert.ok(
    fs.existsSync(ULTRA_RUN),
    `(b) [M2] the fixture: the sandbox's ladder is at ${ULTRA_RUN}`
  )
  // Python's implicit concatenation of adjacent string literals, undone, so the
  // wrapped `failure=` line reads as the one sentence the launcher quotes.
  const joined = fs.readFileSync(ULTRA_RUN, 'utf8').replace(/"\s*\n\s*"/g, '')
  assert.ok(
    joined.includes(SANDBOX_LINE),
    `(b) [M2] the fixture: ultra_run.py's test-command stage says ${JSON.stringify(SANDBOX_LINE)} — the line the laptop copies verbatim`
  )
}

// ── a. [M1] [M3] each of the seven rungs launches ────────────────────────────
// ── b. [M1] [M2] each of the five trees off the ladder is refused ────────────
// ── c. [M3] and each refusal touched neither exe.dev nor the origin ──────────
// ── e. [M1] the sandbox's own ladder, spawned on all twelve clones ───────────

/** The frozen ladder, run on a directory: the rule name it answers, or `None`. */
const LADDER = 'import sys; sys.path.insert(0, "skills/ultrapowers/scripts"); ' +
  'from ultra_run import detect_test_cmd; print(detect_test_cmd(sys.argv[1])[1])'

const sandboxRuleFor = (dir) => {
  const res = spawnSync('python3', ['-c', LADDER, dir], { cwd: REPO_ROOT, encoding: 'utf8', env: simEnv() })
  assert.equal(
    res.status, 0,
    `(e) [M1] the sandbox's ladder runs on ${dir}: ${res.stdout ?? ''}${res.stderr ?? ''}`
  )
  return String(res.stdout ?? '').trim()
}

for (const kase of DETECTABLE) {
  const ws = workspace({ files: kase.files })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec })

  assert.equal(
    result.run, 1,
    `(a) [M1] [M3] a base seeded with ${kase.name} matches a rung of the ladder, so the launch goes through: run 1`
  )
  assert.equal(
    newLines(exec).length, 1,
    `(a) [M3] and issues one \`new\` line for ${kase.name}`
  )
  assert.equal(
    exec.mutating().length, 1,
    `(a) [M3] exactly one mutating lobby verb for ${kase.name}`
  )
  assert.ok(
    exec.mutating()[0].startsWith('new '),
    `(a) [M3] that one verb being the \`new …\` line, got ${JSON.stringify(exec.mutating()[0])}`
  )

  assert.equal(
    sandboxRuleFor(ws.repo.dir), kase.rule,
    `(e) [M1] the sandbox's own detect_test_cmd calls ${kase.name} the \`${kase.rule}\` rung`
  )
  ws.cleanup()
}

for (const kase of UNDETECTABLE) {
  const ws = workspace({ files: kase.files })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const error = await thrown(() => launchIn(ws, { exec }))

  assert.ok(error, `(b) [M2] a base whose tree is ${kase.name} matches no rung and must be refused`)
  assert.ok(
    error instanceof Refusal,
    `(b) [M2] ${kase.name} is a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.equal(error.exitCode, 2, `(b) [M2] ${kase.name} refuses with exit 2`)
  assert.ok(
    error.message.startsWith('launch: '),
    `(b) [M2] whose message begins \`launch: \`, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes(TARGET),
    `(b) [M2] ${kase.name}: the message names the target ${TARGET}, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes(ws.repo.base),
    `(b) [M2] ${kase.name}: and the --base sha ${ws.repo.base}, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes(SANDBOX_LINE),
    `(b) [M2] ${kase.name}: and the sandbox's own line ${JSON.stringify(SANDBOX_LINE)} in full, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('pytest.ini'),
    `(b) [M2] ${kase.name}: and the word \`pytest.ini\`, so the operator reads what to commit, got ${JSON.stringify(error.message)}`
  )

  assert.ok(
    gitCallAt(exec, `merge-base --is-ancestor ${ws.repo.base}`) >= 0,
    `(b) [M1] ${kase.name}: the refusal comes after the --base ancestry check, which still ran`
  )

  assert.deepEqual(
    exec.calls.filter((c) => c.cmd === 'ssh').map((c) => c.line), [],
    `(c) [M3] ${kase.name}: no ssh command at all — the refusal is before the integrations list read, so no VM exists`
  )
  assert.deepEqual(
    exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push')).map((c) => c.line), [],
    `(c) [M3] ${kase.name}: and no git push`
  )
  assert.deepEqual(exec.mutating(), [], `(c) [M3] ${kase.name}: nothing mutated on exe.dev`)
  assert.deepEqual(newLines(exec), [], `(c) [M3] ${kase.name}: and no \`new\` issued`)
  assert.deepEqual(
    Object.keys(branchesOf(ws)).filter((ref) => ref.startsWith('ultra/')), [],
    `(c) [M3] ${kase.name}: so no ultra/ ref reached the origin`
  )

  assert.equal(
    sandboxRuleFor(ws.repo.dir), 'None',
    `(e) [M1] the sandbox's own detect_test_cmd finds no rung for ${kase.name} either`
  )
  ws.cleanup()
}

// ── d. [M3] the tree read is `--base`'s, not the working tree's ──────────────
{
  // An untracked `pytest.ini` beside a base that has none: the working tree
  // would pass the ladder, the tree at `--base` does not, and `--base` is what
  // the sandbox will clone.
  const untracked = workspace()
  fs.writeFileSync(path.join(untracked.repo.dir, 'pytest.ini'), '[pytest]\n')
  assert.ok(
    fs.existsSync(path.join(untracked.repo.dir, 'pytest.ini')),
    "(d) [M3] the fixture: the clone's working tree carries an untracked pytest.ini"
  )
  assert.notEqual(
    untracked.repo.git(['status', '--porcelain']), '',
    '(d) [M3] the fixture: which git reports as untracked, so it is in no commit'
  )
  const execUntracked = makeExec({ rules: readRules({ repo: untracked.repo }) })
  const error = await thrown(() => launchIn(untracked, { exec: execUntracked }))
  assert.ok(
    error instanceof Refusal,
    `(d) [M3] an untracked pytest.ini does not make a base detectable: still a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.ok(
    error.message.includes(SANDBOX_LINE),
    `(d) [M3] and it is this refusal, carrying the sandbox's line, got ${JSON.stringify(error.message)}`
  )
  assert.deepEqual(
    execUntracked.calls.filter((c) => c.cmd === 'ssh').map((c) => c.line), [],
    '(d) [M3] with no ssh command issued'
  )
  assert.deepEqual(
    Object.keys(branchesOf(untracked)).filter((ref) => ref.startsWith('ultra/')), [],
    '(d) [M3] and no ultra/ ref on the origin'
  )
  untracked.cleanup()

  // The mirror: a base that has `pytest.ini`, deleted from the working tree.
  const deleted = workspace({ files: { 'pytest.ini': '[pytest]\n' } })
  fs.rmSync(path.join(deleted.repo.dir, 'pytest.ini'))
  assert.ok(
    !fs.existsSync(path.join(deleted.repo.dir, 'pytest.ini')),
    "(d) [M3] the fixture: the working tree's copy of pytest.ini is gone"
  )
  assert.equal(
    deleted.repo.git(['show', `${deleted.repo.base}:pytest.ini`]), '[pytest]',
    "(d) [M3] the fixture: while the tree at --base still has it"
  )
  const execDeleted = makeExec({ rules: readRules({ repo: deleted.repo }) })
  const result = await launchIn(deleted, { exec: execDeleted })
  assert.equal(
    result.run, 1,
    '(d) [M3] a working-tree deletion does not hide the rung the base carries: the launch goes through, run 1'
  )
  assert.equal(newLines(execDeleted).length, 1, '(d) [M3] with one `new` line')
  deleted.cleanup()
}

// ── f–j. [M4] the five launch sims the ladder must not disturb ───────────────
//
// Named, not run. The bridge in tests/test_fleet_suite.py collects every
// fleet/tests/test_*.mjs and dispatches each on a worker of its own; a sim that
// spawned these five ran them twice and charged five walls to this one name.
// What the leg keeps is the coverage — the names stay written down here, and
// each is asserted to still be a sim on the tree.
{
  const SIMS = [
    { leg: 'f', file: 'fleet/tests/test_launch.mjs' },
    { leg: 'g', file: 'fleet/tests/test_launch_hold.mjs' },
    { leg: 'h', file: 'fleet/tests/test_launch_effort.mjs' },
    { leg: 'i', file: 'fleet/tests/test_launch_engine_source.mjs' },
    { leg: 'j', file: 'fleet/tests/test_launch_reaps.mjs' }
  ]

  for (const sim of SIMS) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, sim.file)),
      `(${sim.leg}) [M4] ${sim.file} is still a sim under fleet/tests/, collected and run by the bridge`
    )
  }
}

console.log('ALL TESTS PASSED')
