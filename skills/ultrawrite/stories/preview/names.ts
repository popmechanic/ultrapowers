const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  button: 'button', submit: 'button', reset: 'button', image: 'button', search: 'searchbox',
};

const FROM_CONTENT = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'rowheader', 'switch', 'tab', 'term',
  'tooltip', 'treeitem',
]);

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

export function roleOf(el: Element): string {
  const explicit = clean(el.getAttribute('role')).split(' ')[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'button': return 'button';
    case 'a': return el.hasAttribute('href') ? 'link' : '';
    case 'input': {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (type === 'hidden') return '';
      return INPUT_ROLES[type] ?? 'textbox';
    }
    case 'textarea': return 'textbox';
    case 'select': return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox';
    case 'option': return 'option';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'img': return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'header': return 'banner';
    case 'footer': return 'contentinfo';
    case 'aside': return 'complementary';
    case 'form': return 'form';
    case 'table': return 'table';
    case 'tr': return 'row';
    case 'td': return 'cell';
    case 'th': return 'columnheader';
    case 'dialog': return 'dialog';
    case 'hr': return 'separator';
    case 'progress': return 'progressbar';
    case 'section': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
    default: return '';
  }
}

function textOf(el: Element): string {
  return clean(el.textContent);
}

export function textLineOf(el: Element): string {
  return el.getAttribute('data-part') === 'text' ? clean(el.textContent ?? '') : '';
}

export function nameOf(el: Element): string {
  const label = clean(el.getAttribute('aria-label'));
  if (label) return label;
  const by = clean(el.getAttribute('aria-labelledby'));
  if (by) {
    const text = clean(by.split(' ').map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const id = el.getAttribute('id');
  if (id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel && clean(forLabel.textContent)) return clean(forLabel.textContent);
  }
  const wrap = el.closest('label');
  if (wrap && wrap !== el && clean(wrap.textContent)) return clean(wrap.textContent);
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset') return clean((el as HTMLInputElement).value);
    return clean(el.getAttribute('title')) || clean(el.getAttribute('placeholder'));
  }
  if (el instanceof HTMLImageElement) return clean(el.alt) || clean(el.getAttribute('title'));
  return (FROM_CONTENT.has(roleOf(el)) ? textOf(el) : '') || clean(el.getAttribute('title'));
}

export function named(el: Element | null): Element | null {
  for (let e = el; e; e = e.parentElement) {
    if (roleOf(e) && nameOf(e)) return e;
  }
  return null;
}

export const targetOf = (role: string, name: string): string => `${role} "${name}"`;

export function find(role: string, name: string, root: ParentNode = document): Element | null {
  for (const el of root.querySelectorAll('*')) {
    if (roleOf(el) === role && nameOf(el) === name) return el;
  }
  return null;
}
