/**
 * fleet/tests/test_launch_kata.mjs — the exam for "When an operator launches
 * a plan, the run and one issue per task are already on the hub, each task
 * carrying its fact sheet, before any machine exists" (#913, task 4).
 *
 * Legs:
 *   (a) [M1] `readKataEnv` — an absent file and a file lacking either line are
 *       refusals naming the path and `node fleet/kata-hub.mjs`; a complete file
 *       answers the two values. `launch()` with neither `kata` nor `config`
 *       injected reads `kataEnvPath` before any command; with a complete env
 *       file the client is `sshTransport` on the env's host, the bearer is the
 *       hub shell's `$KATA_AUTH_TOKEN` and never the file's value, and a 500
 *       from the hub is a LobbyError naming `createProject`. A `config` injected
 *       with no `kata` is a launch that makes no hub call and answers `kata`
 *       null.
 *   (b) [M2] `ping()` sits after the `integrations list --json` read and before
 *       the reap's `ls`; a ping that throws is a Refusal naming the hub's url
 *       and the error, with no plan branch and no mutating verb.
 *   (c) [M3] the second `python3` is `compile_plan.py <plan> --stamp run-<n>
 *       --base <base>`, and it precedes every hub call of the filing.
 *   (d) [M3] the filing's calls, in order and argument for argument.
 *   (e) [M3] the plan commit's tree carries `.ultrapowers/kata.json`; a push
 *       race purges the project and files again for N+1.
 *   (f) [M4] the blob's bytes, key order, the post-link revisions, the result's
 *       `kata` and the `kata=` line.
 *   (g) [M5] a hub call that throws after the ping is a LobbyError naming the
 *       method, with no plan branch and no `new`.
 *   (h) [M6] the two contract bullets.
 *
 * The rig is `test_launch.mjs`'s: a real bare origin, every remote and lobby
 * command answered by the seam, no socket opened. The hub is a recording fake
 * answering canned 26-character uids and revisions — never a network.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  KATA_PATH, KATA_SANDBOX_URL, launch, readKataEnv, renderLaunch
} from '../launch.mjs'
import { EXE_HOST, FLEET_DEFAULTS, LobbyError, Refusal, defaultExec, planBranchFor } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-11T22:15:00.000Z')
const H1 = 'a plan with a hub'
const CLAIM_LINE = '**Claim:** do: launch a plan. see: the run is on the hub before any machine exists. (elicited)'
const PLAN_TEXT = [
  `# ${H1}`, '', '**Goal:** #913', '**Closes:** #660 #668', '', CLAIM_LINE, '',
  '### Task 1: one', '', 'One task, and a trailing newline.', ''
].join('\n')
const PLAN_NO_CLOSES = PLAN_TEXT.replace('**Closes:** #660 #668\n', '')
const VERDICTS_TEXT = '{"verdict":"green","gates":[]}\n'
const SEED = {
  'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n'
}
const CONFIG = { ...FLEET_DEFAULTS }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPILER = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')
const CONTRACT = path.join(FLEET_DIR, 'CONTRACT.md')
const VERBS_PATH = path.join(FLEET_DIR, 'exe-verbs.json')
const VERBS = JSON.parse(fs.readFileSync(VERBS_PATH, 'utf8'))

/** Two sheets the canned compile hands the launcher — opaque here, carried whole. */
const S1 = {
  files: ['one.txt', 'tests/test_one.py'], deletes: [], guards: [], proofTests: ['tests/test_one.py'],
  landing: { 'tests/test_one.py': 'tests/exams/run_7/test_one.py' },
  driverOwned: ['tests/exams/run_7/__init__.py', 'tests/exams/run_7/test_one.py'],
  siblingOwned: [], produces: ['`one() -> 1`'], consumes: []
}
const S2 = {
  files: ['two.txt'], deletes: ['old.txt'], guards: [], proofTests: [], landing: {},
  driverOwned: [], siblingOwned: [], produces: [], consumes: ['`one() -> 1`']
}
const STAMPED = {
  launch_waves: [
    [{ id: '1', title: 'one', factsheet: S1 }],
    [{ id: '2', title: 'two', factsheet: S2 }]
  ],
  dag_edges: [{ from: '1', to: '2', why: 'interface' }]
}

