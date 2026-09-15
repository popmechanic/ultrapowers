// fleet/tests/probe_kata_facts.mjs — the fleet's 24 kata facts, re-read against
// the live hub, one line per fact, each stamped with the version it was read on.
//
// NOT named test_*.mjs on purpose: `tests/test_fleet_suite.py` globs `test_*.mjs`,
// so the suite never runs this and CI never needs a hub. It is a LIVE MEASUREMENT
// (fleet/tests/PROBES.md) and is run by hand on the laptop, where the ssh seam to
// the hub lives:
//
//     node fleet/tests/probe_kata_facts.mjs
//
// WHY IT EXISTS. What the fleet knows about kata is spread across #978, #979,
// #993, CLAUDE.md's seams paragraph and the comments in `fleet/kata-client.mjs`,
// and every one of those readings is a date — a hub upgrade can make any of them
// false without a single test going red, because no test in the tree talks to a
// hub. This probe is the one command that re-reads them all: run it on every kata
// upgrade and before any plan that touches `fleet/kata-client.mjs`.
//
// NO BEARER ON THE LAPTOP. Every request rides `sshTransport` from
// `fleet/kata-client.mjs` — `ssh <hub> curl …`, the bearer sourced on the hub by
// the hub's own shell — exactly as the launcher and the janitor reach it. This
// file reads `~/.ultrapowers/kata-hub.env` for ONE thing, the host of `KATA_URL`;
// the secret on that file's other line is never read here and never enters an
// argv. The sandbox cannot run this at all: it reaches the hub through the edge
// with no credential of its own and cannot file a throwaway project.
//
// HOW A FACT IS SCORED. Each fact is a short list of request STEPS, each recorded
// with the status the fleet last read. A step HOLDS when the status it answers is
// in the same class as the recorded one — a 2xx where a 2xx was recorded, a 4xx
// where a 4xx was recorded — so kata re-spelling a refusal 400 instead of 409 is
// not reported as drift, while a refusal that became an acceptance (or the other
// way round) is. That is the drift that costs the fleet a run. The bodies are
// read too and echoed into the line, because the shape a fact names (a flat
// dotted key, an `issue_uid`, a links row) is for the human reading the output;
// the machine verdict stays on the statuses, which is the half a status-only
// seam can judge without a second opinion about what the hub meant. A step the
// transport could not answer at all (status 0, or a throw) makes its fact
// UNREADABLE rather than drifted.
//
// THE THROWAWAY PROJECT. Everything is read inside `probe-kata-facts-<stamp>`,
// created at the start and removed at the end by the very ladder the last fact
// measures: close every issue the probe created, `DELETE` the project (the
// archive), then the confirmed purge. A purge that fails is exit 2 and the last
// line names the project id, so a hand run never leaves a project behind
// silently.
//
// Exit: 0 every fact holds; 1 at least one drift (or an unreadable fact);
// 2 the ping failed, or the cleanup left the project behind.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sshTransport } from '../kata-client.mjs'
import { defaultKataEnvPath, parseKataEnv, defaultExec, kataHostOf } from '../lobby.mjs'

/** Everything under one prefix, as `fleet/kata-client.mjs` spells it. */
const API = '/api/v1'

/** Who the mutations are filed as. Every mutation body carries it. */
const DEFAULT_ACTOR = 'probe-kata-facts'

/**
 * The evidence every `done` close carries — kata v0.17.2 refuses a `done` close
 * whose `evidence` is empty (`evidence required for reason=done`, #1023), and
 * the `test` shape is the one the engine already sends. One entry, on every
 * done close but the deliberately bare one `close-evidence-required` reads.
 */
const EVIDENCE = Object.freeze([
  Object.freeze({ type: 'test', command: 'node fleet/tests/probe_kata_facts.mjs' }),
])

/**
 * The 24 facts, in the order they are read. `says` is the reading the fleet
 * holds today — the sentence a drift line quotes back — and the ids are the
 * shared literal the hand-read rows in `fleet/RUNBOOK.md` carry row for row.
 */
