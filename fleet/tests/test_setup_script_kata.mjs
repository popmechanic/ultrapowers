/**
 * Exam for task 1 — "The sandbox carries the kata binary".
 *
 * The claim: every sandbox can run `kata` from the moment its first boot
 * finishes, installed the same verified way the hub was. So this file renders
 * `fleet/setup-script.mjs` exactly as `fleet/tests/test_setup_script.mjs` does
 * — `readFleetFiles()` + `renderSetupScript({run, bootstrap, unit})` — and
 * reads the render as bytes.
 *
 * Leg by leg, from the task's own words:
 *
 *   (a) [M1] the rendered script carries the six kata lines verbatim — the two
 *       curls (the release's `SHA256SUMS` and `kata_0.17.2_linux_amd64.tar.gz`
 *       from `https://github.com/kenn-io/kata/releases/download/v0.17.2/`), the
 *       `sha256sum -c` line that checks the tarball against the SHA256SUMS line
 *       naming it, the `tar -tzf … grep -E '(^|/)kata$'` line that finds the
 *       binary's path inside the tarball, the `tar -xzf "$ASSET"` line that
 *       extracts it, and the `sudo -n install -m 0755 … /usr/local/bin/kata`
 *       line that installs it — with their byte offsets strictly increasing in
 *       that order, and the install after `/usr/local/bin/bun` and before
 *       `python3-pytest`. A script that installs before verifying, or before
 *       bun, fails here.
 *   (b) [M1] the render's byte length is at most 10240 — exe.dev's cap on a
 *       `--setup-script` payload — for every run number.
 *   (c) [M2] the setup-script bullet of `fleet/CONTRACT.md`, cut from its
 *       `- **Setup script` line to the next `- **` bullet and joined, matches
 *       `kata 0\.17\.2`. This is the Proof's first `Run:`, done in process so it
 *       needs no `sed`, `tr` or `grep` on the rig's PATH.
 *   (Run) `bash -n fleet/kata-hub-setup.sh` — the hub's own install recipe, the
 *       thing this task copies, still parses; and its lines 22–27 are the six
 *       lines asserted above, so the constants here are the authorization's
 *       spelling and not this exam's invention.
 *
 * Nothing here touches the machine, opens a socket, or runs the render: the
 * only child processes are `bash -n` syntax checks, under `simEnv` like every
 * other sim. `fleet/tests/test_setup_script.mjs` keeps the node, bun and pytest
 * legs and is not edited by this task.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'
import {
  renderSetupScript,
  readFleetFiles,
  SETUP_SCRIPT_MAX_BYTES,
} from '../setup-script.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.join(HERE, '..')
const CONTRACT_FILE = path.join(FLEET, 'CONTRACT.md')
const HUB_SETUP_FILE = path.join(FLEET, 'kata-hub-setup.sh')

// ── the contract's literals (M1, spelled as the task spells them) ─────────────

const RUN = '70'
const RUNS = ['1', RUN, '123456', '999999']
const MAX_BYTES = 10240
const KATA_ASSET = 'kata_0.17.2_linux_amd64.tar.gz'
const KATA_BASE_URL = 'https://github.com/kenn-io/kata/releases/download/v0.17.2/'
const KATA_TARGET = '/usr/local/bin/kata'

const ASSIGN_ASSET = `ASSET=${KATA_ASSET}`
const ASSIGN_BASE = `BASE=${KATA_BASE_URL}`
const CURL_SUMS = 'curl -fsSL -o SHA256SUMS "${BASE}SHA256SUMS"'
const CURL_ASSET = 'curl -fsSL -o "$ASSET" "${BASE}${ASSET}"'
const VERIFY = 'grep " $ASSET$" SHA256SUMS | sha256sum -c -'
const EXTRACT = 'tar -xzf "$ASSET"'
// The one line whose variable name is left to the implementer: M1 asks for the
// binary's path out of the tarball and then `install -m 0755 … /usr/local/bin/
// kata`, so the name is free but the two lines must name the same variable.
const FIND_TAIL = `="$(tar -tzf "$ASSET" | grep -E '(^|/)kata$' | head -n 1)"`
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const FIND_RE = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*)${escape(FIND_TAIL)}$`)
const installLine = (v) => `sudo -n install -m 0755 "$${v}" ${KATA_TARGET}`

const CONTRACT_BULLET_START = /^- \*\*Setup script/
const CONTRACT_BULLET = /^- \*\*/
const CONTRACT_WANTS = /kata 0\.17\.2/

// ── the render under test ────────────────────────────────────────────────────

const files = readFleetFiles()
const render = renderSetupScript({ run: RUN, bootstrap: files.bootstrap, unit: files.unit })
const lines = render.split('\n')

/** Byte offset of the start of each line of the render. */
const lineOffsets = (() => {
  const out = []
  let at = 0
  for (const line of lines) {
    out.push(at)
    at += Buffer.byteLength(line, 'utf8') + 1
  }
  return out
})()

