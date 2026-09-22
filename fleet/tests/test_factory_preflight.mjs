/**
 * fleet/tests/test_factory_preflight.mjs — the exam for "The boot's
 * credential probe is `factory/preflight.mjs`'s ... a run driven end to end
 * against stubs ..." (the preflight half): `factory/preflight.mjs` is a
 * small CLI that asks `claude auth status` and, when that is inconclusive, one
 * `GET <proxy>/api/oauth/usage`, and prints exactly one classification line —
 * never a decision. This file drives it as the CLI the boot actually calls:
 * `node factory/preflight.mjs --proxy <url>`.
 *
 * The Machine clause under test, restated (M1): for six answers the module
 * can give — `alive`, `api_key`, `no_oauth`, `inconclusive` (reached two
 * distinct ways), `bearer_dead <status> <message>` and
 * `edge_refused <status> <first line>` — the CLI prints exactly one line
 * (the classification) and exits 0.
 *
 * Each of the seven cases below drives one of the concrete conditions the
 * Machine clause spells out for those six answers (the `inconclusive` answer
 * is reached by two of the seven: a 403 carrying `oauth_scope_insufficient`,
 * and a bare 500), in the order M1 lists them and in the order the Proof's
 * leg (a) lists them. Every case is its own leg, each asserting `stdout` is
 * byte-equal to the expected line plus `\n` and the exit code is 0 — the
 * whole Proof leg (a) in one file.
 *
 * The rig: a `claude` stub under a `bin` directory (first on the child's
 * `PATH`, mode 0755) whose output each case writes to a file first and the
 * stub `cat`s — `claude auth status`'s stdout+stderr, joined, is exactly
 * what a case controls. A real `node:http` server on `127.0.0.1` (port `0`)
 * stands in for the proxy's `/api/oauth/usage` endpoint, answering whatever
 * status and body the case sets; its ephemeral `127.0.0.1` URL is passed as
 * `--proxy`. `node`, `python3`, `git`, `bash` are real (only `claude` is
 * stubbed), and every spawn's `env` is `simEnv({ bin, home, env })` from
 * `./_helpers.mjs`.
 *
 * What this exam assumes about `factory/preflight.mjs`, since it is the one
 * piece of context a later reader lacks: it resolves `claude` on `PATH` (so
 * the stub is found), it reads the base URL from the `--proxy` argv value
 * (not an env var), and it makes at most one `GET .../api/oauth/usage`
 * request per run — cases 2 and 3 (`api_key`, `no_oauth`) never need the
 * server to be reachable in the way the two `inconclusive`/`bearer_dead`/
 * `edge_refused` cases do, so the server is left running with an innocuous
 * default answer throughout and only its `status`/`body` are changed
 * between cases that do reach it.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PREFLIGHT_PATH = path.resolve(HERE, '../../factory/preflight.mjs')

// ── the rig ──────────────────────────────────────────────────────────────

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-bin-'))
const claudeStub = path.join(binDir, 'claude')
fs.writeFileSync(claudeStub, '#!/bin/sh\ncat "$CLAUDE_OUTPUT_FILE"\n')
fs.chmodSync(claudeStub, 0o755)

const usageAnswer = { status: 200, body: '{}' }
const server = http.createServer((_req, res) => {
  res.writeHead(usageAnswer.status, { 'Content-Type': 'application/json' })
  res.end(usageAnswer.body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const proxyUrl = `http://127.0.0.1:${port}`

/** Run `node factory/preflight.mjs --proxy <proxyUrl>` with `claude`
 *  answering `claudeText` and the usage endpoint answering `answer`;
 *  assert the printed classification and exit code. */
function runCase (label, claudeText, answer, expectedLine) {
  usageAnswer.status = answer.status
  usageAnswer.body = answer.body
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-case-'))
  const outFile = path.join(workDir, 'claude-output.txt')
  fs.writeFileSync(outFile, claudeText)
  const res = spawnSync('node', [PREFLIGHT_PATH, '--proxy', proxyUrl], {
    encoding: 'utf8',
    env: simEnv({ bin: binDir, home: workDir, env: { CLAUDE_OUTPUT_FILE: outFile } })
  })
  assert.equal(
    res.status, 0,
    `${label}: exits 0 — got status ${res.status}, stderr: ${res.stderr}`
  )
  assert.equal(
    res.stdout, `${expectedLine}\n`,
    `${label}: stdout is byte-equal to "${expectedLine}\\n" — got ${JSON.stringify(res.stdout)}`
  )
}

// ── (a) [M1] the seven concrete conditions, in the Machine's own order ────

runCase(
  '(a) [M1] oauth_token + usage 200 -> alive',
  'authMethod: oauth_token\napiProvider: firstParty\n',
  { status: 200, body: '{}' },
  'alive'
)

runCase(
  '(a) [M1] claude auth status prints api_key -> api_key',
  'authMethod: api_key\n',
  { status: 200, body: '{}' },
  'api_key'
)

runCase(
  '(a) [M1] claude auth status prints neither word -> no_oauth',
  'authMethod: none\nnot logged in\n',
  { status: 200, body: '{}' },
  'no_oauth'
)

runCase(
  '(a) [M1] usage 403 with oauth_scope_insufficient -> inconclusive',
  'authMethod: oauth_token\n',
  { status: 403, body: '{"type":"error","error":{"message":"forbidden"},"code":"oauth_scope_insufficient"}' },
  'inconclusive'
)

runCase(
  '(a) [M1] usage 500 -> inconclusive',
  'authMethod: oauth_token\n',
  { status: 500, body: 'Internal Server Error' },
  'inconclusive'
)

runCase(
  '(a) [M1] usage 401 with a "type":"error" JSON body carrying message revoked -> bearer_dead',
  'authMethod: oauth_token\n',
  { status: 401, body: '{"type":"error","message":"revoked"}' },
  'bearer_dead 401 revoked'
)

runCase(
  '(a) [M1] usage 401 with a plain body starting "integration not found" -> edge_refused',
  'authMethod: oauth_token\n',
  { status: 401, body: 'integration not found: no route for host stub.invalid\nsecond line\n' },
  'edge_refused 401 integration not found: no route for host stub.invalid'
)

await new Promise((resolve) => server.close(resolve))

console.log('ALL TESTS PASSED')
