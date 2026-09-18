/**
 * fleet/tests/test_factory_boot.mjs — exam for "the boot stands up the spoke,
 * waits for its approval, and tells the engine where the board is".
 *
 * Subject: `factory/boot.sh boot` (Modify). This file does not implement any
 * part of the subject — it drives the REAL script, with every external
 * program it calls put on `PATH` first as a stub, and a hermetic
 * `env: simEnv(...)` (never `process.env`), exactly the shape run-187 used.
 *
 * Legs (a)-(d) below map onto Machine clauses M1-M4 one-for-one; every
 * assertion message is tagged with the clause it proves, e.g. "[M1]".
 *
 * Two clauses could not be encoded from the task text alone — flagged here
 * and again at the assertion that stands in for them:
 *
 *  - M1's `credential_provider` is specified as "the Global Constraints'
 *    helper argv" with three placeholders filled in. The Global Constraints
 *    section that names that argv was not included in this task's text and
 *    is not findable anywhere in this repository. This exam asserts the
 *    best-supported reconstruction — `["node", "<engine>/factory/kata-
 *    credential.mjs", <kata.json path>, <helper dir>]`, built from the
 *    Context's own "run the helper (…factory/kata-credential.mjs, under
 *    node)" — by full equality, per the instruction to encode a real claim
 *    rather than quietly settle for something weaker. If the real argv
 *    differs, this is the one assertion to correct first.
 *  - Kata's `federation status --json` response shape is not specified by
 *    any text available here (Kata's own docs are cited but not readable
 *    from this repo). The stub below invents a shape using the task's own
 *    vocabulary (`spoke_project`/`hub_project`/an approved-or-bound status)
 *    and the exam only ever asserts the READINESS heuristic the Machine
 *    clause actually states, never the shape itself.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', '..', 'factory', 'boot.sh')

// ── fixed assignment ────────────────────────────────────────────────────
const RUN_N = '7'
const PLAN_SHA = 'a1'.repeat(20)
const BASE_SHA = 'b2'.repeat(20)
const ENGINE_SHA = 'c3'.repeat(20)
const HEAD_SHA = 'd4'.repeat(20)
const TARGET_REPO = 'acme/board-target'
const ASSIGNMENT = `run=${RUN_N} plan=${PLAN_SHA} target=${TARGET_REPO} base=${BASE_SHA} engine=${ENGINE_SHA}`

const PROJECT_NAME = 'acme-board-spoke'
const PROJECT_ID = 12
const KATA_JSON = JSON.stringify({ project: { id: PROJECT_ID, name: PROJECT_NAME } })
const KATA_URL = 'http://127.0.0.1:7777'
const TARBALL_URL = 'https://github.com/kenn-io/kata/releases/download/v0.18.0/kata_0.18.0_linux_amd64.tar.gz'
const SUMS_URL = 'https://github.com/kenn-io/kata/releases/download/v0.18.0/SHA256SUMS'

const PLAN_BYTES = '# Board Plan\n\n**Summary:** stand up the spoke and tear it down.\n\n**Goal:** ship the board (#1)\n**Closes:** #1\n'

// ── stub shell fixtures ─────────────────────────────────────────────────
// `say` appends one ordering line to the SAME log boot.sh's own `log()`
// writes (so ordering between the subject's own lines — e.g. `board: …` —
// and a stub's calls can be read off one stream). `argv` appends one
// tab-separated record per call to `$FLEET_HOME/<name>.log`.
const PRELUDE = `#!/bin/sh
say() { printf '%s CALL %s\\n' "$(date -u +%H:%M:%S)" "$1" >>"$FLEET_HOME/fleet-boot.log"; }
argv() {
  local f="$FLEET_HOME/$1.log"
  shift
  { for a in "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >>"$f"
}
`

const STUBS = {
  git: `
argv "git" "$@"
if [ "$1" = "-C" ]; then dir="$2"; verb="$3"; a1="$4"; a2="$5"
else dir=""; verb="$1"; a1="$2"; a2="$3"; fi
say "git $verb"
case "$verb" in
  clone)
    mkdir -p "$a2/.git"
    exit 0 ;;
  checkout)
    exit 0 ;;
  fetch)
    case "$a2" in
      *ultra/evidence-run-${RUN_N}) exit 1 ;;
      *) exit 0 ;;
    esac ;;
  rev-parse)
    case "$a1" in
      FETCH_HEAD) printf '%s\\n' "$STUB_PLAN_SHA" ;;
      HEAD)
        if [ "$dir" = "$FLEET_HOME/target" ]; then printf '%s\\n' "$STUB_TARGET_HEAD"
        else printf '%s\\n' "$STUB_HEAD_SHA"; fi ;;
      *) printf '%s\\n' "$STUB_HEAD_SHA" ;;
    esac
    exit 0 ;;
  show)
    case "$a1" in
      *:.ultrapowers/plan.md) printf '%s' "$STUB_PLAN_BYTES" ;;
      *:.ultrapowers/gate-verdicts.json) exit 1 ;;
      *:.ultrapowers/kata.json)
        if [ -n "$STUB_KATA_JSON" ]; then printf '%s' "$STUB_KATA_JSON"; else exit 1; fi ;;
      *) exit 1 ;;
    esac
    exit 0 ;;
  worktree)
    wt=""; sawadd=""
    for a in "$@"; do
      if [ -n "$sawadd" ]; then
        case "$a" in -*) ;; *) wt="$a"; break ;; esac
      fi
      [ "$a" = "add" ] && sawadd=1
    done
    if [ -n "$wt" ]; then mkdir -p "$wt"; [ -e "$wt/.git" ] || printf 'gitdir: %s\\n' "$wt" >"$wt/.git"; fi
    exit 0 ;;
  config)
    if [ "$a1" = "user.email" ] && [ -z "$a2" ]; then exit 1; fi
    exit 0 ;;
  add|commit|push)
    exit 0 ;;
  symbolic-ref)
    printf 'refs/remotes/origin/main\\n'
    exit 0 ;;
  ls-remote)
    exit 0 ;;
  *)
    exit 0 ;;
esac
`,
  curl: `
argv "curl" "$@"
url=""; payload=""; prev=""; out=""
for a in "$@"; do
  case "$a" in https://*|http://*) url="$a" ;; esac
  if [ "$prev" = "-d" ]; then payload="$a"; fi
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
done
emit() { if [ -n "$out" ]; then printf '%s' "$1" >"$out"; else printf '%s' "$1"; fi; }
case "$url" in
  *reflection.int.exe.xyz/)
    say "curl name"
    printf '{"name":"stub-vm"}\\n' ;;
  *claude-max.int.exe.xyz/api/oauth/usage)
    say "curl bearer"
    printf '{"five_hour":{"utilization":1}}\\n200\\n' ;;
  *repos/*/pulls)
    say "curl pr create"
    printf '%s\\n' "$payload" >>"$FLEET_HOME/pr.log"
    printf '{"html_url":"https://github.example/pr/1","number":1,"user":{"login":"fleet-bot"}}\\n201\\n' ;;
  *kata_0.18.0_linux_amd64.tar.gz)
    say "curl kata tarball"
    emit 'TARBALL-BYTES' ;;
  *v0.18.0/SHA256SUMS)
    say "curl kata sums"
    emit 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  kata_0.18.0_linux_amd64.tar.gz
