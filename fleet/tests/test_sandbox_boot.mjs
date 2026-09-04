/**
 * Exam for `fleet/sandbox-boot.sh` — the sandbox side of a run, end to end,
 * against stub binaries.
 *
 * The script's whole job is ORDER: which external call happens before which
 * state is claimed. So every stub appends one line to the SAME log the script
 * writes its own state lines to (`$FLEET_HOME/fleet-boot.log`), and the
 * ordering assertions below are index comparisons in that one stream. Each stub
 * additionally writes a tab-separated argv line to its own log, which is where
 * the literal-argv assertions read.
 *
 * No network, no systemd, no real `claude`: `FLEET_BIN_DIR` is prepended to
 * PATH and `FLEET_HOME` relocates every path the script touches. The engine is
 * where the bootstrap would have put it — `$FLEET_HOME/engines/<sha>` — and
 * the assignment arrives the way the bootstrap hands it over, in
 * `FLEET_ASSIGNMENT`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'sandbox-boot.sh')

// ── the run's literals ───────────────────────────────────────────────────────

const PLAN_SHA = 'a1'.repeat(20)
const BASE_SHA = 'b2'.repeat(20)
const ENGINE_SHA = 'c3'.repeat(20)
/** The pushed head of the integration branch — what `git rev-parse` answers
 *  and what the edge's branches endpoint has to report before the PR POST. */
const HEAD_SHA = 'd4'.repeat(20)
const TARGET = 'popmechanic/smoke'
const VM_NAME = 'fleet-r7-2609032215-a1b2'
const PR_URL = 'https://github.com/popmechanic/smoke/pull/1'
const PR_AUTHOR = 'popmechanic'
/** What GitHub answers a POST /pulls with, in its own field order: the PR's
 *  `html_url` and its `user` (the author) come before the head/base
 *  repositories, which carry the same field names for other things. */
const PR_JSON = JSON.stringify({
  url: 'https://api.github.com/repos/popmechanic/smoke/pulls/1',
  id: 1,
  node_id: 'PR_x',
  html_url: PR_URL,
  diff_url: `${PR_URL}.diff`,
  number: 1,
  state: 'open',
  user: { login: PR_AUTHOR, id: 2, html_url: 'https://github.com/popmechanic' },
  head: { ref: 'ultra/integration-run-7', user: { login: 'not-the-author' }, repo: { html_url: 'https://github.com/popmechanic/smoke' } },
  base: { ref: 'main', user: { login: 'not-the-author-either' } }
})
const PLAN_H1 = 'Smoke: the fleet proves itself'
const ASSIGNMENT =
  `run=7 plan=${PLAN_SHA} target=${TARGET} base=${BASE_SHA} engine=${ENGINE_SHA} ` +
  'overlap=fold tier=mostCapable'

// ── stub bin dir ─────────────────────────────────────────────────────────────

