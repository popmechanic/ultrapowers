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
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim, connectOpenWs, deliverAndClose } from './shim.mjs'
import { startEventPromoter } from './events-bridge.mjs'

export const ASSIGNMENT_PATH = '/home/exedev/fleet-run.json'

/**
 * The two clones a sandbox holds, and they are not the same directory.
 *
 * `ENGINE_DIR` is the golden image's baked checkout, parked at `ENGINE_REF` by
 * the provisioner before this file runs. It is the code that RUNS: the only
 * thing `oneDriverArgs` resolves `fleet/run-main.mjs` out of, and the only
 * thing the version stamp may name.
 *
 * `TARGET_DIR` is the clone the driver pushed `BASE_REF` into. It is the tree
 * the run BUILDS: what `invokeEngineRun` checks out, what the engine is spawned
 * in, and what every receipt, branch, sampler and promoter path resolves under.
 *
 * They were one `REPO_DIR` until now, which made the stamp read whichever ref
 * happened to sit in the single checkout — engine identity and target identity
 * were indistinguishable because they were the same commit by construction.
 */
export const ENGINE_DIR = '/home/exedev/repo'
export const TARGET_DIR = '/home/exedev/target'

/** Where the engine writes its per-run artifacts, relative to the repo root. */
export const RUN_ARTIFACT_DIR = '.claude/ultrapowers'

/**
 * The engine's run report, INSIDE its run directory.
 *
 * There is no fixed path to it. `ultra_gate.py` writes both the report and the
 * gate receipt into `.claude/ultrapowers/run-<stamp>/`, where `<stamp>` is
 * minted by the run itself — so the file is found by scanning, exactly as the
 * receipts are, and never by naming a directory the engine does not create.
 */
export const RUN_REPORT_FILE = 'report.json'

/**
 * How often the shim samples the sandbox's own load into `<runDir>/load.jsonl`
 * (#549). A minute: fine enough to see a wave saturate the box, coarse enough
 * that a multi-hour run's evidence stays a few hundred lines.
 */
export const LOAD_SAMPLE_INTERVAL_MS = 60000

/** The machine-written receipt the engine's gate leaves in each run directory. */
export const GATE_RECEIPT_FILE = 'gate-receipt.json'

/**
 * The branch `provisionRun` pushes the driver's base ref to inside the sandbox
 * (`<baseRef>:refs/heads/fleet-base`).
 *
 * A LITERAL, and deliberately so: it is the one ref name this side chooses, it
 * is interpolated into a shell, and nothing upstream may influence it. The run
 * must execute the base the driver pushed — a sandbox left on the golden
 * image's HEAD would run, gate, and report against whatever code the image was
 * baked with, which is a green read for code nobody asked to test.
 */
export const BASE_REF = 'fleet-base'

/**
 * The branch the provisioner parks the ENGINE clone on before starting this
 * file — the identity half of the split above.
 *
 * A LITERAL for the same reason `BASE_REF` is: it is interpolated into a shell,
 * and nothing upstream may influence it. The stamp is read from THIS ref in
 * THAT directory, so the sha and version the driver cross-checks name the code
 * that ran, never the code it was pointed at.
 */
export const ENGINE_REF = 'fleet-engine'

/**
 * The plugin manifest, repo-relative — the version half of the version stamp.
 *
 * Read out of a git ref rather than off disk, so see `readStamp` for why.
 */
export const MANIFEST_PATH = '.claude-plugin/plugin.json'

/**
 * Where receipts are COPIED to so they survive as git objects.
 *
 * `RUN_ARTIFACT_DIR` is gitignored (repo `.gitignore`: `.claude/ultrapowers/`),
 * so a receipt left where the engine wrote it exists in no tree at any sha — the
 * pointer would name a path the driver can never dereference, and the file dies
 * with the sandbox. Copying it here and committing it on the integration branch
 * is what makes `{sha, path}` an actual pointer.
 */
export const FLEET_RECEIPT_DIR = 'fleet-receipts'

/**
 * The character class a git ref or repo-relative path may use before it is
 * interpolated into a shell command.
 *
 * Both ends interpolate: this file shells `git checkout <branch>`, and the
 * driver shells `git fetch <url> <branch>` and `git cat-file -e <sha>:<path>`
 * with values THIS SIDE published. The branch name is sandbox-authored data on
 * the orchestrator's side of the trust boundary, so it is validated where it is
 * written AND again where it is used — a write-side-only check protects nothing
 * against a sandbox that writes the store cell directly.
 */
export const SAFE_GIT_NAME = /^[A-Za-z0-9._\/-]+$/

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

/**
 * Whether a ref/path is safe to interpolate. Beyond the character class, a
 * leading `-` is rejected (git would read it as an option, which is argument
 * injection without a single shell metacharacter) and `..` is rejected (path
 * traversal out of the repo).
 */
export const isSafeBranchName = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  SAFE_GIT_NAME.test(value) &&
  !value.startsWith('-') &&
  !value.split('/').includes('..')

/**
 * A repo-relative path, as the other pointer half. Same character class and the
 * same two extra rejections — a receipt path is interpolated into
 * `git cat-file -e <sha>:<path>` exactly as a branch name is into `git fetch`.
 */
export const isSafeRepoPath = isSafeBranchName

/** A git object name, as a pointer half. Same interpolation hazard, tighter shape. */
export const isSafeSha = (value) => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value)

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

/**
 * Sum the `output_tokens` of every distinct assistant MESSAGE in one Claude
 * Code session transcript.
 *
 * A transcript is newline-delimited JSON. Claude Code writes one record PER
 * CONTENT BLOCK of a streamed assistant message (text, then each tool_use),
 * and every one of those records carries the same `message.id` and the same
 * `message.usage` block — the whole message's generation, not the block's.
 * Summing every record therefore counts one message as many times as it has
 * blocks: run-47 (2026-09-01) read 582,547 from 10 transcripts whose distinct
 * messages total 239,564, the exact figure the workers' own envelopes report
 * (`modelUsage`). So the reading is keyed by `message.id`, last value wins;
 * a record with no id (older shapes, the sim's minimal lines) still counts
 * once each. Over a live, append-only transcript the result is still
 * CUMULATIVE and only rises — the shape `maybeAppendSpend`'s delta sampling
 * needs — because a message's usage is complete on its first record.
 */
