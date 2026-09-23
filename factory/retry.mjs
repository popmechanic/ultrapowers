/**
 * factory/retry.mjs — the one re-dispatch a gateway death is owed.
 *
 * A dispatch whose worker never got past the gateway (`API Error: 5xx`,
 * `529`, `Overloaded`) and produced no assistant turn is sent once more,
 * after `dispatch.infra_backoff_ms` (policy default 60000; experiment,
 * rollback 0 = no retry). Pure — imports nothing, touches no clock or file
 * except through the `sleep` it is handed.
 */

export function isGatewayError (error) {
  if (error === null || error === undefined) return false
  const s = String(error)
  return /API Error: 5\d\d/.test(s) || /\b529\b/.test(s) || /Overloaded/i.test(s)
}

export function isRateLimited (error) {
  if (error === null || error === undefined) return false
  const s = String(error)
  return /\b429\b/.test(s) || /rate_limit_error/i.test(s) || /rate limit/i.test(s) || /weekly limit/i.test(s)
}

export function infraBackoffMs (policy) {
  return Number(policy?.dispatch?.infra_backoff_ms?.value) || 0
}

export function shouldRetry ({ error, turns, policy }) {
  return isGatewayError(error) && (Number(turns) || 0) === 0 && infraBackoffMs(policy) > 0
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function retrying (once, { policy, sleep = defaultSleep } = {}) {
  let halted = null
  return async (opts) => {
    if (halted !== null) {
      return { result: null, denials: [], turns: 0, error: 'rate-limited: ' + halted, halted: true }
    }
    const first = await once(opts)
    if (isRateLimited(first.error)) {
      halted = first.error
      return first
    }
    if (opts.retry_of || !shouldRetry({ error: first.error, turns: first.turns, policy })) {
      return first
    }
    await sleep(infraBackoffMs(policy))
    return once({ ...opts, label: opts.label + ':retry', retry_of: opts.label })
  }
}

export default { isGatewayError, isRateLimited, infraBackoffMs, shouldRetry, retrying }
