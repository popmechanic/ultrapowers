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
