#!/usr/bin/env bun
// Jev arranges each piece's screen from what the app can do. The candidates come
// from the bundle by code: every control a story's `ui` step names (a bound
// DraftInput, a bound ActionButton, a list of a table's rows), a few containers,
// the page title and the card's purpose. Jev only chooses and places them, through
// json-render's composer, once per version of questions.json's authoring_arrange.
// The kit is the installed TinyApp's: its catalog and store, and the composer copied
// to <app>/.preview/json-render/ so it shares the app's zod.
//
//   bun skills/ultrawrite/stories/arrange.ts <bundle> --app <dir> [--piece <piece>]
//   bun skills/ultrawrite/stories/arrange.ts <bundle> --app <dir> --piece <p> --pick <V>
//   bun skills/ultrawrite/stories/arrange.ts <bundle> --app <dir> --piece <p> --reshape --note <text> [--note <text>...]
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadBundle, type Bundle, type Card} from './bundle';
import {composeEvaluator, loadQuestions} from './jev';

type Json = Record<string, unknown>;
type Element = {type: string; props: Json; children?: string[]; on?: Json; visible?: unknown; repeat?: {statePath: string; key?: string}};
export type Spec = {root: string; elements: Record<string, Element>; state?: Json};
export type Evaluator = (request: {state: Json; questions: Record<string, {criteria: Record<string, string>}>; signal: AbortSignal}) => Promise<{answers: Record<string, {choice: string; confidence?: number}>}>;
type Candidate = {id: string; description: string; element: Pick<Element, 'type' | 'props' | 'visible'>; root?: boolean; maxUses?: number};
type RowControl = {type: 'ActionCheckbox' | 'ActionButton'; name: string; action: string; arg: string; label: unknown; checked?: unknown; description: string};
type Kit = {compose: (o: Json) => AsyncGenerator<{type: string; spec: Spec | null; steps: {description: string}[]}>; catalog: unknown; TOOLS: Tool[]; makeStore: () => any};
type Tool = {name: string; description: string; inputSchema?: {properties?: Record<string, Json>}; run: (store: unknown, args: unknown, as: unknown) => unknown};
type Pieces = {candidates: Candidate[]; required: Candidate[]; lists: Map<string, {table: string; controls: RowControl[]}>; fields: Map<string, string[]>};

export class CouldNotRun extends Error {}

const VENDOR = join(import.meta.dir, 'vendor', 'json-render');
const LIST = (table: string) => `/tables/${table}`;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// Object keys sorted, as the composer compares recipes.
const recipeKey = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const atomic = (e: Element) => ({type: e.type, props: e.props, ...(e.on === undefined ? {} : {on: e.on}), ...(e.visible === undefined ? {} : {visible: e.visible})});

/** The app's catalog, store and a staged copy of the composer, or CouldNotRun. */
async function loadKit(app: string): Promise<Kit> {
  const dir = resolve(app);
  const catPath = join(dir, 'client', 'src', 'screens', 'catalog.ts');
  const storePath = join(dir, 'client', 'src', 'store.js');
  if (!existsSync(catPath)) throw new CouldNotRun(`no catalog module at ${catPath}`);
  if (!existsSync(storePath)) throw new CouldNotRun(`no store module at ${storePath}`);
  const stage = join(dir, '.preview', 'json-render');
  mkdirSync(stage, {recursive: true});
  cpSync(VENDOR, stage, {recursive: true});
  const cat = await import(catPath);
  const store = await import(storePath);
  const composer = await import(join(stage, 'experimental-compose.ts'));
  return {compose: composer.experimental_composeSpec, catalog: cat.catalogFor(store.TOOLS), TOOLS: store.TOOLS, makeStore: store.makeStore};
}

function arrangeSet() {
  const s = loadQuestions().authoring_arrange as unknown as {guidance: string; versions: Record<string, string>};
  if (!s?.versions) throw new CouldNotRun('questions.json has no authoring_arrange set');
  return s;
}

