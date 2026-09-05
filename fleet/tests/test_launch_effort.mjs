/**
 * fleet/tests/test_launch_effort.mjs — the laptop half of "a launch flag turns
 * implementer effort down": the launcher's new `--implementer-effort` flag and
 * the assignment comment it writes.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] `node fleet/launch.mjs … --implementer-effort <v>` with `v` one of
 *       `low`, `medium`, `high` writes `effort=<v>` as the LAST key of the
 *       assignment comment, after `tier=` when a tier is present and directly
 *       after `engine=` when it is not; any other value is a refusal naming the
 *       three; a launch without the flag writes the comment BASE's launch
 *       writes, byte for byte; `COMMENT_KEYS` ends with `effort`; and the
 *       launcher's `USAGE` names `--implementer-effort low|medium|high`;
 *   (m4) [M4] `fleet/CONTRACT.md`'s Comment sentence lists
 *       `effort=low|medium|high` as the third optional key, directly after
 *       `tier=standard|mostCapable` — the same four lines, joined, that the
 *       Proof's `grep -A3 '^- \*\*Comment\*\*'` bullet reads.
 *
 * Nothing here opens a network socket: every `ssh` goes through the injected
 * exec seam, and the target is a real local repository with a real bare origin,
 * so the plan push is a real push and `plan=` is a sha git made.
 *
 * The target is spelled `o/r` on purpose. `run=1 plan=<40-hex> target=<t>
 * base=<40-hex> engine=<40-hex> overlap=fold tier=mostCapable` is already 200
 * bytes — the whole ceiling — for an 18-character target, so a target of that
 * length leaves no room for `effort=` at all and every green launch below would
 * be the launcher's byte-ceiling refusal rather than the leg it is testing. A
 * three-character target leaves the room the leg needs.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE, launch } from '../launch.mjs'
import {
  COMMENT_KEYS,
  COMMENT_MAX_BYTES,
  FLEET_DEFAULTS,
  Refusal,
  defaultExec
} from '../lobby.mjs'
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

/** The three values the knob offers, in the order the refusal has to name. */
const EFFORTS = ['low', 'medium', 'high']

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── The seam's rules — the same shape `test_launch.mjs` uses ────────────────

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
  const root = tempDir('fleet-launch-effort-')
  const repo = makeTargetRepo({ root, files: { 'README.md': '# target\n' } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
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
async function refusalIn (ws, extra = []) {
  const exec = makeExec({ rules: rulesFor(ws.repo) })
  const error = await thrown(() => launch({
    argv: argvFor(ws, extra),
    exec,
    config: CONFIG,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true })
  }))
  return { error, exec }
}

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))

