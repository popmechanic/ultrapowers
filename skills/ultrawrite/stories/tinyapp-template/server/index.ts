// Given code: one Durable Object holds the app's store, saved to its SQLite.
// /me says who is signed in: the email Cloudflare Access vouches for, or null.
import {createMergeableStore} from 'tinybase';
import {createDurableObjectSqlStoragePersister} from 'tinybase/persisters/persister-durable-object-sql-storage';
import {WsServerDurableObject, getWsServerDurableObjectFetch} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';

export class AppStore extends WsServerDurableObject {
  createPersister() {
    return createDurableObjectSqlStoragePersister(createMergeableStore(), this.ctx.storage.sql, {mode: 'fragmented'});
  }
}

const sync = getWsServerDurableObjectFetch('APP_STORE');

type Access = {getIdentity: () => Promise<{email?: string} | undefined>};

const me = async (ctx?: {access?: Access}) => {
  const id = ctx?.access ? await ctx.access.getIdentity().catch(() => undefined) : undefined;
  return Response.json({email: id?.email ?? null}, {headers: {'access-control-allow-origin': '*'}});
};

export default {
  fetch: (request: Request, env: unknown, ctx?: {access?: Access}) => {
    const path = new URL(request.url).pathname;
    if (path === '/') return new Response('tinyapp root');
    if (path === '/me') return me(ctx);
    return sync(request, env as never);
  },
};