const STUBS = {
  // Reflection, notify, and the GitHub edge's PR endpoint. `$1..` carries the
  // URL as the only https:// word; a POST carries its payload after `-d`. The
  // PR answer is the body, then the status code on its own line — the shape
  // `-w '\\n%{http_code}'` makes real curl print.
  curl: `
argv "curl" "$@"
url=""; payload=""; prev=""
for a in "$@"; do
  case "$a" in https://*) url="$a" ;; esac
  [ "$prev" = "-d" ] && payload="$a"
  prev="$a"
done
bump() {
  f="$FLEET_HOME/stub/$1"; n=0
  [ -f "$f" ] && n=$(cat "$f")
  n=$((n + 1)); echo "$n" >"$f"; echo "$n"
}
case "$url" in
  *reflection.int.exe.xyz/)
    say "curl name"; printf '{"name":"%s"}\\n' "$STUB_VM_NAME" ;;
  */email)
    say "curl email"; printf '{"email":"op@example.com"}\\n' ;;
  */comment)
    n=$(bump comment); say "curl comment $n"
    printf '{"comment":"%s"}\\n' "$STUB_COMMENT" ;;
  */integrations)
    n=$(bump integrations); say "curl integrations $n"
    # Reflection's shape: each github integration names its repository inside
    # its help string. fleet-runs names its own TWICE in one string, which is
    # one integration, not a duplicate. STUB_DUPE adds a second integration
    # naming the target — the fault the preflight exists to refuse.
    dupe=""
    [ -n "\${STUB_DUPE:-}" ] && dupe=',{"type":"github","name":"t-popmechanic-smoke-rw","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}'
    printf '{"integrations":[{"type":"http-proxy","name":"claude-max","help":"ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz"},{"type":"github","name":"fleet-runs","help":"git clone https://github.int.exe.xyz/popmechanic/fleet-runs.git or push to https://github.int.exe.xyz/popmechanic/fleet-runs.git"},{"type":"github","name":"gh-popmechanic-smoke","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}%s]}\\n' "$dupe" ;;
  *github.int.exe.xyz/api/v3/repos/*/branches/*)
    # GitHub's index catching up with the push: 404 for the first
    # STUB_BRANCH_404 reads (forever under STUB_BRANCH_NEVER), then the branch
    # document — its own \`commit.sha\` first, the nested tree sha after it.
    n=$(bump branches); say "curl branches $n"
    if [ -n "\${STUB_BRANCH_NEVER:-}" ] || [ "$n" -le "\${STUB_BRANCH_404:-0}" ]; then
      printf '{"message":"Branch not found"}\\n404\\n'
    else
      printf '{"name":"ultra/integration-run-7","commit":{"sha":"%s","commit":{"tree":{"sha":"%s"}}}}\\n200\\n' "$STUB_HEAD_SHA" "\${STUB_TREE_SHA:-tree}"
    fi ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls)
    say "curl pr create"; printf '%s\\n' "$payload" >>"$FLEET_HOME/pr.log"
    printf '%s\\n%s\\n' "$STUB_PR_BODY" "\${STUB_PR_CODE:-201}" ;;
  *notify.int.exe.xyz*)
    say "curl notify"; printf '%s\\n' "$payload" >>"$FLEET_HOME/notify.log"; printf 'ok\\n' ;;
  *) say "curl UNKNOWN $url"; exit 22 ;;
esac
`,
  // Records argv; makes the directories a real clone would.
  git: `
argv "git" "$@"
say "git $*"
case "$1" in
  clone)
    url="$2"; dir="$3"
    mkdir -p "$dir/.git"
    case "$url" in
      *fleet-runs*) mkdir -p "$dir/plans"; printf '# %s\\n\\nbody\\n' "$STUB_PLAN_H1" >"$dir/plans/run-7.md" ;;
    esac
    case "\${STUB_CLONE_404:-}" in
      "$url") printf 'remote: Repository not found.\\nfatal: 404\\n' >&2; rm -rf "$dir"; exit 128 ;;
    esac
    case "\${STUB_CLONE_FAIL:-}" in
      "$url") printf 'fatal: boom\\n' >&2; rm -rf "$dir"; exit 128 ;;
    esac ;;
  -C)
    case "$3 $4" in
      "config user.email") exit 1 ;;
    esac
    # Does HEAD already contain the plan commit? A fresh clone of fleet-runs
    # sits on main, which does — the plan was pushed before the VM was copied.
    case "$3 $4" in
      "merge-base --is-ancestor") [ -n "\${STUB_PLAN_NOT_IN_HEAD:-}" ] && exit 1
                                  exit 0 ;;
    esac
    case "$3" in
      rev-list) if [ -n "\${STUB_NO_COMMITS:-}" ]; then echo 0; else echo 3; fi; exit 0 ;;
      # The pushed head — what the branches endpoint has to echo back.
      rev-parse) printf '%s\\n' "$STUB_HEAD_SHA"; exit 0 ;;
      # What the remote advertised as HEAD at clone time; \`none\` is a remote
      # that advertised nothing.
      symbolic-ref) [ "\${STUB_HEAD_REF:-}" = none ] && exit 1
                    printf '%s\\n' "\${STUB_HEAD_REF:-refs/remotes/origin/main}"; exit 0 ;;
    esac
    # A commit is the moment the evidence becomes readable off the box, so
    # snapshot the status page exactly as it is committed.
    case "$3" in
      commit) [ -f "$2/runs/7/status.json" ] && cat "$2/runs/7/status.json" >>"$FLEET_HOME/commits.log" ;;
    esac ;;
esac
exit 0
`,
  // Never called: the PR is one REST POST through curl. A CALL line from gh
  // is a finding.
  gh: `say "gh DIRECT $*"; exit 0`,
  // Two transient services. The status server is started and forgotten; the
  // engine is run to completion. The engine stub records its own environment —
  // which is the BOOT SCRIPT'S, because the child's two Anthropic variables
  // ride in this stub's argv (an \`env\` prefix), not in its environment.
  'systemd-run': `
argv "systemd-run" "$@"
unit=""
for a in "$@"; do case "$a" in --unit=*) unit="\${a#--unit=}" ;; esac; done
case "$unit" in
  fleet-status) say "systemd-run status"; exit 0 ;;
esac
env >"$FLEET_HOME/systemd-run.env"
say "systemd-run engine"
run_dir="$FLEET_HOME/target/.claude/ultrapowers/run-run-7"
mkdir -p "$run_dir" "$FLEET_HOME/target/fleet-receipts/run-7"
printf '{"kind":"engine:phase","phase":"gate","id":"x","ts":1}\\n' >"$run_dir/events.jsonl"
# The engine talks on stdout and stderr, and a run that dies before its gate
# leaves nothing else behind.
printf 'run-main: preflight\\n'
printf 'run-main: knob-validate-failed\\n' >&2
if [ -z "\${STUB_NO_RECEIPT:-}" ]; then
  printf '{"verdict":"%s"}\\n' "$STUB_VERDICT" >"$FLEET_HOME/target/fleet-receipts/run-7/gate-receipt.json"
  printf '{"stamp":"run-7"}\\n' >"$run_dir/report.json"
  printf '{"argsFile":"x"}\\n' >"$run_dir/receipt.json"
fi
[ -n "\${STUB_ENGINE_SLEEP:-}" ] && sleep "$STUB_ENGINE_SLEEP"
exit \${STUB_ENGINE_CODE:-0}
`,
  systemctl: `
argv "systemctl" "$@"
say "systemctl $2 $3"
if [ "$2" = "is-active" ]; then
  case "$3" in
    fleet-status.service) printf '%s\\n' "\${STUB_STATUS_ACTIVE:-inactive}" ;;
    fleet-engine-*) printf '%s\\n' "\${STUB_ENGINE_ACTIVE:-inactive}" ;;
    *) printf 'inactive\\n' ;;
  esac
fi
exit 0
`,
  npm: `
argv "npm" "$@"
say "npm $1 in $PWD"
exit 0
`,
  claude: `
say "claude $1 $2"
printf 'authMethod: %s\\napiProvider: firstParty\\n' "\${STUB_AUTH:-oauth_token}"
exit 0
`,
  // Never called directly by the boot script: busybox and node are argv to
  // systemd-run, and loginctl is the golden's. A CALL line from any of them is
  // a finding.
  busybox: `say "busybox DIRECT $*"; exit 0`,
  node: `say "node DIRECT $*"; exit 0`,
  loginctl: `say "loginctl DIRECT $*"; exit 0`,
}

const PRELUDE = `#!/bin/sh
say() { printf '%s CALL %s\\n' "$(date -u +%H:%M:%SZ)" "$1" >>"$FLEET_HOME/fleet-boot.log"; }
argv() { name="$1"; shift; { for a in "$name" "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >>"$FLEET_HOME/$name.log"; }
`

// ── harness ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-boot-'))
let caseNo = 0

