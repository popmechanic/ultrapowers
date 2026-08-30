# Registry Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — the committed Bun suite is the verification.

**Goal:** Extend the seeded `src/registry.ts` skeleton with three exported lookup helpers — `byLabel`, `ids`, and `clear`. Each helper is functionally independent (its own signature, its own test file) but all three genuinely edit `src/registry.ts`. That same-file contention is deliberate and left unserialized: no `Depends-on` marker orders these tasks, so any ordering the executor chooses must merge their concurrent edits to one file. Every helper states an explicit TypeScript signature over the shared exported `Entry` type, so a task that drifts from the seam is a typecheck failure on the merged tree rather than a review opinion.

**Tech Stack:** Bun + TypeScript (strict, ESM). Bootstrap with `bun install` from `project/`. Run the suite with `bunx tsc --noEmit && bun test` from `project/` — the typecheck is half the gate, so a merged tree that compiles to the wrong shape fails loudly.

---

### Task 1: byLabel helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/registry.ts`
- Test: `tests/by-label.test.ts`

**Interfaces:**
- Consumes: the seeded `Entry` type, `register`, and the module-level `entries` map in `src/registry.ts`
- Produces: `export const byLabel = (label: string): Entry | undefined` — the first registered entry whose `label` matches exactly, or `undefined`

- [ ] **Step 1: Write failing tests** in `tests/by-label.test.ts`:
  - `register({ id: "b", label: "Beta" })` then `byLabel("Beta")` returns that entry.
  - `byLabel("Nope")` returns `undefined`.
  - Matching is exact and case-sensitive: `byLabel("beta")` returns `undefined`.
- [ ] **Step 2: Implement** `byLabel` in `src/registry.ts` with the signature above, iterating the existing `entries` map. Do not change the exported `Entry` type or the seeded helpers.
- [ ] **Step 3: Run** `bunx tsc --noEmit && bun test` from `project/` and confirm green.

### Task 2: ids helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/registry.ts`
- Test: `tests/ids.test.ts`

**Interfaces:**
- Consumes: the seeded `Entry` type, `register`, and the module-level `entries` map in `src/registry.ts`
- Produces: `export const ids = (): readonly string[]` — every registered id in insertion order

- [ ] **Step 1: Write failing tests** in `tests/ids.test.ts`:
  - A registry with `c` then `d` registered yields `ids()` equal to `["c", "d"]`.
  - The returned array is a fresh array each call — mutating one call's result does not affect the next.
- [ ] **Step 2: Implement** `ids` in `src/registry.ts` with the signature above. Do not change the exported `Entry` type or the seeded helpers.
- [ ] **Step 3: Run** `bunx tsc --noEmit && bun test` from `project/` and confirm green.

### Task 3: clear helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/registry.ts`
- Test: `tests/clear.test.ts`

**Interfaces:**
- Consumes: the seeded `Entry` type, `register`, `size`, and the module-level `entries` map in `src/registry.ts`
- Produces: `export const clear = (): number` — empties the registry and returns how many entries were removed

- [ ] **Step 1: Write failing tests** in `tests/clear.test.ts`:
  - Registering two entries then `clear()` returns `2` and leaves `size()` at `0`.
  - `clear()` on an empty registry returns `0`.
- [ ] **Step 2: Implement** `clear` in `src/registry.ts` with the signature above. Do not change the exported `Entry` type or the seeded helpers.
- [ ] **Step 3: Run** `bunx tsc --noEmit && bun test` from `project/` and confirm green.

### Task 4: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run: `bunx tsc --noEmit && bun test` from `project/` and confirm the typecheck is silent and every test passes, including the seeded `tests/registry.test.ts`.
