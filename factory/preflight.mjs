/**
 * factory/preflight.mjs — the boot's credential probe, on its own: it asks
 * `claude auth status` and, when that alone is not enough to know, one
 * `GET <proxy>/api/oauth/usage`, and prints exactly one classification line.
 * It decides nothing — `factory/boot.sh` reads the line back and is the one
 * that turns `api_key`/`no_oauth`/`bearer_dead …`/`edge_refused …` into a
 * refusal, and `alive`/`inconclusive` into "proceed".
 *
 * `classify({ authOutput, code, body })` is the pure decision, exported so
 * an exam can drive it directly; the CLI below is the one caller that also
 * does the I/O (`claude auth status`, then at most one network request).
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const USAGE_PATH = '/api/oauth/usage'
const USAGE_TIMEOUT_MS = 20000

/** The first `"message"` string value anywhere in `text`, or `''`. */
function firstMessage (text) {
  const m = /"message"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text || '')
  if (!m) return ''
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

/** The pure classification: `authOutput` is `claude auth status`'s joined
 *  stdout+stderr; `code`/`body` are the `/api/oauth/usage` GET's status and
 *  text body, read only when the auth text alone did not already decide.
 *  Never throws — any unexpected shape reads as `inconclusive`. */
export function classify ({ authOutput, code, body } = {}) {
  try {
    const authText = authOutput || ''
    if (authText.includes('api_key')) return 'api_key'
    if (!authText.includes('oauth_token')) return 'no_oauth'
    if (code === 200) return 'alive'
    if (code !== 401 && code !== 403) return 'inconclusive'
    const bodyText = body || ''
    if (bodyText.includes('oauth_scope_insufficient')) return 'inconclusive'
    if (bodyText.replace(/[ \t\n]/g, '').includes('"type":"error"')) {
      return `bearer_dead ${code} ${firstMessage(bodyText)}`
    }
    if (bodyText.startsWith('integration not found')) {
      return `edge_refused ${code} ${bodyText.split('\n')[0].slice(0, 300)}`
    }
    return 'inconclusive'
  } catch {
    return 'inconclusive'
  }
}

/** `claude auth status`'s stdout+stderr, joined; a failed spawn reads as
 *  empty. `claude` is resolved on `PATH` and gets no credential in argv. */
function authStatus (proxy) {
  const res = spawnSync('claude', ['auth', 'status'], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_BASE_URL: proxy, CLAUDE_CODE_OAUTH_TOKEN: 'placeholder' }
  })
  if (!res) return ''
  return (res.stdout || '') + (res.stderr || '')
}

/** One `GET <proxy>/api/oauth/usage`, 20 s bounded, the literal token
 *  `placeholder` (the edge injects the real bearer). `{ code, body }` on any
 *  answer at all, `{}` on any failure — never throws. */
async function usageProbe (proxy) {
  try {
    const res = await fetch(`${proxy}${USAGE_PATH}`, {
      headers: { authorization: 'Bearer placeholder' },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS)
    })
    return { code: res.status, body: await res.text() }
  } catch {
    return {}
  }
}

function readProxyArg (argv) {
  const i = argv.indexOf('--proxy')
  return i >= 0 ? argv[i + 1] : undefined
}

async function main (argv) {
  let line = 'inconclusive'
  try {
    const proxy = readProxyArg(argv)
    const authOutput = authStatus(proxy)
    const authText = authOutput || ''
    const decided = authText.includes('api_key') || !authText.includes('oauth_token')
    const { code, body } = decided ? {} : await usageProbe(proxy)
    line = classify({ authOutput, code, body })
  } catch {
    line = 'inconclusive'
  }
  process.stdout.write(line + '\n')
  return 0
}

const here = path.resolve(fileURLToPath(import.meta.url))
// `$ENGINE_REPO_DIR/factory` is a symlink onto this file's real directory (`factory/boot.sh`'s
// own checkout), and Node resolves the entry module's `import.meta.url` through it while leaving
// `process.argv[1]` exactly as the CLI was called — so the basename is the fallback that still
// holds when the two paths' directories disagree only over that symlink.
const invokedDirectly = process.argv[1] && (
  path.resolve(process.argv[1]) === here || path.basename(process.argv[1]) === path.basename(here)
)
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}

export default { classify, main }
