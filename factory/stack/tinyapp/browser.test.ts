import {existsSync} from 'node:fs';
import {expect, test} from 'bun:test';
import {launchBrowser, resolveBinary} from './browser';

const HAVE = existsSync(resolveBinary());
const HTML = `<!doctype html><body>
<button>Add</button><button aria-label="Delete buy milk">Delete</button>
<input type="checkbox" aria-label="buy milk"><input aria-label="New todo">
<h2>Tags</h2></body>`;

test.skipIf(!HAVE)('count finds elements by role and accessible name', async () => {
  const b = await launchBrowser();
  try {
    const p = await b.open({html: HTML, clock: '2026-01-01T00:00:00Z'});
    expect(await p.count({role: 'button', name: 'Add'})).toBe(1);
    expect(await p.count({role: 'button', name: 'Delete buy milk'})).toBe(1);
    expect(await p.count({role: 'checkbox', name: 'buy milk'})).toBe(1);
    expect(await p.count({role: 'textbox', name: 'New todo'})).toBe(1);
    expect(await p.count({role: 'heading', name: 'Tags'})).toBe(1);
    expect(await p.count({role: 'button', name: 'Nope'})).toBe(0);
  } finally {
    await b.close();
  }
});

test('resolveBinary prefers the explicit path, then TINYAPP_BROWSER', () => {
  expect(resolveBinary('/x')).toBe('/x');
  expect(resolveBinary(undefined, {TINYAPP_BROWSER: '/y'})).toBe('/y');
});
