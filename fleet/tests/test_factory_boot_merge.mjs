/**
 * fleet/tests/test_factory_boot_merge.mjs — the exam for "The boot merges a
 * green run's pull request — after folding again if main moved — and leaves
 * every other one open".
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_boot_merge.mjs`,
 * written where the Proof names it. It drives the real `factory/boot.sh boot`
 * as a child process, with `curl`, `git`, `npm`, `claude`, `systemd-run`,
 * `systemctl`, `node`, `python3`, `tar`, `sha256sum` and `kata` stubs put
 * first on its `PATH` — the same stub-on-`PATH` shape the earlier boot exams
 * use. `git` and `python3` are thin stubs that log their argv and then
 * delegate to the box's real binaries (found dynamically off `simEnv()`'s own
 * `PATH`, never a hardcoded absolute path): the "target" repository is a real
 * local bare git repository, so every clone/checkout/fetch/push/worktree the
 * script does is a real git operation against real refs, and the policy read
 * (`factory/policy.json` in the fake engine checkout) is read by a real
 * `python3`, whatever exact invocation the implementation chooses. `curl`,
 * `node`, `systemd-run` and `claude` are fully canned, since their call
 * shapes and required answers are pinned by the Machine text. Every stub logs
 * its own argv (and, for `curl`, method/URL/body) to a file under
 * `$FLEET_HOME`; assertions read those logs, never timing.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — the boot merges only when the engine's exit code was 0, no
 *        `hold=1`, and `publish.self_merge.enabled` is true; otherwise it
 *        publishes exactly as before and sends no merge request.
 *   M2 — before any merge, and again after any refused one, it fetches the
 *        default branch and compares tips; when they differ it refolds via
 *        `node …/engine.mjs --refold --plan … --target … --base <base>
 *        --onto <tip> --run-dir … --exams-dir <evidence>/<rel>/exams`, and on
 *        exit 0 force-pushes the target's HEAD to the run's branch with
 *        `--force-with-lease` and takes the tip as the new base; on any other
 *        exit it parks with a phase naming the re-fold's reason and merges
 *        nothing.
 *   M3 — it waits for `GET /pulls/<n>`'s `mergeable` to stop being `null`
 *        (bounded by `mergeable_wait_seconds`), then `PUT
 *        /pulls/<n>/merge` with `merge_method:squash`, a `commit_title` of
 *        `fleet run-<N>: <plan H1> (#<n>)` and `sha` the pushed head, no
 *        `authorization` header.
 *   M4 — a 405/409 answer repeats M2+M3, capped at `max_refolds` merge
 *        requests total; otherwise the pull request stays open, parked.
 *   M5 — after a merge, `status.json`'s `merged` is the merge commit and its
 *        state is `done`, the hub close's `evidence` carries the commit
 *        beside the pull request entry, and the evidence tags are pushed
 *        after both; without a merge `merged` stays `null`.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] a1: green/unheld/enabled — one PUT, correct body, no
 *       authorization header, no --refold. a2/a3/a4: hold=1 / engine exit 2 /
 *       policy disabled — no PUT.
 *   (b) [M2] b1: tip moved, refold exits 0 — the refold argv, then the
 *       force-with-lease push, then the PUT, in that order. b2: refold exits
 *       3 — no PUT, state parked, phase names "red".
 *   (c) [M3] mergeable answers null, null, true — the PUT comes after the
 *       third GET.
 *   (d) [M4] d1: 405 then 200 — two PUTs with a fetch between them. d2: 405
 *       forever with max_refolds=3 — exactly three PUTs, parked. d3: 422 —
 *       one PUT, parked.
 *   (e) [M5] e1: the merge PUT answers a sha and merged:true — status.json's
 *       merged is that sha, state done, the hub close evidence is
 *       `[{type:'pr',...},{type:'commit',sha:...}]`, and the tag pushes come
 *       after both the merge and the close. e2: hold=1 — merged stays null.
 *
 * Two assumptions worth writing down, because they are not fixed by the
 * Machine text and a later session would otherwise have to rediscover them:
 *
 *   — Every new curl call this task adds (the merge PUT, the mergeable GET)
 *     is assumed to answer its HTTP status on a trailing `\n%{http_code}`
 *     line, exactly the shape `publish()`'s existing PR-create POST and
 *     `close_run()`'s existing close POST already use — the curl stub always
 *     answers that two-line shape.
 *   — "it fetches the default branch" (M2) is measured as any `git fetch`
 *     call the merge loop issues (not one naming `main` in its argv), since
 *     an implementation may fetch via a bare `git fetch origin` refspec-free
 *     call; the ordering checks below hinge on a fetch occurring strictly
 *     *between* two merge PUTs, a place only the merge loop's own recheck
 *     would put one.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BOOT_SCRIPT = path.resolve(HERE, '..', '..', 'factory', 'boot.sh')

// ── fixed facts every case is built from ──────────────────────────────────
const RUN_N = '7'
const TARGET = 'acme/t'
const ENGINE_SHA = 'c3'.repeat(20)
const PLAN_H1 = 'Boot merges a green run'
const MERGE_SHA = 'f6'.repeat(20)
const PR_NUMBER = 1
const GITHUB_HOST = 'github.int.exe.xyz'
const PR_URL = `https://${GITHUB_HOST}/${TARGET}/pull/${PR_NUMBER}`
const KATA_PROJECT_ID = 42
const KATA_RUN_UID = 'R7'
const KATA_JSON = JSON.stringify({ name: 'acme-t-kata', id: KATA_PROJECT_ID, run: { uid: KATA_RUN_UID } })
const PLAN_TEXT = `# ${PLAN_H1}\n\n**Summary:** an exam plan for the merge boot.\n\n**Goal:** exercise the merge path.\n`

// ── the real interpreters, found off simEnv()'s own computed PATH — never a
//    hardcoded absolute path ─────────────────────────────────────────────
function realBinDir (name) {
  for (const dir of simEnv().PATH.split(path.delimiter)) {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK)
      return dir
    } catch {
      // keep looking
    }
  }
  throw new Error(`no real ${name} found on the sim PATH`)
}
const REAL_GIT = path.join(realBinDir('git'), 'git')
const REAL_PYTHON3 = path.join(realBinDir('python3'), 'python3')

// ── a real git command against a real path, for building fixtures and for
//    reading back what the boot actually pushed ──────────────────────────
function git (cwd, argv) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', env: simEnv() })
  if (r.status !== 0) throw new Error(`git ${argv.join(' ')} in ${cwd} failed: ${r.stderr || r.stdout}`)
  return r.stdout
}
const gitRevParse = (repo, ref) => git(repo, ['rev-parse', ref]).trim()

// ── the stub-on-PATH rig ──────────────────────────────────────────────────
const PRELUDE = [
  'say() { printf "%s CALL %s\\n" "$(date -u +%H:%M:%SZ)" "$1" >>"$FLEET_HOME/fleet-boot.log"; }',
  'argv() {',
  '  local n="$1"; shift',
  '  { printf "%s\\t" "$n"; for a in "$@"; do printf "%s\\t" "$a"; done; printf "\\n"; } >>"$FLEET_HOME/$n.log"',
  '}',
].join('\n')

const GIT_STUB = [
  'argv "git" "$@"',
  'args=()',
  'for a in "$@"; do',
  '  if [ "$a" = "$STUB_GITHUB_CLONE_URL" ]; then a="$STUB_ORIGIN_PATH"; fi',
  '  args+=("$a")',
  'done',
  'verb="${args[0]:-}"',
  'if [ "$verb" = "-C" ]; then verb="${args[2]:-}"; fi',
  'case "$verb" in',
  '  fetch) say "git fetch" ;;',
  '  push)',
  '    for a in "${args[@]}"; do',
  '      case "$a" in',
  '        refs/tags/*|*:refs/tags/*) say "git push tag" ;;',
  '        --force-with-lease*) say "git push force-with-lease" ;;',
  '      esac',
  '    done',
  '    ;;',
  'esac',
  'exec "$STUB_REAL_GIT" "${args[@]}"',
].join('\n')

const CURL_STUB = [
  'argv "curl" "$@"',
  'url=""; method="GET"; payload=""; prev=""',
  'for a in "$@"; do',
  '  case "$a" in https://*|http://*) url="$a" ;; esac',
  '  if [ "$prev" = "-X" ]; then method="$a"; fi',
  '  if [ "$prev" = "-d" ]; then payload="$a"; fi',
  '  prev="$a"',
  'done',
  'bump() {',
  '  f="$FLEET_HOME/stub/$1"; n=0',
  '  [ -f "$f" ] && n=$(cat "$f")',
  '  n=$((n + 1)); echo "$n" >"$f"; echo "$n"',
  '}',
  'case "$url" in',
  '  */api/v3/repos/*/pulls/*/merge)',
  '    n=$(bump merge)',
  '    say "curl pr merge"',
  '    printf "%s\\n" "$payload" >>"$FLEET_HOME/merge.log"',
  '    codes="${STUB_MERGE_CODES:-200}"',
  '    code=""; i=0',
  '    for c in $codes; do i=$((i + 1)); if [ "$i" -le "$n" ]; then code="$c"; fi; done',
  '    case "$code" in',
  '      2??) printf "{\\"sha\\":\\"%s\\",\\"merged\\":true}\\n%s\\n" "$STUB_MERGE_SHA" "$code" ;;',
  '      *) printf "{\\"message\\":\\"refused\\"}\\n%s\\n" "$code" ;;',
  '    esac',
  '    ;;',
  '  */api/v3/repos/*/pulls/*)',
  '    n=$(bump mergeable)',
  '    say "curl pr read"',
  '    nulls="${STUB_MERGEABLE_NULLS:-0}"',
  '    m=true',
  '    if [ "$n" -le "$nulls" ]; then m=null; fi',
  '    printf "{\\"number\\":%s,\\"mergeable\\":%s}\\n200\\n" "$STUB_PR_NUMBER" "$m"',
  '    ;;',
  '  */api/v3/repos/*/pulls)',
  '    say "curl pr create"',
  '    printf "%s\\n" "$payload" >>"$FLEET_HOME/pr.log"',
  '    prcode="${STUB_PR_CREATE_CODE:-201}"',
  '    printf "{\\"html_url\\":\\"%s\\",\\"number\\":%s}\\n%s\\n" "$STUB_PR_URL" "$STUB_PR_NUMBER" "$prcode"',
  '    ;;',
  '  *kata.int.exe.xyz*/actions/close)',
  '    say "curl kata close"',
  '    printf "%s\\n" "$payload" >>"$FLEET_HOME/kata-close.log"',
  '    kcode="${STUB_KATA_CLOSE_CODE:-200}"',
  '    printf "{\\"ok\\":true}\\n%s\\n" "$kcode"',
  '    ;;',
  '  *reflection.int.exe.xyz*)',
  '    printf "{\\"name\\":\\"fleet-vm\\"}\\n200\\n"',
  '    ;;',
  '  *claude-max.int.exe.xyz*)',
  '    printf "{}\\n200\\n"',
  '    ;;',
  '  *)',
  '    say "curl UNKNOWN"',
  '    exit 22',
  '    ;;',
  'esac',
].join('\n')

