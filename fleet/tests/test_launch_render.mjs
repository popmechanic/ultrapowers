/**
 * fleet/tests/test_launch_render.mjs — the launcher attaches the renderer, and
 * refuses on the laptop what the VM could not attach.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] a green launch whose config names `render` issues exactly one
 *       mutating verb — the `new` line whose `--integration` value is
 *       `claude-max,gh-popmechanic-smoke,browser-run`, whose stdin is
 *       `renderSetupScript({run:'1', ...readFleetFiles(), render})` byte for
 *       byte and carries /etc/fleet/render.env, and whose result's `render` is
 *       the object;
 *   (b) [M1] the same launch with a config naming no renderer: the value is
 *       exactly `claude-max,gh-popmechanic-smoke`, the stdin says nothing about
 *       render.env, and the result's `render` is null — including when a
 *       `--config` file beside it does name one, because an injected config is
 *       read as `config.render ?? null` and the file is not opened; and, with
 *       no config injected, the same `--config` file read through
 *       `fleetConfigRender` puts `,browser-run` on the end of the value;
 *   (c) [M2] a listing without the named integration: a `Refusal` naming it and
 *       `references/first-run.md §render`, after one `integrations list --json`
 *       read and before any push and any `new` — nothing mutated on exe.dev and
 *       the origin's `ultra/` refs where they were;
 *   (d) [M3] an ill-formed `render.integration` or `render.account`: a `Refusal`
 *       naming the offending key, with nothing executed at all;
 *   (e) [M4] `USAGE` names no `--render`: the renderer is the config file's;
 *   (f) [M1, M4] the launch sim and the plan-pin sim still print the sentinel.
 *
 * Nothing here opens a network socket: every `ssh` goes through the injected
 * exec seam, the target is `makeTargetRepo`'s real bare origin and its clone,
 * and the keychain is never touched — every launch is handed a
 * `refreshCredential` spy of the exam's own.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { USAGE, launch } from '../launch.mjs'
import { Refusal, defaultExec } from '../lobby.mjs'
import { readFleetFiles, renderSetupScript } from '../setup-script.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration — the `--integration` half M1 spells. */
const GH = 'gh-popmechanic-smoke'
/** The renderer this exam's fleet.json names, and the account its address carries. */
const RENDER = Object.freeze({ integration: 'browser-run', account: 'abc123' })
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
/** `pytest.ini` is the first rung of the sandbox's test-command ladder: a base
 *  matching no rung is refused on the laptop, so every launch sim seeds one. */
const SEED = {
  'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n'
}
/** The pool the plan asks for, as the legs spell it. */
const CONFIG = Object.freeze({ cpu: '8', memory: '16GB' })
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

// ── The seam's rules ────────────────────────────────────────────────────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/** `origin` pointed at the bare repository the exam really made, with the
 *  refspec a configured remote would have supplied for a bare `fetch`. */
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

/** The launcher names `origin` the way an operator's checkout spells it; the
 *  seam points that name at the bare repository and runs the line for real. */
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

/** `help <verb>` as the lobby prints it, with the shipped record's own flags,
 *  so a launch over this rule finds no drift. */
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

/** The listing a laptop that walked the first run reads: the GitHub object, the
 *  Claude integration, and the renderer at the edge. */
const LISTING_WITH_RENDER = [
  { name: GH, attachments: [] },
  { name: 'claude-max', attachments: [] },
  { name: RENDER.integration, attachments: [] }
]
/** The same account, before anyone built the renderer once. */
const LISTING_WITHOUT_RENDER = [
  { name: GH, attachments: [] },
  { name: 'claude-max', attachments: [] }
]

