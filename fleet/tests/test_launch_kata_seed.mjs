/**
 * fleet/tests/test_launch_kata_seed.mjs — the exam for "The launcher files a
 * run into the target's one project, as an idempotent seed with its edges, and
 * a bump refiles instead of purging" (task 2).
 *
 * At BASE a launch files a project PER RUN NUMBER (`<owner>-<repo>-run-<N>`),
 * creates every issue unconditionally, carries each task's whole fact sheet in
 * the create body, hangs the parent off the create's `links`, and — when the
 * push is refused and the number bumps — PURGES what it filed before filing
 * again. After this run there is one project per target, a task issue is
 * created once per plan text under an `Idempotency-Key`, its run/wave/sheet
 * arrive as a metadata patch under the revision a read answered, its parent is
 * set with `replace: true`, and a bump refiles under N+1 and closes the run-N
 * issue `wontfix` rather than purging anything.
 *
 * The Machine clauses this file is written against, restated:
 *
 *   M1  `kataProjectFor(target)` takes ONE argument and answers
 *       `<owner>-<repo>` (every `/` of the target spelled `-`); the launcher's
 *       `createProject` is called with exactly that name, and a hub that
 *       already holds the name answers the existing project, which the
 *       launcher files into.
 *   M2  each task issue is created with an `Idempotency-Key` equal to
 *       `<target>:<plan sha>:task-<id>`, `<plan sha>` the 40-hex git blob sha
 *       of the plan text, and a create body that is the same on every launch of
 *       the same plan text — `title` `task <id>: <title>`, empty `body`,
 *       `metadata` `{task, plan}` and no `links` — so two launches of one plan
 *       against one hub create each task issue once and both records name the
 *       same task uids.
 *   M3  after each task's create the launcher reads the issue, patches its
 *       metadata with `{run, wave, factsheet}` UNDER THAT READ'S REVISION, and
 *       sets the run issue as its parent with `replace: true`; and for every
 *       `dag_edges` entry one `blocks` link is created on the blocker naming
 *       the blocked task's uid, whatever the entry's `why`.
 *   M4  a task no `dag_edges` entry names as `to` has no `blocks` link pointing
 *       at it when filing ends.
 *   M5  when the first push is refused and the number bumps, no `purgeProject`
 *       call is made and `purgeProject` is not defined in
 *       `fleet/kata-client.mjs` or `fleet/launch.mjs`; the launcher creates the
 *       run issue for N+1, refiles every task (the same keys, the same bodies),
 *       patches each task's metadata to the N+1 compile's `{run, wave,
 *       factsheet}`, sets each parent to the N+1 run issue, and closes the
 *       run-N issue with reason `wontfix` and a message of at least 40
 *       characters naming the number that was taken; the record written is
 *       N+1's.
 *   M6  `fleet/CONTRACT.md`'s launch paragraph carries, in this order, the
 *       words `one project per target`, `Idempotency-Key`, `parent`, `replace`
 *       and `wontfix`, and no longer carries the word `purges`.
 *   M7  `fleet/tests/test_launch_bump.mjs` and `fleet/tests/test_launch_size.mjs`
 *       print `ALL TESTS PASSED` on the patched tree.
 *
 * The legs, each naming the clause it comes from:
 *
 *   (a) [M1] `kataProjectFor('popmechanic/smoke')` is `popmechanic-smoke` and
 *       `kataProjectFor.length` is 1; two launches of one plan text against one
 *       fake hub call `createProject` with `popmechanic-smoke` both times, the
 *       second answers the first's id, and every issue is filed under that id.
 *   (b) [M2] across the two launches every task's `createIssue` carries the
 *       same `Idempotency-Key` `popmechanic/smoke:<sha>:task-<id>` where
 *       `<sha>` equals `git hash-object` of the plan file, the same body —
 *       `title` exactly `task <id>: <title>`, `body` `''`, `metadata` exactly
 *       `{task, plan}` with `plan` the same sha — and no `links` key; the
 *       fake's issue store holds one issue per task after both; and the two
 *       `.ultrapowers/kata.json` records name identical task uids.
 *   (c) [M3] for a prepared payload whose `dag_edges` are
 *       `[{from: '1', to: '2', why: 'proof-run'}, {from: '1', to: '3', why:
 *       'interface'}]`, each task's calls after its create are `getIssue`, then
 *       `patchMetadata` with `{run, wave, factsheet}` under that read's
 *       revision, then a `parent` link with `replace: true` to the run issue;
 *       and exactly two `blocks` links are created, both on task 1's uid,
 *       naming task 2's and task 3's uids.
 *   (d) [M4] in the same launch task 1 has no `blocks` link pointing at it, and
 *       the fake's ready set for the project contains task 1 and neither of 2
 *       nor 3.
 *   (e) [M5] with the first push refused (the rig's race: the ref appears on
 *       the origin) and the bump to N+1: no `purgeProject` call; the run-N
 *       issue is closed with reason `wontfix` and a message of ≥40 characters
 *       containing `run-N`; a run-(N+1) issue is created; each task's
 *       `createIssue` was called twice with the same key and body and the store
 *       holds one issue per task; each task's last `patchMetadata` carries the
 *       N+1 payload's factsheet and `run: N+1`, and its last parent link names
 *       the run-(N+1) issue; the record on the pushed plan commit names the N+1
 *       run issue; and `purgeProject` appears nowhere in `fleet/launch.mjs` or
 *       `fleet/kata-client.mjs`.
 *   (f) [M6] the contract paragraph, read here as the Proof's fourth and fifth
 *       `Run:` lines read it — the lines from `kata: the run filed on the hub`
 *       through `ONE verb`.
 *   (g) [M7] both survivor sims still carry the sentinel the Proof's first two
 *       `Run:` lines grep for. Running them is the driver's, not this file's:
 *       no `test_*.mjs` may spawn another (`fleet/tests/test_sims_are_hermetic.mjs`,
 *       M4), so what is read here is their source.
 *
 * The Produces are pinned at the client too, against a recording transport,
 * because the header and the body flag are only visible there: the launch legs
 * see the injected hub's arguments, and `Idempotency-Key: <key>` and
 * `replace: true` are what the client makes of them.
 *
 * How the fake hub models the live one, and why each piece is load-bearing —
 * every fact below was measured on 2026-09-14 against kata v0.17.2 and is
 * recorded in the task's Context, because the sandbox cannot repeat it:
 *
 *   projects   keyed by NAME. `createProject` with a name already held answers
 *              the SAME id (the live hub answered 200 with the existing project
 *              and `"created": false`), which is what makes M1's second half —
 *              "the launcher files into it" — a fact about ids and not about
 *              the launcher's intentions.
 *   issues     keyed by `Idempotency-Key`. The same key with a byte-identical
 *              fingerprint of `{title, body, metadata, links}` answers the SAME
 *              issue; the same key with a different fingerprint throws, as the
 *              live hub's 409 `idempotency_mismatch` does. That is why M2's
 *              create body carries only `{task, plan}` and no links: anything
 *              that varies per run number would make the second launch a 409.
 *   revisions  a create — including an idempotent replay — answers the issue's
 *              ORIGINAL revision, while the stored issue has moved on with
 *              every patch and link. `patchMetadata` enforces `If-Match`: a
 *              revision that is not the stored one throws, as the live hub's
 *              412 `revision_conflict` does. This is the whole teeth of M3's
 *              "under that read's revision" — on a FIRST filing the create's
 *              revision and the read's agree, so a launcher that patched under
 *              the create's would pass; on the SECOND launch of the same plan,
 *              and on the bump's refile, they disagree and it is a 412. Hence
 *              the fixture drives two launches even though leg (c) reads only
 *              the first one's window.
 *   links      a second `parent` throws unless `replace: true` is given (the
 *              live hub answered 409 `parent_already_set` with the hint "pass
 *              replace=true to swap"); a repeated `blocks` answers the same
 *              link id and is not a second link. So the parent flag is not a
 *              decoration the exam reads back — a refile without it dies.
 *   ready      `ready(projectId)` is the open issues with no OPEN `blocks`
 *              predecessor. Leg (d) asks readiness of the fake because that is
 *              the only place it can be asked with no hub.
 *
 * Two readings taken deliberately, so a later session need not re-derive them:
 *
 *   `no links key` (M2) is asserted as `spec.links === undefined`. An absent
 *   key satisfies it; pinning the key's ABSENCE rather than its value would
 *   fail an implementation that is byte-identical on the wire.
 *
 *   `{run, wave, factsheet}` (M3, M5) is asserted by key SET and by `Number()`
 *   on the two numbers, with the fact sheet compared whole. No clause spells
 *   whether `run` is `2` or `"2"`, and an exam that picked one would be
 *   grading a spelling rather than the clause.
 *
 * Everything a launch would execute is answered by the exec seam, and the
 * compiler is never really run; the only real subprocesses are the fixture's
 * own git commands against a bare origin on disk (`_lobby_helpers.mjs`), which
 * is also where the plan's blob sha is read from, with `git hash-object`. No
 * socket is opened and no network hub is reached: the hub is always the
 * injected object. The scaffolding is `fleet/tests/test_launch_bump.mjs`'s,
 * copied rather than imported — that file exports nothing, and its own header
 * records the same convention.
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { launch } from '../launch.mjs'
import * as lobby from '../lobby.mjs'
import * as kataClient from '../kata-client.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir
} from './_lobby_helpers.mjs'

// `kataProjectFor` and `makeKataClient` are read off namespace imports on
// purpose: a tree that does not export one fails as an absent function and not
// as a link error that would hide every other leg.
const { EXE_HOST, defaultExec } = lobby

const TARGET = 'popmechanic/smoke'
/** M1's answer for that target: every `/` spelled `-`, and no run number. */
const PROJECT = 'popmechanic-smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-15T09:30:00.000Z')
/** The caps every drive here runs under: a `fleet.json` saying `6` and `8GB`. */
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
// `pytest.ini` is not decoration: the launch gate refuses a target whose
// default branch carries no detectable test command.
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n' }
const PLAN = [
  '# a seeded plan',
  '',
  '**Claim:** one project per target, and one issue per task per plan text.',
  '',
  'One plan, and a trailing newline.',
  ''
].join('\n')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
/** The compiler the launcher must name: the plugin's own. */
const COMPILER = path.resolve(FLEET_DIR, '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')
/** The three sources legs (e), (f) and (g) read — read, never run. */
const LAUNCHER_SRC = path.join(FLEET_DIR, 'launch.mjs')
const CLIENT_SRC = path.join(FLEET_DIR, 'kata-client.mjs')
const CONTRACT_SRC = path.join(FLEET_DIR, 'CONTRACT.md')
const BUMP_SIM = path.join(HERE, 'test_launch_bump.mjs')
const SIZE_SIM = path.join(HERE, 'test_launch_size.mjs')

