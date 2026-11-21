import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const INTERPRETERS = ['python3', 'git', 'bash', 'sh']

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
  return { ...out, ...env }
}
