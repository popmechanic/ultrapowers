// fleet/run-worker.mjs — the third implementation of a seam that already exists.
//
// The engine (fleet/run-engine.mjs) is parameterised over one seam:
// `agent(prompt, opts)`. This module supplies the production implementation —
// one `claude -p` process per call. Spec §2 (#401). (waves.js and its sims,
// the seam's first two suppliers, are deleted since 0.3.0.)
//
// PROVENANCE: every `waves.js:NNNN` citation below points into that deleted
// harness (`git show 44e0d15^:skills/ultrapowers/harnesses/waves.js`). The
// contracts they cite are inherited verbatim by fleet/run-engine.mjs, which is
// the caller today; the citations are kept as the record of where each rule
// was read off, not as a live file.
//
// THE WHOLE INTERFACE — four option keys, ten call sites in waves.js:
//
//   label      all sites   worker identity; here it selects the role and the
//                          deterministic session uuid
//   model      all but one 'haiku' | 'sonnet' | 'opus' -> --model. OMITTED at
//                          waves.js:1589 (the resolver, deliberately: verified
//                          live that agent() accepts opts with no `model`), so
//                          absent MUST mean "omit --model", never "default it".
//   schema     all sites   -> --json-schema (inline JSON; parity R-o1)
//   isolation  TWO sites   'worktree' at :1107 (implementer) and :1265 (fix).
//                          The Workflow runtime cut those worktrees FROM THE
//                          SESSION CHECKOUT, which is #314's cause in waves.js's
//                          own words (:1116). Here the caller hands us clones
//                          already cut AT BASE, so the defect is not fixed — it
//                          becomes inexpressible, and #354 closes as moot.
//
// AND ONE RETURN CONVENTION, honoured exactly:
//
//   agent() returns the parsed structured reply, or `null` — never throws — when
//   the call was aborted mid-run or hit an unrecoverable API error.
//   (workflows#what-the-saved-script-looks-like.) waves.js converts that null
//   into a tagged AGENT_NULL throw at every one of the ten sites, which routes
//   the task to the barrier-retry park lane. Return the wrong shape here and the
//   engine's whole infra-fault path silently stops working.
//
// Every classification below is a REPRODUCTION, not a reading of the docs. The
// ledger is docs/superpowers/specs/2026-08-28-claude-p-worker-parity.md; the
// repro ids (R-o*, R-l*) are cited per row. Two things are NOT reproductions and
// are marked ASSUMPTION where they are relied on.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ── Roles (spec §4) ──────────────────────────────────────────────────────────
// Roles are DATA, one object per role — not code and not prose. The axis that
// matters is the writable root, because that is the only thing isolation is
// about; the tool lists are the mechanism that enforces it.
//
// For the allowlist roles (reviewer, critic) THE ALLOWLIST IS THE BOUNDARY FOR
// WRITES: a hostile `python3 <<'EOF' … open(path,'a')` heredoc, matching no
// denylist a hook could enumerate, was denied by it (parity R-w3), so the
// unspecifiable "does this shell command write" predicate never arises.
//
// PRECISION, measured 2026-08-31 (#457, probe_dontask_readonly_bash.mjs): it is
// NOT true that arbitrary Bash is unreachable — this comment used to say so.
// `dontAsk` permits READ-ONLY Bash as a class, outside the allowlist: with
// Read/Grep/Glob removed and only the three git verbs allowed, a worker still
// ran `wc -c` and reported the right byte count. What the allowlist closes is
// the WRITING path, which is the half that matters. Running a PROGRAM
// (`python3 …`, `pytest`) is not classified read-only and stays denied — which
// is why reviewers defer suite results (#458) while being able to `cat` a file.
//
// THE HALF THAT COMMENT LEFT OUT, and it is the half that bit us:
// **read-only Bash only reaches paths in scope.** probe_dontask_readonly_bash
// runs `wc -c` on a path INSIDE cwd and passes no `--add-dir`, so it never
// tested the shape production actually runs. probe_addcwd_scope.mjs isolates
// the variable (2026-08-31, five arms, live CLI):
//
//   A  `wc -c` in cwd,      no --add-dir  -> RAN      (the old probe's shape)
//   B  `wc -c` out of cwd,  no --add-dir  -> DENIED   (the PRODUCTION shape)
//   C  `wc -c` out of cwd,  --add-dir     -> RAN      (`--add-dir` reaches Bash)
//   D  `python3 -c`, not allowlisted      -> DENIED   (exec is not read-only)
//   E  `python3 -c`, allowlisted          -> RAN      (exec IS grantable, narrowly)
//
// A reviewer's cwd is `<runDir>/clones/integration`, and `wavesPath`
// (launch.json) and `patches/` live in `<runDir>` — a PARENT. So every reviewer
// read of its OWN inputs was denied, in five consecutive runs, as a PATH-SCOPE
// denial that looked like a tool-class one. Those denials became `cannotVerify`
// entries, then deferred acks, then parked runs. The cause was not a boundary
// decision: `addDirsFor` was never supplied to createRunWorker, so the
// `--add-dir` push below was dead code. Fixed by composeAgent supplying it.
//
// Bodies CANNOT be inlined instead: compile_plan's `--emit-args` requires
// `--emit-launch` precisely "so wavesPath is always populated" — task bodies
// ride the launch file by design and never the prompt. Reading it is the
// contract, so the run dir must be in scope.
//
// bypassPermissions does NOT path-gate (arm F), so the write-side roles need no
// `--add-dir` and are deliberately given none: read reach they do not need is
// exposure they should not have.
//
// The `*` tail is not an execution channel: substitution inside an allowed
// command's arguments (`git status $(touch X)`) is BLOCKED, measured the same
// day (probe_substitution_in_allowed_tail.mjs), matching the documented
// operator parsing for `&&`, `;`, `|`. For the implementer, which needs a broad tool set under
// bypassPermissions, the PreToolUse hook is the boundary and the sandbox is
// the blast radius; the caller supplies that hook via `settings`.
//
// The critic's extra three git verbs are LOAD-BEARING, not convenience:
// waves.js:373-376 — its sha-verified `git checkout --detach` doubles as the
// branch release the frozen `ultra_gate.py --approve` checkout needs, so a
// critic that never detached reports BLOCKED and a BLOCKED gate is never
// Approved; :619-630 needs rev-parse + merge-base --is-ancestor for the #70/#259
// ancestry assertion, without which a silent merge drop is undetectable.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git status *)']

