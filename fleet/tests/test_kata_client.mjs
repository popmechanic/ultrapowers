// fleet/tests/exams/run_109/test_kata_client.mjs — the exam for Task 5's M1:
// one client, two transports, twelve methods.
//
// This file is the Proof's `Test: fleet/tests/test_kata_client.mjs`, written at
// the landing its EXAM PATHS line names. It imports the module under test as
// `../../../kata-client.mjs` — three levels up from this directory is `fleet/`.
//
// The clause under test, restated (M1): `fleet/kata-client.mjs` exports
// `makeKataClient({ transport, actor })`, `httpTransport({ url, fetchImpl =
// globalThis.fetch })`, `sshTransport({ sshHost, exec })` and `KataError`; a
// transport's `request({ method, path, headers, body })` answers `{ status,
// json }`; each client method issues exactly one request, with the method, path
// and body M1 spells; every request carries `content-type: application/json` on
// a body and, through `httpTransport`, no `Authorization` header at all —
// the edge injects the bearer, the client never holds one; through
// `sshTransport` each request is one `ssh` running `curl` on the hub with the
// bearer sourced there (`$KATA_AUTH_TOKEN`, the hub shell's expansion), the
// answer's last line the status and the rest the JSON; every mutation's answer
// carries `revision` from the response's `issue.revision`; a non-2xx answer
// throws a `KataError` with `method`, `path`, `status` and `body` (the first
// 500 characters).
//
// Proof leg (a) [M1] is what every block below asserts, in the leg's own order:
// the twelve methods through `httpTransport` against a loopback server; the
// `link` path; the metadata patch's `If-Match`; the close's `Idempotency-Key`
// and `retry_protocol`; `events`'s query; no `Authorization` anywhere; the
// `sshTransport` remote string, its `options.input` and its answer; the
// `If-Match` spelling through ssh; a `\n412` answer; `actor` on every mutation
// body and on no GET body; `createIssue`'s answer revision; the 412's `status`
// and `path`; and the 500's 500-character `body`.
//
// Nothing here reaches the network: one `http.createServer` on 127.0.0.1 at an
// ephemeral port, closed at the end, and an injected `exec` for the ssh side.
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

// A dynamic import, so a module that does not exist yet (or does not parse)
// reads as a named assertion failure naming the leg, not as a link-time crash
// that hides every other assertion in the file.
const MODULE_URL = new URL('../kata-client.mjs', import.meta.url)
let mod
try {
  mod = await import(MODULE_URL.href)
} catch (e) {
  assert.fail('(a) [M1] fleet/kata-client.mjs must exist and import cleanly — ' +
    'the run\'s only kata client. Import of ' + MODULE_URL.pathname + ' failed: ' +
    String((e && e.message) || e))
}
const { makeKataClient, httpTransport, sshTransport, KataError } = mod

// ── (a) [M1] the four exports ───────────────────────────────────────────────
assert.equal(typeof makeKataClient, 'function',
  '(a) [M1] fleet/kata-client.mjs exports makeKataClient({ transport, actor }) ' +
  '(exports seen: ' + Object.keys(mod).join(', ') + ')')
assert.equal(typeof httpTransport, 'function',
  '(a) [M1] …and httpTransport({ url, fetchImpl = globalThis.fetch })')
assert.equal(typeof sshTransport, 'function',
  '(a) [M1] …and sshTransport({ sshHost, exec })')
assert.equal(typeof KataError, 'function',
  '(a) [M1] …and KataError, the one error every non-2xx answer throws')

const ACTOR = 'engine:run-7'

// ── the loopback server: the one HTTP server this sim opens ─────────────────
let requests = []
let answer = { status: 200, json: {} }
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    })
    const payload = typeof answer.json === 'string' ? answer.json : JSON.stringify(answer.json)
    res.writeHead(answer.status, { 'content-type': 'application/json' })
    res.end(payload)
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const URL_BASE = 'http://127.0.0.1:' + server.address().port

