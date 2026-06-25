// Engine preflight for ultrapowers. Launched as the saved workflow
// 'ultrapowers-probe' with args { ping: 'pong' } BEFORE the real run.
// Spawns no agents. If args fail to populate or the engine dialect changed,
// this throws — and SKILL.md routes to the sequential fallback instead of
// risking a mid-run crash in the real workflow.

export const meta = {
  name: 'ultrapowers-probe',
  description: 'Ultrapowers engine preflight: echoes args, spawns no agents.',
  phases: [],
}

let A = (typeof args !== 'undefined') ? args : undefined
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { /* fall through to the check below */ }
}
if (!A || A.ping !== 'pong') {
  throw new Error('ultrapowers-probe: args did not populate (got ' +
    JSON.stringify(A) + ') — engine args delivery changed; use the fallback.')
}

return {
  ok: true,
  echo: A.ping,
  // Echo back a representative slice of the waves payload so a by-name launch
  // verifies real arg delivery (not just the tiny ping field) — [fb8635c59d4fea1c].
  echoWaves: (A && Array.isArray(A.waves)) ? A.waves.length : 0,
  echoFirstId: (A && A.waves && A.waves[0] && A.waves[0].id) || null,
  // True on engines that still expose the meta binding to the script body;
  // false where meta is extracted at parse time. Informational either way.
  metaExposed: typeof meta !== 'undefined',
}
