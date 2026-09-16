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
// schema trip, the infra-death re-dispatch, the fix-loop cap of 2, the
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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// The state handshake's fact carries a `sha256` over the post's canonical JSON
// (#998 ticket 5): the record says WHICH state a task reached, not only that it
// reached one, and a digest is what makes two readings of one post comparable.
import { createHash } from 'node:crypto'
// The run's event log lives in run-waves.mjs; the engine borrows its ULID
// stamp so the driver's own records sort with the worker envelopes rather
// than beside them (readers order by id, never by line — run-waves.mjs).
// `cloneAtBase` and `patchAgainstBase` come from there too: the examiner's
// clone is cut at dispatch time (only the engine knows which tasks have an
// exam), and the implementer's capture is retaken after the handoff.
import { ulid, cloneAtBase, patchAgainstBase } from './run-waves.mjs'
// Which head a dispatch's capture is diffed against travels with the dispatch
// and not in a variable the whole run shares — see `captureAnchors` below: the
// ready set keeps two dispatches in flight against different heads, and async
// context is what lets one seam answer both of them correctly.
import { AsyncLocalStorage } from 'node:async_hooks'
// A red suite's output is quoted, not tailed (#763 part 2): every reader below
// who is handed a failing suite's text — a judgment call, the reconcile
// agent's brief, a blocked wave's detail — gets the failing
// test's own block, so the assertion that named the failing leg survives however
// long the trailing summary runs. `tail` stays for everything that is not a red
// suite: git and fold stderr, bootstrap failures, and the Run:/Check:/exam
// evidence records. The record itself is untouched — the whole output is still
// on disk beside the excerpt.
import { failingBlock } from './failing-block.mjs'
// Where a peer's exam lands (#777). The Proof names the path the exam is
// written FOR; the reserved directory under the matching test root is where the
// run writes it TO, so the integration branch keeps the run's measurements out
// of the project's own test paths. One module, because the engine, the
// examiner's prompt and `fleet/strip-exams.sh` all have to agree on the slug.
import { examSlug, reservedExamPath } from './exam-paths.mjs'
// The reading a run that changed the engine leaves behind (#992): which of the
// lines it changed an engine sim reached. Taken once, after the last fold, and
// read by nothing below — see the call site beside `coverage`.
import { engineCoverage } from './engine-coverage.mjs'

// ── which tests went red (#871 decisions 1 and 4) ────────────────────────────
// `failingBlock` above answers "what does the failure read like"; this answers
// "which files failed", because a fold has one more question to ask of a red
// candidate: did any task of this epoch name the path that went red?
// The source is pytest's short summary — one `FAILED <path>::<id>` line per
// failure — and the one shape that lies about its path is the fleet bridge:
// every node sim runs as `tests/test_fleet_suite.py::test_fleet_mjs[<id>]`,
// whose `<id>` is the sim's name under `fleet/tests/` (`test_x.mjs`, or
// `exams/<slug>/test_x.mjs` for a run's own exam — `tests/test_fleet_suite.py`
// itself names no task's file). So a bridged line is translated back to the
// path a plan would have written, and every other line is taken as it reads.
const FAILED_LINE = /^FAILED\s+(\S+?)::(\S*)/
const BRIDGE_FILE = 'tests/test_fleet_suite.py'
const BRIDGE_ID = /\[([^\]]+\.mjs)\]/

/**
 * The test paths a suite output reports as failing, in order, deduplicated.
 *
 *   output  a suite's stdout+stderr, whatever shape printed it
 *
 * Returns `[]` for an output carrying no `FAILED <path>::<id>` line — a bare
 * non-zero exit, an install that died before pytest ran, a green run.
 */
export function failingTestPaths (output) {
  const paths = []
  for (const raw of String(output ?? '').split('\n')) {
    const m = FAILED_LINE.exec(raw.trim())
    if (!m) continue
    let p = m[1]
    if (p === BRIDGE_FILE) {
      const id = BRIDGE_ID.exec(m[2])
      if (id) p = 'fleet/tests/' + id[1]
    }
    if (!paths.includes(p)) paths.push(p)
  }
  return paths
}

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
// engine-minted infra marker and parks for its one re-dispatch — never free-text
// match Overloaded (agent() returns null rather than throwing overload text).
export const isSchemaTrip = (msg) =>
  /schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i.test(msg)
export const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
export const isInfraFault = (msg) => String(msg).startsWith('AGENT_NULL')

// ── the infra backoff (#830) ─────────────────────────────────────────────────
// How long the engine waits between a judgment call's `null` reply and its one
// re-dispatch. A `null` is a retries-exhausted death, not a first blip: the
// worker's classify() mints it from an envelope whose `api_error_status` is one
// of INFRA_STATUSES, and the CLI only writes that envelope after its own ten
// fast attempts have failed. So the engine's re-dispatch is a second, COARSER
// tier — a full minute later, long enough that the storm the CLI's seconds-scale
// backoff sat through has had time to pass — rather than a faster copy of a
// retry that already ran. `args.infraBackoffMs` overrides it per run (the sims
// pass 0); anything that is not a finite number ≥ 0 leaves this value standing.
export const INFRA_BACKOFF_MS = 60000

// ── the worker's raised hand (#810 Phase A) ──────────────────────────────────
// A kata worker says it is stuck by writing its OWN issue's `work.attention`;
// while that worker runs the value is the worker's alone and the coordinator
// only READS it (kata's orchestration recipe). The driver writes it at exactly
// two instants outside any worker's life: `kataLanded` clears the SessionEnd
// hook's stamp off a result it has taken, and `openKataTask` clears an EARLIER
// run's mark off an issue this run is about to work. So while a worker runs the
// engine polls that task's issue metadata on this interval and records what it
// finds, and what it finds is this run's own hand and nobody else's. Fifteen
// seconds is the resting cadence: a hand raised mid-worker reaches the record
// and the page well inside the minute an operator takes to look, and a run of
// twenty tasks still costs the hub four reads a minute per running worker.
// `args.attentionPollMs` overrides it per run (the sims pass 50); anything that
// is not a finite number > 0 leaves this value standing.
export const ATTENTION_POLL_MS = 15000
/** The three readings kata's `work.attention` is allowed to carry. Anything
 *  else — a typo, a value a later kata adds — is no reading at all: it records
 *  nothing and leaves the last reading standing. */
export const ATTENTION_VALUES = Object.freeze(['ok', 'needs-human', 'stuck'])
/**
 * Who moved `work.attention`, as the client exposes it — `''` when it exposes
 * nobody. kata's metadata_updated event carries the actor, but `getIssue` is a
 * projection of the ISSUE, so which of these spellings (if any) reaches the
 * engine depends on what the client hands back. The engine records the first
 * one it finds and never invents a name: an unattributed hand is `''`, not the
 * driver's own actor.
 */
export const attentionActorOf = (issue) => {
  const doc = (issue && typeof issue === 'object') ? issue : {}
  const meta = (doc.metadata && typeof doc.metadata === 'object') ? doc.metadata : {}
  const work = (meta.work && typeof meta.work === 'object') ? meta.work : {}
  const event = ['metadata_updated', 'last_event', 'event']
    .map((k) => doc[k])
    .find((v) => v && typeof v === 'object') || {}
  for (const candidate of [work.attention_actor, work.actor, meta.attention_actor,
                           meta.actor, event.actor, doc.attention_actor, doc.actor,
                           doc.metadata_actor, doc.updated_by, doc.last_actor]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return ''
}
/**
 * What an issue's metadata says about `work.attention`, in the one shape both
 * readers want — the poll's timer, and Setup's clear of a prior run's mark.
 *
 * kata stores `kata meta set <ref> work.attention …` as the FLAT key
 * `"work.attention"` (measured on the hub 2026-09-13: `show --json` answers
 * `{"work.attention": "stuck", "work.attention_msg": "…"}`), so the flat key is
 * the reading; a nested `work` object is the fallback for a client that expands
 * dotted keys. An absent, null or empty value reads `ok` — a resting worker is
 * the state every task starts in — and a metadata carrying no message reads
 * `''`, never `undefined`, because both readers put this straight on an event.
 */
export const attentionReadingOf = (issue) => {
  const doc = (issue && typeof issue === 'object') ? issue : {}
  const meta = (doc.metadata && typeof doc.metadata === 'object') ? doc.metadata : {}
  const nested = (meta.work && typeof meta.work === 'object') ? meta.work : {}
  const pick = (flat, key) => (meta[flat] !== undefined ? meta[flat] : nested[key])
  const raw = pick('work.attention', 'attention')
  const msg = pick('work.attention_msg', 'attention_msg')
  return {
    value: (raw === undefined || raw === null || raw === '') ? 'ok' : String(raw),
    msg: (msg === undefined || msg === null) ? '' : String(msg),
  }
}

// #825 — does this set of changed paths change what the project installs? The
// names are `derive_bootstrap_cmd`'s ladder (skills/ultrapowers/scripts/
// ultra_run.py) plus `pytest.ini` and the `requirements*.txt` glob: if the
// bootstrap would read a file, a fold that touched it invalidates the install
// the setup loop made at BASE. BASENAME at any depth — the TinyApp case was
// `client/package.json`, not a root manifest — and the whole basename, so
// `package.json.bak` and `requirements.md` are not manifests.
const BOOTSTRAP_MANIFESTS = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'uv.lock', 'pyproject.toml', 'pytest.ini',
])
const REQUIREMENTS_TXT = /^requirements.*\.txt$/
export const bootstrapManifestChanged = (paths) =>
  (Array.isArray(paths) ? paths : []).some((p) => {
    const base = String(p == null ? '' : p).split('/').pop()
    return BOOTSTRAP_MANIFESTS.has(base) || REQUIREMENTS_TXT.test(base)
  })

// waves.js chunked each wave and re-checked dependencies at the chunk
// boundaries; the scheduler below has no chunks and no barrier, so the width
// bound is the lane count it asks `parallel` for (`args.width`) and the
// dependency re-check is the readiness test every lane makes before every
// dispatch.

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
    // #990 — what the worker changed about what the plan asked for, as a typed
    // row rather than a sentence buried in `concerns`. `amends` (not `kind`:
    // `kind` is every event's own type field) is one of three: `files` for an
    // edit taken outside FILES, `clause` for a Machine clause or Context
    // sentence read otherwise than as written, `sim` for a sim outside FILES
    // re-aimed. Optional — `required` is unchanged, so a reply that amended
    // nothing is the reply it always was.
    amendments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['amends', 'what', 'why'],
        properties: {
          amends: { enum: ['clause', 'files', 'sim'] },
          what: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
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
// with fleet/roles/reviewer.md and fleet/roles/fix.md, and kept here as that
// one spelling; since #964 Task 2 no dispatch in this file renders it, because
// the one review round dispatches no fix worker of its own — a referee's patch
// is counted in `proposedPatches` and read by a person.
export const PROPOSED_PATCH_HEADER =
  'PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):'
// One severity vocabulary for the whole run (#474): the per-task reviewer
// grades defects on a two-word scale, spelled here exactly once. Since #964
// Task 2 the reviewer is the only judge left that uses it, and the driver's
// own integrated findings are minted against the same two words.
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
// ── role prompt files (spec §4: one copy, nothing to bake) ───────────────────
export const defaultRolesDir = () => fileURLToPath(new URL('./roles', import.meta.url))
export function loadRoles(rolesDir = defaultRolesDir()) {
  const roles = {}
  // Six, all hard: no wave can be dispatched without them. The examiner
  // (#553) was soft-gated on its file's presence until 2026-09-02 — a toggle
  // the committed suite made unreachable (#567), and one more branch per task.
  // The seventh was the completeness critic, retired with its role file (#964
  // Task 2): no one reads the finished run but the gate.
  for (const name of ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'examiner']) {
    roles[name] = fs.readFileSync(path.join(rolesDir, name + '.md'), 'utf8')
  }
  return roles
}

// ── prompt input lines (waves.js parity — same vocabulary, plans unchanged) ──
const testCmdLine = (task, testCmd) => {
  const cmd = (task && typeof task.testCmd === 'string' && task.testCmd.trim()) || testCmd
  return cmd ? ('\nTEST COMMAND: ' + cmd) : ''
}
// The implementer's and fix round's proofs (#515, #547, #872). A graded worker
// is handed the commands its OWN task is measured by — the Proof's `Run:`
// lines and the run's Global Constraints `Check:` lines, verbatim and in plan
// order — and not the run-wide suite. Two reasons, and neither is taste.
//
// The suite was never the signal. Since #653 a peer-reviewed task's own command
// is its exam, written by a PEER in the peer's own clone and reaching the graded
// tree only at the driver's handoff, so the implementer cannot run it and was
// handed the whole suite instead. That suite is red for a hundred reasons the
// task does not own and green for none it does: run-67's and run-124's
// implementers each spent 10 to 16 of their 15 to 25 minutes on a serial
// full-suite pass that found zero red proofs. The commands below are the ones
// the driver will actually execute on the returned tree, so a worker that runs
// them is iterating against its own grade.
//
// And the suite was what made the machine scarce: WIDTH implementers each
// running `-n auto` concurrently needed the vCPU divided among them, which is
// why the driver capped the shared command and why the cap capped everyone to
// a serial pytest. Nobody shares a command here, so nothing needs dividing.
//
// A task with no `Run:` in a run with no `Check:` has nothing to iterate
// against; it is told so, rather than handed an empty heading it might read as
// a missing input.
const PROOFS_NONE = '(none — the driver runs the exam at handoff)'
const proofsBlock = (runs, checks) => {
  const lines = [
    ...(Array.isArray(runs) ? runs : [])
      .filter((c) => typeof c === 'string' && c.trim() !== '')
      .map((c) => '- Run: ' + c),
    ...(Array.isArray(checks) ? checks : [])
      .filter((c) => c && typeof c.cmd === 'string' && c.cmd.trim() !== '')
      .map((c) => '- Check: ' + c.cmd),
  ]
  return '\nPROOFS:\n' + (lines.length ? lines.join('\n') : PROOFS_NONE)
}
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
// Review depth (#556): `peer` is the documented value for the deeper profile —
// it names the shape, not an attitude toward the author. `adversarial` is the
// legacy spelling of the same profile and stays accepted; anything else is
// lean. Since #964 Task 2 the two profiles buy the same ONE reviewer per round
// — `peer` still means the patch is reviewed and `lean` still means it is not
// reviewed by a PAIR — so this predicate is the vocabulary check and the
// report's record of what the plan asked for, not a dispatch fork.
export const isPairReview = (profile) => profile === 'peer' || profile === 'adversarial'
// Round-1 minor findings, rendered for the round-2 reviewer (see the review
// loop). Exported for the unit pin, as runEvidenceBlock is.
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
// ── the receipt a red row carries (#810 rules 1 and 4) ──────────────────────
// A red exam and a resolver miss were the two places the run's record said
// THAT something failed without saying what it was about or what the driver
// read. The receipt is the missing half, and its shape is one literal every
// kind that carries one agrees on: `paths`, repo-relative, sorted and
// de-duplicated, and `evidence` — `read`, what the driver saw, and `against`,
// what it read it against. Both strings are bounded, so a record stays
// legible however long a failing test's last line runs and a whole run's
// receipts stay under any reader's budget.
const RECEIPT_CHARS = 500
const cutToBound = (s) => {
  const str = String(s == null ? '' : s)
  return str.length > RECEIPT_CHARS ? (str.slice(0, RECEIPT_CHARS - 1) + '…') : str
}
// The one line of the output tail worth carrying: a runner prints its verdict
// last, and trailing blank lines are the shape of every harness's output.
const lastNonEmptyLine = (out) => {
  const lines = String(out == null ? '' : out).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line) return line
  }
  return ''
}
// Pure and exported: the proof-runs sim pins this shape without standing a run
// up, and a later task that reads the receipt off a repaired task's log can
// name what it waits on. `null` on a green exit is what keeps a green
// `driver:exam-run` row byte-identical to the one it carried before this
// existed — the caller spreads the answer, so `null` adds no key at all.
export const examReceiptOf = ({ cmd, exit, stdout, headSha, landings, files } = {}) => {
  if (Number(exit) === 0) return null
  const paths = [...new Set(
    [...(Array.isArray(landings) ? landings : []), ...(Array.isArray(files) ? files : [])]
      .map(String).filter(Boolean))].sort()
  const line = lastNonEmptyLine(stdout)
  return {
    paths,
    evidence: {
      read: cutToBound('exit ' + exit + (line ? (': ' + line) : '')),
      against: cutToBound(String(cmd == null ? '' : cmd) + ' at ' +
                          String(headSha == null ? '' : headSha)),
    },
  }
}
// The same literal for the resolver's miss: the one path the conflict was
// about, the status the reply carried and the notes it gave for it, read
// against the hunks file the resolver was briefed on.
const resolverReceiptOf = (conflict, status, notes) => {
  const note = String(notes == null ? '' : notes).trim()
  return {
    paths: [String((conflict && conflict.path) || '')],
    evidence: {
      read: cutToBound(String(status) + (note ? (': ' + note) : '')),
      against: cutToBound(String((conflict && conflict.path) || '') + ' at ' +
                          String((conflict && conflict.hunksFile) || '')),
    },
  }
}
// #908 — what the fix round SAID about that red. `fleet/roles/fix.md` tells a
// round that finds a Proof `Test:` file red for a reason other than the missing
// implementation to report it as a `concerns` entry prefixed `exam:` rather
// than edit around it; when the exam is still red on the second pre-review pass
// and such an entry is on the reply, the driver spends a review round on it
// instead of parking `proof-red`. These lines are how the claim reaches the
// referee — one per entry, verbatim, rendered AFTER the EXAM EVIDENCE block so
// the referee reads the driver's own red output first and the claim about it
// second. No entries renders nothing at all, which keeps the prompt of every
// other task byte-identical to the one it had before this existed.
export const examConcernBlock = (concerns) => {
  if (!Array.isArray(concerns) || concerns.length === 0) return ''
  return '\n\n' + concerns.map((c) => 'EXAM CONCERN: ' + String(c)).join('\n')
}
// #990 — what the worker SAID it diverged on. An amendment entry is
// `{amends: 'clause'|'files'|'sim', what, why}` on the worker's reply: the one
// place a compelled divergence — an edit outside FILES, a clause read
// otherwise, a sim re-aimed — is declared rather than discovered. Rendered for
// the referee so the divergence arrives as a declaration to JUDGE rather than
// as an anomaly in the diff to undo (run-2's compelled out-of-Files edit,
// reverted by a fix round that never saw why it was made). No entries renders
// nothing at all, which keeps the prompt of every task that declared none
// byte-identical to the one it had before this existed.
export const amendmentBlock = (amendments) => {
  if (!Array.isArray(amendments) || amendments.length === 0) return ''
  return '\n\nAMENDMENTS:' + amendments
    .map((a) => '\n- ' + String(a && a.amends) + ': ' + String(a && a.what) +
      ' — ' + String(a && a.why))
    .join('')
}
// The entries of one reply, defensively: a worker that declared none, or typed
// the key as something other than an array, contributes nothing.
const amendmentsOf = (reply) =>
  (reply && Array.isArray(reply.amendments)) ? reply.amendments : []
// ── the state-exam record (spec 2026-09-09 §3.5, §3.6) ──────────────────────
// A state exam is an exam that measures a running app's STATE — the store diff
// it produced, whether the render happened, whether a mutant of the expected
// state is actually killed — and it writes what it measured under the run
// directory rather than printing it. The driver never runs that helper: it
// hands the exam the four `ULTRA_*` variables that tell it which task it is,
// which run directory to write under and which pass it is, and reads back what
// landed. Everything below is a pure function of the directory tree, so the
// report row and the reviewer's block are one read, spelled once.
const readJsonOrNull = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}
// One row per state-exam STEM under `<runDir>/state-exams/task-<id>/`, read at
// the stem's highest numeric pass. The directory name is `<stem>-<pass>` split
// at its LAST `-` (a stem may carry dashes of its own); `base` — the probe's
// pass, taken on a tree that predates the patch — and any other non-numeric
// suffix are excluded from the ranking, so a stem whose only directory is
// `-base` yields no row at all. A directory whose JSON is missing or
// unparsable yields `null` in the fields it could not supply rather than
// taking the report down: this is evidence, not control flow.
// `mutant_path` rides along for the reviewer's block; `stateExamsOf` drops it,
// because the report row's shape is the spec's eight keys exactly.
const stateExamRowsOf = (runDir, taskId) => {
  const dir = path.join(String(runDir || ''), 'state-exams', 'task-' + String(taskId))
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch { return [] }
  const best = new Map()
  for (const e of entries) {
    const cut = e.name.lastIndexOf('-')
    if (cut <= 0) continue
    const stem = e.name.slice(0, cut)
    const pass = e.name.slice(cut + 1)
    if (!/^[0-9]+$/.test(pass)) continue
    const n = Number(pass)
    const prev = best.get(stem)
    if (!prev || n > prev.pass) best.set(stem, { pass: n, dir: path.join(dir, e.name) })
  }
  return [...best.keys()].sort().map((stem) => {
    const d = best.get(stem).dir
    const walls = readJsonOrNull(path.join(d, 'walls.json'))
    const mutant = readJsonOrNull(path.join(d, 'mutant.json'))
    const contract = readJsonOrNull(path.join(d, 'contract.json'))
    const render = (walls && typeof walls.render === 'string') ? walls.render : null
    return {
      exam: stem,
      store_ms: (walls && walls.store_ms !== undefined) ? walls.store_ms : null,
      // The render wall is only a reading when the render actually ran; a
      // skipped render has no duration to report, whatever the file carries.
      render_ms: (render === 'ran' && walls && walls.render_ms !== undefined)
        ? walls.render_ms : null,
      render,
      // The action wall and whether the browser ran — both written by the
      // fixture since run-7 (#834) and both dropped on the floor until now. A
      // callback exam has no interaction to time, so `action_ms` is legitimately
      // `null` in the file; anything that is not a number (a string reading, a
      // key the pre-#834 shape never wrote) is `null` here too, because the
      // report row carries readings, not whatever the file happened to hold.
      action_ms: (walls && typeof walls.action_ms === 'number') ? walls.action_ms : null,
      browser: (walls && (walls.browser === 'ran' || walls.browser === 'skipped'))
        ? walls.browser : null,
      mutant_killed: (mutant && typeof mutant.killed === 'boolean') ? mutant.killed : null,
      contract: contract && contract.breach !== undefined
        ? (contract.breach === null ? 'ok' : String(contract.breach))
        : null,
      mutant_path: (mutant && typeof mutant.path === 'string') ? mutant.path : '',
    }
  })
}
// The `Produces:` contract: the report row, eight keys, one element per stem.
export function stateExamsOf(runDir, taskId) {
  return stateExamRowsOf(runDir, taskId).map(
    ({ exam, store_ms, render_ms, render, action_ms, browser, mutant_killed, contract }) =>
      ({ exam, store_ms, render_ms, render, action_ms, browser, mutant_killed, contract }))
}
// The reviewer's own reading of that record — a driver block appended to the
// reviewer prompt, per task, never a role-file edit. A killed mutant is the
// driver's own proof that the exam would have caught a wrong state, which is
// exactly what duty 5 asks a reviewer to establish by hand — so the reviewer
// is told it is settled FOR THAT FILE and for nothing else. Anything short of every mutant killed renders nothing at
// all (the run-51 rule), so a task with no record carries the prompt it had
// before this existed, byte for byte.
// "Every mutant killed", spelled once. Two readers ask it of the same rows —
// the reviewer's settled block below and the skipped reviewer of the review
// round — and they have to mean the same thing by it: a record with no rows is
// not an answer, and one row short of `true` (a survivor, or a `mutant.json`
// that was missing or unparsable and left `null`) is a no.
const everyMutantKilled = (rows) =>
  Array.isArray(rows) && rows.length > 0 && rows.every((r) => r && r.mutant_killed === true)
export const stateExamBlock = (rows) => {
  if (!everyMutantKilled(rows)) return ''
  return '\n\nSTATE EXAM: the driver read this task\'s state-exam record and every mutant was ' +
    'killed, so duty 5 is settled for the exam file(s) named below and for nothing else — the ' +
    'implementer\'s own tests stay under duty 5.' +
    rows.map((r) => '\n- ' + r.exam + ': mutant ' +
      String(r.mutant_path || '') + ' killed: true').join('')
}
// ── the state handshake (#998 ticket 5, #811 decisions 2 and 7) ─────────────
// One fact travels between two tasks of a run: the state a producer actually
// reached. Its implementer posts it on that task's OWN issue, as the single
// metadata key `state.reached`, whose value is
// `{"expected": "<path under state-exams/expected/>", "content": [tables,
// values]}` — the `getContent()` pair of the file `expected` names. kata has no
// fact kinds, so the shape is refused HERE, by the driver, rather than trusted:
// a value that is not that shape is never written as a seed and never recorded
// as a fact.
//
// `state-exams/expected/` is where a plan pins the states its exams assert
// (`skills/ultrawrite/references/greenfield-stack.md`), so a post naming a path
// anywhere else is naming something that is not an expected state.
const HANDSHAKE_ROOT = 'state-exams/expected/'
// The flat key kata stores `kata meta set <ref> state.reached --json-value …`
// under — the same reading `work.attention` gets above (measured on the hub
// 2026-09-13: `show --json` answers the dotted key flat). A client that expands
// dotted keys into a nested object is the fallback, never the reading.
const handshakeRawOf = (issue) => {
  const meta = (issue && issue.metadata && typeof issue.metadata === 'object')
    ? issue.metadata : {}
  if (meta['state.reached'] !== undefined) return meta['state.reached']
  const nested = (meta.state && typeof meta.state === 'object') ? meta.state : {}
  return nested.reached
}
// Which half of a post is malformed, or `null` when it is well-formed: an
// object whose `expected` is a string under `state-exams/expected/` and whose
// `content` is an array of exactly two elements. `expected` is read first, so a
// value that is not an object at all is reported as its missing path.
export const handshakeFault = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'expected'
  if (typeof raw.expected !== 'string' || !raw.expected.startsWith(HANDSHAKE_ROOT)) {
    return 'expected'
  }
  if (!Array.isArray(raw.content) || raw.content.length !== 2) return 'content'
  return null
}
// The `Produces:` contract: a task's issue in, its well-formed post out, `null`
// for an issue that carries none AND for one whose post is malformed — the
// caller that has to tell those two apart asks `handshakeRawOf`/`handshakeFault`.
export const handshakeOf = (issue) => {
  const raw = handshakeRawOf(issue)
  if (handshakeFault(raw) !== null) return null
  return { expected: raw.expected, content: raw.content }
}
// `JSON.stringify` with keys sorted at every level: the canonical text the
// post's `sha256` is taken over, and the equality the comparison below uses.
// Two posts that differ only in key order are the same state.
export const canonicalJson = (v) => {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'
  }
  return JSON.stringify(v === undefined ? null : v)
}
export const handshakeSha = (content) =>
  createHash('sha256').update(canonicalJson(content)).digest('hex')
