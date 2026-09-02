#!/usr/bin/env node
// fleet/race.mjs — #511: attempt racing. One command, two verbs.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]
//   node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]
//
// Only `--k` and `--race-dir` belong to the race. Everything else on a launch
// line belongs to drive-one and is parsed by its own `parseArgs` — which owns
// the unknown-flag refusal and the #211 runId grammar. The raceId rides in as
// that runId positional, so a race is named by the same rules a run is.
//
// The two verb modules are resolved AT RUN TIME (`resolveVerb`), never by a
// static import: an unknown or missing verb must be able to print the usage
// line without loading either one.
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, parseArgs } from './drive-one.mjs'

export const usage = () =>
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]\n' +
  '       node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]'

// The verb name -> module literal, shared with the wave-2 modules that
// implement them. Frozen: the CLI never learns a verb at run time.
export const VERB_MODULES = Object.freeze({
  launch: './race-launch.mjs',
  judge: './race-judge.mjs',
})

const VERB_EXPORTS = Object.freeze({ launch: 'launchRace', judge: 'judgeRace' })

// k is a small integer because each attempt gets a letter suffix (a..z) — 26
// is the alphabet, not a resource budget.
const K_DEFAULT = 3
const K_MAX = 26

const needsValue = (flag) => new Error(`race: ${flag} needs a value\n${usage()}`)

const parseK = (value) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > K_MAX) {
    throw new Error(`race: --k must be an integer 1..${K_MAX} (got ${JSON.stringify(value)})\n${usage()}`)
  }
  return n
}

export const parseLaunchArgs = (argv) => {
  const rest = []
  let k = K_DEFAULT
  let raceDir = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--k' || arg === '--race-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw needsValue(arg)
      if (arg === '--k') k = parseK(value)
      else raceDir = value
      i += 1
      continue
    }
    rest.push(arg)
  }
  // drive-one owns the rest: unknown flags, numeric coercion, the runId grammar.
  const parsed = parseArgs(rest)
  const raceId = parsed.runId
  return {
    ...parsed,
    raceId,
    k,
    raceDir: raceDir ?? path.join(os.tmpdir(), `fleet-race-${raceId}`),
  }
}

export const parseJudgeArgs = (argv) => {
  const positional = []
  let evidenceDir = DEFAULTS.evidenceDir
  let force = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--evidence-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw needsValue(arg)
      evidenceDir = value
      i += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error(`race judge: unknown flag ${arg}\n${usage()}`)
    positional.push(arg)
  }
  const [raceId, ...extra] = positional
  if (!raceId || extra.length) {
    throw new Error(`race judge: expected exactly <raceId>\n${usage()}`)
  }
  return { raceId, evidenceDir, force }
}

// The default importer is a dynamic `import`, so the module is loaded only
// once a real verb has been named.
export const resolveVerb = async (name, importer = (spec) => import(spec)) => {
  if (!Object.prototype.hasOwnProperty.call(VERB_MODULES, name)) {
    throw new Error(`race: unknown verb ${name}\n${usage()}`)
  }
  const spec = VERB_MODULES[name]
  const exported = VERB_EXPORTS[name]
  const mod = await importer(spec)
  const verb = mod?.[exported]
  if (typeof verb !== 'function') {
    throw new Error(`race: ${spec} does not export ${exported}()`)
  }
  return verb
}

// Returns the exit code rather than calling process.exit — the script entry
// below is the only place that exits.
export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const {
    launch,
    judge,
    resolveVerb: resolve = resolveVerb,
    stdout = (line) => process.stdout.write(`${line}\n`),
    stderr = (line) => process.stderr.write(`${line}\n`),
  } = deps
  const [name, ...rest] = argv
  const injected = { launch, judge }
  if (!Object.prototype.hasOwnProperty.call(VERB_MODULES, name)) {
    stderr(
      name === undefined
        ? `race: missing verb\n${usage()}`
        : `race: unknown verb ${name}\n${usage()}`,
    )
    return 1
  }
  try {
    const verb = injected[name] ?? (await resolve(name))
    await verb(rest, { stdout, stderr })
    return 0
  } catch (error) {
    stderr(String(error?.message ?? error))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error?.message ?? error)
      process.exit(1)
    },
  )
}
