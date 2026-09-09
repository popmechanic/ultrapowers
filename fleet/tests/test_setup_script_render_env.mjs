/**
 * Exam for `fleet/setup-script.mjs` — the renderer address the setup script
 * leaves where boot will find it.
 *
 * What it proves, leg by leg:
 *
 *  (a) [M1] rendered with `render = {integration, account}`, one line of the
 *      script is exactly the `TINYAPP_RENDER_URL=` address, it is the whole body
 *      of a quoted `FLEET_RENDER_EOF` heredoc, and a later line installs that
 *      same file with `sudo -n install -D -m 0644` at `/etc/fleet/render.env`,
 *      before the `systemctl --user start` line.
 *  (f) [M1] that fragment, run by bash in a temp directory with `sudo` a shell
 *      function that redirects every `/etc/fleet` operand under `$TMP`, really
 *      leaves the address in the installed file — the script carries the bytes,
 *      it does not merely mention them.
 *  (b) [M1] the render fits `SETUP_SCRIPT_MAX_BYTES` and parses under `bash -n`.
 *  (c) [M2] with `render` omitted and with `render: null` the two renders are
 *      byte-identical and say nothing of `render.env`, `TINYAPP_RENDER_URL` or
 *      `/etc/fleet`.
 *  (d) [M3] a bad `integration` and a bad `account` each throw naming the key
 *      they object to, and the renderer returns no string at all — so neither
 *      bad value can have reached any script text.
 *  (e) [M1, M2] what the setup script already was is unchanged: the run literal
 *      first, the self-delete last, no `--env`, inside the cap — and the
 *      existing sim `test_setup_script.mjs` still prints its sentinel.
 *
 * Nothing here touches the machine: no real `sudo` runs (leg (f) shadows it with
 * a function), no socket is opened, and every byte written lands under one
 * `mkdtemp` root that the exam removes on its way out.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderSetupScript, readFleetFiles, SETUP_SCRIPT_MAX_BYTES } from '../setup-script.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SIBLING_SIM = path.join(HERE, 'test_setup_script.mjs')

// ── the contract's literals ──────────────────────────────────────────────────

const RUN = '70'
const RENDER = { integration: 'browser-run', account: 'abc123' }
// M1's address for that pair, spelled out: the proxy at exe.dev's edge.
const URL_LINE =
  'TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering'
const TAG = 'FLEET_RENDER_EOF'
const CAT_LINE = /^\s*cat <<'FLEET_RENDER_EOF' >(.+)$/
const INSTALL = 'sudo -n install -D -m 0644'
const DEST = '/etc/fleet/render.env'
const START = 'systemctl --user start'
const SELF_DELETE = 'sudo -n rm -f -- "$0"'
const SILENT_WITHOUT_RENDER = ['render.env', 'TINYAPP_RENDER_URL', '/etc/fleet']

// M3's two shapes, and the two values the Proof pins against them.
const BAD_INTEGRATION = 'Bad Name'
const BAD_ACCOUNT = 'abc/../def'

// ── the renders under test ───────────────────────────────────────────────────

const files = readFleetFiles()
const render = renderSetupScript({ run: RUN, bootstrap: files.bootstrap, unit: files.unit, render: RENDER })
const lines = render.split('\n')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-render-env-'))
let caseNo = 0
const tmpDir = () => {
  caseNo += 1
  const dir = path.join(tmpRoot, `c${caseNo}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const isExecutable = (line) => line.trim() !== '' && !line.trim().startsWith('#')
// A path operand as the script spells it, minus the quoting that does not
// change which file it names.
const unquote = (s) => {
  const t = s.trim()
  const bare = /^(['"])(.*)\1$/.exec(t)
  return bare ? bare[2] : t
}

/**
 * The three indices leg (a) asks for: the heredoc's opening line (with the path
 * it writes), the closing delimiter, and the install that carries it away.
 */
function locate() {
  const cat = lines.findIndex((l) => CAT_LINE.test(l))
  assert.ok(
    cat >= 0,
    `the render must open a quoted heredoc with a line matching ${CAT_LINE}; ` +
      'no line of it does',
  )
  const source = unquote(CAT_LINE.exec(lines[cat])[1])
  assert.ok(source !== '', `the heredoc must name a path to write: ${lines[cat]}`)

  const close = lines.findIndex((l, i) => i > cat && l.trim() === TAG)
  assert.ok(close > cat, `the ${TAG} heredoc is never closed`)

  const install = lines.findIndex((l, i) => i > close && l.includes(INSTALL))
  assert.ok(
    install > close,
    `no line after the heredoc contains ${JSON.stringify(INSTALL)}`,
  )
  return { cat, close, install, source }
}