/** The run the empty target makes a launch ask for first, and the next two. */
const FIRST = 1
const BUMPED = 2
const planBranch = (n) => `ultra/plan-run-${n}`

// ── The compiled plan, as the stub answers it, per stamp ────────────────────
//
// Three tasks in two waves, and the edges leg (c) names. The fact sheets carry
// the stamp, so a refile that re-sends the FIRST number's sheet is visible.

/** `run-7` -> `run_7`: `compile_plan.py`'s `exam_slug`. */
const examSlug = (stamp) => String(stamp).replace(/[^A-Za-z0-9_]/g, '_')
const examPathFor = (stamp, id) => `tests/exams/${examSlug(stamp)}/t${id}_test.py`
/** One task's fact sheet, in the shape the launcher carries whole to the hub. */
const factsheetFor = (stamp, id) => ({
  files: [`src/f${id}.py`, `tests/t${id}_test.py`],
  deletes: [],
  guards: [],
  proofTests: [`tests/t${id}_test.py`],
  landing: { [`tests/t${id}_test.py`]: examPathFor(stamp, id) },
  driverOwned: [examPathFor(stamp, id)],
  siblingOwned: [],
  produces: [],
  consumes: []
})
const taskFor = (stamp, id) => ({
  id: String(id),
  title: `the ${id} of it`,
  factsheet: factsheetFor(stamp, id)
})
/** The edges leg (c) names — two `why` values, so "whatever the entry's `why`"
 *  is a fact about two different ones and not about one repeated. */
