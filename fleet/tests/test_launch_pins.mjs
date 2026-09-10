/**
 * fleet/tests/test_launch_pins.mjs — the plan's hash pins, verified at `--base`
 * before the push.
 *
 * A hash pin is a fact about BASE, and BASE is chosen at launch: so the
 * launcher reads the pins the plan carries and checks them against the tree at
 * `--base`, refusing before it touches exe.dev or the target. The exam is
 * written against the task's Machine clauses, leg by leg, and every assertion
 * names its leg and the clause it comes from:
 *
 *   (a) [M1] [M2] a `## Global Constraints` `- Check:` pin that matches and a
 *       Proof `- Run:` pin that does not: a `Refusal`, `exitCode` 2, naming the
 *       stale path, its pinned sha and the real one — and not the path whose
 *       pin matched;
 *   (b) [M2] a pin on a path absent at `--base` says `no such path`; two stale
 *       pins are two lines, whether they sit on two lines or are chained with
 *       `&&` on one;
 *   (c) [M3] a slice pin (`<command> | git hash-object --stdin`) is run under
 *       `/bin/sh -c` in a checkout of `--base`: a matching one launches, a
 *       stale one refuses with the command in place of the path
 *       (whitespace-collapsed, clipped to 80 characters), and either way no
 *       `fleet-pin-*` directory is left under the OS temp dir and the
 *       operator's checkout — `HEAD`, index, working tree, worktree list — is
 *       as it was;
 *   (d) [M4] every one of those refusals issues no `ssh`, pushes nothing,
 *       mutates no lobby verb and leaves no `ultra/` ref on the origin — and is
 *       raised after the `--base` check and before the first `ls-remote`;
 *   (e) [M1] [M4] what is not a pin: a plan with none, a pin on a
 *       `**Context:**` line, and a `- Check:` whose sha is 39 or 41 hex. All
 *       launch, and a plan whose pins all match launches exactly as one
 *       carrying none;
 *   (f) [Produces] `verifyPlanPins` is what `fleet/launch.mjs` produces.
 *
 * Nothing here opens a network socket. Every `ssh` goes through the injected
 * exec seam; `git`, `tar` and `/bin/sh` are real, and the target is a real
 * repository — `makeTargetRepo`'s bare origin and its clone — so a push is a
 * real push and the refs a leg reads are the origin's own. The scaffolding is
 * copied from `fleet/tests/test_launch.mjs` rather than imported: that file
 * exports nothing.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'
import { launch } from '../launch.mjs'
import { FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import { simEnv } from './_helpers.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

/**
 * The seed the base commit carries. `pytest.ini` rides beside the README
 * because a sibling task of this wave refuses a launch whose tree at `--base`
 * has no detectable test command.
 */
const SEED = {
  'README.md': '# target\n',
  'src/app.js': 'export const x = 1\n',
  'pytest.ini': '[pytest]\n'
}

/** Two shas no blob of this seed has. */
const ZEROS = '0'.repeat(40)
const AAAA = 'a'.repeat(40)

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

/**
 * What really runs when no rule matched. `git` so a plan commit is a real
 * commit; `tar` and the shells so a slice pin's checkout and its `/bin/sh -c`
 * are real however the launcher spells them — M3 asks for both.
 */
const PASSTHROUGH = ['git', 'tar', 'sh', 'bash', '/bin/sh', '/bin/bash']

// ── The seam's rules, as test_launch.mjs writes them ────────────────────────

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

/** `origin` pointed at the bare repository the exam really made. */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
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

/** `help <verb>` as the lobby prints it, answering the shipped record's flags. */
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

