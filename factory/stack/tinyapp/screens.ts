#!/usr/bin/env bun
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');
const SCREEN = join('client', 'src', 'screen.json');
const EXPRESSIONS = ['$state', '$item', '$index', '$bindState', '$bindItem', '$template', '$cond', '$computed'];

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

class CouldNotRun extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isExpression = (v: unknown) => isObj(v) && EXPRESSIONS.some((k) => k in v);
const underDraft = (p: unknown) => typeof p === 'string' && p.startsWith('/draft/');
const DEFAULT_PATH: Record<string, string> = {validateForm: '/formValidation'};

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

function bindings(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) bindings(x, out);
  else if (isObj(v)) {
    if ('$bindState' in v && !underDraft(v.$bindState)) out.push(`$bindState ${String(v.$bindState)}`);
    if ('$bindItem' in v) out.push(`$bindItem ${String(v.$bindItem)}`);
    for (const x of Object.values(v)) bindings(x, out);
  }
  return out;
}

type Loaded = Awaited<ReturnType<typeof load>>;

function readSpec(copy: string, rel: string): {spec?: unknown; found: string[]} {
  const file = join(copy, rel);
  if (!existsSync(file)) return {found: [`no screen at ${rel}`]};
  try { return {spec: JSON.parse(readFileSync(file, 'utf8')), found: []}; } catch (e) {
    return {found: [`${rel} is not JSON: ${(e as Error).message}`]};
  }
}

function checkSpec(spec: any, c: Loaded, screen = false): {found: string[]; run: Set<string>} {
  const found: string[] = [];
  const v = c.catalog.validate(spec);
  if (!v.success) {
    for (const i of v.error?.issues ?? []) found.push(`${(i.path ?? []).join('.') || '(spec)'}: ${i.message}`);
  }
  const publicOk = (p: unknown) => screen ? Array.isArray(p) && p.every((id) => typeof id === 'string') : typeof p === 'boolean';
  if (isObj(spec) && 'public' in spec && !publicOk(spec.public)) found.push(`public cannot be ${JSON.stringify(spec.public)}`);
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
        if (!i.path?.length) {
          if (!seen.has('')) found.push(`${key}: ${type} props: ${i.message}`);
          seen.add('');
          continue;
        }
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
        if (!c.builtIn.includes(action)) continue;
        const params = isObj(b.params) ? b.params : {};
        const path = 'statePath' in params ? params.statePath : DEFAULT_PATH[action];
        if (path === undefined) found.push(`${key}: on ${action} names no statePath, so it writes outside /draft/`);
        else if (!underDraft(path)) found.push(`${key}: on ${action} writes ${String(path)}, which is outside /draft/`);
      }
    }
    for (const b of bindings(props)) found.push(`${key}: ${b} is outside /draft/`);
  }
  return {found, run};
}

function checkPiece(copy: string, piece: string, actions: string[], c: Loaded): string[] {
  const r = readSpec(copy, join('client', 'src', 'pieces', `${piece}.json`));
  if (r.found.length) return r.found;
  const {found, run} = checkSpec(r.spec, c);
  for (const a of actions) if (!run.has(a)) found.push(`no element runs ${a}`);
  return found;
}

export function checkParts(copy: string, components: Record<string, {props: any}>): string[] {
  const found: string[] = [];
  const drawsFile = join(copy, 'client', 'src', 'screens', 'draws.json');
  if (existsSync(drawsFile)) {
    let parts: Record<string, unknown> = {};
    try { parts = JSON.parse(readFileSync(drawsFile, 'utf8')).parts ?? {}; } catch (e) { found.push(`draws.json is not JSON: ${(e as Error).message}`); }
    for (const name of Object.keys(components)) {
      const line = parts[name];
      if (!isObj(line)) { found.push(`part ${name} has no line in client/src/screens/draws.json saying what it draws`); continue; }
      if (line.role !== null && typeof line.role !== 'string') found.push(`part ${name}: its draws.json role is neither a role nor null`);
      if (typeof line.role === 'string') {
        const props = Object.keys(components[name]?.props?.shape ?? {});
        const by = Array.isArray(line.name) ? line.name : [];
        if (!by.length) found.push(`part ${name} draws a ${line.role} but its draws.json line names no prop that names it`);
        for (const n of by) if (!props.includes(String(n))) found.push(`part ${name}: draws.json says ${n} names it, but it has no prop ${n}`);
      }
    }
    for (const name of Object.keys(parts)) if (!(name in components)) found.push(`draws.json has a line for ${name}, which is no part in catalog.ts`);
  }
  const pinFile = join(copy, 'client', 'src', 'pouf.vendor.json');
  const pouf = join(copy, 'client', 'src', 'pouf');
  if (existsSync(pinFile) && existsSync(pouf)) {
    const pins: Record<string, string> = JSON.parse(readFileSync(pinFile, 'utf8')).files ?? {};
    for (const [f, sha] of Object.entries(pins)) {
      const at = join(pouf, f);
      if (!existsSync(at)) { found.push(`client/src/pouf/${f} is gone; 1st-Pouf is vendored and never patched`); continue; }
      if (createHash('sha256').update(readFileSync(at)).digest('hex') !== sha) found.push(`client/src/pouf/${f} changed; 1st-Pouf is never patched, so wrap it in client/src/screens/registry.tsx instead`);
    }
    const walk = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel), {withFileTypes: true})
      .flatMap((e) => (e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)]));
    for (const f of walk(pouf)) if (!(f in pins)) found.push(`client/src/pouf/${f} is not 1st-Pouf's; a new part goes in client/src/screens/`);
  }
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
  for (const f of checkParts(copy, c.components)) { console.log(`SCREENS parts: ${f}`); n++; }
  if (existsSync(join(copy, SCREEN))) {
    const r = readSpec(copy, SCREEN);
    const {found, run} = r.found.length ? {found: r.found, run: new Set<string>()} : checkSpec(r.spec, c, true);
    for (const f of found) { console.log(`SCREENS screen: ${f}`); n++; }
    for (const piece of names) {
      for (const a of pieces.get(piece)!) if (!run.has(a)) { console.log(`SCREENS ${piece}: no element runs ${a}`); n++; }
    }
  } else {
    for (const piece of names) {
      for (const f of checkPiece(copy, piece, pieces.get(piece)!, c)) { console.log(`SCREENS ${piece}: ${f}`); n++; }
    }
  }
  if (n) { console.log(`SCREENS exit 1: ${n} finding(s)`); return 1; }
  console.log(`SCREENS ok: ${names.join(', ')}`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log(`SCREENS could not run: ${e instanceof CouldNotRun ? e.message : (e as Error)?.stack?.split('\n')[0] ?? String(e)}`);
  process.exit(2);
});