// `fetchImpl` is injected (M1 spells it as an option with `globalThis.fetch` as
// its default); the counter proves the injected one is the one that ran.
let fetchCalls = 0
const fetchImpl = (...args) => { fetchCalls += 1; return globalThis.fetch(...args) }
const client = makeKataClient({ transport: httpTransport({ url: URL_BASE, fetchImpl }), actor: ACTOR })

/**
 * Drive one client method against a canned answer and hand back the single
 * request the server saw. A method that issued none, or more than one, fails
 * here — "each client method issues exactly one request" is the clause.
 */
async function oneRequest (what, json, call, status = 200) {
  requests = []
  answer = { status, json }
  const before = fetchCalls
  const out = await call()
  assert.equal(requests.length, 1,
    '(a) [M1] ' + what + ' issues exactly one request; the server saw ' + requests.length +
    ': ' + JSON.stringify(requests.map((r) => r.method + ' ' + r.url)))
  assert.equal(fetchCalls, before + 1,
    '(a) [M1] ' + what + ' goes through the INJECTED fetchImpl exactly once (httpTransport\'s ' +
    '`fetchImpl` option), not through a fetch of its own')
  return { req: requests[0], out }
}

/** The parsed JSON body of a recorded request. */
const bodyOf = (req) => {
  assert.notEqual(req.body, '',
    '(a) [M1] the request carries a JSON body: ' + req.method + ' ' + req.url)
  try { return JSON.parse(req.body) } catch (e) {
    return assert.fail('(a) [M1] the request body is JSON (' + String((e && e.message) || e) +
      '): ' + req.body)
  }
}

/** Every request the whole file drove, for the header sweep at the end. */
const allHttp = []
const record = (req) => { allHttp.push(req); return req }

// ── (a) [M1] ping — GET /api/v1/ping, no body ───────────────────────────────
{
  const { req } = await oneRequest('ping()', { ok: true, service: 'kata', version: '0.17.2' },
    () => client.ping())
  record(req)
  assert.equal(req.method, 'GET', '(a) [M1] ping() is a GET')
  assert.equal(req.url, '/api/v1/ping', '(a) [M1] ping() is GET /api/v1/ping')
  assert.equal(req.body, '',
    '(a) [M1] `actor` rides every mutation body and NO GET body — ping() sends none')
}

// ── (a) [M1] createProject — POST /api/v1/projects {name, actor} ────────────
{
  const { req } = await oneRequest('createProject(name)',
    { created: true, project: { id: 7, uid: 'P0', name: 'acme-run-7', revision: 1 } },
    () => client.createProject('acme-run-7'))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] createProject is a POST')
  assert.equal(req.url, '/api/v1/projects', '(a) [M1] createProject posts /api/v1/projects')
  assert.deepEqual(bodyOf(req), { name: 'acme-run-7', actor: ACTOR },
    '(a) [M1] createProject(name)\'s body is exactly {name, actor}')
}

// ── (a) [M1] purgeProject — POST /api/v1/projects/<id>/actions/purge ────────
{
  const { req } = await oneRequest('purgeProject(id, reason)', { purged: true },
    () => client.purgeProject(7, 'run number taken'))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] purgeProject is a POST')
  assert.equal(req.url, '/api/v1/projects/7/actions/purge',
    '(a) [M1] purgeProject(7, …) posts /api/v1/projects/7/actions/purge')
  assert.deepEqual(bodyOf(req), { actor: ACTOR, reason: 'run number taken' },
    '(a) [M1] purgeProject(id, reason)\'s body is exactly {actor, reason}')
}