const NODE_STUB = [
  'argv "node" "$@"',
  'refold=0; target=""; onto=""; prev=""',
  'for a in "$@"; do',
  '  case "$a" in --refold) refold=1 ;; esac',
  '  case "$prev" in',
  '    --target) target="$a" ;;',
  '    --onto) onto="$a" ;;',
  '  esac',
  '  prev="$a"',
  'done',
  'if [ "$refold" != 1 ]; then',
  '  say "node DIRECT"',
  '  exit 0',
  'fi',
  'say "node refold"',
  'code="${STUB_REFOLD_EXIT:-0}"',
  'if [ "$code" = 0 ] && [ -n "$target" ]; then',
  '  "$STUB_REAL_GIT" -C "$target" checkout -q -B fold-work "$onto"',
  '  printf "refolded\\n" > "$target/REFOLDED.txt"',
  '  "$STUB_REAL_GIT" -C "$target" add REFOLDED.txt',
  '  "$STUB_REAL_GIT" -C "$target" -c user.email=fold@example.com -c user.name=fold commit -q -m "refold onto $onto"',
  'fi',
  'printf "%s\\n" "$STUB_REFOLD_LINE"',
  'exit "$code"',
].join('\n')

const SYSTEMD_RUN_STUB = [
  'argv "systemd-run" "$@"',
  'unit=""',
  'for a in "$@"; do',
  '  case "$a" in --unit=*) unit="${a#--unit=}" ;; esac',
  'done',
  'case "$unit" in',
  '  fleet-engine-*)',
  '    say "systemd-run engine"',
  '    tgt="$FLEET_HOME/target"',
  '    printf "candidate\\n" > "$tgt/CANDIDATE.txt"',
  '    "$STUB_REAL_GIT" -C "$tgt" add CANDIDATE.txt',
  '    "$STUB_REAL_GIT" -C "$tgt" -c user.email=engine@example.com -c user.name=engine commit -q -m "engine: candidate landing"',
  '    exit "${STUB_ENGINE_EXIT:-0}"',
  '    ;;',
  '  *)',
  '    say "systemd-run UNKNOWN"',
  '    exit 0',
  '    ;;',
  'esac',
].join('\n')

