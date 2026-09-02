// The race manifest: one file per race recording the dials and the runs, so a
// race can be read afterwards from disk alone (#511, spec
// docs/superpowers/specs/2026-09-01-511-attempt-racing.md §Measurement).
//
// Schema of `race-<raceId>.json`:
//   raceId, planPath, baseCommit, k, launchedAt,
//   runs: [{ runId, port, dbDir, repoDir }],
//   dials,
//   verdict: { winner, decidingStage, scorecard }   — only after judging
//
// `evidenceDir` is always a parameter, never a constant: the drive's default is
// /home/exedev/fleet-evidence, but tests pass a temp dir.
import fs from 'node:fs'
import path from 'node:path'

function deepFreeze(value) {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

// Pre-registered: written before any result is visible, so the dials cannot be
// chosen to fit what came back. Baselines are the spec's §Measurement figures
// recalibrated on 2026-09-01 to DEDUPLICATED output tokens (the spend ledger
// had been counting every streamed content block as a message), which is why
// they read lower than the spec text.
export const DIALS = deepFreeze({
  baseline: {
    'run-44': { wallMinutes: 79, tokens: 287692, fixRounds: 0 },
    'run-45': { wallMinutes: 62, tokens: 232635, fixRounds: 1, planTracedDefects: 2 },
    'run-47': { wallMinutes: 79, tokens: 239564, fixRounds: 1, planTracedDefects: 1 },
  },
  raceWall: 'manifest launchedAt -> max over runs of the per-run elapsedMs end',
  totalTokens: 'sum of per-run tokens across the K runs (expect about K x a single run)',
  perRun: 'per-run drive status, fix rounds, tokens',
  comparatorDecisiveness:
    "which rubric stage decided — name the stage; never read 'zero ties' as rubric quality",
  winnerDefectSurface:
    "the winner's post-merge defect surface — anything traced back within the next two sittings",
  // The single source of the comparator's stage names: the judge orders its
  // rubric from this array, so the stage a verdict names and the stage the
  // comparator ran can never drift apart.
  rubric: ['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic'],
})

// Schema order is write order: the file's keys come out in this sequence, which
// is what lets appendVerdict rewrite the file leaving every prior key identical.
const FIELDS = [
  ['raceId', 'string'],
  ['planPath', 'string'],
  ['baseCommit', 'string'],
  ['k', 'number'],
  // ISO string or epoch ms — the raceWall dial only needs an ordered instant,
  // and pinning one representation here would bind callers for no gain.
  ['launchedAt', 'string|number'],
  ['runs', 'array'],
  ['dials', 'object'],
]
const RUN_FIELDS = [
  ['runId', 'string'],
  ['port', 'number'],
  ['dbDir', 'string'],
  ['repoDir', 'string'],
]
const VERDICT_FIELDS = [
  // null is a legal winner: a race where no attempt reached gate-green is a
  // FAILED race, and the judge still records the verdict (`race-rubric`'s
  // selectWinner returns `winner: null`, and the printout renders it FAILED).
  ['winner', 'string|null'],
  ['decidingStage', 'string'],
  ['scorecard', 'object'],   // keyed by runId
]

function typeOf(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function checkFields(target, fields, prefix) {
  for (const [name, type] of fields) {
    const label = `${prefix}${name}`
    if (!(name in target) || target[name] === undefined) {
      throw new Error(`race manifest: missing field \`${label}\``)
    }
    const actual = typeOf(target[name])
    if (!type.split('|').includes(actual)) {
      throw new Error(`race manifest: field \`${label}\` must be ${type}, got ${actual}`)
    }
  }
}

/** Throws naming the first missing or mis-typed field; returns the manifest. */
export function assertManifest(manifest) {
  if (typeOf(manifest) !== 'object') {
    throw new Error(`race manifest: must be an object, got ${typeOf(manifest)}`)
  }
  checkFields(manifest, FIELDS, '')
  manifest.runs.forEach((run, i) => {
    if (typeOf(run) !== 'object') {
      throw new Error(`race manifest: field \`runs[${i}]\` must be object, got ${typeOf(run)}`)
    }
    checkFields(run, RUN_FIELDS, `runs[${i}].`)
  })
  // The verdict is absent until the judge appends it; when present it is checked.
  if (manifest.verdict !== undefined) {
    if (typeOf(manifest.verdict) !== 'object') {
      throw new Error(`race manifest: field \`verdict\` must be object, got ${typeOf(manifest.verdict)}`)
    }
    checkFields(manifest.verdict, VERDICT_FIELDS, 'verdict.')
  }
  return manifest
}

export function manifestPath(evidenceDir, raceId) {
  return path.join(evidenceDir, `race-${raceId}.json`)
}

// Known fields first, in schema order, then anything the caller added (a run
// entry gains elapsedMs and tokens as the race reports), then verdict last.
function ordered(source, fields) {
  const out = {}
  for (const [name] of fields) out[name] = source[name]
  for (const key of Object.keys(source)) if (!(key in out)) out[key] = source[key]
  return out
}

function canonical(manifest) {
  const out = ordered(manifest, FIELDS)
  out.runs = manifest.runs.map((run) => ordered(run, RUN_FIELDS))
  out.dials = DIALS
  if (manifest.verdict !== undefined) {
    delete out.verdict
    out.verdict = ordered(manifest.verdict, VERDICT_FIELDS)
  }
  return out
}

/**
 * Writes `race-<raceId>.json` and returns its path. Synchronous: the file is on
 * disk with its full content by the time this returns. The write goes through a
 * temp file and a rename so a concurrent reader never sees a half-written
 * manifest, and so a second call replaces the first atomically.
 */
export function writeRaceManifest(evidenceDir, manifest) {
  assertManifest(manifest)
  // The dials are pre-registered, so this module supplies them. A caller that
  // passes something else is refused rather than silently overwritten — that
  // silence is exactly what pre-registration exists to prevent.
  if (JSON.stringify(manifest.dials) !== JSON.stringify(DIALS)) {
    throw new Error('race manifest: `dials` must be the pre-registered DIALS block')
  }
  const target = manifestPath(evidenceDir, manifest.raceId)
  fs.mkdirSync(evidenceDir, { recursive: true })
  const tmp = `${target}.tmp.${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(canonical(manifest), null, 2)}\n`)
  fs.renameSync(tmp, target)
  return target
}

/** Reads and validates the manifest; throws naming the path if it is not there. */
export function readRaceManifest(evidenceDir, raceId) {
  const target = manifestPath(evidenceDir, raceId)
  let text
  try {
    text = fs.readFileSync(target, 'utf8')
  } catch (err) {
    throw new Error(`race manifest not readable: ${target} (${err.code || err.message})`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`race manifest not parseable: ${target} (${err.message})`)
  }
  return assertManifest(parsed)
}

/**
 * Rewrites the manifest with a `verdict` key, leaving every pre-existing key
 * byte-identical (the file is rebuilt from what was parsed off disk, in the same
 * schema order, with verdict appended last). Returns the rewritten manifest.
 * This is the judge's only write.
 */
export function appendVerdict(evidenceDir, raceId, verdict) {
  const manifest = readRaceManifest(evidenceDir, raceId)
  const judged = { ...manifest, verdict }
  assertManifest(judged)
  writeRaceManifest(evidenceDir, judged)
  return canonical(judged)
}
