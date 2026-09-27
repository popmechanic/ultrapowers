// Given code: builders never edit this file. It makes the one synced store
// from the signed store module, hands every piece its section of the page,
// and exposes the page hook the checker drives (window.__TINYAPP__).
import {createMergeableStore} from 'tinybase';
import {createWsSynchronizer} from 'tinybase/synchronizers/synchronizer-ws-client';
import {TOOLS, makeStore} from './store.js';
import {PIECES} from './pieces/index';

type Tool = {name: string; inputSchema: unknown; run: (store: unknown, args: Record<string, unknown>) => boolean};

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

const origin = window.__TINYAPP_SYNC__ ?? `ws://${location.hostname}:8787`;
const synchronizer = await createWsSynchronizer(store, new WebSocket(`${origin}/sync/app`));
await synchronizer.startSync();
hook.synced = true;
