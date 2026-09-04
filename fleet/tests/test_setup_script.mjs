/**
 * Exam for `fleet/setup-script.mjs` — the per-run first-boot setup script.
 *
 * What it proves, leg by leg: the render fits 10 KiB and carries the run number
 * as a literal (never an environment read); node arrives from nodejs.org only
 * after its own release checksum verifies, bun from its pinned GitHub release,
 * pytest from apt (never pip, never `--break-system-packages`); the bootstrap
 * lands root-owned through `sudo -n install -m 0555` and the unit template in
 * the user's systemd directory, byte-for-byte as handed in; the status page is
 * up before anything else, the user bus is waited for with a deadline before
 * any `systemctl --user`, and the unit start is the last thing the script does
 * but delete itself.
 *
 * Nothing here touches the machine and nothing opens a network socket. Every
 * external command the script can reach is a stub on a PATH shim that appends
 * `<epoch-ms> <tool> <argv...>` to one shared log, so a leg can read a single
 * ordered history across tools; `FLEET_LIB_DIR`, `FLEET_USER_BUS` and `HOME`
 * point into a per-case temp directory, and the stubs that really move bytes
 * (`install`, `ln`) do so only when their destination is inside that directory
 * — an install into `/usr/local` is recorded and skipped. The user bus is a
 * unix socket the exam binds in its own temp directory.
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  renderSetupScript,
  readFleetFiles,
  SETUP_SCRIPT_MAX_BYTES,
  NODE_VERSION,
  BUN_VERSION,
} from '../setup-script.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.join(HERE, '..')
const UNIT_FILE = path.join(FLEET, 'fleet-run@.service')
const BOOTSTRAP_FILE = path.join(FLEET, 'fleet-bootstrap.sh')
const SELF = fileURLToPath(import.meta.url)

// ── the contract's literals ──────────────────────────────────────────────────

const RUN = '70'
const OTHER_RUN = '123456'
const NODE_TARBALL = 'node-v24.20.0-linux-x64.tar.xz'
const NODE_URL = 'https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz'
const SHASUMS_URL = 'https://nodejs.org/dist/v24.20.0/SHASUMS256.txt'
const BUN_URL = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-x64.zip'
const UNIT_EXEC_START = '/usr/local/lib/fleet/bootstrap.sh %i'
const SELF_DELETE = 'sudo -n rm -f -- "$0"'
const SETTINGS = {
  env: { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' },
  permissions: { defaultMode: 'bypassPermissions' },
}
const KNOBS = {
  FLEET_LIB_DIR: '${FLEET_LIB_DIR:-/usr/local/lib/fleet}',
  FLEET_USER_BUS: '${FLEET_USER_BUS:-/run/user/$(id -u)/bus}',
  FLEET_BUS_WAIT_SECONDS: '${FLEET_BUS_WAIT_SECONDS:-60}',
}
const FORBIDDEN_IN_RENDER = [
  '--break-system-packages',
  'pip install',
  'apt-get install -y gh',
  'apt-get install -y busybox',
  'ANTHROPIC',
]
// Spelled in pieces on purpose: leg (g) asks that neither the render nor this
// exam carry them, and a literal here would fail the exam against itself.
const RETIRED_NAMES = ['gol' + 'den', 'fleet' + '-runs', '--copy' + '-tags']

// Fixtures for the execution legs: bait for a heredoc that expands. The bytes
// are never run, only carried, so what matters is that they arrive unchanged.
const FIXTURE_BOOTSTRAP = [
  '#!/usr/bin/env bash',
  '# fixture bootstrap: these bytes must land unexpanded',
  'set -euo pipefail',
  'printf \'%s\\n\' "$HOME ${PATH} $(id -u) \\\\ \'q\' backtick`q`"',
  'exit 0',
  '',
].join('\n')
const FIXTURE_UNIT = [
  '[Unit]',
  'Description=fixture unit $NOT_EXPANDED',
  '',
  '[Service]',
  'Type=exec',
  `ExecStart=${UNIT_EXEC_START}`,
  '',
].join('\n')

// ── the PATH shim ────────────────────────────────────────────────────────────

const PRELUDE = `#!/bin/sh
argv() {
  _n="$1"; shift
  { printf '%s\\t%s' "$(date +%s%3N)" "$_n"
    for _a in "$@"; do printf '\\t%s' "$_a"; done
    printf '\\n'
  } >>"$STUB_LOG"
}
real() { PATH="$STUB_REAL_PATH"; export PATH; exec "$@"; }
`

const STUBS = {
  // Records its argv and runs its argument, so an install really copies.
  sudo: `
argv sudo "$@"
while [ $# -gt 0 ]; do
  case "$1" in
    -n|-E|-H|-S|-k) shift ;;
    -u|-g) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || exit 0
exec "$@"
`,
  // Writes a fixture to the -o path (and to stdout, for the piped form).
  curl: `
argv curl "$@"
_out=; _url=; _prev=
for _a in "$@"; do
  case "$_prev" in -o|--output) _out="$_a" ;; esac
  case "$_a" in http://*|https://*) _url="$_a" ;; esac
  _prev="$_a"
done
case "$_url" in
  *SHASUMS256.txt) _body="$STUB_SHASUMS" ;;
  *) _body="fixture bytes for $_url" ;;
esac
if [ -n "$_out" ] && [ "$_out" != "-" ]; then
  printf '%s\\n' "$_body" >"$_out" 2>/dev/null || true
else
  printf '%s\\n' "$_body"
fi
exit 0
`,
  tar: `
argv tar "$@"
exit 0
`,
  // Plants what a bun release zip holds, so the install after it has a source.
  unzip: `
argv unzip "$@"
_d=.; _prev=
for _a in "$@"; do case "$_prev" in -d) _d="$_a" ;; esac; _prev="$_a"; done
mkdir -p "$_d/bun-linux-x64" 2>/dev/null || true
for _f in "$_d/bun" "$_d/bunx" "$_d/bun-linux-x64/bun" "$_d/bun-linux-x64/bunx"; do
  { printf '#!/bin/sh\\nexit 0\\n' >"$_f" && chmod 755 "$_f"; } 2>/dev/null || true
done
exit 0
`,
  sha256sum: `
argv sha256sum "$@"
cat >/dev/null 2>&1 || true
exit "\${STUB_SHA256SUM_EXIT:-0}"
`,
  'apt-get': `
argv apt-get "$@"
exit 0
`,
  git: `
argv git "$@"
exit 0
`,
  // Snapshots the status page as it stood at the first systemd-run call.
  'systemd-run': `
argv systemd-run "$@"
if [ ! -e "$STUB_SNAPSHOT_MARK" ]; then
  : >"$STUB_SNAPSHOT_MARK"
  if [ -f "$HOME/www/status.json" ]; then cp "$HOME/www/status.json" "$STUB_STATUS_SNAPSHOT"; fi
fi
exit 0
`,
  systemctl: `
argv systemctl "$@"
exit 0
`,
  busybox: `
argv busybox "$@"
exit 0
`,
  node: `
argv node "$@"
printf 'v24.20.0\\n'
exit 0
`,
  bun: `
argv bun "$@"
printf '1.4.0\\n'
exit 0
`,
  python3: `
argv python3 "$@"
exit 0
`,
  sleep: `
argv sleep "$@"
real sleep "$@"
`,
  // Copies for real, but only into the case's own directory: an install that
  // targets /usr/local is recorded and skipped so the exam writes nothing
  // outside its temp root.
  install: `
argv install "$@"
_mode=; _dir=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--mode) _mode="$2"; shift 2 ;;
    -m*) _mode="\${1#-m}"; shift ;;
    -d) _dir=1; shift ;;
    -o|-g|--owner|--group) shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
if [ "$_dir" = 1 ]; then
  for _t in "$@"; do
    case "$_t" in "$STUB_TMPROOT"/*) mkdir -p "$_t" ;; esac
  done
  exit 0
fi
_dst=; for _a in "$@"; do _dst="$_a"; done
case "$_dst" in "$STUB_TMPROOT"/*) ;; *) exit 0 ;; esac
mkdir -p "$(dirname "$_dst")"
_i=1
for _a in "$@"; do
  if [ "$_i" -lt "$#" ]; then cp -- "$_a" "$_dst"; fi
  _i=$((_i+1))
done
if [ -n "$_mode" ]; then chmod "$_mode" "$_dst" 2>/dev/null || true; fi
exit 0
`,
  ln: `
argv ln "$@"
_dst=; for _a in "$@"; do _dst="$_a"; done
case "$_dst" in "$STUB_TMPROOT"/*) real ln "$@" ;; esac
exit 0
`,
}

const SHASUMS_FIXTURE = `${'7'.repeat(64)}  ${NODE_TARBALL}`

// ── harness ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-script-'))
let caseNo = 0

function makeCase() {
  caseNo += 1
  const root = path.join(tmpRoot, `c${caseNo}`)
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  return {
    root,
    home,
    bin,
    // Neither exists yet: on a fresh VM the script makes its own lib directory.
    lib: path.join(root, 'lib', 'fleet'),
    bus: path.join(root, 'bus'),
    log: path.join(root, 'stub.log'),
    snapshot: path.join(root, 'status-at-httpd.json'),
    mark: path.join(root, 'snapshot.mark'),
    script: path.join(root, 'setup.sh'),
  }
}

function plant(ctx, text) {
  fs.writeFileSync(ctx.script, text)
  fs.chmodSync(ctx.script, 0o755)
  const syntax = spawnSync('bash', ['-n', ctx.script], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, `the render must parse before it is run:\n${syntax.stderr}`)
}

function runScript(ctx, env = {}) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const child = spawn('bash', [ctx.script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${ctx.bin}:${process.env.PATH}`,
        HOME: ctx.home,
        USER: 'exedev',
        FLEET_LIB_DIR: ctx.lib,
        FLEET_USER_BUS: ctx.bus,
        STUB_LOG: ctx.log,
        STUB_TMPROOT: ctx.root,
        STUB_REAL_PATH: process.env.PATH,
        STUB_SHASUMS: SHASUMS_FIXTURE,
        STUB_STATUS_SNAPSHOT: ctx.snapshot,
        STUB_SNAPSHOT_MARK: ctx.mark,
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const killer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 40000)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (status, signal) => {
      clearTimeout(killer)
      resolve({ status, signal, stdout, stderr, startedAt, endedAt: Date.now(), timedOut })
    })
  })
}

function bindBus(p) {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(p, () => resolve(server))
  })
}

const setupLog = (ctx) => {
  const f = path.join(ctx.home, 'fleet-setup.log')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
const why = (ctx, r) =>
  `exit=${r.status} signal=${r.signal}\n--- stderr ---\n${r.stderr}\n--- $HOME/fleet-setup.log ---\n${setupLog(ctx)}`

function entries(ctx) {
  if (!fs.existsSync(ctx.log)) return []
  return fs
    .readFileSync(ctx.log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      return { ms: Number(parts[0]), tool: parts[1], argv: parts.slice(2) }
    })
}
const indexOfEntry = (es, pred) => es.findIndex(pred)
const isSelfDelete = (e) => e.tool === 'sudo' && e.argv.includes('rm')
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
const readJson = (p) => {
  const text = read(p)
  assert.ok(text !== null, `${p} was never written`)
  return JSON.parse(text)
}

// ── the render under test ────────────────────────────────────────────────────

const files = readFleetFiles()
const render = renderSetupScript({ run: RUN, bootstrap: files.bootstrap, unit: files.unit })
const renderLines = render.split('\n')
const isExecutable = (line) => line.trim() !== '' && !line.trim().startsWith('#')
const lineIndex = (needle, from = 0) => {
  for (let i = from; i < renderLines.length; i += 1) if (renderLines[i].includes(needle)) return i
  return -1
}
const lineMatching = (re, from = 0) => {
  for (let i = from; i < renderLines.length; i += 1) if (re.test(renderLines[i])) return i
  return -1
}
// `tar` the command, not the `.tar.xz` inside a URL.
const TAR_CALL = /(?:^|[\s;&|(])tar\s/

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) [M1] the budget, the syntax, and the run number as a literal ─────────

test('(a) [M1] the exported pins are the contract\'s', () => {
  assert.equal(SETUP_SCRIPT_MAX_BYTES, 10240)
  assert.equal(NODE_VERSION, '24.20.0')
  assert.equal(BUN_VERSION, '1.4.0')
})

test('(a) [M1] the render for run 70 fits 10240 bytes and passes bash -n', () => {
  const bytes = Buffer.byteLength(render, 'utf8')
  assert.ok(bytes <= SETUP_SCRIPT_MAX_BYTES, `${bytes} bytes; the ceiling is ${SETUP_SCRIPT_MAX_BYTES}`)

  // Every run number, not just 70: the script is generated per run.
  for (const run of ['1', RUN, OTHER_RUN, '999999']) {
    const f = path.join(tmpRoot, `syntax-${run}.sh`)
    fs.writeFileSync(f, renderSetupScript({ run, bootstrap: files.bootstrap, unit: files.unit }))
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' })
    assert.equal(r.status, 0, `bash -n failed for run=${run}:\n${r.stderr}`)
  }
})

test('(a) [M1] RUN=70 is the first executable line after set -euo pipefail', () => {
  const setLine = renderLines.findIndex((l) => l.trim() === 'set -euo pipefail')
  assert.ok(setLine >= 0, 'the render must carry a bare `set -euo pipefail` line')
  const next = renderLines.findIndex((l, i) => i > setLine && isExecutable(l))
  assert.ok(next >= 0, 'nothing follows `set -euo pipefail`')
  assert.equal(renderLines[next].trim(), `RUN=${RUN}`)
})

test('(a) [M1] a render for 123456 differs from the 70 render only where 70 appears', () => {
  const other = renderSetupScript({ run: OTHER_RUN, bootstrap: files.bootstrap, unit: files.unit })
  assert.notEqual(other, render, 'the run number must reach the script')
  assert.equal(
    other.split(OTHER_RUN).join(RUN),
    render,
    'putting 70 back where 123456 stands must reproduce the run-70 render exactly',
  )
})

// ── (b) [M1] the run number is never read from the environment ───────────────

test('(b) [M1] the only assignment to RUN is the literal, and no env read exists', () => {
  const assignments = renderLines.filter((l) => /(?:^|[\s;&|(]|\bexport\s+)RUN=/.test(l))
  assert.deepEqual(
    assignments.map((l) => l.trim()),
    [`RUN=${RUN}`],
    'exactly one RUN assignment, and it is the literal',
  )
  assert.ok(!render.includes('FLEET_RUN'), 'FLEET_RUN must appear nowhere')
  assert.ok(!render.includes('--env'), '--env must appear nowhere')
})

// ── (c)/(d) [M2] the three installs, in the order the checksum demands ───────

test('(c) [M2] the node tarball, its SHASUMS256.txt and the checksum precede the unpack', () => {
  const nodeUrl = lineIndex(NODE_URL)
  const shasumsUrl = lineIndex(SHASUMS_URL)
  const sha = lineIndex('sha256sum -c')
  const tar = lineMatching(TAR_CALL)
  assert.ok(nodeUrl >= 0, `the render must carry ${NODE_URL} verbatim`)
  assert.ok(shasumsUrl >= 0, `the render must carry ${SHASUMS_URL} verbatim`)
  assert.ok(sha >= 0, 'the render must carry a `sha256sum -c` line')
  assert.ok(tar >= 0, 'the render must unpack the tarball with tar')
  assert.ok(nodeUrl < tar, 'the node URL comes before the unpack')
  assert.ok(shasumsUrl < tar, 'the SHASUMS256.txt URL comes before the unpack')
  assert.ok(sha < tar, 'the checksum is verified before the unpack')
})

test('(c) [M2] the checksum line names the release sums and that tarball, unguarded', () => {
  const i = lineIndex('sha256sum -c')
  assert.ok(i >= 0)
  const line = renderLines[i]
  assert.ok(line.includes('SHASUMS256.txt'), `the sum checked is the release's: ${line}`)
  assert.ok(line.includes(NODE_TARBALL), `and it is that tarball's line: ${line}`)
  assert.ok(!line.includes('|| true'), `the checksum may not be waived: ${line}`)
  const tar = lineMatching(TAR_CALL)
  const between = renderLines.slice(i, tar + 1).join('\n')
  assert.ok(!between.includes('set +e'), 'errexit stays on between the checksum and the unpack')
})

test('(c) [M2] the bun release, its install and bunx are the pinned ones', () => {
  assert.ok(render.includes(BUN_URL), `the render must carry ${BUN_URL} verbatim`)
  const bunInstall = renderLines.findIndex(
    (l) => l.includes('install -m 0755') && l.includes('/usr/local/bin/bun'),
  )
  assert.ok(bunInstall >= 0, '`install -m 0755` must target /usr/local/bin/bun')
  const bunx = renderLines.findIndex(
    (l) => l.includes('/usr/local/bin/bunx') && (l.includes('ln -sf') || l.includes('install')),
  )
  assert.ok(bunx >= 0, 'a `ln -sf` or `install` line must put bunx beside bun')
})

test('(c) [M2] pytest comes from apt, both packages, no recommends', () => {
  const i = renderLines.findIndex((l) => l.includes('apt-get install'))
  assert.ok(i >= 0, 'the render must install through apt-get')
  const line = renderLines[i]
  assert.ok(line.includes('-y'), line)
  assert.ok(line.includes('--no-install-recommends'), line)
  assert.ok(line.includes('python3-pytest'), line)
  assert.ok(line.includes('python3-pytest-xdist'), line)
})

test('(d) [M2] the forbidden install paths and the token name are absent', () => {
  for (const s of FORBIDDEN_IN_RENDER) {
    assert.ok(!render.includes(s), `the render must not contain ${JSON.stringify(s)}`)
  }
})

// ── the shared green execution: legs (c), (e), (f), (i) read it ──────────────

let greenPromise = null
function green() {
  if (!greenPromise) {
    greenPromise = (async () => {
      const ctx = makeCase()
      const script = renderSetupScript({ run: RUN, bootstrap: FIXTURE_BOOTSTRAP, unit: FIXTURE_UNIT })
      plant(ctx, script)
      const server = await bindBus(ctx.bus)
      try {
        const result = await runScript(ctx)
        return { ctx, script, result, es: entries(ctx) }
      } finally {
        await new Promise((res) => server.close(res))
      }
    })()
  }
  return greenPromise
}

test('(c) [M2] the fetches the script really makes are the pinned URLs, in order', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))

  const curls = es.filter((e) => e.tool === 'curl')
  const bunCurl = curls.find((e) => e.argv.includes(BUN_URL))
  const nodeCurl = curls.find((e) => e.argv.includes(NODE_URL))
  const sumsCurl = curls.find((e) => e.argv.includes(SHASUMS_URL))
  assert.ok(bunCurl, `curl never fetched ${BUN_URL}`)
  assert.ok(nodeCurl, `curl never fetched ${NODE_URL}`)
  assert.ok(sumsCurl, `curl never fetched ${SHASUMS_URL}`)

  const iBunCurl = es.indexOf(bunCurl)
  const iNodeCurl = es.indexOf(nodeCurl)
  const iSumsCurl = es.indexOf(sumsCurl)
  const iUnzip = indexOfEntry(es, (e) => e.tool === 'unzip')
  const iTar = indexOfEntry(es, (e) => e.tool === 'tar')
  const shaEntry = es.find((e) => e.tool === 'sha256sum')
  assert.ok(shaEntry, 'sha256sum was never run')
  assert.ok(shaEntry.argv.includes('-c'), `sha256sum ran without -c: ${shaEntry.argv.join(' ')}`)
  const iSha = es.indexOf(shaEntry)
  assert.ok(iUnzip >= 0, 'the bun zip was never unpacked')
  assert.ok(iTar >= 0, 'the node tarball was never unpacked')

  const zipArg = es[iUnzip].argv.find((a) => a.endsWith('.zip'))
  assert.ok(zipArg, `unzip named no zip: ${es[iUnzip].argv.join(' ')}`)
  assert.ok(
    bunCurl.argv.includes(zipArg),
    `unzip must unpack what curl downloaded from the pinned URL, not ${zipArg}`,
  )

  const iBunInstall = indexOfEntry(
    es,
    (e) => e.tool === 'install' && e.argv[e.argv.length - 1] === '/usr/local/bin/bun',
  )
  assert.ok(iBunInstall >= 0, 'nothing installed /usr/local/bin/bun')
  assert.ok(iBunCurl < iBunInstall, 'the bun download comes before its install')
  assert.ok(iUnzip < iBunInstall, 'the unpack comes before its install')

  assert.ok(iNodeCurl < iSha, 'the tarball is fetched before it is checked')
  assert.ok(iSumsCurl < iSha, 'the release sums are fetched before the check')
  assert.ok(iSha < iTar, 'the check happens before the unpack')
})

test('(d) [M2] a checksum that fails stops the run before anything is unpacked', async () => {
  const ctx = makeCase()
  plant(ctx, renderSetupScript({ run: RUN, bootstrap: FIXTURE_BOOTSTRAP, unit: FIXTURE_UNIT }))
  const server = await bindBus(ctx.bus)
  let result
  try {
    result = await runScript(ctx, { STUB_SHA256SUM_EXIT: '1' })
  } finally {
    await new Promise((res) => server.close(res))
  }
  assert.notEqual(result.status, 0, `a failed checksum must fail the run\n${why(ctx, result)}`)
  const es = entries(ctx)
  assert.equal(es.filter((e) => e.tool === 'tar').length, 0, 'nothing is unpacked')
  assert.equal(es.filter((e) => e.tool === 'unzip').length, 0, 'nothing is unpacked')
})

// ── (e) [M3] what the script writes ──────────────────────────────────────────

test('(e) [M3] the bootstrap is installed root-readable-only through sudo -n install -m 0555', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))

  const dst = path.join(ctx.lib, 'bootstrap.sh')
  assert.equal(read(dst), FIXTURE_BOOTSTRAP, 'the installed bootstrap must be the bytes handed in')

  const sudos = es.filter((e) => e.tool === 'sudo')
  assert.ok(sudos.length > 0, 'the bootstrap is installed through sudo')
  for (const e of sudos) {
    assert.equal(e.argv[0], '-n', `every sudo is non-interactive: ${e.argv.join(' ')}`)
  }
  const installer = sudos.find((e) => e.argv.includes('install') && e.argv.includes(dst))
  assert.ok(installer, `no sudo install of ${dst}: ${JSON.stringify(sudos.map((e) => e.argv))}`)
  assert.deepEqual(installer.argv.slice(0, 4), ['-n', 'install', '-m', '0555'])
})

test('(e) [M3] the unit template, the settings and the git identity land in the home', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))

  assert.equal(
    read(path.join(ctx.home, '.config', 'systemd', 'user', 'fleet-run@.service')),
    FIXTURE_UNIT,
    'the unit template must be the bytes handed in',
  )
  assert.deepEqual(readJson(path.join(ctx.home, '.claude', 'settings.json')), SETTINGS)

  const gits = es.filter((e) => e.tool === 'git').map((e) => e.argv.join(' '))
  assert.ok(
    gits.includes('config --global user.name fleet'),
    `git identity missing: ${JSON.stringify(gits)}`,
  )
})

// ── (f) [M4] the status page first, the unit start last ──────────────────────

test('(f) [M4] the status server comes up first, over a page already written', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))

  const runs = es.filter((e) => e.tool === 'systemd-run')
  assert.ok(runs.length > 0, 'the status server is never started')
  assert.deepEqual(runs[0].argv, [
    '--user',
    '--unit=fleet-status',
    '-p',
    'Restart=on-failure',
    '--',
    'busybox',
    'httpd',
    '-f',
    '-p',
    '8000',
    '-h',
    `${ctx.home}/www`,
  ])

  const page = readJson(ctx.snapshot)
  assert.equal(page.state, 'booting', 'the page is booting when httpd starts')
  assert.equal(page.run, RUN, 'and it names this run')

  // The server is the first --user call and it precedes every install: the
  // installs run after the bus is proven up, never before.
  const iServer = indexOfEntry(es, (e) => e.tool === 'systemd-run')
  const iInstall = indexOfEntry(es, (e) => ['curl', 'tar', 'unzip', 'apt-get', 'sudo', 'sha256sum'].includes(e.tool))
  assert.ok(iInstall > iServer, `an install ran before the status server (server at ${iServer}, first install at ${iInstall})`)
  const sudos = es.filter((e) => e.tool === 'sudo').map((e) => e.argv.join(' '))
  assert.ok(
    sudos.includes('-n apt-get install -y --no-install-recommends python3-pytest python3-pytest-xdist'),
    `pytest is installed through sudo -n apt-get: ${JSON.stringify(sudos)}`,
  )
})

test('(f) [M4] daemon-reload then the unit start, and the start is the last command but the self-delete', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))

  const systemctls = es.filter((e) => e.tool === 'systemctl').map((e) => e.argv.join(' '))
  assert.deepEqual(systemctls, ['--user daemon-reload', `--user start fleet-run@${RUN}.service`])

  const iStart = indexOfEntry(
    es,
    (e) => e.tool === 'systemctl' && e.argv.join(' ') === `--user start fleet-run@${RUN}.service`,
  )
  const after = es.slice(iStart + 1)
  assert.ok(
    !after.some((e) => e.tool === 'systemctl' || e.tool === 'systemd-run'),
    'the start is the last systemd call',
  )
  assert.equal(after.length, 1, `only the self-delete follows: ${JSON.stringify(after.map((e) => e.argv))}`)
  assert.equal(after[0].tool, 'sudo')
  assert.deepEqual(after[0].argv, ['-n', 'rm', '-f', '--', ctx.script])
})

// ── (g) [M4] the knobs, the retired names, and the bus deadline ──────────────

test('(g) [M4] the three knobs carry their contract defaults and no other', () => {
  for (const [name, literal] of Object.entries(KNOBS)) {
    assert.ok(render.includes(literal), `the render must carry ${literal} verbatim`)
    const found = render.match(new RegExp(`\\$\\{${name}[^}]*\\}`, 'g')) || []
    for (const use of found) {
      assert.ok(
        use === `\${${name}}` || use === literal,
        `${name} is read with a second default: ${use}`,
      )
    }
  }
})

test('(g) neither the render nor this exam names a retired file', () => {
  const self = fs.readFileSync(SELF, 'utf8')
  for (const name of RETIRED_NAMES) {
    assert.ok(!render.includes(name), `the render still names ${name}`)
    assert.ok(!self.includes(name), `this exam still names ${name}`)
  }
})

test('(g) [M4] a bus that never appears fails the run on the deadline, with no systemctl at all', async () => {
  const ctx = makeCase()
  plant(ctx, renderSetupScript({ run: RUN, bootstrap: FIXTURE_BOOTSTRAP, unit: FIXTURE_UNIT }))
  const result = await runScript(ctx, {
    FLEET_USER_BUS: path.join(ctx.root, 'never-a-socket'),
    FLEET_BUS_WAIT_SECONDS: '2',
  })
  assert.notEqual(result.status, 0, `a missing bus must fail the run\n${why(ctx, result)}`)

  const es = entries(ctx)
  assert.equal(es.filter((e) => e.tool === 'systemctl').length, 0, 'no systemctl call is made')
  assert.equal(
    es.filter((e) => e.tool === 'systemd-run').length, 0,
    'no --user call is made without a bus — the page server waits for it too',
  )
  assert.equal(readJson(path.join(ctx.home, 'www', 'status.json')).state, 'failed')

  // The deadline is in seconds, measured from launch: nothing but the exports
  // and one page write precede the wait now, so launch is the wait's start.
  const preWait = es.filter((e) => e.tool !== 'sleep' && !isSelfDelete(e))
  assert.equal(preWait.length, 0, `nothing runs before the wait: ${JSON.stringify(preWait.map((e) => e.tool))}`)
  const elapsed = result.endedAt - result.startedAt
  assert.ok(
    elapsed >= 2000 && elapsed <= 4000,
    `the wait must honour FLEET_BUS_WAIT_SECONDS=2 as a deadline; it took ${elapsed} ms`,
  )
})

test('(g) [M4] a bus that appears 3 s in is polled for and then used', async () => {
  const ctx = makeCase()
  plant(ctx, renderSetupScript({ run: RUN, bootstrap: FIXTURE_BOOTSTRAP, unit: FIXTURE_UNIT }))
  const t0 = Date.now()
  const later = setTimeout(() => { bindBus(ctx.bus).then((s) => { ctx._server = s }) }, 3000)
  let result
  try {
    result = await runScript(ctx, { FLEET_BUS_WAIT_SECONDS: '30' })
  } finally {
    clearTimeout(later)
    if (ctx._server) await new Promise((res) => ctx._server.close(res))
  }
  assert.equal(result.status, 0, why(ctx, result))

  const es = entries(ctx)
  const iReload = indexOfEntry(
    es,
    (e) => e.tool === 'systemctl' && e.argv.join(' ') === '--user daemon-reload',
  )
  assert.ok(iReload >= 0, 'the bus appeared, so daemon-reload must run')
  const start = es.find(
    (e) => e.tool === 'systemctl' && e.argv.join(' ') === `--user start fleet-run@${RUN}.service`,
  )
  assert.ok(start, 'the unit is started once the bus is there')
  assert.ok(
    start.ms - t0 >= 3000,
    `the start must wait for the bus; it came ${start.ms - t0} ms after launch`,
  )
  const server = es.find((e) => e.tool === 'systemd-run')
  assert.ok(server && server.ms - t0 >= 3000,
    `the page server must wait for the bus too; it came ${server ? server.ms - t0 : 'never'} ms after launch`)

  // The wait is a loop with a sub-second sleep, so the polling is observable —
  // it sits just before the first --user call, the page server.
  const iServer = indexOfEntry(es, (e) => e.tool === 'systemd-run')
  assert.ok(iServer >= 0, 'the page server starts once the bus is there')
  let firstSleep = iServer
  while (firstSleep > 0 && es[firstSleep - 1].tool === 'sleep') firstSleep -= 1
  const polls = es.slice(firstSleep, iServer)
  assert.ok(polls.length >= 2, `the wait must poll, not sleep once: ${polls.length} sleeps`)
  for (const p of polls) {
    assert.ok(
      Number(p.argv[0]) < 1,
      `each poll sleeps under a second, not ${p.argv.join(' ')}`,
    )
  }
})

// ── (h) [M5] the unit template and the two files the module reads ────────────

function parseIni(text) {
  const sections = new Map()
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = header[1]
      if (!sections.has(current)) sections.set(current, [])
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0 || current === null) continue
    sections.get(current).push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()])
  }
  return sections
}

test('(h) [M5] the unit template is the one the contract declares', () => {
  const ini = parseIni(fs.readFileSync(UNIT_FILE, 'utf8'))
  const service = new Map(ini.get('Service') || [])
  assert.equal(service.get('ExecStart'), UNIT_EXEC_START)
  assert.equal(service.get('Type'), 'exec')
  assert.equal(service.get('RemainAfterExit'), 'yes')
  assert.equal(service.get('RuntimeMaxSec'), '6h')
  assert.ok(!ini.has('Install'), 'a template nothing enables has no [Install] section')
  const keys = [...ini.values()].flat().map(([k]) => k)
  assert.ok(!keys.includes('KillMode'), 'no KillMode')
  assert.ok(!keys.includes('Restart'), 'no Restart')
})

test('(h) [M5] readFleetFiles answers the two files beside the module', () => {
  assert.equal(files.unit, fs.readFileSync(UNIT_FILE, 'utf8'))
  assert.equal(files.bootstrap, fs.readFileSync(BOOTSTRAP_FILE, 'utf8'))
})

// ── (i) [M6] the script removes itself, last ─────────────────────────────────

test('(i) [M6] the last executable line of the render is the self-delete', () => {
  const executable = renderLines.filter(isExecutable)
  assert.equal(executable[executable.length - 1].trim(), SELF_DELETE)
})

test('(i) [M6] the script that ran is gone, and the unit start preceded its removal', async () => {
  const { ctx, result, es } = await green()
  assert.equal(result.status, 0, why(ctx, result))
  assert.ok(!fs.existsSync(ctx.script), 'the setup script deletes itself')
  const iStart = indexOfEntry(
    es,
    (e) => e.tool === 'systemctl' && e.argv.join(' ') === `--user start fleet-run@${RUN}.service`,
  )
  const iRm = indexOfEntry(es, isSelfDelete)
  assert.ok(iStart >= 0, 'the unit was never started')
  assert.ok(iRm >= 0, 'the script never removed itself')
  assert.ok(iStart < iRm, 'the run is started before the script disappears')
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
