# One Owned Authoring Skill — spec (#390, map #238)

**Date:** 2026-08-31 (amended same sitting — word caps to reported numbers, MIT
conditional, direct cutover replacing the staged A/B) · **Decided by:** the #239 closing
record (2026-09-01 grilling) + the operator decisions of this sitting (§1 — recorded on
#390 with this spec's commit). **Delivers:** the `ultrawrite` skill, the `claims-v1`
compiler mode, and the direct cutover — ultraplan and the writing-plans invocation
deleted in the same change.

> **Audience note.** The authoring agent writes every artifact below; the operator
> brainstorms, answers elicitation, and signs. #243 changed horizon, locus and signing
> boundary — never human→machine (#390 correction of record).

## 1. Decisions taken this sitting (operator, 2026-08-31)

1. **Contracts signed, edges derived.** The operator signs tasks and their contracts
   (Interfaces, Files). The compiler derives every edge from Interfaces token-matching
   plus Files overlap — machinery it already runs as a cross-check. `**Depends-on:**` is
   refused under `claims-v1`. Rationale: an operator who does not read diffs cannot
   verify an edge; #443 (54% decomposition shape) and #446 (a false edge is silent and
   permanent). This settles the shape-A/B question #390 posed, at the compile-once
   point (shape B's per-wave recompute stays open engine work, §11).
2. **`**Commutes:**` is dropped from the grammar.** Append-shapedness is visible in diff
   hunks at merge; the fold handles the general case, and the marker only optimizes
   union-vs-resolve. If fold metrics show the optimization missed (resolver-chain cost
   up), that is a measured case for the *engine* deriving it from diff shape — never for
   re-signing it.
3. **Filed-issue text counts as the elicited claim.** The skill quotes the operator's
   own words from the originating issue (verbatim, anchored); a live elicitation
   interview only when planning starts from a bare idea. (A deliberate relaxation of
   #239 decision 4's interview, so autonomous docket drains keep working; the signing
   boundary stays "the operator's own words.")
4. **Direct cutover — #239 decision 5 amended, knowingly.** The pre-registered A/B is
   dropped. Grounds: its instrument was too weak to bear its ceremony (n=1 per arm; the
   registration itself needed a tie rule conceding Δ≤1 is noise), and its question is
   near-settled by the 14-run corpus — the dominant plan-defect species (verbatim
   implementation code and steps) is exactly what the grammar makes unsayable. The real
   risks are operational (parks rise, token blowout, an over-strict gate) and are
   caught better by production canaries on every run than by one synthetic pairing.
   **The safety is the rollback, not the staging:** legacy grammar stays parseable
   forever, the engine is unchanged, legacy fixtures are pinned byte-identical, and
   ultraplan is one `git revert` away. This amendment is recorded on #239/#390 with the
   spec commit.
5. **Word ceilings become reported numbers** (this sitting's second amendment, aligning
   with #492's measured evidence — three observed harms, zero saves): the skill's size
   is reported by CI's existing prose-size step and by release commit bodies; the
   Context slot's word count is emitted as an `ADVISORY` and recorded in the plan
   record. **Nothing refuses on a word count.** The defense against Steps prose
   smuggled into Context is structural, not volumetric: fences refused outside Proof,
   ordering-phrases drawing advisories, review's eyes.
6. **First target: #489** (ultralearn fail-loud) — the first plan authored under the
   new grammar, mid-size, fleet-runnable, decoupled from the authoring machinery.

## 2. The skill: `ultrawrite`

One owned authoring skill at `skills/ultrawrite/`, replacing `ultraplan` **and** the
`superpowers:writing-plans` invocation for plan bodies (no override layer, no two
authorities — #239 decision 7). Properties:

- **Sized by coherence, reported not gated** (§1.5). Working estimate: relocated
  judgment ~800 (§7 Fate C) + slot semantics ~150 + elicitation flow ~150 + gate
  dispatch ~100 + execution-fit rubric ~120 ≈ **1,320 words** — near the 1,500 the
  2026-08-28 #390 record targeted, reached by the grammar change rather than
  enforced by a test. Never paid by deleting normative rules (the run-31 failure mode).
- Opens with `Audience: the authoring agent`.
- Owns the path approved-spec-or-issue → signed intent document: execution-fit rubric
  (relocated verbatim; `test_recommendation_rubric.py` re-points), the worktree-pure
  contract, decomposition judgment (contract-first + the good-engineer gate + the
  escape valve).
- **MIT notice: conditional and expected dormant.** The requirement attaches only to
  carrying substantial verbatim portions of superpowers text. The design anticipates
  none: the replaced files we own outright, and what survives from `writing-plans` is
  formats and ideas (Interfaces, Global Constraints), re-expressed fresh — copyright
  does not reach those. Include the notice only if verbatim text is in fact carried.
- One weave-era sizing line: prefer several small concurrent plans folding into one
  frontier over one large plan (N=3 drains measured 0.26× batch); the multi-plan
  integration-acceptance stopgap moves into the skill text with its Tier-2 retirement
  condition named.

## 3. The grammar: `claims-v1`

Declared by a `**Grammar:** claims-v1` line in the intent-doc header. Absent → today's
parse, byte-for-byte (legacy remains parseable indefinitely — it is the rollback path).
Document shape: the seven doc-level slots of One Driver §7, unchanged.

**Task shape:** id + the head markers below, then six body slots. No Steps slot exists;
there is nowhere for procedure to live.

Head markers (signed):
- `**Type:**` — unchanged (`implementation`/`gate`/`release`/`manual`).
- `**Files:**` — signed; existing Files grammar applies (canonical labels, no globs, no
  open write sets). Doubly load-bearing: wave shape and edge derivation.
- `tier` — signed; spend authority, as in §7.
- `**Review:**` — optional, carried over (`adversarial`/`lean`); audit target changes
  with the cutover — design at #518.

Body slots (exactly six, in order):
- **Claim** — the bilingual pair: the operator's signed sentence (verbatim, tagged
  `elicited` or `quoted from #NNN`) + the machine restatement. Do:/see: interactions,
  never system states.
- **Authorized-by** — a reference (issue, spec §, decision record) licensing the task.
- **Interfaces** — Produces/Consumes contracts, exact signatures, test names. **A
  test's import of a sibling's symbol is a `Consumes`** — this replaces the
  `Depends-on` escape hatch for test-only edges.
- **Context** — what the implementer must know that the repo cannot tell it. Word count
  emitted as `ADVISORY` and recorded per plan (§1.5); no refusal.
- **Proof** — the exam: tests, golden pairs, fixtures, executable probes. The only slot
  where code fences are legal. **Proof-referenced `Test:` paths must be disjoint from
  the task's `Create:`/`Modify:` paths.** Today this serves attribution and keeps the
  exam a distinct artifact (#447); at Tier 3 it enables adopting a task's
  tests-not-impl, and it is #511's substrate. Run-time correspondence of committed
  test files to the Proof text is review's job (#518) — no write-block, since the
  implementer legitimately materializes the Proof.
- **Stale-if** — a **predicate, not prose**: `path-exists:` / `path-absent:` /
  `sha-matches: <path>@<sha>` / `issue-open: #NNN` / `issue-closed: #NNN`. The compiler
  validates the form; a script can evaluate it. A free sentence here is a refusal — an
  undecidable Stale-if is #498's inert-prose defect reborn.

**Edge tiers under `claims-v1`** (explicit, so the implementation never guesses):

| tier | status under claims-v1 |
|---|---|
| marker (`Depends-on`) | **refused** — the line may not appear |
| interface (Consumes↔Produces token match) | **live** — primary semantic source |
| write-after-create (Files overlap) | **live** |
| non-text same-file overlap | **new automatic edge** (§4.3) |
| text (`after Task N` prose) | **off** — ordering-by-prose is inexpressible; task-reference ordering phrasing in body slots draws an `ADVISORY` |
| write-after-write | serialize-knob only, unchanged (fold is the default; same-file text writes get no edge, intentionally) |

## 4. Enforcement (all mechanical; judgment only where no mechanism can stand)

**Compiler checks (`claims-v1` mode; all diagnostics namespaced `grammar:*`):**
1. Slot shape: exactly six body slots, in order; no Steps; fences only in Proof;
   `Depends-on`/`Commutes` refused; Stale-if predicate forms; Proof/impl path
   disjointness; provenance tag *form* on every Claim; Context word count as
   `ADVISORY`.
2. **Unmatched `Consumes` → `ADVISORY`** (the existing #345 advisory channel — no new
   severity class): any Consumes pairing with no sibling's Produces — empty-tokenizing
   (prose) or non-matching (typo) — is surfaced, because with no `Depends-on` backstop
   it is a silently missing edge either way. Placeholder forms (`none`, `nothing`) stay
   legal and quiet.
3. **Non-text same-file auto-edge:** decided against the tree the compiler is run with.
   The engine compiles at dispatch with BASE available — the authoritative site.
   Offline `--check` without a tree surfaces same-file pairs it cannot classify as an
   `ADVISORY`, never a guess. A `Create:` path (absent at BASE) is already ordered by
   write-after-create.
4. **Claim/Authorized-by resolution is a pre-compile script, not the compiler** — the
   compiler stays a pure function. `ultrawrite`'s validation step runs the provenance
   script (needs `gh`): the anchor resolves, and a `quoted from #NNN` claim
   string-matches the issue body verbatim at signing time. The verdict is stamped into
   the gate-verdict record (below). A later edit to the issue does not retro-invalidate
   a signed claim — the signature is over the quote at signing time; drift is
   Stale-if's department.
5. **The proof gate's verdict is an artifact, not a memory:** the gate writes
   `gate-verdicts.json` beside the intent doc — per task, a verdict keyed on the hash
   of (Claim pair, Proof). The `claims-v1` compiler **refuses to compile** a plan whose
   verdict record is missing or whose hashes are stale (edited claim/proof →
   re-dispatch). The gate is mechanically enforceable, not a convention.
6. Signed-set identity at derivation: unchanged (§7 driver diff keyed on `intent.sha`).

**Deterministic input, non-deterministic judgment:** the gate's diet is built by an
extractor from the parsed (Claim pair, Proof) slots — the cap on what it reads is
mechanical; only its verdict is judgment. Claim elicitation and the layer-match verdict
stay judgment by design (#239 decision 4); the shrink lever is #494 (executable
probes), successor direction, not scope.

**The frozen periphery is untouched.** All additions are namespaced and opt-in by
grammar declaration; **no legacy plan's compile output changes byte-for-byte** (pinned
by the legacy fixtures). On inspection there is no "default flip" periphery event at
all: the compiler accepts both grammars and plans declare which they are — so no
frozen-periphery license is required. The freeze's protections (existing vocabulary,
gate scripts, `run_acceptance.sh`) are not modified by this spec.

**Migration:** none. The two historical docs in `docs/superpowers/intents/` are not
migrated; the corpus replayer replays legacy shapes unaffected.

## 5. Elicitation and the proof gate

**Elicitation.** From a filed issue: quote the operator's words as the claim, bind the
machine restatement, show the pair once for confirmation — not authorship. From a bare
idea: scenario questions ("after this run, what can you see or do that you couldn't
before?") with 2–3 pre-chewed do:/see: options via AskUserQuestion; the operator's pick
plus edits is the claim. Never a drafted sentence handed over for countersigning.
Register drift between the pair's halves is a checkable defect at the gate. The craft of
the deleted Operator-smoke section — aim where the suite is structurally blind — lives
here, as claim guidance.

**The proof gate.** One fresh-context subagent per task, pre-compile. Input: only the
extractor-assembled (Claim pair, Proof) — no ledger, no wiki, no plan body (the
WikiSkill ablation). One question: *if this exam passes, is the sentence necessarily
true, at the right layer?* Layer mismatch = no compile until revised (enforced via the
verdict record, §4.5).

**Role separation** (the #239 clarification-3 leak, closed): the gate agent never
authors proofs; the wave author never chooses which proof a task satisfies — the
claim→proof mapping is signed before any derivation exists.

## 6. Weave alignment (compressed)

Every #360 tier retirement converts an authored claim into a derived fact, and the
grammar sheds the claim the moment the engine derives the fact — `Depends-on` and
`Commutes:` here; contention prediction at Tier ∞. **Edges-derived is future-proof:**
live near-collision (Tier ∞) and per-wave recompute (shape B) become engine changes,
not migrations of the signed artifact. What the weave does *not* change: worker
blindness — clones at BASE still cannot see siblings, so Interfaces and Context stay
load-bearing, and the suite-per-wave and proof gate survive (the weave merges text, not
meaning).

## 7. Deletions — one change, licensed by reasoning recorded here

The cutover deletes in the same change that builds (§1.4). The fate taxonomy below is
the *rationale*, not a process: every deletion names why it dies, so a trim that cannot
name its fate does not execute and the run-31 failure mode (paying budgets by deleting
rules) has nowhere to hide.

**Fate A — subject deleted (unsayable under claims-v1):** all Steps machinery
(writing-plans' bite-sized TDD steps, No Placeholders, repeat-the-code); all
`Depends-on` authoring guidance (interrogation, additive semantics, none-vs-ids,
marker-placement pathology); `Commutes:` guidance; ordering-as-marker rules;
global-ordering-prose supersession; the header-replacement section.

**Fate B — enforcement documentation, owned by the compiler:** the Files and Interfaces
grammar expositions (did-you-mean diagnostics teach at the moment of violation; the
skill keeps two sentences); classification heuristics (legacy-path only); the
sealed/BLOCKED note (one line).

**Fate C — judgment, relocated and compressed (~800 words):** worktree-pure contract;
decomposition moves + justification gate + escape valve; let-same-file-edits-stand;
blast-radius rule (#233); concurrency-safe tests; claims-about-live-world carry
evidence; Global Constraints discipline (result-claims, never process rules); tier
escalation; `CLAUDE_CONFIG_DIR` isolation; greenfield-stack pointer; execution-fit
rubric; the multi-plan stopgap (§2).

**Fate D — transformed:** Operator smoke dies as an appended section (#498) — its craft
becomes claim guidance (§5), and the do:/see: probe *is* the Claim slot. `**Review:**
adversarial` survives; audit target changes — design at #518. The sequential-fallback
property weakens honestly: a claims-v1 plan has no steps to follow, but a sequential
executor can implement task-by-task from contract + proof; routing text and README say
the weaker thing.

**Deleted in the cutover change:** `skills/ultraplan/`; the authoring half of
`references/plan-markers.md` (+ Executor variance); `check_superpowers_compat.py`,
`resolve_superpowers.py`, `superpowers_contract.py`; the writing-plans invocation for
plan bodies; CLAUDE.md's "extends, does not fork" text and the stale plan-markers path;
README + marketplace wording per #390. `hooks/session_start.sh` routing re-points at
`ultrawrite`.

**Rollback:** one `git revert` of the cutover change restores ultraplan and the old
routing; legacy plans never stopped compiling; the engine was never touched.

## 8. Measurement — production canaries, on every run (reported to map #238)

The cutover's measurement is telemetry, not an experiment:

- **Authoring side:** proof-gate rejection rate — **emitted by the gate tooling as a
  side effect of running** (a tally in `gate-verdicts.json`), never remembered. Alive
  by construction: a zero-streak indicts the gate, not the authors.
- **Run side:** ledger defects-traced-to-plan — reviewer `plan-defect:` prefix
  convention today, weave-provenance attribution when Tier 3 lands (#360). Born with
  its deterministic successor named.
- **Operational dials for the first runs** (#489 first, then the docket): parked-task
  count vs the standing baseline, and tokens vs comparable steps-era runs — read from
  the run records, no new plumbing.
- The redirect canary is dead and never cited.

A bad first read (parks spike, gate rejects everything, tokens blow out) → diagnose;
if the grammar itself is the cause, revert per §7 and return to the drawing board with
the telemetry in hand.

## 9. Tests

- `claims-v1` fixtures join `evals/fixtures/` (a claims-shaped sample plan, plus
  refusal cases: Steps present, Depends-on present, prose Stale-if, paraphrased quote,
  proof/impl overlap, fence outside Proof, missing/stale gate verdicts; advisory
  cases: unmatched Consumes, Context word count, ordering phrasing);
  `tests/test_compile_plan.py` grows the cases. **Legacy fixtures pinned
  byte-identical in behavior.**
- **No word-ceiling test** (§1.5): CI's prose-size report and release commit bodies
  carry the numbers.
- `tests/test_recommendation_rubric.py` re-points at `ultrawrite`.
- `claude plugin eval` gates the client surface (standing #390 work item).

## 10. Work items (one cutover change + one first run)

1. **The cutover PR:** `ultrawrite`; `claims-v1` mode + checks (§4); extractor + gate
   dispatch + verdict record; provenance script; fixtures + tests; §7 deletions;
   routing re-point; CLAUDE.md/README/marketplace wording; release (patch bump — operator call, 2026-08-31).
2. **First run:** author #489 under the new grammar; fleet-run; read §8's dials.
   (Run-43 may opportunistically discharge #360's owed weave-bundle smoke — recorded
   on #360.)
3. **Records owed with the commit:** the §1 decision summary to #390; the decision-5
   amendment note to #239.

## 11. Out of scope

- #518 (reviewer claim-verification; the `Review:` audit-target design) — after this.
- #511 (racing) — licensed only after the grammar lands; §3 banks its substrate.
- #494 (executable-probe fraction) — the gate's successor; measurable any time.
- Shape-B per-wave recompute and Tier-∞ live contention — engine work, no schema
  change.
- `fleet/roles/reviewer.md` — untouched; #496 stands.

## Trim review

**Author disclosure — Adds:** six-slot task grammar + claims-v1 mode; edges/Commutes
derived-not-signed; Stale-if predicate vocabulary; provenance script; proof gate +
extractor + verdict record; unmatched-Consumes advisory; non-text auto-edge; canaries.
**Removes:** ultraplan (3,014w), authoring half of plan-markers (~2,000w),
writing-plans invocation for bodies, Steps, `Depends-on`, `Commutes:`, Operator smoke,
three compat scripts, the two-authorities seam — in one change.

**Reviewer:** one fresh-context subagent (inputs: spec, #390/#239 records, dispatch
brief, compiler + skill sources; never the authoring conversation). **Grade
(reviewer's): `netConceptDelta = flat`** — graded against the staged draft; the
subsequent operator amendments (direct cutover, caps-to-reports) delete the
coexistence-era concepts the reviewer weighed, so the amended design trends down.

**Adopt-or-answer (all nine trims):** 1 §6-narration **adopted** (compressed). 2
determinism-taxonomy **partially adopted**. 3 prose-Consumes **adopted as modified**
(existing `ADVISORY` channel; refusal rejected — BASE-contract prose is legitimate). 4
proof/impl disjointness **kept, run-time half specified** (§3; review's job, #518). 5
plan-sizing **adopted** (one line). 6 `Review:` pointer **adopted**. 7 weave smoke
decoupled **adopted**. 8 canary-emission merge **adopted**. 9 rationale recaps
**partially adopted** (operator-register kept). All ten under-specifications addressed
in place (§§2–4, 8); scope expansions 1–3 are the operator decisions of §1, recorded on
#390/#239 with this commit.

**Post-review operator amendments (same sitting):** word caps → reported numbers
(§1.5); MIT → conditional-dormant (§2); staged A/B + phases → direct cutover with
production canaries (§1.4, §§7–8, 10). These postdate and supersede the reviewed
draft's staging machinery.
