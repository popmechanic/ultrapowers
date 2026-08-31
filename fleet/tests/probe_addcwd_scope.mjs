// fleet/tests/probe_addcwd_scope.mjs — is a read-only worker's denial
// PATH-SCOPE or TOOL-CLASS? Answered live, five arms, 2026-08-31.
//
// WHY THIS EXISTS. probe_dontask_readonly_bash.mjs concluded that `dontAsk`
// permits read-only Bash outside `--allowedTools`, and that conclusion went
// into a load-bearing comment. It is TRUE — and it is not the whole rule. That
// probe runs `wc -c` on a path INSIDE cwd and passes no `--add-dir`, so it
// never tested the shape production runs: a reviewer whose cwd is
// `<runDir>/clones/integration` reading `wavesPath` (launch.json) and
// `patches/`, both in `<runDir>` — a PARENT. Those reads were denied in five
// consecutive runs, became `cannotVerify` entries, then deferred acks, then
// parked runs — a path-scope denial that read as a tool-class one.
//
// Arms A/B/C isolate the one variable the two disagreed about. D/E answer the
// separate question of whether program execution is reachable at all, which is
// what an executable acceptance probe (#447) would need.
//
//   A  `wc -c` in cwd,      no --add-dir  -> expect RAN     (the old probe's shape)
//   B  `wc -c` out of cwd,  no --add-dir  -> expect DENIED  (the PRODUCTION shape)
//   C  `wc -c` out of cwd,  --add-dir     -> expect RAN     (--add-dir reaches Bash)
//   D  `python3 -c`, not allowlisted      -> expect DENIED  (exec is not read-only)
//   E  `python3 -c`, allowlisted          -> expect RAN     (exec IS grantable, narrowly)
//
// A HARNESS FAULT MUST NEVER READ AS A PERMISSION RESULT. The first run of this
// probe reported "TOOL-CLASS, read-only Bash unreachable" when in fact all three
// arms had failed at login — the same class of error the probe exists to catch.
// `broken` guards it and exits 2. Note the sibling probe pins a fresh
// CLAUDE_CONFIG_DIR, which has NO login: it can only ever have run where
// CLAUDE_CODE_OAUTH_TOKEN is in the env. This one uses the ambient credential.
//
// NOT named test_*.mjs: spends real tokens. Run where a credential lives:
//   node fleet/tests/probe_addcwd_scope.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = process.env.PROBE_CLI || 'claude'
const GIT_VERBS = ['Bash(git diff *)', 'Bash(git log *)', 'Bash(git status *)']

function arm(name, { cmd, marker, outOfCwd = true, addDir = false, extraAllow = [] }) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addcwd-scope-'))
  // Mirror the production tree exactly: cwd is a clone UNDER the run dir, and
  // the file the prompt names is a sibling of `clones/`, i.e. a parent of cwd.
  const clone = path.join(runDir, 'clones', 'integration')
  fs.mkdirSync(clone, { recursive: true })

  let target = null
  let expected = marker
  if (cmd === null) {
    const nonce = 'n' + Math.random().toString(36).slice(2).repeat(3 + (Date.now() % 4))
    target = outOfCwd ? path.join(runDir, 'launch.json') : path.join(clone, 'nonce.txt')
    fs.writeFileSync(target, nonce)
    expected = String(Buffer.byteLength(nonce))
  }
  const command = cmd === null ? 'wc -c ' + target : cmd
  const prompt =
    'You are a test harness. Using the Bash tool, run exactly: ' + command +
    ' — then reply with ONLY its stdout, digits only, nothing else. ' +
    'If the command is not permitted, reply with exactly: DENIED'

  const argv = [
    '-p', prompt,
    '--output-format', 'json',
    '--permission-mode', 'dontAsk',
    '--allowedTools', [...GIT_VERBS, ...extraAllow].join(','),
    '--setting-sources', 'user',
    '--disable-slash-commands',
    '--model', 'haiku',
  ]
  if (addDir) argv.push('--add-dir', runDir)

  const res = spawnSync(CLI, argv, {
    cwd: clone, env: { ...process.env }, encoding: 'utf8', timeout: 5 * 60 * 1000,
  })
  let parsed = {}
  try { parsed = JSON.parse(res.stdout || '{}') } catch { /* fall through to broken */ }
  const text = String(parsed.result || '').trim()
  const denials = (parsed.permission_denials || []).length
  const broken = text === '' ||
    /not logged in|please run \/login|invalid api key|credit balance|usage limit/i.test(text)
  const ran = !broken && text.includes(expected)
  console.log(`  ${name.padEnd(36)} ran=${String(ran).padEnd(5)} denials=${denials}  reply="${text.slice(0, 48)}"`)
  return { ran, broken }
}

console.log('probe: is a read-only worker denial path-scope or tool-class?\n')
const A = arm('A wc in cwd,  no --add-dir', { cmd: null, outOfCwd: false })
const B = arm('B wc out-cwd, no --add-dir (PROD)', { cmd: null })
const C = arm('C wc out-cwd, --add-dir (FIX)', { cmd: null, addDir: true })
const D = arm('D python3 -c, not allowlisted', { cmd: 'python3 -c "print(11111)"', marker: '11111', addDir: true })
const E = arm('E python3 -c, allowlisted', { cmd: 'python3 -c "print(11111)"', marker: '11111', addDir: true, extraAllow: ['Bash(python3 *)'] })

console.log('\n--- verdict ---')
const arms = { A, B, C, D, E }
const broken = Object.entries(arms).filter(([, v]) => v.broken).map(([k]) => k)
if (broken.length) {
  console.log('INCONCLUSIVE — the harness itself failed on arm(s) ' + broken.join(', ') +
    ' (auth, quota or a non-JSON reply). No permission claim can be read from this run.')
  process.exit(2)
}
const expected = { A: true, B: false, C: true, D: false, E: true }
const wrong = Object.keys(expected).filter((k) => arms[k].ran !== expected[k])
if (!wrong.length) {
  console.log('AS RECORDED: denials are PATH-SCOPE; --add-dir reaches Bash; program')
  console.log('execution is not read-only-class but IS grantable by an explicit entry.')
  console.log('ALL TESTS PASSED')
  process.exit(0)
}
console.log('BOUNDARY MOVED on arm(s) ' + wrong.join(', ') +
  ' — the CLI no longer behaves as fleet/run-worker.mjs documents. Re-read that comment before shipping.')
process.exit(1)