export const ROLES = {
  implementer: {
    // bypassPermissions + the hook + --disallowedTools, all three measured
    // (2026-08-29): a PreToolUse deny HOLDS under bypass
    // (probe_bypass_vs_hook.mjs) and --disallowedTools still binds
    // (probe_disallowed_vs_bypass.mjs) — so no legitimate command can ever
    // block a headless worker, while every boundary (hook roots, git
    // push/stash escape hatch) keeps enforcing. acceptEdits was the shipped
    // posture through run-26; the flip is run-27's measured change (spec §1).
    permissionMode: 'bypassPermissions',
    // Default tool set (no --allowedTools) minus two verbs that would let a
    // worker escape or publish its own work.
    disallowedTools: ['Bash(git stash *)', 'Bash(git push *)'],
    writableRoot: 'clone',
  },
  writeSide: {
    // setup / merge / reconcile / resolver: the roles that write to the
    // integration clone. Same tool posture as the implementer plus the two
    // integration verbs.
    permissionMode: 'bypassPermissions',
    disallowedTools: ['Bash(git stash *)', 'Bash(git push *)'],
    writableRoot: 'integration',
  },
  reviewer: {
    permissionMode: 'dontAsk',
    allowedTools: READ_ONLY_TOOLS,
    writableRoot: null,
  },
  // Amendment 10: the resolver returns hunk resolutions in its SCHEMA and the
  // driver writes the kernel reply directory — so the role is read-only and
  // the write-side family shrinks to the reconcile agent alone.
  resolver: {
    permissionMode: 'dontAsk',
    allowedTools: READ_ONLY_TOOLS,
    writableRoot: null,
  },
  critic: {
    // The three extra git verbs (checkout --detach, rev-parse, merge-base) are
    // deleted with Amendment 10: the driver performs the detach and derives
    // the #70 ancestry check from fold receipts, so the critic's allowlist
    // collapses to the plain read-only set (spec §2 deletion-ledger row).
    permissionMode: 'dontAsk',
    allowedTools: READ_ONLY_TOOLS,
    writableRoot: null,
  },
}

