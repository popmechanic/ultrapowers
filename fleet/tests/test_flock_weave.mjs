/**
 * fleet/tests/test_flock_weave.mjs — the hermetic sim map #1292's ticket 2
 * (#359) names: line identity in the Manyana weave, as the Flock's weave
 * keeper (`flock/proto/weave.py`) holds it. The permutation corpus this
 * replaces left the tree in b64ecc07.
 *
 * The keeper is driven the way the prototype's host drives it: one
 * `python3 weave.py` per scenario, one JSON request per line on stdin, one
 * answer per line on stdout. BASE files are written under a fresh temp root;
 * nothing of the checkout is read but the keeper and the vendored kernel it
 * imports, and nothing touches the network.
 *
 * Legs:
 *   (a) order-free convergence — three agents' edits, joined in all six
 *       orders, give one weave and exactly the intended text, no conflict;
 *   (b) edit-built identity on the duplicate `}` (fleet/launch.mjs 890–898 at
 *       2faf7a82, the stress reading's one silent wrong): one agent deletes an
 *       `if` block whose last line is `  }`, the other deletes the `  }` just
 *       above it. Built from edit calls the merge is exactly right; built by
 *       the text-comparison fallback (`rewrite`) it keeps one brace too many
 *       and flags nothing — the residue the edit path exists to avoid;
 *   (c) hidden candidates — private until published, published hidden (a
 *       pending delete withheld), selected on one copy, re-hidden on another,
 *       re-selected, a loser's line adopted at a chosen place; two different
 *       selections at once are a real conflict;
 *   (d) the same-anchor flag — two agents inserting at one anchor: `siblings`
 *       when the kernel flags the region but the host's adds-only union would
 *       close it, `unified` when a shared first line lets the kernel merge with
 *       no flag at all, and no flag for two identical blocks;
 *   (e) authorship keyed by identity — a BASE `}` stays `base` when an agent
 *       writes another `}` elsewhere.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KEEPER = path.join(HERE, '..', '..', 'flock', 'proto', 'weave.py')
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-weave-'))
const ENV = simEnv()

let passed = 0
const ok = (name) => { passed += 1; console.log(`ok - ${name}`) }

/** One keeper process: BASE `files` {path: [line]}, then `reqs` in order. */
function keeper (files, reqs) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'base-'))
  for (const [p, lines] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), lines.join('\n'))
  }
  const all = [{ op: 'base', root: dir, paths: Object.keys(files) }, ...reqs]
  const r = spawnSync('python3', [KEEPER], {
    input: all.map((x) => JSON.stringify(x)).join('\n') + '\n',
    env: ENV,
    encoding: 'utf8',
    timeout: 60000,
  })
  assert.equal(r.status, 0, r.stderr)
  const out = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(out.length, all.length, r.stdout + r.stderr)
  out.forEach((x, i) => assert.ok(x.ok, `request ${i} ${JSON.stringify(all[i])}: ${x.error}`))
  return out.slice(1)
}

const text = (m, p) => m.files[p].split('\n')
const perms = (xs) => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]))

// ── (a) order-free convergence ───────────────────────────────────────────
{
  const P = 'app.js'
  const base = ["import a from 'a'", '', 'function one() {', '  return 1', '}', '', 'function two() {', '  return 2', '}',
    '', 'function three() {', '  return 3', '}']
  const truth = ["import b from 'b'", "import a from 'a'", '', 'function one() {', '  return 1 + a()', '}', '',
    'function two() {', '  return 2 * 2', '}', '', 'function three() {', '  return 3 + 3', '  // three done', '}']
  const orders = perms(['A', 'B', 'C'])
  const out = keeper({ [P]: base }, [
    { op: 'edit', agent: 'A', path: P, vstart: 3, vend: 4, lines: ['  return 1 + a()'] },
    { op: 'edit', agent: 'A', path: P, vstart: 0, vend: 0, lines: ["import b from 'b'"] },
    { op: 'edit', agent: 'B', path: P, vstart: 7, vend: 8, lines: ['  return 2 * 2'] },
    { op: 'edit', agent: 'C', path: P, vstart: 11, vend: 12, lines: ['  return 3 + 3'] },
    { op: 'edit', agent: 'C', path: P, vstart: 12, vend: 12, lines: ['  // three done'] },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' }, { op: 'publish', agent: 'C' },
    ...orders.map((order) => ({ op: 'merged', order })),
    { op: 'pull', agent: 'A' }, { op: 'pull', agent: 'B' }, { op: 'pull', agent: 'C' },
    { op: 'view', agent: 'A', path: P }, { op: 'view', agent: 'B', path: P }, { op: 'view', agent: 'C', path: P },
  ])
  const joins = out.slice(8, 14)
  assert.equal(new Set(joins.map((m) => m.digest)).size, 1, 'one weave whatever the join order')
  assert.deepEqual(text(joins[0], P), truth)
  assert.deepEqual(joins[0].conflicts, [])
  for (const v of out.slice(17)) assert.deepEqual(v.text.split('\n'), truth)
  ok('(a) six join orders, one weave, the intended text, every copy converged')
}

