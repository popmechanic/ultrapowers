export type Entry = { readonly id: string; readonly label: string }

const entries = new Map<string, Entry>()

export const register = (entry: Entry): void => { entries.set(entry.id, entry) }
export const lookup = (id: string): Entry | undefined => entries.get(id)
export const size = (): number => entries.size
