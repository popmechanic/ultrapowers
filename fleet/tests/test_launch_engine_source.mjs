/**
 * fleet/tests/test_launch_engine_source.mjs — the launch line says which engine,
 * and whether it was pinned.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] a launch whose argv carries no `--engine`: `result.engineSource` is
 *       `main-tip`, `result.engine` is the sha the seam answered for
 *       `ls-remote`, and `renderLaunch(result)` carries the line
 *       `engine=<that sha> (main tip; pass --engine <40-hex> to pin)`;
 *   (b) [M2] a launch with `--engine <sha>`: `result.engineSource` is `pinned`,
 *       and `renderLaunch(result)` is unchanged from BASE — see below;
 *   (c) [M3] in both legs the recorded `new` argv's comment carries
 *       `engine=<sha>` followed by a space or the closing quote, never by `(`,
 *       and the `--json` result object carries `engineSource`;
 *   (d) the sim prints `ALL TESTS PASSED`.
 *
 * Leg (b) asserts less than M2 spells, and deliberately. M2 asks that a pinned
 * launch's `renderLaunch(result)` carry a line `engine=<sha> (pinned)`, but
 * `fleet/tests/test_launch.mjs` — frozen at BASE, and the task's own second
 * `Run:` — pins that rendering exactly:
 *
 *     assert.deepEqual(renderLaunch(result).split('\n'),
 *       [result.runId, result.vm, result.statusUrl, result.comment])
 *
 * and its `argvFor` always passes `--engine`, so every launch it renders is a
 * pinned one. A fifth line there is a break, and that exam is nobody's to edit.
 * The two clauses cannot both hold. #636, which authorises the work, asks only
 * for the unpinned case — "the launcher prints `engine=<sha> (main tip; pass
 * --engine to pin)` so it is at least visible" — and a pinned sha is already
 * visible twice over: the operator typed it, and the comment prints it. So the
 * annotation is the tip's alone; `engineSource` still rides the result on both
 * paths, which is the half of M2 that has a reader. Leg (b) pins that: pinned
 * renders BASE's four lines and nothing else.
 *
 * Nothing here opens a network socket. Every command goes through the injected
 * exec seam; the target is a real repository — `makeTargetRepo`'s bare origin
 * and its clone — and the seam points the launcher's own `push`/`ls-remote` at
 * that bare path, so the plan push is a real push. The `ls-remote` the launcher
 * issues for the engine tip is answered with a fixed tip, the same fixture shape
 * `fleet/tests/test_launch.mjs` uses.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launch, renderLaunch } from '../launch.mjs'
import { ENGINE_URL, FLEET_DEFAULTS, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
/** The tip the seam answers for `git ls-remote <ENGINE_URL> HEAD`. */
const MAIN_TIP = 'a1b2c3d4'.repeat(5)
/** A different sha, so a `--engine` leg cannot pass by reading the tip. */
const PINNED = '9f'.repeat(20)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

/** The annotation M1 spells, verbatim. */
const mainTipLine = (sha) => `engine=${sha} (main tip; pass --engine <40-hex> to pin)`

// ── The seam's rules ────────────────────────────────────────────────────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${MAIN_TIP}\tHEAD\n`)
}

/** The target's remote, pointed at the bare repository the exam really made. */
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

/** No socket, whatever else the launcher tries. */
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

const readRules = (repo) => [
  ENGINE_RULE,
  localRemote(repo),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace () {
  const root = tempDir('fleet-launch-engine-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** A green launch; answers the result, the seam and the workspace's repo. */
async function greenLaunch (ws, extra = []) {
  const exec = makeExec({ rules: readRules(ws.repo) })
  const result = await launch({
    argv: [ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, ...extra],
    exec,
    config: CONFIG,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true })
  })
  return { result, exec }
}

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))
/** The single-quoted assignment the `new` line carries, verbatim. */
const commentOf = (line) => /--comment '([^']*)'/.exec(line)?.[1] ?? null

/**
 * [M3] the comment the launcher writes is byte-identical in shape to BASE's:
 * `engine=<sha>` inside the comment, followed by a space or the closing quote,
 * never by `(`.
 */
