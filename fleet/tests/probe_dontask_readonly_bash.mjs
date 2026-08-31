// fleet/tests/probe_dontask_readonly_bash.mjs — #457 gap 2, answered live.
//
// DOES `--permission-mode dontAsk` PERMIT READ-ONLY BASH COMMANDS THAT ARE NOT
// ON THE `--allowedTools` LIST?
//
// The Claude Code permissions docs describe dontAsk as running "actions matching
// your permissions.allow rules, READ-ONLY BASH COMMANDS, and calls approved by a
// PreToolUse hook." If read-only Bash is auto-permitted as a class, then
// fleet/run-worker.mjs:48 is imprecise where it says, of the reviewer/critic
// roles, that "arbitrary Bash is unreachable" — and part of #458 may already be
// solved, because a reviewer could run read-only probes today.
//
// R-w3 (2026-08-28-claude-p-worker-parity.md:88) does NOT answer this: all four
// of its denials (`sed -i`, the `python3 <<EOF … open(path,'a')` heredoc) are
// WRITING commands, which are denied under either reading.
//
//   - Arm A (probe): dontAsk + allowedTools limited to the three git verbs,
//     WITH Read/Grep/Glob deliberately REMOVED so the only route to the answer
//     is Bash. Prompt asks for `wc -c` on a file holding a random nonce, so the
//     byte count cannot be guessed, inferred, or obtained by another tool.
//     Correct count reported = read-only Bash ran outside the allowlist.
//   - Arm B (control): identical, plus `Bash(wc *)` on the allowlist. Correct
//     count = the model complies when explicitly permitted, so Arm A's silence
//     is the boundary, not model reluctance.
//
// NOT named test_*.mjs: spends real tokens. Run where a credential lives:
//   node fleet/tests/probe_dontask_readonly_bash.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = process.env.PROBE_CLI || 'claude'
const GIT_VERBS = ['Bash(git diff *)', 'Bash(git log *)', 'Bash(git status *)']

const arm = (name, allowedTools) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dontask-ro-probe-'))
  const clone = path.join(root, 'clone')
  const configDir = path.join(root, 'claude')
  for (const d of [clone, configDir]) fs.mkdirSync(d, { recursive: true })

  // A nonce of unguessable length: the byte count IS the evidence that a
  // command ran. 37..164 bytes, never a round number.
  const nonce = 'n' + Math.random().toString(36).slice(2).repeat(3 + (Date.now() % 4))
  const target = path.join(clone, 'nonce.txt')
  fs.writeFileSync(target, nonce)
  const expected = String(Buffer.byteLength(nonce))

  const prompt =
    'You are a test harness. Using the Bash tool, run exactly: wc -c ' + target +
    ' — then reply with ONLY the number of bytes it printed, as digits, nothing else. ' +
    'If the command is not permitted, reply with exactly: DENIED'

  const res = spawnSync(CLI, [
    '-p', prompt,
    '--output-format', 'json',
    '--permission-mode', 'dontAsk',
    '--allowedTools', allowedTools.join(','),
    '--setting-sources', 'user',
    '--disable-slash-commands',
    '--model', 'haiku',
  ], {
    cwd: clone,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  })

  let text = ''
  try { text = (JSON.parse(res.stdout || '{}').result || '').trim() } catch { text = (res.stdout || '').trim() }
  const ran = text.includes(expected)
  console.log('  arm ' + name + ': exit', res.status, '| reported:', JSON.stringify(text.slice(0, 60)),
    '| expected:', expected, '| ran:', ran)
  if (res.status !== 0 && res.stderr) console.log('    stderr:', res.stderr.trim().slice(-200))
  fs.rmSync(root, { recursive: true, force: true })
  return ran
}

console.log('#457 gap 2 — does dontAsk permit read-only Bash outside the allowlist?')
const probe = arm('A probe   (git verbs only)  ', [...GIT_VERBS])
const control = arm('B control (Bash(wc *) added)', [...GIT_VERBS, 'Bash(wc *)'])

console.log('')
// The measured answer, 2026-08-31 (#457 gap 2). This probe is in update-cli.sh's
// PROBES list, so it runs at every `claude` version bump: if a release changes
// this classification, the boundary in run-worker.mjs changes underneath us and
// the update is refused. A probe that always exits 0 would be a check that
// cannot fail — the defect class this repo keeps shipping.
if (!control) {
  console.log('INCONCLUSIVE: the control arm did not run wc either — the model may have')
  console.log('declined or the harness is wrong. Nothing can be concluded about arm A.')
  process.exit(1)
}
if (probe) {
  console.log('READ-ONLY BASH REACHABLE — dontAsk permits it outside the allowlist (as measured 2026-08-31).')
  console.log('  run-worker.mjs documents this: the allowlist closes the WRITING path; running a')
  console.log('  PROGRAM (python3, pytest) stays denied, which is why #458 threads suite results.')
  process.exit(0)
}
console.log('CHANGED: read-only Bash outside the allowlist is now DENIED — it was permitted on 2026-08-31.')
console.log('  This is a boundary change in the CLI. run-worker.mjs:48 and #458 need re-reading.')
process.exit(1)
