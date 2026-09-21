/**
 * fleet/tests/test_factory_engine_jev.mjs — the exam for "The engine hands the
 * judge a writer onto the run's own record, names the task and worker on
 * every call, takes the union through the judge, and stops asking about a
 * file with no hunk".
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `buildDeps(args, overrides)` hands `makeJudge` an `emit` function:
 *        calling it with a row appends exactly one line to
 *        `<args.runDir>/events.jsonl` — the JSON of `{ ts, ...row }`, `ts` an
 *        ISO-8601 string, newline-terminated — and leaves every earlier line
 *        of that file in place.
 *   M2 — that `emit` never throws: with `args.runDir` naming a directory that
 *        does not exist, calling it returns normally.
 *   M3 — `runEngine` truncates `events.jsonl` exactly once, at its start, and
 *        `runRefold` never truncates it: `factory/engine.mjs` carries the
 *        text `fs.writeFileSync(eventsPath, '')` exactly once.
 *   M4 — every `read('<reader>', …)` call outside the worker-stream
 *        supervisor tick passes `who: { task, label }`. Proven by the task's
 *        own Python Proof line (a grep-shaped check over the file's own
 *        text), not by this file — a call-by-call semantic check of eight
 *        call sites is exactly what that Proof line already does, byte for
 *        byte, and repeating it here would prove nothing an import and a
 *        call could add.
 *   M5 — the union reader is `deps.readUnion` when injected, else the
 *        judge's own `readUnion`, else `buildReadUnion` as today. Proven by
 *        the task's own `grep -q "judge.readUnion" factory/engine.mjs` Proof
 *        line, for the same reason as M4: the fallback chain is read off the
 *        source text, not exercised through a live fold here.
 *   M6 — `factory/hunks.mjs` exports `filesShown(perFile, literals, cap)`:
 *        an object keyed `f0`, `f1`, … over, in `perFile`'s own key order,
 *        only the files whose `hunksCarrying(perFile[name], literals, cap)`
 *        still carries a line beginning `@@ `, each value that trimmed
 *        text. (`measure` handing `readLanding` this object as `files` with
 *        `cap: 6000` is proven by the task's own `grep -q "filesShown"
 *        factory/engine.mjs` Proof line.)
 *
 * COVERED: none named in this brief.
 *
 * The legs, each naming the Machine clause it comes from and matching the
 * task's own "Legs:" bullet verbatim:
 *
 *   (a) [M1] `buildDeps({ runDir: dir }, ...)` hands its stub `makeJudge` an
 *       `emit` function; calling it appends exactly one line to
 *       `events.jsonl`, the earlier line untouched, the new line parsing to
 *       `{ kind, site, task }` equal to what was passed plus a `ts` that
 *       round-trips through `new Date(ts).toISOString()`.
 *   (b) [M2] the same `buildDeps`, `runDir` a path that does not exist:
 *       calling `emit` returns without throwing.
 *   (c) [M3] `factory/engine.mjs`'s own text carries
 *       `fs.writeFileSync(eventsPath, '')` exactly once.
 *   (d) [M6] `filesShown` drops a file whose trimmed diff is too large to
 *       carry a `@@ ` line, renumbers the survivors `f0`, `f1`, … in
 *       `perFile`'s own key order, and leaves every file inside the cap
 *       untouched when nothing needs dropping.
 *
 * What this exam assumes about the code under test: that `buildDeps` reads
 * `args.runDir` the same way `runEngine` and `runRefold` already do —
 * `path.resolve(String(args.runDir ?? '.'))` joined with `events.jsonl` — so
 * handing it `{ runDir: dir }` with `dir` a real directory (leg a) or a path
 * under a real directory that was never created (leg b) exercises exactly
 * the write the Machine clause describes. `hunksCarrying` itself is not
 * under test here (it is the existing export the task's own text quotes
 * `filesShown` as calling); this exam only builds two per-file diffs sized
 * so the one already-proven behavior of `hunksCarrying` yields a text
 * without a `@@ ` line for the oversized file (300 chars over its own
 * hunk's header, well past `cap: 6000`) and a text unchanged for the small
 * ones — the shape `filesShown` itself has to sort on.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildDeps } from '../../factory/engine.mjs'

/** The deliverable this task adds to `factory/hunks.mjs`, imported
 *  dynamically: a tree without it still names leg (d) as the failing
 *  assertion below, rather than dying at link time with no leg named at
 *  all — the same shape `fleet/tests/test_jev_client.mjs` uses for a whole
 *  module that does not exist yet; here only the one named export is new. */