// ── (a) [M1] createIssue — POST /api/v1/projects/<id>/issues ────────────────
{
  const links = [{ type: 'parent', to_ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }]
  const metadata = { task: 'T1', wave: 1, factsheet: { files: ['one.txt'] } }
  const { req, out } = await oneRequest('createIssue(projectId, {…})',
    { issue: { uid: 'U', revision: 3, short_id: 'k-12', metadata }, event: { id: 1 }, changed: true },
    () => client.createIssue(7, { title: 'task 1: one', body: '', metadata, links }))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] createIssue is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues',
    '(a) [M1] createIssue(7, …) posts /api/v1/projects/7/issues')
  assert.deepEqual(bodyOf(req),
    { title: 'task 1: one', body: '', actor: ACTOR, metadata, links },
    '(a) [M1] createIssue\'s body is exactly {title, body, actor, metadata, links}')
  assert.equal(out.revision, 3,
    '(a) [M1] createIssue\'s answer `revision` is the response\'s issue.revision (3), ' +
    'got ' + JSON.stringify(out && out.revision))
}

// ── (a) [M1] link — POST /api/v1/projects/<id>/issues/<fromUid>/links ───────
{
  const { req, out } = await oneRequest('link(projectId, fromUid, {…})',
    { issue: { uid: 'FROMUID', revision: 4 }, event: {}, changed: true },
    () => client.link(7, 'FROMUID', { type: 'blocks', to_ref: 'TOUID' }))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] link is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues/FROMUID/links',
    '(a) [M1] link(7, FROMUID, …) posts on the FROM issue: ' +
    '/api/v1/projects/7/issues/FROMUID/links')
  assert.deepEqual(bodyOf(req), { type: 'blocks', to_ref: 'TOUID', actor: ACTOR },
    '(a) [M1] link\'s body is exactly {type, to_ref, actor}')
  assert.equal(out.revision, 4,
    '(a) [M1] link\'s answer carries `revision` from the response\'s issue.revision')
}

// ── (a) [M1] getIssue — GET /api/v1/issues/<uid>, the six-key projection ────
{
  const metadata = { factsheet: { files: ['one.txt'], landing: {} } }
  const { req, out } = await oneRequest('getIssue(uid)',
    { issue: { uid: 'U', revision: 5, metadata, status: 'open', owner: 'engine:run-7',
               project_id: 7, title: 'not part of the answer', body: 'nor this' },
      comments: [], links: [], labels: [] },
    () => client.getIssue('U'))
  record(req)
  assert.equal(req.method, 'GET', '(a) [M1] getIssue is a GET')
  assert.equal(req.url, '/api/v1/issues/U', '(a) [M1] getIssue(U) is GET /api/v1/issues/U')
  assert.equal(req.body, '', '(a) [M1] a GET carries no body — `actor` rides mutations only')
  assert.deepEqual(out,
    { uid: 'U', revision: 5, metadata, status: 'open', owner: 'engine:run-7', project_id: 7 },
    '(a) [M1] getIssue answers {uid, revision, metadata, status, owner, project_id} from the ' +
    'response\'s `issue` — that projection and nothing else; got ' + JSON.stringify(out))
}

// ── (a) [M1] claim — POST …/issues/<uid>/actions/claim {actor, if_unowned} ──
{
  const { req, out } = await oneRequest('claim(projectId, uid)',
    { issue: { uid: 'U', revision: 6, owner: ACTOR }, changed: true, previous_owner: null },
    () => client.claim(7, 'U'))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] claim is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues/U/actions/claim',
    '(a) [M1] claim(7, U) posts /api/v1/projects/7/issues/U/actions/claim')
  assert.deepEqual(bodyOf(req), { actor: ACTOR, if_unowned: true },
    '(a) [M1] claim\'s body is exactly {actor, if_unowned: true}')
  assert.equal(out.revision, 6,
    '(a) [M1] claim\'s answer carries `revision` from the response\'s issue.revision')
}