function makeHome({ packageJson = '{"name":"fleet"}', nodeModules = true } = {}) {
  caseNo += 1
  const home = path.join(tmpRoot, `home-${caseNo}`)
  const bin = path.join(home, 'bin')
  fs.mkdirSync(path.join(home, 'stub'), { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  // The bootstrap's clone, at the sha the assignment names.
  const engine = path.join(home, 'engines', ENGINE_SHA, 'fleet')
  fs.mkdirSync(engine, { recursive: true })
  fs.writeFileSync(path.join(engine, 'run-main.mjs'), '')
  fs.writeFileSync(path.join(engine, 'package.json'), packageJson)
  if (nodeModules) fs.mkdirSync(path.join(engine, 'node_modules'))
  return { home, bin }
}

function boot(ctx, args = ['boot'], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: ctx.home,
      FLEET_HOME: ctx.home,
      FLEET_BIN_DIR: ctx.bin,
      FLEET_POLL_SECONDS: '0',
      FLEET_STATUS_INTERVAL: '30',
      FLEET_ASSIGNMENT: ASSIGNMENT,
      // In the boot script's OWN environment, to prove the child's `env -u`
      // removes it and that the two Anthropic variables are never here.
      CLAUDE_CONFIG_DIR: '/should/be/unset/in/the/child',
      STUB_VM_NAME: VM_NAME,
      STUB_COMMENT: ASSIGNMENT,
      STUB_VERDICT: 'PASS',
      STUB_PR_BODY: PR_JSON,
      STUB_PLAN_H1: PLAN_H1,
      STUB_HEAD_SHA: HEAD_SHA,
      ...env,
    },
    timeout: 60000,
  })
}

const readLog = (ctx, name) => {
  const f = path.join(ctx.home, name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
const lines = (text) => text.split('\n').filter(Boolean)
const argvLines = (ctx, tool) =>
  lines(readLog(ctx, `${tool}.log`)).map((l) => l.split('\t').filter((s) => s !== ''))
const stream = (ctx) => lines(readLog(ctx, 'fleet-boot.log')).map((l) => l.replace(/^\S+ /, ''))
const statusOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.home, 'www', 'status.json'), 'utf8'))
const states = (ctx) => {
  const out = []
  for (const l of stream(ctx)) {
    const m = /^status: state=(\S+)/.exec(l)
    if (m && out[out.length - 1] !== m[1]) out.push(m[1])
  }
  return out
}
const indexOf = (ctx, needle) => stream(ctx).findIndex((l) => l.includes(needle))
const lastIndexOf = (ctx, needle) => {
  const s = stream(ctx)
  for (let i = s.length - 1; i >= 0; i -= 1) if (s[i].includes(needle)) return i
  return -1
}
const notifies = (ctx) => lines(readLog(ctx, 'notify.log')).map((l) => JSON.parse(l))
const committed = (ctx) => lines(readLog(ctx, 'commits.log')).map((l) => JSON.parse(l))
const unitsRun = (ctx) => argvLines(ctx, 'systemd-run').map((a) => a.find((s) => s.startsWith('--unit='))?.slice(7))
const engineRuns = (ctx) => unitsRun(ctx).filter((u) => u === 'fleet-engine-7').length
const directCalls = (ctx) => stream(ctx).filter((l) => l.includes(' DIRECT '))
/** Every POST /pulls the script made, as its parsed JSON payload. */
const prPosts = (ctx) => lines(readLog(ctx, 'pr.log')).map((l) => JSON.parse(l))
/** The curl argv of the PR POST, or undefined. */
const prArgv = (ctx) => argvLines(ctx, 'curl').find((a) => a.some((s) => s.endsWith('/pulls')))
/** How many times Reflection's /integrations was read. */
const integrationsReads = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl integrations')).length

const tests = []
const test = (name, fn) => tests.push([name, fn])

// One green run, read by every assertion that only reads. A boot is ~40 forks
// of stub shell; running it eight times to ask eight questions of the same run
// is the difference between a test that fits its budget and one that does not.
let GREEN = null
const green = () => {
  if (!GREEN) {
    GREEN = makeHome()
    const r = boot(GREEN)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  return GREEN
}

test('the boot script parses', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0)
})

// ── 1. the whole green path ──────────────────────────────────────────────────

test('a gate-green run walks booting → running → publishing → done', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_STATUS_INTERVAL: '1', STUB_ENGINE_SLEEP: '2' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'], 'no grant to await')

  const status = statusOf(ctx)
  assert.equal(status.run, '7')
  assert.equal(status.state, 'done')
  assert.equal(status.branch, 'ultra/integration-run-7')
  assert.equal(status.vm, VM_NAME, 'the page names the VM incarnation, read from Reflection')
  assert.equal(status.pr, PR_URL, 'the PR is .html_url of the REST answer')
  assert.equal(status.prAuthor, PR_AUTHOR, 'and .user.login is recorded — a bot-authored PR is a fact on the page')
  assert.equal(status.error, null)
  assert.match(status.startedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(status.updatedAt, /^\d{4}-\d{2}-\d{2}T/)

  // The status page's phase is refreshed from the engine's own event log while
  // the engine runs — the last `engine:phase` line, not a guess.
  assert.ok(stream(ctx).some((l) => l === 'status: state=running phase=gate'),
    'expected a phase refresh from events.jsonl:\n' + stream(ctx).join('\n'))
  assert.deepEqual(directCalls(ctx), [], 'busybox, node, loginctl and gh are never run by this script')
})

test('two github integrations naming one repository fail the run before any clone', () => {
  // Measured 2026-09-03: the GitHub edge routes by repo path and documents no
  // tie-break between two integrations covering the same repo — a push under
  // the wrong credential is the result. The box refuses at second zero.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_DUPE: '1' })
  assert.notEqual(r.status, 0, 'a duplicate is fatal')
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /two github integrations on this VM name one repository/)
  assert.ok(status.error.includes('github.int.exe.xyz/popmechanic/smoke.git'), 'the error names the duplicated repo: ' + status.error)
  assert.ok(!status.error.includes('fleet-runs.git'), 'one integration naming its repo twice in its own help string is not a duplicate')
  assert.equal(readLog(ctx, 'git.log'), '', 'nothing is cloned — the preflight is before the clones')
  assert.equal(engineRuns(ctx), 0)
  assert.equal(integrationsReads(ctx), 1, 'one read of /integrations')
  assert.ok(indexOf(ctx, 'assignment: run-7') < indexOf(ctx, 'CALL curl integrations'), 'read after the assignment is parsed')
  assert.deepEqual(notifies(ctx).map((n) => n.title), ['run-7 failed'])
})

