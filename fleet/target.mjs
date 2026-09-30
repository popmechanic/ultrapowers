#!/usr/bin/env node
/**
 * fleet/target.mjs — the one integration object a target repository needs.
 *
 *   node fleet/target.mjs <owner>/<repo>
 *   node fleet/target.mjs list
 *   node fleet/target.mjs gc
 *
 * Per target, exactly ONE object, created once, attached to `tag:fleet`:
 *
 *   gh-<owner>-<repo>   --act-as-user   --attach tag:fleet
 *
 * A credential reaches a fleet VM by its integration's attachment `tag:fleet`,
 * and the launcher's `--tag fleet` is the grant (the policy model exe.dev tried
 * on 2026-09-11 was rolled back; `integrations` has no `policy` verb, #1434).
 * The sandbox clones, pushes and opens the PR through it; the human gate is the
 * PR itself. There is no read-only twin and no write grant, because of two facts
 * measured 2026-09-03: exe.dev's GitHub edge routes each request by repo path
 * and serves a cached installation token for 30–60 s after an integration is
 * edited (a `gh pr create` twenty seconds after a swap produced a bot-authored
 * PR), and two integrations naming one repo on one VM have no documented
 * tie-break. One object per repo makes both faults inexpressible — two targets'
 * objects on one VM name two repos, which the edge routes apart by path.
 *
 * Creating is idempotent: an object that exists is left exactly as it is and
 * reported as `skipped`, and attached to `tag:fleet` when the listing shows it
 * is not. `gc` reports and never deletes — it names integration
 * objects whose repository `gh repo view` can no longer see, and leaves the
 * decision to the operator, because a repo that is merely private to another
 * account looks identical to one that is gone.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FLEET_POLICY,
  LobbyError,
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

/** The one `integrations add` line, verbatim, for a target: attached at creation,
 *  so a fresh object never needs a second write. No `--readonly`. */
const addCommand = (target) =>
  `integrations add github --name ${githubIntegrationFor(target)} --repository ${target} --act-as-user --attach ${FLEET_POLICY}`
const attachCommand = (name) => `integrations attach ${name} ${FLEET_POLICY}`

/** Is this one of the per-target objects? `gh-<slug>`. */
const isTargetIntegration = (name) => /^gh-.+/.test(name)

/** Attach the object to `tag:fleet` unless the listing already shows it there.
 *  Answers `kept` or `set`. */
async function ensureAttached ({ exec, name, rows = null }) {
  const listed = rows ?? await listIntegrations(exec)
  const row = listed.find((r) => r.name === name)
  if (row && row.attachments.some((a) => a.kind === 'tag' && a.value === 'fleet')) {
    return { policy: 'kept', command: null }
  }
  const command = attachCommand(name)
  await lobby(exec, command)
  return { policy: 'set', command }
}

async function add ({ exec, target }) {
  const name = githubIntegrationFor(target)
  const rows = await listIntegrations(exec)
  const existing = new Set(rows.map((row) => row.name))
  if (existing.has(name)) {
    const ensured = await ensureAttached({ exec, name, rows })
    return { verb: 'add', target, results: [{ name, action: 'skipped', command: ensured.command, policy: ensured.policy }] }
  }
  const command = addCommand(target)
  await lobby(exec, command)
  return { verb: 'add', target, results: [{ name, action: 'created', command, policy: 'set' }] }
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

const renderTarget = (result) => {
  if (result.verb === 'add') {
    return result.results.map((r) => `${r.action} ${r.name} (attached ${FLEET_POLICY} ${r.policy})`).join('\n')
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