const EDGES = [
  { from: '1', to: '2', why: 'proof-run' },
  { from: '1', to: '3', why: 'interface' }
]
/** Task 1 alone in wave 1; 2 and 3 in wave 2, which is what the edges say. */
const WAVES = [['1'], ['2', '3']]
/** The wave number a task's metadata patch must carry, 1-based. */
const waveOf = (id) => WAVES.findIndex((wave) => wave.includes(String(id))) + 1
const TASK_IDS = WAVES.flat()
const payloadFor = (stamp) => ({
  launch_waves: WAVES.map((wave) => wave.map((id) => taskFor(stamp, id))),
  dag_edges: EDGES
})
/** The stamps this exam's compiler knows, and nothing else: the first number,
 *  the bump's, and one past it, so an extra compile is a refusal and not a
 *  silence the launcher would read as JSON. */
const PAYLOADS = {
  'run-1': payloadFor('run-1'),
  'run-2': payloadFor('run-2'),
  'run-3': payloadFor('run-3')
}

/** The plan's blob sha, computed the way the launcher must: `git hash-object`'s
 *  own digest, in process. Leg (b) checks this against git itself. */
const blobSha = (text) => crypto.createHash('sha1')
  .update(`blob ${Buffer.byteLength(text)}\0`)
  .update(text)
  .digest('hex')
/** M2's key: `<target>:<plan sha>:task-<id>`. */
const taskKeyFor = (sha, id) => `${TARGET}:${sha}:task-${id}`

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
 * the fixture, as another launch would have. The launcher's own re-read of
 * `highestRunOnTarget` is what then decides the number; nothing here parses or
 * fakes git's wording.
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

// ── The hub, faked ──────────────────────────────────────────────────────────
//
// A store, not a recorder: see the header for which live-hub fact each piece
// models and which clause it makes falsifiable. Every call is appended to
// `calls` as `{method, args, seq, out}` — `out` is what the fake answered, so
// a leg can say a patch went under the revision THAT READ answered without the
// two records having to share a clock.

