/**
 * fleet/tests/test_factory_watch.mjs — the exam for *the supervisor's four
 * questions, asked a second time over what the worker actually did* —
 * `factory/watch.mjs`'s `observedWork` (the facts) and `supervisorTick` (the
 * two-reading dispatch), written whole at the path the Proof names.
 *
 * This file is the Proof's `Test:`. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 * `factory/engine.mjs`, `factory/policy.json` and `factory/judge.mjs` are
 * modified or consumed by this task but are not this exam's subject — the
 * Proof checks the policy cell by `python3 -c` and the engine's wiring by
 * `grep`, both outside this file, so this exam measures `factory/watch.mjs`
 * alone: its exports, `observedWork`'s pure arithmetic, and `supervisorTick`'s
 * two calls to an injected `read`.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `observedWork({ tools, examRuns, taskFiles, startedAt, now })`
 *        returns exactly the nine named keys, computed as the clause says.
 *   M2 — the no-edit case (`edits`, `ms_since_last_edit`, `paths_touched`,
 *        `outside_files`) and the fifteen-tool `last_tools` window.
 *   M4 — `supervisorTick` calls `readSupervisor` always, `readSupervisorObserved`
 *        only when `observedEnabled`, appends the right rows on non-null
 *        answers and none on null, and never rejects even when `read` itself
 *        rejects.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the six-tool, one-exam-run reading: all nine keys, by value.
 *   (b) [M2] the no-edit reading, and the fifteen-tool `last_tools` window.
 *   (c) [M4] `observedEnabled: false`: one call, one row.
 *   (d) [M4] `observedEnabled: true`: two calls, two rows, in order — and a
 *       rejecting `readSupervisor` alongside a null `readSupervisorObserved`
 *       still resolves with nothing appended.
 *
 * Nothing here touches a filesystem, a clone, a real judge or the engine:
 * `observedWork` is exercised on hand-built `tools`/`examRuns` arrays, and
 * `supervisorTick` is exercised against a recording `read` and a recording
 * `appendEvent`, exactly the two arguments M4 says it takes for those seams.
 */
import assert from 'node:assert/strict'

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion of leg (a) rather than dying at load with no
 *  leg named at all. */
let watch = null
let watchImportError = null
try {
  watch = await import('../../factory/watch.mjs')
} catch (error) {
  watchImportError = error
}
assert.ok(watchImportError === null,
  '(a) [M1] `factory/watch.mjs` is importable — the module this task creates. Got: ' +
  String(watchImportError && (watchImportError.message || watchImportError)))
assert.equal(typeof watch.observedWork, 'function',
  '(a) [M1] it exports `observedWork({ tools, examRuns, taskFiles, startedAt, now })`; got ' +
  JSON.stringify(typeof watch.observedWork))
assert.equal(typeof watch.supervisorTick, 'function',
  '(c) [M4] it also exports `supervisorTick(...)`; got ' + JSON.stringify(typeof watch.supervisorTick))

const ALL_KEYS = ['elapsed_ms', 'ms_since_last_edit', 'edits', 'tool_counts', 'paths_touched',
  'outside_files', 'exam_runs', 'repeats', 'last_tools']

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the six-tool, one-exam-run reading: exactly the nine keys, by value
// ══════════════════════════════════════════════════════════════════════════