const readRules = ({ repo } = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The plan text, and the two pin shapes plans write ───────────────────────

/** The path shape: "the shape for a single file". */
const pathPin = (rel, sha) => `test "$(git hash-object ${rel})" = ${sha}`
/** The slice shape: a command's stdout, hashed on stdin. */
const slicePin = (command, sha) => `test "$(${command} | git hash-object --stdin)" = ${sha}`

/**
 * A plan: a `## Global Constraints` section of `- Check:` bullets and one task
 * whose Proof carries `- Run:` bullets, plus whatever `**Context:**` lines a leg
 * wants — the shape `skills/ultrawrite/SKILL.md` spells.
 */
const makePlan = ({ checks = [], runs = [], context = [] } = {}) => [
  '# a plan',
  '',
  '## Global Constraints',
  ...checks.map((check) => `- Check: ${check}`),
  '',
  '### Task 1: the one task',
  '',
  ...context.map((line) => `**Context:** ${line}`),
  '',
  '**Proof:**',
  '- Test: `fleet/tests/test_thing.mjs`',
  ...runs.map((run) => `- Run: ${run}`),
  ''
].join('\n')

/** The plan text BASE launches with: not a pin in it. */
const NO_PIN_PLAN = '# a plan\n\nOne task, and a trailing newline.\n'

/** The refusal line M2 spells, one per stale pin. */
const pinLine = (label, pinned, base, real) =>
  `launch: plan pin ${label}: pinned ${pinned} but --base ${base} has ${real}`

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace ({ plan = NO_PIN_PLAN, refs = [], origin = ORIGIN_URL } = {}) {
  const root = tempDir('fleet-launch-pins-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  for (const ref of refs) repo.git(['push', repo.origin, `${repo.base}:refs/heads/${ref}`])
  repo.git(['remote', 'set-url', 'origin', origin])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, typeof plan === 'function' ? plan(repo) : plan)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** The blob the tree at `--base` carries at `<rel>` — what a path pin pins. */
const blobAt = (repo, rel) => repo.git(['rev-parse', `${repo.base}:${rel}`])

/** The sha a slice pin pins, computed by the exam the way M3 says to compute it. */
const sliceSha = (repo, command) => {
  const res = spawnSync('sh', ['-c', `${command} | git hash-object --stdin`],
    { cwd: repo.dir, encoding: 'utf8', env: simEnv() })
  assert.equal(res.status, 0, `the exam computes its own slice sha: ${res.stdout}${res.stderr}`)
  const sha = String(res.stdout).trim()
  assert.match(sha, /^[0-9a-f]{40}$/, 'the exam computes its own slice sha')
  return sha
}

/** The origin's own `refs/heads/*`. */
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

/** The credential seam: nothing spawns the credential tool, so no keychain is read. */
const refreshSpy = () => {
  const spy = () => ({ ok: true })
  return spy
}

const launchIn = (ws, { argv, exec }) => launch({
  argv: argv ?? argvFor(ws),
  exec,
  config: CONFIG,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: refreshSpy()
})

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))

async function greenLaunch (ws, { extra = [] } = {}) {
  const exec = makeExec({ rules: readRules({ repo: ws.repo }), passthrough: PASSTHROUGH })
  const result = await launchIn(ws, { argv: argvFor(ws, extra), exec })
  return { result, exec }
}

async function refusingLaunch (ws, { extra = [] } = {}) {
  const exec = makeExec({ rules: readRules({ repo: ws.repo }), passthrough: PASSTHROUGH })
  const error = await thrown(() => launchIn(ws, { argv: argvFor(ws, extra), exec }))
  return { error, exec }
}

/** The `fleet-pin-*` directories under the OS temp dir, right now. */
const pinDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('fleet-pin-'))

/**
 * (d) [M4] what every pin refusal has and has not done: it is a `Refusal` with
 * `exitCode` 2 whose message begins `launch: `, it was raised after the
 * `--base` read and before the first `ls-remote`, and nothing on exe.dev or on
 * the target moved.
 */
