// The code checks a bundle meets before compile. A refusal stops compile; a
// fact is printed for the author to act on and stops nothing.
import {KINDS, type Bundle} from './bundle';
import {checkProduct} from './product';

const GESTURES = new Set(['click', 'type', 'key']);
const isGesture = (g: unknown) =>
  !!g && typeof g === 'object' && Object.keys(g).length === 1 && GESTURES.has(Object.keys(g)[0]);
const named = (text: string, word: string) => text.split(word).length - 1;

export function runChecks(b: Bundle): {refusals: string[]; facts: string[]} {
  const {page, cards} = b;
  const refusals: string[] = [];
  const facts: string[] = [];
  if (!KINDS.includes(page.kind)) refusals.push('page: kind must be behaviour, preserve or look');
  if (!(Array.isArray(page.summary) && page.summary.length === 3
        && page.summary.every((s) => typeof s === 'string' && s.trim() !== ''))) {
    refusals.push('page: summary must be three sentences');
  }
  if (page.store !== 'client/src/store.js') {
    refusals.push(`page: store must be client/src/store.js, not ${page.store}`);
  }
  if (page.publish !== undefined && !(typeof page.publish?.deploy === 'string' && page.publish.deploy.trim()
      && typeof page.publish?.verify === 'string' && page.publish.verify.trim())) {
    refusals.push('page: publish needs a deploy command and a verify command');
  }
  const stories = page.stories ?? [];
  const storyIds = stories.map((s) => s.id);
  const linkIds = (page.links ?? []).map((l) => l.id);
  if (page.kind === 'behaviour' && !stories.length) refusals.push('page: a behaviour plan needs at least one story');
  if (page.kind === 'preserve' && !(page.numbers ?? []).length) refusals.push('page: a preserve plan needs at least one number');

  const owner = new Map(cards.flatMap((c) => c.actions.map((a) => [a.name, c.piece] as const)));
  const pieces = new Set(cards.map((c) => c.piece));
  const linked = new Set<string>();
  for (const s of stories) {
    const steps = s.steps ?? [];
    if (!steps.length) {
      refusals.push(`story ${s.id} has no steps`);
      continue;
    }
    if (!steps.some((st) => st.layer === 'ui' || st.layer === 'saved')) {
      refusals.push(`story ${s.id}: no step is done on the screen or after a reload; mark one ui or saved`);
    }
    steps.forEach((st, i) => {
      const where = `step ${s.id}.${i + 1}`;
      if (!owner.has(st.tool)) refusals.push(`${where}: tool ${st.tool} is no piece's action`);
      if (!['store', 'ui', 'saved'].includes(st.layer)) refusals.push(`${where}: layer must be store, ui or saved`);
      if (st.layer === 'ui' && !(Array.isArray(st.ui) && st.ui.length && st.ui.every(isGesture))) {
        refusals.push(`${where}: a ui step needs ui = a list of click/type/key gestures`);
      }
      if (st.layer !== 'ui' && st.ui !== undefined) refusals.push(`${where}: only a ui step carries ui`);
      if (st.as !== undefined && !(st.as === null || (typeof st.as === 'string' && st.as !== ''))) {
        refusals.push(`${where}: as must be an email, or null for nobody signed in`);
      }
      if (st.refused && (i !== steps.length - 1 || st.layer !== 'ui')) {
        refusals.push(`${where}: a refused step must be the story's last, and done on the screen (ui)`);
      }
      if (st.link !== undefined) {
        if (linkIds.includes(st.link)) linked.add(st.link);
        else refusals.push(`${where}: link ${st.link} is not on the page`);
      }
    });
  }
  for (const l of linkIds) if (!linked.has(l)) refusals.push(`link ${l} has no step`);

  for (const c of cards) {
    if (!storyIds.includes(c.main_story ?? '')) {
      refusals.push(`piece ${c.piece}: its main story ${c.main_story} is not on the page`);
    }
    for (const d of c.depends_on ?? []) {
      if (!pieces.has(d)) refusals.push(`piece ${c.piece}: depends on ${d}, which is no piece`);
    }
    for (const [t, cells] of Object.entries(c.state?.tables ?? {})) {
      for (const cell of cells) {
        if (named(b.storeText, cell) < 2) {
          facts.push(`CODE fact: piece ${c.piece}: ${t}.${cell} is named fewer than twice in the store module; no action may use it`);
        }
      }
    }
    for (const a of c.actions) {
      for (const r of a.refuses ?? []) {
        const shown = stories.some((s) => (s.steps ?? []).some((st) => st.tool === a.name && st.refused === r));
        const waiver = (page.waivers ?? []).find((w) => w.action === a.name && w.refuses === r);
        if (shown) continue;
        if (!waiver) {
          refusals.push(`piece ${c.piece}: ${a.name} refuses "${r}" but no story shows it; add a story ending in a step with "refused": "${r}", or a waiver if it cannot happen from the screen`);
          continue;
        }
        const prop = (a.inputSchema as {properties?: Record<string, Record<string, unknown>>})?.properties?.[waiver.arg];
        if (waiver.reason !== 'unreachable-from-screen') {
          refusals.push(`waiver ${a.name} "${r}": reason must be unreachable-from-screen`);
        } else if (!prop || typeof prop['x-row-of'] !== 'string') {
          refusals.push(`waiver ${a.name} "${r}": ${waiver.arg} is not a row id, so the screen can pass it; show it with a story instead`);
        }
      }
    }
  }
  const actionsByName = new Map(cards.flatMap((c) => c.actions.map((a) => [a.name, a] as const)));
  for (const w of page.waivers ?? []) {
    const a = actionsByName.get(w.action);
    if (!a || !(a.refuses ?? []).includes(w.refuses)) {
      refusals.push(`waiver ${w.action} "${w.refuses}": no action refuses that`);
    }
  }
  const productErrs = b.product ? checkProduct(b.product) : [];
  for (const e of productErrs) refusals.push(`product.json: ${e}`);
  if (b.product && page.subproject && !productErrs.length) {
    const sp = b.product.subprojects.find((s) => s.id === page.subproject);
    if (!sp) {
      refusals.push(`page: subproject ${page.subproject} is not in product.json`);
    } else {
      for (const c of cards) {
        if (!c.concept || !sp.concepts.includes(c.concept)) {
          refusals.push(`piece ${c.piece}: its concept ${c.concept ?? '(none)'} is not one this plan builds`);
        }
      }
      // A change to a built plan carries cards only for what it changes.
      if (sp.status !== 'built') {
        for (const id of sp.concepts) {
          if (!cards.some((c) => c.concept === id)) refusals.push(`concept ${id}: this plan builds it, but no card has it`);
        }
      }
    }
  } else if (b.product && !page.subproject) {
    refusals.push('page: product.json is present, so page.json must name its subproject');
  }
  return {refusals, facts};
}
