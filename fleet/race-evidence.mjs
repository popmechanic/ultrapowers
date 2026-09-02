// fleet/race-evidence.mjs — the per-run readers behind a race verdict (#511).
//
// A race judges k attempts at the same plan. Everything it compares comes from
// two places, and they do not fail the same way:
//
//   durable — `gate-read-<runId>.json` and `gate-read-<runId>.detail.json` in
//     the evidence dir, written by `driveOne` for every terminal drive (green,
//     parked and failed all write them). Terminal means the gate-read exists.
//   fragile — the run's own TinyBase store at `<dbDir>/fleet.db`. The per-run
//     db-dirs default under /tmp, which is reapable out from under the judge.
//
// So no reader here throws. A missing or corrupt input degrades to `null` —
// which the comparator treats as a loss for that run — rather than aborting the
// verdict for the runs whose durable gate-reads are intact (the run-47 critic's
// minor: an unguarded store read aborts the verdict).
//
// Read-only. Nothing here spawns a process except through the injected `exec`,
// so no test needs the sqlite3 binary.
import fs from 'node:fs'
import path from 'node:path'
import { runEvents } from './status.mjs'

export const gateReadPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.json`)

export const gateDetailPath = (evidenceDir, runId) =>
  path.join(evidenceDir, `gate-read-${runId}.detail.json`)

// Absent and corrupt collapse to the same answer on purpose: either way there
// is no record to judge. `missing` names which file so the report can say so.
const readJsonFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export const readRunRecord = (evidenceDir, runId) => {
  const readFile = gateReadPath(evidenceDir, runId)
  const detailFile = gateDetailPath(evidenceDir, runId)
  const read = readJsonFile(readFile)
  const detail = readJsonFile(detailFile)
  const missing = []
  if (read === null) missing.push(path.basename(readFile))
  if (detail === null) missing.push(path.basename(detailFile))
  return { read, detail, missing }
}

// The single `store` cell is MergeableStore JSON; argv form, never a shell
// string, so the SQL needs no quoting and nothing is interpolated into a shell.
export const sqliteStoreJson = async (dbDir, exec) => {
  const argv = ['sqlite3', path.join(dbDir, 'fleet.db'), 'SELECT store FROM tinybase LIMIT 1']
  let result
  try {
    result = await exec(argv)
  } catch {
    return null
  }
  if (!result || result.code !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

// A fix round is one `fix:<task>:<n>` label. The engine emits a `worker:start`
// AND a `worker:end` row per label — race-48's judge counted both and reported
// double — so count starts only.
export const countFixRounds = (storeJson, runId, events = runEvents) => {
  if (!storeJson) return null
  const rows = events(storeJson, runId)
  return rows.filter((r) => r.kind === 'worker:start' && String(r.label ?? '').startsWith('fix:')).length
}

const finiteOr = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

export const ledgerOf = (read) => finiteOr(read?.spendObservational?.ledger)

export const reportedOf = (read) => finiteOr(read?.spendObservational?.reported)

export const driveStatusOf = (detail) => (typeof detail?.status === 'string' ? detail.status : null)
