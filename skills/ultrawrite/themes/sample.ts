import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BunPlugin } from 'bun';
import { NOT_INSTALLED, installed, resolveTheme, themesDir } from './lib';

const ENTRY = 'theme-sample-client';
const DEFAULT_PORT = 8790;

const ready = installed();
const server = ready ? await import('react-dom/server') : null;
const react = ready ? await import('react') : null;
const sample = ready ? await import('./sample.tsx') : null;

function need<T>(value: T | null): T {
  if (value === null) throw new Error(NOT_INSTALLED);
  return value;
}

function markup(): string {
  return need(server).renderToString(need(react).createElement(need(sample).Sample));
}

export function renderedSlots(): string[] {
  const slots = new Set<string>();
  for (const m of markup().matchAll(/data-slot="([^"]+)"/g)) slots.add(m[1]);
  return [...slots].sort();
}

const clientEntry: BunPlugin = {
  name: 'theme-sample-client',
  setup(build) {
    build.onResolve({ filter: new RegExp(`^${ENTRY}$`) }, () => ({ path: ENTRY, namespace: 'theme-sample' }));
    build.onLoad({ filter: /.*/, namespace: 'theme-sample' }, () => ({
      loader: 'tsx',
      resolveDir: themesDir(),
      contents: [
        `import { createElement } from ${JSON.stringify(Bun.resolveSync('react', themesDir()))};`,
        `import { hydrateRoot } from ${JSON.stringify(Bun.resolveSync('react-dom/client', themesDir()))};`,
        `import { Sample } from ${JSON.stringify(join(themesDir(), 'sample.tsx'))};`,
        "hydrateRoot(document.getElementById('sample-root')!, createElement(Sample));",
      ].join('\n'),
    }));
  },
};

async function bundleClient(): Promise<string> {
  const out = await Bun.build({ entrypoints: [ENTRY], target: 'browser', plugins: [clientEntry], minify: true });
  if (!out.success) throw new AggregateError(out.logs, 'sample: the client build failed');
  return out.outputs[0].text();
}

const clientJs = ready ? await bundleClient() : '';

function inline(tag: 'style' | 'script', text: string, attrs: string): string {
  const safe = text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
  return `<${tag}${attrs}>${safe}</${tag}>`;
}

export function themeFiles(themeDir: string): string[] {
  const files = [join(themesDir(), 'structure.css')];
  const font = join(themeDir, 'font.css');
  if (existsSync(font)) files.push(font);
  files.push(join(themeDir, 'theme.css'));
  return files;
}

export function page(themeDir: string): string {
  const styles = themeFiles(themeDir)
    .map((file) => inline('style', readFileSync(file, 'utf8'), ` data-source="${file.split('/').pop()}"`))
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Theme sample</title>
${styles}
</head>
<body>
<div id="sample-root">${markup()}</div>
${inline('script', clientJs, ' type="module"')}
</body>
</html>`;
}

function fail(message: string): never {
  console.log(message);
  process.exit(2);
}

function main(argv: string[]): void {
  if (!ready) fail(NOT_INSTALLED);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (argv.includes('--slots')) {
    console.log(JSON.stringify(renderedSlots()));
    process.exit(0);
  }
  const themeArg = flag('--theme');
  if (!themeArg) fail('usage: bun sample.ts --theme <name or dir> [--port <n>] | --slots');
  let dir: string;
  try {
    dir = resolveTheme(themeArg).dir;
  } catch (e) {
    fail(`could not run: ${(e as Error).message}`);
  }
  if (!existsSync(join(dir, 'theme.css'))) fail(`could not run: ${dir} has no theme.css`);
  const portArg = flag('--port');
  const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`could not run: --port ${portArg} is not a port`);
  const served = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => new Response(page(dir), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  });
  console.log(`SAMPLE http://127.0.0.1:${served.port}/`);
}

if (import.meta.main) main(process.argv.slice(2));
