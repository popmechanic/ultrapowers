# Finishing notes (orchestrator-read; carried into the post-merge runbook)

## Merge method — recommend squash up front

The engine accumulates a per-wave merge commit per wave plus reconciliation
commits, so the integration branch is rich in merge commits and is often
un-rebaseable. Before recommending a merge style, detect the target repo's
allowed methods:

```bash
gh api repos/{owner}/{repo} --jq '.allow_squash_merge,.allow_merge_commit,.allow_rebase_merge'
```

If merge commits are forbidden (rebase-only) or the branch has many merge
commits, recommend **squash** in the finishing handoff so the operator is not
forced to discover it at the disabled merge button ([b117ab5d53e5b96a]).

This check is the `allow_squash_merge` / rebase detection step: when
`allow_rebase_merge` is true but `allow_squash_merge` and `allow_merge_commit`
are false, squash is not available — surface this before the merge attempt so the
operator chooses a compatible merge method.

## Deploy scope — warn when the base is far ahead of the deploy target

A small approved fix can sit on a long-lived feature branch; a "pull the default
branch on prod" deploy would ship the whole branch. Before the release ritual,
compare the integration base to the deploy target:

```bash
git rev-list --count <deploy-target>..<base>
```

If the base is far ahead (dozens of commits), warn that finishing this branch
deploys far more than the reviewed change ([64016ca13dd763a4]).

## Cross-phase integration review — one holistic critic before the final PR

Per-task and per-wave reviews (and per-phase reviews, in a multi-run pipeline)
certify *local* correctness only; none of them evaluates the fully-integrated
tree across phases against the *combined* plan. That is a structural blind spot:
six green per-phase sealed gates once still let ~21 cross-phase integration bugs
through — including a crash — because every gate was judging its own slice, not
the whole.

For a multi-phase or multi-run pipeline, before opening the final PR, run one
**holistic cross-phase review**: the completeness-critic role over the
fully-integrated tree, evaluated against the *combined* plan (not any single
phase's slice), gated before the PR. Findings that span phase seams — a caller
left dangling by another phase's rename, duplicated or diverging state, behavior
that only breaks once every phase is present — are exactly what this review
exists to catch, and they land in the report's `completenessFindings` alongside
the single-run critic's (see `references/report-format.md`).

This is a new *invocation* of the existing completeness-critic role at the
finishing handoff, not a new harness or subsystem; a single-run pipeline already
receives this review over its own integrated tree, so scope the extra pass to
work that actually spanned multiple phases or runs. Do not hand off to
`finishing-a-development-branch` until the holistic review is clean or its
findings are explicitly dispositioned.

## Deferred-verification checklist

The gate report's `deferredVerification` array is a post-merge obligation
list, not a footnote. After the merge lands, walk it item by item: attempt
closure where tooling exists (run the runtime path, drive the browser flow,
hit the deployed service), and report per-item status in the finishing
summary — `closed` (verified, say how), `still-open` (say what blocks it),
or `needs-human` (say exactly what the operator must do). The checklist
authorizes no new autonomous actions — anything beyond already-authorized
tooling stays `needs-human`. An item nobody closes survives in the summary
by name; it must never silently evaporate between the gate and the handoff.
