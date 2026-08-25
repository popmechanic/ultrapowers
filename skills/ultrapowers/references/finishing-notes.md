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

## Post-approve ordering — merged suite before push, never `merge && push`

Gate-verified green does not survive environment-stateful tests: a suite that
mutates real user/machine state (a home-dir cache, wall-clock-sensitive
fixtures) can flip verdicts on an identical tree, so the suite can go red on
the exact SHA the gate verified ([54172dee1b7f9d70]). Two rules at finishing:

1. After the merge lands locally, **run the suite on the merged tree before
   pushing** — the push is the irreversible step, so the last verification
   belongs immediately before it.
2. **Never chain the merge and the push in one command** (`git merge … &&
   git push`). Chaining forfeits the stop point: a red post-merge suite is
   only actionable if nothing has been published yet.

If the post-merge suite goes red on a gate-verified SHA, suspect environment-
stateful tests before suspecting the merge.

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

## Residual manifest

The gate report's three finding families — `completenessFindings`,
`judgmentCalls`, `deferredVerification` — feed one derived obligation list
at finishing: the residual manifest. Derivation and disposition are
required at run close and at drain-entry close; the finishing summary
attaches the manifest. Derive it from **all** of this run's gate reports —
the composers snapshot each round's `report.json` to `report-<n>.json`, so
`--run-dir` unions every round plus the live report; the union is computed,
never remembered:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/residual_manifest.py \
  --run-dir <runDir> [--gate-acks <runDir>/standing-approval.json] \
  > <runDir>/residual-manifest.md
```

Canonical location: `<runDir>/residual-manifest.md`, beside report.json.
One row per distinct finding, content-addressed — id
`<family>-<12-hex sha256 of the normalized text>`, so the same finding gets
the same id in every round and the union dedupes on id; byte-identical
duplicates within one report tiebreak `-2`, `-3`, … Each row is exactly:

```
- <id> [<family>] <text> — disposition: <value>
```

Anything else in the file is commentary. With `--gate-acks`,
`deferredVerification` rows carrying a recorded gate ack are emitted
pre-dispositioned `acked` — derivation from a durable record, never
auto-judgment. Every other row derives with an empty disposition slot for
the orchestrator or operator to fill with one of:

- `fixed` or `fixed:<annotation>` — verified closed; say how in the
  annotation (the PR/commit where the fix landed) or the row text.
- `acked` or `acked:<annotation>` — operator acknowledged; the required
  action is named in the row text or the annotation. Anything beyond
  already-authorized tooling lands here — the manifest authorizes no new
  autonomous actions.
- `filed:<ref>` or `filed:<ref> <note>` — stays open under a tracking
  reference (a free-text note may follow the ref).
- `waived:<reason>` — stays open with the reason stated.

After a PASS verdict the default for every advisory row is `filed:<ref>`
(SKILL.md Step 5, **After PASS: file, batch, price**); `fixed` is earned by
the one batched redirect round, never by a round per row.

(Supersedes the old per-item `closed | still-open | needs-human` triple:
`closed → fixed`; `still-open → filed:<ref>` or `waived:<reason>` — staying
open with neither a ref nor a reason is exactly the evaporation this
manifest exists to kill; `needs-human → acked`.)

The close check — exit-code authority for the close ceremony, touching no
frozen gate script:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/residual_manifest.py \
  --check <runDir>/residual-manifest.md
```

Exit 0 iff every row is dispositioned (a zero-row manifest passes,
vacuously); exit 2 names the undispositioned rows. Resume gates derive and
render the union only — `--check` runs solely at run close and drain-entry
close.

## Shipped SHA ≠ gate-verified SHA — re-verify, mandatorily

The gate's verdict attaches to one exact tree. If the SHA being shipped
differs from the SHA the gate verified — any rebase, squash, or history
rebuild after the gate — re-run the full committed suite AND the plan's
acceptance per its disposition (the sealed exam for `sealed` plans, the
suite gate for `suite`) on the rebuilt tree before opening the PR. This is
mandatory, not judgment: a rebuild can absorb real base drift, and the old
verdict says nothing about the new tree ([15f51ca2]).

A rebase-only repo defeats the recommend-squash guidance above — the
history rebuild is the expected path there, so this re-verification is the
norm in such repos, not the exception.
