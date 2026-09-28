// The code checks a bundle meets before compile. A refusal stops compile; a
// fact is printed for the author to act on and stops nothing.
import {KINDS, type Bundle} from './bundle';

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
        if (!stories.some((s) => (s.steps ?? []).some((st) => st.tool === a.name && st.refused))) {
          facts.push(`CODE fact: piece ${c.piece}: ${a.name} refuses "${r}" but no step shows it`);
        }
      }
    }
  }
  return {refusals, facts};
}
