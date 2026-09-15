/**
 * fleet/tests/test_launch_bump.mjs — the exam for "A bumped launch files its
 * sheets under the number it got" (task 2).
 *
 * A launch compiles the plan once, stamped with the run number it read off the
 * target; when the push of `ultra/plan-run-<N>` is refused and the launcher
 * bumps to N+1, that first payload is re-filed under the new number, so the
 * sheets on the hub name `exams/run_<N>/` while the box's own compile names
 * `exams/run_<N+1>/`. After this run the compile follows the number.
 *
 * The Machine clauses this file is written against, restated:
 *
 *   M1  when the plan push for `ultra/plan-run-<N>` is refused and the launcher
 *       re-reads the target's highest run and bumps to N+1, it runs
 *       `compile_plan.py <plan> --stamp run-<N+1> --base <sha>` BEFORE filing
 *       the hub's project and sheets for N+1, and the sheets it files carry the
 *       N+1 stamp's exam directory (`exams/run_<N+1>/`), never `run_<N>`'s.
 *   M2  a launch that is not bumped runs exactly one stamped compile, ordered
 *       before its `new` verb, and the VM size read off that compile is
 *       unchanged from BASE.
 *   M3  on a bump, the size the `new` verb carries is computed from the
 *       recompiled payload, and the assignment comment carries `run=<N+1>`.
 *
 * The legs, each naming the clause it comes from:
 *
 *   (a) [M1] under the fake lobby with the first push refused, the fake exec
 *       records two stamped compiles, `run-1` then `run-2`; the second is
 *       ordered after the refused push and before the project filed for run 2;
 *       and the project and sheets filed on the fake hub for run 2 carry
 *       `run_2` in every exam path and no `run_1` anywhere.
 *   (b) [M2] with no push refused, exactly one stamped compile is recorded,
 *       before the `new` verb, and the `--cpu`/`--memory` on `new` equal BASE's
 *       for the same plan — `6`/`8GB`, the formula's answer for a widest wave
 *       of 10 under the caps `6`/`8GB`. The sizing sim beside this one keeps its
 *       leg (c) and its sentinel; running it is the Proof's second `Run:`, and
 *       not this file's, because no `test_*.mjs` may spawn another
 *       (`fleet/tests/test_sims_are_hermetic.mjs`, M4) — so what is read here is
 *       its source, and the driver runs it.
 *   (c) [M3] on the bumped launch, the `new` verb's `--comment` carries `run=2`
 *       and its `--cpu`/`--memory` equal the size computed from the SECOND
 *       compile's waves.
 *
 * How the bump is driven, and why the two compiles answer different payloads:
 *
 *   The refusal is real, not a story the seam tells. The rule that refuses the
 *   first push of `ultra/plan-run-1` first pushes `base` onto the bare origin as
 *   that very ref — the racing launch, arriving — so the launcher's own re-read
 *   of `highestRunOnTarget` reads 1 as taken off the target's refs and bumps to
 *   2 by its own arithmetic. Nothing here parses or fakes git's wording.
 *
 *   The compiler stub answers per `--stamp`, the way the real compiler does:
 *   `run-1` yields waves of 2/10/1 with every Proof path landing under
 *   `tests/exams/run_1/`, `run-2` yields waves of 2/4/1 landing under
 *   `tests/exams/run_2/`. Two payloads is what makes M3 falsifiable at all: the
 *   widest wave of the first is 10 (`--cpu 6 --memory 8GB` under the caps) and
 *   of the second is 4 (`--cpu 4 --memory 6GB`), so a launch that sized the box
 *   off the compile it no longer files is red here. A stamp the stub was not
 *   given answers non-zero, so a third compile is a refusal and not a silence.
 *
 * Everything a launch would execute is answered by the exec seam, and the
 * compiler is never really run; the only real subprocesses are the fixture's own
 * git commands against a bare origin on disk. No socket is opened. The
 * scaffolding is `fleet/tests/test_launch_size.mjs`'s, copied rather than
 * imported — that file exports nothing, and its own header records the same
 * convention.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { launch } from '../launch.mjs'
import { EXE_HOST, defaultExec, parseComment } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-14T18:20:00.000Z')
/** The caps every drive here runs under: a `fleet.json` saying `6` and `8GB`. */
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TESTS_DIR = path.join(FLEET_DIR, 'tests')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
/** The compiler the launcher must name: the plugin's own. */
const COMPILER = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')
/** The sizing sim leg (b) reads — read, never run: a sim spawns no sibling sim. */
const SIZE_SIM = path.join(TESTS_DIR, 'test_launch_size.mjs')

