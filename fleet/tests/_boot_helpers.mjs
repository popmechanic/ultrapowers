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
 * `plan` overrides the fixture plan text committed to `runs/o-r/<N>/plan.md`
 * in the evidence repository's bare (default `FIXTURE_PLAN`, the boot sim's
 * own one-task plan); `stubs` is a
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
  'run', 'state', 'phase', 'pr', 'prAuthor', 'merged',
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

// The target is always `o/r`; the operator's evidence repository `ops/evidence`,
// an owner unlike the target's, reached through `GITHUB_INT_HOST` as the boot names it.
const SLUG = 'o-r'
const EVIDENCE_REPO = 'ops/evidence'
const EVIDENCE_URL = `https://stub.invalid/${EVIDENCE_REPO}.git`

/** A parentless commit in the evidence bare whose tree is `runs/o-r/<runN>/`
 *  holding `files` (`{name: text}`), pushed to `ref`; returns its sha. */
function pushRunFolder (evidenceDir, scratch, runN, files, ref) {
  git(scratch, ['checkout', '-q', '--orphan', `folder-${runN}-${Date.now()}`])
  git(scratch, ['rm', '-rfq', '--ignore-unmatch', '.'])
  const folder = path.join(scratch, 'runs', SLUG, String(runN))
  fs.mkdirSync(folder, { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text)
  git(scratch, ['add', '-A'])
  git(scratch, ['commit', '-qm', `${SLUG}/run-${runN}`])
  git(scratch, ['push', '-q', 'origin', `HEAD:${ref}`])
  return git(scratch, ['rev-parse', 'HEAD']).trim()
}

/** Two bares: the target `origin.git`, holding only a `base` commit on `main`,
 *  and the evidence repository `evidence.git`, `main` seeded with a hand
 *  archive, taking the launcher's parentless plan commit — `runs/o-r/<runN>/plan.md`
 *  holding `planText` — on `refs/heads/live/o-r/run-<runN>`. */
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

  const evidenceDir = path.join(root, 'evidence.git')
  git(root, ['init', '--bare', evidenceDir])
  git(evidenceDir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  const evidenceScratch = path.join(root, 'evidence-scratch')
  git(root, ['clone', evidenceDir, evidenceScratch])
  git(evidenceScratch, ['config', 'user.email', 'fleet@exe.dev'])
  git(evidenceScratch, ['config', 'user.name', 'fleet'])
  fs.mkdirSync(path.join(evidenceScratch, 'archive'))
  fs.writeFileSync(path.join(evidenceScratch, 'archive', 'README'), 'the hand archive\n')
  git(evidenceScratch, ['add', '-A'])
  git(evidenceScratch, ['commit', '-m', 'seed'])
  git(evidenceScratch, ['push', 'origin', 'HEAD:refs/heads/main'])

  const plan = pushRunFolder(evidenceDir, evidenceScratch, runN, { 'plan.md': planText }, `refs/heads/live/${SLUG}/run-${runN}`)

  return { originDir, evidenceDir, evidenceScratch, base, plan }
}

/** An earlier run's record: a parentless commit holding `runs/o-r/<runN>/`
 *  with `files`, tagged `o-r/run-<runN>` in the evidence bare. */
function seedPastRun (evidenceDir, evidenceScratch, runN, files) {
  return pushRunFolder(evidenceDir, evidenceScratch, runN, files, `refs/tags/${SLUG}/run-${runN}`)
}

/** What the first-boot setup script leaves: `<home>/fleet-evidence-repo`
 *  naming `ops/evidence` (unless `setting` is false), plus the case HOME's
 *  `.gitconfig` routing that repository's URL to the local evidence bare. */
function wireEvidence (home, evidenceDir, { setting = true } = {}) {
  if (setting) fs.writeFileSync(path.join(home, 'fleet-evidence-repo'), `${EVIDENCE_REPO}\n`)
  fs.appendFileSync(path.join(home, '.gitconfig'), `[url "file://${evidenceDir}"]\n\tinsteadOf = ${EVIDENCE_URL}\n`)
}

/** Every ref of a bare, `{ref: sha}`, read with `for-each-ref` (no `HEAD`). */
function refsOf (bareDir) {
  const map = {}
  for (const line of git(bareDir, ['for-each-ref', '--format=%(refname) %(objectname)']).split('\n')) {
    if (!line.trim()) continue
    const [ref, sha] = line.split(' ')
    map[ref] = sha
  }
  return map
}

function buildEngineDir (home, engineSha) {
  const engineDir = path.join(home, 'engines', engineSha)
  fs.mkdirSync(engineDir, { recursive: true })
  // `factory` is a real directory of symlinks to the real files, plus its own
  // `node_modules`, so the boot's `engine_deps` returns without running npm and
  // nothing is written into the checkout's own `factory/`.
  const factoryDir = path.join(engineDir, 'factory')
  fs.mkdirSync(factoryDir)
  for (const entry of fs.readdirSync(FACTORY_DIR)) {
    if (entry === 'node_modules') continue
    fs.symlinkSync(path.join(FACTORY_DIR, entry), path.join(factoryDir, entry))
  }
  fs.mkdirSync(path.join(factoryDir, 'node_modules'))
  fs.symlinkSync(SKILLS_DIR, path.join(engineDir, 'skills'), 'dir')
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
      tip="$(git -C "$FLEET_HOME/target" ls-remote origin 'refs/heads/ultra/integration-run-*' 2>/dev/null | head -n 1 | cut -f 1)"
      stale="$(cat "$FLEET_HOME/stale-heads" 2>/dev/null || echo 0)"
      if [ "$stale" -gt 0 ] 2>/dev/null; then
        printf %s "$((stale - 1))" > "$FLEET_HOME/stale-heads"
        head=0000000000000000000000000000000000000000
      else
        head="$tip"
        [ -n "$tip" ] && : > "$FLEET_HOME/pushed-head-seen"
      fi
      body=$(printf '{"mergeable":true,"head":{"sha":"%s"}}' "$head")
      code=200
    else
      body=""
      code=404
    fi
    ;;
  */api/v3/repos/o/r/pulls/7/merge)
    if [ "$method" = "PUT" ]; then
      printf %s "$data" > "$FLEET_HOME/merge-put.json"
      if [ -f "$FLEET_HOME/stale-heads" ] && [ ! -f "$FLEET_HOME/pushed-head-seen" ]; then
        body='{"message":"Pull Request is not mergeable"}'
        code=405
      else
        body=$(printf '{"sha":"%s","message":"Pull Request successfully merged"}' "$MERGE_SHA")
        code=200
      fi
    else
      body=""
      code=404
    fi
    ;;
  */reap)
    if [ "$method" = "POST" ]; then
      printf %s "$data" > "$FLEET_HOME/reap-post.json"
      body='{"status":202}'
      code=202
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
printf '%s\\n' "$@" > "$FLEET_HOME/engine-argv"

