import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOT_INSTALLED, installed, loadContract, resolveTheme, themesDir } from './lib';
import { renderedSlots } from './sample.ts';

const USAGE = 'usage: bun check.ts <theme dir or name> [--slots <walk.json>] | --structure';
const GROUPS = new Set([':is', ':where', ':matches', ':-webkit-any', ':-moz-any']);
const RECURSE = new Set(['layer', 'media', 'supports', 'container', 'scope', 'document', 'starting-style']);
const LOOKS = [/^color$/, /^background/, /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color$/,
  /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/, /^box-shadow$/, /^font/, /^outline-color$/,
  /^fill$/, /^stroke$/, /^caret-color$/, /^accent-color$/, /^text-decoration-color$/, /^text-shadow$/,
  /^-webkit-text-fill-color$/, /^column-rule-color$/];
const SHORTHANDS = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|outline|column-rule|text-decoration)$/;
const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor accentcolortext';
const COLOUR_WORDS = new Set(NAMED.split(' '));
const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const RESETS = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const DIR_MASK = ':-theme-check-dir(';

type Item = { prelude: string; body: string | null };
type Alt = { slots: Set<string>; states: Set<string> };

function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end - 1;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
    } else out += ch;
  }
  return out;
}

function skipString(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1;
  return j + 1;
}

function items(css: string): Item[] {
  const out: Item[] = [];
  let start = 0;
  let paren = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") i = skipString(css, i) - 1;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (paren === 0 && ch === ';') {
      out.push({ prelude: css.slice(start, i).trim(), body: null });
      start = i + 1;
    } else if (paren === 0 && ch === '{') {
      let depth = 1;
      let j = i + 1;
      for (; j < css.length && depth > 0; j++) {
        if (css[j] === '"' || css[j] === "'") j = skipString(css, j) - 1;
        else if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
      }
      if (depth !== 0) throw new Error('an unclosed block');
      out.push({ prelude: css.slice(start, i).trim(), body: css.slice(i + 1, j - 1) });
      start = j;
      i = j - 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push({ prelude: rest, body: null });
  return out;
}

function walkRules(css: string, onRule: (selector: string, body: string) => void, onNested?: (selector: string) => void): void {
  for (const { prelude, body } of items(css)) {
    if (body === null) continue;
    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1] ?? '';
      if (RECURSE.has(name)) walkRules(body, onRule, onNested);
      continue;
    }
    if (items(body).some((it) => it.body !== null)) {
      if (!onNested) throw new Error(`the rule ${prelude} is still nested after flattening`);
      onNested(prelude);
    }
    onRule(prelude, body);
  }
}

function declarations(body: string): { property: string; value: string }[] {
  return items(body)
    .filter((it) => it.body === null && it.prelude.includes(':'))
    .map((it) => {
      const at = it.prelude.indexOf(':');
      return { property: it.prelude.slice(0, at).trim().toLowerCase(), value: it.prelude.slice(at + 1).trim() };
    });
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") i = skipString(s, i) - 1;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && ch === sep) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

function subject(complex: string): string {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < complex.length; i++) {
    const ch = complex[i];
    if (ch === '"' || ch === "'") i = skipString(complex, i) - 1;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~' || ch === '|' && complex[i + 1] === '|')) {
      last = i + 1;
    }
  }
  return complex.slice(last).trim();
}

function balanced(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '"' || s[j] === "'") j = skipString(s, j) - 1;
    else if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  throw new Error(`an unbalanced selector ${s}`);
}

function simples(compound: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < compound.length) {
    const ch = compound[i];
    let end: number;
    if (ch === '[') end = balanced(compound, i, '[', ']');
    else if (ch === ':') {
      end = i + (compound[i + 1] === ':' ? 2 : 1);
      while (end < compound.length && /[\w-]/.test(compound[end])) end++;
      if (compound[end] === '(') end = balanced(compound, end, '(', ')');
    } else {
      end = i + 1;
      while (end < compound.length && !'[:.#'.includes(compound[end])) end++;
      if (ch === '.' || ch === '#') {
        end = i + 1;
        while (end < compound.length && /[\w-]/.test(compound[end])) end++;
      }
    }
    out.push(compound.slice(i, end));
    i = end;
  }
  return out;
}