// ── label -> role ────────────────────────────────────────────────────────────
// The complete taxonomy of labels waves.js emits, read off the ten call sites.
// Exhaustive by construction: an unrecognised label is a FAILED RUN, never a
// silent fallback to a permissive role. A new dispatch site in waves.js must
// declare its role here or the driver refuses to start it — which is the point.
//
// Under the Amendment 10 engine (fleet/run-engine.mjs) the label set shrinks:
// setup and merge:* are driver code and never dispatch. The rows are kept so a
// stray old-style label still resolves to a non-permissive role rather than
// crashing a run mid-wave; `resolve` moves to its own read-only role (the
// driver writes the reply dir from the resolver's schema reply).
//
//   impl:<id>                                   implementer  (isolation)
//   fix:<id>:<iter>                             implementer  (isolation)
//   review:<id>:<iter>[:<pass>]                 reviewer
//   integration                                 critic  (completeness, read-only)
//   resolve:wave<n>:<i>:<a>                     resolver (read-only)
//   reconcile:wave<n>:<a>                       writeSide
//   setup / merge:wave<n>[...]                  writeSide (legacy labels; driver code now)
export function roleForLabel(label) {
  if (typeof label !== 'string' || !label) {
    throw new Error('runWorker: opts.label is required (it is the worker identity)')
  }
  if (label === 'integration') return 'critic'
  if (label === 'setup') return 'writeSide'
  const prefix = label.split(':')[0]
  switch (prefix) {
    case 'impl': case 'fix': return 'implementer'
    case 'review': return 'reviewer'
    case 'resolve': return 'resolver'
    case 'merge': case 'reconcile': return 'writeSide'
    default:
      throw new Error('runWorker: no role declared for label "' + label + '". ' +
        'A new agent() dispatch site must declare its role in roleForLabel — ' +
        'defaulting one to a permissive role is how isolation is lost silently.')
  }
}

// ── label -> session uuid ────────────────────────────────────────────────────
// `--session-id` takes a uuid, and `label` is prose. Derive the uuid from
// (runId, label) so it is deterministic: the same worker in a re-drive lands on
// the same transcript path, and the receipt can name it without a side table.
// Not a v5 uuid (no namespace ceremony) — a sha256 stamped into uuid shape.
export function sessionIdFor(runId, label) {
  const h = createHash('sha256').update(String(runId) + '\\x00' + label).digest('hex')
  // sha256 hex is always 64 chars, so h[16] is always defined — no guard.
  const v = '89ab'[parseInt(h[16], 16) % 4]
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), v + h.slice(17, 20), h.slice(20, 32)].join('-')
}

// ── the argv ─────────────────────────────────────────────────────────────────
// Pure: takes the resolved worker, returns the argv. Kept separate from spawn so
// the whole flag surface is testable without a process.
//
// Standing hygiene, from the cache measurement (#382,
// 2026-08-28-prompt-cache-across-workers.md):
//   --exclude-dynamic-system-prompt-sections raises cross-clone prefix sharing
//   from 72.6% to 88.4%, so every worker carries it;
//   the shared prefix block is keyed on model AND CLI version alone, so rolling
//   the CLI mid-wave costs every later worker ~18k tokens — the driver pins the
//   version per run (checked by the caller, recorded in the receipt);
//   the env never carries FORCE_PROMPT_CACHING_5M or DISABLE_PROMPT_CACHING*.
//
// --setting-sources user --disable-slash-commands + a per-run CLAUDE_CONFIG_DIR
// is the SUBSTITUTE for `--bare`, which the design inputs asked for and which
// does not work: `--bare` never reads OAuth and exits 1 "Not logged in" even
// with CLAUDE_CODE_OAUTH_TOKEN set (parity R-o11b/R-l7/R-l8, #384 — a blocker,
// not a preference). R-o11c proves the substitute achieves the row's intent:
// project hooks not run, repo CLAUDE.md not loaded, skills off, schema and
// appended prompt honoured, OAuth works.
// THE PROMPT IS NOT IN HERE, and that is load-bearing. `--allowedTools`,
// `--disallowedTools` and `--add-dir` are declared VARIADIC (`<tools...>`), so a
// prompt appended as a trailing positional is swallowed as one more value of
// whichever variadic option came last, and the CLI exits 1 with
// `Input must be provided either through stdin or as a prompt argument when
// using --print` — no envelope on stdout, so the driver's own classifier calls
// it 'no-envelope' and the real cause never surfaces. Observed live 2026-08-28
// while probing this module, which is precisely what the live arm is for: the
// unit test's fake `claude` accepted the trailing positional happily.
//
// So the prompt goes where every repro in the parity ledger puts it — the value
// of `-p` — and `runProcess` assembles `['-p', prompt, ...flags]`.
export function buildArgs({ opts, role, sessionId, promptFile, addDirs = [], settings, maxTurns, maxBudgetUsd, effort }) {
  const r = ROLES[role]
  const argv = [
    '--output-format', 'json',
    '--session-id', sessionId,
    // R-o11c: the --bare substitute.
    '--setting-sources', 'user',
    '--disable-slash-commands',
    '--exclude-dynamic-system-prompt-sections',
    '--permission-mode', r.permissionMode,
  ]
  // Omission is meaningful (waves.js:1589 dispatches the resolver with no
  // `model` on purpose). Never fill it in here.
  if (opts.model) argv.push('--model', opts.model)
  // NEVER --fallback-model: it is the only path that silently downgrades a
  // model, and "no Sonnet-for-Opus" is a standing rule, not a preference
  // (parity §4, R-o12o).
  if (effort) argv.push('--effort', effort)
  if (opts.schema) argv.push('--json-schema', JSON.stringify(opts.schema))
  if (promptFile) argv.push('--append-system-prompt-file', promptFile)
  if (r.allowedTools) argv.push('--allowedTools', r.allowedTools.join(','))
  if (r.disallowedTools) argv.push('--disallowedTools', r.disallowedTools.join(','))
  for (const d of addDirs) argv.push('--add-dir', d)
  if (settings) argv.push('--settings', settings)
  // Both are per-worker backstops, not the deleted run-level cap (#400): a trip
  // fails ONE task with a recorded class. `--max-turns` is accepted but hidden
  // from --help on every version measured (R-o12s, R-o2b, R-l3).
  if (maxTurns) argv.push('--max-turns', String(maxTurns))
  if (maxBudgetUsd) argv.push('--max-budget-usd', String(maxBudgetUsd))
  return argv
}