export const FACTS = Object.freeze([
  { id: 'ping-version',
    says: 'GET /api/v1/ping is 200 with a version string and needs no bearer' },
  { id: 'project-find-or-create',
    says: 'a second POST /api/v1/projects with an existing name is 200, the same project.id, created:false' },
  { id: 'project-by-id-only',
    says: 'GET /api/v1/projects/<name>/issues with the project NAME in the path is 400' },
  { id: 'create-replay',
    says: 'a create under an Idempotency-Key, replayed byte-identical, is 200 with the same issue.uid and the ORIGINAL revision' },
  { id: 'create-fingerprint-metadata',
    says: 'the same Idempotency-Key with a different metadata is 409 idempotency_mismatch naming the prior uid' },
  { id: 'create-duplicate-scorer',
    says: 'a second create with the same title, no key and no force_new, is 409 duplicate_candidates, and force_new:true is 200 (read 2026-09-15)' },
  { id: 'link-blocks-idempotent',
    says: 'the same {type:"blocks"} link twice is 200 both times with the same link.id' },
  { id: 'link-parent-replace',
    says: 'a second {type:"parent"} link is 409 parent_already_set, and replace:true is 200 and swaps the parent' },
  { id: 'link-types',
    says: '{type:"blocked_by"} is 400 — the accepted types are exactly parent, blocks, related' },
  { id: 'metadata-merge-if-match',
    says: 'a metadata patch under If-Match "rev-<revision>" merges per key, and a stale revision is 412 revision_conflict' },
  { id: 'metadata-dotted-flat',
    says: 'a patch {"work.state":"x"} reads back as the flat key metadata["work.state"], and metadata.work is absent' },
  { id: 'claim-if-unowned',
    says: 'claim {if_unowned:true} on an owned issue is 409 already_claimed with error.data.current_owner' },
  { id: 'unassign-key',
    says: 'unassign {expect_owner} is 400 naming expect_owner as unexpected — the documented key is expected_owner' },
  { id: 'close-evidence-required',
    says: 'a done close whose evidence is [] is 400 evidence required for reason=done, and the same body with one test entry is 200' },
  { id: 'close-message-40',
    says: 'a close whose message is 39 characters is refused with a 4xx, and the same body with 40 characters is 200' },
  { id: 'close-retry-protocol',
    says: 'a close under an Idempotency-Key with no retry_protocol is refused with a 4xx, and retry_protocol:"close-v1" is 200' },
  { id: 'close-superseded-evidence',
    says: 'reason:"superseded" with evidence:[{type:"superseded-by", ref:<uid>}] is 400' },
  { id: 'ready-unowned',
    says: 'GET /ready is 200 listing open issues with no open blocks predecessor; ?unowned=true drops an owned one and ?owner=<x> changes nothing' },
  { id: 'next-no-endpoint',
    says: 'GET /api/v1/projects/<id>/next is 404' },
  { id: 'labels-merge',
    says: 'the same label posted twice leaves the issue with that label once' },
  { id: 'events-issue-uid',
    says: 'GET /events is 200 and its issue.created rows carry issue_uid, while project.created carries none' },
  { id: 'issue-links-shape',
    says: 'GET /api/v1/issues/<uid> answers links as rows {id, type, from:{uid, short_id}, to:{uid, short_id}}' },
  { id: 'archive-actor-required',
    says: 'DELETE /api/v1/projects/<id> with no actor query parameter is 400 actor: required query parameter is missing' },
  { id: 'purge-ladder',
    says: 'purge with no header is 412 confirm_required, confirmed but unarchived is 409 project_not_archived, DELETE ?actor= with an open issue is refused, and after every close the archive DELETE ?actor= is 200' },
])

// ── Small readings of an answer ─────────────────────────────────────────────

