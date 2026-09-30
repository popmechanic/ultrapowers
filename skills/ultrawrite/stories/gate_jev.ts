#!/usr/bin/env bun
// What Jev would have said at the proof gate. It reads the gate reader's diet (the task's Claim
// with its numbered Machine clauses, and the Proof slot) and asks, in one request, whether each
// clause states a computable fact, whether a probe would catch it false, and whether a leg
// contradicts the clause it cites, and, when the diet carries `base`, whether a file there already
// pins the opposite of a clause. The verdict is computed here, from policy.json. Jev judges
// beside the agent reader; it decides nothing.
//
//   bun skills/ultrawrite/stories/gate_jev.ts <diet.json> [--record <gate-verdicts.json> --agent pass|fail --reason <sentence>]
//   bun skills/ultrawrite/stories/gate_jev.ts --agreement <dir>
//   bun skills/ultrawrite/stories/gate_jev.ts --label <gate-verdicts.json> --task <id> --round <n> --right agent|jev --because "<one line>"
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {at, defaultAsk, noul} from './jev';

const Q = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', 'factory', 'questions.json'), 'utf8')).sets.authoring_gate.questions;
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;

type Diet = {task: string | number; claim: string; proof: string; hash: string; base?: Record<string, unknown>};
type Verdict = 'pass' | 'fail' | null;
type Round = {hash: string; agent: string; jev: Verdict; clauses?: unknown; contradiction?: number | null; pinned?: number | null;
  right?: 'agent' | 'jev'; because?: string};

const ids = (tag: string | undefined) => (tag ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function gateState(d: Diet) {
  const m = d.claim.indexOf('Machine:');
  const claim = (m < 0 ? d.claim : d.claim.slice(0, m)).trim();
  const machine = m < 0 ? '' : d.claim.slice(m + 'Machine:'.length);
  const parts = machine.split(/(?:^|\s)(M\d+)\.\s+/);
  const clauses: {id: string; text: string}[] = [];
  for (let k = 1; k < parts.length; k += 2) clauses.push({id: parts[k], text: parts[k + 1].trim()});
  const probes: {command: string; proves: string[]}[] = [];
  const legs: {text: string; cites: string[]}[] = [];
  for (const line of d.proof.split('\n')) {
    const run = line.match(/^\s*-\s*Run:\s*(.*?)\s*(?:\[(M\d+(?:\s*,\s*M\d+)*)\])?\s*$/);
    if (run) probes.push({command: run[1], proves: ids(run[2])});
    const legLine = line.match(/^\s*-\s*Legs:\s*(.*)$/);
    if (legLine) {
      for (const piece of legLine[1].split(/\([a-z]\)\s*/).map((s) => s.trim()).filter(Boolean)) {
        const t = piece.replace(/[;.]\s*$/, '').trim();
        const c = t.match(/\s*\[(M\d+(?:\s*,\s*M\d+)*)\]$/);
        legs.push({text: c ? t.slice(0, c.index).trim() : t, cites: ids(c?.[1])});
      }
    }
  }
  return d.base && typeof d.base === 'object' ? {claim, clauses, probes, legs, base: d.base} : {claim, clauses, probes, legs};
}

async function read(d: Diet) {
  const state = gateState(d);
  const questions: Record<string, unknown> = {};
  state.clauses.forEach((c, i) => {
    questions[`fact:${c.id}`] = at(Q.fact, {i});
    questions[`caught:${c.id}`] = at(Q.caught, {i});
  });
  questions.contradiction = Q.contradiction;
  if ('base' in state) questions.pinned = Q.pinned;
  const answers = await defaultAsk(state, questions);
  const clauses = state.clauses.map((c) => ({id: c.id, fact: noul(answers, `fact:${c.id}`), caught: noul(answers, `caught:${c.id}`)}));
  const contradiction = noul(answers, 'contradiction');
  const pinned = 'base' in state ? noul(answers, 'pinned') : null;
  let verdict: Verdict = null;
  if (answers !== null) {
    const uncaught = clauses.some((c) => c.fact !== null && c.caught !== null && c.fact >= POLICY.gate_fact && c.caught < POLICY.gate_caught_below);
    verdict = uncaught || (contradiction !== null && contradiction >= POLICY.gate_contradiction)
      || (pinned !== null && pinned >= POLICY.gate_pinned) ? 'fail' : 'pass';
  }
  return {task: d.task, hash: d.hash, verdict, clauses, contradiction, pinned};
}

// The one writer of the gate verdict: set the task's {hash, verdict, reason} (what plan_check.py
// reads) and append the round with Jev's reading beside it; every other key stays as it was.
function record(file: string, task: string, reason: string, round: Round) {
  const rec = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  rec.tasks ??= {};
  rec.tasks[task] = {...(rec.tasks[task] ?? {}), hash: round.hash, verdict: round.agent, reason};
  rec.tasks[task].gate_rounds ??= [];
  rec.tasks[task].gate_rounds.push(round);
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
}

const disagrees = (r: Round) => r.agent != null && r.jev != null && r.agent !== r.jev;

// Mark who the run proved right on one disagreeing round (1-based over the task's gate_rounds).
// Anything else — unknown task, out-of-range round, a round that agrees — writes nothing.
function label(file: string, task: string, n: number, right: 'agent' | 'jev', because: string): boolean {
  if (!existsSync(file)) return false;
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  const rs = rec?.tasks?.[task]?.gate_rounds;
  if (!Array.isArray(rs) || !Number.isInteger(n) || n < 1 || n > rs.length) return false;
  const r = rs[n - 1];
  if (!r || !disagrees(r)) return false;
  r.right = right;
  r.because = because;
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  return true;
}

function agreement(dir: string): string[] {
  let plans = 0, rounds = 0, agree = 0, jevOnly = 0, agentOnly = 0;
  let disagreements = 0, agentRight = 0, jevRight = 0, unlabelled = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.gate-verdicts.json')).sort()) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const rs: Round[] = Object.values(rec.tasks ?? {}).flatMap((t: any) => (Array.isArray(t?.gate_rounds) ? t.gate_rounds : []))
      .filter((r: Round) => r && r.jev != null);
    if (rs.length) plans += 1;
    for (const r of rs) {
      rounds += 1;
      if (r.agent === r.jev) agree += 1;
      else if (r.jev === 'fail' && r.agent === 'pass') jevOnly += 1;
      else if (r.agent === 'fail' && r.jev === 'pass') agentOnly += 1;
      if (!disagrees(r)) continue;
      disagreements += 1;
      if (r.right === 'agent') agentRight += 1;
      else if (r.right === 'jev') jevRight += 1;
      else unlabelled += 1;
    }
  }
  return [`gate-jev: n=${plans} plans, ${rounds} rounds, agree ${agree}, jev-only fail ${jevOnly}, agent-only fail ${agentOnly}`,
    `gate-jev outcomes: disagreements ${disagreements}, agent right ${agentRight}, jev right ${jevRight}, unlabelled ${unlabelled}`];
}

