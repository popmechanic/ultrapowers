import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import type {See, UiStep} from '../../../factory/stack/tinyapp/probe';
import type {Product} from './product';

export const KINDS = ['behaviour', 'preserve'];
export type Step = {
  tool: string;
  args?: Record<string, unknown>;
  layer: 'store' | 'ui' | 'saved';
  ui?: UiStep[];
  see?: See[];
  refused?: boolean | string;
  link?: string;
  as?: string | null;
};
export type Story = {id: string; sentence: string; steps: Step[]};
export type Page = {
  title: string;
  kind: string;
  summary: string[];
  store: string;
  stories: Story[];
  links?: {id: string; sentence: string; pieces?: string[]}[];
  numbers?: {id: string; sentence: string; measure: string; target: string}[];
  publish?: {deploy: string; verify: string; rollback?: string};
  subproject?: string;
  waivers?: {piece: string; action: string; refuses: string; arg: string; reason: string}[];
};
export type Action = {name: string; description: string; inputSchema?: unknown; refuses?: string[]; label?: string; control?: 'checkbox'};
export type Card = {
  piece: string;
  purpose: string;
  depends_on?: string[];
  state?: {tables?: Record<string, string[]>; values?: string[]};
  actions: Action[];
  shows?: ({text: string; in?: string} | {heading: string})[];
  words?: Record<string, Record<string, string>>;
  main_story?: string;
  near_miss?: string;
  concept?: string;
  concepts?: string[];
};
export const conceptsOf = (c: Card): string[] =>
  [...new Set([...(Array.isArray(c.concepts) ? c.concepts.filter((x) => typeof x === 'string') : []), ...(c.concept ? [c.concept] : [])])];
export type Bundle = {dir: string; page: Page; cards: Card[]; storeText: string; storeSha256: string; product: Product | null};

export function loadBundle(dir: string): Bundle {
  const d = resolve(dir);
  const store = readFileSync(join(d, 'store.js'));
  const page = JSON.parse(readFileSync(join(d, 'page.json'), 'utf8'));
  page.stories ??= [];
  const productPath = join(d, 'product.json');
  const product = existsSync(productPath) ? JSON.parse(readFileSync(productPath, 'utf8')) : null;
  return {
    dir: d,
    page,
    cards: JSON.parse(readFileSync(join(d, 'cards.json'), 'utf8')),
    storeText: store.toString('utf8'),
    storeSha256: createHash('sha256').update(store).digest('hex'),
    product,
  };
}

export function pieceOrder(cards: Card[]): Card[] {
  const done = new Set<string>();
  const order: Card[] = [];
  let left = [...cards];
  while (left.length) {
    const ready = left.filter((c) => (c.depends_on ?? []).every((d) => done.has(d)));
    if (!ready.length) throw new Error('the pieces depend on each other in a circle');
    for (const c of ready) {
      order.push(c);
      done.add(c.piece);
    }
    left = left.filter((c) => !ready.includes(c));
  }
  return order;
}

export function writePageOrder(b: Bundle, app: string) {
  const file = join(app, 'client', 'src', 'screens', 'order.json');
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify({pieces: pieceOrder(b.cards).map((c) => c.piece)}, null, 2) + '\n');
}
