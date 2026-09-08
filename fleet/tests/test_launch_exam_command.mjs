/**
 * fleet/tests/test_launch_exam_command.mjs — the launcher half of task 4
 * (#716): a backticked or non-command `**Exam command:**` line is refused by
 * the launcher, not only by the compiler.
 *
 * The exam is written against the task's Machine clause M4 and its Proof leg
 * (d), and each assertion names both:
 *
 *   (d) [M4] a plan whose header `**Exam command:**` value carries a backtick,
 *       or a word outside the command-word class, is a `Refusal` with
 *       `exitCode` 2 whose message carries `**Exam command:**` and the value —
 *       raised before any `ssh` and before any `git push`, so `exec.mutating()`
 *       is `[]` and the origin carries no `ultra/` ref; and a plan whose value
 *       is `node {paths}` launches with `result.run` 1, as at BASE.
 *
 * The command-word class itself is the shared literal of the two halves —
 * `EXAM_RUNNER_WORD`, this task's Produces, exported from `fleet/launch.mjs`
 * and written `EXAM_RUNNER_WORD = re.compile(r"^[A-Za-z0-9_.+/=:@,-]+$")` in
 * `skills/ultrapowers/scripts/compile_plan.py`. It is read here through a
 * namespace import, so a launcher that has not grown it yet fails an assertion
 * rather than a module link.
 *
 * Nothing here opens a network socket: every `ssh` goes through the injected
 * exec seam, the target is a real local repository with a bare origin behind
 * it, and the credential seam is a spy — no keychain is read. The scaffolding
 * is `fleet/tests/test_launch.mjs`'s, copied.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launcher from '../launch.mjs'
import {
  FLEET_DEFAULTS,
  Refusal,
  defaultExec
} from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const { launch } = launcher

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
/** The seed: a README, and a `pytest.ini` so the tree at `--base` has a test
 *  command a launch can detect. */
const SEED = { 'README.md': '# target\n', 'pytest.ini': '[pytest]\n' }
const CONFIG = { ...FLEET_DEFAULTS }
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

// ── The seam's rules, copied from test_launch.mjs ───────────────────────────

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

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
  `Command: ${verb}`,
  '',
  'Options:',
  ...flags.map((flag) => `  ${flag}  what ${flag} does`),
  ''
].join('\n')

const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = VERBS.verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}

