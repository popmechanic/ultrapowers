/**
 * fleet/tests/test_factory_watch.mjs — the exam for "The observed supervisor
 * tick is skipped under a floor of elapsed time, and the question is told how
 * long the worker has run" (derived; Authorized-by #1212, #1128's comment of
 * 2026-09-21, the operator's decision of 2026-09-21, map #1131 rule 3).
 *
 * `factory/watch.mjs` splits its old two-reading `supervisorTick` in two: the
 * narration half stays `supervisorTick`, unchanged in what it calls and
 * appends, and the observed half becomes a per-dispatch `makeObservedWatch`
 * that holds the reading until the worker has run past a floor
 * (`minElapsedMs`), asks it once, and — for a worker whose stream ends before
 * the floor — writes one `skipped` row instead. This file drives both
 * exports directly, offline, with a recording `read` and a recording
 * `appendEvent`; it never imports `factory/engine.mjs` and never touches
 * disk, network or a child process.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a watch held under the floor calls nothing and appends nothing;
 *       at the floor it asks exactly once, with `observed.elapsed_ms` and
 *       `who` carried through, and appends exactly one row with the exact
 *       keys M1 names; every later turn is `'done'` with no further call or
 *       row; a throwing or null-answering `read` still resolves `'asked'`
 *       with zero rows.
 *   (b) [M2] a watch whose reading was never asked appends exactly the one
 *       skipped row M2 spells out, byte for byte, on `end`, calls `read`
 *       zero times, and a second `end` appends nothing more; a watch whose
 *       reading was asked appends no row with a `skipped` key on `end`.
 *   (c) [M3] `minElapsedMs` of `0`, or left out, is no floor: a `turn` at
 *       `elapsed_ms: 1` asks.
 *   (d) [M4] `observedEnabled` anything but `true` makes every `turn` and
 *       `end` answer `'off'`, whatever `elapsed_ms` — `read` is never called
 *       and no row is ever appended.
 *   (e) [M5] `supervisorTick` alone: one `readSupervisor` call carrying
 *       `transcript` and `who`, one `supervisor` row on a non-null answer,
 *       zero rows on a rejecting `read`; and `observedWork`'s `elapsed_ms` is
 *       `now - startedAt`.
 *
 * Kept hermetic by design: `makeObservedWatch` and `supervisorTick` are pure
 * of `fs`, of any clock and of any policy read — the floor, the facts,
 * `read` and `appendEvent` all arrive as arguments here, exactly as the task
 * requires of the module under test.
 */

import assert from 'node:assert/strict'

import { makeObservedWatch, observedWork, supervisorTick } from '../../factory/watch.mjs'

const LABEL = 'impl:1:0'
const TASK = '1'

// ── a. [M1] held under the floor, asked once at it, done ever after ────────

