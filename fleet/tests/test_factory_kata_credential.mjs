/**
 * fleet/tests/test_factory_kata_credential.mjs — the exam for "The credential
 * helper — a spoke is approved through the edge, and no token is ever
 * copied".
 *
 * This file is the Proof's `Test:`, written at the path the Proof names. It
 * imports nothing from `factory/kata-credential.mjs` — the helper is a
 * standalone program, run exactly as Kata itself runs it: spawned with
 * `--kata-json <file> --admin-url <url> --state-dir <dir>` and handed one
 * JSON object on stdin. Every leg below spawns the real file at
 * `factory/kata-credential.mjs` (which does not exist yet, so every spawn
 * below is red until it does) against a fake hub — a real `node:http`
 * listener on `127.0.0.1:0` in THIS process — and reads its stdout, its
 * stderr, its exit code and the state directory it was given.
 *
 * The legs, and the Machine clause each comes from — every assertion below
 * names its clause in its message, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] against a fake hub answering 200 to both routes, the fake saw,
 *       in order, `POST …/federation/enable` for the kata.json project id and
 *       `POST …/federation/enrollments` whose body carries `project_id`,
 *       `spoke_instance_uid`, `capabilities`, `actor` and `token` as M1 says,
 *       and neither request carried an `authorization` header.
 *   (b) [M2] on that same exchange, stdout parses to an object with exactly
 *       the ten named keys, `status` `ready`, the right `hub_url`,
 *       `project_id`, `enrollment_id`, `project_uid` and `capabilities`, exit
 *       0, a state file holding the enrollment id, and the candidate token
 *       nowhere in stdout, stderr or that file; a bare `{"id":78}` answer is
 *       read as `enrollment_id` 78.
 *   (c) [M3] a 500, a closed connection, a 409, a non-`collaborate` intent and
 *       three shapes of bad stdin, each answered as M3 says.
 *   (d) [M4] a `release` after a `ready` exchange revokes the enrollment id
 *       the state file held and reports `released`; an unknown `request_id`
 *       reports `released` with no request made; a failing revoke reports
 *       `unavailable`; all exit 0.
 *
 * Nothing here supplies the module under test — that is the implementer's to
 * write. The action this exam proves is the one the Machine names: a real
 * child process, spawned with the real flags, fed real stdin, POSTing to a
 * real (fake) hub over a real socket.
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HELPER = fileURLToPath(new URL('../../factory/kata-credential.mjs', import.meta.url))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-credential-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
let dirSeq = 0
const freshDir = () => {
  const d = path.join(tmp, 'd' + (dirSeq += 1))
  fs.mkdirSync(d, { recursive: true })
  return d
}

// ══ the fake hub ════════════════════════════════════════════════════════════
// A real `node:http` server on `127.0.0.1` port 0, inside this process, as the
// Context requires. Every request it receives is recorded — method, url,
// lower-cased headers (node's own behaviour) and the parsed JSON body — and
// answered per-route from the handlers the caller supplies.
function startHub ({
  enable = () => ({ status: 200, body: {} }),
  enroll = () => ({ status: 200, body: { enrollment: { id: 77 } } }),
  revoke = () => ({ status: 200, body: {} }),
} = {}) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = null
      if (raw) { try { body = JSON.parse(raw) } catch { body = raw } }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      let resp
      if (req.method === 'POST' && /^\/api\/v1\/projects\/[^/]+\/federation\/enable$/.test(req.url)) {
        resp = enable()
      } else if (req.method === 'POST' && req.url === '/api/v1/federation/enrollments') {
        resp = enroll()
      } else if (req.method === 'POST' &&
                 /^\/api\/v1\/federation\/enrollments\/[^/]+\/revoke$/.test(req.url)) {
        resp = revoke()
      } else {
        resp = { status: 404, body: { error: 'fake hub: no such route ' + req.method + ' ' + req.url } }
      }
      const text = JSON.stringify(resp.body === undefined ? {} : resp.body)
      res.writeHead(resp.status, { 'content-type': 'application/json' })
      res.end(text)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port,
        requests,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

// ══ spawning the helper ═════════════════════════════════════════════════════
// The real CLI, the real flags, real stdin — `env: simEnv()` per the sim
// rig's rule, never `process.env`.
function runHelper ({ kataJson, adminUrl, stateDir, stdin }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      HELPER, '--kata-json', kataJson, '--admin-url', adminUrl, '--state-dir', stateDir,
    ], { env: simEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

// ══ fixtures ════════════════════════════════════════════════════════════════
const PROJECT_ID = 12
const PROJECT_UID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const HUB_URL = 'https://kata-sync.int.exe.xyz'

function writeKataJson (over = {}) {
  const dir = freshDir()
  const doc = {
    url: HUB_URL,
    project: { id: PROJECT_ID, uid: PROJECT_UID, name: 'p' },
    run: { uid: 'RUN0', revision: 1 },
    tasks: {},
    ...over,
  }
  const file = path.join(dir, 'kata.json')
  fs.writeFileSync(file, JSON.stringify(doc))
  return file
}

/** An `authorize` request shaped exactly as the Context describes it. */
function authorizeReq (over = {}) {
  return {
    version: 1,
    operation: 'authorize',
    request_id: crypto.randomUUID(),
    hub_url: HUB_URL,
    project: 'p',
    spoke_instance_uid: 'spoke-' + crypto.randomUUID(),
    local_project_uid: 'local-' + crypto.randomUUID(),
    intent: 'collaborate',
    candidate_token: crypto.randomBytes(32).toString('base64url'),
    ...over,
  }
}