/** The row argument of an action: the input property carrying x-row-of, with its table. */
function rowArg(tool: Tool | undefined): {arg: string; table: string} | null {
  for (const [k, p] of Object.entries(tool?.inputSchema?.properties ?? {})) if (typeof p['x-row-of'] === 'string') return {arg: k, table: p['x-row-of']};
  return null;
}

/** A row control's name with the row's string cell put back as an expression. */
function fromRow(name: string, row: Json): unknown {
  const cells = Object.entries(row).filter(([, v]) => typeof v === 'string' && v !== '') as [string, string][];
  const exact = cells.find(([, v]) => v === name);
  if (exact) return {$item: exact[0]};
  const inside = cells.filter(([, v]) => name.includes(v)).sort(([, a], [, b]) => b.length - a.length)[0];
  return inside ? {$template: name.replace(inside[1], '${' + inside[0] + '}')} : name;
}

/** Every candidate for one card, walking each story on a fresh store. */
function candidatesFor(b: Bundle, card: Card, kit: Kit): Pieces {
  const tools = new Map(kit.TOOLS.map((t) => [t.name, t]));
  const mine = new Set(card.actions.map((a) => a.name));
  const describe = (name: string) => tools.get(name)?.description ?? card.actions.find((a) => a.name === name)?.description ?? '';
  const drafts = new Map<string, {k: string; name: string; example?: string}[]>();
  const buttons: {name: string; action: string}[] = [];
  const lists = new Map<string, {table: string; controls: RowControl[]}>();
  for (const story of b.page.stories) {
    const store = kit.makeStore();
    for (const step of story.steps) {
      const tool = tools.get(step.tool);
      const args = (step.args ?? {}) as Json;
      if (mine.has(step.tool)) {
        const row = rowArg(tool);
        for (const u of step.ui ?? []) {
          if ('type' in u && u.type.role === 'textbox') {
            const k = Object.keys(args).find((x) => args[x] === u.type.text);
            if (!k) continue;
            const list = drafts.get(step.tool) ?? [];
            const text = typeof u.type.text === 'string' && u.type.text !== '' ? u.type.text : undefined;
            const seen = list.find((d) => d.k === k);
            if (!seen) list.push({k, name: u.type.name, ...(text === undefined ? {} : {example: text})});
            else if (seen.example === undefined && text !== undefined) seen.example = text;
            drafts.set(step.tool, list);
          } else if ('click' in u && (u.click.role === 'button' || u.click.role === 'checkbox')) {
            const name = u.click.name;
            if (!row) {
              if (u.click.role === 'button' && !buttons.some((x) => x.name === name && x.action === step.tool)) buttons.push({name, action: step.tool});
              continue;
            }
            const cells = (store.getRow(row.table, String(args[row.arg])) ?? {}) as Json;
            const l = lists.get(row.table) ?? {table: row.table, controls: []};
            lists.set(row.table, l);
            const type = u.click.role === 'checkbox' ? 'ActionCheckbox' : 'ActionButton';
            if (l.controls.some((c) => c.type === type && c.action === step.tool)) continue;
            const control: RowControl = {type, name, action: step.tool, arg: row.arg, label: fromRow(name, cells), description: `${u.click.role === 'checkbox' ? 'a checkbox' : 'a button'} "${name}" (${describe(step.tool)})`};
            if (type === 'ActionCheckbox') {
              const schema = JSON.parse(store.getTablesSchemaJson?.() ?? '{}')[row.table] ?? {};
              const flag = Object.keys(schema).find((c) => schema[c]?.type === 'boolean');
              if (flag) control.checked = {$item: flag};
            }
            l.controls.push(control);
          }
        }
      }
      tool?.run(store, args, step.as ?? null);
    }
  }
  const required: Candidate[] = [];
  for (const [action, ds] of drafts)
    for (const d of ds)
      required.push({id: `input_${action}_${d.k}`, root: false, description: `The text box "${d.name}", where you type the ${d.k} for ${action}: ${describe(action)}`, element: {type: 'DraftInput', props: {label: d.name, ...(d.example === undefined ? {} : {placeholder: d.example}), value: {$bindState: `/draft/${d.k}`}}}});
  for (const [i, x] of buttons.entries()) {
    const ds = drafts.get(x.action) ?? [];
    const props: Json = {label: x.name, action: x.action};
    if (ds.length) props.args = Object.fromEntries(ds.map((d) => [d.k, {$state: `/draft/${d.k}`}]));
    required.push({id: `button_${i}`, root: false, description: `The button "${x.name}": ${describe(x.action)}`, element: {type: 'ActionButton', props}});
  }
  for (const l of lists.values())
    required.push({id: `list_${l.table}`, root: false, description: `The list of ${l.table}, one line per entry, each with ${l.controls.map((c) => c.description).join(', ')}`, element: {type: 'Separator', props: {}, visible: {$state: LIST(l.table)}}});
  const candidates: Candidate[] = [
    {id: 'card', maxUses: 3, description: 'A card: a puffy surface grouping what it holds', element: {type: 'Card', props: {}}},
    {id: 'stack', maxUses: 3, description: 'A column: its children one above the other', element: {type: 'Stack', props: {gap: 3}}},
    {id: 'row', maxUses: 3, root: false, description: 'A row: its children side by side', element: {type: 'Row', props: {gap: 2, align: 'center'}}},
    {id: 'title', root: false, description: `The page title "${b.page.title}" as a heading`, element: {type: 'Heading', props: {text: b.page.title, level: 1}}},
    {id: 'purpose', root: false, description: `What it is for, in muted text: "${card.purpose}"`, element: {type: 'Text', props: {text: card.purpose, muted: true}}},
    ...required,
  ];
  const fields = new Map([...drafts].map(([action, ds]) => [action, ds.map((d) => d.k)]));
  return {candidates, required, lists, fields};
}

