import { expect, test } from 'bun:test'
import { snake } from '../src/snake'

test('snake joins words with an underscore', () => {
  expect(snake('Hello World')).toBe('hello_world')
})
