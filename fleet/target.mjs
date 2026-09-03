#!/usr/bin/env node
/**
 * fleet/target.mjs — the two integration objects a target repository needs.
 *
 *   node fleet/target.mjs add <owner>/<repo>
 *   node fleet/target.mjs list
 *   node fleet/target.mjs gc
 *
 * Per target, exactly two objects, created once, attached to NOTHING:
 *
 *   t-<owner>-<repo>-ro   --readonly
 *   t-<owner>-<repo>-rw   --act-as-user
 *
 * Both are attached per VM and per window, by the tools that need them: the
 * launcher attaches `-ro` for the run's six hours, the grant swaps it for
 * `-rw` for fifteen minutes. Nothing GitHub rides `tag:fleet` except
 * `fleet-runs` — a tag attachment is a credential every sandbox holds, and a
 * tag-attached `-ro` cannot be detached from one VM when `-rw` has to take its
 * place, since `github.int.exe.xyz` resolves one credential per repo.
 *
 * `add` is idempotent: an object that exists is left exactly as it is and
 * reported as `skipped`. `gc` reports and never deletes — it names integration
 * objects whose repository `gh repo view` can no longer see, and leaves the
 * decision to the operator, because a repo that is merely private to another
 * account looks identical to one that is gone.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  isSafeTarget,
  listIntegrations,
  lobby,
  parseArgs,
  roIntegrationFor,
  runCli,
  rwIntegrationFor
} from './lobby.mjs'

export const USAGE = `usage: node fleet/target.mjs add <owner>/<repo>
       node fleet/target.mjs list
       node fleet/target.mjs gc [--json]`

export const usage = () => USAGE

/** The two `integrations add` lines, verbatim, for a target. No `--attach`. */
export const addCommands = (target) => [
  `integrations add github --name ${roIntegrationFor(target)} --repository ${target} --readonly`,
  `integrations add github --name ${rwIntegrationFor(target)} --repository ${target} --act-as-user`
]

/** Is this one of the per-target objects? `t-<slug>-ro` / `t-<slug>-rw`. */
const isTargetIntegration = (name) => /^t-.+-(ro|rw)$/.test(name)

async function add ({ exec, target }) {
  if (!isSafeTarget(target)) {
    throw new Refusal(`target: add needs <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  }
  const existing = new Set((await listIntegrations(exec)).map((row) => row.name))
  const results = []
  for (const [name, command] of [
    [roIntegrationFor(target), addCommands(target)[0]],
    [rwIntegrationFor(target), addCommands(target)[1]]
  ]) {
    if (existing.has(name)) {
      results.push({ name, action: 'skipped', command: null })
      continue
    }
    await lobby(exec, command)
    results.push({ name, action: 'created', command })
  }
  return { verb: 'add', target, results }
}

async function list ({ exec }) {
  const rows = (await listIntegrations(exec))
    .filter((row) => isTargetIntegration(row.name))
    .map((row) => ({ name: row.name, repository: row.repository, attachments: row.attachments }))
  return { verb: 'list', results: rows }
}

/**
 * Report objects whose repository is gone. The repository comes from the
 * listing's own `repository` field: `t-<owner>-<repo>-ro` cannot be reversed,
 * because the slash became a hyphen and hyphens are legal in both halves.
 */
async function gc ({ exec }) {
  const rows = (await listIntegrations(exec)).filter((row) => isTargetIntegration(row.name))
  const seen = new Map()
  const results = []
  for (const row of rows) {
    if (!row.repository) {
      results.push({ name: row.name, repository: null, verdict: 'unknown' })
      continue
    }
    if (!seen.has(row.repository)) {
      const res = await exec('gh', ['repo', 'view', row.repository, '--json', 'name'])
      seen.set(row.repository, res.code === 0)
    }
    results.push({
      name: row.name,
      repository: row.repository,
      verdict: seen.get(row.repository) ? 'present' : 'missing'
    })
  }
  return { verb: 'gc', results }
}

export async function target ({ argv, exec = defaultExec }) {
  const { opts, positional } = parseArgs(argv, { flags: ['json'] })
  const [verb, value] = positional
  if (verb === 'add') return { ...await add({ exec, target: value }), json: opts.json === true }
  if (verb === 'list') return { ...await list({ exec }), json: opts.json === true }
  if (verb === 'gc') return { ...await gc({ exec }), json: opts.json === true }
  throw new Refusal(`target: unknown verb ${JSON.stringify(verb ?? null)}\n${usage()}`)
}

const attachedTo = (attachments) =>
  attachments.length === 0 ? 'unattached' : attachments.map((a) => `${a.kind}:${a.value}`).join(' ')

export const renderTarget = (result) => {
  if (result.verb === 'add') {
    return result.results.map((r) => `${r.action} ${r.name}`).join('\n')
  }
  if (result.verb === 'list') {
    if (result.results.length === 0) return 'no target integrations'
    return result.results
      .map((r) => `${r.name}  ${r.repository ?? '?'}  ${attachedTo(r.attachments)}`)
      .join('\n')
  }
  const missing = result.results.filter((r) => r.verdict !== 'present')
  if (missing.length === 0) return 'every target integration names a repository gh can see'
  return missing.map((r) => `${r.verdict} ${r.name}  ${r.repository ?? '?'}`).join('\n')
}

async function main (argv) {
  const result = await target({ argv })
  process.stdout.write(result.json ? `${JSON.stringify(result)}\n` : `${renderTarget(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
