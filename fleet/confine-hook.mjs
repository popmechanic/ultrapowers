#!/usr/bin/env node
// fleet/confine-hook.mjs — the implementer's PreToolUse boundary (spec §4, #402 item 5).
//
// For the allowlist roles (reviewer, critic, wave author) the allowlist is the
// boundary: arbitrary Bash is unreachable, so no hook is needed. For the two
// acceptEdits roles — implementer (writable root: its own clone) and the
// write-side group (writable root: the integration clone) — the broad tool set
// makes a hook THE boundary: this script denies any Edit/Write resolving
// outside the writable roots, plus the closed denylist of write-capable Bash
// forms (`>`, `>>`, `tee`, `--output`, `-o`) targeting an absolute path
// outside them.
//
// THE ROOTS ARE DERIVED, NOT CONFIGURED. The hook runs with the worker's cwd
// (Claude Code invokes PreToolUse hooks in the session's working directory),
// and under the driver every acceptEdits worker's cwd IS its writable clone —
// makeCwdFor guarantees it. So root 1 = the hook's own cwd, and root 2 =
// $FLEET_RUN_DIR (the run scratch tree: review packets, fold candidates — the
// driver sets it in the worker env). Deriving from cwd means there is no
// per-task settings file to generate and nothing that can point at the wrong
// clone; a hook that had to be TOLD its root would be one more model-adjacent
// coordinate.
//
// TWO SUBTREES ARE CARVED OUT OF ROOT 2: `<runDir>/clones` and
// `<runDir>/patches`. The run dir CONTAINS every worker's clone and the
// driver-captured patch files, so a bare "the run dir is writable" would let
// task A write task B's tree (breaking per-worker isolation) or overwrite
// B's patch file at the file layer — under withPatchCapture's reply strip and
// waves.js's PATCH_PREFIX, which guard only the reply channel. A worker still
// writes its OWN clone freely: that is reached through root 1 (its cwd),
// which wins before the carve-out is consulted.
//
// HONEST LIMIT, from the role table it enforces (run-worker.mjs): the Bash
// denylist "is incomplete by nature" — a python heredoc, `sed -i`, `cp`,
// `dd` all write and match no form here. So does a RELATIVE redirect after a
// `cd` out of the clone (`cd /tmp && echo x > out.txt`): the target resolves
// under the hook's cwd (the clone) and passes, while the shell has moved. A
// heuristic that tried to catch the `cd` was both bypassable (quoted path,
// `pushd`, `cd$IFS`, a subshell) and false-denied a legitimate in-clone write
// whose command text merely mentioned `cd ..` — worse than the hole, so it is
// not attempted. The hook is the boundary for the enumerable, statically
// resolvable forms (an absolute or dot-dot target, `tee`/`-o`/`--output`, a
// shell-expansion target); the disposable VM is the blast radius for the rest.
// Neither substitutes for the other. Verification is spec §4's sentence:
// against a NEUTRAL role prompt and a HOSTILE task (a cooperative prompt
// passes with zero denials because the model simply declines — parity R-w3).
//
// CONTRACT: stdin carries the PreToolUse JSON ({tool_name, tool_input, cwd}).
// Exit 0 = no opinion (the permission mode proceeds as configured);
// exit 2 + stderr = deny, the stderr line fed back to the model. Exit 2 is
// used rather than the JSON decision envelope because it is the oldest,
// stablest half of the hook contract — a CLI whose envelope schema moved
// would silently stop denying, and a boundary that can be disarmed by a
// version bump is not one.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// A root confines by PATH PREFIX after resolution. `path.resolve` (not
// realpath): the target usually does not exist yet, and resolving the parent
// chain through symlinks is exactly the game a hostile path plays — the
// clone contains no symlinks out of itself by construction, and the VM is
// the backstop for one a worker creates.
export const within = (roots, target, cwd) => {
  const t = path.resolve(cwd, target)
  return roots.some((r) => t === r || t.startsWith(r.endsWith('/') ? r : r + '/'))
}

const isUnder = (root, resolved) => resolved === root || resolved.startsWith(root + path.sep)

// The writable-root test, carve-outs and all. A target is writable iff it is
// under the worker's OWN tree (cwd), or under the run dir EXCEPT the two
// subtrees no worker may write: `clones/` (every sibling's tree — writing one
// breaks per-worker isolation, and the integration clone is reachable via cwd
// for the write-side role that owns it) and `patches/` (the driver captures
// these itself; a worker writing a sibling's patch file poisons the trust
// anchor at the file layer, under it, where withPatchCapture's reply strip
// and waves.js's PATCH_PREFIX cannot see — the finding that made this
// function exist). Resolve once, here, so every sink check that follows sees
// the true path and a `/dev/..` cannot masquerade as a device.
export function writable(roots, target, cwd, carveOuts) {
  const t = path.resolve(cwd, target)
  const cwdRoot = path.resolve(cwd)
  if (isUnder(cwdRoot, t)) return true
  for (const r of roots) {
    if (r === cwdRoot) continue
    if (isUnder(r, t) && !carveOuts.some((c) => isUnder(c, t))) return true
  }
  return false
}