const CLAUDE_STUB = [
  'argv "claude" "$@"',
  'if [ "${1:-}" = "auth" ] && [ "${2:-}" = "status" ]; then',
  '  printf "authMethod: oauth_token\\napiProvider: firstParty\\n"',
  '  exit 0',
  'fi',
  'exit 0',
].join('\n')

const PYTHON3_STUB = [
  'argv "python3" "$@"',
  'exec "$STUB_REAL_PYTHON3" "$@"',
].join('\n')

const trivialStub = (name) => [
  `argv "${name}" "$@"`,
  'exit 0',
].join('\n')

const STUBS = {
  curl: CURL_STUB,
  git: GIT_STUB,
  node: NODE_STUB,
  'systemd-run': SYSTEMD_RUN_STUB,
  claude: CLAUDE_STUB,
  python3: PYTHON3_STUB,
  npm: trivialStub('npm'),
  systemctl: trivialStub('systemctl'),
  tar: trivialStub('tar'),
  sha256sum: trivialStub('sha256sum'),
  kata: trivialStub('kata'),
}

function writeStub (binDir, name, body) {
  const file = path.join(binDir, name)
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${PRELUDE}\n${body}\n`)
  fs.chmodSync(file, 0o755)
}

// ── fixtures: a real bare "origin" repo, a fake engine checkout, a bin dir of
//    stubs — one fresh tree per case ──────────────────────────────────────
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-boot-merge-'))
process.on('exit', () => { try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }) } catch { /* left for the reaper */ } })

function makeOrigin (caseDir, { withKata = false } = {}) {
  const originPath = path.join(caseDir, 'origin.git')
  fs.mkdirSync(originPath, { recursive: true })
  git(caseDir, ['init', '--quiet', '--bare', '--initial-branch=main', originPath])

  const scratch = path.join(caseDir, 'scratch')
  fs.mkdirSync(scratch, { recursive: true })
  git(caseDir, ['clone', '--quiet', originPath, scratch])
  const gc = (argv) => git(scratch, argv)
  const ident = ['-c', 'user.email=seed@example.com', '-c', 'user.name=seed']

  fs.writeFileSync(path.join(scratch, 'README.md'), '# target\n')
  gc(['add', 'README.md'])
  gc([...ident, 'commit', '-q', '-m', 'seed'])
  gc(['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  const baseSha = gc(['rev-parse', 'HEAD']).trim()

  gc(['checkout', '-q', '-b', 'ultra/plan-run-7'])
  fs.mkdirSync(path.join(scratch, '.ultrapowers'), { recursive: true })
  fs.writeFileSync(path.join(scratch, '.ultrapowers', 'plan.md'), PLAN_TEXT)
  if (withKata) fs.writeFileSync(path.join(scratch, '.ultrapowers', 'kata.json'), KATA_JSON)
  gc(['add', '.ultrapowers'])
  gc([...ident, 'commit', '-q', '-m', 'plan'])
  gc(['push', '-q', 'origin', 'HEAD:refs/heads/ultra/plan-run-7'])
  const planSha = gc(['rev-parse', 'HEAD']).trim()
  gc(['checkout', '-q', 'main'])

  return { originPath, scratch, baseSha, planSha }
}

/** Push one more commit onto origin's main, simulating "main moved". Returns the new tip. */
function advanceMain (ctx) {
  const gc = (argv) => git(ctx.scratch, argv)
  gc(['checkout', '-q', 'main'])
  gc(['pull', '-q', 'origin', 'main'])
  fs.writeFileSync(path.join(ctx.scratch, 'MOVED.txt'), 'moved\n')
  gc(['add', 'MOVED.txt'])
  gc(['-c', 'user.email=seed@example.com', '-c', 'user.name=seed', 'commit', '-q', '-m', 'main moved'])
  gc(['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  return gc(['rev-parse', 'HEAD']).trim()
}

function makeCase (name, { withKata = false } = {}) {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `case-${name}-`))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(path.join(dir, 'stub'), { recursive: true })
  for (const [n, body] of Object.entries(STUBS)) writeStub(bin, n, body)

  const engineDir = path.join(dir, 'engines', ENGINE_SHA)
  fs.mkdirSync(path.join(engineDir, 'fleet', 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(engineDir, 'skills', 'ultrapowers', 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(engineDir, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py'), '')
  fs.mkdirSync(path.join(engineDir, 'factory'), { recursive: true })
  fs.writeFileSync(path.join(engineDir, 'factory', 'engine.mjs'), '')

  const origin = makeOrigin(dir, { withKata })
  return { dir, bin, engineDir, ...origin }
}

function writePolicy (ctx, { enabled = true, maxRefolds = 5, mergeableWaitSeconds = 30 } = {}) {
  const doc = { publish: { self_merge: { enabled, max_refolds: maxRefolds, mergeable_wait_seconds: mergeableWaitSeconds } } }
  fs.writeFileSync(path.join(ctx.engineDir, 'factory', 'policy.json'), JSON.stringify(doc, null, 2))
}

function bootEnv (ctx, env = {}) {
  return {
    ...simEnv({ bin: ctx.bin, home: ctx.dir }),
    FLEET_COMMIT_SECONDS: '1',
    FLEET_KATA_WAIT_SECONDS: '1',
    STUB_GITHUB_CLONE_URL: `https://${GITHUB_HOST}/${TARGET}.git`,
    STUB_ORIGIN_PATH: ctx.originPath,
    STUB_REAL_GIT: REAL_GIT,
    STUB_REAL_PYTHON3: REAL_PYTHON3,
    STUB_PR_URL: PR_URL,
    STUB_PR_NUMBER: String(PR_NUMBER),
    STUB_MERGE_SHA: MERGE_SHA,
    ...env,
  }
}

