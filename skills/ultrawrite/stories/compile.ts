#!/usr/bin/env bun
// Compile a bundle into a stories-v1 plan.
//
//   bun skills/ultrawrite/stories/compile.ts <bundle> --app <dir> --plan-id <id> --date <YYYY-MM-DD> --out <plan.md>
//
// Every probe is derived by replaying the real store module: `given` from the
// story's earlier steps, `do` from the step, `expect` from the diff the step
// made. The app's older probes (stories/probes.jsonl) become guards.
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {Aliases, checksFor, hollow, type Content, type Probe} from '../../../factory/stack/tinyapp/probe';
import {loadBundle, type Bundle, type Card} from './bundle';
import {runChecks} from './checks';
import {renderProduct, saveProduct, type Product} from './product';

type Tool = {name: string; inputSchema?: unknown; run: (store: unknown, args: Record<string, unknown>, who: string | null) => boolean};
type StoreModule = {TOOLS: Tool[]; makeStore: () => {getContent: () => Content}};
type Derived = {story: string; step: number; piece: string; probe: Probe};
type Line = {plan: string; signed: string; story: string; step: number; sentence: string; probe: Probe};

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const json = (v: unknown) => JSON.stringify(stable(v));
const fence = (p: Probe) => ['```probe', json(p), '```'];

function pieceOrder(cards: Card[]): Card[] {
  const done = new Set<string>();
  const order: Card[] = [];
  let left = [...cards];
  while (left.length) {
    const ready = left.filter((c) => (c.depends_on ?? []).every((d) => done.has(d)));
    if (!ready.length) throw new Error('the pieces depend on each other in a circle');
    for (const c of ready) {
      order.push(c);
      done.add(c.piece);
    }
    left = left.filter((c) => !ready.includes(c));
  }
  return order;
}

export function probesOf(b: Bundle, mod: StoreModule): Derived[] {
  const tools = new Map(mod.TOOLS.map((t) => [t.name, t]));
  const owner = new Map(b.cards.flatMap((c) => c.actions.map((a) => [a.name, c.piece] as const)));
  const out: Derived[] = [];
  for (const s of b.page.stories) {
    const store = mod.makeStore();
    const aliases = new Aliases();
    const read = (): Content => {
      const c = store.getContent();
      aliases.learn(c);
      return aliases.rename(c);
    };
    let before = read();
    // Who is signed in: set by a step's `as` and kept until the next one.
    let who: string | null | undefined;
    s.steps.forEach((st, i) => {
      if (st.as !== undefined) who = st.as;
      const where = `story ${s.id} step ${i + 1}`;
      const tool = tools.get(st.tool);
      if (!tool) throw new Error(`${where}: the store module has no tool ${st.tool}`);
      const args = st.args ?? {};
      const ran = tool.run(store, aliases.args(args, tool.inputSchema), who ?? null) === true;
      if (ran === Boolean(st.refused)) {
        throw new Error(st.refused
          ? `${where}: ${st.tool} was to refuse ${json(args)}, but it ran`
          : `${where}: ${st.tool} refused ${json(args)}; fix the step, or end it with "refused": "<the refusal sentence>"`);
      }
      const after = read();
      if (st.layer !== 'store') {
        const expect = checksFor(before, after);
        const probe: Probe = {
          clause: `${s.id}.${i + 1}`,
          layer: st.layer,
          ...(who !== undefined ? {as: who} : {}),
          given: s.steps.slice(0, i).map((g) => ({tool: g.tool, args: g.args ?? {}, ...(g.as !== undefined ? {as: g.as} : {})})),
          do: st.layer === 'ui' ? st.ui! : [{tool: st.tool, args}],
          expect,
          see: st.see ?? [],
          judge: null,
          holds_before: Boolean(st.refused),
        };
        if (hollow(probe, before)) throw new Error(`${where}: hollow, the step changes nothing; end it with "refused": "<the refusal sentence>" if it must refuse`);
        out.push({story: s.id, step: i + 1, piece: owner.get(st.tool)!, probe});
      }
      before = after;
    });
  }
  return out;
}