let hunksMod = null
let hunksImportError = null
try {
  hunksMod = await import('../../factory/hunks.mjs')
} catch (error) {
  hunksImportError = error
}
assert.equal(hunksImportError, null,
  '(d) [M6] factory/hunks.mjs is importable. Got: ' +
  String(hunksImportError && (hunksImportError.message || hunksImportError)))
const filesShown = hunksMod && hunksMod.filesShown

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] buildDeps hands makeJudge an `emit`; calling it appends one line
// ══════════════════════════════════════════════════════════════════════════

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-jev-a-'))
  const firstLine = '{"kind":"dispatch:start"}'
  fs.writeFileSync(path.join(dir, 'events.jsonl'), firstLine + '\n')

  let captured = null
  buildDeps({ runDir: dir }, {
    makeJudge: (opts) => { captured = opts; return {} },
    makeJevClient: () => ({ ask: async () => null }),
    log: () => {},
  })

  assert.equal(typeof captured, 'object',
    '(a) [M1] buildDeps calls makeJudge at all, so its own opts were captured; got ' + JSON.stringify(typeof captured))
  assert.equal(typeof captured.emit, 'function',
    '(a) [M1] buildDeps hands makeJudge an `emit` function; got ' + JSON.stringify(typeof (captured && captured.emit)))

  captured.emit({ kind: 'jev', site: 'task', task: '7' })

  const lines = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.length > 0)
  assert.equal(lines.length, 2,
    '(a) [M1] emit appends exactly one line and leaves the earlier line in place; got ' + lines.length + ' line(s): ' + JSON.stringify(lines))
  assert.equal(lines[0], firstLine,
    '(a) [M1] the earlier line of events.jsonl is left unchanged; got ' + JSON.stringify(lines[0]))

  let row
  try {
    row = JSON.parse(lines[1])
  } catch (e) {
    assert.fail('(a) [M1] the appended line parses as JSON; got ' + JSON.stringify(lines[1]) + ' (' + e.message + ')')
  }
  const { ts, ...rest } = row
  assert.deepEqual(rest, { kind: 'jev', site: 'task', task: '7' },
    '(a) [M1] the appended row is the JSON of `{ ts, ...row }` — every key of the row handed to emit, unchanged; got ' + JSON.stringify(rest))
  assert.equal(typeof ts, 'string',
    '(a) [M1] the appended row carries a `ts` string; got ' + JSON.stringify(ts))
  assert.equal(new Date(ts).toISOString(), ts,
    '(a) [M1] `ts` is an ISO-8601 string (`new Date(ts).toISOString() === ts`); got ' + JSON.stringify(ts))

  fs.rmSync(dir, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] emit never throws, even against a runDir that does not exist
// ══════════════════════════════════════════════════════════════════════════

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-jev-b-'))
  const missing = path.join(dir, 'does', 'not', 'exist')

  let captured = null
  buildDeps({ runDir: missing }, {
    makeJudge: (opts) => { captured = opts; return {} },
    makeJevClient: () => ({ ask: async () => null }),
    log: () => {},
  })

  assert.equal(typeof captured.emit, 'function',
    '(b) [M2] buildDeps still hands makeJudge an `emit` function when runDir does not exist; got ' + JSON.stringify(typeof (captured && captured.emit)))
  assert.doesNotThrow(() => captured.emit({ kind: 'jev' }),
    '(b) [M2] calling emit with args.runDir naming a directory that does not exist returns normally rather than throwing')

  fs.rmSync(dir, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] events.jsonl is truncated exactly once in factory/engine.mjs