function norm(fragment: string): string {
  return fragment.replace(/\s+/g, ' ').replace(/\s*([(),>+~])\s*/g, '$1').replace(/'/g, '"').trim()
    .replace(/^:(before|after|first-line|first-letter)$/i, '::$1');
}

function slotOf(simple: string): string | null {
  const m = /^\[\s*data-slot\s*=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*\]$/.exec(simple);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function lowered(simple: string): boolean {
  const group = /^(:[\w-]+)\((.*)\)$/s.exec(simple);
  if (!group) return false;
  const name = group[1].toLowerCase();
  if (name === ':lang') return true;
  if (!GROUPS.has(name) && name !== ':not') return false;
  const args = splitTop(group[2], ',');
  return args.length > 0 && args.every((a) => simples(a).length === 1 && lowered(a));
}

function alternatives(compound: string): Alt[] {
  let alts: Alt[] = [{ slots: new Set(), states: new Set() }];
  for (const simple of simples(compound)) {
    const slot = slotOf(simple);
    const group = /^(:[\w-]+)\((.*)\)$/s.exec(simple);
    if (lowered(simple)) continue;
    if (slot !== null) {
      for (const a of alts) a.slots.add(slot);
    } else if (group && GROUPS.has(group[1].toLowerCase())) {
      const inner = splitTop(group[2], ',').flatMap((arg) => alternatives(subject(arg)));
      alts = alts.flatMap((a) => inner.map((b) => ({
        slots: new Set([...a.slots, ...b.slots]),
        states: new Set([...a.states, ...b.states]),
      })));
    } else if (simple.startsWith('[') || simple.startsWith(':') || simple.startsWith('.') || simple.startsWith('#')) {
      for (const a of alts) a.states.add(norm(simple));
    }
  }
  return alts;
}

function flatten(css: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theme-check-'));
  try {
    const file = join(dir, 'in.css');
    writeFileSync(file, css.replaceAll(':dir(', DIR_MASK));
    const r = Bun.spawnSync([process.execPath, 'build', file, '--external', '*'], { stdout: 'pipe', stderr: 'pipe' });
    if (r.exitCode !== 0) throw new Error(`Bun could not read the CSS: ${r.stderr.toString().trim().split('\n').find((l) => l.startsWith('error')) ?? r.stderr.toString().trim()}`);
    return stripComments(r.stdout.toString()).replaceAll(DIR_MASK, ':dir(');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function styled(css: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  walkRules(flatten(css), (selector) => {
    for (const complex of splitTop(selector, ',')) {
      for (const alt of alternatives(subject(complex))) {
        for (const slot of alt.slots) {
          const set = map.get(slot) ?? new Set<string>();
          if (alt.states.size === 0) set.add('');
          for (const s of alt.states) set.add(s);
          map.set(slot, set);
        }
      }
    }
  });
  return map;
}

function satisfies(states: Set<string>, required: string): boolean {
  const want = norm(required);
  if (states.has(want)) return true;
  if (want === ':active' && states.has('[data-pressed]')) return true;
  const presence = /^\[([\w-]+)\]$/.exec(want);
  if (presence) for (const s of states) if (new RegExp(`^\\[${presence[1]}([~|^$*]?=|\\])`).test(s)) return true;
  return false;
}

function loads(file: string, css: string): string[] {
  const out: string[] = [];
  const bare = stripComments(css);
  const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/s, '$2').trim();
  const imports = /@import\s+(?:url\(\s*([^)]*?)\s*\)|("[^"]*"|'[^']*'))[^;]*;?/gi;
  for (const m of bare.matchAll(imports)) {
    const value = unquote(m[1] ?? m[2]);
    if (!/^data:/i.test(value)) out.push(`theme: ${file} loads ${value}, which is not a data URL`);
  }
  const rest = bare.replace(imports, '');
  for (const m of rest.matchAll(/url\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)/gi)) {
    const value = unquote(m[1]);
    if (!/^data:/i.test(value)) out.push(`theme: ${file} loads ${value}, which is not a data URL`);
  }
  for (const m of rest.matchAll(/image-set\(/gi)) {
    const start = m.index + m[0].length - 1;
    const args = rest.slice(start + 1, balanced(rest, start, '(', ')') - 1);
    for (const arg of splitTop(args, ',')) {
      const str = /^("[^"]*"|'[^']*')/.exec(arg.trim());
      if (str && !/^data:/i.test(unquote(str[1]))) out.push(`theme: ${file} loads ${unquote(str[1])}, which is not a data URL`);
    }
  }
  return out;
}

function required() {
  return loadContract().components.flatMap((c) => c.slots).filter((s) => !s.hidden && !s.optional);
}

export function findings(themeDir: string): string[] {
  const { name, dir } = resolveTheme(themeDir);
  const out: string[] = [];
  const themeCss = join(dir, 'theme.css');
  if (!existsSync(themeCss)) out.push('theme: theme.css is missing');
  else {
    const css = readFileSync(themeCss, 'utf8');
    const layers = `@layer ui-sdk, structure, ${name};`;
    if (!css.trimStart().startsWith(layers)) out.push(`theme: theme.css must begin "${layers}"`);
    out.push(...loads('theme.css', css));
    const font = join(dir, 'font.css');
    if (existsSync(font)) out.push(...loads('font.css', readFileSync(font, 'utf8')));
    const map = styled(css);
    for (const slot of required()) {
      const states = map.get(slot.slot) ?? new Set<string>();
      const sel = `[data-slot="${slot.slot}"]`;
      if (!map.has(slot.slot)) out.push(`theme: no rule styles ${sel}`);
      for (const st of slot.states) if (!satisfies(states, st.state)) out.push(`theme: no rule styles ${sel}${st.state}`);
    }
  }
  for (const doc of ['README.md', 'LICENSE']) if (!existsSync(join(dir, doc))) out.push(`theme: ${doc} is missing`);
  const listed = new Set(loadContract().components.flatMap((c) => c.slots.map((s) => s.slot)));
  for (const slot of renderedSlots()) {
    if (!listed.has(slot)) out.push(`contract: the sample renders [data-slot="${slot}"], which the contract does not list`);
  }
  return out;
}

function carriesColour(value: string): boolean {
  if (/#[0-9a-f]{3,8}\b/i.test(value) || COLOUR_FUNCTION.test(value)) return true;
  return value.toLowerCase().split(/[\s,()\/]+/).some((w) => COLOUR_WORDS.has(w));
}

function setsALook(property: string, value: string): boolean {
  if (RESETS.has(value.toLowerCase())) return false;
  if (LOOKS.some((re) => re.test(property))) return true;
  if (property === 'filter' && /drop-shadow\(/i.test(value)) return true;
  return SHORTHANDS.test(property) && carriesColour(value);
}

function structureFindings(): string[] {
  const out: string[] = [];
  const css = stripComments(readFileSync(join(themesDir(), 'structure.css'), 'utf8'));
  walkRules(css, (_selector, body) => {
    for (const { property, value } of declarations(body)) {
      if (setsALook(property, value)) out.push(`structure: ${property} sets a look`);
    }
  }, (selector) => out.push(`structure: ${selector} nests a rule`));
  return [...new Set(out)];
}

function walkFindings(themeDir: string, walkFile: string): string[] {
  const { dir } = resolveTheme(themeDir);
  const themeCss = join(dir, 'theme.css');
  if (!existsSync(themeCss)) throw new Error(`${dir} has no theme.css`);
  const walk = JSON.parse(readFileSync(walkFile, 'utf8'));
  if (!Array.isArray(walk.slots) || !walk.slots.every((s: unknown) => typeof s === 'string')) {
    throw new Error(`${walkFile} has no slots list`);
  }
  const skip = new Set(loadContract().components.flatMap((c) => c.slots).filter((s) => s.hidden || s.optional).map((s) => s.slot));
  const map = styled(readFileSync(themeCss, 'utf8'));
  return [...new Set<string>(walk.slots)]
    .filter((slot) => !skip.has(slot) && !map.has(slot))
    .map((slot) => `walk: [data-slot="${slot}"] is on the page and no rule in the theme styles it`);
}

function main(argv: string[]): number {
  try {
    if (argv.length === 1 && argv[0] === '--structure') {
      const out = structureFindings();
      console.log(out.length ? out.join('\n') : 'STRUCTURE OK');
      return out.length ? 1 : 0;
    }
    const [theme, ...rest] = argv;
    if (!theme || theme.startsWith('--') || !(rest.length === 0 || (rest.length === 2 && rest[0] === '--slots'))) {
      console.log(USAGE);
      return 2;
    }
    if (!installed()) {
      console.log(NOT_INSTALLED);
      return 2;
    }
    if (rest[0] === '--slots') {
      const out = walkFindings(theme, rest[1]);
      if (out.length) console.log(out.join('\n'));
      return 0;
    }
    const out = findings(theme);
    if (out.length) {
      console.log(out.join('\n'));
      return 1;
    }
    console.log(`THEME OK: ${resolveTheme(theme).name}, ${required().length} slots`);
    return 0;
  } catch (e) {
    console.log(`could not run: ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
