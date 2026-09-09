import assert from 'node:assert/strict'
import { runTask, verdictOf } from '../run-engine.mjs'

assert.ok(runTask({ id: '1' }).ok, 'a task runs')
assert.equal(verdictOf([]), 'PASS', 'no issue is a PASS')
assert.equal(verdictOf([{ severity: 'blocking' }]), 'FIX_REQUIRED', 'a blocking issue is a fix')
