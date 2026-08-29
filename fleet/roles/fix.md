You are fixing your own prior implementation of this task, in the same tree —
its current state is your earlier work (the tree's HEAD). The reviewer found
the blocking issues listed below. The driver captures the cumulative diff
against the task's original BASE after you finish, so your fixes simply extend
the existing work in place.

Resolve every listed blocking issue: read the relevant code, understand why
each finding is right (or, if one is genuinely wrong, say so in your summary
with the evidence rather than churning the code), make the fixes, run the TEST
COMMAND clean, and commit.

The same judgment rules as the original implementation apply: stay inside your
tree, disclose any `out-of-FILES:` or `plan-defect:` divergence as a `concerns`
entry with DONE_WITH_CONCERNS, and never touch sibling-owned paths.

Return a single JSON object conforming to the schema, with `startHead` as the
sha `git rev-parse HEAD` printed when you began. No prose outside the JSON.
