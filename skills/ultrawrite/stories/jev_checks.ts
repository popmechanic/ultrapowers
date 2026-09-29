#!/usr/bin/env bun
// Jev reads the plan at each enrichment stage. It judges; it never generates or
// decides. A flag is for the author to act on. Only three kinds of flag may
// become the operator's doubts (DOUBT:), each a product choice in plain words:
// an ask sentence with two readings, an assumption about what the app does,
// and a link the audience might not expect. The code checks run first.
//
//   bun skills/ultrawrite/stories/jev_checks.ts <bundle> [--ask-file <ask.txt>] [--stage understanding|map|decompose|bundle]
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {loadBundle, type Bundle} from './bundle';
import {runChecks} from './checks';
import {checkProduct, saveProduct, type Product} from './product';

const URL_ = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const Q = JSON.parse(readFileSync(join(import.meta.dir, 'questions.json'), 'utf8'));
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;
const STAGES = ['understanding', 'map', 'decompose', 'bundle'];

type Ask = (state: unknown, questions: unknown) => Promise<Record<string, unknown> | null>;
type Out = {flags: string[]; doubts: string[]; reads: number};

function key(): string {
  const home = process.env.ULTRAPOWERS_HOME ?? join(homedir(), '.ultrapowers');
  const line = readFileSync(join(home, 'typesafe.env'), 'utf8').split('\n').find((l) => l.startsWith('TYPESAFE_API_KEY='));
  if (!line) throw new Error('no TYPESAFE_API_KEY');
  return line.slice('TYPESAFE_API_KEY='.length).trim();
}

const defaultAsk: Ask = async (state, questions) => {
  try {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({state, model: MODEL, questions}),
      signal: AbortSignal.timeout(30_000),
    });
    return ((await r.json()) as {answers?: Record<string, unknown>}).answers ?? null;
  } catch {
    return null;
  }
};

function noul(answers: Record<string, unknown> | null, k: string): number | null {
  const a = answers?.[k];
  const v = typeof a === 'number' ? a : (a as {noul?: unknown} | undefined)?.noul;
  return typeof v === 'number' ? v : null;
}

export const sentences = (text: string) => text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
const f2 = (v: number) => v.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

function reader(ask: Ask, out: Out, product: Product | null, stage: string) {
  return async (state: unknown, questions: Record<string, unknown>, label: string, subject: string) => {
    out.reads += 1;
    const a = await ask(state, questions);
    if (a === null) out.flags.push(`JEV unread: ${label}`);
    return (k: string, flagged: (v: number) => boolean): number | null => {
      const v = noul(a, k);
      product?.readings.push({stage, question: k, subject, noul: v, flagged: v !== null && flagged(v), operator_pick: null, date: today()});
      return v !== null && flagged(v) ? v : null;
    };
  };
}

async function understanding(p: Product, ask: Ask, out: Out) {
  const one = reader(ask, out, p, 'understanding');
  for (const s of sentences(p.understanding.ask)) {
    const v = (await one({ask: p.understanding.ask, sentence: s}, Q.ambiguity, `ambiguity of "${s}"`, s))('two_apps', (x) => x >= POLICY.two_apps);
    if (v !== null) out.doubts.push(`DOUBT: "${s}" can mean two different apps; ask which one, with both readings side by side`);
  }
  // Only what the author decided alone; a choice the operator already made is never re-asked.
  for (const a of p.understanding.assumed.filter((x) => x.about === 'product' && x.by === 'author')) {
    const v = (await one({ask: p.understanding.ask, assumption: a.text}, Q.surprise, `assumption "${a.text}"`, a.text))(
      'assumption_surprises', (x) => x >= POLICY.assumption_surprises);
    if (v !== null) out.doubts.push(`DOUBT: ask whether the app should: ${a.text}`);
  }
}

