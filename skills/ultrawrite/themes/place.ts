import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findings } from './check.ts';
import { NOT_INSTALLED, installed, resolveTheme, themesDir, uiCell } from './lib.ts';

const USAGE = 'usage: place.ts --theme <name or dir> --app <clone>';

function pluginRoot(): string {
  return resolve(themesDir(), '..', '..', '..');
}

function source(): string {
  const root = pluginRoot();
  if (existsSync(join(root, '.git'))) {
    const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  try {
    const theme = flag(argv, '--theme');
    const app = flag(argv, '--app');
    if (argv.length !== 4 || !theme || !app || theme.startsWith('--') || app.startsWith('--')) {
      console.log(USAGE);
      return 2;
    }
    if (!installed()) {
      console.log(NOT_INSTALLED);
      return 2;
    }
    const appDir = resolve(app);
    if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
      console.log(`place: ${app} is not a folder`);
      return 2;
    }
    const { name, dir } = resolveTheme(theme);
    const out = findings(theme);
    if (out.length) {
      console.log(out.join('\n'));
      return 1;
    }
    const target = join(appDir, 'client', 'src', 'theme');
    if (existsSync(target)) {
      console.log(`place: ${join(app, 'client/src/theme')} already exists`);
      return 1;
    }
    const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
    mkdirSync(join(target, name), { recursive: true });
    copyFileSync(join(themesDir(), 'structure.css'), join(target, 'structure.css'));
    for (const f of files) copyFileSync(join(dir, f), join(target, name, f));
    const record = { theme: name, source: source(), sdk: uiCell().sdk };
    writeFileSync(join(target, 'theme.json'), JSON.stringify(record) + '\n');
    const lines = [
      'structure.css',
      'theme.json',
      ...files.filter((f) => f !== 'font.css').map((f) => `${name}/${f}`),
    ].map((p) => `- Modify: client/src/theme/${p}`).sort();
    console.log([`PLACED ${name}: client/src/theme`, ...lines].join('\n'));
    return 0;
  } catch (e) {
    console.log(`could not run: ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