const is2xx = (status) => status >= 200 && status < 300
const is4xx = (status) => status >= 400 && status < 500

/** The class a status is scored in: a recorded 409 and a read 400 are one
 *  reading of the same seam, a recorded 409 and a read 200 are not. */
const statusClass = (status) => {
  if (is2xx(status)) return '2xx'
  if (is4xx(status)) return '4xx'
  return String(status)
}

/** The issue a mutation answered, as `fleet/kata-client.mjs` reads it, with the
 *  un-nested spelling tolerated so a hub that flattens one day still reads. */
const issueOf = (json) => (json && (json.issue || json)) || {}
const uidOf = (json) => {
  const uid = issueOf(json).uid
  return typeof uid === 'string' && uid ? uid : null
}
const revisionOf = (json) => {
  const rev = issueOf(json).revision
  return Number.isFinite(rev) ? rev : null
}

/** `2026-09-15` — the date every line is stamped with. */
const stampDate = (now) => {
  const when = now instanceof Date ? now : new Date(now)
  return when.toISOString().slice(0, 10)
}

/** `probe-kata-facts-20260915-093312-a1b4`: the throwaway project's name, and
 *  the string the confirmed purge's header has to repeat. */
const projectNameFor = (now) => {
  const when = now instanceof Date ? now : new Date(now)
  const iso = when.toISOString()
  const stamp = iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '')
  const tail = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return 'probe-kata-facts-' + stamp + '-' + tail
}

/** A close message of exactly `n` characters — 39 and 40 are the whole of the
 *  close-message fact, so they are cut from one string rather than counted by
 *  hand. */
const CLOSE_TEXT = 'probe-kata-facts closed the throwaway issue it created for this reading of the hub'
const closeMessage = (n) => CLOSE_TEXT.slice(0, n)

// ── The probe ───────────────────────────────────────────────────────────────

/**
 * Read all 24 facts against `transport` and write one line per fact through
 * `log`.
 *
 * `transport` is the seam `fleet/kata-client.mjs` defines — `request({method,
 * path, headers, body}) -> {status, json, body}` — used RAW rather than through
 * `makeKataClient`, because the client has no unassign, no archive and no purge,
 * and several facts here are refusals the client would throw on.
 *
 * Resolves `{ exit, version, results }`.
 */
