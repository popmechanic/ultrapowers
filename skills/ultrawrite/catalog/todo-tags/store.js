import { createStore } from 'tinybase'

// The todo-plus-tags store module. The link "deleting a todo clears its tags"
// is part of deleteTodo, in one transaction, so compile.ts derives it.
const rowOf = (table) => ({ type: 'string', 'x-row-of': table })
const tagsOf = (store, todoId) => store.getRowIds('tags').filter((t) => store.getCell('tags', t, 'todoId') === todoId)

export const TOOLS = [
  {
    name: 'addTodo', piece: 'todo', description: 'Add a todo with this text; it starts not done.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: (store, { text }) => {
      const clean = String(text ?? '').trim()
      if (clean === '') return false
      store.addRow('todos', { text: clean })
      return true
    }
  },
  {
    name: 'completeTodo', piece: 'todo', description: 'Mark this todo as done.',
    inputSchema: { type: 'object', properties: { id: rowOf('todos') }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('todos', id)) return false
      store.setCell('todos', id, 'completed', true)
      return true
    }
  },
  {
    name: 'deleteTodo', piece: 'todo', description: 'Remove this todo from the list, and its tags with it.',
    inputSchema: { type: 'object', properties: { id: rowOf('todos') }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('todos', id)) return false
      store.transaction(() => {
        for (const t of tagsOf(store, id)) store.delRow('tags', t)
        store.delRow('todos', id)
      })
      return true
    }
  },
  {
    name: 'addTag', piece: 'tag', description: 'Tag this todo with a word.',
    inputSchema: { type: 'object', properties: { todoId: rowOf('todos'), name: { type: 'string' } }, required: ['todoId', 'name'] },
    run: (store, { todoId, name }) => {
      const clean = String(name ?? '').trim()
      if (clean === '' || !store.hasRow('todos', todoId)) return false
      if (tagsOf(store, todoId).some((t) => store.getCell('tags', t, 'name') === clean)) return false
      store.addRow('tags', { todoId, name: clean })
      return true
    }
  },
  {
    name: 'removeTag', piece: 'tag', description: 'Take this tag off its todo.',
    inputSchema: { type: 'object', properties: { id: rowOf('tags') }, required: ['id'] },
    run: (store, { id }) => {
      if (!store.hasRow('tags', id)) return false
      store.delRow('tags', id)
      return true
    }
  }
]

export function makeStore () {
  return createStore().setTablesSchema({
    todos: { text: { type: 'string' }, completed: { type: 'boolean' } },
    tags: { todoId: { type: 'string' }, name: { type: 'string' } }
  })
}
