/**
 * fleet/tests/test_worker_kata_ref.mjs — the exam for Task 1: *the record
 * carries the short id*.
 *
 * This file is the Proof's `Test: fleet/tests/test_worker_kata_ref.mjs`, and
 * its `Guard:`, written where the Proof names it. Every relative import is
 * written for THIS directory: `../` is the repository's `fleet/`, `./` is
 * `fleet/tests/`.
 *
 * The seam this exam exercises is the one the defect hid in: the launcher's
 * record writer holds the create answer's `short_id` (`MUTATION_KEYS` projects
 * it), and `run-main.mjs`'s `kataRefFor` already reads `row.short_id` — so the
 * only question is whether the row the launcher *writes* carries it. Nothing
 * here plants a short id on a row: leg (a) reads the bytes the launcher's own
 * record writer produced, and leg (b) hands run-main those very bytes.
 *
 * The legs, and what each asserts — every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] Driven through `launch()` against a fake hub whose create answers
 *       carry `short_id` `K-3` and `K-4` for tasks 3 and 4, the record written
 *       into the plan commit's `.ultrapowers/kata.json` parses to a `tasks['3']`
 *       that deep-equals `{uid, short_id: 'K-3', revision}` with `Object.keys`
 *       in exactly that order, a `tasks['4']` likewise with `K-4`, and a `run`
 *       row whose keys are exactly `uid`, `revision`.
 *   (b) [M2] run-main, handed THAT parsed record (the launcher's own bytes,
 *       written to a file and passed as `--kata`), builds an `envFor` seam for
 *       which `envFor({label: 'impl:3'}).KATA_REF` is `<project>#K-3`,
 *       `envFor({label: 'review:4:1:2'}).KATA_REF` is `<project>#K-4`, and
 *       `envFor({label: 'integration'})` deep-equals the three variables —
 *       `KATA_SERVER`, `KATA_AUTH_TOKEN`, `KATA_AUTHOR` — with no `KATA_REF`
 *       key at all.
 *   (c) [M3] `fleet/tests/test_worker_kata_env.mjs` contains no line matching
 *       `\.shortId =` (the `grep -c` the Proof spells prints `0`) — the planted
 *       value is gone — and that sim still prints `ALL TESTS PASSED` when run.
 *   (d) [M4] `fleet/CONTRACT.md`'s `ultra/plan-run-<N>` bullet, read as one
 *       line, contains `{uid,short_id,revision}` and no longer contains
 *       `"tasks":{"<id>":{uid,revision}}`.
 *   (e) [M5] With a fake hub whose create answer for task 4 omits `short_id`,
 *       the record writer throws a `Refusal` naming `4`, no plan branch is
 *       pushed, no `new` is issued, and no `.ultrapowers/kata.json` exists.
 *
 * Nothing here reaches a hub, a network or a `claude`: the hub is a recording
 * fake with the client's method names (the shape of `test_launch_kata.mjs`'s
 * `makeFakeKata`, copied because that file is a script, not a module), every
 * command goes through `makeExec`, and the one git that really runs is local
 * plumbing against a bare origin in a temp dir.
 *
 * The only bearer any of this holds is the literal placeholder the edge
 * replaces: no real token string is written anywhere here.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { launch } from '../launch.mjs'
import { FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import { runMain } from '../run-main.mjs'
import {
  answer, cleanup, gitEnv, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const CONTRACT = path.join(FLEET_DIR, 'CONTRACT.md')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

// ── the literals this exam pins, spelled here and nowhere else ──────────────
/** Where the launcher's record says the hub is (fleet/CONTRACT.md). */
const KATA_URL = 'https://kata.int.exe.xyz'
/** The path the record is written to inside the plan commit. */
const KATA_PATH = '.ultrapowers/kata.json'
// The placeholder, and nothing else: the edge replaces the `Authorization`
// header with the real bearer, so this string is what a worker holds and it is
// worth nothing outside the fleet.
const KATA_AUTH_TOKEN = 'edge-injects-the-bearer'
const SHORT_3 = 'K-3'
const SHORT_4 = 'K-4'
/** `<owner>-<repo>-run-<n>`, for the run this exam's launch takes. */
const PROJECT = 'popmechanic-smoke-run-7'
/** The run id the run-main flow below is driven under. */
const RUN_ID = 'run-7'

// ════════════════════════════════════════════════════════════════════════════
// the launch rig — `test_launch.mjs`'s, as `test_launch_kata.mjs` uses it
// ════════════════════════════════════════════════════════════════════════════

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-13T10:00:00.000Z')
const H1 = 'a plan whose tasks are 3 and 4'
const CLAIM_LINE =
  '**Claim:** do: launch a plan. see: every task row carries its short id. (elicited)'
