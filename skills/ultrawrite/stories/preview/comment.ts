// Comment mode: a floating bar outside #app with "About this view" and
// "Comment". While the mode is on (and no story plays), hovering a named
// element inside #app outlines it and labels it with its target; a click on it
// or a dragged box over the page opens a note form instead of running the
// page's own action. A pinned note posts to /feedback and leaves a numbered pin.
import {named, nameOf, roleOf, targetOf} from './names';

type Box = {left: number; top: number; right: number; bottom: number};
type Note = {kind: 'element' | 'region'; target: string; at: Box} | {kind: 'view'};

const CLICK_SLOP = 6;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}) => {
  const el = document.createElement(tag);
  el.className = className;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const targetFor = (el: Element) => targetOf(roleOf(el), nameOf(el));

export function mountComment(): void {
  const app = document.getElementById('app');
  if (!app || document.querySelector('.preview-comment-bar')) return;

  let on = false;
  let pins = 0;
  let down: {x: number; y: number} | null = null;

  const bar = make('div', 'preview-comment-bar');
  const about = make('button', 'preview-comment-button', {type: 'button'});
  about.textContent = 'About this view';
  const toggle = make('button', 'preview-comment-button', {type: 'button', 'aria-pressed': 'false'});
  toggle.textContent = 'Comment';
  bar.append(about, toggle);

  const outline = make('div', 'preview-comment-outline', {hidden: ''});
  const tip = make('div', 'preview-comment-tip', {role: 'tooltip', hidden: ''});
  const drag = make('div', 'preview-comment-drag', {hidden: ''});
  document.body.append(bar, outline, tip, drag);

  let form: HTMLFormElement | null = null;
  const closeForm = () => { form?.remove(); form = null; };

  const hideHover = () => { outline.hidden = true; tip.hidden = true; };

  const place = (el: HTMLElement, b: Box) => {
    el.style.left = `${b.left}px`;
    el.style.top = `${b.top}px`;
    el.style.width = `${b.right - b.left}px`;
    el.style.height = `${b.bottom - b.top}px`;
  };

  const openForm = (note: Note) => {
    closeForm();
    hideHover();
    const f = make('form', 'preview-comment-form');
    const label = make('div', 'preview-comment-form-target');
    label.textContent = note.kind === 'view' ? 'About this view' : note.target;
    const text = make('textarea', 'preview-comment-note', {'aria-label': 'Note', rows: '3'});
    const actions = make('div', 'preview-comment-form-actions');
    const cancel = make('button', 'preview-comment-button', {type: 'button'});
    cancel.textContent = 'Cancel';
    const submit = make('button', 'preview-comment-button', {type: 'submit'});
    submit.textContent = 'Pin note';
    actions.append(cancel, submit);
    f.append(label, text, actions);
    if (note.kind === 'view') {
      f.classList.add('preview-comment-form-view');
    } else {
      f.style.left = `${Math.max(8, Math.min(note.at.left, innerWidth - 300))}px`;
      f.style.top = `${Math.min(note.at.bottom + 8, innerHeight - 160)}px`;
    }
    cancel.addEventListener('click', closeForm);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const body = text.value.trim();
      if (!body) return;
      const record = note.kind === 'view'
        ? {kind: 'view', note: body}
        : {kind: note.kind, target: note.target, note: body};
      void fetch('/feedback', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(record)});
      if (note.kind !== 'view') {
        const n = String(++pins);
        const pin = make('div', 'preview-comment-pin', {'data-pin': n});
        pin.textContent = n;
        pin.style.left = `${note.at.right + scrollX}px`;
        pin.style.top = `${note.at.top + scrollY}px`;
        document.body.append(pin);
      }
      closeForm();
    });
    form = f;
    document.body.append(f);
    text.focus();
  };

  const active = () => on && !window.__PREVIEW__?.playing;
  const inApp = (t: EventTarget | null) => t instanceof Node && app.contains(t);

  const setMode = (next: boolean) => {
    on = next;
    toggle.setAttribute('aria-pressed', String(on));
    document.documentElement.classList.toggle('preview-commenting', on);
    down = null;
    drag.hidden = true;
    hideHover();
    if (!on) closeForm();
  };

  toggle.addEventListener('click', () => setMode(!on));
  about.addEventListener('click', () => openForm({kind: 'view'}));

  const boxOf = (a: {x: number; y: number}, x: number, y: number): Box => ({
    left: Math.min(a.x, x), top: Math.min(a.y, y), right: Math.max(a.x, x), bottom: Math.max(a.y, y),
  });

  const hover = (t: EventTarget | null) => {
    const el = t instanceof Element && inApp(t) ? named(t) : null;
    if (!el || !app.contains(el)) { hideHover(); return; }
    const r = el.getBoundingClientRect();
    place(outline, r);
    tip.textContent = targetFor(el);
    tip.style.left = `${r.left}px`;
    tip.style.top = `${Math.max(0, r.top - 26)}px`;
    outline.hidden = false;
    tip.hidden = false;
  };

  window.addEventListener('mousedown', (e) => {
    if (!active() || !inApp(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    down = {x: e.clientX, y: e.clientY};
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!active()) return;
    if (down) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) {
        hideHover();
        place(drag, boxOf(down, e.clientX, e.clientY));
        drag.hidden = false;
      }
      return;
    }
    hover(e.target);
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (!active()) return;
    const start = down;
    down = null;
    drag.hidden = true;
    if (!start && !inApp(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= CLICK_SLOP) {
      const el = e.target instanceof Element ? named(e.target) : null;
      if (el && app.contains(el)) openForm({kind: 'element', target: targetFor(el), at: el.getBoundingClientRect()});
      return;
    }
    const box = boxOf(start, e.clientX, e.clientY);
    const inside: string[] = [];
    for (const el of app.querySelectorAll('*')) {
      if (named(el) !== el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < box.left || r.top < box.top || r.right > box.right || r.bottom > box.bottom) continue;
      const t = targetFor(el);
      if (!inside.includes(t)) inside.push(t);
    }
    const target = inside.length ? `area holding ${inside.join(', ')}` : 'empty area';
    openForm({kind: 'region', target, at: box});
  }, true);

  window.addEventListener('click', (e) => {
    if (!active() || !inApp(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}
