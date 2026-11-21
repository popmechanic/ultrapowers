import {createMergeableStore} from 'tinybase';
import {createWsSynchronizer} from 'tinybase/synchronizers/synchronizer-ws-client';
import {TOOLS, makeStore} from './store.js';
import {isStaff, loadPublic} from './public';
import {createRoot} from 'react-dom/client';
import {JSONUIProvider, Renderer} from '@json-render/react';
import type {Spec} from '@json-render/core';
import {registry} from './screens/registry';
import {functions} from './screens/functions';
import {tinybaseState} from './screens/state';
import {pieceSpecs, screenSpec} from './screens/pieces' with {type: 'macro'};

type Tool = {name: string; description: string; inputSchema: unknown; run: (store: unknown, args: Record<string, unknown>, who: string | null) => boolean};

declare global {
  interface Window {
    __TINYAPP_SYNC__?: string;
    __TINYAPP_WHO__?: string | null;
    __TINYAPP__?: unknown;
  }
}

const store = createMergeableStore().setTablesSchema(JSON.parse(makeStore().getTablesSchemaJson()));
const hook = {store, tools: {} as Record<string, (args: Record<string, unknown>) => boolean>, schemas: {} as Record<string, unknown>, synced: false, who: null as string | null};
const tools = Object.fromEntries((TOOLS as unknown as Tool[]).map((t) => [t.name, (args: Record<string, unknown>) => t.run(store, args, hook.who)]));
const schemas = Object.fromEntries((TOOLS as unknown as Tool[]).map((t) => [t.name, t.inputSchema]));
hook.tools = tools;
hook.schemas = schemas;
const staff = isStaff(location.pathname, window.__TINYAPP_SYNC__);
window.__TINYAPP__ = hook;

const state = tinybaseState(store, () => ({staff, who: hook.who}));
type Screen = Spec & {public?: string[]};
function shown(screen: Screen): Spec {
  if (staff || screen.public?.includes(screen.root)) return screen;
  const root = screen.elements[screen.root];
  const ids = (screen.public ?? []).filter((id) => id in screen.elements);
  return {...screen, elements: {...screen.elements, [screen.root]: {...root, children: ids}}} as Spec;
}
const screen = screenSpec() as Screen | null;
const pieces = Object.entries(pieceSpecs() as Record<string, Spec & {public?: boolean}>)
  .filter(([, spec]) => staff || spec.public === true);
createRoot(document.getElementById('app')!).render(
  <JSONUIProvider registry={registry} store={state} handlers={tools} functions={functions}>
    {screen ? <Renderer spec={shown(screen)} registry={registry} /> : pieces.map(([name, spec]) => (
      <section key={name} data-piece={name}><Renderer spec={spec} registry={registry} /></section>
    ))}
  </JSONUIProvider>,
);

type ModelContext = {registerTool: (tool: Record<string, unknown>) => Promise<unknown> | unknown};
const modelContext = ((document as unknown as {modelContext?: ModelContext}).modelContext
  ?? (navigator as unknown as {modelContext?: ModelContext}).modelContext);
if (staff && modelContext) {
  for (const t of TOOLS as unknown as Tool[]) {
    void modelContext.registerTool({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      execute: async (args: Record<string, unknown>) => (tools[t.name](args ?? {})
        ? {done: true, tables: store.getTables()}
        : {done: false, refused: `${t.name} refused ${JSON.stringify(args ?? {})}; nothing changed`}),
    });
  }
  void modelContext.registerTool({
    name: 'readTables',
    description: 'Read everything the app holds: each table, its rows by id, and their cells.',
    inputSchema: {type: 'object', properties: {}},
    annotations: {readOnlyHint: true},
    execute: async () => store.getTables(),
  });
}

if (!staff) {
  hook.synced = await loadPublic(store);
  setInterval(() => { void loadPublic(store); }, 5000);
} else {
  const origin = window.__TINYAPP_SYNC__ ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  hook.who = window.__TINYAPP_WHO__ !== undefined ? window.__TINYAPP_WHO__
    : await fetch(`${origin.replace(/^ws/, 'http')}/me`, {credentials: 'include', signal: AbortSignal.timeout(3000)})
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: {email?: string | null}) => m.email ?? null)
      .catch(() => null);
  state.refresh();
  const synchronizer = await createWsSynchronizer(store, new WebSocket(`${origin}/sync/app`));
  await synchronizer.startSync();
  hook.synced = true;
}
