/**
 * factory/worker.mjs — one dispatch is one `query()`.
 *
 * A worker runs in exactly one clone and answers with what it did: the SDK's
 * own `result` message, the confinement denials it earned, its assistant-turn
 * count and its wall time. Nothing here calls the Anthropic API directly —
 * every model call is one `query()` of `@anthropic-ai/claude-agent-sdk`, which
 * rides the edge-injected bearer exactly as `claude -p` does.
 *
 * Confinement is a function, not a permission mode. `canUseTool` is shadowed
 * under `bypassPermissions` (the SDK warns so at start, measured on the
 * prototype), so the fence is an in-process `PreToolUse` hook: an edit whose
 * resolved path leaves `cwd`, or is not one of the task's `files`, is denied
 * before the tool touches it. The prototype's hook caught one real escape.
 *
 * `settingSources: []` turns CLAUDE.md, skills and project hooks off, so a
 * worker reads only the prompt and system prompt it was handed.
 *
 * `deps.query` is the second argument's one member and is required: the engine
 * resolves the SDK where it is installed and hands it in, and an exam drives a
 * fake iterator with no network and no install.
 */

import path from 'node:path'
import { findGit } from './gitblock.mjs'

/** The tools whose `file_path` the confinement hook adjudicates. */
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** Models never run git, never browse, and never spawn sub-agents. */
export const DISALLOWED_TOOLS = ['Bash(git *)', 'WebFetch', 'WebSearch', 'Agent']

/**
 * Build the `PreToolUse` callback that fences one worker into one clone.
 *
 * `files` are paths relative to `cwd`; `tool_input.file_path` is resolved
 * against `cwd` and compared as a relative path, and anything that begins `..`
 * is outside. Every deny appends `{ tool, path }` to `denials`, which is the
 * same array the dispatch answers.
 */
export function makeConfineHook ({ cwd, files, denials = [] }) {
  const base = path.resolve(String(cwd ?? '.'))
  const allowed = Array.isArray(files) ? new Set(files.map((f) => path.normalize(String(f)))) : null
  return async (input) => {
    const tool = input?.tool_name
    if (!EDIT_TOOLS.includes(tool)) return {}
    const asked = String(input?.tool_input?.file_path ?? '')
    const rel = path.relative(base, path.resolve(base, asked))
    const outside = rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
    const unlisted = allowed !== null && !allowed.has(path.normalize(rel))
    if (!outside && !unlisted) return {}
    denials.push({ tool, path: rel })
    const why = outside ? 'outside the clone' : 'not in the task\'s Files'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${tool} denied: ${rel || asked} is ${why} (${base})`,
      },
    }
  }
}

/**
 * Build the `PreToolUse` callback that refuses a Bash line that runs git.
 *
 * `findGit` reads the whole line — behind `&&`, `;`, `|`, a subshell, an
 * `eval` — not just its first word, which is all `DISALLOWED_TOOLS`' prefix
 * match ever caught. On a hit, `onDenied` (when given) is handed the row
 * this refusal earned, inside a `try`/`catch`: a row that cannot be written
 * never turns a deny into an allow, and neither does a missing callback.
 */
export function makeGitHook ({ task, label, onDenied }) {
  return async (input) => {
    if (input?.tool_name !== 'Bash') return {}
    const command = input?.tool_input?.command
    const hit = findGit(command)
    if (hit === null) return {}
    const row = {
      kind: 'worker:denied',
      task,
      label,
      tool: 'Bash',
      why: 'git',
      command: String(command).slice(0, 200),
    }
    if (typeof onDenied === 'function') {
      try { onDenied(row) } catch { /* a row that fails to write never turns a deny into an allow */ }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Bash denied: this line runs git, and the engine runs git itself — never a worker. Drop the git command and carry on; your edits are captured for you.',
      },
    }
  }
}

/** The options literal every dispatch shares, built once per worker. */
export function workerOptions ({ cwd, systemPrompt, model, files, schema, mcpServers, task, label, onDenied, readOnly }, denials) {
  const options = {
    cwd,
    systemPrompt,
    model,
    settingSources: [],
    permissionMode: 'bypassPermissions',
    disallowedTools: readOnly ? [...new Set([...DISALLOWED_TOOLS, ...EDIT_TOOLS, 'Bash'])] : [...DISALLOWED_TOOLS],
    hooks: { PreToolUse: [{ hooks: [makeConfineHook({ cwd, files, denials }), makeGitHook({ task, label, onDenied })] }] },
  }
  if (schema !== undefined && schema !== null) options.outputFormat = { type: 'json_schema', schema }
  if (mcpServers !== undefined && mcpServers !== null) options.mcpServers = mcpServers
  return options
}

/**
 * Drain one iterator to its `result` message.
 *
 * `onMessage`, when given, sees every message the iterator yields, so the
 * engine's supervisor reads the stream without standing up a second consumer.
 */
async function drain (iterator, { denials, onMessage, startedAt }) {
  let result = null
  let turns = 0
  for await (const message of iterator) {
    if (onMessage) await onMessage(message)
    if (message?.type === 'assistant') turns += 1
    if (message?.type === 'result') result = message
  }
  return { result, denials, turns, wall_ms: Date.now() - startedAt }
}

/** One dispatch: one worker, one clone, one answer. */
export function runWorker (opts = {}, deps = {}) {
  const run = deps.query
  if (typeof run !== 'function') {
    throw new Error('factory/worker: no query() — pass deps.query')
  }
  const startedAt = Date.now()
  const denials = []
  const handle = run({ prompt: opts.prompt, options: workerOptions(opts, denials) })
  // The real SDK's `query()` answers the iterator synchronously; a fake
  // `query` driving an exam may be declared `async` and so answer a promise
  // of one instead — `Promise.resolve` reads either the same way.
  return Promise.resolve(handle)
    .then((iterator) => drain(iterator, { denials, onMessage: opts.onMessage, startedAt }))
}

export default { runWorker, makeConfineHook, makeGitHook, workerOptions, EDIT_TOOLS, DISALLOWED_TOOLS }
