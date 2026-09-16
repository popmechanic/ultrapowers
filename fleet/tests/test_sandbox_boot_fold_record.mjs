// fleet/tests/test_sandbox_boot_fold_record.mjs — the boot copies the run's
// fold record onto the evidence branch (#728, run-166 task 1).
//
// The Claim: after a run, its evidence tag carries — beside the receipts —
// every fold log, conflicts index, narration, resolver brief and resolver
// reply the run wrote, and the weave sidecar's manifest and event log, but
// never the weave's blob store and never a file so large it would swamp the
// record.
//
// The exam is written against the task's Machine clauses, leg by leg. Every
// assertion names the leg it belongs to and the clause it comes from, so a
// reader can map this file back to the contract:
//
//   M1  For a run whose engine left, under the run directory,
//       `frontier/wave-1/fold_log.jsonl`, `frontier/wave-1/conflicts.json`,
//       `frontier/wave-1/fold_stats.json`, `frontier/wave-1/conflict-1.txt`,
//       `frontier/wave-1/conflict-1.hunks.txt`,
//       `frontier/wave-1/reply-1-1/h1.txt`,
//       `frontier/wave-1/reply-1-1/notes.txt`, `frontier/weave/manifest.json`
//       and `frontier/weave/weave-events.jsonl`, the evidence worktree's
//       `.ultrapowers/runs/<N>/frontier/` holds each of those nine files at
//       the same relative path, byte-identical, holds no `frontier/frontier`
//       entry, and the tree of the run's last evidence commit names
//       `frontier`.
//   M2  No file under `frontier/weave/blobs/` is copied: the evidence copy has
//       no `frontier/weave/blobs` entry while the run directory has one with a
//       file in it.
//   M3  A regular file under `frontier/` whose size in bytes exceeds
//       `FLEET_EVIDENCE_FILE_MAX` (default `1048576`) is not copied, the boot
//       log carries one line `evidence: frontier/<rel> is <bytes> bytes over
//       FLEET_EVIDENCE_FILE_MAX=<cap> — skipped` naming it, and every other
//       file under `frontier/` still lands; a file of exactly
//       `FLEET_EVIDENCE_FILE_MAX` bytes is copied.
//   M4  `fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet, read from its
//       `ultra/evidence-run-<N>` line to the `**The two tags**` bullet, says
//       `frontier/` is copied — the wave directories' files, the weave
//       sidecar's `manifest.json` and `weave-events.jsonl`, never
//       `weave/blobs/` — with each file at most `FLEET_EVIDENCE_FILE_MAX`
//       bytes, default `1048576`.
//
// Legs: (a) M1 the nine files land byte-identical and no `frontier/frontier`
// entry exists; (b) M1 the last evidence commit's tree names `frontier`;
// (c) M2 no `frontier/weave/blobs` on the record while the run directory
// still has one; (d) M3 the oversize file is skipped, named by one log line,
// and its neighbour still lands; (e) M3 at `FLEET_EVIDENCE_FILE_MAX=64`, the
// 64-byte file lands and the 65-byte one is skipped and named; (f) M1 M2 M3
// the first `Run:` — the sim prints the sentinel; (g) M4 the second `Run:` —
// the contract bullet; (h) M1 the third `Run:` — the guarded sim imports
// nothing under `exams/`.
//
// TWO BOOTS, no more. A boot is ~40 forks of stub shell, so each is started
// once and every leg that reads it joins the one promise:
//
//   KEPT   the default cap. Seeded, BEFORE the boot, with the nine files M1
//          names plus `frontier/weave/blobs/<64 hex>` (M2's store) and a
//          1048577-byte `frontier/wave-1/conflict-2.txt` (M3's oversize file).
//          Legs (a), (b), (c) and (d) read it.
//   CAP64  `FLEET_EVIDENCE_FILE_MAX=64`, seeded with a 64-byte `h1.txt` and a
//          65-byte `notes.txt` — the two sides of the threshold. Leg (e).
//
// The seeding is what the ENGINE wrote: the git stub's `clone` arm only
// `mkdir -p`s the clone and the engine stub only `mkdir -p`s the run
// directory, so files a case writes under `runDir(ctx)` before the boot
// survive both and are the record the copy has to find.
//
// `collect_evidence` runs at every `write_status` transition and once more at
// `fail`, so every copy must be idempotent — which is why leg (a) asserts the
// evidence tree is EXACTLY the nine paths (a `cp -R` that nested a second
// `frontier/` inside the first would carry a tenth) and why legs (d) and (e)
// assert ONE skip line, as M3 and the Proof both spell it, rather than one per
// transition.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENV, RUN_PATH,
  makeHome, bootAsync, runDir, trees, stream,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.join(path.dirname(SELF), '..', '..')

