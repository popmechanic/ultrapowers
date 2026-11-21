// The code checks a bundle meets before compile. A refusal stops compile; a
// fact is printed for the author to act on and stops nothing.
import {KINDS, conceptsOf, type Bundle, type Card} from './bundle';
import {TEMPLATE_DRAWS, readDraws, undrawn, type Draws} from './parts';
import {checkProduct} from './product';

const GESTURES = new Set(['click', 'type', 'key', 'select']);
const isGesture = (g: unknown) =>
  !!g && typeof g === 'object' && Object.keys(g).length === 1 && GESTURES.has(Object.keys(g)[0]);
const named = (text: string, word: string) => text.split(word).length - 1;

// Every piece `piece` depends on, directly or through others; a circle ends the walk.
export function below(cards: Card[], piece: string): Set<string> {
  const seen = new Set<string>();
  const walk = (p: string) => {
    for (const d of cards.find((c) => c.piece === p)?.depends_on ?? []) {
      if (!seen.has(d)) {
        seen.add(d);
        walk(d);
      }
    }
  };
  walk(piece);
  return seen;
}

/** `draws`: what the screen parts draw, the template's by default (#1491). */
export function runChecks(b: Bundle, draws: Draws | null = readDraws(TEMPLATE_DRAWS)): {refusals: string[]; facts: string[]} {
  const {page, cards} = b;
  const refusals: string[] = [];
  const facts: string[] = [];
  if (!KINDS.includes(page.kind)) refusals.push('page: kind must be behaviour or preserve');
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
  // The sandbox's parser reads an id only as S, L or N followed by digits;
  // any other id would compile and then be dropped without a word.
  const idKinds = [['story', 'S', storyIds], ['link', 'L', linkIds],
    ['number', 'N', (page.numbers ?? []).map((n) => n.id)]] as const;
  for (const [what, letter, ids] of idKinds) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!(typeof id === 'string' && new RegExp(`^${letter}\\d+$`).test(id))) {
        refusals.push(`${what} ${id}: its id must be ${letter} followed by digits, like ${letter}1`);
      } else if (seen.has(id)) {
        refusals.push(`${what} ${id}: its id is used twice`);
      }
      seen.add(id);
    }
  }
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
        refusals.push(`${where}: a ui step needs ui = a list of click/type/key/select gestures`);
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
        // compile hands the step's check to the one link piece (the tool's owner counted) built after all the others
        const ps = [...new Set([...((page.links ?? []).find((l) => l.id === st.link)?.pieces ?? []), owner.get(st.tool) ?? ''])].filter((p) => pieces.has(p));
        if (linkIds.includes(st.link) && ps.length > 1 && !ps.some((p) => ps.every((q) => q === p || below(cards, p).has(q)))) {
          facts.push(`CODE fact: ${where}: link ${st.link} joins ${ps.join(', ')}, but none of them depends on all the others, so its check goes to ${owner.get(st.tool)}, the tool's owner, and may run before the others are built; make one depend on the rest`);
        }
      }
    });
  }
  for (const l of linkIds) if (!linked.has(l)) refusals.push(`link ${l} has no step`);
  for (const l of page.links ?? []) for (const p of l.pieces ?? []) if (!pieces.has(p)) refusals.push(`link ${l.id}: names piece ${p}, which is no piece`);

  const badConcepts = new Set<string>();
  for (const c of cards) {
    if (c.concepts !== undefined && !(Array.isArray(c.concepts) && c.concepts.every((x) => typeof x === 'string'))) {
      refusals.push(`piece ${c.piece}: concepts must be a list of concept ids, not ${JSON.stringify(c.concepts)}`);
      badConcepts.add(c.piece);
    }
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
  for (const r of checkShows(cards)) refusals.push(r);
  const productErrs = b.product ? checkProduct(b.product) : [];
  for (const e of productErrs) refusals.push(`product.json: ${e}`);
  if (b.product && page.subproject && !productErrs.length) {
    const sp = b.product.subprojects.find((s) => s.id === page.subproject);
    if (!sp) {
      refusals.push(`page: subproject ${page.subproject} is not in product.json`);
    } else {
      for (const c of cards) {
        if (badConcepts.has(c.piece)) continue;
        const named = conceptsOf(c);
        if (!named.length) refusals.push(`piece ${c.piece}: its concept (none) is not one this plan builds`);
        for (const id of named) {
          if (!sp.concepts.includes(id)) refusals.push(`piece ${c.piece}: its concept ${id} is not one this plan builds`);
        }
      }
      // A change to a built plan carries cards only for what it changes.
      if (sp.status !== 'built') {
        for (const id of sp.concepts) {
          if (!cards.some((c) => conceptsOf(c).includes(id))) refusals.push(`concept ${id}: this plan builds it, but no card has it`);
        }
      }
    }
  } else if (b.product && !page.subproject) {
    refusals.push('page: product.json is present, so page.json must name its subproject');
  }
  // A story that expects to see something no screen part draws (#1491): the run adds the part, so
  // the compiler writes it into the task that needs it; the author hears of it here, before launch.
  for (const u of draws ? undrawn(b, draws) : []) {
    const who = u.stories.length > 1 ? `stories ${u.stories.join(', ')} expect` : `story ${u.stories[0]} expects`;
    facts.push(`PARTS fact: ${who} a ${u.role} (such as "${u.name}"), and no screen part draws one yet; the tasks that need it are told to add one`);
  }
  return {refusals, facts};
}

