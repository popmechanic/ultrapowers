#!/usr/bin/env bun
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {loadQuestions} from './jev';

type Question = {instructions: {question: string}};
type Answer = {answer?: unknown; evidence?: unknown};
export type Walk = {app?: string; run?: string; answers?: Record<string, Answer>; operator?: string; note?: string;
  script_bytes?: number; slots?: string[]};

const WORDS = ['yes', 'partly', 'no'];
const USAGE = 'usage: walk.ts questions | render <walk.json> | verdict <walk.json> --operator agree|disagree [--note <text>] | agreement <dir>';

export function questions(): [string, string][] {
  const set = loadQuestions().smoke_walk?.questions as Record<string, Question> | undefined;
  return Object.entries(set ?? {}).map(([id, q]) => [id, q.instructions.question]);
}

export function problems(w: Walk): string[] {
  const out: string[] = [];
  const ids = questions().map(([id]) => id);
  const answers = w.answers ?? {};
  for (const id of ids) {
    const a = answers[id];
    if (!a) {
      out.push(`walk: ${id} is not answered`);
      continue;
    }
    if (!WORDS.includes(a.answer as string)) out.push(`walk: ${id} answers ${JSON.stringify(a.answer)}, not yes, partly or no`);
    if (typeof a.evidence !== 'string' || !a.evidence.trim()) out.push(`walk: ${id} carries no evidence`);
  }
  for (const id of Object.keys(answers)) if (!ids.includes(id)) out.push(`walk: ${id} is not one of the questions`);
  if (w.script_bytes !== undefined && (typeof w.script_bytes !== 'number' || !Number.isFinite(w.script_bytes))) out.push('walk: script_bytes must be a number of bytes');
  if (w.slots !== undefined && (!Array.isArray(w.slots) || !w.slots.every((s) => typeof s === 'string'))) out.push('walk: slots must be a list of slot names');
  return out;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function render(w: Walk): string {
  const rows = questions().map(([id, q]) => `| ${cell(q)} | ${w.answers![id].answer} | ${cell(String(w.answers![id].evidence))} |`);
  const lines = [...(w.script_bytes === undefined ? [] : [`Script the page loads: ${w.script_bytes.toLocaleString('en-US')} bytes.`]),
    ...(w.slots === undefined ? [] : [`UI SDK slots on the page: ${w.slots.length ? `${w.slots.length} (${[...w.slots].sort().join(', ')})` : 'none'}.`])];
  const table = ['### Experience walk', '', `${w.app ?? 'the app'}, ${w.run ?? 'run not named'}. A report for the operator; it gates nothing.`, '',
    '| Question | Answer | Evidence |', '|---|---|---|', ...rows].join('\n');
  return lines.length ? `${table}\n\n${lines.join('\n')}` : table;
}

export function agreement(dir: string): string {
  let agree = 0, disagree = 0, unjudged = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.walk.json')).sort()) {
    const w: Walk = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (w.operator === 'agree') agree += 1;
    else if (w.operator === 'disagree') disagree += 1;
    else unjudged += 1;
  }
  return `walk readings: n=${agree + disagree} walks, agree ${agree}, disagree ${disagree}, unjudged ${unjudged}`;
}

function main(argv: string[]): number {
  const [cmd, file, ...rest] = argv;
  if (cmd === 'questions') {
    for (const [id, q] of questions()) console.log(`${id}: ${q}`);
    return 0;
  }
  if (!file || !['render', 'verdict', 'agreement'].includes(cmd)) {
    console.error(USAGE);
    return 2;
  }
  if (cmd === 'agreement') {
    console.log(agreement(file));
    return 0;
  }
  const w: Walk = JSON.parse(readFileSync(file, 'utf8'));
  const bad = problems(w);
  if (bad.length) {
    console.log(bad.join('\n'));
    return 2;
  }
  if (cmd === 'render') {
    console.log(render(w));
    return 0;
  }
  const {values: v} = parseArgs({args: rest, options: {operator: {type: 'string'}, note: {type: 'string'}}});
  if (v.operator !== 'agree' && v.operator !== 'disagree') {
    console.error(USAGE);
    return 2;
  }
  w.operator = v.operator;
  if (v.note) w.note = v.note;
  writeFileSync(file, JSON.stringify(w, null, 1) + '\n');
  console.log(`WALK ${v.operator}: ${file}`);
  return 0;
}

if (import.meta.main) {
  let code = 2;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    console.log(`walk: ${(e as Error).message}`);
  }
  process.exit(code);
}
