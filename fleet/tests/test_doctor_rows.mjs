/**
 * fleet/tests/test_doctor_rows.mjs — the exam for "The laptop side forgets the
 * renderer — doctor, launcher, setup script, and the row lists that name them"
 * (task 2).
 *
 * The Cloudflare renderer was a ninth doctor row, a config key the launcher
 * read, an env file the setup script wrote, and a sentence in five documents.
 * After this run the doctor has eight rows and the laptop side names no
 * renderer at all.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `ROW_IDS` deep-equals `['exe-dev', 'capacity', 'claude',
 *       'accounts', 'github', 'integrations', 'verb-drift', 'kata']`;
 *       `doctor()` driven by a stub `exec` returns exactly those eight rows in
 *       that order; the module's export names carry neither `renderOf` nor
 *       `fleetConfigRender`, and its text defines no `rendererRow`;
 *   (b) [M2] `doctor()` given `configKeys` `['cpu', 'memory', 'account',
 *       'render']` answers a `capacity` row that is `missing` and whose
 *       `detail` names `render` as a key nothing reads, while the same call
 *       given `['cpu', 'memory', 'account']` answers one whose detail says no
 *       such thing; and a `render` option changes no row — the rows of a call
 *       carrying one deep-equal the rows of the call without it;
 *   (c) [M3] `renderSetupScript({run, bootstrap, unit})` returns a script
 *       carrying neither `render.env` nor `TINYAPP_RENDER_URL` and still
 *       carrying the unit template's own name; `fleet/doctor.mjs`,
 *       `fleet/launch.mjs`, `fleet/setup-script.mjs` and
 *       `fleet/tests/_helpers.mjs` carry no line matching `renderOf`,
 *       `fleetConfigRender`, `rendererRow`, `RENDER_SHAPES`, `render.env` or
 *       `TINYAPP_RENDER_URL` — the second `Run:` line's zero count, asked here
 *       of the same four files; and the rig's export names lack
 *       `RENDER_SHAPES`. The launch sims of the first `Run:` line are the
 *       driver's to run: this file starts no process at all;
 *   (d) [M4] the `## ` headings of `references/first-run.md`, in file order,
 *       deep-equal `ROW_IDS`, and its first paragraph says `eight rows`;
 *       `SKILL.md`'s row-id sentence lists the eight ids in that order and the
 *       file names no renderer; `CLAUDE.md`'s doctor sentence says `eight
 *       rows`; and the only case-insensitive `render` left across `SKILL.md`
 *       and `RUNBOOK.md` is the RUNBOOK's "rendered setup script" phrase —
 *       the third `Run:` line, in line counts, as `grep -c` counts them;
 *   (e) [M5] `fleet/CONTRACT.md`'s doctor bullet says eight rows and carries
 *       exactly eight table rows; the four renderer phrases
 *       (`render.integration`, `rendering integration`, `rendering one`,
 *       `"render"`) match no line of the file; and the laptop-config bullet's
 *       JSON example carries exactly `cpu`, `memory` and `account`.
 *
 * Every read the doctor makes is answered by the stub, and the stub answers
 * greenly — a readable billing plan, a listing carrying the bearer on
 * `tag:fleet`, a hub row — so the board is legible; but the exam asserts the
 * row ids, their order and the `capacity` row only, and never another row's
 * colour, which is the launcher's and the edge's business rather than this
 * task's. `verbsPath` points at a temp copy of `fleet/exe-verbs.json` so the
 * verb-drift read is hermetic.
 *
 * `doctor.mjs` and `_helpers.mjs` are read through namespace imports as well as
 * named ones: the export-name legs ask what the module exports, and a named
 * import of something a tree lacks would be a link error that hid every other
 * leg.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as doctorModule from '../doctor.mjs'
import { ROW_IDS, doctor } from '../doctor.mjs'
import * as setupModule from '../setup-script.mjs'
import * as rigModule from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.resolve(HERE, '..')
const ROOT = path.resolve(FLEET, '..')
const SKILL = path.join(ROOT, 'skills', 'ultrapowers')

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')

/** `grep -c` counts LINES that match, not occurrences; so does this. */
const countLines = (text, re) => text.split('\n').filter((line) => re.test(line)).length

