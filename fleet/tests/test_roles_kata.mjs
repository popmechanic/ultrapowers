/**
 * fleet/tests/test_roles_kata.mjs — the four moves a worker owns, taught by the
 * three role files a worker is dispatched with (#810 Phase A).
 *
 * A sibling of `fleet/tests/test_roles_peer.mjs`, which holds the roles
 * directory's register (#496, #556) and is not edited here: this file reads the
 * same files the same way — plain text off disk, no process of its own — and
 * asks the one new question, whether a worker that reads its role knows to
 * leave its notes on the issue, to raise its hand when stuck, to mark work it
 * could not finish for review, and never to close anything.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  each of `fleet/roles/implementer.md`, `fleet/roles/fix.md` and
 *       `fleet/roles/examiner.md` contains a section headed `## The issue`
 *       that names, each in a fenced or backticked command using the literal
 *       `$KATA_REF`: `kata comment $KATA_REF --body`,
 *       `kata meta set $KATA_REF work.attention stuck`,
 *       `kata meta set $KATA_REF work.attention needs-human`,
 *       `kata meta set $KATA_REF work.attention_msg` and
 *       `kata label add $KATA_REF needs-review`.
 *   M2  the same section says the worker never runs `kata close`, and that a
 *       missing `KATA_REF` means no kata at all — every command is skipped and
 *       nothing else changes.
 *   M3  no line of the three files is an all-caps imperative (no line matches
 *       `^[A-Z][A-Z ,.'!-]{11,}$`), and the three files together grow by at
 *       most 900 words.
 *
 * Legs: (a) M1, the five literals, one assertion per file per literal, so a
 * file missing any one fails — with the fenced-or-backticked form M1 also
 * asks for; (b) M2, `never` within six words of `kata close`, and `KATA_REF`
 * named as the condition under which the commands are skipped; (c) M3, the
 * all-caps sweep and the growth cap.
 *
 * Leg (c)'s cap is a delta against BASE, and a committed sim never reads BASE:
 * the `Run:` line in the task's Proof takes the difference with
 * `git show $ULTRA_BASE:<path>`. Held here as the same cap in absolute form —
 * BASE_WORDS below is `cat fleet/roles/implementer.md fleet/roles/fix.md
 * fleet/roles/examiner.md | wc -w` at
 * f262d60f4d0575aa94acc31ad42705333fa04419 — so a sim run on its own still
 * fails a file that blows the budget.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROLES = path.resolve(HERE, '..', 'roles')

/** The three role files, in the order the Proof's `Run:` line cats them. */
const ROLE_FILES = ['implementer.md', 'fix.md', 'examiner.md']

/** The five commands M1 asks each section to name, verbatim. */
const COMMANDS = [
  'kata comment $KATA_REF --body',
  'kata meta set $KATA_REF work.attention stuck',
  'kata meta set $KATA_REF work.attention needs-human',
  'kata meta set $KATA_REF work.attention_msg',
  'kata label add $KATA_REF needs-review',
]

/** `cat` of the three files at BASE, by `wc -w`. Leg (c)'s cap is +900 on it. */
const BASE_WORDS = 1485
const GROWTH_CAP = 900

/** The shout M3 forbids — the #496 pin, spelled as the task spells it. */
const SHOUT_RE = /^[A-Z][A-Z ,.'!-]{11,}$/

const read = (name) => fs.readFileSync(path.join(ROLES, name), 'utf8')

// ── the section ──────────────────────────────────────────────────────────────

/** The heading M1 names, and the heading that ends its section. `###` is not
 *  one: after `##` comes a `#`, not a space. */
const HEADING_RE = /^##\s+The issue\s*$/
const NEXT_HEADING_RE = /^##(\s|$)/

/**
 * The text from the line `## The issue` to the next `## ` heading, or the end
 * of the file. `count` is how many such headings the file carries, so a file
 * with none reports that rather than an empty string that passes nothing.
 */
const sectionOf = (text) => {
  const lines = text.split('\n')
  const starts = []
  lines.forEach((line, i) => { if (HEADING_RE.test(line)) starts.push(i) })
  if (starts.length === 0) return { count: 0, text: '' }
  const from = starts[0]
  let to = lines.length
  for (let i = from + 1; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i])) { to = i; break }
  }
  return { count: starts.length, text: lines.slice(from, to).join('\n') }
}

/**
 * Which characters of a section sit inside a command rather than inside prose:
 * every character of a ```-fenced block, and every character between a pair of
 * inline backticks. The backticks and the fence lines themselves are not code.
 * Lengths are preserved, so an index into the section is an index into this.
 */
