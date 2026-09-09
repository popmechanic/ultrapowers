import { expect, test } from 'bun:test'
import { kebab } from '../src/kebab'

test('kebab joins words with a hyphen', () => {
  expect(kebab('Hello World')).toBe('hello-world')
})
