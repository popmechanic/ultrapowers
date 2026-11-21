#!/usr/bin/env bun
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadBundle, type Action, type Bundle, type Card} from './bundle';
import {composeEvaluator, loadQuestions} from './jev';

type Json = Record<string, unknown>;
type Element = {type: string; props: Json; children?: string[]; on?: Json; visible?: unknown; repeat?: {statePath: string; key?: string}};
export type Spec = {root: string; elements: Record<string, Element>; state?: Json};
export type Evaluator = (request: {state: Json; questions: Record<string, {criteria: Record<string, string>}>; signal: AbortSignal}) => Promise<{answers: Record<string, {choice: string; confidence?: number}>}>;
type Candidate = {id: string; description: string; element: Pick<Element, 'type' | 'props' | 'visible'>; root?: boolean; maxUses?: number};
type RowControl = {type: 'ActionCheckbox' | 'ActionButton' | 'ActionSelect' | 'DraftInput' | 'DraftNumber' | 'Text'; name: string; action: string; arg: string; label: unknown; checked?: unknown; draft?: string; example?: string; args?: Json; pick?: string; options?: unknown; optionLabel?: string; value?: unknown; description: string};
type Kit = {compose: (o: Json) => AsyncGenerator<{type: string; spec: Spec | null; steps: {description: string}[]}>; catalog: unknown; TOOLS: Tool[]; makeStore: () => any};
type Tool = {name: string; description: string; inputSchema?: {properties?: Record<string, Json>}; run: (store: unknown, args: unknown, as: unknown) => unknown};
type Heading = {type: 'Heading'; props: Json};
type Pieces = {candidates: Candidate[]; required: Candidate[]; lists: Map<string, {table: string; controls: RowControl[]}>; fields: Map<string, string[]>; writes: Map<string, string[]>; heading: Heading; lines: Line[]};
type Line = {stand: Pick<Element, 'type' | 'props'>; real: Pick<Element, 'type' | 'props'>};

export class CouldNotRun extends Error {}

const VENDOR = join(import.meta.dir, 'vendor', 'json-render');
const LIST = (table: string) => `/tables/${table}`;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const recipeKey = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const atomic = (e: Element) => ({type: e.type, props: e.props, ...(e.on === undefined ? {} : {on: e.on}), ...(e.visible === undefined ? {} : {visible: e.visible})});

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

function wordsOf(label: string, rowOf: Map<string, string>, inRow: boolean): unknown {
  const tokens = inRow ? slotsOf(label) : [];
  if (!tokens.length) return label;
  const whole = tokens.length === 1 && label === '${' + tokens[0] + '}';
  if (tokens.every((t) => !t.includes('.'))) return whole ? {$item: tokens[0]} : {$template: label};
  if (whole) return cellOf(tokens[0], label, rowOf);
  const args: Json = {template: label};
  for (const t of tokens) args[t] ??= cellOf(t, label, rowOf);
  return {$computed: 'format', args};
}

const slotsOf = (words: string) => [...words.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);

function cellOf(t: string, words: string, rowOf: Map<string, string>): unknown {
  if (!t.includes('.')) return {$item: t};
  const [by, column] = [t.slice(0, t.indexOf('.')), t.slice(t.indexOf('.') + 1)];
  const table = rowOf.get(by);
  if (!table) throw new CouldNotRun(`the words "${words}" name ${by}, which names no table's row`);
  return {$computed: 'lookup', args: {rows: {$state: LIST(table)}, id: {$item: by}, column}};
}

function totalOf(t: string): unknown {
  const sum = t.match(/^sum\s+([^\s.]+)\.(\S+)$/);
  if (sum) return {$computed: 'sum', args: {rows: {$state: LIST(sum[1])}, column: sum[2]}};
  const count = t.match(/^count\s+(\S+)(?:\s+([^\s=]+)=(.*))?$/);
  if (count) return {$computed: 'count', args: {rows: {$state: LIST(count[1])}, where: count[2] ? {[count[2]]: count[3]} : {}}};
  return {$state: `/values/${t}`};
}

