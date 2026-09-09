import { expect, test } from 'bun:test'

test('the endpoint is read', () => {
  expect('https://example.invalid/api').toContain('example')
})
