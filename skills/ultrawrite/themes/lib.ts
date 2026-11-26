import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

export type State = { state: string; kind: 'markup' | 'css' };
export type Slot = { slot: string; in: 'markup' | 'live'; states: State[]; structure?: string; theme?: string; hidden?: boolean; optional?: boolean };
export type Component = { name: string; slots: Slot[] };
export type Variable = { name: string; default: string; purpose: string };
export type Contract = { version: 'theme-contract-v1'; sdk: string; layers: string[]; facts: string[]; variables: Variable[]; components: Component[] };
export type Theme = { name: string; dir: string };

const PACKAGES = ['@ui-sdk/react', '@ui-sdk/core', 'react', 'react-dom'];

export function themesDir(): string {
  return import.meta.dir;
}

export function notInstalled(): string {
  return `could not run: run bun install in ${themesDir()}`;
}

export function loadContract(): Contract {
  return JSON.parse(readFileSync(join(themesDir(), 'contract.json'), 'utf8'));
}

export function uiCell(): { sdk: string; theme: string } {
  const policy = JSON.parse(readFileSync(join(themesDir(), '..', 'stories', 'policy.json'), 'utf8'));
  return { sdk: policy.ui.sdk, theme: policy.ui.theme };
}

export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function resolveTheme(nameOrDir: string): Theme {
  const trimmed = nameOrDir.replace(/[\\/]+$/, '') || nameOrDir;
  if (!trimmed.includes(sep) && !trimmed.includes('/')) {
    const named = join(themesDir(), trimmed);
    if (trimmed && isDir(named)) return { name: trimmed, dir: named };
  }
  const dir = resolve(trimmed);
  if (!trimmed || !isDir(dir)) throw new Error(`theme: ${nameOrDir} is not a folder`);
  return { name: basename(dir), dir };
}

export function installProblem(): string | null {
  const modules = join(themesDir(), 'node_modules');
  if (!PACKAGES.every((p) => existsSync(join(modules, p, 'package.json')))) return notInstalled();
  try {
    const have = JSON.parse(readFileSync(join(modules, '@ui-sdk', 'react', 'package.json'), 'utf8')).version;
    const pin = uiCell().sdk;
    if (have !== pin) return `could not run: @ui-sdk/react ${have} is installed in ${themesDir()} and the ui cell pins ${pin}`;
    return null;
  } catch (e) {
    return `could not run: ${(e as Error).message}`;
  }
}
