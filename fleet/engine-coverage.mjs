// fleet/engine-coverage.mjs — which of the lines a run changed a sim actually ran.
//
// A reading, never a gate (#992 desired state 1). The engine's own suite says
// the sims passed; it does not say they went anywhere near the lines the run
// edited. This module answers that one question and answers nothing else: it
// diffs a file between two commits, runs the named sims under V8's own
// coverage writer, and reports which of the changed lines carried a count
// above zero in at least one of them. Nothing here reads a verdict, and no
// caller is expected to branch on the answer.
//
// No dependency is added for it. V8 writes the profile itself when
// `NODE_V8_COVERAGE` names a directory, and the reader below is the c8 rule in
// forty lines: `result[].functions[].ranges[]` of `{ startOffset, endOffset,
// count }`, a function's ranges listed outermost first, and the count at an
// offset the count of the INNERMOST range containing it. The offsets are
// JavaScript string indices, not byte offsets — `fleet/run-engine.mjs` carries
// em dashes and box-drawing characters, so the two differ by hundreds of
// positions and reading them as bytes would attribute every count to the
// wrong line.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Run a command to completion. Resolves, never rejects — callers branch on
 *  `code`, the same shape the engine's own exec seam answers with. */
const run = (cmd, argv, opts = {}) => new Promise((resolve) => {
  execFile(cmd, argv, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
    resolve({ code, stdout: stdout || '', stderr: stderr || '' })
  })
})

/** The new-side line numbers a `git diff -U0` adds or modifies, ascending.
 *
 *  Hunk headers read `@@ -a[,b] +c[,d] @@`. The new-side run is `c … c+d-1`,
 *  with an omitted `d` meaning 1; a `d` of 0 is a PURE DELETION and contributes
 *  no new-side line at all, which is the whole reason a deletion-only diff
 *  reads as no change rather than as an empty reading. */
export function changedLinesOf(diff) {
  const lines = new Set()
  for (const line of String(diff).split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!m) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < count; i++) lines.add(start + i)
  }
  return [...lines].sort((a, b) => a - b)
}

/** The string index each 1-based line of `text` begins at. Indices into the
 *  JavaScript string, which is what V8's offsets are. */
function lineStartOffsets(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** The count at `offset` under one script entry's ranges: the innermost range
 *  containing it, which is the narrowest — a function's own ranges arrive
 *  outermost first, and a nested function's ranges are narrower still. `0` when
 *  no range contains the offset (nothing was profiled there). */
function countAtOffset(ranges, offset) {
  let best = null
  for (const r of ranges) {
    if (!(offset >= r.startOffset && offset < r.endOffset)) continue
    const span = r.endOffset - r.startOffset
    if (best === null || span <= best.span) best = { span, count: r.count }
  }
  return best === null ? 0 : best.count
}

/** Every script entry of every coverage file under `dir` whose `url` is one of
 *  `urls`. Exact URL equality and nothing looser: a sim that lays a copy of the
 *  same file into a scratch tree of its own profiles that copy too, and the
 *  copy's counts are not the real file's. Unreadable or half-written JSON is
 *  skipped rather than thrown — this is a reading. */
function matchingEntries(dir, urls) {
  const wanted = new Set(urls)
  const entries = []
  let names = []
  try { names = fs.readdirSync(dir) } catch { return entries }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    let parsed = null
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) } catch { continue }
    for (const script of (parsed && Array.isArray(parsed.result) ? parsed.result : [])) {
      if (!script || !wanted.has(script.url)) continue
      const ranges = []
      for (const fn of (Array.isArray(script.functions) ? script.functions : [])) {
        for (const r of (fn && Array.isArray(fn.ranges) ? fn.ranges : [])) {
          if (r && Number.isFinite(r.startOffset) && Number.isFinite(r.endOffset)) ranges.push(r)
        }
      }
      entries.push(ranges)
    }
  }
  return entries
}

/** Run `thunks` with at most `limit` in flight, answers in the order given. */
async function pooled(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  }))
  return out
}

/** One sim, run as `node <tree>/<sim>` with cwd `tree` and the inherited
 *  environment plus a `NODE_V8_COVERAGE` directory of its own under the OS temp
 *  dir. A non-zero exit is recorded and its coverage read all the same: a sim
 *  that reached a line and then failed still reached it. */
function runSim(tree, sim) {
  const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-coverage-'))
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(tree, sim)], {
      cwd: tree,
      env: { ...process.env, NODE_V8_COVERAGE: covDir },
      stdio: 'ignore',
    })
    const done = (exit) => resolve({ sim, exit, ms: Date.now() - started, covDir })
    child.on('error', () => done(-1))
    child.on('close', (code, signal) => done(code === null ? (signal ? -1 : 0) : code))
  })
}

/**
 * The reading.
 *
 * `null` when `git diff -U0 <base> <head> -- <file>` in `tree` adds or modifies
 * no line — a head equal to base, and a head that only deletes lines, both
 * answer `null` rather than a reading with an empty `changed`.
 *
 * Otherwise `{ file, base, head, changed, reached, unreached, sims }`:
 * `changed` the ascending new-side line numbers of every added or modified
 * line; `sims` one `{ sim, exit, ms, reached }` per entry of the `sims`
 * argument, in the order given, at most `width` running at once; `reached` the
 * ascending subset of `changed` some sim counted above zero; `unreached` the
 * rest, ascending.
 */
export async function engineCoverage({ tree, base, head, file, sims = [], width = 1 } = {}) {
  const diff = await run('git', ['diff', '-U0', String(base), String(head), '--', file],
    { cwd: tree })
  if (diff.code !== 0) {
    throw new Error('engine-coverage: git diff exited ' + diff.code + ' in ' + tree + ': ' +
      (diff.stderr || diff.stdout).slice(-400))
  }
  const changed = changedLinesOf(diff.stdout)
  if (changed.length === 0) return null

  const abs = path.join(tree, file)
  // The URLs a count may come from: the file's own, and its realpath — a temp
  // root reached through a symlinked `/tmp` is still this file, while a copy at
  // another path resolves elsewhere and is still excluded.
  const urls = new Set([pathToFileURL(abs).href])
  try { urls.add(pathToFileURL(fs.realpathSync(abs)).href) } catch { /* unresolvable */ }

  let text = ''
  try { text = fs.readFileSync(abs, 'utf8') } catch { /* nothing to attribute */ }
  const starts = lineStartOffsets(text)

  const lanes = (Number.isInteger(width) && width > 0) ? width : 1
  const runs = await pooled(sims.map(String), lanes, (sim) => runSim(tree, sim))

  const reachedAll = new Set()
  const simRows = runs.map(({ sim, exit, ms, covDir }) => {
    const entries = matchingEntries(covDir, urls)
    const reached = changed.filter((line) => {
      // A line's count is the count at its FIRST character. A line past the end
      // of the file has no offset and no count.
      const offset = starts[line - 1]
      if (offset === undefined) return false
      return entries.some((ranges) => countAtOffset(ranges, offset) > 0)
    })
    for (const line of reached) reachedAll.add(line)
    return { sim, exit, ms, reached }
  })

  const reached = changed.filter((line) => reachedAll.has(line))
  return {
    file,
    base: String(base),
    head: String(head),
    changed,
    reached,
    unreached: changed.filter((line) => !reachedAll.has(line)),
    sims: simRows,
  }
}

export default engineCoverage
