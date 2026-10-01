/** The json-render StateStore over a TinyBase store.
 *
 * Snapshot: {tables: {<table>: [{id, ...cells}, ...]}, values, draft, session}.
 * Only `draft` is writable from a screen: setSnapshot keeps the new draft and
 * drops everything else, so saved data changes only through the app's actions.
 */
import { createStoreAdapter } from '@json-render/core/store-utils'
import type { StateStore } from '@json-render/core'
import type { MergeableStore } from 'tinybase'

type Session = { staff: boolean; who: string | null }

export function tinybaseState(store: MergeableStore, session: () => Session): StateStore {
  let draft: Record<string, unknown> = {}
  const listeners = new Set<() => void>()

  const build = () => {
    const tables: Record<string, Record<string, unknown>[]> = {}
    for (const table of store.getTableIds()) {
      tables[table] = store.getRowIds(table).map((id) => ({ id, ...store.getRow(table, id) }))
    }
    return { tables, values: store.getValues(), draft, session: session() }
  }

  let snapshot = build()
  const refresh = () => {
    snapshot = build()
    for (const l of [...listeners]) l()
  }

  store.addDidFinishTransactionListener(refresh)

  return createStoreAdapter({
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      const nextDraft = next.draft
      draft = nextDraft && typeof nextDraft === 'object' ? (nextDraft as Record<string, unknown>) : {}
      refresh()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  })
}
