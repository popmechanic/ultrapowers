#!/usr/bin/env bun
import {copyFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {Aliases, type Content, type See, type UiStep} from '../../../factory/stack/tinyapp/probe';
import {loadBundle, type Step} from './bundle';
import {drawsPath, readDraws, type Draws} from './parts';

type Tool = {name: string; inputSchema?: unknown; run: (store: unknown, args: Record<string, unknown>, who: string | null) => boolean};
type StoreModule = {TOOLS: Tool[]; makeStore: () => {getContent: () => Content}};
type El = {type: string; props?: Record<string, unknown>; children?: string[]; visible?: unknown; repeat?: {statePath: unknown; key?: string}; on?: Record<string, unknown>};
type Screen = {root: string; elements: Record<string, El>};
type Core = {
  resolvePropValue: (v: unknown, ctx: Ctx) => unknown;
  evaluateVisibility: (c: unknown, ctx: Ctx) => boolean;
  splitRepeatVisibility: (c: unknown) => {container: unknown; itemFilter: unknown};
};
type Ctx = {stateModel: Record<string, unknown>; repeatItem?: unknown; repeatIndex?: number; repeatBasePath?: string; functions?: Record<string, unknown>};
type Drawn = {el: El; ctx: Ctx; role: string | null; name: string};

class CannotRun extends Error {}
class NotOffered extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function getPath(state: unknown, path: string): unknown {
  let cur = state;
  for (const seg of path.split('/').filter(Boolean)) cur = isObj(cur) || Array.isArray(cur) ? (cur as Record<string, unknown>)[seg] : undefined;
  return cur;
}

function drawAll(screen: Screen, draws: Draws, core: Core, functions: Record<string, unknown>, state: Record<string, unknown>): Drawn[] {
  const out: Drawn[] = [];
  const walk = (key: string, ctx: Ctx) => {
    const el = screen.elements[key];
    if (!el) return;
    const vis = el.repeat !== undefined && ctx.repeatBasePath === undefined ? core.splitRepeatVisibility(el.visible) : {container: el.visible, itemFilter: undefined};
    if (vis.container !== undefined && !core.evaluateVisibility(vis.container, ctx)) return;
    const part = draws[el.type];
    const role = part?.role ?? null;
    let name = '';
    if (role) {
      for (const p of part?.name ?? []) {
        name = text(core.resolvePropValue(el.props?.[p], ctx)).trim();
        if (name) break;
      }
    }
    out.push({el, ctx, role, name});
    if (!el.repeat) {
      for (const c of el.children ?? []) walk(c, ctx);
      return;
    }
    const sp = el.repeat.statePath;
    const path = typeof sp === 'string' ? sp
      : isObj(sp) && typeof sp.$item === 'string' && ctx.repeatBasePath !== undefined ? `${ctx.repeatBasePath}/${sp.$item}` : undefined;
    if (path === undefined) return;
    const items = getPath(state, path);
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const inner: Ctx = {...ctx, repeatItem: item, repeatIndex: index, repeatBasePath: `${path}/${index}`};
      if (vis.itemFilter !== undefined && !core.evaluateVisibility(vis.itemFilter, inner)) return;
      for (const c of el.children ?? []) walk(c, inner);
    });
  };
  walk(screen.root, {stateModel: state, functions});
  return out;
}

function seen(drawn: Drawn[]): See[] {
  const out: See[] = [];
  for (const d of drawn) {
    if (!d.role || !d.name) continue;
    const s = out.find((x) => x.role === d.role && x.name === d.name);
    if (s) s.count = (s.count ?? 0) + 1;
    else out.push({role: d.role, name: d.name, count: 1});
  }
  return out;
}

function draftInput(v: unknown, tool: string): string | null {
  if (!isObj(v) || typeof v.$bindState !== 'string') return null;
  const m = /^\/draft\/(.+)$/.exec(v.$bindState);
  if (!m) return null;
  return m[1].startsWith(`${tool}.`) ? m[1].slice(tool.length + 1) : m[1].includes('.') ? null : m[1];
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split('/').filter(Boolean);
  let cur = obj;
  segs.slice(0, -1).forEach((s) => {
    if (!isObj(cur[s])) cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  });
  if (segs.length) cur[segs[segs.length - 1]] = value;
}

