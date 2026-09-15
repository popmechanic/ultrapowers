/**
 * fleet/tests/test_launch_size.mjs — the exam for "The VM is sized to the plan,
 * and the width is the plan's" (task 3).
 *
 * A one-task plan got the same box as a ten-task one, because `cpu`/`memory`
 * were read as the size every run gets; and the engine's dispatch bound was a
 * process constant of 12 that never read the plan at all. After this run the
 * launcher sizes the box from the compiled plan's widest wave, clamped by what
 * `~/.ultrapowers/fleet.json` names, and the engine's bound is the plan's.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] under the caps `6`/`8GB` a one-task compile stub yields a `new`
 *       argv carrying `--cpu 3 --memory 3GB` and a stub whose waves are 2/10/1
 *       tasks (widest 10, thirteen in all — so what is read is the WIDEST WAVE
 *       and not the task count) yields `--cpu 6 --memory 8GB`; with no
 *       `fleet.json` the caps are `FLEET_DEFAULTS`, so the same ten-wide stub
 *       yields `--cpu 6 --memory 12GB`;
 *   (b) [M2] `--cpu 2` on the launch line yields `--cpu 2` whatever the stub
 *       answers (and memory stays the formula's — the flags win one for one),
 *       and a value above the fake billing plan's `max_cpus`/`max_memory_gb` is
 *       refused with the same message as at BASE, word for word;
 *   (c) [M3] the fake exec records exactly one `compile_plan.py … --stamp …`
 *       invocation per UN-BUMPED launch — the only kind this exam drives, both
 *       of its launches pushing to their own origin at the first N they ask
 *       for — ordered before the `new` verb, with no hub, where the sizing is
 *       the only reader, and with a recording fake hub, where the filing's
 *       issues cover exactly that one payload's tasks. A launch whose push is
 *       refused takes the next run number and compiles again under it, so its
 *       stamped compiles are two: that is run-128 task 2's exam
 *       (`test_launch_bump.mjs`), not this leg's;
 *   (d) [M4] the launch arguments the fake sandbox receives carry `width` equal
 *       to the widest wave; `widthOf` answers 4 for `{ width: 4 }`, 12 for `{}`
 *       and 12 for `{ width: 0 }`; `boundedParallel(widthOf(` is present in
 *       `fleet/run-main.mjs` while `WIDTH = 12` is absent, by grep; and the
 *       derivation those composed arguments take `width` from answers 10 —
 *       not the fallback — over an `args.json` shaped like the box's own
 *       compile of the 2/10/1 plan, which carries `waves` and no `width`;
 *   (e) [M5] `--help` still names both flags, and `fleet/RUNBOOK.md`'s
 *       `## One-time setup` section says ceiling;
 *   (f) [Produces] `vmSizeFor(widestWave, cap)` is `fleet/launch.mjs`'s, pure,
 *       and is the formula of M1.
 *
 * Everything a launch would execute is answered by the seam, and the compiler
 * is never really run: the exam reads what the launcher asked for and what it
 * did with the answer. No socket is opened. The scaffolding is the deleted
 * launch sims' (`test_launch_compile.mjs`, `test_launch_kata.mjs`), copied
 * rather than imported — those files exported nothing.
 *
 * `widthOf` and `vmSizeFor` are read off namespace imports on purpose: a BASE
 * that does not export them fails as an absent function and not as a link
 * error that would hide every other leg.
 *
 * `fleet/CONTRACT.md`'s `new`-verb sentence is deliberately not pinned here —
 * no Machine clause and no leg names its wording.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'
import { USAGE, launch } from '../launch.mjs'
import * as runMainModule from '../run-main.mjs'
import { EXE_HOST, FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-14T18:20:00.000Z')
/** The caps the leg names: a `fleet.json` saying `6` and `8GB`. */
const CAPPED = { cpu: '6', memory: '8GB' }
/** What `loadFleetConfig` answers when there is no `fleet.json` at all. */
const NO_FILE = { ...FLEET_DEFAULTS }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
const RUN_MAIN = path.join(FLEET_DIR, 'run-main.mjs')
const RUNBOOK = path.join(FLEET_DIR, 'RUNBOOK.md')
/** The compiler the launcher must name: the plugin's own. */
const COMPILER = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')