test('the status page is its own transient service, started once, before anything else', () => {
  const ctx = green()
  const H = ctx.home
  const status = argvLines(ctx, 'systemd-run').filter((a) => a.includes('--unit=fleet-status'))
  assert.equal(status.length, 1)
  assert.deepEqual(status[0], [
    'systemd-run', '--user', '--unit=fleet-status', '-p', 'Restart=on-failure', '--',
    'busybox', 'httpd', '-f', '-p', '8000', '-h', `${H}/www`,
  ])
  assert.ok(indexOf(ctx, 'CALL systemd-run status') < indexOf(ctx, 'status: state=booting'))
  // Asked first, so a restart never starts a second server on the port.
  assert.ok(argvLines(ctx, 'systemctl').some((a) => a.join(' ') === 'systemctl --user is-active fleet-status.service'))
})

test('a status server that is already active is not started again', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_STATUS_ACTIVE: 'active' }).status, 0)
  assert.deepEqual(unitsRun(ctx), ['fleet-engine-7'], 'only the engine is started')
  // The boot script IS the run unit's process (fleet-run@7.service); it asks
  // systemd only about the engine unit and the page, never about itself.
  assert.ok(!argvLines(ctx, 'systemctl').some((a) => a.some((s) => s.includes('fleet-run'))),
    'no systemctl call names the run unit')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('fleet-status.service already active'))
})

test('the assignment comes from FLEET_ASSIGNMENT; Reflection is asked only for the name', () => {
  const ctx = green()
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 0,
    'the bootstrap already read the comment; this script does not read it again')
  assert.ok(indexOf(ctx, 'CALL curl name') >= 0)
})

test('the clones are fleet-runs first, then the target at base — the engine is never cloned', () => {
  const ctx = green()
  const git = argvLines(ctx, 'git')
  const H = ctx.home

  // fleet-runs FIRST — it is where a failure gets recorded.
  assert.deepEqual(git[0], ['git', 'clone',
    'https://github.int.exe.xyz/popmechanic/fleet-runs.git', `${H}/fleet-runs`])
  assert.deepEqual(git[1], ['git', '-C', `${H}/fleet-runs`, 'fetch', 'origin'])
  assert.deepEqual(git[2], ['git', '-C', `${H}/fleet-runs`, 'merge-base', '--is-ancestor', PLAN_SHA, 'HEAD'])
  assert.deepEqual(git[3], ['git', '-C', `${H}/fleet-runs`, 'checkout', '--force', PLAN_SHA, '--', 'plans'])
  assert.deepEqual(git[4], ['git', 'clone',
    `https://github.int.exe.xyz/${TARGET}.git`, `${H}/target`])
  assert.deepEqual(git[5], ['git', '-C', `${H}/target`, 'checkout', BASE_SHA])

  // The engine is the bootstrap's: no git command names it.
  assert.deepEqual(git.filter((a) => a.join(' ').includes('/engines/')), [])
  assert.deepEqual(git.filter((a) => a.join(' ').includes('ultrapowers.git')), [])

  // HEAD already contained the plan commit, so nothing moved HEAD — the plan
  // file is pinned by the path-scoped checkout alone.
  assert.equal(git.filter((a) => a.includes('--detach')).length, 0)

  // The clone is LEFT at base: the integration branch is the engine's to create.
  assert.equal(git.filter((a) => a.includes('switch')).length, 0)
  assert.deepEqual(
    git.filter((a) => a.join(' ').includes('ultra/integration-run-7')).map((a) => a[3]),
    ['rev-list', 'push', 'rev-parse'],
    'the run branch is only counted against base, pushed, and read back for its head — never created or switched to')
})

test('the engine is a transient service with the contract argv; only its child env carries the Anthropic pair', () => {
  const ctx = green()
  const H = ctx.home
  const engine = argvLines(ctx, 'systemd-run').filter((a) => a.includes('--unit=fleet-engine-7'))
  assert.equal(engine.length, 1)
  assert.deepEqual(engine[0], [
    'systemd-run', '--user', '--unit=fleet-engine-7', '--pipe', '--wait', '--collect',
    '-p', 'MemoryMax=40G', '-p', 'MemorySwapMax=0', '-p', `WorkingDirectory=${H}/target`, '--',
    'env', '-u', 'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz',
    'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    'ULTRAPOWERS_FLEET_RUN=run-7',
    'node', `${H}/engines/${ENGINE_SHA}/fleet/run-main.mjs`,
    `${H}/fleet-runs/plans/run-7.md`, 'run-7', '--repo', `${H}/target`,
    '--tier', 'mostCapable', '--overlap', 'fold',
  ])
  assert.equal(argvLines(ctx, 'systemd-run').filter((a) => a.includes('--scope')).length, 0, 'never a scope')

  // The environment the engine's launcher inherited — i.e. the boot script's —
  // carries neither variable. The golden holds no ANTHROPIC_* and neither does
  // this script; the pair exists only as the child's `env` prefix above.
  const childless = readLog(ctx, 'systemd-run.env')
  assert.ok(!/^ANTHROPIC_BASE_URL=/m.test(childless), 'boot env must not carry ANTHROPIC_BASE_URL')
  assert.ok(!/^CLAUDE_CODE_OAUTH_TOKEN=/m.test(childless), 'boot env must not carry the OAuth var')
  // …and CLAUDE_CONFIG_DIR is present in the boot env precisely so the child's
  // `env -u` above is doing real work.
  assert.ok(/^CLAUDE_CONFIG_DIR=/m.test(childless))

  // `claude auth status` is logged before the engine starts.
  assert.ok(indexOf(ctx, 'CALL claude auth status') >= 0)
  assert.ok(indexOf(ctx, 'CALL claude auth status') < indexOf(ctx, 'CALL systemd-run engine'))
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('claude auth status: authMethod: oauth_token'))
  assert.equal(readLog(ctx, 'npm.log'), '', 'node_modules present: nothing to install')
})