// ── The seam's rules ────────────────────────────────────────────────────────

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
  return flags ? answer(helpText(verb, flags)) : answer(`No help available for unrecognized command: ${verb}\n`)
}
/** The compiler, both calls: `--check` answers `PLAN OK`, the stamp answers the canned payload. */
const compilerRule = (stamped = STAMPED) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) => argv.includes('--check') ? answer('PLAN OK\n') : answer(JSON.stringify(stamped))
})
const readRules = ({ repo, stamped, first = [] } = {}) => [
  ...first,
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  compilerRule(stamped),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace ───────────────────────────────────────────────────────────

function workspace ({ plan = PLAN_TEXT, refs = [] } = {}) {
  const root = tempDir('fleet-launch-kata-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  for (const ref of refs) repo.git(['push', repo.origin, `${repo.base}:refs/heads/${ref}`])
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, plan)
  fs.writeFileSync(path.join(planDir, 'a-plan.gate-verdicts.json'), VERDICTS_TEXT)
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
const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE, ...extra
]
const siblingOf = (ws) =>
  ws.repo.git(['commit-tree', `${ws.repo.base}^{tree}`, '-p', ws.repo.base, '-m', 'another launch got there first'])
const PLAN_SPEC = /^([0-9a-f]{40}):refs\/heads\/ultra\/plan-run-(\d+)$/
const specOf = (argv) => argv.map(String).find((a) => PLAN_SPEC.test(a)) ?? null
const treeOf = (ws, sha) => {
  ws.repo.git(['fetch', ws.repo.origin, sha])
  return ws.repo.git(['ls-tree', '-r', '--name-only', sha]).split('\n').filter((l) => l !== '')
}

// ── The hub, faked ──────────────────────────────────────────────────────────

/** A 26-character ULID-shaped id, distinct per n. */
const ULID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`
/**
 * A recording fake with the client's method names. Every call records
 * `{ method, args, at }` where `at` is how many seam commands the launch had
 * issued when the call landed — the same trick `refreshSpy` plays — so a leg
 * can place a hub call among the seam's calls. Uids: the project is ULID(1),
 * the issues ULID(11), ULID(12), … in creation order. `revisions` maps a uid
 * to what `getIssue` answers for it (else 1). `failAt.createIssue` is the
 * ordinal of the `createIssue` that throws.
 */
function makeFakeKata ({ exec, url = 'http://hub.fake', revisions = {}, ping = null, failAt = {} } = {}) {
  const calls = []
  let projects = 0
  let issues = 0
  const rec = (method, args) => calls.push({ method, args, at: exec ? exec.calls.length : -1 })
  return {
    url,
    calls,
    async ping () {
      rec('ping', [])
      if (ping) throw ping
      return { ok: true, service: 'kata', version: '0.17.2' }
    },
    async createProject (name) {
      rec('createProject', [name])
      projects += 1
      return { id: projects, uid: ULID(projects), name, revision: 1 }
    },
    async purgeProject (id, reason) {
      rec('purgeProject', [id, reason])
      return {}
    },
    async createIssue (projectId, spec) {
      rec('createIssue', [projectId, spec])
      issues += 1
      if (failAt.createIssue === issues) throw new Error(`kata refused issue ${issues}`)
      return { uid: ULID(10 + issues), revision: 1, short_id: `K-${issues}` }
    },
    async link (projectId, fromUid, spec) {
      rec('link', [projectId, fromUid, spec])
      return { revision: 2 }
    },
    async getIssue (uid) {
      rec('getIssue', [uid])
      return { uid, revision: revisions[uid] ?? 1, metadata: {}, status: 'open', owner: null, project_id: projects }
    }
  }
}
const RUN_UID = ULID(11)
const T1_UID = ULID(12)
const T2_UID = ULID(13)

const launchIn = (ws, { exec, kata, config = CONFIG, argv, kataEnvPath } = {}) => launch({
  argv: argv ?? argvFor(ws),
  exec,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  ...(config === undefined ? {} : { config }),
  ...(kata === undefined ? {} : { kata }),
  ...(kataEnvPath === undefined ? {} : { kataEnvPath })
})
const lobbyIndex = (exec, prefix) =>
  exec.calls.findIndex((c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith(prefix))
const pushIndex = (exec) => exec.calls.findIndex((c) => c.cmd === 'git' && argvHasPush(c.argv))
const argvHasPush = (argv) => argv.includes('push') && specOf(argv) !== null
const pythonCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3')
const hubSsh = (exec) => exec.calls.filter((c) => c.cmd === 'ssh' && c.argv[0] !== EXE_HOST)
const FIX = 'node fleet/kata-hub.mjs'

/** A section of the contract between two `- **…` bullets, as one line. */
const contractSection = (startRe, endRe) => {
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n')
  const from = lines.findIndex((l) => startRe.test(l))
  assert.ok(from >= 0, `fleet/CONTRACT.md has a line matching ${startRe}`)
  const to = lines.findIndex((l, i) => i > from && endRe.test(l))
  return lines.slice(from, to < 0 ? lines.length : to + 1).join(' ')
}

// ── a. [M1] the env file, the client, and the no-hub branch ─────────────────
{
  const root = tempDir('fleet-kata-env-')
  const absent = path.join(root, 'nope', 'kata-hub.env')
  const missing = await thrown(() => readKataEnv(absent))
  assert.ok(missing instanceof Refusal, `(a) [M1] an absent env file is a Refusal, got ${missing?.name}`)
  assert.ok(missing.message.includes(absent), '(a) [M1] naming the path')
  assert.ok(missing.message.includes(FIX), `(a) [M1] and ${FIX}`)

  for (const [name, text, lacking] of [
    ['no-url.env', 'KATA_TOKEN=sekret\n', 'KATA_URL'],
    ['no-token.env', 'KATA_URL=https://hub.test\n', 'KATA_TOKEN']
  ]) {
    const file = path.join(root, name)
    fs.writeFileSync(file, text)
    const error = await thrown(() => readKataEnv(file))
    assert.ok(error instanceof Refusal, `(a) [M1] a file lacking ${lacking}= is a Refusal, got ${error?.name}`)
    assert.ok(error.message.includes(file) && error.message.includes(FIX), `(a) [M1] naming the path and ${FIX}`)
  }
  const complete = path.join(root, 'kata-hub.env')
  fs.writeFileSync(complete, 'KATA_URL=https://hub.test\nKATA_TOKEN=sekret\n')
  assert.deepEqual(await readKataEnv(complete), { url: 'https://hub.test', token: 'sekret' },
    '(a) [M1] a complete file answers the two values')

  // Neither `kata` nor `config` injected: the env file is read before any command.
  const ws = workspace()
  const configPath = path.join(ws.root, 'fleet.json')
  fs.writeFileSync(configPath, '{"cpu":"8","memory":"16GB"}')
  const execNone = makeExec({ rules: readRules({ repo: ws.repo }) })
  const refused = await thrown(() => launchIn(ws, {
    exec: execNone, argv: argvFor(ws, ['--config', configPath]), config: null, kataEnvPath: absent
  }))
  assert.ok(refused instanceof Refusal, `(a) [M1] no hub env: a Refusal, got ${refused?.name}: ${refused?.message}`)
  assert.ok(refused.message.includes(absent) && refused.message.includes(FIX),
    `(a) [M1] naming kataEnvPath and ${FIX}: ${refused.message}`)
  assert.deepEqual(execNone.calls, [], '(a) [M1] and the refusal precedes every command')

  // The real client over the seam: ssh to the env's host, the bearer the hub's own.
  const hubCalls = []
  const hubRule = {
    when: (cmd, argv) => cmd === 'ssh' && argv.includes('hub.test'),
    answer: () => {
      hubCalls.push(1)
      return hubCalls.length === 1 ? answer('{"ok":true,"service":"kata","version":"0.17.2"}\n200') : answer('\n500')
    }
  }
  const execHub = makeExec({ rules: readRules({ repo: ws.repo, first: [hubRule] }) })
  const failed = await thrown(() => launchIn(ws, {
    exec: execHub, argv: argvFor(ws, ['--config', configPath]), config: null, kataEnvPath: complete
  }))
  const ssh = hubSsh(execHub)
  assert.ok(ssh.length >= 2, `(a) [M1] the launch reached the hub over ssh at least twice, got ${ssh.length}`)
  assert.equal(ssh[0].argv[ssh[0].argv.length - 2], 'hub.test', '(a) [M1] the first hub call\'s destination is the env url\'s host')
  const remote = String(ssh[0].argv[ssh[0].argv.length - 1])
  assert.ok(remote.includes('localhost:8000/api/v1/ping'), `(a) [M1] and it is the ping, on the hub's own port: ${remote}`)
  assert.ok(remote.includes('$KATA_AUTH_TOKEN'), '(a) [M1] the bearer is the hub shell\'s $KATA_AUTH_TOKEN')
  assert.ok(!remote.includes('sekret'), '(a) [M1] and never the file\'s value')
  assert.ok(failed instanceof LobbyError, `(a) [M1] a 500 from the hub after the ping is a LobbyError, got ${failed?.name}: ${failed?.message}`)
  assert.ok(failed.message.includes('createProject'), `(a) [M1] naming createProject: ${failed.message}`)
  for (const c of execHub.calls) {
    assert.ok(!c.argv.some((a) => String(a).includes('sekret')), `(a) [M1] the token rides no argv: ${c.line}`)
  }
  assert.deepEqual(execHub.mutating(), [], '(a) [M1] and nothing mutating was issued')

  // A config injected and no `kata`: no hub at all.
  const execCfg = makeExec({ rules: readRules({ repo: ws.repo }) })
  const plain = await launchIn(ws, { exec: execCfg, config: CONFIG })
  assert.equal(plain.kata, null, '(a) [M1] result.kata is null with a config injected and no kata')
  assert.equal(hubSsh(execCfg).length, 0, '(a) [M1] no hub call was made')
  assert.equal(pythonCalls(execCfg).length, 1, '(a) [M1] and the compiler ran once, as at BASE')
  assert.ok(!treeOf(ws, plain.plan).includes(KATA_PATH), '(a) [M1] the plan commit carries no kata.json')
  assert.ok(execCfg.lobby().some((l) => l.startsWith('new ')), '(a) [M1] and `new` was issued as at BASE')
  ws.cleanup()
  cleanup(root)
}