/** The run the target's refs make this launch ask for first, and the one the
 *  race then forces it onto. */
const FIRST = 1
const BUMPED = 2
const planBranch = (n) => `ultra/plan-run-${n}`
/** The TARGET's one project (#978 task 2, M1): the name carries no number, so
 *  every attempted N of every launch against this target files into it. */
const PROJECT_NAME = 'popmechanic-smoke'

// ── The compiled plan, as the stub answers it, per stamp ────────────────────

/** `run-7` -> `run_7`: `compile_plan.py`'s `exam_slug`. */
const examSlug = (stamp) => String(stamp).replace(/[^A-Za-z0-9_]/g, '_')
/** Where a task's Proof path lands under a stamp: the reserved exam directory. */
const examPathFor = (stamp, id) => `tests/exams/${examSlug(stamp)}/t${id}_test.py`
/** One task's fact sheet, in the shape the launcher carries whole to the hub. */
const factsheetFor = (stamp, id) => ({
  files: [`src/f${id}.py`, `tests/t${id}_test.py`],
  deletes: [],
  guards: [],
  proofTests: [`tests/t${id}_test.py`],
  landing: { [`tests/t${id}_test.py`]: examPathFor(stamp, id) },
  driverOwned: [examPathFor(stamp, id), `tests/exams/${examSlug(stamp)}/__init__.py`],
  siblingOwned: [],
  produces: [],
  consumes: []
})
const taskFor = (stamp, id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: factsheetFor(stamp, id)
})
/** A payload of waves of the given sizes, task ids 1.. in wave order. */
const payloadFor = (stamp, sizes) => {
  let n = 0
  return {
    launch_waves: sizes.map((size) => Array.from({ length: size }, () => taskFor(stamp, (n += 1)))),
    dag_edges: []
  }
}
/**
 * The two stamps this exam's compiler knows, and nothing else. The widest wave
 * differs on purpose — see the header: it is what tells a size read off the
 * recompiled payload from one read off the payload the run no longer files.
 */
const PAYLOADS = {
  [`run-${FIRST}`]: payloadFor(`run-${FIRST}`, [2, 10, 1]),
  [`run-${BUMPED}`]: payloadFor(`run-${BUMPED}`, [2, 4, 1])
}
const idsOf = (payload) => payload.launch_waves.flat().map((t) => t.id)
/** BASE's size for the 2/10/1 plan under the 6/8GB caps: min(6, 2 + ceil(10/3))
 *  and min(8, 2 + 10). */
const SIZE_OF_FIRST = { cpu: '6', memory: '8GB' }
/** And for the 2/4/1 one: min(6, 2 + ceil(4/3)) and min(8, 2 + 4). */
const SIZE_OF_SECOND = { cpu: '4', memory: '6GB' }

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
/** `--check` answers `PLAN OK`; a stamped compile answers that stamp's payload,
 *  and a stamp this exam did not prepare is a non-zero exit rather than a
 *  silence the launcher would read as JSON. */
const COMPILER_RULE = {
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) => {
    if (argv.includes('--check')) return answer('PLAN OK\n')
    const stamp = String(argv[argv.indexOf('--stamp') + 1] ?? '')
    const payload = PAYLOADS[stamp]
    return payload === undefined
      ? answer('', { code: 3, stderr: `exam: no payload prepared for --stamp ${stamp}\n` })
      : answer(JSON.stringify(payload))
  }
}

/**
 * The race, made real: the first push of `ultra/plan-run-<FIRST>` is refused,
 * and the ref it wanted appears on the origin at that moment — pushed there by
 * the fixture, as another launch would have. The launcher's own re-read is what
 * then decides the number; nothing here tells it which one to take.
 */
const refusedFirstPush = (repo, state) => ({
  when: (cmd, argv) => cmd === 'git' && argv.includes('push') &&
    argv.some((a) => String(a).endsWith(`:refs/heads/${planBranch(FIRST)}`)),
  answer: () => {
    state.refusals += 1
    repo.git(['push', repo.origin, `${repo.base}:refs/heads/${planBranch(FIRST)}`])
    return answer('', {
      code: 1,
      stderr: ` ! [rejected]        ${planBranch(FIRST)} (non-fast-forward)\n` +
        `error: failed to push some refs to '${ORIGIN_URL}'\n`
    })
  }
})

