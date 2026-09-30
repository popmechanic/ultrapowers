#!/usr/bin/env bun
// The operator notebook: a private file, read at the start of every planning
// session, that learns the operator's words. Outside every repo on purpose.
//
//   bun skills/ultrawrite/stories/notebook.ts show
//   bun skills/ultrawrite/stories/notebook.ts add <worked|failed|lands|author|retired> <text>
//   bun skills/ultrawrite/stories/notebook.ts log <plan-id> --rounds N --explains N --fixes N
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parseArgs} from 'node:util';
import {home} from './jev';

const SECTIONS: Record<string, string> = {
  worked: '## Words that worked',
  failed: '## Words that failed',
  lands: '## Explanations that land',
  author: '## The author decides',
  retired: '## Retired questions',
  readings: '## Plan readings',
};
const SEED = `# Operator notebook

Read at the start of every planning session. Every *Please explain* and every fixed line adds one.

## Words that worked

## Words that failed

- 2026-09-27: "probe" needed its definition first; lead with "the check a plan runs".

## Explanations that land

- 2026-09-27: A concrete before-and-after example lands where abstract words didn't.
- 2026-09-27: A visual explainer page helps when a mechanism is unfamiliar.
- 2026-09-27: When a design changes quickly, show the old shape beside the new one.

## The author decides

- 2026-09-27: Filing and plumbing details are the author's to decide; the operator decides what the app does and how it looks.

## Retired questions

## Plan readings
`;

const path = () => join(home(), 'notebook.md');

function ensure(): string {
  const p = path();
  if (!existsSync(p)) {
    mkdirSync(dirname(p), {recursive: true});
    writeFileSync(p, SEED);
  }
  return p;
}

function add(section: string, text: string, date: string): void {
  const p = ensure();
  const lines = readFileSync(p, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let i = lines.indexOf(SECTIONS[section]) + 1;
  while (i < lines.length && !lines[i].startsWith('## ')) i++;
  while (i > 0 && lines[i - 1] === '') i--;
  lines.splice(i, 0, `- ${date}: ${text}`);
  if (i + 1 < lines.length && lines[i + 1].startsWith('## ')) lines.splice(i + 1, 0, '');
  writeFileSync(p, lines.join('\n') + '\n');
}

function main(argv: string[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const [cmd, ...rest] = argv;
  if (cmd === 'show') {
    process.stdout.write(readFileSync(ensure(), 'utf8'));
    return 0;
  }
  if (cmd === 'add' && rest.length === 2) {
    if (!(rest[0] in SECTIONS) || rest[0] === 'readings') {
      console.error('notebook: section must be one of worked, failed, lands, author, retired');
      return 2;
    }
    add(rest[0], rest[1], today);
    return 0;
  }
  if (cmd === 'log') {
    const {values: v, positionals} = parseArgs({args: rest, allowPositionals: true,
      options: {rounds: {type: 'string'}, explains: {type: 'string'}, fixes: {type: 'string'}}});
    if (positionals.length !== 1 || !v.rounds || !v.explains || !v.fixes) {
      console.error('usage: notebook.ts log <plan-id> --rounds N --explains N --fixes N');
      return 2;
    }
    add('readings', `${positionals[0]}: rounds ${v.rounds}, please-explain ${v.explains}, lines fixed at touch 1 ${v.fixes}`, today);
    return 0;
  }
  console.error('usage: notebook.ts show | add <section> <text> | log <plan-id> --rounds N --explains N --fixes N');
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
