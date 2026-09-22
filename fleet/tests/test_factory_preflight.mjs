/**
 * fleet/tests/test_factory_preflight.mjs — the exam for "the credential probe
 * answers each of the six things the edge can say with one exact line,
 * examined by a rig that can answer it; and the probe and the audit each run
 * when called through a symlinked `factory/`, where before the audit
 * silently did nothing."
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `node factory/preflight.mjs --proxy <U>` prints exactly one of
 *       the six lines the edge can say and exits 0 — `alive` (oauth_token +
 *       usage 200), `api_key`, `no_oauth` (neither word), `inconclusive`
 *       (usage 403 with `oauth_scope_insufficient`, and again over 500),
 *       `bearer_dead 401 <message>` (a 401 with a `"type":"error"` JSON body
 *       carrying a `message`), and `edge_refused 401 <first line>` (a 401
 *       with a plain body starting `integration not found`).
 *   (b) [M2] `node <D>/factory/audit.mjs <events> done`, through a
 *       symlinked `<D>/factory`, prints exactly one line parsing to an
 *       object whose `kind` is `run:audit`, `state` is `done` and `ts` is a
 *       non-empty string, and exits 0.
 *   (c) [M3] `node <D>/factory/preflight.mjs --proxy <U>`, through the same
 *       link, with an `oauth_token` auth answer and a 200 usage answer,
 *       prints exactly `alive\n` and exits 0.
 *
 * M4 is the Proof's `Run:` lines against the modules' own text, not
 * something a running exam observes — this file does not touch it.
 *
 * The rig: one `node:http` server on `127.0.0.1` port `0`, in this process,
 * answers `/api/oauth/usage` with whatever `{ code, body }` the current case
 * set (mutated between cases, since every case is awaited to completion
 * before the next one runs — no two cases are ever in flight together). The
 * `claude` stub is a `#!/bin/sh` script, mode `0755`, first on the child's
 * `PATH`, that `cat`s an `auth.txt` file the case writes ahead of the run
 * with one of `authMethod: oauth_token`, `authMethod: api_key` or
 * `authMethod: none`. Every child — `preflight.mjs` and `audit.mjs` alike —
 * is driven by `runAsync`, which `spawn`s (never `spawnSync`, which would
 * block the event loop the proxy stub server runs on) and awaits the close
 * event, `env: simEnv({ bin, home })` throughout. Every directory this file
 * writes into sits under a fresh `fs.mkdtempSync` under `os.tmpdir()`; no
 * string-literal absolute path appears anywhere below.
 *
 * What this exam assumes about the modules under test: that `classify`'s
 * decision is reachable only through the CLI's one printed line (the
 * Machine clause and the "For the examiner" note both drive it that way,
 * never by importing `classify` in-process); that `preflight.mjs`'s `main`
 * takes the argv already sliced past the node/script pair, so spawning it
 * with `[PREFLIGHT, '--proxy', url]` as the child's own argv is the same
 * call `factory/boot.sh` makes; and that `audit.mjs`'s `main` slices
 * `process.argv` itself, so spawning it with `[AUDIT, eventsPath, 'done']`
 * is likewise the direct call. Neither assumption reaches past what the
 * task's own Context and "For the examiner" section already state.
 */

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

/** Writes an executable `#!/bin/sh` stub into `dir/name`. */
function writeStub (dir, name, content) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  fs.chmodSync(p, 0o755)
}

/** Runs `node <argv[0]> ...argv.slice(1)` as a real child, asynchronously —
 *  the whole reason this rig exists rather than `spawnSync`: the in-process
 *  proxy stub server below can only answer a child that does not block this
 *  event loop. Resolves once the child's `close` event fires. */
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

// ── the in-process proxy stub ────────────────────────────────────────────

/** The `/api/oauth/usage` answer the current case wants; mutated between
 *  cases, each of which is awaited to completion before the next mutates it. */
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

// ── (a) [M1] the six answers the edge can give ───────────────────────────

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-m1-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })

  const authFile = path.join(home, 'auth.txt')
  // The stub `cat`s whatever the case last wrote to authFile — written once,
  // reused across every case below, since the cases run strictly in turn.
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

// ── (b), (c) [M2, M3] both entry guards through a symlinked factory/ ────

{
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-link-'))
  const D = path.join(linkRoot, 'D')
  fs.mkdirSync(D, { recursive: true })
  fs.symlinkSync(FACTORY_DIR, path.join(D, 'factory'), 'dir')

  // "<D>/../ev.jsonl" — one row, exactly.
  const eventsPath = path.join(D, '..', 'ev.jsonl')
  fs.writeFileSync(eventsPath, `${JSON.stringify({ kind: 'landing', task: 1 })}\n`)

  // ── (b) [M2] audit.mjs through the link ──────────────────────────────
  {
    const auditHome = path.join(linkRoot, 'audit-home')
    fs.mkdirSync(auditHome, { recursive: true })

    const res = await runAsync(
      [path.join(D, 'factory', 'audit.mjs'), eventsPath, 'done'],
      { home: auditHome }
    )

    assert.equal(
      res.code, 0,
      `(b) [M2] audit.mjs invoked as <D>/factory/audit.mjs through the symlink exits 0 — got ${res.code}, stderr: ${res.stderr}`
    )
    const trimmed = res.stdout.trim()
    assert.ok(
      trimmed.length > 0,
      '(b) [M2] audit.mjs through the symlink prints a non-empty line — before the fix, main() never ran and nothing was printed'
    )
    const outLines = trimmed.split('\n')
    assert.equal(
      outLines.length, 1,
      `(b) [M2] audit.mjs through the symlink prints exactly one line — got ${outLines.length}: ${JSON.stringify(trimmed)}`
    )
    const parsed = JSON.parse(outLines[0])
    assert.equal(parsed.kind, 'run:audit', `(b) [M2] the line's kind is run:audit — got ${JSON.stringify(parsed.kind)}`)
    assert.equal(parsed.state, 'done', `(b) [M2] the line's state is done — got ${JSON.stringify(parsed.state)}`)
    assert.ok(
      typeof parsed.ts === 'string' && parsed.ts.length > 0,
      `(b) [M2] the line's ts is a non-empty string — got ${JSON.stringify(parsed.ts)}`
    )
  }

  // ── (c) [M3] preflight.mjs through the link ──────────────────────────
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
