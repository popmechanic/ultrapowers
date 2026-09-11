/**
 * fleet/tests/test_sandbox_boot_bearer.mjs — THE SANDBOX PROVES ITS BEARER
 * BEFORE THE ENGINE STARTS.
 *
 * The claim: a run whose bearer is dead parks at boot, before any exam or
 * implementer spends a token, and the parked page says which side refused —
 * the bearer itself or exe.dev's edge — with the trace id when the edge
 * answered.
 *
 * The clauses this file pins, in the Machine's own words, leg by leg:
 *
 *   M1 / leg (a)  after the `claude auth status` read shows `oauth_token` and
 *                 before the `fleet-engine-<N>` unit is started, the boot
 *                 script makes EXACTLY ONE `curl` request whose URL is
 *                 `https://claude-max.int.exe.xyz/api/oauth/usage`, carrying
 *                 `-sS`, a `--max-time` argument, a header whose value is
 *                 `Bearer placeholder`, and `-w '\n%{http_code}'`; on a 200 it
 *                 logs a line beginning `bearer probe: alive` and the engine
 *                 unit is started as today.
 *   M2 / leg (b)  on a 401 or 403 whose body parses as JSON carrying
 *                 `"type":"error"`, the run ends `parked` with phase
 *                 `credential` and an `error` cell exactly
 *                 `parked: credential bearer <status> — <the body's
 *                 error.message>`; no `--unit=fleet-engine-<N>` is ever issued;
 *                 the parked page is committed and pushed to the evidence
 *                 branch as the last committed state; the two record tags are
 *                 pushed; a notify is posted whose title is `run-<N> parked`;
 *                 and the script exits 0. Two rows: `revoked` (a JSON 401) and
 *                 `forbidden` (a JSON 403 — the row the script must tell from
 *                 the edge's plain-text 403 by BODY SHAPE, not by status).
 *   M3 / leg (c)  on a 403 whose body is the edge's plain text, the run parks
 *                 the same way with class `edge` and the 32-hex trace id
 *                 verbatim in the cell.
 *   M4 / legs (d) and (e)  a `curl` that exited non-zero with no status line,
 *                 and a status that is none of 200/401/403, each log a line
 *                 beginning `bearer probe: inconclusive` and START THE ENGINE:
 *                 the run is never parked on an answer the probe cannot
 *                 classify.
 *   M5 / leg (f)  `fleet/CONTRACT.md`'s `- engine:` bullet names the probe —
 *                 six literals, in order — and `fleet/RUNBOOK.md`'s debugging
 *                 item 3 carries `bearer probe:` and `parked: credential`.
 *                 Read here through the SAME scoping the Proof's two `Run:`
 *                 lines use: the sed range, its newlines turned to spaces.
 *   M6 / leg (g)  the three sibling sims and the docs pin are each a real path
 *                 the Proof's last four `Run:` lines name, and the rig's `curl`
 *                 stub answers `/api/oauth/usage` ABOVE its catch-all — which
 *                 is what keeps those sims green once the probe exists.
 *
 * Two things about how this file is written.
 *
 * NO SIM RUNS ANOTHER SIM. Leg (g)'s three sims and its pytest file are NAMED
 * here and never spawned — `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids
 * it, and the running of them is the Proof's own `Run:` lines' business. The
 * same goes for the two doc `Run:` lines: leg (f) reads the two documents in
 * process, with the scoping those lines spell.
 *
 * And a boot is ~40 forks of stub shell, so the five knob boots are started
 * side by side at load and each leg awaits its own; the green path is the
 * rig's one memoised `greenAsync()` run, shared with nothing else in this
 * process.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TARGET,
  STUBS,
  makeHome, bootAsync, greenAsync,
  argvLines, stream, statusOf, states, commitStates, notifies,
  engineRuns, indexOf, gitLog, verbOf, evidenceDir, evidenceDisciplineProblem,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '..', '..')
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the literals the contract spells ─────────────────────────────────────────

/** M1's URL, whole — the proxy literal the script already carries plus the
 *  endpoint `fleet/claude-token.mjs usage` already reads. */