code=0
if [ -f "$FLEET_HOME/engine-exit" ]; then code="$(cat "$FLEET_HOME/engine-exit")"; fi

if [ "$code" = "0" ] && [ ! -f "$FLEET_HOME/engine-lands-nothing" ]; then
  printf '%s\\n' "export const size = () => 1" > "$target/widget.mjs"
  mkdir -p "$target/tests"
  printf '%s\\n' "export const t = 1" > "$target/tests/test_widget.mjs"
  ( cd "$target" && git add -A && git commit -m "task 1" -q ) || exit 1
  sha="$(cd "$target" && git rev-parse HEAD)"
  printf %s "$sha" > "$FLEET_HOME/landed-sha"
  mkdir -p "$rundir"
  printf '{"ts":"2026-09-22T00:00:00.000Z","kind":"landing","task":1,"candidateSha":"%s"}\\n' "$sha" >> "$rundir/events.jsonl"
fi
exit "$code"
`

function claudeStub (mode) {
  const text = mode === 'api_key' ? 'authMethod: api_key' : 'authMethod: oauth_token'
  return `#!/bin/sh\necho '${text}'\n`
}

// The `/pulls/7` GET names as `head.sha` the origin's tip of the run's integration
// branch. A case that writes `<home>/stale-heads` (a count) gets that many GETs naming
// forty zeros first, and every `/pulls/7/merge` PUT answers 405 until a GET has named
// the pushed tip (the live catch-up of runs 264/265).

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
    FLEET_COMMIT_SECONDS: '1'
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
    SLUG,
    EVIDENCE_REPO,
    buildOrigin: (root, runN) => buildOrigin(root, runN, plan),
    seedPastRun,
    wireEvidence,
    refsOf,
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