// One cell, as a finding reads it. A cell is a string, a number or a boolean
// (TinyBase's own vocabulary), so it is spelled bare; a side that has no cell
// at all is `absent`, which is a difference a mutant makes too.
const handshakeCellText = (v) => {
  if (v === undefined) return 'absent'
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return String(v)
  return JSON.stringify(v)
}
const objectOf = (v) => ((v && typeof v === 'object' && !Array.isArray(v)) ? v : {})
const unionKeys = (a, b) => [...new Set([...Object.keys(objectOf(a)), ...Object.keys(objectOf(b))])].sort()
// The FIRST cell where the post and the file disagree, rendered as
// `<table>/<row>/<cell> got <posted> wanted <file>` — `got` is what the
// producer posted, `wanted` is what its own expected file holds. Tables are
// walked in sorted order at every level, so "first" is a fact about the pair
// and not about whichever key order a JSON writer happened to use. A pair that
// agrees on every cell but differs in its second element (the store's VALUES)
// is named the same way under `values`; a pair that agrees everywhere the walk
// can see returns `null`, which is the caller's signal that the difference is
// structural rather than a cell's.
export const firstDifferingCell = (posted, file) => {
  const [pTables, pValues] = Array.isArray(posted) ? posted : []
  const [fTables, fValues] = Array.isArray(file) ? file : []
  for (const table of unionKeys(pTables, fTables)) {
    const pRows = objectOf(objectOf(pTables)[table])
    const fRows = objectOf(objectOf(fTables)[table])
    for (const row of unionKeys(pRows, fRows)) {
      const pCells = objectOf(pRows[row])
      const fCells = objectOf(fRows[row])
      for (const cell of unionKeys(pCells, fCells)) {
        if (canonicalJson(pCells[cell]) === canonicalJson(fCells[cell])) continue
        return table + '/' + row + '/' + cell +
          ' got ' + handshakeCellText(pCells[cell]) +
          ' wanted ' + handshakeCellText(fCells[cell])
      }
    }
  }
  for (const name of unionKeys(pValues, fValues)) {
    const p = objectOf(pValues)[name]
    const f = objectOf(fValues)[name]
    if (canonicalJson(p) === canonicalJson(f)) continue
    return 'values/' + name + ' got ' + handshakeCellText(p) + ' wanted ' + handshakeCellText(f)
  }
  return null
}

