/**
 * fleet/tests/test_launch_hold.mjs — the laptop half of "`--hold` on the launch
 * line rides the assignment as `hold=1`": the launcher's new `--hold` flag, the
 * last key of the assignment comment, and the refusal a `--hold=<value>`
 * spelling earns before anything is read or issued.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] a green launch with `--hold`, `--tier mostCapable` and
 *       `--implementer-effort low` yields a comment ending
 *       `tier=mostCapable effort=low hold=1`; one with `--hold` and
 *       `--tier mostCapable` and no effort flag yields a comment ending
 *       `tier=mostCapable hold=1`; one with `--hold` and neither yields a
 *       comment equal to the five required keys then ` hold=1`; and in each the
 *       `new` line carries that comment quoted once and under 200 bytes;
 *   (b) [M1] a launch without `--hold` yields a comment byte-equal to
 *       `run=1 plan=<sha> target=<t> base=<base> engine=<engine> overlap=fold
 *       tier=mostCapable` for the flags `--overlap fold --tier mostCapable`,
 *       with no `hold=` in it;
 *   (c) [M1] `[...COMMENT_KEYS]` deep-equals the nine names in order, and
 *       `USAGE` contains `[--hold]`;
 *   (d) [M2] a launch with `--hold=1` and a plan path that does not exist
 *       throws a `Refusal` whose message contains `--hold takes no value` and
 *       not `cannot read plan`, and the seam's `exec.calls` is exactly empty —
 *       no `git`, no `ssh`, nothing;
 *   (e) the sim prints `ALL TESTS PASSED`.
 *
 * Nothing here opens a network socket: every `ssh` goes through the injected
 * exec seam, and the target is a real local repository with a real bare origin,
 * so the plan push is a real push and `plan=` is a sha git made.
 *
 * The target is spelled `o/r` on purpose — the same reason
 * `test_launch_effort.mjs` gives: the five required keys plus `overlap=`,
 * `tier=` and `effort=` already crowd the 200-byte ceiling for a realistic
 * target, and a three-character target leaves the room `hold=1` needs.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { USAGE, launch } from '../launch.mjs'
import { COMMENT_KEYS, COMMENT_MAX_BYTES, FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

/** Short on purpose — see the header note on the 200-byte ceiling. */
const TARGET = 'o/r'
const GH = 'gh-o-r'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-05T10:00:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
const CONFIG = { ...FLEET_DEFAULTS }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

/** The comment's keys, in contract order, once `hold` is the ninth. */
const NINE_KEYS = [
  'run', 'plan', 'target', 'base', 'engine', 'overlap', 'tier', 'effort', 'hold'
]

// ── The seam's rules — the same shape `test_launch_effort.mjs` uses ─────────

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The launcher's `origin` is spelled as a real target's; the seam points it at
 *  the bare repository this exam really made and runs the command for real. */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec(
    'git',
    argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a)),
    options ?? {}
  )
})

const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })

const rulesFor = (repo) => [
  localRemote(repo),
  sshRule('integrations list --json', answer([
    { name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }
  ])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  {
    when: (cmd, argv) => cmd === 'git' &&
      argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
    answer: OFFLINE
  },
  {
    when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
    answer: OFFLINE
  }
]

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace () {
  const root = tempDir('fleet-launch-hold-')
  const repo = makeTargetRepo({ root, files: { 'README.md': '# target\n' } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  /** A path inside the workspace that no file occupies. */
  const missingPlanPath = path.join(planDir, 'no-such-plan.md')
  return { root, repo, planPath, missingPlanPath, cleanup: () => cleanup(root) }
}

const argvFor = (ws, extra = [], plan = ws.planPath) => [
  plan, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]

/** One launch through the seam; answers the result and the seam that saw it. */
async function launchIn (ws, extra = []) {
  const exec = makeExec({ rules: rulesFor(ws.repo) })
  const result = await launch({
    argv: argvFor(ws, extra),
    exec,
    config: CONFIG,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true })
  })
  return { result, exec }
}

/** The same launch, expecting a refusal; answers the error and the seam. */
async function refusalIn (ws, extra = [], plan = ws.planPath) {
  const exec = makeExec({ rules: rulesFor(ws.repo) })
  const error = await thrown(() => launch({
    argv: argvFor(ws, extra, plan),
    exec,
    config: CONFIG,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true })
  }))
  return { error, exec }
}

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))

/** How many times `needle` occurs in `text`. */
const occurrences = (text, needle) => text.split(needle).length - 1

/**
 * The three shared checks every green `--hold` launch owes leg (a): exactly one
 * `new`, that comment on it quoted once, and the comment inside the ceiling.
 */
function pinsTheNewLine (exec, comment, label) {
  assert.equal(
    newLines(exec).length, 1,
    `(a) [M1] ${label} is a green launch: exactly one \`new\``
  )
  const line = newLines(exec)[0]
  assert.ok(
    line.includes(`--comment '${comment}'`),
    `(a) [M1] ${label}: the \`new\` line carries that comment, quoted; got:\n${line}`
  )
  assert.equal(
    occurrences(line, comment), 1,
    `(a) [M1] ${label}: the comment appears on the \`new\` line exactly once; got:\n${line}`
  )
  assert.ok(
    Buffer.byteLength(comment, 'utf8') < 200,
    `(a) [M1] ${label}: the comment is under 200 bytes, got ${Buffer.byteLength(comment, 'utf8')}`
  )
  assert.ok(
    Buffer.byteLength(comment, 'utf8') <= COMMENT_MAX_BYTES,
    `(a) [M1] ${label}: and inside the ${COMMENT_MAX_BYTES}-byte ceiling`
  )
}