const slotsOf = (text: string) => [...text.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);

/** The refusals for each card's `shows` lines and `words`: one sentence each, naming the piece. */
export function checkShows(cards: Card[]): string[] {
  const refusals: string[] = [];
  const columns = new Map<string, Set<string>>();
  for (const c of cards) {
    for (const [t, cells] of Object.entries(c.state?.tables ?? {})) {
      const set = columns.get(t) ?? new Set<string>();
      for (const cell of Array.isArray(cells) ? cells : []) set.add(cell);
      columns.set(t, set);
    }
  }
  const anyColumn = new Set([...columns.values()].flatMap((s) => [...s]));
  const values = new Set(cards.flatMap((c) => (Array.isArray(c.state?.values) ? c.state.values : [])));
  const pageSlot = (slot: string) => {
    if (values.has(slot)) return true;
    let m = slot.match(/^sum (\w+)\.(\w+)$/);
    if (m) return !!columns.get(m[1])?.has(m[2]);
    m = slot.match(/^count (\w+)$/);
    if (m) return columns.has(m[1]);
    m = slot.match(/^count (\w+) (\w+)=(.+)$/);
    if (m) return !!columns.get(m[1])?.has(m[2]);
    return false;
  };
  let headings = 0;
  for (const c of cards) {
    if (c.shows === undefined && c.words === undefined) continue;
    const slots = new Set<string>();
    for (const line of Array.isArray(c.shows) ? c.shows : []) {
      const keys = line && typeof line === 'object' ? Object.keys(line).sort().join(',') : '';
      const l = line as {text?: unknown; in?: unknown; heading?: unknown};
      const ok = (keys === 'text' && typeof l.text === 'string')
        || (keys === 'in,text' && typeof l.text === 'string' && typeof l.in === 'string')
        || (keys === 'heading' && typeof l.heading === 'string');
      if (!ok) {
        refusals.push(`piece ${c.piece}: a shows line must be {"text"}, {"text", "in"} or {"heading"}, not ${JSON.stringify(line)}`);
        continue;
      }
      const text = (l.text ?? l.heading) as string;
      if (l.heading !== undefined) headings++;
      for (const slot of slotsOf(text)) {
        slots.add(slot);
        if (typeof l.in === 'string') {
          const [col, cell, ...more] = slot.split('.');
          if (!(columns.get(l.in)?.has(col) && !more.length && (cell === undefined || anyColumn.has(cell)))) {
            refusals.push(`piece ${c.piece}: the shows line "${text}" names \${${slot}}, which is no column of ${l.in}${cell === undefined ? '' : ' with a column of some table after it'}`);
          }
        } else if (!pageSlot(slot)) {
          refusals.push(`piece ${c.piece}: the shows line "${text}" names \${${slot}}, which is no card's value nor a sum or count over a table some card holds`);
        }
      }
      if (typeof l.in === 'string' && !Object.keys(c.state?.tables ?? {}).includes(l.in)) {
        refusals.push(`piece ${c.piece}: a shows line is in ${l.in}, which this card does not hold`);
      }
    }
    if (c.shows !== undefined && !Array.isArray(c.shows)) refusals.push(`piece ${c.piece}: shows must be a list of lines`);
    for (const k of Object.keys(c.words && typeof c.words === 'object' ? c.words : {})) {
      if (!slots.has(k)) refusals.push(`piece ${c.piece}: words names ${k}, which is no slot of this card's shows lines`);
    }
  }
  if (headings > 1) refusals.push(`the cards give ${headings} heading lines; one card's heading becomes the page heading, so give only one`);
  return refusals;
}
