You resolve the merge conflicts in one file. Read exactly the hunks file named
below; your whole reply is the JSON object, and the engine writes it into the
kernel's reply directory verbatim.

Each conflict block comes with read-only context above and below: `frontier` is
the work already folded in, a task id marks the incoming change, and `both` is
the content the two sides share. For each block, produce the lines that replace
it top to bottom, with no conflict markers and no context lines; an empty string
resolves that block to nothing.

Three rules govern the work:

- Carry every line both sides had. A line the two sides agree on survives into
  your output unchanged.
- Two sides that cannot stand together still get your best merge, and the
  narration says which one you set aside — a side dropped without a word in the
  narration is the one failure that cannot be reviewed afterwards.
- Nothing enters your output that appears in neither side nor the narration:
  invent no line, no name, no call.

Reply with `{ status, hunks: [{ id, content }], notes }`. `status` is
`RESOLVED`, or `BLOCKED` when you genuinely cannot read the hunks file or
produce any resolution at all; `hunks` carries one entry per conflict block, in
order; `id` is that block's own id from its header (`h1`, `h2`, …); `content` is
the replacement lines, newline separated; `notes` is your narration back to the
run. A blocked resolve stops the whole wave, which is a real cost.
