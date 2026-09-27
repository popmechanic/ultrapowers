// A rough sketch of the todo screen. Every gesture goes through call(), so
// the page records it as a step. data-mark names what the operator can mark.
export function render (root, store, call) {
  const draw = () => {
    root.replaceChildren()
    const form = document.createElement('form')
    form.dataset.mark = 'todo:add'
    const input = document.createElement('input')
    input.placeholder = 'What needs doing?'
    input.setAttribute('aria-label', 'New todo')
    const add = document.createElement('button')
    add.type = 'submit'
    add.textContent = 'Add'
    form.append(input, add)
    form.onsubmit = (e) => {
      e.preventDefault()
      const text = input.value
      const ui = text === ''
        ? [{ click: { role: 'button', name: 'Add' } }]
        : [{ type: { role: 'textbox', name: 'New todo', text } }, { click: { role: 'button', name: 'Add' } }]
      call('addTodo', { text }, ui)
    }
    const list = document.createElement('ul')
    list.dataset.mark = 'todo:list'
    for (const id of store.getRowIds('todos')) {
      const text = store.getCell('todos', id, 'text')
      const done = store.getCell('todos', id, 'completed') === true
      const li = document.createElement('li')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = done
      box.setAttribute('aria-label', text)
      box.onchange = () => call('completeTodo', { id }, [{ click: { role: 'checkbox', name: text } }])
      const del = document.createElement('button')
      del.type = 'button'
      del.textContent = 'Delete'
      del.setAttribute('aria-label', 'Delete ' + text)
      del.onclick = () => call('deleteTodo', { id }, [{ click: { role: 'button', name: 'Delete ' + text } }])
      li.append(box, document.createTextNode(' ' + text + ' '), del)
      list.append(li)
    }
    root.append(form, list)
  }
  store.addTablesListener(draw)
  draw()
}