const readRules = ({ repo } = {}) => [
  ...(repo ? [localRemote(repo)] : []),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json',
    answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ────────────

/** A plan whose header carries `value` on its `**Exam command:**` line, above
 *  one task — the line under test is a PLAN-level header line. */
const planWith = (value) => [
  '# Plan: an exam command',
  '',
  `**Exam command:** ${value}`,
  '',
  '### Task 1: Sample',
  '',
  '**Type:** implementation',
  '',
  'One task, and a trailing newline.',
  ''
].join('\n')

/** The same plan with no `**Exam command:**` line at all. */
const PLAN_WITHOUT = [
  '# Plan: no exam command',
  '',
  '### Task 1: Sample',
  '',
  '**Type:** implementation',
  '',
  'One task, and a trailing newline.',
  ''
].join('\n')

function workspace (planText) {
  const root = tempDir('fleet-launch-exam-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, planText)
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

const argvFor = (ws) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE
]

/** The credential seam, so no keychain is read. */
const refreshSpy = () => {
  const spy = (account) => {
    spy.calls.push({ account })
    return { ok: true }
  }
  spy.calls = []
  return spy
}

const launchIn = (ws, exec) => launch({
  argv: argvFor(ws),
  exec,
  config: CONFIG,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: refreshSpy()
})

const sshCalls = (exec) => exec.calls.filter((c) => c.cmd === 'ssh').map((c) => c.line)
const pushCalls = (exec) =>
  exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push')).map((c) => c.line)

// ── (d) [M4] the three refused values ───────────────────────────────────────
{
  const refused = [
    {
      why: 'a backticked template — the value #716 finding 2 met, which reached ' +
        '`--validate-knobs` as a runner literally named with a leading backtick',
      value: '`python3 -m pytest {paths}`',
      backtick: true
    },
    {
      why: 'a command substitution in the first word: `$(which` is not what runs the suite',
      value: '$(which node) {paths}',
      word: '$(which'
    },
    {
      why: 'a `;` — the template is one runner and its arguments, never two commands',
      value: 'node {paths}; rm -rf ~',
      word: '{paths};'
    }
  ]

  for (const kase of refused) {
    const ws = workspace(planWith(kase.value))
    const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
    const error = await thrown(() => launchIn(ws, exec))

    assert.ok(error, `(d) [M4] ${kase.why}: the launch must refuse`)
    assert.ok(
      error instanceof Refusal,
      `(d) [M4] ${kase.why}: it is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.equal(error.exitCode, 2, `(d) [M4] ${kase.why}: with exitCode 2`)
    assert.ok(
      String(error.message).startsWith('launch: '),
      `(d) [M4] ${kase.why}: every launcher refusal message begins \`launch: \`, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes('**Exam command:**'),
      `(d) [M4] ${kase.why}: the message names the line it read, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes(kase.value),
      `(d) [M4] ${kase.why}: and carries the value ${JSON.stringify(kase.value)}, got ${JSON.stringify(error.message)}`
    )
    if (kase.backtick) {
      // Where the sandbox already has words for this refusal the launcher
      // quotes them: `compile_plan.py`'s backtick note, verbatim.
      assert.ok(
        error.message.includes(
          "; the driver's shell reads it as a command substitution (run-74)"
        ),
        `(d) [M4] ${kase.why}: quoting the compiler's own backtick note verbatim, got ${JSON.stringify(error.message)}`
      )
    } else {
      assert.ok(
        error.message.includes(`${kase.word} is not a command word`),
        `(d) [M4] ${kase.why}: naming the first offending word ${JSON.stringify(kase.word)}, got ${JSON.stringify(error.message)}`
      )
    }

    assert.deepEqual(
      sshCalls(exec), [],
      `(d) [M4] ${kase.why}: refused before any ssh`
    )
    assert.deepEqual(
      pushCalls(exec), [],
      `(d) [M4] ${kase.why}: and before any git push`
    )
    assert.deepEqual(
      exec.mutating(), [],
      `(d) [M4] ${kase.why}: so nothing on exe.dev is mutated`
    )
    assert.ok(
      Object.keys(branchesOf(ws)).every((ref) => !ref.startsWith('ultra/')),
      `(d) [M4] ${kase.why}: and the origin carries no ultra/ ref`
    )
    ws.cleanup()
  }
}

// ── (d) [M4] and the well-formed value launches, as at BASE ─────────────────
{
  const ws = workspace(planWith('node {paths}'))
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, exec)
  assert.equal(
    result.run, 1,
    '(d) [M4] `**Exam command:** node {paths}` is a runner and its arguments: the launch goes through, and an origin with no ultra/ ref is run 1'
  )
  assert.equal(
    exec.mutating().length, 1,
    '(d) [M4] with BASE\'s one mutating lobby verb'
  )
  ws.cleanup()

  const silent = workspace(PLAN_WITHOUT)
  const execSilent = makeExec({ rules: readRules({ repo: silent.repo }) })
  const quiet = await launchIn(silent, execSilent)
  assert.equal(
    quiet.run, 1,
    '(d) [M4] and a plan carrying no `**Exam command:**` line launches exactly as at BASE'
  )
  silent.cleanup()
}

// ── (d) [M4] the shared literal: `EXAM_RUNNER_WORD`, this task's Produces ───
{
  const exported = launcher.EXAM_RUNNER_WORD
  assert.ok(
    exported !== undefined,
    '(d) [M4] fleet/launch.mjs exports EXAM_RUNNER_WORD — the command-word class the compiler half shares'
  )
  const source = typeof exported === 'string' ? exported : exported.source
  assert.equal(
    source, '^[A-Za-z0-9_.+/=:@,-]+$',
    '(d) [M4] and it is the class the task spells, character for character'
  )
  const word = new RegExp(source)
  // What a runner and its flags are spelled with.
  for (const ok of [
    'node', 'python3', 'go', 'test', '-q', '-m', '--tb=short',
    './node_modules/.bin/vitest', './...', 'pkg:test', 'a,b', 'a+b', 'user@host'
  ]) {
    assert.ok(word.test(ok), `(d) [M4] ${JSON.stringify(ok)} is a command word`)
  }
  // Every shell operator, quote and expansion character is outside it.
  for (const bad of [
    '$(which', "'npx'", '"npx"', '$(x)', '|', '2>&1', '>out', 'a&b', 'a;b',
    '{paths};', '*', '?', '!', '#', 'a\\b', '`x`'
  ]) {
    assert.ok(
      !word.test(bad),
      `(d) [M4] ${JSON.stringify(bad)} carries a shell operator, a quote or an expansion character and is not a command word`
    )
  }
}

console.log('ALL TESTS PASSED')
