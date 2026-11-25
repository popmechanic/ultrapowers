#!/usr/bin/env bun
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {checkProduct, saveProduct, type Product} from './product';
import {at, defaultAsk, loadQuestions, noul, type Ask} from './jev';

const SETS = loadQuestions() as Record<string, any>;
const GROUPS = ['ambiguity', 'coherence', 'surprise', 'map', 'decompose', 'about_product'];
const Q = Object.fromEntries(GROUPS.map((g) => [g, SETS[`authoring_${g}`].questions]));
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;
const STAGES = ['understanding', 'map', 'decompose'];

type Out = {flags: string[]; doubts: string[]; reads: number};

export const sentences = (text: string) => text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
const f2 = (v: number) => v.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

type Get = (k: string, flagged: (v: number) => boolean, question?: string, subject?: string) => number | null;

function reader(ask: Ask, out: Out, product: Product | null, stage: string) {
  return (state: unknown, questions: Record<string, unknown>, label: string, subject: string): (() => Promise<Get>) => {
    out.reads += 1;
    const answers = ask(state, questions);
    return async () => {
      const a = await answers;
      if (a === null) out.flags.push(`JEV unread: ${label}`);
      return (k, flagged, question = k, subj = subject) => {
        const v = noul(a, k);
        product?.readings.push({stage, question, subject: subj, noul: v, flagged: v !== null && flagged(v), operator_pick: null, date: today()});
        return v !== null && flagged(v) ? v : null;
      };
    };
  };
}

async function ambiguity(one: ReturnType<typeof reader>, ask: string, out: Out) {
  const ss = sentences(ask);
  if (!ss.length) return;
  const questions = Object.fromEntries(ss.map((_, i) => [`two_apps_${i}`, at(Q.ambiguity.two_apps, {i})]));
  const get = await one({ask, sentences: ss}, questions, `ambiguity of ${ss.length} sentence(s)`, ask)();
  ss.forEach((s, i) => {
    const v = get(`two_apps_${i}`, (x) => x >= POLICY.two_apps, 'two_apps', s);
    if (v !== null) out.doubts.push(`DOUBT: "${s}" can mean two different apps; ask which one, with both readings side by side`);
  });
}

async function understanding(p: Product, ask: Ask, out: Out) {
  const one = reader(ask, out, p, 'understanding');
  const assumed = p.understanding.assumed.filter((x) => x.about === 'product' && x.by === 'author')
    .map((a) => [a, one({ask: p.understanding.ask, assumption: a.text}, Q.surprise, `assumption "${a.text}"`, a.text)] as const);
  const technical = p.understanding.assumed.filter((x) => x.about === 'technical' && x.by === 'author')
    .map((a) => [a, one({assumption: a.text}, {about_product: Q.about_product.about_product}, `technical assumption "${a.text}"`, a.text)] as const);
  await ambiguity(one, p.understanding.ask, out);
  for (const [a, read] of assumed) {
    const v = (await read())('assumption_surprises', (x) => x >= POLICY.assumption_surprises);
    if (v !== null) out.doubts.push(`DOUBT: ask whether the app should: ${a.text}`);
  }
  for (const [a, read] of technical) {
    const v = (await read())('about_product', (x) => x >= POLICY.about_product);
    if (v !== null) out.flags.push(`JEV flag: assumption "${a.text}" is labelled technical but reads as about the product (about_product ${f2(v)}); the label may hide it from the surprise check`);
  }
}