{
  const tools = [
    { at: 1000, tool: 'Read', target: '/c/a.mjs' },
    { at: 2000, tool: 'Read', target: '/c/a.mjs' },
    { at: 3000, tool: 'Edit', target: '/c/factory/x.mjs' },
    { at: 4000, tool: 'Bash', target: 'node t.mjs' },
    { at: 5000, tool: 'Write', target: '/c/notes/y.md' },
    { at: 6000, tool: 'Read', target: '/c/a.mjs' },
  ]
  const result = watch.observedWork({
    tools,
    examRuns: [{ via: 'run_exam', exit: 1 }],
    taskFiles: ['factory/x.mjs'],
    startedAt: 500,
    now: 9000,
  })

  assert.deepEqual(Object.keys(result).sort(), [...ALL_KEYS].sort(),
    '(a) [M1] the result carries exactly the keys ' + JSON.stringify(ALL_KEYS.sort()) +
    '; got ' + JSON.stringify(Object.keys(result).sort()))

  assert.equal(result.elapsed_ms, 8500,
    '(a) [M1] `elapsed_ms` is `now - startedAt` (9000 - 500); got ' + JSON.stringify(result.elapsed_ms))
  assert.equal(result.ms_since_last_edit, 4000,
    '(a) [M1] `ms_since_last_edit` is `now` minus the last edit\'s `at` (the Write at 5000, ' +
    '9000 - 5000); got ' + JSON.stringify(result.ms_since_last_edit))
  assert.equal(result.edits, 2,
    '(a) [M1] `edits` counts `Edit`/`Write`/`NotebookEdit` tools — one Edit, one Write; got ' +
    JSON.stringify(result.edits))
  assert.deepEqual(result.tool_counts, { Read: 3, Edit: 1, Bash: 1, Write: 1 },
    '(a) [M1] `tool_counts` maps each tool name to its count; got ' + JSON.stringify(result.tool_counts))
  assert.deepEqual(result.paths_touched, ['/c/factory/x.mjs', '/c/notes/y.md'],
    '(a) [M1] `paths_touched` is the distinct edit targets in first-seen order; got ' +
    JSON.stringify(result.paths_touched))
  assert.deepEqual(result.outside_files, ['/c/notes/y.md'],
    '(a) [M1] `outside_files` is the touched paths that neither equal a `taskFiles` entry ' +
    'nor end with `/` plus one — `/c/factory/x.mjs` ends with `/factory/x.mjs` and is IN ' +
    'scope, `/c/notes/y.md` is not; got ' + JSON.stringify(result.outside_files))
  assert.deepEqual(result.exam_runs, [{ via: 'run_exam', exit: 1 }],
    '(a) [M1] `exam_runs` is `examRuns` as given; got ' + JSON.stringify(result.exam_runs))
  assert.equal(result.repeats, 3,
    '(a) [M1] `repeats` is the highest count of one identical (tool, target) pair — Read on ' +
    '`/c/a.mjs` three times; got ' + JSON.stringify(result.repeats))
  assert.equal(result.last_tools.length, 6,
    '(a) [M1] `last_tools` is the last twelve `{ tool, target }` in order — with only six ' +
    'tools given, all six; got length ' + JSON.stringify(result.last_tools.length))
  assert.deepEqual(result.last_tools[0], { tool: 'Read', target: '/c/a.mjs' },
    '(a) [M1] whose first entry is the first tool given (fewer than twelve exist); got ' +
    JSON.stringify(result.last_tools[0]))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] no edit among `tools`; and the fifteen-tool `last_tools` window
// ══════════════════════════════════════════════════════════════════════════

{
  // The same call as leg (a), keeping only the three `Read` tools and the `Bash` tool.
  const tools = [
    { at: 1000, tool: 'Read', target: '/c/a.mjs' },
    { at: 2000, tool: 'Read', target: '/c/a.mjs' },
    { at: 4000, tool: 'Bash', target: 'node t.mjs' },
    { at: 6000, tool: 'Read', target: '/c/a.mjs' },
  ]
  const result = watch.observedWork({
    tools,
    examRuns: [{ via: 'run_exam', exit: 1 }],
    taskFiles: ['factory/x.mjs'],
    startedAt: 500,
    now: 9000,
  })
  assert.equal(result.edits, 0,
    '(b) [M2] with no edit among `tools`, `edits` is 0; got ' + JSON.stringify(result.edits))
  assert.equal(result.ms_since_last_edit, null,
    '(b) [M2] and `ms_since_last_edit` is `null`; got ' + JSON.stringify(result.ms_since_last_edit))
  assert.deepEqual(result.paths_touched, [],
    '(b) [M2] and `paths_touched` is empty; got ' + JSON.stringify(result.paths_touched))
  assert.deepEqual(result.outside_files, [],
    '(b) [M2] and `outside_files` is empty; got ' + JSON.stringify(result.outside_files))
}

{
  const tools = []
  for (let i = 1; i <= 15; i++) tools.push({ at: i, tool: 'Read', target: 't' + i })
  const result = watch.observedWork({
    tools, examRuns: [], taskFiles: [], startedAt: 0, now: 100,
  })
  assert.equal(result.last_tools.length, 12,
    '(b) [M2] fifteen tools give a `last_tools` of length twelve; got ' +
    JSON.stringify(result.last_tools.length))
  assert.equal(result.last_tools[0].target, 't4',
    '(b) [M2] whose first entry is the fourth tool (tools 4 through 15); got ' +
    JSON.stringify(result.last_tools[0]))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M4] `observedEnabled: false` — one call to `read`, one row appended
// ══════════════════════════════════════════════════════════════════════════

/** A `read(name, arg)` that records every call's name and argument, in order,
 *  and answers `answerFor(name, arg)` — which may return a promise, reject,
 *  or resolve `null`. */