' ;;
  *)
    say "curl UNKNOWN $url"
    exit 22 ;;
esac
exit 0
`,
  sha256sum: `
argv "sha256sum" "$@"
say "sha256sum $*"
if [ -n "$STUB_SHA256_FAIL" ]; then
  printf 'kata: FAILED\\n' >&2
  exit 1
fi
exit 0
`,
  tar: `
argv "tar" "$@"
case "$1" in
  -tzf)
    say "tar list"
    printf 'kata\\n' ;;
  -xzf)
    say "tar extract"
    cat > kata <<'TAREOF'
#!/bin/sh
exec "__KATA_STUB_PATH__" "$@"
TAREOF
    chmod +x kata ;;
esac
exit 0
`,
  kata: `
argv "kata" "$@"
say "kata $*"
if [ "$1" = "federation" ] && [ "$2" = "status" ]; then
  n=0
  [ -f "$FLEET_HOME/kata-status-n" ] && n=$(cat "$FLEET_HOME/kata-status-n")
  n=$((n+1))
  printf '%s' "$n" >"$FLEET_HOME/kata-status-n"
  printf '%s\\n' "$KATA_SERVER" >>"$FLEET_HOME/kata-status-server.log"
  picked=""; i=0
  oldifs="$IFS"; IFS=,
  for w in $STUB_KATA_STATUS_SEQ; do
    i=$((i+1)); picked="$w"
    if [ "$i" -ge "$n" ]; then break; fi
  done
  IFS="$oldifs"
  if [ "$picked" = "bound" ]; then
    printf '{"bindings":[{"spoke_project":"%s","hub_project":"%s","status":"bound","approved":true}]}\\n' "$STUB_PROJECT_NAME" "$STUB_PROJECT_NAME"
  else
    printf '{"bindings":[]}\\n'
  fi
  exit 0