// ── (a) [M1] patchMetadata — …/issues/<uid>/metadata, If-Match "rev-4" ──────
{
  const patch = { touched_files: ['one.txt', 'tests/exams/custom/test_x.py'] }
  const { req, out } = await oneRequest('patchMetadata(projectId, uid, patch, revision)',
    { issue: { uid: 'U', revision: 7 }, changed: true, event: {} },
    () => client.patchMetadata(7, 'U', patch, 4))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] patchMetadata is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues/U/metadata',
    '(a) [M1] patchMetadata posts /api/v1/projects/7/issues/U/metadata')
  assert.deepEqual(bodyOf(req), { actor: ACTOR, patch },
    '(a) [M1] patchMetadata\'s body is exactly {actor, patch}')
  assert.equal(req.headers['if-match'], '"rev-4"',
    '(a) [M1] revision 4 is sent as the header If-Match: "rev-4" — kata\'s own ETag form, ' +
    'double quotes included; got ' + JSON.stringify(req.headers['if-match']))
  assert.equal(out.revision, 7,
    '(a) [M1] patchMetadata\'s answer carries `revision` from the response\'s issue.revision')
}

// ── (a) [M1] comment — POST …/issues/<uid>/comments {actor, body} ──────────
{
  const line = '{"kind":"driver:exam-handoff","task":"T1","paths":["tests/test_x.py"]}'
  const { req, out } = await oneRequest('comment(projectId, uid, body)',
    { issue: { uid: 'U', revision: 8 }, comment: { id: 3 }, event: {}, changed: true },
    () => client.comment(7, 'U', line))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] comment is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues/U/comments',
    '(a) [M1] comment(7, U, …) posts /api/v1/projects/7/issues/U/comments')
  assert.deepEqual(bodyOf(req), { actor: ACTOR, body: line },
    '(a) [M1] comment\'s body is exactly {actor, body} — the body verbatim')
  assert.equal(out.revision, 8,
    '(a) [M1] comment\'s answer carries `revision` from the response\'s issue.revision')
}

// ── (a) [M1] close — …/actions/close, retry_protocol + Idempotency-Key ─────
{
  const evidence = [{ type: 'commit', sha: 'abc123' }, { type: 'test', command: 'bash check.sh' }]
  const { req, out } = await oneRequest('close(projectId, uid, {…})',
    { issue: { uid: 'U', revision: 9, status: 'closed' }, changed: true, event: {} },
    () => client.close(7, 'U', { reason: 'done', message: 'adopted in wave 1 (clean)',
                                evidence, idempotencyKey: 'run-7:T1:close' }))
  record(req)
  assert.equal(req.method, 'POST', '(a) [M1] close is a POST')
  assert.equal(req.url, '/api/v1/projects/7/issues/U/actions/close',
    '(a) [M1] close(7, U, …) posts /api/v1/projects/7/issues/U/actions/close')
  assert.deepEqual(bodyOf(req),
    { actor: ACTOR, reason: 'done', message: 'adopted in wave 1 (clean)', evidence,
      retry_protocol: 'close-v1' },
    '(a) [M1] close\'s body is exactly {actor, reason, message, evidence, ' +
    'retry_protocol: "close-v1"} — a request carrying Idempotency-Key must carry the protocol')
  assert.equal(req.headers['idempotency-key'], 'run-7:T1:close',
    '(a) [M1] the idempotencyKey rides the header Idempotency-Key, verbatim; got ' +
    JSON.stringify(req.headers['idempotency-key']))
  assert.equal(out.revision, 9,
    '(a) [M1] close\'s answer carries `revision` from the response\'s issue.revision')
}

// ── (a) [M1] listIssues — GET …/issues?limit=1000 ──────────────────────────
{
  const { req } = await oneRequest('listIssues(projectId)', { issues: [] },
    () => client.listIssues(7))
  record(req)
  assert.equal(req.method, 'GET', '(a) [M1] listIssues is a GET')
  assert.equal(req.url, '/api/v1/projects/7/issues?limit=1000',
    '(a) [M1] listIssues(7) is GET /api/v1/projects/7/issues?limit=1000')
  assert.equal(req.body, '', '(a) [M1] a GET carries no body')
}

