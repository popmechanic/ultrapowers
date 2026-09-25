// factory/board.mjs — the board: the one module that talks to Kata, and it
// never fails a run (#810 "map: the blackboard"; CLAUDE.md "Hub writes are
// never the run's failure"; Kata docs/workflows/agents.md: comments for
// decisions, metadata for state).
//
// Everything the run learns about a task goes onto that task's issue through
// this module, and anyone about to work on the task can be handed all of it
// as plain text via `factsFor`. Every method here resolves and never
// rejects: a Kata outage is logged, not thrown, and the run carries on with
// the empty value the caller would have gotten from an issue with nothing on
// it yet.

/** The character budget `factsFor` renders into — a whole number of whole
 *  facts, newest kept first, oldest dropped until the rendering fits. */
const FACTS_LIMIT = 12000

/** Prefixed onto `factsFor`'s rendering whenever at least one fact was
 *  dropped to fit the budget. */
const OMITTED_PREFIX = '(earlier facts omitted)'

/** True when a comment's first line is a bracketed kind, e.g. `[landing]` —
 *  the shape `post` writes and `factsFor` reads back. This module does not
 *  validate which kind: it brackets whatever `post` was given and reads back
 *  whatever is bracketed. */
const isFact = (body) => {
  if (typeof body !== 'string') return false
  const firstLine = body.split('\n', 1)[0]
  return /^\[[^\]]*\]$/.test(firstLine)
}

/** The empty value M4 names for each of the five methods. */
const EMPTY = { post: null, factsFor: '', setState: null, settled: null }

/**
 * The five methods a driver or a worker needs to reach Kata. `kata` is
 * `fleet/kata-client.mjs`'s client (or any object shaped like it); `tasks` is
 * the kata.json's `tasks` object, `{ <taskId>: { uid, ... } }`. `log` is
 * called at most once per failing call, with a string beginning `board:`.
 *
 * With no `kata` at all (the run has nothing to talk to — a dry run, or a
 * config still being built) every method resolves its empty value without
 * ever calling `log`: there is nothing to have failed.
 */
/**
 * A metadata write, with the revision Kata demands. `patchMetadata` sends
 * `If-Match: "rev-<n>"` and Kata answers `400 If-Match revision is not a valid
 * integer` without one (run-196: every `setState` and every worker's `hand` and
 * `settled` was refused that way), so the revision is read first; a stale one
 * (412) is read again once. Shared by the board, the worker's tools and the
 * engine's one direct write, so the three cannot drift.
 */
export const patchWithRevision = async (kata, projectId, uid, patch) => {
  for (let attempt = 0; ; attempt += 1) {
    const issue = await kata.getIssue(uid)
    const revision = (issue && (issue.revision ?? (issue.issue || {}).revision))
    try {
      return await kata.patchMetadata(projectId, uid, patch, revision)
    } catch (error) {
      const stale = error && (error.status === 412 || /\b412\b/.test(String(error.message || '')))
      if (!stale || attempt >= 1) throw error
    }
  }
}