const readRules = ({ repo, integrations = LISTING_WITH_RENDER, billing = BILLING_OK } = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('billing plan --json', answer(billing)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace ({ refs = [] } = {}) {
  const root = tempDir('fleet-launch-render-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  for (const ref of refs) repo.git(['push', repo.origin, `${repo.base}:refs/heads/${ref}`])
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** The origin's own `refs/heads/ultra/*`, read off the bare path the exam made. */
const ultraRefsOf = (ws) => {
  const out = {}
  for (const line of ws.repo.git(['ls-remote', '--heads', ws.repo.origin]).split('\n')) {
    const [sha, ref] = line.split('\t')
    if (!ref) continue
    const name = ref.trim().replace(/^refs\/heads\//, '')
    if (name.startsWith('ultra/')) out[name] = sha.trim()
  }
  return out
}

/** A `~/.ultrapowers/fleet.json` of the exam's own, so no laptop's is read. */
const configFile = (ws, body) => {
  const file = path.join(ws.root, 'fleet.json')
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)
  return file
}

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]

/** The credential seam. Nothing here spawns the credential tool. */
const refreshSpy = () => {
  const spy = (account) => {
    spy.calls.push(account)
    return { ok: true, out: '' }
  }
  spy.calls = []
  return spy
}

/** One launch over the seam, answering the result and the seam that saw it. */
async function launchWith (ws, { extra = [], rules = {}, config = CONFIG } = {}) {
  const exec = makeExec({ rules: readRules({ repo: ws.repo, ...rules }) })
  const result = await launch({
    argv: argvFor(ws, extra),
    exec,
    config,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: refreshSpy()
  })
  return { result, exec }
}

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))
/** The one `--integration` value a `new` line carries, and nothing after it. */
const integrationValue = (line) => /--integration (\S+)/.exec(line)?.[1] ?? null
const newCallOf = (exec) =>
  exec.calls.find((c) => c.cmd === 'ssh' && String(c.argv[1] ?? '').startsWith('new '))
const listReads = (exec) => exec.lobby().filter((line) => line === 'integrations list --json')

// ── a. [M1] the renderer rides the `new` line, and the script carries it ────
{
  const ws = workspace()
  const { result, exec } = await launchWith(ws, {
    config: { ...CONFIG, render: { ...RENDER } }
  })

  const expectedComment =
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}`
  const expectedNew = `new --name ${result.vm} --tag fleet --comment '${expectedComment}'` +
    ` --integration claude-max,${GH},${RENDER.integration}` +
    ` --cpu 8 --memory 16GB --setup-script /dev/stdin --json`

  assert.deepEqual(
    exec.mutating(), [expectedNew],
    '(a) [M1] exactly one mutating lobby verb, and the `new` line carries --integration claude-max,<gh>,<render.integration>'
  )
  assert.equal(
    integrationValue(newLines(exec)[0]),
    `claude-max,${GH},${RENDER.integration}`,
    '(a) [M1] the --integration value is the three names, comma-joined, in that order'
  )

  const newCall = newCallOf(exec)
  assert.equal(
    newCall.options?.input,
    renderSetupScript({ run: '1', ...readFleetFiles(), render: { ...RENDER } }),
    "(a) [M1] the call's stdin is renderSetupScript({run, bootstrap, unit, render}), byte for byte"
  )
  assert.ok(
    String(newCall.options?.input ?? '').includes('/etc/fleet/render.env'),
    '(a) [M1] and that script installs the address at /etc/fleet/render.env'
  )

  assert.deepEqual(
    result.render, { ...RENDER },
    "(a) [M1] the result carries `render` equal to the config's object"
  )
  ws.cleanup()
}

// ── b. [M1] no renderer: the launch is exactly the one it is today ──────────
{
  // b1: a config naming no renderer.
  const ws = workspace()
  const { result, exec } = await launchWith(ws, { config: { ...CONFIG } })

  assert.equal(
    integrationValue(newLines(exec)[0]), `claude-max,${GH}`,
    '(b) [M1] with no renderer the --integration value is exactly claude-max,<gh> — nothing after it'
  )
  assert.equal(
    newCallOf(exec).options?.input,
    renderSetupScript({ run: '1', ...readFleetFiles() }),
    '(b) [M1] the stdin script is the render-less one, byte for byte'
  )
  assert.ok(
    !String(newCallOf(exec).options?.input ?? '').includes('render.env'),
    '(b) [M1] which says nothing about render.env at all'
  )
  assert.equal(result.render, null, '(b) [M1] and the result carries `render` null')
  ws.cleanup()

  // b2: an injected config is read as `config.render ?? null` — the `--config`
  // file beside it names a renderer and is never opened for one.
  const injected = workspace()
  const withRender = configFile(injected, { ...CONFIG, render: { ...RENDER } })
  const { result: injectedResult, exec: injectedExec } = await launchWith(injected, {
    extra: ['--config', withRender],
    config: { ...CONFIG }
  })
  assert.equal(
    integrationValue(newLines(injectedExec)[0]), `claude-max,${GH}`,
    '(b) [M1] a config object was injected, so `render` is config.render ?? null and the file is not read for one'
  )
  assert.equal(
    injectedResult.render, null,
    '(b) [M1] the injected config named none, so the result carries `render` null'
  )
  injected.cleanup()

  // b3: no config injected — the file named by `--config` is read through
  // `fleetConfigRender`, and its renderer rides the line.
  const fromFile = workspace()
  const file = configFile(fromFile, { ...CONFIG, render: { ...RENDER } })
  const { result: fileResult, exec: fileExec } = await launchWith(fromFile, {
    extra: ['--config', file],
    config: null
  })
  const fileValue = integrationValue(newLines(fileExec)[0])
  assert.ok(
    String(fileValue).endsWith(`,${RENDER.integration}`),
    `(b) [M1] a launch reading its own --config file ends the --integration value with ,${RENDER.integration}; got ${JSON.stringify(fileValue)}`
  )
  assert.equal(
    fileValue, `claude-max,${GH},${RENDER.integration}`,
    '(b) [M1] and the whole value is the three names M1 spells'
  )
  assert.deepEqual(
    fileResult.render, { ...RENDER },
    '(b) [M1] the result carries the object fleetConfigRender answered'
  )
  assert.equal(
    newCallOf(fileExec).options?.input,
    renderSetupScript({ run: '1', ...readFleetFiles(), render: { ...RENDER } }),
    "(b) [M1] and the file's renderer is the one the stdin script was rendered for"
  )
  fromFile.cleanup()
}

// ── c. [M2] a renderer that is not at the edge is refused on the laptop ─────
{
  const ws = workspace({ refs: ['ultra/plan-run-5'] })
  const before = ultraRefsOf(ws)
  const exec = makeExec({ rules: readRules({ repo: ws.repo, integrations: LISTING_WITHOUT_RENDER }) })
  const error = await thrown(() => launch({
    argv: argvFor(ws),
    exec,
    config: { ...CONFIG, render: { ...RENDER } },
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: refreshSpy()
  }))

  assert.ok(error, '(c) [M2] a listing with no such integration must refuse')
  assert.ok(
    error instanceof Refusal,
    `(c) [M2] it is a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.equal(error.exitCode, 2, '(c) [M2] and refuses with exit 2')
  assert.ok(
    error.message.includes(RENDER.integration),
    `(c) [M2] the message names the integration ${RENDER.integration}; got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('first-run.md §render'),
    `(c) [M2] and sends the operator to references/first-run.md §render; got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('render.integration'),
    '(c) [M2] naming the config key the name came from'
  )
  assert.ok(
    !error.message.includes('integrations add'),
    '(c) [M2] and naming the walk, never the command that builds the proxy'
  )

  assert.deepEqual(
    listReads(exec), ['integrations list --json'],
    '(c) [M2] the listing was read, and read exactly once: the refusal shares the GitHub check\'s read'
  )
  assert.deepEqual(exec.mutating(), [], '(c) [M2] nothing on exe.dev was mutated')
  assert.deepEqual(newLines(exec), [], '(c) [M2] no `new` was issued')
  assert.ok(
    !exec.calls.some((c) => c.cmd === 'git' && c.argv.includes('push')),
    '(c) [M2] and no plan was pushed'
  )
  assert.deepEqual(
    ultraRefsOf(ws), before,
    "(c) [M2] the target's refs/heads/ultra/ are exactly what they were before the launch"
  )
  ws.cleanup()
}

