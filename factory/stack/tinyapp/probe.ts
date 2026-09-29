// The state-probe core: one probe read out of a stories-v1 plan, the closed
// checks decided on TinyBase [tables, values] content, and row ids matched by
// creation order. The one definition of probe semantics: compile.ts derives
// probes with checksFor, and the checker decides them with holds.
export type Row = Record<string, unknown>;
export type Content = [Record<string, Record<string, Row>>, Record<string, unknown>];
export type Check = Record<string, unknown>;
export type Locator = {role: string; name: string};
export type UiStep = {click: Locator} | {type: Locator & {text: string}} | {key: Locator & {key: string}};
// `as` is who is signed in (an email, or null for nobody) from this call on;
// absent, the page's own sign-in stands.
export type ToolCall = {tool: string; args: Record<string, unknown>; as?: string | null};
export type See = {role: string; name: string; count?: number};
export type Probe = {
  clause: string;
  layer: string;
  as?: string | null;
  given: ToolCall[];
  do: (ToolCall | UiStep)[];
  expect: Check[];
  see?: See[];
  judge?: string | null;
  holds_before?: boolean;
};

const FENCE = /^```probe[ \t]*\n([\s\S]*?)\n```/gm;

export function probeFromPlan(text: string, clause: string): Probe {
  for (const m of text.matchAll(FENCE)) {
    const p = JSON.parse(m[1]) as Probe;
    if (p.clause === clause) return p;
  }
  throw new Error(`no probe for clause ${clause} in the plan`);
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return sameValue(ka, kb) && ka.every((k) => sameValue((a as Row)[k], (b as Row)[k]));
  }
  return typeof a === typeof b && a === b;
}

export function holds(c: Check, content: Content, before?: Content): boolean {
  const [tables, values] = content;
  if ('unchanged' in c) return before !== undefined && sameValue(content, before);
  if ('value' in c) {
    const k = c.value as string;
    return 'absent' in c ? !(k in values) : k in values && sameValue(values[k], c.eq);
  }
  const row = tables[c.table as string]?.[c.row as string];
  if (!('cell' in c)) return row === undefined;
  if (row === undefined || !((c.cell as string) in row)) return 'absent' in c;
  if ('absent' in c) return false;
  return sameValue(row[c.cell as string], c.eq);
}

export function hollow(p: Probe, before: Content): boolean {
  if (p.holds_before) return false;
  return p.expect.every((c) => holds(c, before, before));
}

const keysOf = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

// The closed checks that say exactly how `after` differs from `before`: only
// rows and cells that changed, so a cell another piece adds later never
// breaks them. No difference at all is [{unchanged: true}].
export function checksFor(before: Content, after: Content): Check[] {
  const [bt, bv] = before;
  const [at, av] = after;
  const out: Check[] = [];
  for (const t of keysOf(bt, at)) {
    const brows = bt[t] ?? {};
    const arows = at[t] ?? {};
    for (const r of keysOf(brows, arows)) {
      if (r in brows && !(r in arows)) {
        out.push({table: t, row: r, absent: true});
        continue;
      }
      const bc = brows[r] ?? {};
      const ac = arows[r] ?? {};
      for (const c of keysOf(bc, ac)) {
        if (!(c in ac)) out.push({table: t, row: r, cell: c, absent: true});
        else if (!(c in bc) || !sameValue(ac[c], bc[c])) out.push({table: t, row: r, cell: c, eq: ac[c]});
      }
    }
  }
  for (const k of keysOf(bv, av)) {
    if (!(k in av)) out.push({value: k, absent: true});
    else if (!(k in bv) || !sameValue(av[k], bv[k])) out.push({value: k, eq: av[k]});
  }
  return out.length ? out : [{unchanged: true}];
}

const show = (v: unknown) => JSON.stringify(v);

function describe(c: Check, content: Content): string {
  const [tables, values] = content;
  if ('unchanged' in c) return 'nothing should have changed, but the store did';
  if ('value' in c) {
    const k = c.value as string;
    return 'absent' in c ? `value ${k} should be absent, is ${show(values[k])}`
      : `value ${k} should be ${show(c.eq)}, is ${k in values ? show(values[k]) : 'missing'}`;
  }
  const where = `${c.table} row ${c.row}`;
  const row = tables[c.table as string]?.[c.row as string];
  if (!('cell' in c)) return `${where} should be gone, but it is still there`;
  if ('absent' in c) return `${where}: ${c.cell} should be unset, is ${show(row?.[c.cell as string])}`;
  if (row === undefined) return `${where}: ${c.cell} should be ${show(c.eq)}, but the row is missing`;
  return `${where}: ${c.cell} should be ${show(c.eq)}, is ${(c.cell as string) in row ? show(row[c.cell as string]) : 'unset'}`;
}

export function failing(p: Probe, content: Content, before?: Content): string[] {
  return p.expect.filter((c) => !holds(c, content, before)).map((c) => describe(c, content));
}

const AMBIGUOUS = '\u0000';

export class Aliases {
  private order = new Map<string, string[]>();

  learn([tables]: Content): void {
    for (const [t, rows] of Object.entries(tables)) {
      const known = this.order.get(t) ?? [];
      const fresh = Object.keys(rows).filter((id) => !known.includes(id));
      this.order.set(t, [...known, ...fresh]);
    }
  }

  private real(table: string, alias: string): string | undefined {
    const i = Number(alias);
    return Number.isInteger(i) && i >= 0 ? this.order.get(table)?.[i] : undefined;
  }

  rename([tables, values]: Content): Content {
    const aliasOf = new Map<string, string>();
    for (const ids of this.order.values()) {
      ids.forEach((id, i) => aliasOf.set(id, aliasOf.has(id) ? AMBIGUOUS : String(i)));
    }
    const cell = (v: unknown) => {
      const a = typeof v === 'string' ? aliasOf.get(v) : undefined;
      return a !== undefined && a !== AMBIGUOUS ? a : v;
    };
    const out: Content[0] = {};
    for (const [t, rows] of Object.entries(tables)) {
      const order = this.order.get(t) ?? [];
      out[t] = Object.fromEntries(Object.entries(rows).map(([id, row]) => {
        const i = order.indexOf(id);
        const renamed = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)]));
        return [i < 0 ? '?' + id : String(i), renamed];
      }));
    }
    return [out, values];
  }

  args(args: Record<string, unknown>, schema: unknown): Record<string, unknown> {
    const props = ((schema as {properties?: Record<string, Record<string, unknown>>})?.properties) ?? {};
    return Object.fromEntries(Object.entries(args).map(([k, v]) => {
      const table = props[k]?.['x-row-of'];
      const real = typeof table === 'string' && typeof v === 'string' ? this.real(table, v) : undefined;
      return [k, real ?? v];
    }));
  }
}
