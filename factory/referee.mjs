/**
 * factory/referee.mjs — the discovery referee's dispatch trigger.
 *
 * Pure and synchronous: no `fs`, no `sh`, no import from the engine. The one
 * export, `refereeTrigger`, decides whether the referee is dispatched off two
 * independent signals — the lowest-covered clause against a policy floor,
 * and the difficulty rung — and says which one fired.
 */

/**
 * The lowest-covered clause of `coverage`, aligned 1:1 with `clauses` (index
 * `i` is clause `M<i+1>`). A non-numeric entry reads as 0; on a tie the
 * lowest `m` wins. `null` when `coverage` is not a non-empty array — the
 * same scan `postLanding` in the engine already runs.
 */
const lowestCovered = (coverage, clauses) => {
  if (!Array.isArray(coverage) || coverage.length === 0) return null
  let low = 0
  for (let i = 1; i < coverage.length; i += 1) {
    if ((Number(coverage[i]) || 0) < (Number(coverage[low]) || 0)) low = i
  }
  const score = coverage[low]
  const text = (Array.isArray(clauses) && clauses[low] !== undefined && clauses[low] !== null)
    ? clauses[low]
    : '(no clause text)'
  return { m: low + 1, text, score }
}

/**
 * `refereeTrigger({ coverage, clauses, rung, policy })` answers
 * `{ dispatch, trigger, clause, fact }`.
 *
 * The coverage trigger fires when there is a lowest-covered clause and its
 * score, read as a number, is below `policy.task.referee.min_coverage.value`
 * — and that value is itself a finite number. With the cell absent, or its
 * value not a number, the coverage trigger never fires. The rung trigger
 * fires exactly when `rung === true`.
 */
export const refereeTrigger = ({ coverage, clauses, rung, policy }) => {
  const clause = lowestCovered(coverage, clauses)

  const minCoverage = policy && policy.task && policy.task.referee && policy.task.referee.min_coverage
    ? policy.task.referee.min_coverage.value
    : undefined
  const hasFiniteFloor = typeof minCoverage === 'number' && Number.isFinite(minCoverage)
  const coverageFires = clause !== null && hasFiniteFloor && Number(clause.score) < minCoverage

  const rungFires = rung === true

  const trigger = coverageFires && rungFires ? 'both'
    : coverageFires ? 'coverage'
    : rungFires ? 'rung'
    : 'none'

  const dispatch = trigger !== 'none'

  const fact = coverageFires
    ? 'LOWEST-COVERED CLAUSE (M' + clause.m + ', ' + String(clause.score) + '): ' + clause.text
    : null

  return { dispatch, trigger, clause, fact }
}
