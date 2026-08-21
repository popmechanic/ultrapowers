#!/usr/bin/env node
// fleet/shim-main.mjs — the sandbox entrypoint the provisioner starts.
//
// It is the thin outer shell around `runShim`: read the run assignment the
// provisioner dropped at /home/exedev/fleet-run.json, stamp the run row with
// the identity of the code that is about to execute, hand `runShim` an
// `invokeRun` that launches the real engine run, and — when it is over —
// publish what the run produced: the branch it integrated to, one receipts row
// per gate receipt it left behind, and the run report's token total.
//
// Publishing the branch is not bookkeeping. The sandbox never pushes (it holds
// no git credentials), so the driver pulls the run back over the transport it
// already owns — and the only name it can pull is the one this file reports.
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

/** Where the engine writes its per-run artifacts, relative to the repo root. */
export const RUN_ARTIFACT_DIR = '.claude/ultrapowers'

/** The engine's run report, relative to the repo root. */
export const DEFAULT_REPORT_FILE = `${RUN_ARTIFACT_DIR}/fleet-run/report.json`

/** The machine-written receipt the engine's gate leaves in each run directory. */
export const GATE_RECEIPT_FILE = 'gate-receipt.json'

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

// --- git readers -----------------------------------------------------------
// All of them go through the injected `exec` seam and none of them throw: a
// sandbox that cannot read its own git state still finishes its run and reports
// the gap honestly, rather than dying with the run's outcome unrecorded.

const revParse = async ({ repoDir, exec, ref }) => {
  try {
    const result = await exec(`git -C ${repoDir} rev-parse ${ref}`)
    if (result?.code !== 0) return ''
    return String(result.stdout ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * The branch the engine run actually integrated to.
 *
 * The engine names it `ultra/integration-<stamp>` and tells nobody; the fleet
 * never gets to choose it. It is detected MECHANICALLY from the refs the run
 * left behind — never by parsing engine output, which is prose and would drift
 * with every prompt edit. The newest such ref by committer date is this run's,
 * because the sandbox is cloned per run and does exactly one.
 *
 * Returns `''` when the run integrated nowhere, so the caller publishes nothing
 * rather than a branch name that does not exist.
 */
export const detectIntegrationBranch = async ({ repoDir, exec }) => {
  try {
    const result = await exec(
      `git -C ${repoDir} for-each-ref --format='%(refname:short)' --sort=-committerdate 'refs/heads/ultra/integration-*'`,
    )
    if (result?.code !== 0) return ''
    const [newest] = String(result.stdout ?? '')
      .split('\n')
      // The quotes are stripped by the shell on the live path; an `exec` seam
      // that does not go through one would leave them.
      .map((line) => line.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    return newest ?? ''
  } catch {
    return ''
  }
}

/**
 * Every machine-written gate receipt the run produced, as repo-relative paths.
 *
 * Scoped to `run-*` directories on purpose: the run report shares the artifact
 * directory (`.claude/ultrapowers/fleet-run/report.json`) and is not a receipt.
 */
export const findReceiptFiles = (repoDir, artifactDir = RUN_ARTIFACT_DIR) => {
  let entries
  try {
    entries = fs.readdirSync(path.join(repoDir, artifactDir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(artifactDir, entry.name, GATE_RECEIPT_FILE))
    .filter((relPath) => fs.existsSync(path.join(repoDir, relPath)))
    .sort()
}

// --- store writers ---------------------------------------------------------
// All of them are `setCell`/`setRow` writes of small scalars only — receipts
// carry pointers into git (sha + path) and never file content.

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
 * Publish the branch the run integrated to. `setCell` for the same reason
 * `applyStamp` uses it, and an empty branch is skipped rather than blanking a
 * name already in place — the driver's fallback is a name that does not exist.
 */
export const applyBranch = (store, runId, branch) => {
  if (typeof branch === 'string' && branch.length > 0) store.setCell('runs', runId, 'branch', branch)
}

/**
 * Write one receipts row per artifact the run produced — the production writer.
 *
 * A receipt is a POINTER into git: the sha is the tip of the branch the run
 * integrated to, the path is repo-relative, and `verdict` is copied from the
 * receipt file for display only (the driver re-derives resolvability from git
 * itself and never trusts this field). With no sha there is nothing to point
 * at, so nothing is written — the orchestrator's guard rejects a receipt row
 * missing either pointer half anyway.
 *
 * Returns the rows written. Never throws.
 */
export const applyRunReceipts = async (store, runId, { repoDir, exec, branch }) => {
  const sha = await revParse({ repoDir, exec, ref: branch || 'HEAD' })
  if (!sha) return []
  const files = findReceiptFiles(repoDir)
  const written = []
  for (const relPath of files) {
    const receipt = readJson(path.join(repoDir, relPath))
    const verdict = typeof receipt?.verdict === 'string' ? receipt.verdict : ''
    // `gate` is the schema's kind for the one receipt a run normally produces.
    // More than one means more than one engine run directory survived in the
    // sandbox, so the kind is keyed by that directory: stable across re-reads,
    // and unique, which the row id depends on.
    const kind = files.length === 1 ? 'gate' : `gate-${path.basename(path.dirname(relPath))}`
    applyReceipt(store, runId, kind, { sha, path: relPath, verdict })
    written.push({ kind, sha, path: relPath, verdict })
  }
  return written
}

/**
 * The identity of the code about to run: the plugin version from the manifest
 * on disk plus the repo's HEAD. Never throws — a sandbox that cannot read its
 * own identity still runs, and reports an empty stamp the gate reads as absent.
 */
export const readStamp = async ({ repoDir, exec }) => {
  const manifest = readJson(path.join(repoDir, '.claude-plugin', 'plugin.json'))
  const pluginVersion = typeof manifest?.version === 'string' ? manifest.version : ''
  return { pluginVersion, engineSha: await revParse({ repoDir, exec, ref: 'HEAD' }) }
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

  // Everything below runs AFTER `runShim` has returned, which is deliberate:
  // `runShim`'s status writes replace the whole runs row from its own synced
  // view, so anything written while it is still running can be dropped by its
  // next transition.

  // The branch first, because the receipts point at its tip. Publishing it is
  // what lets the driver fetch the run back at all — the sandbox never pushes,
  // and `ultra/integration-<stamp>` is a name only the engine knows.
  const branch = await detectIntegrationBranch({ repoDir, exec })
  applyBranch(store, runId, branch)
  await applyRunReceipts(store, runId, { repoDir, exec, branch })

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