/** Element id -> its candidate's description, by recipe. */
function descriptionsOf(spec: Spec, candidates: Candidate[]): Record<string, string> {
  const by = new Map(candidates.map((c) => [recipeKey(c.element), c.description]));
  return Object.fromEntries(Object.entries(spec.elements).map(([id, e]) => [id, by.get(recipeKey(atomic(e))) ?? `Existing ${e.type}`]));
}

const missing = (spec: Spec | null, required: Candidate[]) => {
  const have = new Set(Object.values(spec?.elements ?? {}).map((e) => recipeKey(atomic(e))));
  return required.filter((c) => !have.has(recipeKey(c.element)));
};

/** The composer's layout made real: each list placeholder a repeat over its table,
 *  each draft-reading button clearing its drafts once it ran, the page title (one,
 *  added if left out) first under the root, the controls in the order of use, empty
 *  containers gone. */
function expand(input: Spec, lists: Pieces['lists'], title: string, fields: Pieces['fields']): Spec {
  const spec: Spec = structuredClone({root: input.root, elements: input.elements});
  for (const [id, e] of Object.entries(spec.elements)) {
    const path = isObj(e.visible) ? e.visible.$state : undefined;
    const list = e.type === 'Separator' && typeof path === 'string' && path.startsWith('/tables/') ? lists.get(path.slice('/tables/'.length)) : undefined;
    if (list) {
      const row = `${id}_row`;
      const kids = list.controls.map((_, i) => `${id}_${i}`);
      spec.elements[id] = {type: 'Stack', props: {gap: 2}, repeat: {statePath: LIST(list.table), key: 'id'}, children: [row]};
      spec.elements[row] = {type: 'Row', props: {justify: 'between', align: 'center'}, children: kids};
      list.controls.forEach((c, i) => {
        const props: Json = {label: c.label, ...(c.checked === undefined ? {} : {checked: c.checked}), action: c.action, args: {[c.arg]: {$item: 'id'}}};
        if (c.type === 'ActionButton') Object.assign(props, {variant: 'quiet', size: 'sm'});
        spec.elements[kids[i]] = {type: c.type, props, children: []};
      });
      continue;
    }
    if (e.type === 'ActionButton' && isObj(e.props.args)) {
      const paths = Object.values(e.props.args).map((v) => (isObj(v) ? v.$state : undefined)).filter((p): p is string => typeof p === 'string' && p.startsWith('/draft/'));
      const clear = paths.map((p) => ({action: 'setState', params: {statePath: p, value: ''}}));
      if (clear.length) e.on = {press: clear.length === 1 ? clear[0] : clear};
    }
  }
  const heading = {type: 'Heading', props: {text: title, level: 1}};
  const titles = Object.keys(spec.elements).filter((id) => id !== spec.root && recipeKey(atomic(spec.elements[id])) === recipeKey(heading));
  let keep = titles[0];
  if (!keep) {
    keep = 'title';
    for (let i = 1; spec.elements[keep]; i++) keep = `title_${i}`;
    spec.elements[keep] = {...heading, children: []};
  }
  for (const id of titles.slice(1)) delete spec.elements[id];
  for (const p of Object.values(spec.elements)) if (p.children?.some((c) => titles.includes(c))) p.children = p.children.filter((c) => !titles.includes(c));
  const root = spec.elements[spec.root];
  root.children = [keep, ...(root.children ?? []).filter((c) => c !== keep)];
  inUseOrder(spec, fields);
  const containers = new Set(['Card', 'Stack', 'Row', 'Grid']);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, e] of Object.entries(spec.elements)) {
      if (id === spec.root || !containers.has(e.type) || e.repeat || (e.children ?? []).length) continue;
      delete spec.elements[id];
      for (const p of Object.values(spec.elements)) if (p.children?.includes(id)) p.children = p.children.filter((c) => c !== id);
      changed = true;
    }
  }
  return spec;
}

