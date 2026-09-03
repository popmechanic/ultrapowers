#!/usr/bin/env node
/**
 * fleet/target.mjs — the one integration object a target repository needs.
 *
 *   node fleet/target.mjs <owner>/<repo>
 *   node fleet/target.mjs list
 *   node fleet/target.mjs gc
 *
 * Per target, exactly ONE object, created once, attached to NOTHING:
 *
 *   gh-<owner>-<repo>   --act-as-user
 *
 * The launcher attaches it to the run's VM for the run's six hours; the
 * sandbox clones, pushes and opens the PR through it; the human gate is the PR
 * itself. There is no read-only twin and no write grant, because of two facts
 * measured 2026-09-03: exe.dev's GitHub edge routes each request by repo path
 * and serves a cached installation token for 30–60 s after an integration is
 * attached (a `gh pr create` twenty seconds after the swap produced a
 * bot-authored PR), and two integrations naming one repo on one VM have no
 * documented tie-break. One object per repo makes both faults inexpressible.
 * Nothing GitHub rides `tag:fleet` except `fleet-runs`.
 *
 * Creating is idempotent: an object that exists is left exactly as it is and
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
  githubIntegrationFor,
  isSafeTarget,
  listIntegrations,
  lobby,
  parseArgs,
  runCli
} from './lobby.mjs'

export const USAGE = `usage: node fleet/target.mjs <owner>/<repo>
       node fleet/target.mjs list
       node fleet/target.mjs gc [--json]`

export const usage = () => USAGE

/** The one `integrations add` line, verbatim, for a target. No `--attach`, no `--readonly`. */
export const addCommand = (target) =>
  `integrations add github --name ${githubIntegrationFor(target)} --repository ${target} --act-as-user`

/** Is this one of the per-target objects? `gh-<slug>`. */
const isTargetIntegration = (name) => /^gh-.+/.test(name)

async function add ({ exec, target }) {
  const name = githubIntegrationFor(target)
  const existing = new Set((await listIntegrations(exec)).map((row) => row.name))
  if (existing.has(name)) {
    return { verb: 'add', target, results: [{ name, action: 'skipped', command: null }] }
  }
  const command = addCommand(target)
  await lobby(exec, command)
  return { verb: 'add', target, results: [{ name, action: 'created', command }] }
}

async function list ({ exec }) {
  const rows = (await listIntegrations(exec))
    .filter((row) => isTargetIntegration(row.name))
    .map((row) => ({ name: row.name, repository: row.repository, attachments: row.attachments }))
  return { verb: 'list', results: rows }
}

/**
 * Report objects whose repository is gone. The repository comes from the
 * listing's own `repository` field: `gh-<owner>-<repo>` cannot be reversed,
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
  const [verb] = positional
  const json = opts.json === true
  if (verb === 'list') return { ...await list({ exec }), json }
  if (verb === 'gc') return { ...await gc({ exec }), json }
  // A target has a slash and a verb has none, so the bare form is unambiguous.
  if (isSafeTarget(verb)) return { ...await add({ exec, target: verb }), json }
  throw new Refusal(`target: expected <owner>/<repo>, list or gc, got ${JSON.stringify(verb ?? null)}\n${usage()}`)
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