// ── the envelope ─────────────────────────────────────────────────────────────
// Take the LAST `result` line. A worker that spawns a background subagent emits
// TWO under stream-json — an interim one and the final one (parity R-o8) —
// and which of the two `--output-format json` prints was never reproduced. So
// this parses defensively even on the single-envelope path.
export function lastResult(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return null
  // Fast path: the whole of stdout is one JSON object (--output-format json).
  try {
    const one = JSON.parse(text)
    if (one && one.type === 'result') return one
  } catch { /* fall through to the line scan */ }
  let found = null
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    try {
      const obj = JSON.parse(s)
      if (obj && obj.type === 'result') found = obj
    } catch { /* a partial or non-JSON line is not an envelope */ }
  }
  return found
}

// ── the exit-class table (spec §6; parity items 7, 7b, 7c) ───────────────────
// Classify from the ENVELOPE, never the exit code alone. Exit codes observed are
// 0 / 1 / 143 only — there is no 2 and no 130, whatever the design inputs said.
//
// TWO TRAPS, both cost a reproduction to find:
//
//  1. NEVER key on `subtype`. An invalid-model run returned subtype "success"
//     with is_error true and an error message in `result` (R-7b). It is a label,
//     not a verdict.
//  2. NEVER key on `result === null` alone. It is null for max_turns, for
//     budget_exhausted AND for aborts — three different dispositions.
//
// THE DISCRIMINATOR is `api_error_status`: populated for an API-layer failure
// (404 carried 404), null for a limit we set ourselves (max_turns and
// budget_exhausted both carried null). That is exactly the agent() contract's
// infra-versus-task line, and it is the field this table turns on.
//
// Outcomes, in the vocabulary waves.js already speaks:
//   'ok'        -> return structured_output
//   'null'      -> return null  (agent()'s documented condition -> AGENT_NULL
//                  -> the barrier-retry park lane)
//   'retry'     -> the driver retries with tier escalation (runTaskInner's shape)
//   'fail-task' -> this task fails, recorded with its class; the wave proceeds
//   'fail-run'  -> credential/config: nothing downstream can succeed
// Transient at the API layer -> null -> AGENT_NULL -> the barrier-retry park
// lane. 500/502/504 join 429/503/529 because they are the same CLASS of
// failure — an upstream that may work in a minute — and the alternative is
// worse in a specific way: an unlisted status falls to `api-error` -> a throw
// -> waves.js's single same-tier retry -> a failed task, which spends a second
// dispatch and then gives up, instead of parking for the barrier.
export const INFRA_STATUSES = [429, 500, 502, 503, 504, 529]
export const CREDENTIAL_STATUSES = [401, 403, 404]