/** The order a person uses the screen, by code (#1510). An action's text boxes, in the
 *  order the stories type into them, sit directly before its button, gathered where the
 *  first box sits. A whole-list button (no args) sits just below its list, unless it, or
 *  the wrapper holding only it, is already right beside the list. Anything already in
 *  order is left as composed, so the versions keep their own containers. */
function inUseOrder(spec: Spec, fields: Pieces['fields']) {
  const parentOf = (id: string) => Object.keys(spec.elements).find((p) => spec.elements[p].children?.includes(id));
  const take = (id: string) => {
    const p = parentOf(id);
    if (p) spec.elements[p].children = spec.elements[p].children!.filter((c) => c !== id);
  };
  const draftOf = (e: Element) => {
    const path = isObj(e.props.value) ? e.props.value.$bindState : undefined;
    return typeof path === 'string' && path.startsWith('/draft/') ? path.slice('/draft/'.length) : undefined;
  };
  const els = () => Object.entries(spec.elements);
  for (const [action, keys] of fields) {
    const boxes = keys.map((k) => els().find(([, e]) => e.type === 'DraftInput' && draftOf(e) === k)?.[0]).filter((id): id is string => !!id);
    const button = els().find(([, e]) => e.type === 'ActionButton' && e.props.action === action && isObj(e.props.args))?.[0];
    const group = button ? [...boxes, button] : boxes;
    const home = group.length > 1 ? parentOf(group[0]) : undefined;
    if (!home) continue;
    const kids = spec.elements[home].children!;
    const at = kids.indexOf(group[0]);
    if (recipeKey(kids.slice(at, at + group.length)) === recipeKey(group)) continue;
    const before = kids.slice(0, at).filter((c) => !group.includes(c)).length;
    for (const id of group) take(id);
    spec.elements[home].children!.splice(before, 0, ...group);
  }
  const list = els().find(([, e]) => e.repeat?.statePath?.startsWith('/tables/'))?.[0];
  const listParent = list && parentOf(list);
  if (!list || !listParent) return;
  for (const [id, e] of els()) {
    if (e.type !== 'ActionButton' || e.props.args !== undefined) continue;
    let mover = id;
    for (let p = parentOf(mover); p && p !== spec.root && spec.elements[p].children!.length === 1; p = parentOf(p)) mover = p;
    const kids = spec.elements[listParent].children!;
    const i = kids.indexOf(list);
    if (kids[i - 1] === mover || kids[i + 1] === mover) continue;
    take(mover);
    const now = spec.elements[listParent].children!;
    now.splice(now.indexOf(list) + 1, 0, mover);
  }
}

