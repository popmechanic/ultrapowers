#!/usr/bin/env node
// fleet/shim-main.mjs — the sandbox entrypoint the provisioner starts.
//
// It is the thin outer shell around `runShim`: read the run assignment the
// provisioner dropped at /home/exedev/fleet-run.json, stamp the run row with
// the identity of the code that is about to execute, hand `runShim` an
// `invokeRun` that launches the real engine run, and report the run report's
// token total back onto the store when it is over.
//
// Everything a test needs is exported as a small pure function; `main()` is the
// only part that touches the live sandbox, and it runs only when this file is
// executed directly.
//
// NO credentials live here. Model access rides the sandbox's own exe.dev LLM
// integration (`ANTHROPIC_BASE_URL` + a dummy key set on the golden image), so
// this file neither reads nor sets an API key, and imports no vendor SDK.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim } from './shim.mjs'

export const ASSIGNMENT_PATH = '/home/exedev/fleet-run.json'
export const REPO_DIR = '/home/exedev/repo'

/** The engine's run report, relative to the repo root. */
export const DEFAULT_REPORT_FILE = '.claude/ultrapowers/fleet-run/report.json'

/**
 * The sandbox's own id — the writer namespace its spend rows must live under
 * and the holder its claim carries.
 *
 * It is DERIVED, not delivered: `provisionRun` names the VM `fleet-<runId>` and
 * mints the store token against that same name, but its assignment payload
 * carries only `{runId, token, wsUrl, ttlMs}`. Deriving it here reproduces the
 * provisioner's naming exactly; an assignment that does carry `sandboxId` wins.
 */
export const sandboxIdFor = (runId) => `fleet-${runId}`

/**
 * The id of the sandbox's SECOND store client — the one this module writes the
 * stamp and the reported-token scalar over, alongside `runShim`'s own.
 *
 * It must differ from the shim's store id. A MergeableStore's id is the
 * uniqueness source for the hybrid logical clocks it stamps every write with;
 * two live stores sharing an id mint colliding timestamps, and the merge then
 * silently discards writes. Measured: with both clients created as
 * `sandboxId`, the shim's `running` and `gate-green` writes never reached the
 * orchestrator at all and the run hung at `claimed` until the driver's
 * heartbeat timeout.
 *
 * This is a store-identity suffix only — it is NOT a writer id. The guard
 * derives writers from the rows themselves (spend rows from their `<writerId>:`
 * namespace, claims from their `holder`), neither of which this client writes.
 */
export const auxStoreId = (sandboxId) => `${sandboxId}-aux`

export const readAssignment = (file = ASSIGNMENT_PATH) => JSON.parse(fs.readFileSync(file, 'utf8'))

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// --- run report readers ----------------------------------------------------

const TOKEN_KEYS = ['outputTokens', 'totalTokens', 'tokens']

/**
 * The run report's own token total, or `null` when the report carries no
 * counter — which is the state of the engine's report.json today.
 *
 * `null` and not `0`: a run with no counter has not spent nothing, it has
 * reported nothing, and the §W1d spend read is explicitly observational
 * (`reported: number|null`) precisely so that distinction survives to the gate.
 */