// ── (a) [M1] events — GET …/events?after_id=5&limit=1000 ───────────────────
{
  const { req } = await oneRequest('events(projectId, afterId)',
    { events: [], next_after_id: 5, reset_required: false },
    () => client.events(7, 5))
  record(req)
  assert.equal(req.method, 'GET', '(a) [M1] events is a GET')
  assert.equal(req.url, '/api/v1/projects/7/events?after_id=5&limit=1000',
    '(a) [M1] events(7, 5) is GET /api/v1/projects/7/events?after_id=5&limit=1000')
  assert.equal(req.body, '', '(a) [M1] a GET carries no body')
}

// ── (a) [M1] the headers every httpTransport request carries, and the one it
// never carries ────────────────────────────────────────────────────────────
assert.equal(allHttp.length, 12,
  '(a) [M1] the twelve methods drove twelve requests through httpTransport; saw ' + allHttp.length)
for (const req of allHttp) {
  const where = req.method + ' ' + req.url
  assert.equal(req.headers.authorization, undefined,
    '(a) [M1] no request through httpTransport carries an Authorization header — on the ' +
    'sandbox the EDGE injects the bearer and the client holds none: ' + where)
  assert.equal(req.headers['x-exedev-authorization'], undefined,
    '(a) [M1] and none carries X-Exedev-Authorization either: ' + where)
  if (req.body !== '') {
    assert.equal(String(req.headers['content-type'] || '').split(';')[0].trim(), 'application/json',
      '(a) [M1] every request with a body carries content-type: application/json: ' + where +
      ' (got ' + JSON.stringify(req.headers['content-type']) + ')')
    assert.equal(JSON.parse(req.body).actor, ACTOR,
      '(a) [M1] `actor` rides every mutation body: ' + where)
  }
}

// ── (a) [M1] `fetchImpl` defaults to globalThis.fetch ──────────────────────
{
  requests = []
  answer = { status: 200, json: { ok: true, service: 'kata', version: '0.17.2' } }
  const bare = makeKataClient({ transport: httpTransport({ url: URL_BASE }), actor: ACTOR })
  await bare.ping()
  assert.equal(requests.length, 1,
    '(a) [M1] httpTransport({ url }) with no fetchImpl falls back to globalThis.fetch — ' +
    'the sandbox builds it that way; the server saw ' + requests.length + ' request(s)')
  assert.equal(requests[0].url, '/api/v1/ping', '(a) [M1] …and it is the same GET /api/v1/ping')
}

// ── (a) [M1] a 412 through httpTransport: status and path ──────────────────
{
  requests = []
  answer = { status: 412, json: { status: 412, error: { message: 'revision mismatch' } } }
  let thrown = null
  try {
    await client.patchMetadata(7, 'U', { touched_files: ['one.txt'] }, 4)
  } catch (e) { thrown = e }
  assert.ok(thrown, '(a) [M1] a 412 answer makes patchMetadata throw')
  assert.ok(thrown instanceof KataError,
    '(a) [M1] …and what it throws is a KataError (got ' +
    String(thrown && thrown.constructor && thrown.constructor.name) + ')')
  assert.equal(thrown.status, 412, '(a) [M1] the KataError\'s `status` is 412')
  assert.ok(String(thrown.path).includes('U'),
    '(a) [M1] and its `path` names the issue — expected /api/v1/projects/7/issues/U/metadata, ' +
    'got ' + JSON.stringify(thrown.path))
  assert.equal(typeof thrown.method, 'string',
    '(a) [M1] a KataError carries `method`, `path`, `status` and `body`; `method` is missing ' +
    'or not a string: ' + JSON.stringify(thrown.method))
  assert.equal(typeof thrown.body, 'string',
    '(a) [M1] …and `body` is the answer\'s body text: ' + JSON.stringify(thrown.body))
}