async function map(p: Product, ask: Ask, out: Out) {
  if (!p.concepts.length) throw new Error('the map has no concepts yet; list them in product.json first');
  const one = reader(ask, out, p, 'map');
  const summary = p.intent.summary.join(' ');
  const audience = p.intent.audience.join(', ');
  const reads = p.concepts.map((c) => one(
    {summary, audience, piece: {name: c.id, purpose: c.purpose}, other_purposes: p.concepts.filter((o) => o !== c).map((o) => o.purpose)},
    {essential: Q.map.essential, serves_summary: Q.map.serves_summary, one_need: Q.coherence.one_need}, `concept ${c.id}`, c.id));
  for (const [i, c] of p.concepts.entries()) {
    const get = await reads[i]();
    const low = get('essential', (x) => x < POLICY.essential_below);
    const read = p.readings[p.readings.length - 1].noul;
    out.flags.push(`JEV map: ${c.id}: recommend ${low !== null ? 'Later' : 'First version'} (essential ${read === null ? 'unread' : f2(read)})`);
    const s = get('serves_summary', (x) => x < POLICY.serves_summary_below);
    if (s !== null) out.flags.push(`JEV flag: ${c.id}: may not serve what the product is for (serves_summary ${f2(s)}); recommend Not doing`);
    const n = get('one_need', (x) => x < POLICY.one_need_below);
    if (n !== null) out.flags.push(`JEV flag: ${c.id}: its purpose reads as more than one need (one_need ${f2(n)}); split it`);
  }
}

async function decompose(p: Product, ask: Ask, out: Out) {
  if (!p.subprojects.length) throw new Error('no build order yet; list the plans in product.json first');
  const one = reader(ask, out, p, 'decompose');
  const audience = p.intent.audience.join(', ');
  const summary = p.intent.summary.join(' ');
  const plans = p.subprojects.map((s) => ({title: s.title, does: s.concepts.map((id) => p.concepts.find((c) => c.id === id)?.purpose ?? id)}));
  const reads = p.subprojects.map((s, k) =>
    one({audience, summary, plan: plans[k], built_before: plans.slice(0, k)}, Q.decompose, `plan ${s.id}`, s.id));
  for (const [k, s] of p.subprojects.entries()) {
    const v = (await reads[k]())('stands_alone', (x) => x < POLICY.stands_alone_below);
    if (v !== null) out.flags.push(`JEV flag: ${s.id} "${s.title}" may not be usable on its own (stands_alone ${f2(v)}); regroup it`);
  }
}

async function main(): Promise<number> {
  let values: {stage?: string} = {};
  let positionals: string[] = [];
  try {
    ({values, positionals} = parseArgs({allowPositionals: true,
      options: {stage: {type: 'string'}}}));
  } catch {
    positionals = [];
  }
  const stage = values.stage ?? '';
  if (positionals.length !== 1 || !STAGES.includes(stage)) {
    console.error('usage: jev_checks.ts <dir holding product.json> --stage understanding|map|decompose');
    return 2;
  }
  const dir = positionals[0];
  const productPath = join(dir, 'product.json');
  const out: Out = {flags: [], doubts: [], reads: 0};
  let product: Product | null = null;
  if (existsSync(productPath)) {
    product = JSON.parse(readFileSync(productPath, 'utf8'));
    const errs = checkProduct(product);
    if (errs.length) {
      console.log(errs.join('\n'));
      console.log(`${errs.length} problem(s) in product.json`);
      return 2;
    }
  } else {
    console.log(`jev_checks: stage ${stage} reads ${productPath}, which does not exist; write the product record first`);
    return 2;
  }
  try {
    if (stage === 'understanding') await understanding(product!, defaultAsk, out);
    else if (stage === 'map') await map(product!, defaultAsk, out);
    else await decompose(product!, defaultAsk, out);
  } catch (e) {
    console.log(`jev_checks: ${(e as Error).message}`);
    return 2;
  }
  for (const f of [...out.flags, ...out.doubts]) console.log(f);
  if (product) saveProduct(productPath, product);
  console.log(`JEV read: ${out.reads} call(s), ${out.flags.filter((f) => f.startsWith('JEV flag')).length} flag(s), ${out.doubts.length} doubt(s)`);
  return 0;
}

if (import.meta.main) process.exit(await main());
