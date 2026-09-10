/**
 * fleet/tests/test_launch_compile.mjs — the plan compiles at `--base` before
 * anything is launched (#865, #896).
 *
 * "Compile with `--check --base <sha>` first" was a step the operator
 * remembered; a plan launched on a moved base shipped stale Context to every
 * worker when they did not. So the launcher runs the compiler itself, through
 * the exec seam, after the hash pins and before the first `ls-remote`, and
 * refuses on anything but exit 0. Legs, each naming its clause:
 *
 *   (a) [M1] a green launch invokes `python3` exactly once, with the plugin's
 *       own `compile_plan.py`, `--check`, `--base <base>` and the plan path,
 *       after the `--base` read and before the first `ls-remote` or lobby verb;
 *   (b) [M2] a compiler answering non-zero is a `Refusal`, exit 2, whose
 *       message names `compile_plan.py --check --base <base>` and carries the
 *       compiler's own text; no ssh, no push, no lobby verb, no `ultra/` ref;
 *   (c) [M3] a `**BASE facts:** (generated at <sha>)` block whose sha is not a
 *       prefix of `--base` refuses BEFORE the compiler runs, naming the re-pin
 *       command with `--write --base <base>`; a block stamped with the base's
 *       own prefix launches;
 *   (d) [M4] the `BASE fact:` lines of a clean compile ride the result as
 *       `baseFacts` and `renderLaunch` prints them, last; a compile that prints
 *       none leaves `baseFacts` empty and the render as it was;
 *   (e) [Produces] `verifyPlanCompiles` is what `fleet/launch.mjs` produces.
 *
 * Nothing here opens a network socket, and nothing here runs the real
 * compiler: `python3` is answered by the seam, so the exam reads what the
 * launcher asked and what it did with the answer. The scaffolding is the
 * pins sim's, copied rather than imported: that file exports nothing.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'
import { launch, renderLaunch } from '../launch.mjs'
import { FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-10T22:50:00.000Z')
const CONFIG = { ...FLEET_DEFAULTS }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n' }

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
/** The compiler the launcher must name: the plugin's own. */
const COMPILER = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}
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
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}
const helpText = (verb, flags) => [
  `Command: ${verb}`, '', 'Options:', ...flags.map((flag) => `  ${flag}  what ${flag} does`), ''
].join('\n')
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = VERBS.verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}
/** The compiler, as the seam answers it. */
const compilerRule = (res) => ({ when: (cmd) => cmd === 'python3', answer: res })

const readRules = ({ repo, compiler = answer('PLAN OK\n') } = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  compilerRule(compiler),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

const PLAN = '# a plan\n\nOne task, and a trailing newline.\n'
const stampedPlan = (sha) =>
  `# a plan\n\n### Task 1: t\n\n**Context:** c\n**BASE facts:** (generated at ${sha})\n- \`README.md\` blob 1234567\n`

function workspace ({ plan = PLAN } = {}) {
  const root = tempDir('fleet-launch-compile-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, typeof plan === 'function' ? plan(repo) : plan)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}
const branchesOf = (ws) => {
  const out = {}
  for (const line of ws.repo.git(['ls-remote', '--heads', ws.repo.origin]).split('\n')) {
    const [sha, ref] = line.split('\t')
    if (ref) out[ref.trim().replace(/^refs\/heads\//, '')] = sha.trim()
  }
  return out
}
const argvFor = (ws) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE
]
const launchIn = (ws, { exec }) => launch({
  argv: argvFor(ws), exec, config: CONFIG, now: () => NOW, sleep: async () => {}, refreshCredential: () => ({ ok: true })
})
const pythonCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3')
const firstIndex = (exec, pred) => exec.calls.findIndex(pred)

// ── a. [M1] one compile, with the plugin's compiler, after the base read and before any remote ──
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec })
  assert.equal(result.run, 1, '(a) [M1] a plan the compiler accepts launches')
  const calls = pythonCalls(exec)
  assert.equal(calls.length, 1, `(a) [M1] exactly one python3 call, got ${calls.length}`)
  assert.deepEqual(
    calls[0].argv, [COMPILER, '--check', '--base', ws.repo.base, ws.planPath],
    '(a) [M1] compile_plan.py --check --base <base> <plan>, the plugin\'s own compiler'
  )
  assert.equal(calls[0].options?.cwd, ws.repo.dir, '(a) [M1] run in the checkout')
  const at = firstIndex(exec, (c) => c.cmd === 'python3')
  const baseRead = firstIndex(exec, (c) => c.cmd === 'git' && c.argv.includes('rev-parse') && c.argv.includes('--verify'))
  const firstRemote = firstIndex(exec, (c) => c.cmd === 'ssh' || (c.cmd === 'git' && c.argv.includes('ls-remote')))
  assert.ok(baseRead >= 0 && baseRead < at, '(a) [M1] after the --base read')
  assert.ok(firstRemote < 0 || at < firstRemote, '(a) [M1] before the first ls-remote or lobby verb')
  ws.cleanup()
}

// ── b. [M2] a compiler that refuses is a refusal, verbatim, and nothing moved ──
{
  const ws = workspace()
  const text = 'grammar: gate verdicts missing — expected `a-plan.gate-verdicts.json` beside the plan\n\n1 violation(s)\n'
  const exec = makeExec({ rules: readRules({ repo: ws.repo, compiler: answer(text, { code: 2 }) }) })
  const error = await thrown(() => launchIn(ws, { exec }))
  assert.ok(error instanceof Refusal, `(b) [M2] a Refusal, got ${error?.name}: ${error?.message}`)
  assert.equal(error.exitCode, 2, '(b) [M2] exit 2')
  assert.ok(error.message.startsWith('launch: '), '(b) [M2] begins `launch: `')
  assert.ok(error.message.includes(`compile_plan.py --check --base ${ws.repo.base}`), '(b) [M2] names the compile it ran')
  assert.ok(error.message.includes('gate verdicts missing'), '(b) [M2] carries the compiler\'s own text')
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'ssh').map((c) => c.line), [], '(b) [M2] no ssh')
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push')).map((c) => c.line), [], '(b) [M2] no push')
  assert.deepEqual(exec.mutating(), [], '(b) [M2] no lobby verb mutated')
  assert.deepEqual(Object.keys(branchesOf(ws)).filter((r) => r.startsWith('ultra/')), [], '(b) [M2] no ultra/ ref on the origin')
  ws.cleanup()
}

