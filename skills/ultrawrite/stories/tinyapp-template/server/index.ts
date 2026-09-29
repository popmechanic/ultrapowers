// Given code: one Durable Object holds the app's store, saved to its SQLite.
// /me says who is signed in: the email Cloudflare Access vouches for, or null.
// /public.json is the store's content as JSON; /health says the Worker is up;
// any other path is the packed page (client-files.ts, written by `bun run pack`).
import {createMergeableStore} from 'tinybase';
import {createDurableObjectSqlStoragePersister} from 'tinybase/persisters/persister-durable-object-sql-storage';
import {WsServerDurableObject, getWsServerDurableObjectFetch} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';
import {FILES} from './client-files';

export class AppStore extends WsServerDurableObject {
  createPersister() {
    return createDurableObjectSqlStoragePersister(createMergeableStore(), this.ctx.storage.sql, {mode: 'fragmented'});
  }

  // A string, because the content object does not survive the RPC boundary.
  async snapshot(): Promise<string> {
    const store = createMergeableStore();
    await createDurableObjectSqlStoragePersister(store, this.ctx.storage.sql, {mode: 'fragmented'}).load();
    return JSON.stringify(store.getContent());
  }
}

const sync = getWsServerDurableObjectFetch('APP_STORE');

type Access = {getIdentity: () => Promise<{email?: string} | undefined>};

const me = async (ctx?: {access?: Access}) => {
  const id = ctx?.access ? await ctx.access.getIdentity().catch(() => undefined) : undefined;
  return Response.json({email: id?.email ?? null}, {headers: {'access-control-allow-origin': '*'}});
};

type Env = {APP_STORE: {idFromName: (name: string) => unknown; get: (id: unknown) => {snapshot: () => Promise<string>}}};

// TinyBase names the Durable Object after the sync path without its leading '/'.
const snapshot = async (env: Env) => {
  const stub = env.APP_STORE.get(env.APP_STORE.idFromName('sync/app'));
  return new Response(await stub.snapshot(), {
    headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
  });
};

const page = (path: string) => {
  const file = FILES[path] ?? FILES['/index.html'];
  if (!file) return new Response('The page is not packed: run `bun run pack`.', {status: 404});
  const body = file.base64 !== undefined
    ? Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))
    : (file.text ?? '');
  return new Response(body, {headers: {'content-type': file.type}});
};

export default {
  fetch: (request: Request, env: unknown, ctx?: {access?: Access}) => {
    const path = new URL(request.url).pathname;
    if (path === '/health') return Response.json({ok: true});
    if (path === '/me') return me(ctx);
    if (path === '/public.json') return snapshot(env as Env);
    if (path.startsWith('/sync/')) return sync(request, env as never);
    return page(path);
  },
};
