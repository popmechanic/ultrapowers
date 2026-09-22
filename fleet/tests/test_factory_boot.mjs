/**
 * fleet/tests/test_factory_boot.mjs — the exam for "The boot's credential
 * probe is `factory/preflight.mjs`'s, its dead lines and its duplicate
 * merge steps are gone, and a stub-driven run leaves exactly the record the
 * contract describes" (the boot half): three end-to-end
 * `bash factory/boot.sh boot` runs, each against its own real (local,
 * bare-origin) git fixture and its own stub `bin` directory, read back
 * afterward through real `git show` / `git ls-remote` / `git ls-tree`.
 *
 * Legs, one per Machine clause:
 *
 *   (a) [M2] `claude auth status` answers `api_key` — the boot fails before
 *       ever running the engine, and the evidence branch's `status.json`
 *       records `state: "failed"` with an `error` naming `api_key`.
 *
 *   (b) [M3] a clean run: the engine stub lands one task, the PR is opened
 *       and (policy already enabling self-merge) merged, the run closes,
 *       and the tags/branches/trees the Machine names are exactly as it
 *       describes — status.json's thirteen keys, the merged sha, the
 *       events.jsonl kind order and its every row's non-empty `ts`, the PR
 *       POST body byte-equal to the exam's own rendering, the plan/evidence
 *       branches gone and their tags present, the integration tree carrying
 *       the landed file but not its stripped exam, and the evidence tree
 *       carrying that exam under `exams/`.
 *
 *   (c) [M4] the engine stub exits 3 — the boot fails with exactly
 *       `"engine exit 3"` and no plan/evidence tag is ever cut.
 *
 * M5 (the Proof's dead-line and duplicate-merge-step removal) is the
 * Proof's own `Run:` lines against `factory/boot.sh`'s text, not something
 * an end-to-end run can observe — this file does not touch it.
 *
 * The rig, once per case: a bare `origin.git` (`git init --bare`;
 * `HEAD -> refs/heads/main`) seeded via a throwaway scratch clone with a
 * `README` commit (`base`) and, on top of it, a `.ultrapowers/plan.md`
 * commit pushed only to `refs/heads/ultra/plan-run-<N>` (`plan`) — `main`
 * itself is never advanced past `base`, so `boot.sh` finds
 * `refs/remotes/origin/HEAD` at `main` the way a real target repo would.
 * `<FLEET_HOME>/target` is a plain clone of that origin. `<FLEET_HOME>/
 * engines/<sha>/factory` and `.../skills` are symlinks to this checkout's
 * own `factory/` and `skills/`, so the boot's real `factory/audit.mjs`
 * genuinely runs. A `bin` directory stubs `claude` (prints one
 * `authMethod:` line), `curl` (a small argument-sniffing router answering
 * the GitHub-shaped endpoints `boot.sh` hits), `systemd-run` (replaces the
 * whole systemd invocation: for the engine unit specifically, it either
 * lands one task — writing `widget.mjs` and `tests/test_widget.mjs`,
 * committing them into `$target`, and appending one `landing` row to
 * `$rundir/events.jsonl` — or exits the code recorded in
 * `$FLEET_HOME/engine-exit`, standing in for a real engine run) and
 * `systemctl` (a no-op). `node`, `python3`, `git` and `bash` are real. Every
 * spawned process — the fixture's own git calls and the boot itself — gets
 * `env: simEnv({ bin, home, env })` from `./_helpers.mjs`; nothing is ever
 * passed `process.env` directly.
 *
 * What this exam assumes about `factory/boot.sh`, since it is the one piece
 * of context a later reader lacks: that credential-probe failure and engine
 * failure both still route through `fail()` writing `status.json` onto the
 * evidence branch before exiting non-zero (so (a) and (c) can read it back
 * from a branch ref); that a plan commit with no `.ultrapowers/kata.json`
 * blob leaves the board unbound, so `close_run()` takes its early-return
 * path and appends exactly one `board:close` row; that `factory/
 * policy.json`'s `publish.self_merge.enabled: true` (already in this repo)
 * is what makes (b)'s merge actually happen; and that the `publish:pr`
 * event row's own `ts` field is out of this task's own diff (Context marks
 * those lines untouched) — this exam still asserts M3's "every row carries
 * a non-empty string `ts`" exactly as written, since a clause is asserted
 * as it reads, not as it is comfortable to satisfy today.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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

// ── the rig's own git plumbing ──────────────────────────────────────────

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
 * commit pushed only to `refs/heads/ultra/plan-run-<runN>`. */