// ── b. [M2] the ping's place, and a ping that fails ──────────────────────────
{
  const ws = workspace({ refs: ['ultra/plan-run-6'] })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const kata = makeFakeKata({ exec })
  const result = await launchIn(ws, { exec, kata })
  assert.equal(result.run, 7, '(b) [M2] the launch took run 7')
  const ping = kata.calls.find((c) => c.method === 'ping')
  assert.ok(ping, '(b) [M2] ping was called')
  const integrations = lobbyIndex(exec, 'integrations list --json')
  const reapLs = lobbyIndex(exec, 'ls')
  assert.ok(integrations >= 0 && integrations < ping.at, '(b) [M2] the integrations read precedes the ping')
  assert.ok(reapLs >= 0 && ping.at <= reapLs, `(b) [M2] and the ping precedes the reap's ls (ping at ${ping.at}, ls at ${reapLs})`)
  ws.cleanup()

  const dark = workspace({ refs: ['ultra/plan-run-6'] })
  const execDark = makeExec({ rules: readRules({ repo: dark.repo }) })
  const kataDark = makeFakeKata({ exec: execDark, ping: new Error('connect ECONNREFUSED 10.0.0.9:8000') })
  const error = await thrown(() => launchIn(dark, { exec: execDark, kata: kataDark }))
  assert.ok(error instanceof Refusal, `(b) [M2] a ping that throws is a Refusal, got ${error?.name}: ${error?.message}`)
  assert.ok(error.message.includes(kataDark.url), `(b) [M2] naming the hub's url: ${error.message}`)
  assert.ok(error.message.includes('ECONNREFUSED'), '(b) [M2] and the thrown message')
  assert.ok(!('ultra/plan-run-7' in branchesOf(dark)), '(b) [M2] no plan branch was pushed')
  assert.deepEqual(execDark.mutating(), [], '(b) [M2] and no mutating verb was issued')
  assert.deepEqual(kataDark.calls.map((c) => c.method), ['ping'], '(b) [M2] the ping was the hub\'s only call')
  dark.cleanup()
}