export const sumTranscriptOutputTokens = (file) => {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  let total = 0
  const byMessage = new Map()
  for (const raw of content.split('\n')) {
    if (!raw) continue
    let record
    try {
      record = JSON.parse(raw)
    } catch {
      continue
    }
    const usage = record?.message?.usage ?? record?.usage
    const out = usage?.output_tokens
    if (typeof out !== 'number' || !Number.isFinite(out)) continue
    const id = record?.message?.id
    if (typeof id === 'string' && id) byMessage.set(id, out)
    else total += out
  }
  for (const out of byMessage.values()) total += out
  return total
}

// (The session-transcript spend readers — readSessionTokenSources /
// readSessionTokens, PROJECTS_ROOT — died at 0.3.0 with the claude engine
// session that wrote those transcripts; the driver's workers write under the
// run-owned CLAUDE_CONFIG_DIR, read below.)

/**
 * The run's output-token reader: the deterministic
 * driver gives every worker its own `--session-id` under a per-run
 * `CLAUDE_CONFIG_DIR` (`<runDir>/claude`), so the run's transcripts are ALL
 * the `*.jsonl` under that directory's `projects/` — there is no main/subagent
 * split to sentinel on. Summing every file keyed by the run-owned directory
 * (not by session id) counts exactly this run and nothing else: no other
 * process writes there.
 *
 * `total: null` when the directory or any transcripts are absent — same
 * "reported: number|null" survival as the session reader, so the §W1d shape
 * holds before the engine has written anything.
 */
export const readRunConfigTokens = (configDir) => {
  const projectsRoot = path.join(configDir, 'projects')
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(p)
    }
  }
  walk(projectsRoot)
  if (files.length === 0) return { total: null, files: 0 }
  let total = 0
  for (const file of files) total += sumTranscriptOutputTokens(file)
  return { total, files: files.length }
}

/**
 * The run's PRIMARY output-token reader: the number the workers' own
 * envelopes report. `run-worker.mjs` writes each finished worker's result
 * envelope to `<runDir>/workers/<label>/envelope.json`, and this sums
 * `modelUsage[model].outputTokens` over every model of every envelope — the
 * same sum the engine's own `meterOf` takes, and NEVER the envelope's
 * `usage`, which reports the last call only.
 *
 * This is what the engine metered rather than what a transcript layout
 * happens to expose, so it leads and `readRunConfigTokens` follows: run-47
 * (2026-09-01) read 239,564 from the transcripts deduped by `message.id`
 * against 239,695 from these envelopes — an agreement close enough that the
 * fallback stays honest when no envelope was written.
 *
 * `total: null` with `files: 0` when no envelope exists — the same
 * "reported: number|null" survival as the transcript reader, so a run that
 * has written nothing yet is never reported as a zero-token run. An envelope
 * that is unparseable or carries no `modelUsage` still COUNTS as a file (an
 * envelope was written) and contributes 0.
 */
export const readRunEnvelopeTokens = (runDir) => {
  const workersDir = path.join(runDir, 'workers')
  let entries
  try {
    entries = fs.readdirSync(workersDir, { withFileTypes: true })
  } catch {
    return { total: null, files: 0 }
  }
  let total = 0
  let files = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let content
    try {
      content = fs.readFileSync(path.join(workersDir, entry.name, 'envelope.json'), 'utf8')
    } catch {
      continue
    }
    files += 1
    let envelope
    try {
      envelope = JSON.parse(content)
    } catch {
      continue
    }
    for (const usage of Object.values(envelope?.modelUsage ?? {})) {
      const out = usage?.outputTokens
      if (typeof out === 'number' && Number.isFinite(out)) total += out
    }
  }
  if (files === 0) return { total: null, files: 0 }
  return { total, files }
}

/** Ack types inside the #281 standing grant — everything else parks. */
export const GRANTED_ACK_TYPES = new Set(['deferred:runtime', 'deferred:external'])

/**
 * Whether the engine's own gate passed — read from the machine-written GATE
 * RECEIPT (`gate-receipt.json`), never from `report.json`.
 *
 * The engine's report carries no verdict field at all; the verdict
 * (`PASS | BLOCKED | NEEDS_ACK`) is written by `ultra_gate.py` into the
 * sibling receipt in the same run directory. `report.json` remains solely
 * the token-count source for `readReportTokens` — the two readers are
 * deliberately split across the two files the engine actually writes.
 *
 * A bare `PASS` greens unconditionally. `BLOCKED` never greens. A
 * `NEEDS_ACK` (the fleet's park-by-default posture, #181) greens ONLY when
 * the session self-approved it under the #281 standing directive — proven by
 * three legs of evidence, all read from the SAME run directory as this
 * receipt, and all fail-closed:
 *
 *   1. `standing-approval.json` exists — the session declared its intent to
 *      self-approve BEFORE running the approve.
 *   2. every ack in the receipt is inside `GRANTED_ACK_TYPES` — a non-empty
 *      array (an empty array must never green vacuously) where every entry's
 *      `type` is granted; anything outside the grant parks.
 *   3. `approve-receipt.json` exists, is `mode: 'approve'`, and its `stamp`
 *      matches the gate receipt's own `stamp` — proving the approve that ran
 *      is THIS run's approve, not some other run's leftover receipt.
 *
 * A missing/unreadable receipt is not green either.
 */
export const readGateGreen = (receiptFile) => {
  const receipt = readJson(receiptFile)
  if (!receipt) return false
  if (receipt.verdict === 'PASS') return true
  if (receipt.verdict !== 'NEEDS_ACK') return false

  const runDir = path.dirname(receiptFile)
  if (!readJson(path.join(runDir, 'standing-approval.json'))) return false

  const acks = receipt.gateCheck?.acks
  if (!Array.isArray(acks) || acks.length === 0) return false
  if (!acks.every((a) => GRANTED_ACK_TYPES.has(a?.type))) return false

  const approve = readJson(path.join(runDir, 'approve-receipt.json'))
  if (approve?.mode !== 'approve') return false
  if (typeof receipt.stamp !== 'string' || receipt.stamp.length === 0) return false
  if (approve.stamp !== receipt.stamp) return false
  return true
}

// --- git readers -----------------------------------------------------------
// All of them go through the injected `exec` seam and none of them throw: a
// sandbox that cannot read its own git state still finishes its run and reports
// the gap honestly, rather than dying with the run's outcome unrecorded.

