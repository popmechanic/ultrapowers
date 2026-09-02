// fleet/race-judge.mjs — the judge verb (#511, spec §New machinery / judge).
//
//   node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]
//
// A race is judged from what is on disk: the manifest written at launch, and
// the durable gate-read pair `driveOne` leaves for every terminal drive. The
// judge reads, compares, appends one `verdict` key to `race-<raceId>.json` and
// prints. That append is its ONLY write — it never invokes `gh`, never merges
// and never closes, so a FAILED race hands the operator the K PRs to close
// rather than closing them.
//
// Two refusals, both before any comparison:
//   * a run with no gate-read has no record to judge, so the whole verdict is
//     refused by name — unless `--force`, which scores the runs that reported
//     and records the rest as `no-record`, an automatic loss.
//   * `dials.rubric` must deep-equal the comparator's `STAGES`. The dials are
//     pre-registered; this assertion is what binds them to the comparator that
//     actually ran, so a verdict can never name a stage order the race did not
//     agree to in advance.
//
// One degradation, never a refusal: the per-run TinyBase store lives under a
// reapable /tmp db-dir, so an unreadable store is `fixRounds: null` (a loss at
// that stage) and the verdict still completes for everyone else.
import { execFile } from 'node:child_process'
import { parseJudgeArgs } from './race.mjs'
import { manifestPath, readRaceManifest, appendVerdict } from './race-manifest.mjs'
import { STAGES, selectWinner, tokenBasis } from './race-rubric.mjs'
import {
  readRunRecord,
  sqliteStoreJson,
  countFixRounds,
  ledgerOf,
  reportedOf,
  driveStatusOf,
} from './race-evidence.mjs'
import { verdictLines } from './race-report.mjs'

// argv form, no shell. Never reached under test: `readStore` is injected, so
// the suite needs no sqlite3 binary.
const defaultExec = (argv) =>
  new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { maxBuffer: 1 << 28 }, (error, stdout) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout }),
    )
  })

const finiteOr = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

// A run reported iff its gate-read is there. The detail may be missing on its
// own — that costs the run its status, not the race its verdict.
const reported = (record) => record.read !== null

const refusal = (absent) => {
  const named = absent
    .map(({ run, record }) => `${run.runId} (${record.missing.join(', ')})`)
    .join('; ')
  return new Error(
    `race judge: no gate-read for ${named} — the race is not finished. ` +
      'Rerun with --force to score the runs that reported and mark the rest no-record.',
  )
}

const noRecordEntry = (runId) => ({
  runId,
  status: null,
  gateGreen: false,
  fixRounds: null,
  tokens: null,
  tokenBasis: null,
  tokenFallback: false,
  elapsedMs: null,
  pullRequest: null,
  verdict: 'no-record',
})

export const judgeRace = async (argv, deps = {}) => {
  const {
    stdout = (line) => process.stdout.write(`${line}\n`),
    parseArgs = parseJudgeArgs,
    readManifest = readRaceManifest,
    writeVerdict = appendVerdict,
    readRecord = readRunRecord,
    exec = defaultExec,
    readStore = (dbDir) => sqliteStoreJson(dbDir, exec),
    countRounds = countFixRounds,
  } = deps

  const { raceId, evidenceDir, force } = parseArgs(argv)
  const manifest = readManifest(evidenceDir, raceId)

  if (JSON.stringify(manifest.dials?.rubric) !== JSON.stringify([...STAGES])) {
    throw new Error(
      `race judge: manifest \`dials.rubric\` ${JSON.stringify(manifest.dials?.rubric)} ` +
        `is not the comparator's rubric ${JSON.stringify([...STAGES])} — refusing to judge ` +
        'race ' + raceId + ' against a rubric it did not pre-register.',
    )
  }

  const records = manifest.runs.map((run) => ({ run, record: readRecord(evidenceDir, run.runId) }))
  const absent = records.filter(({ record }) => !reported(record))
  if (absent.length && !force) throw refusal(absent)

  // The contestants are the runs that reported; the token basis is decided
  // across them alone, since a no-record run has no spend to compare and must
  // not push everyone onto the fallback basis.
  const contestants = []
  for (const { run, record } of records) {
    if (!reported(record)) continue
    const storeJson = await readStore(run.dbDir)
    const status = driveStatusOf(record.detail)
    contestants.push({
      run,
      record,
      status,
      gateGreen: status === 'gate-green',
      fixRounds: countRounds(storeJson, run.runId),
      ledger: ledgerOf(record.read),
      reported: reportedOf(record.read),
      elapsedMs: finiteOr(record.detail?.elapsedMs),
      pullRequest: record.detail?.pullRequest ?? null,
    })
  }
  const { basis, fallback } = tokenBasis(contestants)

  const byRunId = new Map(
    contestants.map((c) => [
      c.run.runId,
      {
        runId: c.run.runId,
        status: c.status,
        gateGreen: c.gateGreen,
        fixRounds: c.fixRounds,
        tokens: basis === 'ledger' ? c.ledger : c.reported,
        tokenBasis: basis,
        tokenFallback: fallback,
        elapsedMs: c.elapsedMs,
        pullRequest: c.pullRequest,
        verdict: 'lost',
      },
    ]),
  )
  // Manifest order, so the scorecard reads in the order the race was launched.
  const entries = manifest.runs.map(({ runId }) => byRunId.get(runId) ?? noRecordEntry(runId))

  const { winner, decidingStage } = selectWinner(entries)
  if (winner !== null) byRunId.get(winner).verdict = 'winner'

  const scorecard = {}
  for (const entry of entries) scorecard[entry.runId] = entry
  const verdict = { winner, decidingStage, scorecard }

  writeVerdict(evidenceDir, raceId, verdict)
  for (const line of verdictLines({
    raceId,
    winner,
    decidingStage,
    scorecard,
    verdictPath: manifestPath(evidenceDir, raceId),
  })) {
    stdout(line)
  }
  return verdict
}