// ── a. [M1] `effort=` is the comment's last key ─────────────────────────────
{
  // With `--tier mostCapable`: `effort=<v>` comes after `tier=`, and the whole
  // comment is pinned by equality, not by containment.
  for (const v of EFFORTS) {
    const ws = workspace()
    const { result, exec } = await launchIn(ws, ['--tier', 'mostCapable', '--implementer-effort', v])
    const expected =
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}` +
      ` tier=mostCapable effort=${v}`
    assert.equal(
      result.comment, expected,
      `(a) [M1] --implementer-effort ${v} with --tier mostCapable writes effort=${v} as the last key, after tier=`
    )
    assert.ok(
      result.comment.endsWith(` tier=mostCapable effort=${v}`),
      `(a) [M1] and the comment ends tier=mostCapable effort=${v}`
    )
    assert.equal(
      newLines(exec).length, 1,
      `(a) [M1] --implementer-effort ${v} is a green launch: exactly one \`new\``
    )
    assert.ok(
      newLines(exec)[0].includes(`--comment '${expected}'`),
      '(a) [M1] and the `new` line carries that comment, quoted once'
    )
    assert.ok(
      Buffer.byteLength(result.comment, 'utf8') <= COMMENT_MAX_BYTES,
      `(a) [M1] inside the ${COMMENT_MAX_BYTES}-byte ceiling`
    )
    ws.cleanup()
  }

  // Without `--tier`: `effort=` follows `engine=` directly — it is last among
  // the keys present, not pinned to a position tier= would have held.
  {
    const ws = workspace()
    const { result } = await launchIn(ws, ['--implementer-effort', 'low'])
    assert.equal(
      result.comment,
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE} effort=low`,
      '(a) [M1] --implementer-effort low with no --tier writes effort=low directly after engine='
    )
    assert.ok(
      result.comment.endsWith(`engine=${ENGINE} effort=low`),
      '(a) [M1] and the comment ends engine=<sha> effort=low'
    )
    ws.cleanup()
  }

  // The refusal: any value outside the three, naming all three.
  for (const bad of ['xhigh', 'max', 'LOW']) {
    const ws = workspace()
    const { error, exec } = await refusalIn(ws, ['--implementer-effort', bad])
    assert.ok(error, `(a) [M1] --implementer-effort ${JSON.stringify(bad)} must refuse`)
    assert.ok(
      error instanceof Refusal,
      `(a) [M1] --implementer-effort ${JSON.stringify(bad)} is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.equal(
      error.exitCode, 2,
      `(a) [M1] --implementer-effort ${JSON.stringify(bad)} refuses with exit 2`
    )
    for (const v of EFFORTS) {
      assert.ok(
        error.message.includes(v),
        `(a) [M1] the refusal names ${v}; got: ${error.message}`
      )
    }
    assert.deepEqual(
      exec.mutating(), [],
      `(a) [M1] --implementer-effort ${JSON.stringify(bad)} mutates nothing on exe.dev`
    )
    ws.cleanup()
  }

  // Without the flag: the comment BASE's launch writes, byte for byte — both
  // with the optional keys and without them.
  {
    const ws = workspace()
    const { result } = await launchIn(ws, ['--overlap', 'fold', '--tier', 'mostCapable'])
    assert.equal(
      result.comment,
      `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}` +
      ' overlap=fold tier=mostCapable',
      "(a) [M1] no flag: the comment is BASE's, ending tier=mostCapable with no effort= at all"
    )
    ws.cleanup()

    const bare = workspace()
    const { result: bareResult } = await launchIn(bare)
    assert.equal(
      bareResult.comment,
      `run=1 plan=${bareResult.plan} target=${TARGET} base=${bare.repo.base} engine=${ENGINE}`,
      '(a) [M1] and a launch with neither optional key carries the five required keys and nothing else'
    )
    assert.ok(
      !bareResult.comment.includes('effort='),
      '(a) [M1] no flag, no effort= key — the default is unchanged'
    )
    bare.cleanup()
  }

  // The two source-level halves of M1.
  assert.equal(
    COMMENT_KEYS[COMMENT_KEYS.length - 1], 'effort',
    '(a) [M1] COMMENT_KEYS in fleet/lobby.mjs ends with effort'
  )
  assert.deepEqual(
    [...COMMENT_KEYS].slice(0, -1),
    ['run', 'plan', 'target', 'base', 'engine', 'overlap', 'tier'],
    "(a) [M1] and the keys before it are BASE's seven, in contract order"
  )
  assert.ok(
    USAGE.includes('--implementer-effort low|medium|high'),
    `(a) [M1] the launcher's usage string names --implementer-effort low|medium|high; got:\n${USAGE}`
  )
}

// ── m4. [M4] the contract's Comment sentence ────────────────────────────────
{
  // The Proof's Run: bullet reads the Comment bullet and its three continuation
  // lines, wrapped joined: `grep -A3 '^- \*\*Comment\*\*' … | tr '\n' ' '`.
  // The same four lines, joined the same way, are read here.
  const contract = fs.readFileSync(path.join(FLEET_DIR, 'CONTRACT.md'), 'utf8').split('\n')
  const at = contract.findIndex((line) => /^- \*\*Comment\*\*/.test(line))
  assert.ok(at >= 0, '(m4) [M4] fleet/CONTRACT.md has a `- **Comment**` bullet')
  const joined = contract.slice(at, at + 4).join(' ')
  assert.match(
    joined,
    /`tier=standard\|mostCapable`,\s+`effort=low\|medium\|high`/,
    '(m4) [M4] the contract lists `effort=low|medium|high` as the third optional key, ' +
    `directly after \`tier=standard|mostCapable\`; got:\n${joined}`
  )
}

console.log('ALL TESTS PASSED')
