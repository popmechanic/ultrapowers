#!/usr/bin/env bun
// Jev's authoring checks: ambiguity in the operator's words, one purpose per
// piece, no two pieces with one purpose, a main story that rules out its
// near-miss, and no action that reads the wording of typed text. The code
// checks run first. Every Jev check is a live experiment (policy.json); a flag
// is for the author to act on, and the top three open flags become touch 1's
// doubt questions.
//
//   bun skills/ultrawrite/stories/jev_checks.ts <bundle> [--ask-file <ask.txt>]
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {loadBundle, type Bundle} from './bundle';
import {runChecks} from './checks';

const URL_ = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const Q = JSON.parse(readFileSync(join(import.meta.dir, 'questions.json'), 'utf8'));
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;

type Ask = (state: unknown, questions: unknown) => Promise<Record<string, unknown> | null>;

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

export async function runJevChecks(b: Bundle, ask: Ask, askText?: string): Promise<{flags: string[]; reads: number}> {
  const flags: string[] = [];
  let reads = 0;
  const stories = new Map(b.page.stories.map((s) => [s.id, s.sentence]));
  const one = async (state: unknown, questions: unknown, label: string) => {
    reads += 1;
    const a = await ask(state, questions);
    if (a === null) flags.push(`JEV unread: ${label}`);
    return a;
  };
  const f2 = (v: number) => v.toFixed(2);

  if (askText) {
    for (const s of sentences(askText)) {
      const v = noul(await one({ask: askText, sentence: s}, Q.ambiguity, `ambiguity of "${s}"`), 'two_apps');
      if (v !== null && v >= POLICY.two_apps) {
        flags.push(`JEV flag: ambiguous: "${s}" (two_apps ${f2(v)}) — ask it as a doubt with both readings`);
      }
    }
  }
  for (const c of b.cards) {
    const piece = {name: c.piece, purpose: c.purpose, actions: c.actions.map((a) => ({name: a.name, description: a.description}))};
    const a = await one({piece}, Q.coherence, `piece ${c.piece} coherence`);
    let v = noul(a, 'one_need');
    if (v !== null && v < POLICY.one_need_below) flags.push(`JEV flag: piece ${c.piece}: its purpose reads as more than one need (one_need ${f2(v)})`);
    v = noul(a, 'same_people');
    if (v !== null && v < POLICY.same_people_below) flags.push(`JEV flag: piece ${c.piece}: its actions serve different people (same_people ${f2(v)})`);
    v = noul(a, 'actions_conflict');
    if (v !== null && v >= POLICY.actions_conflict) flags.push(`JEV flag: piece ${c.piece}: two actions can work against each other (actions_conflict ${f2(v)})`);

    const nm = await one({piece: {name: c.piece, purpose: c.purpose}, story: stories.get(c.main_story ?? '') ?? '', near_miss: c.near_miss ?? ''},
      Q.near_miss, `piece ${c.piece} near-miss`);
    v = noul(nm, 'story_passes_near_miss');
    if (v !== null && v >= POLICY.story_passes_near_miss) {
      flags.push(`JEV flag: piece ${c.piece}: main story ${c.main_story} does not rule out its near-miss (story_passes_near_miss ${f2(v)})`);
    }
    for (const act of c.actions) {
      const cb = await one({action: {name: act.name, description: act.description}, store_module: b.storeText.slice(0, 20000)},
        Q.content_branch, `action ${act.name}`);
      v = noul(cb, 'branches_on_text');
      if (v !== null && v >= POLICY.branches_on_text) {
        flags.push(`JEV flag: piece ${c.piece}: ${act.name} may act on the wording of typed text (branches_on_text ${f2(v)})`);
      }
    }
  }
  for (let i = 0; i < b.cards.length; i++) {
    for (let j = i + 1; j < b.cards.length; j++) {
      const [x, y] = [b.cards[i], b.cards[j]];
      const v = noul(await one({a: {name: x.piece, purpose: x.purpose}, b: {name: y.piece, purpose: y.purpose}},
        Q.redundancy, `pieces ${x.piece} and ${y.piece}`), 'same_need');
      if (v !== null && v >= POLICY.same_need) flags.push(`JEV flag: pieces ${x.piece} and ${y.piece} serve the same need (same_need ${f2(v)})`);
    }
  }
  return {flags, reads};
}

async function main(): Promise<number> {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {'ask-file': {type: 'string'}}});
  if (positionals.length !== 1) {
    console.error('usage: jev_checks.ts <bundle> [--ask-file <ask.txt>]');
    return 2;
  }
  const b = loadBundle(positionals[0]);
  const {refusals, facts} = runChecks(b);
  for (const l of [...refusals, ...facts]) console.log(l);
  if (refusals.length) {
    console.log(`${refusals.length} refusal(s); fix them before Jev reads the draft`);
    return 2;
  }
  const askText = values['ask-file'] ? readFileSync(values['ask-file'], 'utf8') : undefined;
  const {flags, reads} = await runJevChecks(b, defaultAsk, askText);
  for (const f of flags) console.log(f);
  console.log(`JEV read: ${reads} call(s), ${flags.filter((f) => f.startsWith('JEV flag')).length} flag(s)`);
  return 0;
}

if (import.meta.main) process.exit(await main());
