// A bundle: page.json (with each story's steps), cards.json and store.js in
// one directory. The store's fingerprint is taken here.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
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
// An action's words on the page: `label` its control's (in a row, `${cell}` names a cell of
// that row and `${col.cell}` a cell of the row column `col` names), an input property's
// `x-label` its text box's; `control: "checkbox"` draws it as a checkbox ticked by the
// table's boolean column.
// A card's `shows` are the lines its piece draws: `{text, in}` a line on each row of table `in`
// (`${cell}`, `${col.cell}` as in a label), `{text}` a line on the page whose slots are values
// in `state.values` or totals (`${sum t.c}`, `${count t}`, `${count t c=v}`), `{heading}` the
// page heading (one card's at most). Its `words` give the reader's words for a stored value:
// slot to stored value to shown words, e.g. `{"answer": {"yes": "coming"}}`.
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
  // One screen can cover several map lines (#1508): its `concepts`, beside or instead of `concept`.
  concepts?: string[];
};
// Every concept a card names: its `concepts` and its `concept`, without duplicates.
// A `concepts` that is not a list (checks.ts refuses it) adds nothing, never its letters.
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

/** The pieces in build order: each after every piece it depends on, ties in card order. */
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

/** client/src/screens/order.json: the order the page draws its pieces in, the build order, so a
 *  page reads party before guests before dishes rather than by file name (#1491). */
export function writePageOrder(b: Bundle, app: string) {
  const file = join(app, 'client', 'src', 'screens', 'order.json');
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify({pieces: pieceOrder(b.cards).map((c) => c.piece)}, null, 2) + '\n');
}