export const makeBoard = ({ kata, projectId, tasks, log } = {}) => {
  const noise = (label, taskId, error) => {
    if (typeof log !== 'function') return
    const detail = error && error.message ? error.message : String(error)
    log('board: ' + label + (taskId === undefined ? '' : ' (task ' + taskId + ')') + ' failed: ' + detail)
  }

  const uidFor = (taskId) => {
    const task = tasks && tasks[taskId]
    return task ? task.uid : undefined
  }

  const post = async (taskId, kind, text) => {
    if (!kata) return EMPTY.post
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      return await kata.comment(projectId, uid, '[' + kind + ']\n' + text)
    } catch (error) {
      noise('post', taskId, error)
      return EMPTY.post
    }
  }

  const factsFor = async (taskId) => {
    if (!kata) return EMPTY.factsFor
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      const issue = await kata.getIssue(uid)
      const comments = (issue && issue.comments) || []
      const facts = comments.map((c) => c && c.body).filter(isFact)
      if (facts.length === 0) return ''

      // Keep the newest whole facts that fit, dropping from the oldest end.
      // `start === facts.length` is the degenerate case where even the
      // single newest fact does not fit: zero facts are kept, and the
      // rendering is the omission prefix alone (well under the budget),
      // rather than a fact rendered partial or a rendering left over budget.
      for (let start = 0; start <= facts.length; start++) {
        const kept = facts.slice(start)
        const body = kept.join('\n\n')
        const rendered = start > 0 ? (body ? OMITTED_PREFIX + '\n\n' + body : OMITTED_PREFIX) : body
        if (rendered.length <= FACTS_LIMIT) return rendered
      }
      // Unreachable: the degenerate case above always fits.
      return OMITTED_PREFIX
    } catch (error) {
      noise('factsFor', taskId, error)
      return EMPTY.factsFor
    }
  }

  const setState = async (taskId, state) => {
    if (!kata) return EMPTY.setState
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      return await patchWithRevision(kata, projectId, uid, { 'factory.state': state })
    } catch (error) {
      noise('setState', taskId, error)
      return EMPTY.setState
    }
  }

  const settled = async (taskId) => {
    if (!kata) return EMPTY.settled
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      const issue = await kata.getIssue(uid)
      const metadata = (issue && issue.metadata) || {}
      const raw = metadata['interface.settled']
      if (raw === undefined || raw === null) return null
      if (typeof raw === 'object') return raw
      return JSON.parse(raw)
    } catch (error) {
      noise('settled', taskId, error)
      return EMPTY.settled
    }
  }

  return { post, factsFor, setState, settled }
}

// ═══════════════════════════════════════════════════════════════════════
// The CLI — `board.mjs`'s other half. `factory/boot.sh` used to talk to
// Kata itself (two Python-in-bash readers of `kata.json`, the spoke's
// config writer, the bound-wait loop, the run close); all of that now
// lives here, the one module that talks to Kata, so the boot only ever
// calls it (#1222, map #1131 rule 6). Every subcommand answers on stdout
// and complains on stderr, and `close-run` in particular never throws —
// CLAUDE.md: "board.mjs is the only module that talks to Kata and never
// fails a run".
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, chmodSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const DEFAULT_HUB_URL = 'https://kata-sync.int.exe.xyz'
const DEFAULT_ADMIN_URL = 'https://kata.int.exe.xyz'
const DEFAULT_KATA_URL = 'http://127.0.0.1:7777'

/** `--name value` pairs off `argv`, in order; a trailing flag with no value
 *  reads as `undefined`. */
function parseFlags (args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = args[i + 1]
      i += 1
    }
  }
  return flags
}

/** `file`, parsed as JSON, or `undefined` when it is missing or not JSON —
 *  never throws. */
