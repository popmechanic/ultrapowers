#!/usr/bin/env bun
// Jev reads the plan at each enrichment stage. It judges; it never generates or
// decides. A flag is for the author to act on. Only three kinds of flag may
// become the operator's doubts (DOUBT:), each a product choice in plain words:
// an ask sentence with two readings, an assumption about what the app does,
// and a link the audience might not expect. The code checks run first.
//
//   bun skills/ultrawrite/stories/jev_checks.ts <bundle> [--ask-file <ask.txt>] [--stage understanding|map|decompose|bundle]
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {loadBundle, type Bundle} from './bundle';
import {runChecks} from './checks';
import {checkProduct, saveProduct, type Product} from './product';
import {at, defaultAsk, noul, type Ask} from './jev';

const Q = JSON.parse(readFileSync(join(import.meta.dir, 'questions.json'), 'utf8'));
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;
const STAGES = ['understanding', 'map', 'decompose', 'bundle'];

type Out = {flags: string[]; doubts: string[]; reads: number};

export const sentences = (text: string) => text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
const f2 = (v: number) => v.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

type Get = (k: string, flagged: (v: number) => boolean, question?: string, subject?: string) => number | null;

// `one` sends its request at once, so every call of a stage runs concurrently; the thunk it
// returns is awaited in the stage's own order, so flags and reading rows keep that order.
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

// The ask's sentences, all in one request: one question per sentence.
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
  // Only what the author decided alone; a choice the operator already made is never re-asked.
  const assumed = p.understanding.assumed.filter((x) => x.about === 'product' && x.by === 'author')
    .map((a) => [a, one({ask: p.understanding.ask, assumption: a.text}, Q.surprise, `assumption "${a.text}"`, a.text)] as const);
  await ambiguity(one, p.understanding.ask, out);
  for (const [a, read] of assumed) {
    const v = (await read())('assumption_surprises', (x) => x >= POLICY.assumption_surprises);
    if (v !== null) out.doubts.push(`DOUBT: ask whether the app should: ${a.text}`);
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

async function bundleStage(b: Bundle, ask: Ask, out: Out, askText?: string) {
  const one = reader(ask, out, b.product, 'bundle');
  const stories = new Map(b.page.stories.map((s) => [s.id, s]));
  const summary = (b.product?.intent.summary ?? b.page.summary ?? []).join(' ');
  const audience = b.product?.intent.audience.join(', ') ?? 'the people who use the app';
  // Every request goes out now; the answers are read below in the order the flags are written.
  const coherence = b.cards.map((c) => one(
    {piece: {name: c.piece, purpose: c.purpose, actions: c.actions.map((a) => ({name: a.name, description: a.description}))}},
    Q.coherence, `piece ${c.piece} coherence`, c.piece));
  const nearMiss = b.cards.map((c) => {
    const story = stories.get(c.main_story ?? '');
    return one({piece: {name: c.piece, purpose: c.purpose}, story: story?.sentence ?? '',
      story_steps: (story?.steps ?? []).map((st) => ({tool: st.tool, args: st.args, see: st.see ?? []})), near_miss: c.near_miss ?? ''},
    Q.near_miss, `piece ${c.piece} near-miss`, c.piece);
  });
  // The store goes once, with one question per action.
  const actions = b.cards.flatMap((c) => c.actions.map((a) => ({piece: c.piece, name: a.name, description: a.description})));
  const storeRead = actions.length ? one({store_module: b.storeText.slice(0, 20000), actions},
    Object.fromEntries(actions.map((_, i) => [`branches_on_text_${i}`, at(Q.content_branch.branches_on_text, {i})])),
    `store for ${actions.length} action(s)`, 'store') : null;
  // Every pair of pieces, in one request.
  const pairs: [number, number][] = [];
  for (let i = 0; i < b.cards.length; i++) for (let j = i + 1; j < b.cards.length; j++) pairs.push([i, j]);
  const pairRead = pairs.length ? one({pieces: b.cards.map((c) => ({name: c.piece, purpose: c.purpose}))},
    Object.fromEntries(pairs.map(([i, j]) => [`same_need_${i}_${j}`, at(Q.redundancy.same_need, {i, j})])),
    `${pairs.length} pair(s) of pieces`, 'pieces') : null;
  const links = (b.page.links ?? []).map((l) => one({audience, summary, link: l.sentence}, Q.link, `link ${l.id}`, l.id));
  // A later plan's ask is new words: read them too. The first plan's ask was read at stage 2.
  if (askText && askText.trim() !== (b.product?.understanding.ask ?? '').trim()) await ambiguity(one, askText, out);
  const storeGet = storeRead && (await storeRead());
  let n = 0;
  for (const [k, c] of b.cards.entries()) {
    const get = await coherence[k]();
    let v = get('one_need', (x) => x < POLICY.one_need_below);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: its purpose reads as more than one need (one_need ${f2(v)})`);
    v = get('same_people', (x) => x < POLICY.same_people_below);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: its actions serve different people (same_people ${f2(v)})`);
    v = (await nearMiss[k]())('story_passes_near_miss', (x) => x >= POLICY.story_passes_near_miss);
    if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: main story ${c.main_story} does not rule out its near-miss (story_passes_near_miss ${f2(v)})`);
    for (const act of c.actions) {
      v = storeGet!(`branches_on_text_${n++}`, (x) => x >= POLICY.branches_on_text, 'branches_on_text', act.name);
      if (v !== null) out.flags.push(`JEV flag: piece ${c.piece}: ${act.name} may act on the wording of typed text (branches_on_text ${f2(v)})`);
    }
  }
  const pairGet = pairRead && (await pairRead());
  for (const [i, j] of pairs) {
    const [x, y] = [b.cards[i], b.cards[j]];
    const v = pairGet!(`same_need_${i}_${j}`, (z) => z >= POLICY.same_need, 'same_need', `${x.piece}+${y.piece}`);
    if (v !== null) out.flags.push(`JEV flag: pieces ${x.piece} and ${y.piece} serve the same need (same_need ${f2(v)})`);
  }
  for (const [k, l] of (b.page.links ?? []).entries()) {
    const v = (await links[k]())('link_expected', (x) => x < POLICY.link_expected_below);
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