test('missing deps are installed in the engine checkout when its package.json declares any', () => {
  const ctx = makeHome({ packageJson: '{"dependencies":{"ws":"8"}}', nodeModules: false })
  assert.equal(boot(ctx).status, 0)
  assert.deepEqual(argvLines(ctx, 'npm'), [['npm', 'install', '--no-audit', '--no-fund']],
    'no lockfile in the tree, so install rather than ci')
  assert.ok(stream(ctx).some((l) => l === `CALL npm install in ${ctx.home}/engines/${ENGINE_SHA}/fleet`))
  assert.ok(indexOf(ctx, 'CALL npm install') < indexOf(ctx, 'CALL systemd-run engine'))
})

test('an engine checkout the bootstrap did not leave fails the run before anything runs', () => {
  const ctx = makeHome()
  fs.rmSync(path.join(ctx.home, 'engines'), { recursive: true })
  const r = boot(ctx)
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /no fleet\/run-main\.mjs/)
  assert.equal(engineRuns(ctx), 0)
  assert.equal(committed(ctx)[0].state, 'failed', 'recorded in fleet-runs, which was cloned first')
})

test('publishing is claimed only after systemd reports the engine service inactive', () => {
  const ctx = green()
  const check = indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service')
  const claim = indexOf(ctx, 'status: state=publishing')
  assert.ok(check >= 0, 'the service must be checked')
  assert.ok(claim >= 0)
  assert.ok(check < claim, 'the inactive check precedes the publishing claim')
  assert.ok(argvLines(ctx, 'systemctl').some((a) =>
    a.join(' ') === 'systemctl --user is-active fleet-engine-7.service'))
  assert.equal(argvLines(ctx, 'systemctl').filter((a) => a.join(' ').includes('.scope')).length, 0)
})

test('the branch is pushed after the engine is inactive, and the PR is one REST POST through the edge', () => {
  const ctx = green()
  const inactive = indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service')
  const push = indexOf(ctx, `${ctx.home}/target push origin ultra/integration-run-7`)
  const pr = indexOf(ctx, 'CALL curl pr create')
  assert.ok(push > inactive, 'the branch is pushed only after the engine service is inactive')
  assert.ok(pr > push, 'the PR follows the push')

  // Nothing is polled after the gate: /integrations was read once, in the
  // preflight, before the first clone.
  assert.equal(integrationsReads(ctx), 1, 'one read of /integrations, ever')
  assert.ok(indexOf(ctx, 'CALL curl integrations') < indexOf(ctx, 'git clone'), 'and that read is before any clone')

  const H = ctx.home
  const gitPush = argvLines(ctx, 'git').find((a) => a[1] === '-C' && a[3] === 'push' && a[2] === `${H}/target`)
  assert.deepEqual(gitPush, ['git', '-C', `${H}/target`, 'push', 'origin', 'ultra/integration-run-7'])

  // The REST call: POST, the edge's /api/v3 path for the target, a JSON
  // content type, and the payload inline after -d. gh is never run.
  const curl = prArgv(ctx)
  assert.ok(curl, 'a curl to /pulls was made')
  assert.ok(curl.includes('-X') && curl[curl.indexOf('-X') + 1] === 'POST', 'it is a POST')
  assert.ok(curl.includes(`https://github.int.exe.xyz/api/v3/repos/${TARGET}/pulls`), 'to the edge, under /api/v3/repos/<owner>/<repo>')
  assert.ok(curl.includes('-H') && curl[curl.indexOf('-H') + 1] === 'content-type: application/json', 'as JSON')
  assert.ok(curl.includes('-d'), 'with a payload')
  assert.equal(argvLines(ctx, 'gh').length, 0, 'gh is not used')
  assert.ok(stream(ctx).some((l) => l.includes('symbolic-ref refs/remotes/origin/HEAD')), 'the base is read from the clone')

  const posts = prPosts(ctx)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].title, `fleet run-7: ${PLAN_H1}`)
  assert.equal(posts[0].head, 'ultra/integration-run-7')
  assert.equal(posts[0].base, 'main', 'base is what origin/HEAD pointed at')
  assert.equal(posts[0].draft, false, 'PASS is a ready PR')
  const body = posts[0].body
  // The rendered card, less the trailing newline a command substitution drops.
  assert.equal(body, fs.readFileSync(path.join(H, 'fleet-runs', 'runs', '7', 'pr-body.md'), 'utf8').trimEnd(), 'the body is the rendered card')
  assert.ok(body.includes('PASS'), 'the card carries the verdict')
  assert.ok(body.includes('### Checks'), 'the card carries the checks')
  assert.ok(body.includes(VM_NAME), 'the card names the VM')
  assert.ok(body.includes('https://github.com/popmechanic/fleet-runs/tree/main/runs/7/'),
    'the card links the evidence')

  // Both halves of the answer are logged, so a bot-authored PR is readable
  // off the box.
  assert.ok(stream(ctx).some((l) => l === `publish: ${PR_URL} (base main, draft false)`))
  assert.ok(stream(ctx).some((l) => l === `publish: author ${PR_AUTHOR}`))
})