// ── what the engine left under the run directory ─────────────────────────────

/** M1's nine files, each with its own contents so a copy that swapped two of
 *  them is a different file rather than the same bytes twice. The shapes are
 *  the kernel's and the driver's: `fold_log.jsonl`'s `base`/`fold`/`resolve`
 *  rows, `conflicts.json`'s list, `fold_stats.json`'s record, the annotated
 *  narration, the resolver's brief, and the reply the driver wrote back. */
const NINE = [
  ['wave-1/fold_log.jsonl', [
    '{"type":"base","sha":"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"}',
    '{"type":"fold","task":"1","headSha":"a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7","patch":"task-1.patch"}',
    '{"type":"fold","task":"2","headSha":"b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8","anchor":"fleet/CONTRACT.md"}',
    '{"type":"resolve","path":"fleet/CONTRACT.md","epoch":1,"lines":["# contract","","- one","- two"]}',
    '',
  ].join('\n')],
  ['wave-1/conflicts.json', `${JSON.stringify([
    {
      i: 1,
      path: 'fleet/CONTRACT.md',
      kind: 'content',
      dispatchable: true,
      reason: 'two tasks touched the same bullet',
      epoch: 1,
      hunksFile: 'conflict-1.hunks.txt',
      hunkCount: 2,
    },
    {
      i: 2,
      path: 'fleet/sandbox-boot.sh',
      kind: 'content',
      dispatchable: false,
      reason: 'resolved by the kernel',
      epoch: 1,
      hunksFile: 'conflict-2.hunks.txt',
      hunkCount: 1,
      autoResolved: true,
    },
  ], null, 2)}\n`],
  ['wave-1/fold_stats.json', `${JSON.stringify({ maxLines: 4096, epochs: 1, resolved: 1 }, null, 2)}\n`],
  ['wave-1/conflict-1.txt', 'conflict 1 — fleet/CONTRACT.md\n<<<<<<< ours\n- one\n=======\n- two\n>>>>>>> theirs\n'],
  ['wave-1/conflict-1.hunks.txt', 'hunk 1 of 2 for fleet/CONTRACT.md\nhunk 2 of 2 for fleet/CONTRACT.md\n'],
  ['wave-1/reply-1-1/h1.txt', 'the resolver\'s hunk 1 reply\n- one\n- two\n'],
  ['wave-1/reply-1-1/notes.txt', 'the resolver kept both bullets, in the order the plan names them\n'],
  ['weave/manifest.json', `${JSON.stringify({
    version: 1,
    paths: { 'fleet/CONTRACT.md': '9f'.repeat(32) },
  }, null, 2)}\n`],
  ['weave/weave-events.jsonl', [
    '{"kind":"weave:open","epoch":1,"ts":1}',
    '{"kind":"weave:put","path":"fleet/CONTRACT.md","blob":"' + '9f'.repeat(32) + '","ts":2}',
    '',
  ].join('\n')],
]
/** The nine relative paths, sorted — the whole of what M1, M2 and M3 together
 *  leave on the record for the KEPT boot's seeding. */
const NINE_PATHS = NINE.map(([rel]) => rel).sort()

/** M2's content-addressed store: one whole manyana state string, named by its
 *  sha256, under the directory no copy may reach. */
const BLOB_NAME = '9f'.repeat(32)
const BLOB_REL = `weave/blobs/${BLOB_NAME}`
const BLOB_BODY = 'the whole resolved state of fleet/CONTRACT.md\n'

/** M3's oversize file, one byte past the default cap, written the way the
 *  task names: `Buffer.alloc(1048577, 0x61)`. A `resolve` row carries the
 *  WHOLE resolved file's lines, which is how a fold log gets this big. */
const DEFAULT_CAP = 1048576
const BIG_REL = 'wave-1/conflict-2.txt'
const BIG_BODY = Buffer.alloc(DEFAULT_CAP + 1, 0x61)

/** M3's threshold, both sides, for the second boot. Exactly `cap` bytes is
 *  copied; `cap + 1` is not. */