const PROBE_URL = 'https://claude-max.int.exe.xyz/api/oauth/usage'
/** The path fragment a probe request is FOUND by, in the Context's own words. */
const PROBE_PATH = '/api/oauth/usage'
/** M1's header value. The header's NAME is not pinned by the clause; its value
 *  is, to the byte — the edge replaces it with the real bearer on the way out,
 *  which is the whole reason a sandbox may carry a placeholder here. */
const PROBE_BEARER = 'Bearer placeholder'
/** The Context's upper bound on `--max-time`: "any value at most 30". */
const MAX_TIME_CEILING = 30

/** The edge's trace id, as the rig's `edge` row answers it. */
const TRACE_ID = '53af9083708deefaa364aa37e112695d'
/** The edge's refusal, byte for byte — the whole line rides into the cell. */
const EDGE_BODY = `integration not found or not attached to this VM (trace: ${TRACE_ID})`

/** M2's cell for the rig's `revoked` row: a JSON 401. */
const ERR_REVOKED = 'parked: credential bearer 401 — OAuth access token has been revoked'
/** M2's cell for the rig's `forbidden` row: a JSON 403. */
const ERR_FORBIDDEN = 'parked: credential bearer 403 — This account is not permitted'
/** M3's cell for the rig's `edge` row: a plain-text 403. */
const ERR_EDGE = `parked: credential edge 403 — ${EDGE_BODY}`

/** M5's six literals, in the order the CONTRACT bullet must carry them. */
const CONTRACT_LITERALS = [
  'claude auth status',
  '/api/oauth/usage',
  'parked: credential',
  'bearer',
  'edge',
  'trace',
]
/** M5's two literals for the RUNBOOK's debugging item 3. */
const RUNBOOK_LITERALS = ['bearer probe:', 'parked: credential']

/** M6's three sims and its docs pin — NAMED, never run (see the header). */
const SIBLING_SIMS = [
  'fleet/tests/test_sandbox_boot.mjs',
  'fleet/tests/test_sandbox_boot_edges.mjs',
  'fleet/tests/test_sims_are_hermetic.mjs',
]
const DOCS_PIN = 'tests/test_docs_agree_with_code.py'

// ── the rig, driven by the shared `STUB_BEARER` knob ─────────────────────────
//
// One home and one boot per knob, started at load and awaited by the leg that
// owns it. The knob is the rig's, not this file's: `STUBS.curl` answers
// `*claude-max.int.exe.xyz/api/oauth/usage)` by it, and the implementation is
// written against the same six rows.

const BOOTS = new Map()
const bearerBoot = (knob) => {
  if (!BOOTS.has(knob)) {
    const ctx = makeHome()
    BOOTS.set(knob, bootAsync(ctx, ['boot'], { STUB_BEARER: knob }).then((r) => ({ ctx, r })))
  }
  return BOOTS.get(knob)
}
for (const knob of ['revoked', 'forbidden', 'edge', 'down', '500']) bearerBoot(knob)
greenAsync()

/** Every `curl` argv of this run whose words name the probe endpoint. */
const probeArgvs = (ctx) =>
  argvLines(ctx, 'curl').filter((a) => a.some((s) => s.includes(PROBE_PATH)))

/** The word after `flag` in an argv, or undefined. */
const flagValue = (argv, flag) => {
  const at = argv.indexOf(flag)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : undefined
}

/** Every `-H`/`--header` of an argv, split into its name and its value. */
const headers = (argv) => {
  const out = []
  for (let i = 0; i + 1 < argv.length; i += 1) {
    if (argv[i] !== '-H' && argv[i] !== '--header') continue
    const raw = argv[i + 1]
    const at = raw.indexOf(':')
    if (at < 0) continue
    out.push({ name: raw.slice(0, at).trim(), value: raw.slice(at + 1).trim() })
  }
  return out
}