const readRules = ({ repo, bump = null }) => [
  ENGINE_RULE,
  ...(bump === null ? [] : [refusedFirstPush(repo, bump)]),
  localRemote(repo),
  COMPILER_RULE,
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The hub, faked: a recorder with the client's method names ───────────────
//
// Every call records `at`, the number of exec calls made when it was issued, so
// a leg can say a compile came before a filing without the two records having
// to share a clock.
//
// It models the three hub behaviours this file's legs read (#978 task 2, kata
// v0.17.2): a project store keyed by NAME, so `createProject` of a name it
// already holds answers the project that is there; an issue store keyed by
// `Idempotency-Key`, so the same key with a byte-identical create body answers
// the same issue — at the revision the CREATE answered, not the issue's current
// one — and the same key with a different body throws as kata's 409
// `idempotency_mismatch` does; and a per-key metadata merge.

const ULID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`
/** What kata fingerprints beside the key: the create's own fields. */
const fingerprint = (spec) => JSON.stringify([
  spec?.title ?? null, spec?.body ?? null, spec?.metadata ?? null, spec?.links ?? null
])
function makeFakeKata ({ at = () => 0, url = 'http://hub.fake' } = {}) {
  const calls = []
  const projects = new Map()
  const issues = new Map()
  const byKey = new Map()
  const links = []
  const rec = (method, args) => calls.push({ method, args, at: at() })
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
      const print = fingerprint(spec)
      if (key !== undefined && byKey.has(key)) {
        const seen = byKey.get(key)
        if (seen.fingerprint !== print) {
          throw new Error(`idempotency_mismatch for ${key}`)
        }
        // The replay answers the create's own revision, while the issue itself
        // has moved on — which is why the launcher reads before it patches.
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
      for (const link of spec?.links ?? []) links.push({ from: issue.uid, ...link })
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
      if (spec?.type === 'parent') {
        const held = links.find((l) => l.from === fromUid && l.type === 'parent')
        if (held && !spec.replace) throw new Error('parent_already_set')
        if (held) held.to_ref = spec.to_ref
        else links.push({ from: fromUid, type: spec.type, to_ref: spec.to_ref })
      } else if (!links.some((l) => l.from === fromUid && l.type === spec?.type && l.to_ref === spec?.to_ref)) {
        links.push({ from: fromUid, type: spec?.type, to_ref: spec?.to_ref })
      }
      if (issue) issue.revision += 1
      return issue ? answer(issue) : { revision: 2 }
    },
    async close (projectId, uid, spec) {
      rec('close', [projectId, uid, spec])
      const issue = issues.get(uid)
      if (!issue) throw new Error(`no such issue ${uid}`)
      issue.status = 'closed'
      issue.closed = { reason: spec?.reason, message: spec?.message }
      issue.revision += 1
      return answer(issue)
    },
    async getIssue (uid) {
      rec('getIssue', [uid])
      const issue = issues.get(uid)
      if (!issue) throw new Error(`no such issue ${uid}`)
      return answer(issue)
    },
    /** The open issues of a project no OPEN `blocks` link points at. */
    ready (projectId) {
      const open = [...issues.values()].filter((i) => i.project_id === projectId && i.status === 'open')
      const blocked = new Set(links
        .filter((l) => l.type === 'blocks' && issues.get(l.from)?.status === 'open')
        .map((l) => l.to_ref))
      return open.filter((i) => !blocked.has(i.uid)).map((i) => i.uid)
    }
  }
}

// ── The workspace ───────────────────────────────────────────────────────────

function workspace () {
  const root = tempDir('fleet-launch-bump-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** One launch, end to end. `bump` asks for the refused first push. */
const drive = async ({ bump = false, withHub = true } = {}) => {
  const ws = workspace()
  const state = { refusals: 0 }
  const exec = makeExec({ rules: readRules({ repo: ws.repo, bump: bump ? state : null }) })
  const hub = withHub ? makeFakeKata({ at: () => exec.calls.length }) : null
  const result = await launch({
    argv: [
      ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
      '--engine', ENGINE
    ],
    exec,
    config: CAPPED,
    now: () => NOW,
    sleep: async () => {},
    refreshCredential: () => ({ ok: true }),
    kata: hub
  })
  return { result, exec, hub, ws, state }
}

// ── Reading the calls ───────────────────────────────────────────────────────

const newCallOf = (exec) => exec.calls.find(
  (c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new ')
)
const indexOfNew = (exec) => exec.calls.findIndex(
  (c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new ')
)
/** Every `compile_plan.py … --stamp …` the launch ran, in order. */
const stampCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3' && c.argv.includes('--stamp'))
const stampsOf = (exec) => stampCalls(exec).map((c) => String(c.argv[c.argv.indexOf('--stamp') + 1]))
const indexOfStamp = (exec, stamp) => exec.calls.findIndex(
  (c) => c.cmd === 'python3' && c.argv[c.argv.indexOf('--stamp') + 1] === stamp
)
const indexOfPush = (exec, branch) => exec.calls.findIndex(
  (c) => c.cmd === 'git' && c.argv.includes('push') &&
    c.argv.some((a) => String(a).endsWith(`:refs/heads/${branch}`))
)
/** The `--cpu`/`--memory` pair the `new` verb carries. */
const sizeOf = (exec, leg) => {
  const call = newCallOf(exec)
  assert.ok(call, `${leg} the launch issued a \`new\` verb`)
  const m = /--cpu (\S+) --memory (\S+)/.exec(String(call.argv[1] ?? ''))
  assert.ok(m, `${leg} the \`new\` verb carries --cpu <n> --memory <n>GB, got ${call.argv[1]}`)
  return { cpu: m[1], memory: m[2] }
}
/** The assignment `--comment` the `new` verb carries, as its fields. */
const commentOf = (exec, leg) => {
  const call = newCallOf(exec)
  assert.ok(call, `${leg} the launch issued a \`new\` verb`)
  const m = /--comment '([^']*)'/.exec(String(call.argv[1] ?? ''))
  assert.ok(m, `${leg} the \`new\` verb carries --comment '<fields>', got ${call.argv[1]}`)
  return { text: m[1], fields: parseComment(m[1]) }
}
const methodCalls = (hub, method) => hub.calls.filter((c) => c.method === method)
/** The issues filed against one project, in the order they were created. */
const issuesOf = (hub, projectId) => methodCalls(hub, 'createIssue').filter((c) => c.args[0] === projectId)
const sheetsOf = (hub, projectId) => issuesOf(hub, projectId)
  .filter((c) => c.args[1]?.metadata?.task !== undefined)
