// factory/clone.mjs — clones at BASE, moved here from the old engine's shared
// substrate module when the factory replaced it. This function was the only
// piece of that module the factory ever used; everything else there
// (makeCwdFor, withPatchCapture, patchAgainstBase, makeEventLog, and the rest)
// belonged to the old engine and left the tree with it.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// ── clones at BASE — the #314 cure (#401 work item 2) ────────────────────────
//
// `isolation: 'worktree'` appears at exactly two of the ten call sites
// (waves.js:1107 implementer, :1265 fix). The Workflow runtime honoured it by
// cutting a worktree FROM THE SESSION CHECKOUT, and waves.js:1116 names that as
// #314's cause in its own words:
//
//     "engine worktrees are cut by the runtime (isolation: 'worktree'), not by
//      this script, so the assert that HEAD equals BASE before any work can
//      only run inside the worktree"
//
// The driver cuts them itself, at BASE, before the wave starts. That is not a
// FIX for #314 — it makes the defect INEXPRESSIBLE, because there is no longer
// a step at which a worktree could be cut from anywhere else. #354 closes as
// moot for the same reason.
//
// The engine's drift guard (:1116-1140, comparing the implementer's reported
// startHead against the dispatched BASE) STAYS. It is now a check on a thing
// that cannot happen, which is exactly what a guard on an inexpressible defect
// should look like — and it is the signal the #314 eval record counts, so
// deleting it would delete the evidence that the cure worked. It goes when the
// guard-deletion rule (§8) has a measured number to license it, not before.
//
// A clone rather than a worktree — and, since Amendment 9 (2026-08-29), that
// choice is FREE and settled, not a design question. This paragraph used to
// argue clones on isolation grounds (N worktrees are N writers to one .git)
// and never asked what the isolation cost: a clone's refs are invisible to the
// integration tree, and the fold kernel then read `--branch <id>=<ref>:<sha>`
// from there, so a contended wave — the CRDT path the program exists for —
// failed outright. Isolation and CRDT merging are substitutes; every unit of
// isolation bought is width given up. The cure was not to pick the other
// substrate but to stop the kernel needing refs at all: a task leaves its
// clone as a PATCH against BASE (`patchAgainstBase`), so no clone has to see
// another's objects and isolation's only remaining job is the one it should
// have had — a stable read-view during a task. Clone stays because it is
// already written and tested; a worktree would do the same job.
export const DEFAULT_IDENTITY = {
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
