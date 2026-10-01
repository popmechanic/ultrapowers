#!/usr/bin/env bun
// Write the starting app a stories-v1 launch builds on: the template (given
// code), the bundle's store module at client/src/store.js, and one
// json-render spec per piece at client/src/pieces/<piece>.json: an empty
// column that runs no action, so the screens check stays red on it until a
// builder writes the screen. The page finds the specs itself at build time.
// Refuses a directory that holds anything but .git.
//
//   bun skills/ultrawrite/stories/scaffold.ts <bundle> <dir>
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadBundle} from './bundle';

const TEMPLATE = join(import.meta.dir, 'tinyapp-template');
const STORE = 'client/src/store.js';
function main(argv: string[]): number {
  if (argv.length !== 2) {
    console.log('usage: scaffold.ts <bundle> <dir>');
    return 2;
  }
  const b = loadBundle(argv[0]);
  const dst = resolve(argv[1]);
  if (b.page.store !== STORE) {
    console.log(`scaffold: the page's store must be ${STORE}, not ${b.page.store}`);
    return 2;
  }
  if (existsSync(dst) && readdirSync(dst).some((n) => n !== '.git')) {
    console.log(`scaffold: ${dst} is not empty`);
    return 2;
  }
  cpSync(TEMPLATE, dst, {recursive: true});
  copyFileSync(join(b.dir, 'store.js'), join(dst, STORE));
  const pieces = b.cards.map((c) => c.piece);
  const pdir = join(dst, 'client', 'src', 'pieces');
  mkdirSync(pdir, {recursive: true});
  for (const p of pieces) {
    const spec = {root: p, elements: {[p]: {type: 'Stack', props: {}, children: []}}};
    writeFileSync(join(pdir, `${p}.json`), JSON.stringify(spec, null, 2) + '\n');
  }
  console.log(`SCAFFOLDED ${dst}: pieces ${pieces.join(', ')}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
