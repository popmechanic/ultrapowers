/**
 * fleet/tests/test_probe_kata_facts.mjs — the exam for Task 1: *the kata facts
 * probe — one line per fact, stamped with the hub's version, and an exam of
 * its shape*.
 *
 * This file is the Proof's `Test: fleet/tests/test_probe_kata_facts.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: the probe under exam is `fleet/tests/probe_kata_facts.mjs`, the
 * file beside this one, so the import below is `./probe_kata_facts.mjs`. (Leg
 * (g) writes `../probe_kata_facts.mjs`; from `fleet/tests/` that names
 * `fleet/probe_kata_facts.mjs`, which the task's Files slot does not create.
 * The module is the same one either way — `./` is where it lands.)
 *
 * WHAT THE CLAUSES SAY, and where each is asserted below:
 *
 *   M1  the module exports `FACTS`, an array of `{id, says}` whose ids are
 *       exactly Context's 22 fact ids in order, and `probeKataFacts({
 *       transport, actor, log, now })`, which — driven against a transport
 *       whose every answer matches the recorded reading — writes exactly one
 *       `^FACT <id>: holds` line per entry, in `FACTS` order, and no `FACT`
 *       line for any other id.                                    → leg (a)
 *   M2  the first line is `kata <version> — read from GET /api/v1/ping`, the
 *       version being the ping answer's own `version` field, and every `FACT`
 *       line ends `(kata <that version>, <YYYY-MM-DD from now>)`.  → leg (b)
 *   M3  it resolves `{exit, version, results}`: `exit` 0 when every fact
 *       holds; a differing answer makes that fact's line
 *       `FACT <id>: DRIFT — read <what was read>`, leaves every other line
 *       `holds`, and `exit` 1; a non-2xx ping makes the first line name the
 *       hub unreachable with the status, writes no `FACT` line, `exit` 2.
 *                                                        → legs (c) and (d)
 *   M4  every run whose ping answered 2xx ends its mutations with one
 *       `POST …/actions/close` per issue it created, then
 *       `DELETE /api/v1/projects/<id>`, then — as the very last request —
 *       `POST …/actions/purge` carrying `X-Kata-Confirm: PURGE <project
 *       name>`, the name beginning `probe-kata-facts-`; a confirmed purge
 *       answering non-2xx makes the last line name the project id as left
 *       behind and `exit` 2 even when every fact held.   → legs (e) and (f)
 *   M5  importing the module makes no request and starts no process — its
 *       main runs only when the file is `process.argv[1]` — and
 *       `fleet/tests/PROBES.md` lists the probe with when it is run.
 *                                                        → legs (g) and (h)
 *
 * THE FAKE HUB. Every leg but (g) and (h) drives `probeKataFacts` against
 * `makeFakeHub()` — an in-memory kata answering by `method + path`, stateful
 * enough to model each of Context's 22 recorded readings (find-or-create's
 * `created:false`, the project NAME in a path as 400, the idempotent replay
 * answering the ORIGINAL revision, `idempotency_mismatch` naming the prior
 * uid, `duplicate_candidates` scored against the project's OPEN titles with
 * `force_new` as the bypass, one `link.id` twice, `parent_already_set` and
 * `replace`, a `blocked_by` 400, the `If-Match` merge and its 412, dotted keys
 * kept flat, `already_claimed` with `current_owner`, `expect_owner` as an
 * unexpected key, the two close refusals, the superseded-evidence 400,
 * ready/unowned/owner, `next` as 404, the label union, events carrying
 * `issue_uid` on `issue.created` rows only, the links row shape, and the purge
 * ladder). Nothing is spawned and no socket is opened: the transport is a
 * plain async function on an object, and the only file read is
 * `fleet/tests/PROBES.md` for leg (h), resolved from this file's own
 * directory.
 *
 * The hub records every request — method, path, headers, body, and the issue
 * it resolved from the path — plus the uids it created and any request it had
 * no route for. Leg (a)'s failure message names the unrouted ones, so a red
 * exam reads as the probe asking the recorded hub for something it never
 * answered rather than as a mystery drift.
 *
 * THREE READINGS THIS EXAM COMMITS TO, because the legs force them:
 *
 *   1. Leg (f) and M4 both say a confirmed purge answering non-2xx is `exit` 2
 *      and a `left behind` last line EVEN WHEN EVERY FACT HELD. So the final
 *      confirmed purge is CLEANUP, not part of `purge-ladder`'s verdict: that
 *      fact holds on the rungs the probe read (no header → 412, unarchived →
 *      409, the open-issues refusal, the archive → 200), and a failed final
 *      purge is reported as the cleanup failure M4 describes. Leg (f) asserts
 *      22 `holds` lines on that run.
 *   2. Facts 14 and 15 record only "refused with a 4xx". The fake answers 422
 *      for both refusals (a message under 40 characters, an `Idempotency-Key`
 *      with no `retry_protocol`) and 400 for the superseded-evidence row,
 *      which Context does pin. The recorded reading for those two is the
 *      CLASS: a probe that pins one exact status there reads DRIFT.
 *   3. Leg (e)'s "N equals the number of `POST /api/v1/projects/<id>/issues`
 *      requests recorded" cannot hold as written — facts 5 and 6 require
 *      create requests that create no issue (409 `idempotency_mismatch`, 409
 *      `duplicate_candidates`) and fact 4's replay answers an issue that
 *      already exists. Leg (e) below encodes M4's own parenthetical instead:
 *      one close per issue the hub actually created, never fewer, then the
 *      archive, then the confirmed purge last.
 *
 * One `PROBE: <n> facts, <d> drift, <u> unreadable` line is Context's own
 * literal rather than a leg of its own; legs (a) and (c) assert it beside the
 * `FACT` lines they count.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROBES_MD = path.join(HERE, 'PROBES.md')

// ── Context's literals, spelled once ────────────────────────────────────────

/** The 22 fact ids Context lists, in that order. M1 is this list. */
const FACT_IDS = [
  'ping-version',               //  1
  'project-find-or-create',     //  2
  'project-by-id-only',         //  3
  'create-replay',              //  4
  'create-fingerprint-metadata',//  5
  'create-duplicate-scorer',    //  6
  'link-blocks-idempotent',     //  7
  'link-parent-replace',        //  8
  'link-types',                 //  9
  'metadata-merge-if-match',    // 10
  'metadata-dotted-flat',       // 11
  'claim-if-unowned',           // 12
  'unassign-key',               // 13
  'close-message-40',           // 14
  'close-retry-protocol',       // 15
  'close-superseded-evidence',  // 16
  'ready-unowned',              // 17
  'next-no-endpoint',           // 18
  'labels-merge',               // 19
  'events-issue-uid',           // 20
  'issue-links-shape',          // 21
  'purge-ladder',               // 22
]

