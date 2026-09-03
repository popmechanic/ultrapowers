#!/usr/bin/env node
// fleet/drive-one.mjs — the committed drive CLI (#193 item 6).
//
// `driveOne` (fleet/drive.mjs) is a library function; until now every live run
// hand-typed a throwaway wrapper onto the orchestrator (the RUNBOOK heredoc),
// which was retyped with typos, left the checkout dirty, and hard-coded the
// operator's constants. This is that wrapper, committed once:
//
//   node fleet/drive-one.mjs <plan.md> <runId> --target <owner>/<repo> --base <sha> ...
//
// A launch names two things and only two: the repository the run works on and
// the commit it starts from. Where the drive itself runs from is not a flag —
// it is the checkout this file lives in (`REPO_DIR`).
//
// The OAuth token is read from --token-path (default: the orchestrator's 0600
// file) and passed to driveOne as engineEnv — never printed, never on argv.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { driveOne, GITHUB_TOKEN_PATH, isSafeTarget } from './drive.mjs'
import { isSafeSha } from './shim-main.mjs'

// The checkout this file lives in — the base ref is pushed from here, so the
// CLI works from any cwd (the RUNBOOK's old "run from the repo root" rule).
export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULTS = Object.freeze({
  golden: 'fleet-golden',
  port: 8180,
  dbDir: '/tmp/fleet-orch-live',
  // #466: NOT `${dbDir}-evidence`. The store dir is /tmp by design (a fresh-store
  // experiment should be a wipe), but the evidence bundles are the only durable
  // record of what each run did — 18 of them, runs 10-32, the whole corpus every
  // ultralearn sense pass reads. They sat in /tmp for 23 runs and survived on the
  // orchestrator's uptime alone. Same filesystem as /tmp on that VM, so this
  // buys protection from reaping, not from losing the VM.
  evidenceDir: '/home/exedev/fleet-evidence',
  // Store-token lease TTL; 4h covers any single-plan drain (#279).
  ttlHours: 4,
  tokenPath: '/home/exedev/.fleet/claude-oauth-token',
  // Not a flag: every attempt of every run drives out of the checkout the CLI
  // lives in. The target repository is reached by fetch, not by moving here.
  repoDir: REPO_DIR,
  // #368: the GitHub token the publish leg hands `git push`/`gh` as GH_TOKEN
  // (env only).
  githubTokenPath: GITHUB_TOKEN_PATH,
  // #546: size the run sandbox to the account pool, not to the golden image's
  // build size. Spread only-when-typed, a bare launch inherited the golden's
  // 8 vCPU / 15 GB; run-51 sat an eleven-wide wave at load 2.89 on those 8
  // cores with 3 GB used of 15, and memory is the thinner margin (~3 GB per
  // busy implementer). The pool is one shared 16 vCPU / 64 GB allocation and
  // an allocation is a cap rather than a reservation, so this costs nothing
  // while the sandbox idles — which is most of a run. A default, not a clamp:
  // the flags still override in both directions. NUMERIC coerces sandboxCpu,
  // so this has to be the number 16 and not the string '16'.
  sandboxCpu: 16,
  sandboxMemory: '48GB',
})

const FLAGS = Object.freeze({
  '--golden': 'golden',
  '--port': 'port',
  '--db-dir': 'dbDir',
  '--ttl-hours': 'ttlHours',
  '--evidence-dir': 'evidenceDir',
  '--sandbox-cpu': 'sandboxCpu',
  '--sandbox-memory': 'sandboxMemory',
  '--token-path': 'tokenPath',
  '--github-token-path': 'githubTokenPath',
  // The two a launch names. Both required, both validated here: a malformed
  // target or a symbolic base costs a usage line instead of a paid drive.
  '--target': 'target',
  '--base': 'baseSha',
  // #514: the fold-versus-serialize A/B knob. Deliberately absent from
  // DEFAULTS — an unset flag must leave NO `overlap` key anywhere along
  // the chain, so the fleet default stays whatever the compiler's own
  // default is (Amendment 9: fold is the only merge path; serialize is
  // the rollback arm, never a standing default).
  '--overlap': 'overlap',
})
const NUMERIC = new Set(['port', 'ttlHours', 'sandboxCpu'])
// The modes `fleet/run-main.mjs` forwards to `ultra_run.py --overlap`,
// whose argparse `choices` are these two lowercase spellings. Checked HERE
// so a typo costs a usage line instead of a cloned sandbox that dies two
// hops away on an argparse error nobody reads.
const OVERLAP_MODES = Object.freeze(['fold', 'serialize'])

