import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');

const bash = (cmd) => ['bash', '-lc', cmd];

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
