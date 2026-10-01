// Every story step's receipt: what the step changed in the store, kept for
// green and red steps alike. Pure: one small row per checker result that
// carries a `diff`, in clause order, the diff cut to its first 50 entries.
const MAX_DIFF = 50

export function stepReceipts (results) {
  return [...(results || [])]
    .filter((r) => r && typeof r.clause === 'string' && Array.isArray(r.diff))
    .map((r) => ({
      clause: r.clause,
      exit: r.exit,
      stage: r.stage,
      diff: r.diff.slice(0, MAX_DIFF),
      truncated: r.diff.length > MAX_DIFF
    }))
    .sort((a, b) => (a.clause < b.clause ? -1 : a.clause > b.clause ? 1 : 0))
}
