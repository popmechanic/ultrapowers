// Story play: before the sign question, each story plays out on the approved
// screen where the operator can watch. Steps off the ui layer run their tool;
// a ui step types and clicks through the elements its `ui` entries name, each
// outlined while it acts, then counts every `see` entry by role and name.
import {find, nameOf, roleOf, targetOf} from './names';

type Target = {role: string; name: string};
type UiEntry = {type?: Target & {text: string}; click?: Target};
type See = Target & {count: number};
export type PlayStep = {tool: string; args?: Record<string, unknown>; layer?: string; ui?: UiEntry[]; see?: See[]};
export type PlayStory = {id: string; steps?: PlayStep[]};
type Tools = Record<string, (args: Record<string, unknown>) => boolean>;

const GAP = 300;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = (): ParentNode => document.getElementById('app') ?? document;

function count(role: string, name: string): number {
  let n = 0;
  for (const el of root().querySelectorAll('*')) if (roleOf(el) === role && nameOf(el) === name) n++;
  return n;
}

function setValue(el: Element, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (el instanceof HTMLInputElement && setter) setter.call(el, text);
  else if (el instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', {bubbles: true}));
}

async function act(entry: UiEntry, misses: string[]) {
  const target = entry.type ?? entry.click;
  if (!target) return;
  const el = find(target.role, target.name, root());
  if (!el) {
    misses.push(`no ${targetOf(target.role, target.name)}`);
    return;
  }
  const html = el as HTMLElement;
  const before = html.style.outline;
  html.style.outline = '3px solid #e8590c';
  try {
    await pause(GAP);
    if (entry.type) setValue(el, entry.type.text);
    else html.click();
    await pause(GAP);
  } finally {
    html.style.outline = before;
  }
}

/** Play one story on the screen as drawn; misses name what was not as the story says. */
export async function play(story: PlayStory, store: {delTables: () => unknown}, tools: Tools): Promise<{ok: boolean; misses: string[]}> {
  const misses: string[] = [];
  const preview = window.__PREVIEW__;
  if (preview) preview.playing = true;
  try {
    store.delTables();
    await pause(GAP);
    for (const step of story.steps ?? []) {
      if (step.layer !== 'ui') {
        try { tools[step.tool]?.(step.args ?? {}); } catch { /* a refused step changes nothing */ }
        await pause(GAP);
        continue;
      }
      for (const entry of step.ui ?? []) await act(entry, misses);
      await pause(GAP);
      for (const s of step.see ?? []) {
        const n = count(s.role, s.name);
        if (n !== s.count) misses.push(`${targetOf(s.role, s.name)} seen ${n}, wanted ${s.count}`);
      }
    }
  } finally {
    if (preview) preview.playing = false;
  }
  return {ok: misses.length === 0, misses};
}
