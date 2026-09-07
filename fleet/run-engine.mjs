// fleet/run-engine.mjs — the wave control flow as driver code (#366 Amendment 10).
//
// This module replaces loading `skills/ultrapowers/harnesses/waves.js` on the
// fleet path. The rule it implements: MODELS NEVER RUN GIT; DRIVERS NEVER MAKE
// JUDGMENTS. Every git verb, kernel-CLI invocation, path and sequence here is
// ordinary code run through the injected `exec`; a model is dispatched only to
// make a judgment — implement, review, fix, resolve, reconcile, attest — with
// the driver handing content in and capturing content out.
//
// waves.js was deleted at 0.3.0 (PR #434) once runs 26/27 passed the bar;
// the judgment-flow semantics here (single retry with tier escalation on a
// schema trip, the infra-death barrier retry, the fix-loop cap of 2, the
// fail-closed lost-coordinates sweep, dependency cascade-blocking) are ported
// from it verbatim in behavior. The choreography it dispatched agents for —
// setup, fold/resolve-apply/materialize, adoption, the critic's detach — is
// driver code below. The ordinary git-merge path is DELETED, not ported: under
// patch input waves.js itself routed every wave to the kernel unconditionally
// (waves.js:1851), so the path was unreachable — a disclosed narrowing of
// Amendment 10, licensed by Amendment 9 (fold is the only merge path).
//
// The report object returned matches references/report-format.md field for
// field: the frozen periphery (finalize_report.py, ultra_gate.py) runs
// unchanged against it. Producers that moved from agents to the driver are
// noted at the assembly at the bottom.
//
// ULTRA_BASE (#632 part 2): a Proof `Run:` and a Global Constraints `Check:`
// are the only shell commands here that get an extra environment variable.
// Each runs with ULTRA_BASE set to the base its tree was cut at — the task's
// own BASE in the per-task and review-round passes (wave 1's run base, a later
// wave's adopted head after the re-anchor), and the RUN base in the integrated
// pass, never the adopted head a diff against would be a tautology. That is
// what makes `- Check: git diff --quiet $ULTRA_BASE -- fleet/` writable: the
// command cannot name a sha it has no way to know. The suite, the bootstrap
// and the exam runs keep the seam's default environment.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// The run's event log lives in run-waves.mjs; the engine borrows its ULID
// stamp so the driver's own records sort with the worker envelopes rather
// than beside them (readers order by id, never by line — run-waves.mjs).
// `cloneAtBase` and `patchAgainstBase` come from there too: the examiner's
// clone is cut at dispatch time (only the engine knows which tasks have an
// exam), and the implementer's capture is retaken after the handoff.
import { ulid, cloneAtBase, patchAgainstBase } from './run-waves.mjs'

// ── model tiers (waves.js parity) ────────────────────────────────────────────
export const TIER = { standard: 'sonnet', mostCapable: 'opus' }
export const REVIEWER_MODEL = TIER.mostCapable
const tierKey = (t) => (t === 'most-capable' ? 'mostCapable' : t)
const TIER_LADDER = ['standard', 'mostCapable']
export const escalateTier = (t) => {
  const i = TIER_LADDER.indexOf(tierKey(t))
  if (i === -1) return 'mostCapable'
  return TIER_LADDER[Math.min(i + 1, TIER_LADDER.length - 1)]
}
const resolvedModel = (name) => {
  const v = Object.prototype.hasOwnProperty.call(TIER, tierKey(name)) ? TIER[tierKey(name)] : undefined
  return (typeof v === 'string') ? v : TIER.standard
}

// ── fault classifiers — THE ONE SHARED DEFINITION (spec §3.4) ────────────────
// run-worker.mjs's classify() speaks this vocabulary in its thrown messages;
// fleet/tests/test_run_worker.mjs pins classify's wording against THIS regex
// (it used to extract it from waves.js source — the pin now holds the engine
// that actually runs, not the fallback). A capability-fixable schema trip gets
// the one tier escalation; everything else retries in place; AGENT_NULL is the
// engine-minted infra marker and parks for the barrier retry — never free-text
// match Overloaded (agent() returns null rather than throwing overload text).
export const isSchemaTrip = (msg) =>
  /schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i.test(msg)
export const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
export const isInfraFault = (msg) => String(msg).startsWith('AGENT_NULL')

// Same chunking constant as waves.js: intra-wave dependency re-checks and the
// lost-coordinates sweep run at chunk boundaries, so the value is part of the
// ported semantics (the actual process-level width bound is the caller's
// `parallel`, run-main's boundedParallel(WIDTH)).
export const CONCURRENCY = 16

// ── judgment schemas ─────────────────────────────────────────────────────────
// IMPLEMENTER: branch/headSha are gone from the model's contract — the driver
// derives both (withPatchCapture). startHead is KEPT one more run: the #314
// guard's deletion waits for the measured license its own comment demands
// (run-waves.mjs:107-112), not this rewrite.
export const IMPLEMENTER_SCHEMA = {
  type: 'object',
  required: ['status', 'summary', 'startHead'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    startHead: { type: 'string' },
  },
}
// EXAMINER (#553): the wave-0 worker that writes the task's Proof tests in the
// task's own clone at BASE, before the implementer sees the tree. Its status
// vocabulary is two-valued on purpose — an exam either exists or the Proof
// could not be written as given, and the reason belongs in `unsatisfiable`,
// per leg, where a judgment call can carry it. There is no DONE_WITH_CONCERNS:
// a concern about a leg IS an unsatisfiable entry.
export const EXAMINER_SCHEMA = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { enum: ['DONE', 'BLOCKED'] },
    summary: { type: 'string' },
    unsatisfiable: { type: 'array', items: { type: 'object',
      required: ['leg', 'why'], properties: {
        leg: { type: 'string' }, why: { type: 'string' } } } },
  },
}
// The fix round's introduction to a referee's patch (#551). Shared literal
// with fleet/roles/reviewer.md and fleet/roles/fix.md.
export const PROPOSED_PATCH_HEADER =
  'PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):'
// One severity vocabulary for the whole run (#474): the per-task reviewer and
// the completeness critic grade defects on the same two-word scale, and the
// pair is spelled here exactly once. Both schemas point at THIS array.
export const SEVERITY = Object.freeze(['blocking', 'minor'])
export const REVIEWER_SCHEMA = {
  type: 'object',
  required: ['verdict', 'issues'],
  properties: {
    verdict: { enum: ['PASS', 'FIX_REQUIRED'] },
    issues: { type: 'array', items: { type: 'object',
      required: ['severity', 'detail', 'actor'], properties: {
        severity: { enum: SEVERITY },
        detail: { type: 'string' },
        // WHO can act on this. A defect in the patch is the implementer's and
        // drives the fix round; a defect in the PLAN — a machine clause that
        // cannot hold, an interface the task was never given — is nobody the
        // fix round can reach, and looping an implementer against it burns two
        // rounds to arrive where it started. A plan-actor issue merges the
        // task as reviewed and hands the defect to the gate as a deferral,
        // which is the one reader with the standing to change the plan.
        actor: { enum: ['implementer', 'plan'] },
        // A referee's output is help (#551): when the reviewer can write the
        // fix, it comes back here as a unified diff and the fix round is
        // handed it under the issue it belongs to. Optional by construction —
        // an issue still needs nothing but a severity, a detail and an actor.
        proposedPatch: { type: 'string' } } } },
  },
}
// RESOLVER: content OUT through the schema — the driver writes the kernel's
// reply directory itself (h<n>.txt per hunk + notes.txt, the grammar
// unchanged), so the resolver role is READ-ONLY and the write-side role family
// shrinks to the reconcile agent alone (spec §2). An outsized hunk that
// strains a structured reply surfaces as a failed resolution (the kernel's
// grammar check rejects a short reply), never a silent truncation.
export const RESOLVER_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['RESOLVED', 'BLOCKED'] },
    // `id` is the hunk header's own id verbatim ("h1", "h2", …) — the reply
    // file the driver writes is `<id>.txt`, exactly the grammar's name.
    hunks: { type: 'array', items: { type: 'object',
      required: ['id', 'content'], properties: {
        id: { type: 'string' }, content: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}
export const RECONCILE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['FIXED', 'BLOCKED'] },
    summary: { type: 'string' },
  },
}
// CRITIC: read-only judgment. testsPassed / onIntegrationHead / ancestryMisses
// are gone from the model's contract — the driver runs the suite and derives
// gitVerified and the ancestry check from its own receipts (spec §3.1).
export const CRITIC_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: { type: 'object',
      required: ['severity', 'detail'], properties: {
        severity: { enum: SEVERITY },
        detail: { type: 'string' } } } },
    deferredVerification: { type: 'array', items: { type: 'object',
      required: ['deliverable', 'reason'], properties: {
        deliverable: { type: 'string' },
        reason: { type: 'string', enum: ['browser', 'runtime', 'external', 'manual'] },
        why: { type: 'string' } } } },
  },
}

// ── role prompt files (spec §4: one copy, nothing to bake) ───────────────────
export const defaultRolesDir = () => fileURLToPath(new URL('./roles', import.meta.url))
export function loadRoles(rolesDir = defaultRolesDir()) {
  const roles = {}
  // Seven, all hard: no wave can be dispatched without them. The examiner
  // (#553) was soft-gated on its file's presence until 2026-09-02 — a toggle
  // the committed suite made unreachable (#567), and one more branch per task.
  for (const name of ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic', 'examiner']) {
    roles[name] = fs.readFileSync(path.join(rolesDir, name + '.md'), 'utf8')
  }
  return roles
}

// ── prompt input lines (waves.js parity — same vocabulary, plans unchanged) ──
//
// capWorkerParallelism (#436): the driver's own suite runs are serialized —
// one integration clone, one at a time — so `-n auto` is right for them. The
// implementers are not: up to WIDTH of them run concurrently, each in its own
// clone, each running the suite through its red/green/clean cycle. `-n auto`
// sizes to the whole machine per invocation, so WIDTH=8 on an 8-vCPU sandbox
// peaks around 64 pytest processes plus the workers themselves — thrash, or
// an OOM-killed xdist worker reported as a spurious red. Divide the machine
// among the workers that share it instead. Untouched when the plan pinned an
// explicit -n, and a no-op for every non-pytest stack.
export const capWorkerParallelism = (cmd, width, cpus) => {
  if (typeof cmd !== 'string' || !/-n\s+auto\b/.test(cmd)) return cmd
  const share = Math.max(1, Math.floor((cpus || 1) / Math.max(1, width)))
  return cmd.replace(/-n\s+auto\b/, share === 1 ? '-p no:xdist' : '-n ' + share)
}

const testCmdLine = (task, testCmd) => {
  const cmd = (task && typeof task.testCmd === 'string' && task.testCmd.trim()) || testCmd
  return cmd ? ('\nTEST COMMAND: ' + cmd) : ''
}
// #663 — whose command is whose. A Proof `Test:` path is written by a PEER, in
// the peer's own clone, and reaches the graded tree only at the driver's
// handoff after the implementer has returned (#653, #551). So a task whose
// `testCmd` names one of those paths hands its implementer a command that
// cannot run in the implementer's tree: the file is not there yet, and the
// worker's red/green/clean cycle is spent on a command that is red for a reason
// it cannot fix. The exam's command stays the examiner's, the driver's
// pre-review pass's and the reviewer's — every place that runs it does so on a
// tree that HAS the exam. The implementer is handed the run-wide suite, which
// is exactly what a task with no `testCmd` receives.
//
// The predicate is the plain one the compiler's shapes make honest: every
// spelling `derive_task_test_cmd` emits (`node <path>`, `python3 -m pytest -q
// <paths>`, `bun test <paths>`, an `**Exam command:**` template with `{paths}`
// substituted) contains the Proof path verbatim. A `testCmd` set some other
// way, or a task whose Proof names no `Test:` path at all, names none of them
// and keeps its own command.
const namesProofTest = (task) => {
  const cmd = task && typeof task.testCmd === 'string' && task.testCmd.trim()
  if (!cmd) return false
  const paths = (task && Array.isArray(task.proofTests)) ? task.proofTests : []
  return paths.some((p) => typeof p === 'string' && p.trim() !== '' && cmd.includes(p.trim()))
}
// The implementer's TEST COMMAND line: its own command, unless that command is
// the peer's exam — then the run-wide one, capped for the sharers below.
const implTestCmdLine = (task, testCmd) =>
  testCmdLine(namesProofTest(task) ? null : task, testCmd)
// The tasks whose implementer actually RUNS the run-wide command: those with no
// command of their own, and those whose own command is the exam they will not
// hold (#547 — divide the machine by the workers that share it, not by WIDTH).
const sharesRunWideCmd = (task) =>
  !(task && typeof task.testCmd === 'string' && task.testCmd.trim()) || namesProofTest(task)
const filesLine = (task) => (Array.isArray(task.files) && task.files.length)
  ? ('\nFILES: ' + task.files.join(', ')) : ''