/** Does `target` occur as a value anywhere in the object tree `node`? Exact
 *  value equality on primitives, not a substring search — a UUID that merely
 *  contains the same digits does not count. */
function containsValue (node, target, seen = new Set()) {
  if (typeof node === 'number' || typeof node === 'string') return String(node) === String(target)
  if (node && typeof node === 'object') {
    if (seen.has(node)) return false
    seen.add(node)
    for (const v of Object.values(node)) if (containsValue(v, target, seen)) return true
  }
  return false
}

const parseJsonOrFail = (text, label) => {
  try { return JSON.parse(text) } catch (e) {
    assert.fail(label + ' parses as one JSON object; got: ' + JSON.stringify(text))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] (b) [M2] — the happy path: enable, then enrollments, then `ready`
// ══════════════════════════════════════════════════════════════════════════
{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()

  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  await hub.close()

  // ── [M1] the two POSTs, in order ─────────────────────────────────────────
  assert.equal(hub.requests.length, 2,
    '(a) [M1] the helper makes exactly two requests to the hub — enable, then enrollments; ' +
    'saw ' + JSON.stringify(hub.requests.map((r) => r.method + ' ' + r.url)))
  const [enableReq, enrollReq] = hub.requests
  assert.equal(enableReq.method, 'POST', '(a) [M1] the enable call is a POST')
  assert.equal(enableReq.url, '/api/v1/projects/' + PROJECT_ID + '/federation/enable',
    '(a) [M1] the enable call POSTs <admin-url>/api/v1/projects/<project.id>/federation/enable, ' +
    'project.id read from the kata.json file (' + PROJECT_ID + '); got ' + enableReq.url)
  assert.equal(enrollReq.method, 'POST', '(a) [M1] the enrollments call is a POST')
  assert.equal(enrollReq.url, '/api/v1/federation/enrollments',
    '(a) [M1] then POSTs <admin-url>/api/v1/federation/enrollments; got ' + enrollReq.url)

  // ── [M1] the enrollments body ────────────────────────────────────────────
  const body = enrollReq.body
  assert.ok(body && typeof body === 'object', '(a) [M1] the enrollments body is a JSON object')
  assert.equal(body.project_id, PROJECT_ID,
    "(a) [M1] the body's project_id is the kata.json file's project.id (" + PROJECT_ID + '); got ' +
    JSON.stringify(body.project_id))
  assert.equal(body.spoke_instance_uid, req.spoke_instance_uid,
    "(a) [M1] the body's spoke_instance_uid is the REQUEST's; got " +
    JSON.stringify(body.spoke_instance_uid))
  assert.equal(body.capabilities, 'claim,pull,push',
    '(a) [M1] the body\'s capabilities is claim,pull,push; got ' + JSON.stringify(body.capabilities))
  assert.equal(body.actor, 'factory',
    '(a) [M1] the body\'s actor is factory; got ' + JSON.stringify(body.actor))
  assert.equal(body.token, req.candidate_token,
    "(a) [M1] the body's token is the REQUEST's candidate_token; got " + JSON.stringify(body.token))

  // ── [M1] no authorization header, on either request ─────────────────────
  for (const [name, r] of [['enable', enableReq], ['enrollments', enrollReq]]) {
    assert.ok(!('authorization' in r.headers),
      '(a) [M1] the ' + name + ' request carries no authorization header — the edge injects ' +
      'the bearer; got headers ' + JSON.stringify(Object.keys(r.headers)))
  }

  // ── [M2] the answer on a 2xx enrollment ──────────────────────────────────
  assert.equal(out.code, 0,
    '(b) [M2] exit 0 on a 2xx enrollment answer; stderr: ' + out.stderr)
  const parsed = parseJsonOrFail(out.stdout, '(b) [M2] stdout')
  assert.deepEqual(Object.keys(parsed).sort(), [
    'actor', 'capabilities', 'enrollment_id', 'hub_url', 'operation', 'project_id',
    'project_uid', 'request_id', 'status', 'version',
  ].sort(),
    '(b) [M2] stdout is one JSON object with keys exactly the ten named; got ' +
    JSON.stringify(Object.keys(parsed)))
  assert.equal(parsed.status, 'ready', '(b) [M2] status is ready; got ' + JSON.stringify(parsed.status))
  assert.equal(parsed.version, 1, '(b) [M2] version is echoed')
  assert.equal(parsed.operation, 'authorize', '(b) [M2] operation is echoed')
  assert.equal(parsed.request_id, req.request_id, '(b) [M2] request_id is echoed')
  assert.equal(parsed.hub_url, req.hub_url,
    "(b) [M2] hub_url echoes the request's; got " + JSON.stringify(parsed.hub_url))
  assert.equal(parsed.project_id, PROJECT_ID,
    '(b) [M2] project_id is ' + PROJECT_ID + '; got ' + JSON.stringify(parsed.project_id))
  assert.equal(parsed.enrollment_id, 77,
    '(b) [M2] enrollment_id is read from the enrollment answer\'s enrollment.id (77); got ' +
    JSON.stringify(parsed.enrollment_id))
  assert.equal(parsed.project_uid, PROJECT_UID,
    "(b) [M2] project_uid is the kata.json file's project.uid; got " + JSON.stringify(parsed.project_uid))
  assert.equal(parsed.capabilities, 'claim,pull,push',
    '(b) [M2] capabilities is claim,pull,push; got ' + JSON.stringify(parsed.capabilities))

  // ── [M2] the state file ──────────────────────────────────────────────────
  const stateFile = path.join(stateDir, req.request_id + '.json')
  assert.ok(fs.existsSync(stateFile),
    '(b) [M2] it writes <state-dir>/<request_id>.json (' + stateFile + ')')
  const stateRaw = fs.readFileSync(stateFile, 'utf8')
  const stateJson = parseJsonOrFail(stateRaw, '(b) [M2] the state file')
  assert.ok(containsValue(stateJson, 77),
    '(b) [M2] the state file holds the enrollment id (77); got ' + stateRaw)

  // ── [M2] the candidate token is copied nowhere ───────────────────────────
  assert.ok(!out.stdout.includes(req.candidate_token),
    '(b) [M2] the candidate token appears nowhere on stdout')
  assert.ok(!out.stderr.includes(req.candidate_token),
    '(b) [M2] the candidate token appears nowhere on stderr; stderr: ' + out.stderr)
  assert.ok(!stateRaw.includes(req.candidate_token),
    '(b) [M2] the candidate token appears nowhere in the state file')
}

// ── (b) [M2] a bare top-level `id` is read too ──────────────────────────────
{
  const hub = await startHub({ enroll: () => ({ status: 200, body: { id: 78 } }) })
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()
  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  await hub.close()
  assert.equal(out.code, 0, '(b) [M2] exit 0; stderr: ' + out.stderr)
  const parsed = parseJsonOrFail(out.stdout, '(b) [M2] stdout')
  assert.equal(parsed.enrollment_id, 78,
    '(b) [M2] the enrollment id is read off the answer\'s top-level `id` when there is no ' +
    '`enrollment` wrapper; got ' + JSON.stringify(parsed.enrollment_id))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] — a non-2xx answer, a connection failure, a 409, a denied intent,
// and three shapes of invalid stdin
// ══════════════════════════════════════════════════════════════════════════
{
  const hub = await startHub({ enroll: () => ({ status: 500, body: { error: 'boom' } }) })
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()
  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  await hub.close()
  const parsed = parseJsonOrFail(out.stdout, '(c) [M3] stdout')
  assert.equal(parsed.status, 'unavailable',
    '(c) [M3] a non-2xx enrollment answer (500) prints status unavailable; got ' +
    JSON.stringify(parsed.status))
  assert.equal(out.code, 0, '(c) [M3] exit 0 on a non-2xx answer')
}

{
  const hub = await startHub()
  const adminUrl = hub.url
  await hub.close() // now a connection failure: nothing is listening any more
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()
  const out = await runHelper({ kataJson, adminUrl, stateDir, stdin: JSON.stringify(req) })
  const parsed = parseJsonOrFail(out.stdout, '(c) [M3] stdout')
  assert.equal(parsed.status, 'unavailable',
    '(c) [M3] a connection failure prints status unavailable; got ' + JSON.stringify(parsed.status))
  assert.equal(out.code, 0, '(c) [M3] exit 0 on a connection failure')
}

{
  const hub = await startHub({ enroll: () => ({ status: 409, body: { error: 'conflict' } }) })
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()
  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  await hub.close()
  const parsed = parseJsonOrFail(out.stdout, '(c) [M3] stdout')
  assert.equal(parsed.status, 'conflict',
    '(c) [M3] a 409 answer prints status conflict; got ' + JSON.stringify(parsed.status))
  assert.equal(out.code, 0, '(c) [M3] exit 0 on a 409')
}

{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq({ intent: 'read_only' })
  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  await hub.close()
  assert.equal(hub.requests.length, 0,
    "(c) [M3] when the request's intent is not collaborate, the fake saw NO request at all — " +
    'a denial is decided before the hub is ever reached; saw ' +
    JSON.stringify(hub.requests.map((r) => r.method + ' ' + r.url)))
  const parsed = parseJsonOrFail(out.stdout, '(c) [M3] stdout')
  assert.equal(parsed.status, 'denied',
    "(c) [M3] intent read_only prints status denied; got " + JSON.stringify(parsed.status))
  assert.equal(out.code, 0, '(c) [M3] exit 0 on a denial')
}

{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const out = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: 'not json' })
  await hub.close()
  assert.equal(out.stdout, '',
    '(c) [M3] stdin that is not one JSON object prints nothing on stdout; got ' +
    JSON.stringify(out.stdout))
  assert.equal(out.code, 2, '(c) [M3] and exits 2; got ' + out.code)
}

