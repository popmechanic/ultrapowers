#!/usr/bin/env bun
// Write the starting app a stories-v1 launch builds on: the template (given
// code), the bundle's store module at client/src/store.js, and one stub
// screen per piece, which the Flock's builders replace. Refuses a directory
// that holds anything but .git.
//
//   bun skills/ultrawrite/stories/scaffold.ts <bundle> <dir>
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadBundle} from './bundle';

const TEMPLATE = join(import.meta.dir, 'tinyapp-template');
const STORE = 'client/src/store.js';
const stub = (piece: string) => `import type {MergeableStore} from 'tinybase';

type Tools = Record<string, (args: Record<string, unknown>) => boolean>;
// Who is signed in right now: an email, or null. The page passes it to every tool.
type Session = {who: () => string | null};

// The ${piece} piece's screen. A builder writes this file.
export function mount(root: HTMLElement, store: MergeableStore, tools: Tools, session: Session): void {}
`;

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
  writeFileSync(join(pdir, 'index.ts'),
    pieces.map((p) => `import * as ${p} from './${p}';\n`).join('')
    + `\nexport const PIECES = [${pieces.map((p) => `['${p}', ${p}]`).join(', ')}] as const;\n`
    + `// The pieces a signed-out visitor sees. None is public until a plan names it.\n`
    + `export const PUBLIC: readonly string[] = [];\n`);
  for (const p of pieces) writeFileSync(join(pdir, `${p}.ts`), stub(p));
  console.log(`SCAFFOLDED ${dst}: pieces ${pieces.join(', ')}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