function lineOf(words: string, said: Card['words'], argOf: (t: string) => unknown): unknown {
  const args: Json = {template: words};
  for (const t of slotsOf(words)) args[t] ??= said?.[t] ? {$computed: 'words', args: {value: argOf(t), words: said[t]}} : argOf(t);
  return {$computed: 'format', args};
}

const saying = (words: string) => slotsOf(words).map((t) => t.replace(/^(sum|count)\s+/, '$1 of ')).join(' and ');

type Props = Record<string, {type?: string; 'x-row-of'?: string; 'x-label'?: string; 'x-where'?: Json}>;
const propsOf = (a: Action): Props => ((a.inputSchema as {properties?: Props})?.properties ?? {});

function candidatesFor(b: Bundle, kit: Kit): Pieces {
  const tools = new Map(kit.TOOLS.map((t) => [t.name, t]));
  const actions = b.cards.flatMap((c) => c.actions);
  const describe = (a: Action) => tools.get(a.name)?.description ?? a.description ?? '';
  const rowOf = new Map<string, string>();
  for (const a of actions) for (const [k, p] of Object.entries(propsOf(a))) if (typeof p['x-row-of'] === 'string') rowOf.set(k, p['x-row-of']);
  const rowArgsOf = (a: Action) => Object.entries(propsOf(a)).filter(([, p]) => typeof p['x-row-of'] === 'string').map(([arg, p]) => ({arg, table: p['x-row-of']!, where: p['x-where']}));
  const textsOf = (a: Action) =>
    Object.entries(propsOf(a))
      .filter(([, p]) => (p.type === 'string' || p.type === 'number') && typeof p['x-row-of'] !== 'string')
      .map(([k, p]) => ({k, label: p['x-label'] ?? k, part: p.type === 'number' ? ('DraftNumber' as const) : ('DraftInput' as const)}));
  const boxOf = (part: 'DraftInput' | 'DraftNumber') => (part === 'DraftNumber' ? 'a number box' : 'a text box');
  const schema: Record<string, Record<string, {type?: string}>> = JSON.parse(kit.makeStore().getTablesSchemaJson?.() ?? '{}');
  const typers = new Map<string, Set<string>>();
  for (const a of actions) for (const {k} of textsOf(a)) typers.set(k, (typers.get(k) ?? new Set()).add(a.name));
  const draftKey = (action: string, k: string) => ((typers.get(k)?.size ?? 0) > 1 ? `${action}.${k}` : k);
  const lists = new Map<string, {table: string; controls: RowControl[]}>();
  const writes = new Map<string, string[]>();
  const fields = new Map<string, string[]>();
  const required: Candidate[] = [];
  let buttons = 0;
  for (const card of b.cards)
    for (const a of card.actions) {
      const [row, other] = rowArgsOf(a);
      const texts = textsOf(a);
      const words = a.label ?? a.description;
      const args: Json = Object.fromEntries(texts.map(({k}) => [k, {$state: `/draft/${draftKey(a.name, k)}`}]));
      if (row) {
        const l = lists.get(row.table) ?? {table: row.table, controls: []};
        lists.set(row.table, l);
        for (const {k, label, part} of texts)
          l.controls.push({type: part, name: label, action: a.name, arg: row.arg, draft: draftKey(a.name, k), label: wordsOf(label, rowOf, true), description: `${boxOf(part)} "${label}", where you type the ${k} for ${a.name}`});
        if (other) {
          const rows = {$state: LIST(other.table)};
          const optionLabel = Object.keys(schema[other.table] ?? {}).find((c) => schema[other.table][c]?.type === 'string');
          if (!optionLabel) throw new CouldNotRun(`${a.name} picks a row of ${other.table}, which has no text column to show it by`);
          const control: RowControl = {type: 'ActionSelect', name: words, action: a.name, arg: row.arg, label: wordsOf(words, rowOf, true), args: {[row.arg]: {$item: 'id'}, ...args}, pick: other.arg, options: isObj(other.where) ? {$computed: 'rowsWhere', args: {rows, where: other.where}} : rows, optionLabel, description: `a picker "${words}" choosing one of the ${other.table} by its ${optionLabel} (${describe(a)})`};
          if (schema[row.table]?.[other.arg]) control.value = {$item: other.arg};
          l.controls.push(control);
          continue;
        }
        const type = a.control === 'checkbox' ? 'ActionCheckbox' : 'ActionButton';
        const control: RowControl = {type, name: words, action: a.name, arg: row.arg, label: wordsOf(words, rowOf, true), args: {[row.arg]: {$item: 'id'}, ...args}, description: `${type === 'ActionCheckbox' ? 'a checkbox' : 'a button'} "${words}" (${describe(a)})`};
        if (type === 'ActionCheckbox') {
          const flag = Object.keys(schema[row.table] ?? {}).find((c) => schema[row.table][c]?.type === 'boolean');
          if (flag) control.checked = {$item: flag};
        }
        l.controls.push(control);
        continue;
      }
      for (const {k, label, part} of texts)
        required.push({id: `input_${a.name}_${k}`, root: false, description: `The ${boxOf(part).slice(2)} "${label}", where you type the ${k} for ${a.name}: ${describe(a)}`, element: {type: part, props: {label, value: {$bindState: `/draft/${draftKey(a.name, k)}`}}}});
      if (texts.length) fields.set(a.name, texts.map(({k}) => draftKey(a.name, k)));
      writes.set(a.name, Object.keys(card.state?.tables ?? {}));
      const props: Json = {label: words, action: a.name};
      if (texts.length) props.args = args;
      required.push({id: `button_${buttons++}`, root: false, description: `The button "${words}": ${describe(a)}`, element: {type: 'ActionButton', props}});
    }
  let heading: Heading = {type: 'Heading', props: {text: b.page.title, level: 1}};
  let headed = false;
  const lines: Line[] = [];
  const rowLines = new Map<string, RowControl[]>();
  for (const card of b.cards)
    (card.shows ?? []).forEach((line, i) => {
      if ('heading' in line) {
        if (headed) throw new CouldNotRun(`two cards carry a heading line; ${card.piece}'s is the second`);
        headed = true;
        heading = {type: 'Heading', props: {text: lineOf(line.heading, card.words, totalOf), level: 1}};
        const stand = {type: 'Heading', props: {text: line.heading, level: 1}};
        lines.push({stand, real: heading});
        required.push({id: 'heading', root: false, description: `The page heading, the ${card.piece}'s ${saying(line.heading)}: "${line.heading}"`, element: stand});
        return;
      }
      if (line.in) {
        const table = line.in;
        if (!lists.has(table)) lists.set(table, {table, controls: []});
        const label = lineOf(line.text, card.words, (t) => cellOf(t, line.text, rowOf));
        rowLines.set(table, [...(rowLines.get(table) ?? []), {type: 'Text', name: line.text, action: '', arg: '', label, description: `each ${table} entry's line: its ${saying(line.text)} ("${line.text}")`}]);
        return;
      }
      const stand = {type: 'Text', props: {text: line.text}};
      lines.push({stand, real: {type: 'Text', props: {text: lineOf(line.text, card.words, totalOf)}}});
      required.push({id: `line_${card.piece}_${i}`, root: false, description: `The ${card.piece} line, saying ${saying(line.text)}: "${line.text}"`, element: stand});
    });
  for (const [table, ls] of rowLines) lists.get(table)!.controls.unshift(...ls);
  for (const l of lists.values())
    required.push({id: `list_${l.table}`, root: false, description: `The list of ${l.table}, one line per entry, each with ${l.controls.map((c) => c.description).join(', ')}`, element: {type: 'Separator', props: {}, visible: {$state: LIST(l.table)}}});
  const candidates: Candidate[] = [
    {id: 'card', maxUses: 3, description: 'A card: a puffy surface grouping what it holds', element: {type: 'Card', props: {}}},
    {id: 'stack', maxUses: 3, description: 'A column: its children one above the other', element: {type: 'Stack', props: {gap: 3}}},
    {id: 'row', maxUses: 3, root: false, description: 'A row: its children side by side', element: {type: 'Row', props: {gap: 2, align: 'center'}}},
    ...(headed ? [] : [{id: 'title', root: false, description: `The page title "${b.page.title}" as a heading`, element: heading}]),
    ...b.cards.map((c): Candidate => ({id: `purpose_${c.piece}`, root: false, description: `What the ${c.piece} piece is for, in muted text: "${c.purpose}"`, element: {type: 'Text', props: {text: c.purpose, muted: true}}})),
    ...required,
  ];
  return {candidates, required, lists, fields, writes, heading, lines};
}

