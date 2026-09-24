// factory/commands.mjs — `bootstrapFor` answers what a fresh clone of the
// target needs installed before ANY of a task's own commands run there, so
// a missing `node_modules` or a missing `bun install` never reads as the
// task's own probes or tests failing.

/**
 * What a fresh clone of the target needs installed before anything else
 * runs there.
 *
 * `planCmd` — the plan's own `bootstrapCmd`, when the parser printed one —
 * wins outright whenever it is a non-empty string. Otherwise the clone's
 * own tracked `files` decide: `bun.lock` or `bun.lockb` among them selects
 * `bun install --frozen-lockfile`; `package-lock.json` selects `npm ci`;
 * neither present answers `null` — there is nothing to install.
 */
export function bootstrapFor ({ planCmd, files }) {
  if (typeof planCmd === 'string' && planCmd !== '') return planCmd
  const list = files || []
  if (list.includes('bun.lock') || list.includes('bun.lockb')) return 'bun install --frozen-lockfile'
  if (list.includes('package-lock.json')) return 'npm ci'
  return null
}

export default { bootstrapFor }