// ══════════════════════════════════════════════════════════════════════════

{
  const enginePath = new URL('../../factory/engine.mjs', import.meta.url)
  const src = fs.readFileSync(enginePath, 'utf8')
  const needle = "fs.writeFileSync(eventsPath, '')"
  const occurrences = src.split(needle).length - 1
  assert.equal(occurrences, 1,
    '(c) [M3] factory/engine.mjs carries the text `fs.writeFileSync(eventsPath, \'\')` exactly once (runEngine truncates once, runRefold never does); got ' + occurrences + ' occurrence(s)')
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M6] filesShown(perFile, literals, cap)
// ══════════════════════════════════════════════════════════════════════════

assert.equal(typeof filesShown, 'function',
  '(d) [M6] factory/hunks.mjs exports filesShown(perFile, literals, cap); got ' + JSON.stringify(typeof filesShown))

{
  // One diff text per name, exactly `len` characters long, carrying exactly
  // one hunk (one line beginning `@@ `) ahead of a filler body.
  const diffOfLen = (name, len) => {
    const head = '--- a/' + name + '\n+++ b/' + name + '\n@@ -1,1 +1,1 @@\n'
    const fill = 'x'.repeat(Math.max(0, len - head.length))
    return (head + fill).slice(0, len)
  }

  // a.mjs: one hunk, 7000 characters — over the 6000 cap, so
  // `hunksCarrying` answers the bare "(N hunks omitted)" string, which
  // carries no `@@ ` line at all.
  const aText = diffOfLen('a.mjs', 7000)
  // b.mjs and c.mjs: one hunk each, well under the cap, so `hunksCarrying`
  // answers each unchanged — still carrying its own `@@ ` line.
  const bText = diffOfLen('b.mjs', 300)
  const cText = diffOfLen('c.mjs', 200)
  const perFile = { 'a.mjs': aText, 'b.mjs': bText, 'c.mjs': cText }

  const shown = filesShown(perFile, [], 6000)
  assert.deepEqual(Object.keys(shown), ['f0', 'f1'],
    '(d) [M6] filesShown keys only the files whose hunksCarrying still carries a `@@ ` line, in perFile\'s own key order — a.mjs (over the cap) is dropped, b.mjs and c.mjs survive; got ' + JSON.stringify(Object.keys(shown)))
  assert.equal(shown.f0, bText,
    '(d) [M6] f0 is b.mjs\'s own (unchanged) text')
  assert.equal(shown.f1, cText,
    '(d) [M6] f1 is c.mjs\'s own (unchanged) text')
  for (const [key, value] of Object.entries(shown)) {
    assert.ok(!String(value).includes('hunks omitted'),
      '(d) [M6] no value answered by filesShown contains "hunks omitted"; ' + key + ' does: ' + JSON.stringify(value).slice(0, 80))
  }

  // Every file inside the cap: one key per file, in order, each value its
  // own text, unchanged — nothing dropped, nothing renumbered past its own
  // position.
  const perFileSmall = { 'x.mjs': diffOfLen('x.mjs', 500), 'y.mjs': diffOfLen('y.mjs', 400) }
  const shownSmall = filesShown(perFileSmall, [], 6000)
  assert.deepEqual(Object.keys(shownSmall), ['f0', 'f1'],
    '(d) [M6] with every file inside the cap, filesShown answers one key per file, in order; got ' + JSON.stringify(Object.keys(shownSmall)))
  assert.deepEqual(shownSmall, { f0: perFileSmall['x.mjs'], f1: perFileSmall['y.mjs'] },
    '(d) [M6] each value is that file\'s own text, unchanged, when nothing needs dropping')
}

process.stdout.write('ok\n')