export function classify({ exitCode, envelope }) {
  // 143 = SIGTERM, and there is NO ENVELOPE AT ALL — stdout is empty (R-o7a).
  // Retryable once, then the task fails. Checked first precisely because there
  // is nothing else to read.
  if (exitCode === 143) {
    return { outcome: 'retry', class: 'sigterm', detail: 'SIGTERM: killed with no envelope (exit 143)' }
  }
  if (!envelope) {
    return { outcome: 'fail-task', class: 'no-envelope', detail: 'no result envelope on stdout (exit ' + exitCode + ')' }
  }
  const status = (envelope.api_error_status === undefined) ? null : envelope.api_error_status
  const reason = envelope.terminal_reason

  // SIGINT ends the turn and exits 0 with is_error true (R-o7b) — the documented
  // 130 does not hold. This is agent()'s FIRST null condition ("if you stop it
  // mid-run"), which is easy to forget: agent() nulls on abort as well as on API
  // error (item 7c).
  if (reason === 'aborted_streaming') {
    return { outcome: 'null', class: 'aborted', detail: 'aborted mid-run (SIGINT); agent() nulls on abort' }
  }

  if (status !== null) {
    if (INFRA_STATUSES.includes(status)) {
      // ASSUMPTION, stated because it is one: a real 529 has never been
      // triggered — it cannot be forced without external load. What IS observed
      // is the mechanism, that api_error_status carries the HTTP status of an
      // API-layer failure (404 did). Keying 429/503/529 here is a short
      // inference from a demonstrated field, not a guessed envelope.
      //
      // ASSUMPTION, second: whether `claude -p` inherits the SDK's documented
      // 2x-with-backoff retry policy is UNDOCUMENTED, and the envelope carries
      // no retry count — so a first-attempt 529 and a retries-exhausted 529 are
      // indistinguishable from here. We treat both as terminal and let the
      // engine's barrier retry be the only retry, which is safe in the
      // expensive direction (a duplicated wait) and not in the cheap one.
      return { outcome: 'null', class: 'infra', status,
        detail: 'API-layer failure ' + status + ' — terminal here; barrier retry owns it' }
    }
    if (CREDENTIAL_STATUSES.includes(status)) {
      // Nothing downstream can succeed, and every further worker would burn a
      // process to learn the same thing.
      return { outcome: 'fail-run', class: 'credential', status,
        detail: 'API refused with ' + status + ' (credential or config) — the run cannot proceed' }
    }
    return { outcome: 'fail-task', class: 'api-error', status,
      detail: 'unclassified API-layer failure ' + status }
  }

  // api_error_status === null from here down. Spec §6 reads that as "a limit we
  // set ourselves", i.e. a task outcome — and that is INCOMPLETE, found live
  // 2026-08-28 while probing this module (repro R-p1, below).
  //
  //   exit 1 · subtype "success" · is_error true · terminal_reason "api_error"
  //   · api_error_status NULL · result "Not logged in · Please run /login"
  //   · duration_api_ms 0 · num_turns 1 · total_cost_usd 0 · modelUsage {}
  //
  // Reproduce with: CLAUDE_CONFIG_DIR=<a fresh dir> claude -p hi ... on a
  // machine whose credential is not in the environment. §6's table would send
  // this down the is_error branch to 'fail-task', and then EVERY worker in the
  // wave would burn a process to learn the same thing — the exact failure mode
  // the credential row exists to prevent.
  //
  // The discriminator is really TWO-DIMENSIONAL, and this is the correction:
  // `terminal_reason` names the LAYER that failed, `api_error_status` names
  // whether the request ever reached the API. An api_error with no HTTP status
  // never reached it, so the client refused — a config problem no retry, no
  // barrier and no stronger model fixes.
  if (reason === 'api_error') {
    return { outcome: 'fail-run', class: 'credential', status: null,
      detail: 'the client refused before reaching the API (' +
        String(envelope.result || 'no detail').slice(0, 120) + ') — the run cannot proceed' }
  }
  if (reason === 'max_turns') {
    // No conforming StructuredOutput reply inside the turn cap. Note the harness
    // retries in-loop first, nudging a text-only turn once
    // ([structured-output-enforce], R-o2/R-o2d) — so reaching here means the
    // in-loop nudge already failed. Escalating the tier is the driver's lever.
    //
    // The wording is load-bearing, not decoration: waves.js:879 routes a retry
    // to TIER ESCALATION only when the thrown message matches its isSchemaTrip
    // regex (/schema|structuredoutput|…/i), and to a retry-in-place otherwise.
    // A capability trip wants the stronger model. Naming StructuredOutput here
    // is both accurate — it IS the tool that never produced a conforming reply
    // — and the way this speaks the vocabulary waves.js already reads, rather
    // than adding a second classifier beside the one that exists.
    return { outcome: 'retry', class: 'max-turns',
      detail: 'no conforming StructuredOutput reply within the turn cap (schema contract unmet)' }
  }
  if (reason === 'budget_exhausted') {
    return { outcome: 'fail-task', class: 'budget', detail: 'per-worker --max-budget-usd backstop tripped' }
  }
  if (envelope.is_error) {
    return { outcome: 'fail-task', class: 'error',
      detail: 'worker reported is_error with terminal_reason "' + String(reason) + '"' }
  }
  if (envelope.structured_output === null || envelope.structured_output === undefined) {
    // Exit 0, no error, and still no typed reply. Retry with escalation rather
    // than hand waves.js an undefined it would dereference.
    // Same escalation vocabulary as max-turns above.
    return { outcome: 'retry', class: 'no-structured-output',
      detail: 'completed without a StructuredOutput reply (schema contract unmet)' }
  }
  return { outcome: 'ok', class: 'success' }
}