function assertRefusalShape (label, { error, exec, ws }) {
  assert.ok(error, `${label} [M2] must refuse`)
  assert.ok(
    error instanceof Refusal,
    `${label} [M2] is a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.equal(error.exitCode, 2, `${label} [M2] refuses with exit 2`)
  assert.ok(
    error.message.startsWith('launch: '),
    `${label} [M2] its message begins \`launch: \`, got ${JSON.stringify(error.message)}`
  )
  assert.deepEqual(
    exec.calls.filter((c) => c.cmd === 'ssh').map((c) => c.line), [],
    `(d) [M4] ${label} issues no ssh command: no lobby verb is reached`
  )
  assert.deepEqual(
    exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push')).map((c) => c.line), [],
    `(d) [M4] ${label} pushes nothing`
  )
  assert.deepEqual(exec.mutating(), [], `(d) [M4] ${label} mutates no lobby verb`)
  assert.deepEqual(
    Object.keys(branchesOf(ws)).filter((ref) => ref.startsWith('ultra/')), [],
    `(d) [M4] ${label} leaves no ultra/ ref on the origin`
  )
  assert.ok(
    exec.calls.some((c) => c.cmd === 'git' && c.argv.includes('rev-parse') && c.argv.includes('--verify')),
    `(d) [M4] ${label} is raised after --base is verified present in the checkout`
  )
  assert.deepEqual(
    exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('ls-remote')).map((c) => c.line), [],
    `(d) [M4] ${label} is raised before the first ls-remote: a stale pin costs nothing but local git reads`
  )
}

// ── a. [M1] [M2] a matching Check pin and a stale Run pin ───────────────────
{
  const ws = workspace({
    plan: (repo) => makePlan({
      checks: [pathPin('README.md', blobAt(repo, 'README.md'))],
      runs: [pathPin('src/app.js', ZEROS)]
    })
  })
  const real = blobAt(ws.repo, 'src/app.js')
  const { error, exec } = await refusingLaunch(ws)
  assertRefusalShape('(a) a stale Proof `- Run:` path pin', { error, exec, ws })

  assert.ok(
    error.message.includes('src/app.js'),
    `(a) [M2] the refusal names the stale path, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes(ZEROS),
    `(a) [M2] and the sha the plan pinned, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes(real),
    `(a) [M2] and the blob --base really carries there, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    !error.message.includes('README.md'),
    `(a) [M2] and says nothing of README.md, whose Global Constraints pin matches, got ${JSON.stringify(error.message)}`
  )
  assert.equal(
    error.message, pinLine('src/app.js', ZEROS, ws.repo.base, real),
    '(a) [M2] one stale pin is one line, in the format the task spells'
  )
  ws.cleanup()
}

// ── b. [M2] an absent path, and two stale pins ─────────────────────────────
{
  const missing = workspace({ plan: makePlan({ checks: [pathPin('missing.txt', ZEROS)] }) })
  const { error, exec } = await refusingLaunch(missing)
  assertRefusalShape('(b) a pin on a path absent at --base', { error, exec, ws: missing })
  for (const piece of ['missing.txt', ZEROS, 'no such path']) {
    assert.ok(
      error.message.includes(piece),
      `(b) [M2] the refusal carries ${JSON.stringify(piece)}, got ${JSON.stringify(error.message)}`
    )
  }
  assert.equal(
    error.message, pinLine('missing.txt', ZEROS, missing.repo.base, 'no such path'),
    '(b) [M2] a path absent at --base is a stale pin, not a skipped one'
  )
  missing.cleanup()

  // Two stale pins on two lines: two lines in the message.
  const two = workspace({
    plan: makePlan({
      checks: [pathPin('missing.txt', ZEROS)],
      runs: [pathPin('src/app.js', AAAA)]
    })
  })
  const twoReal = blobAt(two.repo, 'src/app.js')
  const twoRun = await refusingLaunch(two)
  assertRefusalShape('(b) two stale pins on two lines', { ...twoRun, ws: two })
  for (const piece of ['missing.txt', 'src/app.js']) {
    assert.ok(
      twoRun.error.message.includes(piece),
      `(b) [M2] both stale paths are in the message, missing ${piece}: ${JSON.stringify(twoRun.error.message)}`
    )
  }
  assert.deepEqual(
    twoRun.error.message.split('\n').slice().sort(),
    [
      pinLine('missing.txt', ZEROS, two.repo.base, 'no such path'),
      pinLine('src/app.js', AAAA, two.repo.base, twoReal)
    ].sort(),
    '(b) [M2] two stale pins are two lines, one per pin'
  )
  two.cleanup()

  // [M1] a `Run:` may chain several tests with `&&`: one line, two pins.
  const chained = workspace({
    plan: makePlan({
      runs: [`${pathPin('missing.txt', ZEROS)} && ${pathPin('src/app.js', AAAA)}`]
    })
  })
  const chainedReal = blobAt(chained.repo, 'src/app.js')
  const chainedRun = await refusingLaunch(chained)
  assertRefusalShape('(b) [M1] two pins chained with && on one `- Run:` line', { ...chainedRun, ws: chained })
  assert.deepEqual(
    chainedRun.error.message.split('\n').slice().sort(),
    [
      pinLine('missing.txt', ZEROS, chained.repo.base, 'no such path'),
      pinLine('src/app.js', AAAA, chained.repo.base, chainedReal)
    ].sort(),
    '(b) [M1] one line can carry several pins, and each stale one is its own line'
  )
  chained.cleanup()

  // The whole-value backtick wrapper `compile_plan.py` strips off a
  // `Run:`/`Check:` value is stripped here too, so the pin inside it is a pin.
  const wrapped = workspace({
    plan: makePlan({ checks: [`\`${pathPin('src/app.js', ZEROS)}\``] })
  })
  const wrappedReal = blobAt(wrapped.repo, 'src/app.js')
  const wrappedRun = await refusingLaunch(wrapped)
  assertRefusalShape('(b) [M1] a backtick-wrapped `- Check:` value', { ...wrappedRun, ws: wrapped })
  assert.equal(
    wrappedRun.error.message,
    pinLine('src/app.js', ZEROS, wrapped.repo.base, wrappedReal),
    '(b) [M1] the wrapper is stripped before matching, and the label carries no backtick'
  )
  wrapped.cleanup()
}