/** The fact sheets filed for one run number. A create no longer carries one —
 *  it carries only `{task, plan}`, so the same key answers the same issue on
 *  every launch of the plan (#978 task 2, M2) — so the sheet arrives as the
 *  metadata patch that follows, and THAT is where a number's sheets are read. */
const patchesFor = (hub, n) => methodCalls(hub, 'patchMetadata').filter((c) => c.args[2]?.run === n)
/** The task id of the issue a call names, off the fake's own issue store. */
const taskOf = (hub, uid) => String(hub.issues.get(uid)?.metadata?.task)

// ── a. [M1] the bump recompiles, and files the new number's sheets ──────────
{
  const run = await drive({ bump: true })

  assert.equal(
    run.state.refusals, 1,
    '(a) [M1] the fixture refused exactly one push — the bump this leg is about'
  )
  assert.equal(
    run.result.run, BUMPED,
    `(a) [M1] the launcher re-read the target's highest run and bumped to ${BUMPED}`
  )
  assert.equal(run.result.runId, `run-${BUMPED}`, `(a) [M1] its run id is run-${BUMPED}`)
  assert.equal(
    run.result.planBranch, planBranch(BUMPED),
    `(a) [M1] and its plan is on ${planBranch(BUMPED)}`
  )

  assert.deepEqual(
    stampsOf(run.exec), [`run-${FIRST}`, `run-${BUMPED}`],
    `(a) [M1] the fake exec records two stamped compiles, run-${FIRST} then run-${BUMPED}: ` +
    `got ${JSON.stringify(stampsOf(run.exec))}`
  )
  const second = stampCalls(run.exec)[1]
  assert.deepEqual(
    second.argv,
    [COMPILER, run.ws.planPath, '--stamp', `run-${BUMPED}`, '--base', run.ws.repo.base],
    '(a) [M1] the second is `compile_plan.py <plan> --stamp run-2 --base <sha>`, the clause\'s own line: ' +
    `got ${second.argv.join(' ')}`
  )
  assert.equal(second.options?.cwd, run.ws.repo.dir, '(a) [M1] run in the checkout, as the first is')

  const firstPushAt = indexOfPush(run.exec, planBranch(FIRST))
  const secondCompileAt = indexOfStamp(run.exec, `run-${BUMPED}`)
  assert.ok(firstPushAt >= 0, `(a) [M1] the launch pushed ${planBranch(FIRST)} first`)
  assert.ok(
    secondCompileAt > firstPushAt,
    `(a) [M1] the second compile follows the refused push — it is what the bump causes, not a ` +
    `compile made in advance (push at ${firstPushAt}, compile at ${secondCompileAt})`
  )

  const projects = methodCalls(run.hub, 'createProject')
  assert.deepEqual(
    projects.map((c) => c.args[0]), [PROJECT_NAME, PROJECT_NAME],
    `(a) [M1] both attempts name the TARGET's one project, which carries no run number: ` +
    `${JSON.stringify(projects.map((c) => c.args[0]))}`
  )
  assert.equal(
    run.hub.projects.size, 1,
    '(a) [M1] and the hub holds one project after both — the second `createProject` of a name it ' +
    'already has answers the project that is there'
  )
  assert.ok(
    projects[1].at > secondCompileAt,
    `(a) [M1] and the ${BUMPED} compile is ordered BEFORE the hub is filed for ${BUMPED} ` +
    `(compile at exec call ${secondCompileAt}, createProject after ${projects[1].at})`
  )
  assert.equal(
    typeof run.hub.purgeProject, 'undefined',
    '(a) [M5] there is no `purgeProject` on the hub at all — a bump destroys nothing'
  )
  assert.deepEqual(
    methodCalls(run.hub, 'purgeProject'), [],
    '(a) [M5] and the bump made no purge call'
  )

  const filed = patchesFor(run.hub, BUMPED)
  assert.deepEqual(
    filed.map((c) => taskOf(run.hub, c.args[1])), idsOf(PAYLOADS[`run-${BUMPED}`]),
    `(a) [M1] the sheets filed for run ${BUMPED} are the run-${BUMPED} compile's tasks, in wave order: ` +
    `got ${JSON.stringify(filed.map((c) => taskOf(run.hub, c.args[1])))}`
  )
  for (const call of filed) {
    const id = taskOf(run.hub, call.args[1])
    assert.deepEqual(
      call.args[2].factsheet, factsheetFor(`run-${BUMPED}`, id),
      `(a) [M1] task ${id}'s fact sheet is the run-${BUMPED} stamp's, whole — its Proof path lands at ` +
      `${examPathFor(`run-${BUMPED}`, id)}: got ${JSON.stringify(call.args[2].factsheet)}`
    )
  }
  const filedForBumped = JSON.stringify(filed)
  assert.equal(
    filedForBumped.includes(`exams/${examSlug(`run-${BUMPED}`)}/`), true,
    `(a) [M1] every exam path filed for run ${BUMPED} names exams/${examSlug(`run-${BUMPED}`)}/`
  )
  assert.equal(
    filedForBumped.includes(examSlug(`run-${FIRST}`)), false,
    `(a) [M1] and nothing filed for run ${BUMPED} names ${examSlug(`run-${FIRST}`)} — the first ` +
    `number's reserved exam directory is not what the box will use`
  )

  // What the bump does INSTEAD of purging: the run issue for the number that
  // was taken is closed `wontfix`, and the task issues are refiled under the
  // new run issue rather than replaced.
  const closes = methodCalls(run.hub, 'close')
  assert.equal(closes.length, 1, `(a) [M5] exactly one close: got ${closes.length}`)
  assert.equal(closes[0].args[2]?.reason, 'wontfix', '(a) [M5] its reason is `wontfix`')
  assert.ok(
    String(closes[0].args[2]?.message ?? '').includes(`run-${FIRST}`),
    `(a) [M5] and its message names the number that was taken: ` +
    `got ${JSON.stringify(closes[0].args[2]?.message)}`
  )
  assert.ok(
    String(closes[0].args[2]?.message ?? '').length >= 40,
    '(a) [M5] a message of at least 40 characters, not a word'
  )
  const closedIssue = run.hub.issues.get(closes[0].args[1])
  assert.equal(
    closedIssue?.metadata?.run, FIRST,
    `(a) [M5] and what it closed is the run-${FIRST} issue: got ${JSON.stringify(closedIssue?.metadata)}`
  )
  const taskKeys = sheetsOf(run.hub, 1).map((c) => c.args[1].idempotencyKey)
  assert.ok(
    taskKeys.length > 0 && taskKeys.every((key) => typeof key === 'string' && key !== ''),
    '(a) [M2] every task create carried an Idempotency-Key'
  )
  assert.equal(
    run.hub.issues.size,
    idsOf(PAYLOADS[`run-${FIRST}`]).length + 2,
    '(a) [M5] and the refiling created no second issue for a task the first number already filed: ' +
    'the 13 tasks of the wider compile plus one run issue per attempted number'
  )

  run.ws.cleanup()
}