// ── The compiled plan, as the stub answers it ───────────────────────────────

/** One task of a compiled wave, with a fact sheet the launcher carries whole. */
const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`],
    deletes: [],
    guards: [],
    proofTests: [],
    landing: {},
    driverOwned: [],
    siblingOwned: [],
    produces: [],
    consumes: []
  }
})
/** `waves(2, 10, 1)` — three waves of those sizes, task ids 1.. in order. */
const waves = (...sizes) => {
  let n = 0
  return sizes.map((size) => Array.from({ length: size }, () => task((n += 1))))
}
const ONE_TASK = { launch_waves: waves(1), dag_edges: [] }
/** Widest wave 10, thirteen tasks in all: the count and the width differ. */
const TEN_WIDE = { launch_waves: waves(2, 10, 1), dag_edges: [] }
const TEN_WIDE_IDS = TEN_WIDE.launch_waves.flat().map((t) => t.id)

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
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}
/** Both compiles: `--check` answers `PLAN OK`, the stamp answers the payload. */
const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.includes('--check') ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})
const readRules = ({ repo, compiled = ONE_TASK, billing = BILLING_OK } = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  compilerRule(compiled),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(billing)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The hub, faked: a recorder with the client's method names ───────────────
//
// One project per TARGET keyed by name, an issue store keyed by
// `Idempotency-Key` and a per-key metadata merge — the three hub behaviours the
// launcher's filing leans on (#978 task 2). `purgeProject` is gone from both
// the client and this fake: a bump closes the run issue instead.

const ULID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`
function makeFakeKata ({ url = 'http://hub.fake' } = {}) {
  const calls = []
  const projects = new Map()
  const issues = new Map()
  const byKey = new Map()
  const links = []
  const rec = (method, args) => calls.push({ method, args })
  const answer = (issue) => ({
    uid: issue.uid,
    revision: issue.revision,
    short_id: issue.short_id,
    metadata: { ...issue.metadata },
    status: issue.status,
    owner: null,
    project_id: issue.project_id
  })
  return {
    url,
    calls,
    projects,
    issues,
    links,
    async ping () {
      rec('ping', [])
      return { ok: true, service: 'kata', version: '0.17.2' }
    },
    async createProject (name) {
      rec('createProject', [name])
      if (!projects.has(name)) {
        projects.set(name, { id: projects.size + 1, uid: ULID(projects.size + 1), name, revision: 1 })
      }
      return { ...projects.get(name) }
    },
    async createIssue (projectId, spec) {
      rec('createIssue', [projectId, spec])
      const key = spec?.idempotencyKey
      const print = JSON.stringify([spec?.title ?? null, spec?.body ?? null, spec?.metadata ?? null])
      if (key !== undefined && byKey.has(key)) {
        const seen = byKey.get(key)
        if (seen.fingerprint !== print) throw new Error(`idempotency_mismatch for ${key}`)
        return { ...answer(issues.get(seen.uid)), revision: seen.revision }
      }
      const n = issues.size + 1
      const issue = {
        uid: ULID(10 + n),
        short_id: `K-${n}`,
        revision: 1,
        metadata: { ...(spec?.metadata ?? {}) },
        status: 'open',
        project_id: projectId
      }
      issues.set(issue.uid, issue)
      if (key !== undefined) byKey.set(key, { uid: issue.uid, fingerprint: print, revision: 1 })
      return answer(issue)
    },
    async patchMetadata (projectId, uid, patch, revision) {
      rec('patchMetadata', [projectId, uid, patch, revision])
      const issue = issues.get(uid)
      if (!issue) throw new Error(`no such issue ${uid}`)
      issue.metadata = { ...issue.metadata, ...patch }
      issue.revision += 1
      return answer(issue)
    },
    async link (projectId, fromUid, spec) {
      rec('link', [projectId, fromUid, spec])
      const issue = issues.get(fromUid)
      const held = links.find((l) => l.from === fromUid && l.type === spec?.type && spec?.type === 'parent')
      if (held && !spec?.replace) throw new Error('parent_already_set')
      if (held) held.to_ref = spec.to_ref
      else links.push({ from: fromUid, type: spec?.type, to_ref: spec?.to_ref })
      if (issue) issue.revision += 1
      return issue ? answer(issue) : { revision: 2 }
    },
    async close (projectId, uid, spec) {
      rec('close', [projectId, uid, spec])
      const issue = issues.get(uid)
      if (!issue) throw new Error(`no such issue ${uid}`)
      issue.status = 'closed'
      issue.revision += 1
      return answer(issue)
    },
    async getIssue (uid) {
      rec('getIssue', [uid])
      const issue = issues.get(uid)
      if (!issue) throw new Error(`no such issue ${uid}`)
      return answer(issue)
    }
  }
}