// ── c. [M3] the slice shape: a command's stdout, in a checkout of --base ────
const SLICE_CMD = "sed -n '1p' README.md"
{
  // A matching slice pin launches, and leaves nothing behind.
  const green = workspace({
    plan: (repo) => makePlan({ runs: [slicePin(SLICE_CMD, sliceSha(repo, SLICE_CMD))] })
  })
  const headBefore = green.repo.git(['rev-parse', 'HEAD'])
  const pinDirsBefore = pinDirs()
  const { result, exec } = await greenLaunch(green)
  assert.equal(result.run, 1, '(c) [M3] a slice pin the tree at --base answers launches: run 1')
  assert.equal(newLines(exec).length, 1, '(c) [M3] with one `new`')
  assert.deepEqual(
    exec.mutating(), newLines(exec),
    '(c) [M3] and that `new` the only mutating lobby verb'
  )
  assert.deepEqual(
    pinDirs().filter((name) => !pinDirsBefore.includes(name)), [],
    '(c) [M3] no fleet-pin-* directory remains under the OS temp dir after a launch'
  )
  assert.equal(
    green.repo.git(['status', '--porcelain']), '',
    "(c) [M3] the checkout's index and working tree are as they were"
  )
  assert.equal(
    green.repo.git(['rev-parse', 'HEAD']), headBefore,
    "(c) [M3] and its HEAD"
  )
  assert.equal(
    green.repo.git(['worktree', 'list']).split('\n').length, 1,
    '(c) [M3] and `git worktree list` has one line: the temporary checkout is gone, not merely emptied'
  )

  // The same pin with forty zeros: the command in place of the path.
  const stale = workspace({ plan: makePlan({ runs: [slicePin(SLICE_CMD, ZEROS)] }) })
  const staleHead = stale.repo.git(['rev-parse', 'HEAD'])
  const staleBefore = pinDirs()
  const computed = sliceSha(stale.repo, SLICE_CMD)
  const staleRun = await refusingLaunch(stale)
  assertRefusalShape('(c) a stale slice pin', { ...staleRun, ws: stale })
  for (const piece of [SLICE_CMD, ZEROS, computed]) {
    assert.ok(
      staleRun.error.message.includes(piece),
      `(c) [M3] the refusal carries ${JSON.stringify(piece)}, got ${JSON.stringify(staleRun.error.message)}`
    )
  }
  assert.equal(
    staleRun.error.message, pinLine(SLICE_CMD, ZEROS, stale.repo.base, computed),
    '(c) [M3] the command stands in the place the path would take'
  )
  assert.deepEqual(
    pinDirs().filter((name) => !staleBefore.includes(name)), [],
    '(c) [M3] and the temporary directory is removed before launch throws, not only before it returns'
  )
  assert.equal(
    stale.repo.git(['status', '--porcelain']), '',
    "(c) [M3] the refusing launch left the checkout's index and working tree as they were"
  )
  assert.equal(stale.repo.git(['rev-parse', 'HEAD']), staleHead, '(c) [M3] and its HEAD')
  assert.equal(
    stale.repo.git(['worktree', 'list']).split('\n').length, 1,
    '(c) [M3] and its worktree list one line'
  )
  green.cleanup()
  stale.cleanup()

  // Whitespace-collapsed and clipped to 80 characters: the label is what M3
  // says it is, and the command still runs as it was written.
  const spaced =
    "sed -n '1p' README.md    src/app.js     pytest.ini     README.md     src/app.js     pytest.ini     src/app.js"
  const collapsed =
    "sed -n '1p' README.md src/app.js pytest.ini README.md src/app.js pytest.ini src/app.js"
  assert.ok(collapsed.length > 80, '(c) [M3] the fixture command is longer than the 80-character clip')
  const long = workspace({ plan: makePlan({ runs: [slicePin(spaced, ZEROS)] }) })
  const longReal = sliceSha(long.repo, spaced)
  const longRun = await refusingLaunch(long)
  assertRefusalShape('(c) a stale slice pin whose command is long', { ...longRun, ws: long })
  const label = /^launch: plan pin ([\s\S]*): pinned /.exec(longRun.error.message)?.[1] ?? null
  assert.ok(label !== null, `(c) [M3] the refusal is one pin line, got ${JSON.stringify(longRun.error.message)}`)
  assert.equal(label.length, 80, '(c) [M3] the command is clipped to 80 characters')
  assert.equal(label, collapsed.slice(0, 80), '(c) [M3] and whitespace-collapsed first')
  assert.equal(
    longRun.error.message, pinLine(collapsed.slice(0, 80), ZEROS, long.repo.base, longReal),
    '(c) [M3] the line is otherwise the one M2 spells, and the real sha is the command run as written'
  )
  long.cleanup()

  // [M1] one `- Run:` chaining a path pin and a slice pin is two pins: the path
  // pin's closing `)"` bounds the slice command, so neither reading swallows the
  // other. Both matching, the launch goes through.
  const mixed = workspace({
    plan: (repo) => makePlan({
      runs: [`${pathPin('src/app.js', blobAt(repo, 'src/app.js'))} && ${slicePin(SLICE_CMD, sliceSha(repo, SLICE_CMD))}`]
    })
  })
  const mixedRun = await greenLaunch(mixed)
  assert.equal(
    mixedRun.result.run, 1,
    '(c) [M1] [M4] a `- Run:` chaining a matching path pin and a matching slice pin launches'
  )
  assert.equal(newLines(mixedRun.exec).length, 1, '(c) [M4] with one `new` line')
  mixed.cleanup()

  // And the same line with the slice pin stale is one line naming that command
  // alone — not the whole line from the first `test`.
  const mixedStale = workspace({
    plan: (repo) => makePlan({
      runs: [`${pathPin('src/app.js', blobAt(repo, 'src/app.js'))} && ${slicePin(SLICE_CMD, ZEROS)}`]
    })
  })
  const mixedSha = sliceSha(mixedStale.repo, SLICE_CMD)
  const mixedStaleRun = await refusingLaunch(mixedStale)
  assertRefusalShape('(c) [M1] a stale slice pin chained after a matching path pin', { ...mixedStaleRun, ws: mixedStale })
  assert.equal(
    mixedStaleRun.error.message,
    pinLine(SLICE_CMD, ZEROS, mixedStale.repo.base, mixedSha),
    '(c) [M1] the chained slice pin is read as itself, and the matching path pin beside it says nothing'
  )
  mixedStale.cleanup()
}