test('the PR is opened only after the edge reports the pushed head on the branch', () => {
  // GitHub's index lags the push, and a PR opened before the branch is indexed
  // gets no `pull_request` CI run (#595). The edge answers 404 twice, then the
  // branch document with the pushed sha — and only then is /pulls asked.
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_BRANCH_404: '2' }).status, 0)
  const s = stream(ctx)
  const push = indexOf(ctx, `${ctx.home}/target push origin ultra/integration-run-7`)
  const reads = s.map((l, i) => (l.startsWith('CALL curl branches') ? i : -1)).filter((i) => i >= 0)
  const pr = indexOf(ctx, 'CALL curl pr create')
  assert.equal(reads.length, 3, 'two 404s and one 200 — polling stops at the first match')
  assert.ok(reads[0] > push, 'the branch is asked for only after it is pushed')
  assert.ok(reads[2] < pr, 'the POST follows the 200')

  // In the curl argv log the three branch reads sit between the push and the
  // POST, and the POST is the very next curl after the last of them.
  const curls = argvLines(ctx, 'curl')
  const branchUrl = `https://github.int.exe.xyz/api/v3/repos/${TARGET}/branches/ultra/integration-run-7`
  const branchIdx = curls.map((a, i) => (a.includes(branchUrl) ? i : -1)).filter((i) => i >= 0)
  const prIdx = curls.findIndex((a) => a.some((u) => u.endsWith('/pulls')))
  assert.equal(branchIdx.length, 3)
  assert.equal(prIdx, branchIdx[2] + 1, 'the PR POST is the next curl after the branch became visible')
  assert.ok(!curls[branchIdx[0]].includes('-f'), 'a 404 is an answer, not a curl failure')
  assert.ok(!curls[branchIdx[0]].includes('-X'), 'the branch read is a GET')
  assert.ok(s.some((l) => /^publish: branch ultra\/integration-run-7 visible at the edge as d4d4.* after \d+s$/.test(l)),
    'one line says when the branch became visible: ' + s.filter((l) => l.startsWith('publish:')).join(' | '))
  assert.ok(!s.some((l) => l.includes('not yet visible')), 'no timeout was logged')
  assert.equal(prPosts(ctx).length, 1)
  assert.equal(statusOf(ctx).state, 'done')
})

test('a branch the edge never shows within the wait still gets its PR, and the timeout is logged', () => {
  // A PR without a CI run is one the operator can re-trigger by hand; no PR
  // is nothing to re-trigger. Three seconds of wait at a zero poll step is
  // four reads, then the POST anyway.
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_BRANCH_NEVER: '1', PUBLISH_BRANCH_WAIT: '3' }).status, 0)
  const s = stream(ctx)
  const reads = s.filter((l) => l.startsWith('CALL curl branches')).length
  assert.equal(reads, 4, 'polled for the whole wait, then gave up')
  assert.ok(lastIndexOf(ctx, 'CALL curl branches') < indexOf(ctx, 'CALL curl pr create'), 'the POST follows the last read')
  assert.ok(s.some((l) => l === `publish: branch ultra/integration-run-7 not yet visible at the edge as ${HEAD_SHA} after 3s — opening the PR anyway; its CI run may need a re-trigger`),
    'the timeout is one log line: ' + s.filter((l) => l.startsWith('publish:')).join(' | '))
  assert.ok(!s.some((l) => l.includes(' visible at the edge as ') && !l.includes('not yet')), 'no "became visible" line')
  assert.equal(prPosts(ctx).length, 1, 'the PR is opened anyway')
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(statusOf(ctx).pr, PR_URL)
})

test('the base is the default branch the clone advertised, whatever it is called', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_HEAD_REF: 'refs/remotes/origin/master' }).status, 0)
  assert.equal(prPosts(ctx)[0].base, 'master')

  // A remote that advertised no HEAD is a failure, not a guess: a PR against
  // a guessed branch is refused by GitHub or, worse, opened against the wrong
  // one.
  const none = makeHome()
  const r = boot(none, ['boot'], { STUB_HEAD_REF: 'none' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(none).state, 'failed')
  assert.match(statusOf(none).error, /default branch/)
  assert.equal(prPosts(none).length, 0, 'no PR is attempted without a base')
})

test('a non-2xx answer from the PR endpoint fails the run with the body quoted', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_PR_CODE: '422',
    STUB_PR_BODY: '{"message":"Validation Failed","errors":[{"message":"A pull request already exists for popmechanic:ultra/integration-run-7."}]}',
  })
  assert.notEqual(r.status, 0)
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /POST \/repos\/popmechanic\/smoke\/pulls answered 422/)
  assert.ok(status.error.includes('A pull request already exists'), 'GitHub\'s own words: ' + status.error)
  assert.equal(status.pr, null, 'no PR is recorded')
  assert.equal(committed(ctx)[committed(ctx).length - 1].state, 'failed')
})

test('the status page is committed at publishing and again at done', () => {
  // The receipts are in fleet-runs before the push, so a publish that dies
  // leaves its verdict somewhere other than a VM the janitor will delete.
  const ctx = green()
  const c = committed(ctx)
  assert.ok(c.length >= 2, 'at least the publishing and the done commits')
  assert.equal(c[0].state, 'publishing')
  assert.equal(c[0].pr, null)
  assert.equal(c[0].prAuthor, null)
  assert.equal(c[0].vm, VM_NAME)
  assert.equal(c[c.length - 1].state, 'done')
  assert.equal(c[c.length - 1].pr, PR_URL)
  assert.equal(c[c.length - 1].prAuthor, PR_AUTHOR)
})

test('the evidence lands in fleet-runs and is committed and pushed', () => {
  const ctx = green()
  const H = ctx.home
  const dir = path.join(H, 'fleet-runs', 'runs', '7')
  for (const f of ['gate-receipt.json', 'report.json', 'events.jsonl', 'receipt.json', 'status.json', 'engine.log']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `runs/7/${f} must be collected`)
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'gate-receipt.json'), 'utf8')).verdict, 'PASS')

  const git = argvLines(ctx, 'git')
  const add = git.find((a) => a[3] === 'add')
  assert.deepEqual(add, ['git', '-C', `${H}/fleet-runs`, 'add', '--', 'runs/7'])
  const commits = git.filter((a) => a[3] === 'commit')
  assert.ok(commits.length >= 1, 'the receipts are committed')
  assert.ok(commits[0].join(' ').includes('run-7: gate-green receipts'))
  const pushes = git.filter((a) => a[3] === 'push' && a[2] === `${H}/fleet-runs`)
  assert.ok(pushes.length >= 1)
  assert.deepEqual(pushes[0], ['git', '-C', `${H}/fleet-runs`, 'push', 'origin', 'HEAD:main'])
})

test('the notification names the run, the outcome, the target and the PR', () => {
  const ctx = green()
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], 'one notification: the PR is the thing to act on, and there is no grant to ask for')
})

