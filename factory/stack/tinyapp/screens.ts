#!/usr/bin/env bun
// The screens checker: does every screen of this copy read as a json-render
// spec over its catalog, and does it run each of its piece's card actions?
// Browser-free: it imports the copy's catalog and store modules in Bun and
// reads client/src/pieces/<piece>.json. Exit 0 pass, 1 findings about the app,
// 2 could not run. It writes nothing.
import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';

const REPO = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');
const EXPRESSIONS = ['$state', '$item', '$index', '$bindState', '$bindItem', '$template', '$cond', '$computed'];

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

class CouldNotRun extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isExpression = (v: unknown) => isObj(v) && EXPRESSIONS.some((k) => k in v);
const underDraft = (p: unknown) => typeof p === 'string' && p.startsWith('/draft/');

/** The card actions per piece, in plan or bundle order. */
function piecesFrom(plan?: string, bundle?: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (piece: string, actions: string[]) => out.set(piece, [...(out.get(piece) ?? []), ...actions.filter((a) => !(out.get(piece) ?? []).includes(a))]);
  if (plan) {
    if (!existsSync(plan)) throw new CouldNotRun(`no plan at ${plan}`);
    const r = spawnSync('python3', [PARSER, plan], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    if (r.error || r.status !== 0) throw new CouldNotRun(`plan_parse.py could not read ${plan}: ${(r.stderr || String(r.error)).trim().split('\n').pop()}`);
    const parsed = JSON.parse(r.stdout);
    if (parsed.grammar !== 'stories-v1') throw new CouldNotRun(`${plan} is not a stories-v1 plan`);
    for (const t of parsed.tasks ?? []) if (t.piece) add(t.piece, (t.actions ?? []).map((a: unknown) => (isObj(a) ? String(a.name) : String(a))));
  } else if (bundle) {
    let cards: unknown;
    try { cards = JSON.parse(readFileSync(join(bundle, 'cards.json'), 'utf8')); } catch (e) {
      throw new CouldNotRun(`could not read ${join(bundle, 'cards.json')}: ${(e as Error).message}`);
    }
    if (!Array.isArray(cards)) throw new CouldNotRun(`${join(bundle, 'cards.json')} is not a list of cards`);
    for (const c of cards) add(String(c.piece), (c.actions ?? []).map((a: {name: string}) => a.name));
  } else {
    throw new CouldNotRun('neither --plan nor --bundle was given');
  }
  return out;
}

async function load(copy: string) {
  const catPath = join(copy, 'client', 'src', 'screens', 'catalog.ts');
  const storePath = join(copy, 'client', 'src', 'store.js');
  if (!existsSync(catPath)) throw new CouldNotRun(`no catalog module at ${catPath}`);
  if (!existsSync(storePath)) throw new CouldNotRun(`no store module at ${storePath}`);
  let cat: any, store: any;
  try { cat = await import(catPath); } catch (e) { throw new CouldNotRun(`could not load ${catPath}: ${(e as Error).message}`); }
  try { store = await import(storePath); } catch (e) { throw new CouldNotRun(`could not load ${storePath}: ${(e as Error).message}`); }
  if (!cat.components || !cat.BUILT_IN || typeof cat.catalogFor !== 'function') throw new CouldNotRun(`${catPath} does not export components, BUILT_IN and catalogFor`);
  if (!Array.isArray(store.TOOLS)) throw new CouldNotRun(`${storePath} does not export TOOLS`);
  const tools = store.TOOLS.map((t: {name: string; description?: string}) => ({name: t.name, description: t.description ?? ''}));
  return {components: cat.components as Record<string, {props: any}>, builtIn: cat.BUILT_IN as string[], catalog: cat.catalogFor(tools), actionNames: tools.map((t: {name: string}) => t.name) as string[]};
}

/** Every $bindState path anywhere under v. */
function bindStates(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) bindStates(x, out);
  else if (isObj(v)) {
    if ('$bindState' in v) out.push(String(v.$bindState));
    for (const x of Object.values(v)) bindStates(x, out);
  }
  return out;
}

type Loaded = Awaited<ReturnType<typeof load>>;

