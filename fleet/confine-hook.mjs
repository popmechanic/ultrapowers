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
// `dd` all write and match no form here. The hook is the boundary for the
// enumerable forms; the disposable VM is the blast radius for the rest.
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
export function bashWriteTargets(command) {
  const targets = []
  // Redirections: `>`/`>>` (any fd prefix), the target is what follows,
  // attached or spaced. One regex pass over the raw text so `echo x>/etc/f`
  // (no space) is seen too.
  const redir = /\d*>{1,2}\s*([^\s|;&<>]+)/g
  for (let m; (m = redir.exec(command)); ) targets.push(strip(m[1]))
  // `tee [flags] <file...>`: every non-flag token after tee until a shell
  // separator.
  const toks = command.split(/\s+/).map(strip)
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'tee' || toks[i].endsWith('/tee')) {
      for (let j = i + 1; j < toks.length && !/^[|;&]/.test(toks[j]); j++) {
        if (!toks[j].startsWith('-')) targets.push(toks[j])
      }
    }
    // `-o <file>` / `--output <file>` / `--output=<file>`
    if ((toks[i] === '-o' || toks[i] === '--output') && toks[i + 1]) targets.push(toks[i + 1])
    if (toks[i].startsWith('--output=')) targets.push(strip(toks[i].slice('--output='.length)))
    if (toks[i].startsWith('-o=')) targets.push(strip(toks[i].slice(3)))
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
    // A `cd` to an absolute path or through `..` moves the shell's effective
    // directory, so a relative write target no longer resolves under the
    // clone the hook checks it against — deny loudly rather than resolve it
    // against the wrong base. `cd subdir` (relative, no `..`) stays inside
    // the clone and is fine; only an escaping `cd` combined with a write is
    // refused. (A plain `cd /abs` with no write never reaches here.)
    const escapingCd = /(^|[;&|]|\s)cd\s+(\/|[^;&|]*\.\.)/.test(cmd)
    for (const raw of bashWriteTargets(cmd)) {
      const abs = path.resolve(cwd, raw)
      // /dev/* is a sink, not storage: `2>/dev/null` rides half the
      // legitimate commands a worker runs. Tested on the RESOLVED path, so
      // `/dev/../etc/passwd` is not a device and is not exempt (finding 2).
      if (abs === '/dev' || abs.startsWith('/dev/')) continue
      if (escapingCd && !path.isAbsolute(raw)) {
        return { deny: 'confine-hook: a relative write target (' + raw + ') after a `cd` ' +
          'to an absolute or `..` path is unresolvable — refusing. Use an absolute path ' +
          'inside your working tree.' }
      }
      // A target carrying a shell expansion (`$VAR`, `$(...)`, backticks) is
      // not statically resolvable — the token the shell writes is not the
      // token here. `> $O` captured as the literal `$O` would resolve INSIDE
      // the clone and pass, while the shell writes wherever $O points. Deny
      // rather than resolve a value we cannot know (finding 3). This still
      // does not parse shell — an un-enumerated write form is the VM's job —
      // but it closes the enumerated redirect form the hook DOES claim.
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
      // by whatever breaks the parse.
      console.error('confine-hook: unreadable PreToolUse input — denying (fail-closed)')
      process.exit(2)
    }
    const verdict = decide(input)
    if (verdict.deny) {
      console.error(verdict.deny)
      process.exit(2)
    }
    process.exit(0)
  })
}