const recordingRead = (answerFor) => {
  const calls = []
  const read = async (name, arg) => {
    calls.push({ name, arg })
    return answerFor(name, arg)
  }
  return { calls, read }
}

{
  const { calls, read } = recordingRead(() => ({ stuck: 0.2 }))
  const rows = []
  const appendEvent = (row) => rows.push(row)

  await watch.supervisorTick({
    read, appendEvent, observedEnabled: false,
    label: 'exam:1', task: '1', transcript: 'x', observed: { edits: 0 },
  })

  assert.deepEqual(calls.map((c) => c.name), ['readSupervisor'],
    '(c) [M4] with `observedEnabled: false`, exactly one reader is called — `readSupervisor` ' +
    '— and no second call is made; got ' + JSON.stringify(calls.map((c) => c.name)))
  assert.deepEqual(Object.keys(calls[0].arg).sort(), ['label', 'task', 'transcript', 'who'],
    '(c) [M4] `readSupervisor` is called with `{ label, task, transcript, who }`; got ' +
    JSON.stringify(Object.keys(calls[0].arg).sort()))
  assert.deepEqual(calls[0].arg.who, { task: '1', label: 'exam:1' },
    '(c) [M4] whose `who` names the row\'s task and worker; got ' + JSON.stringify(calls[0].arg.who))
  assert.deepEqual(rows, [{ kind: 'supervisor', task: '1', label: 'exam:1', answers: { stuck: 0.2 } }],
    '(c) [M4] on a non-null answer it appends exactly one `supervisor` row; got ' + JSON.stringify(rows))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] `observedEnabled: true` — two calls, two rows, in order; and a
//     rejecting `readSupervisor` beside a null `readSupervisorObserved`
//     still resolves, with nothing appended
// ══════════════════════════════════════════════════════════════════════════

{
  const { calls, read } = recordingRead(() => ({ stuck: 0.2 }))
  const rows = []
  const appendEvent = (row) => rows.push(row)

  await watch.supervisorTick({
    read, appendEvent, observedEnabled: true,
    label: 'exam:1', task: '1', transcript: 'x', observed: { edits: 0 },
  })

  assert.deepEqual(calls.map((c) => c.name), ['readSupervisor', 'readSupervisorObserved'],
    '(d) [M4] with `observedEnabled: true`, both readers are called, `readSupervisor` first ' +
    'then `readSupervisorObserved`; got ' + JSON.stringify(calls.map((c) => c.name)))
  assert.deepEqual(calls[1].arg, { observed: { edits: 0 }, who: { task: '1', label: 'exam:1' } },
    '(d) [M4] `readSupervisorObserved` is called with `{ observed, who }`; got ' +
    JSON.stringify(calls[1].arg))
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['supervisor', 'supervisor:observed'],
    '(d) [M4] the appended rows\' kinds, sorted, are `supervisor` and `supervisor:observed`; got ' +
    JSON.stringify(rows.map((r) => r.kind).sort()))
  assert.equal(rows.length, 2,
    '(d) [M4] exactly two rows are appended — one per call; got ' + JSON.stringify(rows))
  assert.deepEqual(rows[1], {
    kind: 'supervisor:observed', task: '1', label: 'exam:1',
    answers: { stuck: 0.2 }, observed: { edits: 0 },
  }, '(d) [M4] the second row carries the observed-reading kind, the same task/label, the ' +
    'answer, and the `observed` facts it was asked over; got ' + JSON.stringify(rows[1]))
}

{
  // A `read` that rejects for `readSupervisor` and answers `null` for
  // `readSupervisorObserved`: `supervisorTick` still resolves (never rejects)
  // and appends no row at all.
  const rows = []
  const appendEvent = (row) => rows.push(row)
  const read = async (name) => {
    if (name === 'readSupervisor') throw new Error('boom')
    return null
  }

  let threw = null
  try {
    await watch.supervisorTick({
      read, appendEvent, observedEnabled: true,
      label: 'exam:1', task: '1', transcript: 'x', observed: { edits: 0 },
    })
  } catch (error) {
    threw = error
  }
  assert.equal(threw, null,
    '(d) [M4] `supervisorTick` never rejects, even when `read` itself rejects. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.deepEqual(rows, [],
    '(d) [M4] a rejecting `readSupervisor` and a null `readSupervisorObserved` append no row ' +
    'at all; got ' + JSON.stringify(rows))
}

console.log('ALL TESTS PASSED')