// The closed denylist. Each entry names the form and how its TARGET token is
// found in a naive whitespace tokenization (quotes stripped). Naive on
// purpose: this list is closed and documented incomplete; parsing shell for
// real would be an open-ended promise this boundary explicitly does not make.
const strip = (tok) => tok.replace(/^['"]|['"]$/g, '')
// #475 — DATA IS NOT CODE. The denylist below is still naive on purpose; this
// pass just stops it reading data as code. One walk marks what a shell would
// treat as DATA — heredoc bodies and quoted spans — so a `>` inside
// `echo "a -> b"`, a backtick inside a heredoc body, or a glob in a comment is
// no longer captured as a write target. Six of the eleven post-cutover denials
// were exactly that, and each one burned a worker turn and taught the worker
// something false about its own environment.
//
// MASK, NEVER DELETE. Indices are preserved and every target is sliced from the
// ORIGINAL string, so `> "/tmp/f"` is still a denial. Deleting a quoted span
// would erase the target token with it and turn this false-deny fix into a
// HOLE — the one outcome that would be worse than the bug.
const NUL = '\u0000'

export function maskData(command) {
  const s = String(command)
  const out = s.split('')
  const blank = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(to, out.length); i++) out[i] = NUL
  }

  // Heredoc bodies. `<<TAG`, `<<-TAG`, `<<'TAG'`: the body runs from the next
  // line to a line whose trimmed text is TAG. An UNTERMINATED body masks to the
  // end — the safe direction, because a redirect target never lives inside a
  // body, so over-masking here can only hide data, never a target.
  const here = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g
  for (let m; (m = here.exec(s)); ) {
    const nl = s.indexOf('\n', m.index + m[0].length)
    if (nl === -1) break
    const tag = m[2]
    let bodyEnd = s.length
    for (let i = nl + 1; i <= s.length; ) {
      const eol = s.indexOf('\n', i)
      const line = s.slice(i, eol === -1 ? s.length : eol)
      if (line.trim() === tag) { bodyEnd = i; break }
      if (eol === -1) break
      i = eol + 1
    }
    blank(nl + 1, bodyEnd)
    here.lastIndex = Math.max(here.lastIndex, bodyEnd)
  }

  // Quoted spans, walked over the heredoc-masked text so a quote inside a body
  // cannot open one. The quote CHARACTERS stay in place; only their contents are
  // masked, which leaves `strip()` able to unwrap a quoted target.
  const partial = out.join('')
  let q = null
  for (let i = 0; i < partial.length; i++) {
    const c = partial[i]
    if (q === null) {
      if (c === '\\') { i++; continue }
      if (c === "'" || c === '"') q = c
    } else if (c === q) {
      q = null
    } else {
      if (q === '"' && c === '\\' && i + 1 < partial.length) { out[i] = NUL; out[i + 1] = NUL; i++; continue }
      out[i] = NUL
    }
  }
  return out.join('')
}

export function bashWriteTargets(command) {
  const raw = String(command)
  const masked = maskData(raw)
  const targets = []
  // Redirections: `>`/`>>` (any fd prefix), the target is what follows,
  // attached or spaced. Matched on the MASKED text so `echo x>/etc/f` (no
  // space) is still seen while a quoted `>` is not; sliced from `raw` so the
  // target is the real path. The capture is the tail of the match, which is
  // what makes the index arithmetic exact.
  const redir = /\d*>{1,2}\s*([^\s|;&<>]+)/g
  for (let m; (m = redir.exec(masked)); ) {
    const start = m.index + m[0].length - m[1].length
    targets.push(strip(raw.slice(start, start + m[1].length)))
  }
  // `tee [flags] <file...>`, `-o <file>`, `--output[=]<file>`: the token TEXT
  // is read from the masked copy (so a quoted `tee` is an argument, not the
  // command) and the target VALUE from the original.
  const tok = []
  for (let m, re = /\S+/g; (m = re.exec(masked)); ) {
    tok.push({ m: strip(m[0]), o: strip(raw.slice(m.index, m.index + m[0].length)) })
  }
  for (let i = 0; i < tok.length; i++) {
    if (tok[i].m === 'tee' || tok[i].m.endsWith('/tee')) {
      for (let j = i + 1; j < tok.length && !/^[|;&]/.test(tok[j].m); j++) {
        if (!tok[j].m.startsWith('-')) targets.push(tok[j].o)
      }
    }
    if ((tok[i].m === '-o' || tok[i].m === '--output') && tok[i + 1]) targets.push(tok[i + 1].o)
    if (tok[i].m.startsWith('--output=')) targets.push(strip(tok[i].o.slice('--output='.length)))
    if (tok[i].m.startsWith('-o=')) targets.push(strip(tok[i].o.slice(3)))
  }
  return targets.filter(Boolean)
}