server.close()

// ══ (a) [M1] the ssh transport: the laptop's one ssh per request ═══════════
// The seam the launcher owns: `exec(cmd, argv, { input })` answering
// `{ code, stdout, stderr }`, the answer's last line the status and the rest
// the JSON. No token is ever an argv: the remote quotes `$KATA_AUTH_TOKEN` for
// the hub's own shell, which sources /etc/kata/kata.env.
const REMOTE_HEAD = 'set -a; . /etc/kata/kata.env; exec curl -sS -X '
let execCalls = []
let sshStdout = '{"issue":{"uid":"U","revision":3}}\n200'
const exec = async (cmd, argv, options = {}) => {
  execCalls.push({ cmd, argv: [...argv], options })
  return { code: 0, stdout: sshStdout, stderr: '' }
}
const ssh = makeKataClient({ transport: sshTransport({ sshHost: 'hub.test', exec }), actor: 'launch' })

// ── (a) [M1] createIssue through ssh ───────────────────────────────────────
{
  execCalls = []
  const metadata = { task: '1', wave: 1 }
  const out = await ssh.createIssue(7, { title: 'task 1: one', body: '', metadata, links: [] })
  assert.equal(execCalls.length, 1,
    '(a) [M1] createIssue through sshTransport makes exactly one exec call; saw ' + execCalls.length)
  const call = execCalls[0]
  assert.equal(call.cmd, 'ssh', '(a) [M1] the command is `ssh`')
  assert.deepEqual(call.argv.slice(0, 5), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'hub.test'],
    '(a) [M1] the argv is -o BatchMode=yes -o ConnectTimeout=15 <sshHost> <remote>; got ' +
    JSON.stringify(call.argv))
  assert.equal(call.argv.length, 6,
    '(a) [M1] …and the remote string is the sixth and last argument: ' + JSON.stringify(call.argv))
  const remote = call.argv[5]
  assert.ok(remote.startsWith(REMOTE_HEAD + 'POST -H "Authorization: Bearer $KATA_AUTH_TOKEN"'),
    '(a) [M1] the remote begins `' + REMOTE_HEAD + 'POST -H "Authorization: Bearer ' +
    '$KATA_AUTH_TOKEN"` — the bearer is the HUB shell\'s expansion, never the laptop\'s; got: ' +
    remote)
  assert.ok(remote.includes('-H "content-type: application/json"'),
    '(a) [M1] …carries -H "content-type: application/json": ' + remote)
  assert.ok(remote.includes('--data-binary @-'),
    '(a) [M1] …carries --data-binary @- when there is a body: ' + remote)
  assert.ok(remote.includes("-w '\\n%{http_code}'"),
    '(a) [M1] …carries -w \'\\n%{http_code}\', which is what makes the last line the status: ' +
    remote)
  assert.ok(remote.endsWith('http://localhost:8000/api/v1/projects/7/issues'),
    '(a) [M1] …and ends http://localhost:8000/api/v1/projects/7/issues — curl runs ON the hub; ' +
    'got: ' + remote)
  assert.equal(typeof call.options.input, 'string',
    '(a) [M1] the body is fed on stdin as options.input, never as an argv: ' +
    JSON.stringify(call.options))
  assert.deepEqual(JSON.parse(call.options.input),
    { title: 'task 1: one', body: '', actor: 'launch', metadata, links: [] },
    '(a) [M1] options.input is the JSON body {title, body, actor, metadata, links}')
  assert.equal(out.uid, 'U',
    '(a) [M1] the answer is read from the response JSON: uid U; got ' + JSON.stringify(out))
  assert.equal(out.revision, 3,
    '(a) [M1] …and revision 3, from the response\'s issue.revision')
}

