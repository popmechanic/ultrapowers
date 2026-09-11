#!/usr/bin/env node
/**
 * fleet/target.mjs — the one integration object a target repository needs.
 *
 *   node fleet/target.mjs <owner>/<repo>
 *   node fleet/target.mjs list
 *   node fleet/target.mjs gc
 *
 * Per target, exactly ONE object, created once, on the policy `tag:fleet`:
 *
 *   gh-<owner>-<repo>   --act-as-user   --policy 'tag:fleet'
 *
 * Every GitHub integration rides `tag:fleet` by policy: since 2026-09-11 exe.dev
 * refuses `new --integration` and `integrations attach` ("cannot safely rewrite
 * a singular attachment policy"), so the one way a credential reaches a fleet
 * VM is the complete attachment policy on the integration itself, and the
 * launcher's `--tag fleet` is the grant. The sandbox clones, pushes and opens
 * the PR through it; the human gate is the PR itself. There is no read-only
 * twin and no write grant, because of two facts measured 2026-09-03: exe.dev's
 * GitHub edge routes each request by repo path and serves a cached installation
 * token for 30–60 s after an integration is edited (a `gh pr create` twenty
 * seconds after a swap produced a bot-authored PR), and two integrations naming
 * one repo on one VM have no documented tie-break. One object per repo makes
 * both faults inexpressible — two targets' objects on one VM name two repos,
 * which the edge routes apart by path.
 *
 * Creating is idempotent: an object that exists is left exactly as it is and
 * reported as `skipped`, and then its policy is read (`integrations policy get
 * <name> --json`) and, when its selector is not `tag:fleet`, replaced —
 * `integrations policy set <name> 'tag:fleet' --permanent
 * --if-revision=<revision>`, the revision the read just answered, so a policy
 * something else changed in between is refused by the lobby rather than
 * overwritten. `gc` reports and never deletes — it names integration
 * objects whose repository `gh repo view` can no longer see, and leaves the
 * decision to the operator, because a repo that is merely private to another
 * account looks identical to one that is gone.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
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

/** The policy every fleet integration carries: the tag a fleet VM is created with. */
export const FLEET_POLICY = 'tag:fleet'

/** The one `integrations add` line, verbatim, for a target. No `--attach`, no `--readonly`;
 *  the complete policy at creation, so a fresh object never needs a second write. */
export const addCommand = (target) =>
  `integrations add github --name ${githubIntegrationFor(target)} --repository ${target} --act-as-user --policy '${FLEET_POLICY}'`

/** The same creation on the attach-model lobby, and the attach verb for an existing object. */
export const addCommandAttach = (target) =>
  `integrations add github --name ${githubIntegrationFor(target)} --repository ${target} --act-as-user --attach ${FLEET_POLICY}`
export const attachCommand = (name) => `integrations attach ${name} ${FLEET_POLICY}`

/** The read and the write that bring an existing object onto the policy. */
export const policyGetCommand = (name) => `integrations policy get ${name} --json`
export const policySetCommand = (name, revision) =>
  `integrations policy set ${name} '${FLEET_POLICY}' --permanent --if-revision=${revision}`

/** Is this one of the per-target objects? `gh-<slug>`. */
const isTargetIntegration = (name) => /^gh-.+/.test(name)

/** `integrations policy get <name> --json` → `{ selector, revision }`, or null when
 *  the answer is not that shape. The selector is `policy.selector`; a listing that
 *  spells it `policy.wire` alone says the same thing. */
export function parsePolicy (stdout) {
  let parsed
  try { parsed = JSON.parse(String(stdout ?? '')) } catch { return null }
  const policy = parsed?.policy
  const selector = typeof policy?.selector === 'string' ? policy.selector
    : typeof policy?.wire === 'string' ? policy.wire : null
  const revision = typeof parsed?.revision === 'string' ? parsed.revision : null
  if (revision === null) return null
  return { selector, revision }
}

/** Read the object's policy and, unless it already is `tag:fleet`, replace it
 *  under the revision the read answered. Answers `kept` or `set`. */
async function ensurePolicy ({ exec, name, rows = null }) {
  // The listing answers first: it is served by both lobby models (the policy
  // model exe.dev shipped 2026-09-11 and rolled back the same afternoon), and an
  // attachment `tag:fleet` there is the grant whichever verb wrote it.
  const listed = rows ?? await listIntegrations(exec)
  const row = listed.find((r) => r.name === name)
  if (row && row.attachments.some((a) => a.kind === 'tag' && a.value === 'fleet')) {
    return { policy: 'kept', command: null }
  }
  let res
  try {
    res = await lobby(exec, policyGetCommand(name))
  } catch (error) {
    // No `policy` subcommand: the lobby is on the attach model — attach by tag.
    const command = attachCommand(name)
    await lobby(exec, command)
    return { policy: 'set', command }
  }
  const policy = parsePolicy(res.stdout)
  if (policy === null) {
    throw new LobbyError(`exe.dev integrations policy get ${name} --json answered no policy and revision:\n${res.stdout}`)
  }
  if (policy.selector === FLEET_POLICY) return { policy: 'kept', command: null }
  const command = policySetCommand(name, policy.revision)
  await lobby(exec, command)
  return { policy: 'set', command }
}

async function add ({ exec, target }) {
  const name = githubIntegrationFor(target)
  const rows = await listIntegrations(exec)
  const existing = new Set(rows.map((row) => row.name))
  if (existing.has(name)) {
    const ensured = await ensurePolicy({ exec, name, rows })
    return { verb: 'add', target, results: [{ name, action: 'skipped', command: ensured.command, policy: ensured.policy }] }
  }
  let command = addCommand(target)
  try {
    await lobby(exec, command)
  } catch (error) {
    // The attach-model lobby knows no `--policy`: create with `--attach tag:fleet`.
    command = addCommandAttach(target)
    await lobby(exec, command)
  }
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

export const renderTarget = (result) => {
  if (result.verb === 'add') {
    return result.results.map((r) => `${r.action} ${r.name} (policy ${FLEET_POLICY} ${r.policy})`).join('\n')
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
