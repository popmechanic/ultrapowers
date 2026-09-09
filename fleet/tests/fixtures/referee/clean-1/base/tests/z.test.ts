import { expect, test } from 'bun:test'
import { z } from '../src/z'

test('z doubles', () => {
  expect(z(2)).toBe(4)
})
