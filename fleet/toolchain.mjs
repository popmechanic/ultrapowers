/**
 * The sandbox-toolchain check: what a fresh sandbox can run, by name, and the
 * pure walk that names every `Run:` probe or `Check:` word it lacks. Pure — no
 * imports. `fleet/launch.mjs` calls `toolchainViolations` before any VM exists.
 */

/**
 * The shell's own words — keywords and builtins — that stand at command
 * position without naming a program the sandbox must have. `probeWordsOf`
 * skips them; a `Run:` line's `test`, `echo` and `for` are bash's, not the
 * box's.
 */
const SHELL_WORDS = Object.freeze([
  'for', 'in', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until',
  'case', 'esac', 'test', '[', '[[', 'export', 'set', 'cd', 'exit', 'return', 'read',
  'shift', 'local', 'eval', 'exec', 'source', '.', ':', 'command', 'type', 'wait',
  'trap', 'unset', 'let', 'declare', 'true', 'false', 'echo', 'printf'
])

/**
 * What a fresh sandbox can run, by name (#645). Two groups: what the exeuntu
 * image ships — `claude`, `gh`, `git`, `jq`, `python3`, `curl`, bash and the
 * coreutils — and the delta `fleet/setup-script.mjs` installs, exactly node
 * (with npm and npx), bun (with bunx), celld and pytest. A `Run:` probe or a
 * `Check:` line runs on that box under `timeout <s> bash -lc <line>`, so a
 * command word missing here exits 127 in its first second, after the plan was
 * pushed and a VM created; `toolchainViolations` refuses it on the laptop
 * instead, by name — never by language (the operator's shape, 2026-09-05).
 * A word this list lacks is a refusal until someone adds it here beside the
 * setup-script rung that installs it.
 */
export const SANDBOX_TOOLCHAIN = Object.freeze([
  // the setup script's delta
  'node', 'npm', 'npx', 'bun', 'bunx', 'celld', 'python3', 'pytest',
  // the image
  'claude', 'gh', 'git', 'jq', 'curl', 'bash', 'sh', 'env', 'sudo', 'install',
  'apt-get', 'timeout', 'xargs', 'find', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'tr',
  'cut', 'sort', 'uniq', 'head', 'tail', 'wc', 'cat', 'tee', 'diff', 'cmp', 'comm',
  'paste', 'seq', 'expr', 'date', 'sleep', 'basename', 'dirname', 'readlink',
  'realpath', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'ls', 'touch', 'chmod',
  'chown', 'stat', 'tar', 'gzip', 'gunzip', 'unzip', 'zip', 'md5sum', 'sha256sum',
  'base64', 'od', 'xxd', 'hexdump', 'tac', 'rev', 'nl', 'fold', 'column', 'yes',
  'which', 'pwd', 'whoami', 'id', 'hostname', 'uname', 'ps', 'kill', 'pkill',
  'nohup', 'mktemp', 'truncate', 'split', 'join', 'shuf', 'tsort', 'du', 'df',
  'nproc', 'free', 'ss', 'nc', 'ssh'
])

/**
 * The command words of one shell line: the first word of the line and of
 * every segment after `|`, `||`, `&&`, `;`, `$(` or `(`, and the word after
 * each of `do`, `then`, `else`, `elif` — skipping `!`, a `NAME=value`
 * assignment and every `SHELL_WORDS` entry, and dropping a word that carries
 * a `/` (a path in the target, not a program by name) or opens with `$`, a
 * quote, `-` or a digit (an expansion, a string, a flag, a redirection).
 * Quote-aware: an operator inside a single- or double-quoted span splits
 * nothing (`grep -E "a|b"` names one program), and a `$(` inside double
 * quotes still opens a segment, because bash runs what is inside it.
 * Duplicates are kept; the caller deduplicates per task.
 */
export function probeWordsOf (line) {
  const text = String(line ?? '')
  // Segments: split on the operators outside quotes, and on `$(` outside
  // single quotes; each segment is a list of whitespace-split tokens with
  // quoted spans kept whole.
  const segments = [[]]
  let token = ''
  let quote = null
  // The quote state to restore when a `$(` … `)` substitution closes.
  const substitutions = []
  const endToken = () => { if (token !== '') { segments[segments.length - 1].push(token); token = '' } }
  const newSegment = () => { endToken(); segments.push([]) }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (quote === "'") {
      token += ch
      if (ch === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && next !== undefined) { token += ch + next; i += 1; continue }
      if (ch === '$' && next === '(') { substitutions.push('"'); quote = null; newSegment(); i += 1; continue }
      token += ch
      if (ch === '"') quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; token += ch; continue }
    if (ch === '\\' && next !== undefined) { token += ch + next; i += 1; continue }
    if ((ch === '|' && next === '|') || (ch === '&' && next === '&')) { newSegment(); i += 1; continue }
    if (ch === '|' || ch === ';' || ch === '(') { newSegment(); continue }
    if (ch === '$' && next === '(') { substitutions.push(null); newSegment(); i += 1; continue }
    if (ch === ')') { endToken(); quote = substitutions.length ? substitutions.pop() : null; segments.push([]); continue }
    if (/\s/.test(ch)) { endToken(); continue }
    token += ch
  }
  endToken()
  const words = []
  for (const tokens of segments) {
    let atCommand = true
    for (const raw of tokens) {
      const t = raw.replace(/[}\]]+$/, '')
      if (!atCommand) {
        if (['do', 'then', 'else', 'elif'].includes(t)) atCommand = true
        continue
      }
      if (t === '' || t === '!' || t === '{' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue
      if (SHELL_WORDS.includes(t)) {
        atCommand = ['do', 'then', 'else', 'elif', 'command', 'exec', 'eval'].includes(t)
        continue
      }
      atCommand = false
      if (t.includes('/') || /^[$"'\-0-9<>]/.test(t)) continue
      words.push(t)
    }
  }
  return words
}

/**
 * Every command word of every task's `proofRuns` across `compiled.waves`, and
 * of every `compiled.payload.checks[].cmd` (task `check`), that
 * `SANDBOX_TOOLCHAIN` lacks — one `{ task, word, cmd }` per (task, word), in
 * document order. Pure; empty means every probe and check can run on the box.
 */
export function toolchainViolations (compiled) {
  const out = []
  const seen = new Set()
  const note = (task, cmd) => {
    for (const word of probeWordsOf(cmd)) {
      if (SANDBOX_TOOLCHAIN.includes(word)) continue
      const key = `${task}\u0000${word}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ task: String(task), word, cmd: String(cmd) })
    }
  }
  const waves = Array.isArray(compiled?.waves) ? compiled.waves : []
  for (const wave of waves) {
    if (!Array.isArray(wave)) continue
    for (const task of wave) {
      const runs = Array.isArray(task?.proofRuns) ? task.proofRuns : []
      for (const cmd of runs) note(task?.id ?? '?', cmd)
    }
  }
  const checks = Array.isArray(compiled?.payload?.checks) ? compiled.payload.checks : []
  for (const check of checks) if (check && typeof check.cmd === 'string') note('check', check.cmd)
  return out
}
