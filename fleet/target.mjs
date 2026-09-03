#!/usr/bin/env node
/**
 * fleet/target.mjs — the two integration objects a target repository needs.
 *
 *   node fleet/target.mjs add <owner>/<repo>
 *   node fleet/target.mjs list
 *   node fleet/target.mjs gc
 *
 * Per target, exactly two objects, created once and then left alone:
 *
 *   t-<owner>-<repo>-ro   --readonly --attach tag:fleet
 *   t-<owner>-<repo>-rw   --act-as-user, attached to NOTHING
 *
 * The read-only object rides the shared `fleet` tag on purpose: read access to
 * one repository is harmless on a tag, and putting it there removes the
 * attach→boot race for reads — a sandbox that boots before an attach lands
 * would otherwise fail its first clone. The writable object is never on a tag
 * and never on a VM except for the fifteen minutes after a run is green
 * (`fleet/grant.mjs`), because a tag-attached write credential is a credential
 * every sandbox in the fleet holds.
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
  FLEET_TAG,
  LobbyError,
  Refusal,
  attachedToTag,
  defaultExec,
  isSafeTarget,
  listIntegrations,
  lobby,
  parseArgs,
  roIntegrationFor,
  runCli,
  rwIntegrationFor
} from './lobby.mjs'

export const usage = () => [
  'usage: node fleet/target.mjs add <owner>/<repo>',
  '       node fleet/target.mjs list',
  '       node fleet/target.mjs gc [--json]'
].join('\n')

/** The two `integrations add` lines, verbatim, for a target. */
export const addCommands = (target) => [
  `integrations add github --name ${roIntegrationFor(target)} --repository ${target} --readonly --attach tag:${FLEET_TAG}`,
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
    const res = await lobby(exec, command)
    if (res.code !== 0) {
      throw new LobbyError(`target: \`${command}\` failed (code ${res.code}): ${String(res.stderr).trim()}`)
    }
    results.push({ name, action: 'created', command })
  }
  return { verb: 'add', target, results }
}

async function list ({ exec }) {
  const rows = (await listIntegrations(exec))
    .filter((row) => isTargetIntegration(row.name))
    .map((row) => ({
      name: row.name,
      repository: row.repository,
      tagged: attachedToTag(row),
      attachments: row.attachments
    }))
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

export const renderTarget = (result) => {
  if (result.verb === 'add') {
    return result.results.map((r) => `${r.action} ${r.name}`).join('\n')
  }
  if (result.verb === 'list') {
    if (result.results.length === 0) return 'no target integrations'
    return result.results
      .map((r) => `${r.name}  ${r.repository ?? '?'}  ${r.tagged ? `tag:${FLEET_TAG}` : 'per-vm'}`)
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