const ULID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`

/** What the live hub fingerprints an idempotent create by: everything in the
 *  body except the key itself. A key replayed with a different one is a 409. */
const fingerprintOf = (spec) => JSON.stringify({
  title: spec?.title ?? null,
  body: spec?.body ?? null,
  metadata: spec?.metadata ?? null,
  links: spec?.links ?? null
})

function makeFakeKata ({ url = 'http://hub.fake' } = {}) {
  const calls = []
  const projectsByName = new Map()
  const issues = new Map()
  const byKey = new Map()
  const links = []
  let projects = 0
  let issued = 0
  let linked = 0
  const rec = (method, args) => {
    const call = { method, args, seq: calls.length, out: null }
    calls.push(call)
    return call
  }
  const mutationOf = (issue) => ({ uid: issue.uid, revision: issue.revision, short_id: issue.short_id })
  const need = (uid) => {
    const issue = issues.get(uid)
    if (issue === undefined) throw new Error(`kata 404 no_such_issue: ${uid}`)
    return issue
  }

  return {
    url,
    calls,

    async ping () {
      const call = rec('ping', [])
      call.out = { ok: true, service: 'kata', version: '0.17.2' }
      return call.out
    },

    // One project per NAME. A name already held answers the project already
    // held, id and all — the live hub's 200 with `"created": false`.
    async createProject (name) {
      const call = rec('createProject', [name])
      let project = projectsByName.get(name)
      if (project === undefined) {
        projects += 1
        project = { id: projects, uid: ULID(projects), name, revision: 1 }
        projectsByName.set(name, project)
      }
      call.out = { ...project }
      return call.out
    },

    // Defined so that a launcher which still purges is caught by leg (e)'s
    // assertion — a legible "purgeProject was called" — rather than by a
    // TypeError from a fake that simply lacks the method. Nothing else here
    // consults it, and no leg permits a call.
    async purgeProject (id, reason) {
      const call = rec('purgeProject', [id, reason])
      call.out = {}
      return call.out
    },

    async createIssue (projectId, spec = {}) {
      const call = rec('createIssue', [projectId, spec])
      const key = spec?.idempotencyKey
      const print = fingerprintOf(spec)
      if (key !== undefined && byKey.has(String(key))) {
        const issue = need(byKey.get(String(key)))
        if (issue.fingerprint !== print) {
          throw new Error(
            `kata 409 idempotency_mismatch for ${key}: the key was first used for ` +
            `${issue.fingerprint} and is now sent with ${print}`
          )
        }
        // The live hub answers the issue's ORIGINAL revision on a replay, even
        // when the issue has since moved on.
        call.out = { uid: issue.uid, revision: issue.createRevision, short_id: issue.short_id }
        return call.out
      }
      issued += 1
      const issue = {
        uid: ULID(20 + issued),
        short_id: `K-${issued}`,
        projectId,
        title: spec?.title ?? '',
        body: spec?.body ?? '',
        metadata: { ...(spec?.metadata ?? {}) },
        status: 'open',
        revision: 1,
        createRevision: 1,
        fingerprint: print,
        closed: null
      }
      issues.set(issue.uid, issue)
      if (key !== undefined) byKey.set(String(key), issue.uid)
      for (const spec_ of spec?.links ?? []) {
        linked += 1
        links.push({
          id: linked,
          projectId,
          from: issue.uid,
          type: spec_?.type,
          to: spec_?.to_ref,
          replace: spec_?.replace === true
        })
      }
      call.out = { uid: issue.uid, revision: issue.revision, short_id: issue.short_id }
      return call.out
    },

    async getIssue (uid) {
      const call = rec('getIssue', [uid])
      const issue = need(uid)
      call.out = {
        uid: issue.uid,
        revision: issue.revision,
        metadata: { ...issue.metadata },
        status: issue.status,
        owner: null,
        project_id: issue.projectId
      }
      return call.out
    },

    // `If-Match`, enforced: a revision that is not the stored one is the live
    // hub's 412 `revision_conflict`. The patch itself is a per-key merge.
    async patchMetadata (projectId, uid, patch, revision) {
      const call = rec('patchMetadata', [projectId, uid, patch, revision])
      const issue = need(uid)
      if (String(revision) !== String(issue.revision)) {
        throw new Error(
          `kata 412 revision_conflict on ${uid}: If-Match "rev-${revision}" but the issue is at ` +
          `rev-${issue.revision} — read the issue before patching it`
        )
      }
      issue.metadata = { ...issue.metadata, ...(patch ?? {}) }
      issue.revision += 1
      call.out = mutationOf(issue)
      return call.out
    },

    // A second `parent` is the live hub's 409 unless `replace: true` is given;
    // a repeated `blocks` is the same link, not a second one.
    async link (projectId, fromUid, spec = {}) {
      const call = rec('link', [projectId, fromUid, spec])
      const issue = need(fromUid)
      const type = spec?.type
      const to = spec?.to_ref
      if (type === 'parent') {
        const existing = links.find((l) => l.from === fromUid && l.type === 'parent')
        if (existing !== undefined && spec?.replace !== true) {
          throw new Error(
            `kata 409 parent_already_set on ${fromUid} (parent ${existing.to}) — ` +
            'pass replace=true to swap'
          )
        }
        if (existing !== undefined) {
          existing.to = to
          existing.replace = true
          issue.revision += 1
          call.out = { ...mutationOf(issue), link: { id: existing.id } }
          return call.out
        }
      } else {
        const same = links.find((l) => l.from === fromUid && l.type === type && l.to === to)
        if (same !== undefined) {
          call.out = { ...mutationOf(issue), link: { id: same.id } }
          return call.out
        }
      }
      linked += 1
      const made = { id: linked, projectId, from: fromUid, type, to, replace: spec?.replace === true }
      links.push(made)
      issue.revision += 1
      call.out = { ...mutationOf(issue), link: { id: made.id } }
      return call.out
    },

    async close (projectId, uid, spec = {}) {
      const call = rec('close', [projectId, uid, spec])
      const issue = need(uid)
      issue.status = 'closed'
      issue.closed = { reason: spec?.reason, message: spec?.message }
      issue.revision += 1
      call.out = mutationOf(issue)
      return call.out
    },

    // ── what a leg reads ────────────────────────────────────────────────────
    projectId: (name) => projectsByName.get(name)?.id,
    issue: (uid) => issues.get(uid),
    stored: () => [...issues.values()],
    links: () => links.map((l) => ({ ...l })),
    /** The open issues of one project with no OPEN `blocks` predecessor. */
    ready: (projectId) => [...issues.values()]
      .filter((issue) => issue.projectId === projectId && issue.status === 'open')
      .filter((issue) => !links.some((l) =>
        l.type === 'blocks' && l.to === issue.uid && issues.get(l.from)?.status === 'open'))
      .map((issue) => issue.uid)
  }
}

// ── The workspace, and one launch ───────────────────────────────────────────

function workspace (prefix) {
  const root = tempDir(prefix)
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** One launch, end to end, against the hub it is handed. */
const drive = async ({ ws, hub, bump = null }) => {
  const exec = makeExec({ rules: readRules({ repo: ws.repo, bump }) })
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
  return { result, exec }
}

// ── Reading the calls ───────────────────────────────────────────────────────

const callsIn = (hub, { from = 0, to = Infinity } = {}) =>
  hub.calls.filter((c) => c.seq >= from && c.seq < to)
const method = (calls, name) => calls.filter((c) => c.method === name)
/** Every `createIssue` that filed a TASK — the run issue's metadata has no `task`. */
const taskCreates = (calls) => method(calls, 'createIssue')
  .filter((c) => c.args[1]?.metadata?.task !== undefined)
/** Every `createIssue` that filed a RUN issue. */
const runCreates = (calls) => method(calls, 'createIssue')
  .filter((c) => c.args[1]?.metadata?.task === undefined)
/** The uid a call is about, for the calls that name one. */
const uidOf = (call) => {
  if (call.method === 'getIssue') return call.args[0]
  if (call.method === 'patchMetadata' || call.method === 'link' || call.method === 'close') {
    return call.args[1]
  }
  return null
}
const about = (calls, uid) => calls.filter((c) => uidOf(c) === uid)
/** The `{run, wave, factsheet}` shape M3 and M5 ask of a metadata patch. */
const patchShape = (patch) => Object.keys(patch ?? {}).slice().sort()

// ═══ The drives ═════════════════════════════════════════════════════════════
//
// Two plain launches of ONE plan text against ONE hub (legs a–d), and one
// bumped launch against a hub of its own (leg e). They run before any
// assertion so that a tree missing the implementation fails on a clause rather
// than half way through a fixture.

const seeded = await (async () => {
  const ws = workspace('fleet-kata-seed-')
  const hub = makeFakeKata()
  const first = await drive({ ws, hub })
  const boundary = hub.calls.length
  const readyAfterFirst = hub.ready(hub.projectId(PROJECT))
  const second = await drive({ ws, hub })
  return { ws, hub, first, second, boundary, readyAfterFirst }
})()

const bumped = await (async () => {
  const ws = workspace('fleet-kata-bump-')
  const hub = makeFakeKata()
  const state = { refusals: 0 }
  const run = await drive({ ws, hub, bump: state })
  return { ws, hub, run, state }
})()

/** The plan's blob sha, as git itself prints it for the very file the launch
 *  was pointed at. Leg (b) keys on this one; the in-process digest is checked
 *  against it so a fixture that drifted is caught here and not silently. */
const PLAN_SHA = seeded.ws.repo.git(['hash-object', seeded.ws.planPath])

// ── a. [M1] one project per target, and the second launch files into it ─────
{
  const projectFor = lobby.kataProjectFor
  assert.equal(
    typeof projectFor, 'function',
    '(a) [M1] fleet/lobby.mjs exports kataProjectFor'
  )
  assert.equal(
    projectFor(TARGET), PROJECT,
    `(a) [M1] kataProjectFor('${TARGET}') is '${PROJECT}' — every / of the target spelled -, ` +
    `and no run number: got ${JSON.stringify(projectFor(TARGET))}`
  )
  assert.equal(
    projectFor.length, 1,
    `(a) [M1] and it takes ONE argument: got arity ${projectFor.length}`
  )
  assert.equal(
    projectFor('acme/deep-repo'), 'acme-deep-repo',
    '(a) [M1] the same for another target — the rule is the slash, not this repo\'s name'
  )

  const firstCalls = callsIn(seeded.hub, { to: seeded.boundary })
  const secondCalls = callsIn(seeded.hub, { from: seeded.boundary })
  assert.deepEqual(
    method(seeded.hub.calls, 'createProject').map((c) => c.args[0]), [PROJECT, PROJECT],
    '(a) [M1] both launches called createProject with exactly that name, and nothing per-run: ' +
    `got ${JSON.stringify(method(seeded.hub.calls, 'createProject').map((c) => c.args[0]))}`
  )
  const answered = method(seeded.hub.calls, 'createProject').map((c) => c.out.id)
  assert.equal(
    answered[1], answered[0],
    `(a) [M1] the hub that already held the name answered the existing project: ids ${JSON.stringify(answered)}`
  )
  const pid = seeded.hub.projectId(PROJECT)
  assert.equal(answered[0], pid, '(a) [M1] which is the project the fake holds under that name')

  for (const [leg, calls] of [['first', firstCalls], ['second', secondCalls]]) {
    for (const call of calls) {
      if (!['createIssue', 'link', 'patchMetadata', 'close'].includes(call.method)) continue
      assert.equal(
        call.args[0], pid,
        `(a) [M1] every issue of the ${leg} launch is filed under that one project id ${pid} — ` +
        `${call.method} named ${JSON.stringify(call.args[0])}`
      )
    }
  }
  assert.equal(
    seeded.first.result.kata.project.name, PROJECT,
    '(a) [M1] and the record names it'
  )
  assert.equal(
    seeded.second.result.kata.project.id, seeded.first.result.kata.project.id,
    '(a) [M1] both records name the same project id — the second launch filed into the first\'s project'
  )
}

// ── b. [M2] one issue per task per plan text, keyed and byte-identical ──────
{
  assert.match(PLAN_SHA, /^[0-9a-f]{40}$/, '(b) [M2] the fixture read a 40-hex blob sha for the plan')
  assert.equal(
    blobSha(PLAN), PLAN_SHA,
    '(b) [M2] and `git hash-object` agrees with the in-process digest the launcher must use — ' +
    `git says ${PLAN_SHA}, the digest says ${blobSha(PLAN)}`
  )

  const creates = taskCreates(seeded.hub.calls)
  assert.equal(
    creates.length, TASK_IDS.length * 2,
    `(b) [M2] two launches filed ${TASK_IDS.length} tasks each, so ${TASK_IDS.length * 2} create ` +
    `calls in all: got ${creates.length}`
  )
  for (const id of TASK_IDS) {
    const mine = creates.filter((c) => String(c.args[1].metadata.task) === id)
    assert.equal(mine.length, 2, `(b) [M2] task ${id} was created once per launch: got ${mine.length}`)
    const key = taskKeyFor(PLAN_SHA, id)
    for (const call of mine) {
      const spec = call.args[1]
      assert.equal(
        spec.idempotencyKey, key,
        `(b) [M2] task ${id}'s create carries Idempotency-Key ${key} — ` +
        `<target>:<plan blob sha>:task-<id>: got ${JSON.stringify(spec.idempotencyKey)}`
      )
      assert.equal(
        spec.title, `task ${id}: ${taskFor('run-1', id).title}`,
        `(b) [M2] its title is exactly \`task <id>: <title>\`: got ${JSON.stringify(spec.title)}`
      )
      assert.equal(spec.body, '', `(b) [M2] its body is empty: got ${JSON.stringify(spec.body)}`)
      assert.deepEqual(
        patchShape(spec.metadata), ['plan', 'task'],
        `(b) [M2] its create metadata is exactly {task, plan} — nothing that varies per run ` +
        `number, which the hub would answer 409 idempotency_mismatch: got ${JSON.stringify(spec.metadata)}`
      )
      assert.equal(String(spec.metadata.task), id, `(b) [M2] metadata.task is ${id}`)
      assert.equal(
        spec.metadata.plan, PLAN_SHA,
        `(b) [M2] metadata.plan is the plan's blob sha: got ${JSON.stringify(spec.metadata.plan)}`
      )
      assert.equal(
        spec.links, undefined,
        '(b) [M2] and the create carries no links — initial links are in the hub\'s idempotency ' +
        `fingerprint: got ${JSON.stringify(spec.links)}`
      )
    }
    assert.equal(
      JSON.stringify(mine[0].args[1]), JSON.stringify(mine[1].args[1]),
      `(b) [M2] so task ${id}'s create body is the same on both launches, whole`
    )
    assert.equal(
      mine[0].out.uid, mine[1].out.uid,
      `(b) [M2] and the hub answered the same issue both times for task ${id}`
    )
  }

  const stored = seeded.hub.stored().filter((issue) => issue.metadata.task !== undefined)
  assert.equal(
    stored.length, TASK_IDS.length,
    `(b) [M2] the issue store holds one issue per task after both launches: got ${stored.length} ` +
    `(${JSON.stringify(stored.map((i) => String(i.metadata.task)))})`
  )
  assert.deepEqual(
    stored.map((i) => String(i.metadata.task)).sort(), [...TASK_IDS].sort(),
    '(b) [M2] one per id, and no duplicate'
  )

  const firstTasks = seeded.first.result.kata.tasks
  const secondTasks = seeded.second.result.kata.tasks
  assert.deepEqual(
    Object.keys(secondTasks).sort(), Object.keys(firstTasks).sort(),
    '(b) [M2] the two .ultrapowers/kata.json records name the same tasks'
  )
  for (const id of TASK_IDS) {
    assert.equal(
      secondTasks[id]?.uid, firstTasks[id]?.uid,
      `(b) [M2] and the same uid for task ${id}: ${JSON.stringify(firstTasks[id])} vs ` +
      `${JSON.stringify(secondTasks[id])}`
    )
  }
}