const codeMask = (section) => {
  const mask = new Array(section.length).fill(false)
  let at = 0
  let fenced = false
  for (const line of section.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
    } else if (fenced) {
      for (let i = 0; i < line.length; i++) mask[at + i] = true
    } else {
      let inSpan = false
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '`') { inSpan = !inSpan; continue }
        if (inSpan) mask[at + i] = true
      }
    }
    at += line.length + 1
  }
  return mask
}

/** Every index at which `needle` occurs in `haystack`. */
const occurrencesOf = (haystack, needle) => {
  const out = []
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    out.push(at)
    at = haystack.indexOf(needle, at + 1)
  }
  return out
}

const wholeSpanIsCode = (mask, start, end) => {
  for (let i = start; i < end; i++) if (!mask[i]) return false
  return true
}

// ── words ────────────────────────────────────────────────────────────────────

/**
 * The section as words, each stripped of the punctuation and backticks that
 * hang off it, so `` `kata `` is `kata`, ``close`.`` is `close` and `never.` is
 * `never`. What is inside a word — the `.` of `work.attention`, the `$` of
 * `$KATA_REF` — is kept.
 */
const wordsOf = (text) => text.split(/\s+/).filter(Boolean)
  .map((w) => w.replace(/^[^A-Za-z0-9$_]+/, '').replace(/[^A-Za-z0-9$_]+$/, ''))
  .filter(Boolean)

/** `wc -w`: whitespace-separated runs, counted over the text as `cat` joins it. */
const wordCount = (text) => (text.match(/\S+/g) || []).length

/** The starts of every `kata close` in a word list. */
const kataCloseAt = (words) => {
  const out = []
  for (let i = 0; i + 1 < words.length; i++) {
    if (words[i].toLowerCase() === 'kata' && words[i + 1].toLowerCase() === 'close') out.push(i)
  }
  return out
}

/** Is any word in `[from, to]` accepted by `pred`? */
const anyWordIn = (words, from, to, pred) => {
  for (let i = Math.max(0, from); i <= Math.min(words.length - 1, to); i++) {
    if (pred(words[i])) return true
  }
  return false
}

const IS_NEVER = (w) => w.toLowerCase() === 'never'
const IS_SKIP = (w) => /^skip(s|ped|ping)?$/i.test(w)
const IS_ABSENCE = (w) => /^(missing|unset|absent|empty|without|no|none|lacks|lacking|not)$/i.test(w)

// ── the harness ──────────────────────────────────────────────────────────────

const tests = []
const test = (name, fn) => { tests.push([name, fn]) }

/** One read per file, so every leg asks its question of the same text. */
const TEXTS = new Map()
const SECTIONS = new Map()
for (const name of ROLE_FILES) {
  const exists = fs.existsSync(path.join(ROLES, name))
  const text = exists ? read(name) : null
  TEXTS.set(name, text)
  SECTIONS.set(name, text === null ? { count: 0, text: '' } : sectionOf(text))
}

/** The section a leg grades, or a failure naming what is missing instead. */
const sectionOrFail = (name, leg, clause) => {
  assert.ok(TEXTS.get(name) !== null,
    `${leg} [${clause}] fleet/roles/${name} is one of the three role files this exam grades, and it is not there`)
  const section = SECTIONS.get(name)
  assert.equal(section.count, 1,
    `${leg} [${clause}] fleet/roles/${name} carries exactly one section headed \`## The issue\` — ` +
    `found ${section.count}`)
  return section.text
}

// ── (a) the five commands, one assertion per file per literal  [M1] ──────────

for (const name of ROLE_FILES) {
  for (const command of COMMANDS) {
    test(`${name}: its "## The issue" section names \`${command}\`  [M1 / leg (a)]`, () => {
      const section = sectionOrFail(name, '(a)', 'M1')
      assert.ok(section.includes(command),
        `(a) [M1] the text from \`## The issue\` to the next \`## \` heading in fleet/roles/${name} ` +
        `names \`${command}\` verbatim — a worker that reads this role learns the command from it. ` +
        `Section read (${wordCount(section)} words): ${JSON.stringify(section.slice(0, 400))}`)
    })
  }
}

for (const name of ROLE_FILES) {
  test(`${name}: each of the five commands is fenced or backticked  [M1 / leg (a)]`, () => {
    const section = sectionOrFail(name, '(a)', 'M1')
    const mask = codeMask(section)
    for (const command of COMMANDS) {
      const spans = occurrencesOf(section, command)
      assert.ok(spans.length > 0,
        `(a) [M1] fleet/roles/${name} names \`${command}\` in its \`## The issue\` section`)
      assert.ok(spans.some((at) => wholeSpanIsCode(mask, at, at + command.length)),
        `(a) [M1] and names it as a command — inside a \`\`\`-fenced block or between backticks, ` +
        `not as bare prose: ${JSON.stringify(command)} in fleet/roles/${name}`)
    }
  })
}