/** The index of the one line satisfying `pred` — two, or none, is a failure. */
function soleLine(pred, what) {
  const hits = []
  for (let i = 0; i < lines.length; i += 1) if (pred(lines[i])) hits.push(i)
  assert.equal(
    hits.length,
    1,
    `the render must carry exactly one ${what}; it carries ${hits.length}` +
      (hits.length > 1 ? `:\n${hits.map((i) => `  ${i + 1}: ${lines[i]}`).join('\n')}` : ''),
  )
  return hits[0]
}

/** The byte offset of that line's first byte. */
const offsetOf = (pred, what) => lineOffsets[soleLine(pred, what)]
const exactly = (text) => (line) => line.trim() === text

// The variable the find line assigns and the install line spends. Read once, so
// every later leg talks about the same pair of lines; `bin` — the hub recipe's
// own name — stands in when the line is absent, so a missing kata block fails
// the legs below as assertions rather than killing this file at load.
const FIND_INDEX = lines.findIndex((l) => FIND_RE.test(l.trim()))
const BIN_VAR = FIND_INDEX >= 0 ? FIND_RE.exec(lines[FIND_INDEX].trim())[1] : 'bin'
const INSTALL = installLine(BIN_VAR)

// The two anchors M1 orders the kata block against, both already in the render.
const BUN_INSTALL = (l) => l.includes('install -m 0755') && /\/usr\/local\/bin\/bun$/.test(l.trim())
const PYTEST = (l) => l.includes('apt-get install') && l.includes('python3-pytest')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-script-kata-'))
const SYNTAX_ENV = simEnv()
let parseNo = 0
function parses(text, label) {
  parseNo += 1
  const file = path.join(tmpRoot, `parse-${parseNo}.sh`)
  fs.writeFileSync(file, text)
  const r = spawnSync('bash', ['-n', file], { encoding: 'utf8', env: SYNTAX_ENV })
  assert.equal(r.status, 0, `bash -n failed for ${label}:\n${r.stderr}`)
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) [M1] the asset, the release URL, and the six lines ───────────────────

test('(a) [M1] the asset name and the release base URL are the pinned ones', () => {
  assert.ok(
    render.includes(KATA_ASSET),
    `the render must name ${KATA_ASSET} — M1's asset`,
  )
  assert.ok(
    render.includes(KATA_BASE_URL),
    `the render must carry ${KATA_BASE_URL} verbatim — M1's release directory`,
  )
  // The six lines below spend `$ASSET` and `${BASE}`, so both are assigned, and
  // assigned the literals M1 names.
  soleLine(exactly(ASSIGN_ASSET), `\`${ASSIGN_ASSET}\` line`)
  soleLine(exactly(ASSIGN_BASE), `\`${ASSIGN_BASE}\` line`)
})

test('(a) [M1] the six kata lines appear verbatim, exactly once each', () => {
  for (const [what, line] of [
    ['the SHA256SUMS curl', CURL_SUMS],
    ['the tarball curl', CURL_ASSET],
    ['the sha256sum -c verify', VERIFY],
    ['the tar -xzf extract', EXTRACT],
    ['the install into /usr/local/bin/kata', INSTALL],
  ]) {
    soleLine(exactly(line), `${what}, spelled \`${line}\``)
  }
  // The sixth: the tar -tzf line that finds the binary's path in the tarball.
  assert.ok(
    FIND_INDEX >= 0,
    `the render must carry a \`…${FIND_TAIL}\` line that finds the kata binary's path`,
  )
  assert.equal(lines[FIND_INDEX].trim(), `${BIN_VAR}${FIND_TAIL}`)
  assert.equal(
    INSTALL,
    `sudo -n install -m 0755 "$${BIN_VAR}" ${KATA_TARGET}`,
    'the install must spend the variable the tar -tzf line assigns',
  )
})

test('(a) [M1] the byte offsets of the six lines strictly increase in M1\'s order', () => {
  const steps = [
    ['ASSET=', exactly(ASSIGN_ASSET)],
    ['BASE=', exactly(ASSIGN_BASE)],
    ['curl SHA256SUMS', exactly(CURL_SUMS)],
    [`curl ${KATA_ASSET}`, exactly(CURL_ASSET)],
    ['sha256sum -c', exactly(VERIFY)],
    [`${BIN_VAR}=$(tar -tzf …)`, (l) => FIND_RE.test(l.trim())],
    ['tar -xzf', exactly(EXTRACT)],
    [`install ${KATA_TARGET}`, exactly(INSTALL)],
  ].map(([label, pred]) => ({ label, at: offsetOf(pred, `\`${label}\` line`) }))

  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(
      steps[i - 1].at < steps[i].at,
      `${steps[i - 1].label} (byte ${steps[i - 1].at}) must come before ` +
        `${steps[i].label} (byte ${steps[i].at}): both curls before the checksum, ` +
        'the checksum before the extract, the extract before the install',
    )
  }
})

