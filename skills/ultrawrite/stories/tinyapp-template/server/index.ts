// Given code: one Durable Object holds the app's store, saved to its SQLite.
import {createMergeableStore} from 'tinybase';
import {createDurableObjectSqlStoragePersister} from 'tinybase/persisters/persister-durable-object-sql-storage';
import {WsServerDurableObject, getWsServerDurableObjectFetch} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';

export class AppStore extends WsServerDurableObject {
  createPersister() {
    return createDurableObjectSqlStoragePersister(createMergeableStore(), this.ctx.storage.sql, {mode: 'fragmented'});
  }
}

const sync = getWsServerDurableObjectFetch('APP_STORE');

export default {
  fetch: (request: Request, env: unknown) =>
    new URL(request.url).pathname === '/' ? new Response('tinyapp root') : sync(request, env as never),
};
