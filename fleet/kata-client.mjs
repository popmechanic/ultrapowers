// fleet/kata-client.mjs — the one kata client, and the two ways a driver reaches
// the hub (#913 §The prototype).
//
// Kata holds a run's STATE: one project per target, one issue per task, each task's
// fact sheet in that issue's metadata, and every step the driver takes recorded
// as a comment, a claim, a metadata patch or a close. It never holds the plan —
// the plan is compiled from `.ultrapowers/plan.md` and nothing that reads the
// plan consults kata.
//
// TWO TRANSPORTS, ONE CLIENT. The methods below know the API and nothing about
// how a request travels; the transport knows how a request travels and nothing
// about the API. That split is what lets the laptop and the sandbox share this
// file while sharing no credential path at all:
//
//   httpTransport  the SANDBOX's. Plain `fetch` at the run's `kata.json` url,
//                  and NO `Authorization` header of any kind — the exe.dev edge
//                  injects the bearer, so the sandbox holds no kata token and
//                  no worker environment can leak one.
//   sshTransport   the LAPTOP's — the launcher's and the janitor's. One
//                  `ssh <hub> curl …` per request, the bearer sourced on the hub
//                  from `/etc/kata/kata.env` by the hub's own shell. Shelley's
//                  review deleted the laptop-side token: no secret is ever an
//                  argv here, so the remote string carries the literal
//                  `$KATA_AUTH_TOKEN` and never its value.
//
// The module imports nothing (`node:` or otherwise) and reads no `process.env`:
// everything it needs — the url, the ssh host, the exec seam, the fetch — is
// injected, which is also what lets a sim drive it against a loopback server.

/** The bearer's name on the hub, quoted for the HUB's shell and never expanded
 *  here. It is the whole reason the remote is one string: the expansion happens
 *  where the secret lives. */
const HUB_TOKEN_VAR = '$KATA_AUTH_TOKEN'

/** Where kata listens on the hub itself. The ssh transport is already inside
 *  the hub's trust boundary, so it talks to the loopback listener directly
 *  rather than back out through the edge. */
const HUB_ORIGIN = 'http://localhost:8000'

/** Everything under one prefix, so a path below is the API path and nothing
 *  else has to be spelled twice. */
const API = '/api/v1'

/**
 * A request that answered non-2xx. It carries the four facts a reader needs to
 * tell a wrong path from a wrong body from a stale revision: `method`, `path`,
 * `status` and the answer's first 500 characters. The message repeats the
 * status, because the callers that branch on this error (the engine's 412 rule,
 * the launcher's refusals) put the message in front of a human.
 */
export class KataError extends Error {
  constructor ({ method, path, status, body } = {}) {
    const head = String(body == null ? '' : body).slice(0, 500)
    super('kata: ' + String(method) + ' ' + String(path) + ' answered ' + String(status) +
      (head ? ': ' + head : ''))
    this.name = 'KataError'
    this.method = method
    this.path = path
    this.status = status
    this.body = head
  }
}

/** A JSON document, or null when the answer carried none — an error body is
 *  frequently not JSON at all, and a transport that threw on that would hide
 *  the status the caller actually needs. */
const parseJson = (text) => {
  const s = String(text == null ? '' : text)
  if (!s.trim()) return null
  try { return JSON.parse(s) } catch { return null }
}

/**
 * The sandbox's transport: `fetch`, and no `Authorization` header at all.
 *
 * `fetchImpl` is injected so a sim can drive the whole client against a
 * loopback `http.createServer` that records what it was sent; in production it
 * is the platform's own `fetch`.
 */
export const httpTransport = ({ url, fetchImpl = globalThis.fetch }) => {
  const origin = String(url == null ? '' : url).replace(/\/+$/, '')
  return {
    async request ({ method, path, headers, body }) {
      const hasBody = body !== undefined
      const init = {
        method,
        headers: {
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...(headers || {}),
        },
      }
      if (hasBody) init.body = JSON.stringify(body)
      const res = await fetchImpl(origin + path, init)
      const text = await res.text()
      return { status: res.status, json: parseJson(text), body: text }
    },
  }
}

