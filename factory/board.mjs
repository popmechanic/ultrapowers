// factory/board.mjs — the one module that talks to Kata, and it never fails
// a run (CLAUDE.md "Hub writes are never the run's failure").

// ═══════════════════════════════════════════════════════════════════════
// The CLI. `factory/boot.sh` used to talk to
// Kata itself; the run's writes to the hub now live here, the one module
// that talks to Kata, so the boot only ever calls it (#1222, map #1131
// rule 6). There is no spoke any more (#1390): `close-run` and `mark-run`
// write to the hub's admin host directly, and each row they record carries
// the hub's receipt — a row without one is a write the hub did not
// confirm. Every subcommand complains on stderr and never throws —
// CLAUDE.md: "board.mjs is the only module that talks to Kata and never
// fails a run".
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

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

/** The hub's answer body as JSON, or `undefined` when it is empty or not
 *  JSON (a 500 page, a proxy's HTML) — never throws. */
async function readAnswer (res) {
  try {
    return JSON.parse(await res.text())
  } catch {
    return undefined
  }
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
 *  injects the hub's bearer). Resolves to `{ code, event_id, event_at }`:
 *  the HTTP status (`null` on a connection failure) and the close's
 *  receipt, `event.id`/`event.created_at` off a 2xx answer (each `null`
 *  when the answer does not carry it); never throws. A 20s timeout. */
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
      return { code: res.status, event_id: null, event_at: null }
    }
    const answer = await readAnswer(res)
    const event = answer && answer.event
    return {
      code: res.status,
      event_id: event && event.id !== undefined ? event.id : null,
      event_at: event && event.created_at !== undefined ? event.created_at : null,
    }
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    process.stderr.write('board: close ' + uid + ' failed: ' + detail + '\n')
    return { code: null, event_id: null, event_at: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `close-run`: closes the run's task issues, then the run issue itself, on
 * the hub — task order first (`409 parent_has_open_children` otherwise),
 * each recorded as one `board:close` row on `--events` whatever the hub
 * answers, carrying the close's receipt (`event_id`, `event_at`; null when
 * the hub did not confirm it). Never fails the run (CLAUDE.md): a
 * missing/unreadable kata.json is one skip row and exit 0; a hub that
 * answers 500, or not at all, is still exit 0 with the row's `code` set
 * from what came back.
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
      const receipt = await closeIssue({
        adminUrl,
        projectId,
        uid,
        key: runUid + ':task:' + id + ':close',
        message: run + ' task ' + id + " done: adopted green in the run's pull request — " + pr,
        evidence,
        run,
      })
      appendEventRow(eventsPath, { what: 'task ' + id, ...receipt })
    }

    const runReceipt = await closeIssue({
      adminUrl,
      projectId,
      uid: runUid,
      key: runUid + ':run:close',
      message: run + ' done: ' + title + ' — ' + pr,
      evidence,
      run,
    })
    appendEventRow(eventsPath, { what: 'run', ...runReceipt })
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
 * rule. One `board:mark` row on `--events` whatever the hub answers,
 * carrying the issue's new `revision` (null when the hub did not confirm
 * the write). Never
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
    let revision = null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(adminUrl + '/api/v1/projects/' + projectId + '/issues/' + runUid + '/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': runUid + ':run:mark:' + state },
        body: JSON.stringify({ actor: 'sandbox:' + run, patch: { 'work.state': state } }),
        signal: controller.signal,
      })
      code = res.status
      if (code < 200 || code >= 300) {
        process.stderr.write('board: mark ' + runUid + ' answered ' + code + '\n')
      } else {
        const answer = await readAnswer(res)
        const issue = answer && answer.issue
        if (issue && issue.revision !== undefined) revision = issue.revision
      }
    } catch (error) {
      const detail = error && error.message ? error.message : String(error)
      process.stderr.write('board: mark ' + runUid + ' failed: ' + detail + '\n')
    } finally {
      clearTimeout(timer)
    }
    appendEventRow(eventsPath, { what: 'run', state, code, revision }, 'board:mark')
    return 0
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    process.stderr.write('board: mark-run: unexpected failure — ' + detail + '\n')
    return 0
  }
}

async function main (argv) {
  const [, , cmd, ...rest] = argv
  const flags = parseFlags(rest)
  if (cmd === 'close-run') return cmdCloseRun(flags)
  if (cmd === 'mark-run') return cmdMarkRun(flags)
  process.stderr.write('board: usage: board.mjs close-run|mark-run ...\n')
  return 2
}

if (import.meta.main) { main(process.argv).then((code) => { process.exitCode = code }) }