function runBoot (ctx, env = {}) {
  const assignment = env.FLEET_ASSIGNMENT ??
    `run=${RUN_N} plan=${ctx.planSha} target=${TARGET} base=${ctx.baseSha} engine=${ENGINE_SHA}`
  const full = bootEnv(ctx, { FLEET_ASSIGNMENT: assignment, ...env })
  return spawnSync('bash', [BOOT_SCRIPT, 'boot'], { encoding: 'utf8', env: full, timeout: 90000 })
}

// ── log readers ────────────────────────────────────────────────────────────
const streamLines = (ctx) => fs.readFileSync(path.join(ctx.dir, 'fleet-boot.log'), 'utf8').split('\n').filter(Boolean)
const idxOf = (lines, needle) => lines.findIndex((l) => l.includes(needle))
const nthIdxOf = (lines, needle, n) => {
  let c = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) { c += 1; if (c === n) return i }
  }
  return -1
}
const lastIdxOf = (lines, needle) => {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].includes(needle)) return i
  return -1
}
const countOf = (lines, needle) => lines.filter((l) => l.includes(needle)).length
const readLines = (ctx, name) => {
  const f = path.join(ctx.dir, name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}
const argvLines = (ctx, name) => readLines(ctx, `${name}.log`).map((l) => l.split('\t').filter((s) => s !== ''))
const flagVal = (call, name) => { const i = call.indexOf(name); return i >= 0 ? call[i + 1] : undefined }
const statusOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.dir, 'evidence', '.ultrapowers', 'runs', RUN_N, 'status.json'), 'utf8'))
const heldAssignment = (ctx) =>
  `run=${RUN_N} plan=${ctx.planSha} target=${TARGET} base=${ctx.baseSha} engine=${ENGINE_SHA} hold=1`