export async function storyUi(bundleDir: string, appDir: string): Promise<number> {
  const b = loadBundle(bundleDir);
  const app = existsSync(appDir) ? realpathSync(resolve(appDir)) : resolve(appDir);
  const screenFile = join(b.dir, 'screens', 'screen.json');
  if (!existsSync(screenFile)) throw new CannotRun(`${screenFile} does not exist; pick a screen first`);
  const screen = JSON.parse(readFileSync(screenFile, 'utf8')) as Screen;
  if (!isObj(screen) || typeof screen.root !== 'string' || !isObj(screen.elements)) throw new CannotRun(`${screenFile} is not a screen spec`);
  const draws = readDraws(drawsPath(app));
  if (!draws) throw new CannotRun(`${drawsPath(app)} does not exist`);
  if (!existsSync(join(app, 'node_modules', 'tinybase'))) throw new CannotRun(`run bun install in ${app} first; the store module imports tinybase from there`);
  let core: Core;
  let functions: Record<string, unknown> = {};
  try {
    core = (await import(Bun.resolveSync('@json-render/core', app))) as Core;
    const fnFile = join(app, 'client', 'src', 'screens', 'functions.ts');
    if (existsSync(fnFile)) functions = ((await import(fnFile)) as {functions?: Record<string, unknown>}).functions ?? {};
  } catch (e) {
    throw new CannotRun(`the app's json-render or functions would not load: ${(e as Error).message}`);
  }
  const tmp = join(app, 'client', 'src', `.storyui-${process.pid}.js`);
  let mod: StoreModule;
  try {
    copyFileSync(join(b.dir, 'store.js'), tmp);
    mod = (await import(tmp)) as StoreModule;
  } catch (e) {
    throw new CannotRun(`the store module would not load: ${(e as Error).message}`);
  } finally {
    rmSync(tmp, {force: true});
  }
  const tools = new Map(mod.TOOLS.map((t) => [t.name, t]));

  let filled = 0;
  for (const s of b.page.stories) {
    const store = mod.makeStore();
    const aliases = new Aliases();
    let who: string | null | undefined;
    let draft: Record<string, unknown> = {};
    const pageState = (): Record<string, unknown> => {
      const [tables, values] = store.getContent();
      aliases.learn([tables, values]);
      const rows = Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, Object.entries(r).map(([id, cells]) => ({id, ...cells}))]));
      return {tables: rows, values, draft: structuredClone(draft), session: {staff: true, who: who ?? null}};
    };
    s.steps.forEach((st: Step, i) => {
      if (st.as !== undefined) who = st.as;
      const tool = tools.get(st.tool);
      if (!tool) throw new Error(`story ${s.id} step ${i + 1}: the store module has no tool ${st.tool}`);
      const args = st.args ?? {};
      const props = (isObj(tool.inputSchema) && isObj(tool.inputSchema.properties) ? tool.inputSchema.properties : {}) as Record<string, Record<string, unknown>>;
      const rowArgs = Object.keys(args).filter((k) => typeof props[k]?.['x-row-of'] === 'string');
      const real = aliases.args(args, tool.inputSchema);
      const beforeState = pageState();
      const before = st.layer === 'ui' ? drawAll(screen, draws, core, functions, beforeState) : [];
      tool.run(store, real, who ?? null);
      if (st.layer !== 'ui') {
        pageState();
        return;
      }
      const ui: UiStep[] = [];
      for (const d of before) {
        const isNumber = d.el.type === 'DraftNumber';
        if ((d.el.type !== 'DraftInput' && !isNumber) || !d.role || !d.name) continue;
        const input = draftInput(d.el.props?.value, st.tool);
        if (!input || !(input in args) || rowArgs.includes(input)) continue;
        const typed = text(args[input]);
        if (typed === '') continue;
        ui.push({type: {role: d.role, name: d.name, text: typed}});
        setPath(draft, (d.el.props!.value as Record<string, string>).$bindState.slice('/draft'.length), isNumber ? args[input] : typed);
      }
      const controls = before.filter((d) => d.el.props?.action === st.tool && d.role && d.name);
      const pickOf = (d: Drawn) => (d.el.type === 'ActionSelect' && typeof d.el.props?.pick === 'string' ? d.el.props.pick : null);
      const inRow = (d: Drawn) => {
        const keys = rowArgs.filter((k) => k !== pickOf(d));
        return keys.length > 0 && isObj(d.ctx.repeatItem) && keys.some((k) => (d.ctx.repeatItem as Record<string, unknown>).id === real[k]);
      };
      const control = controls.find(inRow) ?? controls.find((d) => d.ctx.repeatBasePath === undefined) ?? controls[0];
      const pick = control ? pickOf(control) : null;
      if (control && pick !== null) {
        const p = control.el.props!;
        const label = typeof p.optionLabel === 'string' ? p.optionLabel : 'name';
        const options = core.resolvePropValue(p.options, control.ctx);
        const row = (Array.isArray(options) ? options : []).find((r) => isObj(r) && r.id === real[pick]) as Record<string, unknown> | undefined;
        if (!row) {
          const table = props[pick]?.['x-row-of'];
          const rows = typeof table === 'string' ? (beforeState.tables as Record<string, Record<string, unknown>[]>)[table] : undefined;
          const cell = rows?.find((r) => r.id === real[pick])?.[label];
          const option = cell === undefined || cell === null || cell === '' ? text(args[pick]) : String(cell);
          throw new NotOffered(`STORYUI ${s.id} step ${i + 1}: the picker "${control.name}" does not offer ${option}`);
        }
        ui.push({select: {role: control.role!, name: control.name, option: String(row[label])}});
      } else if (control) {
        ui.push({click: {role: control.role!, name: control.name}});
        const press = control.el.on?.press;
        for (const a of Array.isArray(press) ? press : press ? [press] : []) {
          if (isObj(a) && a.action === 'setState' && isObj(a.params) && typeof a.params.statePath === 'string' && a.params.statePath.startsWith('/draft/')) {
            setPath(draft, a.params.statePath.slice('/draft'.length), a.params.value);
          }
        }
      }
      const after = seen(drawAll(screen, draws, core, functions, pageState()));
      const gone = seen(before).filter((x) => !after.some((y) => y.role === x.role && y.name === x.name)).map((x) => ({...x, count: 0}));
      st.ui = ui;
      st.see = [...after, ...gone];
      filled++;
    });
  }
  writeFileSync(join(b.dir, 'page.json'), JSON.stringify(b.page, null, 2) + '\n');
  return filled;
}

async function main(): Promise<number> {
  const {values: v, positionals} = parseArgs({allowPositionals: true, options: {app: {type: 'string'}}});
  if (positionals.length !== 1 || !v.app) {
    console.error('usage: storyui.ts <bundle> --app <dir>');
    return 2;
  }
  try {
    const n = await storyUi(positionals[0], v.app);
    console.log(`STORYUI ${n} step(s)`);
    return 0;
  } catch (e) {
    if (e instanceof NotOffered) {
      console.log(e.message);
      return 1;
    }
    console.log(`STORYUI could not run: ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) process.exit(await main());
