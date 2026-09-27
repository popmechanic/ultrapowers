// A rough sketch of todos with tags. Every gesture goes through call(), so
// the page records it as a step; the ui list names each control by role and name.
export function render (root, store, call) {
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
  const draw = () => {
    root.replaceChildren()
    const input = el('input', { placeholder: 'What needs doing?' })
    input.setAttribute('aria-label', 'New todo')
    const form = el('form', {}, input, el('button', { type: 'submit', textContent: 'Add' }))
    form.dataset.mark = 'todo:add'; form.dataset.label = 'The box where you add a todo'
    form.onsubmit = (e) => {
      e.preventDefault()
      const text = input.value
      call('addTodo', { text }, text === ''
        ? [{ click: { role: 'button', name: 'Add' } }]
        : [{ type: { role: 'textbox', name: 'New todo', text } }, { click: { role: 'button', name: 'Add' } }])
    }
    const list = el('ul')
    list.dataset.mark = 'todo:list'; list.dataset.label = 'The list of todos'
    const tags = el('div', {}, el('h2', { textContent: 'Tags' }))
    tags.dataset.mark = 'tag:panel'; tags.dataset.label = 'Where you tag each todo'
    for (const id of store.getRowIds('todos')) {
      const text = store.getCell('todos', id, 'text')
      const box = el('input', { type: 'checkbox', checked: store.getCell('todos', id, 'completed') === true })
      box.setAttribute('aria-label', text)
      box.onchange = () => call('completeTodo', { id }, [{ click: { role: 'checkbox', name: text } }])
      const del = el('button', { type: 'button', textContent: 'Delete' })
      del.setAttribute('aria-label', 'Delete ' + text)
      del.onclick = () => call('deleteTodo', { id }, [{ click: { role: 'button', name: 'Delete ' + text } }])
      list.append(el('li', {}, box, ' ' + text + ' ', del))

      const tagInput = el('input', { placeholder: 'tag' })
      tagInput.setAttribute('aria-label', 'Tag for ' + text)
      const addTag = el('button', { type: 'submit', textContent: '+' })
      addTag.setAttribute('aria-label', 'Add tag to ' + text)
      const tagForm = el('form', {}, text + ': ', tagInput, addTag)
      tagForm.onsubmit = (e) => {
        e.preventDefault()
        const name = tagInput.value
        call('addTag', { todoId: id, name }, [{ type: { role: 'textbox', name: 'Tag for ' + text, text: name } }, { click: { role: 'button', name: 'Add tag to ' + text } }])
      }
      for (const t of store.getRowIds('tags').filter((t) => store.getCell('tags', t, 'todoId') === id)) {
        const tname = store.getCell('tags', t, 'name')
        const rm = el('button', { type: 'button', textContent: tname + ' ×' })
        rm.setAttribute('aria-label', `Remove ${tname} from ${text}`)
        rm.onclick = () => call('removeTag', { id: t }, [{ click: { role: 'button', name: `Remove ${tname} from ${text}` } }])
        tagForm.append(' ', rm)
      }
      tags.append(tagForm)
    }
    root.append(form, list, tags)
  }
  store.addTablesListener(draw)
  draw()
}
