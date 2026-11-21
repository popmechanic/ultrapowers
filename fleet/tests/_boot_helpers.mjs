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

const SLUG = 'o-r'
const EVIDENCE_REPO = 'ops/evidence'
const EVIDENCE_URL = `https://stub.invalid/${EVIDENCE_REPO}.git`

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

function seedPastRun (evidenceDir, evidenceScratch, runN, files) {
  return pushRunFolder(evidenceDir, evidenceScratch, runN, files, `refs/tags/${SLUG}/run-${runN}`)
}

function wireEvidence (home, evidenceDir, { setting = true } = {}) {
  if (setting) fs.writeFileSync(path.join(home, 'fleet-evidence-repo'), `${EVIDENCE_REPO}\n`)
  fs.appendFileSync(path.join(home, '.gitconfig'), `[url "file://${evidenceDir}"]\n\tinsteadOf = ${EVIDENCE_URL}\n`)
}

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
  */api/v3/repos/o/r/pulls\\?head=*)
    # the open pull request of a branch: the one a POST recorded, else none
    printf '%s\\n' "$url" >> "$FLEET_HOME/pr-lookups"
    if [ -f "$FLEET_HOME/pr-post.json" ]; then
      body='[{"html_url":"https://github.com/o/r/pull/7","number":7,"user":{"login":"fleet-bot"}}]'
    else
      body='[]'
    fi
    code=200
    ;;
  */api/v3/repos/o/r/pulls)
    # pr-no-answer (one use): the POST gets no answer, as curl reports it (000). "created"
    # opens the pull request all the same; "lost" opens nothing.
    noanswer="$(cat "$FLEET_HOME/pr-no-answer" 2>/dev/null)"
    if [ "$method" = "POST" ] && [ -n "$noanswer" ]; then
      rm -f "$FLEET_HOME/pr-no-answer"
      [ "$noanswer" = "created" ] && printf %s "$data" > "$FLEET_HOME/pr-post.json"
      body=""
      code=000
    elif [ "$method" = "POST" ]; then
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

# The unit's environment is what the \`env\` words set, never this stub's inherited environment:
# \`systemd-run --user\` does not inherit the boot's exports.
: > "$FLEET_HOME/engine-env"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
if [ "$1" = "env" ]; then
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -u) shift; shift ;;
      *=*) printf '%s\\n' "$1" >> "$FLEET_HOME/engine-env"; shift ;;
      *) break ;;
    esac
  done
fi

# A case that writes \`<home>/engine-hangs\` gets an engine that never lands, so the sim can kill the boot while it runs.
if [ -f "$FLEET_HOME/engine-hangs" ]; then sleep 60; exit 0; fi

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

function claudeStub (mode, version = '2.1.287') {
  const text = mode === 'api_key' ? 'authMethod: api_key' : 'authMethod: oauth_token'
  return `#!/bin/sh\n[ "$1" = --version ] && { echo '${version} (Claude Code)'; exit 0; }\necho '${text}'\n`
}

function writeStubs (binDir, { claudeAuth, claudeVersion, extraStubs = {} } = {}) {
  writeStub(binDir, 'claude', claudeStub(claudeAuth, claudeVersion))
  writeStub(binDir, 'sudo', '#!/bin/sh\nexit 0\n')
  writeStub(binDir, 'timeout', '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$FLEET_HOME/timeout-argv"\nshift\nexec "$@"\n')
  writeStub(binDir, 'curl', CURL_STUB)
  writeStub(binDir, 'systemd-run', SYSTEMD_RUN_STUB)
  writeStub(binDir, 'systemctl', '#!/bin/sh\nexit 0\n')
  writeStub(binDir, 'journalctl', '#!/bin/sh\necho \'stub journal line\'\nexit 0\n')
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

function makeProxyServer () {
  return import('node:http').then(({ default: http }) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
  })
}

function runChild (cmd, args, { bin, home, env, timeoutMs } = {}) {
  const child = spawn(cmd, args, {
    env: simEnv({ bin, home, env }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const kill = () => {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* the group is already gone */ }
  }
  const timer = setTimeout(kill, timeoutMs ?? 120000)
  const done = new Promise((resolve) => child.on('close', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal, stdout, stderr })
  }))
  done.kill = kill
  return done
}

const runBootAsync = (opts = {}, sub = 'boot', extraEnv = {}) =>
  runChild('bash', [BOOT_SH, sub], { ...opts, env: { ...(opts.env ?? {}), ...extraEnv } })

const runAsync = (argv, opts) => runChild(process.execPath, argv, opts)

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