async function main(): Promise<number> {
  const usage = 'usage: gate_jev.ts <diet.json> [--record <gate-verdicts.json> --agent pass|fail --reason <sentence>] | gate_jev.ts --agreement <dir>'
    + ' | gate_jev.ts --label <gate-verdicts.json> --task <id> --round <n> --right agent|jev --because "<one line>"';
  const {values, positionals} = parseArgs({allowPositionals: true,
    options: {record: {type: 'string'}, agent: {type: 'string'}, reason: {type: 'string'}, agreement: {type: 'string'},
      label: {type: 'string'}, task: {type: 'string'}, round: {type: 'string'}, right: {type: 'string'}, because: {type: 'string'}}});
  if (values.label !== undefined) {
    const {task, round, right, because} = values;
    if (positionals.length || !task || !round || !/^\d+$/.test(round) || (right !== 'agent' && right !== 'jev')
      || !because?.trim() || /[\r\n]/.test(because)) { console.error(usage); return 2; }
    if (!label(values.label, task, Number(round), right, because)) {
      console.error(`gate-jev: task ${task} round ${round} in ${values.label} is not a disagreement to label`);
      return 2;
    }
    return 0;
  }
  if (values.agreement !== undefined) {
    if (positionals.length) { console.error(usage); return 2; }
    for (const line of agreement(values.agreement)) console.log(line);
    return 0;
  }
  const given = [values.record, values.agent, values.reason].filter((v) => v !== undefined).length;
  if (positionals.length !== 1 || (given !== 0 && given !== 3) || (values.reason !== undefined && !values.reason.trim())
    || (values.agent !== undefined && !['pass', 'fail'].includes(values.agent))) {
    console.error(usage);
    return 2;
  }
  const diet: Diet = JSON.parse(readFileSync(positionals[0], 'utf8'));
  const out = await read(diet);
  console.log(JSON.stringify(out));
  if (values.record !== undefined) record(values.record, String(diet.task), values.reason!, {hash: diet.hash, agent: values.agent!,
    jev: out.verdict, clauses: out.clauses, contradiction: out.contradiction, pinned: out.pinned});
  return 0;
}

if (import.meta.main) process.exit(await main());
