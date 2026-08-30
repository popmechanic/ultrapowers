export type Entry = { readonly id: string; readonly label: string }

// Module-level state, deliberately: a registry is the realistic shape, and it
// is what makes this fixture's three tasks genuinely contend on one file.
// Bun runs every test file in ONE process against a shared module registry, so
// this map persists across files — measured 2026-08-30: a second file's
// `size()` saw the first file's entry. Every test file must therefore call
// `reset()` in `beforeEach`; the fixture plan states that convention for each
// task, because isolated implementers cannot agree on it any other way.
const entries = new Map<string, Entry>()

export const register = (entry: Entry): void => { entries.set(entry.id, entry) }
export const lookup = (id: string): Entry | undefined => entries.get(id)
export const size = (): number => entries.size
export const reset = (): void => { entries.clear() }
