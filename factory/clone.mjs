// factory/clone.mjs — clones at BASE, moved here from the old engine's shared
// substrate module when the factory replaced it. This function was the only
// piece of that module the factory ever used; everything else there
// (makeCwdFor, withPatchCapture, patchAgainstBase, makeEventLog, and the rest)
// belonged to the old engine and left the tree with it.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// ── clones at BASE — the #314 cure: the engine cuts every clone itself, at
// BASE, so a tree cut from anywhere else is inexpressible. ─────────────────
const DEFAULT_IDENTITY = {
  'user.name': 'fleet',
  'user.email': 'fleet@localhost',
  'commit.gpgsign': 'false',
}

export function cloneAtBase({ repo, dest, base, git = defaultGit, identity = DEFAULT_IDENTITY }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // --shared would put the clone back into the parent's object store; --local
  // hardlinks objects (cheap) while keeping refs and HEAD independent.
  git(['clone', '--quiet', '--no-checkout', '--local', repo, dest])
  // `git clone` does not copy LOCAL config, so a clone inherits only whatever
  // is global. The sandbox golden does set a global identity (RUNBOOK step 38)
  // — but a worker that cannot commit reports BLOCKED for a reason no reviewer
  // can act on, and that would then depend on a setup step having been run.
  // shim-main.mjs:642 already stamps identity per command rather than trusting
  // the ambient config; same posture here, once, in the clone.
  //
  // commit.gpgsign=false is not tidiness: a signing prompt in a headless worker
  // blocks forever, and the worker's deadline is the only thing that would
  // notice.
  for (const [k, v] of Object.entries(identity)) git(['config', k, v], dest)
  // Detached at BASE. Never a branch, never a fetch, never the default HEAD:
  // the whole point is that the tree is BASE and nothing else.
  git(['checkout', '--quiet', '--detach', base], dest)
  const head = git(['rev-parse', 'HEAD'], dest).trim()
  if (head !== base) {
    // Fail loudly rather than let a worker start on the wrong tree. This is the
    // condition #314 was.
    throw new Error('cloneAtBase: ' + dest + ' is at ' + head + ', not BASE ' + base)
  }
  return dest
}

function defaultGit(argv, cwd) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
