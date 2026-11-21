const SHELL_WORDS = Object.freeze([
  'for', 'in', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until',
  'case', 'esac', 'test', '[', '[[', 'export', 'set', 'cd', 'exit', 'return', 'read',
  'shift', 'local', 'eval', 'exec', 'source', '.', ':', 'command', 'type', 'wait',
  'trap', 'unset', 'let', 'declare', 'true', 'false', 'echo', 'printf', 'break', 'continue',
  'kill'
])

export const SANDBOX_TOOLCHAIN = Object.freeze([
  'node', 'npm', 'npx', 'bun', 'bunx', 'celld', 'python3', 'pytest',
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

export function probeWordsOf (line) {
  const text = String(line ?? '')
  const segments = [[]]
  let token = ''
  let quote = null
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
  const tasks = Array.isArray(compiled?.payload?.tasks) ? compiled.payload.tasks : []
  for (const task of tasks) {
    const runs = Array.isArray(task?.proofRuns) ? task.proofRuns : []
    for (const cmd of runs) note(task?.id ?? '?', cmd)
  }
  const checks = Array.isArray(compiled?.payload?.checks) ? compiled.payload.checks : []
  for (const check of checks) if (check && typeof check.cmd === 'string') note('check', check.cmd)
  return out
}