/** The stream's lines that BEGIN with `prefix` — a probe verdict is a line of
 *  its own, so a prefix match is the reading, never a containment. */
const probeLines = (ctx, prefix) => stream(ctx).filter((l) => l.startsWith(prefix))

/** Every `git push` argv of this run. */
const pushes = (ctx) => gitLog(ctx).filter((a) => verbOf(a) === 'push')

/**
 * The park M2 and M3 share, asserted once: the page, the unit that never
 * started, the evidence commit and its push, the two record tags, the notify
 * and the exit. `err` is the leg's own cell, which is the only thing that
 * differs between the three refused rows.
 */
function assertParkedOnCredential({ ctx, r }, err, leg, clause) {
  const where = `${leg} [${clause}]`
  assert.equal(r.status, 0,
    `${where} the script exits 0 on a refused bearer — a park is an outcome, not a crash\n` +
      r.stdout + r.stderr)

  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', `${where} the page ends \`parked\``)
  assert.equal(status.phase, 'credential', `${where} the parked page's phase is \`credential\``)
  assert.equal(status.error, err,
    `${where} the \`error\` cell is exactly '${err}' — the class word and the refusing side's ` +
      'own words, and nothing else')

  assert.equal(engineRuns(ctx), 0,
    `${where} no \`--unit=fleet-engine-7\` is ever issued on a refused bearer`)
  assert.ok(!states(ctx).includes('publishing'),
    `${where} a run parked at boot never reaches \`publishing\` — it parked before the engine`)
  assert.equal(states(ctx)[states(ctx).length - 1], 'parked',
    `${where} \`parked\` is the last state the script claimed; it claimed ${JSON.stringify(states(ctx))}`)

  const committed = commitStates(ctx)
  assert.equal(committed[committed.length - 1], 'parked',
    `${where} the parked page is the LAST committed state on the evidence branch; the branch ` +
      `took ${JSON.stringify(committed)}`)
  assert.equal(evidenceDisciplineProblem(gitLog(ctx), evidenceDir(ctx)), null,
    `${where} every evidence push follows an add and a commit in the evidence worktree — the ` +
      'parked page is pushed, not merely written')

  const planTag = pushes(ctx).filter((a) => a.some((s) => s.includes('refs/tags/ultra/plan/run-7')))
  const evidenceTag = pushes(ctx).filter((a) => a.some((s) => s.includes('refs/tags/ultra/evidence/run-7')))
  assert.ok(planTag.length >= 1,
    `${where} one git push argv carries \`refs/tags/ultra/plan/run-7\` — a parked run's record ` +
      "is worth as much as a green one's")
  assert.ok(evidenceTag.length >= 1,
    `${where} another git push argv carries \`refs/tags/ultra/evidence/run-7\``)

  const parked = notifies(ctx).filter((n) => n.title === 'run-7 parked')
  assert.equal(parked.length, 1,
    `${where} exactly one notify is posted whose title is \`run-7 parked\`; the run posted ` +
      JSON.stringify(notifies(ctx)))
  assert.equal(parked[0].message, `${TARGET} — ${err}`,
    `${where} the park mirrors do_boot's: \`notify "run-$RUN_N parked" "$TARGET_REPO — $ERROR"\``)

  assert.equal(probeArgvs(ctx).length, 1,
    `${where} the boot parks on ONE refused answer — no retry, no second probe`)
}

// ── (a) the green probe: one request, in its place, and the engine starts ────

