#!/usr/bin/env bun
// The product record: what the app is for, what the operator said and what
// the author assumed, every concept a successful version needs, and the order
// the plans build them in. It lives in the bundle while a plan is authored and
// in the target app (stories/product.json) after compile. product.md is its
// rendering in the operator's words; it is never written by hand.
//
//   bun skills/ultrawrite/stories/product.ts check <product.json>
//   bun skills/ultrawrite/stories/product.ts render <product.json> [--bundle <dir>] --out <product.md>
//   bun skills/ultrawrite/stories/product.ts record <product.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {KINDS, type Page} from './bundle';

export type Assumption = {text: string; about: 'product' | 'technical'; state: 'decided' | 'open'; by: 'author' | 'operator'};
export type Concept = {id: string; purpose: string; part: string; status: 'keep' | 'defer' | 'cut'; relies_on: string[]};
export type Subproject = {
  id: string; title: string; reason: string; concepts: string[]; depends_on: string[];
  status: 'next' | 'planned' | 'built'; plan?: string;
};
export type Reading = {
  stage: string; question: string; subject: string; noul: number | null; flagged: boolean;
  operator_pick: string | null; date: string;
};
export type Product = {
  version: 'product-v1';
  intent: {name: string; kind: string; audience: string[]; summary: string[]; success: string[]};
  understanding: {ask: string; said: string[]; assumed: Assumption[]; unsure: string[]};
  concepts: Concept[];
  subprojects: Subproject[];
  readings: Reading[];
};

const TOP = ['version', 'intent', 'understanding', 'concepts', 'subprojects', 'readings'];
const isStr = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const strs = (v: unknown) => Array.isArray(v) && v.every(isStr);
const extra = (o: object, keys: string[]) => Object.keys(o).filter((k) => !keys.includes(k));

function cycle(ids: string[], edges: (id: string) => string[]): string | null {
  const state = new Map<string, number>();
  const visit = (id: string, path: string[]): string | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path, id].join(' → ');
    state.set(id, 1);
    for (const n of edges(id)) {
      const c = visit(n, [...path, id]);
      if (c) return c;
    }
    state.set(id, 2);
    return null;
  };
  for (const id of ids) {
    const c = visit(id, []);
    if (c) return c;
  }
  return null;
}

