import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');

const bash = (cmd) => ['bash', '-lc', cmd];

const CHECKER = join(REPO, 'factory', 'stack', 'tinyapp', 'check.ts');
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const checkerArgv = (planPath, clause) =>
  ['bun', CHECKER, '--plan', planPath, '--clause', clause, '--copy', '.'];

const SCREENS = join(REPO, 'factory', 'stack', 'tinyapp', 'screens.ts');
export const screensArgv = (planPath, piece) =>
  ['bun', SCREENS, '--plan', planPath, '--piece', piece, '--copy', '.'];

function storiesWorkload (parsed, planPath) {
  const abs = resolve(planPath);
  const tasks = parsed.tasks.map((t) => {
    if (!t.probes.length) throw new Error(`plan task ${t.id} (${t.piece}) has no probes: a task with nothing to check cannot finish`);
    const files = t.files || [];
    const screens = t.piece && (files.includes(`client/src/pieces/${t.piece}.json`) || files.includes('client/src/screen.json'))
      ? [screensArgv(abs, t.piece)] : [];
    return {
      id: t.id, title: t.title, body: t.body ?? '', files,
      depends_on: t.depends_on || [],
      facts: [...t.probes.map((p) => checkerArgv(abs, p.clause)), ...screens],
      clauses: t.probes.map((p) => p.clause),
    };
  });
  const guards = (parsed.guards || []).map((g) => checkerArgv(abs, g.clause).map(sq).join(' '));
  return {
    grammar: 'stories-v1',
    tasks,
    check: bash(['bun run typecheck', ...guards].join(' && ')),
    checkTimeoutMs: 120000 + 15000 * guards.length,
    setup: bash(parsed.bootstrapCmd),
    stories: { sentences: Object.fromEntries((parsed.stories || []).map((s) => [s.id, s.sentence])) },
  };
}

export function parsedPlan(planPath, planJson) {
  if (planJson) return JSON.parse(readFileSync(planJson, 'utf8'));
  const r = spawnSync('python3', [PARSER, planPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`plan_parse.py exited ${r.status} on ${planPath}: ${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

export function workloadFromPlan(planPath, planJson) {
  const parsed = parsedPlan(planPath, planJson);
  if (parsed.grammar === 'stories-v1') return storiesWorkload(parsed, planPath);
  const edges = parsed.dag_edges || [];

  const tasks = (parsed.tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body ?? '',
    files: t.files || [],
    depends_on: edges.filter((e) => e.to === t.id).map((e) => e.from),
    facts: (t.proofRuns || []).map(bash),
  }));

  const cmds = (parsed.checks || []).map((c) => c.cmd);
  const check = cmds.length ? bash(cmds.join(' && ')) : null;
  const setup = parsed.bootstrapCmd ? bash(parsed.bootstrapCmd) : null;

  return { grammar: 'claims-v1', tasks, check, setup };
}