const PLAN_TEXT = [
  `# ${H1}`, '', '**Goal:** #963', '**Closes:** #963', '', CLAIM_LINE, '',
  '### Task 3: three', '', 'The first task.', '',
  '### Task 4: four', '', 'The second task.', ''
].join('\n')
const VERDICTS_TEXT = '{"verdict":"green","gates":[]}\n'
// `pytest.ini` is what makes the target's suite detectable: without one the
// launch refuses before it ever reaches the hub.
const SEED = {
  'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n'
}
const CONFIG = { ...FLEET_DEFAULTS }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

/** Two fact sheets the canned compile hands the launcher — opaque here. */
const sheet = (file) => ({
  files: [file], deletes: [], guards: [], proofTests: [], landing: {},
  driverOwned: [], siblingOwned: [], produces: [], consumes: []
})
const S3 = sheet('three.txt')
const S4 = sheet('four.txt')
/** Tasks `3` and `4`, in two waves, with the edge 3 → 4 — so the revisions the
 *  record keeps are the post-link reads M1 names. */
const STAMPED = {
  launch_waves: [
    [{ id: '3', title: 'three', factsheet: S3 }],
    [{ id: '4', title: 'four', factsheet: S4 }]
  ],
  dag_edges: [{ from: '3', to: '4', why: 'interface' }]
}

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
/** The compiler, both calls: `--check` answers `PLAN OK`, the stamp the payload. */
const compilerRule = {
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) => argv.includes('--check') ? answer('PLAN OK\n') : answer(JSON.stringify(STAMPED))
}
const readRules = ({ repo }) => [
  ENGINE_RULE,
  localRemote(repo),
  compilerRule,
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json',
    answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

function workspace ({ refs = [] } = {}) {
  const root = tempDir('fleet-worker-kata-ref-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  for (const ref of refs) repo.git(['push', repo.origin, `${repo.base}:refs/heads/${ref}`])
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
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
const PLAN_SPEC = /^([0-9a-f]{40}):refs\/heads\/ultra\/plan-run-(\d+)$/
const specOf = (argv) => argv.map(String).find((a) => PLAN_SPEC.test(a)) ?? null
const argvHasPush = (argv) => argv.includes('push') && specOf(argv) !== null
const pushIndex = (exec) => exec.calls.findIndex((c) => c.cmd === 'git' && argvHasPush(c.argv))

const launchIn = (ws, { exec, kata }) => launch({
  argv: [ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
         '--engine', ENGINE],
  exec,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  config: CONFIG,
  kata
})

// ── the hub, faked ──────────────────────────────────────────────────────────

/** A 26-character ULID-shaped id, distinct per n. */
const ULID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`
/**
 * A recording fake with the client's method names — `test_launch_kata.mjs`'s
 * shape, with ONE thing made explicit: `createIssue` answers the `short_id`
 * kata's create answer carries (`MUTATION_KEYS` projects it), spelled from the
 * spec's own `metadata.task` so task 3's issue answers `K-3` and task 4's
 * `K-4`. `omitShortIdFor` is the task id whose answer carries none — the hub
 * that M5's refusal is about.
 */
function makeFakeKata ({ url = KATA_URL, revisions = {}, omitShortIdFor = null } = {}) {
  const calls = []
  let projects = 0
  let issues = 0
  const rec = (method, args) => calls.push({ method, args })
  return {
    url,
    calls,
    async ping () {
      rec('ping', [])
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
      const task = spec?.metadata?.task
      const out = { uid: ULID(10 + issues), revision: 1 }
      const omitted = omitShortIdFor !== null && String(task) === String(omitShortIdFor)
      if (!omitted) out.short_id = task === undefined ? 'K-run' : `K-${task}`
      return out
    },
    async link (projectId, fromUid, spec) {
      rec('link', [projectId, fromUid, spec])
      return { revision: 2 }
    },
    async getIssue (uid) {
      rec('getIssue', [uid])
      return { uid, revision: revisions[uid] ?? 1, metadata: {}, status: 'open', owner: null,
               project_id: projects }
    }
  }
}
// The run issue is created first, then task 3's, then task 4's.
const RUN_UID = ULID(11)
const T3_UID = ULID(12)
const T4_UID = ULID(13)

// ════════════════════════════════════════════════════════════════════════════
// (a) [M1] the row the launcher writes carries the create answer's short_id
// ════════════════════════════════════════════════════════════════════════════

const ws = workspace({ refs: ['ultra/plan-run-6'] })
const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
const kata = makeFakeKata({ revisions: { [T3_UID]: 9, [T4_UID]: 4, [RUN_UID]: 2 } })
const result = await launchIn(ws, { exec, kata })
assert.equal(result.run, 7,
  '(a) [M1] fixture: the launch took run 7, so its project is ' + PROJECT)

// Fixture check, so a leg that reads `K-3` is reading the HUB's answer and not
// something this exam arranged downstream of the writer.
const created = kata.calls.filter((c) => c.method === 'createIssue')
assert.equal(created.length, 3,
  '(a) [M1] fixture: one run issue and two task issues were created; got ' + created.length)

// The bytes the record writer produced, read out of the plan commit's tree —
// never a value this exam handed back to itself.
const recordBytes = execFileSync(
  'git', ['-C', ws.repo.dir, 'show', `${result.plan}:${KATA_PATH}`],
  { env: gitEnv(), encoding: 'utf8' })
const parsed = JSON.parse(recordBytes)

assert.deepEqual(parsed.tasks['3'], { uid: T3_UID, short_id: SHORT_3, revision: 9 },
  '(a) [M1] the record\'s row for task 3 is exactly {uid, short_id: "' + SHORT_3 +
  '", revision} — the uid of its issue, the short_id of the create answer, and the ' +
  'post-link getIssue revision; got ' + JSON.stringify(parsed.tasks['3']))
assert.deepEqual(Object.keys(parsed.tasks['3']), ['uid', 'short_id', 'revision'],
  '(a) [M1] with its keys in the order uid, short_id, revision; got ' +
  JSON.stringify(Object.keys(parsed.tasks['3'])))
assert.deepEqual(parsed.tasks['4'], { uid: T4_UID, short_id: SHORT_4, revision: 4 },
  '(a) [M1] and task 4\'s row is exactly {uid, short_id: "' + SHORT_4 + '", revision}; got ' +
  JSON.stringify(parsed.tasks['4']))
assert.deepEqual(Object.keys(parsed.tasks['4']), ['uid', 'short_id', 'revision'],
  '(a) [M1] in that same order; got ' + JSON.stringify(Object.keys(parsed.tasks['4'])))
assert.deepEqual(Object.keys(parsed.tasks), ['3', '4'],
  '(a) [M1] and the record names those two tasks and no others; got ' +
  JSON.stringify(Object.keys(parsed.tasks)))
assert.deepEqual(Object.keys(parsed.run), ['uid', 'revision'],
  '(a) [M1] the RUN row is untouched — exactly the keys uid, revision; got ' +
  JSON.stringify(Object.keys(parsed.run)))
assert.deepEqual(parsed.run, { uid: RUN_UID, revision: 2 },
  '(a) [M1] and it still carries the run issue\'s uid and its post-link revision; got ' +
  JSON.stringify(parsed.run))
assert.deepEqual(Object.keys(parsed), ['url', 'project', 'run', 'tasks'],
  '(a) [M1] the record\'s own keys are unchanged: url, project, run, tasks; got ' +
  JSON.stringify(Object.keys(parsed)))
assert.equal(parsed.project.name, PROJECT,
  '(a) [M1] the project the run was filed under is ' + PROJECT)
assert.equal(parsed.url, KATA_URL,
  '(a) [M1] and the hub the record points a worker at is ' + KATA_URL)
assert.deepEqual(result.kata, parsed,
  '(a) [M1] the launch result carries the same record it committed')

// ════════════════════════════════════════════════════════════════════════════
// (b) [M2] run-main, handed THOSE bytes, answers the ref for each worker
// ════════════════════════════════════════════════════════════════════════════

// The run-main flow, driven as `test_worker_kata_env.mjs`'s `withKata` harness
// drives it: a fake `exec` playing the python scripts, a fake `runEngineFn`,
// and a fake `makeAgent` that keeps the seams run-main built — `envFor` among
// them. No `claude` is spawned and no engine runs, so no dispatch could plant a
// short id on a row: what `envFor` reads is what the launcher wrote.
const RUNMAIN_WAVES = () => [[
  { id: '3', title: 'three', files: ['three.txt'], tier: null, review: 'lean',
    writes: ['three.txt'], commutes: [] },
  { id: '4', title: 'four', files: ['four.txt'], tier: null, review: 'lean',
    writes: ['four.txt'], commutes: [] },
]]

/** The hub client run-main is handed: it posts, and it never reads. */
const runMainHub = {
  async getIssue () {
    throw new Error('run-main sim: the engine is stubbed; no read expected here')
  },
  async comment (projectId, uid) {
    return { uid, revision: 2 }
  },
}

async function runMainFlow ({ name, kataPath }) {
  const target = path.join(ws.root, 'rm-' + name)
  fs.mkdirSync(target, { recursive: true })
  const env = gitEnv()
  const git = (argv, cwd) => execFileSync('git', argv,
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'fleet-base'], target)
  git(['config', 'user.email', 't@example.com'], target)
  git(['config', 'user.name', 't'], target)
  fs.writeFileSync(path.join(target, 'three.txt'), 'base\n')
  fs.writeFileSync(path.join(target, 'four.txt'), 'base\n')
  git(['add', '-A'], target)
  git(['commit', '-q', '-m', 'base'], target)

  const planPath = path.join(target, 'plan.md')
  fs.writeFileSync(planPath, '# plan\n')
  const runDir = path.join(target, '.claude/ultrapowers', name)
  const argsFile = path.join(runDir, 'args.json')
  const waves = RUNMAIN_WAVES()
  const execStub = async (cmd, argv, opts = {}) => {
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv,
          { cwd: opts.cwd, env, encoding: 'utf8' }), stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) }
      }
    }
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }),
               stderr: '' }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      fs.mkdirSync(runDir, { recursive: true })
      fs.writeFileSync(argsFile, JSON.stringify({
        waves, wavesPath: path.join(runDir, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1', 'w2'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: target, runDir, testCmd: 'true',
      }, null, 2))
      const receipt = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: 'true' }
      fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt))
      return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: RUN_ID }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      fs.writeFileSync(path.join(runDir, 'gate-receipt.json'), JSON.stringify({
        verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
      }))
      return { code: 0, stdout: '', stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  let seams = null
  const out = await runMain(
    { planPath, runId: RUN_ID, repoDir: target, tier: 'mostCapable', overlap: null,
      testCmd: null, bootstrapCmd: null, cli: 'claude', kata: kataPath },
    {
      exec: execStub,
      log: () => {},
      env: gitEnv(),
      kataClientFor: () => runMainHub,
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + RUN_ID, waveMerges: [], tasks: [],
      }),
      makeAgent: (opts) => {
        seams = opts
        return { agent: async () => null, patchInput: opts.patchesDir }
      },
    },
  )
  return { out, seams: () => seams, runDir }
}

// The launcher's own bytes, on disk, exactly as the boot script lands them
// beside the plan — parsed by run-main and by nobody else.
const recordFile = path.join(ws.root, 'kata-from-launcher.json')
fs.writeFileSync(recordFile, recordBytes)
const flow = await runMainFlow({ name: 'from-launcher', kataPath: recordFile })
assert.equal(flow.out.code, 0,
  '(b) [M2] the run-main flow reading the launcher\'s record is green — ' +
  flow.out.verdict + ': ' + flow.out.detail)
const seams = flow.seams()
assert.ok(seams && typeof seams.envFor === 'function',
  '(b) [M2] run-main hands `makeAgent` an `envFor(opts)` seam — the per-worker kata ' +
  'environment; got ' + JSON.stringify(seams && typeof seams.envFor))
const envFor = seams.envFor

/** What a worker of `label` carries for a task the record knows. */
const fourFor = (label, shortId) => ({
  KATA_SERVER: KATA_URL,
  KATA_AUTH_TOKEN,
  KATA_AUTHOR: label + '@' + RUN_ID,
  KATA_REF: PROJECT + '#' + shortId,
})
/** …and for a label naming no task the record knows: the three, no `KATA_REF`. */
const threeFor = (label) => ({
  KATA_SERVER: KATA_URL,
  KATA_AUTH_TOKEN,
  KATA_AUTHOR: label + '@' + RUN_ID,
})

assert.equal(envFor({ label: 'impl:3' }).KATA_REF, PROJECT + '#' + SHORT_3,
  '(b) [M2] the implementer of task 3 runs with KATA_REF=' + PROJECT + '#' + SHORT_3 +
  ' — the short id read out of the launcher\'s own record, not a planted one; got ' +
  JSON.stringify(envFor({ label: 'impl:3' }).KATA_REF))
assert.deepEqual(envFor({ label: 'impl:3' }), fourFor('impl:3', SHORT_3),
  '(b) [M2] and its environment is exactly the four variables; got ' +
  JSON.stringify(envFor({ label: 'impl:3' })))
assert.equal(envFor({ label: 'review:4:1:2' }).KATA_REF, PROJECT + '#' + SHORT_4,
  '(b) [M2] a reviewer of task 4 holds task 4\'s issue, ' + PROJECT + '#' + SHORT_4 +
  '; got ' + JSON.stringify(envFor({ label: 'review:4:1:2' }).KATA_REF))
assert.deepEqual(envFor({ label: 'review:4:1:2' }), fourFor('review:4:1:2', SHORT_4),
  '(b) [M2] speaking as itself, review:4:1:2@' + RUN_ID + '; got ' +
  JSON.stringify(envFor({ label: 'review:4:1:2' })))

const integration = envFor({ label: 'integration' })
assert.ok(!('KATA_REF' in integration),
  '(b) [M2] the critic\'s label names no task the record knows, so it carries no KATA_REF ' +
  'key at all; got ' + JSON.stringify(integration.KATA_REF))
assert.deepEqual(integration, threeFor('integration'),
  '(b) [M2] and carries the other three — KATA_SERVER, KATA_AUTH_TOKEN, KATA_AUTHOR; got ' +
  JSON.stringify(integration))

ws.cleanup()

// ════════════════════════════════════════════════════════════════════════════
// (c) [M3] the sibling sim plants nothing, and still passes
// ════════════════════════════════════════════════════════════════════════════
{
  const simPath = path.join(HERE, 'test_worker_kata_env.mjs')
  const simText = fs.readFileSync(simPath, 'utf8')
  const planted = simText.split('\n').filter((line) => /\.shortId =/.test(line))
  assert.deepEqual(planted, [],
    '(c) [M3] fleet/tests/test_worker_kata_env.mjs assigns `.shortId` on no line — ' +
    '`grep -c \'\\.shortId =\' fleet/tests/test_worker_kata_env.mjs` prints 0, so the sim ' +
    'that pins the worker\'s environment reads the short id from the record rather than ' +
    'planting it. Still assigned on:\n' + planted.join('\n'))

  // That the sibling sim still passes is the driver's `Run:` on this task, not
  // this exam's to spawn: no sim runs another sim (test_sims_are_hermetic M4).
}

// ════════════════════════════════════════════════════════════════════════════
// (d) [M4] the contract's plan-branch bullet
// ════════════════════════════════════════════════════════════════════════════
{
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('  - `ultra/plan-run-<N>`'))
  assert.ok(start >= 0,
    '(d) [M4] fleet/CONTRACT.md carries an `ultra/plan-run-<N>` bullet')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('  - `') || lines[i].startsWith('- **')) { end = i; break }
  }
  const bullet = lines.slice(start, end).join(' ')
  assert.ok(bullet.includes('{uid,short_id,revision}'),
    '(d) [M4] and spells a task row as {uid,short_id,revision} — the record the launcher ' +
    'writes, short id included. The bullet reads:\n' + bullet)
  assert.ok(!bullet.includes('"tasks":{"<id>":{uid,revision}}'),
    '(d) [M4] and no longer as "tasks":{"<id>":{uid,revision}}. The bullet reads:\n' + bullet)
}

