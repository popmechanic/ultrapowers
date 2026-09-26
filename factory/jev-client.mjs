// factory/jev-client.mjs — the Jev client: one POST, no key, `null` on anything
// that is not an answer.
//
// Jev is an exe.dev `http-proxy` integration named `typesafe` on the fleet
// policy `tag:fleet`, the same shape as `claude-max` and `kata`. From a fleet
// VM the endpoint is `https://typesafe.int.exe.xyz/v1/systemone`, HTTPS only.
// The request carries NO `Authorization` header of its own: the edge injects
// the bearer, which is the whole reason a sandbox holding no TypeSafe
// credential at all can still be answered — and the reason no key is on disk,
// in `argv` or in any environment the boot sets.
//
// The shape is `httpTransport`'s (`fleet/kata-client.mjs`): `fetchImpl`
// injected with `globalThis.fetch` as the default, `res.text()` and then a
// parse — so a sim's fake reply needs only `status` and `text()`, and no sim
// opens a socket.
//
// `ask` never throws and never retries. A 401, a 422 (a malformed question), a
// 429, a 529, a timeout, a dead socket, a body that is not JSON: each is one
// log line and a `null`, and the caller's row is simply absent. Jev answers no
// fact, so nothing downstream is entitled to an answer.

/** The one path. */
export const JEV_PATH = '/v1/systemone'

/** The model alias; the reply names the concrete version it used. */
export const JEV_MODEL = 'jev-latest'

/** One call's whole budget of wall clock. */
export const JEV_TIMEOUT_MS = 10000

/** The ceiling on a call's `state`, measured on that state's own JSON and
 *  checked BEFORE any request: ~32k tokens of context is the budget #1096
 *  names, and a state over it is a caller's bug, not the edge's. A state that
 *  exceeds it costs one log line and no call at all. */
export const JEV_STATE_MAX_BYTES = 120000

/** A JSON document, or `null` when the answer carried none — an error body is
 *  frequently not JSON at all, and a parse that threw would turn the edge's
 *  `422` into this process's exception. */
const parseJson = (text) => {
  const s = String(text == null ? '' : text)
  if (!s.trim()) return null
  try { return JSON.parse(s) } catch { return null }
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * The client: `{ ask }` over one origin.
 *
 * `ask({ state, questions })` resolves the reply's `answers` object, or `null`.
 * `log` is called exactly once, with a string beginning `jev:`, on each lane
 * that resolves `null` — and not at all on the lane that answers.
 */
export const makeJevClient = ({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = JEV_TIMEOUT_MS,
  log = () => {},
} = {}) => {
  const origin = String(baseUrl == null ? '' : baseUrl).replace(/\/+$/, '')
  // One line, one `null`: the single exit every failure lane takes, so no lane
  // can log twice and none can log nothing.
  const refuse = (detail) => {
    try { log('jev: ' + detail) } catch { /* evidence, not control flow */ }
    return null
  }
  return {
    async ask ({ state, questions } = {}) {
      // The budget is on the state alone, and it is read before the socket:
      // an over-budget call is one the edge never sees.
      let body
      try {
        const stateBytes = JSON.stringify(state).length
        if (stateBytes > JEV_STATE_MAX_BYTES) {
          return refuse('state ' + stateBytes + ' bytes over the ' +
            JEV_STATE_MAX_BYTES + '-byte budget; no call made')
        }
        body = JSON.stringify({ state, model: JEV_MODEL, questions })
      } catch (e) {
        return refuse('state not serializable: ' + String((e && e.message) || e).slice(0, 200))
      }
      let status, text
      try {
        const res = await fetchImpl(origin + JEV_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          // Whatever the error name a rejection carries — `AbortError` from
          // this signal included — it is the network lane below.
          signal: AbortSignal.timeout(timeoutMs),
        })
        status = res && res.status
        text = await res.text()
      } catch (e) {
        return refuse('call failed: ' + String((e && e.message) || e).slice(0, 200))
      }
      if (!(typeof status === 'number' && status >= 200 && status <= 299)) {
        return refuse('status ' + String(status))
      }
      const json = parseJson(text)
      if (!isObject(json) || !isObject(json.answers)) {
        return refuse('unreadable reply')
      }
      return json.answers
    },
  }
}
