// fleet/race-rubric.mjs — the comparator the judge applies to a finished race.
//
// The rubric is an ordered sieve rather than a weighted score: each stage drops
// entries, and the first stage that leaves exactly one entry both picks the
// winner and names itself. That name is reported alongside the winner because
// "won on fewest fix rounds" and "won only on its name" are different findings
// about the same race — a decisive stage is not a claim about rubric quality.
//
// Pure by construction: no filesystem, no manifest reading. The judge verb
// gathers the entries; this module only compares them.

// The four stages, in order. This is the single place the strings are typed:
// the manifest's `dials.rubric` carries the same array, and the judge asserts
// the two deep-equal at judge time.
export const STAGES = Object.freeze([
  'gate-green',
  'fix-rounds',
  'tokens',
  'runid-lexicographic',
])

// An unknown count must never win a comparison it never entered, so anything
// that is not a finite number sorts as the worst possible value.
export function worstIfNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Infinity
}

// Keep only the entries tied for the lowest value of `key`. When every entry is
// unknown they all survive and the decision falls through to the next stage.
function narrowByLeast(candidates, key) {
  let best = Infinity
  for (const entry of candidates) best = Math.min(best, worstIfNull(entry[key]))
  return candidates.filter((entry) => worstIfNull(entry[key]) === best)
}

export function selectWinner(entries) {
  const list = Array.isArray(entries) ? entries : []
  // `gate-green` is a hard gate: a run that did not finish green is not a
  // candidate at all, so an empty green set is a no-winner race decided here.
  let candidates = list.filter((entry) => entry && entry.gateGreen === true)
  if (candidates.length === 0) return { winner: null, decidingStage: STAGES[0] }
  if (candidates.length === 1) return { winner: candidates[0].runId, decidingStage: STAGES[0] }

  for (const [stage, key] of [
    [STAGES[1], 'fixRounds'],
    [STAGES[2], 'tokens'],
  ]) {
    candidates = narrowByLeast(candidates, key)
    if (candidates.length === 1) return { winner: candidates[0].runId, decidingStage: stage }
  }

  // Everything measurable tied; the name breaks it, so the race stays
  // reproducible instead of resolving on arrival order.
  const winner = candidates.reduce((least, entry) =>
    String(entry.runId) < String(least.runId) ? entry : least,
  )
  return { winner: winner.runId, decidingStage: STAGES[3] }
}

// Which token figure the tokens stage compared. The ledger is authoritative but
// only when every run has one — comparing one run's ledger against another's
// self-reported count would decide the race on the basis, not on the spend.
export function tokenBasis(entries) {
  const list = Array.isArray(entries) ? entries : []
  const everyLedger = list.every(
    (entry) => entry && typeof entry.ledger === 'number' && Number.isFinite(entry.ledger),
  )
  return everyLedger ? { basis: 'ledger', fallback: false } : { basis: 'reported', fallback: true }
}