const SMALL_CAP = 64
const AT_CAP_REL = 'wave-1/reply-1-1/h1.txt'
const AT_CAP_BODY = Buffer.alloc(SMALL_CAP, 0x62)
const OVER_CAP_REL = 'wave-1/reply-1-1/notes.txt'
const OVER_CAP_BODY = Buffer.alloc(SMALL_CAP + 1, 0x63)

/** The skip line M3 spells, for one file and one cap. */
const skipLine = (rel, bytes, cap) =>
  `evidence: frontier/${rel} is ${bytes} bytes over FLEET_EVIDENCE_FILE_MAX=${cap} — skipped`

// ── reading the two trees ────────────────────────────────────────────────────

/** A file under the run directory's `frontier/`, as the engine left it. */
const foldRecordFile = (ctx, rel) => path.join(runDir(ctx), 'frontier', rel)
/** Its copy on the evidence branch — `.ultrapowers/runs/7/frontier/<rel>`. */
const evidenceFile = (ctx, rel) => path.join(ctx.home, 'evidence', RUN_PATH, 'frontier', rel)
/** The evidence branch's `frontier/` root, whether or not the run made one. */
const evidenceFrontier = (ctx) => evidenceFile(ctx, '.')

/** Write one file under the run directory's `frontier/`, as the engine would. */
const seed = (ctx, rel, body) => {
  const f = foldRecordFile(ctx, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, body)
}

/** Every regular file under `dir`, as relative paths, sorted. `[]` when the
 *  directory does not exist at all — which is what BASE leaves. */
const walk = (dir) => {
  const out = []
  const visit = (at, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(at, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) visit(path.join(at, e.name), rel)
      else out.push(rel)
    }
  }
  visit(dir, '')
  return out.sort()
}

/** Every `evidence: … — skipped` line the boot wrote about a `frontier/` file,
 *  in order. The walk's closing `evidence: <ls of the destination>` line is not
 *  one: it names no cap and carries no `skipped`. */
const frontierSkips = (ctx) =>
  stream(ctx).filter((l) => l.startsWith('evidence: frontier/') && l.endsWith('— skipped'))

// ── the two boots, each started once ─────────────────────────────────────────

const started = new Map()
const once = (label, start) => {
  if (!started.has(label)) started.set(label, start())
  return started.get(label)
}

/**
 * The KEPT boot: the default cap, the nine files of M1, M2's blob store and
 * M3's oversize file, all written before the boot so the engine stub's
 * `mkdir -p` finds them already there.
 */
const kept = () => once('kept', async () => {
  const ctx = makeHome()
  for (const [rel, body] of NINE) seed(ctx, rel, body)
  seed(ctx, BLOB_REL, BLOB_BODY)
  seed(ctx, BIG_REL, BIG_BODY)
  const r = await bootAsync(ctx, ['boot'])
  assert.equal(r.status, 0, `the KEPT boot did not finish\n${r.stdout}${r.stderr}`)
  return ctx
})

/** The CAP64 boot: M3's threshold, both sides of it, at a cap of 64 bytes. */
const cap64 = () => once('cap64', async () => {
  const ctx = makeHome()
  seed(ctx, AT_CAP_REL, AT_CAP_BODY)
  seed(ctx, OVER_CAP_REL, OVER_CAP_BODY)
  const r = await bootAsync(ctx, ['boot'], { FLEET_EVIDENCE_FILE_MAX: String(SMALL_CAP) })
  assert.equal(r.status, 0, `the CAP64 boot did not finish\n${r.stdout}${r.stderr}`)
  return ctx
})

// ── leg (a) — M1: the nine files, byte-identical, and no nested `frontier` ───

test('(a) [M1] the nine files the engine left under `frontier/` land on the evidence branch byte-identical', async () => {
  const ctx = await kept()
  for (const [rel, body] of NINE) {
    const src = foldRecordFile(ctx, rel)
    assert.ok(
      fs.existsSync(src),
      `(a) [M1] the seeding did not survive the boot: the run directory has no \`frontier/${rel}\``,
    )
    const dst = evidenceFile(ctx, rel)
    assert.ok(
      fs.existsSync(dst),
      `(a) [M1] the evidence worktree has no \`frontier/${rel}\`\n`
      + `  expected at ${dst}\n`
      + `  the evidence copy holds: ${JSON.stringify(walk(evidenceFrontier(ctx)))}`,
    )
    const want = Buffer.from(body)
    const got = fs.readFileSync(dst)
    assert.ok(
      got.equals(want),
      `(a) [M1] \`frontier/${rel}\` is not byte-identical to what the engine wrote\n`
      + `  wrote (${want.length} bytes): ${JSON.stringify(want.toString())}\n`
      + `  copied (${got.length} bytes): ${JSON.stringify(got.toString())}`,
    )
  }
})

