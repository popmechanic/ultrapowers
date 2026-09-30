// One Jev read whose answer lands as a row (the peer-rewrite read, #1401); a missing
// answer is recorded as null. `claimOf` gives Jev a task's claim.
import { answerOf } from '../jev-client.mjs'

// The task body's text from its `**Claim:**` line up to, not including, its `**Authorized-by:**` line.
export function claimOf (body) {
  const b = String(body ?? '')
  const s = b.search(/^\*\*Claim:\*\*/m)
  if (s < 0) return ''
  const rest = b.slice(s)
  const e = rest.search(/^\*\*Authorized-by:\*\*/m)
  return (e < 0 ? rest : rest.slice(0, e)).trim().slice(0, 2000)
}

export async function readTrial ({ ask, key, question, state, row, emit }) {
  let answers = null
  try { answers = await ask({ state, questions: { [key]: question } }) } catch { answers = null }
  emit({ ...row, ...answerOf(answers, key) })
}
