#!/usr/bin/env bun
// The state-probe checker: does this story step come true in this copy of the
// app? Builds the page to a temp dir, serves it on loopback, starts celld on a
// temp copy of the server, sets the scene through the page's own actions,
// checks the ending is not already true, does the step by role and name,
// checks the store and the screen, restarts celld and reads the store back in
// a fresh browser. Exit 0 pass, 1 a finding about the app, 2 could not run.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {launchBrowser, type Browser, type Page} from './browser';
import {startCelld, EnvError, type Celld} from './celld';
import {Aliases, failing, hollow, probeFromPlan, type Content, type Probe, type ToolCall, type UiStep} from './probe';
import {stepDiff, type DiffEntry} from './diff';

type Stage = 'ok' | 'build' | 'load' | 'given' | 'before' | 'do' | 'after' | 'see' | 'saved' | 'env';
type Result = {
  clause: string; exit: 0 | 1 | 2; stage: Stage; message: string; did: unknown[];
  before?: Content; after?: Content; saved?: Content; screen_text?: string;
  diff?: DiffEntry[];
};

class Finding extends Error {
  constructor(public stage: Stage, message: string) { super(message); }
}

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const PLAN = arg('plan');
const CLAUSE = arg('clause');
const COPY = resolve(arg('copy', '.')!);
const BUDGET_MS = Number(arg('budget-ms', '45000'));
const READ = 'JSON.stringify(window.__TINYAPP__.store.getContent())';
const DEADLINE = Date.now() + BUDGET_MS;
const cleanups: (() => Promise<unknown>)[] = [];
const ctx: Partial<Result> = {};

// Past the budget, main stops waiting on the run, but the run is still going:
// it must start nothing more, and whatever it is starting right now must be
// owned before cleanup, or a celld or a browser outlives the check.
let aborted = false;
const starting = new Set<Promise<unknown>>();

class Aborted extends Error {}

const alive = () => {
  if (aborted) throw new Aborted('past the budget');
};

/** Starts a process-backed thing and registers its stop before anything else runs. */
const own = <T>(start: () => Promise<T>, stop: (t: T) => Promise<unknown>): Promise<T> => {
  alive();
  const p = start().then((t) => {
    cleanups.push(() => stop(t));
    alive();
    return t;
  });
  starting.add(p);
  p.catch(() => {}).finally(() => starting.delete(p));
  return p;
};

const waitFor = async (page: Page, expr: string, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(`!!(${expr})`).catch(() => false)) return true;
    await Bun.sleep(50);
  }
  return false;
};

const read = async (page: Page) => JSON.parse((await page.evaluate(READ)) as string) as Content;

const toAction = (d: UiStep) => {
  if ('click' in d) return {click: {role: d.click.role, name: d.click.name}};
  if ('type' in d) return {type: [{role: d.type.role, name: d.type.name}, d.type.text] as [{role: string; name: string}, string]};
  return {key: [{role: d.key.role, name: d.key.name}, d.key.key] as [{role: string; name: string}, string]};
};

const locatorWords = (d: UiStep) => {
  const l = Object.values(d)[0] as {role: string; name: string};
  return `${l.role} named "${l.name}"`;
};

async function build(): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'tinyapp-page-'));
  cleanups.push(async () => rmSync(out, {recursive: true, force: true}));
  // Spawned, not spawnSync: a synchronous build would hold the budget timer.
  const cmd = existsSync(join(COPY, 'scripts', 'build-client.ts'))
    ? [process.execPath, 'scripts/build-client.ts', out]
    : [process.execPath, 'build', './client/index.html', '--outdir', out];
  const proc = Bun.spawn(cmd,
    {cwd: COPY, stdout: 'pipe', stderr: 'pipe'});
  cleanups.push(async () => { proc.kill('SIGKILL'); await proc.exited; });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  alive();
  if (code !== 0) {
    throw new Finding('build', 'the page does not build:\n' + (stdout + stderr).slice(-800));
  }
  return out;
}

