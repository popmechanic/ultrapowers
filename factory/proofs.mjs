// factory/proofs.mjs — the commands a plan's own Proof names, actually run.
//
// A plan's Proof may carry `- Run:` bullets under a task — often a pipeline
// (`sed -n '…' file | tr '\n' ' ' | grep -q …`), which is why each one runs
// under `bash -lc` rather than as a split argv — and its `## Global
// Constraints` may carry `- Check:` bullets, run-wide commands that may read
// `$ULTRA_BASE` and may end `(minor)`. `factory/engine.mjs` runs a task's own
// `proofRuns` when measuring each candidate, and the plan's `checks` on
// every folded tree; this module is the one small piece both share: one
// line, run for real, answered as `{ cmd, exit, tail }`.

/** A fake `sh` may answer `{ status }`, `{ code }` or a bare number; read all
 *  three rather than let a sim's shorthand read as exit 0 by accident. Kept
 *  local rather than imported from `factory/engine.mjs`: that module is the
 *  caller, never the other way around. */
const exitOf = (r) => {
  if (typeof r === 'number') return r
  if (!r || typeof r !== 'object') return 0
  for (const key of ['status', 'code', 'exitCode']) {
    if (typeof r[key] === 'number') return r[key]
  }
  return 0
}
const outOf = (r) => String((r && typeof r === 'object' && (r.stdout ?? r.out)) || '')

/**
 * M1: every entry of `lines`, in order, run as
 * `sh('timeout', [String(timeoutSeconds), 'bash', '-lc', line], cwd, undefined, env)`.
 * Every line runs, even after an earlier one failed — a proof is read in
 * full, not stopped at its first red line. Answers one `{ cmd, exit, tail }`
 * per line, in the same order, `tail` the last 1,500 characters of that
 * line's own output.
 */
export async function runLines ({ lines, cwd, sh, env, timeoutSeconds }) {
  const out = []
  for (const line of (lines || [])) {
    const r = await sh('timeout', [String(timeoutSeconds), 'bash', '-lc', line], cwd, undefined, env)
    out.push({ cmd: line, exit: exitOf(r), tail: outOf(r).slice(-1500) })
  }
  return out
}

export default { runLines }
