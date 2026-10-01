#!/usr/bin/env bun
// The preview server: draws a bundle's screens with a scaffolded TinyApp's own
// kit (registry, state, store, 1st-Pouf through Tailwind; nothing from a CDN)
// and pushes every change under <bundle>/screens/ to the open pages over a
// websocket so they redraw in place. /compare shows every version side by
// side; picks and notes come back on POST /feedback as JSON lines. GET
// /play?story=<id> has the open page play that story on the screen and answers
// the report it posts back to POST /played.
//
//   bun skills/ultrawrite/stories/preview.ts <bundle> --app <dir> [--port <n>] [--feedback <file>]
import {appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';

const PAGE = join(import.meta.dir, 'preview');
const NEEDS = ['client/src/screens/catalog.ts', 'client/src/store.js', 'node_modules/bun-plugin-tailwind'];
const VERSION = /^(.+)\.([A-Z])\.json$/;
const PLAY_WAIT = 20_000;

type Rec = Record<string, unknown>;

function usage(): number {
  console.log('usage: preview.ts <bundle> --app <dir> [--port <n>] [--feedback <file>]');
  return 2;
}

/** The record to write, keys in their fixed order, or null when it is not one. */
export function feedbackRecord(body: unknown): Rec | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Rec;
  const keys = Object.keys(b);
  if (b.kind === 'pick') {
    if (typeof b.chose !== 'string' || keys.some((k) => k !== 'kind' && k !== 'chose')) return null;
    return {kind: 'pick', chose: b.chose};
  }
  if (b.kind === 'element' || b.kind === 'region' || b.kind === 'view') {
    if (typeof b.note !== 'string' || keys.some((k) => !['kind', 'note', 'target'].includes(k))) return null;
    if ('target' in b && typeof b.target !== 'string') return null;
    return 'target' in b ? {kind: b.kind, target: b.target, note: b.note} : {kind: b.kind, note: b.note};
  }
  return null;
}

function readSpecs(screens: string, pieces: string[]): Rec {
  const out: Record<string, {versions: Rec; approved?: unknown}> = {};
  for (const p of pieces) out[p] = {versions: {}};
  const names = existsSync(screens) ? readdirSync(screens).sort() : [];
  const read = (n: string) => {
    try { return JSON.parse(readFileSync(join(screens, n), 'utf8')); } catch { return undefined; }
  };
  for (const n of names) {
    const m = VERSION.exec(n);
    if (m && out[m[1]]) {
      const spec = read(n);
      if (spec !== undefined) out[m[1]].versions[m[2]] = spec;
    } else if (n.endsWith('.json') && out[n.slice(0, -5)]) {
      const spec = read(n);
      if (spec !== undefined) out[n.slice(0, -5)].approved = spec;
    }
  }
  return out;
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
  let pieces: string[];
  try {
    page = JSON.parse(readFileSync(join(bundle, 'page.json'), 'utf8'));
    pieces = (JSON.parse(readFileSync(join(bundle, 'cards.json'), 'utf8')) as {piece: string}[]).map((c) => c.piece);
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

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === '/ws') {
        return srv.upgrade(req) ? undefined : new Response('websocket expected', {status: 400});
      }
      if (path === '/bundle' && req.method === 'GET') {
        return Response.json({title: page.title ?? '', stories: page.stories ?? []});
      }
      if (path === '/specs' && req.method === 'GET') return Response.json(readSpecs(screens, pieces));
      if (path === '/play' && req.method === 'GET') {
        const story = url.searchParams.get('story') ?? '';
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
      const file = resolve(dist, '.' + decodeURIComponent(path));
      if (file.startsWith(dist + sep) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
      return new Response('not found', {status: 404});
    },
    websocket: {
      open(ws) { ws.subscribe('specs'); },
      message() {},
      close(ws) { ws.unsubscribe('specs'); },
    },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(screens, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      server.publish('specs', JSON.stringify({type: 'specs', pieces: readSpecs(screens, pieces)}));
    }, 50);
  });

  console.log(`PREVIEW http://127.0.0.1:${server.port}/`);
  return await new Promise<number>(() => {});
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