// ════════════════════════════════════════════════════════════════════════════
// (e) [M5] a create answer with no short_id is a refusal, not a row without one
// ════════════════════════════════════════════════════════════════════════════
{
  const bare = workspace({ refs: ['ultra/plan-run-6'] })
  const execBare = makeExec({ rules: readRules({ repo: bare.repo }) })
  const kataBare = makeFakeKata({ omitShortIdFor: '4' })
  const error = await thrown(() => launchIn(bare, { exec: execBare, kata: kataBare }))
  assert.ok(error instanceof Refusal,
    '(e) [M5] a create answer carrying no short_id is a Refusal from the record writer — a ' +
    'row without the short id would be a worker with no KATA_REF and no way to know it; got ' +
    (error === null ? 'no throw at all' : error.name + ': ' + error.message))
  assert.ok(String(error.message).includes('4'),
    '(e) [M5] naming the task whose answer lacked it, 4: ' + error.message)

  const refs = branchesOf(bare)
  assert.ok(!('ultra/plan-run-7' in refs) && !('ultra/plan-run-8' in refs),
    '(e) [M5] and no plan branch was pushed, so no kata.json bytes reached the target; got ' +
    JSON.stringify(Object.keys(refs)))
  assert.equal(pushIndex(execBare), -1,
    '(e) [M5] no push was even attempted')
  assert.ok(!fs.existsSync(path.join(bare.repo.dir, KATA_PATH)),
    '(e) [M5] and no ' + KATA_PATH + ' was written in the checkout either')
  assert.deepEqual(execBare.mutating(), [],
    '(e) [M5] nor was any mutating lobby verb issued')
  bare.cleanup()
}

console.log('ALL TESTS PASSED')