/** The lines of `text` from the one starting `head` to the next line starting
 *  `next`, exclusive — one bullet of a document written in bullets. */
const bulletLines = (text, head, next) => {
  const lines = text.split('\n')
  const from = lines.findIndex((line) => line.startsWith(head))
  assert.ok(from >= 0, `fleet/CONTRACT.md carries a line starting ${JSON.stringify(head)}`)
  const to = lines.findIndex((line, i) => i > from && line.startsWith(next))
  return lines.slice(from, to < 0 ? lines.length : to)
}

/** The eight ids, spelled out as M1 spells them rather than read off the
 *  module, so the module is graded against the clause and not against itself. */
const EIGHT = ['exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'verb-drift', 'kata']

// ── the stub the doctor is driven with ───────────────────────────────────────

const LISTING = JSON.stringify({
  integrations: [
    {
      name: 'claude-max',
      config_summary: 'Authorization: Bearer ***',
      attachments: ['tag:fleet'],
      comment: 'account=someone@example.com'
    },
    { name: 'kata', config_summary: 'Authorization: Bearer ***', attachments: ['tag:fleet'] }
  ]
})

const ANSWERS = [
  [/^ssh exe\.dev whoami$/, 'exedev'],
  [/billing plan --json/, JSON.stringify({ max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' })],
  [/integrations list --json/, LISTING],
  [/integrations setup github --list/, 'GitHub accounts:\n  octocat'],
  [/integrations policy get/, JSON.stringify({ policy: { selector: 'tag:fleet' }, revision: 3 })],
  [/ls kata-hub --json/, JSON.stringify({ vms: [{ vm_name: 'kata-hub', status: 'running' }] })],
  [/claude-token\.mjs accounts/, JSON.stringify([{ account: 'someone@example.com', expiresAt: '2027-01-01T00:00:00Z' }])],
  [/claude-token\.mjs status/, 'someone@example.com expires 2027-01-01T00:00:00Z'],
  [/"help /, 'Options:\n  --json  answer JSON\n']
]

/** Every read answered in the shape the doctor's own parsers expect, and
 *  nothing else: the exam opens no socket and starts no process. */
const exec = async (cmd) => {
  for (const [when, stdout] of ANSWERS) {
    if (when.test(String(cmd))) return { code: 0, stdout }
  }
  return { code: 0, stdout: '{}' }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-doctor-rows-'))
const VERBS = path.join(tmp, 'exe-verbs.json')
fs.copyFileSync(path.join(FLEET, 'exe-verbs.json'), VERBS)

const rowsFor = (options = {}) => doctor({ exec, verbsPath: VERBS, ...options })

try {
  // ── a. [M1] eight rows, in this order, and no renderer left in the module ──
  {
    assert.deepEqual(
      [...ROW_IDS], EIGHT,
      '(a) [M1] ROW_IDS is exactly the eight ids, in that order'
    )

    const result = await rowsFor({ configKeys: ['cpu', 'memory', 'account'] })
    assert.equal(result.rows.length, 8, '(a) [M1] doctor() returns eight rows')
    assert.deepEqual(
      result.rows.map((r) => r.id), EIGHT,
      '(a) [M1] doctor() returns exactly those eight rows in that order'
    )
    assert.deepEqual(
      result.rows.map((r) => r.id), [...ROW_IDS],
      '(a) [M1] and the rows it returns are ROW_IDS itself, in ROW_IDS order'
    )

    const exported = Object.keys(doctorModule)
    assert.ok(
      !exported.includes('renderOf'),
      `(a) [M1] fleet/doctor.mjs exports no renderOf — it exports ${exported.join(', ')}`
    )
    assert.ok(
      !exported.includes('fleetConfigRender'),
      `(a) [M1] fleet/doctor.mjs exports no fleetConfigRender — it exports ${exported.join(', ')}`
    )
    assert.equal(
      countLines(read(FLEET, 'doctor.mjs'), /rendererRow/), 0,
      '(a) [M1] fleet/doctor.mjs defines no rendererRow'
    )
  }

  // ── b. [M2] the capacity row reads the config's keys; render is not one ────
  {
    const stale = await rowsFor({ configKeys: ['cpu', 'memory', 'account', 'render'] })
    const staleRow = stale.rows.find((r) => r.id === 'capacity')
    assert.ok(staleRow, '(b) [M2] the rows carry a capacity row')
    assert.equal(
      staleRow.status, 'missing',
      '(b) [M2] a fleet.json carrying render makes the capacity row missing'
    )
    assert.ok(
      staleRow.detail.includes('render'),
      `(b) [M2] and its detail names render — it says ${JSON.stringify(staleRow.detail)}`
    )
    assert.ok(
      staleRow.detail.includes('keys nothing reads'),
      `(b) [M2] as a key nothing reads — it says ${JSON.stringify(staleRow.detail)}`
    )

    const clean = await rowsFor({ configKeys: ['cpu', 'memory', 'account'] })
    const cleanRow = clean.rows.find((r) => r.id === 'capacity')
    assert.ok(cleanRow, '(b) [M2] the rows carry a capacity row')
    assert.ok(
      !cleanRow.detail.includes('keys nothing reads'),
      `(b) [M2] cpu, memory and account are not stale keys — it says ${JSON.stringify(cleanRow.detail)}`
    )

    const passed = await rowsFor({
      configKeys: ['cpu', 'memory', 'account'], render: { integration: 'x', account: 'a' }
    })
    assert.deepEqual(
      passed.rows, clean.rows,
      '(b) [M2] doctor() accepts no render option — a caller passing one changes no row'
    )
  }

  // ── c. [M3] the setup script, and the four files' zero count ──────────────
  {
    const script = setupModule.renderSetupScript({ run: '1', bootstrap: 'a\n', unit: 'b\n' })
    assert.equal(typeof script, 'string', '(c) [M3] renderSetupScript returns a script')
    assert.ok(
      !script.includes('render.env'),
      '(c) [M3] the setup script carries no render.env'
    )
    assert.ok(
      !script.includes('TINYAPP_RENDER_URL'),
      '(c) [M3] the setup script carries no TINYAPP_RENDER_URL'
    )
    assert.ok(
      script.includes('fleet-run@.service'),
      '(c) [M3] and it still drops the unit template fleet-run@.service'
    )

    const gone = /renderOf|fleetConfigRender|rendererRow|RENDER_SHAPES|render\.env|TINYAPP_RENDER_URL/
    for (const parts of [['doctor.mjs'], ['launch.mjs'], ['setup-script.mjs'], ['tests', '_helpers.mjs']]) {
      const where = ['fleet', ...parts].join('/')
      const offenders = read(FLEET, ...parts)
        .split('\n')
        .map((line, i) => (gone.test(line) ? `${i + 1}: ${line.trim()}` : null))
        .filter((hit) => hit !== null)
      assert.deepEqual(
        offenders, [],
        `(c) [M3] ${where} names no renderer — ${offenders.length} line(s) do`
      )
    }

    assert.ok(
      !Object.keys(rigModule).includes('RENDER_SHAPES'),
      '(c) [M3] fleet/tests/_helpers.mjs no longer exports RENDER_SHAPES'
    )
  }

  // ── d. [M4] the row lists: first-run.md, SKILL.md, CLAUDE.md, RUNBOOK.md ──
  {
    const firstRun = read(SKILL, 'references', 'first-run.md')
    const headings = [...firstRun.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
    assert.deepEqual(
      headings, EIGHT,
      '(d) [M4] the ## headings of references/first-run.md, in file order, are the eight ids — there is no ## render section'
    )
    assert.deepEqual(
      headings, [...ROW_IDS],
      '(d) [M4] and they are ROW_IDS itself, in ROW_IDS order'
    )

    const blocks = firstRun.split(/\n\s*\n/)
    assert.ok(blocks.length > 1, '(d) [M4] references/first-run.md has a first paragraph under its title')
    assert.ok(
      blocks[1].includes('eight rows'),
      `(d) [M4] and it says eight rows — it says ${JSON.stringify(blocks[1].replace(/\s+/g, ' ').trim())}`
    )

    const skillText = read(SKILL, 'SKILL.md')
    const sentence = /row ids are ([^.]*)/.exec(skillText.replace(/\s+/g, ' '))
    assert.ok(sentence, '(d) [M4] skills/ultrapowers/SKILL.md carries a row-id sentence')
    const listed = [...sentence[1].matchAll(/`([^`]+)`/g)].map((m) => m[1])
    assert.deepEqual(
      listed, EIGHT,
      "(d) [M4] SKILL.md's row-id sentence lists the eight ids, ending verb-drift, kata"
    )

    const claudeMd = read(ROOT, 'CLAUDE.md')
    assert.match(
      claudeMd.replace(/\s+/g, ' '), /`doctor\.mjs`[^.]*eight rows/,
      "(d) [M4] CLAUDE.md's doctor sentence says eight rows"
    )

    const runbook = read(FLEET, 'RUNBOOK.md')
    const phrase = countLines(runbook, /rendered setup script/i)
    assert.ok(
      phrase > 0,
      '(d) [M4] fleet/RUNBOOK.md keeps its "rendered setup script" line — the one render this task leaves'
    )
    assert.equal(
      countLines(skillText, /render/i), 0,
      '(d) [M4] SKILL.md names no render at all'
    )
    assert.equal(
      countLines(skillText, /render/i) + countLines(runbook, /render/i), phrase,
      '(d) [M4] and the only case-insensitive render across SKILL.md and RUNBOOK.md is that phrase'
    )

    const policy = runbook.split(/\n\s*\n/).filter((para) => para.includes('is the grant'))
    assert.equal(policy.length, 1, "(d) [M4] fleet/RUNBOOK.md carries one policy sentence — the one naming the grant")
    assert.ok(
      policy[0].includes('claude-max'),
      '(d) [M4] the policy sentence names claude-max'
    )
    assert.ok(
      policy[0].includes("target's object"),
      "(d) [M4] and the target's object"
    )
    assert.equal(
      countLines(policy[0], /render/i), 0,
      `(d) [M4] and no renderer — it says ${JSON.stringify(policy[0].replace(/\s+/g, ' ').trim())}`
    )
  }

  // ── e. [M5] CONTRACT.md: eight table rows, and no renderer phrase left ────
  {
    const contract = read(FLEET, 'CONTRACT.md')

    const bullet = bulletLines(contract, '- **Doctor (', '- **')
    assert.ok(
      bullet.join(' ').includes('eight rows'),
      '(e) [M5] the doctor bullet of fleet/CONTRACT.md says eight rows'
    )
    const tableRows = bullet.filter((line) => line.startsWith('  | `'))
    assert.equal(
      tableRows.length, 8,
      `(e) [M5] and its table has eight rows, no render row — it has ${tableRows.length}`
    )

    assert.equal(
      countLines(contract, /render\.integration|rendering integration|rendering one|"render"/), 0,
      '(e) [M5] fleet/CONTRACT.md names no render.integration, rendering integration, rendering one or "render" key'
    )

    const config = bulletLines(contract, '- **Laptop config', '- **')
    for (const key of ['`cpu`', '`memory`', '`account`']) {
      assert.ok(
        config.join(' ').includes(key),
        `(e) [M5] the laptop-config bullet lists ${key}`
      )
    }
    const fences = config
      .map((line, i) => (/^\s*```/.test(line) ? i : -1))
      .filter((i) => i >= 0)
    assert.ok(fences.length >= 2, '(e) [M5] the laptop-config bullet carries a JSON example')
    const example = JSON.parse(config.slice(fences[0] + 1, fences[1]).join('\n'))
    assert.deepEqual(
      Object.keys(example).slice().sort(), ['account', 'cpu', 'memory'],
      '(e) [M5] whose JSON example carries cpu, memory and account only — no render key'
    )
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('ALL TESTS PASSED')