const revParse = async ({ repoDir, exec, ref }) => {
  // `ref` reaches a shell exactly as `branch` does at the `git checkout` call
  // below — guarded the same way, so a caller that passes an unsafe branch
  // name (as `applyRunReceipts` does when it falls back to the run's own
  // `branch`) never gets it interpolated. Mirrors that guard's shape: reject
  // and return the documented empty result rather than shell out at all.
  if (!isSafeBranchName(ref)) return ''
  try {
    const result = await exec(`git -C ${repoDir} rev-parse ${ref}`)
    if (result?.code !== 0) return ''
    return String(result.stdout ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * A file's contents AT A REF, without consulting the working tree.
 *
 * `git show <ref>:<path>` is what makes the stamp's two halves name the same
 * commit: the checkout moves during a run, a ref does not. Both interpolated
 * values are guarded, exactly as `revParse` guards its own — and like every
 * reader here it returns the empty result rather than throwing.
 */
const showFile = async ({ repoDir, exec, ref, file }) => {
  if (!isSafeBranchName(ref) || !isSafeRepoPath(file)) return ''
  try {
    const result = await exec(`git -C ${repoDir} show ${ref}:${file}`)
    if (result?.code !== 0) return ''
    return String(result.stdout ?? '')
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
 * The engine's run directories, oldest first.
 *
 * Sorted by NAME, which is chronological by construction: the directory is
 * `run-<stamp>` and the stamp is `YYYYMMDDHHMMSS`. Sorting by name rather than
 * by mtime keeps discovery a pure function of what is on disk — an mtime is
 * moved by anything that touches the directory, including this file's own
 * receipt copy.
 *
 * `excludeDirs` is an optional `Set` of run-directory NAMES to treat as
 * invisible (#190). `main()` snapshots the directories that already exist
 * before the engine launches and passes them here, so every discovery reader
 * is scoped to the run's OWN output: a stale gitignored receipt left in a
 * dirty golden image must never green a run that was never gated. The run's
 * own directories are exactly the ones that did not exist before launch.
 */
export const runArtifactDirs = (repoDir, artifactDir = RUN_ARTIFACT_DIR, { excludeDirs } = {}) => {
  let entries
  try {
    entries = fs.readdirSync(path.join(repoDir, artifactDir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => entry.name)
    .filter((name) => !excludeDirs?.has(name))
    .sort()
}

/**
 * Every machine-written gate receipt the run produced, as repo-relative paths.
 *
 * Scoped to `run-*` directories on purpose, and to the receipt file by name:
 * the run report lives in the SAME directory and is not a receipt.
 */
export const findReceiptFiles = (repoDir, artifactDir = RUN_ARTIFACT_DIR, { excludeDirs } = {}) =>
  runArtifactDirs(repoDir, artifactDir, { excludeDirs })
    .map((name) => path.join(artifactDir, name, GATE_RECEIPT_FILE))
    .filter((relPath) => fs.existsSync(path.join(repoDir, relPath)))

/**
 * The newest run report on disk, as an absolute path, or `''` when the engine
 * has not written one.
 *
 * Resolved LAZILY, never once up front: the run directory does not exist when
 * the sandbox boots — the engine mints it mid-run — so a path computed before
 * the run is a path to nothing. Every read goes through here so a report that
 * appears halfway through a run is picked up on the next sample rather than
 * missed for the run's whole life.
 */
export const findRunReportFile = (repoDir, artifactDir = RUN_ARTIFACT_DIR, { excludeDirs } = {}) => {
  const names = runArtifactDirs(repoDir, artifactDir, { excludeDirs })
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const candidate = path.join(repoDir, artifactDir, names[i], RUN_REPORT_FILE)
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

/**
 * The newest machine-written gate receipt on disk, as an absolute path, or
 * `''` when the engine has not gated yet — the file `readGateGreen` reads.
 *
 * Reuses `findReceiptFiles` rather than re-scanning: that function already
 * walks `runArtifactDirs` oldest-first and filters to receipts that exist, so
 * its LAST entry is the newest run directory that has one — exactly the
 * discovery `findRunReportFile` performs for `report.json`, against the
 * sibling file.
 */
export const findGateReceiptFile = (repoDir, artifactDir = RUN_ARTIFACT_DIR, { excludeDirs } = {}) => {
  const files = findReceiptFiles(repoDir, artifactDir, { excludeDirs })
  const newest = files.at(-1)
  return newest ? path.join(repoDir, newest) : ''
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

/**
 * Record WHICH plan the run executed, by content (#544). The plan text now
 * rides the assignment rather than the base ref, so a ref+path no longer
 * identifies it — the hash does, and it is the half of the receipt an operator
 * can check against the plan they shipped. `setCell` for `applyStamp`'s
 * reason; an assignment with no plan writes nothing rather than a hash of ''.
 */
export const applyPlanSha256 = (store, runId, planText) => {
  if (!isNonEmptyString(planText)) return
  store.setCell('runs', runId, 'planSha256', crypto.createHash('sha256').update(planText).digest('hex'))
}

export const applyReceipt = (store, runId, kind, { sha, path: receiptPath, verdict }) => {
  store.setRow('receipts', `${runId}:${kind}`, { sha, path: receiptPath, verdict })
}

/**
 * Publish the branch the run integrated to. `setCell` for the same reason
 * `applyStamp` uses it, and an empty branch is skipped rather than blanking a
 * name already in place — the driver's fallback is a name that does not exist.
 *
 * A name that is not shell-safe is REJECTED and the cell left as it was: the
 * orchestrator interpolates this value into a `git fetch`, so publishing
 * `main; rm -rf /` would be handing it a command. This is the write-side half
 * of the check; the driver validates again on read, because a hostile sandbox
 * would not come through this function at all.
 */
export const applyBranch = (store, runId, branch) => {
  if (!isSafeBranchName(branch)) return false
  store.setCell('runs', runId, 'branch', branch)
  return true
}

/**
 * Where a discovered receipt is copied to inside the checkout.
 *
 * `fleet-receipts/<runId>/<basename>` collides the moment a sandbox holds two
 * run directories: every engine receipt is called `gate-receipt.json`, so both
 * would copy onto one file and one pointer would name the other's content. The
 * source run directory disambiguates, exactly as the row `kind` does, and only
 * when there is something to disambiguate.
 */
export const receiptDestination = (runId, relPath, unique) => {
  const base = path.basename(relPath)
  const sourceDir = path.basename(path.dirname(relPath))
  return `${FLEET_RECEIPT_DIR}/${runId}/${unique ? base : `${sourceDir}-${base}`}`
}

/**
 * Write one receipts row per artifact the run produced — the production writer.
 *
 * A receipt is a POINTER into git: `{sha, path}` must dereference, i.e.
 * `git cat-file -e <sha>:<path>` must succeed on the branch the driver fetches
 * back. The engine writes its receipts under `.claude/ultrapowers/`, which is
 * GITIGNORED — a pointer left there is in no tree at any sha and dies with the
 * sandbox. So each receipt is copied into `fleet-receipts/<runId>/`, force-added
 * (the source directory is ignored; the destination should not have to depend on
 * that), and committed on the integration branch. The sha recorded is that
 * branch's tip AFTER the commit, so the pointer resolves.
 *
 * `verdict` is copied from the receipt file for display only — the driver
 * re-derives resolvability from git itself and never trusts this field.
 *
 * A copy failure on ANY receipt sinks the WHOLE publish: every other receipt
 * is still attempted (so the failure is visible in full, not just at the
 * first file), but nothing is staged, committed, or written to the store
 * unless every copy succeeded. A survivor row resolving on its own would let
 * `o1` read true for a run that did not actually finish publishing what it
 * claimed to — the driver's fail-closed reads (an empty receipts table, or
 * its publish-timeout) are the correct outcome for a partial publish, not a
 * one-receipt-short green.
 *
 * Returns the rows written. Never throws: a sandbox that cannot commit its
 * receipts still finishes, and the driver reads the gap as unresolved. This
 * includes a REJECTING `exec` (checkout, add, or commit) — the whole publish
 * block degrades to "nothing published" rather than propagating an exception
 * past `main()`'s `synchronizer.save()` and skipping the trailing scalar
 * writes it still owes the store.
 */
export const applyRunReceipts = async (store, runId, { repoDir, exec, branch, excludeDirs }) => {
  const files = findReceiptFiles(repoDir, undefined, { excludeDirs })
  if (files.length === 0) return []
  // `runId` becomes a path component and is shelled below; the orchestrator
  // authors it, but nothing downstream should depend on that being true.
  if (!isSafeRepoPath(runId)) return []

  try {
    // Commit ON the integration branch — that is the ref the driver fetches,
    // and a receipt committed anywhere else points at a tree it will never
    // see. Best effort: if the checkout fails, the commit lands elsewhere,
    // the sha below is still read from `branch`, and the pointer fails to
    // dereference. Fail-closed and visible, never a silently mismatched
    // pointer.
    if (isSafeBranchName(branch)) await exec(`git -C ${repoDir} checkout -q ${branch}`)

    const staged = []
    let anyCopyFailed = false
    for (const relPath of files) {
      const destRel = receiptDestination(runId, relPath, files.length === 1)
      try {
        fs.mkdirSync(path.dirname(path.join(repoDir, destRel)), { recursive: true })
        fs.copyFileSync(path.join(repoDir, relPath), path.join(repoDir, destRel))
      } catch {
        anyCopyFailed = true
        continue
      }
      const receipt = readJson(path.join(repoDir, relPath))
      // `gate` is the schema's kind for the one receipt a run normally produces.
      // More than one means more than one engine run directory survived in the
      // sandbox, so the kind is keyed by that directory: stable across re-reads,
      // and unique, which the row id depends on.
      const kind = files.length === 1 ? 'gate' : `gate-${path.basename(path.dirname(relPath))}`
      staged.push({ kind, destRel, verdict: typeof receipt?.verdict === 'string' ? receipt.verdict : '' })
    }
    if (anyCopyFailed || staged.length === 0) return []

    await exec(`git -C ${repoDir} add -f ${staged.map((entry) => entry.destRel).join(' ')}`)
    // The identity is supplied inline: a golden image with no git identity
    // configured must not be the reason a run's receipts are unreachable.
    await exec(
      `git -C ${repoDir} -c user.email=fleet@localhost -c user.name=fleet -c commit.gpgsign=false ` +
        `commit -q -m "fleet: receipts for ${runId}"`,
    )

    const sha = await revParse({ repoDir, exec, ref: branch || 'HEAD' })
    if (!sha) return []

    const written = []
    for (const entry of staged) {
      applyReceipt(store, runId, entry.kind, { sha, path: entry.destRel, verdict: entry.verdict })
      written.push({ kind: entry.kind, sha, path: entry.destRel, verdict: entry.verdict })
    }
    return written
  } catch {
    return []
  }
}

/**
 * The identity of the code about to run — read from the REF the driver pushed,
 * never from the checkout.
 *
 * The checkout is not that identity at any point in a run. The sandbox boots on
 * the golden image's HEAD; `invokeEngineRun` then moves it onto `BASE_REF`; the
 * engine then leaves it on `ultra/integration-<stamp>`. So a stamp read from
 * HEAD (or from the manifest on disk) names the IMAGE when taken before the run
 * and a descendant when taken after — in the first case attesting, as the
 * identity of the code that ran, a commit the driver never sent. The driver's
 * read only checks that the cells are non-empty, so that misattribution passes
 * `versionStamp` and reaches the gate looking exactly like a correct one.
 *
 * A ref is the fixed point: nothing in a run moves one, and it still resolves
 * once the engine has moved HEAD — so the stamp is the same whether it is taken
 * before or after the run, and both halves come from one commit. `main` calls
 * this with the ENGINE clone and `ENGINE_REF`, because the identity the driver
 * cross-checks is the code that ran, not the tree it built; the `ref` default
 * stays `BASE_REF` for a caller that wants the tree's own identity instead.
 *
 * A repo where the ref does not resolve stamps EMPTY, with no fall back to
 * disk: an unpushed base means `invokeEngineRun` fails the run anyway, and a
 * fallback would restore precisely the misattribution above with nothing on the
 * read able to see it. Never throws — a sandbox that cannot read its own
 * identity still runs, and reports the gap the gate reads as absent.
 */
export const readStamp = async ({ repoDir, exec, ref = BASE_REF }) => {
  const engineSha = await revParse({ repoDir, exec, ref })
  if (!engineSha) return { pluginVersion: '', engineSha: '' }
  let manifest = null
  try {
    manifest = JSON.parse(await showFile({ repoDir, exec, ref, file: MANIFEST_PATH }))
  } catch {
    manifest = null
  }
  return { pluginVersion: typeof manifest?.version === 'string' ? manifest.version : '', engineSha }
}

/**
 * The ultrapowers version the ENGINE actually ran — the plugin installed in
 * the sandbox, read from `claude plugin list --json`. `readStamp` attests the
 * pushed base; this attests what was installed. The two disagreed exactly
 * when the image was stale (#282: the run-16 golden sat four releases behind
 * and both halves of the old cross-check came from the pushed ref, so nothing
 * said so). Since #373 the run installs the plugin FROM the `BASE_REF`
 * checkout before the engine launches (`installPluginFromCheckout`), so
 * `main()` reads this AFTER the run and the two halves agree by
 * construction — same manifest, same sha. Never throws; an unreadable list
 * stamps '' and the driver skips the installed-plugin check.
 */
// --- live sandbox path -----------------------------------------------------

/**
 * The default `exec` seam: run a shell command, resolve `{code, stdout, stderr}`,
 * never reject. A spawn that fails outright resolves `code: 1` — every caller
 * here branches on the code, and none of them wants an exception instead.
 * `stderr` is carried so a refused launch can quote WHY (`claude plugin …`
 * reports its failures there); no reader branches on it.
 */
export const shellExec = (cmd) =>
  new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', () => resolve({ code: 1, stdout, stderr }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

/**
 * The one-driver launch argv (exported so a test can pin what is spawned,
 * like `engineArgs`). No directive rides it: the standing directive was
 * instructions for an LLM session, and this launch has none — the two-move
 * rule it dictated is `run-main.mjs`'s `ackDecision`, code not prose.
 *
 * The two directories part company here, and this is the line where it shows:
 * the module path comes from `engineDir` because that is the code being run,
 * and `--repo <repoDir>` names the target because that is the tree being built.
 * `--repo` is mandatory on `run-main.mjs`'s side, so it is always emitted —
 * a driver launched without it would resolve its repo from its own module
 * location, which is now the engine clone rather than the target.
 */
export const oneDriverArgs = ({ engineDir, repoDir, planPath, runId, overlap } = {}) => [
  path.join(engineDir, 'fleet', 'run-main.mjs'),
  planPath,
  runId,
  '--repo',
  repoDir,
  // #514: the run assignment's optional overlap mode, in `run-main.mjs`'s own
  // flag spelling. Absent → exactly the five-entry argv above, so an
  // assignment written by a pre-#514 driver launches identically.
  ...(overlap ? ['--overlap', overlap] : []),
]

/**
 * The engine's environment: the inherited env (the credential lives there,
 * #213) plus `ULTRAPOWERS_FLEET_RUN=<runId>` — the one signal the skill's
 * §Engine/§Client branch and `ultra_run.py`'s `fleet-run` stage read to know
 * they are inside a fleet sandbox (One Driver Phase 0 §mechanism). It is set
 * here and nowhere else; an engine that finds it unset refuses at preflight.
 * (Distinct from the driver's `engineEnv` — the per-run env FILE `provisionRun`
 * delivers, which is what `process.env` already carries by the time this runs.)
 */
export const engineProcessEnv = (runId) => ({ ...process.env, ULTRAPOWERS_FLEET_RUN: runId })

/**
 * The default spawn seam: run a command to completion, resolve its exit code.
 * `stdio: 'inherit'` deliberately — the engine's output is the sandbox's log,
 * and buffering a multi-minute run in memory would serve nobody.
 */
export const spawnEngineProcess = ({ command, args, cwd, runId }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: engineProcessEnv(runId) })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })

/**
 * Where an assignment-carried plan is materialised, relative to the repo root.
 *
 * `assignment-<runId>` and deliberately NOT `run-<runId>`: `runArtifactDirs`
 * lists only `run-*` directories and #190 scopes every gate-receipt read to the
 * directories that did not exist before launch. A plan copy written before the
 * engine starts is not evidence — naming it `run-…` would put a directory this
 * file created into the run's own evidence scope. The parent
 * (`.claude/ultrapowers/`) self-ignores, so nothing here reaches the run branch
 * or the dirty baseline.
 */
export const assignmentPlanDir = (runId) => path.join(RUN_ARTIFACT_DIR, `assignment-${runId}`)

/**
 * Write the assignment's plan into the checkout and return the repo-relative
 * path to hand the engine; `null` when the assignment carries no plan (the
 * pre-#544 shape, which launches against `planPath` exactly as at BASE).
 *
 * #544 §The one hard constraint: the plan the run executes need not exist in
 * the base the driver pushed. The driver ships its TEXT in the assignment, the
 * sandbox lays it down beside the checkout, and the run's receipt records the
 * hash — so what ran is identified by content rather than by a ref that may
 * never have carried it.
 *
 * The verdicts ride along because `compile_plan.py` looks for
 * `<stem>.gate-verdicts.json` BESIDE the plan and refuses a claims-v1 plan
 * without it. `null` verdicts write no file at all rather than an empty one:
 * an empty verdict file is a different refusal than a missing one.
 */
export const writeAssignmentPlan = (repoDir, planPath, runId, plan) => {
  if (!plan || !isNonEmptyString(plan.text)) return null
  const relDir = assignmentPlanDir(runId)
  const base = path.basename(planPath)
  fs.mkdirSync(path.join(repoDir, relDir), { recursive: true })
  fs.writeFileSync(path.join(repoDir, relDir, base), plan.text)
  if (isNonEmptyString(plan.verdicts)) {
    const stem = base.slice(0, base.length - path.extname(base).length)
    fs.writeFileSync(path.join(repoDir, relDir, `${stem}.gate-verdicts.json`), plan.verdicts)
  }
  return path.join(relDir, base)
}

/**
 * One line per minute of what the box itself was doing, into the run dir.
 *
 * The engine's own timings say a wave was slow; they never say the sandbox was
 * oversubscribed — and the process that could have told us dies with the VM
 * (#549, #484). So the shim samples itself: `/proc/loadavg`, the `Mem:` row of
 * `free -m`, and how many `pytest` and `claude` processes are alive, appended
 * as JSONL into `<runDir>/load.jsonl`, which the sandbox-logs pull already
 * tars off the VM before teardown. No new transport, no drive change.
 *
 * Every reader is a seam, and every reader is allowed to fail: on macOS all
 * three throw, and a sampler that crashed the run it was measuring would be a
 * worse instrument than none. A throwing reader nulls ITS OWN fields for that
 * line and the sampler keeps going — the `number|null` shape the rest of the
 * fleet's metrics already use.
 *
 * The interval is unref'd: a sampler nobody stopped must never be the reason a
 * process stays alive.
 */
export const startLoadSampler = ({
  file,
  intervalMs = LOAD_SAMPLE_INTERVAL_MS,
  readLoadavg = () => fs.readFileSync('/proc/loadavg', 'utf8'),
  readFree = () => execFileSync('free', ['-m'], { encoding: 'utf8' }),
  listProcs = () => execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' }),
  now = () => new Date().toISOString(),
} = {}) => {
  // The run dir is normally the engine's to create, and it does not exist yet
  // when the shim starts sampling. `recursive` so the engine's own later
  // `mkdirSync(recursive)` is a no-op, and swallowed so an unwritable tree
  // costs the evidence rather than the run.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  } catch {}

  const sample = () => {
    const line = { ts: now(), ...readLoads(readLoadavg), ...readMemory(readFree), ...countProcs(listProcs) }
    try {
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`)
    } catch {
      // A sampler is never the reason a run fails. An unwritable run dir is
      // one lost line, not a dead engine.
    }
  }

  sample()
  const timer = setInterval(sample, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/** A finite number, or `null` — the shape every unreadable field takes. */
const asNumber = (text) => {
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** `/proc/loadavg`: the 1/5/15-minute averages are its first three fields. */
const readLoads = (readLoadavg) => {
  try {
    const [one, five, fifteen] = String(readLoadavg()).trim().split(/\s+/)
    return { load1: asNumber(one), load5: asNumber(five), load15: asNumber(fifteen) }
  } catch {
    return { load1: null, load5: null, load15: null }
  }
}

/**
 * `free -m`: the `Mem:` row, whose columns are total, used, free, shared,
 * buff/cache, available. `available` — not `free` — is the one that says
 * whether another worker fits.
 */
const readMemory = (readFree) => {
  try {
    const row = String(readFree()).split('\n').find((l) => l.trim().startsWith('Mem:'))
    const cols = row.trim().split(/\s+/).slice(1)
    return { memUsedMb: asNumber(cols[1]), memAvailMb: asNumber(cols[5]) }
  } catch {
    return { memUsedMb: null, memAvailMb: null }
  }
}

/**
 * `ps -eo args=`: one full command line per process. `pytest` is counted
 * anywhere on the line (`python3 -m pytest …` is a pytest), `claude` only as
 * the basename of the executable — otherwise every worker prompt mentioning
 * the word would count as a process.
 *
 * A text reader and an array of lines are both accepted: the live reader
 * returns `ps` output, a sim hands over the lines it wants counted.
 */
const countProcs = (listProcs) => {
  try {
    const raw = listProcs()
    const procs = (Array.isArray(raw) ? raw : String(raw).split('\n'))
      .map((l) => String(l).trim())
      .filter((l) => l.length > 0)
    return {
      pytest: procs.filter((l) => l.includes('pytest')).length,
      claude: procs.filter((l) => path.basename(l.split(/\s+/)[0]) === 'claude').length,
    }
  } catch {
    return { pytest: null, claude: null }
  }
}

/**
 * Launch the engine run headless, against the base the driver pushed.
 *
 * Four things must be true before a single token is spent, and all are
 * checked here rather than assumed:
 *
 *   planPath   The assignment carries it (`provisionRun` puts it in the
 *              payload). Spawning without it hands the engine the literal
 *              string `undefined` as a plan path — the run starts, burns a
 *              sandbox, and fails on nothing legible. Absent means fail, now.
 *   fleet-base The provisioner pushed the driver's base ref to this branch,
 *              and the sandbox's checkout is still the golden image's HEAD
 *              until something moves it. Running without this checkout tests
 *              the IMAGE, not the base under test — a green read for code the
 *              driver never sent. A failed checkout means fail, now.
 *   runId      The assignment carries it; it becomes ULTRAPOWERS_FLEET_RUN,
 *              without which the engine refuses at preflight (fail-closed).
 *              Absent means fail, now.
 *
 * Each failure returns an explicit `error` rather than a bare falsy outcome, so
 * `runShim` parks the run (fail-closed) and the reason reaches the sandbox log
 * instead of being inferred from a silent park.
 *
 * The environment is inherited plus `ULTRAPOWERS_FLEET_RUN=<runId>`
 * (`engineProcessEnv`) — the inherited half is where the engine's credential lives
 * (`CLAUDE_CODE_OAUTH_TOKEN`, sourced from the per-run env file `provisionRun`
 * delivers, #213). No credential is read or set here; the credential-evidence
 * log (`claude auth status`, #213) is the driver's — run-main.mjs emits it
 * into the run's event log before the engine phase.
 */
export const invokeEngineRun = async ({
  engineDir = ENGINE_DIR,
  repoDir,
  planPath,
  runId,
  plan,
  overlap,
  exec = shellExec,
  spawnEngine = spawnEngineProcess,
  log = console.error,
  excludeDirs,
  // The load sampler (#549), on a seam beside the others so a sim can inject a
  // no-op and read BASE behaviour exactly.
  startSampler = startLoadSampler,
}) => {
  // Order, and it is load-bearing: planPath → checkout BASE_REF → launch.
  // Each step refuses on failure.
  if (!isNonEmptyString(planPath)) {
    log('fleet: run assignment carries no planPath — refusing to launch the engine')
    return { gateGreen: false, error: 'missing planPath' }
  }

  if (!isNonEmptyString(runId)) {
    log('fleet: run assignment carries no runId — refusing to launch the engine')
    return { gateGreen: false, error: 'missing runId' }
  }

  // A literal ref name, so there is nothing to validate and nothing to inject.
  // Wrapped: a REJECTING exec (not merely a non-zero code) must degrade to the
  // same explicit failure — an exec seam that throws is a failed checkout,
  // never an uncaught crash mid-run.
  let checkedOut
  try {
    checkedOut = await exec(`git -C ${repoDir} checkout -q ${BASE_REF}`)
  } catch {
    checkedOut = { code: 1 }
  }
  if (checkedOut?.code !== 0) {
    log(`fleet: could not check out ${BASE_REF} — refusing to run against the image's HEAD`)
    return { gateGreen: false, error: `checkout ${BASE_REF} failed` }
  }

  // AFTER the checkout and before the spawn, and both halves matter: the
  // checkout moves the tree these files sit in, and the engine reads the plan
  // the moment it starts. Absent `plan`, this is a no-op and `planPath` is
  // spawned exactly as at BASE.
  const launchPlanPath = writeAssignmentPlan(repoDir, planPath, runId, plan) ?? planPath

  // The ENGINE clone is the engine (0.3.0: the only engine — the `claude` skill
  // session and its plugin-install dance were deleted at cutover; git history
  // holds them). `run-main.mjs` is read out of `engineDir` and spawned with
  // `cwd` and `--repo` naming the target it just checked out, so the code that
  // runs and the tree it builds are separately identified; the gate-receipt
  // read is unchanged and still scoped to the target.
  // Started before the spawn and stopped after it either way (#549): the
  // sampler's whole purpose is to describe the box WHILE the engine runs, and
  // a spawn that throws is exactly the run whose load line matters most. The
  // run dir is the engine's to create (run-main.mjs) — a `recursive` mkdir
  // here is harmless to the engine's own later `recursive` mkdirs.
  const sampler = startSampler({
    file: path.join(repoDir, RUN_ARTIFACT_DIR, `run-${runId}`, 'load.jsonl'),
    intervalMs: LOAD_SAMPLE_INTERVAL_MS,
  })
  let code
  try {
    code = await spawnEngine({
      command: 'node',
      args: oneDriverArgs({ engineDir, repoDir, planPath: launchPlanPath, runId, overlap }),
      cwd: repoDir,
      runId,
    })
  } finally {
    sampler?.stop?.()
  }
  // Resolved AFTER the run, because the run is what creates the directory.
  // The verdict lives in the gate receipt, never in report.json — see
  // `readGateGreen`. Scoped by `excludeDirs` to the directories this run
  // minted (#190).
  return { gateGreen: code === 0 && readGateGreen(findGateReceiptFile(repoDir, undefined, { excludeDirs })) }
}

const withToken = (wsUrl, token) => `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${token}`

export const main = async ({
  assignmentPath = ASSIGNMENT_PATH,
  // The engine clone: read for the stamp, resolved for the launch argv, and
  // written to by nothing. `repoDir` keeps its name and is now the TARGET —
  // every other read and write below resolves under it.
  engineDir = ENGINE_DIR,
  repoDir = TARGET_DIR,
  exec = shellExec,
  // The engine spawn, injectable like `exec` so a test can drive `main()`
  // through the real `invokeEngineRun` (checkout → plugin install → launch)
  // without ever starting a `claude` process.
  spawnEngine = spawnEngineProcess,
  invokeRun,
  readTokens: readTokensOverride,
  readTokensSources: readTokensSourcesOverride,
  auxDeliver = deliverAndClose,
} = {}) => {
  const assignment = readAssignment(assignmentPath)
  const { runId, token, wsUrl, ttlMs, overlap } = assignment
  const sandboxId = assignment.sandboxId ?? sandboxIdFor(runId)
  const planPath = assignment.planPath ?? process.env.FLEET_PLAN_PATH
  // #544: `{ text, verdicts }` beside the unchanged `planPath` — the plan's
  // CONTENT, for a base that may not carry it. Absent on a pre-#544
  // assignment, and every path below degrades to what BASE did.
  const plan = assignment.plan

  // The run's cumulative output-token total, from the run-owned config dir
  // (`readRunConfigTokens`). Injectable as a seam — like `invokeRun` and
  // `exec` — so a test can drive `main()` to a spend read without a real
  // engine writing real transcripts.
  // One-driver runs write every worker transcript under the run-owned
  // `CLAUDE_CONFIG_DIR` (`<runDir>/claude`, run-main.mjs), so the spend read
  // is keyed by that directory rather than the session id — which no worker
  // shares.
  // Envelopes lead, transcripts follow: the workers' own `modelUsage` is what
  // the engine metered, so the transcript sum is only consulted when the run
  // wrote no envelope at all (`files === 0`) — a run whose envelopes genuinely
  // sum to 0 reports 0, not the transcripts' number.
  const oneDriverRunDir = path.join(repoDir, RUN_ARTIFACT_DIR, `run-${runId}`)
  const oneDriverConfigDir = path.join(oneDriverRunDir, 'claude')
  const readTokens = readTokensOverride ?? (() => {
    const envelopes = readRunEnvelopeTokens(oneDriverRunDir)
    return envelopes.files > 0 ? envelopes.total : readRunConfigTokens(oneDriverConfigDir).total
  })

  // The #209 sentinel's source, on the same seam. A test that injects
  // `readTokens` alone is driving the spend path, not the transcript layout —
  // reading the real (empty) sources under it would flag a shape nobody wrote,
  // so an un-overridden `readTokens` override disables the sentinel entirely.
  // The one-driver path disables it too: its main/subagent split does not
  // exist, so the two run-7 shapes the sentinel flags cannot occur.
  // Always null since 0.3.0: the sentinel flagged transcript shapes of the
  // deleted claude-session engine; the driver's main/subagent split does not
  // exist, so the shapes it flagged cannot occur.
  const readTokensSources = readTokensSourcesOverride ?? null

  // A second, short-lived client alongside `runShim`'s own: `runShim` owns the
  // claim/status/spend protocol and does not expose its store, so the stamp and
  // the reported-token scalar are written over this one.
  //
  // The socket comes from `connectOpenWs`, not a bare `new WebSocket(...)`
  // (#288): a rejection here propagates straight out of `main()` to the
  // `invokedDirectly` catch below, so the engine never launches with a dead
  // aux transport.
  const url = withToken(wsUrl, token)
  const ws = await connectOpenWs(url, { log: console.error })
  const store = createMergeableStore(auxStoreId(sandboxId))
  const synchronizer = await createWsSynchronizer(store, ws)
  await synchronizer.startSync()

  // Read ONCE and re-applied below rather than re-read after the run. That is
  // sound only because it is sourced from a ref the run does not move:
  // `ENGINE_REF` in the ENGINE clone, which nothing in a run touches at all.
  // It is deliberately not the target's `BASE_REF` — the driver cross-checks
  // this sha and version against ITS engine checkout's HEAD and manifest, so a
  // stamp naming the tree under test would compare two unrelated commits.
  const stamp = await readStamp({ repoDir: engineDir, exec, ref: ENGINE_REF })
  applyStamp(store, runId, stamp)
  // The installed half of #282 is NOT read here, and is not read at all any
  // more: no plugin participates in a run (the engine clone IS the engine), so
  // the stamp above — the engine ref's sha and manifest — is the whole of it.

  // The run's scope, snapshotted BEFORE the engine launches (#190): every run
  // directory on disk right now predates this run, so none of them is this
  // run's evidence. A dirty golden image can carry a stale gitignored
  // `gate-receipt.json`, and without this scope it would green — and publish —
  // a run that never reached the gate. Injected `invokeRun` overrides supply
  // their own outcome and are unaffected.
  const preRunDirs = new Set(runArtifactDirs(repoDir))

  const outcome = await runShim({
    wsUrl,
    token,
    sandboxId,
    runId,
    ttlMs,
    invokeRun:
      invokeRun ??
      (async () => {
        // #421: promote the engine's events.jsonl to `events` store rows
        // while the run executes — the shim already holds the synced store,
        // so each event reaches every subscriber (orchestrator, laptop watch
        // client) live instead of surfacing only in the teardown pull. The
        // promoter tolerates the file not existing (it appears after
        // preflight) and is stopped — with a final drain — before the engine
        // outcome is returned, so the terminal events precede the publish
        // signal the driver waits on.
        const promoter = startEventPromoter({
          store, runId,
          file: path.join(repoDir, RUN_ARTIFACT_DIR, `run-${runId}`, 'events.jsonl'),
        })
        try {
          return await invokeEngineRun({ engineDir, repoDir, planPath, runId, plan, overlap, exec, spawnEngine, excludeDirs: preRunDirs })
        } finally {
          promoter.stop()
        }
      }),
    readReportTokens: readTokens,
  })

  // `no-store` means `runShim` never got past opening its own socket — the run
  // never claimed, never ran, never produced anything. There is nothing to
  // publish: the stamp write above already synced (or didn't, moot either
  // way), but rewriting it, reading tokens off a session that never launched,
  // and hunting for a branch/receipts an engine never produced would all be
  // publishing fiction. Just tear the aux synchronizer down and return —
  // no `deliverAndClose` here, because there is genuinely nothing to deliver.
  if (outcome?.status === 'no-store') {
    console.error('fleet: no store connection — skipping publish (run never executed)')
    synchronizer.stopSync()
    synchronizer.destroy()
    return { ...outcome }
  }

  // Everything below runs AFTER `runShim` has returned, which is deliberate:
  // `runShim`'s status writes replace the whole runs row from its own synced
  // view, so anything written while it is still running can be dropped by its
  // next transition.

  // The trailing scalars go FIRST. The driver waits for the publish signal —
  // a non-default branch plus a non-empty receipts table — and then computes its
  // read, so anything written after that signal races the read it belongs to.
  // Writing the stamp and the token total ahead of the branch and the receipts
  // makes the signal mean "everything is published", not "most of it is".
  //
  // (The post-run `claude plugin list` read died at 0.3.0 with the install it
  // evidenced: no plugin participates in the run — the checkout IS the engine —
  // and stamping the golden's bootstrap plugin would go permanently red the
  // moment plugin.json bumps past the image. The stamp is the checkout's own
  // manifest + sha, written before launch.)
  applyStamp(store, runId, stamp)
  applyReportedTokens(store, runId, readTokens())
  applyPlanSha256(store, runId, plan?.text)

  // #209 interim defense: the token total above is only as trustworthy as the
  // transcript layout it was summed from, and a layout drift undercounts
  // silently. We cannot detect the drift — so publish the two SHAPES run-7 says
  // a real engine run cannot produce (a total with no main transcript; a
  // completed run with zero subagent transcripts, when subagents are ~55% of
  // real spend) as a cell the operator and the evidence grep can both see.
  // A healthy shape writes nothing at all.
  const sources = readTokensSources?.()
  if (sources && sources.total !== null && (!sources.mainFound || sources.subagentFiles === 0)) {
    const warning =
      'spend-source sentinel: suspicious transcript shape — mainFound=' +
      sources.mainFound +
      ' subagentFiles=' +
      sources.subagentFiles +
      ' (#209: possible silent undercount; verify the transcript layout)'
    console.error('fleet: ' + warning)
    store.setCell('runs', runId, 'spendSentinel', warning)
  }

  // Then the branch, because the receipts are committed onto it and point at
  // its tip. Publishing it is what lets the driver fetch the run back at all —
  // the sandbox never pushes, and `ultra/integration-<stamp>` is a name only the
  // engine knows.
  const branch = await detectIntegrationBranch({ repoDir, exec })
  // Receipts before the branch cell: the commit MOVES the tip, and the branch
  // cell is the last half of the signal the driver waits on.
  await applyRunReceipts(store, runId, { repoDir, exec, branch, excludeDirs: preRunDirs })
  applyBranch(store, runId, branch)

  // The aux publish carries the branch, the receipts and the trailing scalars
  // — an outcome is only genuinely delivered when BOTH the shim's own store
  // and this one reached the orchestrator, so the two conjoin.
  const auxDelivered = await auxDeliver({ store, synchronizer, ws, url, log: console.error })
  return { ...outcome, delivered: outcome?.delivered === true && auxDelivered }
}

/**
 * The process exit-code contract (#320): a run is a success ONLY when it is
 * gate-green AND its publish actually reached the orchestrator. Everything
 * else — parked, failed, no-store, undelivered, malformed — is 1.
 */
export const shimExitCode = (outcome) =>
  outcome?.status === 'gate-green' && outcome?.delivered === true ? 0 : 1

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
    .then((outcome) => {
      console.log(JSON.stringify(outcome))
      // Delivery is part of the exit-code contract: a gate-green run whose
      // publish never reached the orchestrator is not a success anyone can
      // observe, and burying that in shim.log makes it invisible.
      process.exit(shimExitCode(outcome))
    })
    .catch((error) => {
      console.error(`fleet shim-main failed: ${error?.message ?? error}`)
      process.exit(1)
    })
}
