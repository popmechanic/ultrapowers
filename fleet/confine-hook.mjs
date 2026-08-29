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
// $FLEET_RUN_DIR (the run scratch tree: review packets, plans — the driver
// sets it in the worker env). Deriving from cwd means there is no per-task
// settings file to generate and nothing that can point at the wrong clone; a
// hook that had to be TOLD its root would be one more model-adjacent
// coordinate.
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
  if (process.env.FLEET_RUN_DIR) roots.push(path.resolve(process.env.FLEET_RUN_DIR))
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}

  if (tool === 'Bash') {
    const cmd = String(ti.command || '')
    for (const t of bashWriteTargets(cmd)) {
      // /dev/* is a sink, not storage: `2>/dev/null` rides half the
      // legitimate commands a worker runs, and denying it would make the
      // boundary indistinguishable from breakage.
      if (t.startsWith('/dev/')) continue
      // Relative targets resolve under cwd — inside the clone by
      // construction. Only a resolved-outside path is denied.
      if (!within(roots, t, cwd)) {
        return { deny: 'confine-hook: Bash write form targets ' + t +
          ' outside the writable roots (' + roots.join(', ') + '). ' +
          'Write only inside your working tree or the run directory.' }
      }
    }
    return { allow: true }
  }

  for (const k of FILE_KEYS) {
    if (typeof ti[k] === 'string' && ti[k]) {
      if (!within(roots, ti[k], cwd)) {
        return { deny: 'confine-hook: ' + tool + ' ' + ti[k] +
          ' resolves outside the writable roots (' + roots.join(', ') + '). ' +
          'Write only inside your working tree or the run directory.' }
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
