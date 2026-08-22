import assert from 'node:assert/strict'
import { mintToken, verifyToken, hashToken } from '../tokens.mjs'

const { token, record } = mintToken({ sandboxId: 'sb1', ttlMs: 10000, now: 1000 })
assert.match(token, /^[0-9a-f]{64}$/)
assert.equal(record.tokenHash, hashToken(token))
assert.ok(!('token' in record))                                   // raw token never stored
assert.deepEqual(verifyToken(token, [record], 5000), { sandboxId: 'sb1' })
assert.equal(verifyToken(token, [record], 11000), null)           // expired
assert.equal(verifyToken('f'.repeat(64), [record], 5000), null)   // unknown
const two = mintToken({ sandboxId: 'sb1', ttlMs: 10000, now: 1000 })
assert.notEqual(two.token, token)                                 // no reuse across mints
console.log('ALL TESTS PASSED')