{
  const rowsA = []
  const callsA = []
  const watchA = makeObservedWatch({
    read: async (name, arg) => { callsA.push({ name, arg }); return { stuck: 0.6 } },
    appendEvent: (row) => rowsA.push(row),
    observedEnabled: true,
    minElapsedMs: 120000,
    label: LABEL,
    task: TASK,
  })

  const turn1 = await watchA.turn({ elapsed_ms: 9400, edits: 0 })
  assert.equal(turn1, 'held', '(a) [M1] turn resolves held under the floor')
  assert.equal(callsA.length, 0, '(a) [M1] held calls read zero times')
  assert.equal(rowsA.length, 0, '(a) [M1] held appends zero rows')

  const observedAtFloor = { elapsed_ms: 120000, edits: 0 }
  const turn2 = await watchA.turn(observedAtFloor)
  assert.equal(turn2, 'asked', '(a) [M1] the first turn at or above the floor resolves asked')
  assert.equal(callsA.length, 1, '(a) [M1] read is called exactly once')
  assert.equal(callsA[0].name, 'readSupervisorObserved', '(a) [M1] the call is by name readSupervisorObserved')
  assert.equal(callsA[0].arg.observed.elapsed_ms, 120000, '(a) [M1] the call carries observed.elapsed_ms')
  assert.deepEqual(callsA[0].arg.who, { task: TASK, label: LABEL }, '(a) [M1] the call carries who: { task, label }')
  assert.equal(rowsA.length, 1, '(a) [M1] exactly one row is appended')
  assert.deepEqual(
    rowsA[0],
    { kind: 'supervisor:observed', task: TASK, label: LABEL, answers: { stuck: 0.6 }, observed: observedAtFloor },
    '(a) [M1] the row carries exactly kind, task, label, answers, observed — no skipped key'
  )

  const turn3 = await watchA.turn({ elapsed_ms: 130000 })
  assert.equal(turn3, 'done', '(a) [M1] every later turn resolves done')
  assert.equal(callsA.length, 1, '(a) [M1] a done turn calls read no further')
  assert.equal(rowsA.length, 1, '(a) [M1] a done turn appends no further row')

  // A read that rejects still counts as asked, and appends no row.
  const rowsReject = []
  const watchReject = makeObservedWatch({
    read: async () => { throw new Error('exam: read rejects on purpose') },
    appendEvent: (row) => rowsReject.push(row),
    observedEnabled: true,
    minElapsedMs: 120000,
    label: LABEL,
    task: TASK,
  })
  const turnReject = await watchReject.turn({ elapsed_ms: 300000 })
  assert.equal(turnReject, 'asked', '(a) [M1] a rejecting read still resolves asked')
  assert.equal(rowsReject.length, 0, '(a) [M1] a rejecting read appends no row')

  // A read that answers null the same.
  const rowsNull = []
  const watchNull = makeObservedWatch({
    read: async () => null,
    appendEvent: (row) => rowsNull.push(row),
    observedEnabled: true,
    minElapsedMs: 120000,
    label: LABEL,
    task: TASK,
  })
  const turnNull = await watchNull.turn({ elapsed_ms: 300000 })
  assert.equal(turnNull, 'asked', '(a) [M1] a null-answering read still resolves asked')
  assert.equal(rowsNull.length, 0, '(a) [M1] a null-answering read appends no row')

  // ── b. [M2] the skipped row, and the end/end and asked/end interactions ──

  const rowsB = []
  const callsB = []
  const watchB = makeObservedWatch({
    read: async (name, arg) => { callsB.push({ name, arg }); return { stuck: 0.6 } },
    appendEvent: (row) => rowsB.push(row),
    observedEnabled: true,
    minElapsedMs: 120000,
    label: LABEL,
    task: TASK,
  })
  await watchB.turn({ elapsed_ms: 9400 })
  const end1 = await watchB.end({ elapsed_ms: 60000 })
  assert.equal(end1, 'skipped', '(b) [M2] end answers skipped when the reading was never asked')
  assert.deepEqual(
    rowsB,
    [{
      kind: 'supervisor:observed', task: TASK, label: LABEL,
      skipped: 'under floor', elapsed_ms: 60000, min_elapsed_ms: 120000,
    }],
    '(b) [M2] the skipped row is exactly this object, no answers key'
  )
  assert.equal(callsB.length, 0, '(b) [M2] a skipped end calls read zero times')

  const end2 = await watchB.end({ elapsed_ms: 61000 })
  assert.equal(end2, 'done', '(b) [M2] a second end answers done')
  assert.equal(rowsB.length, 1, '(b) [M2] a second end appends nothing more')

  // On the watch of leg (a), already asked: end appends no skipped row.
  const end3 = await watchA.end({ elapsed_ms: 200000 })
  assert.equal(end3, 'done', '(b) [M2] end on an already-asked watch answers done')
  assert.ok(
    rowsA.every((row) => !('skipped' in row)),
    '(b) [M2] no row appended by an already-asked watch carries a skipped key'
  )
}

// ── c. [M3] no floor (0 or absent) means the first turn asks ───────────────

