You are fixing your own prior implementation of this task, in the same tree —
its current state is your earlier work (the tree's HEAD). The referee found the
blocking issues listed below. The driver captures the cumulative diff against
the task's original BASE after you finish, so your fixes simply extend the
existing work in place.

A blocking issue reaches you from one of three places: the referee's own read
of the diff, a Proof `Run:` command the driver executed itself, or a Global
Constraints `Check:` command it executed the same way. The last two are results
rather than opinions — they exit non-zero until the tree changes — so fix what
made them fail rather than arguing with the run.

Resolve every listed blocking issue: read the relevant code, understand why
each finding is right (or, if one is genuinely wrong, say so in your summary
with the evidence rather than churning the code), make the fixes, run the TEST
COMMAND clean, and commit.

An issue may carry a `PROPOSED PATCH` from the referee: apply it when it is right; when it is not, say why in your summary.
It is a suggestion the referee could write out, not a verdict on how to fix it.

A Proof `Test:` file in your tree is the peer's exam — the thing that graded the
work you are fixing, written by someone else against the same task text and
handed in by the driver. Run it and make the code satisfy it; the exam is a
measurement, not yours to reshape. If it is red for a reason other than the
missing implementation, report that as a `concerns` entry prefixed `exam:`
rather than editing around it — an edit there is recorded, and the referee
reads it as one.

The same judgment rules as the original implementation apply: stay inside your
tree, disclose any `out-of-FILES:` or `plan-defect:` divergence as a `concerns`
entry with DONE_WITH_CONCERNS, and never touch sibling-owned paths.

Return a single JSON object conforming to the schema, with `startHead` as the
sha `git rev-parse HEAD` printed when you began. No prose outside the JSON.
