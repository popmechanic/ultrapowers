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

export function infraBackoffMs (policy) {
  return Number(policy?.dispatch?.infra_backoff_ms?.value) || 0
}

export function shouldRetry ({ error, turns, policy }) {
  return isGatewayError(error) && (Number(turns) || 0) === 0 && infraBackoffMs(policy) > 0
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function retrying (once, { policy, sleep = defaultSleep } = {}) {
  return async (opts) => {
    const first = await once(opts)
    if (opts.retry_of || !shouldRetry({ error: first.error, turns: first.turns, policy })) {
      return first
    }
    await sleep(infraBackoffMs(policy))
    return once({ ...opts, label: opts.label + ':retry', retry_of: opts.label })
  }
}

export default { isGatewayError, infraBackoffMs, shouldRetry, retrying }