function buildOrigin (root, runN) {
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
  fs.writeFileSync(path.join(scratch, '.ultrapowers', 'plan.md'), FIXTURE_PLAN)
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
  printf '{"ts":"2026-09-22T00:00:00.000Z","kind":"landing","task":1,"k":1,"examExit":0,"candidateSha":"%s"}\\n' "$sha" >> "$rundir/events.jsonl"
fi
exit "$code"
`

function claudeStub (mode) {
  const text = mode === 'api_key' ? 'authMethod: api_key' : 'authMethod: oauth_token'
  return `#!/bin/sh\necho '${text}'\n`
}

function writeStubs (binDir, { claudeAuth }) {
  writeStub(binDir, 'claude', claudeStub(claudeAuth))
  writeStub(binDir, 'curl', CURL_STUB)
  writeStub(binDir, 'systemd-run', SYSTEMD_RUN_STUB)
  writeStub(binDir, 'systemctl', '#!/bin/sh\nexit 0\n')
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
// `oauth_token` classifies as `alive` without ever reaching this server.
function makeProxyServer () {
  return import('node:http').then(({ default: http }) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
  })
}

const proxyServer = await makeProxyServer()
const PROXY_URL = `http://127.0.0.1:${proxyServer.address().port}`

// ── (a) [M2] api_key -> the boot fails before the engine ever runs ───────

{
  const runN = '501'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-m2-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, base, plan } = buildOrigin(root, runN)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'api_key' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = spawnSync('bash', [BOOT_SH, 'boot'], {
    encoding: 'utf8',
    timeout: 120000,
    env: simEnv({ bin, home, env })
  })

  assert.notEqual(
    res.status, 0,
    `(a) [M2] the boot exits non-zero on an api_key answer — got 0, stdout: ${res.stdout}, stderr: ${res.stderr}`
  )

  const statusText = git(originDir, ['show', `ultra/evidence-run-${runN}:.ultrapowers/runs/${runN}/status.json`])
  const status = JSON.parse(statusText)
  assert.equal(status.state, 'failed', '(a) [M2] status.json records state "failed"')
  assert.ok(
    typeof status.error === 'string' && status.error.includes('api_key'),
    `(a) [M2] status.json's error names api_key — got ${JSON.stringify(status.error)}`
  )
}

// ── (b) [M3] a clean run: land, open, merge, close ───────────────────────