function descriptionsOf(spec: Spec, candidates: Candidate[]): Record<string, string> {
  const by = new Map(candidates.map((c) => [recipeKey(c.element), c.description]));
  const own = (id: string) => by.get(recipeKey(atomic(spec.elements[id]))) ?? `Existing ${spec.elements[id].type}`;
  const short = (id: string): string => {
    const kids = spec.elements[id]?.children ?? [];
    return kids.length ? `a ${spec.elements[id].type} holding ${kids.map(short).join('; ')}` : own(id).split(':')[0];
  };
  return Object.fromEntries(
    Object.entries(spec.elements).map(([id, e]) => [id, id !== spec.root && e.children?.length ? `${own(id)}, holding ${e.children.map(short).join('; ')}` : own(id)]),
  );
}

const missing = (spec: Spec | null, required: Candidate[]) => {
  const have = new Set(Object.values(spec?.elements ?? {}).map((e) => recipeKey(atomic(e))));
  return required.filter((c) => !have.has(recipeKey(c.element)));
};

function expand(input: Spec, {lists, heading, fields, writes, lines}: Pieces): Spec {
  const spec: Spec = structuredClone({root: input.root, elements: input.elements});
  swap(spec, lines, 'stand', 'real');
  for (const [id, e] of Object.entries(spec.elements)) {
    const path = isObj(e.visible) ? e.visible.$state : undefined;
    const list = e.type === 'Separator' && typeof path === 'string' && path.startsWith('/tables/') ? lists.get(path.slice('/tables/'.length)) : undefined;
    if (list) {
      const row = `${id}_row`;
      const kids = list.controls.map((_, i) => `${id}_${i}`);
      spec.elements[id] = {type: 'Stack', props: {gap: 2}, repeat: {statePath: LIST(list.table), key: 'id'}, children: [row]};
      spec.elements[row] = {type: 'Row', props: {justify: 'between', align: 'center'}, children: kids};
      list.controls.forEach((c, i) => {
        if (c.type === 'Text') {
          spec.elements[kids[i]] = {type: 'Text', props: {text: c.label}, children: []};
          return;
        }
        if (c.type === 'DraftInput' || c.type === 'DraftNumber') {
          spec.elements[kids[i]] = {type: c.type, props: {label: c.label, ...(c.example === undefined ? {} : {placeholder: c.example}), value: {$bindState: `/draft/${c.draft}`}}, children: []};
          return;
        }
        const props: Json = {label: c.label, ...(c.checked === undefined ? {} : {checked: c.checked}), action: c.action, args: c.args};
        if (c.type === 'ActionSelect') Object.assign(props, {pick: c.pick, options: c.options, optionLabel: c.optionLabel, ...(c.value === undefined ? {} : {value: c.value})});
        if (c.type === 'ActionButton') Object.assign(props, {variant: 'quiet', size: 'sm'});
        const clear = Object.values(c.args ?? {}).flatMap((v) => (isObj(v) && typeof v.$state === 'string' ? [{action: 'setState', params: {statePath: v.$state, value: ''}}] : []));
        spec.elements[kids[i]] = {type: c.type, props, children: [], ...(c.type === 'ActionButton' && clear.length ? {on: {press: clear.length === 1 ? clear[0] : clear}} : {})};
      });
      continue;
    }
    if (e.type === 'ActionButton' && isObj(e.props.args)) {
      const paths = Object.values(e.props.args).map((v) => (isObj(v) ? v.$state : undefined)).filter((p): p is string => typeof p === 'string' && p.startsWith('/draft/'));
      const clear = paths.map((p) => ({action: 'setState', params: {statePath: p, value: ''}}));
      if (clear.length) e.on = {press: clear.length === 1 ? clear[0] : clear};
    }
  }
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
  inUseOrder(spec, fields, writes);
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

function inUseOrder(spec: Spec, fields: Pieces['fields'], writes: Pieces['writes']) {
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
    const boxes = keys.map((k) => els().find(([, e]) => (e.type === 'DraftInput' || e.type === 'DraftNumber') && draftOf(e) === k)?.[0]).filter((id): id is string => !!id);
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
  const all = els().filter(([, e]) => e.repeat?.statePath?.startsWith('/tables/')).map(([id]) => id);
  for (const [id, e] of els()) {
    if (e.type !== 'ActionButton' || e.props.args !== undefined) continue;
    const changed = (writes.get(String(e.props.action)) ?? []).map(LIST);
    const own = all.filter((l) => changed.includes(spec.elements[l].repeat!.statePath));
    const list = own.length === 1 ? own[0] : all.length === 1 ? all[0] : undefined;
    const listParent = list && parentOf(list);
    if (!list || !listParent) continue;
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

function swap(spec: Spec, lines: Line[], from: keyof Line, to: keyof Line) {
  const by = new Map(lines.map((l) => [recipeKey(l[from]), l[to]]));
  for (const e of Object.values(spec.elements)) {
    const other = e.on === undefined && e.visible === undefined ? by.get(recipeKey(atomic(e))) : undefined;
    if (other) e.props = structuredClone(other.props);
  }
}

function collapse(input: Spec, lines: Line[]): Spec {
  const spec: Spec = structuredClone({root: input.root, elements: input.elements});
  swap(spec, lines, 'real', 'stand');
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

const contextOf = (b: Bundle) => ({app: b.page.title, stories: b.page.stories.map((s) => s.sentence)});

export async function arrange(opts: {bundle: string; app: string; evaluate: Evaluator}): Promise<{versions: Record<string, Spec>; dropped: Record<string, string>; calls: number}> {
  const b = loadBundle(opts.bundle);
  const kit = await loadKit(opts.app);
  const set = arrangeSet();
  let calls = 0;
  const evaluate: Evaluator = (r) => {
    calls++;
    return opts.evaluate(r);
  };
  const versions: Record<string, Spec> = {};
  const dropped: Record<string, string> = {};
  const pieces = candidatesFor(b, kit);
  const {candidates, required} = pieces;
  const common = {catalog: kit.catalog, candidates, evaluate, instructions: {next: set.guidance}, context: contextOf(b)};
  const results = await Promise.all(
    Object.entries(set.versions).map(async ([v, sentence]) => {
      const prompt = [...b.page.summary, ...b.cards.map((c) => c.purpose), sentence].join(' ');
      let {spec} = await lastSpec(kit.compose({...common, prompt}));
      let left = missing(spec, required);
      if (spec && left.length) {
        spec = (await lastSpec(kit.compose({...common, initialSpec: spec, elementDescriptions: descriptionsOf(spec, candidates), prompt: `Add ${left.map((c) => c.description).join('; ')}`}))).spec;
        left = missing(spec, required);
      }
      return [v, left.length || !spec ? {why: `left out ${left.map((c) => c.description).join('; ')}`} : {spec: expand(spec, pieces)}] as const;
    }),
  );
  for (const [v, r] of results) {
    if ('spec' in r) versions[v] = r.spec;
    else dropped[v] = r.why;
  }
  return {versions, dropped, calls};
}

export async function reshape(opts: {bundle: string; app: string; spec: Spec; notes: string[]; evaluate: Evaluator}) {
  const b = loadBundle(opts.bundle);
  const kit = await loadKit(opts.app);
  const set = arrangeSet();
  const pieces = candidatesFor(b, kit);
  const {candidates, required} = pieces;
  const initialSpec = collapse(opts.spec, pieces.lines);
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
  const left = missing(out.spec, required);
  if (left.length) throw new CouldNotRun(`the reshaped screen left out ${left.map((c) => c.description).join('; ')}`);
  return {spec: expand(out.spec, pieces), steps: out.steps.map((s) => s.description)};
}

const USAGE = 'usage: arrange.ts <bundle> --app <dir> [--pick <V> | --reshape --note <text>...]';
const write = (path: string, spec: Spec) => writeFileSync(path, JSON.stringify(spec, null, 2) + '\n');

export function writeVersions(screens: string, kept: Record<string, Spec>) {
  if (Object.keys(kept).length) mkdirSync(screens, {recursive: true});
  if (existsSync(screens))
    for (const f of readdirSync(screens)) {
      const v = f.startsWith('screen.') && f.endsWith('.json') ? f.slice('screen.'.length, -'.json'.length) : '';
      if (v && !v.includes('.') && !Object.hasOwn(kept, v)) rmSync(join(screens, f));
    }
  for (const [v, spec] of Object.entries(kept)) write(join(screens, `screen.${v}.json`), spec);
}

async function main(argv: string[]): Promise<number> {
  const pos: string[] = [];
  const notes: string[] = [];
  const flags: Record<string, string> = {};
  let reshaping = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reshape') reshaping = true;
    else if (a === '--note' && i + 1 < argv.length) notes.push(argv[++i]);
    else if (['--app', '--pick'].includes(a) && i + 1 < argv.length) flags[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) return usage();
    else pos.push(a);
  }
  if (pos.length !== 1 || !flags.app || (flags.pick && reshaping) || (reshaping && !notes.length) || (notes.length && !reshaping)) return usage();
  const bundle = resolve(pos[0]);
  const app = resolve(flags.app);
  const screens = join(bundle, 'screens');
  const file = join(screens, 'screen.json');
  try {
    for (const f of [join(app, 'client', 'src', 'screens', 'catalog.ts'), join(app, 'client', 'src', 'store.js')])
      if (!existsSync(f)) throw new CouldNotRun(`no ${f}`);
    if (flags.pick) {
      if (!/^[A-Za-z0-9_-]+$/.test(flags.pick)) return usage();
      const from = join(screens, `screen.${flags.pick}.json`);
      if (!existsSync(from)) throw new CouldNotRun(`no version ${flags.pick} at ${from}`);
      copyFileSync(from, file);
      console.log(`ARRANGE picked ${flags.pick}`);
      return 0;
    }
    if (reshaping) {
      if (!existsSync(file)) throw new CouldNotRun(`no approved screen at ${file}`);
      const spec = JSON.parse(readFileSync(file, 'utf8'));
      const out = await reshape({bundle, app, spec, notes, evaluate: composeEvaluator()}).catch(fail);
      write(file, out.spec);
      for (const s of out.steps) console.log(`ARRANGE: ${s}`);
      console.log(`ARRANGE reshaped: ${out.steps.length} steps`);
      return 0;
    }
    const started = performance.now();
    const r = await arrange({bundle, app, evaluate: composeEvaluator()}).catch(fail);
    writeVersions(screens, r.versions);
    for (const [v, spec] of Object.entries(r.versions)) console.log(`ARRANGE ${v}: ${Object.keys(spec.elements).length} elements`);
    for (const [v, why] of Object.entries(r.dropped)) console.log(`ARRANGE ${v}: dropped, ${why}`);
    if (!Object.keys(r.versions).length) {
      console.log('ARRANGE exit 1: the page kept no version');
      return 1;
    }
    console.log(`ARRANGE ok: ${r.calls} Jev calls, ${Math.round(performance.now() - started)} ms`);
    return 0;
  } catch (e) {
    console.log(`ARRANGE could not run: ${(e as Error).message}`);
    return 2;
  }
}

function fail(e: unknown): never {
  throw new CouldNotRun((e as Error)?.message ?? String(e));
}

function usage(): number {
  console.log(USAGE);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