/** A header value inside the double quotes the remote wraps it in. The hub's
 *  shell reads that string, so a quote, a backslash, a `$` or a backtick in a
 *  value has to arrive escaped — an `If-Match` value IS `"rev-4"`, quotes
 *  included, and is the reason this exists. */
const shQuoteInner = (value) => String(value == null ? '' : value).replace(/(["\\$`])/g, '\\$1')

/**
 * The laptop's transport: one `ssh` per request, `curl` on the hub.
 *
 * The remote is ONE argv element, built here and read by the hub's shell:
 * `set -a` + sourcing `/etc/kata/kata.env` puts the bearer in the environment
 * of the `exec curl` that follows, so the token is expanded on the hub and the
 * laptop's process table never holds it. `-w '\n%{http_code}'` is how the
 * status comes back through a seam that answers with bytes: the answer's last
 * line IS the status and everything above it is the JSON.
 *
 * `exec` is the caller's own seam (`(cmd, argv, options) -> {code, stdout,
 * stderr}`); the request body rides `options.input` — stdin, never an argv.
 */
export const sshTransport = ({ sshHost, exec }) => ({
  async request ({ method, path, headers, body }) {
    const hasBody = body !== undefined
    const parts = [
      'set -a; . /etc/kata/kata.env; exec curl -sS -X ' + String(method) +
        ' -H "Authorization: Bearer ' + HUB_TOKEN_VAR + '"',
    ]
    if (hasBody) parts.push('-H "content-type: application/json"')
    for (const [name, value] of Object.entries(headers || {})) {
      parts.push('-H "' + name + ': ' + shQuoteInner(value) + '"')
    }
    if (hasBody) parts.push('--data-binary @-')
    parts.push("-w '\\n%{http_code}'")
    parts.push(HUB_ORIGIN + path)
    const remote = parts.join(' ')
    const res = await exec('ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', String(sshHost), remote],
      { input: hasBody ? JSON.stringify(body) : '' })
    const out = String((res && res.stdout) || '')
    const cut = out.lastIndexOf('\n')
    const tail = (cut === -1 ? out : out.slice(cut + 1)).trim()
    const text = cut === -1 ? '' : out.slice(0, cut)
    const status = /^\d+$/.test(tail) ? Number(tail) : 0
    // A status that never arrived is an ssh or curl failure, not an API answer:
    // report it as a non-2xx carrying everything the seam printed, so the
    // KataError the client raises names what actually went wrong.
    if (status === 0) {
      return { status: 0, json: null, body: out + String((res && res.stderr) || '') }
    }
    return { status, json: parseJson(text), body: text }
  },
})

/** The issue fields a caller may read back, in the order the API documents
 *  them. Only the keys the answer actually carried are copied: a partial issue
 *  answers a partial projection rather than a shape padded with `undefined`.
 *  `links` is the issue's own edges — `{type, from, to}` rows as the hub
 *  answers them, each side carrying its `uid` and `short_id` — copied through
 *  untouched (#979): the driver reads them to learn that a worker filed
 *  `--blocked-by` against a sibling, and a projection that reshaped them would
 *  be a second opinion about what the hub said. An answer carrying none leaves
 *  the key absent, exactly as every other key here. */
const ISSUE_KEYS = ['uid', 'revision', 'metadata', 'status', 'owner', 'project_id', 'links']
/** A mutation's answer adds the issue's short id — `getIssue` is the projection
 *  the contract names and stays exactly the seven above. */
const MUTATION_KEYS = ['uid', 'revision', 'short_id', 'metadata', 'status', 'owner', 'project_id']

const project = (source, keys) => {
  const src = (source && typeof source === 'object') ? source : {}
  const out = {}
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]
  }
  return out
}

