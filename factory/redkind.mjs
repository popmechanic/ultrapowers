/**
 * factory/redkind.mjs — the one rule that says whether a red was a leg's
 * or the rig's, and the one rule that says whether a rig red at this
 * attempt still buys the examiner one more round.
 *
 * Pure and import-nothing (M4): both facts are computed only from what the
 * engine already captured off an exam run — its exit code and its output —
 * or, for `rigRound`, from the row the engine just wrote plus the policy
 * cell it was handed. No child process, no disk, no network.
 */

const CITED_SPAN_RE = /\[[^\]]*\bM\d+\b[^\]]*\]/

/**
 * redKind({ exit, out }) -> 'leg' | 'rig' | null
 *
 * - exit === 0            -> null (no red at all)
 * - exit === 124          -> 'rig' (timeout-124 death), whatever out carries
 * - exit !== 0, non-124   -> 'leg' when out carries a bracketed [M<n>] span,
 *                            'rig' otherwise
 *
 * A non-string out (undefined, null, ...) is read as the empty string.
 */
export function redKind({ exit, out }) {
  if (exit === 0) return null
  if (exit === 124) return 'rig'

  const text = typeof out === 'string' ? out : ''
  return CITED_SPAN_RE.test(text) ? 'leg' : 'rig'
}

/**
 * rigRound({ attempt, red, enabled }) -> boolean
 *
 * true only when this is the first attempt, the red just captured was a
 * rig red, and the policy cell that allows a rig round is enabled.
 */
export function rigRound({ attempt, red, enabled }) {
  return attempt === 1 && red === 'rig' && enabled === true
}

export default { redKind, rigRound }