// ── a. [M1] gate: green/unheld/enabled merges; hold, red, or disabled don't ─
{
  const ctx = makeCase('a1')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '200', STUB_MERGEABLE_NULLS: '0' })
  assert.equal(r.status, 0, `(a) [M1] a green, unheld, enabled run's boot exits 0 (stderr: ${r.stderr})`)

  const lines = streamLines(ctx)
  const createIdx = idxOf(lines, 'CALL curl pr create')
  assert.ok(createIdx >= 0, '(a) [M1] the pull request POST happened')
  const readIdx = idxOf(lines, 'CALL curl pr read')
  assert.ok(readIdx > createIdx, '(a) [M3] the GET /pulls/<n> happens after the PR POST')
  const putIdx = idxOf(lines, 'CALL curl pr merge')
  assert.ok(putIdx > readIdx, '(a) [M3] the PUT merge happens after the GET')
  assert.equal(countOf(lines, 'CALL curl pr merge'), 1, '(a) [M1] exactly one PUT is sent on the green, enabled, unheld path')
  assert.equal(countOf(lines, 'CALL node refold'), 0, '(a) [M2] no refold is attempted when the tip has not moved')

  const merges = readLines(ctx, 'merge.log').map((l) => JSON.parse(l))
  assert.equal(merges.length, 1, '(a) [M3] one merge payload was recorded')
  const body = merges[0]
  assert.equal(body.merge_method, 'squash', '(a) [M3] the merge body\'s merge_method is squash')
  assert.equal(body.commit_title, `fleet run-7: ${PLAN_H1} (#1)`, '(a) [M3] the commit_title is "fleet run-<N>: <plan H1> (#<n>)"')
  const pushedHead = gitRevParse(ctx.originPath, 'refs/heads/ultra/integration-run-7')
  assert.equal(body.sha, pushedHead, '(a) [M3] the merge body\'s sha is the pushed head')

  const mergeCall = argvLines(ctx, 'curl').find((c) => c.some((t) => t.includes('/merge')))
  assert.ok(mergeCall, '(a) [M3] the merge PUT argv was logged')
  assert.ok(mergeCall.some((t) => t.toUpperCase() === 'PUT'), '(a) [M3] the merge request is a PUT')
  assert.ok(
    !mergeCall.some((t) => /^authorization/i.test(t)),
    '(a) [M3] the merge PUT carries no authorization header'
  )
}
{
  const ctx = makeCase('a2')
  writePolicy(ctx, { enabled: true })
  const r = runBoot(ctx, { FLEET_ASSIGNMENT: heldAssignment(ctx), STUB_ENGINE_EXIT: '0' })
  assert.equal(r.status, 0, `(a) [M1] a held run's boot still exits 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 0, '(a) [M1] a held run (hold=1) sends no merge PUT')
}
{
  const ctx = makeCase('a3')
  writePolicy(ctx, { enabled: true })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '2' })
  assert.equal(r.status, 0, `(a) [M1] a non-green run's boot still exits 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 0, '(a) [M1] a non-green (engine exit 2) run sends no merge PUT')
}
{
  const ctx = makeCase('a4')
  writePolicy(ctx, { enabled: false })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0' })
  assert.equal(r.status, 0, `(a) [M1] a run with self_merge disabled still exits 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 0, '(a) [M1] a run whose policy.json disables self_merge sends no merge PUT')
}

// ── b. [M2] the re-fold: base/onto/exams-dir, ordering, and a red re-fold ──
{
  const ctx = makeCase('b1')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const tip = advanceMain(ctx)
  const r = runBoot(ctx, {
    STUB_ENGINE_EXIT: '0',
    STUB_REFOLD_EXIT: '0',
    STUB_REFOLD_LINE: JSON.stringify({ refolded: true, head: 'ignored', onto: tip }),
    STUB_MERGE_CODES: '200',
  })
  assert.equal(r.status, 0, `(b) [M2] a run that refolds cleanly still exits the boot with 0 (stderr: ${r.stderr})`)

  const refoldCall = argvLines(ctx, 'node').find((c) => c.includes('--refold'))
  assert.ok(refoldCall, '(b) [M2] node was invoked with --refold')
  assert.equal(flagVal(refoldCall, '--base'), ctx.baseSha, '(b) [M2] the refold is invoked with --base <the run\'s base>')
  assert.equal(flagVal(refoldCall, '--onto'), tip, '(b) [M2] the refold is invoked with --onto <the moved default-branch tip>')
  assert.equal(
    flagVal(refoldCall, '--exams-dir'),
    path.join(ctx.dir, 'evidence', '.ultrapowers', 'runs', RUN_N, 'exams'),
    '(b) [M2] the refold is invoked with --exams-dir <evidence dir>/<evidence rel path>/exams'
  )

  const lines = streamLines(ctx)
  const refoldIdx = idxOf(lines, 'CALL node refold')
  const pushIdx = idxOf(lines, 'CALL git push force-with-lease')
  const putIdx = idxOf(lines, 'CALL curl pr merge')
  assert.ok(refoldIdx >= 0, '(b) [M2] the re-fold ran')
  assert.ok(pushIdx > refoldIdx, '(b) [M2] the force-with-lease push happens after the re-fold')
  assert.ok(putIdx > pushIdx, '(b) [M2] the merge PUT happens after the force-with-lease push')
}
{
  const ctx = makeCase('b2')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  advanceMain(ctx)
  const r = runBoot(ctx, {
    STUB_ENGINE_EXIT: '0',
    STUB_REFOLD_EXIT: '3',
    STUB_REFOLD_LINE: JSON.stringify({ reason: 'red' }),
  })
  assert.equal(r.status, 0, `(b) [M2] a run whose re-fold comes back red still exits the boot with 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 0, '(b) [M2] no merge PUT is sent when the re-fold exits red')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', '(b) [M2] the final state is parked when the re-fold exits red')
  assert.ok(status.phase.includes('red'), `(b) [M2] the phase names the re-fold's reason (red); got ${JSON.stringify(status.phase)}`)
}

// ── c. [M3] the mergeable wait: null, null, true, then the PUT ─────────────
{
  const ctx = makeCase('c1')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '200', STUB_MERGEABLE_NULLS: '2' })
  assert.equal(r.status, 0, `(c) [M3] boot still exits 0 while it waits out a null mergeable (stderr: ${r.stderr})`)
  const lines = streamLines(ctx)
  assert.equal(countOf(lines, 'CALL curl pr read'), 3, '(c) [M3] exactly three GETs were made (two null, one true) before the PUT')
  const thirdRead = nthIdxOf(lines, 'CALL curl pr read', 3)
  const putIdx = idxOf(lines, 'CALL curl pr merge')
  assert.ok(putIdx > thirdRead, '(c) [M3] the PUT merge comes after the third GET, once mergeable stopped answering null')
}

