/**
 * `sizeFromCompile` reads a stories-v1 payload's grammar and sizes for a
 * browser: `vmSizeFor`'s memory term becomes `max(6, ceil(2 + 1.25 * W))` GB
 * instead of `2 + W` (state-probe runner, #1087) — a claims-v1 payload is
 * unaffected.
 */
import assert from 'node:assert/strict'

import { sizeFromCompile } from '../launch.mjs'

const caps = { cpuCap: '6', memoryCap: '12GB' }
const waves = (n) => ({ waves: [Array.from({ length: n }, (_, i) => i + 1)], payload: { grammar: 'stories-v1' } })
assert.equal(sizeFromCompile(waves(2), caps).memory, '6GB')
assert.equal(sizeFromCompile(waves(8), caps).memory, '12GB')
assert.equal(sizeFromCompile({ waves: [[1, 2]], payload: { grammar: 'claims-v1' } }, caps).memory, '4GB')
console.log('ALL TESTS PASSED')