async function map(p: Product, ask: Ask, out: Out) {
  if (!p.concepts.length) throw new Error('the map has no concepts yet; list them in product.json first');
  const one = reader(ask, out, p, 'map');
  const summary = p.intent.summary.join(' ');
  const audience = p.intent.audience.join(', ');
  for (const c of p.concepts) {
    const get = await one({summary, audience, purpose: c.purpose, piece: {name: c.id, purpose: c.purpose}},
      {essential: Q.map.essential, serves_summary: Q.map.serves_summary, one_need: Q.coherence.one_need}, `concept ${c.id}`, c.id);
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
  for (const s of p.subprojects) {
    const does = s.concepts.map((id) => p.concepts.find((c) => c.id === id)?.purpose ?? id);
    const v = (await one({audience, plan: {title: s.title, does}}, Q.decompose, `plan ${s.id}`, s.id))(
      'stands_alone', (x) => x < POLICY.stands_alone_below);
    if (v !== null) out.flags.push(`JEV flag: ${s.id} "${s.title}" may not be usable on its own (stands_alone ${f2(v)}); regroup it`);
  }
}

async function bundleStage(b: Bundle, ask: Ask, out: Out, askText?: string) {
  const one = reader(ask, out, b.product, 'bundle');
  const stories = new Map(b.page.stories.map((s) => [s.id, s.sentence]));
  // A later plan's ask is new words: read them too. The first plan's ask was read at stage 2.
  if (askText && askText.trim() !== (b.product?.understanding.ask ?? '').trim()) {
    for (const s of sentences(askText)) {
      const v = (await one({ask: askText, sentence: s}, Q.ambiguity, `ambiguity of "${s}"`, s))('two_apps', (x) => x >= POLICY.two_apps);
      if (v !== null) out.doubts.push(`DOUBT: "${s}" can mean two different apps; ask which one, with both readings side by side`);
    }
  }
  for (const c of b.cards) {
    const piece = {name: c.piece, purpose: c.purpose, actions: c.actions.map((a) => ({name: a.name, description: a.description}))};
    const get = await one({piece}, Q.coherence, `piece ${c.piece} coherence`, c.piece);
    let v = get('one_need', (x) => x < POLICY.one_need_below);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: its purpose reads as more than one need (one_need ${f2(v)})`);
    v = get('same_people', (x) => x < POLICY.same_people_below);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: its actions serve different people (same_people ${f2(v)})`);
    v = (await one({piece: {name: c.piece, purpose: c.purpose}, story: stories.get(c.main_story ?? '') ?? '', near_miss: c.near_miss ?? ''},
      Q.near_miss, `piece ${c.piece} near-miss`, c.piece))('story_passes_near_miss', (x) => x >= POLICY.story_passes_near_miss);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: main story ${c.main_story} does not rule out its near-miss (story_passes_near_miss ${f2(v)})`);
    for (const act of c.actions) {
      v = (await one({action: {name: act.name, description: act.description}, store_module: b.storeText.slice(0, 20000)},
        Q.content_branch, `action ${act.name}`, act.name))('branches_on_text', (x) => x >= POLICY.branches_on_text);
      if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: ${act.name} may act on the wording of typed text (branches_on_text ${f2(v)})`);
    }
  }
  for (let i = 0; i < b.cards.length; i++) {
    for (let j = i + 1; j < b.cards.length; j++) {
      const [x, y] = [b.cards[i], b.cards[j]];
      const v = (await one({a: {name: x.piece, purpose: x.purpose}, b: {name: y.piece, purpose: y.purpose}},
        Q.redundancy, `pieces ${x.piece} and ${y.piece}`, `${x.piece}+${y.piece}`))('same_need', (z) => z >= POLICY.same_need);
      if (v !== null) out.flags.push(`JEV flag: pieces ${x.piece} and ${y.piece} serve the same need (same_need ${f2(v)})`);
    }
  }
  const audience = b.product?.intent.audience.join(', ') ?? 'the people who use the app';
  for (const l of b.page.links ?? []) {
    const v = (await one({audience, link: l.sentence}, Q.link, `link ${l.id}`, l.id))('link_expected', (x) => x < POLICY.link_expected_below);
    if (v !== null) out.doubts.push(`DOUBT: ask whether this should happen: ${l.sentence}`);
  }
}

async function main(): Promise<number> {
  const {values, positionals} = parseArgs({allowPositionals: true,
    options: {'ask-file': {type: 'string'}, stage: {type: 'string'}}});
  const stage = values.stage ?? 'bundle';
  if (positionals.length !== 1 || !STAGES.includes(stage)) {
    console.error('usage: jev_checks.ts <bundle> [--ask-file <ask.txt>] [--stage understanding|map|decompose|bundle]');
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
  } else if (stage !== 'bundle') {
    console.log(`jev_checks: stage ${stage} reads ${productPath}, which does not exist; write the product record first`);
    return 2;
  }
  try {
    if (stage === 'understanding') await understanding(product!, defaultAsk, out);
    else if (stage === 'map') await map(product!, defaultAsk, out);
    else if (stage === 'decompose') await decompose(product!, defaultAsk, out);
    else {
      const b = loadBundle(dir);
      const {refusals, facts} = runChecks(b);
      for (const l of [...refusals, ...facts]) console.log(l);
      if (refusals.length) {
        console.log(`${refusals.length} refusal(s); fix them before Jev reads the draft`);
        return 2;
      }
      const askText = values['ask-file'] ? readFileSync(values['ask-file'], 'utf8') : undefined;
      await bundleStage(b, defaultAsk, out, askText);
      product = b.product;
    }
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
