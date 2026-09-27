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
});