// ── 2. parked runs ───────────────────────────────────────────────────────────

test('a non-PASS gate receipt parks the run and opens a draft PR', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'parked'])
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.prAuthor, PR_AUTHOR)
  assert.equal(status.error, 'parked: gate verdict NEEDS_ACK')

  assert.equal(prPosts(ctx)[0].draft, true, 'a parked run publishes a DRAFT PR')
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 parked', message: `${TARGET} — ${PR_URL}` },
  ])
})

test('a run with nothing ahead of base is parked without publishing — no push, no PR', () => {
  // run-69: every task blocked, branch == BASE, GitHub refuses an empty PR.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'parked'], 'never publishing')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.pr, null)
  assert.match(status.error, /no commits ahead of base \(verdict NEEDS_ACK\)/)
  assert.equal(integrationsReads(ctx), 1, 'only the preflight read /integrations; nothing is polled after the gate')
  assert.equal(prPosts(ctx).length, 0, 'no PR is attempted')
  assert.equal(argvLines(ctx, 'git').filter((a) => a[3] === 'push' && a[2] === `${ctx.home}/target`).length, 0,
    'the empty branch is not pushed')
  // The verdict was still read after the engine was seen to be inactive.
  assert.ok(indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service') < indexOf(ctx, 'status: state=parked'))
  const c = committed(ctx)
  assert.equal(c.length, 1)
  assert.equal(c[0].state, 'parked')
  assert.ok(fs.existsSync(path.join(ctx.home, 'fleet-runs', 'runs', '7', 'gate-receipt.json')),
    'the evidence is committed even with nothing to publish')
  assert.deepEqual(notifies(ctx), [{ title: 'run-7 parked', message: `${TARGET} — nothing ahead of base` }])
})

test('an engine exit of 1 with a gate receipt is a verdict, not a failure', () => {
  // run-main exits 1 on gate-blocked; the receipt is its terminal artifact.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_VERDICT: 'NEEDS_ACK' })
  assert.notEqual(statusOf(ctx).state, 'failed', r.stdout + r.stderr)
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('a verdict, not a crash'))
})

// ── 3. refusals ──────────────────────────────────────────────────────────────

test('a malformed assignment fails the run and clones nothing', () => {
  const ctx = makeHome()
  const bad = `run=7 plan=not-a-sha target=${TARGET} base=${BASE_SHA} engine=${ENGINE_SHA}`
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: bad })
  assert.notEqual(r.status, 0, 'a malformed assignment must exit non-zero')

  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /plan is not a 40-hex sha/)
  assert.equal(readLog(ctx, 'git.log'), '', 'nothing is cloned on a refused assignment')
  assert.equal(engineRuns(ctx), 0, 'no engine on a refused assignment')
  assert.equal(notifies(ctx).length, 1)
  assert.equal(notifies(ctx)[0].title, 'run-7 failed')
})

test('an unknown key in the assignment fails the run', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} sudo=yes` })
  assert.notEqual(r.status, 0)
  assert.match(statusOf(ctx).error, /unknown key 'sudo'/)
  assert.equal(readLog(ctx, 'git.log'), '')
})

test('without FLEET_ASSIGNMENT the comment is read from Reflection exactly once', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: '' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 1)
  assert.equal(statusOf(ctx).state, 'done')
})

test('without FLEET_ASSIGNMENT and with an empty comment the run fails at once — no polling', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: '', STUB_COMMENT: '' })
  assert.notEqual(r.status, 0)
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 1,
    'one read; an empty comment is a launcher bug, not something to wait out')
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /no run= comment/)
  assert.equal(readLog(ctx, 'git.log'), '')
  assert.equal(engineRuns(ctx), 0)
})

test('an api_key auth status stops the run before the engine spends a credit', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_AUTH: 'api_key' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /api_key/)
  assert.equal(engineRuns(ctx), 0, 'the engine never starts on an api_key')
})

test('a non-zero engine exit fails the run, after the receipts are committed', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '9' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /^engine exited 9\n/)
  assert.ok(fs.existsSync(path.join(ctx.home, 'fleet-runs', 'runs', '7', 'gate-receipt.json')),
    'the evidence of a failed run is still committed')
  assert.equal(prPosts(ctx).length, 0, 'a failed engine opens no PR')
  const c = committed(ctx)
  assert.equal(c.length, 1)
  assert.equal(c[0].state, 'failed', 'the committed page says failed, not running')
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 failed', message: `${TARGET} — engine exited 9` },
  ])
})

// ── 4. the public-target fallback ────────────────────────────────────────────

test('a target the exe.dev edge cannot find is cloned from github.com and re-pointed', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CLONE_404: `https://github.int.exe.xyz/${TARGET}.git`,
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const H = ctx.home
  const git = argvLines(ctx, 'git')
  assert.ok(git.some((a) => a[1] === 'clone' && a[2] === `https://github.com/${TARGET}.git`),
    'a public target falls back to github.com')
  assert.ok(git.some((a) => a.join(' ') ===
    `git -C ${H}/target remote set-url origin https://github.int.exe.xyz/${TARGET}.git`),
    'origin goes back to the edge, because the attached integration is what makes the push work')
})

// ── 5. the engine's own words ────────────────────────────────────────────────

test("the engine's output is served, logged, and quoted in the error", () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_NO_RECEIPT: '1' })
  assert.notEqual(r.status, 0)

  // Served beside the status page, so a laptop with a VM token can read it.
  const engineLog = readLog(ctx, path.join('www', 'engine.log'))
  assert.ok(engineLog.includes('run-main: preflight'), 'stdout is captured')
  assert.ok(engineLog.includes('run-main: knob-validate-failed'), 'stderr is captured')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('run-main: knob-validate-failed'),
    'and the boot log carries it too')

  // The reason is in the cell a reader opens, not only in a file on a VM the
  // janitor is about to delete.
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /^engine exited 1\n/)
  assert.ok(status.error.includes('run-main: knob-validate-failed'), status.error)

  // …and it rides to fleet-runs as evidence, which is the only artifact a run
  // that never reached its gate produces.
  assert.ok(fs.existsSync(path.join(ctx.home, 'fleet-runs', 'runs', '7', 'engine.log')))
  assert.equal(committed(ctx)[committed(ctx).length - 1].state, 'failed')
})

