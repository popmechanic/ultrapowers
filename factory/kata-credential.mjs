#!/usr/bin/env node
// factory/kata-credential.mjs — Kata's `credential_provider` helper (#983).
//
// Kata 0.18 lets a spoke's `config.toml` name a program to run, without a
// shell, handing it one UTF-8 JSON object on stdin and reading one back from
// stdout. Kata itself mints the candidate token and saves it; this helper's
// only job is to get that exact token APPROVED on the hub and to say so — it
// never mints, reads back or echoes a token anywhere.
//
// On the sandbox the hub's administration API is `https://kata.int.exe.xyz`,
// where the exe.dev edge injects the hub's own admin bearer for VMs tagged
// `fleet`. That edge is the authority: this helper holds no credential of its
// own and sends no `authorization` header on either admin call. The token
// travels in the enrollment body instead — `POST .../federation/enrollments`
// accepts a caller-supplied `token`, so the candidate token rides there, once,
// and never touches this process's stdout, stderr or the state file it keeps.
//
// Exit codes, per the Context: 0 is a valid response (including a denial or
// an unavailable hub), 2 is invalid input (bad stdin, wrong version, unknown
// operation — nothing is printed), 1 is unused here (every failure mode this
// helper meets is modeled as a valid `unavailable`/`conflict`/`denied` answer
// instead of a hard failure).

import fs from 'node:fs'
import path from 'node:path'

// ── argv ─────────────────────────────────────────────────────────────────
function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--kata-json') out.kataJson = argv[++i]
    else if (a === '--admin-url') out.adminUrl = argv[++i]
    else if (a === '--state-dir') out.stateDir = argv[++i]
  }
  return out
}

// ── stdin ────────────────────────────────────────────────────────────────
function readStdin () {
  return new Promise((resolve) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', () => resolve(''))
  })
}

const KNOWN_OPERATIONS = new Set(['authorize', 'release'])

/** Parses stdin into a request object, or returns null for anything that is
 *  not one JSON object with `version` 1 and a known `operation` — the M3
 *  "print nothing, exit 2" case. */
function parseRequest (raw) {
  let doc
  try { doc = JSON.parse(raw) } catch { return null }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  if (doc.version !== 1) return null
  if (typeof doc.operation !== 'string' || !KNOWN_OPERATIONS.has(doc.operation)) return null
  return doc
}

function stateFile (stateDir, requestId) {
  return path.join(stateDir, requestId + '.json')
}

/** A POST to `<adminUrl><route>` with a JSON body — no `authorization`
 *  header, ever; the edge is the only authority this helper trusts. Resolves
 *  to `{ ok, status, body }` on any reachable answer, or `{ ok: false,
 *  status: null, body: null }` on a connection failure — never throws. */
async function postJson (adminUrl, route, body) {
  try {
    const res = await globalThis.fetch(adminUrl + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const text = await res.text()
    let parsed = null
    if (text) { try { parsed = JSON.parse(text) } catch { parsed = null } }
    return { ok: res.ok, status: res.status, body: parsed }
  } catch {
    return { ok: false, status: null, body: null }
  }
}

const CAPABILITIES = 'claim,pull,push'

async function authorize (req, { kata, adminUrl, stateDir }) {
  if (req.intent !== 'collaborate') {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'denied' }
  }

  const projectId = kata.project.id
  const projectUid = kata.project.uid

  const enableResp = await postJson(
    adminUrl, '/api/v1/projects/' + projectId + '/federation/enable', {},
  )
  if (enableResp.status === null) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'unavailable' }
  }
  if (enableResp.status === 409) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'conflict' }
  }
  if (!enableResp.ok) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'unavailable' }
  }

  const enrollResp = await postJson(adminUrl, '/api/v1/federation/enrollments', {
    project_id: projectId,
    spoke_instance_uid: req.spoke_instance_uid,
    capabilities: CAPABILITIES,
    actor: 'factory',
    token: req.candidate_token,
  })
  if (enrollResp.status === null) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'unavailable' }
  }
  if (enrollResp.status === 409) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'conflict' }
  }
  if (!enrollResp.ok) {
    return { version: 1, operation: 'authorize', request_id: req.request_id, status: 'unavailable' }
  }

  const enrollmentBody = enrollResp.body && typeof enrollResp.body === 'object' ? enrollResp.body : {}
  const enrollmentId = (enrollmentBody.enrollment && enrollmentBody.enrollment.id !== undefined)
    ? enrollmentBody.enrollment.id
    : enrollmentBody.id

  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(
    stateFile(stateDir, req.request_id),
    JSON.stringify({ enrollment_id: enrollmentId, project_id: projectId }),
  )

  return {
    version: 1,
    operation: 'authorize',
    request_id: req.request_id,
    status: 'ready',
    hub_url: req.hub_url,
    project_id: projectId,
    enrollment_id: enrollmentId,
    project_uid: projectUid,
    actor: 'factory',
    capabilities: CAPABILITIES,
  }
}

async function release (req, { adminUrl, stateDir }) {
  const file = stateFile(stateDir, req.request_id)
  let saved = null
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    saved = null
  }

  if (!saved) {
    return { version: 1, operation: 'release', request_id: req.request_id, status: 'released' }
  }

  const revokeResp = await postJson(
    adminUrl, '/api/v1/federation/enrollments/' + saved.enrollment_id + '/revoke', {},
  )
  const status = revokeResp.ok ? 'released' : 'unavailable'
  return { version: 1, operation: 'release', request_id: req.request_id, status }
}

async function main () {
  const { kataJson, adminUrl, stateDir } = parseArgs(process.argv.slice(2))
  const raw = await readStdin()
  const req = parseRequest(raw)
  if (!req) {
    process.exitCode = 2
    return
  }

  const kata = JSON.parse(fs.readFileSync(kataJson, 'utf8'))

  let answer
  if (req.operation === 'authorize') {
    answer = await authorize(req, { kata, adminUrl, stateDir })
  } else {
    answer = await release(req, { adminUrl, stateDir })
  }

  process.stdout.write(JSON.stringify(answer))
  process.exitCode = 0
}

main()
