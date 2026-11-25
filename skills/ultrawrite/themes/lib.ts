import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

export type State = { state: string; kind: 'markup' | 'css' };
export type Slot = { slot: string; in: 'markup' | 'live'; states: State[]; structural?: string; hidden?: boolean };
export type Component = { name: string; slots: Slot[] };
export type Contract = { version: 'theme-contract-v1'; sdk: string; layers: string[]; facts: string[]; components: Component[] };

export const NOT_INSTALLED = 'could not run: run bun install in skills/ultrawrite/themes';

export function themesDir(): string {
  return import.meta.dir;
}

export function loadContract(): Contract {
  return JSON.parse(readFileSync(join(themesDir(), 'contract.json'), 'utf8'));
}

export function uiCell(): { sdk: string; theme: string } {
  const policy = JSON.parse(readFileSync(join(themesDir(), '..', 'stories', 'policy.json'), 'utf8'));
  return { sdk: policy.ui.sdk, theme: policy.ui.theme };
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function resolveTheme(nameOrDir: string): { name: string; dir: string } {
  if (!nameOrDir.includes(sep) && !nameOrDir.includes('/')) {
    const named = join(themesDir(), nameOrDir);
    if (nameOrDir && isDir(named)) return { name: nameOrDir, dir: named };
  }
  const dir = resolve(nameOrDir);
  if (!nameOrDir || !isDir(dir)) throw new Error(`theme: ${nameOrDir} is not a folder`);
  return { name: basename(dir), dir };
}

export function installed(): boolean {
  return existsSync(join(themesDir(), 'node_modules', '@ui-sdk', 'react'));
}