test('(a) [M1] [M2] [M3] the evidence branch\'s `frontier/` is exactly those nine paths', async () => {
  const ctx = await kept()
  assert.deepEqual(
    walk(evidenceFrontier(ctx)),
    NINE_PATHS,
    '(a) [M1] the evidence copy of `frontier/` must hold the nine files M1 names and nothing else — '
    + 'M2 keeps `weave/blobs/` off it and M3 keeps the oversize file off it',
  )
})

test('(a) [M1] no `frontier/frontier` entry reaches the evidence branch', async () => {
  const ctx = await kept()
  const nested = evidenceFile(ctx, 'frontier')
  assert.ok(
    !fs.existsSync(nested),
    '(a) [M1] the evidence copy carries a `frontier/frontier` entry — the copy nested the run\'s '
    + '`frontier/` inside the one an earlier transition had already written; the walk must be file '
    + `by file, never \`cp -R\` of the directory\n  ${nested}`,
  )
})

// ── leg (b) — M1: the last evidence commit's tree names `frontier` ───────────

test('(b) [M1] the tree of the run\'s last evidence commit names `frontier`', async () => {
  const ctx = await kept()
  const committed = trees(ctx)
  assert.ok(committed.length > 0, '(b) [M1] the run made no evidence commit at all')
  const last = committed[committed.length - 1].split(' ').filter(Boolean)
  assert.ok(
    last.includes('frontier'),
    '(b) [M1] the last evidence commit\'s tree does not name `frontier` — the copy landed after the '
    + `last commit, or never landed\n  last tree: ${JSON.stringify(last)}\n`
    + `  every tree:\n${committed.map((t) => `    ${t}`).join('\n')}`,
  )
})

// ── leg (c) — M2: the weave's blob store stays off the record ────────────────

test('(c) [M2] the run directory keeps its `frontier/weave/blobs/`, and the evidence branch has none', async () => {
  const ctx = await kept()
  const src = foldRecordFile(ctx, BLOB_REL)
  assert.ok(
    fs.existsSync(src),
    `(c) [M2] the run directory must still hold \`frontier/${BLOB_REL}\` — the copy reads the store, `
    + `it never moves it\n  ${src}`,
  )
  const dst = evidenceFile(ctx, 'weave/blobs')
  assert.ok(
    !fs.existsSync(dst),
    '(c) [M2] the evidence copy carries a `frontier/weave/blobs` entry — the content-addressed store '
    + `is the one thing under \`frontier/\` that never reaches the record\n  ${dst}\n`
    + `  the evidence copy holds: ${JSON.stringify(walk(evidenceFrontier(ctx)))}`,
  )
})

// ── leg (d) — M3: the oversize file, at the default cap ──────────────────────

test('(d) [M3] a file past the default cap is not copied, is named by one log line, and its neighbour still lands', async () => {
  const ctx = await kept()

  const dst = evidenceFile(ctx, BIG_REL)
  assert.ok(
    !fs.existsSync(dst),
    `(d) [M3] \`frontier/${BIG_REL}\` is ${BIG_BODY.length} bytes, past the default cap of `
    + `${DEFAULT_CAP}, and must not reach the record\n  ${dst}`,
  )

  const want = skipLine(BIG_REL, BIG_BODY.length, DEFAULT_CAP)
  assert.deepEqual(
    frontierSkips(ctx),
    [want],
    '(d) [M3] the boot log must carry exactly one `evidence: … — skipped` line for `frontier/`, '
    + `naming the file, its size and the cap it passed\n  expected: ${want}\n`
    + `  the log's \`evidence:\` lines:\n`
    + `${stream(ctx).filter((l) => l.startsWith('evidence:')).map((l) => `    ${l}`).join('\n')}`,
  )

  const neighbour = evidenceFile(ctx, 'wave-1/conflict-1.txt')
  assert.ok(
    fs.existsSync(neighbour),
    '(d) [M3] `frontier/wave-1/conflict-1.txt` shares a directory with the skipped file and must '
    + `still land — one oversize file skips itself, never the walk\n  ${neighbour}`,
  )
})

// ── leg (e) — M3: both sides of the threshold, at a cap of 64 ────────────────

