/**
 * fleet/tests/test_launch_plan_path.mjs — the exam for "A relative plan path is
 * read from --repo, an absolute one as given, and the refusal names the path
 * that was tried" (#1188).
 *
 * On 2026-09-21 the operator skill's own written procedure — clone the target,
 * copy the plan into the clone, name that relative path with `--repo <clone>`
 * — died on `launch: cannot read plan docs/superpowers/plans/2026-09-21-...:
 * ENOENT`, because the plan is read against the process's working directory
 * while the two `python3` children that later need it run with `cwd: repoDir`.
 * The fix resolves the plan path once, against `repoDir`, and uses that
 * resolved path everywhere downstream: `path.resolve(repoDir, planPath)`
 * leaves an absolute path as it is, and with no `--repo` it resolves against
 * the working directory because that is what `repoDir` then is.
 *
 * A hermetic sim in the shape of `test_launch_one_engine.mjs` and
 * `test_launch_duplicate.mjs`: a stubbed lobby (`makeExec`), a real temporary
 * target repository with a bare origin (`makeTargetRepo`), and the compiler's
 * fetch and every `python3` run stubbed. Copied rather than imported — a sim
 * may not run a sibling sim. It imports only `./_lobby_helpers.mjs` and never
 * chdirs: the sim's own working directory and R already differ, since R is a
 * fresh temp directory.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a relative plan path `plans/a-plan.md`, with `--repo R` naming a
 *       target clone that is not the process's cwd and the plan on disk at
 *       `R/plans/a-plan.md`: the launch resolves with a string `runId`, and
 *       every recorded `python3` call's argv that carries a plan path carries
 *       the absolute `R/plans/a-plan.md` — never the bare relative string.
 *   (b) [M2] `plans/nope.md` with `--repo R`, where no such file exists on
 *       disk anywhere: a `Refusal`, exit 2, naming the absolute `R/plans/
 *       nope.md`, before any command is executed (zero recorded exec calls);
 *       the same plan path with no `--repo` at all names the absolute path
 *       under the process's own working directory instead.
 *   (c) [M3] an absolute plan path under a temp directory outside R, with
 *       `--repo R`: read as it is, and the launch resolves with a string
 *       `runId`.
 *   (d) a plan with a sibling `<stem>.gate-verdicts.json`: the pushed
 *       `ultra/plan-run-<N>` commit carries it as `.ultrapowers/gate-verdicts.json`,
 *       byte for byte — the laptop's authoring census reads it off the plan tag
 *       (run-268 dropped it; runs 269–271 went without, 2026-09-29).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { launch } from '../launch.mjs'
import { Refusal } from '../lobby.mjs'
import {
  BILLING_OK, COMPILER_FETCH, NEW_OK, NO_NETWORK_GIT, NO_REMOTE_OPS, ONE_TASK,
  answer, cleanup, cmdRule, engineRule, gitEnv, localRemote, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmsPayload
} from './_lobby_helpers.mjs'

const TARGET = 'acme/widgets'
const GH = 'gh-acme-widgets'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'd'.repeat(40)
const BASE_40HEX = 'e'.repeat(40)
const NOW = new Date('2026-09-21T12:00:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

// ── The seam's rules (the shared ones live in _lobby_helpers.mjs) ───────────

const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  return answer(`Command: ${verb}\n\nOptions:\n`)
}
const NO_RECORD = answer('')
const recordRule = (res) => cmdRule('gh', 'api', res)

const readRules = ({ repo }) => [
  engineRule(ENGINE),
  COMPILER_FETCH,
  localRemote(repo),
  compilerRule(ONE_TASK),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule("ls '", vmsPayload([])),
  sshRule('new ', NEW_OK),
  recordRule(NO_RECORD),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: one fresh target clone, R, that is never the process's cwd ─

function workspace () {
  const root = tempDir('fleet-launch-plan-path-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  return { root, repo, cleanup: () => cleanup(root) }
}

const launchIn = (ws, { exec, planPath, extra = [] }) => launch({
  argv: [planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE, ...extra],
  exec,
  config: CAPPED,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  kata: null
})

const pythonCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3')

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] a relative plan path resolves against --repo, not the cwd
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  // R (ws.repo.dir) is a fresh temp clone — never the process's own cwd.
  assert.notEqual(path.resolve(ws.repo.dir), path.resolve(process.cwd()),
    '(a) [M1] sanity: R is not the process\'s working directory')

  // The plan lives inside R, at the relative path the launch line names.
  fs.mkdirSync(path.join(ws.repo.dir, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(ws.repo.dir, 'plans', 'a-plan.md'), PLAN)

  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec, planPath: 'plans/a-plan.md' })

  assert.equal(typeof result?.runId, 'string',
    `(a) [M1] the launch resolves with a string runId. Got: ${JSON.stringify(result)}`)

  const resolved = path.join(ws.repo.dir, 'plans/a-plan.md')
  const calls = pythonCalls(exec)
  assert.ok(calls.length >= 1,
    '(a) [M1] the launch ran at least one python3 command (plan_check.py / plan_parse.py). ' +
    `Got: ${JSON.stringify(exec.calls.map((c) => c.line))}`)
  const carryingAPlanPath = calls.filter((c) => c.argv.includes(resolved) || c.argv.includes('plans/a-plan.md'))
  assert.ok(carryingAPlanPath.length >= 1,
    '(a) [M1] at least one python3 call carries a plan path at all. ' +
    `Got argvs: ${JSON.stringify(calls.map((c) => c.argv))}`)
  for (const call of carryingAPlanPath) {
    assert.ok(call.argv.includes(resolved),
      `(a) [M1] every python3 call carrying a plan path carries the absolute ${JSON.stringify(resolved)}. ` +
      `Got argv: ${JSON.stringify(call.argv)}`)
    assert.ok(!call.argv.includes('plans/a-plan.md'),
      `(a) [M1] and never the bare relative string. Got argv: ${JSON.stringify(call.argv)}`)
  }
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the refusal names the absolute path it actually tried, before
//     anything is executed — against --repo when given, else the cwd
// ══════════════════════════════════════════════════════════════════════════
{
  // No rig needed: the plan read fails before the first command runs, so a
  // bare recording exec (answers nothing meaningful) is enough.
  const recordingExec = () => {
    const calls = []
    const exec = async (cmd, argv = [], options) => {
      calls.push({ cmd, argv: [...argv], options })
      return { code: 0, stdout: '', stderr: '' }
    }
    exec.calls = calls
    return exec
  }
  const baseParams = {
    config: CAPPED,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true }),
    kata: null
  }

  // With --repo R: the message names R/plans/nope.md.
  const R = tempDir('fleet-launch-plan-path-nope-')
  const withRepoExec = recordingExec()
  const withRepoError = await thrown(() => launch({
    argv: ['plans/nope.md', '--target', TARGET, '--base', BASE_40HEX, '--repo', R],
    exec: withRepoExec,
    ...baseParams
  }))
  assert.ok(withRepoError instanceof Refusal,
    `(b) [M2] --repo R, no such file: a Refusal. Got: ${withRepoError?.name}: ${withRepoError?.message}`)
  assert.equal(withRepoError.exitCode, 2,
    `(b) [M2] exit code 2. Got: ${withRepoError.exitCode}`)
  const wantedWithRepo = path.join(R, 'plans/nope.md')
  assert.ok(withRepoError.message.includes(wantedWithRepo),
    `(b) [M2] the message names the absolute path ${JSON.stringify(wantedWithRepo)}. ` +
    `Got: ${JSON.stringify(withRepoError.message)}`)
  assert.equal(withRepoExec.calls.length, 0,
    '(b) [M2] nothing was executed before the refusal. ' +
    `Got ${withRepoExec.calls.length} call(s): ${JSON.stringify(withRepoExec.calls)}`)
  cleanup(R)

  // With no --repo at all: the message names <cwd>/plans/nope.md instead.
  const noRepoExec = recordingExec()
  const noRepoError = await thrown(() => launch({
    argv: ['plans/nope.md', '--target', TARGET, '--base', BASE_40HEX],
    exec: noRepoExec,
    ...baseParams
  }))
  assert.ok(noRepoError instanceof Refusal,
    `(b) [M2] no --repo, no such file: a Refusal. Got: ${noRepoError?.name}: ${noRepoError?.message}`)
  assert.equal(noRepoError.exitCode, 2,
    `(b) [M2] exit code 2. Got: ${noRepoError.exitCode}`)
  const wantedNoRepo = path.join(process.cwd(), 'plans/nope.md')
  assert.ok(noRepoError.message.includes(wantedNoRepo),
    `(b) [M2] with no --repo the message names ${JSON.stringify(wantedNoRepo)} instead. ` +
    `Got: ${JSON.stringify(noRepoError.message)}`)
  assert.equal(noRepoExec.calls.length, 0,
    '(b) [M2] and still nothing was executed before the refusal. ' +
    `Got ${noRepoExec.calls.length} call(s): ${JSON.stringify(noRepoExec.calls)}`)
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] an absolute plan path outside R is read as it is
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  const planDir = tempDir('fleet-launch-plan-path-abs-')
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  // Sanity: the absolute plan path sits outside R.
  assert.ok(!planPath.startsWith(path.resolve(ws.repo.dir)),
    '(c) [M3] sanity: the absolute plan path is outside R')

  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec, planPath })

  assert.equal(typeof result?.runId, 'string',
    `(c) [M3] an absolute plan path outside R still resolves with a string runId. Got: ${JSON.stringify(result)}`)

  ws.cleanup()
  cleanup(planDir)
}

// ══════════════════════════════════════════════════════════════════════════
// (d) the gate record beside the plan rides the plan commit
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  fs.mkdirSync(path.join(ws.repo.dir, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(ws.repo.dir, 'plans', 'a-plan.md'), PLAN)
  const RECORD = '{"tasks": {}, "tally": {"dispatched": 0}}\n'
  fs.writeFileSync(path.join(ws.repo.dir, 'plans', 'a-plan.gate-verdicts.json'), RECORD)

  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec, planPath: 'plans/a-plan.md' })
  const n = String(result?.runId ?? '').replace(/^run-/, '')
  const shown = spawnSync('git', ['--git-dir', ws.repo.origin, 'show', `refs/heads/ultra/plan-run-${n}:.ultrapowers/gate-verdicts.json`],
    { encoding: 'utf8', env: gitEnv() })
  assert.equal(shown.status, 0,
    `(d) the pushed plan commit carries .ultrapowers/gate-verdicts.json. git show said: ${shown.stderr}`)
  assert.equal(shown.stdout, RECORD, '(d) and it is the sibling record, byte for byte')

  ws.cleanup()
}

console.log('ALL TESTS PASSED')