// ── (b) edit-built identity on the duplicate `}` ─────────────────────────
{
  const P = 'launch.mjs'
  const fx = [
    '  } catch (error) {',
    '    return { unread: true, reason: `claude-token usage --json answered unparseable stdout: ${error.message}` }',
    '  }',
    '  if (!Array.isArray(parsed) || parsed.length !== 1) {',
    '    return { unread: true, reason: `claude-token usage --json answered no single-row array (got ${JSON.stringify(parsed)})` }',
    '  }',
    '  return parsed[0]',
    '}',
    '',
  ]
  const truth = [...fx.slice(0, 2), ...fx.slice(6)]
  const [, , , , m] = keeper({ [P]: fx }, [
    { op: 'edit', agent: 'A', path: P, vstart: 3, vend: 6, lines: [] },
    { op: 'edit', agent: 'B', path: P, vstart: 2, vend: 3, lines: [] },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' },
    { op: 'merged' },
  ])
  assert.deepEqual(text(m, P), truth, 'edit-built: both deletions land on the lines each agent meant')
  assert.deepEqual(m.conflicts, [])
  ok('(b) edit calls: the duplicate `}` merges exactly right')

  const [, , , , f] = keeper({ [P]: fx }, [
    { op: 'rewrite', agent: 'A', path: P, content: [...fx.slice(0, 3), ...fx.slice(6)].join('\n') },
    { op: 'rewrite', agent: 'B', path: P, content: [...fx.slice(0, 2), ...fx.slice(3)].join('\n') },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' },
    { op: 'merged' },
  ])
  assert.deepEqual(f.conflicts, [], 'the fallback flags nothing')
  assert.deepEqual(text(f, P), [...fx.slice(0, 2), '  }', ...fx.slice(6)], 'and keeps one brace too many')
  ok('(b) the text-comparison fallback guesses the upper `}` and is silently wrong (the residue)')
}

// ── (c) hidden candidates ────────────────────────────────────────────────
{
  const P = 'src/csv.js'
  const BASE = ['function importCsv(text) {', '  const header = text.slice(0, 1)', '}', '',
    'function exportCsv(rows) {', "  return rows.join('\\n')", '}']
  const C1 = ["  const rows = text.split('\\n')", "  if (!rows.length) throw new Error('empty')"]
  const C2 = ['  const rows = parse(text, { strict: true })', '  return rows.map(toWidget)']
  const PEER = '  // peer C: a comment in exportCsv'
  const plain = [...BASE.slice(0, 6), PEER, ...BASE.slice(6)]
  const chosen = [BASE[0], ...C2, ...BASE.slice(2, 6), PEER, ...BASE.slice(6)]
  const adopted = [BASE[0], C2[0], C1[1], C2[1], ...BASE.slice(2, 6), PEER, ...BASE.slice(6)]
  const reqs = [
    { op: 'cand_open', agent: 'A', cand: 'c1' }, { op: 'cand_edit', cand: 'c1', path: P, vstart: 1, vend: 2, lines: C1 },
    { op: 'cand_open', agent: 'B', cand: 'c2' }, { op: 'cand_edit', cand: 'c2', path: P, vstart: 1, vend: 2, lines: C2 },
    { op: 'edit', agent: 'C', path: P, vstart: 6, vend: 6, lines: [PEER] }, { op: 'publish', agent: 'C' },
    { op: 'pull', agent: 'A' }, { op: 'view', agent: 'A', path: P }, // 7: private — A sees no candidate
    { op: 'cand_publish', cand: 'c1' }, { op: 'cand_publish', cand: 'c2' },
    { op: 'pull', agent: 'A' }, { op: 'view', agent: 'A', path: P }, // 11: published hidden — still plain
    { op: 'cand_pull', cand: 'c1' }, { op: 'view', agent: 'c1', path: P }, // 13: the author still sees its own
    { op: 'pull', agent: 'B' }, { op: 'select', agent: 'A', cand: 'c2' },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' },
    { op: 'merged' }, // 18: selected on one copy, B stale
    { op: 'pull', agent: 'B' }, { op: 'rehide', agent: 'B', cand: 'c2' }, { op: 'publish', agent: 'B' },
    { op: 'merged' }, // 22: re-hidden on another copy
    { op: 'pull', agent: 'C' }, { op: 'select', agent: 'C', cand: 'c2' }, { op: 'publish', agent: 'C' },
    { op: 'merged' }, // 26: re-selected
    { op: 'pull', agent: 'A' }, { op: 'view', agent: 'A', path: P }, // 28
    { op: 'adopt', agent: 'A', path: P, text: C1[1], after: 1 }, { op: 'publish', agent: 'A' },
    { op: 'merged' }, // 31: c1's guard adopted between c2's two lines
  ]
  const out = keeper({ [P]: BASE }, reqs) // out[i] answers reqs[i]
  assert.deepEqual(out[7].text.split('\n'), plain, 'private: an unpublished candidate reaches nobody')
  assert.deepEqual(out[11].text.split('\n'), plain, 'published hidden: peers hold it, see base, and the pending delete is withheld')
  assert.deepEqual(out[13].text.split('\n'), [BASE[0], ...C1, ...BASE.slice(2, 6), PEER, ...BASE.slice(6)],
    'its author keeps seeing it after pulling peers that hold it hidden')
  assert.deepEqual(text(out[18], P), chosen, 'select on one copy: exactly the candidate, the replaced line gone')
  assert.deepEqual(out[18].realConflicts, [], 'a stale copy that never saw the candidate is only a shadow conflict')
  assert.deepEqual(text(out[22], P), plain, 're-hide on another copy restores base exactly')
  assert.deepEqual(text(out[26], P), chosen, 're-select wins over the stale re-hidden copy')
  assert.deepEqual(out[28].text.split('\n'), chosen)
  assert.deepEqual(text(out[31], P), adopted, 'adoption is a fresh line placed by the adopter')
  assert.deepEqual(out[31].realConflicts, [])
  ok('(c) private → published hidden → select → re-hide → re-select → adopt, each exactly as intended')

  const two = keeper({ [P]: BASE }, [
    { op: 'cand_open', agent: 'A', cand: 'c1' }, { op: 'cand_edit', cand: 'c1', path: P, vstart: 1, vend: 2, lines: C1 },
    { op: 'cand_publish', cand: 'c1' },
    { op: 'cand_open', agent: 'B', cand: 'c2' }, { op: 'cand_edit', cand: 'c2', path: P, vstart: 1, vend: 2, lines: C2 },
    { op: 'cand_publish', cand: 'c2' },
    { op: 'pull', agent: 'A' }, { op: 'pull', agent: 'B' },
    { op: 'select', agent: 'A', cand: 'c1' }, { op: 'select', agent: 'B', cand: 'c2' },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' },
    { op: 'merged' },
  ])
  assert.deepEqual(two.at(-1).realConflicts, [P], 'two copies choosing different candidates at once is a real conflict')
  ok('(c) two different selections at once: a real conflict')
}