/** Not the hub's real version on purpose: M2 says the line and the stamps come
 *  from the ping ANSWER, so a probe holding `v0.17.2` as a constant fails. */
const VERSION = 'v9.9.9-fake'

/** The injected clock, and the date M2 stamps every `FACT` line with. */
const NOW = new Date('2026-09-15T16:33:00.000Z')
const DATE = NOW.toISOString().slice(0, 10)

const ACTOR = 'examiner@run-144'

/** M2's first line, verbatim — the dash is an em dash. */
const VERSION_LINE = `kata ${VERSION} — read from GET /api/v1/ping`

/** M2's per-line stamp, verbatim. */
const STAMP = `(kata ${VERSION}, ${DATE})`

/** Distinctive on purpose: leg (f) looks for this id inside a line. */
const FIRST_PROJECT_ID = 7311

// ── Small helpers ───────────────────────────────────────────────────────────

const bareOf = (p) => String(p == null ? '' : p).split('?')[0]

/** A header by name, case-insensitively: the hub's own lookup is, and a probe
 *  may spell `Idempotency-Key` either way. */
const header = (headers, name) => {
  const want = String(name).toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === want) return value
  }
  return undefined
}

/** A key-sorted JSON, so the create fingerprint is the body's fields and not
 *  the order a caller happened to write them in. `undefined` and a missing key
 *  are the same thing here, which is what makes a byte-identical replay one. */
