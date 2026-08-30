import { expect, test } from "bun:test"
import { register, lookup, size } from "../src/registry"

test("registers and looks up an entry", () => {
  register({ id: "a", label: "Alpha" })
  expect(lookup("a")?.label).toBe("Alpha")
  expect(size()).toBe(1)
})