// ── c. d. f. [M3] [M4] the green filing at run 7 ────────────────────────────
{
  const ws = workspace({ refs: ['ultra/plan-run-6'] })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const kata = makeFakeKata({ exec, revisions: { [T1_UID]: 9, [T2_UID]: 4, [RUN_UID]: 2 } })
  const result = await launchIn(ws, { exec, kata })
  assert.equal(result.run, 7, '(c) [M3] run 7')

  // (c) the second compile
  const py = pythonCalls(exec)
  assert.equal(py.length, 2, `(c) [M3] exactly two python3 calls, got ${py.length}`)
  assert.ok(py[0].argv.includes('--check'), '(c) [M3] the first is the --check compile')
  assert.deepEqual(py[1].argv, [COMPILER, ws.planPath, '--stamp', 'run-7', '--base', ws.repo.base],
    '(c) [M3] the second is compile_plan.py <plan> --stamp run-7 --base <base>')
  assert.equal(py[1].options?.cwd, ws.repo.dir, '(c) [M3] run in the checkout')
  const stampAt = exec.calls.indexOf(py[1])
  for (const c of kata.calls) {
    if (c.method === 'ping') continue
    assert.ok(stampAt < c.at, `(c) [M3] the stamp compile precedes the hub's ${c.method} (compile at ${stampAt}, call at ${c.at})`)
  }

  // (d) the filing, call for call
  const filing = kata.calls.filter((c) => c.method !== 'ping')
  assert.deepEqual(filing.map((c) => c.method),
    ['createProject', 'createIssue', 'createIssue', 'createIssue', 'link', 'getIssue', 'getIssue', 'getIssue'],
    '(d) [M3] project, run issue, two task issues, one link, three reads — in that order')
  assert.deepEqual(filing[0].args, ['popmechanic-smoke-run-7'], '(d) [M3] the project is <owner>-<repo>-run-7')
  const pid = 1
  assert.deepEqual(filing[1].args, [pid, {
    title: `run-7: ${H1}`,
    body: CLAIM_LINE,
    metadata: { run: 7, target: TARGET, base: ws.repo.base, closes: [660, 668] }
  }], '(d) [M3] the run issue: title, the Claim line, run/target/base/closes')
  assert.deepEqual(filing[2].args, [pid, {
    title: 'task 1: one', body: '', metadata: { task: '1', wave: 1, factsheet: S1 },
    links: [{ type: 'parent', to_ref: RUN_UID }]
  }], '(d) [M3] task 1 carries sheet S1, wave 1 and a parent link to the run')
  assert.deepEqual(filing[3].args, [pid, {
    title: 'task 2: two', body: '', metadata: { task: '2', wave: 2, factsheet: S2 },
    links: [{ type: 'parent', to_ref: RUN_UID }]
  }], '(d) [M3] task 2 carries sheet S2 and wave 2')
  assert.deepEqual(filing[4].args, [pid, T1_UID, { type: 'blocks', to_ref: T2_UID }],
    '(d) [M3] the edge 1 -> 2 is a blocks link created ON task 1 with to_ref task 2')
  assert.deepEqual(filing.slice(5).map((c) => c.args), [[T1_UID], [T2_UID], [RUN_UID]],
    '(d) [M3] then getIssue for task 1, task 2 and the run')
  const push = pushIndex(exec)
  const created = lobbyIndex(exec, 'new ')
  assert.ok(push >= 0 && created >= 0, '(d) [M3] the launch pushed and issued new')
  for (const c of kata.calls) {
    assert.ok(c.at <= push && c.at <= created, `(d) [M3] ${c.method} precedes the push and the new`)
  }

  // (f) the record the commit carries
  const tree = treeOf(ws, result.plan)
  for (const p of ['.ultrapowers/plan.md', '.ultrapowers/gate-verdicts.json', KATA_PATH]) {
    assert.ok(tree.includes(p), `(e) [M3] the plan commit's tree lists ${p}`)
  }
  const expected = {
    url: KATA_SANDBOX_URL,
    project: { id: pid, uid: ULID(1), name: 'popmechanic-smoke-run-7' },
    run: { uid: RUN_UID, revision: 2 },
    tasks: { 1: { uid: T1_UID, revision: 9 }, 2: { uid: T2_UID, revision: 4 } }
  }
  const shown = ws.repo.git(['show', `${result.plan}:${KATA_PATH}`])
  const parsed = JSON.parse(shown)
  assert.deepEqual(parsed, expected, '(f) [M4] the blob is the record, with the post-link getIssue revisions 9, 4 and 2')
  assert.deepEqual(Object.keys(parsed), ['url', 'project', 'run', 'tasks'], '(f) [M4] keys in the order url, project, run, tasks')
  const expectedFile = path.join(ws.root, 'expected-kata.json')
  fs.writeFileSync(expectedFile, `${JSON.stringify(expected, null, 2)}\n`)
  const blob = ws.repo.git(['ls-tree', result.plan, KATA_PATH]).split(/\s+/)[2]
  assert.equal(blob, ws.repo.git(['hash-object', expectedFile]),
    '(f) [M4] byte for byte: JSON.stringify(…, null, 2) plus a trailing newline')
  assert.deepEqual(result.kata, expected, '(f) [M4] the result carries kata: {url, project, run, tasks}')
  assert.equal(result.kata.project.name, 'popmechanic-smoke-run-7', '(f) [M4] result.kata.project.name')
  assert.ok(renderLaunch(result).split('\n').includes('kata=popmechanic-smoke-run-7 2 tasks'),
    `(f) [M4] the launch line carries kata=<project> <count> tasks:\n${renderLaunch(result)}`)
  ws.cleanup()

  // (d) no Closes line: closes is [] — present and empty, never absent or null.
  const bare = workspace({ plan: PLAN_NO_CLOSES, refs: ['ultra/plan-run-6'] })
  const execBare = makeExec({ rules: readRules({ repo: bare.repo }) })
  const kataBare = makeFakeKata({ exec: execBare })
  await launchIn(bare, { exec: execBare, kata: kataBare })
  const runIssue = kataBare.calls.find((c) => c.method === 'createIssue')
  assert.ok(Object.prototype.hasOwnProperty.call(runIssue.args[1].metadata, 'closes'), '(d) [M3] closes is a key')
  assert.deepEqual(runIssue.args[1].metadata.closes, [], '(d) [M3] and deep-equals [] for a plan with no Closes line')
  bare.cleanup()
}

