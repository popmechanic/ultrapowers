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
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim, connectOpenWs, deliverAndClose } from './shim.mjs'

export const ASSIGNMENT_PATH = '/home/exedev/fleet-run.json'
export const REPO_DIR = '/home/exedev/repo'

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
 * Sum every `output_tokens` reading in one Claude Code session transcript.
 *
 * A transcript is newline-delimited JSON; each assistant message carries a
 * `message.usage` (or bare `usage`) block, and `output_tokens` is that turn's
 * generation. Summing them over a live, append-only transcript yields a
 * CUMULATIVE total that only rises — exactly the shape `maybeAppendSpend`'s
 * delta sampling needs.
 */
const sumTranscriptOutputTokens = (file) => {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  let total = 0
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
    if (typeof out === 'number' && Number.isFinite(out)) total += out
  }
  return total
}

/** `.claude/projects` under the sandbox user's home — where the engine writes transcripts. */
export const PROJECTS_ROOT = ['.claude', 'projects']

/**
 * The run's total output-token cost, read from the engine SESSION TRANSCRIPTS
 * — the only place token counts exist (`report.json` carries none, which is
 * why `readReportTokens` is null against today's engine).
 *
 * The run is launched with a fixed `--session-id`, so its transcript is a
 * deterministic `{projects}/*​/{sessionId}.jsonl`, and every subagent it spawns
 * (the majority of the spend) nests under
 * `{projects}/*​/{sessionId}/subagents/workflows/*​/agent-*.jsonl`. Summing
 * `output_tokens` across all of them gives the run's true cumulative cost.
 *
 * Keyed by the run-unique session id, so a cloned golden warm-up session
 * sharing the same project directory is never counted. Returns `null` — not
 * `0` — when no transcript for this session exists yet, so the §W1d
 * "reported: number|null" distinction survives before the engine has written
 * anything.
 */
export const readSessionTokens = (sessionId, { home = os.homedir() } = {}) => {
  if (!isNonEmptyString(sessionId)) return null
  const projectsRoot = path.join(home, ...PROJECTS_ROOT)
  let projectDirs
  try {
    projectDirs = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name))
  } catch {
    return null
  }

  const transcripts = []
  for (const dir of projectDirs) {
    const mainTranscript = path.join(dir, `${sessionId}.jsonl`)
    if (fs.existsSync(mainTranscript)) transcripts.push(mainTranscript)

    const workflowsRoot = path.join(dir, sessionId, 'subagents', 'workflows')
    let workflowDirs = []
    try {
      workflowDirs = fs
        .readdirSync(workflowsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(workflowsRoot, entry.name))
    } catch {
      workflowDirs = []
    }
    for (const workflowDir of workflowDirs) {
      let agentFiles = []
      try {
        agentFiles = fs
          .readdirSync(workflowDir)
          .filter((name) => /^agent-.*\.jsonl$/.test(name))
          .map((name) => path.join(workflowDir, name))
      } catch {
        agentFiles = []
      }
      transcripts.push(...agentFiles)
    }
  }

  if (transcripts.length === 0) return null
  let total = 0
  for (const file of transcripts) total += sumTranscriptOutputTokens(file)
  return total
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
 *      is THIS run's approve, not some other run's leftover receipt. Then
 *      `RUN_LOCK` (one level up from the run directory) must no longer name
 *      this stamp: the approve's own on-disk side effect is releasing that
 *      lock, so a lock still naming this stamp means the approve never
 *      actually ran to completion.
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

  // The approve's own on-disk side effect: run_lock.sh release removes the
  // lock when it holds this stamp. A lock still naming this stamp means the
  // approve never actually ran.
  let lockHolder = null
  try {
    lockHolder = fs.readFileSync(path.join(runDir, '..', 'RUN_LOCK'), 'utf8')
  } catch {
    lockHolder = null
  }
  if (lockHolder === receipt.stamp) return false
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
 */