// ── c. [M3] a BASE facts block generated at another sha refuses before the compiler; the base's own prefix launches ──
{
  const stale = workspace({ plan: stampedPlan('1234567') })
  const execStale = makeExec({ rules: readRules({ repo: stale.repo }) })
  const error = await thrown(() => launchIn(stale, { exec: execStale }))
  assert.ok(error instanceof Refusal, `(c) [M3] a stale stamp refuses, got ${error?.name}: ${error?.message}`)
  assert.ok(error.message.includes('1234567') && error.message.includes(`--base ${stale.repo.base}`), '(c) [M3] names both shas')
  assert.ok(
    error.message.includes(`pin_base_facts.py --write --base ${stale.repo.base} ${stale.planPath}`),
    `(c) [M3] carries the re-pin command, got ${error.message}`
  )
  assert.equal(pythonCalls(execStale).length, 0, '(c) [M3] the compiler is not reached')
  assert.deepEqual(execStale.mutating(), [], '(c) [M3] nothing moved')
  stale.cleanup()

  const fresh = workspace({ plan: (repo) => stampedPlan(repo.base.slice(0, 7)) })
  const execFresh = makeExec({ rules: readRules({ repo: fresh.repo }) })
  const result = await launchIn(fresh, { exec: execFresh })
  assert.equal(result.run, 1, '(c) [M3] a block stamped with the base\'s own prefix launches')
  assert.equal(pythonCalls(execFresh).length, 1, '(c) [M3] and compiles')
  fresh.cleanup()
}

// ── d. [M4] BASE fact lines ride the result and the render; none means none ──
{
  const fact = 'BASE fact: task 1 deletes `pkg/old.py` — 2576 lines, 93 test cases, 6 section banners: "THE PUBLISH FOLD"'
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo, compiler: answer(`PLAN OK\n${fact}\n`) }) })
  const result = await launchIn(ws, { exec })
  assert.deepEqual(result.baseFacts, [fact], '(d) [M4] the fact rides the result')
  const lines = renderLaunch(result).split('\n')
  assert.equal(lines[lines.length - 1], fact, '(d) [M4] and the render prints it last')
  assert.ok(!lines.includes('PLAN OK'), '(d) [M4] the verdict line itself is not printed')
  ws.cleanup()

  const quiet = workspace()
  const execQuiet = makeExec({ rules: readRules({ repo: quiet.repo }) })
  const plain = await launchIn(quiet, { exec: execQuiet })
  assert.deepEqual(plain.baseFacts, [], '(d) [M4] a compile that prints no fact leaves baseFacts empty')
  assert.ok(!renderLaunch(plain).includes('BASE fact'), '(d) [M4] and the render as it was')
  quiet.cleanup()
}

// ── e. [Produces] ──
{
  assert.equal(typeof launchModule.verifyPlanCompiles, 'function',
    '(e) [Produces] fleet/launch.mjs produces verifyPlanCompiles({ exec, repoDir, base, planPath, planText })')
}

console.log('ALL TESTS PASSED')
