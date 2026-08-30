import { beforeEach, expect, test } from "bun:test"
import { register, lookup, size, reset } from "../src/registry"

// Bun shares one module registry across test files, so the registry's map
// persists between them. Every test file resets it first — without this, a
// suite is order-dependent and goes red as soon as a second file registers.
beforeEach(reset)

test("registers and looks up an entry", () => {
  register({ id: "a", label: "Alpha" })
  expect(lookup("a")?.label).toBe("Alpha")
  expect(size()).toBe(1)
})