// ── c. [M3] read, patch under that revision, parent with replace; the edges ─
{
  const calls = callsIn(seeded.hub, { to: seeded.boundary })
  const pid = seeded.hub.projectId(PROJECT)
  const runIssue = runCreates(calls)
  assert.equal(runIssue.length, 1, '(c) [M3] the first launch filed one run issue')
  const runUid = runIssue[0].out.uid
  const uidFor = new Map(taskCreates(calls).map((c) => [String(c.args[1].metadata.task), c.out.uid]))
  assert.equal(uidFor.size, TASK_IDS.length, '(c) [M3] and one issue per task')

  for (const id of TASK_IDS) {
    const uid = uidFor.get(id)
    const after = about(calls, uid).filter((c) => c.seq > taskCreates(calls)
      .find((x) => String(x.args[1].metadata.task) === id).seq)
    assert.ok(
      after.length >= 3,
      `(c) [M3] task ${id}'s create is followed by at least three calls about it: got ` +
      `${JSON.stringify(after.map((c) => c.method))}`
    )
    assert.deepEqual(
      after.slice(0, 3).map((c) => c.method), ['getIssue', 'patchMetadata', 'link'],
      `(c) [M3] task ${id}'s calls after its create are getIssue, patchMetadata, link — in that ` +
      `order: got ${JSON.stringify(after.map((c) => c.method))}`
    )
    const [read, patch, parent] = after
    const body = patch.args[2]
    assert.deepEqual(
      patchShape(body), ['factsheet', 'run', 'wave'],
      `(c) [M3] the patch is exactly {run, wave, factsheet}: got ${JSON.stringify(body)}`
    )
    assert.equal(Number(body.run), FIRST, `(c) [M3] run is ${FIRST}, the number this launch took`)
    assert.equal(
      Number(body.wave), waveOf(id),
      `(c) [M3] wave is ${waveOf(id)}, task ${id}'s 1-based wave`
    )
    assert.deepEqual(
      body.factsheet, factsheetFor(`run-${FIRST}`, id),
      `(c) [M3] and the fact sheet is the run-${FIRST} compile's for task ${id}, whole`
    )
    assert.equal(patch.args[0], pid, '(c) [M3] patched on that project')
    assert.equal(
      patch.args[3], read.out.revision,
      `(c) [M3] under THAT READ's revision — the create answers the issue's original revision and ` +
      `a stale If-Match is a 412 (read answered rev ${read.out.revision}, patch sent ` +
      `${JSON.stringify(patch.args[3])})`
    )
    assert.deepEqual(
      parent.args[2], { type: 'parent', to_ref: runUid, replace: true },
      `(c) [M3] then the run issue is set as task ${id}'s parent with replace: true: got ` +
      `${JSON.stringify(parent.args[2])}`
    )
  }

  const blocks = method(calls, 'link').filter((c) => c.args[2]?.type === 'blocks')
  assert.equal(
    blocks.length, EDGES.length,
    `(c) [M3] exactly ${EDGES.length} blocks links are created, one per dag_edges entry whatever ` +
    `its why: got ${blocks.length}`
  )
  assert.deepEqual(
    blocks.map((c) => ({ from: c.args[1], to: c.args[2].to_ref })),
    EDGES.map((e) => ({ from: uidFor.get(e.from), to: uidFor.get(e.to) })),
    '(c) [M3] both on task 1\'s uid — the blocker — naming task 2\'s and task 3\'s uids: got ' +
    `${JSON.stringify(blocks.map((c) => ({ from: c.args[1], to: c.args[2].to_ref })))}`
  )
  for (const call of blocks) {
    assert.equal(call.args[0], pid, '(c) [M3] created on that one project')
  }
}