const interfacesLine = (task) => {
  const i = task && task.interfaces
  if (!i || typeof i !== 'object') return ''
  const consumes = Array.isArray(i.consumes) ? i.consumes : []
  const produces = Array.isArray(i.produces) ? i.produces : []
  if (consumes.length === 0 && produces.length === 0) return ''
  return '\nINTERFACES:' +
    (consumes.length ? ('\nConsumes: ' + consumes.join(', ')) : '') +
    (produces.length ? ('\nProduces: ' + produces.join(', ')) : '')
}
// Review depth (#556): `peer` is the documented value for the two-reviewer
// profile — it names the shape (a second independent read of the same patch),
// not an attitude toward the author. `adversarial` is the legacy spelling of
// the same profile and stays accepted; anything else is lean.
export const isPairReview = (profile) => profile === 'peer' || profile === 'adversarial'
// Round-1 minor findings, rendered for the round-2 reviewers (see the review
// loop). Exported for the unit pin, as suiteLine is.
// #589 — `Run:` proofs. A Proof slot may name a COMMAND instead of a test path,
// and the driver runs it: models never run git, and they never run the proof
// either. What the reviewer gets is not a claim that the command passed but the
// bytes it printed, so the referee reads the same evidence the driver recorded.
// Empty runs render nothing at all — a task without `Run:` keeps the prompt it
// had before this existed, byte for byte.
export const runEvidenceBlock = (runs) => {
  if (!Array.isArray(runs) || runs.length === 0) return ''
  return '\n\nRUN EVIDENCE: the driver executed each of the Proof\'s `Run:` commands ' +
    'itself, in this task\'s own clone, on the tree the patch above describes — ' +
    'stdout and stderr combined, last 4,000 characters.' +
    runs.map((r) => '\n\n$ ' + r.cmd + '\nexit ' + r.exit + '\n' + r.stdout).join('')
}
// #638 — the task's own exam, executed by the driver. A Proof that names
// `Test:` paths buys an examiner in wave 0, and until now nobody ever RAN what
// that examiner wrote on the implementer's tree: a verdict could be settled by
// reading the tests instead of running them. This block is the other half — the
// bytes of the driver's own execution, so the referee reads a result rather
// than a claim. One exam per task, so the input is one record or null; null
// renders nothing at all (the run-51 rule), which is what keeps the prompt of a
// task with no exam byte-identical to the one it had before this existed.
export const examEvidenceBlock = (exam) => {
  if (!exam || typeof exam !== 'object') return ''
  return '\n\nEXAM EVIDENCE: the driver executed this task\'s exam command itself, ' +
    'in this task\'s own clone, on the tree the patch above describes — stdout and ' +
    'stderr combined, last 4,000 characters.' +
    '\n\n$ ' + exam.cmd + '\nexit ' + exam.exit + '\n' + exam.stdout
}
// #604 (b)+(c) — the INTEGRATED `Run:` proofs. The per-task execution above
// answers "does this command pass on the patch its author wrote"; it cannot
// answer "does it still pass on the tree the wave actually adopted", and the
// difference is the whole reason a wave is folded rather than trusted. So the
// driver runs every merged task's commands a second time in the integration
// clone and hands the critic the bytes — the same move #458 made for the
// driver-run suite. Naming it authoritative is what closes the cannot-verify
// item that would otherwise ask for exactly this re-execution.
// Empty evidence renders nothing at all (the run-51 rule), so a run with no
// `Run:` proofs keeps the critic prompt it had before this existed, byte for
// byte. Exported for the unit pin, as suiteLine and runEvidenceBlock are.
export const integratedRunEvidenceBlock = (runs) => {
  if (!Array.isArray(runs) || runs.length === 0) return ''
  return '\n\nINTEGRATED RUN EVIDENCE: the driver executed each merged task\'s Proof ' +
    '`Run:` commands itself, on the adopted integration tree — this is the authoritative ' +
    'result; a cannot-verify item asking for their re-execution is settled by it.' +
    runs.map((r) => '\n\n$ ' + r.cmd + '\nexit ' + r.exit + '\n' + r.stdout).join('')
}
// The Global Constraints `Check:` commands, rendered for the per-task referee.
// A constraint the run declares once for every task is exactly the thing no
// single implementer is watching, so the driver runs it in each task's own
// clone and hands the referee the bytes — the `Run:` move (#589), widened from
// the task's own Proof to the run's standing constraints. A `minor` check is
// carried here for attention and blocks nothing, which is why the exit line
// says so: the referee must not spend a blocking finding on it.
// Empty checks render nothing at all (the run-51 rule), so a run without them
// keeps the reviewer prompt it had before this existed, byte for byte.
export const checkEvidenceBlock = (checks) => {
  if (!Array.isArray(checks) || checks.length === 0) return ''
  return '\n\nCHECK EVIDENCE: the driver executed each Global Constraints `Check:` command ' +
    'itself, in this task\'s own clone, on the tree the patch above describes — stdout and stderr ' +
    'combined, last 4,000 characters. A blocking check that exited non-zero is already the ' +
    'fix loop\'s; a check marked (minor) is recorded here for the referee\'s attention and ' +
    'blocks nothing.' +
    checks.map((c) => '\n\n$ ' + c.cmd + '\nexit ' + c.exit + (c.minor ? ' (minor)' : '') +
      '\n' + c.stdout).join('')
}
// The same commands on the tree the wave ADOPTED. A constraint can be green in
// every clone and red on the fold — that is the whole reason a wave is folded
// rather than trusted — and only the driver can tell the critic which it was.
export const integratedCheckEvidenceBlock = (checks) => {
  if (!Array.isArray(checks) || checks.length === 0) return ''
  return '\n\nINTEGRATED CHECK EVIDENCE: the driver executed each Global Constraints `Check:` command ' +
    'itself, on the adopted integration tree — this is the authoritative result.' +
    checks.map((c) => '\n\n$ ' + c.cmd + '\nexit ' + c.exit + (c.minor ? ' (minor)' : '') +
      '\n' + c.stdout).join('')
}
export const priorAdvisoriesBlock = (minors) => {
  if (!Array.isArray(minors) || minors.length === 0) return ''
  return '\nPRIOR-ROUND ADVISORIES (minor findings from the previous review round, already ' +
    'recorded in the run report — do not re-report them; raise one again only if the fix ' +
    'round made it blocking):\n' + minors.map((m) => '- ' + m.detail).join('\n')
}
// #458: the driver runs the suite on the folded tree and the critic was never
// told. A read-only critic cannot run it — running a PROGRAM is not classified
// read-only, measured 2026-08-31 (#457) — so it establishes pass/fail by static
// trace and then defers it as `deferred:runtime`. That deferral is manufactured:
// the answer already exists in `lastSuite`. Naming the driver's run authoritative
// is what the contend cell's critic explicitly asked for. Exported for the unit
// pin on the red branch (as capWorkerParallelism is) — the engine only ever
// adopts a green tree, so no live run reaches it.
// Composition pinning, as a pure function (exported for the unit pin).
// Per-task exclusion, never a wave-wide skip (review finding 10): one task
// missing `writes` must not silence a genuine undeclared double-write between
// two tasks that DID declare theirs.
// Claims-v1 retirement (#390): `Commutes:` is no longer authorable, so when no
// task in the wave declares one, an undeclared shared write is not a pinning
// failure — it is the shipped fold default. The check only means something
// while the declaration it audits can exist.
export const compositionUnpinnedRows = (waveNumber, tasks) => {
  const rows = []
  if (!tasks.some((t) => Array.isArray(t.commutes) && t.commutes.length)) return rows
  const declaring = tasks.filter((t) => Array.isArray(t.writes))
  for (const t of tasks) {
    if (!Array.isArray(t.writes)) {
      rows.push('wave ' + waveNumber + ': task ' + t.id +
        ' carries no writes field — excluded from composition rows')
    }
  }
  if (declaring.length < 2) return rows
  const writers = new Map()
  for (const t of declaring) for (const p of t.writes) writers.set(p, (writers.get(p) || []).concat(t.id))
  for (const [p, ids] of writers) {
    if (ids.length < 2) continue
    const undeclared = ids.filter((id) => {
      const t = tasks.find((x) => x.id === id)
      return !((t && t.commutes) || []).includes(p)
    })
    if (undeclared.length) {
      rows.push('composition-unpinned: wave ' + waveNumber + ' ' + p +
        ' — writers ' + ids.join(',') + '; undeclared: ' + undeclared.join(','))
    }
  }
  return rows
}

export const suiteLine = (suite, cmd) => {
  if (!suite) return ''
  return '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: ' + (cmd || '(unknown)') +
    '\npassed: ' + Boolean(suite.passed) +
    (suite.passed === false ? '\noutput: ' + tail(suite.output, 500) : '')
}
const siblingLine = (task, wave) => {
  const sibs = wave
    .filter((t) => t.id !== task.id && Array.isArray(t.files) && t.files.length)
    .map((t) => t.id + ': ' + t.files.join(', '))
  return sibs.length ? ('\nSIBLING FILES: ' + sibs.join(' | ')) : ''
}
const taskBodyBlock = (task, wavesPath) => {
  const inlineBody = (typeof task.body === 'string' && task.body.trim() !== '')
  if (inlineBody) return '\nTASK:\n' + task.body
  if (wavesPath) {
    return '\nTASK: read your verbatim task text from the JSON file at ' + wavesPath +
      ' — in its "tasks" array, find the object whose "id" is "' + task.id +
      '" and use that object\'s "body" field as the authoritative task text. Do ' +
      'not paraphrase it; that entry also lists your declared file scope.'
  }
  return '\nTASK:\n' + (typeof task.body === 'string' ? task.body : '')
}
// The critic's contracts block (2026-09-01). Until now the completeness critic
// was handed task ids and titles and a pointer to the plan, while the per-task
// reviewers each got a full six-slot body — the one agent that reads the
// integrated tree got the least of the contract. Post-Manyana the fold settles
// the MERGE question (two edits to one file combine); it cannot see the
// COMPOSITION question (Produces on one task and Consumes on another agreeing
// in name, type and behaviour; two tasks carrying one Context literal; every
// Proof leg having a test). Those are per-slot checks, so the critic gets every
// signed body — inline when the task carries it, else the wavesPath pointer the
// implementer and reviewer already follow — plus the compiler-derived edges,
// which name the pairs to verify. Exported for the unit pin, as suiteLine is.
export const contractsBlock = (waves, edges, wavesPath) => {
  const tasks = (Array.isArray(waves) ? waves : []).flat()
  if (tasks.length === 0) return ''
  let out = '\n\nCONTRACTS (each task\'s signed body — hold the integrated tree to its ' +
    'Claim, Interfaces, Context and Proof; Stale-if and Authorized-by are not yours to judge):'
  for (const t of tasks) {
    const body = (typeof t.body === 'string' && t.body.trim() !== '') ? t.body.trim() : null
    out += '\n\n### Task ' + t.id + (t.title ? (': ' + t.title) : '')
    if (body) out += '\n' + body
    else if (wavesPath) {
      out += '\n(body: in ' + wavesPath + ', the "tasks" entry whose "id" is "' + t.id + '")'
    }
  }
  const pairs = (Array.isArray(edges) ? edges : []).filter((e) => Array.isArray(e) && e.length === 2)
  if (pairs.length) {
    out += '\n\nDEPENDENCY EDGES (derived by the compiler from Interfaces and Files — ' +
      'each names a produced/consumed pair or a shared file to verify in the tree):\n' +
      pairs.map((e) => '- ' + e[0] + ' -> ' + e[1]).join('\n')
  }
  return out
}

// ── small exec adapters ──────────────────────────────────────────────────────
// Shell strings (testCmd, bootstrapCmd) run through `bash -lc`; git always
// runs argv-form. Both resolve, never reject — callers branch on code.
//
// SHELL_TIMEOUT_MS (#436): a suite that wedges must not consume the sandbox
// lease. Nothing else bounds these — ROLE_TIMEOUT_MS covers only agent()
// subprocesses, and the shim renews the lease on its own interval, so an
// unbounded `sh` surfaces four hours later as an expired-claim reap rather
// than a test failure. The value matches ultra_run.py's own baseline bound
// (timeout=1800) for the same command; xdist adds wedge modes serial pytest
// lacks (an OOM-killed worker, a stuck execnet gateway), which is what moved
// this from theoretical to owed before the golden ships parallel pytest.
export const SHELL_TIMEOUT_MS = 30 * 60 * 1000
const shOf = (exec) => (cmd, cwd, env) =>
  exec('bash', ['-lc', cmd], { cwd, env, timeoutMs: SHELL_TIMEOUT_MS })
// The env for a `Run:`/`Check:` command (#632 part 2). `execSeam` spawns with
// `env: env || process.env`, so a passed env REPLACES the environment whole —
// omit the spread and the command loses PATH, HOME and the git config that
// `git diff` needs. So the variable is added TO the inherited environment,
// never handed over as the whole of it.
const baseEnv = (sha) => ({ ...process.env, ULTRA_BASE: sha })
const gitOf = (exec) => async (argv, cwd) => {
  const r = await exec('git', argv, { cwd })
  if (r.code !== 0) {
    throw new Error('git ' + argv.join(' ') + ' exited ' + r.code + ' in ' + cwd + ': ' +
      (r.stderr || r.stdout).slice(-400))
  }
  return r.stdout.trim()
}

// The kernel CLI prints one JSON object on stdout (fold_wave.py cmd_* —
// json.dumps per verdict). Parse defensively: whole-stdout first, then the
// last {..} line (a stray warning line must not turn a verdict into a crash).
export function parseCliJson(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return null
  try { return JSON.parse(text) } catch { /* line scan */ }
  let found = null
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    try { found = JSON.parse(s) } catch { /* not the verdict line */ }
  }
  return found
}

const tail = (s, n = 4000) => String(s || '').slice(-n)

// ── the integration clone's cache sweep (#631 option (d)) ────────────────────
// The driver runs the suite in the integration clone — baseline, then each
// wave's candidate — so a python suite leaves `__pycache__` and `.pytest_cache`
// behind there before the integrated `Run:` pass reads the tree. That litter is
// the driver's own: a task whose proof asserts a cache directory is ABSENT
// would be parked by the suite run rather than by anything in the adopted tree.
//
// `git clean` is not the tool — it would take `node_modules` and every other
// ignored file with it. This is one walk that removes directories of exactly
// two names and nothing else: never a file, never a directory of another name,
// and never anything under `.git` (a match by name in there is git's business).
// Symlinks are not followed — Dirent.isDirectory() is false for a symlink, so a
// link pointing at a cache directory is left alone rather than dereferenced.
const CACHE_DIR_NAMES = new Set(['__pycache__', '.pytest_cache'])

export const sweepCacheDirs = (root) => {
  let removed = 0
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (!CACHE_DIR_NAMES.has(e.name)) { walk(p); continue }
      // A removed directory is not descended into: its contents went with it.
      try { fs.rmSync(p, { recursive: true, force: true }); removed++ } catch { /* leave it */ }
    }
  }
  walk(root)
  return removed
}

// Second wall on the reply patch (spec §3.3, waves.js PATCH_PREFIX parity):
// withPatchCapture is the first wall (it overwrites the model-typed patch),
// but a reply reaching here with a patch outside the driver-owned prefix is
// stripped regardless — configuration can travel without its producer.
const stripUntrustedPatch = (r, patchPrefix) => {
  if (!r) return r
  if (r.patch != null) {
    const p = String(r.patch)
    const hasDotDot = p === '..' || p.startsWith('../') || p.endsWith('/..') || p.indexOf('/../') !== -1
    if (!p.startsWith(patchPrefix) || hasDotDot) delete r.patch
  }
  return r
}

