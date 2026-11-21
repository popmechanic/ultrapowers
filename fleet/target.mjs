#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FLEET_POLICY,
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

const addCommand = (target) =>
  `integrations add github --name ${githubIntegrationFor(target)} --repository ${target} --act-as-user --attach ${FLEET_POLICY}`
const attachCommand = (name) => `integrations attach ${name} ${FLEET_POLICY}`

const isTargetIntegration = (name) => /^gh-.+/.test(name)

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
