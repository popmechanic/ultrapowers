import { createStore } from 'tinybase'

export const TOOLS = [
  {
    name: 'addTodo',
    piece: 'todo',
    description: 'Add a todo with this text; it starts not done.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: (store, { text }) => {
      const clean = String(text ?? '').trim()
      if (clean === '') return false
      store.addRow('todos', { text: clean })
      return true
    }
  },
  {
    name: 'completeTodo',
    piece: 'todo',
    description: 'Mark this todo as done.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', 'x-row-of': 'todos' } }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('todos', id)) return false
      store.setCell('todos', id, 'completed', true)
      return true
    }
  },
  {
    name: 'deleteTodo',
    piece: 'todo',
    description: 'Remove this todo from the list.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', 'x-row-of': 'todos' } }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('todos', id)) return false
      store.delRow('todos', id)
      return true
    }
  }
]

export function makeStore () {
  return createStore().setTablesSchema({
    todos: { text: { type: 'string' }, completed: { type: 'boolean' } }
  })
}
