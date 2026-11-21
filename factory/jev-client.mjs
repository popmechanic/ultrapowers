export const JEV_PATH = '/v1/systemone'

export const JEV_MODEL = 'jev-latest'

export const JEV_TIMEOUT_MS = 10000

export const JEV_STATE_MAX_BYTES = 120000

export const answerOf = (answers, key) => {
  const a = answers && answers[key]
  return {
    answer: a && typeof a.choice === 'string' ? a.choice : null,
    confidence: a && typeof a.confidence === 'number' ? a.confidence : null,
  }
}

const parseJson = (text) => {
  const s = String(text == null ? '' : text)
  if (!s.trim()) return null
  try { return JSON.parse(s) } catch { return null }
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export const makeJevClient = ({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = JEV_TIMEOUT_MS,
  log = () => {},
  headers,
} = {}) => {
  const origin = String(baseUrl == null ? '' : baseUrl).replace(/\/+$/, '')
  const refuse = (detail) => {
    try { log('jev: ' + detail) } catch {}
    return null
  }
  return {
    async ask ({ state, questions } = {}) {
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
          headers: { 'content-type': 'application/json', ...headers },
          body,
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
