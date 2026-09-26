// The plan reader: turns a signed plan into the Flock's workload, reading it
// through the same parser the sandbox uses (skills/ultrapowers/scripts/plan_parse.py).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARSER = join(REPO, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py');

const bash = (cmd) => ['bash', '-lc', cmd];

// Each task's own section of the plan text, keyed by task id:
// 'Task ' + everything after its '### Task ' marker up to the next, trimmed.
function sectionsById(text) {
  const out = new Map();
  for (const part of text.split(/^### Task /m).slice(1)) {
    const m = /^([^:\s]+)\s*:/.exec(part);
    if (m && !out.has(m[1])) out.set(m[1], ('Task ' + part).trim());
  }
  return out;
}

export function workloadFromPlan(planPath) {
  const r = spawnSync('python3', [PARSER, planPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`plan_parse.py exited ${r.status} on ${planPath}: ${r.stderr}`);
  }
  const parsed = JSON.parse(r.stdout);
  const bodies = sectionsById(readFileSync(planPath, 'utf8'));
  const edges = parsed.dag_edges || [];

  const tasks = (parsed.tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    body: bodies.get(String(t.id)) ?? '',
    files: t.files || [],
    depends_on: edges.filter((e) => e.to === t.id).map((e) => e.from),
    facts: (t.proofRuns || []).map(bash),
  }));

  const cmds = (parsed.checks || []).filter((c) => !c.minor).map((c) => c.cmd);
  const check = cmds.length ? bash(cmds.join(' && ')) : null;
  const setup = parsed.bootstrapCmd ? bash(parsed.bootstrapCmd) : null;

  return { tasks, check, setup };
}