/** An expanded spec folded back to what the composer may read: lists as placeholders, no `on`. */
function collapse(input: Spec): Spec {
  const spec: Spec = structuredClone({root: input.root, elements: input.elements});
  const drop = (id: string): void => {
    for (const c of spec.elements[id]?.children ?? []) drop(c);
    delete spec.elements[id];
  };
  for (const [id, e] of Object.entries(spec.elements)) {
    if (!spec.elements[id]) continue;
    if (e.repeat?.statePath?.startsWith('/tables/')) {
      for (const c of e.children ?? []) drop(c);
      spec.elements[id] = {type: 'Separator', props: {}, visible: {$state: e.repeat.statePath}, children: []};
    } else if (e.type === 'ActionButton') delete e.on;
  }
  return spec;
}

async function lastSpec(events: AsyncGenerator<{type: string; spec: Spec | null; steps: {description: string}[]}>) {
  let done: {spec: Spec | null; steps: {description: string}[]} = {spec: null, steps: []};
  for await (const ev of events) if (ev.type === 'complete') done = ev;
  return done;
}

function cardsOf(b: Bundle, piece?: string): Card[] {
  const cards = b.cards.filter((c) => !piece || c.piece === piece);
  if (!cards.length) throw new CouldNotRun(`the bundle has no piece ${piece}`);
  return cards;
}

const contextOf = (b: Bundle) => ({app: b.page.title, stories: b.page.stories.map((s) => s.sentence)});

export async function arrange(opts: {bundle: string; app: string; piece?: string; evaluate: Evaluator}) {
  const b = loadBundle(opts.bundle);
  const kit = await loadKit(opts.app);
  const set = arrangeSet();
  let calls = 0;
  const evaluate: Evaluator = (r) => {
    calls++;
    return opts.evaluate(r);
  };
  const versions: Record<string, Record<string, Spec>> = {};
  const dropped: Record<string, Record<string, string>> = {};
  for (const card of cardsOf(b, opts.piece)) {
    const {candidates, required, lists, fields} = candidatesFor(b, card, kit);
    const common = {catalog: kit.catalog, candidates, evaluate, instructions: {next: set.guidance}, context: contextOf(b)};
    const results = await Promise.all(
      Object.entries(set.versions).map(async ([v, sentence]) => {
        const prompt = [...b.page.summary, card.purpose, sentence].join(' ');
        let {spec} = await lastSpec(kit.compose({...common, prompt}));
        let left = missing(spec, required);
        if (spec && left.length) {
          spec = (await lastSpec(kit.compose({...common, initialSpec: spec, elementDescriptions: descriptionsOf(spec, candidates), prompt: `Add ${left.map((c) => c.description).join('; ')}`}))).spec;
          left = missing(spec, required);
        }
        return [v, left.length || !spec ? {why: `left out ${left.map((c) => c.description).join('; ')}`} : {spec: expand(spec, lists, b.page.title, fields)}] as const;
      }),
    );
    for (const [v, r] of results) {
      if ('spec' in r) (versions[card.piece] ??= {})[v] = r.spec;
      else (dropped[card.piece] ??= {})[v] = r.why;
    }
  }
  return {versions, dropped, calls};
}

export async function reshape(opts: {bundle: string; app: string; piece: string; spec: Spec; notes: string[]; evaluate: Evaluator}) {
  const b = loadBundle(opts.bundle);
  const kit = await loadKit(opts.app);
  const set = arrangeSet();
  const [card] = cardsOf(b, opts.piece);
  const {candidates, lists, fields} = candidatesFor(b, card, kit);
  const initialSpec = collapse(opts.spec);
  const out = await lastSpec(
    kit.compose({
      catalog: kit.catalog,
      candidates,
      evaluate: opts.evaluate,
      instructions: {next: set.guidance},
      context: contextOf(b),
      initialSpec,
      elementDescriptions: descriptionsOf(initialSpec, candidates),
      prompt: opts.notes.join('\n'),
    }),
  );
  if (!out.spec) throw new Error('the composer returned no screen');
  return {spec: expand(out.spec, lists, b.page.title, fields), steps: out.steps.map((s) => s.description)};
}

