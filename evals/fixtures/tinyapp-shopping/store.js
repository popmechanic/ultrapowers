import { createStore } from 'tinybase'

// The shopping list's store module. Every action is a WebMCP-shaped tool:
// a name, the piece it belongs to, a plain description, a typed input
// schema, and run(store, args) -> true when it changed the store.
// `line` is what the list shows for an item ("6 eggs", or "bread" for one).
const qtyOf = (q) => {
  const s = String(q ?? '').trim()
  if (s === '') return 1
  if (!/^[0-9]+$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= 99 ? n : null
}

export const TOOLS = [
  {
    name: 'addItem',
    piece: 'list',
    description: 'Add an item to buy, with how many (one when left blank).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'string' } }, required: ['name'] },
    run: (store, { name, qty }) => {
      const clean = String(name ?? '').trim()
      if (clean === '') return false
      const n = qtyOf(qty)
      if (n === null) return false
      store.addRow('items', { name: clean, qty: n, line: n === 1 ? clean : `${n} ${clean}` })
      return true
    }
  },
  {
    name: 'tickItem',
    piece: 'list',
    description: 'Tick this item off, or untick it if it is already ticked.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', 'x-row-of': 'items' } }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('items', id)) return false
      store.setCell('items', id, 'bought', !store.getCell('items', id, 'bought'))
      return true
    }
  },
  {
    name: 'removeItem',
    piece: 'list',
    description: 'Remove this item from the list.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', 'x-row-of': 'items' } }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('items', id)) return false
      store.delRow('items', id)
      return true
    }
  },
  {
    name: 'clearTicked',
    piece: 'list',
    description: 'Remove every ticked item from the list.',
    inputSchema: { type: 'object', properties: {} },
    run: (store) => {
      const ticked = store.getRowIds('items').filter((id) => store.getCell('items', id, 'bought') === true)
      if (ticked.length === 0) return false
      store.transaction(() => { for (const id of ticked) store.delRow('items', id) })
      return true
    }
  }
]

export function makeStore () {
  return createStore().setTablesSchema({
    items: { name: { type: 'string' }, qty: { type: 'number' }, line: { type: 'string' }, bought: { type: 'boolean' } }
  })
}