export const runArtifactDirs = (repoDir, artifactDir = RUN_ARTIFACT_DIR) => {
  let entries
  try {
    entries = fs.readdirSync(path.join(repoDir, artifactDir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Every machine-written gate receipt the run produced, as repo-relative paths.
 *
 * Scoped to `run-*` directories on purpose, and to the receipt file by name:
 * the run report lives in the SAME directory and is not a receipt.
 */
export const findReceiptFiles = (repoDir, artifactDir = RUN_ARTIFACT_DIR) =>
  runArtifactDirs(repoDir, artifactDir)
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
export const findRunReportFile = (repoDir, artifactDir = RUN_ARTIFACT_DIR) => {
  const names = runArtifactDirs(repoDir, artifactDir)
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
export const findGateReceiptFile = (repoDir, artifactDir = RUN_ARTIFACT_DIR) => {
  const files = findReceiptFiles(repoDir, artifactDir)
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
export const applyRunReceipts = async (store, runId, { repoDir, exec, branch }) => {
  const files = findReceiptFiles(repoDir)
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
 * `BASE_REF` is the fixed point: `provisionRun` pushes the driver's base to it,
 * nothing moves it afterwards, and it still resolves once the engine has moved
 * HEAD — so the stamp is the same whether it is taken before or after the run,
 * and both halves come from the one commit under test.
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

// --- live sandbox path -----------------------------------------------------

/**
 * The default `exec` seam: run a shell command, resolve `{code, stdout}`, never
 * reject. A spawn that fails outright resolves `code: 1` — every caller here
 * branches on the code, and none of them wants an exception instead.
 */
export const shellExec = (cmd) =>
  new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd])
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', () => resolve({ code: 1, stdout }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })

/** The engine launch, as an argv. Exported so a test can pin what is spawned. */
export const ENGINE_COMMAND = 'claude'

/**
 * The standing pre-authorization carried in every headless launch (#280).
 * A sandbox session has no operator until the run ends, so a NEEDS_ACK gate
 * with only routine runtime/external deferred-verification acks must be able
 * to self-approve under SKILL.md Step 5's standing-grant grammar — the launch
 * directive is the quotable instruction. run-9b parked-by-question at exactly
 * this seam and surfaced as a heartbeat timeout. Everything outside the
 * granted class still parks (fleet park-by-default, #181): the session leaves
 * the gate receipt as the terminal artifact and exits.
 */
export const STANDING_DIRECTIVE =
  'Headless fleet run: no operator is present until the run ends, so never end a turn on a ' +
  'question — and never end a turn to wait: while the engine workflow (or any background ' +
  'task of this run) is incomplete, stay active and await it with blocking work in-turn ' +
  '(bounded polling of its state is fine); ending a turn to "wait for a notification" ' +
  'terminates this headless session and kills the run. ' +
  'Standing pre-authorization for the pre-merge gate: on a NEEDS_ACK verdict, ' +
  'approve if and only if every ack is a deferredVerification item with reason runtime or ' +
  'external — write run-<stamp>/standing-approval.json FIRST, quoting this directive ' +
  'verbatim as the instruction. Then execute the Approve (ultra_gate.py --approve) and save ' +
  'its JSON output verbatim to run-<stamp>/approve-receipt.json — the fleet shim greens the ' +
  'run only on that receipt. A plan task of Type manual is post-merge runbook material, ' +
  'never a gate ack to consume. Any ack outside that class, or a BLOCKED verdict, means do ' +
  'NOT approve: leave the gate receipt as the terminal artifact and end the session ' +
  'immediately.'

/**
 * The engine launch argv. A `sessionId`, when given, is threaded to
 * `--session-id` so the run's transcript lands at a deterministic path
 * `readSessionTokens` can find. Omitting it yields the bare form unchanged, so
 * every existing caller and pin still holds.
 */
export const engineArgs = (planPath, sessionId) => {
  const args = ['-p', `/ultrapowers ${planPath}\n\n${STANDING_DIRECTIVE}`]
  if (isNonEmptyString(sessionId)) args.push('--session-id', sessionId)
  return args
}

/**
 * The default spawn seam: run a command to completion, resolve its exit code.
 * `stdio: 'inherit'` deliberately — the engine's output is the sandbox's log,
 * and buffering a multi-minute run in memory would serve nobody.
 */
export const spawnEngineProcess = ({ command, args, cwd }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })

/**
 * Launch the engine run headless, against the base the driver pushed.
 *
 * Two things must be true before a single token is spent, and both are checked
 * here rather than assumed:
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
 *
 * Both failures return an explicit `error` rather than a bare falsy outcome, so
 * `runShim` parks the run (fail-closed) and the reason reaches the sandbox log
 * instead of being inferred from a silent park.
 *
 * The environment is inherited — that is where the engine's credential lives
 * (`CLAUDE_CODE_OAUTH_TOKEN`, sourced from the per-run env file `provisionRun`
 * delivers, #213). No credential is read or set here; `claude auth status` is
 * logged before launch so the run's evidence names the credential it rode
 * (`authMethod`), best-effort — a failed status read never blocks the run. The
 * engine itself is unchanged in W1; this only wraps it.
 */
export const invokeEngineRun = async ({
  repoDir,
  planPath,
  sessionId,
  exec = shellExec,
  spawnEngine = spawnEngineProcess,
  log = console.error,
}) => {
  if (!isNonEmptyString(planPath)) {
    log('fleet: run assignment carries no planPath — refusing to launch the engine')
    return { gateGreen: false, error: 'missing planPath' }
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

  // Which credential will this run spend? Logged, not enforced — the evidence
  // pull (#197) carries shim.log, so a run that rode the wrong auth is legible.
  try {
    const status = await exec(`${ENGINE_COMMAND} auth status`)
    const parsed = JSON.parse(status?.stdout ?? '')
    log(`fleet: engine auth ${JSON.stringify({ authMethod: parsed.authMethod, apiKeySource: parsed.apiKeySource, subscriptionType: parsed.subscriptionType })}`)
  } catch {
    log('fleet: engine auth status unreadable (continuing)')
  }

  const code = await spawnEngine({ command: ENGINE_COMMAND, args: engineArgs(planPath, sessionId), cwd: repoDir })
  // Resolved AFTER the run, because the run is what creates the directory.
  // The verdict lives in the gate receipt, never in report.json — see
  // `readGateGreen`.
  return { gateGreen: code === 0 && readGateGreen(findGateReceiptFile(repoDir)) }
}

const withToken = (wsUrl, token) => `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${token}`

export const main = async ({
  assignmentPath = ASSIGNMENT_PATH,
  repoDir = REPO_DIR,
  exec = shellExec,
  invokeRun,
  readTokens: readTokensOverride,
} = {}) => {
  const assignment = readAssignment(assignmentPath)
  const { runId, token, wsUrl, ttlMs } = assignment
  const sandboxId = assignment.sandboxId ?? sandboxIdFor(runId)
  const planPath = assignment.planPath ?? process.env.FLEET_PLAN_PATH

  // A run-unique session id forced onto the engine launch (`--session-id`), so
  // its transcript — and every subagent's under it — lands at a deterministic
  // path `readSessionTokens` can sum for this run's true output-token cost.
  // report.json carries no token count, so the transcripts are the only source.
  const sessionId = randomUUID()

  // The run's cumulative output-token total, from the engine session
  // transcripts (`readSessionTokens`). Injectable as a seam — like `invokeRun`
  // and `exec` — so a test can drive `main()` to a spend read without a real
  // engine writing a real transcript into the user's home.
  const readTokens = readTokensOverride ?? (() => readSessionTokens(sessionId))

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
  // sound only because it is sourced from `BASE_REF`, which the run does not
  // move: a stamp read from the checkout would be stale by the time the engine
  // returned, which is exactly the bug `readStamp` documents.
  const stamp = await readStamp({ repoDir, exec })
  applyStamp(store, runId, stamp)

  const outcome = await runShim({
    wsUrl,
    token,
    sandboxId,
    runId,
    ttlMs,
    invokeRun: invokeRun ?? (() => invokeEngineRun({ repoDir, planPath, sessionId, exec })),
    readReportTokens: readTokens,
  })

  // Everything below runs AFTER `runShim` has returned, which is deliberate:
  // `runShim`'s status writes replace the whole runs row from its own synced
  // view, so anything written while it is still running can be dropped by its
  // next transition.

  // The trailing scalars go FIRST. The driver waits for the publish signal —
  // a non-default branch plus a non-empty receipts table — and then computes its
  // read, so anything written after that signal races the read it belongs to.
  // Writing the stamp and the token total ahead of the branch and the receipts
  // makes the signal mean "everything is published", not "most of it is".
  applyStamp(store, runId, stamp)
  applyReportedTokens(store, runId, readTokens())

  // Then the branch, because the receipts are committed onto it and point at
  // its tip. Publishing it is what lets the driver fetch the run back at all —
  // the sandbox never pushes, and `ultra/integration-<stamp>` is a name only the
  // engine knows.
  const branch = await detectIntegrationBranch({ repoDir, exec })
  // Receipts before the branch cell: the commit MOVES the tip, and the branch
  // cell is the last half of the signal the driver waits on.
  await applyRunReceipts(store, runId, { repoDir, exec, branch })
  applyBranch(store, runId, branch)

  await deliverAndClose({ store, synchronizer, ws, url, log: console.error })
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