test('a green boot probes the bearer once, between the auth read and the engine  [M1 / leg (a)]', async () => {
  const ctx = await greenAsync()
  const probes = probeArgvs(ctx)
  assert.equal(probes.length, 1,
    `(a) [M1] exactly one curl request names ${PROBE_PATH}; this run made ${probes.length}`)
  const argv = probes[0]

  const urls = argv.filter((s) => s.startsWith('https://'))
  assert.deepEqual(urls, [PROBE_URL],
    `(a) [M1] the probe's URL is exactly '${PROBE_URL}' — \`$ANTHROPIC_PROXY_URL/api/oauth/usage\``)

  assert.ok(argv.includes('-sS'), `(a) [M1] the probe carries \`-sS\`; its argv was ${argv.join(' ')}`)

  const maxTime = flagValue(argv, '--max-time')
  assert.ok(maxTime !== undefined,
    `(a) [M1] the probe carries a \`--max-time\` argument — a dead edge must not hold the boot; ` +
      `its argv was ${argv.join(' ')}`)
  const seconds = Number(maxTime)
  assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_TIME_CEILING,
    `(a) [M1] \`--max-time\` is a positive number of seconds, at most ${MAX_TIME_CEILING}; ` +
      `it was '${maxTime}'`)

  const bearers = headers(argv).filter((h) => h.value === PROBE_BEARER)
  assert.equal(bearers.length, 1,
    `(a) [M1] the probe carries a header whose value is exactly '${PROBE_BEARER}' — the edge ` +
      'replaces it with the real bearer, so the sandbox never holds one; the headers were ' +
      JSON.stringify(headers(argv)))

  const w = flagValue(argv, '-w')
  assert.ok(w !== undefined && w.endsWith('%{http_code}'),
    `(a) [M1] the probe carries a \`-w\` value ending \`%{http_code}\`, so the HTTP status rides ` +
      `as the answer's last line; it was '${w}'`)
})

test('the probe sits after the auth status read and before the engine unit  [M1 / leg (a)]', async () => {
  const ctx = await greenAsync()
  const auth = indexOf(ctx, 'claude auth status:')
  const probe = indexOf(ctx, 'curl bearer')
  const engine = indexOf(ctx, 'systemd-run engine')

  assert.ok(auth >= 0, "(a) [M1] the boot logs its `claude auth status:` line")
  assert.ok(probe >= 0,
    '(a) [M1] the rig\'s curl stub logs `curl bearer` when the probe is made — no line means no ' +
      'probe request reached the stub at all')
  assert.ok(engine >= 0, '(a) [M1] the engine unit is started on a green boot')
  assert.ok(auth < probe,
    `(a) [M1] the probe is made AFTER the \`claude auth status\` read shows \`oauth_token\` ` +
      `(auth at ${auth}, probe at ${probe})`)
  assert.ok(probe < engine,
    `(a) [M1] the probe is made BEFORE the \`fleet-engine-7\` unit is started (probe at ` +
      `${probe}, engine at ${engine}) — a dead bearer must cost no tokens`)
})

test('a 200 logs `bearer probe: alive` and the engine unit is started as today  [M1 / leg (a)]', async () => {
  const ctx = await greenAsync()
  assert.equal(probeLines(ctx, 'bearer probe: alive').length, 1,
    '(a) [M1] a 200 logs exactly one line beginning `bearer probe: alive`; the stream carried ' +
      JSON.stringify(probeLines(ctx, 'bearer probe:')))
  assert.equal(probeLines(ctx, 'bearer probe: inconclusive').length, 0,
    '(a) [M1] a 200 is a classified answer, never an inconclusive one')
  assert.equal(engineRuns(ctx), 1,
    '(a) [M1] the green run starts its `fleet-engine-7` unit exactly once')
  assert.notEqual(statusOf(ctx).state, 'parked',
    '(a) [M1] a live bearer parks nothing')
})

// ── (b) a JSON refusal parks the run against the BEARER ──────────────────────

test('a JSON 401 parks the run: `parked: credential bearer 401 — …`  [M2 / leg (b)]', async () => {
  const boot = await bearerBoot('revoked')
  assertParkedOnCredential(boot, ERR_REVOKED, '(b)', 'M2')
})

