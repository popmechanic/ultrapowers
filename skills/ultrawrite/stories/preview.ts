#!/usr/bin/env bun
// The preview server: draws a bundle's screens with a scaffolded TinyApp's own
// kit (registry, state, store, 1st-Pouf through Tailwind; nothing from a CDN)
// and pushes every change under <bundle>/screens/ to the open pages over a
// websocket so they redraw in place. The bundle has one whole-page screen
// (screens/screen.<V>.json, approved screens/screen.json); /compare shows its
// versions side by side; picks and notes come back on POST /feedback as JSON lines. GET
// /play?story=<id> has the open page play that story on the screen and answers
// the report it posts back to POST /played. Only this page talks to it (#1530):
// every request must name the server's own host, and the data routes refuse a
// browser request from any other site and a POST that is not JSON.
//
//   bun skills/ultrawrite/stories/preview.ts <bundle> --app <dir> [--port <n>] [--feedback <file>]
import {appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';

const PAGE = join(import.meta.dir, 'preview');
const NEEDS = ['client/src/screens/catalog.ts', 'client/src/store.js', 'node_modules/bun-plugin-tailwind'];
const VERSION = /^screen\.([A-Z])\.json$/;
const PLAY_WAIT = 20_000;

type Rec = Record<string, unknown>;

function usage(): number {
  console.log('usage: preview.ts <bundle> --app <dir> [--port <n>] [--feedback <file>]');
  return 2;
}

// The routes that read or change the operator's work; the page and its files
// stay open to a link from anywhere (the request carries no data).
const DATA = new Set(['/ws', '/bundle', '/specs', '/play', '/played', '/feedback']);

/** Why this request is refused, or null: another host (a DNS-rebound name), or,
 *  on a data route, a browser request from another site, or a POST not JSON.
 *  A request with no Origin and no Sec-Fetch-Site (curl, Claude) passes. */
export function foreign(req: Request, port: number): string | null {
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!own.includes(req.headers.get('host') ?? '')) return 'not this server\'s host';
  if (!DATA.has(new URL(req.url).pathname)) return null;
  const origin = req.headers.get('origin');
  if (origin !== null && !own.some((h) => origin === `http://${h}`)) return 'another site';
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return 'another site';
  if (req.method === 'POST' && !/^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) {
    return 'not JSON';
  }
  return null;
}

/** The record to write, keys in their fixed order, or null when it is not one. */
export function feedbackRecord(body: unknown): Rec | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Rec;
  const keys = Object.keys(b);
  if (b.kind === 'pick') {
    // {kind, piece, chose}; a page from before #1532 sent no piece, still taken.
    if (typeof b.chose !== 'string' || keys.some((k) => !['kind', 'piece', 'chose'].includes(k))) return null;
    if ('piece' in b && typeof b.piece !== 'string') return null;
    return 'piece' in b ? {kind: 'pick', piece: b.piece, chose: b.chose} : {kind: 'pick', chose: b.chose};
  }
  if (b.kind === 'element' || b.kind === 'region' || b.kind === 'view') {
    if (typeof b.note !== 'string' || keys.some((k) => !['kind', 'note', 'target'].includes(k))) return null;
    if ('target' in b && typeof b.target !== 'string') return null;
    return 'target' in b ? {kind: b.kind, target: b.target, note: b.note} : {kind: b.kind, note: b.note};
  }
  return null;
}

/** The one whole-page screen: its versions from screen.<V>.json, its approved
 *  spec from screen.json when there is one. Nothing else under screens/ counts. */
function readSpecs(screens: string): Rec {
  const screen: {versions: Rec; approved?: unknown} = {versions: {}};
  const names = existsSync(screens) ? readdirSync(screens).sort() : [];
  const read = (n: string) => {
    try { return JSON.parse(readFileSync(join(screens, n), 'utf8')); } catch { return undefined; }
  };
  for (const n of names) {
    const m = VERSION.exec(n);
    if (m || n === 'screen.json') {
      const spec = read(n);
      if (spec === undefined) continue;
      if (m) screen.versions[m[1]] = spec; else screen.approved = spec;
    }
  }
  return {screen};
}

