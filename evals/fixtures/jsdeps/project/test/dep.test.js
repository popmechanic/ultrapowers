const { test } = require('node:test')
const assert = require('node:assert')
const { leftpad } = require('fixture-dep')

test('dependency imports and works', () => {
  assert.strictEqual(leftpad('7', 3), '  7')
})