test('a JSON 403 parks against the bearer, not the edge  [M2 / leg (b)]', async () => {
  const boot = await bearerBoot('forbidden')
  assertParkedOnCredential(boot, ERR_FORBIDDEN, '(b)', 'M2')

  const { ctx } = boot
  // The row the script must tell from the edge's plain-text 403 by BODY SHAPE:
  // a cell reading `edge`, or a stream reading `inconclusive`, is a probe that
  // classified a 403 by its status alone.
  assert.ok(!statusOf(ctx).error.includes('edge'),
    '(b) [M2] a 403 whose body is JSON carrying `"type":"error"` is the BEARER refusing, not ' +
      `the edge; the cell read '${statusOf(ctx).error}'`)
  assert.deepEqual(probeLines(ctx, 'bearer probe: inconclusive'), [],
    '(b) [M2] a JSON 403 is a classified answer — nothing inconclusive is logged')
})

// ── (c) the edge's plain-text 403 parks against the EDGE, with its trace ─────

test("the edge's plain-text 403 parks with class `edge` and the trace verbatim  [M3 / leg (c)]", async () => {
  const boot = await bearerBoot('edge')
  assertParkedOnCredential(boot, ERR_EDGE, '(c)', 'M3')

  const { ctx } = boot
  const cell = statusOf(ctx).error
  // Named on its own: the 32-hex is what exe.dev support resolves, so a cell
  // that carries the class word but drops the trace id is not this leg.
  assert.ok(cell.includes(TRACE_ID),
    `(c) [M3] the cell carries the 32-hex trace id '${TRACE_ID}' verbatim; it read '${cell}'`)
  assert.match(cell, /\(trace: [0-9a-f]{32}\)$/,
    `(c) [M3] the whole edge line rides into the cell, trace id and all; it read '${cell}'`)
})

// ── (d) and (e) an answer the probe cannot classify never parks a run ────────

for (const [knob, leg, what] of [
  ['down', '(d)', '`curl` exiting non-zero with no status line'],
  ['500', '(e)', 'a status that is none of 200, 401, 403'],
]) {
  test(`${what} logs \`bearer probe: inconclusive\` and starts the engine  [M4 / leg ${leg}]`, async () => {
    const { ctx, r } = await bearerBoot(knob)
    assert.equal(r.status, 0,
      `${leg} [M4] an inconclusive probe leaves the run exactly as it was\n` + r.stdout + r.stderr)

    assert.equal(probeLines(ctx, 'bearer probe: inconclusive').length, 1,
      `${leg} [M4] ${what} logs exactly one line beginning \`bearer probe: inconclusive\`; the ` +
        `stream carried ${JSON.stringify(probeLines(ctx, 'bearer probe:'))}`)
    assert.equal(probeLines(ctx, 'bearer probe: alive').length, 0,
      `${leg} [M4] an answer the probe cannot classify is not an alive one`)

    assert.equal(engineRuns(ctx), 1,
      `${leg} [M4] the engine unit is started — a probe must never manufacture a park on a flake`)
    assert.notEqual(statusOf(ctx).state, 'parked',
      `${leg} [M4] the page does not read \`parked\`; it read '${statusOf(ctx).state}'`)
    assert.ok(!states(ctx).includes('parked'),
      `${leg} [M4] NO page this run wrote ever read \`parked\`; the states were ` +
        JSON.stringify(states(ctx)))
    assert.ok(!commitStates(ctx).includes('parked'),
      `${leg} [M4] no page this run COMMITTED ever read \`parked\`; the branch took ` +
        JSON.stringify(commitStates(ctx)))
  })
}

// ── (f) the two operator documents name the probe  [M5] ──────────────────────

/** One `sed -n '/start/,/end/p'` range of a file, inclusive of both matches —
 *  the same scoping the Proof's two doc `Run:` lines use. `null` when the file
 *  carries no start line at all. */