// ── 6. failing before the clones ─────────────────────────────────────────────

test('a failure before the target clone still lands in fleet-runs', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_CLONE_FAIL: `https://github.int.exe.xyz/${TARGET}.git` })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /^clone: target/)

  const dir = path.join(ctx.home, 'fleet-runs', 'runs', '7')
  assert.ok(fs.existsSync(path.join(dir, 'status.json')), 'runs/7/ exists even this early')
  const c = committed(ctx)
  assert.equal(c.length, 1)
  assert.equal(c[0].state, 'failed')
  assert.equal(engineRuns(ctx), 0, 'the engine never started')
})

// ── 7. re-entry ──────────────────────────────────────────────────────────────

test('a run that failed after its engine ran is not restarted', () => {
  const ctx = makeHome()
  assert.notEqual(boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_NO_RECEIPT: '1' }).status, 0)
  const gitBefore = argvLines(ctx, 'git').length

  const again = boot(ctx)
  assert.equal(again.status, 0, 'exit 0: finished, whatever it finished as')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('already failed — leaving it for the janitor'))
  assert.equal(engineRuns(ctx), 1, 'the engine is not re-run')
  assert.equal(argvLines(ctx, 'git').length, gitBefore, 'and nothing is re-cloned')
})

test('a run parked with nothing to publish is not restarted either', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' }).status, 0)
  const gitBefore = argvLines(ctx, 'git').length
  const again = boot(ctx)
  assert.equal(again.status, 0)
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('already parked — leaving it for the janitor'))
  assert.equal(engineRuns(ctx), 1)
  assert.equal(argvLines(ctx, 'git').length, gitBefore)
})

test('a fleet-runs clone whose HEAD has moved past the plan is not checked out over', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx).status, 0)
  // The crash shape run-66 hit: evidence committed, HEAD advanced, unit restarts.
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'),
    JSON.stringify({ ...statusOf(ctx), state: 'running' }))
  assert.equal(boot(ctx).status, 0)

  const H = ctx.home
  const fr = argvLines(ctx, 'git').filter((a) => a[2] === `${H}/fleet-runs`)
  assert.equal(fr.filter((a) => a[3] === 'checkout' && a[4] === PLAN_SHA).length, 0,
    'the plan sha is never checked out bare — that is what killed run-66')
  assert.ok(fr.some((a) => a[3] === 'merge-base'), 'HEAD is asked whether it already has it')
})

test('a clone that is behind the plan commit is detached onto it', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_PLAN_NOT_IN_HEAD: '1' }).status, 0)
  const H = ctx.home
  assert.ok(argvLines(ctx, 'git').some((a) =>
    a.join(' ') === `git -C ${H}/fleet-runs checkout --detach ${PLAN_SHA}`))
})

test('re-entering after a finished engine re-runs neither the engine nor the PR', () => {
  const ctx = green()
  assert.equal(engineRuns(ctx), 1)
  assert.equal(prPosts(ctx).length, 1)

  // The unit restarted after the run had finished but before the page said so:
  // clones on disk, the engine's marker written, a PR already recorded.
  const statusFile = path.join(ctx.home, 'www', 'status.json')
  const crashed = { ...statusOf(ctx), state: 'running' }
  fs.writeFileSync(statusFile, JSON.stringify(crashed))

  const again = boot(ctx)
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(engineRuns(ctx), 1, 'the engine is not re-run')
  assert.equal(prPosts(ctx).length, 1, 'a second PR is never opened')
  assert.equal(argvLines(ctx, 'git').filter((a) => a[1] === 'clone').length, 2,
    'existing clones are not re-cloned')
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(statusOf(ctx).vm, VM_NAME, 'the VM name survives a re-entry')
  assert.equal(statusOf(ctx).pr, PR_URL, 'and so does the PR')
  assert.equal(statusOf(ctx).prAuthor, PR_AUTHOR, 'and its author')
})

test('re-entering a run that already reached done does nothing at all', () => {
  const ctx = green()
  const before = argvLines(ctx, 'git').length
  const again = boot(ctx)
  assert.equal(again.status, 0)
  assert.equal(argvLines(ctx, 'git').length, before, 'a done run issues no further git')
  assert.equal(engineRuns(ctx), 1)
})

// ── 8. the deadman ───────────────────────────────────────────────────────────

test('the deadman parks a run stuck in running and stops the engine service', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx).status, 0)
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'),
    JSON.stringify({ ...statusOf(ctx), state: 'running', pr: null }))

  const dead = boot(ctx, ['deadman'], { STUB_ENGINE_ACTIVE: 'active' })
  assert.equal(dead.status, 0, dead.stdout + dead.stderr)
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.match(status.error, /^deadman: /)
  assert.equal(status.run, '7')
  assert.equal(status.vm, VM_NAME)
  const notes = notifies(ctx)
  assert.equal(notes[notes.length - 1].title, 'run-7 parked')
  assert.ok(argvLines(ctx, 'systemctl').some((a) =>
    a.join(' ') === 'systemctl --user stop fleet-engine-7.service'), 'the service, not a scope')
  // The run unit (fleet-run@7.service) is this script's own process; the
  // deadman stops the engine unit and never the unit it may itself be in.
  assert.ok(!argvLines(ctx, 'systemctl').some((a) => a.some((s) => s.includes('fleet-run'))),
    'the run unit is never named — only the engine unit is stopped')
})

test('the deadman leaves a finished run alone', () => {
  const ctx = green()
  const notesBefore = notifies(ctx).length
  const dead = boot(ctx, ['deadman'])
  assert.equal(dead.status, 0)
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(notifies(ctx).length, notesBefore, 'no notification for a done run')
  assert.equal(argvLines(ctx, 'systemctl').filter((a) => a[2] === 'stop').length, 0)
})

// ── run ──────────────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of tests) {
  const started = Date.now()
  try {
    fn()
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
