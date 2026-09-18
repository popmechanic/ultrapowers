// factory/hunks.mjs — what Jev is shown of an oversized patch: the hunks that
// carry a clause's own words, ahead of whichever file happened to sort first.
//
// Pure string work, no import beyond the language — `factory/engine.mjs`'s
// `measure` is the one caller, in place of the naive `text.slice(0, cap)` it
// used before.

/** M1: every backticked span of `clauses`' texts that is at least 3
 *  characters long, verbatim, in order and deduplicated (first occurrence
 *  wins the position; a later repeat is dropped, not re-appended). */
export function literalsOf (clauses) {
  const out = []
  const seen = new Set()
  for (const clause of (clauses || [])) {
    const re = /`([^`]*)`/g
    let m
    while ((m = re.exec(String(clause)))) {
      const s = m[1]
      if (s.length >= 3 && !seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  return out
}

/** `diffText` split into file sections: each begins at a line starting
 *  `diff --git `, or — for text that opens with no such line (a per-file
 *  diff already stripped of its `diff --git` line, e.g. `splitDiff`'s own
 *  output) — at the start of the text itself. Answers the section texts, in
 *  order, covering `diffText` exactly (no gaps, no overlaps). */
function splitSections (diffText) {
  const src = String(diffText || '')
  const starts = []
  const re = /^diff --git /gm
  let m
  while ((m = re.exec(src))) starts.push(m.index)
  const boundaries = (starts.length && starts[0] === 0) ? starts : [0, ...starts]
  return boundaries.map((start, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : src.length
    return src.slice(start, end)
  })
}

/** One section, split into its header (everything before the first line
 *  beginning `@@ `) and its hunks (each beginning at such a line, running to
 *  the next such line or the section's end). */
function splitHunks (sectionText) {
  const starts = []
  const re = /^@@ .*$/gm
  let m
  while ((m = re.exec(sectionText))) starts.push(m.index)
  const header = starts.length ? sectionText.slice(0, starts[0]) : sectionText
  const hunks = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] : sectionText.length
    return sectionText.slice(s, e)
  })
  return { header, hunks }
}

/** M2: `diffText`, kept to whole hunks under `cap` characters, the ones
 *  carrying one of `literals` promoted ahead of the rest. A text that
 *  already fits `cap` is answered unchanged, reordering and all. */
export function hunksCarrying (diffText, literals, cap) {
  const src = String(diffText || '')
  if (src.length <= cap) return src

  const lits = Array.isArray(literals) ? literals : []
  const hasLiteral = (text) => lits.some((lit) => lit && text.includes(lit))

  const sections = splitSections(src).map(splitHunks)
  const candidates = []
  sections.forEach((sec, sectionIdx) => {
    for (const text of sec.hunks) candidates.push({ sectionIdx, text })
  })

  const literalHunks = candidates.filter((c) => hasLiteral(c.text))
  const otherHunks = candidates.filter((c) => !hasLiteral(c.text))
  const ordered = literalHunks.concat(otherHunks)

  let out = ''
  const usedSections = new Set()
  for (let i = 0; i < ordered.length; i++) {
    const cand = ordered[i]
    const needsHeader = !usedSections.has(cand.sectionIdx)
    const piece = (needsHeader ? sections[cand.sectionIdx].header : '') + cand.text
    if (out.length + piece.length > cap) {
      const remaining = ordered.length - i
      return out + (out.endsWith('\n') ? '' : '\n') + `(${remaining} hunks omitted)`
    }
    out += piece
    usedSections.add(cand.sectionIdx)
  }
  return out
}
