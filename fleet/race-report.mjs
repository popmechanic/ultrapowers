// The race printout: one line per attempt, readable without opening the
// manifest (#511, spec §New machinery / judge). The judge verb builds the
// scorecard and names the deciding stage; this module only formats it, so the
// stage is stated outright and a k=1 race cannot be read as a contest.
//
// Pure — no I/O, no `gh`. The FAILED printout lists the PRs because adopting
// or closing them is the operator's call, never the judge's.
//
// A scorecard entry is the manifest literal:
//   {runId, status, gateGreen, fixRounds, tokens, tokenBasis, tokenFallback,
//    elapsedMs, pullRequest: {number, url, branch}|null,
//    verdict: 'winner'|'lost'|'no-record'}

// Absent numbers print as the word `null` rather than blank or 0: a run with
// no fix-round record is not a run with zero fix rounds.
const num = (n) => (typeof n === 'number' ? String(n) : 'null')

// The basis rides in parens next to the count, so a ledger-fallback token
// figure is never read as a measured one.
const basis = (entry) =>
  `(${entry.tokenBasis || 'none'}${entry.tokenFallback ? ', ledger-fallback' : ''})`

export const scorecardLine = (entry) => {
  const pr = entry.pullRequest
  return [
    `  ${entry.runId}`,
    `status=${entry.status}`,
    `fix-rounds=${num(entry.fixRounds)}`,
    `tokens=${num(entry.tokens)}`,
    basis(entry),
    pr ? `pr=#${pr.number} ${pr.branch}` : 'pr=none',
    `verdict=${entry.verdict}`,
  ].join(' ')
}

export const prLine = (entry) => {
  const pr = entry.pullRequest
  return pr
    ? `  close #${pr.number} ${pr.branch} (${entry.runId})`
    : `  ${entry.runId} pr=none (nothing to close)`
}

// runId order, not insertion or score order: the scorecard reads the same way
// on every printout, and the winner is stated on line one regardless.
const entries = (scorecard) =>
  Object.keys(scorecard || {})
    .sort()
    .map((runId) => ({ runId, ...scorecard[runId] }))

export const verdictLines = ({ raceId, winner, decidingStage, scorecard, verdictPath }) => {
  const rows = entries(scorecard)
  const lines = [
    winner
      ? `race ${raceId}: winner ${winner} — decided by ${decidingStage}`
      : `race ${raceId}: FAILED — no attempt reached gate-green`,
    ...rows.map(scorecardLine),
  ]
  if (!winner) lines.push(...rows.map(prLine))
  lines.push(`verdict: ${verdictPath}`)
  return lines
}