function checkPiece(copy: string, piece: string, actions: string[], c: Loaded): string[] {
  const file = join(copy, 'client', 'src', 'pieces', `${piece}.json`);
  if (!existsSync(file)) return [`no screen at client/src/pieces/${piece}.json`];
  let spec: any;
  try { spec = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    return [`client/src/pieces/${piece}.json is not JSON: ${(e as Error).message}`];
  }
  const found: string[] = [];
  const v = c.catalog.validate(spec);
  if (!v.success) {
    for (const i of v.error?.issues ?? []) found.push(`${(i.path ?? []).join('.') || '(spec)'}: ${i.message}`);
  }
  if (isObj(spec) && 'public' in spec && typeof spec.public !== 'boolean') found.push(`public cannot be ${JSON.stringify(spec.public)}`);
  const run = new Set<string>();
  const elements = isObj(spec) && isObj(spec.elements) ? spec.elements : {};
  const kids = (el: Record<string, unknown>): unknown[] =>
    [...(Array.isArray(el.children) ? el.children : []), ...Object.values(isObj(el.slots) ? el.slots : {}).flat()];
  const reached = new Set<string>();
  const root = isObj(spec) ? spec.root : undefined;
  if (typeof root !== 'string' || !isObj(elements[root])) found.push(`root ${JSON.stringify(root)} is no element`);
  else {
    const stack = [root];
    while (stack.length) {
      const key = stack.pop()!;
      const el = elements[key];
      if (reached.has(key) || !isObj(el) || el.visible === false) continue;
      reached.add(key);
      for (const ch of kids(el)) if (typeof ch === 'string') stack.push(ch);
    }
  }
  for (const [key, el] of Object.entries(elements)) {
    if (!isObj(el)) continue;
    for (const ch of kids(el)) if (typeof ch !== 'string' || !isObj(elements[ch])) found.push(`${key}: child ${JSON.stringify(ch)} is no element`);
    const type = String(el.type);
    const props = isObj(el.props) ? el.props : {};
    const schema = c.components[type]?.props;
    const shape = schema?.shape as Record<string, any> | undefined;
    if (shape) {
      for (const prop of Object.keys(props)) if (!(prop in shape)) found.push(`${key}: ${type} has no prop ${prop}`);
      const seen = new Set<string>();
      for (const i of schema.safeParse(props).error?.issues ?? []) {
        const prop = String(i.path[0]);
        if (seen.has(prop) || isExpression(props[prop])) continue;
        seen.add(prop);
        found.push(prop in props ? `${key}: ${type}.${prop} cannot be ${JSON.stringify(props[prop])}` : `${key}: ${type} needs prop ${prop}`);
      }
    }
    if (typeof props.action === 'string') {
      if (reached.has(key)) run.add(props.action);
      if (!c.actionNames.includes(props.action)) found.push(`${key}: ${props.action} is no action of the store`);
    }
    for (const binding of Object.values(isObj(el.on) ? el.on : {})) {
      for (const b of Array.isArray(binding) ? binding : [binding]) {
        if (!isObj(b)) continue;
        const action = String(b.action);
        if (!c.builtIn.includes(action)) found.push(`${key}: on runs ${action}, which is no built-in action (a card action runs from an action prop)`);
        const params = isObj(b.params) ? b.params : {};
        if ('statePath' in params && !underDraft(params.statePath)) found.push(`${key}: on ${action} writes ${String(params.statePath)}, which is outside /draft/`);
      }
    }
    for (const path of bindStates(props)) if (!underDraft(path)) found.push(`${key}: $bindState ${path} is outside /draft/`);
  }
  for (const a of actions) if (!run.has(a)) found.push(`no element runs ${a}`);
  return found;
}

async function main(): Promise<number> {
  const plan = arg('plan');
  const bundle = arg('bundle');
  const only = arg('piece');
  const copy = resolve(arg('copy', '.')!);
  const pieces = piecesFrom(plan ? resolve(plan) : undefined, bundle ? resolve(bundle) : undefined);
  if (only && !pieces.has(only)) throw new CouldNotRun(`the ${plan ? 'plan' : 'bundle'} has no task for piece ${only}`);
  const c = await load(copy);
  const names = only ? [only] : [...pieces.keys()];
  let n = 0;
  for (const piece of names) {
    for (const f of checkPiece(copy, piece, pieces.get(piece)!, c)) { console.log(`SCREENS ${piece}: ${f}`); n++; }
  }
  if (n) { console.log(`SCREENS exit 1: ${n} finding(s)`); return 1; }
  console.log(`SCREENS ok: ${names.join(', ')}`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log(`SCREENS could not run: ${e instanceof CouldNotRun ? e.message : (e as Error)?.stack?.split('\n')[0] ?? String(e)}`);
  process.exit(2);
});
