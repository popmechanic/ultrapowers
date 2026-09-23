/**
 * fleet/tests/_boot_helpers.mjs — the boot sim's rig, shared.
 *
 * Underscore-prefixed so `test_fleet_suite.py`'s `test_*.mjs` glob does not
 * run it as a test of its own (the same convention `_helpers.mjs` follows).
 *
 * At BASE this rig lived whole inside `test_factory_boot.mjs`: `FIXTURE_PLAN`,
 * `buildOrigin`, `buildEngineDir`, `writeStubs` (the `curl` router answering
 * `/pulls`, `/pulls/7` and `/pulls/7/merge`, the `systemd-run` stub that runs
 * the engine stub inline, `systemctl` a no-op, `claude` a one-line auth
 * answer) and the in-process proxy stub server. `fleet/tests/
 * test_sims_are_hermetic.mjs` forbids one sim naming another
 * (`test_factory_publish.mjs` cannot `import` from `test_factory_boot.mjs`),
 * so this task moves those pieces here, behind one factory function,
 * `bootRig({ plan, stubs })`, and both `test_factory_boot.mjs` and
 * `test_factory_publish.mjs` call it.
 *
 * `plan` overrides the fixture plan text committed to `.ultrapowers/plan.md`
 * (default `FIXTURE_PLAN`, the boot sim's own one-task plan); `stubs` is a
 * `{name: content}` map of extra executable stub scripts `writeStubs` writes
 * into the case's `bin` directory alongside `claude`/`curl`/`systemd-run`/
 * `systemctl` — `test_factory_publish.mjs` uses it for `bun`/`bunx`.
 *
 * Every process this rig spawns gets `env: simEnv({ bin, home, env })` from
 * `./_helpers.mjs` — nothing is ever passed `process.env` directly.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const BOOT_SH = path.join(REPO_ROOT, 'factory', 'boot.sh')
const FACTORY_DIR = path.join(REPO_ROOT, 'factory')
const SKILLS_DIR = path.join(REPO_ROOT, 'skills')

const ENGINE_SHA = 'e'.repeat(40)
const MERGE_SHA = 'deadbeef'.repeat(5)

const EXPECTED_STATUS_KEYS = [
  'run', 'state', 'phase', 'pr', 'prAuthor', 'merged', 'disclosures',
  'branch', 'vm', 'startedAt', 'updatedAt', 'error', 'tasks'
]

const FIXTURE_PLAN = [
  '# A widget that answers its size',
  '',
  '**Claim:** After this run a widget answers its size. (elicited)',
  '',
  '**Summary:** One widget, one size. It exists so the boot has a plan to carry. It benefits the record.',
  '',
  '**Goal:** ship one widget that reports its own size',
  '',
  '**Closes:** #1222',
  '',
  '## Global Constraints',
  '',
  'None.',
  '',
  '### Task 1: A widget that answers its size',
  '',
  '**Type:** implementation',
  '',
  '**Files:**',
  '- Create: `widget.mjs`',
  '- Test: `tests/test_widget.mjs`',
  '',
  '**Claim:** A widget answers its size. (derived)',
  'Machine: M1. `size()` returns `1`.',
  '',
  '**Authorized-by:** #1222',
  '',
  '**Interfaces:**',
  '- Consumes: none',
  '- Produces: `size()`',
  '',
  '**Context:** One function, one number.',
  '',
  '**Proof:**',
  '- Test: `tests/test_widget.mjs`',
  '- Legs: (a) `size()` is exactly `1` [M1].',
  '',
  '**Stale-if:**',
  '- path-absent: `widget.mjs`',
  ''
].join('\n')

// ── the rig's own git plumbing (stays synchronous — nothing it does waits
//    on the in-process proxy stub server) ────────────────────────────────

const GIT_ENV = simEnv({})

function git (cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
  if (res.status !== 0) {
    throw new Error(`fixture git ${args.join(' ')} (cwd=${cwd}) exited ${res.status}\n${res.stdout}${res.stderr}`)
  }
  return res.stdout
}

function writeStub (dir, name, content) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  fs.chmodSync(p, 0o755)
}

function writeGitConfig (home) {
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = fleet\n\temail = fleet@exe.dev\n')
}

/** A bare origin seeded with a `base` commit on `main`, plus a `plan`
 * commit — `planText` — pushed only to `refs/heads/ultra/plan-run-<runN>`. */