export const readReportTokens = (reportFile) => {
  const report = readJson(reportFile)
  for (const scope of [report, report?.usage, report?.result]) {
    if (!scope || typeof scope !== 'object') continue
    for (const key of TOKEN_KEYS) {
      const value = scope[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

/** Whether the engine's own gate passed. A missing/unreadable report is not green. */
export const readGateGreen = (reportFile) => {
  const report = readJson(reportFile)
  if (!report || typeof report !== 'object') return false
  if (report.gateGreen === true) return true
  return report.gate?.verdict === 'PASS'
}

// --- store writers ---------------------------------------------------------
// All three are `setCell`/`setRow` writes of small scalars only — receipts carry
// pointers into git (sha + path) and never file content.

/**
 * Version-stamp the run row. Written with `setCell` rather than `setRow`
 * because `runShim`'s status writes replace the whole row from their own synced
 * view, and a `setRow` there drops cells it has not yet received. An empty
 * component is skipped rather than blanking a stamp already in place.
 */
export const applyStamp = (store, runId, { pluginVersion, engineSha } = {}) => {
  if (pluginVersion) store.setCell('runs', runId, 'pluginVersion', pluginVersion)
  if (engineSha) store.setCell('runs', runId, 'engineSha', engineSha)
}

export const applyReportedTokens = (store, runId, tokens) => {
  if (typeof tokens === 'number' && Number.isFinite(tokens)) store.setCell('runs', runId, 'reportedTokens', tokens)
}

export const applyReceipt = (store, runId, kind, { sha, path: receiptPath, verdict }) => {
  store.setRow('receipts', `${runId}:${kind}`, { sha, path: receiptPath, verdict })
}

/**
 * The identity of the code about to run: the plugin version from the manifest
 * on disk plus the repo's HEAD. Never throws — a sandbox that cannot read its
 * own identity still runs, and reports an empty stamp the gate reads as absent.
 */
export const readStamp = async ({ repoDir, exec }) => {
  const manifest = readJson(path.join(repoDir, '.claude-plugin', 'plugin.json'))
  const pluginVersion = typeof manifest?.version === 'string' ? manifest.version : ''
  let engineSha = ''
  try {
    const result = await exec(`git -C ${repoDir} rev-parse HEAD`)
    if (result?.code === 0) engineSha = String(result.stdout ?? '').trim()
  } catch {
    engineSha = ''
  }
  return { pluginVersion, engineSha }
}

// --- live sandbox path -----------------------------------------------------

const shellExec = (cmd) =>
  new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd])
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', () => resolve({ code: 1, stdout }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })

/**
 * Launch the engine run headless and inherit the sandbox's environment — that
 * is where `ANTHROPIC_BASE_URL` and the dummy key live. The engine itself is
 * unchanged in W1; this only wraps it.
 */
const invokeEngineRun = ({ repoDir, planPath, reportFile }) =>
  new Promise((resolve) => {
    const child = spawn('claude', ['-p', `/ultrapowers ${planPath}`], { cwd: repoDir, stdio: 'inherit' })
    child.on('error', () => resolve({ gateGreen: false }))
    child.on('close', (code) => resolve({ gateGreen: code === 0 && readGateGreen(reportFile) }))
  })

const withToken = (wsUrl, token) => `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${token}`

export const main = async ({
  assignmentPath = ASSIGNMENT_PATH,
  repoDir = REPO_DIR,
  exec = shellExec,
  invokeRun,
} = {}) => {
  const assignment = readAssignment(assignmentPath)
  const { runId, token, wsUrl, ttlMs } = assignment
  const sandboxId = assignment.sandboxId ?? sandboxIdFor(runId)
  const planPath = assignment.planPath ?? process.env.FLEET_PLAN_PATH
  const reportFile = path.resolve(repoDir, assignment.reportFile ?? DEFAULT_REPORT_FILE)

  // A second, short-lived client alongside `runShim`'s own: `runShim` owns the
  // claim/status/spend protocol and does not expose its store, so the stamp and
  // the reported-token scalar are written over this one.
  const store = createMergeableStore(auxStoreId(sandboxId))
  const synchronizer = await createWsSynchronizer(store, new WebSocket(withToken(wsUrl, token)))
  await synchronizer.startSync()

  const stamp = await readStamp({ repoDir, exec })
  applyStamp(store, runId, stamp)

  const outcome = await runShim({
    wsUrl,
    token,
    sandboxId,
    runId,
    ttlMs,
    invokeRun: invokeRun ?? (() => invokeEngineRun({ repoDir, planPath, reportFile })),
    readReportTokens: () => readReportTokens(reportFile),
  })

  applyStamp(store, runId, stamp)
  applyReportedTokens(store, runId, readReportTokens(reportFile))

  await synchronizer.save()
  await synchronizer.stopSync()
  await synchronizer.destroy()
  return outcome
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
    .then((outcome) => {
      console.log(JSON.stringify(outcome))
      process.exit(outcome?.status === 'gate-green' ? 0 : 1)
    })
    .catch((error) => {
      console.error(`fleet shim-main failed: ${error?.message ?? error}`)
      process.exit(1)
    })
}