// ── spend ────────────────────────────────────────────────────────────────────
// Sum modelUsage, NEVER `usage` — `usage` reports the last call only, while
// modelUsage covers the whole worker INCLUDING any subagent it spawned (R-o8
// matched the subagent transcript exactly, which retires #209 by construction).
// total_cost_usd is a client-side estimate and is carried, not trusted.
export function meterOf(envelope) {
  const per = (envelope && envelope.modelUsage) || {}
  let input = 0, output = 0, cacheRead = 0, cacheCreation = 0
  for (const m of Object.values(per)) {
    input += m.inputTokens || 0
    output += m.outputTokens || 0
    cacheRead += m.cacheReadInputTokens || 0
    cacheCreation += m.cacheCreationInputTokens || 0
  }
  return { input, output, cacheRead, cacheCreation,
    costUsd: (envelope && envelope.total_cost_usd) || 0,
    models: Object.keys(per) }
}

// ── the dispatcher ───────────────────────────────────────────────────────────
// createRunWorker(cfg) -> agent(prompt, opts), the function waves.js is already
// parameterised over.
//
// cfg:
//   runId          run identity; seeds the deterministic session uuids
//   workersDir     <run>/workers — one dir per label: cmd, envelope.json, stdout
//   cwdFor(opts)   label + isolation -> the directory this worker runs in. For
//                  the two isolation:'worktree' sites this MUST be a clone cut
//                  AT BASE; that is the whole of the #314 cure.
//   promptFileFor  optional (role -> a roles/*.md path for
//                  --append-system-prompt-file)
//   settingsFor    optional (role -> a --settings path carrying the PreToolUse
//                  hook that confines the implementer's writable root)
//   env            the worker env (CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN)
//   cli            the claude binary (default 'claude')
//   timeoutMs      per-worker wall clock; on expiry SIGTERM -> exit 143 -> one
//                  retry, matching the observed signal semantics
//   onEvent        optional observation sink (store rows, receipts)
//
// Returns the parsed structured reply, or null. It does not throw for a worker
// outcome — only for a programming error (an undeclared label, a missing cwd),
// which must fail loudly rather than degrade into a null the engine would read
// as an overload.
// #476 — ONE PLACE TO LOOK. `confine-denials.jsonl` is written from inside the
// confine hook's own deny path, so it records exactly one thing: denials THAT
// HOOK issued. The hook is attached only to the write-capable roles, so the
// file structurally cannot see a reviewer or critic denial — which is precisely
// the population whose denials were parking runs. Measured across runs 26-32 it
// carried 0/3/2/1/3 against the envelopes' 3/11/11/11/20.
//
// The envelope is the honest record and the driver already has it in hand here.
// Folding it into the SAME file (with a `source` discriminator, and the hook's
// own lines now tagged too) keeps one obvious place to look, which is what the
// ticket asked for — two records, one an undisclosed subset of the other, is
// how a sensor lies for five runs running.
//
// Derived from `workersDir`, never from FLEET_RUN_DIR: that variable is set for
// the confined roles only, and the roles this exists to see are the ones
// without it. Best-effort, like the hook's own write — a denial ledger must
// never be able to fail a worker.
export function recordEnvelopeDenials({ workersDir, label, role, envelope }) {
  const denials = envelope && envelope.permission_denials
  if (!workersDir || !Array.isArray(denials) || denials.length === 0) return 0
  try {
    // Store a SUMMARY, not the record. A denied Write carries its `content` and
    // a denied Bash its whole command in `tool_input`, and the harvester reads
    // this file verbatim into bundle.json with no size budget — a few large
    // denied writes would bloat the bundle that feeds every lens.
    const cap = (v) => (v === undefined || v === null ? null : String(
      typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 200))
    const line = (d) => JSON.stringify({
      ts: Date.now(), source: 'envelope', label: label || null, role: role || null,
      tool: (d && (d.tool_name || d.tool)) || null,
      reason: cap(d && (d.reason || d.message)) || cap(d),
      toolInput: d && d.tool_input ? cap(d.tool_input) : null,
    })
    fs.appendFileSync(path.join(path.dirname(workersDir), 'confine-denials.jsonl'),
      denials.map(line).join('\n') + '\n')
    return denials.length
  } catch { return 0 }
}

