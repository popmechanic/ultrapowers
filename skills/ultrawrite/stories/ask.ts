// One Jev question from factory/questions.json, asked over stdin's state: `ask.ts <set> <question>`.
// Prints {"noul": <number|null>}; a failed call still prints null and exits 0. Bad input exits 2.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {defaultAsk, noul} from './jev';

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length !== 2) fail('usage: ask.ts <set> <question>  (state JSON on stdin)');
const [set, question] = args;

const file = join(import.meta.dir, '..', '..', '..', 'factory', 'questions.json');
let sets: Record<string, {questions?: Record<string, unknown>}>;
try {
  sets = JSON.parse(readFileSync(file, 'utf8')).sets ?? {};
} catch (e) {
  fail(`ask: cannot read ${file}: ${(e as Error).message}`);
}
const s = Object.hasOwn(sets, set) ? sets[set] : undefined;
if (!s) fail(`ask: no set ${set} in ${file}`);
const q = s.questions && Object.hasOwn(s.questions, question) ? s.questions[question] : undefined;
if (!q) fail(`ask: no question ${question} in set ${set}`);

let state: unknown;
try {
  state = JSON.parse(await Bun.stdin.text());
} catch (e) {
  fail(`ask: stdin is not JSON: ${(e as Error).message}`);
}

let answers: Record<string, unknown> | null = null;
try {
  answers = await defaultAsk(state, {[question]: q});
} catch (e) {
  console.error(`ask: ${(e as Error).message}`);
}
console.log(JSON.stringify({noul: noul(answers, question)}));