for (const name of ROLE_FILES) {
  test(`${name}: every taught kata command uses the literal $KATA_REF  [M1 / leg (a)]`, () => {
    const section = sectionOrFail(name, '(a)', 'M1')
    for (const command of COMMANDS) {
      assert.ok(command.includes('$KATA_REF') && section.includes(command),
        `(a) [M1] fleet/roles/${name} spells \`${command}\` with the literal $KATA_REF the driver sets, ` +
        'never an issue id of its own')
    }
  })
}

// ── (b) never close, and no KATA_REF means no kata  [M2] ─────────────────────

for (const name of ROLE_FILES) {
  test(`${name}: "never" sits within six words of \`kata close\`  [M2 / leg (b)]`, () => {
    const section = sectionOrFail(name, '(b)', 'M2')
    const words = wordsOf(section)
    const sites = kataCloseAt(words)
    assert.ok(sites.length > 0,
      `(b) [M2] the \`## The issue\` section of fleet/roles/${name} names \`kata close\` — the one ` +
      'kata command a worker does not run, said so it can be recognised. ' +
      `Section read: ${JSON.stringify(section.slice(0, 400))}`)
    const held = sites.some((i) =>
      anyWordIn(words, i - 6, i - 1, IS_NEVER) || anyWordIn(words, i + 2, i + 7, IS_NEVER))
    assert.ok(held,
      `(b) [M2] and says the worker never runs it: no \`never\` within six words of \`kata close\` ` +
      `in fleet/roles/${name}. Words around it: ` +
      JSON.stringify(sites.map((i) => words.slice(Math.max(0, i - 6), i + 8).join(' '))))
  })
}

for (const name of ROLE_FILES) {
  test(`${name}: a missing KATA_REF is the condition that skips the commands  [M2 / leg (b)]`, () => {
    const section = sectionOrFail(name, '(b)', 'M2')
    const words = wordsOf(section)
    const refs = []
    words.forEach((w, i) => { if (/KATA_REF/.test(w)) refs.push(i) })
    assert.ok(refs.length > 0,
      `(b) [M2] the \`## The issue\` section of fleet/roles/${name} names KATA_REF`)
    const named = refs.some((i) =>
      anyWordIn(words, i - 12, i + 12, IS_ABSENCE) && anyWordIn(words, i - 25, i + 25, IS_SKIP))
    assert.ok(named,
      `(b) [M2] and names a missing KATA_REF as the condition under which every command above is ` +
      'skipped and nothing else changes — no mention of KATA_REF in fleet/roles/' + name + ' sits ' +
      'near both an absence word (missing, unset, absent, empty, without, no, none) and a form of ' +
      `skip. Section read: ${JSON.stringify(section.slice(0, 600))}`)
  })
}

// ── (c) the register and the budget  [M3] ────────────────────────────────────

for (const name of ROLE_FILES) {
  test(`${name}: no line is an all-caps imperative  [M3 / leg (c)]`, () => {
    const text = TEXTS.get(name)
    assert.ok(text !== null, `(c) [M3] fleet/roles/${name} is one of the three files this exam grades`)
    const shouts = text.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => SHOUT_RE.test(line))
      .map(([n, line]) => `${name}:${n}: ${JSON.stringify(line)}`)
    assert.deepEqual(shouts, [],
      `(c) [M3] no line of fleet/roles/${name} matches ${SHOUT_RE} — the roles stay in their ` +
      `register, and a rule that needs shouting belongs in code (#496): ${JSON.stringify(shouts)}`)
  })
}

test('the three files together grow by at most 900 words  [M3 / leg (c)]', () => {
  const parts = ROLE_FILES.map((name) => {
    assert.ok(TEXTS.get(name) !== null, `(c) [M3] fleet/roles/${name} is there to be counted`)
    return TEXTS.get(name)
  })
  const total = wordCount(parts.join(''))
  const grown = total - BASE_WORDS
  assert.ok(grown <= GROWTH_CAP,
    `(c) [M3] the three files together grow by at most ${GROWTH_CAP} words: ` +
    `${ROLE_FILES.join(' + ')} is ${total} words against ${BASE_WORDS} at BASE, ` +
    `a growth of ${grown}. Per file: ` +
    JSON.stringify(Object.fromEntries(ROLE_FILES.map((n, i) => [n, wordCount(parts[i])]))))
})

// ── the sentinel ─────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`ok — ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL — ${name}`)
    console.log(String(error && error.message ? error.message : error))
  }
}
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
