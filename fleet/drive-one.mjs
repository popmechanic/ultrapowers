#!/usr/bin/env node
// fleet/drive-one.mjs — the committed drive CLI (#193 item 6).
//
// `driveOne` (fleet/drive.mjs) is a library function; until now every live run
// hand-typed a throwaway wrapper onto the orchestrator (the RUNBOOK heredoc),
// which was retyped with typos, left the checkout dirty, and hard-coded the
// operator's constants. This is that wrapper, committed once:
//
//   node fleet/drive-one.mjs <plan.md> <runId> [--port N] [--db-dir DIR] ...
//
// The OAuth token is read from --token-path (default: the orchestrator's 0600
// file) and passed to driveOne as engineEnv — never printed, never on argv.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { driveOne, GITHUB_TOKEN_PATH } from './drive.mjs'

// The checkout this file lives in — the base ref is pushed from here, so the
// CLI works from any cwd (the RUNBOOK's old "run from the repo root" rule).
export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULTS = Object.freeze({
  golden: 'fleet-golden',
  port: 8180,
  dbDir: '/tmp/fleet-orch-live',
  // Store-token lease TTL; 4h covers any single-plan drain (#279).
  ttlHours: 4,
  tokenPath: '/home/exedev/.fleet/claude-oauth-token',
  repoDir: REPO_DIR,
  // #368: the GitHub token the publish leg hands `git push`/`gh` as GH_TOKEN
  // (env only), and the PR's base branch.
  githubTokenPath: GITHUB_TOKEN_PATH,
  prBase: 'main',
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
  '--repo-dir': 'repoDir',
  '--github-token-path': 'githubTokenPath',
  '--pr-base': 'prBase',
})
const NUMERIC = new Set(['port', 'ttlHours', 'sandboxCpu'])

export const usage = () =>
  'usage: node fleet/drive-one.mjs <plan.md> <runId> [--port N] [--db-dir DIR] ' +
  '[--golden VM] [--ttl-hours N] [--evidence-dir DIR] ' +
  '[--sandbox-cpu N] [--sandbox-memory 16GB] [--token-path FILE] [--repo-dir DIR] ' +
  '[--github-token-path FILE] [--pr-base BRANCH] [--allow-unfit-plan]'

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
  return { planPath, runId, ...opts }
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
  repoDir: parsed.repoDir,
  exec,
  engineEnv: { CLAUDE_CODE_OAUTH_TOKEN: String(readToken(parsed.tokenPath)).trim() },
  runId: parsed.runId,
  ttlMs: parsed.ttlHours * 60 * 60 * 1000,
  heartbeatTimeoutMs: 30 * 60_000,
  claimTimeoutMs: 10 * 60_000,
  ...(parsed.evidenceDir ? { evidenceDir: parsed.evidenceDir } : {}),
  ...(parsed.sandboxCpu ? { sandboxCpu: parsed.sandboxCpu } : {}),
  ...(parsed.sandboxMemory ? { sandboxMemory: parsed.sandboxMemory } : {}),
  allowUnfitPlan: parsed.allowUnfitPlan,
  githubTokenPath: parsed.githubTokenPath,
  prBase: parsed.prBase,
})

export const main = async (argv = process.argv.slice(2), { drive = driveOne, log = console.log, ...deps } = {}) => {
  const parsed = parseArgs(argv)
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
