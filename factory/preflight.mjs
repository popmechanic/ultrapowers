import { spawnSync } from 'node:child_process'

const USAGE_PATH = '/api/oauth/usage'
const USAGE_TIMEOUT_MS = 20000

function firstMessage (text) {
  const m = /"message"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text || '')
  if (!m) return ''
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

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

function authStatus (proxy) {
  const res = spawnSync('claude', ['auth', 'status'], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_BASE_URL: proxy, CLAUDE_CODE_OAUTH_TOKEN: 'placeholder' }
  })
  if (!res) return ''
  return (res.stdout || '') + (res.stderr || '')
}

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

if (import.meta.main) { main(process.argv.slice(2)).then((code) => { process.exitCode = code }) }

export default { classify, main }