function buildOrigin (root, runN, planText) {
  const originDir = path.join(root, 'origin.git')
  git(root, ['init', '--bare', originDir])
  git(originDir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])

  const scratch = path.join(root, 'scratch')
  git(root, ['clone', originDir, scratch])
  git(scratch, ['config', 'user.email', 'fleet@exe.dev'])
  git(scratch, ['config', 'user.name', 'fleet'])

  fs.writeFileSync(path.join(scratch, 'README'), 'seed\n')
  git(scratch, ['add', '-A'])
  git(scratch, ['commit', '-m', 'seed'])
  git(scratch, ['push', 'origin', 'HEAD:refs/heads/main'])
  const base = git(scratch, ['rev-parse', 'HEAD']).trim()

  fs.mkdirSync(path.join(scratch, '.ultrapowers'), { recursive: true })
  fs.writeFileSync(path.join(scratch, '.ultrapowers', 'plan.md'), planText)
  git(scratch, ['add', '-A'])
  git(scratch, ['commit', '-m', 'plan'])
  git(scratch, ['push', 'origin', `HEAD:refs/heads/ultra/plan-run-${runN}`])
  const plan = git(scratch, ['rev-parse', 'HEAD']).trim()

  return { originDir, base, plan }
}

function buildEngineDir (home, engineSha) {
  const engineDir = path.join(home, 'engines', engineSha)
  fs.mkdirSync(engineDir, { recursive: true })
  fs.symlinkSync(FACTORY_DIR, path.join(engineDir, 'factory'), 'dir')
  fs.symlinkSync(SKILLS_DIR, path.join(engineDir, 'skills'), 'dir')
  fs.mkdirSync(path.join(engineDir, 'fleet', 'node_modules'), { recursive: true })
  return engineDir
}

function lsRemote (originDir, kind) {
  const out = git(originDir, ['ls-remote', kind, originDir])
  const map = {}
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [sha, ref] = line.split('\t')
    map[ref] = sha
  }
  return map
}

function assignment ({ runN, plan, target, base, engine }) {
  return `run=${runN} plan=${plan} target=${target} base=${base} engine=${engine}`
}

const CURL_STUB = `#!/bin/sh
url=""
method="GET"
data=""
wflag=0
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H) shift 2 ;;
    -d) data="$2"; shift 2 ;;
    -w) wflag=1; shift 2 ;;
    -o) shift 2 ;;
    --max-time) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done

case "$url" in
  */api/v3/repos/o/r/pulls)
    if [ "$method" = "POST" ]; then
      printf %s "$data" > "$FLEET_HOME/pr-post.json"
      body='{"html_url":"https://github.com/o/r/pull/7","number":7,"user":{"login":"fleet-bot"}}'
      code=201
    else
      body=""
      code=404
    fi
    ;;
  */api/v3/repos/o/r/pulls/7)
    if [ "$method" = "GET" ]; then
      body='{"mergeable":true}'
      code=200
    else
      body=""
      code=404
    fi
    ;;
  */api/v3/repos/o/r/pulls/7/merge)
    if [ "$method" = "PUT" ]; then
      printf %s "$data" > "$FLEET_HOME/merge-put.json"
      body=$(printf '{"sha":"%s"}' "$MERGE_SHA")
      code=200
    else
      body=""
      code=404
    fi
    ;;
  */)
    body='{"name":"fleet-sim"}'
    code=200
    ;;
  *)
    body=""
    code=404
    ;;
esac

printf %s "$body"
if [ "$wflag" = "1" ]; then
  printf "\\n%s" "$code"
fi
`

const SYSTEMD_RUN_STUB = `#!/bin/sh
target=""
rundir=""
prev=""
for a in "$@"; do
  case "$prev" in
    --target) target="$a" ;;
    --run-dir) rundir="$a" ;;
  esac
  prev="$a"
done

is_engine=0
for a in "$@"; do
  case "$a" in --unit=fleet-engine-*) is_engine=1 ;; esac
done
[ "$is_engine" = "1" ] || exit 0

code=0
if [ -f "$FLEET_HOME/engine-exit" ]; then code="$(cat "$FLEET_HOME/engine-exit")"; fi

if [ "$code" = "0" ]; then
  printf '%s\\n' "export const size = () => 1" > "$target/widget.mjs"
  mkdir -p "$target/tests"
  printf '%s\\n' "export const t = 1" > "$target/tests/test_widget.mjs"
  ( cd "$target" && git add -A && git commit -m "task 1" -q ) || exit 1
  sha="$(cd "$target" && git rev-parse HEAD)"
  printf %s "$sha" > "$FLEET_HOME/landed-sha"
  mkdir -p "$rundir"
  printf '{"ts":"2026-09-22T00:00:00.000Z","kind":"landing","task":1,"k":1,"factsExit":0,"candidateSha":"%s"}\\n' "$sha" >> "$rundir/events.jsonl"
fi
exit "$code"
`