// ── d. [M4] nothing blocks task 1, and it is the only ready task ────────────
{
  const calls = callsIn(seeded.hub, { to: seeded.boundary })
  const uidFor = new Map(taskCreates(calls).map((c) => [String(c.args[1].metadata.task), c.out.uid]))
  const one = uidFor.get('1')
  const pointing = seeded.hub.links().filter((l) => l.type === 'blocks' && l.to === one)
  assert.deepEqual(
    pointing, [],
    '(d) [M4] no dag_edges entry names task 1 as `to`, so no blocks link points at it: got ' +
    `${JSON.stringify(pointing)}`
  )
  assert.ok(
    seeded.readyAfterFirst.includes(one),
    `(d) [M4] the fake's ready set for the project contains task 1 (${one}): got ` +
    `${JSON.stringify(seeded.readyAfterFirst)}`
  )
  for (const id of ['2', '3']) {
    assert.equal(
      seeded.readyAfterFirst.includes(uidFor.get(id)), false,
      `(d) [M4] and not task ${id}, which task 1 blocks: ready is ` +
      `${JSON.stringify(seeded.readyAfterFirst)}`
    )
  }
}

// ── e. [M5] a bump refiles under N+1 and purges nothing ─────────────────────
{
  const { hub, run, state, ws } = bumped
  assert.equal(state.refusals, 1, '(e) [M5] the fixture refused exactly one push — the bump this leg is about')
  assert.equal(run.result.run, BUMPED, `(e) [M5] the launcher re-read the target and took ${BUMPED}`)

  assert.deepEqual(
    method(hub.calls, 'purgeProject').map((c) => c.args), [],
    '(e) [M5] and made NO purgeProject call — the bump refiles, it does not purge: got ' +
    `${JSON.stringify(method(hub.calls, 'purgeProject').map((c) => c.args))}`
  )
  for (const src of [LAUNCHER_SRC, CLIENT_SRC]) {
    assert.equal(
      fs.readFileSync(src, 'utf8').includes('purgeProject'), false,
      `(e) [M5] and \`purgeProject\` is not defined in ${path.relative(FLEET_DIR, src)} — ` +
      'the Proof\'s third `Run:` counts comments too'
    )
  }

  const runs = runCreates(hub.calls)
  assert.equal(runs.length, 2, `(e) [M5] one run issue per attempted number: got ${runs.length}`)
  assert.equal(Number(runs[0].args[1].metadata.run), FIRST, `(e) [M5] the first is run ${FIRST}'s`)
  assert.equal(
    Number(runs[1].args[1].metadata.run), BUMPED,
    `(e) [M5] and a run-${BUMPED} issue is created: got ${JSON.stringify(runs[1].args[1].metadata.run)}`
  )
  const runOneUid = runs[0].out.uid
  const runTwoUid = runs[1].out.uid

  const closes = method(hub.calls, 'close')
  assert.equal(
    closes.length, 1,
    `(e) [M5] exactly one close — the run-${FIRST} issue's: got ${JSON.stringify(closes.map((c) => c.args[1]))}`
  )
  assert.equal(closes[0].args[1], runOneUid, `(e) [M5] and it is the run-${FIRST} issue that is closed`)
  const closeSpec = closes[0].args[2] ?? {}
  assert.equal(
    closeSpec.reason, 'wontfix',
    `(e) [M5] closed with reason wontfix: got ${JSON.stringify(closeSpec.reason)}`
  )
  const message = String(closeSpec.message ?? '')
  assert.ok(
    message.length >= 40,
    `(e) [M5] with a message of at least 40 characters: got ${message.length} (${JSON.stringify(message)})`
  )
  assert.ok(
    message.includes(`run-${FIRST}`),
    `(e) [M5] naming the number that was taken, run-${FIRST}: got ${JSON.stringify(message)}`
  )

  const creates = taskCreates(hub.calls)
  assert.equal(
    creates.length, TASK_IDS.length * 2,
    `(e) [M5] every task was filed twice — once per attempted number: got ${creates.length}`
  )
  const stored = hub.stored().filter((issue) => issue.metadata.task !== undefined)
  assert.equal(
    stored.length, TASK_IDS.length,
    `(e) [M5] and the store holds one issue per task, not two: got ${stored.length}`
  )
  for (const id of TASK_IDS) {
    const mine = creates.filter((c) => String(c.args[1].metadata.task) === id)
    assert.equal(mine.length, 2, `(e) [M5] task ${id} was created twice`)
    assert.equal(
      mine[0].args[1].idempotencyKey, taskKeyFor(PLAN_SHA, id),
      `(e) [M5] under the key the plan text gives it, ${taskKeyFor(PLAN_SHA, id)}`
    )
    assert.equal(
      mine[1].args[1].idempotencyKey, mine[0].args[1].idempotencyKey,
      `(e) [M5] the refile uses the SAME key for task ${id} — the number is not in it`
    )
    assert.equal(
      JSON.stringify(mine[1].args[1]), JSON.stringify(mine[0].args[1]),
      `(e) [M5] and the same body, byte for byte, for task ${id}`
    )
    const uid = mine[0].out.uid
    assert.equal(mine[1].out.uid, uid, `(e) [M5] so the hub answered the same issue for task ${id}`)

    const patches = method(about(hub.calls, uid), 'patchMetadata')
    assert.ok(
      patches.length >= 1,
      `(e) [M5] task ${id}'s metadata was patched: got ${patches.length} patches`
    )
    const last = patches[patches.length - 1].args[2]
    assert.deepEqual(
      patchShape(last), ['factsheet', 'run', 'wave'],
      `(e) [M5] the last patch is {run, wave, factsheet}: got ${JSON.stringify(last)}`
    )
    assert.equal(
      Number(last.run), BUMPED,
      `(e) [M5] carrying run ${BUMPED}: got ${JSON.stringify(last.run)}`
    )
    assert.deepEqual(
      last.factsheet, factsheetFor(`run-${BUMPED}`, id),
      `(e) [M5] and the run-${BUMPED} compile's fact sheet for task ${id} — its Proof path lands ` +
      `at ${examPathFor(`run-${BUMPED}`, id)}, not ${examPathFor(`run-${FIRST}`, id)}`
    )

    const parents = method(about(hub.calls, uid), 'link').filter((c) => c.args[2]?.type === 'parent')
    assert.ok(parents.length >= 1, `(e) [M5] task ${id}'s parent was set`)
    const lastParent = parents[parents.length - 1].args[2]
    assert.equal(
      lastParent.to_ref, runTwoUid,
      `(e) [M5] and its last parent link names the run-${BUMPED} issue: got ` +
      `${JSON.stringify(lastParent.to_ref)} (run-${BUMPED} is ${runTwoUid})`
    )
    assert.equal(
      lastParent.replace, true,
      '(e) [M5] with replace: true — a second parent without it is the hub\'s 409 parent_already_set'
    )
  }

  const written = JSON.parse(ws.repo.git(['show', `${run.result.plan}:.ultrapowers/kata.json`]))
  assert.deepEqual(
    Object.keys(written), ['url', 'project', 'run', 'tasks'],
    `(e) [M5] the record on the pushed plan commit keeps its key order: got ${JSON.stringify(Object.keys(written))}`
  )
  assert.equal(
    written.run.uid, runTwoUid,
    `(e) [M5] and its run names the run-${BUMPED} issue — the record written is N+1's: got ` +
    `${JSON.stringify(written.run)}`
  )
  assert.equal(
    written.project.name, PROJECT,
    `(e) [M5] filed in the target's one project: got ${JSON.stringify(written.project.name)}`
  )
  assert.deepEqual(
    Object.keys(written.tasks).sort(), [...TASK_IDS].sort(),
    '(e) [M5] with a row per task'
  )
  for (const id of TASK_IDS) {
    const created = creates.find((c) => String(c.args[1].metadata.task) === id)
    assert.equal(
      written.tasks[id].uid, created.out.uid,
      `(e) [M5] task ${id}'s row names the one issue it was filed as`
    )
  }
}

