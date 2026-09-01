# One Owned Authoring Skill — spec (#390, map #238)

**Date:** 2026-08-31 · **Decided by:** the #239 closing record (2026-09-01 grilling) + four
operator decisions this sitting (§1 — to be recorded on #390 with this spec's commit; the
trim review correctly notes they are unrecorded until then). **Delivers:** the `ultrawrite`
skill, the `claims-v1` compiler mode, and the pre-registered A/B whose record licenses the
default flip.

> **Audience note.** The authoring agent writes every artifact below; the operator
> brainstorms, answers elicitation, and signs. #243 changed horizon, locus and signing
> boundary — never human→machine (#390 correction of record).

## 1. Decisions taken this sitting (operator, 2026-08-31)

1. **Contracts signed, edges derived.** The operator signs tasks and their contracts
   (Interfaces, Files). The compiler derives every edge from Interfaces token-matching
   plus Files overlap — machinery it already runs as a cross-check. `**Depends-on:**` is
   refused under `claims-v1`. Rationale: an operator who does not read diffs cannot
   verify an edge; the corpus evidence is #443 (54% decomposition shape) and #446 (a
   false edge is silent and permanent). This settles the shape-A/B question #390 posed,
   at the compile-once point (shape B's per-wave recompute stays open engine work, §12).
2. **`**Commutes:**` is dropped from the grammar.** Append-shapedness is visible in diff
   hunks at merge; the fold handles the general case, and the marker only optimizes
   union-vs-resolve. If fold metrics show the optimization missed (resolver-chain cost
   up), that is a measured case for the *engine* deriving it from diff shape — never for
   re-signing it.
3. **Filed-issue text counts as the elicited claim.** The skill quotes the operator's own
   words from the originating issue (verbatim, anchored); a live elicitation interview is
   required only when planning starts from a bare idea. (A deliberate relaxation of
   #239 decision 4's interview, chosen so autonomous docket drains keep working; the
   signing boundary stays "the operator's own words.")
4. **A/B target: #489** (ultralearn fail-loud) — mid-size, fleet-runnable, zero coupling
   to the authoring machinery under test.

Build shape: **one spec, staged land.** The skill and the opt-in compiler mode land
beside ultraplan; the A/B runs; the default flips and the deletions execute only on a
win. Nothing is a norm at any stage: from the moment the new grammar exists, the
compiler refuses its violations (the Amendment-4 lesson).

## 2. The skill: `ultrawrite`

One owned authoring skill at `skills/ultrawrite/`, replacing `ultraplan` **and** the
`superpowers:writing-plans` invocation for plan bodies (no override layer, no two
authorities — #239 decision 7). Properties:

- **≤ 1,500 words**, pinned by a release-refusing test; raised only by writing the new
  number and its reason into the release commit body. Estimated budget (the ceiling
  test, not this estimate, is the bar): relocated judgment ~800 (§7 Fate C) + slot
  semantics ~150 + elicitation flow ~150 + gate dispatch ~100 + execution-fit rubric
  ~120 ≈ **1,320**, ~180 headroom. Authored for concept coherence; never paid by
  deleting normative rules (the run-31 failure mode).
- Opens with `Audience: the authoring agent`.
- Owns the path approved-spec-or-issue → signed intent document: execution-fit rubric
  (relocated verbatim; `test_recommendation_rubric.py` re-points at Phase 3), the
  worktree-pure contract, decomposition judgment (contract-first + the good-engineer
  gate + the escape valve).
- Ships the superpowers MIT copyright + permission notice alongside derived prose.
- One weave-era sizing line: prefer several small concurrent plans folding into one
  frontier over one large plan (N=3 drains measured 0.26× batch); the multi-plan
  integration-acceptance stopgap moves into the skill text with its Tier-2 retirement
  condition named.

## 3. The grammar: `claims-v1`

Declared by a `**Grammar:** claims-v1` line in the intent-doc header. Absent → today's
parse, byte-for-byte. Document shape: the seven doc-level slots of One Driver §7,
unchanged.

**Task shape:** id + the head markers below, then six body slots. No Steps slot exists;
there is nowhere for procedure to live.

Head markers (signed):
- `**Type:**` — unchanged (`implementation`/`gate`/`release`/`manual`).
- `**Files:**` — signed; existing Files grammar applies (canonical labels, no globs, no
  open write sets). Doubly load-bearing: wave shape and edge derivation.
- `tier` — signed; spend authority, as in §7.
- `**Review:**` — optional, carried over (`adversarial`/`lean`); audit target changes at
  the default flip — design at #518.

Body slots (exactly six, in order):
- **Claim** — the bilingual pair: the operator's signed sentence (verbatim, tagged
  `elicited` or `quoted from #NNN`) + the machine restatement. Do:/see: interactions,
  never system states.
- **Authorized-by** — a reference (issue, spec §, decision record) licensing the task.
- **Interfaces** — Produces/Consumes contracts, exact signatures, test names. **A test's
  import of a sibling's symbol is a `Consumes`** — this replaces the `Depends-on`
  escape hatch for test-only edges.
- **Context** — what the implementer must know that the repo cannot tell it.
  **Capped at 350 words** (the role-file ceiling, applied to the other prose an agent is
  made to read at dispatch), enforced as a `claims-v1` compiler check — a diagnostic,
  not a test literal — raised only via the release-commit-body protocol (#496 lesson).
- **Proof** — the exam: tests, golden pairs, fixtures, executable probes. The only slot
  where code fences are legal. **Proof-referenced `Test:` paths must be disjoint from
  the task's `Create:`/`Modify:` paths.** Today this serves attribution and keeps the
  exam a distinct artifact (#447); at Tier 3 it enables adopting a task's
  tests-not-impl, and it is #511's substrate. Run-time correspondence of committed test
  files to the Proof text is review's job (#518) — no write-block, since the
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
   `Depends-on`/`Commutes` refused; Context ≤ 350 words; Stale-if predicate forms;
   Proof/impl path disjointness; provenance tag *form* on every Claim.
2. **Unmatched `Consumes` → `ADVISORY`** (the existing #345 advisory channel — no new
   severity class): any Consumes that pairs with no sibling's Produces — whether it
   tokenizes to empty (prose) or to a non-matching token (typo) — is surfaced, because
   with no `Depends-on` backstop it is a silently missing edge either way. Placeholder
   forms (`none`, `nothing`) stay legal and quiet.
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
   a signed claim — the signature is over the quote at signing time; drift is Stale-if's
   department.
5. **The proof gate's verdict is an artifact, not a memory:** the gate writes
   `gate-verdicts.json` beside the intent doc — per task, a verdict keyed on the hash of
   (Claim pair, Proof). The `claims-v1` compiler **refuses to compile** a plan whose
   verdict record is missing or whose hashes are stale (edited claim/proof →
   re-dispatch). The gate becomes mechanically enforceable, not a convention.
6. Signed-set identity at derivation: unchanged (§7 driver diff keyed on `intent.sha`).

**Deterministic input, non-deterministic judgment:** the gate's diet is built by an
extractor from the parsed (Claim pair, Proof) slots — the cap on what it reads is
mechanical; only its verdict is judgment. Claim elicitation and the layer-match verdict
stay judgment by design (#239 decision 4); the shrink lever is #494 (executable probes),
successor direction, not scope.

**Frozen-periphery sequencing, explicit:** Phase 1 touches nothing frozen — the mode is
opt-in and namespaced, and **no legacy plan's compile output changes byte-for-byte**
(pinned by the legacy fixtures). The frozen-periphery event is the **default flip**
(Phase 3), and its license is the A/B record (§8), claimed under the Phase-2-tier-deletion
protocol: record first, then the change.

**Migration:** none. Legacy grammar stays parseable indefinitely (frozen vocabulary
untouched); the two historical docs in `docs/superpowers/intents/` are not migrated; the
corpus replayer replays legacy shapes unaffected.

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
live near-collision (Tier ∞) and per-wave recompute (shape B) become engine changes, not
migrations of the signed artifact. What the weave does *not* change: worker blindness —
clones at BASE still cannot see siblings, so Interfaces and Context stay load-bearing,
and the suite-per-wave and proof gate survive (the weave merges text, not meaning).

## 7. Deletions — by fate, not by file

Staged strictly behind the A/B (the old arm cannot be authored if ultraplan is gone).
Every deletion carries its license; a trim that cannot name its fate does not execute.

**Fate A — subject deleted (unsayable under claims-v1):** all Steps machinery
(writing-plans' bite-sized TDD steps, No Placeholders, repeat-the-code); all `Depends-on`
authoring guidance (interrogation, additive semantics, none-vs-ids, marker-placement
pathology); `Commutes:` guidance; ordering-as-marker rules; global-ordering-prose
supersession; the header-replacement section.

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

**Executed on the win:** delete `skills/ultraplan/`; the authoring half of
`references/plan-markers.md` (+ Executor variance); retire `check_superpowers_compat.py`,
`resolve_superpowers.py`, `superpowers_contract.py`; CLAUDE.md drops "extends, does not
fork" and fixes the stale plan-markers path; README + marketplace wording per #390.
(The `session_start.sh` precedence line lands in Phase 1.)

## 8. The A/B — pre-registered here, frozen before either arm is authored

- **Target:** #489. One intent, two arms: steps+code (ultraplan + writing-plans) vs
  claims+proofs (`ultrawrite` + `claims-v1`).
- **Runs:** both fleet-run (run-43/44).
- **Win, all three:** (1) fewer defects traced to the plan (ledger count; the 14-run
  plan-verbatim corpus is baseline); (2) no rise in parked tasks; (3) claims-arm tokens
  ≤ **1.25×** the steps arm (quality > tokens > clock). Band adjustable at
  registration, never after.
- **Tie rule (n=1 per arm):** a tie or near-tie on plan-traced defects (Δ ≤ 1) is **not
  a win** — no default flip; one further pre-registered pair may be run after diagnosis,
  same band.
- **Record:** `evals/frontier/results/`, sitting-2 style. The winning record is the
  frozen-periphery license for the default flip (§4). A loss → the grammar stays
  opt-in and the miss is diagnosed before any re-run.

## 9. Canaries (both new plumbing, reported per run to map #238)

- **Authoring side:** proof-gate rejection rate — **emitted by the gate tooling as a
  side effect of running** (a tally in `gate-verdicts.json`), never remembered. Alive
  by construction: a zero-streak indicts the gate, not the authors.
- **Run side:** ledger defects-traced-to-plan — reviewer `plan-defect:` prefix
  convention today, weave-provenance attribution when Tier 3 lands. Born with its
  deterministic successor named.
- The redirect canary is dead and never cited.

## 10. Tests

- `claims-v1` fixtures join `evals/fixtures/` (a claims-shaped sample plan, plus refusal
  cases: Steps present, Depends-on present, prose Stale-if, paraphrased quote,
  proof/impl overlap, fence outside Proof, Context over cap, missing/stale gate
  verdicts); `tests/test_compile_plan.py` grows the cases. **Legacy fixtures pinned
  byte-identical in behavior.**
- The ≤1,500 skill ceiling: release-refusing test, commit-body escape hatch.
- `tests/test_recommendation_rubric.py` re-points at `ultrawrite` (Phase 3).
- `claude plugin eval` gates the client surface (standing #390 work item).

## 11. Phases

1. **Phase 1 — land beside:** `ultrawrite`; `claims-v1` mode + checks (§4); extractor +
   gate dispatch + verdict record; provenance script; precedence line; MIT notice;
   ceiling test; fixtures. (Run-43 may opportunistically discharge #360's owed
   weave-bundle smoke — recorded on #360, outside the A/B record.)
2. **Phase 2 — the A/B:** author #489 both ways; fleet-run both; record.
3. **Phase 3 — on a win:** default flip; §7 deletions; rubric re-point; CLAUDE.md,
   README, marketplace wording; release (minor bump — architectural).

## 12. Out of scope

- #518 (reviewer claim-verification; the `Review:` audit-target design) — after this.
- #511 (racing) — licensed only after the grammar lands; §3 banks its substrate.
- #494 (executable-probe fraction) — the gate's successor; measurable any time.
- Shape-B per-wave recompute and Tier-∞ live contention — engine work, no schema change.
- `fleet/roles/reviewer.md` — untouched; #496 stands.

## Trim review

**Author disclosure — Adds:** six-slot task grammar + claims-v1 mode; edges/Commutes
derived-not-signed; Stale-if predicate vocabulary; provenance script; proof gate +
extractor + verdict record; Context cap; unmatched-Consumes advisory; non-text
auto-edge; two canaries; A/B registration. **Removes (on the win):** ultraplan (3,014w),
authoring half of plan-markers (~2,000w), writing-plans invocation for bodies, Steps,
`Depends-on`, `Commutes:`, Operator smoke, three compat scripts, the two-authorities
seam.

**Reviewer:** one fresh-context subagent (inputs: spec, #390/#239 records, dispatch
brief, compiler + skill sources; never the authoring conversation). **Grade
(reviewer's): `netConceptDelta = flat`** — concept-for-concept replacement during the
staged period, trending down only if Phase 3 executes and trims 3/4/8 are taken (3 and 8
adopted below; 4 kept with the run-time half specified).

**Adopt-or-answer (all nine trims):**

1. *§6 weave narration → two sentences.* **Adopted** (compressed to §6 as it now
   stands). Remainder answered: the reflection was operator-directed this sitting; its
   consequences are banked as rules in §§2–4, not narration.
2. *§4 determinism taxonomy → drop.* **Partially adopted:** items compressed; the
   enforced-by-code list is the implementable contract. The judgment boundary is kept in
   two sentences — it records the operator's explicit determinism audit.
3. *Prose-Consumes warn → refusal or drop.* **Adopted as modified:** no new severity
   class — the existing `ADVISORY` channel (#345) covers every unmatched Consumes
   (empty-tokenizing *and* non-matching), which also answers under-specification 2.
   Refusal rejected: free-prose Consumes describing a BASE contract is legitimate and
   correctly edge-free.
4. *Proof/impl disjointness → defer to #511 or spec run-time half.* **Kept, run-time
   half specified** (§3): correspondence checking is review's job (#518); no write-block
   — the implementer legitimately materializes the Proof. Present-tense value is #447
   (the exam is a distinct artifact) and attribution, not racing.
5. *Plan-sizing inversion → one line.* **Adopted** (§2); stopgap detail moves to skill
   text.
6. *`Review:` audit description → pointer.* **Adopted** (§3, §7 Fate D).
7. *Weave smoke decoupled from A/B.* **Adopted** — moved to a Phase-1 operational note,
   recorded on #360, outside the A/B record.
8. *Canary emission merged into §9.* **Adopted.**
9. *§1 rationale recaps → citations.* **Partially adopted:** trimmed to one-line
   rationales; kept because the operator reads this spec and bare issue numbers are
   the wrong register.

**Under-specifications:** all ten addressed in place — edge-tier table (§3), unmatched
Consumes (§4.2), non-text detection site (§4.3), compiler purity / provenance script /
issue-edit semantics (§4.4), gate-verdict artifact (§4.5), Context cap number + protocol
(§3), word arithmetic (§2), Phase-1 license argument (§4), A/B tie rule (§8),
migration/replayer (§4).

**Scope expansions:** 1–3 are the operator decisions of this sitting, recorded in §1 and
owed to #390 as a comment with this commit (the reviewer, correctly, could not see
them). 4–6 adopted-as-modified or answered above. 7–8 adopted (trims 5, 7). 9 compressed
(trim 1). The reviewer confirms #518/#494/#511 fencing does real work.