// Every way `p` leaves product-v1, one plain sentence each; [] when valid.
export function checkProduct(p: unknown): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== 'object') return ['product: must be a JSON object'];
  const o = p as Record<string, any>;
  for (const k of extra(o, TOP)) errs.push(`product: unknown field ${k}`);
  if (o.version !== 'product-v1') errs.push('product: version must be product-v1');

  const i = o.intent ?? {};
  for (const k of extra(i, ['name', 'kind', 'audience', 'summary', 'success'])) errs.push(`intent: unknown field ${k}`);
  if (!isStr(i.name)) errs.push('intent: name must be the product\'s name');
  if (!KINDS.includes(i.kind)) errs.push('intent: kind must be behaviour, preserve or look');
  if (!strs(i.audience) || !i.audience.length) errs.push('intent: audience must name who uses it');
  if (!strs(i.summary) || i.summary.length !== 3) errs.push('intent: summary must be three sentences');
  if (!strs(i.success) || !i.success.length) errs.push('intent: success must say what would make it a success');

  const u = o.understanding ?? {};
  for (const k of extra(u, ['ask', 'said', 'assumed', 'unsure'])) errs.push(`understanding: unknown field ${k}`);
  if (!isStr(u.ask)) errs.push('understanding: ask must be the raw ask, verbatim');
  if (!strs(u.said)) errs.push('understanding: said must be a list of sentences');
  if (!strs(u.unsure)) errs.push('understanding: unsure must be a list of sentences');
  if (!Array.isArray(u.assumed)) errs.push('understanding: assumed must be a list');
  for (const [n, a] of (Array.isArray(u.assumed) ? u.assumed : []).entries()) {
    const at = `understanding: assumption ${n + 1}`;
    if (!a || typeof a !== 'object') { errs.push(`${at} must be an object`); continue; }
    for (const k of extra(a, ['text', 'about', 'state', 'by'])) errs.push(`${at}: unknown field ${k}`);
    if (!isStr(a.text)) errs.push(`${at}: text is missing`);
    if (!['product', 'technical'].includes(a.about)) errs.push(`${at}: about must be product or technical`);
    if (!['decided', 'open'].includes(a.state)) errs.push(`${at}: state must be decided or open`);
    if (!['author', 'operator'].includes(a.by)) errs.push(`${at}: by must be author or operator`);
  }

  const concepts: any[] = Array.isArray(o.concepts) ? o.concepts : [];
  if (!Array.isArray(o.concepts)) errs.push('product: concepts must be a list');
  const cids = new Set<string>();
  for (const c of concepts) {
    const at = `concept ${c?.id ?? '?'}`;
    for (const k of extra(c ?? {}, ['id', 'purpose', 'part', 'status', 'relies_on'])) errs.push(`${at}: unknown field ${k}`);
    if (!isStr(c?.id)) errs.push('concept: every concept needs an id');
    else if (cids.has(c.id)) errs.push(`${at}: the id is used twice`);
    else cids.add(c.id);
    if (!isStr(c?.purpose)) errs.push(`${at}: purpose is missing`);
    if (!isStr(c?.part)) errs.push(`${at}: part is missing`);
    if (!['keep', 'defer', 'cut'].includes(c?.status)) errs.push(`${at}: status must be keep, defer or cut`);
    if (!strs(c?.relies_on ?? null)) errs.push(`${at}: relies_on must be a list of concept ids`);
  }
  for (const c of concepts) for (const r of c?.relies_on ?? []) if (!cids.has(r)) errs.push(`concept ${c.id}: relies on ${r}, which is no concept`);
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const cc = cycle([...cids], (id) => byId.get(id)?.relies_on ?? []);
  if (cc) errs.push(`concepts rely on each other in a circle: ${cc}`);

  const subs: any[] = Array.isArray(o.subprojects) ? o.subprojects : [];
  if (!Array.isArray(o.subprojects)) errs.push('product: subprojects must be a list');
  const sids = new Set<string>();
  const home = new Map<string, string[]>();
  for (const s of subs) {
    const at = `plan ${s?.id ?? '?'}`;
    for (const k of extra(s ?? {}, ['id', 'title', 'reason', 'concepts', 'depends_on', 'status', 'plan'])) errs.push(`${at}: unknown field ${k}`);
    if (!isStr(s?.id)) errs.push('plan: every plan needs an id');
    else if (sids.has(s.id)) errs.push(`${at}: the id is used twice`);
    else sids.add(s.id);
    if (!isStr(s?.title)) errs.push(`${at}: title is missing`);
    if (!isStr(s?.reason)) errs.push(`${at}: reason (why it comes in this order) is missing`);
    if (!strs(s?.concepts ?? null) || !(s?.concepts ?? []).length) errs.push(`${at}: concepts must list what it builds`);
    if (!strs(s?.depends_on ?? null)) errs.push(`${at}: depends_on must be a list of plan ids`);
    if (!['next', 'planned', 'built'].includes(s?.status)) errs.push(`${at}: status must be next, planned or built`);
    if (s?.status === 'built' && !isStr(s?.plan)) errs.push(`${at}: a built plan names its plan id`);
    for (const c of s?.concepts ?? []) {
      if (!cids.has(c)) errs.push(`${at}: builds ${c}, which is no concept`);
      else if (byId.get(c).status !== 'keep') errs.push(`${at}: builds ${c}, which is not kept for the first version`);
      home.set(c, [...(home.get(c) ?? []), s.id]);
    }
  }
  for (const s of subs) for (const d of s?.depends_on ?? []) if (!sids.has(d)) errs.push(`plan ${s.id}: depends on ${d}, which is no plan`);
  const sById = new Map(subs.map((s) => [s.id, s]));
  const sc = cycle([...sids], (id) => sById.get(id)?.depends_on ?? []);
  if (sc) errs.push(`plans depend on each other in a circle: ${sc}`);
  for (const c of concepts) {
    if (c?.status !== 'keep') continue;
    const h = home.get(c.id) ?? [];
    if (h.length === 0 && subs.length) errs.push(`concept ${c.id}: kept, but no plan builds it`);
    if (h.length > 1) errs.push(`concept ${c.id}: built by more than one plan (${h.join(', ')})`);
  }
  if (subs.filter((s) => s?.status === 'next').length > 1) errs.push('plans: only one plan can be next');

  if (!Array.isArray(o.readings)) errs.push('product: readings must be a list');
  for (const r of Array.isArray(o.readings) ? o.readings : []) {
    const k = extra(r ?? {}, ['stage', 'question', 'subject', 'noul', 'flagged', 'operator_pick', 'date']);
    if (k.length) errs.push(`reading ${r?.question ?? '?'}: unknown field ${k.join(', ')}`);
  }
  return errs;
}