// ── f. [M6] the contract paragraph ──────────────────────────────────────────
{
  const lines = fs.readFileSync(CONTRACT_SRC, 'utf8').split('\n')
  const start = lines.findIndex((line) => line.includes('kata: the run filed on the hub'))
  assert.ok(start >= 0, '(f) [M6] fleet/CONTRACT.md still has its `kata: the run filed on the hub` paragraph')
  const end = lines.findIndex((line, i) => i >= start && line.includes('ONE verb'))
  assert.ok(end >= start, '(f) [M6] and it still runs to `ONE verb`, the range the Proof\'s Run: lines read')
  // The same text `sed -n '/…/,/ONE verb/p' | tr '\n' ' '` hands grep.
  const paragraph = lines.slice(start, end + 1).join(' ')
  assert.match(
    paragraph,
    /one project per target.*Idempotency-Key.*parent.*replace.*wontfix/,
    '(f) [M6] the launch paragraph carries `one project per target`, `Idempotency-Key`, `parent`, ' +
    `\`replace\` and \`wontfix\`, in that order: got ${JSON.stringify(paragraph)}`
  )
  assert.equal(
    paragraph.includes('purges'), false,
    '(f) [M6] and no longer carries the word `purges` — the bump refiles'
  )
}

// ── g. [M7] the two survivor sims keep their sentinel ───────────────────────
{
  // Reading their source is all this file may do: `test_sims_are_hermetic.mjs`
  // M4 forbids one sim spawning another, so RUNNING them is the Proof's first
  // two `Run:` lines, which the driver executes and greps.
  for (const sim of [BUMP_SIM, SIZE_SIM]) {
    const source = fs.readFileSync(sim, 'utf8')
    assert.ok(
      source.includes('ALL TESTS PASSED'),
      `(g) [M7] ${path.relative(FLEET_DIR, sim)} still prints the sentinel the Proof greps for`
    )
  }
}