export function createRunWorker(cfg) {
  const {
    runId, workersDir, cwdFor, promptFileFor, settingsFor, addDirsFor,
    env = process.env, cli = 'claude', timeoutMs = 30 * 60 * 1000, graceMs = 10 * 1000,
    // Per-role wall-clock deadlines (role -> ms). A read-only reviewer that is
    // still running at the implementer's deadline is not "thorough", it is
    // wedged — and one shared deadline sized for the slowest role hides that
    // for every faster one. Falls back to `timeoutMs` for roles it omits.
    timeoutMsFor,
    maxTurns, maxBudgetUsd, effortFor, onEvent = () => {}, spawnFn = spawn,
  } = cfg

  // Latched by the first fail-run verdict; see the 'fail-run' case below for why
  // a throw alone cannot stop the run.
  let runFatal = null
  // Labels whose per-worker budget backstop already tripped. waves.js will
  // retry them; there is nothing to learn from spending the backstop twice.
  const budgetTripped = new Set()

  return async function agent(prompt, opts = {}) {
    // Refuse BEFORE spawning. This is the whole of the credential row's value:
    // one worker pays to discover the dead credential, and no other worker pays
    // anything at all. Without it the wave spends 2N processes learning it.
    if (runFatal) {
      onEvent({ kind: 'worker:refused', label: opts.label, why: 'run-fatal', detail: runFatal.detail })
      throw new Error('RUN_FATAL: refusing to dispatch ' + opts.label +
        ' — the run already failed at ' + runFatal.label + ': ' + runFatal.detail)
    }
    if (budgetTripped.has(opts.label)) {
      onEvent({ kind: 'worker:refused', label: opts.label, why: 'budget-already-tripped' })
      throw new Error('WORKER_BUDGET: ' + opts.label +
        ' already exhausted its per-worker budget; refusing to spend the backstop again')
    }
    const role = roleForLabel(opts.label)
    const sessionId = sessionIdFor(runId, opts.label)
    const cwd = cwdFor(opts)
    if (!cwd) {
      throw new Error('runWorker: no cwd resolved for label "' + opts.label + '" — ' +
        'refusing to run a worker in an unknown directory')
    }
    const argv = buildArgs({
      opts, role, sessionId,
      promptFile: promptFileFor ? promptFileFor(role) : undefined,
      settings: settingsFor ? settingsFor(role) : undefined,
      addDirs: addDirsFor ? addDirsFor(opts, role) : [],
      maxTurns, maxBudgetUsd,
      effort: effortFor ? effortFor(role) : undefined,
    })

    // One directory per DISPATCH, not per label. A retry reuses the label
    // (waves.js's single retry keeps `impl:<id>`), and the first attempt's
    // envelope is the interesting one — overwriting it would delete the failure
    // and keep only the recovery. The run directory is the evidence bundle
    // (spec §5); an evidence bundle that discards the failures is not one.
    const dir = workersDir ? nextWorkerDir(workersDir, opts.label) : null
    if (dir) {
      fs.mkdirSync(dir, { recursive: true })
      // The run directory IS the evidence bundle (spec §5), so the exact argv is
      // written before the process starts — a worker that dies at 143 leaves no
      // envelope, and without this there would be nothing to read at all.
      fs.writeFileSync(path.join(dir, 'cmd'), [cli, '-p', '<prompt>'].concat(argv).join(' ') + '\n\n--- prompt ---\n' + prompt)
    }

    onEvent({ kind: 'worker:start', label: opts.label, role, sessionId, cwd, model: opts.model || null })

    const { exitCode, stdout, stderr, timedOut } = await runProcess({
      cli, argv, cwd, env, prompt,
      timeoutMs: (timeoutMsFor && timeoutMsFor(role)) || timeoutMs,
      graceMs, spawnFn,
    })
    const envelope = lastResult(stdout)
    if (dir) {
      fs.writeFileSync(path.join(dir, 'stdout'), String(stdout || ''))
      if (stderr) fs.writeFileSync(path.join(dir, 'stderr'), String(stderr))
      if (envelope) fs.writeFileSync(path.join(dir, 'envelope.json'), JSON.stringify(envelope, null, 2))
    }
    recordEnvelopeDenials({ workersDir, label: opts.label, role, envelope })
    const verdict = classify({ exitCode, envelope })
    onEvent({ kind: 'worker:end', label: opts.label, role, sessionId, exitCode, timedOut,
      outcome: verdict.outcome, class: verdict.class, status: verdict.status || null,
      meter: envelope ? meterOf(envelope) : null })

    switch (verdict.outcome) {
      case 'ok':
        return envelope.structured_output
      case 'null':
        // agent()'s documented condition. waves.js turns this into AGENT_NULL.
        return null
      case 'fail-run': {
        // The one outcome that is not a worker result: a credential or config
        // failure poisons every later worker.
        //
        // A THROW DOES NOT ACHIEVE THIS, and shipping one that looked like it
        // did was the defect. `waves.js:1014` catches EVERY throw out of
        // agent() by design — "a thrown agent() call must cost ONE task, never
        // the run" — and its classifiers only recognise two things: a message
        // starting `AGENT_NULL` (isInfraFault) and a schema-shaped message
        // (isSchemaTrip). `RUN_FATAL: …` matches neither, so it became a
        // same-tier retry and then a failed task: TWO dispatches per task, each
        // learning the same dead credential. Exactly the burn the credential
        // row exists to prevent, doubled.
        //
        // waves.js cannot be taught a third class without editing it, and this
        // stage does not edit it (port, don't rewrite). So the driver enforces
        // the run-level stop ON ITS OWN SIDE: the first fail-run latches, and
        // every subsequent dispatch refuses BEFORE spawning a process. The
        // engine still sees ordinary task failures and writes an honest report;
        // what it does not do is pay for them.
        runFatal = runFatal || { detail: verdict.detail, label: opts.label, status: verdict.status ?? null }
        onEvent({ kind: 'run:fatal', label: opts.label, detail: verdict.detail, status: verdict.status ?? null })
        throw new Error('RUN_FATAL: ' + verdict.detail + ' (label ' + opts.label + ')')
      }
      default:
        // 'retry' and 'fail-task' both leave by a throw, and waves.js retries
        // ANY non-AGENT_NULL throw exactly once — so the two outcomes differ
        // only in the message, via isSchemaTrip (schema-shaped -> escalate a
        // tier; anything else -> retry in place). That is the engine's ladder
        // and this stage does not rewrite it.
        //
        // The one place that costs real money is `budget`: the per-worker
        // --max-budget-usd backstop has already tripped, and waves.js's retry
        // spends it a SECOND time for the same task. So that one class latches
        // per label and refuses its own retry before spawning. Every other
        // class is genuinely worth one more attempt.
        if (verdict.class === 'budget') budgetTripped.add(opts.label)
        throw Object.assign(new Error('WORKER_' + verdict.class.toUpperCase().replace(/-/g, '_') + ': ' + verdict.detail),
          { workerVerdict: verdict, label: opts.label })
    }
  }
}

