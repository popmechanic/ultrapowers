// fleet/failing-block.mjs — the failing test's own block, cut out of a red
// suite's output (#763 part 2, on #739's ground).
//
// A red suite's output is read twice: once by the record, which keeps all of it
// (`publish-fold/suite-<attempt>.txt`), and once by a reader — a judgment call,
// a brief, a wave detail, a pull-request body — who wants the failure. A fixed tail is the wrong cut for the second reader: the
// interesting lines are wherever the failing test printed them, and a tail of N
// characters keeps the summary and drops the assertion whenever the block runs
// long. So the excerpt is a BLOCK: it begins at the failing test's own first
// failure line and stops where that test's block stops. Nothing is dropped from
// the record; only the quotation is narrowed.
//
// The cut is line-based and shape-agnostic on purpose. Three shapes reach it,
// measured 2026-09-08 on this machine:
//
//   pytest    a preamble, `=== FAILURES ===`, `___ test_fleet_mjs[test_red.mjs] ___`,
//             a `[gw1]` line, the source excerpt, the `E   …` lines (which is
//             where a bridged sim's own AssertionError sits), then
//             `=== short test summary info ===`, `FAILED …` and `1 failed, …`
//   TAP       `ok 1 - …`, `not ok 2 - …`, an indented YAML diagnostic closed by
//             `  ...`, then `ok 3 - …` or a `# fail 1` summary
//   bare node the sim's own lines, Node's internal frames, then
//             `AssertionError [ERR_ASSERTION]: …`, the diff, the stack and
//             `Node.js v24.16.0`
//
// One marker rule covers all three, and it is the ONE literal this module
// shares with the awk cut in `fleet/sandbox-boot.sh` — the two must agree line
// for line, so they are written to the same two patterns:
//
//   start  the first line that opens a failure
//   end    the line before the first LATER line that opens the next thing
//          (another test's header, a pytest rule line, another TAP result), or
//          the last line of the text when nothing later matches
//
// A text with no start line is not a failure this rule can find, so it is
// returned WHOLE rather than guessed at — a green summary, a bare exit code and
// the empty string all come back byte for byte.
//
// There is no length argument and no default cap. The block's size is whatever
// the failing test printed, and the whole output is on the record beside it.

/** The first line of a failing test's block. */
export const START = /^(_{3,} .+ _{3,}$|FAILED |FAIL[: ]|not ok |AssertionError)/

/** The first line AFTER a failing test's block; the block ends on the line before it. */
export const END = /^(_{3,} .+ _{3,}$|={3,} |(not )?ok \d)/

/**
 * The failing test's own block, quoted out of a red suite's output.
 *
 *   text  a suite's stdout+stderr, whatever shape printed it
 *
 * Returns the lines from the first START line through the line before the first
 * later END line — or through the last line when no later line ends it — joined
 * with `\n`. When no line matches START the text is returned unchanged.
 */
export function failingBlock (text) {
  const source = String(text ?? '')
  const lines = source.split('\n')

  const start = lines.findIndex((line) => START.test(line))
  if (start === -1) return source

  let end = lines.length - 1
  for (let i = start + 1; i < lines.length; i++) {
    if (END.test(lines[i])) { end = i - 1; break }
  }

  return lines.slice(start, end + 1).join('\n')
}

export default failingBlock