{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const out = await runHelper({
    kataJson, adminUrl: hub.url, stateDir,
    stdin: JSON.stringify({ version: 2, operation: 'authorize' }),
  })
  await hub.close()
  assert.equal(out.stdout, '',
    '(c) [M3] a document with version 2 (not 1) prints nothing on stdout; got ' +
    JSON.stringify(out.stdout))
  assert.equal(out.code, 2, '(c) [M3] and exits 2; got ' + out.code)
}

{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const out = await runHelper({
    kataJson, adminUrl: hub.url, stateDir,
    stdin: JSON.stringify({ version: 1, operation: 'frobnicate', request_id: crypto.randomUUID() }),
  })
  await hub.close()
  assert.equal(out.stdout, '',
    '(c) [M3] an unknown operation prints nothing on stdout; got ' + JSON.stringify(out.stdout))
  assert.equal(out.code, 2, '(c) [M3] and exits 2; got ' + out.code)
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] — release: the enrollment is revoked, and the run's own access is
// taken away
// ══════════════════════════════════════════════════════════════════════════
{
  const hub = await startHub()
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()

  const authOut = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  assert.equal(authOut.code, 0,
    '(d) [M4] sim precondition: the authorize exchange the release builds on succeeds; stderr: ' +
    authOut.stderr)
  const authParsed = parseJsonOrFail(authOut.stdout, '(d) [M4] sim precondition: authorize stdout')
  assert.equal(authParsed.status, 'ready',
    '(d) [M4] sim precondition: the exchange left a ready state for this request_id')

  // ── a release for that request_id revokes enrollment 77 ──────────────────
  const before = hub.requests.length
  const relOut = await runHelper({
    kataJson, adminUrl: hub.url, stateDir,
    stdin: JSON.stringify({ version: 1, operation: 'release', request_id: req.request_id }),
  })
  const newRequests = hub.requests.slice(before)
  assert.equal(newRequests.length, 1,
    '(d) [M4] the release makes exactly one request to the hub; saw ' +
    JSON.stringify(newRequests.map((r) => r.method + ' ' + r.url)))
  assert.equal(newRequests[0].method, 'POST', '(d) [M4] the revoke call is a POST')
  assert.equal(newRequests[0].url, '/api/v1/federation/enrollments/77/revoke',
    "(d) [M4] it reads the request_id's state file and POSTs " +
    '<admin-url>/api/v1/federation/enrollments/<enrollment_id>/revoke, enrollment_id 77 (the id ' +
    'the authorize exchange left in the state file); got ' + newRequests[0].url)
  const relParsed = parseJsonOrFail(relOut.stdout, '(d) [M4] release stdout')
  assert.equal(relParsed.status, 'released',
    '(d) [M4] status released on a 2xx revoke answer; got ' + JSON.stringify(relParsed.status))
  assert.equal(relOut.code, 0, '(d) [M4] exit 0 on release')

  // ── a release for an unknown request_id: released, no request made ───────
  const before2 = hub.requests.length
  const unknownOut = await runHelper({
    kataJson, adminUrl: hub.url, stateDir,
    stdin: JSON.stringify({ version: 1, operation: 'release', request_id: crypto.randomUUID() }),
  })
  assert.equal(hub.requests.length, before2,
    '(d) [M4] a release for a request_id whose state file is absent makes no request to the hub')
  const unknownParsed = parseJsonOrFail(unknownOut.stdout, '(d) [M4] unknown-release stdout')
  assert.equal(unknownParsed.status, 'released',
    '(d) [M4] and still prints status released when the state file is absent; got ' +
    JSON.stringify(unknownParsed.status))
  assert.equal(unknownOut.code, 0, '(d) [M4] exit 0')

  await hub.close()
}

// ── (d) [M4] a failing revoke answers unavailable ───────────────────────────
{
  const hub = await startHub({ revoke: () => ({ status: 500, body: { error: 'boom' } }) })
  const stateDir = freshDir()
  const kataJson = writeKataJson()
  const req = authorizeReq()

  const authOut = await runHelper({ kataJson, adminUrl: hub.url, stateDir, stdin: JSON.stringify(req) })
  assert.equal(authOut.code, 0,
    '(d) [M4] sim precondition: the authorize exchange the release builds on succeeds; stderr: ' +
    authOut.stderr)

  const relOut = await runHelper({
    kataJson, adminUrl: hub.url, stateDir,
    stdin: JSON.stringify({ version: 1, operation: 'release', request_id: req.request_id }),
  })
  await hub.close()
  const relParsed = parseJsonOrFail(relOut.stdout, '(d) [M4] release stdout')
  assert.equal(relParsed.status, 'unavailable',
    '(d) [M4] a non-2xx revoke answer prints status unavailable; got ' +
    JSON.stringify(relParsed.status))
  assert.equal(relOut.code, 0, '(d) [M4] exit 0 even on a failed revoke')
}

console.log('ALL TESTS PASSED')
