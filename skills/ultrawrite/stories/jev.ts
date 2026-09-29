// The laptop's Jev: the fleet's client (one POST, a status check and a state budget) with the
// operator's own key riding as a bearer header. Shared by jev_checks.ts and gate_jev.ts.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

// @ts-ignore: a plain .mjs, which bun imports directly
import {makeJevClient} from '../../../factory/jev-client.mjs';

export type Ask = (state: unknown, questions: unknown) => Promise<Record<string, unknown> | null>;

const BASE_URL = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai';

export function key(): string {
  const home = process.env.ULTRAPOWERS_HOME ?? join(homedir(), '.ultrapowers');
  const line = readFileSync(join(home, 'typesafe.env'), 'utf8').split('\n').find((l) => l.startsWith('TYPESAFE_API_KEY='));
  if (!line) throw new Error('no TYPESAFE_API_KEY');
  return line.slice('TYPESAFE_API_KEY='.length).trim();
}

export const defaultAsk: Ask = async (state, questions) => {
  let headers: Record<string, string>;
  try {
    headers = {Authorization: 'Bearer ' + key()};
  } catch (e) {
    console.error(`jev: ${(e as Error).message}`);
    return null;
  }
  const client = makeJevClient({baseUrl: BASE_URL, timeoutMs: 30_000, headers, log: (l: string) => console.error(l)});
  return client.ask({state, questions});
};

// A question written against `sentences[i]` or `pieces[j]`, pointed at the entries it asks about.
export const at = <T>(q: T, idx: Record<string, number>): T =>
  JSON.parse(JSON.stringify(q).replace(/\[([ij])\]/g, (m, v) => (v in idx ? `[${idx[v]}]` : m)));

// A question's answer, whether Jev replied a bare number or {noul}.
export function noul(answers: Record<string, unknown> | null, k: string): number | null {
  const a = answers?.[k];
  const v = typeof a === 'number' ? a : (a as {noul?: unknown} | undefined)?.noul;
  return typeof v === 'number' ? v : null;
}
