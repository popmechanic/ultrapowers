// fleet/race-allocate.mjs — one attempt, one lane. A race runs k attempts of
// the same plan at once, and every resource they touch has to be theirs alone:
// the run id (the #211 grammar — a suffixed id is a new id), the drive port,
// the events db-dir, and the repo they drive. The repo-dir is the load-bearing
// one: driveOne resolves its base as HEAD of its own repoDir, so siblings
// sharing a checkout would race the publish leg's FETCH_HEAD window (#497).
//
// Pure: no filesystem, no git, no clock. The entries this returns are exactly
// the manifest's `runs` array.
import path from 'node:path'

export const SUFFIXES = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))

export const DEFAULT_K = 3
export const MAX_K = SUFFIXES.length

// The lane's name. Suffixing is what makes it a *new* id rather than a second
// claimant on the race id, so no caller may hand a run the bare raceId.
export function runIdFor(raceId, i) {
  return `${raceId}-${SUFFIXES[i]}`
}

export function allocateRuns({ raceId, k, port, dbDir, raceDir }) {
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw new Error(
      `--k must be a whole number from 1 to ${MAX_K} (one suffix per attempt, a..z); got ${JSON.stringify(k)}`,
    )
  }
  return SUFFIXES.slice(0, k).map((suffix, i) => {
    const runId = runIdFor(raceId, i)
    return {
      runId,
      port: port + i,
      dbDir: `${dbDir}-${suffix}`,
      repoDir: path.join(raceDir, runId),
    }
  })
}