export const usage = () =>
  'usage: node fleet/drive-one.mjs <plan.md> <runId> --target <owner>/<repo> --base <sha> ' +
  '[--port N] [--db-dir DIR] [--golden VM] [--ttl-hours N] [--evidence-dir DIR] ' +
  '[--sandbox-cpu 16] [--sandbox-memory 48GB] [--token-path FILE] ' +
  '[--github-token-path FILE] [--overlap fold|serialize] [--allow-unfit-plan]'

// `owner/repo`: exactly one slash, and each half a git-safe name. The target is
// spelled into fetch refspecs and remote URLs downstream, so it is checked
// before anything is provisioned rather than after — with the driver's own
// guard, so the CLI and `driveOne` cannot disagree about what a target is.
export const parseArgs = (argv) => {
  const positional = []
  const opts = { ...DEFAULTS, allowUnfitPlan: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--allow-unfit-plan') {
      opts.allowUnfitPlan = true
      continue
    }
    if (arg.startsWith('--')) {
      const key = FLAGS[arg]
      if (!key) throw new Error(`drive-one: unknown flag ${arg}\n${usage()}`)
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`drive-one: ${arg} needs a value\n${usage()}`)
      }
      if (NUMERIC.has(key)) {
        const n = Number(value)
        if (!Number.isFinite(n)) throw new Error(`drive-one: ${arg} must be a number, got ${value}`)
        opts[key] = n
      } else if (key === 'overlap' && !OVERLAP_MODES.includes(value)) {
        throw new Error(
          `drive-one: ${arg} must be one of ${OVERLAP_MODES.join('|')}, got ${JSON.stringify(value)}\n${usage()}`
        )
      } else if (key === 'target' && !isSafeTarget(value)) {
        throw new Error(`drive-one: --target must be <owner>/<repo>, got ${JSON.stringify(value)}\n${usage()}`)
      } else if (key === 'baseSha' && !isSafeSha(value)) {
        // A symbolic base ('HEAD', a branch, an abbreviation) would let two
        // runs claim one commit and resolve it differently.
        throw new Error(
          `drive-one: --base must be a hex commit sha, got ${JSON.stringify(value)}\n${usage()}`
        )
      } else {
        opts[key] = value
      }
      i += 1
      continue
    }
    positional.push(arg)
  }
  const [planPath, runId, ...extra] = positional
  if (!planPath || !runId || extra.length) {
    throw new Error(`drive-one: expected exactly <plan.md> <runId>\n${usage()}`)
  }
  // #211: a runId is unique per account lifetime — it names the sandbox VM and
  // the store row, so it must be a clean token and must never be reused.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId)) {
    throw new Error(`drive-one: runId must be [A-Za-z0-9-] (got ${JSON.stringify(runId)}) — and never reuse one (#211)`)
  }
  // Neither has a default: a run that does not name its repository and its
  // commit is not a run anybody can reproduce.
  if (!opts.target) {
    throw new Error(`drive-one: --target <owner>/<repo> is required\n${usage()}`)
  }
  if (!opts.baseSha) {
    throw new Error(`drive-one: --base <sha> is required\n${usage()}`)
  }
  return { planPath, runId, ...opts }
}

