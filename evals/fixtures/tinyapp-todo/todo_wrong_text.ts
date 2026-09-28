import type {MergeableStore} from 'tinybase';

type Tools = Record<string, (args: Record<string, unknown>) => boolean>;

export function mount(root: HTMLElement, store: MergeableStore, tools: Tools): void {
  const draw = () => {
    root.replaceChildren();
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'New todo');
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add';
    form.append(input, add);
    form.onsubmit = (e) => { e.preventDefault(); tools.addTodo({text: input.value}); };
    const list = document.createElement('ul');
    for (const id of store.getRowIds('todos')) {
      const text = String(store.getCell('todos', id, 'text'));
      const li = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = store.getCell('todos', id, 'completed') === true;
      box.setAttribute('aria-label', text.toUpperCase());
      box.onchange = () => tools.completeTodo({id});
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Delete ' + text);
      del.onclick = () => tools.deleteTodo({id});
      li.append(box, del);
      list.append(li);
    }
    root.append(form, list);
  };
  store.addTablesListener(draw);
  draw();
}
