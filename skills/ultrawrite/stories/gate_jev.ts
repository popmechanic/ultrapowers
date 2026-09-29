#!/usr/bin/env bun
// What Jev would have said at the proof gate. It reads the gate reader's diet (the task's Claim
// with its numbered Machine clauses, and the Proof slot) and asks, in one request, whether each
// clause states a computable fact, whether a probe would catch it false, and whether a leg
// contradicts the clause it cites. The verdict is computed here, from policy.json. Jev judges
// beside the agent reader; it decides nothing.
//
//   bun skills/ultrawrite/stories/gate_jev.ts <diet.json> [--record <gate-verdicts.json> --agent pass|fail]
//   bun skills/ultrawrite/stories/gate_jev.ts --agreement <dir>
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {at, defaultAsk, noul} from './jev';

const Q = JSON.parse(readFileSync(join(import.meta.dir, 'questions.json'), 'utf8')).gate;
const POLICY = JSON.parse(readFileSync(join(import.meta.dir, 'policy.json'), 'utf8')).flag_at;

type Diet = {task: string | number; claim: string; proof: string; hash: string; base?: string};
type Verdict = 'pass' | 'fail' | null;
type Round = {hash: string; agent: string; jev: Verdict};

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
  return {claim, clauses, probes, legs};
}

async function read(d: Diet) {
  const state = gateState(d);
  const questions: Record<string, unknown> = {};
  state.clauses.forEach((c, i) => {
    questions[`fact:${c.id}`] = at(Q.fact, {i});
    questions[`caught:${c.id}`] = at(Q.caught, {i});
  });
  questions.contradiction = Q.contradiction;
  const answers = await defaultAsk(state, questions);
  const clauses = state.clauses.map((c) => ({id: c.id, fact: noul(answers, `fact:${c.id}`), caught: noul(answers, `caught:${c.id}`)}));
  const contradiction = noul(answers, 'contradiction');
  let verdict: Verdict = null;
  if (answers !== null) {
    const uncaught = clauses.some((c) => c.fact !== null && c.caught !== null && c.fact >= POLICY.gate_fact && c.caught < POLICY.gate_caught_below);
    verdict = uncaught || (contradiction !== null && contradiction >= POLICY.gate_contradiction) ? 'fail' : 'pass';
  }
  return {task: d.task, hash: d.hash, verdict, clauses, contradiction};
}

// Append the round beside the agent reader's verdict; every other key stays as it was.
function record(file: string, task: string, round: Round) {
  const rec = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  rec.tasks ??= {};
  rec.tasks[task] ??= {};
  rec.tasks[task].gate_rounds ??= [];
  rec.tasks[task].gate_rounds.push(round);
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
}

function agreement(dir: string): string {
  let plans = 0, rounds = 0, agree = 0, jevOnly = 0, agentOnly = 0;
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
    }
  }
  return `gate-jev: n=${plans} plans, ${rounds} rounds, agree ${agree}, jev-only fail ${jevOnly}, agent-only fail ${agentOnly}`;
}

async function main(): Promise<number> {
  const usage = 'usage: gate_jev.ts <diet.json> [--record <gate-verdicts.json> --agent pass|fail] | gate_jev.ts --agreement <dir>';
  const {values, positionals} = parseArgs({allowPositionals: true,
    options: {record: {type: 'string'}, agent: {type: 'string'}, agreement: {type: 'string'}}});
  if (values.agreement !== undefined) {
    if (positionals.length) { console.error(usage); return 2; }
    console.log(agreement(values.agreement));
    return 0;
  }
  if (positionals.length !== 1 || (values.record !== undefined) !== (values.agent !== undefined)
    || (values.agent !== undefined && !['pass', 'fail'].includes(values.agent))) {
    console.error(usage);
    return 2;
  }
  const diet: Diet = JSON.parse(readFileSync(positionals[0], 'utf8'));
  const out = await read(diet);
  console.log(JSON.stringify(out));
  if (values.record) record(values.record, String(diet.task), {hash: diet.hash, agent: values.agent!, jev: out.verdict});
  return 0;
}

if (import.meta.main) process.exit(await main());