const USAGE = 'usage: arrange.ts <bundle> --app <dir> [--piece <piece>] [--pick <V> | --reshape --note <text>...]';
const write = (path: string, spec: Spec) => writeFileSync(path, JSON.stringify(spec, null, 2) + '\n');

async function main(argv: string[]): Promise<number> {
  const pos: string[] = [];
  const notes: string[] = [];
  const flags: Record<string, string> = {};
  let reshaping = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reshape') reshaping = true;
    else if (a === '--note' && i + 1 < argv.length) notes.push(argv[++i]);
    else if (['--app', '--piece', '--pick'].includes(a) && i + 1 < argv.length) flags[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) return usage();
    else pos.push(a);
  }
  if (pos.length !== 1 || !flags.app || (flags.pick && reshaping) || ((flags.pick || reshaping) && !flags.piece) || (reshaping && !notes.length) || (notes.length && !reshaping))
    return usage();
  const bundle = resolve(pos[0]);
  const app = resolve(flags.app);
  const screens = join(bundle, 'screens');
  try {
    for (const f of [join(app, 'client', 'src', 'screens', 'catalog.ts'), join(app, 'client', 'src', 'store.js')])
      if (!existsSync(f)) throw new CouldNotRun(`no ${f}`);
    if (flags.pick) {
      const from = join(screens, `${flags.piece}.${flags.pick}.json`);
      if (!existsSync(from)) throw new CouldNotRun(`no version ${flags.pick} of ${flags.piece} at ${from}`);
      copyFileSync(from, join(screens, `${flags.piece}.json`));
      console.log(`ARRANGE picked ${flags.piece} ${flags.pick}`);
      return 0;
    }
    if (reshaping) {
      const file = join(screens, `${flags.piece}.json`);
      if (!existsSync(file)) throw new CouldNotRun(`no approved screen at ${file}`);
      const spec = JSON.parse(readFileSync(file, 'utf8'));
      const out = await reshape({bundle, app, piece: flags.piece, spec, notes, evaluate: composeEvaluator()}).catch(fail);
      write(file, out.spec);
      for (const s of out.steps) console.log(`ARRANGE ${flags.piece}: ${s}`);
      console.log(`ARRANGE reshaped ${flags.piece}: ${out.steps.length} steps`);
      return 0;
    }
    const started = performance.now();
    const r = await arrange({bundle, app, piece: flags.piece, evaluate: composeEvaluator()}).catch(fail);
    const empty: string[] = [];
    for (const card of cardsOf(loadBundle(bundle), flags.piece)) {
      const kept = r.versions[card.piece] ?? {};
      if (Object.keys(kept).length) mkdirSync(screens, {recursive: true});
      for (const [v, spec] of Object.entries(kept)) {
        write(join(screens, `${card.piece}.${v}.json`), spec);
        console.log(`ARRANGE ${card.piece} ${v}: ${Object.keys(spec.elements).length} elements`);
      }
      for (const [v, why] of Object.entries(r.dropped[card.piece] ?? {})) console.log(`ARRANGE ${card.piece} ${v}: dropped, ${why}`);
      if (!Object.keys(kept).length) empty.push(card.piece);
    }
    if (empty.length) {
      console.log(`ARRANGE exit 1: ${empty.join(', ')} kept no version`);
      return 1;
    }
    console.log(`ARRANGE ok: ${r.calls} Jev calls, ${Math.round(performance.now() - started)} ms`);
    return 0;
  } catch (e) {
    console.log(`ARRANGE could not run: ${(e as Error).message}`);
    return 2;
  }
}

// Anything the composer or Jev throws stops the run as could-not-run.
function fail(e: unknown): never {
  throw new CouldNotRun((e as Error)?.message ?? String(e));
}

function usage(): number {
  console.log(USAGE);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