// ── Produces: the two client spellings the launch legs cannot see ───────────
//
// The injected hub sees `{idempotencyKey}` and `{replace}` as arguments; only
// the client turns them into a header and a body field. A recording transport
// is the one place that is visible, and the global constraint that every
// mutation carries `actor` is checked on the same calls.
{
  const sent = []
  const transport = {
    request: async (req) => {
      sent.push(req)
      return { status: 200, json: { issue: { uid: 'U', revision: 1, short_id: 'K-1' } } }
    }
  }
  const client = kataClient.makeKataClient({ transport, actor: 'fleet-exam' })

  await client.createIssue(7, {
    title: 'task 1: the 1 of it',
    body: '',
    metadata: { task: '1', plan: PLAN_SHA },
    idempotencyKey: taskKeyFor(PLAN_SHA, '1')
  })
  const create = sent[sent.length - 1]
  assert.equal(
    create.headers?.['Idempotency-Key'], taskKeyFor(PLAN_SHA, '1'),
    '[Produces][M2] createIssue sends `Idempotency-Key: <idempotencyKey>` when given: got ' +
    `${JSON.stringify(create.headers)}`
  )
  assert.equal(create.body?.actor, 'fleet-exam', '[Produces] and the mutation still carries actor')
  assert.equal(
    create.body?.idempotencyKey, undefined,
    '[Produces][M2] the key is a header, not a body field the hub would fingerprint'
  )

  await client.createIssue(7, { title: 't', body: '', metadata: {} })
  const unkeyed = sent[sent.length - 1]
  assert.equal(
    unkeyed.headers?.['Idempotency-Key'], undefined,
    '[Produces][M2] and no such header when no key is given'
  )

  await client.link(7, 'U', { type: 'parent', to_ref: 'R', replace: true })
  const replaced = sent[sent.length - 1]
  assert.equal(
    replaced.body?.replace, true,
    `[Produces][M3] link sends \`replace: true\` in the body when given: got ${JSON.stringify(replaced.body)}`
  )
  assert.equal(replaced.body?.type, 'parent', '[Produces][M3] beside the type it is setting')
  assert.equal(replaced.body?.to_ref, 'R', '[Produces][M3] and the ref it points at')
  assert.equal(replaced.body?.actor, 'fleet-exam', '[Produces] the link mutation still carries actor')

  await client.link(7, 'U', { type: 'blocks', to_ref: 'B' })
  const plain = sent[sent.length - 1]
  assert.equal(
    plain.body?.replace, undefined,
    `[Produces][M3] and no replace field when none was asked for: got ${JSON.stringify(plain.body)}`
  )
}

// ── Task 1 of 2026-09-15-run-issue-force-new (#1008): the run issue's create
// carries `force_new`, and no task issue's does ────────────────────────────
//
// The hub scores a create's title against the project's open issues and
// refuses `409 duplicate_candidates`; a relaunched plan's run issue differs
// from the earlier run's only by N. The launcher asks the client for
// `forceNew: true` on that one create, the client spells it `force_new: true`
// in the body, and the task creates — the ones replayed under a key whose
// fingerprint is the body — send exactly what they sent before.
{
  const firstCalls = callsIn(seeded.hub, { to: seeded.boundary })
  const runs = runCreates(firstCalls)
  assert.equal(runs.length, 1, `(a) [M1] one launch files one run issue: got ${runs.length}`)
  assert.equal(
    runs[0].args[1]?.forceNew, true,
    `(a) [M1] the run issue's create is asked with forceNew: true: got ${JSON.stringify(runs[0].args[1])}`
  )

  const tasks = taskCreates(firstCalls)
  assert.ok(tasks.length >= 2, `(c) [M2] the launch filed task issues to inspect: got ${tasks.length}`)
  const offender = tasks.find((c) => c.args[1]?.forceNew !== undefined)
  assert.equal(
    offender, undefined,
    '(c) [M2] no task issue\'s create carries forceNew — task ' +
    `${JSON.stringify(offender?.args[1]?.metadata?.task)} was asked with ` +
    `forceNew: ${JSON.stringify(offender?.args[1]?.forceNew)}`
  )

  const sent = []
  const transport = {
    request: async (req) => {
      sent.push(req)
      return { status: 200, json: { issue: { uid: 'U', revision: 1, short_id: 'K-1' } } }
    }
  }
  const client = kataClient.makeKataClient({ transport, actor: 'x' })

  await client.createIssue(1, { title: 't', forceNew: true })
  const forced = sent[sent.length - 1]
  assert.equal(forced.method, 'POST', '(b) [M1] the create is a POST')
  assert.equal(
    forced.body?.force_new, true,
    `(b) [M1] the client spells forceNew as force_new: true in the body: got ${JSON.stringify(forced.body)}`
  )

  await client.createIssue(1, { title: 't' })
  const plain = sent[sent.length - 1]
  assert.deepEqual(
    Object.keys(plain.body ?? {}).slice().sort(), ['actor', 'body', 'links', 'metadata', 'title'],
    `(d) [M2] a create asked without forceNew sends exactly the BASE body keys: got ${JSON.stringify(plain.body)}`
  )
  assert.equal(
    Object.prototype.hasOwnProperty.call(plain.body ?? {}, 'force_new'), false,
    '(d) [M2] and no force_new key at all'
  )

  const paragraph = fs.readFileSync(path.join(FLEET_DIR, 'CONTRACT.md'), 'utf8')
    .split('\n')
  const start = paragraph.findIndex((l) => l.startsWith('  kata: the run filed on the hub'))
  const end = paragraph.findIndex((l, i) => i > start && l.startsWith('  read back, its metadata patched'))
  assert.ok(start >= 0 && end > start, `(e) [M3] the contract's kata paragraph is found: lines ${start}..${end}`)
  assert.match(
    paragraph.slice(start, end + 1).join(' '), /run issue.*force_new: true/,
    '(e) [M3] the kata paragraph says the run issue is created with force_new: true'
  )
}

seeded.ws.cleanup()
bumped.ws.cleanup()

console.log('ALL TESTS PASSED')