// ── e. [M3] the race: purge, then file again for N+1 ────────────────────────
{
  const ws = workspace({ refs: ['ultra/plan-run-6'] })
  const sibling = siblingOf(ws)
  let pushes = 0
  const competitor = {
    when: (cmd, argv) => cmd === 'git' && argvHasPush(argv),
    answer: (cmd, argv, options) => {
      pushes += 1
      if (pushes === 1) ws.repo.git(['push', ws.repo.origin, `${sibling}:refs/heads/ultra/plan-run-7`])
      return defaultExec('git', pointAtOrigin(ws.repo, argv), options ?? {})
    }
  }
  const exec = makeExec({ rules: readRules({ repo: ws.repo, first: [competitor] }) })
  const kata = makeFakeKata({ exec })
  const result = await launchIn(ws, { exec, kata })
  assert.equal(result.run, 8, '(e) [M3] the race bumped the launch to run 8')
  const methods = kata.calls.map((c) => c.method)
  const purgeAt = methods.indexOf('purgeProject')
  assert.ok(purgeAt >= 0, '(e) [M3] the first project was purged')
  assert.deepEqual(kata.calls[purgeAt].args, [1, 'run number taken'], '(e) [M3] purgeProject(<first project id>, "run number taken")')
  assert.equal(methods[purgeAt + 1], 'createProject', '(e) [M3] followed by the next attempt\'s createProject')
  assert.deepEqual(kata.calls[purgeAt + 1].args, ['popmechanic-smoke-run-8'], '(e) [M3] for run 8')
  const record = JSON.parse(ws.repo.git(['show', `${branchesOf(ws)['ultra/plan-run-8']}:${KATA_PATH}`]))
  assert.equal(record.project.name, 'popmechanic-smoke-run-8', '(e) [M3] the pushed kata.json names run 8\'s project')
  assert.equal(record.project.id, 2, '(e) [M3] and its id, not run 7\'s')
  assert.deepEqual(result.kata, record, '(e) [M3] the result carries the same record')
  ws.cleanup()
}

