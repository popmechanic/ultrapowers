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
  // True on engines that still expose the meta binding to the script body;
  // false where meta is extracted at parse time. Informational either way.
  metaExposed: typeof meta !== 'undefined',
}
