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
import { Refusal } from '../lobby.mjs'
import { launchRules, launchWorkspace, makeExec, thrown } from './_lobby_helpers.mjs'

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
  const EVIDENCE = 'ops/evidence'
  const CAPPED = { cpu: '6', memory: '8GB', evidence: EVIDENCE }
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

  // The evidence repository's URL goes to its own bare; every other github.com
  // URL, and `origin`, to the target's. No engine rule: the refusal comes first.
  const ws = launchWorkspace({
    prefix: 'fleet-launch-probe-runners-',
    originUrl: ORIGIN_URL,
    seed: { 'README.md': '# target\n', 'src/a.rs': 'fn main() {}\n' },
    evidence: EVIDENCE,
    plan: null
  })
  const { repo } = ws
  fs.mkdirSync(path.join(repo.dir, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(repo.dir, 'plans', 'a-plan.md'), PLAN)

  const exec = makeExec({ rules: launchRules({ repo, evidence: ws.evidence, gh: GH, compiled: COMPILED }) })

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

  ws.cleanup()
}

console.log('ALL TESTS PASSED')
