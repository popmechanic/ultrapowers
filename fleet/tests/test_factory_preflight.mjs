import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const FACTORY_DIR = path.join(REPO_ROOT, 'factory')
const PREFLIGHT = path.join(FACTORY_DIR, 'preflight.mjs')

function writeStub (dir, name, content) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  fs.chmodSync(p, 0o755)
}

async function runAsync (argv, { bin, home } = {}) {
  const child = spawn(process.execPath, argv, {
    env: simEnv({ bin, home }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const code = await new Promise((resolve) => child.on('close', resolve))
  return { code, stdout, stderr }
}

let usageAnswer = { code: 200, body: '{}' }

const proxyServer = http.createServer((req, res) => {
  if (req.url === '/api/oauth/usage') {
    res.writeHead(usageAnswer.code, { 'Content-Type': 'application/json' })
    res.end(usageAnswer.body)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})
await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
const PROXY_URL = `http://127.0.0.1:${proxyServer.address().port}`

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-m1-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })

  const authFile = path.join(home, 'auth.txt')
  writeStub(bin, 'claude', `#!/bin/sh\ncat "${authFile}"\n`)

  const CASES = [
    {
      label: 'oauth_token + usage 200',
      auth: 'authMethod: oauth_token',
      usage: { code: 200, body: '{}' },
      expected: 'alive\n',
    },
    {
      label: 'api_key',
      auth: 'authMethod: api_key',
      usage: { code: 200, body: '{}' },
      expected: 'api_key\n',
    },
    {
      label: 'neither word',
      auth: 'authMethod: none',
      usage: { code: 200, body: '{}' },
      expected: 'no_oauth\n',
    },
    {
      label: 'oauth_token + usage 403 oauth_scope_insufficient',
      auth: 'authMethod: oauth_token',
      usage: { code: 403, body: '{"type":"error","error":{"type":"oauth_scope_insufficient"}}' },
      expected: 'inconclusive\n',
    },
    {
      label: 'oauth_token + usage 500',
      auth: 'authMethod: oauth_token',
      usage: { code: 500, body: 'internal error' },
      expected: 'inconclusive\n',
    },
    {
      label: 'oauth_token + usage 401 JSON "type":"error" carrying message "revoked"',
      auth: 'authMethod: oauth_token',
      usage: { code: 401, body: '{"type":"error","error":{"type":"authentication_error","message":"revoked"}}' },
      expected: 'bearer_dead 401 revoked\n',
    },
    {
      label: 'oauth_token + usage 401 plain body starting "integration not found"',
      auth: 'authMethod: oauth_token',
      usage: { code: 401, body: 'integration not found: claude-max\ntrace 1' },
      expected: 'edge_refused 401 integration not found: claude-max\n',
    },
  ]

  for (const c of CASES) {
    fs.writeFileSync(authFile, c.auth)
    usageAnswer = c.usage
    const res = await runAsync([PREFLIGHT, '--proxy', PROXY_URL], { bin, home })
    assert.equal(
      res.code, 0,
      `(a) [M1] ${c.label}: preflight.mjs exits 0 — got ${res.code}, stderr: ${res.stderr}`
    )
    assert.equal(
      res.stdout, c.expected,
      `(a) [M1] ${c.label}: preflight.mjs prints exactly ${JSON.stringify(c.expected)} — got ${JSON.stringify(res.stdout)}`
    )
  }
}

{
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-link-'))
  const D = path.join(linkRoot, 'D')
  fs.mkdirSync(D, { recursive: true })
  fs.symlinkSync(FACTORY_DIR, path.join(D, 'factory'), 'dir')

  {
    const preflightHome = path.join(linkRoot, 'preflight-home')
    const preflightBin = path.join(linkRoot, 'preflight-bin')
    fs.mkdirSync(preflightHome, { recursive: true })
    fs.mkdirSync(preflightBin, { recursive: true })

    const authFile = path.join(preflightHome, 'auth.txt')
    writeStub(preflightBin, 'claude', `#!/bin/sh\ncat "${authFile}"\n`)
    fs.writeFileSync(authFile, 'authMethod: oauth_token')
    usageAnswer = { code: 200, body: '{}' }

    const res = await runAsync(
      [path.join(D, 'factory', 'preflight.mjs'), '--proxy', PROXY_URL],
      { bin: preflightBin, home: preflightHome }
    )

    assert.equal(
      res.code, 0,
      `(c) [M3] preflight.mjs invoked as <D>/factory/preflight.mjs through the symlink exits 0 — got ${res.code}, stderr: ${res.stderr}`
    )
    assert.equal(
      res.stdout, 'alive\n',
      `(c) [M3] preflight.mjs through the symlink, with oauth_token and a 200 usage answer, prints exactly 'alive\\n' — got ${JSON.stringify(res.stdout)}`
    )
  }
}

proxyServer.close()

console.log('ALL TESTS PASSED')