export function compilePlan(b: Bundle, planId: string, mine: Derived[], guards: Line[]): string {
  const {page, cards} = b;
  const sentences = new Map(page.stories.map((s) => [s.id, s.sentence]));
  const out = [`# ${page.title}`, '',
    '**Grammar:** stories-v1', '**Stack:** tinyapp', `**Plan-id:** ${planId}`,
    ...(b.page.subproject ? [`**Product:** ${b.page.subproject}`] : []),
    `**Kind:** ${page.kind}`, `**Summary:** ${page.summary.join(' ')}`,
    `**Store:** \`${page.store}\` sha256:${b.storeSha256}`, '',
    '## Stories', '',
    ...page.stories.map((s) => `- ${s.id}: ${s.sentence}`)];
  if (page.links?.length) out.push('', '## Links', '', ...page.links.map((l) => `- ${l.id}: ${l.sentence}`));
  if (page.numbers?.length) {
    out.push('', '## Numbers', '',
      ...page.numbers.map((n) => `- ${n.id}: ${n.sentence} | measure: ${n.measure} | target: ${n.target}`));
  }
  if (guards.length) {
    out.push('', '## Guards', '');
    for (const g of guards) out.push(...fence({...g.probe, clause: `G:${g.story}.${g.step}`}));
  }
  pieceOrder(cards).forEach((c, i) => {
    const probes = mine.filter((m) => m.piece === c.piece);
    out.push('', `### Task ${i + 1}: The ${c.piece} piece`, '',
      `**Piece:** ${c.piece}`,
      `**Depends-on-pieces:** ${(c.depends_on ?? []).join(', ') || 'none'}`,
      '**Files:**', `- Create: \`client/src/pieces/${c.piece}.ts\``,
      `**Purpose:** ${c.purpose}`, '**Actions:**');
    for (const a of c.actions) {
      out.push(`- \`${a.name}\` — ${a.description}${a.refuses?.length ? '; refuses: ' + a.refuses.join('; ') : ''}`);
    }
    out.push('**Stories:**', ...[...new Set(probes.map((p) => p.story))].sort().map((s) => `- ${s}: ${sentences.get(s)}`));
    out.push('**Proof:**', ...probes.flatMap((p) => fence(p.probe)));
  });
  return out.join('\n') + '\n';
}

async function main(): Promise<number> {
  const {values: v, positionals} = parseArgs({
    allowPositionals: true,
    options: {app: {type: 'string'}, 'plan-id': {type: 'string'}, date: {type: 'string'}, out: {type: 'string'}},
  });
  const planId = v['plan-id'];
  if (positionals.length !== 1 || !v.app || !planId || !v.date || !v.out) {
    console.error('usage: compile.ts <bundle> --app <dir> --plan-id <id> --date <YYYY-MM-DD> --out <plan.md>');
    return 2;
  }
  const b = loadBundle(positionals[0]);
  const {refusals, facts} = runChecks(b);
  for (const f of facts) console.log(f);
  if (refusals.length) {
    console.log(refusals.join('\n'));
    console.log(`${refusals.length} refusal(s)`);
    return 2;
  }
  const app = resolve(v.app);
  if (!existsSync(join(app, 'node_modules', 'tinybase'))) {
    console.log(`compile: run bun install in ${app} first; the store module imports tinybase from there`);
    return 2;
  }
  const storeDst = join(app, b.page.store);
  const kept = existsSync(storeDst) ? readFileSync(storeDst) : null;
  mkdirSync(dirname(storeDst), {recursive: true});
  copyFileSync(join(b.dir, 'store.js'), storeDst);
  let mine: Derived[];
  let text: string;
  const exportPath = join(app, 'stories', 'probes.jsonl');
  const older: Line[] = existsSync(exportPath)
    ? readFileSync(exportPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
  const guards = older.filter((l) => l.plan !== planId);
  try {
    mine = probesOf(b, (await import(storeDst)) as StoreModule);
    text = compilePlan(b, planId, mine, guards);
  } catch (e) {
    // A failed compile leaves the app's store as it was, so its plan's sha still holds.
    if (kept) writeFileSync(storeDst, kept);
    else rmSync(storeDst, {force: true});
    console.log(`compile: ${(e as Error).message}`);
    return 2;
  }
  mkdirSync(dirname(resolve(v.out)), {recursive: true});
  writeFileSync(v.out, text);
  const sentences = new Map(b.page.stories.map((s) => [s.id, s.sentence]));
  const lines: Line[] = [...guards, ...mine.map((m) => ({
    plan: planId, signed: v.date!, story: `${planId}/${m.story}`, step: m.step,
    sentence: sentences.get(m.story) ?? '', probe: m.probe,
  }))].sort((x, y) => (x.story < y.story ? -1 : x.story > y.story ? 1 : x.step - y.step));
  mkdirSync(dirname(exportPath), {recursive: true});
  writeFileSync(exportPath, lines.map((l) => json(l) + '\n').join(''));
  if (b.product && b.page.subproject) {
    const appProduct = join(app, 'stories', 'product.json');
    const kept: Product | null = existsSync(appProduct) ? JSON.parse(readFileSync(appProduct, 'utf8')) : null;
    const p: Product = structuredClone(b.product);
    for (const s of p.subprojects) {
      const before = kept?.subprojects.find((x) => x.id === s.id);
      if (before?.status === 'built') {
        s.status = 'built';
        s.plan = before.plan;
      }
      if (before?.history) s.history = before.history;
      if (s.id === b.page.subproject) {
        if (s.plan && s.plan !== planId) s.history = [...(s.history ?? []), s.plan];
        s.status = 'built';
        s.plan = planId;
      }
    }
    if (kept) p.readings = [...kept.readings, ...p.readings.filter((r) => !kept.readings.some((k) => JSON.stringify(k) === JSON.stringify(r)))];
    saveProduct(appProduct, p);
    mkdirSync(join(app, '.ultrapowers'), {recursive: true});
    writeFileSync(join(app, '.ultrapowers', 'product.md'), renderProduct(p, b.page));
  }
  const tasks = text.split('\n### Task ').length - 1;
  console.log(`COMPILED ${planId}: ${tasks} task(s), ${mine.length} probe(s), ${guards.length} guard(s)`);
  return 0;
}

if (import.meta.main) process.exit(await main());