// ── (a) [M1] the address, the heredoc around it, and the install after it ────

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('(a) [M1] one line of the render is exactly the renderer address', () => {
  const hits = lines.filter((l) => l === URL_LINE)
  assert.equal(
    hits.length,
    1,
    `exactly one line must be ${JSON.stringify(URL_LINE)}; found ${hits.length}`,
  )
})

test('(a) [M1] the address is the whole body of the quoted FLEET_RENDER_EOF heredoc', () => {
  const { cat, close } = locate()
  assert.deepEqual(
    lines.slice(cat + 1, close),
    [URL_LINE],
    'the heredoc body is the single address line, and nothing else',
  )
})

test('(a) [M1] the install carries that same file to /etc/fleet/render.env', () => {
  const { install, source } = locate()
  const line = lines[install]
  assert.ok(line.includes(INSTALL), `the install line must contain ${JSON.stringify(INSTALL)}: ${line}`)
  assert.ok(line.trimEnd().endsWith(DEST), `the install line must end with ${DEST}: ${line}`)

  const argv = line.trim().split(/\s+/)
  const src = unquote(argv[argv.length - 2])
  assert.equal(
    src,
    source,
    `the install's source operand must be the file the heredoc wrote (${source}): ${line}`,
  )
})

test('(a) [M1] both the heredoc and the install come before the unit start', () => {
  const { cat, install } = locate()
  const start = lines.findIndex((l) => l.includes(START))
  assert.ok(start >= 0, `the render must carry a \`${START}\` line`)
  assert.ok(cat < start, `the heredoc (line ${cat}) must precede the start (line ${start})`)
  assert.ok(install < start, `the install (line ${install}) must precede the start (line ${start})`)
})

test('(a) [M1] a second integration/account pair renders its own address', () => {
  const other = renderSetupScript({
    run: RUN,
    bootstrap: files.bootstrap,
    unit: files.unit,
    render: { integration: 'b', account: 'A_b-9' },
  })
  assert.ok(
    other.split('\n').includes(
      'TINYAPP_RENDER_URL=https://b.int.exe.xyz/client/v4/accounts/A_b-9/browser-rendering',
    ),
    'the address is built from the pair it was handed, not from one baked-in pair',
  )
})

// ── (f) [M1] the fragment really installs the address ────────────────────────

test('(f) [M1] running the heredoc and its install leaves the address in the installed file', () => {
  const { cat, install } = locate()
  const fragment = lines.slice(cat, install + 1).join('\n')
  const tmp = tmpDir()
  const harness = path.join(tmpRoot, `fragment-${caseNo}.sh`)

  // `sudo` is a function, so nothing privileged runs and every /etc/fleet
  // operand is redirected under $TMP. `status` is the script's own reporter,
  // stubbed to a no-op so a stray call cannot masquerade as a missing install.
  fs.writeFileSync(harness, [
    '#!/usr/bin/env bash',
    'set -eo pipefail',
    'sudo() {',
    '  while [ $# -gt 0 ]; do',
    '    case "$1" in -n|-E|-H|-S|-k) shift ;; *) break ;; esac',
    '  done',
    '  argv=()',
    '  for a in "$@"; do',
    '    case "$a" in',
    '      /etc/fleet*) argv+=("$TMP$a") ;;',
    '      *) argv+=("$a") ;;',
    '    esac',
    '  done',
    '  "${argv[@]}"',
    '}',
    'status() { :; }',
    'HOME="$TMP/home"; mkdir -p "$HOME"',
    'work="$TMP"',
    'LIB="$TMP/lib"',
    'cd "$TMP"',
    fragment,
    '',
  ].join('\n'))

  const r = spawnSync('bash', [harness], {
    encoding: 'utf8',
    env: { ...process.env, TMP: tmp, HOME: path.join(tmp, 'home') },
  })
  assert.equal(r.status, 0, `the fragment must run:\n${r.stderr}`)

  const installed = path.join(tmp, 'etc', 'fleet', 'render.env')
  assert.ok(fs.existsSync(installed), `${installed} was never installed`)
  assert.equal(
    fs.readFileSync(installed, 'utf8'),
    `${URL_LINE}\n`,
    'the installed file is the address and one newline, exactly',
  )
})

// ── (b) [M1] the budget and the syntax ───────────────────────────────────────

test('(b) [M1] the render with a renderer fits SETUP_SCRIPT_MAX_BYTES', () => {
  const bytes = Buffer.byteLength(render, 'utf8')
  assert.ok(
    bytes <= SETUP_SCRIPT_MAX_BYTES,
    `${bytes} bytes; the ceiling is ${SETUP_SCRIPT_MAX_BYTES}`,
  )
})

test('(b) [M1] the render with a renderer passes bash -n', () => {
  const file = path.join(tmpRoot, 'with-render.sh')
  fs.writeFileSync(file, render)
  const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' })
  assert.equal(r.status, 0, `bash -n failed on the render:\n${r.stderr}`)
})