fi
if [ "$1" = "federation" ] && [ "$2" = "leave" ]; then
  say "kata federation leave"
  printf '%s\\n' "$3" >>"$FLEET_HOME/kata-leave.log"
  if [ -n "$STUB_KATA_LEAVE_FAIL" ]; then exit 1; fi
  exit 0
fi
exit 0
`,
  'systemd-run': `
argv "systemd-run" "$@"
unit=""
for a in "$@"; do
  case "$a" in
    --unit=*) unit=\${a#--unit=} ;;
  esac
done
case "$unit" in
  fleet-kata-*)
    say "systemd-run kata $unit"
    exit 0 ;;
esac
case " $* " in
  *" stop "*)
    say "systemd-run stop $unit"
    exit 0 ;;
esac
say "systemd-run engine $unit"
exit "$STUB_ENGINE_CODE"
`,
  systemctl: `
argv "systemctl" "$@"
say "systemctl $*"
exit 0
`,
  claude: `
argv "claude" "$@"
say "claude $*"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf 'authMethod: oauth_token\\n'
  exit 0
fi
exit 0
`,
  node: `
argv "node" "$@"
say "node $*"
exit 0
`,
  npm: `
argv "npm" "$@"
say "npm $*"
exit 0
`,
}

function makeHome () {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-boot-'))
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const kataStubPath = path.join(bin, 'kata')
  for (const [name, body] of Object.entries(STUBS)) {
    const text = body.split('__KATA_STUB_PATH__').join(kataStubPath)
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + text)
    fs.chmodSync(file, 0o755)
  }
  const engineDir = path.join(home, 'engines', ENGINE_SHA)
  fs.mkdirSync(path.join(engineDir, 'fleet', 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(engineDir, 'factory'), { recursive: true })
  fs.writeFileSync(path.join(engineDir, 'factory', 'engine.mjs'), '// stub engine, never executed for real\n')
  fs.writeFileSync(path.join(engineDir, 'factory', 'kata-credential.mjs'), '// stub credential helper, never executed for real\n')
  return { home, bin, engineDir }
}

function bootEnv (ctx, overrides = {}) {
  return simEnv({
    bin: ctx.bin,
    home: ctx.home,
    env: {
      FLEET_ASSIGNMENT: ASSIGNMENT,
      FLEET_KATA_WAIT_SECONDS: '2',
      FLEET_COMMIT_SECONDS: '1',
      STUB_KATA_JSON: '',
      STUB_SHA256_FAIL: '',
      STUB_KATA_STATUS_SEQ: 'bound',
      STUB_KATA_LEAVE_FAIL: '',
      STUB_TARGET_HEAD: HEAD_SHA,
      STUB_ENGINE_CODE: '0',
      STUB_PROJECT_NAME: PROJECT_NAME,
      STUB_PLAN_SHA: PLAN_SHA,
      STUB_HEAD_SHA: HEAD_SHA,
      STUB_PLAN_BYTES: PLAN_BYTES,
      ...overrides,
    },
  })
}

function runBoot (ctx, overrides = {}) {
  return spawnSync('bash', [SCRIPT, 'boot'], { env: bootEnv(ctx, overrides), encoding: 'utf8', timeout: 30000 })
}

// ── reading the fixtures back ───────────────────────────────────────────
const kataPlanFile = (ctx) => path.join(ctx.home, 'plans', `run-${RUN_N}.kata.json`)
const configTomlPath = (ctx) => path.join(ctx.home, 'kata', 'config.toml')
const helperDirPath = (ctx) => path.join(ctx.home, 'kata', 'helper')
const runDirPath = (ctx) => path.join(ctx.home, 'run')
const statusFilePath = (ctx) => path.join(ctx.home, 'evidence', '.ultrapowers', 'runs', RUN_N, 'status.json')
const bootLogPath = (ctx) => path.join(ctx.home, 'fleet-boot.log')
const credentialHelperScript = (ctx) => path.join(ctx.engineDir, 'factory', 'kata-credential.mjs')

function stream (ctx) {
  if (!fs.existsSync(bootLogPath(ctx))) return []
  return fs.readFileSync(bootLogPath(ctx), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+\s/, ''))
}
function argvLines (ctx, name) {
  const f = path.join(ctx.home, name + '.log')
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t').filter((s, i, a) => !(s === '' && i === a.length - 1)))
}
function boardLines (ctx) {
  return stream(ctx).filter((l) => l.startsWith('board:'))
}
function statusState (ctx) {
  return JSON.parse(fs.readFileSync(statusFilePath(ctx), 'utf8')).state
}
function tomlSection (toml, marker) {
  const lines = toml.split('\n')
  const start = lines.findIndex((l) => l.trim() === marker)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.trim().startsWith('['))
  return rest.slice(0, end === -1 ? rest.length : end).join('\n')
}
function credentialProviderArray (toml) {
  const m = toml.match(/credential_provider\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return null
  const items = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  let mm
  while ((mm = re.exec(m[1]))) items.push(mm[1])
  return items
}
function engineArgvTail (ctx) {
  const lines = argvLines(ctx, 'systemd-run')
  const rec = lines.find((r) => r.includes(`--unit=fleet-engine-${RUN_N}`))
  assert.ok(rec, '[M3] systemd-run saw the engine unit call; saw ' + JSON.stringify(lines))
  const i = rec.indexOf('--run-dir')
  assert.ok(i !== -1, "[M3] the engine unit's command carries --run-dir; got " + JSON.stringify(rec))
  return rec.slice(i)
}

// ── run every fixture once, up front ────────────────────────────────────
const happy = makeHome()
const happyRes = runBoot(happy, { STUB_KATA_JSON: KATA_JSON, STUB_KATA_STATUS_SEQ: 'unbound,unbound,bound' })

const noKataJson = makeHome()
runBoot(noKataJson, { STUB_KATA_JSON: '' })

const shaFail = makeHome()
runBoot(shaFail, { STUB_KATA_JSON: KATA_JSON, STUB_SHA256_FAIL: '1' })

const waitExpires = makeHome()
runBoot(waitExpires, { STUB_KATA_JSON: KATA_JSON, STUB_KATA_STATUS_SEQ: 'unbound' })

const leaveFails = makeHome()
const leaveFailsRes = runBoot(leaveFails, {
  STUB_KATA_JSON: KATA_JSON, STUB_KATA_STATUS_SEQ: 'unbound,unbound,bound', STUB_KATA_LEAVE_FAIL: '1',
})

const headBaseFail = makeHome()
const headBaseFailRes = runBoot(headBaseFail, {
  STUB_KATA_JSON: KATA_JSON, STUB_KATA_STATUS_SEQ: 'unbound,unbound,bound',
  STUB_TARGET_HEAD: BASE_SHA, STUB_ENGINE_CODE: '2',
})

// ── a minimal runner: every leg reports on its own, none stop the others ─
const failures = []
function leg (name, fn) {
  try {
    fn()
    console.log('ok - ' + name)
  } catch (e) {
    failures.push(name + ': ' + e.message)
    console.log('FAIL - ' + name + '\n  ' + e.message)
  }
}

// ══════════════════════════════════════════════════════════════════════
// (a) [M1]
// ══════════════════════════════════════════════════════════════════════
leg('(a) [M1] the plan commit\'s kata.json is written to plans/run-7.kata.json', () => {
  assert.ok(fs.existsSync(kataPlanFile(happy)), '[M1] expected ' + kataPlanFile(happy) + ' to exist')
  assert.equal(fs.readFileSync(kataPlanFile(happy), 'utf8'), KATA_JSON,
    "[M1] plans/run-7.kata.json holds exactly the plan commit's kata.json bytes")
})

leg('(a) [M1] curl saw the v0.18.0 tarball URL and the SHA256SUMS URL', () => {
  const urls = argvLines(happy, 'curl').flatMap((r) => r.filter((s) => /^https?:\/\//.test(s)))
  assert.ok(urls.includes(TARBALL_URL), '[M1] curl was called with ' + TARBALL_URL + '; saw ' + JSON.stringify(urls))
  assert.ok(urls.includes(SUMS_URL), '[M1] curl was called with ' + SUMS_URL + '; saw ' + JSON.stringify(urls))
})

leg('(a) [M1] sha256sum -c ran before tar extracted', () => {
  const s = stream(happy)
  const shaIdx = s.findIndex((l) => l.startsWith('CALL sha256sum'))
  const tarIdx = s.findIndex((l) => l.startsWith('CALL tar extract'))
  assert.ok(shaIdx !== -1, '[M1] sha256sum was called; log:\n' + s.join('\n'))
  assert.ok(tarIdx !== -1, '[M1] tar -xzf extracted the release; log:\n' + s.join('\n'))
  assert.ok(shaIdx < tarIdx, '[M1] sha256sum -c ran before tar extracted the tarball')
  const shaCall = argvLines(happy, 'sha256sum').find((r) => r.includes('-c'))
  assert.ok(shaCall, '[M1] sha256sum was called with -c; saw ' + JSON.stringify(argvLines(happy, 'sha256sum')))
})

leg('(a) [M1] config.toml: listen, the hub daemon, and the federation.project block', () => {
  assert.ok(fs.existsSync(configTomlPath(happy)), '[M1] expected ' + configTomlPath(happy) + ' to exist')
  const toml = fs.readFileSync(configTomlPath(happy), 'utf8')
  assert.ok(toml.includes('listen = "127.0.0.1:7777"'), '[M1] config.toml carries listen = "127.0.0.1:7777"; got:\n' + toml)
  const daemon = tomlSection(toml, '[[daemon]]')
  assert.ok(daemon !== null, '[M1] config.toml carries a [[daemon]] table; got:\n' + toml)
  assert.ok(daemon.includes('name = "hub"'), '[M1] the [[daemon]] table is named hub; got:\n' + daemon)
  assert.ok(daemon.includes('url = "https://kata-sync.int.exe.xyz"'), "[M1] the hub daemon's url is https://kata-sync.int.exe.xyz; got:\n" + daemon)
  const fed = tomlSection(toml, '[[federation.project]]')
  assert.ok(fed !== null, '[M1] config.toml carries one [[federation.project]] table; got:\n' + toml)
  assert.ok(fed.includes('hub = "hub"'), '[M1] federation.project names hub = "hub"; got:\n' + fed)
  assert.ok(fed.includes(`spoke_project = "${PROJECT_NAME}"`), "[M1] spoke_project is the kata.json's project.name; got:\n" + fed)
  assert.ok(fed.includes(`hub_project = "${PROJECT_NAME}"`), '[M1] hub_project is the kata.json\'s project.name too; got:\n' + fed)
  assert.ok(fed.includes('intent = "collaborate"'), '[M1] intent = "collaborate"; got:\n' + fed)
})

leg("(a) [M1] credential_provider is the Global Constraints' helper argv (see file header note)", () => {
  const toml = fs.readFileSync(configTomlPath(happy), 'utf8')
  const cp = credentialProviderArray(toml)
  assert.ok(cp, '[M1] config.toml carries a credential_provider array; got:\n' + toml)
  assert.deepEqual(cp, ['node', credentialHelperScript(happy), kataPlanFile(happy), helperDirPath(happy)],
    '[M1] credential_provider is ["node", "<engine>/factory/kata-credential.mjs", <kata.json path>, ' +
    '"$FLEET_HOME/kata/helper"] in order (this exam\'s reconstruction of "the Global Constraints\' helper argv" ' +
    '— see the file header note); got ' + JSON.stringify(cp))
})

leg('(a) [M1] config.toml names no token, token_env or actor', () => {
  const toml = fs.readFileSync(configTomlPath(happy), 'utf8')
  assert.ok(!/token\s*=/.test(toml), '[M1] config.toml must not set token =; got:\n' + toml)
  assert.ok(!toml.includes('token_env'), '[M1] config.toml must not mention token_env; got:\n' + toml)
  assert.ok(!/actor\s*=/.test(toml), '[M1] config.toml must not set actor =; got:\n' + toml)
})

// ══════════════════════════════════════════════════════════════════════
// (b) [M2]
// ══════════════════════════════════════════════════════════════════════
leg("(b) [M2] systemd-run starts the kata daemon, --user --unit=fleet-kata-7, before the engine's unit", () => {
  const lines = argvLines(happy, 'systemd-run')
  const kataIdx = lines.findIndex((r) => r.includes('--unit=fleet-kata-7'))
  const engineIdx = lines.findIndex((r) => r.includes('--unit=fleet-engine-7'))
  assert.ok(kataIdx !== -1, '[M2] systemd-run saw a --unit=fleet-kata-7 call; saw ' + JSON.stringify(lines))
  assert.ok(engineIdx !== -1, '[M2] systemd-run saw a --unit=fleet-engine-7 call; saw ' + JSON.stringify(lines))
  assert.ok(kataIdx < engineIdx, "[M2] the kata unit started before the engine's unit")
  const kataCall = lines[kataIdx]
  assert.ok(kataCall.includes('--user'), '[M2] the kata unit call carries --user; got ' + JSON.stringify(kataCall))
  assert.equal(kataCall.slice(-4).join(' '), 'kata daemon start --foreground',
    '[M2] the kata unit\'s command is exactly `kata daemon start --foreground`; got ' + JSON.stringify(kataCall))
  assert.ok(kataCall.includes('KATA_HOME=' + path.join(happy.home, 'kata')),
    '[M2] KATA_HOME=' + path.join(happy.home, 'kata') + " is in the kata unit's environment; got " + JSON.stringify(kataCall))
})

leg('(b) [M2] exactly three federation status --json polls, each with KATA_SERVER, and no fourth', () => {
  const calls = argvLines(happy, 'kata').filter((r) => r[0] === 'federation' && r[1] === 'status')
  assert.equal(calls.length, 3,
    '[M2] the stub kata answered unbound, unbound, bound - exactly three polls and no fourth; saw ' + JSON.stringify(calls))
  for (const c of calls) assert.ok(c.includes('--json'), '[M2] every status poll passes --json; got ' + JSON.stringify(c))
  const serverLog = path.join(happy.home, 'kata-status-server.log')
  const servers = fs.existsSync(serverLog) ? fs.readFileSync(serverLog, 'utf8').split('\n').filter(Boolean) : []
  assert.equal(servers.length, 3, '[M2] all three polls ran with KATA_SERVER set; saw ' + JSON.stringify(servers))
  for (const s of servers) assert.equal(s, KATA_URL, '[M2] KATA_SERVER=' + KATA_URL + ' on every poll; got ' + s)
})

// ══════════════════════════════════════════════════════════════════════
// (c) [M3]
// ══════════════════════════════════════════════════════════════════════
leg('(c) [M3] bound: the engine argv ends --run-dir ... --kata-url ... --kata-project 12 --kata-json ...', () => {
  const tail = engineArgvTail(happy)
  assert.deepEqual(tail, [
    '--run-dir', runDirPath(happy),
    '--kata-url', KATA_URL,
    '--kata-project', String(PROJECT_ID),
    '--kata-json', kataPlanFile(happy),
  ], '[M3] bound engine argv tail; got ' + JSON.stringify(tail))
})

for (const [label, ctx] of [
  ['no kata.json on the plan commit', noKataJson],
  ['install fails (sha256sum -c exits 1)', shaFail],
  ['the wait expires unbound', waitExpires],
]) {
  leg(`(c) [M3] ${label}: engine argv is exactly --run-dir <dir>, one board: line, run reaches publish`, () => {
    const tail = engineArgvTail(ctx)
    assert.deepEqual(tail, ['--run-dir', runDirPath(ctx)],
      '[M3] unbound (' + label + "): engine argv tail is exactly --run-dir <dir>; got " + JSON.stringify(tail))
    const board = boardLines(ctx)
    assert.equal(board.length, 1, '[M3] unbound (' + label + '): exactly one board: log line; got ' + JSON.stringify(board))
    assert.ok(board[0] && board[0].startsWith('board:'),
      '[M3] unbound (' + label + '): the line begins board:; got ' + JSON.stringify(board[0]))
    const prCalls = argvLines(ctx, 'curl').filter((r) => r.some((s) => /\/pulls$/.test(s)))
    assert.ok(prCalls.length >= 1, '[M3] unbound (' + label + "): the run still reaches its publish path (a PR POST happened)")
  })
}

// ══════════════════════════════════════════════════════════════════════
// (d) [M4]
// ══════════════════════════════════════════════════════════════════════
leg('(d) [M4] a bound spoke is left (federation leave <project.name>) after the PR is opened, and its unit stopped', () => {
  const s = stream(happy)
  const prIdx = s.findIndex((l) => l.startsWith('CALL curl pr create'))
  const leaveIdx = s.findIndex((l) => l.startsWith('CALL kata federation leave'))
  assert.ok(prIdx !== -1, '[M4] the publish path opened the pull request; log:\n' + s.join('\n'))
  assert.ok(leaveIdx !== -1, '[M4] the bound spoke was left with kata federation leave; log:\n' + s.join('\n'))
  assert.ok(prIdx < leaveIdx, '[M4] federation leave ran after the pull request was opened')
  const leaveCalls = argvLines(happy, 'kata').filter((r) => r[0] === 'federation' && r[1] === 'leave')
  assert.equal(leaveCalls.length, 1, '[M4] leave was called once; saw ' + JSON.stringify(leaveCalls))
  assert.equal(leaveCalls[0][2], PROJECT_NAME, "[M4] leave named the kata.json's project.name; got " + JSON.stringify(leaveCalls[0]))
  const stoppedViaSystemdRun = argvLines(happy, 'systemd-run').some((r) => r.includes('stop') && r.some((s) => s.includes('fleet-kata-7')))
  const stoppedViaSystemctl = argvLines(happy, 'systemctl').some((r) => r.includes('stop') && r.some((s) => s.includes('fleet-kata-7')))
  assert.ok(stoppedViaSystemdRun || stoppedViaSystemctl,
    '[M4] the fleet-kata-7 unit was stopped; systemd-run saw ' + JSON.stringify(argvLines(happy, 'systemd-run')) +
    ', systemctl saw ' + JSON.stringify(argvLines(happy, 'systemctl')))
})

leg("(d) [M4] a failing leave changes neither the run's state nor the boot's exit code, and is one board: line", () => {
  assert.ok(fs.existsSync(statusFilePath(happy)), '[M4] baseline status.json exists')
  assert.ok(fs.existsSync(statusFilePath(leaveFails)), '[M4] leave-fails status.json exists')
  assert.equal(statusState(leaveFails), statusState(happy),
    "[M4] the final status.json state with a failing leave equals the bound baseline's; baseline=" +
    statusState(happy) + ' failing-leave=' + statusState(leaveFails))
  assert.equal(leaveFailsRes.status, happyRes.status,
    "[M4] the boot's exit code with a failing leave equals the bound baseline's; baseline=" +
    happyRes.status + ' failing-leave=' + leaveFailsRes.status)
  const board = boardLines(leaveFails)
  assert.equal(board.length, 1, '[M4] a failing leave is exactly one board: log line; got ' + JSON.stringify(board))
})

leg('(d) [M4] bound + engine exit 2 + head==base: leave still runs, final state failed, boot exits 2', () => {
  const leaveCalls = argvLines(headBaseFail, 'kata').filter((r) => r[0] === 'federation' && r[1] === 'leave')
  assert.equal(leaveCalls.length, 1, '[M4] the bound spoke was still left even though the run failed at base; saw ' + JSON.stringify(leaveCalls))
  assert.equal(leaveCalls[0][2], PROJECT_NAME, '[M4] leave named the project; got ' + JSON.stringify(leaveCalls[0]))
  assert.ok(fs.existsSync(statusFilePath(headBaseFail)), '[M4] status.json exists')
  assert.equal(statusState(headBaseFail), 'failed', '[M4] the final state is failed; got ' + statusState(headBaseFail))
  assert.equal(headBaseFailRes.status, 2, "[M4] the boot exits 2 (the engine's own exit code); got " + headBaseFailRes.status)
})

leg('(d) [M4] on the unbound drives no leave is ever issued', () => {
  for (const [label, ctx] of [
    ['no kata.json', noKataJson],
    ['install fails', shaFail],
    ['wait expires', waitExpires],
  ]) {
    const leaveCalls = argvLines(ctx, 'kata').filter((r) => r[0] === 'federation' && r[1] === 'leave')
    assert.equal(leaveCalls.length, 0, '[M4] unbound (' + label + '): no kata federation leave call; saw ' + JSON.stringify(leaveCalls))
  }
})

if (failures.length) {
  console.error(`\n${failures.length} FAILING`)
  process.exit(1)
} else {
  console.log('ALL TESTS PASSED')
}