function serve(dist: string) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      const f = join(dist, p === '/' ? 'index.html' : p.slice(1));
      return new Response(Bun.file(existsSync(f) ? f : join(dist, 'index.html')));
    },
  });
  cleanups.push(async () => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

async function browser(): Promise<Browser> {
  try {
    return await own(() => launchBrowser(), (b) => b.close());
  } catch (e) {
    throw e instanceof Aborted ? e : new EnvError(String((e as Error).message));
  }
}

const celldAt = (opts: {dir?: string; clean?: boolean} = {}) =>
  own(() => startCelld(COPY, {...opts, readyMs: Math.max(1000, Math.min(20000, DEADLINE - Date.now()))}),
    (c) => c.stop());

async function open(b: Browser, origin: string, celld: Celld): Promise<Page> {
  const page = await b.openUrl!({
    url: origin + '/', origin, clock: new Date().toISOString(),
    prelude: `window.__TINYAPP_SYNC__ = ${JSON.stringify(celld.ws)};`,
    allow: [celld.url, celld.ws],
  });
  if (!(await waitFor(page, 'window.__TINYAPP__ && window.__TINYAPP__.synced === true', 10000))) {
    throw new Finding('load', 'the page never finished loading and syncing (window.__TINYAPP__.synced stayed false)');
  }
  return page;
}

// Who is signed in: the page hook's `who`, which the page passes to every action.
const signIn = (page: Page, who: string | null) =>
  page.evaluate(`window.__TINYAPP__.who = ${JSON.stringify(who)}; true`);

async function callTool(page: Page, aliases: Aliases, schemas: Record<string, unknown>, g: ToolCall, stage: Stage) {
  if (g.as !== undefined) await signIn(page, g.as);
  const args = aliases.args(g.args, schemas[g.tool]);
  const ok = await page.evaluate(`window.__TINYAPP__.tools[${JSON.stringify(g.tool)}](${JSON.stringify(args)})`)
    .catch((e) => String(e));
  if (ok !== true) throw new Finding(stage, `${g.tool}(${JSON.stringify(g.args)}) was refused${ok === false ? '' : ': ' + ok}`);
  aliases.learn(await read(page));
}

async function run(probe: Probe): Promise<Result> {
  ctx.did = probe.do;
  const dist = await build();
  const origin = serve(dist);
  let celld = await celldAt();
  const first = await browser();
  const page = await open(first, origin, celld);
  const aliases = new Aliases();
  const schemas = JSON.parse((await page.evaluate('JSON.stringify(window.__TINYAPP__.schemas)')) as string);

  for (const g of probe.given) await callTool(page, aliases, schemas, g, 'given');
  aliases.learn(await read(page));
  ctx.before = aliases.rename(await read(page));
  if (hollow(probe, ctx.before)) {
    throw new Finding('before', 'hollow: every check already holds before the step, so the step proves nothing');
  }

  if (probe.as !== undefined) await signIn(page, probe.as);
  for (const d of probe.do) {
    if ('tool' in d) { await callTool(page, aliases, schemas, d as ToolCall, 'do'); continue; }
    try {
      await page.act(toAction(d as UiStep) as never);
    } catch {
      throw new Finding('do', `there is no ${locatorWords(d as UiStep)} on the screen to use`);
    }
  }

  const settle = async (p: Page, ms: number) => {
    const end = Date.now() + ms;
    for (;;) {
      aliases.learn(await read(p));
      const now = aliases.rename(await read(p));
      const bad = failing(probe, now, ctx.before);
      if (!bad.length || Date.now() > end) return {now, bad};
      await Bun.sleep(100);
    }
  };
  const after = await settle(page, 3000);
  ctx.after = after.now;
  ctx.diff = stepDiff(ctx.before, ctx.after);
  if (after.bad.length) throw new Finding('after', 'after the step: ' + after.bad.join('; '));

  for (const s of probe.see ?? []) {
    const n = await page.count({role: s.role, name: s.name});
    const want = s.count ?? 1;
    if (s.count === undefined ? n < 1 : n !== want) {
      throw new Finding('see', `expected ${want} ${s.role} named "${s.name}" on the screen, saw ${n}`);
    }
  }
  ctx.screen_text = String(await page.evaluate('document.body.innerText'));

  await page.close();
  alive();
  await celld.stop(true);
  // Its cleanup stays registered: stopping a stopped celld is a no-op, and the
  // restarted one's own cleanup, which runs first, removes the shared dir.
  celld = await celldAt({dir: celld.dir, clean: false});
  const second = await browser();
  const fresh = await open(second, origin, celld).catch((e) => {
    throw e instanceof Finding ? new Finding('saved', 'after a server restart the page did not load: ' + e.message) : e;
  });
  const end = Date.now() + 10000;
  let bad: string[] = [];
  for (;;) {
    // the same aliases: the saved rows are the rows made before the restart
    const renamed = aliases.rename(await read(fresh));
    ctx.saved = renamed;
    bad = failing(probe, renamed, ctx.before);
    if (!bad.length || Date.now() > end) break;
    await Bun.sleep(200);
  }
  if (bad.length) throw new Finding('saved', 'after a server restart, in a fresh browser: ' + bad.join('; '));
  return {clause: CLAUSE!, exit: 0, stage: 'ok', message: 'every check holds after the step and after a restart', did: probe.do, ...ctx} as Result;
}

function write(r: Result) {
  // A guard clause's id (e.g. `G:p0/S2.3`) carries a `/`; a result file is one
  // path segment, so every `/` in the clause becomes `_`.
  const safeClause = r.clause.replace(/\//g, '_');
  const out = arg('out') ?? (process.env.FLOCK_CHECK_OUT ? join(process.env.FLOCK_CHECK_OUT, `${safeClause}@${basename(COPY)}.json`) : undefined);
  if (out) { mkdirSync(dirname(out), {recursive: true}); writeFileSync(out, JSON.stringify(r)); }
  console.log(`CHECK ${r.clause} exit ${r.exit} at ${r.stage}: ${r.message}`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
}

async function cleanup() {
  for (let c = cleanups.pop(); c; c = cleanups.pop()) await c().catch(() => {});
}

async function main() {
  if (!PLAN || !CLAUSE) { console.log('usage: check.ts --plan <plan.md> --clause <id> [--copy <dir>] [--out <file>] [--budget-ms <n>] [--json]'); process.exit(2); }
  const clause = CLAUSE;
  let probe: Probe | undefined;
  const failed = (e: unknown): Result => e instanceof Finding
    ? {clause, exit: 1, stage: e.stage, message: e.message, did: probe?.do ?? [], ...ctx} as Result
    : {clause, exit: 2, stage: 'env', message: String((e as Error)?.message ?? e), did: probe?.do ?? [], ...ctx} as Result;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveStopped!: (r: Result) => void;
  const stopped = new Promise<Result>((res) => { resolveStopped = res; });
  // The budget timeout and a SIGTERM/SIGINT (the Flock's 60 s runFacts timeout
  // sends SIGTERM) both stop the run the same way: mark aborted so in-flight
  // starts are owned before cleanup, then resolve the race with an exit-2 env
  // finding, never leaving a celld or browser running past the process.
  const stopWith = (message: string) => {
    aborted = true;
    resolveStopped({clause, exit: 2, stage: 'env', message, did: probe?.do ?? [], ...ctx} as Result);
  };
  timer = setTimeout(() => stopWith(`the check ran past its ${BUDGET_MS} ms budget`), BUDGET_MS);
  const onSignal = () => stopWith('the check was stopped');
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  const work = (async () => {
    probe = probeFromPlan(readFileSync(PLAN, 'utf8'), clause);
    return run(probe);
  })().catch(failed);
  const r = await Promise.race([work, stopped]);
  clearTimeout(timer);
  process.off('SIGTERM', onSignal);
  process.off('SIGINT', onSignal);
  if (aborted) {
    // Whatever the run was starting when the budget ran out is owned once it
    // settles; each start is itself bounded by the budget (readyMs) or a
    // fixed launch timeout.
    while (starting.size) await Promise.allSettled([...starting]);
  }
  await cleanup();
  write(r);
  process.exit(r.exit);
}

await main();
