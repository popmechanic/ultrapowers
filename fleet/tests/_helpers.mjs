/**
 * fleet/tests/_helpers.mjs — the rig's environment.
 *
 * Underscore-prefixed so test_fleet_suite.py's `test_*.mjs` glob does not run
 * it as a test of its own.
 *
 * One export, `simEnv`, and one rule behind it: a sim sees what it was handed,
 * never the box it runs on. Every process a sim starts gets an environment
 * built here — the parent's own `ULTRA_`, `TINYAPP_`, `FLEET_`, `ANTHROPIC_`,
 * `CLAUDE_` and `GH_` keys are dropped, `HOME`/`TMPDIR`/`FLEET_HOME` point at a
 * directory the sim owns, and `PATH` carries the interpreters and nothing else.
 * `fleet/tests/test_sims_are_hermetic.mjs` is the probe that keeps it true.
 *
 * Node's own rule (`node:child_process`): with an `env` option the child gets
 * exactly that object and nothing of `process.env`, and the command — plus, in
 * a `bash -c` child, its sub-commands — is looked up on `env.PATH`. That is why
 * the interpreters ride the `PATH` this builds.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Prefixes of the parent's environment that never reach a child. */
export const DROPPED_PREFIXES = ['ULTRA_', 'TINYAPP_', 'FLEET_', 'ANTHROPIC_', 'CLAUDE_', 'GH_']

/**
 * The one name kept by name from the parent: the deadline multiplier
 * `fleet/tests/deadline-slack.mjs` reads in-process, a rig knob a developer
 * sets on a slow box rather than a fact of the fleet.
 */
export const KEPT_KEYS = ['FLEET_TEST_SLACK']

/** The interpreters a sim's children resolve on the `PATH` this builds. */
const INTERPRETERS = ['python3', 'git', 'bash', 'sh']

/** The first directory of the parent's `PATH` holding an executable `name`. */
const whichDir = (name) => {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return dir
    } catch {
      // Not here; keep walking. A missing interpreter is left out silently —
      // the sim that needs it fails where it spawns it.
    }
  }
  return null
}

// The walk above is the same answer every time for one parent `PATH`, and a sim
// that runs hundreds of git commands asks for it hundreds of times; cache it
// against the `PATH` it was read from, so a caller that changes `PATH` still
// gets a fresh answer.
let cached = { path: null, dirs: [] }
const interpreterDirs = () => {
  const parent = process.env.PATH ?? ''
  if (cached.path !== parent) {
    const dirs = []
    for (const dir of [path.dirname(process.execPath), ...INTERPRETERS.map(whichDir)]) {
      if (dir && !dirs.includes(dir)) dirs.push(dir)
    }
    cached = { path: parent, dirs }
  }
  return cached.dirs
}

/**
 * The environment for one child process.
 *
 *   `bin`   a directory to put first on `PATH` — a case's stubs
 *   `home`  the directory `HOME`, `TMPDIR` and `FLEET_HOME` all name;
 *           defaults to a fresh `mkdtemp` under `os.tmpdir()`
 *   `env`   the caller's own keys, laid over everything else last, so a
 *           caller-supplied key of any name wins
 */
/**
 * The `fleet-sim-*` directories this process minted, removed when it exits
 * (#890): a `simEnv()` with no `home` makes one per call, and a sim that
 * spawns a dozen children a dozen times would otherwise leave a dozen dirs
 * under `os.tmpdir()` for good. Sync on purpose — an `exit` handler gets no
 * event loop — and `force`, so a dir a child already removed is not an error.
 */
const OWNED = []
process.on('exit', () => {
  for (const dir of OWNED) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // Left for the box's own tmp reaper; never a failed sim.
    }
  }
})

export function simEnv ({ bin, home, env } = {}) {
  const root = home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sim-'))
  if (home == null) OWNED.push(root)

  const dirs = []
  for (const dir of [...(Array.isArray(bin) ? bin : bin ? [bin] : []), ...interpreterDirs()]) {
    if (dir && !dirs.includes(dir)) dirs.push(dir)
  }

  const out = {
    PATH: dirs.join(path.delimiter),
    HOME: root,
    TMPDIR: root,
    FLEET_HOME: root,
  }
  for (const key of KEPT_KEYS) {
    if (process.env[key] !== undefined) out[key] = process.env[key]
  }
  return { ...out, ...env }
}