// ── g. [M5] a hub call that throws after the ping ────────────────────────────
{
  const ws = workspace({ refs: ['ultra/plan-run-6'] })
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  // The third createIssue is the second task's.
  const kata = makeFakeKata({ exec, failAt: { createIssue: 3 } })
  const error = await thrown(() => launchIn(ws, { exec, kata }))
  assert.ok(error instanceof LobbyError, `(g) [M5] a LobbyError, got ${error?.name}: ${error?.message}`)
  assert.ok(error.message.includes('createIssue'), `(g) [M5] naming createIssue: ${error.message}`)
  const refs = branchesOf(ws)
  assert.ok(!('ultra/plan-run-7' in refs) && !('ultra/plan-run-8' in refs), '(g) [M5] no plan branch was pushed')
  assert.equal(pushIndex(exec), -1, '(g) [M5] no push was even attempted')
  assert.deepEqual(exec.mutating(), [], '(g) [M5] and no `new` was issued')
  ws.cleanup()
}

// ── h. [M6] the contract ─────────────────────────────────────────────────────
{
  const planBullet = contractSection(/^  - `ultra\/plan-run-<N>`/, /^  - `ultra\/evidence-run-<N>`/)
  assert.ok(planBullet.includes('kata.json'), '(h) [M6] the plan-branch bullet names kata.json in the tree')
  const order = contractSection(/^- \*\*Launch order \(launcher\):/, /^- \*\*Setup script/)
  assert.ok(order.includes('kata'), '(h) [M6] the launch-order bullet names the kata step')
  const refreshAt = order.indexOf('claude-token.mjs refresh')
  const kataAt = order.indexOf('kata', refreshAt)
  const pushAt = order.indexOf(`push \`${planBranchFor('N')}\``)
  assert.ok(refreshAt >= 0 && kataAt > refreshAt && pushAt > kataAt,
    '(h) [M6] and places it between the credential refresh and the plan push')
}

console.log('ALL TESTS PASSED')
