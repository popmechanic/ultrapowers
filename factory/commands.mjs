// factory/commands.mjs — one place that runs a task's own shell commands,
// and answers what a fresh clone of the target needs installed before any
// of them may run there.
//
// `runAll` is the one path every command this run runs — measuring a
// candidate's `proofRuns`, the fold check's re-run of a touched probe or
// test, and the `run_proof` tool a worker calls — walks from here on: every
// command in `cmds`, in order, through `timeout`, stopping at the first
// non-zero exit. A plan whose `Run:` line is `node a.mjs && python3 -m
// pytest -q t.py` needs its full string split on whitespace with no shell
// dropped, so a caller that once handed `&&` and everything after it to
// `node` as plain arguments — which ignored them, so the pytest half never
// ran — reads correctly from here on.
//
// `bootstrapFor` answers what a fresh clone of the target needs installed
// before ANY of that runs there, so a missing `node_modules` or a missing
// `bun install` never reads as the task's own probes or tests failing.

/** A fake `sh` may answer `{ status }`, `{ code }` or a bare number; read
 *  all three the same way `factory/engine.mjs`'s own `exitOf` does, rather
 *  than let a sim's shorthand read as exit 0 by accident. */
function exitOf (r) {
  if (typeof r === 'number') return r
  if (!r || typeof r !== 'object') return 0
  for (const key of ['status', 'code', 'exitCode']) {
    if (typeof r[key] === 'number') return r[key]
  }
  return 0
}

/** The output a fake `sh` answered, whichever of `stdout`/`out` it used. */
function outOf (r) {
  return String((r && typeof r === 'object' && (r.stdout ?? r.out)) || '')
}

/**
 * Runs every string of `cmds`, in order, as
 * `sh('timeout', [String(timeoutSeconds), ...cmd.split(/\s+/)], cwd)`,
 * stopping at the first non-zero exit.
 *
 * Answers `{ exit, out, ran }`:
 *   - `exit` — the first non-zero exit any command actually run answered,
 *     or 0 when every one of them ran clean.
 *   - `out` — the concatenated output of every command actually run, in
 *     order.
 *   - `ran` — one `{ cmd, exit }` per command actually run, in order.
 *
 * With `cmds` empty, answers `{ exit: 0, out: '', ran: [] }` and calls `sh`
 * nothing at all.
 */
export function runAll ({ cmds, cwd, sh, timeoutSeconds }) {
  const ran = []
  let out = ''
  for (const cmd of (cmds || [])) {
    const parts = String(cmd).trim().split(/\s+/)
    const r = sh('timeout', [String(timeoutSeconds), ...parts], cwd)
    const exit = exitOf(r)
    ran.push({ cmd, exit })
    out += outOf(r)
    if (exit !== 0) return { exit, out, ran }
  }
  return { exit: 0, out, ran }
}

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

export default { runAll, bootstrapFor }
