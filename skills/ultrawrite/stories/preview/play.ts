// Story play: before the sign question, each story plays out on the approved
// screen where the operator can watch. Steps off the ui layer run their tool;
// a ui step types and clicks through the elements its `ui` entries name, each
// outlined while it acts, then counts every `see` entry by role and name. A
// `select` entry opens its combobox and clicks the option in the listbox,
// which renders in a portal outside #app. Store-step args name rows by alias,
// as check.ts reads them, mapped to the store's own ids before each run.
import {find, nameOf, ownTextOf, roleOf, targetOf} from './names';
import {Aliases, type Content} from './probe';

type Target = {role: string; name: string};
type UiEntry = {type?: Target & {text: string}; click?: Target; select?: Target & {option: string}};
type See = Target & {count: number};
export type PlayStep = {tool: string; args?: Record<string, unknown>; layer?: string; ui?: UiEntry[]; see?: See[]};
export type PlayStory = {id: string; steps?: PlayStep[]};
type Tools = Record<string, (args: Record<string, unknown>) => boolean>;

const GAP = 300;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = (): ParentNode => document.getElementById('app') ?? document;

function count(role: string, name: string): number {
  let n = 0;
  // A run of text has no role or name, so `text` counts elements by their own text.
  const hit = role === 'text'
    ? (el: Element) => ownTextOf(el) === name
    : (el: Element) => roleOf(el) === role && nameOf(el) === name;
  for (const el of root().querySelectorAll('*')) if (hit(el)) n++;
  return n;
}

function setValue(el: Element, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (el instanceof HTMLInputElement && setter) setter.call(el, text);
  else if (el instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', {bubbles: true}));
}

/** Outline `el` while `job` runs on it. */
async function outlined(el: Element, job: (html: HTMLElement) => void) {
  const html = el as HTMLElement;
  const before = html.style.outline;
  html.style.outline = '3px solid #e8590c';
  try {
    await pause(GAP);
    job(html);
    await pause(GAP);
  } finally {
    html.style.outline = before;
  }
}

/** The element of `role` named `name` anywhere in the document, waited for up to `ms`. */
async function appearing(role: string, name: string, ms: number): Promise<Element | null> {
  const end = Date.now() + ms;
  for (;;) {
    const el = find(role, name, document);
    if (el || Date.now() >= end) return el;
    await pause(50);
  }
}

async function act(entry: UiEntry, misses: string[]) {
  const target = entry.type ?? entry.click ?? entry.select;
  if (!target) return;
  const el = find(target.role, target.name, root());
  if (!el) {
    misses.push(`no ${targetOf(target.role, target.name)}`);
    return;
  }
  if (entry.select) {
    const {option, name} = entry.select;
    await outlined(el, (html) => html.click());
    const opt = await appearing('option', option, 1000);
    if (!opt) {
      misses.push(`no option "${option}" in combobox "${name}"`);
      return;
    }
    await outlined(opt, (html) => html.click());
    return;
  }
  await outlined(el, (html) => {
    if (entry.type) setValue(el, entry.type.text);
    else html.click();
  });
}

let turn: Promise<unknown> = Promise.resolve();

/** Run `job` once every job queued before it has ended, whatever their outcome:
 *  each play clears and refills the one shared store, so two never overlap. */
export function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const mine = turn.then(job);
  turn = mine.catch(() => undefined);
  return mine;
}

/** Play one story on the screen as drawn; misses name what was not as the story says. */
export async function play(
  story: PlayStory,
  store: {delTables: () => unknown; delValues: () => unknown; getContent: () => Content},
  tools: Tools,
  schemas: Record<string, unknown> = {},
): Promise<{ok: boolean; misses: string[]}> {
  const misses: string[] = [];
  const preview = window.__PREVIEW__;
  if (preview) preview.playing = true;
  try {
    // The sample data saves values too (a party's title), so both are cleared.
    store.delTables();
    store.delValues();
    const aliases = new Aliases();
    aliases.learn(store.getContent());
    await pause(GAP);
    for (const step of story.steps ?? []) {
      if (step.layer !== 'ui') {
        try { tools[step.tool]?.(aliases.args(step.args ?? {}, schemas[step.tool])); } catch { /* a refused step changes nothing */ }
        aliases.learn(store.getContent());
        await pause(GAP);
        continue;
      }
      for (const entry of step.ui ?? []) await act(entry, misses);
      await pause(GAP);
      for (const s of step.see ?? []) {
        const n = count(s.role, s.name);
        if (n !== s.count) misses.push(`${targetOf(s.role, s.name)} seen ${n}, wanted ${s.count}`);
      }
      aliases.learn(store.getContent());
    }
  } finally {
    if (preview) preview.playing = false;
  }
  return {ok: misses.length === 0, misses};
}
