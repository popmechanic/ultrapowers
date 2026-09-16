// fleet/facts-block.mjs — the matcher over a run's receipts, and the FACTS
// block a judge's brief carries (the operator's brief of 2026-09-16, on map
// #810's reading and #1035's bound).
//
// A run's record already holds what the driver observed: an exam that ran red,
// a resolver that replied, a wave that blocked, a fold that landed, a finding
// raised and a finding refuted. A judge reading a brief had none of it, and so
// judged the same file twice from two different states of the world. This
// module is the one query that closes that: given the rows a run appended and
// the files a brief is about, it picks the receipts on those files and renders
// them.
//
// A MATCHER IS A QUERY, NOT A JUDGMENT. Nothing here decides what a row means,
// what a judge should do about it, or whether a finding stands. A row is picked
// by its kind and its paths, and rendered by its own two strings. The header
// sentence is the only sentence this module writes, and it says what the block
// is — a reading, never an instruction (#1037's third constraint).
//
// The module is PURE and reads nothing but the one file `receiptRows` is
// handed. That is what keeps the two callers run-scoped by construction: the
// engine hands `factsBlock` its own in-memory receipts, the rows it appended
// this run, and the publish fold hands it `receiptRows(<runDir>/events.jsonl)`,
// the file its own `makeEventLog` appends to. Neither reaches a tag, a hub
// issue or another run's directory, because there is no code here that could.
//
// It imports nothing from `fleet/run-engine.mjs` on purpose — the publish fold
// runs in its own process, and an import would pull the whole engine into it a
// second time. The shape is `fleet/failing-block.mjs`'s and
// `fleet/publish-fold-block.mjs`'s: one file, named exports, no state.
//
// THE RECEIPT SHAPE, the literal every task of this plan agrees on:
//
//   paths     repo-relative path strings, sorted, de-duplicated, never empty
//   evidence  `{ read, against }`, two strings, each at most 500 characters,
//             a longer one cut to 499 characters plus `…`
//
// A row carrying both keys is a receipt. `RECEIPT_KINDS` is the closed list of
// kinds that may carry one: a row of any other kind is not a receipt however
// well-formed the rest of it looks, which is what keeps an ordinary
// `engine:log` line out of a brief.
//
// The match is EXACT STRING EQUALITY on paths — no globs, no prefixes, no
// normalisation — so `a.txt` never matches `dir/a.txt`. A brief is about the
// files its task names, and a prefix rule would quietly widen that to a tree.
//
// The block is BOUNDED, which is #1035: at most `FACTS_MAX_ROWS` rows, each
// field at most `FACTS_FIELD_MAX` characters, so a block is under 24 KB however
// many failures a run recorded. When more rows match than the bound allows, the
// ones kept are the NEWEST — row ids are ULIDs (`makeEventLog` in
// `fleet/run-waves.mjs`, `ulid(ts)`), lexically ordered by time, so "greatest
// id" is newest and "ascending id" is append order.
//
// And a run with nothing to say says nothing: no matching row renders the empty
// string, not an empty header. A brief built over a run that recorded no
// failure is then byte-identical to the brief it was at BASE.

import fs from 'node:fs'

/** The only kinds that may carry a receipt. */
export const RECEIPT_KINDS = [
  'driver:exam-run',
  'resolver:reply',
  'driver:wave-blocked',
  'driver:publish-fold',
  'driver:finding',
  'driver:finding-refuted',
  'handshake:finding',
]

/** The most rows one block renders; the newest are the ones kept. */
export const FACTS_MAX_ROWS = 20

/** The most characters one `read` or `against` renders; a longer one is cut. */
export const FACTS_FIELD_MAX = 500

const KINDS = new Set(RECEIPT_KINDS)

const isStringArray = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')

/**
 * Is this row a receipt? Its kind is one of the seven, its `paths` a non-empty
 * array of strings, and its `evidence` an object whose two readings are both
 * strings. Nothing about the files of a brief is asked here.
 */
const isReceipt = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (!KINDS.has(row.kind)) return false
  if (!isStringArray(row.paths)) return false
  const evidence = row.evidence
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  return typeof evidence.read === 'string' && typeof evidence.against === 'string'
}

/** A row's id as the sort reads it — a row with no id sorts first. */
const idOf = (row) => (typeof row?.id === 'string' ? row.id : '')

/** One field, cut to the bound: a longer one is 499 characters plus `…`. */
const field = (text) => {
  const s = String(text ?? '')
  return s.length > FACTS_FIELD_MAX ? s.slice(0, FACTS_FIELD_MAX - 1) + '…' : s
}

/** The block's one sentence, over `n` rows. */
const header = (n) =>
  '\n\nFACTS: this run\'s record holds ' + n + ' receipt(s) on the files of this brief — ' +
  'what the driver observed, never what to do; a finding that rests on one names it as receipt <id>.'

/** One row's line. `verdict` is carried only when the row has one as a string. */
const rowLine = (row) =>
  '\n- receipt ' + idOf(row) + ' ' + row.kind + ' [' + row.paths.join(', ') + ']' +
  ' read: ' + field(row.evidence.read) +
  ' — against: ' + field(row.evidence.against) +
  (typeof row.verdict === 'string' ? ' — verdict: ' + row.verdict : '')

/**
 * The FACTS block for one brief.
 *
 *   rows   a run's own rows — the engine's in-memory receipts, or the ones
 *          `receiptRows` parsed out of this run's `events.jsonl`
 *   paths  the files the brief is about
 *
 * Returns the block: the header sentence, then one line per matching row in
 * ascending `id`, at most `FACTS_MAX_ROWS` of them and the newest when more
 * match. When no row matches the result is `''` — the empty string and not an
 * empty header, so a brief over a quiet run is unchanged byte for byte.
 */
export function factsBlock (rows, paths) {
  const wanted = new Set((Array.isArray(paths) ? paths : []).map((p) => String(p)))
  if (wanted.size === 0) return ''

  const matching = (Array.isArray(rows) ? rows : [])
    .filter((row) => isReceipt(row) && row.paths.some((p) => wanted.has(p)))
    .sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))

  const kept = matching.length > FACTS_MAX_ROWS ? matching.slice(-FACTS_MAX_ROWS) : matching
  if (kept.length === 0) return ''

  return header(kept.length) + kept.map(rowLine).join('')
}

/**
 * One `events.jsonl` file, parsed into its rows.
 *
 * Lines that are not JSON objects are skipped — a blank line, a half-written
 * last line, a bare number — and the objects come back in file order. A file
 * that does not exist is `[]`: the publish fold asks for a run directory's log
 * before anything has appended to it, and that is a run with nothing to say
 * rather than an error.
 *
 * This is the only path this module ever reads, and it is the one it was
 * handed.
 */
export function receiptRows (file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed)
  }
  return rows
}

export default factsBlock