/**
 * The run's own issue, found by run and plan — open first, so a colliding
 * launch's abandoned issue (closed `wontfix` when its number was taken from
 * under it, #1036) is never read as the live run's (derived).
 *
 * Over the elements of `issues` whose `metadata.run` reads as the number
 * `run` and whose `metadata.task` is `undefined` (a task issue's own `run` is
 * never this), the first is answered by this preference, lowest tier first,
 * ties kept in listing order:
 *
 *   1. when `plan` is a string, an element whose `metadata.plan === plan`
 *      over every other element — a mismatched plan and an absent one tie at
 *      the next tier, so an element that names no plan is never excluded by
 *      this preference, only left where listing order and the tiers below
 *      put it;
 *   2. `status === 'open'` over `'closed'`;
 *   3. a closed element whose `closed_reason !== 'wontfix'` over one whose
 *      `closed_reason === 'wontfix'`.
 *
 * `null` when no element qualifies.
 */
export const runIssueOf = (issues, run, plan) => {
  const list = Array.isArray(issues) ? issues : []
  const runNum = Number(run)
  const planStr = typeof plan === 'string' ? plan : null
  let best = null
  let bestScore = null
  for (const issue of list) {
    if (!issue || typeof issue !== 'object') continue
    const meta = issue.metadata
    if (!meta || typeof meta !== 'object') continue
    if (meta.task !== undefined) continue
    if (Number(meta.run) !== runNum) continue
    const planScore = (planStr !== null && meta.plan === planStr) ? 0 : 1
    const open = issue.status === 'open'
    const statusScore = open ? 0 : 1
    const closedReasonScore = (!open && issue.closed_reason === 'wontfix') ? 1 : 0
    const score = [planScore, statusScore, closedReasonScore]
    if (best === null || scoreLess(score, bestScore)) {
      best = issue
      bestScore = score
    }
  }
  return best
}

/** Lexicographic "strictly better" over the fixed-length tier arrays
 *  `runIssueOf` scores candidates with — used, rather than `<=`, so a tie
 *  keeps the earliest candidate in listing order. */
