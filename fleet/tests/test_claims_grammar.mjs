// Claims-v1 readiness pins (#390 cutover, 2026-09-01).
//
// The first fleet coverage of the six-slot grammar's task shape. Two claims:
// 1. composition-unpinned is SILENT for a wave whose tasks carry no Commutes —
//    under claims-v1 the declaration it audits cannot exist, so an undeclared
//    shared write is the shipped fold default, not a judgment call. Without
//    this gate every shared-file claims-v1 wave emits a wall of
//    `composition-unpinned:` rows (remnant survey 2026-09-01, finding B1).
// 2. The legacy behavior is untouched: a wave where ANY task declares Commutes
//    still audits every shared path and names the undeclared writers.
import assert from 'node:assert'
import test from 'node:test'
import { compositionUnpinnedRows } from '../run-engine.mjs'

const t = (id, writes, commutes) => ({ id, writes, commutes })

test('claims-v1 wave (no Commutes anywhere) emits no composition rows', () => {
  const wave = [
    t('1', ['skills/x.py', 'shared/hot.py'], []),
    t('2', ['shared/hot.py'], []),
    t('3', undefined, []), // no writes field — normally reported, silent here too
  ]
  assert.deepEqual(compositionUnpinnedRows(2, wave), [],
    'a Commutes-free wave must not manufacture composition-unpinned judgment calls')
})

test('legacy wave with a Commutes declaration still audits shared writes', () => {
  const wave = [
    t('1', ['routes.py'], ['routes.py']),
    t('2', ['routes.py'], []),
  ]
  const rows = compositionUnpinnedRows(3, wave)
  assert.equal(rows.length, 1)
  assert.match(rows[0], /^composition-unpinned: wave 3 routes\.py/)
  assert.match(rows[0], /undeclared: 2$/,
    'the writer without the declaration is the one named')
})

test('legacy wave: missing writes field is reported per task, never wave-wide', () => {
  const wave = [
    t('1', ['a.py'], ['a.py']),
    t('2', undefined, []),
    t('3', ['a.py'], []),
  ]
  const rows = compositionUnpinnedRows(4, wave)
  assert.ok(rows.some((r) => /task 2 carries no writes field/.test(r)))
  assert.ok(rows.some((r) => /^composition-unpinned: wave 4 a\.py/.test(r)),
    'the declared double-write is still caught alongside the exclusion note')
})

console.log('ALL TESTS PASSED')
