import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Bundle} from './bundle';

export const TEMPLATE_DRAWS = join(import.meta.dir, 'tinyapp-template', 'client', 'src', 'screens', 'draws.json');
export const drawsPath = (app: string) => join(app, 'client', 'src', 'screens', 'draws.json');

export type Draws = Record<string, {role: string | null; name?: string[]}>;

export function readDraws(file: string): Draws | null {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return (j && typeof j === 'object' && j.parts && typeof j.parts === 'object' ? j.parts : {}) as Draws;
}

export const drawnRoles = (d: Draws) => new Set(Object.values(d).map((p) => p?.role).filter((r): r is string => typeof r === 'string'));

export const rolesSeen = (sees: {role: string; count?: number}[]) => [...new Set(sees.filter((s) => (s.count ?? 1) > 0).map((s) => s.role))];

export function undrawn(b: Bundle, d: Draws): {role: string; stories: string[]; name: string}[] {
  const roles = drawnRoles(d);
  const out: {role: string; stories: string[]; name: string}[] = [];
  for (const s of b.page.stories)
    for (const st of s.steps)
      for (const see of st.see ?? []) {
        if (!((see.count ?? 1) > 0) || roles.has(see.role)) continue;
        const r = out.find((x) => x.role === see.role) ?? (out.push({role: see.role, stories: [], name: see.name}), out[out.length - 1]);
        if (!r.stories.includes(s.id)) r.stories.push(s.id);
      }
  return out;
}
