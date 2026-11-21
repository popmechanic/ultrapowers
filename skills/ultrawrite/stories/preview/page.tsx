import {createMergeableStore} from 'tinybase';
import {createRoot} from 'react-dom/client';
import {useEffect, useRef, useState} from 'react';
import {JSONUIProvider, Renderer} from '@json-render/react';
import type {Spec} from '@json-render/core';
import {registry} from '../../client/src/screens/registry';
import {functions} from '../../client/src/screens/functions';
import {tinybaseState} from '../../client/src/screens/state';
import {TOOLS, makeStore} from '../../client/src/store.js';
import {mountComment} from './comment';
import {inTurn, play} from './play';

type Tool = {name: string; inputSchema?: {properties?: Record<string, Record<string, unknown>>}; run: (store: unknown, args: Record<string, unknown>, who: string | null) => boolean};
type Piece = {versions: Record<string, Spec>; approved?: Spec};
type Pieces = {screen: Piece};
type Story = {id: string; steps: {tool: string; args?: Record<string, unknown>; layer?: string}[]};

declare global {
  interface Window {
    __PREVIEW__?: {store: unknown; tools: Record<string, (args: Record<string, unknown>) => boolean>; playing: boolean};
  }
}

const list = TOOLS as unknown as Tool[];
const schema = JSON.parse(makeStore().getTablesSchemaJson());
const bind = (s: unknown) => Object.fromEntries(list.map((t) => [t.name, (args: Record<string, unknown>) => t.run(s, args, null)]));
const store = createMergeableStore().setTablesSchema(schema);
const tools = bind(store);
const schemas = Object.fromEntries(list.map((t) => [t.name, t.inputSchema]));
window.__PREVIEW__ = {store, tools, playing: false};

const takesRow = (t: Tool | undefined) =>
  Object.values(t?.inputSchema?.properties ?? {}).some((p) => p && typeof p === 'object' && 'x-row-of' in p);

const [bundle, initial] = await Promise.all([
  fetch('/bundle').then((r) => r.json() as Promise<{title: string; stories: Story[]}>),
  fetch('/specs').then((r) => r.json() as Promise<Pieces>),
]);
document.title = `${bundle.title} — preview`;

function fill(s: unknown) {
  const seen = new Set<string>();
  for (const story of bundle.stories ?? []) {
    for (const step of story.steps ?? []) {
      const tool = list.find((t) => t.name === step.tool);
      if (!tool || takesRow(tool)) continue;
      const key = JSON.stringify([step.tool, step.args ?? {}]);
      if (seen.has(key)) continue;
      seen.add(key);
      try { tool.run(s, step.args ?? {}, null); } catch {}
    }
  }
}
fill(store);

const viewer = () => ({staff: true, who: null});
const sandboxes = new Map<string, {state: ReturnType<typeof tinybaseState>; tools: ReturnType<typeof bind>}>();
function sandbox(key: string) {
  let box = sandboxes.get(key);
  if (!box) {
    const s = createMergeableStore().setTablesSchema(schema);
    fill(s);
    box = {state: tinybaseState(s, viewer), tools: bind(s)};
    sandboxes.set(key, box);
  }
  return box;
}

const compare = location.pathname.replace(/\/+$/, '') === '/compare';
const asked = new URLSearchParams(location.search).get('v');
const letters = (p: Piece) => Object.keys(p.versions ?? {}).sort();

async function playOne(id: string) {
  const story = (bundle.stories ?? []).find((s) => s.id === id);
  const report = story
    ? await inTurn(() => play(story, store, tools, schemas)).catch((e: unknown) => ({ok: false, misses: [`play failed: ${(e as Error).message}`]}))
    : {ok: false, misses: [`no story ${id}`]};
  await fetch('/played', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({story: id, ok: report.ok, misses: report.misses})});
}

function choose(v: string) {
  void fetch('/feedback', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({kind: 'pick', piece: 'screen', chose: v})});
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const recorded = (p: Piece) => (p.approved ? letters(p).find((v) => same(p.versions[v], p.approved)) : undefined);

const kept = (pick: string | null, prev: Pieces, next: Pieces) =>
  same(prev.screen?.versions ?? {}, next.screen?.versions ?? {}) ? pick : null;

function Page() {
  const [pieces, setPieces] = useState<Pieces>(initial);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = useRef<Pieces>(initial);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => ws?.send(JSON.stringify({type: 'hello', page: compare ? 'compare' : 'single'}));
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg?.type === 'specs' && msg.pieces) {
          const prev = shown.current;
          const next = msg.pieces as Pieces;
          shown.current = next;
          setPieces(next);
          setPicked((m) => kept(m, prev, next));
        }
        else if (msg?.type === 'play' && typeof msg.story === 'string' && !compare) void playOne(msg.story);
      };
      ws.onclose = () => { if (!stopped) setTimeout(open, 1000); };
    };
    open();
    return () => { stopped = true; ws?.close(); };
  }, []);

  const screen: Piece = pieces.screen ?? {versions: {}};
  if (compare) {
    return (
      <div className="preview-compare" data-compare="screen">
        {letters(screen).map((v) => {
          const chosen = (picked ?? recorded(screen)) === v;
          const box = sandbox(v);
          return (
            <section key={v} data-piece="screen" data-version={v} data-chosen={chosen ? '' : undefined}>
              <div className="preview-version-head">
                <span>{v}</span>
                <button
                  type="button"
                  className="preview-choose"
                  aria-pressed={chosen}
                  onClick={() => { setPicked(v); choose(v); }}
                >{chosen ? 'Chosen ✓' : `Choose ${v}`}</button>
              </div>
              <JSONUIProvider registry={registry} store={box.state} handlers={box.tools} functions={functions}>
                <Renderer spec={screen.versions[v]} registry={registry} />
              </JSONUIProvider>
            </section>
          );
        })}
      </div>
    );
  }
  const spec = screen.approved ?? (asked ? screen.versions?.[asked] : undefined) ?? screen.versions?.A;
  return (
    <div className="preview-single">
      {spec ? <section data-piece="screen"><Renderer spec={spec} registry={registry} /></section> : null}
    </div>
  );
}

createRoot(document.getElementById('app')!).render(
  <JSONUIProvider registry={registry} store={tinybaseState(store, viewer)} handlers={tools} functions={functions}>
    <Page />
  </JSONUIProvider>,
);
mountComment();