export function loadProduct(path: string): Product {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveProduct(path: string, p: Product): void {
  writeFileSync(path, JSON.stringify(p, null, 1) + '\n');
}

const SAY = {keep: 'First version', defer: 'Later', cut: 'Not doing'} as const;

// product.md: the product in the operator's words. No ids, statuses, kinds or scores.
export function renderProduct(p: Product, page?: Page & {subproject?: string}): string {
  const out = [`# ${p.intent.name}`, '', p.intent.summary.join(' '), '',
    `**Who uses it:** ${p.intent.audience.join(', ')}`, '', '**It succeeds when:**',
    ...p.intent.success.map((s) => `- ${s}`), '', '## What it does', ''];
  const parts = [...new Set(p.concepts.map((c) => c.part))];
  for (const part of parts) {
    out.push(`### ${part}`, '');
    for (const st of ['keep', 'defer', 'cut'] as const) {
      const cs = p.concepts.filter((c) => c.part === part && c.status === st);
      if (cs.length) out.push(`**${SAY[st]}:**`, ...cs.map((c) => `- ${c.purpose}`), '');
    }
  }
  if (p.subprojects.length) {
    out.push('## The order we build it in', '');
    p.subprojects.forEach((s, i) => {
      const mark = page?.subproject === s.id ? ' **(this plan)**' : s.status === 'built' ? ' (built)' : '';
      out.push(`${i + 1}. **${s.title}**${mark}: ${s.reason}`);
    });
    out.push('');
  }
  if (page?.subproject) {
    const s = p.subprojects.find((x) => x.id === page.subproject);
    out.push(`## This plan: ${s?.title ?? page.title}`, '', '### What you will be able to do', '');
    page.stories.forEach((st, i) => out.push(`${i + 1}. ${st.sentence}`));
    if (page.links?.length) out.push('', '### What goes together', '', ...page.links.map((l) => `- ${l.sentence}`));
    out.push('');
  }
  return out.join('\n');
}

// Fill operator_pick on readings that have none, from the product's final
// state: a concept's status, an assumption's state. Returns how many it filled.
export function recordPicks(p: Product): number {
  let n = 0;
  for (const r of p.readings) {
    if (r.operator_pick !== null) continue;
    if (r.stage === 'map') {
      const c = p.concepts.find((x) => x.id === r.subject);
      if (c) { r.operator_pick = c.status; n++; }
    } else if (r.question === 'assumption_surprises') {
      const a = p.understanding.assumed.find((x) => x.text === r.subject);
      if (a) { r.operator_pick = a.by === 'operator' ? 'asked' : 'author-decided'; n++; }
    }
  }
  return n;
}

function main(argv: string[]): number {
  const [cmd, file, ...rest] = argv;
  if (!file || !['check', 'render', 'record'].includes(cmd)) {
    console.error('usage: product.ts check <product.json> | render <product.json> [--bundle <dir>] --out <product.md> | record <product.json>');
    return 2;
  }
  let p: Product;
  try {
    p = loadProduct(file);
  } catch (e) {
    console.log(`product: cannot read ${file}: ${(e as Error).message}`);
    return 2;
  }
  const errs = checkProduct(p);
  if (errs.length) {
    console.log(errs.join('\n'));
    console.log(`${errs.length} problem(s)`);
    return 2;
  }
  if (cmd === 'check') {
    console.log(`PRODUCT OK: ${p.concepts.length} concept(s), ${p.subprojects.length} plan(s)`);
    return 0;
  }
  if (cmd === 'record') {
    console.log(`RECORDED ${recordPicks(p)} pick(s)`);
    saveProduct(file, p);
    return 0;
  }
  const {values: v} = parseArgs({args: rest, options: {bundle: {type: 'string'}, out: {type: 'string'}}});
  if (!v.out) {
    console.error('usage: product.ts render <product.json> [--bundle <dir>] --out <product.md>');
    return 2;
  }
  const page = v.bundle ? JSON.parse(readFileSync(join(v.bundle, 'page.json'), 'utf8')) : undefined;
  writeFileSync(v.out, renderProduct(p, page));
  console.log(`RENDERED ${v.out}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