// ── the resolver work list (spec §3.3) ───────────────────────────────────────
// One JUDGMENT agent per narrated conflict, one at a time: hunk resolutions
// arrive in the resolver's schema, the DRIVER writes the reply directory
// (grammar unchanged: <hunk id>.txt per hunk + notes.txt) and drives `resolve`.
// REJECTED (exit 4) is the one retryable status — one re-brief carrying the
// kernel's reason, then the park.
//
// Lifted out of the wave loop verbatim so the publish fold can dispatch the
// same loop with its own `common`, reply-directory root and label prefix:
// nothing here may assume a wave number, the `.` repo path or the run tree's
// layout. `runCli` is the caller's closure (its call/wall/autoResolved counts
// are its own) and the park bookkeeping stays the caller's too — this returns
// the reason string and its own fresh `transcripts`, and the caller's
// `blocked()` writes the record.
export async function resolveConflicts({
  agent, runCli, roles, common, taskArgs = [], commutesArgs = [],
  open, contendingBlock = '', waveDir, labelPrefix, onEvent,
}) {
  const transcripts = []
  let selfChecks = ''
  let outstanding = (Array.isArray(open) ? open : []).slice()
  const park = (reason) => ({ ok: false, reason, transcripts, selfChecks })

  worklist:
  while (outstanding.length) {
    const conflict = outstanding[0]
    let rejection = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      const label = labelPrefix + ':' + conflict.i + ':' + attempt
      let res
      try {
        res = await agent(
          roles.resolver +
            '\nHUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
            (rejection ? ('\nPREVIOUS REPLY REJECTED: ' + rejection) : '') +
            contendingBlock,
          { label, schema: RESOLVER_SCHEMA })
      } catch (e) {
        // A run-fatal (credential/config) must surface as the engine crash
        // it is — swallowing it here would misreport a dead credential as a
        // merge CONFLICT (review finding 4).
        if (String((e && e.message) || e).startsWith('RUN_FATAL')) throw e
        return park('resolver dispatch threw on ' + conflict.path + ': ' + String((e && e.message) || e))
      }
      if (!res) {
        // A null reply is a transient process death (agent()'s documented
        // condition), not a judgment about the conflict: spend the second
        // attempt on it rather than blocking the wave on one API blip.
        if (attempt === 1) { rejection = 'the previous resolver produced no reply (transient death) — resolve afresh'; continue }
        return park('resolver dispatch returned no reply twice on ' + conflict.path)
      }
      const replyDir = path.join(waveDir, 'reply-' + conflict.i + '-' + attempt)
      transcripts.push({ conflict: conflict.i, attempt, path: conflict.path,
        epoch: conflict.epoch, hunksFile: conflict.hunksFile,
        replyDir, status: res.status, notes: res.notes || '' })
      // Optional reply counter for a caller that wants the tally without
      // reading transcripts (the wave loop passes none).
      if (onEvent) onEvent({ kind: 'resolver:reply', label, conflict: conflict.i, attempt, status: res.status })
      if (res.status !== 'RESOLVED') {
        return park('resolver reported ' + res.status + ' on ' + conflict.path)
      }
      // Driver writes the reply directory from the schema contents. Each
      // hunk file is newline-terminated (the grammar's shape); an empty
      // content is an empty file (the block resolves to nothing).
      fs.mkdirSync(replyDir, { recursive: true })
      for (const h of (res.hunks || [])) {
        const c = String(h.content || '')
        // The id rides the reply verbatim but the filename is driver-built:
        // strip anything path-shaped so a hostile id cannot escape replyDir.
        const safeId = String(h.id || '').replace(/[^A-Za-z0-9]/g, '')
        if (!safeId) continue
        fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
          c === '' ? '' : (c.endsWith('\n') ? c : c + '\n'))
      }
      fs.writeFileSync(path.join(replyDir, 'notes.txt'), String(res.notes || '') + '\n')

      const applied = await runCli(['resolve', ...common,
        '--conflict', String(conflict.i), '--reply-dir', replyDir, ...taskArgs, ...commutesArgs])
      const a = applied.parsed
      if (applied.code === 4) {
        const reason = (a && a.reason) || tail(applied.stderr, 200)
        if (attempt === 1) { rejection = reason; continue }
        return park('resolver reply rejected twice on ' + conflict.path + ': ' + reason)
      }
      if (!a || a.applied !== true) {
        return park('resolution of ' + conflict.path + ' not applied (exit ' + applied.code +
          '): ' + ((a && (a.reason || (a.stale ? 'stale' : ''))) || tail(applied.stderr, 300)))
      }
      if (Array.isArray(a.waiting) && a.waiting.length) {
        // The stop has not drained: the engine's outstanding list minus the
        // entry just applied must be exactly what the CLI says is waiting.
        const expectWaiting = outstanding.slice(1).map((e) => e.i)
        const sameIds = a.waiting.length === expectWaiting.length &&
          a.waiting.slice().sort((x, y) => x - y).join(',') ===
          expectWaiting.slice().sort((x, y) => x - y).join(',')
        if (!sameIds) {
          return park('resolve on ' + conflict.path + ' reported waiting [' +
            a.waiting.join(', ') + '] but the engine was holding [' + expectWaiting.join(', ') + ']')
        }
        outstanding.shift()
        continue worklist
      }
      if (Array.isArray(a.open) && a.open.length) {
        if (typeof a.conflicts !== 'number') {
          return park('continued fold reported open conflicts with no count to verify against')
        }
        if (a.dispatchable !== a.open.length) {
          return park('continued fold named ' + a.open.length + ' open conflict(s) but counted ' +
            a.dispatchable + ' still to resolve')
        }
        outstanding = a.open.slice()
        continue worklist
      }
      if (a.complete === true) {
        if (a.selfChecks !== 'ok') {
          return park('fold self-checks did not pass: ' + (a.selfChecks || '(absent)'))
        }
        selfChecks = a.selfChecks
        outstanding = []
        continue worklist
      }
      return park('resolution of ' + conflict.path + ' left the wave in an unrecognized state')
    }
    return park('resolver attempts exhausted on ' + conflict.path)
  }
  return { ok: true, reason: '', transcripts, selfChecks }
}