// ── (d) the same-anchor flag ─────────────────────────────────────────────
{
  const P = 'f.js'
  const base = ['function f() {', '  a()', '}', 'g()']
  const pair = (xa, xb, puller) => keeper({ [P]: base }, [
    { op: 'edit', agent: 'A', path: P, vstart: 3, vend: 3, lines: xa },
    { op: 'edit', agent: 'B', path: P, vstart: 3, vend: 3, lines: xb },
    { op: 'publish', agent: 'A' }, { op: 'publish', agent: 'B' },
    { op: 'pull', agent: puller },
  ]).at(-1)

  const sib = pair(['  guard()'], ['  log()'], 'B')
  assert.equal(sib.changed[0].conflict, true)
  assert.equal(sib.changed[0].addsOnly, true, 'the host would union this one silently')
  assert.deepEqual(sib.sameAnchor[0].flags.map((f) => f.kind), ['siblings'])
  assert.deepEqual(sib.sameAnchor[0].flags[0].authors, ['A', 'B'])
  ok('(d) siblings: an adds-only union at one anchor is flagged')

  const uni = pair(['}'], ['}', 'h()'], 'A')
  assert.equal(uni.changed[0].conflict, false, 'the kernel sees nothing')
  assert.deepEqual(uni.sameAnchor[0].flags.map((f) => f.kind), ['unified'])
  assert.equal(uni.sameAnchor[0].flags[0].line, '}')
  ok('(d) unified: a shared first line merges clean in the kernel, and the flag says so')

  const same = pair(['  log()'], ['  log()'], 'A')
  assert.deepEqual(same.sameAnchor, [], 'two identical blocks are one edit, not a collision')
  ok('(d) identical blocks: no flag')
}

// ── (e) authorship keyed by identity ─────────────────────────────────────
{
  const P = 'k.js'
  const [, a] = keeper({ [P]: ['{', '}', 'x()'] }, [
    { op: 'edit', agent: 'A', path: P, vstart: 3, vend: 3, lines: ['}'] },
    { op: 'authors_keyed', agent: 'A', path: P },
  ])
  assert.deepEqual(a.authors, ['base', 'base', 'base', 'A'])
  ok('(e) a BASE `}` stays base when A writes another `}`')
}

fs.rmSync(ROOT, { recursive: true, force: true })
console.log(`${passed} legs`)
console.log('ALL TESTS PASSED')
