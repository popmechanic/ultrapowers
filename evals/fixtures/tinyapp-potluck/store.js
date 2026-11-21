import { createStore } from 'tinybase'

// The potluck's store module. Every action is a WebMCP-shaped tool:
// a name, the piece it belongs to, a plain description, a typed input
// schema, and run(store, args) -> true when it changed the store.
// A guest's `answer` is '' until they say yes; a dish's `guestId` is ''
// until someone is bringing it.
export const TOOLS = [
  {
    name: 'setParty',
    piece: 'party',
    description: 'Name the party and say when it is.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, when: { type: 'string' } },
      required: ['title']
    },
    run: (store, { title, when }) => {
      const clean = String(title ?? '').trim()
      if (clean === '') return false
      store.transaction(() => {
        store.setValue('title', clean)
        store.setValue('when', String(when ?? '').trim())
      })
      return true
    }
  },
  {
    name: 'addGuest',
    piece: 'guest',
    description: 'Invite a guest by name; they have not answered yet.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (store, { name }) => {
      const clean = String(name ?? '').trim()
      if (clean === '') return false
      const listed = store.getRowIds('guests').some((id) => String(store.getCell('guests', id, 'name')).toLowerCase() === clean.toLowerCase())
      if (listed) return false
      store.addRow('guests', { name: clean, answer: '' })
      return true
    }
  },
  {
    name: 'sayYes',
    piece: 'guest',
    description: 'Mark this guest as coming.',
    inputSchema: { type: 'object', properties: { guestId: { type: 'string', 'x-row-of': 'guests' } }, required: ['guestId'] },
    run: (store, { guestId }) => {
      if (!store.hasRow('guests', guestId)) return false
      store.setCell('guests', guestId, 'answer', 'yes')
      return true
    }
  },
  {
    name: 'addDish',
    piece: 'dish',
    description: 'List a dish the party needs and how many it serves; nobody is bringing it yet.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, serves: { type: 'number' } },
      required: ['name', 'serves']
    },
    run: (store, { name, serves }) => {
      const clean = String(name ?? '').trim()
      if (clean === '') return false
      if (typeof serves !== 'number' || !Number.isInteger(serves) || serves < 1) return false
      store.addRow('dishes', { name: clean, serves, guestId: '' })
      return true
    }
  },
  {
    name: 'bringDish',
    piece: 'dish',
    description: 'Have this guest, who is coming, bring this dish nobody is bringing yet.',
    inputSchema: {
      type: 'object',
      properties: { dishId: { type: 'string', 'x-row-of': 'dishes' }, guestId: { type: 'string', 'x-row-of': 'guests' } },
      required: ['dishId', 'guestId']
    },
    run: (store, { dishId, guestId }) => {
      if (!store.hasRow('dishes', dishId) || !store.hasRow('guests', guestId)) return false
      if (store.getCell('dishes', dishId, 'guestId') !== '') return false
      if (store.getCell('guests', guestId, 'answer') !== 'yes') return false
      store.setCell('dishes', dishId, 'guestId', guestId)
      return true
    }
  }
]

export function makeStore () {
  return createStore()
    .setTablesSchema({
      guests: { name: { type: 'string' }, answer: { type: 'string', default: '' } },
      dishes: { name: { type: 'string' }, serves: { type: 'number' }, guestId: { type: 'string', default: '' } }
    })
    .setValuesSchema({
      title: { type: 'string', default: '' },
      when: { type: 'string', default: '' }
    })
}
