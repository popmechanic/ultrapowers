// factory/checks-at-base.mjs — the plan's own `checks`, read once at base,
// before the first dispatch.
//
// A run-wide `Check:` already failing on the commit a run starts from cannot
// be fixed by any task; the run does its work and parks at its own gate
// regardless. This module makes that fact a row on the record, read once,
// before anything is dispatched — never a refusal, never a retry, never a
// gate of its own.
//
// Pure: it touches neither disk, git nor the network itself — everything it
// does goes through the `clone`, `runLines` and `appendEvent` it is handed.

/**
 * M1/M2/M3: when `enabled` is not `true`, or `checks` is empty, does
 * nothing — `clone`, `runLines` and `appendEvent` are none of them called.
 * Otherwise cuts one clone with `clone()`, runs every check's `cmd` in it
 * with `runLines` (`env.ULTRA_BASE` the run's `base`), and appends one
 * `{ kind: 'check:line', base: true, cmd, exit, minor }` row per result —
 * no `task` key; `base: true` is what tells it from a fold's own row.
 *
 * Never throws and never rejects: a `clone` that throws or a `runLines`
 * that rejects is swallowed, and the call answers whatever rows it managed
 * to append (none, in that case) rather than reject.
 */
export async function checksAtBase ({ checks, enabled, clone, base, sh, timeoutSeconds, runLines, appendEvent }) {
  const list = Array.isArray(checks) ? checks : []
  if (enabled !== true || !list.length) return []
  const appended = []
  try {
    const dir = await clone()
    const results = await runLines({
      lines: list.map((c) => c.cmd), cwd: dir, sh,
      env: { ULTRA_BASE: base }, timeoutSeconds,
    })
    results.forEach((r, i) => {
      const minor = Boolean(list[i] && list[i].minor)
      const row = { kind: 'check:line', base: true, cmd: r.cmd, exit: r.exit, minor }
      appendEvent(row)
      appended.push(row)
    })
  } catch {
    // A red bootstrap (`cloneAt` throws a `bootstrapRed`-carrying error and
    // appends its own `bootstrap:red` row) or a rejected `runLines` is
    // swallowed here — this reading is a fact for the record, never a gate.
  }
  return appended
}

export default { checksAtBase }