function claudeStub (mode) {
  const text = mode === 'api_key' ? 'authMethod: api_key' : 'authMethod: oauth_token'
  return `#!/bin/sh\necho '${text}'\n`
}

/** Writes the base stub set (`claude`, `curl`, `systemd-run`, `systemctl`)
 *  into `binDir`, plus every `[name, content]` of `extraStubs` — additional
 *  executables a case's plan needs (`bun`/`bunx` for the publish probe). */
function writeStubs (binDir, { claudeAuth, extraStubs = {} } = {}) {
  writeStub(binDir, 'claude', claudeStub(claudeAuth))
  writeStub(binDir, 'curl', CURL_STUB)
  writeStub(binDir, 'systemd-run', SYSTEMD_RUN_STUB)
  writeStub(binDir, 'systemctl', '#!/bin/sh\nexit 0\n')
  for (const [name, content] of Object.entries(extraStubs)) {
    writeStub(binDir, name, content)
  }
}

function baseEnv (proxyUrl) {
  return {
    ANTHROPIC_PROXY_URL: proxyUrl,
    REFLECTION_URL: 'http://127.0.0.1:1',
    GITHUB_INT_HOST: 'stub.invalid',
    FLEET_COMMIT_SECONDS: '1',
    FLEET_KATA_WAIT_SECONDS: '1'
  }
}

// A real, always-200 stand-in for the reflection/oauth-usage proxy so
// `factory/preflight.mjs` (invoked for real by the boot) never needs the
// network: any `claude auth status` this suite's stub answers with
// `oauth_token` classifies as `alive` once its fetch actually completes —
// which requires the child that makes it to run without blocking this
// process's own event loop (the whole reason every boot is `spawn`ed and
// awaited rather than `spawnSync`'d).
function makeProxyServer () {
  return import('node:http').then(({ default: http }) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
  })
}

/** Spawns `cmd` asynchronously, collecting stdout/stderr and resolving once
 *  the child's `close` event fires (never blocking this process's event
 *  loop — a case's own proxy stub server runs in this same process). A child
 *  that outlives `timeoutMs` is killed so a hung boot cannot hang the exam. */
async function runChild (cmd, args, { bin, home, env, timeoutMs } = {}) {
  const child = spawn(cmd, args, {
    env: simEnv({ bin, home, env }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs ?? 120000)
  const code = await new Promise((resolve) => child.on('close', resolve))
  clearTimeout(timer)
  return { code, stdout, stderr }
}

/** `bash factory/boot.sh boot`, awaited. */
const runBootAsync = (opts) => runChild('bash', [BOOT_SH, 'boot'], opts)

/** `node <argv[0]> ...argv.slice(1)`, awaited — the same shape
 *  `test_factory_preflight.mjs`'s `runAsync` uses. */
const runAsync = (argv, opts) => runChild(process.execPath, argv, opts)

/**
 * `bootRig({ plan, stubs })` — the rig, bound to one fixture plan and one
 * extra-stub set: `plan` (default `FIXTURE_PLAN`) is the text committed to
 * `.ultrapowers/plan.md` by `buildOrigin`; `stubs` (default `{}`) is folded
 * into every `writeStubs` call this rig object makes.
 */
export function bootRig ({ plan = FIXTURE_PLAN, stubs = {} } = {}) {
  return {
    FIXTURE_PLAN: plan,
    ENGINE_SHA,
    MERGE_SHA,
    EXPECTED_STATUS_KEYS,
    REPO_ROOT,
    BOOT_SH,
    FACTORY_DIR,
    SKILLS_DIR,
    git,
    writeStub,
    writeGitConfig,
    buildOrigin: (root, runN) => buildOrigin(root, runN, plan),
    buildEngineDir,
    lsRemote,
    assignment,
    writeStubs: (binDir, opts = {}) => writeStubs(binDir, { ...opts, extraStubs: { ...stubs, ...(opts.extraStubs ?? {}) } }),
    baseEnv,
    makeProxyServer,
    runChild,
    runBootAsync,
    runAsync
  }
}

export { FIXTURE_PLAN, ENGINE_SHA, MERGE_SHA, EXPECTED_STATUS_KEYS }