{
  const runN = '502'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-m3-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, base, plan } = buildOrigin(root, runN)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = spawnSync('bash', [BOOT_SH, 'boot'], {
    encoding: 'utf8',
    timeout: 120000,
    env: simEnv({ bin, home, env })
  })

  assert.equal(
    res.status, 0,
    `(b) [M3] the clean run exits 0 — got ${res.status}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const landedSha = fs.readFileSync(path.join(home, 'landed-sha'), 'utf8').trim()

  const statusText = git(originDir, ['show', `ultra/evidence/run-${runN}:.ultrapowers/runs/${runN}/status.json`])
  const status = JSON.parse(statusText)
  assert.deepEqual(
    Object.keys(status), EXPECTED_STATUS_KEYS,
    `(b) [M3] status.json carries exactly the thirteen named keys, in order — got ${JSON.stringify(Object.keys(status))}`
  )
  assert.equal(status.state, 'done', '(b) [M3] status.json state is "done"')
  assert.equal(status.phase, 'the pull request was merged', '(b) [M3] status.json phase is "the pull request was merged"')
  assert.equal(status.pr, 'https://github.com/o/r/pull/7', '(b) [M3] status.json pr is the opened PR\'s URL')
  assert.equal(status.prAuthor, 'fleet-bot', '(b) [M3] status.json prAuthor is the PR\'s author login')
  assert.equal(status.merged, MERGE_SHA, '(b) [M3] status.json merged is the merge sha the stub reported')
  assert.deepEqual(
    status.tasks,
    { 1: { wave: null, state: 'folded', role: null, lastProof: null, park: null, attention: null, blockedBy: null } },
    `(b) [M3] status.json tasks is exactly the one folded task — got ${JSON.stringify(status.tasks)}`
  )

  const eventsText = git(originDir, ['show', `ultra/evidence/run-${runN}:.ultrapowers/runs/${runN}/events.jsonl`])
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  for (const [i, row] of rows.entries()) {
    assert.ok(
      typeof row.ts === 'string' && row.ts.length > 0,
      `(b) [M3] events.jsonl row ${i} (kind=${row.kind}) carries a non-empty string ts — got ${JSON.stringify(row.ts)}`
    )
  }

  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'merge', 'board:close', 'run:audit'],
    `(b) [M3] events.jsonl's non-landing kinds are exactly publish:pr, merge, board:close, run:audit in order — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )
  const [pubRow, mergeRow, closeRow] = nonLanding
  assert.equal(pubRow.url, 'https://github.com/o/r/pull/7', '(b) [M3] the publish:pr row names the PR url')
  assert.equal(pubRow.number, 7, '(b) [M3] the publish:pr row names the PR number')
  assert.equal(mergeRow.code, 200, '(b) [M3] the merge row records code 200')
  assert.equal(closeRow.what, 'run', '(b) [M3] the sole board:close row is "what":"run" (close_run\'s no-kata early return)')
  assert.equal(closeRow.code, null, '(b) [M3] the sole board:close row carries code null')

  const prPost = fs.readFileSync(path.join(home, 'pr-post.json'), 'utf8')
  const expectedBody = 'One widget, one size. It exists so the boot has a plan to carry. It benefits the record.\n\n' +
    `| 1 | 1 | 0 | ${landedSha} |\n\n` +
    'Closes #1222'
  const expectedPrPost = JSON.stringify({
    title: `fleet run-${runN}: A widget that answers its size`,
    head: `ultra/integration-run-${runN}`,
    base: 'main',
    body: expectedBody,
    draft: false
  })
  assert.equal(
    prPost, expectedPrPost,
    `(b) [M3] the PR POST payload is byte-equal to the exam's own rendering — got ${prPost}`
  )

  const tags = lsRemote(originDir, '--tags')
  assert.equal(
    tags[`refs/tags/ultra/plan/run-${runN}`], plan,
    '(b) [M3] the ultra/plan/run-<N> tag points at the plan commit'
  )
  assert.ok(
    `refs/tags/ultra/evidence/run-${runN}` in tags,
    '(b) [M3] the ultra/evidence/run-<N> tag exists'
  )

  const heads = lsRemote(originDir, '--heads')
  assert.ok(
    `refs/heads/ultra/integration-run-${runN}` in heads,
    '(b) [M3] the ultra/integration-run-<N> branch exists'
  )
  assert.ok(
    !(`refs/heads/ultra/plan-run-${runN}` in heads),
    '(b) [M3] the ultra/plan-run-<N> branch is gone'
  )
  assert.ok(
    !(`refs/heads/ultra/evidence-run-${runN}` in heads),
    '(b) [M3] the ultra/evidence-run-<N> branch is gone'
  )

  const integrationTree = git(originDir, ['ls-tree', '-r', '--name-only', `ultra/integration-run-${runN}`])
    .split('\n').filter(Boolean)
  assert.ok(
    integrationTree.includes('widget.mjs'),
    `(b) [M3] the integration tree carries the landed widget.mjs — got ${JSON.stringify(integrationTree)}`
  )
  assert.ok(
    !integrationTree.includes('tests/test_widget.mjs'),
    `(b) [M3] the integration tree no longer carries the stripped tests/test_widget.mjs — got ${JSON.stringify(integrationTree)}`
  )

  const evidenceTree = git(originDir, ['ls-tree', '-r', '--name-only', `ultra/evidence/run-${runN}`])
    .split('\n').filter(Boolean)
  assert.ok(
    evidenceTree.includes(`.ultrapowers/runs/${runN}/exams/tests/test_widget.mjs`),
    `(b) [M3] the evidence tree carries the stripped exam under exams/ — got ${JSON.stringify(evidenceTree)}`
  )
}

// ── (c) [M4] engine exit 3 -> the boot fails, no tag is ever cut ─────────

{
  const runN = '503'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-m4-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, base, plan } = buildOrigin(root, runN)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'engine-exit'), '3')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = spawnSync('bash', [BOOT_SH, 'boot'], {
    encoding: 'utf8',
    timeout: 120000,
    env: simEnv({ bin, home, env })
  })

  assert.equal(
    res.status, 3,
    `(c) [M4] the boot exits with the engine's own code 3 — got ${res.status}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const statusText = git(originDir, ['show', `ultra/evidence-run-${runN}:.ultrapowers/runs/${runN}/status.json`])
  const status = JSON.parse(statusText)
  assert.equal(status.state, 'failed', '(c) [M4] status.json records state "failed"')
  assert.equal(status.error, 'engine exit 3', '(c) [M4] status.json error is exactly "engine exit 3"')

  const tags = lsRemote(originDir, '--tags')
  assert.ok(
    !(`refs/tags/ultra/plan/run-${runN}` in tags),
    '(c) [M4] no ultra/plan/run-<N> tag is ever cut'
  )
  assert.ok(
    !(`refs/tags/ultra/evidence/run-${runN}` in tags),
    '(c) [M4] no ultra/evidence/run-<N> tag is ever cut'
  )
}

proxyServer.close()

console.log('ALL TESTS PASSED')