function readJsonFile (file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * `spoke-config`: writes the spoke's `config.toml` and its `fleet-kata`
 * wrapper off the plan's `kata.json`, and prints `<name> <id>\n` — the
 * project the caller binds against. Exits 1, writing neither file and
 * printing nothing to stdout, when `project.name`/`project.id` cannot be
 * read.
 */
function cmdSpokeConfig (flags) {
  const kataJsonPath = flags['kata-json']
  const engineDir = flags['engine-dir']
  const home = flags.home
  const hubUrl = flags['hub-url'] ?? DEFAULT_HUB_URL
  const adminUrl = flags['admin-url'] ?? DEFAULT_ADMIN_URL
  const kataUrl = flags['kata-url'] ?? DEFAULT_KATA_URL

  const doc = readJsonFile(kataJsonPath)
  const project = doc && doc.project
  const name = project && project.name
  const id = project && project.id
  if (typeof name !== 'string' || name.length === 0 || !Number.isInteger(id)) {
    process.stderr.write('board: spoke-config: ' + kataJsonPath + ' carries no readable project.name/project.id\n')
    return 1
  }

  const helperDir = home + '/kata/helper'
  const localBinDir = home + '/.local/bin'
  mkdirSync(helperDir, { recursive: true })
  mkdirSync(localBinDir, { recursive: true })

  const credentialProvider = '["node", "' + engineDir + '/factory/kata-credential.mjs", "--kata-json", "' +
    kataJsonPath + '", "--admin-url", "' + adminUrl + '", "--state-dir", "' + helperDir + '"]'
  const toml = [
    'listen = "127.0.0.1:7777"',
    '',
    '[[daemon]]',
    'name = "hub"',
    'url = "' + hubUrl + '"',
    '',
    '[[federation.project]]',
    'hub = "hub"',
    'spoke_project = "' + name + '"',
    'hub_project = "' + name + '"',
    'intent = "collaborate"',
    'credential_provider = ' + credentialProvider,
  ].join('\n') + '\n'
  writeFileSync(home + '/kata/config.toml', toml)

  const wrapperPath = localBinDir + '/fleet-kata'
  const wrapper = '#!/bin/sh\n' +
    'exec env "KATA_HOME=' + home + '/kata" "KATA_SERVER=' + kataUrl + '" "' + home + '/.local/bin/kata" "$@"\n'
  writeFileSync(wrapperPath, wrapper)
  chmodSync(wrapperPath, 0o755)

  process.stdout.write(name + ' ' + id + '\n')
  return 0
}

/** Whether `doc` (the raw `federation status --json` text) reads bound for
 *  `project`: names it, and carries `"role":"spoke"` and
 *  `"provider_status":"ready"` (loosely spaced, Kata 0.18 prints no
 *  `status` cell of its own). */
function isBoundDocument (doc, project) {
  if (!doc.includes(project)) return false
  if (!/"role"\s*:\s*"spoke"/.test(doc)) return false
  if (!/"provider_status"\s*:\s*"ready"/.test(doc)) return false
  return true
}

/** One `kata federation status --json`, resolved on `PATH` with
 *  `KATA_SERVER` laid over the environment; a spawn that fails to run at
 *  all reads as an empty document. */
function federationStatus (kataUrl) {
  const result = spawnSync('kata', ['federation', 'status', '--json'], {
    env: { ...process.env, KATA_SERVER: kataUrl },
    encoding: 'utf8',
    timeout: 10000,
  })
  if (result.error || typeof result.stdout !== 'string') return ''
  return result.stdout
}

/** Whether `GET <kataUrl>/api/v1/issues/<uid>` answers 2xx inside 5s;
 *  a missing `uid` (no task named) reads as present — nothing to wait for. */
async function issuePresent (kataUrl, uid) {
  if (uid === undefined) return true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(kataUrl + '/api/v1/issues/' + uid, { signal: controller.signal })
    return res.status >= 200 && res.status < 300
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `wait`: polls once a second for `--seconds` seconds until the spoke
 * reads bound for `--project` AND the run's first task issue has arrived,
 * then prints the LOCAL `project_id` the status document names (or an
 * empty line when it names none) and exits 0. Past `--seconds` without
 * that: exit 1, nothing on stdout, one stderr line carrying the last
 * document.
 */
async function cmdWait (flags) {
  const project = flags.project
  const kataJsonPath = flags['kata-json']
  const kataUrl = flags['kata-url']
  const seconds = Number(flags.seconds)

  const doc = readJsonFile(kataJsonPath)
  const tasks = (doc && doc.tasks) || {}
  const firstTask = Object.values(tasks)[0]
  const firstUid = firstTask && firstTask.uid

  const deadline = Date.now() + seconds * 1000
  let lastDoc = ''
  while (true) {
    lastDoc = federationStatus(kataUrl)
    if (isBoundDocument(lastDoc, project) && await issuePresent(kataUrl, firstUid)) {
      const match = /"project_id"\s*:\s*(-?\d+)/.exec(lastDoc)
      process.stdout.write((match ? match[1] : '') + '\n')
      return 0
    }
    if (Date.now() >= deadline) break
    await sleep(1000)
  }
  process.stderr.write('board: wait: ' + project + ' was not bound within ' + seconds +
    's — federation status said: ' + lastDoc + '\n')
  return 1
}

/** One events row: `{ ts, kind, ...cells }` (kind `board:close` unless
 *  given), appended as a JSON line; creates the file's directory when needed. */
function appendEventRow (eventsPath, cells, kind = 'board:close') {
  mkdirSync(path.dirname(eventsPath), { recursive: true })
  const row = { ts: new Date().toISOString(), kind, ...cells }
  appendFileSync(eventsPath, JSON.stringify(row) + '\n')
}

/** Numeric task ids sort ascending before the rest, which sort by string —
 *  the order the hub's `409 parent_has_open_children` demands the tasks
 *  close in ahead of the run. */
function compareTaskIds (a, b) {
  const da = /^\d+$/.test(a)
  const db = /^\d+$/.test(b)
  if (da && db) return Number(a) - Number(b)
  if (da !== db) return da ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** One `POST <adminUrl>/api/v1/projects/<projectId>/issues/<uid>/actions/close`
 *  — no `authorization` header, ever (the admin host is where the edge
 *  injects the hub's bearer). Resolves to the HTTP status, or `null` on a
 *  connection failure; never throws. A 20s timeout. */
async function closeIssue ({ adminUrl, projectId, uid, key, message, evidence, run }) {
  const body = JSON.stringify({
    actor: 'sandbox:' + run,
    reason: 'done',
    message,
    evidence,
    retry_protocol: 'close-v1',
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(adminUrl + '/api/v1/projects/' + projectId + '/issues/' + uid + '/actions/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body,
      signal: controller.signal,
    })
    if (res.status < 200 || res.status >= 300) {
      process.stderr.write('board: close ' + uid + ' answered ' + res.status + '\n')
    }
    return res.status
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    process.stderr.write('board: close ' + uid + ' failed: ' + detail + '\n')
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `close-run`: closes the run's task issues, then the run issue itself, on
 * the hub — task order first (`409 parent_has_open_children` otherwise),
 * each recorded as one `board:close` row on `--events` whatever the hub
 * answers. Never fails the run (CLAUDE.md): a missing/unreadable kata.json
 * is one skip row and exit 0; a hub that answers 500, or not at all, is
 * still exit 0 with the row's `code` set from what came back.
 */
async function cmdCloseRun (flags) {
  const kataJsonPath = flags['kata-json']
  const run = flags.run
  const pr = flags.pr
  const adminUrl = flags['admin-url']
  const eventsPath = flags.events
  const title = flags.title
  const merged = flags.merged

  try {
    const doc = readJsonFile(kataJsonPath)
    if (doc === undefined) {
      appendEventRow(eventsPath, { what: 'run', code: null, skipped: 'no kata.json to read' })
      return 0
    }

    const projectId = doc.project && doc.project.id
    const runUid = doc.run && doc.run.uid
    if (!Number.isInteger(projectId) || typeof runUid !== 'string' || runUid.length === 0) {
      appendEventRow(eventsPath, { what: 'run', code: null, skipped: 'no readable project.id/run.uid' })
      return 0
    }

    const evidence = [{ type: 'pr', url: pr }]
    if (merged) evidence.push({ type: 'commit', sha: merged })

    const tasks = doc.tasks || {}
    const taskIds = Object.keys(tasks)
      .filter((id) => tasks[id] && typeof tasks[id].uid === 'string' && tasks[id].uid.length > 0)
      .sort(compareTaskIds)

    for (const id of taskIds) {
      const uid = tasks[id].uid
      const status = await closeIssue({
        adminUrl,
        projectId,
        uid,
        key: run + ':task:' + id + ':close',
        message: run + ' task ' + id + " done: adopted green in the run's pull request — " + pr,
        evidence,
        run,
      })
      appendEventRow(eventsPath, { what: 'task ' + id, code: status })
    }

    const runStatus = await closeIssue({
      adminUrl,
      projectId,
      uid: runUid,
      key: run + ':run:close',
      message: run + ' done: ' + title + ' — ' + pr,
      evidence,
      run,
    })
    appendEventRow(eventsPath, { what: 'run', code: runStatus })
    return 0
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    process.stderr.write('board: close-run: unexpected failure — ' + detail + '\n')
    return 0
  }
}

/**
 * `mark-run --kata-json <k> --run <run> --state <s> --admin-url <url> --events <e>`:
 * writes `work.state` = `<s>` (`parked` or `failed`) onto the run issue's
 * metadata on the hub — the janitor's own `metadataPatch` shape, the key
 * stored flat — so `fleet/janitor.mjs` reaps the run's VM by its ordinary
 * rule. One `board:mark` row on `--events` whatever the hub answers. Never
 * fails the run: a missing/unreadable kata.json is one skip row and exit 0;
 * a dark hub is still exit 0.
 */
async function cmdMarkRun (flags) {
  const kataJsonPath = flags['kata-json']
  const run = flags.run
  const state = flags.state
  const adminUrl = flags['admin-url']
  const eventsPath = flags.events

  try {
    const doc = readJsonFile(kataJsonPath)
    if (doc === undefined) {
      appendEventRow(eventsPath, { what: 'run', state, code: null, skipped: 'no kata.json to read' }, 'board:mark')
      return 0
    }
    const projectId = doc.project && doc.project.id
    const runUid = doc.run && doc.run.uid
    if (!Number.isInteger(projectId) || typeof runUid !== 'string' || runUid.length === 0) {
      appendEventRow(eventsPath, { what: 'run', state, code: null, skipped: 'no readable project.id/run.uid' }, 'board:mark')
      return 0
    }

    let code = null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(adminUrl + '/api/v1/projects/' + projectId + '/issues/' + runUid + '/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': run + ':run:mark:' + state },
        body: JSON.stringify({ actor: 'sandbox:' + run, patch: { 'work.state': state } }),
        signal: controller.signal,
      })
      code = res.status
      if (code < 200 || code >= 300) {
        process.stderr.write('board: mark ' + runUid + ' answered ' + code + '\n')
      }
    } catch (error) {
      const detail = error && error.message ? error.message : String(error)
      process.stderr.write('board: mark ' + runUid + ' failed: ' + detail + '\n')
    } finally {
      clearTimeout(timer)
    }
    appendEventRow(eventsPath, { what: 'run', state, code }, 'board:mark')
    return 0
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    process.stderr.write('board: mark-run: unexpected failure — ' + detail + '\n')
    return 0
  }
}

/**
 * `install --version <v> --release-base <U> --home <H>`: fetches
 * `<U>SHA256SUMS` and `<U>kata_<v>_linux_amd64.tar.gz`, checks the archive's
 * bytes against the digest `SHA256SUMS` names beside that asset, extracts
 * the member matching `(^|/)kata$` into a fresh `mkdtemp` directory, and
 * installs it at `<H>/.local/bin/kata` mode 0755 — the fetch, the check, the
 * extraction and the install `board_up` used to do in the boot's own shell
 * (#1222). `--release-base` defaults to the project's own GitHub releases
 * URL for `<v>` when absent. Any miss — a fetch that is not 2xx, no line for
 * the asset, a digest that differs, no `kata` member, a failed extraction or
 * copy — is one stderr line beginning `board: install` and exit 1, nothing
 * on stdout, and nothing written at the install path.
 */
async function cmdInstall (flags) {
  const version = flags.version
  const releaseBase = flags['release-base'] ??
    ('https://github.com/kenn-io/kata/releases/download/v' + version + '/')
  const home = flags.home
  const asset = 'kata_' + version + '_linux_amd64.tar.gz'
  const destPath = home + '/.local/bin/kata'

  const fail = (message) => {
    process.stderr.write('board: install: ' + message + '\n')
    return 1
  }
  const errText = (error) => (error && error.message ? error.message : String(error))

  let sumsText
  try {
    const sumsRes = await fetch(releaseBase + 'SHA256SUMS')
    if (!sumsRes.ok) return fail('fetching SHA256SUMS answered ' + sumsRes.status)
    sumsText = await sumsRes.text()
  } catch (error) {
    return fail('fetching SHA256SUMS failed: ' + errText(error))
  }

  let archiveBuffer
  try {
    const archiveRes = await fetch(releaseBase + asset)
    if (!archiveRes.ok) return fail('fetching ' + asset + ' answered ' + archiveRes.status)
    archiveBuffer = Buffer.from(await archiveRes.arrayBuffer())
  } catch (error) {
    return fail('fetching ' + asset + ' failed: ' + errText(error))
  }

  const sumsLine = sumsText.split('\n').find((line) => {
    const parts = line.trim().split(/\s+/)
    return parts.length >= 2 && parts[1] === asset
  })
  if (!sumsLine) return fail('SHA256SUMS carries no line for ' + asset)
  const expectedDigest = sumsLine.trim().split(/\s+/)[0]
  const actualDigest = crypto.createHash('sha256').update(archiveBuffer).digest('hex')
  if (expectedDigest !== actualDigest) {
    return fail(asset + ' digest ' + actualDigest + ' does not match SHA256SUMS ' + expectedDigest)
  }

  let work
  try {
    work = mkdtempSync(path.join(os.tmpdir(), 'board-kata-'))
  } catch (error) {
    return fail('mktemp failed: ' + errText(error))
  }
  const archivePath = path.join(work, asset)
  try {
    writeFileSync(archivePath, archiveBuffer)
  } catch (error) {
    return fail('writing ' + archivePath + ' failed: ' + errText(error))
  }

  const list = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
  if (list.error || list.status !== 0) return fail('tar -tzf failed: ' + (list.error ? errText(list.error) : (list.stderr || '').trim()))
  const member = (list.stdout || '').split('\n')
    .map((line) => line.trim())
    .find((line) => /(^|\/)kata$/.test(line))
  if (!member) return fail(asset + ' carries no member matching (^|/)kata$')

  const extract = spawnSync('tar', ['-xzf', archivePath, '-C', work], { encoding: 'utf8' })
  if (extract.error || extract.status !== 0) return fail('tar -xzf failed: ' + (extract.error ? errText(extract.error) : (extract.stderr || '').trim()))

  let bytes
  try {
    bytes = readFileSync(path.join(work, member))
  } catch (error) {
    return fail('reading extracted ' + member + ' failed: ' + errText(error))
  }

  try {
    mkdirSync(path.dirname(destPath), { recursive: true })
    writeFileSync(destPath, bytes)
    chmodSync(destPath, 0o755)
  } catch (error) {
    return fail('installing ' + destPath + ' failed: ' + errText(error))
  }

  process.stdout.write(destPath + '\n')
  return 0
}

async function main (argv) {
  const [, , cmd, ...rest] = argv
  const flags = parseFlags(rest)
  if (cmd === 'spoke-config') return cmdSpokeConfig(flags)
  if (cmd === 'wait') return cmdWait(flags)
  if (cmd === 'close-run') return cmdCloseRun(flags)
  if (cmd === 'mark-run') return cmdMarkRun(flags)
  if (cmd === 'install') return cmdInstall(flags)
  process.stderr.write('board: usage: board.mjs spoke-config|wait|close-run|mark-run|install ...\n')
  return 2
}

if (import.meta.main) { main(process.argv).then((code) => { process.exitCode = code }) }