// The file-path input keys of the write-capable tools. MultiEdit/NotebookEdit
// are covered even though the driver's matcher may not dispatch them — a
// matcher tightened later must not silently widen the boundary.
const FILE_KEYS = ['file_path', 'notebook_path', 'path']

export function decide(input) {
  const cwd = input.cwd || process.cwd()
  const roots = [path.resolve(cwd)]
  const carveOuts = []
  if (process.env.FLEET_RUN_DIR) {
    const runRoot = path.resolve(process.env.FLEET_RUN_DIR)
    roots.push(runRoot)
    // The two subtrees the run dir root must NOT expose (finding 1): every
    // sibling's clone and the driver-owned patch files.
    carveOuts.push(path.join(runRoot, 'clones'), path.join(runRoot, 'patches'))
  }
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const rootsMsg = ' outside the writable roots (' + roots.join(', ') +
    '; not ' + carveOuts.join(', ') + '). Write only inside your working tree.'

  if (tool === 'Bash') {
    const cmd = String(ti.command || '')
    for (const raw of bashWriteTargets(cmd)) {
      const abs = path.resolve(cwd, raw)
      // /dev/* is a sink, not storage: `2>/dev/null` rides half the
      // legitimate commands a worker runs. Tested on the RESOLVED path, so
      // `/dev/../etc/passwd` is not a device and is not exempt.
      if (abs === '/dev' || abs.startsWith('/dev/')) continue
      // A target carrying a shell expansion (`$VAR`, `$(...)`, backticks) is
      // not statically resolvable — the token the shell writes is not the
      // token here. `> $O` captured as the literal `$O` would resolve INSIDE
      // the clone and pass, while the shell writes wherever $O points. Deny
      // rather than resolve a value we cannot know. No real path contains `$`
      // or a backtick, so this never false-denies a literal target.
      if (/[$`]/.test(raw)) {
        return { deny: 'confine-hook: write target ' + raw + ' contains a shell expansion ' +
          'that cannot be resolved statically — refusing. Use a literal path.' }
      }
      if (!writable(roots, raw, cwd, carveOuts)) {
        return { deny: 'confine-hook: Bash write form targets ' + raw + rootsMsg }
      }
    }
    return { allow: true }
  }

  for (const k of FILE_KEYS) {
    if (typeof ti[k] === 'string' && ti[k]) {
      if (!writable(roots, ti[k], cwd, carveOuts)) {
        return { deny: 'confine-hook: ' + tool + ' ' + ti[k] + rootsMsg }
      }
    }
  }
  return { allow: true }
}

const invokedDirectly = process.argv[1] &&
  import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href
if (invokedDirectly) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { raw += d })
  process.stdin.on('end', () => {
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      // Fail CLOSED: a boundary that allows on unparsable input is disarmed
      // by whatever breaks the parse. Emit the deny decision AND exit 2 so it
      // blocks by both mechanisms.
      emit('deny', 'confine-hook: unreadable PreToolUse input — denying (fail-closed)')
      process.exit(2)
    }
    const verdict = decide(input)
    if (verdict.deny) {
      // Record the denial in the run dir: it is real evidence for the receipt
      // (what a worker tried to do outside its root) AND the only signal a
      // confinement probe can read — the decision JSON goes to Claude Code, not
      // the worker's captured output, so a probe cannot see it otherwise.
      // Best-effort: a boundary must never fail because its log is unwritable.
      if (process.env.FLEET_RUN_DIR) {
        try {
          fs.appendFileSync(path.join(process.env.FLEET_RUN_DIR, 'confine-denials.jsonl'),
            JSON.stringify({ ts: Date.now(), source: 'hook', tool: input.tool_name, reason: verdict.deny }) + '\n')
        } catch { /* unwritable log never blocks the deny */ }
      }
      emit('deny', verdict.deny)
      process.exit(0)
    }
    // AUTHORITATIVELY ALLOW. A silent exit-0 is "no opinion" — the permission
    // flow then still PROMPTS, which blocks a headless worker forever (the
    // first self-hosted run parked here: setup's `git worktree add` waited on
    // an approval nobody could give). An explicit `permissionDecision: allow`
    // suppresses the prompt under acceptEdits, which is what makes the hook the
    // boundary rather than merely a veto — allowed inside the roots, denied
    // outside, no prompt either way.
    emit('allow', 'confine-hook: within the writable roots')
    process.exit(0)
  })
}

// The PreToolUse decision contract (code.claude.com/docs/en/hooks): a JSON
// object on stdout whose `hookSpecificOutput.permissionDecision` is `allow` or
// `deny` settles the permission question before any prompt. `allow` is what a
// headless worker needs — acceptEdits alone auto-approves only edits, never the
// git/test Bash every write-side role runs.
function emit(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  }) + '\n')
}
