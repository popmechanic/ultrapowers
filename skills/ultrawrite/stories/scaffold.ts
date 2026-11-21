#!/usr/bin/env bun
import {copyFileSync, cpSync, existsSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadBundle, writePageOrder} from './bundle';

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
  const screen = {root: 'page', elements: {page: {type: 'Stack', props: {gap: 4}, children: []}}};
  writeFileSync(join(dst, 'client', 'src', 'screen.json'), JSON.stringify(screen, null, 2) + '\n');
  writePageOrder(b, dst);
  console.log(`SCAFFOLDED ${dst}: pieces ${pieces.join(', ')}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