// One `claude -p` process.
//
// stdin is CLOSED, not inherited: both resume repros printed
// `Warning: no stdin data received in 3s, proceeding without it` and paid three
// seconds for it (parity item 10). The prompt goes on argv, not stdin — as the
// value of `-p`, never as a trailing positional (see buildArgs).
function runProcess({ cli, argv, cwd, env, prompt, timeoutMs, graceMs = 10 * 1000, spawnFn }) {
  return new Promise((resolve) => {
    const child = spawnFn(cli, ['-p', prompt].concat(argv), {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', timedOut = false, settled = false
    // setEncoding, NOT `stdout += buffer`. Concatenating Buffers decodes each
    // chunk independently, so a multi-byte character straddling a chunk
    // boundary becomes U+FFFD on both sides — and the result is still VALID
    // JSON, so `lastResult` parses it happily and the corruption is silent,
    // inside `structured_output`. This codebase's prose is full of em-dashes;
    // a reviewer verdict is exactly the kind of value that would be mangled.
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    let killTimer = null
    const timer = setTimeout(() => {
      timedOut = true
      // SIGTERM, which the CLI answers with exit 143 and no envelope (R-o7a):
      // the timeout path and the kill path are deliberately the same class, so
      // there is one retryable-once branch rather than two.
      child.kill('SIGTERM')
      // And SIGKILL if it does not go. `timeoutMs` is a promise of a wall-clock
      // deadline; without this it is only a promise to ASK. R-o7a's teardown
      // was clean, so this should never fire — which is exactly the reason to
      // have it, since a worker that ignores SIGTERM would otherwise hang the
      // wave forever and the deadline would be silently unenforced.
      killTimer = setTimeout(() => child.kill('SIGKILL'), graceMs)
    }, timeoutMs)
    const done = (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode, stdout, stderr, timedOut })
    }
    child.on('error', (e) => { stderr += String(e && e.message || e); done(127) })
    // A SIGTERM the child answered itself arrives as code 143; one it did not
    // arrives as signal SIGTERM; a SIGKILL arrives as signal SIGKILL. All three
    // are the same class — killed, no envelope, retryable once.
    child.on('close', (code, signal) =>
      done((signal === 'SIGTERM' || signal === 'SIGKILL') ? 143 : (code === null ? 1 : code)))
  })
}

// `<label>`, then `<label>.2`, `<label>.3` … so a retried dispatch keeps the
// earlier attempt's cmd, stdout and envelope beside it.
function nextWorkerDir(workersDir, label) {
  const base = path.join(workersDir, String(label).replace(/[^A-Za-z0-9._-]/g, '_'))
  if (!fs.existsSync(base)) return base
  for (let n = 2; ; n++) {
    const d = base + '.' + n
    if (!fs.existsSync(d)) return d
  }
}
