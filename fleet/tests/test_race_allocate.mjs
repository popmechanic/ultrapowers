// fleet/tests/test_race_allocate.mjs — the allocator is what keeps k concurrent
// attempts from tripping over each other: one name, one port, one db-dir and
// one repo-dir apiece. Per-run repo-dirs are load-bearing, not tidiness —
// driveOne resolves its base as HEAD of its own repoDir, so siblings sharing
// one would race the publish leg's FETCH_HEAD window (#497).
import assert from 'node:assert/strict'
import {
  SUFFIXES,
  DEFAULT_K,
  MAX_K,
  runIdFor,
  allocateRuns,
} from '../race-allocate.mjs'

// (a) the three-run shape, asserted whole.
const three = allocateRuns({
  raceId: 'race-9',
  k: 3,
  port: 8180,
  dbDir: '/tmp/db',
  raceDir: '/tmp/r',
})
assert.deepEqual(three, [
  { runId: 'race-9-a', port: 8180, dbDir: '/tmp/db-a', repoDir: '/tmp/r/race-9-a' },
  { runId: 'race-9-b', port: 8181, dbDir: '/tmp/db-b', repoDir: '/tmp/r/race-9-b' },
  { runId: 'race-9-c', port: 8182, dbDir: '/tmp/db-c', repoDir: '/tmp/r/race-9-c' },
])

// (b) every field pairwise distinct, and a suffixed id is a new id (#211) —
// no entry may reuse the race id itself.
for (const field of ['runId', 'port', 'dbDir', 'repoDir']) {
  const values = three.map((run) => run[field])
  assert.equal(
    new Set(values).size,
    values.length,
    `${field} collides across runs: ${JSON.stringify(values)}`,
  )
}
for (const run of three) assert.notEqual(run.runId, 'race-9')

// (c) the ends of the range.
const one = allocateRuns({ raceId: 'race-9', k: 1, port: 8180, dbDir: '/tmp/db', raceDir: '/tmp/r' })
assert.equal(one.length, 1)
assert.deepEqual(one, [
  { runId: 'race-9-a', port: 8180, dbDir: '/tmp/db-a', repoDir: '/tmp/r/race-9-a' },
])
const full = allocateRuns({ raceId: 'race-9', k: 26, port: 8180, dbDir: '/tmp/db', raceDir: '/tmp/r' })
assert.equal(full.length, 26)
assert.equal(full[25].runId, 'race-9-z')
assert.deepEqual(full[25], {
  runId: 'race-9-z',
  port: 8205,
  dbDir: '/tmp/db-z',
  repoDir: '/tmp/r/race-9-z',
})
for (const field of ['runId', 'port', 'dbDir', 'repoDir']) {
  assert.equal(new Set(full.map((run) => run[field])).size, 26, `${field} collides at k=26`)
}

// (d) k outside 1..26 — and k that is not an integer at all — names the dial
// the operator typed.
for (const k of [0, 27, 2.5, '3']) {
  assert.throws(
    () => allocateRuns({ raceId: 'race-9', k, port: 8180, dbDir: '/tmp/db', raceDir: '/tmp/r' }),
    (err) => err instanceof Error && err.message.includes('--k'),
    `k=${JSON.stringify(k)} must throw an error naming --k`,
  )
}

// (e) the id grammar on its own.
assert.equal(runIdFor('race-9', 0), 'race-9-a')
assert.equal(runIdFor('race-9', 25), 'race-9-z')

// (f) the dials the CLI reads.
assert.equal(DEFAULT_K, 3)
assert.equal(MAX_K, 26)
assert.equal(SUFFIXES.length, 26)
assert.equal(SUFFIXES.join(''), 'abcdefghijklmnopqrstuvwxyz')

console.log('ALL TESTS PASSED')
