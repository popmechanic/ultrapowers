/**
 * factory/gitblock.mjs — the reader behind "models never run git".
 *
 * `findGit(command)` reads one Bash command LINE and answers the first
 * segment whose command word runs git, or `null`. It is naive on purpose and
 * incomplete by nature: it does not parse shell the way a shell does, it
 * cannot tell quoted data from code, and an unbalanced quote or paren is not
 * evidence about the data it wraps — it is simply not evidence. What it must
 * not be is wrong in the direction that lets git through: a miss is worse
 * than a false deny, so this reader masks generously and never claims more
 * confidence than it has. It imports nothing, so it carries no ambient
 * authority of its own — no filesystem, no process, no network.
 */

// A segment starts at the start of the line and after each of these — the
// two-character forms tried first so a lone `&` or `|` isn't mistaken for
// half of `&&` / `||`.
const SEGMENT_DELIM = /&&|\|\||;|\||&|\n|\$\(|`|\(|\{/g

// Shell keywords that precede a command word without being one themselves.
const KEYWORDS = new Set(['then', 'do', 'else', 'time', '!', 'exec'])

// Wrappers whose own flags (and, for `env`, `NAME=value` words) are skipped
// before the command word they run.
const FLAG_WRAPPERS = new Set(['command', 'nohup', 'nice', 'sudo'])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function stripQuotes (s) {
  const t = String(s)
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1)
    }
  }
  return t
}

/** Split one segment into words, a single-quoted or double-quoted run held
 *  together as one word, everything else split on whitespace. */
function tokenize (segment) {
  return String(segment).match(/'[^']*'|"[^"]*"|\S+/g) || []
}

/** Walk past assignments, keywords and wrapper words to the index of the
 *  word that actually names the command, or -1 when a segment names none. */
function commandWordIndex (words) {
  let i = 0
  while (i < words.length) {
    const raw = words[i]
    if (ASSIGNMENT.test(raw)) { i += 1; continue }
    const word = stripQuotes(raw)
    if (KEYWORDS.has(word)) { i += 1; continue }
    if (word === 'env') {
      i += 1
      while (i < words.length && (/^-/.test(words[i]) || ASSIGNMENT.test(words[i]))) i += 1
      continue
    }
    if (FLAG_WRAPPERS.has(word)) {
      i += 1
      while (i < words.length && /^-/.test(words[i])) i += 1
      continue
    }
    if (word === 'timeout') {
      i += 1
      while (i < words.length && /^-/.test(words[i])) i += 1
      if (i < words.length) i += 1 // the duration
      continue
    }
    if (word === 'xargs') {
      i += 1
      while (i < words.length && /^-/.test(words[i])) i += 1
      continue
    }
    break
  }
  return i < words.length ? i : -1
}

function isGitWord (word) {
  const stripped = stripQuotes(word)
  return stripped === 'git' || stripped.endsWith('/git')
}

/**
 * Answer the first offending segment of one Bash command line, or `null`.
 *
 * A segment runs git when its command word — after skipping assignments,
 * shell keywords and the known wrappers' own flags — is exactly `git` or
 * ends in `/git`. `sh -c`, `bash -c`, `zsh -c` and `eval` are read one level
 * deeper: their string argument is read as a command line of its own, by
 * this same rule.
 */
export function findGit (command) {
  const line = String(command)
  const segments = line.split(SEGMENT_DELIM)
  for (const segment of segments) {
    const words = tokenize(segment)
    const idx = commandWordIndex(words)
    if (idx === -1) continue
    const word = stripQuotes(words[idx])
    if (isGitWord(word)) {
      const trimmed = segment.trim()
      if (trimmed) return trimmed
      continue
    }
    if (word === 'sh' || word === 'bash' || word === 'zsh') {
      let j = idx + 1
      let cIdx = -1
      while (j < words.length && /^-/.test(words[j])) {
        if (words[j] === '-c') { cIdx = j; break }
        j += 1
      }
      if (cIdx !== -1 && cIdx + 1 < words.length) {
        const inner = findGit(stripQuotes(words[cIdx + 1]))
        if (inner !== null) {
          const trimmed = segment.trim()
          if (trimmed) return trimmed
        }
      }
      continue
    }
    if (word === 'eval') {
      const rest = words.slice(idx + 1).join(' ')
      if (rest) {
        const inner = findGit(stripQuotes(rest))
        if (inner !== null) {
          const trimmed = segment.trim()
          if (trimmed) return trimmed
        }
      }
      continue
    }
  }
  return null
}

export default { findGit }