const scoreLess = (a, b) => {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

/**
 * The client. Every method issues EXACTLY ONE request — nothing here polls,
 * retries or reads an issue back to confirm a write, because the driver's own
 * ordering is what the record is for: a step is on the hub before the driver
 * takes its next, and a step that did not land throws.
 *
 * `actor` rides the body of every mutation (the daemon runs in static-token
 * mode, where a mutation's actor is the body's) and never a GET.
 */
export const makeKataClient = ({ transport, actor }) => {
  const send = async ({ method, path, body, headers }) => {
    const res = await transport.request({ method, path, headers: headers || {}, body })
    const status = res && res.status
    if (!(status >= 200 && status < 300)) {
      const raw = (res && res.body !== undefined)
        ? res.body
        : JSON.stringify((res && res.json) ?? null)
      throw new KataError({ method, path, status, body: raw })
    }
    return (res && res.json) || null
  }
  // Every mutation of an issue answers the issue kata left behind, so the
  // caller always holds the revision its NEXT `If-Match` needs without a read.
  const mutation = async (spec) => project((await send(spec) || {}).issue, MUTATION_KEYS)
  const issuesPath = (projectId) => API + '/projects/' + projectId + '/issues'
  const issuePath = (projectId, uid) => issuesPath(projectId) + '/' + uid

  return {
    ping: () => send({ method: 'GET', path: API + '/ping' }),

    createProject: async (name) => {
      const json = await send({ method: 'POST', path: API + '/projects', body: { name, actor } })
      return project((json || {}).project, ['id', 'uid', 'name', 'revision'])
    },

    // `Idempotency-Key` is what makes a relaunch of one plan file the SAME
    // issues rather than a second set: kata fingerprints the key with the
    // body, so the same key and byte-identical fields answer the issue that is
    // already there, and the same key with different fields is a 409
    // `idempotency_mismatch`. Metadata and initial links are in that
    // fingerprint — the create body a caller wants replayable carries only
    // what it can promise is stable.
    //
    // `forceNew` is the other 409's bypass: kata scores a create's title
    // against the project's OPEN issues and refuses `duplicate_candidates`
    // above a threshold it does not document (0.93 measured against a run
    // issue of the same plan H1, #1008). It rides the body as `force_new: true`
    // only when asked, so a create that is replayed under its key — a task's —
    // sends the body kata fingerprinted the first time and never a new field.
    createIssue: (projectId, { title, body, metadata, links, idempotencyKey, forceNew } = {}) =>
      mutation({ method: 'POST', path: issuesPath(projectId),
                 body: { title, body, actor, metadata, links,
                         ...(forceNew === undefined ? {} : { force_new: forceNew }) },
                 headers: idempotencyKey === undefined
                   ? {} : { 'Idempotency-Key': String(idempotencyKey) } }),

    // `replace` is the only way to move a `parent`: a second parent link is a
    // 409 `parent_already_set` whose hint is this flag, and `replace: true`
    // swaps it. It rides the body only when a caller asked for it, so a
    // `blocks` link — which is idempotent on its own — sends what it always did.
    link: (projectId, fromUid, { type, to_ref: toRef, replace } = {}) =>
      mutation({ method: 'POST', path: issuePath(projectId, fromUid) + '/links',
                 body: { type, to_ref: toRef, actor, ...(replace === undefined ? {} : { replace }) } }),

    getIssue: async (uid) => {
      const json = await send({ method: 'GET', path: API + '/issues/' + uid })
      return project((json || {}).issue, ISSUE_KEYS)
    },

    claim: (projectId, uid) =>
      mutation({ method: 'POST', path: issuePath(projectId, uid) + '/actions/claim',
                 body: { actor, if_unowned: true } }),

    // `If-Match` is kata's own ETag spelling — the quotes are part of the value,
    // and a stale revision is a 412 the caller is expected to treat as a fatal
    // disagreement about what the record says.
    patchMetadata: (projectId, uid, patch, revision) =>
      mutation({ method: 'POST', path: issuePath(projectId, uid) + '/metadata',
                 body: { actor, patch }, headers: { 'If-Match': '"rev-' + revision + '"' } }),

    comment: (projectId, uid, body) =>
      mutation({ method: 'POST', path: issuePath(projectId, uid) + '/comments',
                 body: { actor, body } }),

    // One label onto an issue's own set. Kata merges rather than appends, so the
    // same label twice is the same label once — which is why this sends exactly
    // what `comment` sends and no `Idempotency-Key`: there is no second write to
    // make idempotent. `ref` is the issue uid, as everywhere else here.
    addLabel: (projectId, uid, label) =>
      mutation({ method: 'POST', path: issuePath(projectId, uid) + '/labels',
                 body: { actor, label } }),

    // `retry_protocol` is not optional beside an `Idempotency-Key`: kata refuses
    // the pair's absence, and the key is what makes a re-driven close the same
    // close rather than a second one.
    close: (projectId, uid, { reason, message, evidence, idempotencyKey } = {}) =>
      mutation({ method: 'POST', path: issuePath(projectId, uid) + '/actions/close',
                 body: { actor, reason, message, evidence, retry_protocol: 'close-v1' },
                 headers: idempotencyKey === undefined
                   ? {} : { 'Idempotency-Key': String(idempotencyKey) } }),

    // The projects are addressed by integer `id` and nothing else — a name in
    // the path is a 400 — so a reader that knows only a run's project NAME
    // lists them and matches on `name` itself.
    listProjects: () =>
      send({ method: 'GET', path: API + '/projects?limit=1000' }),

    listIssues: (projectId) =>
      send({ method: 'GET', path: issuesPath(projectId) + '?limit=1000' }),

    events: (projectId, afterId) =>
      send({ method: 'GET',
             path: API + '/projects/' + projectId + '/events?after_id=' + afterId + '&limit=1000' }),
  }
}