test('(e) [M3] at `FLEET_EVIDENCE_FILE_MAX=64` a 64-byte file lands and a 65-byte file is skipped and named', async () => {
  const ctx = await cap64()

  const at = evidenceFile(ctx, AT_CAP_REL)
  assert.ok(
    fs.existsSync(at),
    `(e) [M3] \`frontier/${AT_CAP_REL}\` is exactly ${SMALL_CAP} bytes — the cap, not past it — and `
    + `must be copied\n  ${at}\n`
    + `  the evidence copy holds: ${JSON.stringify(walk(evidenceFrontier(ctx)))}`,
  )
  const got = fs.readFileSync(at)
  assert.ok(
    got.equals(AT_CAP_BODY),
    `(e) [M3] the ${SMALL_CAP}-byte file did not land byte-identical `
    + `(${got.length} bytes copied, ${AT_CAP_BODY.length} written)`,
  )

  const over = evidenceFile(ctx, OVER_CAP_REL)
  assert.ok(
    !fs.existsSync(over),
    `(e) [M3] \`frontier/${OVER_CAP_REL}\` is ${OVER_CAP_BODY.length} bytes, one past the cap of `
    + `${SMALL_CAP}, and must not reach the record\n  ${over}`,
  )

  const want = skipLine(OVER_CAP_REL, OVER_CAP_BODY.length, SMALL_CAP)
  assert.deepEqual(
    frontierSkips(ctx),
    [want],
    '(e) [M3] the boot log must carry exactly one `evidence: … — skipped` line, naming the 65-byte '
    + `file against the cap the run was given\n  expected: ${want}\n`
    + `  the log's \`evidence:\` lines:\n`
    + `${stream(ctx).filter((l) => l.startsWith('evidence:')).map((l) => `    ${l}`).join('\n')}`,
  )
})

// ── legs (f) (g) (h) — the Proof's three `Run:` lines ────────────────────────

/** The path the third `Run:` names, relative to the checkout — taken from
 *  `import.meta.url` rather than spelled as a literal, so the hermetic probe's
 *  `sibling` rule does not read this sim naming itself as a sibling run. The
 *  command bash is handed is character-identical to the Proof's. */
const SELF_REL = path.relative(ROOT, SELF)

/** The Proof's second and third `Run:` lines, as the driver runs them. */
const READERS = [
  [
    '(g)',
    'M4',
    'the `ultra/evidence-run-<N>` bullet says `frontier/` is copied, never `weave/blobs/`, '
    + 'capped by `FLEET_EVIDENCE_FILE_MAX`',
    'fleet/CONTRACT.md\'s `ultra/evidence-run-<N>` bullet, read to the `**The two tags**` bullet, '
    + 'must carry `frontier/`, `manifest.json`, `weave-events.jsonl`, `weave/blobs/`, '
    + '`FLEET_EVIDENCE_FILE_MAX` and `1048576`, in that order',
    "sed -n '/ultra\\/evidence-run-<N>. — the run.s record/,/^- \\*\\*The two tags\\*\\*/p' fleet/CONTRACT.md"
    + " | tr '\\n' ' '"
    + " | grep -q 'frontier/.*manifest.json.*weave-events.jsonl.*weave/blobs/.*FLEET_EVIDENCE_FILE_MAX.*1048576'",
  ],
  [
    '(h)',
    'M1',
    'the guarded sim imports nothing under `exams/`',
    'the guarded sim must carry no `import` line naming a path under `exams/` — a guarded exam file '
    + 'is self-contained at its guarded path',
    `! grep -qE "^import .*exams/" ${SELF_REL}`,
  ],
]

for (const [leg, clause, name, what, cmd] of READERS) {
  test(`${leg} [${clause}] ${name}`, () => {
    const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
    assert.equal(
      r.status, 0,
      `${leg} [${clause}] ${what}\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`,
    )
  })
}

// Leg (f) is the aggregate of (a)–(e): the first `Run:` greps this process's
// output for the sentinel, so the sim's own green IS the leg. What is left to
// assert is the one thing that green does not show — that the runner these
// cases are handed prints the exact string that `Run:` greps for.
test('(f) [M1] [M2] [M3] the sim\'s runner prints the sentinel the first `Run:` greps for', () => {
  assert.ok(
    String(runTests).includes('ALL TESTS PASSED'),
    '(f) [M1] [M2] [M3] the first `Run:` is '
    + '`node fleet/tests/test_sandbox_boot_fold_record.mjs | grep -q \'ALL TESTS PASSED\'`, so the '
    + 'runner this sim hands its cases to must print that sentinel and no other',
  )
})

runTests(tests)