// #580: a mistyped plan path costs a usage line, not a cloned sandbox. Since
// #575 the plan is a file the driver ships by basename — nothing reads it out
// of git any more — so `driveOne`'s own handling of an unreadable plan is a
// narrated skip that lets the drive go on to clone and size a sandbox. That
// skip is load-bearing for the in-process drive tests, whose default plan path
// does not exist, so the refusal lives HERE, in the CLI.
//
// Not in `parseArgs`, which stays pure: fleet/race.mjs calls it (via
// `parseLaunchArgs`) without going through this `main`, and a filesystem touch
// inside the parser would change what that shared seam means.
//
// Every message names the path, so an operator reading only the error line
// knows which argument they mistyped.
export const assertPlanReadable = (planPath) => {
  let stat
  try {
    stat = fs.statSync(planPath)
  } catch (error) {
    throw new Error(
      `drive-one: cannot read the plan at ${planPath} (${error?.code ?? error?.message}) — nothing was driven`
    )
  }
  if (!stat.isFile()) {
    throw new Error(`drive-one: the plan path ${planPath} is not a regular file — nothing was driven`)
  }
  try {
    fs.accessSync(planPath, fs.constants.R_OK)
  } catch (error) {
    throw new Error(
      `drive-one: the plan at ${planPath} is not readable (${error?.code ?? error?.message}) — nothing was driven`
    )
  }
}

// `env` (#368) is LAYERED over the process environment for that one command —
// the publish leg's GH_TOKEN rides here and nowhere else: never on argv, never
// exported into this process, never in the log.
// #362-1: stdout and stderr travel SEPARATELY. drive.mjs's #337 preflight
// compares the working-tree plan byte-for-byte against `git show`'s stdout;
// folding stderr chatter (a `warning:`/`hint:` line from a global config)
// into it read a clean, committed plan as dirty and hard-refused the drive.
// Callers that want the diagnostic text of a failed command read `stderr`.
export const shellExec = (cmd, { env } = {}) =>
  new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', cmd],
      { maxBuffer: 1024 * 1024 * 16, env: env ? { ...process.env, ...env } : process.env },
      (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
    )
  })

// The driveOne options the old heredoc built by hand. The token file is read
// through an injectable reader so tests never touch the real path.
export const buildDriveOptions = (
  parsed,
  { readToken = (p) => fs.readFileSync(p, 'utf8'), exec = shellExec } = {}
) => ({
  planPath: parsed.planPath,
  golden: parsed.golden,
  port: parsed.port,
  dbDir: parsed.dbDir,
  // The two a launch names, and the one checkout every drive runs out of.
  target: parsed.target,
  baseSha: parsed.baseSha,
  repoDir: parsed.repoDir ?? REPO_DIR,
  exec,
  engineEnv: { CLAUDE_CODE_OAUTH_TOKEN: String(readToken(parsed.tokenPath)).trim() },
  runId: parsed.runId,
  ttlMs: parsed.ttlHours * 60 * 60 * 1000,
  heartbeatTimeoutMs: 30 * 60_000,
  claimTimeoutMs: 10 * 60_000,
  evidenceDir: parsed.evidenceDir,
  // #546: always sized. `parseArgs` folds DEFAULTS in, so these are already
  // set for a bare launch; the `??` covers a hand-built `parsed`.
  sandboxCpu: parsed.sandboxCpu ?? DEFAULTS.sandboxCpu,
  sandboxMemory: parsed.sandboxMemory ?? DEFAULTS.sandboxMemory,
  ...(parsed.overlap ? { overlap: parsed.overlap } : {}),
  allowUnfitPlan: parsed.allowUnfitPlan,
  githubTokenPath: parsed.githubTokenPath,
})

export const main = async (argv = process.argv.slice(2), { drive = driveOne, log = console.log, ...deps } = {}) => {
  const parsed = parseArgs(argv)
  // Before anything is provisioned: a plan the driver cannot read is not a run.
  assertPlanReadable(parsed.planPath)
  const { read, reportPath, detailPath } = await drive(buildDriveOptions(parsed, deps))
  log(JSON.stringify(read, null, 2))
  log(`report: ${reportPath}`)
  log(`detail: ${detailPath}`)
  return read
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
