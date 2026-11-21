import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { Refusal, git, output } from './lobby.mjs'

const PIN_LINE = /^-\s*(?:Check|Run):\s*(.*)$/

const WHOLLY_BACKTICKED = /^`([^`]+)`$/

const PATH_PIN = /test\s+"\$\(\s*git\s+hash-object\s+([^\s)"|]+)\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g
const SLICE_PIN = /test\s+"\$\(\s*((?:(?!\)")[^\n])+?)\s*\|\s*git\s+hash-object\s+--stdin\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g

const clipCommand = (command) => String(command).replace(/\s+/g, ' ').trim().slice(0, 80)

const pinRefusalLine = (subject, pinned, base, real) =>
  `launch: plan pin ${subject}: pinned ${pinned} but --base ${base} has ${real ?? 'no such path'}`

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