// ── #887 — the join: which paths two of a wave's tasks both touched ──────────
//
// Re-running every merged task's `Run:` on the fold asks most tasks a question
// whose answer is already in hand: a task whose paths no other task of the wave
// went near reads the same tree it read in its own clone, and its proof can
// only repeat itself there. What the fold actually raises is a question about
// PAIRS — two tasks whose work met in one file — so the pass is narrowed to the
// tasks that have one.
//
// A task's TOUCH SET is its declared `files` united with the paths its captured
// patch changed, and both halves are load-bearing. The patch alone misses a
// file the plan handed two tasks that only one of them edited — the other wrote
// its code against that file and is just as exposed to the other's edit. The
// declared list alone misses whatever an implementer touched outside its Files,
// which is precisely the overlap nobody planned for.
//
// The paths a patch changed are the `b/<p>` halves of its `diff --git a/<p>
// b/<p>` headers — the `b` half because a DELETED file still carries one, and a
// task that removed a path contends for it exactly as a task that wrote it does.
export const patchPaths = (patchFile) => {
  let text = ''
  try { text = fs.readFileSync(String(patchFile || ''), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('diff --git ')) continue
    const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
    if (m && m[2] && !out.includes(m[2])) out.push(m[2])
  }
  return out
}
// Declared first, then whatever the capture adds to them — de-duped, order
// stable, so a reader sees the plan's spelling ahead of the capture's.
export const touchSetOf = (task, patchFile) => {
  const out = []
  const declared = (task && Array.isArray(task.files)) ? task.files : []
  for (const p of declared.concat(patchPaths(patchFile))) {
    const s = String(p == null ? '' : p).trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}
// The wave's joined set: every path at least TWO of its touch sets carry,
// sorted. A one-task wave joins nothing to itself and a wave whose tasks are
// pairwise disjoint joins nothing either — both answer `[]`. Computed from the
// wave's own rows every wave: no cache, no hashing, nothing the compiler has to
// know.
export const joinedPathsOf = (touchSets) => {
  const counts = new Map()
  for (const set of (Array.isArray(touchSets) ? touchSets : [])) {
    for (const p of new Set(Array.isArray(set) ? set : [])) counts.set(p, (counts.get(p) || 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([p]) => p).sort()
}
// ── a receipt's two keys ─────────────────────────────────────────────────────
// A RECEIPT is a row carrying both `paths` and `evidence`: the files something
// was observed on, and the reading that observed them. The shape is one literal
// the whole record agrees on — `paths` an array of repo-relative path strings,
// sorted, de-duplicated and never empty; `evidence` `{ read, against }`, two
// strings of at most 500 characters — so the rule that produces it lives here,
// where the wave loop uses it, and the publish fold imports it rather than
// spelling a second sort.
export const receiptPaths = (list) =>
  [...new Set((Array.isArray(list) ? list : [])
    .filter((p) => typeof p === 'string' && p))].sort()
// The bound the shape declares: a longer string is cut to 499 characters plus
// an ellipsis, so the result is exactly 500 and says it was cut.
export const RECEIPT_TEXT_MAX = 500
export const receiptText = (s) => {
  const text = String(s == null ? '' : s)
  return text.length <= RECEIPT_TEXT_MAX
    ? text
    : text.slice(0, RECEIPT_TEXT_MAX - 1) + '…'
}
// #604 (b)+(c) — the INTEGRATED `Run:` proofs were rendered here, for the one
// reader of the finished run. That reader is gone (#964 Task 2): what the
// driver's re-execution on the adopted tree found lives in the report's
// `integratedRuns`, where the gate and every later reader take it.
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
// The same commands on the tree the wave ADOPTED had a block of their own for
// the same reader, and went with it (#964 Task 2): a constraint green in every
// clone and red on the fold is a finding the DRIVER mints — `integratedChecks`
// on the report, and a blocking `completenessFindings` entry beside it.
// #700 — the hunks behind an EXAM EDITED line. Naming the edited paths is not
// showing them, and the PATCH cannot: `patchAgainstBase` diffs the graded clone
// against BASE, where the Proof path does not exist, so an edited exam reads
// there as a whole-file add and the peer's own lines are nowhere in it. The
// referee is then deciding on OWNERSHIP — the graded party touched the exam —
// when the only question worth asking is what the edit did: an edit that only
// strengthens the exam can be accepted and recorded, one that drops an
// assertion blocked, and both verdicts live in the hunks.
// One block per edited path, each beginning `EXAM EDITED DIFF <path>:` — a
// literal shared with the reviewer's own exam-edit rule, so changing it here
// changes what `fleet/roles/reviewer.md` tells the referee to look for —
// followed by a unified diff from the bytes the PEER left at that path to the
// bytes in the graded tree.
// Empty renders nothing at all (the run-51 rule), so a task whose exam nobody
// touched keeps the reviewer prompt it had before this existed, byte for byte.
export const examEditedDiffBlock = (diffs) => {
  if (!Array.isArray(diffs) || diffs.length === 0) return ''
  return diffs.map((d) => '\nEXAM EDITED DIFF ' + d.path + ':\n' + d.diff).join('')
}
// git's own preamble names the two clones by absolute path — `diff --git`,
// `index`, `new file mode` — which tells a referee nothing the block header did
// not already say, and invites it to read the filenames instead of the hunks.
// So the preamble is dropped and the file headers are rewritten to `peer/` and
// `graded/`, which is what the two sides ARE. What remains is the unified diff
// itself: `---`/`+++`, `@@` hunk headers, `-`/`+` content lines.
const hunksOnly = (p, stdout, stderr) => {
  const header = '--- peer/' + p + '\n+++ graded/' + p
  const lines = String(stdout || '').split('\n')
  const at = lines.findIndex((l) => l.startsWith('@@'))
  // No hunks at all: a binary blob, or git itself failed. Say which — an empty
  // block would read as "nothing changed", which is the one thing it is not
  // (the path is on the EXAM EDITED line because its blob moved).
  if (at < 0) {
    return header + '\n(no textual hunks — ' +
      (String(stdout || '').trim() || String(stderr || '').trim() || 'git printed nothing') + ')'
  }
  return header + '\n' + lines.slice(at).join('\n').replace(/\n+$/, '')
}
// The PRIOR-ROUND ADVISORIES block went with the round it addressed (#964
// Task 2): it told round 2 what round 1 had already recorded as minor, and
// there is no round 2 to tell. A round's minors reach the report as before.
// #458: the driver runs the suite on the folded tree and the critic was never
// told. A read-only critic cannot run it — running a PROGRAM is not classified
// read-only, measured 2026-08-31 (#457) — so it establishes pass/fail by static
// trace and then defers it as `deferred:runtime`. That deferral is manufactured:
// the answer already exists in `lastSuite`. Naming the driver's run authoritative
// is what the contend cell's critic explicitly asked for. Exported for the unit
// pin on the red branch — the engine only ever adopts a green tree, so no live
// run reaches it.
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

// The driver-run post-fold suite was rendered for the same reader and is gone
// with it (#964 Task 2). `report.tests` carries the run, the command and the
// output the gate reads.
// `refOf` answers a sibling's kata reference — `<project>#<short_id>`, the same
// spelling the worker's own `KATA_REF` carries — or null for a run with no hub
// record, or a task the record does not name. A worker that finds its proof
// needs a sibling still in flight has to be able to NAME that sibling's issue
// to file `--blocked-by` against it (#979), and this line is where it reads it;
// a run with no record renders the bare `<id>: <files>` it always did.
const siblingLine = (task, wave, refOf) => {
  const refFor = (id) => (typeof refOf === 'function' ? refOf(id) : null)
  const sibs = wave
    .filter((t) => t.id !== task.id && Array.isArray(t.files) && t.files.length)
    .map((t) => {
      const ref = refFor(t.id)
      return t.id + (ref ? ' (' + ref + ')' : '') + ': ' + t.files.join(', ')
    })
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
// The critic's contracts block (2026-09-01) stood here: every task's signed
// body and the compiler's edges, rendered for the one agent that read the
// integrated tree. Deleted with that agent (#964 Task 2) — the composition
// question it was meant to answer is the per-task referee's, against the same
// bodies, before anything merges.
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
// The four variables a state exam reads to know where it is (spec §3.5): the
// task's base sha, the task id, the run directory to write its record under
// and the pass it is running as. Every one of them is OPTIONAL here, and an
// omitted one is DELETED from the inherited environment rather than left to
// leak: the integrated `Run:` is defined by the absence of `ULTRA_RUN_DIR`
// (that absence is what makes the helper write nothing on the fold), so a
// value inherited from the driver's own environment would silently turn it
// into a writing pass.
const examEnv = ({ base, task, runDir: dir, pass } = {}) => {
  const env = { ...process.env }
  for (const [key, value] of [['ULTRA_BASE', base], ['ULTRA_TASK', task],
                              ['ULTRA_RUN_DIR', dir], ['ULTRA_EXAM_PASS', pass]]) {
    if (value === undefined || value === null || value === '') delete env[key]
    else env[key] = String(value)
  }
  return env
}
const baseEnv = (sha) => examEnv({ base: sha })
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
/** The implementer's concern that parks a task for the plan (#722, #944): a
 *  `plan-defect:` entry that names a Proof leg by its parenthesised label AND
 *  says the leg cannot pass. A `(a)` cited in a note about a resolved ambiguity
 *  is not this — the sentence has to claim the leg is unsatisfiable. */
export const LEG_CANNOT_PASS_RE = /cannot pass|can't pass|unsatisfiable|no output|for any output/i
export const legCannotPass = (c) =>
  /^plan-defect:[\s\S]*\([a-z]\)/.test(String(c)) && LEG_CANNOT_PASS_RE.test(String(c))

/** The first 200 characters of `<status>: <verdict>` — what a person reads
 *  first on the issue, so the status is in front of the reason. At module
 *  scope so the exam can drive the cap directly: no engine lane produces a
 *  `reviewVerdict` longer than a short literal, so no run can reach it. */
export const attentionMsg = (status, verdict) =>
  (String(status) + ': ' + String(verdict)).slice(0, 200)

// ── the integration clone's cache sweep (#631 option (d)) ────────────────────
// The driver runs the suite in the integration clone — each wave's candidate,
// and BASE's tree once if one of them is red — so a python suite leaves
// `__pycache__` and `.pytest_cache`
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
// `contendingBlock` is either a string appended to every conflict's brief (the
// wave loop's shape) or a function of the conflict entry — `{ i, path,
// hunksFile, epoch }`, the kernel's own `open` row — returning the tail for
// that one conflict.
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
            // One string brief every dispatch of the stop the same way, or one
            // function the caller asks per conflict: a fold whose block is a
            // whole contending-task dossier per path hands a function and each
            // resolver is briefed on its own path alone.
            (typeof contendingBlock === 'function' ? contendingBlock(conflict) : contendingBlock),
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
      // The reply, on the record. A caller that wants the tally without
      // reading transcripts gets it from the count of these rows; a reply that
      // did NOT resolve also carries the receipt — the conflicted path, the
      // status and its notes, read against the hunks file the resolver held.
      // A `RESOLVED` row carries neither key: the run's record says what the
      // wave was about only where something was left unsettled.
      if (onEvent) {
        onEvent({ kind: 'resolver:reply', label, conflict: conflict.i, attempt,
                  status: res.status,
                  ...(res.status === 'RESOLVED'
                    ? {} : resolverReceiptOf(conflict, res.status, res.notes)) })
      }
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
  // The worker seam. Wrapped below as `agent`, so every dispatch this engine
  // makes for a task the record names is polled for that task's raised hand
  // (#810 Phase A) without a call site having to remember to ask.
  args, agent: dispatchAgent, parallel, exec,
  paths, // { repoDir, runDir, clonesDir }
  log = () => {}, phase = () => {},
  rolesDir,
  // The hub's client (optional): `fleet/kata-client.mjs`'s `makeKataClient`,
  // built by run-main from the run's `--kata` record. Present it WITH
  // `args.kataRecord` and the engine reads each task's fact sheet from the hub
  // and writes the run's record back there; absent, the engine makes no request
  // and behaves exactly as it does without a hub.
  kata,
  // The run's event log (optional): run-main's `makeEventLog`, the sink the
  // workers' envelopes and the phase marks are appended through — lines this
  // engine never writes itself. With a hub on, the engine subscribes to it and
  // mirrors `worker:start`, `worker:end` and `engine:phase` to the hub beside
  // its own `driver:` lines (#880: the hub is a LIVE view, so what the fleet
  // is doing right now — which worker, on which task, at what cost — has to be
  // on it, not only what the driver judged). Absent, only the driver's own
  // lines reach the hub, as before.
  eventLog,
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
  // What a state exam is handed as `ULTRA_RUN_DIR` — absolute, because the
  // exam runs with its cwd inside a clone and resolves the path itself.
  const runDirAbs = path.resolve(runDir)
  // Whether a task whose state exam killed its mutant still gets a reviewer
  // (#836, the operator's pick of 2026-09-15). OFF is the shipped default and
  // the experiment: a green pre-review pass beside a record where every mutant
  // was killed is the driver's own proof that the exam would have caught a
  // wrong state, so the review round is not dispatched at all and the row reads
  // `skipped-mutant-killed`. The ROLLBACK is `reviewOnStateExams: true` in the
  // run's `args.json` — or flipping this default to `true` — which restores the
  // one reviewer every task gets without it. Read once, here, and read strictly:
  // off unless the argument is literally `true`, so an absent key (which is
  // every run on the fleet today — nothing writes this knob), `false`, `'true'`
  // and `1` are all off.
  const reviewOnStateExams = args.reviewOnStateExams === true
  // The engine is handed `log` and `phase` (both events of their own kind) but
  // no raw sink, and `driver:proof-run` is a RECORD, not narration: it has to
  // survive the run as data a sense pass can count. So it goes to the same
  // append-only `<runDir>/events.jsonl` makeEventLog opened, stamped the same
  // way. A failed append is never the run's failure mode — the evidence the
  // reviewer reads is the prompt block, and this is the durable copy.
  // ── the hub (#913) ─────────────────────────────────────────────────────────
  // Both halves or neither: the client is how a request travels and the record
  // is what the run's issues ARE. `kataOn` is the only condition anything below
  // reads, so a run handed one half makes no request at all.
  const kataRecord = (args.kataRecord && typeof args.kataRecord === 'object' &&
                      !Array.isArray(args.kataRecord)) ? args.kataRecord : null
  const kataOn = Boolean(kata && kataRecord)
  const kataProjectId = kataOn ? ((kataRecord.project || {}).id) : null
  const kataRunUid = kataOn ? ((kataRecord.run || {}).uid) : null
  const kataTaskRows = kataOn ? (kataRecord.tasks || {}) : {}
  const kataRowOf = (id) => {
    const row = (id != null && Object.prototype.hasOwnProperty.call(kataTaskRows, id))
      ? kataTaskRows[id] : null
    return (row && typeof row === 'object') ? row : null
  }
  // A task's issue as a worker spells it: `<project name>#<short_id>`, the same
  // reference `envFor` puts in that task's own `KATA_REF`. It is read off the
  // RECORD and spelled exactly as `kataRefFor` (run-main.mjs) spells it —
  // `row.shortId || row.short_id` — so the two never disagree: the setup read
  // fills `shortId` on the row, and a record that arrives carrying `short_id`
  // answers the same reference before any read. The record alone is the
  // condition, not `kataOn`: a run handed a record and no client still names its
  // siblings, and names them without making a hub call. No record, no row, or no
  // short id: null, and the line keeps the bare `<id>: <files>` shape.
  const kataRefRows = (kataRecord && kataRecord.tasks &&
                       typeof kataRecord.tasks === 'object') ? kataRecord.tasks : {}
  const kataRefOf = (id) => {
    const row = (id != null && Object.prototype.hasOwnProperty.call(kataRefRows, id))
      ? kataRefRows[id] : null
    if (!row || typeof row !== 'object') return null
    const shortId = row.shortId || row.short_id
    const name = kataRecord ? (kataRecord.project || {}).name : null
    return (typeof shortId === 'string' && shortId &&
            typeof name === 'string' && name) ? (name + '#' + shortId) : null
  }
  // The revision each issue is known to be at, by uid: seeded by the record and
  // advanced by EVERY answer a mutation of that issue returns. An `If-Match`
  // built from the record after a claim (or a comment, or an earlier patch) has
  // moved it is a 412, so the tracker — not the record — is what a patch sends.
  const kataRevisions = new Map()
  // Task ids whose sheet has been read and whose issue has been claimed. Both
  // are once-per-task: `runTaskInner` is re-entered by the tier retry and the
  // slot-free retry, and a second read would see the revision our own claim
  // bumped. `kataClosed` is the same guard on the other end — the epoch rows and
  // the sweep must not close the same issue twice.
  const kataOpened = new Set()
  const kataClaimed = new Set()
  const kataClosed = new Set()
  // A kata disagreement is not a task's failure and not something a retry can
  // clear: the record and the hub say different things about what this run is.
  // Marked so `runTask`'s catch lets it climb to run-main, which ends the run
  // as `engine-crashed`.
  const kataFatal = (message) => {
    const e = new Error(message)
    e.kataFatal = true
    return e
  }
  const isKataFatal = (e) => Boolean(e && e.kataFatal)
  // Every hub WRITE goes through here: the answered revision is recorded against
  // the issue it belongs to. A failed write is recorded as a `kata:write-failed`
  // event and the run goes on (operator, 2026-09-11, after run-111 died green
  // on a 40-character close-message rule): the hub is the live view, the tag is
  // the record, and the boot's ping is the one hard gate. Reads that disagree
  // with the record (the sheet's revision at dispatch) stay fatal.
  const kataCall = async (what, uid, thunk) => {
    let answer
    try {
      answer = await thunk()
    } catch (e) {
      if (isKataFatal(e)) throw e
      appendEvent({ kind: 'kata:write-failed', what, uid: uid || null,
        detail: String((e && e.message) || e).slice(0, 600) })
      return null
    }
    if (uid && answer && typeof answer.revision === 'number') kataRevisions.set(uid, answer.revision)
    return answer
  }
  // The comment chain. `appendEvent` is synchronous and must stay so (it is the
  // durable evidence copy and a failed append is never the run's failure mode),
  // so a mirrored event pushes its own line here and the post goes out on its
  // own: ONE serialized chain, each post started the moment the one before it
  // has answered, never two in flight, append order = post order. Eager,
  // because the hub is the live view: until run-112 (2026-09-12) the queue was
  // drained only at the next hub write — claim, metadata patch, close, return —
  // so every mid-wave `driver:proof-run` landed in one burst at adoption,
  // median 539 s after its event. A post the hub refuses is one
  // `kata:write-failed` (kataCall) and the chain goes on to the next.
  // `drainKataPosts` is the barrier the record still needs — before each claim,
  // each metadata patch, each close, and before the engine returns — and awaits
  // the chain until nothing is pending, pushes made while it waited included.
  let kataChain = Promise.resolve()
  const kataPost = (uid, body) => {
    kataChain = kataChain
      .then(() => kataCall('comment', uid, () => kata.comment(kataProjectId, uid, body)))
      .catch(() => { /* kataCall recorded it; the chain never breaks */ })
  }
  const drainKataPosts = async () => {
    let head
    do { head = kataChain; await head } while (head !== kataChain)
  }
  // Which issue a line belongs on. A `driver:` line names its task outright;
  // a worker envelope names it in its label — `impl:1`, `exam:1`, `fix:1:0`,
  // `review:1:1:2` all carry the task as the second colon-segment, while
  // `integration` (the critic) and `reconcile:wave1:1` name none the record
  // knows — and a phase mark names the run. Everything else (`transcript:*`,
  // `engine:log`, `capture:*`, `kata:*`, `run:*`) is the record's alone.
  const MIRRORED_ENVELOPES = new Set(['worker:start', 'worker:end'])
  const kataUidFor = (e) => {
    const kind = String((e && e.kind) || '')
    if (kind.startsWith('driver:')) {
      const row = (typeof e.task === 'string') ? kataRowOf(e.task) : null
      return row ? row.uid : kataRunUid
    }
    if (MIRRORED_ENVELOPES.has(kind)) {
      const row = kataRowOf(String(e.label || '').split(':')[1])
      return row ? row.uid : kataRunUid
    }
    if (kind === 'engine:phase') return kataRunUid
    return null
  }
  const mirrorToHub = (e, line) => {
    if (!kataOn) return
    const uid = kataUidFor(e)
    if (uid) kataPost(uid, line)
  }
  // The envelopes this engine does not write: subscribed for the run's length,
  // released at the final drain. Only the envelopes and the phase marks are
  // taken off the log — a `driver:` line on the log is run-main's own and is
  // run-main's chain's to post, so a run that ends by throwing (subscription
  // still in place) never posts run-main's `driver:fail` twice.
  const mirrorLogLine = (e, line) => {
    if (String((e && e.kind) || '').startsWith('driver:')) return
    mirrorToHub(e, line)
  }
  const unsubscribeHub = (kataOn && eventLog && typeof eventLog.subscribe === 'function')
    ? eventLog.subscribe(mirrorLogLine)
    : () => {}
  // What the graded patch touched, on the task's issue, at every point the
  // driver captures one. The revision is the tracker's — the record's is stale
  // the moment the claim lands — and a 412 says the hub moved under us, which
  // is the same disagreement a revision mismatch is and ends the run the same
  // way.
  const kataTouched = async (row, patchFile) => {
    if (!row) return
    await drainKataPosts()
    try {
      const answer = await kata.patchMetadata(kataProjectId, row.uid,
        { touched_files: patchPaths(patchFile) }, kataRevisions.get(row.uid))
      if (answer && typeof answer.revision === 'number') kataRevisions.set(row.uid, answer.revision)
    } catch (e) {
      // A refused metadata write, a 412 included, is recorded and the run goes
      // on: the sheet's own revision was checked at dispatch; a later mismatch
      // on `touched_files` is a disagreement the export will show, not a park.
      appendEvent({ kind: 'kata:write-failed', what: 'metadata', uid: row.uid,
        status: (e && e.status) || null,
        detail: String((e && e.message) || e).slice(0, 600) })
    }
  }
  // What adopted this task, written on the issue itself and not only into the
  // run's record: a closed issue keeps `evidence: null` on itself (kata v0.17.2
  // — the evidence lives in the close event), so the run and the sha a later
  // run needs have to sit on the issue's metadata to be readable there. Three
  // flat keys and nothing else: kata stores a dotted key literally and its
  // metadata endpoint is a per-key merge, so these land beside `factsheet`,
  // `touched_files` and `work.attention` without disturbing them. Called once
  // per adopted task, immediately before that task's close, so the patch and
  // the close read as one act on the issue — and only for a task the close
  // will actually make, which is why the row and the once-guard are read the
  // same way `kataClose` reads them. A stamp that is not `run-<N>` (`sim`)
  // writes `null` rather than a `NaN` the hub would have to store.
  // `work.state` is the third key (#979): the issue already read `landed` from
  // `kataLanded` when the driver took this result, and the fold is what moves it
  // to `adopted`, so the state a reader sees on the hub is the state the run is
  // actually in rather than one it has to infer from the adoption stamp.
  const kataAdopted = async (id, sha) => {
    const row = kataRowOf(id)
    if (!row || kataClosed.has(id)) return
    const n = Number(String(stamp).replace(/^run-/, ''))
    await drainKataPosts()
    await kataCall('metadata', row.uid,
      () => kata.patchMetadata(kataProjectId, row.uid,
        { 'work.adopted_run': Number.isFinite(n) ? n : null,
          'work.adopted_sha': String(sha),
          'work.state': 'adopted' },
        kataRevisions.get(row.uid)))
  }
  // The OTHER half of `work.state` (#979): the instant the driver settles a
  // mergeable result, before any fold has claimed it. One patch, three flat
  // keys, and it does two things at once.
  //
  // `work.state: 'landed'` is the state itself — the work is captured, the
  // worker is gone, and what remains is a fold. `work.attention: 'ok'` with an
  // empty message is the correction: the stamp being cleared is NOT the
  // engine's. Each worker session runs kata's `attention-hook` on SessionStart
  // and SessionEnd, and the end hook writes `work.attention: needs-human`,
  // `work.attention_msg: 'session ended without hand-off'` — which is exactly
  // what a worker that handed its result to the driver did. On runs 129, 134
  // and 135 every CLEAN task ended its issue reading `needs-human`, and it
  // survived adoption and close because nothing ever cleared it. The driver is
  // the one party that knows the hand-off happened, so the driver clears it.
  //
  // Only a landing gets it: a re-edge is not a landing (`settleResult` returns
  // before this line), and a parked-infra row, a failed row and a `done` row
  // downgraded for lost coordinates are not mergeable. A task the run could not
  // finish keeps `kataMark`'s `needs-human` untouched.
  const kataLanded = async (id) => {
    const row = kataRowOf(id)
    if (!row || kataClosed.has(id)) return
    await drainKataPosts()
    await kataCall('metadata', row.uid,
      () => kata.patchMetadata(kataProjectId, row.uid,
        { 'work.state': 'landed',
          'work.attention': 'ok',
          'work.attention_msg': '' },
        kataRevisions.get(row.uid)))
  }
  // The last word on a task's issue. Once per task — the wave's own close wins
  // over the sweep's — and never before the comments that precede it have
  // landed, so the issue reads in the order the run happened.
  const kataClose = async (id, spec) => {
    const row = kataRowOf(id)
    if (!row || kataClosed.has(id)) return
    kataClosed.add(id)
    await drainKataPosts()
    await kataCall('close', row.uid, () => kata.close(kataProjectId, row.uid, spec))
  }
  // The OTHER last word: a task the run could not finish is left OPEN and marked
  // for a person (#810 Phase A). `wontfix` was the engine's word for this until
  // then, and it was the wrong one — a close says the question is settled, while
  // a task the run could not finish is precisely the one still waiting for
  // someone. So three writes and no close: the `needs-review` label, the two
  // `work.attention` keys in ONE metadata patch (kata's metadata is a
  // merge-patch), and one comment carrying the result's own notes. Each goes
  // through `kataCall`, so a refusal is one `kata:write-failed` (#934) naming
  // which write it was and the other two still go out. `kataClosed` is the same
  // once-guard the close uses, so a wave's marking wins over the sweep's and no
  // issue is marked twice.
  const kataMark = async (id, { status, verdict, notes }) => {
    const row = kataRowOf(id)
    if (!row || kataClosed.has(id)) return
    kataClosed.add(id)
    await drainKataPosts()
    await kataCall('label', row.uid,
      () => kata.addLabel(kataProjectId, row.uid, 'needs-review'))
    await kataCall('metadata', row.uid,
      () => kata.patchMetadata(kataProjectId, row.uid,
        { 'work.attention': 'needs-human', 'work.attention_msg': attentionMsg(status, verdict) },
        kataRevisions.get(row.uid)))
    await kataCall('comment', row.uid,
      () => kata.comment(kataProjectId, row.uid, String(notes)))
  }
  const appendEvent = (e) => {
    const ts = Date.now()
    const line = JSON.stringify({ ...e, id: ulid(ts), ts })
    try {
      fs.appendFileSync(path.join(runDir, 'events.jsonl'), line + '\n')
    } catch { /* evidence, not control flow */ }
    // The hub carries the same line, verbatim: the driver's own narration of
    // the run, on the task's issue when the event names a task the record
    // knows, and on the run's issue otherwise (`kataUidFor`).
    mirrorToHub(e, line)
  }

  // ── the state handshake, the driver's two reads (#998 ticket 5) ───────────
  // The producer's implementer posts the state it reached on its own issue
  // while it works; the driver reads that post twice. Once for the CONSUMER —
  // the post becomes a seed file in the clones the consumer's exam runs in —
  // and once for the PRODUCER, at its own pre-review pass, where the post is
  // held against the expected file the patch itself carries.
  //
  // Neither read can be the Setup read (`kataIssues`): that answer was taken
  // before any worker ran, so it cannot carry a fact a worker wrote. Both are
  // fresh, and both go through `kataCall` — a read the hub refuses is one
  // `kata:write-failed` and a task with no post, never the run's failure.
  const readStateReached = async (taskId) => {
    const row = kataOn ? kataRowOf(taskId) : null
    if (!row) return null
    await drainKataPosts()
    const issue = await kataCall('getissue', null, () => kata.getIssue(row.uid))
    const raw = issue ? handshakeRawOf(issue) : undefined
    if (raw === undefined) return { raw: undefined, post: null, fault: null }
    return { raw, post: handshakeOf(issue), fault: handshakeFault(raw) }
  }
  // Every fact is an event (spec §3.5), and every post the driver reads is one
  // `fact:state.reached` — once. A post read at both ends (the producer's pass
  // and its consumer's seeding) is ONE post and one line: the dedup key is the
  // producing task and the digest, so a producer that re-posts a different
  // state appends a second line and a re-read of the same state appends none.
  const handshakeFacts = new Set()
  const noteHandshakeFact = (taskId, post) => {
    const sha256 = handshakeSha(post.content)
    const key = taskId + '|' + sha256
    if (handshakeFacts.has(key)) return sha256
    handshakeFacts.add(key)
    appendEvent({ kind: 'fact:state.reached', task: taskId, expected: post.expected, sha256 })
    return sha256
  }
  // The pair a consumer could not be seeded from: one line per (consumer,
  // producer), whatever brings the driver past it a second time.
  const handshakeAbsences = new Set()
  const noteHandshakeAbsent = (taskId, producer) => {
    const key = taskId + '|' + producer
    if (handshakeAbsences.has(key)) return
    handshakeAbsences.add(key)
    appendEvent({ kind: 'handshake:absent', task: taskId, producer })
  }
  // The producer's post agreeing with its own expected file, once per state.
  const handshakeSettlements = new Set()
  const noteHandshakeSettled = (taskId, post, sha256) => {
    const key = taskId + '|' + sha256
    if (handshakeSettlements.has(key)) return
    handshakeSettlements.add(key)
    appendEvent({ kind: 'handshake:settled', task: taskId, expected: post.expected })
  }
  // ── the driver's own findings, per task ───────────────────────────────────
  // A finding the DRIVER raised rather than a referee: `{severity, actor,
  // detail}`, the shape a reviewer's issue has, distinct by detail, in the
  // order they were raised. They ride the task's report row as `findings`, so a
  // reader sees what the driver held against a task without reading the fix
  // round's prompt back out of a transcript. Empty on every task that has none,
  // which is every task of a run with no handshake.
  const taskFindings = new Map()
  const findingsOf = (taskId) => (taskFindings.get(taskId) || []).map((f) => ({ ...f }))
  const raiseFinding = (taskId, finding) => {
    const held = taskFindings.get(taskId) || []
    if (held.some((f) => f.detail === finding.detail)) return
    held.push(finding)
    taskFindings.set(taskId, held)
    appendEvent({ kind: 'handshake:finding', task: taskId,
                  severity: finding.severity, actor: finding.actor, detail: finding.detail })
  }
  // The run's dependency edges as pairs, whichever spelling the run was given:
  // `args.edges` when the caller supplied the pairs (and re-edges appended to
  // them), and the `<a> -> <b>` strings of `dependencyEdges` otherwise. Both
  // name the same graph, and a consumer's producers are the `a` of every edge
  // pointing at it.
  const handshakeProducersOf = (id) => {
    const out = []
    const seen = new Set()
    const take = (a, b) => {
      if (b !== id || a === id || seen.has(a)) return
      seen.add(a)
      out.push(a)
    }
    for (const [a, b] of EDGES) take(String(a), String(b))
    if (!out.length) {
      for (const line of dependencyEdges) {
        const parts = String(line).split('->')
        if (parts.length !== 2) continue
        take(parts[0].trim(), parts[1].trim())
      }
    }
    return out
  }

  // ── the task's issue, read once (#913, moved to Setup by #383) ─────────────
  // One `getIssue` per task of the whole plan, taken in Setup before wave 1 is
  // dispatched: the answer's `revision` must equal the record's (the record and
  // the hub disagreeing about what this run is ends the run — no retry can
  // clear it), its `short_id` rides the record's row for `envFor`, and its
  // `metadata.factsheet` IS the task from then on. The answer is KEPT, because
  // two later readers want it: `runTaskInner`, which takes the sheet, and the
  // reuse pass, which asks whether this issue is already closed done.
  //
  // `kataOpened` is the once-guard it always was — `runTaskInner` is re-entered
  // by the tier retry and the slot-free retry, and a second read would see the
  // revision our own claim bumped and call that a mismatch.
  const kataIssues = new Map()
  const openKataTask = async (task) => {
    const row = kataOn ? kataRowOf(task.id) : null
    if (!row || kataOpened.has(task.id)) return
    kataOpened.add(task.id)
    await drainKataPosts()
    const issue = await kataCall('getissue', null, () => kata.getIssue(row.uid))
    if (!issue || issue.revision !== row.revision) {
      throw kataFatal('run-engine: kata-revision-mismatch task ' + task.id +
        ': recorded ' + row.revision + ' found ' + ((issue && issue.revision)))
    }
    kataRevisions.set(row.uid, issue.revision)
    kataIssues.set(task.id, issue)
    // #810: the issue's short id, from the SAME answer the revision check
    // read — the workers of this task carry `KATA_REF=<project>#<short_id>`,
    // and a second read for it would be a second fact about one issue. Kept
    // on the record's own row, which run-main's `envFor` reads at dispatch;
    // an answer that carries no short id leaves the row as it was, and those
    // workers simply hold no reference.
    if (typeof issue.short_id === 'string' && issue.short_id) {
      row.shortId = issue.short_id
    }
    const fromHub = (issue.metadata || {}).factsheet
    if (fromHub && typeof fromHub === 'object') {
      task.factsheet = fromHub
      if (Array.isArray(fromHub.files)) task.files = fromHub.files
      if (Array.isArray(fromHub.proofTests)) task.proofTests = fromHub.proofTests
      if (Array.isArray(fromHub.guards)) task.proofGuards = fromHub.guards
    }
    // ── a prior run's mark is history, not this run's (#1037 §2) ────────────
    // A relaunch reuses the same task issues (the launcher's
    // `Idempotency-Key`), so the `needs-human` an EARLIER run's `kataMark` left
    // — `failed: fix-loop-exhausted`, `skipped: an upstream dependency failed`
    // — is exactly what this read finds, and the poll would then record it as
    // this run's own hand: run-16 on the tinyapp fixture (2026-09-16) wrote
    // `driver:attention task 1 needs-human "failed: fix-loop-exhausted"`
    // sixteen seconds into Setup, before any worker had done anything, and it
    // was run-15's mark. A verdict on work this run's workers have not touched
    // yet is not a raised hand; it is history.
    //
    // So the driver clears what it did not write, here, in the Setup loop that
    // runs before wave 1 is dispatched: one `driver:attention-cleared` naming
    // what was cleared, and the same two flat keys `kataLanded` writes, without
    // `work.state` — this is not a landing. The poll's own baseline is `ok`
    // when it has read nothing (`attentionSeen`), which is what the issue now
    // reads, so the clear is invisible to it and every `driver:attention` of
    // the run is a worker's. An issue already resting — `ok`, or no
    // `work.attention` key at all — is not written to.
    //
    // A CLOSED issue is never patched: it is the reuse pass's, its task is not
    // worked again, and its last state is the run that finished it to keep.
    const attention = attentionReadingOf(issue)
    if (issue.status !== 'closed' && attention.value !== 'ok' &&
        ATTENTION_READINGS.has(attention.value)) {
      appendEvent({ kind: 'driver:attention-cleared', task: task.id,
        was: attention.value, msg: attention.msg })
      await drainKataPosts()
      await kataCall('metadata', row.uid,
        () => kata.patchMetadata(kataProjectId, row.uid,
          { 'work.attention': 'ok', 'work.attention_msg': '' },
          kataRevisions.get(row.uid)))
    }
  }

  // ── the worker's raised hand (#810 Phase A) ────────────────────────────────
  // While a task's worker runs, the engine READS that task's issue metadata on
  // a timer and writes nothing: `work.attention` is the worker's to move for as
  // long as that worker is alive (the driver's own two writes are Setup's clear
  // and `kataLanded`'s, both outside any worker's life), and the run's record is
  // where an operator — and the status page, through `driver:attention` — sees
  // that it moved.
  //
  // The timer is per TASK and reference-counted, not per dispatch: the
  // implementer runs beside its examiner, and two timers on one issue would
  // double the hub's reads and race each other's readings. The count rises on the first worker of a task and
  // the interval is cleared when the last one settles.
  const attentionPollMs = (() => {
    for (const raw of [args.attentionPollMs, args.ATTENTION_POLL_MS]) {
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
    }
    return ATTENTION_POLL_MS
  })()
  const ATTENTION_READINGS = new Set(ATTENTION_VALUES)
  // What the driver last READ for a task. Absent means `ok`: a resting worker
  // is the state every task starts in, so the first poll of a quiet task is not
  // a change and records nothing.
  const attentionSeen = new Map()
  const attentionDepth = new Map()
  const attentionTimer = new Map()
  // One read of an issue in flight at a time. A hub slower than the interval
  // would otherwise stack reads whose answers arrive out of order, and the
  // record would carry a reading the worker had already moved past.
  const attentionBusy = new Set()
  const attentionRead = async (taskId, row) => {
    if (attentionBusy.has(taskId)) return
    attentionBusy.add(taskId)
    try {
      // NOT `kataCall`: this is a READ, and a read the hub refuses is a poll
      // that learned nothing — not a failed write, and never the run's end.
      // The revision tracker is left alone for the same reason; the writes that
      // need an `If-Match` carry the revision their own last answer gave them.
      const issue = await kata.getIssue(row.uid)
      // The flat key is the reading, `ok` the absent default — one shape, read
      // here and at Setup's clear (`attentionReadingOf`).
      const { value, msg } = attentionReadingOf(issue)
      if (!ATTENTION_READINGS.has(value)) return
      const was = attentionSeen.has(taskId) ? attentionSeen.get(taskId) : 'ok'
      if (value === was) return
      attentionSeen.set(taskId, value)
      appendEvent({ kind: 'driver:attention', task: taskId, attention: value,
        msg, actor: attentionActorOf(issue) })
    } catch { /* a read the hub refused: nothing to record, and no run to end */
    } finally {
      attentionBusy.delete(taskId)
    }
  }
  const attentionStart = (taskId, row) => {
    const depth = (attentionDepth.get(taskId) || 0) + 1
    attentionDepth.set(taskId, depth)
    if (depth > 1) return
    const timer = setInterval(() => { attentionRead(taskId, row) }, attentionPollMs)
    if (typeof timer.unref === 'function') timer.unref()
    attentionTimer.set(taskId, timer)
  }
  const attentionStop = (taskId) => {
    const depth = (attentionDepth.get(taskId) || 1) - 1
    attentionDepth.set(taskId, depth)
    if (depth > 0) return
    const timer = attentionTimer.get(taskId)
    if (timer !== undefined) clearInterval(timer)
    attentionTimer.delete(taskId)
  }
  // ── the capture anchor of a dispatch ──────────────────────────────────────
  // `withPatchCapture` (run-waves.mjs) captures a worktree dispatch's patch by
  // diffing the WHOLE tree against one base it reads at capture time, through
  // the `patchBase.current` seam run-main hands in. Under the wave barrier one
  // scalar was enough: every dispatch in flight shared its wave's base. Under
  // the ready set two dispatches can be in flight against different heads — a
  // task dispatched at BASE is still working when the epoch before it adopts —
  // and a capture that read the newer head would diff the older tree against it
  // and silently REVERT that epoch inside its own patch.
  //
  // So the base a capture reads is the head the dispatch asking for it went out
  // on, carried in async context rather than in a variable: `patchBase.current`
  // answers with that anchor, and with the run's shared head for a capture made
  // outside any dispatch (the reconcile round's). The anchor is written by the
  // lane, in `dispatchOnce`, in the tick before it dispatches.
  const captureAnchors = new AsyncLocalStorage()
  const anchorOf = new Map()
  if (patchBase) {
    let sharedBase = patchBase.current
    Object.defineProperty(patchBase, 'current', {
      configurable: true,
      get: () => {
        const store = captureAnchors.getStore()
        return (store && store.base) ? store.base : sharedBase
      },
      set: (value) => { sharedBase = value },
    })
  }
  // Every dispatch goes through here. A label whose second colon-segment names
  // a task the record knows (`impl:1`, `exam:1`, `fix:1:0`, `review:1:1:2`) is
  // polled while it runs and carries that task's capture anchor; `integration`,
  // `reconcile:wave1:1` and every dispatch of a run with no hub are the call the
  // engine made at BASE, byte for byte.
  const agent = (prompt, opts) => {
    const labelId = String((opts && opts.label) || '').split(':')[1]
    const anchor = anchorOf.get(labelId)
    if (anchor !== undefined && captureAnchors.getStore() === undefined) {
      return captureAnchors.run({ base: anchor }, () => agent(prompt, opts))
    }
    const row = kataOn ? kataRowOf(labelId) : null
    if (!row) return dispatchAgent(prompt, opts)
    const taskId = labelId
    attentionStart(taskId, row)
    // The dispatch itself is made in THIS tick — the pair at the top of the
    // pipeline is two `agent()` calls with nothing awaited between them, and a
    // wrapper that awaited anything first would put a turn of the loop there.
    let call
    try {
      call = dispatchAgent(prompt, opts)
    } catch (e) {
      attentionStop(taskId)
      throw e
    }
    return Promise.resolve(call).then(
      (reply) => { attentionStop(taskId); return reply },
      (err) => { attentionStop(taskId); throw err })
  }

  // ── the review's findings, where the fix will look (#810 Phase A) ──────────
  // A fix round is dispatched with its blocking findings in its prompt and
  // nothing on the record; the issue the fix worker reads said only that the
  // task was claimed. This is the same list, on the issue, BEFORE that worker
  // starts — `round` is always `0` since #964 Task 2, the pre-review repair
  // round being the only round that dispatches one — posted through the
  // non-fatal write path (#934) and drained, so a refused post is one
  // `kata:write-failed` and the round still runs.
  const postReviewRound = async (row, round, findings) => {
    if (!kataOn || !row) return
    const lines = (Array.isArray(findings) ? findings : [])
      .map((f) => '- ' + String(f == null ? '' : f))
    kataPost(row.uid, 'review round ' + round + ':\n' + lines.join('\n'))
    await drainKataPosts()
  }

  const repoDir = path.resolve(paths.repoDir)
  const integ = path.join(clonesDir, 'integration')

  // The fold kernel, and where a fold's receipts land. Resolved relative to the
  // ENGINE, not the target repo: the kernel ships with the checkout that is
  // running this code, and a foreign target repo (any non-self-hosted plan) has
  // no skills/ tree of its own. Declared HERE rather than beside `foldWave`
  // because Setup's reuse fold (#383) runs before that line is ever evaluated.
  const KERNEL = fileURLToPath(new URL('../skills/ultrapowers/kernel/fold_wave.py', import.meta.url))
  const waveDirOf = (n) => path.join(runDir, 'frontier', 'wave-' + n)

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
  const bootstrapCmd = (typeof args.bootstrapCmd === 'string' && args.bootstrapCmd.trim()) || undefined
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
  // #990 — the amendments the run's workers declared: `{task, amends, what,
  // why}`, one per reply entry, in the order the `driver:amendment` events
  // were appended. `[]` on a run whose replies declared none; the key is on
  // every report, so a reader never has to ask whether the run could say.
  const amendments = []
  const unfinished = []
  const frontier = []
  // #604 — one record per JOINED merged task's `Run:` command (#887), executed
  // on the tree its wave adopted, and the blocking findings a non-zero
  // `Check:` mints. A red `Run:` mints none: it is reported with its pair.
  const integratedRuns = []
  const integratedChecks = []
  const integratedFindings = []
  // Plan-actor blocking findings: `{ task, detail }`, distinct, in the order
  // the reviews raised them. They drive no fix round — they become gate
  // deferrals once the run knows which tasks finished `done`.
  const planDefects = []
  // Tasks the implementer's own leg-labelled `plan-defect:` concern parked
  // before any fix round: `{ task, why }`, one per parked task. They are the
  // one FAILED row that still carries a plan question, so they reach the gate
  // beside `planDefects` rather than through it (#722).
  const parkedForPlan = []
  // ── what a reviewer-minute bought ──────────────────────────────────────────
  // The run spends most of its wall clock in referees, and until now the report
  // said how many rounds ran but never what they returned per minute spent.
  // Every `review:` call is timed, and the numerator counts only what a
  // REVIEWER returned: the driver's own Run:/Check: reds are the driver's
  // finding, and charging them to the referee flatters the ratio.
  let reviewerMs = 0
  const reviewerBlockingKeys = new Set()
  const timedReview = async (prompt, opts) => {
    const t0 = Date.now()
    try { return await agent(prompt, opts) } finally { reviewerMs += Date.now() - t0 }
  }

  // ── one bounded retry for a single-dispatch judgment (#830) ────────────────
  // Three judgments are dispatched once and have no lane that re-asks them: the
  // completeness critic (a `null` is fail-closed on the spot, and the run loses
  // `gitVerified` for what may have been one API blip), the examiner (a `null`
  // falls to `exam = 'blocked'` and the task proceeds unexamined) and each
  // reviewer of a review round (a `null` throws AGENT_NULL, which parks the task
  // and spends the task's one re-dispatch re-running the IMPLEMENTER as well).
  // Each gets
  // exactly one re-dispatch after the backoff, and a second `null` is the answer
  // it already was at BASE — fail-closed, unexamined, parked.
  //
  // Only a `null` REPLY routes here (the AGENT_NULL doctrine above). A throw is
  // still the lanes that already exist — runTask's same-tier retry, the
  // slot-free retry of a parked task, the examiner-alone re-dispatch on a rejected
  // examiner — none of which this widens or replaces.
  const infraBackoffMs = (Number.isFinite(args.infraBackoffMs) && args.infraBackoffMs >= 0)
    ? args.infraBackoffMs : INFRA_BACKOFF_MS
  // What the death's status code was. `agent()` returns a bare `null` — the code
  // travels only in the `worker:end` envelope the worker emitted through
  // `onEvent`, which run-main's event log appended to the very file this engine
  // writes its own records to — so the code is read back from there, taking the
  // last line that names this label. No such line is an honest `unknown`: a
  // death before the worker got that far, or a sim that canned the reply alone.
  // The code is carried on AS READ — `worker:end` writes a number, so the
  // `driver:infra-retry` event repeats that number rather than a stringified
  // copy of it; the judgment-call text stringifies it on its own.
  // #903: the same read also carries the edge trace id the worker put on its
  // `worker:end` (an edge 403 resolved into the infra lane), so the
  // `driver:infra-retry` event names the id support can resolve.
  const lastWorkerEnd = (label) => {
    let text
    try {
      text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    } catch { return { status: 'unknown', trace: null } }
    let status = 'unknown', trace = null
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s || s[0] !== '{') continue
      let e
      try { e = JSON.parse(s) } catch { continue /* not an event line */ }
      if (e && e.kind === 'worker:end' && e.label === label &&
          e.status !== undefined && e.status !== null) {
        status = e.status
        trace = (typeof e.trace === 'string' && e.trace) ? e.trace : null
      }
    }
    return { status, trace }
  }
  const lastWorkerStatus = (label) => lastWorkerEnd(label).status
  // The wait, and nothing else: one ref'd timer. "A backoff must never be the
  // reason a finished process is still alive" is met by RESOLVING — the engine
  // `await`s this promise, so the timer has fired and the loop is empty again
  // before the re-dispatch is even asked for — and NOT by unref'ing. An unref'd
  // timer honoured that clause and broke the run instead: node exits out from
  // under an engine whose only pending work is an unref'd timer (measured: exit
  // 13, "unsettled top-level await"), so the wait needed a second ref'd handle
  // to hold the loop, and the one chosen — `fs.watch` on the run directory — is
  // not available on every box: where it throws, the hold was silently null and
  // the run died 13 mid-wait (#857). A ref'd timer is both halves at once.
  // `globalThis.setTimeout` by name, so a sim can substitute its own clock and
  // read back the delay asked for.
  const waitInfraBackoff = () => new Promise((resolve) => {
    globalThis.setTimeout(resolve, infraBackoffMs)
  })
  // Attempt 1's `null`, in three moves — record the death, wait, re-dispatch —
  // so a caller holding TWO dead workers can record both, wait once, and re-ask
  // both concurrently (#857). The backoff is a property of the outage, not of
  // each worker that died in it; a pair that took it serially took it twice.
  // A caller with one death calls `retryInfraNull` below, which is the three
  // moves in the BASE order and writes the BASE record.
  //
  // Move 1: what died. `scope` is the `task <id>: ` prefix a per-task judgment
  // carries and the empty string for the run-wide critic. Returns the worker
  // status, which move 3's event names — read HERE so it is the status attempt
  // 1 ended on, not whatever the re-dispatch has since written.
  const noteInfraDeath = (label, scope) => {
    const status = lastWorkerStatus(label)
    judgmentCalls.push(scope + 'infra-retry: ' + label + ' attempt 1 returned null (status ' +
      status + ') — re-dispatched once after ' + infraBackoffMs + ' ms')
    log(label + ' returned null (status ' + status + ') — re-dispatching once after ' +
      infraBackoffMs + ' ms')
    return status
  }
  // Move 3 (move 2 is `waitInfraBackoff`): the event, the one re-dispatch, and
  // a second `null` recorded as fail-closed. The re-dispatch is a FRESH worker
  // with the same prompt — `--resume` after an API error is not documented as
  // reliable — which each caller supplies as `redispatch`. Returns the second
  // reply, or `null` when there was none.
  const redispatchInfra = async (label, scope, status, redispatch) => {
    const { trace } = lastWorkerEnd(label)
    appendEvent({ kind: 'driver:infra-retry', label, attempt: 1, status, ...(trace ? { trace } : {}) })
    const again = await redispatch()
    if (again === null) {
      judgmentCalls.push(scope + 'infra-retry: ' + label + ' attempt 2 returned null (status ' +
        lastWorkerStatus(label) + ') — no third attempt; fail-closed')
      return null
    }
    return again
  }
  // The one-death path: the three moves in order, which is the BASE sequence.
  const retryInfraNull = async (label, scope, redispatch) => {
    const status = noteInfraDeath(label, scope)
    await waitInfraBackoff()
    return redispatchInfra(label, scope, status, redispatch)
  }

  // Edge sanity: an edge the ready set cannot honour — surfaced, never thrown.
  // Two of the three complaints the barrier made here are gone with it: an edge
  // whose endpoints shared a wave, or pointed at an earlier one, could not bind
  // when wave position decided execution order, and binds exactly like every
  // other edge now that ADOPTION does. What is left is the edge naming a task
  // this run does not have — nothing to wait for, so nothing is held back — and
  // the hazard readiness introduces: a cycle is not a weak edge but a deadlock
  // the scheduler resolves by never dispatching the tasks in it, so the run says
  // so up front rather than leaving them in `unfinished` unexplained.
  {
    const known = new Set(WAVES.flat().map((t) => t.id))
    const bound = []
    for (const [a, b] of EDGES) {
      if (!known.has(a) || !known.has(b)) {
        judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoint not in this run — ' +
          'unbound for dependency blocking (check for a typo)')
      } else bound.push([a, b])
    }
    // Peel the tasks nothing bound is waiting on, over and over: what is left is
    // in a cycle or behind one.
    const settled = new Set()
    for (let pass = 0; pass < known.size; pass++) {
      let moved = false
      for (const id of known) {
        if (settled.has(id)) continue
        if (bound.every(([a, b]) => b !== id || settled.has(a))) { settled.add(id); moved = true }
      }
      if (!moved) break
    }
    const stuck = [...known].filter((id) => !settled.has(id))
    if (stuck.length > 0) {
      judgmentCalls.push('edges ' + stuck.join(', ') + ': a dependency cycle — no task in it can ' +
        'ever become ready (every one waits on a task that waits on it), so none is dispatched')
    }
  }

  // ── SETUP — driver git (was: a haiku agent told to run `git worktree add`;
  // run-25's park class). The integration clone sits detached at BASE; the
  // branch is created there and the bootstraps run, all through exec. No
  // prompt exists for any of this to be misread. ────────────────────────────
  phase('Setup')
  const branchExists = await exec('git', ['show-ref', '--verify', '--quiet',
    'refs/heads/' + integrationBranch], { cwd: integ })
  if (branchExists.code === 0) {
    throw new Error('run-engine: integration branch ' + integrationBranch +
      ' already exists in the clone — refusing to reuse a branch this run did not create')
  }
  await git(['checkout', '-q', '-b', integrationBranch], integ)
  const baseSha = await git(['rev-parse', 'HEAD'], integ)

  // ── every task's issue, once, here (#913's read moved by #383) ─────────────
  // Before the baseline starts and long before wave 1: the reuse pass below
  // decides what this run still has to work from these very answers, so they
  // have to be in hand at Setup. Serial, because the hub's comment chain is
  // (`drainKataPosts` is the barrier each read waits behind), and because the
  // count that matters is one read per task, not the wall clock of a handful of
  // GETs. Without a record this loop makes no request at all.
  for (const t of WAVES.flat()) await openKataTask(t)

  // ── re-drive reuse (#383) ──────────────────────────────────────────────────
  // A relaunched plan whose earlier run parked left some of its tasks finished:
  // their issues are CLOSED and carry the two flat keys only a `done` close
  // writes (`work.adopted_run`, `work.adopted_sha`). Those tasks are not worked
  // again — their run's evidence tag is folded into the integration clone here,
  // before wave 1, and the head that fold produces is the base every wave and
  // the baseline suite start from. Nothing about the gate changes: the suite
  // still runs on the whole tree.
  //
  // Everything here is refusable. A hub the run could not read, a tag it could
  // not fetch, a record that does not say what the hub says — any of them means
  // no reuse and the full plan runs exactly as it does at BASE, with one
  // `driver:reuse` naming the reason. Reuse is an economy, never a correctness
  // dependency.
  let reuseHead = null
  let reusedIds = new Set()
  {
    const hasKey = (md, k) => Object.prototype.hasOwnProperty.call(md, k) &&
      md[k] !== null && md[k] !== ''
    // The two keys only Task 1's `done` close writes. `closed_reason` is NOT in
    // `ISSUE_KEYS`' projection, so "closed done" is spelled as the status plus
    // the pair: an issue a person closed any other way carries neither.
    const reusable = WAVES.flat().filter((t) => {
      const issue = kataIssues.get(t.id)
      if (!issue || issue.status !== 'closed') return false
      const md = (issue && issue.metadata) || {}
      return hasKey(md, 'work.adopted_run') && hasKey(md, 'work.adopted_sha')
    }).map((t) => t.id)
    const refuse = (reason) => {
      appendEvent({ kind: 'driver:reuse', reason, tasks: [] })
      judgmentCalls.push('reuse refused: ' + reason + ' — the full plan runs')
      log('reuse refused: ' + reason)
      return null
    }
    // The set is empty on every ordinary run: nothing is fetched, no event is
    // appended, and the lines below are the ones they were before #383.
    const head = reusable.length === 0 ? null : await (async () => {
      const runOf = (id) => (kataIssues.get(id).metadata || {})['work.adopted_run']
      const named = [...new Set(reusable.map((id) => String(runOf(id))))]
      if (named.length !== 1) {
        return refuse('the reused tasks name ' + named.length + ' different runs (' +
          named.join(', ') + ') — a reuse folds one parked run\'s evidence, not several')
      }
      const parkedRun = runOf(reusable[0])
      const tag = 'ultra/evidence/run-' + String(parkedRun)
      const fetched = await exec('git',
        ['fetch', '--quiet', 'origin', 'refs/tags/' + tag + ':refs/tags/' + tag], { cwd: integ })
      if (fetched.code !== 0) {
        return refuse('the tag ' + tag + ' could not be fetched from origin (exit ' +
          fetched.code + '): ' + tail(fetched.stderr || fetched.stdout, 300))
      }
      // The tag's two files, written where the fold can read them. `git show`
      // and not a checkout: nothing of the parked run's tree may reach the
      // integration worktree except through the fold below. A `--binary` diff
      // is ASCII by construction (its binary hunks are base85), so the exec
      // seam's utf8 stdout carries `run.patch` byte for byte.
      const reuseDir = path.join(runDir, 'reuse')
      try { fs.mkdirSync(reuseDir, { recursive: true }) } catch { /* exists */ }
      const showInto = async (rel, name) => {
        const r = await exec('git', ['show', tag + ':' + rel], { cwd: integ })
        if (r.code !== 0) return null
        const file = path.join(reuseDir, name)
        fs.writeFileSync(file, r.stdout)
        return file
      }
      const reportFile = await showInto('.ultrapowers/runs/' + parkedRun + '/report.json', 'report.json')
      if (!reportFile) return refuse(tag + ' carries no .ultrapowers/runs/' + parkedRun + '/report.json')
      let parked = null
      try { parked = JSON.parse(fs.readFileSync(reportFile, 'utf8')) } catch { parked = null }
      if (!parked || typeof parked !== 'object') {
        return refuse(tag + '\'s report.json did not parse as JSON')
      }
      // The hub says these tasks are done; the tag has to say so too. `task`,
      // not `id` — that is the key a run's report writes its rows under.
      const rows = Array.isArray(parked.tasks) ? parked.tasks : []
      const notDone = reusable.filter((id) => !rows.some((r) =>
        r && String(r.task) === String(id) && r.status === 'done'))
      if (notDone.length) {
        return refuse(tag + '\'s report.json does not list task(s) ' + notDone.join(', ') +
          ' as done — the hub and the record disagree about what that run finished')
      }
      const parkedBase = (typeof parked.baseSha === 'string') ? parked.baseSha.trim() : ''
      if (!/^[0-9a-f]{40}$/.test(parkedBase)) {
        return refuse(tag + '\'s report.json carries no baseSha to fold against')
      }
      // The parked run has to have been cut from this history, or its patch is
      // a diff against a tree that never existed on the line this run is on.
      const anc = await exec('git', ['merge-base', '--is-ancestor', parkedBase, baseSha], { cwd: integ })
      if (anc.code !== 0) {
        return refuse(tag + '\'s baseSha ' + parkedBase + ' is not an ancestor of BASE ' +
          baseSha + ' — that run was cut from another history')
      }
      const runPatch = await showInto(
        '.ultrapowers/runs/' + parkedRun + '/publish-fold/run.patch', 'run.patch')
      if (!runPatch) {
        return refuse(tag + ' carries no .ultrapowers/runs/' + parkedRun + '/publish-fold/run.patch')
      }
      // The publish fold's own shape (`fleet/publish-fold.mjs`), turned around:
      // there `main=` is the default branch's move since the run's base and
      // `run-<N>=` is the run's whole result; here `main=` is THIS run's BASE
      // since the parked base and `reuse=` is the parked run's result. Two
      // peers against one base, never a rebase. An empty `main.patch` (BASE is
      // the parked base, nothing moved) needs no special case: the kernel reads
      // it as a task that changed nothing and folds the other side alone.
      const mainDiff = await exec('git',
        ['diff', '--binary', '--full-index', '--no-renames', parkedBase + '..' + baseSha],
        { cwd: integ })
      if (mainDiff.code !== 0) {
        return refuse('could not diff ' + parkedBase + '..' + baseSha + ' in the integration clone')
      }
      const mainPatch = path.join(reuseDir, 'main.patch')
      fs.writeFileSync(mainPatch, mainDiff.stdout)
      // `foldReuse` gives up in three ways — no verdict, an unclean fold, a
      // materialize refusal — and hands back the sentence it gave up with, so
      // the refusal below says which one and not merely that reuse failed.
      const folded = await foldReuse({ parkedBase, mainPatch, runPatch, tag })
      if (!folded.head) return refuse(folded.reason)
      appendEvent({ kind: 'driver:reuse', run: parkedRun, tasks: reusable, headSha: folded.head })
      log('reuse: ' + reusable.length + ' task(s) folded in from ' + tag + ' → ' + folded.head)
      return folded.head
    })()
    if (head) {
      reuseHead = head
      reusedIds = new Set(reusable)
      // The rows the report owes these tasks, pushed before wave 1: `done` with
      // no coordinates, so `isMergeable` is false for them and no wave folds
      // them again. They go into `taskResults` and NOT into any wave's own
      // `results` — a wave whose every task is reused must read as "no
      // mergeable results" and go on to the next wave, not as a wave that
      // failed and cascades.
      for (const id of reusable) {
        taskResults.push({ task: id, status: 'done', reviewVerdict: 'reused',
                           headSha: reuseHead, patch: '', branch: '',
                           notes: 'reused from run-' + String(
                             (kataIssues.get(id).metadata || {})['work.adopted_run']),
                           tier: resolvedModel((WAVES.flat().find((t) => t.id === id) || {}).tier ||
                             'standard'),
                           review: 'lean', fixIterations: 0, proofFixes: 0 })
        // Neither end of the hub is this run's to touch for a task it did not
        // work: no claim before, no close and no `needs-review` sweep after.
        kataClaimed.add(id)
        kataClosed.add(id)
      }
    }
  }

  // The baseline's own clone (#862). The suite on BASE runs HERE and nowhere
  // else: read-treeing BASE into the integration clone — #712's shape — put the
  // baseline in the same worktree the wave's candidate lives in, so it could
  // only run once the candidate had been built and tested. A clone of its own is
  // what lets it start in Setup and settle while wave 1 works. Driver-cut,
  // exactly like the clones run-main provisions (Amendment 10: no prompt exists
  // for any of this to be misread).
  const baselineDir = path.join(clonesDir, 'baseline')
  cloneAtBase({ repo: repoDir, dest: baselineDir, base: baseSha })
  // With a reuse head, THAT is the tree every wave builds on, so that is the
  // tree the one pass on "BASE" has to measure (#383 M5): a baseline taken on
  // BASE alone would answer a question no wave of this run is asking. The
  // commit exists only in the integration clone's object database until the run
  // pushes, so it is fetched from there — the same move the wave loop's
  // re-anchor makes for a task clone.
  if (reuseHead) {
    await git(['fetch', '--quiet', '--no-tags', integ, integrationBranch], baselineDir)
    await git(['checkout', '--quiet', '--detach', reuseHead], baselineDir)
  }
  if (bootstrapCmd) {
    // Every fresh clone needs its dependencies before a suite can run there —
    // the integration clone (candidate, reconcile suite runs), the baseline
    // clone (the one pass on BASE) and each task clone (implementer red-green
    // cycles). Driver-run, so the warm-cache prompt choreography does not exist
    // on this path. The baseline is bootstrapped BEFORE its suite starts below:
    // a suite run against an uninstalled tree would report BASE red on a missing
    // module and park a run whose repository was fine.
    for (const dir of [integ, baselineDir,
                       ...WAVES.flat().map((t) => path.join(clonesDir, 'task-' + t.id))]) {
      const b = await sh(bootstrapCmd, dir)
      if (b.code !== 0) {
        judgmentCalls.push('bootstrap failed in ' + path.basename(dir) + ' (exit ' + b.code +
          ') — the suite may be unrunnable there: ' + tail(b.stderr || b.stdout, 300))
        log('bootstrap failed in ' + path.basename(dir))
      }
    }
  }
  log('setup: branch ' + integrationBranch + ' at ' + baseSha)

  // The suite on BASE is EAGER (#862, widening #712's lazy pass): it is started
  // HERE, in Setup, and nothing waits for it — wave 1 is dispatched while it
  // runs, so the answer is off the critical path and settled before the first
  // fold at the latest. #712's economy is kept in spirit: this is the one and
  // only site that runs the suite on BASE, so a run pays for it exactly once
  // however many epochs go red.
  //
  // BASE and not a wave's head: a head that was adopted was judged green when it
  // was, so a later wave's red is the diff's unless BASE itself was already red
  // — which is the question this pass answers, once, before anyone is asked to
  // repair anything.
  //
  // `null` until it settles; `{ passed, output }` after. A plain promise and NOT
  // one of `parallel`'s thunks: the bounded pool is the dispatch width, and a
  // baseline holding one of its slots would delay the very dispatch it is meant
  // to run beside.
  let baseline = null
  // How long the baseline suite took, in milliseconds — `null` until it settles.
  // The run's one measurement of what a suite COSTS, which is what the fold
  // policy's age clause is denominated in (#1006): a result nobody is waiting
  // on may sit captured and unadopted for a suite's length before a fold is
  // spent on it.
  let baselineWallMs = null
  // Which tests are red, comma-joined, read off the RAW suite output and not off
  // `baseline.output`: pytest prints its `FAILED <path>::<test>` lines in the
  // short summary, which is BELOW the block `failingBlock` cuts, so the block a
  // reader quotes does not carry them. `unparsed` when no line names one — a red
  // suite that printed no `FAILED` line is still a blind sensor, and saying the
  // paths could not be read beats naming nothing at all.
  let baselineFailing = 'unparsed'
  const failingPaths = (raw) => {
    const paths = String(raw ?? '').split('\n')
      .map((line) => /^FAILED (.+?)::/.exec(line))
      .filter(Boolean).map((m) => m[1])
    return paths.length ? paths.join(', ') : 'unparsed'
  }
  // The one sentence a red BASE owes its reader, shared by the judgment call
  // here and the wave's park detail below (#871 decision 2). It leads with the
  // prefix `baseline: the suite is RED on BASE` byte for byte — two sims pin
  // that with `startsWith` — and then says the thing the prefix alone does not:
  // the suite cannot be read for this run, and these are the tests that are red.
  // The block comes last, where it has always been.
  const redBaselineHead = (output) =>
    'baseline: the suite is RED on BASE — the sensor is blind for this run; failing: ' +
    baselineFailing + ' (' + output + ')'
  const settleBaseline = (passed, output, raw) => {
    baseline = { passed, output }
    baselineWallMs = Date.now() - baselineStartedAt
    log('baseline: ' + (passed ? 'green' : 'RED') + ' on ' + (reuseHead || baseSha))
    if (!passed) {
      baselineFailing = failingPaths(raw)
      judgmentCalls.push(redBaselineHead(output) +
        ' — the red this run inherited, not the diff\'s: the run parks before ' +
        'the first fold at the latest, and no reconcile is dispatched at it')
    }
  }
  // The clock the wall above is read off, started on the line the suite does.
  const baselineStartedAt = Date.now()
  const baselineSettled = sh(testCmd, baselineDir).then(
    // A green baseline keeps BASE's record — a tail of the summary. A red one
    // records the failing test's own block, which is what every reader of
    // `baseline.output` below is quoting.
    (r) => settleBaseline(r.code === 0, r.code === 0
      ? tail(r.stdout + r.stderr, 2000)
      : failingBlock(r.stdout + r.stderr), r.stdout + r.stderr),
    // A suite the driver could not even start is not a green BASE: the run has
    // no evidence its repository was passing, and the whole point of reading the
    // baseline first is to refuse to attribute a red to a diff on a guess.
    (e) => settleBaseline(false, 'the baseline suite could not be run on BASE: ' +
      String((e && e.message) || e), ''))

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
  // A KEPT reply: success WITH the driver's own coordinates, which is the whole
  // condition for re-dispatching an examiner alone rather than the pair. Both
  // examiner lanes ask it, so it is spelled ONCE (#857) — a prose rule violated
  // twice becomes a check, and the check greps this one line. Keep it on one.
  const keptReply = (r) => (r.status === 'DONE' || r.status === 'DONE_WITH_CONCERNS') && hasCoordinates(r)
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

  // ── per-task pipeline: implement → one repair round if the driver's own
  //    evidence is red → one review round (ported) ─────────────────────────
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
    // #990 — the same seam for the reply's typed amendment rows, and read the
    // same way at both call sites: whatever `res.status` is, an amendment is a
    // statement about what the worker changed, not about how it finished. One
    // record per entry, in the reply's order, so the event stream carries the
    // implementer's before that task's first `driver:proof-run` and the fix
    // round's after it — and `appendEvent` mirrors each onto the task's issue
    // with no further code.
    const noteAmendments = (res) => {
      if (!res || !Array.isArray(res.amendments)) return
      for (const a of res.amendments) {
        if (!a || typeof a !== 'object') continue
        const row = { task: task.id, amends: a.amends, what: a.what, why: a.why }
        amendments.push(row)
        appendEvent({ kind: 'driver:amendment', ...row })
        judgmentCalls.push('task ' + task.id + ': amendment (' + a.amends + '): ' +
          a.what + ' — ' + a.why)
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

    // ── the task's fact sheet, from the hub (#913) ──────────────────────────
    // The read itself moved to Setup (#383): the reuse pass has to know which
    // issues are already closed done BEFORE wave 1 is dispatched, and that is
    // the same answer this pipeline wants. `openKataTask` is guarded by
    // `kataOpened`, so the call here is the no-op it became — the count stays
    // one `getIssue` per task, and a task the Setup pass somehow missed is
    // still read before its first worker.
    const kataRow = kataOn ? kataRowOf(task.id) : null
    await openKataTask(task)
    // The sheet, once, for everything below. Absent — no record, or a task the
    // record does not name — every branch below is the one it was at BASE.
    const factsheet = (task.factsheet && typeof task.factsheet === 'object')
      ? task.factsheet : null

    // ── where this task's exam lands (#777) ─────────────────────────────────
    // The Proof's `Test:` path is the path the exam is written FOR; unless the
    // Proof marked it `Guard:` — in which case the file AT that path is the
    // deliverable and it lands at itself — the run writes it to the reserved
    // directory under the matching test root. `proofGuards` is read exactly as
    // `proofTests` is, and a task compiled before the field existed has none.
    const proofTests = Array.isArray(task.proofTests)
      ? task.proofTests.filter((p) => typeof p === 'string' && p.trim() !== '')
      : []
    const proofGuards = Array.isArray(task.proofGuards)
      ? task.proofGuards.filter((p) => typeof p === 'string' && p.trim() !== '')
      : []
    const examTestCmd = (typeof task.testCmd === 'string' && task.testCmd.trim())
      ? task.testCmd : null
    // With a sheet the landing is READ, never derived: the launcher already
    // decided where every Proof path goes and wrote it down, and a driver that
    // recomputed it could disagree with the record it is supposed to obey.
    const landingOf = (p) => factsheet
      ? (factsheet.landing || {})[p]
      : (proofGuards.includes(p) ? p : reservedExamPath(p, stamp))
    // Proof order, and only the paths that actually move. A task whose paths
    // are under neither test root — every sim at BASE, whose Proof names
    // `t1_test.sh` — has an empty list here and takes every branch below with
    // the bytes it had before this existed.
    const examMoves = proofTests.map((p) => [p, landingOf(p)]).filter(([p, land]) => land !== p)
    // The exam's command, pointed at where the exam lands. Substring
    // replacement is honest on every shape the compiler emits: each spelling
    // `derive_task_test_cmd` produces carries the Proof path verbatim, and a
    // command that names none comes back unchanged.
    const examRunCmd = examTestCmd
      ? examMoves.reduce((cmd, [p, land]) => cmd.split(p).join(land), examTestCmd)
      : null
    // One line per moved path, in Proof order, directly after the TEST COMMAND
    // line and before FILES — the examiner's only instruction about where to
    // write, and a line the implementer's prompt never carries.
    const examPathsBlock = examMoves
      .map(([p, land]) => '\nEXAM PATHS: ' + p + ' -> ' + land).join('')

    // The Proof's `Run:` commands, in Proof order (#589). Absent or empty for
    // every task compiled before the slot existed — and M6: a `Run:`-only
    // proof leaves `proofTests` empty, so it dispatches no examiner by the
    // branch already below, with no new condition. Read here because the
    // implementer's own proofs are one of its prompt's inputs, below.
    const proofRuns = Array.isArray(task.proofRuns)
      ? task.proofRuns.filter((c) => typeof c === 'string' && c.trim() !== '')
      : []

    // Everything after the first line is one string both workers get, byte for
    // byte: the same BASE, FILES, SIBLING FILES, GLOBAL CONSTRAINTS, INTERFACES
    // and TASK blocks. What differs is only what each is measured by — the
    // examiner's TEST COMMAND, the implementer's PROOFS.
    const sharedInputs = filesLine(task) + siblingsStr +
      globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task, wavesPath)
    // The examiner's line is the remapped command; a task with no command of
    // its own falls back to the run-wide one exactly as it did.
    const examCmdTask = examRunCmd ? { testCmd: examRunCmd } : task
    const examinerInputs = testCmdLine(examCmdTask, testCmd) + examPathsBlock + sharedInputs
    // The graded worker's inputs: the commands the driver will run against what
    // it returns, and no run-wide suite. The fix rounds are handed the same
    // block — they are graded by the same commands in the same clone — and no
    // `EXAM PATHS:` line: nothing there writes an exam.
    const proofsInputs = proofsBlock(proofRuns, constraintChecks)
    const implementerInputs = proofsInputs + sharedInputs

    // ── the exam (#553, #653) ────────────────────────────────────────────────
    // A worker writes the tests the Proof names, in a clone of its OWN at BASE,
    // dispatched in the same breath as the implementer and awaited neither
    // before nor after it. It receives the implementer's inputs — the same
    // BASE, FILES, SIBLING FILES, GLOBAL CONSTRAINTS, INTERFACES and TASK
    // blocks — and NOT the implementer's role: the one agent that may not be
    // told to make the suite green is the one writing the thing that measures
    // it. What the two prompts differ in is the command each is measured by:
    // the examiner holds the exam's TEST COMMAND, and the implementer, which
    // will not hold the exam until the handoff, holds its own PROOFS block.
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
    // ── the seed this task's exam is handed (#998 ticket 5) ─────────────────
    // What this task CONSUMES FROM, and what each of those producers posted as
    // the state it reached. Read once per dispatch, from the hub, and written
    // into every clone an exam command of this task can run in — the graded
    // clone and the examiner's — before any of them runs one. A producer whose
    // issue carries no post seeds nothing and is recorded as the absence it is;
    // a post whose shape the driver refuses (M5) seeds nothing either, and is
    // answered at that producer's own pre-review pass rather than here.
    let handshakeSeedsRead = null
    const handshakeSeeds = async () => {
      if (handshakeSeedsRead) return handshakeSeedsRead
      const seeds = []
      for (const producer of (kataOn ? handshakeProducersOf(task.id) : [])) {
        const read = await readStateReached(producer)
        if (!read || read.raw === undefined) {
          noteHandshakeAbsent(task.id, producer)
          continue
        }
        if (!read.post) continue
        noteHandshakeFact(producer, read.post)
        seeds.push([producer, read.post])
      }
      handshakeSeedsRead = seeds
      return seeds
    }
    // A seed is run-local state in a working tree the driver also captures a
    // patch from, so the directory is excluded in the clone's own git config
    // before anything is written into it: `patchAgainstBase` stages with
    // `add -A`, and a seed that reached the index would ride the patch into the
    // fold and out to the target. The exclude file is the one place to say so
    // that edits nothing the worker can see.
    const excludeSeeds = (dir) => {
      try {
        const gitDir = path.join(dir, '.git')
        if (!fs.statSync(gitDir).isDirectory()) return
        const file = path.join(gitDir, 'info', 'exclude')
        const line = 'state-exams/posted/'
        let text = ''
        try { text = fs.readFileSync(file, 'utf8') } catch { /* no file yet */ }
        if (text.split('\n').includes(line)) return
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + line + '\n')
      } catch { /* the seed is still written; the exclude is a courtesy */ }
    }
    const seedHandshake = async (dir) => {
      const seeds = await handshakeSeeds()
      if (!seeds.length) return
      excludeSeeds(dir)
      for (const [producer, post] of seeds) {
        const f = path.resolve(dir, 'state-exams', 'posted', producer + '.json')
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, JSON.stringify(post.content))
      }
    }
    // `git hash-object` on the path as it stands in a clone; an absent path is
    // recorded as null, which is itself a value the drift check compares
    // (creating a path the examiner declined to write IS an edit).
    const blobShaIn = async (dir, p) => {
      const r = await exec('git', ['hash-object', path.resolve(dir, p)], { cwd: dir })
      return r.code === 0 ? String(r.stdout || '').trim() : null
    }
    const blobShaOf = (p) => blobShaIn(cloneDir, p)
    // Put a path back the way BASE left it — deleted when BASE had none. Used
    // on the Proof path once its exam has landed somewhere else: whatever the
    // implementer wrote there is its own file, not an exam, and the branch is
    // not to carry a second copy of the measurement at the path the Proof
    // named. `git checkout <sha> -- <path>` stages the base content, so the
    // re-capture's `add -A`/`diff --cached` sees no hunk for it; a path absent
    // at BASE is a failing pathspec, and then removing it is the restore.
    const restoreToBase = async (dir, p) => {
      const r = await exec('git', ['checkout', baseShaForTask, '--', p], { cwd: dir })
      if (r.code === 0) return
      fs.rmSync(path.resolve(dir, p), { recursive: true, force: true })
    }
    // The reserved Python root for this run, and the packaging it needs.
    // pytest collects `tests/exams/<slug>/test_a.py` beside a curated
    // `tests/test_a.py` only when the exam's directories are a real package:
    // every other shape aborts collection with `import file mismatch`, and
    // `--import-mode=importlib`, which also collects both, breaks the curated
    // tests that import a sibling test module by name. So each directory from
    // the reserved root down to the file gets an empty `__init__.py`, written
    // only where none exists. `fleet/tests/` is a bare node-runner glob with no
    // package semantics and gets none.
    //
    // With a sheet the set is READ too: the launcher owns those files, listed
    // in `driverOwned`, and the ones that are packaging are exactly the entries
    // ending `__init__.py`. Lazy, so a task with a sheet calls `examSlug`
    // never.
    const pyExamRoot = () => 'tests/exams/' + examSlug(stamp)
    const initsFromLandings = (landings) => {
      const root = pyExamRoot()
      const dirs = new Set()
      for (const land of landings) {
        if (!land.endsWith('.py') || !land.startsWith(root + '/')) continue
        let at = root
        dirs.add(at)
        for (const seg of land.slice(root.length + 1).split('/').slice(0, -1)) {
          at += '/' + seg
          dirs.add(at)
        }
      }
      return [...dirs].map((d) => d + '/__init__.py')
    }
    const ensurePackageInits = (dir, landings) => {
      const files = factsheet
        ? (Array.isArray(factsheet.driverOwned) ? factsheet.driverOwned : [])
            .filter((p) => typeof p === 'string' && p.endsWith('__init__.py'))
        : initsFromLandings(landings)
      for (const rel of files) {
        const f = path.resolve(dir, rel)
        fs.mkdirSync(path.dirname(f), { recursive: true })
        if (!fs.existsSync(f)) fs.writeFileSync(f, '')
      }
    }
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
    // Cutting the clone is its own step because it happens twice: once here,
    // and once again when a dead examiner is re-dispatched alone beside an
    // implementer that already finished (#762) — the second examiner must open
    // its eyes on a tree at BASE, not on whatever the first one left behind.
    const cutExamClone = async () => {
      // A slot-free retry re-enters runTaskInner; the clone is re-cut from
      // scratch rather than reused, the same posture resetTaskClone takes.
      fs.rmSync(examDir, { recursive: true, force: true })
      cloneAtBase({ repo: await cloneSourceFor(baseShaForTask), dest: examDir,
                    base: baseShaForTask })
      // The seed goes in with the clone, every time one is cut: the examiner's
      // at-BASE probe is the FIRST exam command this task runs, and the
      // re-cut a dead examiner buys (#762) must not open its eyes on a tree
      // that lost it.
      await seedHandshake(examDir)
    }
    const bootstrapExamClone = async () => {
      if (!bootstrapCmd) return
      // The setup loop bootstrapped every clone that existed then; this one
      // did not, and its red-at-BASE run needs the same tree.
      const b = await sh(bootstrapCmd, examDir)
      if (b.code !== 0) {
        judgmentCalls.push('bootstrap failed in ' + path.basename(examDir) + ' (exit ' + b.code +
          ') — the suite may be unrunnable there: ' + tail(b.stderr || b.stdout, 300))
        log('bootstrap failed in ' + path.basename(examDir))
      }
    }
    const examReady = await (async () => {
      if (!(proofTests.length && examTestCmd)) return false
      try {
        await cutExamClone()
      } catch (e) {
        // No clone, no exam — and no reason to fail a task over it: the same
        // standing a BLOCKED examiner has.
        exam = 'blocked'
        judgmentCalls.push('task ' + task.id + ': the examiner\'s clone could not be cut at ' +
          baseShaForTask + ' (' + String((e && e.message) || e) +
          ') — no exam recorded; the implementer proceeds unexamined')
        return false
      }
      await bootstrapExamClone()
      return true
    })()
    // …and into the graded clone, before the pair is dispatched: every exam
    // command that runs there — the pre-review pass's, and the repeat after the
    // repair round — reads the state its producers reached.
    await seedHandshake(cloneDir)
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
    // How many exam rounds this task's examiner ran (#1037): `1` on every task
    // whose exam was recorded, `2` when a referee's blocking finding named the
    // exam's own landing path and bought the examiner one round to rewrite it.
    // Same presence rule as `examEdited` — set at the handoff, so a task with
    // no exam carries no key and "exhausted" is distinguishable from "the
    // examiner never ran".
    let examRounds = null
    const examRoundsField = () => (examRounds === null ? {} : { examRounds })
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
    // The hunks the referee reads (#700). The peer's bytes survive in the
    // examiner's own clone — nothing removes `examDir` during the task — at the
    // same relative path they were copied from at the handoff, so the two sides
    // of the diff are files on disk: `<examDir>/<p>` and `<cloneDir>/<p>`. A
    // side the examiner never wrote (a path it left absent) or the graded party
    // deleted is `/dev/null`, which is how an added or removed exam file diffs
    // from empty. `git diff --no-index` exits 1 when the files differ, which is
    // the expected exit here rather than an error — so its code is not branched
    // on at all; what it printed is what the block carries.
    const examEditedDiffs = async () => {
      if (!(examEdited && examEdited.length)) return []
      const diffs = []
      for (const p of examEdited) {
        const peer = path.resolve(examDir, p)
        const graded = path.resolve(cloneDir, p)
        const r = await exec('git', ['diff', '--no-index', '--no-color', '--',
          fs.existsSync(peer) ? peer : '/dev/null',
          fs.existsSync(graded) ? graded : '/dev/null'], { cwd: cloneDir })
        diffs.push({ path: p, diff: hunksOnly(p, r.stdout, r.stderr) })
      }
      return diffs
    }

    let baseCorrected = null
    // The pair (#653). Both dispatches are made here with nothing awaited
    // between them: everything the examiner needed first — its clone, its
    // bootstrap — is already done above, so `agent` is entered for `exam:<id>`
    // and then for `impl:<id>` in the same tick, and `Promise.all` awaits
    // neither before the other. Deliberately NOT the `parallel` seam: that one
    // is bounded by the caller and this code already runs inside one of its
    // slots, so nesting it could hand the wave a width it does not have.
    // The claim is the hub's record that this task is now being worked, and it
    // is on the hub BEFORE the pair exists — once per task, like the read.
    if (kataRow && !kataClaimed.has(task.id)) {
      kataClaimed.add(task.id)
      await drainKataPosts()
      await kataCall('claim', kataRow.uid, () => kata.claim(kataProjectId, kataRow.uid))
    }
    const examPrompt = roles.examiner + '\nBASE: ' + baseShaForTask + examinerInputs
    const examOpts = { label: 'exam:' + task.id, isolation: 'worktree', model: baseModel,
                       schema: EXAMINER_SCHEMA }
    const examCall = examReady ? agent(examPrompt, examOpts) : null
    const implCall = agent(
      roles.implementer + '\nBASE: ' + baseShaForTask + implementerInputs,
      { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA })
    // Both halves are SETTLED before either is judged (#762). `Promise.all`
    // rejected the moment the examiner died — with the implementer still
    // running, un-awaited — and that rejection climbed to runTask, which reset
    // the task clone and re-entered runTaskInner whole: a second implementer
    // redoing work the first one had already finished (run-34's lost 746 s).
    // Settling first costs nothing (the pair is dispatched exactly as before,
    // neither awaited before the other) and lets the driver see what it
    // actually has: a dead examiner beside a finished implementer.
    const [examSettled, implSettled] = await Promise.allSettled([examCall, implCall])
    // An implementer that died is the pair lane unchanged: its error is the one
    // that climbs, runTask resets the clone and re-dispatches both. There is no
    // work to keep.
    if (implSettled.status === 'rejected') throw implSettled.reason
    let ex = examSettled.status === 'fulfilled' ? examSettled.value : null
    let impl = implSettled.value
    if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null (terminal Overloaded or skipped)')
    // Before the kept-reply question is asked, so `hasCoordinates` reads the
    // driver's own capture and never a model-typed path.
    stripUntrustedPatch(impl, patchPrefix)
    if (examSettled.status === 'rejected') {
      const examErr = String((examSettled.reason && examSettled.reason.message) || examSettled.reason)
      // A KEPT reply — success with coordinates — is the whole condition. Only
      // then is there something a whole-pair retry would throw away; an
      // implementer that merely returned (BLOCKED, NEEDS_CONTEXT, a capture
      // failure) has nothing worth keeping, so the examiner's error climbs and
      // the lane at BASE runs.
      const kept = keptReply(impl)
      if (!kept) throw examSettled.reason
      judgmentCalls.push('task ' + task.id + ': examiner died (' + examErr +
        ') — the implementer ended success with its patch captured; re-dispatching the examiner alone')
      appendEvent({ kind: 'driver:exam-redispatch', task: task.id, detail: examErr })
      log('task ' + task.id + ' examiner died — re-dispatching the examiner alone')
      try {
        // The graded clone is NOT reset and the implementer is NOT re-dispatched:
        // `impl.patch` is the driver's own capture and stays exactly as taken.
        // The examiner's clone is re-cut at BASE so the second attempt sees the
        // tree the first one was given, not the tree it left.
        await cutExamClone()
        await bootstrapExamClone()
        ex = await agent(examPrompt, examOpts)
      } catch (e2) {
        // One re-dispatch, never two. A second death leaves `ex` null, which the
        // verdict block below already reads as an examiner that returned no
        // reply: exam `blocked`, the implementer proceeds unexamined.
        ex = null
        log('task ' + task.id + ' examiner died again — proceeding unexamined')
      }
    } else if (examReady && ex === null) {
      // The same infra death, arriving as a REPLY rather than a throw (#830).
      // At BASE this fell straight through to `exam = 'blocked'` — the task
      // proceeds unexamined and nobody ever re-asks — so it gets the one
      // re-dispatch the rejected lane above already gets, under the same
      // kept-reply condition: only a success with driver-captured coordinates
      // has work a whole-pair retry would throw away. The clone is re-cut at
      // BASE and bootstrapped again for the same reason it is there — the
      // second examiner must open its eyes on the tree the first was given.
      const kept = keptReply(impl)
      if (kept) {
        try {
          ex = await retryInfraNull('exam:' + task.id, 'task ' + task.id + ': ', async () => {
            await cutExamClone()
            await bootstrapExamClone()
            return agent(examPrompt, examOpts)
          })
        } catch (e2) {
          // A clone that could not be re-cut, or a second attempt that threw:
          // one re-dispatch, never two, and `ex` stays null — which the verdict
          // block below already reads as an examiner that returned no reply.
          ex = null
          log('task ' + task.id + ' examiner died again — proceeding unexamined')
        }
      }
    }
    noteConcerns(impl)
    noteAmendments(impl)
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
        // Read at the LANDING paths: that is where the `EXAM PATHS:` lines sent
        // the examiner, and where the handoff, the drift check and every exam
        // run read from. A path that never moved is its own landing path, so
        // this is the same read it always was for the sims.
        examinerBlobs = []
        for (const p of proofTests) {
          const land = landingOf(p)
          examinerBlobs.push([land, await blobShaIn(examDir, land)])
        }
        ensurePackageInits(examDir, examinerBlobs.map(([p]) => p))
        // The probe runs the exam on a tree at BASE, in the examiner's own
        // clone, so its pass is named `base` rather than numbered: a state
        // exam's record from here measures what the patch has not done yet,
        // and the read-back ranks it out (never `base`) for that reason.
        const atBase = await sh(examRunCmd, examDir,
          examEnv({ base: baseShaForTask, task: task.id, runDir: runDirAbs, pass: 'base' }))
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
    //
    // A function rather than a block because it happens twice (#1037): the
    // exam-rejected round below rewrites the exam in the examiner's own clone,
    // and the bytes reach the graded tree by exactly this crossing again.
    const handoffExam = async () => {
      const handed = []
      for (const [p, sha] of examinerBlobs) {
        if (!sha) continue
        const dest = path.resolve(cloneDir, p)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(path.resolve(examDir, p), dest)
        handed.push(p)
      }
      // …and the Proof path is put back to BASE wherever the exam landed
      // somewhere else, so the branch holds the measurement once, where the
      // reserved directory says, and nothing at the path the Proof named.
      for (const [p] of examMoves) await restoreToBase(cloneDir, p)
      ensurePackageInits(cloneDir, handed)
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
        await kataTouched(kataRow, impl.patch)
      }
      examBlobs = []
      for (const [p] of examinerBlobs) examBlobs.push([p, await blobShaOf(p)])
    }
    // The paths the examiner's blobs are read at, re-read from the examiner's
    // own clone: a second round may write a path the first left absent, and a
    // BLOCKED second round leaves every blob exactly as it was, which makes the
    // re-handoff the no-op it should be.
    const readExaminerBlobs = async () => {
      const rows = []
      for (const p of proofTests) {
        const land = landingOf(p)
        rows.push([land, await blobShaIn(examDir, land)])
      }
      return rows
    }
    if (examinerBlobs) {
      await handoffExam()
      examEdited = []
      // The first exam round has run, and the row says so from here on (#1037).
      examRounds = 1
    }

    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
      // BLOCKED on a sibling still in flight is a missing edge, not a failure
      // (#979): the worker filed it on its own issue before returning, and the
      // task waits for that sibling rather than ending here. A link naming no
      // sibling of this run — and a NEEDS_CONTEXT, which says nothing about a
      // dependency — is the failure it is at BASE.
      const waitingOn = impl.status === 'BLOCKED'
        ? await blockingSiblingsOf(task, kataRow) : []
      if (waitingOn.length) return reEdgedRow(task, waitingOn, impl.summary)
      return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
               reviewVerdict: 'not-reviewed', notes: impl.summary,
               tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
               ...examEditedField(), ...examRoundsField() }
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
               ...examEditedField(), ...examRoundsField() }
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
        const r = await sh(cmd, cloneDir, examEnv({ base: baseShaForTask, task: task.id,
                                                    runDir: runDirAbs, pass: String(iter) }))
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
    // The event carries the same output tail the fix prompt reads (#944), so a
    // parked task's red is legible from the tag and the hub without the VM.
    // `rerun: true` marks the one re-execution the park below may buy; a green
    // re-run also says `flaky: true`, which is where that fact is first known.
    const runExam = async (iter, rerun = false) => {
      if (!examRunnable) return null
      const r = await sh(examRunCmd, cloneDir, examEnv({ base: baseShaForTask, task: task.id,
                                                        runDir: runDirAbs, pass: String(iter) }))
      const stdout = tail(r.stdout + r.stderr)
      // A red row says what the red was about and what the driver read: the
      // exam's landing paths beside the task's own files, the last line of the
      // output tail, and the command at the head of the graded tree. A green
      // row gets no key at all — `examReceiptOf` answers `null` and the spread
      // adds nothing, so every existing pin of the green shape still holds.
      // The landings are computed here rather than read from `examLandings`
      // below: this runs on the pre-review pass, before that `const` is
      // initialized.
      const receipt = examReceiptOf({ cmd: examRunCmd, exit: r.code, stdout,
                                      headSha: impl.headSha,
                                      landings: proofTests.map(landingOf),
                                      files: Array.isArray(task.files) ? task.files : [] })
      appendEvent({ kind: 'driver:exam-run', task: task.id, cmd: examRunCmd, exit: r.code, iter,
                    stdout, ...(rerun ? { rerun: true, ...(r.code === 0 ? { flaky: true } : {}) } : {}),
                    ...(receipt || {}) })
      return { cmd: examRunCmd, exit: r.code, stdout }
    }
    const runChecks = async (iter) => {
      const checks = []
      for (const c of constraintChecks) {
        const r = await sh(c.cmd, cloneDir, examEnv({ base: baseShaForTask, task: task.id,
                                                      runDir: runDirAbs, pass: String(iter) }))
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
        ' — recorded for the reviewer, blocking nothing')
    }
    const RUN_FAIL = (r) => 'the Proof\'s Run: command failed: ' + r.cmd + ' — exit ' + r.exit
    const CHECK_FAIL = (c) => 'the Global Constraints Check: command failed: ' + c.cmd +
      ' — exit ' + c.exit
    // A red exam is a red of the same standing as a red `Run:`: the Proof's
    // `Test:` paths are the task's contract just as its `Run:` commands are.
    const EXAM_FAIL = (e) => 'the Proof\'s exam failed: ' + e.cmd + ' — exit ' + e.exit
    // ── the producer's post, against its own expected file (#998 ticket 5) ──
    // A task that posted the state it reached is held to it at the same pass
    // that runs its `Run:` commands: the file its patch carries at `expected`
    // is read out of the graded clone — the tree the captured patch describes —
    // and compared with what was posted. Agreement is a fact on the record and
    // nothing else. A disagreement is ONE blocking finding on this task, actor
    // `implementer`, and it buys the `fix:<id>:0` round every other red of this
    // pass buys: the producer is the one party that can move either side, and
    // the differing cell is named so the round knows which one to move. A post
    // the driver refuses on shape (M5) is the same finding naming the field —
    // never a cell comparison, and never a fact.
    const HANDSHAKE = (detail) => 'handshake: ' + detail
    const handshakeCheck = async () => {
      if (!kataOn) return null
      const read = await readStateReached(task.id)
      if (!read || read.raw === undefined) return null
      const fail = (detail, stdout = '') => {
        const finding = { severity: 'blocking', actor: 'implementer', detail: HANDSHAKE(detail) }
        raiseFinding(task.id, finding)
        return { line: finding.detail, stdout }
      }
      const posted = tail('state.reached: ' + canonicalJson(read.raw), 2000)
      if (!read.post) {
        return fail('state.reached ' + (read.fault === 'content'
          ? 'content is not an array of exactly two elements'
          : 'expected is not a path under ' + HANDSHAKE_ROOT), posted)
      }
      const sha256 = noteHandshakeFact(task.id, read.post)
      const at = path.resolve(cloneDir, read.post.expected)
      if (!fs.existsSync(at)) {
        return fail(read.post.expected + ' is absent from the captured tree', posted)
      }
      let onDisk
      try { onDisk = JSON.parse(fs.readFileSync(at, 'utf8')) } catch {
        return fail(read.post.expected + ' is not readable JSON', posted)
      }
      if (canonicalJson(onDisk) === canonicalJson(read.post.content)) {
        noteHandshakeSettled(task.id, read.post, sha256)
        return null
      }
      return fail(firstDifferingCell(read.post.content, onDisk) ||
        (read.post.expected + ' is not the [tables, values] pair that was posted'), posted)
    }
    // #713 Task 1: the pass's evidence is KEPT, not discarded. Round 1 reads
    // the tree the pass measured — no fix stands between them — so executing
    // again would record the same commands twice and bill the clone for it.
    // A task with no `Run:`, no `Check:` and no runnable exam leaves these
    // empty, which is exactly what its round-1 blocks carried at BASE.
    let preRuns = []
    let preExam = null
    let preChecks = []
    const prePass = async () => {
      const reds = []
      preRuns = await runCommands(0)
      for (const r of preRuns) {
        if (r.exit !== 0) reds.push({ line: RUN_FAIL(r), stdout: r.stdout })
      }
      preExam = await runExam(0)
      const e = preExam
      if (e && e.exit !== 0) reds.push({ line: EXAM_FAIL(e), stdout: e.stdout })
      preChecks = await runChecks(0)
      for (const c of preChecks) {
        if (c.exit === 0) continue
        if (c.minor) { noteMinorCheck(c); continue }
        reds.push({ line: CHECK_FAIL(c), stdout: c.stdout })
      }
      // Last, after the commands: the post is a claim about the tree those
      // commands just read, so it is judged against the tree they left.
      const handshake = await handshakeCheck()
      if (handshake) reds.push(handshake)
      return reds
    }
    // The fix round's `exam:` entries, when they bought the review round below
    // (#908). Empty on every other task, which is what keeps their review
    // prompts unchanged.
    let examConcerns = []
    let reds = await prePass()
    if (reds.length) {
      // ── the implementer's own plan-defect against a Proof leg (#722) ────
      // The actor question the reviews already answer (`routeToPlan`) is
      // asked one round earlier here, by the one agent that read the leg and
      // the tree together. A leg no implementation can satisfy — one that
      // reads state the patch creates, or asserts a shape a sibling's
      // contract forbids — is not a red the implementer can clear: it may
      // not edit the exam (#663), so a fix round buys a second agent that
      // lands exactly where the first did. When the reply names the leg by
      // its label in a `plan-defect:` concern AND the pass found that same
      // exam red, the task is parked for the plan instead of billed for the
      // round: `failed`, actor `plan`, and the concern travels to the gate
      // as a `deferred:plan-defect` item. A red `Run:` or `Check:` beside
      // the red exam does not change the answer — the exam's red plus the
      // leg-naming concern is the whole condition.
      //
      // Both halves were misread once (#944, ultraviz run-2 task 3): the red
      // was a one-off renderer failure, and the concern cited `(a)` in a note
      // about an ambiguity it had resolved. So the concern must SAY the leg
      // cannot pass (`legCannotPass`), and the driver re-runs the red exam
      // once — same clone, same env — before it believes it: green on the
      // re-run is green (the pass proceeds as if it had been), red twice
      // beside the concern is the park. An ordinary red, with no such
      // concern, still buys the one repair round below and no re-run.
      const examRedLine = (preExam && preExam.exit !== 0) ? EXAM_FAIL(preExam) : null
      const examIsRed = Boolean(examRedLine) && reds.some((r) => r.line === examRedLine)
      let legDefects = (examIsRed && impl.status === 'DONE_WITH_CONCERNS' &&
        Array.isArray(impl.concerns))
        ? impl.concerns.map(String).filter(legCannotPass)
        : []
      if (legDefects.length) {
        const again = await runExam(0, true)
        if (again && again.exit === 0) {
          judgmentCalls.push('task ' + task.id + ': the exam was red once and green on the ' +
            'driver\'s re-run — read as green (flaky), the plan-defect concern recorded and ' +
            'no park — ' + legDefects.join('; '))
          preExam = again
          reds = reds.filter((r) => r.line !== examRedLine)
          legDefects = []
        }
      }
      if (legDefects.length) {
        const notes = legDefects.join('; ')
        parkedForPlan.push({ task: task.id, why: notes })
        judgmentCalls.push('task ' + task.id + ': plan-defect against a Proof leg named by ' +
          'the implementer — no fix round dispatched; failed with actor plan — ' + notes)
        log('task ' + task.id + ' parked for the plan — ' + notes)
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'plan-defect', notes, actor: 'plan',
                 tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                 ...examEditedField(), ...examRoundsField() }
      }
    }
    // #990 — the amendments the review round will read. `impl` is reassigned to
    // the fix reply below when the pass bought a round, so the implementer's own
    // declarations are held here, before that happens; the fix round's are
    // appended after them at the prompt, in the order they were made.
    const implAmendments = amendmentsOf(impl)
    // A flaky exam beside an otherwise-green pass leaves `reds` empty here, and
    // an empty pass buys no round — the task goes straight to review.
    if (reds.length) {
      // The meaning of `proofFixes`: the pass was red once and bought a round.
      proofFixes = 1
      judgmentCalls.push('task ' + task.id + ': the driver\'s pre-review pass was red (' +
        reds.map((r) => r.line).join('; ') + ') — one repair round before any reviewer read the patch')
      await postReviewRound(kataRow, 0, reds.map((r) => r.line))
      impl = await agent(
        roles.fix + taskBodyBlock(task, wavesPath) + proofsInputs +
          filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) +
          '\n\nBlocking issues to resolve:\n' +
          reds.map((r) => '- ' + r.line + '\n  output (last 4,000 characters):\n' + r.stdout).join('\n'),
        { label: 'fix:' + task.id + ':0', isolation: 'worktree',
          model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA })
      if (impl === null) throw new Error('AGENT_NULL: pre-review fix agent returned null (terminal Overloaded or skipped)')
      stripUntrustedPatch(impl, patchPrefix)
      noteConcerns(impl)
      noteAmendments(impl)
      await noteDrift('the fix round')
      if (hasCoordinates(impl)) await kataTouched(kataRow, impl.patch)
      if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') && !hasCoordinates(impl)) {
        judgmentCalls.push('task ' + task.id + ': pre-review fix round lost driver-captured coordinates (' +
          (impl.captureError || 'capture absent') + ') — failed before review')
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'lost-coordinates',
                 notes: 'pre-review fix round produced no driver-captured patch/headSha',
                 tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                 ...examEditedField(), ...examRoundsField() }
      }
      if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
        // Same reading as the implementer's own BLOCKED above: `fix.md` teaches
        // the fix round the same three moves, so a round that files
        // `--blocked-by` against a sibling still in flight re-edges the task
        // rather than ending it.
        const waitingOn = impl.status === 'BLOCKED'
          ? await blockingSiblingsOf(task, kataRow) : []
        if (waitingOn.length) return reEdgedRow(task, waitingOn, impl.summary)
        return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                 reviewVerdict: 'blocked-after-fix', notes: impl.summary,
                 tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                 ...examEditedField(), ...examRoundsField() }
      }
      reds = await prePass()
      if (reds.length) {
        // ── the fix round's `exam:` concern beside a still-red exam (#908) ──
        // The park above assumes a red proof is the patch's own failure, which
        // is the honest reading of a red `Run:` or `Check:` — those the graded
        // party can always clear. A red exam is the one red it may not: since
        // #653 the exam arrives over the Proof `Test:` paths from a peer, and a
        // case no output can satisfy stays red however good the implementation
        // is. The fix round is the round that holds those bytes, so it is the
        // one party that can say so, and `fix.md` already tells it to say so as
        // a `concerns` entry prefixed `exam:` rather than edit around it. That
        // entry beside the same pass's red exam buys a reviewer instead of a
        // park: the referee reads the exam in PATCH against the driver's own
        // red output, and either proposes the patch that fixes the case or
        // names what the claim gets wrong (reviewer.md rule 8). Nothing merges
        // on the implementer's word — round 1 re-appends the red exam as a
        // blocking issue whatever the reviewer returned, so a reviewer that
        // waves it through still ends at `fix-loop-exhausted`.
        const examStillRedLine = (preExam && preExam.exit !== 0) ? EXAM_FAIL(preExam) : null
        const examStillRed = Boolean(examStillRedLine) &&
          reds.some((r) => r.line === examStillRedLine)
        const entries = (examStillRed && impl.status === 'DONE_WITH_CONCERNS' &&
          Array.isArray(impl.concerns))
          ? impl.concerns.map(String).filter((c) => /^exam:/.test(c))
          : []
        if (!entries.length) {
          const notes = reds.map((r) => r.line).join('; ')
          judgmentCalls.push('task ' + task.id + ': still red after the pre-review repair round (' +
            notes + ') — no reviewer was dispatched')
          log('task ' + task.id + ' proof-red after the pre-review repair round')
          return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
                   reviewVerdict: 'proof-red', notes,
                   tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                   ...examEditedField(), ...examRoundsField() }
        }
        examConcerns = entries
        judgmentCalls.push('task ' + task.id + ': exam concern from the fix round beside a ' +
          'still-red exam (' + entries.join('; ') + ') — review round 1 dispatched to judge ' +
          'the exam instead of parking proof-red')
        log('task ' + task.id + ' exam concern after the pre-review repair round — ' +
          'the reviewer reads it')
      }
    }

    // The round's own minor findings, de-duplicated, for the row's notes. They
    // were also carried from round 1 into round 2 (2026-09-01, run-47 read) so
    // the second reviewer would not re-find what the first had recorded; with
    // one round there is no second reviewer to tell, and the list is simply
    // what the report keeps.
    const minorFindings = []
    // ── where this task's exam landed, and reading one off a finding (#1037) ─
    // The reviewer's issue object carries no file field (`REVIEWER_SCHEMA`), so
    // the path is read off the detail's backticked tokens exactly as
    // `routeToPlan` below already reads plan-defect tokens. A token counts when
    // it IS a landing path or is that path followed by `:<digits>` or
    // `:<digits>-<digits>` — run-15's finding cited
    // `…/delete-to-trash.test.ts:129-144`, which is why the line range is
    // admitted and why nothing else is.
    const examLandings = proofTests.map((p) => landingOf(p))
    const examPathIn = (detail) => {
      for (const m of String(detail || '').matchAll(/`([^`]+)`/g)) {
        const token = m[1]
        for (const land of examLandings) {
          if (token === land) return land
          if (token.startsWith(land + ':') && /^:\d+(?:-\d+)?$/.test(token.slice(land.length))) {
            return land
          }
        }
      }
      return null
    }
    // ONE review round (#964 Task 2), and one more only when the round's
    // blocking finding is against the EXAM rather than the implementation
    // (#1037). A blocking issue ends the task at the `fix-loop-exhausted` exit
    // below instead of buying a repair and a second reading: the 2026-09-13
    // review reading counted 27 first fix rounds against 9 second, and runs
    // with a fix merged 11 times of 17. What the exam-rejected round buys is
    // not a second reading of the same patch — it is the one party that CAN act
    // on that finding getting a round to act on it, since the graded party may
    // not edit the exam (#663) and a fix round would land exactly where the
    // first did (run-15 task 1: `fix-loop-exhausted, fixIterations: 0`, the
    // examiner never asked). `iter` is the round number the label and the
    // driver's `iter:` fields carry: 1, or 2 after a rejection.
    let iter = 1
    for (;;) {
      // ── the `Run:` proofs (#589) ─────────────────────────────────────────
      // Once per FIX, not once per round (#713 Task 1): the round reads the
      // pre-review pass's evidence, because nothing edited the tree between
      // that pass and this dispatch. With one round nothing edits it after the
      // dispatch either — no post-fix round executes afresh, so the pass is the
      // only execution a referee ever reads. An exam-rejected round edits the
      // EXAM and nothing else, so round 2 reads the same `Run:` and `Check:`
      // evidence round 1 did.
      const runEvidence = preRuns
      // The exam and the Check:s on the same terms (#638). `preExam` is
      // reassigned to the `iter: 2` run when an exam-rejected round ran, so
      // round 2's referee reads the rewritten exam's own output.
      const examEvidence = preExam
      const checkEvidence = preChecks
      // The hunks of the tree this round is reading — the pre-review repair
      // round is the one thing that can have edited the exam before it.
      const editedDiffs = await examEditedDiffs()
      // ── the reviewer a killed mutant buys nothing from (#836) ─────────────
      // The experiment, default off: a task whose pre-review pass came back
      // green all the way — every `Run:` 0, the exam 0 or not runnable, every
      // non-minor `Check:` 0, and no `exam:` concern to judge (#908) — and
      // whose state-exam record says every mutant was killed has had its whole
      // claim measured by the driver already. `stateExamBlock` would tell the
      // referee exactly that and then ask it to read the diff anyway; here the
      // round is simply not dispatched, on the SAME predicate the block uses,
      // so the settled block and the skip can never disagree about what "every
      // mutant killed" means. What the task still gets is everything the driver
      // owns — the pass, the one repair round, the fold, the candidate suite,
      // the integrated `Run:`/`Check:` re-execution and the pre-merge gate.
      // What it loses is the referee's lens. The judgment call is the record:
      // no new event kind, and no hub post, because a reviewer's findings never
      // reach a task issue anyway.
      const stateExamRows = stateExamRowsOf(runDirAbs, task.id)
      if (!reviewOnStateExams && examConcerns.length === 0 &&
          runEvidence.every((r) => r.exit === 0) &&
          (!examEvidence || examEvidence.exit === 0) &&
          checkEvidence.every((c) => c.exit === 0 || c.minor) &&
          everyMutantKilled(stateExamRows)) {
        judgmentCalls.push('task ' + task.id + ': every mutant killed (' +
          stateExamRows.map((r) => r.exam).join(', ') +
          ') — no reviewer was dispatched (reviewOnStateExams off)')
        log('task ' + task.id + ' every mutant killed — no reviewer dispatched ' +
          '(reviewOnStateExams off)')
        // The `done` row of the clean review below, less what no reviewer
        // produced: `minorFindings` and `planNotes` are empty by construction,
        // so the notes are the concerns alone.
        return { task: task.id, baseCorrected, status: 'done', branch: '', exam,
                 headSha: impl.headSha, patch: impl.patch,
                 reviewVerdict: 'skipped-mutant-killed',
                 notes: concerns.map((c) => 'concern: ' + c).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                 ...examEditedField() }
      }
      const reviewPrompt = roles.reviewer + taskBodyBlock(task, wavesPath) +
        '\nPATCH: ' + impl.patch +
        '\nHEAD: ' + impl.headSha +
        '\nBASE: ' + baseShaForTask + filesLine(task) + siblingsStr +
        globalConstraintsBlock + interfacesLine(task) +
        (examEdited && examEdited.length ? '\nEXAM EDITED: ' + examEdited.join(', ') : '') +
        examEditedDiffBlock(editedDiffs) +
        runEvidenceBlock(runEvidence) + examEvidenceBlock(examEvidence) +
        // After the exam's own output, never before it (#908): the red bytes
        // are the driver's fact and the concern is the graded party's claim
        // about them.
        examConcernBlock(examConcerns) +
        // After the concerns about the exam, before the constraint checks
        // (#990): the worker's own declaration of where it diverged, the
        // implementer's entries first and the fix round's after them when a
        // round ran. A task whose replies declared none renders nothing here,
        // so its prompt is the one it had before this existed.
        amendmentBlock(implAmendments.concat(proofFixes ? amendmentsOf(impl) : [])) +
        checkEvidenceBlock(checkEvidence) +
        // Read in the ROUND, not at the pre-review pass (the rows above): the
        // round grades the tree the pre-review repair round left, so it must
        // read the record that round's own exam pass wrote rather than the
        // first pass's.
        stateExamBlock(stateExamRows)
      // One reviewer per round, whatever the task's `**Review:**` value says
      // (#964 Task 2). The label carries no trailing pass number, because there
      // is no second half to distinguish from the first: `review:<id>:<iter>`.
      // `peer` still means the patch is reviewed and `lean` still means it is
      // not reviewed by a PAIR — the profile survives as the run's record of
      // what the plan asked for, not as a second bill.
      const reviewOpts = () => ({
        label: 'review:' + task.id + ':' + iter,
        model: REVIEWER_MODEL, schema: REVIEWER_SCHEMA,
      })
      const leanOpts = reviewOpts()
      let review = await timedReview(reviewPrompt, leanOpts)
      // The one reviewer is single-dispatch and its death parks the task: one
      // re-dispatch after the backoff (#830).
      if (review === null) {
        review = await retryInfraNull(leanOpts.label, 'task ' + task.id + ': ',
          () => timedReview(reviewPrompt, leanOpts))
      }
      if (review === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
      let issues = review.issues || []
      const verdicts = [review.verdict]
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
        if (!minorFindings.some((p) => p.detail === m.detail)) minorFindings.push(m)
      }
      if (blocking.length === 0) {
        if (verdicts.indexOf('FIX_REQUIRED') !== -1 && planNotes.length === 0) {
          judgmentCalls.push('task ' + task.id +
            ': reviewer said FIX_REQUIRED with no blocking issues — merged on the severity rule')
        }
        return { task: task.id, baseCorrected, status: 'done', branch: '', exam,
                 headSha: impl.headSha, patch: impl.patch,
                 reviewVerdict: 'clean',
                 notes: minorFindings.map((m) => m.detail)
                   .concat(planNotes)
                   .concat(concerns.map((c) => 'concern: ' + c)).join('; '),
                 tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
                 ...examEditedField(), ...examRoundsField() }
      }
      // ── the finding against the EXAM, not the patch (#1037) ──────────────
      // Asked here, after plan routing has taken the plan's issues out: what
      // remains is a finding somebody is expected to act on, and when the file
      // it names is the exam's own landing path the one party that can act on
      // it is the peer who wrote the exam. So the finding is handed back to
      // that peer, in the clone it still holds, with one round to rewrite the
      // leg — and only the round AFTER that can call the task exhausted. Round
      // 2 never re-enters here (`iter === 1`), so the examiner gets one round
      // and never two, and no `fix:<id>:<iter>` is dispatched from either
      // round: the implementation was never what the finding was about.
      const rejections = (iter === 1 && examinerBlobs)
        ? blocking.map((b) => ({ path: examPathIn(b.detail), detail: String(b.detail || '') }))
            .filter((r) => r.path)
        : []
      if (rejections.length) {
        for (const r of rejections) {
          appendEvent({ kind: 'driver:exam-rejected', task: task.id, path: r.path,
                        detail: r.detail })
        }
        judgmentCalls.push('task ' + task.id + ': review round ' + iter + '\'s blocking ' +
          'finding names the exam at ' + [...new Set(rejections.map((r) => r.path))].join(', ') +
          ' — the examiner gets one round to rewrite it, and no fix round is dispatched: ' +
          rejections.map((r) => r.detail).join('; '))
        log('task ' + task.id + ' exam rejected by the review — one examiner round')
        // The examiner's own clone is NOT re-cut: it still holds the exam it
        // wrote, and the round is a rewrite of that file rather than a second
        // attempt at it. The prompt is the first round's, byte for byte, with
        // the referee's details appended as one labelled block — `examiner.md`
        // is where that block's meaning is spelled.
        let ex2 = null
        try {
          ex2 = await agent(
            examPrompt + '\n\nEXAM REJECTED:\n' + rejections.map((r) => r.detail).join('\n'),
            { ...examOpts, label: 'exam:' + task.id + ':2' })
        } catch (e) {
          // An examiner that dies here must not climb: the implementation is
          // finished and captured, and a whole-pair retry would throw it away
          // to re-earn a finding the run already has. It reads exactly as a
          // BLOCKED round — the exam stands, round 2 runs.
          ex2 = null
          log('task ' + task.id + ' exam-rejected round died — round 2 on the unchanged exam')
        }
        examRounds = 2
        if (!ex2 || ex2.status !== 'DONE') {
          // A dead or BLOCKED second examiner leaves the exam exactly as it
          // was: the re-read below finds the same blobs, the re-handoff copies
          // the same bytes, and round 2 reads the unchanged tree. Never a
          // failure of this task — the same standing the first round's BLOCKED
          // already has.
          judgmentCalls.push('task ' + task.id + ': the exam-rejected round ' +
            (ex2 ? (ex2.status + ' (' + (ex2.summary || 'no summary') + ')') : 'returned no reply') +
            ' — the exam stands as it was and review round 2 reads the unchanged tree')
        }
        for (const u of ((ex2 && Array.isArray(ex2.unsatisfiable)) ? ex2.unsatisfiable : [])) {
          judgmentCalls.push('task ' + task.id + ': exam-rejected round: ' + u.leg + ' — ' + u.why)
        }
        // The same handoff the pair's exam took, on the rewritten bytes: the
        // blobs are re-read from the examiner's clone (a round may write a path
        // the first left absent), copied over the graded tree, the capture
        // retaken, and the drift baseline refreshed so round 2's EXAM EDITED
        // reads against what the peer left THIS round.
        examinerBlobs = await readExaminerBlobs()
        ensurePackageInits(examDir, examinerBlobs.map(([p]) => p))
        await handoffExam()
        // And the exam runs again on the graded tree, as this round's pass —
        // which is the evidence round 2's referee reads, and the red that
        // outranks whatever it returns.
        preExam = await runExam(2)
        iter += 1
        continue
      }
      // The round's blocking issues end the task (#964 Task 2). This is the
      // `fix-loop-exhausted` exit that already existed at the bottom of the
      // loop; what changed is that it is now reached after the FIRST red rather
      // than the second, and no fix worker is dispatched from here — the only
      // repair round a task gets is the pre-review `fix:<id>:0` above, which
      // answers the driver's own evidence rather than a referee's reading. An
      // exam-rejected round is the one thing that defers this exit, and then it
      // is reached from round 2 instead (#1037).
      // `fixIterations` is therefore 0 on every row: no round a REVIEWER's
      // findings drove exists any more.
      return { task: task.id, baseCorrected, status: 'failed', branch: '', exam,
               reviewVerdict: 'fix-loop-exhausted', notes: blocking.map((b) => b.detail).join('; '),
               tier: economics.tier, review: economics.review, fixIterations: 0, proposedPatches, proofFixes,
               ...examEditedField(), ...examRoundsField() }
    }
  }

  async function runTask(task, baseShaForTask, siblingsStr) {
    try {
      return await runTaskInner(task, baseShaForTask, siblingsStr)
    } catch (e) {
      // A kata disagreement is not this task's failure and no retry can clear
      // it: the record and the hub say different things about what this run is.
      // It climbs out of the wave to run-main, which ends the run.
      if (isKataFatal(e)) throw e
      const msg = String((e && e.message) || e)
      if (isInfraFault(msg)) {
        judgmentCalls.push('task ' + task.id + ': infra-death (' + msg +
          ') — parked for one retry when a slot frees (no immediate retry into the live storm)')
        log('task ' + task.id + ' infra-death — parked for a slot-free retry')
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
        if (isKataFatal(e2)) throw e2
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
  // (`KERNEL` and `waveDirOf` are declared up beside `integ`: Setup's reuse
  // fold needs them before this line is reached.)

  // ── the reuse fold (#383) — wave 0, before wave 1 ──────────────────────────
  // The publish fold's shape, run at Setup: two patches against the parked
  // run's base (`main=` this run's BASE since that base, `reuse=` the parked
  // run's own `run.patch`), materialized onto BASE so the candidate's single
  // parent IS this run's BASE and its tree is BASE plus the parked work.
  //
  // Deliberately NOT `foldWave`: no worker exists yet, so no resolver can be
  // dispatched and no reconcile round can repair a red candidate. Anything the
  // kernel cannot fold cleanly is a refusal, and the full plan runs. The
  // frontier entry rides `frontier` exactly as a wave's does.
  async function foldReuse({ parkedBase, mainPatch, runPatch, tag }) {
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
    const pushEntry = () => frontier.push({
      wave: 0,
      foldLogPath: path.join(waveDirOf(0), 'fold_log.jsonl'),
      conflictsIndex: path.join(waveDirOf(0), 'conflicts.json'),
      selfChecks,
      foldCliCalls: calls,
      foldCliWallTimeSec: calls ? wallSec : null,
      autoResolved,
      resolverTranscripts: [],
    })
    // One sentence per way of giving up, and it leaves here with the answer:
    // the caller's `driver:reuse` and its log line say what the fold said, not
    // that a head failed to appear (#1037 §1).
    const give = (reason) => {
      pushEntry()
      judgmentCalls.push('reuse fold of ' + tag + ': ' + reason)
      return { head: null, reason }
    }
    const common = ['--repo', '.', '--run-dir', runDir, '--wave', '0']
    // main FIRST, as the publish fold orders it: the frontier side of every
    // hunk is what main gained since the parked base, and the incoming side is
    // the parked run's work.
    const taskArgs = ['--patch', 'main=' + mainPatch, '--patch', 'reuse=' + runPatch]

    const fold = await runCli(['fold', ...common, '--base', parkedBase, ...taskArgs])
    const f = fold.parsed
    if (!f) return give('fold printed no verdict (exit ' + fold.code + '): ' + tail(fold.stderr, 300))
    if (typeof f.selfChecks === 'string') selfChecks = f.selfChecks
    if (f.complete !== true || (Array.isArray(f.open) && f.open.length) ||
        (typeof f.conflicts === 'number' && f.conflicts > 0) || fold.code !== 0) {
      return give('the parked run\'s work and main\'s move since ' + parkedBase.slice(0, 7) +
        ' do not fold cleanly (' + (f.conflicts || 0) + ' conflict(s)); no resolver exists at Setup')
    }
    const subjectArgs = planTitle ? ['--subject', planTitle] : []
    const mat = await runCli(['materialize', ...common, '--prev-head', baseSha,
      ...taskArgs, ...subjectArgs])
    const m = mat.parsed
    if (!m || !m.candidateSha) {
      return give('materialize refused: ' + ((m && (m.park || m.fallback)) || tail(mat.stderr, 300)))
    }
    pushEntry()
    await git(['read-tree', '-u', '--reset', m.candidateSha + '^{tree}'], integ)
    await git(['reset', '--hard', m.candidateSha], integ)
    return { head: m.candidateSha, reason: null }
  }

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

    // #1019 (M1) — every `--patch` carries the anchor its patch was CAPTURED
    // against. Under the ready set a dispatch's tree can be older than the head
    // this epoch folds onto (`captureAnchors` above says why), and the kernel
    // applies such a patch over its OWN anchor and three-way merges the result
    // over the base rather than refusing it. An anchor that IS `prevHead` is
    // the base, and rides as no `@` at all: a fold whose every patch is
    // same-anchored is the byte-for-byte call the engine made before anchors
    // existed, down to the fold log and the candidate tree.
    const anchorArg = (taskId) => {
      const anchor = anchorOf.get(taskId)
      return (typeof anchor === 'string' && anchor && anchor !== prevHead) ? ('@' + anchor) : ''
    }
    const taskArgs = merged.flatMap((r) => ['--patch', r.task + '=' + r.patch + anchorArg(r.task)])
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
      // Every resolver dispatch of a wave fold leaves a row: at BASE the wave
      // loop passed no `onEvent` at all, so a fold that spent two resolvers
      // showed `resolversDispatched: 2` and nothing about what either said.
      onEvent: appendEvent,
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
    // #825 — the candidate's own install, before its suite. The setup loop
    // bootstrapped this clone at BASE and knows nothing about a manifest the
    // fold changed, so a suite run straight off the read-tree fails on a
    // missing module and hands the reconcile agent a module-not-found line
    // instead of the install's own error. This is the ONLY new site: the adopt
    // below is `reset --hard` in this same directory and the install is
    // untracked, so it survives adoption (and the TEST_FAILED path's
    // `git clean -fd`, which has no `-x`) — nothing to re-run afterwards.
    let bootstrapRed = null
    if (bootstrapCmd) {
      const changed = await git(['diff', '--name-only', prevHead, candidate], integ)
      if (bootstrapManifestChanged(changed.split('\n').map((s) => s.trim()).filter(Boolean))) {
        const b = await sh(bootstrapCmd, integ)
        if (b.code !== 0) {
          // Unlike the three older bootstrap sites, this one does not shrug and
          // carry on: a candidate whose install broke is RED on the install's
          // output, so the reconcile agent reads the real error.
          judgmentCalls.push('wave ' + waveNumber + ': candidate bootstrap failed (exit ' +
            b.code + ') — the candidate is red on the install, not on its suite: ' +
            tail(b.stderr || b.stdout, 300))
          log('wave ' + waveNumber + ' candidate bootstrap failed (exit ' + b.code + ')')
          bootstrapRed = b
        }
      }
    }
    // A failed bootstrap stands IN PLACE of the suite run — `suite` carries the
    // install's stdout/stderr, so every downstream reader (the reconcile
    // prompt, the TEST_FAILED detail) quotes the install and none of them
    // quotes a suite that never ran on this candidate.
    let suite = bootstrapRed || await sh(testCmd, integ)
    if (suite.code === 0) {
      await git(['reset', '--hard', candidate], integ)
      await emitWeave(candidate)
      frontier.push(entry())
      return { status: 'MERGED', headSha: candidate,
               suite: { passed: true, output: tail(suite.stdout + suite.stderr) } }
    }
    // Red candidate: BASE's own verdict is settled before anyone is dispatched
    // at it. It settled in Setup, or settles here at the latest — and a RED one
    // never reaches this line, because the fold path parks the run before a
    // candidate is ever folded.
    await baselineSettled
    // ── the unattributed red (#871 decisions 1 and 4) ────────────────────────
    // A green baseline makes every candidate red the fold's own; it does not
    // make it any TASK's. When the paths that went red are named by no task of
    // this wave — not in its `files`, not in its `proofTests` — there is no
    // implementer to hold to it and no reconcile agent who could be told what
    // to repair: the candidate is adopted exactly as a green one is, and the
    // red is RECORDED, one judgment-call line per path, so the run keeps going
    // with the fact on the record rather than parking on someone else's test.
    // Attribution is string equality on the path the record spelled — no
    // globbing, no resolving — and it takes the WHOLE PLAN, not just the tasks
    // this epoch folded: a task whose review failed still names the files it was
    // given, and under the ready set the tasks beside this fold are not a wave a
    // fold could name. One attributed path in the list is enough to send the
    // candidate down the reconcile route below, as is an output that named no
    // path at all (a bare non-zero exit, a dead install).
    const failing = failingTestPaths(suite.stdout + suite.stderr)
    const claimed = new Set()
    for (const t of (PLAN.length > 0 ? PLAN : waveTasks)) {
      for (const key of ['files', 'proofTests']) {
        for (const p of (Array.isArray(t && t[key]) ? t[key] : [])) {
          if (typeof p === 'string' && p) claimed.add(p)
        }
      }
    }
    const unattributed = failing.filter((p) => !claimed.has(p))
    if (failing.length && unattributed.length === failing.length) {
      await git(['reset', '--hard', candidate], integ)
      await emitWeave(candidate)
      frontier.push(entry())
      for (const p of unattributed) {
        judgmentCalls.push('unattributed red: ' + p + ' went red on wave ' +
          waveNumber + '\'s fold; no task names it')
      }
      log('wave ' + waveNumber + ' candidate suite RED in ' + unattributed.join(', ') +
        ' — no task names it: adopted and recorded, no reconcile dispatched')
      return { status: 'MERGED', headSha: candidate,
               suite: { passed: false, unattributed,
                        output: tail(suite.stdout + suite.stderr) } }
    }
    for (let attempt = 1; attempt <= 2 && suite.code !== 0; attempt++) {
      log('wave ' + waveNumber + ' candidate suite RED — reconcile attempt ' + attempt)
      let rec
      try {
        rec = await agent(
          roles.reconcile + '\nTEST COMMAND: ' + testCmd +
            '\n\nFailing output:\n' + failingBlock(suite.stdout + suite.stderr),
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
               failingBlock(suite.stdout + suite.stderr) }
  }

  // ── the ready set: lanes, epochs, one fold at a time (#979) ────────────────
  // (waves.js pre-registered every phase up front for the Workflow tool's
  // roadmap API; here phase() appends timestamped events, so an up-front burst
  // would record the run entering every phase at t=0 — review finding 6. Each
  // phase is announced once, when it actually starts.)
  //
  // There is no barrier here. The plan's waves are read for two things only:
  // plan ORDER (the order the record names tasks in, which is the order a lane
  // reads the ready set in) and the report's forecast. What decides when a task
  // runs is the RECORD. A task is READY when it has not been dispatched, has
  // not failed, is not downstream of a failed or blocked task, and every task an
  // edge names as its predecessor has been ADOPTED — folded into the integration
  // head, not merely finished. A lane that frees takes the next ready task
  // instead of waiting for its wave's slowest, and a task's clone is anchored at
  // the adopted head of the moment it is dispatched.
  //
  // What a wave was, an EPOCH is: the set of results one fold adopts. The lane
  // that frees folds every captured result nobody has adopted yet, all of them
  // as one epoch, onto the current head — epochs numbered 1, 2, … in fold order,
  // each one's head a descendant of the one before, and only one fold at a time.
  // `wave` in the record means that number; the fold pipeline under it is the
  // same one the barrier ran.
  //
  // A lane does not fold at EVERY landing (#1006). A fold is a kernel fold, a
  // candidate suite and, when it goes green, the integrated passes — so a run of
  // independent tasks that folded per landing paid a suite each time for an
  // adoption nobody was waiting on. A lane that frees claims an epoch only when
  // the fold would do one of three things, and the event says which in `why`:
  // it RELEASES a queued task, it ENDS the run, or it adopts a result that has
  // AGED past `foldAgeMs`. See `foldTrigger` under readiness below.
  const WIDTH_FALLBACK = 12
  const W = (Number.isInteger(args.width) && args.width > 0) ? args.width : WIDTH_FALLBACK
  // How long a result nobody is waiting for may sit captured and unadopted
  // before a fold is spent on it alone (#1006). The run's argument when it is a
  // non-negative number — `0` folds at every landing, which is the rule before
  // this one — and otherwise a suite's length: the larger of a minute and the
  // wall the baseline suite actually took, the only measurement of what a fold
  // costs this run owns. `null` until the baseline settles, and a `null`
  // threshold is the age clause switched OFF rather than guessed: `released`
  // and `end` carry the run until the suite has answered.
  const FOLD_AGE_FLOOR_MS = 60000
  const foldAgeFixed = (Number.isFinite(args.foldAgeMs) && args.foldAgeMs >= 0)
    ? args.foldAgeMs : null
  const foldAgeMs = () => (foldAgeFixed !== null ? foldAgeFixed
    : (baselineWallMs === null ? null : Math.max(FOLD_AGE_FLOOR_MS, baselineWallMs)))
  // Plan order, flat: the order a lane reads the ready set in.
  const PLAN = WAVES.flat()
  const predecessorsOf = (id) => EDGES.filter(([, b]) => b === id).map(([a]) => a)
  const resultFor = (id) => taskResults.find((r) => r && r.task === id)

  // The head every dispatch is anchored at and every fold builds on: the reuse
  // head when Setup folded one (#383) and BASE otherwise.
  let adoptedHead = reuseHead || baseSha
  // Adopted = the work is IN that head. A reused task's work is in the reuse
  // head before the first epoch, so it is adopted from the start and anything an
  // edge points from it is ready.
  const adoptedIds = new Set(reusedIds)
  const dispatchedIds = new Set()
  // Captured, unadopted mergeable results in landing order — what the next fold
  // adopts — and the tasks whose one re-dispatch is owed (#903, M4).
  const pendingResults = []
  const parkedInfraQueue = []
  let inFlight = 0
  let foldingLanes = 0
  // Whether an epoch is claimed — taken by a lane and not yet adopted. One at a
  // time: the lane that frees while a fold is running does not open a second
  // epoch, it leaves its result pending for the fold that comes after.
  let epochClaimed = false
  let epochCount = 0
  let firstFold = true
  let parkedOnBaseline = false
  let lastSuite = null
  // Every path an epoch adopted red because no task of that epoch named it, in
  // fold order and once each — `lastSuite` carries only the LAST epoch's, and
  // the report owes the reader the run's whole list.
  const unattributedReds = []
  const compositionRows = (waveNumber, tasks) => {
    for (const line of compositionUnpinnedRows(waveNumber, tasks)) judgmentCalls.push(line)
  }

  // The next landing. A lane with nothing ready but work still moving waits on
  // this rather than spinning, and the two events that can change what "ready"
  // means — a result landing and a fold finishing — resolve it.
  let landingWaiters = []
  const nextLanding = () => new Promise((resolve) => { landingWaiters.push(resolve) })
  const announceLanding = () => {
    const waiting = landingWaiters
    landingWaiters = []
    for (const resolve of waiting) resolve()
  }
  // No timer arms the age clause (#1006). Once the clause asks that nothing is
  // in flight and no fold is running, it cannot come true while a lane sleeps: a
  // lane sleeps here only with results pending and no trigger for them, which
  // means a sibling is in flight or a fold is running — otherwise the claim just
  // asked would have been `end`, or the lane would have taken a ready task. Both
  // of those end in a landing or a fold release, and `announceLanding` resolves
  // at either, so the landing is the only wake a lane needs.

  // ── claiming an epoch ──────────────────────────────────────────────────────
  // What one fold adopts is decided HERE, and the moment this returns a set it
  // is decided: every captured, unadopted result of the instant the lane freed,
  // taken out of `pendingResults` in the same tick as the landing that freed it.
  //
  // The instant matters, and it is the landing's and not the fold's. A snapshot
  // taken where the fold itself begins is a snapshot taken some microtasks
  // later — the await that reaches the front of the fold queue, and before it
  // the awaits between a result being recorded and its lane asking to fold —
  // and a second result whose own landing falls inside that window would join
  // an epoch it did not land in. Two results co-land in one epoch when the
  // second arrives while a fold is RUNNING (it is refused a claim and the next
  // fold takes it), never because a lane took a few microtasks to ask.
  //
  // `null` means "not this lane": either nothing is pending, or an epoch is
  // already claimed, or the run has parked, or no fold trigger holds at this
  // instant (#1006). Every caller is synchronous with its landing, so the guard
  // needs no lock — a claim is taken and released without an await in between.
  //
  // A claim is `{ results, why, released? }`: what the fold adopts, and the
  // reading the record owes for having spent a fold on it. `foldTrigger` lives
  // under readiness below because that is the state it reads; nothing calls
  // either until the lanes run, so the order they are written in is free.
  const claimEpoch = () => {
    if (parkedOnBaseline || epochClaimed || pendingResults.length === 0) return null
    const trigger = foldTrigger()
    if (trigger === null) return null
    epochClaimed = true
    return { results: pendingResults.splice(0, pendingResults.length), ...trigger }
  }

  // One fold at a time (M2), whichever lane it is. The kernel's fold / resolve /
  // materialize / suite / reconcile sequence moves the integration clone's
  // working tree and its branch; two of them at once would interleave on the one
  // worktree, and the second would build on a head the first had not adopted
  // yet. A promise chain is the whole mechanism — every fold queues behind the
  // one before, and a fold that throws does not strand the queue.
  let foldChain = Promise.resolve()
  const underFoldLock = (fn) => {
    const done = foldChain.then(fn, fn)
    foldChain = done.then(() => {}, () => {})
    return done
  }

  // ── the red-baseline park (#862) ───────────────────────────────────────────
  // A run whose repository was already failing before it opened has nothing to
  // reconcile: every candidate it could build would be red for a reason no
  // implementer wrote and no reconcile agent can be held to. So the run parks —
  // before the first dispatch when the baseline settled during Setup, and before
  // the first fold when it settled later. Either way no fold is attempted, the
  // epoch is TEST_FAILED on the baseline's own block, the tasks still ready are
  // not dispatched, and the integration branch is left exactly where it was.
  const baselineIsRed = () => baseline !== null && baseline.passed === false
  // The one concession the "park before any worker" half needs. `.then` on a
  // pending promise never fires synchronously, so a lane that only READ the flag
  // would reach its first dispatch with the flag still unset however fast the
  // suite answered — a repository that is red in twenty milliseconds would still
  // dispatch its whole first round and park at the first fold. So the first
  // dispatch yields the baseline a bounded head start and NOT a wait: a suite
  // that answers inside the window parks the run with nothing dispatched, and
  // one that does not is left running while the lanes go out. Half a second,
  // because that is long enough for any suite that was going to answer instantly
  // and short enough to be nothing beside the seconds a real one takes — which
  // is what keeps the baseline off the critical path rather than on it.
  const BASELINE_HEAD_START_MS = 500
  const baselineHeadStart = () => Promise.race([baselineSettled,
    new Promise((resolve) => {
      const t = globalThis.setTimeout(resolve, BASELINE_HEAD_START_MS)
      // Unref'd: the baseline's own child process is what holds the loop open
      // while this races, and a head start must never be the reason a finished
      // run is still alive.
      if (t && typeof t.unref === 'function') t.unref()
    })])
  // `why` is the trigger of the claim that reached this park, so the blocked
  // epoch it appends reads like every other wave event (#1006). The park the
  // run's tail makes has no claim behind it and carries `end`: the run is over,
  // which is exactly what that call site knows.
  const parkOnRedBaseline = async (why = 'end') => {
    if (parkedOnBaseline) return
    parkedOnBaseline = true
    const epoch = epochCount + 1
    const detail = redBaselineHead(baseline.output) +
      ' — this run inherited that red: no candidate was tested and no reconcile ' +
      'was dispatched against it'
    // The branch never moved — no fold has run since the last adoption — so this
    // is a restoration, not a rollback: the same one the TEST_FAILED path inside
    // `foldWave` makes, kept here so the guarantee ("the integration branch
    // still resolves to the head the run was on") is stated at both exits.
    await git(['reset', '--hard', adoptedHead], integ)
    await exec('git', ['clean', '-fd'], { cwd: integ })
    // #877 — the block is a RECORD (see the adoption's own pair below). The ids
    // are every task this red held up, in plan order, and not the captured ones:
    // a run that parks before its first dispatch has no results at all, and an
    // event naming no task says nothing about which work this red held up.
    const held = PLAN.filter((t) => !adoptedIds.has(t.id)).map((t) => t.id)
    waveMerges.push({ wave: epoch, status: 'TEST_FAILED', detail,
                      branches: pendingResults.map((r) => r.task) })
    appendEvent({ kind: 'driver:wave-blocked', wave: epoch, tasks: held, detail, why })
    blockedWaves.push({ wave: epoch, detail })
    log('epoch ' + epoch + ' parked: the suite was already RED on BASE when the run opened')
    for (const id of held) {
      if (resultFor(id)) continue
      unfinished.push(id + ': never dispatched — the suite was already RED on BASE')
    }
  }

  // ── the re-edge (#979) ─────────────────────────────────────────────────────
  // A worker whose proof turns out to need a sibling still in flight files
  // `kata edit <me> --blocked-by <sibling>` and returns BLOCKED; kata keeps that
  // edge as a `blocks` link from the BLOCKER's side, so it comes back on this
  // task's issue as a link whose `from` is the sibling. Read once, after the
  // reply, through the non-fatal path: a hub that refuses the read answers no
  // links, and a BLOCKED with no link is the failure it is at BASE.
  //
  // What counts is a link naming another task OF THIS RUN that has not been
  // adopted — an adopted sibling's work is already in the tree this task was
  // handed, so nothing is waiting to arrive. A sibling that has FAILED still
  // counts: the edge is recorded and the dependency cascade then says what the
  // task is, which is `blocked — depends on a failed task`.
  //
  // One re-edge per task per sibling, which is what makes a cycle of them
  // impossible: the pairs already recorded are remembered here, and a second
  // BLOCKED naming one of them is the failure it is at BASE.
  const reEdges = new Map()
  const reEdgedOn = (id) => reEdges.get(id) || new Set()
  const blockingSiblingsOf = async (task, kataRow) => {
    if (!kataOn || !kataRow) return []
    const issue = await kataCall('getissue', null, () => kata.getIssue(kataRow.uid))
    const links = (issue && Array.isArray(issue.links)) ? issue.links : []
    const blockers = new Set()
    for (const link of links) {
      if (!link || typeof link !== 'object' || link.type !== 'blocks') continue
      const from = (link.from && link.from.uid) || null
      if (from && from !== kataRow.uid) blockers.add(from)
    }
    if (blockers.size === 0) return []
    const already = reEdgedOn(task.id)
    return PLAN
      .filter((t) => t.id !== task.id && !adoptedIds.has(t.id) && !already.has(t.id) &&
                     blockers.has((kataRowOf(t.id) || {}).uid))
      .map((t) => t.id)
  }
  // The row a re-edged task lands with: not a result, and never recorded as
  // one. `settleResult` reads this status and puts the task back to unstarted.
  const reEdgedRow = (task, blockedBy, notes) => ({
    task: task.id, status: 're-edged', blockedBy, notes: String(notes || ''),
  })

  // ── readiness ──────────────────────────────────────────────────────────────
  const isReady = (t) => {
    // #383 — folded in at Setup from the parked run's evidence. No worker of any
    // kind is dispatched for it: no exam, no implementer, no review, no fix, and
    // nothing on its issue.
    if (reusedIds.has(t.id)) return false
    if (dispatchedIds.has(t.id)) return false
    if (resultFor(t.id)) return false
    if (blockedByDep.has(t.id)) return false
    return predecessorsOf(t.id).every((p) => adoptedIds.has(p))
  }
  // The next task to dispatch: the ready one the plan names first. Taking it
  // marks it dispatched in the same tick, so two lanes can never take one task.
  const takeReady = () => {
    noteFailures()
    for (const t of PLAN) {
      if (!isReady(t)) continue
      dispatchedIds.add(t.id)
      return t
    }
    return null
  }
  // `takeReady`'s question without its answer's cost: is anything ready at all?
  // Read and never taken, so asking it changes nothing.
  const anyReady = () => PLAN.some((t) => isReady(t))

  // ── when a fold is worth running (#1006) ───────────────────────────────────
  // The three triggers, and the `why` each puts on the epoch's event:
  //
  //   `released`  adopting these results makes a queued task ready — one not
  //               dispatched, not failed, not downstream of a failed or blocked
  //               task, not ready NOW, and with every predecessor an edge names
  //               either already adopted or among these very results. Those ids
  //               travel with the event as `released`, in plan order. This is
  //               the fold somebody is waiting for.
  //   `end`       nothing is in flight, nothing is folding and nothing is ready:
  //               these results are all that is left of the run, so the fold
  //               that adopts them is the last one. Without this clause a run of
  //               independent tasks would finish with its work never adopted.
  //   `aged`      the oldest pending result has waited `foldAgeMs` since it
  //               landed. The clause that bounds how long a result nobody is
  //               waiting for can sit captured and unadopted — and, at
  //               `foldAgeMs: 0`, the clause that makes every landing fold at
  //               its own instant, which is the rule before #1006.
  //
  // In that order, and the first that holds is the reading: a fold that releases
  // is named for the release even when the run happens to be ending with it.
  const releasedBy = (results) => {
    const landing = new Set(results.map((r) => r.task))
    return PLAN
      .filter((t) => !isReady(t) && !reusedIds.has(t.id) && !dispatchedIds.has(t.id) &&
                     !resultFor(t.id) && !blockedByDep.has(t.id) &&
                     predecessorsOf(t.id).every((p) => adoptedIds.has(p) || landing.has(p)))
      .map((t) => t.id)
  }
  // `pendingResults` is in landing order, so the oldest is the first.
  const oldestPendingAgeMs = () => (pendingResults.length === 0 ? 0
    : Date.now() - (pendingResults[0].landedAt || 0))
  const foldTrigger = () => {
    if (pendingResults.length === 0) return null
    noteFailures()
    const released = releasedBy(pendingResults)
    if (released.length > 0) return { why: 'released', released }
    if (inFlight === 0 && foldingLanes === 0 && !anyReady()) return { why: 'end' }
    const threshold = foldAgeMs()
    // The age clause waits for the run to go idle (#1006). A finished result
    // that ages out while a sibling is still being implemented or reviewed buys
    // a fold of its own that the sibling's own landing would have carried for
    // free, so the clause asks the idle half of `end`'s test — nothing in
    // flight, nothing folding — without `end`'s "nothing ready": an epoch
    // claimed `aged` is one at whose instant every implementer, reviewer and fix
    // worker had returned. `foldAgeMs: 0` is exempt and keeps the rule before
    // this one, a fold at every landing, siblings in flight or not.
    const idle = threshold === 0 || (inFlight === 0 && foldingLanes === 0)
    if (threshold !== null && idle && oldestPendingAgeMs() >= threshold) return { why: 'aged' }
    return null
  }

  // Anchor a clone at the head this dispatch goes out on. The adopt sha exists
  // only in the integration clone's odb, so fetch it from there first; clones
  // are already at BASE from provisioning, so a dispatch on BASE needs nothing.
  //
  // A re-anchor failure is FAIL-CLOSED (review finding 1): a task dispatched
  // into a tree still at the old base yields a patch — diffed against the NEW
  // anchor — whose hunks silently REVERT the work already adopted, and nothing
  // downstream can tell. The task is failed before any dispatch, exactly like
  // lost-coordinates.
  const anchorClone = async (task, head) => {
    if (head === baseSha) return
    const cdir = path.join(clonesDir, 'task-' + task.id)
    await git(['fetch', '--quiet', '--no-tags', integ, integrationBranch], cdir)
    await git(['checkout', '--quiet', '--detach', head], cdir)
    await resetTaskClone(task.id, head)
    // The adopted head may have added dependencies an earlier task installed
    // only in its own tree — a stale install here fails the suite in this clone
    // with a module error looksStructural() would mis-diagnose (finding 9).
    if (bootstrapCmd) {
      const b = await sh(bootstrapCmd, cdir)
      if (b.code !== 0) {
        judgmentCalls.push('task ' + task.id + ': re-anchor bootstrap failed (exit ' + b.code +
          ') — the suite may be unrunnable in its clone')
      }
    }
  }
  const reanchorFailed = (task, head, e) => {
    const detail = 'could not re-anchor its clone at ' + head +
      ' — ' + String((e && e.message) || e)
    judgmentCalls.push('task ' + task.id + ': ' + detail +
      ' — failed closed before dispatch (a patch from a mis-anchored tree would silently revert the adopted head)')
    log('task ' + task.id + ' re-anchor failed — task failed closed')
    return { task: task.id, status: 'failed', reviewVerdict: 'reanchor-failed',
             notes: 'clone could not be re-anchored at the adopted head — never dispatched',
             tier: resolvedModel(task.tier || 'standard'),
             review: 'lean', fixIterations: 0, proofFixes: 0 }
  }

  // What a landing does to the record, wherever it landed from: the
  // lost-coordinates downgrade first (a `done` row with no driver-captured
  // coordinates is nothing a fold can adopt, so it counts as failed for
  // dependency blocking), then the row, then the queues the lanes read — and
  // last, in this same tick, the epoch this landing claims (`null` when another
  // fold holds the claim). The claim is taken here rather than in the lane that
  // is about to call the fold because `here` is the instant the slot freed, and
  // that instant is what decides which epoch a result belongs to.
  //
  // Async since #979, for the `landed` patch alone — and the claim is still
  // taken synchronously, on the same tick the row was recorded, so the epoch a
  // result belongs to is decided by the instant the slot freed and not by how
  // long a hub write took to answer. The patch is awaited AFTER that claim and
  // before this returns, which is before the lane can fold it: the issue reads
  // `landed` and then `adopted`, never the other way round.
  const settleResult = async (r, replacing) => {
    if (!r) return null
    // A re-edge is not a landing at all (#979): the task found a predecessor the
    // plan had not named, so the edge goes into EDGES itself — where readiness
    // and the dependency cascade both already read — and the task goes back to
    // unstarted. No row is recorded, nothing is folded, no fix round runs and
    // nothing is closed, labelled or marked on its issue; the slot frees, and
    // the task is dispatched again by whichever lane finds it ready once every
    // new predecessor has been adopted.
    if (r.status === 're-edged') {
      const already = reEdges.get(r.task) || new Set()
      reEdges.set(r.task, already)
      for (const sib of r.blockedBy) {
        already.add(sib)
        EDGES.push([sib, r.task])
      }
      // A re-edge that replaced a parked row (the infra retry's lane) takes that
      // row off the record too: the task is unstarted, and an unstarted task has
      // no result.
      if (replacing) {
        const at = taskResults.indexOf(replacing)
        if (at !== -1) taskResults.splice(at, 1)
      }
      dispatchedIds.delete(r.task)
      appendEvent({ kind: 'driver:re-edged', task: r.task, blockedBy: r.blockedBy.slice() })
      judgmentCalls.push('task ' + r.task + ': its proof needs ' + r.blockedBy.join(', ') +
        ', still in flight — recorded as a dependency and re-dispatched once adopted (' +
        (r.notes || 'no summary') + ')')
      log('task ' + r.task + ' re-edged behind ' + r.blockedBy.join(', ') + ' — waiting for adoption')
      noteFailures()
      announceLanding()
      return claimEpoch()
    }
    if (r.status === 'done' && !isMergeable(r)) {
      judgmentCalls.push('task ' + r.task + ': reported done without driver-captured coordinates — treating as failed for dependency blocking')
      r.status = 'failed'
      r.reviewVerdict = 'lost-coordinates'
      r.notes = (r.notes ? r.notes + '; ' : '') + 'done without coordinates — downgraded to failed'
    }
    const at = replacing ? taskResults.indexOf(replacing) : -1
    if (at !== -1) taskResults[at] = r
    else taskResults.push(r)
    const mergeable = isMergeable(r)
    // When it landed, stamped before the claim: the age clause (#1006) measures
    // from the instant the slot freed, not from the fold that eventually reads
    // it. A result the claim below takes is folded at an age of zero.
    r.landedAt = Date.now()
    if (r.status === 'parked-infra') parkedInfraQueue.push(r)
    else if (mergeable) pendingResults.push(r)
    noteFailures()
    announceLanding()
    const claimed = claimEpoch()
    if (mergeable) await kataLanded(r.task)
    return claimed
  }

  // The siblings a dispatch is told about: every task whose work is not in the
  // head it was handed. An adopted task's files are IN that tree — the clone
  // reads them — so naming it as a sibling would warn the implementer off a file
  // it can see.
  const siblingsNow = (task) => siblingLine(task, PLAN.filter((t) => !adoptedIds.has(t.id)), kataRefOf)

  // ── the fold ───────────────────────────────────────────────────────────────
  // `claim` is what `claimEpoch` handed this lane: every captured result nobody
  // had adopted at the instant the lane freed (M2), plus the trigger that made
  // the fold worth running (#1006). A result that landed while the fold before
  // this one ran is in it; one that lands while THIS fold runs is not, and the
  // next claim takes it.
  const foldEpoch = async (claim) => {
    if (parkedOnBaseline) return
    const merged = claim.results
    // The reading the record owes for this fold, carried onto whichever of the
    // two events the epoch ends in.
    const trigger = { why: claim.why, ...(claim.released ? { released: claim.released } : {}) }
    if (merged.length === 0) return
    // The baseline's answer, before any fold and after every dispatch this lane
    // made: a run that inherited a red repository never reaches a candidate.
    if (firstFold) {
      await baselineSettled
      firstFold = false
      if (baselineIsRed()) {
        pendingResults.unshift(...merged)
        await parkOnRedBaseline(claim.why)
        return
      }
    }
    const epoch = ++epochCount
    const prevHead = adoptedHead
    const epochTasks = PLAN.filter((t) => merged.some((r) => r.task === t.id))
    compositionRows(epoch, epochTasks)
    // #887 — the epoch's join, computed right here from the rows this fold
    // adopts: every patch is already captured and every declared Files list is
    // the plan's own, so this needs no kernel read and no tree read. Only the
    // rows being folded contribute — a task still in flight beside this fold put
    // nothing on the tree for another task to meet.
    const touchSets = new Map(epochTasks.map((t) =>
      [t.id, touchSetOf(t, (merged.find((r) => r.task === t.id) || {}).patch)]))
    const joined = joinedPathsOf([...touchSets.values()])
    // What this task shares, and who with: the task's own joined paths (in the
    // epoch's sorted order) and the other tasks that carry them, in plan order.
    const joinedFor = (id) => joined.filter((p) => (touchSets.get(id) || []).includes(p))
    const sharersOf = (id, paths) => epochTasks
      .filter((t) => t.id !== id && paths.some((p) => (touchSets.get(t.id) || []).includes(p)))
      .map((t) => t.id)
    // The epoch is announced when its fold starts — the moment the epoch exists
    // at all, and the last moment before the kernel is asked anything.
    phase('Wave ' + epoch)
    const merge = await foldWave(merged, epoch - 1, epochTasks, prevHead)
    // #1019 (M2) — how each task of this epoch LANDED, one key per task in plan
    // order, carried onto whichever of the two events the epoch ends in. The
    // reading is the anchor the dispatch went out on against this epoch's own
    // `prevHead`, plus the paths the fold NARRATED: the wave's `conflicts.json`
    // is the narration record (the fold's `open` entries and every continued
    // fold's are written into it), so a task whose declared files a narrated
    // conflict named is the one a resolver was asked about — the conflict that
    // was answered on an adoption, the conflict the fold stopped on a blocked
    // one. A task with no declared files reads `rebased`: nothing names it.
    const narratedPaths = () => {
      try {
        const index = JSON.parse(fs.readFileSync(
          path.join(waveDirOf(epoch), 'conflicts.json'), 'utf8'))
        return new Set((Array.isArray(index) ? index : [])
          .map((e) => e && e.path).filter((p) => typeof p === 'string' && p))
      } catch {
        // No index: the fold narrated nothing, or never got far enough to write
        // one. Either way no path of this epoch was narrated.
        return new Set()
      }
    }
    const narrated = narratedPaths()
    const applied = {}
    for (const t of epochTasks) {
      const anchor = anchorOf.get(t.id)
      const stale = typeof anchor === 'string' && anchor && anchor !== prevHead
      const files = Array.isArray(t.files) ? t.files : []
      applied[t.id] = !stale ? 'base'
        : (files.some((p) => narrated.has(p)) ? 'resolved' : 'rebased')
    }
    waveMerges.push({
      wave: epoch,
      status: merge.status,
      headSha: merge.headSha,
      detail: merge.detail,
      branches: merged.map((r) => r.task),
      // #887 — the paths this epoch's tasks met on, `[]` when they met on none.
      // The row the adoption pushes is where a reader looks for what the fold
      // actually put at risk, so the set that selected the integrated pass
      // travels with it.
      joined,
      // #871 — the adopted-red row carries the suite that made it one. A
      // `MERGED` row whose suite is `passed: false` is a reading no other row
      // has, so the paths that bought the adoption travel with it. Green rows
      // are unchanged: the run's suite is `tests`, and a green tail repeated
      // per epoch records nothing a reader did not already have.
      ...(merge.suite && Array.isArray(merge.suite.unattributed)
        ? { suite: merge.suite } : {}),
    })
    // #877 — what the epoch did to the integration branch is a RECORD, not
    // narration: one event per fold, appended HERE, beside the `waveMerges` row
    // it mirrors, so the row and the log can never say different things.
    // `driver:wave-adopted` names the head the epoch put on the branch (the
    // green candidate's or the reconciled one's — `foldWave` has already chosen
    // by the time it returns) and the tasks that went into it, in plan order;
    // `driver:wave-blocked` names the tasks the fold could not make green and
    // repeats the row's own `detail` verbatim. The place is after the adoption
    // and before the integrated `Run:` proofs — so the event sorts after every
    // worker of this epoch and before the next `engine:phase`.
    if (merge.status === 'MERGED') {
      appendEvent({ kind: 'driver:wave-adopted', wave: epoch,
        tasks: epochTasks.map((t) => t.id), headSha: merge.headSha, ...trigger, applied })
      adoptedHead = merge.headSha
      for (const t of epochTasks) adoptedIds.add(t.id)
      // The capture base a dispatch does NOT carry its own anchor for (the
      // reconcile round's reply, which is captured outside any lane) moves with
      // the head; a lane's own capture reads the anchor it went out on.
      if (patchBase) patchBase.current = merge.headSha
      lastSuite = merge.suite
      for (const p of ((merge.suite && merge.suite.unattributed) || [])) {
        if (!unattributedReds.includes(p)) unattributedReds.push(p)
      }
      // The suite just ran in this clone; sweep its cache litter before any
      // integrated `Run:` reads the tree. Once per epoch that reaches here, and
      // ahead of the loop — so every proof below sees the same swept tree.
      const swept = sweepCacheDirs(integ)
      appendEvent({ kind: 'driver:integrated-clean', wave: epoch, removed: swept })
      // ── the integrated `Run:` proofs (#604 (b)+(c)) ────────────────────────
      // Here and nowhere else: the candidate's suite is green, the branch has
      // moved, and the working tree IS the adopted tree. Same `sh` seam as the
      // per-task pass and the suite (`bash -lc`, SHELL_TIMEOUT_MS), same
      // tail-truncation, cwd = the integration clone. Only the epoch's own
      // tasks contribute, in Proof order within each task.
      for (const t of epochTasks) {
        // #887 — and only the JOINED ones. A task whose touch set meets no
        // other task's in this epoch would be re-asked its proof about the tree
        // it already answered for; the pass exists for the pairs, so a task
        // with no partner here runs nothing at all.
        const shared = joinedFor(t.id)
        if (shared.length === 0) continue
        const withIds = sharersOf(t.id, shared)
        const cmds = Array.isArray(t.proofRuns)
          ? t.proofRuns.filter((c) => typeof c === 'string' && c.trim() !== '')
          : []
        for (const cmd of cmds) {
          // ULTRA_BASE here is `baseSha`, the sha the integration clone was
          // provisioned at — NOT `adoptedHead`, which the adopt above has
          // already advanced to this epoch's head. A diff against the adopted
          // head is a tautology; the question the integrated pass asks is what
          // the run as a whole changed.
          // …and the pass is `integrated` with no `ULTRA_RUN_DIR` at all: a
          // state exam re-executed on the fold is being asked whether it still
          // passes there, not asked for a second record — the helper writes
          // nothing without a run directory, so the absence IS the instruction.
          const r = await sh(cmd, integ,
            examEnv({ base: baseSha, task: t.id, pass: 'integrated' }))
          // Every record names the join that bought it: the shared paths, and
          // the tasks on the other side of them. A reader of a red line needs
          // the PAIR, not only the command.
          integratedRuns.push({ task: t.id, cmd, exit: r.code, stdout: tail(r.stdout + r.stderr),
                                joined: shared.slice(), with: withIds.slice() })
          appendEvent({ kind: 'driver:integrated-run', task: t.id, cmd, exit: r.code, wave: epoch,
                        joined: shared.slice(), with: withIds.slice() })
          if (r.code === 0) continue
          // #871 decision 1, applied to the join (#887): a red here is REPORTED
          // with the pair named, not gated. The proof passed in the task's own
          // clone and the only new fact is that two tasks met in a file — which
          // of them is wrong is a question this run cannot answer, and blocking
          // the whole run on it spends a park on an unattributed red. So no
          // completeness finding is minted: the judgment call carries the
          // reading, the report carries the same bytes as INTEGRATED RUN
          // EVIDENCE, and the `Check:` pass below keeps the brake it has.
          const call = 'task ' + t.id + '\'s proof ' + cmd + ' went red on the fold of ' +
            shared.join(', ') + ' with task ' + withIds.join(', ')
          judgmentCalls.push(call)
          log('wave ' + epoch + ': ' + call)
        }
      }
      // The run's standing `Check:` commands on the same adopted tree. A
      // constraint that holds in every clone separately and fails on the fold
      // is invisible to every per-task referee by construction — each one was
      // right about the tree it read — so it can only be caught here.
      // `baseEnv` and nothing else: a standing constraint is not a task's exam,
      // so it is told the run base and none of the three variables that would
      // name a task, a record directory or a pass.
      for (const c of constraintChecks) {
        const r = await sh(c.cmd, integ, baseEnv(baseSha))
        integratedChecks.push({ cmd: c.cmd, exit: r.code, stdout: tail(r.stdout + r.stderr),
                                minor: c.minor })
        appendEvent({ kind: 'driver:integrated-check', cmd: c.cmd, exit: r.code,
                      minor: c.minor, wave: epoch })
        if (r.code === 0) continue
        if (c.minor) {
          judgmentCalls.push('wave ' + epoch + ': the minor Check: `' + c.cmd + '` exited ' +
            r.code + ' on the adopted tree — recorded, blocking nothing')
          continue
        }
        const detail = 'integrated Check: ' + c.cmd + ' exited ' + r.code + ' on the adopted tree'
        integratedFindings.push({ severity: 'blocking', detail })
        judgmentCalls.push(detail + ' — a Global Constraint the fold broke; the run is BLOCKED')
        log('wave ' + epoch + ': ' + detail)
      }
      // The epoch is over on the hub too. Last, after the integrated proofs, so
      // every `driver:` comment this epoch produced is on the issue before its
      // close is: the evidence is the head the epoch adopted and the command
      // this task is measured by, and the idempotency key makes a re-driven
      // close the same close rather than a second one.
      for (const r of merged) {
        const t = epochTasks.find((x) => x && x.id === r.task)
        const cmd = (t && typeof t.testCmd === 'string' && t.testCmd.trim()) ? t.testCmd : testCmd
        // Which run adopted this task, and at which head — on the issue's own
        // metadata, under the revision the engine last held for it, before the
        // close that carries the same sha as its `commit` evidence.
        await kataAdopted(r.task, merge.headSha)
        // kata refuses a `done` close under 40 characters (run-111): the title
        // and the merge sha make the message read on its own.
        await kataClose(r.task, {
          reason: 'done',
          message: 'adopted in wave ' + epoch + ' (' + r.reviewVerdict + '): ' +
            String((t && t.title) || ('task ' + r.task)) + ' — merged ' + String(merge.headSha),
          evidence: [{ type: 'commit', sha: merge.headSha },
                     { type: 'test', command: cmd }],
          idempotencyKey: stamp + ':' + r.task + ':close',
        })
      }
      return
    }
    // A red epoch marks exactly its OWN tasks blocked (M3) — the run does not
    // stop. The tasks that went into this fold landed in no head, so every task
    // an edge points at them from is never ready and says so in `unfinished`;
    // every task that depends on none of them is dispatched as before, and the
    // next epoch folds onto the head this one was restored to.
    const detail = merge.detail || merge.status
    // #1019 (M3) — a fold the kernel could not complete is a blocked epoch like
    // any other. `CONFLICT` used to fall straight through to `blockedWaves`
    // with no event and no hub mark, so the one epoch outcome a reader most
    // wants to see — the fold that stopped on a conflict nobody could resolve —
    // was the one the record was silent about.
    // A fold that stopped on a conflict nobody resolved leaves a RECEIPT: the
    // files it stopped on and what it was folding onto. The paths are this
    // epoch's narrated set — the same `conflicts.json` rows the `applied`
    // reading above was taken from — sorted and de-duplicated by
    // `receiptPaths`; the reading is the row's own `detail`, against the epoch
    // and the head the fold was made onto. A `TEST_FAILED` epoch carries
    // neither key: its candidate materialized and the suite is what said no, so
    // there is no file the fold stopped on to name. Nor does a fold that
    // narrated nothing at all — a receipt names files.
    const conflictPaths = merge.status === 'CONFLICT' ? receiptPaths([...narrated]) : []
    const receipt = conflictPaths.length ? {
      paths: conflictPaths,
      evidence: {
        read: receiptText(detail),
        against: receiptText('epoch ' + epoch + ' onto ' + prevHead),
      },
    } : {}
    if (merge.status === 'TEST_FAILED' || merge.status === 'CONFLICT') {
      appendEvent({ kind: 'driver:wave-blocked', wave: epoch,
        tasks: epochTasks.map((t) => t.id), detail, ...trigger, applied, ...receipt })
      // The fold could not be made green, so nothing in it landed — every task
      // of the epoch is left OPEN and marked for a person, carrying the row's
      // own detail. Work the driver could not fold is a question for someone,
      // not a settled one.
      for (const t of epochTasks) {
        await kataMark(t.id, { status: 'blocked',
          verdict: 'wave ' + epoch + ' blocked: ' + String(detail),
          notes: String(detail) })
      }
    }
    blockedWaves.push({ wave: epoch, detail })
    log('epoch ' + epoch + ' BLOCKED: ' + detail)
    for (const t of epochTasks) blockedByDep.add(t.id)
    noteFailures()
  }
  // A fold runs on the lane that freed, under the lock, and announces itself
  // when it is done: a task the epoch adopted may be the predecessor a waiting
  // lane was blocked on.
  const foldPending = async (claimed) => {
    // No claim: this landing belongs to a fold that is already running, and the
    // lane has nothing to do but go back for more work.
    if (!claimed) return
    foldingLanes += 1
    try {
      await underFoldLock(() => foldEpoch(claimed))
    } finally {
      // Released before the announcement, and both without an await between
      // them: a lane woken by this landing finds the claim free and takes
      // whatever arrived while this fold ran as the next epoch.
      epochClaimed = false
      foldingLanes -= 1
      announceLanding()
    }
  }

  // ── dispatch ───────────────────────────────────────────────────────────────
  const dispatchOnce = async (task) => {
    const head = adoptedHead
    inFlight += 1
    let result = null
    try {
      try {
        await anchorClone(task, head)
        // A re-edged task's clone still holds the attempt that blocked (#979).
        // The fresh implementer is told its tree is at the head it was handed,
        // so the tree has to BE that head — `anchorClone` already resets a clone
        // it moved, and this is the dispatch it did not have to move.
        if (reEdges.has(task.id) && head === baseSha) await resetTaskClone(task.id, head)
      } catch (e) {
        result = reanchorFailed(task, head, e)
      }
      if (result === null) {
        // The anchor this dispatch is answerable for: the driver captures its
        // patch against THIS head however far the adopted head has moved while
        // it worked (see `captureAnchors`).
        anchorOf.set(task.id, head)
        result = await runTask(task, head, siblingsNow(task))
      }
    } finally {
      inFlight -= 1
    }
    // The epoch this landing claimed, for the lane to fold — or `null`, which
    // is the lane being told that a fold already running will take this result.
    return await settleResult(result)
  }

  // #903 (a), re-aimed at the ready set (M4): exactly one retry per parked task,
  // same tier, taken when a slot frees rather than at a barrier — and taken when
  // the lanes have quiesced, so the storm the first dispatch died in has had the
  // time every landing since it took, and the retry goes out on the head of that
  // moment instead of the one it died at.
  const retryParkedInfra = async (parked) => {
    const task = PLAN.find((t) => t.id === parked.task)
    const head = adoptedHead
    inFlight += 1
    let res
    try {
      log('task ' + task.id + ' infra-retry: a slot freed — re-dispatching on ' + head)
      try {
        await anchorClone(task, head)
        await resetTaskClone(task.id, head)
        anchorOf.set(task.id, head)
        res = await runTaskInner(task, head, siblingsNow(task))
        judgmentCalls.push('task ' + task.id + ': parked on infra-death, recovered at the slot-free retry')
      } catch (e2) {
        if (isKataFatal(e2)) throw e2
        const msg2 = String((e2 && e2.message) || e2)
        judgmentCalls.push('task ' + task.id + ': slot-free retry after infra-death failed — ' + msg2)
        res = { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                notes: msg2, tier: parked.tier, review: parked.review,
                fixIterations: 0, proofFixes: 0 }
      }
    } finally {
      inFlight -= 1
    }
    return await settleResult(res, parked)
  }

  // ── the lanes ──────────────────────────────────────────────────────────────
  // `W` of them, handed to `parallel` as `W` thunks: the width bound is the lane
  // count, so in flight never exceeds it without any chunk arithmetic. A lane
  // loops until there is nothing ready, nothing moving and nothing owed.
  const lane = async () => {
    // The first lane reaches this line microseconds after Setup started the
    // baseline; the head start is what gives an already-broken repository the
    // chance to say so before anyone is dispatched at it. Once the baseline has
    // settled it costs nothing at all.
    if (baseline === null) await baselineHeadStart()
    while (true) {
      if (parkedOnBaseline) return
      // The baseline has answered, and the answer is RED: not one implementer is
      // dispatched into a repository that was failing before the run opened.
      // Read as a flag, never awaited — this is the question "has it settled red
      // yet?", asked before every dispatch, so a slow baseline stops nothing.
      if (baselineIsRed()) return
      // Before anything else: an epoch nobody is folding, and worth folding.
      // This is how the results that landed during a fold reach one — they were
      // refused a claim when they landed, and the first lane back at the top of
      // its loop after that fold released takes all of them as the next epoch.
      // It is also where the LAST pending set is folded: the claim is asked
      // before the quiet test below and in the same turn, so a lane that is
      // about to judge the run quiet folds what is left first (`end`), instead
      // of returning with results nobody ever adopted (#1006).
      const waiting = claimEpoch()
      if (waiting !== null) {
        await foldPending(waiting)
        continue
      }
      const task = takeReady()
      if (task !== null) {
        await foldPending(await dispatchOnce(task))
        continue
      }
      // Nothing ready. Quiet means nothing in flight, nothing folding, nothing
      // claimed for a fold about to start and nothing captured but unadopted —
      // the only state in which this lane can tell that no landing is coming to
      // make something ready. (`epochClaimed` is its own term: a claim is taken
      // in the tick a result lands and the fold that carries it starts an await
      // later, so for that moment an epoch exists that neither counter sees.)
      const quiet = inFlight === 0 && foldingLanes === 0 && !epochClaimed &&
        pendingResults.length === 0
      if (quiet && parkedInfraQueue.length > 0) {
        await foldPending(await retryParkedInfra(parkedInfraQueue.shift()))
        continue
      }
      if (quiet) return
      // Not quiet: either work is still moving, or results are pending and no
      // trigger holds for them yet. Both are waiting on the same thing — the
      // next landing, or the release of the fold that is running.
      await nextLanding()
    }
  }
  await parallel(Array.from({ length: W }, () => () => lane()))

  // The baseline's last word. A run that dispatched nothing, or captured nothing
  // to fold, never reached the gate inside the fold path — and the park is still
  // owed, because a red BASE is the reading of everything this run did.
  await baselineSettled
  if (baselineIsRed()) await parkOnRedBaseline()
  else {
    // Every task that never became ready, with the reason (M3).
    for (const t of PLAN) {
      if (reusedIds.has(t.id) || resultFor(t.id)) continue
      if (blockedByDep.has(t.id)) {
        unfinished.push(t.id + ': blocked — depends on a failed task')
        log('task ' + t.id + ' skipped: upstream dependency failed')
      } else {
        unfinished.push(t.id + ': never became ready — a task an edge names as its predecessor never landed')
      }
    }
  }

  // ── no one reads the finished run (#964 Task 2) ────────────────────────────
  // The completeness critic is gone: it was a second judgment over a tree every
  // per-task referee had already read, and the driver — which runs the suite,
  // the integrated `Run:`s and the integrated `Check:`s itself — is the only
  // party left with a fact about the fold that nobody else holds. What reaches
  // the report as `completenessFindings` is therefore the DRIVER's own list:
  // the red integrated `Check:`s of the waves above, which the #474 brake
  // reads exactly as it read them when they arrived beside a critic's findings.
  // A red integrated `Run:` is not here: since #887 it is reported with the
  // pair it names and blocks nothing (the judgment call carries it).
  const waveMergedAny = waveMerges.some((m) => m && m.status === 'MERGED')

  // Driver detach: releases the integration branch in the clone. Nothing on
  // the driver path needs the branch checked out from here on (the fetch
  // bridge reads refs, the gate operates on the repo checkout).
  try { await git(['checkout', '-q', '--detach'], integ) } catch { /* non-fatal */ }

  // ── driver-derived verification (spec §3.1: gitVerified is REDEFINED and
  // disclosed) — the branch tip must equal the last adopt receipt, and every
  // task reported merged must appear as a fold event in its wave's fold log.
  // The old meaning (an integration agent's own attestation) cannot exist when
  // no agent reads the finished run; this is the receipt-based equivalent of
  // #70, and since #964 Task 2 it is the whole of it. ──
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
  // gitVerified = the receipts are intact, and nothing else (spec §3.1's
  // redefinition). The `criticRan` conjunct went with the critic (#964 Task 2).
  const gitVerified = anyWaveMerged && tipMatches && ancestryMisses.length === 0
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
  // The parked rows are the exception the loop above is right to exclude: they
  // failed, but they failed BECAUSE of a plan question, and their files are
  // already under missingDeliverables. Their judgment call was pushed at the
  // park, so only the item is added here (#722).
  for (const p of parkedForPlan) {
    planDeferred.push({ deliverable: p.task, reason: 'plan-defect', why: p.why })
  }
  // The plan's deferrals are the whole list now: the critic's own
  // `deferredVerification` went with it (#964 Task 2).
  const deferredVerification = planDeferred

  // tests: the DRIVER's own suite run on the adopted tree.
  // `unattributed` is always present — `[]` on a green run, on a run that
  // merged nothing, and on one whose reds were every bit its tasks' own.
  const tests = lastSuite
    ? { command: testCmd, passed: lastSuite.passed, output: lastSuite.output,
        unattributed: unattributedReds }
    : { command: testCmd, passed: false, output: 'not run — no wave merged',
        unattributed: unattributedReds }

  const mergedBranches = new Set()
  for (const wm of waveMerges) if (wm && wm.status === 'MERGED') for (const b of (wm.branches || [])) mergedBranches.add(b)
  // #383 — a reused task's work is in the tree before wave 1 folds anything, so
  // it counts as delivered. Left out, coverage would read as an incomplete
  // merge and the gate would ask an operator to acknowledge a false-green that
  // is not one.
  for (const id of reusedIds) mergedBranches.add(id)
  const tasksPlanned = WAVES.flat().length
  const coverage = { tasks_merged: mergedBranches.size, tasks_planned: tasksPlanned,
                     complete: mergedBranches.size >= tasksPlanned }

  // ── the engine's own coverage reading (#992 desired state 1) ──────────────
  // A run that changed `fleet/run-engine.mjs` says which of the lines it
  // changed an engine sim actually ran, and which none did. A READING beside
  // the receipt and nothing more: it is computed after the last fold, it is
  // read by no branch below, and `tests`, `coverage` and the merge decision on
  // the same tree are what they would have been without it. `null` on every
  // other run — a run that left the engine alone, and a run whose integration
  // tree holds no engine sim to read it with. Every failure here is swallowed
  // for the same reason: a reading that cannot be taken is `null`, never a red.
  let engineCoverageReading = null
  try {
    const touched = await exec('git', ['diff', '--name-only', baseSha, 'HEAD', '--',
      'fleet/run-engine.mjs'], { cwd: integ })
    const names = String(touched.stdout || '').split('\n').map((s) => s.trim())
    if (touched.code === 0 && names.includes('fleet/run-engine.mjs')) {
      const engineSims = fs.readdirSync(path.join(integ, 'fleet', 'tests'))
        .filter((n) => /^test_run_engine_.*\.mjs$/.test(n))
        .map((n) => 'fleet/tests/' + n)
        .sort()
      if (engineSims.length) {
        engineCoverageReading = await engineCoverage({
          tree: integ,
          base: baseSha,
          head: await git(['rev-parse', 'HEAD'], integ),
          file: 'fleet/run-engine.mjs',
          sims: engineSims,
          width: W,
        })
      }
    }
  } catch { /* a reading, never a gate */ }

  const failedIds = taskResults.filter((t) => t.status === 'failed').map((t) => t.task)
  const blockedIds = unfinished
    .map((u) => (typeof u === 'string' ? u.split(/[:\s]/)[0] : (u && u.task)))
    .filter(Boolean)
  const missingIds = [...new Set([...failedIds, ...blockedIds])]
  /** What `unfinished` already says about one task, joined — the reason a task
   *  with no result row of its own has to offer, and '' when it has none. */
  const unfinishedNotes = (id) => unfinished
    .map((u) => (typeof u === 'string'
      ? u
      : ((u && u.task) ? String(u.task) + ': ' + String((u && u.detail) || '') : '')))
    .filter((s) => s === id || s.startsWith(id + ':') || s.startsWith(id + ' '))
    .join('; ')
  const missingDeliverables = missingIds
    .map((id) => ({ task: id, files: ((WAVES.flat().find((t) => t.id === id) || {}).files) || [] }))
    .filter((m) => m.files.length)
  // Every `tasks[]` row carries its state-exam record, `failed` rows included:
  // what a state exam measured is worth reading precisely when the task did
  // not finish. `[]` when the task's exam wrote nothing (which is every task
  // whose exam is not a state exam), so the row a reader knew is unchanged
  // apart from the new key.
  // …and its driver-raised findings beside it (#998 ticket 5): what the DRIVER
  // held against the task, `{severity, actor, detail}` per entry, distinct by
  // detail and in the order they were raised. `[]` on every task that has none,
  // which is every task of a run with no state handshake.
  const taskRows = taskResults.map((r) => ((r && typeof r === 'object')
    ? { ...r, stateExams: stateExamsOf(runDirAbs, r.task), findings: findingsOf(r.task) }
    : r))

  // ── the hub's last word (#913) ────────────────────────────────────────────
  // Only a task adopted into the tree was closed, above. Everything the run
  // could not finish stays OPEN and is marked for review here (#810 Phase A) —
  // the waves' own markings already took the ones they own, and this takes the
  // rest, in two passes.
  //
  // First every row that is not `done`: it carries its own reading, so the
  // message is the row's.
  for (const r of taskResults) {
    if (!r || r.status === 'done') continue
    await kataMark(r.task, { status: r.status, verdict: r.reviewVerdict, notes: r.notes })
  }
  // Then the tasks the record names that produced no row at all — the run never
  // got to them, and an unmarked open issue reads exactly like a task nobody has
  // looked at yet. `blockedByDep` is the one distinction worth keeping: those are
  // tasks the driver refused to dispatch because an upstream task failed
  // (`skipped`), and the rest are the waves a cascade or a red baseline ended
  // before they ran (`unattempted`). Then the comment queue is drained, so the
  // hub holds every `driver:` event before the engine answers.
  for (const id of Object.keys(kataTaskRows)) {
    if (taskResults.some((r) => r && r.task === id)) continue
    const skipped = blockedByDep.has(id)
    await kataMark(id, {
      status: skipped ? 'skipped' : 'unattempted',
      verdict: skipped
        ? 'an upstream dependency failed — never dispatched'
        : 'the run ended before this task\'s wave',
      notes: unfinishedNotes(id) || 'no result was recorded for this task',
    })
  }
  unsubscribeHub()
  await drainKataPosts()

  return {
    integrationBranch,
    baseSha,
    waves: WAVES.map((w) => w.map((t) => t.id)),
    dependencyEdges,
    tasks: taskRows,
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
    },
    baseline,
    waveMerges,
    frontier,
    coverage,
    // Which of the engine lines this run changed a sim reached, and which none
    // did (#992) — the M1 object on a run that changed the engine with sims to
    // read it, `null` on every other. A reading; it gates nothing.
    engineCoverage: engineCoverageReading,
    missingDeliverables,
    gitVerified,
    ancestryMisses,
    deferredVerification,
    judgmentCalls,
    // What the run's workers said they changed about what the plan asked for
    // (#990) — `{task, amends, what, why}` per declared row, `[]` when none.
    amendments,
    unfinished,
    // The driver's own findings about the fold, and nothing else: `[]` on a run
    // whose integrated `Check:`s were all green, which is every run that has no
    // Global Constraints to check (#964 Task 2).
    completenessFindings: integratedFindings,
    blockedWaves,
  }
}
