// One celld per check, on a temp copy of the app's server/, so nothing is
// written inside the builder's copy. Restart (clean: false) reloads the
// Durable Object's SQLite from the same temp dir: that is the saved-check.
import {cpSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

export class EnvError extends Error {}

export type Celld = {
  url: string;
  ws: string;
  port: number;
  dir: string;
  stop(keepDir?: boolean): Promise<void>;
};

const freePort = (): Promise<number> =>
  new Promise((ok, no) => {
    const s = createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as {port: number}).port;
      s.close(() => ok(port));
    });
  });

const portFree = (port: number): Promise<boolean> =>
  new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
  });

export const startCelld = async (
  appDir: string,
  opts: {dir?: string; clean?: boolean; readyMs?: number} = {},
): Promise<Celld> => {
  const bin = process.env.CELLD_BIN || Bun.which('celld');
  if (!bin) throw new EnvError('celld is not on PATH (set CELLD_BIN)');
  const app = resolve(appDir);
  let dir = opts.dir;
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'tinyapp-celld-'));
    cpSync(join(app, 'server'), dir, {
      recursive: true,
      filter: (p) => !p.includes('node_modules'),
    });
    symlinkSync(join(app, 'node_modules'), join(dir, 'node_modules'));
  }
  const port = await freePort();
  const argv = [bin, 'dev', dir, '--no-watch', ...(opts.clean === false ? [] : ['--clean']), '--port', String(port)];
  const proc = Bun.spawn(argv, {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      CELLD_ESBUILD: join(app, 'node_modules', '.bin', 'esbuild'),
      CELLD_MAX_RSS_MB: process.env.CELLD_MAX_RSS_MB ?? '512',
    },
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = async (keepDir = false) => {
    proc.kill('SIGTERM');
    await proc.exited;
    for (let i = 0; i < 100 && !(await portFree(port)); i++) await Bun.sleep(100);
    if (!keepDir) rmSync(dir!, {recursive: true, force: true});
  };
  const deadline = Date.now() + (opts.readyMs ?? 20000);
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const err = await new Response(proc.stderr).text();
      throw new EnvError(`celld exited ${proc.exitCode} before it was ready:\n${err.slice(-600)}`);
    }
    try {
      const body = await (await fetch(url + '/')).text();
      if (body.includes('tinyapp root')) {
        return {url, ws: `ws://127.0.0.1:${port}`, port, dir, stop};
      }
    } catch {}
    await Bun.sleep(100);
  }
  await stop();
  throw new EnvError(`celld was not ready on ${url} within ${opts.readyMs ?? 20000} ms`);
};