// ── (c) [M2] without a renderer, the script it was before ────────────────────

test('(c) [M2] omitting `render` and passing null render the same bytes', () => {
  const omitted = renderSetupScript({ run: RUN, bootstrap: files.bootstrap, unit: files.unit })
  const nulled = renderSetupScript({
    run: RUN,
    bootstrap: files.bootstrap,
    unit: files.unit,
    render: null,
  })
  assert.equal(nulled, omitted, '`render: null` must render exactly what omitting the key renders')
})

test('(c) [M2] a render without a renderer says nothing about one', () => {
  const omitted = renderSetupScript({ run: RUN, bootstrap: files.bootstrap, unit: files.unit })
  const nulled = renderSetupScript({
    run: RUN,
    bootstrap: files.bootstrap,
    unit: files.unit,
    render: null,
  })
  for (const needle of SILENT_WITHOUT_RENDER) {
    assert.ok(!omitted.includes(needle), `the render without a renderer must not contain ${needle}`)
    assert.ok(!nulled.includes(needle), `the null render must not contain ${needle}`)
  }
})

// ── (d) [M3] the two bad values are refused, and nothing is returned ─────────

// Every string the renderer ever handed back during leg (d), so the leg can say
// the bad values reached no script text because there was no script text.
const returned = []
function attempt(render_) {
  const out = renderSetupScript({
    run: RUN,
    bootstrap: files.bootstrap,
    unit: files.unit,
    render: render_,
  })
  returned.push(out)
  return out
}

test('(d) [M3] a bad integration throws with a message naming `integration`', () => {
  assert.throws(
    () => attempt({ integration: BAD_INTEGRATION, account: 'abc123' }),
    /integration/,
    `${JSON.stringify(BAD_INTEGRATION)} does not match ^[a-z][a-z0-9-]*$ and must be refused by name`,
  )
})

test('(d) [M3] a bad account throws with a message naming `account`', () => {
  assert.throws(
    () => attempt({ integration: 'browser-run', account: BAD_ACCOUNT }),
    /account/,
    `${JSON.stringify(BAD_ACCOUNT)} does not match ^[A-Za-z0-9_-]+$ and must be refused by name`,
  )
})

test('(d) [M3] every other value outside the two shapes is refused too', () => {
  const badIntegrations = ['Browser-Run', 'browser_run', '9lead', '-lead', '', 'a b']
  const badAccounts = ['abc def', 'abc.def', '', 'a/b']
  for (const integration of badIntegrations) {
    assert.throws(
      () => attempt({ integration, account: 'abc123' }),
      /integration/,
      `integration ${JSON.stringify(integration)} must be refused`,
    )
  }
  for (const account of badAccounts) {
    assert.throws(
      () => attempt({ integration: 'browser-run', account }),
      /account/,
      `account ${JSON.stringify(account)} must be refused`,
    )
  }
})

test('(d) [M3] the refusals came before any script text, so no bad value is in one', () => {
  assert.equal(
    returned.length,
    0,
    `a rejected renderer must build no script text at all; ${returned.length} render(s) came back`,
  )
  const built = returned.join('\n')
  assert.ok(!built.includes(BAD_INTEGRATION), `${BAD_INTEGRATION} reached a render`)
  assert.ok(!built.includes(BAD_ACCOUNT), `${BAD_ACCOUNT} reached a render`)
})

// ── (e) [M1, M2] the script it already was ───────────────────────────────────

test('(e) [M1] the run literal is still the first executable line, and no --env exists', () => {
  const set = lines.findIndex((l) => l.trim() === 'set -euo pipefail')
  assert.ok(set >= 0, 'the render must carry a bare `set -euo pipefail` line')
  const next = lines.findIndex((l, i) => i > set && isExecutable(l))
  assert.ok(next >= 0, 'nothing follows `set -euo pipefail`')
  assert.equal(lines[next].trim(), `RUN=${RUN}`)
  assert.ok(!render.includes('--env'), '--env must appear nowhere')
  assert.ok(!render.includes('FLEET_RUN'), 'FLEET_RUN must appear nowhere')
})

test('(e) [M2] the self-delete is still the last executable line', () => {
  const executable = lines.filter(isExecutable)
  assert.equal(executable[executable.length - 1].trim(), SELF_DELETE)
})

test('(e) [M1, M2] the existing setup-script sim still prints its sentinel', () => {
  const r = spawnSync(process.execPath, [SIBLING_SIM], {
    encoding: 'utf8',
    cwd: HERE,
    timeout: 300000,
  })
  assert.ok(
    r.stdout.includes('ALL TESTS PASSED'),
    `test_setup_script.mjs must still pass:\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
  )
  assert.equal(r.status, 0, `test_setup_script.mjs exited ${r.status}`)
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
