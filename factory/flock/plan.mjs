// The plan reader: turns a signed plan into the Flock's workload, reading it
// through the same parser the sandbox uses (skills/ultrapowers/scripts/plan_parse.py).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');

const bash = (cmd) => ['bash', '-lc', cmd];

// A stories-v1 plan's facts are checker calls, one per probe.
const CHECKER = join(REPO, 'factory', 'stack', 'tinyapp', 'check.ts');
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const checkerArgv = (planPath, clause) =>
  ['bun', CHECKER, '--plan', planPath, '--clause', clause, '--copy', '.'];

function storiesWorkload (parsed, planPath) {
  const abs = resolve(planPath);
  const tasks = parsed.tasks.map((t) => {
    if (!t.probes.length) throw new Error(`plan task ${t.id} (${t.piece}) has no probes: a task with nothing to check cannot finish`);
    return {
      id: t.id, title: t.title, body: t.body ?? '', files: t.files || [],
      depends_on: t.depends_on || [],
      facts: t.probes.map((p) => checkerArgv(abs, p.clause)),
      clauses: t.probes.map((p) => p.clause),
    };
  });
  const guards = (parsed.guards || []).map((g) => checkerArgv(abs, g.clause).map(sq).join(' '));
  return {
    tasks,
    check: bash(['bun run typecheck', ...guards].join(' && ')),
    // Every earlier story is a guard, one checker call each (~4.9 s apiece on radio-station run-5,
    // n=1 run, 2026-09-29), so the check's limit grows with them: 120 s plus 15 s per guard.
    checkTimeoutMs: 120000 + 15000 * guards.length,
    setup: bash(parsed.bootstrapCmd),
    stories: { planPath: abs, sentences: Object.fromEntries((parsed.stories || []).map((s) => [s.id, s.sentence])) },
  };
}

export function workloadFromPlan(planPath) {
  const r = spawnSync('python3', [PARSER, planPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`plan_parse.py exited ${r.status} on ${planPath}: ${r.stderr}`);
  }
  const parsed = JSON.parse(r.stdout);
  if (parsed.grammar === 'stories-v1') return storiesWorkload(parsed, planPath);
  const edges = parsed.dag_edges || [];

  const tasks = (parsed.tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body ?? '',
    files: t.files || [],
    depends_on: edges.filter((e) => e.to === t.id).map((e) => e.from),
    facts: (t.proofRuns || []).map(bash),
    // the clause ids each fact is tagged with (`Run: ... [M1]`), one list per fact
    factClauses: t.proofRunClauses || [],
  }));

  const cmds = (parsed.checks || []).filter((c) => !c.minor).map((c) => c.cmd);
  const check = cmds.length ? bash(cmds.join(' && ')) : null;
  const setup = parsed.bootstrapCmd ? bash(parsed.bootstrapCmd) : null;

  return { tasks, check, setup };
}