async function main(argv: string[]): Promise<number> {
  let bundleArg: string | undefined;
  let appArg: string | undefined;
  let port = 0;
  let feedbackArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') appArg = argv[++i];
    else if (a === '--port') port = Number(argv[++i]);
    else if (a === '--feedback') feedbackArg = argv[++i];
    else if (!a.startsWith('--') && bundleArg === undefined) bundleArg = a;
    else return usage();
  }
  if (!bundleArg || !appArg || !Number.isInteger(port) || port < 0) return usage();
  const bundle = resolve(bundleArg);
  const app = resolve(appArg);
  const feedback = resolve(feedbackArg ?? join(process.cwd(), '.ultrapowers', 'feedback.jsonl'));

  for (const need of NEEDS) {
    if (!existsSync(join(app, need))) {
      console.log(`PREVIEW could not run: ${appArg} has no ${need}`);
      return 2;
    }
  }
  let page: {title?: string; stories?: unknown[]};
  try {
    page = JSON.parse(readFileSync(join(bundle, 'page.json'), 'utf8'));
  } catch (e) {
    console.log(`PREVIEW could not run: ${bundleArg} is not a bundle (${(e as Error).message})`);
    return 2;
  }

  const pageDir = join(app, '.preview', 'page');
  const dist = join(app, '.preview', 'dist');
  // Only this server's own dirs: arrange.ts stages its composer at .preview/json-render.
  rmSync(pageDir, {recursive: true, force: true});
  rmSync(dist, {recursive: true, force: true});
  mkdirSync(pageDir, {recursive: true});
  cpSync(PAGE, pageDir, {recursive: true});
  const tailwind = (await import(join(app, 'node_modules', 'bun-plugin-tailwind'))).default;
  const built = await Bun.build({entrypoints: [join(pageDir, 'index.html')], outdir: dist, plugins: [tailwind]})
    .catch((e: unknown) => ({success: false, logs: [e]}));
  if (!built.success) {
    for (const log of built.logs) console.log(log);
    console.log('PREVIEW could not run: the page did not build');
    return 2;
  }

  const screens = join(bundle, 'screens');
  mkdirSync(screens, {recursive: true});
  const indexHtml = join(dist, 'index.html');
  // Story plays awaiting a page's report, by story id.
  const plays = new Map<string, ((r: Rec) => void)[]>();
  // Open single-screen pages (said hello as 'single'): only they play stories.
  const singles = new Set<unknown>();

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    // Seconds; longer than PLAY_WAIT so a slow play ends in its JSON answer.
    idleTimeout: Math.ceil(PLAY_WAIT / 1000) + 10,
    async fetch(req, srv) {
      const refused = foreign(req, server.port);
      if (refused) return new Response(`refused: ${refused}`, {status: 403});
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === '/ws') {
        return srv.upgrade(req) ? undefined : new Response('websocket expected', {status: 400});
      }
      if (path === '/bundle' && req.method === 'GET') {
        return Response.json({title: page.title ?? '', stories: page.stories ?? []});
      }
      if (path === '/specs' && req.method === 'GET') return Response.json(readSpecs(screens));
      if (path === '/play' && req.method === 'GET') {
        const story = url.searchParams.get('story') ?? '';
        if (!singles.size) {
          const miss = `open http://127.0.0.1:${server.port}/ first: /play plays on that page, not on /compare`;
          return Response.json({story, ok: false, misses: [miss]});
        }
        const report = new Promise<Rec>((done) => {
          const waiting = plays.get(story) ?? [];
          plays.set(story, waiting);
          const answer = (r: Rec) => { clearTimeout(timeout); done(r); };
          const timeout = setTimeout(() => {
            const left = plays.get(story)?.filter((w) => w !== answer) ?? [];
            if (left.length) plays.set(story, left); else plays.delete(story);
            done({story, ok: false, misses: ['no page answered']});
          }, PLAY_WAIT);
          waiting.push(answer);
        });
        server.publish('specs', JSON.stringify({type: 'play', story}));
        return Response.json(await report);
      }
      if (path === '/played') {
        if (req.method !== 'POST') return new Response('POST only', {status: 405});
        let body: Rec;
        try { body = JSON.parse(await req.text()); } catch { return new Response('not JSON', {status: 400}); }
        if (!body || typeof body.story !== 'string' || typeof body.ok !== 'boolean' || !Array.isArray(body.misses)) {
          return new Response('not a play report', {status: 400});
        }
        const waiting = plays.get(body.story) ?? [];
        plays.delete(body.story);
        for (const answer of waiting) answer({story: body.story, ok: body.ok, misses: body.misses.map(String)});
        return new Response(null, {status: 204});
      }
      if (path === '/feedback') {
        if (req.method !== 'POST') return new Response('POST only', {status: 405});
        let body: unknown;
        try { body = JSON.parse(await req.text()); } catch { return new Response('not JSON', {status: 400}); }
        const rec = feedbackRecord(body);
        if (!rec) return new Response('not a feedback record', {status: 400});
        mkdirSync(dirname(feedback), {recursive: true});
        appendFileSync(feedback, JSON.stringify(rec) + '\n');
        return new Response(null, {status: 204});
      }
      if (path === '/' || path === '/compare' || path === '/compare/') {
        return new Response(Bun.file(indexHtml), {headers: {'content-type': 'text/html; charset=utf-8'}});
      }
      let decoded: string;
      try { decoded = decodeURIComponent(path); } catch { return new Response('bad path', {status: 400}); }
      const file = resolve(dist, '.' + decoded);
      if (file.startsWith(dist + sep) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
      return new Response('not found', {status: 404});
    },
    websocket: {
      open(ws) { ws.subscribe('specs'); },
      message(ws, raw) {
        let msg: Rec;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg?.type === 'hello') { if (msg.page === 'single') singles.add(ws); else singles.delete(ws); }
      },
      close(ws) { ws.unsubscribe('specs'); singles.delete(ws); },
    },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(screens, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      server.publish('specs', JSON.stringify({type: 'specs', pieces: readSpecs(screens)}));
    }, 50);
  });

  console.log(`PREVIEW http://127.0.0.1:${server.port}/`);
  return await new Promise<number>(() => {});
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
