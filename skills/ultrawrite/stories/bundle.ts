// A bundle: page.json (with each story's steps), cards.json and store.js in
// one directory. The store's fingerprint is taken here.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {See, UiStep} from '../../../factory/stack/tinyapp/probe';

export const KINDS = ['behaviour', 'preserve', 'look'];
export type Step = {
  tool: string;
  args?: Record<string, unknown>;
  layer: 'store' | 'ui' | 'saved';
  ui?: UiStep[];
  see?: See[];
  refused?: boolean;
  link?: string;
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
};
export type Bundle = {dir: string; page: Page; cards: Card[]; storeText: string; storeSha256: string};

export function loadBundle(dir: string): Bundle {
  const d = resolve(dir);
  const store = readFileSync(join(d, 'store.js'));
  const page = JSON.parse(readFileSync(join(d, 'page.json'), 'utf8'));
  page.stories ??= [];
  return {
    dir: d,
    page,
    cards: JSON.parse(readFileSync(join(d, 'cards.json'), 'utf8')),
    storeText: store.toString('utf8'),
    storeSha256: createHash('sha256').update(store).digest('hex'),
  };
}