// ── (a) [M1] a GET through ssh sends no body ──────────────────────────────
{
  execCalls = []
  sshStdout = '{"ok":true,"service":"kata","version":"0.17.2"}\n200'
  await ssh.ping()
  assert.equal(execCalls.length, 1, '(a) [M1] ping() through ssh is one exec call')
  const remote = execCalls[0].argv[5]
  assert.ok(remote.startsWith(REMOTE_HEAD + 'GET -H "Authorization: Bearer $KATA_AUTH_TOKEN"'),
    '(a) [M1] a GET\'s remote begins the same way with -X GET: ' + remote)
  assert.ok(!remote.includes('--data-binary'),
    '(a) [M1] …and carries --data-binary only when there IS a body: ' + remote)
  assert.ok(remote.endsWith('http://localhost:8000/api/v1/ping'),
    '(a) [M1] …ending http://localhost:8000/api/v1/ping: ' + remote)
}

// ── (a) [M1] patchMetadata through ssh: the If-Match header, verbatim ──────
{
  execCalls = []
  sshStdout = '{"issue":{"uid":"U","revision":5}}\n200'
  await ssh.patchMetadata(7, 'U', { touched_files: ['one.txt'] }, 4)
  assert.equal(execCalls.length, 1, '(a) [M1] patchMetadata through ssh is one exec call')
  const remote = execCalls[0].argv[5]
  assert.ok(remote.includes('-H "If-Match: \\"rev-4\\""'),
    '(a) [M1] revision 4 rides the remote as -H "If-Match: \\"rev-4\\"" — one -H per extra ' +
    'header, the ETag\'s own double quotes escaped for the hub\'s shell; got: ' + remote)
  assert.ok(remote.endsWith('http://localhost:8000/api/v1/projects/7/issues/U/metadata'),
    '(a) [M1] …and the URL is the metadata path on the hub: ' + remote)
}

// ── (a) [M1] an answer ending \n412 is a KataError with status 412 ────────
{
  execCalls = []
  sshStdout = '{"status":412,"error":{"message":"revision mismatch"}}\n412'
  let thrown = null
  try { await ssh.patchMetadata(7, 'U', { touched_files: ['one.txt'] }, 4) } catch (e) { thrown = e }
  assert.ok(thrown instanceof KataError,
    '(a) [M1] an ssh answer whose last line is 412 throws a KataError (got ' +
    String(thrown && thrown.constructor && thrown.constructor.name) + ')')
  assert.equal(thrown.status, 412,
    '(a) [M1] the answer\'s LAST LINE is read as the status: 412; got ' +
    JSON.stringify(thrown.status))
  assert.ok(String(thrown.path).includes('U'),
    '(a) [M1] and its `path` names the issue: ' + JSON.stringify(thrown.path))
}

// ── (a) [M1] a 500 with a 700-character body truncates to 500 ─────────────
{
  const BIG = '{"error":"' + 'A'.repeat(688) + '"}'
  assert.equal(BIG.length, 700, 'fixture: the canned error body is 700 characters')
  execCalls = []
  sshStdout = BIG + '\n500'
  let thrown = null
  try { await ssh.createProject('acme-run-7') } catch (e) { thrown = e }
  assert.ok(thrown instanceof KataError,
    '(a) [M1] a 500 answer throws a KataError (got ' +
    String(thrown && thrown.constructor && thrown.constructor.name) + ')')
  assert.equal(thrown.status, 500, '(a) [M1] its `status` is 500')
  assert.equal(typeof thrown.body, 'string', '(a) [M1] its `body` is the answer\'s body text')
  assert.equal(thrown.body.length, 500,
    '(a) [M1] …the FIRST 500 CHARACTERS of it — a 700-character body is carried as 500; got ' +
    thrown.body.length)
  assert.equal(thrown.body, BIG.slice(0, 500),
    '(a) [M1] …and they are the first 500, not the last')
}

console.log('ALL TESTS PASSED')