// ── a. [M1] `hold=1` is the comment's last key ──────────────────────────────
{
  // With `--tier mostCapable` and `--implementer-effort low`: `hold=1` comes
  // after `effort=`, and the whole comment is pinned by equality.
  {
    const ws = workspace()
    const { result, exec } = await launchIn(
      ws, ['--hold', '--tier', 'mostCapable', '--implementer-effort', 'low']
    )
    const expected =
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}` +
      ' tier=mostCapable effort=low hold=1'
    assert.equal(
      result.comment, expected,
      '(a) [M1] --hold with --tier mostCapable and --implementer-effort low writes hold=1 as the last key, after effort='
    )
    assert.ok(
      result.comment.endsWith(' tier=mostCapable effort=low hold=1'),
      '(a) [M1] and the comment ends tier=mostCapable effort=low hold=1'
    )
    pinsTheNewLine(exec, expected, '--hold with --tier and --implementer-effort')
    ws.cleanup()
  }

  // With `--tier mostCapable` and no effort flag: `hold=1` comes after `tier=`.
  {
    const ws = workspace()
    const { result, exec } = await launchIn(ws, ['--hold', '--tier', 'mostCapable'])
    const expected =
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}` +
      ' tier=mostCapable hold=1'
    assert.equal(
      result.comment, expected,
      '(a) [M1] --hold with --tier mostCapable and no effort flag writes hold=1 directly after tier='
    )
    assert.ok(
      result.comment.endsWith(' tier=mostCapable hold=1'),
      '(a) [M1] and the comment ends tier=mostCapable hold=1'
    )
    assert.ok(
      !result.comment.includes('effort='),
      '(a) [M1] with no effort flag there is no effort= key to sit before hold=1'
    )
    pinsTheNewLine(exec, expected, '--hold with --tier only')
    ws.cleanup()
  }

  // With neither: the comment is the five required keys, then ` hold=1`.
  {
    const ws = workspace()
    const { result, exec } = await launchIn(ws, ['--hold'])
    const required =
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}`
    const expected = `${required} hold=1`
    assert.equal(
      result.comment, expected,
      '(a) [M1] --hold with neither --tier nor --implementer-effort writes the five required keys then hold=1'
    )
    assert.ok(
      result.comment.endsWith(`engine=${ENGINE} hold=1`),
      '(a) [M1] and the comment ends engine=<sha> hold=1 — directly after engine='
    )
    pinsTheNewLine(exec, expected, '--hold with neither optional flag')
    ws.cleanup()
  }
}

// ── b. [M1] without the flag, BASE's comment, byte for byte ─────────────────
{
  const ws = workspace()
  const { result } = await launchIn(ws, ['--overlap', 'fold', '--tier', 'mostCapable'])
  assert.equal(
    result.comment,
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}` +
    ' overlap=fold tier=mostCapable',
    "(b) [M1] no --hold: the comment is BASE's for the same launch, byte for byte"
  )
  assert.ok(
    !result.comment.includes('hold='),
    '(b) [M1] and it carries no hold= key at all'
  )
  ws.cleanup()
}

// ── c. [M1] the two source-level halves: the keys and the usage string ──────
{
  assert.deepEqual(
    [...COMMENT_KEYS], NINE_KEYS,
    `(c) [M1] COMMENT_KEYS in fleet/lobby.mjs is exactly ${NINE_KEYS.join(', ')}, in that order`
  )
  assert.ok(
    USAGE.includes('[--hold]'),
    `(c) [M1] the launcher's usage string names [--hold]; got:\n${USAGE}`
  )
}

// ── d. [M2] `--hold=<value>` is a refusal, before the plan and before exec ──
{
  const ws = workspace()
  assert.ok(
    !fs.existsSync(ws.missingPlanPath),
    '(d) [M2] the plan path this leg passes does not exist'
  )
  const { error, exec } = await refusalIn(ws, ['--hold=1'], ws.missingPlanPath)
  assert.ok(error, '(d) [M2] --hold=1 must refuse')
  assert.ok(
    error instanceof Refusal,
    `(d) [M2] --hold=1 is a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.ok(
    error.message.includes('--hold takes no value'),
    `(d) [M2] the refusal names the bare flag — "--hold takes no value"; got: ${error.message}`
  )
  assert.ok(
    !error.message.includes('cannot read plan'),
    `(d) [M2] and it is made before the plan file is read, so it is not the cannot-read-plan refusal; got: ${error.message}`
  )
  assert.deepEqual(
    exec.calls, [],
    `(d) [M2] and before any command is issued — no git, no ssh, nothing; got: ${JSON.stringify(exec.calls.map((c) => c.line))}`
  )
  ws.cleanup()
}

// ── e. the sentinel ─────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