// ── d. [M4] 405/409 retries a fetch+refold+merge, capped at max_refolds ────
{
  const ctx = makeCase('d1')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '405 200' })
  assert.equal(r.status, 0, `(d) [M4] a run answered 405 then 200 still exits the boot with 0 (stderr: ${r.stderr})`)
  const lines = streamLines(ctx)
  assert.equal(countOf(lines, 'CALL curl pr merge'), 2, '(d) [M4] a 405 is answered by exactly one more merge attempt')
  const put1 = idxOf(lines, 'CALL curl pr merge')
  const put2 = nthIdxOf(lines, 'CALL curl pr merge', 2)
  const fetchBetween = lines.slice(put1 + 1, put2).some((l) => l.includes('CALL git fetch'))
  assert.ok(fetchBetween, '(d) [M4] a fresh fetch-and-compare of the default branch happens between the two PUTs')
}
{
  const ctx = makeCase('d2')
  writePolicy(ctx, { enabled: true, maxRefolds: 3, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '405' })
  assert.equal(r.status, 0, `(d) [M4] a run that exhausts its refolds still exits the boot with 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 3, '(d) [M4] at most max_refolds (3) merge requests are sent in all')
  assert.equal(statusOf(ctx).state, 'parked', '(d) [M4] the pull request stays open (parked) once the refolds are exhausted')
}
{
  const ctx = makeCase('d3')
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '422' })
  assert.equal(r.status, 0, `(d) [M4] a run refused with 422 still exits the boot with 0 (stderr: ${r.stderr})`)
  assert.equal(countOf(streamLines(ctx), 'CALL curl pr merge'), 1, '(d) [M4] a non-405/409 refusal (422) is not retried')
  assert.equal(statusOf(ctx).state, 'parked', '(d) [M4] the pull request stays open (parked) after a 422')
}

// ── e. [M5] status.json, the hub close's evidence, and the tag ordering ────
{
  const ctx = makeCase('e1', { withKata: true })
  writePolicy(ctx, { enabled: true, maxRefolds: 5, mergeableWaitSeconds: 30 })
  const r = runBoot(ctx, { STUB_ENGINE_EXIT: '0', STUB_MERGE_CODES: '200' })
  assert.equal(r.status, 0, `(e) [M5] a merged, done run still exits the boot with 0 (stderr: ${r.stderr})`)

  const status = statusOf(ctx)
  assert.equal(status.merged, MERGE_SHA, '(e) [M5] status.json\'s merged is the merge commit sha GitHub returned')
  assert.equal(status.state, 'done', '(e) [M5] status.json\'s state is done once merged')

  const closes = readLines(ctx, 'kata-close.log').map((l) => JSON.parse(l))
  assert.equal(closes.length, 1, '(e) [M5] the hub close was sent once')
  assert.deepEqual(
    closes[0].evidence,
    [{ type: 'pr', url: PR_URL }, { type: 'commit', sha: MERGE_SHA }],
    '(e) [M5] the hub close\'s evidence carries the pull request entry, then the merge commit'
  )

  const lines = streamLines(ctx)
  const mergeIdx = idxOf(lines, 'CALL curl pr merge')
  const closeIdx = idxOf(lines, 'CALL curl kata close')
  const lastTagIdx = lastIdxOf(lines, 'CALL git push tag')
  assert.ok(lastTagIdx >= 0, '(e) [M5] the evidence tags were pushed')
  assert.ok(lastTagIdx > mergeIdx, '(e) [M5] the evidence tags are pushed after the merge')
  assert.ok(lastTagIdx > closeIdx, '(e) [M5] the evidence tags are pushed after the hub close')
}
{
  const ctx = makeCase('e2', { withKata: true })
  writePolicy(ctx, { enabled: true })
  const r = runBoot(ctx, { FLEET_ASSIGNMENT: heldAssignment(ctx), STUB_ENGINE_EXIT: '0' })
  assert.equal(r.status, 0, `(e) [M5] a held drive still exits the boot with 0 (stderr: ${r.stderr})`)
  assert.equal(statusOf(ctx).merged, null, '(e) [M5] status.json\'s merged stays null on a held (unmerged) drive')
}

console.log('ALL TESTS PASSED')
