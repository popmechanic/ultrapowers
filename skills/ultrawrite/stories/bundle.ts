// A bundle: page.json (with each story's steps), cards.json and store.js in
// one directory. The store's fingerprint is taken here.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {See, UiStep} from '../../../factory/stack/tinyapp/probe';
import type {Product} from './product';

// preserve is the declared shape for the Numbers checker still owed; nothing reads it yet.
export const KINDS = ['behaviour', 'preserve'];
export type Step = {
  tool: string;
  args?: Record<string, unknown>;
  layer: 'store' | 'ui' | 'saved';
  ui?: UiStep[];
  see?: See[];
  refused?: boolean | string;
  link?: string;
  // Who is signed in from this step on: an email, or null for nobody.
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
  // numbers is the declared shape for the Numbers checker still owed; nothing reads it yet.
  numbers?: {id: string; sentence: string; measure: string; target: string}[];
  // A plan that deploys: the boot runs `deploy` after the self-merge, then `verify` with
  // ULTRA_PUBLISH_URL set, and `rollback` when verify fails.
  publish?: {deploy: string; verify: string; rollback?: string};
  subproject?: string;
  waivers?: {piece: string; action: string; refuses: string; arg: string; reason: string}[];
};
export type Action = {name: string; description: string; inputSchema?: unknown; refuses?: string[]};
export type Card = {
  piece: string;
  purpose: string;
  depends_on?: string[];
  state?: {tables?: Record<string, string[]>};
  actions: Action[];
  main_story?: string;
  near_miss?: string;
  concept?: string;
};
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
