// Given code: builders never edit this file. It makes the one synced store
// from the signed store module, hands every piece its section of the page,
// exposes the page hook the checker drives (window.__TINYAPP__), and offers
// the same tools to an agent over WebMCP when the browser has it.
import {createMergeableStore} from 'tinybase';
import {createWsSynchronizer} from 'tinybase/synchronizers/synchronizer-ws-client';
import {TOOLS, makeStore} from './store.js';
import {PIECES} from './pieces/index';

type Tool = {name: string; description: string; inputSchema: unknown; run: (store: unknown, args: Record<string, unknown>) => boolean};

declare global {
  interface Window {
    __TINYAPP_SYNC__?: string;
    __TINYAPP__?: unknown;
  }
}

const store = createMergeableStore().setTablesSchema(JSON.parse(makeStore().getTablesSchemaJson()));
const tools = Object.fromEntries((TOOLS as unknown as Tool[]).map((t) => [t.name, (args: Record<string, unknown>) => t.run(store, args)]));
const schemas = Object.fromEntries((TOOLS as unknown as Tool[]).map((t) => [t.name, t.inputSchema]));
const hook = {store, tools, schemas, synced: false};
window.__TINYAPP__ = hook;

const root = document.getElementById('app')!;
for (const [name, piece] of PIECES) {
  const section = document.createElement('section');
  section.dataset.piece = name;
  root.append(section);
  piece.mount(section, store, tools);
}

// WebMCP: the same TOOLS, offered to an agent in the browser, plus one read
// so it can find the row ids the tools take. The spec puts modelContext on
// document; Chrome's early preview put it on navigator. Absent, nothing
// registers and the page works as before.
type ModelContext = {registerTool: (tool: Record<string, unknown>) => Promise<unknown> | unknown};
const modelContext = ((document as unknown as {modelContext?: ModelContext}).modelContext
  ?? (navigator as unknown as {modelContext?: ModelContext}).modelContext);
if (modelContext) {
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

const origin = window.__TINYAPP_SYNC__ ?? `ws://${location.hostname}:8787`;
const synchronizer = await createWsSynchronizer(store, new WebSocket(`${origin}/sync/app`));
await synchronizer.startSync();
hook.synced = true;