// ── d. [M3] an ill-formed renderer is refused before anything runs ──────────
{
  const cases = [
    {
      name: 'render.integration Bad Name',
      render: { integration: 'Bad Name', account: 'abc' },
      key: 'integration',
      names: /render[. ]?integration/
    },
    {
      name: 'render.account a/b',
      render: { integration: RENDER.integration, account: 'a/b' },
      key: 'account',
      names: /render[. ]?account/
    }
  ]
  for (const kase of cases) {
    const ws = workspace()
    const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
    const error = await thrown(() => launch({
      argv: argvFor(ws),
      exec,
      config: { ...CONFIG, render: kase.render },
      now: () => NOW,
      sleep: async () => {},
      refreshCredential: refreshSpy()
    }))

    assert.ok(error, `(d) [M3] ${kase.name} must refuse`)
    assert.ok(
      error instanceof Refusal,
      `(d) [M3] ${kase.name} is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.equal(error.exitCode, 2, `(d) [M3] ${kase.name} refuses with exit 2`)
    assert.ok(
      kase.names.test(error.message),
      `(d) [M3] ${kase.name} names the offending key ${kase.key}; got ${JSON.stringify(error.message)}`
    )
    assert.deepEqual(
      exec.calls.map((c) => c.line), [],
      `(d) [M3] ${kase.name} refuses before any command runs — no listing read, no push, no \`new\``
    )
    assert.deepEqual(
      ultraRefsOf(ws), {},
      `(d) [M3] ${kase.name} leaves no ultra/ ref on the origin`
    )
    ws.cleanup()
  }
}

// ── e. [M4] the renderer is the config file's, never a flag ─────────────────
{
  assert.ok(
    !USAGE.includes('--render'),
    '(e) [M4] USAGE names no --render: `render` is read from the config file only'
  )
  assert.ok(
    USAGE.includes('--config <path>'),
    '(e) [M4] and still names --config <path>, the file it is read from'
  )
}

// ── f. [M1, M4] the sims this task must not disturb ─────────────────────────
{
  for (const sim of ['test_launch.mjs', 'test_launch_pins.mjs']) {
    const res = spawnSync(process.execPath, [path.join(FLEET_DIR, 'tests', sim)], {
      encoding: 'utf8'
    })
    assert.equal(
      res.status, 0,
      `(f) [M1, M4] ${sim} still passes; it exited ${res.status}:\n${res.stdout}${res.stderr}`
    )
    assert.ok(
      String(res.stdout).includes('ALL TESTS PASSED'),
      `(f) [M1, M4] ${sim} prints the sentinel:\n${res.stdout}${res.stderr}`
    )
  }
}

console.log('ALL TESTS PASSED')