// ── b. [M2] an un-bumped launch still compiles once, and is sized as at BASE ─
{
  const solo = await drive({ bump: false, withHub: false })
  assert.equal(solo.state.refusals, 0, '(b) [M2] no push was refused')
  assert.equal(solo.result.run, FIRST, `(b) [M2] so the launch kept the number it read, ${FIRST}`)
  assert.deepEqual(
    stampsOf(solo.exec), [`run-${FIRST}`],
    `(b) [M2] exactly one stamped compile, run-${FIRST}: got ${JSON.stringify(stampsOf(solo.exec))}`
  )
  assert.ok(indexOfNew(solo.exec) >= 0, '(b) [M2] the launch reached the `new` verb')
  assert.ok(
    indexOfStamp(solo.exec, `run-${FIRST}`) < indexOfNew(solo.exec),
    '(b) [M2] ordered before the `new` verb'
  )
  assert.deepEqual(
    sizeOf(solo.exec, '(b) [M2]'), SIZE_OF_FIRST,
    '(b) [M2] and the size on `new` is BASE\'s for this plan: a widest wave of 10 under the caps ' +
    '6/8GB is --cpu 6 --memory 8GB'
  )
  solo.ws.cleanup()

  const filed = await drive({ bump: false, withHub: true })
  assert.deepEqual(
    stampsOf(filed.exec), [`run-${FIRST}`],
    '(b) [M2] with a hub too: one stamped compile, not one per reader'
  )
  assert.ok(
    indexOfStamp(filed.exec, `run-${FIRST}`) < indexOfNew(filed.exec),
    '(b) [M2] still ordered before the `new` verb'
  )
  assert.deepEqual(
    methodCalls(filed.hub, 'createProject').map((c) => c.args[0]), [PROJECT_NAME],
    '(b) [M2] one project, the target\'s, named once by the launch that was not bumped'
  )
  assert.deepEqual(
    sheetsOf(filed.hub, 1).map((c) => String(c.args[1].metadata.task)), idsOf(PAYLOADS[`run-${FIRST}`]),
    `(b) [M2] and the sheets are that one compile's tasks`
  )
  assert.deepEqual(
    sizeOf(filed.exec, '(b) [M2]'), SIZE_OF_FIRST,
    '(b) [M2] sized off the same compile'
  )
  filed.ws.cleanup()

  // The sizing sim's own leg (c) is narrowed to the un-bumped launch in place,
  // and the sim still prints its sentinel. Reading it is all this file may do —
  // `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids one sim spawning
  // another — so the running of it is the Proof's second `Run:`, which the
  // driver executes and greps for that sentinel.
  const sizeSim = fs.readFileSync(SIZE_SIM, 'utf8')
  assert.ok(
    sizeSim.includes('(c) [M3]'),
    '(b) [M2] fleet/tests/test_launch_size.mjs keeps its leg (c) — the one-compile pin is narrowed ' +
    'to the un-bumped launch in place, not deleted'
  )
  assert.ok(
    sizeSim.includes('ALL TESTS PASSED'),
    '(b) [M2] and it still prints the sentinel the Proof\'s second `Run:` greps for'
  )
}

// ── c. [M3] the bumped launch is sized and labelled by the compile it kept ──
{
  const run = await drive({ bump: true })

  const comment = commentOf(run.exec, '(c) [M3]')
  assert.equal(
    comment.fields.run, String(BUMPED),
    `(c) [M3] the \`new\` verb's --comment carries run=${BUMPED}: got ${JSON.stringify(comment.text)}`
  )
  assert.deepEqual(
    sizeOf(run.exec, '(c) [M3]'), SIZE_OF_SECOND,
    `(c) [M3] and its --cpu/--memory are the size computed from the second compile's waves — the ` +
    `run-${BUMPED} payload's widest wave is 4, so --cpu 4 --memory 6GB under the caps 6/8GB`
  )
  assert.notDeepEqual(
    sizeOf(run.exec, '(c) [M3]'), SIZE_OF_FIRST,
    `(c) [M3] and so NOT the size of the run-${FIRST} payload the bump left behind (--cpu 6 --memory 8GB)`
  )
  assert.equal(
    parseComment(run.result.comment).run, String(BUMPED),
    `(c) [M3] the record's own comment says the same run=${BUMPED}`
  )

  run.ws.cleanup()
}

console.log('ALL TESTS PASSED')
