import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {expect, test} from 'bun:test';
import {launchBrowser, resolveBinary} from './browser';

const HAVE = existsSync(resolveBinary());
const SEE = readFileSync(join(import.meta.dir, '../../../skills/ultrawrite/preview/see.js'), 'utf8')
  .replace(/^export /gm, '');
const HTML = `<!doctype html><body><main id="app">
<form><input placeholder="What needs doing?" aria-label="New todo"><button type="submit">Add</button></form>
<ul><li><input type="checkbox" aria-label="buy milk"> buy milk <button aria-label="Delete buy milk">Delete</button></li></ul>
<h2>  Tags </h2><input placeholder="Tag name"><a href="#x">More   info</a>
</main><script>${SEE}; window.__SEE__ = seeOf(document.getElementById('app'));</script></body>`;

test.skipIf(!HAVE)('see.js names every element the way Chromium does', async () => {
  const b = await launchBrowser();
  try {
    const p = await b.open({html: HTML, clock: '2026-01-01T00:00:00Z'});
    const see = (await p.evaluate('window.__SEE__')) as {role: string; name: string; count: number}[];
    expect(see.map((s) => `${s.role}:${s.name}`)).toEqual([
      'button:Add', 'button:Delete buy milk', 'checkbox:buy milk', 'heading:Tags',
      'link:More info', 'textbox:New todo', 'textbox:Tag name',
    ]);
    for (const s of see) expect(await p.count({role: s.role, name: s.name})).toBe(s.count);
  } finally {
    await b.close();
  }
}, 30000);

// Two piece containers (the sketch convention: `todo:add`/`todo:list` and
// `tag:panel`), plus a control outside every container. seeOfPiece must keep
// each piece's controls to itself — a builder restyling the `tag` piece
// cannot inflate or borrow a count from `todo`'s screen, and vice versa.
const PIECES_HTML = `<!doctype html><body><main id="app">
<form data-mark="todo:add"><input placeholder="What needs doing?" aria-label="New todo"><button type="submit">Add</button></form>
<ul data-mark="todo:list"><li><input type="checkbox" aria-label="buy milk"> buy milk <button aria-label="Delete buy milk">Delete</button></li></ul>
<div data-mark="tag:panel"><h2>Tags</h2><button aria-label="Remove tag from buy milk">Remove tag from buy milk</button></div>
<h1>Untouched</h1>
</main><script>${SEE};
window.__SEE_TODO__ = seeOfPiece(document.getElementById('app'), 'todo');
window.__SEE_TAG__ = seeOfPiece(document.getElementById('app'), 'tag');
</script></body>`;

test.skipIf(!HAVE)('seeOfPiece keeps each piece to its own container, agreeing with Page.count', async () => {
  const b = await launchBrowser();
  try {
    const p = await b.open({html: PIECES_HTML, clock: '2026-01-01T00:00:00Z'});
    const todo = (await p.evaluate('window.__SEE_TODO__')) as {role: string; name: string; count: number}[];
    const tag = (await p.evaluate('window.__SEE_TAG__')) as {role: string; name: string; count: number}[];

    expect(todo.map((s) => `${s.role}:${s.name}`)).toEqual([
      'button:Add', 'button:Delete buy milk', 'checkbox:buy milk', 'textbox:New todo',
    ]);
    expect(tag.map((s) => `${s.role}:${s.name}`)).toEqual([
      'button:Remove tag from buy milk', 'heading:Tags',
    ]);

    // Each piece's list excludes the other piece's controls.
    for (const s of tag) expect(todo.some((t) => t.role === s.role && t.name === s.name)).toBe(false);
    for (const s of todo) expect(tag.some((t) => t.role === s.role && t.name === s.name)).toBe(false);

    for (const s of [...todo, ...tag]) expect(await p.count({role: s.role, name: s.name})).toBe(s.count);
  } finally {
    await b.close();
  }
}, 30000);