const stable = (value) => {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** A request, for a failure message. */
const shown = (call) => (call
  ? `${call.method} ${call.path}`
  : '(no request)')

/** What the hub could not answer, and what arrived without an `actor` — the
 *  two things that most often explain an unexpected DRIFT. */
const diagnose = (hub) => {
  const bits = []
  if (hub.unrouted.length > 0) {
    bits.push(`the fake hub had NO ROUTE for ${hub.unrouted.length} request(s): ` +
      hub.unrouted.slice(0, 8).map(shown).join(', '))
  }
  if (hub.actorless.length > 0) {
    bits.push(`${hub.actorless.length} mutation(s) carried no \`actor\` in the body ` +
      `(Context: every mutation body carries actor): ` +
      hub.actorless.slice(0, 8).map(shown).join(', '))
  }
  bits.push(`${hub.calls.length} request(s) in all`)
  return bits.join('; ')
}

// ════════════════════════════════════════════════════════════════════════════
// The fake hub: one scripted kata, answering by method + path
// ════════════════════════════════════════════════════════════════════════════

/**
 * `makeFakeHub()` answers every request the recorded reading of Context, and
 * nothing else. The knobs are the three departures the legs need:
 *
 *   `version`            the ping's `version` field            (leg (b))
 *   `pingStatus`         a non-2xx ping                        (leg (d))
 *   `driftParentSecond`  the SECOND `parent` link answers 200
 *                        instead of 409 `parent_already_set`   (leg (c))
 *   `purgeStatus`        the confirmed, archived purge's status (leg (f))
 */
const makeFakeHub = ({
  version = VERSION, pingStatus = 200, driftParentSecond = false, purgeStatus = 200,
} = {}) => {
  const calls = []
  const unrouted = []
  const actorless = []
  const created = []           // uids of the issues this hub really created

  const projects = new Map()   // id -> project
  const byName = new Map()     // name -> id
  const issues = new Map()     // uid -> issue
  const keys = new Map()       // Idempotency-Key -> {fp, uid, revision}
  const links = []             // {id, type, from, to}
  const events = []            // {id, type, …, issue_uid?}

  let nextProject = FIRST_PROJECT_ID
  let nextIssue = 1
  let nextLink = 1
  let nextEvent = 1
  let parentDrifted = false

  const EPOCH = Date.parse('2026-09-15T16:00:00.000Z')

  const answer = (status, json) => ({
    status, json, body: json === undefined ? '' : JSON.stringify(json),
  })
  const fail = (status, code, message, data) => answer(status, {
    error: { code, message: message || code, ...(data === undefined ? {} : { data }) },
  })

  const event = (type, extra = {}) => {
    const id = nextEvent++
    events.push({ id, type, at: new Date(EPOCH + id * 1000).toISOString(), ...extra })
  }

  const shortOf = (n) => ('000' + n.toString(16)).slice(-4)
  const ref = (issue) => ({
    uid: issue.uid, short_id: issue.short_id, title: issue.title, state: issue.state,
  })
  const linkRow = (link) => ({
    id: link.id,
    type: link.type,
    from: ref(issues.get(link.from)),
    to: ref(issues.get(link.to)),
  })
  const linksOf = (uid) => links.filter((l) => l.from === uid || l.to === uid).map(linkRow)
  const view = (issue, revision) => ({
    uid: issue.uid,
    short_id: issue.short_id,
    project_id: issue.project,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    owner: issue.owner,
    revision: revision === undefined ? issue.revision : revision,
    metadata: { ...issue.metadata },
    labels: [...issue.labels],
    links: linksOf(issue.uid),
  })

  /** An issue by uid, by short id, or by a `<project>#<short>` ref. */
  const findIssue = (token) => {
    const want = String(token == null ? '' : token)
    if (issues.has(want)) return issues.get(want)
    const tail = want.includes('#') ? want.slice(want.indexOf('#') + 1) : want
    for (const issue of issues.values()) {
      if (issue.short_id === tail || issue.uid === tail) return issue
    }
    return null
  }

  const openOf = (project) =>
    project.issues.map((uid) => issues.get(uid)).filter((i) => i.state === 'open')

  const norm = (title) => String(title == null ? '' : title).trim().toLowerCase()

  const request = async ({ method, path: reqPath, headers, body }) => {
    const call = {
      method: String(method || '').toUpperCase(),
      path: String(reqPath == null ? '' : reqPath),
      headers: { ...(headers || {}) },
      body: clone(body),
      issueUid: null,
    }
    calls.push(call)
    if (call.method !== 'GET' && body !== undefined && !(body && body.actor)) {
      actorless.push(call)
    }

    const bare = bareOf(call.path)
    const query = new URLSearchParams(call.path.includes('?') ? call.path.split('?')[1] : '')
    const seg = bare.replace(/^\/+|\/+$/g, '').split('/')
    if (seg[0] !== 'api' || seg[1] !== 'v1') {
      unrouted.push(call)
      return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
    }
    const rest = seg.slice(2)
    const b = body || {}

    // ── the one unauthenticated read, and the 401 beside it (fact 1) ────────
    if (call.method === 'GET' && rest.length === 1 && rest[0] === 'ping') {
      if (pingStatus < 200 || pingStatus > 299) {
        return fail(pingStatus, 'unavailable', 'kata is not answering')
      }
      return answer(200, { ok: true, service: 'kata', version, pid: 4242 })
    }
    if (call.method === 'GET' && rest.length === 1 && rest[0] === 'version') {
      return fail(401, 'unauthorized', 'missing bearer')
    }

    // ── the flat issue read (fact 21) ───────────────────────────────────────
    if (rest[0] === 'issues' && rest.length === 2) {
      const issue = findIssue(rest[1])
      if (!issue) return fail(404, 'issue_not_found', `no issue ${rest[1]}`)
      call.issueUid = issue.uid
      if (call.method !== 'GET') {
        unrouted.push(call)
        return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
      }
      return answer(200, { issue: view(issue) })
    }

    if (rest[0] !== 'projects') {
      unrouted.push(call)
      return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
    }

    // ── find-or-create (fact 2) ─────────────────────────────────────────────
    if (rest.length === 1) {
      if (call.method === 'GET') {
        return answer(200, { projects: [...projects.values()].map((p) => ({ ...p, issues: undefined })) })
      }
      if (call.method !== 'POST') {
        unrouted.push(call)
        return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
      }
      const name = b.name
      if (!name) return fail(400, 'invalid_body', 'name is required')
      if (byName.has(name)) {
        const existing = projects.get(byName.get(name))
        return answer(200, {
          project: { id: existing.id, uid: existing.uid, name: existing.name, revision: 1 },
          created: false,
        })
      }
      const id = nextProject++
      const project = { id, uid: `PROJ-${id}`, name, archived: false, purged: false, issues: [] }
      projects.set(id, project)
      byName.set(name, id)
      // A `project.created` row carries no `issue_uid` at all (fact 20).
      event('project.created', { project_id: id, actor: b.actor })
      return answer(200, {
        project: { id, uid: project.uid, name, revision: 1 }, created: true,
      })
    }

    // Everything below names a project in the path — and a NAME there is a 400,
    // never a lookup (fact 3).
    const token = rest[1]
    if (!/^\d+$/.test(token)) {
      return fail(400, 'invalid_project_id',
        `project id must be an integer, got ${JSON.stringify(token)}`)
    }
    const project = projects.get(Number(token))
    if (!project || project.purged) {
      return fail(404, 'project_not_found', `no project ${token}`)
    }

    // ── the archive (fact 22, and the cleanup's middle rung) ─────────────────
    if (call.method === 'DELETE' && rest.length === 2) {
      const open = openOf(project)
      if (open.length > 0) {
        return fail(409, 'project_has_open_issues',
          `${open.length} issue(s) still open`, { open: open.length })
      }
      project.archived = true
      return answer(200, { project: { id: project.id, name: project.name, archived: true } })
    }
    if (call.method === 'GET' && rest.length === 2) {
      return answer(200, {
        project: {
          id: project.id, uid: project.uid, name: project.name, archived: project.archived,
        },
      })
    }

    // ── the purge (fact 22, and the cleanup's last rung) ────────────────────
    if (call.method === 'POST' && rest.length === 4 && rest[2] === 'actions' && rest[3] === 'purge') {
      const confirm = header(call.headers, 'X-Kata-Confirm')
      if (confirm === undefined || confirm === '') {
        return fail(412, 'confirm_required', 'X-Kata-Confirm is required')
      }
      if (confirm !== `PURGE ${project.name}`) {
        return fail(412, 'confirm_mismatch',
          `X-Kata-Confirm must be "PURGE ${project.name}"`)
      }
      if (!project.archived) {
        return fail(409, 'project_not_archived', 'archive the project first')
      }
      if (purgeStatus < 200 || purgeStatus > 299) {
        return fail(purgeStatus, 'internal_error', 'the purge failed')
      }
      project.purged = true
      return answer(200, { purged: true, project: { id: project.id, name: project.name } })
    }

    // ── the ready set (fact 17) ─────────────────────────────────────────────
    if (call.method === 'GET' && rest.length === 3 && rest[2] === 'ready') {
      const open = openOf(project)
      const blocked = new Set()
      for (const issue of open) {
        for (const link of links) {
          if (link.type === 'blocks' && link.from === issue.uid) blocked.add(link.to)
        }
      }
      let rows = open.filter((i) => !blocked.has(i.uid))
      // `?unowned=true` drops an owned one; `?owner=<x>` changes nothing.
      if (String(query.get('unowned') || '') === 'true') rows = rows.filter((i) => !i.owner)
      const listed = rows.map((i) => ({ ...ref(i), owner: i.owner }))
      return answer(200, { issues: listed, ready: listed })
    }

    // ── no `next` endpoint at all (fact 18) ─────────────────────────────────
    if (rest.length === 3 && rest[2] === 'next') {
      return fail(404, 'not_found', 'no such endpoint')
    }

    // ── the event log (fact 20) ─────────────────────────────────────────────
    if (call.method === 'GET' && rest.length === 3 && rest[2] === 'events') {
      const after = Number(query.get('after_id') || 0)
      const limit = Number(query.get('limit') || 1000)
      const rows = events.filter((e) => e.id > after).slice(0, limit)
      return answer(200, { events: rows, items: rows })
    }

    if (rest[2] !== 'issues') {
      unrouted.push(call)
      return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
    }

    // ── the create, its replay and the duplicate scorer (facts 4, 5, 6) ─────
    if (rest.length === 3) {
      if (call.method === 'GET') {
        return answer(200, { issues: openOf(project).map(ref) })
      }
      if (call.method !== 'POST') {
        unrouted.push(call)
        return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
      }
      const fp = stable({
        title: b.title, body: b.body, actor: b.actor, metadata: b.metadata, links: b.links,
      })
      const key = header(call.headers, 'Idempotency-Key')
      if (key !== undefined && keys.has(key)) {
        const prior = keys.get(key)
        if (prior.fp !== fp) {
          return fail(409, 'idempotency_mismatch',
            `key ${key} was used for ${prior.uid}`,
            { issue_uid: prior.uid, uid: prior.uid, prior_uid: prior.uid })
        }
        const issue = issues.get(prior.uid)
        call.issueUid = issue.uid
        // The replay answers the ORIGINAL revision, not today's.
        return answer(200, { issue: view(issue, prior.revision), created: false })
      }
      if (key === undefined && b.force_new !== true) {
        const twin = openOf(project).find((i) => norm(i.title) === norm(b.title))
        if (twin) {
          return fail(409, 'duplicate_candidates',
            'a title this close is already open here',
            { candidates: [{ uid: twin.uid, short_id: twin.short_id, title: twin.title, score: 0.93 }] })
        }
      }
      const n = nextIssue++
      const issue = {
        uid: `U-${String(n).padStart(4, '0')}`,
        short_id: shortOf(0xa000 + n),
        project: project.id,
        title: b.title == null ? '' : b.title,
        body: b.body == null ? '' : b.body,
        metadata: { ...(b.metadata || {}) },
        labels: [],
        owner: null,
        state: 'open',
        revision: 1,
      }
      issues.set(issue.uid, issue)
      project.issues.push(issue.uid)
      created.push(issue.uid)
      call.issueUid = issue.uid
      // An `issue.created` row carries `issue_uid` (fact 20).
      event('issue.created', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
      for (const row of Array.isArray(b.links) ? b.links : []) {
        const target = findIssue(row && (row.to_ref || row.to))
        if (target) links.push({ id: nextLink++, type: row.type, from: issue.uid, to: target.uid })
      }
      if (key !== undefined) keys.set(key, { fp, uid: issue.uid, revision: issue.revision })
      return answer(200, { issue: view(issue), created: true })
    }

    const issue = findIssue(rest[3])
    if (!issue) return fail(404, 'issue_not_found', `no issue ${rest[3]}`)
    call.issueUid = issue.uid
    const tail = rest.slice(4)

    if (call.method === 'GET' && tail.length === 0) {
      return answer(200, { issue: view(issue) })
    }

    // ── the three link readings (facts 7, 8, 9) ─────────────────────────────
    if (call.method === 'POST' && tail.length === 1 && tail[0] === 'links') {
      const type = b.type
      if (!['parent', 'blocks', 'related'].includes(type)) {
        return fail(400, 'invalid_link_type',
          `link type must be one of parent, blocks, related; got ${JSON.stringify(type)}`,
          { accepted: ['parent', 'blocks', 'related'] })
      }
      const target = findIssue(b.to_ref)
      if (!target) return fail(404, 'issue_not_found', `no issue ${b.to_ref}`)
      if (type === 'parent') {
        const existing = links.find((l) => l.from === issue.uid && l.type === 'parent')
        if (existing && b.replace !== true) {
          if (driftParentSecond && !parentDrifted) {
            // Leg (c)'s one departure: the second `parent` link answers 200
            // (and swaps) where the recorded reading is 409.
            parentDrifted = true
            existing.to = target.uid
            return answer(200, { link: linkRow(existing) })
          }
          return fail(409, 'parent_already_set',
            'this issue already has a parent; send replace: true',
            { current_parent: { uid: existing.to } })
        }
        if (existing) {
          existing.to = target.uid
          return answer(200, { link: linkRow(existing) })
        }
        const link = { id: nextLink++, type, from: issue.uid, to: target.uid }
        links.push(link)
        return answer(200, { link: linkRow(link) })
      }
      const same = links.find((l) => l.from === issue.uid && l.type === type && l.to === target.uid)
      if (same) return answer(200, { link: linkRow(same) })
      const link = { id: nextLink++, type, from: issue.uid, to: target.uid }
      links.push(link)
      return answer(200, { link: linkRow(link) })
    }

    // ── the metadata merge, its 412 and its flat keys (facts 10, 11) ────────
    if (call.method === 'POST' && tail.length === 1 && tail[0] === 'metadata') {
      const ifMatch = header(call.headers, 'If-Match')
      if (ifMatch !== undefined) {
        const want = `rev-${issue.revision}`
        if (String(ifMatch).replace(/^"|"$/g, '') !== want) {
          return fail(412, 'revision_conflict',
            `If-Match is stale: the issue is at "${want}"`,
            { revision: issue.revision })
        }
      }
      // Merged per key, and a dotted key stays one flat key.
      for (const [key, value] of Object.entries(b.patch || {})) {
        if (value === null) delete issue.metadata[key]
        else issue.metadata[key] = value
      }
      issue.revision += 1
      event('issue.metadata', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
      return answer(200, { issue: view(issue) })
    }

    // ── the label union (fact 19) ──────────────────────────────────────────
    if (call.method === 'POST' && tail.length === 1 && tail[0] === 'labels') {
      const label = b.label
      if (label !== undefined && !issue.labels.includes(label)) issue.labels.push(label)
      issue.revision += 1
      event('issue.labeled', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
      return answer(200, { issue: view(issue) })
    }

    if (call.method === 'POST' && tail.length === 1 && tail[0] === 'comments') {
      issue.revision += 1
      event('issue.commented', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
      return answer(200, { issue: view(issue), comment: { id: nextEvent } })
    }

    if (call.method === 'POST' && tail.length === 2 && tail[0] === 'actions') {
      const action = tail[1]

      // ── the claim (fact 12) ──────────────────────────────────────────────
      if (action === 'claim') {
        if (issue.owner && b.if_unowned === true) {
          return fail(409, 'already_claimed',
            `${issue.uid} is owned by ${issue.owner}`,
            { current_owner: issue.owner })
        }
        issue.owner = b.actor == null ? 'someone' : b.actor
        issue.revision += 1
        event('issue.claimed', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
        return answer(200, { issue: view(issue) })
      }

      // ── the unassign key kata does not know (fact 13) ────────────────────
      if (action === 'unassign') {
        if (Object.prototype.hasOwnProperty.call(b, 'expect_owner')) {
          return fail(400, 'invalid_body',
            'unexpected key: expect_owner (did you mean expected_owner?)',
            { unexpected: ['expect_owner'] })
        }
        issue.owner = null
        issue.revision += 1
        event('issue.unassigned', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
        return answer(200, { issue: view(issue) })
      }

      // ── the three close readings (facts 14, 15, 16) ──────────────────────
      if (action === 'close') {
        const key = header(call.headers, 'Idempotency-Key')
        if (key !== undefined && !b.retry_protocol) {
          // Context records a 4xx, not a number: the class is the reading.
          return fail(422, 'retry_protocol_required',
            'a close under an Idempotency-Key must carry retry_protocol')
        }
        if (b.reason === 'superseded') {
          const rows = Array.isArray(b.evidence) ? b.evidence : []
          const bare_ref = rows.every((row) => row && Object.keys(row).every((k) => k === 'type' || k === 'ref'))
          if (rows.length > 0 && bare_ref) {
            return fail(400, 'invalid_evidence',
              'a superseded-by row needs more than ref')
          }
        }
        if (String(b.message == null ? '' : b.message).length < 40) {
          return fail(422, 'message_too_short',
            'a close message must be at least 40 characters')
        }
        issue.state = 'closed'
        issue.revision += 1
        event('issue.closed', { project_id: project.id, issue_uid: issue.uid, actor: b.actor })
        return answer(200, { issue: view(issue) })
      }
    }

    unrouted.push(call)
    return fail(404, 'fake_hub_no_route', `no route for ${call.method} ${bare}`)
  }

  return {
    request,
    calls,
    unrouted,
    actorless,
    created,
    projectId: () => (projects.size === 0 ? null : [...projects.keys()][0]),
    projectName: () => (projects.size === 0 ? null : [...projects.values()][0].name),
  }
}

// ── The request shapes M4's ladder is read through ──────────────────────────

const isCreate = (call) =>
  call.method === 'POST' && /^\/api\/v1\/projects\/\d+\/issues$/.test(bareOf(call.path))
const isClose = (call) =>
  call.method === 'POST' &&
  /^\/api\/v1\/projects\/\d+\/issues\/[^/]+\/actions\/close$/.test(bareOf(call.path))
const isArchive = (call) =>
  call.method === 'DELETE' && /^\/api\/v1\/projects\/\d+$/.test(bareOf(call.path))
const isPurge = (call) =>
  call.method === 'POST' && /^\/api\/v1\/projects\/\d+\/actions\/purge$/.test(bareOf(call.path))

// ════════════════════════════════════════════════════════════════════════════
// (g) [M5] the import itself — FIRST, because an import happens once
// ════════════════════════════════════════════════════════════════════════════

// The transport handed nowhere: M5 says a module that reaches a hub on import
// would show up here as a call.
const idleHub = makeFakeHub()
const importLines = []
const realLog = console.log
let mod
console.log = (...args) => { importLines.push(args.map(String).join(' ')) }
try {
  mod = await import('./probe_kata_facts.mjs')
} finally {
  console.log = realLog
}

const FACTS = mod.FACTS
const probeKataFacts = mod.probeKataFacts

// ── The runner: every leg is attempted, and every failure is named ─────────

const failures = []
const test = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    failures.push({ name, err })
  }
}

/** One run of the probe against one fake hub, memoised: the legs read the same
 *  three runs, and a run is driven once. */
const runs = new Map()
const runWith = (label, opts) => {
  if (!runs.has(label)) {
    runs.set(label, (async () => {
      const hub = makeFakeHub(opts)
      const lines = []
      const result = await probeKataFacts({
        transport: hub,
        actor: ACTOR,
        log: (...args) => { lines.push(args.map(String).join(' ')) },
        now: NOW,
      })
      return { hub, lines, result: result || {} }
    })())
  }
  return runs.get(label)
}

const factLines = (lines) => lines.filter((line) => /^FACT /.test(line))
const idsOf = (lines) => factLines(lines).map((line) => (line.match(/^FACT ([^:]+):/) || [])[1])

await test('(g) [M5] importing the probe makes no request and writes no FACT line', () => {
  assert.equal(typeof probeKataFacts, 'function',
    '(g) [M1/M5] fleet/tests/probe_kata_facts.mjs exports probeKataFacts({ transport, actor, log, now })')
  assert.ok(Array.isArray(FACTS),
    '(g) [M1/M5] fleet/tests/probe_kata_facts.mjs exports FACTS, an array of {id, says}')
  assert.equal(idleHub.calls.length, 0,
    '(g) [M5] a fake transport handed nowhere has a call count of 0 after the import resolves — ' +
    `got ${idleHub.calls.length}: ${idleHub.calls.map(shown).join(', ')}`)
  assert.deepEqual(factLines(importLines), [],
    '(g) [M5] the import writes no FACT line through console.log — ' +
    `got: ${factLines(importLines).join(' | ')}`)
  // The guard M5 names: main runs only when the file is `process.argv[1]`,
  // which is what lets this exam import the module at all.
  const src = fs.readFileSync(path.join(HERE, 'probe_kata_facts.mjs'), 'utf8')
  assert.match(src, /process\.argv\[1\]/,
    '(g) [M5] the module guards its main on process.argv[1], as fleet/janitor.mjs guards its own')
  assert.match(src, /import\.meta\.url/,
    '(g) [M5] the same guard compares it against import.meta.url')
})

// ════════════════════════════════════════════════════════════════════════════
// (a) [M1] the 22 ids, and one `holds` line each against the recorded hub
// ════════════════════════════════════════════════════════════════════════════

await test('(a) [M1] FACTS is Context\'s 22 {id, says} rows, in that order', () => {
  assert.deepEqual(FACTS.map((fact) => fact.id), FACT_IDS,
    '(a) [M1] FACTS.map(f => f.id) deep-equals the 22 ids of Context in that order')
  for (const fact of FACTS) {
    assert.equal(typeof fact.says, 'string',
      `(a) [M1] FACTS row ${fact.id} carries its recorded reading as a \`says\` string`)
    assert.ok(fact.says.trim().length > 0,
      `(a) [M1] FACTS row ${fact.id}'s \`says\` is not empty`)
  }
})

await test('(a) [M1] against the recorded hub every fact holds, one line each, in FACTS order', async () => {
  const { hub, lines } = await runWith('holds', {})
  const facts = factLines(lines)
  assert.equal(facts.length, 22,
    '(a) [M1] the count of lines matching ^FACT equals 22 — ' +
    `got ${facts.length}. ${diagnose(hub)}\n  lines:\n    ${lines.join('\n    ')}`)
  assert.deepEqual(idsOf(lines), FACT_IDS,
    '(a) [M1] one FACT line per FACTS entry, in FACTS order, and a FACT line for no other id. ' +
    `${diagnose(hub)}`)
  for (const [at, id] of FACT_IDS.entries()) {
    assert.match(facts[at], new RegExp('^FACT ' + escapeRe(id) + ': holds\\b'),
      `(a) [M1] the ${id} line reads \`holds\` against a hub answering its recorded reading — ` +
      `got: ${facts[at]}. ${diagnose(hub)}`)
  }
  const one = FACT_IDS.map((id) => facts.filter((line) => line.startsWith(`FACT ${id}:`)).length)
  assert.deepEqual(one, FACT_IDS.map(() => 1),
    '(a) [M1] exactly one FACT line per id — ' +
    `got ${JSON.stringify(Object.fromEntries(FACT_IDS.map((id, at) => [id, one[at]])))}`)
  // Context's own tally line, after the FACT lines.
  const probe = lines.filter((line) => line.startsWith('PROBE:'))
  assert.deepEqual(probe, ['PROBE: 22 facts, 0 drift, 0 unreadable'],
    '(a) [Context] one PROBE: <n> facts, <d> drift, <u> unreadable line after the FACT lines — ' +
    `got: ${JSON.stringify(probe)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (b) [M2] the version line, read from the ping, and stamped on every line
// ════════════════════════════════════════════════════════════════════════════

await test('(b) [M2] the first line is the ping\'s own version, and every FACT line carries it', async () => {
  const { lines } = await runWith('holds', {})
  assert.equal(lines[0], VERSION_LINE,
    `(b) [M2] the first logged line is exactly \`${VERSION_LINE}\` — got: ${JSON.stringify(lines[0])}`)
  const facts = factLines(lines)
  const bad = facts.find((line) => !line.endsWith(` ${STAMP}`))
  assert.equal(bad, undefined,
    `(b) [M2] every FACT line ends \`${STAMP}\` — the injected now is ${NOW.toISOString()}, ` +
    `so the date is ${DATE}; the first FACT line that does not: ${JSON.stringify(bad)}`)
  const { result } = await runWith('holds', {})
  assert.equal(result.version, VERSION,
    `(b) [M2/M3] the resolved \`version\` is the ping answer's own — got ${JSON.stringify(result.version)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (c) [M3] exit 0 all-holds; one differing answer is one DRIFT line and exit 1
// ════════════════════════════════════════════════════════════════════════════

await test('(c) [M3] the all-holds run resolves exit 0, with a row per fact', async () => {
  const { hub, result } = await runWith('holds', {})
  assert.equal(result.exit, 0,
    `(c) [M3] exit is 0 when every fact holds — got ${JSON.stringify(result.exit)}. ${diagnose(hub)}`)
  assert.ok(Array.isArray(result.results),
    '(c) [M3] probeKataFacts resolves { exit, version, results } — `results` is an array')
  assert.deepEqual(result.results.map((row) => row && row.id), FACT_IDS,
    '(c) [M3] `results` carries one row per fact, in FACTS order')
})

await test('(c) [M3] the second parent link answering 200 is one DRIFT line and exit 1', async () => {
  const { hub, lines, result } = await runWith('drift', { driftParentSecond: true })
  const facts = factLines(lines)
  assert.equal(facts.length, 22,
    `(c) [M3] a drifting fact is still one FACT line per id — got ${facts.length}. ${diagnose(hub)}`)
  assert.deepEqual(idsOf(lines), FACT_IDS,
    '(c) [M3] and still in FACTS order, with a FACT line for no other id')
  const drifted = facts.filter((line) => line.startsWith('FACT link-parent-replace:'))
  assert.equal(drifted.length, 1,
    `(c) [M3] one line for link-parent-replace — got ${drifted.length}`)
  assert.match(drifted[0], /^FACT link-parent-replace: DRIFT — read 200\b/,
    '(c) [M3] the drift line names the status read: it starts ' +
    '`FACT link-parent-replace: DRIFT — read 200` — ' +
    `got: ${JSON.stringify(drifted[0])}. ${diagnose(hub)}`)
  assert.ok(drifted[0].endsWith(` ${STAMP}`),
    `(c) [M2] the drift line carries the same stamp — got: ${JSON.stringify(drifted[0])}`)
  const others = facts.filter((line) => !line.startsWith('FACT link-parent-replace:'))
  const notHolds = others.filter((line) => !/^FACT [^:]+: holds\b/.test(line))
  assert.deepEqual(notHolds, [],
    '(c) [M3] every other FACT line still reads `holds` — ' +
    `got: ${notHolds.join(' | ')}. ${diagnose(hub)}`)
  assert.equal(result.exit, 1,
    `(c) [M3] exit is 1 when a fact drifts — got ${JSON.stringify(result.exit)}`)
  const probe = lines.filter((line) => line.startsWith('PROBE:'))
  assert.deepEqual(probe, ['PROBE: 22 facts, 1 drift, 0 unreadable'],
    `(c) [Context] the tally counts the one drift — got: ${JSON.stringify(probe)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (d) [M3] a non-2xx ping: unreachable, no FACT line, exit 2
// ════════════════════════════════════════════════════════════════════════════

await test('(d) [M3] a ping answering 503 names the hub unreachable and reads no fact', async () => {
  const { lines, result } = await runWith('unreachable', { pingStatus: 503 })
  assert.ok(lines.length > 0, '(d) [M3] the probe writes its first line even when the ping fails')
  assert.match(lines[0], /unreachable/i,
    `(d) [M3] the first line names the hub as unreachable — got: ${JSON.stringify(lines[0])}`)
  assert.ok(lines[0].includes('503'),
    `(d) [M3] and carries the status it read — got: ${JSON.stringify(lines[0])}`)
  assert.deepEqual(factLines(lines), [],
    `(d) [M3] no line starting \`FACT \` is written — got: ${factLines(lines).join(' | ')}`)
  assert.equal(result.exit, 2,
    `(d) [M3] exit is 2 when the ping failed — got ${JSON.stringify(result.exit)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (e) [M4] the cleanup ladder ends both 2xx-ping runs, in order
// ════════════════════════════════════════════════════════════════════════════

/**
 * M4's ladder, read off one run's recorded requests: the closes, then the
 * archive, then the confirmed purge as the very last request.
 *
 * The count is M4's own parenthetical — "one `POST …/actions/close` per issue
 * it created … and never fewer" — measured against the issues the hub really
 * created. Leg (e)'s "N equals the number of `POST …/issues` requests
 * recorded" cannot be that count: facts 5 and 6 require create requests that
 * create no issue (409 `idempotency_mismatch`, 409 `duplicate_candidates`) and
 * fact 4's replay answers an issue that already exists.
 */
const assertLadder = (label, hub) => {
  const calls = hub.calls
  const id = hub.projectId()
  const name = hub.projectName()
  assert.ok(id !== null,
    `(e) [M4] the ${label} run created its own project through POST /api/v1/projects`)
  assert.match(String(name), /^probe-kata-facts-/,
    `(e) [M4] the ${label} run's project name begins \`probe-kata-facts-\` — got ${JSON.stringify(name)}`)
  assert.ok(hub.created.length > 0,
    `(e) [M4] the ${label} run created at least one issue to close`)

  const last = calls[calls.length - 1]
  assert.ok(isPurge(last),
    `(e) [M4] the very last request of the ${label} run is ` +
    `POST /api/v1/projects/${id}/actions/purge — got ${shown(last)}`)
  assert.equal(bareOf(last.path), `/api/v1/projects/${id}/actions/purge`,
    `(e) [M4] and it purges the probe's own project — got ${shown(last)}`)
  assert.equal(header(last.headers, 'X-Kata-Confirm'), `PURGE ${name}`,
    `(e) [M4] the purge carries X-Kata-Confirm equal to \`PURGE ${name}\` — the name its ` +
    `POST /api/v1/projects body carried; got ${JSON.stringify(header(last.headers, 'X-Kata-Confirm'))}`)
  assert.ok(Object.prototype.hasOwnProperty.call(last.headers, 'X-Kata-Confirm'),
    '(e) [M4] spelled `X-Kata-Confirm`, as Context spells it — got the header names ' +
    JSON.stringify(Object.keys(last.headers)))

  const archive = calls[calls.length - 2]
  assert.ok(isArchive(archive) && bareOf(archive.path) === `/api/v1/projects/${id}`,
    `(e) [M4] the request before it is DELETE /api/v1/projects/${id} — got ${shown(archive)}`)

  // The closes: the maximal run of them immediately before the archive.
  let at = calls.length - 3
  const closes = []
  while (at >= 0 && isClose(calls[at])) {
    closes.unshift(calls[at])
    at -= 1
  }
  assert.equal(closes.length, hub.created.length,
    `(e) [M4] the ${label} run's ladder opens with one POST …/actions/close per issue it created, ` +
    `and never fewer: ${hub.created.length} created (${hub.created.join(', ')}), ` +
    `${closes.length} closed in the trailing block. The first request out of order is ` +
    `${shown(calls[at])} at index ${at} of ${calls.length}. ` +
    `${calls.filter(isCreate).length} POST …/issues requests were recorded in all, of which ` +
    `${hub.created.length} created an issue.`)
  assert.deepEqual(closes.map((call) => call.issueUid).sort(), [...hub.created].sort(),
    `(e) [M4] and one close per created issue, naming each exactly once — closed ` +
    `${JSON.stringify(closes.map((call) => call.issueUid))}, created ${JSON.stringify(hub.created)}`)
}

await test('(e) [M4] the all-holds run ends closes → archive → confirmed purge', async () => {
  const { hub } = await runWith('holds', {})
  assertLadder('all-holds', hub)
})

await test('(e) [M4] the drift run ends the same ladder', async () => {
  const { hub } = await runWith('drift', { driftParentSecond: true })
  assertLadder('drift', hub)
})

// ════════════════════════════════════════════════════════════════════════════
// (f) [M4] a purge that fails names the project left behind, and is exit 2
// ════════════════════════════════════════════════════════════════════════════

await test('(f) [M4] a confirmed purge answering 500 is exit 2 and a `left behind` last line', async () => {
  const { hub, lines, result } = await runWith('purge-500', { purgeStatus: 500 })
  const facts = factLines(lines)
  assert.equal(facts.length, 22,
    `(f) [M4] every fact is still read — got ${facts.length} FACT lines. ${diagnose(hub)}`)
  const notHolds = facts.filter((line) => !/^FACT [^:]+: holds\b/.test(line))
  assert.deepEqual(notHolds, [],
    '(f) [M4] and every FACT line reads `holds`: the confirmed purge is the CLEANUP, so its ' +
    'failure is exit 2 and not a drift on purge-ladder — ' +
    `got: ${notHolds.join(' | ')}. ${diagnose(hub)}`)
  const last = lines[lines.length - 1]
  assert.ok(String(last).includes(String(hub.projectId())),
    `(f) [M4] the last logged line carries the project id ${hub.projectId()} — ` +
    `got: ${JSON.stringify(last)}`)
  assert.match(String(last), /left behind/,
    `(f) [M4] and says it is left behind, so a hand run never loses a project silently — ` +
    `got: ${JSON.stringify(last)}`)
  assert.equal(result.exit, 2,
    `(f) [M4] exit is 2 when the cleanup failed — got ${JSON.stringify(result.exit)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (h) [M5] PROBES.md says when the probe is run
// ════════════════════════════════════════════════════════════════════════════

await test('(h) [M5] PROBES.md lists the probe, the upgrade and the client it guards', () => {
  const joined = fs.readFileSync(PROBES_MD, 'utf8').split('\n').join(' ')
  assert.match(joined, /probe_kata_facts\.mjs.*kata upgrade.*kata-client\.mjs/,
    '(h) [M5] fleet/tests/PROBES.md, joined with spaces, matches ' +
    'probe_kata_facts.mjs.*kata upgrade.*kata-client.mjs — it lists the probe with when it is ' +
    'run: on every kata upgrade and before any plan that touches fleet/kata-client.mjs')
})

// ── The verdict ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`FAILED ${name}\n  ${err?.message ?? err}`)
  }
  console.error(`${failures.length} failing leg${failures.length === 1 ? '' : 's'}`)
  process.exit(1)
}

console.log('ALL TESTS PASSED')