{
  const callsZero = []
  const watchZero = makeObservedWatch({
    read: async (name, arg) => { callsZero.push({ name, arg }); return { stuck: 0.6 } },
    appendEvent: () => {},
    observedEnabled: true,
    minElapsedMs: 0,
    label: LABEL,
    task: TASK,
  })
  const turnZero = await watchZero.turn({ elapsed_ms: 1 })
  assert.equal(turnZero, 'asked', '(c) [M3] minElapsedMs: 0 is no floor, turn at elapsed_ms 1 asks')
  assert.equal(callsZero.length, 1, '(c) [M3] read is called once with minElapsedMs: 0')
  assert.equal(callsZero[0].name, 'readSupervisorObserved', '(c) [M3] the call is by name readSupervisorObserved')

  const callsAbsent = []
  const watchAbsent = makeObservedWatch({
    read: async (name, arg) => { callsAbsent.push({ name, arg }); return { stuck: 0.6 } },
    appendEvent: () => {},
    observedEnabled: true,
    label: LABEL,
    task: TASK,
  })
  const turnAbsent = await watchAbsent.turn({ elapsed_ms: 1 })
  assert.equal(turnAbsent, 'asked', '(c) [M3] an absent minElapsedMs is no floor, turn at elapsed_ms 1 asks')
  assert.equal(callsAbsent.length, 1, '(c) [M3] read is called once with minElapsedMs absent')
  assert.equal(callsAbsent[0].name, 'readSupervisorObserved', '(c) [M3] the call is by name readSupervisorObserved')
}

// ── d. [M4] observedEnabled not true: off, off, off, no call, no row ───────

{
  let calledD = false
  const rowsD = []
  const watchD = makeObservedWatch({
    read: async () => { calledD = true; return { stuck: 0.9 } },
    appendEvent: (row) => rowsD.push(row),
    observedEnabled: false,
    minElapsedMs: 120000,
    label: LABEL,
    task: TASK,
  })
  const turnD1 = await watchD.turn({ elapsed_ms: 1 })
  assert.equal(turnD1, 'off', '(d) [M4] turn resolves off when observedEnabled is not true')
  const turnD2 = await watchD.turn({ elapsed_ms: 300000 })
  assert.equal(turnD2, 'off', '(d) [M4] turn stays off however far elapsed_ms runs')
  const endD = await watchD.end({ elapsed_ms: 5 })
  assert.equal(endD, 'off', '(d) [M4] end answers off when observedEnabled is not true')
  assert.equal(calledD, false, '(d) [M4] read is never called while off')
  assert.equal(rowsD.length, 0, '(d) [M4] no row with kind supervisor:observed is ever appended while off')
}

// ── e. [M5] supervisorTick is the narration reading alone; observedWork ────

{
  const rowsE = []
  const callsE = []
  await supervisorTick({
    read: async (name, arg) => { callsE.push({ name, arg }); return { stuck: 0.2 } },
    appendEvent: (row) => rowsE.push(row),
    label: 'exam:1',
    task: TASK,
    transcript: 't',
  })
  assert.equal(callsE.length, 1, '(e) [M5] read is called exactly once')
  assert.equal(callsE[0].name, 'readSupervisor', '(e) [M5] the call is by name readSupervisor')
  assert.equal(callsE[0].arg.transcript, 't', '(e) [M5] the call carries the transcript')
  assert.deepEqual(callsE[0].arg.who, { task: TASK, label: 'exam:1' }, '(e) [M5] the call carries who: { task, label }')
  assert.equal(rowsE.length, 1, '(e) [M5] exactly one row is appended on a non-null answer')
  assert.deepEqual(
    rowsE[0],
    { kind: 'supervisor', task: TASK, label: 'exam:1', answers: { stuck: 0.2 } },
    '(e) [M5] the row carries exactly kind, task, label, answers'
  )

  const rowsEReject = []
  await supervisorTick({
    read: async () => { throw new Error('exam: read rejects on purpose') },
    appendEvent: (row) => rowsEReject.push(row),
    label: 'exam:1',
    task: TASK,
    transcript: 't',
  })
  assert.equal(rowsEReject.length, 0, '(e) [M5] a rejecting read appends zero rows and the tick still resolves')

  const rowsENull = []
  await supervisorTick({
    read: async () => null,
    appendEvent: (row) => rowsENull.push(row),
    label: 'exam:1',
    task: TASK,
    transcript: 't',
  })
  assert.equal(rowsENull.length, 0, '(e) [M5] a null-answering read appends zero rows')

  const ow = observedWork({ tools: [], examRuns: [], taskFiles: [], startedAt: 1000, now: 10400 })
  assert.equal(ow.elapsed_ms, 9400, '(e) [M5] observedWork elapsed_ms is now - startedAt')
}

console.log('ALL TESTS PASSED')
