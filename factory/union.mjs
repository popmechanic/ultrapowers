// factory/union.mjs — the kernel's own union rule, read off its hunks-file
// text: every `added` segment's lines, in order, and any `deleted` segment
// disqualifies the whole file.
//
// `factory/engine.mjs` is the one caller: it reads a conflict's `hunksFile`,
// hands the text here, and — only when this answers non-`null` and the
// judge's `readUnion` agrees — writes the union straight to the reply
// directory instead of dispatching a resolver.
//
// Pure string work, no import beyond the language, exactly like
// `factory/hunks.mjs` beside it.

/** One block's `id` and every line between its `--- conflict` marker and its
 *  `>>>>>>> end conflict` marker, split into segments by the kernel's own
 *  segment headers: `<<<<<<< begin <kind> <side>` opens the first, `=======
 *  begin <kind> <side>` opens every one after. */
function blocksOf (text) {
  const lines = String(text).split('\n')
  const blocks = []
  let current = null
  for (const line of lines) {
    const m = /^HUNK (\S+)/.exec(line)
    if (m) {
      current = { id: m[1], lines: [] }
      blocks.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return blocks
}

const SEGMENT_HEADER_RE = /^(?:<<<<<<<|=======) begin (added|deleted) (\S+)/

/** M1: `unionReply(hunksText)` — `{ hunks: [{ id, content }] }`, one entry
 *  per `HUNK <id> …` block, `content` being every `added` segment's lines of
 *  that block's conflict, in order, newline-joined. `null` when the text
 *  holds no block, or any segment of any block is `deleted`. */
export function unionReply (hunksText) {
  const blocks = blocksOf(hunksText)
  if (!blocks.length) return null

  const hunks = []
  for (const block of blocks) {
    const conflictAt = block.lines.findIndex((l) => l === '--- conflict')
    if (conflictAt === -1) return null

    const segments = []
    let segment = null
    for (let i = conflictAt + 1; i < block.lines.length; i += 1) {
      const line = block.lines[i]
      if (line === '>>>>>>> end conflict') break
      const header = SEGMENT_HEADER_RE.exec(line)
      if (header) {
        segment = { kind: header[1], lines: [] }
        segments.push(segment)
        continue
      }
      if (segment) segment.lines.push(line)
    }
    if (!segments.length) return null
    if (segments.some((s) => s.kind === 'deleted')) return null

    const content = segments
      .filter((s) => s.kind === 'added')
      .flatMap((s) => s.lines)
      .join('\n')
    hunks.push({ id: block.id, content })
  }
  return { hunks }
}

export default { unionReply }
