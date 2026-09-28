/**
 * fleet/tests/test_launch_probe_runners.mjs — the launcher refuses a plan whose
 * `Run:` probe or `Check:` line calls a program the sandbox does not have,
 * before anything is pushed (#645, the 2026-09-22 plan).
 *
 * Three pure exports of `fleet/toolchain.mjs` and one launch:
 *
 *   (a) [M1] `probeWordsOf(line)` answers the command words of one shell
 *       line — the two example lines the plan pins, a regex alternation inside
 *       quotes (one program, not two), and a `$(…)` inside double quotes.
 *   (b) [M2] `SANDBOX_TOOLCHAIN` is frozen, carries the words the plan names
 *       and no duplicate; `toolchainViolations(compiled)` answers `1:cargo`,
 *       `2:go`, `check:make` in that order over the plan's fixture, and `[]`
 *       over a plan whose probes only use toolchain words.
 *   (c) [M3] a launch of a plan whose one task carries `proofRuns: ["cargo
 *       test"]` throws a `Refusal` (exit 2) whose message names `task 1`,
 *       `'cargo'` and the line, and the recorded exec calls carry no `git
 *       push`, no `ssh exe.dev new` and no `billing plan` — nothing was
 *       pushed and no lobby verb was issued.
 *
 * Hermetic in the shape of `test_launch_plan_path.mjs`: a stubbed lobby
 * (`makeExec`), a real temporary target with a bare origin (`makeTargetRepo`),
 * the compiler's fetch and every `python3` run stubbed. Imports only
 * `./_helpers.mjs` and `./_lobby_helpers.mjs` — a sim may not name a sibling
 * sim.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import * as launchModule from '../launch.mjs'
import { probeWordsOf, toolchainViolations, SANDBOX_TOOLCHAIN } from '../toolchain.mjs'
import { Refusal, defaultExec } from '../lobby.mjs'
import { simEnv } from './_helpers.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmsPayload
} from './_lobby_helpers.mjs'

const { launch } = launchModule

const isFunction = (leg, name, value) => assert.equal(
  typeof value, 'function',
  `${leg} \`${name}\` must be exported by ${name === 'launch' ? 'fleet/launch.mjs' : 'fleet/toolchain.mjs'} — the task's Produces: names it`
)

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] probeWordsOf
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(a) [M1]', 'probeWordsOf', probeWordsOf)
  assert.deepEqual(
    probeWordsOf('out=$(python3 x.py 2>&1); rc=$?; test $rc -eq 2 && ! echo "$out" | grep -q "PLAN OK"'),
    ['python3', 'grep'],
    '(a) [M1] the first example: an assignment, a substitution, test, !, echo and a pipe'
  )
  assert.deepEqual(
    probeWordsOf('for p in a b; do node --check $p || exit 1; done | tr a b'),
    ['node', 'tr'],
    '(a) [M1] the second example: a for loop, do, ||, exit, done and a pipe'
  )
  assert.deepEqual(
    probeWordsOf('! grep -rnwE "a|b" factory | grep .'),
    ['grep', 'grep'],
    '(a) [M1] an alternation inside double quotes splits nothing'
  )
  assert.deepEqual(
    probeWordsOf('test "$(wc -l < f)" -eq 4 && echo "$(cargo --version)"'),
    ['wc', 'cargo'],
    '(a) [M1] a $( … ) inside double quotes still opens a command position'
  )
  assert.deepEqual(
    probeWordsOf('bash hooks/session_start.sh >/dev/null && python3 skills/x.py'),
    ['bash', 'python3'],
    '(a) [M1] a path argument is not a command word; a redirection is not one either'
  )
  assert.deepEqual(probeWordsOf(''), [], '(a) [M1] an empty line answers []')
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] SANDBOX_TOOLCHAIN and toolchainViolations
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(b) [M2]', 'toolchainViolations', toolchainViolations)
  assert.ok(Array.isArray(SANDBOX_TOOLCHAIN) && Object.isFrozen(SANDBOX_TOOLCHAIN),
    '(b) [M2] SANDBOX_TOOLCHAIN is a frozen array')
  const need = ['node', 'npm', 'npx', 'bun', 'bunx', 'celld', 'python3', 'pytest', 'git', 'gh', 'jq',
    'curl', 'bash', 'sh', 'env', 'timeout', 'xargs', 'find', 'grep', 'sed', 'awk', 'tr', 'cut',
    'sort', 'uniq', 'head', 'tail', 'wc', 'cat', 'tee', 'diff', 'cmp', 'comm', 'paste', 'seq',
    'expr', 'date', 'sleep', 'basename', 'dirname', 'readlink', 'realpath', 'mkdir', 'rmdir',
    'rm', 'cp', 'mv', 'ln', 'ls', 'touch', 'chmod', 'tar', 'gzip', 'unzip', 'sudo', 'install']
  const missing = need.filter((w) => !SANDBOX_TOOLCHAIN.includes(w))
  assert.deepEqual(missing, [], `(b) [M2] the toolchain carries every named word; missing: ${missing}`)
  assert.equal(new Set(SANDBOX_TOOLCHAIN).size, SANDBOX_TOOLCHAIN.length,
    '(b) [M2] no duplicate in the toolchain')

  const fixture = {
    waves: [
      [{ id: '1', proofRuns: ['cargo test', 'node a.mjs && bun test'] }],
      [{ id: '2', proofRuns: ['go test ./...'] }]
    ],
    payload: { checks: [{ cmd: '! grep -rn foo src | grep .' }, { cmd: 'make lint' }] }
  }
  const v = toolchainViolations(fixture)
  assert.deepEqual(
    v.map((x) => `${x.task}:${x.word}`), ['1:cargo', '2:go', 'check:make'],
    '(b) [M2] one violation per (task, word), in document order, checks as task `check`'
  )
  assert.deepEqual(v[0], { task: '1', word: 'cargo', cmd: 'cargo test' },
    '(b) [M2] a violation carries task, word and the offending line')
  assert.deepEqual(
    toolchainViolations({
      waves: [[{ id: '1', proofRuns: ['node --check a.mjs', 'python3 -m pytest -q tests/x.py'] }]],
      payload: { checks: [{ cmd: 'git diff --quiet $ULTRA_BASE -- fleet' }] }
    }),
    [],
    '(b) [M2] a plan whose probes and checks use only toolchain words answers []'
  )
  assert.deepEqual(toolchainViolations({}), [], '(b) [M2] no waves, no checks: []')
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the launch refuses before the push and before any lobby verb
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(c) [M3]', 'launch', launch)
  const TARGET = 'acme/widgets'
  const GH = 'gh-acme-widgets'
  const ORIGIN_URL = `https://github.com/${TARGET}.git`
  const ENGINE = 'd'.repeat(40)
  const NOW = new Date('2026-09-22T12:00:00.000Z')
  const CAPPED = { cpu: '6', memory: '8GB' }
  const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
  const PLAN = '# a plan\n\nOne plan whose probe runs cargo.\n'

  // The compiled plan the stubbed parser answers: one task, one probe the
  // sandbox cannot run.
  const COMPILED = {
    launch_waves: [[{
      id: '1', title: 'task 1', files: ['src/a.rs'], depends_on: [],
      proofRuns: ['cargo test'], proofRunClauses: [['M1']], interfaces: { consumes: [], produces: [] }
    }]],
    dag_edges: [], pairs: [], checks: [], bootstrapCmd: null
  }

  const COMPILER_FETCH = {
    when: (cmd, argv) => cmd === 'gh' && argv[0] === 'api' &&
      argv.some((a) => /contents\/skills\/ultrapowers\/scripts\/plan_(check|parse)\.py/.test(String(a))),
    answer: answer('# plan_check.py or plan_parse.py, as the seam hands it back\n')
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
    answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), { ...(options ?? {}), env: simEnv() })
  })
  const OFFLINE = answer('', { code: 128, stderr: 'sim: this sim opens no network socket\n' })
  const compilerRule = {
    when: (cmd) => cmd === 'python3',
    answer: (cmd, argv) =>
      argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(COMPILED))
  }
  const HELP_OK = (cmd, argv) => answer(`Command: ${String(argv[1] ?? '').slice('help '.length)}\n\nOptions:\n`)
  const NEW_OK = (cmd, argv) =>
    answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

  const root = tempDir('fleet-launch-probe-runners-')
  const repo = makeTargetRepo({ root, files: { 'README.md': '# target\n', 'src/a.rs': 'fn main() {}\n' } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  fs.mkdirSync(path.join(repo.dir, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(repo.dir, 'plans', 'a-plan.md'), PLAN)

  const exec = makeExec({
    rules: [
      COMPILER_FETCH,
      localRemote(repo),
      compilerRule,
      sshRule('help ', HELP_OK),
      sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
      sshRule('billing plan --json', answer(BILLING_OK)),
      sshRule("ls '", vmsPayload([])),
      sshRule('new ', NEW_OK),
      cmdRule('gh', 'api', answer('')),
      { when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull'), answer: OFFLINE },
      { when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))), answer: OFFLINE }
    ]
  })

  const error = await thrown(() => launch({
    argv: ['plans/a-plan.md', '--target', TARGET, '--base', repo.base, '--repo', repo.dir, '--engine', ENGINE],
    exec,
    config: CAPPED,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true }),
    kata: null
  }))

  assert.ok(error instanceof Refusal,
    `(c) [M3] a Refusal. Got: ${error?.name}: ${error?.message}`)
  assert.equal(error.exitCode, 2, `(c) [M3] exit code 2. Got: ${error.exitCode}`)
  assert.equal(
    error.message,
    "launch: task 1: probe runner 'cargo' is not in the sandbox toolchain — cargo test",
    `(c) [M3] the message is one line naming the task, the word and the line. Got: ${JSON.stringify(error.message)}`
  )
  const lines = exec.calls.map((c) => c.line ?? `${c.cmd} ${c.argv.join(' ')}`)
  assert.ok(!exec.calls.some((c) => c.cmd === 'git' && c.argv.includes('push')),
    `(c) [M3] no git push was recorded. Calls: ${JSON.stringify(lines)}`)
  assert.ok(!lines.some((l) => /^ssh exe\.dev new /.test(l)),
    `(c) [M3] no new verb was issued (the launcher's help probes are not verbs). Calls: ${JSON.stringify(lines)}`)
  assert.ok(!lines.some((l) => /^ssh exe\.dev billing plan/.test(l)),
    `(c) [M3] the pool was never read: the refusal comes before it. Calls: ${JSON.stringify(lines)}`)

  cleanup(root)
}

console.log('ALL TESTS PASSED')