test('(a) [M1] the block sits after the bun install and before the pytest apt line', () => {
  const bun = offsetOf(BUN_INSTALL, 'install of /usr/local/bin/bun')
  const pytest = offsetOf(PYTEST, 'apt-get line installing python3-pytest')
  const first = offsetOf(exactly(ASSIGN_ASSET), `\`${ASSIGN_ASSET}\` line`)
  const install = offsetOf(exactly(INSTALL), `install of ${KATA_TARGET}`)

  assert.ok(
    bun < first,
    `the kata block starts at byte ${first}, the bun install at ${bun}: kata comes after bun`,
  )
  assert.ok(
    bun < install,
    `the kata install (byte ${install}) must follow /usr/local/bin/bun (byte ${bun})`,
  )
  assert.ok(
    install < pytest,
    `the kata install (byte ${install}) must precede python3-pytest (byte ${pytest})`,
  )
})

test('(a) [M1] nothing waives the checksum between the verify and the install', () => {
  const from = soleLine(exactly(VERIFY), 'sha256sum -c verify')
  const to = soleLine(exactly(INSTALL), `install of ${KATA_TARGET}`)
  const between = lines.slice(from, to + 1).join('\n')
  assert.ok(!between.includes('set +e'), `errexit stays on across the kata block:\n${between}`)
  assert.ok(!between.includes('|| true'), `no step of the kata block is waived:\n${between}`)
})

// ── (b) [M1] the 10 KiB cap ──────────────────────────────────────────────────

test('(b) [M1] the render is at most 10240 bytes, for every run number', () => {
  assert.equal(SETUP_SCRIPT_MAX_BYTES, MAX_BYTES, "exe.dev's ceiling is 10240 bytes")
  for (const run of RUNS) {
    const text = renderSetupScript({ run, bootstrap: files.bootstrap, unit: files.unit })
    const bytes = Buffer.byteLength(text, 'utf8')
    assert.ok(bytes <= MAX_BYTES, `the render for run=${run} is ${bytes} bytes; the cap is ${MAX_BYTES}`)
  }
})

test('(b) [M1] the render with the kata block still passes bash -n', () => {
  for (const run of RUNS) {
    parses(renderSetupScript({ run, bootstrap: files.bootstrap, unit: files.unit }), `run=${run}`)
  }
})

// ── (c) [M2] the contract bullet ─────────────────────────────────────────────

test('(c) [M2] the setup-script bullet of fleet/CONTRACT.md names kata 0.17.2', () => {
  const contract = fs.readFileSync(CONTRACT_FILE, 'utf8').split('\n')
  const start = contract.findIndex((l) => CONTRACT_BULLET_START.test(l))
  assert.ok(start >= 0, 'fleet/CONTRACT.md must carry a `- **Setup script` bullet')
  // `sed -n '/^- \*\*Setup script/,/^- \*\*/p'`: the range closes on the next
  // `- **` line at or after start + 1, and that closing line is printed too.
  let end = contract.length - 1
  for (let i = start + 1; i < contract.length; i += 1) {
    if (CONTRACT_BULLET.test(contract[i])) { end = i; break }
  }
  const bullet = contract.slice(start, end + 1).join(' ')
  assert.match(
    bullet,
    CONTRACT_WANTS,
    'the setup-script bullet must list kata 0.17.2 beside node, bun and pytest as what ' +
      `the script installs; the bullet read:\n${bullet}`,
  )
  // M2's "beside node, bun and pytest": the same bullet still names the other three.
  for (const tool of ['node 24.20.0', 'bun 1.4.0', 'python3-pytest']) {
    assert.ok(bullet.includes(tool), `the bullet must still name ${tool}`)
  }
})

// ── (Run) the hub recipe this install is copied from ─────────────────────────

test('(Run) bash -n fleet/kata-hub-setup.sh', () => {
  const r = spawnSync('bash', ['-n', HUB_SETUP_FILE], { encoding: 'utf8', env: SYNTAX_ENV })
  assert.equal(r.status, 0, `fleet/kata-hub-setup.sh must parse:\n${r.stderr}`)
})

test('(Run) [M1] the six lines asserted above are the hub recipe\'s own', () => {
  const hub = fs.readFileSync(HUB_SETUP_FILE, 'utf8').split('\n').map((l) => l.trim())
  for (const line of [ASSIGN_ASSET, ASSIGN_BASE, CURL_SUMS, CURL_ASSET, VERIFY, EXTRACT]) {
    assert.ok(
      hub.includes(line),
      `fleet/kata-hub-setup.sh — the authorized recipe — must carry \`${line}\`; ` +
        'if it moved, this exam\'s constants are stale, not the setup script',
    )
  }
  assert.ok(
    hub.some((l) => FIND_RE.test(l)),
    `fleet/kata-hub-setup.sh must carry a \`…${FIND_TAIL}\` line`,
  )
  assert.ok(
    hub.some((l) => /^sudo -n install -m 0755 "\$[A-Za-z_][A-Za-z0-9_]*" \/usr\/local\/bin\/kata$/.test(l)),
    `fleet/kata-hub-setup.sh must install into ${KATA_TARGET} with \`sudo -n install -m 0755\``,
  )
})

// ── run ──────────────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of tests) {
  const started = Date.now()
  try {
    await fn()
    console.log(`ok (${Date.now() - started} ms) — ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL — ${name}`)
    console.log(String(error && error.stack ? error.stack : error))
  }
}
fs.rmSync(tmpRoot, { recursive: true, force: true })
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
