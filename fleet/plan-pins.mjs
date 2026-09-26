/**
 * fleet/plan-pins.mjs — the plan-pin check a launch runs before it pushes.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { Refusal, git, output } from './lobby.mjs'

/**
 * A hash pin is a fact about BASE, and BASE is chosen at launch and not at
 * authoring — so every `git hash-object` literal a plan carries is checked
 * against the tree at `--base` before the plan is pushed, with nothing but
 * local git reads made. A stale pin found here costs seconds on the laptop; the
 * same pin found on the sandbox costs a run.
 *
 * A pin lives on a `- Check:` bullet of `## Global Constraints` or a `- Run:`
 * bullet of a task's Proof — the launcher reads a line by its stripped form and
 * not by where in the plan it sits, so a pin on any other kind of line (a
 * `**Context:**` sentence quoting one, say) is prose and is not read. Two
 * shapes are pins:
 *
 *   test "$(git hash-object <path>)" = <40-hex>
 *   test "$(<command> | git hash-object --stdin)" = <40-hex>
 *
 * A `Run:` may chain several with `&&`, so one line can carry several.
 */

/** A pin-bearing bullet, by its stripped form. */
const PIN_LINE = /^-\s*(?:Check|Run):\s*(.*)$/

/**
 * `plan_parse.py`'s whole-value backtick rule, copied rather than imported: a
 * whole-value backtick wrapper is decoration and comes off before the value is
 * matched. A value with backticks INSIDE it does not match and rides
 * untouched, exactly as it does there.
 */
const WHOLLY_BACKTICKED = /^`([^`]+)`$/

/**
 * The two shapes, each ending in a sha that is 40 hex characters and no more:
 * the lookahead is why a 41-hex literal is not a pin, and the exact `{40}` is
 * why a 39-hex one is not either. A pin the launcher cannot read is not a pin
 * it guesses at.
 */
const PATH_PIN = /test\s+"\$\(\s*git\s+hash-object\s+([^\s)"|]+)\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g
/**
 * The slice command may not span a `)"`: that boundary closes the substitution
 * of an earlier pin on the same `&&`-chained line, and a capture crossing it
 * would swallow that pin whole — a path pin chained before a slice pin would be
 * read as one slice pin whose command is the two halves joined, handed to
 * `/bin/sh` as one command, hashed as the empty blob, and a plan whose pins all
 * match would be refused. Only that two-character boundary is forbidden, so a
 * command that quotes (`grep "^set -e" f`) or pipes several times still matches.
 */
const SLICE_PIN = /test\s+"\$\(\s*((?:(?!\)")[^\n])+?)\s*\|\s*git\s+hash-object\s+--stdin\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g

/** How a slice pin names itself in a refusal: one line, at most 80 characters. */
const clipCommand = (command) => String(command).replace(/\s+/g, ' ').trim().slice(0, 80)

/** One stale pin, one line — the path (or clipped command), the pinned sha and
 *  what the base really carries, so the operator can see the fix without
 *  running anything. */
const pinRefusalLine = (subject, pinned, base, real) =>
  `launch: plan pin ${subject}: pinned ${pinned} but --base ${base} has ${real ?? 'no such path'}`

/** Every pin the plan text carries, in the order the plan writes them. */
function planPins (planText) {
  const pins = []
  for (const rawLine of String(planText ?? '').split('\n')) {
    const bullet = PIN_LINE.exec(rawLine.trim())
    if (!bullet) continue
    const value = bullet[1].trim()
    const unwrapped = WHOLLY_BACKTICKED.exec(value)
    const text = unwrapped ? unwrapped[1].trim() : value
    const found = []
    for (const m of text.matchAll(PATH_PIN)) {
      found.push({ at: m.index, kind: 'path', path: m[1], pinned: m[2] })
    }
    for (const m of text.matchAll(SLICE_PIN)) {
      found.push({ at: m.index, kind: 'slice', command: m[1], pinned: m[2] })
    }
    found.sort((a, b) => a.at - b.at)
    pins.push(...found)
  }
  return pins
}

/**
 * The tree at `<base>`, in a throwaway directory, built with git plumbing
 * against a temporary index: `read-tree` fills that index and `checkout-index
 * --prefix` writes the files out. The operator's own index, `HEAD` and working
 * tree are never read and never written — a launch that verifies a slice pin
 * leaves the checkout exactly as a launch that verifies none.
 *
 * Answers `{ dir, tree }`: `dir` is what the caller removes, `tree` is the
 * working directory a slice command runs in.
 */
async function basePinCheckout ({ exec, repoDir, base }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-pin-'))
  const tree = path.join(dir, 'tree')
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    await fsp.mkdir(tree, { recursive: true })
    for (const argv of [['read-tree', base], ['checkout-index', '-a', '-f', `--prefix=${tree}${path.sep}`]]) {
      const res = await exec('git', ['-C', repoDir, ...argv], { env })
      if (res.code !== 0) {
        throw new Refusal(`launch: git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
      }
    }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw error
  }
  return { dir, tree }
}

/**
 * What a slice pin's command really hashes to at `--base`: the command under
 * `/bin/sh -c` with the extracted tree as its working directory, its stdout
 * hashed with `git hash-object --stdin`. The shell runs outside the exec seam
 * because it is not a lobby verb and not a git read — it is the plan's own
 * command, and it must really run for its sha to mean anything.
 */
async function slicePinSha ({ exec, repoDir, tree, command }) {
  const ran = spawnSync('/bin/sh', ['-c', command], { cwd: tree, maxBuffer: 32 * 1024 * 1024 })
  const res = await exec('git', ['-C', repoDir, 'hash-object', '--stdin'], {
    input: ran.stdout ?? Buffer.alloc(0)
  })
  if (res.code !== 0) {
    throw new Refusal(
      `launch: git hash-object --stdin failed (exit ${res.code}) for plan pin ${clipCommand(command)}:\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').trim()
}

/**
 * Every pin the plan carries, verified against `<base>`, or a `Refusal` (exit
 * 2) carrying one line per stale pin — so two stale pins are two lines and an
 * operator fixes both in one pass. A path absent at `--base` is stale, not
 * skipped: a pin naming a file the base does not have is a pin about some other
 * tree.
 *
 * The base's blob for a path is `git rev-parse <base>:<path>`, which is what
 * `git hash-object <path>` answers in a checkout of `<base>` — no clean filter
 * is configured in this repository. A slice pin needs the files themselves, so
 * it gets a throwaway checkout that is removed in a `finally`, whether this
 * answers or throws.
 */
export async function verifyPlanPins ({ exec, repoDir, base, planText }) {
  const pins = planPins(planText)
  if (pins.length === 0) return
  const checkout = pins.some((pin) => pin.kind === 'slice')
    ? await basePinCheckout({ exec, repoDir, base })
    : null
  const stale = []
  try {
    for (const pin of pins) {
      if (pin.kind === 'path') {
        const res = await git(exec, repoDir, ['rev-parse', `${base}:${pin.path}`])
        const real = res.code === 0 ? String(res.stdout ?? '').trim() : null
        if (real !== pin.pinned) stale.push(pinRefusalLine(pin.path, pin.pinned, base, real))
        continue
      }
      const real = await slicePinSha({ exec, repoDir, tree: checkout.tree, command: pin.command })
      if (real !== pin.pinned) {
        stale.push(pinRefusalLine(clipCommand(pin.command), pin.pinned, base, real))
      }
    }
  } finally {
    if (checkout !== null) await fsp.rm(checkout.dir, { recursive: true, force: true })
  }
  if (stale.length > 0) throw new Refusal(stale.join('\n'))
}