function sedRange(file, start, end) {
  const all = fs.readFileSync(file, 'utf8').split('\n')
  const from = all.findIndex((l) => start.test(l))
  if (from < 0) return null
  const after = all.slice(from + 1).findIndex((l) => end.test(l))
  const to = after < 0 ? all.length - 1 : from + 1 + after
  return all.slice(from, to + 1)
}

/** The range as one line, which is what `tr '\n' ' '` hands the grep. */
const joined = (range) => range.join(' ')

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test("CONTRACT.md's `- engine:` bullet names the probe, six literals in order  [M5 / leg (f)]", () => {
  const range = sedRange(CONTRACT, /^ {2}- engine: /, /^ {2}- publish fold:/)
  assert.ok(range && range.length > 0,
    '(f) [M5] `fleet/CONTRACT.md` carries a `  - engine:` bullet and a `  - publish fold:` bullet ' +
      'below it — the range the Proof\'s sed scopes')
  const text = joined(range)
  const inOrder = new RegExp(CONTRACT_LITERALS.map(escapeRe).join('.*'))
  assert.match(text, inOrder,
    '(f) [M5] the engine bullet carries, IN ORDER, ' +
      CONTRACT_LITERALS.map((s) => `\`${s}\``).join(', ') +
      ' — the read that gates the probe, the endpoint, the park prefix, and the two class words ' +
      `with the trace. The bullet reads: ${text}`)
})

test("RUNBOOK.md's debugging item 3 names the probe line and the park  [M5 / leg (f)]", () => {
  const range = sedRange(RUNBOOK, /^3\. .\/home\/exedev\/www\/engine\.log./, /^4\. .journalctl/)
  assert.ok(range && range.length > 0,
    '(f) [M5] `fleet/RUNBOOK.md` carries the `engine.log` debugging item 3 and a `journalctl` ' +
      "item 4 below it — the range the Proof's sed scopes")
  const text = joined(range)
  for (const literal of RUNBOOK_LITERALS) {
    assert.ok(text.includes(literal),
      `(f) [M5] debugging item 3 carries \`${literal}\` — the next line after the auth status ` +
        'line, and what a page whose `error` begins that way means. The item reads: ' + text)
  }
})

// ── (g) the sims the Proof's last four `Run:` lines name  [M6] ───────────────
//
// NAMED, never run: `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids a
// `test_*.mjs` that spawns another one or `pytest`, and whether each prints
// `ALL TESTS PASSED` is its own `Run:` line's business.

for (const sim of [...SIBLING_SIMS, DOCS_PIN]) {
  test(`${sim} is a path the Proof's Run lines name  [M6 / leg (g)]`, () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, sim)),
      `(g) [M6] \`${sim}\` must exist — the probe rides in a rig those lines run against, and a ` +
        'Run line naming a path that is gone proves nothing. This leg names it; it does not run it.')
  })
}

test("the rig's curl stub answers the probe endpoint above its catch-all  [M6 / leg (g)]", () => {
  const body = STUBS.curl
  const arm = body.indexOf(PROBE_PATH)
  const unknown = body.indexOf('curl UNKNOWN')
  assert.ok(unknown >= 0,
    "(g) [M6] the rig's curl stub still ends in a catch-all that says `curl UNKNOWN` — this " +
      "leg's ordering read is stale otherwise")
  assert.ok(arm >= 0,
    `(g) [M6] the rig's curl stub answers \`${PROBE_PATH}\` by the shared \`STUB_BEARER\` knob; ` +
      'without that arm every `test_sandbox_boot*.mjs` sim falls through to the catch-all and ' +
      'exits 22 the moment the probe exists')
  assert.ok(arm < unknown,
    '(g) [M6] the probe arm sits BEFORE the catch-all, so the probe is answered rather than ' +
      `refused (arm at ${arm}, catch-all at ${unknown})`)
})

runTests(tests)