export const probeKataFacts = async ({
  transport,
  actor = DEFAULT_ACTOR,
  log = console.log,
  now = new Date(),
} = {}) => {
  const date = stampDate(now)

  // One request. A transport that threw, or answered no status at all, comes
  // back as status 0 — an unreadable step, never a drift.
  const send = async ({ method, path: at, headers, body }) => {
    try {
      const res = await transport.request({ method, path: at, headers: headers || {}, body })
      const status = Number(res && res.status)
      return {
        status: Number.isFinite(status) ? status : 0,
        json: (res && res.json) || null,
        error: null,
      }
    } catch (err) {
      return { status: 0, json: null, error: err }
    }
  }

  const ping = await send({ method: 'GET', path: API + '/ping' })
  if (!is2xx(ping.status)) {
    log('kata hub unreachable — GET ' + API + '/ping answered ' + ping.status)
    return { exit: 2, version: null, results: [] }
  }
  const pingVersion = (ping.json && typeof ping.json.version === 'string' && ping.json.version)
    ? ping.json.version
    : 'unknown'
  log('kata ' + pingVersion + ' — read from GET ' + API + '/ping')

  const name = projectNameFor(now)
  const made = await send({ method: 'POST', path: API + '/projects', body: { name, actor } })
  const madeProject = (made.json && (made.json.project || made.json)) || {}
  const projectId = (madeProject.id === undefined || madeProject.id === null)
    ? name
    : String(madeProject.id)

  const projectsPath = API + '/projects/' + projectId
  const issuesPath = projectsPath + '/issues'
  const issuePath = (uid) => issuesPath + '/' + uid

  // Every create the probe files, in request order: the uid it answered, or null
  // when it was a refusal the fact expected. More creates than issues, always:
  // fact 4's replay answers an issue that already exists, and facts 5 and 6 file
  // creates the hub is recorded REFUSING. So the cleanup owes one close per uid
  // the hub actually named — `issues`, in the order the hub named them, each
  // once — which is M4's "one close per issue it created, and never fewer".
  const creates = []
  const issues = []
  let synthetic = 0

  /** A create request, recorded. `expect` is the status the fleet last read. */
  const create = async (title, { key, metadata, forceNew } = {}) => {
    const body = {
      title,
      body: 'Filed by ' + DEFAULT_ACTOR + ' against ' + name + '. Closed and purged by the same run.',
      actor,
      metadata: metadata || { probe: DEFAULT_ACTOR },
      links: [],
      ...(forceNew === undefined ? {} : { force_new: forceNew }),
    }
    const res = await send({
      method: 'POST',
      path: issuesPath,
      headers: key === undefined ? {} : { 'Idempotency-Key': String(key) },
      body,
    })
    const uid = uidOf(res.json)
    creates.push(uid)
    if (uid && !issues.includes(uid)) issues.push(uid)
    return res
  }

  /** The uid a step needs when the hub answered none: never `undefined` in a
   *  path, so a reading stays legible even against a half-answering hub. */
  const someUid = (uid) => {
    if (uid) return uid
    const known = creates.find((one) => !!one)
    if (known) return known
    synthetic += 1
    return 'probe-uid-' + synthetic
  }

  // The state the later facts read: the keyed issue, its revision, the force_new
  // issue, and the second parent target.
  const state = { uid: null, revision: 1, other: null, parent: null }

  /** One scored step: the request, and the status it was recorded answering. */
  const step = async (expect, spec) => {
    const res = await send(spec)
    return { expect, method: spec.method, path: spec.path, status: res.status, json: res.json }
  }

  // ── The 24 readings ───────────────────────────────────────────────────────
  //
  // Each reader answers `{ steps, note }`: the scored steps, and the half of the
  // reading that is the answer's SHAPE, echoed into the line for the human.
  // Setup that is not itself a fact — a scaffold issue, the first claim — is
  // sent here too but left out of `steps`.

  const READERS = {
    'ping-version': async () => ({
      steps: [{ expect: 200, method: 'GET', path: API + '/ping', status: ping.status, json: ping.json }],
      note: 'version ' + pingVersion,
    }),

    'project-find-or-create': async () => {
      const again = await step(200, { method: 'POST', path: API + '/projects', body: { name, actor } })
      const project = (again.json && (again.json.project || again.json)) || {}
      const sameId = project.id === undefined ? 'no id' : ('id ' + project.id)
      const created = again.json && 'created' in again.json ? String(again.json.created) : 'absent'
      return { steps: [again], note: sameId + ', created ' + created }
    },

    'project-by-id-only': async () => {
      const byName = await step(400, { method: 'GET', path: API + '/projects/' + name + '/issues' })
      return { steps: [byName], note: 'the name in the path' }
    },

    'create-replay': async () => {
      const title = name + ' — the keyed issue'
      const key = name + '-create-replay'
      const first = await create(title, { key })
      state.uid = uidOf(first.json) || someUid(null)
      state.revision = revisionOf(first.json) ?? 1
      const replay = await create(title, { key })
      const sameUid = uidOf(replay.json) === uidOf(first.json) ? 'same uid' : 'a different uid'
      const revision = revisionOf(replay.json)
      const sameRevision = revision === revisionOf(first.json)
        ? 'the original revision'
        : ('revision ' + revision)
      return {
        steps: [
          { expect: 200, method: 'POST', path: issuesPath, status: first.status, json: first.json },
          { expect: 200, method: 'POST', path: issuesPath, status: replay.status, json: replay.json },
        ],
        note: 'replay answered ' + sameUid + ' and ' + sameRevision,
      }
    },

    'create-fingerprint-metadata': async () => {
      const mismatch = await create(name + ' — the keyed issue', {
        key: name + '-create-replay',
        metadata: { probe: DEFAULT_ACTOR, fingerprint: 'moved' },
      })
      const error = (mismatch.json && mismatch.json.error) || {}
      return {
        steps: [{ expect: 409, method: 'POST', path: issuesPath, status: mismatch.status, json: mismatch.json }],
        note: 'error ' + (error.code || 'absent'),
      }
    },

    'create-duplicate-scorer': async () => {
      const title = name + ' — the keyed issue'
      const scored = await create(title)
      const forced = await create(title, { forceNew: true })
      state.other = uidOf(forced.json) || someUid(null)
      const error = (scored.json && scored.json.error) || {}
      return {
        steps: [
          { expect: 409, method: 'POST', path: issuesPath, status: scored.status, json: scored.json },
          { expect: 200, method: 'POST', path: issuesPath, status: forced.status, json: forced.json },
        ],
        note: 'error ' + (error.code || 'absent') + ', force_new answered ' + forced.status,
      }
    },

    'link-blocks-idempotent': async () => {
      const at = issuePath(someUid(state.uid)) + '/links'
      const body = { type: 'blocks', to_ref: someUid(state.other), actor }
      const first = await step(200, { method: 'POST', path: at, body })
      const again = await step(200, { method: 'POST', path: at, body })
      const idOf = (one) => (issueOf(one.json).link || (one.json && one.json.link) || {}).id
      const same = idOf(first) !== undefined && idOf(first) === idOf(again) ? 'the same link.id' : 'no link.id read'
      return { steps: [first, again], note: same }
    },

    'link-parent-replace': async () => {
      // The second parent needs somewhere else to point, and a create with a
      // title of its own is not the duplicate scorer's business.
      const target = await create(name + ' — the second parent', { forceNew: true })
      state.parent = uidOf(target.json) || someUid(null)
      const at = issuePath(someUid(state.uid)) + '/links'
      const first = await step(200, {
        method: 'POST', path: at, body: { type: 'parent', to_ref: someUid(state.other), actor },
      })
      const second = await step(409, {
        method: 'POST', path: at, body: { type: 'parent', to_ref: someUid(state.parent), actor },
      })
      const replaced = await step(200, {
        method: 'POST', path: at, body: { type: 'parent', to_ref: someUid(state.parent), actor, replace: true },
      })
      const error = (second.json && second.json.error) || {}
      return { steps: [first, second, replaced], note: 'error ' + (error.code || 'absent') + ' on the second' }
    },

    'link-types': async () => {
      const refused = await step(400, {
        method: 'POST',
        path: issuePath(someUid(state.uid)) + '/links',
        body: { type: 'blocked_by', to_ref: someUid(state.other), actor },
      })
      return { steps: [refused], note: 'blocked_by' }
    },

    'metadata-merge-if-match': async () => {
      const at = issuePath(someUid(state.uid)) + '/metadata'
      const ifMatch = (revision) => ({ 'If-Match': '"rev-' + revision + '"' })
      const first = await step(200, {
        method: 'POST', path: at, headers: ifMatch(state.revision), body: { actor, patch: { probe_first: 'a' } },
      })
      // Only what the hub itself said the revision now is: an answer carrying
      // none leaves the last one standing rather than guessing an increment,
      // because the next If-Match is the whole point of reading it back.
      state.revision = revisionOf(first.json) ?? state.revision
      const second = await step(200, {
        method: 'POST', path: at, headers: ifMatch(state.revision), body: { actor, patch: { probe_second: 'b' } },
      })
      state.revision = revisionOf(second.json) ?? state.revision
      const stale = await step(412, {
        method: 'POST', path: at, headers: ifMatch(state.revision - 1), body: { actor, patch: { probe_stale: 'c' } },
      })
      const merged = issueOf(second.json).metadata || {}
      const kept = ('probe_first' in merged && 'probe_second' in merged)
        ? 'both keys kept'
        : 'the merge is unreadable from the answer'
      const error = (stale.json && stale.json.error) || {}
      return { steps: [first, second, stale], note: kept + ', stale error ' + (error.code || 'absent') }
    },

    'metadata-dotted-flat': async () => {
      const dotted = await step(200, {
        method: 'POST',
        path: issuePath(someUid(state.uid)) + '/metadata',
        headers: { 'If-Match': '"rev-' + state.revision + '"' },
        body: { actor, patch: { 'work.state': 'probe' } },
      })
      state.revision = revisionOf(dotted.json) ?? state.revision
      const metadata = issueOf(dotted.json).metadata || {}
      const flat = ('work.state' in metadata) ? 'a flat key' : 'no flat key read'
      const nested = ('work' in metadata) ? ', and metadata.work is present' : ', and metadata.work is absent'
      return { steps: [dotted], note: flat + nested }
    },

    'claim-if-unowned': async () => {
      const at = issuePath(someUid(state.other)) + '/actions/claim'
      const body = { actor, if_unowned: true }
      await send({ method: 'POST', path: at, body })  // the owner the fact needs
      const owned = await step(409, { method: 'POST', path: at, body })
      const error = (owned.json && owned.json.error) || {}
      const who = (error.data && error.data.current_owner) || 'absent'
      return { steps: [owned], note: 'error ' + (error.code || 'absent') + ', current_owner ' + who }
    },

    'unassign-key': async () => {
      const refused = await step(400, {
        method: 'POST',
        path: issuePath(someUid(state.other)) + '/actions/unassign',
        body: { actor, expect_owner: actor },
      })
      return { steps: [refused], note: 'expect_owner' }
    },

    'close-evidence-required': async () => {
      const made = await create(name + ' — the bare-evidence close', { forceNew: true })
      const at = issuePath(someUid(uidOf(made.json))) + '/actions/close'
      const close = (evidence) => ({
        method: 'POST',
        path: at,
        body: { actor, reason: 'done', message: closeMessage(48), evidence, retry_protocol: 'close-v1' },
      })
      const bare = await step(400, close([]))
      const carried = await step(200, close(EVIDENCE))
      return { steps: [bare, carried], note: 'evidence [] then one test entry' }
    },

    'close-message-40': async () => {
      const made = await create(name + ' — the short-message close', { forceNew: true })
      const at = issuePath(someUid(uidOf(made.json))) + '/actions/close'
      const close = (message) => ({
        method: 'POST',
        path: at,
        body: { actor, reason: 'done', message, evidence: EVIDENCE, retry_protocol: 'close-v1' },
      })
      const short = await step(400, close(closeMessage(39)))
      const long = await step(200, close(closeMessage(40)))
      return { steps: [short, long], note: '39 characters then 40' }
    },

    'close-retry-protocol': async () => {
      const made = await create(name + ' — the keyed close', { forceNew: true })
      const at = issuePath(someUid(uidOf(made.json))) + '/actions/close'
      const headers = { 'Idempotency-Key': name + '-close-retry-protocol' }
      const body = { actor, reason: 'done', message: closeMessage(48), evidence: EVIDENCE }
      const bare = await step(400, { method: 'POST', path: at, headers, body })
      const named = await step(200, {
        method: 'POST', path: at, headers, body: { ...body, retry_protocol: 'close-v1' },
      })
      return { steps: [bare, named], note: 'the key without the protocol, then with it' }
    },

    'close-superseded-evidence': async () => {
      const made = await create(name + ' — the superseded close', { forceNew: true })
      const refused = await step(400, {
        method: 'POST',
        path: issuePath(someUid(uidOf(made.json))) + '/actions/close',
        body: {
          actor,
          reason: 'superseded',
          message: closeMessage(48),
          evidence: [{ type: 'superseded-by', ref: someUid(state.uid) }],
          retry_protocol: 'close-v1',
        },
      })
      return { steps: [refused], note: 'evidence carrying ref' }
    },

    'ready-unowned': async () => {
      const ready = await step(200, { method: 'GET', path: projectsPath + '/ready' })
      const unowned = await step(200, { method: 'GET', path: projectsPath + '/ready?unowned=true' })
      const owned = await step(200, { method: 'GET', path: projectsPath + '/ready?owner=' + encodeURIComponent(actor) })
      const rows = (one) => {
        const json = one.json || {}
        const list = Array.isArray(json) ? json : (json.issues || json.ready || json.items)
        return Array.isArray(list) ? list.length : 'unreadable'
      }
      return {
        steps: [ready, unowned, owned],
        note: rows(ready) + ' ready, ' + rows(unowned) + ' unowned, ' + rows(owned) + ' for owner=' + actor,
      }
    },

    'next-no-endpoint': async () => {
      const missing = await step(404, { method: 'GET', path: projectsPath + '/next' })
      return { steps: [missing], note: 'no /next endpoint' }
    },

    'labels-merge': async () => {
      const at = issuePath(someUid(state.uid)) + '/labels'
      const body = { actor, label: 'probe-kata-facts' }
      const first = await step(200, { method: 'POST', path: at, body })
      const again = await step(200, { method: 'POST', path: at, body })
      const labels = issueOf(again.json).labels
      const many = Array.isArray(labels)
        ? 'carried ' + labels.filter((one) => one === 'probe-kata-facts').length + ' time(s) in the answer'
        : 'no labels in the answer'
      return { steps: [first, again], note: 'the same label twice, ' + many }
    },

    'events-issue-uid': async () => {
      const events = await step(200, {
        method: 'GET', path: projectsPath + '/events?after_id=0&limit=1000',
      })
      const json = events.json || {}
      const rows = Array.isArray(json) ? json : (json.events || [])
      const created = Array.isArray(rows) ? rows.filter((row) => row && row.type === 'issue.created') : []
      const withUid = created.filter((row) => row && row.issue_uid !== undefined).length
      return { steps: [events], note: withUid + ' of ' + created.length + ' issue.created rows carry issue_uid' }
    },

    'issue-links-shape': async () => {
      const read = await step(200, { method: 'GET', path: API + '/issues/' + someUid(state.uid) })
      const links = issueOf(read.json).links
      const shaped = Array.isArray(links)
        ? links.filter((row) => row && row.type !== undefined &&
            row.from && row.from.uid !== undefined && row.to && row.to.uid !== undefined).length +
          ' of ' + links.length + ' rows carry {type, from.uid, to.uid}'
        : 'no links array in the answer'
      return { steps: [read], note: shaped }
    },

    // The ladder IS the cleanup, which is why it is read last. The confirmed
    // purge is deliberately NOT one of these steps: it is the removal, and
    // whether the project was left behind is an exit code and a last line, not
    // a fact about the hub's shape.
    'archive-actor-required': async () => {
      // Read while the issues are still open: the hub validates the missing
      // parameter before any state check, so the bare read is a 400 and not
      // the ladder's open-issue refusal.
      const refused = await step(400, { method: 'DELETE', path: projectsPath })
      return { steps: [refused], note: 'no actor query' }
    },

    'purge-ladder': async () => {
      const purgePath = projectsPath + '/actions/purge'
      const archivePath = projectsPath + '?actor=' + encodeURIComponent(actor)
      const bare = await step(412, { method: 'POST', path: purgePath, body: { actor } })
      const unarchived = await step(409, {
        method: 'POST', path: purgePath, headers: { 'X-Kata-Confirm': 'PURGE ' + name }, body: { actor },
      })
      const open = await step(400, { method: 'DELETE', path: archivePath })

      // One close per ISSUE THE HUB CREATED, naming each exactly once — a close
      // on an issue a fact already closed is filed all the same, so the block is
      // one close per issue whatever order the facts read in, and the archive
      // below is what reports a missed one.
      for (const uid of issues) {
        await send({
          method: 'POST',
          path: issuePath(uid) + '/actions/close',
          body: {
            actor,
            reason: 'done',
            message: closeMessage(48),
            evidence: EVIDENCE,
            retry_protocol: 'close-v1',
          },
        })
      }

      const archive = await step(200, { method: 'DELETE', path: archivePath })
      state.archived = is2xx(archive.status)
      const codeOf = (one) => ((one.json && one.json.error) || {}).code || 'absent'
      return {
        steps: [bare, unarchived, open, archive],
        note: codeOf(bare) + ' then ' + codeOf(unarchived) + ' then ' + codeOf(open) +
          ', ' + issues.length + ' closes for ' + creates.length + ' creates, then the archive',
      }
    },
  }

  const results = []
  let drift = 0
  let unreadable = 0

  for (const fact of FACTS) {
    const { steps, note } = await READERS[fact.id]()
    const missed = steps.find((one) => one.status === 0)
    const drifted = steps.find((one) => statusClass(one.status) !== statusClass(one.expect))
    const statuses = steps.map((one) => one.status).join(', ')
    let verdict = 'holds'
    let read = statuses + (note ? ' — ' + note : '')
    if (missed) {
      verdict = 'unreadable'
      unreadable += 1
      read = 'no answer to ' + missed.method + ' ' + missed.path
    } else if (drifted) {
      verdict = 'drift'
      drift += 1
      read = drifted.status + ' on ' + drifted.method + ' ' + drifted.path
    }
    const stamp = ' (kata ' + pingVersion + ', ' + date + ')'
    const line = verdict === 'holds'
      ? 'FACT ' + fact.id + ': holds — ' + read + stamp
      : (verdict === 'drift'
          ? 'FACT ' + fact.id + ': DRIFT — read ' + read + ', recorded ' + fact.says + stamp
          : 'FACT ' + fact.id + ': UNREADABLE — ' + read + ', recorded ' + fact.says + stamp)
    log(line)
    results.push({ id: fact.id, verdict, read, line })
  }

  log('PROBE: ' + FACTS.length + ' facts, ' + drift + ' drift, ' + unreadable + ' unreadable')

  // The last request of every run whose ping answered: the confirmed purge, the
  // header repeating the project's own name.
  const purge = await send({
    method: 'POST',
    path: projectsPath + '/actions/purge',
    headers: { 'X-Kata-Confirm': 'PURGE ' + name },
    body: { actor },
  })

  let exit = (drift > 0 || unreadable > 0) ? 1 : 0
  if (!is2xx(purge.status) || state.archived === false) {
    const named = projectId === name ? projectId : projectId + ' (' + name + ')'
    log('PROBE: project ' + named + ' left behind — POST ' + projectsPath +
      '/actions/purge answered ' + purge.status)
    exit = 2
  }

  return { exit, version: pingVersion, results }
}

// ── The hand run ────────────────────────────────────────────────────────────
//
// Guarded exactly as `fleet/janitor.mjs` guards its own, because the exam
// imports this module: nothing below runs on an import, so an import files no
// request, reads no environment file and exits no process.

const main = async () => {
  const at = defaultKataEnvPath()
  let text = ''
  try {
    text = fs.readFileSync(at, 'utf8')
  } catch {
    process.stderr.write('probe_kata_facts: no ' + at + ' — run `node fleet/kata-hub.mjs` first\n')
    process.exit(2)
  }
  const sshHost = kataHostOf(parseKataEnv(text).url)
  if (!sshHost) {
    process.stderr.write('probe_kata_facts: no hub url in ' + at + '\n')
    process.exit(2)
  }
  const { exit } = await probeKataFacts({ transport: sshTransport({ sshHost, exec: defaultExec }) })
  process.exit(exit)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