// ── the engine ───────────────────────────────────────────────────────────────
export async function runEngine({
  args, agent, parallel, exec,
  paths, // { repoDir, runDir, clonesDir }
  log = () => {}, phase = () => {},
  rolesDir,
  // Live patch base (optional): a { current } holder shared with the caller's
  // withPatchCapture wrapper. Wave 1 captures against BASE; each adopted wave
  // advances it so wave N+1's diffs are taken against the tree its tasks
  // actually built on — a static base would silently re-diff later waves
  // against the original BASE and re-fold wave 1's work into every patch.
  patchBase,
}) {
  const roles = loadRoles(rolesDir)
  const sh = shOf(exec)
  const git = gitOf(exec)
  const { runDir, clonesDir } = paths
  // The engine is handed `log` and `phase` (both events of their own kind) but
  // no raw sink, and `driver:proof-run` is a RECORD, not narration: it has to
  // survive the run as data a sense pass can count. So it goes to the same
  // append-only `<runDir>/events.jsonl` makeEventLog opened, stamped the same
  // way. A failed append is never the run's failure mode — the evidence the
  // reviewer reads is the prompt block, and this is the durable copy.
  const appendEvent = (e) => {
    try {
      const ts = Date.now()
      fs.appendFileSync(path.join(runDir, 'events.jsonl'),
        JSON.stringify({ ...e, id: ulid(ts), ts }) + '\n')
    } catch { /* evidence, not control flow */ }
  }
  const repoDir = path.resolve(paths.repoDir)
  const integ = path.join(clonesDir, 'integration')

  // ── args (waves.js parity, minus the deleted subsystems) ───────────────────
  const WAVES = args.waves
  if (!Array.isArray(WAVES) || WAVES.length === 0 ||
      !WAVES.every((w) => Array.isArray(w) && w.length > 0 &&
        w.every((t) => t && typeof t.id === 'string' &&
          ((typeof t.body === 'string' && t.body.trim() !== '') || Boolean(args.wavesPath))))) {
    throw new Error('run-engine: args.waves missing or malformed (Task[][], each task ' +
      '{ id, body, ... }; body may live in args.wavesPath instead)')
  }
  {
    const seen = new Set()
    for (const w of WAVES) for (const t of w) {
      if (seen.has(t.id)) throw new Error('run-engine: duplicate task id "' + t.id + '"')
      seen.add(t.id)
    }
  }
  if (args.resume === true) {
    // The redirect lane is a future engine feature; refusing loudly beats a
    // half-ported resume that reuses a branch it never verified.
    throw new Error('run-engine: resume is not supported on the driver path')
  }
  const stamp = args.stamp || 'run'
  const integrationBranch = (typeof args.integrationBranch === 'string' && args.integrationBranch) ||
    ('ultra/integration-' + stamp)
  const dependencyEdges = args.dependencyEdges || []
  const edgesSupplied = Array.isArray(args.edges)
  const EDGES = edgesSupplied
    ? args.edges.map((e, i) => {
        if (!Array.isArray(e) || e.length !== 2) {
          throw new Error('run-engine: args.edges[' + i + '] is not a [from, to] pair')
        }
        return [String(e[0]), String(e[1])]
      })
    : []
  const testCmd = (typeof args.testCmd === 'string' && args.testCmd.trim()) || undefined
  // #436: the driver's own suite runs stay at full width (serialized, one
  // integration clone); the concurrent implementers get the machine divided
  // among them. #547: divide by the workers that actually SHARE the run-wide
  // command, not by WIDTH. Per-task testCmd (#515) means testCmdLine hands a
  // task with its own command that command — it never sees the capped one —
  // so counting it as a sharer over-divides the machine for everyone else.
  // The count is over every entry in the run (waves are sequential, but the
  // cap is one string computed once, so the whole run's sharers is the honest
  // upper bound). Zero sharers means the string is dead: leave it uncapped
  // rather than log a cap nobody reads. #663: a task whose own command IS its
  // peer's exam is handed the run-wide one too, so the predicate that picks the
  // implementer's line is the predicate that counts the sharers.
  const runWideSharers = WAVES.reduce((n, w) => n + w.filter(sharesRunWideCmd).length, 0)
  const workerTestCmd = runWideSharers > 0
    ? capWorkerParallelism(testCmd, runWideSharers, os.cpus().length)
    : testCmd
  if (workerTestCmd !== testCmd) {
    log('run-engine: worker testCmd capped for concurrency (#436) — ' + workerTestCmd)
  }
  const bootstrapCmd = (typeof args.bootstrapCmd === 'string' && args.bootstrapCmd.trim()) || undefined
  const ACCEPTANCE = (args.acceptance && typeof args.acceptance === 'object') ? args.acceptance : null
  const reviewProfile = isPairReview(args.reviewProfile) ? args.reviewProfile : 'lean'
  const globalConstraints = (typeof args.globalConstraints === 'string' && args.globalConstraints.trim()) || ''
  // The executable half of the Global Constraints: `{ cmd, minor }` entries the
  // driver runs itself, in every task's clone and once more on the adopted
  // tree. Malformed input reads as no checks rather than throwing — a plan that
  // typed the key wrong must not take the run down; the absence shows up as an
  // empty `integratedChecks` in the report.
  const constraintChecks = (Array.isArray(args.constraintChecks) ? args.constraintChecks : [])
    .filter((c) => c && typeof c === 'object' && typeof c.cmd === 'string' && c.cmd.trim() !== '')
    .map((c) => ({ cmd: c.cmd, minor: Boolean(c.minor) }))
  const planPath = (typeof args.planPath === 'string' && args.planPath.trim()) || undefined
  // The plan's H1, read ONCE here and carried to every wave's materialize as
  // `--subject` (#633): the fold commit — and so the squash-merge the PR
  // lands — is titled from the plan rather than from the wave counter. The
  // title is the text after `# ` on the first line that begins that way,
  // trimmed; a missing or unreadable plan, or one with no such line, leaves
  // it undefined and the kernel writes BASE's message unchanged.
  const planTitle = (() => {
    if (!planPath) return undefined
    let text
    try {
      text = fs.readFileSync(planPath, 'utf8')
    } catch {
      return undefined
    }
    for (const line of text.split('\n')) {
      if (line.startsWith('# ')) return line.slice(2).trim() || undefined
    }
    return undefined
  })()
  const wavesPath = (typeof args.wavesPath === 'string' && args.wavesPath.trim()) || undefined
  // Patch input is the ONLY input shape here (Amendment 9): the value is the
  // driver-owned patches directory, the trust anchor for reply patches.
  const patchPrefix = (typeof args.patchInput === 'string' && args.patchInput.charAt(0) === '/')
    ? (args.patchInput.endsWith('/') ? args.patchInput : args.patchInput + '/')
    : null
  if (!patchPrefix) {
    throw new Error('run-engine: args.patchInput must be the absolute driver-owned patches ' +
      'directory — the engine has no branch-input mode (Amendment 9: fold is the only merge path)')
  }
  if (!testCmd) throw new Error('run-engine: args.testCmd is mandatory (#96)')

  const globalConstraintsBlock = globalConstraints ? ('\nGLOBAL CONSTRAINTS:\n' + globalConstraints) : ''
  // The profile is reported verbatim, not normalized: a task that authored
  // `adversarial` keeps saying so in the report even though `peer` is the
  // documented spelling of the same pair.
  const taskReviewProfile = (task) =>
    isPairReview(task.review) ? task.review : (isPairReview(reviewProfile) ? reviewProfile : 'lean')

  // ── report accumulators (waves.js parity) ──────────────────────────────────
  const taskResults = []
  const blockedWaves = []
  const waveMerges = []
  const judgmentCalls = []
  const unfinished = []
  const frontier = []
  // #604 — one record per merged task's `Run:` command, executed on the tree
  // its wave adopted, and the blocking findings a non-zero exit mints.
  const integratedRuns = []
  const integratedChecks = []
  const integratedFindings = []
  // Plan-actor blocking findings: `{ task, detail }`, distinct, in the order
  // the reviews raised them. They drive no fix round — they become gate
  // deferrals once the run knows which tasks finished `done`.
  const planDefects = []
  // ── what a reviewer-minute bought ──────────────────────────────────────────
  // The run spends most of its wall clock in referees, and until now the report
  // said how many rounds ran but never what they returned per minute spent —
  // so a pair that never finds a second thing looks exactly like one that does.
  // Every `review:` call is timed INDIVIDUALLY (a concurrent pair contributes
  // both durations, because both were paid for), and the numerator counts only
  // what a REVIEWER returned: the driver's own Run:/Check: reds are the
  // driver's finding, and charging them to the referee flatters the ratio.
  let reviewerMs = 0
  let pairRounds = 0
  let r2MarginalBlocking = 0
  const reviewerBlockingKeys = new Set()
  const timedReview = async (prompt, opts) => {
    const t0 = Date.now()
    try { return await agent(prompt, opts) } finally { reviewerMs += Date.now() - t0 }
  }

  // Edge sanity (ported): an unbound / inverted / same-wave edge weakens
  // dependency blocking — surfaced, never thrown.
  {
    const waveIndexOf = Object.create(null)
    WAVES.forEach((w, i) => w.forEach((t) => { waveIndexOf[t.id] = i }))
    for (const [a, b] of EDGES) {
      if (!(a in waveIndexOf) || !(b in waveIndexOf)) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoint not in this run — ' +
          'unbound for dependency blocking (check for a typo)')
      } else if (waveIndexOf[a] > waveIndexOf[b]) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': \'' + b + '\' does not run after \'' + a +
          '\' (earlier wave) — dependency blocking cannot bind; move the dependent to a later wave')
      } else if (waveIndexOf[a] === waveIndexOf[b]) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoints share a wave — blocking is ' +
          'chunk-position-dependent (fires only across ' + CONCURRENCY + '-task chunk boundaries)')
      }
    }
  }

  // ── SETUP — driver git (was: a haiku agent told to run `git worktree add`;
  // run-25's park class). The integration clone sits detached at BASE; the
  // branch is created there, bootstraps run, and the baseline is established,
  // all through exec. No prompt exists for any of this to be misread. ────────
  phase('Setup')
  const branchExists = await exec('git', ['show-ref', '--verify', '--quiet',
    'refs/heads/' + integrationBranch], { cwd: integ })
  if (branchExists.code === 0) {
    throw new Error('run-engine: integration branch ' + integrationBranch +
      ' already exists in the clone — refusing to reuse a branch this run did not create')
  }
  await git(['checkout', '-q', '-b', integrationBranch], integ)
  const baseSha = await git(['rev-parse', 'HEAD'], integ)
  if (bootstrapCmd) {
    // Every fresh clone needs its dependencies before a suite can run there —
    // the integration clone (baseline, reconcile, driver suite runs) and each
    // task clone (implementer red-green cycles). Driver-run, so the warm-cache
    // prompt choreography does not exist on this path.
    for (const dir of [integ, ...WAVES.flat().map((t) => path.join(clonesDir, 'task-' + t.id))]) {
      const b = await sh(bootstrapCmd, dir)
      if (b.code !== 0) {
        judgmentCalls.push('bootstrap failed in ' + path.basename(dir) + ' (exit ' + b.code +
          ') — the suite may be unrunnable there: ' + tail(b.stderr || b.stdout, 300))
        log('bootstrap failed in ' + path.basename(dir))
      }
    }
  }
  const baselineRun = await sh(testCmd, integ)
  const baseline = { passed: baselineRun.code === 0, output: tail(baselineRun.stdout + baselineRun.stderr, 2000) }
  if (!baseline.passed) {
    judgmentCalls.push('baseline: test suite was already failing before any task ran (' +
      tail(baseline.output, 500) + ') — task results inherit a red suite')
    log('setup: baseline tests FAILED before any work began')
  }
  log('setup: branch ' + integrationBranch + ' at ' + baseSha + '; baseline ' +
    (baseline.passed ? 'green' : 'RED'))

  // ── dependency cascade (ported) ────────────────────────────────────────────
  const blockedByDep = new Set()
  const noteFailures = () => {
    const failed = new Set(taskResults.filter((r) => r && r.status === 'failed').map((r) => r.task))
    let grew = true
    while (grew) {
      grew = false
      for (const [a, b] of EDGES) {
        if ((failed.has(a) || blockedByDep.has(a)) && !blockedByDep.has(b) && !failed.has(b)) {
          blockedByDep.add(b)
          grew = true
        }
      }
    }
  }

  const hasCoordinates = (r) => r && r.headSha && r.patch
  const isMergeable = (r) => r && r.status === 'done' && hasCoordinates(r)

  // Every RETRY dispatch gets a clean tree (review finding 3): waves.js
  // retries got a fresh worktree per dispatch, but here the retry re-enters
  // the SAME clone, which the failed attempt may have dirtied or committed to
  // — the fresh implementer would then be told "your tree is at BASE" over a
  // tree that is not, duplicate its own work into the cumulative patch, and
  // trip the #314 guard with a false alarm. Fix rounds are the one deliberate
  // exception: they BUILD on the prior attempt's tree, so only runTask's
  // retry lanes call this.
  const resetTaskClone = async (taskId, sha) => {
    const cdir = path.join(clonesDir, 'task-' + taskId)
    await git(['reset', '--hard', '--quiet', sha], cdir)
    await exec('git', ['clean', '-fdq'], { cwd: cdir })
  }

  // Where a clone at `sha` can be cut from. The bare repo holds every wave-0
  // base, but a later wave's base is a fold commit that exists only in the
  // integration clone's object database until the run pushes — so the source
  // is whichever tree can actually resolve the sha, checked rather than
  // assumed. Same question the re-anchor loop answers when it fetches from
  // `integ`.
  const cloneSourceFor = async (sha) => {
    const r = await exec('git', ['cat-file', '-e', sha + '^{commit}'], { cwd: repoDir })
    return r.code === 0 ? repoDir : integ
  }

  // ── per-task pipeline: implement → review → bounded fix loop (ported) ──────
  async function runTaskInner(task, baseShaForTask, siblingsStr, tierOverride) {
    const tierName = (typeof tierOverride === 'string') ? tierOverride : task.tier
    const baseModel = resolvedModel(tierName)
    const economics = { tier: baseModel, review: taskReviewProfile(task) }
    const concerns = []
    const noteConcerns = (res) => {
      if (res && res.status === 'DONE_WITH_CONCERNS' && Array.isArray(res.concerns)) {
        for (const c of res.concerns) {
          if (concerns.indexOf(c) !== -1) continue
          concerns.push(c)
          judgmentCalls.push('task ' + task.id + ': ' + c)
        }
      }
    }
    if (task.review && !isPairReview(task.review) && task.review !== 'lean') {
      judgmentCalls.push('task ' + task.id + ': unknown review="' + task.review +
        '" — fell back to the run default (' + reviewProfile + ')')
    }
    if (task.tier && !Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))) {
      judgmentCalls.push('task ' + task.id + ': unknown tier="' + task.tier +
        '" — fell back to standard (valid: standard, mostCapable/most-capable)')
    }

    // Everything after the TEST COMMAND line is one string both workers get,
    // byte for byte: the same BASE, FILES, SIBLING FILES, GLOBAL CONSTRAINTS,
    // INTERFACES and TASK blocks. Only that one line can differ (#663), and it
    // differs only for a task whose own command is its peer's exam.
    const sharedInputs = filesLine(task) + siblingsStr +
      globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task, wavesPath)
    const examinerInputs = testCmdLine(task, workerTestCmd) + sharedInputs
    const implementerInputs = implTestCmdLine(task, workerTestCmd) + sharedInputs

    // ── the exam (#553, #653) ────────────────────────────────────────────────
    // A worker writes the tests the Proof names, in a clone of its OWN at BASE,
    // dispatched in the same breath as the implementer and awaited neither
    // before nor after it. It receives the implementer's inputs — the same
    // BASE, FILES, SIBLING FILES, GLOBAL CONSTRAINTS, INTERFACES and TASK
    // blocks — and NOT the implementer's role: the one agent that may not be
    // told to make the suite green is the one writing the thing that measures
    // it. The one line the two prompts can differ in is TEST COMMAND (#663):
    // the exam's command is the examiner's, and the implementer, which will not
    // hold the exam until the handoff, is handed the run-wide suite instead.
    //
    // Two clones rather than one (#653) buys two things at once. The graded
    // party never holds the exam in its tree while it works, so the peer rule
    // (#551 — the exam is written by a peer, never the submitter) is a fact of
    // the substrate rather than a sentence in a role file; and the exam's wall
    // clock is no longer spent with the implementer idle. The bytes reach the
    // graded tree by a DRIVER handoff once both have returned, below.
    //
    // What the driver holds after the pair is what the exam is worth: the blob
    // sha of every Proof path as the examiner left it, and whether the task's
    // own testCmd is RED against those tests at BASE — read in the examiner's
    // clone, which is a tree at BASE by construction. Both are driver exec
    // (Amendment 10) — no prompt asks anyone to run git or report a sha.
    const cloneDir = path.join(clonesDir, 'task-' + task.id)
    const examDir = path.join(clonesDir, 'exam-' + task.id)
    const proofTests = Array.isArray(task.proofTests)
      ? task.proofTests.filter((p) => typeof p === 'string' && p.trim() !== '')
      : []
    // The Proof's `Run:` commands, in Proof order (#589). Absent or empty for
    // every task compiled before the slot existed — and M6: a `Run:`-only
    // proof leaves `proofTests` empty, so it dispatches no examiner by the
    // branch already below, with no new condition.
    const proofRuns = Array.isArray(task.proofRuns)
      ? task.proofRuns.filter((c) => typeof c === 'string' && c.trim() !== '')
      : []
    const examTestCmd = (typeof task.testCmd === 'string' && task.testCmd.trim())
      ? task.testCmd : null
    // `git hash-object` on the path as it stands in a clone; an absent path is
    // recorded as null, which is itself a value the drift check compares
    // (creating a path the examiner declined to write IS an edit).
    const blobShaIn = async (dir, p) => {
      const r = await exec('git', ['hash-object', path.resolve(dir, p)], { cwd: dir })
      return r.code === 0 ? String(r.stdout || '').trim() : null
    }
    const blobShaOf = (p) => blobShaIn(cloneDir, p)
    let exam = null
    // The blobs the drift check compares against — recorded from the graded
    // clone at the HANDOFF, never before it (see below).
    let examBlobs = null
    // What the examiner left in its own clone, path by path: the copy list, and
    // the record that an exam exists at all.
    let examinerBlobs = null
    // The examiner's clone is cut here rather than by run-main's
    // provisionRunTree, which cuts `integration` and `task-<id>` and knows
    // nothing about Proofs: only the engine knows which tasks have an exam, and
    // only at dispatch time does it know the wave base to cut at. Everything
    // the examiner needs before it can be dispatched — the clone and the
    // bootstrap its red-at-BASE run reads — is awaited HERE, so the dispatch
    // itself is one unawaited call beside the implementer's.
    const examReady = await (async () => {
      if (!(proofTests.length && examTestCmd)) return false
      try {
        // A barrier retry re-enters runTaskInner; the clone is re-cut from
        // scratch rather than reused, the same posture resetTaskClone takes.
        fs.rmSync(examDir, { recursive: true, force: true })
        cloneAtBase({ repo: await cloneSourceFor(baseShaForTask), dest: examDir,
                      base: baseShaForTask })
      } catch (e) {
        // No clone, no exam — and no reason to fail a task over it: the same
        // standing a BLOCKED examiner has.
        exam = 'blocked'
        judgmentCalls.push('task ' + task.id + ': the examiner\'s clone could not be cut at ' +
          baseShaForTask + ' (' + String((e && e.message) || e) +
          ') — no exam recorded; the implementer proceeds unexamined')
        return false
      }
      if (bootstrapCmd) {
        // The setup loop bootstrapped every clone that existed then; this one
        // did not, and its red-at-BASE run needs the same tree.
        const b = await sh(bootstrapCmd, examDir)
        if (b.code !== 0) {
          judgmentCalls.push('bootstrap failed in ' + path.basename(examDir) + ' (exit ' + b.code +
            ') — the suite may be unrunnable there: ' + tail(b.stderr || b.stdout, 300))
          log('bootstrap failed in ' + path.basename(examDir))
        }
      }
      return true
    })()
    // The Proof paths whose blob no longer matches what the examiner left.
    const examDrift = async () => {
      if (!examBlobs) return []
      const moved = []
      for (const [p, sha] of examBlobs) {
        if (await blobShaOf(p) !== sha) moved.push(p)
      }
      return moved
    }
    // One rule for exam drift (2026-09-02, after run-53): a moved Proof path is
    // never refused by the driver — it is RECORDED on the row as `examEdited`,
    // pushed as one judgment call, and named to the referee as EXAM EDITED so
    // the review reads those hunks as what they are. Until run-54 the
    // implementer's edit was a total stop (unreviewed, unfolded) while the fix
    // round's was recorded; run-53's only real edit was a legitimate one — the
    // exam was brittle — and two stops for one event were one too many. The
    // referee, not the driver, decides whether the edit was the exam's fault
    // (reviewer.md rule 8). `examEdited` is present on every row returned
    // after the implementer when an exam was recorded, absent when none was.
    let examEdited = null
    const examEditedField = () => (examEdited === null ? {} : { examEdited })
    const noteDrift = async (who) => {
      if (!examBlobs) return
      const moved = await examDrift()
      const fresh = moved.filter((p) => !(examEdited || []).includes(p))
      examEdited = (examEdited || []).concat(fresh)
      if (fresh.length) {
        judgmentCalls.push('task ' + task.id + ': ' + who + ' edited the exam — ' +
          fresh.join(', ') + ' no longer matches the blob recorded at BASE; the review ' +
          'reads the patch, exam hunks included')
      }
    }

    let baseCorrected = null
    // The pair (#653). Both dispatches are made here with nothing awaited
    // between them: everything the examiner needed first — its clone, its
    // bootstrap — is already done above, so `agent` is entered for `exam:<id>`
    // and then for `impl:<id>` in the same tick, and `Promise.all` awaits
    // neither before the other. Deliberately NOT the `parallel` seam: that one
    // is bounded by the caller and this code already runs inside one of its
    // slots, so nesting it could hand the wave a width it does not have.
    const examCall = examReady
      ? agent(roles.examiner + '\nBASE: ' + baseShaForTask + examinerInputs,
          { label: 'exam:' + task.id, isolation: 'worktree', model: baseModel,
            schema: EXAMINER_SCHEMA })
      : null
    const implCall = agent(
      roles.implementer + '\nBASE: ' + baseShaForTask + implementerInputs,
      { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA })
    const [ex, implReply] = await Promise.all([examCall, implCall])
    let impl = implReply
    if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null (terminal Overloaded or skipped)')
    stripUntrustedPatch(impl, patchPrefix)
    noteConcerns(impl)
    // #314 guard, kept one more run (spec §3.1): clones are cut at BASE by
    // construction, so a mismatch here is a check on a thing that cannot
    // happen — which is what a guard on an inexpressible defect looks like.
    if (typeof impl.startHead === 'string' && impl.startHead.trim()) {
      if (impl.startHead.trim() !== baseShaForTask) {
        baseCorrected = { from: impl.startHead.trim(), to: baseShaForTask }
        judgmentCalls.push('task ' + task.id + ': tree reported at ' + baseCorrected.from +
          ', not BASE ' + baseShaForTask + ' (#314 guard — should be inexpressible under cloneAtBase)')
      }
    } else {
      judgmentCalls.push('task ' + task.id + ': implementer reported no startHead — BASE anchoring unverified (#314)')
    }
    // How many blocking issues the round that dispatched the fix handed over
    // with a patch attached (#551) — reported per task, and not reset by the
    // clean re-review that follows the fix. Zero when no round ever ran.
    let proposedPatches = 0
    // How many pre-review repair rounds this task took (0 or 1): the driver's
    // own Run:/Check: pass either was green the first time or it was not.
    let proofFixes = 0

    // ── the examiner's verdict, read in the examiner's own clone ─────────────
    // That clone is a tree at BASE by construction and no implementer ever
    // touched it, so a green testCmd there is green at BASE and means what it
    // has always meant: the exam establishes nothing.
    if (examReady) {
      for (const u of ((ex && Array.isArray(ex.unsatisfiable)) ? ex.unsatisfiable : [])) {
        judgmentCalls.push('task ' + task.id + ': examiner: ' + u.leg + ' — ' + u.why)
      }
      if (!ex || ex.status !== 'DONE') {
        // A dead examiner is a transient process death and a BLOCKED one is a
        // judgment about the Proof; neither is the implementer's fault, and
        // neither is worth failing a task over. The task proceeds WITHOUT an
        // exam — nothing is handed over, nothing is run, and the implementer's
        // own file at the Proof path is what gets reviewed — which the record
        // says in as many words.
        exam = 'blocked'
        judgmentCalls.push('task ' + task.id + ': examiner ' +
          (ex ? (ex.status + ' (' + (ex.summary || 'no summary') + ')') : 'returned no reply') +
          ' — no exam recorded; the implementer proceeds unexamined')
      } else {
        examinerBlobs = []
        for (const p of proofTests) examinerBlobs.push([p, await blobShaIn(examDir, p)])
        const atBase = await sh(examTestCmd, examDir)
        if (atBase.code === 0) {
          exam = 'green-at-base'
          judgmentCalls.push('task ' + task.id + ': exam is green at BASE — it establishes nothing')
        } else {
          exam = 'red'
        }
      }
    }

    // ── the handoff (#653) ───────────────────────────────────────────────────
    // Both have returned, so the exam crosses from the examiner's clone into
    // the graded one, driver-side: every Proof path the examiner actually
    // wrote is copied over the same path in the implementer's tree. The peer's
    // bytes win over whatever the implementer left there, which is what makes
    // "an implementer that wrote the Proof path edited nothing" true of the
    // substrate rather than true of a sentence in a role file. The capture is
    // then retaken so the patch the reviewer reads and the fold applies
    // carries the exam's hunks — the driver's own capture, against the same
    // BASE, never a model-typed path.
    //
    // Only after all that are the blobs the drift check compares recorded:
    // before this line the implementer held no exam, so nothing it did can be
    // an edit of one.
    if (examinerBlobs) {
      const handed = []
      for (const [p, sha] of examinerBlobs) {
        if (!sha) continue
        const dest = path.resolve(cloneDir, p)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(path.resolve(examDir, p), dest)
        handed.push(p)
      }
      appendEvent({ kind: 'driver:exam-handoff', task: task.id, paths: handed })
      if (hasCoordinates(impl)) {
        try {
          // Same drop rule as the wrapper's capture (#714): this re-capture
          // writes over the same file the fold reads, so a `__pycache__` the
          // implementer's test run left behind must not ride back in here
          // after the wrapper had already dropped it.
          impl.patch = patchAgainstBase({ cwd: cloneDir, base: baseShaForTask,
            out: patchPrefix + 'task-' + task.id + '.patch',
            files: Array.isArray(task.files) ? task.files : [],
            onDropped: (paths) => appendEvent({ kind: 'capture:dropped',
              label: 'impl:' + task.id, paths }) })
        } catch (e) {
          impl.patch = ''
          impl.headSha = ''
          impl.captureError = 'exam handoff re-capture failed: ' + String((e && e.message) || e)
        }
      }
      examBlobs = []
      for (const p of proofTests) examBlobs.push([p, await blobShaOf(p)])
      examEdited = []
    }

    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
      return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
               reviewVerdict: 'not-reviewed', notes: impl.summary,
               tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
               ...examEditedField() }
    }
    if (!hasCoordinates(impl)) {
      // With driver capture the only way here is a capture failure — reply
      // carries captureError, cleared coordinates (run-waves.mjs). Honest loss.
      judgmentCalls.push('task ' + task.id + ': no driver-captured coordinates (' +
        (impl.captureError || 'capture absent') + ') — failed before review')
      return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
               reviewVerdict: 'lost-coordinates',
               notes: 'no driver-captured patch/headSha — downgraded to failed before review',
               tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
               ...examEditedField() }
    }

    // ── the driver's own Run:/Check: pass ────────────────────────────────────
    // A referee's minutes are the scarcest thing the run spends, and a red
    // command is not a judgment — the driver already has the answer. So every
    // `Run:` and every `Check:` is executed here, on the implementer's tree,
    // BEFORE any referee is dispatched: a red one buys one repair round at
    // `iter: 0` and the pass repeats. Still red and the task is over — a
    // proof-red task never reaches a reviewer at all, because asking a referee
    // to read a patch whose own proof fails is asking it to grade the wrong
    // thing. Same `sh` seam, cwd and tail-truncation as the review-round pass.
    const runCommands = async (iter) => {
      const runs = []
      for (const cmd of proofRuns) {
        const r = await sh(cmd, cloneDir, baseEnv(baseShaForTask))
        runs.push({ cmd, exit: r.code, stdout: tail(r.stdout + r.stderr) })
        appendEvent({ kind: 'driver:proof-run', task: task.id, cmd, exit: r.code, iter })
      }
      return runs
    }
    // The task's own exam, on the same terms (#638). The pair that dispatched
    // the examiner is the pair that gates this — plus `examBlobs`, which is the
    // driver's record that the examiner actually left tests behind: a blocked
    // or dead examiner writes no file, and `command not found` is not a red
    // exam, it is the absence of one (the task proceeds unexamined, as it did).
    const examRunnable = Boolean(proofTests.length && examTestCmd && examBlobs)
    const runExam = async (iter) => {
      if (!examRunnable) return null
      const r = await sh(examTestCmd, cloneDir)
      appendEvent({ kind: 'driver:exam-run', task: task.id, cmd: examTestCmd, exit: r.code, iter })
      return { cmd: examTestCmd, exit: r.code, stdout: tail(r.stdout + r.stderr) }
    }
    const runChecks = async (iter) => {
      const checks = []
      for (const c of constraintChecks) {
        const r = await sh(c.cmd, cloneDir, baseEnv(baseShaForTask))
        checks.push({ cmd: c.cmd, exit: r.code, stdout: tail(r.stdout + r.stderr), minor: c.minor })
        appendEvent({ kind: 'driver:check-run', task: task.id, cmd: c.cmd, exit: r.code,
                      minor: c.minor, iter })
      }
      return checks
    }
    // The same red minor check is re-executed on every pass; it is worth ONE
    // line in the report, not one per execution.
    const minorNoted = new Set()
    const reroutedTokens = new Set()
    const noteMinorCheck = (c) => {
      if (minorNoted.has(c.cmd)) return
      minorNoted.add(c.cmd)
      judgmentCalls.push('task ' + task.id + ': minor Check: `' + c.cmd + '` exited ' + c.exit +
        ' — recorded for the referee, blocking nothing')
    }
    const RUN_FAIL = (r) => 'the Proof\'s Run: command failed: ' + r.cmd + ' — exit ' + r.exit
    const CHECK_FAIL = (c) => 'the Global Constraints Check: command failed: ' + c.cmd +
      ' — exit ' + c.exit
    // A red exam is a red of the same standing as a red `Run:`: the Proof's
    // `Test:` paths are the task's contract just as its `Run:` commands are.
    const EXAM_FAIL = (e) => 'the Proof\'s exam failed: ' + e.cmd + ' — exit ' + e.exit
    if (proofRuns.length || constraintChecks.length || examRunnable) {
      const prePass = async () => {
        const reds = []
        for (const r of await runCommands(0)) {
          if (r.exit !== 0) reds.push({ line: RUN_FAIL(r), stdout: r.stdout })
        }
        const e = await runExam(0)
        if (e && e.exit !== 0) reds.push({ line: EXAM_FAIL(e), stdout: e.stdout })
        for (const c of await runChecks(0)) {
          if (c.exit === 0) continue
          if (c.minor) { noteMinorCheck(c); continue }
          reds.push({ line: CHECK_FAIL(c), stdout: c.stdout })
        }
        return reds
      }
      let reds = await prePass()
      if (reds.length) {
        proofFixes = 1
        judgmentCalls.push('task ' + task.id + ': the driver\'s pre-review pass was red (' +
          reds.map((r) => r.line).join('; ') + ') — one repair round before any referee read the patch')
        impl = await agent(
          roles.fix + taskBodyBlock(task, wavesPath) + testCmdLine(task, workerTestCmd) +
            filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) +
            '\n\nBlocking issues to resolve:\n' +
            reds.map((r) => '- ' + r.line + '\n  output (last 4,000 characters):\n' + r.stdout).join('\n'),
          { label: 'fix:' + task.id + ':0', isolation: 'worktree',
            model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA })
        if (impl === null) throw new Error('AGENT_NULL: pre-review fix agent returned null (terminal Overloaded or skipped)')
        stripUntrustedPatch(impl, patchPrefix)
        noteConcerns(impl)
        await noteDrift('the fix round')
        if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') && !hasCoordinates(impl)) {
          judgmentCalls.push('task ' + task.id + ': pre-review fix round lost driver-captured coordinates (' +
            (impl.captureError || 'capture absent') + ') — failed before review')
          return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                   reviewVerdict: 'lost-coordinates',
                   notes: 'pre-review fix round produced no driver-captured patch/headSha',
                   tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                   ...examEditedField() }
        }
        if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
          return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                   reviewVerdict: 'blocked-after-fix', notes: impl.summary,
                   tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                   ...examEditedField() }
        }
        reds = await prePass()
        if (reds.length) {
          const notes = reds.map((r) => r.line).join('; ')
          judgmentCalls.push('task ' + task.id + ': still red after the pre-review repair round (' +
            notes + ') — no referee was dispatched')
          log('task ' + task.id + ' proof-red after the pre-review repair round')
          return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                   reviewVerdict: 'proof-red', notes,
                   tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                   ...examEditedField() }
        }
      }
    }

    // Round-1 advisories, carried into round 2 (2026-09-01, run-47 read): the
    // reviewers re-found the same minor findings every round (three of six
    // named one argv double-parse), spending review turns on items already in
    // the run report that no fix round is asked to act on. Round 2 is told what
    // round 1 already recorded; the report keeps the union, not round 2 alone.
    const priorMinors = []
    for (let iter = 1; iter <= 2; iter++) {
      // ── the `Run:` proofs (#589) ─────────────────────────────────────────
      // Once per review round, not once per task: a fix round is measured by a
      // FRESH execution, so round 2's evidence replaces round 1's rather than
      // re-quoting a run that predates the repair. Same `sh` seam as the
      // run-wide suite (`bash -lc`, SHELL_TIMEOUT_MS), same cwd the implementer
      // just wrote to, same tail-truncation the rest of the evidence uses.
      const runEvidence = await runCommands(iter)
      // The exam, freshly executed for this round on the same terms (#638):
      // round 2 grades the repair, not the tree that predates it.
      const examEvidence = await runExam(iter)
      const checkEvidence = await runChecks(iter)
      const reviewPrompt = roles.reviewer + taskBodyBlock(task, wavesPath) +
        '\nPATCH: ' + impl.patch +
        '\nHEAD: ' + impl.headSha +
        '\nBASE: ' + baseShaForTask + filesLine(task) + siblingsStr +
        globalConstraintsBlock + interfacesLine(task) + priorAdvisoriesBlock(priorMinors) +
        (examEdited && examEdited.length ? '\nEXAM EDITED: ' + examEdited.join(', ') : '') +
        runEvidenceBlock(runEvidence) + examEvidenceBlock(examEvidence) +
        checkEvidenceBlock(checkEvidence)
      const reviewOpts = (pass) => ({
        label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
        model: REVIEWER_MODEL, schema: REVIEWER_SCHEMA,
      })
      let issues, verdicts
      if (isPairReview(taskReviewProfile(task))) {
        // Concurrent (2026-09-01): the pair reads the same patch with the same
        // prompt and neither depends on the other, so they run side by side —
        // run-47 spent 26 of 79 minutes in six serial reviewer calls. The
        // pre-0.3.0 rule that a task pipeline stays single-agent (so peak
        // concurrency equals wave width) is retired here: the bound it
        // protected was the Workflow tool's, not the API's (#454 measured it).
        const [r1, r2] = await Promise.all([timedReview(reviewPrompt, reviewOpts(1)),
                                            timedReview(reviewPrompt, reviewOpts(2))])
        if (r1 === null || r2 === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
        issues = (r1.issues || []).concat(r2.issues || [])
        verdicts = [r1.verdict, r2.verdict]
        // What the SECOND referee added that the first did not: the whole
        // question a pair profile has to answer to justify its second bill.
        pairRounds += 1
        const firstKeys = new Set((r1.issues || []).filter((i) => i && i.severity === 'blocking')
          .map((i) => (i.severity || '') + '|' + (i.detail || '')))
        for (const i of (r2.issues || [])) {
          if (!i || i.severity !== 'blocking') continue
          if (!firstKeys.has((i.severity || '') + '|' + (i.detail || ''))) r2MarginalBlocking += 1
        }
      } else {
        const review = await timedReview(reviewPrompt, reviewOpts())
        if (review === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
        issues = review.issues || []
        verdicts = [review.verdict]
      }
      // Counted here, before the driver mints anything of its own: a Run: or
      // Check: red is the DRIVER's finding, and charging it to the referee
      // would inflate the very ratio this measures.
      for (const i of issues) {
        if (i && i.severity === 'blocking') {
          reviewerBlockingKeys.add((i.severity || '') + '|' + (i.detail || ''))
        }
      }
      const seenIssue = {}
      issues = issues.filter((i) => {
        const key = (i.severity || '') + '|' + (i.detail || '')
        if (seenIssue[key]) return false
        seenIssue[key] = true
        return true
      })
      if (!verdicts.some((v) => v === 'PASS' || v === 'FIX_REQUIRED')) {
        judgmentCalls.push('task ' + task.id + ': reviewer returned no recognizable verdict — ' +
          'treating as FIX_REQUIRED with a blocking issue (never merging on an empty review)')
        issues = issues.concat([{ severity: 'blocking',
          detail: 'review result carried no recognizable verdict — re-review required' }])
      }
      // A red `Run:` command outranks the reviewer's verdict: the Proof is the
      // task's contract, and a referee reading the failing output and saying
      // PASS anyway is exactly the merge this exists to stop. The detail names
      // the command and the exit code because the fix round reads these lines
      // as its instructions.
      for (const r of runEvidence) {
        if (r.exit === 0) continue
        issues = issues.concat([{ severity: 'blocking',
          detail: 'the Proof\'s Run: command failed: ' + r.cmd + ' — exit ' + r.exit }])
        judgmentCalls.push('task ' + task.id + ': Run: proof `' + r.cmd + '` exited ' + r.exit +
          ' in review round ' + iter + ' — blocking, whatever the reviewer returned')
      }
      // A red exam outranks the reviewer's verdict for the same reason a red
      // `Run:` does — and more sharply, since the exam is the submission's own
      // grading. The detail names the command and the exit code because the fix
      // round reads these lines as its instructions.
      if (examEvidence && examEvidence.exit !== 0) {
        issues = issues.concat([{ severity: 'blocking', detail: EXAM_FAIL(examEvidence) }])
        judgmentCalls.push('task ' + task.id + ': the Proof\'s exam `' + examEvidence.cmd +
          '` exited ' + examEvidence.exit + ' in review round ' + iter +
          ' — blocking, whatever the reviewer returned')
      }
      // A red non-minor `Check:` is read exactly as a red `Run:` is: the run
      // declared the constraint, the driver ran it, and the referee's verdict
      // does not get to overrule the exit code. A minor one is a note.
      for (const c of checkEvidence) {
        if (c.exit === 0) continue
        if (c.minor) { noteMinorCheck(c); continue }
        issues = issues.concat([{ severity: 'blocking', detail: CHECK_FAIL(c) }])
        judgmentCalls.push('task ' + task.id + ': Check: `' + c.cmd + '` exited ' + c.exit +
          ' in review round ' + iter + ' — blocking, whatever the reviewer returned')
      }
      // ── who can act on it (actor routing) ────────────────────────────────
      // An issue the implementer cannot fix must not be handed to a fix round:
      // the loop burns two rounds and lands where it started, and the run
      // reports `fix-loop-exhausted` for a defect that was never the patch's.
      // A reviewer names the actor; a reviewer that says `implementer` while
      // its own detail names a plan defect in a file the task was never given
      // is corrected here, because FILES is the driver's fact, not a judgment.
      const taskFiles = Array.isArray(task.files) ? task.files : []
      const routeToPlan = (i) => {
        if (i.actor === 'plan') return true
        const detail = String(i.detail || '')
        if (!detail.startsWith('plan-defect:')) return false
        for (const m of detail.matchAll(/`([^`]+)`/g)) {
          const token = m[1]
          if (token.indexOf('/') === -1 && token.indexOf('.') === -1) continue
          if (taskFiles.indexOf(token) !== -1) continue
          if (!reroutedTokens.has(token)) {
            reroutedTokens.add(token)
            judgmentCalls.push('task ' + task.id + ': plan-defect names `' + token +
              '` outside FILES — routed to the plan')
          }
          return true
        }
        return false
      }
      const blocking = []
      for (const i of issues.filter((i) => i.severity === 'blocking')) {
        if (!routeToPlan(i)) { blocking.push(i); continue }
        const detail = String(i.detail || '')
        if (!planDefects.some((p) => p.task === task.id && p.detail === detail)) {
          planDefects.push({ task: task.id, detail })
        }
      }
      const planNotes = planDefects.filter((p) => p.task === task.id)
        .map((p) => 'plan-defect: ' + p.detail)
      const minors = issues.filter((i) => i.severity === 'minor')
      const patchOf = (i) => (typeof i.proposedPatch === 'string' ? i.proposedPatch : '')
      if (blocking.length > 0) proposedPatches = blocking.filter((b) => patchOf(b) !== '').length
      for (const m of minors) {
        if (!priorMinors.some((p) => p.detail === m.detail)) priorMinors.push(m)
      }
      if (blocking.length === 0) {
        if (verdicts.indexOf('FIX_REQUIRED') !== -1 && planNotes.length === 0) {
          judgmentCalls.push('task ' + task.id +
            ': reviewer said FIX_REQUIRED with no blocking issues — merged on the severity rule')
        }
        return { task: task.id, baseCorrected, status: 'done', branch: '', exam,
                 headSha: impl.headSha, patch: impl.patch,
                 reviewVerdict: iter === 1 ? 'clean' : 'fixed',
                 notes: priorMinors.map((m) => m.detail)
                   .concat(planNotes)
                   .concat(concerns.map((c) => 'concern: ' + c)).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: iter - 1, proposedPatches, proofFixes,
                 ...examEditedField() }
      }
      if (iter === 2) {
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'fix-loop-exhausted', notes: blocking.map((b) => b.detail).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: 1, proposedPatches, proofFixes,
                 ...examEditedField() }
      }
      // Fix round: same tree (isolation routes fix:<id> to the task's clone),
      // prior work is simply the tree's state; capture stays cumulative
      // against the task BASE by construction (withPatchCapture).
      impl = await agent(
        roles.fix + taskBodyBlock(task, wavesPath) + testCmdLine(task, workerTestCmd) +
          filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) +
          '\n\nBlocking issues to resolve:\n' + blocking.map((b) => {
            const patch = patchOf(b)
            return patch === '' ? '- ' + b.detail
              : '- ' + b.detail + '\n' + PROPOSED_PATCH_HEADER + '\n' + patch
          }).join('\n'),
        { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree',
          model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA })
      if (impl === null) throw new Error('AGENT_NULL: fix-round implementer agent returned null (terminal Overloaded or skipped)')
      stripUntrustedPatch(impl, patchPrefix)
      noteConcerns(impl)
      // Same tree, same rule: a fix round applying a referee's findings may
      // find the finding WAS the exam (run-53, #556) — recorded, then re-reviewed.
      await noteDrift('the fix round')
      if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') && !hasCoordinates(impl)) {
        judgmentCalls.push('task ' + task.id + ': fix round lost driver-captured coordinates (' +
          (impl.captureError || 'capture absent') + ') — failed before re-review')
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'lost-coordinates',
                 notes: 'fix round produced no driver-captured patch/headSha',
                 tier: economics.tier, review: economics.review, fixIterations: 1, proposedPatches, proofFixes,
                 ...examEditedField() }
      }
      if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'blocked-after-fix', notes: impl.summary,
                 tier: economics.tier, review: economics.review, fixIterations: 1, proposedPatches, proofFixes,
                 ...examEditedField() }
      }
    }
  }

  async function runTask(task, baseShaForTask, siblingsStr) {
    try {
      return await runTaskInner(task, baseShaForTask, siblingsStr)
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (isInfraFault(msg)) {
        judgmentCalls.push('task ' + task.id + ': infra-death (' + msg +
          ') — parked for one barrier retry (no immediate retry into the live storm)')
        log('task ' + task.id + ' infra-death — parked for barrier retry')
        return { task: task.id, status: 'parked-infra', reviewVerdict: 'agent-error',
                 notes: msg, tier: resolvedModel(task.tier || 'standard'),
                 review: taskReviewProfile(task), fixIterations: 0, proofFixes: 0 }
      }
      const capabilityFixable = isSchemaTrip(msg)
      const retryTier = capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')
      if (looksStructural(msg)) {
        judgmentCalls.push('task ' + task.id + ': agent error looks structural (' + msg +
          ') — looks like a missing dependency edge (the plan\'s Interfaces/Files do not order these tasks); a tier change will not fix it')
      }
      judgmentCalls.push('task ' + task.id + ': agent error at ' + (task.tier || 'standard') +
        ' — retrying once at ' + retryTier +
        (capabilityFixable ? ' (schema trip → escalate)' : ' (same tier)') + ': ' + msg)
      log('task ' + task.id + ' agent error — retrying at ' + retryTier)
      try {
        await resetTaskClone(task.id, baseShaForTask)
        const res = await runTaskInner(task, baseShaForTask, siblingsStr, retryTier)
        judgmentCalls.push('task ' + task.id + ': recovered after ' +
          (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier)
        return res
      } catch (e2) {
        const msg2 = String((e2 && e2.message) || e2)
        judgmentCalls.push('task ' + task.id + ': agent error after ' +
          (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier + ' — ' + msg2)
        log('task ' + task.id + ' FAILED after retry: ' + msg2)
        return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                 notes: msg2, tier: resolvedModel(retryTier),
                 review: taskReviewProfile(task), fixIterations: 0, proofFixes: 0 }
      }
    }
  }

  // ── the fold — driver exec (was: an opus agent typing the CLI string the
  // engine composed). Kernel stdout keys are translated here exactly as the
  // STEP prompts ordered the agent to translate them; the receipts (fold log,
  // conflicts index, this frontier entry) are the record. ────────────────────
  // Resolved relative to the ENGINE, not the target repo: the kernel ships
  // with the checkout that is running this code, and a foreign target repo
  // (any non-self-hosted plan) has no skills/ tree of its own.
  const KERNEL = fileURLToPath(new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url))
  const waveDirOf = (n) => path.join(runDir, 'frontier', 'wave-' + n)

  async function foldWave(merged, waveIdx, waveTasks, prevHead) {
    const waveNumber = waveIdx + 1
    const transcripts = []
    let calls = 0
    let wallSec = 0
    let selfChecks = ''
    let autoResolved = 0
    const runCli = async (argv) => {
      calls += 1
      const t0 = Date.now()
      const r = await exec('python3', [KERNEL, ...argv], { cwd: integ })
      wallSec += (Date.now() - t0) / 1000
      const parsed = parseCliJson(r.stdout)
      if (parsed && typeof parsed.autoResolved === 'number') autoResolved += parsed.autoResolved
      return { ...r, parsed }
    }
    const entry = () => ({
      wave: waveNumber,
      foldLogPath: path.join(waveDirOf(waveNumber), 'fold_log.jsonl'),
      conflictsIndex: path.join(waveDirOf(waveNumber), 'conflicts.json'),
      selfChecks,
      foldCliCalls: calls,
      foldCliWallTimeSec: calls ? wallSec : null,
      autoResolved,
      resolverTranscripts: transcripts,
    })
    const blocked = (reason) => {
      frontier.push(entry())
      judgmentCalls.push('wave ' + waveNumber + ': fold path blocked — ' + reason)
      log('wave ' + waveNumber + ' fold blocked: ' + reason)
      return { status: 'CONFLICT', detail: reason }
    }

    const taskArgs = merged.flatMap((r) => ['--patch', r.task + '=' + r.patch])
    const commutesArgs = waveTasks
      .filter((t) => Array.isArray(t.commutes) && t.commutes.length)
      .flatMap((t) => ['--commutes', t.id + '=' + t.commutes.join(',')])
    const common = ['--repo', '.', '--run-dir', runDir, '--wave', String(waveNumber)]

    const fold = await runCli(['fold', ...common, '--base', prevHead, ...taskArgs, ...commutesArgs])
    if (!fold.parsed) return blocked('fold printed no verdict (exit ' + fold.code + '): ' + tail(fold.stderr, 300))
    const f = fold.parsed
    if (typeof f.selfChecks === 'string') selfChecks = f.selfChecks
    if (typeof f.parked === 'number' && f.parked > 0) {
      return blocked('fold parked ' + f.parked + ' conflict(s) — see the conflicts index')
    }
    if (fold.code !== 0 && !(Array.isArray(f.open) && f.open.length)) {
      return blocked('fold exited ' + fold.code + ': ' + (f.selfChecks || tail(fold.stderr, 300)))
    }
    if (typeof f.conflicts !== 'number') {
      return blocked('fold reported no conflicts count to verify against')
    }
    let outstanding = (Array.isArray(f.open) ? f.open : []).slice()
    if (f.conflicts > 0 && outstanding.length === 0) {
      return blocked('fold counted ' + f.conflicts + ' conflict(s) but named none to resolve')
    }
    const expectOpen = (typeof f.dispatchable === 'number') ? f.dispatchable : f.conflicts
    if (outstanding.length !== expectOpen) {
      return blocked('fold named ' + outstanding.length + ' open conflict(s) but counted ' +
        expectOpen + ' still to resolve')
    }
    if (outstanding.length === 0 && f.complete !== true) {
      return blocked('fold reported no conflicts but did not complete (selfChecks: ' +
        (f.selfChecks || 'absent') + ')')
    }

    // Resolver work list — the loop itself is `resolveConflicts` above; the
    // wave loop supplies its own contending block, reply-directory root and
    // label prefix, and keeps `blocked()` and the frontier entry to itself.
    // The returned transcripts land in this wave's array BEFORE the park, so
    // a reader of `resolverTranscripts` sees what it always saw.
    const contendingBlock =
      '\nCONTENDING TASKS:' + waveTasks.map((t) =>
        '\n- task ' + t.id + ': ' + (t.title || '') +
        ((Array.isArray(t.files) && t.files.length) ? (' [files: ' + t.files.join(', ') + ']') : '')).join('') +
      (wavesPath ? ('\nTheir full verbatim task text lives in the JSON file at ' + wavesPath +
        ' — read the "tasks" array entry whose "id" matches.') : '')
    const resolution = await resolveConflicts({
      agent, runCli, roles, common, taskArgs, commutesArgs,
      open: outstanding, contendingBlock,
      waveDir: waveDirOf(waveNumber),
      labelPrefix: 'resolve:wave' + waveNumber,
    })
    transcripts.push(...resolution.transcripts)
    if (resolution.selfChecks) selfChecks = resolution.selfChecks
    if (!resolution.ok) return blocked(resolution.reason)

    // Materialize → candidate, then the adopt choreography the old ADOPT step
    // ordered in prose: test the candidate with the branch unmoved
    // (read-tree -u --reset), suite, adopt with reset --hard on green. On red,
    // the reconcile JUDGMENT agent (spec §2's named addition — the old patch
    // route had no post-fold suite repair at all): it edits files only, the
    // driver commits and re-runs the suite; cap 2; still red restores prevHead
    // and the wave is TEST_FAILED.
    const subjectArgs = planTitle ? ['--subject', planTitle] : []
    const mat = await runCli(['materialize', ...common, '--prev-head', prevHead,
      ...taskArgs, ...subjectArgs])
    const m = mat.parsed
    if (!m || !m.candidateSha) {
      return blocked('materialize refused: ' + ((m && (m.park || m.fallback)) || tail(mat.stderr, 300)))
    }
    const candidate = m.candidateSha
    // The adopt leg's last kernel call (Tier 1, spec 2026-09-01 §2.1): the
    // weave dir is a sidecar seeded from the head that was ACTUALLY adopted,
    // so it runs after the branch moved and never before. Its refusal costs
    // the next wave its seed and nothing else — a judgment-call note, never a
    // wave status, and never a touch on the fold log.
    const emitWeave = async (headSha) => {
      const r = await runCli(['emit-weave', ...common, '--adopt-head', headSha])
      if (r.code !== 0) judgmentCalls.push('wave ' + waveNumber +
        ': emit-weave failed (exit ' + r.code + ') — weave persistence skipped, fold unaffected')
    }
    await git(['read-tree', '-u', '--reset', candidate + '^{tree}'], integ)
    let suite = await sh(testCmd, integ)
    if (suite.code === 0) {
      await git(['reset', '--hard', candidate], integ)
      await emitWeave(candidate)
      frontier.push(entry())
      return { status: 'MERGED', headSha: candidate,
               suite: { passed: true, output: tail(suite.stdout + suite.stderr) } }
    }
    for (let attempt = 1; attempt <= 2 && suite.code !== 0; attempt++) {
      log('wave ' + waveNumber + ' candidate suite RED — reconcile attempt ' + attempt)
      let rec
      try {
        rec = await agent(
          roles.reconcile + '\nTEST COMMAND: ' + testCmd +
            '\n\nFailing output:\n' + tail(suite.stdout + suite.stderr, 3000),
          { label: 'reconcile:wave' + waveNumber + ':' + attempt,
            model: TIER.mostCapable, schema: RECONCILE_SCHEMA })
      } catch (e) {
        if (String((e && e.message) || e).startsWith('RUN_FATAL')) throw e
        rec = null
      }
      if (!rec || rec.status !== 'FIXED') {
        judgmentCalls.push('wave ' + waveNumber + ': reconcile attempt ' + attempt +
          (rec ? (' reported ' + rec.status + ': ' + (rec.summary || '')) : ' produced no reply'))
        break
      }
      await git(['add', '-A'], integ)
      // A FIXED report over an unchanged tree must not move the branch
      // (review finding 5): there is no fix to adopt, and a flaky suite going
      // green on re-run would otherwise credit an empty commit. "Changed
      // nothing" is two comparisons because the index legitimately differs
      // from HEAD on attempt 1 (it holds the candidate tree from read-tree):
      // no change vs the CANDIDATE means attempt 1 edited nothing; no change
      // vs HEAD means a later attempt edited nothing (and git commit would
      // refuse anyway).
      const vsCandidate = await exec('git', ['diff', '--cached', '--quiet', candidate], { cwd: integ })
      const vsHead = await exec('git', ['diff', '--cached', '--quiet', 'HEAD'], { cwd: integ })
      if (vsCandidate.code === 0 || vsHead.code === 0) {
        judgmentCalls.push('wave ' + waveNumber + ': reconcile reported FIXED but changed nothing — not committing')
        break
      }
      // Titled from the plan like the materialize candidate above (#651): when
      // `planTitle` is set the reconcile commit takes the plan's H1 as its
      // SUBJECT and the wave/attempt line moves down into the body, so a
      // squash-merge of a reconciled wave's head reads the same as a green
      // one's. `git commit -m <a> -m <b>` joins its values as paragraphs. With
      // no title the single `-m` stays and the message is BASE's, unchanged.
      const reconcileLine = 'wave ' + waveNumber + ' reconcile (attempt ' + attempt + ')'
      await git(['commit', '-q',
        ...(planTitle ? ['-m', planTitle] : []), '-m', reconcileLine], integ)
      suite = await sh(testCmd, integ)
    }
    if (suite.code === 0) {
      const headSha = await git(['rev-parse', 'HEAD'], integ)
      // The reconcile commits sit on top of prevHead carrying the candidate
      // tree + fixes: reset --hard is unnecessary (the commit already moved
      // the branch), but assert the tree is clean before declaring MERGED.
      await emitWeave(headSha)
      frontier.push(entry())
      judgmentCalls.push('wave ' + waveNumber + ': candidate adopted after reconcile (' +
        candidate + ' + fixes → ' + headSha + ')')
      return { status: 'MERGED', headSha,
               suite: { passed: true, output: tail(suite.stdout + suite.stderr) } }
    }
    await git(['reset', '--hard', prevHead], integ)
    await exec('git', ['clean', '-fd'], { cwd: integ })
    frontier.push(entry())
    return { status: 'TEST_FAILED',
             detail: 'candidate suite failed after reconcile attempts: ' +
               tail(suite.stdout + suite.stderr, 800) }
  }

  // ── wave loop (ported: chunking, lost sweep, barrier retry, cascade) ───────
  // (waves.js pre-registered every phase up front for the Workflow tool's
  // roadmap API; here phase() appends timestamped events, so an up-front burst
  // would record the run entering every phase at t=0 — review finding 6. Each
  // phase is announced once, when it actually starts.)
  const waveLabel = (w) => 'Wave ' + (w + 1)

  let waveBaseSha = baseSha
  const compositionRows = (waveNumber, tasks) => {
    for (const line of compositionUnpinnedRows(waveNumber, tasks)) judgmentCalls.push(line)
  }

  let lastSuite = null
  for (let w = 0; w < WAVES.length; w++) {
    phase(waveLabel(w))
    noteFailures()
    // Anchor this wave: the capture base advances with the integration head,
    // and every task clone of a LATER wave is re-anchored onto that head (the
    // adopt sha exists only in the integration clone's odb, so fetch it from
    // there first). Wave 1 clones are already at BASE from provisioning.
    //
    // A re-anchor failure is FAIL-CLOSED (review finding 1): a task dispatched
    // into a tree still at the old base yields a patch — diffed against the
    // NEW wave base — whose hunks silently REVERT the prior wave's adopted
    // work, and nothing downstream can tell. The task is failed before any
    // dispatch, exactly like lost-coordinates.
    if (patchBase) patchBase.current = waveBaseSha
    const preFailed = new Set()
    if (w > 0 && waveBaseSha !== baseSha) {
      for (const t of WAVES[w]) {
        const cdir = path.join(clonesDir, 'task-' + t.id)
        try {
          await git(['fetch', '--quiet', '--no-tags', integ, integrationBranch], cdir)
          await git(['checkout', '--quiet', '--detach', waveBaseSha], cdir)
          // The adopted head may have added dependencies wave 1 installed only
          // in its own trees — a stale install here fails the wave-2 suite
          // with a module error looksStructural() would mis-diagnose (review
          // finding 9).
          if (bootstrapCmd) {
            const b = await sh(bootstrapCmd, cdir)
            if (b.code !== 0) {
              judgmentCalls.push('task ' + t.id + ': re-anchor bootstrap failed (exit ' + b.code +
                ') — the suite may be unrunnable in its clone')
            }
          }
        } catch (e) {
          preFailed.add(t.id)
          const detail = 'could not re-anchor its clone at wave base ' + waveBaseSha +
            ' — ' + String((e && e.message) || e)
          judgmentCalls.push('task ' + t.id + ': ' + detail +
            ' — failed closed before dispatch (a patch from a mis-anchored tree would silently revert the prior wave)')
          log('task ' + t.id + ' re-anchor failed — task failed closed')
        }
      }
    }
    const results = []
    for (const id of preFailed) {
      const r = { task: id, status: 'failed', reviewVerdict: 'reanchor-failed',
                  notes: 'clone could not be re-anchored at the wave base — never dispatched',
                  tier: resolvedModel((WAVES[w].find((t) => t.id === id) || {}).tier || 'standard'),
                  review: 'lean', fixIterations: 0, proofFixes: 0 }
      results.push(r); taskResults.push(r)
    }
    for (let off = 0; off < WAVES[w].length; off += CONCURRENCY) {
      noteFailures()
      const chunk = WAVES[w].slice(off, off + CONCURRENCY)
      const runnable = chunk.filter((t) => {
        if (preFailed.has(t.id)) return false // already failed closed at re-anchor
        if (blockedByDep.has(t.id)) {
          unfinished.push(t.id + ': blocked — depends on a failed task')
          log('task ' + t.id + ' skipped: upstream dependency failed')
          return false
        }
        return true
      })
      if (runnable.length === 0) continue
      const chunkResults = await parallel(runnable.map((task) => () =>
        runTask(task, waveBaseSha, siblingLine(task, WAVES[w]))))
      for (const r of chunkResults) { results.push(r); taskResults.push(r) }
      const chunkLost = chunkResults.filter((r) => r && r.status === 'done' && !isMergeable(r))
      for (const r of chunkLost) {
        judgmentCalls.push('task ' + r.task + ': reported done without driver-captured coordinates — treating as failed for dependency blocking')
        r.status = 'failed'
        r.reviewVerdict = 'lost-coordinates'
        r.notes = (r.notes ? r.notes + '; ' : '') + 'done without coordinates — downgraded to failed'
      }
      noteFailures()
    }

    // Infra-death barrier retry (ported): exactly one retry per parked task,
    // at the wave barrier, same tier — barrier position is the backoff.
    const parkedInfra = results.filter((r) => r && r.status === 'parked-infra')
    for (let off = 0; off < parkedInfra.length; off += CONCURRENCY) {
      const pchunk = parkedInfra.slice(off, off + CONCURRENCY)
      log('wave ' + (w + 1) + ' barrier: retrying ' + pchunk.length + ' infra-parked task(s)')
      const retried = await parallel(pchunk.map((p) => () => (async () => {
        const task = WAVES[w].find((t) => t.id === p.task)
        try {
          await resetTaskClone(task.id, waveBaseSha)
          const res = await runTaskInner(task, waveBaseSha, siblingLine(task, WAVES[w]))
          judgmentCalls.push('task ' + task.id + ': parked on infra-death, recovered at the barrier retry')
          return res
        } catch (e2) {
          const msg2 = String((e2 && e2.message) || e2)
          judgmentCalls.push('task ' + task.id + ': barrier retry after infra-death failed — ' + msg2)
          return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                   notes: msg2, tier: p.tier, review: p.review, fixIterations: 0, proofFixes: 0 }
        }
      })()))
      for (let k = 0; k < pchunk.length; k++) {
        const p = pchunk[k], res = retried[k]
        const ri = results.indexOf(p); if (ri !== -1) results[ri] = res
        const ti = taskResults.indexOf(p); if (ti !== -1) taskResults[ti] = res
        if (res.status === 'failed') {
          for (const [a, b] of EDGES) {
            if (a === p.task && results.some((r2) => r2 && r2.task === b)) {
              judgmentCalls.push('task ' + b + ': ran while same-wave dependency ' + a +
                ' was parked and the barrier retry then failed — WaW ordering weakened; the suite gate is the backstop')
            }
          }
        }
      }
      noteFailures()
    }

    const mergeable = results.filter(isMergeable)
    if (mergeable.length === 0) {
      if (!edgesSupplied && results.length > 0) {
        const cascadeDetail = 'no mergeable results and no dependency edges supplied — cascading conservatively'
        blockedWaves.push({ wave: w + 1, detail: cascadeDetail })
        for (let d = w + 1; d < WAVES.length; d++) {
          WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
        }
        waveMerges.push({ wave: w + 1, status: 'SKIPPED', detail: cascadeDetail, branches: [] })
        break
      }
      waveMerges.push({
        wave: w + 1, status: 'SKIPPED',
        detail: 'no mergeable results — every task in this wave failed, was blocked, or lost its coordinates; integration branch untouched',
        branches: [],
      })
      log('wave ' + (w + 1) + ' merge skipped: no mergeable results')
      continue
    }

    const waveTasks = (Array.isArray(WAVES[w]) ? WAVES[w] : [])
      .filter((t) => t && mergeable.some((r) => r.task === t.id))
    compositionRows(w + 1, waveTasks)
    const merge = await foldWave(mergeable, w, waveTasks, waveBaseSha)
    waveMerges.push({
      wave: w + 1,
      status: merge.status,
      headSha: merge.headSha,
      detail: merge.detail,
      branches: mergeable.map((r) => r.task),
    })
    if (merge.status === 'MERGED') {
      waveBaseSha = merge.headSha
      lastSuite = merge.suite
      // The suite just ran in this clone; sweep its cache litter before any
      // integrated `Run:` reads the tree. Once per wave that reaches here, and
      // ahead of the loop — so every proof below sees the same swept tree.
      const swept = sweepCacheDirs(integ)
      appendEvent({ kind: 'driver:integrated-clean', wave: w + 1, removed: swept })
      // ── the integrated `Run:` proofs (#604 (b)+(c)) ────────────────────────
      // Here and nowhere else: the candidate's suite is green, the branch has
      // moved, and the working tree IS the adopted tree. Same `sh` seam as the
      // per-task pass and the suite (`bash -lc`, SHELL_TIMEOUT_MS), same
      // tail-truncation, cwd = the integration clone. Only merged tasks
      // contribute — `waveTasks` is already WAVES[w] narrowed to the mergeable
      // rows, in Proof order within each task.
      for (const t of waveTasks) {
        const cmds = Array.isArray(t.proofRuns)
          ? t.proofRuns.filter((c) => typeof c === 'string' && c.trim() !== '')
          : []
        for (const cmd of cmds) {
          // ULTRA_BASE here is `baseSha`, the sha the integration clone was
          // provisioned at — NOT `waveBaseSha`, which the adopt above has
          // already advanced to this wave's head. A diff against the adopted
          // head is a tautology; the question the integrated pass asks is what
          // the run as a whole changed.
          const r = await sh(cmd, integ, baseEnv(baseSha))
          integratedRuns.push({ task: t.id, cmd, exit: r.code, stdout: tail(r.stdout + r.stderr) })
          appendEvent({ kind: 'driver:integrated-run', task: t.id, cmd, exit: r.code, wave: w + 1 })
          if (r.code === 0) continue
          // A red integrated run is never a deferral: the driver has the
          // answer and it is a defect in the INTEGRATED tree, which is the
          // completeness critic's subject. So it is minted as a typed #474
          // finding and joins review.findings before the report is built —
          // the existing brake then refuses the run with no second code path.
          const detail = 'integrated Run: ' + cmd + ' (task ' + t.id + ') exited ' + r.code +
            ' on the adopted tree'
          integratedFindings.push({ severity: 'blocking', detail })
          judgmentCalls.push(detail + ' — it passed in the task\'s own clone; the fold changed ' +
            'the answer, so the run is BLOCKED whatever the critic returns')
          log('wave ' + (w + 1) + ': ' + detail)
        }
      }
      // The run's standing `Check:` commands on the same adopted tree. A
      // constraint that holds in every clone separately and fails on the fold
      // is invisible to every per-task referee by construction — each one was
      // right about the tree it read — so it can only be caught here.
      for (const c of constraintChecks) {
        const r = await sh(c.cmd, integ, baseEnv(baseSha))
        integratedChecks.push({ cmd: c.cmd, exit: r.code, stdout: tail(r.stdout + r.stderr),
                                minor: c.minor })
        appendEvent({ kind: 'driver:integrated-check', cmd: c.cmd, exit: r.code,
                      minor: c.minor, wave: w + 1 })
        if (r.code === 0) continue
        if (c.minor) {
          judgmentCalls.push('wave ' + (w + 1) + ': the minor Check: `' + c.cmd + '` exited ' +
            r.code + ' on the adopted tree — recorded for the critic, blocking nothing')
          continue
        }
        const detail = 'integrated Check: ' + c.cmd + ' exited ' + r.code + ' on the adopted tree'
        integratedFindings.push({ severity: 'blocking', detail })
        judgmentCalls.push(detail + ' — a Global Constraint the fold broke; the run is BLOCKED ' +
          'whatever the critic returns')
        log('wave ' + (w + 1) + ': ' + detail)
      }
      continue
    }
    blockedWaves.push({ wave: w + 1, detail: merge.detail || merge.status })
    log('wave ' + (w + 1) + ' BLOCKED: ' + (merge.detail || merge.status))
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
    }
    break
  }

  // ── the depth-1 leg (#465) ────────────────────────────────────────────────
  // The gate is the operator's single pre-merge checkpoint, and until this leg
  // it certified against a clone the merge target does not match: the sandbox
  // clone carries full history, `actions/checkout@v4` defaults to fetch-depth
  // 1, and git reports a shallow boundary commit as INTRODUCING EVERY FILE —
  // so `git log -- <path>` returns the tip commit for any path that exists.
  // Run-32 gated green (7/7 checks, 979 tests) and CI went red on exactly that;
  // a human diagnosed and patched it, which is the work the single-gate promise
  // is supposed to absorb. The class is wider than the instance: any test
  // coupled to repository state — history, tags, remotes, tree cleanliness —
  // passes here and fails on main.
  //
  // Cost is one suite pass (~90 s at 16 vCPU), paid only when there is a green
  // adopted tree to re-certify. A red leg becomes a `deferred:manual` item, not
  // a failed `tests` field: the driver's full-clone run really did pass, and a
  // depth-1 degradation can legitimately be correct behaviour in a consumer
  // clone (#465's own reading of `_release_timeline` returning None there). Which
  // it is, is a human judgment — so it reaches the gate as the one ack type that
  // is NOT pre-authorized (run-main's ackDecision), and the run parks on real
  // evidence instead of surprising the operator after the merge.
  //
  // The leg runs BESIDE the completeness critic below (#654, re-shaped on the
  // operator's call 2026-09-05), not ahead of it: neither reads the other's
  // result — the critic's inputs are `lastSuite`, the plan, the contracts and
  // the integrated Run:/Check: evidence, while `shallowSuite` and
  // `shallowDeferred` are consumed further down, after both have settled — so
  // serially the leg's ~90 s was wall clock nobody was waiting on. Its
  // judgment calls land in a local array and are appended in BASE order once
  // both sides are done, so a concurrent run's `judgmentCalls` stay
  // deterministic (leg first, then critic) rather than racing.
  let shallowSuite = null
  let shallowDeferred = null
  const shallowCalls = []
  const runShallowLeg = async () => {
    if (!(args.shallowLeg !== false && waveMerges.some((m) => m && m.status === 'MERGED') &&
          lastSuite && lastSuite.passed)) return
    phase('Depth-1 Leg')
    // Under clonesDir on purpose: it is a full repo copy (plus whatever
    // bootstrapCmd installs), and drive.mjs's evidence pull excludes exactly
    // `run-*/clones` from the tarball — "never the repo itself" is that
    // command's whole rule. A sibling directory would ride home in every bundle.
    const shallowDir = path.join(clonesDir, 'shallow')
    fs.rmSync(shallowDir, { recursive: true, force: true })
    // `file://` is load-bearing: git IGNORES --depth on a plain local path clone
    // (it hardlinks the whole object store), so a path form would silently
    // certify a second full clone and always agree. The path is resolved because
    // a `file://` URL is only a URL when it is absolute (repoDir is resolved for
    // the same reason); clonesDir arrives from the caller unnormalized.
    const cl = await exec('git', ['clone', '--quiet', '--depth', '1', '--branch',
      integrationBranch, 'file://' + path.resolve(integ), shallowDir], { cwd: runDir })
    if (cl.code !== 0) {
      shallowCalls.push('depth-1 leg: cloning ' + integrationBranch + ' at depth 1 failed (' +
        tail(cl.stderr || cl.stdout, 300) + ') — the shallow-clone class is unchecked this run')
    } else {
      if (bootstrapCmd) {
        const b = await sh(bootstrapCmd, shallowDir)
        if (b.code !== 0) {
          shallowCalls.push('depth-1 leg: bootstrap failed in the shallow clone (exit ' + b.code +
            ') — a red leg below may be a missing dependency rather than a history coupling')
        }
      }
      const s = await sh(testCmd, shallowDir)
      shallowSuite = { depth: 1, command: testCmd, passed: s.code === 0,
                       output: tail(s.stdout + s.stderr, 2000) }
      log('depth-1 leg: ' + (shallowSuite.passed ? 'green' : 'RED'))
      if (!shallowSuite.passed) {
        const why = 'the suite passed on the full clone and failed on a depth-1 clone of ' +
          integrationBranch + ' — CI checks out at fetch-depth 1, so the merge target will not ' +
          'reproduce this run\'s green. Either a test is coupled to repository history (fix the ' +
          'test) or the degradation is correct for a shallow consumer (ack it): ' +
          tail(shallowSuite.output, 800)
        shallowCalls.push('depth-1 leg: ' + why)
        shallowDeferred = { deliverable: 'depth-1 clone of ' + integrationBranch,
                            reason: 'manual', why }
      }
    }
  }

  // ── completeness critic — read-only judgment; the driver already ran the
  // suite (per adopted wave) and derives gitVerified below from receipts. ────
  const taskList = WAVES.flat().map((t) => t.id + ': ' + (t.title || '')).join('\n')
  const waveMergedAny = waveMerges.some((m) => m && m.status === 'MERGED')
  // criticRan gates gitVerified below (review finding 2): waves.js's critic
  // attestation made a dead critic fail-closed at the gate, and receipts alone
  // cannot preserve that — clean receipts say the merge is intact, not that
  // anyone reviewed its completeness.
  let criticRan = false
  let review
  const criticCalls = []
  const runCritic = async () => {
    phase('Integration Review')
    if (!waveMergedAny) {
      // Nothing merged: the tree is at BASE, and a critic told it holds "the
      // final integrated tree" would emit confident findings about the wrong
      // tree (review finding 8). gitVerified is already false on this path.
      review = { findings: [{ severity: 'blocking',
                             detail: 'no wave merged — completeness review skipped (the tree is at BASE)' }],
                 deferredVerification: [] }
      return
    }
    try {
      review = await agent(
        roles.critic +
          (planPath ? ('\nPLAN: read the original plan document at ' + planPath + ' first.') : '') +
          globalConstraintsBlock +
          '\n\nTasks:\n' + taskList +
          contractsBlock(WAVES, EDGES, wavesPath) +
          '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
          suiteLine(lastSuite, testCmd) +
          (baseline.passed === false
            ? '\nBaseline: the test suite failed before any task ran — ' + tail(baseline.output, 500)
            : '') +
          integratedRunEvidenceBlock(integratedRuns) +
          integratedCheckEvidenceBlock(integratedChecks),
        { label: 'integration', model: REVIEWER_MODEL, schema: CRITIC_SCHEMA })
    } catch (e) {
      const msg = String((e && e.message) || e)
      criticCalls.push('integration review failed to run: ' + msg)
      review = null
    }
    if (review && typeof review === 'object') {
      criticRan = true
    } else {
      criticCalls.push('integration review returned no result — the completeness critic died; gitVerified is withheld (fail-closed, as the old attestation path was)')
      review = { findings: [{ severity: 'blocking',
                             detail: 'integration review did not run — completeness unverified; check the tree before merging' }],
                 deferredVerification: [] }
    }
  }

  // Started together, both awaited here — every line below reads one side's
  // result or the other's, so this is the barrier and there is no other. Plain
  // `Promise.all`, not the `parallel` seam: run-main hands the engine
  // `boundedParallel(WIDTH)`, and at WIDTH 1 that seam would quietly serialize
  // these two again and put the leg back on the critical path.
  await Promise.all([runShallowLeg(), runCritic()])
  judgmentCalls.push(...shallowCalls, ...criticCalls)

  // A red integrated `Run:` proof outranks whatever the critic returned, and it
  // is folded into the SAME list the #474 brake already reads — appended after
  // the critic so it survives a critic that died and was replaced above.
  if (integratedFindings.length) {
    review.findings = (Array.isArray(review.findings) ? review.findings : []).concat(integratedFindings)
  }

  // Driver detach: releases the integration branch in the clone. Nothing on
  // the driver path needs the branch checked out from here on (the fetch
  // bridge reads refs, the gate operates on the repo checkout).
  try { await git(['checkout', '-q', '--detach'], integ) } catch { /* non-fatal */ }

  // ── driver-derived verification (spec §3.1: gitVerified is REDEFINED and
  // disclosed) — the branch tip must equal the last adopt receipt, and every
  // task reported merged must appear as a fold event in its wave's fold log.
  // The old meaning (the critic's own attestation) cannot exist when the
  // critic no longer detaches; this is the receipt-based equivalent of #70. ──
  const ancestryMisses = []
  for (const wm of waveMerges) {
    if (wm.status !== 'MERGED') continue
    let foldedIds = new Set()
    try {
      const logLines = fs.readFileSync(path.join(waveDirOf(wm.wave), 'fold_log.jsonl'), 'utf8')
      for (const line of logLines.split('\n')) {
        if (!line.trim()) continue
        try {
          const e = JSON.parse(line)
          if (e.type === 'fold') foldedIds.add(e.task)
        } catch { /* not a record */ }
      }
    } catch { /* missing log = every task misses below */ }
    for (const t of wm.branches) {
      if (!foldedIds.has(t)) ancestryMisses.push({ task: t, headSha: '(no fold event in wave ' + wm.wave + ' log)' })
    }
  }
  let tipSha = ''
  try { tipSha = await git(['rev-parse', integrationBranch], integ) } catch { /* no branch tip */ }
  const lastMerged = waveMerges.filter((m) => m.status === 'MERGED').pop()
  const tipMatches = !!(lastMerged && lastMerged.headSha && tipSha === lastMerged.headSha)
  if (lastMerged && !tipMatches) {
    judgmentCalls.push('integration branch tip ' + tipSha + ' does not equal the last adopt receipt ' +
      lastMerged.headSha + ' — gitVerified withheld')
  }
  for (const m of ancestryMisses) {
    judgmentCalls.push('integration ancestry miss (#70, receipt-based): task ' + m.task +
      ' reported merged but ' + m.headSha + ' — silently dropped; the run is BLOCKED, do not merge')
  }
  const anyWaveMerged = waveMergedAny
  // gitVerified = receipts intact AND the completeness review actually ran
  // (spec §3.1's redefinition, plus review finding 2's fail-closed condition).
  const gitVerified = anyWaveMerged && tipMatches && ancestryMisses.length === 0 && criticRan
  // A plan defect is verification the RUN cannot do: no fix round can close it
  // and no referee can wave it through, so it travels to the one reader with
  // the standing to change the plan. Only tasks that finished `done` carry one
  // — a failed task is already accounted under missingDeliverables, and a
  // deferral for work that never merged asks the gate to acknowledge nothing.
  // `gate_check.py` types these `deferred:plan-defect`, which `ackDecision`
  // does not pre-authorize: the operator reads it or the run does not merge.
  const doneTaskIds = new Set(taskResults.filter((r) => r && r.status === 'done').map((r) => r.task))
  const planDeferred = []
  for (const p of planDefects) {
    if (!doneTaskIds.has(p.task)) continue
    planDeferred.push({ deliverable: p.task, reason: 'plan-defect', why: p.detail })
    judgmentCalls.push('task ' + p.task + ': plan-defect deferred to the gate — ' + p.detail)
  }
  const deferredVerification = (Array.isArray(review.deferredVerification)
    ? review.deferredVerification : [])
    .concat(shallowDeferred ? [shallowDeferred] : [])
    .concat(planDeferred)

  // tests: the DRIVER's own suite run on the adopted tree (was: the critic's).
  const tests = lastSuite
    ? { command: testCmd, passed: lastSuite.passed, output: lastSuite.output }
    : { command: testCmd, passed: false, output: 'not run — no wave merged' }

  let acceptance = null
  if (ACCEPTANCE && ACCEPTANCE.mode === 'waived') {
    acceptance = { mode: 'waived', reason: String(ACCEPTANCE.reason || ''), passed: null }
  } else if (ACCEPTANCE && ACCEPTANCE.mode === 'suite') {
    acceptance = { mode: 'suite', passed: tests.passed, reason: String(ACCEPTANCE.reason || '') }
    if (!acceptance.passed) judgmentCalls.push(
      'suite acceptance did not pass (committed test suite failed) — gate must not Approve')
  } else if (ACCEPTANCE && ACCEPTANCE.mode === 'sealed') {
    acceptance = { mode: 'sealed', sealId: ACCEPTANCE.sealId, sha256: ACCEPTANCE.sha256,
                   status: 'PENDING_GATE', passed: null,
                   note: 'administered deterministically at the pre-merge gate' }
  }

  const mergedBranches = new Set()
  for (const wm of waveMerges) if (wm && wm.status === 'MERGED') for (const b of (wm.branches || [])) mergedBranches.add(b)
  const tasksPlanned = WAVES.flat().length
  const coverage = { tasks_merged: mergedBranches.size, tasks_planned: tasksPlanned,
                     complete: mergedBranches.size >= tasksPlanned }
  const failedIds = taskResults.filter((t) => t.status === 'failed').map((t) => t.task)
  const blockedIds = unfinished
    .map((u) => (typeof u === 'string' ? u.split(/[:\s]/)[0] : (u && u.task)))
    .filter(Boolean)
  const missingIds = [...new Set([...failedIds, ...blockedIds])]
  const missingDeliverables = missingIds
    .map((id) => ({ task: id, files: ((WAVES.flat().find((t) => t.id === id) || {}).files) || [] }))
    .filter((m) => m.files.length)

  return {
    integrationBranch,
    baseSha,
    waves: WAVES.map((w) => w.map((t) => t.id)),
    dependencyEdges,
    tasks: taskResults,
    tests,
    // #604: the driver's own re-execution of every merged task's `Run:` proofs
    // on the tree each wave adopted — [] when no merged task carried one.
    integratedRuns,
    // The Global Constraints `Check:` commands on the same adopted tree —
    // `{ cmd, exit, stdout, minor }`, [] when the run declared none.
    integratedChecks,
    // What a reviewer-minute bought (#623 follow-on): the wall clock every
    // `review:` call cost, individually, against the blocking findings the
    // referees actually returned.
    reviewEconomy: {
      reviewerMs,
      blockingFindings: reviewerBlockingKeys.size,
      blockingPerReviewerMinute: reviewerMs > 0
        ? reviewerBlockingKeys.size / (reviewerMs / 60000) : 0,
      pairRounds,
      r2MarginalBlocking,
    },
    shallowSuite,
    acceptance,
    baseline,
    waveMerges,
    frontier,
    coverage,
    missingDeliverables,
    gitVerified,
    ancestryMisses,
    deferredVerification,
    judgmentCalls,
    unfinished,
    completenessFindings: review.findings || [],
    blockedWaves,
  }
}
