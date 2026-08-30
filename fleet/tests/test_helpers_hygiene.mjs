// fleet/tests/test_helpers_hygiene.mjs — the shared drive fixture's option set
// is a pinned list. #413's residue was an option (`installedPluginVersion`)
// that outlived the code it configured by a whole cutover (44e0d15): no test
// passed it, nothing read the cell, and a reader could reasonably conclude the
// drive still cross-checked the installed plugin. A dead option is worse than
// a missing one — it reads as a live seam.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(HERE, '_drive_helpers.mjs'), 'utf8')

// Every option `startStubSandbox` destructures, in source order.
const EXPECTED_OPTIONS = [
  'assignment',
  'runId',
  'receiptSha',
  'exec',
  'branch',
  'receiptPath',
  'rawBranch',
  'publish',
  'gateGreen',
  'clock',
  'invokeRun',
  'stamp',
]

const block = SOURCE.split('const startStubSandbox = ({')[1]
assert.ok(block, 'startStubSandbox factory not found in _drive_helpers.mjs')
const params = block.split('}) =>')[0]
const actual = params
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, '').trim())
  .filter((line) => line && line !== ',')
  .map((line) => line.split(/[:=,]/)[0].trim())
  .filter(Boolean)

assert.deepEqual(
  actual,
  EXPECTED_OPTIONS,
  'startStubSandbox options changed — add or remove the name in EXPECTED_OPTIONS ' +
    'deliberately. An option no caller passes and no source reads is an orphan: ' +
    'delete it rather than pinning it.',
)

// The specific orphan #413 leaves behind, pinned by name so it cannot return.
// Source of truth: drive.mjs:1123-1127 — the installed-plugin cross-check died
// at 0.3.0 with the install it checked.
assert.ok(
  !SOURCE.includes('installedPluginVersion'),
  '_drive_helpers.mjs still carries the installedPluginVersion seam (#413); ' +
    'nothing in fleet/ reads that cell since 44e0d15',
)

console.log('ALL TESTS PASSED')