function assertCommentShape (leg, result, exec, sha) {
  const line = newLines(exec)[0]
  assert.ok(line, `${leg} [M3] the launch issued a \`new\` line`)
  assert.equal(
    (line.match(/'/g) ?? []).length, 2,
    `${leg} [M3] the comment is quoted once — one pair of quotes on the whole line`
  )
  assert.equal(
    commentOf(line), result.comment,
    `${leg} [M3] the comment on the \`new\` line is the result's comment`
  )

  const token = `engine=${sha}`
  const at = line.indexOf(token)
  assert.ok(at >= 0, `${leg} [M3] the comment carries ${token}`)
  const next = line[at + token.length]
  assert.notEqual(
    next, '(',
    `${leg} [M3] ${token} is never followed by \`(\` — the annotation is a rendered line, not part of the comment`
  )
  assert.ok(
    next === ' ' || next === "'",
    `${leg} [M3] ${token} is followed by a space or the closing quote, got ${JSON.stringify(next ?? null)}`
  )
  assert.ok(
    !result.comment.includes('('),
    `${leg} [M3] and no annotation leaks into the comment: ${JSON.stringify(result.comment)}`
  )
}

/** [M3] the `--json` result object — what `main` prints — carries engineSource. */
function assertJsonCarries (leg, result, expected) {
  assert.ok('engineSource' in result, `${leg} [M3] the result object carries engineSource`)
  assert.equal(
    JSON.parse(JSON.stringify(result)).engineSource, expected,
    `${leg} [M3] and --json prints it as ${JSON.stringify(expected)}`
  )
}

/** The four lines BASE's `renderLaunch` prints; the annotation joins them. */
const baseLines = (result) => [result.runId, result.vm, result.statusUrl, result.comment]

// ── a. [M1] no --engine: the tip, named as the tip ──────────────────────────
{
  const ws = workspace()
  const { result, exec } = await greenLaunch(ws)

  assert.equal(
    result.engineSource, 'main-tip',
    '(a) [M1] a launch() without --engine returns engineSource "main-tip"'
  )
  assert.equal(
    result.engine, MAIN_TIP,
    '(a) [M1] and result.engine is the sha the launcher read from git ls-remote'
  )
  assert.ok(
    exec.calls.some((c) => c.cmd === 'git' &&
      c.argv.join(' ') === `ls-remote ${ENGINE_URL} HEAD`),
    '(a) [M1] which it read with `git ls-remote <ENGINE_URL> HEAD`'
  )

  const lines = renderLaunch(result).split('\n')
  assert.ok(
    lines.includes(mainTipLine(MAIN_TIP)),
    `(a) [M1] renderLaunch(result) carries the line ${JSON.stringify(mainTipLine(MAIN_TIP))}, got ${JSON.stringify(lines)}`
  )
  assert.ok(
    !renderLaunch(result).includes('(pinned)'),
    '(a) [M1] and does not call the tip pinned'
  )
  assert.deepEqual(
    lines, [...baseLines(result), mainTipLine(MAIN_TIP)],
    "(a) [M1] the annotation joins BASE's four lines, last, and changes none of them"
  )

  const expectedComment =
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${MAIN_TIP}`
  assert.equal(
    result.comment, expectedComment,
    "(c) [M3] the assignment comment is byte-identical in shape to BASE's"
  )
  assertCommentShape('(c)', result, exec, MAIN_TIP)
  assertJsonCarries('(c)', result, 'main-tip')
  ws.cleanup()
}

// ── b. [M2] --engine <sha>: pinned, and rendered as BASE renders it ─────────
{
  const ws = workspace()
  const { result, exec } = await greenLaunch(ws, ['--engine', PINNED])

  assert.equal(
    result.engineSource, 'pinned',
    '(b) [M2] a launch() with --engine <sha> returns engineSource "pinned"'
  )
  assert.equal(result.engine, PINNED, '(b) [M2] and result.engine is the sha --engine named')

  const rendered = renderLaunch(result)
  assert.ok(
    !rendered.includes('(main tip'),
    '(b) [M2] a pinned engine is never annotated as the main tip'
  )
  // The clause M2 spells — a `(pinned)` line — collides with the frozen
  // `fleet/tests/test_launch.mjs`, whose every launch is pinned and whose
  // rendering is pinned to four lines. See the head of this file.
  assert.deepEqual(
    rendered.split('\n'), baseLines(result),
    "(b) [M2] a pinned launch renders BASE's four lines, unannotated: the sha was the operator's own, and the comment already prints it"
  )
  assert.ok(
    rendered.includes(`engine=${PINNED}`),
    '(b) [M2] which still shows the operator which engine the run is about to use'
  )

  const expectedComment =
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${PINNED}`
  assert.equal(
    result.comment, expectedComment,
    "(c) [M3] the assignment comment is byte-identical in shape to BASE's"
  )
  assertCommentShape('(c)', result, exec, PINNED)
  assertJsonCarries('(c)', result, 'pinned')
  ws.cleanup()
}

// ── c. [M3] engine= mid-comment: the token before overlap= is untouched ─────
{
  const ws = workspace()
  const { result, exec } = await greenLaunch(ws, ['--engine', PINNED, '--overlap', 'fold', '--tier', 'mostCapable'])

  assert.equal(
    result.comment,
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${PINNED} overlap=fold tier=mostCapable`,
    "(c) [M3] the comment keys, in contract order, exactly as BASE writes them"
  )
  assertCommentShape('(c)', result, exec, PINNED)
  assert.equal(
    result.engineSource, 'pinned',
    '(c) [M2] the source rides the result whatever else the comment carries'
  )
  assert.deepEqual(
    renderLaunch(result).split('\n'), baseLines(result),
    '(c) [M2] and a pinned launch still renders BASE\'s four lines, `overlap=` and `tier=` or no'
  )
  ws.cleanup()
}

// ── d. the sentinel ────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