// ── d. [M4] the ordering: the --base check comes first ──────────────────────
{
  // A `--base` the checkout does not have, and a stale pin: the base refusal is
  // the one raised, because the pins are checked against a base that is there.
  const ws = workspace({ plan: makePlan({ checks: [pathPin('src/app.js', ZEROS)] }) })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }), passthrough: PASSTHROUGH })
  const error = await thrown(() => launchIn(ws, {
    argv: [ws.planPath, '--target', TARGET, '--base', 'f'.repeat(40),
      '--repo', ws.repo.dir, '--engine', ENGINE],
    exec
  }))
  assert.ok(error instanceof Refusal, `(d) [M4] an absent --base still refuses, got ${error?.name}`)
  assert.ok(
    error.message.includes(`has no commit ${'f'.repeat(40)}`),
    `(d) [M4] with the --base refusal BASE already raises, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    !error.message.includes('plan pin'),
    '(d) [M4] the pins are read after --base is verified present, so no pin is reported against a base that is not there'
  )
  ws.cleanup()
}

// ── e. [M1] [M4] what is not a pin, and what a matching pin costs ───────────
{
  // The plan text BASE launches with: not a pin in it.
  const bare = workspace()
  const { result: bareResult, exec: bareExec } = await greenLaunch(bare)
  assert.equal(bareResult.run, 1, '(e) [M4] a plan carrying no pin launches: run 1')
  assert.equal(newLines(bareExec).length, 1, '(e) [M4] with one `new` line')

  // A pin on a `**Context:**` line is not on a `- Check:`/`- Run:` line, so it
  // is not a pin: the launch never reads it.
  const contextual = workspace({
    plan: makePlan({
      context: [`the frozen literal ${pathPin('src/app.js', ZEROS)} is quoted here, not claimed`]
    })
  })
  const { result: contextResult, exec: contextExec } = await greenLaunch(contextual)
  assert.equal(
    contextResult.run, 1,
    '(e) [M1] a pin written on a `**Context:**` line is not a pin: the launch goes through'
  )
  assert.equal(newLines(contextExec).length, 1, '(e) [M4] with one `new` line')
  contextual.cleanup()

  // A sha that is not forty hex is not a pin either, at 39 or at 41.
  for (const [width, sha] of [[39, '0'.repeat(39)], [41, '0'.repeat(41)]]) {
    const odd = workspace({ plan: makePlan({ checks: [pathPin('README.md', sha)] }) })
    const { result, exec } = await greenLaunch(odd)
    assert.equal(
      result.run, 1,
      `(e) [M1] a \`- Check:\` whose sha is ${width} hex characters is not a pin: the launch goes through`
    )
    assert.equal(newLines(exec).length, 1, `(e) [M4] with one \`new\` line, at ${width} hex`)
    odd.cleanup()
  }

  // [M4] a plan whose pins all match launches exactly as at BASE: the same
  // lobby verbs, in the same order, the `new` line's minted name apart.
  const matching = workspace({
    plan: (repo) => makePlan({
      checks: [pathPin('README.md', blobAt(repo, 'README.md'))],
      runs: [
        pathPin('src/app.js', blobAt(repo, 'src/app.js')),
        slicePin(SLICE_CMD, sliceSha(repo, SLICE_CMD))
      ]
    })
  })
  const { result: matchResult, exec: matchExec } = await greenLaunch(matching)
  assert.equal(matchResult.run, 1, '(e) [M4] a plan whose pins all match launches')
  const shape = (exec) => exec.lobby().map((line) => (line.startsWith('new ') ? 'new' : line))
  assert.deepEqual(
    shape(matchExec), shape(bareExec),
    '(e) [M4] and issues exactly the lobby a plan carrying no pin issues'
  )
  matching.cleanup()
  bare.cleanup()
}

// ── f. [Produces] the function the task produces ────────────────────────────
{
  assert.equal(
    typeof launchModule.verifyPlanPins, 'function',
    '(f) [Produces] fleet/launch.mjs produces verifyPlanPins({ exec, repoDir, base, planText })'
  )
}

console.log('ALL TESTS PASSED')
