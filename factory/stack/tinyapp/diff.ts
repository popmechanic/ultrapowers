// What a story step changed: every table cell and store value whose JSON differs
// between the state before the step and the state after it.
import type {Content} from './probe';

export type DiffEntry = {
  tbl: string; row: string; cell: string;
  from: string | null; to: string | null;
  diff_type: 'added' | 'removed' | 'modified';
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const keys = (a?: object, b?: object) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort(cmp);
const str = (o: Record<string, unknown> | undefined, k: string) =>
  o && Object.prototype.hasOwnProperty.call(o, k) ? JSON.stringify(o[k]) ?? null : null;

export function stepDiff(before: Content, after: Content): DiffEntry[] {
  const out: DiffEntry[] = [];
  const add = (tbl: string, row: string, cell: string, from: string | null, to: string | null) => {
    if (from === to) return;
    out.push({tbl, row, cell, from, to, diff_type: from === null ? 'added' : to === null ? 'removed' : 'modified'});
  };
  const [bt, bv] = before, [at, av] = after;
  for (const name of keys(bv, av)) add('$values', '', name, str(bv, name), str(av, name));
  for (const tbl of keys(bt, at)) {
    for (const row of keys(bt[tbl], at[tbl])) {
      const b = bt[tbl]?.[row] as Record<string, unknown> | undefined;
      const a = at[tbl]?.[row] as Record<string, unknown> | undefined;
      for (const cell of keys(b, a)) add(tbl, row, cell, str(b, cell), str(a, cell));
    }
  }
  return out;
}