// ── The workspace ───────────────────────────────────────────────────────────

function workspace () {
  const root = tempDir('fleet-launch-size-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}
const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]
const launchIn = (ws, { exec, config = CAPPED, extra = [], kata } = {}) => launch({
  argv: argvFor(ws, extra),
  exec,
  config,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  ...(kata === undefined ? {} : { kata })
})

/** One launch, end to end: `{ result, exec, ws }`, the workspace still live. */
const drive = async ({ compiled = ONE_TASK, config = CAPPED, extra = [], kata, billing } = {}) => {
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo, compiled, billing }) })
  const result = await launchIn(ws, { exec, config, extra, kata })
  return { result, exec, ws }
}

// ── Reading the calls ───────────────────────────────────────────────────────

const newCallOf = (exec) => exec.calls.find(
  (c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new ')
)
/** The `--cpu`/`--memory` pair the `new` verb carries. */
const sizeOf = (exec, leg) => {
  const call = newCallOf(exec)
  assert.ok(call, `${leg} the launch issued a \`new\` verb`)
  const m = /--cpu (\S+) --memory (\S+)/.exec(String(call.argv[1] ?? ''))
  assert.ok(m, `${leg} the \`new\` verb carries --cpu <n> --memory <n>GB, got ${call.argv[1]}`)
  return { cpu: m[1], memory: m[2] }
}
/**
 * Everything the launcher hands the box on that one verb: the argv (the
 * assignment `--comment` among it) and the setup script on its stdin. That is
 * the whole of "the launch arguments the fake sandbox receives" as a launch
 * exam can see them.
 */
const assignmentOf = (exec, leg) => {
  const call = newCallOf(exec)
  assert.ok(call, `${leg} the launch issued a \`new\` verb`)
  return `${call.argv.join(' ')}\n${String(call.options?.input ?? '')}`
}
const stampCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3' && c.argv.includes('--stamp'))
const indexOfStamp = (exec) => exec.calls.findIndex((c) => c.cmd === 'python3' && c.argv.includes('--stamp'))
const indexOfNew = (exec) => exec.calls.findIndex(
  (c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new ')
)

// ── a. [M1] the size is the widest wave's, clamped by the cap ───────────────
{
  const one = await drive({ compiled: ONE_TASK, config: CAPPED })
  assert.deepEqual(
    sizeOf(one.exec, '(a) [M1]'), { cpu: '3', memory: '3GB' },
    '(a) [M1] W = 1 under the caps 6/8GB is --cpu 3 --memory 3GB: min(6, 2 + ceil(1/3)) and min(8, 2 + 1)'
  )
  one.ws.cleanup()

  const ten = await drive({ compiled: TEN_WIDE, config: CAPPED })
  assert.deepEqual(
    sizeOf(ten.exec, '(a) [M1]'), { cpu: '6', memory: '8GB' },
    '(a) [M1] W = 10 (the widest of waves 2/10/1, not the 13 tasks) under the caps 6/8GB is --cpu 6 --memory 8GB'
  )
  ten.ws.cleanup()

  const uncapped = await drive({ compiled: TEN_WIDE, config: NO_FILE })
  assert.deepEqual(
    sizeOf(uncapped.exec, '(a) [M1]'), { cpu: '6', memory: '12GB' },
    `(a) [M1] with no fleet.json the caps are FLEET_DEFAULTS (${FLEET_DEFAULTS.cpu}/${FLEET_DEFAULTS.memory}), so W = 10 is --cpu 6 --memory 12GB`
  )
  uncapped.ws.cleanup()
}

// ── b. [M2] an explicit flag wins; the billing refusals are unchanged ───────
{
  const chosen = await drive({ compiled: TEN_WIDE, config: CAPPED, extra: ['--cpu', '2'] })
  const size = sizeOf(chosen.exec, '(b) [M2]')
  assert.equal(size.cpu, '2', '(b) [M2] --cpu 2 on the launch line wins over the formula, whatever the stub answers')
  assert.equal(
    size.memory, '8GB',
    '(b) [M2] and only over --cpu: memory is still the formula\'s min(8, 2 + 10) under the 8GB cap'
  )
  chosen.ws.cleanup()

  const chosenMemory = await drive({ compiled: TEN_WIDE, config: CAPPED, extra: ['--memory', '5GB'] })
  const memSize = sizeOf(chosenMemory.exec, '(b) [M2]')
  assert.equal(memSize.memory, '5GB', '(b) [M2] --memory 5GB on the launch line wins over the formula')
  assert.equal(memSize.cpu, '6', '(b) [M2] and only over --memory: cpu is still the formula\'s')
  chosenMemory.ws.cleanup()

  const wsCpu = workspace()
  const execCpu = makeExec({ rules: readRules({ repo: wsCpu.repo, compiled: TEN_WIDE }) })
  const cpuError = await thrown(() => launchIn(wsCpu, { exec: execCpu, extra: ['--cpu', '99'] }))
  assert.ok(cpuError instanceof Refusal, `(b) [M2] --cpu 99 is a Refusal, got ${cpuError?.name}: ${cpuError?.message}`)
  assert.equal(cpuError.exitCode, 2, '(b) [M2] exit 2')
  assert.equal(
    cpuError.message,
    `launch: --cpu 99 does not fit the plan — billing plan --json says max_cpus ${BILLING_OK.max_cpus}`,
    '(b) [M2] the billing-plan refusal for a cpu above max_cpus is word for word BASE\'s'
  )
  assert.deepEqual(execCpu.mutating(), [], '(b) [M2] and nothing was mutated')
  wsCpu.cleanup()

  const wsMem = workspace()
  const execMem = makeExec({ rules: readRules({ repo: wsMem.repo, compiled: TEN_WIDE }) })
  const memError = await thrown(() => launchIn(wsMem, { exec: execMem, extra: ['--memory', '999GB'] }))
  assert.ok(memError instanceof Refusal, `(b) [M2] --memory 999GB is a Refusal, got ${memError?.name}: ${memError?.message}`)
  assert.equal(memError.exitCode, 2, '(b) [M2] exit 2')
  assert.equal(
    memError.message,
    `launch: --memory 999GB does not fit the plan — billing plan --json says max_memory_gb ${BILLING_OK.max_memory_gb}`,
    '(b) [M2] the billing-plan refusal for a memory above max_memory_gb is word for word BASE\'s'
  )
  assert.deepEqual(execMem.mutating(), [], '(b) [M2] and nothing was mutated')
  wsMem.cleanup()
}

// ── c. [M3] one stamped compile per un-bumped launch, before the verb ───────
//
// Both launches below push to their own origin, which holds no `ultra/plan-*`
// ref at all, so the first push wins and the first N is the N: exactly one
// stamped compile. Run-128 task 2 made the compile follow the number — a
// launch whose push is refused re-reads the target, bumps to N+1 and compiles
// AGAIN under it, so that the sheets it files name the exam directory the
// sandbox will actually reserve — so "one per launch" is now "one per run
// number the launch attempts". The bumped count is `test_launch_bump.mjs`'s
// leg (a); this leg pins the un-bumped launch it has always driven.
{
  const solo = await drive({ compiled: TEN_WIDE, config: CAPPED })
  const soloStamps = stampCalls(solo.exec)
  assert.equal(
    soloStamps.length, 1,
    `(c) [M3] exactly one compile_plan.py --stamp per un-bumped launch, got ${soloStamps.length}: ${soloStamps.map((c) => c.argv.join(' ')).join(' | ')}`
  )
  const call = soloStamps[0]
  assert.equal(call.argv[0], COMPILER, '(c) [M3] the plugin\'s own compile_plan.py')
  assert.ok(call.argv.includes(solo.ws.planPath), '(c) [M3] the plan path is on the line')
  assert.equal(
    call.argv[call.argv.indexOf('--base') + 1], solo.ws.repo.base,
    '(c) [M3] --base <sha> is the launch\'s base'
  )
  assert.match(
    String(call.argv[call.argv.indexOf('--stamp') + 1]), /^run-\d+$/,
    '(c) [M3] --stamp run-<N>'
  )
  assert.equal(call.options?.cwd, solo.ws.repo.dir, '(c) [M3] run in the checkout')
  assert.ok(indexOfNew(solo.exec) >= 0, '(c) [M3] the launch reached the `new` verb')
  assert.ok(
    indexOfStamp(solo.exec) < indexOfNew(solo.exec),
    '(c) [M3] the stamped compile is ordered before the `new` verb'
  )
  solo.ws.cleanup()

  const hub = makeFakeKata()
  const filed = await drive({ compiled: TEN_WIDE, config: CAPPED, kata: hub })
  assert.equal(
    stampCalls(filed.exec).length, 1,
    '(c) [M3] with a hub too: one stamped compile for this un-bumped launch, not one per reader'
  )
  assert.ok(
    indexOfStamp(filed.exec) < indexOfNew(filed.exec),
    '(c) [M3] still ordered before the `new` verb'
  )
  const createdTasks = hub.calls
    .filter((c) => c.method === 'createIssue')
    .map((c) => c.args[1]?.metadata?.task)
    .filter((id) => id !== undefined && id !== null)
    .map(String)
  assert.deepEqual(
    createdTasks, TEN_WIDE_IDS,
    '(c) [M3] the filing read that one payload: one issue per task of it, in wave order'
  )
  assert.deepEqual(
    sizeOf(filed.exec, '(c) [M3]'), { cpu: '6', memory: '8GB' },
    '(c) [M3] and the sizing read the same payload'
  )
  filed.ws.cleanup()
}

// ── d. [M4] the width is the plan's, from the launcher to the dispatch bound ─
{
  const one = await drive({ compiled: ONE_TASK, config: CAPPED })
  assert.match(
    assignmentOf(one.exec, '(d) [M4]'), /width["']?\s*[:=]\s*["']?1\b/,
    '(d) [M4] the launch arguments the sandbox receives carry width 1 for a one-task plan'
  )
  one.ws.cleanup()

  const ten = await drive({ compiled: TEN_WIDE, config: CAPPED })
  assert.match(
    assignmentOf(ten.exec, '(d) [M4]'), /width["']?\s*[:=]\s*["']?10\b/,
    '(d) [M4] and width 10 — the widest wave of 2/10/1 — for the wide one'
  )
  ten.ws.cleanup()

  assert.equal(
    typeof runMainModule.widthOf, 'function',
    '(d) [M4] fleet/run-main.mjs exports widthOf(args)'
  )
  assert.equal(runMainModule.widthOf({ width: 4 }), 4, '(d) [M4] widthOf({ width: 4 }) is 4')
  assert.equal(runMainModule.widthOf({}), 12, '(d) [M4] widthOf({}) is 12 — the fallback keeps an older assignment booting')
  assert.equal(runMainModule.widthOf({ width: 0 }), 12, '(d) [M4] widthOf({ width: 0 }) is 12: a positive integer or nothing')

  const runMainSource = fs.readFileSync(RUN_MAIN, 'utf8')
  assert.equal(
    (runMainSource.match(/WIDTH = 12/g) ?? []).length, 0,
    '(d) [M4] the string `WIDTH = 12` does not occur in fleet/run-main.mjs'
  )
  assert.ok(
    runMainSource.includes('boundedParallel(widthOf('),
    '(d) [M4] the dispatch bound is built as boundedParallel(widthOf(…))'
  )

  // …and the value that bound is actually built from. `widthOf` reads the
  // `width` of the arguments `run-main` composes, and those come from the
  // box's own `args.json` — which carries `waves` and no `width` at all, since
  // `compile_plan.py --emit-args` writes none and `ultra_run.py` adds only the
  // two command knobs. So a run whose width came from nowhere but the launcher
  // would dispatch at the fallback however faithfully the `new` verb spelled
  // the number. What is pinned here is the derivation the composed arguments
  // get their `width` from, over an `args.json` shaped like the box's.
  assert.equal(
    typeof runMainModule.widestWaveOf, 'function',
    '(d) [M4] fleet/run-main.mjs exports the derivation its launch arguments take `width` from'
  )
  const ARGS_JSON = { waves: TEN_WIDE.launch_waves, testCmd: 'pytest -q' }
  assert.equal(
    runMainModule.widestWaveOf(ARGS_JSON), 10,
    '(d) [M4] over the box\'s own compile — waves of 2/10/1, no `width` key — the derivation is 10'
  )
  assert.notEqual(
    runMainModule.widestWaveOf(ARGS_JSON), runMainModule.WIDTH_FALLBACK,
    '(d) [M4] and so is NOT the 12 the fallback would have answered for those same arguments'
  )
  assert.equal(
    runMainModule.widthOf({ ...ARGS_JSON, width: runMainModule.widestWaveOf(ARGS_JSON) }), 10,
    '(d) [M4] which is what `widthOf` — and therefore boundedParallel — then answers'
  )
  assert.equal(
    runMainModule.widestWaveOf({ ...ARGS_JSON, width: 4 }), 4,
    '(d) [M4] an explicit positive `width` on the arguments still wins over the waves'
  )
  assert.equal(
    runMainModule.widestWaveOf({ waves: [] }), 12,
    '(d) [M4] and nothing to read is still the fallback: a re-drive of an older assignment boots'
  )
  assert.match(
    runMainSource, /width:\s*widestWaveOf\(argsObj\)/,
    '(d) [M4] the launch arguments run-main composes take their `width` from that derivation'
  )
}

// ── e. [M5] the flags are still offered, and the RUNBOOK says ceiling ───────
{
  assert.ok(USAGE.includes('[--cpu <n>]'), '(e) [M5] --help still lists [--cpu <n>]')
  assert.ok(USAGE.includes('[--memory <n>GB]'), '(e) [M5] --help still lists [--memory <n>GB]')

  const lines = fs.readFileSync(RUNBOOK, 'utf8').split('\n')
  const from = lines.findIndex((l) => l.startsWith('## One-time setup'))
  assert.ok(from >= 0, '(e) [M5] fleet/RUNBOOK.md has a `## One-time setup` section')
  const to = lines.findIndex((l, i) => i > from && l.startsWith('## '))
  const section = lines.slice(from, to < 0 ? lines.length : to).join(' ')
  assert.match(section, /ceiling/i, '(e) [M5] the one-time-setup section says ceiling')
  for (const word of ['cpu', 'memory', 'fleet.json']) {
    assert.ok(section.includes(word), `(e) [M5] and still names ${word}`)
  }
}

// ── f. [Produces] vmSizeFor is the formula, exported and pure ───────────────
{
  assert.equal(
    typeof launchModule.vmSizeFor, 'function',
    '(f) [Produces] fleet/launch.mjs exports vmSizeFor(widestWave, cap)'
  )
  const { vmSizeFor } = launchModule
  assert.deepEqual(vmSizeFor(1, CAPPED), { cpu: '3', memory: '3GB' }, '(f) [Produces] W = 1 under 6/8GB')
  assert.deepEqual(vmSizeFor(10, CAPPED), { cpu: '6', memory: '8GB' }, '(f) [Produces] W = 10 under 6/8GB')
  assert.deepEqual(vmSizeFor(1, FLEET_DEFAULTS), { cpu: '3', memory: '3GB' }, '(f) [Produces] W = 1 under the defaults')
  assert.deepEqual(vmSizeFor(2, FLEET_DEFAULTS), { cpu: '3', memory: '4GB' }, '(f) [Produces] ceil(2/3) is 1, in integers')
  assert.deepEqual(vmSizeFor(4, FLEET_DEFAULTS), { cpu: '4', memory: '6GB' }, '(f) [Produces] ceil(4/3) is 2, in integers')
  assert.deepEqual(vmSizeFor(10, FLEET_DEFAULTS), { cpu: '6', memory: '12GB' }, '(f) [Produces] W = 10 under the defaults')
  assert.deepEqual(vmSizeFor(100, FLEET_DEFAULTS), { cpu: '8', memory: '16GB' }, '(f) [Produces] both clamped at the cap')
  assert.deepEqual(vmSizeFor(10, CAPPED), { cpu: '6', memory: '8GB' }, '(f) [Produces] pure: the same answer twice')
}

console.log('ALL TESTS PASSED')
