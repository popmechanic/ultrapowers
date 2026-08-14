# Fold-native development methodologies — ideas note

**Status: IDEAS NOTE — not a spec, not a plan, nothing here is sanctioned for
building.** Recorded 2026-08-14 (mid-T14/T15 runbook, operator request) so the
thinking survives to the decision points where it becomes actionable. Per repo
doctrine, machinery is earned by recurrence: items here graduate only through
an ultralearn sense pass, a §5-style design conversation, or an operator
directive — never by citing this note alone.

**Provenance:** operator/session conversation during the frontier-mode
calibration campaign (T14 attempts 3–8, `evals/frontier/results/
2026-08-13-calibration-arm-a.md`). Written before the T15 A/B verdict; nothing
here assumes a PASS.

## The frame: methodology is downstream of merge cost

Every reduction in merge cost has produced a methodology that exploits it:
RCS-era locking → pessimistic file ownership; CVS/SVN optimistic merge →
drive-by open-source contribution; git's cheap branching → feature branches,
PRs, trunk-based development with flags. The fold kernel is the next step —
not "merge text cheaply" (git does that) but **merge concurrent intent
verifiably**: deterministic replay, narrated conflicts, a resolver in the
loop, sealed acceptance above it. The prediction: the coordination unit
shrinks again, and some methodology arises to exploit it. Candidates below,
ordered roughly evolutionary → novel.

## Candidate methodologies

### 1. Collision-welcome architecture (inverting interface-first design)
Interface-first design pays coordination cost up front so workers never share
files. With verified folding, shared *registration surfaces* (registries,
catalogs, route tables — declarative, additive, order-insensitive regions)
flip from liability to cheap coordination points. `evals/fixtures/
contend-prod`'s `registry.py` is unintentionally the pattern: N features, one
declarative surface, zero pre-coordination. Today's advice says avoid
god-files; this says build god-files whose regions commute.

### 2. Merge contracts / commutativity budgeting ← nearest actionable
Tasks declare merge semantics machine-readably: "my edits to this file are
order-insensitive registrations — collisions union" vs "this region is
exclusive." Plan review audits commutativity claims the way it audits test
contracts; the kernel verifies them at fold time; the resolver enforces
declared intent instead of inferring it. CRDT-type thinking lifted from data
structures to code regions. **This is the natural ultraplan extension: today's
markers say who depends on whom; these would say what commutes with what. If
T15 passes, raise as input to the §5 conversation (alongside settling
#143/#144).**

### 3. Behavior-sliced decomposition (replacing module-sliced)
The serialization rule forces partition-by-file-ownership; the
`authoring-cost-samefile` watch-item documented the contortions (fake
Depends-on edges, invented interface files, chains-for-fans). Without the
rule, the decomposition unit becomes the vertical behavior slice — each agent
owns an invariant end-to-end, files fall where they fall. Feature-teams vs
component-teams, resolved at agent granularity where feature-slicing was
previously too merge-expensive.

### 4. Exam-owned development (ownership by invariant, not by file)
The ultrapowers thesis at its limit: humans own the sealed acceptance
surfaces; agents contend freely underneath; fold + exam adjudicate. File
topology stops being a human concern. Loop: curate exams → fan out → fold →
grade. The T14 campaign is a preview — the one durable authority through six
fixture resizes was the seal (`4d131df61152`).

### 5. Stigmergic swarms (the descoped frontier vision, as methodology)
Coordination through the artifact, not through messages: agents commit
micro-deltas continuously, the frontier folds continuously, conflicts surface
as narrated events *while work proceeds*, review shifts from "read the PR" to
"monitor the narration stream." Branches stop being social objects and become
physics. Suits agents specifically: bad at coordination-by-chatter, good at
fresh-context bursts coordinated by merge. This is the event-driven design
deliberately shelved in favor of waves; waves are the disciplined
stepping-stone.

### 6. Tournament development
Verified same-file merging makes redundancy cheap: run K attempts at one
task, fold-diff deterministically, judge-panel the winner, graft best
fragments. "Assign-and-review" → "generate-and-select." Deterministic replay
is what keeps the comparison honest.

## The counterweight (from our own data)

T14 attempt 4's gate critic: rate-limit rejections are never audited, because
`DISPATCH_HOOKS` append order is an **emergent, merge-order-dependent
interaction between two individually-correct tasks** that no task's own tests
could pin. Folding merges *text* verifiably; composed *behavior* can still be
order-sensitive. Every methodology above therefore needs a composition layer
— cross-task invariant exams, emergent-behavior probes, human-curated seals.
The frontier isn't "can agents share files" (T15 answers that); it's **who
writes the contracts for what their combined work must mean.**

## Prediction signals (from the same conversation)

Contention is predicted by shared-surface topology, not plan length:
sibling-feature fan-out × registration-hub presence. Mechanical at plan time
(compile and count dropped write-after-write pairs); at spec time, proxy via
git co-change "hot files" (rank by touch count; flag specs adding ≥2 siblings
to a subsystem with a top-decile hub). The corpus understates latent
contention because current authoring rules define it away (2/69 binding, both
pre-ultraplan; watch-item contortion evidence).

## Disposition

- **Now:** nothing. This note exists to be findable.
- **On T15 PASS:** item 2 becomes §5-conversation input.
- **Ongoing:** items 3/5 are ultralearn sensing targets (watch for natural
  behavior-slicing pressure and coordination-by-merge patterns in real runs),
  not designs to build on speculation.
